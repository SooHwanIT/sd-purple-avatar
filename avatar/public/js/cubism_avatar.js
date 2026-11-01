// Cubism(.moc3) 모델 런타임. 변형 계산은 공식 Cubism Core 가 하고, 그리기는 앱 렌더러(WebGL2)에 직접 한다.
// 그래서 배경·조명 합성·효과·OBS 중계·확대 보기 같은 앱 기능을 파츠 모델과 똑같이 쓴다.
// model.json: { "type": "cubism", "model3": "<이름>.model3.json", "rig": { head?, expressions, accessories, params, faceProfile } }
//  - bounds·rig.head 가 없으면 불러올 때 그림에서 잰다 (머리 = 'Face' 파츠 아래 그림들)
//  - rig.expressions[이름] = { label, key, params: { ParamX: 값 } (덮어쓰기), add: { … } (더하기), exp3: '이름' }
//  - rig.accessories[] = { toggle, label, slot, param } — 켜면 param 을 1 로
import { DEFAULT_TUNING, PARAMS } from './rig.js';
import { facePose } from './face_performance.js';
import { CubismPhysics } from './cubism_physics.js';
import { buildParamMap } from './cubism_params.js';

const CORE_SRC = new URL('../vendor/cubism/live2dcubismcore.min.js', import.meta.url).href;
// 얼굴 가로 반지름(모델 px). 파츠 모델 v7 의 얼굴과 같은 크기 (v7 Cubism 얼굴 658px × 파츠 배율 0.2716)
const FACE_RX = 178.7;
let corePromise = null;

// Cubism Core 를 한 번만 불러온다. Core 의 WebAssembly 는 비동기로 준비되므로 실제로 불릴 때까지 기다림
export function loadCubismCore() {
  corePromise ??= new Promise((resolve, reject) => {
    const ready = () => {
      const t0 = performance.now();
      const poll = () => {
        try {
          if (Live2DCubismCore.Version.csmGetVersion()) return resolve(Live2DCubismCore);
        } catch {
          /* 아직 준비 중 */
        }
        if (performance.now() - t0 > 10000) reject(new Error('Cubism Core 를 준비하지 못했습니다'));
        else setTimeout(poll, 10);
      };
      poll();
    };
    if (globalThis.Live2DCubismCore) return ready();
    const s = document.createElement('script');
    s.src = CORE_SRC;
    s.onload = ready;
    s.onerror = () => reject(new Error('Cubism Core 파일을 불러오지 못했습니다'));
    document.head.append(s);
  });
  return corePromise;
}

const VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec2 a_rest; // 기본 자세의 자리 (그늘의 면 방향을 정하는 데)
uniform vec4 u_view;   // 모델 px → 클립 좌표 (렌더러와 같음)
uniform vec3 u_canvas; // Cubism 단위 → 모델 px: 단위당 px, 원점 x, 원점 y (모델 배율을 곱한 값)
out vec2 v_uv;
out vec2 v_rest;
void main() {
  vec2 p = vec2(a_pos.x * u_canvas.x + u_canvas.y, u_canvas.z - a_pos.y * u_canvas.x);
  v_rest = vec2(a_rest.x * u_canvas.x + u_canvas.y, u_canvas.z - a_rest.y * u_canvas.x);
  v_uv = vec2(a_uv.x, 1.0 - a_uv.y);
  gl_Position = vec4(p.x * u_view.x + u_view.z, p.y * u_view.y + u_view.w, 0.0, 1.0);
}`;

// 미리 곱한 알파. 곱하기·스크린 색은 Cubism 공식 셰이더와 같은 식
// 움직이는 그늘: 그림의 기본 자리로 머리(타원체)·몸(원기둥) 위의 면 방향을 정하고, 지금 고개·몸 각도만큼 돌린 뒤
//  배경 조명 방향과의 각으로 밝기를 바꾼다 (반 램버트). 고개를 돌리면 빛을 받는 쪽·그늘진 쪽이 따라 바뀐다
const FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec2 v_rest;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform vec2 u_maskPx;
uniform int u_maskMode; // 0 없음, 1 마스크 안쪽만, 2 마스크 바깥만(반전)
uniform vec3 u_mul;
uniform vec3 u_scr;
uniform float u_opacity;
uniform int u_kind;     // 0 그늘 없음, 1 타원체(얼굴·머리), 2 세로 원기둥(목·몸)
uniform vec4 u_shape;   // 중심 x, y, 반지름 x, y (모델 px)
uniform mat3 u_rot;     // 기본 자세 → 지금 자세 (y 위쪽 좌표)
uniform vec3 u_light;   // 빛이 오는 쪽 (y 위쪽, z 화면 앞)
uniform float u_shade;  // 그늘 세기 (0 이면 끔)
uniform vec3 u_tint;    // 그늘진 쪽 색 (회색 대신 배경의 어두운 쪽 빛깔, 다 그늘일 때 곱하는 값)
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  if (u_kind > 0 && u_shade > 0.0) {
    vec2 q = (v_rest - u_shape.xy) / u_shape.zw;
    q.y = -q.y;
    vec3 n;
    if (u_kind == 1) {
      float r2 = dot(q, q);
      n = r2 < 1.0 ? vec3(q, sqrt(1.0 - r2)) : vec3(q / sqrt(r2), 0.0);
    } else {
      n = abs(q.x) < 1.0 ? vec3(q.x, 0.0, sqrt(1.0 - q.x * q.x)) : vec3(sign(q.x), 0.0, 0.0);
    }
    // 정면 쪽은 거의 그대로 두고 빛 반대쪽(가장자리)만 그늘, 빛 쪽 끝에 약한 밝음
    float d = 0.5 + 0.5 * dot(normalize(u_rot * n), u_light);
    float dark = 1.0 - smoothstep(0.12, 0.72, d);
    c.rgb *= mix(vec3(1.0), u_tint, dark) * (1.0 + u_shade * 0.3 * smoothstep(0.82, 1.0, d));
    c.rgb = min(c.rgb, vec3(c.a));
  }
  c.rgb *= u_mul;
  c.rgb = c.rgb + u_scr * c.a - c.rgb * u_scr;
  c *= u_opacity;
  if (u_maskMode > 0) {
    float m = texture(u_mask, gl_FragCoord.xy * u_maskPx).a;
    c *= u_maskMode == 2 ? 1.0 - m : m;
  }
  outColor = c;
}`;

const MASK_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main() {
  outColor = vec4(0.0, 0.0, 0.0, texture(u_tex, v_uv).a);
}`;

function program(gl, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = (n) => gl.getUniformLocation(p, n);
  return {
    p, view: u('u_view'), canvas: u('u_canvas'), tex: u('u_tex'), mask: u('u_mask'), maskPx: u('u_maskPx'),
    maskMode: u('u_maskMode'), mul: u('u_mul'), scr: u('u_scr'), opacity: u('u_opacity'),
    kind: u('u_kind'), shape: u('u_shape'), rot: u('u_rot'), light: u('u_light'), shade: u('u_shade'), tint: u('u_tint'),
  };
}

// 고개·몸 각도(도) → 면 방향 회전 (y 위쪽 좌표, 열 우선 mat3). 좌우(yaw) + = 화면 오른쪽을 봄, 위아래(pitch) + = 위를 봄, 기울기(roll) + = 반시계
function rotation(yaw, pitch, roll) {
  const [a, b, c] = [yaw, pitch, roll].map((v) => (v * Math.PI) / 180);
  const Ry = [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
  const Rx = [1, 0, 0, 0, Math.cos(b), -Math.sin(b), 0, Math.sin(b), Math.cos(b)];
  const Rz = [Math.cos(c), Math.sin(c), 0, -Math.sin(c), Math.cos(c), 0, 0, 0, 1];
  const mul = (A, B) => {
    const o = new Array(9).fill(0);
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) for (let k = 0; k < 3; k++) o[col * 3 + row] += A[k * 3 + row] * B[col * 3 + k];
    return o;
  };
  return new Float32Array(mul(Rz, mul(Ry, Rx)));
}

// 그림 → 그늘 모양: 가장 가까운 파츠 이름으로. 맞는 게 없으면 머리 높이로 (머리 위 = 머리, 아래 = 몸)
const SHADE_GROUPS = [
  ['face', /^(Face|Eyes|Mouth|Nose|Brows|Brow(_[LR])?|Eye_[LR]|Iris_[LR])$/],
  ['head', /^(Hair.*|Front_.*|Side_.*|Back_.*|Ears|Earring.*|Head)$/],
  ['neck', /^Neck$/],
  ['body', /^(Body|Jacket|Lining|Shirt|Necklace|Accessory|Arm.*|Hand.*|Cloth.*)$/],
];
const SHADE_SKIP = /HL\d*$|_HL|Highlight|Blush|Iris_.*_Pupil/i;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`그림을 불러오지 못했습니다: ${url}`));
    img.src = url;
  });
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} 을(를) 불러오지 못했습니다 (${r.status})`);
  return r.json();
}

