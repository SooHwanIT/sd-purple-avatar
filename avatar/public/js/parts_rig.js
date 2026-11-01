// 파츠 트리 모델(model.json 의 type: "parts") 리깅 런타임 — build_parts_model.py 결과를 움직인다.
// 파츠(L3)마다 알파를 따라 자른 격자 메쉬를 만들고, 매 프레임 정점을 계산한다:
//  1) 파츠 안쪽 변형: 눈 깜빡임(위 눈꺼풀이 아래 눈꺼풀 쪽으로 눌림 → 감은 눈 그림으로 바뀜), 눈동자 이동(안구 위라서 가장자리로 갈수록
//     가로로 납작해지고 두 눈이 같은 선에서 함께 움직임), 입 벌림(벌린 입 세트가 위 입술 기준으로 아래로 열림), 눈썹 오르내림
//  2) 머리 변환: 머리 타원체 위 깊이(z)만큼 밀리는 시차(고개 좌우·위아래) + 목을 중심으로 기울기 — 뒷머리는 반대로 밀림
//  3) 물리: 머리 덩어리마다 다발 사슬 여러 개(StrandSet), 귀걸이·펜던트·브로치·허리띠 끝자락·목걸이·소매 진자
//  4) 몸 변환: 엉덩이 쪽을 중심으로 기울기·좌우 이동, 숨쉬기, 몸을 돌리면 겹마다 시차
// 기존 Avatar(rig.js)와 같은 겉모습(load·update·setTuning·t·parts·hidden …)이라 무대·스튜디오·OBS 가 그대로 쓴다.
import { StrandSet, hangingWeight } from './strands.js';
import { DEFAULT_TUNING } from './rig.js';
import { facePose, deformArticulatedMouth } from './face_performance.js';
import { neckAttachmentWeight } from './overlap.js';
import { textureUrl } from './model_sync.js';
import { springStep } from './spring.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// 머리 단면(세로 원기둥) 깊이 0~1: 얼굴 안쪽(|u|≤0.8)은 원(√(1-u²)) 그대로, 그 바깥은 기울기가 이어지게 부드럽게 줄어 |u|=1.5 에서 0.
// 원 그대로 쓰면 |u|=1 에서 깊이가 뚝 끊겨 머리 옆 가장자리 머리카락이 고개를 돌리는 도중 접히듯 찌그러짐.
const softSphere = (u) => {
  const a = Math.abs(u);
  if (a <= 0.8) return Math.sqrt(1 - a * a);
  if (a >= 1.5) return 0;
  const s = (a - 0.8) / 0.7;
  const h00 = 2 * s * s * s - 3 * s * s + 1;
  const h10 = s * s * s - 2 * s * s + s;
  return 0.6 * h00 - (0.8 / 0.6) * 0.7 * h10;
};

export const PARTS_TUNING = {
  ...DEFAULT_TUNING,
  cell: 14, // 메쉬 칸 크기 (모델 px)
  motionPresence: 1,
  facePresence: 1,
  headDepth: 0.55,
  yawScale: 0.75,
  pitchScale: 0.55,
  irisAngle: 38, // 눈동자를 끝까지 돌렸을 때 안구 회전각 (도)
  irisRange: 0.6, // 눈동자 이동량 (흰자 너비의 절반 대비) — 시선 그림(07·08)에서 잰 양에 맞춤
  hlFollow: 0.92, // 하이라이트가 눈동자를 따라가는 정도 — 시선 그림(07·08)에서 하이라이트가 눈동자에 붙어 있음
  farEyeSquash: 0.18, // 고개를 돌리면 먼 쪽 눈이 가로로 줄어드는 정도
  browRange: 10,
};

// 옷 겹 2차 움직임: 겹의 고정점(어깨·넥타이 매듭·허리띠)이 움직이면 옷자락이 조금 늦게 따라오고(용수철),
// 몸이 기울면 옷자락은 늦게·덜 기울어(아래로 늘어짐) 출렁임 → 몸과 옷이 한 덩어리로 움직이지 않음
const softClamp = (v, m) => (m > 0 ? m * Math.tanh(v / m) : 0);
export class ClothLag {
  constructor(c) {
    this.c = c;
    this.reset();
  }

  reset() {
    this.m = null;
    this.ox = 0;
    this.oy = 0;
    this.dr = 0;
    this.ripple = this.rippleV = 0;
    this.rippleTarget = null;
    this.target = null;
  }

  // (tx, ty) 고정점 자리, rollT 옷자락이 가려는 기울기, roll 몸 기울기
  step(tx, ty, rollT, roll, dt) {
    const c = this.c;
    if (!this.m) {
      this.m = [tx, ty];
      this.v = [0, 0];
      this.r = rollT;
      this.vr = 0;
    }
    const W = 2 * Math.PI * (c.freq ?? 1.8);
    const z = c.zeta ?? 0.35;
    let left = clamp(dt, 0, 0.1);
    if (c.smoothDynamics && left > 0) {
      const previous = this.target ?? [tx, ty, rollT];
      const x = { x: this.m[0], v: this.v[0] }, y = { x: this.m[1], v: this.v[1] }, r = { x: this.r, v: this.vr };
      springStep(x, tx, left, c.freq ?? 1.8, z, previous[0]);
      springStep(y, ty, left, c.freq ?? 1.8, z, previous[1]);
      springStep(r, rollT, left, c.freq ?? 1.8, z, previous[2]);
      this.m[0] = x.x; this.m[1] = y.x; this.v[0] = x.v; this.v[1] = y.v; this.r = r.x; this.vr = r.v;
      if (c.rippleMax) {
        const target = softClamp((tx - x.x) * .3 + (rollT - roll) * 90, c.rippleMax);
        const ripple = { x: this.ripple, v: this.rippleV };
        springStep(ripple, target, left, c.rippleFreq ?? 2.4, .55, this.rippleTarget ?? target);
        this.ripple = ripple.x; this.rippleV = ripple.v; this.rippleTarget = target;
      }
      this.target = [tx, ty, rollT];
      left = 0;
    }
    while (left > 1e-6) {
      const h = Math.min(1 / 120, left);
      left -= h;
      this.v[0] += (W * W * (tx - this.m[0]) - 2 * z * W * this.v[0]) * h;
      this.v[1] += (W * W * (ty - this.m[1]) - 2 * z * W * this.v[1]) * h;
      this.m[0] += this.v[0] * h;
      this.m[1] += this.v[1] * h;
      this.vr += (W * W * (rollT - this.r) - 2 * z * W * this.vr) * h;
      this.r += this.vr * h;
      if (c.rippleMax) {
        const target = softClamp((tx - this.m[0]) * 0.3 + (rollT - roll) * 90, c.rippleMax);
        const rw = 2 * Math.PI * (c.rippleFreq ?? 2.4);
        this.rippleV += (rw * rw * (target - this.ripple) - 0.9 * rw * this.rippleV) * h;
        this.ripple += this.rippleV * h;
      }
    }
    const g = c.gain ?? 1;
    const mo = c.maxOff ?? 12;
    this.ox = softClamp((this.m[0] - tx) * g, mo);
    this.oy = softClamp((this.m[1] - ty) * g * 0.5, mo * 0.5);
    this.dr = softClamp((this.r - roll) * g, (c.maxRot ?? 0.03) * Math.max(1, c.gravity ?? 1));
  }
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`이미지를 불러오지 못했습니다: ${url}`));
    img.src = url;
  });
}

function readAlpha(img, width = img.naturalWidth, height = img.naturalHeight) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

// 알파가 있는 칸만 남긴 격자 메쉬 (칸 하나 = 사각형 2개). 정점은 모델 px.
function gridMesh(alpha, ox, oy, cell) {
  const w = alpha.width;
  const h = alpha.height;
  const nx = Math.max(1, Math.ceil(w / cell));
  const ny = Math.max(1, Math.ceil(h / cell));
  const sx = w / nx;
  const sy = h / ny;
  const on = new Uint8Array(nx * ny);
  const d = alpha.data;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = Math.floor(i * sx);
      const x1 = Math.min(w, Math.ceil((i + 1) * sx));
      const y0 = Math.floor(j * sy);
      const y1 = Math.min(h, Math.ceil((j + 1) * sy));
      let hit = 0;
      for (let y = y0; y < y1 && !hit; y += 2) for (let x = x0; x < x1; x += 2) if (d[(y * w + x) * 4 + 3] > 3) { hit = 1; break; }
      on[j * nx + i] = hit;
    }
  }
  // 이웃 한 칸까지 넓혀 가장자리 반투명이 잘리지 않게
  const on2 = on.slice();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (on[j * nx + i]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di;
      const b = j + dj;
      if (a >= 0 && b >= 0 && a < nx && b < ny && on[b * nx + a]) on2[j * nx + i] = 1;
    }
  }
  const vid = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const pos = [];
  const uv = [];
  const idx = [];
  const v = (i, j) => {
    const k = j * (nx + 1) + i;
    if (vid[k] < 0) {
      vid[k] = pos.length / 2;
      pos.push(ox + i * sx, oy + j * sy);
      uv.push((i * sx) / w, (j * sy) / h);
    }
    return vid[k];
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!on2[j * nx + i]) continue;
    const a = v(i, j);
    const b = v(i + 1, j);
    const c = v(i, j + 1);
    const e = v(i + 1, j + 1);
    idx.push(a, b, c, b, e, c);
  }
  const n = pos.length / 2;
  return {
    pos: new Float32Array(pos),
    uv: new Float32Array(uv),
    idx: n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
  };
}

export class PartsAvatar {
  constructor(renderer, model, tuning = {}) {
    this.r = renderer;
    this.model = model;
    this.rig = model.rig;
    this.t = { ...PARTS_TUNING, ...tuning };
    this.parts = [];
    this.byName = {};
    this.hidden = new Set();
    this.sets = [];
    this.time = 0;
    this.isParts = true;
  }

  // 메쉬 칸 크기: 곡면으로 크게 휘는 눈·입·얼굴선·코는 촘촘하게(5~6px), 피부·목은 중간, 나머지는 기본
  cellFor(d) {
    const g = d.group ?? '';
    const n = d.name ?? '';
    if (g.startsWith('Eye') || g.startsWith('Brow') || g.startsWith('Tear')) return 5;
    if (g.startsWith('Mouth') || g === 'Nose' || n.startsWith('FaceLine') || n.startsWith('Crease') || n.startsWith('Lip')) return 6;
    if (g === 'Face_Base' || g === 'Neck_Part' || d.l1 === 'Neck') return 9;
    // 받침판·채움 층(대부분 가려져 있음)은 성기게
    if (/Backing|Ghost/.test(n)) return 26;
    return this.t.cell;
  }

