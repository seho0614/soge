"""v10.191 시험 — 메인 Hero 카드 쪽 번호 휴대폰 꺾임 고침(docs/299)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1191.py

  ① 코드 — 단추 묶음 줄지 않음 · 쪽 번호 한 줄 · 이름표가 줄어듦 · 시안 · docs/299 · v10.191
  ② (화면) 390 · 360 · 1440px 메인 — 쪽 번호 한 줄 · ‹ · ❚❚ · › 단추 가로 = 세로
"""
import os, re, sys

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


RULE = '.home-pnav { flex: 0 0 auto; }\n.home-pno { white-space: nowrap; }\n.home-ptag { min-width: 0; }'
ok('① 사이트 — 단추 묶음 줄지 않음 · 쪽 번호 한 줄 · 이름표가 줄어듦', RULE in rd('site/src/styles/home.css'), '')
ok('① 시안 — 같은 규칙', RULE in rd('spec/proto.html'), '')
ok('① 문서 · 판 — docs/299 · v10.191 이상', any(f.startswith('299_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 191), rd('VERSION').strip())

JS = """() => { const n = document.querySelector('.home-pno'); if (!n) return null;
  const b = [...document.querySelectorAll('.home-pnav .home-pnext')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  return { h: Math.round(n.getBoundingClientRect().height), t: n.textContent, btn: b, ox: document.documentElement.scrollWidth > innerWidth + 1 }; }"""

if SITE:
    from playwright.sync_api import sync_playwright
    bad, seen = [], []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w in (390, 360, 1440):
            cx = b.new_context(viewport={'width': w, 'height': 900})
            pg = cx.new_page(); pg.goto(SITE + '/', wait_until='load', timeout=120000); pg.wait_for_timeout(1500)
            r = pg.evaluate(JS); cx.close()
            seen.append(f'{w}: {r}')
            if r is None:
                bad.append(f'{w} 카드 쪽 번호 없음'); continue
            if r['h'] > 30 or r['ox'] or not r['btn'] or any(x[0] != x[1] for x in r['btn']):
                bad.append(f'{w} {r}')
        b.close()
    ok('② 390 · 360 · 1440px — 쪽 번호 한 줄 · 단추 동그라미 · 가로 넘침 없음', not bad, f'{bad[:3]} · {seen}')
else:
    print('  (SITE 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
