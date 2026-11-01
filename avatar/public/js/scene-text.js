// 배경 속 빈칸에 글 쓰기: 액자(공지·최근 채팅)와 음악 표시줄(곡 제목). 2D 캔버스에 그려 텍스처로 올린다.
// 위치는 scene.json 의 "slots" (그림 기준 좌표). 글씨는 2배 해상도로 그려 확대해도 또렷하게.
// 액자 장식(framedeco.png)은 글보다 위에 그려지므로, 글이 판 가장자리·보석 장식 뒤로 자연스럽게 가려진다.

const FONT = '"Pretendard Variable", Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const SCALE = 2;

// 글꼴: 스튜디오와 같은 Pretendard (OBS 화면에서도). 다 읽히면 다시 그린다.
let fontVersion = 0;
if (typeof FontFace !== 'undefined' && !document.fonts?.check?.('16px "Pretendard Variable"')) {
  new FontFace('Pretendard Variable', 'url(vendor/fonts/PretendardVariable.woff2)', { weight: '45 920' })
    .load()
    .then((f) => {
      document.fonts.add(f);
      fontVersion++;
    })
    .catch(() => {});
}

// 이모티콘·배지 그림: 내 PC 서버(/api/img)를 거쳐 받는다 (다른 주소 그림은 텍스처로 올릴 수 없음)
const images = new Map(); // 주소 → { img, ok }
let imageVersion = 0;
function image(url) {
  if (!url) return null;
  let e = images.get(url);
  if (!e) {
    const img = new Image();
    e = { img, ok: false };
    images.set(url, e);
    img.onload = () => {
      e.ok = true;
      imageVersion++;
    };
    img.src = `api/img?u=${encodeURIComponent(url)}`;
    if (images.size > 300) images.delete(images.keys().next().value);
  }
  return e.ok ? e.img : null;
}

// 닉네임 색: 사람마다 정해진 색 (치지직 채팅창처럼)
const NICK_COLORS = ['#ffb36b', '#ff8fb1', '#8fd3ff', '#c3a6ff', '#7ee0b0', '#ffd36b', '#ff9d7a', '#9fb4ff', '#f7a8ff', '#a6e3ff'];
function nickColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return NICK_COLORS[h % NICK_COLORS.length];
}

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    // 띄어쓰기 단위로 채우고, 한 낱말이 한 줄보다 길 때만 글자 단위로 자른다 (낱말 가운데서 줄이 바뀌지 않게)
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const test = line + word;
      if (ctx.measureText(test).width <= maxW || !line.trim()) {
        line = test;
      } else {
        lines.push(line.trimEnd());
        line = /^\s+$/.test(word) ? '' : word;
      }
      // 낱말 하나가 너무 길면 글자 단위로
      while (ctx.measureText(line).width > maxW && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxW) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 채팅 한 줄을 조각으로: 배지 그림 · 닉네임 · 글자 · 이모티콘 그림
function pieces(it) {
  const out = [];
  for (const b of it.badges ?? []) out.push({ type: 'img', url: b, size: 17 });
  out.push({ type: 'nick', text: it.kind === 'donation' ? `♥ ${it.nick}` : it.nick });
  const emojis = it.emojis ?? {};
  const re = /\{:([\w-]+):\}/g;
  const msg = String(it.msg ?? '');
  let last = 0;
  let m;
  while ((m = re.exec(msg))) {
    if (m.index > last) out.push({ type: 'text', text: msg.slice(last, m.index) });
    if (emojis[m[1]]) out.push({ type: 'img', url: emojis[m[1]], size: 24 });
    last = m.index + m[0].length;
  }
  if (last < msg.length) out.push({ type: 'text', text: msg.slice(last) });
  return out;
}

// 조각들을 maxW 안에서 줄을 나눠 배치: [[{type, x, w, …}], …]
function layout(ctx, parts, maxW) {
  const lines = [[]];
  let x = 0;
  const push = (p, w) => {
    if (x + w > maxW && x > 0) {
      lines.push([]);
      x = 0;
    }
    lines[lines.length - 1].push({ ...p, x, w });
    x += w;
  };
  for (const p of parts) {
    if (p.type === 'img') push(p, p.size + 3);
    else if (p.type === 'nick') {
      ctx.font = `700 13.5px ${FONT}`;
      push(p, ctx.measureText(p.text).width + 7);
    } else {
      ctx.font = `500 14px ${FONT}`;
      // 글자 단위로 넣어 한글도 줄바꿈 (같은 줄의 연속 글자는 한 조각으로 합침)
      let run = '';
      let runX = x;
      for (const ch of p.text) {
        const w = ctx.measureText(run + ch).width;
        if (runX + w > maxW && (run || x > 0)) {
          if (run) lines[lines.length - 1].push({ type: 'text', text: run, x: runX, w: ctx.measureText(run).width });
          lines.push([]);
          x = 0;
          runX = 0;
          run = ch === ' ' ? '' : ch;
        } else {
          run += ch;
        }
      }
      if (run) {
        const w = ctx.measureText(run).width;
        lines[lines.length - 1].push({ type: 'text', text: run, x: runX, w });
        x = runX + w;
      }
    }
  }
  return lines;
}

