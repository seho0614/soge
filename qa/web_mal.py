#!/usr/bin/env python3
"""
web_mal — 안심소개 「상담 축 통합」 실제 웹 실측 (SB-MAL-MAIN-010 /mall · SB-MAL-LST-010 /mall/list · SB-MAL-CSL-010 /consult · SB-MAL-CSL-020 /mal/consult · SB-MAL-CSL-025 /mal/consult/{code} 업종 상세(v10.24) · SB-MAL-CSL-030 /mal/consult/{code}/apply 신청서)

  v10.11 — 상담 신청이 「로그인 없이 · 휴대폰 확인 · 인증업체 1곳」(D018)으로, 업종이 22종(법률 · 세무는 사무소 보기 — D019)으로 바뀐 데 맞췄습니다.

  SITE=http://localhost:5302 python3 /home/claude/qa/web_mal.py
  (통합 뒤: SITE=http://localhost:5174)

상태 3가지(비로그인 · intro@x.com(입점 승인 업체) · person@x.com(미입점))로 열어
  HTTP 200 · 콘솔 오류 0 · 'Application error' 없음 · 페이지 안 모든 내부 링크 200 · 390px 가로 넘침 없음 ·
  시안 결정(띠 없음 · 시연 「보는 사람」 없음) · API 값과 화면 값 대조 · 버튼 동작 · 상담 신청 실제 제출 1건(person).
결과: /home/claude/qa/web_mal.json  캡처: /home/claude/qa/web_mal_*.png
"""
import json, os, random, re, sys, urllib.request
from urllib.parse import urlparse, urljoin, unquote   # v10.29 — unquote(검색 주소 확인)
from playwright.sync_api import sync_playwright

SITE = os.environ.get('SITE', 'http://localhost:5302').rstrip('/')
API = os.environ.get('API', 'http://localhost:3000/api/v1').rstrip('/')
PW = 'sgb-dev-1234'
OUT = '/home/claude/qa/web_mal.json'
SHOT = '/home/claude/qa/web_mal_{}.png'

items = []
def rec(name, ok, detail=''):
    items.append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  — {str(detail)[:300]}'), flush=True)

def api(path, token=None, method='GET', body=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'null')

def token(email):
    return api('/auth/login', method='POST', body={'email': email, 'password': PW})[1]['accessToken']

# ── API 기준값 ──────────────────────────────────────────────────────────
SET = api('/site-settings/public')[1]
CSL = api('/consult/categories')[1]
LEADC = [c for c in CSL if c['consultMode'] == 'LEAD']
is_open = lambda c: c['status'] == 'APPROVED' and c['consultMode'] == 'LEAD' and c['partnerCount'] > 0
OPENC = [c for c in CSL if is_open(c)]
DIRC = [c for c in CSL if c['consultMode'] == 'LISTING_FEE']
MALCATS = api('/categories?gwanCode=MAL')[1]
CSL_IDS = {c['id'] for c in CSL}
LCATS = [c for c in MALCATS if c['id'] not in CSL_IDS]
# v10.31 (w2 · 10/10 시안 기준) — 안심소개 첫 화면은 시안 3축(기계 · 설비 · 시설 기본 / 부동산 / 생활 · 금융 상담). 기본 축은 분류 axis=EQUIP 만, 제한 업종은 숨김
LCATS = [c for c in LCATS if c.get('axis') == 'EQUIP' and not c.get('restricted')]
PLANS = {p['code']: p for p in api('/subscription-plans')[1]}
L0 = api('/listings?gwanCode=MAL&limit=20')[1]
PARTNER_ONLY = SET.get('mal.partner_only', 'off')

PAGES = ['/mall', '/mall?axis=consult', '/mall/list', '/mall/give', '/consult', '/consult?cat=CSL_CLEANING',
         '/mal/consult', '/mal/consult/CSL_CLEANING', '/mal/consult/CSL_CLEANING/apply', '/mal/consult/CSL_LEGAL']

def body_text(pg):
    return pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')

def overflow(pg):
    return pg.evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth')

def links_of(pg):
    hrefs = pg.eval_on_selector_all('main a[href], header a[href], footer a[href]', 'els => els.map(e => e.getAttribute("href"))')
    out = set()
    for h in hrefs:
        if not h or h.startswith(('mailto:', 'tel:', 'javascript:', '#')):
            continue
        u = urljoin(SITE + '/', h)
        if urlparse(u).netloc != urlparse(SITE).netloc:
            continue
        out.add(u.split('#')[0])
    return sorted(out)

