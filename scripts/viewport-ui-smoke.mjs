import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 806 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.PANEL_URL || "http://127.0.0.1:3000"}/main/?demo`);
  await page.locator(".app-shell").waitFor();
  if (process.env.RELEASE_PANEL === "1") assert.equal(await page.locator(".sound-row").count(), 0, "Release builds exclude browser demo audio");
  else await page.locator(".sound-row.is-selected").waitFor();
  await page.getByRole("textbox", { name: "Sound search", exact: true }).fill("Segment");
  // Simulate the manifest-sized page ancestors left behind during panel restoration.
  await page.evaluate(() => {
    window.__viewportApp = document.querySelector(".app-shell");
    for (const element of [document.documentElement, document.body]) {
      element.style.width = "600px";
      element.style.height = "650px";
    }
  });
  for (const [width, height] of [[760, 806], [1000, 700], [620, 450], [320, 600], [600, 650]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const rect = shell.getBoundingClientRect();
      const dock = document.querySelector(".player-dock").getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, dockBottom: dock.bottom, sameApp: shell === window.__viewportApp };
    });
    assert.equal(layout.x, 0);
    assert.equal(layout.y, 0);
    assert.equal(layout.width, width, "App fills the restored viewport despite stale page width");
    assert.equal(layout.height, height, "App fills the restored viewport despite stale page height");
    assert.equal(layout.dockBottom, height, "Player stays at the panel bottom");
    assert.equal(layout.sameApp, true, "Resizing preserves the mounted app");
    assert.equal(await page.getByRole("textbox", { name: "Sound search", exact: true }).inputValue(), "Segment");
  }
  assert.deepEqual(errors, []);
  console.log("Viewport passed five sizes with stale 600x650 page ancestors; app identity, search and bottom player preserved.");
} finally {
  await browser.close();
}
