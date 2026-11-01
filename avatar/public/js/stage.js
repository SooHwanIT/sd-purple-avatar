// 스튜디오와 OBS 화면이 함께 쓰는 무대: 모델 로드, 화면 맞춤, 자동 동작(깜빡임·숨쉬기·대기 흔들림)
import { Renderer } from './renderer.js';
import { Avatar, defaultParams } from './rig.js';
import { PartsAvatar } from './parts_rig.js';
import { Scene } from './scene.js';
import { Effects } from './effects.js';
import { PerformanceMotion } from './performance.js';
import { FacePerformance } from './face_performance.js';

export async function loadModel(base = 'model') {
  const model = await (await fetch(`${base}/model.json`, { cache: 'no-store' })).json();
  let tuning = {};
  try {
    const r = await fetch(`${base}/rig.json`, { cache: 'no-store' });
    if (r.ok) tuning = (await r.json()).tuning ?? {};
  } catch {
    /* rig.json 없음 */
  }
  return { model, tuning };
}

// 주소의 ?model=폴더 로 다른 모델을 열 수 있다 (예: 고퀄 모델 model_hq). 영문·숫자·_ 만
export function modelFromUrl(def = 'model') {
  const m = new URLSearchParams(location.search).get('model');
  return m && /^[a-z0-9_]+$/i.test(m) ? m : def;
}

export async function createStage(canvas, base = modelFromUrl()) {
  const renderer = new Renderer(canvas);
  const { model, tuning } = await loadModel(base);
  // 파츠 트리 모델(극한 파츠 분리, build_parts_model.py)·Cubism 모델(.moc3)·VRM(3D) 모델은 전용 런타임으로
  const avatar = model.type === 'cubism'
    ? new (await import('./cubism_avatar.js')).CubismAvatar(renderer, model, tuning)
    : model.type === 'vrm' ? new (await import('./vrm_avatar.js')).VrmAvatar(renderer, model, tuning)
    : model.type === 'chibi' ? new (await import('./chibi_rig.js')).ChibiAvatar(renderer, model, tuning)
    : model.type === 'parts' ? new PartsAvatar(renderer, model, tuning) : new Avatar(renderer, model, tuning);
  await avatar.load(base);
  const stage = new Stage(renderer, avatar, model);
  stage.base = base;
  stage.effects = new Effects(renderer, model);
  return stage;
}

export class Stage {
  constructor(renderer, avatar, model) {
    this.renderer = renderer;
    this.avatar = avatar;
    this.model = model;
    // scene: 움직이는 배경 이름 (scene/<이름>/, '' 이면 없음), sceneMotion: 배경 움직임 크기
    // sceneLight: 배경 조명을 아바타에 입히는 정도 (0 이면 끔)
    // avScale · avX · avY: 배경 속 아바타의 크기·좌우·위아래 (배경의 아바타 자리 기준)
    // food: 식탁 배경에 놓을 음식 이름 ('' 이면 빈 식탁), props: 켤 배경 소품 이름들 (방송 준비 중 표지판 등)
    // hideAvatar: 아바타 숨기기 (방송 준비 중 화면 등)
    this.view = { zoom: 1, offsetX: 0, offsetY: 0, scene: '', sceneMotion: 1, sceneLight: 1, avScale: 1, avX: 0, avY: 0, food: '', props: [], hideAvatar: false };
    this.avatarAlpha = 1; // 아바타 숨기기: 서서히 사라지고 나타남
    this.effects = null; // 졸음 'Z'·하트 같은 덧그림 (effects.js, 있으면)
    // 배경 빈칸에 쓸 글: { notice, song, songLen, chat, frameMode } (스튜디오가 'text' 로 보냄)
    this.text = {};
    this.scene = null;
    this.sceneName = '';
    this.sceneFit = 'cover'; // 배경 맞춤: OBS 화면은 'auto' (비율이 다르면 잘리지 않게)
    this.auto = { blink: true, breath: true, idle: true };
    this.blink = { next: 2, phase: -1 };
    this.idleW = 0; // 대기 흔들림 섞는 정도 (얼굴을 놓치면 서서히 1로)
    this.performance = model.rig?.performanceProfile ? new PerformanceMotion(model.rig.performanceProfile, model.rig.motionProfile) : null;
    this.facePerformance = model.rig?.faceProfile ? new FacePerformance() : null;
    this.time = 0;
  }

  setBackground(css) {
    if (!css || css === 'transparent') {
      this.renderer.background = [0, 0, 0, 0];
      return;
    }
    const m = css.match(/^#?([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      this.renderer.background = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
    }
  }

  // 배경을 바꿔야 하면 불러온다 (불러오는 동안에는 이전 상태로 그림)
  syncScene() {
    const want = this.view.scene || '';
    if (want === this.sceneName) return;
    this.sceneName = want;
    const old = this.scene;
    this.scene = null;
    old?.dispose();
    if (!want) return;
    const sc = new Scene(this.renderer);
    this.scenePromise = sc.load(`scene/${encodeURIComponent(want)}`)
      .then(() => {
        if (this.sceneName === want) this.scene = sc;
        else sc.dispose();
      })
      .catch((err) => {
        console.warn(err);
        sc.dispose();
      });
  }

