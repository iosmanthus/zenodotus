import type { components } from "@zenodotus/api-spec/schema";
import { requestGrouping } from "@/utils/api";
import { colorForGroup } from "@/utils/color";

type TabInfo = components["schemas"]["TabInfo"];
type ExistingGroup = components["schemas"]["ExistingGroup"];
type GroupResponse = components["schemas"]["GroupResponse"];
type NonEmptyArray<T> = [T, ...T[]];

export default defineBackground(() => {
  // S2: debounce auto-grouping — collect pending tabs and batch into one request
  const pendingTabs = new Set<chrome.tabs.Tab>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function getMetaDescription(tabId: number): Promise<string> {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        func: () => {
          const meta = document.querySelector('meta[name="description"]');
          return meta ? meta.getAttribute("content") || "" : "";
        },
      });
      return (results?.[0]?.result as string) || "";
    } catch {
      return "";
    }
  }

  // I2: return null if tab.id or tab.windowId is undefined
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

  async function getExistingGroups(): Promise<ExistingGroup[]> {
    const allTabs = await chrome.tabs.query({});
    const groupMap = new Map<number, number[]>();

    for (const tab of allTabs) {
      // I2: guard against undefined tab.id
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

  async function applyGrouping(result: GroupResponse): Promise<void> {
    for (const group of result.groups) {
      if (!group.tabIds.length) continue;

      const validTabIds = [];
      for (const tabId of group.tabIds) {
        try {
          await chrome.tabs.get(tabId);
          validTabIds.push(tabId);
        } catch {
          // tab no longer exists
        }
      }
      const [first, ...rest] = validTabIds;
      if (first == null) continue;
      const tabIds: NonEmptyArray<number> = [first, ...rest];

      if (group.groupId != null) {
        try {
          await chrome.tabs.group({
            tabIds,
            groupId: group.groupId,
          });
          if (group.name) {
            await chrome.tabGroups.update(group.groupId, {
              title: group.name,
            });
          }
        } catch {
          if (group.name) {
            await createNewGroup(group.name, tabIds);
          }
        }
      } else if (group.name) {
        await createNewGroup(group.name, tabIds);
      }
    }
  }

  async function createNewGroup(name: string, tabIds: NonEmptyArray<number>): Promise<void> {
    try {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: name,
        color: colorForGroup(name),
      });
    } catch (err) {
      console.error("Failed to create group:", err);
    }
  }

  async function organizeAllTabs(): Promise<void> {
    const allTabs = await chrome.tabs.query({});
    const existingGroups = await getExistingGroups();
    const { prompt } = await chrome.storage.local.get({ prompt: "" });
    const tabInfoResults = await Promise.all(allTabs.map(collectTabInfo));
    // I2: filter out nulls from collectTabInfo
    const tabInfos = tabInfoResults.filter((t): t is TabInfo => t !== null);

    const result = await requestGrouping({
      tabs: tabInfos,
      existingGroups,
      prompt,
    });

    if (result) await applyGrouping(result);
  }

  // S2: flush pending tabs in a single batched request
  async function flushPendingTabs(): Promise<void> {
    const tabs = Array.from(pendingTabs);
    pendingTabs.clear();
    debounceTimer = null;

    if (tabs.length === 0) return;

    const existingGroups = await getExistingGroups();
    const { prompt } = await chrome.storage.local.get({ prompt: "" });
    const tabInfoResults = await Promise.all(tabs.map(collectTabInfo));
    const tabInfos = tabInfoResults.filter((t): t is TabInfo => t !== null);

    if (tabInfos.length === 0) return;

    const result = await requestGrouping({
      tabs: tabInfos,
      existingGroups,
      prompt,
    });

    if (result) await applyGrouping(result);
  }

  // Auto trigger with S2 debounce
  chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    // I1: read autoGroupEnabled from storage
    const { autoGroupEnabled } = await chrome.storage.local.get({
      autoGroupEnabled: false,
    });
    if (!autoGroupEnabled) return;
    if (changeInfo.status !== "complete") return;
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;

    // S2: add to pending set and reset debounce timer
    pendingTabs.add(tab);
    if (debounceTimer != null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      flushPendingTabs();
    }, 2000);
  });

  // Message handling from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "organize") {
      // Fire and forget — don't block on sendResponse
      chrome.storage.local.set({ organizeStatus: "organizing" });
      organizeAllTabs()
        .then(() => chrome.storage.local.set({ organizeStatus: "done" }))
        .catch((err) =>
          chrome.storage.local.set({
            organizeStatus: "error",
            organizeError: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      sendResponse({ success: true });
      return false;
    }

    if (msg.action === "setAutoGroup") {
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
