#!/bin/bash
# 사용: run_js.sh <dir> '<앞에 붙일 js>' <script.js> [시간제한초]  — source/vtuber/video/<dir> 를 비우고 스크립트를 돌림
SP="$(cd "$(dirname "$0")" && pwd)"
DIR=$1; PRE=$2; SCRIPT=$3; LIM=${4:-400}
rm -rf "/c/Users/happy/Downloads/boy/source/vtuber/video/$DIR"
TMP="$SP/_js_$$.js"
{ echo "window.QA_DIR='$DIR'; $PRE"; cat "$SP/$SCRIPT"; } > "$TMP"
cd /c/Users/happy/Downloads/boy && node tools/headless_eval.mjs "http://127.0.0.1:8799/parts_test.html?model=model_sd_purple&raw&capture" "$TMP" "$LIM" 2>&1 | tail -3
rm -f "$TMP"
