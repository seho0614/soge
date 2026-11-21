"""v10.481 (D267 · docs/619) 소개몰 정기 배송 — 직판 · 주기 · 다음 결제일 · 건너뛰기 · 멈춤 · 해지 · 매일 07:10 주문 · 정기 결제(기존 결제 어댑터 · 처음 간주) · 실패 다시 · 멈춤 알림
  ① (코드) D267 정기 배송 · 회차 · 주문 subscription_id · mall.subscribe · ASSUME · 정기 작업 · chargeWithBillingKey · 결과 모름 · 운영 · 회원 API · 메뉴 · 화면 MBS-030 · 문서 619
  ② (API · DB) 새 회원 둘 · 꺼짐 422 · 신청 · 409 · 400 · 422 · 403 · 404 · 건너뜀 회차 · 간주 결제 → 주문 결제 완료 · 두 번 돌려도 한 번 · 멈춤 · 해지 · LIVE 카드 없음 · DB 막음 · 권한 주소 3
  ③ (화면) 소개몰 › 정기 배송
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

ok('① 코드 — D267 정기 배송(직판 · 주기 14 · 28 · 30 · 60 · 90 · 다음 결제일 · 건너뛰기 · 멈춤 · 해지 끝) · 회차(날짜마다 한 번 · 주문함 → 결제됨 · 실패) · 주문 subscription_id · mall.subscribe off · 결제 방식 ASSUME(간주) · 다시 하기 3 · 정기 작업 mall_subscribe · 기존 결제 어댑터 chargeWithBillingKey · 결과 모름은 실패로 적지 않음 · 운영 API 3 · 회원 API · 메뉴 hlt-subscribe · 화면 MBS-030 · 문서 619 · 판 v10.481',
   'CREATE TABLE IF NOT EXISTS public.hlt_subscriptions' in M67 and 'CREATE TABLE IF NOT EXISTS public.hlt_subscription_runs' in M67 and 'cycle_days IN (14, 28, 30, 60, 90)' in M67
   and 'ux_hlt_sub_live' in M67 and 'ADD COLUMN IF NOT EXISTS subscription_id' in M67 and "('mall.subscribe', 'off'" in M67 and "('mall.subscribe_mode', 'ASSUME'" in M67
   and "('mall_subscribe', 1440, 7, 10" in M67 and 'export async function mallSubscribeJob' in HS and 'chargeWithBillingKey(' in HS and 'r.uncertain' in HS
   and "SUB_CYCLES = [14, 28, 30, 60, 90]" in HS and "@Post('subscriptions/:id/action')" in HC and "@Post('subscriptions/run')" in HC
   and "'mall_subscribe'," in WK and "case 'mall_subscribe':" in SC and 'export function HealthSubscribe' in UI and "['hlt-subscribe', '정기 배송']" in MN
   and "{tab === 'hlt-subscribe' && <HealthSubscribe />}" in AP and '"SB-ADM-MBS-030"' in SJ and '"SB-HLT-MBS-010"' in SJ and '간주' in doc('619_') and VT >= (10, 481), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.subscribe', 'mall.subscribe_mode', 'mall.subscribe_retry', 'mall.order_open', 'mall.points', 'mall.giftcard')
    s0 = {k: getset(k) for k in keys}
    subs, aids = [], []
    try:
        em, aid, TM, adr = new_member('1481'); aids.append(aid)
        em2, aid2, TM2, adr2 = new_member('1481b'); aids.append(aid2)
        setting('mall.order_open', 'on', '1481'); setting('mall.subscribe', 'off', '1481'); setting('mall.subscribe_mode', 'ASSUME', '1481'); setting('mall.subscribe_retry', '3', '1481')
        setting('mall.points', 'off', '1481'); setting('mall.giftcard', 'off', '1481')
        dp, price = direct_product()
        tmr = (kst + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
        s_off = call('POST', '/me/health/subscriptions', {'productCode': dp, 'qty': 1, 'addressId': adr, 'cycleDays': 30}, TM)
        setting('mall.subscribe', 'on', '1481')
        s1 = call('POST', '/me/health/subscriptions', {'productCode': dp, 'qty': 1, 'addressId': adr, 'cycleDays': 30}, TM)
        sid = str(s1.get('id') or '')
        if sid: subs.append(sid)
        dup = call('POST', '/me/health/subscriptions', {'productCode': dp, 'qty': 2, 'addressId': adr, 'cycleDays': 60}, TM)
        badc = call('POST', '/me/health/subscriptions', {'productCode': dp, 'qty': 1, 'addressId': adr2, 'cycleDays': 7}, TM2)
        badf = call('POST', '/me/health/subscriptions', {'productCode': dp, 'qty': 1, 'addressId': adr2, 'cycleDays': 30, 'firstOn': today}, TM2)
        oth = call('POST', '/me/health/subscriptions', {'productCode': dp, 'qty': 1, 'addressId': adr, 'cycleDays': 30}, TM2)
        mine = call('GET', '/me/health/subscriptions', None, TM)
        mb = call('GET', '/admin/health/subscriptions', None, TM)
        sk = call('POST', f'/me/health/subscriptions/{sid}/action', {'action': 'SKIP'}, TM)
        nope = call('POST', f'/me/health/subscriptions/{sid}/action', {'action': 'PAUSE'}, TM2)
        psql(f"UPDATE hlt_subscriptions SET next_on = '{today}'::date WHERE id = {int(sid) if sid else 0}")
        j1 = call('POST', '/admin/jobs', {'job': 'mall_subscribe'}, TS)
        r1 = psql(f"SELECT state || '|' || coalesce(order_id::text, '') FROM hlt_subscription_runs WHERE sub_id = {int(sid) if sid else 0}")
        st1 = psql(f"SELECT next_on::text || '|' || skip_next FROM hlt_subscriptions WHERE id = {int(sid) if sid else 0}")
        s2 = call('POST', '/me/health/subscriptions', {'productCode': dp, 'qty': 1, 'addressId': adr2, 'cycleDays': 14, 'firstOn': tmr}, TM2)
        sid2 = str(s2.get('id') or '')
        if sid2: subs.append(sid2)
        psql(f"UPDATE hlt_subscriptions SET next_on = '{today}'::date WHERE id = {int(sid2) if sid2 else 0}")
        j2 = call('POST', '/admin/health/subscriptions/run', None, TS)
        r2 = psql(f"SELECT r.state || '|' || r.stub || '|' || r.amount || '|' || o.status || '|' || p.state || '|' || p.stub FROM hlt_subscription_runs r JOIN hlt_orders o ON o.id = r.order_id "
                  f"JOIN hlt_payments p ON p.order_id = o.id WHERE r.sub_id = {int(sid2) if sid2 else 0} AND o.subscription_id = r.sub_id")
        st2 = psql(f"SELECT next_on::text || '|' || runs || '|' || fail_count FROM hlt_subscriptions WHERE id = {int(sid2) if sid2 else 0}")
        j3 = call('POST', '/admin/jobs', {'job': 'mall_subscribe'}, TS)
        cnt = psql(f"SELECT (SELECT count(*) FROM hlt_subscription_runs WHERE sub_id = {int(sid2) if sid2 else 0}) || '|' || (SELECT count(*) FROM hlt_orders WHERE subscription_id = {int(sid2) if sid2 else 0})")
        nxt2 = (datetime.date.fromisoformat(today) + datetime.timedelta(days=14)).isoformat()
        nxt1 = (datetime.date.fromisoformat(today) + datetime.timedelta(days=30)).isoformat()
        noreason = call('POST', f'/admin/health/subscriptions/{sid2}/state', {'state': 'PAUSED'}, TS)
        pz = call('POST', f'/admin/health/subscriptions/{sid2}/state', {'state': 'PAUSED', 'reason': '시험 1481 멈춤'}, TS)
        lst = call('GET', '/admin/health/subscriptions', None, TS)
        row = next((x for x in lst.get('items') or [] if x.get('id') == sid2), {})
        cx = call('POST', f'/me/health/subscriptions/{sid}/action', {'action': 'CANCEL'}, TM)
        cx2 = call('POST', f'/me/health/subscriptions/{sid}/action', {'action': 'CANCEL'}, TM)
        setting('mall.subscribe_mode', 'LIVE', '1481')
        live = call('POST', '/me/health/subscriptions', {'productCode': dp, 'qty': 1, 'addressId': adr, 'cycleDays': 30}, TM)
        if live.get('id'): subs.append(str(live['id']))
        g1 = psql(f"UPDATE hlt_subscriptions SET qty = 2 WHERE id = {int(sid) if sid else 0}")
        g2 = psql(f"DELETE FROM hlt_subscription_runs WHERE sub_id = {int(sid2) if sid2 else 0}")
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'hlt-subscribe'")
        ok('② 정기 배송 — 꺼짐 422 · 신청(내일 · 30일) · 같은 옵션 409 · 주기 7일 400 · 첫 결제일 오늘 422 · 남의 배송지 422 · 내 목록 · 회원 운영 화면 403 · 건너뛰기 · 남의 것 404 · 건너뛴 회차(주문 없음) → 다음 결제일 +30 · 정기 결제 간주 → 회차 결제됨 · 주문 결제 완료 · 결제 간주 표시 · 다음 결제일 +14 · 다시 돌려도 한 번 · 사유 없음 400 · 운영 멈춤 · 해지 · 다시 해지 409 · LIVE 는 카드 없으면 422 · 해지 뒤 고치기 · 회차 지우기 DB 막음 · 권한 주소 3',
           bool(dp) and price > 0 and s_off.get('code') == 'HLT_SUB_OFF' and bool(sid) and s1.get('nextOn') == tmr and dup.get('code') == 'HLT_SUB_DUP' and badc.get('_err') == 400
           and badf.get('code') == 'HLT_SUB_FIRST' and oth.get('code') == 'HLT_SUB_ADDRESS' and any(x.get('id') == sid for x in mine.get('items') or []) and mb.get('_err') == 403
           and sk.get('skipNext') is True and nope.get('_err') == 404 and j1.get('_err') is None and r1 == 'SKIPPED|' and st1 == f'{nxt1}|false'
           and bool(sid2) and j2.get('_err') is None and j2.get('paid', 0) >= 1 and r2 == f'PAID|true|{price}|PAID|PAID|true' and st2 == f'{nxt2}|1|0' and j3.get('_err') is None and cnt == '1|1'
           and noreason.get('_err') == 400 and pz.get('state') == 'PAUSED' and row.get('state') == 'PAUSED' and cx.get('state') == 'CANCELED' and cx2.get('code') == 'HLT_SUB_CANCELED'
           and live.get('code') == 'HLT_SUB_NO_CARD' and 'HLT_SUB_CANCELED' in g1 and '!' in g2 and rmap == '3',
           f"{dp} {price} {s_off.get('code')} {sid or s1} {s1.get('nextOn')} {dup.get('code')} {badc.get('_err')} {badf.get('code')} {oth.get('code')} {mb.get('_err')} · {sk.get('skipNext')} {nope.get('_err')} {j1.get('_err')} {r1} {st1}/{nxt1} · {sid2 or s2} {j2} {r2} {st2}/{nxt2} {cnt} · {noreason.get('_err')} {pz.get('state')} {row.get('state')} {cx.get('state')} {cx2.get('code')} {live.get('code')} {g1[-30:]} {g2[-20:]} {rmap}")
    finally:
        ids = ','.join(x for x in subs if x.isdigit())
        if ids:
            nos = psql(f"SELECT coalesce(string_agg(order_no, ','), '') FROM hlt_orders WHERE subscription_id IN ({ids})")
            drop_orders([x for x in nos.split(',') if x])
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_subscription_runs WHERE sub_id IN ({ids}); DELETE FROM hlt_subscriptions WHERE id IN ({ids});")
        for a_ in aids:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_subscription_runs WHERE sub_id IN (SELECT id FROM hlt_subscriptions WHERE account_id = '{a_}'); DELETE FROM hlt_subscriptions WHERE account_id = '{a_}';")
        if T0:
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code IN ('MALL_SUBSCRIBE_FAIL', 'MALL_SUBSCRIBE_UNCERTAIN') AND raised_at >= '{T0}'::timestamptz;")
        for k, x in s0.items():
            setting(k, x or None, '1481 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/hlt-subscribe', lambda pg, seen: seen.update(n=pg.locator('[data-hlt-subs]').count(), run=pg.locator('[data-hlt-sub-run]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 정기 배송(목록 · 지금 돌리기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('run') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
