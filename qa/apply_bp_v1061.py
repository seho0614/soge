"""v10.61 — 디자인 통일 3단계 남은 것: 화면 폭(반응형 기준점)을 시트 3단계로(docs/117). 실제 웹 CSS 와 시안(spec/proto.html)의 <style> 에 같은 규칙으로 넣습니다.

  python3 -I apply_bp_v1061.py <sgb-core 폴더>

  다시 돌려도 같은 결과입니다.
  10/21 디자인 통일안 「화면 폭 3단계 — 휴대폰 ≤ 640 · 태블릿 ≤ 900 · 좁은 PC ≤ 1240px」 · 10/22 대표 「추천대로」(docs/117 계획)
    · max-width: 720px 이하 → 640px · 721 ~ 1000px → 900px · 1001 ~ 1240px → 1240px
    · min-width 는 짝이 되는 max-width 를 따라(N - 1 이 640 으로 가면 641px)
    · 1240px 넘는 값(넓은 PC 머리줄 메뉴 조정 등)은 그대로 — 1,280 ~ 1,460px 에서 머리줄이 넘치지 않게 둔 값
"""
import os, re, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
ST = os.path.join(CORE, 'site/src/styles')
SKIP = {'sgb-tokens.css', 'noto-sans-kr.css', 'money-fonts.css'}
STAT = {'max': 0, 'min': 0, 'keep': 0}


def step(n):
    return 640 if n <= 720 else 900 if n <= 1000 else 1240 if n <= 1240 else None


def one(m):
    k, n = m.group(1), float(m.group(3))
    if k == 'max-width':
        t = step(n)
    else:
        s = step(n - 1)
        t = s + 1 if s else None
    if t is None: STAT['keep'] += 1; return m.group(0)
    if t == n: return m.group(0)
    STAT['max' if k == 'max-width' else 'min'] += 1
    return f'{m.group(1)}{m.group(2)}{t}px'


def fix(css):
    return re.sub(r'@media[^{]*', lambda q: re.sub(r'(m(?:ax|in)-width)(\s*:\s*)([\d.]+)px', one, q.group(0)), css)


def keep_comments(css):
    hold = []
    s = re.sub(r'/\*[\s\S]*?\*/', lambda m: (hold.append(m.group(0)), f'/*@@{len(hold) - 1}@@*/')[1], css)
    return re.sub(r'/\*@@(\d+)@@\*/', lambda m: hold[int(m.group(1))], fix(s))


done = []
for f in sorted(os.listdir(ST)):
    if not f.endswith('.css') or f in SKIP: continue
    p = os.path.join(ST, f); s0 = open(p, encoding='utf-8').read(); s = keep_comments(s0)
    if s != s0: open(p, 'w', encoding='utf-8').write(s); done.append(f)
web = dict(STAT)
for k in STAT: STAT[k] = 0
p = os.path.join(CORE, 'spec/proto.html')
pr0 = open(p, encoding='utf-8').read()
pr = re.sub(r'(<style[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + keep_comments(m.group(2)) + m.group(3), pr0, flags=re.S)
if pr != pr0: open(p, 'w', encoding='utf-8').write(pr)
print(f'실제 웹 {len(done)} 파일', web, '· 시안', dict(STAT))
