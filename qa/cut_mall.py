"""소개몰 제시 그림(대화로 받은 1092×2000 JPEG)에서 그림 조각을 **다시 압축하지 않고** 잘라 냅니다. 결과: mall_assets.json + 조각 파일(JPEG)

  10/7 답 — 「받은 그림으로 먼저 맞추고, 사진은 원본 PNG 가 오면 교체」. 그래서 이 조각들은 **임시**입니다.
  받은 것이 JPEG 이라, PNG 로 바꿔 저장하면 형식을 바꾸는 것이고 크기만 커집니다. jpegtran 의 「손실 없는 자르기」로 JPEG 그대로 잘라
  **점의 값이 받은 그림의 그 자리와 같습니다**(--check 가 봅니다). 손실 없는 자르기는 왼쪽 · 위를 16점 칸에 맞춰야 해서 조각이 조금 넉넉하게 잘립니다 —
  화면에 보일 자리(inner)를 같이 적어 두고, 화면에서는 그 자리만 보이게 합니다.

  사용:  python3 cut_mall.py            조각을 만들어 OUT(기본 ./mall_cut)에 둠 · mall_assets.json 을 씀
         python3 cut_mall.py --check    놓여 있는 조각이 받은 그림의 그 자리와 점 하나 같은지(DIR=조각 폴더)
"""
import json, os, subprocess, sys
from PIL import Image, ImageChops

Q = os.path.dirname(os.path.abspath(__file__))
# 받은 그림 — 킷에는 sgb/docs/design/ 에 넣어 두었습니다(v10.25). 이 파일이 킷의 qa/ 에 있으면 그 그림을, 아니면 작업 폴더의 것을 씁니다
_KD = os.path.join(os.path.dirname(Q), 'sgb', 'docs', 'design', 'mall_design_from_chat_89332263.jpeg')
if not os.path.exists(_KD): _KD = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/docs/design/mall_design_from_chat_89332263.jpeg'
SRC = os.environ.get('SRC', _KD if os.path.exists(_KD) else '/home/claude/design_1007/mall_design_from_chat_89332263.jpeg')
OUT = os.environ.get('OUT', os.path.join(Q, 'mall_cut'))
if not os.path.exists(SRC) and '--check' in sys.argv:      # v10.31.1 — 원본이 킷 밖(디자인 원본 묶음)이면 지문으로
    from design_fp import same_fp
    man = json.load(open(os.path.join(Q, 'mall_assets.json'), encoding='utf-8')); D = os.environ.get('DIR', OUT)
    bad = [n for n, a in man['parts'].items() if not same_fp('mall', a['file'], os.path.join(D, a['file']))]
    print(f"조각 {len(man['parts'])}개 · 받은 그림과 다른 것 {len(bad)} {bad[:5]} (원본 없음 — 지문으로 견줌)")
    sys.exit(1 if bad else 0)
im = Image.open(SRC).convert('RGB'); W, H = im.size; px = im.load()

def bbox(x0, y0, x1, y1, bg, tol=10):
    """(x0,y0)-(x1,y1) 안에서 바탕색(bg)이 아닌 점들의 둘레."""
    xs = []; ys = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            c = px[x, y]
            if abs(c[0] - bg[0]) > tol or abs(c[1] - bg[1]) > tol or abs(c[2] - bg[2]) > tol: xs.append(x); ys.append(y)
    assert xs, (x0, y0, x1, y1)
    return [min(xs), min(ys), max(xs) + 1, max(ys) + 1]

WHITE = (255, 255, 255); GRAY = (247, 247, 247)
A = {}       # 이름 → 보일 자리 [x0, y0, x1, y1] (받은 그림의 좌표)
# 사진 띠 — 글자 · 검색 칸이 없는 오른쪽 부분(글자가 박힌 왼쪽은 쓰지 않습니다)
A['hero-right'] = [656, 55, 1092, 292]
A['promo-right'] = [340, 1004, 632, 1290]
A['band-left'] = [33, 1828, 150, 1908]
A['band-right'] = [648, 1828, 840, 1908]
# 성분 · 고민 아이콘 20개 — 흰 타일 안의 그림(글자 위)
TX = [45, 147, 248, 349, 450, 551, 652, 753, 854, 955]
for i, x in enumerate(TX):
    A[f'ing-{i + 1:02d}'] = bbox(x + 6, 383, x + 86, 420, WHITE)
    A[f'con-{i + 1:02d}'] = bbox(x + 6, 560, x + 86, 597, WHITE)
