# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix correctness, privacy, and DX issues identified in code review without changing overall architecture.

**Architecture:** Four independent fixes across server providers, API spec, configs, and docs. Each task is self-contained.

**Tech Stack:** TypeScript, Chrome Extension APIs, WXT, Vitest, Biome, esbuild

---

## File Structure

No new source files. Changes to existing files:

| File | Change |
|------|--------|
| `server/src/providers/index.ts` | Gate logging behind `ZENODOTUS_DEBUG` env var |
| `packages/api-spec/src/types.ts` | Remove `thinking` field from `GroupRequest` |
| `extension/entrypoints/background.ts` | Stop reading/sending `thinking` |
| `extension/entrypoints/popup/index.html` | Remove thinking toggle |
| `extension/entrypoints/popup/main.ts` | Remove thinking toggle wiring |
| `README.md` | Update auto-group description and remove thinking from settings |
| `biome.json` | Add `.direnv` to excludes |
| `vitest.config.ts` | Create with `.direnv` exclude |

---

### Task 1: Gate sensitive logging behind env var

**Files:**
- Modify: `server/src/providers/index.ts`

- [ ] **Step 1: Replace unconditional logging with debug-gated logging**

Rewrite the logging in `server/src/providers/index.ts`:

```typescript
import { appendFileSync } from "node:fs";
import type { GroupRequest, GroupResponse } from "@zenodotus/api-spec";
import { assignGroups as claudeAssign } from "./claude-code";
import { assignGroups as codexAssign } from "./codex";
import { buildFullPrompt } from "./prompt";

export type Provider = "claude-code" | "codex";

const DEFAULT_PROVIDER: Provider = (process.env.PROVIDER as Provider) || "claude-code";
const DEBUG = !!process.env.ZENODOTUS_DEBUG;
const LOG_FILE = process.env.ZENODOTUS_LOG || "/tmp/zenodotus.log";

function logToFile(label: string, data: unknown): void {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] ${label}: ${JSON.stringify(data, null, 2)}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore
  }
}

export async function assignGroups(request: GroupRequest): Promise<GroupResponse | null> {
  const provider = request.provider as Provider | undefined;
  const selected = provider || DEFAULT_PROVIDER;

  logToFile("provider", selected);
  logToFile("request", { tabs: request.tabs.length, existingGroups: request.existingGroups?.length ?? 0, model: request.model, prompt: request.prompt });
  logToFile("full_prompt", buildFullPrompt(request));

  let result: GroupResponse | null;
  switch (selected) {
    case "codex":
      result = await codexAssign(request);
      break;
    case "claude-code":
    default:
      result = await claudeAssign(request);
      break;
  }

  logToFile("response", result);
  return result;
}
```

- [ ] **Step 2: Build server and verify**

Run: `pnpm build:server`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add server/src/providers/index.ts
git commit -m "fix: gate sensitive tab logging behind ZENODOTUS_DEBUG env var"
```

---

### Task 2: Remove `thinking` setting (dead code)

Neither provider uses `thinking`. Remove it end-to-end.

**Files:**
- Modify: `packages/api-spec/src/types.ts`
- Modify: `extension/entrypoints/background.ts`
- Modify: `extension/entrypoints/popup/index.html`
- Modify: `extension/entrypoints/popup/main.ts`

- [ ] **Step 1: Remove `thinking` from `GroupRequest` type**

In `packages/api-spec/src/types.ts`, remove the `thinking?: boolean;` line from `GroupRequest`:

```typescript
export interface GroupRequest {
  tabs: TabInfo[];
  existingGroups?: ExistingGroup[];
  prompt?: string;
  model?: string;
  provider?: string;
}
```

- [ ] **Step 2: Remove `thinking` from background.ts storage reads**

In `extension/entrypoints/background.ts`, find the `organizeAllTabs` function. Change the storage read from:

```typescript
    const { prompt, model, thinking, provider } = await chrome.storage.local.get({
      prompt: "",
      model: "",
      thinking: false,
      provider: "",
    });
```

to:

```typescript
    const { prompt, model, provider } = await chrome.storage.local.get({
      prompt: "",
      model: "",
      provider: "",
    });
```

And update the `requestGrouping` call — remove `thinking: thinking || undefined`:

```typescript
    const result = await requestGrouping({
      tabs: tabInfos,
      existingGroups,
      prompt,
      model: model || undefined,
      provider: provider || undefined,
    });
