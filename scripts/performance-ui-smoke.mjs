import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const baseline = process.env.PERFORMANCE_BASELINE === "1";
const results = [];
try {
  for (const mode of process.env.PERFORMANCE_HOST ? [process.env.PERFORMANCE_HOST] : ["adobe", "resolve"]) {
    assert.ok(mode === "adobe" || mode === "resolve", "Performance host must be adobe or resolve");
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const taskTime = async () => (await cdp.send("Performance.getMetrics")).metrics.find(metric => metric.name === "TaskDuration").value;
    const errors = [];
    page.on("pageerror", error => errors.push(error.stack || error.message));
    if (baseline) {
      await page.route(/\/main\/App\.svelte(?:\?.*)?$/, async route => {
        const url = route.request().url().replace("/App.svelte", "/.performance-baseline-App.svelte");
        await route.fulfill({ response: await route.fetch({ url }) });
      });
    }
    if (mode === "adobe") {
      await page.route("**/hosts/adobe/platform.ts", route => route.fulfill({ contentType: "text/javascript", body: "export const createAdobePlatform = () => window.__performancePlatform;" }));
    }
    await page.addInitScript(({ mode, baseline }) => {
      const ok = data => ({ ok: true, data });
      const noEvents = () => () => {};
      const count = 10000;
      const sounds = Array.from({ length: count }, (_, index) => ({
        id: `file-${index}`, folderId: "folder-perf", directoryId: "folder-perf",
        name: `Whoosh ${String(index).padStart(5, "0")} Group${index % 20}`, path: `C:/Performance/${index}.wav`,
        size: 16044, modifiedAt: 1, duration: 1, extension: "wav", tags: ["whoosh"],
        waveform: Array(96).fill(0.4), favorite: index % 5 === 0,
      }));
      const metadata = { version: 1, updatedAt: 1, folders: {}, sounds: {},
        collections: Array.from({ length: 100 }, (_, i) => ({ id: `collection-${i}`, name: `Collection ${i}`, parentId: "" })) };
      for (let i = 0; i < count; i += 5) metadata.sounds[`file:c:/performance/${i}.wav`] = { favorite: true, favoriteCollection: `collection-${(i / 5) % 100}` };
      const tree = { id: "folder-perf", rootId: "folder-perf", name: "Performance", path: "C:/Performance", directFileCount: count, totalFileCount: count, children: [] };
      const snapshot = { updatedAt: 1, sounds, folders: [{ id: tree.id, name: tree.name, path: tree.path, indexedAt: 1, fileCount: count, tree }] };
      const preferences = { autoPreview: false, loop: true, localSourceEnabled: true, cloudLibraryEnabled: false, freesoundLibraryEnabled: false,
        freesoundSourceEnabled: false, insertionTarget: "playhead", conversionPolicy: "unsupported", normalization: "preserve", normalizationTargetDb: -3, freesoundLicenseFilter: "commercial" };
      localStorage.setItem("sounddesigner.preferences.v1", JSON.stringify(preferences));
      localStorage.setItem("sounddesigner.cloud-enabled.v1", "false");
      localStorage.setItem("sounddesigner.sidebar-pin.v1", "true");
      window.__performanceStats = { reads: [], contexts: 0, closes: 0, hiddenTimers: 0, metadataWrites: 0, preferencesWrites: 0, startedAt: performance.now() };
      let hidden = false;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      window.__performanceHidden = value => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); };
      const originalTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => originalTimeout(() => {
        if (hidden) window.__performanceStats.hiddenTimers++;
        callback(...args);
      }, delay);
      // Emulate the minimum CEP browser's missing Array.at without changing array contents.
      if (!baseline) delete Array.prototype.at;
      const AudioContext = window.AudioContext;
      window.AudioContext = class extends AudioContext {
        constructor(...args) { super(...args); window.__performanceStats.contexts++; }
        close() { window.__performanceStats.closes++; return super.close(); }
      };
      const wav = new Uint8Array(16044);
      const view = new DataView(wav.buffer);
      for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]]) {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
      }
      view.setUint32(4, wav.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 16000, true);
      const storage = {
        getInfo: async () => ok({ root: "C:/SoundDesigner", manifestPath: "C:/Data/sounddesigner.json", audioStorageMode: mode === "adobe" ? "project" : "central" }),
        getPreferences: async () => ok(preferences), savePreferences: async () => { window.__performanceStats.preferencesWrites++; return ok({ saved: true }); },
        getLibraryMetadata: async () => ok(structuredClone(metadata)),
        saveLibraryMetadata: async value => { window.__performanceStats.metadataWrites++; Object.assign(metadata, structuredClone(value)); return ok({ saved: true }); },
        getFreesoundApiKey: async () => ok(""), saveFreesoundApiKey: async () => ok({ saved: true }),
      };
      const audio = { readFile: async filePath => { window.__performanceStats.reads.push(filePath); return ok(wav.slice()); }, onDragError: noEvents };
      const library = { getSnapshot: async () => ok(structuredClone(snapshot)), onScanProgress: noEvents };
      const runtime = { setAlwaysOnTop: async value => ok({ alwaysOnTop: value }), getLatestRelease: async () => ok({ notModified: false, release: { tag_name: "v1.0.4", html_url: "https://github.com/iboyshanto/SoundDesigner/releases/tag/v1.0.4", assets: [] } }), registerKeyEventsInterest: () => {} };
      window.soundDesigner = { storage, library, audio, runtime, resolve: { getContext: async () => ({ ok: false, error: { code: "NO_PROJECT", message: "No project in browser fixture" } }) }, cloud: { onDownloadProgress: noEvents } };
      window.__performancePlatform = {
        mode: "adobe", host: "aftereffects", initialize: () => {}, storage, library, audio, runtime,
        capabilities: { nativeStorage: true, nativeLibrary: true, nativeAudioPreparation: true, nativeUpdates: true, nativeProjectHandoff: true },
        project: { getContext: async () => ({ ok: false, host: "aftereffects", message: "No project in browser fixture" }) },
        updates: { getLatestRelease: runtime.getLatestRelease },
        cloud: { onDownloadProgress: noEvents },
      };
    }, { mode, baseline });
    await page.goto(mode === "adobe" ? "http://127.0.0.1:3000/main/" : "http://127.0.0.1:3002/");
    await page.locator(".sound-row").first().waitFor({ timeout: 15000 }).catch(error => { throw new Error(`${mode}: ${error.message}; page errors: ${errors.join("; ")}`); });
    const startupMs = await page.evaluate(() => performance.now() - window.__performanceStats.startedAt);
    const maxRows = await page.locator(".sound-row").count();
    assert.ok(maxRows < 80, `${mode}: 10,000 results must stay virtualized`);
    await page.getByRole("button", { name: "Expand Favorites collections" }).click();
    await page.locator(".favorite-library-row", { hasText: "Collection 99" }).waitFor();
    assert.equal(await page.locator(".favorite-library-row", { hasText: "Collection 99" }).locator("small").textContent(), "20");
    const searchMs = [];
    for (const query of ["Whoosh", "Group7", "9999", "NoSuchSound", ""]) {
      const start = performance.now();
      await page.getByRole("textbox", { name: "Sound search", exact: true }).fill(query);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      searchMs.push(Math.round(performance.now() - start));
    }
    assert.ok(await page.locator(".sound-row").count() < 80);
    for (const offset of [20000, 80000, 240000, 460000]) {
      await page.locator(".results-list").evaluate((element, top) => element.scrollTop = top, offset);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const currentPaths = await page.locator(".sound-row").evaluateAll(rows => rows.map(row => `C:/Performance/${Number(row.querySelector(".sound-title-line strong").textContent.match(/Whoosh (\d+)/)[1])}.wav`));
    const beforeIdle = await page.evaluate(() => window.__performanceStats.reads.length);
    const idleTaskStart = await taskTime();
    await page.waitForTimeout(1800);
    const idleTaskMs = Math.round(((await taskTime()) - idleTaskStart) * 1000);
    const idle = await page.evaluate(start => window.__performanceStats.reads.slice(start), beforeIdle);
    if (!baseline) assert.ok(idle.every(filePath => currentPaths.includes(filePath)), `${mode}: no stale off-screen waveform work`);
    await page.evaluate(() => window.__performanceHidden(true));
    const beforeHidden = await page.evaluate(() => ({ reads: window.__performanceStats.reads.length, timers: window.__performanceStats.hiddenTimers }));
    const hiddenTaskStart = await taskTime();
    await page.waitForTimeout(2800);
    const hiddenTaskMs = Math.round(((await taskTime()) - hiddenTaskStart) * 1000);
    const hidden = await page.evaluate(before => ({ reads: window.__performanceStats.reads.length - before.reads, timers: window.__performanceStats.hiddenTimers - before.timers }), beforeHidden);
    if (!baseline) { assert.equal(hidden.reads, 0); assert.equal(hidden.timers, 0, `${mode}: hidden panels must not poll waveform jobs`); }
    await page.evaluate(() => window.__performanceHidden(false));
    await page.waitForTimeout(400);
    const stats = await page.evaluate(() => window.__performanceStats);
    assert.equal(stats.contexts, stats.closes, `${mode}: all waveform AudioContexts close`);
    assert.deepEqual(errors, []);
    if (!baseline) assert.equal(stats.preferencesWrites, 0, `${mode}: loaded preferences must not be written back unchanged`);
    else assert.ok(stats.preferencesWrites > 0 && hidden.timers > 0, "Baseline comparison must actually load the preserved old renderer");
    results.push({ mode, sounds: 10000, collections: 100, startupMs: Math.round(startupMs), mountedRows: maxRows, searchMs, idleReads: idle.length, idleTaskMs, hidden, hiddenTaskMs, contexts: stats.contexts, closedContexts: stats.closes, metadataWrites: stats.metadataWrites, preferencesWrites: stats.preferencesWrites });
    await page.close();
  }
  if (process.env.PERFORMANCE_OUTPUT) {
    await mkdir(path.dirname(process.env.PERFORMANCE_OUTPUT), { recursive: true });
    await writeFile(process.env.PERFORMANCE_OUTPUT, JSON.stringify({ browser: browser.version(), baseline, fixture: "Mocked native I/O, real shared Svelte renderer and Resolve adapter; no native host certification", results }, null, 2));
  }
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
