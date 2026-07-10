#!/bin/bash
cd "$(dirname "$0")/.."
set -a
source .env 2>/dev/null
set +a
npx tsx scripts/verify.ts 2>&1
