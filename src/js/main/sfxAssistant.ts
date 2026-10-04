import type { SoundFile } from "./types";

export type SfxKind = "click" | "slide" | "whoosh";
export type SfxScope = "selected" | "comp" | "workarea";
export type SfxDensity = "sparse" | "balanced" | "detailed";
export type SfxStyle = "mixed" | "clean" | "organic" | "digital";
export type SfxIntensity = "soft" | "medium" | "strong";

export type SfxMoment = {
  frame?: number;
  time: number;
  duration: number;
  intensity: number;
  type: SfxKind;
  layer: string;
  reason: string;
};

export type SfxAnalysis = {
  ok: boolean;
  message: string;
  compositionId: number;
  compositionName: string;
  frameDuration: number;
  analyzedLayers: number;
  moments: SfxMoment[];
};

export type SfxPlacement = {
  frame?: number;
  channels?: number;
  sourceId?: string;
  time: number;
  path: string;
  name: string;
  peakOffset: number;
  gainDb: number;
};

export type SfxPlacementResult = {
  ok: boolean;
  message: string;
  placed: number;
};

const terms: Record<SfxKind, RegExp> = {
  click: /\b(click|tap|tick|button|ui|pop|keyboard|mouse|beep|blip|snap)\b/i,
  slide: /\b(slide|swipe|swoosh|swish|drag|move|transition|whoosh)\b/i,
  whoosh: /\b(whoosh|woosh|swoosh|sweep|riser|transition|wind|air|swish)\b/i,
};

export const soundPeakOffset = (sound: SoundFile): number => {
  if (!sound.waveformReal || !sound.waveform.length || sound.duration <= 0) return 0;
  let peak = -1;
  let index = 0;
  for (let i = 0; i < sound.waveform.length; i += 1) {
    if (sound.waveform[i] > peak) { peak = sound.waveform[i]; index = i; }
  }
  return sound.duration * index / sound.waveform.length;
};

export const rankSfxSounds = (moment: SfxMoment, sounds: SoundFile[], used: Record<string, number> = {}, style: SfxStyle = "mixed", pinnedDirectories: Set<string> = new Set(), intensity: SfxIntensity = "medium"): SoundFile[] => {
  const alternatives: { sound: SoundFile; score: number }[] = [];
  for (const sound of sounds) {
    if (!sound.path && sound.source !== "scorpion") continue;
    if (sound.source === "freesound") continue;
    const name = `${sound.name} ${sound.tags.join(" ")}`;
    if (!terms[moment.type].test(name)) continue;
    const duration = Number(sound.duration) || 0;
    const desired = moment.type === "click" ? 0.22 : Math.max(0.3, Math.min(2.5, moment.duration * 1.5));
    let score = duration > 0 ? Math.abs(Math.log(Math.max(0.05, duration) / desired)) : 1.4;
    if (sound.source === "scorpion" && !sound.path) score += 0.5;
    if (moment.type === "click" && duration > 1.5) score += 2;
    if (moment.type === "whoosh" && /\b(whoosh|woosh|swoosh)\b/i.test(name)) score -= 0.6;
    if (moment.type === "slide" && /\b(slide|swipe)\b/i.test(name)) score -= 0.6;
    if (sound.favorite) score -= 0.5;
    if (pinnedDirectories.has(sound.directoryId)) score -= 0.35;
    if (sound.waveformReal) score -= 0.1;
    if (style === "clean" && /\b(clean|minimal|soft|subtle|ui)\b/i.test(name)) score -= 0.45;
    if (style === "organic" && /\b(organic|natural|paper|wood|leather|water)\b/i.test(name)) score -= 0.45;
    if (style === "digital" && /\b(digital|tech|glitch|synth|electric)\b/i.test(name)) score -= 0.45;
    if (intensity === "soft" && /\b(soft|subtle|light|gentle|quiet)\b/i.test(name)) score -= 0.45;
    if (intensity === "strong" && /\b(big|strong|heavy|hard|massive|powerful)\b/i.test(name)) score -= 0.45;
    score += Math.min(2, (used[sound.id] || 0) * 0.45);
    alternatives.push({ sound, score });
  }
  alternatives.sort((a, b) => a.score - b.score || a.sound.name.localeCompare(b.sound.name));
  return alternatives.slice(0, 12).map(item => item.sound);
};

export const suggestSfx = (moments: SfxMoment[], sounds: SoundFile[], style: SfxStyle = "mixed", pinnedDirectories: Set<string> = new Set(), intensity: SfxIntensity = "medium") => {
  const used: Record<string, number> = {};
  return moments.map(moment => {
    const match = rankSfxSounds(moment, sounds, used, style, pinnedDirectories, intensity)[0] || null;
    if (match) used[match.id] = (used[match.id] || 0) + 1;
    return match;
  });
};
