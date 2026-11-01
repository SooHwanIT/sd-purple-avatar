// 팔 내린 각도 비교: window.ARMS 목록마다 쉬는 자세 렌더
const stage = window.stage; stage.auto.breath = false; stage.setBackground('#2b2636');
const c = document.getElementById('c');
Object.assign(stage.view, window.LV);
let i = 0;
for (const a of window.ARMS) {
  stage.avatar.setTuning({ armRest: a });
  stage.avatar.resetPhysics();
  for (let k = 0; k < 30; k++) stage.frame({}, 1 / 30);
  await fetch(`/__frame?i=${i++}&dir=sdp_arm`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.92) });
}
return i;
