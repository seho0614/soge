"""소개장터 메인 제시 디자인(2026-10-09 · 3000×4850 webp)에서 사진 · 아이콘 · 로고를 **자르기만** 합니다 — v10.30.

  python3 cut_money.py            자를 자리(BOXES)대로 잘라 ① 실제 웹(sgb/site/public/money — 실제 웹이 쓰는 것만) ② money_cut/(전부 · 시안에 넣는 것)에 둠 · money_assets.json 을 씀
  python3 cut_money.py --check    자르지 않고 ① 실제 웹의 파일 ② 시안(sgb/spec/proto.html)에 넣은 그림이 원본의 그 자리와 점 하나까지 같은지 봄
                                  (시안에서 실제 웹과 같이 쓰는 29장은 실제 웹의 PNG 파일과 바이트까지 같은지도 봄 · 견본 사진 17장은 무손실 WebP)

「이미지 그대로 사용」(10/9) — 색 · 크기 · 선명도를 건드리지 않습니다(무손실 PNG). 원본이 화면 1500px 의 2배라 화면에는 절반 크기로 놓습니다(css).
실제 웹에는 **서버 자료가 있는 구역의 그림만** 둡니다(site=True). 견본 사진(업체 · 요청 · 사례 · 광고)은 시안에만 들어갑니다.

★ 받은 그림(3.3MB)은 묶음 크기 한도(30MiB) 때문에 **킷에 넣지 않았습니다**(v10.30) — 10/9 에 보내신 그 파일이고, 변환 묶음(SGB_MoneyMain_Design_20261009)의 design/ 에도 있습니다.
  · sgb/docs/design/money_main_20261009.webp 로 넣어 두면(또는 MNY_SRC=경로) --check 가 **원본의 그 자리와 직접** 견줍니다.
  · 없으면 --check 는 자르기 표(money_assets.json)에 적어 둔 **조각마다의 지문**(자른 점들의 sha256 — 원본에서 자를 때 적은 것)과 견줍니다. 점이 하나라도 다르면 지문이 달라집니다.
  · 자르기(--check 없이)는 받은 그림이 있어야 합니다.
"""
import base64, hashlib, io, json, os, re, sys
from PIL import Image, ImageChops

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Q = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get('MNY_SRC') or K + '/sgb/docs/design/money_main_20261009.webp'; DST = K + '/sgb/site/public/money/'; ALL = os.environ.get('OUT', os.path.join(Q, 'money_cut')) + '/'
PROTO = os.environ.get('PROTO', K + '/sgb/spec/proto.html')
SHA = '72d7a168b6e709a6ba54262aa2b46c550deba3b6d5059ac5b274b046ab85d1e6'      # 받은 그림(대화 첨부 1000038758.webp)의 sha256

