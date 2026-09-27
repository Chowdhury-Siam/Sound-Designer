<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { LibraryFolder, LibraryTreeNode, SoundFile } from "../types";
  import type { SfxAnalysis, SfxDensity, SfxIntensity, SfxKind, SfxScope, SfxStyle } from "../sfxAssistant";
  import { rankSfxSounds, soundPeakOffset } from "../sfxAssistant";
  import { analyzeAfterEffectsSfx, placeAfterEffectsSfx } from "../hostBridge";
  import { fileUrl } from "../library";
  import { resolveCloudPreview, searchCloudLibrary } from "../cloudLibrary";

  let {
    open, sounds, folders, cloudEnabled, onClose, onStopPreview, onPrepareRemote, onNotice,
  }: {
    open: boolean;
    sounds: SoundFile[];
    folders: LibraryFolder[];
    cloudEnabled: boolean;
    onClose: () => void;
    onStopPreview: () => void;
    onPrepareRemote: (sound: SoundFile) => Promise<SoundFile>;
    onNotice: (type: "success" | "warning" | "error", message: string) => void;
  } = $props();

  let scope = $state<SfxScope>("selected");
  let density = $state<SfxDensity>("balanced");
  let style = $state<SfxStyle>("mixed");
  let intensity = $state<SfxIntensity>("medium");
  let kinds = $state<SfxKind[]>(["click", "slide", "whoosh"]);
  let offsetFrames = $state(0);
  let gainDb = $state(-8);
  let analysis = $state<SfxAnalysis | null>(null);
  let selectedIds = $state<(string | null)[]>([]);
  let disabled = $state<boolean[]>([]);
  let choicesByMoment = $state<SoundFile[][]>([]);
  let busy = $state<"analyzing" | "preparing" | "placing" | "">("");
  let error = $state("");
  let cloudNote = $state("");
  let cloudSounds = $state<SoundFile[]>([]);
  let dialog = $state<HTMLDivElement | null>(null);
  let previewAudio: HTMLAudioElement | null = null;
  let previewId = $state("");
  let availableSounds = $derived([
    ...sounds.filter(sound => sound.path && (sound.source === "local" || !sound.source)),
    ...cloudSounds,
  ]);
  let pinnedDirectories = $derived.by(() => {
    const pinned = new Set<string>();
    const visit = (node: LibraryTreeNode, inherited: boolean) => {
      const active = inherited || Boolean(node.pinned);
      if (active) pinned.add(node.id);
      node.children.forEach(child => visit(child, active));
    };
    folders.forEach(folder => visit(folder.tree, false));
    return pinned;
  });
  let approvedCount = $derived(selectedIds.filter((id, index) => id && !disabled[index] && analysis && kinds.includes(analysis.moments[index]?.type)).length);

  const toggleKind = (kind: SfxKind) => {
    kinds = kinds.includes(kind) ? kinds.filter(item => item !== kind) : [...kinds, kind];
    analysis = null;
  };

  const stopPreview = () => {
    if (previewAudio) { previewAudio.pause(); previewAudio.src = ""; previewAudio = null; }
    previewId = "";
  };

  const preview = async (sound: SoundFile) => {
    if (previewId === sound.id) { stopPreview(); return; }
    stopPreview();
    onStopPreview();
    try {
      const source = sound.path ? fileUrl(sound.path) : await resolveCloudPreview(sound);
      const player = new Audio(source);
      previewAudio = player;
      previewId = sound.id;
      player.onended = stopPreview;
      await player.play();
    }
    catch (_error) { stopPreview(); error = `Could not preview ${sound.name}.`; }
  };

  const analyze = async () => {
    if (!kinds.length || busy) return;
    busy = "analyzing";
    error = "";
    cloudNote = "";
    try {
      const result = await analyzeAfterEffectsSfx(scope, density);
      if (!result.ok) { error = result.message; analysis = null; return; }
      analysis = { ...result, moments: result.moments.filter(moment => kinds.includes(moment.type)) };
      cloudSounds = [];
      if (cloudEnabled && analysis.moments.length) {
        const types = Array.from(new Set(analysis.moments.map(moment => moment.type)));
        const searches = await Promise.allSettled(types.map(type => searchCloudLibrary(type)));
        const found = new Map<string, SoundFile>();
        searches.forEach(outcome => { if (outcome.status === "fulfilled") outcome.value.forEach(sound => found.set(sound.id, sound)); });
        cloudSounds = Array.from(found.values());
        if (searches.some(outcome => outcome.status === "rejected")) cloudNote = "Some cloud suggestions are unavailable. Local suggestions remain available.";
      }
      const used: Record<string, number> = {};
      choicesByMoment = analysis.moments.map(moment => {
        const ranked = rankSfxSounds(moment, availableSounds, used, style, pinnedDirectories, intensity);
        if (ranked[0]) used[ranked[0].id] = (used[ranked[0].id] || 0) + 1;
        return ranked;
      });
      selectedIds = choicesByMoment.map(choices => choices[0]?.id || null);
      disabled = analysis.moments.map(() => false);
      if (!analysis.moments.length) error = "No matching animation moments. Try a wider scope or more sound types.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      analysis = null;
    } finally { busy = ""; }
  };

  const add = async () => {
    if (!analysis || !approvedCount || busy) return;
    busy = "preparing";
    error = "";
    try {
      const prepared = new Map<string, SoundFile>();
      const placements = [];
      for (let index = 0; index < analysis.moments.length; index += 1) {
        const sound = availableSounds.find(item => item.id === selectedIds[index]);
        if (!sound || disabled[index]) continue;
        let ready = prepared.get(sound.id);
        if (!ready) {
          ready = sound.path ? sound : await onPrepareRemote(sound);
          if (!ready.path) throw new Error(`${sound.name} could not be prepared for After Effects.`);
          prepared.set(sound.id, ready);
        }
        placements.push({
          time: Math.max(0, analysis.moments[index].time + Number(offsetFrames || 0) * analysis.frameDuration),
          path: ready.path,
          name: ready.name,
          peakOffset: soundPeakOffset(ready),
          gainDb: Number(gainDb),
        });
      }
      busy = "placing";
      const result = await placeAfterEffectsSfx(analysis.compositionId, placements);
      if (!result.ok) throw new Error(result.message);
      onNotice("success", result.message);
      onClose();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      onNotice("error", error);
    } finally { busy = ""; }
  };

  $effect(() => {
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!busy) onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])') || []);
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    window.setTimeout(() => dialog?.querySelector<HTMLElement>("button")?.focus(), 0);
    return () => { stopPreview(); window.removeEventListener("keydown", onKey, true); previous?.focus(); };
  });
