import type { components } from "@zenodotus/api-spec/schema";
import { requestGrouping } from "@/utils/api";
import { colorForGroup } from "@/utils/color";

type TabInfo = components["schemas"]["TabInfo"];
type ExistingGroup = components["schemas"]["ExistingGroup"];
type GroupResponse = components["schemas"]["GroupResponse"];
type NonEmptyArray<T> = [T, ...T[]];

const log = (...args: unknown[]) => console.log("[zenodotus]", ...args);
const logError = (...args: unknown[]) => console.error("[zenodotus]", ...args);

export default defineBackground(() => {
  // Batching: debounce 2s + max wait 10s
  const DEBOUNCE_MS = 2000;
  const MAX_WAIT_MS = 10000;
  const pendingTabs = new Set<chrome.tabs.Tab>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

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

  async function getExistingGroups(): Promise<ExistingGroup[]> {
    const allTabs = await chrome.tabs.query({ windowType: "normal" });
    const groupMap = new Map<number, number[]>();

    for (const tab of allTabs) {
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

  async function applyGrouping(result: GroupResponse): Promise<void> {
    log("applying grouping:", result.groups.length, "groups");

    const nameToGroup = new Map<string, { groupId: number; name: string }>();
    const allTabs = await chrome.tabs.query({ windowType: "normal" });
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
          log("tab no longer exists:", tabId);
        }
      }
      const [first, ...rest] = validTabIds;
      if (first == null) continue;
      const tabIds: NonEmptyArray<number> = [first, ...rest];

      const match = group.name ? nameToGroup.get(normalizeName(group.name)) : undefined;
      let targetGroupId = group.groupId ?? match?.groupId;

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
          const newGroupId = await chrome.tabs.group({ tabIds });
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

  async function organizeAllTabs(): Promise<void> {
    log("organizeAllTabs start");
    const allTabs = await chrome.tabs.query({ windowType: "normal" });
    const existingGroups = await getExistingGroups();
    const { prompt, model, thinking, provider } = await chrome.storage.local.get({
      prompt: "",
      model: "",
      thinking: false,
      provider: "",
    });
    const tabInfoResults = await Promise.all(allTabs.map(collectTabInfo));
    const tabInfos = tabInfoResults.filter((t): t is TabInfo => t !== null);
    log("sending", tabInfos.length, "tabs,", existingGroups.length, "existing groups to server");

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
      await applyGrouping(result);
    } else {
      logError("server returned no result");
    }
    log("organizeAllTabs done");
  }

  function flush(): void {
    if (debounceTimer != null) clearTimeout(debounceTimer);
    if (maxWaitTimer != null) clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
    void flushPendingTabs().catch((err) => logError("auto-group flush failed:", err));
  }

  async function flushPendingTabs(): Promise<void> {
    const tabs = Array.from(pendingTabs);
    pendingTabs.clear();

    if (tabs.length === 0) return;

    log("auto-group: flushing", tabs.length, "pending tabs");
    const existingGroups = await getExistingGroups();
    const { prompt, model, thinking, provider } = await chrome.storage.local.get({
      prompt: "",
      model: "",
      thinking: false,
      provider: "",
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
      provider: provider || undefined,
    });

    if (result) {
      log("auto-group: server returned", result.groups.length, "groups");
      await applyGrouping(result);
    } else {
      logError("auto-group: server returned no result");
    }
  }

  chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    const { autoGroupEnabled } = await chrome.storage.local.get({
      autoGroupEnabled: false,
    });
    if (!autoGroupEnabled) return;
    if (changeInfo.status !== "complete") return;
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;

    log("auto-group: tab loaded", tab.id, tab.url?.slice(0, 60));
    pendingTabs.add(tab);

    if (debounceTimer != null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);

    if (maxWaitTimer == null) {
      maxWaitTimer = setTimeout(flush, MAX_WAIT_MS);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "organize") {
      log("organize triggered from popup");
      chrome.storage.local.set({ organizeStatus: "organizing" });
      const organizeTimeout = setTimeout(() => {
        logError("organize timed out after 30s");
        chrome.storage.local.set({ organizeStatus: "error", organizeError: "Timed out" });
      }, 30000);
      organizeAllTabs()
        .then(() => {
          clearTimeout(organizeTimeout);
          chrome.storage.local.set({ organizeStatus: "done" });
        })
        .catch((err) => {
          clearTimeout(organizeTimeout);
          logError("organize failed:", err);
          chrome.storage.local.set({
            organizeStatus: "error",
            organizeError: err instanceof Error ? err.message : "Unknown error",
          });
        });
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