# 이름: (x0, y0, x1, y1, 구역, 쓰임, 실제 웹에 두는가)  — 좌표는 원본 그림의 점
BOXES = {
    'logo':        (170, 24, 602, 128, '머리줄', '로고', True),
    'bell':        (2856, 32, 2936, 114, '머리줄', '알림 종(숫자 1 포함) — 실제 웹은 실제 숫자를 써야 해서 선 그림을 씁니다', False),
    'spark':       (215, 673, 267, 728, '맨 위', '검색 칸의 파란 별', True),
    'flame':       (176, 816, 205, 852, '맨 위', '「많이 찾는 키워드」 불꽃', True),   # v10.31 (w2) — 서버 자료로 그리는 구역에서 실제 웹도 씀(시안 MNY_ART 원본 바이트)
    'hero_ad':     (1780, 212, 2821, 897, '맨 위', '광고 사진(글자 · 1/3 · 화살표 포함 그대로)', False),
    'quick_send':  (174, 1061, 321, 1184, '바로가기', '소개하기 — 종이비행기', True),
    'quick_want':  (1110, 1063, 1263, 1186, '바로가기', '소개받고 싶어요 — 사람 둘', True),
    'quick_recv':  (2079, 1061, 2185, 1188, '바로가기', '소개받기 — 문서', True),
    'cat_all':     (219, 1456, 283, 1543, '분야', '전체', True),
    'cat_furn':    (397, 1466, 481, 1543, '분야', '가구, 인테리어', True),
    'cat_clean':   (601, 1466, 667, 1545, '분야', '청소, 방역', True),
    'cat_move':    (784, 1466, 856, 1543, '분야', '이사, 운송', True),
    'cat_used':    (968, 1466, 1041, 1543, '분야', '중고 거래', True),
    'cat_office':  (1164, 1466, 1239, 1543, '분야', '사무 용품', True),
    'cat_make':    (1360, 1464, 1435, 1543, '분야', '제조, 유통', True),
    'cat_build':   (1553, 1466, 1626, 1543, '분야', '공사, 시공', True),
    'cat_design':  (1745, 1466, 1826, 1543, '분야', '디자인, 마케팅', True),
    'cat_it':      (1933, 1466, 2016, 1543, '분야', 'IT, 개발', True),
    'cat_tax':     (2131, 1465, 2202, 1543, '분야', '세무, 노무', True),
    'cat_edu':     (2323, 1464, 2403, 1543, '분야', '교육, 컨설팅', True),
    'cat_event':   (2521, 1465, 2592, 1543, '분야', '행사, 모임', True),
    'cat_etc':     (2716, 1466, 2782, 1543, '분야', '기타', True),
    'side_goods':  (123, 1825, 172, 1877, '분류 목록', '상품', True),
    'side_service': (123, 2212, 173, 2264, '분류 목록', '서비스(고른 줄 바탕색 포함)', True),
    'side_expert': (126, 2666, 172, 2716, '분류 목록', '전문가', True),
    'side_company': (125, 2770, 179, 2819, '분류 목록', '업체', True),
    'side_want':   (127, 2870, 180, 2923, '분류 목록', '구해요 / 의뢰', True),
    'side_region': (126, 3016, 178, 3069, '분류 목록', '지역으로 찾기', True),   # v10.31 (w2) — 서버 자료로 그리는 구역에서 실제 웹도 씀(시안 MNY_ART 원본 바이트)
    'badge':       (662, 2627, 728, 2693, '구역 제목', '주황 별 딱지(큰 것)', True),
    'badge_s':     (123, 4293, 176, 4346, '구역 제목', '주황 별 딱지(작은 것 — 연결 사례)', True),   # v10.31 (w2) — 서버 자료로 그리는 구역에서 실제 웹도 씀(시안 MNY_ART 원본 바이트)
    'star':        (701, 2218, 743, 2258, '카드', '별점 별', True),   # v10.31 (w2) — 서버 자료로 그리는 구역에서 실제 웹도 씀(시안 MNY_ART 원본 바이트)
    'pin':         (706, 2275, 737, 2313, '카드', '위치 표시', True),   # v10.31 (w2) — 서버 자료로 그리는 구역에서 실제 웹도 씀(시안 MNY_ART 원본 바이트)
    'pin_s':       (1115, 2868, 1145, 2904, '소개 요청', '위치 표시(요청 줄의 작은 것 — 카드의 것보다 조금 작게 그려져 있어 따로 자릅니다)', True),   # v10.31 (w2) — 서버 자료로 그리는 구역에서 실제 웹도 씀(시안 MNY_ART 원본 바이트)
    'svc_1':       (663, 1853, 1180, 2061, '서비스 업체 추천', '클린하우스', False),
    'svc_2':       (1219, 1853, 1736, 2061, '서비스 업체 추천', '한성 인테리어 파트너', False),
    'svc_3':       (1775, 1853, 2292, 2061, '서비스 업체 추천', '행복 이사', False),
    'svc_4':       (2328, 1853, 2845, 2061, '서비스 업체 추천', '에어존 시스템', False),
    'req_1':       (664, 2814, 859, 2912, '소개 요청', '사무실 입주청소', False),
    'req_2':       (664, 2930, 859, 3028, '소개 요청', '카페 테이블', False),
    'req_3':       (664, 3047, 859, 3144, '소개 요청', '홈페이지 리뉴얼', False),
    'req_4':       (664, 3163, 859, 3260, '소개 요청', '가정 이사', False),
    'ai_1':        (663, 3500, 1180, 3607, 'AI 추천', '김현우 세무사', False),
    'ai_2':        (1219, 3500, 1736, 3607, 'AI 추천', '더존 인테리어', False),
    'ai_3':        (1775, 3500, 2292, 3607, 'AI 추천', '스마트오피스', False),
    'ai_4':        (2328, 3500, 2845, 3607, 'AI 추천', '행복 이사', False),
    'band_ad':     (89, 4008, 2915, 4199, '띠 광고', '사무 가구 띠(글자 · 단추 포함 그대로)', False),
    'case_1':      (125, 4369, 297, 4588, '연결 사례', '판교 사무실 입주청소', False),
    'case_2':      (717, 4369, 888, 4588, '연결 사례', '카페 테이블 20개 제작', False),
    'case_3':      (1308, 4369, 1480, 4588, '연결 사례', '학원 인테리어 시공', False),
    'logo_foot':   (92, 4681, 498, 4785, '바닥줄', '로고(「소개하면 돈이 된다」 포함)', True),
    'sns_fb':      (2151, 4693, 2215, 4757, '바닥줄', '페이스북', True),
    'sns_ig':      (2238, 4693, 2302, 4757, '바닥줄', '인스타그램', True),
    'sns_yt':      (2324, 4693, 2389, 4757, '바닥줄', '유튜브', True),
}

