// 검사용 '사람 같은' 무작위 움직임과 메쉬 늘어남 측정 (parts_test.html 에서만 씀)
// 고개는 여러 박자의 부드러운 흔들림 + 가끔 확 돌리기, 시선은 머물다 휙(단속운동), 깜빡임은 빨리 감고 천천히 뜸,
// 말하기는 음절 덩어리, 표정은 몇 초마다 켜고 끔 — 실제 트래킹 값처럼 '켬/끔·목표값'만 주고 부드러움은 앱 처리 과정이 맡음.
export function makeRandomUser(seed = 1, exprNames = []) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const waves = (n, amp, f0, f1) => Array.from({ length: n }, () => ({ a: amp * (0.4 + rnd() * 0.6), f: f0 + rnd() * (f1 - f0), p: rnd() * 6.28 }));
  const W = { ax: waves(3, 9, 0.05, 0.35), ay: waves(3, 5, 0.06, 0.4), az: waves(3, 5, 0.05, 0.3), lean: waves(2, 3, 0.04, 0.15), shift: waves(2, 3, 0.03, 0.12) };
  const sumW = (ws, t) => ws.reduce((a, w) => a + w.a * Math.sin(2 * Math.PI * w.f * t + w.p), 0);
  // 사건들 미리 뽑기 (60초)
  const T = 90;
  const turns = []; // 확 돌리기
  for (let t = 3 + rnd() * 4; t < T; t += 4 + rnd() * 7) turns.push({ t, a: (rnd() < 0.5 ? -1 : 1) * (12 + rnd() * 14), d: 0.25 + rnd() * 0.3, hold: 0.8 + rnd() * 2 });
  const gaze = [];
  for (let t = 0; t < T; t += 0.6 + rnd() * 2.2) gaze.push({ t, x: (rnd() - 0.5) * 1.4, y: (rnd() - 0.5) * 0.7 });
  const blinks = [];
  for (let t = 1 + rnd() * 2; t < T; t += 1.8 + rnd() * 4.5) { blinks.push(t); if (rnd() < 0.15) blinks.push(t + 0.28); }
  const talks = [];
  for (let t = 2 + rnd() * 3; t < T; t += 3 + rnd() * 6) talks.push({ t, d: 1.2 + rnd() * 3 });
  // 얼굴 근육 사건 (가끔): 한쪽 눈 찡그림·한쪽 입꼬리, 볼 부풀리기, 턱 옆으로, 코 찡그림
  const musc = [];
  const kinds = ['squint', 'smirk', 'puff', 'jaw', 'sneer'];
  for (let t = 5 + rnd() * 4; t < T; t += 3 + rnd() * 5) musc.push({ t, d: 0.8 + rnd() * 1.4, k: kinds[Math.floor(rnd() * kinds.length)], side: rnd() < 0.5 ? -1 : 1 });
  const exprs = [];
  for (let t = 4 + rnd() * 4; t < T && exprNames.length; t += 4 + rnd() * 6) exprs.push({ t, d: 1.5 + rnd() * 3, n: exprNames[Math.floor(rnd() * exprNames.length)] });
  const ease = (x) => x * x * (3 - 2 * x);
  return function user(t) {
    const P = { angleX: sumW(W.ax, t), angleY: sumW(W.ay, t), angleZ: sumW(W.az, t), eyeOpenL: 1, eyeOpenR: 1, eyeBallX: 0, eyeBallY: 0,
                mouthOpen: 0, mouthWide: 0, mouthForm: 0, brow: 0, lean: sumW(W.lean, t), shift: sumW(W.shift, t) };
    for (const r of turns) {
      const u = t - r.t;
      if (u < 0 || u > r.d * 2 + r.hold) continue;
      const k = u < r.d ? ease(u / r.d) : u < r.d + r.hold ? 1 : 1 - ease((u - r.d - r.hold) / r.d);
      P.angleX += r.a * k;
    }
    let g = gaze[0];
    for (const q of gaze) if (q.t <= t) g = q;
    P.eyeBallX = g.x + P.angleX * -0.01;
    P.eyeBallY = g.y;
    for (const b of blinks) {
      const u = t - b;
      // 감기 0.07초, 감은 채 0.03초, 뜨기 0.13초
      if (u >= 0 && u < 0.23) P.eyeOpenL = P.eyeOpenR = u < 0.07 ? 1 - u / 0.07 : u < 0.1 ? 0 : (u - 0.1) / 0.13;
    }
    for (const k of talks) {
      const u = t - k.t;
      if (u < 0 || u > k.d) continue;
      const syl = Math.max(0, Math.sin(u * 9.3 + k.t) * 0.6 + Math.sin(u * 4.3 + k.t * 2) * 0.45);
      P.mouthOpen = Math.min(1, syl) * Math.min(1, u / 0.15, (k.d - u) / 0.15);
      P.mouthWide = Math.max(0, Math.sin(u * 2.1 + k.t)) * 0.5;
    }
    for (const e of exprs) if (t >= e.t && t < e.t + e.d) P[`ex_${e.n}`] = 1;
    for (const e of musc) {
      const u = t - e.t;
      if (u < 0 || u > e.d) continue;
      const w = Math.min(1, u / 0.2, (e.d - u) / 0.25);
      if (e.k === 'squint') P[e.side < 0 ? 'eyeSquintL' : 'eyeSquintR'] = w;
      else if (e.k === 'smirk') P[e.side < 0 ? 'mouthFormL' : 'mouthFormR'] = 0.8 * w;
      else if (e.k === 'puff') P.cheekPuff = w;
      else if (e.k === 'jaw') { P.jawX = e.side * w; P.mouthOpen = Math.max(P.mouthOpen, 0.35 * w); }
      else if (e.k === 'sneer') { P.noseSneer = w; P.upperUp = 0.7 * w; }
    }
    for (const n of exprNames) P[`ex_${n}`] = P[`ex_${n}`] ?? 0;
    P.angleX = Math.max(-30, Math.min(30, P.angleX));
    return P;
  };
}

// 메쉬 늘어남: 파츠마다 삼각형 변 길이 비율(지금/원래)의 최댓값·최솟값 — 그림이 찌그러지거나 늘어지는 곳 찾기
export function meshStrain(avatar, skip = /^(Expr_|EyeLid|LashMain|LashTail|LidLine|LashFlick|MouthOpen|Iris|Pupil|EyeHL)/) {
  const res = [];
  for (const p of avatar.parts) {
    if (!p.idx || skip.test(p.name ?? p.tag ?? '') || avatar.hidden.has(p.name ?? p.tag)) continue;
    const R = p.rest;
    const O = p.out && p.out.some((v) => v !== 0) && (avatar.setOf?.[p.name] || !p.base) ? p.out : p.base; // chibi 리그는 base 없이 out 만
    const I = p.idx;
    let mx = 1;
    let mn = 1;
    for (let k = 0; k < I.length; k += 3) {
      for (let e = 0; e < 3; e++) {
        const a = I[k + e];
        const b = I[k + ((e + 1) % 3)];
        const l0 = Math.hypot(R[2 * a] - R[2 * b], R[2 * a + 1] - R[2 * b + 1]);
        if (l0 < 3) continue;
        const l1 = Math.hypot(O[2 * a] - O[2 * b], O[2 * a + 1] - O[2 * b + 1]);
        const r = l1 / l0;
        if (r > mx) mx = r;
        if (r < mn) mn = r;
      }
    }
    res.push({ name: p.name ?? p.tag, max: +mx.toFixed(3), min: +mn.toFixed(3) });
  }
  return res;
}
