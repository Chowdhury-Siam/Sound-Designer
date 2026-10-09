import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { distributionXml, componentScript, welcomeRtfd, conclusionRtfd, flattenRtfdScript, hasSharedInstallerRow } from "./macos-installer.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/main.yml");
const windowsBuilder = read("scripts/build-windows-installer.mjs");
const windowsInstaller = read("scripts/windows-installer.cs");
const macBuilder = read("scripts/build-macos-installer.mjs");
const packager = read("scripts/package-release.mjs");
const macResources = read("scripts/macos-installer.mjs");
const nativeAssembly = read("resolve/scripts/assemble.ts");
assert.ok(nativeAssembly.includes('"-arch", "x86_64", "-arch", "arm64"'), "Menu bridge compilation must support both Resolve CPU modes");
assert.match(macBuilder, /for \(const name of \["WorkflowIntegration\.node", "macos-menu\.node"\]\)/);
const nativeSigning = macBuilder.slice(macBuilder.indexOf('  if (target === "resolve" && !candidate)'), macBuilder.indexOf('  const runtimeArch'));
for (const target of ["adobe", "resolve"]) for (const candidate of [false, true]) for (const identity of [undefined, "fixture-identity"]) {
  const calls = [];
  vm.runInNewContext(nativeSigning, { target, candidate, files: "/fixture", path, process: { env: { SOUNDDESIGNER_MAC_CODE_IDENTITY: identity } }, run: (command, args) => calls.push({ command, args }) });
  const active = target === "resolve" && !candidate;
  assert.deepEqual(calls.filter(call => call.args.includes("--verify")).map(call => path.basename(call.args.at(-1))), active ? ["WorkflowIntegration.node", "macos-menu.node"] : []);
  assert.equal(calls.filter(call => call.args.includes("--sign")).length, active && identity ? 2 : 0, "Candidate signing must stay opt-in and release signing must cover both addons");
}

