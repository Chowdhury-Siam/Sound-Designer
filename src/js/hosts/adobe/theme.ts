import { applyAdobeTheme } from "../../main/theme";

const themeEvent = "com.adobe.csxs.events.ThemeColorChanged";
type ThemeHost = {
  getHostEnvironment(): unknown;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export const syncAdobeTheme = (host: ThemeHost, root = document.documentElement): (() => void) => {
  const update = () => {
    try {
      const environment = host.getHostEnvironment() as { appSkinInfo?: { panelBackgroundColor?: { color?: unknown } } } | null;
      applyAdobeTheme(environment?.appSkinInfo?.panelBackgroundColor?.color, root);
    } catch {
      // Theme metadata must never prevent startup or reset the current UI state.
    }
  };
  update();
  try { host.addEventListener(themeEvent, update); } catch { return () => undefined; }
  return () => { try { host.removeEventListener(themeEvent, update); } catch { /* The host may already be shutting down. */ } };
};
