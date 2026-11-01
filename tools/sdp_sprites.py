# sd_purple: 사용자가 준 스프라이트 시트(parts_in2: 눈·입·눈썹·효과)를 하나씩 잘라 모델 폴더 sprites/ 에 저장 + sprites.json
# 크기는 원본에서 같은 부위의 크기에 맞춤 (눈: 눈 너비, 입: 입 너비, 눈썹: 눈썹 너비). 위치는 원본 부위 자리(모델 px).
# 런타임(chibi_rig.js)이 rig.sprites 로 불러 바꿔 끼운다.
import json, os
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

ROOT = r'C:\Users\happy\Downloads\boy'
D = ROOT + r'\source\vtuber\sd_purple'
OUT = ROOT + r'\avatar\public\model_sd_purple\sprites'
os.makedirs(OUT, exist_ok=True)
S = 0.7  # 원본 px → 모델 px (sdp_build 와 같음)
lab = np.load(D + r'\work\labels.npz')
L = lab['label']
O = [str(x) for x in lab['order']]
info = json.load(open(D + r'\work\layers.json'))['info']


def bb(*ns):
    m = np.isin(L, [O.index(n) for n in ns])
    ys, xs = np.nonzero(m)
    return xs.min(), ys.min(), xs.max(), ys.max()


