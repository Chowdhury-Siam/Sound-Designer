import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("Windows desktop required for the native setup screenshot.");
const root = path.resolve(import.meta.dirname, "..");
const destination = path.resolve(process.argv[2] || "docs/windows-installer.png");
await mkdir(path.dirname(destination), { recursive: true });
const scratch = await mkdtemp(path.join(tmpdir(), "sounddesigner-screenshot-"));
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
};
try {
  const compiler = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const executable = path.join(scratch, "preview.exe");
  const args = ["/nologo", "/target:winexe", `/out:${executable}`, ...["System.Drawing", "System.Windows.Forms", "System.IO.Compression", "System.IO.Compression.FileSystem", "System.Xml.Linq", "System.Web.Extensions"].map(name => `/reference:${name}.dll`), `/resource:${path.join(root, "scripts/installer-assets/adobe-symbol.png")},SoundDesigner.Adobe.png`, `/resource:${path.join(root, "scripts/installer-assets/resolve.png")},SoundDesigner.Resolve.png`, path.join(root, "scripts/windows-installer.cs")];
  run(compiler, args);
  run(executable, ["--generate-assets", scratch]);
  run(compiler, [...args, `/resource:${path.join(scratch, "logo.png")},SoundDesigner.Logo.png`]);
  run(executable, ["--screenshot", destination]);
  console.log(`PASS native Windows setup presentation capture: ${destination}; no install/signing/payload certification`);
} finally { await rm(scratch, { recursive: true, force: true }); }
