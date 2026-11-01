"""v10.167 시험 — 소개몰 입점 3단계: 판매자별 주문 · 판매자 발송 · 반품(꺼진 채로 · 마이그레이션 없음 · docs/258)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1167.py

  ① 코드 — 정책(판매자 반품비 · 배송비 · 직판 그대로) · 주문(MIXED_SELLERS) · 장바구니(sellers) · 상품 · 판매자 주문 · 반품 API · 화면 · 사전 · 명세 · 영어 · docs/258 · 판
  ② (API · DB) 장바구니 판매자 묶음 · 입점 배송비 · 섞인 주문 422 · 입점 주문 배송비 · 상품 반품비 · 판매자 주문 목록(받는 분) · 판매자 아님 403 · 발송 · 배송 완료 ·
     교환 배송비 = 판매자 반품비 · 주문 상세 반품비 · 판매자 반려 · 되돌림(주문 · 배송 기록은 지울 수 없어 판매자 · 상품만 막아 둠)
  ③ (화면) 판매자센터 「주문 · 발송」 · 「취소 · 반품」 · 오류 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
PO = rd('src/modules/health/health-policy.ts'); CO = rd('src/modules/health/health-checkout.service.ts'); RT = rd('src/modules/health/health-return.service.ts')
CA = rd('src/modules/health/health-catalog.service.ts'); SS = rd('src/modules/health/health-seller.service.ts'); SC = rd('src/modules/health/health-seller.controller.ts')
ok('① 서버 — 반품비 인자(기본 6,000 · 상한) · 판매자 배송비 · 섞인 주문 422 · 장바구니 sellers · 주문 상세 · 반품 · 상품 · 판매자 주문 · 발송 · 반품 처리(내 주문만) · 감사 4',
   'roundTrip: number = HLT_EXCHANGE_SHIP_ROUND_TRIP' in PO and 'roundTrip: number = HLT_RETURN_SHIP_ROUND_TRIP' in PO and 'export function sellerShipFee(' in PO and 'export const ORDER_ROUND_TRIP_SQL' in PO
   and "'MIXED_SELLERS'" in CO and 'sellers,' in CO and 'sellerShipFee(sellers[0], goods)' in CO and 'returnShipDeduction(\'RETURN\', \'CHANGE_MIND\', paidAmount, roundTrip)' in CO
   and 'await this.roundTrip(o.id)' in RT and 'await this.roundTrip(r.order_id)' in RT and 'AS "returnShipFee"' in CA
   and 'WHERE order_no = $1 AND seller_id = $2' in SS and 'o.seller_id = $2' in SS and "@Post('me/health/seller/orders/:no/ship')" in SC
   and "@Post('me/health/seller/returns/:id/decide')" in SC and sum(SC.count(f"@Audit('{a}'") for a in ('HLT_SELLER_ORDER_SHIP', 'HLT_SELLER_ORDER_TRACKING', 'HLT_SELLER_ORDER_ADVANCE', 'HLT_SELLER_RETURN_DECIDE')) == 4, '')
CV = rd('site/src/components/health/CartView.tsx'); OP = rd('site/src/app/health/order/page.tsx'); PP = rd('site/src/app/health/p/[code]/page.tsx')
SO = rd('site/src/components/health/SellerOrders.tsx'); CP = rd('site/src/app/health/seller/center/page.tsx')
flat = lambda d, p='': {k for kk, v in d.items() for k in (flat(v, p + kk + '.') if isinstance(v, dict) else {p + kk})}
ko = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}')
oko = json.loads(rd('site/src/i18n/messages/ko/order.json') or '{}'); oen = json.loads(rd('site/src/i18n/messages/en/order.json') or '{}')
SPEC = json.load(open(os.path.join(K, 'spec/screens.json'), encoding='utf-8')).get('screens') or []
apis = next((x.get('apis', []) for x in SPEC if x.get('id') == 'SB-HLT-SEL-020'), [])
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 화면 · 명세 · 영어 — 장바구니 판매자 묶음 · 주문서 ?seller= · 상품 배송비 · 반품비 · 판매자 주문 · 반품 · 사전 ko · en · 명세 6 · 영어 · docs/258 · 판',
   'data-cart-sellers' in CV and '/health/order?seller=' in CV and 'sp.seller' in OP and 'data-return-fee' in PP and 'data-ship-fee' in PP
   and 'data-seller-ship' in SO and 'data-seller-return' in SO and '<SellerOrdersView' in CP
   and flat(ko.get('sorders', {})) == flat(en.get('sorders', {})) and ko.get('sorders') and 'shipFeeSeller' in ko.get('product', {}) and 'shipFeeSeller' in en.get('product', {})
   and 'orderSeller' in oko.get('cart', {}) and 'orderSeller' in oen.get('cart', {}) and 'oneSeller' in oen.get('orderPage', {})
   and all(a in apis for a in ('GET /me/health/seller/orders', 'POST /me/health/seller/orders/{no}/ship', 'POST /me/health/seller/returns/{id}/decide'))
   and '"판매자가 다른 상품은 따로 주문해 주십시오 — 장바구니에서 판매자별로 주문할 수 있습니다.":' in EN
   and any(f.startswith('258_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 167), rd('VERSION').strip())


# ── ② API ─────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


MEM = 'seller@x.com'; BUY = 'buyer@x.com'; SC1 = 'TN-T1167'
setting = lambda: psql("SELECT value FROM site_settings WHERE key = 'mall.tenant'")
if API and DB:
    s0 = setting(); mid = psql(f"SELECT id FROM accounts WHERE email = '{MEM}'"); bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
    biv0 = psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{bid}'")
    cat = psql("SELECT code FROM categories WHERE gwan_code = 'HLT' AND code = 'HLT_FOOD'") or 'HLT_FOOD'
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TM = call('POST', '/auth/login', {'email': MEM, 'password': PW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
    sid = None; code = f'{SC1}-JELLY'
    try:
        psql(f"DELETE FROM hlt_seller_licenses WHERE seller_id IN (SELECT id FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND'))")
        psql(f"DELETE FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND') AND NOT EXISTS (SELECT 1 FROM hlt_orders o WHERE o.seller_id = hlt_sellers.id)")
        psql(f"UPDATE hlt_sellers SET account_id = NULL WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.tenant'")
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{bid}'")
        sid = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, status, applied_at, reviewed_at, submerchant_id, ship_fee, free_ship_over, return_ship_fee) "
                   f"VALUES ('{SC1}-' || to_char(now(), 'HH24MISS'), '{mid}', 'TENANT', '시험 판매자 3', true, 'ACTIVE', now(), now(), 'SUB-T1167', 3000, 50000, 4000) RETURNING id").splitlines()[0]
        scode = psql(f"SELECT code FROM hlt_sellers WHERE id = '{sid}'"); code = f'{scode}-JELLY'
        call('POST', '/me/health/seller/products', {'code': 'JELLY', 'name': '시험 젤리 3', 'categoryCode': cat, 'notice': {'제조사': '시험식품'}, 'options': [{'price': 10000, 'stock': 20}]}, TM)
        call('POST', f'/me/health/seller/products/{code}/submit', t=TM)
        call('POST', f'/admin/health/product-reviews/{code}', {'decision': 'APPROVE'}, T_)
        st = call('POST', f'/me/health/seller/products/{code}/status', {'status': 'ON_SALE'}, TM)
        dp = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                  "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 ORDER BY p.code LIMIT 1")
        pd = call('GET', f'/health/products/{code}')
        ok('② 입점 상품 판매 중 · 상품 화면 반품비 4,000 · 배송비 3,000 · 무료 기준 50,000 · 교환 배송비 4,000', st.get('status') == 'ON_SALE'
           and pd.get('returnShipFee') == 4000 and pd.get('sellerShipFee') == 3000 and pd.get('freeShipOver') == 50000 and pd.get('exchangeFee') == 4000,
           f"{st.get('status')} · {pd.get('returnShipFee')} · {pd.get('sellerShipFee')} · {pd.get('exchangeFee')}")
        psql(f"DELETE FROM hlt_cart_items WHERE account_id = '{bid}'")
        call('POST', '/me/health/cart', {'productCode': code, 'qty': 2}, TB)
        if dp: call('POST', '/me/health/cart', {'productCode': dp, 'qty': 1}, TB)
        cart = call('GET', '/me/health/cart', t=TB); sel = {g.get('sellerCode'): g for g in cart.get('sellers') or []}
        g1 = sel.get(scode, {})
        ok('② 장바구니 — 판매자 묶음 2(직판 · 입점) · 입점 묶음 상품 20,000 · 배송비 3,000 · 합계 배송비 3,000 · 줄마다 sellerCode',
           (not dp or len(sel) == 2) and g1.get('goods') == 20000 and g1.get('shipFee') == 3000 and g1.get('returnShipFee') == 4000 and cart.get('shipFee') == 3000
           and all(i.get('sellerCode') for i in cart.get('items') or []), f"{list(sel)} · {g1} · {cart.get('shipFee')}")
        addr = (call('GET', '/me/health/addresses', t=TB) or [{}])
        aid = (addr[0] if isinstance(addr, list) and addr else {}).get('id') or call('POST', '/me/health/addresses', {'receiver': '구매자', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, TB).get('id')
        mx = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': code, 'qty': 1}] + ([{'productCode': dp, 'qty': 1}] if dp else [])}, TB)
        o1 = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': code, 'qty': 2}]}, TB)
        ono = o1.get('orderNo')
        ok('② 섞인 주문 422 MIXED_SELLERS · 입점 주문 배송비 3,000 · 합계 23,000 · 주문 판매자 = 입점 판매자',
           (not dp or mx.get('code') == 'MIXED_SELLERS') and o1.get('shipFee') == 3000 and int(o1.get('total') or 0) == 23000
           and psql(f"SELECT seller_id FROM hlt_orders WHERE order_no = '{ono}'") == sid, f"{mx.get('code')} · {o1.get('shipFee')} · {o1.get('total')}")
        psql(f"UPDATE hlt_orders SET status = 'PAID', paid_at = now() WHERE order_no = '{ono}'")
        so = call('GET', '/me/health/seller/orders', t=TM); row = next((x for x in so.get('items') or [] if x.get('orderNo') == ono), {})
        na = call('GET', '/me/health/seller/orders', t=T_)
        ok('② 판매자 주문 목록 — 이 주문 · 받는 분 · 주소 · 택배사 목록 · 판매자 아님 403', row.get('status') == 'PAID' and row.get('receiver') and row.get('address')
           and len(so.get('carriers') or []) >= 3 and na.get('_err') == 403, f"{row.get('status')} · {row.get('receiver')} · {na.get('_err')}")
        sh = call('POST', f'/me/health/seller/orders/{ono}/ship', {'carrier': (so.get('carriers') or ['CJ대한통운'])[0], 'trackingNo': '123456789012'}, TM)
        dv = call('POST', f'/me/health/seller/orders/{ono}/advance', {'state': 'DELIVERED'}, TM)
        o404 = call('POST', f'/me/health/seller/orders/{ono}/ship', {'carrier': 'CJ대한통운', 'trackingNo': '123456789012'}, TB)
        ok('② 판매자 발송 → 배송 중 · 배송 완료 · 판매자 아닌 회원 403', psql(f"SELECT status FROM hlt_orders WHERE order_no = '{ono}'") == 'DELIVERED'
           and sh.get('_err') is None and dv.get('_err') is None and o404.get('_err') in (403, 404), f"{sh.get('_err')} · {dv.get('_err')} · {o404.get('_err')}")
        md = call('GET', f'/me/health/orders/{ono}', t=TB)
        ex = call('POST', '/me/health/returns', {'orderNo': ono, 'kind': 'EXCHANGE', 'reason': 'CHANGE_MIND', 'opened': False}, TB)
        rid = ex.get('id')
        ok('② 주문 상세 반품비 4,000 · 회원 사정 교환 배송비 = 판매자 반품비 4,000', (md.get('returnShip') or {}).get('roundTripFee') == 4000
           and int(ex.get('exchangeFee') or 0) == 4000, f"{(md.get('returnShip') or {}).get('roundTripFee')} · {ex.get('exchangeFee')} · {ex.get('code')}")
        sr = call('GET', '/me/health/seller/returns', t=TM); has = any(x.get('id') == rid for x in (sr if isinstance(sr, list) else []))
        rj = call('POST', f'/me/health/seller/returns/{rid}/decide', {'state': 'REJECTED', 'note': '교환할 옵션이 없어 반품으로 신청해 주십시오.'}, TM) if rid else {}
        ok('② 판매자 반품 목록 · 반려(사유) → REJECTED', has and psql(f"SELECT state FROM hlt_returns WHERE id = '{rid}'") == 'REJECTED', f"{has} · {rj.get('_err')} · {rj.get('code')}")
        if SITE:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                with sync_playwright() as p:
                    b_ = p.chromium.launch(); ctx = b_.new_context(viewport={'width': 1300, 'height': 1000}); pg = ctx.new_page(); errs = []
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', MEM); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(3000)
                    pg.goto(SITE + '/health/seller/center', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    box = pg.locator('[data-seller-orders]').count(); row_ = pg.locator(f'[data-seller-order="{ono}"]').count(); rr = pg.locator(f'[data-seller-return="{rid}"]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1167_site_orders.png'), full_page=True)
                    b_.close()
                ok('③ 사용자 웹 판매자센터 — 「주문 · 발송」 · 이 주문 · 반품 신청 줄 · 오류 없음', box == 1 and row_ == 1 and rr == 1 and not errs, f'{box} · {row_} · {rr} · {pg.url} · {errs[:2]}')
    finally:
        psql(f"DELETE FROM hlt_cart_items WHERE account_id = '{bid}'")
        if sid:
            psql(f"UPDATE hlt_products SET status = 'STOPPED' WHERE seller_id = '{sid}'")
            psql(f"UPDATE hlt_sellers SET status = 'BLOCKED', account_id = NULL WHERE id = '{sid}'")   # 주문 · 배송 기록은 지울 수 없어 판매자 · 상품만 막아 둠
        psql(f"UPDATE site_settings SET value = '{s0 or 'off'}' WHERE key = 'mall.tenant'")
        psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not biv0 else repr(biv0) + '::timestamptz')} WHERE id = '{bid}'")
    ok('끝 — 되돌림(설정 처음 값 · 시험 판매자 막음 · 회원 연결 끊음 · 본인확인 처음 값)', setting() == (s0 or 'off')
       and psql(f"SELECT count(*) FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')") == '0'
       and psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{bid}'") == biv0, setting())
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
