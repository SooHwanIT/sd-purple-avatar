# sd_purple 4단계: 부위 지도(labels.npz) → 레이어 그림 + 가려진 부분 채우기 → work/layers/*.png, work/layers.json
# 가려진 부분은 단색 면이라 그 부위의 바탕색으로 채우고, 실루엣이 가려진 곳에는 같은 굵기의 외곽선을 이어 그린다.
import json
import os
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

W0 = r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple\work'
OUT = W0 + r'\layers'
os.makedirs(OUT, exist_ok=True)
d = np.load(W0 + r'\labels.npz')
label = d['label']
ORDER = [str(x) for x in d['order']]
Z = {n: i for i, n in enumerate(ORDER)}
rg = np.load(W0 + r'\regions.npz')
line, fg = rg['line'], rg['fg']
src = np.array(Image.open(W0 + r'\ref_rgba.png')).astype(np.float32)
H, W = fg.shape
lum = src[..., :3].max(2)
YY, XX = np.mgrid[0:H, 0:W]


def vis(n):
    return label == Z[n]


def poly(pts):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m > 0


def ellipse(cx, cy, rx, ry, ang=0):
    m = np.zeros((H, W), np.uint8)
    cv2.ellipse(m, (int(round(cx)), int(round(cy))), (int(round(rx)), int(round(ry))), ang, 0, 360, 1, -1)
    return m > 0


