import {
  helloVoid,
  helloError,
  helloStr,
  helloNum,
  helloArrayStr,
  helloObj,
} from "../utils/samples";
export { helloError, helloStr, helloNum, helloArrayStr, helloObj, helloVoid };

type InsertAudioRequest = {
  path: string;
  name: string;
  targetAudioTrack: number;
  insertionTarget?: "playhead" | "selected-clip";
};

type HostResult = {
  ok: boolean;
  message: string;
  host: string;
  imported?: boolean;
};

type AudioDragState = {
  ok: boolean;
  host: string;
  compositionId?: number;
  layerCount: number;
  message: string;
};

type ProjectContext = {
  ok: boolean;
  host: string;
  projectPath?: string;
  projectDirectory?: string;
  projectName?: string;
  message: string;
};

/** Returns the saved project location used for project-scoped SoundDesigner media. */
export function getProjectContext(): ProjectContext {
  var projectFile: File;
  var projectName: string;
  try {
    if (!app.project) {
      return { ok: false, host: "aftereffects", message: "Open an After Effects project before downloading audio." };
    }
    if (!app.project.file) {
      return { ok: false, host: "aftereffects", message: "Save the After Effects project before downloading project audio." };
    }
    projectFile = app.project.file;
    projectName = String(projectFile.displayName || projectFile.name || "After Effects Project").replace(/\.[^.]+$/, "");
    return {
      ok: true,
      host: "aftereffects",
      projectPath: String(projectFile.fsName),
      projectDirectory: String(projectFile.parent.fsName),
      projectName: projectName,
      message: "Project storage is available.",
    };
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      message: error && error.toString ? error.toString() : "The After Effects project location could not be read.",
    };
  }
}

function normalizedFilePath(file: File): string {
  var normalized: string = String(file.fsName || "").replace(/\\/g, "/");
  if (String($.os || "").toLowerCase().indexOf("windows") >= 0) normalized = normalized.toLowerCase();
  return normalized;
}

function findFootageByPath(sourceFile: File): FootageItem | null {
  var targetPath: string = normalizedFilePath(sourceFile);
  var index: number;
  var item: Item;
  var footage: FootageItem;
  var footageFile: File | null;
  for (index = 1; index <= app.project.numItems; index += 1) {
    item = app.project.item(index);
    if (item instanceof FootageItem) {
      footage = item as FootageItem;
      try {
        footageFile = footage.mainSource.file;
        if (footageFile && normalizedFilePath(footageFile) === targetPath) return footage;
      } catch (_error) {
        // Solids and generated footage do not expose a source file.
      }
    }
  }
  return null;
}

function findOrCreateSoundDesignerFolder(): FolderItem {
  var index: number;
  var item: Item;
  for (index = 1; index <= app.project.numItems; index += 1) {
    item = app.project.item(index);
    if (
      item instanceof FolderItem
      && item.name === "SoundDesigner"
      && item.parentFolder.id === app.project.rootFolder.id
    ) {
      return item as FolderItem;
    }
  }
  return app.project.items.addFolder("SoundDesigner");
}

function isInsideFolder(item: Item, folder: FolderItem): boolean {
  var parent: FolderItem = item.parentFolder;
  while (parent) {
    if (parent.id === folder.id) return true;
    if (parent.id === app.project.rootFolder.id) return false;
    parent = parent.parentFolder;
  }
  return false;
}

function moveAllFootageToSoundDesigner(sourceFile: File): number {
  var targetPath: string = normalizedFilePath(sourceFile);
  var matches: FootageItem[] = [];
  var targetFolder: FolderItem;
  var index: number;
  var item: Item;
  var footageFile: File | null;
  var moved: number = 0;
  for (index = 1; index <= app.project.numItems; index += 1) {
    item = app.project.item(index);
    if (!(item instanceof FootageItem)) continue;
    try {
      footageFile = (item as FootageItem).mainSource.file;
      if (footageFile && normalizedFilePath(footageFile) === targetPath) matches.push(item as FootageItem);
    } catch (_error) {
      // Solids and generated footage do not expose a source file.
    }
  }
  if (!matches.length) return 0;
  targetFolder = findOrCreateSoundDesignerFolder();
  for (index = 0; index < matches.length; index += 1) {
    if (!isInsideFolder(matches[index], targetFolder)) {
      matches[index].parentFolder = targetFolder;
      moved += 1;
    }
  }
  return moved;
}

