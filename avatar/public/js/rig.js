// 리그 엔진: 파라미터 → 레이어별 정점 위치.
// 머리는 타원체 표면에 레이어별 깊이(z)를 더한 2.5D 회전으로 움직이고,
// 눈·입은 원본 선을 따라 변형하거나 절차적으로 그린 스프라이트로 바꿔 끼운다.
import { gridMesh } from './renderer.js';
import { drawClosedEye, interp, MouthSprite } from './procedural.js';
import { Strand, StrandSet, bindStrand, deformStrand } from './strands.js';

export const PARAMS = {
  angleX: { min: -30, max: 30, def: 0, label: '고개 좌우' },
  angleY: { min: -30, max: 30, def: 0, label: '고개 위아래' },
  angleZ: { min: -30, max: 30, def: 0, label: '고개 기울기' },
  eyeOpenL: { min: 0, max: 1.2, def: 1, label: '왼눈 뜨기' },
  eyeOpenR: { min: 0, max: 1.2, def: 1, label: '오른눈 뜨기' },
  eyeSmile: { min: 0, max: 1, def: 0, label: '눈웃음' },
  eyeBallX: { min: -1, max: 1, def: 0, label: '눈동자 좌우' },
  eyeBallY: { min: -1, max: 1, def: 0, label: '눈동자 위아래' },
  brow: { min: -1, max: 1, def: 0, label: '눈썹' },
  mouthOpen: { min: 0, max: 1, def: 0, label: '입 벌리기' },
  mouthForm: { min: -1, max: 1, def: 0, label: '입꼬리' },
  mouthNarrow: { min: 0, max: 1, def: 0, label: '입 오므리기' },
  bodyX: { min: -10, max: 10, def: 0, label: '몸 좌우' },
  bodyZ: { min: -16, max: 16, def: 0, label: '몸 기울기' },
  bodyYaw: { min: -10, max: 10, def: 0, label: '몸 돌리기' },
  bodyLean: { min: -10, max: 10, def: 0, label: '몸 숙이기' },
  armR: { min: -15, max: 40, def: 0, label: '팔 들기 (화면 왼쪽)' },
  armL: { min: -15, max: 40, def: 0, label: '팔 들기 (화면 오른쪽)' },
  elbowR: { min: -15, max: 60, def: 0, label: '팔꿈치 굽히기 (화면 왼쪽)' },
  elbowL: { min: -15, max: 60, def: 0, label: '팔꿈치 굽히기 (화면 오른쪽)' },
  breath: { min: 0, max: 1, def: 0, label: '호흡' },
  glasses: { min: 0, max: 1, def: 0, label: '안경' },
  mouthWide: { min: 0, max: 1, def: 0, label: '입 옆으로 (이·에)' },
  sleep: { min: 0, max: 1, def: 0, label: '졸기 (자리 비움)' },
  heart: { min: 0, max: 1, def: 0, label: '하트' },
  talk: { min: 0, max: 1, def: 0, label: '말할 때 들썩임' },
  fxRain: { min: 0, max: 1, def: 0, label: '효과: 화면 가득 하트' },
  fxFire: { min: 0, max: 1, def: 0, label: '효과: 불꽃놀이' },
  fxSpark: { min: 0, max: 1, def: 0, label: '효과: 반짝이' },
  // 큰 반응(reactions.js)이 쓰는 값 — 맞는 파라미터가 없는 모델에서는 아무 일도 없음 (v10 전신 Cubism 은 모두 있음)
  shoulder: { min: -1, max: 1, def: 0, label: '어깨 (+ 으쓱 · − 처짐)' },
  bodyY: { min: -1, max: 1, def: 0, label: '몸 위아래 (+ 뜀 · − 무릎)' },
  blush: { min: 0, max: 1, def: 0, label: '홍조' },
  tear: { min: 0, max: 1, def: 0, label: '눈물 (0.5 고임 · 1 흐름)' },
  sweat: { min: 0, max: 1, def: 0, label: '땀' },
  gloom: { min: 0, max: 1, def: 0, label: '그늘선' },
  anger: { min: 0, max: 1, def: 0, label: '화남 표시' },
  heartEyes: { min: 0, max: 1, def: 0, label: '하트 눈' },
  blankEyes: { min: 0, max: 1, def: 0, label: '흰 눈' },
  // 떠 있는 손 (effects.js 가 그림): R = 화면 왼쪽 손. W = 쉬는 자리 → 목표, X·Y = 머리 가운데 기준 목표 (머리 반지름 단위), Rot = 돌림(°)
  handRW: { min: 0, max: 1, def: 0, label: '떠 있는 손 (화면 왼쪽)' },
  handRX: { min: -2.5, max: 2.5, def: -1.2, label: '└ 좌우' },
  handRY: { min: -1.5, max: 3, def: 0.35, label: '└ 위아래' },
  handRRot: { min: -60, max: 60, def: 0, label: '└ 돌리기' },
  handLW: { min: 0, max: 1, def: 0, label: '떠 있는 손 (화면 오른쪽)' },
  handLX: { min: -2.5, max: 2.5, def: 1.2, label: '└ 좌우' },
  handLY: { min: -1.5, max: 3, def: 0.35, label: '└ 위아래' },
  handLRot: { min: -60, max: 60, def: 0, label: '└ 돌리기' },
  sayHi: { min: 0, max: 1, def: 0, label: "말풍선 '하이~'" },
  sayBye: { min: 0, max: 1, def: 0, label: "말풍선 '바이바이~'" },
};

export function defaultParams() {
  const p = {};
  for (const [k, v] of Object.entries(PARAMS)) p[k] = v.def;
  return p;
}

