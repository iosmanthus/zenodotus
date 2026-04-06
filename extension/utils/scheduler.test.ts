import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "./scheduler";

describe("createScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips organizing when tab count is below minTabsToGroup", async () => {
    const organize = vi.fn();
    const scheduler = createScheduler({
      queryTabs: async () => ({ length: 3 }),
      getMinTabsToGroup: async () => 5,
      organizeWindow: organize,
    });

    scheduler.markDirty(1);
    await vi.advanceTimersByTimeAsync(5000);

    expect(organize).not.toHaveBeenCalled();
  });

  it("debounces windows independently", async () => {
    const organize = vi.fn();
    const scheduler = createScheduler({
      queryTabs: async () => ({ length: 10 }),
      getMinTabsToGroup: async () => 0,
      organizeWindow: organize,
    });

    scheduler.markDirty(1);
    await vi.advanceTimersByTimeAsync(3000);
    scheduler.markDirty(2);
    await vi.advanceTimersByTimeAsync(2000);

    // window 1 fires at t=5000, window 2 still pending
    expect(organize).toHaveBeenCalledTimes(1);
    expect(organize).toHaveBeenCalledWith(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(organize).toHaveBeenCalledTimes(2);
    expect(organize).toHaveBeenCalledWith(2);
  });

  it("cancelAll prevents pending flushes from firing", async () => {
    const organize = vi.fn();
    const scheduler = createScheduler({
      queryTabs: async () => ({ length: 10 }),
      getMinTabsToGroup: async () => 0,
      organizeWindow: organize,
    });

    scheduler.markDirty(1);
    scheduler.markDirty(2);
    expect(scheduler.pendingCount()).toBe(2);

    scheduler.cancelAll();
    expect(scheduler.pendingCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(10000);
    expect(organize).not.toHaveBeenCalled();
  });

  it("resets debounce timer on repeated markDirty for same window", async () => {
    const organize = vi.fn();
    const scheduler = createScheduler({
      queryTabs: async () => ({ length: 10 }),
      getMinTabsToGroup: async () => 0,
      organizeWindow: organize,
    });

    scheduler.markDirty(1);
    await vi.advanceTimersByTimeAsync(3000);
    scheduler.markDirty(1); // reset
    await vi.advanceTimersByTimeAsync(3000);

    // only 3s since last markDirty(1), not yet 5s
    expect(organize).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(organize).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues when flush is already in progress for same window", async () => {
    let resolveOrganize!: () => void;
    const organize = vi.fn().mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveOrganize = r;
        }),
    );
    const scheduler = createScheduler(
      {
        queryTabs: async () => ({ length: 10 }),
        getMinTabsToGroup: async () => 0,
        organizeWindow: organize,
      },
      100,
    );

    // First flush starts
    scheduler.markDirty(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(organize).toHaveBeenCalledTimes(1);

    // While flushing, call flushWindow again — should re-enqueue
    const flushPromise = scheduler.flushWindow(1);

    // Complete first organize
    resolveOrganize();
    await flushPromise;

    // The re-enqueued timer should fire
    await vi.advanceTimersByTimeAsync(100);
    expect(organize).toHaveBeenCalledTimes(2);
  });

  it("organizes when minTabsToGroup is 0 (disabled)", async () => {
    const organize = vi.fn();
    const scheduler = createScheduler({
      queryTabs: async () => ({ length: 1 }),
      getMinTabsToGroup: async () => 0,
      organizeWindow: organize,
    });

    scheduler.markDirty(1);
    await vi.advanceTimersByTimeAsync(5000);

    expect(organize).toHaveBeenCalledWith(1);
  });

  it("organizes when tab count equals minTabsToGroup", async () => {
    const organize = vi.fn();
    const scheduler = createScheduler({
      queryTabs: async () => ({ length: 5 }),
      getMinTabsToGroup: async () => 5,
      organizeWindow: organize,
    });

    scheduler.markDirty(1);
    await vi.advanceTimersByTimeAsync(5000);

    expect(organize).toHaveBeenCalledWith(1);
  });

  it("calls onFlushError when organizeWindow throws", async () => {
    const onFlushError = vi.fn();
    const scheduler = createScheduler({
      queryTabs: async () => ({ length: 10 }),
      getMinTabsToGroup: async () => 0,
      organizeWindow: vi.fn().mockRejectedValue(new Error("provider failed")),
      onFlushError,
    });

    scheduler.markDirty(1);
    await vi.advanceTimersByTimeAsync(5000);

    expect(onFlushError).toHaveBeenCalledWith(1, expect.any(Error));
  });
});
