// 가닥 물리: 머리카락 한 가닥(또는 리본·사슬·귀걸이)을 뿌리에 매달린 여러 마디 진자 사슬로 흔든다 (Live2D 물리와 같은 방식).
// - 마디마다 각도·각속도를 가진 '각 스프링': 쉬는 모양(부모 마디 각 + 원래 굽은 각)으로 돌아가려 하고(stiffness = 고유 진동수),
//   감쇠(damping = 감쇠비)로 출렁임이 잦아든다.
// - 관성: 마디가 매달린 점이 가속하면 반대로 기운다 (고개를 확 돌리면 머리카락이 늦게 따라오며 휘청).
// - 끝으로 갈수록 진동수·감쇠를 낮춰 늦게·오래 찰랑인다 (tipLag). 고개를 기울이면 끝은 덜 따라가 아래로 늘어진다 (hang).
// - 그림(메시) 정점은 가까운 마디에 붙여(skinning) 마디가 돌면 같이 돈다 → 가닥이 휘어지며 흔들림.
//
// 좌표는 모델(그림) px, y 는 아래가 +. 시간은 초. 1/240 초로 잘게 나눠 적분해 프레임 수와 상관없이 같은 움직임.

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEP = 1 / 240;

// Average of a smooth gravity transition along the hanging length. Blending endpoint
// positions with smoothstep adds a derivative term that can squeeze or reverse the strand.
export function hangingWeight(distance, band) {
  if (distance <= 0) return 0;
  if (band <= 0 || distance >= band) return 1 - Math.max(0, band) / (2 * distance);
  const u = distance / band;
  return u * u - 0.5 * u * u * u;
}

export const STRAND_DEFAULTS = {
  freq: 1.6, // 뿌리 쪽 마디의 고유 진동수 (Hz). 높을수록 빳빳하고 빨리 돌아옴
  damping: 0.22, // 감쇠비 (0 이면 영원히 흔들림, 1 이면 출렁임 없이 돌아옴). 작을수록 찰랑
  inertia: 1, // 매달린 점의 가속에 반응하는 정도
  tipLag: 0.5, // 끝으로 갈수록 진동수·감쇠를 낮추는 정도 (끝이 더 늦게·오래 흔들림)
  hang: 0.35, // 고개를 기울일 때 끝이 머리 회전을 덜 따라가는 정도 (아래로 늘어짐)
  wind: 0, // 바람 세기 (rad/s²)
  phase: 0, // 바람 박자 (가닥마다 다르게)
  maxBend: 0.45, // 마디마다 쉬는 모양에서 벗어날 수 있는 최대 각 (rad)
  maxSwing: null, // Optional limit on the entire chain relative to its reference (rad).
  accelTau: 0, // Optional smoothing time for inertial acceleration (s).
  maxAccel: null, // Optional translational acceleration limit (px/s2).
  maxAngularAccel: null, // Optional angular acceleration limit (rad/s2).
  stretch: 0, // 위아래 반동 세기 (0 이면 끔): 길이 방향 스프링 — 끝으로 갈수록 크게 늘었다 줄어듦
};

