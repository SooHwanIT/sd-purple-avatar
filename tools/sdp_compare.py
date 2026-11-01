# sd_purple: 원본 vs 레이어 다시 합성 비교 (부분 확대) → work/cmp_<이름>.png
import sys, json
import numpy as np
from PIL import Image
W0 = r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple\work'
meta = json.load(open(W0 + r'\layers.json'))
order = [str(x) for x in np.load(W0 + r'\labels.npz')['order']]
src = np.array(Image.open(W0 + r'\ref_rgba.png')).astype(np.float32)
H, W = src.shape[:2]
comp = np.zeros((H, W, 3), np.float32)
for n in order:
    if n not in meta['layers']:
        continue
    L = meta['layers'][n]
    im = np.array(Image.open(rf'{W0}\layers\{n}.png')).astype(np.float32)
    a = im[..., 3:4] / 255
    sl = comp[L['y']:L['y'] + L['h'], L['x']:L['x'] + L['w']]
    sl[:] = sl * (1 - a) + im[..., :3] * a
x0, y0, x1, y1 = map(int, sys.argv[1:5])
s = int(sys.argv[5]) if len(sys.argv) > 5 else 2
name = sys.argv[6] if len(sys.argv) > 6 else 'x'
o = src[y0:y1, x0:x1, :3] * (src[y0:y1, x0:x1, 3:4] / 255)
c = comp[y0:y1, x0:x1]
row = np.concatenate([o, np.full((y1 - y0, 6, 3), 255, np.float32), c], 1)
im = Image.fromarray(np.clip(row, 0, 255).astype(np.uint8))
im = im.resize((im.width * s, im.height * s), Image.NEAREST)
im.save(rf'{W0}\cmp_{name}.png')
print('mean diff', float(np.abs(o - c).mean()))
