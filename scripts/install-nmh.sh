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