export class Strand {
  // spine: 뿌리→끝 점들 [[x, y], …] (그림 기준 쉬는 모양)
  constructor(spine, o = {}) {
    this.o = { ...STRAND_DEFAULTS, ...o };
    const n = spine.length;
    this.n = n;
    this.rest = spine.map(([x, y]) => [x, y]);
    this.len = [];
    this.restAng = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = spine[i + 1][0] - spine[i][0];
      const dy = spine[i + 1][1] - spine[i][1];
      this.len.push(Math.max(1e-3, Math.hypot(dx, dy)));
      this.restAng.push(Math.atan2(dy, dx));
    }
    this.reset();
  }

  reset() {
    this.d = new Float64Array(this.n - 1); // 마디마다 쉬는 모양에서 벗어난 각 (rad)
    this.w = new Float64Array(this.n - 1); // 그 각속도
    this.ang = this.restAng.slice();
    this.p = this.rest.map(([x, y]) => [x, y]);
    this.st = 0; // 길이 늘어난 정도
    this.sv = 0;
    this.filteredAccel = [0, 0, 0];
    this.rv = null; // 뿌리 위치·속도 (가속 계산용)
    this.root = null;
    this.ref0 = null; // 지난 프레임 기준 모양 (마디 방향·길이)
    this.acc = 0;
    this.time = 0;
  }

  // root: 뿌리 변환 { x, y, rot } — 쉬는 모양의 뿌리점(rest[0])이 화면(변형 후) 어디에 있고 얼마나 돌았는지
  // ref(선택): 이번 프레임의 '기준 모양' { ang, len } — 마디마다 화면에서의 방향·길이 (머리 변환 + 중력으로 늘어짐을 반영).
  //   있으면 가닥은 이 모양을 쉬는 자리로 삼아 흔들림 (머리를 기울여도 머리에서 떨어진 아래쪽은 아래로 늘어짐)
  step(root, dt, ref = null) {
    const o = this.o;
    const last = this.n - 1;
    if (!this.root) this.root = { x: root.x, y: root.y, rot: root.rot };
    const r0 = this.root;
    if (ref && !this.ref0) this.ref0 = { ang: Float64Array.from(ref.ang), len: Float64Array.from(ref.len) };
    if (ref && !this.refI) this.refI = { ang: new Float64Array(last), len: new Float64Array(last) };
    const elapsed = clamp(dt, 0, 0.1);
    const carry = this.acc;
    this.acc += elapsed;
    const steps = Math.floor(this.acc / STEP);
    this.acc -= steps * STEP;
    for (let k = 1; k <= steps; k++) {
      // 뿌리(와 기준 모양)를 이번 프레임 이동만큼 나눠 옮김
      const u = elapsed > 0 ? clamp((k * STEP - carry) / elapsed, 0, 1) : 1;
      const rx = r0.x + (root.x - r0.x) * u;
      const ry = r0.y + (root.y - r0.y) * u;
      const rr = r0.rot + wrap(root.rot - r0.rot) * u;
      let R = null;
      if (ref) {
        R = this.refI;
        for (let i = 0; i < last; i++) {
          R.ang[i] = this.ref0.ang[i] + wrap(ref.ang[i] - this.ref0.ang[i]) * u;
          R.len[i] = this.ref0.len[i] + (ref.len[i] - this.ref0.len[i]) * u;
        }
      }
      this.integrate(rx, ry, rr, STEP, R);
    }
    this.root = { x: root.x, y: root.y, rot: root.rot };
    this.rootRot = root.rot; // 쉬는 모양 기준 위치 계산용 (StrandSet)
    if (ref) {
      this.ref0.ang.set(ref.ang);
      this.ref0.len.set(ref.len);
    }
    // Pose at the latest root; update derivative history only at fixed simulation steps.
    this.integrate(root.x, root.y, root.rot, 0, ref);
  }

  integrate(rx, ry, rot, h, ref = null) {
    const o = this.o;
    const last = this.n - 1;
    this.time += h;
    // 뿌리의 가속·회전 가속 (관성 힘의 원천). 마디마다 따로 구하면 채찍처럼 증폭되므로 뿌리 것만 쓴다
    let ax = 0;
    let ay = 0;
    let aRot = 0;
    if (h > 0 && this.rv) {
      const vx = (rx - this.rv.x) / h;
      const vy = (ry - this.rv.y) / h;
      const vr = wrap(rot - this.rv.rot) / h;
      ax = (vx - this.rv.vx) / h;
      ay = (vy - this.rv.vy) / h;
      aRot = (vr - this.rv.vr) / h;
      this.rv = { x: rx, y: ry, rot, vx, vy, vr };
    } else if (h > 0) {
      this.rv = { x: rx, y: ry, rot, vx: 0, vy: 0, vr: 0 };
    }
    if (h > 0 && o.accelTau > 0) {
      const k = 1 - Math.exp(-h / o.accelTau);
      const a = this.filteredAccel;
      a[0] += (ax - a[0]) * k;
      a[1] += (ay - a[1]) * k;
      a[2] += (aRot - a[2]) * k;
      [ax, ay, aRot] = a;
    }
    if (o.maxAccel > 0) {
      const m = Math.hypot(ax, ay);
      const k = m > 0 ? o.maxAccel * Math.tanh(m / o.maxAccel) / m : 1;
      ax *= k;
      ay *= k;
    }
    if (o.maxAngularAccel > 0) aRot = o.maxAngularAccel * Math.tanh(aRot / o.maxAngularAccel);
    const total = this.len.reduce((p, q) => p + q, 0);
    if (o.stretch && h > 0) {
      // 길이 방향 스프링 (진동수는 휨의 1.6배, 감쇠 0.35): 뿌리가 위로 가속하면 늘어나고(끝이 처짐) 아래로 가속하면 줄어듦
      const W2 = 2 * Math.PI * o.freq * 1.6;
      const along = Math.sin(this.restAng[0]); // 아래로 늘어진 가닥일수록 세로 가속에 반응
      const a = -W2 * W2 * this.st - 2 * 0.35 * W2 * this.sv + (ay / total) * o.stretch * along * 0.5;
      this.sv += a * h;
      this.st = clamp(this.st + this.sv * h, -0.05, 0.07);
    }
    const windA = o.wind * (Math.sin(this.time * 1.9 + o.phase) * 0.6 + Math.sin(this.time * 3.1 + o.phase * 1.7) * 0.4);
    let parent = rot;
    let px = rx;
    let py = ry;
    for (let i = 0; i < last; i++) {
      const u = last > 1 ? i / (last - 1) : 0;
      let target;
      if (ref) {
        // 기준 모양을 따라: 첫 마디는 기준 방향 그대로, 다음 마디부터는 부모가 벗어난 만큼 같이 (진자처럼 이어서 휨)
        target = i === 0 ? ref.ang[0] : parent + wrap(ref.ang[i] - ref.ang[i - 1]);
      } else {
        const restRel = i === 0 ? this.restAng[0] : this.restAng[i] - this.restAng[i - 1];
        // 고개를 기울이면(rot) 끝으로 갈수록 덜 따라가 아래로 늘어짐
        target = (i === 0 ? rot : parent) + restRel - (i === 0 ? 0 : (rot * o.hang) / Math.max(1, last - 1));
      }
      this.p[i] = [px, py];
      if (h > 0) {
        const ang = target + this.d[i];
        const f = o.freq * (1 - o.tipLag * 0.5 * u);
        const zeta = o.damping * (1 - o.tipLag * 0.4 * u);
        const W = 2 * Math.PI * f;
        // 관성: 뿌리가 가속하면 가닥이 반대쪽으로 기움 (끝으로 갈수록 더), 머리가 돌면 늦게 따라 돎
        const perpX = -Math.sin(ang);
        const perpY = Math.cos(ang);
        const aIn = (-(ax * perpX + ay * perpY) / total) * o.inertia * (0.5 + 0.8 * u) - aRot * o.inertia * 0.35 * u;
        const aSpring = -W * W * this.d[i] - 2 * zeta * W * this.w[i];
        this.w[i] += (aSpring + aIn + windA * (0.3 + 0.7 * u)) * h;
        this.d[i] += this.w[i] * h;
        if (Math.abs(this.d[i]) > o.maxBend) {
          this.d[i] = clamp(this.d[i], -o.maxBend, o.maxBend);
          this.w[i] *= 0.3;
        }
      }
      // Joint limits alone can accumulate into a whip-like bend along the whole chain.
      // Project into the total swing limit and remove only outward velocity.
      if (o.maxSwing > 0) {
        const baseline = ref ? ref.ang[i] : this.restAng[i] + rot - rot * o.hang * i / Math.max(1, last - 1);
        const parentBend = wrap(target - baseline);
        const bend = parentBend + this.d[i];
        const bounded = clamp(bend, -o.maxSwing, o.maxSwing);
        if (bounded !== bend) {
          this.d[i] = bounded - parentBend;
          if (this.w[i] * (bend - bounded) > 0) this.w[i] = 0;
        }
      }
      const a2 = target + this.d[i];
      this.ang[i] = a2;
      const L = (ref ? ref.len[i] : this.len[i]) * (1 + this.st * (0.3 + 0.7 * u));
      px += Math.cos(a2) * L;
      py += Math.sin(a2) * L;
      parent = a2;
    }
    this.p[last] = [px, py];
  }
}

