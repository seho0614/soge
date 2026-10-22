"""v10.58 ~ v10.60 — 디자인 통일 3단계 ② 글자 크기를 시트 8단계로(docs/112 · 114). 실제 웹 CSS 와 시안(spec/proto.html)의 같은 화면 규칙에 넣습니다.

  python3 -I apply_font_v1058.py <sgb-core 폴더> [묶음]      묶음: 1(v10.58 · 기본) · 2(v10.59) · 3(v10.60)

  다시 돌려도 같은 결과입니다(이미 시트 단계인 값은 건너뜀).
  10/22 대표 「추천대로」(docs/112 ① ② ③)
    ① 12px 미만 → 12px · 단 알림 숫자(이름에 bell · cnt · count · noti 가 있고 폭이나 높이가 22px 이하인 규칙)는 11px
    ② 15 · 15.5px → 14px
    ③ 소개장터 메인(그림에서 잰 치수)도 시트 단계
  나머지는 가장 가까운 단계(가운데면 작은 쪽) · 13.5px → 14px(docs/112 표) · 30px 넘는 큰 제목 · rem · em · clamp() · var() 는 그대로
"""
import os, re, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
GROUP = sys.argv[2] if len(sys.argv) > 2 else '1'
ST = os.path.join(CORE, 'site/src/styles')
STEPS = [12, 13, 14, 16, 18, 20, 24, 30]
FIXED = {13.5: 14, 15: 14, 15.5: 14}
GROUPS = {
    '1': (['home.css', 'money.css', 'plaza.css', 'shop.css', 'b2.css', 'food.css', 'poll.css', 'kmap.css'],
          r'\.home\b|\.home-|\.mny\b|\.mny-|\[data-b2-tone|\.b2-|\.plz\b|\.plz-|\.shop\b|\.shop-|\.fd-|\.poll-|\.kmap-'),
    '2': (['proto-gwan.css', 'proto-w1.css'], None),
    '3': (None, None),
}
STAT = {'fs': 0, 'up12': 0, 'cnt11': 0, 'keep': 0}


def step(v):
    if v in FIXED: return FIXED[v]
    return min(STEPS, key=lambda x: (abs(x - v), x))


def box(body):
    for p in ('width', 'height', 'min-width'):
        m = re.search(r'(?:^|[;\s])' + p + r'\s*:\s*([\d.]+)px', body)
        if m and float(m.group(1)) <= 22: return True
    return False


DECL = re.compile(r'((?<![\w-])font-size\s*:\s*)([\d.]+)px(\s*(?:!important)?\s*[;}])')


def fix_body(body, sel=''):
    def one(d):
        v = float(d.group(2))
        if v > 30: STAT['keep'] += 1; return d.group(0)
        if v < 12:
            t = 11 if box(body) and re.search(r'bell|cnt|count|noti|badge-n|num\b', sel) else 12
            if t == v: return d.group(0)
            STAT['cnt11' if t == 11 else 'up12'] += 1
        else:
            t = step(v)
            if t == v: return d.group(0)
            STAT['fs'] += 1
        return d.group(1) + f'{t}px' + d.group(3)
    return DECL.sub(one, body + ';')[:-1]


def fix(css, sel_re=None):
    out, pos = [], 0
    for m in re.finditer(r'([^{}]*)\{([^{}]*)\}', css):
        if sel_re and not re.search(sel_re, m.group(1)): continue
        nb = fix_body(m.group(2), m.group(1))
        if nb != m.group(2):
            out.append(css[pos:m.start(2)]); out.append(nb); pos = m.end(2)
    out.append(css[pos:])
    return ''.join(out)


def keep_comments(css, fn):
    hold = []
    s = re.sub(r'/\*[\s\S]*?\*/', lambda m: (hold.append(m.group(0)), f'/*@@{len(hold) - 1}@@*/')[1], css)
    return re.sub(r'/\*@@(\d+)@@\*/', lambda m: hold[int(m.group(1))], fn(s))


files, sel = GROUPS[GROUP]
if files is None:
    used = set(GROUPS['1'][0]) | set(GROUPS['2'][0]) | {'sgb-tokens.css', 'noto-sans-kr.css', 'money-fonts.css'}
    files = sorted(f for f in os.listdir(ST) if f.endswith('.css') and f not in used)
done = []
for f in files:
    p = os.path.join(ST, f)
    s0 = open(p, encoding='utf-8').read()
    s = keep_comments(s0, fix)
    if s != s0: open(p, 'w', encoding='utf-8').write(s); done.append(f)
web = dict(STAT)
for k in STAT: STAT[k] = 0
if sel:   # 시안 — 같은 화면의 규칙만(선택자로 고름). 묶음 2 · 3 의 시안 범위는 그 판에서 정함
    p = os.path.join(CORE, 'spec/proto.html')
    pr0 = open(p, encoding='utf-8').read()
    pr = re.sub(r'(<style[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + keep_comments(m.group(2), lambda c: fix(c, sel)) + m.group(3), pr0, flags=re.S)
    if pr != pr0: open(p, 'w', encoding='utf-8').write(pr)
print(f'묶음 {GROUP} · 실제 웹 {len(done)} 파일', web, '· 시안', dict(STAT))
