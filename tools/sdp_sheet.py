# sd_purple 레이어 모아 보기: work/layers/*.png → work/layers_sheet.jpg (초록 바탕, 이름 표시)
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
W0 = r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple\work'
meta = json.load(open(W0 + r'\layers.json'))
names = sys.argv[1:] or list(meta['layers'])
cell = 300
cols = 6
rows = (len(names) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cell, rows * (cell + 20)), (40, 40, 40))
f = ImageFont.truetype('arial.ttf', 15)
dr = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    im = Image.open(rf'{W0}\layers\{n}.png')
    s = min((cell - 10) / im.width, (cell - 10) / im.height, 1.5)
    im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
    bg = Image.new('RGB', im.size, (0, 190, 0))
    bg.paste(im, (0, 0), im)
    x = (i % cols) * cell + (cell - im.width) // 2
    y = (i // cols) * (cell + 20) + 20 + (cell - im.height) // 2
    sheet.paste(bg, (x, y))
    dr.text(((i % cols) * cell + 6, (i // cols) * (cell + 20) + 2), n, fill=(255, 255, 0), font=f)
sheet.save(W0 + r'\layers_sheet.jpg', quality=88)
