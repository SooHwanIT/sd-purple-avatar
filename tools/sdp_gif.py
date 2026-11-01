# sd_purple 움직임 영상: source/vtuber/video/<dir>/f_*.jpg(PNG 내용도 됨) → GIF. 가운데 잘라 줄이고, 공통 색표로 용량을 줄임
import sys, glob, os
from PIL import Image
d, out = sys.argv[1], sys.argv[2]
crop = tuple(map(float, sys.argv[3].split(','))) if len(sys.argv) > 3 else (0, 0, 1, 1)
width = int(sys.argv[4]) if len(sys.argv) > 4 else 420
step = int(sys.argv[5]) if len(sys.argv) > 5 else 1
fps = float(sys.argv[6]) if len(sys.argv) > 6 else 15
fs = sorted(glob.glob(os.path.join(r'C:\Users\happy\Downloads\boy\source\vtuber\video', d, 'f_*.jpg')))[::step]
rgb = []
for f in fs:
    im = Image.open(f).convert('RGB')
    W, H = im.size
    im = im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H)))
    rgb.append(im.resize((width, int(im.height * width / im.width)), Image.LANCZOS))
# 공통 색표: 여러 장을 이어 붙여 한 번에 고름
sample = Image.new('RGB', (width, rgb[0].height * 6))
for i, k in enumerate(range(0, len(rgb), max(1, len(rgb) // 6))):
    if i < 6:
        sample.paste(rgb[k], (0, rgb[0].height * i))
pal = sample.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
frames = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in rgb]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / fps * step), loop=0, optimize=False)
print(out, len(frames), os.path.getsize(out) // 1024, 'KB')
