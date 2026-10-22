"""v10.56 — 메인(/) 디자인 시트 맞추기(docs/110). 실제 웹(home.css · proto-common.css · 아이콘 PNG)과 시안(spec/proto.html)에 같은 고침을 넣습니다.

  python3 -I apply_main_v1056.py <sgb-core 폴더>

  다시 돌려도 같은 결과입니다(이미 고친 곳은 건너뜀).
  10/22 대표 결정 「시트 브랜드 색(추천)」 — 보라 #5B3DF8 → 시트 브랜드 남색 #00245a · 강조 주황 #ffa03e · 글꼴 페이퍼로지 · 나눔스퀘어 네오.
  배치 · 그림 · 문구는 그대로입니다. 대비 4.5 미달(10/21 점검 약 13곳)도 함께 고칩니다.

  1. home.css      — 색 변수 · 보라 계열 숫자 → 시트 값(남색 연한 단계 4종은 남색을 흰색에 4 · 8 · 14 · 25% 섞은 값) · 글꼴 · 대비
  2. proto-common  — 메인 묶음(.main-home 의 v10.28 옛 값) 풀기
  3. 아이콘 PNG    — 그림에서 잘라 낸 보라 아이콘 12장의 보라 점만 남색으로(밝기 비율 그대로 · 투명도 그대로). 상품 사진(쇼핑백)은 내용이라 그대로
  4. 시안          — #mhx-style 에 1 과 같은 고침 · SGB_KEEP 에서 메인(main1 · main2) 빼기 · 바뀐 그림(base64) 바꿔 넣기
"""
import base64, colorsys, os, re, struct, sys, zlib

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
ST = os.path.join(CORE, 'site/src/styles')
NOTE = ('/* 2026-10-22 v10.56(docs/110) — 메인도 디자인 시트로(대표 「시트 브랜드 색」). 보라(처음 그림의 주색) → 브랜드 남색 · 남색 연한 단계 = 남색을 흰색에 4 · 8 · 14 · 25% 섞은 값'
        ' · 검색 단추 주황 바탕 + 남색 · 글꼴 시트 · 대비 4.5. 배치 · 그림 · 문구는 그대로 */\n')

