import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { validateNativeModule } from "../resolve/scripts/native-module";
import { version } from "../package.json";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type Host = "adobe" | "resolve";
const forbiddenName = /^(?:\.debug|\.env(?:\..*)?|credentials?(?:\..*)?|node_modules|components?|fixtures?|tests?|logs?|\.?(?:cache|tmp|temp|vite|git)|.*\.(?:map|svelte|scss|sass|ts|tsx|log|tmp|temp|bak|orig|rej|p12|pfx|pem|key|swp|swo))$/i;
// ponytail: literal-text credential/path checks; use an approved secret scanner for obfuscated or unreviewed inputs.
const forbiddenContent = [
  /sourceMappingURL/i,
  /(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?=[:/"'\s])/i,
  /(?:["'`][A-Z]:[\\/]+|\/(?:Users|home|Volumes|tmp|private\/tmp)\/)/i,
  /browser-segment-demo|Segment Selection Demo|["']demo["']\s*\)/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:Token|Bearer)\s+[A-Za-z0-9_-]{12,}/,
  /["']?(?:freesoundApiKey|api[_-]?key|client[_-]?secret|password|access[_-]?token)["']?\s*[:=]\s*["'][^"']+["']/i,
];

export const auditPayload = async (directory: string, host: Host, platform: string = process.platform, arch: string = process.arch, allowMissingNative = false) => {
  const files: string[] = [];
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder)) {
      const file = path.join(folder, entry);
      const relative = path.relative(directory, file).replaceAll("\\", "/");
      const info = await lstat(file);
      if (info.isSymbolicLink() || forbiddenName.test(entry) || /^(?:\.?(?:cache|tmp|temp|vite)(?:[._-].*)?|\.?(?:bun|npm|sass|playwright|pw)[-_](?:cache|local|cli)|(?:fixtures?|tests?|logs?)(?:[._-].*)?|\.DS_Store|\._.*|Thumbs\.db|Desktop\.ini)$/i.test(entry)) throw new Error(`Forbidden ${host} artifact entry: ${relative}`);
      if (host === "resolve" && /(?:cep|jsx|zxp)/i.test(entry)) throw new Error(`Adobe material in Resolve: ${relative}`);
      if (host === "adobe" && /^(?:resolve|electron|WorkflowIntegration\.node|main\.cjs|preload\.cjs)$/i.test(entry)) throw new Error(`Resolve/Electron material in Adobe: ${relative}`);
      if (info.isDirectory()) await walk(file);
      else {
        if (!info.isFile()) throw new Error(`Non-file artifact entry: ${relative}`);
        const allowed = host === "resolve"
          ? /^(?:main\.cjs|preload\.cjs|manifest\.xml|package\.json|WorkflowIntegration\.node|ui\/index\.html|ui\/assets\/[^/]+\.(?:js|css))$/
          : /^(?:mimetype|CSXS\/manifest\.xml|jsx\/index\.js|main\/index\.html|META-INF\/signatures\.xml|assets\/[^/]+\.(?:cjs|css|svg|png)|icons\/[^/]+\.png)$/;
        if (!allowed.test(relative)) throw new Error(`Unexpected ${host} payload file: ${relative}`);
        if (relative === "mimetype" && (await readFile(file, "utf8")).trim() !== "application/vnd.adobe.air-ucf-package+zip") throw new Error("Unexpected ZXP mimetype metadata");
        files.push(relative);
        if (/\.(?:c?js|html|css|json|xml|svg)$/i.test(entry)) {
          const text = await readFile(file, "utf8");
          const forbidden = forbiddenContent.find(pattern => pattern.test(text));
          if (forbidden) throw new Error(`Forbidden ${host} artifact content (${forbidden.source}): ${relative}`);
          if ([root, root.replaceAll("\\", "\\\\"), root.replaceAll("\\", "/")].some(value => text.includes(value))) throw new Error(`Local checkout path in ${host} artifact: ${relative}`);
          if (host === "resolve" && /CSInterface|evalScript|bolt-cep/i.test(text)) throw new Error(`CEP runtime in Resolve: ${relative}`);
          if (host === "adobe" && /(?:require\(|from\s*)["']electron(?:\/[^"']*)?["']/.test(text)) throw new Error(`Electron runtime in Adobe: ${relative}`);
        }
      }
    }
  };
  await walk(directory);
  const required = host === "adobe" ? ["CSXS/manifest.xml", "main/index.html", "jsx/index.js"] : ["manifest.xml", "package.json", "main.cjs", "preload.cjs", "ui/index.html"];
  for (const file of required) if (!files.includes(file) || !(await lstat(path.join(directory, file))).size) throw new Error(`Missing ${host} payload file: ${file}`);
  const manifest = await readFile(path.join(directory, required[0]), "utf8");
  if (host === "adobe") {
    if (!/ExtensionBundleId="com\.rksound\.designer"/.test(manifest) || !manifest.includes(`ExtensionBundleVersion="${version}"`) || !/Extension Id="com\.rksound\.designer\.main"/.test(manifest)) throw new Error("Adobe payload ID/version mismatch");
    if (files.filter(file => /^assets\/.*\.css$/.test(file)).length !== 1 || files.filter(file => /^assets\/.*\.cjs$/.test(file)).length !== 1) throw new Error("Adobe must contain exactly one shared UI script and stylesheet");
  } else {
    const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (!manifest.includes("<Id>com.sound.designer.resolve</Id>") || !manifest.includes(`<Version>${version}</Version>`) || pkg.name !== "com.sound.designer.resolve" || pkg.version !== version || pkg.main !== "main.cjs") throw new Error("Resolve payload ID/version/entry mismatch");
    if (files.includes("WorkflowIntegration.node")) validateNativeModule(await readFile(path.join(directory, "WorkflowIntegration.node")), platform, arch);
    else if (!allowMissingNative) throw new Error("Resolve payload is missing WorkflowIntegration.node");
    if (files.filter(file => /^ui\/assets\/.*\.css$/.test(file)).length !== 1 || files.filter(file => /^ui\/assets\/.*\.js$/.test(file)).length !== 1) throw new Error("Resolve must contain exactly one shared UI script and stylesheet");
  }
  const hashes: Record<string, string> = {};
  for (const file of files.sort()) hashes[file] = createHash("sha256").update(await readFile(path.join(directory, file))).digest("hex");
  console.log(`PASS ${host} artifact audit: ${files.length} files; version ${version}; ${platform}/${arch}${allowMissingNative ? "; STATIC ONLY" : ""}`);
  return hashes;
};

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.stdout || result.error}`);
};
const compare = async (actual: Record<string, string>, expectedDirectory: string, host: Host, platform: NodeJS.Platform, arch: string) => {
  const expected = await auditPayload(expectedDirectory, host, platform, arch);
  const material = (hashes: Record<string, string>) => Object.fromEntries(Object.entries(hashes).filter(([file]) => file !== "mimetype" && !file.startsWith("META-INF/")));
  if (JSON.stringify(material(actual)) !== JSON.stringify(material(expected))) throw new Error(`${host} packaged payload differs from current candidate build`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!["--prepare-adobe", "--adobe", "--resolve", "--zxp", "--windows-installer", "--pkg"].some(option => args.includes(option))) throw new Error("Supply a payload or installer audit target");
  const flags = new Set(["--prepare-adobe", "--allow-missing-native"]);
  const options = new Set(["--adobe", "--resolve", "--platform", "--arch", "--compare-adobe", "--compare-resolve", "--zxp", "--windows-installer", "--pkg"]);
  for (let index = 0; index < args.length; index += 1) {
    if (flags.has(args[index])) continue;
    if (!options.has(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Invalid or incomplete audit option: ${args[index]}`);
    index += 1;
  }
  const value = (name: string) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
  const platform = (value("--platform") || process.platform) as NodeJS.Platform;
  const arch = value("--arch") || process.env.RESOLVE_TARGET_ARCH || process.arch;
  if (args.includes("--prepare-adobe")) {
    // The CEP plugin always emits .debug, including production; discard only that generated file.
    await rm(path.join(root, "dist/cep/.debug"), { force: true });
    const modules = path.join(root, "dist/cep/node_modules");
    // The CEP plugin creates this directory even when installModules is empty.
    if ((await readdir(modules).catch(() => null))?.length === 0) await rm(modules, { recursive: true });
    await auditPayload(path.join(root, "dist/cep"), "adobe");
  }
  for (const host of ["adobe", "resolve"] as const) {
    const directory = value(`--${host}`);
    if (directory) {
      const hashes = await auditPayload(path.resolve(directory), host, platform, arch, args.includes("--allow-missing-native"));
      const expected = value(`--compare-${host}`);
      if (expected) await compare(hashes, path.resolve(expected), host, platform, arch);
    }
  }
  for (const kind of ["zxp", "windows-installer", "pkg"] as const) {
    const artifact = value(`--${kind}`);
    if (!artifact) continue;
    const bytes = await readFile(path.resolve(artifact));
    const checksum = await readFile(`${path.resolve(artifact)}.sha256`, "utf8").catch(() => null);
    if (checksum && checksum.trim().split(/\s+/)[0] !== createHash("sha256").update(bytes).digest("hex")) throw new Error(`${kind} SHA-256 sidecar mismatch`);
    const scratch = await mkdtemp(path.join(tmpdir(), "sounddesigner-audit-"));
    try {
      if (kind === "pkg") {
        if (process.platform !== "darwin") throw new Error("PKG audit requires macOS pkgutil");
        run("/usr/sbin/pkgutil", ["--expand-full", path.resolve(artifact), path.join(scratch, "expanded")]);
        const distribution = await readFile(path.join(scratch, "expanded/Distribution"), "utf8");
        for (const host of ["adobe", "resolve"]) if (!distribution.includes(`choice id="${host}"`)) throw new Error("PKG native selectable distribution choice missing");
        for (const host of ["adobe", "resolve"] as const) {
          const component = path.join(scratch, "expanded", `${host}.pkg`);
          const info = await readFile(path.join(component, "PackageInfo"), "utf8");
          const id = host === "adobe" ? "com.rksound.designer.pkg.adobe" : "com.sound.designer.pkg.resolve";
          if (!info.includes(`identifier="${id}"`) || !info.includes(`version="${version}"`)) throw new Error("PKG receipt ID/version mismatch");
          await auditPayload(path.join(component, "Scripts/payload"), host, "darwin", arch);
        }
      } else {
        if (process.platform !== "win32") throw new Error("ZXP/EXE extraction audit currently requires Windows PowerShell");
        run("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.join(root, "scripts/extract-audit-payloads.ps1"), "-Source", path.resolve(artifact), "-Destination", scratch, "-Kind", kind]);
        if (kind === "windows-installer" && (await readFile(path.join(scratch, "version.txt"), "utf8")).trim() !== `${version}.0`) throw new Error("Installer assembly version mismatch");
        const hosts: Host[] = kind === "zxp" ? ["adobe"] : ["adobe", "resolve"];
        for (const host of hosts) {
          const hashes = await auditPayload(path.join(scratch, host), host, platform, arch);
          if (host === "adobe" && !hashes["META-INF/signatures.xml"]) throw new Error("Signed ZXP metadata missing (metadata alone does not verify publisher trust)");
          const expected = value(`--compare-${host}`);
          if (expected) await compare(hashes, path.resolve(expected), host, platform, arch);
        }
      }
      console.log(`PASS ${kind} payload audit: ${path.basename(artifact)} (not native certification or signature trust)`);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
}
