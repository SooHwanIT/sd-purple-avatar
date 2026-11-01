# SD 보라 캐릭터(sd_purple) 1단계: 검은 배경 걷어 내기 → ref_rgba.png
# 배경은 그림 가장자리에서 이어진 아주 어두운 픽셀(채널 최대 ≤ T). 캐릭터 바깥 테두리는 (18,15,16)~(46,30,42) 라 구분된다.
# 가장자리 반투명: 배경이 검정이라 픽셀 = 알파 × 테두리색 → 알파 = 밝기 / 가까운 안쪽 테두리 밝기
import sys
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

SRC = r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple'
T = int(sys.argv[1]) if len(sys.argv) > 1 else 5

im = np.array(Image.open(SRC + r'\ref.webp').convert('RGB'))
H, W, _ = im.shape
mx = im.max(2).astype(np.int32)
dark = mx <= T
lab, n = ndi.label(dark)
border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
bg = np.isin(lab, border[border > 0])
print('bg frac', bg.mean(), 'dark comps', n)
# 안쪽(캐릭터) = 배경 아님. 가장자리 2px 띠는 밝기로 알파 계산
fg = ~bg
# 테두리 기준 밝기: 안쪽으로 3~6px 들어간 픽셀의 최대 밝기(주변 최대값)
lum = im.astype(np.float32).max(2)
inner = cv2.erode(fg.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
ref = ndi.grey_dilation(np.where(inner, lum, 0), size=(9, 9))
edge = fg & ~inner
alpha = np.ones((H, W), np.float32)
alpha[bg] = 0
# 배경 쪽 1px 바깥도 반투명 후보 (안티에일리어싱이 배경 쪽으로 번진 것)
ring = cv2.dilate(fg.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
cand = (edge | (ring & bg)) & (ref > 8)
alpha[cand] = np.clip(lum[cand] / np.maximum(ref[cand], 1), 0, 1)
alpha[inner] = 1
rgb = im.astype(np.float32)
# 반투명 픽셀 색 되돌리기 (미리 곱한 값 → 원래 색): 안쪽 테두리 색으로
a3 = alpha[..., None]
col = np.where(a3 > 0.02, np.clip(rgb / np.maximum(a3, 0.02), 0, 255), 0)
out = np.dstack([col, alpha * 255]).astype(np.uint8)
Image.fromarray(out).save(SRC + r'\work\ref_rgba.png')
# 확인용: 초록 배경에 합성
g = np.zeros_like(rgb); g[..., 1] = 200
comp = (col * a3 + g * (1 - a3)).astype(np.uint8)
Image.fromarray(comp).resize((W // 2, H // 2), Image.LANCZOS).save(SRC + r'\work\matte_check.jpg', quality=90)
print('alpha<1 px', int(((alpha > 0) & (alpha < 1)).sum()))
