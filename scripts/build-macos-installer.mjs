import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, writeFile, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { distributionXml, componentScript, writeMacInstallerResources } from "./macos-installer.mjs";

if (process.platform !== "darwin") throw new Error("The macOS PKG must be built and tested on macOS.");
const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const candidate = process.env.SOUNDDESIGNER_INSTALLER_CANDIDATE === "1";
if (!candidate && process.env.SOUNDDESIGNER_PHASE4_APPROVED !== "1") throw new Error("Phase 4 certification is required for release installers.");
if (!candidate && (process.env.SOUNDDESIGNER_SIGNING_APPROVED !== "1" || !process.env.SOUNDDESIGNER_MAC_INSTALLER_IDENTITY || !process.env.SOUNDDESIGNER_MAC_NOTARY_PROFILE)) throw new Error("Separate signing approval, Developer ID Installer identity and notarization profile are required.");
const payload = path.resolve(process.env.SOUNDDESIGNER_ZXP || path.join(root, "release", `SoundDesigner-v${version}.zxp`));
if (!existsSync(payload)) throw new Error("A signed Adobe ZXP is required; it is never signed implicitly by this builder.");
const output = path.resolve(process.env.SOUNDDESIGNER_INSTALLER_OUTPUT || path.join(root, "release", `SoundDesigner-v${version}-macOS.pkg`));
if (existsSync(output)) throw new Error("Installer output exists; choose a new output path instead of overwriting it.");
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
};
run("bun", ["resolve/scripts/verify-artifact.ts"], { ...process.env, ALLOW_MISSING_NATIVE: "0" });
await mkdir(path.dirname(output), { recursive: true });
const work = await mkdtemp(path.join(path.dirname(output), ".installer-macos-"));
const resources = path.join(work, "resources");
await writeMacInstallerResources(resources, path.join(work, "resource-source"));
for (const target of ["adobe", "resolve"]) {
  const scripts = path.join(work, target);
  const files = path.join(scripts, "payload");
  await mkdir(scripts);
  if (target === "adobe") {
    run("/usr/bin/ditto", ["-x", "-k", payload, files]);
    const manifest = path.join(files, "CSXS", "manifest.xml");
    const attribute = name => {
      const result = spawnSync("/usr/bin/xmllint", ["--xpath", `string(/*/@${name})`, manifest], { encoding: "utf8" });
      if (result.status !== 0) throw new Error("Invalid Adobe manifest.");
      return result.stdout.trim();
    };
    if (attribute("ExtensionBundleId") !== "com.rksound.designer" || attribute("ExtensionBundleVersion") !== version || !existsSync(path.join(files, "META-INF", "signatures.xml"))) throw new Error("Adobe payload identity/version/signature is incomplete.");
  }
  else await cp(path.join(root, "resolve", "dist", "plugin", "com.sound.designer.resolve"), files, { recursive: true });
  const checkLinks = async directory => { for (const entry of await readdir(directory)) { const file = path.join(directory, entry); const info = await lstat(file); if (info.isSymbolicLink() || entry === ".debug" || /\.map$/i.test(entry)) throw new Error(`Unsafe/development payload entry rejected: ${file}`); if (info.isDirectory()) await checkLinks(file); } };
  await checkLinks(files);
  run("bun", ["scripts/artifact-audit.ts", `--${target}`, files]);
  if (target === "resolve" && !candidate) {
    for (const name of ["WorkflowIntegration.node", "macos-menu.node"]) {
      const addon = path.join(files, name);
      if (process.env.SOUNDDESIGNER_MAC_CODE_IDENTITY) run("/usr/bin/codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", process.env.SOUNDDESIGNER_MAC_CODE_IDENTITY, addon]);
      run("/usr/bin/codesign", ["--verify", "--strict", addon]);
    }
  }
  const runtimeArch = (process.env.RESOLVE_TARGET_ARCH || process.arch) === "arm64" ? "arm64" : "x86_64";
  for (const phase of ["preinstall", "postinstall"]) {
    const script = path.join(scripts, phase);
    await writeFile(script, componentScript(target, phase, runtimeArch));
    await chmod(script, 0o755);
  }
  // Script-managed swaps preserve the old tree before Installer can overwrite it.
  // --nopayload receipts contain no relocatable bundles; destinations are fixed.
  run("/usr/bin/pkgbuild", ["--nopayload", "--scripts", scripts, "--identifier", target === "adobe" ? "com.rksound.designer.pkg.adobe" : "com.sound.designer.pkg.resolve", "--version", version, path.join(work, `${target}.pkg`)]);
}
await writeFile(path.join(work, "Distribution.xml"), distributionXml(version));
const args = ["--distribution", path.join(work, "Distribution.xml"), "--package-path", work, "--resources", resources];
if (!candidate) {
  if (process.env.SOUNDDESIGNER_SIGNING_APPROVED !== "1" || !process.env.SOUNDDESIGNER_MAC_INSTALLER_IDENTITY || !process.env.SOUNDDESIGNER_MAC_NOTARY_PROFILE) throw new Error("Separate signing approval, Developer ID Installer identity and notarization profile are required.");
  for (const name of ["WorkflowIntegration.node", "macos-menu.node"]) run("/usr/bin/codesign", ["--verify", "--strict", path.join(work, "resolve", "payload", name)]);
  args.push("--sign", process.env.SOUNDDESIGNER_MAC_INSTALLER_IDENTITY);
}
run("/usr/bin/productbuild", [...args, output]);
run("bun", ["scripts/artifact-audit.ts", "--pkg", output]);
if (!candidate) {
  run("/usr/sbin/pkgutil", ["--check-signature", output]);
  run("/usr/bin/xcrun", ["notarytool", "submit", output, "--keychain-profile", process.env.SOUNDDESIGNER_MAC_NOTARY_PROFILE, "--wait"]);
  run("/usr/bin/xcrun", ["stapler", "staple", output]);
  run("/usr/bin/xcrun", ["stapler", "validate", output]);
  run("/usr/sbin/spctl", ["--assess", "--type", "install", "--verbose", output]);
}
await writeFile(`${output}.sha256`, `${createHash("sha256").update(readFileSync(output)).digest("hex")}  ${path.basename(output)}\n`);
console.log(`Created ${candidate ? "UNSIGNED, UNPUBLISHED CANDIDATE" : "verified"} ${output}. Work evidence retained at ${work}.`);
