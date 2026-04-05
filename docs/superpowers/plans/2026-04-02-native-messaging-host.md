# Native Messaging Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the HTTP server with a Chrome Native Messaging Host so the extension communicates directly with the LLM CLI tools via stdin/stdout, eliminating the need for a running backend server.

**Architecture:** The server package gains a new `stdio.ts` entry point that reads length-prefixed JSON from stdin, dispatches to the existing provider logic (`assignGroups`), and writes length-prefixed JSON to stdout. The extension switches from `fetch()` to `chrome.runtime.sendNativeMessage()`. HTTP-specific code (Fastify, CORS, OpenAPI glue, handlers.ts) is deleted. An `esbuild` build step bundles the stdio entry into a single `dist/stdio.mjs` file with a shebang. A setup script installs the NMH manifest.

**Tech Stack:** Node.js, esbuild (bundler), Chrome Native Messaging API, existing provider code unchanged.

---

### Task 1: Create the stdio NMH entry point

**Files:**
- Create: `server/src/stdio.ts`

- [ ] **Step 1: Create `server/src/stdio.ts`**

This file reads one native messaging request from stdin, calls `assignGroups`, and writes the response to stdout. The native messaging protocol uses 32-bit little-endian length-prefixed JSON on stdin/stdout.

```ts
import { assignGroups } from "./providers/index.ts";
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];

function readMessage(): Promise<GroupRequest> {
  return new Promise((resolve, reject) => {
    const headerBuf: Buffer[] = [];
    let headerLen = 0;

    const onReadable = () => {
      // Read 4-byte header
      if (headerLen < 4) {
        const chunk = process.stdin.read(4 - headerLen) as Buffer | null;
        if (!chunk) return;
        headerBuf.push(chunk);
        headerLen += chunk.length;
        if (headerLen < 4) return;
      }

      const header = Buffer.concat(headerBuf);
      const msgLen = header.readUInt32LE(0);

      if (msgLen === 0 || msgLen > 1024 * 1024) {
        cleanup();
        reject(new Error(`Invalid message length: ${msgLen}`));
        return;
      }

      const body = process.stdin.read(msgLen) as Buffer | null;
      if (!body) return;

      cleanup();
      try {
        resolve(JSON.parse(body.toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("readable", onReadable);
    };

    process.stdin.on("readable", onReadable);
  });
}

function writeMessage(obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(header);
  process.stdout.write(body);
}

async function main(): Promise<void> {
  try {
    const request = await readMessage();
    const result = await assignGroups(request);

    if (result) {
      writeMessage(result);
    } else {
      writeMessage({ error: "Failed to parse LLM response" });
    }
  } catch (err) {
    writeMessage({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

main().then(() => process.exit(0));
```

- [ ] **Step 2: Test stdin/stdout manually**

Run from the server directory:

```bash
echo -n '{"tabs":[{"tabId":1,"windowId":1,"url":"https://github.com","title":"GitHub","description":""}],"existingGroups":[]}' > /tmp/nmh-test.json && \
LEN=$(wc -c < /tmp/nmh-test.json) && \
python3 -c "import struct,sys; sys.stdout.buffer.write(struct.pack('<I',$LEN)); sys.stdout.buffer.write(open('/tmp/nmh-test.json','rb').read())" | \
npx tsx src/stdio.ts 2>/dev/null | \
python3 -c "import struct,sys,json; raw=sys.stdin.buffer.read(); n=struct.unpack('<I',raw[:4])[0]; print(json.dumps(json.loads(raw[4:4+n]),indent=2))"
```

Expected: JSON output with a `groups` array.

- [ ] **Step 3: Commit**

```bash
git add server/src/stdio.ts
git commit -m "feat: native messaging host stdio entry point"
```

---

### Task 2: Bundle with esbuild

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add esbuild dependency and build script**

Add `esbuild` to `devDependencies` and a `build` script to `server/package.json`:

```json
{
  "name": "@zenodotus/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server.ts",
    "build": "esbuild src/stdio.ts --bundle --platform=node --format=esm --outfile=dist/stdio.mjs --banner:js='#!/usr/bin/env node' --packages=external"
  },
  "dependencies": {
    "@fastify/cors": "^11.0.0",
    "fastify": "^5.0.0",
    "fastify-openapi-glue": "^4.0.0"
  },
  "devDependencies": {
    "@zenodotus/api-spec": "workspace:*",
    "esbuild": "^0.25.0",
    "tsx": "^4.21.0",
    "typescript": "^5.8.0"
  }
}
```

Note: `--packages=external` keeps `node:*` builtins external. The `@zenodotus/api-spec` workspace dependency is inlined by esbuild since it's just JSON/types.

- [ ] **Step 2: Install and build**

```bash
cd server && pnpm install && pnpm build
```

