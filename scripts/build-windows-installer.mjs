import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("The Windows EXE installer must be built on Windows.");

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
if (process.env.SOUNDDESIGNER_PHASE4_APPROVED !== "1" && process.env.SOUNDDESIGNER_INSTALLER_CANDIDATE !== "1") throw new Error("Phase 4 is not certified. Use SOUNDDESIGNER_INSTALLER_CANDIDATE=1 for an unpublished test build only.");
const releaseRoot = path.join(root, "release");
const workRoot = path.join(releaseRoot, `.installer-windows-${randomUUID()}`);
const payload = path.resolve(process.env.SOUNDDESIGNER_ZXP || path.join(releaseRoot, `SoundDesigner-v${version}.zxp`));
const installer = path.resolve(process.env.SOUNDDESIGNER_INSTALLER_OUTPUT || path.join(releaseRoot, `SoundDesigner-v${version}-Windows-Setup.exe`));
const logoPng = path.join(workRoot, "logo.png");
const logoIco = path.join(workRoot, "logo.ico");
const logoGenerator = path.join(workRoot, "logo-generator.exe");
const assemblyInfo = path.join(workRoot, "AssemblyInfo.cs");
const resolveZip = path.join(workRoot, "Resolve.zip");
const resolvePayload = path.join(root, "resolve", "dist", "plugin", "com.sound.designer.resolve");
const windowsRoot = process.env.SystemRoot || "C:\\Windows";
const powershellCompiler = [
  path.join(windowsRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(windowsRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
].find(existsSync);

if (!existsSync(payload)) throw new Error(`Signed extension payload is missing: ${payload}`);
const adobeAudit = spawnSync("bun", ["scripts/artifact-audit.ts", "--zxp", payload, "--compare-adobe", path.join(root, "dist", "cep")], { cwd: root, stdio: "inherit", windowsHide: true });
if (adobeAudit.status !== 0) throw new Error("Signed Adobe input must pass audit and match the current candidate build.");
if (!powershellCompiler) throw new Error("The .NET Framework C# compiler is required to build the Windows installer.");
if (existsSync(installer)) throw new Error("Installer output already exists. Choose a new SOUNDDESIGNER_INSTALLER_OUTPUT; existing releases are never overwritten.");
const audit = spawnSync("bun", ["resolve/scripts/verify-artifact.ts"], { cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, ALLOW_MISSING_NATIVE: "0", RESOLVE_TARGET_ARCH: "x64" } });
if (audit.status !== 0) throw new Error("Build and audit the Windows Resolve payload first.");

await mkdir(path.dirname(installer), { recursive: true });
await mkdir(workRoot, { recursive: true });

const references = [
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.IO.Compression.dll",
  "/reference:System.IO.Compression.FileSystem.dll",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Xml.Linq.dll",
  "/reference:System.Web.Extensions.dll",
];
const source = path.join(root, "scripts", "windows-installer.cs");
const versionParts = version.match(/^\d+(?:\.\d+){0,3}/)?.[0]?.split(".") ?? ["0"];
while (versionParts.length < 4) versionParts.push("0");
await writeFile(assemblyInfo, `using System.Reflection;
[assembly: AssemblyTitle("SoundDesigner Setup")]
[assembly: AssemblyProduct("SoundDesigner for Adobe and Resolve")]
[assembly: AssemblyDescription("Unified SoundDesigner host installer")]
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

const archive = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Compress-Archive -Path (Join-Path $env:SD_RESOLVE_PAYLOAD '*') -DestinationPath $env:SD_RESOLVE_ZIP -CompressionLevel Optimal"], { stdio: "inherit", windowsHide: true, env: { ...process.env, SD_RESOLVE_PAYLOAD: resolvePayload, SD_RESOLVE_ZIP: resolveZip } });
if (archive.status !== 0) throw new Error("Could not archive the audited Resolve payload.");

compile([
  `/out:${installer}`,
  `/win32icon:${logoIco}`,
  `/win32manifest:${path.join(root, "scripts", "windows-installer.manifest")}`,
  `/resource:${payload},SoundDesigner.Extension.zxp`,
  `/resource:${resolveZip},SoundDesigner.Resolve.zip`,
  `/resource:${logoPng},SoundDesigner.Logo.png`,
  `/resource:${path.join(root, "scripts", "installer-assets", "adobe-symbol.png")},SoundDesigner.Adobe.png`,
  `/resource:${path.join(root, "scripts", "installer-assets", "resolve.png")},SoundDesigner.Resolve.png`,
]);
const verified = spawnSync(installer, ["--verify-payloads"], { stdio: "inherit", windowsHide: true });
if (verified.status !== 0) throw new Error("Embedded installer payload verification failed. Do not distribute this executable.");
const embeddedAudit = spawnSync("bun", ["scripts/artifact-audit.ts", "--windows-installer", installer, "--compare-adobe", path.join(root, "dist", "cep"), "--compare-resolve", resolvePayload], { cwd: root, stdio: "inherit", windowsHide: true });
if (embeddedAudit.status !== 0) throw new Error("Embedded installer artifact audit failed. Do not distribute this executable.");

const bytes = await readFile(installer);
if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error("The generated installer is not a Windows executable.");
const digest = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${installer}.sha256`, `${digest}  ${path.basename(installer)}\n`, "utf8");
const size = (await stat(installer)).size;
await rm(workRoot, { recursive: true, force: true });
console.log(`Created ${installer} (${(size / 1024).toFixed(1)} KiB)`);
