// 전신 SD(꼬마) 2D 리그 — model.type 'chibi'. 그림 한 장을 tools/sdp_*.py 로 나눈 레이어를 움직인다 (2026-11-01, model_sd_purple).
// - 머리: 두개골 구 위의 깊이(z)만큼 밀어 주는 2.5D 회전. 앞머리는 얼굴보다 더, 뒷머리 채움은 덜 움직여 겹이 드러난다.
// - 눈: 눈꺼풀 띠는 열마다 위아래로 옮기고, 흰자는 띠~아래 경계 사이를 접어 깜빡임. 홍채·하이라이트는 흰자 안쪽만 보이게 잘라 냄(찌그러뜨리지 않음).
// - 입: 벌림·옆으로·입꼬리에 맞춰 매 프레임 그리는 그림 (원본은 벌린 입이라 다시 그림).
// - 몸: 엉덩이 축으로 위로 갈수록 더 휘는 상체, 발은 바닥에 붙은 채 다리가 따라감. 팔은 어깨 축으로 내려 두고(원본 T자세) 팔꿈치·손목까지.
// - 물리: Cubism 방식 진자(cubism_physics.js)로 머리카락 다발·바보털·귀걸이·체인·목걸이·팔 흔들림 각도를 구해 휘게 한다.
// model.json: { type:'chibi', layers:[{tag,file,x,y,w,h,space,kind,side,cell,z}], rig:{ head, skull, face, body, arms, legs, eyes, mouth, hair, attach, physics, expressions } }
import { gridMesh } from './renderer.js';
import { DEFAULT_TUNING, PARAMS } from './rig.js';
import { CubismPhysics } from './cubism_physics.js';
import { facePose } from './face_performance.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// 이 리그 전용 조정값 (rig.json tuning 으로 덮어씀)
export const CHIBI_TUNING = {
  yawMax: 25, // angleX ±30 → 실제 고개 돌림(도) (22 → 25: 돌리는 느낌이 약해 조금 키움, 2026-11-01)
  pitchMax: 15, // 12 → 15 (시트 '위쪽/아래쪽 끝' 이 더 큼, 2026-11-02)
  rollScale: 0.6,
  rollLimit: 13, // 몸에 대한 고개 기울기 상한(도, 부드럽게)
  armRest: 78, // 팔을 T자세에서 아래로 내린 각도(도) — 78: 시트 '기본 전신'처럼 팔이 몸 옆에 거의 수직으로 (2026-11-02)
  armSway: 1, // 몸 움직임에 팔이 늦게 따라오는 정도
  hairPhys: 1, // 머리카락 흔들림 배율
  accPhys: 1, // 장신구(귀걸이·체인·목걸이) 흔들림 배율
  bodyBend: 1, // 상체 휨 배율
  wind: 1, // 가만히 있을 때 살랑임
  gazeX: 0.17, // 눈동자 좌우 이동 (눈 너비 비율) — 시트 '시선 끝' 은 홍채가 눈꼬리에 닿을 만큼
  gazeY: 0.09,
  leanScale: 0.009, // 몸 숙이기(bodyLean, 카메라에 다가옴) 1 당 전체 크기 배율 (발 기준) — 가까이 오면 커 보임
  pupilScale: 0.18, // pupil ±1 일 때 홍채 크기 변화 비율 (놀라면 작아짐, 시트 '동공 크게/작게')
  cheekJiggle: 1, // 볼살 출렁임 배율 (0 = 끔)
  squash: 1, // 뛰기·무릎 굽힘 때 늘이고 찌그리기 배율 (0 = 끔)
  ahogeMood: 1, // 바보털이 표정 따라 서고 처지는 정도 (0 = 끔)
  bow: 1, // 크게 숙이면(bodyLean 4~10) 몸통이 줄어 보이는 정도 (0 = 끔)
};

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

// 일정 간격(x0, dx)으로 잰 값 배열에서 x 의 값 (선형 보간, 끝은 고정)
function sample(curve, x) {
  const u = clamp((x - curve.x0) / curve.dx, 0, curve.v.length - 1);
  const i = Math.floor(u);
  const f = u - i;
  const a = curve.v[i];
  const b = curve.v[Math.min(i + 1, curve.v.length - 1)];
  return a + (b - a) * f;
}

// 다리 정점이 발목보다 위인가 (무릎 굽힘으로 눌리는 부분)
const ry0 = (y, G) => y < G.foot[1];

