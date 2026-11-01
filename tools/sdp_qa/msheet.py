# 모델 좌표로 자르는 검수 시트: python msheet.py <dir> <out.jpg> "이름|..." <열수> "mx0,my0,mx1,my1" "<zoom> <offsetX> <offsetY>" [칸 px] [프레임 번호들 i,j,k]
# (보이지 않는 크롬 1184x1105 기준, view.py 와 같은 식)
import sys, glob, os
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]
names = sys.argv[3].split('|') if sys.argv[3] else None
cols = int(sys.argv[4])
mx0, my0, mx1, my1 = map(float, sys.argv[5].split(','))
z, ox, oy = map(float, sys.argv[6].split())
cell = int(sys.argv[7]) if len(sys.argv) > 7 else 320
idx = [int(x) for x in sys.argv[8].split(',')] if len(sys.argv) > 8 and sys.argv[8] else None
W, H = 1184, 1105
bx0, by0, bx1, by1 = 210.0, 63.0, 854.0, 1277.5
fit = min(W / (bx1 - bx0), H / (by1 - by0))
s = fit * z
cx = (bx0 + bx1) / 2 - ox * W / s
cy = (by0 + by1) / 2 - oy * H / s
fx = lambda mx: W / 2 + (mx - cx) * s
fy = lambda my: H / 2 + (my - cy) * s
files = sorted(glob.glob(os.path.join(r'C:\Users\happy\Downloads\boy\source\vtuber\video', d, 'f_*.jpg')))
if idx:
    byi = {int(os.path.basename(f)[2:-4]): f for f in files}
    files = [byi[i] for i in idx]
box = (int(fx(mx0)), int(fy(my0)), int(fx(mx1)), int(fy(my1)))
ims = []
for f in files:
    im = Image.open(f).convert('RGB').crop(box)
    k = cell / max(im.size)
    ims.append(im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS))
cw = max(i.width for i in ims)
ch = max(i.height for i in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cw, rows * (ch + 22)), (30, 28, 36))
dr = ImageDraw.Draw(sheet)
font = ImageFont.truetype('malgun.ttf', 15)
for k, im in enumerate(ims):
    x = (k % cols) * cw
    y = (k // cols) * (ch + 22)
    sheet.paste(im, (x, y + 22))
    lab = names[k] if names and k < len(names) else str(k)
    dr.text((x + 5, y + 2), lab, fill=(255, 230, 120), font=font)
sheet.save(out, quality=90)
print(out, sheet.size, 'box', box)
