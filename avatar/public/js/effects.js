// 아바타 위에 덧그리는 효과. 파라미터로 켜지므로 스튜디오·OBS·방송 창이 같은 모습을 그린다.
// - sleep: 졸 때 머리 위로 떠오르는 'Z' · heart: 머리 둘레로 떠오르는 하트
// - 표정(ex_이름)마다 작은 효과: 놀람 "!" · 화남 김 · 슬픔 먹구름 · 울음 눈물 · 웃음 반짝이 · 짜증 낙서 · 멍 "…" 등
// - fxRain: 화면 가득 하트 (큰 후원) · fxFire: 불꽃놀이 (아주 큰 후원) · fxSpark: 반짝이 (채팅이 웃을 때)
// - 떠 있는 손 (handRW·handLW): 몸에서 떨어진 살색 손 (펼친 손바닥) — 인사할 때 손목을 축으로 흔들고, 손 트래킹이 있으면 손목을 따라감.
//   아바타의 일부로 그려 배경 앞쪽 물건(바 카운터)에 가려지고, 아바타 숨기기도 같이 따른다 (item.avatar)
// - sayHi · sayBye: 인사 말풍선 ('아하~' · '아바~')
// 위치는 모델 좌표(아바타 기준). 화면 전체 효과는 지금 화면에 보이는 범위를 모델 좌표로 바꿔 쓴다.

const POOL = 320;

function sprite(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return c;
}
const OUT = '#3b2266'; // 테두리 색 (아바타 선 색과 비슷한 짙은 보라)
const HAND_SKIN = '#fdebe5'; // 떠 있는 손 (SD 아바타 손 색)
const HAND_LINE = '#1d1519';
const smooth01 = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

