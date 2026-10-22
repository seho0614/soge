"""v10.60 시험 — 디자인 통일 3단계 마무리(docs/116) · 사용자 웹 · 시안 전체 전수

  KIT=… python3 -I test_v1060.py

  ① 사용자 웹 CSS 전부 — 글자 크기 시트 8단계(12 · 13 · 14 · 16 · 18 · 20 · 24 · 30) · 30px 넘는 큰 제목 · 알림 숫자 11px 만
  ② 사용자 웹 .tsx 안 fontSize — 같은 규칙(차트 안 SVG <text> 는 그림 좌표라 뺌)
  ③ 시안 <style> 전부 · 시안 화면 코드 안 style="…" — 글자 크기 · 모서리(4px 이하 · 999px · 시트 이름) · 그림자(시트 이름 · 고리 · inset)
  ④ 소개코드 이동 쪽(route.ts) — 시트 숫자
"""
import glob, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
ST = os.path.join(K, 'site/src/styles')
SKIP = {'sgb-tokens.css', 'noto-sans-kr.css', 'money-fonts.css'}
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


def audit(css):
    bad, n = [], 0
    for sel, body in re.findall(r'([^{}]*)\{([^{}]*)\}', css):
        for v in re.findall(r'(?<![\w-])font-size\s*:\s*([\d.]+)px', body):
            v = float(v); n += 1
            if v > 30 or v in STEPS or (v == 11 and re.search(CNT, sel)): continue
            bad.append(f'{sel.strip()[-40:]} {v:g}px')
    return bad, n


bad, tot = [], 0
for f in sorted(glob.glob(os.path.join(ST, '*.css'))):
    if os.path.basename(f) in SKIP: continue
    b, n = audit(strip(open(f, encoding='utf-8').read())); bad += [(os.path.basename(f), x) for x in b]; tot += n
ok(f'사용자 웹 CSS 전부 — 글자 크기 {tot}곳 시트 8단계', not bad and tot >= 1200, str(bad[:4]))

tb = []
for f in glob.glob(os.path.join(K, 'site/src/**/*.tsx'), recursive=True):
    for line in open(f, encoding='utf-8'):
        if '<text' in line: continue
        for v in re.findall(r"fontSize:\s*'?([\d.]+)", line):
            v = float(v)
            if not (v > 30 or v in STEPS): tb.append((os.path.relpath(f, K), v))
ok('사용자 웹 .tsx 안 fontSize — 시트 8단계(차트 SVG 글자 빼고)', not tb, str(tb[:4]))

PR = rd('spec/proto.html')
blocks = re.findall(r'<style[^>]*>(.*?)</style>', PR, flags=re.S)
pb, pn = [], 0
for b in blocks:
    x, n = audit(strip(b)); pb += x; pn += n
ok(f'시안 <style> {len(blocks)}개 — 글자 크기 {pn}곳 시트 8단계', not pb and pn >= 1000, str(pb[:4]))
out = re.sub(r'<style[^>]*>.*?</style>', '', PR, flags=re.S)
fi = [float(v) for v in re.findall(r'font-size:\s*([\d.]+)px(?=\s*[;"\'])', out)]
ri = [float(v) for v in re.findall(r'border-radius:\s*([\d.]+)px(?=\s*[;"\'])', out)]
si = [v for v in re.findall(r'box-shadow:\s*([^;"\']*\d+px[^;"\']*)(?=[;"\'])', out) if 'var(--sgb-shadow' not in v and 'inset' not in v and not re.match(r'\s*0 0 0 ', v)]
ok('시안 style="…" — 글자 크기 시트 8단계', fi and all(v > 30 or v in STEPS for v in fi), f'{len(fi)}곳 · 밖 {sorted({v for v in fi if not (v > 30 or v in STEPS)})}')
ok('시안 style="…" — 모서리 4px 이하 · 999px · 시트 이름만 · 그림자 시트 이름', all(v <= 4 or v == 999 for v in ri) and not si, f'모서리 숫자 {sorted(set(ri))} · 그림자 {si[:2]}')
RT = rd('site/src/app/r/[code]/route.ts')
ok('소개코드 이동 쪽 — 모서리 16 · 7px · 시트 그림자', 'border-radius:16px;box-shadow:4px 4px 8px rgba(0,0,0,.04)' in RT and 'border-radius:7px;' in RT, '')
ok('VERSION v10.60 이상', re.match(r'v10\.([6-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
