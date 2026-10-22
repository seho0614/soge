"""v10.57 시험 — 디자인 통일 3단계 ① 모서리 · 그림자 시트 단계(docs/113)

  KIT=… python3 -I test_v1057.py

  10/22 대표 「추천대로」(docs/112) — 이 판은 모서리 · 그림자만, 글자 크기는 v10.58 ~ v10.60

  ① 시트 값 — --sgb-r-sm 7 · md 11 · lg 16 · --sgb-shadow · --sgb-shadow-up
  ② 사용자 웹 CSS 전수 — 모서리 숫자는 4px 이하(선 · 점)와 999px(알약)만 · 나머지는 시트 이름
  ③ 그림자 전수 — 시트 이름 · none · inset · 테두리 고리(0 0 0 Npx)만
  ④ 시안 <style> 전수 — 같은 규칙 · 시안 안 디자인 시트 사본은 그대로
  ⑤ 글자 크기는 이 판에서 그대로(v10.58 부터)
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
T = strip(rd('site/src/styles/sgb-tokens.css'))
ok('시트 값 — 모서리 7 · 11 · 16 · 그림자 2단계',
   all(t in T for t in ('--sgb-r-sm: 7px;', '--sgb-r-md: 11px;', '--sgb-r-lg: 16px;', '--sgb-shadow:', '--sgb-shadow-up:')), '')

R_DECL = re.compile(r'border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;}]+)')
S_DECL = re.compile(r'(?<![\w-])box-shadow\s*:\s*([^;}]+)')


def bad_radius(css):
    out = []
    for v in R_DECL.findall(css):
        for t in re.findall(r'([\d.]+)px', re.sub(r'var\([^)]*\)', '', v)):
            if 4 < float(t) and float(t) != 999: out.append(v.strip())
    return out


def ring_only(v):
    for p in re.split(r',(?![^(]*\))', v):
        q = re.sub(r'rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|var\([^)]*\)|inset|currentColor', ' ', p)
        n = [float(x.replace('px', '')) for x in q.split() if re.fullmatch(r'-?[\d.]+(px)?', x)]
        if not (len(n) >= 3 and n[0] == 0 and n[1] == 0 and n[2] == 0): return False
    return True


def bad_shadow(css):
    out = []
    for v in S_DECL.findall(css):
        v = v.strip()
        if v == 'none' or 'inset' in v or '--sgb-shadow' in v or re.fullmatch(r'var\(--[\w-]+\)', v) or ring_only(v): continue
        if re.search(r'0 0 0 [\d.]+px', v): continue    # 고리와 섞인 것(고른 칸 표시)
        out.append(v)
    return out


br, bs, files, nvar = [], [], 0, 0
for f in sorted(glob.glob(os.path.join(ST, '*.css'))):
    if os.path.basename(f) in SKIP: continue
    s = strip(open(f, encoding='utf-8').read()); files += 1
    br += [(os.path.basename(f), x) for x in bad_radius(s)]
    bs += [(os.path.basename(f), x) for x in bad_shadow(s)]
    nvar += len(re.findall(r'var\(--sgb-r-(?:sm|md|lg), \d+px\)', s))
ok(f'사용자 웹 CSS {files}개 — 모서리 숫자는 4px 이하 · 999px 만', not br and nvar >= 400, f'시트 이름 {nvar}곳 · 남은 것 {br[:3]}')
ok('사용자 웹 CSS — 그림자는 시트 이름 · none · inset · 테두리 고리만', not bs, str(bs[:3]))
ok('그림자 변수(--hshadow · --sh · --sh2) — 시트 그림자', 'var(--sgb-shadow' in rd('site/src/styles/home.css').split('--hshadow:')[1][:60]
   and '--mny-shadow: var(--sgb-shadow)' in rd('site/src/styles/money.css'), '')

PR = rd('spec/proto.html')
blocks = re.findall(r'<style[^>]*>(.*?)</style>', PR, flags=re.S)
pbr = [x for b in blocks for x in bad_radius(strip(b))]
pbs = [x for b in blocks for x in bad_shadow(strip(b)) if '--sgb-' not in x]
ok(f'시안 <style> {len(blocks)}개 — 모서리 · 그림자 같은 규칙', blocks and not pbr and not pbs, f'{pbr[:3]} {pbs[:3]}')
ok('시안 — 디자인 시트 사본은 그대로(자기 자신을 가리키지 않음)', not re.search(r'--sgb-shadow(?:-up)?:\s*var\(--sgb-shadow', PR) and '--sgb-r-md: 11px;' in PR, '')

fs = sum(len(re.findall(r'font-size:\s*15px', strip(open(f, encoding='utf-8').read()))) for f in glob.glob(os.path.join(ST, '*.css')))
V58 = re.match(r'v10\.(5[8-9]|[6-9]\d)', rd('VERSION').strip()) is not None
ok('글자 크기는 이 판에서 그대로(15px 남아 있음 — v10.58 부터 바꿈)', V58 or fs >= 50, f'15px {fs}곳' + (' · v10.58 뒤 — test_v1058' if V58 else ''))
ok('VERSION v10.57 이상', re.match(r'v10\.(5[7-9]|[6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
