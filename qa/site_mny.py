"""v10.30 소개장터 메인(/money) — 실제 웹 점검. 결과: site_mny.json  (v10.29 「시안 디자인 · 기능 반영」 위에 얹은 것)

  10/9 지시 — 「소개뱅크로 적용할 수 있도록 변환 · 이미지 그대로 사용」
  답 — ① 시안 + 실제 웹 모양(DB 변경 없음) ② 지금 있던 구역(인기 매물 · 바로가기)은 디자인 아래에 남김 ③ 디자인 시트는 소개장터에만 ④ 글꼴도 소개장터에만

  H. 머리 · 바닥   /money 한 화면만 두 관 전용 머리줄 · 바닥줄(색조 money) · 그 밖의 화면(소개장터의 아래 화면 포함)은 지금 그대로
  M. 메인          그림의 구역 가운데 서버에 자료가 있는 것 — 제목 · 검색 · 바로가기 3 · 분야 14 · 분류 목록 · 소개 요청 = 서버 자료 그대로 · 공급자 등록
  X. 넣지 않은 것  서버에 자료가 없는 구역(키워드 · 업체 추천 · AI 추천 · 띠 광고 · 연결 사례 · 지역 · 탭)과 견본 글자가 화면에 없음
  A. 광고          맨 위 광고 칸 = GET /ads/serve?slot=GHERO 의 소재 · 「광고」 표시 · 노출 1회 기록 · 클릭 기록
  O. 지금 있던 것  (#mny-list) 퀵메뉴 5 · 소개상품 찾기(구분 · 분류) · 검색 조건 줄 · 매물 사진 카드 = GET /listings 그대로 · 쪽 · 정렬 — v10.29 관 화면 부품 그대로
  L. 눌러서 가는 곳 분야 · 분류 → /money?keyword=…#mny-list (아래 목록을 그 낱말로 거름) · 요청 → /request/{번호} · 검색칸 → 검색 팝업 → /search?q=…&gwanCode=MNY
  P. 그림 · 글꼴   화면이 내주는 그림 = 받은 그림에서 자른 파일(점 하나까지) · 절반 크기 · 글꼴 5개는 /money 에서만 내려받음
  B. 알림 종       로그인하지 않으면 숫자 없음 · 로그인하면 읽지 않은 알림 수(GET /me/summary) · /cart-count 의 모양
  Z. 좁은 화면 · 화면 오류 · 자리 대조(그림 ↔ 화면)

사용:  python3 site_mny.py     SITE=http://localhost:5174 · API=http://localhost:3000
"""
import json, os, re, subprocess, sys, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright
from detail_fixture import call

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
OUT = os.path.dirname(os.path.abspath(__file__))
if not os.path.isdir(K + '/sgb'): K = os.path.dirname(OUT)
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:300], file=sys.stderr)
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
RGB = lambda h: 'rgb(%d, %d, %d)' % tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
TILES = [('전체', ''), ('가구, 인테리어', '가구'), ('청소, 방역', '청소'), ('이사, 운송', '이사'), ('중고 거래', '중고'), ('사무 용품', '사무'), ('제조, 유통', '제조'), ('공사, 시공', '공사'),
         ('디자인, 마케팅', '디자인'), ('IT, 개발', '개발'), ('세무, 노무', '세무'), ('교육, 컨설팅', '교육'), ('행사, 모임', '행사'), ('기타', '')]
SIDE = [('가구, 인테리어', '가구'), ('사무용품,전자기기', '사무용품'), ('중고 물품', '중고'), ('산업 장비', '장비'), ('기타 상품', ''),
        ('청소, 방역', '청소'), ('인테리어', '인테리어'), ('이사, 운송', '이사'), ('설치, 수리', '설치'), ('광고, 마케팅', '광고'), ('기타 서비스', '')]
kwhref = lambda k: ('/money?keyword=' + urllib.parse.quote(k) + '#mny-list') if k else '/money#mny-list'
QM = [['성공현황', '/money/new'], ['베스트매칭', '/money/best'], ['급구 · 급매', '/money/urgent'], ['사고예방', '/money/verified'], ['이벤트존', '/money/event']]
GFONT = ('fonts.googleapis.com', 'fonts.gstatic.com')      # v10.29 가 넣은 본고딕(Noto Sans KR · 구글 글꼴) — 바깥 인터넷이 막힌 시험 환경에서는 받지 못합니다(화면은 다음 글꼴로 그립니다)
SAMPLE = ['클린하우스', '한성 인테리어 파트너', '에어존 시스템', '김현우 세무사', '더존 인테리어', '스마트오피스', '판교 사무실 입주청소', '카페 테이블 20개', '많이 찾는 키워드', '최근 실제 연결 사례', 'AI 추천 맞춤 공급자', '서비스 업체 추천', '지역으로 찾기']

