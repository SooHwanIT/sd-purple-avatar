# sd_purple 검수 스크립트 (보이지 않는 크롬으로 — 사용자 화면에 창을 띄우지 않음)

먼저 시험 서버: `.claude/launch.json` 의 parts-test (포트 8799, `node tools/parts_test_server.mjs --port 8799`).
모두 `node tools/headless_eval.mjs "<url>" <script.js>` 로 돌아간다 (script = async 함수 본문, `window.stage` 사용).

- `run_qa.sh <dir> '<poses json>' '<view json>'` — 자세 목록을 그려 `source/vtuber/video/<dir>/f_*.jpg` 로 저장 (poses_zoom.js)
- `run_lid.sh '<[[hidden|"ALL"|{"only":[...]}, params], ...]>' '<view>' "'#bg'"` — 레이어를 숨기며 그리기 (lid.js) → `source/vtuber/video/sdp_lid/`
- `show.js` — 20초 시연 동작 녹화 (window.QA_DIR/QA_FPS/QA_PNG/QA_VIEW 를 앞에 붙여 쓰기; run_qa.sh 와 같은 식)
- `qarun.js` — 사람 같은 무작위 60초 동작에서 24장 (parts_test.html 의 qaRun)
- `perf.js` — 프레임당 계산 시간
- `holes_poses.json` — 구멍 검사용 극단 자세 17개: `run_lid.sh "$(cat holes_poses.json)" '{zoom:1,offsetY:0,offsetX:0}' "'#00ff00'"` 뒤 `python tools/sdp_holes.py sdp_lid`
- 시트: `python tools/sdp_qa_sheet.py <dir> <out.jpg> "이름|이름|..." <열수> "x0,y0,x1,y1(비율)" <칸 px>`
- GIF/MP4: ffmpeg (`-c:v png` 로 읽기 — 프레임이 PNG 내용인 .jpg 이름)
- `cdp.mjs <port> <urlSubstring> "<expr>" [shot.png W H]` — 숨긴 앱 창을 CDP 로 조작·캡처
