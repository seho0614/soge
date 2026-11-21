"""v10.554 (docs/692) 소개몰 도서산간 배송비 — 대표 11/21 「(57) ② 도서산간 배송비」
  ① (코드) D287 구역 표 · fn_smx_remote_fee · 주문 칸 remote_ship_fee · remote_zone · 잠금 · 처음 구역 · smx.remote_ship off · 주문 흐름 · 내 주문 · 주문서 줄 · 사전 · 메뉴 · 화면 · 문서
  ② (API · DB) 구역 더하기 · 409 · 422 · 확인 · 꺼짐 0 · 켜면 직판 주문 배송비에 더함(따로 · 금액 규칙) · 면세 몫(비율 · 과세 0) · 정산 보기 칸(기본 배송비 · 도서산간) · 주문 뒤 못 바꿈 · 내 주문 · 구역 고쳐도 주문 그대로 · 권한 주소(끝에 주문 · 구역 지움 · 재고 · 설정 되돌림)
  ③ (화면) 소개몰 › 도서산간 배송비
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
RM, CK, CT, UI, MN, AP, OF, MO, OK_, OE = (rd('src/modules/smx/remote.ts'), rd('src/modules/health/health-checkout.service.ts'), rd('src/modules/smx/smx.controller.ts'),
                                          rd('web/src/app/admin/Smx.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('site/src/components/health/OrderForm.tsx'),
                                          rd('site/src/app/my/health/orders/[no]/page.tsx'), rd('site/src/i18n/messages/ko/order.json'), rd('site/src/i18n/messages/en/order.json'))

ok('① 코드 — D287 도서산간 구역 표(우편번호 5자리 · 범위 고유) · 큰 금액 하나(fn_smx_remote_fee) · 주문 칸 remote_ship_fee · remote_zone(배송비 안 · 따로 · 주문 뒤 못 바꿈) · 금액 규칙 그대로 · 처음 구역 2 · smx.remote_ship off · 주문 흐름(직판 · 입점) · 입점 정산 보기에 판매자 몫(기본 배송비 + 도서산간 · 11/21 대표) · 면세 몫 함수(현금영수증 · 전표) · 세무 구분 SUPER 만(admin.service) · 응답 · 내 주문 · 주문서 줄 · 사전 ko · en · 메뉴 smx-remote · 화면 SMX-020 · 문서 692 · 판 v10.554',
   'CREATE TABLE IF NOT EXISTS public.smx_remote_zones' in M87 and 'CONSTRAINT ux_smx_rz_range UNIQUE (zip_from, zip_to)' in M87 and 'FUNCTION public.fn_smx_remote_fee(p_zip text)' in M87
   and 'ADD COLUMN IF NOT EXISTS remote_ship_fee bigint NOT NULL DEFAULT 0' in M87 and 'ck_hlt_order_remote_ship' in M87 and 'trg_smx_order_remote_lock' in M87
   and 'DROP CONSTRAINT IF EXISTS hlt_orders_total_check' not in M87 and "'JEJU', '63000', '63644', 3000" in M87
   and "('smx.remote_ship', 'off'" in M87 and 'export async function smxRemoteQuote' in RM and "if (!sellerType) return { fee: 0, zone: null };" in RM and "if (sellerType !== 'DIRECT')" not in RM
   and "(o.goods_amount + o.remote_ship_fee + CASE WHEN s.type IN ('TENANT', 'BRAND') THEN greatest(o.ship_fee - o.remote_ship_fee, 0) ELSE 0 END) AS goods_amount" in M87 and 'AS base_ship_fee' in M87 and '입점 기본 배송비도 판매자 정산' in doc('692_') and 'FUNCTION public.fn_smx_remote_exempt(p_order uuid)' in M87 and '+ public.fn_smx_remote_exempt(p_order)' in M87
   and "('smx.remote_tax_mode', 'RATIO'" in M87 and rd('src/modules/acct/journal.ts').count('+ fn_smx_remote_exempt(o.id)) AS exempt') == 2
   and "key === 'smx.remote_tax_mode'" in rd('src/modules/admin/admin.service.ts')
   and 'const remote = await smxRemoteQuote(this.db, d.addressId, me, sellers[0]?.type);' in CK and 'goods + ship - discount + remote.fee' in CK and 'remote_ship_fee AS "remoteShipFee"' in CK
   and "@Controller('api/v1/me/health/remote-fee')" in CT and 'export function SmxRemote' in UI and "useRemoteFee(addr," in OF and "t('form.remoteShip')" in OF and "to('form.remoteShip')" in MO
   and '"remoteShip"' in OK_ and '"remoteShip"' in OE and "['smx-remote', '도서산간 배송비']" in MN and "{tab === 'smx-remote' && <SmxRemote />}" in AP and '"SB-ADM-SMX-020"' in SJ
   and '처리방침' in doc('692_') and VT >= (10, 554), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.order_open', 'smx.remote_ship', 'mall.points', 'mall.coupon', 'mall.giftcard', 'smx.remote_tax_mode')
    s0 = {k: getset(k) for k in keys}
    zid, oid = '', ''
    code, opt, st0 = single_option_product()
    zip_a, zip_b = '99990', '99999'
    try:
        em, aid, TM, adr = new_member('1554', zipcode='99995')
        setting('mall.order_open', 'on', '1554'); setting('smx.remote_ship', 'off', '1554')
        psql(f"SET session_replication_role = replica; DELETE FROM smx_remote_zones WHERE zip_from = '{zip_a}' AND zip_to = '{zip_b}';")
        v0 = call('GET', '/admin/smx/remote-zones', None, TS)
        mk = call('POST', '/admin/smx/remote-zones', {'name': f'시험 1554 {stamp}', 'kind': 'ISLAND', 'zipFrom': zip_a, 'zipTo': zip_b, 'fee': 4321}, TS)
        zid = mk.get('id') or ''
        dup = call('POST', '/admin/smx/remote-zones', {'name': '시험 1554 겹침', 'kind': 'ISLAND', 'zipFrom': zip_a, 'zipTo': zip_b, 'fee': 1}, TS)
        rev = call('POST', '/admin/smx/remote-zones', {'name': '시험 1554 거꾸로', 'kind': 'ISLAND', 'zipFrom': '99999', 'zipTo': '99000', 'fee': 1}, TS)
        badzip = call('GET', '/admin/smx/remote-zones/check?zip=12ab', None, TS)
        chk = call('GET', '/admin/smx/remote-zones/check?zip=99995', None, TS)
        q_off = call('GET', f'/me/health/remote-fee?addressId={adr}', None, TM)
        o_off = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': code, 'qty': 1}]}, TM)
        no_off = o_off.get('orderNo') or ''
        oid_off = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{no_off}'") if no_off else ''
        drop_order(oid_off)
        setting('smx.remote_ship', 'on', '1554')
        q_on = call('GET', f'/me/health/remote-fee?addressId={adr}', None, TM)
        o = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': code, 'qty': 1}]}, TM)
        no = o.get('orderNo') or ''
        oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{no}'") if no else ''
        row = psql(f"SELECT ship_fee || '|' || remote_ship_fee || '|' || remote_zone || '|' || (total = goods_amount + ship_fee - discount_amount - point_amount - gift_amount) FROM hlt_orders WHERE id = '{oid}'") if oid else ''
        lock = psql(f"UPDATE hlt_orders SET remote_ship_fee = 0 WHERE id = '{oid}'") if oid else ''
        mine = call('GET', f'/me/health/orders/{no}', None, TM) if no else {}
        exp_ex = psql(f"SELECT (4321 * coalesce(sum(amount) FILTER (WHERE tax_type = 'EXEMPT'), 0) / sum(amount))::bigint FROM hlt_order_items WHERE order_id = '{oid}'") if oid else ''
        ex_ratio = psql(f"SELECT fn_smx_remote_exempt('{oid}')") if oid else ''
        setting('smx.remote_tax_mode', 'TAXABLE', '1554')
        ex_tax = psql(f"SELECT fn_smx_remote_exempt('{oid}')") if oid else ''
        setting('smx.remote_tax_mode', 'RATIO', '1554')
        vcol = psql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'v_hlt_settle_ready' AND column_name IN ('remote_ship_fee', 'base_ship_fee')")
        vdef = psql("SELECT pg_get_viewdef('public.v_hlt_settle_ready'::regclass)")
        upd = call('PUT', f'/admin/smx/remote-zones/{zid}', {'name': f'시험 1554 {stamp}', 'kind': 'ISLAND', 'zipFrom': zip_a, 'zipTo': zip_b, 'fee': 9999, 'isActive': False}, TS) if zid else {}
        row2 = psql(f"SELECT remote_ship_fee FROM hlt_orders WHERE id = '{oid}'") if oid else ''
        chk2 = call('GET', '/admin/smx/remote-zones/check?zip=99995', None, TS)
        m403 = call('GET', '/admin/smx/remote-zones', None, TM)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'smx-remote'")
        ok('② 도서산간 — 운영 표 · 구역 더하기 · 같은 범위 409 · 거꾸로 422 · 틀린 우편번호 422 · 확인 4321 · 꺼짐이면 미리보기 0 · 주문 배송비 0 · 켜면 미리보기 4321 · 직판 주문 배송비 = 4321(따로 · 구역 이름 · 금액 규칙 맞음) · 주문 뒤 못 바꿈 · 내 주문 remoteShipFee · 면세 몫(비율 · 과세 모드 0) · 정산 보기 칸(도서산간 · 기본 배송비 — 입점 기본 배송비도 판매자 정산) · 구역을 고쳐도 주문 그대로 · 끈 구역은 확인 0 · 회원 403 · 권한 주소 5',
           bool(code) and v0.get('on') is False and bool(zid) and dup.get('code') == 'SMX_REMOTE_DUP' and rev.get('_err') == 422 and badzip.get('code') == 'SMX_REMOTE_ZIP'
           and chk.get('fee') == 4321 and q_off.get('on') is False and q_off.get('fee') == 0 and int(o_off.get('shipFee', -1)) == 0 and int(o_off.get('remoteShipFee', -1)) == 0
           and q_on.get('fee') == 4321 and bool(no) and int(o.get('shipFee') or 0) == 4321 and int(o.get('remoteShipFee') or 0) == 4321 and '도서산간' in (o.get('note') or '')
           and row == f'4321|4321|시험 1554 {stamp}|true' and '!' in lock and int(mine.get('remoteShipFee') or 0) == 4321
           and bool(exp_ex) and ex_ratio == exp_ex and ex_tax == '0' and vcol == '2' and 'base_ship_fee' in vdef and 'TENANT' in vdef
           and bool(upd.get('id')) and row2 == '4321' and chk2.get('fee') == 0 and m403.get('_err') == 403 and rmap == '5',
           f"{code} {v0.get('on')} {zid} {dup.get('code')} {rev.get('_err')} {badzip.get('code')} {chk.get('fee')} · {q_off} {o_off.get('shipFee')} {o_off.get('remoteShipFee')} · {q_on.get('fee')} {no or o} {o.get('shipFee')} {o.get('remoteShipFee')} · "
           f"{row} {lock[-40:]} {mine.get('remoteShipFee')} {exp_ex} {ex_ratio} {ex_tax} {vcol} · {upd.get('id')} {row2} {chk2.get('fee')} {m403.get('_err')} {rmap}")
    finally:
        drop_order(oid)
        if zid:
            psql(f"SET session_replication_role = replica; DELETE FROM smx_remote_zones WHERE id = '{zid}';")
        if opt and st0 is not None:
            psql(f"SET session_replication_role = replica; UPDATE hlt_product_options SET stock = {int(st0)} WHERE id = '{opt}';")
        for k, x in s0.items():
            setting(k, x or None, '1554 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/smx-remote', lambda pg, seen: seen.update(n=pg.locator('[data-smx-remote]').count(), c=pg.locator('[data-smx-remote-check]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 도서산간 배송비(표 · 우편번호 확인 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('c') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
