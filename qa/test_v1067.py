"""v10.67 시험 — 운영 화면(web/) 디자인 기준 ① 기준 파일 · 글꼴 · 색 · 상단바 · 대비(docs/123)

  KIT=… python3 -I test_v1067.py

  ① web/src/styles/sgb-tokens.css 가 사용자 웹 파일과 글자 그대로 같음 · main.tsx 가 tokens.css 앞에서 읽음
  ② 글꼴 — woff2 5개가 사용자 웹 파일과 같음 · admin-fonts.css 가 상대 주소로 가리킴 · 본문 --f 는 시트 본문 글꼴 · 숫자 --m 그대로
  ③ tokens.css — 보라 · 옛 회색 · 옛 화면 바탕 숫자 0 · 옛 이름이 시트 값을 가리킴
  ④ 상단바 — 남색 바탕 · 고른 메뉴 주황 + 남색 글자 · 남색 위 흐린 글자 대비 4.5 이상 (실제 운영 화면 · 시안 같이)
  ⑤ 대비 — 흐린 글자가 화면 바탕 · 연한 칸 모두에서 4.5 이상 · 화면 코드 안 #B42318 0
  ⑥ 시안 파트너센터 머리줄(.phd)은 그대로
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, mode='r'):
    p = os.path.join(K, rel)
    if not os.path.exists(p): return b'' if mode == 'rb' else ''
    return open(p, 'rb').read() if mode == 'rb' else open(p, encoding='utf-8').read()


def L(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


cr = lambda a, b: (max(L(a), L(b)) + .05) / (min(L(a), L(b)) + .05)
T = rd('site/src/styles/sgb-tokens.css')
val = lambda n: re.search(r'--sgb-' + n + r':\s*(#[0-9a-fA-F]{6})', T).group(1)
M = rd('web/src/main.tsx')
ok('① 기준 파일 사본 — 사용자 웹과 글자 그대로', T and rd('web/src/styles/sgb-tokens.css') == T, '')
ok('① main.tsx — sgb-tokens · admin-fonts 를 tokens.css 앞에서', 0 <= M.find("'./styles/sgb-tokens.css'") < M.find("'./styles/admin-fonts.css'") < M.find("'./styles/tokens.css'"), '')
F = ['Paperlogy-5Medium', 'Paperlogy-7Bold', 'NanumSquareNeo', 'NanumSquareNeoB', 'NanumSquareNeoEB']
same = [f for f in F if rd(f'web/src/assets/fonts/{f}.woff2', 'rb') and rd(f'web/src/assets/fonts/{f}.woff2', 'rb') == rd(f'site/public/fonts/{f}.woff2', 'rb')]
AF = rd('web/src/styles/admin-fonts.css')
ok('② 글꼴 파일 5개 — 사용자 웹과 같음 · 사용 조건 파일', len(same) == 5 and rd('web/src/assets/fonts/LICENSE.txt', 'rb') == rd('site/public/fonts/LICENSE.txt', 'rb'), f'{len(same)} / 5')
ok('② admin-fonts.css — 상대 주소 5개(Vite 가 /assets/ 로 묶음)', all(f"url('../assets/fonts/{f}.woff2')" in AF for f in F) and "url('/fonts/" not in AF, '')
TK = rd('web/src/styles/tokens.css')
ok('② 본문 글꼴 시트 · 숫자 IBM Plex Mono 그대로 · 제목 페이퍼로지', '  --f: var(--sgb-font-body);' in TK and re.search(r'--m:\s*"IBM Plex Mono"', TK) is not None
   and 'h1, h2, h3 { font-family: var(--sgb-font-title); }' in TK, '')
root = re.sub(r'/\*.*?\*/', '', TK[:TK.find('\n}')], flags=re.S)   # 설명 주석 안의 옛 값은 빼고
old = [h for h in ('#7C3AED', '#6D28D9', '#6B7280', '#E9EAEE', '#14171C', '#4F46E5', '#111827', '#4B5563', '#B42318', '#9A5B00', '#0F6B4A') if h in root]
ok('③ tokens.css — 보라 · 옛 회색 · 옛 바탕 · 옛 상태 색 숫자 0', not old, str(old))
alias = {'--pp': 'navy', '--shell': 'bg', '--ink-3': 'ink-3', '--danger': 'rd-text', '--ad': 'or-text', '--money': 'gr-text', '--ahd': 'navy', '--ahd-on': 'orange'}
bad = [k for k, v in alias.items() if not re.search(re.escape(k) + r':\s*var\(--sgb-' + v + r'\)', TK)]
ok('③ 옛 이름 → 시트 값', not bad, str(bad))
A = rd('web/src/styles/app.css')
ok('④ 상단바 — 고른 메뉴 주황 + 남색 글자 · 「운영」 주황 · 보라 숫자 0', '.ad-gnb button.on { background: var(--ahd-on); color: var(--sgb-navy); }' in A
   and '.ad-lg b { color: var(--sgb-orange);' in A and not re.search(r'#(A5B4FC|4F46E5|252B34|39414D|79828F)', A), '')
nv = val('navy')
ok('④ 남색 위 글자 대비 4.5 이상 — 메뉴 · 역할 #AEB6C2 · 주황 · 흰 글자', min(cr('#AEB6C2', nv), cr(val('orange'), nv), cr('#EDEFF3', nv)) >= 4.5,
   f"#AEB6C2 {cr('#AEB6C2', nv):.2f} · 주황 {cr(val('orange'), nv):.2f} · #EDEFF3 {cr('#EDEFF3', nv):.2f}")
P = rd('spec/proto.html')
ok('④ 시안 .ahd 도 같이 — 남색 · 고른 메뉴 주황 · 흐린 글자', '.ahd{background:var(--sgb-navy);' in P and '.ahd .agnb a.on{background:var(--sgb-orange);color:var(--sgb-navy)}' in P
   and '.ahd .alg b{color:var(--sgb-orange);' in P and '.ahd .ahr .ls{color:#AEB6C2}' in P and '#14171C;color:#EDEFF3' not in P, '')
i3 = val('ink-3')
bgs = {'화면 바탕': val('bg'), '흰': '#ffffff', '표 머리 #F9FAFB': '#f9fafb', '분홍 칸': '#fef2f2', '노랑 칸 #fdf6e3': '#fdf6e3', '연초록 칸 #e9f7ef': '#e9f7ef', '연파랑 칸': '#eff6ff'}
low = {k: round(cr(i3, b), 2) for k, b in bgs.items() if cr(i3, b) < 4.5}
ok('⑤ 흐린 글자 — 화면 바탕 · 연한 칸 모두 4.5 이상', not low, str(low) or f'최저 {min(cr(i3, b) for b in bgs.values()):.2f}')
tsx = ''.join(open(os.path.join(dp, f), encoding='utf-8').read() for dp, _, fs in os.walk(os.path.join(K, 'web/src')) for f in fs if f.endswith('.tsx'))
ok('⑤ 화면 코드 안 #B42318 · #eef2f7 0', not re.search(r"'#(B42318|eef2f7)'", tsx, re.I), '')
ok('⑤ 흰 글자 바탕 .ad-bg.hi — 4.5 이상', '.ad-bg.hi { background: var(--sgb-gr-text); color: #fff;' in A and cr(val('gr-text'), '#ffffff') >= 4.5, '')
ok('⑥ 시안 파트너센터 머리줄 그대로', '.phd{background:#0E2A23;' in P and '.phd .rsw button.on{background:#4F46E5;color:#fff}' in P, '')
ok('VERSION v10.67 이상', re.match(r'v10\.(6[7-9]|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
