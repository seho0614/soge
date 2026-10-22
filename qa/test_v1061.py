"""v10.61 시험 — 디자인 통일 3단계 남은 것: 화면 폭 3단계(docs/117)

  KIT=… python3 -I test_v1061.py

  ① 사용자 웹 CSS 전부 — @media max-width 는 640 · 900 · 1240px 와 1240px 넘는 넓은 PC 예외만 · min-width 는 641 · 901 · 1241px 과 넓은 예외만
  ② 시안 <style> 전부 — 같음
  ③ 시트 기록값 — --sgb-bp-phone 640 · tablet 900 · desk 1240
"""
import glob, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
ST = os.path.join(K, 'site/src/styles')
SKIP = {'sgb-tokens.css', 'noto-sans-kr.css', 'money-fonts.css'}
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


strip = lambda s: re.sub(r'/\*[\s\S]*?\*/', '', s)


def audit(css):
    bad, n = [], 0
    for q in re.findall(r'@media[^{]*', strip(css)):
        for k, v in re.findall(r'(m(?:ax|in)-width)\s*:\s*([\d.]+)px', q):
            v = float(v); n += 1
            okv = (v in (640, 900, 1240) or v > 1240) if k == 'max-width' else (v in (641, 901, 1241) or v > 1241)
            if not okv: bad.append(f'{k} {v:g}')
    return bad, n


bad, n = [], 0
for f in glob.glob(os.path.join(ST, '*.css')):
    if os.path.basename(f) in SKIP: continue
    b, c = audit(open(f, encoding='utf-8').read()); bad += [(os.path.basename(f), x) for x in b]; n += c
ok(f'사용자 웹 CSS — 화면 폭 {n}곳 3단계(넓은 PC 예외만)', not bad and n >= 140, str(bad[:4]))
PR = rd('spec/proto.html')
pb, pn = [], 0
for blk in re.findall(r'<style[^>]*>(.*?)</style>', PR, flags=re.S):
    b, c = audit(blk); pb += b; pn += c
ok(f'시안 <style> — 화면 폭 {pn}곳 3단계', not pb and pn >= 130, str(pb[:4]))
T = rd('site/src/styles/sgb-tokens.css')
ok('시트 기록값 640 · 900 · 1240', all(t in T for t in ('--sgb-bp-phone: 640px;', '--sgb-bp-tablet: 900px;', '--sgb-bp-desk: 1240px;')), '')
ok('VERSION v10.61 이상', re.match(r'v10\.(6[1-9]|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
