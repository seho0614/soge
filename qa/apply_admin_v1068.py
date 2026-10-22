"""v10.68 — 운영 화면(web/) 디자인 기준 ② 글자 크기 · 모서리 · 그림자 · 화면 폭 · 단추 3종(docs/124). 다시 돌려도 같은 결과입니다.

  python3 -I apply_admin_v1068.py <sgb-core 폴더>

  10/22 대표 「승인」 — 사용자 웹 규칙 그대로(design-standard #12 · #13)
  ① 글자 16종 → 시트 8단계: 10 · 11 · 11.5 · 12.5 → 12 · 13.5 · 15 → 14 · 19 → 18 · 21 → 20 · 23 → 24
     예외 — 필터 단추 안 건수(.ad-flt button i) 11px(알림 숫자) · 펼침 표시 「▼」 10px(글자 아님)
  ② 모서리 6 · 8 · 9 → 7(--sgb-r-sm) · 10 · 12 → 11(--sgb-r-md) · 그림자 → --sgb-shadow-up
  ③ 화면 폭 ≤720 → 640 · 721 ~ 1000 → 900 · 1001 ~ 1240 → 1240 (v10.61 규칙) — 예외: 760(좁은 화면 묶음) → 640(가장 가까운 단계 · 900 이면 표가 반 폭)
  ④ 단추 — sgb-buttons.css 사본 · 겹친 정의 다섯 곳 → 한 곳 · 옛 이름(.btn-ok · .btn-primary 주요 / .btn-plain · .btn-sm 보조 / .btn-no 줄 · 경고 색) 그대로
"""
import os, re, shutil, sys

CORE = sys.argv[1] if len(sys.argv) > 1 else '.'
W = os.path.join(CORE, 'web/src')
n = 0


def rw(rel, fn):
    global n
    p = os.path.join(W, rel); s0 = open(p, encoding='utf-8').read(); s = fn(s0)
    if s != s0: open(p, 'w', encoding='utf-8').write(s); n += 1


def rep(pairs):
    def f(s):
        for o, nw in pairs:
            if o not in s or (nw and nw in s): continue     # 이미 고침 — 옛 문장이 없거나 새 문장이 이미 있음(새 문장이 옛 문장을 품는 경우)
            assert s.count(o) == 1, o[:60]
            s = s.replace(o, nw)
        return s
    return f


FS = {'10': '12', '11': '12', '11.5': '12', '12.5': '12', '13.5': '14', '15': '14', '19': '18', '21': '20', '23': '24'}
KEEP_FS = ('.ad-flt button i', "content: '▼'")


def css_fs(s):
    out = []
    for line in s.split('\n'):
        if not any(k in line for k in KEEP_FS):
            line = re.sub(r'font-size:\s*([\d.]+)px', lambda m: f'font-size: {FS[m.group(1)]}px' if m.group(1) in FS else m.group(0), line)
        out.append(line)
    return '\n'.join(out)


def css_rad(s):
    s = re.sub(r'border-radius:\s*(6|8|9)px(?=\s*[;}])', 'border-radius: var(--sgb-r-sm)', s)
    return re.sub(r'border-radius:\s*(10|12)px(?=\s*[;}])', 'border-radius: var(--sgb-r-md)', s)


def bp(m):
    v = int(m.group(1))
    if v == 760: return '@media (max-width: 640px)'   # 좁은 화면 묶음(상단 메뉴 가로 넘김 · 표 가로 넘김) — 900 으로 보내면 761 ~ 900px 에서 표가 반 폭으로 줄어 가장 가까운 640(120 대 140)으로
    nv = 640 if v <= 720 else 900 if v <= 1000 else 1240 if v <= 1240 else v
    return f'@media (max-width: {nv}px)'


