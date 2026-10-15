"""소개몰 서버 기능 — 화면 검증 (Playwright, 실제 로그인 · 버튼 클릭).

  v10.25 — 건강기능식품이 잠기고 의료기기를 팔지 않게 되어(D025) 상품 이름을 박아 두지 않고 **서버가 지금 파는 것**에서 고릅니다
           (고민 · 성분 · 상품). 전에는 오메가-3 · 비타민 D 상품 이름을 박아 두었습니다.

  API=http://localhost:3012/api/v1 SITE=http://localhost:5193 BO=http://localhost:5194 python3 srv_hlt_ui.py
"""
import json, os, re, sys, uuid, subprocess, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)
B = os.environ.get('API', 'http://localhost:3000/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174')
BO = os.environ.get('BO', 'http://127.0.0.1:5173')
DB = os.environ.get('DATABASE_URL', 'postgresql://sgb:sgb@localhost:5432/sgb')
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:200]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)


def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(B + p, method=m, data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')


BUY = call('POST', '/auth/login', body={'email': 'buyer@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
ADDR = next(a for a in call('GET', '/me/health/addresses', BUY)[1] if a['isDefault'])['id']
PROD = q("select code from hlt_products where status='ON_SALE' and (select count(*) from hlt_product_options o where o.product_id=hlt_products.id and o.is_active)=1 order by stock desc, code limit 1")
# 시험 준비 — 이 시험은 주문 3건(4개)을 만들고 그 가운데 2건은 남깁니다. 여러 번 돌리면 재고가 바닥나므로 모자라면 채워 둡니다(개발 DB · 운영 화면에 재고 입력이 아직 없음 — G-147)
if PROD and int(q(f"select stock from hlt_products where code='{PROD}'") or 0) < 10: q(f"update hlt_product_options set stock = 10 where product_id=(select id from hlt_products where code='{PROD}')")
# 지금 파는 것 — 상품이 있는 고민 · 그 안의 (상품 있는 · 없는) 성분 · 그 성분의 상품
CONS = [call('GET', '/health/concerns/' + c_['code'])[1] for c_ in call('GET', '/health/concerns')[1]]
CON = next((c_ for c_ in CONS if c_.get('products')), None) or {}
ING = next((g_ for g_ in CON.get('ingredients', []) if g_.get('productCount')), None) or {}
OFF = next((g_ for c_ in CONS for g_ in c_.get('ingredients', []) if not g_.get('productCount')), None) or {}
INGD = call('GET', '/health/ingredients/' + ING.get('code', 'X'))[1] if ING else {}
P1 = (INGD.get('products') or [{}])[0]
stock = lambda: int(q(f"select stock from hlt_products where code='{PROD}'"))
text = lambda pg: pg.evaluate("document.body.innerText")

with sync_playwright() as p:
    b = p.chromium.launch()
    # ── 공개 화면: 고민 · 성분 ──
    c = b.new_context(); pg = c.new_page()
    pg.goto(SITE + '/health/concerns'); t = text(pg)
    for u_ in ('/health/concerns', '/health/w/' + CON.get('code', 'X'), '/health/i/' + ING.get('code', 'X'), '/health/ingredients', '/health/p/' + P1.get('code', 'X')):      # 사용자 웹이 잠깐 기억해 둔 예전 자료를 한 번 흘려보냅니다(G-161)
        pg.goto(SITE + u_, wait_until='networkidle')
    pg.wait_for_timeout(1200)
    pg.goto(SITE + '/health/concerns'); t = text(pg)
    rec(f'UI-1 고민별: {len(CONS)}개 · 서버 데이터', len(CONS) >= 1 and pg.locator('.hlt-icard').count() == len(CONS) and '성분' in t, pg.locator('.hlt-icard').count())
    pg.locator('.hlt-icard', has_text=CON.get('name', '없는 고민')).click(); pg.wait_for_load_state('networkidle'); t = text(pg)
    rec(f"UI-2 고민 상세({CON.get('name')}): 서버가 준 상품 {len(CON.get('products', []))}개가 모두 보임 · 「많이 찾는 성분」", bool(CON.get('products')) and all(p_['name'] in t for p_ in CON['products']) and '많이 찾는 성분' in t, pg.url)
    pg.locator('a.hlt-chip', has_text=ING.get('name', '없는 성분')).click(); pg.wait_for_url('**ing=' + ING.get('code', 'X'), timeout=10000); pg.wait_for_timeout(800); t = text(pg)
    offc = pg.locator('.hlt-chip.lock', has_text=OFF.get('name', '없는 성분')) if OFF else None
    rec(f"UI-3 성분 칩({ING.get('name')})으로 좁힘 — 그 성분의 상품이 보임 · 살 수 있는 상품이 없는 성분({OFF.get('name')})은 누를 수 없는 칸(🔒)",
        ('ing=' + ING.get('code', 'X')) in pg.url and P1.get('name', '없는 상품') in t and (offc is None or (offc.count() >= 0 and pg.locator('a.hlt-chip', has_text=OFF['name']).count() == 0)), pg.url)
    pg.goto(SITE + '/health/i/' + ING.get('code', 'X')); t = text(pg)
    rec(f"UI-4 성분 상세({ING.get('name')}): 상품 · 많이 찾는 고민", P1.get('name', '없는 상품') in t and '많이 찾는 고민' in t and all(c_['name'] in t for c_ in INGD.get('concerns', [])[:1]), t[:80])
    pg.goto(SITE + '/health/ingredients'); t = text(pg)
    rec('UI-5 성분별: 최저가(v10.26 — 「월 N원 부터」 · 개월 수 없는 상품뿐이면 「최저 N원」) · 준비 중 회색', ('최저' in t or re.search(r'월 [\d,]+원 부터', t)) and '취급 준비 중' in t and pg.locator('.hlt-icard.off').count() >= 1, pg.locator('.hlt-icard.off').count())
    pg.goto(SITE + '/health/p/' + P1.get('code', 'X')); t = text(pg)
    # v10.26 — 시안의 상품 상세: 경로 줄에 대표 성분(누르면 성분 상세) · 아래 「관련 고민」(시안 제목)
    rec(f"UI-6 상품 상세({P1.get('code')}): 성분으로 가는 길 · 관련 고민", pg.locator('.hlt-crumb a', has_text=ING.get('name', '없는 성분')).count() + pg.locator('.hlt-chip', has_text=ING.get('name', '없는 성분')).count() >= 1 and '관련 고민' in t, '')
    c.close()

    # ── 고객: 취소 신청 ──
    c = b.new_context(); pg = c.new_page(); pg.on('dialog', lambda d: d.accept())
    pg.goto(SITE + '/login'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234')
    pg.click('form.auth button'); pg.wait_for_timeout(2000)
    s0 = stock()
    st, o = call('POST', '/health/orders', BUY, {'addressId': ADDR, 'items': [{'productCode': PROD, 'qty': 2}]})
    no = o['orderNo']
    pg.goto(f'{SITE}/my/health/returns/new?o={no}'); t = text(pg)
    rec('UI-7 취소 화면: 서버 판정 문구', '발송 전이라 주문 취소로 접수합니다' in t, t[:120])
    pg.locator('button.cta-primary').click(); pg.wait_for_timeout(2000)
    rec('UI-8 취소 접수 버튼 → 접수 완료', pg.locator('.ok-note').count() == 1, text(pg)[:120])

    # 기간 밖 주문
    st, o2 = call('POST', '/health/orders', BUY, {'addressId': ADDR, 'items': [{'productCode': PROD, 'qty': 1}]})
    no2 = o2['orderNo']; oid2 = q(f"select id from hlt_orders where order_no='{no2}'")
    q(f"update hlt_orders set status='PAID', created_at=now()-interval '12 days', paid_at=now()-interval '12 days' where id='{oid2}'")   # v10.31 시각 순서(fn_hlt_order_time_guard)
    q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid2}','PICKED',now()-interval '11 days')")
    q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid2}','DELIVERED',now()-interval '10 days')")
    pg.goto(f'{SITE}/my/health/returns/new?o={no2}'); t = text(pg)
    opts = pg.evaluate("[...document.querySelectorAll('select option')].map(o=>o.value)")
    rec('UI-9 기간 밖: 판매자 사유만 · 기간 지남 안내', '지났습니다' in t and 'CHANGE_MIND' not in opts and 'DEFECT' in opts, opts)

    # ── 배송지 ──
    tag = uuid.uuid4().hex[:4]
    _, a1 = call('POST', '/me/health/addresses', BUY, {'label': f'UI회사{tag}', 'receiver': '검증', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 UI1'})
    _, a2 = call('POST', '/me/health/addresses', BUY, {'label': f'UI친구{tag}', 'receiver': '검증', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 UI2'})
    st, o3 = call('POST', '/health/orders', BUY, {'addressId': a2['id'], 'items': [{'productCode': PROD, 'qty': 1}]})
    pg.goto(SITE + '/my/health/addresses'); pg.wait_for_timeout(500)
    box = pg.locator('.hlt-box', has_text=f'UI회사{tag}')
    box.locator('button', has_text='기본으로').click(); pg.wait_for_timeout(1500)
    rec('UI-10 기본으로 버튼 → 기본 배송지 변경', q(f"select is_default from hlt_addresses where id='{a1['id']}'") == 't'
        and pg.locator('.hlt-box', has_text=f'UI회사{tag}').locator('.hlt-bdg', has_text='기본').count() == 1, '')
    pg.locator('.hlt-box', has_text=f'UI친구{tag}').locator('button', has_text='삭제').click(); pg.wait_for_timeout(1500)
    rec('UI-11 진행 중 주문 배송지 삭제 → 사유 표시', '진행 중인 주문' in pg.locator('.hlt-box', has_text=f'UI친구{tag}').inner_text(), '')
    pg.locator('.hlt-box', has_text=f'UI회사{tag}').locator('button', has_text='삭제').click(); pg.wait_for_timeout(1500)
    ndef = q("select count(*) from hlt_addresses a join accounts c on c.id=a.account_id where c.email='buyer@x.com' and a.is_default")
    rec('UI-12 기본 배송지 삭제 → 목록에서 빠지고 기본 1개', pg.locator('.hlt-box', has_text=f'UI회사{tag}').count() == 0 and ndef == '1', ndef)
    call('PATCH', f'/me/health/addresses/{ADDR}/default', BUY)
    c.close()

    # ── 운영: 승인 → 재고 한 번 ──
    c = b.new_context(); pg = c.new_page(); pg.on('dialog', lambda d: d.accept())
    pg.goto(BO); pg.wait_for_timeout(800)
    __import__('consent_ok').agree('admin@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
    _bo_tab(pg, '소개몰 정산'); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
    row = pg.locator('tr', has_text=no)
    rec('UI-13 BO 취소·반품 처리 목록에 접수 건', row.count() == 1, row.count())
    mid = stock()
    row.locator('button', has_text='승인').click(); pg.wait_for_timeout(2000)
    rec('UI-14 BO 승인 → 주문 취소 · 재고 복구(한 번)', q(f"select status from hlt_orders where order_no='{no}'") == 'CANCELED' and stock() == mid + 2
        and q(f"select restocked_at is not null from hlt_orders where order_no='{no}'") == 't', (mid, stock()))
    pg.locator('button', has_text='승인').first.is_visible()
    pg.locator('.acts button', has_text='전체').click(); pg.wait_for_timeout(1200)
    rec('UI-15 BO 전체 보기에 처리 결과(승인 · 재고 복구)', '재고 복구' in pg.locator('tr', has_text=no).inner_text(), '')
    c.close()
    b.close()

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_hlt_ui.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
