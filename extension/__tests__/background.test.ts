import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initBackground } from "@/entrypoints/background";
import type { ChromeAdapter, TabData } from "@/utils/chrome-adapter";
import { TAB_GROUP_ID_NONE } from "@/utils/chrome-adapter";

function makeTabs(count: number, windowId = 1): TabData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    windowId,
    url: `https://example.com/${i}`,
    title: `Tab ${i}`,
    groupId: TAB_GROUP_ID_NONE,
  }));
}

type ListenerFn = (...args: never[]) => unknown;

function createMockAdapter(overrides: Partial<ChromeAdapter> = {}): ChromeAdapter & {
  listeners: Record<string, ListenerFn[]>;
} {
  const listeners: Record<string, ListenerFn[]> = {
    tabUpdated: [],
    tabCreated: [],
    tabAttached: [],
    message: [],
  };

  return {
    listeners,
    getSettings: vi.fn().mockResolvedValue({ prompt: "", model: "", debug: false, provider: "" }),
    getMinTabsToGroup: vi.fn().mockResolvedValue(0),
    isAutoGroupEnabled: vi.fn().mockResolvedValue(true),
    setAutoGroupEnabled: vi.fn(),
    setOrganizeStatus: vi.fn(),
    queryTabs: vi.fn().mockResolvedValue(makeTabs(5)),
    getTab: vi.fn().mockImplementation(async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: `https://example.com/${tabId}`,
      title: `Tab ${tabId}`,
      groupId: TAB_GROUP_ID_NONE,
    })),
    groupTabs: vi.fn().mockResolvedValue(undefined),
    createGroup: vi.fn().mockResolvedValue(100),
    getTabGroup: vi.fn().mockResolvedValue({ title: "Dev" }),
    updateTabGroup: vi.fn().mockResolvedValue(undefined),
    getMetaDescription: vi.fn().mockResolvedValue(""),
    requestGrouping: vi.fn().mockResolvedValue({ groups: [] }),
    addOnTabUpdatedListener: (cb: ListenerFn) => listeners.tabUpdated.push(cb),
    addOnTabCreatedListener: (cb: ListenerFn) => listeners.tabCreated.push(cb),
    addOnTabAttachedListener: (cb: ListenerFn) => listeners.tabAttached.push(cb),
    addOnMessageListener: (cb: ListenerFn) => listeners.message.push(cb),
    ...overrides,
  };
}

