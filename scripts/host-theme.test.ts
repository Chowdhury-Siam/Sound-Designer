import { expect, test } from "bun:test";
import { adobeThemeProperties, applyAdobeTheme, applyHostTheme } from "../src/js/main/theme";
import { syncAdobeTheme } from "../src/js/hosts/adobe/theme";

const createRoot = () => {
  const properties = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: { setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key) },
  } as unknown as HTMLElement;
  return { root, properties };
};
const color = (value: number) => ({ red: value, green: value, blue: value });
const gray = (value: string) => Number(value.match(/\d+/)![0]);
const luminance = (value: number) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
const contrast = (a: number, b: number) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test("host selection clears only theme overrides and isolates each document", () => {
  const adobe = createRoot();
  const resolve = createRoot();
  adobe.properties.set("--unrelated", "preserved");
  applyHostTheme("adobe", adobe.root);
  applyAdobeTheme(color(50), adobe.root);
  applyHostTheme("resolve", resolve.root);
  expect(adobe.root.dataset.hostTheme).toBe("adobe");
  expect(resolve.root.dataset.hostTheme).toBe("resolve");
  expect(resolve.properties.size).toBe(0);
  applyAdobeTheme(color(80), resolve.root);
  expect(resolve.properties.size).toBe(0);
  applyHostTheme("resolve", adobe.root);
  expect(adobe.properties).toEqual(new Map([["--unrelated", "preserved"]]));
  expect(adobe.root.dataset.themeAppearance).toBeUndefined();
  applyHostTheme("browser", adobe.root);
  expect(adobe.root.dataset.hostTheme).toBe("adobe");
});

test("Adobe brightness is neutralized and body text stays readable across the full range", () => {
  for (let value = 0; value <= 255; value++) {
    const theme = adobeThemeProperties(color(value))!;
    expect(theme["--bg-0"]).toBe(`rgb(${value}, ${value}, ${value})`);
    for (const text of ["--text-1", "--text-2", "--text-muted"]) {
      for (let surface = 0; surface <= 4; surface++) {
        expect(contrast(gray(theme[text]), gray(theme[`--bg-${surface}`])), `${value}: ${text} on bg-${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
  expect(adobeThemeProperties({ red: 40, green: 50, blue: 60 })!["--bg-0"]).toBe("rgb(49, 49, 49)");
});

test("malformed host metadata preserves the fallback or last good theme", () => {
  const { root, properties } = createRoot();
  applyHostTheme("adobe", root);
  applyAdobeTheme(color(29), root);
  const previous = new Map(properties);
  for (const invalid of [undefined, null, {}, { red: "50", green: 50, blue: 50 }, color(NaN), color(Infinity), color(-1), color(256)]) {
    expect(adobeThemeProperties(invalid)).toBeNull();
    applyAdobeTheme(invalid, root);
    expect(properties).toEqual(previous);
  }
});

test("Adobe events change only presentation, preserve last good colors, and unsubscribe", () => {
  const { root, properties } = createRoot();
  applyHostTheme("adobe", root);
  let value = 29;
  let fail = false;
  let listener: (() => void) | undefined;
  const host = {
    getHostEnvironment: () => {
      if (fail) throw new Error("Host unavailable");
      return { appSkinInfo: { panelBackgroundColor: { color: color(value) } } };
    },
    addEventListener: (type: string, callback: () => void) => { expect(type).toBe("com.adobe.csxs.events.ThemeColorChanged"); listener = callback; },
    removeEventListener: (type: string, callback: () => void) => { expect(type).toBe("com.adobe.csxs.events.ThemeColorChanged"); expect(callback).toBe(listener); listener = undefined; },
  };
  const dispose = syncAdobeTheme(host, root);
  expect(properties.get("--bg-0")).toBe("rgb(29, 29, 29)");
  value = 50;
  listener!();
  expect(properties.get("--bg-0")).toBe("rgb(50, 50, 50)");
  fail = true;
  expect(() => listener!()).not.toThrow();
  expect(properties.get("--bg-0")).toBe("rgb(50, 50, 50)");
  applyHostTheme("resolve", root);
  fail = false;
  listener!();
  expect(properties.size).toBe(0);
  dispose();
  expect(listener).toBeUndefined();
  expect(() => syncAdobeTheme({ ...host, getHostEnvironment: () => { throw new Error("Missing"); }, addEventListener: () => { throw new Error("Missing"); } }, root)()).not.toThrow();
});
