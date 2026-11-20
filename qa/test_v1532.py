"""v10.532 (docs/670) 판매자 월 정산서 PDF · 메일 — 대표 11/20 「(51) ① 판매자 정산서 PDF · 메일」
  ① (코드) D281 hlt_seller_statements(판매자 · 달 고유) · 보낸 줄 막는 트리거 · fn_hlt_statement_calc · make · mall.statement_mail off · 작업 mall_statement · 서버 · 운영 화면 인쇄 · 판매자센터 · 메뉴 · 화면 · 사전 · 문서
  ② (API · DB) 회원 403 · 판매자 미리보기 합계 · 판매자 아님 403 · 만들기 · 목록 · 한 장 · 메일 꺼짐 422 · 달 422 · 미래 422 · 보낸 줄 409 · UPDATE · DELETE 막음 · 작업 · 권한 주소(시험 판매자 · 2025-03 주 정산서 · 끝에 replica 로 지움)
  ③ (화면) 소개몰 › 판매자 월 정산서 · 판매자센터 › 월 정산서(SITE 있을 때)
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


def first(s):
    return (s or '').splitlines()[0] if s and not s.startswith('!') else ''


M81 = migr('D281_')
stamp = int(time.time()) % 1000000
T0 = psql("SELECT now()::text") if (API and DB) else ''
ST, CT, UI, MN, AP, WK, SC, PG, SM = (rd('src/modules/slx/statements.ts'), rd('src/modules/slx/slx.controller.ts'), rd('web/src/app/admin/Slx.tsx'),
                                      rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/worker.controller.ts'), rd('src/worker/scheduler.service.ts'),
                                      rd('site/src/app/health/seller/center/statements/page.tsx'), rd('src/app.module.ts'))
KO = rd('site/src/i18n/messages/ko/slx.json')
EN = rd('site/src/i18n/messages/en/slx.json')

ok('① 코드 — D281 월 정산서 표(판매자 · 달 고유 · fee_amount) · SENT 줄 막는 트리거 · 셈 · 만들기 함수 · mall.statement_mail off · 만드는 날 5 · 작업 mall_statement 09:10 · 서버 목록 · 한 장 · 만들기 · 지금 보내기 · 판매자 본인 · 같은 달 한 번(보내는 중 표시) · 운영 화면 인쇄(printDoc) · 판매자센터 인쇄 · 메뉴 slx-statements · 화면 SLX-010 · 사전 ko · en · 문서 670 · 판 v10.532',
   'CREATE TABLE IF NOT EXISTS public.hlt_seller_statements' in M81 and 'CONSTRAINT ux_hlt_stmt_seller_ym UNIQUE (seller_id, ym)' in M81 and 'fee_amount' in M81
   and "IF OLD.mail_state = 'SENT' THEN" in M81 and 'FUNCTION public.fn_hlt_statement_calc' in M81 and 'FUNCTION public.fn_hlt_statement_make' in M81
   and "('mall.statement_mail', 'off'" in M81 and "('mall.statement_day', '5'" in M81 and "('mall_statement', 1440, 9, 10" in M81
   and "export async function statementsView" in ST and "export async function sendStatement" in ST and 'mail_claimed_at' in ST and "export async function mallStatementJob" in ST
   and "@Post('statements/:id/mail')" in CT and "@Get('statements/:ym')" in CT and 'SlxSellerController' in SM
   and "'mall_statement'," in WK and "case 'mall_statement':" in SC and 'openPrint(' in UI and 'export function SlxStatements' in UI
   and "['slx-statements', '판매자 월 정산서']" in MN and "{tab === 'slx-statements' && <SlxStatements />}" in AP and 'window.print' in rd('site/src/components/slx/PrintButton.tsx')
   and "/me/health/seller/statements/" in PG and '"SB-ADM-SLX-010"' in SJ and '"SB-HLT-SLX-010"' in SJ and '"monthly"' in KO and '"monthly"' in EN
   and '같은 달' in doc('670_') and VT >= (10, 532), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.statement_mail',)
    s0 = {k: getset(k) for k in keys}
    sid, aid = '', ''
    try:
        setting('mall.statement_mail', 'off', '1532')
        em, aid = mk_staff('1532', role=None)
        consent_ok.agree(em, PW)
        TM = login(em)
        em2, aid2 = mk_staff('1532o', role=None)
        consent_ok.agree(em2, PW)
        TO = login(em2)
        sid = first(psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, status, applied_at, reviewed_at) "
                         f"VALUES ('TN-T1532-{stamp}', '{aid}', 'TENANT', '시험 판매자 1532', true, 'ACTIVE', now(), now()) RETURNING id"))
        if sid:
            psql(f"INSERT INTO hlt_settlements (seller_id, period_from, period_to, gross_amount, commission, commission_vat, refund_amount, carried_in, net_amount, status) VALUES "
                 f"('{sid}', '2025-02-24', '2025-03-03', 5000, 0, 0, 0, 0, 5000, 'DRAFT'), "
                 f"('{sid}', '2025-03-03', '2025-03-10', 10000, 1000, 100, 0, 0, 8900, 'DRAFT'), "
                 f"('{sid}', '2025-03-10', '2025-03-17', 20000, 2000, 200, 500, 0, 17300, 'DRAFT')")
        r403 = call('GET', '/admin/health/statements', None, TM)
        pv = call('GET', '/me/health/seller/statements/2025-03', None, TM)
        other = call('GET', '/me/health/seller/statements', None, TO)
        mk = call('POST', '/admin/health/statements/make', {'ym': '2025-03', 'sellerId': sid}, TS)
        lv = call('GET', '/admin/health/statements?ym=2025-03', None, TS)
        mine_row = next((x for x in (lv.get('items') or []) if x.get('sellerId') == sid), {})
        stid = psql(f"SELECT id FROM hlt_seller_statements WHERE seller_id = '{sid}' AND ym = '2025-03'") if sid else ''
        dt = call('GET', f'/admin/health/statements/{stid}', None, TS) if stid else {}
        ml = call('GET', '/me/health/seller/statements', None, TM)
        months = {x.get('ym'): x.get('preview') for x in (ml.get('items') or [])}
        mailoff = call('POST', f'/admin/health/statements/{stid}/mail', None, TS) if stid else {}
        badym = call('GET', '/admin/health/statements?ym=2025-13', None, TS)
        future = call('POST', '/admin/health/statements/make', {'ym': '2099-01'}, TS)
        badin = call('POST', '/admin/health/statements/make', {'ym': '25-3'}, TS)
        sent = psql(f"UPDATE hlt_seller_statements SET mail_state = 'SENT', mailed_at = now() WHERE id = {stid}") if stid else '!'
        again = call('POST', '/admin/health/statements/make', {'ym': '2025-03', 'sellerId': sid}, TS)
        upd = psql(f"UPDATE hlt_seller_statements SET net_amount = 1 WHERE id = {stid}") if stid else ''
        dele = psql(f"DELETE FROM hlt_seller_statements WHERE id = {stid}") if stid else ''
        calc = psql(f"SELECT (fn_hlt_statement_calc('{sid}', '2025-03')->>'weeks') || '|' || (fn_hlt_statement_calc('{sid}', '2025-03')->>'net')") if sid else ''
        badfn = psql(f"SELECT fn_hlt_statement_calc('{sid}', '2025-3')") if sid else ''
        jb = call('POST', '/admin/jobs', {'job': 'mall_statement'}, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'slx-statements'")
        ok('② 월 정산서 — 회원 403 · 판매자 미리보기(2주 · 매출 30,000 · 수수료 3,000 · 지급 26,200 · 2월 주 뺌) · 판매자 아님 403 · 만들기 1 · 목록 · 한 장 주별 2줄 · 판매자 목록(3월 만듦 · 2월 미리보기) · 메일 꺼짐 422 · 잘못된 달 422 · 미래 달 422 · 형식 400 · 보낸 줄 다시 셈 409 · UPDATE · DELETE 막음 · DB 셈 · 달 무늬 · 작업 · 권한 주소 4',
           bool(sid) and r403.get('_err') == 403 and pv.get('preview') is True and pv.get('weeks') == 2 and pv.get('gross') == 30000 and pv.get('fee') == 3000 and pv.get('feeVat') == 300
           and pv.get('refund') == 500 and pv.get('net') == 26200 and other.get('_err') == 403 and other.get('code') == 'NOT_SELLER'
           and mk.get('made') == 1 and mine_row.get('made') is True and mine_row.get('net') == 26200 and bool(stid) and len(dt.get('lines') or []) == 2 and dt.get('preview') is False
           and months.get('2025-03') is False and months.get('2025-02') is True and mailoff.get('code') == 'HLT_STMT_MAIL_OFF' and badym.get('code') == 'HLT_STMT_YM'
           and future.get('code') == 'HLT_STMT_FUTURE' and badin.get('_err') == 400 and '!' not in sent and again.get('_err') == 409 and again.get('code') == 'HLT_STMT_SENT'
           and '!' in upd and 'HLT_STMT_SENT' in upd and '!' in dele and calc == '2|26200' and 'HLT_STMT_YM' in badfn and jb.get('_err') is None and rmap == '4',
           f"{sid} {r403.get('_err')} · {pv.get('preview')} {pv.get('weeks')} {pv.get('gross')} {pv.get('fee')} {pv.get('feeVat')} {pv.get('refund')} {pv.get('net')} {pv.get('code')} · {other.get('code')} · "
           f"{mk.get('made') or mk} {mine_row.get('made')} {mine_row.get('net')} {stid} {len(dt.get('lines') or [])} · {months} · {mailoff.get('code')} {badym.get('code')} {future.get('code')} {badin.get('_err')} · "
           f"{sent[-30:]} {again.get('_err')} {again.get('code')} {upd[-40:]} {dele[-30:]} {calc} {badfn[-30:]} {jb.get('_err')} {rmap}")
    finally:
        if sid:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_seller_statements WHERE seller_id = '{sid}'; DELETE FROM hlt_settlements WHERE seller_id = '{sid}'; DELETE FROM hlt_sellers WHERE id = '{sid}';")
        if T0:
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'MALL_STATEMENT_MAIL_FAIL' AND raised_at >= '{T0}'::timestamptz;")
        for k, x in s0.items():
            setting(k, x or None, '1532 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/slx-statements', lambda pg, seen: seen.update(n=pg.locator('[data-slx-statements]').count(), m=pg.locator('[data-slx-stmt-make]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 판매자 월 정산서(목록 · 만들기 단추 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('m') == 1 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        def run_site(b, seen, perr):
            ps = site_login(b, perr, 'buyer@x.com')
            ps.goto(SITE + '/health/seller/center/statements', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['page'] = ps.locator('[data-slx-statements-page]').count()
        r2 = ui(run_site)
        if r2 is not None:
            seen2, perr2 = r2
            ok('③ 화면 — 판매자센터 › 월 정산서(판매자 아닌 회원은 안내 · 화면 오류 없음)', seen2.get('page') == 1 and not perr2, f"{seen2} {perr2[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
