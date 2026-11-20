"""v10.469 (D264 · docs/607) 소개몰 할인 쿠폰 · 기획전 — 정액 · 정률 · 최소 주문 · 한도 · 기간 · 기획전 상품 · 직판 주문만 · 취소 · 반품 되돌림 · 매출할인 전표(초안)
  ① (코드) D264 쿠폰 · 기획전 · 쓴 기록 · 주문 할인 칸 · total CHECK · 되돌림 트리거 · 계정 SALES_DISC · mall.coupon · 주문서 couponCode · 전표 MALL_DISCOUNT · 화면 SAL-040 · 문서 607
  ② (API · DB) 회원 403 · 만들기 · 409 · 400 · 422 · 미리 셈 · 꺼짐 422 · 주문 할인 · 쓴 기록 · 한 사람 한도 · DB 막음(할인 고치기 · 음수) · 쓴 뒤 409 · 멈춤 · 취소 되돌림 · 권한 주소 8
  ③ (화면) 소개몰 › 쿠폰 · 기획전
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)



def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


M64 = migr('D264_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')

HC, HCC, CK, DT, JN, SR, UI, MN, AP = (rd('src/modules/health/health-coupon.ts'), rd('src/modules/health/health-coupon.controller.ts'), rd('src/modules/health/health-checkout.service.ts'),
                                       rd('src/modules/health/health-shop.dto.ts'), rd('src/modules/acct/journal.ts'), rd('src/modules/acct/sources.ts'), rd('web/src/app/admin/HealthCoupons.tsx'),
                                       rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'))
ok('① 코드 — D264 기획전 · 상품 · 쿠폰(정액 · 정률 · 한도 · 기간 · 코드 CHECK) · 쓴 기록(주문 하나에 하나 · 되돌림) · 주문 할인 칸 · total = 상품 + 배송비 − 할인 ≥ 0 CHECK · 할인 고치기 막음 · 취소 · 반품 되돌림 트리거 · 매출할인 계정 SALES_DISC(초안) · mall.coupon off · 주문서 couponCode · 직판만 · 전표 MALL_DISCOUNT · 되돌림 · 면세 몫 할인 비율 · 메뉴 hlt-coupons · 화면 SAL-040 · 문서 607 · 판 v10.469',
   'CREATE TABLE IF NOT EXISTS public.hlt_coupons' in M64 and "code              text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{4,20}$')" in M64 and 'order_id        uuid NOT NULL UNIQUE REFERENCES public.hlt_orders(id)' in M64
   and 'total = goods_amount + ship_fee - discount_amount AND total >= 0' in M64 and 'trg_hlt_order_discount_guard' in M64 and 'trg_hlt_coupon_restore' in M64 and 'trg_hlt_coupon_use_guard' in M64
   and "('SALES_DISC', '매출할인(소개몰 쿠폰)', 'REVENUE'" in M64 and "('mall.coupon', 'off'" in M64 and "COUPON_CODE = /^[A-Z0-9-]{4,20}$/" in HC
   and 'couponCode?: string;' in DT and 'await quoteCoupon(this.db, String(d.couponCode)' in CK and 'goods + ship - discount' in CK and 'await useCoupon(this.db, coupon, o.id, me)' in CK
   and "name: 'MALL_DISCOUNT'" in HC and "name: 'MALL_DISCOUNT_CANCEL'" in HC and 'ALL_SOURCES.push(...COUPON_SOURCES)' in SR and '(o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)' in JN
   and "@Post('coupons/quote')" in HCC and 'export function HealthCoupons' in UI and "['hlt-coupons', '쿠폰 · 기획전']" in MN and "{tab === 'hlt-coupons' && <HealthCoupons />}" in AP
   and '"SB-ADM-SAL-040"' in SJ and '세무사' in doc('607_') and VT >= (10, 469), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS = login('admin@x.com')
    BUY = 'buyer@x.com'; bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
    biv0 = psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{bid}'")
    TB = login(BUY)
    s0 = {k: getset(k) for k in ('mall.coupon', 'mall.order_open')}
    cids, made, prid = [], [], ''
    ca, cr_ = f'T1469-{stamp}', f'T1469R-{stamp}'
    try:
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{bid}'"); setting('mall.order_open', 'on', '1469'); setting('mall.coupon', 'off', '1469')
        dp = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                  "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 ORDER BY p.code LIMIT 1")
        price = int(psql(f"SELECT o.price FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE p.code = '{dp}' AND o.is_active LIMIT 1") or 0)
        pr = call('POST', '/admin/health/promotions', {'title': f'시험 1469 기획전-{stamp}', 'startsOn': today, 'endsOn': today, 'productCodes': [dp]}, TS); prid = str(pr.get('id') or '')
        mb = call('GET', '/admin/health/coupons', None, TB)
        t0 = (datetime.datetime.utcnow() - datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'); t1 = (datetime.datetime.utcnow() + datetime.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ')
        a = call('POST', '/admin/health/coupons', {'code': ca, 'name': '시험 1469 정액', 'kind': 'FIXED', 'amount': 1000, 'perMemberLimit': 1, 'totalLimit': 5, 'startsAt': t0, 'endsAt': t1, 'promotionId': prid}, TS)
        if a.get('id'): cids.append(str(a['id']))
        dup = call('POST', '/admin/health/coupons', {'code': ca, 'name': '시험 1469 겹침', 'kind': 'FIXED', 'amount': 1000, 'startsAt': t0, 'endsAt': t1}, TS)
        low = call('POST', '/admin/health/coupons', {'code': ca.lower(), 'name': '시험 1469 소문자', 'kind': 'FIXED', 'amount': 1000, 'startsAt': t0, 'endsAt': t1}, TS)
        norate = call('POST', '/admin/health/coupons', {'code': f'T1469N-{stamp}', 'name': '시험 1469 비율 없음', 'kind': 'RATE', 'startsAt': t0, 'endsAt': t1}, TS)
        b = call('POST', '/admin/health/coupons', {'code': cr_, 'name': '시험 1469 정률', 'kind': 'RATE', 'rate': 10, 'maxDiscount': 500, 'startsAt': t0, 'endsAt': t1}, TS)
        if b.get('id'): cids.append(str(b['id']))
        qa_ = call('POST', '/admin/health/coupons/quote', {'code': ca, 'items': [{'productCode': dp, 'qty': 1}]}, TS)
        qb = call('POST', '/admin/health/coupons/quote', {'code': cr_, 'items': [{'productCode': dp, 'qty': 2}]}, TS)
        addr = call('GET', '/me/health/addresses', t=TB)
        adr = (addr[0] if isinstance(addr, list) and addr else {}).get('id') or call('POST', '/me/health/addresses', {'receiver': '구매자', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, TB).get('id')
        o0 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'couponCode': ca}, TB)
        setting('mall.coupon', 'on', '1469')
        o1 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'couponCode': ca.lower()}, TB)
        no1 = o1.get('orderNo') or ''
        if no1: made.append(no1)
        od = psql(f"SELECT goods_amount || '|' || ship_fee || '|' || discount_amount || '|' || total FROM hlt_orders WHERE order_no = '{no1}'")
        use1 = psql(f"SELECT count(*) || '|' || coalesce(max(state), '') || '|' || coalesce(max(discount), 0) FROM hlt_coupon_uses WHERE coupon_id = {int(cids[0]) if cids else 0}")
        o2 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'couponCode': ca}, TB)
        if o2.get('orderNo'): made.append(o2['orderNo'])
        dbd = psql(f"UPDATE hlt_orders SET discount_amount = 0 WHERE order_no = '{no1}'")
        neg = psql(f"INSERT INTO hlt_orders (order_no, account_id, goods_amount, ship_fee, total, discount_amount) VALUES ('T1469X-{stamp}', '{bid}', 100, 0, -100, 200)")
        e1 = call('PUT', f'/admin/health/coupons/{cids[0] if cids else 0}', {'amount': 2000}, TS)
        e2 = call('PUT', f'/admin/health/coupons/{cids[0] if cids else 0}', {'state': 'PAUSED'}, TS)
        keep = psql(f"SELECT amount || '|' || per_member_limit || '|' || coalesce(promotion_id::text, '') FROM hlt_coupons WHERE id = {int(cids[0]) if cids else 0}")
        cx = psql(f"UPDATE hlt_orders SET status = 'CANCELED' WHERE order_no = '{no1}'")
        use2 = psql(f"SELECT state || '|' || coalesce(restore_reason, '') FROM hlt_coupon_uses WHERE coupon_id = {int(cids[0]) if cids else 0}")
        e3 = call('PUT', f'/admin/health/coupons/{cids[0] if cids else 0}', {'state': 'ACTIVE'}, TS)
        qa2 = call('POST', '/admin/health/coupons/quote', {'code': ca, 'items': [{'productCode': dp, 'qty': 1}], 'accountId': bid}, TS)
        us = call('GET', f'/admin/health/coupons/{cids[0] if cids else 0}/uses', None, TS)
        lst = call('GET', '/admin/health/coupons', None, TS)
        row = next((x for x in lst.get('coupons') or [] if x.get('code') == ca), {})
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'hlt-coupons'")
        ok('② 쿠폰 — 기획전(상품 1) · 회원 403 · 정액 만들기 · 같은 코드 409 · 소문자 400 · 정률 비율 없음 422 · 미리 셈(정액 1,000 · 정률 10% 최대 500) · 쿠폰 받기 꺼짐 422 · 주문(소문자 코드도) = 상품 − 1,000 · 쓴 기록 1 · 한 사람 한도 422 · DB 가 할인 고치기 · 음수 결제 막음 · 쓴 뒤 금액 409 · 멈춤(다른 칸 그대로) · 주문 취소 → 되돌림(주문 취소) · 되돌린 뒤 다시 쓸 수 있음 · 쓴 기록 · 목록 · 권한 주소 8',
           bool(dp) and price > 1000 and pr.get('products') == 1 and mb.get('_err') == 403 and a.get('ok') is True and dup.get('code') == 'COUPON_DUP' and low.get('_err') == 400 and norate.get('code') == 'COUPON_RATE'
           and qa_.get('discount') == 1000 and qb.get('discount') == min(price * 2 // 10, 500) and o0.get('code') == 'COUPON_OFF'
           and bool(no1) and od == f'{price}|0|1000|{price - 1000}' and o1.get('discount') == 1000 and use1 == '1|USED|1000' and o2.get('code') == 'COUPON_MEMBER_LIMIT'
           and 'HLT_COUPON' in dbd and 'hlt_orders_total_check' in neg and e1.get('code') == 'COUPON_USED' and e2.get('state') == 'PAUSED' and keep == f'1000|1|{prid}'
           and '!' not in cx and use2 == 'RESTORED|주문 취소' and e3.get('state') == 'ACTIVE' and qa2.get('discount') == 1000
           and len(us.get('items') or []) == 1 and (us.get('items') or [{}])[0].get('state') == 'RESTORED' and row.get('used') == 0 and row.get('restored') == 1 and rmap == '8',
           f"{dp} {price} {pr.get('products')} {mb.get('_err')} {a.get('ok') or a} {dup.get('code')} {low.get('_err')} {norate.get('code')} · {qa_.get('discount') or qa_} {qb.get('discount')} {o0.get('code')} · {no1 or o1} {od} {use1} {o2.get('code')} · {dbd[-30:]} {neg[-40:]} {e1.get('code')} {e2.get('state')} {keep} · {cx[-30:]} {use2} {e3.get('state')} {qa2.get('discount')} {len(us.get('items') or [])} {row.get('used')}/{row.get('restored')} {rmap}")
    finally:
        for n_ in [x for x in made if x]:
            psql(f"UPDATE hlt_orders SET status = 'CANCELED' WHERE order_no = '{n_}' AND status NOT IN ('CANCELED', 'RETURNED')")
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_coupon_uses WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
                 f"DELETE FROM hlt_order_items WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); DELETE FROM hlt_orders WHERE order_no = '{n_}';")
        ids = ','.join(x for x in cids if x.isdigit())
        if ids:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_coupon_uses WHERE coupon_id IN ({ids}); DELETE FROM hlt_coupons WHERE id IN ({ids});")
        psql(f"SET session_replication_role = replica; DELETE FROM hlt_coupons WHERE code LIKE 'T1469%-{stamp}';")
        if prid.isdigit():
            psql(f"DELETE FROM hlt_promotion_products WHERE promotion_id = {prid}; DELETE FROM hlt_promotions WHERE id = {prid};")
        for k, x in s0.items():
            setting(k, x or None, '1469 되돌림')
        psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not biv0 else repr(biv0) + '::timestamptz')} WHERE id = '{bid}'")
    if ADMIN_WEB:
        r = admin_page('/#/hlt-coupons', lambda pg, seen: seen.update(n=pg.locator('[data-hlt-coupons]').count(), new=pg.locator('[data-hlt-coupon-new]').count(), pn=pg.locator('[data-hlt-promo-new]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 쿠폰 · 기획전(쿠폰 만들기 · 기획전 만들기 칸 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('new') == 1 and seen.get('pn') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
