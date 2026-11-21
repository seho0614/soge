"""v10.540 (docs/678) 소개몰 공동구매 — 대표 11/20 「(53) ③ 공동구매」
  ① (코드) D283 공동구매 · 참여 · 결제 참여 수 · 발송 막기 · 알림 · mkx.groupbuy off · 정기 작업 · 기존 취소 신청 · 공개 목록 · 참여 · 메뉴 · 화면 · 문서
  ② (API · DB) 꺼짐 · 할인가 · 열기 · 같은 옵션 · 참여 · 두 번 · 수량 · 할인가 주문 · 확정 전 발송 막음 · 확정 · 알림 · 운영 취소(취소 신청) · 기한 지남 실패 · 운영 알림 · 회원 403 · 권한 주소
  ③ (화면) 소개몰 › 공동구매 · 소개몰 공동구매 목록(SITE 있을 때)
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
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로) · 값 없음은 NULL"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def new_member(tag, addr=True):
    """새 회원(본인인증 · 약관 동의) · 토큰 · 배송지 — 공유 회원(buyer)을 건드리지 않음"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    tok = login(em)
    adr = call('POST', '/me/health/addresses', {'receiver': '시험', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, tok).get('id') if addr else None
    return em, aid, tok, adr


def direct_product(min_stock=5):
    """직판 · 판매 중 · 켠 옵션 하나(재고 넉넉) 상품 코드 · 옵션 번호 · 재고 · 값"""
    code = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                f"AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > {min_stock}) = 1 "
                f"AND NOT EXISTS (SELECT 1 FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock <= {min_stock}) ORDER BY p.code LIMIT 1")
    opt = psql(f"SELECT o.id || '|' || o.stock || '|' || o.price FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE p.code = '{code}' AND o.is_active LIMIT 1") if code else ''
    return code, (opt.split('|') + ['', '', ''])[:3]


def marketing(aid, codes="'MARKETING'"):
    return psql(f"INSERT INTO term_agreements (account_id, term_code, term_version, agreed) SELECT '{aid}', code, version, true FROM v_terms_current WHERE code IN ({codes})")


SJ = rd('spec/screens.json')
M83 = migr('D283_')
stamp = int(time.time()) % 1000000


GB, CT, UI, MN, AP, GP, GJ = (rd('src/modules/mkx/groupbuy.ts'), rd('src/modules/mkx/mkx.controller.ts'), rd('web/src/app/admin/Mkx.tsx'), rd('web/src/lib/adminMenu.ts'),
                              rd('web/src/App.tsx'), rd('site/src/app/health/groupbuys/page.tsx'), rd('site/src/components/mkx/GroupbuyJoin.tsx'))
ok('① 코드 — D283 공동구매 표(할인가 < 정가 · 상태 앞으로만 · 같은 옵션 하나만 모집) · 참여(회원 하나 한 번 · 할인가 주문 한 줄) · 결제 참여 수 함수 · 발송 막기 트리거(hlt_orders) · 알림 확정 · 취소 · '
   'mkx.groupbuy off · 정기 작업 10분 · 실패 → 기존 취소 신청(GROUPBUY_FAILED) · 운영 알림 MKX_GB_FAILED · 공개 목록 · 참여 API · 메뉴 mkx-groupbuy · 화면 MKX-030 · HLT-MKX-010 · 문서 678(법무 확인 끝) · 판 v10.540',
   'CREATE TABLE IF NOT EXISTS public.mkx_groupbuys' in M83 and 'CONSTRAINT ck_mkx_gb_price CHECK (deal_price < list_price)' in M83 and 'uq_mkx_gb_option_open' in M83
   and 'CONSTRAINT uq_mkx_gb_join_member UNIQUE (groupbuy_id, account_id)' in M83 and 'FUNCTION public.fn_mkx_gb_paid(' in M83 and 'trg_mkx_gb_ship_hold' in M83
   and "('MALL_GB_SUCCESS', '소개몰 공동구매 확정', false" in M83 and "('mkx.groupbuy', 'off'" in M83 and "('mkx_groupbuy', 10," in M83
   and "'GROUPBUY_FAILED'" in GB and "'MKX_GB_FAILED'" in GB and 'export async function gbJoin' in GB and "@Post('health/groupbuys/:id/join')" in CT and "@Get('health/groupbuys')" in CT
   and 'export function MkxGroupbuy' in UI and "['mkx-groupbuy', '공동구매']" in MN and "{tab === 'mkx-groupbuy' && <MkxGroupbuy />}" in AP and 'SB-HLT-MKX-010' in GP and 'data-mkx-gb-join' in GJ
   and '"SB-ADM-MKX-030"' in SJ and '"SB-HLT-MKX-010"' in SJ and '법무 확인 끝' in doc('678_') and VT >= (10, 540), VER)

