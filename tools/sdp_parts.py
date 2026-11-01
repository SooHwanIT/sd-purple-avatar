# sd_purple 3단계: 부위 나누기 → work/labels.npz (+ 확인 그림 labels_vis.png)
# 단색 영역(regions.npz)을 다각형·색 묶음으로 부위에 배정하고, 검은 선은 "앞에 그려지는 부위"가 가진다.
# 좌우 이름은 앱 규칙: _r = 화면 왼쪽(캐릭터 오른쪽), _l = 화면 오른쪽.
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

W0 = r'C:\Users\happy\Downloads\boy\source\vtuber\sd_purple\work'
d = np.load(W0 + r'\regions.npz')
reg, line, fg, cls = d['reg'], d['line'], d['fg'], d['cls']
H, W = fg.shape
rgba = np.array(Image.open(W0 + r'\ref_rgba.png'))
rgb = rgba[..., :3].astype(np.int32)
lum = rgb.max(2)

# 그리는 순서 (뒤 → 앞). 선 주인을 정할 때 앞쪽이 이긴다
ORDER = ['leg_r', 'strap', 'leg_l', 'shoe_r', 'shoe_l', 'chain', 'neck', 'inner', 'necklace', 'jacket', 'lapel_r', 'lapel_l', 'psq', 'brooch',
         'hair_back', 'ahoge', 'ear_r', 'ear_l', 'face', 'mouth',
         'white_r', 'white_l', 'iris_r', 'iris_l', 'lid_r', 'lid_l', 'hl_r', 'hl_l', 'crease_r', 'crease_l',
         'hair', 'brow_r', 'brow_l', 'arm_r', 'arm_l', 'earring']
Z = {n: i for i, n in enumerate(ORDER)}


def poly(pts):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m > 0


def ellipse(cx, cy, rx, ry, ang=0):
    m = np.zeros((H, W), np.uint8)
    cv2.ellipse(m, (int(cx), int(cy)), (int(rx), int(ry)), ang, 0, 360, 1, -1)
    return m > 0


def regions_at(*pts):
    ids = {int(reg[y, x]) for x, y in pts if reg[y, x] > 0}
    return np.isin(reg, list(ids)) if ids else np.zeros((H, W), bool)


def classes(*ks):
    return np.isin(cls, ks)


YY, XX = np.mgrid[0:H, 0:W]
label = np.full((H, W), -1, np.int16)


def claim(name, mask, only_free=True):
    m = mask & fg
    if only_free:
        m &= label < 0
    label[m] = Z[name]
    return m


# ---------- 머리 쪽 작은 부위 ----------
# 귀걸이: 고리(원) + 고리 걸이 + 다이아
rr = np.hypot(XX - 1013, YY - 976)
dia = poly([(1013, 994), (1052, 1031), (1013, 1072), (974, 1031)])
hook = poly([(1007, 992), (1019, 992), (1019, 1004), (1007, 1004)])
claim('earring', (rr <= 24) | dia | hook)

