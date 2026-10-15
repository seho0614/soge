"""소개장터 메인 — 제시 디자인(2026-10-09 · 3000×4850)과 만든 화면(1500px · 2배로 찍은 그림)의 **같은 자리**를 견줍니다. v10.30

  python3 shot_mny.py proto && python3 measure_mny.py proto     시안 — 그림의 모든 구역(159곳)
  python3 shot_mny.py site  && python3 measure_mny.py site      실제 웹 — 실제 웹에 넣은 구역만(서버에 자료가 없는 구역은 그리지 않습니다)

자리마다 「바탕이 아닌 점」의 상자를 두 그림에서 따로 구해 왼쪽 · 위 · 폭 · 높이의 차이를 화면 px 로 적습니다. 글자 자리는 글자색도 견줍니다.
허용 범위 ±TOL px(기본 6). 벗어나면 실패로 세고 종료 코드 1.

구역이 통째로 밀려 있어도 견줄 수 있게, 구역마다 **기준 자리**(그 구역 상자의 왼쪽 위)를 씁니다 — shot_mny.py 가 화면에서 재어 mny_*.json 에 적고,
그림 쪽 기준 자리는 아래 DESIGN 입니다. (시안 · 실제 웹은 「지금 있던 구역」을 디자인 구역 아래에 남겨서, 그 아래 구역이 그만큼 내려가 있습니다 — 10/9 답 ②)

★ 받은 그림(3.3MB)은 묶음 크기 한도 때문에 킷에 넣지 않았습니다(v10.30). sgb/docs/design/money_main_20261009.webp 로 넣어 두면(또는 MNY_SRC=경로) 그림에서 직접 재고,
  없으면 **그림에서 미리 재어 둔 값**(measure_mny_design.json — 자리마다 그림 쪽 상자 · 글자색)을 씁니다. 만든 화면 쪽은 언제나 지금 찍은 그림에서 잽니다.
"""
import json, os, sys
import numpy as np
from PIL import Image
Q = os.path.dirname(os.path.abspath(__file__))
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(Q)
MODE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else 'proto'
TOL = float(os.environ.get('TOL', 6)); OUT = os.environ.get('OUT', Q)
SRCP = os.environ.get('MNY_SRC') or K + '/sgb/docs/design/money_main_20261009.webp'; CACHE = os.path.join(Q, 'measure_mny_design.json')
D = np.asarray(Image.open(SRCP).convert('RGB')).astype(int) if os.path.exists(SRCP) else None
DC = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {'height': 4850, 'items': {}}
assert D is not None or DC['items'], '받은 그림도, 미리 재어 둔 값(measure_mny_design.json)도 없습니다'
DH = D.shape[0] if D is not None else DC['height']
S = np.asarray(Image.open(os.path.join(OUT, 'mny_%s.png' % MODE)).convert('RGB')).astype(int)
META = json.load(open(os.path.join(OUT, 'mny_%s.json' % MODE), encoding='utf-8')); A = META['anchors']
# 그림에서의 구역 기준 자리(화면 px · 왼쪽, 위) — 2026-10-09 변환본에서 잰 값(그림과 ±2px 안)
DESIGN = {'hd': (0, 0), 'hero': (0, 75), 'quick': (44, 510.5), 'cat': (44, 646), 'side': (44, 854), 'p1': (301, 854), 'p2': (301, 1293.5), 'p3': (301, 1684.56),
          'req1': (331, 1407.5), 'req4': (331, 1582.06), 'band': (44, 2004.06), 'cases': (44, 2131.09), 'cta': (993, 2155.34), 'ft': (0, 2322.59)}

def hexrgb(h): return np.array([int(h[i:i+2], 16) for i in (1, 3, 5)])

def mask_of(a, mode):
    """mode: 숫자 = 바탕에서 가장 먼 색의 그 비율 이상(글자) · 'B' = 바탕과 다른 점(그림) · 'W' = 흰 점(흰 상자) · '#rrggbb' = 그 색의 점(테두리 · 색 상자)"""
    if mode == 'W': return a.min(axis=2) >= 252
    if isinstance(mode, str) and mode.startswith('#'): return np.abs(a - hexrgb(mode)).max(axis=2) <= 3
    v, c = np.unique(a.reshape(-1, 3), axis=0, return_counts=True); bg = v[c.argmax()]
    d = np.abs(a - bg).sum(axis=2).astype(float)
    if mode == 'B': return d > 30
    if mode == 'b': return d > 10          # 흐리게 놓인 그림(주소가 없는 사회관계망 아이콘 — 「준비 중」)
    if d.max() < 24: return np.zeros(d.shape, bool)
    return d > d.max() * mode

