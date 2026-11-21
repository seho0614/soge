"""v10.476 (D266 · docs/614) 12개월 자금 계획 — 90일 확정 + 예정 · 계약 고정비 · 급여 · 세금 기한 · 예상 매출 · 달 말 예상 잔액 · 모자라는 달 알림(표 없음)
  ① (코드) 설정 3 · 정기 작업 acct_cashplan · cashPlan 이 원래 자료에서 셈 · ACCT_CASHPLAN_SHORT · 메뉴 · 화면 FIN2-020 · 문서 614
  ② (API · DB) 회원 403 · 12 · 6달 · 잔액 합 · 200일 뒤 큰 예정 → 모자라는 달 · 알림 1(두 번 돌려도) · 끄면 풀림 · 예정 지우면 모자람 없음 · 권한 주소 1
  ③ (화면) 회계 › 자금 계획 12개월
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


M66 = migr('D266_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
AM, MN, AP, SCH, WK = rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
OC, UI = rd('src/modules/acct/acct-ops.controller.ts'), rd('web/src/app/admin/AcctOps.tsx')

CP = rd('src/modules/acct/cashplan.ts')
ok('① 코드 — 표 없음(D266 에 cash plan 표 없음) · 설정 3(TARGET · 1달 · 알림 on) · 정기 작업 acct_cashplan 09:35 · cashPlan(⑫ cashflow · 예정 · 계약 고정비 · 급여 추정 · 원천세 · 부가세 · 법인세 · 매출 목표 · 영업 기회(표 없으면 0)) · ACCT_CASHPLAN_SHORT · GET /admin/acct/cash-plan · 메뉴 acct-cashplan · 화면 FIN2-020 · 문서 614 · 판 v10.476',
   'CREATE TABLE IF NOT EXISTS public.acct_cash_plan' not in M66 and "('acct.cashplan_sales', 'TARGET'" in M66 and "('acct.cashplan_collect_months', '1'" in M66 and "('acct.cashplan_alert', 'on'" in M66
   and "('acct_cashplan', 1440, 9, 35" in M66 and 'await cashflow(db, 90, today)' in CP and 'FROM acct_cash_plans' in CP and 'FROM acct_contracts' in CP and 'FROM acct_employees' in CP
   and 'ratesOf(db' in CP and "roleSum(db, 'WHT'" in CP and "roleSum(db, 'VAT_OUT'" in CP and 'corpDeadlines(db' in CP and 'acct_sales_targets' in CP and "to_regclass('public.sal_opps')" in CP
   and "'ACCT_CASHPLAN_SHORT'" in CP and "@Get('acct/cash-plan')" in OC and "case 'acct_cashplan':" in SCH and "'acct_cashplan'," in WK
   and "['acct-cashplan', '자금 계획 12개월']" in MN and "{tab === 'acct-cashplan' && <AcctCashPlan />}" in AP and 'export function AcctCashPlan' in UI
   and '"SB-ADM-FIN2-020"' in SJ and '모자라는 달' in doc('614_') and VT >= (10, 476), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    far = (kst + datetime.timedelta(days=200)).strftime('%Y-%m-%d')
    fym = far[:7]
    memo = f'시험 1476 큰 지출-{stamp}'
    alert0 = getset('acct.cashplan_alert')
    bid = pid = ''
    try:
        mb = call('GET', '/admin/acct/cash-plan', None, TB)
        p12 = call('GET', '/admin/acct/cash-plan', None, TS)
        p6 = call('GET', '/admin/acct/cash-plan?months=6', None, TS)
        rows = p12.get('rows') or []
        sum_ok = bool(rows) and rows[-1].get('endBalance') == p12.get('start', 0) + sum(r.get('net', 0) for r in rows)
        month_ok = len(rows) == 12 and rows[0].get('ym') == today[:7] and len(p6.get('rows') or []) == 6
        bid = psql(f"INSERT INTO acct_cash_balances (as_of, amount, source, note) VALUES ('{today}', 1000000, 'MANUAL', '시험 1476 잔액') RETURNING id").split('\n')[0]
        pb = call('GET', '/admin/acct/cash-plan', None, TS)   # 큰 예정 넣기 전 — 점검판에 남은 다른 예정 · 장부로 이미 모자란 달은 「지움」 판단에서 뺌(회귀 두 번째)
        pid = psql(f"INSERT INTO acct_cash_plans (due_on, direction, amount, memo, repeat) VALUES ('{far}', 'OUT', 900000000000, '{memo}', 'NONE') RETURNING id").split('\n')[0]
        p2 = call('GET', '/admin/acct/cash-plan', None, TS)
        frow = next((r for r in p2.get('rows') or [] if r.get('ym') == fym), {})
        has_item = any(it.get('label') == memo and it.get('kind') == 'PLAN_OUT' for it in frow.get('items') or [])
        setting('acct.cashplan_alert', 'on', '1476')
        call('POST', '/admin/jobs', {'job': 'acct_cashplan'}, TS); call('POST', '/admin/jobs', {'job': 'acct_cashplan'}, TS)
        open_all = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CASHPLAN_SHORT' AND resolved_at IS NULL")
        first = (p2.get('firstShort') or {}).get('ym')
        mine1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CASHPLAN_SHORT' AND resolved_at IS NULL AND detail->>'ym' = '{first}'")
        setting('acct.cashplan_alert', 'off', '1476')
        call('POST', '/admin/jobs', {'job': 'acct_cashplan'}, TS)
        off_open = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CASHPLAN_SHORT' AND resolved_at IS NULL")
        setting('acct.cashplan_alert', alert0 or 'on', '1476')
        psql(f"SET session_replication_role = replica; DELETE FROM acct_cash_plans WHERE id = {int(pid or 0)};"); pid = ''
        p3 = call('GET', '/admin/acct/cash-plan', None, TS)
        gone = fym not in (p3.get('shortMonths') or []) or fym in (pb.get('shortMonths') or [])
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'acct-cashplan'")
        ok('② 자금 계획 — 회원 403 · 12달(이번 달부터) · 6달 · 달 말 잔액 = 시작 + 차이 합 · 200일 뒤 큰 예정 → 그 달 줄 · 모자라는 달 · 정기 작업 두 번 → 열린 알림 1(첫 모자라는 달) · 알림 끔 → 0 · 예정 지우면 그 달 모자람 없음 · 권한 주소 1',
               mb.get('_err') == 403 and month_ok and sum_ok and has_item and fym in (p2.get('shortMonths') or []) and p2.get('hasBase') is True
               and open_all == '1' and mine1 == '1' and off_open == '0' and gone and rmap == '1',
               f"{mb.get('_err')} 달 {month_ok} 합 {sum_ok} · 줄 {has_item} 모자람 {p2.get('shortMonths')} base {p2.get('hasBase')} · 알림 {open_all} {first} {mine1} · 끔 {off_open} · 지움 {gone} {p3.get('shortMonths')} · {rmap}")
    finally:
        setting('acct.cashplan_alert', alert0 or 'on', '1476')
        psql(f"SET session_replication_role = replica; DELETE FROM acct_cash_plans WHERE memo LIKE '시험 1476 큰 지출-%'; DELETE FROM acct_cash_balances WHERE note = '시험 1476 잔액'; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'ACCT_CASHPLAN_SHORT' AND raised_at > now() - interval '1 hour' AND detail->>'shortMonths' LIKE '%{fym}%';")
    if ADMIN_WEB:
        r = admin_page('/#/acct-cashplan', lambda pg, seen: seen.update(n=pg.locator('[data-cashplan]').count(), rows=pg.locator('[data-cashplan-row]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회계 › 자금 계획 12개월(달 줄 12 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('rows') == 12 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
