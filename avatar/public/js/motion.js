// 움직임 다듬기: 트래킹 값을 그대로 쓰지 않고 파라미터마다 따라가는 방식을 정한다.
//  - 고개·몸(spring): 스프링으로 따라감. 떨림은 트래커의 OneEuro 필터가 이미 걸렀으므로 데드존 없이 작은 움직임까지 그대로 따라 하고,
//    감쇠비(zeta)를 1보다 조금 낮춰 멈출 때 아주 살짝 지나쳤다 돌아오는 탄력(뾰잉)을 준다. 몸은 더 느리고 더 출렁여 머리를 늦게 따라옴.
//  - 나머지(눈·입·눈썹): 최대 속도·가속도 제한 + 작은 데드존.

import { springStep } from './spring.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// v6 uses a consistent elastic response: the torso follows more slowly, while
// fast eyelids and lip closure keep their original timing.
const ELASTIC_AXES = {
  angleX: { freq: 5, zeta: .71 }, angleY: { freq: 5.2, zeta: .74 }, angleZ: { freq: 4.7, zeta: .70 },
  bodyX: { freq: 2.3, zeta: .61 }, bodyZ: { freq: 2.35, zeta: .59 },
  bodyYaw: { freq: 2.2, zeta: .63 }, bodyLean: { freq: 2.1, zeta: .65 },
};

// 단위: 각도 파라미터는 도(°), 나머지는 파라미터 범위 그대로. 속도는 /초, 가속도는 /초².
// response: 목표에 가까워질 때 얼마나 빨리 붙는지(1/초). deadzone: 무시할 흔들림 크기.
export const MOTION_DEFAULTS = {
  // freq: 스프링 고유 진동수(Hz, 클수록 빨리 붙음), zeta: 감쇠비(1 = 지나침 없음, 작을수록 탄력), maxV: 튀는 값 막는 최대 속도
  angleX: { spring: true, freq: 5.5, zeta: 0.82, maxV: 420 },
  angleY: { spring: true, freq: 5.5, zeta: 0.82, maxV: 380 },
  angleZ: { spring: true, freq: 5, zeta: 0.82, maxV: 360 },
  bodyX: { spring: true, freq: 2.2, zeta: 0.62, maxV: 80, body: true },
  bodyZ: { spring: true, freq: 2.2, zeta: 0.6, maxV: 90, body: true },
  bodyYaw: { spring: true, freq: 2, zeta: 0.62, maxV: 70, body: true },
  bodyLean: { spring: true, freq: 1.8, zeta: 0.65, maxV: 60, body: true },
  // 팔 (어깨·팔꿈치 각도, °): 몸처럼 조금 늦게·출렁이며 따라감
  armR: { spring: true, freq: 2.6, zeta: 0.62, maxV: 240, body: true },
  armL: { spring: true, freq: 2.6, zeta: 0.62, maxV: 240, body: true },
  elbowR: { spring: true, freq: 3, zeta: 0.66, maxV: 300, body: true },
  elbowL: { spring: true, freq: 3, zeta: 0.66, maxV: 300, body: true },
  // 눈 깜빡임은 빨라야 자연스럽다 → 부드러움 설정에 따라 느려지지 않게(fast)
  eyeOpenL: { maxV: 14, maxA: 600, response: 40, deadzone: 0.02, fast: true },
  eyeOpenR: { maxV: 14, maxA: 600, response: 40, deadzone: 0.02, fast: true },
  eyeSmile: { maxV: 5, maxA: 40, response: 12, deadzone: 0.02 },
  // 눈동자는 민첩하게: 부드러움 설정의 영향을 적게 받음(agile)
  eyeBallX: { maxV: 7, maxA: 90, response: 16, deadzone: 0.04, agile: true },
  eyeBallY: { maxV: 6, maxA: 80, response: 16, deadzone: 0.04, agile: true },
  brow: { maxV: 2.5, maxA: 18, response: 6, deadzone: 0.06 },
  mouthOpen: { maxV: 9, maxA: 140, response: 22, deadzone: 0.025 },
  mouthForm: { maxV: 2.5, maxA: 16, response: 6, deadzone: 0.05 },
  mouthNarrow: { maxV: 3, maxA: 22, response: 8, deadzone: 0.05 },
  mouthWide: { maxV: 3, maxA: 22, response: 8, deadzone: 0.05 },
  mouthFormL: { maxV: 2.5, maxA: 16, response: 6, deadzone: 0.04 },
  mouthFormR: { maxV: 2.5, maxA: 16, response: 6, deadzone: 0.04 },
  browL: { maxV: 2.5, maxA: 18, response: 6, deadzone: 0.05 },
  browR: { maxV: 2.5, maxA: 18, response: 6, deadzone: 0.05 },
  cheekPuff: { maxV: 3, maxA: 25, response: 8, deadzone: 0.04 },
  cheekSquint: { maxV: 3, maxA: 25, response: 8, deadzone: 0.04 },
  pupil: { maxV: 2, maxA: 12, response: 5, deadzone: 0.04 },
  mouthX: { maxV: 3, maxA: 25, response: 8, deadzone: 0.05 },
  jawX: { maxV: 3, maxA: 25, response: 8, deadzone: 0.05 },
  eyeSquintL: { maxV: 4, maxA: 40, response: 10, deadzone: 0.04 },
  eyeSquintR: { maxV: 4, maxA: 40, response: 10, deadzone: 0.04 },
  upperUp: { maxV: 3, maxA: 25, response: 8, deadzone: 0.04 },
  noseSneer: { maxV: 3, maxA: 25, response: 8, deadzone: 0.04 },
  glasses: { maxV: 5, maxA: 60, response: 14, deadzone: 0, fast: true }, // 켜고 끌 때 부드럽게 나타나기
};