def ink(im, box, mode=.35, near=None, pady=0):
    """상자 안에서 그 모양의 테두리 상자를 구합니다. near(그림에서의 위쪽 자리)를 주면 위아래로 pady 만큼 넓혀 찾고,
    줄(세로로 이어진 덩어리) 가운데 그 자리에 가장 가까운 것을 고릅니다 — 위 구역의 높이가 조금 달라도 같은 줄을 견주게 됩니다."""
    x0, y0, x1, y1 = box; y0 = max(0, y0 - pady); y1 = min(y1 + pady, im.shape[0]); a = im[y0:y1, x0:x1]
    if a.size == 0: return None
    m = mask_of(a, mode); rows = m.any(axis=1)
    if not rows.any(): return None
    ys = np.where(rows)[0]
    if near is not None and pady:
        segs = []; s0 = ys[0]; prev = ys[0]
        for y in ys[1:]:
            if y - prev > 4: segs.append((s0, prev)); s0 = y
            prev = y
        segs.append((s0, prev))
        h = near[1] - near[0]
        s0, s1 = min(segs, key=lambda g: abs((y0 + g[0]) - near[0]) + abs((g[1] - g[0] + 1) - h) * .5)
        m = m[s0:s1 + 1]; top, bot = y0 + s0, y0 + s1 + 1
    else: top, bot = y0 + ys[0], y0 + ys[-1] + 1
    xs = np.where(m.any(axis=0))[0]
    return (x0 + xs[0], top, x0 + xs[-1] + 1, bot)

