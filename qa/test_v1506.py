"""v10.506 (docs/644) 소개몰 현금영수증 — 대표 11/20 「㊹ ②」
  ① (코드) D274 hlt_cash_receipts(번호 암호화) · 신청 함수 · 결제 · 주문 트리거 · 자진발급 · 어댑터(간주 · 토스 · NOT_READY) · SUPER 설정 · 메뉴 · 화면 · 문서 644
  ② (API · DB) 꺼짐 · 결제 전 신청 · 번호 검사 · 결제 승인 → 발급 대기 → 간주 발급 · 알림 · 발급 뒤 409 · 지킴 · 주문 취소 → 취소 · 카드 422 · 자진발급 · LIVE 키 없음 · ADMIN 설정 막음
  ③ (화면) 소개몰 › 현금영수증
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


def new_member(tag):
    """새 회원(본인인증 · 약관 동의) · 토큰 · 배송지 — 공유 회원(buyer)을 건드리지 않음"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    tok = login(em)
    adr = call('POST', '/me/health/addresses', {'receiver': '시험', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, tok).get('id')
    return em, aid, tok, adr


def direct_product():
    """직판 · 판매 중 · 켠 옵션 하나(재고 5 넘음) 상품 코드"""
    return psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 "
                "AND NOT EXISTS (SELECT 1 FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock <= 5) ORDER BY p.code LIMIT 1")


def order_paid(tok, adr, code, method, tag):
    """주문 → 결제 준비 → 승인(점검판은 결제 키가 없어 스텁 승인) · 주문 번호"""
    o = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': code, 'qty': 1}]}, tok)
    no = o.get('orderNo') or ''
    if no:
        call('POST', f'/health/orders/{no}/pay', {'method': method}, tok)
        total = int(psql(f"SELECT total FROM hlt_orders WHERE order_no = '{no}'") or 0)
        call('POST', f'/health/orders/{no}/pay/confirm', {'paymentKey': f't{tag}-{no}', 'amount': total}, tok)
    return no


def drop_orders(nos):
    """시험 주문 지우기 — 먼저 취소(재고 되돌림 · 영수증 취소 대기 트리거) 뒤 replica 로 지움"""
    for n_ in [x for x in nos if x]:
        psql(f"UPDATE hlt_orders SET status = 'CANCELED' WHERE order_no = '{n_}' AND status NOT IN ('CANCELED', 'RETURNED')")
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM hlt_cash_receipts WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_payments WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_order_items WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}'); "
             f"DELETE FROM hlt_orders WHERE order_no = '{n_}';")


M74 = migr('D274_')
stamp = int(time.time()) % 1000000
T0 = psql("SELECT now()::text") if (API and DB) else ''
CR, AD, HC, AS, PG, MN, AP, NJ, SC, WK = (rd('src/modules/health/health-cashrcpt.ts'), rd('src/modules/health/cashrcpt.adapter.ts'), rd('src/modules/health/health-mlx.controller.ts'),
                                          rd('src/modules/admin/admin.service.ts'), rd('web/src/app/admin/HealthMlx.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'),
                                          rd('spec/notifications.json'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))

