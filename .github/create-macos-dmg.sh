#!/usr/bin/env bash
# Create a simple macOS DMG with hdiutil (no Finder AppleScript / create-dmg).
# Usage: create-macos-dmg.sh <Azalea.app> <output.dmg> [volume-name]
set -euo pipefail

APP_PATH="${1:?Usage: $0 <App.app> <out.dmg> [volname]}"
DMG_PATH="${2:?Usage: $0 <App.app> <out.dmg> [volname]}"
VOL_NAME="${3:-Azalea}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found: $APP_PATH" >&2
  exit 1
fi

APP_NAME="$(basename "$APP_PATH")"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/azalea-dmg.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$(dirname "$DMG_PATH")"
rm -f "$DMG_PATH"

cp -R "$APP_PATH" "$STAGE/$APP_NAME"
ln -s /Applications "$STAGE/Applications"

# Detach leftover volumes with the same name (common on flaky CI runners).
if [[ -d "/Volumes/${VOL_NAME}" ]]; then
  hdiutil detach "/Volumes/${VOL_NAME}" -quiet -force 2>/dev/null || true
  sleep 1
fi

attempt=1
until hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGE" \
  -ov \
  -fs HFS+ \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$DMG_PATH"; do
  if (( attempt >= 6 )); then
    echo "hdiutil create failed after ${attempt} attempts" >&2
    exit 1
  fi
  echo "hdiutil create busy; retry ${attempt}/6…" >&2
  sleep $(( attempt * 2 ))
  attempt=$(( attempt + 1 ))
done

echo "Created $DMG_PATH"
