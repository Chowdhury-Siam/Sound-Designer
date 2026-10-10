import { crypto, fs, path } from "../../lib/cep/node";
import { nativePathKey } from "../../platform/nativePaths";
import { isStorageLockOwnerAlive } from "../../platform/storageLock";
import { normalizeDialogPath } from "../../main/library";
import type { HostProjectContext } from "../../main/types";
import type { AudioStorageMode, PlatformPortablePreferences, PlatformStorageInfo } from "../../platform/types";

type Manifest = {
  version: 2;
  createdAt: string;
  updatedAt: string;
  library?: unknown;
  preferences?: PlatformPortablePreferences;
  libraryMetadata?: unknown;
  collections?: unknown;
  hostPreferences: { adobe?: unknown; resolve?: unknown };
  projects: Record<string, unknown>;
  migrations: Record<string, unknown>;
};

const MANIFEST = "sounddesigner.json";
const LOCK = ".sounddesigner.lock";
const DIRECTORIES = ["Downloads", "Converted", "Processed", "Segments", "Waveforms", "Metadata", "Temp"];
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const cleanName = (value: string) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/[. ]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 96) || "Adobe Project";
const processId = () => typeof process !== "undefined" ? process.pid : 0;

export class AdobeStorageService {
  private root = "";
  private audioStorageMode: AudioStorageMode = "project";
  private writes: Promise<void> = Promise.resolve();
  private manifestReady: Promise<void> | null = null;

  constructor(private readonly pointerDirectory: string, private readonly defaultRoot: string) {}

  get info(): PlatformStorageInfo {
    return { root: this.root, manifestPath: path.join(this.pointerDirectory, MANIFEST), audioStorageMode: this.audioStorageMode };
  }

  async initialize(): Promise<PlatformStorageInfo> {
    const pointer = this.readJson(path.join(this.pointerDirectory, "storage-location.json"));
    this.root = isObject(pointer) && typeof pointer.root === "string" && path.isAbsolute(pointer.root) ? path.resolve(pointer.root) : "";
    const audioSettings = this.readJson(path.join(this.pointerDirectory, "adobe-audio-storage.json"));
    this.audioStorageMode = isObject(audioSettings) && audioSettings.version === 2 && audioSettings.mode === "central" ? "central" : "project";
    // Share first-use migration/validation; each operation still reads current shared data.
    await (this.manifestReady ??= this.ensureManifest().catch((error) => {
      this.manifestReady = null;
      throw error;
    }));
    // v1 could infer Central from Resolve's shared pointer; reset that ambiguous default once.
    if (!isObject(audioSettings) || audioSettings.version !== 2) await this.setAudioStorageMode(this.audioStorageMode);
    return this.info;
  }

  async setAudioStorageMode(mode: AudioStorageMode): Promise<PlatformStorageInfo> {
    if (mode !== "project" && mode !== "central") throw new Error("Invalid audio storage mode.");
    if (mode === "central" && !this.root) throw new Error("Choose a central audio folder first.");
    this.writeJson(path.join(this.pointerDirectory, "adobe-audio-storage.json"), { version: 2, mode });
    this.audioStorageMode = mode;
    return this.info;
  }

