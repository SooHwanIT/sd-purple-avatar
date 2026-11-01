#!/bin/bash
# 검수 시트 4장 + 움직임 영상 2개를 source/vtuber/sd_purple/check/ 에 다시 만든다 (보이지 않는 크롬). 사용: review_all.sh [sheets|video|all]
SP="$(cd "$(dirname "$0")" && pwd)"
P=/c/Users/happy/AppData/Local/Python/bin/python
OUT=/c/Users/happy/Downloads/boy/source/vtuber/sd_purple/check
cd /c/Users/happy/Downloads/boy
WHAT=${1:-all}
HEAD=$($P tools/sdp_qa/view.py 523 560 2.4)
FACE=$($P tools/sdp_qa/view.py 523 560 2.3)
if [ "$WHAT" = sheets ] || [ "$WHAT" = all ]; then
  # 1) 고개 각도 시트 (사용자 '고개 각도' 시트 순서)
  bash "$SP/run_lid.sh" '[["ALL",{}],["ALL",{"angleX":-30}],["ALL",{"angleX":30}],["ALL",{"angleY":30}],["ALL",{"angleY":-30}],["ALL",{"angleZ":-30,"bodyZ":-10.5,"bodyX":-3}],["ALL",{"angleZ":30,"bodyZ":10.5,"bodyX":3}],["ALL",{"bodyYaw":-10,"angleX":-25}],["ALL",{"bodyYaw":10,"angleX":25}],["ALL",{"angleX":-25,"angleY":20}],["ALL",{"angleX":25,"angleY":20}],["ALL",{"angleX":-25,"angleY":-20}],["ALL",{"angleX":25,"angleY":-20}]]' "$HEAD" "'#2b2636'" sdp_rv_angles >/dev/null
  $P tools/sdp_qa_sheet.py sdp_rv_angles "$OUT/review_angles.jpg" "정면|좌측 끝|우측 끝|위쪽 끝|아래쪽 끝|기울기 좌 끝|기울기 우 끝|몸 회전 좌 끝|몸 회전 우 끝|좌·위|우·위|좌·아래|우·아래" 5 "0.1,0.1,0.9,0.85" 400
  # 2) 표정 시트
  bash "$SP/run_lid.sh" '[["ALL",{}],["ALL",{"ex_smile":1}],["ALL",{"ex_laugh":1}],["ALL",{"ex_sad":1}],["ALL",{"ex_angry":1}],["ALL",{"ex_surprised":1}],["ALL",{"ex_teary":1}],["ALL",{"ex_shy":1}],["ALL",{"ex_doubt":1}],["ALL",{"ex_think":1}],["ALL",{"mouthOpen":1}],["ALL",{"mouthPress":1}],["ALL",{"ex_excited":1}],["ALL",{"ex_wink":1}],["ALL",{"ex_sleepy":1}],["ALL",{"ex_asleep":1}],["ALL",{"ex_blank":1}],["ALL",{"ex_shock":1}],["ALL",{"ex_pout":1}],["ALL",{"ex_cry":1}],["ALL",{"ex_tired":1}],["ALL",{"ex_bashful":1}],["ALL",{"ex_heart":1}],["ALL",{"ex_bleh":1}]]' "$FACE" "'#2b2636'" sdp_rv_expr >/dev/null
  $P tools/sdp_qa_sheet.py sdp_rv_expr "$OUT/review_expressions.jpg" "기본(무표정)|미소 (2)|활짝 웃음 (9)|슬픔 (3)|화남 (5)|놀람 (4)|울먹임|부끄러움 (6)|의심|생각중|입 벌림 최대|입 다묾|신남|윙크 (7)|졸림 (8)|자장|멍함|당황|삐짐|대성통곡|지침|수줍음|하트 눈 (0)|메롱" 4 "0.1,0.15,0.9,0.95" 420
  # 3) 몸 시트 (사용자 '몸 끝값' 시트 순서 + 손 인사)
  bash "$SP/run_lid.sh" '[["ALL",{}],["ALL",{"bodyZ":16,"bodyX":8}],["ALL",{"bodyZ":-16,"bodyX":-8}],["ALL",{"bodyY":1}],["ALL",{"bodyY":-1}],["ALL",{"bodyYaw":-10,"angleX":-20}],["ALL",{"bodyYaw":10,"angleX":20}],["ALL",{"shoulder":1}],["ALL",{"shoulder":-1}],["ALL",{"bodyLean":10,"angleY":-24}],["ALL",{"bodyLean":-10,"angleY":18}],["ALL",{"handRW":1,"handRX":-1.35,"handRY":0.62,"handRRot":20}]]' '{zoom:1,offsetX:0,offsetY:0}' "'#2b2636'" sdp_rv_body >/dev/null
  $P tools/sdp_qa_sheet.py sdp_rv_body "$OUT/review_body.jpg" "기본|몸 좌 기울기 끝|몸 우 기울기 끝|몸 위로 늘어남 끝|몸 아래로 압축 끝|몸 회전 좌 끝|몸 회전 우 끝|어깨 상승 끝|어깨 하강 끝|상체 숙임 끝|상체 젖힘 끝|손 흔들기" 4 "0.2,0.0,0.8,1.0" 400
  # 4) 눈 시트 (사용자 '눈 파라미터' 시트 순서)
  bash "$SP/run_lid.sh" '[["ALL",{}],["ALL",{"eyeOpenL":1.2,"eyeOpenR":1.2,"eyeWiden":1}],["ALL",{"eyeOpenL":0,"eyeOpenR":0}],["ALL",{"eyeOpenL":0.45,"eyeOpenR":0.45}],["ALL",{"eyeSmile":1,"mouthOpen":0.5,"mouthForm":1}],["ALL",{"eyeOpenR":0,"mouthForm":0.5}],["ALL",{"eyeOpenL":0,"mouthForm":0.5}],["ALL",{"eyeBallX":-1}],["ALL",{"eyeBallX":1}],["ALL",{"eyeBallY":1}],["ALL",{"eyeBallY":-1}],["ALL",{"pupil":1}],["ALL",{"pupil":-1}]]' "$FACE" "'#2b2636'" sdp_rv_eyes >/dev/null
  $P tools/sdp_qa_sheet.py sdp_rv_eyes "$OUT/review_eyes.jpg" "기본|눈 크게 뜸 최대|눈 감음 최소|졸린 눈 최대|웃는 눈 최대|왼쪽 윙크|오른쪽 윙크|시선 좌 끝|시선 우 끝|시선 위 끝|시선 아래 끝|동공 크게|동공 작게" 4 "0.1,0.15,0.9,0.95" 420
  # 5) 머리카락 끝값 시트 (사용자 '헤어 리깅 레퍼런스' 순서; 강제 휨 각도)
  bash "$SP/run_js.sh" sdp_rv_hair "window.QA_VIEW=$HEAD; window.HF=[{},{bang:6},{bang:-6},{sideL:13},{sideL:-13},{nape:8},{nape:-8},{ahoge:-26},{ahoge:22},{ahoge:-22},{all:8},{all:-8}];" hairsheet.js 300 >/dev/null
  $P tools/sdp_qa_sheet.py sdp_rv_hair "$OUT/review_hair.jpg" "기본|앞머리 +|앞머리 −|옆머리(화면 왼쪽) +|옆머리(화면 왼쪽) −|뒷머리 +|뒷머리 −|아호게 위|아호게 +|아호게 −|전체 +|전체 −" 4 "0.1,0.0,0.9,0.8" 400
  # 6) 손 파츠 시트 (사용자 '손 파츠' 시트 순서)
  BODYV=$($P tools/sdp_qa/view.py 523 700 1.5)
  bash "$SP/run_lid.sh" '[["ALL",{}],["ALL",{"ex_openhands":1}],["ALL",{"ex_fists":1}],["ALL",{"ex_point":1}],["ALL",{"ex_vsign":1}],["ALL",{"ex_fingerheart":1}],["ALL",{"ex_grab":1}],["ALL",{"ex_surprisehands":1}],["ALL",{"handRW":1,"handRX":-1.35,"handRY":0.62,"handRRot":20}],["ALL",{"handLW":1,"handLX":1.35,"handLY":0.62,"handLRot":-20}],["ALL",{"ex_handsup":1}],["ALL",{"ex_think":1}]]' "$BODYV" "'#2b2636'" sdp_rv_hands >/dev/null
  $P tools/sdp_qa_sheet.py sdp_rv_hands "$OUT/review_hands.jpg" "기본손|편손|주먹|가리키기|브이|손하트|파지|놀람손|손 흔들기 (좌)|손 흔들기 (우)|양손 들기|생각중" 4 "0.15,0.0,0.85,0.85" 420
  rm -f "$OUT/review_eyelids.jpg"
fi
if [ "$WHAT" = video ] || [ "$WHAT" = all ]; then
  bash "$SP/run_js.sh" sdp_mv_full "window.QA_VIEW={zoom:1,offsetX:0,offsetY:0}; window.QA_FPS=15;" show.js 500 >/dev/null
  bash "$SP/run_js.sh" sdp_mv_face "window.QA_VIEW=$HEAD; window.QA_FPS=15;" show.js 500 >/dev/null
  for d in full face; do
    ffmpeg -y -loglevel error -framerate 15 -i "source/vtuber/video/sdp_mv_$d/f_%05d.jpg" -vf "crop=iw*0.6:ih:iw*0.2:0,scale=-2:720" -c:v libx264 -pix_fmt yuv420p -crf 22 "$OUT/motion_$d.mp4"
    $P tools/sdp_gif.py sdp_mv_$d "$OUT/motion_$d.gif" "0.2,0,0.8,1" 320 2 15 >/dev/null
  done
fi
ls -la "$OUT"
