"""v10.62 — 디자인 통일 4단계: 단추 3종(docs/118). 실제 웹 CSS 와 시안(spec/proto.html)의 <style> 에 같은 규칙으로 넣습니다.

  python3 -I apply_btn_v1062.py <sgb-core 폴더>

  다시 돌려도 같은 결과입니다.
  10/21 디자인 통일안 「단추 3종 × 관 5개」 · 10/22 대표 결정 #13 「추천대로」
    ① 크기 2가지 — 기본 40px(위아래 10 · 좌우 18 · 14px 굵게) · 작은 단추 32px(btn-sm · 위아래 6 · 좌우 12 · 13px)
    ② 모서리 — 주요 · 보조 · 줄 단추 7px(시트 sm) · 칩 · 탭 · 검색 단추는 알약 그대로
    ③ 그대로 — 메인 동그란 주황 검색 단추(.home-go) · 소개장터 검색칸

  단추 3종 (값은 sgb-tokens.css 의 --sgb-btn-*)
    주요 — 관 색 바탕(--sgb-point) · 관 단추 글자색(--sgb-on-point — 주황 · 초록 관은 남색) · 누르면 조금 어둡게
    보조 — 흰 바탕 · 회색 테두리(--sgb-line) · 남색 글자
    줄   — 흰 바탕 · 관 글자색(--sgb-point-text) 테두리 · 글자
  지금 단추 이름(실제 웹 37종 중 단추 30종 · 시안의 같은 이름)은 그대로 두고 값만 이 이름을 가리키게 합니다.
  · 기본 규칙(앞에 다른 선택자가 없는 규칙) — 색 · 테두리 · 모서리 · 굵기 · 크기(위아래 · 좌우 여백 · 글자 · 높이)
  · 화면별 규칙(.gw .gw-regwrap .cta-primary 등) — 색 · 테두리 · 모서리 · 굵기만(그 자리 크기는 그대로)
  · 단추와 단추 아닌 것이 섞인 규칙(.b2-find, .b2-login, .b2-join …) — 건드리지 않고, 바로 뒤에 단추만 모서리 7px 규칙을 덧붙임
  · 빼는 것 — 상자 · 글자 링크(.cta · .mal-cta · .mny-cta · .plan-btn · .ldp-prof-act · .link-btn) · 꺼진 상태(.cta-blocked · :disabled) · .home-go
"""
import os, re, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
ST = os.path.join(CORE, 'site/src/styles')
SKIP = {'sgb-tokens.css', 'noto-sans-kr.css', 'money-fonts.css', 'sgb-buttons.css'}

PRI = {'btn-primary', 'cta-primary', 'pt-bp', 'my-bp', 'w1-bp', 'gw-bp', 'pc-bp', 'bp', 'mal-btn', 'fd-cta', 'bar-go', 'b2-join',
       'gw-go', 'w1-bor', 'bor', 'mny-band-cta'}
SEC = {'pt-bo', 'my-bo', 'w1-bo', 'gw-bo', 'pc-bo', 'bo', 'cta-secondary', 'bar-btn', 'btn-call', 'hlt-btn', 'home-pill', 'btn-sm'}
LINE = {'btn-q'}
SMALL = {'btn-sm'}
# 이름 뒤 꾸밈으로 종류가 정해지는 것
MOD = {('home-pill', 'p'): 'pri', ('mny-btn', 'is-fill'): 'pri', ('mny-btn', 'is-line'): 'line', ('mny-btn', 'is-ghost'): 'line',
       ('hlt-btn', 'pri'): 'pri', ('mal-btn', 'ghost'): 'line', ('btn-sm', 'p2primary'): 'pri'}
# 고른 · 꺼진 · 위험 표시가 붙은 규칙은 그 뜻의 색을 지킵니다(건드리지 않음)
STATE_SKIP = {'on', 'gw-on', 'is-on', 'sel', 'off', 'gw-off', 'done', 'gw-done', 'bar-blocked', 'blocked', 'danger', 'p2danger'}
SIZE_SM = {'btn-sm', 'sm'}      # 작은 단추(32px)
SIZE_KEEP = {'lg'}              # 큰 단추는 그 자리 크기 그대로
NONBTN = {'b2-find', 'b2-login', 'b2-lang'}   # 섞인 규칙을 알아보는 데만 씀(b2-login 은 글자 링크 모양 · b2-find 는 검색칸)

