// 큰 반응: 몇 초짜리 짧은 연기 한 편 — 몸·고개·어깨·표정 효과가 크게 움직였다가 제자리로 돌아온다.
// (VTube Studio 의 단축키 애니메이션 자리. 표정 연기(acting.js)는 표정이 켜져 있는 동안의 작은 자세, 이것은 한 번 하고 끝나는 큰 동작)
// 트래킹·수동 값 위에 '더하므로' 그동안에도 내 움직임은 그대로 살아 있다. 얼굴 표정(expr)은 app.js 가 같은 시간 동안 잠깐 바꾼다.
// 반응: { label, expr?: [표정 이름 후보…], dur(초), in·out(나타남·사라짐 초), play(t, e, P) } — t = 지난 시간, e = 무게(0~1, 세기 포함)
// 반응이 쓰는 앱 값: shoulder(+ 으쓱, − 처짐), bodyY(+ 뜀, − 무릎), blush·tear(0.5 고임, 1 흐름)·sweat·gloom·anger·heartEyes·blankEyes (0~1)
//   — 모델에 그 파라미터가 없으면 그냥 무시된다 (v10 전신 Cubism 은 모두 있음)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const wave = (t, hz, ph = 0) => Math.sin(2 * Math.PI * hz * t + ph);
const up = (t, hz, ph = 0) => 0.5 + 0.5 * wave(t, hz, ph); // 0~1 로 오르내림
// t0 를 가운데로 폭 w 동안 0 → 1 → 0
const bump = (t, t0, w) => (Math.abs(t - t0) >= w / 2 ? 0 : 0.5 + 0.5 * Math.cos((2 * Math.PI * (t - t0)) / w));
const add = (P, k, v) => (P[k] = (P[k] ?? 0) + v);
const atLeast = (P, k, v) => (P[k] = Math.max(P[k] ?? 0, v));
const closeEyes = (P, k) => {
  P.eyeOpenL = (P.eyeOpenL ?? 1) * (1 - k);
  P.eyeOpenR = (P.eyeOpenR ?? 1) * (1 - k);
};

// 손 흔들기: side 'R' = 화면 왼쪽 손. 얼굴 옆 (x, y — 머리 반지름 단위, 얼굴을 가리지 않는 자리)을 손의 목표로 두고 손목을 축으로 흔든다 (rot°).
// 소매가 있는 모델(SD)은 팔(소매)이 어깨에서 그쪽으로 올라가고 손은 소매 끝에, 없는 모델은 손만 떠서 간다 (effects.js).
// 목표가 좌우로 조금 오가서(swing) 팔도 같이 흔들린다. 손이 다 올라온 뒤(0.25초)부터 흔들기 시작
function waveHand(P, t, e, side, { x, y, hz, swing, rot }) {
  const k = `hand${side}`;
  const go = smooth((t - 0.2) / 0.25);
  const w = wave(Math.max(0, t - 0.2), hz) * go;
  P[`${k}W`] = Math.max(P[`${k}W`] ?? 0, e);
  const tx = x + swing * w;
  P[`${k}X`] = (P[`${k}X`] ?? tx) + (tx - (P[`${k}X`] ?? tx)) * e;
  P[`${k}Y`] = (P[`${k}Y`] ?? y) + (y - (P[`${k}Y`] ?? y)) * e;
  P[`${k}Rot`] = (P[`${k}Rot`] ?? 0) * (1 - e) + rot * w * e;
}