// 액자: 공지 또는 최근 채팅
export class FramePanel {
  constructor(slot) {
    this.slot = slot; // { x, y, w, h }
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(slot.w * SCALE);
    this.canvas.height = Math.round(slot.h * SCALE);
    this.ctx = this.canvas.getContext('2d');
    this.key = '';
  }

  // show: 'notice' | 'chat' | 'both'(위 공지 · 아래 채팅), notice: 문자열, chat: [{ nick, msg, kind, uid, emojis, badges, color }]
  draw(show, notice, chat) {
    const key = JSON.stringify([show, notice, chat, fontVersion, show !== 'notice' ? imageVersion : 0]);
    if (key === this.key) return false;
    this.key = key;
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.scale(SCALE, SCALE);
    const w = W / SCALE;
    const h = H / SCALE;
    ctx.textBaseline = 'middle';
    if (show === 'chat') this.drawChat(ctx, w, h, chat ?? []);
    else if (show === 'both') this.drawBoth(ctx, w, h, notice.trim(), chat ?? []);
    else if (notice && notice.trim()) this.drawNotice(ctx, w, h, notice.trim());
    return true;
  }

  // 말풍선을 아래에서부터 쌓는다 (최신이 맨 아래). 위로 밀린 것은 판 위쪽 장식 뒤로 사라진다.
  drawChat(ctx, w, h, chat, minY = -40) {
    const margin = 12;
    const padX = 10;
    const padY = 7;
    const lineH = 22;
    const gap = 7;
    const maxW = w - margin * 2 - padX * 2;
    let y = h - margin - 4;
    const items = [...chat].reverse();
    for (let i = 0; i < items.length && y > minY; i++) {
      const it = items[i];
      const donation = it.kind === 'donation';
      const lines = layout(ctx, pieces(it), maxW);
      const bw = Math.min(maxW, Math.max(...lines.map((ln) => (ln.length ? ln[ln.length - 1].x + ln[ln.length - 1].w : 0)))) + padX * 2;
      const bh = lines.length * lineH + padY * 2;
      y -= bh;
      ctx.globalAlpha = Math.max(0.55, 1 - i * 0.06);
      // 말풍선
      roundRect(ctx, margin, y, bw, bh, 10);
      ctx.fillStyle = donation ? 'rgba(64, 46, 18, 0.88)' : 'rgba(16, 14, 22, 0.82)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = donation ? 'rgba(255, 205, 120, 0.55)' : 'rgba(190, 160, 255, 0.14)';
      ctx.stroke();
      // 내용
      const color = donation ? '#ffd48a' : it.color || nickColor(it.uid ?? it.nick);
      lines.forEach((ln, k) => {
        const cy = y + padY + lineH * k + lineH / 2;
        for (const p of ln) {
          const px = margin + padX + p.x;
          if (p.type === 'img') {
            const img = image(p.url);
            if (img) ctx.drawImage(img, px, cy - p.size / 2, p.size, p.size);
          } else if (p.type === 'nick') {
            ctx.font = `700 13.5px ${FONT}`;
            ctx.fillStyle = color;
            ctx.fillText(p.text, px, cy);
          } else {
            ctx.font = `500 14px ${FONT}`;
            ctx.fillStyle = donation ? '#fff1d6' : '#efe9f7';
            ctx.fillText(p.text, px, cy);
          }
        }
      });
      ctx.globalAlpha = 1;
      y -= gap;
    }
  }