# 이름: (x0, y0, x1, y1[, 문턱]) — 원본 그림의 점. 상자는 그 글자 · 그림을 넉넉히 감싸되 옆 요소는 닿지 않게 잡았습니다.
P = {
 # 머리줄
 '머리줄 로고': (150, 10, 630, 140, 'B'), '메뉴 소개장터': (690, 40, 866, 98), '메뉴 안심소개': (890, 40, 1068, 98), '메뉴 소개창업': (1092, 40, 1270, 98), '메뉴 소개몰': (1292, 40, 1440, 98),
 '메뉴 소개광장': (1456, 40, 1640, 98), '메뉴 이용안내': (1650, 40, 1830, 98), '메뉴 밑줄': (690, 96, 866, 112, '#ffa03e'),
 '검색 단추': (1915, 14, 2040, 134, '#f0f1f4'), 'KR 단추': (2041, 14, 2278, 134, '#f0f1f4'), '로그인 단추': (2279, 14, 2518, 134, '#f0f1f4'), '회원가입 단추': (2519, 14, 2846, 134, '#ffa03e'), '알림 종': (2848, 20, 2950, 126, 'B'),
 'KR 글자': (2090, 40, 2170, 110), 'KR 화살': (2172, 40, 2240, 110), '로그인 글자': (2330, 40, 2460, 110), '회원가입 글자': (2556, 40, 2805, 110),
 # 맨 위
 '큰 제목 1줄': (160, 232, 760, 342), '큰 제목 2줄': (160, 348, 1080, 458), '설명 1줄': (165, 466, 700, 526), '설명 2줄': (165, 527, 1260, 582),
 '검색 칸': (160, 630, 1650, 772, 'W'), '파란 별': (200, 660, 285, 742, 'B'), '검색 안내 글자': (285, 672, 680, 730), '검색 둥근 단추': (1500, 646, 1630, 756, '#f5a008'),
 '불꽃': (168, 808, 212, 860, 'B'), '키워드 제목': (216, 808, 458, 860), '칩 사무실 청소': (470, 792, 690, 880, 'W'), '칩 인테리어': (692, 792, 895, 880, 'W'), '칩 이사': (897, 792, 1040, 880, 'W'), '칩 세무사': (1042, 792, 1226, 880, 'W'), '칩 카페 창업': (1228, 792, 1440, 880, 'W'),
 '맨 위 광고': (1740, 180, 2860, 930, 'B'),
 # 바로가기
 '바로가기 1': (60, 1005, 1026, 1250, 'W'), '바로가기 2': (1027, 1005, 1977, 1250, 'W'), '바로가기 3': (1978, 1005, 2940, 1250, 'W'),
 '바로가기 1 그림': (160, 1050, 340, 1200, 'B'), '바로가기 2 그림': (1095, 1050, 1280, 1200, 'B'), '바로가기 3 그림': (2060, 1050, 2205, 1200, 'B'),
 '바로가기 1 제목': (360, 1056, 760, 1124), '바로가기 1 설명': (360, 1136, 760, 1182), '바로가기 2 제목': (1290, 1056, 1760, 1124), '바로가기 3 제목': (2240, 1056, 2680, 1124), '바로가기 3 설명': (2240, 1136, 2700, 1182),
 '바로가기 1 화살': (890, 1090, 950, 1150), '바로가기 3 화살': (2770, 1090, 2830, 1150),
 # 분야
 '분야 상자': (60, 1270, 2940, 1670, 'W'), '분야 제목': (160, 1332, 1000, 1414), '분야 설명': (1020, 1340, 1900, 1396), '분야 전체보기': (2640, 1342, 2850, 1396),
 '분야 칸 1': (150, 1424, 345, 1612, '#fbf4e8'), '분야 칸 2': (346, 1424, 535, 1612, '#f2f3f4'), '분야 칸 8': (1494, 1424, 1686, 1612, '#f2f3f4'), '분야 칸 14': (2654, 1424, 2845, 1612, '#f2f3f4'),
 '분야 그림 1': (190, 1448, 310, 1549, 'B'), '분야 그림 2': (380, 1448, 500, 1549, 'B'), '분야 그림 14': (2690, 1448, 2810, 1549, 'B'),
 '분야 이름 1': (180, 1550, 320, 1590), '분야 이름 2': (366, 1550, 514, 1590), '분야 이름 9': (1708, 1550, 1858, 1590), '분야 이름 14': (2700, 1550, 2800, 1590),
 # 왼쪽 분류 목록
 '분류 머리': (60, 1690, 560, 1800, '#00245a'), '분류 머리 글자': (150, 1716, 480, 1784), '분류 상품 그림': (112, 1818, 182, 1884, 'B'), '분류 상품': (184, 1820, 300, 1884), '분류 상품 화살': (460, 1836, 518, 1876),
 '분류 가구, 인테리어': (192, 1892, 470, 1946), '분류 기타 상품': (192, 2120, 470, 2170), '분류 서비스 띠': (60, 2190, 560, 2290, '#fbf4e8'), '분류 서비스': (184, 2206, 320, 2270), '분류 청소, 방역': (192, 2302, 470, 2354), '분류 기타 서비스': (192, 2586, 470, 2634),
 '분류 전문가': (184, 2660, 320, 2724), '분류 업체': (184, 2764, 290, 2826), '분류 구해요': (184, 2864, 450, 2930), '분류 지역으로 찾기': (184, 3010, 450, 3076), '분류 서울': (192, 3088, 300, 3136), '분류 기타 지역': (192, 3598, 470, 3646),
 '분류 목록 상자': (60, 1795, 568, 3990, '#dbdbdb'),
 # 서비스 업체 추천
 '구역 1 상자': (569, 1690, 2960, 2560, 'W'), '구역 1 딱지': (650, 1740, 740, 1826, 'B'), '구역 1 제목': (745, 1740, 1320, 1822), '구역 1 전체보기': (2640, 1750, 2850, 1812),
 '카드 1': (640, 2070, 1200, 2480, '#dbdbdb'), '카드 4': (2310, 2070, 2870, 2480, '#dbdbdb'), '카드 1 사진': (640, 1840, 1200, 2066, 'B'), '카드 1 이름': (694, 2088, 1100, 2146), '카드 1 설명': (694, 2150, 1100, 2202), '카드 1 별': (694, 2212, 750, 2264, 'B'), '카드 1 점수': (752, 2214, 822, 2262), '카드 1 건수': (826, 2212, 930, 2264),
 '카드 1 위치 그림': (694, 2268, 748, 2320, 'B'), '카드 1 위치': (752, 2268, 960, 2318), '카드 1 프로필': (694, 2338, 922, 2440, 'B'), '카드 1 제안': (923, 2338, 1150, 2440, '#fca22a'), '카드 2 이름': (1250, 2088, 1700, 2146), '카드 4 이름': (2360, 2088, 2800, 2146), '카드 4 제안': (2585, 2338, 2815, 2440, '#fca22a'),
 # 소개 요청
 '구역 2 상자': (569, 2562, 2960, 3340, 'W'), '구역 2 제목': (745, 2618, 1320, 2696), '탭 전체': (650, 2706, 882, 2806, '#fca22a'), '탭 상품 구매': (883, 2706, 1107, 2806, '#dbdbdb'), '탭 중고 구하기': (1781, 2706, 2010, 2806, '#dbdbdb'), '탭 글자 상품 구매': (920, 2730, 1070, 2784),
 '요청 1 사진': (650, 2806, 880, 2920, 'B'), '요청 4 사진': (650, 3154, 880, 3270, 'B'), '요청 1 제목': (896, 2812, 1700, 2864), '요청 1 분야': (896, 2864, 1080, 2910, '#ebf3ff'), '요청 1 위치': (1150, 2866, 1320, 2908), '요청 2 분야': (896, 2980, 1090, 3026, '#fef3e0'), '요청 2 위치 그림': (1100, 2980, 1150, 3024, 'B'), '요청 3 분야': (896, 3096, 1090, 3142, '#f1eefe'), '요청 4 위치': (1150, 3214, 1320, 3256), '요청 1 시각': (1830, 2834, 1990, 2880), '요청 1 예산': (2130, 2834, 2380, 2880),
 '요청 1 제안': (2416, 2834, 2486, 2880), '요청 1 건수': (2488, 2832, 2580, 2880), '요청 1 단추': (2600, 2800, 2850, 2924, 'B'), '요청 4 제목': (896, 3160, 1700, 3212), '요청 4 단추': (2600, 3148, 2850, 3272, 'B'),
 # AI 추천
 '구역 3 상자': (569, 3342, 2960, 3990, 'W'), '구역 3 제목': (742, 3398, 1320, 3476), 'AI 카드 1': (640, 3612, 1200, 3922, '#dbdbdb'), 'AI 카드 1 사진': (640, 3488, 1200, 3610, 'B'), 'AI 카드 1 이름': (684, 3622, 1100, 3676), 'AI 카드 1 설명': (684, 3682, 1100, 3736), 'AI 카드 1 점수': (742, 3748, 806, 3794),
 'AI 카드 1 위치': (982, 3746, 1166, 3794), 'AI 카드 1 프로필': (678, 3802, 908, 3902, 'B'), 'AI 카드 1 제안': (909, 3802, 1140, 3902, '#fca22a'), 'AI 카드 4 이름': (2350, 3622, 2800, 3676), 'AI 카드 2 위치 그림': (1484, 3746, 1530, 3796, 'B'), 'AI 카드 2 위치': (1532, 3746, 1730, 3794), 'AI 카드 4 위치 그림': (2596, 3746, 2648, 3796, 'B'), 'AI 카드 4 위치': (2650, 3746, 2840, 3794),
 # 띠 · 사례 · 등록
 '띠 광고': (60, 3992, 2960, 4215, 'B'), '사례 상자': (60, 4230, 1960, 4650, 'W'), '사례 딱지': (114, 4284, 184, 4356, 'B'), '사례 제목': (186, 4286, 620, 4346), '사례 1 사진': (112, 4358, 310, 4600, 'B'), '사례 3 사진': (1296, 4358, 1494, 4600, 'B'),
 '사례 1 이름': (316, 4370, 700, 4422), '사례 1 설명': (316, 4430, 708, 4478), '사례 1 위치': (366, 4482, 600, 4528), '사례 1 날짜': (366, 4534, 640, 4580), '사례 3 이름': (1496, 4370, 1900, 4422),
 '등록 1줄': (2000, 4316, 2860, 4378), '등록 2줄': (2000, 4380, 2860, 4440), '등록 단추': (2360, 4444, 2870, 4580, '#fca22a'), '등록 단추 글자': (2460, 4486, 2740, 4542),
 # 바닥줄
 '바닥 로고': (70, 4660, 520, 4810, 'B'), '바닥 서비스 소개': (580, 4696, 780, 4752), '바닥 이용약관': (820, 4696, 990, 4752), '바닥 개인정보처리방침': (1040, 4696, 1320, 4752), '바닥 운영정책': (1360, 4696, 1530, 4752), '바닥 고객센터': (1570, 4696, 1740, 4752),
 '바닥 페이스북': (2140, 4684, 2226, 4766, 'B'), '바닥 유튜브': (2314, 4684, 2400, 4766, 'B'), '바닥 저작권': (2408, 4698, 2930, 4752),
}

