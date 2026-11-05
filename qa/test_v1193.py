"""v10.193 시험 — 옛 머리줄 CSS 지움 · 점검 전 개발 쪽 디스크 자동 정리(docs/302 · 마이그레이션 없음)

  docker run --rm -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core sgb-qa:v1 python3 test_v1193.py
  (사용자 웹을 띄웠으면 --network host -e SITE=http://localhost:15174 를 더하면 ③ 도 봄)

  ① 코드 — b2.css · home.css · money.css 에 .b2-hd · .b2-hdr · .home-hd · .home-hdr 없음 · 괄호 짝 · 빈 @media 없음 · 바닥줄 · 본문 규칙 남음 · 화면 코드가 옛 이름을 안 씀 · docs/302 · 판
  ② sgb-check.sh — 정리 블록(SGB_NO_CLEAN · 결과 20개 · 이미지 · 볼륨 · 빌드 캐시 4GB · 85% 주의) · 운영 킷 안 건드림 · 가짜 HOME 으로 실제 돌려 결과 폴더 19개 남김 · SGB_NO_CLEAN=1 이면 그대로
  ③ (사용자 웹) 메인 · 생활금융 · 소개몰 · 소개광장 — 공통 머리줄 있음 · 옛 머리줄 없음 · 가로 넘침 없음(1440 · 390)
"""
import glob, os, re, shutil, subprocess, tempfile

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
SITE = os.environ.get('SITE')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
OLD = re.compile(r'\.(b2-hd|b2-hdr|home-hd|home-hdr)(?![\w-])')
ST = 'site/src/styles/'
CSS = {f: rd(ST + f) for f in ('b2.css', 'home.css', 'money.css')}
left = {f: len(OLD.findall(s)) for f, s in CSS.items()}
ok('① 옛 머리줄 선택자 없음(.b2-hd · .b2-hdr · .home-hd · .home-hdr)', all(CSS.values()) and not any(left.values()), str(left))

shape = {f: (s.count('{') == s.count('}'), len(re.findall(r'@media[^{]*\{\s*\}', s))) for f, s in CSS.items()}
ok('① 괄호 짝 맞음 · 빈 @media 없음', all(a and n == 0 for a, n in shape.values()), str(shape))

B2, HM, MN = CSS['b2.css'], CSS['home.css'], CSS['money.css']
ok('① 바닥줄 · 본문 규칙은 남음(.b2-ft, .main-b2 · .b2-in · .home-txt · 생활금융 메뉴)',
   '.b2-ft, .main-b2 {' in B2 and '.b2-in { max-width:' in B2 and '.home-txt { font-size: 14px;' in HM
   and '[data-b2-tone=money] .b2-nav { gap: 28.5px;' in MN, '')

src = ''
for p in glob.glob(os.path.join(K, 'site/src/**/*.tsx'), recursive=True) + glob.glob(os.path.join(K, 'site/src/**/*.ts'), recursive=True):
    src += re.sub(r'/\*.*?\*/|//[^\n]*', '', open(p, encoding='utf-8-sig').read(), flags=re.S)
UH = rd('site/src/components/common/UniHeader.tsx')
ok('① 화면 코드가 옛 이름을 안 씀 · 공통 머리줄은 sh- 이름',
   not re.search(r'["\'` ](b2-hd|b2-hdr|home-hd|home-hdr)["\'` ]', src) and 'sh-hdr' in UH and 'data-uni-header' in UH, '')

