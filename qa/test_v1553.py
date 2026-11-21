"""v10.553 (docs/691) 소개몰 묶음(세트) 할인 — 대표 11/21 「(57) ① 묶음(세트) 할인」
  ① (코드) D287 묶음 · 구성 · 주문 묶음 줄 · 지킴 · 재고 보기 · smx.bundle off · 주문 흐름 패치(옛 시험 글자 그대로) · DTO · API · 운영 화면 · 메뉴 · 화면 · 문서
  ② (API · DB) 운영 목록 · 회원 403 · 초안 · 같은 코드 409 · 판매 시작 조건 422 · 판매 중 구성 409 · 꺼짐 422 · 묶음 + 쿠폰 함께(대상 = 묶음가) · 묶음 주문(합계 · 구성 · 재고) · 묶음 줄 못 고침 · 취소 재고 되돌림 · 품절 · 권한 주소(끝에 주문 · 묶음 replica 로 지움 · 재고 · 설정 되돌림)
  ③ (화면) 소개몰 › 묶음 할인
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
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로 · 빈 값은 NULL — value_pattern 트리거)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def direct_options(n=2):
    """직판 · 판매 중 · 켠 옵션(재고 5 넘음 · 값 1원 이상) — 서로 다른 상품에서 n개 · [(상품 코드, 옵션 번호, 재고, 값)]"""
    rows = psql("SELECT DISTINCT ON (p.id) p.code || '|' || o.id || '|' || o.stock || '|' || o.price FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' "
                "JOIN hlt_product_options o ON o.product_id = p.id AND o.is_active AND o.stock > 5 AND o.price > 0 WHERE p.status = 'ON_SALE' ORDER BY p.id, o.sort LIMIT 20")
    out = []
    for line in (rows.splitlines() if rows and not rows.startswith('!') else []):
        c, oid, st, pr = (line.split('|') + ['', '', '', ''])[:4]
        if c and oid:
            out.append((c, oid, int(st), int(pr)))
    return out[:n]


def single_option_product():
    """직판 · 판매 중 · 켠 옵션이 하나뿐인 상품(재고 5 넘음) — 옵션 없이 주문할 수 있는 것 · (코드, 옵션 번호, 재고)"""
    code = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 "
                "AND NOT EXISTS (SELECT 1 FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock <= 5) ORDER BY p.code LIMIT 1")
    opt = psql(f"SELECT o.id || '|' || o.stock FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE p.code = '{code}' AND o.is_active LIMIT 1") if code and not code.startswith('!') else ''
    oid, st = (opt.split('|') + ['', ''])[:2]
    return code, oid, (int(st) if st.isdigit() else None)


def new_member(tag, zipcode='06236'):
    """새 회원(본인인증 · 약관 동의) · 토큰 · 배송지 — 공유 회원(buyer)을 건드리지 않음"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    tok = login(em)
    adr = call('POST', '/me/health/addresses', {'receiver': '시험', 'phone': '010-1234-5678', 'zipcode': zipcode, 'addr1': '서울 강남구 테헤란로 1'}, tok).get('id')
    return em, aid, tok, adr


def drop_order(oid):
    """시험 주문 지우기(replica — 지킴 트리거를 건너뜀) · 묶음 줄 · 품목 · 결제 · 배송 · 리뷰 · 답글"""
    if oid:
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM hlt_review_reply_edits WHERE reply_id IN (SELECT rp.id FROM hlt_review_replies rp JOIN hlt_reviews rv ON rv.id = rp.review_id WHERE rv.order_id = '{oid}'); "
             f"DELETE FROM hlt_review_replies WHERE review_id IN (SELECT id FROM hlt_reviews WHERE order_id = '{oid}'); DELETE FROM hlt_reviews WHERE order_id = '{oid}'; "
             f"DELETE FROM hlt_payments WHERE order_id = '{oid}'; DELETE FROM hlt_shipments WHERE order_id = '{oid}'; DELETE FROM hlt_order_items WHERE order_id = '{oid}'; "
             f"DELETE FROM hlt_order_bundles WHERE order_id = '{oid}'; DELETE FROM hlt_orders WHERE id = '{oid}';")


