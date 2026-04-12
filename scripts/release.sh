#!/usr/bin/env bash
# Build and install Daemon locally — no sudo required.
#
# Usage:
#   ./scripts/release.sh           — rebuild + install current version
#   ./scripts/release.sh 0.2.0     — bump to 0.2.0, rebuild, install

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
TAURI_CONF="$DESKTOP/src-tauri/tauri.conf.json"
CARGO_TOML="$DESKTOP/src-tauri/Cargo.toml"

INSTALL_DIR="$HOME/.local/bin"
APPS_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor/128x128/apps"

# --- optional version bump ---
if [ -n "${1:-}" ]; then
  NEW_VER="$1"
  echo "Bumping version to $NEW_VER..."
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VER\"/" "$TAURI_CONF"
  sed -i "s/^version = \"[^\"]*\"/version = \"$NEW_VER\"/" "$CARGO_TOML"
fi

# --- read current version ---
VERSION=$(grep '"version"' "$TAURI_CONF" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
echo "Building Daemon v$VERSION..."

# --- build ---
cd "$DESKTOP"
pnpm tauri build

# --- find AppImage ---
APPIMAGE=$(find src-tauri/target/release/bundle/appimage -name "*.AppImage" 2>/dev/null | head -1)
if [ -z "$APPIMAGE" ]; then
  echo "Error: AppImage not found. Check build output above."
  exit 1
fi

# --- stop running instance if any ---
pkill -f "$INSTALL_DIR/Daemon" 2>/dev/null || true
sleep 1

# --- install AppImage ---
mkdir -p "$INSTALL_DIR" "$APPS_DIR" "$ICONS_DIR"

DEST="$INSTALL_DIR/Daemon"
cp "$APPIMAGE" "$DEST"
chmod +x "$DEST"

# --- install icon ---
ICON_SRC="$DESKTOP/src-tauri/icons/128x128.png"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICONS_DIR/daemon.png"
fi

# --- write .desktop entry ---
cat > "$APPS_DIR/daemon.desktop" <<EOF
[Desktop Entry]
Name=Daemon
Comment=Local-first personal productivity and knowledge management
Exec=$DEST
Icon=daemon
Terminal=false
Type=Application
Categories=Utility;
StartupWMClass=Daemon
EOF

# --- refresh app launcher ---
update-desktop-database "$APPS_DIR" 2>/dev/null || true

echo ""
echo "Done. Daemon v$VERSION installed — launch it from your app menu."