# 눈: 흰자(색 13) · 홍채(보라 계열) · 하이라이트 · 눈꺼풀 띠(선)
EYE = {
    'r': dict(box=poly([(448, 770), (700, 770), (700, 935), (448, 935)]), hl=(611, 818),
              lid=poly([(450, 803), (466, 786), (560, 782), (690, 786), (694, 800), (690, 826), (600, 826), (520, 828), (470, 832), (452, 822)])),
    'l': dict(box=poly([(770, 780), (1040, 780), (1040, 945), (770, 945)]), hl=(882, 831),
              lid=poly([(778, 806), (790, 794), (900, 792), (1000, 800), (1030, 818), (1024, 838), (960, 838), (880, 836), (790, 832), (778, 822)])),
}
for s, e in EYE.items():
    claim(f'hl_{s}', regions_at(e['hl']))
    claim(f'lid_{s}', e['lid'] & (lum <= 14))
    iris = e['box'] & classes(2, 4, 6, 8, 11, 5) & ~e['lid']
    lab_i, n = ndi.label(iris)
    if n:
        big = np.argmax(np.bincount(lab_i.ravel())[1:]) + 1
        core = ndi.binary_fill_holes(lab_i == big)
        # 홍채 가장자리의 더 어두운 테(다른 색 묶음)도 홍채로
        k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        rim = (cv2.dilate(core.astype(np.uint8), k5) > 0) & e['box'] & ~e['lid'] & (lum < 160) & (lum > 14) & ~core
        # 홍채 영역에 합쳐진 작은 띠 픽셀(다른 색 묶음)도 같은 영역이면 홍채
        ids = np.unique(reg[core])
        ids = [i for i in ids if i > 0 and (reg[core] == i).sum() > 200]
        rim |= np.isin(reg, ids) & e['box'] & ~e['lid'] & ~line
        # 지나가는 머리카락 선(회색, 18~28)은 빼고 보라 기운 있는 테만
        rim &= (rgb[..., 2] > rgb[..., 0] + 12) | (lum > 120)
        claim(f'iris_{s}', (core | rim) & ~(label >= 0))
    wm = e['box'] & classes(13) & ~e['lid']
    lab_w, nw = ndi.label(wm)
    if nw:
        sz = np.bincount(lab_w.ravel())
        sz[0] = 0
        claim(f'white_{s}', np.isin(lab_w, np.nonzero(sz >= 150)[0]))

# 쌍꺼풀 선: 분홍 부분만 (밝은 테두리 번짐은 얼굴 피부로)
claim('crease_r', regions_at((620, 753)) & (rgb[..., 1] < 205))
claim('crease_l', regions_at((877, 772)) & (rgb[..., 1] < 205))
# 입: 분홍 안쪽 + 테두리 (다시 그리므로 위치만 기록)
mouth_poly = ellipse(741, 952, 44, 36)
claim('mouth', mouth_poly & (classes(7, 12) | line | (lum < 190)))

# 눈썹: 머리카락 위에 그린 가는 검은 선
BROW = {
    'r': poly([(484, 694), (530, 690), (640, 694), (690, 700), (690, 716), (600, 712), (530, 710), (484, 712)]),
    'l': poly([(836, 728), (900, 723), (960, 731), (1013, 745), (1013, 763), (955, 753), (900, 745), (836, 748)]),
}
for s, m in BROW.items():
    # 가운데 선을 2차식으로 맞추고 그 둘레(반 굵기 + 여유)만: 지나가는 머리카락 검은 틈은 빼기
    bm = m & (lum <= 14)
    ys, xs = np.nonzero(bm)
    cx = np.unique(xs)
    cy = np.array([np.median(ys[xs == x]) for x in cx])
    pfit = np.polyfit(cx, cy, 2)
    near = np.abs(YY - np.polyval(pfit, XX)) <= 6.5
    claim(f'brow_{s}', bm & near)

# 귀
claim('ear_r', regions_at((425, 950)))
claim('ear_l', regions_at((1068, 958)) | (ellipse(1062, 952, 40, 34) & classes(7, 12, 0)))

# 얼굴 피부(볼 홍조 포함): 머리 쪽 피부색·분홍 영역
head_zone = (YY < 1046) & ~((XX < 300) & (YY > 1030))
face_zone = poly([(440, 600), (1050, 600), (1060, 1000), (900, 1048), (600, 1048), (450, 990)])
claim('face', face_zone & head_zone & classes(0, 7, 12, 13))
# 목 (턱 아래 분홍 그늘)
claim('neck', regions_at((751, 1043)))
# 턱·귀 아래로 보이는 뒷머리 조각 (얼굴 뒤, 재킷 위)
nape = poly([(300, 985), (470, 985), (560, 1012), (690, 1030), (830, 1030), (950, 1008), (1012, 990), (1012, 1040), (300, 1040)])
claim('hair_back', nape & ~line & ~classes(0, 7, 12) & (lum < 140))