ok('① 문서 · 판 — docs/302 · v10.193 이상', any(f.startswith('302_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 193), rd('VERSION').strip())

# ── ② sgb-check.sh 디스크 자동 정리 ──────────────────────────────────
SC = open(os.path.join(HERE, 'sgb-check.sh'), encoding='utf-8').read()
L = SC.splitlines()
a = next((i for i, l in enumerate(L) if l.startswith('if [ "${SGB_NO_CLEAN:-0}" != 1 ]; then')), -1)
b = next((i for i in range(a + 1, len(L)) if L[i] == 'fi'), -1) if a >= 0 else -1
blk = '\n'.join(L[a:b + 1]) if a >= 0 and b > a else ''
ts = next((i for i, l in enumerate(L) if l.startswith('TS=$(date')), -1)
mk = next((i for i, l in enumerate(L) if 'make-kit.sh' in l and not l.startswith('#')), -1)
ok('② 정리 블록 — 결과 20개 · 이름 없는 이미지 · 볼륨 · 빌드 캐시 4GB · 85% 주의 · 결과 폴더 만들기 · kit 만들기 앞',
   blk and 'tail -n +20 | xargs -r rm -rf' in blk and 'docker image prune -f' in blk and 'docker volume prune -f' in blk
   and 'docker builder prune -f --max-used-space 4gb' in blk and '-lt 85 ]' in blk and 0 < b < ts < mk, f'{a} {b} {ts} {mk}')
# v10.197 (docs/310) — 킷은 판 번호가 큰 3판만 남김(kits-keep 칸 · test_v1197) — 그 칸 밖에서는 ~/kits/release 를 건드리지 않음
_kb = re.sub(r'# kits-keep-begin.*?# kits-keep-end', '', blk, flags=re.S)
ok('② 운영 킷 · 기준 이미지는 안 건드림(~/kits/release 는 3판 남기기 칸만 · image prune -a 없음)',
   'kits/release' not in _kb.replace('# v10.197 (docs/310) — 킷은 판 번호가 큰 3판만 남김(~/kits/out · ~/kits/release', '') and 'prune -a' not in blk and 'prune -af' not in blk
   and subprocess.run(['bash', '-n', os.path.join(HERE, 'sgb-check.sh')]).returncode == 0, '')

T = tempfile.mkdtemp()
try:
    os.makedirs(os.path.join(T, 'bin'))
    with open(os.path.join(T, 'bin', 'docker'), 'w') as f:
        f.write('#!/bin/sh\necho "$@" >> "$HOME/docker.log"\n')
    os.chmod(os.path.join(T, 'bin', 'docker'), 0o755)
    for n in range(25):
        d = os.path.join(T, 'check-results', f'202611{n:02d}_0000_x')
        os.makedirs(d); os.utime(d, (1_700_000_000 + n * 60, 1_700_000_000 + n * 60))
    env = dict(os.environ, HOME=T, PATH=os.path.join(T, 'bin') + ':' + os.environ['PATH'])
    o = subprocess.run(['bash', '-c', blk], capture_output=True, text=True, env=env).stdout
    kept = sorted(os.listdir(os.path.join(T, 'check-results')))
    dl = open(os.path.join(T, 'docker.log')).read() if os.path.exists(os.path.join(T, 'docker.log')) else ''
    ok('② 가짜 HOME 으로 실제 실행 — 결과 25개 → 최근 19개(새 결과 더해 20개) · 도커 정리 3번 · 사용률 한 줄',
       len(kept) == 19 and kept[0] == '20261106_0000_x' and dl.count('prune') == 3 and '디스크 정리 뒤 사용' in o, f'{len(kept)} · {o.strip()}')
    os.remove(os.path.join(T, 'docker.log')) if dl else None
    env['SGB_NO_CLEAN'] = '1'
    subprocess.run(['bash', '-c', blk], capture_output=True, text=True, env=env)
    ok('② SGB_NO_CLEAN=1 이면 아무것도 안 지움', len(os.listdir(os.path.join(T, 'check-results'))) == 19
       and not os.path.exists(os.path.join(T, 'docker.log')), '')
finally:
    shutil.rmtree(T, ignore_errors=True)

# ── ③ 사용자 웹 ──────────────────────────────────────────────────────
if SITE:
    from playwright.sync_api import sync_playwright
    bad = []
    with sync_playwright() as p:
        br = p.chromium.launch()
        for w in (1440, 390):
            for u in ('/', '/money', '/mall', '/community'):
                pg = br.new_page(viewport={'width': w, 'height': 900})
                pg.goto(SITE + u, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(300)
                m = pg.evaluate("() => ({ uni: !!document.querySelector('header[data-uni-header]'), old: !!document.querySelector('.b2-hd, .home-hd'),"
                                " ox: document.documentElement.scrollWidth > innerWidth })")
                if not m['uni'] or m['old'] or m['ox']:
                    bad.append((w, u, m))
                pg.close()
        br.close()
    ok('③ 4개 화면 × 1440 · 390 — 공통 머리줄 · 옛 머리줄 없음 · 가로 넘침 없음', not bad, str(bad))

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
