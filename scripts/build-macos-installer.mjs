import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("The macOS DMG must be built on macOS.");

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseRoot = path.join(root, "release");
const workRoot = path.join(releaseRoot, ".installer-macos");
const stagingRoot = path.join(workRoot, "staging");
const extensionRoot = path.join(stagingRoot, "SoundDesigner");
const backgroundRoot = path.join(stagingRoot, ".background");
const mountRoot = path.join(workRoot, "mount");
const sourceDmg = path.join(workRoot, "SoundDesigner-rw.dmg");
const payload = path.resolve(process.env.SOUNDDESIGNER_ZXP || path.join(releaseRoot, `SoundDesigner-v${version}.zxp`));
const output = path.resolve(process.env.SOUNDDESIGNER_INSTALLER_OUTPUT || path.join(releaseRoot, `SoundDesigner-v${version}-macOS.dmg`));

if (!existsSync(payload)) throw new Error(`Signed extension payload is missing: ${payload}`);

const run = (command, args, allowFailure = false) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (!allowFailure && result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}.`);
  return result.status === 0;
};

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
};
const encodePng = (width, height, pixels) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(rows, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
};
const artwork = (width, height, logoOnly = false) => {
  const pixels = Buffer.alloc(width * height * 4);
  const pixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3] ?? 255;
  };
  const fill = (color) => { for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixel(x, y, color); };
  const rounded = (x, y, w, h, radius, color) => {
    for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) {
      const cx = Math.max(x + radius, Math.min(px, x + w - radius - 1));
      const cy = Math.max(y + radius, Math.min(py, y + h - radius - 1));
      if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) pixel(px, py, color);
    }
  };
  const line = (x0, y0, x1, y1, thickness, color) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= steps; step += 1) {
      const x = x0 + (x1 - x0) * step / Math.max(1, steps);
      const y = y0 + (y1 - y0) * step / Math.max(1, steps);
      for (let oy = -thickness; oy <= thickness; oy += 1) for (let ox = -thickness; ox <= thickness; ox += 1) if (ox * ox + oy * oy <= thickness * thickness) pixel(x + ox, y + oy, color);
    }
  };
  const drawLogo = (x, y, size) => {
    rounded(x, y, size, size, Math.round(size * 0.23), [26, 29, 34, 255]);
    const points = [[.2,.5],[.29,.5],[.36,.33],[.45,.68],[.54,.27],[.63,.73],[.72,.37],[.8,.5]];
    for (let i = 1; i < points.length; i += 1) line(x + points[i - 1][0] * size, y + points[i - 1][1] * size, x + points[i][0] * size, y + points[i][1] * size, Math.max(2, Math.round(size * .025)), [243, 245, 247, 255]);
  };
  fill(logoOnly ? [0, 0, 0, 0] : [16, 17, 19, 255]);
  if (logoOnly) drawLogo(40, 40, width - 80);
  else {
    rounded(18, 18, width - 36, height - 36, 22, [23, 24, 27, 255]);
    drawLogo(width / 2 - 42, 44, 84);
    line(275, 230, 385, 230, 4, [115, 120, 130, 255]);
    line(365, 214, 385, 230, 4, [115, 120, 130, 255]);
    line(365, 246, 385, 230, 4, [115, 120, 130, 255]);
    for (let x = 42; x < width - 42; x += 18) line(x, 330 - ((x / 18) % 3) * 8, x, 330 + ((x / 18) % 4) * 9, 1, [60, 64, 72, 255]);
  }
  return encodePng(width, height, pixels);
};

await rm(workRoot, { recursive: true, force: true });
await rm(output, { force: true });
await rm(`${output}.sha256`, { force: true });
await mkdir(backgroundRoot, { recursive: true });
await mkdir(mountRoot, { recursive: true });
run("/usr/bin/ditto", ["-x", "-k", payload, extensionRoot]);
for (const required of ["CSXS/manifest.xml", "main/index.html", "META-INF/signatures.xml"]) {
  if (!existsSync(path.join(extensionRoot, required))) throw new Error(`Signed extension payload is incomplete: ${required}`);
}
await symlink("/Library/Application Support/Adobe/CEP/extensions", path.join(stagingRoot, "Adobe CEP Extensions"));
const logoPng = path.join(workRoot, "logo.png");
await writeFile(path.join(backgroundRoot, "background.png"), artwork(660, 400));
await writeFile(logoPng, artwork(1024, 1024, true));

const iconset = path.join(workRoot, "SoundDesigner.iconset");
await mkdir(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  run("/usr/bin/sips", ["-z", String(size), String(size), logoPng, "--out", path.join(iconset, `icon_${size}x${size}.png`)]);
  run("/usr/bin/sips", ["-z", String(size * 2), String(size * 2), logoPng, "--out", path.join(iconset, `icon_${size}x${size}@2x.png`)]);
}
run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", path.join(stagingRoot, ".VolumeIcon.icns")]);
run("/usr/bin/hdiutil", ["create", "-volname", "SoundDesigner", "-srcfolder", stagingRoot, "-ov", "-format", "UDRW", sourceDmg]);
run("/usr/bin/hdiutil", ["attach", sourceDmg, "-readwrite", "-noverify", "-noautoopen", "-mountpoint", mountRoot]);
try {
  run("/usr/bin/SetFile", ["-a", "C", mountRoot], true);
  const script = `tell application "Finder"
tell disk "SoundDesigner"
open
set current view of container window to icon view
set toolbar visible of container window to false
set statusbar visible of container window to false
set bounds of container window to {160, 160, 820, 560}
set arrangement of icon view options of container window to not arranged
set icon size of icon view options of container window to 104
set background picture of icon view options of container window to file ".background:background.png"
set position of item "SoundDesigner" of container window to {170, 230}
set position of item "Adobe CEP Extensions" of container window to {490, 230}
close
open
update without registering applications
delay 2
end tell
end tell`;
  run("/usr/bin/osascript", ["-e", script], true);
} finally {
  run("/usr/bin/hdiutil", ["detach", mountRoot]);
}
run("/usr/bin/hdiutil", ["convert", sourceDmg, "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", output]);

const bytes = await readFile(output);
const digest = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, "utf8");
const size = (await stat(output)).size;
await rm(workRoot, { recursive: true, force: true });
console.log(`Created ${output} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
