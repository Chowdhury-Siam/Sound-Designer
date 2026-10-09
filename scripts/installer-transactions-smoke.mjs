import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { componentScript, writeMacInstallerResources } from "./macos-installer.mjs";

const root = path.resolve(import.meta.dirname, "..");
const run = (command, args, input) => {
  const result = spawnSync(command, args, { cwd: root, stdio: input ? ["pipe", "inherit", "inherit"] : "inherit", input, windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
};
if (process.platform === "win32") {
  await mkdir(path.join(root, "output"), { recursive: true });
  const scratch = await mkdtemp(path.join(root, "output", "installer-regression-"));
  try {
    const compiler = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const executable = path.join(scratch, "tests.exe");
    run(compiler, ["/nologo", "/target:exe", "/main:InstallerTests", `/out:${executable}`, ...["System.Drawing", "System.Windows.Forms", "System.IO.Compression", "System.IO.Compression.FileSystem", "System.Xml.Linq", "System.Web.Extensions"].map(name => `/reference:${name}.dll`), path.join(root, "scripts", "windows-installer.cs"), path.join(root, "scripts", "windows-installer-tests.cs")]);
    run(executable, []);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/bash";
if (existsSync(bash)) {
  for (const target of ["adobe", "resolve"]) for (const phase of ["preinstall", "postinstall"]) run(bash, ["-n"], componentScript(target, phase));
  console.log("Mac package scripts pass Bash syntax checks (not native installation evidence).");
} else console.log("Bash syntax check unavailable; Mac package scripts still require native verification.");

if (process.platform === "darwin") {
  await mkdir(path.join(root, "output"), { recursive: true });
  const scratch = await mkdtemp(path.join(root, "output", "mac-resource-regression-"));
  try {
    const menuSource = path.join(root, "resolve", "src", "main", "native", "macos-menu.mm");
    const menuTest = path.join(scratch, "menu-test");
    const menuModule = path.join(scratch, "macos-menu.node");
    const compile = ["clang++", "-fobjc-arc", "-framework", "AppKit", "-mmacosx-version-min=11.0", menuSource];
    run("/usr/bin/xcrun", [...compile, "-DSOUNDDESIGNER_MENU_TEST", "-o", menuTest]);
    run(menuTest, []);
    run("/usr/bin/xcrun", [...compile, "-bundle", "-arch", "x86_64", "-arch", "arm64", "-o", menuModule]);
    run("/usr/bin/lipo", [menuModule, "-verify_arch", "x86_64", "arm64"]);
    run(process.execPath, ["-e", "require(process.argv[1]); console.log('Node-API menu bridge loaded successfully');", menuModule]);
    const resources = path.join(scratch, "resources");
    await writeMacInstallerResources(resources, path.join(scratch, "source"));
    run("/usr/bin/pkgbuild", ["--nopayload", "--identifier", "com.sounddesigner.resource-regression", "--version", "1.0.0", path.join(scratch, "empty.pkg")]);
    const xml = `<?xml version="1.0"?><installer-gui-script minSpecVersion="2"><title>Resource regression</title><options customize="never"/><welcome file="welcome.rtfd" uti="com.apple.flat-rtfd"/><conclusion file="conclusion.rtfd" uti="com.apple.flat-rtfd"/><choices-outline><line choice="test"/></choices-outline><choice id="test"><pkg-ref id="com.sounddesigner.resource-regression"/></choice><pkg-ref id="com.sounddesigner.resource-regression" version="1.0.0">empty.pkg</pkg-ref></installer-gui-script>`;
    const distribution = path.join(scratch, "Distribution.xml");
    await writeFile(distribution, xml);
    run("/usr/bin/productbuild", ["--distribution", distribution, "--package-path", scratch, "--resources", resources, path.join(scratch, "test.pkg")]);
    console.log("Native Mac welcome/conclusion resources packaged successfully (no installation or signing).");
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
