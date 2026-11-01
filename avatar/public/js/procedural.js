// 원본에 없는 그림(감은 눈, 벌린 입)을 원본 선 색·굵기에 맞춰 그린다.

export function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let i = 1;
  while (i < n && xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
}

const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// 감은 눈: 눈꺼풀이 닫히는 선(closeY)을 따라 양 끝이 가늘어지는 굵은 선.
// smile=true 이면 위로 볼록한 웃는 눈(^)으로 그린다.
export function drawClosedEye(eye, closeRatio, { smile = false } = {}) {
  const pad = Math.ceil(eye.lashThick * 2 + 8);
  const x0 = Math.floor(eye.x0 - pad);
  const x1 = Math.ceil(eye.x1 + pad);
  const yTop = Math.floor(Math.min(...eye.upper) - pad);
  const yBot = Math.ceil(Math.max(...eye.lower) + pad);
  const canvas = document.createElement('canvas');
  canvas.width = x1 - x0;
  canvas.height = yBot - yTop;
  const ctx = canvas.getContext('2d');
  const N = 48;
  const width = eye.x1 - eye.x0;
  const thick = Math.max(4, eye.lashThick * 0.9);
  const top = [];
  const bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = eye.x0 + width * (0.02 + 0.96 * t);
    const u = interp(eye.xs, eye.upper, x);
    const l = interp(eye.xs, eye.lower, x);
    let y = l - (l - u) * closeRatio;
    if (smile) {
      const mid = (Math.min(...eye.lower) + Math.max(...eye.upper)) / 2;
      y = mid + (eye.lower.reduce((a, b) => a + b, 0) / eye.lower.length - mid) * 0.35
        - Math.sin(Math.PI * t) * (l - u) * 0.28;
    }
    const taper = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.55);
    const h = (thick / 2) * (0.25 + 0.75 * taper);
    top.push([x - x0, y - h - yTop]);
    bot.push([x - x0, y + h - yTop]);
  }
  ctx.fillStyle = rgb(eye.lashColor);
  ctx.beginPath();
  ctx.moveTo(top[0][0], top[0][1]);
  for (const p of top) ctx.lineTo(p[0], p[1]);
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.closePath();
  ctx.fill();
  // 바깥쪽 끝의 짧은 속눈썹 (원본 그림체처럼 바깥 꼬리를 살짝 올린다)
  const outerLeft = eye.side === 'r'; // 이미지 왼쪽 눈(캐릭터 오른쪽)은 바깥 꼬리가 왼쪽
  const end = outerLeft ? top[0] : top[top.length - 1];
  const dir = outerLeft ? -1 : 1;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(eye.lashColor);
  ctx.lineWidth = thick * 0.45;
  ctx.beginPath();
  ctx.moveTo(end[0] - dir * thick * 0.4, end[1] + thick * 0.3);
  ctx.quadraticCurveTo(end[0] + dir * thick * 0.7, end[1] - thick * 0.1, end[0] + dir * thick * 1.1, end[1] - thick * 0.9);
  ctx.stroke();
  return { canvas, x: x0, y: yTop, w: canvas.width, h: canvas.height };
}

// 벌린 입. 매 프레임 같은 캔버스에 다시 그린다.
export class MouthSprite {
  constructor(mouth, palette = {}) {
    this.m = mouth;
    this.scale = 2; // 텍스처 해상도 배율 (확대 표시 대비)
    const hw = (mouth.x1 - mouth.x0) / 2;
    this.hw = hw;
    this.x = mouth.cx - hw * 1.6;
    this.y = mouth.cy - hw * 0.9;
    this.w = hw * 3.2;
    this.h = hw * 3.0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(this.w * this.scale);
    this.canvas.height = Math.ceil(this.h * this.scale);
    this.ctx = this.canvas.getContext('2d');
    this.inside = palette.inside ?? [92, 30, 44];
    this.tongue = palette.tongue ?? [226, 122, 138];
    this.key = '';
  }

