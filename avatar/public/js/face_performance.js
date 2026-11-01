// v6 facial articulation. Procedural reactions are resolved once before relay;
// expression poses reuse the separated eyes/lips instead of stacking face photos.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (x, target, dt, tau) => x + (target - x) * (1 - Math.exp(-dt / tau));

export const FACE_POSES = {
  smile: { brow: .10, arch: .16, squint: .20, lid: .97, form: .65 },
  surprised: { brow: .48, tilt: .12, widen: .85, pupil: -.16, open: .32, narrow: .45 },
  angry: { brow: -.22, tilt: -.55, squint: .24, lid: .92, lidTilt: .40, form: -.42 },
  shy: { brow: .06, tilt: .18, squint: .08, lid: .90, form: .28 },
  wink: { brow: .10, lidL: 0, lidR: .98, form: .48 },
  sleepy: { brow: -.08, lid: .48, form: -.10 },
  sad: { brow: .12, tilt: .50, lid: .82, form: -.45 },
};

export function facePose(input) {
  const p = { ...input };
  const weights = Object.keys(FACE_POSES).map(name => [name, clamp(input['ex_' + name] ?? 0, 0, 1)]);
  const scale = 1 / Math.max(1, weights.reduce((sum, [, w]) => sum + w, 0));
  const pose = { brow: 0, arch: 0, tilt: 0, squint: 0, widen: 0, pupil: 0, form: 0, open: 0, narrow: 0, lidTilt: 0, lidL: 1, lidR: 1 };
  for (const [name, weight] of weights) {
    const def = FACE_POSES[name], w = weight * scale;
    for (const key of Object.keys(pose)) {
      if (key === 'lidL' || key === 'lidR') pose[key] += ((def[key] ?? def.lid ?? 1) - 1) * w;
      else pose[key] += (def[key] ?? 0) * w;
    }
  }
  const add = (key, value, min, max) => { p[key] = clamp((p[key] ?? 0) + value, min, max); };
  for (const side of ['L', 'R']) {
    p['brow' + side] = clamp((input['brow' + side] ?? input.brow ?? 0) + pose.brow, -1, 1);
    add('browTilt' + side, pose.tilt, -1, 1);
    add('eyeSquint' + side, pose.squint, 0, 1);
    p['eyeOpen' + side] = clamp((input['eyeOpen' + side] ?? 1) * pose['lid' + side], 0, 1.2);
  }
  add('browArch', pose.arch, -1, 1);
  add('eyeWiden', pose.widen, 0, 1);
  add('lidTilt', pose.lidTilt, -1, 1);
  add('pupil', pose.pupil, -1, 1);
  add('mouthForm', pose.form, -1, 1);
  // Explicit per-side tracking must receive the expression's mouth-corner pose too.
  for (const side of ['L', 'R']) if (input['mouthForm' + side] !== undefined) {
    p['mouthForm' + side] = clamp(input['mouthForm' + side] + pose.form, -1, 1);
  }
  const expressionOpen = pose.open * (1 - smooth(.12, .5, input.mouthOpen ?? 0));
  p.mouthOpen = Math.max(input.mouthOpen ?? 0, expressionOpen);
  p.jawOpen = Math.max(input.jawOpen ?? input.mouthOpen ?? 0, expressionOpen);
  add('mouthNarrow', pose.narrow * (1 - smooth(.15, .6, input.mouthOpen ?? 0)), 0, 1);
  return p;
}

export function sampleCurve(values, x) {
  const u = clamp(x, 0, values.length - 1), i = Math.floor(u), f = u - i;
  return values[i] * (1 - f) + values[Math.min(i + 1, values.length - 1)] * f;
}