// 정점을 가닥 마디에 붙이기: 정점마다 (마디 번호, 마디 위 위치 t, 마디 기준 좌표, 섞는 정도 w)
// verts: [x0, y0, x1, y1, …] (그림 기준). weight(선택): 정점마다 0~1 (뿌리 쪽은 머리에 붙어 있게 0 에 가깝게 등)
export function bindStrand(strand, verts, weight = null) {
  const n = verts.length / 2;
  const R = strand.rest;
  const segs = strand.n - 1;
  const bind = new Float32Array(n * 5);
  for (let v = 0; v < n; v++) {
    const x = verts[2 * v];
    const y = verts[2 * v + 1];
    let best = 0;
    let bestD = Infinity;
    let bestT = 0;
    for (let i = 0; i < segs; i++) {
      const ax = R[i][0];
      const ay = R[i][1];
      const dx = R[i + 1][0] - ax;
      const dy = R[i + 1][1] - ay;
      const L2 = dx * dx + dy * dy || 1;
      const t = ((x - ax) * dx + (y - ay) * dy) / L2;
      const tc = clamp(t, 0, 1);
      const d = Math.hypot(x - (ax + dx * tc), y - (ay + dy * tc));
      if (d < bestD - 1e-6) {
        bestD = d;
        best = i;
        bestT = t;
      }
    }
    const a = strand.restAng[best];
    const dx = x - R[best][0];
    const dy = y - R[best][1];
    bind[5 * v] = best;
    bind[5 * v + 1] = bestT;
    bind[5 * v + 2] = dx * Math.cos(-a) - dy * Math.sin(-a);
    bind[5 * v + 3] = dx * Math.sin(-a) + dy * Math.cos(-a);
    bind[5 * v + 4] = weight ? weight[v] : 1;
  }
  return bind;
}