# 바보털: 연보라 + 그 아래 검은 그늘
ahoge_poly = poly([(615, 135), (700, 95), (790, 100), (830, 150), (830, 230), (800, 300), (720, 330), (660, 300), (640, 250), (700, 200), (680, 170), (600, 175)])
claim('ahoge', regions_at((700, 140)))
ahoge_shadow = poly([(612, 196), (650, 168), (720, 148), (800, 158), (862, 196), (902, 248), (928, 300), (918, 338), (893, 332), (878, 282), (838, 232), (778, 202), (700, 192), (640, 208)]) & (lum < 34) & (YY < 345)
claim('ahoge', ahoge_shadow)

# ---------- 몸 ----------
body_zone = YY >= 1030
# 팔: 소매·버클·손. 어깨 자르는 선 (겨드랑이 → 어깨 위)
arm_r_poly = poly([(195, 1020), (548, 1020), (548, 1060), (530, 1110), (520, 1205), (195, 1205)])
arm_l_poly = poly([(1320, 1020), (968, 1020), (968, 1060), (990, 1110), (1004, 1205), (1320, 1205)])
claim('arm_r', arm_r_poly & body_zone)
claim('arm_l', arm_l_poly & body_zone)
# 목걸이: 은색 줄(회색·흰색 가는 선) + 다이아 펜던트
# 은줄: 가늘고 밝은 선 (밝기 탑햇) — 반투명 가장자리까지 1px 넓혀서
lum_f = lum.astype(np.float32)
tophat = lum_f - cv2.morphologyEx(lum_f, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
sat = rgb.max(2) - rgb.min(2)
neck_zone = poly([(684, 1058), (842, 1058), (842, 1082), (800, 1150), (720, 1150), (684, 1082)])
neck_chain = neck_zone & (tophat > 28) & (sat < 40) & ~classes(0)
neck_chain = cv2.dilate(neck_chain.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
claim('necklace', neck_chain & neck_zone & (lum > 60) & (sat < 45))
claim('necklace', poly([(762, 1121), (807, 1168), (762, 1215), (717, 1168)]))
# 브로치: 흰 공 + 핀
claim('brooch', ellipse(907, 1127, 26, 26) | poly([(898, 1140), (925, 1140), (928, 1185), (900, 1185)]))
# 바지 체인
chain_poly = poly([(812, 1425), (960, 1425), (962, 1470), (930, 1545), (850, 1545), (812, 1470)])
chain_bright = chain_poly & (lum > 110) & (sat < 45) & (YY > 1428)
chain_out = (cv2.dilate(chain_bright.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0) & (lum < 40) & chain_poly & (YY > 1440)
claim('chain', chain_bright | chain_out)
# 신발
shoe_r = poly([(530, 1680), (770, 1680), (770, 1815), (530, 1815)])
shoe_l = poly([(760, 1680), (1000, 1680), (1000, 1815), (760, 1815)])
# 바지 (다리 사이 선 x≈765)
leg_r = poly([(520, 1400), (765, 1400), (765, 1700), (520, 1700)])
leg_l = poly([(765, 1400), (1000, 1400), (1000, 1700), (765, 1700)])
# 재킷 아래 끝: 재킷 영역 시드 (판·옷깃·주머니·포켓치프·파이핑)
jacket_seeds = [(600, 1300), (920, 1300), (640, 1150), (880, 1150), (560, 1330), (930, 1330), (560, 1320), (900, 1180),
                (620, 1200), (900, 1210), (520, 1390), (1000, 1390), (560, 1310), (950, 1315), (660, 1130), (850, 1130),
                (640, 1230), (870, 1230), (540, 1410), (990, 1400), (600, 1065), (920, 1060), (700, 1250), (820, 1250)]
inner_seeds = [(760, 1250), (760, 1350), (760, 1420), (760, 1090), (730, 1080), (790, 1080), (760, 1300), (760, 1220),
               (740, 1060), (780, 1060), (760, 1270), (760, 1345), (760, 1395)]
jacket_m = regions_at(*jacket_seeds)
inner_m = regions_at(*inner_seeds)
torso_zone = body_zone & (YY < 1450)
claim('inner', inner_m & torso_zone)
claim('jacket', jacket_m & torso_zone)
claim('shoe_r', shoe_r & (YY > 1690) & ~line)
claim('shoe_l', shoe_l & (YY > 1690) & ~line)
claim('leg_r', leg_r & ~line & (YY > 1415))
claim('leg_l', leg_l & ~line & (YY > 1415))

# 남은 몸 채움 영역: 위치로 (가운데 = 안쪽 옷, 나머지 = 재킷)
rest = fg & ~line & (label < 0) & torso_zone
inner_poly = poly([(700, 1050), (820, 1050), (800, 1100), (810, 1200), (800, 1430), (720, 1430), (710, 1200), (720, 1100)])
claim('inner', rest & inner_poly)
claim('jacket', rest & ~inner_poly)

# 머리카락: 머리 쪽 나머지 중 큰 영역 (선 제외 — 선은 아래에서). 부위 사이 얇은 띠(안티에일리어싱)는 가장 가까운 부위로
areas = np.bincount(reg.ravel())
# 두께: 영역 안쪽 거리의 최댓값 (안티에일리어싱 띠는 1~2px 라 얇음)
inner_d = np.zeros((H, W), np.float32)
for k in range(int(cls.max()) + 1):
    m = cls == k
    inner_d[m] = ndi.distance_transform_edt(m)[m]
thick = ndi.maximum(inner_d, reg, np.arange(reg.max() + 1))
bigreg = (areas[reg] >= 400) & (thick[reg] >= 3)
claim('hair', head_zone & ~line & ~(YY > 1040) & bigreg)
sliver = fg & ~line & (label < 0)
if sliver.any():
    _, (iy, ix) = ndi.distance_transform_edt((label < 0) | line, return_indices=True)
    label[sliver] = label[iy[sliver], ix[sliver]]

# ---------- 선 주인 정하기 ----------
R = 9
free = fg & (label < 0)
best = np.full((H, W), -1, np.int16)
disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * R + 1, 2 * R + 1))
# 자기 외곽선을 위에서 직접 가져간 작은 장식은 주변 선을 빼앗지 않게
NO_GRAB = {'earring', 'brooch', 'necklace', 'chain', 'hl_r', 'hl_l', 'crease_r', 'crease_l', 'brow_r', 'brow_l', 'lid_r', 'lid_l'}
for n in ORDER:
    if n in NO_GRAB:
        continue
    m = (label == Z[n]).astype(np.uint8)
    if not m.any():
        continue
    near = cv2.dilate(m, disk) > 0
    best[near & free] = np.maximum(best[near & free], Z[n])
label[free & (best >= 0)] = best[free & (best >= 0)]
# 남은 것: 가장 가까운 부위
left = fg & (label < 0)
if left.any():
    _, (iy, ix) = ndi.distance_transform_edt(label < 0, return_indices=True)
    label[left] = label[iy[left], ix[left]]
# ---------- 가장자리 픽셀 주인 바로잡기 ----------
# 눈 둘레에서 '머리카락'으로 잘못 간 얇은 가장자리: 머리카락 바탕(회색)과 닿지 않은 것만
def near(mask, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(mask.astype(np.uint8), k) > 0
hair_fill = (label == Z['hair']) & (lum >= 36) & (lum <= 70) & (np.abs(rgb[..., 0] - rgb[..., 2]) < 14)
hair_core = cv2.erode(hair_fill.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
for s_, e in EYE.items():
    lidm = label == Z[f'lid_{s_}']
    irm = label == Z[f'iris_{s_}']
    zone = e['lid'] | (near(lidm | irm, 4) & e['box'])
    cand = zone & (label == Z['hair']) & ~near(hair_core, 2)
    purple = cand & (rgb[..., 2] > rgb[..., 0] + 12)
    label[purple & near(irm, 6)] = Z[f'iris_{s_}']
    label[cand & ~purple & (lum < 120) & near(lidm, 3)] = Z[f'lid_{s_}']
# 눈꺼풀 띠 윗선을 따라 붙은 가는 '머리카락' 선(굵은 머리카락 몸통에서 떨어진 것) → 눈꺼풀/얼굴
hair_m = (label == Z['hair']).astype(np.uint8)
hair_thick = cv2.dilate(cv2.morphologyEx(hair_m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)), np.ones((3, 3), np.uint8)) > 0
for s_, e in EYE.items():
    lidm = label == Z[f'lid_{s_}']
    thin = (label == Z['hair']) & ~hair_thick & near(lidm, 3) & (e['lid'] | e['box'])
    label[thin & (lum < 110)] = Z[f'lid_{s_}']
    label[thin & (lum >= 110)] = Z['face']
# ---------- 옷 잘게: 옷깃(좌우)·포켓치프·허벅지 끈 ----------
# 옷깃: 옷깃 면 + 보라 테두리 영역(영역 번호, regions.npz) + 그 둘레 검은 선 (옷깃이 앞판·조끼보다 앞)
LAPEL = {'lapel_r': [47, 114, 118, 242, 260, 230], 'lapel_l': [49, 115, 119, 239, 228, 63]}
for n, ids in LAPEL.items():
    m = np.isin(reg, ids) & (label == Z['jacket'])
    label[m] = Z[n]
    edge = near(m, 7) & (label == Z['jacket']) & (lum < 40)
    label[edge] = Z[n]
# 포켓치프: 보라 삼각 + 테두리
pm = np.isin(reg, [121, 272]) & (label == Z['jacket'])
label[pm] = Z['psq']
label[near(pm, 6) & (label == Z['jacket']) & (lum < 40) & poly([(868, 1160), (925, 1160), (925, 1215), (868, 1215)])] = Z['psq']
# 허벅지 버클 밑으로 늘어진 끈 (버클은 다리에 남김)
strap_poly = poly([(548, 1533), (608, 1533), (608, 1626), (548, 1626)])
label[strap_poly & (label == Z['leg_r'])] = Z['strap']
# 턱선 아래 목덜미 영역의 '머리카락' 선·조각 → 뒷머리 (얼굴 앞 레이어에 있으면 고개를 들 때 같이 떠올라 틈이 생김)
label[nape & (label == Z['hair'])] = Z['hair_back']
# 쌍꺼풀 선·입·눈 둘레의 밝은 가장자리(피부와 섞인 것) → 얼굴
for n in ['crease_r', 'crease_l', 'mouth', 'white_r', 'white_l', 'iris_r', 'iris_l', 'lid_r', 'lid_l']:
    m = near(label == Z[n], 4) & (label == Z['hair']) & (lum > 140) & ~near(hair_core, 2)
    label[m] = Z['face']
print('unlabeled', int((fg & (label < 0)).sum()))
np.savez_compressed(W0 + r'\labels.npz', label=label, order=np.array(ORDER))

# 확인 그림
rng = np.random.default_rng(3)
pal = rng.integers(50, 255, (len(ORDER), 3)).astype(np.uint8)
vis = np.zeros((H, W, 3), np.uint8)
vis[label >= 0] = pal[label[label >= 0]]
dark = (lum < 34)[..., None]
vis = np.where(dark & (label >= 0)[..., None], (vis * 0.45).astype(np.uint8), vis)
img = Image.fromarray(vis)
from PIL import ImageDraw, ImageFont
dr = ImageDraw.Draw(img)
f = ImageFont.truetype('arial.ttf', 16)
for i, n in enumerate(ORDER):
    m = label == i
    if m.any():
        ys, xs = np.nonzero(m)
        dr.text((int(np.median(xs)) - 15, int(np.median(ys)) - 8), n, fill=(255, 255, 255), font=f)
img.save(W0 + r'\labels_vis.png')
img.crop((180, 60, 1330, 1080)).save(W0 + r'\labels_head.png')
img.crop((180, 980, 1330, 1900)).save(W0 + r'\labels_body.png')
for i, n in enumerate(ORDER):
    print(n, int((label == i).sum()))
