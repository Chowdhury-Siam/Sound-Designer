import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { NativeResolveHost, ResolveHostError, type WorkflowIntegrationModule } from "../../src/main/services/resolveHost";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const wavFixture = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "sounddesigner-resolve-"));
  tempRoots.push(directory);
  const file = path.join(directory, "fixture.wav");
  const wave = Buffer.alloc(48);
  wave.write("RIFF", 0, "ascii");
  wave.writeUInt32LE(40, 4);
  wave.write("WAVEfmt ", 8, "ascii");
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(48_000, 24);
  wave.writeUInt32LE(96_000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36, "ascii");
  wave.writeUInt32LE(4, 40);
  await writeFile(file, wave);
  return file;
};

const createMock = (synchronous = false) => {
  let initialized = false;
  const workflowCalls: string[] = [];
  let projectId = "project-1";
  let onBinCreate: (() => void) | null = null;
  let currentFolder: any;
  let trackCount = 2;
  let currentPage = "edit";
  const importedClips: any[] = [];
  const rootClips: any[] = [];
  const movedClips: any[] = [];
  const appendCalls: any[] = [];
  let folderSelections = 0;
  let clipIdLookups = 0;
  let contextDetailReads = 0;
  let timelineId = "timeline-1";
  const videoItems = [{ GetStart: async () => 86424, GetEnd: async () => 86472, GetName: async () => "Logo slide" }];
  const trackItems: Record<number, any[]> = {
    1: [{ GetStart: async () => 0, GetEnd: async () => 99999, GetMediaPoolItem: async () => null }],
    2: [],
  };
  let bin: any = null;
  const rootFolder = {
    GetClipList: async () => rootClips,
    GetSubFolderList: async () => bin ? [bin] : [],
  };
  const makeClip = (filePath: string, id = `clip-${importedClips.length + 1}`) => ({
    clipName: path.basename(filePath),
    GetUniqueId: async () => { clipIdLookups++; return id; },
    SetName: async function (value: string) { this.clipName = value; return true; },
    GetClipProperty: async (name?: string) => {
      if (name === "File Path") return filePath;
      if (name === "Duration") return "00:00:04:04";
      if (name === undefined) return { "File Path": filePath, Duration: "00:00:04:04" };
      return "";
    },
  });
  const mediaPool = {
    GetRootFolder: async () => rootFolder,
    AddSubFolder: async (_root: unknown, name: string) => {
      bin = {
        GetName: async () => name,
        GetUniqueId: async () => "bin-1",
        GetClipList: async () => importedClips,
        GetSubFolderList: async () => [],
      };
      onBinCreate?.();
      return bin;
    },
    GetCurrentFolder: async () => currentFolder,
    SetCurrentFolder: async (folder: unknown) => { folderSelections++; currentFolder = folder; return true; },
    ImportMedia: async ([filePath]: string[]) => {
      const clip = makeClip(filePath);
      importedClips.push(clip);
      return [clip];
    },
    MoveClips: async (clips: any[]) => {
      movedClips.push(...clips);
      for (const clip of clips) {
        const index = rootClips.indexOf(clip);
        if (index >= 0) rootClips.splice(index, 1);
      }
      importedClips.push(...clips);
      return true;
    },
    AppendToTimeline: async (entries: any[]) => {
      appendCalls.push(entries);
      const entry = entries[0];
      const timelineItem = {
        GetStart: async () => entry.recordFrame,
        GetEnd: async () => entry.recordFrame + 100,
        GetMediaPoolItem: async () => entry.mediaPoolItem,
      };
      trackItems[entry.trackIndex] ??= [];
      trackItems[entry.trackIndex].push(timelineItem);
      return [timelineItem];
    },
  };
  currentFolder = rootFolder;
  const timeline = {
    GetUniqueId: async () => timelineId,
    GetName: async () => { contextDetailReads++; return "Timeline 1"; },
    GetCurrentTimecode: async () => { contextDetailReads++; return "01:00:00:00"; },
    GetTrackCount: async (type: string) => type === "video" ? 1 : trackCount,
    GetIsTrackEnabled: async () => true,
    GetIsTrackLocked: async () => false,
    GetTrackSubType: async (_type: string, index: number) => index === 1 ? "mono" : "stereo",
    GetItemListInTrack: async (type: string, index: number) => type === "video" ? index === 1 ? videoItems : [] : trackItems[index] || [],
    GetCurrentVideoItem: async () => videoItems[0],
    GetStartFrame: async () => 86400,
    GetMarkers: async () => ({ 96: { name: "Big whoosh", note: "transition", duration: 1 } }),
    AddTrack: async () => {
      trackCount += 1;
      trackItems[trackCount] = [];
      return true;
    },
    GetSetting: async () => "24",
  };
  const project = {
    GetUniqueId: async () => projectId,
    GetName: async () => { contextDetailReads++; return "Test Project"; },
    GetCurrentTimeline: async () => timeline,
    GetMediaPool: async () => mediaPool,
    InsertAudioToCurrentTrackAtPlayhead: async (filePath: string) => {
      const clip = importedClips.find(async (item) => await item.GetClipProperty("File Path") === filePath) || makeClip(filePath, "fairlight-clip");
      trackItems[2].push({
        GetStart: async () => 86400,
        GetEnd: async () => 86402,
        GetMediaPoolItem: async () => clip,
      });
      return true;
    },
  };
  const resolve = {
    GetProjectManager: async () => ({ GetCurrentProject: async () => project }),
    GetCurrentPage: async () => { contextDetailReads++; return currentPage; },
  };
  const workflow: WorkflowIntegrationModule = {
    InitializePromise: async () => {
      workflowCalls.push("initialize");
      initialized = true;
      return true;
    },
    SetAPITimeout: () => {
      workflowCalls.push("timeout");
      if (!initialized) throw new Error("SetAPITimeout called before initialization");
      return true;
    },
    GetResolvePromise: async () => {
      workflowCalls.push("resolve");
      return resolve;
    },
    CleanUp: () => true,
  };
  if (synchronous) {
    workflow.Initialize = () => {
      workflowCalls.push("initialize");
      initialized = true;
      return true;
    };
    workflow.GetResolve = () => {
      workflowCalls.push("resolve");
      return resolve;
    };
    delete workflow.InitializePromise;
    delete workflow.GetResolvePromise;
  }
  return {
    workflow,
    mediaPool,
    appendCalls,
    importedClips,
    movedClips,
    trackItems,
    workflowCalls,
    getCurrentFolder: () => currentFolder,
    getFolderSelections: () => folderSelections,
    getClipIdLookups: () => clipIdLookups,
    getContextDetailReads: () => contextDetailReads,
    setProjectId: (value: string) => { projectId = value; },
    setTimelineId: (value: string) => { timelineId = value; },
    setOnBinCreate: (callback: () => void) => { onBinCreate = callback; },
    setCurrentPage: (value: string) => { currentPage = value; },
    addRootClip: (filePath: string) => rootClips.push(makeClip(filePath, "misplaced-clip")),
  };
};

