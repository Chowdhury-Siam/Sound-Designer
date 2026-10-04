import path from "node:path";
import { nativePathKey } from "../../../../src/js/platform/nativePaths";
import { open, stat } from "node:fs/promises";
import { SOUND_DESIGNER_BIN, type ImportAudioRequest, type ImportedAudio, type InsertAudioRequest, type InsertedAudio, type ResolveBin, type ResolveContext, type ResolveSfxAnalysis, type ResolveSfxDensity, type ResolveSfxKind, type ResolveSfxPlacementRequest, type ResolveSfxPlacementResult, type ResolveSfxScope } from "../../shared/types";
import { parseFrameRate, timecodeToFrames } from "../../shared/timecode";

type NativeProxy = any;

export interface WorkflowIntegrationModule {
  InitializePromise(pluginId: string): Promise<boolean>;
  GetResolvePromise(): Promise<NativeProxy> | NativeProxy;
  CleanUp(): boolean;
  SetAPITimeout?(seconds: number): boolean;
  GetInfo?(): { version?: string };
}

export interface ResolveHostAdapter {
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  getProjectContext(): Promise<ResolveContext>;
  ensureSoundDesignerBin(): Promise<ResolveBin>;
  selectSoundDesignerBin(): Promise<ResolveBin>;
  importPreparedAudio(request: ImportAudioRequest, forDrag?: boolean): Promise<ImportedAudio>;
  insertAtPlayhead(request: InsertAudioRequest): Promise<InsertedAudio>;
  analyzeSfx(scope: ResolveSfxScope, density: ResolveSfxDensity): Promise<ResolveSfxAnalysis>;
  placeSfx(request: ResolveSfxPlacementRequest): Promise<ResolveSfxPlacementResult>;
}

export class ResolveHostError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ResolveHostError";
  }
}

const normalizeNativePath = (value: string): string => {
  return nativePathKey(path.resolve(value), process.platform === "win32");
};

const clipFilePath = async (item: NativeProxy): Promise<string> => {
  const direct = await item.GetClipProperty("File Path");
  if (typeof direct === "string" && direct) return direct;
  const properties = await item.GetClipProperty();
  if (!properties || typeof properties !== "object") return "";
  const candidate = properties["File Path"] ?? properties.FilePath ?? properties.Path;
  return typeof candidate === "string" ? candidate : "";
};

const clipDurationFrames = async (item: NativeProxy, frameRate: number): Promise<number | null> => {
  const direct = await item.GetClipProperty("Duration");
  const duration = typeof direct === "string" && direct
    ? direct
    : String(((await item.GetClipProperty()) || {}).Duration || "");
  if (!duration) return null;
  try {
    return Math.max(1, timecodeToFrames(duration, frameRate));
  } catch {
    return null;
  }
};

const wavDurationSamples = async (filePath: string): Promise<number> => {
  const handle = await open(filePath, "r");
  try {
    const details = await handle.stat();
    const bytes = Buffer.alloc(Math.min(details.size, 1024 * 1024));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
      throw new ResolveHostError("INVALID_WAV", "The prepared file is not a standard PCM WAV.");
    }
    let offset = 12;
    let blockAlign = 0;
    let dataSize = 0;
    while (offset + 8 <= bytesRead) {
      const chunk = bytes.toString("ascii", offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      if (chunk === "fmt " && size >= 16 && offset + 8 + size <= bytesRead) blockAlign = bytes.readUInt16LE(offset + 20);
      if (chunk === "data") { dataSize = size; break; }
      offset += 8 + size + (size % 2);
    }
    const samples = blockAlign > 0 ? Math.floor(dataSize / blockAlign) : 0;
    if (!Number.isSafeInteger(samples) || samples < 1) throw new ResolveHostError("INVALID_WAV", "The WAV duration could not be determined for Fairlight insertion.");
    return samples;
  } finally {
    await handle.close();
  }
};

