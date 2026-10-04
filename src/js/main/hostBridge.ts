import type { HostApp, HostProjectContext, HostResult, InsertAudioRequest } from "./types";
import type { SfxAnalysis, SfxDensity, SfxPlacement, SfxPlacementResult, SfxScope } from "./sfxAssistant";
import { platform } from "../platform/client";
import type { AfterEffectsAudioDragState } from "../platform/types";

export type { AfterEffectsAudioDragState } from "../platform/types";

export const detectHost = (): HostApp => platform().host;

export const getHostProjectContext = (): Promise<HostProjectContext> => platform().project.getContext();

export const insertAudioInHost = (request: InsertAudioRequest): Promise<HostResult> => platform().handoff.insertAudio(request);

export const organizeAudioInHost = (request: InsertAudioRequest): Promise<HostResult> => platform().handoff.organizeAudio(request);

export const getAfterEffectsAudioDragState = (request: InsertAudioRequest): Promise<AfterEffectsAudioDragState> => platform().handoff.getAfterEffectsDragState(request);

export const analyzeAfterEffectsSfx = (scope: SfxScope, density: SfxDensity): Promise<SfxAnalysis> => platform().sfx.analyze(scope, density);

export const placeAfterEffectsSfx = (compositionId: number, placements: SfxPlacement[]): Promise<SfxPlacementResult> => platform().sfx.place(compositionId, placements);
