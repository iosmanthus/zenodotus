import type { GroupRequest, GroupResponse } from "@zenodotus/api-spec";

const NMH_HOST = "com.zenodotus.host";

/** Minimal tab shape needed by background logic. */
export interface TabData {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
  groupId: number;
}

/** Minimal tab group shape. */
export interface TabGroupData {
  title?: string;
}

export interface ChromeAdapter {
  // storage
  getSettings(): Promise<{ prompt: string; model: string; debug: boolean; provider: string }>;
  getMinTabsToGroup(): Promise<number>;
  isAutoGroupEnabled(): Promise<boolean>;
  setAutoGroupEnabled(enabled: boolean): void;
  setOrganizeStatus(status: "organizing" | "done" | "error", error?: string): void;

  // tabs
  queryTabs(windowId: number): Promise<TabData[]>;
  getTab(tabId: number): Promise<TabData>;
  groupTabs(tabIds: number[], groupId: number): Promise<void>;
  createGroup(tabIds: number[], windowId: number): Promise<number>;

  // tab groups
  getTabGroup(groupId: number): Promise<TabGroupData>;
  updateTabGroup(groupId: number, title: string, color: chrome.tabGroups.Color): Promise<void>;

  // scripting
  getMetaDescription(tabId: number): Promise<string>;

  // NMH
  requestGrouping(request: GroupRequest): Promise<GroupResponse>;

  // events
  addOnTabUpdatedListener(
    cb: (tabId: number, changeInfo: { url?: string; status?: string }, tab: TabData) => void,
  ): void;
  addOnTabCreatedListener(cb: (tab: TabData) => void): void;
  addOnTabAttachedListener(cb: (tabId: number, attachInfo: { newWindowId: number }) => void): void;
  addOnMessageListener(
    cb: (
      msg: Record<string, unknown>,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean | undefined,
  ): void;
}

/** sentinel value matching chrome.tabGroups.TAB_GROUP_ID_NONE */
export const TAB_GROUP_ID_NONE = -1;

export function createChromeAdapter(): ChromeAdapter {
  return {
    getSettings: async () => {
      const data = await chrome.storage.local.get({
        prompt: "",
        model: "",
        debug: false,
        provider: "",
      });
      return data as { prompt: string; model: string; debug: boolean; provider: string };
    },

    getMinTabsToGroup: async () => {
      const { minTabsToGroup } = await chrome.storage.local.get({ minTabsToGroup: 0 });
      return minTabsToGroup as number;
    },

    isAutoGroupEnabled: async () => {
      const { autoGroupEnabled } = await chrome.storage.local.get({ autoGroupEnabled: false });
      return autoGroupEnabled as boolean;
    },

    setAutoGroupEnabled: (enabled) => {
      chrome.storage.local.set({ autoGroupEnabled: enabled });
    },

    setOrganizeStatus: (status, error?) => {
      if (status === "error") {
        chrome.storage.local.set({ organizeStatus: "error", organizeError: error || "Unknown" });
      } else {
        chrome.storage.local.set({ organizeStatus: status });
      }
    },

    queryTabs: (windowId) => chrome.tabs.query({ windowId }),

    getTab: (tabId) => chrome.tabs.get(tabId),

    groupTabs: async (tabIds, groupId) => {
      const [first, ...rest] = tabIds;
      if (first == null) return;
      await chrome.tabs.group({ tabIds: [first, ...rest], groupId });
    },

    createGroup: async (tabIds, windowId) => {
      const [first, ...rest] = tabIds;
      return chrome.tabs.group({ tabIds: [first, ...rest], createProperties: { windowId } });
    },

    getTabGroup: (groupId) => chrome.tabGroups.get(groupId),

    updateTabGroup: async (groupId, title, color) => {
      await chrome.tabGroups.update(groupId, { title, color });
    },

    getMetaDescription: async (tabId) => {
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
        if (!result) return "";
        return (result[0]?.result as string) || "";
      } catch {
        return "";
      }
    },

    requestGrouping: async (request) => {
      const response = await chrome.runtime.sendNativeMessage(NMH_HOST, request);
      if (response?.error) {
        throw new Error(response.error);
      }
      return response as GroupResponse;
    },

    addOnTabUpdatedListener: (cb) => {
      chrome.tabs.onUpdated.addListener(
        cb as Parameters<typeof chrome.tabs.onUpdated.addListener>[0],
      );
    },

    addOnTabCreatedListener: (cb) => {
      chrome.tabs.onCreated.addListener(
        cb as Parameters<typeof chrome.tabs.onCreated.addListener>[0],
      );
    },

    addOnTabAttachedListener: (cb) => {
      chrome.tabs.onAttached.addListener(
        cb as Parameters<typeof chrome.tabs.onAttached.addListener>[0],
      );
    },

    addOnMessageListener: (cb) => {
      chrome.runtime.onMessage.addListener(
        cb as Parameters<typeof chrome.runtime.onMessage.addListener>[0],
      );
    },
  };
}
