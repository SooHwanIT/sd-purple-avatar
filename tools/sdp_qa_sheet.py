# sd_purple 검수 시트: source/vtuber/video/<dir>/f_*.jpg 를 격자로 모아 → <out> (각 칸에 이름)
import sys, glob, os
from PIL import Image, ImageDraw, ImageFont
d = sys.argv[1]
out = sys.argv[2]
names = sys.argv[3].split('|') if len(sys.argv) > 3 else None
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
crop = tuple(map(float, sys.argv[5].split(','))) if len(sys.argv) > 5 else None  # 비율 x0,y0,x1,y1
cell = int(sys.argv[6]) if len(sys.argv) > 6 else 300
files = sorted(glob.glob(os.path.join(r'C:\Users\happy\Downloads\boy\source\vtuber\video', d, 'f_*.jpg')))
ims = []
for f in files:
    im = Image.open(f).convert('RGB')
    if crop:
        W, H = im.size
        im = im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H)))
    s = cell / max(im.size)
    ims.append(im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS))
cw = max(i.width for i in ims)
ch = max(i.height for i in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cw, rows * (ch + 22)), (30, 28, 36))
dr = ImageDraw.Draw(sheet)
f = ImageFont.truetype('malgun.ttf', 15)
for k, im in enumerate(ims):
    x = (k % cols) * cw
    y = (k // cols) * (ch + 22)
    sheet.paste(im, (x + (cw - im.width) // 2, y + 22))
    lab = names[k] if names and k < len(names) else str(k)
    dr.text((x + 5, y + 2), lab, fill=(255, 230, 120), font=f)
sheet.save(out, quality=90)
print(out, sheet.size)