function countCompositionLayersByPath(composition: CompItem, sourceFile: File): number {
  var targetPath: string = normalizedFilePath(sourceFile);
  var count: number = 0;
  var index: number;
  var layer: Layer;
  var source: AVItem | null;
  var footageFile: File | null;
  for (index = 1; index <= composition.numLayers; index += 1) {
    layer = composition.layer(index);
    if (!(layer instanceof AVLayer)) continue;
    source = (layer as AVLayer).source;
    if (!(source instanceof FootageItem)) continue;
    try {
      footageFile = (source as FootageItem).mainSource.file;
      if (footageFile && normalizedFilePath(footageFile) === targetPath) count += 1;
    } catch (_error) {
      // Solids and generated footage do not expose a source file.
    }
  }
  return count;
}

/** Snapshot used to de-duplicate native CEP drops and the AE insertion fallback. */
export function getAudioDragState(request: InsertAudioRequest): AudioDragState {
  var sourceFile: File;
  var composition: CompItem;
  try {
    if (!request || typeof request.path !== "string" || request.path.length === 0) {
      return { ok: false, host: "aftereffects", layerCount: 0, message: "No audio file path was provided." };
    }
    sourceFile = new File(request.path);
    if (!sourceFile.exists) {
      return { ok: false, host: "aftereffects", layerCount: 0, message: "The selected audio file no longer exists." };
    }
    if (!app.project || !(app.project.activeItem instanceof CompItem)) {
      return { ok: false, host: "aftereffects", layerCount: 0, message: "Activate a composition before dragging audio." };
    }
    composition = app.project.activeItem as CompItem;
    return {
      ok: true,
      host: "aftereffects",
      compositionId: Number(composition.id),
      layerCount: countCompositionLayersByPath(composition, sourceFile),
      message: "After Effects composition is ready for audio drop.",
    };
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      layerCount: 0,
      message: error && error.toString ? error.toString() : "Could not inspect the active composition.",
    };
  }
}

/** Moves host-imported audio into the shared SoundDesigner Project-panel folder. */
export function organizeAudioMedia(request: InsertAudioRequest): HostResult {
  var sourceFile: File;
  var footage: FootageItem | null;
  var moved: boolean;
  var undoOpen: boolean = false;
  try {
    if (!request || typeof request.path !== "string" || request.path.length === 0) {
      return { ok: false, host: "aftereffects", message: "No audio file path was provided." };
    }
    sourceFile = new File(request.path);
    if (!app.project) {
      return { ok: false, host: "aftereffects", message: "Open an After Effects project before organizing audio." };
    }
    footage = findFootageByPath(sourceFile);
    if (!footage) {
      return { ok: false, host: "aftereffects", message: "The audio project item is not available yet." };
    }
    app.beginUndoGroup("SoundDesigner: Organize Audio");
    undoOpen = true;
    moved = moveAllFootageToSoundDesigner(sourceFile) > 0;
    return {
      ok: true,
      host: "aftereffects",
      imported: false,
      message: moved ? "Audio moved into the SoundDesigner folder." : "Audio is already in the SoundDesigner folder.",
    };
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      message: error && error.toString ? error.toString() : "Could not organize the After Effects project item.",
    };
  } finally {
    if (undoOpen) app.endUndoGroup();
  }
}

/**
 * After Effects host adapter. This TypeScript is compiled to ES3 before CEP loads it.
 * The public function accepts and returns plain JSON-compatible objects only.
 */