class Axis {
  constructor(cfg) {
    this.cfg = cfg;
    this.x = null;
    this.v = 0;
  }

  step(target, dt, soft, bounce = 0.5) {
    if (this.x === null) {
      this.x = target;
      return target;
    }
    const c = this.cfg;
    if (c.spring) {
      // 부드러움: 진동수를 낮춤(묵직하게), 탄력: 감쇠비를 낮춤(멈출 때 살짝 튐). 몸은 탄력이 더 크게 먹음
      const w = 2 * Math.PI * c.freq * (1 - 0.55 * soft);
      const z = clamp(c.zeta - (bounce - 0.5) * (c.body ? 0.5 : 0.3), 0.35, 1.2);
      if (c.analytic) {
        const previous = this.x;
        springStep(this, target, dt, w / (2 * Math.PI), Math.max(c.body ? .48 : .56, z));
        this.x = clamp(this.x, previous - c.maxV * dt, previous + c.maxV * dt);
        this.v = clamp(this.v, -c.maxV, c.maxV);
        return this.x;
      }
      const a = w * w * (target - this.x) - 2 * z * w * this.v;
      this.v = clamp(this.v + a * dt, -c.maxV, c.maxV);
      this.x += this.v * dt;
      return this.x;
    }
    // 부드러움(soft 0~1): 높을수록 느리고 묵직하게, 데드존은 넓게
    const speedK = c.fast ? 1 : c.agile ? 1 - 0.25 * soft : 1 - 0.6 * soft;
    const maxV = c.maxV * speedK;
    const maxA = c.maxA * speedK * speedK;
    const dz = c.deadzone * (0.5 + 1.5 * soft);
    let err = target - this.x;
    // 부드러운 데드존: 경계에서 갑자기 움직이지 않도록 초과분만 쓴다
    err = Math.sign(err) * Math.max(0, Math.abs(err) - dz);
    // 원하는 속도: 목표까지 거리 비례, 최대 속도 제한, 남은 거리에서 멈출 수 있는 속도 제한(√(2a·d))
    const dist = Math.abs(err);
    const want = Math.sign(err) * Math.min(maxV, c.response * speedK * dist, Math.sqrt(2 * maxA * dist));
    // 가속도 제한
    const dv = clamp(want - this.v, -maxA * dt, maxA * dt);
    this.v += dv;
    this.x += this.v * dt;
    return this.x;
  }

  reset(value) {
    this.x = value;
    this.v = 0;
  }
}

export class MotionLimiter {
  constructor(config = MOTION_DEFAULTS, profile = null) {
    this.profile = profile;
    this.axes = {};
    for (const [k, cfg] of Object.entries(config)) this.axes[k] = new Axis(profile && ELASTIC_AXES[k]
      ? { ...cfg, ...ELASTIC_AXES[k], analytic: true } : cfg);
    if (profile) {
      for (const [key, freq] of [['shift', 3.8], ['lean', 3.6]]) {
        if (!this.axes[key]) this.axes[key] = new Axis({ spring: true, analytic: true, freq, zeta: .82, maxV: 90 });
      }
    }
    this.softness = 0.5;
    this.bounce = 0.5; // 탄력 0~1
  }

  // 모델에 따라 생기는 파라미터(표정 ex_<이름> 등)
  addAxis(key, cfg) {
    if (!this.axes[key]) this.axes[key] = new Axis(cfg);
  }

  // P 를 제자리에서 고쳐 돌려준다. 설정이 없는 파라미터(breath 등)는 그대로 둔다.
  apply(P, dt) {
    const h = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, this.profile ? .1 : .05));
    if (h === 0) {
      for (const [k, axis] of Object.entries(this.axes)) if (k in P && axis.x !== null) P[k] = axis.x;
      return P;
    }
    const sub = Math.max(1, Math.ceil(h / (1 / 120))); // 프레임이 길면 쪼개서 계산
    for (const [k, axis] of Object.entries(this.axes)) {
      if (!(k in P)) continue;
      if (!Number.isFinite(P[k])) continue;
      let x = P[k];
      for (let i = 0; i < sub; i++) x = axis.step(P[k], h / sub, this.softness, this.bounce);
      P[k] = x;
    }
    return P;
  }
}

