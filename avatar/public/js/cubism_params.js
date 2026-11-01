// 앱 파라미터(트래킹·마이크·표정·자동 동작) → Cubism 모델 파라미터.
// 1) Live2D 표준 이름 (ParamAngleX …)
// 2) 퍼펙트 싱크: 얼굴 값 52개(ARKit 이름)를 그대로 — 모델 파라미터 ID 가 `eyeBlinkLeft`, `ParamEyeBlinkLeft`, `PS_eyeBlinkLeft` 중 하나면 0~1 값을 넣는다
// 3) VBridger 식 이름 (ParamMouthX, ParamJawOpen, ParamMouthFunnel, ParamMouthPuckerWiden, ParamMouthPressLipOpen …)
// 4) 모델마다 model.json rig.params 로 덧붙이거나 바꿈: { "ParamArmRA": { "from": "armR", "in": [-15, 40], "out": [-10, 10] } }
// 좌우: 트래커가 이미 캐릭터 기준으로 바꿔 둔다 (bs_eyeBlinkLeft = 캐릭터의 왼눈)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 얼굴 값 52개. 웹캠(MediaPipe)은 tongueOut 을 주지 않는다 (아이폰 ARKit 은 줌)
export const ARKIT = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel',
  'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker',
  'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
];

const bs = (P, n) => P[`bs_${n}`] ?? 0;
const avg = (P, a, b) => (bs(P, a) + bs(P, b)) / 2;
const side = (P, k, s) => P[`${k}${s}`] ?? P[k] ?? 0;

// [Cubism ID, 값 함수]. 함수가 undefined 를 돌려주면 그 프레임은 기본값 그대로
const RULES = [
  // 머리·몸 (각도는 앱과 같은 도 단위, 방향도 같음: X + = 화면 오른쪽, Y + = 위, Z + = 시계 방향)
  ['ParamAngleX', (P) => P.angleX],
  ['ParamAngleY', (P) => P.angleY],
  ['ParamAngleZ', (P) => P.angleZ],
  ['ParamBodyAngleX', (P) => P.bodyYaw],
  ['ParamBodyAngleY', (P) => -(P.bodyLean ?? 0)], // 앱 + = 숙이기, Cubism + = 상체가 위로(젖힘)
  ['ParamBodyAngleZ', (P) => P.bodyZ],
  ['ParamBodyX', (P) => P.bodyX],
  ['ParamBreath', (P) => P.breath],
  // 눈
  ['ParamEyeLOpen', (P) => P.eyeOpenL],
  ['ParamEyeROpen', (P) => P.eyeOpenR],
  ['ParamEyeLSmile', (P) => Math.max(P.eyeSmile ?? 0, side(P, 'eyeSmile', 'L'))],
  ['ParamEyeRSmile', (P) => Math.max(P.eyeSmile ?? 0, side(P, 'eyeSmile', 'R'))],
  ['ParamEyeBallX', (P) => P.eyeBallX],
  ['ParamEyeBallY', (P) => P.eyeBallY],
  ['ParamEyeBallForm', (P) => P.pupil], // - = 동공 작게 (놀람)
  ['ParamEyeLSquint', (P) => P.eyeSquintL],
  ['ParamEyeRSquint', (P) => P.eyeSquintR],
  ['ParamEyeSquintL', (P) => P.eyeSquintL],
  ['ParamEyeSquintR', (P) => P.eyeSquintR],
  ['ParamEyeLWiden', (P) => Math.max(P.eyeWiden ?? 0, bs(P, 'eyeWideLeft'))],
  ['ParamEyeRWiden', (P) => Math.max(P.eyeWiden ?? 0, bs(P, 'eyeWideRight'))],
  // 눈썹 (Angle + = 안쪽 끝이 올라감(곤란), Form + = 둥글게)
  ['ParamBrowLY', (P) => side(P, 'brow', 'L')],
  ['ParamBrowRY', (P) => side(P, 'brow', 'R')],
  ['ParamBrowLAngle', (P) => P.browTiltL],
  ['ParamBrowRAngle', (P) => P.browTiltR],
  ['ParamBrowLForm', (P) => P.browArch],
  ['ParamBrowRForm', (P) => P.browArch],
  ['ParamBrowInnerUp', (P) => bs(P, 'browInnerUp')],
  // 입
  ['ParamMouthOpenY', (P) => P.mouthOpen],
  ['ParamJawOpen', (P) => P.jawOpen ?? P.mouthOpen],
  ['ParamMouthForm', (P) => P.mouthForm],
  ['ParamMouthFormL', (P) => P.mouthFormL ?? P.mouthForm],
  ['ParamMouthFormR', (P) => P.mouthFormR ?? P.mouthForm],
  ['ParamMouthX', (P) => P.mouthX],
  ['ParamJawX', (P) => P.jawX],
  ['ParamMouthFunnel', (P) => Math.max(bs(P, 'mouthFunnel'), (P.mouthNarrow ?? 0) * 0.6)],
  ['ParamMouthPuckerWiden', (P) => clamp((P.mouthWide ?? 0) - Math.max(bs(P, 'mouthPucker'), P.mouthNarrow ?? 0), -1, 1)],
  ['ParamMouthPressLipOpen', (P) => clamp(
    (avg(P, 'mouthUpperUpLeft', 'mouthUpperUpRight') + avg(P, 'mouthLowerDownLeft', 'mouthLowerDownRight')) / 2 -
      avg(P, 'mouthPressLeft', 'mouthPressRight') - (bs(P, 'mouthRollLower') + bs(P, 'mouthRollUpper')) / 2, -1, 1)],
  ['ParamMouthShrug', (P) => (bs(P, 'mouthShrugUpper') + bs(P, 'mouthShrugLower')) / 2],
  ['ParamMouthNarrow', (P) => P.mouthNarrow],
  ['ParamMouthWide', (P) => P.mouthWide],
  ['ParamMouthUpperUp', (P) => P.upperUp],
  ['ParamTongueOut', (P) => bs(P, 'tongueOut')],
  ['ParamCheekPuffC', (P) => P.cheekPuff],
  ['ParamCheekPuff', (P) => P.cheekPuff],
  ['ParamCheekSquint', (P) => P.cheekSquint],
  ['ParamNoseSneer', (P) => P.noseSneer],
  // 팔: 기본 범위가 다르면 model.json rig.params 로 바꿈
  ['ParamArmR', (P) => P.armR],
  ['ParamArmL', (P) => P.armL],
  // 큰 반응 (reactions.js): 어깨·몸 위아래, 표정 효과 그림. 빠른 막대 '눈 효과'(fxHeartEyes·fxBlank·tear)도 같은 그림으로
  ['ParamShoulderY', (P) => P.shoulder],
  ['ParamBodyY', (P) => P.bodyY],
  ['ParamCheek', (P) => P.blush],
  ['ParamTear', (P) => P.tear],
  ['ParamSweat', (P) => P.sweat],
  ['ParamGloom', (P) => P.gloom],
  ['ParamAngerMark', (P) => P.anger],
  ['ParamHeartEyes', (P) => Math.max(P.heartEyes ?? 0, P.fxHeartEyes ?? 0)],
  ['ParamEyeCover', (P) => Math.max(P.blankEyes ?? 0, P.fxBlank ?? 0, P.heartEyes ?? 0, P.fxHeartEyes ?? 0)],
];