  // 위에는 공지 상자(글 줄 수만큼, 판 높이의 45%까지), 아래 남는 곳에는 채팅. 채팅이 넘치면 공지 상자 밑에서 부드럽게 사라짐
  drawBoth(ctx, w, h, notice, chat) {
    const side = 10;
    const top = 38; // 판 위 가운데 보석 장식 아래부터
    const padY = 15;
    const font = `600 19px ${FONT}`;
    ctx.font = font;
    const lines = wrap(ctx, notice, w - side * 2 - 24).slice(0, 8);
    const lineH = 28;
    const boxH = Math.min(h * 0.5, padY * 2 + lines.length * lineH);
    const chatTop = top + boxH + 10;
    // 채팅 (공지 상자 아래 칸에만)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, chatTop, w, h - chatTop);
    ctx.clip();
    this.drawChat(ctx, w, h, chat, chatTop - 60);
    ctx.restore();
    const fade = ctx.createLinearGradient(0, chatTop, 0, chatTop + 22);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, chatTop, w, 22);
    ctx.globalCompositeOperation = 'source-over';
    // 공지 상자
    roundRect(ctx, side, top, w - side * 2, boxH, 12);
    ctx.fillStyle = 'rgba(34, 26, 50, 0.86)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(190, 160, 255, 0.38)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = font;
    ctx.fillStyle = '#f3ecfc';
    ctx.shadowColor = 'rgba(150, 100, 255, 0.5)';
    ctx.shadowBlur = 6;
    // 상자에 다 안 들어가는 줄은 뺀다
    const fit = Math.max(1, Math.floor((boxH - padY * 2 + 2) / lineH));
    lines.slice(0, fit).forEach((ln, i) => ctx.fillText(ln, w / 2, top + padY + lineH * i + lineH / 2));
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
  }

  drawNotice(ctx, w, h, notice) {
    const pad = 22;
    ctx.textAlign = 'center';
    ctx.font = `600 21px ${FONT}`;
    const lines = wrap(ctx, notice, w - pad * 2).slice(0, 15);
    const lineH = 32;
    const total = lines.length * lineH;
    let y = Math.max(pad + 40, (h - total) / 2 + lineH / 2);
    ctx.fillStyle = '#f3ecfc';
    ctx.shadowColor = 'rgba(150, 100, 255, 0.55)';
    ctx.shadowBlur = 8;
    for (const ln of lines) {
      ctx.fillText(ln, w / 2, y);
      y += lineH;
    }
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
  }
}

// 음악 표시줄의 곡 제목 (길면 천천히 흘러감). sub: 가수 등 (조금 흐리게)
export class SongTitle {
  constructor(slot) {
    this.slot = slot;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(slot.w * SCALE);
    this.canvas.height = Math.round(slot.h * SCALE);
    this.ctx = this.canvas.getContext('2d');
    this.key = '';
  }

  draw(title, t, sub = '') {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const big = `600 ${Math.round(H * 0.44)}px ${FONT}`;
    const small = `500 ${Math.round(H * 0.36)}px ${FONT}`;
    ctx.font = big;
    const main = title ? `♪  ${title}` : '';
    const mw = ctx.measureText(main).width;
    ctx.font = small;
    const tail = title && sub ? `   ${sub}` : '';
    const tw = mw + (tail ? ctx.measureText(tail).width : 0);
    const scroll = tw > W;
    const gap = W * 0.35;
    const off = scroll ? (t * 60 * SCALE) % (tw + gap) : 0;
    const key = `${main}|${tail}|${Math.round(off)}|${fontVersion}`;
    if (key === this.key) return false;
    this.key = key;
    ctx.clearRect(0, 0, W, H);
    if (!main) return true;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(160, 110, 255, 0.6)';
    ctx.shadowBlur = 6 * SCALE;
    for (const base of scroll ? [-off, -off + tw + gap] : [0]) {
      ctx.font = big;
      ctx.fillStyle = '#efe6fb';
      ctx.fillText(main, base, H / 2);
      if (tail) {
        ctx.font = small;
        ctx.fillStyle = 'rgba(215, 198, 240, 0.75)';
        ctx.fillText(tail, base + mw, H / 2 + 1);
      }
    }
    // 양 끝을 부드럽게 흐리게
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'destination-out';
    const fade = W * 0.06;
    for (const [x0, x1] of [[0, fade], [W, W - fade]]) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(x0, x1), 0, fade, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    return true;
  }
}

// 재생 막대용: 가운데가 밝고 위아래로 옅어지는 가로 띠
export function barSprite(color = [196, 160, 255]) {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  const [r, gg, b] = color;
  g.addColorStop(0, `rgba(${r},${gg},${b},0)`);
  g.addColorStop(0.5, `rgba(${r},${gg},${b},1)`);
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 32);
  return c;
}