</script>

{#if open}
  <div class="sheet-scrim sfx-scrim" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div bind:this={dialog} class="bottom-sheet sfx-sheet" role="dialog" aria-modal="true" aria-label="SFX Assistant" tabindex="-1">
      <header class="sheet-header sfx-sheet-header">
        <div><strong><Icon name="sparkles" size={17} /> SFX Assistant</strong><small>Match sound to motion in the active composition</small></div>
        <button class="sfx-icon-button" type="button" aria-label="Close SFX Assistant" title="Close SFX Assistant" disabled={!!busy} onclick={onClose}><Icon name="close" size={15} /></button>
      </header>
      <div class="sheet-body sfx-sheet-body">
        <section class="sfx-options" aria-label="Analysis options">
          <label><span>Scope</span><select bind:value={scope} title="Choose which AE layers to analyze" onchange={() => analysis = null}><option value="selected">Selected layers</option><option value="comp">Entire composition</option><option value="workarea">Work area</option></select></label>
          <label><span>Density</span><select bind:value={density} title="Choose how many motion moments to detect" onchange={() => analysis = null}><option value="sparse">Sparse</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label>
          <label><span>Style</span><select bind:value={style} title="Prefer matching sound names and tags" onchange={() => analysis = null}><option value="mixed">Mixed</option><option value="clean">Clean</option><option value="organic">Organic</option><option value="digital">Digital</option></select></label>
          <label><span>Intensity</span><select bind:value={intensity} title="Prefer soft or strong sounds" onchange={() => analysis = null}><option value="soft">Soft</option><option value="medium">Medium</option><option value="strong">Strong</option></select></label>
        </section>
        <section class="sfx-types" aria-label="Sound types">
          <span class="sfx-label">Sound types</span>
          <div class="sfx-chips">
            {#each ["click", "slide", "whoosh"] as kind}
              <button class:is-active={kinds.includes(kind as SfxKind)} type="button" title={`Include ${kind} sounds`} aria-pressed={kinds.includes(kind as SfxKind)} onclick={() => toggleKind(kind as SfxKind)}>{kind}</button>
            {/each}
          </div>
        </section>
        <section class="sfx-options sfx-timing" aria-label="Placement options">
          <label><span>Offset · frames</span><input type="number" min="-120" max="120" step="1" bind:value={offsetFrames} title="Shift sound timing in frames" /></label>
          <label><span>Gain · dB</span><input type="number" min="-48" max="12" step="1" bind:value={gainDb} title="Audio gain applied to added layers" /></label>
        </section>
        <div class="sfx-analysis-heading"><span class="sfx-label">Suggestions</span>{#if analysis}<small>{analysis.moments.length} moments · {analysis.analyzedLayers} layers</small>{/if}</div>
        {#if error}<p class="sfx-error" role="alert">{error}</p>{/if}
        {#if cloudNote}<p class="sfx-cloud-note" role="status">{cloudNote}</p>{/if}
        {#if analysis?.moments.length}
          <div class="sfx-moment-list">
            {#each analysis.moments as moment, index}
              {@const choices = choicesByMoment[index] || []}
              {@const chosen = availableSounds.find(sound => sound.id === selectedIds[index])}
              <article class:disabled={disabled[index]} class="sfx-moment">
                <input aria-label={`Include suggestion at ${moment.time.toFixed(2)} seconds`} type="checkbox" checked={!disabled[index]} onchange={(event) => disabled[index] = !event.currentTarget.checked} />
                <div class="sfx-moment-main">
                  <div class="sfx-moment-title"><b>{moment.time.toFixed(2)}s</b><span>{moment.type}</span><small title={moment.reason}>{moment.layer}</small></div>
                  {#if choices.length}
                    <div class="sfx-moment-choice">
                      <select aria-label={`Sound for ${moment.type} at ${moment.time.toFixed(2)} seconds`} title="Replace suggested sound" value={selectedIds[index] || ""} onchange={(event) => selectedIds[index] = event.currentTarget.value || null}>
                        <option value="">Skip sound</option>
                        {#if chosen && !choices.some(choice => choice.id === chosen.id)}<option value={chosen.id}>{chosen.source === "scorpion" ? "☁ " : ""}{chosen.name}</option>{/if}
                        {#each choices as choice}<option value={choice.id}>{choice.source === "scorpion" ? "☁ " : ""}{choice.name}</option>{/each}
                      </select>
                      {#if chosen?.source === "scorpion"}<span class="sfx-cloud-indicator" title="Cloud sound"><Icon name="cloud" size={14} /></span>{/if}
                      <button class="sfx-icon-button" type="button" title={previewId === selectedIds[index] ? "Stop preview" : "Preview selected sound"} aria-label={`Preview sound for ${moment.type}`} disabled={!selectedIds[index]} onclick={() => { const sound = availableSounds.find(item => item.id === selectedIds[index]); if (sound) preview(sound); }}><Icon name={previewId === selectedIds[index] ? "stop" : "play"} size={14} /></button>
                    </div>
                  {:else}<small class="sfx-no-match">No indexed {moment.type} sounds. Import a matching folder or disable this moment.</small>{/if}
                </div>
              </article>
            {/each}
          </div>
        {:else if !analysis && !error}
          <p class="sfx-empty"><Icon name="waveform" size={18} /> Analyze an AE composition to preview sound placements.</p>
        {/if}
      </div>
      <footer class="sheet-footer sfx-sheet-footer">
        <button class="ghost-button" type="button" disabled={!!busy || !kinds.length} onclick={analyze}>{busy === "analyzing" ? "Analyzing…" : "Analyze"}</button>
        <button class="primary-button" type="button" disabled={!!busy || !approvedCount || !Number.isFinite(Number(gainDb)) || gainDb < -48 || gainDb > 12 || !Number.isInteger(Number(offsetFrames)) || offsetFrames < -120 || offsetFrames > 120} onclick={add}>{busy === "preparing" ? "Preparing…" : busy === "placing" ? "Adding…" : `Add ${approvedCount} SFX`}</button>
      </footer>
    </div>
  </div>
{/if}