V = {
    'pri': {'bg': 'var(--sgb-btn-bg, #00245a)', 'fg': 'var(--sgb-btn-fg, #fff)', 'bd': 'var(--sgb-btn-bg, #00245a)'},
    'sec': {'bg': 'var(--sgb-btn2-bg, #fff)', 'fg': 'var(--sgb-btn2-fg, #00245a)', 'bd': 'var(--sgb-btn2-line, #dbdbdb)'},
    'line': {'bg': 'var(--sgb-btn3-bg, #fff)', 'fg': 'var(--sgb-btn3-fg, #00245a)', 'bd': 'var(--sgb-btn3-fg, #00245a)'},
}
R = 'var(--sgb-btn-r, 7px)'
FW = 'var(--sgb-btn-fw, 700)'
SIZE = {False: ('var(--sgb-btn-py, 10px)', 'var(--sgb-btn-px, 18px)', 'var(--sgb-btn-fs, 14px)', 'var(--sgb-btn-h, 40px)'),
        True: ('var(--sgb-btn-py-sm, 6px)', 'var(--sgb-btn-px-sm, 12px)', 'var(--sgb-btn-fs-sm, 13px)', 'var(--sgb-btn-h-sm, 32px)')}
STAT = {'base': 0, 'ctx': 0, 'hover': 0, 'mixed': 0}


def last_compound(part):
    part = re.sub(r'\([^)]*\)', lambda m: m.group(0).replace(' ', ''), part.strip())
    return re.split(r'\s*[\s>+~]\s*', part)[-1]


def kind_of(comp, fname):
    bare = re.sub(r':not\([^)]*\)', '', comp)   # :not(:disabled) 는 꺼진 상태가 아님
    if '::' in bare or ':disabled' in bare or '[disabled]' in bare: return None
    cls = re.findall(r'\.([\w-]+)', comp)
    if STATE_SKIP & set(cls): return None
    for (a, b), k in MOD.items():
        if a in cls and b in cls: return k
    for c in cls:
        if c in PRI: return 'pri'
        if c in LINE: return 'line'
        if c in SEC: return 'sec'
    if 'go' in cls and fname in ('shop.css', 'shop-css'): return 'pri'
    return None


def state(comp):
    return 'hover' if re.search(r':(hover|focus-visible|active)', comp) else ''


def rewrite(body, kind, base, small, hover, keep_size=False):
    v = V[kind]
    out = body

    def sub(prop, val, keep_imp=True):
        nonlocal out
        def f(m):
            imp = ' !important' if keep_imp and '!important' in m.group(2) else ''
            return f'{m.group(1)}{val}{imp}'
        out = re.sub(r'((?<![\w-])' + prop + r'\s*:\s*)([^;]*)', f, out)

    if re.search(r'(?<![\w-])background(?:-color)?\s*:', out):
        if hover and kind == 'pri':
            sub(r'background(?:-color)?', v['bg']);
            if 'filter:' not in out: out = out.rstrip().rstrip(';') + '; filter: brightness(.94)'
        elif hover:
            sub(r'background(?:-color)?', 'var(--sgb-btn2-hover, #f5f7fa)')
        else:
            sub(r'background(?:-color)?', v['bg'])
    if re.search(r'(?<![\w-])color\s*:', out): sub('color', v['fg'])
    if re.search(r'(?<![\w-])border-color\s*:', out): sub('border-color', v['bd'])
    m = re.search(r'(?<![\w-])border\s*:\s*([^;]*)', out)
    if m and m.group(1).strip() not in ('0', 'none') and 'px' in m.group(1): sub('border', f'1px solid {v["bd"]}')
    elif not m and base and not hover and kind in ('sec', 'line'): out = out.rstrip().rstrip(';') + f'; border: 1px solid {v["bd"]}'
    if hover: return out
    if re.search(r'(?<![\w-])border-radius\s*:', out): sub('border-radius', R)
    elif base: out = out.rstrip().rstrip(';') + f'; border-radius: {R}'
    if re.search(r'(?<![\w-])font-weight\s*:', out): sub('font-weight', FW, keep_imp=False)
    elif base: out = out.rstrip().rstrip(';') + f'; font-weight: {FW}'
    if base and not keep_size:
        py, px, fs, h = SIZE[small]
        if re.search(r'(?<![\w-])height\s*:', out):
            sub('height', h, keep_imp=False); sub('padding', f'0 {px}', keep_imp=False)
        elif re.search(r'(?<![\w-])padding\s*:', out): sub('padding', f'{py} {px}', keep_imp=False)
        else: out = out.rstrip().rstrip(';') + f'; padding: {py} {px}'
        if re.search(r'(?<![\w-])font-size\s*:', out): sub('font-size', fs, keep_imp=False)
        else: out = out.rstrip().rstrip(';') + f'; font-size: {fs}'
    return out


