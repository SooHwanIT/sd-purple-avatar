// 고개를 빠르게 돌렸다 멈출 때 볼살 출렁임·목덜미 머리 흔들림 확인: 매 프레임 저장 (QA_DIR, QA_VIEW)
stage.setBackground('#3a3346'); stage.auto.breath = false;
Object.assign(stage.view, window.QA_VIEW);
const c = document.getElementById('c');
const ease = (x) => x * x * (3 - 2 * x);
function src(t) {
  const P = { angleX: 0, angleY: 0, angleZ: 0, eyeOpenL: 1, eyeOpenR: 1, mouthOpen: 0, bodyX: 0, bodyZ: 0, bodyYaw: 0 };
  if (t < 0.25) P.angleX = ease(t / 0.25) * 28; else if (t < 1.2) P.angleX = 28; else if (t < 1.45) P.angleX = 28 - 56 * ease((t - 1.2) / 0.25); else if (t < 2.4) P.angleX = -28; else P.angleX = -28 * (1 - ease(Math.min(1, (t - 2.4) / 0.3)));
  if (t > 3 && t < 5) { P.bodyX = Math.sin((t - 3) * Math.PI * 2) * 9; P.bodyZ = P.bodyX * 1.2; }
  if (t > 5 && t < 5.6) P.bodyY = -Math.sin((t - 5) / 0.6 * Math.PI);
  return P;
}
const fps = 30, dt = 1 / fps, n = Math.round(6 * fps);
stage.avatar.resetPhysics();
for (let i = 0; i < 20; i++) stage.frame(src(0), dt);
for (let i = 0; i < n; i++) { stage.frame(src(i * dt), dt); await fetch(`/__frame?i=${i}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.92) }); }
return n;
