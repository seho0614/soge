"""v10.482 (D267 · docs/620) 소개몰 상품권 — 판매 · 판촉 발행(코드는 한 번만 · 지문) · 주문서 사용(적립금 다음 · 1원 결제) · 취소 · 반품 되돌림 · 무효 · 잔액 환불 · 소멸 · 선수금 전표(초안 · 법무 확인)
  ① (코드) D267 상품권 · 기록 · 지문 · 잔액 CHECK · 함수만 바꿈 · 되돌림 · 계정 GIFT_ADV · mall.giftcard · giftCode · 전표 · 운영 API · 메뉴 · 화면 MBS-040 · 문서 620
  ② (API · DB) 새 회원 · 회원 403 · 발행 · 400 · 찾기 · 꺼짐 422 · 주문 금액 · 잔액 · DB 막음 · 취소 되돌림 · 무효 · 409 · 422 · 환불 · 소멸 · 기록 · 권한 주소 5
  ③ (화면) 소개몰 › 상품권
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

ok('① 코드 — D267 상품권(코드 지문 sha256 · 끝 4자리 · 원문 없음 · 판매 · 판촉 · 액면 1천 ~ 100만 · 잔액 0 ~ 액면 · 소멸 · 무효 · 환불) · 기록(쌓기만 · 주문 하나에 사용 하나) · 잔액 · 상태는 상품권 함수만 · 취소 · 반품 되돌림 · 계정 GIFT_ADV(선수금) · INC_GIFT_LAPSE(초안) · mall.giftcard off · 유효 5년 · 주문서 giftCode · 전표 MALL_GIFT_* · 운영 API 5 · 메뉴 hlt-giftcards · 화면 MBS-040 · 문서 620(법무 확인) · 판 v10.482',
   'CREATE TABLE IF NOT EXISTS public.hlt_giftcards' in M67 and 'CREATE TABLE IF NOT EXISTS public.hlt_giftcard_txns' in M67 and "code_hash      text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$')" in M67
   and 'face_amount BETWEEN 1000 AND 1000000' in M67 and 'ux_hlt_gift_txn_use' in M67 and 'FUNCTION public.fn_hlt_gift_restore' in M67 and "current_setting('app.hlt_gift', true)" in M67
   and "('GIFT_ADV',        '선수금(소개몰 상품권)'" in M67 and "('INC_GIFT_LAPSE'" in M67 and "('mall.giftcard', 'off'" in M67 and "('mall.giftcard_valid_days', '1825'" in M67
   and 'giftCode?: string;' in DT and "GIFT_CODE = /^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/" in HB and "name: 'MALL_GIFT_USE'" in HB and "name: 'MALL_GIFT_CLOSE'" in HB
   and "@Post('giftcards/:id/close')" in HC and "@Post('giftcards/check')" in HC and 'export function HealthGiftcards' in UI and "['hlt-giftcards', '상품권']" in MN
   and "{tab === 'hlt-giftcards' && <HealthGiftcards />}" in AP and '"SB-ADM-MBS-040"' in SJ and '법무' in doc('620_') and '선불전자지급수단' in doc('620_') and VT >= (10, 482), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.giftcard', 'mall.order_open', 'mall.points')
    s0 = {k: getset(k) for k in keys}
    made, memo = [], f'시험 1482-{stamp}'
    try:
        em, aid, TM, adr = new_member('1482')
        setting('mall.order_open', 'on', '1482'); setting('mall.giftcard', 'off', '1482'); setting('mall.points', 'off', '1482')
        dp, price = direct_product()
        mb = call('GET', '/admin/health/giftcards', None, TM)
        i1 = call('POST', '/admin/health/giftcards', {'kind': 'PROMO', 'amount': 5000, 'count': 2, 'memo': memo}, TS)
        codes = [c.get('code') for c in i1.get('codes') or []]
        ids = [str(c.get('id')) for c in i1.get('codes') or []]
        badA = call('POST', '/admin/health/giftcards', {'kind': 'PROMO', 'amount': 500, 'count': 1, 'memo': memo}, TS)
        badC = call('POST', '/admin/health/giftcards', {'kind': 'SOLD', 'amount': 5000, 'count': 0, 'memo': memo}, TS)
        i3 = call('POST', '/admin/health/giftcards', {'kind': 'SOLD', 'amount': 3000, 'count': 1, 'buyerName': '시험 구매자', 'memo': memo}, TS)
        id3 = str(((i3.get('codes') or [{}])[0]).get('id') or '')
        plain = (codes[0] or '').replace('-', '') if codes else ''
        hashed = psql(f"SELECT count(*) || '|' || coalesce(max(code_tail), '') FROM hlt_giftcards WHERE code_hash = encode(sha256(convert_to('{plain}', 'UTF8')), 'hex') AND memo = '{memo}'")
        noplain = psql(f"SELECT count(*) FROM hlt_giftcards WHERE memo = '{memo}' AND (code_hash LIKE '%{plain}%' OR coalesce(memo, '') LIKE '%{plain}%')") if plain else ''
        lk = call('POST', '/admin/health/giftcards/lookup', {'code': codes[0] if codes else 'AAAA-AAAA-AAAA-AAAA'}, TS)
        ck0 = call('POST', '/me/health/giftcards/check', {'code': codes[0] if codes else 'AAAA-AAAA-AAAA-AAAA'}, TM)
        o0 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'giftCode': codes[0] if codes else 'AAAA-AAAA-AAAA-AAAA'}, TM)
        setting('mall.giftcard', 'on', '1482')
        ck1 = call('POST', '/me/health/giftcards/check', {'code': (codes[0] or '').lower() if codes else 'aaaa-aaaa-aaaa-aaaa'}, TM)
        nf = call('POST', '/me/health/giftcards/check', {'code': 'ZZZZ-ZZZZ-ZZZZ-ZZZZ'}, TM)
        g = min(5000, price - 1)
        o1 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'giftCode': (codes[0] or '').lower() if codes else ''}, TM)
        no1 = o1.get('orderNo') or ''
        if no1: made.append(no1)
        od = psql(f"SELECT goods_amount || '|' || point_amount || '|' || gift_amount || '|' || total FROM hlt_orders WHERE order_no = '{no1}'")
        b1 = psql(f"SELECT balance FROM hlt_giftcards WHERE id = {int(ids[0]) if ids else 0}")
        o2 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}], 'giftCode': codes[0] if codes else ''}, TM) if price - 1 >= 5000 else {'code': 'HLT_GIFT_EMPTY'}
        if o2.get('orderNo'): made.append(o2['orderNo'])
        dbx = psql(f"UPDATE hlt_giftcards SET balance = 1 WHERE id = {int(ids[0]) if ids else 0}")
        neg = psql(f"BEGIN; SELECT set_config('app.hlt_gift', '1', true); UPDATE hlt_giftcards SET balance = -1 WHERE id = {int(ids[0]) if ids else 0}; COMMIT;")
        cx = psql(f"UPDATE hlt_orders SET status = 'CANCELED' WHERE order_no = '{no1}'")
        b2 = psql(f"SELECT balance || '|' || state FROM hlt_giftcards WHERE id = {int(ids[0]) if ids else 0}")
        v1 = call('POST', f'/admin/health/giftcards/{ids[1] if len(ids) > 1 else 0}/close', {'action': 'VOID', 'reason': '시험 1482 무효'}, TS)
        v0 = call('POST', f'/admin/health/giftcards/{ids[0] if ids else 0}/close', {'action': 'VOID', 'reason': '시험 1482 무효'}, TS)
        rp = call('POST', f'/admin/health/giftcards/{ids[0] if ids else 0}/close', {'action': 'REFUND', 'reason': '시험 1482 환불'}, TS)
        r3 = call('POST', f'/admin/health/giftcards/{id3 or 0}/close', {'action': 'REFUND', 'reason': '시험 1482 환불'}, TS)
        r3b = call('POST', f'/admin/health/giftcards/{id3 or 0}/close', {'action': 'REFUND', 'reason': '시험 1482 환불'}, TS)
        psql(f"INSERT INTO hlt_giftcards (code_hash, code_tail, batch_no, kind, face_amount, balance, expires_at, memo) "
             f"VALUES (fn_hlt_gift_hash('X{stamp:06d}EXPIRED1'), 'ED1X', 'GC{today.replace('-', '')}-{stamp:06d}', 'SOLD', 2000, 2000, now() - interval '1 day', '{memo}')")
        jb = call('POST', '/admin/jobs', {'job': 'mall_benefit_expire'}, TS)
        ex = psql(f"SELECT g.state || '|' || g.balance || '|' || (SELECT count(*) FROM hlt_giftcard_txns t WHERE t.card_id = g.id AND t.kind = 'EXPIRE' AND t.amount = 2000) FROM hlt_giftcards g WHERE g.code_tail = 'ED1X' AND g.memo = '{memo}'")
        dt = call('GET', f'/admin/health/giftcards/{ids[0] if ids else 0}', None, TS)
        kinds = [t.get('kind') for t in dt.get('txns') or []]
        ro = psql(f"UPDATE hlt_giftcard_txns SET amount = 1 WHERE card_id = {int(ids[0]) if ids else 0}")
        lst = call('GET', '/admin/health/giftcards?state=VOID', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'hlt-giftcards'")
        ok('② 상품권 — 회원 403 · 판촉 2장 발행(코드는 응답에만 · DB 는 지문 · 끝 4자리) · 액면 500 400 · 0장 400 · 판매 1장 · 코드로 찾기 5,000 · 받기 꺼짐 422(조회 · 주문) · 소문자 코드 조회 · 없는 코드 422 · 주문 = 상품 − min(5,000, 상품 − 1) · 잔액 줄어듦 · 잔액 0 이면 422 · DB 가 잔액 고치기 · 음수 막음 · 주문 취소 → 잔액 되돌림 · 안 쓴 것 무효 · 쓴 것 무효 409 · 판촉 환불 422 · 판매 잔액 환불 · 다시 409 · 소멸 작업(2,000) · 기록(발행 · 사용 · 되돌림) · 기록 고치기 막음 · 상태 거르기 · 권한 주소 5',
           bool(dp) and price > 1 and mb.get('_err') == 403 and len(codes) == 2 and all(c and len(c) == 19 for c in codes) and hashed == f'1|{plain[-4:]}' and noplain == '0'
           and badA.get('_err') == 400 and badC.get('_err') == 400 and bool(id3) and lk.get('balance') == 5000 and lk.get('state') == 'ACTIVE'
           and ck0.get('code') == 'HLT_GIFT_OFF' and o0.get('code') == 'HLT_GIFT_OFF' and ck1.get('balance') == 5000 and ck1.get('usable') is True and nf.get('code') == 'HLT_GIFT_CODE'
           and bool(no1) and o1.get('giftAmount') == g and od == f'{price}|0|{g}|{price - g}' and b1 == str(5000 - g) and o2.get('code') == 'HLT_GIFT_EMPTY'
           and 'HLT_GIFT' in dbx and '!' in neg and '!' not in cx and b2 == '5000|ACTIVE'
           and v1.get('state') == 'VOID' and v0.get('code') == 'HLT_GIFT_USED' and rp.get('code') == 'HLT_GIFT_PROMO_REFUND' and r3.get('state') == 'REFUNDED' and r3.get('amount') == 3000
           and r3b.get('code') == 'HLT_GIFT_STATE' and jb.get('_err') is None and ex == 'EXPIRED|0|1' and kinds[:3] == ['ISSUE', 'USE', 'RESTORE'] and '!' in ro
           and any(c.get('id') == (ids[1] if len(ids) > 1 else '') for c in lst.get('cards') or []) and all(c.get('state') == 'VOID' for c in lst.get('cards') or []) and rmap == '5',
           f"{dp} {price} {mb.get('_err')} {codes} {hashed} {noplain} {badA.get('_err')} {badC.get('_err')} {id3 or i3} {lk.get('balance')} · {ck0.get('code')} {o0.get('code')} {ck1.get('balance')} {nf.get('code')} · {no1 or o1} {o1.get('giftAmount')}/{g} {od} {b1} {o2.get('code')} · {dbx[-30:]} {neg[-30:]} {cx[-20:]} {b2} · {v1.get('state')} {v0.get('code')} {rp.get('code')} {r3.get('state')} {r3.get('amount')} {r3b.get('code')} {jb.get('_err')} {ex} {kinds} {ro[-20:]} {rmap}")
    finally:
        drop_orders(made)
        psql(f"SET session_replication_role = replica; DELETE FROM hlt_giftcard_txns WHERE card_id IN (SELECT id FROM hlt_giftcards WHERE memo = '{memo}'); DELETE FROM hlt_giftcards WHERE memo = '{memo}';")
        if T0:
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'MALL_BENEFIT_EXPIRED' AND raised_at >= '{T0}'::timestamptz;")
        for k, x in s0.items():
            setting(k, x or None, '1482 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/hlt-giftcards', lambda pg, seen: seen.update(n=pg.locator('[data-hlt-gifts]').count(), nw=pg.locator('[data-hlt-gift-new]').count(), lk=pg.locator('[data-hlt-gift-lookup]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 상품권(발행 칸 · 코드로 찾기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('nw') == 1 and seen.get('lk') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
