// 말하기·표정 전환 연속 프레임 (앱 처리 과정 pipeline 사용). window.QA_DIR, QA_VIEW, QA_FPS, QA_SEC
const stage = window.stage;
stage.setBackground('#3a3346');
Object.assign(stage.view, window.QA_VIEW ?? {});
stage.auto.breath = true;
const c = document.getElementById('c');
const S = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
function src(t) {
  const P = { angleX: 0, angleY: 0, angleZ: 0, eyeOpenL: 1, eyeOpenR: 1, eyeBallX: 0, eyeBallY: 0, mouthOpen: 0, mouthWide: 0, brow: 0, mouthForm: 0 };
  if (t < 4) {
    const u = t;
    const syl = Math.max(0, Math.sin(u * 9.3) * 0.6 + Math.sin(u * 4.3) * 0.45);
    P.mouthOpen = Math.min(1, syl) * S(u, 0, 0.15) * (1 - S(u, 3.7, 3.9));
    P.mouthWide = Math.max(0, Math.sin(u * 2.1)) * 0.5;
    P.mouthForm = Math.sin(u * 1.3) * 0.5;
    P.talk = P.mouthOpen * 0.5;
  } else if (t < 6) { P.ex_smile = 1; }
  else if (t < 8) { P.ex_angry = 1; P.mouthOpen = t < 7 ? 0.5 : 0; }
  else if (t < 10) { P.ex_surprised = 1; }
  else if (t < 12) { P.ex_sad = 1; }
  else if (t < 14) { P.ex_laugh = 1; }
  else { for (const b of [14.3, 15.2]) { const u = t - b; if (u >= 0 && u < 0.23) P.eyeOpenL = P.eyeOpenR = u < 0.07 ? 1 - u / 0.07 : u < 0.1 ? 0 : (u - 0.1) / 0.13; } }
  return P;
}
const fps = window.QA_FPS ?? 30;
const dt = 1 / fps;
stage.avatar.resetPhysics(); window.resetPipe();
for (let i = 0; i < 40; i++) stage.frame(window.pipeline(0, dt, src), dt);
const n = Math.round((window.QA_SEC ?? 16) * fps);
for (let i = 0; i < n; i++) {
  stage.frame(window.pipeline(i * dt, dt, src), dt);
  await fetch(`/__frame?i=${i}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.92) });
}
return n;
