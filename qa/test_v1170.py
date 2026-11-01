"""v10.170 시험 — 공개 직후 지켜보기 · 소개몰 「주문 받기」 스위치 · 시험 결제 주문 알림(D159 · docs/262) · 운영 절차서 docs/261

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1170.py

  ① 코드 — D159(설정 on · 정기 작업 10분 · 지우는 문장 없음 · 197) · 주문 · 결제 시작 막기 · 공개 order-config · 지켜보기 API · 실행기 알림 · 화면 · 사전 · 명세 · 영어 · docs/261 · 262 · 판
  ② (API · DB) 지켜보기(관리자 · 회원 403) · 주문 받기 off → 주문 422 ORDERS_CLOSED · 결제 시작 422 · order-config false · on 되돌림 → 주문 됨 ·
     시험 결제(stub) 결제 완료 주문 → 지켜보기 「시험 결제 주문」 · 경고 · 되돌림
  ③ (화면) 운영 화면 첫 화면 「공개 직후 지켜보기」 카드 · 오류 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
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
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D159_launch_watch_order_switch/migration.sql')
ok('① D159 — mall.order_open on · 정기 작업 launch_watch 10분 · 지우는 문장 없음 · 197 이상', "('mall.order_open', 'on'," in M and "('launch_watch', 10," in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 197 and 'D159_launch_watch_order_switch' in mig, f'{len(mig)} · {mig[-1]}')
PO = rd('src/modules/health/health-policy.ts'); CO = rd('src/modules/health/health-checkout.service.ts'); PA = rd('src/modules/health/health-payment.service.ts')
TC = rd('src/modules/health/health-tenant.controller.ts'); LS = rd('src/modules/admin/launch-watch.service.ts'); LC = rd('src/modules/admin/launch-watch.controller.ts')
SH = rd('src/worker/scheduler.service.ts'); WC = rd('src/worker/worker.controller.ts'); AM = rd('src/app.module.ts')
ok('① 서버 — 주문 · 결제 시작 막기(ORDERS_CLOSED) · order-config · 지켜보기(시험 결제 주문) · 관리자만 · 실행기 알림 STUB_PAYMENT_ORDER · 모듈',
   'export const ORDER_OPEN_SQL' in PO and CO.count("'ORDERS_CLOSED'") == 1 and PA.count("'ORDERS_CLOSED'") == 1 and "@Get('health/order-config')" in TC
   and 'p.stub AND p.state = \'PAID\'' in LS and "@Roles('ADMIN', 'SUPER')" in LC and "case 'launch_watch':" in SH and "'STUB_PAYMENT_ORDER'" in SH
   and "'launch_watch'" in WC and 'LaunchWatchController' in AM and 'LaunchWatchService' in AM, '')
WL = rd('web/src/app/admin/LaunchWatch.tsx'); WD = rd('web/src/app/admin/Dashboard.tsx'); CV = rd('site/src/components/health/CartView.tsx'); OP = rd('site/src/app/health/order/page.tsx')
oko = json.loads(rd('site/src/i18n/messages/ko/order.json') or '{}'); oen = json.loads(rd('site/src/i18n/messages/en/order.json') or '{}')
SPEC = json.load(open(os.path.join(K, 'spec/screens.json'), encoding='utf-8')).get('screens') or []
scr = {x.get('id'): x for x in SPEC}
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 화면 · 명세 · 영어 · 문서 — 운영 첫 화면 카드(끄기 · 켜기) · 장바구니 · 주문서 안내 · 사전 ko · en · 명세 · 영어 · docs/261 · 262 · 판',
   "'/admin/launch-watch'" in WL and 'mall.order_open' in WL and '<LaunchWatch />' in WD and 'data-orders-closed' in CV and 'data-orders-closed' in OP
   and 'closed' in oko.get('cart', {}) and 'closed' in oen.get('cart', {}) and 'GET /admin/launch-watch' in (scr.get('SB-ADM-DSH-010') or {}).get('apis', [])
   and 'GET /health/order-config' in (scr.get('SB-HLT-CRT-010') or {}).get('apis', [])
   and '"지금은 소개몰 주문을 받지 않습니다 — 상품 보기와 장바구니 담기는 됩니다.":' in EN
   and any(f.startswith('261_') for f in os.listdir(os.path.join(K, 'docs'))) and any(f.startswith('262_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 170), rd('VERSION').strip())


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


BUY = 'buyer@x.com'
sv = lambda: psql("SELECT coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), '')")
if API and DB:
    o0 = sv(); bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
    biv0 = psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{bid}'")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
    made = []
    try:
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{bid}'")
        w0 = call('GET', '/admin/launch-watch', t=T_); wm = call('GET', '/admin/launch-watch', t=TB)
        ok('② 지켜보기 — 관리자는 숫자들 · 주문 받기 · 간주 결제 · 회원 403', all(k in w0 for k in ('signups', 'logins', 'orders', 'stubPaidOrders', 'openAlerts', 'orderOpen', 'directOnSale'))
           and wm.get('_err') == 403, f"{ {k: w0.get(k) for k in ('signups', 'orders', 'stubPaidOrders', 'orderOpen')} } · {wm.get('_err')}")
        dp = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                  "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 ORDER BY p.code LIMIT 1")
        addr = call('GET', '/me/health/addresses', t=TB)
        aid = (addr[0] if isinstance(addr, list) and addr else {}).get('id') or call('POST', '/me/health/addresses', {'receiver': '구매자', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, TB).get('id')
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.order_open'")
        a1 = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': dp, 'qty': 1}]}, TB); made.append(a1.get('orderNo'))
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'mall.order_open'")
        c1 = call('GET', '/health/order-config')
        a2 = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': dp, 'qty': 1}]}, TB)
        p2 = call('POST', f"/health/orders/{a1.get('orderNo')}/pay", {'method': 'CARD'}, TB)
        ok('② 주문 받기 off — order-config false · 새 주문 422 ORDERS_CLOSED · 만든 주문의 결제 시작도 422', bool(dp) and a1.get('orderNo') and c1.get('open') is False
           and a2.get('code') == 'ORDERS_CLOSED' and p2.get('code') == 'ORDERS_CLOSED', f"{dp} · {c1} · {a2.get('code')} · {p2.get('code')}")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.order_open'")
        c2 = call('GET', '/health/order-config')
        oid = psql(f"SELECT id || '|' || total FROM hlt_orders WHERE order_no = '{a1.get('orderNo')}'")
        o_id, tot = (oid.split('|') + ['0'])[:2]
        psql(f"INSERT INTO hlt_payments (order_id, method, amount, state, approved_at, stub, payment_key) VALUES ('{o_id}', 'CARD', {tot}, 'PAID', now(), true, 'STUB-T1170-' || md5(random()::text))")
        w1 = call('GET', '/admin/launch-watch', t=T_)
        ok('② on 되돌림 · 시험 결제(stub) 결제 완료 주문 → 지켜보기 「시험 결제 주문」 · 목록 · 경고', c2.get('open') is True and int(w1.get('stubPaidOrders') or 0) >= 1
           and any(x.get('orderNo') == a1.get('orderNo') for x in w1.get('stubOrders') or []) and w1.get('warn'), f"{c2} · {w1.get('stubPaidOrders')}")
        if ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                with sync_playwright() as p:
                    b_ = p.chromium.launch(); pg = b_.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    card = pg.locator('[data-launch-watch]').count(); tog = pg.locator('[data-order-toggle]').count(); warn = pg.locator('[data-watch-warn]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1170_admin_watch.png'), full_page=False)
                    b_.close()
                ok('③ 운영 화면 첫 화면 「공개 직후 지켜보기」 — 카드 · 주문 받기 단추 · 시험 결제 경고 · 오류 없음', card == 1 and tog == 1 and warn == 1 and not errs, f'{card} · {tog} · {warn} · {errs[:2]}')
    finally:
        for no in [x for x in made if x]:
            psql(f"DELETE FROM hlt_payments WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{no}')")
            psql(f"DELETE FROM hlt_order_items WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{no}')")
            psql(f"DELETE FROM hlt_orders WHERE order_no = '{no}'")
        psql(f"UPDATE site_settings SET value = '{o0 or 'on'}' WHERE key = 'mall.order_open'")
        psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not biv0 else repr(biv0) + '::timestamptz')} WHERE id = '{bid}'")
    ok('끝 — 되돌림(주문 받기 처음 값 · 시험 주문 없음 · 본인확인 처음 값)', sv() == (o0 or 'on')
       and all(psql(f"SELECT count(*) FROM hlt_orders WHERE order_no = '{x}'") == '0' for x in made if x), sv())
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
