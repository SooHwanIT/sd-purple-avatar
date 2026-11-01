# sd_purple: 사용자가 그린 새 머리(뒷머리 1장 + 다발 8개)를 모델 레이어로 → work/newhair/*.png + work/newhair.json
# - 다발 8개는 1508×2000 틀이지만 뒷머리(1632×2176)를 줄여 만든 같은 그림 틀이라, 뒷머리 정렬(0.75배, 131,-86.5)에 틀 비율을 곱해 맞춤
# - 다발마다 완전하게 그려져 있어(다른 다발·얼굴에 가려질 부분까지) 그대로 얹으면 얼굴을 덮음 → 원본에서 얼굴이 보이던 곳(얼굴 창)
#   안쪽은 '뒤' 조각(얼굴 뒤), 바깥은 '앞' 조각으로 나눔. 두 조각은 같은 움직임이라 흔들려도 이어짐. 앞 조각이 잘린 가장자리엔 머리카락 외곽선
# - 바보털(연보라)은 뒷머리에서 떼어 따로 흔들리게, 다발들에 그려진 바보털 조각은 지움
#   python tools/sdp_newhair.py
import json, os
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

D = r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple'
OUT = D + r'\work\newhair'
os.makedirs(OUT, exist_ok=True)
H, W = 2000, 1508
YY, XX = np.mgrid[0:H, 0:W]
reg = json.load(open(D + r'\parts_aligned\register.json'))['back_hair']['A']
s0, tx, ty = reg[0][0], reg[0][2], reg[1][2]
A_piece = np.array([[s0 * 1632 / 1508, 0, tx], [0, s0 * 2176 / 2000, ty]], np.float32)
lab = np.load(D + r'\work\labels.npz')
L = lab['label']
O = [str(x) for x in lab['order']]
V = lambda *ns: np.isin(L, [O.index(n) for n in ns])


def dil(m, r):
    return cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0


# 얼굴 창: 두 눈의 속눈썹 띠 윗선을 잇는 매끈한 선 아래의 얼굴·눈·입·목 (그 위 이마는 새 앞머리가 덮음).
# 띠·쌍꺼풀 선·하이라이트는 머리카락 위에 그려 눈 모양은 그대로. 다발은 이 선에서 끝나고 외곽선이 붙음
info = json.load(open(D + r'\work\layers.json'))['info']['eyes']
cut = np.full(W, np.nan)
ends = []
for sd in ('r', 'l'):
    E = info[sd]
    xs_ = np.arange(int(E['x0']), int(E['x1']) + 1)
    cut[xs_] = np.polyval(E['top'], xs_) - 2
    ends.append((xs_[0], cut[xs_[0]], xs_[-1], cut[xs_[-1]]))
(r0, r0y, r1, r1y), (l0, l0y, l1, l1y) = sorted(ends)
xs_ = np.arange(r1, l0 + 1)
cut[xs_] = np.interp(xs_, [r1, l0], [r1y, l0y]) + 4  # 콧등: 살짝 아래
cut[:r0] = r0y + 6
cut[l1 + 1:] = l1y + 6
cut = np.convolve(np.pad(cut, 15, mode='edge'), np.ones(31) / 31, mode='valid')
lower = YY >= cut[XX]
eyes_open = np.zeros((H, W), bool)
lay = json.load(open(D + r'\work\layers.json'))['layers']
for sd in ('r', 'l'):
    m_ = lay['open_' + sd]
    om = np.array(Image.open(D + rf'\work\layers\open_{sd}.png'))[..., 3] > 128
    eyes_open[m_['y']:m_['y'] + m_['h'], m_['x']:m_['x'] + m_['w']] |= om
