"""SB-HOM-MAIN-010 (로그인) · SB-HOM-MAIN-011 (비로그인) — 새 메인(「hero 페이지」 디자인 · v10.13) 실측.

사용:  SITE=http://localhost:5174 python3 web_main.py
       API=http://localhost:3000/api/v1 (기본값)
결과:  web_main.json  {"pass":n,"total":n,"items":[...]}
캡처:  web_main_{guest,intro}_{1280,390}.png

보는 것
  1. 메인만 새 헤더 · 푸터 (다른 화면은 공통 헤더 · 푸터 그대로 — 화면을 옮겨 다닐 때도)
  2. 구역 12개가 그림 순서대로 있고, 사진 · 아이콘 · 로고가 그림에서 잘라 낸 것(/home/d/*.png)
  3. 내용 — 기본(sample): 그림의 내용 그대로(사장님 결정) + 푸터에 「디자인 예시」 한 줄
            HOME_CONTENT=live 로 띄운 사이트: 실제 API 응답과 같고, 지어낸 숫자가 없고, 준비 중인 칸은 「준비 중」 · 「예시」
  4. 검색 탭 · 검색 · 칩 · 안내 카드 넘기기 · 광고 기록 · PICK 화살표
  5. 링크 전수 200 · 그림 전부 뜸 · 콘솔 오류 0 · 390px 가로 넘침 없음
"""
import json, os, re, sys, urllib.request
from urllib.parse import urlparse, urljoin, unquote
from playwright.sync_api import sync_playwright

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
API = os.environ.get('API', 'http://localhost:3000/api/v1').rstrip('/')
OUT = os.path.dirname(os.path.abspath(__file__))
PW = 'sgb-dev-1234'
BAD = ['Application error', 'This page could not be found', 'Internal Server Error', 'Unhandled Runtime Error']

items = []
def rec(state, name, ok, detail=''):
    items.append({'state': state, 'name': name, 'pass': bool(ok), 'detail': str(detail)[:400]})
    print(('PASS' if ok else 'FAIL'), state, name, str(detail)[:200], file=sys.stderr)

def api(path, token=None):
    req = urllib.request.Request(API + path)
    if token: req.add_header('Authorization', 'Bearer ' + token)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