```

- [ ] **Step 3: Remove thinking toggle from popup HTML**

In `extension/entrypoints/popup/index.html`, remove these lines:

```html
        <label class="setting-row">
          <input type="checkbox" id="thinking-toggle" />
          Enable thinking
        </label>
```

- [ ] **Step 4: Remove thinking toggle from popup JS**

In `extension/entrypoints/popup/main.ts`:

1. Remove the `thinkingToggle` const declaration:
```typescript
const thinkingToggle = document.getElementById("thinking-toggle") as HTMLInputElement;
```

2. Remove `thinking: false,` from the storage read defaults and `thinkingToggle.checked = data.thinking;` from the `.then` callback.

3. Remove `thinking: thinkingToggle.checked,` from the save handler.

- [ ] **Step 5: Build both and verify**

Run: `pnpm build:server && pnpm build:extension`
Expected: Both builds succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api-spec/src/types.ts extension/entrypoints/background.ts extension/entrypoints/popup/index.html extension/entrypoints/popup/main.ts
git commit -m "fix: remove unused thinking setting from UI, API spec, and background"
```

---

### Task 3: Fix auto-group trigger and update docs

**Files:**
- Modify: `extension/entrypoints/background.ts` (`onTabUpdated`)
- Modify: `README.md`

- [ ] **Step 1: Add `status === "complete"` as additional trigger**

The current `onTabUpdated` only fires on `changeInfo.url`. But a new tab that navigates for the first time may not have `changeInfo.url` set — it fires `status: "complete"` instead. Add both triggers.

In `extension/entrypoints/background.ts`, change `onTabUpdated`:

```typescript
  async function onTabUpdated(...[, changeInfo, tab]: Parameters<Parameters<typeof chrome.tabs.onUpdated.addListener>[0]>) {
    if (!changeInfo.url && changeInfo.status !== "complete") return;
    if (!(await isAutoGroupEnabled())) return;
    if (tab.windowId == null) return;
    log("auto-group: tab updated", tab.id, changeInfo.url ? `url=${tab.url?.slice(0, 60)}` : `status=${changeInfo.status}`);
    markDirty(tab.windowId);
  }
```

- [ ] **Step 2: Update README auto-group section**

Replace the auto-group paragraph in `README.md`:

From:
```markdown
Toggle **Auto-group new tabs** to automatically group new tabs when they finish loading. Tabs are batched (2s debounce, 10s max wait) to reduce agent calls.
```

To:
```markdown
Toggle **Auto-group new tabs** to automatically regroup tabs when they are created, navigate to a new URL, or finish loading. Changes are batched with a 5s debounce to reduce agent calls.

> **Note:** When auto-group is enabled, Zenodotus manages all tab groups in the window. Manually created groups may be reorganized or removed.
```

- [ ] **Step 3: Update README settings section**

Remove the thinking bullet from the Settings list:

From:
```markdown
- **Enable thinking** -- Extended thinking for more deliberate grouping
```

Remove this line entirely.

- [ ] **Step 4: Build extension and verify**

Run: `pnpm build:extension`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add extension/entrypoints/background.ts README.md
git commit -m "fix: trigger auto-group on both URL change and load complete, update docs"
```

---

### Task 4: Fix Vitest and Biome traversing `.direnv`

**Files:**
- Create: `vitest.config.ts`
- Modify: `biome.json`

- [ ] **Step 1: Add `.direnv` to Biome excludes**

In `biome.json`, update the `files.includes` array to also exclude `.direnv`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.10/schema.json",
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "warn"
      },
      "correctness": {
        "noUnusedFunctionParameters": "warn"
      }
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "files": {
    "includes": ["**", "!**/node_modules", "!**/dist", "!**/.output", "!**/.wxt", "!**/generated", "!**/.direnv"]
  }
}
```

- [ ] **Step 2: Create `vitest.config.ts` with `.direnv` exclude**

Create `vitest.config.ts` at repo root:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.direnv/**"],
  },
});
```

- [ ] **Step 3: Verify both commands pass**

Run: `pnpm test && pnpm lint`
Expected: Both pass without traversing `.direnv`.

- [ ] **Step 4: Commit**

```bash
git add biome.json vitest.config.ts
git commit -m "fix: exclude .direnv from Vitest and Biome traversal"
```
