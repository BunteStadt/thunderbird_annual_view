#!/usr/bin/env bash
set -euo pipefail

workspace_dir="${WORKSPACE_DIR:-/workspace}"

if [ -d "$workspace_dir/.git" ] && [ -f "$workspace_dir/.gitmodules" ]; then
    if [ ! -d "$workspace_dir/submodules" ] || [ -z "$(find "$workspace_dir/submodules" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
        echo "Initializing submodules in $workspace_dir" >&2
        if ! git -C "$workspace_dir" submodule update --init --recursive >/dev/null 2>&1; then
            echo "Submodule initialization failed; using local experiment files as a fallback." >&2
        fi
    fi
fi

if [ -d "$workspace_dir/experiments/calendar" ] && [ ! -d "$workspace_dir/submodules/calendar/experiments/calendar" ]; then
    mkdir -p "$workspace_dir/submodules/calendar/experiments"
    cp -R "$workspace_dir/experiments/calendar" "$workspace_dir/submodules/calendar/experiments/calendar"
fi

if [ $# -gt 0 ]; then
    exec "$@"
fi

if [ -x /startapp.sh ]; then
    exec /startapp.sh
fi

exec bash
