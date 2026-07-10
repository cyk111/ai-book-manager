#!/bin/bash
set -a
source "$(dirname "$0")/.env" 2>/dev/null
set +a
BOOK_DIR="${BOOK_DIR:-/tmp/books-test}"
cd "$(dirname "$0")"
npx tsx poc-verify.ts 2>&1
