import {
  createLibraryTabs,
  createSearchTab,
  updateSearchTabFolder,
  updateSearchTabQuery,
} from "../src/js/main/searchTabs";

const folderNames: Record<string, string> = {
  foley: "Foley",
  risers: "Risers",
};
const folderNameForId = (folderId: string) => folderNames[folderId] || "";
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

let tabs = createLibraryTabs();
assert(tabs[0].label === "All sounds" && tabs[0].folderId === "all", "The library tab should start at All sounds.");

tabs = updateSearchTabFolder(tabs, tabs[0].id, "foley", folderNameForId);
assert(tabs[0].label === "Foley" && tabs[0].folderId === "foley", "Selecting a folder should name and scope the active tab.");

const secondTab = createSearchTab("search-2", tabs[0].folderId, folderNameForId);
tabs = [...tabs, secondTab];
assert(secondTab.label === "Foley", "A new tab should inherit the current folder name.");

const firstTabBeforeSecondUpdate = tabs[0];
tabs = updateSearchTabFolder(tabs, secondTab.id, "risers", folderNameForId);
assert(tabs[0].folderId === "foley" && tabs[0].label === "Foley", "Changing one tab must not change another tab's folder.");
assert(tabs[0] === firstTabBeforeSecondUpdate, "Unchanged tabs should retain object identity and avoid unnecessary rerenders.");
assert(tabs[1].folderId === "risers" && tabs[1].label === "Risers", "The active tab should remember its own folder.");

tabs = updateSearchTabQuery(tabs, secondTab.id, "  impact  ", folderNameForId);
assert(tabs[1].label === "impact", "A search query should take priority in the tab title.");

tabs = updateSearchTabQuery(tabs, secondTab.id, "", folderNameForId);
assert(tabs[1].label === "Risers", "Clearing a query should restore the selected folder name.");

const emptyTab = createSearchTab("search-3", "all", folderNameForId);
assert(emptyTab.label === "New search", "An unscoped empty tab should keep the New search label.");

const missingFolderTab = createSearchTab("search-4", "missing", folderNameForId);
assert(missingFolderTab.label === "New search", "A missing folder should fall back to a safe tab label.");

tabs = updateSearchTabFolder(tabs, tabs[0].id, "all", folderNameForId);
assert(tabs[0].label === "All sounds", "Returning the library tab to the root should restore All sounds.");
assert(tabs[1].folderId === "risers", "Resetting one tab must preserve every other tab's folder scope.");

console.log("Search tab smoke test passed.");
