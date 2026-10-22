"""v10.66 시험 — 디자인 통일 6단계 ① 시안 파트너센터 대시보드(p2dsh) 화면 코드 안 글자색(docs/122)

  KIT=… python3 -I test_v1066.py

  ① p2dsh 화면 문자열 — style 안 글자색에 흰 바탕 4.5 미달 숫자 색 0(남색 띠 위 ✔ 3곳 · 띠 위 밝은 글자 빼고)
  ② 바꾼 값 — 흐린 글자 25 · 초록 글자 13 · 금색 1 · 꼬리표 바탕(소개몰 2 · 빨강 3) · 쓰는 토큰이 시안 안에 정의돼 있고 대비 4.5 이상
  ③ 그대로 — 남색 띠 위 글자 · ✔ 3곳 · 막대 2곳 · 아이콘 선
  ④ 실제 웹 partners.css 꼬리표 바탕 · 흰 글자 4.5 이상
  ⑤ p2dsh 밖 시안은 그대로(이번 판의 고침이 다른 화면에 닿지 않음 — 옛 색 개수로 확인)
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def L(h):
    h = h.lstrip('#'); h = ''.join(c * 2 for c in h) if len(h) == 3 else h
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


cr = lambda a, b: (max(L(a), L(b)) + .05) / (min(L(a), L(b)) + .05)
P = rd('spec/proto.html')
A = 'var html = "<div style=\\"width: 1440px; height: 1560px;'
i = P.find(A); D = P[i:P.find('\n', i)] if i >= 0 else ''
ok('p2dsh 화면 문자열 하나', P.count(A) == 1 and len(D) > 100000, f'{len(D)}자')
styles = re.findall(r'style=\\"([^"\\]*)\\"', D)
NAVY = {'#C3CCE3', '#93A2C2', '#5B8CFF', '#DCE3F5'}          # 남색 띠(#101E3E · #1A2C52) 위 — 잰 대비 5.2 ~ 10.7
bad = []
for st in styles:
    for m in re.finditer(r'(?:^|;)\s*color\s*:\s*(#[0-9A-Fa-f]{3,6})\b', st):
        h = m.group(1).upper()
        if h in ('#FFF', '#FFFFFF') or h in NAVY or st == 'color:#12B886;' or cr(h, '#ffffff') >= 4.5: continue
        bad.append(st[:60])
ok('① style 안 글자색 — 흰 바탕 4.5 미달 0', not bad, str(bad[:3]))
T = rd('site/src/styles/sgb-tokens.css')
val = lambda n: re.search(r'--sgb-' + n + r':\s*(#[0-9a-fA-F]{6})', T).group(1)
cnt = {k: D.count(k) for k in ('color: var(--sgb-ink-3)', 'color:var(--sgb-ink-3)', 'color: var(--sgb-gr-text)', 'color:var(--sgb-gr-text)', '#986f09')}
ink = cnt['color: var(--sgb-ink-3)'] + cnt['color:var(--sgb-ink-3)']; gr = cnt['color: var(--sgb-gr-text)'] + cnt['color:var(--sgb-gr-text)']
ok('② 바꾼 글자 — 흐린 글자 25 · 초록 글자 13 · 금색 1', (ink, gr, cnt['#986f09']) == (25, 13, 1), f'{ink} · {gr} · {cnt["#986f09"]}')
ok('② 꼬리표 바탕 — 소개몰 2 · 빨강 글자색 3 (흰 글자)', D.count('background:var(--sgb-mall)') + D.count('background: var(--sgb-mall)') == 2
   and D.count('background: var(--sgb-rd-text)') + D.count('background:var(--sgb-rd-text)') == 3, '')
defs = all(re.search(r'--sgb-' + n + r':\s*#', P) for n in ('ink-3', 'gr-text', 'rd-text', 'mall'))
c = {n: cr(val(n), '#ffffff') for n in ('ink-3', 'gr-text', 'rd-text', 'mall')}
ok('② 토큰이 시안 안에 정의 · 흰색과 대비 4.5 이상', defs and all(v >= 4.5 for v in c.values()) and cr('#986f09', '#ffffff') >= 4.5,
   ' · '.join(f'{k} {v:.2f}' for k, v in c.items()) + f' · 금색 {cr("#986f09", "#ffffff"):.2f}')
ok('② 흐린 글자 · 초록 글자 — 연회색 · 연초록 칸에서도 4.5 이상', cr(val('ink-3'), '#f4f6fa') >= 4.5 and cr(val('gr-text'), '#eafbf4') >= 4.5,
   f'{cr(val("ink-3"), "#f4f6fa"):.2f} · {cr(val("gr-text"), "#eafbf4"):.2f}')
ok('③ 그대로 — 띠 위 ✔ 3 · 막대 2 · 아이콘 선 2 · 띠 위 밝은 글자', D.count('style=\\"color:#12B886;\\"') == 3 and len(re.findall(r'width: \d+%; height: 100%; background: #12B886', D)) == 2
   and D.count('stroke=\\"#6E7A96\\"') == 2 and D.count('#C3CCE3') >= 10, '')
C = rd('site/src/styles/partners.css')
ok('④ 실제 웹 꼬리표 바탕 — 흰 글자 4.5 이상', '.p2pc .tag.hot { background: var(--sgb-rd-text); }' in C and '.p2pc .tag.high { background: var(--sgb-mall); }' in C
   and not re.search(r'\.tag\.(hot|high) \{ background: #', C), '')
rest = P.replace(D, '') if D else P
old = tuple(rest.count(k) for k in ('#6E7A96', '#9AA5BE', '#12B886', '#B8860B', '#F04438'))
ok('⑤ p2dsh 밖 시안 그대로 — 옛 색 개수(v10.65 와 같음)', old == (1, 0, 0, 0, 1), f'#6E7A96 · #9AA5BE · #12B886 · #B8860B · #F04438 = {old}')
ok('VERSION v10.66 이상', re.match(r'v10\.(6[6-9]|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
