import type { SoundDesignerPlatform } from "./types";

let activePlatform: SoundDesignerPlatform | undefined;

export const registerPlatform = (platform: SoundDesignerPlatform): void => {
  activePlatform = platform;
};

export const platform = (): SoundDesignerPlatform => {
  if (!activePlatform) throw new Error("SoundDesigner platform adapter was not registered before UI startup.");
  return activePlatform;
};