if API and DB:
    TS = login('admin@x.com')
    keys = ('mall.order_open', 'mkx.groupbuy')
    s0 = {k: getset(k) for k in keys}
    T0 = psql("SELECT clock_timestamp()::text")
    gids, accs, toks, opt, stock0 = [], [], [], '', ''
    try:
        dp, (opt, stock0, price) = direct_product(10)
        price = int(price or 0)
        setting('mall.order_open', 'on', '1540'); setting('mkx.groupbuy', 'off', '1540')
        ends = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 7200))
        pub0 = call('GET', '/health/groupbuys', None)
        badp = call('POST', '/admin/mkx/groupbuys', {'productCode': dp, 'optionId': opt, 'title': '시험 1540 비쌈', 'dealPrice': price, 'targetCount': 2, 'endsAt': ends}, TS)
        g1 = call('POST', '/admin/mkx/groupbuys', {'productCode': dp, 'optionId': opt, 'title': f'시험 1540 공동구매 {stamp}', 'dealPrice': price - 100, 'targetCount': 2, 'perMemberMax': 1, 'endsAt': ends}, TS)
        gid = str(g1.get('id') or ''); gids.append(gid)
        o_off = call('POST', f'/admin/mkx/groupbuys/{gid}/open', None, TS)
        setting('mkx.groupbuy', 'on', '1540')
        o1 = call('POST', f'/admin/mkx/groupbuys/{gid}/open', None, TS)
        g2 = call('POST', '/admin/mkx/groupbuys', {'productCode': dp, 'optionId': opt, 'title': '시험 1540 둘째', 'dealPrice': price - 100, 'targetCount': 3, 'endsAt': ends}, TS)
        gid2 = str(g2.get('id') or ''); gids.append(gid2)
        dup = call('POST', f'/admin/mkx/groupbuys/{gid2}/open', None, TS)
        fixed = call('PUT', f'/admin/mkx/groupbuys/{gid}', {'dealPrice': price - 200}, TS)
        joins = []
        for tag in ('1540a', '1540b'):
            em, aid, tok, adr = new_member(tag)
            accs.append(aid); toks.append(tok)
            joins.append(call('POST', f'/health/groupbuys/{gid}/join', {'qty': 1}, tok))
        twice = call('POST', f'/health/groupbuys/{gid}/join', {'qty': 1}, toks[0])
        qty = call('POST', f'/health/groupbuys/{gid}/join', {'qty': 2}, toks[1])
        nos = [j.get('orderNo') or '' for j in joins]
        unit = psql(f"SELECT string_agg(i.unit_price::text, ',') FROM hlt_order_items i JOIN hlt_orders o ON o.id = i.order_id WHERE o.order_no IN ('{nos[0]}', '{nos[1]}')")
        pub1 = call('GET', '/health/groupbuys', None)
        row = next((x for x in (pub1.get('items') or []) if x.get('id') == gid), {})
        psql(f"UPDATE hlt_orders SET status = 'PAID', paid_at = now() WHERE order_no = '{nos[0]}'")
        run1 = call('POST', '/admin/mkx/groupbuys/run', None, TS)
        st1 = psql(f"SELECT state FROM mkx_groupbuys WHERE id = {gid or 0}")
        hold = psql(f"UPDATE hlt_orders SET status = 'PREPARING' WHERE order_no = '{nos[0]}'")
        psql(f"UPDATE hlt_orders SET status = 'PAID', paid_at = now() WHERE order_no = '{nos[1]}'")
        run2 = call('POST', '/admin/mkx/groupbuys/run', None, TS)
        st2 = psql(f"SELECT state FROM mkx_groupbuys WHERE id = {gid or 0}")
        nsucc = psql(f"SELECT count(*) FROM notifications WHERE event_code = 'MALL_GB_SUCCESS' AND account_id IN ('{accs[0]}', '{accs[1]}')")
        ship = psql(f"UPDATE hlt_orders SET status = 'PREPARING' WHERE order_no = '{nos[0]}'")
        psql(f"UPDATE hlt_orders SET status = 'PAID' WHERE order_no = '{nos[0]}'")
        mine = call('GET', '/me/health/groupbuys', None, toks[0])
        cshort = call('POST', f'/admin/mkx/groupbuys/{gid}/cancel', {'reason': 'x'}, TS)
        canc = call('POST', f'/admin/mkx/groupbuys/{gid}/cancel', {'reason': '시험 1540 취소'}, TS)
        rets = psql(f"SELECT count(*) FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id WHERE o.order_no IN ('{nos[0]}', '{nos[1]}') AND r.kind = 'CANCEL' AND r.reason = 'GROUPBUY_FAILED' AND r.state = 'REQUESTED'")
        nfail = psql(f"SELECT count(*) FROM notifications WHERE event_code = 'MALL_GB_FAILED' AND account_id IN ('{accs[0]}', '{accs[1]}')")
        o2 = call('POST', f'/admin/mkx/groupbuys/{gid2}/open', None, TS)
        j3 = call('POST', f'/health/groupbuys/{gid2}/join', {'qty': 1}, toks[0])
        past = psql(f"SET session_replication_role = replica; UPDATE mkx_groupbuys SET ends_at = now() - interval '1 minute' WHERE id = {gid2 or 0}")
        run3 = call('POST', '/admin/mkx/groupbuys/run', None, TS)
        st3 = psql(f"SELECT state || '|' || (SELECT count(*) FROM mkx_gb_joins WHERE groupbuy_id = {gid2 or 0} AND cancel_return_id IS NOT NULL) FROM mkx_groupbuys WHERE id = {gid2 or 0}")
        alert = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'MKX_GB_FAILED' AND detail->>'key' = 'gb-{gid2}'")
        a403 = call('GET', '/admin/mkx/groupbuys', None, toks[0])
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'mkx-groupbuy'")
        ok('② 공동구매 — 꺼짐이면 공개 목록 빈 · 할인가 ≥ 정가 422 · 초안 · 꺼짐 열기 422 · 켜고 열기 · 같은 옵션 둘째 409 · 연 뒤 값 409 · 참여 2 · 두 번 409 · 수량 넘침 422 · 할인가 주문 · 확정 전 발송 막음 · 공개 목록 · '
           '결제 1 → 모집 중 · 결제 2 → 확정 · 확정 알림 2 · 확정 뒤 발송 됨 · 내 참여 · 짧은 사유 400 · 운영 취소 → 취소 신청 2 · 취소 알림 2 · 둘째 열기 · 참여 · 기한 지남 → 실패 · 취소 신청 1 · 운영 알림 · 회원 403 · 권한 주소 7',
           bool(dp) and pub0.get('on') is False and badp.get('code') == 'MKX_GB_PRICE' and bool(gid) and o_off.get('code') == 'MKX_GB_OFF' and o1.get('ok') is True
           and dup.get('_err') == 409 and dup.get('code') == 'MKX_GB_DUP' and fixed.get('_err') == 409 and all(j.get('ok') is True for j in joins)
           and twice.get('code') == 'MKX_GB_JOINED' and qty.get('_err') in (400, 422) and unit == f'{price - 100},{price - 100}' and 'MKX_GB_HOLD' in hold
           and row.get('targetCount') == 2 and st1 == 'OPEN' and (run2.get('success') or 0) >= 1 and st2 == 'SUCCESS' and nsucc == '2' and '!' not in ship
           and any(x.get('id') == gid for x in (mine if isinstance(mine, list) else [])) and cshort.get('_err') == 400 and canc.get('filed') == 2 and rets == '2' and nfail == '2'
           and o2.get('ok') is True and j3.get('ok') is True and '!' not in past and st3 == 'FAILED|1' and alert == '1' and a403.get('_err') == 403 and rmap == '7',
           f"{dp} {pub0.get('on')} {badp.get('code')} {gid} {o_off.get('code')} {o1.get('ok') or o1} · {dup.get('code')} {fixed.get('code')} {[j.get('ok') or j.get('code') for j in joins]} {twice.get('code')} {qty.get('_err')} "
           f"{unit} {hold[-40:]} · {row.get('targetCount')} {st1} {st2} {nsucc} {ship[-30:]} · {cshort.get('_err')} {canc.get('filed') or canc} {rets} {nfail} · {o2.get('ok') or o2} {j3.get('ok') or j3} {st3} {alert} · {a403.get('_err')} {rmap}")
    finally:
        g = ','.join(x for x in gids if x.isdigit()) or '0'
        acc = ','.join(f"'{x}'" for x in accs if x) or "'00000000-0000-0000-0000-000000000000'"
        psql(f"SET session_replication_role = replica; "
             f"CREATE TEMP TABLE t1540 AS SELECT order_id FROM mkx_gb_joins WHERE groupbuy_id IN ({g}); "
             f"DELETE FROM mkx_gb_joins WHERE groupbuy_id IN ({g}); DELETE FROM mkx_groupbuys WHERE id IN ({g}); "
             f"DELETE FROM hlt_returns WHERE order_id IN (SELECT order_id FROM t1540); DELETE FROM hlt_payments WHERE order_id IN (SELECT order_id FROM t1540); "
             f"DELETE FROM hlt_order_items WHERE order_id IN (SELECT order_id FROM t1540); DELETE FROM hlt_orders WHERE id IN (SELECT order_id FROM t1540); "
             f"DELETE FROM notifications WHERE account_id IN ({acc}) AND event_code IN ('MALL_GB_SUCCESS', 'MALL_GB_FAILED'); "
             f"DELETE FROM ops_alerts WHERE alert_code IN ('MKX_GB_FAILED', 'MKX_GB_CANCEL_FAIL') AND raised_at >= '{T0}';")
        if opt and stock0:
            psql(f"SET session_replication_role = replica; UPDATE hlt_product_options SET stock = {int(stock0)} WHERE id = '{opt}'")
        for k, x in s0.items():
            setting(k, x or None, '1540 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/mkx-groupbuy', lambda pg, seen: seen.update(n=pg.locator('[data-mkx-groupbuy]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 공동구매(초안 · 목록 · 화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        def run_site(b, seen, perr):
            ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
            ps.goto(SITE + '/health/groupbuys', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['page'] = ps.locator('[data-mkx-gb-page]').count()
        r2 = ui(run_site)
        if r2 is not None:
            seen2, perr2 = r2
            ok('③ 화면 — 소개몰 공동구매(로그인 없이 · 화면 오류 없음)', seen2.get('page') == 1 and not perr2, f"{seen2} {perr2[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
