"""v10.56 시험 — 메인(/) 디자인 시트 맞추기(docs/110)

  KIT=… python3 -I test_v1056.py

  10/22 대표 결정: 메인도 디자인 시트로 — 「시트 브랜드 색(추천)」(보라 → 브랜드 남색 · 강조 주황 · 글꼴 시트 · 배치 · 그림 · 문구 그대로)

  ① home.css — 주색 = 시트 남색 · 보라 계열 숫자 0 · Pretendard 0 · 본문 · 제목 글꼴 시트
  ② 대비 — 한 규칙에 글자색 · 바탕색을 함께 적은 곳 모두 4.5 이상(27px 굵은 큰 글자는 3.0) · 10/21 점검의 메인 미달 자리
  ③ 아이콘 12장 — 보라 점 0 · 상품 사진(쇼핑백)은 그대로
  ④ 메인 묶음 풀림(proto-common.css · 시안 SGB_KEEP)
  ⑤ 시안 — 같은 CSS · 같은 그림
"""
import base64, colorsys, os, re, struct, zlib

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


strip = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)
HC = strip(rd('site/src/styles/home.css'))
T = strip(rd('site/src/styles/sgb-tokens.css'))


def hexn(h):
    h = h.lstrip('#').lower()
    return '#' + (''.join(c * 2 for c in h) if len(h) == 3 else h)


def L(h):
    h = hexn(h)[1:]; c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def cr(a, b):
    x, y = sorted([L(a), L(b)], reverse=True); return (x + .05) / (y + .05)


def purple(h):
    h = hexn(h)[1:]; r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return max(r, g, b) - min(r, g, b) >= 10 and 225 <= colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0] * 360 <= 295


# 변수 값 — 시트(:root 첫 블록) + 메인(.home)
VARS = dict(re.findall(r'(--sgb-[\w-]+): (#[0-9a-fA-F]{3,6})\b', T[:T.find('}')]))
hm = re.search(r'\.home \{([^}]*)\}', HC)
for k, v in re.findall(r'(--h[\w-]+): ([^;]+);', hm.group(1) if hm else ''):
    VARS[k] = v.strip()


def res(v, n=0):
    v = v.strip()
    m = re.fullmatch(r'var\((--[\w-]+)(?:,\s*[^)]*)?\)', v)
    if m and n < 5 and m.group(1) in VARS: return res(VARS[m.group(1)], n + 1)
    if re.fullmatch(r'#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}', v): return hexn(v)
    if v in ('white',): return '#ffffff'
    return None


