#!/bin/bash
# 사용: run_qa.sh <dir> '<poses json>' '<view json>' [script]
SP="$(cd "$(dirname "$0")" && pwd)"
DIR=$1; POSES=$2; VIEW=$3; SCRIPT=${4:-poses_zoom.js}
rm -rf "/c/Users/happy/Downloads/boy/source/vtuber/video/$DIR"
{ echo "window.QA_DIR='$DIR'; window.QA_POSES=$POSES; window.QA_VIEW=$VIEW;"; cat "$SP/$SCRIPT"; } > "$SP/_run.js"
cd /c/Users/happy/Downloads/boy && HL_LOG=1 node tools/headless_eval.mjs "http://127.0.0.1:8799/parts_test.html?model=model_sd_purple&raw" "$SP/_run.js" 300 2>&1 | tail -5
