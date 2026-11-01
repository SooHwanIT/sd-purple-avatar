// 무작위 동작(씨앗 QA_SEED)을 정해진 시각 목록(window.TIMES)까지 돌려 그 순간을 저장 (QA_VIEW, QA_DIR)
stage.setBackground('#3a3346');
Object.assign(stage.view, window.QA_VIEW);
const mod = await import('./js/qa_motion.js');
const u = mod.makeRandomUser(window.QA_SEED ?? 5, Object.keys(stage.model.rig.expressions ?? {}));
stage.avatar.resetPhysics(); window.resetPipe();
const fps = 30, dt = 1 / fps;
const c = document.getElementById('c');
const want = window.TIMES.map((t) => Math.round(t * fps));
const n = Math.max(...want) + 1;
let k = 0;
for (let i = 0; i < n; i++) {
  stage.frame(window.pipeline(i * dt, dt, u), dt);
  if (want.includes(i)) await fetch(`/__frame?i=${k++}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/png') });
}
return k;
