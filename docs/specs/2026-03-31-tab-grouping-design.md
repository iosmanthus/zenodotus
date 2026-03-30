# Zenodotus — Intelligent Tab Grouping Extension

## Overview

A Chrome extension that uses LLM to intelligently group and sort browser tabs. The extension communicates with a local HTTP server that abstracts the AI backend (Claude Code SDK, Codex, or others).

## Architecture

```
┌─────────────────────────────────────┐
│         Chrome Extension            │
│                                     │
│  popup.html  ← button + prompt edit │
│  background.js (service worker)     │
│    ├ listen tab events (onUpdated)  │
│    ├ collect tabs across windows    │
│    ├ inject content script for meta │
│    └ call local server API          │
│  content.js  ← extract meta desc   │
│                                     │
└──────────── fetch ──────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│        Local Server (:18080)        │
│                                     │
│  POST /group                        │
│  GET  /health                       │
│                                     │
│  Backend swappable via providers:   │
│    claude-code / codex / ...        │
└─────────────────────────────────────┘
```

## Trigger Modes

### Manual Trigger

User clicks the "Organize Tabs" button in the popup. All tabs across all windows are collected, enriched with meta descriptions, and sent to the server for grouping.

### Auto Trigger

When a tab finishes loading (`chrome.tabs.onUpdated`, status `complete`):

1. Check if the tab is already in a group — if yes, skip.
2. Extract url, title, and meta description.
3. Query existing tab groups as context.
4. Send the single tab + existing groups to the server.
5. Apply the returned grouping.

## Data Sources

For each tab, the extension collects:

- **URL** (~80 chars)
- **Title** (~50 chars)
- **Meta description** (~150 chars) — extracted via `chrome.scripting.executeScript` injecting a content script on demand

Estimated total for 50 tabs: ~14K chars (~4K tokens). Lightweight per request.

If content script injection fails (e.g., restricted pages like `chrome://`), fall back to URL + title only.

## API Protocol

### `POST /group`

**Request:**

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
  "prompt": "User's custom grouping strategy prompt"
}
```

**Response:**

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
- `groups[].name` (optional string) — required when `groupId` is absent (new group). When present with `groupId`, renames the group.
- `groups[].tabIds` (required number[]) — tabs to assign to this group.
- Tabs not present in any group are left unchanged.

### `GET /health`

**Response:**

```json
{
  "ok": true
}
```

## AI Integration

### Tool Definition (function calling)

```json
{
  "name": "assign_tab_groups",
  "description": "Assign browser tabs to groups based on their content and context.",
  "parameters": {
    "type": "object",
    "properties": {
      "groups": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "groupId": {
              "type": "number",
              "description": "ID of an existing group. Omit to create a new group."
            },
            "name": {
              "type": "string",
              "description": "Name for the group. Required when creating a new group."
            },
            "tabIds": {
              "type": "array",
              "items": { "type": "number" }
            }
          },
          "required": ["tabIds"]
        }
      }
    },
    "required": ["groups"]
  }
}
```

Uses `parameters` as the schema field for compatibility across Anthropic and OpenAI APIs. The provider layer handles format differences.

### System Prompt (fixed, server-side)

```
You are a browser tab grouping assistant. Assign tabs to groups based on their URL, title, and description.

Rules:
1. Prefer assigning tabs to existing groups when relevant.
2. Only create new groups when no existing group fits.
3. Keep group names short (2-4 words).
4. Tabs that do not fit any group should be omitted from the response.
```

### User Prompt (assembled by server)

```
{user's custom prompt, e.g., "Group by project, use English names"}

Existing groups:
{existingGroups JSON}

Tabs to group:
{tabs JSON}
```

The user's custom prompt is stored in `chrome.storage.local` and passed from the extension to the server. Default can be empty or a simple "Group by topic".

## Extension Structure

### Permissions (manifest.json)

```json
{
  "manifest_version": 3,
  "permissions": ["tabs", "tabGroups", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "background.js" }
}
```

### File Layout

```
extension/
  manifest.json
  background.js         — core logic: event listeners, tab collection, API calls, group execution
  content.js            — extract meta description, injected on demand via scripting API
  popup.html/js/css     — UI: button + prompt editor + service status indicator
  utils/
    color.js            — group name hash → Chrome tab group color
    api.js              — wrap /group and /health requests

server/
  server.mjs            — HTTP server, prompt assembly, AI call, response parsing
  providers/
    claude-code.mjs     — Claude Code SDK adapter
```

### Group Color Assignment

Chrome supports 9 tab group colors. Colors are assigned by hashing the group name to produce a deterministic mapping. Same group name always gets the same color.

## Error Handling

| Scenario | Handling |
|----------|----------|
| Local server not running | Popup shows "Service disconnected", button disabled. User manually clicks a check button to retry health check. |
| AI returns invalid JSON | Silently skip this grouping, no retry. |
| Content script injection fails | Fall back to URL + title only, do not block. |
| Tab closed before grouping executes | Ignore the tab, continue processing the rest. |
| AI returns non-existent tabId | Filter out invalid tabIds, execute only valid ones. |
| AI returns non-existent groupId | Treat as new group, create with the returned name. |

**Principle: non-blocking, best-effort.** Tab grouping is an assistive feature. No error should disrupt normal browser usage.

## Roadmap (not in scope for v1)

- **Dry-run preview** — show grouping result in popup before applying, user confirms then executes.
- **chrome.storage.sync** — sync user prompt across devices via Chrome account.
