#!/usr/bin/env bash
set -euo pipefail

REPO="iosmanthus/zenodotus"
HOST_NAME="com.zenodotus.host"

# Defaults
BROWSER="${ZENODOTUS_BROWSER:-chrome}"
INSTALL_DIR=""
VERSION="latest"
LOCAL=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Install the Zenodotus native messaging host.

Options:
  --browser <chrome|chromium|brave>   Target browser (default: chrome)
  --install-dir <path>                Override install directory
                                      (default: \$XDG_DATA_HOME/zenodotus)
  --version <tag>                     Release version to install (default: latest)
  --local                             Use local build (server/dist/server.mjs)
  -h, --help                          Show this help

Environment variables:
  ZENODOTUS_BROWSER        Same as --browser
  XDG_DATA_HOME            Base data directory (default: ~/.local/share)

Examples:
  # Install for Chrome (default)
  curl -fsSL https://raw.githubusercontent.com/$REPO/master/install.sh | bash

  # Install for Brave
  curl -fsSL https://raw.githubusercontent.com/$REPO/master/install.sh | bash -s -- --browser brave

  # Install a specific version
  ./install.sh --version v0.2.0 --browser chromium

  # Local development
  ./install.sh --local --browser brave
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser)      BROWSER="$2"; shift 2 ;;
    --install-dir)  INSTALL_DIR="$2"; shift 2 ;;
    --version)      VERSION="$2"; shift 2 ;;
    --local)        LOCAL=true; shift ;;
    -h|--help)      usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

# --- Resolve install directory ---
if [[ -z "$INSTALL_DIR" ]]; then
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/zenodotus"
fi

# --- Obtain server.mjs ---
mkdir -p "$INSTALL_DIR"
INSTALLED_BIN="$INSTALL_DIR/server.mjs"

if [[ "$LOCAL" == true ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  SOURCE_BIN="$SCRIPT_DIR/server/dist/server.mjs"
  if [[ ! -f "$SOURCE_BIN" ]]; then
    echo "Error: $SOURCE_BIN not found. Run 'pnpm build:server' first."
    exit 1
  fi
  echo "Using local build: $SOURCE_BIN"
  cp "$SOURCE_BIN" "$INSTALLED_BIN"
else
  if [[ "$VERSION" == "latest" ]]; then
    DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/server.mjs"
  else
    DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/server.mjs"
  fi

  echo "Downloading server.mjs ($VERSION)..."
  if command -v curl &>/dev/null; then
    curl -fsSL -o "$INSTALLED_BIN" "$DOWNLOAD_URL"
  elif command -v wget &>/dev/null; then
    wget -qO "$INSTALLED_BIN" "$DOWNLOAD_URL"
  else
    echo "Error: curl or wget is required"
    exit 1
  fi
fi

# --- Generate wrapper script ---
WRAPPER="$INSTALL_DIR/stdio-wrapper.sh"

cat > "$WRAPPER" <<WRAPPER_EOF
#!/usr/bin/env bash
set -euo pipefail
BIN="$INSTALLED_BIN"
if command -v nix &>/dev/null; then
  exec nix shell nixpkgs#nodejs --command node "\$BIN" "\$@"
else
  exec node "\$BIN" "\$@"
fi
WRAPPER_EOF

chmod +x "$WRAPPER"

# --- Determine NMH manifest directory ---
OS="$(uname -s)"

case "$OS" in
  Linux)
    case "$BROWSER" in
      chrome)   MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
      chromium) MANIFEST_DIR="$HOME/.config/chromium/NativeMessagingHosts" ;;
      brave)    MANIFEST_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
      *) echo "Unsupported browser: $BROWSER"; exit 1 ;;
    esac
    ;;
  Darwin)
    case "$BROWSER" in
      chrome)   MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
      chromium) MANIFEST_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts" ;;
      brave)    MANIFEST_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
      *) echo "Unsupported browser: $BROWSER"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

# --- Write NMH manifest ---
EXTENSION_ID="bgdonkmponooglmcffnobdbnlchgmlcg"

mkdir -p "$MANIFEST_DIR"
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Zenodotus native messaging host for LLM-powered tab grouping",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

echo "Installed successfully!"
echo ""
echo "  Files:    $INSTALL_DIR/"
echo "  Manifest: $MANIFEST_PATH"
echo "  Browser:  $BROWSER"
echo ""
echo "Load the extension in your browser and try it out."
