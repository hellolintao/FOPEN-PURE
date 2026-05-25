#!/usr/bin/env bash
set -e
diff -u cloudfunctions/_shared/tournament-phase.js miniprogram/utils/tournament-phase.js \
  || { echo "tournament-phase.js drift detected"; exit 1; }