skinish = V('face', 'mouth', 'white_r', 'white_l', 'iris_r', 'iris_l', 'hl_r', 'hl_l', 'lid_r', 'lid_l', 'crease_r', 'crease_l', 'neck', 'brow_r', 'brow_l')
skinish = cv2.morphologyEx(skinish.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
win = (skinish & lower) | eyes_open
lb_, k_ = ndi.label(win)
sz_ = np.bincount(lb_.ravel()); sz_[0] = 0
win = np.isin(lb_, np.nonzero(sz_ > 3000)[0])
win = cv2.GaussianBlur(win.astype(np.float32), (0, 0), 2.0) > 0.5
win_soft = cv2.GaussianBlur(win.astype(np.float32), (0, 0), 0.8)

BH = np.array(Image.open(D + r'\parts_aligned\back_hair.png')).astype(np.float32)
pieces = {}
for n in sorted(os.listdir(D + r'\parts_in')):
    if 'hair_0' not in n:
        continue
    P = np.array(Image.open(os.path.join(D, 'parts_in', n)).convert('RGBA')).astype(np.float32)
    pieces[n[9:16]] = cv2.warpAffine(P, A_piece, (W, H), flags=cv2.INTER_LINEAR)


def mauve(img):
    r, g, b, a = img[..., 0], img[..., 1], img[..., 2], img[..., 3]
    return (a > 128) & (r > 120) & (b > 130) & (g > 90) & (np.abs(r - b) < 45) & (YY < 520)


# 바보털: 뒷머리의 연보라 큰 덩어리 + 둘레 검은 외곽선
mv = mauve(BH)
lb, k = ndi.label(mv)
sz = np.bincount(lb.ravel()); sz[0] = 0
ah_core = lb == sz.argmax()
ah = ah_core | (dil(ah_core, 9) & (BH[..., 3] > 60) & (BH[..., :3].max(2) < 70) & (YY < 520))
ys, xs = np.nonzero(ah_core)
# 뿌리: 머리 쪽(가장 아래·가운데에 가까운) 끝, 끝: 뿌리에서 가장 먼 점
bot = np.argmax(ys)
root = (float(xs[bot]), float(ys[bot]))
far = np.argmax((xs - root[0]) ** 2 + (ys - root[1]) ** 2)
tip = (float(xs[far]), float(ys[far]))
AH = np.zeros_like(BH)
AH[ah] = BH[ah]
BH2 = BH.copy()
# 뒷머리에서 바보털을 떼고, 그 뿌리 자리는 머리카락 색으로 메움 (바보털이 흔들리면 드러남)
hair_c = np.median(BH[(BH[..., 3] > 200) & (BH[..., :3].max(2) > 35) & (BH[..., :3].max(2) < 70) & (YY > 400) & (YY < 900)][:, :3], 0)
BH2[ah] = 0
# 바보털 뿌리 쪽(머리 실루엣 안)은 머리카락 색으로 메움: 바보털이 흔들려도 뒤에 구멍이 안 생김
sil = cv2.morphologyEx(((BH[..., 3] > 128) & ~ah).astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))) > 0
base_fill = ah & sil
BH2[base_fill, :3] = hair_c
BH2[base_fill, 3] = 255
zone = dil(ah, 14)
for nm, P in pieces.items():
    mvp = mauve(P) & dil(ah_core, 40)
    P[dil(mvp, 6) & (YY < 520) & ((P[..., :3].max(2) < 70) | mvp)] = 0
    # 바보털 둘레에 남은 가는 외곽선(호): 두께 9px 보다 얇은 것은 지움
    am = (P[..., 3] > 40).astype(np.uint8)
    thick = cv2.dilate(cv2.morphologyEx(am, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))), np.ones((5, 5), np.uint8)) > 0
    P[zone & ~thick] = 0

hl_c = np.array([24, 18, 22], np.float32)
ORDER = ['hair_07', 'hair_08', 'hair_05', 'hair_06', 'hair_01', 'hair_02', 'hair_04', 'hair_03']
Z0 = {'hair_07': -0.04, 'hair_08': -0.04, 'hair_05': 0.0, 'hair_06': 0.0, 'hair_01': 0.02, 'hair_02': 0.04, 'hair_04': 0.05, 'hair_03': 0.06}
MAX = {'hair_07': 9, 'hair_08': 9, 'hair_05': 8, 'hair_06': 8, 'hair_01': 5, 'hair_02': 6, 'hair_04': 5, 'hair_03': 5}
crown = np.array([750.0, 300.0])  # 정수리 위: 다발마다 여기서 가장 가까운 곳이 뿌리
meta = {'pieces': [], 'size': [W, H]}


def save(name, img):
    a = img[..., 3]
    ys, xs = np.nonzero(a > 0)
    if not len(ys):
        return None
    p = 3
    x0, y0 = max(0, xs.min() - p), max(0, ys.min() - p)
    x1, y1 = min(W, xs.max() + p + 1), min(H, ys.max() + p + 1)
    Image.fromarray(np.clip(img[y0:y1, x0:x1], 0, 255).astype(np.uint8)).save(os.path.join(OUT, name + '.png'))
    return dict(x=int(x0), y=int(y0), w=int(x1 - x0), h=int(y1 - y0))


for i, nm in enumerate(ORDER):
    P = pieces[nm]
    a = P[..., 3] / 255
    front = P.copy()
    front[..., 3] = P[..., 3] * (1 - win_soft)
    back = P.copy()
    back[..., 3] = P[..., 3] * win_soft
    # 앞 조각이 얼굴 창에서 잘린 곳: 안쪽 3px 를 머리카락 외곽선 색으로 (조각이 창 안으로 이어지던 곳만)
    fm = front[..., 3] > 128
    cut = fm & dil(win & (P[..., 3] > 128), 3)
    front[cut, :3] = hl_c
    # 뿌리·끝 (흔들림 축)
    m = P[..., 3] > 128
    ys, xs = np.nonzero(m)
    d0 = (xs - crown[0]) ** 2 + (ys - crown[1]) ** 2
    j = np.argmin(d0)
    near = d0 <= d0[j] + 60 ** 2
    root_p = (float(xs[near].mean()), float(ys[near].mean()))
    df = (xs - root_p[0]) ** 2 + (ys - root_p[1]) ** 2
    t = np.argmax(df)
    tip_p = (float(xs[t]), float(ys[t]))
    reach = float(np.sqrt(df[t]))
    bf = save(nm + '_f', front)
    bb = save(nm + '_b', back)
    meta['pieces'].append(dict(name=nm, front=bf, back=bb, z0=Z0[nm], root=root_p, tip=tip_p, radius=reach * 0.9,
                               param='Hair' + 'ABCDEF'[i % 6], max=MAX[nm], phase=round(i * 0.83, 2)))
    print(nm, 'root', np.round(root_p), 'tip', np.round(tip_p), 'front px', int(fm.sum()), 'back px', int((back[..., 3] > 128).sum()))
meta['hair_back'] = save('hair_back', BH2)
meta['ahoge'] = dict(box=save('ahoge', AH), root=root, tip=tip)
json.dump(meta, open(D + r'\work\newhair.json', 'w'), indent=1)
print('ahoge root', root, 'tip', tip)
