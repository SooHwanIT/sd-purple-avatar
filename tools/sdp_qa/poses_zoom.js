// 확대 자세 (얼굴): view.zoom / offsetY 는 window.QA_VIEW, 자세 목록은 window.QA_POSES, 저장 폴더 window.QA_DIR
const stage = window.stage;
stage.auto.breath = false;
stage.setBackground('#3a3346');
const c = document.getElementById('c');
const V = window.QA_VIEW ?? { zoom: 2.6, offsetY: 0.62, offsetX: 0 };
Object.assign(stage.view, V);
const poses = window.QA_POSES;
for (const [i, p] of poses.entries()) {
  stage.avatar.resetPhysics?.();
  for (let k = 0; k < (window.QA_FRAMES ?? 150); k++) stage.frame({ ...p }, 1 / 30);
  await fetch(`/__frame?i=${i}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.92) });
}
return poses.length;