export const REACTIONS = {
  laugh: {
    label: '크게 웃기', expr: ['laugh', 'smile'], dur: 3.4, in: 0.35, out: 0.9,
    play(t, e, P) {
      add(P, 'bodyLean', -6 * e); // 젖히며
      add(P, 'angleY', 8 * e + 2.5 * e * wave(t, 2.4));
      add(P, 'angleZ', 5 * e);
      add(P, 'bodyZ', 2 * e * wave(t, 0.55));
      add(P, 'shoulder', e * (0.25 + 0.3 * up(t, 2.4, 0.4))); // 어깨가 들썩
      add(P, 'bodyY', -0.25 * e * up(t, 2.4, 1));
      atLeast(P, 'mouthOpen', e * (0.45 + 0.35 * up(t, 4.8))); // 하하하
      add(P, 'blush', 0.35 * e);
    },
  },
  surprised: {
    label: '깜짝', expr: ['surprised'], dur: 1.8, in: 0.06, out: 0.7,
    play(t, e, P, s) {
      // 펄쩍: 0.12초에 가장 높이 → 0.38초에 내려앉고 → 무릎이 살짝 굽었다 제자리
      const hop = t < 0.12 ? smooth(t / 0.12) : t < 0.38 ? 1 - smooth((t - 0.12) / 0.26) : -0.25 * Math.sin(Math.PI * clamp((t - 0.38) / 0.4, 0, 1));
      add(P, 'bodyY', 0.8 * hop * s);
      add(P, 'shoulder', e * (0.9 - 0.5 * smooth((t - 0.3) / 0.8)));
      add(P, 'bodyLean', -4 * e);
      add(P, 'angleY', 7 * e);
      // 몸이 움찔 → 머리카락·옷자락이 크게 흔들림
      const jolt = Math.exp(-4 * t) * wave(t, 2.2) * s;
      add(P, 'bodyZ', -4 * jolt);
      add(P, 'angleX', 6 * jolt);
    },
  },
  sad: {
    label: '시무룩', expr: ['sad'], dur: 4.5, in: 0.8, out: 1.2,
    play(t, e, P) {
      add(P, 'shoulder', -0.8 * e);
      add(P, 'bodyLean', 3 * e);
      add(P, 'angleY', -13 * e);
      add(P, 'angleZ', 4 * e);
      add(P, 'eyeBallY', -0.35 * e);
      add(P, 'bodyY', -0.15 * e);
      add(P, 'gloom', 0.85 * e);
      add(P, 'tear', 0.5 * e); // 눈물이 고임 (흐르지는 않음)
    },
  },
  angry: {
    label: '흥!', expr: ['angry', 'annoyed'], dur: 2.4, in: 0.15, out: 0.7,
    play(t, e, P) {
      add(P, 'angleX', 18 * e); // 고개를 홱 돌리고
      add(P, 'angleY', 6 * e);
      add(P, 'angleZ', -5 * e);
      add(P, 'bodyYaw', 4 * e);
      add(P, 'shoulder', e * (0.2 + 0.7 * bump(t, 0.18, 0.4)));
      closeEyes(P, 0.85 * e * smooth((t - 0.08) / 0.15));
      add(P, 'anger', e * smooth(t / 0.35)); // 화남 표시가 뿅
    },
  },
  shy: {
    label: '부끄럼', expr: ['shy', 'smile'], dur: 3.6, in: 0.5, out: 1.0,
    play(t, e, P) {
      add(P, 'blush', e);
      add(P, 'shoulder', 0.45 * e); // 움츠림
      add(P, 'angleZ', 9 * e);
      add(P, 'angleY', -8 * e);
      add(P, 'angleX', -9 * e);
      add(P, 'eyeBallX', -0.55 * e); // 눈을 피함
      add(P, 'eyeBallY', -0.25 * e);
      add(P, 'bodyZ', 2.5 * e * wave(t, 0.45));
      add(P, 'bodyLean', 1.5 * e);
    },
  },
  nod: {
    label: '끄덕끄덕', dur: 1.4, in: 0.1, out: 0.3,
    play(t, e, P) {
      const d = Math.max(0, wave(t, 1.6)) ** 1.5; // 두 번 끄덕
      add(P, 'angleY', -12 * d * e);
      add(P, 'bodyLean', 1.2 * d * e);
      closeEyes(P, 0.3 * d * e);
    },
  },
  shake: {
    label: '도리도리', dur: 1.6, in: 0.1, out: 0.4,
    play(t, e, P) {
      add(P, 'angleX', 14 * e * wave(t, 2.6));
      add(P, 'bodyYaw', -2.5 * e * wave(t, 2.6));
      add(P, 'angleY', -3 * e);
    },
  },
  fluster: {
    label: '당황', dur: 2.8, in: 0.2, out: 0.8,
    play(t, e, P) {
      add(P, 'sweat', e * smooth(t / 0.9)); // 땀방울이 나타나 흘러내림
      atLeast(P, 'eyeWiden', 0.5 * e);
      add(P, 'angleX', 5 * e * wave(t, 4));
      add(P, 'shoulder', 0.35 * e);
      add(P, 'mouthForm', -0.3 * e);
      add(P, 'browTiltL', 0.5 * e);
      add(P, 'browTiltR', 0.5 * e);
      add(P, 'blush', 0.2 * e);
    },
  },
  bow: {
    label: '인사', dur: 2.8, in: 0.55, out: 0.8,
    play(t, e, P) {
      add(P, 'bodyLean', 10 * e);
      add(P, 'angleY', -24 * e);
      add(P, 'shoulder', -0.25 * e);
      add(P, 'bodyY', -0.35 * e);
      closeEyes(P, 0.85 * e);
      atLeast(P, 'eyeSmile', 0.6 * e);
      add(P, 'mouthForm', 0.35 * e);
    },
  },
  shrug: {
    label: '으쓱', dur: 2.2, in: 0.3, out: 0.7,
    play(t, e, P) {
      add(P, 'shoulder', e);
      add(P, 'armR', 14 * e); // 팔을 조금 벌리고 아래팔을 듦
      add(P, 'armL', 14 * e);
      add(P, 'elbowR', 45 * e);
      add(P, 'elbowL', 45 * e);
      add(P, 'angleZ', 8 * e);
      add(P, 'angleX', 5 * e);
      add(P, 'angleY', -2 * e);
      add(P, 'brow', 0.5 * e);
      closeEyes(P, 0.3 * e);
      add(P, 'mouthForm', -0.25 * e);
    },
  },
  shock: {
    label: '충격', expr: ['surprised'], dur: 3.4, in: 0.08, out: 1.0,
    play(t, e, P) {
      const drop = smooth((t - 0.4) / 1.0); // 굳었다가 → 털썩
      add(P, 'blankEyes', e);
      add(P, 'gloom', e * smooth(t / 0.6));
      add(P, 'shoulder', e * (0.9 - 1.5 * drop));
      add(P, 'bodyLean', e * (-3 + 6 * drop));
      add(P, 'angleY', e * (6 * (1 - drop) - 8 * drop));
      add(P, 'angleX', 1.5 * e * wave(t, 9)); // 부들부들
      add(P, 'bodyZ', 0.8 * e * wave(t, 9, 1));
    },
  },
  // 아하 (시청자 '아 하이'): 화면 왼쪽 손이 몸에서 떨어져 뺨 옆으로 올라와 빠르게 흔들고, '아하~' 말풍선
  hello: {
    label: '아하 (손 인사)', cmd: '아하', expr: ['smile'], dur: 2.8, in: 0.3, out: 0.6,
    play(t, e, P) {
      waveHand(P, t, e, 'R', { x: -1.5, y: 0.75, hz: 2.2, swing: 0.06, rot: 22 });
      add(P, 'angleY', -7 * e * bump(t, 0.45, 0.7)); // 꾸벅
      add(P, 'angleZ', -5 * e);
      add(P, 'bodyZ', 2 * e * wave(t, 0.7));
      atLeast(P, 'mouthOpen', 0.4 * e * bump(t, 0.35, 0.45)); // "아하"
      add(P, 'mouthForm', 0.4 * e);
      if (t < 1.4) atLeast(P, 'sayHi', 1);
    },
  },
  // 아바 (시청자 '아 바이'): 손을 크게 천천히 흔들며 '아바~'
  bye: {
    label: '아바 (손 흔들기)', cmd: '아바', expr: ['smile'], dur: 3.2, in: 0.3, out: 0.8,
    play(t, e, P) {
      waveHand(P, t, e, 'R', { x: -1.55, y: 0.68, hz: 1.5, swing: 0.14, rot: 28 });
      add(P, 'angleZ', 6 * e * wave(t, 0.85));
      add(P, 'bodyZ', 2.5 * e * wave(t, 0.85, 0.4));
      add(P, 'angleY', 3 * e);
      atLeast(P, 'mouthOpen', 0.3 * e * (bump(t, 0.4, 0.35) + bump(t, 0.85, 0.35))); // "아바"
      add(P, 'mouthForm', 0.45 * e);
      if (t < 1.4) atLeast(P, 'sayBye', 1);
    },
  },
  love: {
    label: '반함', expr: ['heart', 'smile'], dur: 3.4, in: 0.25, out: 0.9,
    play(t, e, P, s) {
      add(P, 'heartEyes', e);
      add(P, 'blush', 0.8 * e);
      add(P, 'angleZ', 6 * e * wave(t, 0.55));
      add(P, 'bodyZ', 3 * e * wave(t, 0.55, 0.5));
      add(P, 'shoulder', 0.3 * e);
      add(P, 'bodyY', 0.5 * bump(t, 0.18, 0.36) * s);
      add(P, 'mouthForm', 0.5 * e);
    },
  },
};

