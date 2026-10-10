import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
try {
  const page = await browser.newPage({viewport: {width: 1050, height: 400}});
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  // Inject folder fixtures into the served development module only. Production
  // source and packages never contain this simulated library.
  await page.route("**/main/App.svelte*", async route => {
    const response = await route.fetch(); let code = await response.text();
    const needle = "let folders = $.tag($.state($.proxy([])), 'folders');";
    const tree = {id: "root", rootId: "root", name: "SFX / Botanica v4", path: "/library/SFX/Botanica v4", directFileCount: 0, totalFileCount: 2, children: []};
    const folders = [{id: "root", name: tree.name, path: tree.path, fileCount: 2, accent: "graphite", indexedAt: Date.now(), tree}];
    assert.ok(code.includes(needle), "Update development fixture injection if Svelte output changes");
    code = code.replace(needle, `let folders = $.tag($.state($.proxy(${JSON.stringify(folders)})), 'folders');`);
    await route.fulfill({response, body: code});
  });
  await page.goto("http://127.0.0.1:3000/main/");
  await page.getByRole("button", {name: "Keep library sidebar visible"}).click();
  await page.locator('[data-library-node*="root"] .library-tree-select').click();
  await page.getByRole("button", {name: "Switch to waveform grid"}).click();
  await page.evaluate(() => {
    document.querySelector(".hero-search").dataset.tooltip = "/Users/rasel/Documents/Assets/NO COPYRIGHT SOUND/SFX/" + "VeryLongNestedFolderName".repeat(8);
    document.querySelector(".hero-search").classList.add("tooltip");
  });
  for (const [width, height] of [[1050,400], [800,450], [620,450], [480,650], [400,700], [320,600], [280,500]]) {
    await page.setViewportSize({width, height}); await page.waitForTimeout(120);
    const failure = await page.locator(".search-toolbar").evaluate(toolbar => {
      const parent = toolbar.getBoundingClientRect();
      const controls = [...toolbar.querySelectorAll("button,input,kbd,.filter-chips")];
      return controls.filter(element => element.getClientRects().length && getComputedStyle(element).display !== "none")
        .map(element => ({label: element.getAttribute("aria-label") || element.textContent, rect: element.getBoundingClientRect()}))
        .filter(({rect}) => rect.left < parent.left - 1 || rect.right > parent.right + 1 || rect.bottom > parent.bottom + 1)
        .map(({label}) => label);
    });
    assert.deepEqual(failure, [], `Clipped toolbar controls at ${width}×${height}`);
    if (await page.locator(".filter-chips").count()) assert.equal(await page.locator(".filter-chips").evaluate(e => e.scrollWidth > e.clientWidth + 1), false, "Filters must remain fully visible");
    assert.ok((await page.locator(".search-toolbar").boundingBox()).height <= 80, "Compact toolbar must occupy at most 80px at every dock size");
    await page.getByRole("button", {name: "Browse options", exact: true}).click();
    const popup = await page.locator(".toolbar-popover-panel").boundingBox();
    assert.ok(popup.x >= 7 && popup.x + popup.width <= width - 7, "Options must fit the viewport");
    await page.getByRole("slider", {name: "Waveform tile size"}).fill("180");
    await page.keyboard.press("Escape");
    await page.locator(".hero-search").hover();
    await page.waitForTimeout(450);
    const tooltip = await page.locator(".floating-tooltip").boundingBox();
    assert.ok(tooltip && tooltip.x >= 7 && tooltip.x + tooltip.width <= width - 7 && tooltip.y >= 7 && tooltip.y + tooltip.height <= height - 7, `Long path tooltip must fit dock at ${width}×${height}`);
    await page.mouse.move(width - 2, 2);
    if (process.env.SCREENSHOT_DIRECTORY && width === 800) await page.screenshot({path: `${process.env.SCREENSHOT_DIRECTORY}/toolbar-800.png`});
  }
  await page.getByRole("button", {name: "Search scope", exact: true}).click();
  assert.equal(await page.getByRole("checkbox", {name: "Include subfolders"}).isChecked(), true);
  await page.locator(".toolbar-popover-panel").getByRole("button", {name: "Search all sounds", exact: true}).click();
  assert.equal((await page.locator(".browse-scope").textContent()).trim(), "All sounds");
  assert.deepEqual(errors, []);
  console.log("Toolbar bounds passed at seven dock sizes with pinned sidebar, selected-folder controls, all filters and grid size control.");
} finally { await browser.close(); }
