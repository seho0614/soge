"""v10.64 시험 — 디자인 통일 5단계 ② 화면 코드(.tsx) 안 숫자 색(docs/120)

  KIT=… python3 -I test_v1064.py

  ① 사용자 웹 .tsx — style 안 글자색(color)에 숫자 색 0(흰색 빼고) · 오류 · 주의 글자는 상태 색 글자
  ② 파트너센터 KPI 아이콘 칸 6곳 — 시트 색 · 흰 아이콘 · ₩ 대비 4.5 이상
  ③ 그림 부품 · 로고 · 지도는 그대로(#14 ③)
"""
import glob, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def L(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


cr = lambda a, b: (max(L(a), L(b)) + .05) / (min(L(a), L(b)) + .05)
bad = []
for f in glob.glob(os.path.join(K, 'site/src/**/*.tsx'), recursive=True):
    for m in re.finditer(r"(?<![\w-])color:\s*'(#[0-9a-fA-F]{3,6})'", open(f, encoding='utf-8').read()):
        if m.group(1).lower() not in ('#fff', '#ffffff'): bad.append((os.path.relpath(f, K), m.group(1)))
ok('.tsx style 안 글자색 — 숫자 색 0(흰색 빼고)', not bad, str(bad[:4]))
ok('오류 · 주의 글자 — 상태 색 글자', "color: 'var(--sgb-rd-text)'" in rd('site/src/components/my/IntroAnswer.tsx') and "color: 'var(--sgb-rd-text)'" in rd('site/src/app/my/account/page.tsx')
   and rd('site/src/components/auth/SignupWizard.tsx').count("color: 'var(--sgb-or-text)'") == 2, '')
T = rd('site/src/styles/sgb-tokens.css')
val = lambda n: re.search(r'--sgb-' + n + r':\s*(#[0-9a-fA-F]{6})', T).group(1)
P = rd('site/src/app/partners/page.tsx')
tiles = re.findall(r"kpi\('(var\(--sgb-[\w-]+\))'", P) + re.findall(r"background: '(var\(--sgb-[\w-]+\))'", P)
names = [re.search(r'--sgb-([\w-]+)', t).group(1) for t in tiles]
ok('파트너센터 KPI 아이콘 칸 6곳 — 시트 색 · 흰 아이콘 4.5 이상', len(tiles) == 6 and all(cr(val(n), '#ffffff') >= 4.5 for n in names) and not re.search(r"kpi\('#", P),
   ' · '.join(f'{n} {cr(val(n), "#ffffff"):.2f}' for n in names))
art = len(re.findall(r'#[0-9a-fA-F]{3,6}\b', rd('site/src/components/health/ProductArt.tsx')))
ok('그림 부품 · 로고 · 지도 그대로', art >= 80 and '#2563EB' in rd('site/src/components/common/SiteHeader.tsx') and "strokeColor: '#1F5FD1'" in rd('site/src/components/map/KakaoMap.tsx'), f'상품 그림 색 {art}곳')
ok('VERSION v10.64 이상', re.match(r'v10\.(6[4-9]|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
