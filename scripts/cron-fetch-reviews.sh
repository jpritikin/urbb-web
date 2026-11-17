#!/usr/bin/env bash
set -euo pipefail
source ~/.config/urbb/r2-credentials
cd "$(dirname "$0")/.."

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.local/share/ms-playwright}"
export URBB_STATE_DIR="${URBB_STATE_DIR:-$HOME/.local/state/urbb-web}"
LOG_FILE="$URBB_STATE_DIR/fetch-reviews.log"
MAX_LOG_LINES=2000
mkdir -p "$URBB_STATE_DIR"

set +e
output="$(npx tsx scripts/fetch-goodreads-reviews.ts 2>&1)"
status=$?
set -e

if [[ -n "$output" ]]; then
    echo "$output"
    {
        echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
        echo "$output"
    } >> "$LOG_FILE"
    tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

exit $status