export function deformArticulatedMouth(rest, out, part, rig, p, shape) {
  const M = rig.mouth, C = M.cavity, H = rig.head;
  const m = clamp(p.mouthOpen ?? 0, 0, 1);
  const wide = clamp(p.mouthWide ?? 0, 0, 1), narrow = clamp(p.mouthNarrow ?? 0, 0, 1);
  const form = clamp(p.mouthForm ?? 0, -1, 1);
  // 모델마다 입 모양 세기를 다르게 (rig.mouth.shapeK, 없으면 v6 값)
  const K = M.shapeK ?? {};
  const height = (K.open ?? 1.4) * m * (1 + (K.narrowH ?? .12) * narrow - (K.wideH ?? .1) * wide);
  const sx = clamp(1.10 - .10 * m + (K.wideW ?? .24) * wide - (K.narrowW ?? .36) * narrow + .05 * form, K.minW ?? .48, K.maxW ?? 1.35);
  const cx = C[0] + C[2] / 2, seam = M.line[1] + M.line[3] / 2;
  const jaw = clamp(p.jawOpen ?? m, 0, 1) * H.ry * .034;
  const att = part.attach ?? 'cavity', lip = /^Lip(Upper|Lower)[RCL]$/.test(part.name);
  const thickness = .45 + .55 * Math.min(1, height);
  for (let i = 0; i < rest.length; i += 2) {
    const x = rest[i], y = rest[i + 1];
    const top = shape ? sampleCurve(shape.top, x - shape.x) : C[1];
    const bottom = shape ? sampleCurve(shape.bottom, x - shape.x) : C[1] + C[3];
    const line = (top + bottom) / 2;
    let target;
    // 열리는 방향: K.up = 위로 열리는 몫 (0.5 = 위아래 같이, 작을수록 윗입술은 거의 그대로 두고 아래로 열림)
    const openShift = (.5 - (K.up ?? .5)) * (bottom - top) * height;
    if (lip && part.lipBaseline) {
      const edge = part.name.startsWith('LipUpper') ? top : bottom;
      target = seam + (edge - line) * height + (y - sampleCurve(part.lipBaseline, x - part.x)) * thickness;
    } else if (att === 'upper') target = seam + (top - line) * height + (y - C[1]) * thickness;
    else if (att === 'lower') target = seam + (bottom - line) * height + (y - C[1] - C[3]) * thickness;
    else target = seam + (y - line) * height;
    target += openShift;
    const skinWeight = att === 'skin' ? smooth(M.inner[1], C[1], y) * (1 - smooth(C[1] + C[3], M.inner[1] + M.inner[3], y)) : 1;
    if (att === 'skin') target = y + (target - y) * skinWeight;
    const u = (x - cx) / (M.line[2] * 1.5);
    const sideForm = u < 0 ? (p.mouthFormR ?? form) : (p.mouthFormL ?? form);
    const corner = Math.min(1.1, u * u) * (1 - smooth(1.05, 1.5, Math.abs(u)));
    target -= clamp(sideForm, -1, 1) * (9 - 5 * smooth(0, .6, m)) * corner * skinWeight;
    target += jaw * smooth(M.top - 10, H.cy + H.ry * .78 - 25, y) * (1 - smooth(.25, .85, Math.abs(x - M.cx) / H.rx));
    const low = att === 'lower' ? 1 : att === 'upper' ? 0 : clamp((y - C[1]) / C[3], 0, 1);
    out[i] = cx + (x - cx) * sx + clamp(p.mouthX ?? 0, -1, 1) * 4 + clamp(p.jawX ?? 0, -1, 1) * H.rx * .035 * low;
    out[i + 1] = target - clamp(p.upperUp ?? 0, 0, 1) * 3 * (1 - low) * skinWeight;
  }
}

export class FacePerformance {
  constructor() { this.reset(); }

