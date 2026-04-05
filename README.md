# Zenodotus

Intelligent browser tab grouping powered by your local coding agent (Claude Code / Codex).

## How It Works

Zenodotus collects your open tabs (URL, title, meta description), sends them to a native messaging host which calls your coding agent, and applies the returned grouping to your browser. Groups are color-coded by name.

No HTTP server or open ports required -- communication happens via Chrome Native Messaging.

```
Chrome Extension  <--native messaging-->  Zenodotus NMH  -->  Claude Code or Codex
```

## Prerequisites

- [Claude Code](https://claude.com/product/claude-code) or [Codex](https://github.com/openai/codex) CLI installed and logged in
- Chromium-based browser (Chrome, Brave, Chromium)
- Node.js (or Nix -- the installer handles both)

## Install

### 1. Install the native messaging host

```bash
# Chrome (default)
curl -fsSL https://raw.githubusercontent.com/iosmanthus/zenodotus/master/install.sh | bash

# Brave
curl -fsSL https://raw.githubusercontent.com/iosmanthus/zenodotus/master/install.sh | bash -s -- --browser brave

# Chromium
curl -fsSL https://raw.githubusercontent.com/iosmanthus/zenodotus/master/install.sh | bash -s -- --browser chromium
```

Run `./install.sh --help` for all options.

### 2. Install the extension

Download the latest `.zip` from [GitHub Releases](https://github.com/iosmanthus/zenodotus/releases), then:

1. Go to `chrome://extensions` (or `brave://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select the extracted folder

## Usage

Click the Zenodotus extension icon, then click **Organize Tabs** to group all tabs in the current window.

### Auto-group

Toggle **Auto-group new tabs** to automatically group new tabs when they finish loading. Tabs are batched (2s debounce, 10s max wait) to reduce agent calls.

### Settings

- **Provider** -- `claude-code` (default) or `codex`
- **Model** -- e.g. `sonnet`, `opus`, `haiku`. Default: `sonnet`
- **Enable thinking** -- Extended thinking for more deliberate grouping
- **Custom Prompt** -- e.g. `"Group by project, use Chinese names"`

## Development

```bash
git clone https://github.com/iosmanthus/zenodotus.git && cd zenodotus
pnpm install

# Build and install NMH locally
pnpm build:server
./install.sh --local --browser brave

# Build extension
pnpm build:extension
# Or run in dev mode
pnpm dev:extension
```
