"""v10.58 시험 — 디자인 통일 3단계 ② 글자 크기 1차(docs/114) · 메인 · 소개장터 메인 · 두 관 · 머리 · 바닥줄

  KIT=… python3 -I test_v1058.py

  10/22 대표 「추천대로」(docs/112) — ① 12px 미만 → 12px(알림 숫자만 11px) ② 15px → 14px ③ 소개장터 메인도 시트 단계

  ① 1차 파일 8개 — 글자 크기가 시트 8단계(12 · 13 · 14 · 16 · 18 · 20 · 24 · 30) · 알림 숫자 11px · 30px 넘는 큰 제목만
  ② 15px · 15.5px 0 · 12px 미만은 알림 숫자뿐
  ③ 시안 — 같은 화면 규칙(.home · .mny · .plz · .shop · .b2 · .fd · .poll · .kmap)도 같음
  ④ 2차 · 3차 파일은 이 판에서 그대로(v10.59 · v10.60)
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
ST = os.path.join(K, 'site/src/styles')
G1 = ['home.css', 'money.css', 'plaza.css', 'shop.css', 'b2.css', 'food.css', 'poll.css', 'kmap.css']
SEL = r'\.home\b|\.home-|\.mny\b|\.mny-|\[data-b2-tone|\.b2-|\.plz\b|\.plz-|\.shop\b|\.shop-|\.fd-|\.poll-|\.kmap-'
STEPS = {12, 13, 14, 16, 18, 20, 24, 30}
CNT = r'bell|cnt|count|noti|badge-n|num\b'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


strip = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)


def audit(css, sel_re=None):
    bad, n, cnt = [], 0, 0
    for sel, body in re.findall(r'([^{}]*)\{([^{}]*)\}', css):
        if sel_re and not re.search(sel_re, sel): continue
        for v in re.findall(r'(?<![\w-])font-size\s*:\s*([\d.]+)px', body):
            v = float(v); n += 1
            if v > 30 or v in STEPS: continue
            if v == 11 and re.search(CNT, sel): cnt += 1; continue
            bad.append(f'{sel.strip()[:40]} {v:g}px')
    return bad, n, cnt


allbad, tot, tcnt = [], 0, 0
for f in G1:
    b, n, c = audit(strip(rd('site/src/styles/' + f))); allbad += [(f, x) for x in b]; tot += n; tcnt += c
ok(f'1차 파일 8개 — 글자 크기 {tot}곳 모두 시트 8단계 · 큰 제목 · 알림 숫자', not allbad and tot >= 300, f'알림 숫자 11px {tcnt}곳 · 남은 것 {allbad[:4]}')
g1 = ''.join(strip(rd('site/src/styles/' + f)) for f in G1)
ok('15px · 15.5px 0 (본문 2 = 14px)', not re.search(r'font-size:\s*15(\.5)?px', g1), '')
ok('알림 숫자 — 머리줄 종 숫자 11px', re.search(r'\.b2-belln \{[^}]*font-size: 11px', g1) is not None, '')
ok('소개장터 메인(③) — 그림에서 잰 치수도 시트 단계', not audit(strip(rd('site/src/styles/money.css')))[0], '')

PR = rd('spec/proto.html')
pb, pn = [], 0
for blk in re.findall(r'<style[^>]*>(.*?)</style>', PR, flags=re.S):
    b, n, _ = audit(strip(blk), SEL); pb += b; pn += n
ok(f'시안 — 같은 화면 규칙 {pn}곳도 시트 8단계', not pb and pn >= 150, str(pb[:4]))

V59 = re.match(r'v10\.(59|[6-9]\d)', rd('VERSION').strip()) is not None
g2 = strip(rd('site/src/styles/proto-gwan.css')) + strip(rd('site/src/styles/proto-w1.css'))
ok('2차 파일(관 화면)은 이 판에서 그대로 — v10.59 부터', V59 or re.search(r'font-size:\s*(15|12\.5|11\.5)px', g2), 'v10.59 뒤 — test_v1059' if V59 else '')
ok('VERSION v10.58 이상', re.match(r'v10\.(5[8-9]|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