  reset() {
    this.time = 0;
    this.seed = 61931;
    this.values = {};
    this.expressions = {};
    this.voice = this.mean = this.previousMouth = this.accent = 0;
    this.lastAccent = -10;
    this.quiet = 1;
    this.gaze = [0, 0];
    this.browSide = 1;
    this.nextBlink = 2.3;
    this.blinkAt = -10;
    this.lastBlink = -10;
    this.blinkDelay = .004;
    this.wasAuto = false;
    this.pauseBlinked = true;
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  filter(key, target, dt, tau, initial = target) {
    const previous = this.values[key] ?? initial;
    return this.values[key] = damp(previous, target, dt, tau);
  }

  apply(p, dt, { strength = 1, autoBlink = false } = {}) {
    if (p._facePerformance === 1) return p;
    const h = clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    if (h <= 0) { p._facePerformance = 1; return p; }
    const s = clamp(strength, 0, 1.4);
    this.time += h;
    const t = this.time, raw = clamp(p.mouthOpen ?? 0, 0, 1);
    const opening = (raw - this.previousMouth) / h;
    this.previousMouth = raw;
    this.mean = damp(this.mean, raw, h, .5);
    this.voice = damp(this.voice, raw, h, raw > this.voice ? .09 : .24);
    if (raw > .12) {
      if (this.quiet > .4) {
        this.gaze = [(this.random() - .5) * .16, (this.random() - .5) * .08];
        this.pauseBlinked = false;
      }
      this.quiet = 0;
    } else this.quiet += h;
    if (raw > .25 && opening > 1.2 && t - this.lastAccent > .6) {
      this.accent = Math.min(1, .35 + Math.max(0, raw - this.mean) * 1.2);
      this.lastAccent = t;
      this.browSide = this.random() > .5 ? 1 : -1;
    }
    this.accent *= Math.exp(-h / .32);

    // Fast lip closure, slower vowel width and jaw: adjacent syllables overlap
    // without leaving the mouth ajar after a phrase.
    p.mouthOpen = this.filter('open', raw, h, raw > (this.values.open ?? raw) ? .018 : .025);
    if (raw === 0 && p.mouthOpen < .003) p.mouthOpen = this.values.open = 0;
    p.jawOpen = this.filter('jaw', p.mouthOpen, h, .045);
    let wide = clamp(p.mouthWide ?? 0, 0, 1), narrow = clamp(p.mouthNarrow ?? 0, 0, 1);
    const total = Math.max(1, wide + narrow);
    p.mouthWide = this.filter('wide', wide / total, h, .045);
    p.mouthNarrow = this.filter('narrow', narrow / total, h, .045);
    p.mouthForm = this.filter('form', clamp(p.mouthForm ?? 0, -1, 1), h, .055);
    for (const side of ['L', 'R']) if (p['mouthForm' + side] !== undefined) {
      p['mouthForm' + side] = this.filter('form' + side, clamp(p['mouthForm' + side], -1, 1), h, .055);
    }

    for (const name of Object.keys(FACE_POSES)) {
      const target = clamp(p['ex_' + name] ?? 0, 0, 1), old = this.expressions[name] ?? 0;
      this.expressions[name] = damp(old, target, h, target > old ? .085 : .12);
      p['ex_' + name] = this.expressions[name];
    }
    const voice = smooth(.025, .3, this.voice);
    const emphasis = this.filter('emphasis', this.accent, h, .055, 0);
    for (const side of ['L', 'R']) {
      const tracked = clamp(p['brow' + side] ?? p.brow ?? 0, -1, 1);
      const asymmetric = side === (this.browSide > 0 ? 'L' : 'R') ? 1 : .72;
      const addition = (voice * .035 + emphasis * .16 * asymmetric) * s * (1 - Math.abs(tracked) * .8);
      p['brow' + side] = clamp(tracked + addition, -1, 1);
    }
    p.browArch = clamp((p.browArch ?? 0) + emphasis * .075 * s, -1, 1);
    for (const [key, target] of [['eyeBallX', this.gaze[0]], ['eyeBallY', this.gaze[1]]]) {
      const base = clamp(p[key] ?? 0, -1, 1);
      const room = 1 - smooth(.25, .75, Math.abs(base));
      p[key] = clamp(base + this.filter(key, target * voice, h, .09, 0) * room * s, -1, 1);
    }

    if (autoBlink) {
      if (!this.wasAuto) this.nextBlink = t + 2.1;
      if (this.quiet > .32 && !this.pauseBlinked && t - this.lastBlink > 1.7) {
        this.nextBlink = Math.min(this.nextBlink, t + .04);
        this.pauseBlinked = true;
      }
      if (t >= this.nextBlink) {
        this.blinkAt = t;
        this.lastBlink = t;
        this.blinkDelay = .002 + this.random() * .004;
        const double = this.random() < .12;
        this.nextBlink = t + (double ? .32 : 2.7 + this.random() * 3 + voice * .7);
      }
      const blink = delay => {
        const u = t - this.blinkAt - delay;
        if (u < 0 || u > .23) return 1;
        if (u < .065) return 1 - smooth(0, .065, u);
        if (u < .08) return 0;
        return smooth(.08, .23, u);
      };
      p.eyeOpenL = (p.eyeOpenL ?? 1) * blink(0);
      p.eyeOpenR = (p.eyeOpenR ?? 1) * blink(this.blinkDelay);
    } else this.blinkAt = -10;
    this.wasAuto = autoBlink;
    p._facePerformance = 1;
    return p;
  }
}
