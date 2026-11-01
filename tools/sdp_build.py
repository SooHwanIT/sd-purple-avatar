# sd_purple 5단계: 레이어(work/layers) → 앱 모델 avatar/public/model_sd_purple (model.json + layers/*.png)
# 모델 px = 원본 px × S (얼굴 크기가 SD 모델 'model' 과 비슷하게 → 배경 속 아바타 자리·효과가 그대로 맞음).
# 관절·눈 곡선·머리카락 다발·물리 설정을 rig 에 적는다. 런타임: avatar/public/js/chibi_rig.js
import json
import os
import shutil
import numpy as np
from PIL import Image

ROOT = r'C:\Users\happy\Downloads\boy'
W0 = ROOT + r'\source\vtuber\sd_purple\work'
OUT = ROOT + r'\avatar\public\model_sd_purple'
S = 0.7
meta = json.load(open(W0 + r'\layers.json'))
info = meta['info']
order = [str(x) for x in np.load(W0 + r'\labels.npz')['order']]
_o = []
for n in order:
    _o.append(n)
    if n.startswith('white_'):
        _o.append('open_' + n[-1])
    if n == 'jacket':
        _o[-1:] = ['jacket_r', 'jacket_l']
order = _o


def m(v):
    return round(float(v) * S, 2)


def mp(p):
    return [m(p[0]), m(p[1])]


# 레이어별 움직임 공간·종류·격자 크기(모델 px)·깊이
SPEC = {
    'leg_r': dict(space='leg', side='r', cell=20), 'leg_l': dict(space='leg', side='l', cell=20),
    'shoe_r': dict(space='foot', cell=24), 'shoe_l': dict(space='foot', cell=24),
    'chain': dict(space='torso', kind='chain', cell=10, z0=14),
    'neck': dict(space='torso', kind='neck', cell=12),
    'inner': dict(space='torso', kind='inner', cell=18, z0=6),
    'necklace': dict(space='torso', kind='necklace', cell=8, z0=18),
    'jacket_r': dict(space='torso', kind='jacket', side='r', cell=14, z0=12),
    'jacket_l': dict(space='torso', kind='jacket', side='l', cell=14, z0=12),
    'lapel_r': dict(space='torso', kind='lapel', side='r', cell=8, z0=24),
    'lapel_l': dict(space='torso', kind='lapel', side='l', cell=8, z0=24),
    'psq': dict(space='torso', kind='psq', cell=5, z0=18),
    'strap': dict(space='leg', kind='strap', side='r', cell=5),
    'brooch': dict(space='torso', kind='brooch', cell=6, z0=22),
    'hair_back': dict(space='head', kind='hair_back', cell=20),
    'ahoge': dict(space='head', kind='ahoge', cell=10, z0=-0.08),
    'ear_r': dict(space='head', kind='ear', side='r', cell=10), 'ear_l': dict(space='head', kind='ear', side='l', cell=10),
    'face': dict(space='head', kind='face', cell=14),
    'white_r': dict(space='head', kind='white', side='r', cell=4), 'white_l': dict(space='head', kind='white', side='l', cell=4),
    'open_r': dict(space='head', kind='eyemask', side='r', cell=4), 'open_l': dict(space='head', kind='eyemask', side='l', cell=4),
    'iris_r': dict(space='head', kind='iris', side='r', cell=10, z0=0.01), 'iris_l': dict(space='head', kind='iris', side='l', cell=10, z0=0.01),
    'lid_r': dict(space='head', kind='lid', side='r', cell=4, z0=0.02), 'lid_l': dict(space='head', kind='lid', side='l', cell=4, z0=0.02),
    'hl_r': dict(space='head', kind='hl', side='r', cell=6, z0=0.03), 'hl_l': dict(space='head', kind='hl', side='l', cell=6, z0=0.03),
    'crease_r': dict(space='head', kind='crease', side='r', cell=6, z0=0.01), 'crease_l': dict(space='head', kind='crease', side='l', cell=6, z0=0.01),
    'hair': dict(space='head', kind='hair', cell=14),
    'hair_under': dict(space='head', kind='hair', cell=6),
    'brow_r': dict(space='head', kind='brow', side='r', cell=5, z0=0.07), 'brow_l': dict(space='head', kind='brow', side='l', cell=5, z0=0.07),
    'arm_r': dict(space='arm', side='r', cell=9), 'arm_l': dict(space='arm', side='l', cell=9),
    'earring': dict(space='head', kind='earring', cell=5, z0=0.05),
}

if os.path.isdir(OUT + r'\layers'):
    shutil.rmtree(OUT + r'\layers')
