#!/bin/sh
set -eu

PROFILE_DIR=${PROFILE_DIR:-/config/profile}
REPO_ROOT=${REPO_ROOT:-/workspace}
THUNDERBIRD_BIN=${THUNDERBIRD_BIN:-/usr/local/bin/thunderbird}

export DISPLAY=${DISPLAY:-:1}
export HOME=${HOME:-/config}
export PROFILE_DIR
export REPO_ROOT

/usr/local/bin/prepare-thunderbird-profile.sh

exec "$THUNDERBIRD_BIN" -profile "$PROFILE_DIR" --no-remote "$@"
