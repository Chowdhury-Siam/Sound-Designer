import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { displayLabelColor, LABEL_COLORS, labelColorName, labelColorOrder, labelColorValue } from "../src/js/main/labels";
import type { LabelColor } from "../src/js/main/types";

const legacyColors: LabelColor[] = ["red", "orange", "yellow", "green", "blue", "purple", "gray"];
const allowed = ([r, g, b]: number[]) => (r === g && b >= g && b - g <= 8) || (r < g && g < b);

test("cool Resolve charcoal counts as neutral without allowing other color families", () => {
  for (const rgb of [[33, 33, 38], [40, 40, 46], [72, 72, 79]]) expect(allowed(rgb)).toBe(true);
  for (const rgb of [[200, 50, 50], [220, 180, 40], [40, 180, 40], [160, 60, 200]]) expect(allowed(rgb)).toBe(false);
});

test("all seven label choices preserve their colors, sorting and stored IDs", () => {
  expect(LABEL_COLORS.map(color => color.id)).toEqual(legacyColors);
  expect(new Set(LABEL_COLORS.map(color => color.value)).size).toBe(7);
  const styles = readFileSync(new URL("../src/js/main/main.scss", import.meta.url), "utf8");
  const metadata = legacyColors.map(labelColor => ({ labelColor }));
  const before = JSON.stringify(metadata);
  for (const [index, { labelColor }] of metadata.entries()) {
    expect(displayLabelColor(labelColor)).toBe(labelColor);
    expect(labelColorName(labelColor)).toBe(LABEL_COLORS[index].label);
    expect(labelColorValue(labelColor)).toBe(LABEL_COLORS[index].value);
    const style = styles.match(new RegExp(`\\.label-${labelColor}\\s*\\{([^}]*)\\}`))?.[1];
    expect(style).toBeDefined();
    expect(style).toContain(labelColor === "gray" ? "--label-color: var(--label-tint)" : `--label-color: ${LABEL_COLORS[index].value}`);
    expect(labelColorOrder(labelColor)).toBe(index);
  }
  expect(JSON.stringify(metadata)).toBe(before);
  expect(displayLabelColor()).toBeUndefined();
  expect(labelColorName()).toBe("No label");
  expect(labelColorValue()).toBe("transparent");
  expect(labelColorOrder()).toBe(legacyColors.length);
});

test("shared UI chrome stays blue or neutral outside user labels and Resolve semantic roles", () => {
  for (const file of ["../src/js/main/main.scss"]) {
    // User label colors and Resolve's scoped media/status roles are checked separately.
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
      .replace(/\.label-(?:red|orange|yellow|green|blue|purple|gray)\s*\{[^}]*\}/g, "")
      .replace(/:root\[data-host-theme="resolve"\]\s*\{[^}]*\}/g, "");
    for (const [literal, hex] of source.matchAll(/#([\da-f]{6}|[\da-f]{3})\b/gi)) {
      const full = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex;
      const rgb = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
      expect(allowed(rgb), `${file}: ${literal}`).toBe(true);
    }
    for (const [literal, r, g, b] of source.matchAll(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/g)) {
      expect(allowed([Number(r), Number(g), Number(b)]), `${file}: ${literal}`).toBe(true);
    }
  }
});

test("Resolve reserves non-neutral colors for explicit action, active, media and status roles", () => {
  const source = readFileSync(new URL("../src/js/main/main.scss", import.meta.url), "utf8");
  const block = source.match(/:root\[data-host-theme="resolve"\]\s*\{([^}]*)\}/)?.[1];
  expect(block).toBeDefined();
  const coloredRoles = new Set(["--action-bg", "--primary-border", "--accent-strong", "--control-active-bg", "--control-active-color",
    "--selected-ui-fill", "--selected-ui-border", "--sound-row-selected-border", "--sound-row-selected-fill", "--selection-marker",
    "--playhead", "--wave-base", "--wave-channel", "--success", "--warn", "--error", "--enabled-bg", "--enabled-ink",
    "--enabled-fill", "--enabled-border", "--modified-fill", "--modified-border", "--error-fill", "--error-border",
    "--library-tree-line", "--library-tree-node", "--range-selected-bg"]);
  for (const [, role, value] of block!.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    const hex = value.match(/^#([\da-f]{6})$/i)?.[1];
    const rgba = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const rgb = hex ? [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) : rgba ? rgba.slice(1, 4).map(Number) : null;
    if (rgb && !coloredRoles.has(role)) expect(allowed(rgb) && rgb[0] === rgb[1], `${role}: ${value}`).toBe(true);
  }
  expect(block).toContain("--accent: #56565e;");
  expect(block).toContain("--action-bg: #b74337;");
  expect(block).toContain("--playhead: #ee5548;");
  const luminance = (rgb: number[]) => rgb.map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: number[], b: number[]) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  expect(contrast([255, 255, 255], [86, 86, 94])).toBeGreaterThanOrEqual(4.5);
  expect(contrast([255, 255, 255], [183, 67, 55])).toBeGreaterThanOrEqual(4.5);
  expect(contrast([255, 224, 211], [116, 68, 59])).toBeGreaterThanOrEqual(4.5);
  expect(contrast([240, 155, 131], [52, 52, 58])).toBeGreaterThanOrEqual(4.5);
  expect(contrast([184, 231, 198], [33, 33, 38])).toBeGreaterThanOrEqual(3);
  expect(contrast([255, 255, 255], [66, 98, 77])).toBeGreaterThanOrEqual(4.5);
  expect(contrast([165, 215, 182], [52, 52, 58])).toBeGreaterThanOrEqual(4.5);
  expect(contrast([233, 189, 101], [52, 52, 58])).toBeGreaterThanOrEqual(4.5);
  for (const text of [[168, 168, 168], [128, 180, 144], [233, 189, 101], [239, 142, 134]]) {
    expect(contrast(text, [52, 52, 58])).toBeGreaterThanOrEqual(4.5);
  }
});
