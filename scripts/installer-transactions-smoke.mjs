import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { componentScript } from "./macos-installer.mjs";

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
