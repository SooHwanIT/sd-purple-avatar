// 움직이는 배경: scene/<이름>/scene.json 의 겹(tools/split_background.py 로 만든 것)을 아바타 뒤에 깐다.
// - 시차: 아바타의 고개·몸 움직임과 느린 흔들림에 따라 깊이가 다른 겹이 다른 만큼 밀린다
// - 조명: 천장에 매달린 진자처럼 흔들리고, 전구·촛불 빛이 깜빡인다 (더하기 섞기)
// - 식물·꽃: 정점을 바람에 살랑이듯 휘게 한다
// - 먼지: 조명 아래에 작은 빛 알갱이가 천천히 떠다닌다
import { gridMesh } from './renderer.js';
import { FramePanel, SongTitle, barSprite } from './scene-text.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`배경 그림을 읽지 못함: ${src}`));
    im.src = src;
  });
}

function alphaOf(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

// 여러 사인을 겹친 부드러운 잡음 (seed 마다 다른 모양)
function wobble(t, seed, fast = false) {
  const k = fast ? 1 : 0.25;
  return (
    Math.sin(t * 7.3 * k + seed) * 0.45 +
    Math.sin(t * 13.1 * k + seed * 1.7) * 0.3 +
    Math.sin(t * 2.9 * k + seed * 0.6) * 0.25
  );
}

// 코드로 그리는 작은 그림: 빛(glow) · 반짝임(star) · 꽃잎(petal) · 눈꺼풀(lid)
function procSprite(kind, color = '#ffffff') {
  const c = document.createElement('canvas');
  const S = kind === 'petal' ? 32 : 64;
  c.width = c.height = S;
  const g = c.getContext('2d');
  const h = S / 2;
  if (kind === 'glow') {
    const gr = g.createRadialGradient(h, h, 0, h, h, h);
    gr.addColorStop(0, color);
    gr.addColorStop(0.35, `${color}99`);
    gr.addColorStop(1, `${color}00`);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  } else if (kind === 'star') {
    // 가는 십자 빛 + 가운데 점
    const gr = g.createRadialGradient(h, h, 0, h, h, h * 0.35);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, `${color}00`);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    g.fillStyle = color;
    for (const [w, l] of [[2.2, h], [1.2, h * 0.55]]) {
      g.globalAlpha = l === h ? 0.9 : 0.6;
      g.beginPath();
      g.moveTo(h, h - l); g.lineTo(h + w, h); g.lineTo(h, h + l); g.lineTo(h - w, h); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(h - l, h); g.lineTo(h, h + w); g.lineTo(h + l, h); g.lineTo(h, h - w); g.closePath(); g.fill();
    }
  } else if (kind === 'petal') {
    const gr = g.createLinearGradient(0, 0, S, S);
    gr.addColorStop(0, '#f1e3ff');
    gr.addColorStop(1, color);
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(h, h, h * 0.9, h * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'lid') {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(h, h, h * 0.95, h * 0.95, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

// 화면 가장자리에 닿은 겹은 바깥으로 조금 늘려 둔다 (늘린 곳은 텍스처 끝 색이 이어짐: CLAMP_TO_EDGE).
// 시차·흔들림으로 겹이 밀려도 화면 끝에 빈틈이 보이지 않아서, 배경을 확대해 가장자리를 잘라 낼 필요가 없다.
// uv 를 위치에서 다시 계산하므로 원래 그림 부분은 늘어나지 않는다
function addSkirt(g, L, W, H, pad) {
  const { positions: p, uvs, cols, rows } = g;
  const left = L.x <= 1;
  const right = L.x + L.w >= W - 1;
  const top = L.y <= 1;
  const bottom = L.y + L.h >= H - 1;
  if (!(left || right || top || bottom)) return;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = 2 * (j * (cols + 1) + i);
      if (left && i === 0) p[k] -= pad;
      if (right && i === cols) p[k] += pad;
      if (top && j === 0) p[k + 1] -= pad;
      if (bottom && j === rows) p[k + 1] += pad;
      uvs[k] = (p[k] - L.x) / L.w;
      uvs[k + 1] = (p[k + 1] - L.y) / L.h;
    }
  }
}

function quad(r, texture) {
  const positions = new Float32Array(8);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const indices = new Uint16Array([0, 2, 1, 1, 2, 3]);
  return r.createMesh(texture, positions, uvs, indices);
}

export class Scene {
  constructor(renderer) {
    this.r = renderer;
    this.layers = [];
    this.lights = [];
    this.textures = [];
    this.meshes = [];
    this.time = 0;
    // 카메라(시차) 상태: 목표를 부드럽게 따라가는 스프링
    this.cam = { x: 0, y: 0, vx: 0, vy: 0 };
    this.view = { cx: 0, cy: 0, scale: 1 };
    // 액자·음악 표시줄에 쓸 글 (스튜디오가 보냄): { notice, song, songLen, chat:[{nick,msg,kind}], frameMode }
    this.text = {};
    this.song = { title: '', start: 0 };
  }

  setText(text) {
    this.text = text ?? {};
    const title = this.text.song ?? '';
    const key = `${title}|${this.text.songSeq ?? 0}`;
    if (key !== this.song.key) this.song = { title, key, start: this.time, since: this.time };
    // 자동(재생 중인 곡): 실제 재생 위치에 맞춘다. 일시 정지면 막대를 멈춘다
    if (typeof this.text.songPos === 'number') {
      this.song.start = this.time - this.text.songPos;
      this.song.paused = this.text.songPlaying === false ? this.text.songPos : null;
    } else {
      this.song.paused = null;
    }
  }

  async load(base) {
    const def = await (await fetch(`${base}/scene.json`, { cache: 'no-store' })).json();
    this.def = def;
    this.W = def.width;
    this.H = def.height;
    const tex = (img) => {
      const t = this.r.createTexture(img);
      this.textures.push(t);
      return t;
    };
    const mesh = (t, g) => {
      const m = this.r.createMesh(t, g.positions, g.uvs, g.indices);
      this.meshes.push(m);
      return m;
    };
    // 음악 표시줄 같은 화면 장식(fixed)과 그 글 자리를 화면 끝에서 조금 안쪽으로 (scene.json 의 hudOffset: [x, y])
    const [hx, hy] = def.hudOffset ?? [0, 0];
    const par = def.parallax ?? 20;
    for (const L0 of def.layers) {
      const L = L0.fixed ? { ...L0, x: L0.x + hx, y: L0.y + hy } : L0;
      const img = await loadImage(`${base}/${L.file}`);
      const animated = (L.sway && L.sway.length) || L.swing;
      const g = gridMesh(L.x, L.y, L.w, L.h, L.name === 'far' ? null : alphaOf(img), animated ? 22 : 48);
      // 가장 많이 밀리는 만큼(카메라 ±1.4 × 시차 × 움직임 최대 2 × 깊이) + 흔들림 여유
      if (!L.fixed) addSkirt(g, L, def.width, def.height, Math.ceil(2.8 * par * (L.depth ?? 0)) + 16);
      const base0 = g.positions.slice();
      // 살랑임 가중치는 정점마다 미리 계산 (영역 안쪽 정도 × 고정점에서 떨어진 정도)
      const sway = (L.sway ?? []).map((s) => {
        const n = base0.length / 2;
        const w = new Float32Array(n);
        const maxd = Math.max(
          Math.hypot(s.x0 - s.ax, s.y0 - s.ay), Math.hypot(s.x1 - s.ax, s.y0 - s.ay),
          Math.hypot(s.x0 - s.ax, s.y1 - s.ay), Math.hypot(s.x1 - s.ax, s.y1 - s.ay),
        );
        const f = s.feather ?? 0;
        for (let i = 0; i < n; i++) {
          const x = base0[2 * i];
          const y = base0[2 * i + 1];
          if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
          const inner = f > 0 ? clamp(Math.min(x - s.x0, s.x1 - x, y - s.y0, s.y1 - y) / f, 0, 1) : 1;
          const dist = clamp(Math.hypot(x - s.ax, y - s.ay) / maxd, 0, 1) ** 1.3;
          w[i] = inner * dist;
        }
        return { ...s, w };
      });
      this.layers.push({ ...L, mesh: mesh(tex(img), g), base0, out: new Float32Array(base0.length), sway });
    }
    // 불빛 (전구·갓 아래 빛·촛불)
    const sprites = {};
    for (const li of def.lights ?? []) {
      if (!sprites[li.sprite]) sprites[li.sprite] = tex(await loadImage(`${base}/${li.sprite}`));
      const m = quad(this.r, sprites[li.sprite]);
      this.meshes.push(m);
      this.lights.push({ ...li, mesh: m, out: new Float32Array(8) });
    }
    // 먼지 알갱이
    const D = def.dust;
    if (D && sprites['glow.png']) {
      const n = D.count;
      const positions = new Float32Array(n * 8);
      const uvs = new Float32Array(n * 8);
      const idx = new Uint16Array(n * 6);
      for (let i = 0; i < n; i++) {
        uvs.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
        idx.set([0, 2, 1, 1, 2, 3].map((v) => v + i * 4), i * 6);
      }
      const m = this.r.createMesh(sprites['glow.png'], positions, uvs, idx);
      this.meshes.push(m);
      // 정해진 씨앗으로 위치·속도를 흩어 둔다 (창을 다시 열어도 같은 모양)
      let s = 12345;
      const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      this.dust = {
        ...D,
        mesh: m,
        out: positions,
        p: Array.from({ length: n }, () => ({
          x: D.x0 + rand() * (D.x1 - D.x0), y: D.y0 + rand() * (D.y1 - D.y0),
          vx: (rand() - 0.5) * 6, vy: -2 - rand() * 5, size: 4 + rand() * 6, seed: rand() * 100,
        })),
      };
    }
    await this.loadExtras(def, base, tex);
    await this.loadFoods(def, base, tex);
    await this.loadProps(def, base, tex);
    // 글 빈칸 (음악 표시줄 글은 표시줄 그림과 같이 hudOffset 만큼 옮김)
    const S = { ...(def.slots ?? {}) };
    if (hx || hy) {
      if (S.songTitle) S.songTitle = { ...S.songTitle, x: S.songTitle.x + hx, y: S.songTitle.y + hy };
      if (S.progress) S.progress = { ...S.progress, x0: S.progress.x0 + hx, x1: S.progress.x1 + hx, y: S.progress.y + hy };
      if (S.note) S.note = { ...S.note, x: S.note.x + hx, y: S.note.y + hy };
    }
    const quadAt = (t) => {
      const m = quad(this.r, t);
      this.meshes.push(m);
      return { mesh: m, out: new Float32Array(8) };
    };
    if (S.frame) {
      const panel = new FramePanel(S.frame);
      panel.draw('notice', '', []);
      this.frame = { panel, ...quadAt(tex(panel.canvas)), slot: S.frame };
    }
    if (S.songTitle) {
      const title = new SongTitle(S.songTitle);
      title.draw('', 0);
      this.songTitle = { title, ...quadAt(tex(title.canvas)), slot: S.songTitle };
    }
    if (S.progress) {
      this.progress = { ...quadAt(tex(barSprite())), slot: S.progress };
      if (sprites['glow.png']) this.progressDot = quadAt(sprites['glow.png']);
    }
    if (S.note && sprites['glow.png']) this.noteGlow = { ...quadAt(sprites['glow.png']), slot: S.note };
    return this;
  }

  // ---- 더 움직이는 배경 (scene.json 에 있을 때만) ----
  // rain: 창문 유리에 내리는 비 · petals: 꽃에서 떨어지는 꽃잎 · glints: 병·유리잔의 반짝임
  // pulses: 보석 장식이 은은하게 빛남 · blinks: 고양이 등이 가끔 눈을 깜빡임
  async loadExtras(def, base, tex) {
    const r = this.r;
    const sprite = {};
    const spriteTex = (kind, color) => (sprite[`${kind}${color}`] ??= tex(procSprite(kind, color)));
    const quadOf = (t) => {
      const m = quad(r, t);
      this.meshes.push(m);
      return { mesh: m, out: new Float32Array(8) };
    };
    // 여러 개를 한 번에 그리는 판 (크기 0 이면 안 보임)
    const batch = (t, n) => {
      const positions = new Float32Array(n * 8);
      const uvs = new Float32Array(n * 8);
      const idx = new Uint16Array(n * 6);
      for (let i = 0; i < n; i++) {
        uvs.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
        idx.set([0, 2, 1, 1, 2, 3].map((v) => v + i * 4), i * 6);
      }
      const m = r.createMesh(t, positions, uvs, idx);
      this.meshes.push(m);
      return { mesh: m, out: positions };
    };
    let s = 777;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);

    const R = def.rain;
    if (R) {
      // 유리 부분만: 먼 겹 그림에서 밝은 보라빛인 곳 (창틀·커튼은 빼고)
      const far = def.layers.find((L) => L.name === 'far');
      const img = await loadImage(`${base}/${far.file}`);
      const mask = document.createElement('canvas');
      mask.width = R.w;
      mask.height = R.h;
      const mctx = mask.getContext('2d');
      mctx.drawImage(img, R.x - far.x, R.y - far.y, R.w, R.h, 0, 0, R.w, R.h);
      const d = mctx.getImageData(0, 0, R.w, R.h);
      for (let i = 0; i < d.data.length; i += 4) {
        const [rr, gg, bb] = [d.data[i], d.data[i + 1], d.data[i + 2]];
        const lum = (rr + gg + bb) / 3;
        const a = clamp((lum - 33) / 12, 0, 1) * (bb >= rr + 3 ? 1 : 0);
        d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
        d.data[i + 3] = a * 255;
      }
      mctx.putImageData(d, 0, 0);
      const canvas = document.createElement('canvas');
      canvas.width = R.w;
      canvas.height = R.h;
      this.rain = {
        ...R, mask, canvas, ctx: canvas.getContext('2d'), ...quadOf(tex(canvas)),
        drops: Array.from({ length: R.count ?? 70 }, () => ({ x: rand() * R.w, y: rand() * R.h, v: 380 + rand() * 260, len: 14 + rand() * 22, a: 0.25 + rand() * 0.45 })),
        beads: Array.from({ length: 6 }, () => ({ x: rand() * R.w, y: rand() * R.h, v: 6 + rand() * 14 })),
      };
    }
    const P = def.petals;
    if (P) {
      this.petals = {
        ...P, ...batch(spriteTex('petal', P.color ?? '#c9a3ff'), P.count),
        p: Array.from({ length: P.count }, () => this.newPetal(P, rand, true)),
        rand,
      };
    }
    const G = def.glints;
    if (G) {
      this.glints = {
        ...G, ...batch(spriteTex('star', G.color ?? '#e6d8ff'), G.points.length),
        p: G.points.map(([x, y]) => ({ x, y, next: rand() * 6, life: 0 })),
        rand,
      };
    }
    this.pulses = (def.pulses ?? []).map((p) => ({ ...p, ...quadOf(spriteTex('glow', p.color ?? '#b47bff')) }));
    this.blinks = (def.blinks ?? []).map((b) => ({ ...b, ...quadOf(spriteTex('lid', b.color ?? '#1b1c1f')) }));
    this.blinkGroups = {};
  }

  // ---- 음식 (scene.json 의 foods, 식탁 배경) ----
  // 고른 음식이 왼쪽 화면 밖에서 미끄러져 들어와 식탁 가운데에 놓이고, 바꾸면 놓였던 음식은 오른쪽으로 치워진다
  async loadFoods(def, base, tex) {
    this.foods = {};
    this.serving = [];
    for (const F of def.foods ?? []) {
      const img = await loadImage(`${base}/${F.file}`);
      const m = quad(this.r, tex(img));
      this.meshes.push(m);
      this.foods[F.name] = { ...F, mesh: m, out: new Float32Array(8) };
    }
  }

  // name: 음식 이름 ('' 이면 빈 식탁). 처음 한 번은 움직임 없이 바로 놓는다 (OBS 화면을 새로 열 때 등)
  setFood(name) {
    if (!this.foods) return;
    const key = this.foods[name] ? name : '';
    if (key === this.foodKey) return;
    const first = this.foodKey === undefined;
    this.foodKey = key;
    for (const s of this.serving) {
      if (s.dir === 'in') Object.assign(s, { dir: 'out', t: 0, from: s.dx, a0: s.a });
    }
    // 치우는 음식과 겹치지 않게 조금 늦게 들어온다
    if (key) this.serving.push({ f: this.foods[key], dir: 'in', t: first ? 1 : this.serving.length ? -0.35 : 0, dx: 0, a: 1 });
  }

  updateFoods(dt, add, shift) {
    const IN = 1.5; // 들어오는 시간(초)
    const OUT = 0.9; // 치우는 시간(초)
    this.serving = this.serving.filter((s) => !(s.dir === 'out' && s.t >= 1));
    for (const s of this.serving) {
      const F = s.f;
      s.t += dt / (s.dir === 'in' ? IN : OUT);
      const p = clamp(s.t, 0, 1);
      // 놓일 자리: 식탁 가운데 (cx 가 있으면 그 x), 높이는 그림 그대로
      const x0 = (F.cx ?? this.W / 2) - F.w / 2;
      let dx = 0;
      let dy = 0;
      let a = 1;
      if (s.dir === 'in') {
        // 왼쪽 화면 밖에서 출발 → 점점 느려지며 멈춤. 들고 오듯 살짝 떴다가 내려앉음
        const start = -(x0 + F.w) - 40;
        const e = 1 - Math.pow(1 - p, 3.2);
        dx = start * (1 - e);
        dy = -12 * Math.sin(Math.PI * Math.min(1, p * 1.08)) ** 2;
        a = clamp(p * 5, 0, 1);
      } else {
        // 오른쪽으로 점점 빨리 밀려 나가고, 끝 무렵에만 흐려짐 (제자리에서 비쳐 보이지 않게)
        const e = p ** 2.2;
        dx = (s.from ?? 0) + (this.W - x0 + 40) * e;
        a = (s.a0 ?? 1) * clamp((1 - p) / 0.35, 0, 1);
      }
      s.dx = dx;
      s.a = a;
      if (a <= 0.001) continue;
      const [sx, sy] = shift(F.depth ?? 0.45);
      const x = x0 + dx + sx;
      const y = F.y + dy + sy;
      F.out.set([x, y, x + F.w, y, x, y + F.h, x + F.w, y + F.h]);
      this.r.updatePositions(F.mesh, F.out);
      // 식탁(깊이 0.45) 바로 위, 앞쪽 잎·촛불 빛보다는 아래
      add((F.depth ?? 0.45) * 10 + 0.05, { mesh: F.mesh, opacity: a, view: this.view });
    }
  }

  // ---- 켜고 끄는 소품 (scene.json 의 props, 예: 바 카운터의 '방송 준비 중' 표지판) ----
  // 켜면 살짝 위에서 내려앉으며 나타나고, 끄면 살짝 떠오르며 사라진다
  async loadProps(def, base, tex) {
    this.props = [];
    this.propsInit = false;
    for (const F of def.props ?? []) {
      const img = await loadImage(`${base}/${F.file}`);
      const m = quad(this.r, tex(img));
      this.meshes.push(m);
      this.props.push({ ...F, mesh: m, out: new Float32Array(8), k: 0, on: false });
    }
  }

  // names: 켤 소품 이름들. 처음 한 번은 움직임 없이 바로 (OBS 화면을 새로 열 때 등)
  setProps(names) {
    if (!this.props) return;
    const on = new Set(names ?? []);
    for (const p of this.props) p.on = on.has(p.name);
    if (!this.propsInit) {
      this.propsInit = true;
      for (const p of this.props) p.k = p.on ? 1 : 0;
    }
  }

  updateProps(dt, add, shift) {
    for (const p of this.props ?? []) {
      const speed = p.on ? 1 / 0.55 : 1 / 0.35;
      p.k = p.on ? Math.min(1, p.k + dt * speed) : Math.max(0, p.k - dt * speed);
      if (p.k <= 0.001) continue;
      const e = 1 - (1 - p.k) ** 3;
      const dy = p.on ? -26 * (1 - e) : -12 * (1 - p.k);
      const a = p.on ? Math.min(1, p.k * 2.5) : p.k;
      const [sx, sy] = shift(p.depth ?? 0.3);
      const x = p.x + sx;
      const y = p.y + dy + sy;
      p.out.set([x, y, x + p.w, y, x, y + p.h, x + p.w, y + p.h]);
      this.r.updatePositions(p.mesh, p.out);
      // 놓인 자리(카운터 등) 바로 위
      add((p.depth ?? 0.3) * 10 + 0.05, { mesh: p.mesh, opacity: a, view: this.view });
    }
  }

  newPetal(P, rand, anywhere = false) {
    return {
      x: P.x0 + rand() * (P.x1 - P.x0),
      y: anywhere ? P.y0 + rand() * (P.y1 + P.fall - P.y0) : P.y0 + rand() * (P.y1 - P.y0),
      vy: 14 + rand() * 18,
      sway: 6 + rand() * 12,
      seed: rand() * 100,
      size: 10 + rand() * 6,
      spin: (rand() - 0.5) * 3,
    };
  }

  updateExtras(t, dt, add, shift, motion) {
    const setQuad = (q, x0, y0, x1, y1) => {
      q.out.set([x0, y0, x1, y0, x0, y1, x1, y1]);
      this.r.updatePositions(q.mesh, q.out);
    };
    // 비: 사선으로 떨어지는 빗줄기 + 천천히 흘러내리는 물방울, 유리 부분만 남기고 텍스처로
    const R = this.rain;
    if (R) {
      const { ctx, canvas } = R;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      for (const d of R.drops) {
        d.y += d.v * dt;
        d.x -= d.v * 0.18 * dt;
        if (d.y - d.len > R.h || d.x < -20) {
          d.y = -Math.random() * 60;
          d.x = Math.random() * (R.w + 60);
        }
        ctx.strokeStyle = `rgba(214, 204, 255, ${d.a})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.len * 0.18, d.y - d.len);
        ctx.stroke();
      }
      for (const b of R.beads) {
        b.y += b.v * dt;
        if (b.y > R.h + 6) {
          b.y = -6;
          b.x = Math.random() * R.w;
        }
        ctx.fillStyle = 'rgba(230, 222, 255, 0.55)';
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, 1.6, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(R.mask, 0, 0);
      this.r.updateTexture(R.mesh.texture, canvas);
      const [sx, sy] = shift(R.depth ?? 0);
      setQuad(R, R.x + sx, R.y + sy, R.x + R.w + sx, R.y + R.h + sy);
      add((R.depth ?? 0) * 10 + 0.2, { mesh: R.mesh, opacity: (R.opacity ?? 0.5) * Math.min(1, motion), view: this.view, additive: true });
    }
    // 꽃잎: 좌우로 살랑이며 천천히 떨어지고, 끝에서 작아지며 사라짐
    const P = this.petals;
    if (P) {
      const [sx, sy] = shift(P.depth ?? 0.1);
      for (let i = 0; i < P.p.length; i++) {
        let p = P.p[i];
        p.y += p.vy * dt;
        const end = P.y1 + P.fall;
        if (p.y > end) p = P.p[i] = this.newPetal(P, P.rand);
        const life = clamp(Math.min((p.y - P.y0) / 40, (end - p.y) / 60), 0, 1);
        const x = p.x + Math.sin(t * 1.3 + p.seed) * p.sway + sx;
        const y = p.y + sy;
        const a = t * p.spin + p.seed;
        const hw = (p.size * life) / 2;
        const hh = hw * 0.62;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const corner = (dx, dy) => [x + dx * c - dy * sn, y + dx * sn + dy * c];
        P.out.set([...corner(-hw, -hh), ...corner(hw, -hh), ...corner(-hw, hh), ...corner(hw, hh)], i * 8);
      }
      this.r.updatePositions(P.mesh, P.out);
      add((P.depth ?? 0.1) * 10 + 0.3, { mesh: P.mesh, opacity: 0.85, view: this.view });
    }
    // 반짝임: 자리마다 가끔 0.7초 동안 커졌다 작아짐
    const G = this.glints;
    if (G) {
      const [sx, sy] = shift(G.depth ?? 0);
      for (let i = 0; i < G.p.length; i++) {
        const p = G.p[i];
        let k = 0;
        if (p.life > 0) {
          p.life -= dt / 0.7;
          k = Math.sin(Math.PI * clamp(1 - p.life, 0, 1));
        } else if ((p.next -= dt) <= 0) {
          p.life = 1;
          p.next = 3 + G.rand() * 9;
        }
        const r = ((G.size ?? 18) * k) / 2;
        const x = p.x + sx;
        const y = p.y + sy;
        G.out.set([x - r, y - r, x + r, y - r, x - r, y + r, x + r, y + r], i * 8);
      }
      this.r.updatePositions(G.mesh, G.out);
      add((G.depth ?? 0) * 10 + 0.55, { mesh: G.mesh, opacity: 0.9, view: this.view, additive: true });
    }
    // 보석 빛: 천천히 숨 쉬듯
    for (const p of this.pulses) {
      const [sx, sy] = shift(p.depth ?? 0);
      const k = 0.5 + 0.5 * Math.sin((TAU * t) / (p.period ?? 4) + (p.phase ?? 0));
      const r = ((p.size ?? 60) * (0.85 + 0.15 * k)) / 2;
      setQuad(p, p.x - r + sx, p.y - r + sy, p.x + r + sx, p.y + r + sy);
      add((p.depth ?? 0) * 10 + 0.5, { mesh: p.mesh, opacity: (p.min ?? 0.12) + ((p.max ?? 0.45) - (p.min ?? 0.12)) * k, view: this.view, additive: true });
    }
    // 깜빡임: 같은 group 은 함께. 눈꺼풀(털 색 타원)이 위에서 내려왔다 올라감 (0.18초)
    for (const b of this.blinks) {
      const key = b.group ?? b.x;
      const g = (this.blinkGroups[key] ??= { next: 2 + Math.random() * 4, phase: -1 });
      if (b === this.blinks.find((o) => (o.group ?? o.x) === key)) {
        if (g.phase < 0 && (g.next -= dt) <= 0) g.phase = 0;
        if (g.phase >= 0) {
          g.phase += dt / 0.18;
          if (g.phase >= 1) {
            g.phase = -1;
            g.next = 2.5 + Math.random() * 5;
            if (Math.random() < 0.2) g.next = 0.3; // 가끔 두 번
          }
        }
      }
      if (g.phase < 0) continue;
      const close = Math.sin(Math.PI * g.phase);
      const [sx, sy] = shift(b.depth ?? 0);
      const top = b.y - b.h / 2;
      setQuad(b, b.x - b.w / 2 + sx, top + sy, b.x + b.w / 2 + sx, top + b.h * Math.max(0.05, close) + sy);
      add((b.depth ?? 0) * 10 + 0.45, { mesh: b.mesh, opacity: 1, view: this.view });
    }
  }

  dispose() {
    for (const m of this.meshes) this.r.deleteMesh(m);
    for (const t of this.textures) this.r.deleteTexture(t);
    this.meshes = [];
    this.textures = [];
  }

  // 배경을 화면에 맞춘다. 확대하지 않아 배경 끝(음악 표시줄·액자)까지 그대로 보인다
  // (겹이 밀려도 빈틈이 안 보이는 것은 addSkirt 가 맡음).
  // fitMode: 'cover'(화면을 빈틈없이, 비율이 다르면 남는 쪽은 잘림) · 'auto'(화면 비율이 배경과 많이 다르면 — 예: OBS 기본 800×600 —
  // 잘리지 않게 배경 전체를 보여 줌, 남는 곳은 투명) · 'contain'
  fit() {
    const c = this.r.canvas;
    const W = c.width || 1;
    const H = c.height || 1;
    const off = Math.abs(Math.log(W / H / (this.W / this.H)));
    const contain = this.fitMode === 'contain' || (this.fitMode === 'auto' && off > 0.06);
    const k = contain ? Math.min(W / this.W, H / this.H) : Math.max(W / this.W, H / this.H);
    this.view = { cx: this.W / 2, cy: this.H / 2, scale: k };
    // 배경 전체를 보여 줄 때는 배경 바깥(투명하게 남는 곳)에 늘린 가장자리·불빛이 비치지 않게 자른다 (화면 px)
    const hw = (this.W * k) / 2;
    const hh = (this.H * k) / 2;
    this.clip = contain ? { x0: W / 2 - hw, y0: H / 2 - hh, x1: W / 2 + hw, y1: H / 2 + hh } : null;
  }

  // P: 아바타 파라미터 (angleX/Y, bodyX 등), motion: 움직임 크기 배율 (0 이면 시차·흔들림 없음)
  update(dt, P, motion = 1) {
    this.time += dt;
    const t = this.time;
    this.fit();
    // ---- 카메라: 아바타가 움직이는 쪽으로 살짝 따라가고, 가만히 있어도 아주 느리게 떠다님 ----
    const tx = clamp((P.angleX ?? 0) / 30 * 0.55 + (P.bodyX ?? 0) / 10 * 0.45, -1, 1) + Math.sin(t * 0.13) * 0.22 + Math.sin(t * 0.051 + 2) * 0.12;
    const ty = clamp(-(P.angleY ?? 0) / 30 * 0.45, -1, 1) + Math.sin(t * 0.093 + 1) * 0.16;
    const c = this.cam;
    const w = 2.2; // 반응 속도 (낮을수록 묵직)
    const step = Math.min(dt, 0.05);
    c.vx += (w * w * (tx - c.x) - 2 * w * c.vx) * step;
    c.vy += (w * w * (ty - c.y) - 2 * w * c.vy) * step;
    c.x += c.vx * step;
    c.y += c.vy * step;
    const par = (this.def.parallax ?? 20) * motion;
    const shift = (depth) => [-c.x * par * depth, -c.y * par * depth * 0.6];
    this.shift = shift; // 아바타 자리 계산(avatarView)에도 같은 시차를 쓴다

    // 그리는 순서: 깊이 순. 불빛·먼지는 같은 깊이의 겹 바로 앞, 화면 장식(fixed)은 맨 위
    const entries = [];
    const add = (key, item) => entries.push({ key, item, n: entries.length });
    const swings = {};
    for (const L of this.layers) {
      const b = L.base0;
      const o = L.out;
      const [sx, sy] = L.fixed ? [0, 0] : shift(L.depth ?? 0);
      let rot = null;
      if (L.swing && motion > 0) {
        const s = L.swing;
        const a = (s.amp * Math.PI / 180) * motion * (Math.sin((TAU * t) / s.period + s.phase) + 0.18 * Math.sin((TAU * t) / (s.period * 0.47) + s.phase * 2.3));
        rot = { px: s.px, py: s.py, c: Math.cos(a), s: Math.sin(a) };
      }
      swings[L.name] = { rot, sx, sy };
      for (let i = 0; i < b.length; i += 2) {
        let x = b[i];
        let y = b[i + 1];
        if (rot) {
          const dx = x - rot.px;
          const dy = y - rot.py;
          x = rot.px + dx * rot.c - dy * rot.s;
          y = rot.py + dx * rot.s + dy * rot.c;
        }
        o[i] = x + sx;
        o[i + 1] = y + sy;
      }
      if (motion > 0) {
        for (const s of L.sway) {
          const ph = (TAU * t) / s.period + s.phase;
          for (let i = 0, n = s.w.length; i < n; i++) {
            const wv = s.w[i];
            if (wv === 0) continue;
            // 위아래 위치에 따라 박자를 조금씩 늦춰 물결처럼
            const yv = b[2 * i + 1];
            const k = Math.sin(ph - yv * 0.004) + 0.3 * Math.sin(ph * 1.9 + yv * 0.002 + s.phase);
            o[2 * i] += s.amp * motion * wv * k;
            o[2 * i + 1] -= Math.abs(s.amp * motion * wv * k) * 0.12;
          }
        }
      }
      this.r.updatePositions(L.mesh, o);
      // z: 그리는 순서를 따로 정한 겹 (예: 액자 장식은 액자 글 0.4 보다 위 0.45)
      add(L.fixed ? 1e9 : L.z ?? (L.depth ?? 0) * 10, { mesh: L.mesh, opacity: 1, view: this.view });
    }

    // ---- 불빛 ----
    for (const li of this.lights) {
      const flick = 1 - li.flicker * (0.5 + 0.5 * wobble(t, li.seed, li.fast));
      const att = li.attach ? swings[li.attach] : null;
      const hw = li.w / 2;
      const top = li.anchorY === 0 ? 0 : -li.h / 2; // 0 이면 (x, y) 가 위 가운데
      const pts = [[-hw, top], [hw, top], [-hw, top + li.h], [hw, top + li.h]];
      const [dsx, dsy] = att ? [att.sx, att.sy] : shift(li.depth ?? 0);
      for (let k = 0; k < 4; k++) {
        let x = li.x + pts[k][0];
        let y = li.y + pts[k][1];
        if (att?.rot) {
          const r = att.rot;
          const dx = x - r.px;
          const dy = y - r.py;
          x = r.px + dx * r.c - dy * r.s;
          y = r.py + dx * r.s + dy * r.c;
        }
        li.out[2 * k] = x + dsx;
        li.out[2 * k + 1] = y + dsy;
      }
      this.r.updatePositions(li.mesh, li.out);
      const depth = li.attach ? (this.layers.find((L) => L.name === li.attach)?.depth ?? 0) : (li.depth ?? 0);
      add(depth * 10 + 0.5, { mesh: li.mesh, opacity: li.opacity * flick, view: this.view, additive: true });
    }

    // ---- 먼지 ----
    const D = this.dust;
    if (D && motion > 0) {
      const [dsx, dsy] = shift(D.depth ?? 0.2);
      for (let i = 0; i < D.p.length; i++) {
        const p = D.p[i];
        p.x += (p.vx + Math.sin(t * 0.7 + p.seed) * 4) * dt;
        p.y += p.vy * dt;
        if (p.y < D.y0) p.y = D.y1;
        if (p.x < D.x0) p.x = D.x1;
        if (p.x > D.x1) p.x = D.x0;
        // 반짝임은 크기로 (한 번에 그리므로 알갱이마다 투명도를 따로 줄 수 없음)
        const r = (p.size * (0.55 + 0.45 * Math.sin(t * 1.3 + p.seed))) / 2;
        const x = p.x + dsx;
        const y = p.y + dsy;
        D.out.set([x - r, y - r, x + r, y - r, x - r, y + r, x + r, y + r], i * 8);
      }
      this.r.updatePositions(D.mesh, D.out);
      add((D.depth ?? 0.2) * 10 + 0.5, { mesh: D.mesh, opacity: 0.35 * motion, view: this.view, additive: true });
    }
    if (motion > 0) this.updateExtras(t, dt, add, shift, motion);
    this.updateFoods(dt, add, shift);
    this.updateProps(dt, add, shift);
    this.updateText(t, add, shift);
    entries.sort((a, b) => a.key - b.key || a.n - b.n);
    // 아바타가 들어갈 깊이(scene.json 의 avatar.depth)보다 뒤 / 앞으로 나눈다 (예: 바 뒤에 선 바텐더)
    const cut = this.def.avatar ? (this.def.avatar.depth ?? 0.25) * 10 : Infinity;
    return {
      back: entries.filter((e) => e.key < cut).map((e) => e.item),
      front: entries.filter((e) => e.key >= cut).map((e) => e.item),
    };
  }

  // 아바타를 배경 속 자리에 놓는 화면 변환 (scene.json 의 avatar: 머리 가운데가 (x, y), 모델 1px = scale 배경 px).
  // view.avScale · avX · avY 로 크기·위치를 조금씩 옮긴다. 자리가 없는 배경이면 null (화면 기준 위치를 씀)
  avatarView(model, view) {
    const A = this.def.avatar;
    const H = model.rig?.head;
    if (!A || !H || !this.shift) return null;
    const k = A.scale * (view.avScale ?? 1);
    const [sx, sy] = this.shift(A.depth ?? 0.25);
    const ax = A.x + (view.avX ?? 0) * this.W + sx;
    const ay = A.y + (view.avY ?? 0) * this.H + sy;
    const sv = this.view;
    return { cx: H.cx - (ax - sv.cx) / k, cy: H.cy - (ay - sv.cy) / k, scale: k * sv.scale };
  }

  // 액자(공지·최근 채팅)와 음악 표시줄(곡 제목·재생 막대·음표 빛)
  updateText(t, add, shift) {
    const T = this.text;
    const setQuad = (q, x0, y0, x1, y1) => {
      q.out.set([x0, y0, x1, y0, x0, y1, x1, y1]);
      this.r.updatePositions(q.mesh, q.out);
    };
    if (this.frame) {
      const chat = T.chat ?? [];
      const hasNotice = !!(T.notice && T.notice.trim());
      const mode = T.frameMode || 'auto';
      let show = mode === 'chat' ? 'chat' : mode === 'both' ? 'both' : 'notice';
      if (mode === 'auto') {
        // 번갈아: 20초마다 바꾸되, 한쪽이 비어 있으면 다른 쪽만
        if (!chat.length) show = 'notice';
        else if (!hasNotice) show = 'chat';
        else show = Math.floor(t / 20) % 2 ? 'chat' : 'notice';
      }
      // 함께: 공지가 비어 있으면 채팅만
      if (show === 'both' && !hasNotice) show = 'chat';
      const f = this.frame;
      if (f.panel.draw(show, T.notice ?? '', chat.slice(-10))) this.r.updateTexture(f.mesh.texture, f.panel.canvas);
      const [sx, sy] = shift(0);
      const s = f.slot;
      setQuad(f, s.x + sx, s.y + sy, s.x + s.w + sx, s.y + s.h + sy);
      add(0.4, { mesh: f.mesh, opacity: 1, view: this.view });
    }
    const playing = !!this.song.title;
    if (this.songTitle) {
      const q = this.songTitle;
      if (q.title.draw(this.song.title, t - this.song.since, T.songArtist ?? '')) this.r.updateTexture(q.mesh.texture, q.title.canvas);
      const s = q.slot;
      setQuad(q, s.x, s.y, s.x + s.w, s.y + s.h);
      add(1e9 + 1, { mesh: q.mesh, opacity: 1, view: this.view });
    }
    // 곡 길이: 자동이면 실제 길이 (모르면 막대 없음), 직접 입력이면 정해 둔 길이로 반복
    const auto = typeof T.songPos === 'number';
    const len = auto ? T.songLen || 0 : Math.max(30, T.songLen || 210);
    if (playing && this.progress && len > 0) {
      const elapsed = this.song.paused ?? t - this.song.start;
      const p = auto ? clamp(elapsed / len, 0, 1) : (elapsed / len) % 1;
      const s = this.progress.slot;
      const x = s.x0 + (s.x1 - s.x0) * p;
      setQuad(this.progress, s.x0, s.y - 5, x, s.y + 5);
      add(1e9 + 2, { mesh: this.progress.mesh, opacity: 0.9, view: this.view, additive: true });
      if (this.progressDot) {
        const r = 9 + Math.sin(t * 3) * 1.5;
        setQuad(this.progressDot, x - r, s.y - r, x + r, s.y + r);
        add(1e9 + 3, { mesh: this.progressDot.mesh, opacity: 0.9, view: this.view, additive: true });
      }
    }
    if (playing && this.noteGlow && this.song.paused == null) {
      // 음표가 박자에 맞춰 은은하게 빛남 (약 100 BPM)
      const beat = Math.pow(0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 1.65), 3);
      const s = this.noteGlow.slot;
      const r = 52 + beat * 8;
      setQuad(this.noteGlow, s.x - r, s.y - r, s.x + r, s.y + r);
      add(1e9 + 2, { mesh: this.noteGlow.mesh, opacity: 0.16 + 0.24 * beat, view: this.view, additive: true });
    }
  }
}
