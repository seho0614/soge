"""v10.55 시험 — 글자 대비 4.5 미달 고침(docs/108)

  KIT=… python3 -I test_v1055.py

  10/21 점검: 소개광장 · 소개몰 · 두 관 머리줄 · 소개장터 메인에 대비 4.5 미달 글자. 관 글자색(point-text)도 흰 바탕만 셈해
  관 연한 바탕(point-l — 고른 칩 · 배지 · 왼쪽 메뉴) 위에서는 4.1 이었습니다(v10.54 test 가 흰 바탕만 봄).

  ① 디자인 시트 — 다섯 관 모두 관 글자색이 흰 바탕 · 연한 바탕 둘 다에서 4.5 이상 · 관 색 바탕 위 글자도 4.5 이상
  ② 화면 CSS — 한 규칙에 글자색 · 바탕색을 숫자로 함께 적은 곳은 모두 4.5 이상 (소개광장 · 소개몰 · 두 관 · 소개장터 메인)
  ③ 고친 곳 — 흐린 글자 · 배지 · 알림 숫자
  ④ 시안 — 같은 값 · 디자인 시트 사본이 글자 그대로
"""
import os, re

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


def L(h):
    h = h.lstrip('#'); h = ''.join(c * 2 for c in h) if len(h) == 3 else h
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def cr(a, b):
    x, y = sorted([L(a), L(b)], reverse=True); return (x + .05) / (y + .05)


# ① 디자인 시트
T = rd('site/src/styles/sgb-tokens.css')
base = dict(re.findall(r'--sgb-([\w-]+): (#[0-9a-f]{6})', T.split('[data-sgb-gwan')[0]))
low, seen = [], []
for g, body in re.findall(r'\[data-sgb-gwan="(\w+)"\][^{]*\{([^}]*)\}', T):
    d = dict(base)
    for k, v in re.findall(r'--sgb-([\w-]+): (#[0-9a-f]{6}|var\(--sgb-[\w-]+\))', body):
        d[k] = d.get(v[10:-1]) if v.startswith('var') else v
    seen.append(g)
    for n, a, b in [('글자/흰', d['point-text'], '#ffffff'), ('글자/연한 바탕', d['point-text'], d['point-l']), ('관 색 바탕 위 글자', d['on-point'], d['point'])]:
        if cr(a, b) < 4.5:
            low.append(f'{g} {n} {cr(a, b):.2f}')
ok('디자인 시트 — 다섯 관 관 글자색이 흰 바탕 · 연한 바탕에서 4.5 이상 · 관 색 바탕 위 글자 4.5 이상', len(seen) == 5 and not low, f'{seen} {low}')
ok('디자인 시트 — 관 글자색 새 값(소개장터 #ad5800 · 소개몰 #117f3a · 소개광장 #c44002)',
   all(t in T for t in ('--sgb-point-text: #ad5800;', '--sgb-point-text: #117f3a;', '--sgb-point-text: #c44002;')), '')

# ② 화면 CSS — 글자색 · 바탕색을 함께 숫자로 적은 규칙
bad = []
for f in ('plaza.css', 'poll.css', 'food.css', 'shop.css', 'health.css', 'hlt26.css', 'b2.css', 'money.css'):
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', strip(rd('site/src/styles/' + f))):
        c = re.search(r'(?<![\w-])color\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b', body)
        b = re.search(r'background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b', body)
        if c and b and cr(c.group(1), b.group(1)) < 4.5:
            bad.append(f'{f} {sel.strip()[-30:]} {cr(c.group(1), b.group(1)):.2f}')
ok('화면 CSS — 글자색 · 바탕색을 함께 적은 규칙 모두 4.5 이상(소개광장 · 소개몰 · 두 관 · 소개장터 메인)', not bad, str(bad))

# ③ 고친 곳
PZ, FD, SH, B2, MN = (rd('site/src/styles/' + f) for f in ('plaza.css', 'food.css', 'shop.css', 'b2.css', 'money.css'))
ok('소개광장 — 「후기」 · 「맛집」 배지 · 맛집 「추천」 · 「광고」',
   'color: #a83701; }' in PZ and '.plz-bd-food   { background-color: #E8F6EE; color: #0e6e32; }' in PZ
   and '.fd-badge.pick { background: #E8F6EE; color: #0e6e32; }' in FD and '.fd-badge.ad { background: #FFF3E0; color: #a83701; }' in FD, '')
ok('소개몰 — 지운 정가 · 할인 전 가격 · 규격 = 시트 흐린 글자 · 사진 없음 = 설명 글자',
   SH.count('color: var(--sgb-ink-3)') >= 4 and '#9A9FAA' not in SH and '#A4A9B3; white-space' not in SH and 'color: #888' not in SH
   and '#EEF0F3 10px 20px); color: var(--sgb-ink-2);' in SH, '')
ok('소개몰 — 바닥 꼬리표 4.12 → 4.61', 'background: #e9f7ee; color: #117f3a;' in SH and cr('#117f3a', '#e9f7ee') >= 4.5, f"{cr('#117f3a', '#e9f7ee'):.2f}")
ok('머리줄 알림 숫자 — 빨강 바탕 #e0001b(흰 글자 5.02)', re.search(r'background: #e0001b; color: #fff; font-size: 11(\.5)?px;', B2) and re.search(r'background: #e0001b; color: #fff; font-size: 11(\.5)?px;', MN) and '#ff1022' not in B2 + MN, '')
ok('소개장터 메인 — 주황 꼬리표', '.mny-tag.is-orange { background: #fef3e0; color: #ad5800; }' in MN, '')

# ④ 시안
PR = rd('spec/proto.html')
ok('시안 — 디자인 시트 사본 = 실제 웹 sgb-tokens.css 글자 그대로', T.strip() and T.strip() in PR, '')
ok('시안 — money.css 사본에 같은 고침', '.mny-tag.is-orange { background: #fef3e0; color: #ad5800; }' in PR and '#ff1022' not in PR, '')
ok('시안 — 소개광장 · 소개몰 같은 고침',
   '.plz-bd-review { background-color: #FEF3E0; color: #a83701; }' in PR and 'background: #e9f7ee; color: #117f3a;' in PR
   and '#9A9FAA' not in PR and 'color: #A4A9B3; white-space' not in PR, '')

ok('VERSION v10.55 이상', re.match(r'v10\.(5[5-9]|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
doc = rd('docs/108_글자대비_고침_v10.55_20261021.md')
ok('작업 문서 docs/108', all(h in doc for h in ('## 1. 결론', '## 3. 바뀐 파일', '## 4. 집 PC 확인')), '')

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
raise SystemExit(0 if n_ok == len(RES) else 1)