// ---------- 손 모양 (사용자 '손 파츠' 시트: 기본손·편손·주먹·가리키기·브이·손하트·파지·놀람손) ----------
// 그림 파일이 없어 그림체(굵은 테두리 + 살색, 짧고 둥근 손가락)로 캔버스에 그린다. 100×100 좌표, 손가락은 위(−y), 손목은 (50, 86)
export const HAND_POSES = ['open', 'fist', 'point', 'v', 'heart', 'grab', 'spread', 'relax', 'palm', 'pinch']; // relax·palm·pinch 는 사용자 시트 그림에만 있음 (없으면 open 으로)
const HAND_LINE = '#1d1519';
const HAND_SKIN = '#fdebe5';
function drawHandPose(ctx, S, pose, flip) {
  const u = S / 100;
  ctx.save();
  if (flip) {
    ctx.translate(S, 0);
    ctx.scale(-1, 1);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const O = 7.5 * u; // 테두리 굵기
  const shapes = []; // 테두리 → 살색 두 번 그림
  const cap = (x0, y0, x1, y1, w) => shapes.push(['cap', x0, y0, x1, y1, w]);
  const curve = (x0, y0, cx, cy, x1, y1, w) => shapes.push(['curve', x0, y0, cx, cy, x1, y1, w]);
  const disc = (x, y, r) => shapes.push(['disc', x, y, r]);
  const rrect = (x, y, w, h, r) => shapes.push(['rrect', x, y, w, h, r]);
  const palm = () => disc(50, 64, 19);
  const fingersOpen = (spread) => {
    const k = spread ? 1.35 : 1;
    cap(38, 52, 50 - 20 * k, 30 - 2 * k, 13);
    cap(45, 48, 50 - 7 * k, 20, 13);
    cap(55, 48, 50 + 7 * k, 20, 13);
    cap(62, 52, 50 + 20 * k, 30 - 2 * k, 13);
    cap(36, 66, 50 - 32 * k * 0.8, 54, 13); // 엄지 (왼쪽)
  };
  const fist = (withIndex, withMiddle) => {
    rrect(31, 44, 38, 36, 12);
    disc(39, 46, 9);
    disc(50, 42, 9);
    disc(61, 46, 9);
    if (withIndex) cap(41, 46, 38, 14, 12);
    if (withMiddle) cap(53, 44, 60, 12, 12);
    cap(34, 66, 58, 70, 11); // 엄지: 손가락 위를 가로지름
  };
  switch (pose) {
    case 'open': palm(); fingersOpen(false); break;
    case 'spread': palm(); fingersOpen(true); break;
    case 'fist': fist(false, false); break;
    case 'point': fist(true, false); break;
    case 'v': fist(true, true); break;
    case 'heart':
      // 손가락 하트: 주먹 + 검지 끝과 엄지 끝이 위에서 엇갈림 (그 자리에 작은 하트는 아래에서 따로 그림)
      rrect(33, 50, 36, 32, 12);
      disc(52, 48, 9);
      disc(62, 52, 9);
      cap(42, 52, 40, 30, 12);
      cap(34, 70, 46, 32, 11);
      break;
    case 'grab':
      // 파지(갈퀴손): 손바닥 + 두 마디로 꺾여 안으로 구부러진 손가락 네 개 + 구부린 엄지
      palm();
      cap(37, 54, 27, 40, 12); cap(27, 40, 35, 32, 12);
      cap(45, 50, 41, 30, 12); cap(41, 30, 50, 26, 12);
      cap(55, 50, 59, 30, 12); cap(59, 30, 50, 26, 12);
      cap(63, 54, 73, 40, 12); cap(73, 40, 65, 32, 12);
      cap(35, 70, 21, 62, 12); cap(21, 62, 25, 50, 12);
      break;
    default: palm(); fingersOpen(false); // relax·palm·pinch 의 코드 그림은 편 손으로 대신
  }
  for (const pass of ['line', 'fill']) {
    const col = pass === 'line' ? HAND_LINE : HAND_SKIN;
    const extra = pass === 'line' ? O : 0;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    for (const sh of shapes) {
      if (sh[0] === 'cap') {
        const [, x0, y0, x1, y1, w] = sh;
        ctx.lineWidth = w * u + extra * 2;
        ctx.beginPath();
        ctx.moveTo(x0 * u, y0 * u);
        ctx.lineTo(x1 * u, y1 * u);
        ctx.stroke();
      } else if (sh[0] === 'curve') {
        const [, x0, y0, cx, cy, x1, y1, w] = sh;
        ctx.lineWidth = w * u + extra * 2;
        ctx.beginPath();
        ctx.moveTo(x0 * u, y0 * u);
        ctx.quadraticCurveTo(cx * u, cy * u, x1 * u, y1 * u);
        ctx.stroke();
      } else if (sh[0] === 'disc') {
        const [, x, y, r] = sh;
        ctx.beginPath();
        ctx.arc(x * u, y * u, r * u + extra, 0, Math.PI * 2);
        ctx.fill();
      } else if (sh[0] === 'rrect') {
        const [, x, y, w, h, r] = sh;
        ctx.beginPath();
        ctx.roundRect(x * u - extra, y * u - extra, w * u + extra * 2, h * u + extra * 2, r * u + extra);
        ctx.fill();
      }
    }
  }
  if (pose === 'heart') {
    // 엇갈린 손가락 끝 위의 작은 분홍 하트
    const hx = 44 * u;
    const hy = 18 * u;
    const r = 7 * u;
    ctx.beginPath();
    ctx.moveTo(hx, hy + r * 0.9);
    ctx.bezierCurveTo(hx - r * 1.4, hy - r * 0.1, hx - r * 0.7, hy - r * 1.1, hx, hy - r * 0.4);
    ctx.bezierCurveTo(hx + r * 0.7, hy - r * 1.1, hx + r * 1.4, hy - r * 0.1, hx, hy + r * 0.9);
    ctx.closePath();
    ctx.fillStyle = '#ff7fb0';
    ctx.strokeStyle = HAND_LINE;
    ctx.lineWidth = 3.5 * u;
    ctx.stroke();
    ctx.fill();
  }
  // 손가락 사이 선 (주먹·브이·가리키기·손하트)
  if (pose === 'fist' || pose === 'point' || pose === 'v' || pose === 'heart') {
    ctx.strokeStyle = 'rgba(29,21,25,0.55)';
    ctx.lineWidth = 2.2 * u;
    for (const x of [44.5, 55.5]) {
      ctx.beginPath();
      ctx.moveTo(x * u, 52 * u);
      ctx.lineTo(x * u, 60 * u);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export class ChibiAvatar {
  constructor(renderer, model, tuning = {}) {
    this.r = renderer;
    this.model = model;
    this.rig = model.rig;
    this.t = { ...DEFAULT_TUNING, ...CHIBI_TUNING, ...tuning };
    this.parts = [];
    this.hidden = new Set();
    this.time = 0;
    this.handAnchor = null; // 손이 팔에 붙어 있어 떠 있는 손(effects.js)은 쓰지 않음
    this.expressions = this.rig.expressions ?? {};
    for (const [name, ex] of Object.entries(this.expressions)) {
      PARAMS[`ex_${name}`] = { min: 0, max: 1, def: 0, label: `표정: ${ex.label}` };
    }
  }

  async load(base) {
    const R = this.rig;
    await Promise.all(this.model.layers.map(async (d, order) => {
      const img = await loadImage(`${base}/${d.file}`);
      const alpha = readAlpha(img);
      const tex = this.r.createTexture(img);
      const g = gridMesh(d.x, d.y, d.w, d.h, alpha, d.cell ?? 16);
      const mesh = this.r.createMesh(tex, g.positions, g.uvs, g.indices);
      this.parts[order] = { ...d, order, mesh, rest: g.positions.slice(), out: new Float32Array(g.positions.length), n: g.positions.length / 2, idx: g.indices };
    }));
    this.byTag = Object.fromEntries(this.parts.map((p) => [p.tag, p]));
    // 사용자가 그린 스프라이트 (rig.sprites): 입 모양·감은 눈·눈썹·효과 — 있으면 코드로 그린 것 대신 씀
    this.spr = {};
    await Promise.all(Object.entries(R.sprites ?? {}).map(async ([name, d]) => {
      const img = await loadImage(`${base}/${d.file}`);
      const tex = this.r.createTexture(img);
      const g = gridMesh(d.cx - d.w / 2, d.cy - d.h / 2, d.w, d.h, null, Math.max(3, Math.min(d.w, d.h) / 4));
      const mesh = this.r.createMesh(tex, g.positions, g.uvs, g.indices);
      this.spr[name] = { ...d, name, mesh, rest: g.positions.slice(), out: new Float32Array(g.positions.length), n: g.positions.length / 2 };
    }));
    this.makeSprites();
    this.prepareStatic();
    this.physParams = this.makePhysParams();
    this.physics = R.physics ? new CubismPhysics(R.physics, this.physParams) : null;
    this.resetPhysics();
  }

  // ---------- 물리 파라미터 (Cubism 물리 계산기에 넘기는 가짜 모델 파라미터) ----------
  makePhysParams() {
    const ids = ['AngleX', 'AngleY', 'AngleZ', 'BodyX', 'BodyZ', 'BodyYaw', 'BodyY', 'ArmR', 'ArmL', 'Breath'];
    for (const s of this.rig.physics?.PhysicsSettings ?? []) for (const o of s.Output) if (!ids.includes(o.Destination.Id)) ids.push(o.Destination.Id);
    const n = ids.length;
    const p = { ids, values: new Float32Array(n), minimumValues: new Float32Array(n), maximumValues: new Float32Array(n), defaultValues: new Float32Array(n) };
    const range = { AngleX: 30, AngleY: 30, AngleZ: 30, BodyX: 10, BodyZ: 10, BodyYaw: 10, BodyY: 10, ArmR: 30, ArmL: 30, Breath: 1 };
    ids.forEach((id, i) => {
      const r = range[id] ?? 30;
      p.minimumValues[i] = id === 'Breath' ? 0 : -r;
      p.maximumValues[i] = r;
    });
    this.physIndex = Object.fromEntries(ids.map((id, i) => [id, i]));
    return p;
  }

  resetPhysics() {
    this.physics?.reset();
    this.armLag = { r: 0, l: 0, vr: 0, vl: 0 };
    this.hopLag = { x: 0, v: 0 };
    this.bodyLag = { x: 0, v: 0 };
  }

  setTuning(t) {
    for (const [k, v] of Object.entries(t ?? {})) if (typeof v === 'number') this.t[k] = v;
  }

  // 검수용: 머리카락 다발을 강제로 휨 ({다발id 또는 'bang'|'sideL'|'sideR'|'nape'|'ahoge'|'all': 도})
  setHairForce(f) {
    this.hairForce = f && Object.keys(f).length ? f : null;
  }

  refreshClosedEyes() {}

  // ---------- 정점마다 미리 구해 두는 값 ----------
  prepareStatic() {
    const R = this.rig;
    const S = R.skull;
    const F = R.face;
    const D = R.hair.dome;
    for (const p of this.parts) {
      if (!p) continue;
      const n = p.n;
      p.z = new Float32Array(n);
      p.c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = p.rest[2 * i];
        const y = p.rest[2 * i + 1];
        if (p.space !== 'head') continue;
        // 얼굴 타원체 깊이 (얼굴·눈·입·눈썹)
        const fu = (x - F.cx) / F.rx;
        const fv0 = (y - F.cy) / F.ry;
        const fv = fv0 > 0 ? fv0 / 0.65 : fv0; // 아래(턱)는 더 빨리 뒤로 — 고개를 들어도 턱선은 거의 제자리, 이목구비만 움직임
        const zFace = S.rz * Math.sqrt(clamp(1 - fu * fu - fv * fv * 0.7, 0.04, 1));
        // 머리 둥근 지붕 깊이 (머리카락): 가운데 앞쪽이 크고 윤곽에서 0
        const du = (x - D.cx) / D.rx;
        const dv = (y - D.cy) / D.ry;
        const rr = Math.sqrt(du * du + dv * dv);
        const zDome = S.rz * D.top * Math.sqrt(clamp(1 - rr * rr, 0, 1));
        const inside = 1 - smooth(0.72, 1.05, rr);
        switch (p.kind) {
          case 'hair':
            // z0: 다발마다 앞뒤 깊이 차이 (앞 다발일수록 고개를 돌리면 더 밀려 다발 사이에 시차가 생김)
            p.z[i] = zDome + S.rz * D.bang * (1 - smooth(0.6, 1.0, Math.sqrt(fu * fu + fv * fv))) + S.rz * (p.z0 ?? 0);
            p.c[i] = inside;
            break;
          case 'hair_back': {
            // 목덜미 쪽(턱선 아래)은 깊이 0 → 고개를 들거나 돌려도 옷깃 위에 머물러 턱선과 옷깃 사이가 비지 않음
            const nape = 1 - smooth(R.neckPivot[1] - 95, R.neckPivot[1] - 25, y);
            // 정수리 쪽은 앞머리와 같은 깊이 (고개를 숙이면 머리 윗선이 뒷머리보다 더 내려가 그 사이로 배경이 비쳤음). 옆은 덜 움직여 겹이 드러남
            const topW = 1 - smooth(D.cy - 140, D.cy + 10, y);
            p.z[i] = zDome * lerp(0.45, 1, topW) * nape;
            p.c[i] = inside * lerp(0.6, 1, topW) * nape;
            // 머리 묶음은 기울기를 같이 따라감 (Bunraku 관찰: 고개 기울기는 머리카락·얼굴·후드가 한 덩어리로 돈다).
            // 목 바로 뒤 가운데 좁은 띠만 덜 돌아 옷깃 위에 머묾 — 옆머리까지 덜 돌면 기울일 때 얼굴 옆으로 삐져나옴
            const cen = 1 - smooth(R.neck.halfW * 0.6, R.neck.halfW * 1.4, Math.abs(x - R.neckPivot[0]));
            (p.rw ??= new Float32Array(n).fill(1))[i] = 1 - 0.55 * (1 - nape) * cen;
            break;
          }
          case 'ahoge': {
            // 뿌리 자리의 머리 지붕 깊이 그대로 (머리카락과 같이 움직여 떨어지지 않음)
            const rt = R.attach.ahoge?.root ?? [x, y];
            const au = (rt[0] - D.cx) / D.rx;
            const av = (rt[1] - D.cy) / D.ry;
            p.z[i] = S.rz * D.top * Math.sqrt(clamp(1 - au * au - av * av, 0, 1));
            p.c[i] = 1 - smooth(0.72, 1.05, Math.sqrt(au * au + av * av));
            break;
          }
          case 'ear':
            p.z[i] = S.rz * 0.12;
            p.c[i] = 1;
            break;
          default:
            p.z[i] = zFace + S.rz * (p.z0 ?? 0);
            p.c[i] = 1;
        }
      }
      // 머리카락 다발 휨: 다발(뿌리→끝)마다 정점 무게
      if (p.kind === 'hair' || p.kind === 'ahoge' || p.kind === 'hair_back') {
        p.bends = [];
        for (const h of R.hair.bends) {
          if (h.layers ? !h.layers.includes(p.tag) : (h.layer ?? 'hair') !== p.tag) continue;
          const ux = h.tip[0] - h.root[0];
          const uy = h.tip[1] - h.root[1];
          const L = Math.hypot(ux, uy);
          const w1 = new Float32Array(n);
          const w2 = new Float32Array(n);
          let any = false;
          for (let i = 0; i < n; i++) {
            const dx = p.rest[2 * i] - h.root[0];
            const dy = p.rest[2 * i + 1] - h.root[1];
            const s = (dx * ux + dy * uy) / (L * L);
            const d = (-dx * uy + dy * ux) / L;
            const lat = Math.exp(-((d / h.radius) ** 2));
            const a = smooth(0, 1, s) ** 1.3 * lat;
            const b = smooth(0.45, 1.15, s) * lat;
            w1[i] = a;
            w2[i] = b;
            if (a > 0.002) any = true;
          }
          if (any) p.bends.push({ h, w1, w2 });
        }
      }
      // 팔: 어깨 → 손 방향 좌표 (s: 축 위치 px, 뿌리 살 이음 무게, 팔꿈치·손목 무게)
      if (p.space === 'arm') {
        const A = R.arms[p.side];
        const ux = A.hand[0] - A.pivot[0];
        const uy = A.hand[1] - A.pivot[1];
        const L = Math.hypot(ux, uy);
        p.ws = new Float32Array(n);
        p.we = new Float32Array(n);
        p.wh = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const dx = p.rest[2 * i] - A.pivot[0];
          const dy = p.rest[2 * i + 1] - A.pivot[1];
          const s = (dx * ux + dy * uy) / L;
          p.ws[i] = smooth(-A.root * 0.35, A.root, s);
          p.we[i] = smooth(A.elbow - A.root * 0.5, A.elbow + A.root * 0.5, s);
          p.wh[i] = smooth(A.wrist - 12, A.wrist + 12, s);
        }
        p.armL = L;
      }
      // 다리: 발(0) → 엉덩이(1)
      if (p.space === 'leg') {
        const G = R.legs[p.side];
        p.wl = new Float32Array(n);
        for (let i = 0; i < n; i++) p.wl[i] = clamp((G.foot[1] - p.rest[2 * i + 1]) / (G.foot[1] - G.hip[1]), 0, 1.3);
      }
    }
  }

  // ---------- 입·효과 그림 (캔버스로 그려 텍스처로) ----------
  makeSprites() {
    const R = this.rig;
    const M = R.mouth;
    const mk = (tag, cx, cy, w, h, px, cell = 8) => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * px);
      c.height = Math.ceil(h * px);
      const tex = this.r.createTexture(c, { mipmap: false });
      const x = cx - w / 2;
      const y = cy - h / 2;
      const g = gridMesh(x, y, w, h, null, cell);
      const mesh = this.r.createMesh(tex, g.positions, g.uvs, g.indices);
      return { tag, kind: 'sprite', space: 'head', canvas: c, ctx: c.getContext('2d'), tex, px, x, y, w, h, cx, cy, mesh, rest: g.positions.slice(), out: new Float32Array(g.positions.length), n: g.positions.length / 2, key: '' };
    };
    this.mouth = mk('mouth', M.cx, M.cy, M.w * 2.2, M.h * 2.4, 3);
    const E = R.eyes;
    const F = R.face;
    // 볼 홍조(더하기), 눈물, 하트·흰 눈(홍채 자리), 땀·화남·그늘(머리 위)
    this.fx = {
      blush: mk('blush', F.cx, R.blush.cy, F.rx * 1.9, F.ry * 0.5, 2),
      tear: mk('tear', F.cx, (E.r.iris.cy + E.l.iris.cy) / 2 + F.ry * 0.35, F.rx * 2, F.ry * 0.8, 2),
      tear2: mk('tear2', F.cx, (E.r.iris.cy + E.l.iris.cy) / 2 + F.ry * 0.35, F.rx * 2, F.ry * 0.8, 2),
      heart_r: mk('heart_r', E.r.iris.cx, E.r.iris.cy, E.r.iris.w * 1.1, E.r.iris.w * 1.1, 3),
      heart_l: mk('heart_l', E.l.iris.cx, E.l.iris.cy, E.l.iris.w * 1.1, E.l.iris.w * 1.1, 3),
      blank_r: mk('blank_r', E.r.iris.cx, E.r.iris.cy, E.r.iris.w * 1.05, E.r.iris.h * 1.2, 2),
      blank_l: mk('blank_l', E.l.iris.cx, E.l.iris.cy, E.l.iris.w * 1.05, E.l.iris.h * 1.2, 2),
      sweat: mk('sweat', F.cx + F.rx * 1.05, F.cy - F.ry * 0.55, F.rx * 0.35, F.ry * 0.5, 3),
      anger: mk('anger', F.cx + F.rx * 0.8, F.cy - F.ry * 1.2, F.rx * 0.5, F.rx * 0.5, 3),
      gloom: mk('gloom', F.cx, F.cy - F.ry * 0.55, F.rx * 1.4, F.ry * 0.7, 2),
    };
    // 혀 (메롱): 입 아래로 내미는 분홍 혀 — 그림체에 맞춰 굵은 테두리 (2026-11-01, 사용자: 필요하면 그려도 됨)
    this.tongueSp = mk('tongue', M.cx, M.cy + M.h * 0.55, M.w * 0.48, M.h * 0.85, 3, 4);
    // 울먹 입(〰): 떨리는 물결선 (시트 '울먹임·슬픔 최대'), 2026-11-02
    this.wavySp = mk('wavy', M.cx, M.cy + M.h * 0.05, M.w * 1.3, M.h * 0.8, 3, 4);
    // >< 눈 (대성통곡·아픔): 눈마다
    this.crossSp = {};
    for (const side of ['r', 'l']) {
      const E2 = R.eyes[side];
      this.crossSp[side] = mk(`cross_${side}`, (E2.ox0 + E2.ox1) / 2, E2.closeY, E2.ox1 - E2.ox0 + 50, E2.openH * 2.4 + 40, 3, 6);
    }
    // 물음표 (의심): 머리 옆 위
    this.fx.question = mk('question', R.face.cx + R.face.rx * 1.0, R.face.cy - R.face.ry * 1.25, R.face.rx * 0.5, R.face.ry * 0.7, 3);
    // 손 모양 스프라이트 (양쪽 × 7). 크기는 원래 둥근 손(지름 ≈ root 1.2배)에 맞춤. 손목 축은 그림의 (50, 86)
    this.handSz = R.arms.r.root * 2.8; // 시트의 손은 소매 폭보다 조금 큼
    this.handSp = { r: {}, l: {} };
    for (const side of ['r', 'l']) {
      for (const pose of HAND_POSES) {
        const sp = mk(`hand_${side}_${pose}`, 0, 0, this.handSz, this.handSz, 3, this.handSz / 2);
        sp.space = 'arm';
        drawHandPose(sp.ctx, sp.canvas.width, pose, side === 'r');
        this.r.updateTexture(sp.tex, sp.canvas);
        this.handSp[side][pose] = sp;
      }
    }
    this.drawFxSprites();
    this.closedSp = {};
    for (const side of ['r', 'l']) {
      const E2 = R.eyes[side];
      this.closedSp[side] = mk(`closed_${side}`, (E2.x0 + E2.x1) / 2, E2.closeY, E2.x1 - E2.x0 + 60, E2.openH * 2.6 + 40, 3, 6);
    }
    this.lowSp = {};
    for (const side of ['r', 'l']) {
      const E2 = R.eyes[side];
      this.lowSp[side] = mk(`low_${side}`, (E2.x0 + E2.x1) / 2, E2.lowMax, E2.x1 - E2.x0 + 20, E2.openH * 1.6 + 20, 3, 6);
    }
  }

  drawFxSprites() {
    const R = this.rig;
    const F = R.face;
    const E = R.eyes;
    const fx = this.fx;
    const put = (sp) => this.r.updateTexture(sp.tex, sp.canvas);
    // 혀: 위는 입술 뒤에 숨는 평평한 끝, 아래는 둥근 끝, 가운데 홈 선. 위쪽 1/4 은 입 안(어두운 분홍)
    {
      const s = this.tongueSp;
      const g = s.ctx;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.clearRect(0, 0, W, H);
      const lw = Math.max(2.4, R.mouth.h * 0.07) * s.px;
      const x0 = W * 0.14;
      const x1 = W * 0.86;
      const yT = H * 0.02;
      const yB = H * 0.96;
      const rr = (x1 - x0) / 2;
      g.beginPath();
      g.moveTo(x0, yT);
      g.lineTo(x1, yT);
      g.lineTo(x1, yB - rr);
      g.arc((x0 + x1) / 2, yB - rr, rr, 0, Math.PI);
      g.closePath();
      g.fillStyle = 'rgb(240,150,172)';
      g.fill();
      g.lineJoin = 'round';
      g.lineWidth = lw;
      g.strokeStyle = `rgb(${R.mouth.edge.map(Math.round).join(',')})`;
      g.stroke();
      // 가운데 홈
      g.beginPath();
      g.moveTo(W / 2, H * 0.3);
      g.quadraticCurveTo(W / 2 - W * 0.03, H * 0.6, W / 2, H * 0.82);
      g.lineWidth = lw * 0.7;
      g.strokeStyle = 'rgba(190,95,125,0.9)';
      g.lineCap = 'round';
      g.stroke();
      // 윗부분 살짝 어둡게 (입 안쪽)
      const grd = g.createLinearGradient(0, yT, 0, H * 0.45);
      grd.addColorStop(0, 'rgba(120,40,70,0.55)');
      grd.addColorStop(1, 'rgba(120,40,70,0)');
      g.fillStyle = grd;
      g.fillRect(x0 + lw / 2, yT, x1 - x0 - lw, H * 0.45);
      put(s);
    }
    // 울먹 입: 물결선 (2.5 주기), 입 색 테두리
    {
      const s = this.wavySp;
      const g = s.ctx;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.clearRect(0, 0, W, H);
      const lw = Math.max(2.6, R.mouth.h * 0.08) * s.px;
      g.lineWidth = lw;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = `rgb(${R.mouth.edge.map(Math.round).join(',')})`;
      g.beginPath();
      const x0 = W * 0.12;
      const x1 = W * 0.88;
      const amp = H * 0.16;
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const x = x0 + (x1 - x0) * u;
        const y = H * 0.5 + Math.sin(u * Math.PI * 5) * amp;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      put(s);
    }
    // >< 눈: 바깥 위·아래에서 안쪽(코 쪽) 한 점으로 모이는 두 획
    for (const side of ['r', 'l']) {
      const s = this.crossSp[side];
      const E2 = R.eyes[side];
      const g = s.ctx;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.clearRect(0, 0, W, H);
      const px = s.px;
      const thick = Math.max(3, E2.openH * 0.2) * px;
      const xo = side === 'r' ? (E2.ox0 + 22 - s.x) * px : (E2.ox1 - 22 - s.x) * px; // 바깥 눈꼬리
      const xi = side === 'r' ? (E2.ox1 - 22 - s.x) * px : (E2.ox0 + 22 - s.x) * px; // 안쪽(코 쪽)
      const yc = (E2.closeY - s.y) * px;
      const hh = E2.openH * 0.42 * px;
      g.strokeStyle = '#080608';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = thick;
      g.beginPath();
      g.moveTo(xo, yc - hh);
      g.lineTo(xi, yc);
      g.lineTo(xo, yc + hh);
      g.stroke();
      put(s);
    }
    // 물음표: 보라 글자 + 어두운 테두리
    {
      const s = fx.question;
      const g = s.ctx;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.clearRect(0, 0, W, H);
      g.font = `bold ${Math.round(H * 0.92)}px "Segoe UI", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = W * 0.14;
      g.strokeStyle = '#2a1840';
      g.strokeText('?', W / 2, H * 0.55);
      g.fillStyle = '#c08cff';
      g.fillText('?', W / 2, H * 0.55);
      put(s);
    }
    // 홍조: 원본 볼 홍조 자리에 더 진한 분홍 타원 + 빗금
    {
      const s = fx.blush;
      const g = s.ctx;
      g.clearRect(0, 0, s.canvas.width, s.canvas.height);
      for (const b of R.blush.spots) {
        const x = (b[0] - s.x) * s.px;
        const y = (b[1] - s.y) * s.px;
        const rx = b[2] * s.px;
        const ry = b[3] * s.px;
        const grd = g.createRadialGradient(x, y, 0, x, y, rx);
        grd.addColorStop(0, 'rgba(255,120,150,0.75)');
        grd.addColorStop(0.7, 'rgba(255,130,160,0.45)');
        grd.addColorStop(1, 'rgba(255,140,170,0)');
        g.save();
        g.translate(x, y);
        g.scale(1, ry / rx);
        g.translate(-x, -y);
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, rx, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.strokeStyle = 'rgba(235,90,120,0.8)';
        g.lineWidth = 2.2 * s.px;
        g.lineCap = 'round';
        for (let k = -2; k <= 2; k++) {
          const lx = x + k * rx * 0.32;
          g.beginPath();
          g.moveTo(lx + rx * 0.08, y - ry * 0.45);
          g.lineTo(lx - rx * 0.08, y + ry * 0.45);
          g.stroke();
        }
      }
      put(s);
    }
    // 눈물: tear(고임) — 아래 눈꺼풀을 따라 얇게 맺힌 물 / tear2(흐름) — 눈 바깥쪽 아래로 흐르는 가는 줄기
    for (const [name, flow] of [['tear', false], ['tear2', true]]) {
      const s = fx[name];
      const g = s.ctx;
      g.clearRect(0, 0, s.canvas.width, s.canvas.height);
      for (const [e, side] of [[E.r, -1], [E.l, 1]]) {
        const px = s.px;
        const cx = (e.iris.cx - s.x) * px;
        const y0 = (e.lowMax - 3 - s.y) * px;
        const hw = e.iris.w * 0.42 * px;
        g.lineCap = 'round';
        if (!flow) {
          // 물방울 반달: 아래 눈꺼풀 선을 따라
          g.fillStyle = 'rgba(170,225,255,0.85)';
          g.strokeStyle = 'rgba(80,150,225,0.9)';
          g.lineWidth = 1.6 * px;
          g.beginPath();
          g.moveTo(cx - hw, y0);
          g.quadraticCurveTo(cx, y0 + 14 * px, cx + hw, y0);
          g.quadraticCurveTo(cx, y0 + 5 * px, cx - hw, y0);
          g.fill();
          g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.9)';
          g.beginPath();
          g.ellipse(cx - hw * 0.35, y0 + 4 * px, 3 * px, 1.6 * px, 0, 0, Math.PI * 2);
          g.fill();
        } else {
          // 바깥쪽에서 볼을 타고 흐르는 줄기 (점점 가늘게) + 끝 물방울
          const sx = cx + side * hw * 0.75;
          const grd = g.createLinearGradient(0, y0, 0, y0 + 60 * px);
          grd.addColorStop(0, 'rgba(150,215,255,0.9)');
          grd.addColorStop(1, 'rgba(150,215,255,0.55)');
          g.strokeStyle = grd;
          g.lineWidth = 5 * px;
          g.beginPath();
          g.moveTo(sx, y0 + 4 * px);
          g.quadraticCurveTo(sx + side * 3 * px, y0 + 30 * px, sx + side * 1 * px, y0 + 55 * px);
          g.stroke();
          g.fillStyle = 'rgba(150,215,255,0.95)';
          g.strokeStyle = 'rgba(80,150,225,0.9)';
          g.lineWidth = 1.4 * px;
          g.beginPath();
          g.arc(sx + side * 1 * px, y0 + 60 * px, 4.5 * px, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }
      put(s);
    }
    // 하트 눈
    for (const side of ['r', 'l']) {
      const s = fx[`heart_${side}`];
      const g = s.ctx;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.clearRect(0, 0, W, H);
      const heart = (cx, cy, r, fill, stroke) => {
        g.beginPath();
        g.moveTo(cx, cy + r * 0.9);
        g.bezierCurveTo(cx - r * 1.4, cy - r * 0.1, cx - r * 0.7, cy - r * 1.1, cx, cy - r * 0.4);
        g.bezierCurveTo(cx + r * 0.7, cy - r * 1.1, cx + r * 1.4, cy - r * 0.1, cx, cy + r * 0.9);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        if (stroke) {
          g.lineWidth = W * 0.035;
          g.strokeStyle = stroke;
          g.stroke();
        }
      };
      heart(W / 2, H * 0.55, W * 0.36, '#ff5d9e', '#b0185a');
      heart(W * 0.4, H * 0.42, W * 0.08, 'rgba(255,255,255,0.9)');
      put(s);
    }
    // 흰 눈 (멍함): 홍채 자리를 흰색으로 덮고 작은 점
    for (const side of ['r', 'l']) {
      const s = fx[`blank_${side}`];
      const g = s.ctx;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#fbfafb';
      g.beginPath();
      g.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a1840';
      g.beginPath();
      g.arc(W / 2, H * 0.58, W * 0.07, 0, Math.PI * 2);
      g.fill();
      put(s);
    }
    // 땀방울
    {
      const s = fx.sweat;
      const g = s.ctx;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(160,220,255,0.95)';
      g.strokeStyle = '#3d7fcf';
      g.lineWidth = W * 0.06;
      g.beginPath();
      g.moveTo(W * 0.5, H * 0.12);
      g.bezierCurveTo(W * 0.62, H * 0.38, W * 0.86, H * 0.55, W * 0.82, H * 0.72);
      g.arc(W * 0.5, H * 0.72, W * 0.32, 0, Math.PI);
      g.bezierCurveTo(W * 0.14, H * 0.55, W * 0.38, H * 0.38, W * 0.5, H * 0.12);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.ellipse(W * 0.4, H * 0.68, W * 0.07, H * 0.06, -0.5, 0, Math.PI * 2);
      g.fill();
      put(s);
    }
    // 화남 표시 (네 갈래 핏줄)
    {
      const s = fx.anger;
      const g = s.ctx;
      const W = s.canvas.width;
      g.clearRect(0, 0, W, W);
      g.strokeStyle = '#e8304a';
      g.lineWidth = W * 0.09;
      g.lineCap = 'round';
      const c = W / 2;
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        const bx = Math.cos(a + Math.PI / 2);
        const by = Math.sin(a + Math.PI / 2);
        g.beginPath();
        g.moveTo(c + ax * W * 0.12 + bx * W * 0.2, c + ay * W * 0.12 + by * W * 0.2);
        g.quadraticCurveTo(c + ax * W * 0.12, c + ay * W * 0.12, c + ax * W * 0.12 - bx * W * 0.2, c + ay * W * 0.12 - by * W * 0.2);
        g.stroke();
      }
      put(s);
    }
    // 그늘선 (이마 위 세로줄)
    {
      const s = fx.gloom;
      const g = s.ctx;
      const W = s.canvas.width;
      const H = s.canvas.height;
      g.clearRect(0, 0, W, H);
      g.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const x = W * (0.12 + k * 0.095);
        const len = H * (0.55 + 0.35 * Math.abs(Math.sin(k * 1.7)));
        const grd = g.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, 'rgba(110,90,200,0.55)');
        grd.addColorStop(1, 'rgba(110,90,200,0)');
        g.strokeStyle = grd;
        g.lineWidth = W * 0.022;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, len);
        g.stroke();
      }
      put(s);
    }
  }

  // 입 모양 그리기: open 0~1, wide −1(오므림)~1(옆으로), form −1(처짐)~1(웃음)
  // 입 모양 그리기 (m: open 0~1, wide −1~1, fL·fR 입꼬리 −1~1 — fL 은 캐릭터 왼쪽 = 화면 오른쪽 입꼬리,
  // x 좌우 이동 −1~1, pucker 오므려 내밂 0~1, upper 윗입술 올림 0~1, puff 볼 부풀림 0~1)
  drawMouth(m) {
    const sp = this.mouth;
    const q = (v, k = 24) => Math.round(v * k);
    const key = [q(m.open, 40), q(m.wide), q(m.fL), q(m.fR), q(m.x), q(m.pucker), q(m.upper), q(m.puff)].join('_');
    if (key === sp.key) return;
    sp.key = key;
    const M = this.rig.mouth;
    const g = sp.ctx;
    const px = sp.px;
    const W = sp.canvas.width;
    const H = sp.canvas.height;
    g.clearRect(0, 0, W, H);
    const form = (m.fL + m.fR) / 2;
    const cx = W / 2 + m.x * M.w * 0.22 * px;
    const cy = H / 2 - M.h * 0.1 * px;
    let mw = M.w * px * clamp(0.46 + 0.4 * Math.min(1, m.open * 1.4) + 0.32 * Math.max(0, m.wide) - 0.24 * Math.max(0, -m.wide) + 0.1 * Math.max(0, form), 0.3, 1.25);
    mw *= (1 - 0.45 * m.pucker) * (1 - 0.2 * m.puff);
    let mh = M.h * 1.22 * px * m.open * (1 - 0.3 * Math.max(0, m.wide));
    if (m.pucker > 0.25) mh = Math.max(mh, m.pucker * M.h * 0.32 * px); // 오므리면 작은 동그라미
    const liftL = m.fR * M.h * 0.24 * px; // 화면 왼쪽 입꼬리
    const liftR = m.fL * M.h * 0.24 * px; // 화면 오른쪽 입꼬리
    const edge = `rgb(${M.edge.map(Math.round).join(',')})`;
    const lw = Math.max(2.6, M.h * 0.07) * px;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const hw = mw / 2;
    if (mh < 2.2 * px) {
      // 닫은 입: 짧은 곡선 (웃으면 ∪, 처지면 ∩, 한쪽만 올리면 비웃음)
      const h2 = hw * 0.84;
      g.strokeStyle = edge;
      g.lineWidth = lw * 1.05;
      g.beginPath();
      g.moveTo(cx - h2, cy - liftL);
      g.quadraticCurveTo(cx, cy + (liftL + liftR) * 0.45 + mh * 0.5, cx + h2, cy - liftR);
      g.stroke();
      this.r.updateTexture(sp.tex, sp.canvas);
      return;
    }
    const round = Math.max(m.pucker, Math.max(0, -m.wide) * 0.6);
    const top = cy - mh * (0.38 + 0.12 * round) - m.upper * mh * 0.15;
    const bot = cy + mh * (0.62 - 0.12 * round);
    const path = () => {
      g.beginPath();
      g.moveTo(cx - hw, cy - liftL);
      g.bezierCurveTo(cx - hw * (0.75 - 0.2 * round), top - mh * 0.05, cx + hw * (0.75 - 0.2 * round), top - mh * 0.05, cx + hw, cy - liftR);
      g.bezierCurveTo(cx + hw * 1.02, bot + liftR * 0.3, cx - hw * 1.02, bot + liftL * 0.3, cx - hw, cy - liftL);
      g.closePath();
    };
    path();
    g.fillStyle = `rgb(${M.cavity.map(Math.round).join(',')})`;
    g.fill();
    g.save();
    path();
    g.clip();
    // 윗니: 크게 벌리거나 옆으로 벌리면·윗입술을 올리면 보임
    const teeth = clamp((m.open - 0.25) * 2.2 + m.wide * 0.6 + m.upper, 0, 1) * (1 - round);
    if (teeth > 0.02) {
      g.fillStyle = `rgba(252,249,250,${Math.min(1, teeth * 1.4)})`;
      const th = mh * (0.16 + 0.1 * m.upper);
      g.beginPath();
      g.ellipse(cx, top + th * 0.25, hw * 0.78, th, 0, 0, Math.PI * 2);
      g.fill();
    }
    // 혀: 아래쪽 밝은 분홍
    g.fillStyle = `rgb(${M.fill.map(Math.round).join(',')})`;
    g.beginPath();
    g.ellipse(cx, bot + mh * 0.05, hw * 0.78, mh * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    path();
    g.strokeStyle = edge;
    g.lineWidth = lw;
    g.stroke();
    this.r.updateTexture(sp.tex, sp.canvas);
  }

  // 입 모양 스프라이트 고르기 (VTuberAvatarStudio 처럼 모음별 그림을 바꿔 끼움): 벌림·옆으로·웃음·오므림을 모양마다 정한 기준값과
  // 비교해 가장 가까운 한 장을 쓴다. 두 장을 반투명으로 섞으면 유령처럼 겹쳐 보여(2026-11-01 검수) 섞지 않고, 지금 모양보다 확실히
  // 가까워졌을 때만(여유 margin, 최소 유지 0.1초) 바꾼다. 벌린 높이는 모양과 상관없이 벌림 값에 따라 이어지게 세로 배율로 맞춘다
  // (바뀌는 순간 높이가 튀지 않게). 같은 그림을 기준값 둘로 등록할 수 있다 (작게 벌린 '아' = mouth_a 를 눌러 씀)
  pickMouth(open, wide, form, pucker, puff, dt = 1 / 30, press = 0) {
    const P0 = [
      ['mouth_rest', 0.0, 0.0, 0.0], ['mouth_closed', 0.0, 0.0, 0.0], ['mouth_a', 0.22, 0.0, 0.0], ['mouth_a', 0.75, 0.0, 0.0], ['mouth_e', 0.4, 0.55, 0.1], ['mouth_i', 0.5, 1.0, 0.25],
      ['mouth_o_small', 0.25, -0.85, 0.0], ['mouth_o', 0.6, -0.6, 0.0], ['mouth_u', 0.95, -0.45, -0.1],
      ['mouth_smile', 0.5, 0.2, 0.9], ['mouth_laugh', 0.95, 0.45, 0.9],
    ];
    const w = clamp(wide - pucker * 0.9 - puff * 0.5, -1, 1);
    const shut = (Math.max(0, open - 0.05) / 0.09) ** 2;
    const af = Math.abs(form);
    const hasRest = !!this.spr.mouth_rest;
    const sc = P0.map(([name, o, wd, f]) => {
      let d = ((open - o) / 0.22) ** 2 + ((w - wd) / 0.55) ** 2 + ((form - f) / 0.6) ** 2;
      // 가만히 있을 때: 원본의 작은 'o'(mouth_rest). 입꼬리를 올리거나 내리면(|form| > 0.4) 다문 선(mouth_closed, 입꼬리로 휨)
      if (name === 'mouth_rest') d = hasRest ? shut + (af / 0.3) ** 2 + (pucker / 0.4) ** 2 + (press / 0.3) ** 2 : 1e9;
      else if (name === 'mouth_closed') d = shut + (hasRest ? ((1 - af) / 0.45) ** 2 * (1 - press) : (form / 1.5) ** 2);
      else if (open < 0.06 && pucker < 0.3) d += 40;
      return { name, d };
    });
    const best = sc.reduce((a, b) => (b.d < a.d ? b : a));
    const st = this.mouthSt ?? (this.mouthSt = { name: best.name, hold: 0 });
    st.hold += dt;
    const dcur = Math.min(...sc.filter((x) => x.name === st.name).map((x) => x.d));
    if (best.name !== st.name && st.hold > 0.1 && best.d < dcur - 0.5) {
      st.name = best.name;
      st.hold = 0;
    }
    // 벌린 높이 목표(모델 px): 그림들의 (벌림, 높이) 를 지나는 직선 — 닫힘 7px, '아' 0.75 → 38px, 크게 0.95 → 47px
    const sp = this.spr[st.name];
    const fixed = st.name === 'mouth_closed' || st.name === 'mouth_rest';
    const hTarget = fixed ? sp.h : 7 + 42 * clamp(open, 0.08, 1.05);
    const sy = fixed ? 1 : clamp(hTarget / sp.h, 0.4, 1.3);
    return [{ name: st.name, a: 1, sy }];
  }

  // 웃거나 찡그릴 때 올라오는 아래 눈꺼풀 선 (원본엔 아래 선이 없어 그려 넣음)
  drawLowerLid(side, st) {
    const sp = this.lowSp[side];
    const key = `${Math.round(st.squint * 30)}_${Math.round(st.k * 30)}_${Math.round(st.smile * 20)}`;
    if (sp.key === key) return;
    sp.key = key;
    const E = this.rig.eyes[side];
    const g = sp.ctx;
    const px = sp.px;
    g.clearRect(0, 0, sp.canvas.width, sp.canvas.height);
    const xa = E.ox0 + (E.ox1 - E.ox0) * 0.12;
    const xb = E.ox1 - (E.ox1 - E.ox0) * 0.12;
    g.strokeStyle = 'rgba(92,52,74,0.75)';
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.4, E.openH * 0.04) * px;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const x = xa + (xb - xa) * (i / 24);
      const y = this.eyeLowY(E, st, x, side) + 1.5;
      if (i === 0) g.moveTo((x - sp.x) * px, (y - sp.y) * px);
      else g.lineTo((x - sp.x) * px, (y - sp.y) * px);
    }
    g.stroke();
    this.r.updateTexture(sp.tex, sp.canvas);
  }

  // 눈 열림 k → 띠 위치(kb)·눈 열림(ko) 진행도. 띠는 k=0.1 에서 감은 선에 닿고(그 아래는 감은 눈 그림으로 바뀜),
  // 눈 열림(흰자·홍채)은 k=0.2 에서 이미 닫혀 그림으로 바뀌는 동안 흰자·홍채가 비치지 않는다 (2026-11-01 깜빡임 끝의 보라 틈 수정)
  eyeK(k) {
    // k > 1 (눈 크게 뜨기): 띠가 쉬는 자리보다 위로 올라가 홍채 윗부분이 드러남 (시트 '눈 크게 뜸 최대'), 아래 눈꺼풀도 조금 내려감
    if (k > 1) return { kb: 1 + (k - 1) * 1.6, ko: 1 + (k - 1) * 0.3 };
    return { kb: clamp((k - 0.1) / 0.9, 0, 1), ko: clamp((k - 0.2) / 0.8, 0, 1) };
  }

  // 눈꼬리 처짐: 바깥 눈꼬리 쪽으로 갈수록 띠가 내려옴 (lidTilt +, 눈 뜬 만큼만). r 눈의 바깥은 왼쪽(x0), l 눈은 오른쪽(x1)
  lidTiltFn(E, st, side) {
    const t = st.tilt ?? 0;
    if (Math.abs(t) < 0.005) return () => 0;
    const amt = t * E.openH * 0.3 * Math.min(1, st.k);
    return side === 'r' ? (x) => amt * smooth(E.ox1, E.ox0 + (E.ox1 - E.ox0) * 0.15, x) : (x) => amt * smooth(E.ox0, E.ox1 - (E.ox1 - E.ox0) * 0.15, x);
  }

  // 아래 눈꺼풀 높이 (눈 열림 k, 찡그림·웃음에 따라): 위 띠 아래 끝에서 아래 경계까지를 열림 진행도로
  eyeLowY(E, st, x, side) {
    const { kb, ko } = this.eyeK(st.k);
    const Lw = sample(E.low, x);
    const U = sample(E.up, x);
    const C = this.closedY(E, st.smile, x);
    const Uk = C + (U - C) * kb + (side ? this.lidTiltFn(E, st, side)(x) : 0);
    let L = Uk + (Lw - Uk) * ko;
    L -= st.squint * (Lw - U) * 0.22 * ko;
    return L;
  }

  // ---------- 매 프레임 ----------
  update(P, dt) {
    if (this.rig.faceProfile) P = facePose(P);
    P = { ...P };
    this.applyExpressions(P);
    this.time += dt;
    const t = this.t;
    const R = this.rig;
    const S = R.skull;

    // --- 물리 입력 → 출력 ---
    const pv = this.physParams?.values;
    if (this.physics && pv) {
      const I = this.physIndex;
      pv[I.AngleX] = P.angleX ?? 0;
      pv[I.AngleY] = P.angleY ?? 0;
      pv[I.AngleZ] = (P.angleZ ?? 0) * t.rollScale;
      pv[I.BodyX] = (P.bodyX ?? 0) + (P.bodyYaw ?? 0) * 0.6;
      pv[I.BodyZ] = P.bodyZ ?? 0;
      pv[I.BodyYaw] = P.bodyYaw ?? 0;
      pv[I.Breath] = P.breath ?? 0;
      pv[I.BodyY] = (P.bodyY ?? 0) * 10;
      this.physics.evaluate(dt);
    }
    const ph = (id) => (pv && this.physIndex[id] !== undefined ? pv[this.physIndex[id]] : 0);
    const wind = t.wind * (Math.sin(this.time * 1.3) * 0.6 + Math.sin(this.time * 2.3 + 1.1) * 0.4);

    // --- 몸 ---
    const B = R.body;
    const span = B.hip[1] - B.neck[1];
    // 고개 기울기는 몸에 대한 상대 각도를 부드럽게 제한하고, 넘친 만큼은 몸이 대신 기울게 (목 관절이 무리하게 꺾이지 않게 —
    // img2rig: 목 뒤 채움은 작은 흔들림까지만 버팀)
    const rollRaw = (P.angleZ ?? 0) * DEG * t.rollScale;
    const rLim = t.rollLimit * DEG;
    const roll = rLim * Math.tanh(rollRaw / rLim);
    const bz = (P.bodyZ ?? 0) * DEG * 0.5 * t.bodyBend + (rollRaw - roll) * 0.75;
    const bx = (P.bodyX ?? 0) * (R.head.rx / 60);
    const yawB = (P.bodyYaw ?? 0) * DEG * 2.0; // 몸 돌리기 ±10 → ±20° 로 보이게 (시트 '몸 회전 끝')
    const syB = Math.sin(yawB);
    const cyB = Math.cos(yawB);
    const breath = (P.breath ?? 0) * span * 0.016;
    const chest = 1 + (P.breath ?? 0) * 0.01; // 들이쉬면 가슴·어깨 폭이 살짝 넓어짐
    const shoulder = clamp(P.shoulder ?? 0, -1, 1) * span * 0.1; // 어깨 으쓱 ±1 → 어깨 띠 ±28px (시트 '어깨 상승 끝')
    const lean = clamp(P.bodyLean ?? 0, -10, 10);
    // 숙임은 고개를 숙일 때만 (카메라에 그냥 가까이 온 것과 구분), 젖힘은 고개를 들 때만
    const bowK = smooth(4, 10, lean) * smooth(-6, -18, P.angleY ?? 0) * t.bow;
    const backK = smooth(-4, -10, lean) * smooth(5, 15, P.angleY ?? 0) * t.bow;
    const bodyY = clamp(P.bodyY ?? 0, -1, 1);
    const hop = Math.max(0, bodyY) * span * 0.16;
    const dip = Math.max(0, -bodyY) * span * 0.1;
    const stretchT = 1 + t.squash * (bodyY > 0 ? 0.07 * bodyY : 0.05 * bodyY); // 몸통 세로 (늘어남 +7%, 압축 −5%)
    const stretchL = 1 + t.squash * Math.max(0, bodyY) * 0.1; // 다리 세로 (늘어날 때만; 압축은 dip 이 맡음)
    const hipLift = (stretchL - 1) * (R.legs.r.foot[1] - R.legs.r.hip[1]); // 다리가 늘어난 만큼 엉덩이(몸통)가 올라감
    // 뛰거나 앉거나 고개를 끄덕일 때 머리카락·바보털이 한 박자 늦게 따라옴 (세로 스프링): hopLag 이 정수리 높이를 뒤쫓고,
    // 그 차이만큼 머리카락 끝이 처짐. 정수리 높이 = 몸 위아래 + 고개 위아래(깊이 rz·0.8 자리의 세로 이동)
    {
      const hl = this.hopLag ?? (this.hopLag = { x: 0, v: 0 });
      const pitchNow = clamp((P.angleY ?? 0) / 30, -1.25, 1.25) * t.pitchMax * DEG;
      const target = hop - dip + Math.sin(pitchNow) * S.rz * 0.8;
      const w = 2 * Math.PI * 3.2;
      const h = Math.min(dt, 0.05);
      hl.v += (w * w * (target - hl.x) - 2 * 0.45 * w * hl.v) * h;
      hl.x += hl.v * h;
      this.hairDrop = clamp((target - hl.x) * 0.5, -14, 14) * t.hairPhys;
      // 몸에 달린 것(체인·목걸이·포켓치프·허벅지 끈)은 몸 높이만 뒤쫓음 (고개 끄덕임과 무관)
      const bl = this.bodyLag ?? (this.bodyLag = { x: 0, v: 0 });
      const tb = hop - dip;
      const wb = 2 * Math.PI * 3.8;
      bl.v += (wb * wb * (tb - bl.x) - 2 * 0.4 * wb * bl.v) * h;
      bl.x += bl.v * h;
      this.bodyDrop = clamp((tb - bl.x) * 0.45, -10, 10) * t.accPhys;
    }
    const BW = B.halfW;
    // 상체 변환: 재킷 밑단(엉덩이 선) 위는 단단한 한 덩어리 — 허리에 경첩이 있는 것처럼 통째로 돌고 옮겨짐 (고무처럼 휘지 않음).
    // h = 0(엉덩이) ~ 1(목). 숨은 가슴·어깨 띠만 살짝 올라감
    const torsoXf = (x, y, zd, out, i, sh = 0) => {
      const h = (B.hip[1] - y) / span;
      const wR = smooth(-0.25, -0.02, h);
      const dx = x - B.hip[0];
      const zc = Math.sqrt(clamp(1 - (dx / BW) ** 2, 0, 1)) * BW * 0.5 + zd;
      let X = dx * (1 - (1 - cyB) * 0.6 * wR) + syB * zc * wR;
      let Y = (y - B.hip[1]) * (1 + (stretchT - 1) * wR);
      const hb = smooth(0.45, 0.95, h);
      Y -= breath * hb + shoulder * sh;
      X *= 1 + (chest - 1) * hb;
      Y += lean * span * 0.004 * wR;
      X *= 1 + lean * 0.002 * wR;
      // 상체 숙임(bodyLean 4 이상)·젖힘(−4 이하): 몸통이 카메라 쪽으로 기울어 세로로 줄어 보임(숙임) / 살짝 늘어남(젖힘). 머리는 목 자리를 따라감
      Y *= 1 - bowK * 0.3 * wR + backK * 0.06 * wR;
      const a = bz * wR;
      const c = Math.cos(a);
      const s = Math.sin(a);
      out[i] = B.hip[0] + X * c - Y * s + bx;
      out[i + 1] = B.hip[1] + X * s + Y * c - hop - hipLift + dip;
    };
    const tmp = new Float32Array(2);
    const pt = (x, y, zd = 0, sh = 0) => {
      torsoXf(x, y, zd, tmp, 0, sh);
      return [tmp[0], tmp[1]];
    };
    const neckAng = bz;

    // --- 머리 ---
    const yaw = clamp((P.angleX ?? 0) / 30, -1.25, 1.25) * t.yawMax * DEG;
    const pitch = clamp((P.angleY ?? 0) / 30, -1.25, 1.25) * t.pitchMax * DEG;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    const NP = R.neckPivot;
    const np = pt(NP[0], NP[1], 0, 0.2); // 어깨를 으쓱하면 머리는 조금만 (어깨가 목 쪽으로 올라옴)
    const headAng = roll + neckAng;
    const ch = Math.cos(headAng);
    const shh = Math.sin(headAng);
    const C = S.c;
    // rw: 고개 기울기를 따라가는 정도 (목덜미 뒷머리는 덜 — 어깨 위에 얹혀 있게)
    const headXf = (x, y, z, c, out, i, rw = 1) => {
      const dx = x - C[0];
      const dy = y - C[1];
      const X = dx + z * sy + dx * (cy - 1) * c;
      const Y = dy - z * sp * (1 - 0.15 * Math.abs(sy)) + dy * (cp - 1) * c;
      const px = C[0] + X - NP[0];
      const py = C[1] + Y - NP[1];
      let c2 = ch;
      let s2 = shh;
      if (rw !== 1) {
        c2 = Math.cos(headAng * rw);
        s2 = Math.sin(headAng * rw);
      }
      out[i] = np[0] + px * c2 - py * s2;
      out[i + 1] = np[1] + px * s2 + py * c2;
    };

    // --- 손 모양 무게 (hpR_open … hpL_spread; 손을 들었는데 모양이 없으면 편 손) ---
    const handPose = {};
    for (const s of ['r', 'l']) {
      const Sd = s === 'r' ? 'R' : 'L';
      const w = {};
      let mx = 0;
      for (const pose of HAND_POSES) {
        const v = clamp(P[`hp${Sd}_${pose}`] ?? 0, 0, 1);
        if (v > 0.001) w[pose] = v;
        if (v > mx) mx = v;
      }
      const raised = clamp(P[`hand${Sd}W`] ?? 0, 0, 1);
      if (mx < 0.01 && raised > 0.3) {
        w.open = smooth(0.3, 0.6, raised);
        mx = w.open;
      }
      handPose[s] = { w, mx };
    }
    this.handPose = handPose;

    // --- 팔 각도 ---
    const A = R.arms;
    const armAng = {};
    const elbowAng = {};
    const wristAng = {};
    for (const s of ['r', 'l']) {
      const sign = s === 'r' ? -1 : 1; // 화면 시계 방향 + : 오른쪽 팔(화면 왼쪽)은 − 쪽이 아래
      const raise = clamp(P[s === 'r' ? 'armR' : 'armL'] ?? 0, -15, 40);
      const id = s === 'r' ? 'ArmSwingR' : 'ArmSwingL';
      const lag = clamp(ph(id) * t.armSway, -6, 6);
      const lag2 = clamp(ph(`${id}_2`) * t.armSway, -5, 5);
      // 살아 있는 느낌: 숨을 들이쉬면 팔이 살짝 벌어지고, 양팔이 서로 다른 박자로 아주 천천히 흔들림, 말할 때 조금 들썩
      const ph0 = s === 'r' ? 0 : 1.9;
      const idle = (Math.sin(this.time * 1.25 + ph0) * 0.35 + Math.sin(this.time * 0.53 + ph0 * 2) * 0.25) * t.wind;
      const talk = clamp(P.talk ?? 0, 0, 1);
      const open = (P.breath ?? 0) * 1.0 + talk * 2;
      // 그려진 팔이 이미 내려 있으면(rig.arms.drawnDown) 쉬는 각도 0
      const rest = A.drawnDown ? 0 : t.armRest;
      let a = sign * (rest - raise - open) + lag + idle + bz * 0.6 / DEG;
      // 팔꿈치: 흔들림을 한 박자 늦게 따라 살짝 굽음 (말할 때도 조금)
      // 팔꿈치: 흔들림을 한 박자 늦게 따라 살짝 굽음(말할 때도 조금) + 몸 추적 elbowR·L(0~60°)은 절반만 (짧은 팔이라 크게 굽히면 어색)
      const elbowTrack = clamp(P[s === 'r' ? 'elbowR' : 'elbowL'] ?? 0, -15, 60) * 0.5 * smooth(2, 12, raise);
      let e = clamp(lag2 - lag * 0.4, -3, 3) + sign * (talk * 2 + elbowTrack);
      let w = 0;
      // 손 흔들기(인사 반응): 손 목표(머리 기준) 쪽으로 팔을 들고 팔꿈치로 거리 맞춤
      const side = s === 'r' ? 'R' : 'L';
      const hw = clamp(P[`hand${side}W`] ?? 0, 0, 1);
      if (hw > 0.001) {
        const H = R.head;
        const tx = H.cx + (P[`hand${side}X`] ?? 0) * H.rx;
        const ty = H.cy + (P[`hand${side}Y`] ?? 0) * H.ry;
        const piv = pt(A[s].pivot[0], A[s].pivot[1], 0, 1);
        const vx = tx - piv[0];
        const vy = ty - piv[1];
        const dist = Math.hypot(vx, vy);
        const L = Math.hypot(A[s].hand[0] - A[s].pivot[0], A[s].hand[1] - A[s].pivot[1]);
        const restDir = Math.atan2(A[s].hand[1] - A[s].pivot[1], A[s].hand[0] - A[s].pivot[0]);
        let want = (Math.atan2(vy, vx) - restDir) / DEG;
        while (want > 180) want -= 360;
        while (want < -180) want += 360;
        const bend = Math.acos(clamp(dist / L, 0.35, 1)) / DEG; // 가까우면 팔꿈치를 굽혀 손을 당김
        const eb = sign * bend * 1.4;
        a = lerp(a, want - eb * 0.5, hw);
        e = lerp(e, eb, hw);
        w = (P[`hand${side}Rot`] ?? 0) * hw;
      }
      armAng[s] = a * DEG;
      elbowAng[s] = e * DEG;
      wristAng[s] = w * DEG;
    }

    // --- 눈 ---
    const gazeY0 = clamp(P.eyeBallY ?? 0, -1, 1);
    const eyeState = {};
    for (const s of ['r', 'l']) {
      const E = R.eyes[s];
      const side = s === 'r' ? 'R' : 'L';
      let k = clamp(P[`eyeOpen${side}`] ?? 1, 0, 1.3);
      const smile = clamp(P[`eyeSmile${side}`] ?? P.eyeSmile ?? 0, 0, 1); // 한쪽만 웃는 눈(eyeSmileL/R)도 됨
      // 눈 크게 뜨기: 표정(eyeWiden) 또는 퍼펙트 싱크 bs_eyeWide (0.3~0.8 구간)
      const bsWide = P[`bs_eyeWide${side === 'R' ? 'Right' : 'Left'}`];
      const widen = Math.max(clamp(P.eyeWiden ?? 0, 0, 1), bsWide !== undefined ? smooth(0.3, 0.8, bsWide) : 0);
      // 볼 찡그림(cheekSquint, 트래커)은 양쪽 눈을 조금씩 찡그린 것으로
      const squint = clamp((P[`eyeSquint${side}`] ?? 0) + (P.cheekSquint ?? 0) * 0.5, 0, 1);
      k = k * (1 - smile * 0.93) + widen * 0.18;
      const kw = k; // 시선 때문에 들리는 몫을 뺀 '크게 뜬' 정도 (홍채 키우기·올리기는 이것만 따름)
      // 시선을 내리면 윗눈꺼풀도 따라 내려오고, 올리면 띠가 들려 홍채가 보임 (시트 '시선 위 끝')
      k *= 1 + gazeY0 * (gazeY0 < 0 ? 0.16 : 0.22);
      // 웃는 눈: 아래 눈꺼풀이 올라옴
      const sq = Math.min(1, squint + smile * 0.6);
      // >< 눈(eyeCross): 눈을 감고 감은 눈 그림 대신 >< 그림
      const cross = clamp(P.eyeCross ?? 0, 0, 1);
      k *= 1 - cross;
      // 눈꼬리 처짐(lidTilt, 화남): 바깥쪽 눈꺼풀 띠가 내려와 눈매가 날카로워짐. pupil: 홍채 크기 (놀라면 작게)
      eyeState[s] = { k, kw, smile, squint: sq, E, tilt: clamp(P.lidTilt ?? 0, -1, 1), pupil: clamp(P.pupil ?? 0, -1, 1), cross };
    }
    const gazeX = clamp(P.eyeBallX ?? 0, -1, 1);
    const gazeY = clamp(P.eyeBallY ?? 0, -1, 1);

    // --- 입 ---
    const mOpen = clamp(P.mouthOpen ?? 0, 0, 1);
    const mWide = clamp((P.mouthWide ?? 0) - (P.mouthNarrow ?? 0), -1, 1);
    const fAll = P.mouthForm ?? 0;
    const fL = clamp(P.mouthFormL ?? fAll, -1, 1);
    const fR = clamp(P.mouthFormR ?? fAll, -1, 1);
    const puff = clamp(P.cheekPuff ?? P.bs_cheekPuff ?? 0, 0, 1);
    const pucker = clamp(Math.max(P.bs_mouthPucker ?? 0, (P.bs_mouthFunnel ?? 0) * 0.8), 0, 1) * (1 - puff * 0.3);
    const mouthX = clamp((P.mouthX ?? 0) + (P.jawX ?? 0) * 0.4, -1, 1);
    // 윗입술 올림·코 찡그림(트래커)은 이가 보이는 옆으로 벌린 입 쪽으로 (그림 입 모양 고르기에만)
    const upperW = clamp(P.upperUp ?? 0, 0, 1) * 0.5 + clamp(P.noseSneer ?? 0, 0, 1) * 0.3;
    // 입술 꾹 다물기(퍼펙트 싱크 mouthClose·mouthPress, 또는 mouthPress 값) → 쉬는 'o' 대신 다문 선
    const press = clamp(Math.max(P.mouthPress ?? 0, P.bs_mouthClose ?? 0, ((P.bs_mouthPressLeft ?? 0) + (P.bs_mouthPressRight ?? 0)) / 2), 0, 1);
    const mouthPick = this.spr.mouth_closed ? this.pickMouth(mOpen, clamp(mWide + upperW, -1, 1), (fL + fR) / 2, pucker, puff, dt, press) : null;
    if (!mouthPick) this.drawMouth({ open: mOpen, wide: mWide, fL, fR, x: mouthX, pucker, upper: clamp(P.upperUp ?? 0, 0, 1), puff });
    const jaw = clamp(P.jawOpen ?? mOpen, 0, 1);

    const brow = {};
    for (const s of ['r', 'l']) {
      const side = s === 'r' ? 'R' : 'L';
      brow[s] = { y: clamp(P[`brow${side}`] ?? P.brow ?? 0, -1, 1), tilt: clamp(P[`browTilt${side}`] ?? 0, -1, 1) };
    }
    const browArch = clamp((P.browArch ?? 0) - (P.noseSneer ?? 0) * 0.3, -1, 1);

    const items = [];
    const hp = this.hairPhys(ph, wind, P);
    // 볼살 출렁임: 물리 진자(Cheek·CheekY) 각도를 볼 높이의 가로·세로 밀림(px)으로. 눈 아래에서 턱으로 갈수록 크게
    const jig = { x: clamp(Math.sin(ph('Cheek') * DEG) * R.face.rx * 0.12, -4, 4) * t.cheekJiggle, y: clamp(Math.sin(ph('CheekY') * DEG) * R.face.ry * 0.1, -3, 3) * t.cheekJiggle };
    this.jig = jig;
    // 가까이 오면 커 보이기: 몸 숙이기(bodyLean +) 만큼 발 기준으로 전체를 키움 (이번 프레임에 올리는 모든 정점에 적용)
    const ls = 1 + lean * t.leanScale;
    // 늘이고 찌그리기(만화 원칙, 작게): 뛰면(bodyY+) 세로로 살짝 늘고 가로로 좁아지며, 무릎을 굽히면(bodyY−) 세로로 눌리고 가로로 퍼짐
    const sq = t.squash * bodyY;
    // 시트 '몸 위로 늘어남/아래로 압축 끝': 세로는 몸통·다리만 늘고 줄며(머리는 목을 따라 오르내림), 가로는 전체가 ∓5%
    const sclY = ls;
    const sclX = ls * (1 - 0.05 * sq);
    this.scaleAll = Math.abs(sclX - 1) > 0.0005 || Math.abs(sclY - 1) > 0.0005 ? { sx: sclX, sy: sclY, cx: B.hip[0], cy: Math.max(R.legs.r.foot[1], R.legs.l.foot[1]) + 70 } : null;
    for (const p of this.parts) {
      if (!p) continue;
      this.deformPart(p, { P, torsoXf, headXf, pt, armAng, elbowAng, wristAng, eyeState, gazeX, gazeY, brow, browArch, hp, ph, wind, hop, dip, stretchL, bx, bz, headAng, jaw, puff, smileF: Math.max(0, (fL + fR) / 2, (P.cheekSquint ?? 0) * 0.8), jig });
      this.upload(p.mesh, p.out);
      if (this.hidden.has(p.tag)) continue;
      if (p.kind === 'eyemask') {
        // 눈 열림 모양: 색 없이 스텐실만 (홍채·하이라이트·하트 눈을 이 안쪽만)
        items.push({ mesh: p.mesh, opacity: 1, writeMask: p.side === 'r' ? 1 : 2 });
        continue;
      }
      if (p.kind === 'iris' || p.kind === 'hl') {
        const blank = clamp(P.blankEyes ?? 0, 0, 1);
        const heart = clamp(P.heartEyes ?? 0, 0, 1);
        const op = p.kind === 'hl' ? 1 - Math.max(blank, heart) : 1 - blank * 0.9;
        items.push({ mesh: p.mesh, opacity: op, clipBy: p.side === 'r' ? 1 : 2 });
        if (p.kind === 'iris') {
          for (const [name, v] of [[`blank_${p.side}`, blank], [`heart_${p.side}`, heart]]) {
            const sp_ = this.fx[name];
            this.placeSprite(sp_, headXf, p.gaze);
            if (v > 0.01) items.push({ mesh: sp_.mesh, opacity: v, clipBy: p.side === 'r' ? 1 : 2 });
          }
        }
        continue;
      }
      if (p.kind === 'lid') {
        // 거의 다 감으면 그린 감은 눈 선으로 바꿔 낌
        const st = eyeState[p.side];
        // 띠 ↔ 감은 눈 그림은 거의 바로 바꿔 낌 (0.02 구간): 반투명으로 겹치는 구간이 길면 깜빡임 중간에 회색 얼룩으로 보임.
        // 띠는 k≤0.1 에서 이미 감은 선 자리에 얇게 가 있어 바꾸는 순간 모양이 거의 같다
        const cl = 1 - smooth(0.11, 0.13, st.k);
        items.push({ mesh: p.mesh, opacity: 1 - cl });
        if (cl > 0.001) {
          const spC = this.spr[`eye_closed_${p.side}`];
          const spS = this.spr[`eye_smile_${p.side}`];
          if (st.cross > 0.5) {
            // >< 눈
            const spX = this.crossSp[p.side];
            this.placeSprite(spX, headXf, null);
            items.push({ mesh: spX.mesh, opacity: cl });
          } else if (spC && spS) {
            // 사용자가 그린 감은 눈(‿)·웃는 감은 눈(^) — 웃음 정도로 섞음
            const sm = smooth(0.25, 0.75, st.smile);
            this.placeSprite(spC, headXf, null);
            this.placeSprite(spS, headXf, null);
            if (sm < 0.999) items.push({ mesh: spC.mesh, opacity: cl * (1 - sm) });
            if (sm > 0.001) items.push({ mesh: spS.mesh, opacity: cl * sm });
          } else {
            this.drawClosed(p.side, st.smile);
            this.placeSprite(this.closedSp[p.side], headXf, null);
            items.push({ mesh: this.closedSp[p.side].mesh, opacity: cl });
          }
        }
        const lowA = smooth(0.12, 0.5, st.squint) * (1 - cl);
        if (lowA > 0.01) {
          this.drawLowerLid(p.side, st);
          this.placeSprite(this.lowSp[p.side], headXf, null);
          items.push({ mesh: this.lowSp[p.side].mesh, opacity: lowA * 0.7 });
        }
      } else if (p.kind === 'brow' && this.spr[`brow_angry_${p.side}`]) {
        // 표정 눈썹(사용자 그림): 화남·슬픔·놀람(올림)일 때 원래 눈썹과 바꿔 낌. 눈썹 위아래 움직임은 같이
        const wA = clamp(P.ex_angry ?? 0, 0, 1);
        const wS = clamp(P.ex_sad ?? 0, 0, 1) * (1 - wA);
        const wU = Math.max(clamp(P.ex_surprised ?? 0, 0, 1), smooth(0.55, 0.95, brow[p.side].y)) * (1 - wA) * (1 - wS);
        const wB = clamp(1 - wA - wS - wU, 0, 1);
        if (wB > 0.001) items.push({ mesh: p.mesh, opacity: wB });
        const G = R.brows[p.side];
        const dy = -brow[p.side].y * G.h * 1.4 * (1 - wU * 0.5);
        for (const [nm, w] of [['angry', wA], ['sad', wS], ['up', wU]]) {
          const sp = this.spr[`brow_${nm}_${p.side}`];
          this.placeSprite(sp, headXf, [0, dy]);
          if (w > 0.001) items.push({ mesh: sp.mesh, opacity: w });
        }
      } else items.push({ mesh: p.mesh, opacity: 1 });
      if (p.space === 'arm' && this.handPose?.[p.side]?.mx > 0.001) {
        // 손 모양 스프라이트: 손목에 붙여 팔 방향(손가락 = 손목 → 손끝)으로 돌림
        const H = this.handAt[p.side];
        const S = this.handSz;
        const C = [H.x + H.ux * S * 0.36, H.y + H.uy * S * 0.36];
        const Rx = -H.uy;
        const Ry = H.ux;
        for (const [pose, wgt] of Object.entries(this.handPose[p.side].w)) {
          const us = this.spr[`hand_${p.side}_${pose}`];
          if (us) {
            // 사용자 시트에서 자른 손: 손목 축(ax, ay)을 팔 손목에, 소매→손끝 방향(vx, vy)을 팔 방향에 맞춰 돌림
            const ang = Math.atan2(H.uy, H.ux) - Math.atan2(us.vy, us.vx);
            const c = Math.cos(ang);
            const sn = Math.sin(ang);
            const ax = us.cx - us.w / 2 + us.ax;
            const ay = us.cy - us.h / 2 + us.ay;
            for (let i = 0; i < us.n; i++) {
              const lx = us.rest[2 * i] - ax;
              const ly = us.rest[2 * i + 1] - ay;
              us.out[2 * i] = H.x + lx * c - ly * sn;
              us.out[2 * i + 1] = H.y + lx * sn + ly * c;
            }
            this.upload(us.mesh, us.out);
            items.push({ mesh: us.mesh, opacity: wgt });
            continue;
          }
          const sp = this.handSp[p.side][pose] ?? this.handSp[p.side].open;
          const cx = sp.x + sp.w / 2;
          const cy = sp.y + sp.h / 2;
          for (let i = 0; i < sp.n; i++) {
            const lx = sp.rest[2 * i] - cx;
            const ly = sp.rest[2 * i + 1] - cy;
            sp.out[2 * i] = C[0] + lx * Rx - ly * H.ux;
            sp.out[2 * i + 1] = C[1] + lx * Ry - ly * H.uy;
          }
          this.upload(sp.mesh, sp.out);
          items.push({ mesh: sp.mesh, opacity: wgt });
        }
      }
      if (p.tag === 'face') {
        // 입은 얼굴 바로 위 (눈보다 아래)
        if (mouthPick) {
          const M = R.mouth;
          const wavy = clamp(P.mouthWavy ?? 0, 0, 1);
          const picks = wavy > 0.5 ? [{ name: 'wavy', a: 1, sy: 1, sp: this.wavySp }] : mouthPick.map((m) => ({ ...m, sp: this.spr[m.name] }));
          for (const { name, a, sy, sp } of picks) {
            const top = sp.cy - sp.h / 2;
            this._mouthBottom = top + sp.h * sy; // 혀가 나오는 자리 (아랫입술)
            // 벌린 정도에 따라 세로로 (윗입술은 제자리, 아래로 열림), 입꼬리 높이 차이만큼 살짝 기울임, 좌우 이동
            const rot = (fR - fL) * 0.04;
            const dx = mouthX * M.w * 0.22;
            const cs = Math.cos(rot);
            const sn = Math.sin(rot);
            // 입꼬리: 다문 입은 입꼬리 값만큼 양 끝을 올리거나(웃음 ⌣) 내려(처짐 ⌢) 휨 — 그림은 한 장이라 곡선을 메쉬로 만든다.
            // 벌린 입 그림도 조금 따라 휨. 화면 왼쪽 끝은 fR(캐릭터 오른쪽), 오른쪽 끝은 fL
            const bendK = M.h * 0.34 * (name === 'mouth_closed' || name === 'wavy' ? 1 : name === 'mouth_rest' ? 0.25 : 0.4);
            this.placeSprite(sp, headXf, null, (x, y, o) => {
              const ly0 = top + (y - top) * sy - sp.cy;
              const lx = x - sp.cx;
              const u = lx / sp.w;
              const ly = ly0 - (u < 0 ? fR : fL) * bendK * 4 * u * u;
              o[0] = sp.cx + lx * cs - ly * sn + dx;
              o[1] = sp.cy + lx * sn + ly * cs;
            }, true);
            items.push({ mesh: sp.mesh, opacity: a });
          }
        } else {
          this.placeSprite(this.mouth, headXf, null, null, true);
          items.push({ mesh: this.mouth.mesh, opacity: 1 });
          this._mouthBottom = R.mouth.cy + R.mouth.h * (0.05 + 0.6 * mOpen);
        }
        // 혀 내밀기 (P.tongue 0~1): 아랫입술 바로 밑에서 아래로 나옴 (세로 배율). 캔버스 스프라이트는 x·y(왼쪽 위)만 있음
        const tg = clamp(P.tongue ?? 0, 0, 1);
        if (tg > 0.02) {
          const sp = this.tongueSp;
          const M2 = R.mouth;
          const top = (this._mouthBottom ?? M2.cy) - M2.h * 0.14;
          const k = smooth(0, 1, tg);
          this.placeSprite(sp, headXf, null, (x, y, o) => {
            o[0] = x + mouthX * M2.w * 0.22 + (fR - fL) * M2.w * 0.05;
            o[1] = top + (y - sp.y) * (0.3 + 0.7 * k);
          }, true);
          items.push({ mesh: sp.mesh, opacity: smooth(0.02, 0.2, tg) });
        }
        const bl = clamp(P.blush ?? 0, 0, 1);
        if (this.spr.fx_blush_r) {
          for (const s of ['r', 'l']) {
            this.placeSprite(this.spr[`fx_blush_${s}`], headXf, null, null, true);
            if (bl > 0.01) items.push({ mesh: this.spr[`fx_blush_${s}`].mesh, opacity: bl * 0.85 });
          }
        } else {
          this.placeSprite(this.fx.blush, headXf, null, null, true);
          if (bl > 0.01) items.push({ mesh: this.fx.blush.mesh, opacity: bl });
        }
      }
      if (p.tag === 'lid_l') {
        const te = clamp(P.tear ?? 0, 0, 1);
        if (this.spr.fx_tear_r) {
          // 사용자가 그린 눈물방울: 고이면 나타나고, 흐르면 볼을 따라 내려감
          for (const s of ['r', 'l']) {
            const sp = this.spr[`fx_tear_${s}`];
            this.placeSprite(sp, headXf, [0, smooth(0.5, 1, te) * sp.h * 0.6]);
            if (te > 0.01) items.push({ mesh: sp.mesh, opacity: smooth(0.1, 0.5, te) });
          }
        } else {
          this.placeSprite(this.fx.tear, headXf, null);
          this.placeSprite(this.fx.tear2, headXf, null);
          if (te > 0.01) items.push({ mesh: this.fx.tear.mesh, opacity: smooth(0, 0.45, te) });
          if (te > 0.5) items.push({ mesh: this.fx.tear2.mesh, opacity: smooth(0.5, 0.95, te) });
        }
      }
      if (p.tag === 'brow_l') {
        for (const [name, key] of [['gloom', 'gloom'], ['sweat', 'sweat'], ['anger', 'anger'], ['question', 'question']]) {
          const v = clamp(P[key] ?? 0, 0, 1);
          const sp = this.spr[`fx_${name}`] ?? this.fx[name];
          this.placeSprite(sp, headXf, null);
          if (v > 0.01) items.push({ mesh: sp.mesh, opacity: v });
        }
      }
    }
    return items;
  }

  // 표정: rig.expressions[이름].params(그 값으로 끌어감)·add(더함) 를 ex_이름 무게만큼
  applyExpressions(P) {
    for (const [name, ex] of Object.entries(this.expressions)) {
      const w = clamp(P[`ex_${name}`] ?? 0, 0, 1);
      if (w < 0.001) continue;
      for (const [k, v] of Object.entries(ex.params ?? {})) P[k] = lerp(P[k] ?? 0, v, w);
      for (const [k, v] of Object.entries(ex.add ?? {})) P[k] = (P[k] ?? 0) + v * w;
    }
  }

  // 머리카락 다발별 휨 각도(라디안): 물리 출력 × 다발 배율 + 살랑임
  hairPhys(ph, wind, P = {}) {
    const t = this.t;
    const out = {};
    // 바보털 감정 표현 (귀여운 디테일): 놀라면·충격이면 쫑긋 서고, 슬프거나 졸리거나 울면 축 처짐 (도)
    const up = Math.max(clamp(P.ex_surprised ?? 0, 0, 1), clamp(P.ex_shock ?? 0, 0, 1), clamp(P.ex_angry ?? 0, 0, 1) * 0.6);
    const down = Math.max(clamp(P.ex_sad ?? 0, 0, 1), clamp(P.ex_sleepy ?? 0, 0, 1), clamp(P.ex_cry ?? 0, 0, 1), clamp(P.sleep ?? 0, 0, 1));
    const ahogeMood = (up * 14 - down * 16) * t.ahogeMood;
    for (const h of this.rig.hair.bends) {
      const k = (h.layer === 'ahoge' ? t.hairPhys : t.hairPhys) * (h.scale ?? 1);
      const ph1 = ph(h.param) * k;
      const ph2 = ph(`${h.param}_2`) * k;
      const w = wind * (h.wind ?? 1.2) * Math.sin(this.time * 0.7 + (h.phase ?? 0));
      const mx = h.max ?? 14;
      let mood = h.id === 'ahoge' ? ahogeMood : 0;
      const HF = this.hairForce;
      if (HF) {
        const grp = h.id === 'ahoge' ? 'ahoge' : h.id.startsWith('bang') ? 'bang' : h.id.startsWith('nape') ? 'nape' : h.id.startsWith('l_') ? 'sideR' : 'sideL';
        mood += HF[h.id] ?? HF[grp] ?? HF.all ?? 0;
      }
      out[h.id] = [clamp(ph1 + w, -mx, mx) * DEG + mood * DEG, clamp(ph2 + w * 0.6, -mx, mx) * DEG + mood * 0.6 * DEG];
    }
    return out;
  }

  // local: 제자리에서 먼저 옮기는 함수 (x, y, out) — 입 모양 세로 늘이기·기울이기
  placeSprite(sp, headXf, gaze, local = null, onFace = false) {
    const z = this.rig.skull.rz;
    const F = this.rig.face;
    const tmp = this._ptmp ?? (this._ptmp = new Float32Array(2));
    const jig = onFace && this.jig && (Math.abs(this.jig.x) > 0.05 || Math.abs(this.jig.y) > 0.05) ? this.jig : null;
    const jw = jig ? this.jigW : null;
    for (let i = 0; i < sp.n; i++) {
      let x = sp.rest[2 * i];
      let y = sp.rest[2 * i + 1];
      if (local) {
        local(x, y, tmp);
        x = tmp[0];
        y = tmp[1];
      }
      if (gaze) {
        x += gaze[0];
        y += gaze[1];
      }
      if (jig) {
        const w = jw(y);
        x += jig.x * w;
        y += jig.y * w;
      }
      const fu = (x - F.cx) / F.rx;
      const fv = (y - F.cy) / F.ry;
      const zz = z * Math.sqrt(clamp(1 - fu * fu - fv * fv * 0.7, 0.04, 1)) + z * 0.02;
      headXf(x, y, zz, 1, sp.out, 2 * i);
    }
    this.upload(sp.mesh, sp.out);
  }

  // 정점 올리기 (가까이 오면 커 보이기 배율을 여기서 한 번에)
  upload(mesh, out) {
    const S = this.scaleAll;
    if (S) {
      for (let i = 0; i < out.length; i += 2) {
        out[i] = S.cx + (out[i] - S.cx) * S.sx;
        out[i + 1] = S.cy + (out[i + 1] - S.cy) * S.sy;
      }
    }
    this.r.updatePositions(mesh, out);
  }

  deformPart(p, ctx) {
    const R = this.rig;
    const { torsoXf, headXf, pt } = ctx;
    const n = p.n;
    const src = p.rest;
    const out = p.out;
    const t = this.t;
    const loc = this._loc ?? (this._loc = new Float32Array(2));

    if (p.space === 'head') {
      // 1) 제자리(머리 회전 전)에서의 변형: 눈 깜빡임·눈동자·눈썹·머리카락 휨·장신구
      let localFn = null;
      if (p.kind === 'lid' || p.kind === 'white' || p.kind === 'eyemask' || p.kind === 'iris' || p.kind === 'hl' || p.kind === 'crease') localFn = this.eyeFn(p, ctx);
      else if (p.kind === 'brow') localFn = this.browFn(p, ctx);
      else if (p.kind === 'face') localFn = this.faceFn(ctx);
      const bends = p.bends;
      // 귀걸이: 귀 끝을 따라가며 아래로 늘어지고(고개 기울임의 반대로 돎) 물리로 흔들림
      let ear = null;
      if (p.kind === 'earring') {
        const E = R.attach.earring;
        const a = -ctx.headAng * 0.85 + ctx.ph('Earring') * DEG * t.accPhys;
        const a2 = ctx.ph('Earring_2') * DEG * t.accPhys;
        ear = { piv: E.pivot, c: Math.cos(a), s: Math.sin(a), c2: Math.cos(a2), s2: Math.sin(a2), mid: E.mid };
      }
      for (let i = 0; i < n; i++) {
        let x = src[2 * i];
        let y = src[2 * i + 1];
        if (localFn) {
          localFn(x, y, loc);
          x = loc[0];
          y = loc[1];
        }
        if (bends) {
          let ox = 0;
          let oy = 0;
          let wmax = 0;
          for (const b of bends) {
            const w1 = b.w1[i];
            if (w1 < 0.002) continue;
            if (w1 > wmax) wmax = w1;
            const ang = ctx.hp[b.h.id];
            const a = ang[0] * w1 + ang[1] * b.w2[i];
            const rx = x - b.h.root[0];
            const ry = y - b.h.root[1];
            const c = Math.cos(a);
            const s = Math.sin(a);
            ox += rx * c - ry * s - rx;
            oy += rx * s + ry * c - ry;
          }
          x += ox;
          y += oy + (this.hairDrop ?? 0) * wmax;
        }
        if (ear) {
          // 고리 아래(다이아)는 두 번째 마디로 한 번 더
          let rx = x - ear.piv[0];
          let ry = y - ear.piv[1];
          if (y > ear.mid[1]) {
            const mx = ear.mid[0] - ear.piv[0];
            const my = ear.mid[1] - ear.piv[1];
            const qx = rx - mx;
            const qy = ry - my;
            rx = mx + qx * ear.c2 - qy * ear.s2;
            ry = my + qx * ear.s2 + qy * ear.c2;
          }
          x = ear.piv[0] + rx * ear.c - ry * ear.s;
          y = ear.piv[1] + rx * ear.s + ry * ear.c + (this.hairDrop ?? 0) * 0.6 * smooth(ear.piv[1], ear.mid[1] + 20, y);
        }
        headXf(x, y, p.z[i], p.c[i], out, 2 * i, p.rw ? p.rw[i] : 1);
      }
      return;
    }

    if (p.space === 'arm') {
      const A = R.arms[p.side];
      const a = ctx.armAng[p.side];
      const e = ctx.elbowAng[p.side];
      const w = ctx.wristAng[p.side];
      const piv = A.pivot;
      const pv = pt(piv[0], piv[1], 0, 1);
      const ux = A.hand[0] - piv[0];
      const uy = A.hand[1] - piv[1];
      const L = Math.hypot(ux, uy);
      const ex0 = piv[0] + (ux / L) * A.elbow;
      const ey0 = piv[1] + (uy / L) * A.elbow;
      const wx0 = piv[0] + (ux / L) * A.wrist;
      const wy0 = piv[1] + (uy / L) * A.wrist;
      // 손 모양이 있으면 원래 둥근 손은 손목 쪽으로 오므려 숨기고(그 위에 손 스프라이트), 손목 자리·방향을 기억
      const shrink = (this.handPose?.[p.side]?.mx ?? 0) * 0.92;
      const chain = (x, y, wh, we) => {
        if (wh > 0 && w !== 0) {
          const aa = w * wh;
          const rx = x - wx0;
          const ry = y - wy0;
          x = wx0 + rx * Math.cos(aa) - ry * Math.sin(aa);
          y = wy0 + rx * Math.sin(aa) + ry * Math.cos(aa);
        }
        if (we > 0 && e !== 0) {
          const aa = e * we;
          const rx = x - ex0;
          const ry = y - ey0;
          x = ex0 + rx * Math.cos(aa) - ry * Math.sin(aa);
          y = ey0 + rx * Math.sin(aa) + ry * Math.cos(aa);
        }
        const rx = x - piv[0];
        const ry = y - piv[1];
        return [pv[0] + rx * Math.cos(a) - ry * Math.sin(a), pv[1] + rx * Math.sin(a) + ry * Math.cos(a)];
      };
      const W0 = chain(wx0, wy0, 1, 1);
      const T0 = chain(wx0 + (ux / L) * 20, wy0 + (uy / L) * 20, 1, 1);
      (this.handAt ??= {})[p.side] = { x: W0[0], y: W0[1], ux: (T0[0] - W0[0]) / 20, uy: (T0[1] - W0[1]) / 20 };
      for (let i = 0; i < n; i++) {
        let x = src[2 * i];
        let y = src[2 * i + 1];
        const wh = p.wh[i];
        if (shrink > 0 && wh > 0) {
          const k = 1 - shrink * wh;
          x = wx0 + (x - wx0) * k;
          y = wy0 + (y - wy0) * k;
        }
        // 손목 (손을 흔듦)
        if (wh > 0 && w !== 0) {
          const aa = w * wh;
          const rx = x - wx0;
          const ry = y - wy0;
          x = wx0 + rx * Math.cos(aa) - ry * Math.sin(aa);
          y = wy0 + rx * Math.sin(aa) + ry * Math.cos(aa);
        }
        // 팔꿈치
        const we = p.we[i];
        if (we > 0 && e !== 0) {
          const aa = e * we;
          const rx = x - ex0;
          const ry = y - ey0;
          x = ex0 + rx * Math.cos(aa) - ry * Math.sin(aa);
          y = ey0 + rx * Math.sin(aa) + ry * Math.cos(aa);
        }
        // 어깨 (뿌리 쪽은 덜 돌아 몸통과 부드럽게 이어짐)
        const aa = a * p.ws[i];
        const rx = x - piv[0];
        const ry = y - piv[1];
        const c = Math.cos(aa);
        const s = Math.sin(aa);
        const qx = rx * c - ry * s;
        const qy = rx * s + ry * c;
        // 뿌리(어깨 안쪽)는 몸통 변환, 바깥은 어깨점 + 회전
        const ws = p.ws[i];
        torsoXf(x, y, A.z, loc, 0, 1);
        const fx = pv[0] + qx;
        const fy = pv[1] + qy;
        const k = smooth(0, 0.5, ws);
        out[2 * i] = lerp(loc[0], fx, k);
        out[2 * i + 1] = lerp(loc[1], fy, k);
      }
      return;
    }

    if (p.space === 'leg') {
      // 다리: 발목을 축으로 곧게 기울어 엉덩이를 옮김(좌우 흔들림), 무릎 굽힘은 세로로 눌림. 발은 바닥에 붙음
      const G = R.legs[p.side];
      const L = G.foot[1] - G.hip[1];
      const phi = Math.atan2(ctx.bx, L);
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const k = (1 - ctx.dip / L) * ctx.stretchL;
      // 허벅지 끈: 버클 아래에 매달려 흔들림 (다리 변환 전에)
      let sw = null;
      if (p.kind === 'strap') {
        const At = R.attach.strap;
        sw = { piv: At.pivot, len: At.len, a: ctx.ph('Strap') * DEG * t.accPhys, a2: ctx.ph('Strap_2') * DEG * t.accPhys };
      }
      for (let i = 0; i < n; i++) {
        let sx = src[2 * i];
        let sy0 = src[2 * i + 1];
        if (sw) {
          const qx = sx - sw.piv[0];
          const qy = sy0 - sw.piv[1];
          const u = clamp(qy / sw.len, 0, 1.3);
          const aa = sw.a * smooth(0, 0.6, u) + sw.a2 * smooth(0.4, 1.2, u);
          sx = sw.piv[0] + qx * Math.cos(aa) - qy * Math.sin(aa);
          sy0 = sw.piv[1] + qx * Math.sin(aa) + qy * Math.cos(aa) + (this.bodyDrop ?? 0) * smooth(0, 1, u);
        }
        const rx = sx - G.foot[0];
        const ry = (sy0 - G.foot[1]) * (ry0(sy0, G) ? k : 1);
        out[2 * i] = G.foot[0] + rx * c - ry * s;
        out[2 * i + 1] = G.foot[1] + rx * s + ry * c - ctx.hop;
      }
      return;
    }

    if (p.space === 'foot') {
      for (let i = 0; i < n; i++) {
        out[2 * i] = src[2 * i];
        out[2 * i + 1] = src[2 * i + 1] - ctx.hop;
      }
      return;
    }

    // 몸통(재킷·조끼·목·목걸이·브로치·체인)
    let swing = null;
    if (p.kind === 'chain' || p.kind === 'necklace' || p.kind === 'brooch' || p.kind === 'psq') {
      const Aat = R.attach[p.kind];
      const id = { chain: 'Chain', necklace: 'Necklace', brooch: 'Brooch', psq: 'Psq' }[p.kind];
      const a = ctx.ph(id) * DEG * t.accPhys - ctx.bz * (p.kind === 'chain' ? 0.5 : 0.8);
      const a2 = ctx.ph(`${id}_2`) * DEG * t.accPhys;
      swing = { piv: Aat.pivot, len: Aat.len, a, a2 };
    }
    let hem = null;
    if (p.kind === 'jacket') {
      hem = { x: ctx.ph(p.side === 'l' ? 'HemL' : 'HemR') * 1.2 * t.accPhys, top: R.body.hemTop, bot: R.body.hemBot };
    }
    for (let i = 0; i < n; i++) {
      let x = src[2 * i];
      let y = src[2 * i + 1];
      if (swing) {
        const rx = x - swing.piv[0];
        const ry = y - swing.piv[1];
        const u = clamp(ry / swing.len, 0, 1.5);
        const aa = swing.a * smooth(0, 0.6, u) + swing.a2 * smooth(0.4, 1.2, u);
        x = swing.piv[0] + rx * Math.cos(aa) - ry * Math.sin(aa);
        y = swing.piv[1] + rx * Math.sin(aa) + ry * Math.cos(aa) + (this.bodyDrop ?? 0) * smooth(0, 1, u);
      }
      if (hem) {
        const u = smooth(hem.top, hem.bot, y);
        x += hem.x * u;
      }
      const shw = p.kind === 'jacket' ? smooth(R.body.neck[1] + 70, R.body.neck[1] - 10, y) : p.kind === 'inner' || p.kind === 'necklace' || p.kind === 'neck' ? 0.2 * smooth(R.body.neck[1] + 70, R.body.neck[1] - 10, y) : 0;
      torsoXf(x, y, p.z0 ?? 0, out, 2 * i, shw);
    }
  }

  // 감은 눈 선 높이: 위 눈꺼풀 선 모양을 반쯤 펴서 눈 높이의 66% 자리에. 웃음은 ∩ 로 굽힘
  closedY(E, smile, x) {
    const xc = (E.ox0 + E.ox1) / 2;
    const hw = (E.ox1 - E.ox0) / 2;
    const U = sample(E.up, x);
    const u = clamp((x - xc) / hw, -1, 1);
    return E.closeY + (U - E.upMid) * 0.45 - smile * E.openH * 0.32 * (1 - u * u) + smile * E.openH * 0.05;
  }

  // 감은 눈 그림: 가운데가 두껍고 끝이 가는 검은 곡선 + 바깥 눈꼬리 속눈썹 (머리카락에 끊긴 눈꺼풀 띠 대신 깔끔하게)
  drawClosed(side, smile) {
    const sp = this.closedSp[side];
    const key = `${Math.round(smile * 30)}`;
    if (sp.key === key) return;
    sp.key = key;
    const E = this.rig.eyes[side];
    const g = sp.ctx;
    const px = sp.px;
    g.clearRect(0, 0, sp.canvas.width, sp.canvas.height);
    const xa = E.x0 + 6;
    const xb = E.x1 - 4;
    const n = 40;
    const thick = E.openH * 0.3;
    const outer = side === 'r' ? 0 : 1; // 바깥 눈꼬리 쪽 (r: 왼쪽 끝, l: 오른쪽 끝)
    const top = [];
    const bot = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = xa + (xb - xa) * u;
      const y = this.closedY(E, smile, x);
      const uo = outer === 0 ? 1 - u : u; // 바깥 쪽으로 갈수록 1
      const w = thick * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.5) * (1 + 0.35 * uo);
      top.push([(x - sp.x) * px, (y - w * 0.55 - sp.y) * px]);
      bot.push([(x - sp.x) * px, (y + w * 0.45 - sp.y) * px]);
    }
    g.fillStyle = '#080608';
    g.beginPath();
    g.moveTo(top[0][0], top[0][1]);
    for (const q of top) g.lineTo(q[0], q[1]);
    for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
    g.closePath();
    g.fill();
    // 바깥 눈꼬리 속눈썹 두 가닥
    const ex = outer === 0 ? xa : xb;
    const ey = this.closedY(E, smile, ex);
    const dir = outer === 0 ? -1 : 1;
    g.lineCap = 'round';
    g.strokeStyle = '#080608';
    for (const [len, ang, wd] of [[E.openH * 0.42, -0.35, thick * 0.5], [E.openH * 0.3, 0.15, thick * 0.38]]) {
      g.lineWidth = wd * px;
      g.beginPath();
      const x0 = (ex - sp.x) * px;
      const y0 = (ey - sp.y) * px;
      g.moveTo(x0 - dir * 6 * px, y0);
      g.quadraticCurveTo(x0 + dir * len * 0.5 * px, y0 + ang * len * 0.3 * px, x0 + dir * len * px, y0 + ang * len * px);
      g.stroke();
    }
    this.r.updateTexture(sp.tex, sp.canvas);
  }

  // 눈 부위(띠·흰자·홍채·하이라이트·쌍꺼풀 선)의 제자리 변형 함수
  eyeFn(p, ctx) {
    const st = ctx.eyeState[p.side];
    const E = st.E;
    const k = st.k;
    const kl = Math.min(1, k);
    const { kb, ko } = this.eyeK(k);
    const xc = (E.ox0 + E.ox1) / 2;
    const hw = (E.ox1 - E.ox0) / 2;
    // 거의 감으면 띠가 얇아져(아래 끝 기준) 감은 눈 선 두께에 가까워짐 → 그림으로 바뀔 때 두꺼운 띠가 반투명하게 겹쳐 보이지 않음
    const thin = lerp(0.4, 1, smooth(0.08, 0.4, k));
    // 감은 눈 선: 위 눈꺼풀 선 모양을 반쯤 펴서 눈 높이의 66% 자리에. 웃음은 ∩ 로 굽힘
    const closed = (x) => this.closedY(E, st.smile, x);
    const tiltAt = this.lidTiltFn(E, st, p.side);
    const lidTarget = (x) => {
      const U = sample(E.up, x);
      const C = closed(x);
      return C + (U - C) * kb + tiltAt(x);
    };
    const lowTarget = (x) => {
      const Lw = sample(E.low, x);
      const U = sample(E.up, x);
      const Uk = lidTarget(x);
      let L = Uk + (Lw - Uk) * ko;
      L -= st.squint * (Lw - U) * 0.22 * ko;
      return Math.max(L, Uk + 0.5 * ko);
    };
    if (p.kind === 'lid') {
      return (x, y, o) => {
        const xx = clamp(x, E.x0, E.x1);
        const U = sample(E.up, xx);
        o[0] = x;
        o[1] = lidTarget(xx) + (y - U) * thin;
      };
    }
    if (p.kind === 'crease') {
      const d = (lidTarget(xc) - sample(E.up, xc)) * 0.35 + (-ctx.brow[p.side].y * 4);
      return (x, y, o) => {
        o[0] = x;
        o[1] = y + d;
      };
    }
    if (p.kind === 'white' || p.kind === 'eyemask') {
      return (x, y, o) => {
        const xx = clamp(x, E.x0, E.x1);
        const U = sample(E.up, xx);
        const Lw = sample(E.low, xx);
        const Uk = lidTarget(xx);
        const Lk = lowTarget(xx);
        o[0] = x;
        // 띠 밑 부분은 감을수록 띠 아래 끝으로 접힘 (다 감으면 흰자 면적 0 → 홍채·하이라이트도 안 보임)
        if (y <= U) o[1] = Uk + (y - U) * ko;
        else if (y <= Lw) o[1] = Uk + ((y - U) / Math.max(1, Lw - U)) * (Lk - Uk);
        else o[1] = Lk + (y - Lw) * ko; // 아래 끝 바깥 몇 px 도 같이 접힘 (감은 눈에 흐린 윤곽이 남지 않게)
      };
    }
    // 홍채·하이라이트: 눈동자 방향으로 옮김 (흰자 모양에 잘려 보임)
    const gx = ctx.gazeX * E.w * this.t.gazeX * (p.kind === 'hl' ? 0.85 : 1);
    const gy = -ctx.gazeY * E.w * this.t.gazeY * (p.kind === 'hl' ? 0.85 : 1) + (1 - kl) * E.openH * 0.12;
    p.gaze = [gx, gy];
    // 홍채 크기: pupil −1(놀람, 작게) ~ +1(크게). 홍채 가운데 기준으로 키움 (하이라이트는 따라 옮기기만)
    // 눈을 쉬는 자리보다 크게 뜨면(k > 1) 홍채도 커지고 들린 띠 쪽으로 반쯤 따라 올라감 (시트 '눈 크게 뜸': 동그란 홍채가 다 보임)
    const wid = Math.max(0, (st.kw ?? k) - 1);
    const ps = (1 + st.pupil * this.t.pupilScale) * (1 + wid * 0.7);
    const rise = (this.eyeK(Math.max(1, st.kw ?? k)).kb - 1) * (E.closeY - E.upMid) * 0.6; // 크게 떠서 띠가 올라간 만큼의 60%
    const gyw = gy - Math.max(0, rise);
    if (p.kind === 'iris' && (Math.abs(ps - 1) > 0.002 || rise > 0.01)) {
      const I = E.iris;
      return (x, y, o) => {
        o[0] = I.cx + (x - I.cx) * ps + gx;
        o[1] = I.cy + (y - I.cy) * ps + gyw;
      };
    }
    if (rise > 0.01) {
      return (x, y, o) => {
        o[0] = x + gx;
        o[1] = y + gyw;
      };
    }
    return (x, y, o) => {
      o[0] = x + gx;
      o[1] = y + gy;
    };
  }

  // 얼굴 피부: 입을 벌리면 턱이 살짝 내려가고(아래 얼굴이 늘어남), 볼을 부풀리면 양 볼 윤곽이 바깥으로
  // 웃으면(입꼬리 +) 양 볼이 살짝 올라오며 바깥으로 통통해짐 (귀엽고 통통하게)
  faceFn(ctx) {
    const R = this.rig;
    const M = R.mouth;
    const F = R.face;
    const drop = ctx.jaw * M.h * 0.2;
    const puff = ctx.puff * F.rx * 0.13 + (ctx.smileF ?? 0) * F.rx * 0.022;
    const lift = (ctx.smileF ?? 0) * F.ry * 0.02;
    const jx = ctx.jig?.x ?? 0;
    const jy = ctx.jig?.y ?? 0;
    if (drop < 0.05 && puff < 0.05 && Math.abs(jx) < 0.05 && Math.abs(jy) < 0.05) return null;
    const y0 = M.cy - M.h * 0.2;
    const y1 = M.cy + M.h * 1.6;
    const cy = R.blush.cy;
    const jw = this.jigW;
    return (x, y, o) => {
      const u = (x - M.cx) / (F.rx * 0.95);
      const wC = smooth(y0, y1, y) * Math.max(0, 1 - u * u);
      const dxc = x - F.cx;
      const wP = Math.exp(-(((y - cy) / (F.ry * 0.38)) ** 2)) * smooth(F.rx * 0.25, F.rx * 0.9, Math.abs(dxc));
      const wj = jw(y);
      o[0] = x + Math.sign(dxc) * puff * wP + jx * wj;
      o[1] = y + drop * wC - lift * wP + jy * wj;
    };
  }

  // 볼살 출렁임 무게: 눈 아래 끝에서 0 → 턱에서 1 (얼굴 레이어·입·홍조가 같이 밀림)
  get jigW() {
    if (!this._jigW) {
      const E = this.rig.eyes;
      const F = this.rig.face;
      const a = Math.max(E.r.lowMax, E.l.lowMax) + 4;
      const b = F.cy + F.ry * 0.62;
      this._jigW = (y) => smooth(a, b, y);
    }
    return this._jigW;
  }

  browFn(p, ctx) {
    const b = ctx.brow[p.side];
    const G = this.rig.brows[p.side];
    const inner = p.side === 'r' ? 1 : -1; // 안쪽 끝 방향 (화면 x)
    const st = ctx.eyeState[p.side];
    const blinkDrop = (1 - Math.min(1, st.k)) * G.h * 0.25;
    return (x, y, o) => {
      const u = (x - G.cx) / G.hw; // −1~1
      const toInner = u * inner; // 안쪽 +1
      o[0] = x;
      o[1] = y - b.y * G.h * 1.4 - b.tilt * G.h * 1.1 * toInner - ctx.browArch * G.h * 0.5 * (1 - u * u) + blinkDrop;
    };
  }
}
