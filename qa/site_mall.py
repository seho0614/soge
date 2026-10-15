# w3 v10.31 사본 — D064(주문 시각 순서)에 맞춰 결제 시각을 과거로 돌릴 때 주문 시각도 함께
"""v10.25 소개몰(쇼핑몰) — 실제 웹 점검. 결과: site_mall.json

  10/7 지시 — 「소개몰 사진대로 적용 · 소개몰 = 소개쇼핑몰」 / 답 — 메뉴 이름을 「소개몰」로 변경 · 받은 그림(JPEG)으로 먼저 · 사진은 원본 PNG 가 오면 교체
  앞선 결정 — 새 머리줄 · 바닥줄은 두 관(소개광장 · 소개몰)에서만 · 자료가 없는 구역(순위 · 정상가 · 할인율 · 별점)은 서버가 생길 때까지 감춤(가짜 값을 넣지 않음)

  N. 이름        서버가 내려 주는 관 이름 · 세 가지 머리줄 · 화면 글자에 「소개뱅크몰」이 남지 않음
  H. 머리 · 바닥  소개몰 화면은 두 관 전용 머리줄 · 바닥줄(회원가입 단추는 그림대로 초록) · 다른 관은 지금 그대로
  M. 메인        사진 띠(제목 · 검색) · 성분으로 찾기 · 고민으로 찾기 · 성분별 최저가 · 상품 = 서버 자료 그대로 · 자료 없는 구역은 없음
  P. 그림        화면이 내주는 조각이 받은 그림에서 손실 없이 자른 파일과 바이트까지 같음
  S. 하위 화면   소개몰의 다른 쪽도 새 머리줄 · 본문 폭 유지
  Z. 좁은 화면 · 화면 오류

사용:  python3 site_mall.py     SITE=http://localhost:5174 · API=http://localhost:3000
"""
import json, os, re, sys, urllib.request
from playwright.sync_api import sync_playwright
from detail_fixture import call, PW

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
OUT = os.path.dirname(os.path.abspath(__file__))
CUT = os.environ.get('CUT', os.path.join(OUT, 'mall_cut'))
SHOT = os.environ.get('SHOT', '')
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:260], file=sys.stderr)
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
GREEN = 'rgb(23, 163, 74)'; NAVY = 'rgb(0, 36, 90)'

def get(u):
    try:
        r = urllib.request.urlopen(urllib.request.Request(SITE + u, headers={'User-Agent': 'Mozilla/5.0 site_mall'}), timeout=60); return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
    except Exception as e: return 0, repr(e).encode()