def group(n):
    """자리 이름 → 구역"""
    if n.startswith(('머리줄', '메뉴', '검색 단추', 'KR', '로그인', '회원가입', '알림')): return 'hd'
    if n.startswith(('큰 제목', '설명', '검색 칸', '파란 별', '검색 안내', '검색 둥근', '불꽃', '키워드', '칩', '맨 위 광고')): return 'hero'
    if n.startswith('바로가기'): return 'quick'
    if n.startswith('분야'): return 'cat'
    if n.startswith('분류'): return 'side'
    if n.startswith(('구역 1', '카드')): return 'p1'
    if n.startswith(('구역 2', '탭', '요청')): return 'p2'
    if n.startswith(('구역 3', 'AI 카드')): return 'p3'
    if n.startswith('띠'): return 'band'
    if n.startswith('사례'): return 'cases'
    if n.startswith('등록'): return 'cta'
    if n.startswith('바닥'): return 'ft'
    raise KeyError(n)

# 알고 다르게 둔 곳 — 실패로 세지 않고 따로 적습니다
KNOWN = {'메뉴 소개몰': '그림은 이 메뉴만 글자색이 #231815(다른 메뉴는 #000000) — 다른 메뉴와 같은 #000000 으로 맞춤'}
SKIP = {}
if MODE == 'proto':
    KNOWN['바닥 고객센터'] = '바닥줄 링크는 사이트 정보의 목록 그대로입니다 — 「분쟁조정 안내」가 하나 더 있어 「고객센터」가 그만큼 오른쪽에 있습니다(그림은 링크 5개)'
    for n in ('바닥 페이스북', '바닥 유튜브'): P[n] = P[n][:4] + ('b',)      # 계정 주소를 넣기 전에는 아이콘이 흐립니다(준비 중)
