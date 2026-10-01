import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("The Windows EXE installer must be built on Windows.");

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseRoot = path.join(root, "release");
const workRoot = path.join(releaseRoot, ".installer-windows");
const payload = path.resolve(process.env.SOUNDDESIGNER_ZXP || path.join(releaseRoot, `SoundDesigner-v${version}.zxp`));
const installer = path.resolve(process.env.SOUNDDESIGNER_INSTALLER_OUTPUT || path.join(releaseRoot, `SoundDesigner-v${version}-Windows-Setup.exe`));
const logoPng = path.join(workRoot, "logo.png");
const logoIco = path.join(workRoot, "logo.ico");
const logoGenerator = path.join(workRoot, "logo-generator.exe");
const assemblyInfo = path.join(workRoot, "AssemblyInfo.cs");
const windowsRoot = process.env.SystemRoot || "C:\\Windows";
const powershellCompiler = [
  path.join(windowsRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(windowsRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
].find(existsSync);

if (!existsSync(payload)) throw new Error(`Signed extension payload is missing: ${payload}`);
if (!powershellCompiler) throw new Error("The .NET Framework C# compiler is required to build the Windows installer.");

await mkdir(path.dirname(installer), { recursive: true });
await rm(workRoot, { recursive: true, force: true });
await rm(installer, { force: true });
await rm(`${installer}.sha256`, { force: true });
await mkdir(workRoot, { recursive: true });

const references = [
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.IO.Compression.dll",
  "/reference:System.IO.Compression.FileSystem.dll",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Xml.Linq.dll",
];
const source = path.join(root, "scripts", "windows-installer.cs");
const versionParts = version.match(/^\d+(?:\.\d+){0,3}/)?.[0]?.split(".") ?? ["0"];
while (versionParts.length < 4) versionParts.push("0");
await writeFile(assemblyInfo, `using System.Reflection;
[assembly: AssemblyTitle("SoundDesigner Setup")]
[assembly: AssemblyProduct("SoundDesigner for Adobe")]
[assembly: AssemblyDescription("Installer for the SoundDesigner Adobe CEP extension")]
[assembly: AssemblyCompany("SoundDesigner")]
[assembly: AssemblyVersion("${versionParts.join(".")}")]
[assembly: AssemblyFileVersion("${versionParts.join(".")}")]
`, "utf8");

const compile = (args) => {
  const result = spawnSync(powershellCompiler, ["/nologo", "/target:winexe", "/optimize+", ...args, ...references, source, assemblyInfo], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("The .NET compiler could not build the Windows installer.");
};

compile([`/out:${logoGenerator}`]);
const rendered = spawnSync(logoGenerator, ["--generate-assets", workRoot], { stdio: "inherit" });
if (rendered.status !== 0 || !existsSync(logoPng) || !existsSync(logoIco)) throw new Error("Could not render the installer logo.");

compile([
  `/out:${installer}`,
  `/win32icon:${logoIco}`,
  `/win32manifest:${path.join(root, "scripts", "windows-installer.manifest")}`,
  `/resource:${payload},SoundDesigner.Extension.zxp`,
  `/resource:${logoPng},SoundDesigner.Logo.png`,
]);

const bytes = await readFile(installer);
if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error("The generated installer is not a Windows executable.");
const digest = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${installer}.sha256`, `${digest}  ${path.basename(installer)}\n`, "utf8");
const size = (await stat(installer)).size;
await rm(workRoot, { recursive: true, force: true });
console.log(`Created ${installer} (${(size / 1024).toFixed(1)} KiB)`);
