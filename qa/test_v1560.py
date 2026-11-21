"""v10.560 (D290 · docs/701) 9차 반품 배송비 정산 — 대표 11/21 승인 · 「수수료 없음」
  ① (코드) D290 정산 항목 RETURN_SHIP · 반품 한 건에 한 번 · 정산서 반품 배송비 칸 · 지급액 식 · 검사 두 곳 · 월 정산서 셈 · 서버 · 운영 화면 · 판매자센터 · 이름표 · 문서 701 · 판
  ② (DB · API) 입점 주문 회원 사정 반품(REFUNDED) → 마감 → RETURN_SHIP 한 줄(금액 = ship_deduction · 수수료 0) · 두 번 마감해도 한 줄 · 정산 뒤 반품 = REFUND(−) + RETURN_SHIP(+) · 하자 반품(차감 0) · 직판 반품은 없음 · DB 가 막는 것 · 월 정산서 셈 · 운영 목록
  (두 번 돌아도 통과 — 시험 판매자 「시험1560 …」 · 주문 T1560-… · 먼 앞날 4주 정산서는 시작 · 끝에 replica 로 지움)
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


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''

"""시험 몸통"""
M90 = migr('D290_')
ST = rd('src/modules/health/health-settle.service.ts'); SS = rd('src/modules/health/health-seller.service.ts'); SX = rd('src/modules/slx/statements.ts')
WS = rd('web/src/app/admin/HealthSettle.tsx'); WX = rd('web/src/app/admin/Slx.tsx')
SE = rd('site/src/components/health/SellerSettlements.tsx'); SP = rd('site/src/app/health/seller/center/statements/page.tsx')
KO = rd('site/src/i18n/messages/ko/hlt.json'); EN = rd('site/src/i18n/messages/en/hlt.json')
KS = rd('site/src/i18n/messages/ko/slx.json'); ES = rd('site/src/i18n/messages/en/slx.json')
NEWCOLS = re.findall(r'ADD COLUMN IF NOT EXISTS (\w+)', M90)
ok('① 코드 — D290 정산 항목 RETURN_SHIP(CHECK · 반품 한 건에 한 번 고유 색인 · 수수료 0 검사) · 정산서 칸 return_ship_amount · 지급액 식 · 검사 두 곳 · 입점만 · 월 정산서 셈 · 새 칸 INV-9 낱말 없음',
   "'RETURN_SHIP'::text" in M90 and 'hlt_stl_item_kind_check' in M90 and 'ux_hltsi_return_ship' in M90 and "WHERE kind = 'RETURN_SHIP'" in M90
   and 'ck_hltsi_return_ship' in M90 and 'commission = 0 AND commission_vat = 0 AND net_amount = goods_amount' in M90
   and 'v_net := v_gross - v_fee - v_fvat - v_ref + v_in + v_rs;' in M90 and M90.count('+ NEW.carried_in + NEW.return_ship_amount THEN') == 2
   and "h.type IN ('TENANT', 'BRAND')" in M90 and "r.state = 'REFUNDED' AND r.ship_deduction > 0" in M90 and 'v_hlt_return_ship_ready' in M90
   and "'returnShip', coalesce(sum(st.return_ship_amount), 0)::bigint" in M90 and 'return_ship_amount = (c->>\'returnShip\')::bigint' in M90
   and NEWCOLS and not any(w in c for c in NEWCOLS for w in ('deduct', 'commission', 'platform_fee', 'withhold', 'take_rate')), str(NEWCOLS))
ok('① 코드 — 서버(운영 목록 · 대기 · 판매자센터 · 월 정산서 · 메일) · 옛 칸 글자 그대로',
   'st.return_ship_amount AS "returnShip"' in ST and 'FROM v_hlt_return_ship_ready' in ST and 'st.return_ship_amount AS "returnShip"' in SS
   and "pick('return_ship_amount', 'returnShip')" in SX and 'returnShip: n(l.returnShip)' in SX and '반품 배송비: ' in SX
   and 'st.commission_vat AS "commissionVat"' in ST and 'i.commission_vat AS "commissionVat"' in SS, '')
ok('① 화면 — 운영 정산서 「반품 배송비」 칸 · 대기 줄 · 월 정산서 인쇄 칸 · 판매자센터 정산 · 월 정산서 · 이름표(한국어 · 영어)',
   '<th>반품 배송비</th>' in WS and 'data-settle-return-ship=' in WS and 'data-return-ship-ready=' in WS and 'data-settle-vat=' in WS
   and WX.count('<th>반품 배송비</th>') == 2 and 'colspan="9"' in WX
   and "'RETURN_SHIP'" in SE and "t('returnShip')" in SE and 'data-settle-return-ship=' in SE and 'data-seller-settlements' in SE
   and SP.count("ts('returnShip')") == 2 and 'colSpan={8}' in SP
   and '"RETURN_SHIP": "반품 배송비"' in KO and '"returnShip": "반품 배송비"' in KO and '"RETURN_SHIP": "Return shipping fee"' in EN and '"returnShip": "Return shipping"' in EN
   and '"returnShip": "반품 배송비"' in KS and '"returnShip": "Return shipping"' in ES, '')
D701 = doc('701_')
ok('① 문서 701 · 판 v10.560', 'RETURN_SHIP' in D701 and '스냅샷' in D701 and '직판' in D701 and '이월' in D701 and VT >= (10, 560), VER)

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    T_ = login('admin@x.com')
    # 아주 먼 앞날의 월요일 4주 — 다른 시험 · 정기 마감(지난주)과 겹치지 않음 · 운영 목록(최근 순 50줄) 맨 위
    td = datetime.date.today(); P1 = td - datetime.timedelta(days=td.weekday()) + datetime.timedelta(days=7 * 520)
    P2, P3, P4 = (P1 + datetime.timedelta(days=7 * k) for k in (1, 2, 3))
    PER = ', '.join(f"'{p}'" for p in (P1, P2, P3, P4))
    ON = "SELECT id FROM hlt_orders WHERE order_no LIKE 'T1560-%'"
    CLEAN = ("SET session_replication_role = replica; "
             f"DELETE FROM hlt_settlement_items WHERE settlement_id IN (SELECT id FROM hlt_settlements WHERE period_from IN ({PER})) OR order_id IN ({ON}); "
             f"DELETE FROM hlt_settlements WHERE period_from IN ({PER}) OR seller_id IN (SELECT id FROM hlt_sellers WHERE name LIKE '시험1560%'); "
             f"DELETE FROM hlt_returns WHERE order_id IN ({ON}); DELETE FROM hlt_order_items WHERE order_id IN ({ON}); "
             "DELETE FROM hlt_orders WHERE order_no LIKE 'T1560-%'; DELETE FROM hlt_sellers WHERE name LIKE '시험1560%';")
    psql(CLEAN)
    try:
        bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
        prod = psql("SELECT id FROM hlt_products ORDER BY created_at LIMIT 1")
        RP = 'SET session_replication_role = replica; '
        sa = psql(RP + "INSERT INTO hlt_sellers (code, type, name, personal, status, applied_at, reviewed_at, submerchant_id, commission_rate, ship_fee, return_ship_fee) "
                  f"VALUES ('TN-T1560-{STAMP}', 'TENANT', '시험1560 입점 판매자', true, 'ACTIVE', now(), now(), 'SUB-T1560', 12, 0, 6000) RETURNING id").splitlines()[0]
        sd = psql("SELECT id FROM hlt_sellers WHERE type = 'DIRECT' ORDER BY code LIMIT 1") or psql(
            RP + f"INSERT INTO hlt_sellers (code, type, name, status, commission_rate) VALUES ('DR-T1560-{STAMP}', 'DIRECT', '시험1560 직판', 'ACTIVE', 0) RETURNING id").splitlines()[0]

        def order(seller, k, amount):
            return psql(RP + "INSERT INTO hlt_orders (order_no, account_id, goods_amount, ship_fee, total, status, pay_method, paid_at, shipped_at, delivered_at, created_at, seller_id) "
                        f"VALUES ('T1560-{STAMP}-{k}', '{bid}', {amount}, 0, {amount}, 'DELIVERED', 'CARD', now() - interval '24 days', now() - interval '22 days', now() - interval '20 days', now() - interval '25 days', '{seller}') RETURNING id").splitlines()[0]

        def ret(oid, reason, refund, ded):
            return psql(RP + "INSERT INTO hlt_returns (order_id, kind, reason, state, decided_at, opened, refund_amount, refunded_at, ship_deduction) "
                        f"VALUES ('{oid}', 'RETURN', '{reason}', 'REFUNDED', now() - interval '16 days', false, {refund}, now() - interval '15 days', {ded}) RETURNING id").splitlines()[0]

        o1 = order(sa, 1, 30000); r1 = ret(o1, 'CHANGE_MIND', 24000, 6000)   # 정산 전 회원 사정 반품(SALE 없음)
        o2 = order(sa, 2, 50000)                                              # 정산될 판매 → 정산 뒤 회원 사정 반품
        if prod and not prod.startswith('!'):
            psql(RP + "INSERT INTO hlt_order_items (order_id, product_id, qty, unit_price, amount, withdrawal_code, commission_rate, commission_amount) "
                 f"VALUES ('{o2}', '{prod}', 1, 50000, 50000, 'GENERAL', 12, 6000)")
        o3 = order(sa, 3, 20000); r3 = ret(o3, 'DEFECT', 20000, 0)           # 하자 반품 — 차감 0
        o4 = order(sd, 4, 30000); r4 = ret(o4, 'CHANGE_MIND', 24000, 6000)   # 직판 회원 사정 반품 — 회사 몫
        view0 = psql(f"SELECT string_agg(CASE return_id WHEN '{r1}' THEN 'r1' WHEN '{r3}' THEN 'r3' WHEN '{r4}' THEN 'r4' END, ',') FROM v_hlt_return_ship_ready WHERE return_id IN ('{r1}', '{r3}', '{r4}')")
        lst0 = call('GET', '/admin/health/settlements', None, T_)
        ok('② 대기 — 정산할 반품 배송비 보기에 입점 회원 사정 반품만(하자 · 직판 없음) · 운영 목록 returnShip 대기 1건 이상',
           view0 == 'r1' and int((lst0.get('returnShip') or {}).get('n') or 0) >= 1, f"{view0} · {lst0.get('returnShip') or lst0}")

        c1 = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P1)}, T_)
        s1 = psql(f"SELECT s.id || '|' || s.gross_amount || '|' || s.return_ship_amount || '|' || (s.net_amount = s.gross_amount - s.commission - s.commission_vat - s.refund_amount + s.carried_in + s.return_ship_amount) "
                  f"|| '|' || (SELECT count(*) FROM hlt_settlement_items i WHERE i.settlement_id = s.id AND i.kind = 'SALE') FROM hlt_settlements s WHERE s.seller_id = '{sa}' AND s.period_from = '{P1}'")
        st1 = s1.split('|')[0] if '|' in s1 else ''
        i1 = psql(f"SELECT count(*) || '|' || min(i.goods_amount) || '|' || max(i.commission) || '|' || max(i.commission_vat) || '|' || min(i.net_amount) || '|' || min(i.order_id::text) "
                  f"FROM hlt_settlement_items i WHERE i.return_id = '{r1}' AND i.kind = 'RETURN_SHIP'")
        ok('② 정산 전 반품 — 마감하면 RETURN_SHIP 한 줄(금액 = 뺀 배송비 6,000 · 수수료 0 · 수수료 부가세 0) · 정산서 반품 배송비 6,000 · 지급액 식 맞음 · 판매 SALE 1',
           c1.get('created', 0) >= 1 and s1.split('|')[1:] == ['50000', '6000', 'true', '1'] and i1 == f'1|6000|0|0|6000|{o1}', f"{c1} · {s1} · {i1}")

        c1b = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P1)}, T_)
        c2 = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P2)}, T_)
        twice = psql(f"SELECT (SELECT count(*) FROM hlt_settlement_items WHERE return_id = '{r1}' AND kind = 'RETURN_SHIP') || '|' || (SELECT count(*) FROM hlt_settlements WHERE seller_id = '{sa}')")
        ok('② 두 번 마감 — 같은 주 다시 · 다음 주 마감에도 반품 배송비는 한 줄 · 이 판매자 정산서 1장', twice == '1|1', f"{c1b} · {c2} · {twice}")

        dup = psql("BEGIN; INSERT INTO hlt_settlement_items (settlement_id, order_id, goods_amount, commission, commission_vat, net_amount, kind, return_id) "
                   f"VALUES ('{st1}', '{o1}', 6000, 0, 0, 6000, 'RETURN_SHIP', '{r1}'); ROLLBACK;") if st1 else ''
        fee = psql("BEGIN; INSERT INTO hlt_settlement_items (settlement_id, order_id, goods_amount, commission, commission_vat, net_amount, kind, return_id) "
                   f"VALUES ('{st1}', '{o3}', 6000, 600, 0, 5400, 'RETURN_SHIP', '{r3}'); ROLLBACK;") if st1 else ''
        grd = psql(f"BEGIN; UPDATE hlt_settlements SET return_ship_amount = return_ship_amount + 1 WHERE id = '{st1}'; ROLLBACK;") if st1 else ''
        ok('② DB 가 막음 — 같은 반품 RETURN_SHIP 두 번(고유 색인) · 반품 배송비에 수수료(검사) · 지급액 식이 안 맞는 정산서(정산 줄 검사)',
           'ux_hltsi_return_ship' in dup and 'ck_hltsi_return_ship' in fee and '맞지 않습니다' in grd, f"{dup[-70:]} · {fee[-70:]} · {grd[-70:]}")

        r2 = ret(o2, 'CHANGE_MIND', 44000, 6000)   # 정산 뒤 회원 사정 반품
        sale_net = psql(f"SELECT net_amount FROM hlt_settlement_items WHERE order_id = '{o2}' AND kind = 'SALE'")
        c3 = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P3)}, T_)
        s3 = psql(f"SELECT s.refund_amount || '|' || s.return_ship_amount || '|' || (s.net_amount = s.return_ship_amount - s.refund_amount + s.carried_in) || '|' || s.status "
                  f"|| '|' || (SELECT count(*) FROM hlt_settlement_items i WHERE i.settlement_id = s.id AND i.kind = 'REFUND' AND i.order_id = '{o2}') "
                  f"|| '|' || (SELECT count(*) FROM hlt_settlement_items i WHERE i.settlement_id = s.id AND i.kind = 'RETURN_SHIP' AND i.return_id = '{r2}') FROM hlt_settlements s WHERE s.seller_id = '{sa}' AND s.period_from = '{P3}'")
        ok('② 정산 뒤 반품 — 다음 회차에 REFUND(판매자 몫 되돌림) + RETURN_SHIP(+6,000) · 지급액 = 6,000 − 되돌림 → 음수면 이월',
           s3 == f"{sale_net}|6000|true|CARRIED|1|1", f"{c3} · {sale_net} · {s3}")

        none = psql(f"SELECT (SELECT count(*) FROM hlt_settlement_items WHERE return_id IN ('{r3}', '{r4}') OR (order_id IN ('{o3}', '{o4}') AND kind = 'RETURN_SHIP')) || '|' || "
                    f"(SELECT count(*) FROM v_hlt_return_ship_ready WHERE return_id IN ('{r1}', '{r2}', '{r3}', '{r4}'))")
        ok('② 하자 반품(차감 0) · 직판 반품은 반품 배송비 없음 · 마감 뒤 대기 0', none == '0|0', none)

        ym = str(P1)[:7]
        calc = psql(f"SELECT (fn_hlt_statement_calc('{sa}', '{ym}')->>'returnShip') || '|' || (SELECT coalesce(sum(return_ship_amount), 0) FROM hlt_settlements WHERE seller_id = '{sa}' AND to_char(period_from, 'YYYY-MM') = '{ym}') "
                    f"|| '|' || (fn_hlt_statement_calc('{sa}', '{ym}')->'lines'->0 ? 'returnShip')")
        cp = calc.split('|')
        ok('② 월 정산서 셈 — returnShip = 그 달 주 정산서 반품 배송비 합(6,000 이상) · 주별 줄에도 returnShip', len(cp) == 3 and cp[0] == cp[1] and cp[0].isdigit() and int(cp[0]) >= 6000 and cp[2] == 'true', calc)

        lst = call('GET', '/admin/health/settlements', None, T_)
        mine = [x for x in (lst.get('items') or []) if x.get('seller') == f'TN-T1560-{STAMP}']
        p1row = next((x for x in mine if str(x.get('from', ''))[:10] == str(P1)), {})
        ok('② API — 운영 정산서 목록에 returnShip(이 판매자 첫 주 6,000)', int(p1row.get('returnShip') or 0) == 6000 and len(mine) == 2, f"{len(mine)} · {p1row.get('returnShip')}")

        if ADMIN_WEB:
            r = admin_page('/#/hlt-settle', lambda pg, seen: seen.update(th=pg.locator('th', has_text='반품 배송비').count(), cell=pg.locator('[data-settle-return-ship="6000"]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 운영 화면 소개몰 정산 — 「반품 배송비」 칸 · 이 판매자 +6,000 줄 · 오류 없음', seen.get('th', 0) >= 1 and seen.get('cell', 0) >= 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        psql(CLEAN)
    left = psql(f"SELECT (SELECT count(*) FROM hlt_orders WHERE order_no LIKE 'T1560-%') + (SELECT count(*) FROM hlt_sellers WHERE name LIKE '시험1560%') + (SELECT count(*) FROM hlt_settlements WHERE period_from IN ({PER}))")
    ok('끝 — 시험 판매자 · 주문 · 반품 · 정산서(먼 앞날 4주) 모두 지움', left == '0', left)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