os.makedirs(OUT + r'\layers', exist_ok=True)
layers = []
alpha = {}
for n in order:
    if n not in meta['layers']:
        continue
    L = meta['layers'][n]
    shutil.copy(rf'{W0}\layers\{n}.png', rf'{OUT}\layers\{n}.png')
    a = np.array(Image.open(rf'{W0}\layers\{n}.png'))[..., 3]
    alpha[n] = (L, a)
    d = dict(tag=n, file=f'layers/{n}.png', x=m(L['x']), y=m(L['y']), w=m(L['w']), h=m(L['h']))
    d.update(SPEC[n])
    layers.append(d)


def col_extent(n, x_src, which, thr=128):
    # 레이어 알파의 열 x(원본 px)에서 위/아래 끝 y(원본 px)
    L, a = alpha[n]
    xi = int(round(x_src)) - L['x']
    if xi < 0 or xi >= a.shape[1]:
        return None
    ys = np.nonzero(a[:, xi] >= thr)[0]
    if not len(ys):
        return None
    return (ys.min() if which == 'top' else ys.max()) + L['y']


# ---------- 눈 곡선 (모델 px, 2px 간격) ----------
eyes = {}
for s in 'rl':
    e = info['eyes'][s]
    pu, pt, pl = np.array(e['upper']), np.array(e['top']), np.array(e['lower'])
    x0, x1 = e['x0'], e['x1']
    xs = np.arange(x0, x1 + 1)
    # 띠 아래·위 끝: 맞춘 곡선(가운데) + 실제 띠 끝(양 끝) 섞기
    U, T, Lw = [], [], []
    for x in xs:
        u_fit = np.polyval(pu, x)
        t_fit = np.polyval(pt, x)
        ub = col_extent(f'lid_{s}', x, 'bot')
        tb = col_extent(f'lid_{s}', x, 'top')
        # 띠 위·아래 끝은 매끈한 맞춤 곡선 (실제 끝은 머리카락에 가려 울퉁불퉁 → 감을 때 띠가 찢어짐)
        U.append(u_fit)
        T.append(t_fit)
        lb = col_extent(f'white_{s}', x, 'bot')
        Lw.append(lb if lb is not None else u_fit + 2)
    U = np.convolve(np.pad(U, 3, mode='edge'), np.ones(7) / 7, mode='valid')
    T = np.convolve(np.pad(T, 3, mode='edge'), np.ones(7) / 7, mode='valid')
    Lw = np.maximum(np.convolve(np.pad(Lw, 4, mode='edge'), np.ones(9) / 9, mode='valid'), U + 1)
    step = 2 / S
    sx = np.arange(x0, x1 + 0.01, step)
    curve = lambda arr: dict(x0=m(x0), dx=2, v=[m(v) for v in np.interp(sx, xs, arr)])
    ox0, ox1 = e['ox0'], e['ox1']
    cm = (xs > ox0 + (ox1 - ox0) * 0.3) & (xs < ox1 - (ox1 - ox0) * 0.3)
    up_mid = float(np.mean(U[cm]))
    open_h = float(np.mean(Lw[cm] - U[cm]))
    close_y = up_mid + open_h * 0.66
    I = e['iris']
    eyes[s] = dict(x0=m(x0), x1=m(x1), ox0=m(ox0), ox1=m(ox1), up=curve(U), top=curve(T), low=curve(Lw),
                   upMid=m(up_mid), openH=m(open_h), closeY=m(close_y), w=m(ox1 - ox0), lowMax=m(Lw.max()),
                   iris=dict(cx=m(I['cx']), cy=m(I['cy']), w=m(I['w']), h=m(I['h'])), hl=mp([e['hl']['cx'], e['hl']['cy']]))

# 눈썹
brows = {}
for s in 'rl':
    L, a = alpha[f'brow_{s}']
    ys, xs_ = np.nonzero(a > 128)
    brows[s] = dict(cx=m(L['x'] + (xs_.min() + xs_.max()) / 2), hw=m((xs_.max() - xs_.min()) / 2), h=m(9))

mo = info['mouth']
edge = np.array(mo['edge'])
# 원본 입 색 (분홍 채움 + 조금 진한 테두리) — 그림체에 맞춰 분홍 계열로만
mouth = dict(cx=m(mo['cx']), cy=m(mo['cy']), w=m(mo['w']), h=m(mo['h']),
             fill=[232, 162, 176], edge=[196, 112, 130], cavity=[192, 98, 120])

# ---------- 머리카락 다발 (뿌리 → 끝, 원본 px) ----------
B = lambda id_, root, tip, r, param, scale=1.0, layer='hair', phase=0.0, wind=1.2, mx=14: dict(
    id=id_, root=mp(root), tip=mp(tip), radius=m(r), param=param, scale=scale, layer=layer, phase=phase, wind=wind, max=mx)
