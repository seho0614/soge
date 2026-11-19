"""v10.386 (D243 · docs/522) 부가세 별도 — 입점 정산 수수료 부가세
  ① (코드) D243 정산 함수 · API · 화면
  ② (정산) 시작일 뒤 주: 수수료 부가세 · 받을 돈 · 정산 뒤 환불이면 수수료 부가세도 되돌림 · 판매자 API
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




def setvat(v):
    """부가세 별도 시작일을 SQL 로(시험만 · 지난 날짜도) — 비우기는 ''"""
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {TAG}', true); UPDATE site_settings SET value = '{v}' WHERE key = 'vat.separate_from'; COMMIT;")

TAG = '1386'
M43, ST, SS, HS, SE = rd('prisma/migrations/D243_vat_separate/migration.sql'), rd('src/modules/health/health-settle.service.ts'), rd('src/modules/health/health-seller.service.ts'), rd('web/src/app/admin/HealthSettle.tsx'), rd('site/src/components/health/SellerSettlements.tsx')
ok('① 코드 — 정산 함수(수수료 부가세 · 받을 돈 · 환불 되돌림 · 직판 없음) · API commissionVat · 운영 · 판매자센터 화면 · 문서 522 · 판 v10.386',
   'v_net := v_gross - v_fee - v_fvat - v_ref + v_in;' in M43 and "WHEN v_sep AND s.type <> 'DIRECT' THEN public.fn_vat10(commission)" in M43 and 'si.goods_amount - si.commission - si.commission_vat' in M43
   and 'st.commission_vat AS "commissionVat"' in ST and 'i.commission_vat AS "commissionVat"' in SS and 'data-settle-vat=' in HS and 'data-settle-vat=' in SE
   and '수수료 부가세' in doc('522_') and VT >= (10, 386), VER)
MEM, BUY = 'seller@x.com', 'buyer@x.com'
td = datetime.date.today(); P1 = td - datetime.timedelta(days=td.weekday() + 7 * 33)   # 33주 전 월요일(1168 의 20주와 겹치지 않게)
P2 = P1 + datetime.timedelta(days=7)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree(MEM, PW); consent_ok.agree(BUY, PW)
    v0 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'vat.separate_from'")
    t0 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'mall.tenant'")
    ta0 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'mall.tenant_apply'")
    mid = psql(f"SELECT id FROM accounts WHERE email = '{MEM}'"); bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
    biv0 = psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{bid}'")
    T_ = login('admin@x.com'); TM = login(MEM); TB = login(BUY)
    try:
        setvat('2000-01-03')
        psql(f"UPDATE hlt_sellers SET account_id = NULL WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')")
        psql("UPDATE site_settings SET value = 'on' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{bid}'")
        sid = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, status, applied_at, reviewed_at, submerchant_id, commission_rate, ship_fee, return_ship_fee) "
                   f"VALUES ('TN-T1386-' || to_char(clock_timestamp(), 'HH24MISS'), '{mid}', 'TENANT', '시험 판매자 1386', true, 'ACTIVE', now(), now(), 'SUB-T1386', 12, 0, 6000) RETURNING id").splitlines()[0]
        scode = psql(f"SELECT code FROM hlt_sellers WHERE id = '{sid}'"); code = f'{scode}-TEA'
        call('POST', '/me/health/seller/products', {'code': 'TEA', 'name': '시험 차 1386', 'categoryCode': 'HLT_FOOD', 'notice': {'제조사': '시험식품'}, 'options': [{'price': 25000, 'stock': 10}]}, TM)
        call('POST', f'/me/health/seller/products/{code}/submit', None, TM); call('POST', f'/admin/health/product-reviews/{code}', {'decision': 'APPROVE'}, T_)
        call('POST', f'/me/health/seller/products/{code}/status', {'status': 'ON_SALE'}, TM)
        addr = call('GET', '/me/health/addresses', None, TB)
        aid = (addr[0] if isinstance(addr, list) and addr else {}).get('id') or call('POST', '/me/health/addresses', {'receiver': '구매자', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, TB).get('id')
        o1 = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': code, 'qty': 1}]}, TB); ono = o1.get('orderNo')
        psql(f"UPDATE hlt_orders SET status = 'DELIVERED', created_at = now() - interval '13 days', paid_at = now() - interval '12 days', shipped_at = now() - interval '10 days', delivered_at = now() - interval '9 days' WHERE order_no = '{ono}'")
        c1 = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P1)}, T_)
        st1 = psql(f"SELECT gross_amount || '|' || commission || '|' || commission_vat || '|' || net_amount || '|' || (SELECT string_agg(i.commission_vat || ':' || i.net_amount, ',') FROM hlt_settlement_items i WHERE i.settlement_id = s.id) "
                   f"FROM hlt_settlements s WHERE seller_id = '{sid}' AND period_from = '{P1}'")
        ms = call('GET', '/me/health/seller/settlements', None, TM); rows = ms if isinstance(ms, list) else []
        mine = next((x for x in rows if str(x.get('from', ''))[:10] == str(P1)), {})
        oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{ono}'")
        psql(f"INSERT INTO hlt_returns (order_id, kind, reason, state, decided_at, opened) VALUES ('{oid}', 'RETURN', 'DEFECT', 'APPROVED', now(), false)")
        c2 = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P2)}, T_)
        st2 = psql(f"SELECT refund_amount || '|' || net_amount || '|' || status || '|' || (SELECT string_agg(i.commission_vat || ':' || i.net_amount, ',') FROM hlt_settlement_items i WHERE i.settlement_id = s.id AND i.kind = 'REFUND') "
                   f"FROM hlt_settlements s WHERE seller_id = '{sid}' AND period_from = '{P2}'")
        ok('② 정산 — 25,000 · 수수료 12% 3,000 · 수수료 부가세 300 · 받을 돈 21,700 · 판매자 API commissionVat 300 · 정산 뒤 반품 → 21,700 되돌림(수수료 부가세 포함) · 이월',
           st1 == '25000|3000|300|21700|300:21700' and float(mine.get('commissionVat') or 0) == 300 and st2 == '21700|-21700|CARRIED|300:-21700',
           f"{c1} · {st1} · 판매자 {mine.get('commissionVat')} · {c2} · {st2}")
    finally:
        setvat(v0)
        # 공용 시험 회원(MEM)에서 판매자를 떼어 둠 — 주문이 달려 지울 수 없어 옛 시험 1165 · 1166 이 새 판매자를 못 만듦
        psql(f"UPDATE hlt_sellers SET account_id = NULL WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')")
        psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {TAG} 되돌림', true); UPDATE site_settings SET value = '{t0}' WHERE key = 'mall.tenant'; UPDATE site_settings SET value = '{ta0}' WHERE key = 'mall.tenant_apply'; COMMIT;")
        psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not biv0 else repr(biv0))} WHERE id = '{bid}'")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
