const stage = window.stage;
stage.auto.breath = false;
stage.setBackground('#00b000');
const c = document.getElementById('c');
Object.assign(stage.view, { zoom: 3.0, offsetY: 0.2, offsetX: 0 });
const all = stage.avatar.parts.filter(Boolean).map((p) => p.tag);
const only = (keep) => all.filter((t) => !keep.includes(t));
const sets = [[[], {}], [[], { eyeOpenL: 0.5, eyeOpenR: 0.5 }], [only(['hair_under']), { eyeOpenL: 0.5, eyeOpenR: 0.5 }], [only(['face']), { eyeOpenL: 0.5, eyeOpenR: 0.5 }], [only(['hair']), {}], [only(['lid_r', 'lid_l']), { eyeOpenL: 0.5, eyeOpenR: 0.5 }]];
for (const [i, [hs, P]] of sets.entries()) {
  stage.avatar.hidden = new Set(hs);
  for (let k = 0; k < 10; k++) stage.frame(P, 1 / 30);
  await fetch(`/__frame?i=${i}&dir=sdp_hide`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.92) });
}
return sets.length;
