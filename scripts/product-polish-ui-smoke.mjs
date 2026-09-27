import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
try {
  const page = await browser.newPage({viewport:{width:790,height:470},deviceScaleFactor:2});
  page.setDefaultTimeout(8000);
  const errors=[]; page.on("pageerror",error=>errors.push(error.message));
  // Browser-only fixture: large nested library, long titles and color labels.
  // It shares the generated demo audio and never touches customer files.
  await page.route("**/main/App.svelte*",async route=>{
    const response=await route.fetch(); let code=await response.text();
    const sounds="let sounds = $.tag($.state($.proxy(browserDemoSound ? [browserDemoSound] : [])), 'sounds');";
    const folders="let folders = $.tag($.state($.proxy([])), 'folders');";
    assert.ok(code.includes(sounds) && code.includes(folders));
    const tree={id:"fixture-root",rootId:"fixture-root",name:"SFX Library",path:"/test/sfx",directFileCount:0,totalFileCount:10000,children:[{id:"fixture-child",rootId:"fixture-root",name:"Botanica • Granular & Interface Sounds",path:"/test/sfx/Botanica",directFileCount:10000,totalFileCount:10000,children:[]}]};
    code=code.replace(folders,`let folders = $.tag($.state($.proxy(${JSON.stringify([{id:tree.id,name:tree.name,path:tree.path,fileCount:10000,accent:"graphite",indexedAt:Date.now(),tree}])})), 'folders');`);
    code=code.replace(sounds,`let sounds = $.tag($.state($.proxy(browserDemoSound ? Array.from({length:10000},(_,i)=>({...browserDemoSound,id:'fixture-'+i,folderId:'fixture-root',directoryId:'fixture-child',name:'Granular, Button, Select — Long nested sound title ('+i+')',favorite:i<20,labelColor:i%2?'red':'orange'})) : [])), 'sounds');`);
    await route.fulfill({response,body:code});
  });
  await page.goto("http://127.0.0.1:3000/main/?demo");
  await page.getByRole("button",{name:"Keep library sidebar visible"}).click();
  await page.locator('[data-library-node="fixture-root"] .library-tree-select').click();
  assert.match(await page.locator(".results-summary").textContent(),/10000/);
  await page.locator(".sound-row").first().click();
  assert.ok(await page.locator(".sound-row").count()<100,"Large library stays virtualized");
  assert.equal(await page.locator(".match-score").count(),0,"No fabricated relevance percentage");
  await page.locator(".results-list").evaluate(el=>el.scrollTop=12000);
  await page.waitForTimeout(120);
  assert.ok(await page.locator(".sound-row").count()<100);
  assert.ok(!(await page.locator(".sound-row").first().textContent()).includes("(0)"),"Scrolling advances virtualized results");
  await page.locator(".results-list").evaluate(el=>el.scrollTop=0);
  for (const [width,height] of [[790,470],[1200,720],[620,450],[400,650],[280,400]]) {
    await page.setViewportSize({width,height});
    await page.getByRole("button",{name:"Audio effects",exact:true}).click();
    await page.waitForTimeout(180);
    assert.equal(await page.locator(".effects-rack").evaluate(el=>el.parentElement.classList.contains("app-shell")),true);
    for (const label of ["Echo amount","Room reverb amount","Gain in decibels","Pitch shift in semitones","Playback and import speed"]) {
      const control=page.getByRole("slider",{name:label,exact:true});
      await control.scrollIntoViewIfNeeded();
      assert.equal(await control.evaluate(el=>{const r=el.getBoundingClientRect();return el===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);}),true,`${label} must be clickable above sidebar at ${width}×${height}`);
    }
    const bounds=await page.locator(".effects-rack").boundingBox();
    assert.ok(bounds.x>=7&&bounds.y>=7&&bounds.x+bounds.width<=width-7&&bounds.y+bounds.height<=height-7);
    for (const button of await page.locator(".effects-rack button:enabled").all()) {
      await button.scrollIntoViewIfNeeded();
      assert.equal(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,"FX actions remain reachable, including within the scrolling body");
    }
    if(process.env.SCREENSHOT_DIRECTORY && width===790) await page.screenshot({path:`${process.env.SCREENSHOT_DIRECTORY}/polished-fx.png`});
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".effects-rack").count(),0);
    await page.waitForFunction(()=>document.querySelector(".effects-button")===document.activeElement);
    await page.getByRole("button",{name:"Sound details",exact:true}).click();
    await page.waitForTimeout(180);
    assert.equal(await page.locator(".toolbar-popover-panel").evaluate(el=>{
      const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+10,r.y+10));
    }),true,"Sound details must clear sidebar and player stacking contexts");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".toolbar-popover-panel").count(),0);
  }
  await page.setViewportSize({width:790,height:470});
  await page.getByRole("button",{name:"Search scope",exact:true}).click();
  assert.equal(await page.getByRole("checkbox",{name:"Include subfolders"}).isChecked(),true);
  await page.getByRole("checkbox",{name:"Include subfolders"}).uncheck();
  assert.match(await page.locator(".results-summary").textContent(),/^\s*0 results/);
  await page.getByRole("checkbox",{name:"Include subfolders"}).check();
  assert.match(await page.locator(".results-summary").textContent(),/10000/);
  await page.keyboard.press("Escape");
  await page.locator(".sound-row").first().click();
  await page.locator(".effects-button").focus();
  await page.keyboard.press("Space");
  await page.locator(".effects-rack").waitFor({state:"visible"});
  await page.keyboard.press("Escape");
  assert.deepEqual(errors,[]);
  console.log("Product checks passed: 10,000 sounds, nested scope, virtual scrolling, five dock sizes, FX hit-testing over pinned sidebar, details layering, focus and keyboard activation.");
} finally {await browser.close();}
