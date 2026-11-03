"""v10.188 시험 — 머리줄 통일 · Hero 개선(docs/294 · 마이그레이션 없음)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1188.py

  ① 코드 — 공통 머리줄 하나(layout → AnyHeader → UniHeader) · 옛 머리줄을 부르지 않음 · 주황 밑줄 · 가입 남색 · 로그아웃 때 clearDraft · 관 이름 규칙
       · Hero ① 이전 · 멈춤 · 화면에 보일 때만 노출 ② AI 켜짐일 때만 「소뱅AI」 ③ 인기 검색어 칩 · 사전 ko · en · 시안 · docs/294 · 판
  ② (사용자 웹) PC 8화면 — 머리줄 하나 · 큰 로고 · 지금 관 밑줄 · 가입 남색 · 옛 머리줄 없음 / 휴대폰 머리줄 100px 미만
  ③ (사용자 웹) Hero — AI 상태와 문구 일치 · 멈추면 8초 뒤에도 같은 장 · 이전 단추 · 인기 검색어 3개 이상이면 칩이 그 말
"""
import json, os, re, sys, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


S = 'site/src/'
LAY = rd(S + 'app/layout.tsx'); CH = rd(S + 'components/Chrome.tsx'); UH = rd(S + 'components/common/UniHeader.tsx'); CSS = rd(S + 'styles/site-head.css')
HV = rd(S + 'components/home/HomeView.tsx'); HP = rd(S + 'components/home/HeroPromo.tsx'); HS = rd(S + 'components/home/HeroSearch.tsx'); PG = rd(S + 'app/page.tsx')
PROTO = rd('spec/proto.html')
ko = json.loads(rd(S + 'i18n/messages/ko/main.json') or '{}'); en = json.loads(rd(S + 'i18n/messages/en/main.json') or '{}')

ok('① 머리줄 — layout 은 UniHeader 하나 · /partner 전용 상단바 · /partners 는 전 머리줄 그대로(대표 「3개는 제외」)',
   '<AnyHeader><UniHeader gwans={gwans} lang={<LangPick />} /></AnyHeader>' in LAY and LAY.count('<SiteHeader') == 1 and '<B2Header' not in LAY
   and '<HomeHeader' not in HV and 'export function AnyHeader' in CH and "import '@/styles/site-head.css'" in LAY
   and "KEEP_OLD_HEADER_PATHS = ['/partners']" in CH and '<OldHeader><SiteHeader gwans={gwans} /></OldHeader>' in LAY, '')
ok('① UniHeader — 관 이름 규칙 · 지금 관 aria-current · 파트너센터 · /cart-count · 로그아웃 clearDraft · 소개몰만 장바구니',
   "locale !== 'ko' && isGwanKey(g.code)" in UH and "aria-current={m.href === cur ? 'page' : undefined}" in UH and 'href="/partners"' in UH
   and "fetch('/cart-count'" in UH and 'clearDraft();' in UH and '{shop && (' in UH, '')
ok('① 모양 — 주황 밑줄 · 가입 남색(관 표시 안에서도) · 휴대폰 두 줄 · 비로그인 휴대폰 파트너센터 숨김',
   'box-shadow: inset 0 -3px 0 var(--sgb-orange, #ffa03e)' in CSS and '--sgb-btn-bg: var(--sgb-navy, #00245a)' in CSS
   and '.sh-txt.pc-only { display: none; }' in CSS and '.sh-nav { order: 3; width: 100%; overflow-x: auto;' in CSS, '')
ok('① Hero — ① 이전 · 멈춤 · 화면에 보일 때만 노출 ② AI 켜짐일 때만 「소뱅AI」 ③ 인기 검색어 칩 · 사전 ko · en',
   "data-promo=\"prev\"" in HP and "data-promo=\"pause\"" in HP and 'IntersectionObserver' in HP and '!onAd || !seen' in HP and 'hold || paused' in HP
   and "/agent/chat/status" in PG and "/search/keywords?limit=4" in PG and 'hot.length >= 3 ? hot' in PG
   and "ai ? 'hero.aiBadge' : 'hero.aiBadgeOff'" in HV and "heroSearch.tabs.ai.tOff" in HS
   and ko.get('hero', {}).get('aiBadgeOff') == '소개뱅크 통합 검색' and bool(en.get('hero', {}).get('aiBadgeOff'))
   and ko.get('promo', {}).get('pause') and en.get('promo', {}).get('prev') and ko.get('heroSearch', {}).get('tabs', {}).get('ai', {}).get('tOff') == '통합 검색', '')
ok('① 시안 — 일반 · 두 관 머리줄이 메인 머리줄(window.__mxHeader) · 주황 밑줄',
   'window.__mxHeader = function(cur)' in PROTO and '!/^p2/.test(' in PROTO and PROTO.count('if (window.__mxHeader') >= 2 and '.sh-uni .gnb a.on' in PROTO, '')