const sfxKind = (value: string, duration: number): ResolveSfxKind => {
  if (/\b(click|tap|tick|button|ui|pop|cut|hit|snap)\b/i.test(value)) return "click";
  if (/\b(slide|swipe|drag|move|push|pull)\b/i.test(value)) return "slide";
  if (/\b(whoosh|woosh|swoosh|sweep|riser|transition|wind|air)\b/i.test(value)) return "whoosh";
  return duration <= 0.35 ? "click" : duration <= 1.2 ? "slide" : "whoosh";
};

export class NativeResolveHost implements ResolveHostAdapter {
  private initialized = false;
  private resolve: NativeProxy | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly workflow: WorkflowIntegrationModule,
    private readonly pluginId: string,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized && this.resolve) return;
    const initialized = await this.workflow.InitializePromise(this.pluginId);
    if (!initialized) throw new ResolveHostError("RESOLVE_INITIALIZATION_FAILED", "Resolve rejected the Workflow Integration initialization.");
    this.workflow.SetAPITimeout?.(20);
    const resolve = await this.workflow.GetResolvePromise();
    if (!resolve) throw new ResolveHostError("RESOLVE_UNAVAILABLE", "Resolve did not provide a scripting interface.");
    this.resolve = resolve;
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    await this.mutationTail.catch(() => undefined);
    if (this.initialized) this.workflow.CleanUp();
    this.resolve = null;
    this.initialized = false;
  }

  private async getResolve(): Promise<NativeProxy> {
    await this.initialize();
    if (!this.resolve) throw new ResolveHostError("RESOLVE_UNAVAILABLE", "Resolve is not available.");
    return this.resolve;
  }

  private async projectAndTimeline(): Promise<{ resolve: NativeProxy; project: NativeProxy; timeline: NativeProxy | null }> {
    const resolve = await this.getResolve();
    const manager = await resolve.GetProjectManager();
    const project = manager ? await manager.GetCurrentProject() : null;
    if (!project) throw new ResolveHostError("NO_PROJECT", "Open a Resolve project before using SoundDesigner.");
    const timeline = await project.GetCurrentTimeline();
    return { resolve, project, timeline: timeline || null };
  }

  async getProjectContext(): Promise<ResolveContext> {
    const { resolve, project, timeline } = await this.projectAndTimeline();
    const projectId = await project.GetUniqueId();
    const projectName = await project.GetName();
    if (!projectId || !projectName) throw new ResolveHostError("INVALID_PROJECT_CONTEXT", "Resolve returned an incomplete project context.");
    const context: ResolveContext = {
      projectId: String(projectId),
      projectName: String(projectName),
      currentPage: String((await resolve.GetCurrentPage()) || ""),
    };
    if (timeline) {
      context.timelineId = String((await timeline.GetUniqueId()) || "");
      context.timelineName = String((await timeline.GetName()) || "");
      context.playheadTimecode = String((await timeline.GetCurrentTimecode()) || "");
    }
    return context;
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async assertContext(expected: ResolveContext): Promise<void> {
    const current = await this.getProjectContext();
    if (current.projectId !== expected.projectId || current.timelineId !== expected.timelineId) {
      throw new ResolveHostError("CONTEXT_CHANGED", "The active Resolve project or timeline changed during the operation.");
    }
  }

  private assertRequestedProject(requestedProjectId: string | undefined, current: ResolveContext): void {
    if (requestedProjectId && requestedProjectId !== current.projectId) {
      throw new ResolveHostError("CONTEXT_CHANGED", "The active Resolve project changed before the operation started.");
    }
  }

  private async ensureBin(project: NativeProxy): Promise<{ folder: NativeProxy; result: ResolveBin }> {
    const mediaPool = await project.GetMediaPool();
    if (!mediaPool) throw new ResolveHostError("MEDIA_POOL_UNAVAILABLE", "Resolve did not provide the Media Pool.");
    const root = await mediaPool.GetRootFolder();
    const folders = (await root.GetSubFolderList()) || [];
    for (const folder of folders) {
      if ((await folder.GetName()) === SOUND_DESIGNER_BIN) {
        return { folder, result: { id: String((await folder.GetUniqueId()) || SOUND_DESIGNER_BIN), name: SOUND_DESIGNER_BIN } };
      }
    }
    const folder = await mediaPool.AddSubFolder(root, SOUND_DESIGNER_BIN);
    if (!folder) throw new ResolveHostError("BIN_CREATE_FAILED", "Resolve could not create the SoundDesigner Media Pool bin.");
    return { folder, result: { id: String((await folder.GetUniqueId()) || SOUND_DESIGNER_BIN), name: SOUND_DESIGNER_BIN } };
  }

  async ensureSoundDesignerBin(): Promise<ResolveBin> {
    return this.enqueueMutation(async () => {
      const expected = await this.getProjectContext();
      const { project } = await this.projectAndTimeline();
      const { result } = await this.ensureBin(project);
      await this.assertContext(expected);
      return result;
    });
  }

  async selectSoundDesignerBin(): Promise<ResolveBin> {
    return this.enqueueMutation(async () => {
      const expected = await this.getProjectContext();
      const { project } = await this.projectAndTimeline();
      const mediaPool = await project.GetMediaPool();
      const { folder, result } = await this.ensureBin(project);
      if (!(await mediaPool.SetCurrentFolder(folder))) {
        throw new ResolveHostError("BIN_SELECT_FAILED", "Resolve could not select the SoundDesigner Media Pool bin.");
      }
      await this.assertContext(expected);
      return result;
    });
  }

  private async validateWavPath(filePath: string): Promise<string> {
    if (!path.isAbsolute(filePath) || path.extname(filePath).toLocaleLowerCase("en-US") !== ".wav") {
      throw new ResolveHostError("INVALID_AUDIO_PATH", "Resolve handoff requires an absolute prepared WAV path.");
    }
    const details = await stat(filePath).catch(() => null);
    if (!details?.isFile()) throw new ResolveHostError("AUDIO_NOT_FOUND", "The selected WAV no longer exists.");
    return path.resolve(filePath);
  }

  private async findClip(folder: NativeProxy, filePath: string, requestedId?: string): Promise<NativeProxy | null> {
    const normalized = normalizeNativePath(filePath);
    const clips = (await folder.GetClipList()) || [];
    for (const clip of clips) {
      if (requestedId && String((await clip.GetUniqueId()) || "") === requestedId) return clip;
      const clipPath = await clipFilePath(clip);
      if (clipPath && normalizeNativePath(clipPath) === normalized) return clip;
    }
    return null;
  }

  private async findClipInTree(folder: NativeProxy, filePath: string): Promise<NativeProxy | null> {
    const clip = await this.findClip(folder, filePath);
    if (clip) return clip;
    for (const child of (await folder.GetSubFolderList()) || []) {
      const nested = await this.findClipInTree(child, filePath);
      if (nested) return nested;
    }
    return null;
  }

  private async nameClip(item: NativeProxy, displayName: string): Promise<void> {
    if (typeof item.SetName === "function" && !(await item.SetName(displayName))) {
      throw new ResolveHostError("CLIP_RENAME_FAILED", "Resolve could not apply the audio clip name.");
    }
  }

  private async importInsideMutation(project: NativeProxy, request: ImportAudioRequest, forDrag = false): Promise<{ result: ImportedAudio; item: NativeProxy }> {
    const filePath = await this.validateWavPath(request.path);
    const mediaPool = await project.GetMediaPool();
    const currentFolder = forDrag ? null : await mediaPool.GetCurrentFolder();
    const { folder } = await this.ensureBin(project);
    try {
      if (forDrag && !(await mediaPool.SetCurrentFolder(folder))) {
        throw new ResolveHostError("BIN_SELECT_FAILED", "Resolve could not select the SoundDesigner Media Pool bin.");
      }
      const existing = await this.findClip(folder, filePath);
      if (existing) {
        await this.nameClip(existing, request.displayName);
        return { result: { mediaPoolItemId: String(await existing.GetUniqueId()), existing: true }, item: existing };
      }
      const root = await mediaPool.GetRootFolder();
      const misplaced = await this.findClipInTree(root, filePath);
      if (misplaced) {
        if (typeof mediaPool.MoveClips !== "function" || !(await mediaPool.MoveClips([misplaced], folder))) {
          throw new ResolveHostError("BIN_MOVE_FAILED", "Resolve could not move the audio into the SoundDesigner Media Pool bin.");
        }
        await this.nameClip(misplaced, request.displayName);
        return { result: { mediaPoolItemId: String(await misplaced.GetUniqueId()), existing: true }, item: misplaced };
      }
      if (!forDrag && !(await mediaPool.SetCurrentFolder(folder))) {
        throw new ResolveHostError("BIN_SELECT_FAILED", "Resolve could not select the SoundDesigner Media Pool bin.");
      }
      const imported = await mediaPool.ImportMedia([filePath]);
      const item = Array.isArray(imported) ? imported[0] : null;
      if (!item) throw new ResolveHostError("IMPORT_FAILED", `Resolve could not import ${request.displayName}.`);
      await this.nameClip(item, request.displayName);
      return { result: { mediaPoolItemId: String(await item.GetUniqueId()), existing: false }, item };
    } finally {
      if (currentFolder && !forDrag) await mediaPool.SetCurrentFolder(currentFolder);
    }
  }

  async importPreparedAudio(request: ImportAudioRequest, forDrag = false): Promise<ImportedAudio> {
    return this.enqueueMutation(async () => {
      const expected = await this.getProjectContext();
      this.assertRequestedProject(request.projectId, expected);
      const { project } = await this.projectAndTimeline();
      const { result } = await this.importInsideMutation(project, request, forDrag);
      await this.assertContext(expected);
      return result;
    });
  }

  private async chooseTrack(
    timeline: NativeProxy,
    requested: number | undefined,
    channelMode: "mono" | "stereo",
    recordFrame: number,
    durationFrames: number | null,
  ): Promise<number> {
    const count = Number(await timeline.GetTrackCount("audio")) || 0;
    const candidates = requested ? [requested] : Array.from({ length: count }, (_, index) => index + 1);
    for (const index of candidates) {
      if (index < 1 || index > count) continue;
      const enabled = await timeline.GetIsTrackEnabled("audio", index);
      const locked = await timeline.GetIsTrackLocked("audio", index);
      const subtype = String((await timeline.GetTrackSubType("audio", index)) || "").toLocaleLowerCase("en-US");
      if (!enabled || locked || subtype !== channelMode) continue;
      if (!durationFrames) continue;
      const insertEnd = recordFrame + durationFrames;
      const items = (await timeline.GetItemListInTrack("audio", index)) || [];
      let occupied = false;
      for (const timelineItem of items) {
        const start = Number(await timelineItem.GetStart());
        const end = Number(await timelineItem.GetEnd());
        if (Number.isFinite(start) && Number.isFinite(end) && start < insertEnd && recordFrame < end) {
          occupied = true;
          break;
        }
      }
      if (!occupied) return index;
    }
    if (requested) {
      throw new ResolveHostError(
        "TRACK_UNAVAILABLE",
        `Audio track ${requested} is missing, disabled, locked, occupied at the playhead, or not ${channelMode}.`,
      );
    }
    const added = await timeline.AddTrack("audio", channelMode);
    if (!added) throw new ResolveHostError("TRACK_CREATE_FAILED", "Resolve could not create an audio track.");
    return Number(await timeline.GetTrackCount("audio"));
  }

  private async confirmTimelineInsert(
    timeline: NativeProxy,
    trackIndex: number,
    mediaPoolItemId: string,
    recordFrame: number,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const items = (await timeline.GetItemListInTrack("audio", trackIndex)) || [];
      for (const timelineItem of items) {
        const start = Number(await timelineItem.GetStart());
        const mediaItem = await timelineItem.GetMediaPoolItem();
        const itemId = mediaItem ? String((await mediaItem.GetUniqueId()) || "") : "";
        if (start === recordFrame && itemId === mediaPoolItemId) return true;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  private async snapshotAudioTrackLengths(timeline: NativeProxy): Promise<number[]> {
    const count = Number(await timeline.GetTrackCount("audio")) || 0;
    const lengths = [0];
    for (let index = 1; index <= count; index += 1) {
      lengths[index] = ((await timeline.GetItemListInTrack("audio", index)) || []).length;
    }
    return lengths;
  }

  private async confirmFairlightInsert(
    timeline: NativeProxy,
    previousLengths: number[],
    filePath: string,
    recordFrame: number,
  ): Promise<number | null> {
    const normalized = normalizeNativePath(filePath);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const count = Number(await timeline.GetTrackCount("audio")) || 0;
      for (let index = 1; index <= count; index += 1) {
        const items = (await timeline.GetItemListInTrack("audio", index)) || [];
        if (items.length <= (previousLengths[index] || 0)) continue;
        for (const timelineItem of items) {
          if (Number(await timelineItem.GetStart()) !== recordFrame) continue;
          const mediaItem = await timelineItem.GetMediaPoolItem();
          if (mediaItem && normalizeNativePath(await clipFilePath(mediaItem)) === normalized) return index;
        }
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  async insertAtPlayhead(request: InsertAudioRequest): Promise<InsertedAudio> {
    return this.enqueueMutation(async () => {
      const expected = await this.getProjectContext();
      this.assertRequestedProject(request.projectId, expected);
      if (!expected.timelineId || !expected.playheadTimecode) {
        throw new ResolveHostError("NO_TIMELINE", "Open a timeline before inserting audio.");
      }
      const { project, timeline } = await this.projectAndTimeline();
      if (!timeline) throw new ResolveHostError("NO_TIMELINE", "Open a timeline before inserting audio.");
      const filePath = await this.validateWavPath(request.preparedPath);
      const mediaPool = await project.GetMediaPool();
      const { folder } = await this.ensureBin(project);
      let item = await this.findClip(folder, filePath, request.mediaPoolItemId);
      if (!item) {
        item = (await this.importInsideMutation(project, {
          path: filePath,
          sourceId: `phase0:${normalizeNativePath(filePath)}`,
          displayName: request.displayName,
        })).item;
      } else await this.nameClip(item, request.displayName);
      const frameRate = parseFrameRate(await timeline.GetSetting("timelineFrameRate"));
      const recordFrame = timecodeToFrames(expected.playheadTimecode, frameRate);
      if (
        request.target === "fairlight-selected-track"
        && expected.currentPage === "fairlight"
        && typeof project.InsertAudioToCurrentTrackAtPlayhead === "function"
      ) {
        const previousLengths = await this.snapshotAudioTrackLengths(timeline);
        const durationSamples = await wavDurationSamples(filePath).catch(() => 0);
        if (durationSamples > 0) {
          await this.assertContext(expected);
          const inserted = await project.InsertAudioToCurrentTrackAtPlayhead(filePath, 0, durationSamples);
          if (inserted) {
            const selectedTrack = await this.confirmFairlightInsert(timeline, previousLengths, filePath, recordFrame);
            if (!selectedTrack) {
              throw new ResolveHostError("INSERT_NOT_CONFIRMED", "Resolve reported a Fairlight insertion, but the WAV could not be confirmed on the selected track.");
            }
            await this.assertContext(expected);
            return { trackIndex: selectedTrack, recordFrame, timelineItemCount: 1, target: "fairlight-selected-track" };
          }
        }
      }
      const durationFrames = await clipDurationFrames(item, frameRate);
      const trackIndex = await this.chooseTrack(
        timeline,
        request.trackIndex,
        request.channelMode,
        recordFrame,
        durationFrames,
      );
      await this.assertContext(expected);
      const appended = await mediaPool.AppendToTimeline([{
        mediaPoolItem: item,
        mediaType: 2,
        trackIndex,
        recordFrame,
      }]);
      if (!Array.isArray(appended) || appended.length === 0) {
        throw new ResolveHostError("INSERT_FAILED", "Resolve did not insert the audio at the playhead.");
      }
      const itemId = String(await item.GetUniqueId());
      if (!(await this.confirmTimelineInsert(timeline, trackIndex, itemId, recordFrame))) {
        throw new ResolveHostError("INSERT_NOT_CONFIRMED", "Resolve returned an insertion result, but the WAV did not appear on the target timeline track.");
      }
      await this.assertContext(expected);
      return { trackIndex, recordFrame, timelineItemCount: appended.length, target: "timeline-track" };
    });
  }

  async analyzeSfx(scope: ResolveSfxScope, density: ResolveSfxDensity): Promise<ResolveSfxAnalysis> {
    const call = async <T>(label: string, operation: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout>;
      try {
        return await Promise.race([
          operation,
          new Promise<T>((_resolve, reject) => {
            timer = setTimeout(() => reject(new ResolveHostError("SFX_ANALYSIS_TIMEOUT", `Resolve timed out while reading ${label}.`)), 8_000);
          }),
        ]);
      } finally {
        clearTimeout(timer!);
      }
    };
    const expected = await call("the active timeline", this.getProjectContext());
    if (!expected.timelineId) throw new ResolveHostError("NO_TIMELINE", "Open a timeline before using SFX Assistant.");
    const { timeline } = await call("the project timeline", this.projectAndTimeline());
    if (!timeline) throw new ResolveHostError("NO_TIMELINE", "Open a timeline before using SFX Assistant.");
    const frameRate = parseFrameRate(await call("the timeline frame rate", timeline.GetSetting("timelineFrameRate")));
    const startFrame = Number(await call("the timeline start frame", timeline.GetStartFrame())) || 0;
    const raw: ResolveSfxAnalysis["moments"] = [];
    let analyzedItems = 0;

    const addItem = async (item: NativeProxy, label: string) => {
      if (!item || analyzedItems >= 300) return;
      const start = Number(await call("a clip start", item.GetStart()));
      const end = Number(await call("a clip end", item.GetEnd()));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      analyzedItems += 1;
      const duration = (end - start) / frameRate;
      raw.push({
        frame: Math.round(start),
        time: Math.max(0, (start - startFrame) / frameRate),
        duration,
        intensity: Math.max(0.2, Math.min(1, 1 / Math.max(0.25, duration))),
        type: sfxKind(label, duration),
        source: label,
        reason: "Video edit boundary",
      });
    };

    if (scope === "playhead") {
      const current = typeof timeline.GetCurrentVideoItem === "function" ? await call<NativeProxy>("the clip at the playhead", timeline.GetCurrentVideoItem()) : null;
      if (current) await addItem(current, String((await call("the clip name", current.GetName())) || "Current clip"));
    } else if (scope === "timeline") {
      const trackCount = Math.min(128, Number(await call("video tracks", timeline.GetTrackCount("video"))) || 0);
      for (let track = 1; track <= trackCount && analyzedItems < 300; track += 1) {
        for (const item of (await call<NativeProxy[]>(`video track ${track}`, timeline.GetItemListInTrack("video", track))) || []) {
          await addItem(item, String((await call("the clip name", item.GetName())) || `Video ${track}`));
          if (analyzedItems >= 300) break;
        }
      }
    }

    if (scope !== "playhead" && typeof timeline.GetMarkers === "function") {
      const markers = (await call("timeline markers", timeline.GetMarkers())) || {};
      for (const [offset, marker] of Object.entries(markers)) {
        const frameOffset = Number(offset);
        if (!Number.isFinite(frameOffset)) continue;
        const data = marker && typeof marker === "object" ? marker as Record<string, unknown> : {};
        const label = String(data.name || data.note || "Timeline marker");
        const duration = Math.max(1 / frameRate, Number(data.duration) / frameRate || 1 / frameRate);
        raw.push({
          frame: Math.round(startFrame + frameOffset),
          time: Math.max(0, frameOffset / frameRate),
          duration,
          intensity: 1,
          type: sfxKind(`${label} ${String(data.note || "")}`, duration),
          source: label,
          reason: "Timeline marker",
        });
      }
    }

    const spacing = Math.round(frameRate * (density === "sparse" ? 1.5 : density === "balanced" ? 0.65 : 0.25));
    const moments = raw.sort((a, b) => a.frame - b.frame).reduce<ResolveSfxAnalysis["moments"]>((items, moment) => {
      const previous = items[items.length - 1];
      if (!previous || moment.frame - previous.frame >= spacing) items.push(moment);
      else if (moment.reason === "Timeline marker" || moment.intensity > previous.intensity) items[items.length - 1] = moment;
      return items;
    }, []).slice(0, 60);
    await call("the final timeline context", this.assertContext(expected));
    return {
      timelineId: expected.timelineId,
      timelineName: expected.timelineName || "Timeline",
      frameRate,
      analyzedItems,
      moments,
    };
  }

  async placeSfx(request: ResolveSfxPlacementRequest): Promise<ResolveSfxPlacementResult> {
    return this.enqueueMutation(async () => {
      const expected = await this.getProjectContext();
      if (!expected.timelineId || expected.timelineId !== request.timelineId) {
        throw new ResolveHostError("CONTEXT_CHANGED", "The active Resolve timeline changed after SFX analysis.");
      }
      const { project, timeline } = await this.projectAndTimeline();
      if (!timeline) throw new ResolveHostError("NO_TIMELINE", "Open the analyzed timeline before adding SFX.");
      const mediaPool = await project.GetMediaPool();
      const frameRate = parseFrameRate(await timeline.GetSetting("timelineFrameRate"));
      const validatedPaths = await Promise.all(request.placements.map((placement) => this.validateWavPath(placement.preparedPath)));
      let placed = 0;
      try {
        for (let index = 0; index < request.placements.length; index += 1) {
          const placement = request.placements[index];
          const { item } = await this.importInsideMutation(project, {
            path: validatedPaths[index],
            sourceId: placement.sourceId,
            displayName: `SoundDesigner SFX · ${placement.displayName}`,
          });
          const durationFrames = await clipDurationFrames(item, frameRate);
          const trackIndex = await this.chooseTrack(timeline, undefined, placement.channelMode, placement.recordFrame, durationFrames);
          await this.assertContext(expected);
          const appended = await mediaPool.AppendToTimeline([{
            mediaPoolItem: item,
            mediaType: 2,
            trackIndex,
            recordFrame: placement.recordFrame,
          }]);
          if (!Array.isArray(appended) || !appended.length) throw new ResolveHostError("INSERT_FAILED", `Resolve could not place ${placement.displayName}.`);
          const itemId = String(await item.GetUniqueId());
          if (!(await this.confirmTimelineInsert(timeline, trackIndex, itemId, placement.recordFrame))) {
            throw new ResolveHostError("INSERT_NOT_CONFIRMED", `Resolve did not confirm ${placement.displayName} on the timeline.`);
          }
          placed += 1;
        }
      } catch (error) {
        if (placed) throw new ResolveHostError("SFX_BATCH_PARTIAL", `${placed} SFX were placed before Resolve stopped the batch. Undo those timeline changes before retrying.`);
        throw error;
      }
      await this.assertContext(expected);
      return { placed };
    });
  }
}
