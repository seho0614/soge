"""v10.448 (D259 · docs/585) 연말정산 자료 모음 — 해 합계 · 달별 · 서류 받음 표시 · CSV(승인)
  ① (코드) D259 서류 받음 표 · API · CSV · 화면 · 문서 585
  ② (API · DB) 해 합계 · 달별 · 안 받은 서류 → 받음 · 그 밖 사유 422 · 회원 403 · CSV 승인 422 · DB 고치기 막음
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


M59 = migr('D259_')
HC, HR, PS, YE = rd('src/modules/acct/hr.controller.ts'), rd('src/modules/acct/hr.ts'), rd('src/modules/acct/payslip.ts'), rd('src/modules/acct/yearend.ts')
UI, AP, MN, AM = rd('web/src/app/admin/Hr.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
EMPS = []


def emp(tag, account_id=None, joined_days=60):
    j = (kst - datetime.timedelta(days=joined_days)).strftime('%Y-%m-%d')
    acc = f"'{account_id}'" if account_id else 'NULL'
    e = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, account_id) VALUES ('시험직원{tag}-{stamp}', '{j}', 3000000, {acc}) RETURNING id").split('\n')[0]
    if e.isdigit():
        EMPS.append(e)
    return e


def cleanup():
    """시험이 만든 줄 지우기(쌓기만 표라 replica 로) — 두 번 돌아도 통과"""
    if not EMPS:
        return ''
    ids = ','.join(EMPS)
    return psql("SET session_replication_role = replica; "
                f"DELETE FROM acct_attendance_fixes WHERE attendance_id IN (SELECT id FROM acct_attendance WHERE employee_id IN ({ids})); "
                f"DELETE FROM acct_attendance WHERE employee_id IN ({ids}); "
                f"DELETE FROM acct_leave_uses WHERE employee_id IN ({ids}); DELETE FROM acct_leave_grants WHERE employee_id IN ({ids}); "
                f"DELETE FROM acct_leave_requests WHERE employee_id IN ({ids}); DELETE FROM acct_yearend_checks WHERE employee_id IN ({ids}); "
                f"DELETE FROM acct_payslip_mails WHERE line_id IN (SELECT id FROM acct_payroll_lines WHERE employee_id IN ({ids})); "
                f"DELETE FROM acct_payroll_runs WHERE id IN (SELECT run_id FROM acct_payroll_lines WHERE employee_id IN ({ids})) AND NOT EXISTS (SELECT 1 FROM acct_payroll_lines x WHERE x.run_id = acct_payroll_runs.id AND x.employee_id NOT IN ({ids})); "
                f"DELETE FROM acct_payroll_lines WHERE employee_id IN ({ids}); "
                f"DELETE FROM acct_employees WHERE id IN ({ids});")


def staff(tag, role):
    em, aid = mk_staff(tag, role)
    __import__('consent_ok').agree(em, PW)
    return em, aid, login(em)


def bizday(after=1, n=0):
    """오늘 + after 일부터 n 번째 영업일"""
    return psql(f"SELECT d::date FROM generate_series(current_date + {after}, current_date + 60, interval '1 day') d WHERE fn_is_business_day(d::date) ORDER BY d OFFSET {n} LIMIT 1")


def offday(after=1):
    return psql(f"SELECT d::date FROM generate_series(current_date + {after}, current_date + 30, interval '1 day') d WHERE NOT fn_is_business_day(d::date) ORDER BY d LIMIT 1")


ok('① 코드 — D259 서류 받음 표(쌓기만) · 연말정산 보기 · 받음 표시 · CSV(ACCT_TAX 승인) · 주민등록번호 칸 비움 · 화면 AcctYearend · 문서 585 · 판 v10.448',
   'CREATE TABLE IF NOT EXISTS public.acct_yearend_checks' in M59 and 'trg_acct_yearend_checks_ro' in M59 and "@Get('acct/yearend')" in HC and "@Post('acct/yearend/checks')" in HC
   and "@ExportGate('ACCT_TAX')" in HC and '주민등록번호(신고 때 채움)' in YE and 'wageStatements' in YE and 'export function AcctYearend' in UI and "'acct-yearend'" in MN
   and '"SB-ADM-HRM-040"' in SJ and '연말정산' in doc('585_') and VT >= (10, 448), VER)


def run_with_line(ym, eid_, gross, it):
    lt = it // 10
    net = gross - it - lt
    rid = psql(f"INSERT INTO acct_payroll_runs (ym, pay_day) VALUES ('{ym}', '{ym}-25') RETURNING id").split('\n')[0]
    if not rid.isdigit():
        return None
    psql(f"INSERT INTO acct_payroll_lines (run_id, employee_id, gross, nontax, income_tax, local_tax, net) VALUES ({rid}, {eid_}, {gross}, 0, {it}, {lt}, {net})")
    psql(f"UPDATE acct_payroll_runs SET state = 'FIXED', fixed_at = now() WHERE id = {rid}")
    return rid


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    try:
        e1 = emp('1448a')
        yr = next((str(y) for y in [2001 + (stamp + i) % 50 for i in range(50)] if psql(f"SELECT count(*) FROM acct_payroll_runs WHERE ym LIKE '{y}-%'") == '0'), None)
        r3, r4 = run_with_line(f'{yr}-03', e1, 2000000, 20000), run_with_line(f'{yr}-04', e1, 2000000, 20000)
        v0 = call('GET', f'/admin/acct/yearend?year={yr}', None, TS)
        it0 = next((x for x in v0.get('items', []) if x.get('employeeId') == e1), {})
        cs = [call('POST', '/admin/acct/yearend/checks', {'employeeId': e1, 'year': int(yr), 'item': k, 'done': True}, TS) for k in ('SIMPLE_PDF', 'DEDUCTION_FORM', 'DEPENDENT')]
        v1 = call('GET', f'/admin/acct/yearend?year={yr}', None, TS)
        it1 = next((x for x in v1.get('items', []) if x.get('employeeId') == e1), {})
        oth = call('POST', '/admin/acct/yearend/checks', {'employeeId': e1, 'year': int(yr), 'item': 'OTHER', 'done': True}, TS)
        bad = call('POST', '/admin/acct/yearend/checks', {'employeeId': e1, 'year': int(yr), 'item': 'NOPE', 'done': True}, TS)
        b403 = call('GET', f'/admin/acct/yearend?year={yr}', None, TB)
        exp = call('GET', f'/admin/acct/yearend/export?year={yr}', None, TS)
        guard = psql(f"UPDATE acct_yearend_checks SET done = false WHERE employee_id = {e1}")
        badyr = call('GET', '/admin/acct/yearend?year=20x6', None, TS)
        ok('② 연말정산 — 해 합계(총급여 · 기납부 소득세) · 3월 줄 · 안 받은 서류 3 → 받음 표시 3 → 0 · 그 밖 사유 422 · 종류 400 · 회원 403 · CSV 승인 422 · DB 고치기 막음 · 해 형식 422',
           yr and it0.get('gross') == 4000000 and it0.get('incomeTax') == 40000 and (it0.get('months') or [{}] * 3)[2].get('gross') == 2000000 and len(it0.get('missing', [])) == 3
           and all(c.get('ok') is True for c in cs) and it1.get('missing') == [] and oth.get('code') == 'YEAREND_ITEM' and bad.get('_err') == 400 and b403.get('_err') == 403
           and exp.get('code') == 'EXPORT_NEED_APPROVAL' and '!' in guard and badyr.get('code') == 'ACCT_PERIOD',
           f"{yr} {it0.get('gross')} {it0.get('incomeTax')} {[(m or {}).get('gross') for m in (it0.get('months') or [])][:4]} {it0.get('missing')} {[c.get('ok') for c in cs]} {it1.get('missing')} {oth.get('code')} {bad.get('_err')} {b403.get('_err')} {exp.get('code')} {guard[-40:]} {badyr.get('code')}")
    finally:
        cleanup()
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