def px(im):
    """조각의 지문 — 점(RGB)을 왼쪽 위부터 늘어놓은 것의 sha256. 파일 형식(PNG · 무손실 WebP)과 상관없이 점이 같으면 같습니다"""
    return hashlib.sha256(im.convert('RGB').tobytes()).hexdigest()
class Print:
    """받은 그림이 없을 때 원본 조각 대신 쓰는 것 — 자르기 표에 적어 둔 크기와 지문"""
    def __init__(self, size, h): self.size = tuple(size); self.h = h
def same(got, crop, formats=('PNG',)):
    if isinstance(crop, Print): return got.format in formats and got.size == crop.size and px(got) == crop.h
    return got.format in formats and got.size == crop.size and ImageChops.difference(got.convert('RGB'), crop).getbbox() is None
def same_file(path, crop):
    try: return same(Image.open(path), crop)
    except Exception: return False

_RAW = [None]
def _raw_proto():
    if _RAW[0] is None: _RAW[0] = open(PROTO, encoding='utf-8').read()
    return _RAW[0]

def proto_art():
    """시안에 넣은 그림 — MNY_ART = { 이름: "data:image/png;base64,…" } 를 읽어 { 이름: PIL 그림 }"""
    try: s = open(PROTO, encoding='utf-8').read()
    except Exception: return None
    m = re.search(r'var MNY_ART\s*=\s*(\{.*?\});', s, re.S)
    if not m: return None
    out = {}
    for n, fmt, b in re.findall(r'"([a-z0-9_]+)"\s*:\s*"data:image/(png|webp);base64,([A-Za-z0-9+/=]+)"', m.group(1)):
        out[n] = Image.open(io.BytesIO(base64.b64decode(b)))
    return out

