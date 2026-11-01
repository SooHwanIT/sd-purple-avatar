// 펄쩍 뛰기 연속 프레임 (머리카락 늦게 따라오기 확인)
stage.setBackground('#3a3346'); stage.auto.breath = false;
Object.assign(stage.view, window.QA_VIEW);
const c = document.getElementById('c');
const S = (x) => Math.max(0, Math.min(1, x)); const sm = (x) => { const t = S(x); return t * t * (3 - 2 * t); };
const src = (t) => { const P = { eyeOpenL: 1, eyeOpenR: 1 }; const u = t - 0.2; P.bodyY = u < 0 ? 0 : u < 0.12 ? sm(u / 0.12) : u < 0.38 ? 1 - sm((u - 0.12) / 0.26) : -0.25 * Math.sin(Math.PI * S((u - 0.38) / 0.4)); return P; };
stage.avatar.resetPhysics();
const fps = 30, dt = 1 / fps;
for (let i = 0; i < Math.round(1.6 * fps); i++) { stage.frame(src(i * dt), dt); await fetch(`/__frame?i=${i}&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) }); }
return 1;
