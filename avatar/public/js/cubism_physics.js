// Cubism 물리(physics3.json) 계산 — 공식 Cubism Framework(CubismPhysics) 와 같은 방식.
// 설정마다 진자(입자 사슬)를 입력 파라미터(고개·몸 각도)로 흔들고, 입자 사이 각도를 출력 파라미터(머리카락 흔들림)로 쓴다.
// Meta.Fps 가 있으면 그 간격으로 고정해 계산하고 화면 프레임 사이는 보간한다 (Cubism Viewer 와 같은 움직임).

const AIR_RESISTANCE = 5.0;
const MAX_WEIGHT = 100.0;
const MOVEMENT_THRESHOLD = 0.001;
const MAX_DELTA_TIME = 5.0;
const DEG = Math.PI / 180;

function directionToRadian(fx, fy, tx, ty) {
  let r = Math.atan2(ty, tx) - Math.atan2(fy, fx);
  while (r < -Math.PI) r += 2 * Math.PI;
  while (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

// 파라미터 값을 물리 공간 값으로 (가운데 = 파라미터 범위의 가운데). Reflect 가 아니면 부호를 뒤집는 것까지 공식과 같게
function normalizeParam(value, pMin, pMax, nMin, nMax, nDef, inverted) {
  const maxV = Math.max(pMax, pMin);
  const minV = Math.min(pMax, pMin);
  if (value > maxV) value = maxV;
  if (value < minV) value = minV;
  const minN = Math.min(nMin, nMax);
  const maxN = Math.max(nMin, nMax);
  const mid = minV + Math.abs(maxV - minV) / 2;
  const d = value - mid;
  let result = nDef;
  if (d > 0) {
    const pLen = maxV - mid;
    if (pLen !== 0) result = d * ((maxN - nDef) / pLen) + nDef;
  } else if (d < 0) {
    const pLen = minV - mid;
    if (pLen !== 0) result = d * ((minN - nDef) / pLen) + nDef;
  }
  return inverted ? result : -result;
}

export class CubismPhysics {
  // json: physics3.json, params: Live2DCubismCore.Model.parameters
  constructor(json, params) {
    this.params = params;
    const index = new Map(params.ids.map((id, i) => [id, i]));
    this.fps = json.Meta?.Fps > 0 ? json.Meta.Fps : 0;
    const g = json.Meta?.EffectiveForces?.Gravity;
    const w = json.Meta?.EffectiveForces?.Wind;
    // 공식 런타임은 옵션의 중력 (0,-1)·바람 (0,0) 을 쓴다 (json 값도 보통 같다)
    this.gravity = { x: g?.X ?? 0, y: g?.Y ?? -1 };
    this.wind = { x: w?.X ?? 0, y: w?.Y ?? 0 };
    this.settings = (json.PhysicsSettings ?? []).map((s) => ({
      normPos: { min: s.Normalization.Position.Minimum, max: s.Normalization.Position.Maximum, def: s.Normalization.Position.Default },
      normAngle: { min: s.Normalization.Angle.Minimum, max: s.Normalization.Angle.Maximum, def: s.Normalization.Angle.Default },
      inputs: s.Input.map((i) => ({
        src: index.get(i.Source.Id) ?? -1, weight: i.Weight / MAX_WEIGHT, type: i.Type, reflect: !!i.Reflect,
      })).filter((i) => i.src >= 0),
      outputs: s.Output.map((o) => ({
        dst: index.get(o.Destination.Id) ?? -1, vertex: o.VertexIndex, scale: o.Scale, weight: o.Weight / MAX_WEIGHT, type: o.Type, reflect: !!o.Reflect,
      })).filter((o) => o.dst >= 0),
      particles: s.Vertices.map((v) => ({
        mobility: v.Mobility, delay: v.Delay, acceleration: v.Acceleration, radius: v.Radius,
        x: 0, y: 0, lx: 0, ly: 0, vx: 0, vy: 0, gx: 0, gy: 1,
      })),
    }));
    for (const s of this.settings) {
      s.cur = new Float32Array(s.outputs.length);
      s.prev = new Float32Array(s.outputs.length);
    }
    this.reset();
  }

  // 모든 진자를 아래로 늘어진 처음 자세로
  reset() {
    for (const s of this.settings) {
      let y = 0;
      for (const [i, p] of s.particles.entries()) {
        if (i > 0) y += p.radius;
        Object.assign(p, { x: 0, y, lx: 0, ly: y, vx: 0, vy: 0, gx: 0, gy: 1 });
      }
      s.cur.fill(0);
      s.prev.fill(0);
    }
    this.remain = 0;
    this.caches = null;
    this.inputCaches = null;
  }

  // dt 초만큼 진행해 출력 파라미터를 params.values 에 쓴다 (입력 파라미터는 미리 넣어 둘 것)
  evaluate(dt) {
    if (!(dt > 0)) return;
    const P = this.params;
    const values = P.values;
    const n = values.length;
    this.remain += dt;
    if (this.remain > MAX_DELTA_TIME) this.remain = 0;
    if (!this.caches) {
      this.caches = new Float32Array(n);
      this.inputCaches = Float32Array.from(values);
    }
    const step = this.fps > 0 ? 1 / this.fps : dt;
    const caches = this.caches;
    while (this.remain >= step) {
      for (const s of this.settings) s.prev.set(s.cur);
      const wIn = step / this.remain;
      for (let j = 0; j < n; j++) {
        caches[j] = this.inputCaches[j] * (1 - wIn) + values[j] * wIn;
        this.inputCaches[j] = caches[j];
      }
      for (const s of this.settings) this.stepSetting(s, step);
      this.remain -= step;
    }
    // 고정 간격 계산 사이의 화면 프레임은 앞뒤 결과를 섞어서
    const alpha = this.remain / step;
    for (const s of this.settings) {
      for (const [k, o] of s.outputs.entries()) {
        values[o.dst] = this.outputValue(values[o.dst], o, s.prev[k] * (1 - alpha) + s.cur[k] * alpha);
      }
    }
  }

  stepSetting(s, dt) {
    const P = this.params;
    const caches = this.caches;
    let tx = 0;
    let ty = 0;
    let angle = 0;
    for (const i of s.inputs) {
      const pMin = P.minimumValues[i.src];
      const pMax = P.maximumValues[i.src];
      const v = caches[i.src];
      if (i.type === 'X') tx += normalizeParam(v, pMin, pMax, s.normPos.min, s.normPos.max, s.normPos.def, i.reflect) * i.weight;
      else if (i.type === 'Y') ty += normalizeParam(v, pMin, pMax, s.normPos.min, s.normPos.max, s.normPos.def, i.reflect) * i.weight;
      else if (i.type === 'Angle') angle += normalizeParam(v, pMin, pMax, s.normAngle.min, s.normAngle.max, s.normAngle.def, i.reflect) * i.weight;
    }
    // 공식 코드는 x 를 먼저 바꾼 뒤 그 값으로 y 를 계산한다 — 같은 움직임을 위해 그대로 둠
    const ra = -angle * DEG;
    tx = tx * Math.cos(ra) - ty * Math.sin(ra);
    ty = tx * Math.sin(ra) + ty * Math.cos(ra);
    this.updateParticles(s.particles, tx, ty, angle, MOVEMENT_THRESHOLD * s.normPos.max, dt);
    const pts = s.particles;
    for (const [k, o] of s.outputs.entries()) {
      const pi = o.vertex;
      if (pi < 1 || pi >= pts.length) continue;
      const dx = pts[pi].x - pts[pi - 1].x;
      const dy = pts[pi].y - pts[pi - 1].y;
      let out;
      if (o.type === 'X') out = dx;
      else if (o.type === 'Y') out = dy;
      else {
        let gx;
        let gy;
        if (pi >= 2) {
          gx = pts[pi - 1].x - pts[pi - 2].x;
          gy = pts[pi - 1].y - pts[pi - 2].y;
        } else {
          gx = -this.gravity.x;
          gy = -this.gravity.y;
        }
        out = directionToRadian(gx, gy, dx, dy);
      }
      if (o.reflect) out = -out;
      s.cur[k] = out;
      caches[o.dst] = this.outputValue(caches[o.dst], o, out);
    }
  }

  outputValue(current, o, raw) {
    const P = this.params;
    let v = raw * o.scale;
    v = Math.min(P.maximumValues[o.dst], Math.max(P.minimumValues[o.dst], v));
    return o.weight >= 1 ? v : current * (1 - o.weight) + v * o.weight;
  }

  updateParticles(pts, tx, ty, angle, threshold, dt) {
    pts[0].x = tx;
    pts[0].y = ty;
    const r = angle * DEG;
    let gx = Math.sin(r);
    let gy = Math.cos(r);
    const gl = Math.hypot(gx, gy) || 1;
    gx /= gl;
    gy /= gl;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[i - 1];
      const fx = gx * p.acceleration + this.wind.x;
      const fy = gy * p.acceleration + this.wind.y;
      p.lx = p.x;
      p.ly = p.y;
      const delay = p.delay * dt * 30;
      let dx = p.x - q.x;
      let dy = p.y - q.y;
      const rad = directionToRadian(p.gx, p.gy, gx, gy) / AIR_RESISTANCE;
      dx = Math.cos(rad) * dx - dy * Math.sin(rad);
      dy = Math.sin(rad) * dx + dy * Math.cos(rad);
      p.x = q.x + dx + p.vx * delay + fx * delay * delay;
      p.y = q.y + dy + p.vy * delay + fy * delay * delay;
      let nx = p.x - q.x;
      let ny = p.y - q.y;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      p.x = q.x + nx * p.radius;
      p.y = q.y + ny * p.radius;
      if (Math.abs(p.x) < threshold) p.x = 0;
      if (delay !== 0) {
        p.vx = ((p.x - p.lx) / delay) * p.mobility;
        p.vy = ((p.y - p.ly) / delay) * p.mobility;
      }
      p.gx = gx;
      p.gy = gy;
    }
  }
}
