import type { SearchTab } from "./types";

export type FolderNameResolver = (folderId: string) => string;

export const createLibraryTabs = (): SearchTab[] => [{
  id: "search-library",
  label: "All sounds",
  query: "",
  folderId: "all",
}];

export const searchTabLabel = (tab: SearchTab, folderNameForId: FolderNameResolver) => tab.query.trim()
  || folderNameForId(tab.folderId)
  || (tab.id === "search-library" ? "All sounds" : "New search");

export const updateSearchTabFolder = (
  tabs: SearchTab[],
  activeTabId: string,
  folderId: string,
  folderNameForId: FolderNameResolver,
) => tabs.map((tab) => {
  if (tab.id !== activeTabId) return tab;
  const updatedTab = { ...tab, folderId };
  return { ...updatedTab, label: searchTabLabel(updatedTab, folderNameForId) };
});

export const updateSearchTabQuery = (
  tabs: SearchTab[],
  activeTabId: string,
  query: string,
  folderNameForId: FolderNameResolver,
) => tabs.map((tab) => {
  if (tab.id !== activeTabId) return tab;
  const updatedTab = { ...tab, query };
  return { ...updatedTab, label: searchTabLabel(updatedTab, folderNameForId) };
});

export const createSearchTab = (
  id: string,
  folderId: string,
  folderNameForId: FolderNameResolver,
): SearchTab => {
  const tab: SearchTab = { id, label: "", query: "", folderId };
  return { ...tab, label: searchTabLabel(tab, folderNameForId) };
};
