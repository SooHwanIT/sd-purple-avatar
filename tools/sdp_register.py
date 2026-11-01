# sd_purple: 사용자가 준 파츠(parts_in/*.png)를 원본(ref)에 맞춰 정렬 → parts_aligned/<이름>.png (1508×2000) + register.json
# 파츠마다 그린 틀(배율·위치)이 달라, 원본에서 보이는 같은 부위의 외곽선끼리 맞춘다 (배율 후보 × 위치를 마스크 템플릿 매칭).
#  - back_hair: 머리카락 전체 외곽선·보라 줄무늬
#  - face_skin: 아래쪽 절반(턱·볼 윤곽, 귀)만 — 위쪽 머리통은 원본에서 머리카락에 가려 비교할 수 없음
#  - ears: 귀 하나씩 따로 (오른쪽 귀에는 귀걸이가 붙어 있음)
#  - neck_collar_shoulders: 셔츠 깃·넥타이 매듭·재킷 깃 선
#   python tools/sdp_register.py
import json, os
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

D = r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple'
IN = D + r'\parts_in'
OUT = D + r'\parts_aligned'
os.makedirs(OUT, exist_ok=True)
ref = np.array(Image.open(D + r'\work\ref_rgba.png')).astype(np.float32)
H, W = ref.shape[:2]
lab = np.load(D + r'\work\labels.npz')
L = lab['label']
O = [str(x) for x in lab['order']]
V = lambda *ns: np.isin(L, [O.index(n) for n in ns])


def grad_img(rgba, alpha_only=False):
    a = rgba[..., 3]
    ax = cv2.Sobel(a, cv2.CV_32F, 1, 0, ksize=3)
    ay = cv2.Sobel(a, cv2.CV_32F, 0, 1, ksize=3)
    m = np.sqrt(ax * ax + ay * ay) / 4
    if not alpha_only:
        g = (rgba[..., :3] * (a[..., None] / 255)).mean(2)
        gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
        m = np.maximum(m, np.sqrt(gx * gx + gy * gy))
    return cv2.GaussianBlur(np.minimum(m, 300), (0, 0), 2.5)


def mask_edge(m):
    return cv2.GaussianBlur((cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) * 255).astype(np.float32), (0, 0), 2.5)


