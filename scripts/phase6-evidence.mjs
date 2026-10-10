import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const directory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "output", "phase6", new Date().toISOString().replace(/[:.]/g, "-"));
if (existsSync(directory)) throw new Error("Evidence output exists; choose a new directory.");
mkdirSync(directory, { recursive: true });
const env = { ...process.env, ALLOW_MISSING_NATIVE: "0" };
for (const key of ["ZXP_PACKAGE", "ZIP_PACKAGE", "BOLT_ACTION", "BOLT_WATCH", "SOUNDDESIGNER_INSTALLER_CANDIDATE"]) delete env[key];
const git = args => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const evidence = { capturedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, node: process.version, commit: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]), dirtyStatus: git(["status", "--short", "--untracked-files=all"]), version: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version, commands: [], files: {}, publication: "PASS — no production signing, system installation, commit, push, tag, release, source/distribution archive or publication operation is performed by this evidence runner" };
const check = (name, command, args, failureStatus = "FAIL") => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  const status = result.status === 0 ? "PASS" : failureStatus === "BLOCKED" && (result.error || /ModuleNotFoundError|No module named/.test(result.stderr || "")) ? "BLOCKED" : "FAIL";
  writeFileSync(path.join(directory, `${name}.log`), `$ ${command} ${args.join(" ")}\n${result.stdout || ""}\n${result.stderr || ""}${result.error || ""}`);
  evidence.commands.push({ name, command: `${command} ${args.join(" ")}`, exit: result.status, status, log: `${name}.log` });
  console.log(`${status} ${name} (exit ${result.status})`);
};
check("adobe-candidate-build", "bun", ["run", "build:adobe:candidate"]);
check("resolve-candidate-build", "bun", ["run", "build:resolve"]);
check("artifact-negative-tests", "bun", ["run", "test:artifact-audit"]);
check("audio", "bun", ["run", "test:audio"]);
check("search-tabs", "bun", ["run", "test:search-tabs"]);
check("release-safety", "bun", ["run", "test:release-safety"]);
check("installers", "bun", ["run", "test:installers"]);
check("workflow-yaml", "python", ["-c", "import yaml; w=yaml.safe_load(open('.github/workflows/main.yml', encoding='utf-8')); assert w['permissions']=={'contents':'read'}; assert set(w['jobs'])=={'shared-static','adobe-build','resolve-build','windows-installer','macos-installer','artifact-audit','native-certification'}; assert set(w['jobs']['shared-static']['strategy']['matrix']['os'])=={'windows-latest','macos-latest','ubuntu-latest'}; print('PASS workflow YAML parsing, read-only permission and seven job boundaries; not a remote Actions run')"], "BLOCKED");
check("candidate-payload-audit", "bun", ["run", "audit:artifacts"]);
const version = evidence.version;
const zxp = `release/SoundDesigner-v${version}.zxp`;
const exe = process.env.SOUNDDESIGNER_CANDIDATE_EXE || `release/SoundDesigner-v${version}-Windows-Setup.exe`;
if (process.platform === "win32") {
  if (existsSync(path.join(root, zxp))) check("existing-zxp-audit", "bun", ["scripts/artifact-audit.ts", "--zxp", zxp, "--compare-adobe", "dist/cep"]);
  else evidence.commands.push({ name: "matching-signed-zxp", status: "BLOCKED", reason: "Matching signed Adobe input missing; signing is not authorized" });
  if (process.env.SOUNDDESIGNER_CANDIDATE_EXE) {
    env.SOUNDDESIGNER_INSTALLER_CANDIDATE = "1";
    env.SOUNDDESIGNER_INSTALLER_OUTPUT = path.resolve(root, exe);
    env.SOUNDDESIGNER_ZXP = path.resolve(root, zxp);
    check("windows-installer-candidate-build", "node", ["scripts/build-windows-installer.mjs"]);
    delete env.SOUNDDESIGNER_INSTALLER_CANDIDATE;
    delete env.SOUNDDESIGNER_INSTALLER_OUTPUT;
  }
  if (existsSync(path.resolve(root, exe))) check("windows-exe-audit", "bun", ["scripts/artifact-audit.ts", "--windows-installer", exe, "--compare-adobe", "dist/cep", "--compare-resolve", "resolve/dist/plugin/com.sound.designer.resolve"]);
  else evidence.commands.push({ name: "windows-installer", status: "BLOCKED", reason: "No current Windows EXE; clean matching signed input and candidate assembly required" });
  const verifier = path.join(root, "node_modules/vite-cep-plugin/lib/bin/ZXPSignCmd.exe");
  if (existsSync(path.join(root, zxp)) && existsSync(verifier)) check("existing-zxp-signature", verifier, ["-verify", path.join(root, zxp), "-certinfo"]);
  if (existsSync(path.resolve(root, exe))) check("windows-exe-signature-state", "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-AuthenticodeSignature -LiteralPath '${path.resolve(root, exe).replaceAll("'", "''")}' | Format-List Status,StatusMessage`]);
  check("installer-screenshot", "node", ["scripts/installer-screenshot.mjs"], "BLOCKED");
}
check("diff-check", "git", ["diff", "--check"]);
const inventory = folder => {
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) inventory(file);
    else if (entry.isFile()) evidence.files[path.relative(root, file).replaceAll("\\", "/")] = { bytes: statSync(file).size, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
  }
};
for (const folder of ["dist/cep", "resolve/dist/plugin/com.sound.designer.resolve", "release", "docs"]) inventory(path.join(root, folder));
if (process.env.SOUNDDESIGNER_CANDIDATE_EXE) inventory(path.dirname(path.resolve(root, exe)));
const sourceFiles = git(["ls-files", "--cached", "--others", "--exclude-standard"]).split(/\r?\n/);
const sourceHashes = [...new Set(sourceFiles)].filter(file => existsSync(path.join(root, file)) && statSync(path.join(root, file)).isFile()).sort().map(file => `${createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex")}  ${file}`).join("\n");
writeFileSync(path.join(directory, "source-sha256.txt"), `${sourceHashes}\n`);
writeFileSync(path.join(directory, "artifact-sha256.txt"), Object.entries(evidence.files).map(([file, value]) => `${value.sha256}  ${file}`).join("\n") + "\n");
evidence.dirtyStatus = git(["status", "--short", "--untracked-files=all"]);
writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(`Evidence: ${directory}`);
if (evidence.commands.some(command => command.status === "FAIL")) process.exitCode = 1;
