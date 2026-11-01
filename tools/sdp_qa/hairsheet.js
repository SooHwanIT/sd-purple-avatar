// 머리카락 끝값 시트: window.HF 목록 ([{force}, ...]) 마다 쉬는 자세에 강제 휨을 더해 렌더 (QA_DIR, QA_VIEW)
const stage = window.stage; stage.auto.breath = false; stage.setBackground('#2b2636');
const c = document.getElementById('c');
Object.assign(stage.view, window.QA_VIEW);
let i = 0;
for (const f of window.HF) {
  stage.avatar.setHairForce(f);
  stage.avatar.resetPhysics();
  for (let k = 0; k < 20; k++) stage.frame({}, 1 / 30);
  await fetch(`/__frame?i=${i++}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.92) });
}
stage.avatar.setHairForce(null);
return i;