  async changeLocation(): Promise<PlatformStorageInfo | null> {
    const showDialog = window.cep.fs.showOpenDialogEx || window.cep.fs.showOpenDialog;
    const result = showDialog(false, true, "Choose or create a SoundDesigner storage folder", this.root || this.defaultRoot) as { data?: string[] };
    if (!result.data?.length) return null;
    const dialogPath = normalizeDialogPath(result.data[0]);
    if (!path.isAbsolute(dialogPath)) throw new Error("The central audio folder must be an absolute path.");
    const selected = path.resolve(dialogPath);
    if (this.root && selected === this.root) return this.info;
    if (this.root) {
      const relative = path.relative(this.root, selected);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Choose a folder outside the current SoundDesigner storage folder.");
    }
    const dataRelative = path.relative(this.pointerDirectory, selected);
    if (!dataRelative || (!dataRelative.startsWith("..") && !path.isAbsolute(dataRelative))) throw new Error("Choose a folder outside SoundDesigner application data.");
    fs.mkdirSync(selected, { recursive: true });
    const entries = fs.readdirSync(selected);
    const hasManifest = fs.existsSync(path.join(selected, MANIFEST));
    if (!hasManifest && entries.length) throw new Error("Choose an empty folder or an existing SoundDesigner folder.");
    await this.writes;
    const previous = this.root;
    this.root = selected;
    try {
      if (!hasManifest) {
        const now = new Date().toISOString();
        this.writeJson(path.join(selected, MANIFEST), { version: 2, createdAt: now, updatedAt: now, hostPreferences: {}, projects: {}, migrations: {} });
      } else this.readManifest(selected, false);
      fs.mkdirSync(this.pointerDirectory, { recursive: true });
      await this.withLock(async () => this.writeJson(path.join(this.pointerDirectory, "storage-location.json"), { version: 1, root: this.root }));
      return this.info;
    } catch (error) {
      this.root = previous;
      throw error;
    }
  }

  async getPreferences(): Promise<PlatformPortablePreferences | null> {
    return this.readManifest().preferences || null;
  }

  async savePreferences(value: PlatformPortablePreferences): Promise<void> {
    await this.updateManifest((manifest) => { manifest.preferences = value; });
  }

  async getLibrary<T>(): Promise<T | null> {
    return (this.readManifest().library as T | undefined) || null;
  }

  async saveLibrary(value: unknown, expected?: string): Promise<void> {
    await this.updateManifest((manifest) => {
      if (expected !== undefined && JSON.stringify(manifest.library ?? null) !== expected) {
        throw new Error("The sound library changed in another window. Refresh it and retry this operation.");
      }
      manifest.library = value;
    });
  }

  async getLibraryMetadata(): Promise<unknown | null> {
    return this.readManifest().libraryMetadata || null;
  }

  async saveLibraryMetadata(value: unknown): Promise<void> {
    await this.updateManifest((manifest) => { manifest.libraryMetadata = value; });
  }

  async getProjectRoot(project: HostProjectContext): Promise<string> {
    if (!project.ok || !project.projectPath || !project.projectDirectory || !project.projectName) throw new Error(project.message || "Save the Adobe project before preparing audio.");
    if (this.audioStorageMode === "central" && !this.root) throw new Error("Choose a central audio folder in Settings before preparing audio.");
    const projectPath = nativePathKey(path.resolve(project.projectPath), path.sep === "\\");
    const normalizedPath = path.sep === "\\" ? projectPath.replace(/\\/g, "/") : projectPath;
    const projectId = crypto.createHash("sha256").update(normalizedPath).digest("hex").slice(0, 16);
    const projectRoot = this.audioStorageMode === "project"
      ? path.join(project.projectDirectory, "SoundDesigner", cleanName(project.projectName))
      : path.join(this.root, "Projects", "adobe", `${cleanName(project.projectName)}--${projectId}`);
    for (const directory of DIRECTORIES) {
      const relative = directory === "Downloads" && this.audioStorageMode === "project" ? path.join("Freesound", "Originals") : directory;
      fs.mkdirSync(path.join(projectRoot, relative), { recursive: true });
    }
    return projectRoot;
  }

  private async ensureManifest() {
    fs.mkdirSync(this.pointerDirectory, { recursive: true });
    fs.mkdirSync(path.join(this.pointerDirectory, "Backups"), { recursive: true });
    await this.withLock(async () => {
      if (!fs.existsSync(this.info.manifestPath)) {
        const now = new Date().toISOString();
        const previous = this.root && fs.existsSync(path.join(this.root, MANIFEST)) ? this.readManifest(this.root, false) : null;
        const manifest = previous || { version: 2, createdAt: now, updatedAt: now, hostPreferences: {}, projects: {}, migrations: {} };
        this.writeJson(this.info.manifestPath, manifest);
        return;
      }
      this.readManifest();
    });
  }

