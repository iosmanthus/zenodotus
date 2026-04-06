# High-Value Regression Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add behavioral regression tests covering auto-group scheduling, threshold logic, timer cleanup, provider error propagation, and NMH error handling.

**Architecture:** Extract pure scheduling logic from `background.ts` into a testable `scheduler.ts` module with injected dependencies. Server-side providers are already testable via `execFile` mocking. The NMH framing layer (`server.ts`) is tested via a subprocess integration test.

**Tech Stack:** Vitest (existing), `vi.useFakeTimers`, `vi.fn()` for mocks. No new dependencies.

---

## File Structure

```
extension/
  utils/
    scheduler.ts          — NEW: extracted scheduler logic (markDirty, flushWindow, timer cleanup)
    scheduler.test.ts     — NEW: unit tests for scheduler
  entrypoints/
    background.ts         — MODIFY: import scheduler, delegate scheduling to it

server/
  src/
    providers/
      index.test.ts       — NEW: provider routing + debug logging tests
      claude-code/
        index.test.ts     — NEW: claude-code adapter error handling tests
      codex/
        index.test.ts     — NEW: codex adapter error handling tests
    server.test.ts        — NEW: NMH message framing + error wrapping tests
```

---

### Task 1: Extract scheduler from background.ts

The scheduler owns: `debounceTimers`, `flushingWindows`, `markDirty`, `flushWindow`, `cancelAll`. It takes injected callbacks for `queryTabs`, `getMinTabsToGroup`, and `organizeWindow` so it can be tested without Chrome APIs.

**Files:**
- Create: `extension/utils/scheduler.ts`
- Modify: `extension/entrypoints/background.ts`

- [ ] **Step 1: Create `extension/utils/scheduler.ts`**

```typescript
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
```

- [ ] **Step 2: Update `background.ts` to use the scheduler**

Replace the inline `debounceTimers`, `flushingWindows`, `markDirty`, `flushWindow` with:

```typescript
import { createScheduler } from "@/utils/scheduler";

// Inside defineBackground():
const scheduler = createScheduler({
  queryTabs: (windowId) => chrome.tabs.query({ windowId }),
  getMinTabsToGroup: async () => {
    const { minTabsToGroup } = await chrome.storage.local.get({ minTabsToGroup: 0 });
    return minTabsToGroup as number;
  },
  organizeWindow: organizeAllTabs,
  onFlushError: (windowId, err) => logError("auto-group flush failed for window", windowId, err),
}, DEBOUNCE_MS);
```

Then replace all `markDirty(...)` calls with `scheduler.markDirty(...)` and the `setAutoGroup` timer cleanup with `scheduler.cancelAll()`.

- [ ] **Step 3: Verify extension still builds**

Run: `pnpm build:extension`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add extension/utils/scheduler.ts extension/entrypoints/background.ts
git commit -m "refactor: extract scheduler from background.ts for testability"
```

---

### Task 2: Scheduler unit tests

**Files:**
- Create: `extension/utils/scheduler.test.ts`

- [ ] **Step 1: Write test — minTabsToGroup skip without breaking existing groups**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "./scheduler";

describe("createScheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

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
```

- [ ] **Step 2: Write test — per-window debounce isolation**

```typescript
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
```

- [ ] **Step 3: Write test — cancelAll clears pending timers**

```typescript
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
```

- [ ] **Step 4: Write test — debounce resets on repeated markDirty**