def main():
    st, gw = call('GET', '/gwans'); hlt = next((g for g in gw if g['code'] == 'HLT'), {})
    rec('N-1 서버가 내려 주는 관 이름이 「소개몰」(GET /gwans · HLT)', st == 200 and hlt.get('name') == '소개몰', hlt.get('name'))
    _, ings = call('GET', '/health/ingredients'); _, cons = call('GET', '/health/concerns'); _, prods = call('GET', '/health/products')
    for u in ['/', '/money', '/health', '/community', '/health/ingredients', '/health/cart', '/health/guide']: get(u)      # 기억해 둔 예전 자료가 아니라 새 자료로(G-161)
    import time; time.sleep(3)
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1500, 'height': 1000}); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(pg.url.replace(SITE, '') + ' — ' + str(e)[:110]))      # 어느 쪽에서 났는지 같이 적습니다(가끔 나는 G-94 와 가르려고)
        def shot(n):
            if SHOT: os.makedirs(SHOT, exist_ok=True); pg.screenshot(path=f'{SHOT}/{n}.png', full_page=True)
        # ── N ── 이름
        navs = {}
        for u, sel in (('/', 'header nav'), ('/mall', 'header.pc-hd nav'), ('/money', 'header.b2-hd nav'), ('/community', 'header.b2-hd nav'), ('/health', 'header nav')):      # v10.30 — 공통 머리줄은 /mall 로 봅니다(소개장터 메인은 10/9 디자인의 머리줄)
          # v10.29 — 공통 머리줄 header.hd → header.pc-hd(오른쪽 .hd-right → .pc-hr)
            pg.goto(SITE + u, wait_until='networkidle'); navs[u] = [norm(x) for x in pg.locator(sel).first.locator('a').all_inner_texts()] if pg.locator(sel).count() else []
        rec('N-2 머리줄 메뉴 — 메인 · 다른 관 · 소개광장 · 소개몰 네 곳 모두 「소개몰」이 있고 「소개뱅크몰」은 없음', all('소개몰' in v and '소개뱅크몰' not in v for v in navs.values()), navs)
        left = []
        for u in ('/', '/money', '/mall', '/biz', '/health', '/health/ingredients', '/health/concerns', '/health/c/ALL', '/health/direct', '/health/guide', '/health/cart', '/health/search', '/community', '/support', '/partner/pricing'):
            r = pg.goto(SITE + u, wait_until='networkidle'); t = pg.inner_text('body') + ' ' + pg.title()
            if '소개뱅크몰' in t or r.status >= 500: left.append((u, r.status, t[max(0, t.find('소개뱅크몰') - 20):t.find('소개뱅크몰') + 30]))
        rec('N-3 화면 15곳의 글자 · 제목에 「소개뱅크몰」이 남지 않음(약관 본문은 개정 절차로 따로)', not left, left[:4])

        # N-4 · N-5 — 옛 이름 정리(10/7 답 「약관까지 같이 고침」) · 직판 고지 문구
        tx = {}
        # 약관 쪽은 300초짜리 자료 보관(Next)을 씁니다 — 첫 방문은 옛 보관분을 주고 뒤에서 새로 받으므로(G-161) 한 번 데운 뒤 잽니다
        for c_ in ('HLT_SALE', 'SERVICE', 'THIRDPARTY'):
            pg.goto(SITE + '/terms/' + c_, wait_until='networkidle')
        pg.wait_for_timeout(1500)
        for c_ in ('HLT_SALE', 'SERVICE', 'THIRDPARTY'):
            r = pg.goto(SITE + '/terms/' + c_, wait_until='networkidle'); tx[c_] = (r.status, norm(pg.inner_text('main')))
        oldn = {c_: [w for w in ('소개머니', '건강상품관', '건강몰', '소개뱅크몰') if w in t_] for c_, (st_, t_) in tx.items()}
        rec('N-4 약관 3종(판매 약관 · 이용약관 · 제3자 제공) 본문에 옛 이름이 없음 — 판매 약관 「소개장터 · 안심소개 · 소개창업 회사는 중개만 …」 「소개몰 ★ 회사가 직접 팝니다」 · 이용약관 「소개몰(직판)」',
            all(st_ == 200 for st_, _ in tx.values()) and not any(oldn.values()) and '소개장터 · 안심소개 · 소개창업 회사는 중개만' in tx['HLT_SALE'][1] and re.search(r'소개몰 +★ 회사가 직접 팝니다', tx['HLT_SALE'][1]) is not None
            and '소개몰(직판)' in tx['SERVICE'][1] and '소개광장 · 소개몰' in tx['THIRDPARTY'][1], (oldn, tx['HLT_SALE'][1][:160]))
        _, pub = call('GET', '/site-settings/public'); dn = (pub or {}).get('legal.direct_notice') or ''
        rec('N-5 직판 고지 문구가 공개 설정으로 내려오고 이름이 「소개몰」(전에는 「건강상품관」 · 화면에 쓰이지 않았음)', '소개몰에서 판매하는 상품은 소개뱅크가 직접 판매' in dn and '건강상품관' not in dn, dn[:80])

        # ── H ── 머리 · 바닥
        pg.goto(SITE + '/health', wait_until='networkidle')
        # v10.29 — 공통 머리줄 header.hd → header.pc-hd(오른쪽 .hd-right → .pc-hr)   · v10.30 — 이 주석이 아래 스크립트 글자 안에 들어가 있어 시험이 멈추던 것을 밖으로 뺌
        h = pg.evaluate("""() => { const q = s => document.querySelector(s); const cs = e => e ? getComputedStyle(e) : null;
            const cur = q('header.b2-hd nav a[aria-current=page]'); const j = q('header.b2-hd .b2-join');
            return { b2: !!q('header.b2-hd'), base: !!q('header.pc-hd'), ft: !!q('footer.b2-ft'), cur: cur ? cur.textContent.trim() : null, join: j ? cs(j).backgroundColor : null,
                     legal: (q('footer.b2-ft .b2-legal') || {}).innerText || '', cart: !!q('header.b2-hd .b2-cart') } }""")
        rec('H-1 소개몰 메인 — 두 관 전용 머리줄 · 바닥줄(옛 머리줄 없음) · 지금 메뉴 표시가 「소개몰」 · 장바구니', h['b2'] and not h['base'] and h['ft'] and h['cur'] == '소개몰' and h['cart'], h)
        rec('H-2 회원가입 단추가 그림대로 초록(#17A34A) — 소개광장에서는 주황 그대로', h['join'] == GREEN, h['join'])
        rec('H-3 바닥줄에 사업자 정보 · 통신판매 표시가 남아 있음(그림에는 없지만 법정 표시)', '사업자등록번호' in h['legal'] and '통신판매업' in h['legal'], h['legal'][:80])
        NT = "[...document.querySelectorAll('footer.b2-ft [data-notice], footer [data-notice]')].map(e => [e.getAttribute('data-notice'), (e.innerText || '').replace(/\\s+/g, ' ').trim()])"
        nt = pg.evaluate(NT); pg.goto(SITE + '/health/guide', wait_until='networkidle'); nt_sub = pg.evaluate(NT)
        rec('H-3b 소개몰의 바닥 고지 — 두 고지를 같이(10/7 답): 직판 고지(「소개몰 직판 상품」) + 통신판매중개자 고지(「매물 등 회원 간 거래」) · 메인과 하위 쪽 모두',
            all([x[0] for x in v] == ['direct', 'inter'] and '직접 판매' in v[0][1] and '소개몰' in v[0][1] and '통신판매중개자' in v[1][1] for v in (nt, nt_sub)), (nt, nt_sub[:1]))
        pg.goto(SITE + '/community', wait_until='networkidle'); nt_c = pg.evaluate(NT)
        rec('H-3c 소개광장의 바닥 고지는 통신판매중개자 고지 하나 그대로', [x[0] for x in nt_c] == ['inter'], nt_c)
        jc = pg.evaluate("getComputedStyle(document.querySelector('header.b2-hd .b2-join')).backgroundColor")
        pg.goto(SITE + '/mall', wait_until='networkidle'); om = pg.evaluate("({ base: !!document.querySelector('header.pc-hd'), b2: !!document.querySelector('header.b2-hd') })")      # v10.30 — 공통 머리줄의 보기를 안심소개로(소개장터 메인은 site_mny.py)
          # v10.29 — 공통 머리줄 header.hd → header.pc-hd(오른쪽 .hd-right → .pc-hr)
        rec('H-4 다른 화면은 그대로 — 소개광장 회원가입 주황(#F5A008) · 소개장터는 옛 머리줄', jc == 'rgb(245, 160, 8)' and om == {'base': True, 'b2': False}, (jc, om))

        # ── M ── 메인
        pg.goto(SITE + '/health', wait_until='networkidle'); shot('web_mall_main')
        m = pg.evaluate("""() => { const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)]; const t = e => e ? e.innerText.replace(/\\s+/g, ' ').trim() : '';
            const hero = q('[data-shop-hero]'); const f = hero ? hero.querySelector('form') : null;
            return { hero: !!hero, h1: t(hero && hero.querySelector('h1')), heroBg: hero ? getComputedStyle(hero).backgroundColor : null, act: f ? f.getAttribute('action') : null, inp: f ? !!f.querySelector('input[name=q]') : false,
              heroPic: hero ? [...hero.querySelectorAll('img')].map(i => i.getAttribute('src')) : [],
              ing: qa('[data-shop-ing] a[data-code]').map(a => [a.getAttribute('data-code'), a.getAttribute('href'), t(a)]),
              con: qa('[data-shop-con] a[data-code]').map(a => [a.getAttribute('data-code'), a.getAttribute('href'), t(a)]),
              low: qa('[data-shop-low] [data-code]').map(a => [a.getAttribute('data-code'), t(a)]),
              prod: qa('[data-shop-products] [data-product]').map(a => [a.getAttribute('data-product'), t(a)]),
              titles: qa('.shop-sec h2').map(t), titleColor: q('.shop-sec h2') ? getComputedStyle(q('.shop-sec h2')).color : null,
              rank: qa('[data-shop-rank], [data-shop-deal], [data-shop-many]').length, stars: (document.querySelector('main').innerText.match(/★/g) || []).length,
              pct: (document.querySelector('main').innerText.match(/\\d+%/g) || []).length, band: t(q('[data-shop-band]')), bandHref: (q('[data-shop-band] a') || {getAttribute(){return null}}).getAttribute('href'),
              nav: qa('.shop-lnav a').map(a => [t(a), a.getAttribute('href')]) } }""")
        rec('M-1 사진 띠 — 남색 바탕 · 제목 「…소개몰에서 만나보세요.」 · 검색 칸이 실제 입력칸(→ /health/search)', m['hero'] and '소개몰에서 만나보세요' in m['h1'] and '믿을 수 있는 건강 상품' in m['h1'] and m['act'] == '/health/search' and m['inp'], (m['h1'], m['act']))
        tiles = [i for i in ings if not i.get('isGroup')][:10]
        rec('M-2 성분으로 찾기 — 서버의 성분 앞 10종(성분군은 빼고 · 이름 · 주소 /health/i/코드)', len(tiles) > 0 and [x[0] for x in m['ing']] == [i['code'] for i in tiles] and all(x[1] == f"/health/i/{x[0]}" for x in m['ing']) and all(i['name'] in x[2] for i, x in zip(tiles, m['ing'])), m['ing'][:3])
        rec('M-3 고민으로 찾기 — 서버의 고민 앞 %d종 그대로(주소 /health/w/코드)' % min(10, len(cons)), len(cons) > 0 and [x[0] for x in m['con']] == [c['code'] for c in cons][:10] and all(x[1] == f"/health/w/{x[0]}" for x in m['con']), m['con'][:3])
        monthly = sorted([i for i in ings if i.get('minUnit') is not None and not i.get('isGroup')], key=lambda i: i['minUnit'])[:8]
        rec('M-4 성분별 최저가(v10.26) — 한 달 단가가 있는 성분 %d종 · 낮은 순 · 「N원 / 30일」 값이 서버와 같음 · 「정상가」 줄 없음' % len(monthly),
            [x[0] for x in m['low']] == [i['code'] for i in monthly] and all(f"{next(i['minUnit'] for i in monthly if i['code'] == x[0]):,}원 / 30일" in x[1] for x in m['low']) and '정상가' not in ' '.join(x[1] for x in m['low']), m['low'][:3])
        fresh = [p_['code'] for p_ in prods if not p_['soldOut']][:4]
        newc = pg.evaluate("[...document.querySelectorAll('[data-shop-new] [data-product]')].map(a => a.getAttribute('data-product'))")
        rec('M-5 새로 올라온 상품(v10.26) — 판매 중인 상품을 올린 순서로 4장(서버 값 그대로)', newc == fresh and len(fresh) > 0, (newc, fresh))
        dealc = pg.evaluate("[...document.querySelectorAll('[data-shop-deal] [data-product]')].map(a => [a.getAttribute('data-product'), a.innerText.replace(/\\s+/g, ' ')])")
        wdeal = [p_ for p_ in prods if p_.get('badge') == '특별가격' and p_.get('offPct') and not p_['soldOut']][:6]
        rec('M-5b 이번 주 특별 할인(v10.26) — 배지 「특별가격」 상품 · 값 · 정가 · 할인율이 서버와 같음', [x[0] for x in dealc] == [p_['code'] for p_ in wdeal] and all(f"{p_['price']:,}원" in x[1] and f"{p_['listPrice']:,}원" in x[1] and f"{p_['offPct']}%" in x[1] for p_, x in zip(wdeal, dealc)), dealc[:2])
        # v10.28 (D037) — 순위가 생겼습니다: 집계(GET /health/rankings)에 상품이 있는 칸만 그림 · 예전 구역(많이 찾는 · 오늘의 · 「소개몰 상품」)은 없음
        _, rkx = call('GET', '/health/rankings')
        want_rk = sum(1 for k in ('sales', 'orders') if ((rkx or {}).get(k) or {}).get('items'))
        # v10.31 (w3 · 10/10 시안 「오늘의 건강상품」 · 「많이 찾는 상품」) — 구역을 다시 그리되 값은 서버 것만: 특가 배너(GET /health/promos) · 순위 상자 탭 3(집계 · 새 상품) ·
        #   집계가 없으면 「아직 집계된 …」 글(지어내지 않음). 예전 「소개몰 상품」 구역은 여전히 없음
        rk = pg.locator('[data-shop-rank]').count(); prod_old = pg.locator('[data-shop-products]').count()
        many_attr = pg.get_attribute('[data-shop-many]', 'data-shop-many') if pg.locator('[data-shop-many]').count() else None
        _, prm = call('GET', '/health/promos')
        has_orders = bool(((rkx or {}).get('orders') or {}).get('items')); has_sales = bool(((rkx or {}).get('sales') or {}).get('items'))
        # v10.34 — 새로 설치한 DB 처럼 판매 · 주문 집계가 둘 다 없으면 순위 상자는 「새로 올라온 상품」 탭으로 열립니다(서버 값 · 지어내지 않음).
        #   전에는 개발 DB 에 집계가 늘 있어 이 경우를 보지 않았습니다
        empty_ok = has_sales or pg.locator('[data-rank-empty]').count() == 1 or (not has_orders and pg.locator('[data-stab="fresh"][aria-selected="true"]').count() == 1)
        rec('M-6 「오늘의 건강상품」 = 특가 배너(서버) + 순위 상자(집계 · 새 상품 — 없으면 「아직 집계된」 글) · 「많이 찾는 상품」 = 주문 집계(없으면 안내) · 예전 「소개몰 상품」 구역 없음',
            rk == 1 and prod_old == 0 and many_attr == ('1' if has_orders else '0') and empty_ok
            and pg.locator('[data-shop-promo]').count() == (1 if prm else 0), (rk, prod_old, many_attr, has_orders, has_sales, empty_ok, len(prm or [])))
        rec('M-7 구역 제목이 남색(#00245A) · 아래 띠 「…소개몰과 함께하세요」 → 전체 상품', m['titleColor'] == NAVY and '소개몰과 함께하세요' in m['band'] and m['bandHref'] == '/health/c/ALL', (m['titleColor'], m['band'][:60], m['bandHref']))
        rec('M-8 작은 메뉴 줄 — 직판관 · 전체제품 · 이용안내(청약철회) · 장바구니로 가는 길이 남아 있음', {'/health/direct', '/health/c/ALL', '/health/guide', '/health/cart'} <= {x[1] for x in m['nav']}, m['nav'])
        pg.fill('[data-shop-hero] input[name=q]', '오메가'); pg.press('[data-shop-hero] input[name=q]', 'Enter'); pg.wait_for_load_state('networkidle')
        rec('M-9 사진 띠의 검색 — 「오메가」 → /health/search?q=오메가 · 결과에 그 상품', '/health/search' in pg.url and 'q=' in pg.url and '오메가' in pg.inner_text('main'), pg.url)

        # ── P ── 그림
        man = json.load(open(os.path.join(OUT, 'mall_assets.json'), encoding='utf-8'))['parts']; bad = []; n = 0
        pg.goto(SITE + '/health', wait_until='networkidle')
        used = sorted(set(pg.evaluate("[...document.querySelectorAll('main img, header img, footer img')].map(i => i.getAttribute('src')).filter(s => s && s.startsWith('/shop/'))")))
        for s_ in used:
            st_, body = get(s_); f = os.path.join(CUT, os.path.basename(s_)); n += 1
            if st_ != 200 or not os.path.exists(f) or body != open(f, 'rb').read(): bad.append((s_, st_))
        rec(f'P-1 메인이 쓰는 그림 조각 {n}개 — 받은 그림에서 손실 없이 자른 파일과 바이트까지 같음(다시 압축 · 형식 바꿈 없음)', n >= 4 and not bad, bad[:3])
        rec('P-2 상품 사진 조각(low · rank · many · new · deal)은 실제 웹에 쓰지 않음 — 디자인의 상품은 실제 상품이 아님', not [s_ for s_ in used if re.search(r'/(low|rank|many|new|deal)-', s_)], used[:6])

        # ── S ── 하위 화면
        code = prods[0]['code'] if prods else 'X'; bads = []
        for u in ('/health/ingredients', '/health/concerns', '/health/c/ALL', '/health/direct', '/health/guide', '/health/cart', '/health/search', f'/health/p/{code}'):
            r = pg.goto(SITE + u, wait_until='networkidle')
            d = pg.evaluate("""() => { const b = document.querySelector('.shop-sub') || document.querySelector('main'); const r = b.getBoundingClientRect();
                return { b2: !!document.querySelector('header.b2-hd'), base: !!document.querySelector('header.pc-hd'), w: Math.round(r.width), x: Math.round(r.left), sw: document.documentElement.scrollWidth, iw: innerWidth } }""")   # v10.29 — 공통 머리줄 header.hd → header.pc-hd(오른쪽 .hd-right → .pc-hr)
            if '/login' in pg.url: continue            # 장바구니는 로그인 화면으로 보냅니다(로그인 화면은 공용 머리줄) — 로그인한 모습은 S-2 가 봅니다
            if r.status != 200 or not d['b2'] or d['base'] or not (900 <= d['w'] <= 1260) or d['sw'] > d['iw']: bads.append((u, r.status, d))
        rec('S-1 소개몰의 다른 쪽 8곳 — 새 머리줄 · 본문 폭 900 ~ 1260px(화면 끝까지 늘어나지 않음) · 가로 넘침 없음', not bads, bads[:3])
        # S-2 — 로그인한 사람의 장바구니 · 내 주문(주소가 /my/health…)도 새 머리줄 · 「소개몰」에 표시
        c3 = b.new_context(viewport={'width': 1500, 'height': 1000}); p3 = c3.new_page(); p3.on('pageerror', lambda e: errs.append('login: ' + str(e)[:140]))
        p3.goto(SITE + '/login', wait_until='networkidle'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); p3.fill('input[name=email]', 'buyer@x.com'); p3.fill('input[name=password]', 'sgb-dev-1234'); p3.click('form.auth button'); p3.wait_for_timeout(2500); bad2 = []
        for u in ('/health/cart', '/my/health/orders', '/my/health/addresses'):
            r = p3.goto(SITE + u, wait_until='networkidle')
            d = p3.evaluate("""() => { const c = document.querySelector('header.b2-hd nav a[aria-current=page]'); const s = document.querySelector('.shop-sub');
                return { b2: !!document.querySelector('header.b2-hd'), cur: c ? c.textContent.trim() : null, w: s ? Math.round(s.getBoundingClientRect().width) : 0, url: location.pathname } }""")
            if r.status != 200 or not d['b2'] or d['cur'] != '소개몰' or not (900 <= d['w'] <= 1260): bad2.append((u, r.status, d))
        rec('S-2 로그인한 사람의 장바구니 · 내 주문 · 배송지 — 새 머리줄 · 메뉴 표시 「소개몰」 · 본문 폭 유지', not bad2, bad2[:3])
        if SHOT: p3.goto(SITE + '/health/cart', wait_until='networkidle'); p3.screenshot(path=f'{SHOT}/web_mall_cart.png', full_page=True)
        c3.close()
        if SHOT: pg.goto(SITE + f'/health/p/{code}', wait_until='networkidle'); shot('web_mall_product'); pg.goto(SITE + '/health/ingredients', wait_until='networkidle'); shot('web_mall_ingredients')

        # ── V ── 시안 기준 화면 구성(10/8 확정 — 다른 점은 시안을 기준으로 · 남기기로 한 10건 · 개발분 값 3건)
        _, hcats = call('GET', '/health/categories'); hcats = hcats if isinstance(hcats, list) else []
        opens = [c_ for c_ in hcats if c_['state'] == 'OPEN' and c_['productCount'] > 0]; locks = [c_ for c_ in hcats if c_['state'] == 'LOCKED']; nots = [c_ for c_ in hcats if c_['state'] == 'NOT_SOLD']
        oc = opens[0]['code'] if opens else 'HLT_FOOD'; pcode = prods[0]['code'] if prods else 'X'
        popt = prods[0].get('cartOptionId') if prods else None      # v10.26 — 옵션이 여럿인 상품은 옵션을 골라 담고 주문합니다
        ing_on = next((i_['code'] for i_ in (ings or []) if i_['productCount']), 'GINSENG'); _, cd = call('GET', '/health/concerns/IMMUNE'); cd = cd if isinstance(cd, dict) else {}
        JSB = """() => { const a = document.querySelector('main [data-back]'); const cr = document.querySelector('main .hlt-crumb a');
            return { back: a ? [a.textContent.trim(), a.getAttribute('href')] : null, lnav: !!document.querySelector('main .hlt-lnav'), crumb: cr ? cr.textContent.trim() : null } }"""
        vb = []
        for u, par in (('/health/direct', '/health'), (f'/health/c/{oc}', '/health'), ('/health/search', '/health'), ('/health/ingredients', '/health'), (f'/health/i/{ing_on}', '/health/ingredients'),
                       ('/health/concerns', '/health'), ('/health/w/IMMUNE', '/health/concerns'), (f'/health/p/{pcode}', '/health'), ('/health/guide', '/health')):
            pg.goto(SITE + u, wait_until='networkidle'); d = pg.evaluate(JSB)
            if d['back'] != ['← 뒤로', par] or d['lnav'] or d['crumb'] != '소개몰': vb.append((u, d))
        rec('V-1 둘러보는 쪽 9곳 — 「← 뒤로」(시안의 부모 화면으로) + 경로 줄 「소개몰 › …」 · 둘째 메뉴 줄 없음(시안에는 메인에만 작은 메뉴 줄)', not vb, vb[:3])
        # 전체제품 — 갈래 단추
        r = pg.goto(SITE + '/health/c/ALL', wait_until='networkidle'); chips = [norm(x) for x in pg.locator('main .hlt-chips').first.locator('a, span.hlt-chip').all_inner_texts()]
        lockel = pg.evaluate("[...document.querySelectorAll('main [data-sale-cats] .hlt-chip.lock')].map(e => [e.tagName, e.getAttribute('aria-disabled'), e.getAttribute('title') || ''])")
        rec('V-2 전체제품 — 갈래 단추 = 열린 갈래(상품이 있는 것) + 잠긴 갈래 🔒 · 「전체」 단추와 팔지 않는 갈래는 없음 · 「전체제품」은 첫 열린 갈래를 엶 · 잠긴 갈래는 누를 수 없음(시안과 같게 — 안내는 풍선 글)',
            chips == [c_['name'] for c_ in opens] + [c_['name'] + ' 🔒' for c_ in locks] and pg.url.rstrip('/').endswith('/health/c/' + oc)
            and len(lockel) == len(locks) and all(x[0] == 'SPAN' and x[1] == 'true' and x[2] for x in lockel), (chips, pg.url, lockel))
        t_ = norm(pg.inner_text('main')); n_ = opens[0]['productCount'] if opens else -1
        rec('V-2b 전체제품 — 「전체 N개」 · 끝에 「전체 N개 · 한 쪽입니다.」 · 취급하지 않는 것 안내로 가는 길(남기기로 한 것)', f'전체 {n_}개' in t_ and f'전체 {n_}개 · 한 쪽입니다.' in t_ and pg.locator('main a[href="/health/guide#not-sold"]').count() == 1, t_[-160:])
        lk = locks[0] if locks else {'code': 'HLT_FUNC', 'name': '건강기능식품', 'note': ''}
        pg.goto(SITE + '/health/c/' + lk['code'], wait_until='networkidle'); t_ = norm(pg.inner_text('main'))
        rec('V-3 잠긴 갈래(건강기능식품) — 「🔒 … 준비 중」 안내(서버의 안내 글) + 「열린 품목 보기」 · 상품 카드 없음', '🔒' in t_ and (lk['note'] or '준비 중')[:20] in t_ and pg.locator('main a', has_text='열린 품목 보기').count() == 1 and pg.locator('main .hlt-card').count() == 0, t_[:200])
        ns = nots[0] if nots else {'code': 'HLT_MEDDEV', 'note': ''}
        pg.goto(SITE + '/health/c/' + ns['code'], wait_until='networkidle'); t_ = norm(pg.inner_text('main'))
        rec('V-3b 팔지 않는 갈래(의료기기) 주소로 바로 가면 — 「현재 판매하지 않습니다」 안내 · 상품 카드 없음', (ns['note'] or '판매하지 않습니다')[:18] in t_ and pg.locator('main .hlt-card').count() == 0, t_[:200])
        # 성분별 — 성분 찾기 칸
        pg.goto(SITE + '/health/ingredients', wait_until='networkidle'); n_all = pg.locator('main .hlt-icard:visible').count(); box = pg.locator('main input[type=search]')
        ok_box = box.count() == 1
        if ok_box: box.fill('홍삼'); pg.wait_for_timeout(250)
        n_f = pg.locator('main .hlt-icard:visible').count(); names_f = [norm(x) for x in pg.locator('main .hlt-icard:visible .nm').all_inner_texts()]
        if ok_box: box.fill(''); pg.wait_for_timeout(250)
        rec('V-4 성분별 — 「성분 찾기」 칸: 「홍삼」을 넣으면 홍삼이 든 성분(성분군 「홍삼·한방성분」 포함)만 남고 지우면 모두 돌아옴(다른 이름으로도 찾음)', ok_box and n_all == len([i for i in (ings or []) if not i.get('isGroup')]) and 1 <= n_f < n_all and all('홍삼' in x for x in names_f) and pg.locator('main .hlt-icard:visible').count() == n_all, (ok_box, n_all, n_f, names_f))
        pg.goto(SITE + '/health/concerns', wait_until='networkidle'); prs = [norm(x) for x in pg.locator('main .hlt-icard .pr').all_inner_texts()]
        rec('V-5 고민별 — 「성분 N종」 · 일부만 취급하면 「성분 N종 (취급 N)」(시안 표기) · 「상품 N개」는 적지 않음', len(prs) == len(cons or []) and all(re.fullmatch(r'성분 \d+종( \(취급 \d+\))?', x) for x in prs), prs)
        pg.goto(SITE + '/health/w/IMMUNE', wait_until='networkidle'); lchips = [norm(x) for x in pg.locator('main .hlt-chip.lock').all_inner_texts()]
        want_l = [g_['name'] + ' 🔒' for g_ in cd.get('ingredients', []) if not g_.get('productCount')]
        rec('V-6 고민 상세(면역) — 살 수 있는 상품이 없는 성분은 모두 「이름 🔒」(누를 수 없음 · 시안 표기 — 「· 준비 중」이라고 적지 않음) · 서버 값과 같음', bool(want_l) and sorted(lchips) == sorted(want_l), (lchips, want_l))
        pg.goto(SITE + f'/health/p/{pcode}', wait_until='networkidle'); t_ = norm(pg.inner_text('main'))
        rows_ = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('main [data-ship-block] tr')].map(tr => [tr.querySelector('th').textContent.trim(), tr.querySelector('td').textContent.trim()]))")
        rec('V-7 상품 상세 — 「배송 · 교환 · 반품」 표: 배송비 「전 상품 무료」 · 반품 배송비 「왕복 6,000원 …」 · 화면에 「3만원」 없음 · 청약철회 제한 · 판매자 정보는 그대로',
            rows_.get('배송비') == '전 상품 무료' and '왕복 6,000원' in rows_.get('반품 배송비', '') and '3만원' not in t_ and '3,000원' not in t_ and pg.locator('main [data-seller-block]').count() == 1 and ('철회 제한' in rows_ or '청약철회' in rows_), (rows_, [x for x in ('3만원', '3,000원') if x in t_]))
        # 로그인한 구매자 — 장바구니 · 주문서 · 실패 · 내 주문 · 반품 · 배송지
        BUYT = call('POST', '/auth/login', body={'email': 'buyer@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
        call('POST', '/me/health/cart', BUYT, {'productCode': pcode, 'optionId': popt, 'qty': 1})
        c4 = b.new_context(viewport={'width': 1500, 'height': 1000}); p4 = c4.new_page(); p4.on('pageerror', lambda e: errs.append(p4.url.replace(SITE, '') + ' — ' + str(e)[:110]))
        p4.goto(SITE + '/login', wait_until='networkidle'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); p4.fill('input[name=email]', 'buyer@x.com'); p4.fill('input[name=password]', 'sgb-dev-1234'); p4.click('form.auth button'); p4.wait_for_timeout(2500)
        vb2 = []
        for u, par in (('/health/cart', '/health'), ('/health/order', '/health/cart'), ('/health/order/fail?step=order&code=NOT_ON_SALE', '/health/order')):
            p4.goto(SITE + u, wait_until='networkidle'); d = p4.evaluate(JSB)
            if d['back'] != ['← 뒤로', par] or d['lnav']: vb2.append((u, d))
        rec('V-8 장바구니 · 주문서 · 주문 실패 — 「← 뒤로」(장바구니 → 메인 · 주문서 → 장바구니 · 실패 → 주문서) · 둘째 메뉴 줄 없음', not vb2, vb2)
        p4.goto(SITE + '/health/cart', wait_until='networkidle'); t_ = norm(p4.inner_text('main'))
        rec('V-9 장바구니 — 배송비 「무료」 · 「3만원」 「더 담으시면」 없음 · 단계 줄에 화살표(장바구니 → 주문서 → 결제 → 완료)', '3만원' not in t_ and '더 담으시면' not in t_ and re.search(r'배송비 ?(무료|0원)', t_) is not None and p4.evaluate("getComputedStyle(document.querySelector('main .hlt-steps li:nth-child(2)'), '::before').content").strip('"') == '→', t_[:200])
        p4.goto(SITE + '/health/order', wait_until='networkidle'); _, addrs_ = call('GET', '/me/health/addresses', BUYT)
        o1 = p4.evaluate("""() => { const vis = e => !!(e.offsetWidth || e.offsetHeight); return { radios: [...document.querySelectorAll('main input[name=addr]')].filter(vis).length, picked: !!document.querySelector('main [data-addr-picked]'),
            chg: !!document.querySelector('main [data-addr-change]'), mng: !!document.querySelector('main a[href^="/my/health/addresses"]'), btn: (document.querySelector('main button.cta-primary') || {}).textContent || '' } }""")
        if o1['chg']: p4.click('main [data-addr-change]'); p4.wait_for_timeout(200)
        o2 = p4.evaluate("[...document.querySelectorAll('main input[name=addr]')].filter(e => !!(e.offsetWidth || e.offsetHeight)).length")
        rec('V-10 주문서 — 배송지는 고른 한 곳만 보이고 「변경」을 누르면 전체가 펼쳐짐 · 「배송지 관리」 · 단추 「○원 결제하기」(시안)', o1['radios'] == 0 and o1['picked'] and o1['chg'] and o1['mng'] and o2 == len(addrs_ or []) >= 1 and re.fullmatch(r'[\d,]+원 결제하기', norm(o1['btn'])) is not None, (o1, o2, len(addrs_ or [])))
        fb = {}
        for k_, u in (('order', '/health/order/fail?step=order&code=NOT_ON_SALE'), ('pay', '/health/order/fail?step=pay&no=H0&code=PAY_REJECTED')):
            p4.goto(SITE + u, wait_until='networkidle'); fb[k_] = [norm(x) for x in p4.locator('main .hlt-btns a').all_inner_texts()]
        rec('V-11 주문 실패 — 단추 「다시 시도」 「주문 내역」(시안) · 「장바구니로」 「다시 결제하기」 없음', fb == {'order': ['다시 시도', '주문 내역'], 'pay': ['다시 시도', '주문 내역']}, fb)
        _, myo = call('GET', '/me/health/orders', BUYT); myo = myo if isinstance(myo, list) else []
        _, myr = call('GET', '/me/health/returns', BUYT); busy = {r_['orderNo'] for r_ in (myr or []) if r_['state'] in ('REQUESTED', 'APPROVED')}      # 신청이 걸려 있는 주문은 신청 화면에 폼이 없습니다
        # 배송 완료 주문 — 발송 기록이 있는 것(발송 · 배송 완료 날짜를 함께 봅니다). 다른 시험이 「배송 완료」만 넣어 둔 주문(발송 기록 없음)은 고르지 않습니다
        from detail_fixture import q as _qp
        _paid = lambda no_: _qp(f"select exists(select 1 from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{no_}' and p.approved_at is not null)") == 't'      # v10.27 G-184 — 결제 승인이 있는 주문만 환불 표가 나옴
        dlv = next((o_ for o_ in myo if o_['status'] == 'DELIVERED' and o_['orderNo'] not in busy and o_.get('shippedAt') and _paid(o_['orderNo'])), None); pnd = next((o_ for o_ in myo if o_['status'] == 'PENDING' and not o_.get('cancelRequested')), None)      # v10.28 — 취소 신청 중인 결제 대기 주문은 단추가 다름(G-183) — 고르지 않음(없으면 아래에서 만듦)
        if not dlv and addrs_:      # 새로 만든 DB(Docker)에는 배송 완료 주문이 없습니다 — 하나 만들어 씁니다(운영 화면에 발송 입력이 아직 없어 DB 에 바로: 결제 완료 → 발송 2일 전 · 배송 완료 1일 전 · G-147). 남겨 둡니다
            from detail_fixture import q as _q
            st_o, o_d = call('POST', '/health/orders', BUYT, {'addressId': next((a_ for a_ in addrs_ if a_.get('isDefault')), addrs_[0])['id'], 'items': [{'productCode': pcode, 'optionId': popt, 'qty': 1}]})
            if st_o < 300 and isinstance(o_d, dict) and o_d.get('orderNo'):
                oid_ = _q(f"select id from hlt_orders where order_no='{o_d['orderNo']}'")
                # v10.27 (G-184) — 결제 승인 기록이 있어야 「결제한 주문」 — 시험 결제(스텁)로 결제한 뒤 결제 시각만 사흘 전으로
                import uuid as _uuid
                call('POST', f"/health/orders/{o_d['orderNo']}/pay", BUYT, {'method': 'CARD'})
                call('POST', f"/health/orders/{o_d['orderNo']}/pay/confirm", BUYT, {'paymentKey': 'stub_' + _uuid.uuid4().hex, 'amount': int(o_d.get('total', 0))})
                # v10.31 — 시각은 몇십 분 전으로(전: 나흘 전) — buyer@x.com 은 시험 주문이 많아 나흘 전 주문은 「최근 50건」 목록 · 화면 밖으로 밀려 고를 수 없었음
                _q(f"update hlt_orders set created_at=now() - interval '40 minutes', paid_at=now() - interval '30 minutes' where id='{oid_}'")
                _q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid_}','PICKED',now() - interval '20 minutes')")      # → 주문이 「배송중」 · 발송 시각
                _q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid_}','DELIVERED',now() - interval '10 minutes')")   # → 「배송 완료」 · 배송 완료 시각
                _, myo = call('GET', '/me/health/orders', BUYT); myo = myo if isinstance(myo, list) else []
                dlv = next((o_ for o_ in myo if o_['orderNo'] == o_d['orderNo'] and o_['status'] == 'DELIVERED'), None)
        made_pnd = None
        if not pnd and addrs_:      # 결제 대기 주문은 시간이 지나면 닫힙니다 — 없으면 이 시험이 하나 만들어 쓰고 끝에 취소합니다
            st_o, o_new = call('POST', '/health/orders', BUYT, {'addressId': next((a_ for a_ in addrs_ if a_.get('isDefault')), addrs_[0])['id'], 'items': [{'productCode': pcode, 'optionId': popt, 'qty': 1}]})
            if st_o < 300 and isinstance(o_new, dict): made_pnd = o_new.get('orderNo'); _, myo = call('GET', '/me/health/orders', BUYT); pnd = next((o_ for o_ in myo if o_['orderNo'] == made_pnd), None)
        p4.goto(SITE + '/my/health/orders', wait_until='networkidle')
        rowj = """(no) => { const r = [...document.querySelectorAll('main .hlt-ord')].find(e => e.textContent.includes(no)); return r ? { name: (r.querySelector('[data-first-item]') || {}).textContent || '', btns: [...r.querySelectorAll('.hlt-btns a')].map(a => a.textContent.trim()) } : null }"""
        rd = p4.evaluate(rowj, dlv['orderNo']) if dlv else None; rp = p4.evaluate(rowj, pnd['orderNo']) if pnd else None
        rec('V-12 내 주문 — 주문마다 상품 이름(서버 값 · 여러 개면 「외 N건」) + 상태별 단추(배송 완료: 배송조회 · 반품신청 · 상세보기 / 결제 대기: 결제하기 · 주문취소 · 상세보기) · 메뉴 줄은 그대로(남기기로 한 것)',
            bool(dlv and pnd and rd and rp) and rd['btns'] == ['배송조회', '반품신청', '상세보기'] and rp['btns'] == ['결제하기', '주문취소', '상세보기'] and (dlv.get('firstItemName') or 'X') in rd['name'] and (pnd.get('firstItemName') or 'X') in rp['name'] and p4.locator('main nav.hlt-lnav').count() == 1,
            (rd, rp, (dlv or {}).get('firstItemName')))
        # V-12b — 날짜 표기는 시안대로 「2026.10.03」(전에는 「2026. 10. 3.」)
        dts = p4.evaluate("(no) => { const r = [...document.querySelectorAll('main .hlt-ord')].find(e => e.textContent.includes(no)); return r ? r.innerText : '' }", dlv['orderNo']) if dlv else ''
        if dlv: p4.goto(SITE + f"/my/health/orders/{dlv['orderNo']}", wait_until='networkidle')
        tms = p4.evaluate("() => Object.fromEntries([...document.querySelectorAll('main tr')].map(tr => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim()]))") if dlv else {}
        rec('V-12b 날짜 표기가 시안과 같음 — 내 주문 「2026.10.03 · 주문번호」 「발송 2026.10.03 · 배송 완료 2026.10.06」 · 주문 상세의 단계별 시각 「2026.10.03 14:20」',
            bool(dlv) and re.search(r'\d{4}\.\d{2}\.\d{2} · ' + re.escape(dlv['orderNo']), dts) is not None and re.search(r'발송 \d{4}\.\d{2}\.\d{2}( · 배송 완료 \d{4}\.\d{2}\.\d{2})?', dts) is not None
            and all(re.fullmatch(r'\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}', tms.get(k_, '')) for k_ in ('주문', '결제', '발송', '배송 완료')), (dts[:120], {k_: tms.get(k_) for k_ in ('주문', '결제', '발송', '배송 완료')}))
        if dlv:
            p4.goto(SITE + f"/my/health/returns/new?o={dlv['orderNo']}", wait_until='networkidle')
            st_ = [norm(x) for x in p4.locator('main ol.hlt-steps li').all_inner_texts()]; est = p4.evaluate("() => Object.fromEntries([...document.querySelectorAll('main [data-refund-table] .hlt-sum')].map(e => [e.children[0].textContent.trim(), e.children[1].textContent.trim()]))")
            tot_ = int(p4.evaluate("Number((document.querySelector('main [data-refund-table]') || {dataset:{}}).dataset.paid || -1)"))
            rec('V-13 취소 · 반품 신청 — 단계 줄(항목 선택 → 사유 → 환불 확인 → 접수) · 환불 예상 표(결제 금액 · 반품 배송비(왕복) · 환불 예정액)가 고른 사유에 맞음 · 교환 · 개봉 여부 · 마감일은 그대로',
                st_ == ['항목 선택', '사유', '환불 확인', '접수'] and set(est) == {'결제 금액', '반품 배송비 (왕복)', '환불 예정액'} and est.get('결제 금액') == f'{tot_:,}원' and '포장을 여셨나요' in norm(p4.inner_text('main')) and p4.locator('main button', has_text='교환').count() >= 1, (st_, est, tot_))
        else: rec('V-13 취소 · 반품 신청 — (배송 완료 주문이 없어 볼 수 없음)', False, 'no delivered order')
        p4.goto(SITE + '/my/health/addresses', wait_until='networkidle')
        rec('V-14 배송지 관리 — 새 배송지에 「기본 배송지로 설정」 칸(시안)', p4.locator('main label', has_text='기본 배송지로 설정').locator('input[type=checkbox]').count() == 1)
        if made_pnd: call('POST', '/me/health/returns', BUYT, {'orderNo': made_pnd, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        call('PATCH', f'/me/health/cart/lines/{popt}', BUYT, {'qty': 0}); c4.close()
        pg.goto(SITE + '/health/guide', wait_until='networkidle'); t_ = norm(pg.inner_text('main'))
        nsrow = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('main #not-sold tr')].map(tr => [tr.querySelector('th').textContent.trim(), tr.querySelector('td').textContent.trim()]))")
        rec('V-15 이용안내 — 「배송비는 받지 않습니다(전 상품 무료)」 · 취급하지 않는 것에 의약품 · 의료기기(현재 판매하지 않습니다) · 의료 서비스 · 건강기능식품은 준비 중 안내 · 「3만원」 「심의필 번호를 표시」 없음 · 배송 · 환불 기한 · 판매 약관 전문은 그대로',
            '배송비는 받지 않습니다' in t_ and set(nsrow) >= {'의약품', '의료기기', '의료 서비스'} and '현재 판매하지 않습니다' in nsrow.get('의료기기', '') and (lk['note'] or '준비 중')[:16] in t_ and '3만원' not in t_ and '심의필 번호를 표시' not in t_ and '영업일 2일' in t_ and '영업일 3일' in t_ and pg.locator('main article.doc .doc-body').count() == 1 and '재판매가 어려운 건강기기' in t_ and '의료기기 · 건강기기' not in t_, (nsrow, [x for x in ('3만원', '심의필 번호를 표시') if x in t_]))
        memo = []
        for u in ('/health', '/health/direct', f'/health/c/{oc}', '/health/ingredients', f'/health/i/{ing_on}', '/health/concerns', '/health/w/IMMUNE', f'/health/p/{pcode}', '/health/guide', '/health/search'):
            pg.goto(SITE + u, wait_until='networkidle'); t_ = pg.inner_text('main')
            hit = [w for w in ('INV-H', '프로토타입', '법무 H-6', '회신 대기', '02-0000-0000', '관리자 · 수집관리') if w in t_]
            if hit: memo.append((u, hit))
        rec('V-16 시안의 설계 메모 · 시연용 글 · 임시 값(02-0000-0000 · 「회신 대기」)이 실제 화면에 없음 — 10곳', not memo, memo)

        # ── E ── 없는 주소 화면(v10.25 · G-166) — 전에는 영어 기본 화면(「404 This page could not be found.」)이었습니다. 소개몰만이 아니라 사이트 전체
        e_bad = []
        for u in ('/health/nope-x', '/money/nope-x', '/nope-x/y'):
            r = pg.goto(SITE + u, wait_until='networkidle')
            d = pg.evaluate("""() => { const m = document.querySelector('main') || document.body; const a = [...m.querySelectorAll('a')].find(x => x.getAttribute('href') === '/');
                return { t: m.innerText, home: a ? a.innerText.trim() : null, title: document.title, hd: !!document.querySelector('header'), ft: !!document.querySelector('footer') } }""")
            if r.status != 404 or '없는 주소입니다' not in d['t'] or 'could not be found' in d['t'] or d['home'] != '홈으로' or '없는 주소' not in d['title'] or not d['hd'] or not d['ft']: e_bad.append((u, r.status, d['t'][:50], d['home'], d['title']))
        rec('E-1 없는 주소 화면이 한글 — 「없는 주소입니다」 · 「홈으로」 · 응답은 404 그대로 · 머리줄 · 바닥줄 있음(소개몰 주소 · 다른 관 주소 · 그 밖)', not e_bad, e_bad[:3])

        # ── Z ──
        c2 = b.new_context(viewport={'width': 390, 'height': 844}); p2 = c2.new_page(); p2.on('pageerror', lambda e: errs.append('390: ' + str(e)[:140])); over = []
        for u in ('/health', '/health/ingredients', '/health/cart'):
            p2.goto(SITE + u, wait_until='networkidle'); o = p2.evaluate("({ sw: document.documentElement.scrollWidth, iw: innerWidth })")
            if o['sw'] > o['iw'] + 1: over.append((u, o))
            if SHOT and u == '/health': p2.screenshot(path=f'{SHOT}/web_mall_main_390.png', full_page=True)
        rec('Z-1 390px — 메인 · 성분 목록 · 장바구니에 가로 넘침 없음', not over, over)
        shop_errs = [e for e in errs if e.startswith(('/health', '/my/health', '390', 'login'))]
        # 가끔 나는 다시 그리기 오류(React #418 · G-94 — 1/60 쯤)와 늘 나는 오류를 가립니다: 오류가 난 쪽을 새 창으로 10번 다시 열어 한 번이라도 또 나면 실패
        again = []
        for u_ in sorted({e.split(' — ')[0] for e in shop_errs if e.startswith('/')}):
            for _ in range(10):
                cx = b.new_context(viewport={'width': 1500, 'height': 1000}); px = cx.new_page(); ex = []; px.on('pageerror', lambda e: ex.append(str(e)[:90]))
                px.goto(SITE + u_, wait_until='networkidle'); px.wait_for_timeout(150); cx.close()
                if ex: again.append((u_, ex[0])); break
        hard = [e for e in shop_errs if not e.startswith('/')] + again
        rec('Z-0 소개몰 화면에서 난 화면 오류(스크립트 · 다시 그리기) 0 — 한 번 난 쪽은 10번 다시 열어 또 나는지 봄', not hard, (hard[:3], shop_errs[:3]))
        if shop_errs and not hard: R.append({'step': 'Z-0c (참고) 소개몰 화면에서 한 번 난 다시 그리기 오류 — 10번 다시 열어 또 나지 않음(가끔 나는 기존 결함 G-94)', 'ok': True, 'skip': True, 'detail': str(shop_errs[:3])[:300]})
        if [e for e in errs if e not in shop_errs]: R.append({'step': 'Z-0b (참고) 소개몰 밖의 화면에서 난 오류 — 가끔 나는 기존 결함 G-94 인지 쪽을 보고 가립니다', 'ok': True, 'skip': True, 'detail': str([e for e in errs if e not in shop_errs][:3])[:300]})
        b.close()


if __name__ == '__main__':
    try: main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'site_mall.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
