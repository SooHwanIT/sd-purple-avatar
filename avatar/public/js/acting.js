// 표정 연기: 표정이 얼굴 그림만 바뀌면 딱딱해 보이므로, 표정 세기(ex_<이름>, 0~1)에 맞춰
// 고개·몸도 같이 살짝 움직이고(눈썹·입은 표정 그림이 따로 있어 건드리지 않음), 표정이 막 나타날 때는 한 번 톡 튀는(뾰잉) 반동을 준다.
// 트래킹·수동 값 위에 더하는 작은 양이라 내 움직임을 가리지 않는다. (app.js·시험 페이지에서 MotionLimiter 뒤에 부름)

// 표정마다: 더할 값(세기 1일 때) + 나타날 때 반동 [파라미터, 크기, 진동수(Hz), 줄어드는 빠르기(1/초), 위상]
export const ACTING = {
  smile: { add: { angleZ: 3, bodyLean: -1 },
    kick: [['angleY', 3.5, 2.4, 4.5, 0], ['bodyLean', -1.6, 2.4, 4.5, 0.6], ['talk', 0.35, 2.4, 5, 0]] },
  surprised: { add: { angleY: 4, bodyLean: -3, eyeBallX: 0, mouthNarrow: 0.55 },
    kick: [['bodyLean', -4, 1.8, 5, 0], ['angleY', 3, 2.2, 5, 0.3], ['talk', 0.6, 1.8, 4, 0]] },
  angry: { add: { angleY: -3, bodyLean: 2 },
    kick: [['angleY', -2.5, 2, 5, 0], ['bodyZ', 1.5, 2, 5, 0]] },
  shy: { add: { angleZ: 7, angleY: -4, eyeBallX: -0.35, bodyLean: 1, bodyZ: 3 },
    kick: [['angleZ', 2.5, 1.6, 4, 0], ['bodyLean', 1.2, 1.6, 4, 0.4]] },
  wink: { add: { angleZ: 4 },
    kick: [['angleZ', 2.5, 2.6, 5, 0], ['angleY', 2, 2.6, 5, 0.5]] },
  sleepy: { add: { angleY: -5, angleZ: 4, bodyLean: 2 }, kick: [] },
  laugh: { add: { angleY: 3, angleZ: 3, bodyLean: -1.5 },
    kick: [['angleY', 3, 2.4, 4.5, 0], ['talk', 0.5, 2.4, 4, 0]] },
  heart: { add: { angleZ: 5, eyeSmile: 0.2 },
    kick: [['angleY', 3, 2.2, 4.5, 0], ['angleZ', 2, 1.6, 4, 0.5], ['talk', 0.4, 2.2, 5, 0]] },
  // model_sd_purple 표정 시트 (2026-11-02): 신남·자장·멍함·당황·울먹임·대성통곡·지침·수줍음·의심·생각중·메롱
  excited: { add: { angleZ: -4, angleY: 3, bodyLean: -1 },
    kick: [['angleY', 3, 2.4, 4.5, 0], ['bodyY', 0.25, 3, 5, 0]] },
  asleep: { add: { angleY: -9, angleZ: 6, bodyLean: 2 }, kick: [] },
  blank: { add: { angleZ: 2, angleY: 1 }, kick: [] },
  shock: { add: { angleY: -2, bodyLean: -4 },
    kick: [['bodyLean', -4, 2.4, 5, 0], ['angleX', 2, 9, 6, 0], ['angleZ', -1.5, 9, 6, 0.5]] },
  teary: { add: { angleY: -3, angleZ: 2 },
    kick: [['angleY', -2, 2.4, 4, 0], ['talk', 0.4, 4.5, 3, 0]] },
  cry: { add: { angleY: -6, bodyLean: 2 },
    kick: [['angleY', -3, 2.4, 4, 0], ['talk', 0.8, 3.2, 3, 0], ['bodyZ', 1.5, 3.2, 3, 0.5]] },
  tired: { add: { angleY: -5, bodyLean: 2, shoulder: -0.5 }, kick: [['angleY', -2, 1.6, 4, 0]] },
  bashful: { add: { angleZ: 4, angleY: -4, angleX: 5, bodyZ: 2 },
    kick: [['angleZ', 2, 1.6, 4, 0]] },
  doubt: { add: { angleZ: -5, angleX: 6 }, kick: [['angleZ', -2, 2, 4.5, 0]] },
  think: { add: { angleZ: 5, angleY: 3, angleX: -4 }, kick: [['angleY', 2, 1.8, 4, 0]] },
  pout: { add: { angleX: -9, angleZ: 5, bodyYaw: -3, eyeBallX: 0.55 },
    kick: [['angleX', -4, 2, 4.5, 0], ['angleZ', 2, 1.8, 4, 0.4]] },
  // 손 파츠 시트 포즈: 작은 고개·몸 연기만 (팔은 표정 param 의 IK 가)
  point: { add: { angleX: -6, angleZ: -3 }, kick: [['angleY', 2, 2.4, 4.5, 0]] },
  vsign: { add: { angleZ: 7, angleY: 2 }, kick: [['angleZ', 2.5, 2, 4.5, 0], ['bodyY', 0.15, 3, 5, 0]] },
  fingerheart: { add: { angleZ: 5, angleY: 1 }, kick: [['angleZ', 2, 1.8, 4, 0], ['angleY', 2, 2.4, 4.5, 0.3]] },
  grab: { add: { angleY: -3, bodyLean: 2, angleZ: -3 }, kick: [['angleX', 1.5, 8, 6, 0]] },
  surprisehands: { add: { angleY: 3, bodyLean: -3 }, kick: [['bodyLean', -3, 2.4, 5, 0], ['angleY', 2, 2.2, 5, 0.3]] },
  handsup: { add: { angleY: 5, angleZ: 2, bodyLean: -2 }, kick: [['bodyY', 0.35, 3, 4, 0], ['angleY', 3, 2.4, 4.5, 0.2]] },
  fists: { add: { angleY: -2, bodyLean: 1 }, kick: [['bodyZ', 1.5, 2.2, 5, 0]] },
  openhands: { add: { angleZ: 3 }, kick: [['angleZ', 2, 1.8, 4, 0]] },
  bleh: { add: { angleZ: -6, angleY: -2, bodyZ: -2 },
    kick: [['angleZ', -3, 2.4, 4.5, 0], ['angleY', -2, 2.4, 4.5, 0.3]] },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LIMITS = { brow: [-1, 1], mouthForm: [-1, 1], eyeBallX: [-1, 1], talk: [0, 1.5], mouthNarrow: [0, 1], bodyY: [-1, 1] };

export class ExpressionActing {
  constructor(table = ACTING, profile = null) {
    this.table = table;
    this.profile = profile;
    this.prev = {};
    this.kicks = [];
    this.strength = 1; // 연기 세기 (0 이면 끔)
  }

  apply(P, dt) {
    const s = this.strength;
    if (s <= 0) return P;
    for (const [name, def] of Object.entries(this.table)) {
      const w = clamp(P[`ex_${name}`] ?? 0, 0, 1);
      // 막 나타날 때(0.25 를 넘어 올라갈 때) 반동 한 번
      if (w > 0.25 && (this.prev[name] ?? 0) <= 0.25) for (const k of def.kick) this.kicks.push({ k, t: 0 });
      this.prev[name] = w;
      if (w <= 0.001) continue;
      for (const [key, v] of Object.entries(def.add)) {
        // 눈동자: 표정이 시선을 정하는 정도(섞기), 나머지는 더하기
        if (key === 'eyeBallX') P[key] = (P[key] ?? 0) * (1 - 0.5 * w) + v * w * s;
        else P[key] = (P[key] ?? 0) + v * w * s;
      }
    }
    this.kicks = this.kicks.filter((it) => {
      it.t += dt;
      const [key, amp, f, decay, ph] = it.k;
      const e = Math.exp(-decay * it.t);
      if (e < 0.01) return false;
      const u = Math.min(1, it.t / .085);
      const rise = this.profile ? u * u * u * (u * (u * 6 - 15) + 10) : 1 - Math.exp(-25 * it.t);
      P[key] = (P[key] ?? 0) + amp * s * Math.sin(2 * Math.PI * f * it.t + ph) * e * rise;
      return true;
    });
    for (const [key, [a, b]] of Object.entries(LIMITS)) if (key in P) P[key] = clamp(P[key], a, b);
    return P;
  }
}
