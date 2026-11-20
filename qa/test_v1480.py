"""v10.480 (D267 · docs/618) 소개몰 회원 등급 — 기간 구매액 · 등급별 적립률 · 혜택 글 · 운영이 정함 · 매일 05:20 다시 셈
  ① (코드) D267 등급 · 회원 등급 · 바뀐 기록 · 처음 등급 3 · mall.tiers · mall.tier_months · 적립 때 등급 적립률 · 정기 작업 · 운영 API · 메뉴 · 화면 MBS-020 · 문서 618
  ② (API · DB) 회원 403 · 만들기 · 409 · 400 · 고치기 · 운영이 정함 · 기본 적립률 ↔ 등급 적립률 · 끄기 409 · 풀기 · 다시 셈 · 기록 · DB 막음 · 내 혜택 · 권한 주소 5
  ③ (화면) 소개몰 › 회원 등급
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

ok('① 코드 — D267 회원 등급(코드 · 이름 · 기준 구매액 · 적립률 · 혜택 · 켬) · 회원별 등급(운영이 정함) · 바뀐 기록(쌓기만) · 처음 등급 3(초안) · mall.tiers off · 기간 mall.tier_months · 적립 때 등급 적립률 · 정기 작업 mall_tier_recalc · 운영 API 5 · 메뉴 hlt-tiers · 화면 MBS-020 · 문서 618 · 판 v10.480',
   'CREATE TABLE IF NOT EXISTS public.hlt_tiers' in M67 and 'CREATE TABLE IF NOT EXISTS public.hlt_member_tiers' in M67 and 'CREATE TABLE IF NOT EXISTS public.hlt_tier_changes' in M67
   and "('BASIC',  '일반',  0,       1.0" in M67 and "('mall.tiers', 'off'" in M67 and "('mall.tier_months', '6'" in M67 and "public.fn_hlt_setting_on('mall.tiers')" in M67
   and "('mall_tier_recalc', 1440, 5, 20" in M67 and 'export async function mallTierJob' in HB and "@Post('tiers/run')" in HC and "@Put('tiers/member/:accountId')" in HC
   and "'mall_tier_recalc'," in WK and "case 'mall_tier_recalc':" in SC and 'export function HealthTiers' in UI and "['hlt-tiers', '회원 등급']" in MN
   and "{tab === 'hlt-tiers' && <HealthTiers />}" in AP and '"SB-ADM-MBS-020"' in SJ and '적립률' in doc('618_') and VT >= (10, 480), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.tiers', 'mall.points', 'mall.points_rate', 'mall.order_open', 'mall.giftcard')
    s0 = {k: getset(k) for k in keys}
    before = psql("SELECT coalesce(string_agg(account_id::text, ','), '') FROM hlt_member_tiers")
    made, aid, code = [], '', f'T{stamp}'
    try:
        em, aid, TM, adr = new_member('1480')
        setting('mall.order_open', 'on', '1480'); setting('mall.tiers', 'off', '1480'); setting('mall.points', 'off', '1480'); setting('mall.points_rate', '1', '1480'); setting('mall.giftcard', 'off', '1480')
        dp, price = direct_product()
        mb = call('GET', '/admin/health/tiers', None, TM)
        v0 = call('GET', '/admin/health/tiers', None, TS)
        seed = sorted(t.get('code') for t in v0.get('tiers') or [] if t.get('code') in ('BASIC', 'SILVER', 'GOLD'))
        c1 = call('POST', '/admin/health/tiers', {'code': code, 'name': '시험1480', 'minAmount': 999999999, 'earnRate': 7.5, 'benefit': '시험'}, TS)
        dup = call('POST', '/admin/health/tiers', {'code': code, 'name': '시험1480 겹침', 'minAmount': 0, 'earnRate': 1}, TS)
        badr = call('POST', '/admin/health/tiers', {'code': f'U{stamp}', 'name': '시험', 'minAmount': 0, 'earnRate': 7.55}, TS)
        low = call('POST', '/admin/health/tiers', {'code': f'u{stamp}', 'name': '시험', 'minAmount': 0, 'earnRate': 1}, TS)
        ed = call('PUT', f'/admin/health/tiers/{code}', {'earnRate': 8}, TS)
        rate = psql(f"SELECT earn_rate || '|' || min_amount || '|' || coalesce(benefit, '') FROM hlt_tiers WHERE code = '{code}'")
        m1 = call('PUT', f'/admin/health/tiers/member/{aid}', {'tierCode': code, 'reason': '시험 1480 정함'}, TS)
        mt = psql(f"SELECT tier_code || '|' || manual FROM hlt_member_tiers WHERE account_id = '{aid}'")
        o1 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}]}, TM)
        no1 = o1.get('orderNo') or ''
        if no1: made.append(no1)
        oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{no1}'")
        setting('mall.points', 'on', '1480')
        e0 = psql(f"SELECT fn_hlt_point_earn('{oid}')") if oid else ''
        psql(f"SET session_replication_role = replica; DELETE FROM hlt_point_txns WHERE order_id = '{oid}'; DELETE FROM hlt_point_lots WHERE order_id = '{oid}';") if oid else None
        setting('mall.tiers', 'on', '1480')
        e1 = psql(f"SELECT fn_hlt_point_earn('{oid}')") if oid else ''
        off1 = call('PUT', f'/admin/health/tiers/{code}', {'active': False}, TS)
        rel = call('PUT', f'/admin/health/tiers/member/{aid}', {'tierCode': '', 'reason': '시험 1480 풀기'}, TS)
        nor = call('PUT', f'/admin/health/tiers/member/{aid}', {'tierCode': code}, TS)
        run = call('POST', '/admin/health/tiers/run', None, TS)
        base = psql("SELECT code FROM hlt_tiers WHERE active AND min_amount <= 0 ORDER BY min_amount DESC, sort LIMIT 1")
        mt2 = psql(f"SELECT tier_code || '|' || manual || '|' || period_amount FROM hlt_member_tiers WHERE account_id = '{aid}'")
        ch = psql(f"SELECT count(*) FILTER (WHERE NOT by_job) || '|' || count(*) FILTER (WHERE by_job) FROM hlt_tier_changes WHERE account_id = '{aid}'")
        off2 = call('PUT', f'/admin/health/tiers/{code}', {'active': False}, TS)
        de = psql(f"DELETE FROM hlt_tiers WHERE code = '{code}'")
        ro = psql(f"UPDATE hlt_tier_changes SET reason = '바꿈' WHERE account_id = '{aid}'")
        me_ = call('GET', '/me/health/benefits', None, TM)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'hlt-tiers'")
        ok('② 회원 등급 — 회원 403 · 처음 등급 3 · 만들기 · 같은 코드 409 · 적립률 소수 둘 400 · 소문자 400 · 고치기(8.0) · 운영이 정함(manual) · 등급 꺼짐 = 기본 적립률 1% · 켜짐 = 등급 적립률 8% · 회원 있으면 끄기 409 · 풀기 · 사유 없음 400 · 다시 셈 → 기본 등급(구매액 0) · 바뀐 기록(운영 1 · 작업 1) · 끄기 · DB 가 지우기 · 기록 고치기 막음 · 내 혜택에 등급 · 권한 주소 5',
           bool(dp) and price > 2000 and mb.get('_err') == 403 and seed == ['BASIC', 'GOLD', 'SILVER'] and c1.get('ok') is True and dup.get('code') == 'HLT_TIER_DUP'
           and badr.get('_err') == 400 and low.get('_err') == 400 and ed.get('ok') is True and rate == '8.0|999999999|시험' and m1.get('ok') is True and mt == f'{code}|true'
           and bool(no1) and e0 == str(price // 100) and e1 == str(price * 8 // 100) and off1.get('code') == 'HLT_TIER_IN_USE' and rel.get('released') is True and nor.get('_err') == 400
           and run.get('_err') is None and run.get('accounts', 0) >= 1 and bool(base) and mt2 == f'{base}|false|0' and ch == '1|1' and off2.get('active') is False
           and 'HLT_TIER' in de and '!' in ro and (me_.get('tier') or {}).get('code') == base and rmap == '5',
           f"{dp} {price} {mb.get('_err')} {seed} {c1.get('ok') or c1} {dup.get('code')} {badr.get('_err')} {low.get('_err')} {ed.get('ok')} {rate} {m1.get('ok')} {mt} · {no1 or o1} {e0}/{price // 100} {e1}/{price * 8 // 100} · {off1.get('code')} {rel.get('released')} {nor.get('_err')} {run} {base} {mt2} {ch} {off2.get('active')} {de[-30:]} {ro[-20:]} {(me_.get('tier') or {}).get('code')} {rmap}")
    finally:
        drop_orders(made)
        keep = ','.join("'" + x + "'" for x in before.split(',') if x) or "'00000000-0000-0000-0000-000000000000'"
        psql(f"SET session_replication_role = replica; DELETE FROM hlt_member_tiers WHERE account_id::text NOT IN ({keep}) OR account_id::text = '{aid or '-'}'; "
             f"DELETE FROM hlt_tier_changes WHERE created_at >= '{T0}'::timestamptz OR account_id::text = '{aid or '-'}'; DELETE FROM hlt_tiers WHERE code IN ('{code}', 'U{stamp}');")
        if aid:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_point_txns WHERE account_id = '{aid}'; DELETE FROM hlt_point_lots WHERE account_id = '{aid}';")
        for k, x in s0.items():
            setting(k, x or None, '1480 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/hlt-tiers', lambda pg, seen: seen.update(n=pg.locator('[data-hlt-tiers]').count(), rows=pg.locator('[data-hlt-tier-row]').count(), nw=pg.locator('[data-hlt-tier-new]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 회원 등급(등급 표 3 이상 · 새 등급 칸 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('rows', 0) >= 3 and seen.get('nw') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
