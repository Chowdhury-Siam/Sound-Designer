import { expect, test } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { FreesoundCredentialStore } from "../../../src/js/platform/credentials";

test("hosts share machine-local keys, migrate once, and preserve explicit clearing", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "sounddesigner-credentials-"));
  try {
    const adobe = new FreesoundCredentialStore(fs, directory);
    const resolve = new FreesoundCredentialStore(fs, directory);
    expect(await adobe.get()).toBe("");
    expect(fs.existsSync(path.join(directory, "credentials.json"))).toBe(false);
    expect(await resolve.get(" legacy-resolve-key ")).toBe("legacy-resolve-key");
    expect(await adobe.get("old-adobe-key")).toBe("legacy-resolve-key");
    await adobe.save("new-adobe-key");
    expect(await resolve.get()).toBe("new-adobe-key");
    await resolve.save("new-resolve-key");
    expect(await adobe.get()).toBe("new-resolve-key");
    await resolve.save("");
    expect(await adobe.get("old-adobe-key")).toBe("");
    await expect(adobe.save("a\nkey")).rejects.toThrow("invalid");
    await expect(adobe.save("a".repeat(513))).rejects.toThrow("invalid");
    await expect(adobe.save(null)).rejects.toThrow("invalid");
    expect(await resolve.get()).toBe("");
    let blocked = true;
    const transientLock = new FreesoundCredentialStore({ ...fs, renameSync: (from, to) => {
      if (blocked) { blocked = false; throw Object.assign(new Error("Locked"), { code: "EPERM" }); }
      fs.renameSync(from, to);
    } }, directory);
    await transientLock.save("retry-key");
    expect(await adobe.get()).toBe("retry-key");
    const failedWrite = new FreesoundCredentialStore({ ...fs, renameSync: () => {
      throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
    } }, directory);
    await expect(failedWrite.save("lost-key")).rejects.toThrow("Disk full");
    expect(await resolve.get()).toBe("retry-key");
    expect(fs.readdirSync(directory)).toEqual(["credentials.json"]);
    if (process.platform !== "win32") expect(fs.statSync(path.join(directory, "credentials.json")).mode & 0o777).toBe(0o600);
    fs.writeFileSync(path.join(directory, "credentials.json"), "invalid-json");
    await expect(adobe.get("legacy-key")).rejects.toThrow();
    expect(fs.readFileSync(path.join(directory, "credentials.json"), "utf8")).toBe("invalid-json");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