// Core 상수 비트 (Live2DCubismCore.Utils 와 같음)
const BLEND_ADD = 1;
const BLEND_MUL = 2;
const DOUBLE_SIDED = 4;
const INVERTED_MASK = 8;
const VISIBLE = 1;
const POS_CHANGED = 32;

export class CubismAvatar {
  constructor(renderer, model, tuning = {}) {
    this.r = renderer;
    this.model = model;
    this.rig = model.rig ?? (model.rig = {});
    this.t = { ...DEFAULT_TUNING, ...tuning };
    this.parts = []; // 레이어 목록 (스튜디오 레이어 탭): Cubism 파츠
    this.hidden = new Set();
    this.time = 0;
    this.expressions = this.rig.expressions ?? {};
    for (const [name, ex] of Object.entries(this.expressions)) {
      PARAMS[`ex_${name}`] = { min: 0, max: 1, def: 0, label: `표정: ${ex.label}` };
    }
    this.item = { draw: (view) => this.draw(view), opacity: 1 };
  }

  async load(base) {
    const Core = await loadCubismCore();
    const m3url = new URL(`${base}/${this.model.model3}`, location.href).href;
    const m3 = await fetchJson(m3url);
    const at = (f) => new URL(f, m3url).href;
    const refs = m3.FileReferences;
    const mocBuf = await (await fetch(at(refs.Moc))).arrayBuffer();
    const moc = Core.Moc.fromArrayBuffer(mocBuf);
    if (!moc) throw new Error('moc3 파일을 읽지 못했습니다 (Cubism Core 보다 새 버전일 수 있음)');
    this.core = Core.Model.fromMoc(moc);
    const core = this.core;
    const ci = core.canvasinfo;
    this.canvas = { ppu: ci.PixelsPerUnit, ox: ci.CanvasOriginX, oy: ci.CanvasOriginY, w: ci.CanvasWidth, h: ci.CanvasHeight };
    this.defaults = Float32Array.from(core.parameters.defaultValues);
    this.partBase = Float32Array.from(core.parts.opacities);
    this.parts = core.parts.ids.map((id, i) => ({ tag: id, idx: i }));
    this.map = buildParamMap(core, this.rig.params);
    this.paramIndex = new Map(core.parameters.ids.map((id, i) => [id, i]));

    const [images, physics, exps] = await Promise.all([
      Promise.all(refs.Textures.map((f) => loadImage(at(f)))),
      refs.Physics ? fetchJson(at(refs.Physics)) : null,
      Promise.all((refs.Expressions ?? []).map(async (e) => [e.Name, await fetchJson(at(e.File))])),
    ]);
    this.textures = images.map((img) => this.r.createTexture(img));
    this.physics = physics ? new CubismPhysics(physics, core.parameters) : null;
    this.exp3 = Object.fromEntries(exps);
    this.buildMeshes();

    // 기본 자세로 한 번 계산해 머리 자리·화면 맞춤 범위를 잰다.
    // 모델 px 크기: 얼굴('Face' 파츠) 가로 반지름이 FACE_RX 가 되게 줄인다 — 배경 속 아바타 자리(scene.json avatar.scale)·효과 크기가
    // 파츠 모델 기준 px 로 맞춰져 있어서 (Cubism 캔버스 px 그대로면 몇 배 크게 나옴). rig.modelScale 로 직접 정할 수도 있음
    core.parameters.values.set(this.defaults);
    core.update();
    this.uploadAll();
    const face = this.drawablesUnderPart(this.rig.headPart ?? /^(Part)?(Face|Head)$/i);
    const fb = this.drawableBox(face);
    const s = this.rig.modelScale ?? (fb ? FACE_RX / ((fb.x1 - fb.x0) / 2) : 1);
    this.canvas.s = s;
    this.canvas.ppu *= s;
    this.canvas.ox *= s;
    this.canvas.oy *= s;
    if (!this.model.bounds) this.model.bounds = this.drawableBox(this.visibleDrawables()) ?? { x0: 0, y0: 0, x1: this.canvas.w * s, y1: this.canvas.h * s };
    if (!this.rig.head) {
      const b = this.drawableBox(face) ?? this.model.bounds;
      this.rig.head = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, rx: (b.x1 - b.x0) / 2, ry: (b.y1 - b.y0) / 2 };
    }
    this.buildShading();
  }

  // 움직이는 그늘 준비: 그림마다 기본 자세 자리(정점 버퍼 2번)와 그늘 모양(얼굴 타원체·머리 구·목/몸 원기둥).
  // rig.shading = { strength (기본 0.28), exclude: '정규식' (그늘 안 넣을 그림 id) }
  buildShading() {
    const gl = this.r.gl;
    const D = this.core.drawables;
    const P = this.core.parts;
    const H = this.rig.head;
    const opt = this.rig.shading ?? {};
    const skip = opt.exclude ? new RegExp(opt.exclude) : null;
    const shapes = {
      face: [1, H.cx, H.cy, H.rx * 1.08, H.ry * 1.12],
      head: [1, H.cx, H.cy - H.ry * 0.3, H.rx * 1.6, H.ry * 1.55],
      neck: [2, H.cx, 0, H.rx * 0.6, 1],
      body: [2, H.cx, 0, H.rx * 2.4, 1],
    };
    const { ppu, ox, oy } = this.canvas;
    this.shadeKind = [];
    for (let i = 0; i < D.count; i++) {
      const m = this.meshes[i];
      if (!m) {
        this.shadeKind.push(null);
        continue;
      }
      gl.bindVertexArray(m.vao);
      const rest = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, rest);
      gl.bufferData(gl.ARRAY_BUFFER, D.vertexPositions[i], gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      const id = D.ids[i];
      const f = D.constantFlags[i];
      let group = null;
      if (!(SHADE_SKIP.test(id) || (skip && skip.test(id)) || f & (BLEND_ADD | BLEND_MUL))) {
        for (let k = D.parentPartIndices[i]; k >= 0 && !group; k = P.parentIndices[k]) {
          group = SHADE_GROUPS.find(([, re]) => re.test(P.ids[k]))?.[0] ?? null;
        }
        if (!group) {
          const v = D.vertexPositions[i];
          let sy = 0;
          for (let k = 1; k < v.length; k += 2) sy += oy - v[k] * ppu;
          group = sy / (v.length / 2) < H.cy + H.ry * 1.2 ? 'head' : 'body';
        }
      }
      this.shadeKind.push(group ? { group, shape: shapes[group] } : null);
    }
    this.angleIdx = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleZ'].map((id) => this.paramIndex.get(id) ?? -1);
    this.light = null;
  }

  // 무대가 그리기 전에 부름: light = 배경의 avatarLight (rimDir = 빛이 오는 쪽, 화면 y 위쪽 / bottom = 아래쪽 빛깔), k = 조명 세기 (0~1).
  // 배경이 없으면(OBS 투명 등) 왼쪽 위 앞에서 오는 약한 기본 빛, 그늘은 살짝 따뜻한 색
  setLight(light, k = 1) {
    const d = light?.rimDir ?? [-0.55, 0.6];
    const s = (this.rig.shading?.strength ?? 0.28) * k * (light ? 1 : 0.6);
    const L = [d[0] * 0.7, d[1] * 0.7, 0.7];
    const n = Math.hypot(...L) || 1;
    const b = light?.bottom ?? [1, 0.9, 0.93];
    const bm = Math.max(...b) || 1;
    const tint = b.map((v) => (1 - s) * Math.sqrt(v / bm));
    this.light = { L: L.map((v) => v / n), s, tint };
  }

  buildMeshes() {
    const gl = this.r.gl;
    const D = this.core.drawables;
    this.prog = program(gl, FS);
    this.maskProg = program(gl, MASK_FS);
    this.meshes = [];
    for (let i = 0; i < D.count; i++) {
      if (!D.indexCounts[i]) {
        this.meshes.push(null);
        continue;
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const pos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.bufferData(gl.ARRAY_BUFFER, D.vertexPositions[i], gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const uv = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uv);
      gl.bufferData(gl.ARRAY_BUFFER, D.vertexUvs[i], gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      const idx = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, D.indices[i], gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.meshes.push({ vao, pos, count: D.indexCounts[i] });
    }
    this.order = new Int32Array(D.count);
  }

  uploadAll() {
    const gl = this.r.gl;
    const D = this.core.drawables;
    for (let i = 0; i < D.count; i++) {
      const m = this.meshes[i];
      if (!m) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, D.vertexPositions[i]);
    }
  }

  visibleDrawables() {
    const D = this.core.drawables;
    const out = [];
    for (let i = 0; i < D.count; i++) if (this.meshes[i] && D.dynamicFlags[i] & VISIBLE && D.opacities[i] > 0.01) out.push(i);
    return out;
  }

  // 파츠 이름(또는 정규식) 아래에 있는 그림들
  drawablesUnderPart(name) {
    const P = this.core.parts;
    const test = (id) => (name instanceof RegExp ? name.test(id) : id === name);
    const hit = new Set();
    for (let i = 0; i < P.count; i++) if (test(P.ids[i])) hit.add(i);
    if (!hit.size) return [];
    const under = (pi) => {
      for (let k = pi; k >= 0; k = P.parentIndices[k]) if (hit.has(k)) return true;
      return false;
    };
    return this.visibleDrawables().filter((d) => under(this.core.drawables.parentPartIndices[d]));
  }

  // 그림들의 범위 (모델 px, 위가 0)
  drawableBox(list) {
    const D = this.core.drawables;
    const { ppu, ox, oy } = this.canvas;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const d of list) {
      const v = D.vertexPositions[d];
      for (let k = 0; k < v.length; k += 2) {
        const x = v[k] * ppu + ox;
        const y = oy - v[k + 1] * ppu;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x0 < x1 ? { x0, y0, x1, y1 } : null;
  }

  resetPhysics() {
    this.physics?.reset();
  }

  setTuning(t) {
    Object.assign(this.t, t);
  }

  // 파츠 모델용 조정 함수들 — Cubism 모델은 할 일이 없다
  refreshClosedEyes() {}
  prepareStatic() {}
  makeStrandSets() {}

  update(P, dt) {
    this.time += dt;
    if (this.rig.faceProfile) P = facePose(P);
    const core = this.core;
    const values = core.parameters.values;
    values.set(this.defaults);
    this.map.apply(P, values);
    this.applyExpressions(P, values);
    for (const a of this.rig.accessories ?? []) {
      const i = this.paramIndex.get(a.param);
      if (i !== undefined) values[i] = Math.max(values[i], (P[a.toggle] ?? 0) * (a.value ?? 1));
    }
    this.physics?.evaluate(dt);
    const op = core.parts.opacities;
    for (const p of this.parts) op[p.idx] = this.hidden.has(p.tag) ? 0 : this.partBase[p.idx];
    core.drawables.resetDynamicFlags();
    core.update();
    const gl = this.r.gl;
    const D = core.drawables;
    for (let i = 0; i < D.count; i++) {
      const m = this.meshes[i];
      if (!m || !(D.dynamicFlags[i] & POS_CHANGED)) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, D.vertexPositions[i]);
    }
    return [this.item];
  }

  // 표정: params = 그 값으로 (무게만큼), add = 더하기, exp3 = Cubism 표정 파일
  applyExpressions(P, values) {
    for (const [name, ex] of Object.entries(this.expressions)) {
      const w = Math.max(0, Math.min(1, P[`ex_${name}`] ?? 0));
      if (w <= 0.001) continue;
      for (const [id, v] of Object.entries(ex.params ?? {})) {
        const i = this.paramIndex.get(id);
        if (i !== undefined) values[i] += (v - values[i]) * w;
      }
      for (const [id, v] of Object.entries(ex.add ?? {})) {
        const i = this.paramIndex.get(id);
        if (i !== undefined) values[i] += v * w;
      }
      for (const e of this.exp3[ex.exp3]?.Parameters ?? []) {
        const i = this.paramIndex.get(e.Id);
        if (i === undefined) continue;
        if (e.Blend === 'Add') values[i] += e.Value * w;
        else if (e.Blend === 'Multiply') values[i] *= 1 + (e.Value - 1) * w;
        else values[i] += (e.Value - values[i]) * w;
      }
    }
    const min = this.core.parameters.minimumValues;
    const max = this.core.parameters.maximumValues;
    for (let i = 0; i < values.length; i++) values[i] = Math.max(min[i], Math.min(max[i], values[i]));
  }

  // 렌더러가 부름: 지금 묶인 화면(또는 아바타 버퍼)에 그린다
  draw(view) {
    const gl = this.r.gl;
    const W = this.r.canvas.width;
    const H = this.r.canvas.height;
    const D = this.core.drawables;
    const target = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const sx = (2 * view.scale) / W;
    const sy = (-2 * view.scale) / H;
    const { ppu, ox, oy } = this.canvas;
    for (const pr of [this.maskProg, this.prog]) {
      gl.useProgram(pr.p);
      gl.uniform4f(pr.view, sx, sy, -view.cx * sx, -view.cy * sy);
      gl.uniform3f(pr.canvas, ppu, ox, oy);
      gl.uniform1i(pr.tex, 0);
    }
    gl.uniform1i(this.prog.mask, 1);
    gl.uniform2f(this.prog.maskPx, 1 / W, 1 / H);
    // 그늘: 지금 고개·몸 각도 (리그의 각도 → 실제 돌림은 조금 덜: 좌우 0.7, 위아래 0.6, 기울기는 리그와 같은 0.5 / 몸 좌우 1.5, 기울기 0.3)
    const lt = this.light ?? (this.setLight(null), this.light);
    gl.uniform1f(this.prog.shade, lt.s);
    gl.uniform3f(this.prog.light, lt.L[0], lt.L[1], lt.L[2]);
    gl.uniform3f(this.prog.tint, lt.tint[0], lt.tint[1], lt.tint[2]);
    const pv = this.core.parameters.values;
    const ang = this.angleIdx.map((j) => (j >= 0 ? pv[j] : 0));
    const rotHead = rotation(ang[0] * 0.7, ang[1] * 0.6, ang[2] * 0.5);
    const rotBody = rotation(ang[3] * 1.5, 0, ang[4] * 0.3);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    for (let i = 0; i < D.count; i++) this.order[D.renderOrders[i]] = i;
    let maskKey = '';
    for (let k = 0; k < D.count; k++) {
      const i = this.order[k];
      const m = this.meshes[i];
      if (!m || !(D.dynamicFlags[i] & VISIBLE) || D.opacities[i] <= 0.001) continue;
      const flags = D.constantFlags[i];
      let mode = 0;
      if (D.maskCounts[i] > 0) {
        const masks = D.masks[i];
        const key = Array.prototype.join.call(masks, ',');
        if (key !== maskKey) {
          this.drawMask(masks, target, W, H);
          maskKey = key;
          gl.useProgram(this.prog.p);
        }
        mode = flags & INVERTED_MASK ? 2 : 1;
      }
      if (flags & DOUBLE_SIDED) gl.disable(gl.CULL_FACE);
      else gl.enable(gl.CULL_FACE);
      if (flags & BLEND_ADD) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      else if (flags & BLEND_MUL) gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(this.prog.maskMode, mode);
      const c = i * 4;
      const mc = D.multiplyColors;
      const sc = D.screenColors;
      if (mc) gl.uniform3f(this.prog.mul, mc[c], mc[c + 1], mc[c + 2]);
      else gl.uniform3f(this.prog.mul, 1, 1, 1);
      if (sc) gl.uniform3f(this.prog.scr, sc[c], sc[c + 1], sc[c + 2]);
      else gl.uniform3f(this.prog.scr, 0, 0, 0);
      gl.uniform1f(this.prog.opacity, D.opacities[i]);
      const sk = this.shadeKind[i];
      gl.uniform1i(this.prog.kind, sk ? sk.shape[0] : 0);
      if (sk) {
        gl.uniform4f(this.prog.shape, sk.shape[1], sk.shape[2], sk.shape[3], sk.shape[4]);
        gl.uniformMatrix3fv(this.prog.rot, false, sk.group === 'neck' || sk.group === 'body' ? rotBody : rotHead);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[D.textureIndices[i]].tex);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  // 클리핑 마스크: 마스크 그림들의 알파를 화면 크기 버퍼에 모아 둔다 (그릴 때 같은 화면 자리에서 읽음)
  drawMask(masks, target, W, H) {
    const gl = this.r.gl;
    const mb = this.ensureMaskBuffer(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mb.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.maskProg.p);
    gl.disable(gl.CULL_FACE);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    const D = this.core.drawables;
    for (const j of masks) {
      const m = this.meshes[j];
      if (!m) continue;
      gl.bindTexture(gl.TEXTURE_2D, this.textures[D.textureIndices[j]].tex);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mb.tex);
    gl.activeTexture(gl.TEXTURE0);
  }

  ensureMaskBuffer(W, H) {
    const gl = this.r.gl;
    const mb = this.maskBuf;
    if (mb && mb.w === W && mb.h === H) return mb;
    if (mb) {
      gl.deleteFramebuffer(mb.fbo);
      gl.deleteTexture(mb.tex);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.maskBuf = { fbo, tex, w: W, h: H };
    return this.maskBuf;
  }
}