assert.equal(packageJson.scripts["installer:windows"], "node scripts/build-windows-installer.mjs");
assert.equal(packageJson.scripts["installer:windows:build"], "bun run build:resolve && bun run release:package && cross-env SOUNDDESIGNER_INSTALLER_CANDIDATE=1 bun run installer:windows");
assert.equal(packageJson.scripts["installer:macos"], "bun run build:resolve && bun run release:package && cross-env SOUNDDESIGNER_INSTALLER_CANDIDATE=1 SOUNDDESIGNER_ZXP= bun run installer:macos:assemble");
assert.equal(packageJson.scripts["installer:macos:assemble"], "node scripts/build-macos-installer.mjs");
assert.match(workflow, /runs-on: windows-latest/);
assert.match(workflow, /runs-on: macos-latest/);
assert.match(workflow, /branches: \[main\]/);
assert.match(workflow, /contents: read/);
assert.doesNotMatch(workflow, /\$\{\{ runner\.temp \}\}/);
assert.match(workflow, /RESOLVE_WORKFLOW_NODE=\$native/);
assert.match(workflow, /native_module: resolve\/vendor\/windows\/WorkflowIntegration\.node/);
assert.match(workflow, /native_module: resolve\/vendor\/macos\/WorkflowIntegration\.node/);
assert.match(workflow, /Test-Path -LiteralPath \$native -PathType Leaf/);
assert.doesNotMatch(workflow, /SDK_BASE64|sdk_secret|RESOLVE_WORKFLOW_NODE_(WINDOWS|MACOS)_BASE64/);
assert.match(workflow, /SOUNDDESIGNER_ZXP=\$zxp/);
assert.doesNotMatch(workflow, /action-gh-release|publish-release|contents: write|release:package|notarytool|--sign/);
assert.doesNotMatch(workflow, /release-artifacts\/\*\.zxp/);
assert.match(workflow, /native_candidates/);
assert.doesNotMatch(workflow, /release-artifacts\/\*\s*$/m);
assert.match(workflow, /bun run installer:windows/);
assert.match(workflow, /name: windows-installer-candidate/);
assert.match(workflow, /bun run installer:macos:assemble/);
assert.doesNotMatch(workflow, /bun run installer:macos\s*$/m, "CI uses prebuilt inputs and must not invoke local ZXP signing");
assert.match(workflow, /SoundDesigner-\*-Windows-Setup\.exe/);
assert.match(workflow, /SoundDesigner-\*-macOS\.pkg/);
assert.match(windowsBuilder, /SoundDesigner\.Extension\.zxp/);
assert.match(windowsInstaller, /com\.rksound\.designer/);
assert.match(windowsInstaller, /CommonProgramFilesX86/);
assert.match(windowsInstaller, /--choices.*--adobe[\s\S]*--resolve/);
assert.match(windowsInstaller, /SoundDesigner\.Resolve\.zip/);
assert.match(windowsInstaller, /Select at least one application/);
assert.match(windowsInstaller, /Choose your software/);
assert.match(windowsInstaller, /View install locations/);
assert.match(windowsInstaller, /Text = "Premiere Pro \/ After Effects"/);
assert.match(windowsInstaller, /Focused && ShowFocusCues && Enabled/);
assert.match(windowsInstaller, /ActiveControl = adobeChoice/);
assert.match(windowsInstaller, /TextFormatFlags.NoPrefix/);
assert.doesNotMatch(windowsInstaller, /Monogram|Primary \? Color.White : SetupTheme.AccentStrong/);
for (const [file, resource, signature] of [["adobe-symbol.png", "SoundDesigner.Adobe.png", "89504e470d0a1a0a"], ["resolve.png", "SoundDesigner.Resolve.png", "89504e470d0a1a0a"]]) {
  const bytes = readFileSync(path.join(root, "scripts", "installer-assets", file));
  assert.ok(bytes.toString("hex").startsWith(signature), `${file} must be an image`);
  assert.equal(bytes.readUInt32BE(16), 256, "Logo width must retain high-DPI detail");
  assert.equal(bytes.readUInt32BE(20), 256, "Logos must be square");
  assert.equal(bytes[25], 6, "Logo PNG must include alpha rather than a white matte");
  assert.ok(windowsBuilder.includes(resource));
  assert.ok(windowsInstaller.includes(`LoadLogo("${resource}")`));
  for (const page of [welcomeRtfd, conclusionRtfd]) {
    assert.ok(page.includes(`{\\NeXTGraphic ${file} \\width800 \\height800}\\'ac`), "Logo must be a native 40pt RTFD attachment with its replacement character");
  }
}
assert.match(macResources, /for \(const asset of \["adobe-symbol.png", "resolve.png"\]\)/);
assert.match(macResources, /"--setProperty", "dpiWidth", "460.8", "--setProperty", "dpiHeight", "460.8", copy/);
assert.doesNotMatch(macResources, /"--resample/, "Never discard logo pixels to set the display size");
assert.equal(256 / 460.8 * 72, 40, "Density maps the original 256px logo to 40pt");
assert.match(macResources, /Math.abs\(image.size.width - 40\) > 0.1/);
assert.match(macResources, /Math.abs\(image.size.height - 40\) > 0.1/);
assert.match(flattenRtfdScript, /Number\(bitmap.pixelsWide\) < 80 \|\| Number\(bitmap.pixelsHigh\) < 80/, "Check actual packaged logos retain Retina resolution");
assert.match(flattenRtfdScript, /Number\(cell.verticalAlignment\) !== Number\(\$.NSTextBlockMiddleAlignment\)/);
assert.match(flattenRtfdScript, /if \(!hasSharedInstallerRow\(cells\)\)/);
// Reproduce the Mac log: values print as 0/1, but boxed 0 !== primitive 0.
const nativeTable = { isEqual(other) { return Object(this === other); } };
const nativeCells = [0, 1].map(column => ({ startingColumn: Object(column), startingRow: Object(0), table: nativeTable }));
assert.equal(hasSharedInstallerRow(nativeCells), true);
assert.equal(hasSharedInstallerRow([{ ...nativeCells[0], startingColumn: Object(1) }, nativeCells[1]]), false);
assert.equal(hasSharedInstallerRow([nativeCells[0], { ...nativeCells[1], startingRow: Object(1) }]), false);
assert.equal(hasSharedInstallerRow([nativeCells[0], { ...nativeCells[1], table: {} }]), false);
assert.match(flattenRtfdScript, /initWithTableStartingRowRowSpanStartingColumnColumnSpan\(table, 0, 1, column, 1\)/);
assert.match(flattenRtfdScript, /paragraph.textBlocks = \$\(\[cell\]\)/);
assert.match(flattenRtfdScript, /setWidthTypeForLayerEdge\(16, \$.NSTextBlockAbsoluteValueType, \$.NSTextBlockPadding, \$.NSMaxXEdge\)/);
for (const edge of ["NSMinYEdge", "NSMaxYEdge"]) assert.ok(flattenRtfdScript.includes(`setWidthTypeForLayerEdge(12, $.NSTextBlockAbsoluteValueType, $.NSTextBlockPadding, $.${edge})`), "Each software row needs deliberate vertical breathing room");
assert.match(flattenRtfdScript, /RTFDFileWrapperFromRangeDocumentAttributes/);
assert.ok(flattenRtfdScript.indexOf("data = wrapper.serializedRepresentation;", flattenRtfdScript.indexOf("RTFDFileWrapperFromRangeDocumentAttributes")) < flattenRtfdScript.indexOf("Installer software table was lost"), "Validate serialized cells after AppKit creates the table");
new vm.Script(flattenRtfdScript); // Parse the embedded script too, not only its outer JS module.
for (const page of [welcomeRtfd, conclusionRtfd]) {
  assert.ok(page.includes("\\b Premiere Pro / After Effects\\b0\\line\\fs20 "));
  assert.ok(page.includes("\\b DaVinci Resolve Studio\\b0\\line\\fs20 "));
  assert.ok(page.includes("\\brdrt\\brdrs\\brdrw10"), "Separate safety/next-step instructions from the software list");
  assert.doesNotMatch(page, /\\trowd|\\cell(?:x|\b)/, "AppKit, not hand-written RTF markup, must construct table cells");
  assert.doesNotMatch(page, /\\tab|\\dn\d+/, "Do not approximate block alignment with tabs or baseline offsets");
  assert.doesNotMatch(page, /\\b SoundDesigner\\b0|Before you install/, "No duplicate brand eyebrow or unnecessary section heading");
}
assert.match(welcomeRtfd, /Premiere Pro \/ After Effects/);
assert.match(windowsInstaller, /class SoftwareChoice : CheckBox/);
const productStyles = read("src/js/main/main.scss");
for (const [name, token] of Object.entries({ Background: "bg-0", Panel: "bg-1", Raised: "bg-2", Border: "bg-4", Text: "text-1", Secondary: "text-2", Accent: "accent", AccentStrong: "accent-strong" })) {
  const hex = productStyles.match(new RegExp(`--${token}: #([0-9a-f]{6});`, "i"))[1];
  const rgb = hex.match(/../g).map(value => parseInt(value, 16)).join(", ");
  assert.ok(windowsInstaller.includes(`Color ${name} = Color.FromArgb(${rgb});`), `Installer ${name} must match SoundDesigner --${token}`);
}
assert.match(windowsInstaller, /ScrollBars = ScrollBars.None/);
assert.match(windowsInstaller, /detail.ScrollBars = ScrollBars.Vertical; detail.Text = message/);
assert.doesNotMatch(windowsInstaller, /Choose your hosts|Select at least one host|inside your creative hosts/);
assert.match(macBuilder, /pkgbuild/);
assert.match(macBuilder, /productbuild/);
assert.match(macBuilder, /--nopayload/);
assert.match(macBuilder, /--sign/);
assert.match(macBuilder, /notarytool/);
assert.match(macBuilder, /stapler/);
for (const job of ["shared-static", "adobe-build", "resolve-build", "windows-installer", "macos-installer", "artifact-audit", "native-certification"]) assert.match(workflow, new RegExp(`^  ${job}:`, "m"));
const xml = distributionXml("1.0.4");
assert.match(xml, /<welcome file="welcome.rtfd" uti="com.apple.flat-rtfd"/);
assert.match(xml, /<conclusion file="conclusion.rtfd" uti="com.apple.flat-rtfd"/);
assert.match(macResources, /\[\["welcome", welcomeRtfd\], \["conclusion", conclusionRtfd\]\]/);
assert.match(macResources, /path.join\(document, asset\)/, "Logos must be inside each RTFD bundle");
assert.match(macResources, /writeFile\(path.join\(document, "TXT.rtf"\), text\)/);
assert.match(macResources, /wrapper.serializedRepresentation/);
assert.match(macResources, /!info.isFile\(\) \|\| !info.size/);
assert.match(macBuilder, /writeMacInstallerResources\(resources, path.join\(work, "resource-source"\)\)/);
for (const page of [welcomeRtfd, conclusionRtfd]) {
  assert.ok(page.startsWith("{\\rtf1"));
  assert.match(page, /\\fs40/, "Use a 20pt heading with 13pt titles and 10pt supporting text");
  assert.match(page, /\\red10\\green111\\blue216/, "Retain the SoundDesigner blue accent");
  assert.doesNotMatch(page, /<html|<script|https?:\/\//i);
}
assert.match(welcomeRtfd, /Customize/);
assert.match(welcomeRtfd, /Quit selected applications with Command-Q/);
assert.match(conclusionRtfd, /Workflow Integrations/);
assert.match(xml, /<pkg-ref id="com.rksound.designer.pkg.adobe"><must-close><app id="com.adobe.AfterEffects"\/><app id="com.adobe.PremierePro"\/><\/must-close>/);
assert.match(xml, /<pkg-ref id="com.sound.designer.pkg.resolve"><must-close><app id="com.blackmagic-design.DaVinciResolve"\/><\/must-close>/);
assert.match(xml, /choices-outline/);
assert.match(xml, /com\.rksound\.designer\.pkg\.adobe/);
assert.match(xml, /com\.sound\.designer\.pkg\.resolve/);
assert.doesNotMatch(xml, /<relocate|customLocation=/);
const script = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1];
const context = { choices: { adobe: { selected: false }, resolve: { selected: false } }, my: { target: { mountpoint: "/" }, result: {} }, system: { files: { fileExistsAtPath: value => value.includes("Adobe") } } };
vm.createContext(context); vm.runInContext(script, context);
assert.equal(context.initialSelection("adobe"), true);
assert.equal(context.initialSelection("resolve"), false);
assert.equal(context.initialSelection("adobe"), false, "Manual deselection must be retained");
assert.equal(context.checkChoices(), false);
context.choices.resolve.selected = true;
assert.equal(context.checkChoices(), true);
context.choices.adobe.selected = true;
assert.equal(context.checkChoices(), true);
context.choices.resolve.selected = false;
assert.equal(context.checkChoices(), true);
context.my.target.mountpoint = "/Volumes/Other";
assert.equal(context.checkChoices(), false);
for (const arch of ["arm64", "x86_64"]) for (const phase of ["preinstall", "postinstall"]) {
  const install = componentScript("resolve", phase, arch);
  assert.ok(install.includes(`/usr/bin/lipo "$tree/WorkflowIntegration.node" -verify_arch ${arch}`), "lipo requires its input before the architecture list");
  assert.ok(install.includes(`/usr/bin/lipo "$tree/macos-menu.node" -verify_arch ${arch}`), "The menu bridge must match the Resolve runtime architecture");
}
for (const target of ["adobe", "resolve"]) {
  const install = componentScript(target, "postinstall");
  assert.match(install, /trap cleanup EXIT/);
  assert.match(install, /Retained recovery backup/);
  assert.match(install, /validate "\$destination"/);
  assert.match(install, /Save your work and quit.*Command-Q/);
  assert.ok(install.indexOf("if /usr/bin/pgrep") < install.indexOf('/bin/mkdir -p "$parent"'), "Running applications must be rejected before filesystem mutation");
  assert.doesNotMatch(install, /storage-location|sounddesigner\.json|\/Users\/|\$HOME/);
}
const updaterSource = read("src/js/main/updater.ts");
const scoring = updaterSource.slice(updaterSource.indexOf("const trustedGithubUrl"), updaterSource.indexOf("const requestLatestRelease"));
// Execute the actual scoring implementation after TypeScript erasure.
const { transformSync } = await import("esbuild");
const transformed = transformSync(scoring + "\n globalThis.pick = selectAsset;", { loader: "ts" }).code;
const asset = name => ({ name, state: "uploaded", browser_download_url: `https://github.com/iboyshanto/SoundDesigner/releases/download/v1.0.4/${name}` });
for (const platform of ["MacIntel", "Win32"]) {
  const runtime = { navigator: { platform }, UPDATE_REPOSITORY: "iboyshanto/SoundDesigner" };
  vm.createContext(runtime); vm.runInContext(transformed, runtime);
  const assets = [asset("SoundDesigner-macOS.dmg"), asset("SoundDesigner-Windows-Setup.exe"), asset("SoundDesigner-macOS.pkg")];
  assert.equal(runtime.pick(assets).name, platform === "MacIntel" ? "SoundDesigner-macOS.pkg" : "SoundDesigner-Windows-Setup.exe");
  assert.equal(runtime.pick([asset(platform === "MacIntel" ? "SoundDesigner-Windows-Setup.exe" : "SoundDesigner-macOS.pkg")]), null);
  assert.equal(runtime.pick([{ ...asset("SoundDesigner-macOS.pkg"), browser_download_url: "https://github.com/other/repository/releases/download/v1.0.4/SoundDesigner-macOS.pkg" }]), null);
  if (platform === "MacIntel") assert.equal(runtime.pick([asset("SoundDesigner-macOS.dmg")]).name, "SoundDesigner-macOS.dmg");
}
assert.match(packager, /ZXPSignCmd/);
assert.match(packager, /artifact-audit\.ts", "--prepare-adobe"/);
assert.match(packager, /process\.env\.SOUNDDESIGNER_RELEASE_TAG/);

// Exercise the actual certificate-selection block without generating keys or signing.
const certificateBlock = packager.slice(packager.indexOf("const localCertificate"), packager.indexOf("const debugPath"));
const certificateScenario = async ({ env = {}, present = false, result = { status: 0 } } = {}) => {
  const calls = [];
  const runtime = {
    process: { env, execPath: "node" }, resolve: value => value,
    existsSync: () => present,
    console: { warn: () => {} },
    spawnSync: (...args) => { calls.push(args); if (result.status === 0) present = true; return result; },
    promptHidden: async () => "test-password-only",
  };
  vm.createContext(runtime);
  await vm.runInContext(`(async () => { ${certificateBlock} })()`, runtime);
  return calls;
};
assert.equal((await certificateScenario({ present: true })).length, 0);
assert.equal((await certificateScenario({ present: true, env: { SOUNDDESIGNER_ZXP_CERT: "existing.p12" } })).length, 0);
assert.equal((await certificateScenario()).length, 1);
await assert.rejects(certificateScenario({ env: { CI: "true" } }), /missing in CI/);
await assert.rejects(certificateScenario({ env: { SOUNDDESIGNER_ZXP_CERT: "missing.p12" } }), /was not found/);
await assert.rejects(certificateScenario({ result: { status: 1 } }), /creation failed/);
await assert.rejects(certificateScenario({ result: { error: new Error("spawn failed") } }), /spawn failed/);
assert.match(read("scripts/create-publisher-certificate.mjs"), /password.length < 12/);

console.log("Installer release wiring passed.");
