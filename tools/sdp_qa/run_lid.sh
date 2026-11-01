#!/bin/bash
# 사용: run_lid.sh '<[[hidden|"ALL"|{"only":[...]}, params], ...]>' '<view>' "'#bg'" [dir=sdp_lid]  — 레이어를 숨기며 자세를 그려 source/vtuber/video/<dir>/
SP="$(cd "$(dirname "$0")" && pwd)"
DIR=${4:-sdp_lid}
rm -rf "/c/Users/happy/Downloads/boy/source/vtuber/video/$DIR"
TMP="$SP/_lid_$$.js"
{ echo "window.SETS=$1; window.LV=${2:-null} ?? undefined; window.BG=${3:-null} ?? undefined; window.LDIR='$DIR';"; cat "$SP/lid.js"; } > "$TMP"
cd /c/Users/happy/Downloads/boy && node tools/headless_eval.mjs "http://127.0.0.1:8799/parts_test.html?model=model_sd_purple&raw" "$TMP" 300 2>&1 | tail -1
rm -f "$TMP"
