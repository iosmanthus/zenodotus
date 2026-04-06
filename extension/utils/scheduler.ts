export interface SchedulerDeps {
  queryTabs(windowId: number): Promise<{ length: number }>;
  getMinTabsToGroup(): Promise<number>;
  organizeWindow(windowId: number): Promise<void>;
  onFlushError?(windowId: number, err: unknown): void;
}

export function createScheduler(deps: SchedulerDeps, debounceMs = 5000) {
  const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const flushingWindows = new Set<number>();

  function markDirty(windowId: number): void {
    const existing = debounceTimers.get(windowId);
    if (existing != null) clearTimeout(existing);
    debounceTimers.set(
      windowId,
      setTimeout(() => {
        debounceTimers.delete(windowId);
        void flushWindow(windowId).catch((err) => deps.onFlushError?.(windowId, err));
      }, debounceMs),
    );
  }

  async function flushWindow(windowId: number): Promise<void> {
    if (flushingWindows.has(windowId)) {
      markDirty(windowId);
      return;
    }

    flushingWindows.add(windowId);
    try {
      const allTabs = await deps.queryTabs(windowId);
      const minTabsToGroup = await deps.getMinTabsToGroup();
      if (minTabsToGroup > 0 && allTabs.length < minTabsToGroup) {
        return;
      }
      await deps.organizeWindow(windowId);
    } finally {
      flushingWindows.delete(windowId);
    }
  }

  function cancelAll(): void {
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
  }

  function pendingCount(): number {
    return debounceTimers.size;
  }

  return { markDirty, flushWindow, cancelAll, pendingCount };
}