# 다발마다 따로: 뾰족한 끝 하나하나에 뿌리→끝 축. 같은 쪽 다발도 물리 묶음(지연이 다른 진자 6개)을 번갈아 써서 박자가 엇갈림
bends = [
    # 왼쪽(화면) 옆머리
    B('flick', (440, 330), (125, 295), 45, 'HairA', 1.0, phase=0.3, mx=13),
    B('r_streak', (450, 330), (295, 545), 38, 'HairB', 0.8, phase=0.9, mx=10),
    B('r_spike1', (340, 540), (95, 605), 40, 'HairC', 1.0, phase=1.5, mx=13),
    B('r_spike2', (320, 650), (50, 690), 42, 'HairD', 1.0, phase=2.1, mx=13),
    B('r_spike3', (260, 720), (150, 820), 36, 'HairE', 1.0, phase=2.7, mx=13),
    B('r_hang1', (300, 780), (250, 890), 32, 'HairF', 0.9, phase=3.3, mx=12),
    B('r_hang2', (370, 800), (335, 950), 32, 'HairA', 0.8, phase=3.9, mx=10),
    B('r_cheek', (450, 820), (440, 935), 26, 'HairC', 0.6, phase=4.4, mx=8),
    B('r_low', (430, 520), (230, 620), 36, 'HairE', 0.8, phase=5.0, mx=10),
    # 앞머리 (얼굴 위 — 작게)
    B('bang_r', (520, 600), (470, 800), 34, 'HairB', 0.55, phase=0.6, mx=7),
    B('bang_c', (690, 640), (645, 885), 38, 'HairD', 0.55, phase=1.4, mx=5),  # 눈 사이 앞머리: 많이 움직이면 밑의 흰자 채움이 드러남 → 작게
    B('bang_c2', (760, 650), (750, 850), 26, 'HairF', 0.5, phase=2.2, mx=5),
    B('bang_s', (760, 430), (745, 700), 34, 'HairA', 0.45, phase=2.9, mx=7),
    B('bang_l', (900, 620), (960, 830), 32, 'HairC', 0.55, phase=3.6, mx=7),
    # 오른쪽(화면) 옆머리
    B('l_big', (1080, 470), (1295, 690), 48, 'HairD', 1.0, phase=0.4, mx=13),
    B('l_spike', (1130, 700), (1235, 845), 38, 'HairE', 1.0, phase=1.2, mx=13),
    B('l_streak', (1060, 600), (1110, 730), 28, 'HairF', 0.8, phase=1.9, mx=10),
    B('l_hang1', (1120, 820), (1185, 945), 36, 'HairB', 0.9, phase=2.6, mx=12),
    B('l_hang2', (1075, 810), (1100, 955), 32, 'HairA', 0.8, phase=3.4, mx=10),
    B('ahoge', (912, 325), (625, 190), 400, 'Ahoge', 1.0, layer='ahoge', phase=0.0, wind=2.4, mx=26),
    # 목덜미 뒷머리 (뒷머리 레이어): 턱 밑 양옆에 늘어진 머리가 몸 움직임에 살짝 (2026-11-01)
    B('nape_r', (560, 870), (545, 1060), 75, 'HairB', 0.5, layer='hair_back', phase=1.0, wind=0.9, mx=8),
    B('nape_l', (955, 870), (975, 1060), 75, 'HairE', 0.5, layer='hair_back', phase=2.3, wind=0.9, mx=8),
]

# ---------- 물리 (Cubism physics3.json 형식) ----------
def vtx(n, radius, mob=0.95, delay=0.8, acc=1.5, falloff=0.88):
    v = [dict(Position=dict(X=0, Y=0), Mobility=1, Delay=1, Acceleration=1, Radius=0)]
    for i in range(1, n):
        v.append(dict(Position=dict(X=0, Y=radius * i), Mobility=mob, Delay=round(delay * falloff ** (i - 1), 3), Acceleration=acc, Radius=radius))
    return v


def inp(id_, w, typ):
    return dict(Source=dict(Target='Parameter', Id=id_), Weight=w, Type=typ, Reflect=False)


def outp(id_, vi, scale):
    return dict(Destination=dict(Target='Parameter', Id=id_), VertexIndex=vi, Scale=scale, Weight=100, Type='Angle', Reflect=False)


HEAD_IN = [inp('AngleX', 60, 'X'), inp('AngleZ', 60, 'Angle'), inp('BodyX', 40, 'X'), inp('BodyZ', 40, 'Angle')]
BODY_IN = [inp('BodyX', 70, 'X'), inp('BodyZ', 70, 'Angle'), inp('AngleX', 15, 'X')]
settings = []


def phys(name, inputs, outs, verts):
    settings.append(dict(Id=f'PhysicsSetting{len(settings) + 1}', Input=inputs, Output=outs, Vertices=verts,
                         Normalization=dict(Position=dict(Minimum=-10, Default=0, Maximum=10), Angle=dict(Minimum=-10, Default=0, Maximum=10)),
                         _name=name))