describe("initBackground", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("handleOrganize", () => {
    it("sets error status when below minTabsToGroup threshold", async () => {
      const adapter = createMockAdapter({
        queryTabs: vi.fn().mockResolvedValue(makeTabs(3)),
        getMinTabsToGroup: vi.fn().mockResolvedValue(5),
      });
      initBackground(adapter);

      const sendResponse = vi.fn();
      const handler = adapter.listeners.message[0];
      handler({ action: "organize", windowId: 1 }, null, sendResponse);
      await vi.advanceTimersByTimeAsync(0);

      expect(adapter.setOrganizeStatus).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("Need at least 5"),
      );
    });

    it("sets done status on successful organize", async () => {
      const adapter = createMockAdapter({
        requestGrouping: vi.fn().mockResolvedValue({ groups: [] }),
      });
      initBackground(adapter);

      const sendResponse = vi.fn();
      adapter.listeners.message[0]({ action: "organize", windowId: 1 }, null, sendResponse);
      await vi.advanceTimersByTimeAsync(0);

      expect(adapter.setOrganizeStatus).toHaveBeenCalledWith("organizing");
      expect(adapter.setOrganizeStatus).toHaveBeenCalledWith("done");
    });

    it("propagates provider error to organize status", async () => {
      const adapter = createMockAdapter({
        requestGrouping: vi.fn().mockRejectedValue(new Error("codex CLI failed: not found")),
      });
      initBackground(adapter);

      const sendResponse = vi.fn();
      adapter.listeners.message[0]({ action: "organize", windowId: 1 }, null, sendResponse);
      await vi.advanceTimersByTimeAsync(0);

      expect(adapter.setOrganizeStatus).toHaveBeenCalledWith(
        "error",
        "codex CLI failed: not found",
      );
    });
  });

  describe("applyGrouping", () => {
    it("creates new group when no existing group matches", async () => {
      const adapter = createMockAdapter({
        requestGrouping: vi.fn().mockResolvedValue({
          groups: [{ name: "News", tabIds: [1, 2] }],
        }),
      });
      initBackground(adapter);

      adapter.listeners.message[0]({ action: "organize", windowId: 1 }, null, vi.fn());
      await vi.advanceTimersByTimeAsync(0);

      expect(adapter.createGroup).toHaveBeenCalledWith([1, 2], 1);
      expect(adapter.updateTabGroup).toHaveBeenCalledWith(100, "News", expect.any(String));
    });

    it("moves tabs into existing group when name matches", async () => {
      const existingTabs = makeTabs(5).map((t, i) => (i < 2 ? { ...t, groupId: 10 } : t));
      const adapter = createMockAdapter({
        queryTabs: vi.fn().mockResolvedValue(existingTabs),
        getTabGroup: vi.fn().mockResolvedValue({ title: "Dev" }),
        requestGrouping: vi.fn().mockResolvedValue({
          groups: [{ name: "Dev", tabIds: [3, 4] }],
        }),
      });
      initBackground(adapter);

      adapter.listeners.message[0]({ action: "organize", windowId: 1 }, null, vi.fn());
      await vi.advanceTimersByTimeAsync(0);

      expect(adapter.groupTabs).toHaveBeenCalledWith([3, 4], 10);
      expect(adapter.createGroup).not.toHaveBeenCalled();
    });

    it("skips tabs that no longer exist", async () => {
      const adapter = createMockAdapter({
        getTab: vi.fn().mockImplementation(async (tabId: number) => {
          if (tabId === 2) throw new Error("tab removed");
          return { id: tabId, windowId: 1, groupId: TAB_GROUP_ID_NONE };
        }),
        requestGrouping: vi.fn().mockResolvedValue({
          groups: [{ name: "News", tabIds: [1, 2, 3] }],
        }),
      });
      initBackground(adapter);

      adapter.listeners.message[0]({ action: "organize", windowId: 1 }, null, vi.fn());
      await vi.advanceTimersByTimeAsync(0);

      // tab 2 skipped, only 1 and 3
      expect(adapter.createGroup).toHaveBeenCalledWith([1, 3], 1);
    });

    it("matches group names case-insensitively", async () => {
      const existingTabs = makeTabs(5).map((t, i) => (i < 2 ? { ...t, groupId: 10 } : t));
      const adapter = createMockAdapter({
        queryTabs: vi.fn().mockResolvedValue(existingTabs),
        getTabGroup: vi.fn().mockResolvedValue({ title: "Development" }),
        requestGrouping: vi.fn().mockResolvedValue({
          groups: [{ name: "development", tabIds: [3] }],
        }),
      });
      initBackground(adapter);

      adapter.listeners.message[0]({ action: "organize", windowId: 1 }, null, vi.fn());
      await vi.advanceTimersByTimeAsync(0);

      expect(adapter.groupTabs).toHaveBeenCalledWith([3], 10);
    });
  });

  describe("event listeners", () => {
    it("tab updated with URL change triggers scheduler when auto-group enabled", async () => {
      const adapter = createMockAdapter();
      initBackground(adapter);

      const tab = makeTabs(1)[0];
      adapter.listeners.tabUpdated[0](1, { url: "https://new.com" }, tab);
      await vi.advanceTimersByTimeAsync(5000);

      expect(adapter.requestGrouping).toHaveBeenCalled();
    });

    it("tab updated does not trigger when auto-group disabled", async () => {
      const adapter = createMockAdapter({
        isAutoGroupEnabled: vi.fn().mockResolvedValue(false),
      });
      initBackground(adapter);

      const tab = makeTabs(1)[0];
      adapter.listeners.tabUpdated[0](1, { url: "https://new.com" }, tab);
      await vi.advanceTimersByTimeAsync(5000);

      expect(adapter.requestGrouping).not.toHaveBeenCalled();
    });

    it("tab created triggers scheduler", async () => {
      const adapter = createMockAdapter();
      initBackground(adapter);

      adapter.listeners.tabCreated[0](makeTabs(1)[0]);
      await vi.advanceTimersByTimeAsync(5000);

      expect(adapter.requestGrouping).toHaveBeenCalled();
    });

    it("tab attached triggers scheduler", async () => {
      const adapter = createMockAdapter();
      initBackground(adapter);

      adapter.listeners.tabAttached[0](1, { newWindowId: 2 });
      await vi.advanceTimersByTimeAsync(5000);

      expect(adapter.queryTabs).toHaveBeenCalledWith(2);
    });

    it("tab updated without URL or status complete is ignored", async () => {
      const adapter = createMockAdapter();
      initBackground(adapter);

      adapter.listeners.tabUpdated[0](1, { status: "loading" }, makeTabs(1)[0]);
      await vi.advanceTimersByTimeAsync(5000);

      expect(adapter.requestGrouping).not.toHaveBeenCalled();
    });
  });

  describe("setAutoGroup", () => {
    it("cancels pending timers when disabling auto-group", async () => {
      const adapter = createMockAdapter();
      initBackground(adapter);

      // Trigger a tab event to queue a flush
      adapter.listeners.tabCreated[0](makeTabs(1)[0]);
      // Let the async isAutoGroupEnabled check resolve so markDirty runs
      await vi.advanceTimersByTimeAsync(0);

      // Disable auto-group — should cancel the pending timer
      const sendResponse = vi.fn();
      adapter.listeners.message[0]({ action: "setAutoGroup", enabled: false }, null, sendResponse);

      // Advance past debounce — should NOT trigger organize
      await vi.advanceTimersByTimeAsync(10000);
      expect(adapter.requestGrouping).not.toHaveBeenCalled();
      expect(adapter.setAutoGroupEnabled).toHaveBeenCalledWith(false);
    });
  });
});
