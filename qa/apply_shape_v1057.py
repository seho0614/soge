"""v10.57 — 디자인 통일 3단계 ① 모서리 · 그림자를 시트 단계로(docs/113). 실제 웹 CSS 와 시안(spec/proto.html)의 <style> 에 같은 규칙으로 넣습니다.

  python3 -I apply_shape_v1057.py <sgb-core 폴더>

  다시 돌려도 같은 결과입니다(이미 시트 이름으로 바뀐 값은 건너뜀).
  10/22 대표 「추천대로」(docs/112 ① ② ③) — 이 판은 크기가 바뀌지 않는 모서리 · 그림자만. 글자 크기는 v10.58 ~ v10.60.

  모서리(시트 4단계: 7 · 11 · 16px · 알약)
    · 5 ~ 9px → var(--sgb-r-sm, 7px) · 9.5 ~ 13.5px → var(--sgb-r-md, 11px) · 14px 이상 → var(--sgb-r-lg, 16px)
    · 40px 이상 → 999px(알약) · 값이 하나이고 높이의 절반 이상이면(height 또는 위아래 여백 + 글자 높이로 어림) → 999px(알약 · 동그라미)
    · 그대로: 0 · % · em · var() · calc() · 4px 이하(선 · 점 · 막대 끝) · 운영 화면 밖(web/)은 범위 밖
  그림자(시트 2단계)
    · 흐림 16px 이상이거나 아래로 6px 이상 → var(--sgb-shadow-up, …)(떠 있는 것) · 그 밖 → var(--sgb-shadow, …)(바닥 카드)
    · 그대로: none · inset · 테두리 고리(0 0 0 Npx — 고른 칸 · 초점 표시) · 고리와 섞인 것 · var() · tokens.css 의 별칭 블록
  ※ 시안의 운영 화면(SB-ADM)은 공통 클래스를 같이 써서 시안에서는 함께 바뀝니다(실제 운영 화면 web/ 은 그대로).
"""
import os, re, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
ST = os.path.join(CORE, 'site/src/styles')
SKIP = {'sgb-tokens.css', 'noto-sans-kr.css', 'money-fonts.css'}
SM, MD, LG, PILL = 'var(--sgb-r-sm, 7px)', 'var(--sgb-r-md, 11px)', 'var(--sgb-r-lg, 16px)', '999px'
SH = 'var(--sgb-shadow, 4px 4px 8px rgba(0, 0, 0, .04))'
UP = 'var(--sgb-shadow-up, 0 6px 22px rgba(0, 36, 90, .10))'
STAT = {'r': 0, 'pill': 0, 'keep_r': 0, 'sh': 0, 'up': 0, 'keep_sh': 0}


def px(body, prop):
    m = re.search(r'(?:^|;|\s)' + prop + r'\s*:\s*([\d.]+)px', body)
    return float(m.group(1)) if m else None


def est_height(body):
    h = px(body, 'height')
    if h: return h
    m = re.search(r'(?:^|;|\s)padding\s*:\s*([\d.]+)px(?:\s+[\d.]+px)?(?:\s+([\d.]+)px)?', body)
    fs = px(body, 'font-size')
    if not (m and fs): return None
    top = float(m.group(1)); bot = float(m.group(2)) if m.group(2) else top
    lh = re.search(r'line-height\s*:\s*([\d.]+)(px)?\s*[;}]?', body)
    line = (float(lh.group(1)) if lh and lh.group(2) else fs * float(lh.group(1)) if lh else fs * 1.5)
    return top + bot + line


def radius(val, body):
    toks = val.split()
    if any(t.startswith(('var(', 'calc(')) for t in toks) or '/' in toks: STAT['keep_r'] += 1; return val
    single = len(toks) == 1
    out = []
    for t in toks:
        m = re.fullmatch(r'([\d.]+)px', t)
        if not m: out.append(t); continue
        n = float(m.group(1))
        if n <= 4: out.append(t); STAT['keep_r'] += 1; continue
        if n >= 40: out.append(PILL); STAT['pill'] += 1; continue
        if single and n >= 14:
            h = est_height(body)
            if h and n * 2 >= h - 1: out.append(PILL); STAT['pill'] += 1; continue
        out.append(SM if n <= 9 else MD if n <= 13.5 else LG); STAT['r'] += 1
    return ' '.join(out)