if MODE == 'site':
    # 실제 웹 — 서버에 자료가 없는 구역은 그리지 않습니다. 그 자리는 견주지 않고 까닭을 적습니다.
    why = {'알림 종': '그림의 종에는 숫자 「1」이 같이 그려져 있습니다 — 실제 웹은 선으로 그린 종에 읽지 않은 알림 수를 붙입니다',
           '불꽃': '많이 찾는 키워드 — 서버에 집계가 없습니다', '키워드': '많이 찾는 키워드 — 서버에 집계가 없습니다', '칩': '많이 찾는 키워드 — 서버에 집계가 없습니다',
           '구역 1': '서비스 업체 추천 — 업체 단위 목록 · 평점이 서버에 없습니다', '카드': '서비스 업체 추천 — 업체 단위 목록 · 평점이 서버에 없습니다',
           '탭': '요청 종류 탭 — 요청에 종류 값이 없습니다', '요청': '요청 줄의 사진 · 지역 — 서버에 없습니다(글자는 실제 요청이라 그림과 다릅니다)',
           '구역 3': 'AI 추천 맞춤 공급자 — 추천 목록이 서버에 없습니다', 'AI 카드': 'AI 추천 맞춤 공급자 — 추천 목록이 서버에 없습니다',
           '띠': '띠 광고 — 이 자리의 광고 칸 종류가 서버에 없습니다', '사례': '최근 실제 연결 사례 — 서버에 자료가 없습니다',
           '등록': '공급자 등록 안내 — 실제 웹은 왼쪽의 사례 구역이 없어 가운데에 놓았습니다',
           '분류 지역': '지역으로 찾기 — 매물 · 요청에 지역 값이 없습니다', '분류 서울': '지역으로 찾기 — 매물 · 요청에 지역 값이 없습니다', '분류 기타 지역': '지역으로 찾기 — 매물 · 요청에 지역 값이 없습니다',
           '분류 목록 상자': '분류 목록의 높이 — 지역 묶음이 없어 그림보다 짧습니다',
           '구역 2 상자': '소개 요청 상자의 높이 — 종류 탭이 없어 그림보다 낮습니다',
           '바닥 운영정책': '바닥줄 링크는 서버가 내려주는 약관 목록 그대로입니다(「운영정책」은 목록에 없음)', '바닥 고객센터': '바닥줄 링크는 서버가 내려주는 약관 목록 그대로입니다(개수 · 순서가 그림과 다름)'}
    for n in ('바닥 페이스북', '바닥 유튜브'): P[n] = P[n][:4] + ('b',)      # 실제 웹은 계정 주소를 넣기 전에는 아이콘이 흐립니다(준비 중)
    keep = {'요청 1 단추': 'req1', '요청 4 단추': 'req4'}        # 요청 줄의 단추는 줄 기준으로 견줍니다(줄 수가 4개 이상일 때)
    for n in P:
        if n in keep: continue
        for k, v in why.items():
            if n == k or n.startswith(k + ' ') or (k in ('칩', '카드', '탭', '요청', '띠', '사례', '등록', '불꽃', '키워드', 'AI 카드', '구역 1', '구역 3', '분류 지역') and n.startswith(k)): SKIP[n] = v; break
