import type { ExistingGroup, GroupResponse, TabInfo } from "@zenodotus/api-spec";
import {
  type ChromeAdapter,
  createChromeAdapter,
  TAB_GROUP_ID_NONE,
  type TabData,
} from "@/utils/chrome-adapter";
import { colorForGroup } from "@/utils/color";
import { createScheduler } from "@/utils/scheduler";

const log = (...args: unknown[]) => console.log("[zenodotus]", ...args);
const logError = (...args: unknown[]) => console.error("[zenodotus]", ...args);

export function initBackground(adapter: ChromeAdapter) {
  const DEBOUNCE_MS = 1000;

  // Per-window cache: if URL set unchanged, reuse last LLM result locally
  const groupingCache = new Map<number, { urlKey: string; urlToGroup: Map<string, string> }>();

  function normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean).slice(0, 2);
      return parsed.origin + (parts.length ? "/" + parts.join("/") : "");
    } catch {
      return url;
    }
  }

  function buildUrlKey(urls: string[]): string {
    return [...new Set(urls.map(normalizeUrl))].sort().join("\n");
  }

  function buildCachedResponse(tabInfos: TabInfo[], cache: Map<string, string>): GroupResponse {
    const groupMap = new Map<string, number[]>();
    for (const tab of tabInfos) {
      const groupName = cache.get(normalizeUrl(tab.url));
      if (groupName) {
        if (!groupMap.has(groupName)) groupMap.set(groupName, []);
        groupMap.get(groupName)?.push(tab.tabId);
      }
    }
    return {
      groups: Array.from(groupMap, ([name, tabIds]) => ({ name, tabIds })),
    };
  }

  function updateCache(
    windowId: number,
    urlKey: string,
    result: GroupResponse,
    tabInfos: TabInfo[],
    existingGroups: ExistingGroup[],
  ) {
    const tabIdToUrl = new Map<number, string>();
    for (const tab of tabInfos) tabIdToUrl.set(tab.tabId, normalizeUrl(tab.url));

    const groupIdToName = new Map<number, string>();
    for (const eg of existingGroups) groupIdToName.set(eg.groupId, eg.name);

    const urlToGroup = new Map<string, string>();
    for (const group of result.groups) {
      const name = group.name || (group.groupId != null ? groupIdToName.get(group.groupId) : undefined);
      if (!name) continue;
      for (const tabId of group.tabIds) {
        const url = tabIdToUrl.get(tabId);
        if (url) urlToGroup.set(url, name);
      }
    }
    groupingCache.set(windowId, { urlKey, urlToGroup });
  }

  async function collectTabInfo(tab: TabData): Promise<TabInfo | null> {
    if (tab.id == null || tab.windowId == null) return null;

    const description = await adapter.getMetaDescription(tab.id);
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || "",
      title: tab.title || "",
      description,
    };
  }

  async function getExistingGroups(windowId: number): Promise<ExistingGroup[]> {
    const tabs = await adapter.queryTabs(windowId);
    const groupMap = new Map<number, number[]>();

    for (const tab of tabs) {
      if (tab.id == null) continue;
      if (tab.groupId !== TAB_GROUP_ID_NONE) {
        if (!groupMap.has(tab.groupId)) {
          groupMap.set(tab.groupId, []);
        }
        groupMap.get(tab.groupId)?.push(tab.id);
      }
    }

    const groups: ExistingGroup[] = [];
    for (const [groupId, tabIds] of groupMap) {
      try {
        const group = await adapter.getTabGroup(groupId);
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
    const windowTabs = await adapter.queryTabs(windowId);
    for (const tab of windowTabs) {
      if (tab.groupId !== TAB_GROUP_ID_NONE) {
        windowGroupIds.add(tab.groupId);
        try {
          const g = await adapter.getTabGroup(tab.groupId);
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

      const validTabIds: number[] = [];
      for (const tabId of group.tabIds) {
        try {
          const tab = await adapter.getTab(tabId);
          if (tab.windowId === windowId) {
            validTabIds.push(tabId);
          }
        } catch {
          log("tab no longer exists:", tabId);
        }
      }
      if (!validTabIds.length) continue;

      const match = group.name ? nameToGroup.get(normalizeName(group.name)) : undefined;
      const candidateGroupId = group.groupId ?? match?.groupId;
      let targetGroupId =
        candidateGroupId != null && windowGroupIds.has(candidateGroupId)
          ? candidateGroupId
          : match?.groupId;

      if (targetGroupId != null) {
        try {
          await adapter.groupTabs(validTabIds, targetGroupId);
          log(
            "moved",
            validTabIds.length,
            "tabs into existing group",
            targetGroupId,
            match?.name || "",
          );
        } catch (err) {
          logError("failed to move tabs into group", targetGroupId, err);
          targetGroupId = undefined;
        }
      }

      if (targetGroupId == null && group.name) {
        try {
          const newGroupId = await adapter.createGroup(validTabIds, windowId);
          await adapter.updateTabGroup(newGroupId, group.name, colorForGroup(group.name));
          nameToGroup.set(normalizeName(group.name), { groupId: newGroupId, name: group.name });
          log("created group", JSON.stringify(group.name), "with", validTabIds.length, "tabs");
        } catch (err) {
          logError("failed to create group", JSON.stringify(group.name), err);
        }
      }
    }
  }

  async function organizeAllTabs(windowId: number): Promise<void> {
    log("organizeAllTabs start for window", windowId);
    const windowTabs = await adapter.queryTabs(windowId);
    const tabInfoResults = await Promise.all(windowTabs.map(collectTabInfo));
    const tabInfos = tabInfoResults.filter((t): t is TabInfo => t !== null);

    const urlKey = buildUrlKey(tabInfos.map((t) => t.url));
    const cached = groupingCache.get(windowId);

    if (cached && cached.urlKey === urlKey) {
      log("cache hit for window", windowId, "- skipping LLM call");
      const result = buildCachedResponse(tabInfos, cached.urlToGroup);
      await applyGrouping(result, windowId);
      log("organizeAllTabs done (cached)");
      return;
    }

    const existingGroups = await getExistingGroups(windowId);
    const { prompt, model, debug, provider } = await adapter.getSettings();
    log(
      "sending",
      tabInfos.length,
      "tabs,",
      existingGroups.length,
      "existing groups for window",
      windowId,
    );

    const result = await adapter.requestGrouping({
      tabs: tabInfos,
      existingGroups,
      prompt,
      model: model || undefined,
      debug: debug || undefined,
      provider: provider || undefined,
    });

    log("server returned", result.groups.length, "groups");
    updateCache(windowId, urlKey, result, tabInfos, existingGroups);
    await applyGrouping(result, windowId);
    log("organizeAllTabs done");
  }

  const scheduler = createScheduler(
    {
      queryTabs: (windowId) => adapter.queryTabs(windowId),
      getMinTabsToGroup: () => adapter.getMinTabsToGroup(),
      organizeWindow: organizeAllTabs,
      onFlushError: (windowId, err) =>
        logError("auto-group flush failed for window", windowId, err),
    },
    DEBOUNCE_MS,
  );

  async function handleOrganize(windowId: number) {
    const allTabs = await adapter.queryTabs(windowId);
    const minTabsToGroup = await adapter.getMinTabsToGroup();
    if (minTabsToGroup > 0 && allTabs.length < minTabsToGroup) {
      adapter.setOrganizeStatus(
        "error",
        `Need at least ${minTabsToGroup} tabs to group (currently ${allTabs.length})`,
      );
      return;
    }
    adapter.setOrganizeStatus("organizing");
    const organizeTimeout = setTimeout(() => {
      logError("organize timed out after 30s");
      adapter.setOrganizeStatus("error", "Timed out");
    }, 30000);
    try {
      await organizeAllTabs(windowId);
      clearTimeout(organizeTimeout);
      adapter.setOrganizeStatus("done");
    } catch (err) {
      clearTimeout(organizeTimeout);
      logError("organize failed:", err);
      adapter.setOrganizeStatus("error", err instanceof Error ? err.message : "Unknown error");
    }
  }

  adapter.addOnTabUpdatedListener(async (_tabId, changeInfo, tab) => {
    if (!changeInfo.url && changeInfo.status !== "complete") return;
    if (!(await adapter.isAutoGroupEnabled())) return;
    if (tab.windowId == null) return;
    log(
      "auto-group: tab updated",
      tab.id,
      changeInfo.url ? `url=${tab.url?.slice(0, 60)}` : `status=${changeInfo.status}`,
    );
    scheduler.markDirty(tab.windowId);
  });

  adapter.addOnTabCreatedListener(async (tab) => {
    if (!(await adapter.isAutoGroupEnabled())) return;
    if (tab.windowId == null) return;
    if (tab.groupId !== TAB_GROUP_ID_NONE) return;
    log("auto-group: tab created", tab.id);
    scheduler.markDirty(tab.windowId);
  });

  adapter.addOnTabAttachedListener(async (_tabId, attachInfo) => {
    if (!(await adapter.isAutoGroupEnabled())) return;
    log("auto-group: tab attached to window", attachInfo.newWindowId);
    scheduler.markDirty(attachInfo.newWindowId);
  });

  adapter.addOnMessageListener((msg, _sender, sendResponse) => {
    if (msg.action === "organize") {
      log("organize triggered from popup");
      void handleOrganize(msg.windowId as number);
      sendResponse({ success: true });
      return false;
    }

    if (msg.action === "setAutoGroup") {
      log("setAutoGroup:", msg.enabled);
      if (!msg.enabled) {
        scheduler.cancelAll();
      }
      adapter.setAutoGroupEnabled(msg.enabled as boolean);
      sendResponse({ success: true });
      return false;
    }

    if (msg.action === "getAutoGroup") {
      (async () => {
        const enabled = await adapter.isAutoGroupEnabled();
        sendResponse({ autoGroupEnabled: enabled });
      })();
      return true;
    }
  });
}

export default defineBackground(() => {
  initBackground(createChromeAdapter());
});