const LIMITS = {
  shoulder: [-1, 1], bodyY: [-1, 1], blush: [0, 1], tear: [0, 1], sweat: [0, 1], gloom: [0, 1], anger: [0, 1],
  heartEyes: [0, 1], blankEyes: [0, 1], mouthOpen: [0, 1], handRW: [0, 1], handLW: [0, 1], sayHi: [0, 1], sayBye: [0, 1], mouthForm: [-1, 1], eyeBallX: [-1, 1], eyeBallY: [-1, 1],
  brow: [-1, 1], browTiltL: [-1, 1], browTiltR: [-1, 1], eyeWiden: [0, 1], eyeSmile: [0, 1],
};

// 반응 재생기: play(이름) 으로 시작, 매 프레임 apply(P, dt). 새 반응이 오면 하던 것은 0.3초 동안 사라진다
export class ReactionPlayer {
  constructor(table = REACTIONS) {
    this.table = table;
    this.list = []; // { name, def, t, kill }
    this.strength = 1;
  }

  play(name) {
    const def = this.table[name];
    if (!def) return null;
    for (const r of this.list) r.kill ??= r.t;
    this.list.push({ name, def, t: 0, kill: null });
    return def;
  }

  get current() {
    return this.list.find((r) => r.kill === null)?.name ?? null;
  }

  apply(P, dt) {
    if (!this.list.length) return P;
    const s = this.strength;
    for (const r of this.list) r.t += dt;
    this.list = this.list.filter((r) => r.t < r.def.dur && (r.kill === null || r.t - r.kill < 0.3));
    for (const r of this.list) {
      const { dur, in: a = 0.25, out: o = 0.6 } = r.def;
      const fade = r.kill === null ? 1 : 1 - smooth((r.t - r.kill) / 0.3);
      const e = smooth(r.t / a) * (1 - smooth((r.t - (dur - o)) / o)) * fade;
      r.def.play(r.t, e * s, P, s * fade); // 넷째 값: 나타남 없이 바로 쓰는 세기 (펄쩍 같은 빠른 동작)
    }
    for (const [k, [a, b]] of Object.entries(LIMITS)) if (k in P) P[k] = clamp(P[k], a, b);
    return P;
  }
}