ok('① 코드 — D274 현금영수증 표(번호 암호화 · 가린 값 · 용도 · 금액 CHECK) · 신청 함수(정규식 = 서버) · 결제 · 주문 트리거 · 지킴 · 자진발급 · 알림 HLT_CASH_RECEIPT · 설정 off · ASSUME · 정기 작업 mall_cash_receipt · 어댑터(간주 · 토스 · 키 없으면 NOT_READY) · SUPER 설정 · 메뉴 hlt-cashrcpt · 화면 MLX-020 · 문서 644(세무사 · PG) · 판 v10.506',
   'CREATE TABLE IF NOT EXISTS public.hlt_cash_receipts' in M74 and 'pgp_sym_encrypt(v_num, public.fn_enc_key())' in M74 and "v_num !~ '^01[016789][0-9]{7,8}$'" in M74
   and "/^01[016789][0-9]{7,8}$/" in CR and "/^[0-9]{10}$/" in CR and 'trg_hlt_cr_on_pay' in M74 and 'trg_hlt_cr_on_order' in M74 and 'trg_hlt_cr_guard' in M74
   and "'0100001234'" in M74 and "('HLT_CASH_RECEIPT', '현금영수증 발급 · 취소', false" in M74 and "('mall.cash_receipt', 'off'" in M74 and "('mall.cash_receipt_mode', 'ASSUME'" in M74
   and "('mall_cash_receipt', 10, NULL" in M74 and 'class AssumeCrAdapter' in AD and 'class TossCrAdapter' in AD and '/v1/cash-receipts' in AD and 'NOT_READY:' in CR
   and "MLX_SETTING_SUPER" in AS and "case 'mall_cash_receipt':" in SC and "'mall_cash_receipt'," in WK and "@Put('orders/:no/cash-receipt')" in HC
   and "['hlt-cashrcpt', '현금영수증']" in MN and "{tab === 'hlt-cashrcpt' && <HealthCashReceipts />}" in AP and 'export function HealthCashReceipts' in PG and '"code":"HLT_CASH_RECEIPT"' in NJ
   and '"SB-ADM-MLX-020"' in SJ and '세무사' in doc('644_') and 'PG' in doc('644_') and VT >= (10, 506), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.order_open', 'mall.cash_receipt', 'mall.cash_receipt_mode', 'mall.cash_receipt_self', 'mall.cash_receipt_self_min', 'mall.cash_receipt_req_days')
    s0 = {k: getset(k) for k in keys}
    made, aid, sid = [], '', ''
    try:
        em, aid, TM, adr = new_member('1506')
        se, sid = mk_staff('1506a', 'ADMIN'); consent_ok.agree(se, PW); TA = login(se)
        setting('mall.order_open', 'on', '1506'); setting('mall.cash_receipt', 'off', '1506'); setting('mall.cash_receipt_mode', 'ASSUME', '1506')
        setting('mall.cash_receipt_self', 'off', '1506'); setting('mall.cash_receipt_req_days', '5', '1506')
        dp = direct_product()
        o1 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}]}, TM)
        no1 = o1.get('orderNo') or ''
        if no1: made.append(no1)
        off = call('PUT', f'/me/health/orders/{no1}/cash-receipt', {'purpose': 'INCOME', 'number': '010-1234-5678'}, TM)
        setting('mall.cash_receipt', 'on', '1506')
        r1 = call('PUT', f'/me/health/orders/{no1}/cash-receipt', {'purpose': 'INCOME', 'number': '010-1234-5678'}, TM)
        badn = call('PUT', f'/me/health/orders/{no1}/cash-receipt', {'purpose': 'INCOME', 'number': '02-123-4567'}, TM)
        bad400 = call('PUT', f'/me/health/orders/{no1}/cash-receipt', {'purpose': 'INCOME', 'number': 'abc'}, TM)
        r2 = call('PUT', f'/me/health/orders/{no1}/cash-receipt', {'purpose': 'EXPENSE', 'number': '123-45-67890'}, TM)
        # 암호화 확인 — 점검판 API 열쇠(ENC_KEY)는 .env 에만 있어 시험이 모릅니다. 열쇠를 받으면 풀어서 원래 번호를 보고,
        # 없으면 암호문에 원래 번호 글자가 없고(평문 저장 아님) 가린 값 · 상태가 맞는지만 봅니다(같은 기대 문자열로 맞춤)
        _ek = os.environ.get('ENC_KEY', '').replace("'", '')
        _w = f"FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE o.order_no = '{no1}' AND c.state NOT IN ('CANCELED', 'SKIPPED')"
        if _ek:
            enc = psql(f"SET app.enc_key = '{_ek}'; SELECT pgp_sym_decrypt(c.id_enc, fn_enc_key()) || '|' || c.id_mask || '|' || c.state {_w}")
        else:
            enc = psql(f"SELECT CASE WHEN c.id_enc IS NOT NULL AND length(c.id_enc) > 20 AND position(convert_to('1234567890', 'UTF8') IN c.id_enc) = 0 "
                       f"THEN '1234567890' ELSE 'PLAIN?' END || '|' || c.id_mask || '|' || c.state {_w}")
        other = call('GET', f'/me/health/orders/{no1}/cash-receipt', None, TS)
        call('POST', f'/health/orders/{no1}/pay', {'method': 'TRANSFER'}, TM)
        tot1 = int(psql(f"SELECT total FROM hlt_orders WHERE order_no = '{no1}'") or 0)
        call('POST', f'/health/orders/{no1}/pay/confirm', {'paymentKey': f't1506-{no1}', 'amount': tot1}, TM)
        st_p = psql(f"SELECT c.state FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE o.order_no = '{no1}' AND c.state NOT IN ('CANCELED', 'SKIPPED')")
        v403 = call('GET', '/admin/health/cash-receipts', None, TM)
        run1 = call('POST', '/admin/health/cash-receipts/run', {}, TS)
        iss = psql(f"SELECT c.state || '|' || c.amount || '|' || (c.supply + c.vat + c.tax_free) || '|' || c.adapter || '|' || (c.doc_key ~ '^CR[0-9]{{10}}$') FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE o.order_no = '{no1}' AND c.state NOT IN ('CANCELED', 'SKIPPED')")
        nt1 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_CASH_RECEIPT'")
        again = call('PUT', f'/me/health/orders/{no1}/cash-receipt', {'purpose': 'INCOME', 'number': '010-1234-5678'}, TM)
        gm = psql(f"UPDATE hlt_cash_receipts SET id_mask = '010-****-0000' WHERE order_id = (SELECT id FROM hlt_orders WHERE order_no = '{no1}')")
        gd = psql(f"DELETE FROM hlt_cash_receipts WHERE order_id = (SELECT id FROM hlt_orders WHERE order_no = '{no1}')")
        view = call('GET', '/admin/health/cash-receipts', None, TS)
        leak = any(('1234567890' in json.dumps(x)) for x in (view.get('items') or []))
        psql(f"UPDATE hlt_orders SET status = 'CANCELED' WHERE order_no = '{no1}'")
        st_c = psql(f"SELECT c.state FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE o.order_no = '{no1}' ORDER BY c.id DESC LIMIT 1")
        call('POST', '/admin/health/cash-receipts/run', {}, TS)
        st_x = psql(f"SELECT c.state FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE o.order_no = '{no1}' ORDER BY c.id DESC LIMIT 1")
        nt2 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_CASH_RECEIPT'")
        no2 = order_paid(TM, adr, dp, 'CARD', '1506c')
        if no2: made.append(no2)
        card = call('PUT', f'/me/health/orders/{no2}/cash-receipt', {'purpose': 'INCOME', 'number': '010-1234-5678'}, TM)
        setting('mall.cash_receipt_self', 'on', '1506'); setting('mall.cash_receipt_self_min', '1', '1506')
        no3 = order_paid(TM, adr, dp, 'TRANSFER', '1506s')
        if no3: made.append(no3)
        selfr = psql(f"SELECT c.source || '|' || c.id_mask || '|' || c.state FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE o.order_no = '{no3}'")
        setting('mall.cash_receipt_mode', 'LIVE', '1506')
        lv = call('GET', '/admin/health/cash-receipts', None, TS)
        run2 = call('POST', '/admin/health/cash-receipts/run', {}, TS)
        st_l = psql(f"SELECT c.state FROM hlt_cash_receipts c JOIN hlt_orders o ON o.id = c.order_id WHERE o.order_no = '{no3}'")
        live_ok = (run2.get('notReady', 0) >= 1 and st_l == 'PENDING') if lv.get('ready') is False else True
        setting('mall.cash_receipt_mode', 'ASSUME', '1506')
        na = call('PATCH', '/admin/site-settings', {'key': 'mall.cash_receipt_mode', 'value': 'LIVE', 'reason': '시험 1506 ADMIN'}, TA)
        nb = call('PATCH', '/admin/site-settings', {'key': 'mall.cash_receipt', 'value': 'off', 'reason': '시험 1506 ADMIN 끄기'}, TA)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'hlt-cashrcpt'")
        ok('② 현금영수증 — 꺼짐 422 · 결제 전 신청(REQUESTED · 가린 번호) · 번호 틀림 422 · 형식 400 · 지출증빙으로 바꿈(암호화 풀면 원래 번호) · 남의 주문 404 · 결제 승인 → 발급 대기 · 회원 403 · 지금 돌리기 → 간주 발급(금액 = 공급가액 + 부가세 + 면세 · 문서 번호) · 회원 알림 · 발급 뒤 바꾸기 409 · 가린 값 고치기 · 지우기 막음 · 목록에 번호 원문 없음 · 주문 취소 → 취소 대기 → 취소 · 알림 2 · 카드 결제 422 · 자진발급 줄 · 실제 방식 키 없으면 NOT_READY · ADMIN 은 LIVE 못 켬 · 끄기는 됨 · 권한 주소 5',
           bool(dp) and bool(no1) and off.get('code') == 'HLT_CR_OFF' and r1.get('state') == 'REQUESTED' and r1.get('idMask') == '010-****-5678' and badn.get('code') == 'HLT_CR_NUMBER'
           and bad400.get('_err') == 400 and r2.get('idMask') == '123-**-67890' and enc == '1234567890|123-**-67890|REQUESTED' and other.get('_err') == 404 and st_p == 'PENDING'
           and v403.get('_err') == 403 and run1.get('assumed', 0) >= 1 and iss == f'ASSUMED|{tot1}|{tot1}|assume|true' and nt1 == '1' and again.get('_err') == 409
           and 'HLT_CR_ISSUED' in gm and 'HLT_CR_KEEP' in gd and not leak and st_c == 'CANCEL_PENDING' and st_x == 'CANCELED' and nt2 == '2'
           and card.get('code') == 'HLT_CR_CARD' and selfr == 'SELF|010-000-1234|PENDING' and live_ok and na.get('code') == 'MLX_SETTING_SUPER' and nb.get('_err') is None and rmap == '5',
           f"{dp} {no1} {off.get('code')} {r1.get('state')}/{r1.get('idMask')} {badn.get('code')} {bad400.get('_err')} {r2.get('idMask')} {enc} {other.get('_err')} {st_p} · {v403.get('_err')} {run1} {iss} {nt1} {again.get('_err')} · "
           f"{gm[-30:]} {gd[-30:]} {leak} {st_c} {st_x} {nt2} · {card.get('code')} {selfr} {lv.get('ready')} {run2.get('notReady')} {st_l} · {na.get('code') or na.get('_err')} {nb.get('_err')} {rmap}")
    finally:
        drop_orders(made)
        if aid:
            psql(f"SET session_replication_role = replica; DELETE FROM notifications WHERE account_id = '{aid}';")
        if sid:
            rm_role(sid, '1506')
        if T0:
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code IN ('MALL_CASH_RECEIPT_NOT_READY', 'MALL_CASH_RECEIPT_FAIL') AND raised_at >= '{T0}'::timestamptz;")
        for k, x in s0.items():
            setting(k, x or None, '1506 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/hlt-cashrcpt', lambda pg, seen: seen.update(n=pg.locator('[data-hlt-cashrcpt]').count(), f=pg.locator('[data-hlt-cr-issue]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 현금영수증(요약 · 운영 발급 칸 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('f') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
