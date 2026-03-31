# Zenodotus

Intelligent browser tab grouping powered by LLM.

## How It Works

Zenodotus collects your open tabs (URL, title, meta description), sends them to a local server which calls an LLM, and applies the returned grouping to your browser. Groups are color-coded by name.

```
Chrome Extension  -->  Local Server (:18080)  -->  Claude (via subscription)
```

## Prerequisites

- [Claude Code](https://claude.com/product/claude-code) CLI logged in (`claude login`)
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
```

## Running

### 1. Start the server

```bash
pnpm dev:server
```

The server listens on `http://localhost:18080` by default. To use a different port:

```bash
PORT=9090 pnpm dev:server
```

### 2. Load the extension

```bash
pnpm build:extension
```

Then in your browser:

1. Go to `chrome://extensions` (or `brave://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extension/.output/chrome-mv3`

## Usage

Click the Zenodotus extension icon to open the popup.

### Organize Tabs

Click **Organize Tabs** to group all open tabs across all windows. The LLM analyzes each tab and assigns it to a group. Existing groups are preserved and reused.

### Auto-group

Toggle **Auto-group new tabs** to automatically group new tabs when they finish loading. New tabs are batched (2s debounce, 10s max wait) to reduce LLM calls.

### Settings

Expand **Settings** to configure:

- **Server URL** -- Backend address. Default: `http://localhost:18080`
- **Model** -- LLM model name. Default: `sonnet` (Claude Sonnet 4.6). Other options: `opus`, `haiku`
- **Enable thinking** -- Turn on extended thinking for more deliberate grouping. Off by default for speed.
- **Custom Prompt** -- Additional instructions for the LLM. Example: `"Group by project, use Chinese names"`

Click **Save** to persist settings.