else: keep = {}

CTOL = int(os.environ.get('CTOL', 16))    # 글자색 허용 차이(0~255)
def inkcolor(im, b):
    a = im[b[1]:b[3], b[0]:b[2]].reshape(-1, 3)
    v, c = np.unique(a, axis=0, return_counts=True); bg = v[c.argmax()]
    d = np.abs(a - bg).sum(axis=1); k = d >= d.max() * .5      # 글자 몸통의 색 — 가장 많이 나오는 색을 고릅니다(곁들인 화살표 색에 끌려가지 않게)
    v, c = np.unique(a[k], axis=0, return_counts=True); return v[c.argmax()].astype(int)
def hexs(c): return '#%02x%02x%02x' % tuple(int(v) for v in c)
PADY = int(os.environ.get('PADY', 60))   # 만든 화면에서 위아래로 넓혀 찾는 범위(원본 점)
rows = []; bad = 0; worst = 0; shifts = {}
for name, v in P.items():
    if name in SKIP: continue
    g = keep.get(name) or group(name)
    if A.get(g) is None:
        rows.append((name, None, '구역(%s)이 화면에 없음' % g)); bad += 1; continue
    dx = int(round((A[g][0] - DESIGN[g][0]) * 2)); dy = int(round((A[g][1] - DESIGN[g][1]) * 2)); shifts[g] = (dx / 2, dy / 2)
    box, th = v[:4], (v[4] if len(v) > 4 else .35)
    sbox = (box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy)
    key = '%s|%s' % (name, th)
    if D is not None:
        a = ink(D, box, th); DC['items'][key] = {'a': None if a is None else [int(x) for x in a]}
    else:
        a = (DC['items'].get(key) or {}).get('a'); a = None if a is None else tuple(a)
    b = None if a is None else ink(S, sbox, th, near=(a[1] + dy, a[3] + dy), pady=PADY if isinstance(th, float) else 0)   # 글자만 위아래로 넓혀 찾습니다
    if a is None or b is None:
        rows.append((name, None, '찾지 못함')); bad += 1; continue
    b0 = (b[0] - dx, b[1] - dy, b[2] - dx, b[3] - dy)        # 구역이 밀린 만큼 되돌려 견줍니다
    d = [(b0[0]-a[0])/2, (b0[1]-a[1])/2, ((b0[2]-b0[0])-(a[2]-a[0]))/2, ((b0[3]-b0[1])-(a[3]-a[1]))/2]
    clip = (b0[0] <= box[0] or b0[2] >= box[2]) and not (a[0] <= box[0] or a[2] >= box[2])
    m = max(abs(x) for x in d); ok = m <= TOL and not clip
    if not ok and name in KNOWN and group(name) == 'ft': rows.append((name, d, True, clip, [a[0]/2, a[1]/2, (a[2]-a[0])/2, (a[3]-a[1])/2], None)); continue      # 알고 다르게 둔 자리(바닥줄 링크 목록)
    bad += (not ok); worst = max(worst, m)
    col = None
    if isinstance(th, float):          # 글자 자리는 글자색도 견줍니다
        if D is not None: ca = inkcolor(D, a); DC['items'][key]['c'] = [int(x) for x in ca]
        else: ca = np.array(DC['items'][key]['c'])
        cb = inkcolor(S, b); cd = int(np.abs(ca - cb).max()); col = (hexs(ca), hexs(cb), cd)
        if cd > CTOL and name not in KNOWN: ok = False; bad += 1 if m <= TOL and not clip else 0
    rows.append((name, d, ok, clip, [a[0]/2, a[1]/2, (a[2]-a[0])/2, (a[3]-a[1])/2], col))
