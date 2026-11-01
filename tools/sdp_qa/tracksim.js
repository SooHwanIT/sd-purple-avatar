// 실제 트래커가 주는 값 묶음을 흉내 내 한꺼번에 넣어 봄 (고개 3축 + 시선 + 깜빡임 + 입 L/R + 볼 + 눈썹 L/R + 몸 X/Z/Yaw/Lean + 팔 + 퍼펙트 싱크 일부)
stage.setBackground('#3a3346');
Object.assign(stage.view, window.QA_VIEW);
const c = document.getElementById('c');
const S = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
function src(t) {
  const P = { angleX: Math.sin(t * 0.9) * 22, angleY: Math.sin(t * 0.7 + 1) * 12, angleZ: Math.sin(t * 0.5 + 2) * 12,
    eyeOpenL: 1, eyeOpenR: 1, eyeBallX: Math.sin(t * 1.3) * 0.7, eyeBallY: Math.sin(t * 0.8) * 0.4,
    mouthOpen: Math.max(0, Math.sin(t * 7)) * 0.7 * (t % 4 < 2 ? 1 : 0), mouthWide: 0.3, mouthFormL: Math.sin(t) * 0.6, mouthFormR: Math.sin(t + 1) * 0.6,
    mouthX: Math.sin(t * 0.6) * 0.5, jawX: Math.sin(t * 0.4) * 0.5, cheekPuff: t % 6 > 4 ? 0.8 : 0, upperUp: t % 5 > 4 ? 0.7 : 0,
    browL: Math.sin(t * 0.9) * 0.7, browR: Math.sin(t * 0.9 + 0.5) * 0.7, browTiltL: Math.sin(t * 0.3) * 0.5, browTiltR: Math.sin(t * 0.3) * 0.5,
    eyeSquintL: t % 7 > 5 ? 0.8 : 0, eyeSquintR: 0,
    bodyX: Math.sin(t * 0.6) * 7, bodyZ: Math.sin(t * 0.5 + 0.5) * 10, bodyYaw: Math.sin(t * 0.4) * 8, bodyLean: Math.sin(t * 0.3) * 8,
    armR: Math.max(0, Math.sin(t * 0.5)) * 35, armL: Math.max(0, Math.sin(t * 0.5 + 2)) * 35, elbowR: Math.max(0, Math.sin(t * 0.7)) * 50, elbowL: 20,
    bs_eyeWideLeft: t % 8 > 7 ? 0.9 : 0, bs_eyeWideRight: t % 8 > 7 ? 0.9 : 0, bs_mouthPucker: t % 9 > 8 ? 0.9 : 0, pupil: Math.sin(t * 0.25) * 0.8, lidTilt: t % 10 > 8 ? 0.8 : 0,
    breath: (Math.sin(t * 1.7) + 1) / 2 };
  for (const b of [1.2, 3.4, 6.1, 8.8]) { const u = t - b; if (u >= 0 && u < 0.23) P.eyeOpenL = P.eyeOpenR = u < 0.07 ? 1 - u / 0.07 : u < 0.1 ? 0 : (u - 0.1) / 0.13; }
  return P;
}
const fps = 30, dt = 1 / fps, n = Math.round(10 * fps);
stage.avatar.resetPhysics();
let k = 0;
for (let i = 0; i < n; i++) { stage.frame(src(i * dt), dt); if (i % 10 === 0) await fetch(`/__frame?i=${k++}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) }); }
return k;
