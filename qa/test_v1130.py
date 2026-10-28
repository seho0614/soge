"""v10.130 시험 — 메인 검색 아래 한 줄(검색 예시 칩 + 소개장터 바로가기 · docs/195)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1130.py

  ① 코드 — 한 줄 묶음(data-hero-row) · 칩 글은 span(「…」) · title 에 전체 문장 · 1200px 이상에서만 · 마이그레이션 없음
  ② (화면) 1440 · 1280 — 칩 4 + 바로가기 5 가 한 줄 · 13px · 가로 넘침 없음 / 1100 · 900 · 390 — 전처럼(14px · 잘림 없음 · 넘침 없음) · 칩 누르면 검색 팝업이 그 말로
"""
import os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


HV = rd('site/src/components/home/HomeView.tsx'); CSS = rd('site/src/styles/home.css')
ok('① 코드 — 칩 · 바로가기를 한 묶음(data-hero-row) · 칩 글 span · title 전체 문장',
   '<div className="home-row1" data-hero-row>' in HV and '<span className="home-chipt">{q}</span>' in HV and 'title={q}' in HV, '')
ok('① CSS — 1200px 이상에서만 한 줄 · 칩 줄바꿈 없음 · 「…」 · 13px',
   '@media (min-width: 1200px) {' in CSS and '.home-row1 .home-chips { margin-top: 0; flex: 1 1 auto; min-width: 0; flex-wrap: nowrap;' in CSS
   and 'text-overflow: ellipsis' in CSS and '.home-row1 .home-qm a { padding: 9px 11px; gap: 5px; font-size: 13px; }' in CSS, '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d))]
ok('① 판 v10.130 이상 · 마이그레이션 166 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 130) and len(mig) in (166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176), f"{rd('VERSION').strip()} · {len(mig)}")

if SITE:
    from playwright.sync_api import sync_playwright
    MEASURE = """() => {
      const row = document.querySelector('[data-hero-row]'); if (!row) return null;
      const chips = [...row.querySelectorAll('.home-chip')], qm = [...row.querySelectorAll('.home-qm a')];
      const mid = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
      const mids = new Set([...chips, ...qm].map(mid));
      return { chips: chips.length, qm: qm.length, spread: Math.max(...mids) - Math.min(...mids),
               font: getComputedStyle(chips[0]).fontSize, cut: [...row.querySelectorAll('.home-chipt')].filter(e => e.scrollWidth > e.clientWidth).length,
               overflowX: document.documentElement.scrollWidth > innerWidth };
    }"""
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w in (1440, 1280):
            pg = b.new_page(viewport={'width': w, 'height': 900})
            pg.goto(SITE + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
            m = pg.evaluate(MEASURE)
            ok(f'② {w}px — 칩 4 + 바로가기 5 가 한 줄(가운데 높이 차 4px 안) · 13px · 넘침 없음',
               m and m['chips'] == 4 and m['qm'] == 5 and m['spread'] <= 4 and m['font'] == '13px' and not m['overflowX'], str(m))
            if w == 1280:
                q = pg.locator('[data-hero-row] .home-chip').first.get_attribute('data-q')
                pg.locator('[data-hero-row] .home-chip').first.click(); pg.wait_for_timeout(1200)
                val = pg.evaluate("() => [...document.querySelectorAll('.pc-spop input')].map(i => i.value).join(' ')")
                ok('② 칩을 누르면 검색 팝업이 그 말로 열림(전과 같은 동작)', pg.locator('.pc-spop[role=dialog]').count() == 1 and q and q in (val or ''), f'{q} → {val}')
            pg.close()
        for w in (1100, 900, 390):
            pg = b.new_page(viewport={'width': w, 'height': 900})
            pg.goto(SITE + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
            m = pg.evaluate(MEASURE)
            ok(f'② {w}px — 전처럼 두 줄(14px · 칩 글 잘림 없음 · 넘침 없음)', m and m['spread'] > 4 and m['font'] == '14px' and m['cut'] == 0 and not m['overflowX'], str(m))
            pg.close()
        b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
