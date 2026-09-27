import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/js/main/App.svelte", import.meta.url), "utf8");
assert.match(source, /let includeSubfolders = \$state\(true\)/, "Nested folder search is enabled on launch");
const scopeBody = source.split("let selectedDirectoryIds = $derived.by(() => {")[1].split("\n  });")[0].replace("new Set<string>()", "new Set()");
const scope = new Function("selectedFolder", "folderNodesById", "includeSubfolders", "collectTreeIds", scopeBody);
const child = { id: "child", children: [] };
const parent = { id: "parent", children: [child] };
const nodes = new Map([[parent.id, parent], [child.id, child]]);
const collect = (node, ids) => { ids.add(node.id); node.children.forEach(child => collect(child, ids)); };
const body = source.split("let localVisibleSounds = $derived.by(() => {")[1].split("\n  });")[0];
const filterSounds = new Function("sounds", "localSourceEnabled", "activeTab", "selectedFolder", "selectedDirectoryIds", "filter", "labelFilter", "soundSearchText", "favoriteCollection", body);
const sounds = [
  ...Array.from({length: 3}, (_, i) => ({ id: `p${i}`, directoryId: "parent", name: "impact", tags: [], duration: 1 })),
  ...Array.from({length: 2}, (_, i) => ({ id: `c${i}`, directoryId: "child", name: "beep", tags: [], duration: 1 })),
];
const results = (folder, recursive = false, query = "") => filterSounds(sounds, true, {query}, folder,
  scope(folder, nodes, recursive, collect), "all", undefined, sound => sound.name.toLowerCase(), "all");
assert.equal(results("parent").length, 3);
assert.equal(results("child").length, 2);
assert.equal(results("parent", true).length, 5);
assert.equal(results("missing").length, 0);
assert.equal(results("all").length, 5);
assert.equal(results("child", false, "beep").length, 2);
assert.equal(results("child", false, "absent").length, 0);
assert.equal(results("child", false, "").length, 2);
assert.match(source, /freesoundSounds = \[\];\n    freesoundTotal = 0;\n    freesoundHasNext = false;\n    freesoundStatus = query.length/);
assert.doesNotMatch(source, /selectedId = visibleSounds\[0\].id/);
assert.match(source, /if \(!sidebarPinned\) sidebarOpen = false/);
console.log("Folder scope, search replacement, empty-folder and sidebar regressions passed.");
