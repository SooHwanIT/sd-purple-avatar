const stage = window.stage;
stage.auto.breath = false;
stage.setBackground(window.BG ?? '#3a3346');
const c = document.getElementById('c');
Object.assign(stage.view, window.LV ?? { zoom: 4.2, offsetY: 0.33, offsetX: 0.2 });
const all = stage.avatar.parts.filter(Boolean).map((p) => p.tag);
const only = (keep) => all.filter((t) => !keep.includes(t));
const sets = window.SETS;
for (const [i, [hs, P]] of sets.entries()) {
  stage.avatar.hidden = new Set(hs === 'ALL' ? [] : hs.only ? only(hs.only) : hs);
  stage.avatar.resetPhysics();
  for (let k = 0; k < 40; k++) stage.frame(P, 1 / 30);
  await fetch(`/__frame?i=${i}&dir=${window.LDIR ?? "sdp_lid"}`, { method: 'POST', body: c.toDataURL('image/png') });
}
return sets.length;
