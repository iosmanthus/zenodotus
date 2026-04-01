# Zenodotus

Intelligent browser tab grouping powered by your local coding agent (Claude Code / Codex).

## How It Works

Zenodotus collects your open tabs (URL, title, meta description), sends them to a native messaging host which calls your coding agent, and applies the returned grouping to your browser. Groups are color-coded by name.

The server communicates with the extension via Chrome Native Messaging -- no HTTP server or open ports required.

```
Chrome Extension  <--native messaging-->  Zenodotus Server  -->  Claude Code or Codex (via subscription)
```

## Prerequisites

- [Claude Code](https://claude.com/product/claude-code) or [Codex](https://github.com/openai/codex) CLI installed and logged in
- Chromium-based browser (Chrome, Brave, Edge, etc.)

## Setup

```bash
git clone <repo-url> && cd zenodotus

# Enter dev shell if using Nix:
nix develop
# Or use direnv: direnv allow

# Install dependencies
pnpm install

# Generate types from OpenAPI spec (already committed, but run after spec changes)
pnpm generate

# Build the native messaging host
pnpm build:server

# Install the native messaging host manifest for your browser
ZENODOTUS_BROWSER=brave pnpm install:nmh
# Supported values: chrome, brave, chromium
```

## Loading the Extension

```bash
pnpm build:extension
```

Then in your browser:

1. Go to `chrome://extensions` (or `brave://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extension/.output/chrome-mv3`

Or download the latest release from [GitHub Releases](https://github.com/iosmanthus/zenodotus/releases).

## Usage

Click the Zenodotus extension icon to open the popup, then click **Organize Tabs** to group all open tabs across all windows. The agent analyzes each tab and assigns it to a group. Existing groups are preserved and reused.

### Auto-group

Toggle **Auto-group new tabs** to automatically group new tabs when they finish loading. New tabs are batched (2s debounce, 10s max wait) to reduce agent calls.

### Settings

Expand **Settings** to configure:

- **Provider** -- `claude-code` (default) or `codex`
- **Model** -- Model name. Default: `sonnet` for Claude Code. Leave empty for Codex default.
- **Enable thinking** -- Turn on extended thinking for more deliberate grouping. Off by default for speed.
- **Custom Prompt** -- Additional instructions. Example: `"Group by project, use Chinese names"`

Click **Save** to persist settings.
