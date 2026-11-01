// WebGL2 레이어 메쉬 렌더러. 정점 위치는 매 프레임 CPU(rig.js)에서 계산해 올린다.
// 텍스처는 미리 곱한 알파(premultiplied)로 다루고, 눈동자처럼 다른 레이어 안쪽만
// 보여야 하는 파츠는 스텐실 비트로 잘라 낸다.

const VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec4 u_view; // sx, sy, tx, ty : 모델 px → 클립 좌표
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos.x * u_view.x + u_view.z, a_pos.y * u_view.y + u_view.w, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_alphaCut;
uniform vec3 u_tint;
uniform float u_alphaMul; // 0 이면 더하기 섞기 (불빛)
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  if (c.a < u_alphaCut) discard;
  outColor = vec4(c.rgb * u_tint, c.a * u_alphaMul) * u_opacity;
}`;

// 아바타 합성용: 화면 전체 삼각형 하나로 아바타 버퍼를 읽어 조명·테두리 빛·그림자를 입힌다
const LIT_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const LIT_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex; // 미리 곱한 알파
uniform vec2 u_px;
uniform vec3 u_top;
uniform vec3 u_bottom;
uniform vec3 u_rim;
uniform float u_rimW;
uniform vec2 u_rimDir;
uniform float u_shadow;
uniform vec2 u_shadowOff;
uniform float u_shadowBlur;
uniform float u_opacity; // 아바타 숨기기 때 서서히 사라지게
out vec4 outColor;
const vec2 DISK[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
void main() {
  vec4 a = texture(u_tex, v_uv);
  vec3 col = a.rgb * mix(u_bottom, u_top, v_uv.y);
  // 테두리 빛: 빛이 오는 쪽으로 조금 옮긴 자리가 비어 있으면 가장자리
  vec2 d = u_rimDir * u_px;
  float out1 = texture(u_tex, v_uv + d * u_rimW).a;
  float out2 = texture(u_tex, v_uv + d * u_rimW * 0.5).a;
  float edge = a.a * (1.0 - 0.6 * out1 - 0.4 * out2);
  col += u_rim * clamp(edge, 0.0, 1.0) * a.a;
  // 부드러운 그림자: 옮긴 자리의 알파를 흐리게 모음
  float s = 0.0;
  if (u_shadow > 0.0) {
    vec2 base = v_uv - u_shadowOff * u_px;
    for (int i = 0; i < 12; i++) s += texture(u_tex, base + DISK[i] * u_shadowBlur * u_px).a;
    s = s / 12.0 * u_shadow;
  }
  outColor = vec4(col, a.a + s * (1.0 - a.a)) * u_opacity;
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      stencil: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2를 사용할 수 없습니다.');
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.loc = {
      pos: gl.getAttribLocation(prog, 'a_pos'),
      uv: gl.getAttribLocation(prog, 'a_uv'),
      view: gl.getUniformLocation(prog, 'u_view'),
      tex: gl.getUniformLocation(prog, 'u_tex'),
      opacity: gl.getUniformLocation(prog, 'u_opacity'),
      alphaCut: gl.getUniformLocation(prog, 'u_alphaCut'),
      tint: gl.getUniformLocation(prog, 'u_tint'),
      alphaMul: gl.getUniformLocation(prog, 'u_alphaMul'),
    };
    this.background = [0, 0, 0, 0];
  }

  createTexture(source, { mipmap = true } = {}) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return { tex, mipmap };
  }

  updateTexture(texture, source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (texture.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  }

  // positions: Float32Array(x,y,...) 모델 px, uvs: Float32Array, indices: Uint16/32Array
  createMesh(texture, positions, uvs, indices) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.loc.pos);
    gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, 0, 0);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.loc.uv);
    gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, 0, 0);
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return {
      vao,
      posBuf,
      bufs: [posBuf, uvBuf, idxBuf],
      texture,
      count: indices.length,
      indexType: indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    };
  }

  // 배경을 끄거나 바꿀 때 GPU 메모리 돌려주기
  deleteMesh(mesh) {
    const gl = this.gl;
    gl.deleteVertexArray(mesh.vao);
    for (const b of mesh.bufs ?? []) gl.deleteBuffer(b);
  }

  deleteTexture(texture) {
    this.gl.deleteTexture(texture.tex);
  }

  updatePositions(mesh, positions) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // view: { cx, cy, scale } — 모델 좌표 (cx, cy)가 화면 중앙에, 모델 1px = scale 화면 px
  // items: [{ mesh, opacity, writeMask?: bit, clipBy?: bit, clipOut?: bit, view?: 다른 좌표계(배경), additive?: 불빛 }]
  // 한 프레임 시작: 크기를 맞추고 배경색으로 지운다
  begin() {
    const gl = this.gl;
    this.resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [r, g, b, a] = this.background;
    gl.clearColor(r * a, g * a, b * a, a);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  draw(items, view) {
    this.begin();
    this.drawItems(items, view);
  }

  // 지금 대상(화면 또는 아바타 버퍼)에 items 를 그린다 (지우지 않음)
  // clip: { x0, y0, x1, y1 } (화면 px, 위가 0) 이 있으면 그 안에만
  drawItems(items, view, clip = null) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (clip) {
      const x0 = Math.max(0, Math.floor(clip.x0));
      const y0 = Math.max(0, Math.floor(clip.y0));
      const x1 = Math.min(W, Math.ceil(clip.x1));
      const y1 = Math.min(H, Math.ceil(clip.y1));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x0, H - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
    }
    gl.useProgram(this.prog);
    let curView = null;
    const setView = (v) => {
      if (v === curView) return;
      curView = v;
      const sx = (2 * v.scale) / W;
      const sy = (-2 * v.scale) / H;
      gl.uniform4f(this.loc.view, sx, sy, -v.cx * sx, -v.cy * sy);
    };
    setView(view);
    gl.uniform1i(this.loc.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.STENCIL_TEST);

    for (const it of items) {
      if (it.opacity <= 0.001) continue;
      if (it.draw) {
        // 스스로 그리는 항목 (Cubism 모델): 끝나면 이 렌더러의 상태로 되돌림
        it.draw(it.view ?? view);
        gl.useProgram(this.prog);
        curView = null;
        setView(view);
        gl.uniform1i(this.loc.tex, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.STENCIL_TEST);
        continue;
      }
      const { mesh } = it;
      setView(it.view ?? view);
      gl.uniform1f(this.loc.alphaMul, it.additive ? 0 : 1);
      gl.bindVertexArray(mesh.vao);
      gl.bindTexture(gl.TEXTURE_2D, mesh.texture.tex);
      const tint = it.tint ?? [1, 1, 1];
      gl.uniform3f(this.loc.tint, tint[0], tint[1], tint[2]);
      if (it.writeMask) {
        // 색은 그리지 않고 스텐실 비트만 기록 (알파 0.5 이상인 부분)
        gl.colorMask(false, false, false, false);
        gl.stencilMask(it.writeMask);
        gl.stencilFunc(gl.ALWAYS, 0xff, it.writeMask);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.uniform1f(this.loc.alphaCut, 0.5);
        gl.uniform1f(this.loc.opacity, 1);
        gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0x00);
        continue;
      }
      gl.stencilMask(0x00);
      // clipBy: 그 비트가 켜진 곳에만 (눈동자 → 흰자 안), clipOut: 그 비트가 꺼진 곳에만 (소품 지우개 → 머리 숨김)
      const clipBy = it.clipBy ?? 0;
      const clipOut = it.clipOut ?? 0;
      if (clipBy || clipOut) {
        gl.stencilFunc(gl.EQUAL, clipBy, clipBy | clipOut);
      } else {
        gl.stencilFunc(gl.ALWAYS, 0, 0);
      }
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.uniform1f(this.loc.alphaCut, 0.0);
      gl.uniform1f(this.loc.opacity, it.opacity);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.STENCIL_TEST);
    if (clip) gl.disable(gl.SCISSOR_TEST);
  }

  // 아바타를 따로 버퍼에 그린 뒤, 배경 조명을 입혀 화면에 합성한다:
  // 위(전구)는 따뜻하게·아래는 서늘하게 물들이고, 빛이 오는 쪽 가장자리에 테두리 빛, 뒤로 부드러운 그림자.
  // fx: { top, bottom, rim, rimWidth, rimDir:[x,y], shadow, shadowOffset:[x,y], shadowBlur, strength, opacity }
  // (strength 0 이면 조명 없이 합성만 — 아바타 전체를 한 장으로 투명하게 할 때)
  drawLit(items, view, fx) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const fb = this.ensureLayerBuffer(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    this.drawItems(items, view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);

    const c = this.compositor ?? (this.compositor = this.createCompositor());
    const k = fx.strength ?? 1;
    const px = H / 1080; // 효과 크기는 1080p 기준 px → 지금 화면 크기에 맞춤
    const toward = (v) => v.map((x) => 1 + (x - 1) * k);
    gl.useProgram(c.prog);
    gl.bindVertexArray(c.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fb.tex);
    gl.uniform1i(c.loc.tex, 0);
    gl.uniform2f(c.loc.px, 1 / W, 1 / H);
    gl.uniform3fv(c.loc.top, toward(fx.top ?? [1, 1, 1]));
    gl.uniform3fv(c.loc.bottom, toward(fx.bottom ?? [1, 1, 1]));
    gl.uniform3fv(c.loc.rim, (fx.rim ?? [0, 0, 0]).map((v) => v * k));
    gl.uniform1f(c.loc.rimW, (fx.rimWidth ?? 3) * px);
    const rd = fx.rimDir ?? [-1, 0];
    const rl = Math.hypot(rd[0], rd[1]) || 1;
    gl.uniform2f(c.loc.rimDir, rd[0] / rl, rd[1] / rl);
    gl.uniform1f(c.loc.shadow, (fx.shadow ?? 0) * Math.min(1, k));
    const so = fx.shadowOffset ?? [0, 0];
    gl.uniform2f(c.loc.shadowOff, so[0] * px, so[1] * px);
    gl.uniform1f(c.loc.shadowBlur, (fx.shadowBlur ?? 8) * px);
    gl.uniform1f(c.loc.opacity, fx.opacity ?? 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.STENCIL_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  ensureLayerBuffer(W, H) {
    const gl = this.gl;
    if (this.layerBuf && this.layerBuf.w === W && this.layerBuf.h === H) return this.layerBuf;
    if (this.layerBuf) {
      gl.deleteFramebuffer(this.layerBuf.fbo);
      gl.deleteTexture(this.layerBuf.tex);
      gl.deleteRenderbuffer(this.layerBuf.rb);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, W, H);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.layerBuf = { fbo, tex, rb, w: W, h: H };
    return this.layerBuf;
  }

  createCompositor() {
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, LIT_VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, LIT_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const u = (n) => gl.getUniformLocation(prog, n);
    return {
      prog,
      vao: gl.createVertexArray(), // 정점 없이 gl_VertexID 로 화면 전체 삼각형
      loc: {
        tex: u('u_tex'), px: u('u_px'), top: u('u_top'), bottom: u('u_bottom'), rim: u('u_rim'), rimW: u('u_rimW'),
        rimDir: u('u_rimDir'), shadow: u('u_shadow'), shadowOff: u('u_shadowOff'), shadowBlur: u('u_shadowBlur'), opacity: u('u_opacity'),
      },
    };
  }
}

// 이미지 범위(w×h px)를 덮는 격자 메쉬. 완전히 투명한 칸은 건너뛴다.
export function gridMesh(x, y, w, h, alpha, cell = 24) {
  const cols = Math.max(1, Math.min(64, Math.ceil(w / cell)));
  const rows = Math.max(1, Math.min(64, Math.ceil(h / cell)));
  const positions = new Float32Array((cols + 1) * (rows + 1) * 2);
  const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
  let k = 0;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const v = j / rows;
      positions[k] = x + u * w;
      positions[k + 1] = y + v * h;
      uvs[k] = u;
      uvs[k + 1] = v;
      k += 2;
    }
  }
  const idx = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (alpha && !cellHasAlpha(alpha, i, j, cols, rows)) continue;
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const indices = positions.length / 2 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { positions, uvs, indices, cols, rows };
}

// alpha: { data: Uint8ClampedArray(RGBA), width, height } — 이웃 칸까지 포함해 판정(가장자리 보호)
function cellHasAlpha(alpha, i, j, cols, rows) {
  const { data, width, height } = alpha;
  const x0 = Math.floor(((i - 1) / cols) * width);
  const x1 = Math.ceil(((i + 2) / cols) * width);
  const y0 = Math.floor(((j - 1) / rows) * height);
  const y1 = Math.ceil(((j + 2) / rows) * height);
  for (let yy = Math.max(0, y0); yy < Math.min(height, y1); yy += 2) {
    for (let xx = Math.max(0, x0); xx < Math.min(width, x1); xx += 2) {
      if (data[(yy * width + xx) * 4 + 3] > 0) return true;
    }
  }
  return false;
}