export function insertAudioClip(request: InsertAudioRequest): HostResult {
  var sourceFile: File;
  var composition: CompItem;
  var footage: FootageItem | null;
  var imported: boolean = false;
  var layer: AVLayer;
  var importOptions: ImportOptions;
  var undoOpen: boolean = false;
  var insertionTime: number;
  var selectedLayers: Layer[];
  var selectedIndex: number;

  try {
    if (!request || typeof request.path !== "string" || request.path.length === 0) {
      return { ok: false, host: "aftereffects", message: "No audio file path was provided." };
    }
    sourceFile = new File(request.path);
    if (!sourceFile.exists) {
      return { ok: false, host: "aftereffects", message: "The selected audio file no longer exists." };
    }
    if (!app.project) {
      return { ok: false, host: "aftereffects", message: "Open an After Effects project before inserting audio." };
    }
    if (!(app.project.activeItem instanceof CompItem)) {
      return { ok: false, host: "aftereffects", message: "Activate a composition before inserting audio." };
    }
    composition = app.project.activeItem as CompItem;
    insertionTime = composition.time;
    if (request.insertionTarget === "selected-clip") {
      selectedLayers = composition.selectedLayers;
      if (!selectedLayers || selectedLayers.length === 0) {
        return { ok: false, host: "aftereffects", message: "Select a composition layer before inserting at the selected layer." };
      }
      insertionTime = Number(selectedLayers[0].inPoint);
      for (selectedIndex = 1; selectedIndex < selectedLayers.length; selectedIndex += 1) {
        if (Number(selectedLayers[selectedIndex].inPoint) < insertionTime) {
          insertionTime = Number(selectedLayers[selectedIndex].inPoint);
        }
      }
    }

    app.beginUndoGroup("SoundDesigner: Insert Audio");
    undoOpen = true;
    footage = findFootageByPath(sourceFile);
    if (!footage) {
      importOptions = new ImportOptions(sourceFile);
      footage = app.project.importFile(importOptions) as FootageItem;
      imported = true;
    }
    if (!footage) {
      throw new Error("After Effects did not return imported footage.");
    }
    moveAllFootageToSoundDesigner(sourceFile);
    layer = composition.layers.add(footage);
    layer.startTime = insertionTime;
    return {
      ok: true,
      host: "aftereffects",
      imported: imported,
      message: (request.name || sourceFile.displayName) + (request.insertionTarget === "selected-clip" ? " added at the selected layer start." : " added at composition time."),
    };
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      message: error && error.toString ? error.toString() : "Unknown After Effects error.",
    };
  } finally {
    if (undoOpen) app.endUndoGroup();
  }
}

type SfxMoment = {
  time: number;
  duration: number;
  intensity: number;
  type: "click" | "slide" | "whoosh";
  layer: string;
  reason: string;
};

type SfxAnalysis = {
  ok: boolean;
  message: string;
  compositionId: number;
  compositionName: string;
  frameDuration: number;
  analyzedLayers: number;
  moments: SfxMoment[];
};

type SfxPlacement = {
  time: number;
  path: string;
  name: string;
  peakOffset: number;
  gainDb: number;
};

type SfxPlacementResult = { ok: boolean; message: string; placed: number };

function sfxProperty(layer: Layer, matchName: string): Property | null {
  try {
    var transform = layer.property("ADBE Transform Group");
    return transform ? transform.property(matchName) as Property : null;
  } catch (_error) { return null; }
}

function sfxDistance(first: any, second: any): number {
  var total = 0;
  var i: number;
  var difference: number;
  if (first instanceof Array && second instanceof Array) {
    for (i = 0; i < first.length && i < second.length; i += 1) {
      difference = Number(first[i]) - Number(second[i]);
      total += difference * difference;
    }
    return Math.sqrt(total);
  }
  return Math.abs(Number(first) - Number(second));
}

function sfxPropertyDelta(property: Property | null, start: number, end: number): number {
  if (!property) return 0;
  try { return sfxDistance(property.valueAtTime(start, false), property.valueAtTime(end, false)); }
  catch (_error) { return 0; }
}

