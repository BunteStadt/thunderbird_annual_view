#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PACKAGE_DIR="$ROOT_DIR/dist/package"

npm --prefix "$ROOT_DIR" run build:thunderbird

mkdir -p "$PACKAGE_DIR/src/hosts/thunderbird" "$PACKAGE_DIR/assets" "$PACKAGE_DIR/experiments"

cp "$ROOT_DIR/src/hosts/thunderbird/manifest.json" "$PACKAGE_DIR/manifest.json"
cp -R "$ROOT_DIR/assets/icons" "$PACKAGE_DIR/assets/"
cp "$ROOT_DIR/src/hosts/thunderbird/background.js" \
    "$PACKAGE_DIR/src/hosts/thunderbird/"
cp -R "$ROOT_DIR/src/hosts/thunderbird/submodules/calendar/experiments/calendar" \
    "$PACKAGE_DIR/experiments/"

rm -f "$ROOT_DIR/dist/calendar-annual-view.xpi"
(cd "$PACKAGE_DIR" && zip -r ../calendar-annual-view.xpi manifest.json index.html src experiments assets)