// 무작위 동작에서 메쉬 늘어남(찢어짐·찌그러짐) 상위 보고 + 프레임 저장. 파츠마다 삼각형 변 길이 비율(지금/원래)의 최대·최소
stage.setBackground('#3a3346');
Object.assign(stage.view, window.QA_VIEW);
const av = stage.avatar;
function strain() {
  const res = [];
  for (const p of av.parts) {
    if (!p || !p.idx || av.hidden.has(p.tag)) continue;
    const R = p.rest, O = p.out, I = p.idx;
    let mx = 1, mn = 1;
    for (let k = 0; k < I.length; k += 3) for (let e = 0; e < 3; e++) {
      const a = I[k + e], b = I[k + ((e + 1) % 3)];
      const l0 = Math.hypot(R[2 * a] - R[2 * b], R[2 * a + 1] - R[2 * b + 1]);
      if (l0 < 3) continue;
      const r = Math.hypot(O[2 * a] - O[2 * b], O[2 * a + 1] - O[2 * b + 1]) / l0;
      if (r > mx) mx = r; if (r < mn) mn = r;
    }
    res.push({ tag: p.tag, max: +mx.toFixed(2), min: +mn.toFixed(2) });
  }
  return res;
}
const user = window.makeRandomUser ? null : null;
// qaRun 은 strain 을 자체 함수로 재므로 여기서는 프레임마다 직접 잼
const seed = window.QA_SEED ?? 5, fps = 30, n = 60 * fps;
const mod = await import('./js/qa_motion.js');
const u = mod.makeRandomUser(seed, Object.keys(stage.model.rig.expressions ?? {}));
stage.avatar.resetPhysics(); window.resetPipe();
const dt = 1 / fps;
const worst = {};
let r = seed * 7919 + 13; const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
const at = new Set(); while (at.size < 24) at.add(30 + Math.floor(rnd() * (n - 30)));
const c = document.getElementById('c');
const frames = [];
for (let i = 0; i < n; i++) {
  const P = stage.frame(window.pipeline(i * dt, dt, u), dt);
  if (i % 3 === 0) for (const s of strain()) { const d = Math.max(s.max - 1, 1 - s.min); if (!worst[s.tag] || d > worst[s.tag].d) worst[s.tag] = { ...s, d: +d.toFixed(2), t: +(i * dt).toFixed(2) }; }
  if (at.has(i)) { frames.push(`${(i * dt).toFixed(2)}s ax${P.angleX.toFixed(1)} ay${P.angleY.toFixed(1)} az${P.angleZ.toFixed(1)} e${P.eyeOpenL.toFixed(2)} m${P.mouthOpen.toFixed(2)}`); await fetch(`/__frame?i=${i}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.92) }); }
}
return { frames, worst: Object.values(worst).sort((a, b) => b.d - a.d).slice(0, 14) };