# ── 1. home.css — 먼저 줄 단위 고침(순서대로), 그다음 숫자 바꾸기 ──
PAIRS = [
    ('.home {\n  --hv: #5B3DF8; --hv-d: #4527E0; --hv-w: #EEEBFF; --hv-l: #CFC7FF;\n  --hk: #121826; --hk2: #4B5565; --hk3: #8790A0; --hline: #E8EAF2;',
     NOTE + '.home {\n  --hv: var(--sgb-navy); --hv-d: #001a42; --hv-t1: #f5f6f8; --hv-w: #ebeef2; --hv-t3: #dbe0e8; --hv-l: #bfc8d6;\n'
     '  --hk: var(--sgb-ink); --hk2: var(--sgb-ink-2); --hk3: var(--sgb-ink-3); --hline: var(--sgb-line);'),
    ('  font-family: Pretendard, "Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", "Malgun Gothic", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;\n',
     '  font-family: var(--sgb-font-body);\n'),
    (':where(.home) button { font-family: inherit; }\n',
     ':where(.home) button { font-family: inherit; }\n:where(.home) :where(h1, h2, h3) { font-family: var(--sgb-font-title); }\n'),
    # 히어로 바탕 — 연보라 → 남색 연한 단계 + 오른쪽 위 주황 빛
    ('    radial-gradient(46% 70% at 88% 22%, #D9D2FF 0, rgba(217, 210, 255, 0) 70%),\n'
     '    radial-gradient(44% 64% at 46% 46%, #F6F7FE 0, rgba(246, 247, 254, 0) 72%),\n'
     '    linear-gradient(180deg, #E4ECFD 0, #ECEBFE 55%, #E6ECFD 100%);',
     '    radial-gradient(46% 70% at 88% 22%, rgba(255, 160, 62, .16) 0, rgba(255, 160, 62, 0) 70%),\n'
     '    radial-gradient(44% 64% at 46% 46%, #fff 0, rgba(255, 255, 255, 0) 72%),\n'
     '    linear-gradient(180deg, var(--hv-w) 0, var(--sgb-bg) 55%, var(--hv-w) 100%);'),
    ('background: rgba(210, 200, 255, .5); filter: blur(40px); }', 'background: rgba(255, 160, 62, .1); filter: blur(40px); }'),
    # 제목 강조 — 남색 + 주황 밑줄 빛(주황 글자는 흰 바탕 대비 2.1)
    ('.home-hero h1 em { font-style: normal; color: var(--hv); }',
     '.home-hero h1 em { font-style: normal; color: var(--hv); background: linear-gradient(transparent 66%, rgba(255, 160, 62, .45) 0); }'),
    # 검색 단추 — 시트 「검색 단추 주황」 + 남색 아이콘(10/21 결정 #4 · 대비 7.39)
    ('background: var(--hv); color: #fff; display: grid; place-items: center; box-shadow: 0 8px 18px rgba(91, 61, 245, .35); }\n.home-go:hover { background: var(--hv-d); }',
     'background: var(--sgb-orange); color: var(--sgb-navy); display: grid; place-items: center; box-shadow: 0 8px 18px rgba(255, 160, 62, .4); }\n.home-go:hover { background: var(--sgb-accent); }'),
    # 꼬리표 — 흰 글자 대비 3.5 ~ 4.0 → 4.5 이상
    ('.home-bdg.sky { background: #DDF1FB; color: #1580B8; }', '.home-bdg.sky { background: #DDF1FB; color: var(--hv); }'),
    ('.home-bdg.mint { background: #C9FAF2; color: #0B7F74; }', '.home-bdg.mint { background: #C9FAF2; color: var(--sgb-mall); }'),
    # 남색 연한 바탕 위 흐린 글자(3.6 ~ 4.2) → 설명 글자
    ('.home-padv { display: block; margin-top: 22px; font-size: 13px; font-weight: 700; color: var(--hk3); }',
     '.home-padv { display: block; margin-top: 22px; font-size: 13px; font-weight: 700; color: var(--hk2); }'),
    ('.home-pbody > .home-pwhy { font-size: 12.5px; color: var(--hk3); }', '.home-pbody > .home-pwhy { font-size: 12.5px; color: var(--hk2); }'),
    ('.home-vsi span { font-size: 13.5px; line-height: 1.35; color: var(--hk3); }', '.home-vsi span { font-size: 13.5px; line-height: 1.35; color: var(--hk2); }'),
    ('.home-sd { font-size: 14.5px; color: var(--hk3); margin-left: 6px; }', '.home-sd { font-size: 14.5px; color: var(--hk2); margin-left: 6px; }'),
    ('.home-demob .dbs { font-size: 11.5px; color: #7A868F;', '.home-demob .dbs { font-size: 11.5px; color: var(--sgb-ink-2);'),
    ('.home-demob .dbc:hover { border-color: var(--hv, #5B3DF5); }', '.home-demob .dbc:hover { border-color: var(--hv); }'),
    # 「HOT」 · 상품 순위 숫자 — 연분홍 위 빨강 3.96 → 5.13
    ('color: #E0263C; font-weight: 800; font-size: 15px; background: #FFE7EA;', 'color: #c4142c; font-weight: 800; font-size: 15px; background: #FFE7EA;'),
    ('.home-rk[data-rank=product] .home-rkl i { background: #FFE7EA; color: #E0263C; }', '.home-rk[data-rank=product] .home-rkl i { background: #FFE7EA; color: #c4142c; }'),
    ('font-size: 12px; display: grid; place-items: center; background: #E6F0FF; color: #2F7BF6; }', 'font-size: 12px; display: grid; place-items: center; background: var(--hv-w); color: var(--hv); }'),
    # 창업 띠 — 꼬리표 흰 글자 3.19 → 5.37 · 큰 강조 글자 2.9 → 4.16(27px 굵은 글자 기준 3.0)
    ('.home-sttag { background: #F2623A;', '.home-sttag { background: #c23a12;'),
    ('.home-stc b em { font-style: normal; color: #E8501F; }', '.home-stc b em { font-style: normal; color: #c23a12; }'),
]

# 숫자 바꾸기 — 보라 계열과 시트 밖 회색을 시트 값으로(대소문자 그대로 · 바로 뒤에 16진 글자가 없을 때만)
HEX = {
    'var(--hv-t1)': ['#F9F8FD', '#F7F6FF', '#F7F7FC', '#F5F4FF', '#FBFBFE', '#F6F7FE'],
    'var(--hv-w)': ['#EFECFF', '#EDEBFE', '#EBE8FE', '#EEE9FD', '#ECEBFE', '#E4ECFD', '#E6ECFD', '#EEEBFF'],
    'var(--hv-t3)': ['#DEDAFD', '#E2DCFF', '#DDDCFF', '#D9D2FF', '#E7DDFF'],
    'var(--hv-l)': ['#C9BFFF', '#B9B5CC', '#CFC7FF'],
    'var(--hv)': ['#6A3FE0', '#5B3DF5', '#5B3DF8', '#0F1A3A'],
    'var(--sgb-ink-3)': ['#B4B0C8', '#A7A3BD', '#6B6690', '#7A868F', '#8790A0'],
    'var(--sgb-ink-2)': ['#3C4658', '#2D3648', '#4B5565'],
    'var(--sgb-ink)': ['#101418', '#121826'],
    'var(--sgb-line)': ['#E3E7EB', '#E8EAF2'],
    'var(--sgb-line-soft)': ['#EEF0F5'],
    'var(--sgb-tile)': ['#F1F2F8', '#F6F8F9'],
    'var(--sgb-bg)': ['#F6F9FC', '#F4F8FD', '#F5F6FB', '#F5F6FA', '#F7F8FA'],
    'var(--sgb-cream)': ['#FDF7E8'],
    '#fff': ['#FDFDFE'],
    '#e0001b': ['#F5315F', '#FC2D72', '#F0354B'],     # v10.55 머리줄 알림 숫자와 같은 빨강(흰 글자 5.02)
    'var(--sgb-link)': ['#1E7BF7', '#2F7BF6'],         # 시트 파란 줄 단추(흰 글자 4.65)
    'var(--sgb-mall)': ['#0A93C8', '#0B7F74'],         # 시트 청록(흰 글자 5.47)
}
RGBA = [('rgba(91, 61, 245, ', 'rgba(0, 36, 90, '), ('rgba(64, 48, 160, ', 'rgba(0, 36, 90, '), ('rgba(40, 34, 110, ', 'rgba(0, 36, 90, ')]