def dil(m, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(m.astype(np.uint8), k) > 0


def ero(m, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.erode(m.astype(np.uint8), k) > 0


def median_color(m, lo=34):
    px = src[m & (lum >= lo)][:, :3]
    return np.median(px, 0) if len(px) else np.array([128, 128, 128])


def line_color(m):
    px = src[m & (lum < 34) & fg][:, :3]
    return np.median(px, 0) if len(px) else np.array([20, 16, 18])


def smooth_fill(srcmask, sigma=18):
    # 보이는 픽셀 색을 가우스 무게로 번져 가려진 곳을 채울 색 (단색보다 주변 음영에 맞음)
    w = srcmask.astype(np.float32)
    c = src[..., :3] * w[..., None]
    k = int(sigma * 3) | 1
    num = np.dstack([cv2.GaussianBlur(c[..., i], (k, k), sigma) for i in range(3)])
    den = cv2.GaussianBlur(w, (k, k), sigma)[..., None]
    return num / np.maximum(den, 1e-4), den[..., 0]


class Layer:
    def __init__(self, name):
        self.name = name
        self.img = np.zeros((H, W, 4), np.float32)
        m = vis(name)
        self.img[m] = src[m]
        self.img[m, 3] = src[m, 3]
        # 채워도 되는 곳: 원래 그림에서 이 부위보다 앞에 그려지는 부위에 가려진 곳만 (배경·뒤 부위 자리에는 절대 안 칠함)
        self.allow = fg & (label > Z[name])

    def fill(self, mask, color, alpha=255):
        m = mask & (self.img[..., 3] < 250) & self.allow
        c = np.asarray(color, np.float32)
        # 이미 반투명(가장자리)인 픽셀은 아래에 깔리는 색과 섞는다
        a = self.img[m, 3:4] / 255
        self.img[m, :3] = self.img[m, :3] * a + c[:3] * (1 - a)
        self.img[m, 3] = alpha
        return m

    def outline(self, full, hidden, width, color):
        # full 의 경계에서 width 안쪽이면서 hidden(원래 안 보이던 곳)인 픽셀 → 선 색
        dist = ndi.distance_transform_edt(full)
        hidden = hidden & self.allow
        m = full & hidden & (dist <= width)
        self.img[m, :3] = color
        self.img[m, 3] = 255
        # 선 안쪽 1px 은 반쯤 섞어 부드럽게
        m2 = full & hidden & (dist > width) & (dist <= width + 1.2)
        self.img[m2, :3] = self.img[m2, :3] * 0.5 + np.asarray(color) * 0.5

    def nearest(self, gap, srcmask):
        # gap 픽셀을 srcmask 의 가장 가까운 픽셀 색으로
        gap = gap & self.allow
        if not gap.any() or not srcmask.any():
            return
        _, (iy, ix) = ndi.distance_transform_edt(~srcmask, return_indices=True)
        self.img[gap, :3] = src[iy[gap], ix[gap], :3]
        self.img[gap, 3] = 255

    def vinterp(self, gap, srcmask, maxd=16):
        # 가는 가로선(눈썹) 아래: 위·아래 가장 가까운 srcmask 픽셀 사이를 세로로 보간
        ys, xs = np.nonzero(gap)
        for x in np.unique(xs):
            col = srcmask[:, x]
            for y in ys[xs == x]:
                up = next((y - k for k in range(1, maxd) if y - k >= 0 and col[y - k]), None)
                dn = next((y + k for k in range(1, maxd) if y + k < H and col[y + k]), None)
                if up is None and dn is None:
                    continue
                if up is None:
                    c = src[dn, x, :3]
                elif dn is None:
                    c = src[up, x, :3]
                else:
                    t = (y - up) / (dn - up)
                    c = src[up, x, :3] * (1 - t) + src[dn, x, :3] * t
                self.img[y, x, :3] = c
                self.img[y, x, 3] = 255

    def feather(self, edge_mask, width):
        # 다른 부위와 맞닿아 자른 경계를 부드럽게 (edge_mask 쪽으로 갈수록 투명)
        a = self.img[..., 3] > 0
        dist = ndi.distance_transform_edt(~edge_mask)
        k = np.clip(dist / width, 0, 1)
        self.img[a, 3] *= k[a]


layers = {}
info = {}

# ---------- 얼굴 ----------
face = Layer('face')
skin = median_color(vis('face') & (lum > 230) & (src[..., 0] > 240))
face_line = line_color(dil(vis('face'), 2) & ~vis('face') & (YY > 980) & (YY < 1050) & (XX > 600) & (XX < 900) & (label == Z['face']) | (vis('face') & (lum < 34) & (YY > 990)))
print('skin', skin, 'face line', face_line)
FACE_E = dict(cx=747, cy=815, rx=292, ry=258)
face_ell = ellipse(FACE_E['cx'], FACE_E['cy'], FACE_E['rx'], FACE_E['ry'])
face_vis = vis('face')
under = ['mouth', 'white_r', 'white_l', 'iris_r', 'iris_l', 'hl_r', 'hl_l', 'lid_r', 'lid_l', 'crease_r', 'crease_l']
face_full = face_vis | (face_ell & (YY < 960)) | np.isin(label, [Z[n] for n in under])
face_full = ndi.binary_fill_holes(face_full)
# 볼 옆 머리 밑: 볼 윤곽선 이어 그리기 (y 760~1000 의 가려진 경계만)
hidden = face_full & ~face_vis
face.fill(face_full, skin)
# 가려진 피부(눈·입·앞머리 밑)는 주변 피부 음영을 부드럽게 번진 색으로 (깨끗한 피부 픽셀만 재료)
# 눈가의 은은한 분홍 톤까지 재료로 (빼면 가려진 곳이 주변보다 하얗게 떠 보임). 진한 볼 빗금(초록 < 200)만 뺌
clean_skin = face_vis & (lum > 200) & (src[..., 1] > 200) & ~dil(np.isin(label, [Z[n] for n in under + ['hair']]), 3)
sf, sd = smooth_fill(clean_skin, 16)
sf2, sd2 = smooth_fill(clean_skin, 40)
fillc = np.where((sd > 0.05)[..., None], sf, np.where((sd2 > 0.01)[..., None], sf2, skin))
fh = hidden & face.allow
face.img[fh, :3] = fillc[fh]
# 눈·쌍꺼풀 선·입 둘레 2~4px 의 섞인 테두리 픽셀도 번진 피부색으로 (눈을 감으면 떠 있던 눈 윤곽이 남지 않게)
eye_parts = np.isin(label, [Z[n] for n in ['white_r', 'white_l', 'iris_r', 'iris_l', 'hl_r', 'hl_l', 'lid_r', 'lid_l', 'crease_r', 'crease_l', 'mouth']])
ring = face_vis & (dil(eye_parts, 4) | dil(vis('mouth'), 9)) & ~(src[..., 1] < 200)
face.img[ring, :3] = fillc[ring]
# 피부 전체를 같은 번진 색으로 통일 (원본의 미세한 얼룩과 채운 곳의 경계가 움직일 때 비치지 않게). 홍조·선은 원본 그대로
fine = cv2.GaussianBlur(np.where(clean_skin[..., None], src[..., :3], fillc), (0, 0), 3)
keep = face_vis & ((lum < 200) | ((src[..., 1] < 214) & (src[..., 0] > 200)))
uni = face_full & (face.img[..., 3] > 0) & ~keep
face.img[uni, :3] = fine[uni]
# 원래 입 둘레의 옅은 선 자국(밝기 < 200 이라 선으로 남겨 두던 것)도 지움 — 입은 런타임이 다시 그림
mring = face_full & dil(vis('mouth'), 14) & (face.img[..., 3] > 0)
face.img[mring, :3] = fine[mring]
# 얼굴 안쪽(윤곽선에서 14px 넘게 떨어진 곳)의 어두운 점·선(머리카락 끝 조각) → 피부 (앞머리가 움직이면 드러남)
deep = ndi.distance_transform_edt(face_full) > 14
stray = deep & (face.img[..., 3] > 0) & (face.img[..., :3].max(2) < 170)
face.img[stray, :3] = fine[stray]
# 머리카락·눈·눈썹과 맞닿은 피부 가장자리(안티에일리어싱 섞인 픽셀) → 깨끗한 피부색 (앞머리가 움직여도 자국 없음)
others = np.isin(label, [Z[n] for n in ['hair', 'brow_r', 'brow_l', 'lid_r', 'lid_l', 'white_r', 'white_l', 'iris_r', 'iris_l', 'hl_r', 'hl_l', 'crease_r', 'crease_l', 'mouth', 'earring']])
dirty = face_vis & dil(others, 4) & ~(np.abs(src[..., :3] - skin).max(2) < 14)
# 쌍꺼풀 선·입 둘레의 옅은 분홍 번짐까지 (움직이면 자국으로 보임)
dirty |= face_vis & dil(np.isin(label, [Z['crease_r'], Z['crease_l'], Z['mouth']]), 6) & ~(np.abs(src[..., :3] - skin).max(2) < 5)
blush = face_vis & (src[..., 1] < 215) & (src[..., 0] > 200) & ~dil(others, 2)
face.img[dirty & ~blush, :3] = fine[dirty & ~blush]
# 그 가장자리 픽셀은 앞 부위(머리카락·눈꺼풀·눈썹)의 반투명 선으로 옮김: 알파 = (피부 밝기 − 픽셀 밝기) / (피부 − 선 밝기)
edge_moves = []


def edge_transfer(dirty_m, base_col, fronts):
    fm = np.isin(label, [Z[n] for n in fronts])
    _, (oy, ox) = ndi.distance_transform_edt(~fm, return_indices=True)
    own = label[oy, ox]
    bl = float(np.max(base_col))
    for n in fronts:
        # 실제로 맞닿은 것만 (멀리 있는 입 둘레가 머리카락으로 가던 것). 머리카락은 굵은 몸통 근처만 — 가는 띠에 붙은 것까지 옮기면
        # 눈꺼풀 띠가 내려갈 때 옅은 점선으로 남음
        near_n = dil(cv2.morphologyEx(vis(n).astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0, 4) if n == 'hair' else dil(vis(n), 4)
        m = dirty_m & (own == Z[n]) & near_n
        if not m.any():
            continue
        lc_ = line_color(dil(vis(n), 2) & vis(n)) if n in ('hair', 'face') else np.array([4, 3, 4], np.float32)
        a = np.clip((bl - lum[m]) / max(1.0, bl - float(lc_.max())), 0, 1)
        edge_moves.append((n, m, lc_, a))


edge_transfer(dirty & ~blush, skin, ['hair', 'lid_r', 'lid_l', 'brow_r', 'brow_l'])
side = hidden & (YY > 760) & (YY < 1000)
face.outline(face_full, side, 9, face_line)
layers['face'] = face
info['face'] = dict(ellipse=FACE_E)

# 눈썹 밑 채우기: 열마다 눈썹 위·아래 이웃 부위를 보고 — 둘 다 머리카락이면 머리카락, 둘 다 피부면 피부, 섞이면 반씩
hair = Layer('hair')
hz, fz = Z['hair'], Z['face']
# 눈썹(+둘레 2px) 밑: 주변 15×7 범위에서 머리카락이 많으면 머리카락, 피부가 많으면 피부로 채움
# (위·아래 한 점만 보면 가는 머리카락 다발을 지나는 곳에서 틀려, 눈썹이 움직이면 옛 자리에 흰 줄이 보였음)
brow_any = vis('brow_r') | vis('brow_l')
bring = dil(brow_any, 2) & np.isin(label, [Z['brow_r'], Z['brow_l'], hz, fz])
# 눈썹 자리의 주인: 눈썹(+2px) 바깥에서 가장 가까운 픽셀의 부위를 따라감(보로노이 채움). 15×7 다수결은 다발 사이 피부 틈에
# 어두운 띠·회색 체크무늬를 남겨 눈썹을 올리면 옛 자리에 줄이 보였다 (2026-11-01)
_band = dil(brow_any, 2)
_, (_ny, _nx) = ndi.distance_transform_edt(_band, return_indices=True)
near_lab = label[_ny, _nx]
own_h = bring & (near_lab == hz)
own_f = bring & ~own_h
# 재료는 머리카락다운 색만 (어둡거나 보라). 피부와 맞닿은 밝은 안티에일리어싱 픽셀도 '머리카락' 라벨이라 섞이면 회색이 되어,
# 눈썹을 올리면 옛 자리에 회색 줄이 남았다 (2026-11-01)
hsrc = (label == hz) & ~dil(brow_any, 2) & ero(label == hz, 1) & ((lum < 110) | (src[..., 2] > src[..., 0] + 25))
# 색은 가장 가까운 재료 픽셀을 그대로 복사 (가우스 평균은 보라 줄무늬 옆에서 연보라가 되어 눈썹을 올리면 밝은 줄로 남았다)
_, (_hy, _hx) = ndi.distance_transform_edt(~hsrc, return_indices=True)
hc = src[_hy, _hx, :3]
# 원래 보이던 머리카락 픽셀은 그대로 두고, 눈썹에 가려졌던 곳과 눈썹 테두리 1px(눈썹 색이 섞인 픽셀)만 채움
fill_h = own_h & ((label != hz) | (dil(brow_any, 2) & (lum > 70)))  # 눈썹 둘레 2px 의 밝은(피부가 섞인) 머리카락 픽셀도 바꿈 — 눈썹을 올리면 밝은 점선으로 남았음
hair.img[fill_h, :3] = hc[fill_h]
hair.img[fill_h, 3] = 255
hair.img[own_f & (label != hz)] = 0
face.img[bring, :3] = fine[bring]
face.img[bring, 3] = 255
er = vis('earring')
_, (iy, ix) = ndi.distance_transform_edt(er | ~fg, return_indices=True)
lab_near = label[iy, ix]
layers['hair'] = hair

# ---------- 뒷머리 (얼굴 뒤 어두운 채움) ----------
hb = Layer('hair_back')
hair_col = median_color(vis('hair'))
head_sil = ndi.binary_fill_holes(np.isin(label, [Z[n] for n in ['hair', 'face', 'ear_r', 'ear_l', 'brow_r', 'brow_l', 'hair_back'] + under]))
# 얼굴 뒤만 (귀 바깥·머리카락 아래 끝으로는 안 나오게: 머리카락·얼굴 영역 안쪽 30px)
hf_sil = ndi.binary_fill_holes(np.isin(label, [Z[n] for n in ['hair', 'face', 'brow_r', 'brow_l'] + under]))
hb_full = (dil(face_full, 60) & ero(hf_sil, 30) & (YY < 1000)) | vis('hair_back')
# 얼굴 아래쪽(턱선까지)도 채움: 고개를 들면 턱이 올라가 턱선과 옷깃 사이로 배경이 비치던 구멍. 목 자리는 비워 둠(목이 보여야 함)
neck_col = (XX >= 694) & (XX <= 814) & (YY >= 950)  # 목 기둥(고개를 들면 드러남): 머리 폭의 18% 쯤 — 좁으면 턱 밑이 온통 어두운 뒷머리로 보임
hb_full |= ndi.binary_fill_holes(face_full | vis('hair_back')) & (YY >= 880) & ~neck_col
# 귀 둘레·머리카락 바깥 띠 밑도 채움 (img2rig 의 overlap 채우기: 움직이면 아래 부위가 드러나게, 빈 배경 말고).
# 고개를 돌리거나 들면 귀·옆머리·귀걸이와 어깨 사이로 배경이 비치던 구멍 → 평소 덮여 있는 곳(allow)만
ears = vis('ear_r') | vis('ear_l')
hb_full |= dil(ears, 34) | (dil(face_full | ears, 70) & ero(hf_sil | dil(ears, 20), 10) & (YY < 1040))
# 머리 실루엣 전체(윤곽선 4px 안쪽)도 채움: 고개를 숙이면 머리 윗선이 내려가 그 뒤로 배경이 비쳤다(정수리 초승달 틈).
# 드러나는 가장자리에는 뒷머리 자체 윤곽선을 둬 '뒤에 머리카락이 한 겹 더 있는' 그림으로 보이게 (2026-11-01, 사용자: 필요하면 그려도 됨)
hb_sil = ero(head_sil & ~(vis('ahoge') & ~dil(vis('hair'), 6)), 4) & (YY < 1000)
hb_full |= hb_sil
# 턱선 둘레 30px 띠(옆머리 다발이 덮고 있는 곳만 — allow 가 거름): 고개를 숙이거나 어깨를 올리면 다발 밑으로 배경이 비치던 세모 틈
hb_full |= dil(face_full, 30) & (YY < 1040) & ~neck_col
hb.fill(hb_full, hair_col * 0.78)
hb_line = line_color(vis('hair') & (YY < 700))
hb.outline(hb_sil, hb_sil & ~vis('hair_back') & (YY < 760), 6, hb_line)
layers['hair_back'] = hb

# ---------- 귀 ----------
ear_line = np.array([34, 21, 28], np.float32)
for s, (cx, cy, rx, ry) in {'r': (430, 945, 52, 44), 'l': (1062, 952, 46, 42)}.items():
    L = Layer(f'ear_{s}')
    v = vis(f'ear_{s}')
    full = v | (ellipse(cx, cy, rx, ry) & ~vis('earring'))
    full = ndi.binary_fill_holes(full)
    L.fill(full, skin)
    # 머리카락·얼굴과 맞닿은 귀 가장자리(섞인 픽셀): 귀는 피부색으로, 그 선은 앞 부위 쪽 반투명 선으로
    near_f = dil(vis('hair') | vis('face'), 4) & v & ~(np.abs(src[..., :3] - skin).max(2) < 14) & (lum > 40)
    near_f &= ~ndi.binary_erosion(fg, iterations=1) == False
    L.img[near_f, :3] = skin
    edge_transfer(near_f, skin, ['hair', 'face'])
    L.outline(full, full & ~v, 9, ear_line)
    layers[f'ear_{s}'] = L

# ---------- 눈 ----------
eyes = {}
eye_band = {}
strand_px = np.zeros((H, W), bool)
for s in 'rl':
    lid = vis(f'lid_{s}')
    wh = vis(f'white_{s}')
    ir = vis(f'iris_{s}')
    hl = vis(f'hl_{s}')
    xs = np.nonzero(lid.any(0))[0]
    x0, x1 = int(xs.min()), int(xs.max())
    open_vis = wh | ir | hl
    ox = np.nonzero(open_vis.any(0))[0]
    # 열(x)마다: 눈꺼풀 띠 위/아래 끝, 눈 열린 곳 아래 끝
    U, T, Lw = {}, {}, {}
    for x in range(x0, x1 + 1):
        c = np.nonzero(lid[:, x])[0]
        if len(c):
            T[x], U[x] = int(c.min()), int(c.max())
        o = np.nonzero(open_vis[:, x])[0]
        if len(o):
            Lw[x] = int(o.max())
    # 띠 아래 끝이 머리카락에 가려 끊긴 열: 이웃 값으로 매끈하게 (2차 맞춤)
    xsU = np.array(sorted(U))
    pu = np.polyfit(xsU, [U[x] for x in xsU], 2)
    pt = np.polyfit(xsU, [T[x] for x in xsU], 2)
    xsL = np.array(sorted(Lw))
    pl = np.polyfit(xsL, [Lw[x] for x in xsL], 2)
    oxa, oxb = int(ox.min()), int(ox.max())
    eyes[s] = dict(x0=x0, x1=x1, ox0=oxa, ox1=oxb, upper=pu.tolist(), top=pt.tolist(), lower=pl.tolist())
    # 흰자: 띠 위 끝 ~ 아래 경계까지 전부 흰색 (홍채가 움직이면 드러남, 눈 크게 뜨면 위로)
    # 머리카락에 가려 안 보이는 안쪽 눈꼬리: 띠 끝(x0·x1)에서 아래 경계가 띠로 올라붙게 (sqrt 모양)
    full = np.zeros((H, W), bool)
    # 바깥 눈꼬리(r 은 왼쪽, l 은 오른쪽)는 보이는 흰자 끝까지만, 안쪽(코 쪽, 머리카락 밑)은 띠 끝까지 가늘어지게
    xr = range(oxa, x1 - 5) if s == 'r' else range(x0 + 6, oxb + 1)
    for x in xr:
        yt = np.polyval(pu, x) - 5
        yu = np.polyval(pu, x)
        u = min((x1 - x) / max(1, x1 - oxb + 25), 1.0) if s == 'r' else min((x - x0) / max(1, oxa - x0 + 25), 1.0)
        yl_fit = np.polyval(pl, x)
        yl = yu + (yl_fit - yu) * np.sqrt(max(0.0, u))
        yl = max(yl, Lw.get(x, 0))
        full[int(yt):int(yl) + 1, x] = True
    full |= open_vis
    full = ndi.binary_fill_holes(full) & ~(face_vis & ~open_vis)
    yy = np.nonzero(full.any(1))[0]
    eyes[s]['open_bbox'] = [int(x0), int(yy.min()), int(x1), int(yy.max())]
    white_col = median_color(wh & (lum > 240), 0) if (wh & (lum > 240)).any() else np.array([248, 246, 246])
    Wl = Layer(f'white_{s}')
    Wl.img[ir | hl] = 0
    Wl.img[dil(ir | hl, 2) & wh & (lum < 235)] = 0
    Wl.allow |= full & dil(open_vis, 2)
    Wl.fill(full, white_col)
    # 흰자 안쪽의 회색 경계 자국(가려진 곳·홍채 옆) → 흰색. 피부와 맞닿은 부드러운 아래 끝은 그대로
    stain = full & (Wl.img[..., 3] > 0) & (Wl.img[..., :3].min(2) < 236) & ~dil(face_vis, 3)
    Wl.img[stain, :3] = white_col
    wop = Wl.img[..., 3] > 0
    wh_holes = ndi.binary_fill_holes(wop) & ~wop
    Wl.img[wh_holes, :3] = white_col
    Wl.img[wh_holes, 3] = 255
    layers[f'white_{s}'] = Wl
    # 눈 열림 모양(구멍 없는 마스크): 홍채·하이라이트를 이 안쪽만 보이게 자르는 데 씀 (색은 그리지 않음)
    om0 = (Wl.img[..., 3] > 0) | ir | hl
    om = cv2.morphologyEx(om0.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))) > 0
    om = ndi.binary_fill_holes(om | om0) & dil(om0, 3)
    om = ndi.binary_fill_holes(om)
    Om = Layer(f'white_{s}')
    Om.img[:] = 0
    Om.img[om, :3] = 255
    Om.img[om, 3] = 255
    layers[f'open_{s}'] = Om
    # 홍채: 보이는 부분에 타원을 맞춰 위쪽(띠에 가려진 곳)·머리카락에 가려진 곳을 그려 넣고, 안쪽 밝은 타원도 이어 그림
    # 홍채: 보이는 원본은 그대로. 머리카락에 가린 안쪽은 하이라이트 x 를 축으로 좌우 대칭 복사,
    # 눈꺼풀 띠 밑(위쪽)은 열마다 맨 위 픽셀 색을 띠 위 끝까지 늘림 (눈 크게 뜰 때 드러남)
    I = Layer(f'iris_{s}')
    I.img[:] = 0
    vis_i = ir | hl
    hy_, hx_ = np.nonzero(hl)
    cxm = float(hx_.mean())
    iris_dark = median_color(ir & (src[..., 2] < 130) & (src[..., 2] > 60), 0)
    base = src.copy()
    base[hl, :3] = iris_dark
    base[hl, 3] = 255
    I.img[vis_i] = base[vis_i]
    I.img[vis_i, 3] = 255
    hidden_ok = (vis('hair') | lid) & ~face_vis & ~wh
    ys_, xs_ = np.nonzero(vis_i)
    mx = np.round(2 * cxm - xs_).astype(int)
    okm = (mx >= 0) & (mx < W)
    ys_, xs_, mx = ys_[okm], xs_[okm], mx[okm]
    put = hidden_ok[ys_, mx] & ~vis_i[ys_, mx]
    I.img[ys_[put], mx[put], :3] = base[ys_[put], xs_[put], :3]
    I.img[ys_[put], mx[put], 3] = 255
    have = I.img[..., 3] > 0
    # 위쪽 둥근 뚜껑: 홍채 폭의 반 = rx, 세로 0.9·rx 타원(아래 끝 = 보이는 아래 끝)의 윗부분을 띠 밑으로 이어 그림
    hxs = np.nonzero(have.any(0))[0]
    hys = np.nonzero(have.any(1))[0]
    rx_ = (hxs.max() - hxs.min()) / 2
    cx_ = (hxs.max() + hxs.min()) / 2
    ry_ = rx_ * 0.9
    cy_c = hys.max() - ry_
    rim_c = np.array([40, 20, 76], np.float32)
    for x in hxs:
        cy_ = np.nonzero(have[:, x])[0]
        ytop = cy_.min()
        u = (x - cx_) / rx_
        if abs(u) >= 1:
            continue
        ycap = cy_c - ry_ * np.sqrt(1 - u * u)
        ylim = int(max(np.polyval(pt, x) + 2, ycap))
        if ytop > ylim:
            I.img[ylim:ytop, x, :3] = iris_dark
            I.img[ylim:ytop, x, 3] = 255
            I.img[ylim:min(ylim + 4, ytop), x, :3] = rim_c
    # 옆 테: 뚜껑 바깥 열 가장자리 3px
    hv = I.img[..., 3] > 0
    edge = hv & ~ero(hv, 3) & ~vis_i
    I.img[edge, :3] = rim_c
    # 가려진 곳(대칭 복사·뚜껑)의 색: 밝은 안쪽 타원(가려지지 않은 경계로 맞춤) 안이면 밝은 색, 아니면 어두운 색
    light = ir & (src[..., 2] > 200) & (src[..., 0] > 130)
    cl, _ = cv2.findContours(light.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c2 = max(cl, key=len)[:, 0]
    hd5 = dil(vis('hair'), 5)
    k2 = np.array([q for q in c2 if not hd5[q[1], q[0]]])
    if len(k2) >= 5:
        (lcx, lcy), (lw, lh), lang = cv2.fitEllipse(k2.astype(np.float32))
        e2 = np.zeros((H, W), np.uint8)
        cv2.ellipse(e2, ((lcx, lcy), (lw, lh), lang), 1, -1)
        lc = median_color(light, 0)
        hid_i = (I.img[..., 3] > 0) & ~vis_i
        rim_keep = hid_i & (I.img[..., :3].sum(2) < (rim_c.sum() + 6))
        I.img[hid_i & (e2 > 0) & ~rim_keep, :3] = lc
        I.img[hid_i & (e2 == 0) & ~rim_keep, :3] = iris_dark
    I.img[face_vis] = 0
    iy_, ix_ = np.nonzero(I.img[..., 3] > 0)
    ecx, ecy = float(ix_.mean()), float((iy_.min() + iy_.max()) / 2)
    ew, eh, ang = float(ix_.max() - ix_.min()), float(iy_.max() - iy_.min()), 0.0
    layers[f'iris_{s}'] = I
    eyes[s]['iris'] = dict(cx=float(ecx), cy=float(ecy), w=float(ew), h=float(eh), ang=float(ang))
    hy, hx = np.nonzero(hl)
    eyes[s]['hl'] = dict(cx=float(hx.mean()), cy=float(hy.mean()))
    print('eye', s, eyes[s]['iris'])
    # 눈꺼풀 띠: 머리카락에 가려 끊긴 곳·하이라이트 자국을 맞춘 곡선 사이 검정으로 이어 채움
    # 눈꺼풀 띠를 깨끗한 한 덩어리로 다시 만듦: 맞춘 윗선·아랫선 사이를 채우고(머리카락·하이라이트 밑 포함), 바깥 꼬리 모양은 원본대로.
    # 원본 띠에는 그 위를 지나는 머리카락 가장자리(회색 선)와 압축 얼룩이 섞여 있어, 눈을 감아 띠가 내려가면 그 조각이 같이 따라 내려갔다.
    Lid = Layer(f'lid_{s}')
    Lid.img[:] = 0
    band = np.zeros((H, W), bool)
    for x in range(x0, x1 + 1):
        band[int(round(np.polyval(pt, x))):int(round(np.polyval(pu, x))) + 1, x] = True
    covered = lid | hl | (vis('hair') & band) | (vis('brow_' + s) & band)
    band_m = (band & dil(covered, 2)) | (lid & (lum < 16))
    band_m = cv2.morphologyEx(band_m.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) > 0
    # 띠 본체와 떨어진 작은 조각은 버림
    lab_b, nb = ndi.label(band_m)
    if nb > 1:
        szb = np.bincount(lab_b.ravel()); szb[0] = 0
        band_m = lab_b == szb.argmax()
    # 원래 피부였던 곳으로는 넘치지 않게 (가만히 있을 때 모양 = 원본)
    band_m &= ~(face_vis & (lum > 120))
    Lid.img[band_m, :3] = (9, 6, 9)
    Lid.img[band_m, 3] = 255
    layers[f'lid_{s}'] = Lid
    eye_band[s] = band_m
    # 띠 안에서 띠가 아닌 회색 픽셀(머리카락 가장자리) → 머리카락 레이어로 (피부와 맞닿은 띠 테두리는 제외)
    strand_px[lid & (lum >= 16) & ~dil(face_vis | wh | ir, 2)] = True
    # 흰자는 눈꺼풀 띠(이어 채운 것 포함) 윗선 4px 아래로만 — 띠 끝(눈꼬리)에서 머리카락 밑으로 삐져나온 흰 점이 고개를 돌리면 보이던 것
    lidm_full = Lid.img[..., 3] > 0
    Wl2 = layers[f'white_{s}'].img
    Om2 = layers[f'open_{s}'].img
    for x in range(W):
        cl = np.nonzero(lidm_full[:, x])[0]
        col_w = np.nonzero(Wl2[:, x, 3] > 0)[0]
        if not len(col_w):
            continue
        lim = cl.min() + 4 if len(cl) else None
        if lim is None:
            keep_w = open_vis[:, x]
            Wl2[~keep_w, x] = 0
            Om2[~(keep_w | (ir | hl)[:, x]), x] = 0
        else:
            Wl2[:lim, x] = 0
            Om2[:lim, x] = 0
    for n in (f'hl_{s}', f'crease_{s}', f'brow_{s}'):
        layers[n] = Layer(n)
    # 얼굴: 눈 자리 피부 (눈 감을 때 드러나는 눈꺼풀) — 이미 face_full 에 포함
info['eyes'] = eyes
# 띠에서 옮긴 머리카락 가장자리 픽셀 (원본 색 그대로 → 가만히 있을 땐 똑같고, 띠가 내려가도 머리카락에 남음).
# 머리카락 몸통에 닿은 것만 — 띠 아래 테두리 같은 가로선이 머리카락에 남지 않게
strand_px &= dil(vis('hair'), 2) & (lum < 120) & ~(src[..., 2] > src[..., 0] + 12)
layers['hair'].img[strand_px, :3] = src[strand_px, :3]
layers['hair'].img[strand_px, 3] = 255

# 띠 밑 채우기 (얼굴 레이어, 띠에 가려 평소엔 안 보임): 띠가 내려가면 띠 윗부분 자리가 드러난다.
# 그 위가 머리카락인 열(바깥 눈꼬리의 속눈썹 꼬리가 옆머리 위에 그려진 곳, 띠 위에서 끝나는 앞머리 끝)은 피부가 아니라
# 머리카락이 이어져야 한다 → 열마다 띠 바로 위 부위를 보고, 머리카락이 이어지는 구간은 끝이 뾰족하게 머리카락 색으로 채우고 외곽선
hfill = median_color(vis('hair') & (lum > 38) & (lum < 62) & (np.abs(src[..., 0] - src[..., 2]) < 12), 0)
under_patch = np.zeros((H, W), bool)
hline = line_color(vis('hair') & (YY < 900))
for s_ in 'rl':
    bm = eye_band[s_]
    xs_ = np.nonzero(bm.any(0))[0]
    top = {}
    bot = {}
    above_hair = {}
    for x in xs_:
        ys_ = np.nonzero(bm[:, x])[0]
        yt, yb = int(ys_.min()), int(ys_.max())
        top[x], bot[x] = yt, yb
        ab = label[max(0, yt - 6):max(0, yt - 1), x]
        # 피부가 아니면 머리카락 쪽으로 (띠 꼬리 끝은 위가 띠·뒷머리라 피부로 잘못 채우면 머리카락 속에 피부 조각이 생김)
        above_hair[x] = np.mean(np.isin(ab, [Z['face'], Z['crease_r'], Z['crease_l']])) < 0.5
    patch = np.zeros((H, W), bool)
    runs = []
    cur = []
    for x in xs_:
        if above_hair[x] and (not cur or x == cur[-1] + 1):
            cur.append(x)
        else:
            if cur:
                runs.append(cur)
            cur = [x] if above_hair[x] else []
    if cur:
        runs.append(cur)
    xmin, xmax = xs_.min(), xs_.max()
    for r in runs:
        xa, xb = r[0], r[-1]
        w = xb - xa + 1
        open_l = xa <= xmin + 2  # 띠 끝에 닿은 구간은 그 끝 쪽은 줄이지 않음 (꼬리 전체가 머리카락 위)
        open_r = xb >= xmax - 2
        for x in r:
            if open_l and open_r:
                f = 1.0
            elif open_l:
                f = np.sqrt(max(0.0, 1 - ((x - xa) / max(1, w)) ** 2))
            elif open_r:
                f = np.sqrt(max(0.0, 1 - ((xb - x) / max(1, w)) ** 2))
            else:
                # 띠 위에서 끝나는 앞머리 끝: 원래 그 자리에서 끝나는 다발이라 늘리지 않음 (끝의 외곽선은 머리카락 레이어가 그림)
                f = 0.0
            hgt = int(round((bot[x] - top[x] + 1) * min(1.0, f * 1.15)))
            if hgt > 0:
                patch[top[x]:top[x] + hgt, x] = True
    patch &= bm
    # 띠 자리 안의 머리카락(앞 레이어) + 채움을 한 모양으로 보고 매끈하게 → 드러나는 피부와의 경계에 계단이 없게
    hmask = layers['hair'].img[..., 3] > 127
    uni = cv2.GaussianBlur((patch | hmask).astype(np.float32), (0, 0), 2.6) > 0.5
    uni = (uni & dil(bm, 2)) | (hmask & ~dil(bm, 2))
    patch = uni & bm & ~hmask
    face.img[patch, :3] = hfill
    face.img[patch, 3] = 255
    under_patch |= patch
    # 외곽선: 합친 모양의 테두리 안쪽 3px 중 채움 부분 (띠 윗선 = 위쪽 머리카락과 이어지는 곳은 뺌)
    # 외곽선은 드러날 피부와 맞닿은 쪽에만 (머리카락·띠 끝과 맞닿은 쪽에 그리면 머리카락 속에 선이 생김)
    skin_out = ~uni & ~hmask & dil(bm, 6)
    d_sk = ndi.distance_transform_edt(~skin_out)
    topband = np.zeros((H, W), bool)
    for x in xs_:
        topband[top[x]:top[x] + 3, x] = True
    edge_p = patch & (d_sk <= 3.0) & ~topband
    face.img[edge_p, :3] = hline

# ---------- 바보털 ----------
ah = Layer('ahoge')
ah_col = median_color(vis('ahoge') & (lum > 100))
layers['ahoge'] = ah

# ---------- 귀걸이 ----------
layers['earring'] = Layer('earring')
hy, hx = np.nonzero(vis('earring'))
info['earring'] = dict(pivot=[1013, 958], ring=[1013, 976])

# ---------- 몸 ----------
# 목: 턱 밑으로 이어 그림 (고개를 기울이면 드러남)
nk = Layer('neck')
neck_col = median_color(vis('neck'), 0)
neck_full = vis('neck') | poly([(702, 930), (806, 930), (812, 1046), (696, 1046)])
# 턱 밑 목: 진한 분홍 그늘 대신 피부색에 가까운 그늘 (고개를 들면 드러남), 아래로 갈수록 밝게
nk_hid = neck_full & ~vis('neck')
tcol = skin * 0.45 + neck_col * 0.55
nk.fill(nk_hid & (YY < 1000), tcol)
nk.fill(nk_hid, skin * 0.6 + neck_col * 0.4)
# 윤곽선은 양옆만 (위쪽은 턱 밑으로 들어가므로 선 없음)
side_only = nk_hid & (YY < 1030) & (YY > 940) & ((XX < 730) | (XX > 778))
nk.outline(neck_full, side_only, 6, face_line)
layers['neck'] = nk

inner = Layer('inner')
vest = median_color(vis('inner') & (lum < 80))
in_v = vis('inner')
# 재킷 옷깃 밑으로 조끼를 넓혀 둠 (재킷이 흔들려도 구멍 없음)
inner_full = in_v | (dil(in_v, 46) & (vis('jacket') | vis('lapel_r') | vis('lapel_l') | vis('necklace') | vis('brooch')) & (YY > 1050) & (YY < 1440))
inner.fill(inner_full & ~in_v, vest)
inner.nearest(vis('necklace') & ~in_v & dil(in_v, 6), in_v)
# 목걸이 은줄의 반투명 가장자리가 조끼·셔츠에 남은 것 지우기 (줄이 흔들리면 잔상)
chainpath = dil(vis('necklace'), 3) & in_v & (lum > 70) & (np.abs(src[..., 0] - src[..., 2]) < 30)
clean_in = in_v & ~dil(vis('necklace'), 4)
inner.nearest(chainpath, clean_in)
layers['inner'] = inner
layers['necklace'] = Layer('necklace')

jk = Layer('jacket')
jcol = median_color(vis('jacket') & (lum < 80))
jline = line_color(vis('jacket') & (YY > 1200) & (XX < 520))
# 어깨: 팔 밑(겨드랑이 → 어깨 위)으로 재킷 옆선을 둥글게 이어 그림
sh_r = poly([(503, 1205), (508, 1150), (520, 1100), (540, 1068), (575, 1046), (620, 1036), (640, 1036), (640, 1205)])
sh_l = poly([(1007, 1205), (1003, 1150), (992, 1100), (972, 1068), (938, 1046), (895, 1036), (875, 1036), (875, 1205)])
jfull = vis('jacket') | ((sh_r | sh_l) & ~vis('inner') & ~vis('necklace') & ~vis('neck'))
# 어깨 끝(둥근 어깨): T자세 팔의 뿌리 윗부분은 팔을 내리면 비워진다 → 어깨 축 둘레 60px 안의 팔 자리를 재킷 어깨로 채움
for sd_, piv_ in (('r', (572, 1108)), ('l', (948, 1108))):
    cap = vis(f'arm_{sd_}') & ((XX - piv_[0]) ** 2 + (YY - piv_[1]) ** 2 < 60 ** 2) & (YY < piv_[1] + 24)
    # 옷깃 쪽 어깨 꼭대기(축에서 위로 90px 까지, 바깥으로는 60px 안)도 — 팔을 내리면 비던 마지막 조각
    cap |= vis(f'arm_{sd_}') & (np.abs(XX - piv_[0]) < 60) & (YY < piv_[1]) & ((XX - piv_[0]) ** 2 + (YY - piv_[1]) ** 2 < 95 ** 2)
    jfull |= cap
# 머리카락·뒷머리 밑 윗선(목둘레 위) + 브로치·귀걸이 밑
top_band = poly([(560, 1030), (960, 1030), (960, 1048), (560, 1048)]) & ~vis('inner') & ~vis('neck') & ~vis('necklace')
jfull |= top_band & dil(vis('jacket'), 14)
jfull |= vis('brooch') | (vis('earring') & (YY > 1036))
# 옷깃·포켓치프 밑: 앞판 색으로 (몸을 돌리면 옷깃이 앞판보다 더 밀려 겹이 드러남)
jfull |= vis('lapel_r') | vis('lapel_l') | vis('psq')
jhid = jfull & ~vis('jacket')
jk.fill(jhid, jcol)
jk.nearest(vis('brooch'), vis('jacket') & ~dil(vis('brooch'), 0))
jk.outline(jfull, jhid & ~vis('brooch') & (YY < 1210), 11, jline)
layers['jacket'] = jk
for n in ('lapel_r', 'lapel_l', 'psq'):
    layers[n] = Layer(n)
# 좌우 앞판으로 나눠 저장 (가운데 x=762: 뒷목 띠는 목·셔츠에 가려짐)
for n, keep in (('jacket_r', XX < 762), ('jacket_l', XX >= 762)):
    J = Layer('jacket')
    J.img = jk.img.copy()
    J.img[~keep] = 0
    layers[n] = J
info['psq'] = dict(pivot=[895, 1170])
layers['brooch'] = Layer('brooch')
info['brooch'] = dict(pivot=[907, 1110])

for s in 'rl':
    A = Layer(f'arm_{s}')
    layers[f'arm_{s}'] = A
# 팔 뿌리 자른 곳을 부드럽게: 몸통(재킷) 쪽 경계로 갈수록 투명
for s in 'rl':
    A = layers[f'arm_{s}']
    cut = dil(vis('jacket') | vis('inner'), 1) & ~fg | vis('jacket')
    A.feather(vis('jacket') & dil(vis(f'arm_{s}'), 2), 10)

# 바지: 재킷 밑으로 위쪽을 이어 그림, 체인 밑 채움
pcol = median_color((vis('leg_r') | vis('leg_l')) & (lum < 80))
pline = line_color(vis('leg_r') & (YY > 1550))
for s, pg in {'r': [(515, 1300), (765, 1300), (765, 1460), (515, 1460)], 'l': [(765, 1300), (1005, 1300), (1005, 1460), (765, 1460)]}.items():
    L = Layer(f'leg_{s}')
    v = vis(f'leg_{s}')
    full = v | (poly(pg) & (ero(fg, 10) | (YY < 1440)) & (YY > 1300))
    # 바지 폭: 재킷 밑으로는 바지 맨 위 폭 정도로
    ys = np.nonzero(v.any(1))[0]
    ytop = int(ys.min())
    row = np.nonzero(v[ytop + 30])[0]
    xa, xb = int(row.min()), int(row.max())
    full &= (XX >= xa - 4) & (XX <= xb + 4) | v
    if s == 'l':
        full |= vis('chain') & dil(v, 30)
    if s == 'r':
        full |= vis('strap')
    hid = full & ~v
    L.fill(hid, pcol)
    if s == 'r':
        L.nearest(vis('strap'), v & ~dil(vis('strap'), 3) & (lum < 110))
    if s == 'l':
        cv_ = vis('chain')
        ghost = (cv_ & hid) | (dil(cv_, 4) & v & (lum > 70))
        L.nearest(ghost, v & ~dil(cv_, 5))
    L.outline(full, hid & (YY < ytop + 20), 9, pline)
    layers[f'leg_{s}'] = L
    info[f'leg_{s}'] = dict(top=ytop, x0=xa, x1=xb)
layers['chain'] = Layer('chain')
layers['strap'] = Layer('strap')
info['chain'] = dict(pivot=[884, 1428])

for s in 'rl':
    L = Layer(f'shoe_{s}')
    v = vis(f'shoe_{s}')
    ys = np.nonzero(v.any(1))[0]
    ytop = int(ys.min())
    scol = median_color(v & (lum < 80))
    full = v | (dil(v, 24) & (YY < ytop + 30) & (YY > ytop - 30) & ero(fg, 2) & (vis(f'leg_{s}')))
    L.fill(full & ~v, scol)
    layers[f'shoe_{s}'] = L

# 귀걸이 밑: 가까운 부위 레이어에 그 부위 색으로
for n in ['face', 'hair', 'hair_back', 'ear_l', 'jacket', 'arm_l']:
    gap = er & (lab_near == Z[n])
    if gap.any() and n in layers:
        layers[n].nearest(gap & ~(layers[n].img[..., 3] > 200), vis(n))

# 눈꺼풀 띠 위를 지나는 머리카락: 원본에선 다발의 검은 외곽선이 검은 띠와 합쳐져 있었다 → 띠 자리 안에서
# 머리카락 윤곽을 매끈하게 다듬고(계단 없앰), 그 바깥 3px 에 외곽선을 그려 둠. 가만히 있을 땐 검정 위 검정이라 안 보이고,
# 눈을 감아 띠가 내려가면 다발마다 깔끔한 외곽선이 남는다
hl_c = line_color(vis('hair') & (YY < 900))
HA = layers['hair'].img
for s in 'rl':
    bm = eye_band[s]
    zone = dil(bm, 4)
    hm = HA[..., 3] > 127
    sm = cv2.GaussianBlur(hm.astype(np.float32), (0, 0), 2.2) > 0.5
    add = zone & sm & ~hm
    rem = zone & hm & ~sm & bm
    if add.any():
        _, (iy, ix) = ndi.distance_transform_edt(~hm, return_indices=True)
        HA[add, :3] = HA[iy[add], ix[add], :3]
        HA[add, 3] = 255
    HA[rem] = 0
    hm = HA[..., 3] > 127
    dout = ndi.distance_transform_edt(~hm)
    # 띠 아래 테두리(홍채 윗선)의 보라 얇은 선이 머리카락 레이어에 섞여 있으면 띠가 내려갈 때 홀로 남음 → 지움
    stray_p = zone & (HA[..., 3] > 0) & (HA[..., 2] > HA[..., 0] + 20) & (HA[..., :3].max(2) < 140)
    HA[stray_p] = 0
    hm = HA[..., 3] > 127
    dout = ndi.distance_transform_edt(~hm)
    ring = zone & bm & ~hm & ~under_patch & (dout <= 3.6)
    HA[ring, :3] = hl_c
    HA[ring, 3] = np.clip((3.6 - dout[ring]) / 1.2, 0, 1) * 255
    # 다발 안쪽 가장자리 1px 도 선 색으로 섞어 외곽선과 이어지게
    din = ndi.distance_transform_edt(hm)
    inner = zone & bm & hm & (din <= 1.5)
    HA[inner, :3] = HA[inner, :3] * 0.4 + hl_c * 0.6


# 앞 부위 가장자리 반투명 선 넣기 (얼굴·귀 쪽에서 옮겨 온 것)
for n, m, lc_, a in edge_moves:
    if n not in layers:
        continue
    Lx = layers[n].img
    empty = m & (Lx[..., 3] < 1)
    Lx[empty, :3] = lc_
    Lx[empty, 3] = a[empty[m]] * 255

# ---------- 사용자가 그린 파츠로 가려진 곳 채우기 (parts_aligned, tools/sdp_register.py) ----------
# 임시 단색 채움 위에 사용자 그림을 얹는다. 원래 보이던 픽셀(원본)은 그대로 두고, 앞 부위에 가려졌던 곳(allow)만.
PA = os.path.join(os.path.dirname(W0), 'parts_aligned')


def user_part(n):
    f = os.path.join(PA, n + '.png')
    return np.array(Image.open(f).convert('RGBA')).astype(np.float32) if os.path.exists(f) else None


def fill_from(L, part, region):
    if part is None:
        return 0
    m = region & L.allow & ~vis_any(L.name) & (part[..., 3] > 8)
    a = part[m, 3:4] / 255
    old_a = L.img[m, 3:4] / 255
    L.img[m, :3] = part[m, :3] * a + L.img[m, :3] * (1 - a) * (old_a > 0)
    L.img[m, 3] = np.maximum(L.img[m, 3], part[m, 3])
    return int(m.sum())


def vis_any(n):
    return vis(n) if n in Z else np.zeros((H, W), bool)


used = {}
up = user_part('back_hair')
if up is not None:
    # 뒷머리: 머리카락·얼굴·귀에 가려진 곳 전부 (옆머리가 흔들리거나 고개를 돌리면 진짜 뒷머리가 보임)
    # 단, 바보털 자리는 뺌 — 사용자 뒷머리 그림에도 바보털이 그려져 있어 뒷머리 레이어에 복사본이 생기고, 고개를 숙이면
    # 앞의 바보털(뿌리 깊이로 움직임)과 어긋나 두 개로 보이며 사이가 비었다 (2026-11-02)
    ah_only = vis('ahoge') & ~dil(vis('hair'), 10)
    used['back_hair'] = fill_from(layers['hair_back'], up, ~vis('ahoge'))
    HB = layers['hair_back'].img
    HB[ah_only] = 0
    ah_near = vis('ahoge') & ~ah_only
    HB[ah_near, :3] = hair_col * 0.78
    HB[ah_near, 3] = 255
up = user_part('face_skin')
if up is not None:
    skinish = (up[..., 0] > 200) & (up[..., 1] > 170) | (up[..., :3].max(2) < 90)
    used['face_skin'] = fill_from(layers['face'], up * skinish[..., None], face_full & (YY > 700))
for sd in ('rl' if os.environ.get('SDP_USER_EARS') else ''):
    # 귀: 사용자 귀는 원본 귀와 모양이 달라 외곽선이 겹쳐 보여 기본은 쓰지 않음 (SDP_USER_EARS=1 로 켬)
    up = user_part('ear_' + sd)
    if up is None:
        continue
    ev = vis('ear_' + sd)
    ys_, xs_ = np.nonzero(ev)
    region = dil(ev, 30) & ~dil(vis('earring'), 3) & (YY <= ys_.max() + 4)
    # 귀걸이 색(보라·흰 테) 픽셀은 빼고 피부·선만
    keep = ((up[..., 0] > 200) & (up[..., 1] > 160)) | (up[..., :3].max(2) < 90)
    used['ear_' + sd] = fill_from(layers['ear_' + sd], up * keep[..., None], region)
up = user_part('neck_collar')
if up is not None:
    skin_p = (up[..., 0] > 200) & (up[..., 1] > 170)
    used['neck'] = fill_from(layers['neck'], up * skin_p[..., None], dil(vis('neck'), 40) & (YY < 1060))
    for jn in ('jacket_r', 'jacket_l'):
        used[jn] = fill_from(layers[jn], up * (~skin_p)[..., None], YY < 1100)
print('user parts used (px):', used)

# ---------- 뒷머리 그늘: 얼굴 윤곽 둘레 30px 의 (평소 가려진) 뒷머리를 얼굴에 가까울수록 어둡게 ----------
# 고개를 돌려 얼굴 옆으로 뒷머리가 드러날 때 평평한 면 대신 얼굴이 드리운 그늘처럼 보이게 (2026-11-01, 원본 픽셀은 그대로)
_hbL = layers['hair_back']
_dface = ndi.distance_transform_edt(~face_full)
_shade = 1 - 0.30 * (1 - np.clip(_dface / 30.0, 0, 1)) ** 1.5
_sm = (_hbL.img[..., 3] > 0) & ~vis('hair_back') & (_dface < 30) & (_dface > 0)
_hbL.img[_sm, :3] *= _shade[_sm][..., None]

# ---------- 이음매 없애기 (Bunraku: 레이어 알파를 3px 넓혀 흰 이음매 방지 / img2rig: 색 번짐 + 깃털) ----------
# 이웃한 두 레이어의 반투명 가장자리가 겹치는 곳으로 배경이 비쳐 보였다(다리 사이·신발 위·옷깃 선). 아래 레이어를
# 위 레이어 밑으로 3px 넓혀(자기 가장자리 색, 불투명) 둔다 — 평소엔 위 레이어에 가려 그림은 그대로
NO_BLEED = ('white_', 'open_', 'iris_', 'hl_', 'lid_', 'crease_', 'brow_', 'earring')
for n, L in layers.items():
    if n.startswith(NO_BLEED) or n == 'mouth':
        continue
    A = L.img[..., 3]
    own = A >= 250
    if not own.any():
        continue
    # 바보털은 뿌리가 머리카락 밑으로 14px 더 들어가게 (바보털은 뿌리 깊이 한 값, 머리카락은 정점마다 깊이라 고개를 숙이면 3~7px 어긋나 틈이 보였다)
    ring = dil(own, 14 if n == 'ahoge' else 3) & ~own & L.allow
    if not ring.any():
        continue
    # 색은 가장자리에서 2px 안쪽 픽셀에서 가져옴: 가장자리 자체는 피부와 섞인 밝은 안티에일리어싱 색이라 그대로 번지면
    # 눈썹·띠 밑에 회색 덩어리가 남아 눈썹을 올리면 옛 자리에 보였다 (2026-11-01)
    inner = ero(own, 2)
    srcm = inner if inner.any() else own
    _, (iy, ix) = ndi.distance_transform_edt(~srcm, return_indices=True)
    L.img[ring, :3] = L.img[iy[ring], ix[ring], :3]
    L.img[ring, 3] = 255

# 눈썹 자리 마무리: 3px 번짐·가장자리 옮기기가 눈썹 밑 피부 쪽(own_f)에 머리카락 픽셀을 다시 넣는다 → 지움
# (눈썹을 올리면 다발이 눈썹 두께만큼 옆으로 튀어나온 어두운 막대로 보였음, 2026-11-01)
layers['hair'].img[own_f & (label != hz)] = 0

# ---------- 저장 ----------
meta = {'size': [W, H], 'layers': {}, 'info': info}
SAVE = []
for n in ORDER:
    SAVE.append(n)
    if n.startswith('white_'):
        SAVE.append('open_' + n[-1])
    if n == 'jacket':
        SAVE[-1:] = ['jacket_r', 'jacket_l']
for n in SAVE:
    if n not in layers or n == 'mouth':
        continue
    L = layers[n]
    a = L.img[..., 3]
    ys, xs = np.nonzero(a > 0)
    if not len(ys):
        print('empty', n)
        continue
    p = 4
    x0, y0 = max(0, xs.min() - p), max(0, ys.min() - p)
    x1, y1 = min(W, xs.max() + p + 1), min(H, ys.max() + p + 1)
    crop = np.clip(L.img[y0:y1, x0:x1], 0, 255).astype(np.uint8)
    Image.fromarray(crop).save(os.path.join(OUT, f'{n}.png'))
    meta['layers'][n] = dict(x=int(x0), y=int(y0), w=int(x1 - x0), h=int(y1 - y0))
# 입 정보 (그림은 런타임에서 그림)
mv = vis('mouth')
ys, xs = np.nonzero(mv)
inner_m = mv & (lum > 150)
meta['info']['mouth'] = dict(cx=float(xs.mean()), cy=float(ys.mean()), w=float(xs.max() - xs.min()), h=float(ys.max() - ys.min()),
                             fill=median_color(inner_m, 0).tolist(), line=line_color(dil(mv, 1)).tolist() if (mv & (lum < 150)).any() else [150, 80, 90],
                             edge=median_color(mv & (lum < 200) & (lum > 120), 0).tolist())
meta['info']['skin'] = skin.tolist()
meta['info']['face_line'] = face_line.tolist()
meta['info']['hair_col'] = hair_col.tolist()
json.dump(meta, open(W0 + r'\layers.json', 'w'), indent=1)

# 확인: 앞뒤 순서대로 다시 합성 → 원본과 차이
comp = np.zeros((H, W, 3), np.float32)
acc = np.zeros((H, W), np.float32)
for n in ORDER:
    if n not in layers or n == 'mouth':
        continue
    L = layers[n].img
    a = L[..., 3:4] / 255
    comp = comp * (1 - a) + L[..., :3] * a
    acc = acc + (1 - acc) * a[..., 0]
# 입 자리는 원본으로 (런타임에서 그림)
comp[mv] = src[mv, :3]
diff = np.abs(comp - src[..., :3] * (src[..., 3:4] / 255)).max(2) * fg
print('rest diff mean', float(diff[fg].mean()), 'px>40', int((diff > 40).sum()))
Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8)).resize((W // 2, H // 2)).save(W0 + r'\recompose.jpg', quality=88)
dv = np.clip(diff * 3, 0, 255).astype(np.uint8)
Image.fromarray(dv).resize((W // 2, H // 2)).save(W0 + r'\recompose_diff.png')