def split_top(v):
    out, d, cur = [], 0, ''
    for ch in v:
        d += ch == '('; d -= ch == ')'
        if ch == ',' and d == 0: out.append(cur); cur = ''
        else: cur += ch
    return out + [cur]


def shadow(val):
    v = val.strip()
    if v in ('none', 'inherit', 'initial', 'unset') or 'inset' in v or v.startswith('var(') or '--sgb-shadow' in v:
        STAT['keep_sh'] += 1; return val
    parts = split_top(v); kinds = []
    for p in parts:
        q = re.sub(r'rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8}|var\([^)]*\)|[a-z]+', ' ', p)
        nums = [float(x.replace('px', '')) for x in q.split() if re.fullmatch(r'-?[\d.]+(px)?', x)]
        if len(nums) < 2: STAT['keep_sh'] += 1; return val
        x, y, blur, spread = (nums + [0, 0])[:4]
        kinds.append('ring' if x == 0 and y == 0 and blur == 0 else ('up' if blur >= 16 or y >= 6 else 'sh'))
    if 'ring' in kinds: STAT['keep_sh'] += 1; return val
    k = 'up' if 'up' in kinds else 'sh'; STAT[k] += 1
    return UP if k == 'up' else SH


DECL_R = re.compile(r'(border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*)([^;{}!]+?)(\s*(?:!important)?\s*[;}])')
DECL_S = re.compile(r'((?<![\w-])box-shadow\s*:\s*|--[\w-]*(?:shadow|sh2?)\s*:\s*)([^;{}!]+?)(\s*(?:!important)?\s*[;}])')


def fix(css):
    out, pos = [], 0
    # 규칙 단위(선택자 { 내용 })로 돌며 그 규칙의 height · padding 을 봅니다
    for m in re.finditer(r'\{([^{}]*)\}', css):
        body = m.group(1)
        t = body + ';'
        t = DECL_R.sub(lambda d: d.group(1) + radius(d.group(2).strip(), body) + d.group(3), t)
        def sfix(d):
            if d.group(1).startswith('--') and (d.group(1).startswith('--sgb-') or not re.search(r'\d+px', d.group(2))): return d.group(0)   # 시트 정의(사본 포함)는 그대로
            return d.group(1) + shadow(d.group(2)) + d.group(3)
        t = DECL_S.sub(sfix, t)[:-1]
        if t != body:
            out.append(css[pos:m.start(1)]); out.append(t); pos = m.end(1)
    out.append(css[pos:])
    return ''.join(out)


def strip_comments_keep(css, fn):
    # 주석 안의 숫자는 건드리지 않습니다 — 주석을 자리표로 바꿨다가 되돌림
    keep = []
    def hold(m): keep.append(m.group(0)); return f'/*@@{len(keep) - 1}@@*/'
    s = re.sub(r'/\*[\s\S]*?\*/', hold, css)
    s = fn(s)
    return re.sub(r'/\*@@(\d+)@@\*/', lambda m: keep[int(m.group(1))], s)


done = {}
for f in sorted(os.listdir(ST)):
    if not f.endswith('.css') or f in SKIP: continue
    p = os.path.join(ST, f)
    s0 = open(p, encoding='utf-8').read()
    s = strip_comments_keep(s0, fix)
    if s != s0:
        open(p, 'w', encoding='utf-8').write(s); done[f] = 1
web = dict(STAT)
for k in STAT: STAT[k] = 0

p = os.path.join(CORE, 'spec/proto.html')
pr0 = open(p, encoding='utf-8').read()
pr = re.sub(r'(<style[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + strip_comments_keep(m.group(2), fix) + m.group(3), pr0, flags=re.S)
if pr != pr0: open(p, 'w', encoding='utf-8').write(pr)
print('실제 웹', len(done), '파일', web, '· 시안', dict(STAT))