// 마디가 움직인 대로 정점을 옮긴다. base: 가닥 물리 없이 머리 변환만 적용한 위치 — w 만큼 섞음. 결과는 out
// 마디 경계에서 꺾여 보이지 않게, 마디 양 끝 30% 는 이웃 마디의 회전·위치와 섞는다
export function deformStrand(strand, bind, base, out) {
  const n = out.length / 2;
  const segs = strand.n - 1;
  const at = (i, lx, ly) => {
    const p = strand.p[i];
    const a = strand.ang[i];
    return [p[0] + lx * Math.cos(a) - ly * Math.sin(a), p[1] + lx * Math.sin(a) + ly * Math.cos(a)];
  };
  for (let v = 0; v < n; v++) {
    const i = bind[5 * v];
    const t = bind[5 * v + 1];
    const lx = bind[5 * v + 2];
    const ly = bind[5 * v + 3];
    const w = bind[5 * v + 4];
    if (w <= 0) {
      out[2 * v] = base[2 * v];
      out[2 * v + 1] = base[2 * v + 1];
      continue;
    }
    let [x, y] = at(i, lx, ly);
    // 이웃 마디 기준으로도 같은 점을 옮겨 보고 섞음 (선형 블렌드 스키닝)
    if (t > 0.7 && i + 1 < segs) {
      const k = (t - 0.7) / 0.3 * 0.5;
      const L = strand.len[i];
      const [x2, y2] = at(i + 1, lx - L, ly);
      x += (x2 - x) * k;
      y += (y2 - y) * k;
    } else if (t < 0.3 && i > 0) {
      const k = (0.3 - t) / 0.3 * 0.5;
      const L = strand.len[i - 1];
      const [x2, y2] = at(i - 1, lx + L, ly);
      x += (x2 - x) * k;
      y += (y2 - y) * k;
    }
    out[2 * v] = base[2 * v] + (x - base[2 * v]) * w;
    out[2 * v + 1] = base[2 * v + 1] + (y - base[2 * v + 1]) * w;
  }
}