def components(path):
    a = np.array(Image.open(path).convert('RGBA'))
    m = a[..., 3] > 20
    g = cv2.dilate(m.astype(np.uint8), np.ones((31, 31), np.uint8)) > 0
    lb, k = ndi.label(g)
    items = []
    for i, sl in enumerate(ndi.find_objects(lb)):
        mm = (lb[sl] == i + 1) & m[sl]
        if mm.sum() < 200:
            continue
        ys, xs = np.nonzero(mm)
        x0, y0, x1, y1 = sl[1].start + xs.min(), sl[0].start + ys.min(), sl[1].start + xs.max() + 1, sl[0].start + ys.max() + 1
        piece = a[y0:y1, x0:x1].copy()
        piece[~((lb[y0:y1, x0:x1] == i + 1))] = 0
        items.append(dict(box=(x0, y0, x1, y1), img=piece))
    items.sort(key=lambda it: (int((it['box'][1] + it['box'][3]) / 2 // 350), it['box'][0]))
    return a, items


def group_rows(a, rows):
    """줄(위·아래 범위)마다 왼쪽·오른쪽 반으로 묶어 하나씩 (홍조 빗금처럼 조각난 것)"""
    out = []
    for (ya, yb) in rows:
        for xa, xb in ((0, a.shape[1] // 2), (a.shape[1] // 2, a.shape[1])):
            sub = a[ya:yb, xa:xb]
            ys, xs = np.nonzero(sub[..., 3] > 20)
            if not len(ys):
                continue
            out.append(dict(box=(xa + xs.min(), ya + ys.min(), xa + xs.max() + 1, ya + ys.max() + 1),
                            img=sub[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()))
    return out


sprites = {}


def save(name, it, scale, cx, cy, extra=None):
    """scale: 시트 px → 원본 px. 저장은 모델 px 의 2배 해상도로"""
    img = it['img']
    h, w = img.shape[:2]
    mw, mh = w * scale * S, h * scale * S
    tw, th = max(2, int(round(mw * 2))), max(2, int(round(mh * 2)))
    im = Image.fromarray(img).resize((tw, th), Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.png'))
    d = dict(file=f'sprites/{name}.png', w=round(mw, 2), h=round(mh, 2), cx=round(cx * S, 2), cy=round(cy * S, 2))
    if extra:
        d.update(extra)
    sprites[name] = d


# ---- 눈: 1줄 뜬 눈(쓰지 않음), 2줄 감은 눈 ‿, 3줄 웃는 감은 눈 ^ ----
_, eyes = components(D + r'\parts_in2\sd_purple_06_eyes.png')
eye_w = {s: (bb(f'lid_{s}')[2] - bb(f'lid_{s}')[0]) for s in 'rl'}
open_w = (eyes[0]['box'][2] - eyes[0]['box'][0] + eyes[1]['box'][2] - eyes[1]['box'][0]) / 2
for k, side in ((2, 'r'), (3, 'l')):
    E = info['eyes'][side]
    sc = eye_w[side] / open_w * 1.0
    it = eyes[k]
    cx = (E['x0'] + E['x1']) / 2
    # 감은 눈 선의 높이: 원본 눈 높이의 60% 쯤 (뜬 눈 띠 아래 끝 ~ 아래 경계 사이)
    x0, y0, x1, y1 = bb(f'white_{side}', f'iris_{side}', f'lid_{side}')
    save(f'eye_closed_{side}', it, sc, cx, y0 + (y1 - y0) * 0.58)
for k, side in ((4, 'r'), (5, 'l')):
    x0, y0, x1, y1 = bb(f'white_{side}', f'iris_{side}', f'lid_{side}')
    sc = eye_w[side] / open_w
    save(f'eye_smile_{side}', eyes[k], sc, (x0 + x1) / 2, y0 + (y1 - y0) * 0.5)

# ---- 입 9개 (시트 순서: 다문 입, 아, 이(작게), 오(작게), 이(크게), 오, 웃는 입, 우(세로), 크게 웃음) ----
a, mouths = components(D + r'\parts_in2\sd_purple_07_mouths.png')
names = ['closed', 'a', 'e', 'o_small', 'i', 'o', 'smile', 'u', 'laugh']
mx0, my0, mx1, my1 = bb('mouth')
base_w = mx1 - mx0  # 원본의 벌린 입 너비
base_top = my0
sc = base_w / (mouths[1]['box'][2] - mouths[1]['box'][0]) * 1.05
for nm, it in zip(names, mouths):
    w = (it['box'][2] - it['box'][0]) * sc
    h = (it['box'][3] - it['box'][1]) * sc
    cx = (mx0 + mx1) / 2
    # 다문 선은 원본 입('o')의 위에서 30% 자리 (입술이 맞닿는 높이) — 원본 'o' 와 바꿔 낄 때 덜 튐
    cy = base_top + h / 2 if nm != 'closed' else base_top + (my1 - my0) * 0.3
    save('mouth_' + nm, it, sc, cx, cy)
# 원본의 작은 'o' 입 (가만히 있을 때의 입): 원본 픽셀 그대로 (2026-11-02, 사용자: 쉬는 얼굴이 원본과 달라졌다)
ref = np.array(Image.open(D + '/work/ref_rgba.png').convert('RGBA'))
mm = L == O.index('mouth')
mm2 = cv2.dilate(mm.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
ys_, xs_ = np.nonzero(mm2)
y0_, y1_, x0_, x1_ = ys_.min(), ys_.max() + 1, xs_.min(), xs_.max() + 1
piece = ref[y0_:y1_, x0_:x1_].copy()
# 바깥 2px 는 서서히 투명하게 (피부 위에 얹혀도 테가 안 보이게)
dist = cv2.distanceTransform((~mm[y0_:y1_, x0_:x1_]).astype(np.uint8), cv2.DIST_L2, 3)
piece[..., 3] = (piece[..., 3] * np.clip(1 - dist / 2.5, 0, 1)).astype(np.uint8)
save('mouth_rest', dict(box=(x0_, y0_, x1_, y1_), img=piece), 1.0, (x0_ + x1_) / 2, (y0_ + y1_) / 2)

# ---- 눈썹 4쌍: 기본, 올림, 슬픔, 화남 ----
_, brows = components(D + r'\parts_in2\sd_purple_08_eyebrows.png')
bnames = ['neutral', 'up', 'sad', 'angry']
for j, nm in enumerate(bnames):
    for side, it in (('r', brows[2 * j]), ('l', brows[2 * j + 1])):
        x0, y0, x1, y1 = bb('brow_' + side)
        base_w = x1 - x0
        n_it = brows[0] if side == 'r' else brows[1]
        sc = base_w / (n_it['box'][2] - n_it['box'][0])
        save(f'brow_{nm}_{side}', it, sc, (x0 + x1) / 2, (y0 + y1) / 2)

# ---- 효과: 홍조(좌·우), 눈물(좌·우), 땀, 화남 표시 ----
a = np.array(Image.open(D + r'\parts_in2\sd_purple_10_effects.png').convert('RGBA'))
fx = group_rows(a, [(380, 800), (880, 1280), (1400, 2000)])
blush = info  # 홍조 자리: rig.blush.spots (원본 px)
spots = [(592, 938), (905, 950)]
for it, side, (bx, by) in zip(fx[0:2], 'rl', spots):
    sc = 120 / (it['box'][2] - it['box'][0])
    save(f'fx_blush_{side}', it, sc, bx, by)
for it, side in zip(fx[2:4], 'rl'):
    x0, y0, x1, y1 = bb(f'white_{side}', f'iris_{side}')
    sc = 46 / (it['box'][2] - it['box'][0])
    # 눈 바깥쪽 아래
    cx = x0 + 22 if side == 'r' else x1 - 22
    save(f'fx_tear_{side}', it, sc, cx, y1 + 18)
sweat = fx[4]
save('fx_sweat', sweat, 56 / (sweat['box'][2] - sweat['box'][0]), 1060, 690)
anger = fx[5]
save('fx_anger', anger, 120 / (anger['box'][2] - anger['box'][0]), 1010, 470)

json.dump(sprites, open(OUT + r'\sprites.json', 'w'), indent=1)
print(len(sprites), 'sprites')
for k, v in sprites.items():
    print(k, v['w'], v['h'], v['cx'], v['cy'])
