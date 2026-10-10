import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
try {
  const page = await browser.newPage({viewport: {width: 1000, height: 700}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:3000/main/?demo");
  await page.locator(".sound-row.is-selected").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-host-theme"), "adobe");
  await page.getByRole("textbox", {name: "Sound search", exact: true}).fill("Segment");
  await page.getByRole("tab", {name: "Segment", exact: true}).waitFor();
  await page.getByRole("button", {name: "Audio effects", exact: true}).click();
  await page.getByRole("slider", {name: "Gain in decibels", exact: true}).fill("-3");
  const before = await page.evaluate(() => {
    window.__themeApp = document.querySelector(".app-shell");
    window.__themeRow = document.querySelector(".sound-row.is-selected");
    return {query: document.querySelector('[name="sound-search"]').value, tab: document.querySelector('[role="tab"][aria-selected="true"]').textContent,
      sounds: document.querySelectorAll(".sound-row").length, gain: document.querySelector('[aria-label="Gain in decibels"]').value};
  });
  await page.evaluate(async () => {
    window.__themes = await import("/main/theme.ts");
    const {syncAdobeTheme} = await import("/hosts/adobe/theme.ts");
    window.__hostGray = 29;
    window.__themeDispose = syncAdobeTheme({
      getHostEnvironment: () => ({appSkinInfo: {panelBackgroundColor: {color: {red: window.__hostGray, green: window.__hostGray, blue: window.__hostGray}}}}),
      addEventListener: (_, update) => {window.__themeUpdate = update;},
      removeEventListener: () => {window.__themeUpdate = undefined;},
    });
  });
  for (const mode of ["adobe", "resolve"]) {
    for (const [width, height] of [[1000, 700], [620, 450]]) {
      await page.setViewportSize({width, height});
      await page.evaluate(mode => {
        window.__themes.applyHostTheme(mode);
        if (mode === "adobe") window.__themeUpdate();
      }, mode);
      await page.waitForTimeout(200);
      assert.equal(await page.locator("html").getAttribute("data-host-theme"), mode);
      assert.equal(await page.locator(".app-shell").evaluate(() => window.__themeApp === document.querySelector(".app-shell")), true);
      assert.equal(await page.locator(".sound-row.is-selected").evaluate(() => window.__themeRow === document.querySelector(".sound-row.is-selected")), true);
      assert.equal(await page.getByRole("textbox", {name: "Sound search", exact: true}).inputValue(), before.query);
      assert.equal(await page.getByRole("tab", {selected: true}).textContent(), before.tab);
      assert.equal(await page.getByRole("slider", {name: "Gain in decibels", exact: true}).inputValue(), before.gain);
      assert.equal(await page.locator(".sound-row").count(), before.sounds);
      const computed = await page.evaluate(() => ({
        canvas: getComputedStyle(document.querySelector(".app-shell")).backgroundColor,
        popup: getComputedStyle(document.querySelector(".effects-rack")).backgroundColor,
        rootSurface: getComputedStyle(document.documentElement).getPropertyValue("--bg-1").trim(),
        rowSurface: getComputedStyle(document.documentElement).getPropertyValue("--sound-row-surface").trim(),
        selectedBorder: getComputedStyle(document.querySelector(".sound-row.is-selected")).borderTopColor,
        action: getComputedStyle(document.querySelector(".player-dock .primary-button")).backgroundColor,
        play: getComputedStyle(document.querySelector(".play-button")).backgroundColor,
        playhead: getComputedStyle(document.querySelector(".channel-playhead")).backgroundColor,
        treeLine: getComputedStyle(document.documentElement).getPropertyValue("--library-tree-line").trim(),
        activeChannel: getComputedStyle(document.querySelector(".channel-labels button.is-active")).backgroundColor,
        waveform: getComputedStyle(document.documentElement).getPropertyValue("--wave-channel").trim(),
      }));
      assert.equal(computed.canvas, mode === "resolve" ? "rgb(33, 33, 38)" : "rgb(29, 29, 29)");
      assert.equal(computed.popup, mode === "resolve" ? "rgb(40, 40, 46)" : "rgb(36, 36, 36)", "The outside-app FX popup inherits the root theme");
      assert.equal(computed.selectedBorder, mode === "resolve" ? "rgba(238, 85, 72, 0.7)" : "rgba(10, 111, 216, 0.58)");
      assert.equal(computed.action, mode === "resolve" ? "rgb(183, 67, 55)" : "rgb(10, 111, 216)");
      assert.equal(computed.play, computed.action, "Primary and transport actions have their own accent, separate from neutral controls");
      assert.equal(computed.activeChannel, mode === "resolve" ? "rgb(116, 68, 59)" : "rgb(10, 111, 216)");
      if (mode === "resolve") assert.equal(computed.waveform, "rgba(104, 184, 130, 0.85)");
      assert.equal(computed.playhead, mode === "resolve" ? "rgb(238, 85, 72)" : "rgb(10, 111, 216)");
      assert.equal(computed.treeLine, mode === "resolve" ? "#85382e" : "#2a4f7c");
      assert.equal(computed.rowSurface, mode === "resolve" ? "#25252b" : "rgb(41, 41, 41)", "Sound cards stay quieter in Resolve without changing Adobe");
      if (process.env.SCREENSHOT_DIR) {
        await mkdir(process.env.SCREENSHOT_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.SCREENSHOT_DIR, `${mode}-${width}.png`)});
      }
    }
  }
  await page.evaluate(() => {
    window.__themes.applyHostTheme("adobe");
    window.__hostGray = 225;
    window.__themeUpdate();
  });
  assert.equal(await page.locator("html").getAttribute("data-theme-appearance"), "light");
  assert.equal(await page.getByRole("textbox", {name: "Sound search", exact: true}).inputValue(), "Segment");
  assert.equal(await page.getByRole("slider", {name: "Gain in decibels", exact: true}).inputValue(), "-3");
  await page.waitForTimeout(200);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({path: path.join(process.env.SCREENSHOT_DIR, "adobe-light-620.png")});
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".effects-rack").count(), 0);
  await page.setViewportSize({width: 1000, height: 700});
  await page.evaluate(() => window.__themes.applyHostTheme("resolve"));
  await page.waitForTimeout(200);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({path: path.join(process.env.SCREENSHOT_DIR, "resolve-workspace.png")});
  await page.evaluate(() => window.__themeDispose());
  assert.deepEqual(errors, []);
  console.log("Host themes passed: shared App identity, query, tab, results and FX settings persist; root popup inheritance, live Adobe brightness and two viewport sizes.");
} finally {
  await browser.close();
}
