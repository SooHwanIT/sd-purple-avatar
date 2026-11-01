# sd_purple 구멍 위치 보기: 초록 바탕 프레임에서 실루엣 안에 갇힌 초록(구멍)·초록 기운(이음매) 픽셀을 빨강/노랑으로 표시해 저장
#   python tools/sdp_holes_vis.py <video dir> <frame index> <out.png> [확대 배율] [x0,y0,x1,y1 비율]
import sys, glob, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
d, k, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
zoom = float(sys.argv[4]) if len(sys.argv) > 4 else 1
crop = tuple(map(float, sys.argv[5].split(','))) if len(sys.argv) > 5 else None
fs = sorted(glob.glob(os.path.join(r'C:\Users\happy\Downloads\boy\source\vtuber\video', d, 'f_*.jpg')))
a = np.array(Image.open(fs[k]).convert('RGB')).astype(int)
g = (a[..., 1] > 150) & (a[..., 0] < 60) & (a[..., 2] < 60)
lab, n = ndi.label(g)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
enclosed = g & ~np.isin(lab, list(border))
tint = (a[..., 1] > a[..., 0] + 40) & (a[..., 1] > a[..., 2] + 40) & ~g
sil = ndi.binary_fill_holes(~g)
inner_tint = tint & ndi.binary_erosion(sil, iterations=3)
vis = a.copy()
vis[enclosed] = [255, 0, 0]
vis[inner_tint] = [255, 255, 0]
# 덩어리 목록 (큰 것부터)
lab2, n2 = ndi.label(ndi.binary_dilation(enclosed | inner_tint, iterations=2))
objs = ndi.find_objects(lab2)
items = []
for i, sl in enumerate(objs):
    m = (lab2[sl] == i + 1)
    cnt = int((enclosed[sl] & m).sum()), int((inner_tint[sl] & m).sum())
    items.append((cnt[0] + cnt[1] // 2, sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, cnt))
items.sort(reverse=True)
for it in items[:12]:
    print(f'score {it[0]:5d}  box x{it[1]}-{it[3]} y{it[2]}-{it[4]}  holes {it[5][0]} seam {it[5][1]}')
im = Image.fromarray(vis.astype(np.uint8))
if crop:
    W, H = im.size
    im = im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H)))
if zoom != 1:
    im = im.resize((int(im.width * zoom), int(im.height * zoom)), Image.NEAREST)
im.save(out)
print(out, im.size)