describe("Resolve host adapter", () => {
  test("imports and inserts with a native module that only exposes synchronous APIs", async () => {
    const mock = createMock(true);
    const file = await wavFixture();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    const imported = await host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "fixture.wav" });
    expect(imported.existing).toBe(false);
    const inserted = await host.insertAtPlayhead({ preparedPath: file, displayName: "fixture.wav", channelMode: "stereo" });
    expect(inserted.timelineItemCount).toBe(1);
    expect(mock.importedClips).toHaveLength(1);
    expect(mock.workflowCalls).toEqual(["initialize", "timeout", "resolve"]);
  });

  test("initializes before configuring the native API timeout", async () => {
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    await host.getProjectContext();
    expect(mock.workflowCalls).toEqual(["initialize", "timeout", "resolve"]);
  });

  test("concurrent first requests share one native initialization", async () => {
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    await Promise.all([host.getProjectContext(), host.getProjectContext(), host.getProjectContext()]);
    expect(mock.workflowCalls).toEqual(["initialize", "timeout", "resolve"]);
  });

  test("returns plain project and timeline context", async () => {
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    expect(await host.getProjectContext()).toEqual({
      projectId: "project-1",
      projectName: "Test Project",
      timelineId: "timeline-1",
      timelineName: "Timeline 1",
      currentPage: "edit",
      playheadTimecode: "01:00:00:00",
    });
  });

  test("creates one exact bin, imports once, and restores the current folder", async () => {
    const file = await wavFixture();
    const mock = createMock();
    const originalFolder = mock.getCurrentFolder();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    expect((await host.ensureSoundDesignerBin()).name).toBe("SoundDesigner");
    expect((await host.ensureSoundDesignerBin()).id).toBe("bin-1");
    const first = await host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "fixture.wav" });
    const second = await host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "fixture.wav" });
    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(mock.importedClips).toHaveLength(1);
    expect(mock.getCurrentFolder()).toBe(originalFolder);
  });

  test("inserts audio-only at the absolute playhead frame on an available track", async () => {
    const file = await wavFixture();
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    const result = await host.insertAtPlayhead({ preparedPath: file, displayName: "Clean name", channelMode: "stereo" });
    expect(result).toEqual({ trackIndex: 2, recordFrame: 86400, timelineItemCount: 1, target: "timeline-track" });
    expect(mock.appendCalls[0][0]).toMatchObject({ mediaType: 2, trackIndex: 2, recordFrame: 86400 });
    expect(mock.importedClips[0].clipName).toBe("Clean name");
  });

  test("moves a dropped clip into SoundDesigner instead of importing a duplicate", async () => {
    const file = await wavFixture();
    const mock = createMock();
    mock.addRootClip(file);
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    const result = await host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "Clean name" });
    expect(result).toEqual({ mediaPoolItemId: "misplaced-clip", existing: true });
    expect(mock.movedClips).toHaveLength(1);
    expect(mock.importedClips).toHaveLength(1);
    expect(mock.importedClips[0].clipName).toBe("Clean name");
  });

  test("selects SoundDesigner before a native drop", async () => {
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    expect((await host.selectSoundDesignerBin()).name).toBe("SoundDesigner");
    expect(await mock.getCurrentFolder().GetName()).toBe("SoundDesigner");
  });

  test("prepares a named native drag in one bin selection without per-clip ID queries", async () => {
    const file = await wavFixture();
    const mock = createMock();
    for (let index = 0; index < 30; index++) mock.addRootClip(path.join(path.dirname(file), `other-${index}.wav`));
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    const result = await host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "Clean sound", projectId: "project-1" }, true);
    expect(result.existing).toBe(false);
    expect(mock.getFolderSelections()).toBe(1);
    expect(mock.getClipIdLookups()).toBe(1);
    expect(await mock.getCurrentFolder().GetName()).toBe("SoundDesigner");
    expect(mock.importedClips[0].clipName).toBe("Clean sound");
    expect(mock.getContextDetailReads()).toBe(0);
    await host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "Clean sound", projectId: "project-1" }, true);
    expect(mock.importedClips).toHaveLength(1);
    expect(mock.getContextDetailReads()).toBe(0);
    await expect(host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "Clean sound", projectId: "other-project" }, true)).rejects.toThrow("project changed");
  });

  test("fast drag preflight still rejects project and timeline switches", async () => {
    const file = await wavFixture();
    for (const changed of ["project", "timeline"]) {
      const mock = createMock();
      mock.setOnBinCreate(() => {
        if (changed === "project") mock.setProjectId("project-2");
        else mock.setTimelineId("timeline-2");
      });
      const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
      await expect(host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "Clean sound", projectId: "project-1" }, true)).rejects.toThrow("project or timeline changed");
      expect(mock.getContextDetailReads()).toBe(0);
    }
    const mock = createMock();
    mock.setProjectId("");
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    await expect(host.importPreparedAudio({ path: file, sourceId: "fixture", displayName: "Clean sound" }, true)).rejects.toThrow("incomplete project context");
    expect(mock.importedClips).toHaveLength(0);
  });

  test("uses the selected Fairlight track when requested", async () => {
    const file = await wavFixture();
    const mock = createMock();
    mock.setCurrentPage("fairlight");
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    const result = await host.insertAtPlayhead({ preparedPath: file, displayName: "Clean name", channelMode: "mono", target: "fairlight-selected-track" });
    expect(result).toEqual({ trackIndex: 2, recordFrame: 86400, timelineItemCount: 1, target: "fairlight-selected-track" });
    expect(mock.appendCalls).toHaveLength(0);
  });

  test("creates a new matching track when the full clip would overlap a later item", async () => {
    const file = await wavFixture();
    const mock = createMock();
    mock.trackItems[2].push({
      GetStart: async () => 86450,
      GetEnd: async () => 86550,
      GetMediaPoolItem: async () => null,
    });
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    const result = await host.insertAtPlayhead({ preparedPath: file, displayName: "Clean name", channelMode: "stereo" });
    expect(result.trackIndex).toBe(3);
    expect(mock.appendCalls[0][0]).toMatchObject({ trackIndex: 3, recordFrame: 86400 });
  });

  test("rejects an operation after the active project changes", async () => {
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    mock.setOnBinCreate(() => mock.setProjectId("project-2"));
    await expect(host.ensureSoundDesignerBin()).rejects.toBeInstanceOf(ResolveHostError);
  });

  test("rejects prepared audio addressed to a different project", async () => {
    const file = await wavFixture();
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    await expect(host.insertAtPlayhead({ preparedPath: file, displayName: "Stale", channelMode: "stereo", projectId: "project-2" }))
      .rejects.toThrow("project changed");
    expect(mock.appendCalls).toHaveLength(0);
    expect(mock.importedClips).toHaveLength(0);
  });

  test("analyzes Resolve edit boundaries and timeline markers for SFX", async () => {
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    const analysis = await host.analyzeSfx("timeline", "detailed");
    expect(analysis.timelineId).toBe("timeline-1");
    expect(analysis.analyzedItems).toBe(1);
    expect(analysis.moments.map((moment) => moment.type)).toEqual(["slide", "whoosh"]);
    expect(analysis.moments.map((moment) => moment.frame)).toEqual([86424, 86496]);
  });

  test("places a validated SFX batch at analyzed timeline frames", async () => {
    const file = await wavFixture();
    const mock = createMock();
    const host = new NativeResolveHost(mock.workflow, "com.sound.designer.resolve");
    const result = await host.placeSfx({ timelineId: "timeline-1", placements: [{
      recordFrame: 86520,
      preparedPath: file,
      displayName: "UI click",
      sourceId: "click-1",
      channelMode: "mono",
    }] });
    expect(result.placed).toBe(1);
    expect(mock.appendCalls[0][0].recordFrame).toBe(86520);
    expect(mock.importedClips[0].clipName).toBe("SoundDesigner SFX · UI click");
  });
});