/** Reads animation without modifying the composition. Comp, work area and selected layers are supported. */
export function analyzeSfxMoments(options: { scope: "selected" | "comp" | "workarea"; density: "sparse" | "balanced" | "detailed" }): SfxAnalysis {
  var empty: SfxAnalysis = { ok: false, message: "Activate an After Effects composition.", compositionId: 0, compositionName: "", frameDuration: 0, analyzedLayers: 0, moments: [] };
  var composition: CompItem;
  var layers: Layer[];
  var layer: Layer;
  var position: Property | null;
  var scale: Property | null;
  var opacity: Property | null;
  var rotation: Property | null;
  var props: (Property | null)[];
  var times: number[];
  var moments: SfxMoment[] = [];
  var candidates: SfxMoment[] = [];
  var rangeStart: number;
  var rangeEnd: number;
  var gap: number;
  var minimum: number;
  var i: number;
  var p: number;
  var k: number;
  var n: number;
  var start: number;
  var end: number;
  var duration: number;
  var positionDelta: number;
  var scaleDelta: number;
  var opacityDelta: number;
  var rotationDelta: number;
  var strength: number;
  var type: "click" | "slide" | "whoosh";
  var isText: boolean;
  if (!app.project || !(app.project.activeItem instanceof CompItem)) return empty;
  composition = app.project.activeItem as CompItem;
  if (options && options.scope === "selected") {
    layers = composition.selectedLayers;
    if (!layers.length) { empty.message = "Select animated layers before analyzing."; return empty; }
  } else {
    layers = [];
    for (i = 1; i <= composition.numLayers; i += 1) layers.push(composition.layer(i));
  }
  if (layers.length > 300) { empty.message = "Select up to 300 layers for analysis."; return empty; }
  rangeStart = options && options.scope === "workarea" ? composition.workAreaStart : 0;
  rangeEnd = options && options.scope === "workarea" ? rangeStart + composition.workAreaDuration : composition.duration;
  gap = Math.max(composition.frameDuration * (options && options.density === "detailed" ? 3 : options && options.density === "sparse" ? 10 : 6), 0.035);
  minimum = options && options.density === "detailed" ? 0.025 : options && options.density === "sparse" ? 0.075 : 0.045;
  for (i = 0; i < layers.length; i += 1) {
    layer = layers[i];
    if (!layer || layer.nullLayer || String(layer.name).indexOf("SoundDesigner SFX") === 0) continue;
    if (layer instanceof AVLayer && layer.hasAudio && !layer.hasVideo) continue;
    position = sfxProperty(layer, "ADBE Position");
    scale = sfxProperty(layer, "ADBE Scale");
    opacity = sfxProperty(layer, "ADBE Opacity");
    rotation = sfxProperty(layer, "ADBE Rotate Z");
    props = [position, sfxProperty(layer, "ADBE Position_0"), sfxProperty(layer, "ADBE Position_1"), scale, opacity, rotation];
    times = [];
    for (p = 0; p < props.length; p += 1) {
      if (!props[p] || props[p]!.numKeys < 2) continue;
      if (props[p]!.numKeys > 2000) continue;
      for (k = 1; k <= props[p]!.numKeys; k += 1) {
        start = props[p]!.keyTime(k);
        if (start >= rangeStart && start <= rangeEnd && start >= layer.inPoint && start <= layer.outPoint) times.push(start);
      }
    }
    times.sort(function (a, b) { return a - b; });
    isText = false;
    try { isText = Boolean(layer.property("ADBE Text Properties")); } catch (_error) {}
    for (n = 1; n < times.length; n += 1) {
      start = times[n - 1];
      end = times[n];
      duration = end - start;
      if (duration < composition.frameDuration * 0.5 || duration > 3) continue;
      positionDelta = sfxPropertyDelta(position, start, end)
        + sfxPropertyDelta(props[1], start, end) + sfxPropertyDelta(props[2], start, end);
      scaleDelta = sfxPropertyDelta(scale, start, end);
      opacityDelta = sfxPropertyDelta(opacity, start, end);
      rotationDelta = sfxPropertyDelta(rotation, start, end);
      strength = positionDelta / Math.max(1, Math.sqrt(composition.width * composition.width + composition.height * composition.height))
        + scaleDelta / 130 + opacityDelta / 150 + rotationDelta / 180;
      if (strength < minimum) continue;
      type = duration <= 0.18 || (isText && positionDelta < 25 && scaleDelta < 40) ? "click"
        : positionDelta > 10 && positionDelta / Math.max(1, composition.width) > scaleDelta / 180 ? "slide" : "whoosh";
      candidates.push({
        time: type === "click" ? end : start + duration * 0.75,
        duration: duration,
        intensity: Math.max(1, Math.min(5, Math.round(1 + strength * 7))),
        type: type,
        layer: String(layer.name),
        reason: isText ? "Text animation" : positionDelta > 10 ? "Position change" : scaleDelta > 5 ? "Scale change" : "Visual transition",
      });
    }
    // Layer boundaries catch scene cuts and UI reveals with no transform keys.
    // Full-duration backgrounds do not generate events.
    if (layer.inPoint > rangeStart + composition.frameDuration * 2 && layer.inPoint < rangeEnd - composition.frameDuration * 2) {
      candidates.push({ time: layer.inPoint, duration: 0.15, intensity: 1, type: "click", layer: String(layer.name), reason: "Layer begins" });
    }
    if (layer.outPoint > rangeStart + composition.frameDuration * 2 && layer.outPoint < rangeEnd - composition.frameDuration * 2) {
      candidates.push({ time: layer.outPoint, duration: 0.15, intensity: 1, type: "click", layer: String(layer.name), reason: "Layer ends" });
    }
  }
  candidates.sort(function (a, b) { return a.time - b.time; });
  for (i = 0; i < candidates.length; i += 1) {
    if (moments.length && candidates[i].time - moments[moments.length - 1].time < gap) {
      if (candidates[i].intensity > moments[moments.length - 1].intensity) moments[moments.length - 1] = candidates[i];
    } else moments.push(candidates[i]);
    if (moments.length >= 60) break;
  }
  return { ok: true, message: moments.length ? "Animation moments found." : "No animated moments found in this scope.",
    compositionId: composition.id, compositionName: composition.name, frameDuration: composition.frameDuration,
    analyzedLayers: layers.length, moments: moments };
}

