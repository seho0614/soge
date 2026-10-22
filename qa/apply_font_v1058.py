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
if GROUP == '2':
    # 관 화면 CSS 는 시안 클래스에 gw- · w1- 를 붙인 사본(.panel → .gw-panel) — 시안에서는 앞머리를 뗀 같은 이름의 규칙을 고릅니다
    names = set()
    for f in files:
        names |= set(re.findall(r'\.(?:gw|w1)-([a-zA-Z][\w-]*)', re.sub(r'/\*[\s\S]*?\*/', '', open(os.path.join(ST, f), encoding='utf-8').read())))
    sel = r'\.(?:' + '|'.join(sorted(map(re.escape, names), key=len, reverse=True)) + r')(?![\w-])'
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
extra = {}
if GROUP == '3':
    # v10.60 마무리 — 시안 전체 <style> · 시안 화면 코드 안 style="…" · 사용자 웹 .tsx 안 크기
    SM, MD, LG = 'var(--sgb-r-sm, 7px)', 'var(--sgb-r-md, 11px)', 'var(--sgb-r-lg, 16px)'
    SH, UP = 'var(--sgb-shadow, 4px 4px 8px rgba(0, 0, 0, .04))', 'var(--sgb-shadow-up, 0 6px 22px rgba(0, 36, 90, .10))'
    def inline(txt):
        n = {'fs': 0, 'r': 0, 'sh': 0}
        def f1(m):
            v = float(m.group(2)); t = v if v > 30 else (12 if v < 12 else step(v))
            if t == v: return m.group(0)
            n['fs'] += 1; return f'{m.group(1)}{t:g}px'
        txt = re.sub(r'(font-size:\s*)([\d.]+)px(?=\s*[;"\'])', f1, txt)
        def f2(m):
            v = float(m.group(2))
            if v <= 4: return m.group(0)
            t = '999px' if v >= 20 else SM if v <= 9 else MD if v <= 13.5 else LG
            if t == m.group(2) + 'px': return m.group(0)
            n['r'] += 1; return m.group(1) + t
        txt = re.sub(r'(border-radius:\s*)([\d.]+)px(?=\s*[;"\'])', f2, txt)
        def f3(m):
            v = m.group(2)
            if 'inset' in v or 'var(' in v or re.match(r'\s*0 0 0 ', v): return m.group(0)
            nums = [float(x) for x in re.findall(r'(-?[\d.]+)px', re.sub(r'rgba?\([^)]*\)', '', v))]
            if len(nums) < 2: return m.group(0)
            n['sh'] += 1; return m.group(1) + (UP if (len(nums) > 2 and nums[2] >= 16) or nums[1] >= 6 else SH)
        txt = re.sub(r'(box-shadow:\s*)([^;"\']*\d+px[^;"\']*)(?=[;"\'])', f3, txt)
        return txt, n
    p = os.path.join(CORE, 'spec/proto.html')
    pr0 = open(p, encoding='utf-8').read()
    for k in STAT: STAT[k] = 0
    pr = re.sub(r'(<style[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + keep_comments(m.group(2), fix) + m.group(3), pr0, flags=re.S)
    parts = re.split(r'(<style[^>]*>.*?</style>)', pr, flags=re.S)
    tot = {'fs': 0, 'r': 0, 'sh': 0}
    for i in range(0, len(parts), 2):
        parts[i], c = inline(parts[i])
        for k in tot: tot[k] += c[k]
    pr = ''.join(parts)
    if pr != pr0: open(p, 'w', encoding='utf-8').write(pr)
    extra['시안 <style>'] = dict(STAT); extra['시안 style="…"'] = tot
    # 사용자 웹 .tsx — style={{ fontSize: N }} (차트 안 SVG <text> 는 그림 좌표라 그대로)
    SRC = os.path.join(CORE, 'site/src')
    nt = 0
    for root, _, fs in os.walk(SRC):
        for f in fs:
            if not f.endswith('.tsx'): continue
            q = os.path.join(root, f); t0 = open(q, encoding='utf-8').read()
            def f4(m):
                global nt
                line_start = t0.rfind('\n', 0, m.start()) + 1
                if '<text' in t0[line_start:m.start()]: return m.group(0)
                v = float(m.group(2)); t = v if v > 30 else (12 if v < 12 else step(v))
                if t == v: return m.group(0)
                nt += 1
                return m.group(1) + (f"'{t:g}px'" if m.group(3) else f'{t:g}')
            t1 = re.sub(r"(fontSize:\s*)'?([\d.]+)(px')?", f4, t0)
            if t1 != t0: open(q, 'w', encoding='utf-8').write(t1)
    extra['.tsx 글자 크기'] = nt
    # 소개코드 이동 쪽(route.ts 안 HTML) — 시트 숫자 그대로(이 쪽은 시트 파일을 불러오지 않음)
    q = os.path.join(SRC, 'app/r/[code]/route.ts'); t0 = open(q, encoding='utf-8').read()
    t1 = t0.replace('border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.06)', 'border-radius:16px;box-shadow:4px 4px 8px rgba(0,0,0,.04)').replace('padding:10px 18px;border-radius:8px;', 'padding:10px 18px;border-radius:7px;')
    if t1 != t0: open(q, 'w', encoding='utf-8').write(t1); extra['route.ts'] = 1
print(f'묶음 {GROUP} · 실제 웹 {len(done)} 파일', web, '· 시안', dict(STAT), extra)