# 성분별 최저가 8장 — 흰 카드 안의 상품 사진
for i, x in enumerate([46, 172, 297, 423, 549, 675, 801, 927]):
    A[f'low-{i + 1:02d}'] = bbox(x + 6, 733, x + 114, 822, WHITE)
# 오늘의 건강상품 순위 5줄
for i, y in enumerate([1066, 1114, 1163, 1212, 1262]):
    A[f'rank-{i + 1:02d}'] = bbox(706, y - 23, 764, y + 23, WHITE)
# 많이 찾는 상품 6줄(회색 바탕)
for i, (x, y) in enumerate([(104, 1410), (104, 1449), (104, 1489), (360, 1410), (360, 1449), (360, 1489)]):
    A[f'many-{i + 1:02d}'] = bbox(x, y - 19, x + 44, y + 19, GRAY, 12)
# 새로 올라온 상품 4장 — 카드 위쪽을 꽉 채운 사진
for i, x in enumerate([581, 697, 814, 930]):
    A[f'new-{i + 1:02d}'] = [x + 1, 1383, x + 107, 1442]
# 이번 주 특별 할인 6장
for i, x in enumerate([46, 214, 382, 550, 718, 887]):
    A[f'deal-{i + 1:02d}'] = bbox(x + 30, 1612, x + 130, 1672, WHITE)

def cut(name, inner):
    x0, y0, x1, y1 = inner
    X = x0 // 16 * 16; Y = y0 // 16 * 16; w = x1 - X; h = y1 - Y          # 왼쪽 · 위를 16점 칸에 맞춤(오른쪽 · 아래는 그대로)
    return {'file': name + '.jpg', 'box': [X, Y, X + w, Y + h], 'inner': [x0 - X, y0 - Y, x1 - X, y1 - Y], 'w': w, 'h': h}

def plain(path):
    """JPEG 을 「색 보간 없이」 풉니다(djpeg -nosmooth). 보통 풀이는 색을 이웃 칸과 섞어 부드럽게 하는데, 잘라 낸 조각은 가장자리의 이웃 칸이 없어
    가장자리 몇 점이 달라 보입니다(안에 든 값은 같은데도). 섞지 않고 풀면 칸마다 따로 풀리므로, 안에 든 값이 같으면 점도 모두 같습니다."""
    r = subprocess.run(['djpeg', '-nosmooth', '-ppm', path], capture_output=True)
    assert r.returncode == 0, r.stderr[:200]
    import io
    return Image.open(io.BytesIO(r.stdout)).convert('RGB')
_src_plain = None
def same(path, box):
    global _src_plain
    if Image.open(path).format != 'JPEG': return False
    if _src_plain is None: _src_plain = plain(SRC)
    g = plain(path)
    if g.size != (box[2] - box[0], box[3] - box[1]): return False
    return ImageChops.difference(g, _src_plain.crop(tuple(box))).getbbox() is None

if '--check' in sys.argv:
    man = json.load(open(os.path.join(Q, 'mall_assets.json'), encoding='utf-8')); D = os.environ.get('DIR', OUT); bad = []
    for n, a in man['parts'].items():
        p = os.path.join(D, a['file'])
        if not os.path.exists(p) or not same(p, a['box']): bad.append(n)
    print(f"조각 {len(man['parts'])}개 · 받은 그림과 다른 것 {len(bad)} {bad[:5]}")
    sys.exit(1 if bad else 0)

os.makedirs(OUT, exist_ok=True); parts = {}
for n, inner in A.items():
    a = cut(n, inner); X, Y = a['box'][:2]
    r = subprocess.run(['jpegtran', '-crop', f"{a['w']}x{a['h']}+{X}+{Y}", '-copy', 'none', '-outfile', os.path.join(OUT, a['file']), SRC], capture_output=True, text=True)
    assert r.returncode == 0, (n, r.stderr)
    assert same(os.path.join(OUT, a['file']), a['box']), n
    parts[n] = a
json.dump({'_src': os.path.basename(SRC), '_size': [W, H], '_note': '임시 조각 — 원본 PNG 가 오면 바꿉니다. box = 받은 그림에서 자른 자리 · inner = 조각 안에서 화면에 보일 자리', 'parts': parts},
          open(os.path.join(Q, 'mall_assets.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'조각 {len(parts)}개 · {sum(os.path.getsize(os.path.join(OUT, a["file"])) for a in parts.values()):,} 바이트 → {OUT}')
