// 특정 물리 출력값을 시간에 따라 찍어 봄 (볼살 Cheek 각도 등): window.PROBE = ['Cheek','CheekY','HairB']
stage.auto.breath = false;
const av = stage.avatar;
const ease = (x) => x * x * (3 - 2 * x);
const rows = [];
av.resetPhysics();
for (let i = 0; i < 90; i++) {
  const t = i / 30;
  const ax = t < 0.25 ? ease(t / 0.25) * 28 : 28;
  stage.frame({ angleX: ax }, 1 / 30);
  const pv = av.physParams.values, I = av.physIndex;
  rows.push([t.toFixed(2), ...window.PROBE.map((k) => +pv[I[k]].toFixed(2)), av.jig ? +av.jig.x.toFixed(2) : null]);
}
return rows.filter((_, i) => i % 3 === 0);
