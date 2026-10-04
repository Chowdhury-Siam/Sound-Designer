import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { cp, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { ResolveHostError } from "./resolveHost";

type Manifest = {
  version: 2;
  createdAt: string;
  updatedAt: string;
  library?: unknown;
  preferences?: unknown;
  libraryMetadata?: unknown;
  collections?: unknown;
  hostPreferences: { adobe?: unknown; resolve?: unknown };
  projects: Record<string, unknown>;
  migrations: Record<string, unknown>;
};

export type StorageInfo = {
  root: string;
  manifestPath: string;
};

const manifestName = "sounddesigner.json";
const lockName = ".sounddesigner.lock";
const lockStaleMs = 30_000;
const lockAttempts = 60;
const copyMarkerName = ".sounddesigner-copy.json";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class StorageService {
  private selectedRoot = "";
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly pointerDirectory: string,
    private readonly defaultRoot: string,
    private readonly legacyPointerDirectory?: string,
  ) {}

  get root(): string {
    if (!this.selectedRoot) throw new ResolveHostError("STORAGE_NOT_READY", "SoundDesigner storage is not initialized.");
    return this.selectedRoot;
  }

  get info(): StorageInfo {
    return { root: this.root, manifestPath: path.join(this.root, manifestName) };
  }

  private get pointerPath(): string {
    return path.join(this.pointerDirectory, "storage-location.json");
  }

  async hasConfiguredRoot(): Promise<boolean> {
    return Boolean(await this.configuredRoot(this.pointerDirectory) || await this.configuredRoot(this.legacyPointerDirectory));
  }

  private async configuredRoot(directory?: string): Promise<string | undefined> {
    if (!directory) return undefined;
    try {
      const parsed = JSON.parse(await readFile(path.join(directory, "storage-location.json"), "utf8")) as { root?: unknown };
      return typeof parsed.root === "string" && path.isAbsolute(parsed.root) ? parsed.root : undefined;
    } catch {
      return undefined;
    }
  }

  async initialize(initialRoot?: string): Promise<StorageInfo> {
    const legacyRoot = await this.configuredRoot(this.legacyPointerDirectory);
    const configuredRoot = initialRoot || await this.configuredRoot(this.pointerDirectory) || legacyRoot;
    this.selectedRoot = path.resolve(configuredRoot || this.defaultRoot);
    await this.ensureManifest();
    if (this.legacyPointerDirectory && this.root === path.resolve(legacyRoot || this.defaultRoot) && await this.readLibrary() === undefined) {
      let legacy: unknown;
      try { legacy = JSON.parse(await readFile(path.join(this.legacyPointerDirectory, "library-index.json"), "utf8")); } catch { /* No legacy index. */ }
      if (isObject(legacy)) await this.updateManifest((manifest) => {
        if (manifest.library === undefined) {
          manifest.library = legacy;
          manifest.migrations.resolveLegacyLibrary = { source: this.legacyPointerDirectory, importedAt: new Date().toISOString() };
        }
      });
    }
    await this.savePointer();
    return this.info;
  }

  async hasManifest(directory: string): Promise<boolean> {
    return (await stat(path.join(directory, manifestName)).catch(() => null))?.isFile() === true;
  }

  async readLibrary<T>(): Promise<T | undefined> {
    return (await this.readManifest()).library as T | undefined;
  }

  async writeLibrary(value: unknown): Promise<void> {
    await this.updateManifest((manifest) => { manifest.library = value; });
  }

  async readPreferences<T>(): Promise<T | undefined> {
    return (await this.readManifest()).preferences as T | undefined;
  }

  async writePreferences(value: unknown): Promise<void> {
    await this.updateManifest((manifest) => { manifest.preferences = value; });
  }

  async readLibraryMetadata<T>(): Promise<T | undefined> {
    return (await this.readManifest()).libraryMetadata as T | undefined;
  }

  async writeLibraryMetadata(value: unknown): Promise<void> {
    await this.updateManifest((manifest) => { manifest.libraryMetadata = value; });
  }

  async changeRoot(nextRoot: string, copyCurrent: boolean): Promise<StorageInfo> {
    const resolved = path.resolve(nextRoot);
    if (!path.isAbsolute(resolved)) throw new ResolveHostError("INVALID_STORAGE_PATH", "The storage location must be an absolute folder path.");
    if (resolved === this.root) return this.info;
    const relative = path.relative(this.root, resolved);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new ResolveHostError("INVALID_STORAGE_PATH", "Choose a folder outside the current SoundDesigner storage folder.");
    }

    await this.writes;
    await mkdir(resolved, { recursive: true });
    if (copyCurrent) {
      const entries = await readdir(resolved);
      const markerPath = path.join(resolved, copyMarkerName);
      const marker = await readFile(markerPath, "utf8").then((value) => JSON.parse(value) as { source?: unknown }).catch(() => null);
      if (entries.length && marker?.source !== this.root) throw new ResolveHostError("STORAGE_FOLDER_NOT_EMPTY", "Choose an empty folder, an existing SoundDesigner folder, or the interrupted copy destination.");
      if (!marker) await this.writeJson(markerPath, { version: 1, source: this.root, startedAt: new Date().toISOString() });
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (entry.name === lockName) continue;
        await this.copyVerified(path.join(this.root, entry.name), path.join(resolved, entry.name));
      }
      await rm(markerPath, { force: true });
    }

    const previousRoot = this.selectedRoot;
    this.selectedRoot = resolved;
    try {
      await this.ensureManifest();
      await this.savePointer();
      return this.info;
    } catch (error) {
      this.selectedRoot = previousRoot;
      throw error;
    }
  }

  private async savePointer(): Promise<void> {
    await mkdir(this.pointerDirectory, { recursive: true });
    await this.writeJson(this.pointerPath, { version: 1, root: this.root });
  }

  private async ensureManifest(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, "Backups"), { recursive: true });
    const existing = await stat(this.info.manifestPath).catch(() => null);
    if (existing?.isFile()) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(await readFile(this.info.manifestPath, "utf8")) as Record<string, unknown>;
      } catch {
        await this.readManifest();
        return;
      }
      const manifest = this.parseManifest(raw);
      if (raw.version !== 2) await this.withLock(() => this.writeJson(this.info.manifestPath, manifest));
      return;
    }
    const now = new Date().toISOString();
    const manifest: Manifest = { version: 2, createdAt: now, updatedAt: now, hostPreferences: {}, projects: {}, migrations: {} };
    const legacyPath = path.join(this.pointerDirectory, "library-index.json");
    try {
      const legacy = JSON.parse(await readFile(legacyPath, "utf8"));
      if (isObject(legacy)) manifest.library = legacy;
    } catch {
      // No legacy library index to import.
    }
    await this.writeJson(this.info.manifestPath, manifest);
  }

  private async readManifest(): Promise<Manifest> {
    try {
      return this.parseManifest(JSON.parse(await readFile(this.info.manifestPath, "utf8")));
    } catch (error) {
      const backup = await this.latestBackup();
      if (backup) {
        try {
          const recovered = this.parseManifest(JSON.parse(await readFile(backup, "utf8")));
          await this.writeJson(this.info.manifestPath, recovered);
          return recovered;
        } catch {
          // Report the original invalid manifest below.
        }
      }
      throw new ResolveHostError("STORAGE_MANIFEST_INVALID", `The selected SoundDesigner folder has an invalid ${manifestName} file and no valid backup.`);
    }
  }

  private parseManifest(value: unknown): Manifest {
    if (!isObject(value) || (value.version !== 1 && value.version !== 2) || typeof value.createdAt !== "string") throw new Error("Unsupported manifest");
    return {
      ...value,
      version: 2,
      createdAt: value.createdAt,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : value.createdAt,
      hostPreferences: isObject(value.hostPreferences) ? value.hostPreferences : {},
      projects: isObject(value.projects) ? value.projects : {},
      migrations: isObject(value.migrations) ? value.migrations : {},
    } as Manifest;
  }

  private async updateManifest(change: (manifest: Manifest) => void): Promise<void> {
    const operation = this.writes.then(async () => {
      await this.withLock(async () => {
        const manifest = await this.readManifest();
        change(manifest);
        manifest.updatedAt = new Date().toISOString();
        await this.backupManifest();
        await this.writeJson(this.info.manifestPath, manifest);
      });
    });
    this.writes = operation.catch(() => undefined);
    await operation;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = path.join(this.root, lockName);
    for (let attempt = 0; attempt < lockAttempts; attempt += 1) {
      let handle;
      try {
        handle = await open(lockPath, "wx");
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
        try {
          return await operation();
        } finally {
          await handle.close();
          await rm(lockPath, { force: true });
        }
      } catch (error) {
        if (handle) await handle.close().catch(() => undefined);
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
        if (code !== "EEXIST") throw error;
        const details = await stat(lockPath).catch(() => null);
        if (details && Date.now() - details.mtimeMs > lockStaleMs) {
          const confirmation = await stat(lockPath).catch(() => null);
          if (confirmation?.mtimeMs === details.mtimeMs) await rm(lockPath, { force: true });
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 5));
      }
    }
    throw new ResolveHostError("STORAGE_LOCK_TIMEOUT", "SoundDesigner storage is busy in another host. Try again shortly.");
  }

  private async backupManifest(): Promise<void> {
    const source = this.info.manifestPath;
    if (!(await stat(source).catch(() => null))?.isFile()) return;
    const backup = path.join(this.root, "Backups", `sounddesigner-${Date.now()}-${process.pid}.json`);
    await cp(source, backup, { errorOnExist: true, force: false });
  }

  private async latestBackup(): Promise<string | null> {
    const directory = path.join(this.root, "Backups");
    const entries = await readdir(directory).catch(() => []);
    const backups = entries.filter((entry) => /^sounddesigner-\d+-\d+\.json$/.test(entry)).sort().reverse();
    return backups[0] ? path.join(directory, backups[0]) : null;
  }

  private async copyVerified(source: string, destination: string): Promise<void> {
    const sourceStat = await stat(source);
    if (sourceStat.isDirectory()) {
      await mkdir(destination, { recursive: true });
      for (const entry of await readdir(source)) await this.copyVerified(path.join(source, entry), path.join(destination, entry));
      return;
    }
    const destinationStat = await stat(destination).catch(() => null);
    if (!destinationStat) await copyFile(source, destination);
    if (await this.fileHash(source) !== await this.fileHash(destination)) {
      throw new ResolveHostError("STORAGE_COPY_INVALID", `Storage copy verification failed for ${path.basename(source)}.`);
    }
  }

  private fileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const input = createReadStream(filePath);
      input.on("error", reject);
      input.on("data", (chunk) => hash.update(chunk));
      input.on("end", () => resolve(hash.digest("hex")));
    });
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    try {
      await rename(temporaryPath, filePath);
    } catch {
      await rm(filePath, { force: true });
      await rename(temporaryPath, filePath);
    }
  }
}