// 펼친 손바닥 (SD 그림체: 짧고 둥근 손가락 넷 + 엄지, 굵은 테두리). flip=false 면 엄지가 오른쪽 (화면 왼쪽 손 — 엄지가 얼굴 쪽)
// 손목(손바닥 아래 끝)은 그림 가운데에서 아래로 그림 크기의 0.37 — 흔들 때 이 점을 축으로 돈다 (HAND_PIVOT)
const HAND_PIVOT = 0.37;
const HAND_PALM_DY = 0.16; // 손바닥 가운데가 그림 가운데보다 아래인 만큼 (쉬는 자리 맞춤)
function drawHand(ctx, flip) {
  if (flip) {
    ctx.translate(128, 0);
    ctx.scale(-1, 1);
  }
  const O = 6; // 테두리 굵기
  const fingers = [[[50, 72], [44, 40]], [[59, 67], [57, 33]], [[69, 67], [71, 34]], [[78, 73], [85, 46]]];
  const thumb = [[83, 90], [104, 72]];
  const caps = (lw, color) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    for (const [[x0, y0], [x1, y1]] of [...fingers, thumb]) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  };
  const palm = (r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(63, 84, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // 테두리를 먼저 굵게 다 그리고 그 위에 살색을 칠하면 손가락·손바닥이 한 덩어리 윤곽이 된다
  caps(14 + 2 * O, HAND_LINE);
  palm(27 + O, HAND_LINE);
  caps(14, HAND_SKIN);
  palm(27, HAND_SKIN);
  // 손가락 사이 선
  ctx.strokeStyle = HAND_LINE;
  ctx.lineWidth = 2.6;
  for (const [[x0, y0], [x1, y1]] of [[[52, 44], [55, 60]], [[64, 40], [64, 58]], [[77, 45], [73, 61]]]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(236, 170, 160, 0.3)';
  ctx.beginPath();
  ctx.ellipse(62, 88, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.ellipse(50, 74, 6, 4, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

// 말풍선 (꼬리는 왼쪽 아래 = 머리 쪽)
function drawBubble(ctx, S, text) {
  const x0 = 14;
  const y0 = 46;
  const x1 = S - 14;
  const y1 = 176;
  const p = new Path2D();
  p.roundRect(x0, y0, x1 - x0, y1 - y0, 46);
  p.moveTo(70, y1 - 8);
  p.lineTo(34, 224);
  p.lineTo(112, y1 - 6);
  p.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = OUT;
  ctx.stroke(p);
  ctx.fillStyle = '#ffffff';
  ctx.fill(p);
  ctx.font = '900 58px "Pretendard Variable", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = OUT;
  ctx.fillText(text, S / 2, (y0 + y1) / 2 + 3, x1 - x0 - 34);
}

const SPRITES = {
  z: () => sprite((ctx) => {
    ctx.font = 'italic 900 104px "Segoe UI", "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = OUT;
    ctx.strokeText('Z', 64, 66);
    ctx.fillStyle = '#efe6ff';
    ctx.fillText('Z', 64, 66);
  }),
  heart: () => sprite((ctx) => {
    const path = new Path2D('M64 112 C 20 82, 6 58, 14 36 C 22 14, 52 12, 64 34 C 76 12, 106 14, 114 36 C 122 58, 108 82, 64 112 Z');
    const g = ctx.createLinearGradient(0, 14, 0, 112);
    g.addColorStop(0, '#ff9ad5');
    g.addColorStop(1, '#a06bff');
    ctx.lineWidth = 8;
    ctx.strokeStyle = OUT;
    ctx.stroke(path);
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(40, 40, 11, 7, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }),
  // 놀람: 느낌표
  bang: () => sprite((ctx) => {
    ctx.font = '900 112px "Segoe UI", "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 16;
    ctx.strokeStyle = OUT;
    ctx.strokeText('!', 64, 68);
    ctx.fillStyle = '#ffe36b';
    ctx.fillText('!', 64, 68);
  }),
  // 눈물·빗방울
  drop: () => sprite((ctx) => {
    const path = new Path2D('M64 10 C 64 10, 104 62, 104 82 A 40 40 0 0 1 24 82 C 24 62, 64 10, 64 10 Z');
    const g = ctx.createLinearGradient(0, 10, 0, 122);
    g.addColorStop(0, '#d9f2ff');
    g.addColorStop(1, '#6fb6ff');
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#2a3f6b';
    ctx.stroke(path);
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(50, 80, 8, 13, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }),
  // 슬픔: 먹구름
  cloud: () => sprite((ctx) => {
    const path = new Path2D();
    for (const [x, y, r] of [[38, 74, 26], [62, 58, 32], [90, 70, 26], [64, 82, 26]]) path.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#2b2733';
    ctx.stroke(path);
    ctx.fillStyle = '#9690ad';
    ctx.fill(path);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(58, 50, 18, 9, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }),
  // 화남: 김 (만화식 뭉게 — 흐릿한 흰 덩어리는 잘못 딴 흰 자국처럼 보여서 테두리 있는 그림으로)
  steam: () => sprite((ctx) => {
    const path = new Path2D();
    for (const [x, y, r] of [[44, 76, 22], [66, 60, 27], [88, 74, 21], [66, 84, 20]]) path.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#6f6390';
    ctx.stroke(path);
    ctx.fillStyle = '#f3f0fa';
    ctx.fill(path);
    ctx.fillStyle = 'rgba(160,150,190,0.35)';
    ctx.beginPath();
    ctx.ellipse(70, 88, 20, 7, 0.1, 0, Math.PI * 2);
    ctx.fill();
  }),
  // 웃음·윙크: 반짝이 (네 갈래 별)
  spark: () => sprite((ctx) => {
    const star = new Path2D('M64 6 C 70 50, 78 58, 122 64 C 78 70, 70 78, 64 122 C 58 78, 50 70, 6 64 C 50 58, 58 50, 64 6 Z');
    ctx.lineWidth = 7;
    ctx.strokeStyle = OUT;
    ctx.stroke(star);
    ctx.fillStyle = '#fff3a8';
    ctx.fill(star);
  }),
  // 짜증: 엉킨 낙서
  scribble: () => sprite((ctx) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = new Path2D();
    path.moveTo(20, 64);
    for (let i = 0; i < 26; i++) {
      const a = i * 0.9;
      path.lineTo(64 + Math.cos(a) * (26 + (i % 3) * 7), 64 + Math.sin(a) * (18 + (i % 4) * 5));
    }
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(path);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1e1a26';
    ctx.stroke(path);
  }),
  // 멍: 말줄임표
  dots: () => sprite((ctx) => {
    for (const x of [30, 64, 98]) {
      ctx.beginPath();
      ctx.arc(x, 70, 11, 0, Math.PI * 2);
      ctx.lineWidth = 6;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.fillStyle = '#f2ecff';
      ctx.fill();
    }
  }),
  // 불꽃놀이 불티 (더하기 섞기라 가운데가 밝은 둥근 빛)
  // 떠 있는 손: handR = 화면 왼쪽 손 (엄지가 몸 쪽 = 오른쪽)
  handR: () => sprite((ctx) => drawHand(ctx, false)),
  handL: () => sprite((ctx) => drawHand(ctx, true)),
  // 인사 말풍선 (아하 · 아바)
  bubHi: () => sprite((ctx, S) => drawBubble(ctx, S, '아하~'), 256),
  bubBye: () => sprite((ctx, S) => drawBubble(ctx, S, '아바~'), 256),
  fwPink: () => sprite((ctx, S) => glowDot(ctx, S, '255, 140, 210')),
  fwGold: () => sprite((ctx, S) => glowDot(ctx, S, '255, 214, 120')),
  fwViolet: () => sprite((ctx, S) => glowDot(ctx, S, '180, 140, 255')),
};
function glowDot(ctx, S, rgb) {
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, `rgba(${rgb},0.95)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
}
const ADDITIVE = new Set(['fwPink', 'fwGold', 'fwViolet']);
const FW = ['fwPink', 'fwGold', 'fwViolet'];

// 표정마다: 켜진 동안(값 > 0.5) 일정 간격으로 / 켜지는 순간 한 번
const EXPR_FX = {
  surprised: { once: 'bang' },
  angry: { every: 0.3, spawn: 'steam' },
  sad: { hold: 'cloud', every: 0.14, spawn: 'rain' },
  cry: { every: 0.22, spawn: 'tear' },
  laugh: { every: 0.16, spawn: 'spark' },
  smile: { every: 0.9, spawn: 'spark' },
  shy: { every: 0.55, spawn: 'smallHeart' },
  heart: { every: 0.3, spawn: 'smallHeart' },
  annoyed: { hold: 'scribble' },
  blank: { hold: 'dots' },
  pout: { every: 1.1, spawn: 'puff' },
  sleepy: { every: 1.8, spawn: 'z' },
  wink: { once: 'wink' },
  // model_sd_purple 표정 시트의 표정들 (다른 모델엔 이 표정이 없어 아무 일도 안 함)
  excited: { every: 0.45, spawn: 'spark' }, // 신남
  asleep: { every: 1.8, spawn: 'z' }, // 자장
  tired: { every: 1.3, spawn: 'puff' }, // 지침
  think: { hold: 'dots' }, // 생각중 "…"
  teary: { every: 0.9, spawn: 'tear' }, // 울먹임
  fingerheart: { every: 0.45, spawn: 'smallHeart' }, // 손하트
  surprisehands: { once: 'bang' }, // 놀람손 "!"
  handsup: { every: 0.4, spawn: 'spark' }, // 양손 들기
};

export class Effects {
  constructor(renderer, model) {
    this.r = renderer;
    this.head = model.rig.head;
    // 떠 있는 손의 쉬는 자리: 손 레이어가 있는 모델(SD)은 그 손 자리에서 떠오르고(원래 손은 그동안 숨김),
    // 없는 모델은 몸 아래쪽에서 나타난다
    const H = this.head;
    const layer = (side) => model.layers?.find((l) => l.tag === `handwear-${side}`);
    this.handRest = {};
    for (const [side, ls, dir] of [['R', 'r', -1], ['L', 'l', 1]]) {
      const l = layer(ls);
      this.handRest[side] = l ? { x: l.x + l.w / 2, y: l.y + l.h / 2, own: true } : { x: H.cx + dir * H.rx * 1.3, y: H.cy + H.ry * 2.2, own: false };
    }
    const hl = layer('r') ?? layer('l');
    this.handSize = hl ? hl.w / 0.6 : H.rx * 0.75; // 들어 올린 손의 손바닥 폭이 원래 손 크기쯤 되게
    this.tex = {};
    for (const [k, make] of Object.entries(SPRITES)) this.tex[k] = renderer.createTexture(make());
    this.uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.indices = new Uint16Array([0, 2, 1, 1, 2, 3]);
    this.meshes = {};
    this.parts = [];
    this.timers = {};
    this.prevEx = {};
    this.time = 0;
    this.seed = 1;
  }

  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  // 종류별로 메쉬를 미리 만들어 두고 돌려 쓴다
  mesh(kind, i) {
    const list = (this.meshes[kind] ??= []);
    while (list.length <= i) list.push(this.r.createMesh(this.tex[kind], new Float32Array(8), this.uvs, this.indices));
    return list[i];
  }

  push(p) {
    if (this.parts.length < POOL) this.parts.push({ age: 0, ax: 0, ay: 0, rot: 0, spin: 0, wob: 0, phase: this.rand() * 6, ...p });
  }

  // 간격마다 부르기 (dt 동안 몇 번 나올지)
  every(key, on, gap, fn) {
    if (!on) {
      this.timers[key] = 0;
      return;
    }
    this.timers[key] = (this.timers[key] ?? 0) - this.dt;
    while (this.timers[key] <= 0) {
      this.timers[key] += gap;
      fn();
    }
  }

  // 켜져 있는 동안 계속 떠 있는 것 (먹구름·낙서·말줄임표): 꺼지면 천천히 사라짐
  hold(tag, on, make) {
    const p = this.parts.find((q) => q.tag === tag && !q.leaving);
    if (on) {
      if (p) p.age = Math.min(p.age, p.life * 0.4);
      else this.push({ ...make(), tag });
    } else if (p) {
      p.leaving = true;
      p.age = Math.max(p.age, p.life * 0.75);
    }
  }

  // frame: { view: {cx, cy, scale}, W, H } — 화면 전체 효과를 위한 지금 화면 범위
  update(dt, P, frame) {
    this.time += dt;
    this.dt = dt;
    const H = this.head;
    const rand = () => this.rand();
    // 고개를 돌리면 머리 위치도 조금 따라감
    const hx = H.cx + ((P.angleX ?? 0) / 30) * H.rx * 0.3 + (P.bodyX ?? 0) * 3;
    const hy = H.cy - ((P.angleY ?? 0) / 30) * H.ry * 0.15;
    const R = H.rx;

    // ---- 졸기 Z · 하트 ----
    const sleep = P.sleep ?? 0;
    this.every('z', sleep > 0.4, 1.05, () => this.push({ kind: 'z', x: hx + R * 0.62, y: hy - H.ry * 0.7, vx: 26, vy: -34, life: 3.0, s0: R * 0.24, s1: R * 0.5, rot: -0.25, wob: 10, strength: Math.min(1, sleep * 1.4) }));
    const heartAround = (rate) => this.every('heart', true, rate, () => {
      const side = rand() < 0.5 ? -1 : 1;
      this.push({ kind: 'heart', x: hx + side * R * (1.05 + rand() * 0.5), y: hy + H.ry * (0.45 + rand() * 0.8), vx: side * (8 + rand() * 18), vy: -(110 + rand() * 70), life: 1.5 + rand() * 0.5, s0: R * (0.12 + rand() * 0.1), s1: R * (0.2 + rand() * 0.12), wob: 30, swing: 0.25 });
    });
    if ((P.heart ?? 0) > 0.4) heartAround(0.11);
    else this.timers.heart = 0;

    // ---- 표정 효과 ----
    const spawn = {
      steam: () => {
        const side = rand() < 0.5 ? -1 : 1;
        this.push({ kind: 'steam', x: hx + side * R * (0.75 + rand() * 0.2), y: hy - H.ry * 0.55, vx: side * (30 + rand() * 30), vy: -(70 + rand() * 40), life: 1.1, s0: R * 0.25, s1: R * 0.8, fadeIn: 0.15 });
      },
      rain: () => {
        const c = this.parts.find((q) => q.tag === 'cloud');
        if (!c || c.leaving) return;
        this.push({ kind: 'drop', x: c.x + (rand() - 0.5) * R * 0.8, y: c.y + R * 0.28, vx: 0, vy: 160, ay: 260, life: 0.55, s0: R * 0.1, s1: R * 0.1 });
      },
      tear: () => {
        const side = (this.timers.tearSide = -(this.timers.tearSide || 1));
        this.push({ kind: 'drop', x: hx + side * R * 0.55, y: hy + H.ry * 0.05, vx: side * (90 + rand() * 60), vy: -(40 + rand() * 40), ay: 520, life: 0.9, s0: R * 0.12, s1: R * 0.15 });
      },
      spark: () => {
        const a = rand() * Math.PI * 2;
        const d = 1.05 + rand() * 0.45;
        this.push({ kind: 'spark', x: hx + Math.cos(a) * R * d, y: hy - H.ry * 0.1 + Math.sin(a) * H.ry * d * 0.85, vx: 0, vy: -12, life: 0.6, s0: R * 0.08, s1: R * (0.26 + rand() * 0.1), pop: true, spin: (rand() - 0.5) * 2 });
      },
      smallHeart: () => {
        const side = rand() < 0.5 ? -1 : 1;
        this.push({ kind: 'heart', x: hx + side * R * (0.7 + rand() * 0.3), y: hy + H.ry * 0.25, vx: side * 12, vy: -(60 + rand() * 30), life: 1.3, s0: R * 0.12, s1: R * 0.22, wob: 18, swing: 0.25 });
      },
      puff: () => {
        const side = rand() < 0.5 ? -1 : 1;
        this.push({ kind: 'steam', x: hx + side * R * 0.75, y: hy + H.ry * 0.3, vx: side * 110, vy: -10, life: 0.8, s0: R * 0.15, s1: R * 0.45, fadeIn: 0.1 });
      },
      z: () => this.push({ kind: 'z', x: hx + R * 0.62, y: hy - H.ry * 0.7, vx: 22, vy: -28, life: 2.6, s0: R * 0.22, s1: R * 0.45, rot: -0.25, wob: 10 }),
    };
    const once = {
      bang: () => this.push({ kind: 'bang', x: hx + R * 0.95, y: hy - H.ry * 0.8, vx: 0, vy: 0, life: 1.2, s0: R * 0.15, s1: R * 0.85, pop: true, rot: 0.18 }),
      wink: () => this.push({ kind: 'spark', x: hx - R * 0.55, y: hy - H.ry * 0.15, vx: 0, vy: -10, life: 0.9, s0: R * 0.09, s1: R * 0.38, pop: true, spin: 1.5 }),
    };
    const holds = {
      cloud: () => ({ kind: 'cloud', x: hx, y: hy - H.ry * 1.35, vx: 0, vy: 0, life: 2.4, s0: R * 0.92, s1: R * 0.95, follow: true, fadeIn: 0.25, wob: 6 }),
      scribble: () => ({ kind: 'scribble', x: hx + R * 0.6, y: hy - H.ry * 1.0, vx: 0, vy: 0, life: 2.0, s0: R * 0.44, s1: R * 0.5, follow: true, fadeIn: 0.15, spin: 0, jitter: true }),
      dots: () => ({ kind: 'dots', x: hx + R * 0.7, y: hy - H.ry * 0.95, vx: 0, vy: 0, life: 2.0, s0: R * 0.46, s1: R * 0.5, follow: true, fadeIn: 0.4 }),
    };
    for (const [name, fx] of Object.entries(EXPR_FX)) {
      const v = P[`ex_${name}`] ?? 0;
      const on = v > 0.5;
      const was = this.prevEx[name] ?? false;
      this.prevEx[name] = on;
      if (fx.once && on && !was) once[fx.once]();
      if (fx.hold) this.hold(fx.hold, on, holds[fx.hold]);
      if (fx.every) this.every(`ex_${name}`, on, fx.every, spawn[fx.spawn]);
    }
    // 채팅이 웃을 때: 머리 둘레 반짝이
    this.every('fxSpark', (P.fxSpark ?? 0) > 0.4, 0.12, spawn.spark);

    // ---- 화면 전체 효과 (후원) ----
    if (frame?.view && ((P.fxRain ?? 0) > 0.3 || (P.fxFire ?? 0) > 0.3)) {
      const v = frame.view;
      const halfW = frame.W / 2 / v.scale;
      const halfH = frame.H / 2 / v.scale;
      const left = v.cx - halfW;
      const top = v.cy - halfH;
      const px = 1 / v.scale; // 화면 1px = 모델 몇 px
      // 화면 가득 하트: 아래에서 위로 솟아오름
      this.every('fxRain', (P.fxRain ?? 0) > 0.3, 0.035, () => {
        const s = (34 + rand() * 46) * px;
        this.push({ screen: true, kind: 'heart', x: left + rand() * halfW * 2, y: top + halfH * 2 + s, vx: (rand() - 0.5) * 60 * px, vy: -(380 + rand() * 300) * px, life: 2.6 + rand() * 0.8, s0: s * 0.7, s1: s, wob: 40 * px, swing: 0.3 });
      });
      // 불꽃놀이: 화면 위쪽 아무 데서나 펑
      this.every('fxFire', (P.fxFire ?? 0) > 0.3, 0.45, () => {
        const cx = left + halfW * 2 * (0.12 + rand() * 0.76);
        const cy = top + halfH * 2 * (0.12 + rand() * 0.38);
        const kind = FW[Math.floor(rand() * FW.length)];
        const n = 34;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rand() * 0.15;
          const sp = (260 + rand() * 160) * px;
          this.push({ screen: true, kind, x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: 260 * px, drag: 1.6, life: 1.1 + rand() * 0.5, s0: 30 * px, s1: 16 * px });
        }
        this.push({ screen: true, kind, x: cx, y: cy, vx: 0, vy: 0, life: 0.35, s0: 160 * px, s1: 260 * px });
      });
    } else {
      this.timers.fxRain = 0;
      this.timers.fxFire = 0;
    }

    // ---- 인사 말풍선: 켜지는 순간 한 번 (손을 흔드는 쪽 반대편 머리 위) ----
    for (const [key, kind] of [['sayHi', 'bubHi'], ['sayBye', 'bubBye']]) {
      const on = (P[key] ?? 0) > 0.5;
      if (on && !this.prevEx[key]) this.push({ kind, x: hx + R * 1.0, y: hy - H.ry * 0.95, vx: 0, vy: -8, life: 2.3, s0: R * 0.3, s1: R * 0.95, pop: true, rot: 0.06, fadeIn: 0.06 });
      this.prevEx[key] = on;
    }

    // ---- 움직이고 그리기 ----
    const items = this.hands(P, frame?.anchors);
    const counts = {};
    this.parts = this.parts.filter((p) => (p.age += dt) < p.life);
    for (const p of this.parts) {
      const k = p.age / p.life;
      if (p.follow) {
        // 머리를 따라다니는 것 (먹구름·낙서·말줄임표), 둥실둥실
        p.x = p.kind === 'cloud' ? hx : hx + R * (p.kind === 'dots' ? 0.7 : 0.6);
        p.y = hy - H.ry * (p.kind === 'cloud' ? 1.35 : 0.95) + Math.sin(this.time * 1.6 + p.phase) * R * 0.03;
      } else {
        if (p.drag) {
          const f = Math.exp(-p.drag * dt);
          p.vx *= f;
          p.vy *= f;
        }
        p.vx += (p.ax ?? 0) * dt;
        p.vy += (p.ay ?? 0) * dt;
        p.x += (p.vx + Math.sin(this.time * 2.2 + p.phase) * (p.wob ?? 0)) * dt;
        p.y += p.vy * dt;
      }
      let size = p.s0 + (p.s1 - p.s0) * Math.min(1, k * 1.4);
      if (p.pop) {
        // 톡 튀어나왔다가 제자리 (살짝 넘쳤다 돌아옴)
        const u = Math.min(1, p.age / 0.22);
        const back = 1 + 2.4 * (u - 1) ** 3 + 1.4 * (u - 1) ** 2;
        size = p.s0 + (p.s1 - p.s0) * back;
      }
      const fadeIn = p.fadeIn ?? 0.2;
      const fade = Math.min(1, k / fadeIn) * (1 - Math.max(0, (k - 0.6) / 0.4));
      let tilt = (p.rot ?? 0) + (p.spin ?? 0) * p.age + (p.swing ? Math.sin(this.time * 3 + p.phase) * p.swing : 0);
      let jx = 0;
      let jy = 0;
      if (p.jitter) {
        // 짜증 낙서: 바르르 떨림
        jx = Math.sin(this.time * 47 + p.phase) * R * 0.012;
        jy = Math.cos(this.time * 53 + p.phase) * R * 0.012;
        tilt += Math.sin(this.time * 9) * 0.08;
      }
      const c = Math.cos(tilt);
      const s = Math.sin(tilt);
      const pos = new Float32Array(8);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ux, uy], i) => {
        const dx = (ux * size) / 2;
        const dy = (uy * size) / 2;
        pos[2 * i] = p.x + jx + dx * c - dy * s;
        pos[2 * i + 1] = p.y + jy + dx * s + dy * c;
      });
      counts[p.kind] = counts[p.kind] ?? 0;
      const mesh = this.mesh(p.kind, counts[p.kind]++);
      this.r.updatePositions(mesh, pos);
      // screen: 화면 전체 효과(후원) — 아바타를 숨겨도 보임. 나머지는 아바타에 붙은 효과
      items.push({ mesh, opacity: fade * (p.strength ?? 1), additive: ADDITIVE.has(p.kind), screen: !!p.screen });
    }
    return items;
  }

  // 떠 있는 손: 쉬는 자리에서 머리 기준 목표(hand?X·Y, 머리 반지름 단위)까지 hand?W 만큼 옮기고, 손목을 축으로 hand?Rot(°) 만큼 돌린다.
  // anchors: 아바타가 알려 주는 지금 손 자리 (몸이 움직이면 같이 움직인 원래 손 — SD 모델)
  hands(P, anchors) {
    const items = [];
    const H = this.head;
    for (const side of ['R', 'L']) {
      const w = Math.max(0, Math.min(1, P[`hand${side}W`] ?? 0));
      if (w < 0.01) continue;
      const rest = anchors?.[side] ?? this.handRest[side];
      const own = this.handRest[side].own;
      // 손 레이어가 없는 모델(전신 Cubism 등)은 팔이 따로 있어 손만 떠 있으면 어색하다 → 그리지 않음 (인사는 끄덕임·말풍선만)
      if (!own) continue;
      const mesh = this.mesh(`hand${side}`, 0);
      if (rest.attached) {
        // 소매 끝에 붙은 손 (SD — 팔을 드는 모델): 손목을 소매 끝에 두고 손가락은 팔 방향으로, hand?Rot 만큼 손목에서 흔든다.
        // 팔이 조금 올라간 뒤 원래(동그란) 손과 바꿔 낀다 (rig.js 가 원래 손을 숨김)
        const size = this.handSize * (0.9 + 0.25 * w);
        const f = ((rest.dir + (P[`hand${side}Rot`] ?? 0)) * Math.PI) / 180;
        const cx = rest.x + Math.cos(f) * size * HAND_PIVOT;
        const cy = rest.y + Math.sin(f) * size * HAND_PIVOT;
        const c = Math.cos(f + Math.PI / 2); // 그림은 손가락이 위(-90°)를 가리킴
        const s = Math.sin(f + Math.PI / 2);
        const pos = new Float32Array(8);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ux, uy], i) => {
          const dx = (ux * size) / 2;
          const dy = (uy * size) / 2;
          pos[2 * i] = cx + dx * c - dy * s;
          pos[2 * i + 1] = cy + dx * s + dy * c;
        });
        this.r.updatePositions(mesh, pos);
        items.push({ mesh, opacity: smooth01((w - 0.3) / 0.25), avatar: true });
        continue;
      }
      const size = this.handSize * (0.85 + 0.35 * w); // 들어 올리면 카메라 쪽으로 와서 조금 크게
      const tx = H.cx + (P[`hand${side}X`] ?? 0) * H.rx + (P.bodyX ?? 0) * 3;
      const ty = H.cy + (P[`hand${side}Y`] ?? 0) * H.ry;
      // 쉬는 자리에서는 손바닥이 원래 손 자리에 오게 (그림 가운데가 손바닥보다 위에 있음)
      const rx = rest.x;
      const ry = rest.y - size * HAND_PALM_DY;
      const x = rx + (tx - rx) * w;
      const y = ry + (ty - ry) * w;
      const a = ((P[`hand${side}Rot`] ?? 0) * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const py = size * HAND_PIVOT; // 손목: 그림 가운데에서 아래로
      const pos = new Float32Array(8);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ux, uy], i) => {
        const dx = (ux * size) / 2;
        const dy = (uy * size) / 2 - py;
        pos[2 * i] = x + dx * c - dy * s;
        pos[2 * i + 1] = y + py + dx * s + dy * c;
      });
      this.r.updatePositions(mesh, pos);
      // 원래 손이 있던 모델은 원래 손과 빠르게 바꿔 끼우고(rig.js 가 원래 손을 숨김), 없던 모델은 올라오며 나타남
      items.push({ mesh, opacity: own ? smooth01((w - 0.02) / 0.12) : smooth01(w / 0.35), avatar: true });
    }
    return items;
  }
}