def fix(css, fname):
    out, pos = [], 0
    for m in re.finditer(r'([^{}]*)\{([^{}]*)\}', css):
        sel, body = m.group(1), m.group(2)
        if '--sgb-v1062' in body: continue   # 이 스크립트가 덧붙인 모서리 규칙
        parts = [p for p in sel.split(',') if p.strip()]
        comps = [last_compound(p) for p in parts]
        kinds = [kind_of(c, fname) for c in comps]
        if not any(kinds): continue
        if '/*@@' in sel and not sel.strip().startswith('/*@@'): pass
        plain = [re.sub(r'/\*@@\d+@@\*/', '', p).strip() for p in parts]
        nonbtn = any(k is None and re.search(r'\.(' + '|'.join(NONBTN) + r')\b|\.[\w-]+', c) for k, c in zip(kinds, comps))
        if not nonbtn and all(kinds) and len(set(kinds)) > 1 and not any(state(c) for c in comps):
            # 단추끼리만 섞인 규칙(.pt-bo, .pt-bp) — 종류와 상관없는 모서리 · 굵기만 그 자리에서
            nb = re.sub(r'((?<![\w-])border-radius\s*:\s*)([^;]*)', lambda d: d.group(1) + R, body)
            nb = re.sub(r'((?<![\w-])font-weight\s*:\s*)([^;]*)', lambda d: d.group(1) + FW, nb)
            if nb != body:
                out.append(css[pos:m.start(2)]); out.append(nb); pos = m.end(2); STAT['mixed'] += 1
            continue
        if nonbtn or len(set(kinds)) > 1:
            # 섞인 규칙 — 그대로 두고 단추만 모서리 규칙을 덧붙임(이미 붙였으면 건너뜀)
            btn_sel = ', '.join(p for p, k, c in zip(plain, kinds, comps) if k and not state(c))
            if btn_sel and re.search(r'border-radius', body):
                add = f'\n{btn_sel} {{ border-radius: {R}; --sgb-v1062: 1; }}'
                tail = css[m.end():m.end() + len(add) + 4]
                if '--sgb-v1062' not in tail:
                    out.append(css[pos:m.end()]); out.append(add); pos = m.end(); STAT['mixed'] += 1
            continue
        kind = kinds[0]
        hover = all(state(c) for c in comps)
        base = all(len(re.split(r'\s*[\s>+~]\s*', re.sub(r'/\*@@\d+@@\*/', '', p).strip())) == 1 for p in parts)
        small = all(SIZE_SM & set(re.findall(r'\.([\w-]+)', c)) for c in comps)
        keep_size = any(SIZE_KEEP & set(re.findall(r'\.([\w-]+)', c)) for c in comps)
        nb = rewrite(body, kind, base and not hover, small, hover, keep_size)
        if nb != body:
            out.append(css[pos:m.start(2)]); out.append(nb); pos = m.end(2)
            STAT['hover' if hover else 'base' if base else 'ctx'] += 1
    out.append(css[pos:])
    return ''.join(out)


def keep_comments(css, fname):
    hold = []
    s = re.sub(r'/\*[\s\S]*?\*/', lambda m: (hold.append(m.group(0)), f'/*@@{len(hold) - 1}@@*/')[1], css)
    s = fix(s, fname)
    return re.sub(r'/\*@@(\d+)@@\*/', lambda m: hold[int(m.group(1))], s)


