// VRM(3D) 모델 런타임. three.js + three-vrm 으로 따로 그린 화면을 앱 렌더러에 한 장으로 얹는다.
// 그래서 배경·조명 합성·효과·OBS 중계·확대 보기 같은 앱 기능을 다른 모델과 똑같이 쓴다.
// 2D 와 달리 실제 입체라서 고개를 돌려도 그림을 휘거나 바꿔 끼울 필요가 없다 (2026-10-29 사용자: 3D 로 해 보기).
// model.json: { "type": "vrm", "vrm": "<이름>.vrm", "rig": { expressions, modelScale?, frame?, arms?, gain? } }
//  - 모델 px: 얼굴 가로 반지름이 FACE_RX 가 되게 (다른 모델과 같은 크기 → 배경 속 아바타 자리·효과가 그대로 맞음)
//  - rig.expressions[이름] = { label, key, vrm: { happy: 1, ... } } — VRM 표정 이름(기본 + 모델이 가진 것)에 그 무게로
//  - 퍼펙트 싱크: 모델에 ARKit 이름의 표정(eyeBlinkLeft 등)이 있으면 트래커 값(bs_*)을 그대로 넣음
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../vendor/three/three-vrm.module.js';
import { DEFAULT_TUNING, PARAMS } from './rig.js';
import { facePose } from './face_performance.js';
import { ARKIT } from './cubism_params.js';