def api_token(email):
    req = urllib.request.Request(API + '/auth/login', method='POST',
        data=json.dumps({'email': email, 'password': PW}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())['accessToken']

GWAN_PATH = {'MNY': 'money', 'MAL': 'mall', 'BIZ': 'biz', 'HLT': 'health'}
# v10.29 — 공통 머리줄 · 바닥줄이 시안 모양으로 바뀜: header.hd → header.pc-hd(로고 a.pc-lg · 가운데 nav.pc-gnb · 오른쪽 .pc-hr) · footer.ft → footer.pc-ft
HD, FT, LOGO = 'header.pc-hd', 'footer.pc-ft', 'header.pc-hd a.pc-lg'
EXT_FONT = lambda m: 'fonts.googleapis.com' in ((m.location or {}).get('url') or '') or 'fonts.gstatic.com' in ((m.location or {}).get('url') or '')   # v10.29
vis_txts = lambda pg, sel: pg.eval_on_selector_all(sel, 'e=>e.filter(x=>x.offsetParent).map(x=>x.textContent.trim())')   # v10.29 — 보이는 것만(좁은 화면용 .m-only 제외)
txts = lambda pg, sel: pg.eval_on_selector_all(sel, 'e=>e.map(x=>x.textContent.trim())')
hrefs = lambda pg, sel: pg.eval_on_selector_all(sel, 'e=>e.map(x=>x.getAttribute("href"))')

def scroll_all(pg):
    """지연 로딩 그림까지 띄웁니다."""
    pg.evaluate("""async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=500){scrollTo(0,y);await new Promise(r=>setTimeout(r,90));}scrollTo(0,0);}""")
    pg.wait_for_timeout(500)

def run_state(br, state, email):
    ctx = br.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    cons, perrs, bad_api, posts = [], [], [], []
    fonts_ext = []   # v10.29
    # v10.29 — 시안 글꼴(Google Fonts)을 바깥에서 받습니다. 바깥으로 못 나가는 검정 환경에서는 그 요청만 실패하므로 따로 셉니다(화면 결함 아님 · 글꼴은 대체 글꼴로)
    pg.on('console', lambda m: (fonts_ext if EXT_FONT(m) else cons).append(m.text[:200]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: perrs.append(str(e)[:200]))
    def onresp(res):
        u = urlparse(res.url)
        if u.path.startswith('/api/') and res.status >= 400: bad_api.append(f'{res.status} {res.request.method} {u.path}')
        if u.path.startswith('/api/v1/ads/') and res.request.method == 'POST': posts.append((u.path, res.status))
    pg.on('response', onresp)

    token = None
    if email:
        pg.goto(SITE + '/login')
        __import__('consent_ok').agree(email, PW); pg.fill('input[name=email]', email); pg.fill('input[name=password]', PW)
        pg.click('form.auth button'); pg.wait_for_timeout(2500)
        names = [c['name'] for c in ctx.cookies()]
        rec(state, '로그인 쿠키', 'sgb_at' in names, ','.join(names))
        token = api_token(email)
        cons.clear(); perrs.clear(); bad_api.clear()
        posts.clear()      # v10.30 — 로그인 직후 들르는 소개장터 메인(/money)의 맨 위 광고(GHERO)가 노출을 기록합니다. 아래는 **메인의 광고 장**만 보는 점검이라 여기서 비웁니다

    # ── 1) 열기 ──
    resp = pg.goto(SITE + '/', wait_until='networkidle')
    body = pg.inner_text('body')
    rec(state, 'HTTP 200', resp and resp.status == 200, str(resp.status if resp else None))
    rec(state, '오류 문구 없음', not any(b in body for b in BAD))
    # 안내 카드는 7초마다 저절로 넘어갑니다 — 「처음 보이는 장」과 「그때까지의 광고 노출 기록」은 열자마자 읽어 둡니다
    # (느린 환경에서는 아래 단계를 도는 사이에 광고 장까지 넘어가 노출이 정상적으로 기록됩니다)
    first = pg.evaluate("(()=>{const s=document.querySelector('.home-ps'),n=document.querySelector('.home-pno'),t=document.querySelector('.home-ptag'),a=document.querySelector('.home-partimg');return {slide:s&&s.getAttribute('data-slide'),pno:n?n.innerText:'',tag:t?t.innerText:'',body:s?s.innerText:'',art:a&&a.getAttribute('src')}})()")
    pg.wait_for_timeout(800)
    first_imp = [p for p in posts if p[0].endswith('/impression')]
    pg.hover('.home-promo')      # 올려 두면 멈춥니다 — 아래 점검이 끝날 때까지 같은 장
    scroll_all(pg)

    gw = api('/gwans')
    live = [g['code'] for g in gw if g.get('isActive', True)]
    gnav = [g for g in gw if g.get('isActive', True) and g['code'] in GWAN_PATH]

    mode = pg.get_attribute('.home', 'data-content')
    rec(state, f'내용 판 = {mode}', mode in ('sample', 'live'), mode)

    # ── 2) 메인 전용 헤더 · 푸터 ──
    rec(state, '메인 전용 헤더 1개 · 공통 헤더 없음', pg.locator('.home-hd').count() == 1 and pg.locator(HD).count() == 0)   # v10.29
    nav_t, nav_h = txts(pg, '.home-nav a'), hrefs(pg, '.home-nav a')
    rec(state, '헤더 메뉴 = 관 이름(/gwans) + 소개광장 + 이용안내',
        nav_t == [g['name'] for g in gnav] + ['소개광장', '이용안내'] and nav_h == ['/' + GWAN_PATH[g['code']] for g in gnav] + ['/community', '/guide'], f'{nav_t} {nav_h}')   # v10.31 (w1) — 이용안내 화면 /guide
    rec(state, '메뉴 이름 「소개몰」(v10.25 — 10/7 결정 · 전에는 「소개뱅크몰」)', '소개몰' in nav_t and '소개뱅크몰' not in nav_t, str(nav_t))
    hr_t, hr_h = txts(pg, '.home-hdr a.home-pill'), hrefs(pg, '.home-hdr a.home-pill')
    if email: rec(state, '헤더 오른쪽 — 나의공간 · 소개받기', hr_t == ['나의공간', '소개받기'] and hr_h == ['/my', '/request'], f'{hr_t} {hr_h}')
    else: rec(state, '헤더 오른쪽 — 로그인 · 무료 회원가입', hr_t == ['로그인', '무료 회원가입'] and hr_h == ['/login', '/signup'], f'{hr_t} {hr_h}')
    rec(state, '헤더 검색 아이콘 → 히어로 검색칸(#home-q · 검색 팝업 · v10.40 시안) · 로고 → / · 로고는 그림에서 잘라 낸 것', pg.get_attribute('.home-hd .home-icbtn', 'href') == '#home-q'
        and pg.get_attribute('.home-hd .home-logo', 'href') == '/' and pg.get_attribute('.home-hd .home-logo img', 'src') == '/home/d/logo.png')
    rec(state, '메인 전용 푸터 1개 · 공통 푸터 없음', pg.locator('.home-ft').count() == 1 and pg.locator(FT).count() == 0)   # v10.29
    ft = pg.inner_text('.home-ft')
    fl = api('/footer-links')      # v10.31 (w1) — 서버 링크 전부를 서버 순서대로(운영정책 GUIDE 포함)
    rec(state, '푸터 약관 · 고객센터 링크 = /footer-links', all(l['label'] in ft for l in fl) and len(txts(pg, '.home-ftl > *')) == len(fl), str(len(fl)))
    rec(state, '푸터 법정 표시 — 사업자등록번호 · 통신판매업 · 통신판매중개자 고지', '사업자등록번호' in ft and '통신판매업' in ft and '통신판매중개자' in ft, ft[-200:])
    # v10.31 (w1) — 고객센터 추가 · 제휴 파트너센터는 로그인 뒤 · 운영 역할에는 광고 관리(/go/admin)
    want_q = ['/request'] + (['/partners'] if email else []) + ['/partner', '/ai/classify', '/ai/match', '/ai/profile', '/my', '/support/new']
    rec(state, '푸터 바로가기(소개받기 · 파트너센터 · AI 3 · 나의공간 · 고객센터)', hrefs(pg, '.home-quick a')[:len(want_q)] == want_q, str(hrefs(pg, '.home-quick a')))
    # v10.14 — 주소는 운영 화면에서 넣습니다(설정 sns.*). 넣은 것만 그 주소로 연결되고, 비어 있으면 「준비 중」입니다
    pubset = api('/site-settings/public')
    sns_set = [k for k in ('sns.facebook', 'sns.instagram', 'sns.x', 'sns.youtube') if (pubset.get(k) or '').startswith('https://')]
    sns_dom = pg.evaluate("[...document.querySelectorAll('.home-sns [data-sns]')].map(x=>[x.dataset.sns, x.tagName, x.getAttribute('href'), x.getAttribute('target'), x.getAttribute('rel')])")
    rec(state, f'사회관계망 아이콘 4개 — 주소를 넣은 {len(sns_set)}개만 그 주소로(새 창), 나머지는 링크가 아니라 「준비 중」', len(sns_dom) == 4
        and all((d[1] == 'A' and d[2] == pubset[d[0]] and d[3] == '_blank' and 'noopener' in (d[4] or '')) if d[0] in sns_set else (d[1] == 'SPAN' and d[2] is None) for d in sns_dom), str(sns_dom))
    rec(state, '저작권 연도 = 올해', f"© {__import__('datetime').date.today().year} 소개뱅크" in ft)

    # ── 3) 히어로 ──
    h1 = pg.inner_text('#home-h1')
    rec(state, '히어로 제목', '무엇을 찾고 계세요?' in h1 and '소뱅AI가 딱 맞는 소개를 이어드려요.' in h1.replace('\n', ''), h1)
    exp_tabs = ['AI 검색'] + [t for t, g in [('상품', 'HLT'), ('서비스', 'MNY'), ('업체', 'MAL'), ('창업', 'BIZ')] if g in live] + ['동네정보'] + (['사람/전문가'] if 'MAL' in live else [])
    rec(state, '검색 탭 = AI 검색 + 살아 있는 관 + 동네정보 + 사람/전문가', txts(pg, '.home-stab') == exp_tabs, str(txts(pg, '.home-stab')))
    chips = hrefs(pg, '.home-chip')
    rec(state, '추천 칩 4개 → /search?q=', len(chips) == 4 and all(c.startswith('/search?q=') for c in chips), str(len(chips)))

    # 히어로 오른쪽 카드 — HERO 광고(있으면 1번 장) + 안내. 그림이 「2 / 5」 장(전문가 포트폴리오)이라 그 장부터 엽니다
    n_house = sum(1 for g in (['MAL', 'BIZ', 'HLT']) if g in live) + 1
    pno = first['pno'] or pg.inner_text('.home-pno')
    total = int(pno.split('/')[1])
    has_ad = total == n_house + 1
    slide0 = first['slide']
    rec(state, '안내 카드 장수 = 광고(있으면) + 안내', total in (n_house, n_house + 1), f'{pno} ad={has_ad}')
    if 'MAL' in live:
        rec(state, '처음 보이는 장 = 그림의 장(전문가 포트폴리오 · 광고가 있으면 2번째)', slide0 == 'pf' and pno == (f'2 / {total}' if has_ad else f'1 / {total}')
            and first['tag'] == '전문가 포트폴리오' and '인기 포트폴리오를' in first['body']
            and first['art'] == '/home/d/promo-art.png', f'{slide0} {pno}')

    # ── 4) 오늘의 소개뱅크 ──
    if mode == 'live':
        def data_checks(final):
            prods = api('/health/products'); reqs = api('/requests?limit=4'); posts_ = api('/community/posts?limit=3')
            mal = api('/listings?gwanCode=MAL&limit=3')['organic']; biz = api('/listings?gwanCode=BIZ&limit=4&sort=POPULAR')['organic']
            mny = api('/listings?gwanCode=MNY&limit=3&sort=POPULAR')['organic']
            out = []
            out.append(('오늘의 소개뱅크 — 새로 들어온 상품 = /health/products 앞 3개',
                        txts(pg, '[data-rank=product] .home-rkl a span') == [p['name'] for p in prods[:3]]
                        and hrefs(pg, '[data-rank=product] .home-rkl a') == ['/health/p/' + p['code'] for p in prods[:3]]))
            out.append(('오늘의 소개뱅크 — 소개를 기다리는 요청 = /requests 앞 3건',
                        txts(pg, '[data-rank=request] .home-rkl a span') == [r['title'] for r in reqs[:3]]
                        and hrefs(pg, '[data-rank=request] .home-rkl a') == ['/request/' + r['id'] for r in reqs[:3]]))
            if posts_:
                out.append(('오늘의 소개뱅크 — 소개광장 = /community/posts 앞 3건', txts(pg, '[data-rank=community] .home-rkl a span') == [p['title'] for p in posts_[:3]]))
            else:
                out.append(('오늘의 소개뱅크 — 소개광장 글이 없으면 「첫 이야기」 안내 → /community', hrefs(pg, '[data-rank=community] .home-rkl a') == ['/community']))
            # 오늘의 PICK — 실제 상품 · 매물 · 요청, 순서: 상품 · 업체 · 창업 · 소개 · 요청 · 상품 · 업체 · 창업
            p = [x for x in prods if not x['soldOut']]
            exp = []
            if p[:1]: exp.append((p[0]['name'], '/health/p/' + p[0]['code']))
            if mal[:1]: exp.append((mal[0]['title'], '/mall/' + mal[0]['id']))
            if biz[:1]: exp.append((biz[0]['title'], '/biz/' + biz[0]['id']))
            if mny[:1]: exp.append((mny[0]['title'], '/money/' + mny[0]['id']))
            if reqs[:1]: exp.append((reqs[0]['title'], '/request/' + reqs[0]['id']))
            if p[1:2]: exp.append((p[1]['name'], '/health/p/' + p[1]['code']))
            if mal[1:2]: exp.append((mal[1]['title'], '/mall/' + mal[1]['id']))
            if biz[1:2]: exp.append((biz[1]['title'], '/biz/' + biz[1]['id']))
            got = list(zip(txts(pg, '.home-pk .home-pkb b'), hrefs(pg, '.home-pk')))
            out.append((f'오늘의 PICK {len(exp)}장 = 실제 상품 · 매물 · 요청', got == exp))
            price = txts(pg, '.home-pk[data-kind="상품"] strong')
            out.append(('PICK 상품 가격 = /health/products price', price[:1] == [f"{p[0]['price']:,}원"] if p else True))
            got_b = list(zip(txts(pg, '.home-st b'), hrefs(pg, '.home-st')))
            out.append(('최근 뜨는 창업 4건 = /listings BIZ 인기순', got_b == [(x['title'], '/biz/' + x['id']) for x in biz[:4]]))
            if all(ok for _, ok in out) or final:
                for n, ok in out: rec(state, n, ok)
                return True
            return False
        if not data_checks(False):
            # 메인은 목록을 30초 캐시합니다(apiGet revalidate). 다른 시험이 막 매물을 만들었으면 화면이 한 박자 늦습니다 —
            # 캐시가 지난 뒤 두 번 다시 열어 비교합니다. 그래도 다르면 진짜 불일치입니다.
            pg.wait_for_timeout(62000); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(1500); pg.reload(wait_until='networkidle'); scroll_all(pg)
            data_checks(True)

        bn = pg.get_attribute('.home-bn .home-dark', 'href')
        rec(state, '큰 배너 → 소개장터 인기순(/money?sort=POPULAR)', bn == ('/money?sort=POPULAR' if 'MNY' in live else '/search'), bn)
    else:
        t0 = pg.inner_text('.home-band.today')
        rec(state, '오늘의 소개뱅크 — 큰 배너 = 그림(가을 나들이 맛집 TOP 10) · 배너 그림은 잘라 낸 것', '가을 나들이 맛집' in t0 and 'TOP 10' in t0 and '지금 가장 많이 찾는 곳' in t0
            and pg.get_attribute('.home-bn > img', 'src') == '/home/d/banner.png' and pg.get_attribute('.home-bn .home-dark', 'href') == '/community')
        exp_rk = (['인기 급상승 상품'] if 'HLT' in live else []) + ['소개를 기다리는 요청', '판교 · 분당']
        rec(state, '순위 카드 = 그림(인기 급상승 상품 · 소개를 기다리는 요청 · 판교 · 분당)', txts(pg, '.home-rk h3') == exp_rk
            and (txts(pg, '[data-rank=product] .home-rkl a span') == ['음식물처리기', '에어프라이어', '커피머신'] if 'HLT' in live else True)
            and txts(pg, '[data-rank=request] .home-rkl a span') == ['세무 상담이 필요해요', '상가 인테리어 업체', '학원 강사 구해요']
            and txts(pg, '[data-rank=community] .home-rkl a span') == ['판교 가족식당', '분당 의원', '정자동 카페'], txts(pg, '.home-rk h3'))
        rec(state, '순위 카드의 줄을 누르면 실제 화면으로(상품 검색 · 소개받기 · 소개광장)',
            (hrefs(pg, '[data-rank=product] .home-rkl a')[0].startswith('/health/search?q=') if 'HLT' in live else True)
            and hrefs(pg, '[data-rank=request] .home-rkl a') == ['/request'] * 3 and hrefs(pg, '[data-rank=community] .home-rkl a') == ['/community'] * 3)
        rec(state, '오늘의 PICK 5장 = 그림(제목 · 꼬리표 · 가격 · 할인율 · 별점)',
            txts(pg, '.home-pk .home-pkb b') == ['AI 음식물처리기 A1', '김현우 세무사', '무인 스터디카페 창업', '판교 가족식당 추천', '카페에서 중요한 것은?']
            and txts(pg, '.home-pk .home-bdg') == ['오늘 할인 TOP', '본사 검증', '관심 급상승', '내 주변', '1,842명 참여']
            and txts(pg, '.home-pk strong') == ['238,000원32%'] and [x.strip() for x in txts(pg, '.home-pk .home-rate')] == ['4.8 (532)', '4.9 (320)', '4.7 (118)', '4.8 (1,234)', '4.6 (1,842)'],
            txts(pg, '.home-pk .home-pkb b'))
        rec(state, 'PICK 사진 5장 = 그림에서 잘라 낸 것', pg.eval_on_selector_all('.home-pk .home-pki img', 'e=>e.map(x=>x.getAttribute("src"))') == [f'/home/d/pick-{i}.png' for i in range(1, 6)])
        rec(state, '최근 뜨는 창업 4장 = 그림(제목 · 꼬리표 · 사진)', txts(pg, '.home-st b') == ['무인카페 창업', '무인 편의점 창업', '반려동물 케어샵', '1인 온라인 스토어']
            and txts(pg, '.home-st .home-bdg') == ['관심 급상승 +30%', '3천만원 이하', '1인 운영', '무점포']
            and pg.eval_on_selector_all('.home-st .home-sti img', 'e=>e.map(x=>x.getAttribute("src"))') == [f'/home/d/start-{i}.png' for i in range(1, 5)])

    # ── 5) 관 5카드 · 안심소개 · 핵심 ──
    exp_need = [h for g, h in [('HLT', '/health'), ('MNY', '/money'), ('MAL', '/mall'), ('BIZ', '/biz')] if g in live] + ['/community']
    rec(state, '지금, 어떤 소개가 필요하세요? — 살아 있는 관 + 소개광장', hrefs(pg, '.home-nd') == exp_need, str(hrefs(pg, '.home-nd')))
    if 'MAL' in live:
        rec(state, '믿고 연결받는 안심소개 4장 → 상담 업종 · 안심소개 · 매물 목록 · 상담 신청',
            hrefs(pg, '.home-tr') == ['/mal/consult', '/mall', '/mall/list', '/consult'], str(hrefs(pg, '.home-tr')))
    rec(state, '소개뱅크 핵심 4개', hrefs(pg, '.home-core') == ['#home-q', '/ai/match', '/mall', '/request'] and
        txts(pg, '.home-core b') == ['AI로 찾고', '실시간으로 비교하고', '안심하고 소개받고', '좋은 연결로 이어져요'], str(hrefs(pg, '.home-core')))

    # ── 6) 이건 어때? · 우리동네 · 띠배너 ──
    txt = pg.inner_text('.home')
    rec(state, '띠배너 → /community · 양쪽 그림은 잘라 낸 것', pg.get_attribute('.home-strip', 'href') == '/community'
        and pg.get_attribute('.home-stl img', 'src') == '/home/d/strip-left.png' and pg.get_attribute('.home-str img', 'src') == '/home/d/strip-right.png')
    # v10.14 — 「이건 어때?」는 두 모드 모두 실제 투표입니다(D021). 참여 수는 서버의 실제 표 수, 그림의 3,482명 등은 쓰지 않습니다
    hp = api('/community/polls?scope=home')
    pc = pg.evaluate("[...document.querySelectorAll('.home-pl')].map(x=>[x.dataset.kind, x.dataset.poll||'', x.dataset.soon||'', x.querySelector('h3').textContent.trim(), (x.querySelector('[data-total]')||{textContent:''}).textContent.trim()])")
    want = []
    for k, t0 in (('VS', '로봇청소기를 산다면, 어느 쪽을 고르시겠어요?'), ('ASK', '소개받아 살 때 가장 먼저 보는 것은?'), ('USED', '공기청정기를 써 보신 분들의 의견을 들려주세요!')):
        x = next((q for q in hp if q['kind'] == k), None)
        want.append([k, x['id'], '', x['title'], f"{x['total']:,}명 참여"] if x else [k, '', '1', t0, ''])
    rec(state, '이건 어때? 3장 = 서버의 투표(종류마다 1건) · 참여 수 = 실제 표 수 · 없는 종류는 「준비 중」', txts(pg, '.home-pl > .home-bdg') == ['비교해요', '궁금해요', '써본 의견이 필요해요'] and pc == want, str(pc))
    rec(state, '이건 어때? — 그림의 예시 숫자(3,482 · 4,219 · 812명) 없음 · 투표 전에는 비율이 안 보임 · 「전체보기」는 투표 목록',
        not re.search(r'3,482|4,219|812명', pg.inner_text('.home-band.poll')) and pg.locator('.home-pl[data-voted="0"] li.res').count() == 0
        and pg.get_attribute('.home-band.poll .home-sh a', 'href') == '/community/polls')
    rec(state, '이건 어때? — 버튼(투표하기 · 투표하기 · 의견 남기기) 또는 「투표 보러 가기」', [x.strip() for x in txts(pg, '.home-pl .home-vbtn')] ==
        [('투표 보러 가기' if w[2] else c) for w, c in zip(want, ('투표하기', '투표하기', '의견 남기기'))], str(txts(pg, '.home-pl .home-vbtn')))
    if mode == 'live':
        rec(state, '지금 우리동네 — 3장 · 「준비 중」 · 거리 대신 「위치 연결 후 표시」', pg.locator('.home-tw').count() == 3
            and '준비 중' in pg.inner_text('.home-band.town .home-sh') and hrefs(pg, '.home-tw') == ['/community'] * 3
            and txt.count('위치 연결 후 표시') == 3 and not re.search(r'\d+\s?(m|km)\b', pg.inner_text('.home-band.town')))
        # 「이건 어때?」의 참여 수는 실제 표 수라 빼고 봅니다(위 poll 점검이 서버 값과 맞는지 봅니다)
        rest = pg.evaluate("(()=>{const c=document.querySelector('.home').cloneNode(true);const p=c.querySelector('.home-band.poll');if(p)p.remove();return c.textContent})()")
        fake = re.findall(r'\d[\d,]*명 참여|[0-5]\.\d\s?\(\d[\d,]*\)|후기 \d[\d,]*건', rest)
        rec(state, '지어낸 평점 · 참여 수 · 후기 수 없음', not fake and '김현우' not in txt, str(fake))
        rec(state, '그림 안내 문구(분류 그림 — 실제 사진 아님)', '실제 매물 · 상품의 사진이 아닙니다' in ft)
    else:
        rec(state, '지금 우리동네 3장 = 그림(동네픽 · 동네소개 · 동네참여 · 거리)', txts(pg, '.home-tw .home-bdg') == ['동네픽', '동네소개', '동네참여']
            and all(x in txt for x in ('판교역 300m', '정자동 500m', '분당구 1km')) and hrefs(pg, '.home-tw') == ['/community'] * 3)
        rec(state, '푸터에 「디자인 예시」 한 줄(실제 매물 · 상품 · 후기가 아님 · 「이건 어때?」 참여 수는 실제 표 수)', '디자인 예시입니다' in ft and '실제 매물 · 상품 · 후기가 아닙니다' in ft)

    # ── 7) 나를 위한 소개 ──
    if email:
        rec(state, '나를 위한 소개 → /ai/profile', hrefs(pg, '.home-fma a') == ['/ai/profile'], str(hrefs(pg, '.home-fma a')))
        sm = api('/me/summary', token)
        nums = txts(pg, '.home-fmi em')
        exp_n = [f"{sm['unreadNotifications']:,}", f"{sm['publishedListings']:,}", f"{sm['openDeals']:,}"]
        rec(state, '내 요약 = /me/summary', nums == exp_n, f'{nums} vs {exp_n}')
    else:
        rec(state, '나를 위한 소개 → 로그인 · 무료 회원가입', hrefs(pg, '.home-fma a') == ['/login', '/signup'], str(hrefs(pg, '.home-fma a')))

    # ── 8) 그림 · 링크 · 오류 ──
    broken_img = pg.eval_on_selector_all('.home img', 'e=>e.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.getAttribute("src"))')
    n_img = pg.locator('.home img').count()
    rec(state, f'그림 {n_img}장 전부 뜸', not broken_img and n_img >= 20, str(broken_img))
    srcs = pg.eval_on_selector_all('.home img', 'e=>e.map(i=>i.getAttribute("src"))')
    drawn = [x for x in srcs if not x.startswith('/home/d/')]
    rec(state, '사진 · 아이콘 · 로고는 전부 주신 그림에서 잘라 낸 것(/home/d)' + (' — 실제 데이터 카드의 분류 그림만 예외' if mode == 'live' else ''),
        (not drawn) if mode != 'live' else all(x.startswith('/home/t-') for x in drawn), str(sorted(set(drawn))[:5]))
    rec(state, '새로 그린 아이콘(svg.home-ic) 없음', pg.locator('.home svg.home-ic').count() == 0)
    links = hrefs(pg, 'a[href]')
    seen, broken = set(), []
    for h in links:
        if h.startswith('#'):
            if not pg.query_selector(h): broken.append(h + ' (앵커 없음)')
            continue
        u = urljoin(SITE + '/', h)
        if urlparse(u).netloc != urlparse(SITE).netloc or u in seen: continue
        seen.add(u)
        r = ctx.request.get(u, max_redirects=5)
        t = r.text()
        if r.status != 200 or any(b in t for b in BAD[:1]):
            broken.append(f'{r.status} {h}')
    rec(state, f'링크 전수 {len(seen)}개 200', not broken, '; '.join(broken))
    rec(state, '콘솔 오류 0' + (f' (바깥 글꼴 받기 실패 {len(fonts_ext)}건은 검정 환경 — 따로 셈)' if fonts_ext else ''), not cons and not perrs, '; '.join(cons + perrs)[:400])   # v10.29
    rec(state, 'API 4xx/5xx 0', not bad_api, '; '.join(bad_api))
    if has_ad:
        rec(state, '광고 장이 보이기 전에는 노출을 기록하지 않음', len(first_imp) == (1 if slide0 == 'ad' else 0), str(first_imp))
    pg.screenshot(path=f'{OUT}/web_main_{state}_1280.png', full_page=True)

    # ── 9) 동작 ──
    # 안내 카드는 7초마다 저절로 넘어갑니다(마우스를 올리면 멈춤). 느린 환경(Docker 개발 모드)에서는 위 단계 사이에 이미 넘어가 있을 수 있어
    # 마우스를 올려 멈춘 뒤 **지금 장**부터 셉니다.
    pg.hover('.home-promo'); pg.wait_for_timeout(200)
    now0, pno0 = pg.get_attribute('.home-ps', 'data-slide'), pg.inner_text('.home-pno')
    seen = [now0]
    for _ in range(total):
        pg.click('.home-pnext'); pg.wait_for_timeout(350)
        seen.append(pg.get_attribute('.home-ps', 'data-slide'))
    rec(state, f'안내 카드 「다음」 — {total}장을 돌아 처음으로', len(set(seen[:-1])) == total and seen[-1] == now0 and pg.inner_text('.home-pno') == pno0, str(seen))
    if has_ad:
        while pg.get_attribute('.home-ps', 'data-slide') != 'ad': pg.click('.home-pnext'); pg.wait_for_timeout(300)
        pg.wait_for_timeout(600)
        imp = [p for p in posts if p[0].endswith('/impression')]
        rec(state, '광고 장 — 「광고」 표시 · 광고주 이름 · 노출 기록 POST 2xx 한 번(여러 번 돌아와도)', pg.inner_text('.home-ptag') == '광고' and pg.locator('.home-padv').count() == 1
            and pg.get_attribute('.home-ps', 'data-adbox') == 'HERO' and len(imp) == 1 and 200 <= imp[0][1] < 300, f"{pg.inner_text('.home-ptag')} {imp}")
        posts.clear()
        url0 = pg.url
        pg.click('.home-ps.ad button.home-pcta')
        try: pg.wait_for_url('**/ad/**', timeout=15000)      # v10.31 (w1) — 광고 랜딩 미리보기 /ad/{id}
        except Exception: pg.wait_for_timeout(1500)
        clk = [p for p in posts if p[0].endswith('/click')]
        moved = pg.url != url0
        msg = pg.query_selector('.home-pmsg')
        rec(state, '광고 버튼 → 클릭 기록 + 이동/안내', clk and all(200 <= s < 300 for _, s in clk) and (moved or msg), f'{clk} moved={moved}')
        if moved: pg.goto(SITE + '/', wait_until='networkidle')
    if pg.get_attribute('.home-ps', 'data-slide') == 'ad': pg.click('.home-pnext'); pg.wait_for_timeout(300)
    cta = pg.get_attribute('.home-ps a.home-pcta', 'href')
    rec(state, '안내 장 버튼 → 실제 화면', cta in ('/mall', '/biz', '/health', '/request', '/community') and ctx.request.get(SITE + cta).status == 200, cta)

    pg.click('.home-go'); pg.wait_for_timeout(400)
    rec(state, '빈 검색 → 안내 문구', pg.query_selector('.home-sbmsg') is not None and urlparse(pg.url).path == '/')
    # v10.31 (w1) — 사용자 지시 「검색 기능은 시안과 동일하게」: 검색칸을 누르면 검색 팝업(.pc-spop)이 열리고, 탭이 팝업 결과를 거름.
    # v10.40 (대표 지시 2026-10-14) — 「검색 결과 보기 링크 삭제 · 결과는 팝업에 · 클릭 시 위치로」: 「통합 검색 결과 보기」 줄 없음 ·
    #   고른 줄 없이 Enter → 맨 위 결과의 자리(상세)로 · 결과가 없으면 팝업 그대로(결과 화면 /search 로 가지 않음).
    def pop(q, chip=False):
        if chip: pg.click('.home-chip >> nth=0')
        else: pg.click('#home-q')
        pg.wait_for_selector('.pc-spop.on', timeout=8000)
        if not chip: pg.fill('#spopq', q)
        pg.wait_for_timeout(1200)
        q = pg.input_value('#spopq')
        rows = pg.locator('.pc-spop #spopbd button.it')
        n = rows.count(); t1 = rows.nth(0).locator('.t1').inner_text() if n else ''
        allrow = pg.locator('.pc-spop [data-spop-all]').count() + ('통합 검색 결과 보기' in pg.inner_text('.pc-spop'))
        pg.press('#spopq', 'Enter')
        try: pg.wait_for_load_state('networkidle', timeout=10000)
        except Exception: pass
        pg.wait_for_timeout(1200)
        u = urlparse(pg.url); body = pg.inner_text('body')
        okk = (allrow == 0 and u.path != '/search' and not u.path.endswith('/search')
               and ((n == 0 and u.path == '/' and pg.locator('.pc-spop.on').count() == 1)
                    or (n > 0 and u.path != '/' and t1[:12] in body and not any(b in body for b in BAD))))
        return okk, f'{q} · 결과 줄 {n} · 맨 위 「{t1[:20]}」 · 결과 보기 줄 {allrow} → {unquote(pg.url.replace(SITE, ""))}', q
    if 'HLT' in live:
        pg.click('.home-stab[data-stab=product]'); pg.wait_for_timeout(200)
        rec(state, '탭 「상품」 → 몰 상품 검색으로 · 안내 문구 바뀜', pg.get_attribute('form.home-sb', 'action') == '/health/search'
            and pg.locator('form.home-sb input[name=gwanCode]').count() == 0, pg.get_attribute('#home-q', 'placeholder'))
        okk, d, _ = pop('혈압계')
        rec(state, '「상품」 팝업 「혈압계」 Enter → 맨 위 결과의 자리(결과 화면 아님 · 결과 보기 줄 없음)', okk, d)
        pg.goto(SITE + '/', wait_until='networkidle')
    if 'BIZ' in live:
        pg.click('.home-stab[data-stab=biz]'); pg.wait_for_timeout(200)
        okk, d, _ = pop('주방')
        rec(state, '탭 「창업」 팝업 「주방」 Enter → 맨 위 결과의 자리(결과 화면 아님)', okk, d)
        pg.goto(SITE + '/', wait_until='networkidle')
    okk, d, _ = pop('창업')
    rec(state, '「AI 검색」 팝업 「창업」 Enter → 맨 위 결과의 자리(결과 화면 아님)', okk, d)

    pg.goto(SITE + '/', wait_until='networkidle')
    okk, d, seed = pop('', chip=True)
    rec(state, '추천 칩 → 그 말로 검색 팝업 → Enter → 맨 위 결과의 자리', bool(seed) and okk, d)

    pg.goto(SITE + '/', wait_until='networkidle')
    over = pg.evaluate("(()=>{const r=document.querySelector('.home-rail');return r.scrollWidth>r.clientWidth+8})()")
    x0 = pg.evaluate("document.querySelector('.home-rail').scrollLeft")
    more = pg.get_attribute('.home-railnext', 'data-more')
    pg.locator('.home-railnext').scroll_into_view_if_needed(); pg.click('.home-railnext'); pg.wait_for_timeout(1200)
    if over:
        rec(state, 'PICK 화살표 → 옆으로 넘어감', pg.evaluate("document.querySelector('.home-rail').scrollLeft") > x0 + 100)
    else:
        rec(state, 'PICK 화살표 — 넘길 카드가 없으면(그림의 5장) 「전체보기」와 같은 곳으로', urlparse(pg.url).path == more, pg.url)
        pg.goto(SITE + '/', wait_until='networkidle')
    pg.click('.home-core[href="#home-q"]'); pg.wait_for_timeout(600)
    # v10.31 (w1) — 히어로 검색창으로 가서 검색 팝업을 엶(검색칸과 같은 동작)
    rec(state, '핵심 「AI로 찾고」 → 히어로 검색 팝업', pg.locator('.pc-spop.on').count() == 1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)

    # ── 10) 다른 화면은 그대로 — 화면을 옮겨 다닐 때도 머리 · 바닥이 맞게 바뀜 ──
    pg.goto(SITE + '/', wait_until='networkidle')
    # v10.30 — 메뉴의 첫 칸(소개장터)은 10/9 제시 디자인이라 제 머리줄(두 관 전용 틀 · 색조 money)을 씁니다(site_mny.py 가 봄).
    #   「공통 헤더 그대로」는 그 틀을 쓰는 관(안심소개 · 소개창업)으로 봅니다 — 둘 다 꺼져 있으면 전처럼 첫 칸
    navs = hrefs(pg, '.home-nav a'); first = next((h for h in navs if h in ('/mall', '/biz')), navs[0])
    pg.click('.home-nav a >> nth=%d' % navs.index(first))
    try: pg.wait_for_url('**' + first + '**', timeout=10000); pg.wait_for_load_state('networkidle')
    except Exception: pass
    pg.wait_for_timeout(600)
    rec(state, '메인 → 관(화면 전환) — 공통 헤더 · 푸터 · 본문 틀 그대로', pg.locator(HD).count() == 1 and pg.locator('.home-hd').count() == 0   # v10.29
        and pg.locator(FT).count() == 1 and pg.locator('.home-ft').count() == 0 and pg.get_attribute('main', 'class') == 'main', pg.url)
    # v10.29 — 시안 머리줄: 가운데 메뉴(관 · 소개광장 · 이용안내) + 오른쪽(소개받기 · 파트너센터 · 나의공간 · 🔔 · 로그인/무료 회원가입 | 로그아웃).
    #           예전 링크 넷(소개받기 · 소개광장 · 파트너센터 · 나의공간)이 머리줄 어딘가에 그대로 있는지 · 로그인 상태에 맞는 단추인지를 봅니다.
    old_nav = vis_txts(pg, f'{HD} .pc-gnb a') + vis_txts(pg, f'{HD} .pc-hr a')
    nav_href = dict(zip(vis_txts(pg, f'{HD} a'), pg.eval_on_selector_all(f'{HD} a', 'e=>e.filter(x=>x.offsetParent).map(x=>x.getAttribute("href"))')))
    keep = {'소개받기': '/request', '소개광장': '/community', '파트너센터': '/partners', '나의공간': '/my'}
    has_keep = all(nav_href.get(k) == v for k, v in keep.items())
    # v10.26 (G-181) — 기본 머리줄도 로그인 상태를 봅니다: 로그인 전 = 「로그인 · 회원가입」 링크 / 로그인 뒤 = 그 두 링크 대신 「로그아웃」 단추
    outs = vis_txts(pg, f'{HD} .pc-hr button.hd-out')
    if state == 'guest':
        rec(state, '공통 헤더 메뉴 그대로(소개받기 · 소개광장 · 파트너센터 · 나의공간 · 로그인 · 무료 회원가입)',
            has_keep and nav_href.get('로그인') == '/login' and nav_href.get('무료 회원가입') == '/signup' and outs == [], str((old_nav, outs)))
    else:
        rec(state, '공통 헤더 메뉴(소개받기 · 소개광장 · 파트너센터 · 나의공간) + 로그인 뒤에는 「로그아웃」(로그인 · 회원가입 링크 없음 — G-181)',
            has_keep and '로그인' not in nav_href and '무료 회원가입' not in nav_href and outs == ['로그아웃'], str((old_nav, outs)))
    pg.click(LOGO)   # v10.29
    try: pg.wait_for_url(SITE + '/', timeout=10000); pg.wait_for_load_state('networkidle')
    except Exception: pass
    # v10.30 — 메인 → 소개장터 메인(두 관 전용 머리줄 · 색조 money) → 로고 → 메인: 화면을 옮겨 다닐 때 머리 · 바닥이 맞게 바뀌는지
    if '/money' in hrefs(pg, '.home-nav a'):
        pg.wait_for_timeout(400); pg.click('.home-nav a[href="/money"]')
        try: pg.wait_for_url('**/money', timeout=10000); pg.wait_for_load_state('networkidle')
        except Exception: pass
        pg.wait_for_timeout(600)
        rec(state, '메인 → 소개장터 메인(화면 전환) — 두 관 전용 머리줄 · 바닥줄(색조 money) · 메인 전용 · 공통 헤더 없음', pg.locator('header.b2-hd').count() == 1 and pg.locator('[data-b2-tone=money]').count() == 1 and pg.locator('footer.b2-ft').count() == 1
            and pg.locator('.home-hd').count() == 0 and pg.locator(HD).count() == 0 and pg.get_attribute('main', 'class') == 'main main-b2 main-mny', pg.url)
        pg.click('header.b2-hd a.b2-logo')
        try: pg.wait_for_url(SITE + '/', timeout=10000); pg.wait_for_load_state('networkidle')
        except Exception: pass
    pg.wait_for_timeout(600)
    rec(state, '관 → 메인(로고) — 메인 전용 헤더 · 푸터로 바뀜', pg.locator('.home-hd').count() == 1 and pg.locator(HD).count() == 0   # v10.29
        and pg.locator('.home-ft').count() == 1 and 'main-home' in (pg.get_attribute('main', 'class') or ''), pg.url)
    r = pg.goto(SITE + '/mall', wait_until='networkidle')
    rec(state, '/mall 바로 열기 — 공통 헤더 · 푸터', r.status == 200 and pg.locator(HD).count() == 1 and pg.locator('.home-hd').count() == 0 and pg.locator(FT).count() == 1)   # v10.29

    # ── 11) 390px ──
    m = ctx.new_page(); m.set_viewport_size({'width': 390, 'height': 844})
    m.goto(SITE + '/', wait_until='networkidle'); m.wait_for_timeout(500)
    dims = m.evaluate('''()=>{
      const sw=document.documentElement.scrollWidth;
      const home=document.querySelector('.home'); const r=home.getBoundingClientRect();
      let worst=0, who='';
      home.querySelectorAll('*').forEach(el=>{
        // 가로로 미는 칸(메뉴 · 검색 탭 · 칩 · PICK 줄) 안의 항목과, 잘라 내는 틀(overflow hidden) 안의 장식은 제외
        if(el.closest('.home-nav,.home-stabs,.home-chips,.home-rail,.home-hero,.home-bn,.home-strip,.home-tw,.home-ps')&&!el.matches('.home-hero,.home-in')) return;
        const b=el.getBoundingClientRect(); if(b.width&&b.right>worst){worst=b.right; who=el.className||el.tagName;}
      });
      return {sw, homeRight:r.right, homeSW:home.scrollWidth, homeCW:home.clientWidth, worst, who:String(who)};
    }''')
    rec(state, '390px 메인 본문 가로 넘침 없음', dims['worst'] <= 390.5 and dims['homeSW'] <= dims['homeCW'] + 0.5, json.dumps(dims, ensure_ascii=False))
    rec(state, '390px 문서 전체 가로 스크롤 없음', dims['sw'] <= 390, f"scrollWidth={dims['sw']}")
    scroll_all(m)
    m.screenshot(path=f'{OUT}/web_main_{state}_390.png', full_page=True)
    ctx.close()

with sync_playwright() as p:
    br = p.chromium.launch()
    run_state(br, 'guest', None)
    run_state(br, 'intro', 'intro@x.com')
    br.close()

res = {'site': SITE, 'pass': sum(1 for i in items if i['pass']), 'total': len(items), 'items': items}
json.dump(res, open(f'{OUT}/web_main.json', 'w'), ensure_ascii=False, indent=1)
print(f"{res['pass']}/{res['total']}")
