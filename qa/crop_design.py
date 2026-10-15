"""주신 디자인 그림(spec/design/hero_page_20261002.png · 838×1877)에서 사진 · 아이콘 · 로고를 **그대로 잘라** 냅니다.

  python3 crop_design.py       → sgb/site/public/home/d/*.png  +  crop_sheet.png(확인용)  +  crop_manifest.json

사장님 결정(2026-10-02): 「사용된 png 변경하지 않고 이미지 적용」 — 새로 그리지 않고 그림 속 이미지를 씁니다.
여기서 하는 일은 **자르기뿐**입니다. 색 · 크기 · 내용을 바꾸지 않습니다(화면에서는 CSS 로 크기만 맞춥니다).
원본이 가로 838px 이라 큰 화면에서는 사진이 조금 부드럽게 보입니다 — 원본 파일을 받으면 같은 이름으로 바꿔 넣으면 됩니다.

  box   (x0, y0, x1, y1)        정한 자리 그대로
  trim  (x0, y0, x1, y1)        그 안에서 바탕색과 다른 부분만(아이콘) — 가장자리 2px 여유
"""
import json, os, sys
from PIL import Image

# 킷 안(qa/)에서 돌리면 옆의 sgb/ 를 씁니다. 다른 곳이면 KIT=<sgb 경로>
_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
SRC = os.path.join(K, 'spec/design/hero_page_20261002.png')
OUT = os.path.join(K, 'site/public/home/d')
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
im = Image.open(SRC).convert('RGB')
W, H = im.size
assert (W, H) == (838, 1877), (W, H)

BOX = {
    'logo': (30, 4, 164, 41),
    'promo-art': (699, 136, 806, 296),
    'banner': (37, 435, 488, 641),
    'pick-1': (41, 880, 187, 969), 'pick-2': (201, 880, 341, 969), 'pick-3': (355, 880, 494, 969),
    'pick-4': (506, 880, 653, 969), 'pick-5': (666, 880, 804, 969),
    'vs-a': (60, 1182, 142, 1232), 'vs-b': (198, 1180, 276, 1232),
    'poll-bags': (458, 1184, 540, 1266), 'poll-purifier': (580, 1186, 642, 1270),
    'strip-left': (37, 1314, 292, 1386), 'strip-right': (706, 1314, 810, 1386),
    'town-1': (150, 1430, 294, 1494), 'town-2': (432, 1430, 552, 1494), 'town-3': (668, 1430, 810, 1494),
    'start-1': (42, 1671, 216, 1715), 'start-2': (239, 1671, 411, 1715), 'start-3': (434, 1671, 605, 1715), 'start-4': (630, 1671, 802, 1715),
}
TRIM = {
    'rank-1': (606, 436, 676, 494), 'rank-2': (626, 508, 682, 568), 'rank-3': (622, 584, 672, 638), 'rank-user': (512, 606, 536, 630),
    'sec-today': (30, 398, 64, 432), 'sec-need': (30, 662, 66, 698), 'sec-pick': (30, 838, 66, 874), 'sec-poll': (30, 1080, 66, 1116),
    'sec-town': (30, 1396, 66, 1432), 'town-pin': (174, 1398, 202, 1430), 'sec-trust': (30, 1526, 68, 1562),
    'sec-startup': (30, 1636, 66, 1672), 'sec-forme': (32, 1754, 64, 1790), 'sec-core': (32, 1800, 60, 1830),
    'need-1': (48, 706, 96, 754), 'need-2': (208, 706, 258, 754), 'need-3': (366, 706, 418, 754), 'need-4': (524, 706, 574, 754), 'need-5': (668, 706, 716, 754),
    'trust-1': (46, 1562, 98, 1610), 'trust-2': (248, 1562, 302, 1610), 'trust-3': (444, 1562, 496, 1610), 'trust-4': (634, 1562, 690, 1610),
    'core-1': (62, 1821, 86, 1844), 'core-2': (252, 1806, 288, 1842), 'core-3': (446, 1806, 484, 1842), 'core-4': (640, 1806, 678, 1842),
    'leaf-1': (576, 1316, 603, 1346), 'leaf-2': (556, 1356, 590, 1388),
    'flame': (56, 455, 76, 478), 'star': (46, 1032, 60, 1048), 'spark-s': (42, 71, 60, 90), 'spark': (56, 283, 84, 314),
    'sns-1': (564, 1853, 588, 1876), 'sns-2': (591, 1853, 615, 1876), 'sns-3': (617, 1853, 641, 1876), 'sns-4': (644, 1853, 668, 1876),
}
TOL = {'rank-1': 12, 'rank-2': 8, 'rank-3': 8, 'trust-1': 4, 'trust-2': 4, 'trust-3': 4, 'trust-4': 4}