  viewTransform() {
    const b = this.model.bounds;
    const c = this.renderer.canvas;
    const W = c.width || 1;
    const H = c.height || 1;
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const fit = Math.min(W / (bw * 1.12), H / (bh * 1.12));
    const scale = fit * this.view.zoom;
    return {
      cx: (b.x0 + b.x1) / 2 - (this.view.offsetX * W) / scale,
      cy: (b.y0 + b.y1) / 2 - (this.view.offsetY * H) / scale,
      scale,
    };
  }

  // 자동 깜빡임: 0(감음)~1(뜸) 배율
  blinkFactor(dt) {
    const b = this.blink;
    if (b.phase < 0) {
      b.next -= dt;
      if (b.next <= 0) b.phase = 0;
      return 1;
    }
    b.phase += dt / 0.16;
    if (b.phase >= 1) {
      b.phase = -1;
      b.next = 2.2 + Math.random() * 3.5;
      if (Math.random() < 0.15) b.next = 0.25; // 가끔 두 번 연속
      return 1;
    }
    return Math.abs(1 - 2 * b.phase) ** 1.5;
  }

  // params: 바깥(트래킹·수동)에서 정한 값. idle=true 이면 대기 흔들림을 섞는다
  frame(params, dt, { idle = false, autoBlink = false, render = true, performance = true } = {}) {
    this.time += dt;
    const t = this.time;
    const P = { ...defaultParams(), ...params };
    const forwarded = this.performance && P._performance === 1;
    if (!forwarded) {
      if (this.auto.breath) P.breath = (Math.sin((t * 2 * Math.PI) / 3.6) + 1) / 2;
      // 말할 때 들썩임: 숨쉬기 위에 더한다 (어깨·목이 살짝 올라감)
      if (P.talk) P.breath = (P.breath ?? 0) + P.talk * 0.9;
      this.idleW += ((idle && this.auto.idle ? 1 : 0) - this.idleW) * (1 - Math.exp(-dt * 1.2));
      const w = this.idleW;
      const presence = this.avatar.t.motionPresence ?? 1;
      const performed = this.performance && performance && presence > 0;
      const faceActive = this.facePerformance && performance;
      if (this.performance) P.chestPulse = 0;
      if (performed) {
        this.performance.apply(P, dt, {
          idleWeight: w, autoBlink: autoBlink && this.auto.blink && !faceActive,
          strength: presence, speech: this.auto.talk !== false,
        });
      }
      if (!performed && w > 0.001) {
        P.angleX += (Math.sin(t * 0.5) * 5 + Math.sin(t * 0.23) * 3) * w;
        P.angleY += Math.sin(t * 0.37 + 1) * 2.5 * w;
        P.angleZ += Math.sin(t * 0.29 + 2) * 3 * w;
        P.bodyX += Math.sin(t * 0.5 - 0.6) * 1.5 * w;
        P.bodyZ += Math.sin(t * 0.29 + 1.4) * 1.5 * w;
        P.bodyYaw = (P.bodyYaw ?? 0) + Math.sin(t * 0.5 - 0.3) * 2 * w;
        P.eyeBallX += Math.sin(t * 0.41) * 0.25 * w;
      }
      if (!performed && !faceActive && autoBlink && this.auto.blink) {
        const k = this.blinkFactor(dt);
        P.eyeOpenL *= k;
        P.eyeOpenR *= k;
      }
      if (faceActive) this.facePerformance.apply(P, dt, {
        strength: this.avatar.t.facePresence ?? 1, autoBlink: autoBlink && this.auto.blink,
      });
      if (this.facePerformance) P._facePerformance = 1;
      if (this.performance) P._performance = 1;
    }
    this.syncScene();
    if (this.scene && this.scene.text !== this.text) this.scene.setText(this.text);
    if (render) {
      let avatarItems = this.avatar.update(P, Math.min(dt, this.model.rig?.motionProfile ? .1 : .05));
      this.renderer.resize();
      let view = this.viewTransform();
      let sceneItems = null;
      if (this.scene) {
        this.scene.fitMode = this.sceneFit;
        this.scene.setFood(this.view.food ?? '');
        this.scene.setProps(this.view.props ?? []);
        sceneItems = this.scene.update(dt, P, this.view.sceneMotion ?? 1);
        view = this.scene.avatarView(this.model, this.view) ?? view;
      }
      // 움직이는 그늘(Cubism 모델): 배경 조명 방향·세기. 배경이 없으면 약한 기본 빛
      const sceneLight = this.scene?.def?.avatarLight;
      this.avatar.setLight?.(sceneLight ?? null, this.view.sceneLight ?? 1);
      // 스튜디오 미리보기 확대·이동 (보기 전용, inspect_view.js) — 캔버스 가운데 기준 배율 z, 이동 x·y (캔버스 px)
      const I = this.inspect;
      if (I && (I.z !== 1 || I.x || I.y)) {
        const sc = view.scale * I.z;
        view = { ...view, scale: sc, cx: view.cx - I.x / sc, cy: view.cy - I.y / sc };
      }
      // 덧그림(효과): 화면 전체 효과(하트 비·불꽃놀이)는 지금 화면 범위가 필요해 view 를 정한 뒤에
      const c = this.renderer.canvas;
      let fxItems = this.effects ? this.effects.update(dt, P, { view, W: c.width, H: c.height, anchors: this.avatar.handAnchor }) : [];
      // 떠 있는 손은 아바타의 일부로 그린다: 배경 앞쪽 물건(바 카운터)에 가려지고, 배경 조명·아바타 숨기기도 같이
      if (fxItems.some((it) => it.avatar)) {
        avatarItems = [...avatarItems, ...fxItems.filter((it) => it.avatar)];
        fxItems = fxItems.filter((it) => !it.avatar);
      }
      const show = this.view.hideAvatar ? 0 : 1;
      this.avatarAlpha += (show - this.avatarAlpha) * (1 - Math.exp(-dt * 8));
      if (Math.abs(show - this.avatarAlpha) < 0.004) this.avatarAlpha = show;
      const av = this.avatarAlpha;
      // 아바타에 붙은 효과(김·하트 등)도 같이 숨김. 화면 전체 효과(후원)는 그대로
      if (av < 1) fxItems = fxItems.filter((it) => it.screen || av > 0.004).map((it) => (it.screen ? it : { ...it, opacity: it.opacity * av }));
      if (sceneItems) {
        // 배경 뒤쪽 겹 → (배경 조명을 입힌) 아바타 → 배경 앞쪽 겹(바 카운터 등) → 덧그림 순서
        const { back, front } = sceneItems;
        const light = this.scene.def.avatarLight;
        const k = this.view.sceneLight ?? 1;
        this.renderer.begin();
        const clip = this.scene.clip; // 배경 전체를 보여 줄 때 배경 바깥은 투명하게
        this.renderer.drawItems(back, view, clip);
        if (av > 0.004) {
          if (light && k > 0.01) this.renderer.drawLit(avatarItems, view, { ...light, strength: k, opacity: av });
          else if (av < 1) this.renderer.drawLit(avatarItems, view, { strength: 0, opacity: av });
          else this.renderer.drawItems(avatarItems, view);
        }
        if (front.length) this.renderer.drawItems(front, view, clip);
        if (fxItems.length) this.renderer.drawItems(fxItems, view);
      } else if (av >= 1) {
        this.renderer.draw(fxItems.length ? [...avatarItems, ...fxItems] : avatarItems, view);
      } else {
        // 숨기는 중: 아바타를 한 장으로 합성해 투명하게 (겹친 부위가 비쳐 보이지 않게)
        this.renderer.begin();
        if (av > 0.004) this.renderer.drawLit(avatarItems, view, { strength: 0, opacity: av });
        if (fxItems.length) this.renderer.drawItems(fxItems, view);
      }
    }
    return P;
  }
}

