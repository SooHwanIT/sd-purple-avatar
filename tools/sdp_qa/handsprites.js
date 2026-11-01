// 손 모양 스프라이트 14장을 캔버스 그대로 모아 저장 (손 그림 자체 확인)
const av = stage.avatar;
const c = document.createElement('canvas');
const S = av.handSp.r.open.canvas.width;
c.width = S * 7; c.height = S * 2;
const g = c.getContext('2d');
g.fillStyle = '#2b2636'; g.fillRect(0, 0, c.width, c.height);
let i = 0;
for (const side of ['r', 'l']) { let j = 0; for (const [pose, sp] of Object.entries(av.handSp[side])) { g.drawImage(sp.canvas, j * S, i * S); j++; } i++; }
await fetch(`/__frame?i=0&dir=${window.QA_DIR}`, { method: 'POST', body: c.toDataURL('image/png') });
return [S, Object.keys(av.handSp.r)];
