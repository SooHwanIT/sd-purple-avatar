// 끄덕임 연속 프레임 (머리카락 세로 늦따라오기)
stage.setBackground('#3a3346'); stage.auto.breath = false;
Object.assign(stage.view, window.QA_VIEW);
const c = document.getElementById('c');
const sm = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const src = (t) => { const P = { eyeOpenL: 1, eyeOpenR: 1 }; const u = t - 0.2; P.angleY = u < 0 ? 0 : u < 0.15 ? -sm(u / 0.15) * 22 : u < 0.45 ? -22 + sm((u - 0.15) / 0.3) * 30 : 8 - sm((u - 0.45) / 0.4) * 8; return P; };
stage.avatar.resetPhysics();
const fps = 30, dt = 1 / fps;
for (let i = 0; i < Math.round(1.4 * fps); i++) { stage.frame(src(i * dt), dt); await fetch(`/__frame?i=${i}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) }); }
return 1;