/** Places a reviewed batch in one AE undo group; paths and timing are checked before mutation. */
export function placeSfxMoments(request: { compositionId: number; placements: SfxPlacement[] }): SfxPlacementResult {
  var composition: CompItem;
  var i: number;
  var item: SfxPlacement;
  var files: File[] = [];
  var footage: FootageItem | null;
  var layer: AVLayer;
  var audioLevels: Property | null;
  var imported: ImportOptions;
  var offset: number;
  var gain: number;
  var count: number = 0;
  var undoOpen: boolean = false;
  if (!app.project || !(app.project.activeItem instanceof CompItem)) return { ok: false, message: "Activate the analyzed composition.", placed: 0 };
  composition = app.project.activeItem as CompItem;
  if (!request || composition.id !== Number(request.compositionId)) return { ok: false, message: "The active composition changed. Analyze again before adding SFX.", placed: 0 };
  if (!request.placements || !request.placements.length || request.placements.length > 60) return { ok: false, message: "Choose between 1 and 60 sound placements.", placed: 0 };
  for (i = 0; i < request.placements.length; i += 1) {
    item = request.placements[i];
    if (!item || typeof item.path !== "string" || !isFinite(Number(item.time)) || Number(item.time) < 0 || Number(item.time) > composition.duration
      || !isFinite(Number(item.peakOffset)) || !isFinite(Number(item.gainDb))) return { ok: false, message: "A sound or placement time is invalid.", placed: 0 };
    files[i] = new File(item.path);
    if (!files[i].exists) return { ok: false, message: "An SFX source file is missing: " + item.path, placed: 0 };
  }
  try {
    app.beginUndoGroup("SoundDesigner: Add SFX");
    undoOpen = true;
    for (i = 0; i < request.placements.length; i += 1) {
      item = request.placements[i];
      footage = findFootageByPath(files[i]);
      if (!footage) {
        imported = new ImportOptions(files[i]);
        footage = app.project.importFile(imported) as FootageItem;
      }
      if (!footage) throw new Error("After Effects could not import " + files[i].displayName);
      moveAllFootageToSoundDesigner(files[i]);
      layer = composition.layers.add(footage);
      layer.name = "SoundDesigner SFX · " + String(item.name || files[i].displayName);
      offset = Math.max(0, Math.min(Number(item.peakOffset), Math.max(0, Number(footage.duration) - composition.frameDuration)));
      layer.startTime = Number(item.time) - offset;
      if (layer.startTime < 0) layer.inPoint = 0;
      gain = Math.max(-48, Math.min(12, Number(item.gainDb)));
      try {
        var audioGroup = layer.property("ADBE Audio Group");
        audioLevels = audioGroup ? audioGroup.property("ADBE Audio Levels") as Property : null;
        if (audioLevels) audioLevels.setValue([gain, gain]);
      } catch (_error) {}
      count += 1;
    }
    return { ok: true, message: "Added " + count + " SFX layers.", placed: count };
  } catch (error) {
    return { ok: false, message: "Added " + count + " of " + request.placements.length + ". Undo once to remove this batch. " + (error && error.toString ? error.toString() : "Unknown AE error."), placed: count };
  } finally {
    if (undoOpen) app.endUndoGroup();
  }
}
