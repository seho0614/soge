"""v10.63 — 디자인 통일 5단계 ① 읽기 어려운 글자색 고침(docs/119). 실제 웹 CSS 와 시안(spec/proto.html)의 <style> 에 같은 규칙으로 넣습니다.

  python3 -I apply_text_v1063.py <sgb-core 폴더>

  다시 돌려도 같은 결과입니다.
  10/22 대표 「추천대로」(5단계 계획)
    ① 흐린 글자 하나로 — 옛 회색 글자 → 시트 흐린 글자 · 시트 흐린 글자 #6b7694 → #646f8c(흰 5.01 · 화면 바탕 4.67 · 회색 칸 4.51)
    ② 상태 색 글자 — 글자용 진한 값(주황 #c2410c · 초록 #047857 · 빨강 #b91c1c). 점 · 막대 · 바탕은 --or · --gr · --rd 그대로
    ③ 그림 부품 색은 그대로(이 판은 CSS 만)

  고치는 것: 글자색(color)이 그 규칙의 바탕색(없으면 흰 바탕) 위에서 대비 4.5 미만인 곳
    · 회색 → 흐린 글자(--sgb-ink-3) · 그래도 모자라면 설명 글자(--sgb-ink-2)
    · 주황 · 초록 · 빨강 → 상태 색 글자 · 파랑 → 진한 링크(--sgb-link-d) · 그래도 모자라면 설명 글자
  그대로: 흰 글자(바탕 쪽 문제 — 단추 · 배지는 v10.62 에서) · 꺼진 상태(:disabled · .off · .dis) · 입력 칸 안내 글자 · 그림 · 운영 화면(web/)
"""
import colorsys, os, re, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
ST = os.path.join(CORE, 'site/src/styles')
SKIP = {'sgb-tokens.css', 'noto-sans-kr.css', 'money-fonts.css', 'sgb-buttons.css'}
OLD_INK3 = '  --sgb-ink-3: #6b7694;       /* 흐린 글자 — 2026-10-21 디자인 통일 1단계: 잰 값 #838ca5(흰 바탕 대비 3.4)를 같은 색조로 진하게(4.5) */\n'
NEW_INK3 = ('  --sgb-ink-3: #646f8c;       /* 흐린 글자 — 10/21 잰 값 #838ca5(3.4) → #6b7694(4.5) · 2026-10-22 v10.63 화면 바탕 · 회색 칸에서도 4.5 → #646f8c */\n'
            '  --sgb-or-text: #c2410c; --sgb-gr-text: #047857; --sgb-rd-text: #b91c1c;   /* 상태 색 글자(v10.63) — 점 · 막대 · 바탕은 --or · --gr · --rd 그대로 */\n')
STAT = {'grey': 0, 'status': 0, 'blue': 0, 'ink2': 0, 'left': 0}
LEFT = []

strip = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)


def load_vars():
    V = {}
    for f in ('sgb-tokens.css', 'tokens.css', 'sgb-buttons.css'):
        s = strip(open(os.path.join(ST, f), encoding='utf-8').read())
        root = re.findall(r'(?:^|\})\s*:root\s*\{([^}]*)\}', s)
        for blk in root:
            for k, v in re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', blk): V[k] = v.strip()
    return V


V = {}


def res(v, n=0):
    v = v.replace('!important', '').strip()
    m = re.fullmatch(r'var\((--[\w-]+)(?:,\s*([^)]*))?\)', v)
    if m and n < 8:
        if m.group(1) in V: return res(V[m.group(1)], n + 1)
        if m.group(2): return res(m.group(2), n + 1)
        return None
    if re.fullmatch(r'#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}', v):
        return '#' + (''.join(c * 2 for c in v[1:]) if len(v) == 4 else v[1:]).lower()
    if v in ('white', '#fff'): return '#ffffff'
    return None