// 가닥 뼈대 자동 추정: 알파 마스크의 중심선을 뿌리→끝으로 따라가며 n 점
// mask: { data(RGBA), width, height }, ox/oy: 그림 안 위치. axis: 'y' (세로로 늘어진 가닥) | 'x'
// rootAt: 'start'(위·왼쪽이 뿌리) | 'end'
export function spineFromMask(mask, ox, oy, n = 6, axis = 'y', rootAt = 'start') {
  const { data, width, height } = mask;
  const lines = [];
  const A = axis === 'y' ? height : width;
  const B = axis === 'y' ? width : height;
  for (let a = 0; a < A; a++) {
    let sum = 0;
    let c = 0;
    for (let b = 0; b < B; b++) {
      const x = axis === 'y' ? b : a;
      const y = axis === 'y' ? a : b;
      if (data[(y * width + x) * 4 + 3] > 64) {
        sum += b;
        c++;
      }
    }
    if (c > 0) lines.push(axis === 'y' ? [sum / c, a] : [a, sum / c]);
  }
  if (lines.length < 2) return [[ox, oy], [ox, oy + 1]];
  if (rootAt === 'end') lines.reverse();
  const cum = [0];
  for (let i = 1; i < lines.length; i++) cum.push(cum[i - 1] + Math.hypot(lines[i][0] - lines[i - 1][0], lines[i][1] - lines[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const pts = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const u = clamp((target - cum[j]) / seg, 0, 1);
    pts.push([ox + lines[j][0] + (lines[j + 1][0] - lines[j][0]) * u, oy + lines[j][1] + (lines[j + 1][1] - lines[j][1]) * u]);
  }
  return pts;
}

// ---- 여러 사슬로 한 장을 휘기 (머리 레이어 하나에 사슬 여러 개) ----
// 레이어를 다발로 잘라 따로 흔들면 다발 사이가 갈라져 보인다. 대신 정점마다 가까운 사슬 몇 개의 움직임(이동량)을
// 거리에 따라 섞는다 → 한 장이 부드럽게 물결치며 휘고, 사슬마다 박자가 달라 찰랑인다.
// set: { radius, chains: [{ spine, freq, damping, phase, hang, wind, rootFix }] }
export class StrandSet {
  constructor(set, tuning = {}) {
    this.radius = set.radius ?? 100;
    this.fieldConfig = set.field ?? null;
    // smooth(파츠 모델): 사슬마다 '휘어 돌리기' 대신 사슬 위 점이 움직인 만큼만 옮기고(지렛대처럼 멀리 있는 정점이 크게 휘둘리지 않게),
    //   가까운 사슬 여러 개를 거리에 따라 끊김 없이 섞음(이웃 정점이 다른 사슬로 갈아타며 찢어지지 않게)
    this.smooth = !!tuning.smooth;
    this.rigid = !!set.rigid; // 보석·장식: 파츠 한 장이 통째로(모양 그대로) 흔들림
    this.chains = set.chains.map((c) => {
      const s = new Strand(c.spine, {
        freq: (c.freq ?? 1.5) * (tuning.freq ?? 1),
        damping: (c.damping ?? 0.2) * (tuning.damping ?? 1),
        inertia: (c.inertia ?? 1) * (tuning.inertia ?? 1),
        hang: c.hang ?? 0.35,
        wind: (c.wind ?? 0.6) * (tuning.wind ?? 1),
        phase: c.phase ?? 0,
        maxBend: c.maxBend ?? 0.45,
        maxSwing: c.maxSwing ?? null,
        accelTau: c.accelTau ?? 0,
        maxAccel: c.maxAccel ?? null,
        maxAngularAccel: c.maxAngularAccel ?? null,
        tipLag: c.tipLag ?? 0.5,
        stretch: tuning.smooth ? (c.stretch ?? 1) : 0,
      });
      s.rootFix = c.rootFix ?? 0.15;
      return s;
    });
    this.at = -1;
    this.rest = this.chains.map((s) => s.rest.map((p) => p.slice()));
  }

  reset() {
    for (const s of this.chains) s.reset();
    this.at = -1;
    this.pre = null;
    this.field?.dx.fill(0);
    this.field?.dy.fill(0);
  }

  // One shared displacement field keeps overlapping pieces and adjacent vertices coherent.
  // Limit its spatial gradient, rather than clipping each part independently and opening seams.
  makeField(box) {
    if (!this.fieldConfig || !this.smooth || this.rigid) return null;
    const step = this.fieldConfig.step ?? 26;
    const nx = Math.max(2, Math.ceil((box[2] - box[0]) / step) + 1);
    const ny = Math.max(2, Math.ceil((box[3] - box[1]) / step) + 1);
    const rest = new Float32Array(nx * ny * 2);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      rest[2 * i] = box[0] + x * step;
      rest[2 * i + 1] = box[1] + y * step;
    }
    this.field = { x: box[0], y: box[1], step, nx, ny, rest, bind: this.bind(rest),
      out: new Float32Array(rest.length), dx: new Float32Array(nx * ny), dy: new Float32Array(nx * ny),
      tmp: new Float32Array(nx * ny), scale: 1 };
    return this.field;
  }

  bindField(verts) {
    const f = this.field;
    const n = verts.length / 2;
    const cell = new Int32Array(n);
    const weights = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = clamp((verts[2 * i] - f.x) / f.step, 0, f.nx - 1.00001);
      const y = clamp((verts[2 * i + 1] - f.y) / f.step, 0, f.ny - 1.00001);
      cell[i] = Math.floor(y) * f.nx + Math.floor(x);
      weights[2 * i] = x - Math.floor(x);
      weights[2 * i + 1] = y - Math.floor(y);
    }
    return { field: true, n, cell, weights };
  }

  updateField() {
    const f = this.field;
    if (!f) return;
    this.deform(f.bind, f.rest, f.out);
    for (let i = 0; i < f.dx.length; i++) {
      f.dx[i] = f.out[2 * i] - f.rest[2 * i];
      f.dy[i] = f.out[2 * i + 1] - f.rest[2 * i + 1];
    }
    for (const values of [f.dx, f.dy]) {
      for (let pass = 0; pass < (this.fieldConfig.smooth ?? 2); pass++) {
        for (let y = 0; y < f.ny; y++) for (let x = 0; x < f.nx; x++) {
          const i = y * f.nx + x;
          f.tmp[i] = values[i] * 0.5 + 0.125 * (values[x ? i - 1 : i] + values[x + 1 < f.nx ? i + 1 : i]
            + values[y ? i - f.nx : i] + values[y + 1 < f.ny ? i + f.nx : i]);
        }
        values.set(f.tmp);
      }
    }
    let gradient = 0;
    for (let y = 0; y < f.ny - 1; y++) for (let x = 0; x < f.nx - 1; x++) {
      const i = y * f.nx + x;
      const h0 = Math.hypot(f.dx[i + 1] - f.dx[i], f.dy[i + 1] - f.dy[i]);
      const h1 = Math.hypot(f.dx[i + f.nx + 1] - f.dx[i + f.nx], f.dy[i + f.nx + 1] - f.dy[i + f.nx]);
      const v0 = Math.hypot(f.dx[i + f.nx] - f.dx[i], f.dy[i + f.nx] - f.dy[i]);
      const v1 = Math.hypot(f.dx[i + f.nx + 1] - f.dx[i + 1], f.dy[i + f.nx + 1] - f.dy[i + 1]);
      gradient = Math.max(gradient, Math.hypot(Math.max(h0, h1), Math.max(v0, v1)) / f.step);
    }
    f.scale = Math.min(1, (this.fieldConfig.maxGradient ?? 0.24) / Math.max(1e-9, gradient));
    if (f.scale < 1) for (let i = 0; i < f.dx.length; i++) { f.dx[i] *= f.scale; f.dy[i] *= f.scale; }
  }

  // 정점 묶기: 정점마다 가까운 사슬(최대 3개)의 [번호, 무게] + 그 사슬 마디 기준 좌표
  bind(verts) {
    const n = verts.length / 2;
    const K = this.smooth ? 8 : 3;
    const out = { n, idx: new Int16Array(n * K).fill(-1), wt: new Float32Array(n * K), sb: [] };
    const binds = this.chains.map((s) => {
      // 사슬마다: 정점의 (마디, 위치) — 뿌리 쪽(rootFix)은 무게를 줄여 머리에 붙어 있게
      const segs = s.n - 1;
      const raw = bindStrand(s, verts);
      const w = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const along = clamp((raw[5 * i] + clamp(raw[5 * i + 1], 0, 1)) / segs, 0, 1);
        const t0 = raw[5 * i + 1];
        // 뿌리보다 위(머리 꼭대기 쪽)는 0, 뿌리 아래로 갈수록 1
        w[i] = raw[5 * i] === 0 && t0 < 0 ? 0 : smoothstep(s.rootFix * 0.3, s.rootFix + 0.15, along);
      }
      return { raw, w };
    });
    const R = this.radius;
    for (let i = 0; i < n; i++) {
      const x = verts[2 * i];
      const y = verts[2 * i + 1];
      const cand = [];
      this.chains.forEach((s, c) => {
        const d = distToPolyline(this.rest[c], x, y);
        if (d < R * 2) cand.push([c, d]);
      });
      cand.sort((a, b) => a[1] - b[1]);
      let sum = 0;
      // smooth: 반경 2R 에서 무게가 0 으로 부드럽게 떨어지게 (갈아탈 때 끊김 없음)
      const floor = this.smooth ? Math.exp(-6) : 0;
      const pick = cand.slice(0, K).map(([c, d]) => {
        const g = Math.max(0, Math.exp(-((d / R) ** 2) * 1.5) - floor);
        sum += g;
        return [c, g];
      });
      // 사슬에서 멀수록(반경 밖) 전체 움직임도 줄어듦 — 정수리·가장자리의 빈 곳
      const reach = clamp(1.2 - (cand[0]?.[1] ?? Infinity) / (R * 2), 0, 1);
      pick.forEach(([c, g], k) => {
        out.idx[i * K + k] = c;
        out.wt[i * K + k] = sum > 0 ? (g / sum) * reach : 0;
      });
    }
    out.sb = binds;
    if (this.rigid) {
      // 통째로: 파츠 가운데 점 하나의 묶임 정보만 씀
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < n; i++) {
        cx += verts[2 * i];
        cy += verts[2 * i + 1];
      }
      out.center = [cx / n, cy / n];
      const best = this.chains.map((s, c) => [c, distToPolyline(this.rest[c], cx / n, cy / n)]).sort((a, b) => a[1] - b[1])[0][0];
      out.rigidChain = best;
      out.rigidRaw = bindStrand(this.chains[best], new Float32Array(out.center));
    }
    return out;
  }

  // refOf(선택): (x, y, out) → 쉬는 모양의 점이 이번 프레임 화면에서 있어야 할 자리 (머리 변환 + 중력 늘어짐).
  //   주면 사슬마다 뼈대 점을 옮겨 기준 모양(방향·길이)을 만들고, 가닥은 그 둘레에서 흔들림
  step(rootOf, dt, time, refOf = null) {
    if (this.at === time) return;
    this.at = time;
    const tmp = new Float64Array(2);
    this.chains.forEach((s, c) => {
      const root = rootOf(this.rest[c][0]);
      if (!refOf) {
        s.refP = null;
        s.step(root, dt);
        return;
      }
      const n = s.n;
      const P = (s.refP ??= this.rest[c].map(() => [0, 0]));
      for (let j = 0; j < n; j++) {
        refOf(this.rest[c][j][0], this.rest[c][j][1], tmp, c);
        P[j][0] = tmp[0];
        P[j][1] = tmp[1];
      }
      const R = (s.refNow ??= { ang: new Float64Array(n - 1), len: new Float64Array(n - 1) });
      for (let j = 0; j < n - 1; j++) {
        const dx = P[j + 1][0] - P[j][0];
        const dy = P[j + 1][1] - P[j][1];
        R.ang[j] = Math.atan2(dy, dx);
        R.len[j] = Math.max(1e-3, Math.hypot(dx, dy));
      }
      s.step({ x: P[0][0], y: P[0][1], rot: root.rot }, dt, R);
    });
    if (this.smooth) this.prep();
    this.updateField();
  }

  // smooth 방식 미리 계산: 사슬·마디마다 (지금 자리 - 쉬는 자리)와 (지금 방향 - 쉬는 방향) — 정점마다 삼각함수 없이 곱셈·덧셈만
  prep() {
    this.pre = this.chains.map((s) => {
      const n = s.n - 1;
      const dX = new Float64Array(n);
      const dY = new Float64Array(n);
      const cX = new Float64Array(n);
      const cY = new Float64Array(n);
      const R = s.rest;
      const root = s.p[0];
      const rot = s.rootRot ?? 0;
      const c0 = Math.cos(rot);
      const s0 = Math.sin(rot);
      for (let seg = 0; seg < n; seg++) {
        const a = s.ang[seg];
        if (s.refP) {
          // 기준 모양(머리 변환 + 중력) 대비: 정점의 기본 위치도 같은 기준으로 옮겨져 있으므로 차이만 더함
          dX[seg] = s.p[seg][0] - s.refP[seg][0];
          dY[seg] = s.p[seg][1] - s.refP[seg][1];
          cX[seg] = Math.cos(a) - Math.cos(s.refNow.ang[seg]);
          cY[seg] = Math.sin(a) - Math.sin(s.refNow.ang[seg]);
          continue;
        }
        const px = R[seg][0] - R[0][0];
        const py = R[seg][1] - R[0][1];
        const rx = root[0] + px * c0 - py * s0;
        const ry = root[1] + px * s0 + py * c0;
        const ar = s.restAng[seg] + rot;
        dX[seg] = s.p[seg][0] - rx;
        dY[seg] = s.p[seg][1] - ry;
        cX[seg] = Math.cos(a) - Math.cos(ar);
        cY[seg] = Math.sin(a) - Math.sin(ar);
      }
      return { dX, dY, cX, cY };
    });
  }

  // base: 머리 변환만 적용한 정점 위치. out 에 결과
  deform(B, base, out) {
    const K = this.smooth ? 8 : 3;
    const n = B.n;
    out.set(base);
    if (B.field) {
      const f = this.field;
      for (let i = 0; i < n; i++) {
        const c = B.cell[i], x = B.weights[2 * i], y = B.weights[2 * i + 1];
        out[2 * i] += (f.dx[c] * (1 - x) + f.dx[c + 1] * x) * (1 - y)
          + (f.dx[c + f.nx] * (1 - x) + f.dx[c + f.nx + 1] * x) * y;
        out[2 * i + 1] += (f.dy[c] * (1 - x) + f.dy[c + 1] * x) * (1 - y)
          + (f.dy[c + f.nx] * (1 - x) + f.dy[c + f.nx + 1] * x) * y;
      }
      return;
    }
    const tmp = new Float32Array(2);
    if (this.smooth && !this.rigid) {
      if (!this.pre) this.prep();
      const pre = this.pre;
      for (let i = 0; i < n; i++) {
        let dx = 0;
        let dy = 0;
        for (let k = 0; k < K; k++) {
          const c = B.idx[i * K + k];
          if (c < 0) break;
          const sb = B.sb[c];
          const gw = B.wt[i * K + k] * sb.w[i];
          if (gw <= 1e-4) continue;
          const raw = sb.raw;
          const seg = raw[5 * i];
          const lx = raw[5 * i + 2];
          const q = pre[c];
          dx += (q.dX[seg] + lx * q.cX[seg]) * gw;
          dy += (q.dY[seg] + lx * q.cY[seg]) * gw;
        }
        out[2 * i] += dx;
        out[2 * i + 1] += dy;
      }
      return;
    }
    if (this.rigid && B.rigidRaw) {
      // 가운데 점이 움직인 만큼 옮기고, 사슬 마디가 돈 만큼 파츠 전체를 그 점 둘레로 돌림
      const s = this.chains[B.rigidChain];
      const raw = B.rigidRaw;
      const seg = raw[0];
      moveOne(s, raw, 0, tmp);
      const rx = restPoint(this, B.rigidChain, raw, 0, base, 0);
      const ry = restPoint(this, B.rigidChain, raw, 0, base, 1);
      const th = s.ang[seg] - (s.restAng[seg] + (s.rootRot ?? 0));
      const c = Math.cos(th);
      const si = Math.sin(th);
      let mx = 0;
      let my = 0;
      for (let i = 0; i < n; i++) {
        mx += base[2 * i];
        my += base[2 * i + 1];
      }
      mx /= n;
      my /= n;
      const dx = tmp[0] - rx;
      const dy = tmp[1] - ry;
      for (let i = 0; i < n; i++) {
        const x = base[2 * i] - mx;
        const y = base[2 * i + 1] - my;
        out[2 * i] = mx + x * c - y * si + dx;
        out[2 * i + 1] = my + x * si + y * c + dy;
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      let dx = 0;
      let dy = 0;
      for (let k = 0; k < K; k++) {
        const c = B.idx[i * K + k];
        if (c < 0) break;
        const g = B.wt[i * K + k];
        if (g <= 0) continue;
        const sb = B.sb[c];
        const w = sb.w[i];
        if (w <= 0) continue;
        if (this.smooth) {
          // 사슬 위(옆으로 떨어진 거리 0) 점이 움직인 만큼만
          moveAlong(this.chains[c], sb.raw, i, tmp);
          dx += (tmp[0] - restAlong(this.chains[c], sb.raw, i, 0)) * g * w;
          dy += (tmp[1] - restAlong(this.chains[c], sb.raw, i, 1)) * g * w;
        } else {
          moveOne(this.chains[c], sb.raw, i, tmp);
          dx += (tmp[0] - restPoint(this, c, sb.raw, i, base, 0)) * g * w;
          dy += (tmp[1] - restPoint(this, c, sb.raw, i, base, 1)) * g * w;
        }
      }
      out[2 * i] += dx;
      out[2 * i + 1] += dy;
    }
  }
}