```typescript
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

    // only 6s passed since last markDirty(1), not yet 5s
    expect(organize).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(organize).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 5: Write test — concurrent flush re-enqueues**

```typescript
  it("re-enqueues when flush is already in progress for same window", async () => {
    let resolveOrganize!: () => void;
    const organize = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveOrganize = r; }),
    );
    const scheduler = createScheduler({
      queryTabs: async () => ({ length: 10 }),
      getMinTabsToGroup: async () => 0,
      organizeWindow: organize,
    }, 100);

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
```

- [ ] **Step 6: Write test — organizes when threshold is 0**

```typescript
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
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add extension/utils/scheduler.test.ts
git commit -m "test: add scheduler unit tests for debounce, threshold, and cleanup"
```

---

### Task 3: Provider routing and debug logging tests

**Files:**
- Create: `server/src/providers/index.test.ts`

- [ ] **Step 1: Write provider routing + debug logging tests**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the provider modules before importing
vi.mock("./claude-code", () => ({
  assignGroups: vi.fn(),
}));
vi.mock("./codex", () => ({
  assignGroups: vi.fn(),
}));
vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
}));

import { appendFileSync } from "node:fs";
import type { GroupRequest, GroupResponse } from "@zenodotus/api-spec";
import { assignGroups as claudeAssign } from "./claude-code";
import { assignGroups as codexAssign } from "./codex";
import { assignGroups } from "./index";

const mockResponse: GroupResponse = {
  groups: [{ name: "Dev", tabIds: [1, 2] }],
};

const baseRequest: GroupRequest = {
  tabs: [{ tabId: 1, windowId: 1, url: "https://example.com", title: "Example" }],
};

describe("provider routing", () => {
  beforeEach(() => {
    vi.mocked(claudeAssign).mockResolvedValue(mockResponse);
    vi.mocked(codexAssign).mockResolvedValue(mockResponse);
    vi.mocked(appendFileSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to claude-code provider", async () => {
    await assignGroups(baseRequest);
    expect(claudeAssign).toHaveBeenCalled();
    expect(codexAssign).not.toHaveBeenCalled();
  });

  it("routes to codex when requested", async () => {
    await assignGroups({ ...baseRequest, provider: "codex" });
    expect(codexAssign).toHaveBeenCalled();
    expect(claudeAssign).not.toHaveBeenCalled();
  });

  it("does not write log file when debug is off", async () => {
    await assignGroups(baseRequest);
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("writes log file when debug is on", async () => {
    await assignGroups({ ...baseRequest, debug: true });
    expect(appendFileSync).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/providers/index.test.ts
git commit -m "test: add provider routing and debug logging tests"
```

---

### Task 4: Claude Code adapter error tests

**Files:**
- Create: `server/src/providers/claude-code/index.test.ts`

- [ ] **Step 1: Write claude-code adapter tests**

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { assignGroups } from "./index";

const baseRequest = {
  tabs: [{ tabId: 1, windowId: 1, url: "https://example.com", title: "Example" }],
};

function mockExecFile(stdout: string) {
  vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb: any) => {
    if (typeof _opts === "function") {
      cb = _opts;
    }
    cb(null, stdout, "");
    return {} as any;
  });
}

function mockExecFileError(message: string) {
  vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb: any) => {
    if (typeof _opts === "function") {
      cb = _opts;
    }
    cb(new Error(message), "", "");
    return {} as any;
  });
}