def L(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def cr(a, b):
    x, y = sorted([L(a), L(b)], reverse=True); return (x + .05) / (y + .05)


def family(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    hue, s, v = colorsys.rgb_to_hsv(r, g, b); hue *= 360
    if s < .25: return 'grey'
    if 10 <= hue < 45: return 'or'
    if 80 <= hue < 175: return 'gr'
    if hue >= 320 or hue < 10: return 'rd'      # 분홍(HOT 등)도 빨강 글자로
    if 190 <= hue < 250: return 'blue'
    return 'other'


REPL = {'grey': 'var(--sgb-ink-3)', 'or': 'var(--sgb-or-text)', 'gr': 'var(--sgb-gr-text)', 'rd': 'var(--sgb-rd-text)', 'blue': 'var(--sgb-link-d)'}


def fix(css, where):
    out, pos = [], 0
    for m in re.finditer(r'([^{}]*)\{([^{}]*)\}', css):
        sel, body = m.group(1), m.group(2)
        if re.search(r':disabled|disabled|placeholder|::|\.off\b|\.dis\b', sel) or sel.strip().startswith(':root') or '@font-face' in sel: continue
        bgm = re.search(r'(?<![\w-])background(?:-color)?\s*:\s*([^;]+)', body)
        bg = res(bgm.group(1)) if bgm else '#ffffff'
        if bgm and not bg: continue           # 그림 · 그러데이션 바탕은 셈하지 않음
        def one(d):
            val = d.group(2)
            h = res(val)
            if not h or h == '#ffffff' or cr(h, bg) >= 4.5: return d.group(0)
            fam = family(h)
            if fam == 'other': STAT['left'] += 1; LEFT.append(f'{where}: {sel.strip()[-40:]} {val.strip()}'); return d.group(0)
            new = REPL[fam]; rh = res(new)
            if not rh or cr(rh, bg) < 4.5:
                new = 'var(--sgb-ink-2)'; rh = res(new)
                if cr(rh, bg) < 4.5: STAT['left'] += 1; LEFT.append(f'{where}: {sel.strip()[-40:]} {val.strip()}'); return d.group(0)
                STAT['ink2'] += 1
            else:
                STAT['grey' if fam == 'grey' else 'blue' if fam == 'blue' else 'status'] += 1
            imp = ' !important' if '!important' in val else ''
            return d.group(1) + new + imp
        nb = re.sub(r'((?<![\w-])color\s*:\s*)([^;]+)', one, body)
        if nb != body:
            out.append(css[pos:m.start(2)]); out.append(nb); pos = m.end(2)
    out.append(css[pos:])
    return ''.join(out)


def keep_comments(css, where):
    hold = []
    s = re.sub(r'/\*[\s\S]*?\*/', lambda m: (hold.append(m.group(0)), f'/*@@{len(hold) - 1}@@*/')[1], css)
    return re.sub(r'/\*@@(\d+)@@\*/', lambda m: hold[int(m.group(1))], fix(s, where))


if __name__ == '__main__':
    tp = os.path.join(ST, 'sgb-tokens.css'); t = open(tp, encoding='utf-8').read()
    if OLD_INK3 in t: open(tp, 'w', encoding='utf-8').write(t.replace(OLD_INK3, NEW_INK3, 1))
    assert NEW_INK3 in open(tp, encoding='utf-8').read()
    V.update(load_vars())
    done = []
    for f in sorted(os.listdir(ST)):
        if not f.endswith('.css') or f in SKIP or f == 'tokens.css': continue
        p = os.path.join(ST, f); s0 = open(p, encoding='utf-8').read(); s = keep_comments(s0, f)
        if s != s0: open(p, 'w', encoding='utf-8').write(s); done.append(f)
    web = dict(STAT); wl = list(LEFT)
    for k in STAT: STAT[k] = 0
    LEFT.clear()
    p = os.path.join(CORE, 'spec/proto.html'); pr0 = open(p, encoding='utf-8').read()
    pr = pr0.replace(OLD_INK3, NEW_INK3, 1)      # 시안의 시트 사본(글자 그대로)
    pr = re.sub(r'(<style(?! id="sgb-btn-style")[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + keep_comments(m.group(2), 'proto') + m.group(3), pr, flags=re.S)
    if pr != pr0: open(p, 'w', encoding='utf-8').write(pr)
    print(f'실제 웹 {len(done)} 파일', web, '· 시안', dict(STAT))
    for x in (wl + LEFT)[:30]: print('  남음', x)
