import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
try {
  const page = await browser.newPage({viewport: {width: 960, height: 720}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:3000/main/");
  const mountFixture = async (width, query = "") => {
    await page.evaluate(async ({width, query}) => {
      const {default: Sidebar} = await import("/main/components/LibrarySidebar.svelte");
      const compiled = await (await fetch("/main/components/LibrarySidebar.svelte")).text();
      const runtimeUrl = compiled.match(/from "([^"]+\/svelte\.js[^\"]*)"/)?.[1];
      if (!runtimeUrl) throw new Error("Svelte runtime URL missing");
      const {mount, unmount} = await import(runtimeUrl);
      if (window.__folderFixture) {
        await unmount(window.__folderFixture.component);
        window.__folderFixture.target.remove();
      }
      const node = (id, name, children = [], extra = {}) => ({id, rootId: "root", name, path: `/library/${id}`, directFileCount: 1, totalFileCount: 8659, children, ...extra});
      const nested = node("nested", "Cinematic Glitch sounds", [node("deep", "Deep atmospheric textures")], {labelColor: "purple", pinned: true});
      const root = node("root", "Sound FX", [node("leaf", "Beluga Bg"), node("botanica", "Botanica", [], {labelColor: "blue"}), nested]);
      const chain = node("chain", "Single folder chain", [node("chain-leaf", "Last folder")], {directFileCount: 0});
      const noop = () => {};
      window.__folderSelection = null;
      const target = document.createElement("div");
      target.id = "folder-affordance-fixture";
      Object.assign(target.style, {position: "fixed", top: "20px", left: "20px", width: `${width}px`, height: "560px", zIndex: "100"});
      document.body.appendChild(target);
      const component = mount(Sidebar, {target, props: {
        collections: [], favoriteSounds: [], favoriteSelected: null, onSelectFavorites: noop,
        cloudLibraryEnabled: true, onCloudLibraryEnabled: noop,
        folders: [root, chain].map(tree => ({id: tree.id, name: tree.name, path: tree.path, fileCount: tree.totalFileCount, accent: "graphite", indexedAt: Date.now(), tree})), sounds: [],
        selectedFolder: "all", query, indexing: false, indexProgress: {files: 0, folders: 0, currentPath: ""}, now: Date.now(),
        localSourceEnabled: true, freesoundLibraryEnabled: false, freesoundSourceEnabled: false, freesoundConnected: false, freesoundCount: 0,
        onSelectFolder: id => {window.__folderSelection = id;}, onQueryChange: noop, onAddFolder: noop, onEditFolder: noop,
        onRescan: noop, onClose: noop, onFolderLabelColor: noop, onToggleFolderPinned: noop, onLocalSourceEnabled: noop, onFreesoundSourceEnabled: noop,
        update: {status: "idle", currentVersion: "1.0.4"}, updateDismissed: false, onOpenUpdate: noop, onDismissUpdate: noop,
      }});
      Object.assign(target.querySelector(".library-panel").style, {position: "relative", width: "100%", height: "100%", transform: "none"});
      window.__folderFixture = {component, target};
    }, {width, query});
  };
  const fixture = page.locator("#folder-affordance-fixture");
  const row = id => fixture.locator(`[data-library-node='["${id}"]']`);
  const expand = () => fixture.getByRole("button", {name: "Expand 3 subfolders in Sound FX", exact: true});
  for (const width of [320, 245, 225, 180]) {
    await mountFixture(width);
    await expand().waitFor();
    assert.equal(await expand().getAttribute("aria-expanded"), "false");
    await row("root").locator(".library-tree-select").click();
    assert.equal(await page.evaluate(() => window.__folderSelection), "root");
    assert.equal(await expand().getAttribute("aria-expanded"), "false", "Selecting audio must not expand folders");
    await expand().focus();
    await page.keyboard.press("Enter");
    await row("leaf").waitFor();
    assert.equal(await row("leaf").locator(".tree-folder-toggle").count(), 0, "Leaves must not suggest hidden children");
    assert.equal(await fixture.locator('[data-library-node=\'["chain","chain-leaf"]\'] .tree-folder-toggle').count(), 0, "A compacted chain ending in a leaf has no hidden children");
    assert.equal(await row("nested").locator(".tree-folder-toggle").textContent(), "1folder");
    assert.equal(await row("nested").locator(".library-icon").evaluate(e => getComputedStyle(e).color), "rgb(229, 229, 229)", "Pinned icon emphasis must survive the new cue");
    assert.equal(await row("botanica").locator(".library-icon").evaluate(e => getComputedStyle(e).color), "rgb(69, 152, 247)", "Label color must survive the new cue");
    await fixture.getByRole("button", {name: "Expand 1 subfolder in Cinematic Glitch sounds", exact: true}).click();
    await row("deep").waitFor();
    assert.equal(await row("nested").evaluate(e => getComputedStyle(e).getPropertyValue("--label-color").trim()), "#c85adb", "Saved purple labels retain their original color");
    assert.equal(await fixture.locator(".pinned-folder-row .icon-svg").evaluate(e => getComputedStyle(e).color), "rgb(200, 90, 219)");
    assert.equal(await fixture.locator(".favorite-library-row .icon-svg").first().evaluate(e => getComputedStyle(e).color), "rgb(184, 184, 184)");
    assert.equal(await fixture.locator(".source-icon--cloud").evaluate(e => getComputedStyle(e).color), "rgb(58, 145, 229)");
    const geometry = await fixture.locator(".library-tree-row").evaluateAll(rows => rows.map(e => {
      const name = e.querySelector(".library-copy").getBoundingClientRect();
      const box = e.getBoundingClientRect();
      const toggle = e.querySelector(".tree-folder-toggle")?.getBoundingClientRect();
      return {height: box.height, nameWidth: name.width, fits: !toggle || (toggle.right <= box.right && toggle.left >= name.right)};
    }));
    assert.ok(geometry.every(e => e.height === 29 && e.nameWidth > 25 && e.fits), JSON.stringify({width, geometry}));
    const branches = await fixture.locator(".library-tree-row").evaluateAll(rows => rows.map(e => {
      const style = getComputedStyle(e);
      const depth = Number(style.getPropertyValue("--depth"));
      const indent = parseFloat(style.getPropertyValue("--tree-indent"));
      return {depth, indent, elbow: depth ? parseFloat(getComputedStyle(e, "::after").width) : 0,
        inset: parseFloat(style.paddingInlineStart) - depth * indent, end: parseFloat(style.paddingInlineEnd),
        icon: e.querySelector(".library-icon .icon-svg").getBoundingClientRect().width};
    }));
    assert.ok(branches.every(e => e.indent >= 10 && (!e.depth || e.elbow >= 6) && e.inset === e.end && e.icon === 14), JSON.stringify({width, branches}));
    if (width >= 225) assert.ok(branches.every(e => e.indent === 16), "Normal panels must not flatten their branches when a nested folder opens");
    const scroll = await fixture.locator(".library-list").evaluate(e => ({left: e.scrollLeft, width: e.clientWidth, content: e.scrollWidth,
      overflowing: [...e.querySelectorAll("*")].filter(child => child.getBoundingClientRect().right > e.getBoundingClientRect().right + 2)
        .slice(0, 12).map(child => ({class: child.className, width: child.getBoundingClientRect().width, text: child.textContent?.slice(0, 50)}))}));
    assert.equal(scroll.left, 0, `Focusing a folder must not shift the entire library sideways: ${JSON.stringify({width, scroll})}`);
    assert.ok(scroll.content <= scroll.width, JSON.stringify({width, scroll}));
    const gutter = await fixture.evaluate(e => {
      const panel = e.querySelector(".library-panel").getBoundingClientRect();
      const source = e.querySelector(".library-source-row").getBoundingClientRect();
      const root = e.querySelector('.library-tree-row.is-root').getBoundingClientRect();
      return {panelLeft: panel.left, sourceLeft: source.left, treeLeft: root.left, right: root.right, sourceRight: source.right};
    });
    assert.equal(gutter.sourceLeft - gutter.treeLeft, 8, "Use the existing left inset for branches, rather than indenting names further right");
    assert.ok(gutter.treeLeft >= gutter.panelLeft && gutter.right <= gutter.sourceRight, JSON.stringify(gutter));
    assert.equal(await row("root").locator(".tree-folder-label").isVisible(), width === 320);
    if (process.env.SCREENSHOT_DIR) {
      await mkdir(process.env.SCREENSHOT_DIR, {recursive: true});
      await fixture.screenshot({path: path.join(process.env.SCREENSHOT_DIR, `folder-cues-${width}.png`)});
    }
    await fixture.getByRole("button", {name: "Collapse 3 subfolders in Sound FX", exact: true}).click();
    assert.equal(await row("leaf").count(), 0);
  }
  await mountFixture(225, "cinematic");
  await row("nested").waitFor();
  assert.equal(await row("root").locator("button.tree-folder-toggle").count(), 0, "Filtering must not offer an ineffective collapse control");
  assert.equal(await row("root").locator(".tree-folder-toggle").getAttribute("aria-label"), "1 matching subfolder");
  await row("nested").locator(".library-tree-select").click({button: "right"});
  const palette = fixture.locator(".item-context-colors");
  assert.equal(await palette.getByRole("button").count(), 7);
  assert.equal(await palette.getByRole("button", {name: "Set Purple label"}).getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const {default: Picker} = await import("/main/components/ColorLabelPicker.svelte");
    const compiled = await (await fetch("/main/components/ColorLabelPicker.svelte")).text();
    const {mount} = await import(compiled.match(/from "([^"]+\/svelte\.js[^\"]*)"/)[1]);
    const target = document.createElement("div");
    target.id = "palette-picker-fixture";
    Object.assign(target.style, {position: "fixed", top: "40px", left: "400px", zIndex: "130"});
    document.body.appendChild(target);
    mount(Picker, {target, props: {color: "purple", onChange: color => {window.__chosenLabel = color;}}});
  });
  const picker = page.locator("#palette-picker-fixture");
  await picker.getByRole("button", {name: "Color label: Purple", exact: true}).click();
  assert.equal(await picker.locator(".color-label-popover button").count(), 8, "Seven colors plus clear");
  assert.equal(await picker.getByRole("button", {name: "Set Purple label"}).getAttribute("aria-pressed"), "true");
  await picker.getByRole("button", {name: "Set Blue label"}).click();
  assert.equal(await page.evaluate(() => window.__chosenLabel), "blue");
  for (const mode of ["adobe", "resolve"]) {
    await page.evaluate(async mode => (await import("/main/theme.ts")).applyHostTheme(mode), mode);
    for (const label of ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Gray"]) {
      await picker.getByRole("button", {name: "Color label: Purple", exact: true}).click();
      const choice = picker.getByRole("button", {name: `Set ${label} label`, exact: true});
      assert.equal(await choice.evaluate(e => {const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));}), true, `${mode}: ${label} stays reachable`);
      await choice.click();
      assert.equal(await page.evaluate(() => window.__chosenLabel), label.toLowerCase());
    }
  }
  assert.deepEqual(errors, []);
  console.log("Folder cues and palette passed: readable branch elbows, balanced insets, stable icons, keyboard expansion, selection, filtering, legacy labels and 180/225/245/320px layouts.");
} finally {
  await browser.close();
}
