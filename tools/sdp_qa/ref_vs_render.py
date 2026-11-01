# 원본 ref.webp 를 렌더와 같은 화면 좌표로 옮겨 나란히 + 차이 → out.png
#   python ref_vs_render.py <frame.jpg> <zoom> <offsetX> <offsetY> <out.png> [x0,y0,x1,y1 화면 비율]
import sys
import numpy as np
from PIL import Image
f, z, ox, oy, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
crop = tuple(map(float, sys.argv[6].split(','))) if len(sys.argv) > 6 else None
W, H = 1184, 1105
bx0, by0, bx1, by1 = 210.0, 63.0, 854.0, 1277.5
fit = min(W / (bx1 - bx0), H / (by1 - by0))
s = fit * z
cx = (bx0 + bx1) / 2 - ox * W / s
cy = (by0 + by1) / 2 - oy * H / s
ref = Image.open(r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple\ref.webp').convert('RGB')
# 원본 px → 모델 px(×0.7) → 화면: X = W/2 + (0.7*sx - cx)*s
S = 0.7 * s
tx = W / 2 - cx * s
ty = H / 2 - cy * s
# PIL affine: 출력 좌표 → 입력 좌표 (역변환)
refi = ref.transform((W, H), Image.AFFINE, (1 / S, 0, -tx / S, 0, 1 / S, -ty / S), resample=Image.BICUBIC, fillcolor=(43, 38, 54))
ren = Image.open(f).convert('RGB')
a = np.array(refi).astype(int)
b = np.array(ren).astype(int)
d = np.abs(a - b).max(2)
dv = Image.fromarray(np.clip(d * 2, 0, 255).astype(np.uint8)).convert('RGB')
ims = [refi, ren, dv]
if crop:
    ims = [im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H))) for im in ims]
sheet = Image.new('RGB', (ims[0].width * 3 + 20, ims[0].height), (20, 20, 20))
for i, im in enumerate(ims):
    sheet.paste(im, (i * (im.width + 10), 0))
sheet.save(out)
print(out, sheet.size, 'mean diff', float(d.mean()))
