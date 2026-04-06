# Zenodotus — Intelligent Tab Grouping Extension

## Overview

A Chrome extension that uses LLM (Claude Code or Codex) to intelligently group browser tabs. The extension communicates with a local native messaging host (NMH) that dispatches to configurable LLM providers.

## Architecture

```
┌─────────────────────────────────────┐
│         Chrome Extension            │
│                                     │
│  popup.html  ← settings + trigger   │
│  background.js (service worker)     │
│    ├ unified per-window scheduler   │
│    ├ listen tab events              │
│    ├ inject script for meta desc    │
│    └ call NMH via native messaging  │
│                                     │
└──── chrome.runtime.sendNative ──────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│     Native Messaging Host (NMH)    │
│                                     │
│  stdin/stdout length-prefixed JSON  │
│                                     │
│  Provider routing:                  │
│    claude-code / codex              │
└─────────────────────────────────────┘
```

Communication uses Chrome's Native Messaging protocol: 4-byte little-endian length header followed by UTF-8 JSON body. No HTTP server or open ports required.

## Trigger Modes

### Manual Trigger

User clicks **Organize Tabs** in the popup. All tabs in the current window are collected, enriched with meta descriptions, and sent to the NMH for grouping. The `minTabsToGroup` threshold is enforced — if the window has fewer tabs than the threshold, the popup shows an error message.

### Auto Trigger (Unified Scheduler)

When auto-group is enabled, tab events feed into a per-window reactive scheduler:

```
tab event → isAutoGroupEnabled? → markDirty(windowId) → debounce(5s) → flushWindow(windowId)
```

**Monitored events:**

| Event | Trigger condition |
|-------|-------------------|
| `chrome.tabs.onUpdated` | URL changed or status became `complete` |
| `chrome.tabs.onCreated` | New tab created |
| `chrome.tabs.onAttached` | Tab moved from another window |

**Scheduler behavior:**

- **Per-window debounce** — Each window has its own 1s debounce timer (`Map<number, timeout>`). Multiple rapid events on the same window collapse into one flush.
- **Per-window concurrency** — A `Set<number>` tracks windows currently flushing. If a flush is in progress for a window, `markDirty` re-enqueues it for after the current flush completes.
- **Threshold check** — `flushWindow` skips grouping if the window has fewer tabs than `minTabsToGroup`. Tabs below threshold are left as-is (no ungrouping).

> **Note:** When auto-group is enabled, Zenodotus manages all tab groups in the window. Manually created groups may be reorganized.

## Data Sources

For each tab, the extension collects:

- **URL** — `tab.url`
- **Title** — `tab.title`
- **Meta description** — Extracted via `chrome.scripting.executeScript` with a 3s timeout

If injection fails (e.g., restricted pages like `chrome://`), the extension falls back to URL + title only.

## API Protocol (Native Messaging)

### Request (`GroupRequest`)

```typescript
interface GroupRequest {
  tabs: TabInfo[];
  existingGroups?: ExistingGroup[];
  prompt?: string;
  model?: string;
  debug?: boolean;
  provider?: string;
}
```

```json
{
  "tabs": [
    {
      "tabId": 123,
      "windowId": 1,
      "url": "https://github.com/foo/bar",
      "title": "foo/bar: A cool project",
      "description": "A cool project for doing X"
    }
  ],
  "existingGroups": [
    {
      "groupId": 456,
      "name": "Development",
      "tabIds": [101, 102]
    }
  ],
  "prompt": "Group by project, use Chinese names",
  "model": "sonnet",
  "debug": true,
  "provider": "claude-code"
}
```

### Response (`GroupResponse`)

```json
{
  "groups": [
    {
      "groupId": 456,
      "tabIds": [123]
    },
    {
      "name": "News",
      "tabIds": [124, 125]
    }
  ]
}
```

**Response schema:**

- `groups[].groupId` (optional number) — present: move tabs into existing group; absent: create new group.
- `groups[].name` (optional string) — required when `groupId` is absent (new group).
- `groups[].tabIds` (required number[]) — tabs to assign to this group.
- Tabs not present in any group are left unchanged.

### Error Response

```json
{
  "error": "codex CLI failed: command not found"
}
```

