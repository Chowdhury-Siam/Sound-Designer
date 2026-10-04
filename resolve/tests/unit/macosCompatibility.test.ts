import { describe, expect, test } from "bun:test";
import { nativePathKey } from "../../../src/js/platform/nativePaths";
import { validateNativeModule } from "../../scripts/native-module";

describe("macOS portability guards (simulated on any OS)", () => {
  test("keeps POSIX case/backslashes and aligns decomposed Unicode identities", () => {
    expect(nativePathKey("/Volumes/SFX/Hit\\Reverse.wav", false)).toBe("/Volumes/SFX/Hit\\Reverse.wav");
    expect(nativePathKey("/Volumes/SFX/Hit.wav", false)).not.toBe(nativePathKey("/Volumes/SFX/hit.wav", false));
    expect(nativePathKey("/Volumes/SFX/Cafe\u0301/", false)).toBe("/Volumes/SFX/Café");
    expect(nativePathKey("/", false)).toBe("/");
    expect(nativePathKey("/Volumes/SFX/Folder\\", false)).toEndWith("Folder\\");
    expect(nativePathKey("C:\\SFX\\HIT.wav", true)).toBe("c:\\sfx\\hit.wav");
  });

  const thin = (cpu: number, little = true) => {
    const bytes = Buffer.alloc(32);
    if (little) { bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(cpu, 4); }
    else { bytes.writeUInt32BE(0xfeedfacf, 0); bytes.writeUInt32BE(cpu, 4); }
    return bytes;
  };
  test("accepts Intel, Apple Silicon, and universal Mach-O headers", () => {
    expect(validateNativeModule(thin(0x01000007), "darwin", "x64")).toEqual(["x64"]);
    expect(validateNativeModule(thin(0x0100000c), "darwin", "arm64")).toEqual(["arm64"]);
    expect(validateNativeModule(thin(0x01000007, false), "darwin", "x64")).toEqual(["x64"]);
    for (const wide of [false, true]) {
      const stride = wide ? 32 : 20;
      const bytes = Buffer.alloc(8 + 2 * stride);
      bytes.writeUInt32BE(wide ? 0xcafebabf : 0xcafebabe, 0);
      bytes.writeUInt32BE(2, 4);
      bytes.writeUInt32BE(0x01000007, 8);
      bytes.writeUInt32BE(0x0100000c, 8 + stride);
      expect(validateNativeModule(bytes, "darwin", "arm64")).toEqual(["x64", "arm64"]);
      expect(validateNativeModule(bytes, "darwin", "x64")).toEqual(["x64", "arm64"]);
    }
  });

  test("rejects wrong OS, wrong CPU and truncated native inputs", () => {
    const pe = Buffer.alloc(128);
    pe.write("MZ", 0); pe.writeUInt32LE(64, 60); pe.write("PE\0\0", 64); pe.writeUInt16LE(0x8664, 68);
    expect(validateNativeModule(pe, "win32", "x64")).toEqual(["x64"]);
    expect(() => validateNativeModule(pe, "darwin", "arm64")).toThrow("Mach-O");
    expect(() => validateNativeModule(thin(0x01000007), "darwin", "arm64")).toThrow("not target arm64");
    expect(() => validateNativeModule(thin(0x0100000c), "win32", "x64")).toThrow("Windows PE");
    expect(() => validateNativeModule(Buffer.from([0xca, 0xfe, 0xba, 0xbe]), "darwin", "x64")).toThrow("Mach-O");
    expect(() => validateNativeModule(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]), "darwin", "x64")).toThrow("universal");
  });
});
