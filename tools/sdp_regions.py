# sd_purple 2단계: 검은 선으로 나뉜 단색 영역 지도 → work/regions.npz (+ 확인 그림)
# 선 = 어두운 픽셀(최대 채널 < LINE). 나머지는 색 묶음(팔레트 최근접)마다 이어진 덩어리 → 영역.
# 아주 작은 덩어리(안티에일리어싱 띠)는 가장 많이 맞닿은 큰 영역에 붙인다.
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

W0 = r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple\work'
LINE = 34
rgba = np.array(Image.open(W0 + r'\ref_rgba.png'))
rgb = rgba[..., :3].astype(np.float32)
fg = rgba[..., 3] > 128
H, W = fg.shape
lum = rgb.max(2)
line = fg & (lum < LINE)
fill = fg & ~line

# 팔레트: k-means (채움 픽셀 표본)
pts = rgb[fill]
rng = np.random.default_rng(0)
sample = pts[rng.choice(len(pts), 60000, replace=False)].astype(np.float32)
K = 14
crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5)
_, _, centers = cv2.kmeans(sample, K, None, crit, 4, cv2.KMEANS_PP_CENTERS)
print('palette', np.round(centers).astype(int).tolist())
d = ((rgb[..., None, :] - centers[None, None]) ** 2).sum(-1)
cls = d.argmin(-1).astype(np.int16)
cls[~fill] = -1

reg = np.zeros((H, W), np.int32)
nxt = 1
for k in range(K):
    lab, n = ndi.label(cls == k)
    m = lab > 0
    reg[m] = lab[m] + nxt - 1
    nxt += n
nreg = nxt - 1
areas = np.bincount(reg.ravel(), minlength=nreg + 1)
# 작은 영역(< 60px) 합치기: 이웃 중 가장 큰 영역으로, 몇 번 반복
for it in range(6):
    small = (areas < 60) & (areas > 0)
    small[0] = False
    if not small.any():
        break
    sm = small[reg]
    big = np.where(sm | ~fill, 0, reg)
    # 가장 가까운 큰 영역 번호 (거리 변환 인덱스)
    dist, (iy, ix) = ndi.distance_transform_edt(big == 0, return_indices=True)
    near = big[iy, ix]
    ok = sm & (dist < 6)
    reg[ok] = near[ok]
    areas = np.bincount(reg.ravel(), minlength=nreg + 1)
# 번호 다시 매기기
ids = np.unique(reg[reg > 0])
remap = np.zeros(nreg + 1, np.int32)
remap[ids] = np.arange(1, len(ids) + 1)
reg = remap[reg]
n = len(ids)
areas = np.bincount(reg.ravel(), minlength=n + 1)
print('regions', n, 'big(>500)', int((areas > 500).sum()))
np.savez_compressed(W0 + r'\regions.npz', reg=reg, line=line, fg=fg, cls=cls, centers=centers)

# 확인 그림: 영역마다 무작위 색 + 번호, 선은 검정, 50px 격자
col = rng.integers(60, 255, (n + 1, 3)).astype(np.uint8)
col[0] = 0
vis = col[reg]
vis[line] = (0, 0, 0)
vis[~fg] = (30, 30, 30)
img = Image.fromarray(vis)
dr = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype('arial.ttf', 13)
    fbig = ImageFont.truetype('arial.ttf', 18)
except Exception:
    font = fbig = None
for x in range(0, W, 100):
    dr.line([(x, 0), (x, H)], fill=(255, 0, 0) if x % 500 == 0 else (120, 0, 0))
    dr.text((x + 2, 2), str(x), fill=(255, 255, 0), font=fbig)
for y in range(0, H, 100):
    dr.line([(0, y), (W, y)], fill=(255, 0, 0) if y % 500 == 0 else (120, 0, 0))
    dr.text((2, y + 2), str(y), fill=(255, 255, 0), font=fbig)
com = ndi.center_of_mass(np.ones_like(reg), reg, np.arange(1, n + 1))
for i, (cy, cx) in enumerate(com, 1):
    if areas[i] >= 150:
        dr.text((cx - 8, cy - 7), str(i), fill=(0, 0, 0), font=font)
img.save(W0 + r'\regions_vis.png')
for name, (x0, y0, x1, y1) in {'q_head': (180, 60, 1330, 1070), 'q_body': (180, 980, 1330, 1900)}.items():
    img.crop((x0, y0, x1, y1)).save(W0 + rf'\regions_{name}.png')