describe("claude-code provider", () => {
  it("returns structured_output on success", async () => {
    const expected = { groups: [{ name: "Dev", tabIds: [1] }] };
    mockExecFile(JSON.stringify({ structured_output: expected }));
    const result = await assignGroups(baseRequest);
    expect(result).toEqual(expected);
  });

  it("throws when CLI fails", async () => {
    mockExecFileError("command not found");
    await expect(assignGroups(baseRequest)).rejects.toThrow("claude-code CLI failed");
  });

  it("throws when structured_output is missing", async () => {
    mockExecFile(JSON.stringify({ result: "no structured output" }));
    await expect(assignGroups(baseRequest)).rejects.toThrow("no structured output");
  });
});
```

Note: `execFile` is used via `promisify` in the source. Since we mock the underlying `execFile` from `node:child_process`, we need to match the callback signature that `promisify` expects. An alternative approach is to mock at the module level with the promisified version — adjust in implementation if the callback mock doesn't match.

- [ ] **Step 2: Run tests, adjust mock approach if needed**

Run: `pnpm test`
Expected: All pass. If the `promisify` wrapper doesn't match, refactor the mock to directly mock the module's `execFileAsync` export.

- [ ] **Step 3: Commit**

```bash
git add server/src/providers/claude-code/index.test.ts
git commit -m "test: add claude-code adapter error handling tests"
```

---

### Task 5: Codex adapter error tests

**Files:**
- Create: `server/src/providers/codex/index.test.ts`

- [ ] **Step 1: Write codex adapter tests**

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// We also need to control file system reads for the output file
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdtempSync: vi.fn(() => "/tmp/zenodotus-test"),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { assignGroups } from "./index";

const baseRequest = {
  tabs: [{ tabId: 1, windowId: 1, url: "https://example.com", title: "Example" }],
};

function mockExecFileSuccess() {
  vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb: any) => {
    if (typeof _opts === "function") {
      cb = _opts;
    }
    cb(null, "", "");
    return {} as any;
  });
}

function mockExecFileError(message: string) {
  vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb: any) => {
    if (typeof _opts === "function") {
      cb = _opts;
    }
    cb(new Error(message), "", "");
    return {} as any;
  });
}

describe("codex provider", () => {
  it("returns parsed output on success", async () => {
    const expected = { groups: [{ name: "Dev", tabIds: [1], groupId: null }] };
    mockExecFileSuccess();
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(expected));
    const result = await assignGroups(baseRequest);
    // null fields should be stripped
    expect(result).toEqual({ groups: [{ tabIds: [1] }] });
  });

  it("throws when CLI fails", async () => {
    mockExecFileError("command not found");
    await expect(assignGroups(baseRequest)).rejects.toThrow("codex CLI failed");
  });

  it("throws when output is empty", async () => {
    mockExecFileSuccess();
    vi.mocked(readFileSync).mockReturnValue("");
    await expect(assignGroups(baseRequest)).rejects.toThrow("codex returned empty output");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/providers/codex/index.test.ts
git commit -m "test: add codex adapter error handling tests"
```

---

### Task 6: NMH server message framing and error wrapping test

The NMH server (`server.ts`) reads length-prefixed JSON from stdin and writes length-prefixed JSON to stdout. It wraps errors as `{ error: ... }`. We test this by spawning the bundled `server.mjs` as a child process and feeding it native messages.

However, `server.ts` imports the real providers which would call real CLIs. To keep this a unit test, we extract `readMessage` and `writeMessage` into a `server-io.ts` module and test those + the error wrapping logic without spawning real processes.

**Files:**
- Create: `server/src/server-io.ts`
- Modify: `server/src/server.ts`
- Create: `server/src/server-io.test.ts`

- [ ] **Step 1: Extract `readMessage` and `writeMessage` into `server-io.ts`**

```typescript
export function readMessage(input: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const headerBuf: Buffer[] = [];
    let headerLen = 0;
    const bodyBuf: Buffer[] = [];
    let bodyLen = 0;
    let msgLen = 0;
    let headerDone = false;

    const onReadable = () => {
      while (headerLen < 4) {
        const chunk = input.read(4 - headerLen) as Buffer | null;
        if (!chunk) return;
        headerBuf.push(chunk);
        headerLen += chunk.length;
      }

      if (!headerDone) {
        const header = Buffer.concat(headerBuf);
        msgLen = header.readUInt32LE(0);
        headerDone = true;

        if (msgLen === 0 || msgLen > 1024 * 1024) {
          cleanup();
          reject(new Error(`Invalid message length: ${msgLen}`));
          return;
        }
      }

      while (bodyLen < msgLen) {
        const chunk = input.read(msgLen - bodyLen) as Buffer | null;
        if (!chunk) return;
        bodyBuf.push(chunk);
        bodyLen += chunk.length;
      }

      cleanup();
      try {
        const body = Buffer.concat(bodyBuf);
        resolve(JSON.parse(body.toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    };

    const onEnd = () => {
      cleanup();
      reject(new Error("stdin closed before a complete message was received"));
    };

    const cleanup = () => {
      input.removeListener("readable", onReadable);
      input.removeListener("end", onEnd);
    };

    input.on("readable", onReadable);
    input.on("end", onEnd);
  });
}

export function writeMessage(output: NodeJS.WritableStream, obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  output.write(header);
  output.write(body);
}

export function encodeMessage(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
```

- [ ] **Step 2: Update `server.ts` to use `server-io.ts`**

