import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
const errors = [];
const capture = async (page, name) => {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, {recursive: true});
  await page.screenshot({path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`)});
};
const color = (locator, property) => locator.evaluate((element, property) => getComputedStyle(element)[property], property);
const theme = (page, mode) => page.evaluate(async mode => (await import("/main/theme.ts")).applyHostTheme(mode), mode);

try {
  const page = await browser.newPage({viewport: {width: 1000, height: 700}});
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:3000/main/?demo");
  await page.locator(".sound-row.is-selected").waitFor();
  await page.getByRole("textbox", {name: "Sound search", exact: true}).fill("Segment");
  await page.getByRole("tab", {name: "Segment", exact: true}).waitFor();

  for (const mode of ["adobe", "resolve"]) {
    await theme(page, mode);
    await page.getByRole("button", {name: "Open panel settings", exact: true}).click();
    const auto = page.getByRole("checkbox", {name: /Auto-preview selection/});
    const loop = page.getByRole("checkbox", {name: /Loop previews/});
    const original = await auto.isChecked();
    await auto.check();
    const switchColor = await color(page.locator(".switch-row").filter({has: auto}).locator(".switch"), "backgroundColor");
    assert.equal(switchColor, mode === "resolve" ? "rgb(66, 98, 77)" : "rgb(10, 111, 216)");
    await page.getByRole("radio", {name: /Manual peak target/}).check();
    await page.mouse.move(0, 0);
    const selected = page.locator('.choice-row.is-selected').filter({has: page.getByRole("radio", {name: /Manual peak target/})});
    assert.equal(await color(selected, "borderTopColor"), mode === "resolve" ? "rgba(238, 85, 72, 0.65)" : "rgb(48, 48, 48)");
    assert.equal(await color(page.locator(".normalization-target output"), "color"), mode === "resolve" ? "rgb(165, 215, 182)" : "rgb(229, 229, 229)");
    await page.getByRole("slider", {name: "Manual normalization target"}).fill("-6");
    assert.match(await selected.textContent(), /Manual peak target/);
    await page.getByRole("button", {name: "Selected clip", exact: true}).click();
    const active = page.locator(".segmented-control button.is-active");
    assert.equal(await color(active, "backgroundColor"), mode === "resolve" ? "rgba(238, 85, 72, 0.12)" : "rgba(10, 111, 216, 0.18)");
    for (const [width, height] of [[1000, 700], [620, 450]]) {
      await page.setViewportSize({width, height});
      await auto.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const bounds = await page.locator('[role="dialog"]').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height + 1);
      await capture(page, `${mode}-settings-${width}`);
    }
    await page.getByRole("button", {name: "Cancel", exact: true}).click();
    await page.getByRole("button", {name: "Open panel settings", exact: true}).click();
    assert.equal(await auto.isChecked(), original, "Cancel preserves persisted preferences");
    await loop.check();
    await page.getByRole("button", {name: "Save changes", exact: true}).click();
    assert.equal(await page.getByRole("button", {name: "Loop preview", exact: true}).getAttribute("aria-pressed"), "true");
    assert.equal(await color(page.getByRole("button", {name: "Loop preview", exact: true}), "color"), mode === "resolve" ? "rgb(165, 215, 182)" : "rgb(229, 229, 229)");
    await page.getByRole("button", {name: /^Audio effects/}).click();
    const gain = page.getByRole("slider", {name: "Gain in decibels", exact: true});
    await gain.fill("-3");
    assert.equal(await color(page.locator(".effect-control.is-modified").filter({has: gain}).locator("output"), "color"), mode === "resolve" ? "rgb(233, 189, 101)" : "rgb(229, 229, 229)");
    await page.getByRole("button", {name: "Normalize −1 dB", exact: true}).click();
    assert.equal(await page.getByRole("button", {name: "Normalize −1 dB", exact: true}).getAttribute("aria-pressed"), "true");
    for (const [width, height] of [[1000, 700], [620, 450]]) {
      await page.setViewportSize({width, height});
      await page.waitForTimeout(200);
      await capture(page, `${mode}-player-fx-${width}`);
    }
    await page.getByRole("button", {name: "Bypass", exact: true}).click();
    assert.equal(await page.locator(".effects-rack").getAttribute("class").then(value => value.includes("is-bypassed")), true);
    if (mode === "resolve") assert.equal(await color(page.locator(".effect-control.is-modified").filter({has: gain}).locator("output"), "color"), "rgb(168, 168, 168)");
    await page.getByRole("button", {name: "Enable FX", exact: true}).click();
    await page.getByRole("button", {name: "Reset", exact: true}).click();
    assert.equal(await page.locator(".effect-control.is-modified").count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("textbox", {name: "Sound search", exact: true}).inputValue(), "Segment");
  }

  // Browser-only fixtures exercise the shipped Assistant component, not native APIs.
  const assistant = await browser.newPage({viewport: {width: 1000, height: 700}});
  assistant.on("pageerror", error => errors.push(error.message));
  await assistant.route("**/main/App.svelte*", async route => {
    const response = await route.fetch();
    let code = await response.text();
    assert.ok(code.includes("platform().capabilities.nativeSfxAssistant"));
    code = code.replace("platform().capabilities.nativeSfxAssistant", "true")
      .replace('name: "Segment Selection Demo"', 'name: "Soft Whoosh Demo"')
      .replace('path: "",\n\t\t\textension: "wav"', 'path: "/fixture/whoosh.wav",\n\t\t\textension: "wav"');
    assert.ok(code.includes('path: "/fixture/whoosh.wav"'));
    await route.fulfill({response, body: code});
  });
  await assistant.route("**/main/components/SfxAssistantSheet.svelte*", async route => {
    const response = await route.fetch();
    let code = await response.text();
    const call = /const result = .*analyzeAfterEffectsSfx.*;/;
    assert.ok(call.test(code));
    const analysis = {ok: true, message: "Browser fixture", compositionId: 1, compositionName: "Fixture", frameDuration: 1 / 24, analyzedLayers: 2,
      moments: [1, 2].map(time => ({time, duration: 0.6, intensity: 2, type: "whoosh", layer: `Edit ${time}`, reason: "Fixture edit boundary"}))};
    code = code.replace(call, `const result = $.get(scope) === "comp" ? {ok: false, message: "Fixture: no active timeline. Open a timeline and try again."} : ${JSON.stringify(analysis)};`)
      .replace('const isResolve = $.strict_equals(detectHost(), "resolve");', "const isResolve = true;")
      .replace("if ($$props.cloudEnabled &&", "if (false &&");
    await route.fulfill({response, body: code});
  });
  await assistant.goto("http://127.0.0.1:3000/main/?demo");
  await assistant.locator(".sound-row.is-selected").waitFor();
  for (const mode of ["adobe", "resolve"]) {
    await theme(assistant, mode);
    await assistant.getByRole("button", {name: "Open SFX Assistant", exact: true}).click();
    await assistant.getByRole("button", {name: "Analyze", exact: true}).click();
    await assistant.locator(".sfx-moment.is-approved").first().waitFor();
    assert.equal(await assistant.locator(".sfx-moment.is-approved").count(), 2);
    const chip = assistant.getByRole("button", {name: "whoosh", exact: true});
    assert.equal(await color(chip, "borderTopColor"), mode === "resolve" ? "rgba(238, 85, 72, 0.65)" : "rgb(10, 111, 216)");
    if (mode === "resolve") assert.equal(await color(assistant.locator(".sfx-moment").first(), "backgroundColor"), "rgba(128, 180, 144, 0.14)");
    for (const [width, height] of [[1000, 700], [620, 450]]) {
      await assistant.setViewportSize({width, height});
      await assistant.locator(".sfx-moment").first().scrollIntoViewIfNeeded();
      await assistant.waitForTimeout(200);
      await capture(assistant, `${mode}-assistant-${width}`);
    }
    const include = assistant.getByRole("checkbox", {name: "Include suggestion at 1.00 seconds"});
    await include.uncheck();
    assert.equal(await assistant.locator(".sfx-moment.is-approved").count(), 1);
    assert.equal(await assistant.getByRole("button", {name: "Add 1 SFX", exact: true}).isEnabled(), true);
    await assistant.getByRole("combobox", {name: "Sound for whoosh at 2.00 seconds"}).selectOption("");
    assert.equal(await assistant.locator(".sfx-moment.is-approved").count(), 0, "Skip sound must not look approved");
    assert.equal(await assistant.getByRole("button", {name: "Add 0 SFX", exact: true}).isDisabled(), true);
    await assistant.locator('.sfx-options select').first().selectOption("comp");
    await assistant.getByRole("button", {name: "Analyze", exact: true}).click();
    await assistant.getByRole("alert").waitFor();
    if (mode === "resolve") assert.equal(await color(assistant.getByRole("alert"), "borderTopColor"), "rgba(239, 142, 134, 0.65)");
    await capture(assistant, `${mode}-assistant-error`);
    await assistant.locator('.sfx-options select').first().selectOption("selected");
    await assistant.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  console.log("Semantic color UI passed: both hosts, settings cancel/save, enabled switches, selected choices, modified/bypassed/reset FX, Assistant approved/skipped/error states and two viewport sizes. Assistant uses browser-only analysis fixtures.");
} finally {
  await browser.close();
}