  private readManifest(directory = this.pointerDirectory, restore = true): Manifest {
    const manifestPath = path.join(directory, MANIFEST);
    try { return this.parseManifest(this.readJson(manifestPath)); }
    catch (_error) {
      const backupDirectory = path.join(directory, "Backups");
      const backups = fs.existsSync(backupDirectory)
        ? fs.readdirSync(backupDirectory).filter((entry) => /^sounddesigner-\d+-\d+\.json$/.test(entry)).sort().reverse()
        : [];
      for (const backup of backups) {
        try {
          const recovered = this.parseManifest(this.readJson(path.join(backupDirectory, backup)));
          if (restore) this.writeJson(manifestPath, recovered);
          return recovered;
        } catch (_backupError) {}
      }
      throw new Error(`SoundDesigner has an invalid manifest at ${manifestPath} and no valid backup.`);
    }
  }

  private parseManifest(parsed: unknown): Manifest {
    if (!isObject(parsed) || (parsed.version !== 1 && parsed.version !== 2) || typeof parsed.createdAt !== "string") throw new Error("Unsupported manifest");
    return {
      ...parsed,
      version: 2,
      createdAt: parsed.createdAt,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : parsed.createdAt,
      hostPreferences: isObject(parsed.hostPreferences) ? parsed.hostPreferences : {},
      projects: isObject(parsed.projects) ? parsed.projects : {},
      migrations: isObject(parsed.migrations) ? parsed.migrations : {},
    } as Manifest;
  }

  private async updateManifest(change: (manifest: Manifest) => void) {
    const operation = this.writes.then(() => this.withLock(async () => {
      const manifest = this.readManifest();
      change(manifest);
      manifest.updatedAt = new Date().toISOString();
      const backup = path.join(this.pointerDirectory, "Backups", `sounddesigner-${Date.now()}-${processId()}.json`);
      fs.copyFileSync(this.info.manifestPath, backup, fs.constants.COPYFILE_EXCL);
      this.writeJson(this.info.manifestPath, manifest);
    }));
    this.writes = operation.catch(() => undefined);
    await operation;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = path.join(this.pointerDirectory, LOCK);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      let descriptor: number | undefined;
      try {
        descriptor = fs.openSync(lockPath, "wx");
        fs.writeFileSync(descriptor, `${JSON.stringify({ pid: processId(), createdAt: new Date().toISOString(), host: "adobe" })}\n`, "utf8");
        try { return await operation(); }
        finally {
          fs.closeSync(descriptor);
          descriptor = undefined;
          try { fs.unlinkSync(lockPath); } catch (_error) {}
        }
      } catch (error) {
        if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch (_closeError) {}
        if (!error || typeof error !== "object" || !("code" in error) || String((error as { code: unknown }).code) !== "EEXIST") throw error;
        const first = fs.existsSync(lockPath) ? fs.statSync(lockPath) : null;
        let owner: string | undefined;
        try { owner = fs.readFileSync(lockPath, "utf8"); } catch (_error) {}
        if (first && owner !== undefined && Date.now() - first.mtimeMs > 30_000 && !isStorageLockOwnerAlive(owner)) {
          const second = fs.existsSync(lockPath) ? fs.statSync(lockPath) : null;
          if (second?.mtimeMs === first.mtimeMs) try { fs.unlinkSync(lockPath); } catch (_error) {}
          continue;
        }
        await pause(25 + attempt * 5);
      }
    }
    throw new Error("SoundDesigner storage is busy in another host. Try again shortly.");
  }

  private readJson(filePath: string): unknown {
    try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_error) { return null; }
  }

  private writeJson(filePath: string, value: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${processId()}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, filePath);
    } finally { try { fs.unlinkSync(temporary); } catch (_error) {} }
  }
}
