import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
try {
  const page = await browser.newPage({viewport: {width: 700, height: 700}});
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:3000/main/");
  await page.evaluate(async () => {
    const { default: Sidebar } = await import("/main/components/LibrarySidebar.svelte");
    const compiled = await (await fetch("/main/components/LibrarySidebar.svelte")).text();
    const runtimeUrl = compiled.match(/from "([^"]+\/svelte\.js[^\"]*)"/)?.[1];
    if (!runtimeUrl) throw new Error("Svelte runtime URL missing from compiled component");
    const { mount } = await import(runtimeUrl);
    const target = document.createElement("div");
    target.className = "panel-body";
    Object.assign(target.style, { position: "fixed", inset: "60px auto auto 0", width: "600px", height: "300px", zIndex: "100" });
    document.body.appendChild(target);
    const leaf = {id: "leaf", rootId: "root", name: "Pinned Nested Folder", path: "/library/parent/leaf", directFileCount: 2, totalFileCount: 2, children: [], pinned: true};
    const empty = {id: "empty", rootId: "root", name: "Empty", path: "/library/empty", directFileCount: 0, totalFileCount: 0, children: []};
    const parent = {id: "parent", rootId: "root", name: "Parent", path: "/library/parent", directFileCount: 0, totalFileCount: 2, children: [leaf, {...empty, id: "parent-empty", path: "/library/parent/empty"}]};
    const root = {id: "root", rootId: "root", name: "Library Root", path: "/library", directFileCount: 0, totalFileCount: 2, children: [parent, empty]};
    const noop = () => {};
    window.__revealSelection = null;
    mount(Sidebar, { target, props: {
      collections: [], favoriteSounds: [], favoriteSelected: null, onSelectFavorites: noop,
      cloudLibraryEnabled: false, onCloudLibraryEnabled: noop,
      folders: [{id: "root", name: "Library Root", path: "/library", fileCount: 2, accent: "graphite", indexedAt: Date.now(), tree: root}], sounds: [],
      selectedFolder: "all", query: "", indexing: false, indexProgress: {files: 0, folders: 0, currentPath: ""}, now: Date.now(),
      localSourceEnabled: true, freesoundLibraryEnabled: false, freesoundSourceEnabled: false, freesoundConnected: false, freesoundCount: 0,
      onSelectFolder: (id, keepOpen) => { window.__revealSelection = {id, keepOpen}; }, onQueryChange: noop, onAddFolder: noop, onEditFolder: noop,
      onRescan: noop, onClose: noop, onFolderLabelColor: noop, onToggleFolderPinned: noop, onLocalSourceEnabled: noop, onFreesoundSourceEnabled: noop,
      update: {status: "idle", currentVersion: "1.0.3"}, updateDismissed: false, onOpenUpdate: noop, onDismissUpdate: noop,
    }});
    window.__fixture = target;
  });
  const fixture = page.locator(".panel-body").last();
  assert.equal(await fixture.locator('[data-library-node*=\'"leaf"\']').count(), 0);
  assert.equal(await fixture.getByRole("button", {name: "Main Favorites 0"}).count(), 0, "Collections should be collapsed initially");
  await fixture.locator(".pinned-folder-row button").click();
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.__revealSelection), {id: "leaf", keepOpen: true});
  assert.equal(await fixture.locator('[data-library-node*=\'"parent"\']').count(), 1);
  assert.equal(await fixture.locator('[data-library-node*=\'"leaf"\']').count(), 1);
  for (const id of ["root", "parent", "leaf"]) {
    assert.equal(await fixture.locator(`[data-library-node*='"${id}"'] .count-badge`).textContent(), "2", "Parent count must include descendant files");
  }
  assert.ok(await fixture.locator(".library-list").evaluate(e => e.scrollTop > 0));
  assert.deepEqual(await page.evaluate(() => JSON.parse(document.activeElement?.closest("[data-library-node]")?.getAttribute("data-library-node"))), ["leaf"]);
  const positions = await fixture.locator(".library-tree-row").evaluateAll(rows => rows.map(row => ({
    left: row.querySelector(".library-tree-select").getBoundingClientRect().left,
    depth: Number(getComputedStyle(row).getPropertyValue("--depth")),
    indent: Number.parseFloat(getComputedStyle(row).getPropertyValue("--tree-indent")),
  })));
  assert.ok(positions.every(row => row.indent >= 10 && row.indent <= 16 && Math.abs(row.left - positions[0].left - row.depth * row.indent) < 1), "Nested rows retain the current bounded hierarchy spacing");
  if (process.env.SCREENSHOT_PATH) await fixture.screenshot({path: process.env.SCREENSHOT_PATH});
  await fixture.getByRole("button", {name: "Collapse Parent", exact: true}).click();
  assert.equal(await fixture.locator('[data-library-node*=\'"leaf"\']').count(), 0);
  await fixture.getByRole("button", {name: "Expand Parent", exact: true}).click();
  assert.equal(await fixture.locator('[data-library-node*=\'"leaf"\']').count(), 1);
  assert.deepEqual(errors, []);
  console.log("Pinned reveal browser test passed: expand ancestors, keep drawer open, scroll and focus original tree row.");
} finally { await browser.close(); }