def login(ctx, email):
    pg = ctx.new_page()
    pg.goto(SITE + '/login', wait_until='networkidle')
    __import__('consent_ok').agree(email, PW); pg.fill('input[name=email]', email); pg.fill('input[name=password]', PW)
    pg.locator('button', has_text='로그인').last.click()
    # v10.14 — 2.5초 고정 대기였는데, 느린 환경(Docker 개발 모드의 첫 요청)에서는 그 안에 로그인이 안 끝나 4항목이 실패했습니다. 쿠키가 생길 때까지(최대 12초) 기다립니다
    ok = False
    for _ in range(24):
        pg.wait_for_timeout(500)
        ok = any(c['name'] == 'sgb_at' for c in ctx.cookies())
        if ok: break
    if ok: pg.wait_for_timeout(600)
    pg.close()
    return ok

def run_state(b, state):
    who = {'guest': None, 'intro': 'intro@x.com', 'person': 'person@x.com'}[state]
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    if who:
        rec(f'[{state}] 로그인', login(ctx, who))
    tok = token(who) if who else None
    dash = api('/partner/dashboard', tok)[1] if tok else None
    partner = bool(dash and dash.get('status') == 'ACTIVE')
    checked = {}
    for path in PAGES:
        errs = []
        pg = ctx.new_page()
        # v10.29 — 시안 글꼴(Google Fonts)을 바깥에서 받습니다. 바깥으로 못 나가는 검정 환경의 그 요청 실패는 화면 결함이 아니라 셈에서 뺍니다
        pg.on('console', lambda m, errs=errs: errs.append(m.text) if m.type == 'error' and not any(h in ((m.location or {}).get('url') or '') for h in ('fonts.googleapis.com', 'fonts.gstatic.com')) else None)
        pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
        r = pg.goto(SITE + path, wait_until='networkidle')
        t = body_text(pg)
        rec(f'[{state}] {path} HTTP 200', r and r.status == 200, r and r.status)
        rec(f'[{state}] {path} Application error 없음', 'Application error' not in pg.content())
        rec(f'[{state}] {path} 콘솔 오류 0', not errs, errs[:3])
        # 결정 10/2 — 위쪽 띠(상담 신청하기 · 인증업체 등록 탭)와 시연 「보는 사람」 전환이 없어야 합니다
        if path.startswith('/mall'):
            rec(f'[{state}] {path} 띠 · 시연 「보는 사람」 없음',
                '보는 사람' not in t and '상담 신청하기' not in t and '시연' not in t and pg.locator('.malview, [data-x=malview]').count() == 0, t[:120])
        # 링크 전수
        bad = []
        for u in links_of(pg):
            if u in checked:
                if checked[u] != 200: bad.append((u, checked[u]))
                continue
            try:
                st = ctx.request.get(u, timeout=30000, max_redirects=10).status
            except Exception as e:  # noqa
                st = str(e)[:60]
            checked[u] = st
            if st != 200: bad.append((u, st))
        rec(f'[{state}] {path} 내부 링크 전부 200', not bad, bad[:5])
        # 390px
        pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
        ov = overflow(pg)
        rec(f'[{state}] {path} 390px 가로 넘침 없음', ov <= 0, f'{ov}px')
        if state in ('guest', 'intro') and path in ('/mall', '/mall?axis=consult', '/mall/give', '/consult?cat=CSL_MOVING'):
            tag = f"{state}_{path.strip('/').replace('/', '_').replace('?', '_').replace('=', '-') or 'root'}"
            pg.screenshot(path=SHOT.format(tag + '_390'), full_page=True)
            pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_timeout(300)
            pg.screenshot(path=SHOT.format(tag + '_1280'), full_page=True)
        pg.set_viewport_size({'width': 1280, 'height': 900})

        # ── 화면별 대조 ──
        if path == '/mall':
            # v10.29 — /mall 첫 화면이 시안 관 배치(components/gwan/GwanLanding)로 바뀜. 같은 기능을 새 모양으로 확인합니다:
            #   축 탭 .gw-axt(.gw-axbar) · 사진 카드 a.gw-pgc(한 쪽 6칸 — 예전은 첫 쪽 20) · 분류 .gw-catl a.gw-gi(골든 · 실버 · 브론즈로 묶어 순서가 다름 → 이름 집합으로 견줌)
            #   등록 a.gw-mylist[data-role] · 급매 띠 .gw-axurg(예전 .mal-filters 「급구」) · 검색줄 → 검색 팝업 → 통합 검색(gwanCode=MAL)(예전 .mal-find 의 keyword 폼 — ?keyword= 주소는 그대로 받음)
            rec(f'[{state}] /mall 축 탭 3개(기계 · 설비 · 시설 · 부동산 · 생활 · 금융 상담 — 시안)', pg.locator('.gw-axt').count() == 3
                and all(x in pg.locator('.gw-axbar').inner_text() for x in ('기계 · 설비 · 시설', '부동산', '생활 · 금융 상담')))
            rec(f'[{state}] /mall 인증업체만 게시 = API mal.partner_only({PARTNER_ONLY})',
                pg.locator(f'[data-partner-only="{PARTNER_ONLY}"]').count() == 1)
            L6 = api('/listings?gwanCode=MAL&axis=EQUIP&limit=6')[1]
            n = pg.locator('a.gw-pgc').count()
            exp = len(L6['organic']) + len(L6['promoted'])
            rec(f'[{state}] /mall 매물 카드 수 = API /listings 첫 쪽(한 쪽 6칸 · {exp})', n == exp, n)
            names = [x.replace('›', '').strip() for x in pg.locator('.gw-catl a.gw-gi').all_inner_texts()]
            rec(f'[{state}] /mall 매물 분류 = API 안심소개 업종 - 상담 업종({len(LCATS)})',
                sorted(names) == sorted(c['name'] for c in LCATS), names)
            side = pg.locator('a.gw-mylist[data-role]')
            if partner:
                rec(f'[{state}] /mall 입점 업체 → 「매물 등록」(/register)', side.count() == 1 and side.get_attribute('href') == '/register', side.all_inner_texts())
            else:
                rec(f'[{state}] /mall 일반 → 「소개합니다」(/mall/give)', side.count() == 1 and side.get_attribute('href') == '/mall/give', side.all_inner_texts())
            # v10.31 — 「공인중개사 매물 연동」 상자는 부동산 축(?axis=realty)에만 있습니다(시안)
            rec(f'[{state}] /mall 기본 축에는 중개사 매물 링크 없음', pg.locator('a[href="/mal/brokers"]').count() == 0)
            pg.goto(SITE + '/mall?axis=realty', wait_until='networkidle')
            rec(f'[{state}] /mall?axis=realty 중개사 매물 링크(/mal/brokers) · A-07 회신 대기 안내', pg.locator('a[href="/mal/brokers"]').count() == 1
                and 'A-07' in pg.locator('.gw-axnote').inner_text())
            pg.goto(SITE + '/mall', wait_until='networkidle')
            # 버튼: 분류 고르기
            if LCATS:
                c0 = LCATS[0]
                pg.locator('.gw-catl a.gw-gi', has_text=c0['name']).first.click(); pg.wait_for_url('**cat=**', timeout=15000); pg.wait_for_load_state('networkidle')
                cats = set(pg.locator('a.gw-pgc .gw-cc').all_inner_texts())
                api_c = api(f"/listings?gwanCode=MAL&limit=6&categoryId={c0['id']}")[1]
                api_n = len(api_c['organic']) + len(api_c['promoted'])
                rec(f'[{state}] /mall 분류 클릭 → cat= 필터 · 카드 수 API 와 같음', f"cat={c0['id']}" in pg.url and set(pg.locator('a.gw-pgc:not(.gw-adz a) .gw-cc').all_inner_texts()) <= {c0['name']}
                    and pg.locator('a.gw-pgc').count() == api_n, (pg.url, cats, api_n))
            # 버튼: 검색줄 → 검색 팝업 → 결과는 팝업에서 · 누르면 그 자리로(v10.40 대표 지시 · 「통합 검색 결과 보기」 줄 없음)
            pg.goto(SITE + '/mall', wait_until='networkidle')
            pg.locator('.gw-topcol input.si').click(); pg.wait_for_selector('.pc-spop #spopq', timeout=10000)
            pg.fill('.pc-spop #spopq', '사무실'); pg.wait_for_timeout(1500)
            allrow = pg.locator('.pc-spop [data-spop-all]').count() + ('통합 검색 결과 보기' in pg.inner_text('.pc-spop'))
            rws = pg.locator('.pc-spop #spopbd button.it'); nrow = rws.count(); t1 = rws.nth(0).locator('.t1').inner_text() if nrow else ''
            if nrow:
                rws.nth(0).click()
                try: pg.wait_for_load_state('networkidle')
                except Exception: pass
                pg.wait_for_timeout(800)
            u = urlparse(pg.url)
            rec(f'[{state}] /mall 검색줄(팝업) 「사무실」 → 결과가 팝업에 · 결과 보기 줄 없음 · 맨 위 결과를 누르면 그 자리로', allrow == 0 and u.path != '/search'
                and ((nrow > 0 and u.path != '/mall' and t1[:12] in pg.inner_text('body')) or (nrow == 0 and u.path == '/mall')), (allrow, nrow, t1[:20], pg.url))
            # 예전 주소 /mall?keyword= 는 그대로 거름
            pg.goto(SITE + '/mall?keyword=%EC%82%AC%EB%AC%B4%EC%8B%A4', wait_until='networkidle')
            api_kw = api('/listings?gwanCode=MAL&axis=EQUIP&limit=6&keyword=%EC%82%AC%EB%AC%B4%EC%8B%A4')[1]
            if pg.locator('a.gw-pgc').count() != len(api_kw['organic']) + len(api_kw['promoted']):
                # 목록은 30초 캐시합니다 — 다른 시험이 막 매물을 만들었으면 한 박자 늦습니다. 캐시가 지난 뒤 다시 비교합니다.
                pg.wait_for_timeout(32000); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(1500); pg.reload(wait_until='networkidle')
                api_kw = api('/listings?gwanCode=MAL&axis=EQUIP&limit=6&keyword=%EC%82%AC%EB%AC%B4%EC%8B%A4')[1]
            rec(f'[{state}] /mall?keyword=사무실(예전 주소) → API keyword 결과와 같은 수 · 검색 조건 줄에 표시', pg.locator('a.gw-pgc').count() == len(api_kw['organic']) + len(api_kw['promoted'])
                and '사무실' in pg.locator('.gw-catbar').inner_text() if pg.locator('.gw-catbar').count() else False, pg.url)
            # 버튼: 급매 띠 → 급구
            pg.goto(SITE + '/mall', wait_until='networkidle')
            # v10.31 (w2 시안) — 급매 띠 「보러 가기」는 「급구 · 급매」 화면(/money/urgent · 모든 관의 급구 · 급매 — GET /listings?urgent=)으로 감(전: 이 화면의 badge=URGENT 거르기)
            pg.locator('.gw-axurg a').click(); pg.wait_for_url('**/money/urgent**', timeout=15000); pg.wait_for_load_state('networkidle')
            rec(f'[{state}] /mall 급매 띠 「보러 가기」 → 「급구 · 급매」 화면(/money/urgent)', '/money/urgent' in pg.url and ('급구' in pg.inner_text('main') and '급매' in pg.inner_text('main')), pg.url)
            # 축 탭 클릭
            pg.goto(SITE + '/mall', wait_until='networkidle')
            pg.locator('a.gw-axt[data-axis="consult"]').click(); pg.wait_for_url('**axis=consult**', timeout=15000); pg.wait_for_load_state('networkidle')
            rec(f'[{state}] /mall 축 탭 클릭 → ?axis=consult', 'axis=consult' in pg.url and pg.locator('.mal-row').count() == len(CSL), pg.url)
        if path == '/mall?axis=consult':
            rows = pg.locator('.mal-row')
            rec(f'[{state}] 상담 축 업종 줄 = API /consult/categories({len(CSL)}) · 리드형 20 + 정액 노출형 2', rows.count() == len(CSL) == 22
                and len(LEADC) == 20 and len(DIRC) == 2, rows.count())
            okc = True; det = []
            for c in CSL:
                row = pg.locator(f'.mal-row[data-csl="{c["code"]}"]')
                # v10.24 — 줄마다 「상세 보기」(→ /mal/consult/코드) + 「상담 신청」(→ …/apply). 업종 이름도 상세로 가는 링크입니다. 법률 · 세무는 「사무소 보기」 하나
                a = row.locator(f'a.mal-btn[href="/mal/consult/{c["code"]}/apply"]').count()
                dlink = row.locator(f'a.mal-btn[href="/mal/consult/{c["code"]}"]').count()
                name = row.locator(f'a.mal-row-t[href="/mal/consult/{c["code"]}"]').count()
                d = row.locator('button[disabled]').count()
                rt = row.inner_text()
                gate = '자격 확인' in rt
                if c['consultMode'] == 'LISTING_FEE':
                    good = a == 0 and dlink == 1 and d == 0 and '광고' in rt and f'게재 {c["partnerCount"]}곳' in rt
                elif is_open(c):
                    good = a == 1 and dlink == 1 and d == 0 and f'인증업체 {c["partnerCount"]}곳' in rt
                else:
                    good = a == 0 and dlink == 1 and d == 1 and f'인증업체 {c["partnerCount"]}곳' in rt
                good = good and name == 1 and gate == (c['publishMode'] == 'GATED')
                if not good: okc = False; det.append(c['code'])
            rec(f'[{state}] 상담 축 줄마다 신청 가능 · 인증업체 수 · 자격 확인 · 광고(법률 · 세무) = API', okc, det)
            rec(f'[{state}] 상담 축 안내 「업체 1곳에만 전달」 · 예전 「최대 N곳」 문구 없음', '업체 1곳에만 전달' in t and '최대 ' not in t.split('먼저 확인할 것')[0], t[:200])
            cta = pg.locator('.gw-axcta a, .mal-cta a')   # v10.29 — 관 첫 화면의 상담 축 카드 단추는 .gw-axcta
            want = '/partner/leads' if partner else '/partner/apply'
            rec(f'[{state}] 상담 축 카드 버튼 → {want}', cta.first.get_attribute('href') == want, cta.first.inner_text())
            first = OPENC[0] if OPENC else None
            if first:
                pg.locator(f'.mal-row[data-csl="{first["code"]}"] a.mal-btn', has_text='상세 보기').click(); pg.wait_for_url(f'**/mal/consult/{first["code"]}'); pg.wait_for_load_state('networkidle')
                rec(f'[{state}] 「상세 보기」 클릭 → /mal/consult/{first["code"]} (업종 상세)', pg.url.endswith(f'/mal/consult/{first["code"]}') and pg.locator(f'[data-consult-detail="{first["code"]}"]').count() == 1, pg.url)
                pg.go_back(wait_until='networkidle')
                pg.locator(f'.mal-row[data-csl="{first["code"]}"] a.mal-btn', has_text='상담 신청').click(); pg.wait_for_url(f'**/mal/consult/{first["code"]}/apply'); pg.wait_for_load_state('networkidle')
                rec(f'[{state}] 「상담 신청」 클릭 → /mal/consult/{first["code"]}/apply (신청서)', pg.url.endswith(f'/mal/consult/{first["code"]}/apply') and pg.locator('form.mal-form').count() == 1, pg.url)
        if path == '/mall/give':
            bp = PLANS.get('BASIC')
            # v10.31 (W3 D060 · 시안 기준) — BASIC 포함 소개코드 0건이면 「무료 소개코드 없음 · 건당 N원」
            if bp['includedCodes'] > 0: rec(f'[{state}] 소개하기 안내 BASIC 월 {bp["includedCodes"]}건 = API', f'월 {bp["includedCodes"]}건' in t)
            else: rec(f'[{state}] 소개하기 안내 BASIC 무료 0건 = API — 「무료 소개코드 없음 · 건당 {bp["extraCodePrice"]:,}원」', f'무료 소개코드 없음 · 건당 {bp["extraCodePrice"]:,}원' in t, t[:120])
            rec(f'[{state}] 소개하기 안내 추가 단가 = API', f'{bp["extraCodePrice"]:,}원' in t)
            # 10/2 v10.9 — 「내 구독」 칸이 「이번 달 무료 소개코드 남은 수」(GET /me/referral-codes/quota)로 바뀌었습니다(D010)
            if tok:
                qt = api('/me/referral-codes/quota', tok)[1]
                rec(f'[{state}] 소개하기 안내 이번 달 무료 남은 수 = API /me/referral-codes/quota', pg.locator('[data-my-quota]').count() == 1
                    and pg.locator('[data-my-quota]').get_attribute('data-my-quota') == str(qt.get('freeRemaining')), (qt, pg.locator('[data-my-quota]').count()))
            else:
                rec(f'[{state}] 소개하기 안내 비로그인 — 내 소개코드 칸 없음', pg.locator('[data-my-quota]').count() == 0)
        if path == '/consult':
            opts = pg.locator('select[name=categoryId] option').all_inner_texts()
            rec(f'[{state}] /consult 신청서 업종 = 리드형 {len(LEADC)}종(법률 · 세무 제외) · GATED 표시', len([o for o in opts if '받는 업종이 없습니다' not in o]) == len(LEADC)
                and any('자격 업체만' in o for o in opts) and not any('법률' in o or '세무' in o for o in opts), opts[:5])
            rec(f'[{state}] /consult 로그인 없이도 신청서가 보임(로그인 화면으로 보내지 않음) · 업종 줄 {len(CSL)}', pg.locator('form.mal-form').count() == 1
                and pg.locator('.mal-row').count() == len(CSL) and pg.locator('[data-guest]').count() == (0 if tok else 1) and '/login' not in pg.url, pg.url)
        if path == '/consult?cat=CSL_CLEANING':
            mv = next(c for c in CSL if c['code'] == 'CSL_CLEANING')
            if is_open(mv):
                rec(f'[{state}] /consult?cat=CSL_CLEANING → 업종 미리 고름', pg.locator('select[name=categoryId]').input_value() == mv['id'])
            else:
                rec(f'[{state}] /consult?cat=CSL_CLEANING → 받을 업체 없음 안내', '아직 받지 않습니다' in t, t[:160])
        if path == '/mal/consult':
            rec(f'[{state}] /mal/consult 업종 목록 {len(CSL)}줄 · 「인증된 업체 1곳」 안내 · 입점 신청 링크', pg.locator('.mal-row').count() == len(CSL)
                and '인증된 업체 1곳' in t and pg.locator('.mal-cta a[href="/partner/apply"]').count() == 1, pg.locator('.mal-row').count())
        if path == '/mal/consult/CSL_CLEANING':
            mv = next(c for c in CSL if c['code'] == 'CSL_CLEANING')
            det = api('/consult/categories/CSL_CLEANING')[1]
            rec(f'[{state}] /mal/consult/CSL_CLEANING → 업종 상세(v10.24 · 신청서는 없음) · 인증업체 수 = API({det["partnerCount"]}) · {"「상담 신청」 → …/apply" if is_open(mv) else "단추 막힘 + 사유"}',
                pg.locator('[data-consult-detail="CSL_CLEANING"]').count() == 1 and pg.locator('form.mal-form').count() == 0 and f'{det["partnerCount"]}곳' in pg.locator('.mal-cd-stats').inner_text()
                and ((pg.locator('a.mal-cd-go[href="/mal/consult/CSL_CLEANING/apply"]').count() == 1) if is_open(mv) else (pg.locator('.mal-cd-bar button[disabled]').count() == 1 and pg.locator('a.mal-cd-go').count() == 0)), t[:160])
        if path == '/mal/consult/CSL_CLEANING/apply':
            mv = next(c for c in CSL if c['code'] == 'CSL_CLEANING')
            rec(f'[{state}] /mal/consult/CSL_CLEANING/apply → {"신청서(업종 고정)" if is_open(mv) else "받을 업체 없음 안내"}',
                (pg.locator('form.mal-form').count() == 1 and pg.locator('select[name=categoryId]').count() == 0 and pg.locator('input[name=phone]').count() == 1)
                if is_open(mv) else (pg.locator('form.mal-form').count() == 0 and '아직 받지 않습니다' in t), t[:160])
        if path == '/mal/consult/CSL_LEGAL':
            d = api('/consult/directory/CSL_LEGAL')[1]
            rec(f'[{state}] /mal/consult/CSL_LEGAL → 사무소 보기(광고 · 직접 연락 · 신청서 없음) · 게재 수 = API({len(d["entries"])})',
                pg.locator('[data-consult-dir="CSL_LEGAL"]').count() == 1 and pg.locator('form.mal-form').count() == 0 and '직접 연락' in t and '광고' in t
                and pg.locator('[data-dir-entry]').count() == len(d['entries']) and ('게재 중인 사무소가 없습니다' in t) == (len(d['entries']) == 0), t[:160])
        pg.close()

    # ── 상담 신청 실제 제출 1건 (D018 — 인증번호 확인 → 인증업체 1곳) ──
    #   로그인한 새 회원으로 합니다(「내 상담 신청」까지 확인). 받을 업체가 있는 업종 · 지역이 있어야 전달됩니다 —
    #   시드 파트너(intro@x.com)가 「청소 · 서울 금천구」를 받습니다(local-setup.sh). 끝나면 운영 API 로 그 신청을 종료해
    #   시드 파트너의 미열람 배정(한도 예약)이 쌓이지 않게 합니다.
    if state == 'person':
        fresh = f'webmal_{random.randint(10**7, 10**8 - 1)}@t.local'
        req = urllib.request.Request(API + '/auth/signup', method='POST', headers={'Content-Type': 'application/json'},
                                     data=json.dumps({'email': fresh, 'password': PW, 'name': '안심실측', 'agreedTerms': []}).encode())
        urllib.request.urlopen(req, timeout=30).read()
        ctx.close(); ctx = b.new_context(viewport={'width': 1280, 'height': 900})
        rec('[person] 제출용 새 회원 로그인', login(ctx, fresh), fresh)
        tok = token(fresh)
        before = api('/me/consult-requests', tok)[1]
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        cl = next(c for c in CSL if c['code'] == 'CSL_CLEANING')
        pg.goto(SITE + '/consult?cat=CSL_CLEANING', wait_until='networkidle')
        if not is_open(cl):
            rec('[person] 청소 업종에 받을 인증업체가 없어 제출 시험을 할 수 없음', False, cl)
        else:
            phone = f'010-{random.randint(2000, 9999)}-{random.randint(1000, 9999)}'
            pg.fill('input[name=name]', '실측신청')
            pg.fill('input[name=phone]', phone); pg.fill('input[name=email]', 'consult.test@example.com')
            pg.select_option('select[name=sido]', '서울'); pg.fill('input[name=sigungu]', '금천구')
            pg.fill('textarea[name=memo]', '다음 달 사무실 청소 상담 원합니다 — web_mal 실측')
            pg.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click(); pg.wait_for_timeout(800)   # v10.31 (w2 시안 CSL-030) — 한 장 신청서: 휴대폰 칸 옆 「인증번호 받기」(data-csl-otp) → 맨 아래 「상담 신청」(submit)
            rec('[person] 동의 없이 「인증번호 받고 신청」 → 화면이 막고 사유 표시', '동의해야 신청할 수 있습니다' in body_text(pg) and pg.locator('[data-consult-verify]').count() == 0)
            pg.check('input[name=agree]')
            pg.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click()
            pg.wait_for_selector('[data-consult-verify], .notice.warn', timeout=15000)
            ver = pg.locator('[data-consult-verify]')
            code = pg.locator('[data-dev-code]').get_attribute('data-dev-code') if pg.locator('[data-dev-code]').count() else None
            rec('[person] 「인증번호 받고 신청」 → 휴대폰 확인 단계(개발 환경 인증번호 표시) · 아직 「내 상담 신청」 없음', ver.count() == 1 and bool(code)
                and len(api('/me/consult-requests', tok)[1]) == len(before), (code, pg.locator('.notice.warn').all_inner_texts()[:1]))
            pg.fill('input[name=otp]', '000000' if code != '000000' else '111111')
            pg.locator('form.mal-form button[type=submit]').click(); pg.wait_for_timeout(1500)
            rec('[person] 틀린 인증번호 → 서버 사유 표시 · 전달 안 됨', '인증번호가 맞지 않습니다' in body_text(pg) and len(api('/me/consult-requests', tok)[1]) == len(before))
            pg.fill('input[name=otp]', code or '')
            pg.locator('form.mal-form button[type=submit]').click()
            pg.wait_for_selector('[data-consult-done]', timeout=15000)
            done = pg.locator('[data-consult-done]')
            lid = done.get_attribute('data-consult-done'); stt = done.get_attribute('data-consult-state')
            after = api('/me/consult-requests', tok)[1]
            new = [m for m in after if m['id'] == lid]
            rec('[person] 인증번호 확인 → 전달 화면(DELIVERED) · 서버에 1건 · 인증업체 1곳에 보냄',
                stt == 'DELIVERED' and bool(lid) and len(after) == len(before) + 1 and new and new[0]['categoryName'] == '청소' and new[0]['sentTo'] == 1
                and '1곳' in done.inner_text(), (stt, lid, len(before), len(after), new[:1]))
            pg.wait_for_timeout(1500)
            pg.screenshot(path=SHOT.format('person_consult_done_1280'), full_page=True)
            pg.locator('button', has_text='새로 신청').click(); pg.wait_for_timeout(500)
            rec('[person] 「새로 신청」 → 신청서로 돌아감', pg.locator('form.mal-form').count() == 1 and pg.locator('input[name=phone]').count() == 1)
            pg.reload(wait_until='networkidle')
            art = pg.locator(f'[data-consult="{lid}"]')
            rec('[person] 「내 상담 신청」에 새 건 표시(업체 1곳에 보냄)', art.count() == 1 and '업체 1곳에 보냄' in art.inner_text(), art.inner_text()[:120] if art.count() else '')
            # 같은 번호 · 같은 업종 재신청 → 서버 사유가 화면에
            pg.goto(SITE + '/consult?cat=CSL_CLEANING', wait_until='networkidle')
            pg.fill('input[name=name]', '실측신청'); pg.fill('input[name=phone]', phone); pg.fill('input[name=email]', 'consult.test@example.com')
            pg.select_option('select[name=sido]', '서울'); pg.fill('input[name=sigungu]', '금천구')
            pg.check('input[name=agree]')
            pg.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click()
            pg.wait_for_selector('.notice.warn', timeout=15000)
            rec('[person] 같은 번호 · 같은 업종 재신청 → 서버 거부 사유 표시 · 건수 그대로', len(api('/me/consult-requests', tok)[1]) == len(before) + 1
                and '이미 신청' in pg.locator('.notice.warn').inner_text(), pg.locator('.notice.warn').inner_text())
            # 정리 — 시드 파트너의 미열람 배정을 거둡니다(운영 종료 API)
            if lid:
                st_c, _ = api(f'/admin/leads/{lid}/close', token('admin@x.com'), 'POST', {'reason': 'web_mal 실측 신청 — 시험 뒤 정리'})
                rec('[person] (정리) 시험 신청을 운영 API 로 종료', st_c < 300, st_c)
        rec('[person] 제출 중 스크립트 오류 0', not errs, errs[:3])
        pg.close()
    ctx.close()