def fix_css(s, strict):
    n = 0
    for o, nw in PAIRS:
        if nw in s or o not in s:
            if strict and nw not in s:
                raise SystemExit(f'home.css 에서 찾지 못함: {o[:70]}')
            continue
        assert s.count(o) == 1, o[:70]
        s = s.replace(o, nw); n += 1
    for nw, olds in HEX.items():
        for o in olds:
            s, k = re.subn(re.escape(o) + r'(?![0-9A-Fa-f])', nw, s); n += k
    for o, nw in RGBA:
        k = s.count(o); s = s.replace(o, nw); n += k
    return s, n


p = os.path.join(ST, 'home.css')
s = open(p, encoding='utf-8').read()
# 이 판의 머리말을 단 줄 아래 주석에서 보라 이야기가 남지 않게 맨 위 설명도 한 줄 고칩니다
s = s.replace(' * · 사진 · 아이콘 · 로고는 그림에서 그대로 잘라 낸 것(/home/d/*.png)이고, 색은 그림에서 읽은 값입니다(qa/crop_design.py).',
              ' * · 사진 · 아이콘 · 로고는 그림에서 그대로 잘라 낸 것(/home/d/*.png)입니다(qa/crop_design.py). 보라 아이콘 12장은 v10.56 에서 남색으로 다시 칠했습니다(qa/apply_main_v1056.py).\n'
              ' * · 색은 v10.56 부터 디자인 시트(sgb-tokens.css) 기준입니다 — 처음 그림에서 읽은 보라 계열은 쓰지 않습니다.')
s, n_css = fix_css(s, strict=True)
open(p, 'w', encoding='utf-8').write(s)

# ── 2. proto-common.css — 메인 묶음 풀기 ──
p = os.path.join(ST, 'proto-common.css')
pc = open(p, encoding='utf-8').read()
m = re.search(r'/\* ── 메인\(\.main-home\)은 v10\.28 토큰 값으로 묶어 둡니다.*?body:has\(\.main-home\) \{ background: #F2F4F6; \}\n', pc, flags=re.S)
if m:
    pc = pc[:m.start()] + ('/* 메인(.main-home) 묶음은 2026-10-22 v10.56(docs/110)에서 풀었습니다 — 메인도 디자인 시트(대표 「시트 브랜드 색」).\n'
                           ' * 10/21 2단계 B(docs/107)에서 소개광장 · 소개몰 · 소개장터 메인 · 생활금융 상담을 먼저 풀었습니다. */\n') + pc[m.end():]
    open(p, 'w', encoding='utf-8').write(pc)
assert '.main-home {' not in pc

# ── 3. 아이콘 PNG ──
NAVY = (0x00, 0x24, 0x5a)
PURPLE = (0x5B, 0x3D, 0xF8)
ICONS = ['core-1', 'core-2', 'core-4', 'sec-core', 'sec-forme', 'sec-need', 'sec-poll', 'sec-today', 'spark', 'spark-s', 'trust-2', 'promo-art']