ok('① 문서 · 판 — docs/294 · v10.188 이상', any(f.startswith('294_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 188), rd('VERSION').strip())

if SITE and API:
    from playwright.sync_api import sync_playwright
    PAGES = [('/', None), ('/money', '/money'), ('/mall', '/mall'), ('/biz', '/biz'), ('/health', '/health'), ('/community', '/community'), ('/guide', '/guide'), ('/support', None)]
    HD = """() => { const hs = [...document.querySelectorAll('header')].filter(e => { const r = e.getBoundingClientRect(); return r.height > 20 && getComputedStyle(e).display !== 'none' && r.top < 80 });
      const u = document.querySelector('header[data-uni-header]'); const on = u && u.querySelector('.sh-nav a.on'); const join = u && [...u.querySelectorAll('a')].find(a => a.getAttribute('href') === '/signup');
      const logo = u && u.querySelector('.sh-logo img');
      return { n: hs.length, uni: !!u, old: !!document.querySelector('.b2-hd, .pc-hd, .home-hd'), on: on ? on.getAttribute('href') : null,
               onLine: on ? getComputedStyle(on).boxShadow : null, join: join ? getComputedStyle(join).backgroundColor : null,
               logoH: logo ? Math.round(logo.getBoundingClientRect().height) : 0, h: u ? Math.round(u.getBoundingClientRect().height) : 0 } }"""
    with sync_playwright() as p:
        b = p.chromium.launch()
        pc = b.new_context(viewport={'width': 1280, 'height': 900}); mo = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        bad, mbad = [], []
        for u, want in PAGES:
            pg = pc.new_page(); pg.goto(SITE + u, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(400); r = pg.evaluate(HD); pg.close()
            good = r['n'] == 1 and r['uni'] and not r['old'] and r['on'] == want and r['join'] == 'rgb(0, 36, 90)' and r['logoH'] >= 40 and (want is None or 'inset' in (r['onLine'] or ''))
            if not good: bad.append(f'{u} {r}')
            pg = mo.new_page(); pg.goto(SITE + u, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(300); m = pg.evaluate(HD); pg.close()
            if not (m['uni'] and m['n'] == 1 and m['h'] < 100): mbad.append(f'{u} h={m["h"]} n={m["n"]}')
        ok(f'② PC {len(PAGES)}화면 — 머리줄 하나 · 큰 로고 · 지금 관 주황 밑줄 · 가입 남색 · 옛 머리줄 없음', not bad, str(bad[:3]))
        ok(f'② 휴대폰 {len(PAGES)}화면 — 머리줄 하나 · 100px 미만', not mbad, str(mbad[:3]))
        pg = pc.new_page(); pg.goto(SITE + '/partners', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(400)
        kp = pg.evaluate("() => ({ uni: !!document.querySelector('header[data-uni-header]'), old: !!document.querySelector('header.pc-hd') })"); pg.close()
        ok('② 제휴 파트너센터(/partners) — 전 머리줄 그대로 · 공통 머리줄 없음', kp == {'uni': False, 'old': True}, str(kp))

        st = json.load(urllib.request.urlopen(API.rstrip('/') + '/agent/chat/status', timeout=60))
        kw = json.load(urllib.request.urlopen(API.rstrip('/') + '/search/keywords?limit=4', timeout=60)).get('items') or []
        pg = pc.new_page(); pg.goto(SITE + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(500)
        badge = pg.locator('.home-aibdg').inner_text().strip(); tab = pg.locator('.home-stab').first.inner_text().strip()
        want_on = st.get('enabled') is True
        ok('③ Hero ② — AI 상태와 문구 일치(켜짐: 소뱅AI · AI 검색 / 꺼짐: 통합 검색)',
           (('소뱅AI' in badge and tab == 'AI 검색') if want_on else (badge == '소개뱅크 통합 검색' and tab == '통합 검색')), f'{st} · {badge} · {tab}')
        no0 = pg.locator('.home-pno').inner_text().strip()
        pg.click('[data-promo="pause"]'); pg.wait_for_timeout(8200); no1 = pg.locator('.home-pno').inner_text().strip()
        pressed = pg.get_attribute('[data-promo="pause"]', 'aria-pressed')
        pg.click('[data-promo="prev"]'); pg.wait_for_timeout(300); no2 = pg.locator('.home-pno').inner_text().strip()
        ok('③ Hero ① — 멈추면 8초 뒤에도 같은 장 · aria-pressed · 이전 단추로 바뀜', no0 == no1 and pressed == 'true' and no2 != no1, f'{no0} → {no1} → {no2} · {pressed}')
        chips = [c.strip() for c in pg.locator('.home-chip .home-chipt').all_inner_texts()]
        terms = [k['term'] for k in kw]
        ok('③ Hero ③ — 인기 검색어 3개 이상이면 그 말 · 아니면 예시 칩 4개',
           (chips == terms) if len(terms) >= 3 else (len(chips) == 4), f'{terms} · {chips}')
        pg.close(); b.close()
else:
    print('  (SITE · API 없음 — ② ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