def other_gwans(b):
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    for g in ('/money', '/biz', '/health'):
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
        r = pg.goto(SITE + g, wait_until='networkidle')
        if g == '/health':
            ok_g = pg.locator('[data-shop-listings] .quick a').count() == 3      # v10.25 — 소개몰(/health)은 새 메인 아래의 「도매 · 납품 매물」 구역에 거르기 단추가 있습니다
        else:
            # v10.29 — 소개장터 · 소개창업도 시안 관 첫 화면(GwanLanding · .gw[data-gw])으로 바뀜. 예전 .page-head .quick(전체 · 급구 · 서류 확인) 대신
            #           그 관의 틀 · 찾기 폼이 있고, 안심소개만의 것(상담 축 탭 · 인증업체만 게시 안내 · 중개사 매물 링크)이 없는지 봅니다
            code = {'/money': 'MNY', '/biz': 'BIZ'}[g]
            ok_g = (pg.locator(f'.gw[data-gw="{code}"]').count() == 1 and pg.locator('form.gw-fbar').count() == 1
                    and pg.locator('a.gw-axt[data-axis="consult"], [data-partner-only], a[href="/mal/brokers"]').count() == 0
                    and pg.locator('.gw-axt').count() == (0 if code == 'MNY' else 4))   # v10.31 — 소개창업 시안 4축(창업 · 인력 · 운영지원 · 정보)
        rec(f'[다른 관] {g} 200 · 안심소개 구성 안 섞임', r.status == 200 and pg.locator('.mal-axbar, .mal-lay').count() == 0
            and ok_g and not errs, (r.status, errs[:2]))
        pg.close()
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    for st in ('guest', 'intro', 'person'):
        run_state(b, st)
    other_gwans(b)
    b.close()

res = {'site': SITE, 'pass': sum(i['ok'] for i in items), 'total': len(items), 'items': items}
json.dump(res, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(f"\n{res['pass']}/{res['total']}  → {OUT}")
sys.exit(0 if res['pass'] == res['total'] else 1)
