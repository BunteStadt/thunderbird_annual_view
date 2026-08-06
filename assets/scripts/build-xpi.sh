#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PACKAGE_DIR="$ROOT_DIR/dist/package"

rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/src/hosts/thunderbird" "$PACKAGE_DIR/assets" "$PACKAGE_DIR/experiments"

cp "$ROOT_DIR/src/hosts/thunderbird/manifest.json" "$PACKAGE_DIR/manifest.json"
cp -R "$ROOT_DIR/assets/icons" "$PACKAGE_DIR/assets/"
cp -R "$ROOT_DIR/src/core" "$PACKAGE_DIR/src/core"
cp -R "$ROOT_DIR/src/hosts/thunderbird/"*.js \
    "$PACKAGE_DIR/src/hosts/thunderbird/"
cp "$ROOT_DIR/src/hosts/thunderbird/year-view.html" "$PACKAGE_DIR/src/hosts/thunderbird/"
cp -R "$ROOT_DIR/src/hosts/thunderbird/submodules/calendar/experiments/calendar" \
    "$PACKAGE_DIR/experiments/"

(cd "$PACKAGE_DIR" && zip -r ../calendar-annual-view.xpi manifest.json src experiments assets/icons)