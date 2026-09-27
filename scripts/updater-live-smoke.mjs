// Exercise the shipping updater against public GitHub, with a simulated CEP
// Node bridge and installed version. No Adobe host or user settings are modified.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const [installedVersion, expectedStatus, expectedLatest] = process.argv.slice(2);
if (!installedVersion || !expectedStatus || !expectedLatest) throw new Error("Usage: node scripts/updater-live-smoke.mjs INSTALLED STATUS LATEST");
const result = await build({entryPoints:["src/js/main/updater.ts"],bundle:true,write:false,platform:"node",format:"cjs",plugins:[{
  name:"updater-runtime-fixture",
  setup(builder) {
    builder.onResolve({filter:/lib\/cep\/node$/},()=>({path:"cep-node",namespace:"fixture"}));
    builder.onResolve({filter:/package\.json$/},()=>({path:"package",namespace:"fixture"}));
    builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="cep-node" ? 'export {default as https} from "node:https";' : `export const version=${JSON.stringify(installedVersion)};`,loader:"js"}));
  }
}]});
const cache=new Map();
const module={exports:{}};
runInNewContext(result.outputFiles[0].text,{
  module,exports:module.exports,require:createRequire(import.meta.url),console,
  window:{cep:{}},navigator:{platform:"MacIntel"},
  localStorage:{getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)},
});
const state=await module.exports.checkForUpdates(true);
assert.equal(state.status,expectedStatus,JSON.stringify(state));
assert.equal(state.latestVersion,expectedLatest);
assert.equal(state.assetName,`SoundDesigner-v${expectedLatest}.zxp`);
assert.equal(state.downloadUrl,`https://github.com/iboyshanto/SoundDesigner/releases/download/v${expectedLatest}/SoundDesigner-v${expectedLatest}.zxp`);
console.log(`Installed ${installedVersion}: ${state.status}; latest ${state.latestVersion}; ${state.assetName}`);
