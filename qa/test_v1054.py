"""v10.54 시험 — 디자인 통일 2단계 B(docs/107) · 묶어 둔 화면(소개광장 · 소개몰 · 소개장터 메인 · 생활금융 상담)을 시트로

  KIT=… python3 -I test_v1054.py

  10/21 대표 결정: 메인(hero)은 이번엔 빼기 · 소개광장 강조색은 시트 관 색(제목은 브랜드 남색)

  ① 전수 — 사용자 웹 CSS 전체(메인 home.css 만 빼고)에서 글자 · 테두리 · 주색 · 링크 · 글꼴 · 두 관 색 이름을 숫자로 다시 정의하는 곳 0
     (예외: tokens.css 의 처음 값(별칭 블록이 덮어씀) · proto-common.css 의 메인 묶음 · 할인 빨강 --shop-red · 폭 --b2-w)
  ② Pretendard 글꼴이 메인 밖 CSS 에 0
  ③ 관 표시 · 묶음 · 화면별 색
  ④ 대비(흰 바탕 · 그 위 글자) — 시트 값으로 셈
  ⑤ 시안 — 같은 고침 · 묶음 풀기 · 관 표시
"""
import glob, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
ST = os.path.join(K, 'site/src/styles')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


strip = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)
NAMES = (r'--(?:pp|pp-d|pp-l|pp-l2|ink|ink2|ink-2|ink3|ink-3|line|line2|line-2|bl|bl-d|bl-l|accent|accent-w|f|shell|surface|mink|mink2|mink3|mline|mline2'
         r'|pt-ink|pt-ink2|pt-ink3|pt-line|pt-line2|pt-pp|pt-pp-d|pt-bl-l|b2-navy|b2-orange|b2-ink|b2-dim|b2-line|plz-navy|plz-pt|plz-orange|plz-line|plz-dim'
         r'|shop-navy|shop-green|shop-orange|shop-dim|shop-ink)')

# ① 전수
bad = []
for f in sorted(glob.glob(os.path.join(ST, '*.css'))):
    b = os.path.basename(f)
    if b in ('sgb-tokens.css', 'noto-sans-kr.css', 'home.css'):
        continue
    s = strip(open(f, encoding='utf-8').read())
    if b == 'tokens.css':
        s = s[s.find('}') + 1:]
    if b == 'proto-common.css':
        s = re.sub(r'(?m)^\.main-home \{[^}]*\}', '', s)
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', s):
        for k, v in re.findall(rf'(?<![\w-])({NAMES})\s*:\s*([^;]+)', body):
            if not v.strip().startswith('var(--sgb-'):
                bad.append(f'{b} {sel.strip()[-30:]} {k}: {v.strip()[:20]}')
ok('사용자 웹 CSS(메인 밖) — 글자 · 테두리 · 주색 · 링크 · 글꼴 · 두 관 색 이름을 숫자로 다시 정의하는 곳 0', not bad, f'{len(bad)} {bad[:4]}')

# ② Pretendard
pre = [os.path.basename(f) for f in glob.glob(os.path.join(ST, '*.css'))
       if os.path.basename(f) not in ('sgb-tokens.css', 'home.css') and 'Pretendard' in strip(open(f, encoding='utf-8').read())]
ok('Pretendard 글꼴 — 메인 밖 CSS 에 0(본문 나눔스퀘어 네오)', not pre, str(pre))

# ③ 관 표시 · 묶음 · 화면별
C = rd('site/src/components/Chrome.tsx')
ok('Chrome.tsx — 메인만 빼고 관 표시(소개광장 · 소개몰 · 소개장터 메인 포함)', "const g = s === 'home' ? undefined : sgbGwanOf(p);" in C and 'data-sgb-gwan={g}' in C and "data-sgb-gwan=\"shop\"><div className=\"shop-sub\">" in C, '')
ok('Chrome.tsx — 두 관 머리줄(B2Tone)에도 관 표시', 'data-b2-tone={t} data-sgb-gwan={t}' in C, '')
PC = strip(rd('site/src/styles/proto-common.css'))
ok('proto-common.css — 묶음은 메인(.main-home)만 · 소개광장 · 소개몰 · 생활금융 상담 풀림',
   '.main-home {' in PC and '--pp: #7C3AED;' in PC and not re.search(r'\.main-b2|\.mal-narrow|\.b2-hd|\.b2-ft', PC), '')
PZ = rd('site/src/styles/plaza.css')
ok('소개광장 — 탭 · 단추 · 링크 = 관 색(--plz-pt) · 제목 = 남색 · 글쓰기 = 관 색 바탕 + 남색 글자',
   '--plz-pt: var(--sgb-point-text)' in PZ and '--plz-orange: var(--sgb-point)' in PZ
   and '.plz-tabs a[aria-current=page] { background-color: var(--plz-pt);' in PZ and '.plz .btn-primary { background: var(--plz-pt);' in PZ
   and 'color: var(--plz-navy); margin: 0 0 8px;' in PZ and 'background-color: var(--plz-orange); color: var(--sgb-on-point); font-size: 22px;' in PZ, '')
