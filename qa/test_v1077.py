"""v10.77 시험 — 디자인 마무리(docs/131)

  KIT=… python3 -I test_v1077.py

  ① 파트너센터 상단바 — 실제 웹 · 시안 같은 값 · 어두운 바탕 대비 4.5 이상 · 흐린 글자 · 초록 글자가 남지 않음 · 시안 운영 화면 상단바도
  ④ v10.63 글자색 스크립트가 어두운 상단바를 흰 바탕으로 세지 않음(test_v1063 6/6)
  ② 운영 화면 입력 칸 · 꾸밈 없는 단추 — 본문 글자를 따름(요소 선택자 · 따로 정한 칸은 그대로)
  ③ 고침 스크립트 — 다시 돌려도 바뀌지 않음
"""
import os, re, shutil, subprocess, tempfile

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
Q = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def cr(a, b):
    def L(h):
        c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        c = [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c]
        return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
    x, y = sorted([L(a), L(b)], reverse=True)
    return (x + .05) / (y + .05)


P, H, T = rd('site/src/styles/proto-partner.css'), rd('spec/proto.html'), rd('web/src/styles/tokens.css')
hd = P[P.find('.pt-hd {'):P.find('/* ── 본문 틀')]
ph = '\n'.join(l for l in H.split('\n') if l.startswith('.phd ') or l.startswith('  color:') and '.phd' in H[max(0, H.find(l) - 200):H.find(l)])
BG = '#0E2A23'
ok('① 실제 웹 상단바 바탕 그대로', '.pt-hd { background: #0E2A23;' in P, '')
ok('① 실제 웹 — 메뉴 · 로고 · 안내 #A7C4BA · 「파트너」 #6EE7B7', '.pt-gnb a { font-size: 13px; font-weight: 700; color: #A7C4BA !important;' in P
   and '.pt-plg b { color: #6EE7B7;' in P and '.pt-phr .pt-ls { color: #A7C4BA; }' in P and 'color: #A7C4BA !important; text-decoration: none; white-space: nowrap; }' in P, '')
ok('① 실제 웹 상단바에 밝은 바탕용 글자색이 남지 않음', 'var(--sgb-ink-3)' not in hd and 'var(--sgb-gr-text)' not in hd, '')
ok('① 시안 .phd — 같은 값', '.phd .pgnb a{font-size:13px;font-weight:700;color:#A7C4BA;' in H and '.phd .plg b{color:#6EE7B7;' in H
   and '.phd .phr .ls{color:#A7C4BA}' in H and '.phd .rsw button{color:#A7C4BA}' in H, '')
ok('① 시안 .phd 에 밝은 바탕용 글자색이 남지 않음', not re.search(r'\.phd [^{]*\{[^}]*var\(--sgb-(ink-3|gr-text)\)', H), '')
ok('① 대비 — #A7C4BA · #6EE7B7 가 바탕 위 4.5 이상', cr('#A7C4BA', BG) >= 4.5 and cr('#6EE7B7', BG) >= 4.5, f"{cr('#A7C4BA', BG):.2f} · {cr('#6EE7B7', BG):.2f}")
ok('① 시안 운영 화면 상단바(.ahd) — 로고 #EDEFF3 · 메뉴 #AEB6C2(실제 운영 화면과 같음) · 남색 위 4.5 이상',
   '  color:#EDEFF3;text-decoration:none;white-space:nowrap}\n.ahd .alg b' in H and '.ahd .agnb a{font-size:13px;font-weight:700;color:#AEB6C2;' in H
   and cr('#AEB6C2', '#00245A') >= 4.5 and cr('#EDEFF3', '#00245A') >= 4.5, f"{cr('#AEB6C2', '#00245A'):.2f}")
ok('① 시안 운영 화면 상단바 · 파트너센터 역할 단추(on)는 그대로(test_v1067)', '.phd .rsw button.on{background:#4F46E5;color:#fff}' in H and '.ahd .rsw button{color:#AEB6C2}' in H, '')
ok('② 운영 화면 — input · select · textarea · button 이 본문 글자를 따름', 'input, select, textarea, button { font: inherit; }' in T and T.find('input, select, textarea') < T.find('body {'), '')
tmp = tempfile.mkdtemp()
try:
    for rel in ('site/src/styles/proto-partner.css', 'spec/proto.html', 'web/src/styles/tokens.css'):
        os.makedirs(os.path.dirname(os.path.join(tmp, rel)), exist_ok=True); shutil.copy(os.path.join(K, rel), os.path.join(tmp, rel))
    r = subprocess.run(['python3', '-I', os.path.join(Q, 'apply_finish_v1077.py'), tmp], capture_output=True, text=True)
    ok('③ 고침 스크립트를 다시 돌려도 그대로', r.returncode == 0 and r.stdout.count('그대로') == 3, (r.stdout + r.stderr).strip()[:160])
finally:
    shutil.rmtree(tmp)
A63 = open(os.path.join(Q, 'apply_text_v1063.py'), encoding='utf-8').read()
ok('④ 글자색 스크립트(v10.63) — 어두운 상단바(파트너센터 · 운영 화면)는 어두운 바탕으로 셈 · 흰 단추(.bo)는 제외', "DARK_BG = [" in A63
   and "'#0e2a23'" in A63 and "'#00245a'" in A63 and "not re.search(r'\\.(pt-)?bo\\b', sel)" in A63, '')
ok('VERSION v10.77 이상', re.match(r'v10\.(7[7-9]|[89]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