// 사슬이 '머리만 움직였을 때' 있을 자리 대비 지금 자리의 차이를 쓰기 위해: 마디가 쉬는 각(뿌리 회전만 반영)일 때의 위치
function restPoint(set, c, raw, i, base, axis) {
  const s = set.chains[c];
  const seg = raw[5 * i];
  const lx = raw[5 * i + 2];
  const ly = raw[5 * i + 3];
  // 쉬는 모양을 지금 뿌리 위치·회전으로 옮긴 점
  const R = s.rest;
  const root = s.p[0];
  const rot = s.rootRot ?? 0;
  const c0 = Math.cos(rot);
  const s0 = Math.sin(rot);
  const px = R[seg][0] - R[0][0];
  const py = R[seg][1] - R[0][1];
  const a = s.restAng[seg] + rot;
  const x = root[0] + px * c0 - py * s0 + lx * Math.cos(a) - ly * Math.sin(a);
  const y = root[1] + px * s0 + py * c0 + lx * Math.sin(a) + ly * Math.cos(a);
  return axis === 0 ? x : y;
}

// 사슬 위 점(옆 거리 0)의 지금 자리 / 쉬는 자리
function moveAlong(s, raw, i, out) {
  const seg = raw[5 * i];
  const lx = raw[5 * i + 2];
  const p = s.p[seg];
  const a = s.ang[seg];
  out[0] = p[0] + lx * Math.cos(a);
  out[1] = p[1] + lx * Math.sin(a);
}

function restAlong(s, raw, i, axis) {
  const seg = raw[5 * i];
  const lx = raw[5 * i + 2];
  const R = s.rest;
  const root = s.p[0];
  const rot = s.rootRot ?? 0;
  const c0 = Math.cos(rot);
  const s0 = Math.sin(rot);
  const px = R[seg][0] - R[0][0];
  const py = R[seg][1] - R[0][1];
  const a = s.restAng[seg] + rot;
  return axis === 0 ? root[0] + px * c0 - py * s0 + lx * Math.cos(a) : root[1] + px * s0 + py * c0 + lx * Math.sin(a);
}

function moveOne(s, raw, i, out) {
  const seg = raw[5 * i];
  const lx = raw[5 * i + 2];
  const ly = raw[5 * i + 3];
  const p = s.p[seg];
  const a = s.ang[seg];
  out[0] = p[0] + lx * Math.cos(a) - ly * Math.sin(a);
  out[1] = p[1] + lx * Math.sin(a) + ly * Math.cos(a);
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function distToPolyline(pts, x, y) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dy = pts[i + 1][1] - ay;
    const L2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}
