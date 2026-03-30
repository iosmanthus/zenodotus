import { requestGrouping } from "@/utils/api";
import { colorForGroup } from "@/utils/color";
import type { components } from "@zenodotus/api-spec/schema";

type TabInfo = components["schemas"]["TabInfo"];
type ExistingGroup = components["schemas"]["ExistingGroup"];
type GroupResponse = components["schemas"]["GroupResponse"];

export default defineBackground(() => {
  let autoGroupEnabled = false;

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

  async function collectTabInfo(tab: chrome.tabs.Tab): Promise<TabInfo> {
    const description = await getMetaDescription(tab.id!);
    return {
      tabId: tab.id!,
      windowId: tab.windowId!,
      url: tab.url || "",
      title: tab.title || "",
      description,
    };
  }

  async function getExistingGroups(): Promise<ExistingGroup[]> {
    const allTabs = await chrome.tabs.query({});
    const groupMap = new Map<number, number[]>();

    for (const tab of allTabs) {
      if (
        tab.groupId !== -1 &&
        tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
      ) {
        if (!groupMap.has(tab.groupId)) {
          groupMap.set(tab.groupId, []);
        }
        groupMap.get(tab.groupId)!.push(tab.id!);
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
            tabIds: validTabIds,
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

  async function createNewGroup(
    name: string,
    tabIds: number[],
  ): Promise<void> {
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
    const tabInfos = await Promise.all(allTabs.map(collectTabInfo));

    const result = await requestGrouping({
      tabs: tabInfos,
      existingGroups,
      prompt,
    });

    if (result) await applyGrouping(result);
  }

  // Auto trigger
  chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    if (!autoGroupEnabled) return;
    if (changeInfo.status !== "complete") return;
    if (
      tab.groupId !== -1 &&
      tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    )
      return;

    const existingGroups = await getExistingGroups();
    const { prompt } = await chrome.storage.local.get({ prompt: "" });
    const tabInfo = await collectTabInfo(tab);

    const result = await requestGrouping({
      tabs: [tabInfo],
      existingGroups,
      prompt,
    });

    if (result) await applyGrouping(result);
  });

  // Message handling from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "organize") {
      organizeAllTabs()
        .then(() => sendResponse({ success: true }))
        .catch((err: Error) =>
          sendResponse({ success: false, error: err.message }),
        );
      return true;
    }

    if (msg.action === "setAutoGroup") {
      autoGroupEnabled = msg.enabled;
      sendResponse({ success: true, autoGroupEnabled });
      return false;
    }

    if (msg.action === "getAutoGroup") {
      sendResponse({ autoGroupEnabled });
      return false;
    }
  });
});