# ① 주색 · 보라 · 글꼴
ok('주색 = 시트 브랜드 남색', hm and '--hv: var(--sgb-navy)' in hm.group(1) and VARS.get('--sgb-navy') == '#00245a', VARS.get('--hv', ''))
pur = sorted({h for h in re.findall(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', HC) if purple(h)})
pur_rgba = re.findall(r'rgba\((?:91, 61, 245|64, 48, 160|40, 34, 110|217, 210, 255|210, 200, 255)', HC)
ok('보라 계열 숫자 0(색 · 그림자)', not pur and not pur_rgba, f'{pur} {pur_rgba[:3]}')
ok('글꼴 — Pretendard 0 · 본문 나눔스퀘어 네오 · 제목 페이퍼로지',
   'Pretendard' not in HC and 'font-family: var(--sgb-font-body);' in hm.group(1) and ':where(.home) :where(h1, h2, h3) { font-family: var(--sgb-font-title); }' in HC, '')
ok('검색 단추 — 주황 바탕 + 남색 아이콘', 'background: var(--sgb-orange); color: var(--sgb-navy);' in HC and cr(VARS['--sgb-orange'], VARS['--sgb-navy']) >= 4.5,
   f"{cr(VARS['--sgb-orange'], VARS['--sgb-navy']):.2f}")

# ② 대비 — 한 규칙 안의 글자색 · 바탕색
BIG = ('.home-stc b em',)      # 27px · 굵기 800 — 큰 글자 기준 3.0
bad, seen = [], 0
for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', HC):
    sel = sel.strip()
    if '@' in sel: continue
    c = re.search(r'(?:^|;)\s*color:\s*([^;]+)', body)
    b = re.search(r'background(?:-color)?:\s*([^;]+)', body)
    if not (c and b): continue
    fc, bc = res(c.group(1)), res(b.group(1))
    if not (fc and bc): continue
    seen += 1
    need = 3.0 if sel in BIG else 4.5
    if cr(fc, bc) < need: bad.append(f'{sel} {fc}/{bc} {cr(fc, bc):.2f}')
# 바탕만 다른 규칙에 있는 자리(10/21 점검 — 메인 미달 13곳)
W = '#ffffff'
spots = [('쪽 번호(흰 글자)', W, res('var(--sgb-ink-3)')), ('상품 코드', res('var(--sgb-ink-3)'), W), ('흐린 회색 → 시트 흐린 글자', res('var(--sgb-ink-3)'), W),
         ('꼬리표 빨강 · HOT', W, '#e0001b'), ('꼬리표 파랑', W, res('var(--sgb-link)')), ('꼬리표 청록', W, res('var(--sgb-mall)')), ('꼬리표 남색', W, res('var(--hv)')),
         ('할인 %', '#e0001b', W), ('분류 글자 파랑', res('var(--sgb-link)'), W), ('창업 띠 꼬리표', W, '#c23a12'), ('준비 중 표시', res('var(--sgb-ink-3)'), W),
         ('안내 카드 광고주 · 이유(연한 남색 위)', res('var(--sgb-ink-2)'), res('var(--hv-t3)')), ('이건 어때? 설명(바탕 위)', res('var(--sgb-ink-2)'), res('var(--sgb-bg)'))]
low = [f'{n} {cr(a, b):.2f}' for n, a, b in spots if not (a and b and cr(a, b) >= 4.5)]
ok(f'대비 — 한 규칙 안 글자색 · 바탕색 {seen}곳 모두 기준 이상', seen >= 15 and not bad, f'{bad[:4]}')
ok('대비 — 10/21 점검의 메인 미달 자리 4.5 이상', not low, ' · '.join(f'{n} {cr(a, b):.2f}' for n, a, b in spots if a and b))
ok('쪽 번호 · 상품 코드 · 흐린 회색 — 시트 흐린 글자로', '.home-pno { background: var(--sgb-ink-3);' in HC and re.search(r'\.home-pcode \{ margin-left: 8px; font-size: 1[12]px; color: var\(--sgb-ink-3\); \}', HC)
   and '#7A868F' not in HC and '#B4B0C8' not in HC, '')


# ③ 아이콘
def png_px(path):
    d = open(path, 'rb').read(); i = 8; idat = b''; pal = None
    while i < len(d):
        ln, = struct.unpack('>I', d[i:i + 4]); t = d[i + 4:i + 8]; c = d[i + 8:i + 8 + ln]; i += 12 + ln
        if t == b'IHDR': w, h, bd, ct = struct.unpack('>IIBB', c[:10])
        elif t == b'PLTE': pal = [tuple(c[j:j + 3]) for j in range(0, len(c), 3)]
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
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                ln[x] = (ln[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        for x in range(w):
            if ct == 3: px.append(pal[ln[x]])
            elif ct in (2, 6): px.append(tuple(ln[x * bpp:x * bpp + 3]))
            else: px.append((ln[x * bpp],) * 3)
        prev = ln
    return px


D = os.path.join(K, 'site/public/home/d')
ICONS = ['core-1', 'core-2', 'core-4', 'sec-core', 'sec-forme', 'sec-need', 'sec-poll', 'sec-today', 'spark', 'spark-s', 'trust-2', 'promo-art']
left = {}
for n in ICONS:
    px = png_px(os.path.join(D, n + '.png'))
    k = sum(1 for p in px if purple('#%02x%02x%02x' % p))
    if k: left[n] = k
ok('아이콘 12장 — 보라 점 0', not left, str(left))
bags = png_px(os.path.join(D, 'poll-bags.png'))
ok('상품 사진(쇼핑백)은 그대로 — 보라 가방', sum(1 for p in bags if purple('#%02x%02x%02x' % p)) > 500, '')

# ④ 묶음
PC = strip(rd('site/src/styles/proto-common.css'))
ok('proto-common.css — 메인 묶음(.main-home 옛 값) 풀림', '.main-home {' not in PC and '--pp: #7C3AED' not in PC and 'body:has(.main-home)' not in PC, '')
PR = rd('spec/proto.html')
km = re.search(r'var SGB_KEEP = \{([^}]*)\}', PR)
keep = set(re.findall(r'"(\w+)":1', km.group(1))) if km else set()
ok('시안 — SGB_KEEP 에서 메인(main1 · main2) 빠짐 · 운영 화면은 그대로', km and not keep & {'main1', 'main2'} and 'adm' in keep and len(keep) >= 60, f'{len(keep)}개')

# ⑤ 시안
mx = re.search(r'<style id="mhx-style">\n(.*?)</style>', PR, flags=re.S)
MX = strip(mx.group(1)) if mx else ''
ok('시안 — 같은 CSS 고침', all(t in MX for t in ('--hv: var(--sgb-navy)', 'font-family: var(--sgb-font-body);', 'background: var(--sgb-orange); color: var(--sgb-navy);',
                                                ':where(.home) :where(h1, h2, h3) { font-family: var(--sgb-font-title); }')), '')
pur_p = sorted({h for h in re.findall(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', MX) if purple(h)})
ok('시안 — 메인 스타일에 보라 계열 숫자 0', MX and not pur_p, str(pur_p))
miss = [n for n in ICONS if base64.b64encode(open(os.path.join(D, n + '.png'), 'rb').read()).decode() not in PR]
ok('시안 — 다시 칠한 그림 12장이 실제 웹과 같음', not miss, str(miss))

ok('VERSION v10.56 이상', re.match(r'v10\.(5[6-9]|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
