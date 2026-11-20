"""v10.479 (D267 · docs/617) 소개몰 적립금 — 구매확정 적립(DB) · 주문서 사용(쿠폰 ㉝ 다음 · 최소 사용 · 1원 결제) · 취소 · 반품 되돌림 · 확정 뒤 반품 회수 · 소멸(매일 00:20) · 운영 지급 · 회수 · 충당부채 전표(초안)
  ① (코드) D267 적립금 표 · 주문 칸 · total CHECK · 트리거 · 계정 · mall.points · usePoints · 쿠폰 다음 차례 · 전표 · 정기 작업 · 메뉴 · 화면 MBS-010 · 문서 617
  ② (API · DB) 새 회원 · 회원 403 · 지급 · 400 · 422 · 꺼짐 · 최소 · 1원 남김 · 주문 금액 · 쓴 기록 · DB 막음 · 적립 한 번 · 취소 되돌림 · 회수 · 소멸 · 권한 주소 2
  ③ (화면) 소개몰 › 적립금
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


def direct_product():
    """직판 · 판매 중 · 켠 옵션 하나(재고 5 넘음) 상품 코드와 값"""
    code = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 "
                "AND NOT EXISTS (SELECT 1 FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock <= 5) ORDER BY p.code LIMIT 1")
    price = int(psql(f"SELECT o.price FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE p.code = '{code}' AND o.is_active LIMIT 1") or 0) if code else 0
    return code, price


def new_member(tag):
    """새 회원(본인인증 · 약관 동의) · 토큰 · 배송지 — 공유 회원(buyer)을 건드리지 않음"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    tok = login(em)
    adr = call('POST', '/me/health/addresses', {'receiver': '시험', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, tok).get('id')
    return em, aid, tok, adr


def drop_orders(nos):
    """시험 주문 지우기 — 먼저 취소(재고 · 혜택 되돌림 트리거) 뒤 replica 로 지움"""
    for n_ in [x for x in nos if x]:
        psql(f"UPDATE hlt_orders SET status = 'CANCELED' WHERE order_no = '{n_}' AND status NOT IN ('CANCELED', 'RETURNED')")
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM hlt_point_uses WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_point_txns WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_point_lots WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_giftcard_txns WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_payments WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_order_items WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_orders WHERE order_no = '{n_}';")


M67 = migr('D267_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
T0 = psql("SELECT now()::text") if (API and DB) else ''
HB, HS, HC, CK, DT, SR, UI, MN, AP, WK, SC = (rd('src/modules/health/health-benefit.ts'), rd('src/modules/health/health-subscribe.ts'), rd('src/modules/health/health-benefit.controller.ts'),
                                              rd('src/modules/health/health-checkout.service.ts'), rd('src/modules/health/health-shop.dto.ts'), rd('src/modules/acct/sources.ts'),
                                              rd('web/src/app/admin/HealthBenefits.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/worker.controller.ts'),
                                              rd('src/worker/scheduler.service.ts'))

ok('① 코드 — D267 적립금 묶음 · 쓴 기록 · 기록(쌓기만) · 주문 적립금 · 상품권 칸 · total = 상품 + 배송비 − 쿠폰 − 적립금 − 상품권 CHECK · 구매확정 적립 · 취소 · 반품 되돌림 · 반품 회수 트리거 · 계정 MALL_POINT_LIAB · EXP_MALL_PROMO(초안) · mall.points off · 주문서 usePoints · 쿠폰 다음 차례 · 전표 MALL_POINT_* · 정기 작업 mall_benefit_expire · 메뉴 hlt-points · 화면 MBS-010 · 문서 617 · 판 v10.479',
   'CREATE TABLE IF NOT EXISTS public.hlt_point_lots' in M67 and 'CREATE TABLE IF NOT EXISTS public.hlt_point_txns' in M67 and 'CREATE TABLE IF NOT EXISTS public.hlt_point_uses' in M67
   and 'total = goods_amount + ship_fee - discount_amount - point_amount - gift_amount AND total >= 0' in M67 and 'FUNCTION public.fn_hlt_point_earn' in M67 and 'FUNCTION public.fn_hlt_point_restore' in M67
   and 'FUNCTION public.fn_hlt_point_revoke' in M67 and 'trg_hlt_benefit_on_status' in M67 and 'trg_hlt_order_benefit_guard' in M67 and "('MALL_POINT_LIAB', '적립금 충당부채(소개몰)'," in M67
   and "('mall.points', 'off'" in M67 and "('mall_benefit_expire', 1440, 0, 20" in M67 and 'usePoints?: number;' in DT and 'await applyBenefits(this.db, o.id, me' in CK
   and ((CK.find('await useCoupon(') < CK.find('await applyBenefits(')) if 'await useCoupon(' in CK else ('await applyBenefits(' in CK))
   and "name: 'MALL_POINT_EARN'" in HB and "name: 'MALL_POINT_USE'" in HB and 'ALL_SOURCES.push(...BENEFIT_SOURCES)' in SR and "'mall_benefit_expire'," in WK and "case 'mall_benefit_expire':" in SC
   and "@Post('points/adjust')" in HC and 'export function HealthPoints' in UI and "['hlt-points', '적립금']" in MN and "{tab === 'hlt-points' && <HealthPoints />}" in AP
   and '"SB-ADM-MBS-010"' in SJ and '세무사' in doc('617_') and VT >= (10, 479), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.points', 'mall.points_min_use', 'mall.points_rate', 'mall.order_open', 'mall.tiers', 'mall.giftcard')
    s0 = {k: getset(k) for k in keys}
    made, aid = [], ''
    try:
        em, aid, TM, adr = new_member('1479')
        setting('mall.order_open', 'on', '1479'); setting('mall.points', 'off', '1479'); setting('mall.points_min_use', '1000', '1479')
        setting('mall.points_rate', '1', '1479'); setting('mall.tiers', 'off', '1479'); setting('mall.giftcard', 'off', '1479')
        dp, price = direct_product()
        mb = call('GET', '/admin/health/points', None, TM)
        a1 = call('POST', '/admin/health/points/adjust', {'accountId': aid, 'direction': 'ADD', 'amount': 5000, 'reason': '시험 1479 지급'}, TS)
        bad = call('POST', '/admin/health/points/adjust', {'accountId': aid, 'direction': 'ADD', 'amount': 0, 'reason': '시험 1479'}, TS)
        short = call('POST', '/admin/health/points/adjust', {'accountId': aid, 'direction': 'SUB', 'amount': 999999, 'reason': '시험 1479 회수'}, TS)
        pv = call('GET', f'/admin/health/points?email={urllib.parse.quote(em)}', None, TS)
        o0 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'usePoints': 1000}, TM)
        setting('mall.points', 'on', '1479')
        omin = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'usePoints': 500}, TM)
        oover = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'usePoints': max(price, 1000)}, TM)
        o1 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'usePoints': 1000}, TM)
        no1 = o1.get('orderNo') or ''
        if no1: made.append(no1)
        for x in (o0, omin, oover):
            if x.get('orderNo'): made.append(x['orderNo'])
        od = psql(f"SELECT goods_amount || '|' || discount_amount || '|' || point_amount || '|' || gift_amount || '|' || total FROM hlt_orders WHERE order_no = '{no1}'")
        uses = psql(f"SELECT count(*) || '|' || coalesce(sum(amount), 0) FROM hlt_point_uses WHERE account_id = '{aid}'")
        bal1 = psql(f"SELECT fn_hlt_point_balance('{aid}')")
        dbx = psql(f"UPDATE hlt_orders SET point_amount = 0 WHERE order_no = '{no1}'")
        neg = psql(f"UPDATE hlt_point_lots SET remaining = -1 WHERE account_id = '{aid}'")
        oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{no1}'")
        e1 = psql(f"SELECT fn_hlt_point_earn('{oid}')") if oid else ''
        e2 = psql(f"SELECT fn_hlt_point_earn('{oid}')") if oid else ''
        want = (price - 1000) // 100
        cx = psql(f"UPDATE hlt_orders SET status = 'CANCELED' WHERE order_no = '{no1}'")
        rs = psql(f"SELECT count(*) FILTER (WHERE restored_at IS NOT NULL) FROM hlt_point_uses WHERE account_id = '{aid}'")
        tx = psql(f"SELECT string_agg(kind || ':' || amount, ',' ORDER BY id) FROM hlt_point_txns WHERE account_id = '{aid}'")
        bal2 = psql(f"SELECT fn_hlt_point_balance('{aid}')")
        psql(f"INSERT INTO hlt_point_lots (account_id, source, amount, remaining, expires_at) VALUES ('{aid}', 'ADMIN', 700, 700, now() - interval '1 day')")
        jb = call('POST', '/admin/jobs', {'job': 'mall_benefit_expire'}, TS)
        ex = psql(f"SELECT count(*) || '|' || coalesce(sum(t.amount), 0) FROM hlt_point_txns t WHERE t.account_id = '{aid}' AND t.kind = 'EXPIRE'")
        cl = psql(f"SELECT count(*) FROM hlt_point_lots WHERE account_id = '{aid}' AND closed_reason = 'EXPIRED' AND remaining = 0")
        ro = psql(f"UPDATE hlt_point_txns SET amount = 1 WHERE account_id = '{aid}'")
        a2 = call('POST', '/admin/health/points/adjust', {'accountId': aid, 'direction': 'SUB', 'amount': 5000, 'reason': '시험 1479 회수'}, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'hlt-points'")
        ok('② 적립금 — 회원 403 · 지급 5,000 · 0원 400 · 모자란 회수 422 · 회원 찾기 남은 5,000 · 꺼짐 422 · 최소 사용 422 · 1원 남김 422 · 주문 = 상품 − 적립금 1,000 · 묶음별 쓴 기록 · 남은 4,000 · DB 가 주문 칸 고치기 · 음수 막음 · 적립(1%) 한 번만 · 주문 취소 → 되돌림 · 적립 회수 · 남은 5,000 · 소멸 작업(700) · 기록 고치기 막음 · 회수 → 0 · 권한 주소 2',
           bool(dp) and price > 2000 and mb.get('_err') == 403 and a1.get('balance') == 5000 and bad.get('_err') == 400 and short.get('code') == 'HLT_POINT_SHORT'
           and (pv.get('member') or {}).get('balance') == 5000 and o0.get('code') == 'HLT_POINT_OFF' and omin.get('code') == 'HLT_POINT_MIN' and oover.get('code') == 'HLT_POINT_OVER'
           and bool(no1) and o1.get('total') == price - 1000 and o1.get('pointAmount') == 1000 and od == f'{price}|0|1000|0|{price - 1000}' and uses == '1|1000' and bal1 == '4000'
           and 'HLT_BENEFIT' in dbx and '!' in neg and e1 == str(want) and e2 == '0' and '!' not in cx and rs == '1'
           and tx.startswith('ADJUST_ADD:5000,USE:1000') and 'RESTORE:1000' in tx and ((f'REVOKE:{want}' in tx) if want > 0 else True) and bal2 == '5000'
           and jb.get('_err') is None and ex == '1|700' and cl == '1' and '!' in ro and a2.get('balance') == 0 and rmap == '2',
           f"{dp} {price} {mb.get('_err')} {a1.get('balance') or a1} {bad.get('_err')} {short.get('code')} {(pv.get('member') or {}).get('balance')} · {o0.get('code')} {omin.get('code')} {oover.get('code')} · {no1 or o1} {o1.get('total')} {od} {uses} {bal1} · {dbx[-30:]} {neg[-30:]} {e1}/{want} {e2} · {cx[-30:]} {rs} {tx} {bal2} · {jb.get('_err')} {ex} {cl} {ro[-20:]} {a2.get('balance')} {rmap}")
    finally:
        drop_orders(made)
        if aid:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_point_uses WHERE account_id = '{aid}'; DELETE FROM hlt_point_txns WHERE account_id = '{aid}'; DELETE FROM hlt_point_lots WHERE account_id = '{aid}';")
        if T0:
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'MALL_BENEFIT_EXPIRED' AND raised_at >= '{T0}'::timestamptz;")
        for k, x in s0.items():
            setting(k, x or None, '1479 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/hlt-points', lambda pg, seen: seen.update(n=pg.locator('[data-hlt-points]').count(), f=pg.locator('[data-hlt-point-find]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 적립금(요약 · 회원 찾기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('f') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