// core: Live2DCubismCore.Model, custom: model.json rig.params
export function buildParamMap(core, custom = {}) {
  const ids = core.parameters.ids;
  const index = new Map(ids.map((id, i) => [id, i]));
  const rules = new Map();
  for (const [id, f] of RULES) if (index.has(id)) rules.set(id, f);
  // 퍼펙트 싱크: ARKit 이름 그대로 쓰는 모델
  const ps = [];
  for (const n of ARKIT) {
    const cap = n[0].toUpperCase() + n.slice(1);
    for (const id of [n, `Param${cap}`, `PS_${n}`]) {
      if (index.has(id) && !rules.has(id)) {
        rules.set(id, (P) => P[`bs_${n}`]);
        ps.push(id);
      }
    }
  }
  for (const [id, def] of Object.entries(custom ?? {})) {
    if (!index.has(id)) continue;
    if (def === null) {
      rules.delete(id);
      continue;
    }
    const d = typeof def === 'string' ? { from: def } : def;
    const [i0, i1] = d.in ?? [0, 1];
    const [o0, o1] = d.out ?? d.in ?? [0, 1];
    const scale = d.scale ?? 1;
    rules.set(id, (P) => {
      const v = P[d.from];
      if (v === undefined) return undefined;
      return d.in ? o0 + ((v - i0) / (i1 - i0 || 1)) * (o1 - o0) : v * scale + (d.offset ?? 0);
    });
  }
  const list = [...rules].map(([id, f]) => [index.get(id), f, id]);
  const min = core.parameters.minimumValues;
  const max = core.parameters.maximumValues;
  return {
    mapped: list.map(([, , id]) => id),
    perfectSync: ps,
    // P 의 값을 values(Float32Array) 에 넣는다 (범위 밖은 자름)
    apply(P, values) {
      for (const [i, f] of list) {
        const v = f(P);
        if (v === undefined || v === null || !Number.isFinite(v)) continue;
        values[i] = clamp(v, min[i], max[i]);
      }
    },
  };
}