  // 입꼬리 곡선(원본 선) + form(웃음/찡그림) 굽힘
  topY(x, form) {
    const m = this.m;
    const t = Math.max(-1, Math.min(1, (x - m.cx) / this.hw));
    return interp(m.xs, m.ys, x) + form * this.hw * 0.16 * (1 - t * t);
  }

  // open: 0..1, form: -1..1, narrow: 0..1 (오/우 모양), wide: 0..1 (이/에 모양 — 옆으로 길고 납작, 윗니가 보임)
  draw(open, form, narrow, wide = 0) {
    const key = `${open.toFixed(3)}|${form.toFixed(3)}|${narrow.toFixed(3)}|${wide.toFixed(3)}`;
    if (key === this.key) return false;
    this.key = key;
    const { ctx, m, scale } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (open < 0.02) return true;
    ctx.setTransform(scale, 0, 0, scale, -this.x * scale, -this.y * scale);
    const widthK = (1 - 0.38 * narrow) * (1 + 0.24 * wide) * (1 + 0.08 * Math.max(0, form)) * (0.82 + 0.18 * Math.min(1, open * 2));
    const hw = this.hw * widthK;
    const depth = this.hw * (0.25 + 1.05 * open) * (1 + 0.25 * narrow) * (1 - 0.42 * wide);
    const N = 32;
    const top = [];
    const bot = [];
    for (let i = 0; i <= N; i++) {
      const t = -1 + (2 * i) / N;
      const x = m.cx + t * hw;
      const y = this.topY(m.cx + t * this.hw, form) - (1 - t * t) * this.hw * 0.05 * open;
      top.push([x, y]);
      const prof = Math.pow(Math.max(0, 1 - t * t), 0.62 + 0.3 * narrow - 0.3 * wide);
      bot.push([x, y + depth * prof]);
    }
    const path = new Path2D();
    path.moveTo(top[0][0], top[0][1]);
    for (const p of top) path.lineTo(p[0], p[1]);
    for (let i = bot.length - 1; i >= 0; i--) path.lineTo(bot[i][0], bot[i][1]);
    path.closePath();
    ctx.fillStyle = rgb(this.inside);
    ctx.fill(path);
    // 혀
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = rgb(this.tongue);
    const tongueY = top[N / 2][1] + depth * 1.02;
    ctx.beginPath();
    ctx.ellipse(m.cx, tongueY, hw * 0.62, depth * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    // 이·에: 윗니가 보이게 (입 윗선 아래로 흰 띠)
    if (wide > 0.12) {
      ctx.globalAlpha = Math.min(1, (wide - 0.12) * 2);
      ctx.fillStyle = '#fbf6f2';
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1]);
      for (const p of top) ctx.lineTo(p[0], p[1]);
      for (let i = top.length - 1; i >= 0; i--) {
        const tt = -1 + (2 * i) / N;
        ctx.lineTo(top[i][0], top[i][1] + depth * 0.34 * Math.pow(Math.max(0, 1 - tt * tt), 0.3));
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // 외곽선: 원본 입 선보다 조금 어두운 색, 굵기는 30% 정도로 얇게 (두꺼우면 입술처럼 보임)
    const line = m.color.map((c) => Math.round(c * 0.72));
    const lw = Math.max(1.1, m.thick * 0.3);
    ctx.strokeStyle = rgb(line);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.stroke(path);
    // 윗선만 가운데를 살짝 굵게 — 원래 웃는 입 선의 느낌을 남긴다
    ctx.lineWidth = lw * 1.5;
    ctx.beginPath();
    const a0 = Math.floor(N * 0.18);
    const a1 = Math.ceil(N * 0.82);
    ctx.moveTo(top[a0][0], top[a0][1]);
    for (let i = a0 + 1; i <= a1; i++) ctx.lineTo(top[i][0], top[i][1]);
    ctx.stroke();
    return true;
  }
}
