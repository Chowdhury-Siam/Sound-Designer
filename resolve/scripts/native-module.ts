// Header checks prevent shipping a Windows addon to macOS (or the wrong CPU).
// They do not prove Resolve/Electron ABI compatibility or signing validity.
export const validateNativeModule = (bytes: Buffer, platform: string, architecture: string): string[] => {
  const cpuName = (cpu: number) => cpu === 0x01000007 || cpu === 0x8664 ? "x64"
    : cpu === 0x0100000c || cpu === 0xaa64 ? "arm64" : "unsupported";
  let architectures: string[] = [];
  if (platform === "win32") {
    if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Expected a Windows PE WorkflowIntegration.node.");
    const offset = bytes.readUInt32LE(60);
    if (offset + 6 > bytes.length || bytes.toString("ascii", offset, offset + 4) !== "PE\0\0") throw new Error("Invalid Windows native module header.");
    architectures = [cpuName(bytes.readUInt16LE(offset + 4))];
  } else if (platform === "darwin") {
    if (bytes.length < 8) throw new Error("Expected a macOS Mach-O WorkflowIntegration.node.");
    const bigMagic = bytes.readUInt32BE(0);
    const littleMagic = bytes.readUInt32LE(0);
    if (bigMagic === 0xfeedfacf || littleMagic === 0xfeedfacf) {
      if (bytes.length < 32) throw new Error("Truncated macOS native module header.");
      architectures = [cpuName(bigMagic === 0xfeedfacf ? bytes.readUInt32BE(4) : bytes.readUInt32LE(4))];
    } else if ([0xcafebabe, 0xcafebabf].includes(bigMagic) || [0xcafebabe, 0xcafebabf].includes(littleMagic)) {
      const bigEndian = [0xcafebabe, 0xcafebabf].includes(bigMagic);
      const read = (offset: number) => bigEndian ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset);
      const count = read(4);
      const stride = (bigEndian ? bigMagic : littleMagic) === 0xcafebabf ? 32 : 20;
      if (count < 1 || count > 16 || bytes.length < 8 + count * stride) throw new Error("Invalid universal macOS native module header.");
      architectures = Array.from({ length: count }, (_, index) => cpuName(read(8 + index * stride)));
    } else throw new Error("Expected a macOS Mach-O WorkflowIntegration.node; Windows modules cannot be used on Mac.");
  } else throw new Error("Resolve Workflow Integration supports Windows and macOS packaging only.");
  if (!["x64", "arm64"].includes(architecture) || !architectures.includes(architecture)) {
    throw new Error(`WorkflowIntegration.node supports ${architectures.join(", ")}, not target ${architecture}. Use the addon supplied for the target Resolve runtime.`);
  }
  return architectures;
};
