// 큰 반응(reactions.js) 하나씩 재생하며 정해진 시각에 캡처. window.RE = 이름 목록, window.TS = 시각 목록, QA_VIEW, QA_DIR
stage.setBackground('#3a3346');
Object.assign(stage.view, window.QA_VIEW);
const mod = await import('./js/reactions.js');
const c = document.getElementById('c');
const fps = 30, dt = 1 / fps;
let k = 0;
const out = [];
for (const name of window.RE) {
  const player = new mod.ReactionPlayer();
  stage.avatar.resetPhysics(); window.resetPipe();
  const def = player.play(name);
  const ex = (def.expr ?? []).find((n) => stage.model.rig.expressions[n]);
  const base = (t) => { const P = { angleX: 0, angleY: 0, angleZ: 0, eyeOpenL: 1, eyeOpenR: 1, mouthOpen: 0 }; if (ex) P[`ex_${ex}`] = 1; return P; };
  const src = (t) => { const P = base(t); player.apply(P, 0); return P; };
  // pipeline 은 src(t) 를 부르며 motion/acting 을 거침. player.apply 는 시간 누적이라 프레임마다 한 번만 → 직접 돌림
  const n = Math.round((def.dur + 0.3) * fps);
  for (let i = 0; i < n; i++) {
    const P = base(i * dt);
    player.apply(P, dt);
    stage.frame(window.pipeline(i * dt, dt, () => P), dt);
    const t = +(i * dt).toFixed(2);
    if (window.TS.some((x) => Math.abs(x - t) < dt / 2)) { await fetch(`/__frame?i=${k++}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) }); out.push(`${name}@${t}`); }
  }
}
return out;
