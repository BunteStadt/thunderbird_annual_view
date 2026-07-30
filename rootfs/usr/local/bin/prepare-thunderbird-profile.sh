#!/bin/sh
set -eu

PROFILE_DIR=${PROFILE_DIR:-/config/profile}
REPO_ROOT=${REPO_ROOT:-/workspace}
TB_PROFILE_TEMPLATE="${REPO_ROOT}/thunderbird-profile"
EXT_ID="GlamorousPotato.calendar-annual-view@addons.thunderbird.net"

mkdir -p "$PROFILE_DIR" "$PROFILE_DIR/extensions"

if [ -d "$TB_PROFILE_TEMPLATE" ] && [ ! -f "$PROFILE_DIR/user.js" ]; then
    cp -R "$TB_PROFILE_TEMPLATE/." "$PROFILE_DIR/"
fi

if [ ! -f "$PROFILE_DIR/user.js" ]; then
    echo "Thunderbird profile template not found at $TB_PROFILE_TEMPLATE" >&2
    exit 1
fi

printf '%s\n' "$REPO_ROOT" > "$PROFILE_DIR/extensions/$EXT_ID"

sed -i "s|file:///workspace/feiertage_nrw.ics|file://${REPO_ROOT}/feiertage_nrw.ics|g" "$PROFILE_DIR/user.js"
sed -i "s|file:///workspace/ferien_nrw.ics|file://${REPO_ROOT}/ferien_nrw.ics|g" "$PROFILE_DIR/user.js"
