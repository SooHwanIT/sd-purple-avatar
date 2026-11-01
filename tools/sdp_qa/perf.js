const stage = window.stage;
const av = stage.avatar;
let tu = 0, tf = 0;
const N = 300;
for (let i = 0; i < N; i++) {
  const t = i / 30;
  const P = { angleX: Math.sin(t) * 20, angleY: Math.sin(t * 0.7) * 10, angleZ: Math.sin(t * 0.5) * 10, mouthOpen: Math.max(0, Math.sin(t * 8)), eyeOpenL: 1, eyeOpenR: 1, bodyX: Math.sin(t) * 4, bodyZ: Math.sin(t * 0.6) * 5 };
  const a = performance.now();
  av.update({ ...P }, 1 / 30);
  const b = performance.now();
  stage.frame(P, 1 / 30);
  const c2 = performance.now();
  tu += b - a; tf += c2 - b;
}
const verts = av.parts.reduce((s, p) => s + (p?.n ?? 0), 0);
return { updateMs: +(tu / N).toFixed(2), frameMs: +(tf / N).toFixed(2), verts };
