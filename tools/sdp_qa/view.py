# 모델 좌표 (cx, cy) 가 화면 가운데 오는 stage.view 값 (보이지 않는 크롬 1184x1105 기준): python view.py cx cy zoom
import sys
cx, cy, z = map(float, sys.argv[1:4])
W, H = 1184, 1105
bx0, by0, bx1, by1 = 210.0, 63.0, 854.0, 1277.5
fit = min(W / (bx1 - bx0), H / (by1 - by0))
s = fit * z
ox = -(cx - (bx0 + bx1) / 2) * s / W
oy = -(cy - (by0 + by1) / 2) * s / H
print('{zoom:%g,offsetX:%.4f,offsetY:%.4f}' % (z, ox, oy))
