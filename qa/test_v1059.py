"""v10.59 시험 — 디자인 통일 3단계 ② 글자 크기 2차(docs/115) · 관 화면(proto-gwan · proto-w1)

  KIT=… python3 -I test_v1059.py

  ① 2차 파일 2개 — 글자 크기가 시트 8단계(12 · 13 · 14 · 16 · 18 · 20 · 24 · 30) · 30px 넘는 큰 제목만
  ② 12px 미만 0(① 「추천대로」 — 관 화면에는 알림 숫자 규칙 없음) · 15px 0
  ③ 시안 — 같은 이름의 규칙(gw- · w1- 를 뗀 클래스)도 시트 8단계
  ④ 3차 파일은 이 판에서 그대로(v10.60)
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
ST = os.path.join(K, 'site/src/styles')
G2 = ['proto-gwan.css', 'proto-w1.css']
STEPS = {12, 13, 14, 16, 18, 20, 24, 30}
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


strip = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)


def audit(css, sel_re=None):
    bad, n = [], 0
    for sel, body in re.findall(r'([^{}]*)\{([^{}]*)\}', css):
        if sel_re and not re.search(sel_re, sel): continue
        for v in re.findall(r'(?<![\w-])font-size\s*:\s*([\d.]+)px', body):
            v = float(v); n += 1
            if v > 30 or v in STEPS: continue
            bad.append(f'{sel.strip()[:40]} {v:g}px')
    return bad, n


g2 = {f: strip(rd('site/src/styles/' + f)) for f in G2}
bad = [(f, x) for f, s in g2.items() for x in audit(s)[0]]
tot = sum(audit(s)[1] for s in g2.values())
ok(f'2차 파일 2개 — 글자 크기 {tot}곳 모두 시트 8단계', not bad and tot >= 500, str(bad[:4]))
small = re.findall(r'font-size:\s*(?:\d|1[01])(?:\.\d+)?px', ''.join(g2.values()))
ok('12px 미만 0 · 15px 0', not small and not re.search(r'font-size:\s*15(\.5)?px', ''.join(g2.values())), str(small[:3]))
names = set()
for s in g2.values(): names |= set(re.findall(r'\.(?:gw|w1)-([a-zA-Z][\w-]*)', s))
SEL = r'\.(?:' + '|'.join(sorted(map(re.escape, names), key=len, reverse=True)) + r')(?![\w-])'
PR = rd('spec/proto.html')
pb, pn = [], 0
for blk in re.findall(r'<style[^>]*>(.*?)</style>', PR, flags=re.S):
    b, n = audit(strip(blk), SEL); pb += b; pn += n
ok(f'시안 — 같은 이름의 규칙 {pn}곳도 시트 8단계', not pb and pn >= 300, str(pb[:4]))
V60 = re.match(r'v10\.([6-9]\d)', rd('VERSION').strip()) is not None
g3 = strip(rd('site/src/styles/proto-my.css')) + strip(rd('site/src/styles/partners.css'))
ok('3차 파일(나의공간 · 파트너센터 등)은 이 판에서 그대로 — v10.60 부터', V60 or re.search(r'font-size:\s*(15|12\.5|11\.5|13\.5)px', g3), 'v10.60 뒤 — test_v1060' if V60 else '')
ok('VERSION v10.59 이상', re.match(r'v10\.(59|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
