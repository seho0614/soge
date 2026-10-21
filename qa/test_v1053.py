"""v10.53 시험 — 디자인 통일 2단계 A(docs/106) · v10.52 에서 놓친 것

  KIT=… python3 -I test_v1053.py

  v10.52 는 기준 파일(tokens.css)만 바꿨는데, 관 화면(.gw) · 나의공간(.mys) · 본인인증(.w1-vfy) · 파트너센터(.pt-root)가
  틀 안에서 같은 이름을 숫자로 다시 정의하고 있어 1단계가 닿지 않았습니다. 그 정적 시험(test_v1052)은 기준 파일만 봤습니다.

  ① 전수 — 사용자 웹 CSS 전체에서 「글자 · 테두리 · 주색 · 링크 · 본문 글꼴」 이름을 숫자로 다시 정의하는 곳이 0
     (예외: tokens.css 의 처음 값(아래 별칭 블록이 덮어씀) · proto-common.css 의 묶어 둔 화면 · 2단계 B 대상 파일(b2 · plaza · shop · hlt26 · money))
  ② 다섯 틀 — 시트 값 이름을 가리킴 · 상태 색 · 회색은 그대로
  ③ 묶어 둔 화면(2단계 B)은 그대로 · 시안과 실제 웹이 같은 규칙
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


NAMES = r'--(?:pp|pp-d|pp-l|pp-l2|ink|ink2|ink-2|ink3|ink-3|line|line2|line-2|bl|bl-d|bl-l|accent|accent-w|f|shell|surface|mink|mink2|mink3|mline|mline2|pt-ink|pt-ink2|pt-ink3|pt-line|pt-line2|pt-pp|pt-pp-d|pt-bl-l)'
LATER = {'b2.css', 'plaza.css', 'shop.css', 'hlt26.css', 'money.css'}     # 2단계 B — 제 디자인을 맞춰 둔 화면
strip = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)

# ① 전수
bad = []
for f in sorted(glob.glob(os.path.join(ST, '*.css'))):
    b = os.path.basename(f)
    if b in LATER or b in ('sgb-tokens.css', 'noto-sans-kr.css'):
        continue
    s = strip(open(f, encoding='utf-8').read())
    if b == 'tokens.css':
        s = s[s.find('}') + 1:]                   # 처음 :root(옛 값) 다음부터 — 별칭 블록이 덮어씀
    if b == 'proto-common.css':
        s = re.sub(r'\.main-home, \.main-b2, \.b2-hd, \.b2-ft, \.mal\.mal-narrow \{[^}]*\}', '', s)   # 묶어 둔 화면
        s = re.sub(r'(?m)^\.main-home \{[^}]*\}', '', s)                                                # v10.54 부터 메인만 묶음
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', s):
        for k, v in re.findall(rf'(?<![\w-])({NAMES})\s*:\s*([^;]+)', body):
            if not v.strip().startswith('var(--sgb-'):
                bad.append(f'{b} {sel.strip()[-30:]} {k}: {v.strip()[:20]}')
ok('사용자 웹 CSS — 글자 · 테두리 · 주색 · 링크 · 글꼴 이름을 숫자로 다시 정의하는 곳 0', not bad, f'{len(bad)} {bad[:4]}')

# ② 다섯 틀
G = strip(rd('site/src/styles/proto-gwan.css'))
gw = G[G.find('.gw{'):G.find('}', G.find('.gw{'))]
ok('관 화면(.gw) — 주색 · 링크 · 글자 · 테두리 · 바탕 · 글꼴 · 그림자 = 시트', all(f'{k}:var(--sgb-{v})' in gw for k, v in [
    ('--pp', 'point-text'), ('--pp-d', 'point-d'), ('--bl', 'link'), ('--ink', 'ink'), ('--ink2', 'ink-2'), ('--ink3', 'ink-3'),
    ('--line', 'line'), ('--line2', 'line-soft'), ('--shell', 'bg'), ('--f', 'font-body'), ('--sh2', 'shadow-up')]), '')
ok('관 화면(.gw) — 상태 색 · 회색 · 차트 색은 그대로', all(t in gw for t in ('--or:#F97316', '--gr:#10B981', '--rd:#EF4444', '--g400:#9CA3AF', '--s2:#0D9488', '--card:#FFFFFF')), '')
M = strip(rd('site/src/styles/proto-my.css'))
ok('나의공간(.mys) — 주색 · 글자 · 테두리 = 시트', all(t in M for t in ('--pp: var(--sgb-point-text)', '--mink: var(--sgb-ink)', '--mink3: var(--sgb-ink-3)', '--mline: var(--sgb-line)')), '')
ok('본인인증(.w1-vfy) — 글자 · 테두리 = 시트', '.w1-vfy { --mink: var(--sgb-ink); --mink2: var(--sgb-ink-2); --mink3: var(--sgb-ink-3); --mline: var(--sgb-line);' in rd('site/src/styles/proto-w1.css'), '')
P = rd('site/src/styles/proto-partner.css')
ok('파트너센터(.pt-root) — 주색 · 글자 · 테두리 · 바탕 = 시트 · 전용 상단바 그대로', '--pt-pp: var(--sgb-point-text)' in P and '--pt-ink: var(--sgb-ink)' in P and 'body:has(.pt-root) { background: var(--sgb-bg); }' in P and '.pt-hd { background: #0E2A23;' in P, '')
ok('상담 신청(.mal-proto) — 보라 → 관 색', '.mal-proto { --accent: var(--sgb-point-text); --accent-w: var(--sgb-point-l); }' in rd('site/src/styles/mal.css'), '')

# ③ 묶어 둔 화면 · 시안
PC = rd('site/src/styles/proto-common.css')
B = re.match(r'v10\.(5[4-9]|[6-9]\d)', rd('VERSION').strip()) is not None    # v10.54 2단계 B 에서 묶음을 풂(test_v1054 가 봄)
ok('묶어 둔 화면(메인 · 소개광장 · 소개몰 · 소개장터 메인 · 생활금융 상담)은 그대로', B or ('.main-home, .main-b2, .b2-hd, .b2-ft, .mal.mal-narrow {' in PC and '--pp: #7C3AED;' in PC), '2단계 B 뒤 — test_v1054' if B else '')
ok('생활금융 상담 — 묶음(.mal.mal-narrow 점수 2)이 .mal-proto(점수 1)보다 셈', B or '.mal.mal-narrow' in PC, '2단계 B 뒤 — test_v1054' if B else '')
PR = rd('spec/proto.html')
ok('시안 — 같은 규칙(#screen[data-sgb] 별칭)이 그대로', '#screen[data-sgb] { --f: var(--sgb-font-body); font-family: var(--sgb-font-body); }' in PR, '')
ok('VERSION v10.53 이상', re.match(r'v10\.(5[3-9]|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
doc = rd('docs/106_디자인통일_2단계A_v10.53_20261021.md')
ok('작업 문서 docs/106', all(h in doc for h in ('## 1. 결론', '## 2. 바로잡은 것', '## 4. 집 PC 확인')), '')

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
raise SystemExit(0 if n_ok == len(RES) else 1)