V55 = re.match(r'v10\.(5[5-9]|[6-9]\d)', rd('VERSION').strip()) is not None    # v10.55 대비 고침(test_v1055 가 봄)
ok('소개광장 — 분류 배지 색은 그대로', V55 or '.plz-bd-review { background-color: #FEF3E0; color: #F78013; }' in PZ, 'v10.55 대비 고침 뒤 — test_v1055' if V55 else '')
SH = rd('site/src/styles/shop.css')
ok('소개몰 — 초록 = 시트 소개몰 글자색 · 할인 빨강 · 구역 바탕 그대로',
   '--shop-green: var(--sgb-point-text)' in SH and '--shop-red: #E5362F' in SH and '.shop-sec.cream { background: #FDF5E8; }' in SH, '')
ok('소개몰 — 머리줄 「무료 회원가입」 · 바닥 꼬리표', '[data-b2-tone=shop] .b2-join { background: var(--sgb-point-text); }' in SH and (V55 or 'background: #e9f7ee; color: #12883e;' in SH), '')
ok('두 관 머리 · 바닥줄 — 시트 값 · 본문 글꼴', '--b2-dim: var(--sgb-ink-3)' in rd('site/src/styles/b2.css') and 'font-family: var(--sgb-font-body);' in rd('site/src/styles/b2.css'), '')
ok('생활금융 상담 — .mal-proto 관 색이 먹음(묶음 없음)', '.mal-proto { --accent: var(--sgb-point-text); --accent-w: var(--sgb-point-l); }' in rd('site/src/styles/mal.css'), '')
ok('메인(home.css)은 그대로 — 보라 #5B3DF8', '--hv: #5B3DF8' in rd('site/src/styles/home.css'), '')

# ④ 대비
T = rd('site/src/styles/sgb-tokens.css')


def L(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def cr(a, b):
    x, y = sorted([L(a), L(b)], reverse=True); return (x + .05) / (y + .05)


def gv(g, k):
    m = re.search(rf'\[data-sgb-gwan="{g}"\][^{{]*\{{[^}}]*--sgb-{k}: (#[0-9a-f]{{6}})', T)
    return m and m.group(1)


navy = re.search(r'--sgb-navy: (#[0-9a-f]{6})', T).group(1)
plaza = re.search(r'--sgb-plaza: (#[0-9a-f]{6})', T).group(1)
ink3 = re.search(r'--sgb-ink-3: (#[0-9a-f]{6})', T).group(1)
pairs = [('소개광장 글자 #d24502 / 흰 바탕', gv('plaza', 'point-text'), '#ffffff'), ('소개광장 바탕 위 남색 글자', navy, plaza),
         ('소개몰 글자 / 흰 바탕', gv('shop', 'point-text'), '#ffffff'), ('흐린 글자 / 흰 바탕', ink3, '#ffffff')]
low = [f'{n} {cr(a, b):.2f}' for n, a, b in pairs if not (a and b and cr(a, b) >= 4.5)]
ok('대비 4.5 이상 — 소개광장 · 소개몰 글자 · 글쓰기 단추 · 흐린 글자', not low, ' · '.join(f'{n} {cr(a, b):.2f}' for n, a, b in pairs if a and b))

# ⑤ 시안
PR = rd('spec/proto.html')
km = re.search(r'var SGB_KEEP = \{([^}]*)\}', PR)
keep = set(re.findall(r'"(\w+)":1', km.group(1))) if km else set()
ok('시안 — 묶어 둔 화면은 메인 히어로 · 운영 화면만(소개광장 · 소개몰 · 소개장터 메인 풀림)',
   km and {'main1', 'main2'} <= keep and not keep & {'cmu', 'cmud', 'cmuw', 'cmupoll', 'commu', 'list', 'HLT_FOOD', 'cart'}, f'{len(keep)}개')
ok('시안 — 관 표시(소개광장 plaza · 소개몰 shop · 소개장터 메인 money)', '"cmu":"plaza"' in PR and '"cart":"shop"' in PR and '"list":"money"' in PR and '(SGB_G[key] || "")' in PR, '')
ok('시안 — 실제 웹과 같은 CSS 고침', all(t in PR for t in (
    '--plz-pt: var(--sgb-point-text)', '.plz-tabs a[aria-current=page] { background-color: var(--plz-pt);', '--b2-dim: var(--sgb-ink-3)',
    '--shop-green: var(--sgb-point-text)', '[data-b2-tone=shop] .b2-join { background: var(--sgb-point-text); }',
    '.plz { font-family: var(--sgb-font-body); }', '[data-b2-tone=money] .b2-hd { --b2-orange: var(--sgb-orange);')), '')
ok('시안 — 옛 값 남지 않음', '--plz-navy: #00245A' not in PR and '--shop-green: #17A34A' not in PR and '--b2-dim: #838CA5' not in PR, '')

ok('VERSION v10.54 이상', re.match(r'v10\.(5[4-9]|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
doc = rd('docs/107_디자인통일_2단계B_v10.54_20261021.md')
ok('작업 문서 docs/107', all(h in doc for h in ('## 1. 결론', '## 3. 바뀐 파일', '## 4. 집 PC 확인')), '')

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
raise SystemExit(0 if n_ok == len(RES) else 1)