show_all = '--all' in sys.argv
for r in rows:
    if r[1] is None: print('✗ %-22s %s' % (r[0], r[2])); continue
    name, d, ok, clip, a, col = r
    if show_all or not ok: print('%s %-22s 그림 x%7.1f y%7.1f w%7.1f h%6.1f | 차이 x%+5.1f y%+5.1f w%+5.1f h%+5.1f %s%s' % ('✓' if ok else '✗', name, *a, *d, '(옆으로 넘침)' if clip else '',
        '' if not col else (' | 색 %s → %s%s' % (col[0], col[1], ' ✗' if col[2] > CTOL else ''))))
for k, v in KNOWN.items(): print('· 알고 다르게 둔 곳 — %s: %s' % (k, v))
if SKIP:
    by = {}
    for n, w in SKIP.items(): by.setdefault(w, []).append(n)
    for w, ns in by.items(): print('· 견주지 않은 곳 %d — %s' % (len(ns), w))
moved = {g: s for g, s in shifts.items() if abs(s[0]) > 1 or abs(s[1]) > 1}
if moved: print('· 통째로 옮겨진 구역(견줄 때 되돌림): ' + ' · '.join('%s x%+g y%+g' % (g, s[0], s[1]) for g, s in moved.items()))
n2 = sum(1 for r in rows if r[1] is not None and max(abs(x) for x in r[1]) <= 2)
if D is None: print('· 받은 그림 파일 없이, 그림에서 미리 재어 둔 값(measure_mny_design.json)으로 견줌')
print('\n[%s] 자리 %d곳 · 통과 %d · 실패 %d · ±2px 안 %d곳 · 가장 큰 자리 차이 %.1fpx (허용 ±%gpx · 글자색 허용 ±%d) · 견주지 않은 곳 %d · 화면 높이: 그림 %g / 만든 화면 %g' % (
    {'proto': '시안', 'site': '실제 웹'}.get(MODE, MODE), len(rows), len(rows)-bad, bad, n2, worst, TOL, CTOL, len(SKIP), DH/2, S.shape[0]/2))
json.dump({'mode': MODE, 'tol': TOL, 'count': len(rows), 'pass': len(rows)-bad, 'fail': bad, 'within2': n2, 'worst': worst, 'skipped': SKIP, 'known': KNOWN, 'moved': moved, 'design_h': DH/2, 'built_h': S.shape[0]/2,
           'items': {r[0]: ({'error': r[2]} if r[1] is None else {'diff': r[1], 'ok': bool(r[2]), 'color': r[5]}) for r in rows}}, open(os.path.join(OUT, 'measure_mny_%s.json' % MODE), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
if D is not None:      # 그림에서 잰 값을 적어 둡니다 — 받은 그림이 없는 곳(킷을 받은 PC)에서 같은 대조를 할 수 있게
    DC['height'] = int(D.shape[0]); DC['_note'] = '받은 그림(money_main_20261009.webp)에서 잰 값 — 자리 이름|문턱 → a = 그 모양의 상자(원본 점) · c = 글자색. measure_mny.py 가 받은 그림이 있을 때마다 다시 적습니다'
    json.dump(DC, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, indent=0, sort_keys=True)
sys.exit(1 if bad else 0)