D2R = 57.3
phys('HairA', HEAD_IN, [outp('HairA', 1, 0.41 * D2R), outp('HairA_2', 2, 0.56 * D2R)], vtx(3, 10, 0.95, 0.74))
phys('HairB', HEAD_IN, [outp('HairB', 1, 0.39 * D2R), outp('HairB_2', 2, 0.53 * D2R)], vtx(3, 10, 0.95, 0.66))
phys('HairC', HEAD_IN, [outp('HairC', 1, 0.44 * D2R), outp('HairC_2', 2, 0.59 * D2R)], vtx(3, 10, 0.95, 0.7))
phys('HairD', HEAD_IN, [outp('HairD', 1, 0.41 * D2R), outp('HairD_2', 2, 0.56 * D2R)], vtx(3, 10, 0.95, 0.6))
phys('HairE', HEAD_IN, [outp('HairE', 1, 0.46 * D2R), outp('HairE_2', 2, 0.62 * D2R)], vtx(3, 10, 0.95, 0.78))
phys('HairF', HEAD_IN, [outp('HairF', 1, 0.39 * D2R), outp('HairF_2', 2, 0.53 * D2R)], vtx(3, 10, 0.95, 0.56))
phys('Ahoge', [inp('AngleX', 70, 'X'), inp('AngleZ', 70, 'Angle'), inp('AngleY', 30, 'X'), inp('BodyX', 30, 'X')],
     [outp('Ahoge', 1, 0.75 * D2R), outp('Ahoge_2', 2, 1.25 * D2R)], vtx(3, 10, 0.9, 0.8, 1.6))
phys('Earring', [inp('AngleX', 60, 'X'), inp('AngleZ', 90, 'Angle'), inp('BodyX', 30, 'X'), inp('BodyZ', 30, 'Angle')],
     [outp('Earring', 1, 0.9 * D2R), outp('Earring_2', 2, 1.0 * D2R)], vtx(3, 8, 0.96, 0.9, 1.5))
phys('Chain', BODY_IN, [outp('Chain', 1, 0.6 * D2R), outp('Chain_2', 2, 0.7 * D2R)], vtx(3, 10, 0.95, 0.8, 1.4))
phys('Necklace', [inp('BodyX', 50, 'X'), inp('BodyZ', 60, 'Angle'), inp('AngleZ', 15, 'Angle')],
     [outp('Necklace', 1, 0.35 * D2R), outp('Necklace_2', 2, 0.4 * D2R)], vtx(3, 10, 0.95, 0.8, 1.4))
phys('Brooch', BODY_IN, [outp('Brooch', 1, 0.5 * D2R), outp('Brooch_2', 2, 0.6 * D2R)], vtx(3, 8, 0.95, 0.85, 1.4))
phys('HemR', BODY_IN, [outp('HemR', 1, 0.12 * D2R)], vtx(2, 12, 0.85, 0.8, 1.2))
phys('HemL', BODY_IN, [outp('HemL', 1, 0.12 * D2R)], vtx(2, 12, 0.85, 0.72, 1.2))
phys('Psq', BODY_IN, [outp('Psq', 1, 0.3 * D2R)], vtx(2, 8, 0.9, 0.85, 1.3))
phys('Strap', [inp('BodyX', 80, 'X'), inp('BodyZ', 40, 'Angle'), inp('BodyY', 60, 'X')],
     [outp('Strap', 1, 0.5 * D2R), outp('Strap_2', 2, 0.5 * D2R)], vtx(3, 10, 0.93, 0.8, 1.4))
# 볼살 출렁임(통통한 느낌): 고개를 돌리거나 멈출 때 볼·턱이 아주 살짝 늦게 따라옴 (가로 Cheek, 세로 CheekY — 점프·끄덕임)
phys('Cheek', [inp('AngleX', 60, 'X'), inp('AngleZ', 40, 'Angle'), inp('BodyX', 25, 'X')], [outp('Cheek', 1, 0.34 * D2R)], vtx(2, 6, 0.9, 0.86, 1.7))
phys('CheekY', [inp('AngleY', 50, 'X'), inp('BodyY', 50, 'X')], [outp('CheekY', 1, 0.3 * D2R)], vtx(2, 6, 0.9, 0.86, 1.7))
# 팔: 어깨(뿌리) → 팔꿈치 → 손 2마디 진자. 몸 흔들림·기울기·돌리기와 고개 움직임(상체가 따라 흔들림)에 늦게 따라옴
ARM_IN = [inp('BodyX', 70, 'X'), inp('BodyZ', 70, 'Angle'), inp('BodyYaw', 40, 'X'), inp('AngleX', 15, 'X'), inp('AngleZ', 20, 'Angle')]
phys('ArmSwingR', ARM_IN, [outp('ArmSwingR', 1, 0.22 * D2R), outp('ArmSwingR_2', 2, 0.18 * D2R)], vtx(3, 12, 0.88, 0.75, 1.2))
phys('ArmSwingL', ARM_IN, [outp('ArmSwingL', 1, 0.22 * D2R), outp('ArmSwingL_2', 2, 0.18 * D2R)], vtx(3, 12, 0.88, 0.72, 1.2))
for st in settings:
    st.pop('_name')
