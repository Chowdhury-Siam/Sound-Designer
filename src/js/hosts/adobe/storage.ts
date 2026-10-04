import { crypto, fs, path } from "../../lib/cep/node";
import { nativePathKey } from "../../platform/nativePaths";
import { normalizeDialogPath } from "../../main/library";
import type { HostProjectContext } from "../../main/types";
import type { PlatformPortablePreferences, PlatformStorageInfo } from "../../platform/types";

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
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly pointerDirectory: string, private readonly defaultRoot: string) {}

  get info(): PlatformStorageInfo {
    if (!this.root) throw new Error("SoundDesigner storage has not been selected.");
    return { root: this.root, manifestPath: path.join(this.root, MANIFEST) };
  }

  async initialize(): Promise<PlatformStorageInfo> {
    const pointer = this.readJson(path.join(this.pointerDirectory, "storage-location.json"));
    if (!isObject(pointer) || typeof pointer.root !== "string" || !path.isAbsolute(pointer.root)) {
      const error = new Error("Choose a SoundDesigner storage folder before using portable storage.");
      (error as Error & { code?: string }).code = "STORAGE_NOT_CONFIGURED";
      throw error;
    }
    this.root = path.resolve(pointer.root);
    this.ensureManifest();
    return this.info;
  }

  async changeLocation(): Promise<PlatformStorageInfo | null> {
    const showDialog = window.cep.fs.showOpenDialogEx || window.cep.fs.showOpenDialog;
    const result = showDialog(false, true, "Choose or create a SoundDesigner storage folder", this.root || this.defaultRoot) as { data?: string[] };
    if (!result.data?.length) return null;
    const selected = path.resolve(normalizeDialogPath(result.data[0]));
    if (this.root && selected === this.root) return this.info;
    if (this.root) {
      const relative = path.relative(this.root, selected);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Choose a folder outside the current SoundDesigner storage folder.");
    }
    fs.mkdirSync(selected, { recursive: true });
    const entries = fs.readdirSync(selected);
    const hasManifest = fs.existsSync(path.join(selected, MANIFEST));
    if (!hasManifest && entries.length) throw new Error("Choose an empty folder or an existing SoundDesigner folder.");
    if (hasManifest && !window.confirm("Use the library, settings, and project records already stored in this folder? The current folder will remain unchanged.")) return null;
    if (this.root && !hasManifest && !window.confirm("Copy current SoundDesigner data to this folder and switch after verification? The old folder will not be deleted.")) return null;
    if (this.root && !hasManifest) this.copyTreeVerified(this.root, selected, new Set([LOCK]));
    const previous = this.root;
    this.root = selected;
    try {
      this.ensureManifest();
      fs.mkdirSync(this.pointerDirectory, { recursive: true });
      this.writeJson(path.join(this.pointerDirectory, "storage-location.json"), { version: 1, root: this.root });
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

  async saveLibrary(value: unknown): Promise<void> {
    await this.updateManifest((manifest) => { manifest.library = value; });
  }

  async getLibraryMetadata(): Promise<unknown | null> {
    return this.readManifest().libraryMetadata || null;
  }

  async saveLibraryMetadata(value: unknown): Promise<void> {
    await this.updateManifest((manifest) => { manifest.libraryMetadata = value; });
  }

  async getProjectRoot(project: HostProjectContext): Promise<string> {
    if (!project.ok || !project.projectPath || !project.projectDirectory || !project.projectName) throw new Error(project.message || "Save the Adobe project before preparing audio.");
    const projectPath = nativePathKey(path.resolve(project.projectPath), path.sep === "\\");
    const normalizedPath = path.sep === "\\" ? projectPath.replace(/\\/g, "/") : projectPath;
    const projectId = crypto.createHash("sha256").update(normalizedPath).digest("hex").slice(0, 16);
    const relativeRoot = path.join("Projects", "adobe", `${cleanName(project.projectName)}--${projectId}`);
    const projectRoot = path.join(this.info.root, relativeRoot);
    for (const directory of DIRECTORIES) fs.mkdirSync(path.join(projectRoot, directory), { recursive: true });

    const migrationId = `adobe-legacy:${projectId}`;
    const legacyRoot = path.join(project.projectDirectory, "SoundDesigner", cleanName(project.projectName));
    await this.updateManifest((manifest) => {
      if (!manifest.migrations[migrationId] && fs.existsSync(legacyRoot)) {
        const mappings: Array<[string, string]> = [
          [path.join(legacyRoot, "Freesound", "Originals"), path.join(projectRoot, "Downloads")],
          [path.join(legacyRoot, "Converted"), path.join(projectRoot, "Converted")],
          [path.join(legacyRoot, "Segments"), path.join(projectRoot, "Segments")],
          [path.join(legacyRoot, "Metadata"), path.join(projectRoot, "Metadata")],
        ];
        for (const [source, destination] of mappings) if (fs.existsSync(source)) this.copyTreeVerified(source, destination);
        manifest.migrations[migrationId] = { source: legacyRoot, destination: relativeRoot, completedAt: new Date().toISOString(), sourcePreserved: true };
      }
      manifest.projects[`adobe:${projectId}`] = { id: projectId, name: project.projectName, path: normalizedPath, root: relativeRoot, updatedAt: new Date().toISOString() };
    });
    return projectRoot;
  }

  private ensureManifest() {
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(path.join(this.root, "Backups"), { recursive: true });
    if (!fs.existsSync(this.info.manifestPath)) {
      const now = new Date().toISOString();
      this.writeJson(this.info.manifestPath, { version: 2, createdAt: now, updatedAt: now, hostPreferences: {}, projects: {}, migrations: {} });
      return;
    }
    this.readManifest();
  }

  private readManifest(): Manifest {
    try { return this.parseManifest(this.readJson(this.info.manifestPath)); }
    catch (_error) {
      const backupDirectory = path.join(this.root, "Backups");
      const backups = fs.existsSync(backupDirectory)
        ? fs.readdirSync(backupDirectory).filter((entry) => /^sounddesigner-\d+-\d+\.json$/.test(entry)).sort().reverse()
        : [];
      for (const backup of backups) {
        try {
          const recovered = this.parseManifest(this.readJson(path.join(backupDirectory, backup)));
          this.writeJson(this.info.manifestPath, recovered);
          return recovered;
        } catch (_backupError) {}
      }
      throw new Error(`The selected SoundDesigner folder has an invalid ${MANIFEST} file and no valid backup.`);
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
      const backup = path.join(this.root, "Backups", `sounddesigner-${Date.now()}-${processId()}.json`);
      fs.copyFileSync(this.info.manifestPath, backup, fs.constants.COPYFILE_EXCL);
      this.writeJson(this.info.manifestPath, manifest);
    }));
    this.writes = operation.catch(() => undefined);
    await operation;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = path.join(this.root, LOCK);
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
        if (first && Date.now() - first.mtimeMs > 30_000) {
          const second = fs.existsSync(lockPath) ? fs.statSync(lockPath) : null;
          if (second?.mtimeMs === first.mtimeMs) try { fs.unlinkSync(lockPath); } catch (_error) {}
          continue;
        }
        await pause(25 + attempt * 5);
      }
    }
    throw new Error("SoundDesigner storage is busy in another host. Try again shortly.");
  }

  private copyTreeVerified(source: string, destination: string, excluded = new Set<string>()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isDirectory()) this.copyTreeVerified(from, to, excluded);
      else {
        if (!fs.existsSync(to)) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
        const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(from)).digest("hex");
        const targetHash = crypto.createHash("sha256").update(fs.readFileSync(to)).digest("hex");
        if (sourceHash !== targetHash) throw new Error(`Storage copy verification failed for ${entry.name}.`);
      }
    }
  }

  private readJson(filePath: string): unknown {
    try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_error) { return null; }
  }

  private writeJson(filePath: string, value: unknown) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${processId()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    try { fs.renameSync(temporary, filePath); }
    catch (_error) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.renameSync(temporary, filePath);
    }
  }
}