// rig.json 으로 덮어쓸 수 있는 조정값
export const DEFAULT_TUNING = {
  yawScale: 0.8, // 파라미터 각도 → 실제 회전 비율
  pitchScale: 0.6,
  rollScale: 1.0,
  headDepth: 0.62, // 머리 타원체 z 반지름 / x 반지름
  zFrontHair: 0.1, // 앞머리 추가 깊이 (머리 x 반지름 비율)
  zBackHair: 0.12,
  zFace: 0.04, // 눈·코·입이 피부 위로 떠 있는 정도
  zEar: -0.15,
  zGlasses: 0.06, // 안경이 눈 앞으로 떠 있는 거리 (머리 x 반지름 비율, 클수록 고개를 돌릴 때 눈보다 더 밀림)
  closeRatio: 0.3, // 감은 눈 선 위치: 아래 눈꺼풀에서 눈 높이의 몇 % 위
  irisRangeX: 0.16, // 눈동자 이동량 (눈 너비 비율)
  irisRangeY: 0.1,
  exprIrisScale: 0.45, // 표정 눈의 눈동자 이동 폭 (기본 얼굴 대비)
  hairFreq: 2.0, // 머리카락 흔들림 고유 진동수 (Hz)
  hairBackFreq: 1.4,
  hairDamping: 0.32,
  hairMax: 26, // 최대 흔들림 px
  hairGravity: 0.35, // 고개를 기울일 때 머리끝이 아래로 남는 정도
  hairHang: 1, // (파츠 모델) 머리카락이 귀 끝 아래로 중력 방향으로 늘어지는 정도 — 0 이면 머리와 같이 돎
  gravity: 1, // (파츠 모델) 중력 세기 배율 — 머리카락·옷 겹·장신구가 몸·고개를 기울여도 아래로 늘어지는 정도 (모델 기본값 rig.gravityBase 에 곱함)
  clothMotion: 1, // (파츠 모델) 옷 겹(재킷·조끼·넥타이·앞치마)이 몸을 늦게 따라오며 출렁이는 정도
  earringFreq: 1.3,
  earringDamping: 0.12,
  breathAmount: 0.012,
  bodyFollow: 1.0,
  // 옷·장신구 (겹마다 따로)
  jacketFreq: 1.5, // 재킷 흔들림 고유 진동수 (낮을수록 묵직)
  jacketDamping: 0.3,
  jacketMax: 16, // 재킷 최대 흔들림 px
  jacketGravity: 0.4, // 몸을 기울일 때 밑단이 덜 따라 도는 정도
  innerFreq: 3.2, // 셔츠는 몸에 붙어 단단하게
  innerMax: 4,
  necklaceFreq: 1.15,
  necklaceDamping: 0.12,
  broochFreq: 1.7,
  broochDamping: 0.1,
  layerDepth: 1.0, // 몸을 돌릴 때 겹 사이 시차 배율
  clothWind: 1.0, // 가만히 있을 때 옷이 살랑이는 정도
  // 가닥 물리 (모델 레이어에 strand 가 있을 때만: 고품질 모델의 머리 다발·귀걸이·사슬)
  strandFreq: 1.0, // 가닥마다 정한 진동수에 곱함 (낮을수록 늘어지고 묵직)
  strandDamping: 1.0, // 감쇠에 곱함 (낮을수록 오래 찰랑)
  strandInertia: 1.0, // 고개 움직임에 반응하는 정도
  strandWind: 1.0, // 가만히 있을 때 살랑이는 정도
};

// 몸 레이어 역할별 시차 깊이(px): 몸을 돌리면 깊이만큼 밀려 겹이 드러난다
const BODY_Z = { 'body-inner': 0, neck: 0, handwear: 6, 'body-jacket': 10, sleeve: 10, topwear: 6, necklace: 14, brooch: 16 };

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`이미지를 불러오지 못했습니다: ${url}`));
    img.src = url;
  });
}

function readAlpha(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

class Spring {
  constructor() {
    this.m = null;
    this.v = 0;
  }
  // a: 기준점(머리 위치), 반환: 기준점에서 뒤처진 정도
  step(a, dt, freq, damping, max) {
    if (this.m === null) this.m = a;
    const w = 2 * Math.PI * freq;
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const acc = w * w * (a - this.m) - 2 * damping * w * this.v;
      this.v += acc * h;
      this.m += this.v * h;
    }
    let off = this.m - a;
    if (Math.abs(off) > max) {
      off = Math.sign(off) * max;
      this.m = a + off;
      this.v *= 0.5;
    }
    return off;
  }
}

class Pendulum {
  constructor() {
    this.phi = 0;
    this.w = 0;
    this.prev = null;
    this.prevV = null;
  }
  // ax, ay: 고정점의 화면 위치, len: 길이(px)
  step(ax, ay, dt, len, freq, damping) {
    if (dt <= 0) return this.phi;
    let accX = 0;
    let accY = 0;
    if (this.prev) {
      const vx = (ax - this.prev[0]) / dt;
      const vy = (ay - this.prev[1]) / dt;
      if (this.prevV) {
        accX = clamp((vx - this.prevV[0]) / dt, -40000, 40000);
        accY = clamp((vy - this.prevV[1]) / dt, -40000, 40000);
      }
      this.prevV = [vx, vy];
    }
    this.prev = [ax, ay];
    const w0 = 2 * Math.PI * freq;
    const g = w0 * w0 * len;
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const a = (-(g + accY) * Math.sin(this.phi) - accX * Math.cos(this.phi)) / len - 2 * damping * w0 * this.w;
      this.w += a * h;
      this.phi += this.w * h;
    }
    this.phi = clamp(this.phi, -1.2, 1.2);
    return this.phi;
  }
}

// 표정에 따라 바뀌는 얼굴 파츠
const FACE_BASES = new Set(['eyewhite', 'irides', 'eyelash', 'eyebrow', 'mouth', 'nose']);

const HEAD_TAGS = new Set([
  'front hair', 'back hair', 'face', 'headwear', 'eyewear', 'ears', 'ears-l', 'ears-r', 'earwear',
  'nose', 'mouth', 'eyes', 'eyel', 'eyer', 'browl', 'browr',
  'closed', 'smile', 'mouthOpen', // 그림으로 그린 감은 눈·웃는 눈·벌린 입 (고퀄 모델)
  'eyeov', 'browov', 'mouthov', 'faceov', // 고퀄 모델 표정 덧그림 (눈·눈썹·입·홍조)
]);

function baseTag(tag) {
  return tag.replace(/-(l|r)$/, '');
}

function sideOf(tag) {
  const m = tag.match(/-(l|r)$/);
  return m ? m[1] : null;
}

export class Avatar {
  constructor(renderer, model, tuning = {}) {
    this.r = renderer;
    this.model = model;
    this.rig = model.rig;
    this.t = { ...DEFAULT_TUNING, ...tuning };
    this.parts = [];
    this.springs = {
      front: new Spring(), back: new Spring(), frontY: new Spring(),
      jacketX: new Spring(), jacketY: new Spring(), innerX: new Spring(), innerY: new Spring(),
    };
    this.pendulum = new Pendulum();
    this.pendulums = { necklace: new Pendulum(), brooch: new Pendulum() };
    this.time = 0;
    this.hidden = new Set();
    // 표정 (expressions.json → model.rig.expressions): 표정마다 파라미터 ex_<이름> (0~1)
    this.expressions = model.rig.expressions ?? {};
    this.exprNames = Object.keys(this.expressions);
    this.exprParts = [];
    for (const [name, ex] of Object.entries(this.expressions)) {
      PARAMS[`ex_${name}`] = { min: 0, max: 1, def: 0, label: `표정: ${ex.label}` };
    }
  }

  // 물리 상태를 처음으로 (확인용 렌더링 등)
  resetPhysics() {
    for (const p of this.parts) p.strand?.reset();
    for (const set of Object.values(this.strandSets ?? {})) set.reset();
    for (const k of Object.keys(this.springs)) this.springs[k] = new Spring();
    this.pendulum = new Pendulum();
    for (const k of Object.keys(this.pendulums)) this.pendulums[k] = new Pendulum();
  }

  setTuning(t) {
    const changed = Object.keys(t).filter((k) => this.t[k] !== t[k]);
    if (!changed.length) return;
    Object.assign(this.t, t);
    if (changed.includes('closeRatio') && this.extra) this.refreshClosedEyes();
    else this.prepareStatic();
    if (changed.some((k) => k.startsWith('strand'))) {
      for (const p of this.parts) if (p.strandDef) this.makeStrand(p);
      if (this.order) this.makeStrandSets();
    }
  }

