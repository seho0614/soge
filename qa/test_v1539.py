"""v10.539 (docs/677) 소개몰 재구매 알림 — 대표 11/20 「(53) ② 재구매 알림」
  ① (코드) D283 규칙 · 알릴 날 보기 · 기록 · 광고 알림 MARKETING_MALL_REBUY · mkx.rebuy off · 동의 · 밤 · 다시 삼 · 정기 작업 · 메뉴 · 화면 · 문서
  ② (API · DB) 규칙 검사 422 · 404 · 저장 · 알릴 날 · 꺼짐 422 · 동의 회원 SENT · 동의 없음 SKIPPED(밤이면 안 보냄) · 광고 감시 0 · 한 번만 · 기록 지우기 막음 · 회원 403 · 권한 주소
  ③ (화면) 소개몰 › 재구매 알림
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


RB, CT, UI, MN, AP, JB, NJ = (rd('src/modules/mkx/rebuy.ts'), rd('src/modules/mkx/mkx.controller.ts'), rd('web/src/app/admin/Mkx.tsx'), rd('web/src/lib/adminMenu.ts'),
                              rd('web/src/App.tsx'), rd('src/modules/mkx/jobs.ts'), rd('spec/notifications.json'))
ok('① 코드 — D283 규칙 표(사용 일수 7 ~ 730 · 며칠 전 < 사용 일수) · 알릴 날 보기(개월 옵션 × 30일 먼저 · × 수량 · 한국 날짜) · 기록(품목 하나에 한 번 · 쌓기만) · 알림 MARKETING_MALL_REBUY(광고 · 끌 수 있음 · 제목 (광고)) · '
   'mkx.rebuy off · 하루 300 · 늦게 7일 · 동의 fn_consent_at · 밤 안 함 · 다시 삼 건너뜀 · 회원 하루 한 통 · 정기 작업 mkx_daily 10:05 · 메뉴 mkx-rebuy · 화면 MKX-020 · 알림 정본 · 문서 677 · 판 v10.539',
   'CREATE TABLE IF NOT EXISTS public.mkx_rebuy_rules' in M83 and 'CREATE OR REPLACE VIEW public.v_mkx_rebuy_due' in M83 and 'i.months * 30 ELSE r.use_days END) * i.qty' in M83
   and 'CONSTRAINT uq_mkx_rebuy_item UNIQUE (order_item_id)' in M83 and "('MARKETING_MALL_REBUY', '소개몰 재구매 안내(광고)', true, false" in M83 and "'(광고) 다시 주문할 때예요" in M83
   and "('mkx.rebuy', 'off'" in M83 and "('mkx.rebuy_daily_max', '300'" in M83 and "('mkx.rebuy_late_days', '7'" in M83 and "('mkx_daily', 1440, 10, 5" in M83
   and "fn_consent_at(d.account_id, 'MARKETING', now())" in RB and "'REBOUGHT'" in RB and 'nightKst()' in RB and 'doneToday' in RB and 'rebuyRun(db)' in JB
   and "@Put('rebuy/rules/:code')" in CT and 'export function MkxRebuy' in UI and "['mkx-rebuy', '재구매 알림']" in MN and "{tab === 'mkx-rebuy' && <MkxRebuy />}" in AP
   and '"code":"MARKETING_MALL_REBUY"' in NJ and '"SB-ADM-MKX-020"' in SJ and '광고' in doc('677_') and VT >= (10, 539), VER)

if API and DB:
    TS = login('admin@x.com')
    keys = ('mall.order_open', 'mkx.rebuy', 'mkx.rebuy_late_days', 'mkx.rebuy_daily_max')
    s0 = {k: getset(k) for k in keys}
    T0 = psql("SELECT clock_timestamp()::text")
    orders, accs, toks, pid, stock0, dp, opt, had_rule = [], [], [], '', '', '', '', ''
    mk_ok = psql("SELECT count(*) FROM v_terms_current WHERE code = 'MARKETING'")
    try:
        dp, (opt, stock0, price) = direct_product()
        pid = psql(f"SELECT id FROM hlt_products WHERE code = '{dp}'") if dp else ''
        had_rule = psql(f"SELECT count(*) FROM mkx_rebuy_rules WHERE product_id = '{pid}'") if pid else ''
        setting('mall.order_open', 'on', '1539'); setting('mkx.rebuy', 'off', '1539'); setting('mkx.rebuy_late_days', '0', '1539'); setting('mkx.rebuy_daily_max', '300', '1539')
        bad = call('PUT', f'/admin/mkx/rebuy/rules/{dp}', {'useDays': 10, 'beforeDays': 10}, TS)
        nf = call('PUT', '/admin/mkx/rebuy/rules/NO-SUCH-1539', {'useDays': 30}, TS)
        r0 = call('PUT', f'/admin/mkx/rebuy/rules/{dp}', {'useDays': 30, 'beforeDays': 7}, TS)
        items = []
        for tag, cons in (('1539a', True), ('1539b', False)):
            em, aid, tok, adr = new_member(tag)
            accs.append(aid); toks.append(tok)
            if cons and mk_ok == '1':
                marketing(aid)
            o = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}]}, tok)
            no = o.get('orderNo') or ''
            oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{no}'") if no else ''
            orders.append(oid)
            psql(f"UPDATE hlt_orders SET status = 'PAID', paid_at = now() WHERE id = '{oid}'") if oid else None
            iid = psql(f"SELECT id FROM hlt_order_items WHERE order_id = '{oid}'") if oid else ''
            days = psql(f"SELECT days FROM v_mkx_rebuy_due WHERE order_item_id = '{iid}'") if iid else ''
            if days.isdigit():
                psql(f"UPDATE hlt_orders SET created_at = now() - make_interval(days => {int(days) - 7}), paid_at = now() - make_interval(days => {int(days) - 7}) WHERE id = '{oid}'")   # 결제 시각이 주문 시각보다 앞서면 DB 가 막음(HLT_TIME_ORDER)
            items.append(iid)
        due = psql(f"SELECT string_agg((notify_on = (now() AT TIME ZONE 'Asia/Seoul')::date)::text, ',') FROM v_mkx_rebuy_due WHERE order_item_id IN ('{items[0]}', '{items[1]}')") if all(items) else ''
        off = call('POST', '/admin/mkx/rebuy/run', None, TS)
        setting('mkx.rebuy', 'on', '1539')
        run = call('POST', '/admin/mkx/rebuy/run', None, TS)
        night = run.get('code') == 'MKX_REBUY_NIGHT'
        sa = psql(f"SELECT state || '|' || coalesce(reason, '') FROM mkx_rebuy_sends WHERE order_item_id = '{items[0]}'") if items[0] else ''
        sb = psql(f"SELECT state || '|' || coalesce(reason, '') FROM mkx_rebuy_sends WHERE order_item_id = '{items[1]}'") if items[1] else ''
        nt = psql(f"SELECT count(*) || '|' || coalesce(min(left(title, 4)), '') FROM notifications WHERE account_id = '{accs[0]}' AND event_code = 'MARKETING_MALL_REBUY'")
        viol = psql(f"SELECT count(*) FROM v_marketing_no_consent WHERE account_id IN ('{accs[0]}', '{accs[1]}')")
        again = call('POST', '/admin/mkx/rebuy/run', None, TS)
        cnt = psql(f"SELECT count(*) FROM mkx_rebuy_sends WHERE order_item_id IN ('{items[0]}', '{items[1]}')")
        ro = psql(f"DELETE FROM mkx_rebuy_sends WHERE order_item_id = '{items[0]}'")
        av = call('GET', '/admin/mkx/rebuy', None, TS)
        rule = next((x for x in (av.get('rules') or []) if x.get('code') == dp), {})
        a403 = call('GET', '/admin/mkx/rebuy', None, toks[1])
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'mkx-rebuy'")
        sent_ok = (sa == 'SENT|' and sb == 'SKIPPED|NO_CONSENT' and nt.startswith('1|(광고)') and cnt == '2') if not night else (sa == '' and sb == '')
        ok('② 재구매 알림 — 며칠 전 ≥ 사용 일수 422 · 없는 상품 404 · 규칙 저장 · 알릴 날 오늘 · 꺼짐 422 · 켬 → 동의 회원 SENT(알림 「(광고)」) · 동의 없는 회원 SKIPPED NO_CONSENT(밤이면 422 · 안 보냄) · 광고 감시 0 · 다시 돌려도 한 번 · 기록 지우기 막음 · 운영 보기 · 회원 403 · 권한 주소 4',
               bool(dp) and bad.get('code') == 'MKX_REBUY_BEFORE' and nf.get('_err') == 404 and r0.get('ok') is True and due == 'true,true'
               and off.get('code') == 'MKX_REBUY_OFF' and (mk_ok != '1' or sent_ok) and viol == '0' and (night or again.get('sent') == 0) and '!' in ro
               and rule.get('useDays') == 30 and a403.get('_err') == 403 and rmap == '4',
               f"{dp} {bad.get('code')} {nf.get('_err')} {r0.get('ok') or r0} {due} · {off.get('code')} {run.get('code') or run.get('sent')} · {sa} {sb} {nt} 감시 {viol} · {again.get('sent')} {cnt} {ro[-30:]} · {rule.get('useDays')} {a403.get('_err')} {rmap}")
    finally:
        ids = ','.join(f"'{x}'" for x in orders if x) or "'00000000-0000-0000-0000-000000000000'"
        acc = ','.join(f"'{x}'" for x in accs if x) or "'00000000-0000-0000-0000-000000000000'"
        psql(f"SET session_replication_role = replica; DELETE FROM mkx_rebuy_sends WHERE created_at >= '{T0}'; DELETE FROM notifications WHERE event_code = 'MARKETING_MALL_REBUY' AND created_at >= '{T0}'; "
             f"DELETE FROM hlt_payments WHERE order_id IN ({ids}); DELETE FROM hlt_order_items WHERE order_id IN ({ids}); DELETE FROM hlt_orders WHERE id IN ({ids}); "
             f"DELETE FROM term_agreements WHERE account_id IN ({acc}) AND term_code = 'MARKETING';")
        if pid and had_rule == '0':
            psql(f"DELETE FROM mkx_rebuy_rules WHERE product_id = '{pid}'")
        if dp and stock0:
            psql(f"SET session_replication_role = replica; UPDATE hlt_product_options SET stock = {int(stock0)} WHERE id = '{opt}'")
        for k, x in s0.items():
            setting(k, x or None, '1539 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/mkx-rebuy', lambda pg, seen: seen.update(n=pg.locator('[data-mkx-rebuy]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 재구매 알림(규칙 · 기록 · 화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
