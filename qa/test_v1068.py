"""v10.68 시험 — 운영 화면(web/) 디자인 기준 ② 글자 크기 · 모서리 · 그림자 · 화면 폭 · 단추 3종(docs/124)

  KIT=… python3 -I test_v1068.py

  ① 글자 — CSS · 화면 코드의 px 글자 크기가 시트 8단계(12 · 13 · 14 · 16 · 18 · 20 · 24 · 30)뿐 · 예외 2곳(건수 11 · ▼ 10) · --fs-lg 14 · --fs-xl 20
  ② 모서리 — px 값은 7 · 11 · 999 뿐 · 그림자는 시트 이름
  ③ 화면 폭 — @media 는 640 · 900 · 1240 뿐 · --bp-tablet 900 · --bp-desktop 1240
  ④ 단추 — sgb-buttons.css 가 사용자 웹과 같은 사본 · main.tsx 가 읽음 · 옛 이름 정의는 「단추 3종」 한 곳 · 주요 · 보조 · 줄 · 작게 · 작게 + 주요 올려놓기
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


A = rd('web/src/styles/app.css'); TK = rd('web/src/styles/tokens.css')
tsx = ''.join(open(os.path.join(dp, f), encoding='utf-8').read() for dp, _, fs in os.walk(os.path.join(K, 'web/src')) for f in fs if f.endswith('.tsx'))
STEP = {'12', '13', '14', '16', '18', '20', '24', '30'}
odd = []
for line in A.split('\n'):
    for v in re.findall(r'font-size:\s*([\d.]+)px', line):
        if v in STEP: continue
        if (v == '11' and '.ad-flt button i' in line) or (v == '10' and "content: '▼'" in line): continue
        odd.append(v)
ok('① CSS 글자 크기 — 시트 8단계 · 예외 2곳', A and not odd, str(sorted(set(odd))))
todd = [v for v in re.findall(r'fontSize:\s*([\d.]+)\b', tsx) if v not in STEP]
ok('① 화면 코드 글자 크기 — 시트 8단계', not todd, str(sorted(set(todd))))
ok('① --fs-lg 14 · --fs-xl 20', '--fs-lg: 14px; --fs-xl: 20px;' in TK, '')
rad = [v for v in re.findall(r'border-radius:\s*([\d.]+)px\b', A) if v not in ('7', '11', '999')]
trad = [v for v in re.findall(r'borderRadius:\s*(\d+)\b', tsx) if v not in ('7', '11')]
ok('② 모서리 — 7 · 11 · 999 뿐(CSS · 화면 코드)', not rad and not trad, f'{sorted(set(rad))} · {sorted(set(trad))}')
ok('② 그림자 — 시트 이름', 'box-shadow: var(--sgb-shadow-up);' in A and not re.search(r'box-shadow:\s*rgba', A), '')
mq = sorted(set(re.findall(r'@media \(max-width: (\d+)px\)', A)))
ok('③ 화면 폭 — 640 · 900 · 1240 뿐', set(mq) <= {'640', '900', '1240'} and mq, str(mq))
ok('③ --bp-tablet 900 · --bp-desktop 1240', '--bp-tablet: 900px;' in TK and '--bp-desktop: 1240px;' in TK, '')
M = rd('web/src/main.tsx')
ok('④ sgb-buttons.css — 사용자 웹과 같은 사본 · main.tsx 가 읽음', rd('web/src/styles/sgb-buttons.css', 'rb') == rd('site/src/styles/sgb-buttons.css', 'rb') != b''
   and "import './styles/sgb-buttons.css';" in M, '')
heads = re.findall(r'^\.btn-(?:ok|no|plain|sm|primary)\b[^{]*\{', A, re.M)
blk = A[A.find('/* ── 단추 3종 (v10.68'):]
blk = blk[:blk.find('opacity: .45; cursor: not-allowed; }') + 40]
ok('④ 옛 이름 정의는 「단추 3종」 한 곳에만', heads and all(h in blk for h in heads) and len(heads) == 11, f'정의 {len(heads)}개(두 줄에 걸친 올려놓기 규칙은 하나로 셈)')
ok('④ 주요 · 보조 · 줄 · 작게', '.btn-ok, .btn-primary { background: var(--sgb-btn-bg); color: var(--sgb-btn-fg);' in blk
   and '.btn-plain, .btn-sm { background: var(--sgb-btn2-bg);' in blk and '.btn-no { background: #fff; color: var(--danger); border-color: var(--danger); }' in blk
   and '.btn-sm { height: var(--sgb-btn-h-sm);' in blk and 'height: var(--sgb-btn-h);' in blk, '')
ok('④ 작게 + 주요 — 올려놓기에서 보조 색으로 덮이지 않음', '.btn-ok.btn-sm:hover:not(:disabled), .btn-primary.btn-sm:hover:not(:disabled) { background: var(--sgb-point-d);' in blk, '')
ok('VERSION v10.68 이상', re.match(r'v10\.(6[8-9]|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