  async load(base) {
    const defs = this.rig.parts;
    const imgs = await Promise.all(defs.map((d) => loadImage(textureUrl(base, d.textureFile ?? d.file, this.rig.assetRevision))));
    defs.forEach((d, i) => {
      const img = imgs[i];
      const tex = this.r.createTexture(img);
      // Texture resolution is independent of the rig's logical coordinates.
      const al = d.textureFile ? readAlpha(img, d.w, d.h) : readAlpha(img);
      const g = gridMesh(al, d.x, d.y, this.cellFor(d));
      const mesh = this.r.createMesh(tex, g.pos.slice(), g.uv, g.idx);
      let h = 0;
      for (const ch of d.name) h = (h * 31 + ch.charCodeAt(0)) % 9973;
      const p = { ...d, tag: d.name, mesh, idx: g.idx, rest: g.pos, local: new Float32Array(g.pos.length), base: new Float32Array(g.pos.length),
                  out: new Float32Array(g.pos.length), opacity: d.hidden ? 0 : 1, phase: (h / 9973) * Math.PI * 2 };
      if (this.rig.faceProfile && d.name === 'MouthOpen_Inner') {
        const top = new Float32Array(al.width), bottom = new Float32Array(al.width);
        for (let x = 0; x < al.width; x++) {
          let lo = al.height, hi = -1;
          for (let y = 0; y < al.height; y++) if (al.data[(y * al.width + x) * 4 + 3] > 64) { lo = Math.min(lo, y); hi = y; }
          top[x] = d.y + (hi < 0 ? al.height / 2 : lo);
          bottom[x] = d.y + (hi < 0 ? al.height / 2 : hi + 1);
        }
        this.mouthShape = { x: d.x, top, bottom };
      }
      if (this.rig.faceProfile && /^Lip(Upper|Lower)[RCL]$/.test(d.name)) {
        const line = new Float32Array(al.width);
        for (let x = 0; x < al.width; x++) {
          let sum = 0, weight = 0;
          for (let y = 0; y < al.height; y++) {
            const k = (y * al.width + x) * 4, lum = (al.data[k] + al.data[k + 1] + al.data[k + 2]) / 3;
            const w = al.data[k + 3] * Math.max(.01, (190 - lum) / 190) ** 2;
            sum += y * w; weight += w;
          }
          line[x] = d.y + (weight ? sum / weight : al.height / 2);
        }
        p.lipBaseline = line;
      }
      this.parts.push(p);
      this.byName[d.name] = p;
    });
    this.parts.sort((a, b) => a.z - b.z);
    this.hasSmileEye = this.parts.some(p => p.group === 'Eye_Smile');
    this.makeCloth();
    this.prepArms();
    this.makeStrandSets();
    // 표정: rig.expressions[이름].group = 덧그림 묶음 (P.ex_<이름> 0~1 로 나타남)
    if (this.rig.groupKeys) {
      this.t.farEyeSquash = 0; // 원기둥 회전이 먼 쪽을 이미 좁힘
      this.t.yawScale = 0.9; // 고개 좌우 30 ≈ 그림의 3/4 옆모습 (약 27°)
    }
    this.expressions = this.rig.expressions ?? {};
    this.exprOfGroup = {};
    for (const [n, ex] of Object.entries(this.expressions)) if (ex.group) this.exprOfGroup[ex.group] = n;
    // 표정 그림이 어떤 기본 파츠를 대신하는지 (눈·눈썹 좌우, 입) — 표정이 나오면 그 기본 파츠는 숨겨야 겹쳐 보이지 않음
    this.exprParts = {};
    for (const p of this.parts) {
      const n = this.exprOfGroup[p.group];
      if (!n) continue;
      const e = (this.exprParts[p.group] ??= { name: n });
      const side = p.name.endsWith('L') ? 'L' : p.name.endsWith('R') ? 'R' : null;
      p.exprRole = /Eye/.test(p.name) && side ? `eye${side}` : /Brow/.test(p.name) && side ? `brow${side}` : /Mouth/.test(p.name) ? 'mouth' : 'other';
      e[p.exprRole] = true;
    }
    if (this.rig.warpKeys) this.prepWarp(); // 표정 파츠 역할(exprRole)을 정한 뒤에
  }

