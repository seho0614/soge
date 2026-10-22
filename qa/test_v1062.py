"""v10.62 시험 — 디자인 통일 4단계: 단추 3종(docs/118)

  KIT=… python3 -I test_v1062.py

  ① 단추 값(sgb-buttons.css · layout.tsx 가 시트 다음에 불러옴) — 높이 40 · 작은 32 · 모서리 = 시트 sm · 14 · 13px · 굵게 · 주요 · 보조 · 줄 색 · 새 화면용 .sgb-btn 3종
  ② 사용자 웹 CSS 전수 — 단추 30종(+ 꾸밈 이름)의 규칙에서 바탕 · 글자 · 테두리 색과 모서리가 시트 단추 값만(고른 · 꺼진 · 위험 표시는 뺌)
  ③ 대비 — 다섯 관 × 주요 단추(관 색 위 관 단추 글자) · 줄 단추(흰 바탕 위 관 글자색) · 보조 단추 4.5 이상
  ④ 그대로 — 메인 동그란 검색 단추 · 꺼진 · 위험 · 고른 상태
  ⑤ 시안 — 같은 값 · sgb-buttons.css 글자 그대로
"""
import glob, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
ST = os.path.join(K, 'site/src/styles')
SKIP = {'sgb-tokens.css', 'noto-sans-kr.css', 'money-fonts.css'}
PRI = {'btn-primary', 'cta-primary', 'pt-bp', 'my-bp', 'w1-bp', 'gw-bp', 'pc-bp', 'mal-btn', 'fd-cta', 'bar-go', 'b2-join', 'gw-go', 'w1-bor', 'mny-band-cta'}
SEC = {'pt-bo', 'my-bo', 'w1-bo', 'gw-bo', 'pc-bo', 'cta-secondary', 'bar-btn', 'btn-call', 'hlt-btn', 'home-pill', 'btn-sm'}
LINE = {'btn-q'}
STATE = {'on', 'gw-on', 'is-on', 'sel', 'off', 'gw-off', 'done', 'gw-done', 'bar-blocked', 'blocked', 'danger', 'p2danger'}
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


strip = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)
T = strip(rd('site/src/styles/sgb-tokens.css'))
B = strip(rd('site/src/styles/sgb-buttons.css'))
ok('시트 단추 값 — 40 · 32px · 시트 sm 모서리 · 14 · 13px · 굵게 · 3종 색 · .sgb-btn', all(t in B for t in (
    '--sgb-btn-h: 40px;', '--sgb-btn-h-sm: 32px;', '--sgb-btn-r: var(--sgb-r-sm);', '--sgb-btn-fs: 14px;', '--sgb-btn-fs-sm: 13px;', '--sgb-btn-fw: 700;',
    '--sgb-btn-bg: var(--sgb-point); --sgb-btn-fg: var(--sgb-on-point);', '--sgb-btn2-fg: var(--sgb-navy); --sgb-btn2-line: var(--sgb-line);', '--sgb-btn3-fg: var(--sgb-point-text);',
    '.sgb-btn--pri {', '.sgb-btn--sec {', '.sgb-btn--line {')) and "import '@/styles/sgb-buttons.css';" in rd('site/src/app/layout.tsx'), 'sgb-buttons.css · layout.tsx')


def last(part):
    return re.split(r'\s*[\s>+~]\s*', re.sub(r'\([^)]*\)', lambda m: m.group(0).replace(' ', ''), part.strip()))[-1]


def audit(css, extra=frozenset()):
    bad, n = [], 0
    for sel, body in re.findall(r'([^{}]*)\{([^{}]*)\}', css):
        parts = [p for p in sel.split(',') if p.strip()]
        comps = [last(p) for p in parts]
        def isbtn(c):
            bare = re.sub(r':not\([^)]*\)', '', c)
            cl = set(re.findall(r'\.([\w-]+)', c))
            return cl & (PRI | SEC | LINE | extra | {'mny-btn'}) and not cl & STATE and '::' not in bare and ':disabled' not in bare
        if not parts or not all(isbtn(c) for c in comps): continue
        if all(set(re.findall(r'\.([\w-]+)', c)) == {'mny-btn'} for c in comps): continue   # 꾸밈 없는 .mny-btn 은 크기 틀
        n += 1
        for prop, v in re.findall(r'(?<![\w-])(background(?:-color)?|color|border-color|border-radius)\s*:\s*([^;]+)', body):
            v = v.replace('!important', '').strip()
            if prop == 'border-radius':
                if 'var(--sgb-btn-r' not in v: bad.append(f'{sel.strip()[:40]} {prop}: {v[:30]}')
            elif not (v.startswith('var(--sgb-btn') or v in ('none', 'transparent', 'inherit')):
                bad.append(f'{sel.strip()[:40]} {prop}: {v[:30]}')
    return bad, n