// 눈 깜빡임 판정: 눈이 작으면 뜬 상태에서도 blink 점수가 높게 나와 기준선 근처에서 떨린다.
// 1) 사람마다 다른 '뜬 눈' 점수를 계속 따라가며(기준선), 2) 감음/뜸 기준을 다르게 둔 히스테리시스로
// 한 번 감기거나 떠지면 반대쪽 기준을 확실히 넘을 때까지 상태를 바꾸지 않는다.
// OneEuro 필터 (Casiez 2012): 천천히 움직일 땐 강하게 걸러 떨림을 없애고, 빨리 움직이면 거의 거르지 않아 늦지 않음.
// minCutoff(Hz): 가만히 있을 때 거르는 세기(낮을수록 매끈), beta: 빠를수록 차단 주파수를 얼마나 올릴지(클수록 덜 늦음)
export class OneEuro {
  constructor(minCutoff = 1, beta = 0.02, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = null;
    this.dx = 0;
  }

  filter(v, dt, scale = 1) {
    if (this.x === null || !Number.isFinite(this.x)) {
      this.x = v;
      this.dx = 0;
      return v;
    }
    const alpha = (fc) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
    this.dx += ((v - this.x) / dt - this.dx) * alpha(this.dCutoff);
    const fc = this.minCutoff * scale + this.beta * Math.abs(this.dx);
    this.x += (v - this.x) * alpha(fc);
    return this.x;
  }
}

export class BlinkDetector {
  constructor() {
    this.base = null; // 눈을 떴을 때의 점수(기준선)
    this.noise = 0.05; // 뜬 상태에서의 흔들림 크기(표준편차)
    this.closed = false;
    this.pending = 0;
    this.since = 0;
    this.hist = [];
    this.sensitivity = 0.5; // 0: 잘 안 감김 ~ 1: 잘 감김
  }

  calibrate(score) {
    this.base = score;
    this.closed = false;
    this.hist = [];
  }

  // 오프셋 보정에서 잰 '뜬 눈 / 감은 눈' 점수. 기준을 이 둘 사이에 둔다.
  setCalibration(open, closed) {
    this.cal = closed - open >= 0.08 ? { open, closed } : null;
    if (this.cal) this.base = open;
    this.closed = false;
    this.hist = [];
  }

  // 지금 기준값 (화면 표시·디버그용)
  thresholds() {
    if (this.cal) {
      const span = this.cal.closed - this.cal.open;
      let closeAt = this.base + span * (0.6 - 0.3 * this.sensitivity);
      closeAt = Math.max(closeAt, this.base + 2.6 * this.noise); // 흔들림보다는 확실히 위
      closeAt = Math.min(closeAt, this.base + span * 0.8); // 하지만 감은 눈 점수에는 항상 닿도록
      return { closeAt, openAt: this.base + (closeAt - this.base) * 0.55 };
    }
    const room = Math.max(0.15, 1 - this.base);
    const rel = this.base + room * (0.62 - 0.32 * this.sensitivity);
    const byNoise = this.base + (3.4 - 1.2 * this.sensitivity) * this.noise;
    // 흔들림이 커도 기준이 끝없이 올라가 감김을 못 잡는 일이 없도록 상한을 둔다
    const closeAt = Math.min(0.92, this.base + room * 0.75, Math.max(rel, byNoise));
    return { closeAt, openAt: this.base + (closeAt - this.base) * 0.5 };
  }

  // score: 0(뜸)~1(감음). 반환: 눈 뜬 정도 목표값 (0 또는 1)
  update(score, dt) {
    // 3프레임 중앙값: 한 프레임만 튀는 값 제거
    this.hist.push(score);
    if (this.hist.length > 3) this.hist.shift();
    const s = [...this.hist].sort((a, b) => a - b)[Math.floor(this.hist.length / 2)];
    if (this.base === null) this.base = Math.min(s, 0.4);
    let { closeAt, openAt } = this.thresholds();
    if (!this.closed && s < closeAt) {
      // 기준선: 보정했으면 조명 변화 정도만 아주 천천히 따라가고,
      // 보정 전에는 낮은 값은 빨리·높은 값은 천천히 (깜빡임에 끌려가지 않게)
      const k = this.cal
        ? 1 - Math.exp(-dt * 0.05)
        : s < this.base ? 1 - Math.exp(-dt * 4) : 1 - Math.exp(-dt * 0.15);
      this.base += (s - this.base) * k;
      const dev = s - this.base;
      this.noise = Math.sqrt(this.noise ** 2 + (dev * dev - this.noise ** 2) * (1 - Math.exp(-dt * 0.6)));
      ({ closeAt, openAt } = this.thresholds());
    }
    this.since += dt;
    if (!this.closed && s > closeAt) {
      this.pending += dt;
      if (this.pending >= 0.04) {
        this.closed = true;
        this.pending = 0;
        this.since = 0;
      }
    } else if (this.closed && s < openAt && this.since >= 0.14) {
      // 한 번 감기면 최소 0.14초는 감은 채로 — 깜빡임이 끝까지 보이게
      this.pending += dt;
      if (this.pending >= 0.04) {
        this.closed = false;
        this.pending = 0;
      }
    } else {
      this.pending = 0;
    }
    return this.closed ? 0 : 1;
  }
}
