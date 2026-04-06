import type { TabInfo, ExistingGroup, GroupResponse } from "@zenodotus/api-spec";
import { requestGrouping } from "@/utils/api";
import { colorForGroup } from "@/utils/color";

type NonEmptyArray<T> = [T, ...T[]];

const log = (...args: unknown[]) => console.log("[zenodotus]", ...args);
const logError = (...args: unknown[]) => console.error("[zenodotus]", ...args);

export default defineBackground(() => {
  const DEBOUNCE_MS = 5000;
  const dirtyWindows = new Set<number>();
  const flushingWindows = new Set<number>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function getMetaDescription(tabId: number): Promise<string> {
    try {
      const result = await Promise.race([
        browser.scripting.executeScript({
          target: { tabId },
          func: () => {
            const meta = document.querySelector('meta[name="description"]');
            return meta ? meta.getAttribute("content") || "" : "";
          },
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!result) {
        log("meta description timeout for tab", tabId);
        return "";
      }
      return (result[0]?.result as string) || "";
    } catch {
      return "";
    }
  }

  async function collectTabInfo(tab: chrome.tabs.Tab): Promise<TabInfo | null> {
    if (tab.id == null || tab.windowId == null) return null;

    const description = await getMetaDescription(tab.id);
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || "",
      title: tab.title || "",
      description,
    };
  }

  async function getExistingGroups(windowId: number): Promise<ExistingGroup[]> {
    const tabs = await chrome.tabs.query({ windowId });
    const groupMap = new Map<number, number[]>();

    for (const tab of tabs) {
      if (tab.id == null) continue;
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        if (!groupMap.has(tab.groupId)) {
          groupMap.set(tab.groupId, []);
        }
        groupMap.get(tab.groupId)!.push(tab.id);
      }
    }

    const groups: ExistingGroup[] = [];
    for (const [groupId, tabIds] of groupMap) {
      try {
        const group = await chrome.tabGroups.get(groupId);
        groups.push({ groupId, name: group.title || "", tabIds });
      } catch {
        // group may have been removed
      }
    }
    return groups;
  }

  function normalizeName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, "");
  }

  async function applyGrouping(result: GroupResponse, windowId: number): Promise<void> {
    log("applying grouping:", result.groups.length, "groups for window", windowId);

    const windowGroupIds = new Set<number>();
    const nameToGroup = new Map<string, { groupId: number; name: string }>();
    const windowTabs = await chrome.tabs.query({ windowId });
    for (const tab of windowTabs) {
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        windowGroupIds.add(tab.groupId);
        try {
          const g = await chrome.tabGroups.get(tab.groupId);
          const key = normalizeName(g.title || "");
          if (key && !nameToGroup.has(key)) {
            nameToGroup.set(key, { groupId: tab.groupId, name: g.title || "" });
          }
        } catch {
          // group removed
        }
      }
    }

    for (const group of result.groups) {
      if (!group.tabIds.length) continue;

      const validTabIds = [];
      for (const tabId of group.tabIds) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.windowId === windowId) {
            validTabIds.push(tabId);
          }
        } catch {
          log("tab no longer exists:", tabId);
        }
      }
      const [first, ...rest] = validTabIds;
      if (first == null) continue;
      const tabIds: NonEmptyArray<number> = [first, ...rest];

      const match = group.name ? nameToGroup.get(normalizeName(group.name)) : undefined;
      // Only use groupId if it belongs to this window
      const candidateGroupId = group.groupId ?? match?.groupId;
      let targetGroupId = candidateGroupId != null && windowGroupIds.has(candidateGroupId)
        ? candidateGroupId
        : match?.groupId;

      if (targetGroupId != null) {
        try {
          await chrome.tabs.group({ tabIds, groupId: targetGroupId });
          log("moved", tabIds.length, "tabs into existing group", targetGroupId, match?.name || "");
        } catch (err) {
          logError("failed to move tabs into group", targetGroupId, err);
          targetGroupId = undefined;
        }
      }

      if (targetGroupId == null && group.name) {
        try {
          const newGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
          await chrome.tabGroups.update(newGroupId, {
            title: group.name,
            color: colorForGroup(group.name),
          });
          nameToGroup.set(normalizeName(group.name), { groupId: newGroupId, name: group.name });
          log("created group", JSON.stringify(group.name), "with", tabIds.length, "tabs");
        } catch (err) {
          logError("failed to create group", JSON.stringify(group.name), err);
        }
      }
    }
  }

  async function organizeAllTabs(windowId: number): Promise<void> {
    log("organizeAllTabs start for window", windowId);
    const windowTabs = await chrome.tabs.query({ windowId });
    const existingGroups = await getExistingGroups(windowId);
    const { prompt, model, thinking, provider } = await chrome.storage.local.get({
      prompt: "",
      model: "",
      thinking: false,
      provider: "",
    });
    const tabInfoResults = await Promise.all(windowTabs.map(collectTabInfo));
    const tabInfos = tabInfoResults.filter((t): t is TabInfo => t !== null);
    log("sending", tabInfos.length, "tabs,", existingGroups.length, "existing groups for window", windowId);

    const result = await requestGrouping({
      tabs: tabInfos,
      existingGroups,
      prompt,
      model: model || undefined,
      thinking: thinking || undefined,
      provider: provider || undefined,
    });

    if (result) {
      log("server returned", result.groups.length, "groups");
      await applyGrouping(result, windowId);
    } else {
      logError("server returned no result");
    }
    log("organizeAllTabs done");
  }

  async function ungroupAll(windowId: number): Promise<void> {
    const tabs = await chrome.tabs.query({ windowId });
    const groupedTabIds = tabs
      .filter((t) => t.id != null && t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
      .map((t) => t.id!);
    const [first, ...rest] = groupedTabIds;
    if (first == null) return;
    log("ungrouping", groupedTabIds.length, "tabs in window", windowId);
    chrome.tabs.ungroup([first, ...rest]);
  }

  function markDirty(windowId: number): void {
    dirtyWindows.add(windowId);
    if (debounceTimer != null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushAll, DEBOUNCE_MS);
  }

  function flushAll(): void {
    debounceTimer = null;
    const windows = [...dirtyWindows];
    dirtyWindows.clear();
    for (const windowId of windows) {
      void flushWindow(windowId).catch((err) =>
        logError("auto-group flush failed for window", windowId, err),
      );
    }
  }

  async function flushWindow(windowId: number): Promise<void> {
    if (flushingWindows.has(windowId)) {
      markDirty(windowId);
      return;
    }

    flushingWindows.add(windowId);
    try {
      const allTabs = await chrome.tabs.query({ windowId });
      const { minTabsToGroup } = await chrome.storage.local.get({ minTabsToGroup: 0 });
      if (minTabsToGroup > 0 && allTabs.length < minTabsToGroup) {
        log("auto-group: window", windowId, "has", allTabs.length, "tabs, below minimum", minTabsToGroup);
        await ungroupAll(windowId);
        return;
      }
      await organizeAllTabs(windowId);
    } finally {
      flushingWindows.delete(windowId);
    }
  }

  async function isAutoGroupEnabled(): Promise<boolean> {
    const { autoGroupEnabled } = await chrome.storage.local.get({ autoGroupEnabled: false });
    return autoGroupEnabled as boolean;
  }

  async function onTabUpdated(...[, changeInfo, tab]: Parameters<Parameters<typeof chrome.tabs.onUpdated.addListener>[0]>) {
    if (!changeInfo.url) return;
    if (!(await isAutoGroupEnabled())) return;
    if (tab.windowId == null) return;
    log("auto-group: tab URL changed", tab.id, tab.url?.slice(0, 60));
    markDirty(tab.windowId);
  }

  async function onTabCreated(...[tab]: Parameters<Parameters<typeof chrome.tabs.onCreated.addListener>[0]>) {
    if (!(await isAutoGroupEnabled())) return;
    if (tab.windowId == null) return;
    log("auto-group: tab created", tab.id);
    markDirty(tab.windowId);
  }

  async function onTabRemoved(...[, removeInfo]: Parameters<Parameters<typeof chrome.tabs.onRemoved.addListener>[0]>) {
    if (removeInfo.isWindowClosing) return;
    if (!(await isAutoGroupEnabled())) return;
    log("auto-group: tab removed from window", removeInfo.windowId);
    markDirty(removeInfo.windowId);
  }

  async function onTabAttached(...[, attachInfo]: Parameters<Parameters<typeof chrome.tabs.onAttached.addListener>[0]>) {
    if (!(await isAutoGroupEnabled())) return;
    log("auto-group: tab attached to window", attachInfo.newWindowId);
    markDirty(attachInfo.newWindowId);
  }

  async function handleOrganize(windowId: number) {
    const allTabs = await chrome.tabs.query({ windowId });
    const { minTabsToGroup } = await chrome.storage.local.get({ minTabsToGroup: 0 });
    if (minTabsToGroup > 0 && allTabs.length < minTabsToGroup) {
      chrome.storage.local.set({
        organizeStatus: "error",
        organizeError: `Need at least ${minTabsToGroup} tabs to group (currently ${allTabs.length})`,
      });
      return;
    }
    chrome.storage.local.set({ organizeStatus: "organizing" });
    const organizeTimeout = setTimeout(() => {
      logError("organize timed out after 30s");
      chrome.storage.local.set({ organizeStatus: "error", organizeError: "Timed out" });
    }, 30000);
    try {
      await organizeAllTabs(windowId);
      clearTimeout(organizeTimeout);
      chrome.storage.local.set({ organizeStatus: "done" });
    } catch (err) {
      clearTimeout(organizeTimeout);
      logError("organize failed:", err);
      chrome.storage.local.set({
        organizeStatus: "error",
        organizeError: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  chrome.tabs.onUpdated.addListener(onTabUpdated);
  chrome.tabs.onCreated.addListener(onTabCreated);
  chrome.tabs.onRemoved.addListener(onTabRemoved);
  chrome.tabs.onAttached.addListener(onTabAttached);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "organize") {
      log("organize triggered from popup");
      void handleOrganize(msg.windowId as number);
      sendResponse({ success: true });
      return false;
    }

    if (msg.action === "setAutoGroup") {
      log("setAutoGroup:", msg.enabled);
      chrome.storage.local.set({ autoGroupEnabled: msg.enabled });
      sendResponse({ success: true });
      return false;
    }

    if (msg.action === "getAutoGroup") {
      (async () => {
        const data = await chrome.storage.local.get({ autoGroupEnabled: false });
        sendResponse({ autoGroupEnabled: data.autoGroupEnabled as boolean });
      })();
      return true;
    }
  });
});
