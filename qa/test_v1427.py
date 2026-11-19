"""v10.427 (D253 · docs/564) 분기 · 연 예산
  ① (코드) budgetPeriod · setYearBudget(EVEN · LAST_YEAR · 시작 달 · setBudget 재사용) · budgetYearLine · API 2 · 예산 탭 상자 · 경영 보고서 한 줄 · 문서 564
  ② (API · DB) 먼 해(2099) 연 목표 120,000 똑같이 → 달마다 10,000 · 분기 30,000 · 연 120,000 · 지급 담당 넣기 403 · 지난 해 422 · 되돌림(지움)
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


M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')
UI, AP, MN, SC, WK, AM = rd('web/src/app/admin/Report.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')

ok('① 코드 — D250 report_sends · report.send off · send_kinds · sendSnapshot(텔레그램 · 슬랙 · 메일) · sendAfterJob · API · 감사 · 화면 · 문서 552 · 판 v10.415',
   'CREATE TABLE IF NOT EXISTS public.report_sends' in M50 and "('report.send', 'off'" in M50 and "'report.send_kinds'" in M50
   and 'export async function sendSnapshot' in RS and 'export async function sendAfterJob' in RS and 'telegram.send' in RS and 'slack.send' in RS and 'mail.send' in RS
   and "@Audit('REPORT_SEND', 'SETTING')" in RC and "@Audit('REPORT_SETTING', 'SETTING')" in RC and 'data-rpt-settings=' in UI and 'data-rpt-send=' in UI
   and '보내기' in doc('552_') and VT >= (10, 415), VER)

M53 = migr('D253_')

BP, OC, UI, APP, RP = rd('src/modules/acct/budget-period.ts'), rd('src/modules/acct/office.controller.ts'), rd('web/src/app/admin/Office.tsx'), rd('web/src/App.tsx'), rd('src/modules/acct/acct-reports.ts')
ok('① 코드 — 분기 · 연 · 누계 · 연 목표 나눔(똑같이 · 지난해 비율 · setBudget) · API 2 · 예산 탭 상자 · 경영 보고서 연 누계 · 문서 564 · 판 v10.427',
   'export async function budgetPeriod' in BP and 'export async function setYearBudget' in BP and 'await setBudget(db' in BP and 'export async function budgetYearLine' in BP
   and "@Get('acct/budget/period')" in OC and "@Post('acct/budget/year')" in OC and 'export function BudgetPeriod' in UI and '<BudgetPeriod />' in APP and 'budgetYear' in RP
   and '연 목표' in doc('564_') and VT >= (10, 427), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1427', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    Y = 2099
    try:
        y1 = call('POST', '/admin/acct/budget/year', {'year': Y, 'items': [{'role': 'EXP_SUPPLIES', 'amount': 120000}], 'split': 'EVEN', 'reason': '시험 1427'}, TS)
        byp = call('POST', '/admin/acct/budget/year', {'year': Y, 'items': [{'role': 'EXP_SUPPLIES', 'amount': 1}], 'reason': '시험 1427'}, TP)
        past = call('POST', '/admin/acct/budget/year', {'year': 2021, 'items': [{'role': 'EXP_SUPPLIES', 'amount': 1}], 'reason': '시험 1427'}, TS)
        pv = call('GET', f'/admin/acct/budget/period?year={Y}', None, TP)
        it = next((x for x in pv.get('items') or [] if x.get('role') == 'EXP_SUPPLIES'), {})
        ms = psql(f"SELECT count(*) || '|' || coalesce(min(amount), 0) || '|' || coalesce(max(amount), 0) FROM acct_budgets WHERE role = 'EXP_SUPPLIES' AND ym LIKE '{Y}-%'")
        ok('② 연 목표 — 12달로 똑같이(10,000) · 분기 30,000 · 연 120,000 · 누계는 아직 0(먼 해) · 지급 담당 403 · 지난 해 422',
           y1.get('ok') is True and y1.get('months') == 12 and ms == '12|10000|10000' and [q.get('budget') for q in it.get('quarters') or []] == [30000, 30000, 30000, 30000]
           and (it.get('year') or {}).get('budget') == 120000 and pv.get('upto') == 0 and byp.get('_err') == 403 and past.get('code') == 'ACCT_BUDGET',
           f"{y1.get('ok')} {y1.get('months')} · {ms} · {[q.get('budget') for q in it.get('quarters') or []]} · {it.get('year')} {pv.get('upto')} · {byp.get('_err')} {past.get('code')}")
    finally:
        call('POST', '/admin/acct/budget/year', {'year': Y, 'items': [{'role': 'EXP_SUPPLIES', 'amount': 0}], 'reason': '시험 1427 지움'}, TS)
        psql(f"SET session_replication_role = replica; DELETE FROM acct_budget_changes WHERE ym LIKE '{Y}-%'; DELETE FROM acct_budgets WHERE ym LIKE '{Y}-%'; DELETE FROM ops_alerts WHERE alert_code = 'ACCT_BUDGET_OVER' AND detail->>'ym' LIKE '{Y}-%';")
        rm_role(pid, '1427')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
