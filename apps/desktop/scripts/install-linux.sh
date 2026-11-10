#!/usr/bin/env bash
# Puts the built app in ~/.local/share/rowvision and adds RowVision to the app launcher,
# so it can be searched for and opened like any other app. Undo with scripts/install-linux.sh --remove.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
dest="$HOME/.local/share/rowvision"
desktop="$HOME/.local/share/applications/rowvision.desktop"

if [ "${1:-}" = "--remove" ]; then
  rm -rf "$dest" "$desktop"
  for s in 16 24 32 48 64 128 256 512; do rm -f "$HOME/.local/share/icons/hicolor/${s}x${s}/apps/rowvision.png"; done
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  echo "RowVision removed. Your clips in ~/.config/RowVision are kept."
  exit 0
fi

# The unpacked build is the same app as the AppImage, but runs without FUSE, which many systems lack.
test -x release/linux-unpacked/rowvision || { echo "Build first: bash scripts/build-installer.sh"; exit 1; }
rm -rf "$dest"
mkdir -p "$dest" "$(dirname "$desktop")"
cp -r release/linux-unpacked/. "$dest/"
for s in 16 24 32 48 64 128 256 512; do
  mkdir -p "$HOME/.local/share/icons/hicolor/${s}x${s}/apps"
  cp "build/icons/${s}x${s}.png" "$HOME/.local/share/icons/hicolor/${s}x${s}/apps/rowvision.png"
done
cat > "$desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=RowVision
GenericName=Rowing technique
Comment=Rowing technique from your own video
Exec=$dest/rowvision %U
Icon=rowvision
Terminal=false
Categories=AudioVideo;Sports;
Keywords=rowing;rowvision;technique;video;
StartupWMClass=RowVision
DESKTOP
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
echo "Installed. Search for RowVision in your launcher."
