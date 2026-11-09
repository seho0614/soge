"""v10.220 (docs/354) — 검색 결과가 없을 때 다음 길(요청 올리기 · 소개몰 전체 · 소개광장 묻기)

  ① (코드) 범위마다 none(request · product · town) · NONE_HREF 세 곳 · 팝업 빈 결과 단추 · Enter 도 같은 곳 · 결과가 있으면 맨 위 결과 그대로 · 사전 ko · en · 문서 354 · 판
  ② (화면) 메인 통합 · 상품 · 동네정보 탭, 관 화면(소개장터) 검색칸, 머리줄 돋보기 — 없는 말: 안내 · 단추 → Enter 로 그 길(로그인 전이면 로그인 화면)
     있는 말(공장): 단추 없음 · Enter 는 맨 위 결과 상세로(10/14 지시 그대로)
  자료를 만들지 않음(두 번 돌려도 같음)
"""
import json, os, re

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
SITE = os.environ.get('SITE')
RES = []
MISS = '없는말시험일이공'   # 어디에도 없는 말


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


SD, SP = rd('site/src/components/search/search-data.ts'), rd('site/src/components/search/SearchPopup.tsx')
try:
    ko, en = json.loads(rd('site/src/i18n/messages/ko/searchPop.json')), json.loads(rd('site/src/i18n/messages/en/searchPop.json'))
except Exception:
    ko, en = {}, {}
ways = {k: v for k, v in re.findall(r"\n  (\w+): \{ label: 'scope\.\w+'.*?none: '(\w+)' \}", SD)}
ok('① 범위마다 갈 곳 — 상품 → product · 동네정보 → town · 나머지 다섯 → request · 세 주소',
   ways == {'ai': 'request', 'product': 'product', 'service': 'request', 'company': 'request', 'biz': 'request', 'town': 'town', 'pro': 'request'}
   and "request: '/request/new', product: '/health/c/ALL', town: '/community/write'" in SD, str(ways))
ok('① 팝업 — 범위 없으면 request · 빈 결과 단추 · Enter: 결과 있으면 맨 위 · 없으면 그 길',
   "const none = sc?.none ?? 'request';" in SP and 'const noResult = !!t && hit.q === t && !loading && !rows.length;' in SP
   and 'if (rows[0]) go(rows[0].href); else if (noResult) go(NONE_HREF[none]);' in SP
   and 'data-spop-none={none}' in SP and 'onClick={() => go(NONE_HREF[none])}' in SP, '')
ok('① 사전 ko · en — none.request · product · town 의 hint · go · 요청 단추에 {q}',
   all(ko.get('none', {}).get(w, {}).get(f) and en.get('none', {}).get(w, {}).get(f) for w in ('request', 'product', 'town') for f in ('hint', 'go'))
   and '{q}' in ko['none']['request']['go'] and '{q}' in en['none']['request']['go'], '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('354_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 354 · 판 v10.220 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 220), f'{DOC} · {rd("VERSION").strip()}')

# ── ② 화면 ──────────────────────────────────────────────────────────────
try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None
if not (sync_playwright and SITE):
    ok('② 화면 — playwright · SITE 필요', False, 'playwright 또는 SITE 없음')
else:
    def path_of(u):
        return re.sub(r'^https?://[^/]+', '', u)

    def run(pg, start, opener, word, tab=None, press=True):
        """시작 화면 → (탭) → 검색칸/돋보기 → word → 팝업의 빈 결과 칸 · 단추 글 → Enter 뒤 주소"""
        pg.goto(SITE + start, wait_until='networkidle')
        if tab:
            pg.locator(f'[data-stab={tab}]').click()
        pg.locator(opener).first.click()
        pg.wait_for_timeout(600)
        pg.keyboard.type(word, delay=40)
        pg.wait_for_timeout(2200)
        dlg = pg.locator('[role=dialog]')
        box = dlg.locator('[data-spop-none]')
        way = box.first.get_attribute('data-spop-none') if box.count() else None
        label = dlg.locator('[data-spop-none-go]').first.inner_text() if box.count() else ''
        url = ''
        if press:
            pg.keyboard.press('Enter')
            try:
                pg.wait_for_url(lambda u: path_of(u) != start, timeout=8000)
            except Exception:
                pass
            pg.wait_for_timeout(800)
            url = path_of(pg.url)
        return way, label, url

    seen, errs = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            for w in (1400, 390):
                pg = b.new_page(viewport={'width': w, 'height': 900})
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                seen[f'ai{w}'] = run(pg, '/', '.home-sb input', MISS)
                seen[f'product{w}'] = run(pg, '/', '.home-sb input', MISS, tab='product')
                seen[f'town{w}'] = run(pg, '/', '.home-sb input', MISS, tab='town')
                seen[f'money{w}'] = run(pg, '/money', 'main form[role=search] input', MISS)
                seen[f'hdr{w}'] = run(pg, '/community', 'header button[aria-label*="검색"]', MISS)
                seen[f'hit{w}'] = run(pg, '/', '.home-sb input', '공장')
                pg.close()
            b.close()
    except Exception as ex:
        errs.append(str(ex)[:200])
    login = lambda u, nxt: u.startswith('/login') and nxt in u.replace('%2F', '/')
    for w in (1400, 390):
        a, pr, tw, mn, hd, ht = (seen.get(f'{k}{w}', (None, '', '')) for k in ('ai', 'product', 'town', 'money', 'hdr', 'hit'))
        ok(f'② {w}px 통합 탭 · 없는 말 — 「요청 올리기」(친 말) · Enter → 요청 올리기(로그인 전이라 로그인 화면)',
           a[0] == 'request' and MISS in a[1] and login(a[2], '/request/new'), str(a))
        ok(f'② {w}px 상품 탭 → 소개몰 전체 · 동네정보 탭 → 소개광장 글쓰기(로그인 화면)',
           pr[0] == 'product' and pr[2].startswith('/health/c/ALL') and tw[0] == 'town' and (tw[2].startswith('/community/write') or login(tw[2], '/community/write')),
           f'{pr} · {tw}')
        ok(f'② {w}px 소개장터 검색칸 · 머리줄 돋보기(범위 없음) → 요청 올리기',
           mn[0] == 'request' and login(mn[2], '/request/new') and hd[0] == 'request' and login(hd[2], '/request/new'), f'{mn} · {hd}')
        ok(f'② {w}px 있는 말(공장) — 단추 없음 · Enter 는 맨 위 결과 상세(10/14 지시 그대로)',
           ht[0] is None and re.match(r'^/(request|money|mall|biz)/[0-9a-f-]{36}', ht[2] or '') is not None, str(ht))
    ok('② 화면 오류 없음', not errs, str(errs[:3]))

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