def png_read(path):
    d = open(path, 'rb').read(); i = 8; idat = b''; pal = trns = None
    while i < len(d):
        ln, = struct.unpack('>I', d[i:i + 4]); t = d[i + 4:i + 8]; c = d[i + 8:i + 8 + ln]; i += 12 + ln
        if t == b'IHDR': w, h, bd, ct = struct.unpack('>IIBB', c[:10]); assert bd == 8 and c[12] == 0, (path, bd)
        elif t == b'PLTE': pal = [tuple(c[j:j + 3]) for j in range(0, len(c), 3)]
        elif t == b'tRNS': trns = c
        elif t == b'IDAT': idat += c
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]; raw = zlib.decompress(idat); st = w * bpp; prev = bytearray(st); k = 0; px = []
    for _ in range(h):
        f = raw[k]; k += 1; ln = bytearray(raw[k:k + st]); k += st
        for x in range(st):
            a = ln[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
            if f == 1: ln[x] = (ln[x] + a) & 255
            elif f == 2: ln[x] = (ln[x] + b) & 255
            elif f == 3: ln[x] = (ln[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                pa, pb, pc_ = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                ln[x] = (ln[x] + (a if pa <= pb and pa <= pc_ else b if pb <= pc_ else c)) & 255
        for x in range(w):
            if ct == 6: px.append(tuple(ln[x * 4:x * 4 + 4]))
            elif ct == 2: px.append(tuple(ln[x * 3:x * 3 + 3]) + (255,))
            elif ct == 3: px.append(pal[ln[x]] + ((trns[ln[x]] if trns and ln[x] < len(trns) else 255),))
            elif ct == 4: px.append((ln[x * 2],) * 3 + (ln[x * 2 + 1],))
            else: px.append((ln[x],) * 3 + (255,))
        prev = ln
    return w, h, px


def png_write(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(v for p in px[y * w:(y + 1) * w] for v in p) for y in range(h))
    chunk = lambda t, c: struct.pack('>I', len(c)) + t + c + struct.pack('>I', zlib.crc32(t + c) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def is_purple(r, g, b):
    if max(r, g, b) - min(r, g, b) < 10: return False
    hue = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0] * 360
    return 225 <= hue <= 295


def recolor(p):
    r, g, b, a = p
    if not is_purple(r, g, b): return p
    # 흰색과 대표 보라 사이 어디쯤인가(0 = 흰색 · 1 = 보라 · 1 보다 크면 보라보다 진함) → 같은 비율로 흰색과 남색 사이에
    t = ((255 - r) / (255 - PURPLE[0]) + (255 - g) / (255 - PURPLE[1])) / 2
    if t <= 1: q = [round(255 * (1 - t) + n * t) for n in NAVY]
    else: q = [round(n * max(0.0, 2 - t)) for n in NAVY]
    return tuple(max(0, min(255, v)) for v in q) + (a,)


D = os.path.join(CORE, 'site/public/home/d')
swap = {}
for name in ICONS:
    f = os.path.join(D, name + '.png')
    old = open(f, 'rb').read()
    w, h, px = png_read(f)
    new = [recolor(p) for p in px]
    if new == px: continue
    png_write(f, w, h, new)
    swap[base64.b64encode(old).decode()] = base64.b64encode(open(f, 'rb').read()).decode()

# ── 4. 시안 ──
p = os.path.join(CORE, 'spec/proto.html')
pr = open(p, encoding='utf-8').read()
m = re.search(r'(<style id="mhx-style">\n)(.*?)(</style>)', pr, flags=re.S)
assert m, 'mhx-style'
blk = m.group(2).replace(' * · 사진 · 아이콘 · 로고는 그림에서 그대로 잘라 낸 것(/home/d/*.png)이고, 색은 그림에서 읽은 값입니다(qa/crop_design.py).',
                         ' * · 사진 · 아이콘 · 로고는 그림에서 그대로 잘라 낸 것(/home/d/*.png)입니다(qa/crop_design.py). 보라 아이콘 12장은 v10.56 에서 남색으로 다시 칠했습니다(qa/apply_main_v1056.py).\n'
                         ' * · 색은 v10.56 부터 디자인 시트(sgb-tokens.css) 기준입니다 — 처음 그림에서 읽은 보라 계열은 쓰지 않습니다.')
blk, n_pr = fix_css(blk, strict=False)
pr = pr[:m.start(2)] + blk + pr[m.end(2):]
# 메인을 묶음(SGB_KEEP)에서 빼면 #screen[data-sgb] 의 시트 값(--sgb-*)이 메인에도 들어갑니다
km = re.search(r'var SGB_KEEP = \{([^}]*)\}', pr)
assert km, 'SGB_KEEP'
keys = [k for k in km.group(1).split(',') if k and k not in ('"main1":1', '"main2":1')]
n_keep = len(km.group(1).split(',')) - len(keys)
pr = pr[:km.start(1)] + ','.join(keys) + pr[km.end(1):]
n_img = 0
for o, nw in swap.items():
    k = pr.count(o); pr = pr.replace(o, nw); n_img += k
open(p, 'w', encoding='utf-8').write(pr)
print(f'home.css 고침 {n_css} · 아이콘 {len(swap)}장 · 시안 CSS {n_pr} · 시안 묶음 뺌 {n_keep} · 시안 그림 {n_img}')
