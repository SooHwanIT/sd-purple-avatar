# sd_purple 캐릭터 핵심 파일 확인표

| 파일 | 확인할 사항 | 실제 위치 |
|---|---|---|
| model.json | 파츠 목록, 이미지 참조, 계층 구조 | avatar/public/model_sd_purple/model.json |
| rig.json | Pivot, 파라미터, 회전·변형 범위 | avatar/public/model_sd_purple/rig.json |
| chibi_rig.js | 치비 전용 변형 및 업데이트 로직 | avatar/public/js/chibi_rig.js |
| rig.js | 공통 리깅 처리, 좌표 변환 | avatar/public/js/rig.js |
| renderer.js | 렌더링 순서, clipping, 합성 및 변형 | avatar/public/js/renderer.js |

## 같이 보면 좋은 파일

| 파일 | 역할 | 실제 위치 |
|---|---|---|
| sprites/sprites.json, sprites/hands.json | 입·눈·손 바꿔 끼우기 스프라이트 목록 | avatar/public/model_sd_purple/sprites/ |
| cubism_physics.js | 머리카락·장신구 흔들림(물리) | avatar/public/js/cubism_physics.js |
| acting.js, effects.js | 표정별 연기 값, 표정 효과 | avatar/public/js/ |
| tools/sdp_build.py | model.json·rig.json·표정 표를 만드는 빌드 스크립트 | tools/sdp_build.py |
| docs/sd_purple_rig.md | 작업 기록과 남은 한계 | docs/sd_purple_rig.md |