Specific provider errors propagate through the NMH to the extension. The popup displays errors to the user with a 5s auto-dismiss.

## AI Integration

### System Prompt (fixed, server-side)

```
You are a browser tab grouping assistant.
Assign tabs to groups based on their URL, title, and description.

Rules:
1. Keep group names short (3 words max).
2. When no existing groups are provided, freely create groups based on tab content.
3. Reuse existing group names when a tab fits — do not create spelling or casing variants.
4. When a tab does not fit any existing group, create a new group for it. Only omit tabs that are completely unclassifiable (e.g. blank pages).
5. Existing groups show current tab-to-group assignments, but these may be stale. Decide each tab's group based solely on its current URL, title, and description. Move tabs to a different group if their content no longer fits.
```

### User Prompt (assembled by server)

```
{user's custom prompt}

Existing groups:
{existingGroups JSON}

Tabs to group:
{tabs JSON}
```

### Providers

**Claude Code** (`claude-code`) — Default. Uses `claude --print` with `--json-schema` for structured output.

**Codex** (`codex`) — Uses `codex exec --ephemeral` with `--output-schema` for structured output. Writes schema and reads output via temp files.

Both providers throw errors with specific messages on failure, which propagate to the popup.

## Extension Structure

### Permissions (manifest.json via WXT)

```json
{
  "manifest_version": 3,
  "permissions": ["tabs", "tabGroups", "scripting", "storage", "nativeMessaging"],
  "host_permissions": ["<all_urls>"]
}
```

### File Layout

```
packages/api-spec/
  src/types.ts         — shared TypeScript types (TabInfo, GroupRequest, GroupResponse, etc.)

extension/
  entrypoints/
    background.ts      — service worker: scheduler, tab events, grouping logic
    popup/
      index.html       — popup UI
      main.ts          — popup logic: button, settings, status display
      style.css        — popup styles
  utils/
    api.ts             — NMH communication via chrome.runtime.sendNativeMessage
    color.ts           — group name hash → Chrome tab group color

server/
  src/
    server.ts          — NMH entry: stdin/stdout message framing, dispatch to providers
    providers/
      index.ts         — provider routing, debug logging
      prompt.ts        — system + user prompt assembly
      claude-code/
        index.ts       — Claude Code CLI adapter
      codex/
        index.ts       — Codex CLI adapter
```

### Settings (chrome.storage.local)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `provider` | string | `"claude-code"` | LLM provider (`claude-code` or `codex`) |
| `model` | string | `""` | Model name (e.g. `sonnet`, `opus`) |
| `prompt` | string | `""` | Custom grouping instruction |
| `minTabsToGroup` | number | `0` | Skip grouping below this tab count (0 = always group) |
| `autoGroupEnabled` | boolean | `false` | Enable reactive auto-grouping |
| `debug` | boolean | `false` | Log requests/responses to `/tmp/zenodotus.log` |

### Group Color Assignment

Chrome supports 9 tab group colors. Colors are assigned by hashing the group name to produce a deterministic mapping. Same group name always gets the same color.

## Error Handling

| Scenario | Handling |
|----------|----------|
| NMH not installed | `chrome.runtime.sendNativeMessage` throws; popup shows error |
| Provider CLI not found | NMH returns `{ error: "..." }`; popup shows specific message |
| AI returns invalid JSON | Provider throws; error propagates to popup |
| Content script injection fails | Fall back to URL + title only, do not block |
| Tab closed before grouping executes | `chrome.tabs.get` catch filters it out, continue with rest |
| AI returns non-existent tabId | Filtered out during `applyGrouping` validation |
| Organize timeout (30s) | Popup shows "Timed out" error |

**Principle: non-blocking, best-effort.** Tab grouping is an assistive feature. No error should disrupt normal browser usage. Errors are shown in the popup with auto-dismiss.

## Grouping Application Logic

When applying a `GroupResponse`:

1. Build a name-to-groupId map from existing window groups (case-insensitive, whitespace-normalized).
2. For each group in the response:
   - Validate that all tabIds still exist and belong to the target window.
   - If a matching group exists (by `groupId` or normalized name), move tabs into it.
   - Otherwise, create a new group with a deterministic color.
3. Tabs not mentioned in the response remain in their current state.
