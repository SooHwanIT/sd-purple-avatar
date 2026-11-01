// yawMax 비교: window.YAWS 목록마다 angleX ±30 렌더
const stage = window.stage; stage.auto.breath = false; stage.setBackground('#3a3346');
const c = document.getElementById('c');
Object.assign(stage.view, window.LV);
let i = 0;
for (const y of window.YAWS) {
  stage.avatar.setTuning({ yawMax: y });
  for (const ax of [-30, 30]) {
    stage.avatar.resetPhysics();
    for (let k = 0; k < 40; k++) stage.frame({ angleX: ax }, 1 / 30);
    await fetch(`/__frame?i=${i++}&dir=sdp_yaw`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.92) });
  }
}
return i;