  async layerPart(baseUrl, L) {
    const img = await loadImage(`${baseUrl}/${L.file}`);
    const alpha = readAlpha(img);
    const tex = this.r.createTexture(img);
    const g = gridMesh(L.x, L.y, L.w, L.h, alpha, 20);
    const mesh = this.r.createMesh(tex, g.positions, g.uvs, g.indices);
    const tag = L.tag;
    const bt = L.role ?? baseTag(tag); // 보정 레이어는 role 에 적힌 파츠처럼 움직인다
    return {
      tag,
      base: bt,
      side: sideOf(tag),
      head: HEAD_TAGS.has(bt) || bt.startsWith('eye') || bt === 'irides',
      face: FACE_BASES.has(bt) || bt === 'mouthOpen', // 표정에 따라 바뀌는 얼굴 파츠
      layer: L,
      toggle: L.toggle ?? null, // 켜고 끄는 액세서리 (파라미터 이름)
      erase: !!L.erase, // 소품 지우개: 그리지 않고, 소품을 쓰면 이 자리의 머리를 숨긴다
      eraseTarget: L.eraseTarget ?? 'hair', // body: 옷을 갈아입으면 새 옷 밖으로 나오는 원래 몸(손·재킷 밑단)을 숨긴다
      mesh,
      base0: g.positions.slice(),
      out: new Float32Array(g.positions.length),
      strandDef: L.strand ?? null, // { spine: [[x,y],…] 뿌리→끝, freq, damping, inertia, hang, wind, phase, maxBend, rootFix }
    };
  }

  // 가닥 물리 만들기: 튜닝 배율을 곱한 값으로 (튜닝을 바꾸면 다시 만듦)
  makeStrand(p) {
    const d = p.strandDef;
    const t = this.t;
    const o = {
      freq: (d.freq ?? 1.6) * t.strandFreq,
      damping: (d.damping ?? 0.22) * t.strandDamping,
      inertia: (d.inertia ?? 1) * t.strandInertia,
      hang: d.hang ?? 0.35,
      wind: (d.wind ?? 0.6) * t.strandWind,
      phase: d.phase ?? (p.tag.length * 1.37) % 6.28,
      maxBend: d.maxBend ?? 0.45,
      tipLag: d.tipLag ?? 0.5,
    };
    p.strand = new Strand(d.spine, o);
    // 정점 가중치: 뿌리 쪽 rootFix(뼈대 길이 비율)까지는 머리에 붙어 있고, 그 아래로 갈수록 가닥 물리를 따름
    const fix = d.rootFix ?? 0.15;
    const segs = d.spine.length - 1;
    const w = new Float32Array(p.base0.length / 2);
    const tmp = bindStrand(p.strand, p.base0);
    for (let i = 0; i < w.length; i++) {
      const along = clamp((tmp[5 * i] + clamp(tmp[5 * i + 1], 0, 1)) / segs, 0, 1);
      w[i] = smooth(fix * 0.4, fix + 0.12, along);
    }
    p.sbind = bindStrand(p.strand, p.base0, w);
    p.sbase = new Float32Array(p.base0.length);
    p.strandAt = -1;
  }

  async load(baseUrl) {
    for (const L of this.model.layers) this.parts.push(await this.layerPart(baseUrl, L));
    // 표정 파츠: 같은 역할(흰자·눈동자·속눈썹·눈썹·입)로 움직이되 표정마다 눈꺼풀 곡선·입 모양이 다르다
    for (const [name, ex] of Object.entries(this.expressions)) {
      for (const L of ex.layers) {
        const part = await this.layerPart(baseUrl, L);
        Object.assign(part, {
          tag: `${name}:${L.tag}`, srcTag: L.tag, expr: name, head: true, face: false,
          eyeGeom: part.side ? ex.eyes?.[part.side] ?? null : null,
          mouthGeom: ex.mouth, mouthType: ex.mouthType,
        });
        this.exprParts.push(part);
      }
      if (ex.mouth && ex.mouthType === 'line') {
        const ms = new MouthSprite(ex.mouth);
        ms.draw(0, 0, 0);
        const sp = this.spritePart('mouthOpen', ms.canvas, ms.x, ms.y, ms.w, ms.h, null, false);
        Object.assign(sp, { tag: `${name}:mouthOpen`, base: 'mouthOpen', expr: name, mouthSprite: ms });
        this.exprParts.push(sp);
      }
    }
    // 절차적 스프라이트: 감은 눈 ×2, 웃는 눈 ×2, 벌린 입
    this.extra = {};
    const hasLayer = (tag) => this.parts.some((p) => p.tag === tag);
    for (const side of ['l', 'r']) {
      const eye = this.rig.eyes?.[side];
      if (!eye) continue;
      for (const kind of ['closed', 'smile']) {
        if (hasLayer(`${kind}-${side}`)) continue; // 그림 레이어 사용
        const s = drawClosedEye({ ...eye, side }, this.t.closeRatio, { smile: kind === 'smile' });
        this.extra[`${kind}-${side}`] = this.spritePart(`${kind}-${side}`, s.canvas, s.x, s.y, s.w, s.h, side);
      }
    }
    if (this.rig.mouth && !this.parts.some((p) => p.base === 'mouthOpen')) {
      this.mouthSprite = new MouthSprite(this.rig.mouth);
      const ms = this.mouthSprite;
      ms.draw(0, 0, 0);
      this.extra.mouthOpen = this.spritePart('mouthOpen', ms.canvas, ms.x, ms.y, ms.w, ms.h, null, false);
      this.extra.mouthOpen.face = true;
      this.extra.mouthOpen.mouthSprite = ms;
    }
    this.prepareStatic();
    for (const p of this.parts) if (p.strandDef) this.makeStrand(p);
    this.makeStrandSets();
    this.buildOrder();
  }

  // 머리 한 장에 사슬 여러 개 (model.json 의 rig.strandSets: { 역할: { radius, chains } }).
  // 같은 역할(예: front hair)로 움직이는 레이어(앞머리·앞머리 틈 보강·머리 채움)는 모두 같은 사슬로 함께 휜다
  makeStrandSets() {
    const sets = this.rig.strandSets ?? {};
    const t = this.t;
    this.strandSets = {};
    for (const [role, def] of Object.entries(sets)) {
      if (!def?.chains?.length) continue;
      this.strandSets[role] = new StrandSet(def, { freq: t.strandFreq, damping: t.strandDamping, inertia: t.strandInertia, wind: t.strandWind });
    }
    for (const p of this.parts) {
      const set = this.strandSets[p.base];
      p.sset = set && !p.strandDef ? set : null;
      p.ssetBind = p.sset ? p.sset.bind(p.base0) : null;
      if (p.sset) p.sbase = new Float32Array(p.base0.length);
    }
  }

  spritePart(tag, canvas, x, y, w, h, side, mipmap = true) {
    const tex = this.r.createTexture(canvas, { mipmap });
    const g = gridMesh(x, y, w, h, null, 12);
    const mesh = this.r.createMesh(tex, g.positions, g.uvs, g.indices);
    return { tag, base: tag.split('-')[0], side, head: true, mesh, base0: g.positions.slice(), out: new Float32Array(g.positions.length), sprite: true };
  }

