#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/cloudfunctions/_shared/award.js"
COPIES=(
  "$ROOT/cloudfunctions/match-results/lib/award.js"
  "$ROOT/cloudfunctions/points-engine/lib/award.js"
)

FE_MIRRORS=(
  "src=$ROOT/cloudfunctions/match-results/lib/score-rule.js;copy=$ROOT/miniprogram/utils/score-rule.js"
  "src=$ROOT/cloudfunctions/tournament-brackets/lib/generator.js;copy=$ROOT/miniprogram/utils/bracket-generator.js"
  "src=$ROOT/cloudfunctions/tournament-brackets/lib/scheduler.js;copy=$ROOT/miniprogram/utils/scheduler-mirror.js"
)

shasum256() { shasum -a 256 "$1" | awk '{print $1}'; }

src_hash=$(shasum256 "$SRC")
for copy in "${COPIES[@]}"; do
  if [ ! -f "$copy" ]; then echo "[sync] missing: $copy"; exit 1; fi
  cp_hash=$(shasum256 "$copy")
  if [ "$src_hash" != "$cp_hash" ]; then
    echo "[sync] hash mismatch: $copy"
    diff "$SRC" "$copy" || true
    exit 1
  fi
done
echo "[sync] award.js ok"

for pair in "${FE_MIRRORS[@]}"; do
  eval "$pair"
  if [ ! -f "$src" ] || [ ! -f "$copy" ]; then
    echo "[sync] missing pair: $pair"; exit 1
  fi
  if [ "$(shasum256 "$src")" != "$(shasum256 "$copy")" ]; then
    echo "[sync] mirror mismatch: $src ↔ $copy"
    diff "$src" "$copy" || true
    exit 1
  fi
done
echo "[sync] mirrors ok"
