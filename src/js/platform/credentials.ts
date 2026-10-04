import type * as FileSystem from "fs";

const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : "";
const validateKey = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error("The Freesound API key is invalid.");
  }
  return value.trim();
};

// ponytail: user-private plaintext file; use an OS credential vault if encryption at rest is required.
export class FreesoundCredentialStore {
  private readonly file: string;
  constructor(private readonly fs: typeof FileSystem, private readonly directory: string) {
    this.file = `${directory}/credentials.json`;
  }

  async get(legacyKey: unknown = ""): Promise<string> {
    try {
      const document = JSON.parse(this.fs.readFileSync(this.file, "utf8"));
      if (document?.version !== 1) throw new Error("The SoundDesigner credential store is invalid.");
      return validateKey(document.freesoundApiKey);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const key = validateKey(legacyKey);
    if (!key) return "";
    await this.write(key, false);
    return this.get();
  }

  async save(value: unknown): Promise<void> {
    await this.write(validateKey(value), true);
  }

  private async write(key: string, replace: boolean): Promise<void> {
    this.fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    try {
      this.fs.writeFileSync(temporary, JSON.stringify({ version: 1, freesoundApiKey: key }), { flag: "wx", mode: 0o600 });
      if (replace) {
        for (let attempt = 0; ; attempt += 1) {
          try { this.fs.renameSync(temporary, this.file); break; }
          catch (error) {
            if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes(errorCode(error))) throw error;
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          }
        }
      }
      else {
        // Atomic first migration wins; a cleared shared key must not be resurrected.
        try { this.fs.linkSync(temporary, this.file); }
        catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
      }
    } finally {
      if (this.fs.existsSync(temporary)) this.fs.unlinkSync(temporary);
    }
  }
}
