import type { PlatformMode } from "../platform/types";

const themeProperties = ["--bg-0", "--bg-1", "--bg-2", "--bg-3", "--bg-4", "--text-1", "--text-2", "--text-muted", "--label-tint", "--accent-strong", "color-scheme"];

export const applyHostTheme = (mode: PlatformMode, root = document.documentElement): void => {
  root.dataset.hostTheme = mode === "resolve" ? "resolve" : "adobe";
  delete root.dataset.themeAppearance;
  for (const property of themeProperties) root.style.removeProperty(property);
};

const luminance = (gray: number) => {
  const value = gray / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminanceContrast = (first: number, second: number) =>
  (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
const contrast = (first: number, second: number) => luminanceContrast(luminance(first), luminance(second));
const grayColor = (value: number) => `rgb(${value}, ${value}, ${value})`;

export const adobeThemeProperties = (color: unknown): Record<string, string> | null => {
  if (!color || typeof color !== "object") return null;
  const { red, green, blue } = color as { red?: unknown; green?: unknown; blue?: unknown };
  const channels = [red, green, blue];
  if (!channels.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 255)) return null;
  // Keep host brightness while neutralizing any tint outside the approved palette.
  const base = Math.round(Number(red) * 0.2126 + Number(green) * 0.7152 + Number(blue) * 0.0722);
  const dark = base < 118;
  const surfaces = [0, 7, 12, 20, 46].map(offset => dark ? Math.min(117, base + offset) : Math.max(118, base - offset));
  const background = dark ? Math.max(...surfaces) : Math.min(...surfaces);
  const foreground = (initial: number) => {
    let value = initial;
    while (contrast(value, background) < 4.5 && value > 0 && value < 255) value += dark ? 1 : -1;
    return grayColor(value);
  };
  const accent = dark ? [144, 200, 255] : [0, 48, 95];
  const accentLuminance = luminance(accent[0]) * 0.2126 + luminance(accent[1]) * 0.7152 + luminance(accent[2]) * 0.0722;
  return {
    ...Object.fromEntries(surfaces.map((value, index) => [`--bg-${index}`, grayColor(value)])),
    "--text-1": foreground(dark ? 229 : 29),
    "--text-2": foreground(dark ? 184 : 64),
    "--text-muted": foreground(dark ? 156 : 96),
    "--label-tint": foreground(dark ? 156 : 96),
    "--accent-strong": luminanceContrast(accentLuminance, luminance(background)) >= 4.5
      ? (dark ? "#90c8ff" : "#00305f") : foreground(dark ? 255 : 0),
    "color-scheme": dark ? "dark" : "light",
  };
};

export const applyAdobeTheme = (color: unknown, root = document.documentElement): void => {
  if (root.dataset.hostTheme !== "adobe") return;
  const properties = adobeThemeProperties(color);
  if (!properties) return;
  for (const [property, value] of Object.entries(properties)) root.style.setProperty(property, value);
  root.dataset.themeAppearance = properties["color-scheme"];
};
