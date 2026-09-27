import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Exercise the actual panel predicate so a restored folder restriction fails this test.
const source = readFileSync(new URL("../src/js/main/App.svelte", import.meta.url), "utf8");
const body = source.split("let localVisibleSounds = $derived.by(() => {")[1]?.split("\n  });")[0];
assert.ok(body, "Local result filter must be present");
const filterSounds = new Function("sounds", "localSourceEnabled", "activeTab", "selectedFolder", "selectedDirectoryIds", "filter", "labelFilter", "soundSearchText", "favoriteCollection", body);
const sounds = [
  { id: "a", directoryId: "one", favorite: true, name: "Click", tags: [], duration: 1 },
  { id: "b", directoryId: "two", favorite: true, name: "Whoosh", tags: [], duration: 2 },
  { id: "c", directoryId: "two", favorite: false, name: "Impact", tags: [], duration: 3 },
];
const results = (folder, filter, query = "", collection = "all") => filterSounds(
  sounds, true, { query }, folder, new Set([folder]), filter, undefined,
  sound => sound.name.toLowerCase(), collection,
).map(sound => sound.id);
for (const folder of ["one", "two", "all", "missing"]) {
  assert.deepEqual(results(folder, "favorites"), ["a", "b"], `Favorites must ignore folder ${folder}`);
}
assert.deepEqual(results("one", "all"), ["a"], "All must retain the selected folder scope");
assert.deepEqual(results("two", "all"), ["b", "c"]);
assert.deepEqual(results("one", "favorites", "whoosh"), ["b"], "Search must work across favorite folders");
sounds[1].favoriteCollection = "whooshes";
assert.deepEqual(results("one", "favorites", "", "whooshes"), ["b"], "Collection selection must ignore local folder scope");
assert.deepEqual(results("two", "favorites", "", ""), ["a"], "Main Favorites excludes assigned collection references");
sounds[1].favoriteCollection = "impacts";
assert.deepEqual(results("one", "favorites", "", "whooshes"), [], "Moving must remove the old collection reference");
console.log("Favorites folder-scope regression tests passed.");