  refreshClosedEyes() {
    for (const side of ['l', 'r']) {
      const eye = this.rig.eyes?.[side];
      if (!eye) continue;
      for (const kind of ['closed', 'smile']) {
        if (!this.extra[`${kind}-${side}`]) continue; // 그림 레이어 사용
        const s = drawClosedEye({ ...eye, side }, this.t.closeRatio, { smile: kind === 'smile' });
        const old = this.extra[`${kind}-${side}`];
        const fresh = this.spritePart(`${kind}-${side}`, s.canvas, s.x, s.y, s.w, s.h, side);
        Object.assign(old, fresh);
      }
    }
    this.prepareStatic();
  }

  // 두 눈 가운데의 깊이 (눈·눈동자 레이어와 같은 식). 눈 기준점이 없으면 레이어 가운데로 대신한다.
  eyeDepth(p) {
    const H = this.rig.head;
    const t = this.t;
    const pts = Object.values(this.rig.eyes ?? {}).map((e) => [e.cx ?? (e.x0 + e.x1) / 2, e.cy]);
    if (!pts.length || pts.some(([, y]) => y === undefined)) {
      pts.length = 0;
      pts.push(p.layer ? [p.layer.x + p.layer.w / 2, p.layer.y + p.layer.h / 2] : [H.cx, H.cy]);
    }
    let z = 0;
    for (const [x, y] of pts) {
      const u = (x - H.cx) / H.rx;
      const v = (y - H.cy) / H.ry;
      const s = u * u + v * v;
      z += (s < 1 ? Math.sqrt(1 - s) : 0) * H.rx * t.headDepth + t.zFace * H.rx;
    }
    return z / pts.length;
  }

  // 정점별로 변하지 않는 값(구면 z, 머리카락 가중치 등)을 미리 계산
  prepareStatic() {
    const H = this.rig.head;
    const t = this.t;
    const all = [...this.parts, ...this.exprParts, ...Object.values(this.extra ?? {})];
    for (const p of all) {
      const n = p.base0.length / 2;
      p.z = new Float32Array(n);
      p.w = new Float32Array(n); // 흔들림 가중치
      p.zp = new Float32Array(n); // 위아래 회전용 깊이 (턱 끝은 고정)
      const bt = p.base;
      let zAdd = 0;
      let zMul = 1;
      if (bt === 'front hair' || bt === 'headwear' || bt === 'eyewear') zAdd = t.zFrontHair * H.rx;
      else if (bt === 'back hair') {
        zMul = -0.5;
        zAdd = -t.zBackHair * H.rx;
      } else if (bt === 'ears' || bt === 'earwear') zAdd = t.zEar * H.rx;
      else if (bt !== 'face' && p.head) zAdd = t.zFace * H.rx;
      const hairRoot = H.cy - H.ry * 0.85;
      const hairTip = p.layer ? p.layer.y + p.layer.h : H.cy + H.ry;
      for (let i = 0; i < n; i++) {
        const x = p.base0[2 * i];
        const y = p.base0[2 * i + 1];
        const u = (x - H.cx) / H.rx;
        const v = (y - H.cy) / H.ry;
        const s = u * u + v * v;
        const zs = s < 1 ? Math.sqrt(1 - s) : 0;
        p.z[i] = zs * H.rx * t.headDepth * zMul + zAdd;
        // 머리 타원 아래쪽 20%(턱 근처)는 위아래 회전 때 움직이지 않게 — 턱 밑이 벌어지지 않도록
        p.zp[i] = p.z[i] * (1 - smooth(0.78, 1.0, v));
        if (bt === 'front hair' || bt === 'back hair') {
          const k = smooth(hairRoot, hairTip, y);
          // 얼굴 위쪽 정수리 부분은 거의 고정, 아래로 갈수록 크게 흔들림
          p.w[i] = Math.pow(k, 1.6);
        }
      }
      // 안경은 단단한 물체: 얼굴 곡면을 따라 정점마다 깊이를 다르게 주면 고개를 돌릴 때 고무처럼 휘므로,
      // 모든 정점에 같은 깊이(두 눈 깊이 + 얼굴에서 떠 있는 거리)를 줘서 한 덩어리로 옮기고 돌린다.
      if (bt === 'eyewear') {
        const zG = this.eyeDepth(p) + t.zGlasses * H.rx;
        const yc = p.layer ? p.layer.y + p.layer.h / 2 : H.cy;
        const zpG = zG * (1 - smooth(0.78, 1.0, (yc - H.cy) / H.ry));
        p.z.fill(zG);
        p.zp.fill(zpG);
        p.w.fill(0);
      }
      if (!p.head) this.prepareBody(p);
      // 귀걸이: 고정점 아래만 진자 운동
      if (bt === 'earwear' && this.rig.earring) {
        const E = this.rig.earring;
        for (let i = 0; i < n; i++) {
          const x = p.base0[2 * i];
          const y = p.base0[2 * i + 1];
          const inX = x > E.x0 - 6 && x < E.x1 + 6;
          p.w[i] = inX ? smooth(E.ay - 2, E.ay + 14, y) : 0;
        }
      }
    }
  }

