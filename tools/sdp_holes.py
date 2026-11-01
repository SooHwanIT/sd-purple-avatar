# sd_purple 구멍 검사 (img2rig 의 wiggle test 를 본뜬 것): 초록 바탕에 그린 자세 프레임에서
# 아바타 실루엣 안에 갇힌 초록 픽셀(= 부위 사이로 배경이 비치는 구멍)과 가는 틈을 센다.
#   python tools/sdp_holes.py <video dir> [이름들 |로]
import sys, glob, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
d = sys.argv[1]
names = sys.argv[2].split('|') if len(sys.argv) > 2 else None
fs = sorted(glob.glob(os.path.join(r'C:\Users\happy\Downloads\boy\source\vtuber\video', d, 'f_*.jpg')))
tot = 0
for k, f in enumerate(fs):
    a = np.array(Image.open(f).convert('RGB')).astype(int)
    g = (a[..., 1] > 150) & (a[..., 0] < 60) & (a[..., 2] < 60)
    lab, n = ndi.label(g)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    enclosed = g & ~np.isin(lab, list(border))
    # 반쯤 비친 틈: 초록 기운이 섞인 픽셀(가장자리 제외)
    tint = (a[..., 1] > a[..., 0] + 40) & (a[..., 1] > a[..., 2] + 40) & ~g
    sil = ndi.binary_fill_holes(~g)
    inner_tint = tint & ndi.binary_erosion(sil, iterations=3)
    h, t = int(enclosed.sum()), int(inner_tint.sum())
    tot += h + t // 2
    lab_name = names[k] if names and k < len(names) else str(k)
    print(f'{lab_name:>16}: holes {h:6d}  seam {t:6d}')
print('score', tot)