M87 = migr('D287_')
stamp = int(time.time()) % 1000000
BD, CK, DT, CT, UI, MN, AP = (rd('src/modules/smx/bundles.ts'), rd('src/modules/health/health-checkout.service.ts'), rd('src/modules/health/health-shop.dto.ts'),
                              rd('src/modules/smx/smx.controller.ts'), rd('web/src/app/admin/Smx.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'))

ok('① 코드 — D287 묶음 표 · 구성 · 주문 묶음 줄 · 품목 bundle_line_id · 지킴(구성 · 판매 시작 · 넣기 · 늦춘 합 확인) · 재고 보기 · smx.bundle off · 주문 흐름(셈 · 넣기 · 쿠폰 대상 = 묶음가 기준 · 한 판매자) · 옛 시험 글자 그대로 · DTO bundles · 운영 API · 공개 API · 화면 · 메뉴 smx-bundles · 화면 SMX-010 · 문서 691 · 판 v10.553',
   'CREATE TABLE IF NOT EXISTS public.hlt_bundles' in M87 and 'CREATE TABLE IF NOT EXISTS public.hlt_bundle_items' in M87 and 'CREATE TABLE IF NOT EXISTS public.hlt_order_bundles' in M87
   and 'ADD COLUMN IF NOT EXISTS bundle_line_id' in M87 and 'trg_smx_bundle_item_guard' in M87 and 'trg_smx_bundle_guard' in M87 and 'trg_smx_order_bundle_guard' in M87
   and 'CREATE CONSTRAINT TRIGGER trg_smx_order_bundle_sum' in M87 and 'DEFERRABLE INITIALLY DEFERRED' in M87 and 'CREATE OR REPLACE VIEW public.v_hlt_bundle_stock' in M87
   and "('smx.bundle', 'off'" in M87 and "('smx-bundles', '묶음 할인', 'admhlt'" in M87
   and 'export async function smxBundleQuote' in BD and 'export async function smxBundleInsert' in BD and "'SMX_BUNDLE_COUPON'" not in BD and 'couponLines' in BD and '...bx.couponLines]' in CK and "'SMX_BUNDLE_SOLD_OUT'" in BD
   and 'const bx = await smxBundleQuote(this.db, d);' in CK and 'await smxBundleInsert(this.db, o.id, bx)' in CK and '...bx.productIds' in CK
   and 'sellerShipFee(sellers[0], goods)' in CK and 'goods + ship - discount' in CK and 'await useCoupon(this.db, coupon, o.id, me)' in CK
   and 'bundles?: SmxOrderBundleInDto[];' in DT and '@ArrayMinSize(1)' in DT and len(re.findall(r'^export class \w+Dto\b', DT, re.M)) == 14
   and "@Controller('api/v1/admin/smx')" in CT and "@Controller('api/v1/health/bundles')" in CT and 'export function SmxBundles' in UI
   and "['smx-bundles', '묶음 할인']" in MN and "{tab === 'smx-bundles' && <SmxBundles />}" in AP and '"SB-ADM-SMX-010"' in SJ
   and '반품' in doc('691_') and VT >= (10, 553), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.order_open', 'smx.bundle', 'mall.coupon', 'mall.points', 'mall.giftcard')
    s0 = {k: getset(k) for k in keys}
    opts = direct_options(2)
    bid, oid, oid2, cid = '', '', '', ''
    try:
        em, aid, TM, adr = new_member('1553')
        setting('mall.order_open', 'on', '1553'); setting('smx.bundle', 'off', '1553')
        (c1, o1, st1, p1), (c2, o2, st2, p2) = opts if len(opts) == 2 else [('', '', 0, 0), ('', '', 0, 0)]
        lst = p1 * 1 + p2 * 2
        price = max(1, lst * 9 // 10)
        code = f'T1553-{stamp}'
        v0 = call('GET', '/admin/smx/bundles', None, TS)
        m403 = call('GET', '/admin/smx/bundles', None, TM)
        mk = call('POST', '/admin/smx/bundles', {'code': code, 'name': '시험 1553 묶음', 'price': price, 'items': [{'optionId': o1, 'qty': 2}, {'optionId': o2, 'qty': 2}]}, TS)   # 수량 1 줄 없음 — 초안은 됨 · 판매 시작은 422
        dup = call('POST', '/admin/smx/bundles', {'code': code, 'name': '시험 1553 묶음', 'price': price, 'items': [{'optionId': o1, 'qty': 1}, {'optionId': o2, 'qty': 1}]}, TS)
        bid = mk.get('id') or ''
        start_bad = call('POST', f'/admin/smx/bundles/{bid}/state', {'state': 'ON_SALE'}, TS) if bid else {}
        fix = call('PUT', f'/admin/smx/bundles/{bid}', {'code': code, 'name': '시험 1553 묶음', 'price': price, 'items': [{'optionId': o1, 'qty': 1}, {'optionId': o2, 'qty': 2}]}, TS) if bid else {}
        start = call('POST', f'/admin/smx/bundles/{bid}/state', {'state': 'ON_SALE'}, TS) if bid else {}
        again = call('POST', f'/admin/smx/bundles/{bid}/state', {'state': 'ON_SALE'}, TS) if bid else {}
        locked = call('PUT', f'/admin/smx/bundles/{bid}', {'code': code, 'name': '시험 1553 묶음', 'price': price, 'items': [{'optionId': o1, 'qty': 1}]}, TS) if bid else {}
        pub_off = call('GET', '/health/bundles', None)
        ord_off = call('POST', '/health/orders', {'addressId': adr, 'bundles': [{'code': code, 'qty': 1}]}, TM)
        setting('smx.bundle', 'on', '1553')
        pub = call('GET', '/health/bundles', None)
        mine = next((x for x in (pub.get('items') or []) if x.get('code') == code), {})
        setting('mall.coupon', 'on', '1553')
        camt = max(1, min(1000, price // 2))
        ccode = f'T1553C{stamp}'
        cid = psql(f"INSERT INTO hlt_coupons (code, name, kind, amount, starts_at, ends_at) VALUES ('{ccode}', '시험 1553 쿠폰', 'FIXED', {camt}, now() - interval '1 hour', now() + interval '1 day') RETURNING id")
        cid = cid if cid and not cid.startswith('!') else ''
        o = call('POST', '/health/orders', {'addressId': adr, 'bundles': [{'code': code, 'qty': 1}], 'couponCode': ccode}, TM)   # 대표 11/21 — 묶음 + 쿠폰 함께(대상 = 묶음가)
        no = o.get('orderNo') or ''
        oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{no}'") if no else ''
        disc = psql(f"SELECT discount_amount || '|' || goods_amount || '|' || (discount_amount <= goods_amount AND total = goods_amount + ship_fee - discount_amount - point_amount - gift_amount) FROM hlt_orders WHERE id = '{oid}'") if oid else ''
        parts = psql(f"SELECT count(*) || '|' || sum(amount) || '|a' || coalesce(sum(qty) FILTER (WHERE option_id = '{o1}'), 0) || ',b' || coalesce(sum(qty) FILTER (WHERE option_id = '{o2}'), 0) FROM hlt_order_items WHERE order_id = '{oid}' AND bundle_line_id IS NOT NULL") if oid else ''
        stk = psql(f"SELECT (SELECT stock FROM hlt_product_options WHERE id = '{o1}') || '|' || (SELECT stock FROM hlt_product_options WHERE id = '{o2}')") if oid else ''
        upd = psql(f"UPDATE hlt_order_bundles SET qty = 2 WHERE order_id = '{oid}'") if oid else ''
        cnl = psql(f"UPDATE hlt_orders SET status = 'CANCELED' WHERE id = '{oid}'") if oid else '!'
        stk2 = psql(f"SELECT (SELECT stock FROM hlt_product_options WHERE id = '{o1}') || '|' || (SELECT stock FROM hlt_product_options WHERE id = '{o2}')") if oid else ''
        psql(f"SET session_replication_role = replica; UPDATE hlt_product_options SET stock = 1 WHERE id = '{o2}';")
        pub2 = call('GET', '/health/bundles', None)
        so = next((x for x in (pub2.get('items') or []) if x.get('code') == code), {})
        sold = call('POST', '/health/orders', {'addressId': adr, 'bundles': [{'code': code, 'qty': 1}]}, TM)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'smx-bundles'")
        ok('② 묶음 — 운영 목록 · 회원 403 · 초안 만들기 · 같은 코드 409 · 수량 1 줄 없으면 판매 시작 422 · 고친 뒤 판매 시작 · 다시 409 · 판매 중 구성 고치기 409 · 꺼짐이면 공개 on:false · 주문 422 · 켜면 공개 목록 · 묶음 + 쿠폰 함께(할인 = 쿠폰 금액 · 대상은 묶음가 · 금액 규칙 맞음) · 묶음 주문(합계 = 묶음가 − 쿠폰 · 구성 2줄 · 구성 수량 · 재고 빠짐) · 묶음 줄 고치기 막음 · 취소하면 재고 되돌림 · 구성 품절이면 묶음 품절 · 주문 422 · 권한 주소 4',
           len(opts) == 2 and v0.get('on') is False and m403.get('_err') == 403 and bool(bid) and dup.get('code') == 'SMX_BUNDLE_DUP'
           and start_bad.get('_err') == 422 and fix.get('id') == bid and start.get('state') == 'ON_SALE' and again.get('_err') == 409 and locked.get('code') == 'SMX_BUNDLE_ON_SALE'
           and pub_off.get('on') is False and ord_off.get('code') == 'SMX_BUNDLE_OFF' and mine.get('price') == price and mine.get('soldOut') is False
           and bool(cid) and bool(no) and int(o.get('total') or -1) == price - camt and disc == f'{camt}|{price}|true' and (o.get('bundles') or [{}])[0].get('code') == code
           and parts == f'2|{price}|a1,b2' and stk == f'{st1 - 1}|{st2 - 2}' and '!' in upd and '!' not in cnl and stk2 == f'{st1}|{st2}'
           and so.get('soldOut') is True and sold.get('code') == 'SMX_BUNDLE_SOLD_OUT' and rmap == '4',
           f"{opts} {v0.get('on')} {m403.get('_err')} {bid} {dup.get('code')} · {start_bad.get('code')} {fix.get('note')} {start.get('state')} {again.get('_err')} {locked.get('code')} · {pub_off.get('on')} {ord_off.get('code')} {mine} · "
           f"{cid} {no or o} {o.get('total')} {disc} · {parts} {stk} {upd[-40:]} {cnl[-40:]} {stk2} · {so.get('soldOut')} {sold.get('code')} {rmap}")
    finally:
        if oid:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_coupon_uses WHERE order_id = '{oid}';")
        drop_order(oid)
        if cid:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_coupon_uses WHERE coupon_id = {int(cid)}; DELETE FROM hlt_coupons WHERE id = {int(cid)};")
        if bid:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_order_bundles WHERE bundle_id = '{bid}'; DELETE FROM hlt_bundle_items WHERE bundle_id = '{bid}'; DELETE FROM hlt_bundles WHERE id = '{bid}';")
        for (c_, o_, st_, p_) in opts:
            psql(f"SET session_replication_role = replica; UPDATE hlt_product_options SET stock = {int(st_)} WHERE id = '{o_}';")
        for k, x in s0.items():
            setting(k, x or None, '1553 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/smx-bundles', lambda pg, seen: seen.update(n=pg.locator('[data-smx-bundles]').count(), b=pg.locator('[data-smx-bundle-new]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 묶음 할인(목록 · 새 묶음 단추 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('b') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