bad, n = [], 0
for f in sorted(glob.glob(os.path.join(ST, '*.css'))):
    if os.path.basename(f) in SKIP | {'sgb-buttons.css'}: continue
    b, c = audit(strip(open(f, encoding='utf-8').read())); bad += [(os.path.basename(f), x) for x in b]; n += c
ok(f'사용자 웹 — 단추 규칙 {n}곳의 색 · 모서리가 시트 단추 값만', not bad and n >= 70, str(bad[:4]))


def hexof(name, scope=T):
    m = re.search(r'--' + name + r':\s*(#[0-9a-fA-F]{6})', scope); return m and m.group(1).lower()


def L(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def cr(a, b):
    x, y = sorted([L(a), L(b)], reverse=True); return (x + .05) / (y + .05)


navy, line = hexof('sgb-navy'), hexof('sgb-line')
base = {'money': hexof('sgb-money'), 'mall': hexof('sgb-mall'), 'biz': hexof('sgb-biz'), 'shop': hexof('sgb-shop'), 'plaza': hexof('sgb-plaza')}
rows, low = [('공통 · 메인 주요', navy, '#ffffff')], []
for g, pt in base.items():
    blk = re.search(r'\[data-sgb-gwan="' + g + r'"\][^{]*\{([^}]*)\}', T).group(1)
    on = '#ffffff' if '--sgb-on-point: #ffffff' in blk else navy
    tx = re.search(r'--sgb-point-text:\s*(#[0-9a-f]{6}|var\(--sgb-(\w+)\))', blk)
    txt = tx.group(1) if tx.group(1).startswith('#') else base.get(tx.group(2)) or hexof('sgb-' + tx.group(2))
    rows += [(f'{g} 주요', pt, on), (f'{g} 줄', txt, '#ffffff')]
rows.append(('보조', navy, '#ffffff'))
low = [f'{a} {cr(b, c):.2f}' for a, b, c in rows if cr(b, c) < 4.5]
ok('대비 — 다섯 관 주요 · 줄 · 보조 단추 4.5 이상', not low, ' · '.join(f'{a} {cr(b, c):.2f}' for a, b, c in rows))

MN, HM, GW = rd('site/src/styles/money.css'), rd('site/src/styles/home.css'), rd('site/src/styles/proto-gwan.css')
ok('소개장터 「채우기」 단추 — 주황 바탕 흰 글자(대비 2.0) → 관 색 + 관 단추 글자', re.search(r'\.mny-btn\.is-fill \{ background: var\(--sgb-btn-bg[^}]*color: var\(--sgb-btn-fg', MN) is not None, '')
ok('그대로 — 메인 동그란 검색 단추 · 꺼진 · 위험 표시', 'border-radius: 50%; border: 0; cursor: pointer; background: var(--sgb-orange); color: var(--sgb-navy);' in HM
   and '.gw .gw-abar .gw-go.gw-off{background:var(--g500)' in GW and '.btn-sm.p2danger { background: #B42318;' in rd('site/src/styles/site.css') + rd('site/src/styles/partners.css'), '')

PR = rd('spec/proto.html')
ok('시안 — 단추 값 = 실제 웹 sgb-buttons.css 글자 그대로(<style id="sgb-btn-style">)', rd('site/src/styles/sgb-buttons.css') and '<style id="sgb-btn-style">\n' + rd('site/src/styles/sgb-buttons.css') + '</style>' in PR, '')
pb, pn = [], 0
for blk in re.findall(r'<style(?! id="sgb-btn-style")[^>]*>(.*?)</style>', PR, flags=re.S):
    b, c = audit(strip(blk), frozenset({'bp', 'bo', 'bor'})); pb += b; pn += c
ok(f'시안 — 단추 규칙 {pn}곳의 색 · 모서리가 시트 단추 값만', not pb and pn >= 25, str(pb[:4]))
ok('VERSION v10.62 이상', re.match(r'v10\.(6[2-9]|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
