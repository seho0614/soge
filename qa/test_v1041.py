"""v10.41 시험 — 소개장터 「많이 찾는 키워드」 칩은 시안대로(대표 결정 2026-10-14 「시안대로」)

  SITE=http://localhost:5174 DB=postgresql://sgb:sgb@localhost:5432/sgb python3 test_v1041.py

  시안: 칩을 누르면 S.q = 그 말 · stab2 = 「전체」 · go("src") → 통합 검색 결과의 「전체」 탭.
  개발(전): /search?q=…&gwanCode=MNY(소개장터 탭) → 이번 판: /search?q=…(전체 탭).
"""
import os, re, subprocess, urllib.parse
from playwright.sync_api import sync_playwright

SITE = os.environ.get('SITE', 'http://localhost:5174')
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


now = open(K + '/spec/proto.html', encoding='utf-8').read()
i = now.find('if (t.hasAttribute("data-mny-kw")) {')
ok('시안 — 칩을 누르면 통합 검색 결과 「전체」 탭(S.stab2 = "전체" · go("src"))', i > 0 and 'S.stab2 = "전체"; go("src");' in now[i:i + 300], now[i:i + 160].replace('\n', ' '))
def spop(src):
    a = src.find('function srcToks('); return src[a:src.find('/* ── SB-ADM-DIC-010', a)]
base = subprocess.run(['git', '-C', K, 'show', 'v10.39:sgb/spec/proto.html'], capture_output=True, text=True).stdout
ok('시안 — 검색 부분(SPOP · 결과 화면)은 바탕 v10.39 그대로', len(spop(base)) > 10000 and spop(base) == spop(now), '')

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1400, 'height': 900}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(SITE + '/money', wait_until='networkidle'); pg.wait_for_timeout(500)
    chips = pg.eval_on_selector_all('main .mny .mny-chip', 'els => els.map(e => [e.textContent.trim(), e.getAttribute("href")])')
    none = pg.locator('main .mny .mny-kw-none').count()
    ok('칩 주소 — 모두 /search?q=그 말 (관 조건 없음 = 전체 탭)', (chips and all(h == '/search?q=' + urllib.parse.quote(t) for t, h in chips)) or (not chips and none == 1),
       f'{len(chips)}개 ' + ' '.join(h for _, h in chips[:3]))
    if chips:
        t0 = chips[0][0]
        pg.locator('main .mny .mny-chip').first.click(); pg.wait_for_url('**/search?**', timeout=15000); pg.wait_for_load_state('networkidle')
        u = urllib.parse.urlparse(pg.url); qs = urllib.parse.parse_qs(u.query)
        on = pg.locator('[data-tab][aria-current=page]').get_attribute('data-tab') if pg.locator('[data-tab][aria-current=page]').count() else None
        ok(f'칩 「{t0}」을 누르면 통합 검색 결과 · 「전체」 탭이 켜짐', u.path == '/search' and qs.get('q') == [t0] and 'gwanCode' not in qs and on == 'ALL', f'{urllib.parse.unquote(pg.url.replace(SITE, ""))} · 켜진 탭 {on}')
        ok('결과 화면 — 「‘…’ 검색 결과」 머리 · 오류 화면 아님', t0 in pg.inner_text('main') and '검색 결과' in pg.inner_text('main') and '문제가 생겼' not in pg.inner_text('body'), '')
    ok('쪽 스크립트 오류 없음', not errs, '; '.join(errs)[:200])
    b.close()

n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