def search(tpl, tmask, target, s_range, box, q=2):
    """tpl: 부분 좌표의 비교 그림(잘라 낸 것), target: 원본 좌표 그림, box: 원본에서 찾을 범위 (x0,y0,x1,y1)
    반환 (점수, s, x_off, y_off): 잘라 낸 부분의 (0,0) 이 원본 (x_off, y_off) 에, 배율 s"""
    bx0, by0, bx1, by1 = box
    tq = cv2.resize(target[by0:by1, bx0:bx1], ((bx1 - bx0) // q, (by1 - by0) // q), interpolation=cv2.INTER_AREA)
    best = (-2, None)
    for s in s_range:
        w = int(round(tpl.shape[1] * s / q)); h = int(round(tpl.shape[0] * s / q))
        if w < 6 or h < 6 or w >= tq.shape[1] or h >= tq.shape[0]:
            continue
        t = cv2.resize(tpl, (w, h), interpolation=cv2.INTER_AREA)
        mk = cv2.resize(tmask, (w, h), interpolation=cv2.INTER_AREA)
        r = cv2.matchTemplate(tq, t, cv2.TM_CCORR_NORMED, mask=mk)
        r[~np.isfinite(r)] = -2
        _, mv, _, ml = cv2.minMaxLoc(r)
        if mv > best[0]:
            best = (mv, (s, bx0 + ml[0] * q, by0 + ml[1] * q))
    return best


def place(P, s, ox, oy, crop_xy):
    cx, cy = crop_xy
    A = np.array([[s, 0, ox - cx * s], [0, s, oy - cy * s]], np.float32)
    return cv2.warpAffine(P, A, (W, H), flags=cv2.INTER_LINEAR), A


def load(n):
    return np.array(Image.open(os.path.join(IN, 'd_purple_' + n + '.png')).convert('RGBA')).astype(np.float32)


res = {}
G_ref = grad_img(ref)

# --- back_hair: 머리카락 전체 ---
P = load('back_hair')
ys, xs = np.nonzero(P[..., 3] > 30)
c = (xs.min(), ys.min()); crop = P[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
tgt = mask_edge(V('hair', 'hair_back', 'ahoge') | V('brow_r', 'brow_l'))
pur_ref = (ref[..., 2] > ref[..., 0] + 25) & (ref[..., 2] > 120) & (ref[..., 3] > 128) & V('hair', 'ahoge')
tgt = tgt + cv2.GaussianBlur(pur_ref.astype(np.float32) * 255, (0, 0), 2.5)
pur_p = (crop[..., 2] > crop[..., 0] + 25) & (crop[..., 2] > 120) & (crop[..., 3] > 128)
tpl = mask_edge(crop[..., 3] > 128) + cv2.GaussianBlur(pur_p.astype(np.float32) * 255, (0, 0), 2.5)
sc, (s, ox, oy) = search(tpl, np.ones_like(tpl), tgt, np.arange(0.70, 0.80, 0.005), (0, 0, W, 1300))
res['back_hair'] = place(P, s, ox, oy, c) + (sc,)

# --- face_skin: 턱·볼 윤곽 (아래 30%) 을 원본에서 보이는 턱선에 ---
P = load('face_skin')
ys, xs = np.nonzero(P[..., 3] > 30)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
ym = int(y0 + (y1 - y0) * 0.70)
crop = P[ym:y1, x0:x1]
tpl = mask_edge(crop[..., 3] > 128)
tpl[:14] = 0
ref_skin = ndi.binary_fill_holes(V('face', 'mouth', 'white_r', 'white_l', 'iris_r', 'iris_l', 'hl_r', 'hl_l', 'lid_r', 'lid_l', 'crease_r', 'crease_l', 'neck'))
jaw = mask_edge(ref_skin) * (np.mgrid[0:H, 0:W][0] > 950)
s0 = 746 / (x1 - x0)  # 귀 바깥 끝 사이 너비로 대략 배율
sc, (s, ox, oy) = search(tpl, np.ones_like(tpl), jaw, np.arange(s0 - 0.08, s0 + 0.08, 0.004), (300, 900, 1200, 1120))
res['face_skin'] = place(P, s, ox, oy, (x0, ym)) + (sc,)

# --- ears: 귀 하나씩, 원본에서 보이는 귀 외곽선(머리카락과 맞닿은 쪽 제외)에 ---
P = load('ears')
m = P[..., 3] > 128
lb, k = ndi.label(m)
sz = ndi.sum(m, lb, range(1, k + 1))
blobs = [i + 1 for i in np.argsort(-sz)[:2]]
blobs.sort(key=lambda i: np.nonzero(lb == i)[1].mean())
for side, bi in zip(['r', 'l'], blobs):
    bm = lb == bi
    ys, xs = np.nonzero(bm)
    pad = 6
    bx0, by0, bx1, by1 = xs.min() - pad, ys.min() - pad, xs.max() + pad + 1, ys.max() + pad + 1
    crop = P[by0:by1, bx0:bx1].copy()
    crop[~bm[by0:by1, bx0:bx1]] = 0
    em = V('ear_' + side)
    # 귀 외곽 중 배경·재킷과 맞닿은 부분만 (머리카락·얼굴과 맞닿은 쪽은 원본에서 가려진 경계)
    outer = cv2.morphologyEx(em.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
    near_cover = cv2.dilate(V('hair', 'hair_back', 'face', 'earring').astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    tgt = cv2.GaussianBlur(((outer & ~near_cover) * 255).astype(np.float32), (0, 0), 2.0)
    tpl = grad_img(crop, alpha_only=True)
    ry, rx = np.nonzero(em)
    box = (int(rx.min()) - 140, int(ry.min()) - 140, int(rx.max()) + 140, int(ry.max()) + 140)
    sc, (s, ox, oy) = search(tpl, (crop[..., 3] > 30).astype(np.float32), tgt, np.arange(0.45, 0.80, 0.004), box)
    Pm = np.zeros_like(P)
    Pm[bm] = P[bm]
    res['ear_' + side] = place(Pm, s, ox, oy, (bx0, by0)) + (sc,)
    res['ear_' + side + '_blob'] = (bm, (bx0, by0), sc)
# 오른쪽 귀(화면 왼쪽)는 윗부분이 원본에서 머리카락에 가려 외곽선 맞춤이 위로 미끄러짐 → 왼쪽 귀와 같은 배율로,
# 바깥 끝(왼쪽)·아래 끝을 원본에서 보이는 귀에 맞춤
bm, _, _ = res.pop('ear_r_blob')
_ = res.pop('ear_l_blob')
s_l = res['ear_l'][1][0, 0]
ys, xs = np.nonzero(bm)
ry, rx = np.nonzero(V('ear_r'))
tx = rx.min() - xs.min() * s_l
ty = ry.max() + 2 - ys.max() * s_l
Pm = np.zeros_like(P)
Pm[bm] = P[bm]
A = np.array([[s_l, 0, tx], [0, s_l, ty]], np.float32)
res['ear_r'] = (cv2.warpAffine(Pm, A, (W, H), flags=cv2.INTER_LINEAR), A, -1.0)

# --- neck_collar_shoulders: 깃·넥타이 선 ---
P = load('neck_collar_shoulders')
ys, xs = np.nonzero(P[..., 3] > 30)
c = (xs.min(), ys.min()); crop = P[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
tpl = grad_img(crop)
sc, (s, ox, oy) = search(tpl, (crop[..., 3] > 30).astype(np.float32), G_ref, np.arange(0.40, 0.90, 0.005), (380, 950, 1150, 1350))
res['neck_collar'] = place(P, s, ox, oy, c) + (sc,)

meta = {}
for n, (img, A, sc) in res.items():
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(OUT, n + '.png'))
    meta[n] = dict(score=float(sc), A=A.tolist(), scale=float(A[0, 0]))
    print(f'{n:14s} score {sc:.3f} scale {A[0, 0]:.3f} t {A[0, 2]:.1f},{A[1, 2]:.1f}')
json.dump(meta, open(OUT + r'\register.json', 'w'), indent=1)