const FACE_RX = 178.7; // 얼굴 가로 반지름 (모델 px) — cubism_avatar.js 와 같음
const HEAD_HALF_W = 0.078; // VRM 머리 가로 반지름 (m, 보통 크기)
const PX0 = 1000; // 머리 가운데의 모델 px x
const PY0 = 300; // 머리 꼭대기의 모델 px y
const FOV = 18; // 카메라 세로 시야 (도) — 좁을수록 원근이 약함 (방송용 반신은 15~25)
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const QUAD_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
const QUAD_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main() { outColor = texture(u_tex, v_uv); }`;

export class VrmAvatar {
  constructor(renderer, model, tuning = {}) {
    this.r = renderer;
    this.model = model;
    this.rig = model.rig ?? (model.rig = {});
    this.t = { ...DEFAULT_TUNING, ...tuning };
    this.parts = []; // 레이어 탭: 3D 모델은 메시 이름
    this.hidden = new Set();
    this.time = 0;
    this.expressions = this.rig.expressions ?? {};
    for (const [name, ex] of Object.entries(this.expressions)) {
      PARAMS[`ex_${name}`] = { min: 0, max: 1, def: 0, label: `표정: ${ex.label}` };
    }
    this.item = { draw: (view) => this.draw(view), opacity: 1 };
    this.lightK = 1;
  }

  async load(base) {
    const url = new URL(`${base}/${this.model.vrm}`, location.href).href;
    this.canvas3 = document.createElement('canvas');
    this.three = new THREE.WebGLRenderer({ canvas: this.canvas3, alpha: true, premultipliedAlpha: true, antialias: true });
    this.three.setPixelRatio(1);
    this.three.setClearColor(0x000000, 0);
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.position.set(-0.6, 1.2, 1.6);
    this.scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(this.ambient);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('VRM 파일이 아닙니다 (VRM 정보가 없음)');
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons?.(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // VRM 0.x 는 뒤(−Z)를 보고 있어 앞(+Z)으로 돌림
    this.flip = vrm.meta?.metaVersion === '0' ? -1 : 1;
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      if (o.isMesh) this.parts.push({ tag: o.name || `mesh${this.parts.length}`, obj: o });
    });
    this.scene.add(vrm.scene);
    this.vrm = vrm;
    this.bone = (n) => vrm.humanoid?.getNormalizedBoneNode(n) ?? null;
    if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
    this.exprNames = new Set(Object.keys(vrm.expressionManager?.expressionMap ?? {}));
    this.perfectSync = ARKIT.filter((n) => this.exprNames.has(n));

    // 기본 자세(팔 내림)로 한 번 계산해 머리 자리를 잰다
    this.applyPose({}, 0);
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    const wp = (n) => this.bone(n)?.getWorldPosition(new THREE.Vector3()) ?? null;
    const head = wp('head') ?? new THREE.Vector3(0, 1.45, 0);
    const neck = wp('neck') ?? head.clone().add(new THREE.Vector3(0, -0.08, 0));
    const chest = wp('upperChest') ?? wp('chest') ?? wp('spine') ?? head.clone().add(new THREE.Vector3(0, -0.3, 0));
    const lsh = wp('leftUpperArm');
    const rsh = wp('rightUpperArm');
    // 머리 높이 = 목~머리 뼈 거리로 어림 (머리 뼈는 보통 턱 높이 근처)
    const headH = Math.max(0.18, (head.y - neck.y) * 2.6 + 0.12);
    const top = head.y + headH * 0.62;
    const faceY = head.y + headH * 0.18; // 얼굴(눈 높이 조금 아래) 가운데
    this.k = this.rig.modelScale ?? FACE_RX / HEAD_HALF_W; // 모델 px / m
    this.origin = { x: head.x, y: top, z: head.z + 0.06 }; // 얼굴 앞면 높이를 화면 맞춤 평면으로
    const toPx = (v) => ({ x: PX0 + (v.x - this.origin.x) * this.k, y: PY0 + (this.origin.y - v.y) * this.k });
    const sw = lsh && rsh ? Math.abs(lsh.x - rsh.x) / 2 + 0.12 : 0.28;
    const bottomY = chest.y - (this.rig.frame?.below ?? 0.22);
    if (!this.model.bounds) {
      const a = toPx(new THREE.Vector3(head.x - sw, top + 0.03, 0));
      const b = toPx(new THREE.Vector3(head.x + sw, bottomY, 0));
      this.model.bounds = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    }
    if (!this.rig.head) {
      const c = toPx(new THREE.Vector3(head.x, faceY, 0));
      this.rig.head = { cx: c.x, cy: c.y, rx: FACE_RX, ry: FACE_RX * 1.3 };
    }
    // 화면 합성용 사각형 (앱 렌더러 쪽)
    const gl = this.r.gl;
    this.quadProg = makeProgram(gl, QUAD_VS, QUAD_FS);
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.quadProg, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uTex = gl.getUniformLocation(this.quadProg, 'u_tex');
  }

  // 배경 조명: 빛 방향(rimDir)·아래쪽 빛깔을 3D 빛에 옮김. 배경이 없으면 왼쪽 위 앞에서 오는 기본 빛
  setLight(light, k = 1) {
    if (!this.sun) return;
    const d = light?.rimDir ?? [-0.55, 0.6];
    this.sun.position.set(d[0] * 1.2, d[1] * 1.2 + 0.4, 1.6);
    const b = light?.bottom ?? [1, 1, 1];
    const m = Math.max(...b) || 1;
    const mix = light ? 0.35 * k : 0;
    this.ambient.color.setRGB(1 + (b[0] / m - 1) * mix, 1 + (b[1] / m - 1) * mix, 1 + (b[2] / m - 1) * mix);
  }

  resetPhysics() {
    this.vrm?.springBoneManager?.reset();
  }

  setTuning(t) {
    Object.assign(this.t, t);
  }

  refreshClosedEyes() {}
  prepareStatic() {}
  makeStrandSets() {}

  // 뼈 자세. P 의 각도는 다른 모델과 같은 단위 (각도 X·Y·Z ±30 ≈ 도, 몸 ±10)
  applyPose(P, dt) {
    const g = this.rig.gain ?? {};
    // VRM 0.x 는 rotateVRM0 으로 통째로 180° 돌려 세우므로 뼈 자기 좌표의 X·Z 축이 화면과 반대 (Y 는 같음)
    const f = this.flip;
    const set = (n, x, y, z) => {
      const b = this.bone(n);
      if (b) b.rotation.set(x * D2R * f, y * D2R, z * D2R * f, 'YXZ');
    };
    const hx = (P.angleX ?? 0) * (g.head ?? 1);
    const hy = (P.angleY ?? 0) * (g.head ?? 1);
    const hz = (P.angleZ ?? 0) * (g.head ?? 1);
    // 고개: 목 40% · 머리 60%. X + = 화면 오른쪽(y 회전 +), Y + = 위(x 회전 −), Z + = 머리가 화면 반시계(z 회전 +)
    set('neck', -hy * 0.4, hx * 0.4, hz * 0.4);
    set('head', -hy * 0.6, hx * 0.6, hz * 0.6);
    // 몸: 허리·가슴이 나눠서. 숙이기(+) = 앞으로(x 회전 +)
    const by = (P.bodyYaw ?? 0) * 0.9 * (g.body ?? 1);
    const bl = (P.bodyLean ?? 0) * 0.6 * (g.body ?? 1);
    const bz = (P.bodyZ ?? 0) * 0.8 * (g.body ?? 1);
    const br = (P.breath ?? 0) * 1.6;
    set('spine', bl * 0.5, by * 0.5, bz * 0.5);
    set('chest', bl * 0.3 - br * 0.5, by * 0.3, bz * 0.3);
    set('upperChest', bl * 0.2 - br * 0.5, by * 0.2, bz * 0.2);
    // 어깨 으쓱(+)·처짐(−)
    const sh = (P.shoulder ?? 0) * 8;
    set('leftShoulder', 0, 0, sh);
    set('rightShoulder', 0, 0, -sh);
    // 팔: 기본은 내린 자세 (T 자세에서 72° 내림), 앱 팔 각도(−15~40, + = 벌림)만큼 들고, 팔꿈치는 앞으로 굽힘
    const A = this.rig.arms ?? {};
    const down = A.down ?? 72;
    const aL = down - (P.armL ?? 0) * 0.8;
    const aR = down - (P.armR ?? 0) * 0.8;
    set('leftUpperArm', 0, 0, -aL);
    set('rightUpperArm', 0, 0, aR);
    const eL = (A.elbow ?? 12) + (P.elbowL ?? 0) * 0.8;
    const eR = (A.elbow ?? 12) + (P.elbowR ?? 0) * 0.8;
    set('leftLowerArm', 0, -eL, 0);
    set('rightLowerArm', 0, eR, 0);
    set('leftHand', 0, 0, -6);
    set('rightHand', 0, 0, 6);
    // 몸 위아래 (뛰기 +), 좌우 이동
    const hips = this.bone('hips');
    if (hips) {
      if (!this.hipsRest) this.hipsRest = hips.position.clone();
      hips.position.copy(this.hipsRest);
      hips.position.y += (P.bodyY ?? 0) * 0.05;
      hips.position.x += (P.bodyX ?? 0) * 0.004;
    }
  }

  // 표정·입·눈
  applyFace(P) {
    const em = this.vrm.expressionManager;
    if (!em) return;
    const has = (n) => this.exprNames.has(n);
    const out = {};
    const add = (n, v) => {
      if (has(n)) out[n] = Math.max(out[n] ?? 0, clamp(v, 0, 1));
    };
    // 눈 감기 (eyeOpen 0 = 감음). 웃는 눈(happy)이 눈을 감기면 깜빡임을 줄여 겹쳐 감기지 않게
    const smile = clamp(P.eyeSmile ?? 0, 0, 1);
    add('blinkLeft', (1 - clamp(P.eyeOpenL ?? 1, 0, 1)) * (1 - smile * 0.7));
    add('blinkRight', (1 - clamp(P.eyeOpenR ?? 1, 0, 1)) * (1 - smile * 0.7));
    // 입 모양: 벌림 o × 가로 모양 s (− 오므림 … + 넓게) → 아·이·우·에·오
    const o = clamp(P.mouthOpen ?? 0, 0, 1);
    const s = clamp((P.mouthWide ?? 0) - (P.mouthNarrow ?? 0), -1, 1);
    const w = Math.max(s, 0);
    const n = Math.max(-s, 0);
    add('aa', o * (1 - w) * (1 - n));
    add('ee', o * w);
    add('ih', w * (1 - o) * 0.7);
    add('oh', o * n);
    add('ou', n * (1 - o) * 0.9);
    // 감정: 웃는 눈 → happy, 입꼬리 올림 → relaxed, 내림 + 눈썹 내림 → sad/angry, 크게 뜸 → surprised
    const form = P.mouthForm ?? 0;
    add('happy', smile);
    add('relaxed', clamp(form, 0, 1) * 0.55 * (1 - smile));
    add('sad', clamp(-form, 0, 1) * clamp(P.brow ?? 0, 0, 1) * 0.8);
    add('angry', clamp(-(P.brow ?? 0), 0, 1) * clamp(-form, 0, 1) * 0.8);
    add('surprised', clamp(P.eyeWiden ?? 0, 0, 1) * 0.6);
    // 앱 표정 버튼 (rig.expressions)
    for (const [name, ex] of Object.entries(this.expressions)) {
      const wgt = clamp(P[`ex_${name}`] ?? 0, 0, 1);
      if (wgt <= 0.001) continue;
      for (const [k, v] of Object.entries(ex.vrm ?? {})) add(k, v * wgt);
    }
    // 퍼펙트 싱크: ARKit 이름 표정이 있는 모델은 트래커 값을 그대로
    for (const k of this.perfectSync) add(k, P[`bs_${k}`] ?? 0);
    for (const k of this.exprNames) em.setValue(k, out[k] ?? 0);
    // 시선: X + = 화면 오른쪽(yaw +), Y + = 위(pitch −)
    if (this.vrm.lookAt) {
      this.vrm.lookAt.yaw = clamp(P.eyeBallX ?? 0, -1, 1) * 14;
      this.vrm.lookAt.pitch = -clamp(P.eyeBallY ?? 0, -1, 1) * 10;
    }
  }

  update(P, dt) {
    this.time += dt;
    if (this.rig.faceProfile) P = facePose(P);
    this.applyPose(P, dt);
    this.applyFace(P);
    for (const p of this.parts) p.obj.visible = !this.hidden.has(p.tag);
    this.vrm.update(dt); // 표정·시선·머리카락/옷 흔들림(스프링 본)
    return [this.item];
  }

  // 렌더러가 부름: 3D 화면을 따로 그린 뒤 지금 묶인 화면(또는 아바타 버퍼)에 한 장으로 얹는다.
  // 카메라는 얼굴 앞면 높이 평면이 모델 px 좌표와 같은 자리에 오게 (view: 모델 (cx, cy) 가 화면 가운데, 1 모델 px = scale 화면 px)
  draw(view) {
    const gl = this.r.gl;
    const W = this.r.canvas.width;
    const H = this.r.canvas.height;
    if (this.canvas3.width !== W || this.canvas3.height !== H) this.three.setSize(W, H, false);
    const visH = H / view.scale / this.k; // 맞춤 평면에서 보이는 세로 (m)
    const d = visH / 2 / Math.tan((FOV / 2) * D2R);
    const cx = this.origin.x + (view.cx - PX0) / this.k;
    const cy = this.origin.y - (view.cy - PY0) / this.k;
    this.camera.aspect = W / H;
    this.camera.near = Math.max(0.01, d * 0.05);
    this.camera.far = d * 20 + 5;
    this.camera.position.set(cx, cy, this.origin.z + d);
    this.camera.rotation.set(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.three.render(this.scene, this.camera);

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas3);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.useProgram(this.quadProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uTex, 0);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}

function makeProgram(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