OLD_BTN1 = """.btn-ok, .btn-no {
  padding: var(--sp-1) var(--sp-3); border-radius: var(--r-sm);
  font: inherit; font-size: var(--fs-sm); cursor: pointer; border: 1px solid;
}
.btn-ok { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-no { background: none; color: var(--danger); border-color: var(--line); }
.btn-ok:disabled, .btn-no:disabled { opacity: .5; cursor: default; }
"""
OLD_BTN2 = """.btn-sm     { padding: var(--sp-1) var(--sp-3); border: 1px solid var(--line);
              background: var(--surface); color: var(--ink); border-radius: var(--r-sm);
              font-size: var(--fs-sm); cursor: pointer; }
.btn-sm:hover:not(:disabled) { background: var(--paper); }
.btn-sm:disabled { opacity: .5; cursor: default; }
"""
OLD_BTN3 = """.btn-ok, .btn-no, .btn-plain {
  padding: var(--sp-2) var(--sp-4); border-radius: var(--r-sm);
  font: inherit; font-size: var(--fs-sm); cursor: pointer; border: 1px solid transparent;
}
.btn-ok { background: var(--accent); color: #fff; }
.btn-no { background: var(--danger-w); color: var(--danger); border-color: var(--danger); }
.btn-plain { background: none; color: var(--ink-2); border-color: var(--line); }
.btn-ok:disabled, .btn-no:disabled { opacity: .5; cursor: default; }
"""
OLD_BTN4 = """.btn-primary{display:inline-flex;align-items:center;justify-content:center;
             gap:6px;padding:8px 14px;border-radius:8px;border:1px solid transparent;
             background:var(--accent,#2563EB);color:#fff;font-size:13px;
             font-weight:600;cursor:pointer}
.btn-primary:hover{filter:brightness(.94)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
"""
OLD_BTN5 = """.btn-ok, .btn-primary {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--pp); color: #fff; border: 1px solid var(--pp); padding: 8px 18px; border-radius: 7px;
  font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; line-height: 1.4; }
.btn-ok:hover:not(:disabled), .btn-primary:hover:not(:disabled) { background: var(--pp-d); border-color: var(--pp-d); filter: none; }
.btn-no, .btn-plain, .btn-sm {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--line); background: #fff; color: var(--g700); padding: 7px 16px; border-radius: 7px;
  font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; line-height: 1.4; }
.btn-no { color: var(--danger); }
.btn-no:hover:not(:disabled), .btn-plain:hover:not(:disabled), .btn-sm:hover:not(:disabled) { background: var(--g50); }
.btn-sm, .btn-ok.btn-sm, .btn-no.btn-sm { font-size: 12px; padding: 6px 11px; }
.btn-ok:disabled, .btn-no:disabled, .btn-plain:disabled, .btn-sm:disabled, .btn-primary:disabled {
  opacity: .45; cursor: not-allowed; }
"""
OLD_BTN6 = """/* 작은 확인 단추(.btn-ok.btn-sm)가 뒤에 오는 .btn-sm 규칙에 흰 바탕으로 덮이던 것 — 시안 .bp.sm 보라 */
.btn-ok.btn-sm, .btn-primary.btn-sm { background: var(--pp); color: #fff; border-color: var(--pp); font-weight: 700; }
.btn-ok.btn-sm:hover:not(:disabled), .btn-primary.btn-sm:hover:not(:disabled) { background: var(--pp-d); border-color: var(--pp-d); }
"""
MOVED = lambda i: f'/* v10.68 — 단추는 「단추 3종」 한 곳에서(docs/124) · 옛 정의 {i} */\n'
NEW_BTN = """/* ── 단추 3종 (v10.68 · docs/124) — 모양 하나(sgb-buttons.css 값: 높이 40 · 작은 32 · 모서리 7 · 14px 굵게), 옛 이름은 그대로 ──
 *   주요 .btn-ok · .btn-primary / 보조 .btn-plain · .btn-sm(단독) / 줄 .btn-no(경고 색) / 작게 .btn-sm 을 더함
 *   전에는 같은 이름이 다섯 곳에서 겹쳐 정의돼 뒤의 규칙이 앞을 덮었습니다. 순서: 모양 → 색 → 작게 → 작게 + 색 → 올려놓기 → 못 누름 */
.btn-ok, .btn-primary, .btn-no, .btn-plain, .btn-sm {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: var(--sgb-btn-h); padding: 0 var(--sgb-btn-px); border-radius: var(--sgb-btn-r); border: 1px solid transparent;
  font: var(--sgb-btn-fw) var(--sgb-btn-fs)/1 var(--sgb-font-body); white-space: nowrap; cursor: pointer; text-decoration: none; }
.btn-ok, .btn-primary { background: var(--sgb-btn-bg); color: var(--sgb-btn-fg); border-color: var(--sgb-btn-bg); }
.btn-plain, .btn-sm { background: var(--sgb-btn2-bg); color: var(--sgb-btn2-fg); border-color: var(--sgb-btn2-line); }
.btn-no { background: #fff; color: var(--danger); border-color: var(--danger); }
.btn-sm { height: var(--sgb-btn-h-sm); padding: 0 var(--sgb-btn-px-sm); font-size: var(--sgb-btn-fs-sm); }
.btn-ok.btn-sm, .btn-primary.btn-sm { background: var(--sgb-btn-bg); color: var(--sgb-btn-fg); border-color: var(--sgb-btn-bg); }
.btn-no.btn-sm { background: #fff; color: var(--danger); border-color: var(--danger); }
.btn-ok:hover:not(:disabled), .btn-primary:hover:not(:disabled),
.btn-ok.btn-sm:hover:not(:disabled), .btn-primary.btn-sm:hover:not(:disabled) { background: var(--sgb-point-d); border-color: var(--sgb-point-d); }
.btn-plain:hover:not(:disabled), .btn-sm:hover:not(:disabled) { background: var(--sgb-btn2-hover); }
.btn-no:hover:not(:disabled), .btn-no.btn-sm:hover:not(:disabled) { background: var(--danger-w); }
.btn-ok:disabled, .btn-no:disabled, .btn-plain:disabled, .btn-sm:disabled, .btn-primary:disabled { opacity: .45; cursor: not-allowed; }
"""

