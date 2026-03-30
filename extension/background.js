import { requestGrouping } from "./utils/api.js";
import { colorForGroup } from "./utils/color.js";

// --- Tab info collection ---

async function getMetaDescription(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return results?.[0]?.result || "";
  } catch {
    return "";
  }
}

async function collectTabInfo(tab) {
  const description = await getMetaDescription(tab.id);
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || "",
    title: tab.title || "",
    description,
  };
}

async function getExistingGroups() {
  const allTabs = await chrome.tabs.query({});
  const groupMap = new Map();

  for (const tab of allTabs) {
    if (tab.groupId !== -1 && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      if (!groupMap.has(tab.groupId)) {
        groupMap.set(tab.groupId, []);
      }
      groupMap.get(tab.groupId).push(tab.id);
    }
  }

  const groups = [];
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

// --- Grouping execution ---

async function applyGrouping(result) {
  if (!result || !Array.isArray(result.groups)) return;

  for (const group of result.groups) {
    if (!Array.isArray(group.tabIds) || group.tabIds.length === 0) continue;

    // Verify tabs still exist
    const validTabIds = [];
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
      // Move into existing group
      try {
        await chrome.tabs.group({ tabIds: validTabIds, groupId: group.groupId });
        if (group.name) {
          await chrome.tabGroups.update(group.groupId, { title: group.name });
        }
      } catch {
        // group may no longer exist, try creating new
        if (group.name) {
          await createNewGroup(group.name, validTabIds);
        }
      }
    } else if (group.name) {
      await createNewGroup(group.name, validTabIds);
    }
  }
}

async function createNewGroup(name, tabIds) {
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

// --- Manual trigger ---

async function organizeAllTabs() {
  const allTabs = await chrome.tabs.query({});
  const existingGroups = await getExistingGroups();
  const { prompt } = await chrome.storage.local.get({ prompt: "" });

  const tabInfos = await Promise.all(allTabs.map(collectTabInfo));

  const result = await requestGrouping({
    tabs: tabInfos,
    existingGroups,
    prompt,
  });

  await applyGrouping(result);
}

// --- Auto trigger ---

let autoGroupEnabled = false;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!autoGroupEnabled) return;
  if (changeInfo.status !== "complete") return;
  if (tab.groupId !== -1 && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;

  const existingGroups = await getExistingGroups();
  const { prompt } = await chrome.storage.local.get({ prompt: "" });
  const tabInfo = await collectTabInfo(tab);

  const result = await requestGrouping({
    tabs: [tabInfo],
    existingGroups,
    prompt,
  });

  await applyGrouping(result);
});

// --- Message handling from popup ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "organize") {
    organizeAllTabs()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
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