Expected: `server/dist/stdio.mjs` is created, starts with `#!/usr/bin/env node`.

- [ ] **Step 3: Verify the bundle works**

```bash
chmod +x server/dist/stdio.mjs && \
echo -n '{"tabs":[{"tabId":1,"windowId":1,"url":"https://github.com","title":"GitHub","description":""}]}' > /tmp/nmh-test.json && \
LEN=$(wc -c < /tmp/nmh-test.json) && \
python3 -c "import struct,sys; sys.stdout.buffer.write(struct.pack('<I',$LEN)); sys.stdout.buffer.write(open('/tmp/nmh-test.json','rb').read())" | \
node server/dist/stdio.mjs 2>/dev/null | \
python3 -c "import struct,sys,json; raw=sys.stdin.buffer.read(); n=struct.unpack('<I',raw[:4])[0]; print(json.dumps(json.loads(raw[4:4+n]),indent=2))"
```

Expected: Same JSON output with `groups` array as Task 1.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/dist/stdio.mjs
git commit -m "feat: esbuild bundle for native messaging host"
```

---

### Task 3: NMH manifest and install script

**Files:**
- Create: `scripts/install-nmh.sh`

- [ ] **Step 1: Create the install script**

This script detects the OS/browser, resolves the absolute path to `dist/stdio.mjs`, writes the NMH manifest, and sets permissions.

```bash
#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.zenodotus.host"

# Resolve the host binary path
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST_BIN="$REPO_ROOT/server/dist/stdio.mjs"

if [ ! -f "$HOST_BIN" ]; then
  echo "Error: $HOST_BIN not found. Run 'pnpm --filter @zenodotus/server build' first."
  exit 1
fi

chmod +x "$HOST_BIN"

# Detect extension ID — allow override via env
EXTENSION_ID="${ZENODOTUS_EXTENSION_ID:-}"

if [ -z "$EXTENSION_ID" ]; then
  echo "Warning: ZENODOTUS_EXTENSION_ID not set."
  echo "Set it to your extension ID for security, or the manifest will allow all extensions."
  ALLOWED_ORIGINS='["chrome-extension://*/"]'
else
  ALLOWED_ORIGINS="[\"chrome-extension://$EXTENSION_ID/\"]"
fi

# Detect OS and browser
OS="$(uname -s)"
BROWSER="${ZENODOTUS_BROWSER:-chrome}"

case "$OS" in
  Linux)
    case "$BROWSER" in
      chrome)  MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
      chromium) MANIFEST_DIR="$HOME/.config/chromium/NativeMessagingHosts" ;;
      brave)   MANIFEST_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
      *)       echo "Unsupported browser: $BROWSER"; exit 1 ;;
    esac
    ;;
  Darwin)
    case "$BROWSER" in
      chrome)  MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
      chromium) MANIFEST_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts" ;;
      brave)   MANIFEST_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
      *)       echo "Unsupported browser: $BROWSER"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS (Windows requires manual setup)"
    exit 1
    ;;
esac

mkdir -p "$MANIFEST_DIR"

MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Zenodotus native messaging host for LLM-powered tab grouping",
  "path": "$HOST_BIN",
  "type": "stdio",
  "allowed_origins": $ALLOWED_ORIGINS
}
EOF

echo "Installed NMH manifest to: $MANIFEST_PATH"
echo "Host binary: $HOST_BIN"
echo ""
echo "To verify, load the extension in Chrome and check chrome://extensions for native messaging errors."
```

- [ ] **Step 2: Make executable and test**

```bash
chmod +x scripts/install-nmh.sh
ZENODOTUS_BROWSER=brave ./scripts/install-nmh.sh
cat ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.zenodotus.host.json
```

Expected: JSON manifest with correct `path` and `allowed_origins`.

- [ ] **Step 3: Commit**

```bash
git add scripts/install-nmh.sh
git commit -m "feat: NMH manifest install script for Linux/macOS"
```

---

### Task 4: Extension — switch to native messaging

**Files:**
- Modify: `extension/utils/api.ts`
- Modify: `extension/wxt.config.ts`

- [ ] **Step 1: Add `nativeMessaging` permission in `extension/wxt.config.ts`**

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Zenodotus",
    description: "Intelligent LLM-powered tab grouping",
    permissions: ["tabs", "tabGroups", "scripting", "storage", "nativeMessaging"],
    host_permissions: ["<all_urls>"],
  },
});
```

- [ ] **Step 2: Rewrite `extension/utils/api.ts` to use native messaging**

Replace the entire file:

```ts
import type { components } from "@zenodotus/api-spec/schema";

type GroupRequest = components["schemas"]["GroupRequest"];
type GroupResponse = components["schemas"]["GroupResponse"];

const NMH_HOST = "com.zenodotus.host";

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendNativeMessage(NMH_HOST, {
      tabs: [],
    });
    // If we get any response (even an error), the host is reachable
    return response != null;
  } catch {
    return false;
  }
}

export async function requestGrouping(request: GroupRequest): Promise<GroupResponse | null> {
  try {
    const response = await chrome.runtime.sendNativeMessage(NMH_HOST, request);
    if (response?.error) {
      console.error("[zenodotus] NMH error:", response.error);
      return null;
    }
    return response as GroupResponse;
  } catch (err) {
    console.error("[zenodotus] NMH communication error:", err);
    return null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add extension/utils/api.ts extension/wxt.config.ts
git commit -m "feat: switch extension to native messaging"
```

---

### Task 5: Remove HTTP server code

**Files:**
- Delete: `server/src/server.ts`
- Delete: `server/src/handlers.ts`
- Modify: `server/package.json` (remove Fastify dependencies)

- [ ] **Step 1: Delete HTTP-specific files**

```bash
rm server/src/server.ts server/src/handlers.ts
```

- [ ] **Step 2: Clean up `server/package.json`**

Remove Fastify dependencies and the `dev` script:

```json
{
  "name": "@zenodotus/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "esbuild src/stdio.ts --bundle --platform=node --format=esm --outfile=dist/stdio.mjs --banner:js='#!/usr/bin/env node' --packages=external"
  },
  "devDependencies": {
    "@zenodotus/api-spec": "workspace:*",
    "esbuild": "^0.25.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 3: Remove `tsx` since it's no longer needed**

`tsx` was only used for the `dev` script running `server.ts`. It's no longer needed.

- [ ] **Step 4: Run `pnpm install` to update lockfile**

```bash
pnpm install
```

- [ ] **Step 5: Verify build still works**

```bash
cd server && pnpm build
```

Expected: `dist/stdio.mjs` is regenerated without errors.

- [ ] **Step 6: Commit**

```bash
git add -u server/
git commit -m "refactor: remove HTTP server, keep only NMH stdio entry"
```

---

### Task 6: Extension — remove health check UI

**Files:**
- Modify: `extension/entrypoints/popup/index.html`
- Modify: `extension/entrypoints/popup/main.ts`
- Modify: `extension/entrypoints/popup/style.css`

- [ ] **Step 1: Remove status bar from `extension/entrypoints/popup/index.html`**

Remove the `#status-bar` div and the `Server URL` setting. The `Organize Tabs` button should be enabled by default (no connection check needed):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <div id="app">
      <button type="button" id="organize-btn">Organize Tabs</button>
      <p id="error-msg"></p>

      <label>
        <input type="checkbox" id="auto-toggle" />
        Auto-group new tabs
      </label>

      <details>
        <summary>Settings</summary>
        <label class="setting-label">Provider</label>
        <input type="text" id="provider-input" placeholder="claude-code" />
        <label class="setting-label">Model</label>
        <input type="text" id="model-input" placeholder="sonnet" />
        <label class="setting-row">
          <input type="checkbox" id="thinking-toggle" />
          Enable thinking
        </label>
        <label class="setting-label">Custom Prompt</label>
        <textarea
          id="prompt-input"
          rows="4"
          placeholder="e.g. Group by project, use English names"
        ></textarea>
        <button type="button" id="save-settings-btn">Save</button>
      </details>
    </div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Update `extension/entrypoints/popup/main.ts`**

Remove all health check / connection status logic and the `serverUrl` storage field:

```ts
const organizeBtn = document.getElementById("organize-btn") as HTMLButtonElement;
const autoToggle = document.getElementById("auto-toggle") as HTMLInputElement;
const providerInput = document.getElementById("provider-input") as HTMLInputElement;
const modelInput = document.getElementById("model-input") as HTMLInputElement;
const thinkingToggle = document.getElementById("thinking-toggle") as HTMLInputElement;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const saveSettingsBtn = document.getElementById("save-settings-btn")!;
const errorMsg = document.getElementById("error-msg")!;

let errorClearTimer: ReturnType<typeof setTimeout> | null = null;

function showError(message: string): void {
  errorMsg.textContent = message;
  if (errorClearTimer != null) {
    clearTimeout(errorClearTimer);
  }
  errorClearTimer = setTimeout(() => {
    errorMsg.textContent = "";
    errorClearTimer = null;
  }, 5000);
}

function setOrganizing(active: boolean): void {
  organizeBtn.disabled = active;
  organizeBtn.classList.toggle("loading", active);
  organizeBtn.textContent = active ? "Organizing..." : "Organize Tabs";
}

organizeBtn.addEventListener("click", () => {
  setOrganizing(true);
  errorMsg.textContent = "";
  chrome.runtime.sendMessage({ action: "organize" });
});

chrome.storage.local.onChanged.addListener((changes) => {
  if (changes.organizeStatus) {
    const status = changes.organizeStatus.newValue;
    if (status === "done") {
      setOrganizing(false);
      chrome.storage.local.remove(["organizeStatus", "organizeError"]);
    } else if (status === "error") {
      setOrganizing(false);
      chrome.storage.local.get({ organizeError: "" }).then((data) => {
        showError(data.organizeError || "Unknown error");
        chrome.storage.local.remove(["organizeStatus", "organizeError"]);
      });
    } else if (status === "organizing") {
      setOrganizing(true);
    }
  }
});

autoToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    action: "setAutoGroup",
    enabled: autoToggle.checked,
  });
});

chrome.runtime.sendMessage({ action: "getAutoGroup" }).then((response) => {
  if (response) autoToggle.checked = response.autoGroupEnabled;
});

chrome.storage.local
  .get({
    prompt: "",
    model: "",
    thinking: false,
    provider: "",
    organizeStatus: null,
  })
  .then((data) => {
    promptInput.value = data.prompt;
    modelInput.value = data.model;
    providerInput.value = data.provider;
    thinkingToggle.checked = data.thinking;
    if (data.organizeStatus === "organizing") {
      setOrganizing(true);
    }
  });

saveSettingsBtn.addEventListener("click", () => {
  chrome.storage.local.set({
    prompt: promptInput.value,
    model: modelInput.value,
    thinking: thinkingToggle.checked,
    provider: providerInput.value,
  });
});
```

- [ ] **Step 3: Update `extension/entrypoints/popup/style.css`**

Remove the `#status-bar`, `#status-dot`, `#status-text`, `#check-btn`, and `#server-url-input` CSS rules. Keep everything else.

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

#error-msg {
  color: #ef4444;
  font-size: 12px;
  min-height: 16px;
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

.setting-label {
  display: block;
  margin-top: 8px;
  color: #666;
  font-size: 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: #333;
}

#provider-input {
  width: 100%;
  margin-top: 4px;
  padding: 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
}

#model-input {
  width: 100%;
  margin-top: 4px;
  padding: 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
}

#prompt-input {
  width: 100%;
  margin-top: 4px;
  padding: 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  resize: vertical;
}

#save-settings-btn {
  margin-top: 8px;
  padding: 4px 10px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
```

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/popup/index.html extension/entrypoints/popup/main.ts extension/entrypoints/popup/style.css
git commit -m "refactor: remove health check UI and server URL setting"
```

---

### Task 7: Update root scripts and README

**Files:**
- Modify: `package.json` (root)
- Modify: `README.md`

- [ ] **Step 1: Update root `package.json` scripts**

Replace `dev:server` with `build:server` and add `install:nmh`:

```json
{
  "name": "zenodotus",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "scripts": {
    "generate": "pnpm --filter @zenodotus/api-spec generate",
    "build:server": "pnpm --filter @zenodotus/server build",
    "dev:extension": "pnpm --filter @zenodotus/extension dev",
    "build:extension": "pnpm --filter @zenodotus/extension build",
    "install:nmh": "./scripts/install-nmh.sh",
    "lint": "biome check .",
    "format": "biome check --write .",
    "test": "vitest run"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.10",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Update `README.md` setup instructions**

Replace the server start instructions with NMH build + install instructions. The new setup flow is:

1. `pnpm install`
2. `pnpm generate`
3. `pnpm build:server`
4. `ZENODOTUS_BROWSER=brave pnpm install:nmh`
5. Load extension in browser
6. Click "Organize Tabs"

Update the README to reflect this. Remove references to `dev:server` and `http://localhost:18080`.

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "docs: update setup instructions for native messaging"
```

---

### Task 8: End-to-end manual test

- [ ] **Step 1: Build and install**

```bash
pnpm install
pnpm generate
pnpm build:server
ZENODOTUS_BROWSER=brave pnpm install:nmh
```

- [ ] **Step 2: Build and load extension**

```bash
pnpm build:extension
```

Load `extension/.output/chrome-mv3/` in Brave (`brave://extensions` > Developer Mode > Load unpacked).

- [ ] **Step 3: Test manual grouping**

Open several tabs (GitHub repos, news sites, docs). Click the extension icon and click "Organize Tabs". Verify tabs get grouped with appropriate names and colors.

- [ ] **Step 4: Test auto-grouping**

Enable "Auto-group new tabs" toggle. Open a new tab and navigate to a website. After page load, verify the tab gets assigned to a group.

- [ ] **Step 5: Test error handling**

Temporarily rename `server/dist/stdio.mjs` to break the host. Click "Organize Tabs". Verify the error message appears in the popup. Rename the file back.

- [ ] **Step 6: Commit any fixes from testing**