# ④ 단추 사본 · 읽기
src = open(os.path.join(CORE, 'site/src/styles/sgb-buttons.css'), 'rb').read()
p = os.path.join(W, 'styles/sgb-buttons.css')
if not os.path.exists(p) or open(p, 'rb').read() != src: open(p, 'wb').write(src); n += 1
rw('main.tsx', rep([("import './styles/admin-fonts.css';", "import './styles/sgb-buttons.css';   // v10.68 — 단추 3종 값(사용자 웹과 같은 파일)\nimport './styles/admin-fonts.css';")]))
rw('styles/app.css', rep([(OLD_BTN1, MOVED(1)), (OLD_BTN2, MOVED(2)), (OLD_BTN3, MOVED(3)), (OLD_BTN4, MOVED(4)), (OLD_BTN5, NEW_BTN), (OLD_BTN6, '')]))
# ① ② ③ CSS
rw('styles/app.css', lambda s: re.sub(r'@media \(max-width: (\d+)px\)', bp, css_rad(css_fs(s))))
rw('styles/app.css', rep([('box-shadow: rgba(0, 0, 0, 0.25) 0 2px 10px -6px;', 'box-shadow: var(--sgb-shadow-up);')]))
rw('styles/tokens.css', rep([
    ('  --fs-lg: 15px; --fs-xl: 21px; --fs-money: 20px;', '  --fs-lg: 14px; --fs-xl: 20px; --fs-money: 20px;   /* v10.68 — 시트 8단계(15 → 14 · 21 → 20) */'),
    ('  --bp-tablet: 768px;', '  --bp-tablet: 900px;    /* v10.68 — 시트 화면 폭 3단계 */'),
    ('  --bp-desktop: 1200px;', '  --bp-desktop: 1240px;'),
]))
# ① ② 화면 코드
TSX_FS = {'10': '12', '12.5': '12', '13.5': '14'}
TSX_R = {'6': "'var(--sgb-r-sm)'", '8': "'var(--sgb-r-sm)'", '12': "'var(--sgb-r-md)'"}
for dp, _, fs in os.walk(W):
    for f in fs:
        if not f.endswith('.tsx'): continue
        rel = os.path.relpath(os.path.join(dp, f), W)
        rw(rel, lambda s: re.sub(r'borderRadius: (\d+)\b(?![.\w])', lambda m: 'borderRadius: ' + TSX_R.get(m.group(1), m.group(1)),
                                 re.sub(r'fontSize: ([\d.]+)\b(?![.\w])', lambda m: 'fontSize: ' + TSX_FS.get(m.group(1), m.group(1)), s)))
print('바꾼 파일', n)