  // 몸 레이어: 흔들림 가중치(bw), 진자 가중치(pw), 시차 깊이(bz)
  prepareBody(p) {
    const n = p.base0.length / 2;
    const C = this.rig.clothes;
    p.bw = new Float32Array(n);
    p.pw = null;
    p.bz = BODY_Z[p.base] ?? 0;
    if (!C) return;
    const b = C.body;
    const jacketW = (x, y) => {
      const wy = Math.pow(smooth(b.top + 50, b.hem, y), 1.3); // 어깨는 고정, 밑단으로 갈수록
      const dx = Math.abs(x - b.cx);
      const sleeve = smooth(b.innerHalf + 90, b.innerHalf + 230, dx) * smooth(b.top + 20, b.top + 140, y); // 소매 끝
      return clamp(Math.max(wy, sleeve * 0.9), 0, 1);
    };
    const pend = p.base === 'necklace' ? C.necklace : p.base === 'brooch' ? C.brooch : null;
    if (pend) p.pw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = p.base0[2 * i];
      const y = p.base0[2 * i + 1];
      if (p.base === 'body-jacket' || p.base === 'topwear' || p.base === 'sleeve') p.bw[i] = jacketW(x, y); // 떼어 낸 소매도 재킷과 같이 출렁임
      else if (p.base === 'body-inner') p.bw[i] = smooth(b.top + 60, b.hem, y);
      else if (p.base === 'handwear') p.bw[i] = jacketW(x, y); // 손은 겹쳐 있는 소매와 똑같이 (안 그러면 소매 속 손이 삐져나옴)
      else if (p.base === 'brooch' && C.brooch) p.bw[i] = jacketW(C.brooch.ax, C.brooch.ay); // 핀은 재킷에 붙어 있음
      else if (p.base === 'necklace') p.bw[i] = 0.15;
      if (pend) {
        p.pw[i] = p.base === 'necklace'
          ? smooth(pend.ay + pend.len * 0.08, pend.ay + pend.len * 0.6, y) // 목 근처 사슬은 거의 고정
          : smooth(pend.ay - 3, pend.ay + 8, y); // 브로치: 핀 아래 체인부터
      }
    }
  }

  buildOrder() {
    const order = [];
    const byTag = new Map(this.parts.map((p) => [p.tag, p]));
    // 표정 파츠는 같은 태그의 기본 파츠 바로 뒤에 (없는 태그는 앞머리 앞에)
    const exprBySrc = new Map();
    const leftovers = [];
    const aboveHair = []; // 앞머리 위에 그리는 표정 덧그림 (이마의 💢 등)
    const exprMouthSprite = (q) => this.exprParts.find((m) => m.base === 'mouthOpen' && m.expr === q.expr);
    for (const q of this.exprParts) {
      if (q.base === 'mouthOpen') continue;
      if (byTag.has(q.srcTag)) {
        if (!exprBySrc.has(q.srcTag)) exprBySrc.set(q.srcTag, []);
        exprBySrc.get(q.srcTag).push(q);
      } else if (q.srcTag === 'overlay-top') aboveHair.push(q);
      else leftovers.push(q);
    }
    const pushExpr = (q) => {
      order.push({ part: q });
      const ms = q.base === 'mouth' ? exprMouthSprite(q) : null;
      if (ms) order.push({ part: ms });
    };
    const bit = (side) => (side === 'l' ? 1 : 2);
    let leftDone = false;
    for (const p of this.parts) {
      // 기본 파츠에 없는 표정 파츠(홍조·눈물 덧그림 등)는 얼굴 위·앞머리 아래에.
      // (머리 보정 레이어 hair-fill 은 앞머리처럼 움직이지만 얼굴 뒤에 있으므로 tag 로 정확히 찾는다)
      if ((p.tag === 'hair-gap' || p.tag === 'front hair') && !leftDone) {
        leftovers.forEach(pushExpr);
        leftDone = true;
      }
      order.push({ part: p });
      if (p.tag === 'front hair') aboveHair.forEach(pushExpr);
      const ex = exprBySrc.get(p.tag) ?? [];
      ex.forEach(pushExpr);
      if (p.base === 'eyewhite' && p.side) {
        order.push({ part: p, mask: bit(p.side) });
        for (const q of ex) order.push({ part: q, mask: bit(q.side) });
      }
      if (p.base === 'eyelash' && p.side) {
        for (const kind of ['closed', 'smile']) {
          const e = this.extra[`${kind}-${p.side}`];
          if (e) order.push({ part: e });
        }
      }
      if (p.tag === 'mouth' && this.extra.mouthOpen) order.push({ part: this.extra.mouthOpen });
    }
    if (!leftDone) leftovers.forEach(pushExpr);
    // 눈꺼풀 레이어가 없으면 감은 눈은 눈동자 위에
    for (const side of ['l', 'r']) {
      if (!byTag.has(`eyelash-${side}`)) {
        for (const kind of ['closed', 'smile']) {
          const e = this.extra[`${kind}-${side}`];
          if (e) order.push({ part: e });
        }
      }
    }
    if (!byTag.has('mouth') && this.extra.mouthOpen) order.push({ part: this.extra.mouthOpen });
    this.order = order;
  }

  // ---------- 매 프레임 ----------
  update(P, dt) {
    this.time += dt;
    const t = this.t;
    const R = this.rig;
    const H = R.head;

    const yaw = P.angleX * DEG * t.yawScale;
    const pitch = P.angleY * DEG * t.pitchScale;
    const roll = P.angleZ * DEG * t.rollScale;
    const bodyRoll = P.bodyZ * DEG * 0.5 * t.bodyFollow;
    const bodyShift = P.bodyX * (H.rx / 60) * t.bodyFollow;
    const breath = P.breath;
    const syw = Math.sin(yaw);
    const sp = Math.sin(pitch);

    // 몸 변환 (회전 중심: 몸 아래쪽), 호흡은 몸을 위로 살짝 늘림
    const B = R.body;
    const cbr = Math.cos(bodyRoll);
    const sbr = Math.sin(bodyRoll);
    const breathK = t.breathAmount * breath;
    const bodyXf = (x, y, out, i, scaleY = true) => {
      let yy = scaleY ? B.y + (y - B.y) * (1 + breathK) : y;
      const dx = x - B.x;
      const dy = yy - B.y;
      out[i] = B.x + dx * cbr - dy * sbr + bodyShift;
      out[i + 1] = B.y + dx * sbr + dy * cbr;
    };
    // 기울기를 정점마다 다르게 (재킷 밑단처럼 아래로 처지는 부분)
    const bodyXfRoll = (x, y, rollV, out, i) => {
      const yy = B.y + (y - B.y) * (1 + breathK);
      const dx = x - B.x;
      const dy = yy - B.y;
      const c = Math.cos(rollV);
      const s = Math.sin(rollV);
      out[i] = B.x + dx * c - dy * s + bodyShift;
      out[i + 1] = B.y + dx * s + dy * c;
    };
    const headLift = (R.neck.y - B.y) * breathK; // 목이 위로 올라가는 양 (음수)

    // 머리 변환
    const N = R.neck;
    // 윤곽(z≈0)은 제자리에 두고 깊이(z)만큼 밀어 주는 시차 방식.
    // 평면 회전처럼 cos 로 줄이지 않아서 턱·정수리가 말려 들어가지 않는다.
    const headXf = (x, y, z, zp, rollEff, out, i) => {
      const dx = x - H.cx;
      const dy = y - H.cy;
      const X = dx + z * syw;
      const Y = dy - zp * sp * (1 - 0.15 * Math.abs(syw));
      const px = H.cx + X - N.x;
      const py = H.cy + Y - N.y;
      const cr = Math.cos(rollEff);
      const sr = Math.sin(rollEff);
      const hx = N.x + px * cr - py * sr;
      const hy = N.y + px * sr + py * cr + headLift;
      bodyXf(hx, hy, out, i, false);
    };

    // 물리: 머리끝 기준점의 화면 위치로 스프링 구동
    const probe = new Float32Array(2);
    headXf(H.cx, H.cy + H.ry, 0, 0, roll, probe, 0);
    const hairFront = this.springs.front.step(probe[0], dt, t.hairFreq, t.hairDamping, t.hairMax);
    const hairFrontY = this.springs.frontY.step(probe[1], dt, t.hairFreq * 1.2, t.hairDamping, t.hairMax * 0.4);
    const hairBack = this.springs.back.step(probe[0], dt, t.hairBackFreq, t.hairDamping, t.hairMax * 1.2);
    const wind = Math.sin(this.time * 1.7) * 1.2 + Math.sin(this.time * 0.9 + 1) * 0.8;

    // ---- 옷·장신구 물리: 가슴 중심점의 움직임으로 겹마다 다른 스프링·진자를 구동 ----
    const C = R.clothes;
    const yawB = (P.bodyYaw ?? 0) * DEG * 1.5;
    const layerShift = Math.sin(yawB) * t.layerDepth;
    let jx = 0;
    let jy = 0;
    let ix = 0;
    let iy = 0;
    let neckPhi = 0;
    let broochPhi = 0;
    const clothWind = (Math.sin(this.time * 1.3) * 0.6 + Math.sin(this.time * 2.1 + 0.5) * 0.4) * t.clothWind;
    const shoulderLift = clamp(P.shoulder ?? 0, -1, 1) * H.ry * 0.08; // 어깨 들썩임 (모델 px, 위가 +)
    // 팔 들기 (SD: 재킷에서 떼어 낸 소매, rig.arms — tools/sd_sleeves.py): 손의 목표(hand?X·Y)를 향해 소매를 어깨 축으로 돌리고
    // (hand?W 만큼), 든 쪽 어깨도 올린다. 손(원래 손 레이어)은 소매 끝에 붙어 같이 돈다. r = 화면 왼쪽, 각도는 화면 시계 방향 +
    const arms = R.arms;
    const armRot = { r: 0, l: 0 };
    const armLift = { r: 0, l: 0 };
    if (arms) {
      for (const s of ['r', 'l']) {
        const A = arms[s];
        const S = s.toUpperCase();
        const w = clamp(P[`hand${S}W`] ?? 0, 0, 1);
        if (!A || w < 0.001) continue;
        const tx = H.cx + (P[`hand${S}X`] ?? 0) * H.rx;
        const ty = H.cy + (P[`hand${S}Y`] ?? 0) * H.ry;
        let d = Math.atan2(ty - A.pivot[1], tx - A.pivot[0]) / DEG - A.rest;
        d = ((d % 360) + 540) % 360 - 180;
        d = s === 'r' ? clamp(d, -35, 150) : clamp(d, -150, 35); // 몸 쪽으로 파고들지 않게
        armRot[s] = d * w;
        armLift[s] = H.ry * 0.07 * smooth(10, 90, Math.abs(armRot[s]));
      }
    }
    if (C) {
      const ref = new Float32Array(2);
      bodyXf(C.body.cx, (C.body.top + C.body.hem) / 2, ref, 0, true);
      ref[0] += 10 * layerShift; // 몸을 돌릴 때도 옷이 따라오며 출렁이게
      const S = this.springs;
      jx = S.jacketX.step(ref[0], dt, t.jacketFreq, t.jacketDamping, t.jacketMax);
      jy = S.jacketY.step(ref[1], dt, t.jacketFreq * 1.3, t.jacketDamping, t.jacketMax * 0.5);
      ix = S.innerX.step(ref[0], dt, t.innerFreq, 0.5, t.innerMax);
      iy = S.innerY.step(ref[1], dt, t.innerFreq * 1.2, 0.5, t.innerMax * 0.5);
      const a = new Float32Array(2);
      if (C.necklace) {
        bodyXf(C.necklace.ax, C.necklace.ay, a, 0, true);
        a[0] += BODY_Z.necklace * layerShift;
        neckPhi = this.pendulums.necklace.step(a[0], a[1], dt, C.necklace.len, t.necklaceFreq, t.necklaceDamping);
      }
      if (C.brooch) {
        bodyXf(C.brooch.ax, C.brooch.ay, a, 0, true);
        const bw = Math.pow(smooth(C.body.top + 50, C.body.hem, C.brooch.ay), 1.3);
        a[0] += jx * bw + BODY_Z.brooch * layerShift;
        a[1] += jy * bw * 0.6;
        broochPhi = this.pendulums.brooch.step(a[0], a[1], dt, Math.max(20, C.brooch.len), t.broochFreq, t.broochDamping);
      }
    }

    let earPhi = 0;
    if (R.earring) {
      const E = R.earring;
      const a = new Float32Array(2);
      headXf(E.ax, E.ay, t.zEar * H.rx, 0, roll, a, 0);
      earPhi = this.pendulum.step(a[0], a[1], dt, E.len, t.earringFreq, t.earringDamping);
    }

    // 표정 값
    const eyeOpen = { l: P.eyeOpenL, r: P.eyeOpenR };
    const smileEye = clamp(P.eyeSmile, 0, 1);
    const mouthOpen = clamp(P.mouthOpen, 0, 1);
    // 표정 비중: 고른 표정은 ex_<이름> 이 1 로 (서스펜션이 부드럽게 바꿈), 나머지 비중은 기본 얼굴
    const ew = {};
    let ewSum = 0;
    for (const n of this.exprNames) {
      ew[n] = clamp(P[`ex_${n}`] ?? 0, 0, 1);
      ewSum += ew[n];
    }
    if (ewSum > 1) for (const n of this.exprNames) ew[n] /= ewSum;
    const baseW = Math.max(0, 1 - Math.min(1, ewSum));
    // 입을 바꾸지 않는 표정(고퀄 모델의 눈·눈썹만 바꾸는 표정 등)에서는 원래 입·립싱크를 그대로 둔다
    let mouthKeep = baseW;
    for (const n of this.exprNames) {
      const ex = this.expressions[n];
      if (!(ex.mouthOwn ?? !!ex.mouth)) mouthKeep += ew[n];
    }
    const weightOf = (p) => (p.expr ? ew[p.expr] : p.face ? (p.base === 'mouth' || p.base === 'mouthOpen' ? Math.min(1, mouthKeep) : baseW) : 1);
    // 깜빡일 수 있는(눈을 뜬) 표정의 비중 — 감은 눈 스프라이트는 이만큼만
    const blinkW = { l: baseW, r: baseW };
    for (const n of this.exprNames) {
      for (const s of ['l', 'r']) if (this.expressions[n].eyes?.[s]) blinkW[s] += ew[n];
    }
    for (const sp of [this.extra.mouthOpen, ...this.exprParts.filter((q) => q.base === 'mouthOpen')]) {
      if (!sp?.mouthSprite || weightOf(sp) < 0.002) continue;
      if (sp.mouthSprite.draw(mouthOpen, P.mouthForm, P.mouthNarrow, P.mouthWide ?? 0)) this.r.updateTexture(sp.mesh.texture, sp.mouthSprite.canvas);
    }

    const items = [];
    // 소품(비니 등)을 쓰면 그 밖으로 삐져나오던 원래 머리를 숨긴다: 지우개를 스텐실 4번 비트에 쓰고 머리는 그 밖에만
    const ERASE_BIT = 4;
    const ERASE_BODY_BIT = 8; // 옷 갈아입기: 원래 몸 레이어를 숨기는 자리
    const eraseActive = (q) => q.erase && (P[q.toggle] ?? 0) > 0.5 && !this.hidden.has(q.tag);
    const eraseOn = this.parts.some((q) => eraseActive(q) && q.eraseTarget !== 'body');
    const eraseBodyOn = this.parts.some((q) => eraseActive(q) && q.eraseTarget === 'body');
    for (const entry of this.order) {
      const p = entry.part;
      const n = p.base0.length / 2;
      const src = p.base0;
      const out = p.out;
      const bt = p.base;
      const wPart = weightOf(p);
      if (wPart < 0.002) continue; // 지금 표정에 안 쓰는 파츠
      let opacity = this.hidden.has(p.tag) ? 0 : wPart;
      if (p.toggle) opacity *= clamp(P[p.toggle] ?? 0, 0, 1);
      // 손이 몸에서 떨어져 떠오르면(떠 있는 손, effects.js) 원래 자리의 손은 숨긴다
      // (소매가 있는 모델은 팔이 어느 정도 올라간 뒤 펼친 손으로 바뀐다)
      if (bt === 'handwear') opacity *= 1 - (R.arms ? smooth(0.3, 0.55, P[p.tag.endsWith('-r') ? 'handRW' : 'handLW'] ?? 0) : smooth(0.02, 0.14, P[p.tag.endsWith('-r') ? 'handRW' : 'handLW'] ?? 0));
      if (!entry.mask) {
        const eye = p.side ? (p.expr ? p.eyeGeom : R.eyes?.[p.side]) : null;
        const MG = p.expr ? p.mouthGeom : R.mouth;
        const e = p.side ? eyeOpen[p.side] : 1;
        for (let i = 0; i < n; i++) {
          let x = src[2 * i];
          let y = src[2 * i + 1];
          // --- 로컬 변형 ---
          if (eye && (bt === 'eyewhite' || bt === 'irides' || bt === 'eyelash' || bt === 'eyebrow')) {
            const xc = clamp(x, eye.x0, eye.x1);
            const U = interp(eye.xs, eye.upper, xc);
            const L = interp(eye.xs, eye.lower, xc);
            const C = L - (L - U) * t.closeRatio;
            const ee = e * (1 - smileEye);
            if (bt === 'irides') {
              // 표정 그림의 눈은 눈 아래 윤곽이 눈동자 테에 붙어 있어, 많이 움직이면 윤곽이 떠 보인다 → 이동 폭을 줄임
              const gx = p.expr ? t.exprIrisScale : 1;
              const gy = p.expr ? t.exprIrisScale * 0.6 : 1;
              x += P.eyeBallX * t.irisRangeX * (eye.x1 - eye.x0) * gx;
              y += P.eyeBallY * -t.irisRangeY * (L - U) * gy;
              y = C + (y - C) * ee;
            } else if (bt === 'eyewhite') {
              y = C + (y - C) * ee;
            } else if (bt === 'eyelash') {
              const span = L - U;
              const w = 1 - smooth(U + span * 0.3, L - span * 0.12, y);
              y += w * (C - U) * (1 - ee);
            } else if (bt === 'eyebrow') {
              y += -P.brow * (H.ry * 0.06) + (1 - Math.min(1, ee)) * H.ry * 0.015;
            }
          }
          if (bt === 'mouthOpen' && !p.sprite && MG) {
            const top = p.layer.y + p.layer.h * 0.12;
            const k = 0.35 + 0.65 * mouthOpen;
            y = top + (y - top) * k;
            x = MG.cx + (x - MG.cx) * (0.88 + 0.12 * mouthOpen - 0.15 * P.mouthNarrow + 0.1 * (P.mouthWide ?? 0));
          }
          if (bt === 'mouth' && MG) {
            const hw = (MG.x1 - MG.x0) / 2;
            if (p.mouthType === 'open') {
              // 원래 벌린 입으로 그려진 표정: 말할 때 위쪽을 기준으로 늘였다 줄였다
              const k = (0.8 + 0.45 * mouthOpen) * (1 - 0.18 * (P.mouthWide ?? 0));
              y = MG.top + (y - MG.top) * k;
              x = MG.cx + (x - MG.cx) * (1 - 0.15 * P.mouthNarrow + 0.14 * (P.mouthWide ?? 0));
            } else {
              const tt = clamp((x - MG.cx) / hw, -1, 1);
              y += P.mouthForm * hw * 0.16 * (1 - tt * tt);
            }
          }
          if (bt === 'earwear' && p.w[i] > 0 && !p.sset) { // 사슬(가닥 물리)이 있으면 그쪽으로
            const E = R.earring;
            const ang = (earPhi - roll * 0.9) * p.w[i];
            const dx = x - E.ax;
            const dy = y - E.ay;
            x = E.ax + dx * Math.cos(ang) - dy * Math.sin(ang);
            y = E.ay + dx * Math.sin(ang) + dy * Math.cos(ang);
          }
          // --- 머리 / 몸 변환 ---
          if (p.head && (p.strand || p.sset)) {
            headXf(x, y, p.z[i], p.zp[i], roll, out, 2 * i);
          } else if (p.head) {
            const w = p.w[i];
            const rollEff = bt === 'front hair' || bt === 'back hair' ? roll * (1 - w * t.hairGravity) : roll;
            headXf(x, y, p.z[i], p.zp[i], rollEff, out, 2 * i);
            if (w > 0 && (bt === 'front hair' || bt === 'back hair')) {
              const off = bt === 'front hair' ? hairFront : hairBack;
              out[2 * i] += (off + wind) * w;
              out[2 * i + 1] += (bt === 'front hair' ? hairFrontY * 0.5 : 0) * w - Math.abs(off) * 0.12 * w;
            }
          } else if (C && p.bw) {
            // 든 팔: 소매와 그 끝의 손을 어깨 축으로 돌리고 어깨만큼 올림 (몸 흔들림·옷 출렁임은 아래에서 그대로 더함)
            if ((bt === 'sleeve' || bt === 'handwear') && arms?.[p.side] && (armRot[p.side] || armLift[p.side])) {
              const [px, py] = arms[p.side].pivot;
              const a = armRot[p.side] * DEG;
              const dx = x - px;
              const dy = y - py;
              x = px + dx * Math.cos(a) - dy * Math.sin(a);
              y = py + dx * Math.sin(a) + dy * Math.cos(a) - armLift[p.side];
            }
            // 장신구 진자: 몸 기준으로 매달린 곳을 중심으로 돌림 (몸이 기울어도 아래로 늘어지게)
            if (p.pw && p.pw[i] > 0) {
              const pend = bt === 'necklace' ? C.necklace : C.brooch;
              const ang = ((bt === 'necklace' ? neckPhi : broochPhi) - bodyRoll) * p.pw[i];
              const dx = x - pend.ax;
              const dy = y - pend.ay;
              x = pend.ax + dx * Math.cos(ang) - dy * Math.sin(ang);
              y = pend.ay + dx * Math.sin(ang) + dy * Math.cos(ang);
            }
            const w = p.bw[i];
            const inner = bt === 'body-inner' || bt === 'necklace';
            const g = inner ? 0.15 : t.jacketGravity;
            // 어깨 (+ 으쓱 · − 처짐): 목 옆 어깨선이 가장 많이, 아래·가운데로 갈수록 덜 움직인다 (큰 반응·웃음이 쓰는 값)
            const lift = shoulderLift + (x < C.body.cx ? armLift.r : armLift.l); // 양쪽 들썩임 + 팔을 든 쪽
            if (lift && (bt === 'body-jacket' || bt === 'topwear')) {
              const ws = (1 - smooth(C.body.top + 20, C.body.top + 170, y)) * smooth(C.body.innerHalf + 10, C.body.innerHalf + 90, Math.abs(x - C.body.cx));
              y -= lift * ws;
            }
            bodyXfRoll(x, y, bodyRoll * (1 - w * g), out, 2 * i);
            const sx = inner ? ix : jx;
            const sy = inner ? iy : jy;
            out[2 * i] += (sx + clothWind * (inner ? 0.3 : 1)) * w + p.bz * layerShift;
            out[2 * i + 1] += sy * w * 0.6 + Math.abs(sx) * 0.05 * w;
          } else {
            bodyXf(x, y, out, 2 * i, true);
          }
        }
        if (p.sset && !p.head) {
          // 몸에 매달린 사슬(목걸이 등): 뿌리는 몸과 같이 움직이고 돈다
          p.sset.step((pt) => {
            const r = new Float32Array(2);
            bodyXf(pt[0], pt[1], r, 0, true);
            r[0] += (p.bz ?? 0) * layerShift;
            return { x: r[0], y: r[1], rot: bodyRoll };
          }, dt, this.time);
          p.sbase.set(out);
          p.sset.deform(p.ssetBind, p.sbase, out);
        }
        if (p.sset && p.head) {
          // 사슬 뿌리를 머리와 같이 옮겨(깊이는 앞머리 기준) 한 프레임에 한 번만 물리 진행, 정점은 가까운 사슬들의 움직임을 섞음
          // 뿌리 깊이: 머리 타원체 표면 깊이 + 앞머리 띄움 (정점과 같은 식) → 고개를 돌린 만큼 뿌리도 움직여 관성이 생김
          p.sset.step((pt) => {
            const u = (pt[0] - H.cx) / H.rx;
            const v = (pt[1] - H.cy) / H.ry;
            const q = u * u + v * v;
            const zs = (q < 1 ? Math.sqrt(1 - q) : 0) * H.rx * t.headDepth;
            // 뒷머리는 머리 뒤쪽, 귀걸이는 귀 깊이, 나머지(앞머리)는 앞머리 깊이
            const zr = bt === 'back hair' ? -0.5 * zs - t.zBackHair * H.rx : zs + (bt === 'earwear' || bt === 'ears' ? t.zEar : t.zFrontHair) * H.rx;
            const r = new Float32Array(2);
            headXf(pt[0], pt[1], zr, zr * (1 - smooth(0.78, 1.0, v)), roll, r, 0);
            return { x: r[0], y: r[1], rot: roll + bodyRoll };
          }, dt, this.time);
          p.sbase.set(out);
          p.sset.deform(p.ssetBind, p.sbase, out);
        }
        if (p.strand) {
          // 뿌리점을 머리와 같이 옮기고(깊이는 가장 가까운 정점 것), 한 프레임에 한 번만 물리를 진행
          if (p.strandAt !== this.time) {
            p.strandAt = this.time;
            const [rx0, ry0] = p.strandDef.spine[0];
            let best = 0;
            let bd = Infinity;
            for (let i = 0; i < n; i++) {
              const d = (src[2 * i] - rx0) ** 2 + (src[2 * i + 1] - ry0) ** 2;
              if (d < bd) {
                bd = d;
                best = i;
              }
            }
            const r = new Float32Array(2);
            headXf(rx0, ry0, p.z[best], p.zp[best], roll, r, 0);
            p.strand.step({ x: r[0], y: r[1], rot: roll + bodyRoll }, dt);
          }
          p.sbase.set(out);
          deformStrand(p.strand, p.sbind, p.sbase, out);
        }
        this.r.updatePositions(p.mesh, out);
        if (bt === 'handwear') {
          // 떠 있는 손(effects.js)이 떠나고 돌아오는 자리: 몸과 같이 움직인 원래 손의 가운데
          this.handAnchor ??= {};
          let sx = 0;
          let sy = 0;
          for (let i = 0; i < n; i++) {
            sx += out[2 * i];
            sy += out[2 * i + 1];
          }
          const A = arms?.[p.side];
          if (A) {
            // 소매에 붙은 손: 손목(소매 끝 가운데)과 팔 방향을 알려 준다 — 손 가운데에서 쉬는 자리의 (손 가운데 → 손목) 만큼 돌려 뺌
            p.restC ??= (() => {
              let cx = 0;
              let cy = 0;
              for (let i = 0; i < n; i++) {
                cx += src[2 * i];
                cy += src[2 * i + 1];
              }
              return [cx / n - A.cuff[0], cy / n - A.cuff[1]];
            })();
            const a = armRot[p.side] * DEG + bodyRoll;
            const [ox, oy] = p.restC;
            this.handAnchor[p.side.toUpperCase()] = {
              x: sx / n - (ox * Math.cos(a) - oy * Math.sin(a)), y: sy / n - (ox * Math.sin(a) + oy * Math.cos(a)),
              dir: A.rest + armRot[p.side] + bodyRoll / DEG, attached: true,
            };
          } else this.handAnchor[p.tag.endsWith('-r') ? 'R' : 'L'] = { x: sx / n, y: sy / n };
        }
        // 눈 감기 크로스페이드 (감은 눈으로 그려진 표정은 깜빡이지 않음)
        if (p.side && eye && (bt === 'eyewhite' || bt === 'irides' || bt === 'eyelash')) {
          const ee = e * (1 - smileEye);
          opacity *= smooth(0.05, 0.15, ee);
        } else if (p.tag === `closed-${p.side}`) {
          const ee = e * (1 - smileEye);
          opacity *= (1 - smooth(0.05, 0.15, ee)) * (1 - smileEye) * blinkW[p.side];
        } else if (p.tag === `smile-${p.side}`) {
          const ee = e * (1 - smileEye);
          opacity *= (1 - smooth(0.05, 0.15, ee)) * smileEye * blinkW[p.side];
        } else if (bt === 'eyeov' && p.side) {
          // 표정 눈 덧그림: 깜빡이면 사라지고 감은 눈 그림이 대신 (blinkW 에 이 표정 비중이 들어 있음)
          const ee = (p.side === 'l' ? eyeOpen.l : eyeOpen.r) * (1 - smileEye);
          if (this.expressions[p.expr]?.eyes?.[p.side]) opacity *= smooth(0.05, 0.15, ee);
        } else if (bt === 'mouth' && p.mouthType !== 'open') {
          opacity *= 1 - smooth(0.04, 0.22, mouthOpen); // 조금 벌렸을 때는 원래 입 선이 윗선에 겹쳐 보이게
        } else if (bt === 'mouthOpen') {
          opacity *= smooth(0.035, 0.09, mouthOpen);
        }
      }
      if (entry.mask) {
        items.push({ mesh: p.mesh, opacity: 1, writeMask: entry.mask });
      } else if (p.erase) {
        if (eraseActive(p)) items.push({ mesh: p.mesh, opacity: 1, writeMask: p.eraseTarget === 'body' ? ERASE_BODY_BIT : ERASE_BIT });
      } else if (eraseOn && (bt === 'front hair' || bt === 'back hair' || bt.startsWith('hair'))) {
        items.push({ mesh: p.mesh, opacity, clipOut: ERASE_BIT });
      } else if (eraseBodyOn && !p.head && !p.toggle && !p.expr) {
        // 원래 몸 레이어(손·셔츠·재킷·목걸이·브로치): 새 옷 밖으로 나오는 곳은 그리지 않음
        items.push({ mesh: p.mesh, opacity, clipOut: ERASE_BODY_BIT });
      } else if (bt === 'irides' && p.side) {
        items.push({ mesh: p.mesh, opacity, clipBy: p.side === 'l' ? 1 : 2 });
      } else {
        items.push({ mesh: p.mesh, opacity });
      }
    }
    return items;
  }
}
