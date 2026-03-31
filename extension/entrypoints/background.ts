import type { components } from "@zenodotus/api-spec/schema";
import { requestGrouping } from "@/utils/api";
import { colorForGroup } from "@/utils/color";

type TabInfo = components["schemas"]["TabInfo"];
type ExistingGroup = components["schemas"]["ExistingGroup"];
type GroupResponse = components["schemas"]["GroupResponse"];

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
      if (tab.groupId !== -1 && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        if (!groupMap.has(tab.groupId)) {
          groupMap.set(tab.groupId, []);
        }
        const group = groupMap.get(tab.groupId);
        if (group) {
          group.push(tab.id);
        }
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
    if (!result?.groups) return;

    for (const group of result.groups) {
      if (!group.tabIds?.length) continue;

      const validTabIds: number[] = [];
      for (const tabId of group.tabIds) {
        try {
          await chrome.tabs.get(tabId);
          validTabIds.push(tabId);
        } catch {
          // tab no longer exists
        }
      }
      if (validTabIds.length === 0) continue;

      if (group.groupId != null) {
        try {
          await chrome.tabs.group({
            tabIds: validTabIds as [number, ...number[]],
            groupId: group.groupId,
          });
          if (group.name) {
            await chrome.tabGroups.update(group.groupId, {
              title: group.name,
            });
          }
        } catch {
          if (group.name) {
            await createNewGroup(group.name, validTabIds);
          }
        }
      } else if (group.name) {
        await createNewGroup(group.name, validTabIds);
      }
    }
  }

  async function createNewGroup(name: string, tabIds: number[]): Promise<void> {
    try {
      const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
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
    if (tab.groupId !== -1 && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;

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
      organizeAllTabs()
        .then(() => sendResponse({ success: true }))
        .catch((err: Error) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // I1: persist autoGroupEnabled to chrome.storage.local
    if (msg.action === "setAutoGroup") {
      chrome.storage.local
        .set({ autoGroupEnabled: msg.enabled })
        .then(() =>
          sendResponse({
            success: true,
            autoGroupEnabled: msg.enabled,
          }),
        )
        .catch((err: Error) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // I1: read autoGroupEnabled from chrome.storage.local
    if (msg.action === "getAutoGroup") {
      chrome.storage.local
        .get({ autoGroupEnabled: false })
        .then((data) =>
          sendResponse({ autoGroupEnabled: data.autoGroupEnabled as boolean }),
        )
        .catch(() => sendResponse({ autoGroupEnabled: false }));
      return true;
    }
  });
});