export const isLocalHost = () => /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);

// 중계 방 번호. 내 PC(server.mjs)에서는 'local' 하나로 충분하고,
// 온라인(Cloudflare)에서는 다른 사람과 섞이지 않도록 스튜디오마다 무작위 번호를 쓴다.
// create=false 이면(OBS 화면) 주소의 ?room= 만 따르고, 없으면 null.
export function relayRoom({ create = false } = {}) {
  const fromUrl = new URLSearchParams(location.search).get('room');
  if (fromUrl) return fromUrl;
  if (isLocalHost()) return 'local';
  if (!create) return null;
  let room = null;
  try {
    room = localStorage.getItem('avatar.room');
  } catch {
    /* 저장소를 쓸 수 없음 */
  }
  if (!room || !/^[A-Za-z0-9_-]{16,64}$/.test(room)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    room = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try {
      localStorage.setItem('avatar.room', room);
    } catch {
      /* 이번 접속에서만 쓰는 번호가 됨 */
    }
  }
  return room;
}

// 스튜디오 ↔ OBS 중계 (내 PC: server.mjs, 온라인: worker/index.js 의 Durable Object)
export class Relay {
  constructor(room, onMessage) {
    this.room = room;
    this.onMessage = onMessage;
    this.ws = null;
    this.open = false;
    if (room) this.connect();
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // 태블릿 연결: QR 코드 주소의 #k=열쇠 를 같이 보낸다 (내 PC 서버의 태블릿용 입구가 확인)
    const key = new URLSearchParams(location.hash.slice(1)).get('k');
    try {
      this.ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(this.room)}${key ? `&key=${encodeURIComponent(key)}` : ''}`);
    } catch {
      setTimeout(() => this.connect(), 2000);
      return;
    }
    this.ws.onopen = () => {
      this.open = true;
    };
    this.ws.onclose = () => {
      this.open = false;
      setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => {};
    this.ws.onmessage = (ev) => {
      try {
        this.onMessage?.(JSON.parse(ev.data));
      } catch {
        /* 무시 */
      }
    };
  }
  send(obj) {
    if (this.open && this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}
