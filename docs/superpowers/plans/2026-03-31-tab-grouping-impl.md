# Zenodotus Tab Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension + local server that uses LLM to intelligently group browser tabs.

**Architecture:** Chrome Extension (Manifest V3) communicates with a local Node.js HTTP server on port 18080. The server assembles prompts and calls the LLM via Claude Code SDK. The extension collects tab info (URL, title, meta description), sends it to the server, and applies the returned grouping.

**Tech Stack:** Vanilla JS (extension), Node.js with `@anthropic-ai/claude-code` SDK (server). NixOS environment — use `nix-shell -p nodejs` for Node.js.

**Environment note:** This is a NixOS system. Node.js is available via `nix-shell -p nodejs`. A `shell.nix` file will be created at the project root for convenience.

---

### Task 1: Project scaffolding and dev environment

**Files:**
- Create: `shell.nix`
- Create: `server/package.json`
- Create: `extension/manifest.json`

- [ ] **Step 1: Create shell.nix**

```nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs
  ];
}
```

- [ ] **Step 2: Create server/package.json**

```json
{
  "name": "zenodotus-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node server.mjs"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.0"
  }
}
```

- [ ] **Step 3: Create extension/manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Zenodotus",
  "version": "0.1.0",
  "description": "Intelligent LLM-powered tab grouping",
  "permissions": ["tabs", "tabGroups", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js"
  }
}
```

- [ ] **Step 4: Install server dependencies**

Run: `cd server && nix-shell --run "npm install"`
Expected: `node_modules` created, `package-lock.json` generated.

- [ ] **Step 5: Commit**

```bash
git add shell.nix server/package.json server/package-lock.json extension/manifest.json
git commit -m "feat: project scaffolding with nix shell and extension manifest"
```

---

### Task 2: Server — health endpoint

**Files:**
- Create: `server/server.mjs`

- [ ] **Step 1: Create server.mjs with health endpoint**

```js
import http from "node:http";

const PORT = 18080;

function handleHealth(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health" && req.method === "GET") {
    return handleHealth(req, res);
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Zenodotus server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Test health endpoint**

Run: `cd server && nix-shell --run "node server.mjs &" && sleep 1 && curl -s http://localhost:18080/health && kill %1`
Expected: `{"ok":true}`

- [ ] **Step 3: Commit**

```bash
git add server/server.mjs
git commit -m "feat: server with health endpoint and CORS support"
```

---

### Task 3: Server — Claude Code SDK provider

**Files:**
- Create: `server/providers/claude-code.mjs`

- [ ] **Step 1: Create Claude Code SDK provider**

```js
import { query } from "@anthropic-ai/claude-code";

const SYSTEM_PROMPT = `You are a browser tab grouping assistant. Assign tabs to groups based on their URL, title, and description.

Rules:
1. Prefer assigning tabs to existing groups when relevant.
2. Only create new groups when no existing group fits.
3. Keep group names short (2-4 words).
4. Tabs that do not fit any group should be omitted from the response.`;

const TOOL = {
  name: "assign_tab_groups",
  description: "Assign browser tabs to groups based on their content and context.",
  parameters: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            groupId: {
              type: "number",
              description: "ID of an existing group. Omit to create a new group.",
            },
            name: {
              type: "string",
              description:
                "Name for the group. Required when creating a new group.",
            },
            tabIds: {
              type: "array",
              items: { type: "number" },
            },
          },
          required: ["tabIds"],
        },
      },
    },
    required: ["groups"],
  },
};

function buildUserPrompt({ tabs, existingGroups, prompt }) {
  let msg = "";
  if (prompt) {
    msg += prompt + "\n\n";
  }
  if (existingGroups.length > 0) {
    msg += "Existing groups:\n" + JSON.stringify(existingGroups, null, 2) + "\n\n";
  }
  msg += "Tabs to group:\n" + JSON.stringify(tabs, null, 2);
  return msg;
}

export async function assignGroups({ tabs, existingGroups, prompt }) {
  const userPrompt = buildUserPrompt({ tabs, existingGroups, prompt });
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}\n\nUse the assign_tab_groups tool to respond.`;

  const events = [];
  for await (const event of query({
    prompt: fullPrompt,
    options: {
      maxTurns: 1,
      allowedTools: [],
    },
  })) {
    events.push(event);
  }

  // Extract the text response from Claude Code and parse JSON
  for (const event of events) {
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "text") {
          // Try to extract JSON from the text
          const jsonMatch = block.text.match(/\{[\s\S]*"groups"[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        }
      }
    }
  }

  return null;
}
```

- [ ] **Step 2: Test the provider manually**

Run:
```bash
cd server && nix-shell --run 'node -e "
import { assignGroups } from \"./providers/claude-code.mjs\";
const result = await assignGroups({
  tabs: [
    { tabId: 1, windowId: 1, url: \"https://github.com/torvalds/linux\", title: \"torvalds/linux\", description: \"Linux kernel source tree\" },
    { tabId: 2, windowId: 1, url: \"https://news.ycombinator.com\", title: \"Hacker News\", description: \"\" },
    { tabId: 3, windowId: 1, url: \"https://github.com/nodejs/node\", title: \"nodejs/node\", description: \"Node.js JavaScript runtime\" }
  ],
  existingGroups: [],
  prompt: \"\"
});
console.log(JSON.stringify(result, null, 2));
"'
```

Expected: JSON with `groups` array containing reasonable groupings.

- [ ] **Step 3: Commit**

```bash
git add server/providers/claude-code.mjs
git commit -m "feat: Claude Code SDK provider for tab grouping"
```

---

### Task 4: Server — /group endpoint

**Files:**
- Modify: `server/server.mjs`

- [ ] **Step 1: Add /group POST handler to server.mjs**

Add the import at the top of `server/server.mjs`:

```js
import { assignGroups } from "./providers/claude-code.mjs";
```

Add the handler function before the `http.createServer` call:

```js
async function handleGroup(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const { tabs, existingGroups, prompt } = parsed;

  if (!Array.isArray(tabs)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "tabs must be an array" }));
    return;
  }

  try {
    const result = await assignGroups({
      tabs,
      existingGroups: existingGroups || [],
      prompt: prompt || "",
    });

    if (!result) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to parse LLM response" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("LLM error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "LLM request failed" }));
  }
}
```

Add the route in the `http.createServer` callback, after the health check:

```js
if (url.pathname === "/group" && req.method === "POST") {
  return handleGroup(req, res);
}
```

- [ ] **Step 2: Test /group endpoint**

Run:
```bash
cd server && nix-shell --run "node server.mjs &" && sleep 2 && curl -s -X POST http://localhost:18080/group \
  -H "Content-Type: application/json" \
  -d '{
    "tabs": [
      {"tabId": 1, "windowId": 1, "url": "https://github.com/torvalds/linux", "title": "torvalds/linux", "description": "Linux kernel source tree"},
      {"tabId": 2, "windowId": 1, "url": "https://news.ycombinator.com", "title": "Hacker News", "description": ""}
    ],
    "existingGroups": [],
    "prompt": ""
  }' && kill %1