  // 그림 기반 변형 키(warpKeys): 받은 방향 그림에서 만든 매끈한 변형 격자. 정점마다 격자를 읽어 옮긴다.
  // 눈·눈썹·코·입·귀·장신구는 묶음마다 격자를 어파인 하나로 맞춰 '통째로' 옮김 → 모양이 뭉개지지 않음
  prepWarp() {
    const W = this.rig.warpKeys;
    const f = {};
    for (const [k, v] of Object.entries(W.keys)) f[k] = { dx: Float32Array.from(v.dx), dy: Float32Array.from(v.dy) };
    // 머리카락용: 변형 격자를 크게 흐려 씀 → 가닥이 한쪽만 늘어나거나 눌리지 않고 머리 덩어리째 매끈하게 움직임
    const blur = (arr, nx, ny, sig) => {
      const r = Math.ceil(sig * 2.5);
      const wts = [];
      for (let i = -r; i <= r; i++) wts.push(Math.exp(-(i * i) / (2 * sig * sig)));
      const tmp = new Float32Array(arr.length);
      const out = new Float32Array(arr.length);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let s0 = 0, w0 = 0;
        for (let d = -r; d <= r; d++) { const ii = i + d; if (ii < 0 || ii >= nx) continue; s0 += arr[j * nx + ii] * wts[d + r]; w0 += wts[d + r]; }
        tmp[j * nx + i] = s0 / w0;
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let s0 = 0, w0 = 0;
        for (let d = -r; d <= r; d++) { const jj = j + d; if (jj < 0 || jj >= ny) continue; s0 += tmp[jj * nx + i] * wts[d + r]; w0 += wts[d + r]; }
        out[j * nx + i] = s0 / w0;
      }
      return out;
    };
    const fs = {};
    const hairBlur = this.t.hairWarpBlur ?? this.rig.hairWarpBlur ?? 3;
    for (const [k, v] of Object.entries(f)) fs[k] = { dx: blur(v.dx, W.nx, W.ny, hairBlur), dy: blur(v.dy, W.nx, W.ny, hairBlur) };
    this.WK = { ...W, f, fs };
    const rigidKey = (p) => {
      if (p.rigid) return p.rigid; // 모델이 정한 '통째로 움직이는' 묶음 (장신구 등)
      const g = p.group;
      const side = p.name.endsWith('L') ? 'L' : p.name.endsWith('R') ? 'R' : '';
      if (g === 'Eye_Closed') return 'Eye_' + side;
      if (/^(Eye_|EyeFX_|Tear_)/.test(g)) return 'Eye_' + g.slice(-1);
      if (/^(Brow_|Ear_)/.test(g)) return g;
      if (g === 'EarAcc_L') return 'EarAcc_L'; // 귀걸이: 늘이지 않고 통째로 옮기기만
      if (g === 'Nose' || g === 'Hairpin') return g;
      if (g === 'Mouth' || g === 'Mouth_Open') return 'Mouth';
      if (p.exprRole === 'eyeL' || p.exprRole === 'eyeR') return 'Eye_' + p.exprRole.slice(-1);
      if (p.exprRole === 'browL' || p.exprRole === 'browR') return 'Brow_' + p.exprRole.slice(-1);
      if (p.exprRole === 'mouth') return 'Mouth';
      return null;
    };
    const pts = {};
    for (const p of this.parts) {
      if (p.role !== 'head') continue;
      p.rigidKey = rigidKey(p) ?? (/^Hair/.test(p.l1 ?? '') || p.name.startsWith('HairShade') || p.name.startsWith('HairShadow') ? '~hair' : null);
      if (p.rigidKey === '~hair') continue;
      if (!p.rigidKey || p.hidden || p.fx || p.mask || /^Expr_/.test(p.group)) continue;
      const arr = (pts[p.rigidKey] ??= []);
      for (let i = 0; i < p.rest.length; i += 2) arr.push(p.rest[i], p.rest[i + 1]);
    }
    // 묶음마다, 키마다: 변위 = a·x + b·y + c (가로·세로 각각) 최소제곱
    const tmp = new Float32Array(2);
    this.WKaff = {};
    for (const [rk, arr] of Object.entries(pts)) {
      const n = arr.length / 2;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < n; i++) {
        mx += arr[2 * i];
        my += arr[2 * i + 1];
      }
      mx /= n;
      my /= n;
      this.WKaff[rk] = {};
      for (const k of Object.keys(f)) {
        let sxx = 0, sxy = 0, syy = 0, sdx = 0, sdy = 0, sxdx = 0, sydx = 0, sxdy = 0, sydy = 0;
        for (let i = 0; i < n; i++) {
          const x = arr[2 * i] - mx;
          const y = arr[2 * i + 1] - my;
          this.sampleWarp(k, arr[2 * i], arr[2 * i + 1], tmp);
          sxx += x * x; sxy += x * y; syy += y * y;
          sdx += tmp[0]; sdy += tmp[1];
          sxdx += x * tmp[0]; sydx += y * tmp[0]; sxdy += x * tmp[1]; sydy += y * tmp[1];
        }
        const det = sxx * syy - sxy * sxy || 1;
        let a = (sxdx * syy - sydx * sxy) / det;
        let b = (sydx * sxx - sxdx * sxy) / det;
        let d = (sxdy * syy - sydy * sxy) / det;
        let e = (sydy * sxx - sxdy * sxy) / det;
        // 모양 지키기: 가로는 0.7~1.1배, 세로는 0.85~1.1배, 기울임은 조금만. 장신구는 옮기기만
        if (rk === 'EarAcc_L' || rk === 'Hairpin' || (this.rig.rigidTranslate ?? []).includes(rk)) {
          a = b = d = e = 0;
        } else {
          a = clamp(a, -0.3, 0.1);
          e = clamp(e, -0.15, 0.1);
          b = clamp(b, -0.12, 0.12);
          d = clamp(d, -0.12, 0.12);
        }
        // 변위(x,y) = a(x-mx) + b(y-my) + 평균
        this.WKaff[rk][k] = [a, b, sdx / n - a * mx - b * my, d, e, sdy / n - d * mx - e * my];
      }
    }
  }

  sampleWarp(k, x, y, out, smoothF = false) {
    const W = this.WK;
    const F = (smoothF ? W.fs : W.f)[k];
    if (!F) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    const gx = clamp((x - W.box[0]) / W.step, 0, W.nx - 1.001);
    const gy = clamp((y - W.box[1]) / W.step, 0, W.ny - 1.001);
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const a = j * W.nx + i;
    const b = a + W.nx;
    out[0] = (F.dx[a] * (1 - fx) + F.dx[a + 1] * fx) * (1 - fy) + (F.dx[b] * (1 - fx) + F.dx[b + 1] * fx) * fy;
    out[1] = (F.dy[a] * (1 - fx) + F.dy[a + 1] * fx) * (1 - fy) + (F.dy[b] * (1 - fx) + F.dy[b + 1] * fx) * fy;
  }

  // 물리 묶음 만들기 (조정값이 바뀌면 다시)
  makeStrandSets() {
    const t = this.t;
    const gk = this.gravityK();
    this.sets = (this.rig.sets ?? []).map((def0) => {
      // 중력: 사슬 끝이 고개·몸 회전을 덜 따라가고 아래로 남는 정도(hang)를 키움
      const def = gk === 1 ? def0 : { ...def0, chains: def0.chains.map((c) => ({ ...c, hang: clamp((c.hang ?? 0.35) * gk, 0, 0.97) })) };
      const set = new StrandSet(def, { freq: t.strandFreq, damping: t.strandDamping, inertia: t.strandInertia, wind: t.strandWind, smooth: !!this.rig.groupKeys });
      const binds = {};
      const members = def.parts.map(n => this.byName[n]).filter(Boolean);
      if (def.field && members.length) {
        const box = [Infinity, Infinity, -Infinity, -Infinity];
        for (const p of members) for (let i = 0; i < p.rest.length; i += 2) {
          box[0] = Math.min(box[0], p.rest[i]); box[1] = Math.min(box[1], p.rest[i + 1]);
          box[2] = Math.max(box[2], p.rest[i]); box[3] = Math.max(box[3], p.rest[i + 1]);
        }
        const field = set.makeField(box);
        if (field && def.role === 'head') this.skullRigid({ rest: field.rest, l1: def.name }, field.bind);
      }
      for (const n of def.parts) {
        const p = this.byName[n];
        if (!p) continue;
        binds[n] = set.field ? set.bindField(p.rest) : set.bind(p.rest);
        if (!set.field && def.role === 'head' && this.rig.groupKeys) this.skullRigid(p, binds[n]);
      }
      return { def, set, binds };
    });
    this.setOf = {};
    for (const s of this.sets) for (const n of Object.keys(s.binds)) this.setOf[n] = s;
  }

  // 머리통 모양 지키기: 정수리~옆머리 안쪽(머리 덩어리)은 물리로 거의 휘지 않고, 그 바깥 머리끝·앞머리 끝만 찰랑.
  // (일류 리깅: 두개골 실루엣은 단단하게, 흔들림은 끝자락에) — 정점마다 사슬 무게에 곱함
  skullRigid(p, B) {
    const H = this.rig.head;
    if (!this.skull) {
      let top = H.cy - H.ry;
      for (const q of this.parts) if (q.role === 'head' && /^Hair/.test(q.l1 ?? '')) top = Math.min(top, q.y);
      const eyes = this.rig.eyes ?? {};
      const brow = Math.min(...['L', 'R'].map((s) => eyes[s]?.white?.[1] ?? H.cy)) - 35;
      this.skull = { up: H.cy - top + 10, down: H.ry * 0.92, side: H.rx * 1.08, brow };
    }
    const S = this.skull;
    const front = p.l1 === 'HairFront';
    const v = p.rest;
    for (let i = 0; i < v.length / 2; i++) {
      const x = v[2 * i];
      const y = v[2 * i + 1];
      const dx = (x - H.cx) / S.side;
      const dy = (y - H.cy) / (y < H.cy ? S.up : S.down);
      const e = Math.sqrt(dx * dx + dy * dy);
      let m = 0.2 + 0.8 * smooth(0.72, 1.08, e);
      if (front) m = Math.max(m, 0.85 * smooth(S.brow - 40, S.brow + 50, y)); // 눈썹 아래로 내려온 앞머리 끝
      for (const sb of B.sb) sb.w[i] *= m;
    }
  }

  resetPhysics() {
    for (const s of this.sets) s.set.reset();
    for (const L of this.cloth ?? []) L.lag?.reset();
  }

  // 옷 겹(rig.clothLayers): 묶음·이름으로 파츠를 모으고, 겹마다 고정점·옷자락 끝·깊이·용수철
  makeCloth() {
    const defs = this.rig.clothLayers;
    this.cloth = null;
    if (!defs?.length) return;
    const layers = {};
    for (const d of defs) {
      const re = d.match ? new RegExp(d.match) : null;
      const ps = this.parts.filter((p) => p.role !== 'head' && p.role !== 'neck' && !p.cloth && ((d.groups ?? []).includes(p.group) || (re && re.test(p.name))));
      if (!ps.length) continue;
      let y0 = Infinity;
      let y1 = -Infinity;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const p of ps) {
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y + p.h);
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x + p.w);
      }
      const L = { def: d, parts: ps, ax: d.ax ?? (x0 + x1) / 2, ay: d.ay ?? y0, hy: d.hy ?? y1, pow: d.pow ?? 1.3, tmp: new Float32Array(2), ox: 0, oy: 0, dr: 0 };
      for (const p of ps) {
        p.cloth = L;
        if (p.bodyDepth == null && d.depth != null) p.bodyDepth = d.depth;
      }
      layers[d.name] = L;
    }
    for (const L of Object.values(layers)) {
      const f = L.def.follow && layers[L.def.follow];
      if (f) {
        L.src = f;
        L.ax = f.ax;
        L.ay = f.ay;
        L.hy = f.hy;
        L.pow = f.pow;
      } else if (L.def.freq) L.lag = new ClothLag(L.def);
    }
    this.cloth = Object.values(layers).sort((a, b) => (a.src ? 1 : 0) - (b.src ? 1 : 0));
  }

  setTuning(tun) {
    const before = this.gravityK();
    Object.assign(this.t, tun ?? {});
    // 중력이 바뀌면 물리 사슬(머리·장신구)의 늘어짐을 다시 계산
    if (this.parts.length && Math.abs(this.gravityK() - before) > 1e-6) this.makeStrandSets();
  }

  // 중력 세기 = 모델 기본값(rig.gravityBase) × 사용자 배율(t.gravity)
  gravityK() {
    return (this.rig.gravityBase ?? 1) * (this.t.gravity ?? 1);
  }

  // 스튜디오가 부르는 함수들 (파츠 모델은 따로 할 일 없음)
  refreshClosedEyes() {}

  prepareStatic() {}

  // ------------------------------------------------------------ 팔 관절 (rig.arms): 어깨를 축으로 팔 전체, 팔꿈치를 축으로 아래팔·손
  // P.armR / armL: 팔을 몸 바깥으로 드는 각도(°), P.elbowR / elbowL: 아래팔을 몸 안쪽(위)으로 굽히는 각도(°)
  // 정점마다 팔 위 위치(어깨 0 → 팔꿈치 1)로 섞음: 어깨 가까이는 덜 돌아 재킷 어깨 밑에 붙어 있고, 팔꿈치 둘레는 부드럽게 꺾임
  prepArms() {
    const A = this.rig.arms;
    this.arms = {};
    if (!A) return;
    for (const [side, a] of Object.entries(A)) {
      const [sx, sy] = a.shoulder, [ex, ey] = a.elbow;
      const L = Math.hypot(ex - sx, ey - sy) || 1;
      this.arms[side] = { ...a, ux: (ex - sx) / L, uy: (ey - sy) / L, len: L };
    }
    for (const p of this.parts) {
      const side = p.role === 'armR' ? 'R' : p.role === 'armL' ? 'L' : null;
      if (!side || !this.arms[side]) continue;
      const a = this.arms[side];
      p.armSide = side;
      const n = p.rest.length / 2;
      p.armT = new Float32Array(n);
      for (let i = 0; i < n; i++) p.armT[i] = ((p.rest[2 * i] - a.shoulder[0]) * a.ux + (p.rest[2 * i + 1] - a.shoulder[1]) * a.uy) / a.len;
    }
  }

  armDeform(p, P) {
    const a = this.arms[p.armSide];
    const s = p.armSide;
    const t = this.t;
    // 중력: 몸을 기울여도 팔은 어깨에서 아래로 늘어지려 함 (몸 기울기의 일부를 되돌림)
    const hangK = clamp((a.hang ?? 0.35) * this.gravityK(), 0, 0.9);
    const up = clamp((P['arm' + s] ?? 0) * (t.armScale ?? 1), -15, 40) * DEG * a.dir - (this.bodyRollNow ?? 0) * hangK;
    const bend = clamp((P['elbow' + s] ?? 0) * (t.armScale ?? 1), -15, 60) * DEG * -a.dir;
    if (Math.abs(up) < 1e-4 && Math.abs(bend) < 1e-4) return;
    const [sx, sy] = a.shoulder;
    const cu = Math.cos(up), su = Math.sin(up);
    // 팔꿈치가 간 자리
    const ex = sx + (a.elbow[0] - sx) * cu - (a.elbow[1] - sy) * su;
    const ey = sy + (a.elbow[0] - sx) * su + (a.elbow[1] - sy) * cu;
    const cb = Math.cos(bend), sb = Math.sin(bend);
    const band = a.band ?? 0.12;
    const L = p.local;
    for (let i = 0; i < L.length; i += 2) {
      const tt = p.armT[i >> 1];
      // 어깨 둘레는 덜 돌림 (재킷 어깨 밑에서 빠져나오지 않게)
      const ws = smooth(-0.05, 0.3, tt);
      const r = up * ws;
      const c1 = Math.cos(r), s1 = Math.sin(r);
      const dx = L[i] - sx, dy = L[i + 1] - sy;
      let x = sx + dx * c1 - dy * s1;
      let y = sy + dx * s1 + dy * c1;
      const wl = smooth(1 - band, 1 + band, tt);
      if (wl > 0 && bend) {
        const qx = x - ex, qy = y - ey;
        const bx = ex + qx * cb - qy * sb, by = ey + qx * sb + qy * cb;
        x += (bx - x) * wl;
        y += (by - y) * wl;
      }
      L[i] = x;
      L[i + 1] = y;
    }
  }

  // ------------------------------------------------------------ 파츠 안쪽 변형 (모델 좌표)
  localDeform(p, P) {
    const src = p.rest;
    const out = p.local;
    out.set(src);
    const R = this.rig;
    const t = this.t;
    const g = p.group;
    const name = p.name;
    // 눈: 조각마다 역할이 다름
    //  - 홍채·동공: 시선 따라 이동 + 안구 곡면이라 가장자리로 갈수록 납작 / 하이라이트: 덜 움직이고 미세하게 반짝
    //  - 윗속눈썹 띠·눈꼬리·눈꺼풀 선: 감을 때 아래 눈꺼풀까지 내려옴 / 위로 뻗은 가닥: 조금 늦게 따라옴
    //  - 눈꺼풀 피부: 흰자 안쪽에서 위부터 덮음 / 아랫속눈썹·아이라인·눈두덩: 그대로
    if (g === 'Eye_L' || g === 'Eye_R' || g === 'EyeFX_L' || g === 'EyeFX_R') {
      const s = g.endsWith('L') ? 'L' : 'R';
      const E = R.eyes[s];
      const st = this.eyeState?.[s];
      if (!E || !st) return;
      const isFX = g.startsWith('EyeFX');
      const open = clamp(st.open, 0, 1);
      const ow = E.white[2] / 2;
      const yawSide = Math.sin((P.angleX ?? 0) * DEG * t.yawScale);
      const far = s === 'L' ? Math.max(0, yawSide) : Math.max(0, -yawSide);
      const sqx = 1 - t.farEyeSquash * far;
      const isIris = isFX || name.startsWith('Iris') || name.startsWith('Pupil');
      const isPupil = name.startsWith('Pupil');
      const isHL = name.startsWith('EyeHL');
      // 눈꺼풀 종류: 세부 모델은 p.lid(up 윗속눈썹·눈꺼풀 / crease 쌍꺼풀 / low 아래 / aegyo 애교살), 아니면 이름으로
      const kind = p.lid ?? (name.startsWith('LashMain') || name.startsWith('LashTail') || name.startsWith('LidLine') ? 'up' : null);
      const flick = name.startsWith('LashFlick');
      // 감을 때 가운데가 더 내려오고 눈꼬리·눈머리는 덜 → 눈꺼풀 곡선이 점점 평평해지며 닫힘 (그림처럼)
      const halfW = E.white[2] / 2;
      const shapeX = (x) => 0.35 + 0.65 * clamp(1 - ((x - E.cx) / halfW) ** 2, 0, 1);
      const pupilK = 1 + 0.28 * clamp(P.pupil ?? 0, -1, 1);
      const aeg = clamp(Math.max(P.eyeSmile ?? 0, (P.ex_smile ?? 0) * 0.7, P.cheekSquint ?? 0), 0, 1);
      const sq = clamp(Math.max(P['eyeSquint' + s] ?? 0, aeg * 0.45), 0, 1); // 눈 찡그림: 아래 눈꺼풀이 올라옴 (좌우 따로)
      const lowKind = kind === 'low' || kind === 'aegyo' || name.startsWith('LashLower') || name.startsWith('LinerLow');
      const opening = name.startsWith('ScleraBase') || name.startsWith('ScleraShade') || name.startsWith('EyeOpening');
      const isLid = name.startsWith('EyeLid');
      const phx = clamp(P.eyeBallX ?? 0, -1, 1) * t.irisAngle * DEG;
      const phy = clamp(P.eyeBallY ?? 0, -1, 1) * t.irisAngle * 0.6 * DEG;
      const top = E.white[1];
      const closure = R.faceProfile?.eyeClosure?.[s] ?? E.lidY;
      const drop = R.faceProfile ? closure - top : (E.lidY - top) * 0.92;
      const ib = E.iris ?? E.white;
      const icx = ib[0] + ib[2] / 2;
      const icy = ib[1] + ib[3] / 2;
      let jx = 0;
      let jy = 0;
      if (isHL) {
        const ph = p.phase ?? 0;
        jx = Math.sin(this.time * 2.3 + ph) * 0.35;
        jy = Math.cos(this.time * 1.7 + ph * 1.3) * 0.3;
      }
      const lag = clamp(st.lag, 0, 1);
      for (let i = 0; i < out.length; i += 2) {
        let x = out[i];
        let y = out[i + 1];
        if (isPupil && pupilK !== 1) {
          x = icx + (x - icx) * pupilK;
          y = icy + (y - icy) * pupilK;
        }
        if (isIris || isHL) {
          const k = isHL ? t.hlFollow : 1;
          const dx = Math.sin(phx) * ow * t.irisRange * k;
          const dy = -Math.sin(phy) * E.h * 0.55 * k; // 위를 보는 그림(09)에서 잰 양에 맞춤
          const fx = isHL ? 1 : Math.cos(phx);
          const fy = isHL ? 1 : Math.cos(phy);
          x = icx + (x - icx) * fx + dx + jx;
          y = icy + (y - icy) * fy + dy + jy;
        }
        if (kind === 'up' || flick) y += (1 - (flick ? lag : open)) * drop * shapeX(out[i]);
        else if (kind === 'crease') y += (1 - open) * drop * 0.25 * shapeX(out[i]);
        else if (kind === 'aegyo') y -= aeg * 2.5; // 웃으면 애교살이 올라옴
        if (R.faceProfile) {
          if (opening) y = closure + (y - closure) * open;
          else if (lowKind) y -= (1 - open) * Math.max(0, E.lidY - closure) * shapeX(out[i]);
          const upper = kind === 'up' || flick || kind === 'crease';
          const widen = clamp(P.eyeWiden ?? 0, 0, 1) * E.h * .12;
          if (upper) {
            y -= widen * shapeX(out[i]) * open;
            const inner = (s === 'L' ? -1 : 1) * clamp((out[i] - E.cx) / halfW, -1, 1);
            y += (P.lidTilt ?? 0) * inner * 2.5 * open;
          } else if (opening) y -= widen * shapeX(out[i]) * smooth(E.lidY, top, out[i + 1]) * open;
        }
        if (sq > 0.001) {
          const lift = sq * E.h * 0.24 * shapeX(out[i]);
          if (lowKind) y -= lift;
          else if (opening) y -= lift * smooth(E.cy - E.h * 0.15, E.lidY, y); // 눈 트임 아래쪽이 같이 줄어 홍채가 아래부터 가려짐
        }
        if (isLid) {
          // 눈꺼풀 아래 끝이 내려오는 윗속눈썹 곡선을 따라감 (가운데 많이, 끝 적게)
          const target = top + (1 - open) * drop * shapeX(out[i]) + 0.09 * E.h;
          const k = clamp((target - p.y) / Math.max(1, p.h), 0, 1);
          y = p.y + (y - p.y) * k;
        }
        x = E.cx + (x - E.cx) * sqx;
        out[i] = x;
        out[i + 1] = y;
      }
      return;
    }
    // 눈물 방울: 눈 밑에서 볼을 따라 떨어지고 다시 (p.fall px)
    if (g === 'Tear_L' || g === 'Tear_R') {
      if (p.fall) {
        const tt = (this.time * 0.8 + (p.phase ?? 0)) % 1.6;
        const dy = tt < 1.2 ? (tt / 1.2) ** 1.7 * p.fall : p.fall;
        p.fallOp = tt < 0.1 ? tt / 0.1 : tt < 1.2 ? 1 : 1 - (tt - 1.2) / 0.4;
        for (let i = 1; i < out.length; i += 2) out[i] += dy;
      }
      return;
    }
    if (g === 'Eye_Closed' || g === 'Eye_Smile') {
      const s = name.endsWith('L') ? 'L' : 'R';
      const E = R.eyes[s];
      if (!E) return;
      const yawSide = Math.sin((P.angleX ?? 0) * DEG * t.yawScale);
      const far = s === 'L' ? Math.max(0, yawSide) : Math.max(0, -yawSide);
      const sqx = 1 - t.farEyeSquash * far;
      for (let i = 0; i < out.length; i += 2) out[i] = E.cx + (out[i] - E.cx) * sqx;
      return;
    }
    // 눈썹: 머리는 덜, 꼬리는 더 움직여 표정에 기울기가 생김
    if (g === 'Brow_L' || g === 'Brow_R') {
      const b = P[`brow${g.slice(-1)}`] ?? P.brow ?? 0; // 좌우 따로 (한쪽 눈썹만 올리기)
      const k = name.startsWith('BrowTail') ? 1.15 : 0.8;
      for (let i = 0; i < out.length; i += 2) {
        out[i + 1] -= b * t.browRange * k;
        if (R.faceProfile) {
          const side = g.slice(-1), E = R.eyes[side];
          const u = clamp((out[i] - E.cx) / (E.white[2] * .85), -1, 1);
          out[i + 1] -= (P['browTilt' + side] ?? 0) * t.browRange * u * (side === 'L' ? -1 : 1);
          out[i + 1] -= (P.browArch ?? 0) * 3 * (1 - u * u);
        }
      }
      return;
    }
    // 턱 내려가기: 입을 벌리면 아래턱·턱선·턱 밑 그림자가 같이 내려감 (윗입술 위는 그대로) — 얼굴이 말랑하게 늘어나는 느낌
    if (R.mouth && R.groupKeys && (g === 'Face_Base' || name === 'Neck_Shadow')) {
      const m = clamp(P.mouthOpen ?? 0, 0, 1);
      const jx = clamp(P.jawX ?? 0, -1, 1);
      const puff = clamp(P.cheekPuff ?? 0, 0, 1);
      if (Math.max(m, P.jawOpen ?? 0) > 0.005 || Math.abs(jx) > 0.005 || puff > 0.005) {
        const H = R.head;
        const M = R.mouth;
        const jaw = (P.jawOpen ?? m) * H.ry * 0.034;
        const chin = H.cy + H.ry * 0.78;
        const nose = M.top - H.ry * 0.16;
        for (let i = 0; i < out.length; i += 2) {
          const x = out[i];
          const y = out[i + 1];
          const wy = smooth(M.top - 10, chin - 25, y) * (1 - smooth(chin + 25, chin + 140, y));
          const wx = 1 - smooth(0.25, 0.85, Math.abs(x - M.cx) / H.rx);
          let X = x;
          const Y = y + jaw * wy * wx;
          // 턱 좌우(아래턱이 옆으로): 입 아래~턱끝이 같이 움직이고 턱선이 비대칭으로 굽음
          if (jx) X += jx * H.rx * 0.035 * smooth(M.top - 5, chin - 10, y) * (1 - smooth(chin + 30, chin + 150, y)) * (1 - smooth(0.5, 1.1, Math.abs(x - M.cx) / H.rx));
          // 볼 부풀리기: 코 아래~턱 위 볼 바깥쪽이 옆으로 부풂 (얼굴 윤곽선도 같이)
          if (puff) {
            const u = (x - M.cx) / H.rx;
            const band = smooth(nose - 20, nose + 30, y) * (1 - smooth(chin - 60, chin, y));
            X += Math.sign(u) * puff * H.rx * 0.045 * band * smooth(0.25, 0.75, Math.abs(u));
          }
          out[i] = X;
          out[i + 1] = Y;
        }
      }
      return;
    }
    // 코: 코 찡그림(위로 살짝 + 콧볼 넓게)
    if (g === 'Nose' && (P.noseSneer ?? 0) > 0.005) {
      const sn = clamp(P.noseSneer, 0, 1);
      const cx = p.x + p.w / 2;
      for (let i = 0; i < out.length; i += 2) {
        const v = clamp((out[i + 1] - p.y) / Math.max(1, p.h), 0, 1);
        out[i] = cx + (out[i] - cx) * (1 + 0.12 * sn * v);
        out[i + 1] -= sn * 3 * v;
      }
      return;
    }
    // 벌린 입: 위 입술 쪽 기준으로 아래로 열림, 옆으로 넓게/좁게
    if (g === 'Mouth_Open' && R.mouth?.mode === 'patch') {
      // 벌린 입 그림 한 장: 위 입술 기준으로 살짝만 늘였다 줄임 (열림 정도는 투명도로)
      const M = R.mouth;
      const m = clamp(P.mouthOpen ?? 0, 0, 1);
      const sy = 0.85 + 0.15 * m;
      // 아랫입술 쪽은 내려가는 턱과 같이 (위 턱 내려가기와 같은 식)
      const H = R.head;
      const jaw = R.groupKeys ? m * H.ry * 0.034 : 0;
      const chin = H.cy + H.ry * 0.78;
      for (let i = 0; i < out.length; i += 2) {
        const y = M.top + (out[i + 1] - M.top) * sy;
        const wx = 1 - smooth(0.25, 0.85, Math.abs(out[i] - M.cx) / H.rx);
        out[i + 1] = y + jaw * smooth(M.top - 10, chin - 25, out[i + 1]) * wx;
      }
      return;
    }
    if (g === 'Mouth_Open' && R.mouth?.cavity) {
      if (R.faceProfile) {
        deformArticulatedMouth(src, out, p, R, P, this.mouthShape);
        return;
      }
      // 입 조각: 입안(가림판)·입 둘레는 위 입술 기준으로 세로로 열리고, 윗니·잇몸·목젖·윗입술은 위에 붙어 있고,
      // 아랫니·혀·아랫입술은 열린 만큼 내려감. 넓히기(이·에)·오므리기(우·오)·입꼬리(미소)는 가로 폭과 양끝 높이로.
      // 이·혀·입안 음영은 입안 가림판 안에서만 보임(clip) → 어느 순간에도 겹쳐 비치는 그림이 없음
      const M = R.mouth;
      const C = M.cavity;
      const H = R.head;
      const m = clamp(P.mouthOpen ?? 0, 0, 1);
      const wide = clamp(P.mouthWide ?? 0, 0, 1);
      const narrow = clamp(P.mouthNarrow ?? 0, 0, 1);
      const form = clamp(P.mouthForm ?? 0, -1, 1);
      const cx = C[0] + C[2] / 2;
      const top = C[1];
      // 그림의 벌린 입은 반쯤 벌린 크기 → 끝까지 벌리면 1.6배까지 (혀·아랫니가 더 보임)
      const sy = 0.1 + 1.5 * m * (1 + 0.15 * narrow - 0.12 * wide);
      const puff = clamp(P.cheekPuff ?? 0, 0, 1);
      const sx = clamp(0.72 + 0.28 * m + 0.3 * wide - 0.4 * narrow + 0.06 * form - 0.18 * puff, 0.35, 1.35);
      const jaw = R.groupKeys ? m * H.ry * 0.034 : 0;
      const jx = clamp(P.jawX ?? 0, -1, 1) * H.rx * 0.035;
      const uu = clamp(P.upperUp ?? 0, 0, 1) * 3;
      const chin = H.cy + H.ry * 0.78;
      const att = p.attach ?? 'cavity';
      for (let i = 0; i < out.length; i += 2) {
        const x0 = out[i];
        const y0 = out[i + 1];
        const u = (x0 - cx) / (C[2] / 2);
        let y;
        const bottom = top + C[3];
        // 그림보다 더 벌릴 때는 가운데만 더 열리고 입꼬리는 붙어 있게 (입꼬리가 갈라져 선이 삐져나오지 않게)
        const syL = 1 + (sy - 1) * clamp(1 - u * u, 0.08, 1);
        const shiftL = C[3] * (syL - 1);
        if (att === 'upper') y = y0;
        else if (att === 'lower') y = y0 + shiftL;
        else if (att === 'skin' && y0 > bottom) y = y0 + shiftL; // 아랫입술 아래 피부는 통째로 내려감
        else y = top + (y0 - top) * syL;
        const fs = u < 0 ? (P.mouthFormR ?? form) : (P.mouthFormL ?? form); // 입꼬리 좌우 따로 (한쪽만 올리는 미소)
        y -= clamp(fs, -1, 1) * 4 * u * u * (att === 'upper' ? 0.7 : 1);
        const wx = 1 - smooth(0.25, 0.85, Math.abs(x0 - M.cx) / H.rx);
        y += jaw * smooth(M.top - 10, chin - 25, y0) * wx;
        // 아래쪽(아랫입술·혀·아랫니)일수록 턱 좌우를 따라감, 위쪽은 윗입술 올리기(윗니가 더 보임)
        const low = att === 'lower' || (att === 'skin' && y0 > bottom) ? 1 : att === 'upper' ? 0 : clamp((y0 - top) / Math.max(1, C[3]), 0, 1);
        y -= uu * (1 - low);
        out[i] = cx + (x0 - cx) * sx + clamp(P.mouthX ?? 0, -1, 1) * 4 + jx * low;
        out[i + 1] = y;
      }
      return;
    }
    if (g === 'Mouth_Open') {
      const M = R.mouth;
      const m = clamp(P.mouthOpen ?? 0, 0, 1);
      const sy = 0.12 + 0.88 * m;
      const sx = clamp(0.62 + 0.38 * m + 0.25 * (P.mouthWide ?? 0) - 0.3 * (P.mouthNarrow ?? 0), 0.3, 1.3);
      for (let i = 0; i < out.length; i += 2) {
        out[i] = M.cx + (out[i] - M.cx) * sx;
        out[i + 1] = M.top + (out[i + 1] - M.top) * sy;
      }
      return;
    }
    // 다문 입(입꼬리·가운데 세 조각): 입꼬리 올리기/내리기, 옆으로 넓히기
    if (g === 'Mouth') {
      const f = P.mouthForm ?? 0;
      const wide = P.mouthWide ?? 0;
      const M = R.mouth;
      const cx = M.line ? M.line[0] + M.line[2] / 2 : p.x + p.w / 2;
      const half = M.line ? M.line[2] * 1.5 : p.w;
      const puff = clamp(P.cheekPuff ?? 0, 0, 1);
      const jx = clamp(P.jawX ?? 0, -1, 1) * R.head.rx * 0.035 * 0.5;
      for (let i = 0; i < out.length; i += 2) {
        const u = (out[i] - cx) / half;
        const fs = u < 0 ? (P.mouthFormR ?? f) : (P.mouthFormL ?? f);
        out[i + 1] -= clamp(fs, -1, 1) * 9 * u * u;
        out[i] = cx + (out[i] - cx) * (1 + 0.12 * wide - 0.15 * puff) + clamp(P.mouthX ?? 0, -1, 1) * 4 + jx;
      }
    }
  }

  // ------------------------------------------------------------ 프레임
  update(P, dt) {
    if (this.rig.faceProfile) P = facePose(P);
    this.time += dt;
    const t = this.t;
    const R = this.rig;
    const H = R.head;
    const N = R.neck;
    const B = R.body;
    const yaw = (P.angleX ?? 0) * DEG * t.yawScale;
    const pitch = (P.angleY ?? 0) * DEG * t.pitchScale;
    const roll = (P.angleZ ?? 0) * DEG * t.rollScale;
    const bodyRoll = (P.bodyZ ?? 0) * DEG * 0.5 * t.bodyFollow;
    this.bodyRollNow = bodyRoll;
    const bodyShift = (P.bodyX ?? 0) * (H.rx / 60) * t.bodyFollow;
    const bodyYaw = (P.bodyYaw ?? 0) * DEG;
    const presence = R.performanceProfile ? clamp(t.motionPresence ?? 1, 0, 1) : 0;
    const breathK = t.breathAmount * (P.breath ?? 0) + (P.chestPulse ?? 0) * 0.003 * presence;
    const sy = Math.sin(yaw);
    const sp = Math.sin(pitch);
    const cbr = Math.cos(bodyRoll);
    const sbr = Math.sin(bodyRoll);
    const rz = H.rx * t.headDepth;

    // 몸: 엉덩이 아래(B)를 중심으로
    //  - 몸통 돌리기: 세로 원기둥(가슴 반폭 TW, 깊이 0.42배)처럼 돌아 가슴 가운데가 밀리고 옆구리·팔은 안쪽으로 — 겹 깊이(bodyDepth)만큼 더
    //  - 숙이기/젖히기(bodyLean): 위로 갈수록 카메라에 가까워져 조금 커지고 아래로 (어깨가 앞으로)
    //  - 숨쉬기(위로 늘림), 기울기, 좌우 이동
    const TW = H.rx * 1.9;
    const shoulderY = N.bottom + (N.bottom - N.top) * 0.4;
    const cyb = Math.cos(bodyYaw);
    const syb = Math.sin(bodyYaw);
    const lean = clamp((P.bodyLean ?? 0) * DEG, -0.35, 0.35);
    const bodyXf = (x, y, depth, o, i) => {
      let yy = B.y + (y - B.y) * (1 + breathK);
      const zt = softSphere((x - B.x) / TW) * TW * 0.42 + depth * 1.2;
      let xx = B.x + (x - B.x) * cyb + zt * syb;
      if (presence) {
        // Inhalation expands the ribcage and lifts the shoulder a few pixels.
        // It no longer stretches the entire body and head like one sheet.
        const chest = Math.exp(-(((y - 1270) / 550) ** 2));
        const localY = y - breathK * 280 * smooth(2150, 850, y);
        yy += (localY - yy) * presence;
        xx += (x - B.x) * breathK * 0.55 * chest * presence;
      }
      if (lean) {
        const hgt = clamp((B.y - yy) / (B.y - shoulderY), 0, 1.4); // 엉덩이 0 → 어깨 1
        const sc = 1 + lean * 0.14 * hgt;
        xx = B.x + (xx - B.x) * sc;
        yy += lean * 60 * hgt * hgt;
      }
      const dx = xx - B.x;
      const dy = yy - B.y;
      o[i] = B.x + dx * cbr - dy * sbr + bodyShift;
      o[i + 1] = B.y + dx * sbr + dy * cbr;
    };
    // 옷 겹: 고정점이 간 자리로 용수철 한 걸음 (따라 하는 겹은 원본 겹 값을 그대로)
    for (const L of this.cloth ?? []) {
      if (L.src) {
        L.tmp[0] = L.src.tmp[0];
        L.tmp[1] = L.src.tmp[1];
        L.ox = L.src.ox;
        L.oy = L.src.oy;
        L.dr = L.src.dr;
        L.ripple = L.src.ripple;
        continue;
      }
      bodyXf(L.ax, L.ay, 0, L.tmp, 0);
      if (!L.lag || t.clothMotion === 0) {
        L.ox = L.oy = L.dr = 0;
        L.ripple = 0;
        continue;
      }
      const gk = this.gravityK();
      const hang = clamp((L.def.hang ?? 0) * gk, 0, 0.95);
      L.def.gravity = gk;
      L.lag.step(L.tmp[0], L.tmp[1], bodyRoll * (1 - hang), bodyRoll, dt);
      const k = t.clothMotion ?? 1;
      L.ox = L.lag.ox * k;
      L.oy = L.lag.oy * k;
      L.dr = L.lag.dr * k;
      L.ripple = softClamp(L.lag.ripple, L.def.rippleMax ?? 0) * k * (R.clothRipple ? 1 : presence);
    }
    const clothW = (L, y) => {
      const u = clamp((y - L.ay) / Math.max(1, L.hy - L.ay), 0, 1);
      return Math.pow(u * u * (3 - 2 * u), L.pow);
    };
    const clothXf = (L, x, y, depth, o, i) => {
      bodyXf(x, y, depth, o, i);
      if (!L || (!L.ox && !L.oy && !L.dr && !L.ripple)) return;
      const w = clothW(L, y);
      if (w <= 0) return;
      const px = L.tmp[0];
      const py = L.tmp[1];
      const dx = o[i] - px;
      const dy = o[i + 1] - py;
      const a = L.dr * w;
      const c = Math.cos(a);
      const s = Math.sin(a);
      o[i] = px + dx * c - dy * s + L.ox * w;
      o[i + 1] = py + dx * s + dy * c + L.oy * w;
      if (L.ripple) {
        const fold = Math.sin(Math.PI * w);
        o[i] += L.ripple * fold;
        o[i + 1] += L.ripple * fold * 0.35 * Math.tanh((x - L.ax) / 250);
      }
    };
    // 목 아래쪽 점(몸에 붙은 곳)이 몸 변환으로 간 자리
    const nb = new Float32Array(2);
    bodyXf(N.x, N.y, 0, nb, 0);
    const neckDX = nb[0] - N.x;
    const neckDY = nb[1] - N.y;
    const rollAll = roll + bodyRoll;
    const cr = Math.cos(rollAll);
    const sr = Math.sin(rollAll);
    // 머리: 타원체 표면 깊이 + 파츠 깊이만큼 시차, 목을 중심으로 기울기, 목이 따라간 만큼 이동
    const headXf = (x, y, depth, o, i) => {
      const u = (x - H.cx) / H.rx;
      const v = (y - H.cy) / H.ry;
      const zs = Math.sqrt(Math.max(0, 1 - u * u - v * v));
      const z = zs * rz + depth * H.rx;
      const X = x + z * sy;
      const Y = y - z * sp * 0.8 + (zs * zs) * 0 ;
      const dx = X - N.x;
      const dy = Y - N.y;
      o[i] = N.x + dx * cr - dy * sr + neckDX;
      o[i + 1] = N.y + dx * sr + dy * cr + neckDY;
    };
    // 키폼 (고개 방향 그림에서 잰 파츠별 어파인): 고개 좌우·위아래를 그림대로 — 있으면 타원체 시차 대신 씀
    const KR = R.keyRange ?? { x: 30, y: 30 };
    // 위아래는 키폼(그림에서 잰 어파인), 좌우는 '세로축 둘레 회전'(원기둥): 턱·코도 얼굴과 같이 돌고 귀는 가운데로 들어옴
    const kw = { 'y+': clamp((P.angleY ?? 0) / KR.y, 0, 1.15), 'y-': clamp(-(P.angleY ?? 0) / KR.y, 0, 1.15) };
    const kwY = clamp((P.angleY ?? 0) / KR.y, -1.15, 1.15); // + = 위 키, - = 아래 키
    const cyaw = Math.cos(yaw);
    if (!this.crownY) {
      let topY = H.cy - H.ry;
      for (const q of this.parts) if (q.role === 'head' && /^Hair/.test(q.l1 ?? '')) topY = Math.min(topY, q.y);
      const eyes = R.eyes ?? {};
      const eyeY = Math.min(...['L', 'R'].map((sd) => eyes[sd]?.white?.[1] ?? H.cy));
      this.crownY = { top: topY, eye: eyeY };
    }
    const CY = this.crownY;
    const crownF = (y) => {
      if (y >= CY.eye) return 1;
      const t = clamp((CY.eye - y) / Math.max(1, CY.eye - CY.top), 0, 1);
      return Math.sqrt(1 - t * t);
    };
    const PERSP = this.t.perspective ?? 0.07;
    // 그림 기반 변형: 좌우·위아래 모두 받은 방향 그림대로 (눈·코·입·귀·장신구는 모양을 지키며 통째로)
    const WK = this.WK;
    const yawN = clamp((P.angleX ?? 0) / (WK?.range?.x ?? 30), -1.15, 1.15);
    const wxv = WK ? Math.sin(yawN * Math.PI / 2 * 0.9) / Math.sin(Math.PI / 2 * 0.9) * (t.warpYaw ?? 0.55) : 0;
    // 머리카락 층 시차(돌릴 때 앞머리는 얼굴보다 조금 더, 뒷머리는 반대로): 한 덩어리처럼 붙어 움직이지 않게
    const hairPar = WK ? Math.sin(yawN * 0.5) * H.rx * (t.hairParallax ?? 0.55) : 0;
    const wyv = WK ? clamp((P.angleY ?? 0) / (WK.range?.y ?? 30), -1.15, 1.15) * (t.warpPitch ?? 1) : 0;
    const wtmp = new Float32Array(2);
    const warpMove = (x, y, o, i, rk, depth = 0) => {
      let X = x;
      let Y = y;
      if (depth && hairPar) {
        // 앞머리(+)는 돌리는 쪽으로 더, 뒷머리(-)는 반대로 — 정수리는 회전축이라 적게, 돌아가는 쪽 바깥 끝 뒷머리는 붙어 있게
        const u = (x - H.cx) / H.rx;
        const lead = u * Math.sign(hairPar);
        const dep = depth < 0 ? depth * (1 - smooth(0.4, 1.2, lead)) : depth;
        X += dep * hairPar * (0.35 + 0.65 * crownF(y));
      }
      for (const [w, k] of [[wxv, wxv > 0 ? 'x+' : 'x-'], [wyv, wyv > 0 ? 'y+' : 'y-']]) {
        if (!w) continue;
        const A = rk && this.WKaff[rk]?.[k];
        if (A) {
          wtmp[0] = A[0] * x + A[1] * y + A[2];
          wtmp[1] = A[3] * x + A[4] * y + A[5];
        } else this.sampleWarp(k, x, y, wtmp, rk === '~hair');
        const aw = Math.abs(w);
        X += aw * wtmp[0];
        Y += aw * wtmp[1];
      }
      const dx = X - N.x;
      const dy = Y - N.y;
      o[i] = N.x + dx * cr - dy * sr + neckDX;
      o[i + 1] = N.y + dx * sr + dy * cr + neckDY;
    };
    const keyMove = (keys, x, y, o, i, depth = 0, rk = null) => {
      if (WK) {
        warpMove(x, y, o, i, rk, rk && rk !== '~hair' ? 0 : depth);
        return;
      }
      let X = x;
      let Y = y;
      // 위아래 끄덕임도 정수리는 회전축 가까이라 덜 움직임 (정수리가 내려앉아 두개골이 납작해 보이지 않게): 꼭대기에서 40%
      const vf = crownF(y);
      const pf = 0.4 + 0.6 * vf;
      // (위·아래 키 두 개를 직접: 객체 순회보다 빠름 — 정점 수만 개라 매 프레임 크게 차이)
      const M = kwY > 0 ? keys['y+'] : kwY < 0 ? keys['y-'] : null;
      if (M) {
        const w = Math.abs(kwY) * pf;
        X += w * (M[0] * x + M[1] * y + M[2] - x);
        Y += w * (M[3] * x + M[4] * y + M[5] - y);
      }
      // 고개 좌우 = 머리를 공처럼 돌리기:
      //  - 정수리는 회전축 위라 옆으로 거의 안 밀림(눈높이 아래는 그대로, 위로 갈수록 밀림이 줄어 꼭대기에서 0)
      //  - 가로 줄어듦(cos)은 얼굴 안쪽에만 → 머리 바깥 윤곽은 폭이 그대로 (두개골이 쪼그라들어 함몰돼 보이지 않게)
      //  - 뒷머리(깊이 -)는 돌리는 반대로 밀려 뒤통수가 드러나되, 돌아가는 쪽 바깥 끝은 붙어 있음(윤곽 유지)
      const u = (x - H.cx) / H.rx;
      const lead = u * Math.sign(sy);
      const dep = depth < 0 ? depth * (1 - smooth(0.5, 1.3, lead)) : depth;
      const zc = (softSphere(u) * rz + dep * H.rx) * vf;
      const cmp = 1 - (1 - cyaw) * (1 - smooth(0.85, 1.35, Math.abs(u)));
      X = H.cx + (X - H.cx) * cmp + zc * sy;
      // 원근(폼): 돌린 뒤 카메라 쪽으로 다가온 만큼 크게, 멀어진 만큼 작게 — 머리 가운데 기준 (쉬는 자세에선 변화 0)
      if (PERSP && sy) {
        const dz = zc * (cyaw - 1) - (x - H.cx) * sy;
        const f = 1 + PERSP * dz / H.rx;
        X = H.cx + (X - H.cx) * f;
        Y = H.cy + (Y - H.cy) * f;
      }
      const dx = X - N.x;
      const dy = Y - N.y;
      o[i] = N.x + dx * cr - dy * sr + neckDX;
      o[i + 1] = N.y + dx * sr + dy * cr + neckDY;
    };
    // 중력: 머리카락은 머리에서 떨어져 나오는 높이(귀 끝, rig.hairHang.attachY)까지만 머리에 붙어 돌고,
    // 그 아래는 붙은 점을 따라 옮겨 가되 방향은 아래(중력)로 늘어짐 — 고개를 기울이거나 숙여도 어깨 위에 뻗쳐 굳어 있지 않음.
    // 붙은 점에서 band 만큼 내려가며 서서히 넘어감(가닥이 꺾이지 않게). gravity: 1 이면 완전히 아래로, 나머지는 뿌리 쪽 빳빳함
    const HG = R.hairHang ?? null;
    const gravK = t.hairHang ?? 1;
    const gravOn = !!HG && gravK > 0;
    const G = gravOn ? clamp((HG.gravity ?? 0.85) * gravK * this.gravityK(), 0, 1) : 0;
    const resid = rollAll * (1 - G);
    const cRs = Math.cos(resid);
    const sRs = Math.sin(resid);
    const hangTmp = new Float32Array(2);
    // 붙는 높이: 얼굴·귀 폭 안쪽은 귀 끝, 머리통 폭 바깥(옆으로 부푼 머리숱)은 관자놀이 높이 — 바깥 머리숱도 머리와 같이 옆으로 뻗치지 않고 늘어짐
    // side: 긴 머리(Long·가슴머리)만 — 정수리·뒤통수 머리(Back_Top 등)는 두개골 윤곽이라 귀 끝까지 머리에 붙음
    const attachAt = (x, side) => {
      if (HG.sideY == null || !side) return HG.attachY;
      const u = Math.abs(x - H.cx) / H.rx;
      return HG.attachY + (HG.sideY - HG.attachY) * smooth(HG.u0 ?? 0.9, HG.u1 ?? 1.12, u);
    };
    const longHair = (g) => /^(Long|Chest)/.test(g ?? '');
    const hangXf = (keys, x, y, o, i, depth, rk, side = false) => {
      const ay = attachAt(x, side);
      if (y <= ay) return;
      const h = hangingWeight(y - ay, HG.band);
      // Outer locks hang from the side of the head, not from a lever floating out
      // above the shoulder. Keep their lateral span in the gravity frame.
      let ax = x;
      if (side && HG.rootWidth != null) {
        const d = Math.abs(x - H.cx), limit = H.rx * HG.rootWidth, band = H.rx * (HG.rootSoft ?? 0.12);
        if (d > limit) ax = H.cx + Math.sign(x - H.cx) * (limit + band * (1 - Math.exp(-(d - limit) / band)));
      }
      if (keys) keyMove(keys, ax, ay, hangTmp, 0, depth, rk);
      else headXf(ax, ay, depth, hangTmp, 0);
      const d = y - ay;
      const sideOffset = x - ax;
      o[i] += (hangTmp[0] + cRs * sideOffset - sRs * d - o[i]) * h;
      o[i + 1] += (hangTmp[1] + sRs * sideOffset + cRs * d - o[i + 1]) * h;
      if (side && HG.shoulderRelease) {
        // A lifted root releases the shoulder bend instead of carrying that bend
        // upward as a rigid hook. Spread the correction through the neck-to-chest
        // span; use the same continuous field for every overlapping hair layer.
        const k = smooth(HG.shoulderRelease.y0, HG.shoulderRelease.y1, y);
        const relative = rollAll - bodyRoll;
        const lever = (1 - h) * (x - H.cx) + h * (ax - H.cx + (1 - G) * sideOffset);
        const lift = Math.min(0, Math.sin(relative) * lever);
        o[i + 1] -= lift * k;
        const release = clamp(-Math.sin(relative) * Math.sign(x - H.cx) / 0.45, 0, 1);
        const shoulder = k * (1 - smooth(1050, 1450, y));
        // Translate the flare with a broad lateral falloff rather than scaling
        // its width: a width scale pinches overlapping locks at extreme poses.
        const spread = smooth(H.rx * 0.35, H.rx * 1.5, Math.abs(x - H.cx));
        o[i] -= Math.sign(x - H.cx) * 40 * spread * release * shoulder;
      }
    };
    const GK = R.groupKeys ?? null;
    const topTmp = new Float32Array(2);
    const headRootFor = (set) => (p) => {
      const o = new Float32Array(2);
      const gk = GK?.[set.def.name] ?? GK?.[set.def.parts?.[0] && this.byName[set.def.parts[0]]?.group];
      if (gk) keyMove(gk, p[0], p[1], o, 0, 0, set.def.rigidKey ?? (set.def.role === 'head' && /^Hair/.test(set.def.name) ? '~hair' : null));
      else headXf(p[0], p[1], 0, o, 0);
      return { x: o[0], y: o[1], rot: rollAll };
    };
    // 머리카락 사슬의 기준 모양: 정점과 똑같이 (머리 변환 + 중력 늘어짐)
    const headRefFor = (set) => {
      const gk = GK?.[set.def.name] ?? GK?.[set.def.parts?.[0] && this.byName[set.def.parts[0]]?.group];
      const owners = (set.def.chains ?? []).map((ch) => this.byName[ch.part]);
      const sideOf = (set.def.chains ?? []).map((ch, c) => longHair(owners[c]?.group ?? ch.part));
      return (x, y, out, c) => {
        // Match each chain to the keys and parallax depth used by its mesh.
        const keys = owners[c]?.keys ?? gk;
        const depth = owners[c]?.depth ?? 0;
        if (keys) keyMove(keys, x, y, out, 0, depth, '~hair');
        else headXf(x, y, depth, out, 0);
        hangXf(keys, x, y, out, 0, depth, '~hair', !!sideOf[c]);
      };
    };
    // 몸 쪽 물리 사슬 뿌리: 그 사슬 파츠의 옷 겹을 따라 (앞치마가 출렁이면 허리 장식 뿌리도 같이)
    const propFrames = new Map();
    const propFrame = (p) => {
      if (propFrames.has(p.name)) return propFrames.get(p.name);
      const [x, y] = p.rigidPivot;
      const root = new Float64Array(2), up = new Float64Array(2);
      clothXf(p.cloth, x, y, p.bodyDepth ?? 0, root, 0);
      clothXf(p.cloth, x, y - 20, p.bodyDepth ?? 0, up, 0);
      const f = { x: root[0], y: root[1], rot: Math.atan2(up[0] - root[0], root[1] - up[1]) };
      propFrames.set(p.name, f);
      return f;
    };
    const bodyRootFor = (s) => {
      const p = this.byName[s.def.parts?.[0]];
      const L = p?.cloth ?? null;
      if (p?.rigidPivot) return () => propFrame(p);
      return (p) => {
        const o = new Float32Array(2);
        clothXf(L, p[0], p[1], 0, o, 0);
        return { x: o[0], y: o[1], rot: bodyRoll + (L ? L.dr * clothW(L, p[1]) : 0) };
      };
    };

    // 물리 한 걸음
    for (const s of this.sets) {
      const role = s.def.role;
      const hairSet = role === 'head' && gravOn && /^Hair/.test(s.def.name);
      s.set.step(role === 'head' ? headRootFor(s) : bodyRootFor(s), dt, this.time, hairSet ? headRefFor(s) : null);
    }

    const items = [];
    const eyeOpenL = clamp(P.eyeOpenL ?? 1, 0, 1.2);
    const eyeOpenR = clamp(P.eyeOpenR ?? 1, 0, 1.2);
    const smileK = smooth(0.15, 0.75, clamp(P.eyeSmile ?? 0, 0, 1));
    if (!this.eyeState) this.eyeState = { L: { open: 1, lag: 1 }, R: { open: 1, lag: 1 } };
    const m = clamp(P.mouthOpen ?? 0, 0, 1);
    // 표정 전환: 눈·눈썹 그림은 반쯤에서 한 번에 바꾸고, 바뀌는 순간 눈을 깜빡여 감춤(애니메이션 작화 방식) → 두 눈이 겹쳐 보이는 순간이 없음.
    // 입 그림은 입을 다물고 있을 때만(말하면 기본 입 조각이 움직임). 볼 홍조·효과는 서서히.
    const xw = {};
    let q = 0;
    // v6 morphs the separated features continuously. Full-face expression
    // patches would freeze gaze, duplicate lashes and replace moving lips.
    // Other models retain their authored patch crossfades.
    for (const e of Object.values(this.exprParts ?? {})) {
      const w = clamp(P[`ex_${e.name}`] ?? 0, 0, 1);
      q = Math.max(q, 4 * w * (1 - w));
      e.w = w;
      e.ws = R.faceProfile ? 0 : smooth(0.42, 0.58, w);
      e.wm = R.faceProfile ? 0 : smooth(0.25, 0.75, w) * (1 - smooth(0.08, 0.25, m));
      for (const sd of ['L', 'R']) {
        if (e[`eye${sd}`]) xw[`Eye_${sd}`] = Math.max(xw[`Eye_${sd}`] ?? 0, e.ws);
        if (e[`brow${sd}`]) xw[`Brow_${sd}`] = Math.max(xw[`Brow_${sd}`] ?? 0, e.ws);
      }
      if (e.mouth) xw.Mouth = Math.max(xw.Mouth ?? 0, e.wm);
    }
    const transBlink = R.faceProfile ? 0 : smooth(0.3, 0.75, q);
    for (const [s, o] of [['L', eyeOpenL], ['R', eyeOpenR]]) {
      const st = this.eyeState[s];
      st.open = Math.min(o, 1 - smileK, 1 - transBlink); // 눈웃음이면 눈꺼풀이 덮음, 표정 바뀔 때 깜빡
      st.lag += (st.open - st.lag) * (R.faceProfile ? 1 - Math.exp(-dt * 55) : Math.min(1, dt * 16));
      st.smile = R.faceProfile && !this.hasSmileEye ? 0 : smileK;
    }
    // 효과·상황 층: 평소(정면)엔 안 보이고 그 상황에만 (원본 그림 그대로 보이게)
    const aegyo = clamp(Math.max(P.eyeSmile ?? 0, (P.ex_smile ?? 0) * 0.7, P.cheekSquint ?? 0), 0, 1);
    const fxValue = (k) => (k === 'smileCrease' ? clamp(P.mouthForm ?? 0, 0, 1) : k === 'aegyo' ? aegyo
      : k === 'pupilRing' ? clamp(Math.abs(P.pupil ?? 0) * 1.5, 0, 1) : clamp(P[k] ?? 0, 0, 1));
    for (const p of this.parts) {
      if (this.hidden.has(p.name)) continue;
      // Replaced front locks stay in the source model for editing, but cannot
      // contribute a draw item. Avoid deforming and uploading them every frame.
      if (R.motionProfile && p.overlap_hidden) continue;
      if (R.motionProfile && !p.mask) {
        const expression = this.exprParts?.[p.group];
        if (p.fx && fxValue(p.fx) <= .001) continue;
        if (R.faceProfile && expression && (p.exprRole !== 'other' || expression.w <= .001)) continue;
        if (R.faceProfile && ((p.group === 'Mouth_Open' && m <= .005) || (p.group === 'Mouth' && m >= .06))) continue;
      }
      this.localDeform(p, P);
      if (p.armSide) this.armDeform(p, P);
      const L = p.local;
      const base = p.base;
      if (p.role === 'head' && p.keys) {
        // 같은 층(앞머리·뒷머리)의 조각은 모델에서 같은 키·같은 깊이를 받음 → 같은 자리는 같이 움직여 틈이 안 생김
        // p.top: 정수리 쪽(y0 위)은 다른 층(앞머리)과 똑같이, y1 아래로 갈수록 제 키·깊이로 — 정수리에서 앞·뒷머리가 벌어지지 않게
        const T = p.top;
        const hairG = gravOn && /^Hair/.test(p.l1 ?? '');
        const sideP = longHair(p.group);
        for (let i = 0; i < L.length; i += 2) {
          keyMove(p.keys, L[i], L[i + 1], base, i, p.depth ?? 0, p.rigidKey);
          if (p.slide) base[i] -= sy * H.rx * 0.05 * p.slide; // 머리 하이라이트: 돌리는 반대쪽으로 살짝 미끄러짐(반사광)
          if (T) {
            const s = 1 - smooth(T.y0, T.y1, L[i + 1]);
            if (s > 0) {
              keyMove(T.keys, L[i], L[i + 1], topTmp, 0, T.depth);
              base[i] += (topTmp[0] - base[i]) * s;
              base[i + 1] += (topTmp[1] - base[i + 1]) * s;
            }
          }
          if (hairG) hangXf(p.keys, L[i], L[i + 1], base, i, p.depth ?? 0, p.rigidKey, sideP);
        }
        if (p.hang && !hairG) {
          // 늘어진 머리: 목 높이에서 목과 같은 비율로 머리→몸을 따름 (목 위끝까지는 머리, 목 아래끝부터는 거의 몸)
          // 높이로만 정해져 이웃 조각과 같이 움직이고, 목 옆 가닥이 목 위로 미끄러지지 않음
          const y0h = N.top;
          const y1h = N.bottom;
          const tmp = new Float32Array(2);
          for (let i = 0; i < L.length; i += 2) {
            const w = 1 - smooth(y0h, y1h, L[i + 1]) * 0.8;
            const dx = L[i] - N.x;
            const dy = L[i + 1] - N.y;
            tmp[0] = N.x + dx * cr - dy * sr + neckDX;
            tmp[1] = N.y + dx * sr + dy * cr + neckDY;
            base[i] = tmp[0] + (base[i] - tmp[0]) * w;
            base[i + 1] = tmp[1] + (base[i + 1] - tmp[1]) * w;
          }
        }
      } else if (p.role === 'head') {
        for (let i = 0; i < L.length; i += 2) headXf(L[i], L[i + 1], p.depth ?? 0, base, i);
      } else if (p.role === 'neck') {
        // 목: 위쪽은 머리를(깊이 0), 아래쪽은 몸을 따름
        const tmp = new Float32Array(2);
        for (let i = 0; i < L.length; i += 2) {
          const w = neckAttachmentWeight(L[i + 1], N, R.overlapProfile);
          if (WK) keyMove(null, L[i], L[i + 1], tmp, 0, 0, 'neck');
          else headXf(L[i], L[i + 1], 0, tmp, 0);
          bodyXf(L[i], L[i + 1], 0, base, i);
          base[i] += (tmp[0] - base[i]) * w;
          base[i + 1] += (tmp[1] - base[i + 1]) * w;
        }
      } else if (p.rigidPivot) {
        const f = propFrame(p), c = Math.cos(f.rot), s = Math.sin(f.rot);
        for (let i = 0; i < L.length; i += 2) {
          const x = L[i] - p.rigidPivot[0], y = L[i + 1] - p.rigidPivot[1];
          base[i] = f.x + x * c - y * s;
          base[i + 1] = f.y + x * s + y * c;
        }
      } else {
        for (let i = 0; i < L.length; i += 2) clothXf(p.cloth, L[i], L[i + 1], p.bodyDepth ?? 0, base, i);
      }
      const set = this.setOf[p.name];
      let out = base;
      if (set) {
        set.set.deform(set.binds[p.name], base, p.out);
        out = p.out;
      }
      this.r.updatePositions(p.mesh, out);

      // 보이기: 깜빡임·눈웃음·입 벌림 교체
      let op = p.hidden ? 0 : 1;
      const g = p.group;
      const nm = p.name;
      if (g === 'Eye_L' || g === 'Eye_R' || g === 'EyeFX_L' || g === 'EyeFX_R') {
        const sd = g.endsWith('L') ? 'L' : 'R';
        const st = this.eyeState[sd];
        if (nm.startsWith('EyeShadow') || nm.startsWith('EyeInner')) op = 1;
        else if (nm.startsWith('EyeLid')) op = st.open < 0.985 ? 1 : 0;
        else if (p.lid === 'aegyo' || p.lid === 'low') op = 1;
        else op = smooth(0.03, 0.08, st.open); // 거의 감았을 때 감은 눈 그림으로 짧게 바뀜
        if (nm.startsWith('EyeHL')) op *= 0.86 + 0.14 * Math.sin(this.time * 3.1 + p.phase); // 반짝임
        // 표정 눈이 나와 있으면 기본 눈은 숨김 (깜빡일 때는 기본 눈이 감김)
        if (!nm.startsWith('EyeShadow') && !nm.startsWith('EyeInner')) op *= 1 - (xw[`Eye_${sd}`] ?? 0) * smooth(0.55, 0.9, st.open);
      } else if (g === 'Brow_L' || g === 'Brow_R') {
        op = 1 - (xw[g] ?? 0);
      } else if (g === 'Eye_Closed') {
        const st = this.eyeState[nm.endsWith('L') ? 'L' : 'R'];
        op = (1 - smooth(0.03, 0.08, st.open)) * (1 - st.smile);
      } else if (g === 'Eye_Smile') {
        op = this.eyeState[nm.endsWith('L') ? 'L' : 'R'].smile;
      } else if (nm.startsWith('Crease')) {
        const st = this.eyeState[nm.endsWith('L') ? 'L' : 'R'];
        op = smooth(0.15, 0.45, st.open); // 쌍꺼풀선은 감으면 감은 눈 선에 묻힘
      } else if (g === 'Mouth_Open') {
        op = (R.faceProfile ? smooth(.005, .06, m) : R.mouth?.mode === 'patch' ? smooth(0.05, 0.45, m) : smooth(0.03, 0.1, m)) * (1 - (xw.Mouth ?? 0));
        if (R.faceProfile && /^(Teeth|Gum|Fang)/.test(nm)) op *= smooth(.14, .34, m);
        if (R.faceProfile && /^(Tongue|MouthUvula)/.test(nm)) op *= smooth(.24, .5, m);
      } else if (this.exprParts?.[g]) {
        // 표정 덧그림: 눈은 반쯤에서 바꾸고(깜빡이는 동안), 감으면 기본 감은 눈이 보임
        const e = this.exprParts[g];
        const r = p.exprRole;
        if (r === 'eyeL' || r === 'eyeR') op = e.ws * smooth(0.55, 0.9, this.eyeState[r.slice(3)].open);
        else if (r === 'browL' || r === 'browR') op = e.ws;
        else if (r === 'mouth') op = e.wm;
        else op = e.w;
      } else if (this.exprOfGroup?.[g]) {
        op = clamp(P[`ex_${this.exprOfGroup[g]}`] ?? 0, 0, 1); // 표정 덧그림
      } else if (g === 'Mouth') {
        op = (1 - (R.faceProfile ? smooth(.005, .06, m) : smooth(0.03, 0.1, m))) * (1 - (xw.Mouth ?? 0));
      }
      if (p.fx) op *= fxValue(p.fx); // 감정 효과·눈물·볼 부풀리기 등: 켤 때만
      if (p.surface) {
        // Facets stay registered to their owning garment. Only their light
        // contribution changes; detached shadows never slide across seams.
        const v = p.surface;
        const yawLight = p.role === 'head' ? yaw : bodyYaw;
        const pitchLight = p.role === 'head' ? pitch : lean;
        const illumination = v.nx * Math.sin(yawLight) + v.ny * Math.sin(pitchLight);
        op *= clamp(1 - illumination * (v.response ?? 0.5), 0.65, 1);
      }
      if (p.fallOp !== undefined) op *= clamp(p.fallOp, 0, 1);
      if (op <= 0.001) continue;
      // 잘라 그리기: 흰자 안쪽에만 눈동자, 입안 안쪽에만 이·혀
      const name = p.name;
      if (p.mask) {
        items.push({ mesh: p.mesh, opacity: 1, writeMask: p.mask }); // 가림판(눈 트임): 그리지 않고 잘라 그리기 범위만
        continue;
      }
      if (name.startsWith('ScleraBase_')) items.push({ mesh: p.mesh, opacity: 1, writeMask: 1 });
      if (name === 'MouthOpen_Inner') items.push({ mesh: p.mesh, opacity: 1, writeMask: 2 });
      const it = { mesh: p.mesh, opacity: op };
      if (name.startsWith('Iris') || name.startsWith('Pupil') || name.startsWith('EyeHL') || name.startsWith('ScleraShade') || name.startsWith('EyeLid')) it.clipBy = 1;
      if (name.startsWith('Teeth') || name.startsWith('Fang') || name.startsWith('Tongue')) it.clipBy = 2;
      if (name.startsWith('EyeFX')) it.clipBy = 1;
      if (p.clip) it.clipBy = p.clip;
      items.push(it);
    }
    return items;
  }
}