```typescript
import type { GroupRequest } from "@zenodotus/api-spec";
import { assignGroups } from "./providers/index.ts";
import { readMessage, writeMessage } from "./server-io.ts";

async function main(): Promise<void> {
  try {
    const request = (await readMessage(process.stdin)) as GroupRequest;
    const result = await assignGroups(request);
    writeMessage(process.stdout, result);
  } catch (err) {
    writeMessage(process.stdout, {
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(String(err) + "\n");
    process.exit(1);
  });
```

- [ ] **Step 3: Write NMH framing tests**

```typescript
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { encodeMessage, readMessage, writeMessage } from "./server-io";

describe("NMH message framing", () => {
  it("readMessage parses a valid length-prefixed message", async () => {
    const input = new PassThrough();
    const msg = { tabs: [], existingGroups: [] };
    const encoded = encodeMessage(msg);
    input.end(encoded);

    const result = await readMessage(input);
    expect(result).toEqual(msg);
  });

  it("readMessage rejects on invalid message length (0)", async () => {
    const input = new PassThrough();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(0);
    input.end(header);

    await expect(readMessage(input)).rejects.toThrow("Invalid message length");
  });

  it("readMessage rejects when stdin closes before complete message", async () => {
    const input = new PassThrough();
    input.end(Buffer.alloc(0));

    await expect(readMessage(input)).rejects.toThrow("stdin closed");
  });

  it("writeMessage produces a valid length-prefixed message", () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk) => chunks.push(chunk));

    const msg = { groups: [{ name: "Test", tabIds: [1] }] };
    writeMessage(output, msg);
    output.end();

    const combined = Buffer.concat(chunks);
    const len = combined.readUInt32LE(0);
    const body = JSON.parse(combined.subarray(4, 4 + len).toString("utf-8"));
    expect(body).toEqual(msg);
  });

  it("roundtrip: writeMessage → readMessage", async () => {
    const stream = new PassThrough();
    const msg = { error: "something went wrong" };
    writeMessage(stream, msg);
    stream.end();

    const result = await readMessage(stream);
    expect(result).toEqual(msg);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/server-io.ts server/src/server.ts server/src/server-io.test.ts
git commit -m "refactor: extract NMH framing into server-io.ts and add tests"
```

---

### Task 7: Run full verification

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 2: Run linter**

Run: `pnpm lint`
Expected: No errors.

- [ ] **Step 3: Build server**

Run: `pnpm build:server`
Expected: Build succeeds.

- [ ] **Step 4: Build extension**

Run: `pnpm build:extension`
Expected: Build succeeds.

---

## Coverage Summary

| Risk | Test | Task |
|------|------|------|
| minTabsToGroup skip without ungrouping | scheduler: below threshold → organize not called | 2 |
| Per-window debounce isolation | scheduler: window A doesn't delay window B | 2 |
| cancelAll clears timers on auto-group disable | scheduler: cancelAll → no flush fires | 2 |
| Debounce reset on repeated events | scheduler: markDirty resets timer | 2 |
| Concurrent flush re-enqueue | scheduler: flushWindow during flush → re-enqueue | 2 |
| Provider routing (claude-code default, codex explicit) | provider index tests | 3 |
| Debug logging off by default | provider index: appendFileSync not called | 3 |
| Debug logging on when enabled | provider index: appendFileSync called | 3 |
| Claude Code CLI failure → clear error | claude-code adapter: throws with message | 4 |
| Claude Code missing structured_output | claude-code adapter: throws | 4 |
| Codex CLI failure → clear error | codex adapter: throws with message | 5 |
| Codex empty output → clear error | codex adapter: throws | 5 |
| Codex null field stripping | codex adapter: groupId/name null → deleted | 5 |
| NMH message framing roundtrip | server-io tests | 6 |
| NMH invalid message length | server-io: rejects | 6 |
| NMH stdin closed early | server-io: rejects | 6 |

## Not Covered (acceptable)

- `applyGrouping` logic (heavily depends on Chrome tab/group APIs — would need extensive mocking with low value)
- `getMetaDescription` (content script injection — browser-only)
- Popup UI behavior (DOM-dependent, better tested via manual QA or e2e)
- Actual LLM response quality (by definition untestable in unit tests)