```

Expected: `{"groups":[...]}` with tab assignments.

- [ ] **Step 3: Commit**

```bash
git add server/server.mjs
git commit -m "feat: /group endpoint calling Claude Code SDK"
```

---

### Task 5: Extension — API utility and color hash

**Files:**
- Create: `extension/utils/api.js`
- Create: `extension/utils/color.js`

- [ ] **Step 1: Create extension/utils/api.js**

```js
const SERVER_URL = "http://localhost:18080";

export async function checkHealth() {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

export async function requestGrouping({ tabs, existingGroups, prompt }) {
  const res = await fetch(`${SERVER_URL}/group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabs, existingGroups, prompt }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return null;
  return res.json();
}
```

- [ ] **Step 2: Create extension/utils/color.js**

```js
const COLORS = [
  "grey", "blue", "red", "yellow", "green",
  "pink", "purple", "cyan", "orange",
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function colorForGroup(name) {
  return COLORS[hashString(name) % COLORS.length];
}
```

- [ ] **Step 3: Commit**

```bash
git add extension/utils/api.js extension/utils/color.js
git commit -m "feat: API client and color hash utilities"
```

---

### Task 6: Extension — content script for meta description

**Files:**
- Create: `extension/content.js`

- [ ] **Step 1: Create extension/content.js**

```js
(() => {
  const meta = document.querySelector('meta[name="description"]');
  return meta ? meta.getAttribute("content") || "" : "";
})();
```

This is injected via `chrome.scripting.executeScript` — the return value of the IIFE is the result.

- [ ] **Step 2: Commit**

```bash
git add extension/content.js
git commit -m "feat: content script for meta description extraction"
```

---

### Task 7: Extension — background service worker

**Files:**
- Create: `extension/background.js`

- [ ] **Step 1: Create extension/background.js**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add extension/background.js
git commit -m "feat: background service worker with manual and auto tab grouping"
```

---

### Task 8: Extension — popup UI

**Files:**
- Create: `extension/popup.html`
- Create: `extension/popup.js`
- Create: `extension/popup.css`

- [ ] **Step 1: Create extension/popup.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <div id="app">
    <div id="status-bar">
      <span id="status-dot"></span>
      <span id="status-text">Checking...</span>
      <button id="check-btn" title="Check connection">&#x21bb;</button>
    </div>

    <button id="organize-btn" disabled>Organize Tabs</button>

    <label>
      <input type="checkbox" id="auto-toggle" />
      Auto-group new tabs
    </label>

    <details>
      <summary>Custom Prompt</summary>
      <textarea id="prompt-input" rows="4" placeholder="e.g. Group by project, use English names"></textarea>
      <button id="save-prompt-btn">Save</button>
    </details>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create extension/popup.css**

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  width: 300px;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  padding: 12px;
}

#app {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

#status-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

#status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ccc;
}

#status-dot.connected {
  background: #22c55e;
}

#status-dot.disconnected {
  background: #ef4444;
}

#status-text {
  flex: 1;
  color: #666;
}

#check-btn {
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  padding: 2px 6px;
  font-size: 14px;
}

#organize-btn {
  padding: 8px 12px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

#organize-btn:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}

#organize-btn.loading {
  opacity: 0.7;
}

label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #333;
}

details {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px;
}

summary {
  cursor: pointer;
  color: #666;
}

#prompt-input {
  width: 100%;
  margin-top: 8px;
  padding: 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  resize: vertical;
}

#save-prompt-btn {
  margin-top: 6px;
  padding: 4px 10px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
```

- [ ] **Step 3: Create extension/popup.js**

```js
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const checkBtn = document.getElementById("check-btn");
const organizeBtn = document.getElementById("organize-btn");
const autoToggle = document.getElementById("auto-toggle");
const promptInput = document.getElementById("prompt-input");
const savePromptBtn = document.getElementById("save-prompt-btn");

let connected = false;

async function checkConnection() {
  statusDot.className = "";
  statusText.textContent = "Checking...";

  try {
    const res = await fetch("http://localhost:18080/health", {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    connected = data.ok === true;
  } catch {
    connected = false;
  }

  if (connected) {
    statusDot.className = "connected";
    statusText.textContent = "Connected";
    organizeBtn.disabled = false;
  } else {
    statusDot.className = "disconnected";
    statusText.textContent = "Service disconnected";
    organizeBtn.disabled = true;
  }
}

checkBtn.addEventListener("click", checkConnection);

organizeBtn.addEventListener("click", async () => {
  organizeBtn.disabled = true;
  organizeBtn.classList.add("loading");
  organizeBtn.textContent = "Organizing...";

  chrome.runtime.sendMessage({ action: "organize" }, (response) => {
    organizeBtn.disabled = false;
    organizeBtn.classList.remove("loading");
    organizeBtn.textContent = "Organize Tabs";
  });
});

autoToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    action: "setAutoGroup",
    enabled: autoToggle.checked,
  });
});

// Load saved state
chrome.runtime.sendMessage({ action: "getAutoGroup" }, (response) => {
  if (response) autoToggle.checked = response.autoGroupEnabled;
});

chrome.storage.local.get({ prompt: "" }, (data) => {
  promptInput.value = data.prompt;
});

savePromptBtn.addEventListener("click", () => {
  chrome.storage.local.set({ prompt: promptInput.value });
});

// Initial connection check
checkConnection();
```

- [ ] **Step 4: Commit**

```bash
git add extension/popup.html extension/popup.css extension/popup.js
git commit -m "feat: popup UI with organize button, auto-toggle, and prompt editor"
```

---

### Task 9: Extension — fix manifest for ES modules

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/background.js`

Chrome MV3 service workers don't support ES module `import` by default. We need to either use `"type": "module"` in the manifest or bundle. Simplest approach: use `"type": "module"` in manifest.

- [ ] **Step 1: Update manifest.json to support ES modules**

Add `"type": "module"` to the background section:

```json
{
  "manifest_version": 3,
  "name": "Zenodotus",
  "version": "0.1.0",
  "description": "Intelligent LLM-powered tab grouping",
  "permissions": ["tabs", "tabGroups", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/manifest.json
git commit -m "fix: enable ES module support for background service worker"
```

---

### Task 10: End-to-end manual test

- [ ] **Step 1: Start the server**

Run: `cd server && nix-shell --run "node server.mjs"`
Expected: `Zenodotus server listening on http://localhost:18080`

- [ ] **Step 2: Load extension in Brave**

1. Open `brave://extensions`
2. Enable Developer Mode
3. Click "Load unpacked"
4. Select the `extension/` directory

- [ ] **Step 3: Test health check**

Click the extension icon, verify status shows "Connected".

- [ ] **Step 4: Test manual grouping**

Open several tabs (e.g., GitHub repos, news sites, docs) and click "Organize Tabs". Verify tabs get grouped with appropriate names and colors.

- [ ] **Step 5: Test auto-grouping**

Enable "Auto-group new tabs" toggle, open a new tab and navigate to a website. After page load, verify the tab gets assigned to an appropriate group.

- [ ] **Step 6: Test custom prompt**

Expand "Custom Prompt", enter "Group by programming language", save, and click "Organize Tabs". Verify grouping strategy changes.

- [ ] **Step 7: Commit any fixes from testing**