def trim(box, tol=12, pad=2):
    x0, y0, x1, y1 = box
    c = im.crop(box); px = c.load(); w, h = c.size
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    bg = tuple(sorted(v[i] for v in border)[len(border) // 2] for i in range(3))
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if max(abs(p[0] - bg[0]), abs(p[1] - bg[1]), abs(p[2] - bg[2])) > tol:
                xs.append(x); ys.append(y)
    if not xs: return box, bg
    return (max(x0, x0 + min(xs) - pad), max(y0, y0 + min(ys) - pad), min(x1, x0 + max(xs) + 1 + pad), min(y1, y0 + max(ys) + 1 + pad)), bg

man = {}
for name, box in BOX.items():
    im.crop(box).save(os.path.join(OUT, name + '.png'), optimize=True); man[name] = {'box': box, 'w': box[2] - box[0], 'h': box[3] - box[1]}
for name, win in TRIM.items():
    box, bg = trim(win, TOL.get(name, 12))
    im.crop(box).save(os.path.join(OUT, name + '.png'), optimize=True)
    man[name] = {'box': box, 'w': box[2] - box[0], 'h': box[3] - box[1], 'bg': '#%02X%02X%02X' % bg}

# 바탕 · 꼬리표 색 — 그림에서 그대로 읽어 CSS 에 씁니다
def at(x, y): return '#%02X%02X%02X' % im.getpixel((x, y))
COL = {
    'hero-top': at(300, 50), 'hero-mid': at(300, 200), 'hero-bottom': at(20, 380),
    'today': at(20, 500), 'needs': at(20, 760), 'picks': at(20, 920), 'poll': at(20, 1200), 'strip-band': at(20, 1350), 'strip-mid': at(400, 1322), 'strip-mid2': at(520, 1380),
    'town': at(20, 1470), 'trust': at(20, 1590), 'startup': at(20, 1700), 'forme-bar': at(300, 1762), 'core': at(300, 1830), 'footer': at(300, 1860),
    'bdg-pick-1': at(50, 892), 'bdg-pick-2': at(210, 892), 'bdg-pick-3': at(364, 892), 'bdg-pick-4': at(516, 890), 'bdg-pick-5': at(676, 892),
    'bdg-start-1': at(52, 1682), 'bdg-start-2': at(247, 1682), 'bdg-start-3': at(443, 1682), 'bdg-start-4': at(640, 1682),
    'bdg-live': at(520, 446), 'bdg-new': at(521, 521), 'bdg-town': at(520, 594), 'bdg-cmp': at(60, 1134), 'bdg-ask': at(330, 1134), 'bdg-opn': at(570, 1134),
    'btn-violet': at(100, 1285), 'btn-dark': at(80, 602), 'btn-brown': at(620, 1353), 'btn-join': at(740, 19), 'vs-tile': at(64, 1240), 'h1-violet': at(60, 160),
    'tag-strip': at(310, 1329), 'ask-row': at(345, 1198),
}
json.dump({'crops': man, 'colors': COL}, open(os.path.join(HERE, 'crop_manifest.json'), 'w'), ensure_ascii=False, indent=1)

# 확인용 한 장
names = list(man)
cell = 190; cols = 8
sheet = Image.new('RGB', (cols * cell, ((len(names) + cols - 1) // cols) * cell), '#DDDDDD')
for i, n in enumerate(names):
    c = Image.open(os.path.join(OUT, n + '.png'))
    z = min((cell - 10) / c.width, (cell - 26) / c.height, 4)
    c = c.resize((max(1, int(c.width * z)), max(1, int(c.height * z))), Image.NEAREST)
    sheet.paste(c, ((i % cols) * cell + 5, (i // cols) * cell + 5))
from PIL import ImageDraw
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names): d.text(((i % cols) * cell + 6, (i // cols) * cell + cell - 16), f"{n} {man[n]['w']}x{man[n]['h']}", fill=(0, 0, 0))
sheet.save(os.path.join(HERE, 'crop_sheet.png'))
tot = sum(os.path.getsize(os.path.join(OUT, n + '.png')) for n in names)
print(len(names), 'crops', tot, 'bytes'); print(json.dumps(COL, ensure_ascii=False))