def get(u, redirect=True):
    class NoRedir(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    op = urllib.request.build_opener() if redirect else urllib.request.build_opener(NoRedir)
    try:
        r = op.open(urllib.request.Request(SITE + u, headers={'User-Agent': 'Mozilla/5.0 site_mny'}), timeout=60); return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read(), dict(e.headers)
    except Exception as e: return 0, repr(e).encode(), {}


def main():
    for u in ['/money', '/money/list', '/', '/community']: get(u)      # 기억해 둔 예전 자료가 아니라 지금 것을 보게 한 번씩 부릅니다
    _, reqs = call('GET', '/requests?gwanCode=MNY&limit=4'); _, lst = call('GET', '/listings?gwanCode=MNY&limit=6'); _, cats = call('GET', '/categories?gwanCode=MNY'); _, gws = call('GET', '/gwans')
    cats = [c for c in (cats or []) if not c.get('restricted')]     # v10.31 (w2) — GET /categories 가 제한 업종도 표시(restricted)와 함께 줌 · 화면의 고르기 칸에는 없음
    _, mreq = call('GET', '/market/requests?gwanCode=MNY&limit=24'); _, kws = call('GET', '/search/keywords?gwanCode=MNY&limit=5'); _, sups = call('GET', '/market/suppliers?gwanCode=MNY&limit=4')
    _, cases = call('GET', '/market/success/recent?gwanCode=MNY&limit=3'); _, regs = call('GET', '/market/regions?gwanCode=MNY')
    # 광고 칸(GHERO · 관 랜딩 상단)의 소재 — 서버가 그 칸의 소재 가운데 하나를 **무작위로** 고릅니다(ads.service.ts serve). 여러 번 받아 나올 수 있는 소재를 모아 둡니다
    ADS = {}
    for _i in range(24):
        _, a1 = call('GET', '/ads/serve?slot=GHERO')
        if a1 and not a1.get('empty'): ADS[a1['code']] = a1
    ad = next(iter(ADS.values()), None)
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1500, 'height': 1000}); pg = ctx.new_page()
        errs = []; bad = []; fonts = []; posts = []
        ext = []
        pg.on('console', lambda m: (ext if any(g in ((m.location or {}).get('url') or '') for g in GFONT) else errs).append(m.text[:160]) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:160]))
        pg.on('response', lambda r: (bad.append((r.status, r.url[-70:])) if r.status >= 400 else None, fonts.append(r.url.rsplit('/', 1)[-1]) if '/fonts/' in r.url and r.status == 200 and SITE in r.url else None))
        pg.on('request', lambda r: posts.append(r.url) if r.method == 'POST' and '/ads/' in r.url else None)
        pg.goto(SITE + '/money', wait_until='networkidle'); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(900)

        # ── H ── 머리 · 바닥
        fr = pg.evaluate("""() => ({ b2: document.querySelectorAll('header.b2-hd').length, base: document.querySelectorAll('header.pc-hd, header.hd').length, tone: (document.querySelector('[data-b2-tone]') || {}).dataset?.b2Tone,
            main: document.querySelector('main').className, mny: document.querySelectorAll('main .mny[data-sgb-gwan=money]').length, ft: document.querySelectorAll('footer.b2-ft').length, baseFt: document.querySelectorAll('footer.pc-ft, footer.ft, footer.footer').length, end: document.querySelectorAll('i[data-root-end]').length })""")
        rec('H-1 /money — 두 관 전용 머리줄 · 바닥줄(색조 money) · 본문 틀 main-mny · 옛 머리줄 없음 · 화면 끝 표시', fr['b2'] == 1 and fr['base'] == 0 and fr['tone'] == 'money' and fr['main'] == 'main main-b2 main-mny' and fr['mny'] == 1 and fr['ft'] == 1 and fr['baseFt'] == 0 and fr['end'] == 1, fr)
        hd = pg.evaluate("""() => { const q = (s) => document.querySelector('header.b2-hd ' + s); const lg = q('.b2-logo img');
          return { nav: [...document.querySelectorAll('header.b2-hd .b2-nav a')].map(a => [a.textContent.trim(), a.getAttribute('href'), a.getAttribute('aria-current') || '']), logo: [lg.getAttribute('src'), lg.naturalWidth, lg.naturalHeight, lg.width, lg.height],
                   cart: !!q('.b2-cart'), bell: q('.b2-bell') ? [q('.b2-bell').getAttribute('href'), !!q('.b2-bell svg'), !!q('.b2-belln'), q('.b2-bell').getAttribute('aria-label')] : null,
                   login: (q('.b2-login') || {}).textContent, join: (q('.b2-join') || {}).textContent, joinBg: getComputedStyle(q('.b2-join')).backgroundColor, h: document.querySelector('header.b2-hd').getBoundingClientRect().height,
                   under: getComputedStyle(q('.b2-nav a[aria-current=page]'), '::after').backgroundColor, font: getComputedStyle(q('.b2-nav a')).fontFamily.split(',')[0].replace(/"/g, ''), size: getComputedStyle(q('.b2-nav a')).fontSize }; }""")
        rec('H-2 머리줄 — 메뉴 6(소개장터에 지금 화면 표시) · 그 디자인의 로고(/money/logo.png · 432×104 → 216×52) · 장바구니 대신 알림 종(숫자 없음) · 주황 #FFA03E 무료 회원가입 · 높이 75 · 나눔스퀘어 네오 19px',
            [n[0] for n in hd['nav']] == ['소개장터', '안심소개', '소개창업', '소개몰', '소개광장', '이용안내'] and hd['nav'][0][1:] == ['/money', 'page'] and all(n[2] == '' for n in hd['nav'][1:])
            and hd['logo'] == ['/money/logo.png', 432, 104, 216, 52] and not hd['cart'] and hd['bell'] == ['/my/notifications', True, False, '알림'] and hd['login'] == '로그인' and hd['join'] == '무료 회원가입'
            and hd['joinBg'] == RGB('#ffa03e') and hd['h'] == 75 and hd['under'] == RGB('#ffa03e') and hd['font'] == 'Nanum Square Neo' and hd['size'] == '19px', hd)
        ft = pg.evaluate("""() => { const f = document.querySelector('footer.b2-ft'); const lg = f.querySelector('.b2-logo img');
          return { logo: [lg.getAttribute('src'), lg.naturalWidth, lg.naturalHeight, lg.width, lg.height], sns: [...f.querySelectorAll('.b2-sns img')].map(i => [i.getAttribute('src'), i.naturalWidth, i.naturalHeight]),
                   legal: f.querySelector('.b2-legal').textContent, quick: [...f.querySelectorAll('.b2-quick a')].map(a => a.textContent.trim()), bg: getComputedStyle(f).backgroundColor, links: [...f.querySelectorAll('.b2-ftl a, .b2-ftl .tbd')].map(a => a.textContent.trim()) }; }""")
        rec('H-3 바닥줄 — 그 디자인의 로고 · 사회관계망 3 · 약관 링크는 서버 목록 그대로 · 바로가기 줄 · 사업자 정보 · 통신판매중개자 고지 유지 · 바탕 #F6F8FA',
            ft['logo'] == ['/money/logo_foot.png', 406, 104, 203, 52] and ft['sns'] == [['/money/sns_fb.png', 64, 64], ['/money/sns_ig.png', 64, 64], ['/money/sns_yt.png', 65, 64]] and '사업자등록번호' in ft['legal'] and '통신판매중개자' in ft['legal']
            and '소개받기' in ft['quick'] and ft['links'][0] == '서비스 소개' and len(ft['links']) >= 3 and ft['bg'] == RGB('#f6f8fa'), ft)
        oth = []
        pg2 = ctx.new_page(); f2 = []
        pg2.on('response', lambda r: f2.append(r.url.rsplit('/', 1)[-1]) if '/fonts/' in r.url and SITE in r.url else None)
        for u, want in (('/money/list', 'base'), ('/money/event', 'base'), ('/money/best', 'base'), ('/mall', 'base'), ('/biz', 'base'), ('/request', 'base'), ('/community', 'plaza'), ('/health', 'shop'), ('/', 'home')):
            pg2.goto(SITE + u, wait_until='networkidle'); pg2.wait_for_timeout(250)
            st = pg2.evaluate("""() => ({ base: document.querySelectorAll('header.pc-hd').length, b2: document.querySelectorAll('header.b2-hd').length, tone: (document.querySelector('[data-b2-tone]') || { dataset: {} }).dataset.b2Tone || '', mny: document.querySelectorAll('.mny, .main-mny').length,
                bell: document.querySelectorAll('.b2-bell').length, logo: (document.querySelector('header.b2-hd .b2-logo img') || { getAttribute: () => '' }).getAttribute('src') })""")
            ok = st['mny'] == 0 and st['bell'] == 0 and ((want == 'base' and st['base'] == 1 and st['b2'] == 0) or (want in ('plaza', 'shop') and st['b2'] == 1 and st['tone'] == want and st['logo'] == '/b2/logo.png') or (want == 'home' and st['base'] == 0 and st['b2'] == 0))
            oth.append((u, ok, st))
        rec('H-4 그 밖의 화면은 v10.29 그대로 — 소개장터의 아래 화면(/money/list · /money/event · /money/best) · 안심소개 · 소개창업 · 소개받기는 공통 머리줄(header.pc-hd), 소개광장 · 소개몰은 제 색조 · 제 로고, 메인은 제 머리줄 · 어디에도 mny- 구역 · 종 없음', all(o[1] for o in oth), [o for o in oth if not o[1]])
        M5 = ['NanumSquareNeo.woff2', 'NanumSquareNeoB.woff2', 'NanumSquareNeoEB.woff2', 'Paperlogy-5Medium.woff2', 'Paperlogy-7Bold.woff2']
        # v10.31 (w1) — 본문 글꼴(Noto Sans KR)을 사이트가 직접 내줌(/fonts/noto-sans-kr-*) · 모든 화면 공통 → 소개장터 글꼴 5개만 /money 전용인지 봅니다
        rec('H-5 소개장터 글꼴 5개(페이퍼로지 500 · 700 / 나눔스퀘어 네오 400 · 700 · 800)는 /money 에서만 내려받음 · 위의 9화면에서는 그 5개가 0개(공통 본문 글꼴은 따로)',
            set(M5) <= set(fonts) and not [x for x in f2 if x in M5], (sorted(set(fonts)), sorted(set(f2))[:6]))
        pg2.close()

        # ── M ── 메인
        t = lambda sel: pg.evaluate("(sel) => [...document.querySelectorAll('main .mny ' + sel)].map(e => e.textContent.trim().replace(/\\s+/g, ' '))", sel)
        h = lambda sel: pg.evaluate("(sel) => [...document.querySelectorAll('main .mny ' + sel)].map(e => e.getAttribute('href'))", sel)
        sf = pg.evaluate("() => { const f = document.querySelector('main .mny form.mny-search'); const i = f.querySelector('input[type=search]'); const g = f.querySelector('input[type=hidden]'); return [f.getAttribute('action'), i.name, i.placeholder, i.maxLength, i.getAttribute('aria-haspopup'), g.name, g.value] }")
        rec('M-1 맨 위 — 제목 · 설명 글자가 그림 그대로 · 검색 칸은 /search 로 q(50자)와 관 코드(gwanCode=MNY)를 보냄 · 누르면 검색 팝업이 뜨는 칸', t('.mny-h1') == ['필요한 업체를AI로 쉽게 찾아보세요.'] and t('.mny-lead') == ['상품, 서비스, 전문가까지.원하는 조건에 맞는 믿을 수 있는 공급자를 연결해드립니다.'] and sf == ['/search', 'q', '키워드를 검색해보세요.', 50, 'dialog', 'gwanCode', 'MNY'], (t('.mny-h1'), sf))
        rec('M-2 바로가기 3 — 소개하기(/register) · 소개받고 싶어요(/request/new) · 소개받기(/request)', t('.mny-qc b') == ['소개하기', '소개받고 싶어요', '소개받기'] and h('.mny-qc') == ['/register', '/request/new', '/request'], (t('.mny-qc b'), h('.mny-qc')))
        cur = lambda: pg.evaluate("() => [...document.querySelectorAll('main .mny .mny-tile[aria-current=true]')].map(e => e.textContent.trim())")
        rec('M-3 분야 14칸 — 이름은 그림 그대로 · 누르면 그 이름의 첫 낱말로 아래 목록을 거름(/money?keyword=…#mny-list) · 전체 · 기타는 거르지 않은 목록 · 지금 고른 칸 = 전체 · 전체보기(/money/list)',
            t('.mny-tile') == [x[0] for x in TILES] and h('.mny-tile') == [kwhref(x[1]) for x in TILES] and cur() == ['전체'] and h('.mny-cat-h .mny-more') == ['/money/list'] and t('.mny-cat-h h2') == ['무엇을 소개받고 싶으세요 ?'], (t('.mny-tile'), h('.mny-tile')))
        rec('M-4 왼쪽 분류 — 전체 카테고리 · 상품 5 · 서비스 6(낱말로 아래 목록 거르기) · 전문가 · 업체(낱말) · 구해요 / 의뢰(/request)',
            t('.mny-side-h') == ['전체 카테고리'] and t('.mny-sl:not(.is-region) a') == [x[0] for x in SIDE] and h('.mny-sl:not(.is-region) a') == [kwhref(x[1]) for x in SIDE] and t('.mny-sg') == ['상품', '서비스', '전문가', '업체', '구해요 / 의뢰', '지역으로 찾기']
            and h('.mny-sg.is-plain') == [kwhref('전문가'), kwhref('업체'), '/request']
            # v10.31 (w2) — 「지역으로 찾기」 = GET /market/regions(시안 순서 9곳 + 기타) · 누르면 /money?region=코드#mny-list
            and t('.mny-sl.is-region a') == [r['name'] for r in (regs or {}).get('items', [])] + ['기타 지역'] and h('.mny-sl.is-region a') == [f"/money?region={r['code']}#mny-list" for r in (regs or {}).get('items', [])] + ['/money?region=ETC#mny-list'],
            (t('.mny-sg'), h('.mny-sl:not(.is-region) a')[:3], t('.mny-sl.is-region a')))
        # v10.31 (w2 시안) — 「지금 올라온 소개 요청」 = GET /market/requests(종류 탭 · 지역 · 사진). 줄 = 제목 · 지역 · 예산 · 제안 수 · 「제안 하기」 → 그 요청
        rows = pg.evaluate("""() => [...document.querySelectorAll('main .mny .mny-req')].map(r => [r.querySelector('.mny-req-m a').textContent, r.querySelector('.mny-req-m a').getAttribute('href'),
            r.querySelector('.is-price').textContent, r.querySelector('.is-n').textContent, r.querySelector('.mny-btn').getAttribute('href'), r.querySelector('.mny-btn').textContent, !!r.querySelector(':scope > img')])""")
        def bud(a, b_):
            man = lambda n: (format(n // 10000, ',') if n % 10000 == 0 else None)
            won = lambda n: format(n, ',') + '원'
            if not a and not b_: return '협의'
            if a and b_:
                x, y = man(a), man(b_)
                if a == b_: return (x + '만원') if x else won(a)
                return f'{x} ~ {y}만원' if x and y else f'{won(a)} ~ {won(b_)}'
            v = a or b_; m = man(v); return ((m + '만원') if m else won(v)) + (' 이상' if a else ' 이하')
        its = (mreq or {}).get('items', [])
        want = [[r['title'], '/request/' + r['id'], bud(r.get('budgetMin'), r.get('budgetMax')), '제안%d건' % (r.get('proposalCount') or 0), '/request/' + r['id'], '제안 하기', True] for r in its][:len(rows)]
        rec(f'M-5 지금 올라온 소개 요청 {len(rows)}건 = GET /market/requests?gwanCode=MNY 그대로(제목 · 예산 · 제안 수 · 순서) · 줄과 단추가 그 요청(/request/번호)으로 · 사진(없으면 분류 그림) · 전체보기(/request)',
            1 <= len(rows) <= 4 and rows == want and h('.mny-panel.is-req .mny-more') == ['/request'] and '지금 올라온 소개 요청' in t('.mny-ph h2'), (rows[:2], want[:2], t('.mny-ph h2')))
        rec('M-6 공급자 등록 안내 — 글자는 그림 그대로 · /register', t('.mny-cta p') == ['전국의 다양한 공급자를 기다리고 있어요.지금, 새로운 기회를 만나보세요.'] and t('.mny-cta a') == ['공급자로 등록하기'] and h('.mny-cta a') == ['/register'], t('.mny-cta'))
        col = pg.evaluate("""() => { const c = (s, p) => getComputedStyle(document.querySelector('main .mny ' + s))[p]; const f = (s) => c(s, 'fontFamily').split(',')[0].replace(/"/g, '');
          return { h1: c('.mny-h1', 'color'), em: c('.mny-h1 em', 'color'), hero: c('.mny-hero', 'backgroundColor'), btn: c('.mny-search button', 'backgroundColor'), side: c('.mny-side-h', 'backgroundColor'), cta: c('.mny-cta a', 'backgroundColor'), ghost: c('.mny-btn.is-ghost', 'color'),
                   f1: f('.mny-h1'), f2: f('.mny-lead'), f3: f('.mny-ph h2'), f4: f('.mny-old-b .gw'), point: getComputedStyle(document.querySelector('main .mny')).getPropertyValue('--sgb-point').trim(), navy: getComputedStyle(document.documentElement).getPropertyValue('--sgb-navy').trim() }; }""")
        rec('M-7 색 · 글꼴 — 남색 #00245a · 강조 #f5a008 · 맨 위 바탕 #fbf4e8 · 실행 주황 #fca22a · 제목 페이퍼로지 · 본문 나눔스퀘어 네오 · 지금 있던 매물 구역은 v10.29 관 화면의 글꼴(본고딕) · 디자인 시트 토큰',
            col == {'h1': RGB('#00245a'), 'em': RGB('#f5a008'), 'hero': RGB('#fbf4e8'), 'btn': RGB('#f5a008'), 'side': RGB('#00245a'), 'cta': RGB('#fca22a'), 'ghost': RGB('#fca22a'), 'f1': 'Paperlogy', 'f2': 'Nanum Square Neo', 'f3': 'Paperlogy', 'f4': 'Noto Sans KR', 'point': '#ffa03e', 'navy': '#00245a'}, col)
        order = pg.evaluate("""() => { const y = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : -1 }; return ['header.b2-hd', '.mny-hero', '.mny-quick', '.mny-cat', '.mny-panel.is-req', '.mny-old', '.mny-bottom', 'footer.b2-ft'].map(y) }""")
        pos = pg.evaluate("""() => { const r = (s) => document.querySelector('main .mny ' + s).getBoundingClientRect(); const o = r('.mny-old'), m = r('.mny-main'), q = r('.mny-panel.is-req'), s = r('.mny-side'); return [Math.abs(o.left - m.left) < 1 && Math.abs(o.width - m.width) < 1, o.top > q.bottom, s.top <= q.top, s.bottom <= o.bottom + 1] }""")
        rec('M-8 구역 순서 — 머리줄 → 맨 위 → 바로가기 → 분야 → 소개 요청 → 지금 있던 것(같은 칸 · 32px 아래) → 공급자 등록 → 바닥줄 · 분류 목록은 요청 구역과 같은 높이에서 시작', -1 not in order and order == sorted(order) and pos == [True, True, True, True], (order, pos))   # v10.31 — 요청 아래에 AI 추천 구역이 들어와 간격 · 분류 목록의 시작 높이는 견주지 않음

        # ── X ── 넣지 않은 것
        body = norm(pg.inner_text('main'))
        # v10.31 (w2 · 10/10 「시안 기준」) — v10.30 에서 「서버 자료가 없어 그리지 않던」 7구역을 서버 자료로 그림. 이제는 **값이 서버의 것인지**를 봅니다
        got = pg.evaluate("""() => ({ kw: [...document.querySelectorAll('main .mny .mny-chip')].map(a => a.textContent.trim()), kwNone: !!document.querySelector('main .mny .mny-kw-none'),
            sup: [...document.querySelectorAll('main .mny .mny-panel:not(.is-aip) .mny-card')].map(a => a.dataset.supplier), cases: document.querySelectorAll('main .mny .mny-case').length,
            tabs: [...document.querySelectorAll('main .mny .mny-tab')].map(b => b.textContent.trim()) })""")
        want_kw = [k.get('term') for k in (kws or {}).get('items', [])]
        rec('X-1 많이 찾는 키워드 = GET /search/keywords(없으면 「아직 집계된 검색어가 없습니다」) · 서비스 업체 추천 = GET /market/suppliers(순서) · 연결 사례 = GET /market/success/recent(건수) · 요청 종류 탭(전체 + 5)',
            got['kw'] == want_kw and (bool(want_kw) or got['kwNone']) and got['sup'] == [x['id'] for x in (sups or [])][:len(got['sup'])] and len(got['sup']) == min(4, len(sups or []))
            and got['cases'] == len((cases or {}).get('items', [])) and len(got['tabs']) == 6, (got, want_kw, [x['id'] for x in (sups or [])][:4], len((cases or {}).get('items', []))))
        rec('X-2 시안의 견본 이름 · 글(클린하우스 · 김현우 세무사 · 판교 사무실 입주청소 … 8가지)이 화면에 없음 — 값은 서버 것만', not [x for x in SAMPLE[:8] if x in body], [x for x in SAMPLE[:8] if x in body])

        # ── A ── 광고
        adb = pg.evaluate("""() => { const a = document.querySelector('main .mny [data-adbox=GHERO]'); if (!a) return null; const r = a.getBoundingClientRect(), hr = document.querySelector('main .mny .mny-hero-in').getBoundingClientRect();
          return { code: a.dataset.adCode, tag: a.querySelector('.mny-ad-tag').textContent, adv: a.querySelector('.mny-ad-adv').textContent, title: a.querySelector('h2').textContent, body: (a.querySelector('p') || {}).textContent || '', cta: a.querySelector('.mny-ad-cta').textContent.trim(), w: r.width, h: Math.round(r.height * 2) / 2, radius: getComputedStyle(a).borderTopLeftRadius }; }""")
        if ad and not ad.get('empty'):
            ad = ADS.get(adb['code']) if adb else None      # 화면에 나온 그 소재
            rec(f'A-1 맨 위 광고 칸 = GET /ads/serve?slot=GHERO 의 소재 {sorted(ADS)} 가운데 하나(광고주 · 제목 · 본문 · 단추 글자) · 「광고」 표시 · 그림의 광고 자리와 같은 크기(520.5 × 342.5 · 둥글기 16)',
                adb is not None and ad is not None and adb['code'] == ad.get('code') and adb['tag'] == (ad.get('label') or '광고') and adb['adv'] == ad.get('advertiser') and adb['title'] == ad.get('title') and adb['body'] == (ad.get('body') or '') and adb['cta'] == (ad.get('cta') or '자세히 보기')
                and adb['w'] == 520.5 and adb['h'] == 342.5 and adb['radius'] == '16px', adb)
            ad = ad or {'id': '-'}
            imp = [u for u in posts if '/impression' in u and 'slot=GHERO' in u]   # v10.31 — 떠 있는 광고(FLOAT) · 띠 광고(GBAND) 칸의 노출 기록은 따로
            rec('A-2 노출 기록 — 화면에 보일 때 POST /ads/{id}/impression?slot=GHERO 를 한 번만', len(imp) == 1 and ad['id'] in imp[0] and 'slot=GHERO' in imp[0], imp)
            pg.locator('main .mny .mny-ad-cta').click(); pg.wait_for_timeout(900)
            clk = [u for u in posts if '/click' in u]; to = ad.get('landingRoute')
            after = urllib.parse.urlparse(pg.url).path
            okgo = (after == '/money') if to in ('/money', None, '') or not str(to).startswith('/') else (after == to)
            rec('A-3 단추를 누르면 POST /ads/{id}/click?slot=GHERO 한 번 · 소재의 목적지로(목적지가 이 화면이면 매물 구역으로 내림 · 없으면 안내)', len(clk) == 1 and ad['id'] in clk[0] and 'slot=GHERO' in clk[0] and okgo, (clk, to, after))
            if after != '/money': pg.goto(SITE + '/money', wait_until='networkidle'); pg.wait_for_timeout(500)
        else:
            rec('A-1 광고 소재가 없으면 광고 칸을 그리지 않음(GET /ads/serve?slot=GHERO → empty)', adb is None, adb)

        # ── O ── 지금 있던 것 (v10.29 관 화면 부품 · 조회 규칙 그대로)
        total = next((g for g in gws if g['code'] == 'MNY'), {}).get('listingCount', 0)
        ids = lambda d: [x['id'] for x in (d or {}).get('organic', [])]
        OLD = """() => { const o = document.querySelector('main .mny .mny-old'); const q = o.querySelectorAll('.mny-old-q'); const g = o.querySelector('.gw-pgw ~ *, .gw-pgrid');
            return { id: o.id, h2: o.querySelector('h2').textContent, chips: [...q[0].querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]), links: [...q[1].querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]),
              gw: o.querySelectorAll('.mny-old-b > .gw[data-gw=MNY]').length, find: [(o.querySelector('.gw-fh2') || {}).textContent, (o.querySelector('form.gw-fbar') || { getAttribute: () => '' }).getAttribute('action'), [...o.querySelectorAll('#f-grade option')].map(x => x.value), o.querySelectorAll('#f-cat option').length],
              cards: [...o.querySelectorAll('.mny-old-l > .gw-pgrid > a.gw-pgc')].map(a => a.dataset.listing), ad: o.querySelectorAll('.gw-adz a.gw-pgc').length, tot: ((o.querySelector('.gw-tot') || {}).textContent || '').replace(/\\s+/g, ' ').trim(), page: (o.querySelector('.gw-pager [aria-current=page]') || {}).textContent || '',
              next: (o.querySelector('.gw-pager a[title="다음 쪽"]') || { getAttribute: () => null }).getAttribute('href'), sort: (o.querySelector('select.gw-sortsel') || {}).value || '', bar: [...o.querySelectorAll('.gw-catbar .gw-cbv')].map(x => x.textContent), none: !!o.querySelector('.gw-catnone'),
              top: Math.round(o.getBoundingClientRect().top), cols: o.querySelector('.mny-old-l > .gw-pgrid') ? getComputedStyle(o.querySelector('.mny-old-l > .gw-pgrid')).gridTemplateColumns.split(' ').length : 0 }; }"""
        def want_ids(qs):
            """그 조건의 매물 번호 — 화면(MoneyMain = v10.29 GwanLanding 의 규칙)과 같은 방식으로 서버에 묻습니다"""
            q = dict(urllib.parse.parse_qsl(qs)); a = {'gwanCode': 'MNY', 'limit': '6'}; names = None
            if q.get('sort'): a['sort'] = q['sort']
            if q.get('badge'): a['badge'] = q['badge']
            if q.get('keyword'): a['keyword'] = q['keyword']
            if q.get('cursor'): a['cursor'] = q['cursor']
            if q.get('cat'): a['categoryId'] = q['cat']
            elif q.get('grade'):
                gc = [c for c in cats if c.get('gradeCode') == q['grade']]; a['limit'] = '50'; a.pop('cursor', None)
                if len(gc) == 1: a['categoryId'] = gc[0]['id']
                names = set(c['name'] for c in gc)
            _, d = call('GET', '/listings?' + urllib.parse.urlencode(a)); o = (d or {}).get('organic', [])
            return [x['id'] for x in o if names is None or x['categoryName'] in names], d
        def see(qs, tries=2):
            """/money?조건#mny-list 를 열어 화면의 매물과 서버의 매물을 견줍니다. 목록은 잠깐(30초) 기억해 두므로, 다른 시험이 막 매물을 올렸으면 한 번 기다렸다 다시 봅니다"""
            for n in range(tries):
                pg.goto(SITE + '/money' + ('?' + qs if qs else '') + '#mny-list', wait_until='networkidle'); pg.wait_for_timeout(350)
                got = pg.evaluate(OLD); w, d = want_ids(qs)
                if got['cards'] == w or n == tries - 1: return got, w, d
                # v10.31 — Next 의 revalidate 는 「기한이 지난 뒤 첫 요청에는 옛 것을 주고 뒤에서 새로 받음」(stale-while-revalidate) — 기다린 뒤 한 번 열어 새로 받게 하고 다시 봅니다
                pg.wait_for_timeout(32000); pg.goto(SITE + '/money' + ('?' + qs if qs else '') + '#mny-list', wait_until='networkidle'); pg.wait_for_timeout(2500)
        old, w0, d0 = see('')
        grades = sorted(set(c.get('gradeCode') for c in cats if c.get('gradeCode') in ('G1', 'G2', 'G3')))
        rec(f'O-1 「지금 인기 있는 상품/서비스」(#mny-list) — 퀵메뉴 5(성공현황 · 베스트매칭 · 급구 · 급매 · 사고예방 · 이벤트존) · 내가 등록한 상품/서비스 · 전체 목록 · 소개상품 찾기(구분 {len(grades)} · 분류 {len(cats)}) · 관 화면 틀(.gw[data-gw=MNY])',
            old['id'] == 'mny-list' and old['h2'] == '지금 인기 있는 상품/서비스' and old['chips'] == QM and old['links'] == [['내가 등록한 상품/서비스', '/my/listings'], ['전체 목록', '/money/list']] and old['gw'] == 1
            and old['find'] == ['소개상품 찾기', '/money#mny-list', [''] + grades, len(cats) + 1], {k: old[k] for k in ('id', 'h2', 'chips', 'links', 'gw', 'find')})
        rec(f'O-2 매물 사진 카드 {len(w0)}장 = GET /listings?gwanCode=MNY&limit=6 그대로(번호 · 순서) · 광고 {len((d0 or {}).get("promoted", []))}건은 광고 칸에 따로 · 한 줄 6칸 · 「총 {total}개의 상품/서비스가 있습니다.」 · 1쪽 · 정렬 = 최신',
            len(w0) >= 1 and old['cards'] == w0 and old['ad'] == len((d0 or {}).get('promoted', [])) and old['cols'] == 6 and old['tot'] == f'총 {total:,}개의 상품/서비스가 있습니다.' and old['page'] == '1' and old['sort'] == 'RECENT'
            and (old['next'] is None) == (total <= 6) and (old['next'] is None or (old['next'].endswith('#mny-list') and 'p=2' in old['next'])), {k: old[k] for k in ('cards', 'ad', 'cols', 'tot', 'page', 'sort', 'next')})   # v10.31 — 쪽 번호(?p=) · 건수를 아는 목록
        ch = []; c0 = next((c for c in cats if any(x.get('categoryName') == c['name'] for x in (d0 or {}).get('organic', []))), cats[0] if cats else None)
        gnm = {'G1': '골든', 'G2': '실버', 'G3': '브론즈'}
        conds = [('sort=POPULAR', []), ('sort=FEE_DESC', []), ('badge=URGENT', ['급구']), ('badge=VERIFIED_DOC', ['서류 확인']), ('keyword=' + urllib.parse.quote('인테리어'), ['「인테리어」'])]
        if c0: conds.append(('cat=' + c0['id'], [c0['name']]))
        if grades: conds.append(('grade=' + grades[0], [gnm[grades[0]]]))
        if c0 and grades: conds.append(('sort=POPULAR&cat=' + c0['id'] + '&keyword=' + urllib.parse.quote('소개'), [c0['name'], '「소개」']))
        for qs, bar in conds:
            got, w, _ = see(qs)
            ch.append((qs, got['cards'] == w and got['bar'] == bar and 0 <= got['top'] < 500 and got['none'] == (not w and not got['ad']) and (not qs.startswith('sort=') or got['sort'] == qs.split('&')[0][5:]) and (not bar or '이 쪽' in got['tot']), (got['cards'][:3], w[:3], got['bar'], got['top'], got['sort'], got['tot'])))
        rec(f'O-3 조건 {len(conds)}가지(인기순 · 소개비순 · 급구 · 서류 확인 · 낱말 · 분류 · 구분 · 섞은 것) — 매물 = 서버의 그 조건 그대로 · 검색 조건 줄에 고른 것이 적힘 · 주소 끝 #mny-list 로 그 구역이 화면에 옴', all(c[1] for c in ch), [c for c in ch if not c[1]])
        if total > 6:
            # v10.31 (w2 시안 pgBar) — 쪽 번호 「‹ 1 2 3 ›」 · 주소 ?p= (커서 없음) · 2쪽 매물 = GET /listings?page=2
            see(''); pg.locator('main .mny .gw-pager a[title="다음 쪽"]').click(); pg.wait_for_url('**p=2**', timeout=15000); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(400)
            u2 = pg.url.replace(SITE, ''); g2 = pg.evaluate(OLD)
            _, d2 = call('GET', '/listings?gwanCode=MNY&limit=6&page=2&withTotal=1'); w2 = [x['id'] for x in (d2 or {}).get('organic', [])]
            if g2['cards'] != w2:   # v10.31 — 2쪽은 따로 기억되는 목록(30초 · stale-while-revalidate) — 다른 시험이 막 매물을 올렸으면 기다렸다 두 번 열어 새로 받음
                pg.wait_for_timeout(32000); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(2500); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(400)
                u2 = pg.url.replace(SITE, ''); g2 = pg.evaluate(OLD)
                _, d2 = call('GET', '/listings?gwanCode=MNY&limit=6&page=2&withTotal=1'); w2 = [x['id'] for x in (d2 or {}).get('organic', [])]
            pg.locator('main .mny .gw-pager a[title="이전 쪽"]').click(); pg.wait_for_url(SITE + '/money#mny-list', timeout=15000); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(400); g1 = pg.evaluate(OLD)
            rec('O-4 쪽 넘기기 — › 를 누르면 2쪽(주소 p=2 · 끝에 #mny-list · 매물 = 서버의 2쪽 6건 · 구역이 화면에 머묾) · ‹ 를 누르면 첫 쪽으로',
                'p=2' in u2 and u2.endswith('#mny-list') and g2['cards'] == w2 and g2['page'] == '2' and not set(g2['cards']) & set(w0) and 0 <= g2['top'] < 500 and g1['page'] == '1' and g1['cards'] == w0, (u2, g2['cards'][:2], w2[:2], g2['top'], g1['page']))
        else:
            rec('O-4 쪽 넘기기 — 매물이 6건 이하라 다음 쪽 단추가 꺼져 있음', old['next'] is None, old['next'])
        see(''); pg.select_option('main .mny select.gw-sortsel', 'FEE_DESC'); pg.wait_for_url('**sort=FEE_DESC**', timeout=15000); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(400)
        us = pg.url.replace(SITE, ''); gs = pg.evaluate(OLD); ws, _ = want_ids('sort=FEE_DESC')
        rec('O-5 정렬 칸에서 「소개비순」을 고르면 /money?sort=FEE_DESC#mny-list · 매물 = 서버의 소개비순 그대로', us == '/money?sort=FEE_DESC#mny-list' and gs['cards'] == ws and gs['sort'] == 'FEE_DESC', (us, gs['cards'][:3], ws[:3]))
        if grades:
            see(''); pg.select_option('main .mny #f-grade', grades[0]); pg.wait_for_timeout(150)
            narrowed = pg.evaluate("() => document.querySelectorAll('main .mny #f-cat option').length")
            pg.locator('main .mny form.gw-fbar button.gw-fgo').click(); pg.wait_for_url('**grade=**', timeout=15000); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(400)
            uf = pg.url.replace(SITE, ''); gf = pg.evaluate(OLD); wf, _ = want_ids('grade=' + grades[0])
            pg.locator('main .mny .gw-catbar a.gw-cbx', has_text='전체 해제').click(); pg.wait_for_url(SITE + '/money#mny-list', timeout=15000); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(300); ga = pg.evaluate(OLD)
            rec(f'O-6 소개상품 찾기 — 구분 「{gnm[grades[0]]}」을 고르면 분류 칸이 그 구분의 분류로 줄고, 검색을 누르면 주소에 grade= · 끝에 #mny-list · 매물 = 그 구분의 것 · 「전체 해제」 → /money#mny-list',
                narrowed == len([c for c in cats if c.get('gradeCode') == grades[0]]) + 1 and 'grade=' + grades[0] in uf and uf.endswith('#mny-list') and gf['cards'] == wf and gf['bar'] == [gnm[grades[0]]] and 0 <= gf['top'] < 500 and ga['bar'] == [] and ga['cards'] == w0, (narrowed, uf, gf['cards'][:2], wf[:2], gf['bar'], gf['top']))
        qm = []
        for lab, href in QM:
            st, bd, _ = get(href, redirect=False); html = bd.decode('utf8', 'replace')
            qm.append((href, st == 200 and 'pc-hd' in html and 'gw-qmenu' in html and 'data-sgb-gwan' not in html, st))
        rec('O-7 퀵메뉴 5곳(/money/new · best · urgent · verified · event)이 v10.29 의 제 화면으로 열림(200 · 공통 머리줄 · 퀵메뉴 줄) — 이 화면으로 되돌려 보내지 않음', all(x[1] for x in qm), qm)

        # ── L ── 눌러서 가는 곳
        kl = []
        for k in ('인테리어', '청소', '가구', '전문가'):
            got, w, _ = see('keyword=' + urllib.parse.quote(k))
            tile_on = cur(); side_on = pg.evaluate("() => [...document.querySelectorAll('main .mny .mny-side a[aria-current=true]')].map(e => e.textContent.trim())")
            want_tile = [x[0] for x in TILES if x[1] == k]; want_side = [x[0] for x in SIDE if x[1] == k] + ([k] if k in ('전문가', '업체') else [])
            kl.append((k, got['cards'] == w and got['bar'] == [f'「{k}」'] and got['none'] == (not w and not got['ad']) and tile_on == want_tile and side_on == want_side, (len(got['cards']), len(w), got['bar'], tile_on, side_on)))
        rec('L-1 /money?keyword=…#mny-list — 그 낱말이 제목 · 내용에 든 매물만(= GET /listings?keyword= 그대로 · 0건이면 빈 목록 안내) · 검색 조건 줄에 낱말 · 같은 낱말의 분야 칸 · 분류 줄에만 「지금 고른 것」 표시', all(x[1] for x in kl), [x for x in kl if not x[1]])
        pg.goto(SITE + '/money', wait_until='networkidle'); pg.locator('main .mny .mny-tile').nth(1).click(); pg.wait_for_url('**keyword=**', timeout=15000); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(500)
        u1 = urllib.parse.unquote(pg.url.replace(SITE, '')); g1 = pg.evaluate(OLD); c1 = cur()
        ring = pg.evaluate("""() => { const t = [...document.querySelectorAll('main .mny .mny-tile')]; const cs = (e) => getComputedStyle(e); return [cs(t[1]).boxShadow !== 'none', cs(t[1]).backgroundColor, cs(t[0]).boxShadow === 'none', cs(t[0]).backgroundColor, cs(t[2]).backgroundColor] }""")
        pg.locator('main .mny .gw-catbar a.gw-cbx', has_text='검색어 해제').click(); pg.wait_for_url(SITE + '/money#mny-list', timeout=15000); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(300); u2 = pg.url.replace(SITE, ''); c2 = cur()
        rec('L-2 분야 「가구, 인테리어」를 누르면 /money?keyword=가구#mny-list · 목록 구역이 화면에 옴 · 그 칸에 주황 테두리(바탕은 그림 그대로 — 그 칸 회색 · 전체 칸 옅은 주황) · 「✕ 검색어 해제」 → /money#mny-list · 다시 전체',
            u1 == '/money?keyword=가구#mny-list' and 0 <= g1['top'] < 500 and c1 == ['가구, 인테리어'] and ring[0] and ring[1] == ring[4] and ring[2] and ring[3] == RGB('#fbf4e8') and u2 == '/money#mny-list' and c2 == ['전체'], (u1, g1['top'], c1, ring, u2, c2))
        bk = []
        for q in ('가', 'x' * 51, '', '   '):
            st, bd, _ = get('/money?keyword=' + urllib.parse.quote(q)); html = bd.decode('utf8', 'replace'); m = re.search(r'class="gw-cbv">「(?:<!-- -->)?([^<」]*)', html)
            bk.append((q[:6], st, 'id="mny-list"' in html, len(m.group(1)) if m else 0))
        rec('L-3 낱말 한 글자 · 51자(50자까지만 씀) · 빈 낱말 · 빈칸뿐 — 모두 200 · 오류 화면 아님 · 빈 것은 거르지 않음', [x[1:] for x in bk] == [(200, True, 1), (200, True, 50), (200, True, 0), (200, True, 0)], bk)
        pg.goto(SITE + '/money', wait_until='networkidle'); pg.wait_for_timeout(300); pg.locator('#mny-q').click(); pg.wait_for_selector('.pc-spop #spopq', timeout=10000)
        pop1 = pg.evaluate("() => [document.querySelectorAll('.pc-spop[role=dialog]').length, document.activeElement && document.activeElement.id]")
        # v10.40 (대표 지시 2026-10-14) — 결과는 팝업에서 · 「통합 검색 결과 보기」 줄 없음 · 결과 줄을 누르면 그 자리로
        pg.fill('.pc-spop #spopq', '인테리어'); pg.wait_for_timeout(1500)
        allrow = pg.locator('.pc-spop [data-spop-all]').count() + ('통합 검색 결과 보기' in pg.inner_text('.pc-spop'))
        rws = pg.locator('.pc-spop #spopbd button.it'); nrow = rws.count(); t1 = rws.nth(0).locator('.t1').inner_text() if nrow else ''
        if nrow: rws.nth(0).click(); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(800)
        us = urllib.parse.unquote(pg.url.replace(SITE, ''))
        moved = (nrow > 0 and not us.startswith('/search') and us != '/money' and t1[:12] in pg.inner_text('body')) or (nrow == 0 and us == '/money')
        pg.goto(SITE + '/money', wait_until='networkidle'); pg.wait_for_timeout(300); pg.locator('main .mny form.mny-search button[type=submit]').click(); pg.wait_for_timeout(500); pop2 = pg.locator('.pc-spop[role=dialog]').count()
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300); pop3 = pg.locator('.pc-spop[role=dialog]').count()
        rec('L-4 검색칸을 누르면 검색 팝업이 뜨고(글자 칸에 커서) · 「인테리어」 → 결과가 팝업에 · 「통합 검색 결과 보기」 줄 없음 · 맨 위 결과를 누르면 그 자리로(v10.40) · 빈 칸에서 돋보기를 눌러도 팝업 · ESC 로 닫힘',
            pop1 == [1, 'spopq'] and allrow == 0 and moved and pop2 == 1 and pop3 == 0, (pop1, allrow, nrow, t1[:20], us, pop2, pop3))
        nav = []
        for sel, nth, want in [('.mny-qc', 2, '/request'), ('.mny-panel.is-req .mny-more', 0, '/request'), ('.mny-cat-h .mny-more', 0, '/money/list'), ('.mny-sg.is-plain', 2, '/request'), ('.mny-old-q a[href="/money/list"]', 0, '/money/list')] + [('.mny-old-q a[href="%s"]' % q[1], 0, q[1]) for q in QM]:
            pg.goto(SITE + '/money', wait_until='networkidle'); pg.locator('main .mny ' + sel).nth(nth).click(); pg.wait_for_url('**' + want, timeout=15000); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(200)
            nav.append((sel, pg.url.replace(SITE, '') == want and pg.locator('main').count() == 1 and '찾을 수 없' not in pg.inner_text('main')[:200], pg.url.replace(SITE, '')))
        if reqs:
            pg.goto(SITE + '/money', wait_until='networkidle'); pg.locator('main .mny .mny-req .mny-btn').first.click(); pg.wait_for_url('**/request/**', timeout=15000); pg.wait_for_load_state('networkidle')
            # v10.36 — 화면의 요청 줄은 GET /market/requests(등록 최신순)로 그립니다. 전에는 GET /requests(마감 임박순)의 첫 건과 견줘,
            #   게시 중인 소개장터 요청이 2건 이상이 되면(다른 시험이 요청을 게시) 순서가 달라 실패했습니다 — 화면이 쓰는 목록의 첫 건과 견줍니다
            _, mr = call('GET', '/market/requests?gwanCode=MNY&limit=24'); r0 = ((mr or {}).get('items') or reqs)[0]
            nav.append(('요청의 제안 하기', pg.url.replace(SITE, '') == '/request/' + r0['id'] and r0['title'] in pg.inner_text('main'), pg.url.replace(SITE, '')))
        if w0:
            pg.goto(SITE + '/money#mny-list', wait_until='networkidle'); pg.locator('main .mny .mny-old-l > .gw-pgrid > a.gw-pgc').first.click(); pg.wait_for_url('**/money/' + w0[0], timeout=15000); pg.wait_for_load_state('networkidle')
            nav.append(('매물 카드', pg.url.replace(SITE, '') == '/money/' + w0[0] and '찾을 수 없' not in pg.inner_text('main')[:200], pg.url.replace(SITE, '')))
        for u in ('/register', '/request/new', '/my/listings'):      # 로그인해야 쓰는 화면 — 로그인하지 않았으면 로그인 화면으로 보냅니다(전과 같음)
            st, _, _ = get(u); nav.append((u, st == 200, st))
        rec(f'L-5 가는 길 {len(nav)}곳 — 소개받기 · 요청 전체보기 · 분야 전체보기 · 구해요 / 의뢰 · 전체 목록 · 퀵메뉴 5 · 요청의 제안 하기(그 요청 상세) · 매물 카드(그 매물 상세) · 소개하기 · 소개받고 싶어요 · 내가 등록한 상품/서비스가 모두 열림', all(x[1] for x in nav), [x for x in nav if not x[1]])
        pg.goto(SITE + '/money', wait_until='networkidle'); acc = []
        for i in (0, 1):
            bt = pg.locator('main .mny .mny-sg[aria-controls]').nth(i); uid = bt.get_attribute('aria-controls'); bt.click(); pg.wait_for_timeout(120)
            a1 = (bt.get_attribute('aria-expanded'), pg.evaluate("(i) => document.getElementById(i).hidden", uid)); bt.click(); pg.wait_for_timeout(120)
            acc.append((a1, (bt.get_attribute('aria-expanded'), pg.evaluate("(i) => document.getElementById(i).hidden", uid))))
        rec('L-6 분류 묶음(상품 · 서비스) — 누르면 접히고 다시 누르면 펴짐', all(a == (('false', True), ('true', False)) for a in acc), acc)

        # ── P ── 그림 · 글꼴
        man = json.load(open(os.path.join(OUT, 'money_assets.json'), encoding='utf8'))['parts']; site_parts = {n: v for n, v in man.items() if v['site']}
        tsx = open(K + '/sgb/site/src/components/money/pics.tsx', encoding='utf8').read(); tbl = {m.group(1): [float(m.group(2)), float(m.group(3))] for m in re.finditer(r'^\s+([a-z0-9_]+): \[([\d.]+), ([\d.]+)\],', tsx, re.M)}
        files = sorted(os.listdir(K + '/sgb/site/public/money'))
        rec(f'P-1 실제 웹의 그림 {len(files)}장 = 자르기 표에서 「실제 웹」으로 표시한 것 · 화면 크기 표(pics.tsx) = 원본의 절반', files == sorted(n + '.png' for n in site_parts) and tbl == {n: v['css'] for n, v in site_parts.items()}, (len(files), len(site_parts), len(tbl)))
        oldimg = pg.evaluate("""() => [...document.querySelectorAll('main .mny .mny-old-b img')].map(i => [i.getAttribute('src'), i.complete && i.naturalWidth > 0])""")
        imgs = pg.evaluate("""() => [...document.querySelectorAll('header.b2-hd img, main .mny img:not(.mny-old-b img), footer.b2-ft img')].map(i => { const r = i.getBoundingClientRect(); return [i.getAttribute('src'), i.complete && i.naturalWidth > 0, i.naturalWidth, i.naturalHeight, r.width, r.height] })""")
        # v10.31 (w2) — 서버 자료 구역(요청 줄 · 업체 카드 · 연결 사례)의 사진은 그 매물 · 요청의 사진(/api/v1/…), 없으면 분류 그림(/proto-img/gwan) — 그림 조각 검사에서 뺌
        photos = [i for i in imgs if i[0].startswith(('/proto-img/', '/api/v1/'))]; imgs = [i for i in imgs if i not in photos]
        used = sorted(set(i[0].rsplit('/', 1)[-1] for i in imgs if i[0].startswith('/money/')))
        wrong = [i for i in imgs if not i[1] or not i[0].startswith('/money/') or abs(i[4] * 2 - i[2]) > 0.01 or abs(i[5] * 2 - i[3]) > 0.01]
        rec(f'P-2 디자인 구역의 그림 {len(imgs)}개 — 모두 뜸 · 모두 /money/ 의 PNG · 원본의 정확히 절반 크기(늘이거나 줄이지 않음) · 둔 파일 {len(files)}장이 모두 쓰임 · 지금 있던 구역의 매물 사진 {len(oldimg)}장은 v10.29 의 분류 그림(/proto-img/gwan) 그대로 뜸', len(imgs) >= 28 and not wrong and used == files and all(o[1] and o[0].startswith('/proto-img/gwan/') for o in oldimg), (wrong[:3], sorted(set(files) - set(used)), [o for o in oldimg if not o[1]][:2]))
        byte = []
        for f in files:
            st, bd, hh = get('/money/' + f); byte.append((f, st == 200 and bd == open(K + '/sgb/site/public/money/' + f, 'rb').read() and 'image/png' in (hh.get('Content-Type') or hh.get('content-type') or '')))
        r = subprocess.run([sys.executable, os.path.join(OUT, 'cut_money.py'), '--check'], capture_output=True, text=True)
        rec('P-3 화면이 내주는 PNG 가 둔 파일과 바이트까지 같고(다른 형식으로 바꿔 내주지 않음) · 받은 그림의 그 자리와 점 하나까지 같음(cut_money.py --check)', all(x[1] for x in byte) and r.returncode == 0 and '원본과 다른 것 0' in r.stdout, ([x for x in byte if not x[1]][:3], r.stdout.strip()[-160:]))
        fz = []
        for f in ('Paperlogy-5Medium.woff2', 'Paperlogy-7Bold.woff2', 'NanumSquareNeo.woff2', 'NanumSquareNeoB.woff2', 'NanumSquareNeoEB.woff2', 'LICENSE.txt'):
            st, bd, hh = get('/fonts/' + f); fz.append((f, st, len(bd), bd[:4] == b'wOF2' or f == 'LICENSE.txt'))
        rec('P-4 글꼴 파일 5개(woff2) + 사용 조건 글(LICENSE.txt)이 열림 · 합계 약 1.5MB', all(x[1] == 200 and x[3] for x in fz) and 1_300_000 < sum(x[2] for x in fz[:5]) < 1_700_000, fz)
        css = open(K + '/sgb/site/src/styles/money.css', encoding='utf8').read() + open(K + '/sgb/site/src/styles/sgb-tokens.css', encoding='utf8').read()
        body_css = re.sub(r'/\*.*?\*/', '', css, flags=re.S); sels = []
        for m in re.finditer(r'([^{}]+)\{[^{}]*\}', body_css):
            for s1 in m.group(1).split(','):
                s1 = s1.strip()
                if s1 and not s1.startswith('@'): sels.append(s1)
        okpre = (':root', ':where(.mny', '.mny', '[data-b2-tone=money]', '.main-mny', '.main.main-b2.main-mny', '.b2-bell', '.b2-belln', '[data-sgb-gwan=')
        leak = [s1 for s1 in sels if not s1.startswith(okpre)]
        rec(f'P-5 스타일 {len(sels)}개가 모두 소개장터 이름 아래(.mny · [data-b2-tone=money] · .main-mny · .b2-bell · 토큰 :root) — 다른 화면에 닿는 규칙 0', len(sels) > 300 and not leak, leak[:6])

        # ── B ── 알림 종
        st, bd, _ = get('/cart-count'); c0 = json.loads(bd); st2, bd2, _ = get('/cart-count?bell=1'); c1 = json.loads(bd2)
        rec('B-1 GET /cart-count — 전과 같은 모양 {n, in} · ?bell=1 이면 {n: 0, bell, in} · 로그인하지 않으면 0 · false', st == 200 and {k: c0.get(k) for k in ('n', 'in')} == {'n': 0, 'in': False} and st2 == 200 and {k: c1.get(k) for k in ('n', 'bell', 'in')} == {'n': 0, 'bell': 0, 'in': False}, (c0, c1))   # v10.31 (w1) — ops(운영 여부) 칸이 더해짐
        ctx2 = b.new_context(viewport={'width': 1500, 'height': 1000}); p3 = ctx2.new_page()
        p3.goto(SITE + '/login', wait_until='networkidle'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); p3.fill('input[name=email]', 'buyer@x.com'); p3.fill('input[name=password]', 'sgb-dev-1234'); p3.click('form.auth button'); p3.wait_for_timeout(2500)
        tok = call('POST', '/auth/login', body={'email': 'buyer@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']; _, sm = call('GET', '/me/summary', tok=tok); unread = int(sm.get('unreadNotifications') or 0)
        p3.goto(SITE + '/money', wait_until='networkidle'); p3.wait_for_timeout(900)
        li = p3.evaluate("""() => { const h = document.querySelector('header.b2-hd'); const bl = h.querySelector('.b2-bell'); return { btns: [...h.querySelectorAll('.b2-login')].map(x => x.textContent.trim()), join: !!h.querySelector('.b2-join'), cart: !!h.querySelector('.b2-cart'),
            bell: bl ? [bl.dataset.bell, (bl.querySelector('.b2-belln') || {}).textContent || '', bl.getAttribute('aria-label')] : null, w: document.documentElement.scrollWidth }; }""")
        cc = p3.evaluate("async () => (await fetch('/cart-count?bell=1', { credentials: 'same-origin' })).json()")
        wantb = [str(unread), ('99+' if unread > 99 else str(unread)) if unread > 0 else '', ('알림 — 읽지 않은 알림 %d건' % unread) if unread > 0 else '알림']
        rec(f'B-2 로그인하면 — 나의공간 · 로그아웃 · 종의 숫자 = 읽지 않은 알림 {unread}건(GET /me/summary) · 0 이면 숫자 없음 · 가로 넘침 없음', li['btns'] == ['나의공간', '로그아웃'] and not li['join'] and not li['cart'] and li['bell'] == wantb and {k: cc.get(k) for k in ('n', 'bell', 'in')} == {'n': 0, 'bell': unread, 'in': True} and li['w'] <= 1500, (li, cc, unread))
        p3.locator('header.b2-hd .b2-bell').click(); p3.wait_for_url('**/my/notifications**', timeout=15000); p3.wait_for_timeout(300)
        rec('B-3 종을 누르면 알림 화면(/my/notifications)', p3.url.replace(SITE, '').startswith('/my/notifications'), p3.url)
        ctx2.close()

        # ── Z ── 좁은 화면 · 화면 오류 · 자리 대조
        ov = []
        for w in (1500, 1460, 1321, 1320, 1281, 1221, 1220, 1141, 1101, 1100, 1024, 960, 901, 900, 768, 721, 720, 480, 390, 360, 320):
            c3 = b.new_context(viewport={'width': w, 'height': 900}); p4 = c3.new_page(); p4.goto(SITE + '/money', wait_until='load'); p4.wait_for_timeout(350)
            sw = p4.evaluate('document.documentElement.scrollWidth')
            if sw > w: ov.append((w, sw))
            c3.close()
        rec('Z-1 폭 21가지(1500 → 320px) — 가로 넘침 없음', not ov, ov)
        rec(f'Z-2 브라우저 오류 0 · 실패한 요청(4xx · 5xx) 0 — /money 를 여는 동안 (v10.29 의 구글 글꼴 요청이 시험 환경에서 막힌 것 {len(ext)}건은 세지 않음)', not errs and not bad, (errs[:3], bad[:3]))
        st, bd, _ = get('/money'); html = bd.decode('utf8', 'replace')
        rec('Z-3 서버가 그려 보낸 글(HTML)에 제목 · 분야 · 요청 제목 · 매물이 들어 있음(검색 로봇 · 느린 기기)', st == 200 and '필요한 업체를' in html and '가구, 인테리어' in html and (not reqs or reqs[0]['title'] in html) and 'id="mny-list"' in html and '<title>소개장터' in html, st)
        env = {**os.environ, 'OUT': OUT, 'SITE': SITE}
        r1 = subprocess.run([sys.executable, os.path.join(OUT, 'shot_mny.py'), 'site'], capture_output=True, text=True, env=env)
        r2 = subprocess.run([sys.executable, os.path.join(OUT, 'measure_mny.py'), 'site'], capture_output=True, text=True, env=env)
        last = (r2.stdout.strip().split('\n') or [''])[-1]
        rec('Z-4 자리 대조 — 받은 그림 ↔ 실제 웹(1500px): 실제 웹에 넣은 구역의 모든 자리가 ±6px 안 · 글자색 같음 (measure_mny.py site)', r1.returncode == 0 and r2.returncode == 0 and '실패 0' in last, last[-260:])
        b.close()


main()
bad = [r for r in R if not r['ok']]
json.dump(R, open(os.path.join(OUT, 'site_mny.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'site_mny {len(R) - len(bad)}/{len(R)}' + (' 실패: ' + ' | '.join(r['step'][:40] for r in bad) if bad else ''))
sys.exit(1 if bad else 0)
