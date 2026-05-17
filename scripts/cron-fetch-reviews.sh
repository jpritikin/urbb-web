#!/usr/bin/env bash
set -euo pipefail
source ~/.config/urbb/r2-credentials
cd "$(dirname "$0")/.."
npx ts-node --project scripts/tsconfig.json scripts/fetch-goodreads-reviews.ts