physics = dict(Version=3, Meta=dict(PhysicsSettingCount=len(settings), Fps=60, EffectiveForces=dict(Gravity=dict(X=0, Y=-1), Wind=dict(X=0, Y=0))),
               PhysicsSettings=settings)

# ---------- 표정 ----------
expressions = {
    # 2026-11-02: 사용자가 준 표정 시트(기본·미소·활짝 웃음·슬픔·화남·놀람·울먹임·부끄러움·의심·생각중 + 20종 시트)대로.
    # 이름은 앱 공용 이름(smile/sad/… 는 acting.js·effects.js·face_performance.js 가 같은 이름을 씀), 라벨은 시트 말 그대로.
    'smile': dict(label='미소', key='2', params={'eyeOpenL': 0.0, 'eyeOpenR': 0.0, 'eyeSmile': 0.0, 'mouthForm': 0.75, 'blush': 0.25}),  # 감은 ‿ 눈 + 작은 웃음선
    'sad': dict(label='슬픔', key='3', params={'tear': 0.55, 'mouthWavy': 1, 'mouthForm': -0.6, 'eyeOpenL': 0.85, 'eyeOpenR': 0.85, 'browL': 0.25, 'browR': 0.25, 'browTiltL': 0.6, 'browTiltR': 0.6}),
    'surprised': dict(label='놀람', key='4', params={'eyeWiden': 1, 'pupil': -0.7, 'mouthOpen': 0.3, 'mouthNarrow': 0.9, 'brow': 0.5}),  # 동그래진 눈 + 작은 'o' + "!"
    'angry': dict(label='화남', key='5', params={'anger': 1, 'lidTilt': 0.5, 'eyeOpenL': 0.8, 'eyeOpenR': 0.8, 'mouthPress': 1, 'mouthForm': -0.5}),
    'shy': dict(label='부끄러움', key='6', params={'blush': 1, 'eyeOpenL': 0.7, 'eyeOpenR': 0.7, 'eyeBallX': 0.45, 'eyeBallY': -0.3, 'mouthPress': 1, 'mouthForm': 0.2}),
    'wink': dict(label='윙크', key='7', params={'mouthForm': 0.5}),
    'sleepy': dict(label='졸림', key='8', params={'mouthPress': 1}),
    'laugh': dict(label='활짝 웃음', key='9', params={'eyeSmile': 1, 'blush': 0.4, 'mouthForm': 1}, add={'mouthOpen': 0.6, 'mouthWide': 0.3}),
    'heart': dict(label='하트 눈', key='0', params={'heartEyes': 1, 'blush': 0.7, 'mouthForm': 0.7}),
    'excited': dict(label='신남', params={'eyeSmileR': 1, 'eyeOpenL': 1.1, 'mouthForm': 1, 'blush': 0.3, 'brow': 0.3}, add={'mouthOpen': 0.55, 'mouthWide': 0.3}),  # 한쪽 ^ + 활짝 입 + 반짝
    'asleep': dict(label='자장', params={'eyeOpenL': 0.0, 'eyeOpenR': 0.0, 'mouthPress': 1, 'mouthForm': 0.1}),
    'blank': dict(label='멍함', params={'blankEyes': 1, 'eyeOpenL': 0.9, 'eyeOpenR': 0.9, 'brow': 0.1}),  # 흰 눈 + 'o' 입 + "…"
    'shock': dict(label='당황', params={'eyeWiden': 0.6, 'pupil': -0.6, 'sweat': 1, 'gloom': 0.5, 'mouthWavy': 1, 'brow': 0.3}),
    'pout': dict(label='삐짐', params={'mouthPress': 1, 'mouthForm': -0.7, 'blush': 0.4, 'brow': -0.35, 'eyeBallX': 0.6, 'eyeBallY': 0.15, 'eyeSquintL': 0.25, 'eyeSquintR': 0.25}),
    'teary': dict(label='울먹임', params={'tear': 0.75, 'mouthWavy': 1, 'mouthForm': -0.4, 'eyeOpenL': 0.95, 'eyeOpenR': 0.95, 'browL': 0.35, 'browR': 0.35, 'browTiltL': 0.7, 'browTiltR': 0.7, 'blush': 0.2}),
    'cry': dict(label='대성통곡', params={'eyeCross': 1, 'tear': 1, 'mouthOpen': 0.8, 'mouthWide': 0.3, 'mouthForm': -0.8, 'blush': 0.3, 'browL': 0.3, 'browR': 0.3, 'browTiltL': 0.6, 'browTiltR': 0.6}),
    'tired': dict(label='지침', params={'eyeOpenL': 0.5, 'eyeOpenR': 0.5, 'brow': -0.15, 'mouthPress': 1, 'mouthForm': -0.3, 'gloom': 0.3}),
    'bashful': dict(label='수줍음', params={'blush': 0.6, 'eyeBallX': 0.4, 'eyeBallY': -0.35, 'eyeOpenL': 0.9, 'eyeOpenR': 0.9, 'mouthForm': 0.3, 'mouthPress': 1}),
    'doubt': dict(label='의심', params={'question': 1, 'eyeOpenL': 0.6, 'eyeOpenR': 0.6, 'lidTilt': 0.3, 'browL': -0.35, 'browR': 0.4, 'browTiltL': -0.4, 'mouthPress': 1, 'mouthForm': -0.2, 'eyeBallX': 0.3}),
    'think': dict(label='생각중', params={'eyeBallX': 0.45, 'eyeBallY': 0.75, 'brow': 0.2, 'mouthPress': 1, 'handRW': 1, 'handRX': -0.5, 'handRY': 1.12, 'hpR_fist': 1}),  # 턱 옆에 주먹 + "…"
    # 손 파츠 시트 (2026-11-02): 손 모양은 코드로 그린 스프라이트(chibi_rig HAND_POSES), 팔은 IK 로 목표 자리까지
    'openhands': dict(label='편손', params={'hpR_relax': 1, 'hpL_relax': 1, 'handRW': 1, 'handRX': -1.0, 'handRY': 1.7, 'handLW': 1, 'handLX': 1.0, 'handLY': 1.7}),
    'fists': dict(label='주먹', params={'hpR_fist': 1, 'hpL_fist': 1, 'handRW': 1, 'handRX': -0.45, 'handRY': 1.2, 'handLW': 1, 'handLX': 0.45, 'handLY': 1.2, 'brow': -0.1, 'mouthPress': 1}),
    'point': dict(label='가리키기', params={'hpR_point': 1, 'handRW': 1, 'handRX': -1.35, 'handRY': 0.05, 'eyeBallX': -0.3, 'mouthOpen': 0.25}),
    'vsign': dict(label='브이', params={'hpR_v': 1, 'handRW': 1, 'handRX': -1.1, 'handRY': 0.7, 'eyeOpenR': 0.0, 'mouthForm': 0.6, 'blush': 0.2}),
    'fingerheart': dict(label='손하트', params={'hpR_heart': 1, 'hpL_heart': 1, 'handRW': 1, 'handRX': -0.4, 'handRY': 1.1, 'handLW': 1, 'handLX': 0.4, 'handLY': 1.1, 'blush': 0.5, 'mouthForm': 0.5, 'eyeOpenL': 0.85, 'eyeOpenR': 0.85}),
    'grab': dict(label='파지', params={'hpR_grab': 1, 'hpL_grab': 1, 'handRW': 1, 'handRX': -0.65, 'handRY': 1.05, 'handLW': 1, 'handLX': 0.65, 'handLY': 1.05, 'lidTilt': 0.3, 'mouthPress': 1}),
    'surprisehands': dict(label='놀람손', params={'hpR_spread': 1, 'hpL_spread': 1, 'handRW': 1, 'handRX': -1.2, 'handRY': 0.45, 'handLW': 1, 'handLX': 1.2, 'handLY': 0.45, 'eyeWiden': 0.8, 'pupil': -0.5, 'mouthOpen': 0.3, 'mouthNarrow': 0.9, 'brow': 0.45}),
    'handsup': dict(label='양손 들기', params={'hpR_palm': 1, 'hpL_palm': 1, 'handRW': 1, 'handRX': -0.95, 'handRY': -0.7, 'handLW': 1, 'handLX': 0.95, 'handLY': -0.7, 'eyeSmile': 1, 'mouthForm': 1, 'blush': 0.3}, add={'mouthOpen': 0.55, 'mouthWide': 0.3}),
    'bleh': dict(label='메롱', params={'tongue': 1, 'mouthOpen': 0.3, 'mouthWide': 0.35, 'mouthForm': 0.5, 'eyeOpenL': 0.0, 'eyeOpenR': 0.9, 'blush': 0.3, 'browL': 0.25}),
}