def main(check):
    have = os.path.exists(SRC); old = {}
    try: old = json.load(open(os.path.join(Q, 'money_assets.json'), encoding='utf-8'))['parts']
    except Exception: pass
    if have:
        assert hashlib.sha256(open(SRC, 'rb').read()).hexdigest() == SHA, '받은 그림이 바뀌었습니다: ' + SRC
        im = Image.open(SRC).convert('RGB'); assert im.size == (3000, 4850), im.size
    else:
        if not check: print('받은 그림이 없어 자를 수 없습니다 — ' + SRC + ' 에 넣거나 MNY_SRC=경로 로 알려 주십시오(sha256 ' + SHA[:12] + '…)'); return False
        assert old and all(n in old and old[n].get('px') and old[n]['box'] == list(b[:4]) for n, b in BOXES.items()), '자르기 표(money_assets.json)에 지문이 없습니다 — 받은 그림을 넣고 python3 cut_money.py 를 한 번 돌리십시오'
    crops = {}
    bad = []; n_site = 0; man = {}
    for name, (x0, y0, x1, y1, sec, use, site) in BOXES.items():
        crop = im.crop((x0, y0, x1, y1)) if have else Print(old[name]['size'], old[name]['px']); f = name + '.png'; crops[name] = crop
        man[name] = {'box': [x0, y0, x1, y1], 'size': [x1 - x0, y1 - y0], 'css': [(x1 - x0) / 2, (y1 - y0) / 2], 'section': sec, 'use': use, 'site': site, 'px': px(crop) if have else crop.h}
        if have and old.get(name, {}).get('px') and old[name]['px'] != man[name]['px']: bad.append('표의 지문≠원본:' + name)
        if not check:
            os.makedirs(ALL, exist_ok=True)
            if not same_file(ALL + f, crop): crop.save(ALL + f, format='PNG', optimize=True)
            if site:
                os.makedirs(DST, exist_ok=True)
                if not same_file(DST + f, crop): crop.save(DST + f, format='PNG', optimize=True)
        if site:
            n_site += 1
            if not same_file(DST + f, crop): bad.append('web:' + name)
    # 실제 웹 폴더에 표에 없는 그림이 섞이지 않았는지
    extra = sorted(set(os.listdir(DST)) - {n + '.png' for n, b in BOXES.items() if b[6]}) if os.path.isdir(DST) else []
    bad += ['web+:' + e for e in extra]
    art = proto_art(); n_art = 0
    if art is not None:
        for name, got in art.items():
            n_art += 1
            # 시안 — 실제 웹이 쓰는 그림은 PNG(같은 파일), 견본 사진은 무손실 WebP 도 됩니다. 어느 쪽이든 점은 원본의 그 자리와 같아야 합니다
            if name not in BOXES or not same(got, crops[name], ('PNG',) if BOXES[name][6] else ('PNG', 'WEBP')): bad.append('proto:' + name)
            elif BOXES[name][6] and base64.b64encode(open(DST + name + '.png', 'rb').read()).decode() not in _raw_proto(): bad.append('proto≠web:' + name)
        miss = sorted(set(BOXES) - set(art)); bad += ['proto-:' + m for m in miss]
    if not check:
        json.dump({'_src': 'sgb/docs/design/money_main_20261009.webp', '_sha256': SHA, '_size': [3000, 4850], '_scale': 2,
                   '_rule': '자르기만 — 색 · 크기 변경 없음(무손실 PNG) · 화면에는 1/2 크기(css)로 놓음 · site = 실제 웹(sgb/site/public/money)에 두는가 · px = 그 조각의 지문(점 RGB 를 늘어놓은 것의 sha256 — 받은 그림 없이 견줄 때 씀)',
                   'parts': man}, open(os.path.join(Q, 'money_assets.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'조각 {len(BOXES)}개 — 실제 웹 {n_site}개 · 시안 {n_art if art is not None else "(시안에 아직 없음)"}개 · 원본과 다른 것 {len(bad)}', bad[:8], '' if have else '(받은 그림 파일 없이 자르기 표의 지문으로 견줌)')
    return not bad

if __name__ == '__main__':
    sys.exit(0 if main('--check' in sys.argv) else 1)
