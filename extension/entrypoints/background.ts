import type { components } from "@zenodotus/api-spec/schema";
import { requestGrouping } from "@/utils/api";
import { colorForGroup } from "@/utils/color";

type TabInfo = components["schemas"]["TabInfo"];
type ExistingGroup = components["schemas"]["ExistingGroup"];
type GroupResponse = components["schemas"]["GroupResponse"];
type NonEmptyArray<T> = [T, ...T[]];

export default defineBackground(() => {
  // Batching: debounce 2s + max wait 10s
  const DEBOUNCE_MS = 2000;
  const MAX_WAIT_MS = 10000;
  const pendingTabs = new Set<chrome.tabs.Tab>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Normalize group name for fuzzy matching: lowercase + strip whitespace
  function normalizeName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, "");
  }

  async function applyGrouping(result: GroupResponse): Promise<void> {
    // Build normalized name → { groupId, originalName } map from existing groups
    const nameToGroup = new Map<string, { groupId: number; name: string }>();
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
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
          await chrome.tabs.get(tabId);
          validTabIds.push(tabId);
        } catch {
          // tab no longer exists
        }
      }
      const [first, ...rest] = validTabIds;
      if (first == null) continue;
      const tabIds: NonEmptyArray<number> = [first, ...rest];

      // Resolve target groupId: explicit > fuzzy name match > create new
      const match = group.name ? nameToGroup.get(normalizeName(group.name)) : undefined;
      let targetGroupId = group.groupId ?? match?.groupId;

      if (targetGroupId != null) {
        try {
          await chrome.tabs.group({ tabIds, groupId: targetGroupId });
          // Keep the original name, don't rename to LLM's variant
        } catch {
          targetGroupId = undefined;
        }
      }

      if (targetGroupId == null && group.name) {
        const newGroupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(newGroupId, {
          title: group.name,
          color: colorForGroup(group.name),
        });
        nameToGroup.set(normalizeName(group.name), { groupId: newGroupId, name: group.name });
      }
    }
  }

  async function organizeAllTabs(): Promise<void> {
    const allTabs = await chrome.tabs.query({});
    const existingGroups = await getExistingGroups();
    const { prompt, model, thinking } = await chrome.storage.local.get({
      prompt: "",
      model: "",
      thinking: false,
    });
    const tabInfoResults = await Promise.all(allTabs.map(collectTabInfo));
    // I2: filter out nulls from collectTabInfo
    const tabInfos = tabInfoResults.filter((t): t is TabInfo => t !== null);

    const result = await requestGrouping({
      tabs: tabInfos,
      existingGroups,
      prompt,
      model: model || undefined,
      thinking: thinking || undefined,
    });

    if (result) await applyGrouping(result);
  }

  function flush(): void {
    if (debounceTimer != null) clearTimeout(debounceTimer);
    if (maxWaitTimer != null) clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
    flushPendingTabs();
  }

  async function flushPendingTabs(): Promise<void> {
    const tabs = Array.from(pendingTabs);
    pendingTabs.clear();

    if (tabs.length === 0) return;

    const existingGroups = await getExistingGroups();
    const { prompt, model, thinking } = await chrome.storage.local.get({
      prompt: "",
      model: "",
      thinking: false,
    });
    const tabInfoResults = await Promise.all(tabs.map(collectTabInfo));
    const tabInfos = tabInfoResults.filter((t): t is TabInfo => t !== null);

    if (tabInfos.length === 0) return;

    const result = await requestGrouping({
      tabs: tabInfos,
      existingGroups,
      prompt,
      model: model || undefined,
      thinking: thinking || undefined,
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

    pendingTabs.add(tab);

    // Reset debounce timer on each new tab
    if (debounceTimer != null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);

    // Start max wait timer on first tab in batch
    if (maxWaitTimer == null) {
      maxWaitTimer = setTimeout(flush, MAX_WAIT_MS);
    }
  });

  // Message handling from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "organize") {
      chrome.storage.local.set({ organizeStatus: "organizing" });
      const organizeTimeout = setTimeout(() => {
        chrome.storage.local.set({ organizeStatus: "error", organizeError: "Timed out" });
      }, 30000);
      organizeAllTabs()
        .then(() => {
          clearTimeout(organizeTimeout);
          chrome.storage.local.set({ organizeStatus: "done" });
        })
        .catch((err) => {
          clearTimeout(organizeTimeout);
          chrome.storage.local.set({
            organizeStatus: "error",
            organizeError: err instanceof Error ? err.message : "Unknown error",
          });
        });
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
