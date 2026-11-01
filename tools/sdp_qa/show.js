// 시연 동작 20초 → /__frame (dir = window.QA_DIR). 앱과 같은 처리 과정(window.pipeline: 몸 따라오기·움직임 다듬기·표정 연기)
const stage = window.stage;
stage.setBackground(window.QA_BG ?? '#3a3346');
Object.assign(stage.view, window.QA_VIEW ?? {});
stage.auto.breath = true;
const c = document.getElementById('c');
const S = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const bell = (t, a, b) => Math.sin(Math.PI * S(t, a, b));
const ease = (x) => x * x * (3 - 2 * x);
function show(t) {
  const P = { angleX: 0, angleY: 0, angleZ: 0, eyeOpenL: 1, eyeOpenR: 1, eyeBallX: 0, eyeBallY: 0, mouthOpen: 0, mouthWide: 0, brow: 0 };
  // 깜빡임
  for (const b of [1.0, 4.6, 8.2, 11.4, 13.2]) { const k = Math.abs(t - b) / 0.08; if (k < 1) P.eyeOpenL = P.eyeOpenR = k ** 1.5; }
  if (t > 1.5 && t < 5) { const u = (t - 1.5) / 3.5; P.angleX = Math.sin(u * Math.PI * 2) * 26 * Math.sin(u * Math.PI); P.eyeBallX = P.angleX / 40; }
  if (t > 5 && t < 7) { const u = (t - 5) / 2; P.angleY = Math.sin(u * Math.PI * 2) * 20 * Math.sin(u * Math.PI); }
  if (t > 7 && t < 9.5) { const u = (t - 7) / 2.5; P.angleZ = Math.sin(u * Math.PI * 2) * 18 * Math.sin(u * Math.PI); P.shift = Math.sin(u * Math.PI * 2) * 7 * Math.sin(u * Math.PI); }
  if (t > 9.5 && t < 12) {
    const u = t - 9.5;
    const syl = Math.max(0, Math.sin(u * 9.5) * 0.6 + Math.sin(u * 4.1) * 0.4);
    P.mouthOpen = syl * S(u, 0, 0.2) * (1 - S(u, 2.3, 2.5));
    P.mouthWide = Math.max(0, Math.sin(u * 2.3)) * 0.6;
    P.angleX = Math.sin(u * 1.6) * 7; P.talk = P.mouthOpen * 0.5;
  }
  if (t > 12 && t < 13.6) {
    const u = t - 12;
    P.angleX = u < 0.18 ? ease(u / 0.18) * 26 : u < 0.8 ? 26 : u < 0.98 ? 26 - 52 * ease((u - 0.8) / 0.18) : -26 * (1 - ease(S(u, 1.2, 1.6)));
  }
  if (t > 13.6 && t < 15.8) { const u = (t - 13.6) / 2.2; P.handRW = bell(u, 0, 1) ** 0.5; P.handRX = -1.35; P.handRY = 0.62; P.handRRot = Math.sin((t - 13.6) * 12) * 22; P.angleZ = 6 * P.handRW; P.mouthForm = 0.6; P.sayHi = P.handRW > 0.5 ? 1 : 0; }
  if (t > 15.8 && t < 16.9) { const u = (t - 15.8) / 1.1; P.bodyY = u < 0.3 ? -ease(u / 0.3) : u < 0.65 ? -1 + 2 * ease((u - 0.3) / 0.35) : 1 - ease((u - 0.65) / 0.35); }
  if (t > 16.9) {
    const names = ['smile', 'surprised', 'laugh', 'heart', 'smug', 'shock', 'kyaa', 'bleh', 'cry', 'pout'];
    const k = Math.floor((t - 16.9) / 1.0);
    const u = (t - 16.9) % 1.0;
    if (names[k]) P[`ex_${names[k]}`] = u < 0.85 ? 1 : 0;
    if (names[k] === 'surprised') P.mouthOpen = 0.55;
  }
  return P;
}
const fps = window.QA_FPS ?? 15;
const dt = 1 / fps;
stage.avatar.resetPhysics(); window.resetPipe();
for (let i = 0; i < 40; i++) stage.frame(window.pipeline(0, dt, show), dt);
const n = Math.round((window.QA_SEC ?? 27.2) * fps);
for (let i = 0; i < n; i++) {
  stage.frame(window.pipeline(i * dt, dt, show), dt);
  await fetch(`/__frame?i=${i}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL(window.QA_PNG ? 'image/png' : 'image/jpeg', 0.9) });
}
return n;