TOKENS = '''
/* 2026-10-22 v10.62(docs/118) — 디자인 통일 4단계: 단추 3종. 모양은 하나(높이 40 · 모서리 7 · 14px 굵게 · 작은 단추 32 · 13px), 색만 관을 따름 */
:root {
  --sgb-btn-h: 40px; --sgb-btn-py: 10px; --sgb-btn-px: 18px; --sgb-btn-fs: 14px;
  --sgb-btn-h-sm: 32px; --sgb-btn-py-sm: 6px; --sgb-btn-px-sm: 12px; --sgb-btn-fs-sm: 13px;
  --sgb-btn-r: var(--sgb-r-sm); --sgb-btn-fw: 700;
}
:root, [data-sgb-gwan] {
  --sgb-btn-bg: var(--sgb-point); --sgb-btn-fg: var(--sgb-on-point);            /* 주요 */
  --sgb-btn2-bg: #ffffff; --sgb-btn2-fg: var(--sgb-navy); --sgb-btn2-line: var(--sgb-line); --sgb-btn2-hover: var(--sgb-bg);   /* 보조 */
  --sgb-btn3-bg: #ffffff; --sgb-btn3-fg: var(--sgb-point-text);                 /* 줄 */
}
/* 새로 만드는 화면은 이 이름을 씁니다 — <button class="sgb-btn sgb-btn--pri"> */
.sgb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: var(--sgb-btn-h); padding: 0 var(--sgb-btn-px); border-radius: var(--sgb-btn-r);
  font: var(--sgb-btn-fw) var(--sgb-btn-fs)/1 var(--sgb-font-body); white-space: nowrap; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
.sgb-btn--sm { height: var(--sgb-btn-h-sm); padding: 0 var(--sgb-btn-px-sm); font-size: var(--sgb-btn-fs-sm); }
.sgb-btn--pri { background: var(--sgb-btn-bg); color: var(--sgb-btn-fg); border-color: var(--sgb-btn-bg); }
.sgb-btn--pri:hover { filter: brightness(.94); }
.sgb-btn--sec { background: var(--sgb-btn2-bg); color: var(--sgb-btn2-fg); border-color: var(--sgb-btn2-line); }
.sgb-btn--sec:hover { background: var(--sgb-btn2-hover); }
.sgb-btn--line { background: var(--sgb-btn3-bg); color: var(--sgb-btn3-fg); border-color: var(--sgb-btn3-fg); }
'''

if __name__ == '__main__':
    # 단추 값은 새 파일 sgb-buttons.css(시안의 시트 사본이 sgb-tokens.css 글자 그대로여야 해서 따로 둠) · app/layout.tsx 가 시트 다음에 불러옴
    bp = os.path.join(ST, 'sgb-buttons.css')
    BTN_CSS = TOKENS.strip() + '\n'
    if not os.path.exists(bp) or open(bp, encoding='utf-8').read() != BTN_CSS: open(bp, 'w', encoding='utf-8').write(BTN_CSS)
    lp = os.path.join(CORE, 'site/src/app/layout.tsx'); lt = open(lp, encoding='utf-8').read()
    if "import '@/styles/sgb-buttons.css';" not in lt:
        lt = lt.replace("import '@/styles/sgb-tokens.css';\n", "import '@/styles/sgb-tokens.css';\nimport '@/styles/sgb-buttons.css';   // v10.62 단추 3종(docs/118)\n", 1)
        assert "sgb-buttons.css" in lt; open(lp, 'w', encoding='utf-8').write(lt)
    done = []
    for f in sorted(os.listdir(ST)):
        if not f.endswith('.css') or f in SKIP: continue
        p = os.path.join(ST, f); s0 = open(p, encoding='utf-8').read(); s = keep_comments(s0, f)
        if s != s0: open(p, 'w', encoding='utf-8').write(s); done.append(f)
    web = dict(STAT)
    for k in STAT: STAT[k] = 0
    p = os.path.join(CORE, 'spec/proto.html'); pr0 = open(p, encoding='utf-8').read()
    def blk(m):
        name = 'shop-css' if 'shop-css' in m.group(1) else 'proto'
        return m.group(1) + keep_comments(m.group(2), name) + m.group(3)
    pr = re.sub(r'(<style(?! id="sgb-btn-style")[^>]*>)(.*?)(</style>)', blk, pr0, flags=re.S)
    # 시안 — sgb-buttons.css 를 글자 그대로 <style id="sgb-btn-style"> 로(시안의 시트 사본처럼)
    pr = re.sub(r'<style id="sgb-btn-style">.*?</style>\n?', '', pr, flags=re.S)
    i = pr.find('</style>') + len('</style>\n')
    pr = pr[:i] + '<style id="sgb-btn-style">\n' + BTN_CSS + '</style>\n' + pr[i:]
    if pr != pr0: open(p, 'w', encoding='utf-8').write(pr)
    print(f'실제 웹 {len(done)} 파일', web, '· 시안', dict(STAT))
