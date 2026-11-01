# sd-purple-avatar

SD 보라 캐릭터(치비) 2D 아바타 묶음입니다. 원본 프로젝트(`boy`)에서 이 캐릭터에 필요한 것만 떼어 왔습니다.

## 들어 있는 것

| 폴더 | 내용 |
|---|---|
| `avatar/public/model_sd_purple/` | 완성 모델: `model.json`(파츠·이미지·계층), `rig.json`(축·파라미터·범위·표정·물리), `layers/`(파츠 그림), `sprites/`(입·눈·손 바꿔 끼우기 그림 + `sprites.json`, `hands.json`) |
| `avatar/public/js/` | 런타임. 핵심은 `chibi_rig.js`(치비 전용 변형), `rig.js`(공통 리깅), `renderer.js`(그리기 순서·클리핑·합성), `cubism_physics.js`(흔들림 물리). 나머지는 이들이 불러 쓰는 파일(`stage.js`, `motion.js`, `acting.js`, `effects.js` 등) |
| `avatar/public/parts_test.html` | 파츠 리그 시험 페이지 (`tools/parts_test_server.mjs` 로 띄움) |
| `source/vtuber/sd_purple/` | 원본 그림(`ref.webp`), 사용자 제공 시트(`sheets/`), 파츠 중간 산출물(`parts_in*`, `parts_aligned`, `work/`), 검수 시트·GIF(`check/`) |
| `tools/sdp_*.py` | 빌드 파이프라인: `sdp_matte → sdp_regions → sdp_parts → sdp_layers → sdp_build` (모델 px = 원본 × 0.7), 스프라이트 `sdp_sprites.py`, 손 시트 `sdp_hands.py`, 구멍 검사 `sdp_holes.py` |
| `tools/sdp_qa/` | 보이지 않는 크롬으로 돌리는 자동 검수 스크립트 (`review_all.sh` 가 검수 시트 6장 + 움직임 GIF를 다시 만듦) |
| `docs/sd_purple_rig.md` | 작업 기록, 설계 이유, 남은 한계 |
| `docs/sd_purple_확인파일표.md` | 손볼 때 먼저 볼 파일 표 |

## 다른 프로젝트에서 쓸 때

- 파이썬 도구와 QA 스크립트에는 원본 경로 `C:\Users\happy\Downloads\boy` 가 `ROOT` 로 박혀 있습니다. 옮긴 뒤 각 파일 머리의 `ROOT` 를 새 경로로 바꾸세요.
- 모델을 앱에 등록하는 자리는 `avatar/public/models.json` 의 `model_sd_purple` 항목이고, `stage.js` 가 `model.json` 의 `type: "chibi"` 를 보고 `chibi_rig.js` 를 고릅니다.
- `stage.js` 는 다른 모델 종류(`cubism_avatar.js`, `vrm_avatar.js`)도 불러 쓰므로 함께 넣었습니다. 그쪽 모델과 vendor 라이브러리(three, Cubism Core)는 이 묶음에 없습니다. 치비 모델만 쓸 때는 필요 없습니다.
- 파이썬 의존: numpy, Pillow, scipy. QA 는 Node 와 크롬(헤드리스)이 필요합니다.

## 원칙 (기록에서 옮김)

- 쉬는 자세는 원본 그림 그대로. 몸은 단단하게, 작은 움직임을 많이.
- `work/newhair_off.json` 과 그려 넣은 팔(`SDP_DRAWN_ARMS`)은 다시 켜지 않습니다.
- 옆얼굴(45° 이상)은 비율이 맞는 각도 그림이 있어야 합니다. 기준선은 `source/vtuber/sd_purple/check/template_head_lines.png`.
