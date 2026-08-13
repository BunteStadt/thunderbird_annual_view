#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
REPORT_DIR="${LINTER_REPORT_DIR:-$ROOT_DIR/test-results/thunderbird-linter}"
XPI_PATH="$ROOT_DIR/dist/calendar-annual-view.xpi"
SCHEMA_CACHE_DIR="$REPORT_DIR/cache/schema"
HASH_DB_CACHE_DIR="$REPORT_DIR/cache/mozilla-hash-db"
CDN_CACHE_DIR="$REPORT_DIR/cache/cdn-lookup"
EXPERIMENTS_CACHE_DIR="$REPORT_DIR/cache/experiments"

mkdir -p "$REPORT_DIR"
npm --prefix "$ROOT_DIR" run build:xpi

LINTER_CACHE_ARGS=(
    --cache-schema-dir "$SCHEMA_CACHE_DIR"
    --cache-hash-db-dir "$HASH_DB_CACHE_DIR"
    --cache-cdn-lookup-dir "$CDN_CACHE_DIR"
    --cache-experiments-dir "$EXPERIMENTS_CACHE_DIR"
)

set +e
npx --prefix "$ROOT_DIR" webext-linter "$XPI_PATH" \
    --allow-experiments \
    --eslint \
    "${LINTER_CACHE_ARGS[@]}" \
    --report-format text \
    --report-out "$REPORT_DIR/linter-report.txt"
text_exit_code=$?
npx --prefix "$ROOT_DIR" webext-linter "$XPI_PATH" \
    --allow-experiments \
    --eslint \
    "${LINTER_CACHE_ARGS[@]}" \
    --report-format json \
    --report-out "$REPORT_DIR/linter-report.json"
json_exit_code=$?
set -e

if [[ -f "$REPORT_DIR/linter-report.txt" ]]; then
    cat "$REPORT_DIR/linter-report.txt"
fi

if [[ "$text_exit_code" -ne 0 ]]; then
    exit "$text_exit_code"
fi
if [[ "$json_exit_code" -ne 0 ]]; then
    exit "$json_exit_code"
fi