FE = info['face']['ellipse']
fg_x0, fg_x1, fg_y0, fg_y1 = 300, 1220, 90, 1825
rig = dict(
    faceProfile=dict(version=1, parametricExpressions=True),
    head=dict(cx=m(748), cy=m(722), rx=m(330), ry=m(340)),
    skull=dict(c=mp((748, 730)), rz=m(300)),
    face=dict(cx=m(FE['cx']), cy=m(830), rx=m(300), ry=m(300)),
    neckPivot=mp((750, 1035)),
    neck=dict(halfW=m(46)),
    body=dict(hip=mp((760, 1440)), neck=mp((760, 1045)), halfW=m(255), hemTop=m(1330), hemBot=m(1450)),
    arms=dict(r=dict(pivot=mp((572, 1108)), hand=mp((262, 1110)), elbow=m(150), wrist=m(255), root=m(60), z=m(30)),
              l=dict(pivot=mp((948, 1108)), hand=mp((1242, 1110)), elbow=m(150), wrist=m(255), root=m(60), z=m(30))),
    legs=dict(r=dict(hip=mp((650, 1440)), foot=mp((650, 1700))), l=dict(hip=mp((870, 1440)), foot=mp((870, 1700)))),
    eyes=eyes, brows=brows, mouth=mouth,
    blush=dict(cy=m(945), spots=[[m(592), m(938), m(52), m(20)], [m(905), m(950), m(52), m(20)]]),
    hair=dict(dome=dict(cx=m(750), cy=m(640), rx=m(560), ry=m(470), top=1.0, bang=0.12), bends=bends),
    attach=dict(earring=dict(pivot=mp((1013, 952)), mid=mp((1013, 997))), ahoge=dict(root=mp((912, 325))),
                chain=dict(pivot=mp((884, 1428)), len=m(110)),
                necklace=dict(pivot=mp((760, 1062)), len=m(140)),
                brooch=dict(pivot=mp((907, 1112)), len=m(70)),
                psq=dict(pivot=mp((895, 1170)), len=m(40)),
                strap=dict(pivot=mp((578, 1534)), len=m(88))),
    physics=physics,
    expressions=expressions,
    clothes=dict(body=dict(top=m(1045), hem=m(1440))),
)
# ---------- 사용자가 그린 새 머리 (tools/sdp_newhair.py → work/newhair) ----------
# 원본 머리카락(hair)·바보털·뒷머리 대신: 뒷머리 1장 + 바보털 + 다발 8개(얼굴 뒤 조각 + 앞 조각)
NH = W0 + r'\newhair.json'
if os.path.exists(NH):
    nh = json.load(open(NH))
    def nh_layer(name, box, **kw):
        shutil.copy(rf'{W0}\newhair\{name}.png', rf'{OUT}\layers\{name}.png')
        d = dict(tag=name, file=f'layers/{name}.png', x=m(box['x']), y=m(box['y']), w=m(box['w']), h=m(box['h']))
        d.update(kw)
        return d
    # 원래 뒷머리 레이어(원본 목덜미 머리 + 채움)는 밑받침으로 남김: 새 뒷머리가 짧은 턱 밑 양옆 틈을 메움
    old_back = next(d for d in layers if d['tag'] == 'hair_back')
    shutil.copy(rf'{OUT}\layers\hair_back.png', rf'{OUT}\layers\hair_back0.png')
    under0 = dict(old_back, tag='hair_back0', file='layers/hair_back0.png')
    back_group = [under0, nh_layer('hair_back', nh['hair_back'], space='head', kind='hair_back', cell=18)]
    # 바보털은 맨 앞 (새 다발들이 정수리를 덮어 뒤에 두면 안 보임)
    ahoge_layer = nh_layer('ahoge', nh['ahoge']['box'], space='head', kind='ahoge', cell=10)
    front_group = []
    new_bends = []
    for p in nh['pieces']:
        tags = []
        if p['back']:
            back_group.append(nh_layer(p['name'] + '_b', p['back'], space='head', kind='hair', cell=14, z0=p['z0']))
            tags.append(p['name'] + '_b')
        front_group.append(nh_layer(p['name'] + '_f', p['front'], space='head', kind='hair', cell=12, z0=p['z0']))
        tags.append(p['name'] + '_f')
        new_bends.append(dict(id=p['name'], root=mp(p['root']), tip=mp(p['tip']), radius=m(p['radius']), param=p['param'],
                              scale=1.0, layers=tags, phase=p['phase'], wind=1.0, max=p['max']))
    ah = nh['ahoge']
    new_bends.append(dict(id='ahoge', root=mp(ah['root']), tip=mp(ah['tip']), radius=m(400), param='Ahoge', scale=1.0,
                          layers=['ahoge'], phase=0.0, wind=2.0, max=18))
    i_back = next(i for i, d in enumerate(layers) if d['tag'] == 'hair_back')
    layers = [d for d in layers if d['tag'] not in ('hair_back', 'ahoge')]
    layers[i_back:i_back] = back_group
    i_hair = next(i for i, d in enumerate(layers) if d['tag'] == 'hair')
    layers = [d for d in layers if d['tag'] != 'hair']
    layers[i_hair:i_hair] = front_group + [ahoge_layer]
    # 눈꺼풀 띠·하이라이트는 새 앞머리 위로 (눈썹처럼): 새 다발이 속눈썹 띠를 덮지 않게, 깜빡일 때도 띠가 머리카락 위로 내려감
    LIDS = ('lid_r', 'lid_l', 'hl_r', 'hl_l')  # 쌍꺼풀 선은 이마 쪽이라 새 앞머리 밑에 둠
    lids = [d for d in layers if d['tag'] in LIDS]
    layers = [d for d in layers if d['tag'] not in LIDS]
    i_brow = next(i for i, d in enumerate(layers) if d['tag'] == 'brow_r')
    layers[i_brow:i_brow] = lids
    rig['hair']['bends'] = new_bends
    rig['attach']['ahoge'] = dict(root=mp(ah['root']))

