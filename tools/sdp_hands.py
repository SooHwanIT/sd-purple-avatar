# sd_purple: 사용자가 준 손 파츠 시트(sheets/hands_sheet.webp, 4줄 × 3쌍)를 잘라 손 스프라이트로 → model_sd_purple/sprites/hand_*.png + sprites/hands.json
# 손(살색 + 그 둘레 외곽선)만 남기고 소매 끝(어두운 띠)·효과 표시(보라 선·!)는 뺀다. 소매는 원래 팔 그림이 담당.
# 저장 정보: w,h (모델 px), ax,ay (손목 축 자리, 스프라이트 왼쪽 위 기준 모델 px), vx,vy (소매→손끝 방향 단위 벡터). 런타임이 팔 방향에 맞춰 돌려 붙임.
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = r'C:\Users\happy\Downloads\boy'
SRC = ROOT + r'\source\vtuber\sd_purple\sheets\hands_sheet.webp'
OUT = ROOT + r'\avatar\public\model_sd_purple\sprites'
TARGET_CUFF = 100.0  # 모델 px: 원래 팔 소매 끝 높이(≈110)보다 조금 작게 → 손 폭이 원래 둥근 손(≈82)과 비슷
a = np.array(Image.open(SRC).convert('RGBA')).astype(np.float32)
H, W = a.shape[:2]
m = a[..., 3] > 30
lum = a[..., :3].mean(2)
skin = (a[..., 0] > 195) & (a[..., 1] > 165) & (a[..., 2] > 150) & m
dark = (lum < 95) & m
purple = (a[..., 2] > a[..., 1] + 60) & (a[..., 0] > 90) & m  # 소매 보라 띠·효과 선
lb, n = ndi.label(ndi.binary_dilation(m, iterations=6))
pieces = []
for i, sl in enumerate(ndi.find_objects(lb)):
    mm = (lb[sl] == i + 1) & m[sl]
    if mm.sum() < 3000 or (skin[sl] & mm).sum() < 2000:
        continue
    ys, xs = np.nonzero(mm)
    pieces.append(dict(x0=sl[1].start + xs.min(), y0=sl[0].start + ys.min(), x1=sl[1].start + xs.max() + 1, y1=sl[0].start + ys.max() + 1, lab=i + 1, sl=sl))
COLS = [125, 355, 605, 850, 1095, 1330]
ROWS = [150, 395, 665, 930]
POSE = {(0, 1): 'relax', (0, 2): 'fist', (1, 0): 'point', (1, 1): 'v', (1, 2): 'heart', (2, 0): 'spread', (2, 1): 'open', (2, 2): 'palm', (3, 0): 'pinch', (3, 1): 'grab'}
# 소매 폭(축에 수직)의 중앙값으로 공통 배율
def cuff_width(p):
    sub = (lb == p['lab'])
    sk = skin & sub
    near = ndi.binary_dilation(sk, iterations=14)
    cuff = dark & sub & ~near | (purple & sub & ~near)
    if cuff.sum() < 200 or sk.sum() < 200:
        return None, None, None
    cy, cx = ndi.center_of_mass(cuff)
    sy, sx = ndi.center_of_mass(sk)
    v = np.array([sx - cx, sy - cy]); v /= np.linalg.norm(v)
    ys, xs = np.nonzero(cuff)
    perp = -(xs - cx) * v[1] + (ys - cy) * v[0]
    return float(np.percentile(perp, 97) - np.percentile(perp, 3)), v, (cx, cy)
widths = [cuff_width(p)[0] for p in pieces]
widths = [w for w in widths if w]
SC = TARGET_CUFF / float(np.median(widths))
print('pieces', len(pieces), 'median cuff width', round(float(np.median(widths)), 1), 'scale', round(SC, 3))
os.makedirs(OUT, exist_ok=True)
sprites = {}
for p in pieces:
    cx = (p['x0'] + p['x1']) / 2; cy = (p['y0'] + p['y1']) / 2
    col = int(np.argmin([abs(cx - c) for c in COLS])); row = int(np.argmin([abs(cy - r) for r in ROWS]))
    pose = POSE.get((row, col // 2))
    if not pose:
        continue
    side = 'r' if col % 2 == 0 else 'l'
    sub = (lb == p['lab'])
    sk = skin & sub
    # 손 = 살색 + 살색 둘레 14px 안의 어두운 픽셀(외곽선) + 살색 3px 안의 반투명 가장자리. 소매·보라 효과는 뺌
    near = ndi.binary_dilation(sk, iterations=14)
    keep = sk | (dark & near & ~purple) | (ndi.binary_dilation(sk, iterations=3) & m)
    keep &= sub
    # 살색과 이어진 덩어리만 (버클·보라 효과 선·'!' 처럼 떨어진 조각은 뺌)
    lk, nk = ndi.label(keep)
    good = np.unique(lk[sk & keep]); good = good[good > 0]
    keep &= np.isin(lk, good)
    # 소매 쪽: 손바닥에서 소매 중심 방향으로 깊이 들어간 외곽선은 자름 (소매 윗선이 손에 붙어 남지 않게)
    w_, v, cc = cuff_width(p)
    if v is None:
        continue
    ys, xs = np.nonzero(keep)
    proj = (xs - cc[0]) * v[0] + (ys - cc[1]) * v[1]
    sks = np.nonzero(sk)
    smin = float(np.min((sks[1] - cc[0]) * v[0] + (sks[0] - cc[1]) * v[1]))
    cut = proj < smin - 4
    keep[ys[cut], xs[cut]] = False
    ys, xs = np.nonzero(keep)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    piece = a[y0:y1, x0:x1].copy()
    piece[~keep[y0:y1, x0:x1]] = 0
    # 손목 축: 살색을 축에 투영한 최소값 자리 + 6px (소매 끝에 닿는 손목)
    ax = cc[0] + v[0] * (smin + 6) - x0; ay = cc[1] + v[1] * (smin + 6) - y0
    w, h = (x1 - x0) * SC, (y1 - y0) * SC
    im = Image.fromarray(np.clip(piece, 0, 255).astype(np.uint8)).resize((max(2, int(round(w * 2))), max(2, int(round(h * 2)))), Image.LANCZOS)
    name = f'hand_{side}_{pose}'
    im.save(os.path.join(OUT, name + '.png'))
    sprites[name] = dict(file=f'sprites/{name}.png', w=round(w, 2), h=round(h, 2), cx=0, cy=0, ax=round(ax * SC, 2), ay=round(ay * SC, 2), vx=round(float(v[0]), 4), vy=round(float(v[1]), 4), hand=True)
json.dump(sprites, open(OUT + r'\hands.json', 'w'), indent=1)
print(len(sprites), 'hand sprites:', sorted(sprites))