# ---------- 사용자가 그린 내린 팔 (parts_in2/sd_purple_09_arms.png) ----------
# 원본 T자세 팔 대신 씀. 시트의 팔은 원본 꼬마 비율보다 길게 그려져 있어, 소매 버클 기준(0.48)이 아니라
# 손이 엉덩이 높이에 오는 0.40 배로 줄임. 재킷 몸통 뒤에 두어 어깨는 재킷에 가려지고 팔이 옆으로 나옴
ARM_SHEET = ROOT + r'\source\vtuber\sd_purple\parts_in2\sd_purple_09_arms.png'
# 그려 준 팔은 꼬마 몸 비율과 안 맞아(가늘고 긺) 기본은 원래 팔. SDP_DRAWN_ARMS=1 로 켬
if os.path.exists(ARM_SHEET) and os.environ.get('SDP_DRAWN_ARMS'):
    AS = 0.40
    sheet = Image.open(ARM_SHEET).convert('RGBA')
    # 시트 좌표: 자른 상자, 어깨 꼭대기(top)·팔꿈치·소매 끝·손 끝 (시트 px, 자른 상자 기준)
    ARMS = {
        'r': dict(box=(115, 551, 653, 1718), shoulder=(548, 1050), anchor=0.62, top=(432, 72), elbow=(283, 530), cuff=(209, 819), hand=(150, 1140)),
        'l': dict(box=(978, 551, 1516, 1718), shoulder=(968, 1050), anchor=0.38, top=(107, 72), elbow=(255, 530), cuff=(330, 819), hand=(388, 1140)),
    }
    new_layers = []
    arms_rig = {'drawnDown': True}
    for sd, A in ARMS.items():
        x0, y0, x1, y1 = A['box']
        im = sheet.crop(A['box'])
        w, h = int(round(im.width * AS)), int(round(im.height * AS))
        im = im.resize((w, h), Image.LANCZOS)
        ox = A['shoulder'][0] - int(w * A['anchor'])
        oy = A['shoulder'][1] - int(h * 0.02)
        name = f'arm_{sd}'
        im.save(rf'{OUT}\layers\{name}.png')
        P = lambda q: (ox + q[0] * AS, oy + q[1] * AS)
        top, elb, cuff, hand = P(A['top']), P(A['elbow']), P(A['cuff']), P(A['hand'])
        pivot = (top[0] + (elb[0] - top[0]) * 0.18, top[1] + (elb[1] - top[1]) * 0.18)
        dist = lambda a, b: float(np.hypot(a[0] - b[0], a[1] - b[1]))
        arms_rig[sd] = dict(pivot=mp(pivot), hand=mp(hand), elbow=m(dist(pivot, elb)), wrist=m(dist(pivot, cuff) + 6), root=m(70), z=m(10))
        new_layers.append(dict(tag=name, file=f'layers/{name}.png', x=m(ox), y=m(oy), w=m(w), h=m(h), space='arm', side=sd, cell=9))
    layers = [d for d in layers if d['tag'] not in ('arm_r', 'arm_l')]
    at = next(i for i, d in enumerate(layers) if d['tag'] == 'neck')
    layers[at:at] = new_layers
    rig['arms'] = arms_rig

# 사용자가 준 스프라이트 (tools/sdp_sprites.py 가 sprites/sprites.json 에 씀): 입 모양·감은 눈·눈썹·효과
sp_path = OUT + r'\sprites\sprites.json'
if os.path.exists(sp_path):
    rig['sprites'] = json.load(open(sp_path))
# 사용자 손 파츠 시트에서 자른 손 (tools/sdp_hands.py → sprites/hands.json): 있으면 코드로 그린 손 대신 씀
hands_path = OUT + r'\sprites\hands.json'
if os.path.exists(hands_path):
    rig.setdefault('sprites', {}).update(json.load(open(hands_path)))
model = dict(type='chibi', canvas=dict(w=m(meta['size'][0]), h=m(meta['size'][1])),
             bounds=dict(x0=m(fg_x0), y0=m(fg_y0), x1=m(fg_x1), y1=m(fg_y1)), scale=S, layers=layers, rig=rig)
json.dump(model, open(OUT + r'\model.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
if not os.path.exists(OUT + r'\rig.json'):
    json.dump({'tuning': {}}, open(OUT + r'\rig.json', 'w'), indent=1)
print('layers', len(layers), 'model.json', os.path.getsize(OUT + r'\model.json'))
