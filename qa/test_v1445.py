"""v10.445 (D259 · docs/582) 근태 — 직원 ↔ 운영 계정 연결 · 출근 · 퇴근 · 달 집계 · 고침 · 확인
  ① (코드) D259 근태 표 · 고침 기록 · 가드 · 계정 연결 칸 · 설정 · 컨트롤러 · 화면 · 메뉴 · 문서 582
  ② (API · DB) 연결 전 422 · SUPER 연결 · 같은 계정 409 · 출근 · 퇴근 · 두 번 409 · 달 집계 · DB 시각 고침 막음 · 고침 기록 · 빠진 날 · 확인 뒤 409 · 본인 줄 403
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


ok('① 코드 — D259 근태 표 · 고침 기록 · 가드 · 계정 연결 칸 · hr.work_start · HrController · 화면 HrAttend · MyHr · 메뉴 hr-attend · my-hr · 문서 582 · 판 v10.445',
   'CREATE TABLE IF NOT EXISTS public.acct_attendance' in M59 and 'acct_attendance_fixes' in M59 and 'ACCT_ATTEND_FIXED' in M59 and 'ADD COLUMN IF NOT EXISTS account_id' in M59
   and "'hr.work_start'" in M59 and "@Post('me/hr/clock')" in HC and "@Put('hr/employees/:id/account')" in HC and 'export async function clock' in HR and 'HrController' in AM
   and 'export function HrAttend' in UI and 'export function MyHr' in UI and "'hr-attend'" in MN and "'my-hr'" in AP and '"SB-ADM-HRM-010"' in SJ and '근태' in doc('582_') and VT >= (10, 445), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ee, eid, TE = staff('1445e', 'REVIEWER')
    ae, aid, TA = staff('1445a', 'ADMIN')
    try:
        e1 = emp('1445a'); e2 = emp('1445b')
        nolink = call('GET', '/admin/me/hr', None, TE); noclock = call('POST', '/admin/me/hr/clock', {'kind': 'IN'}, TE)
        lk = call('PUT', f'/admin/hr/employees/{e1}/account', {'email': ee}, TS)
        taken = call('PUT', f'/admin/hr/employees/{e2}/account', {'email': ee}, TS)
        member = call('PUT', f'/admin/hr/employees/{e2}/account', {'email': 'buyer@x.com'}, TS)
        byadm = call('PUT', f'/admin/hr/employees/{e2}/account', {'email': ae}, TA)
        lk2 = call('PUT', f'/admin/hr/employees/{e2}/account', {'email': ae}, TS)
        cin = call('POST', '/admin/me/hr/clock', {'kind': 'IN'}, TE); cin2 = call('POST', '/admin/me/hr/clock', {'kind': 'IN'}, TE)
        cout = call('POST', '/admin/me/hr/clock', {'kind': 'OUT'}, TE); cout2 = call('POST', '/admin/me/hr/clock', {'kind': 'OUT'}, TE)
        mine = call('GET', '/admin/me/hr', None, TE)
        b403, e403 = call('GET', '/admin/hr/attendance', None, TB), call('GET', '/admin/hr/attendance', None, TE)
        mon = call('GET', f'/admin/hr/attendance?ym={today[:7]}', None, TS)
        row = next((r for r in mon.get('rows', []) if r.get('employeeId') == e1), {})
        summ = next((s for s in mon.get('summary', []) if s.get('employeeId') == e1), {})
        guard = psql(f"UPDATE acct_attendance SET in_at = in_at - interval '1 hour' WHERE id = {int(row.get('id') or 0)}")
        fx = call('POST', f"/admin/hr/attendance/{row.get('id')}/fix", {'inAt': '08:30', 'outAt': '17:00', 'reason': '시험 1445 고침'}, TS)
        nfix = psql(f"SELECT count(*) || '|' || bool_and(a.fixed) FROM acct_attendance_fixes f JOIN acct_attendance a ON a.id = f.attendance_id WHERE a.id = {int(row.get('id') or 0)}")
        yday = (kst - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
        add = call('POST', '/admin/hr/attendance/add', {'employeeId': e1, 'workOn': yday, 'inAt': '09:10', 'outAt': '18:00', 'reason': '시험 1445 빠짐'}, TS)
        add2 = call('POST', '/admin/hr/attendance/add', {'employeeId': e1, 'workOn': yday, 'inAt': '09:10', 'reason': '시험 1445 두 번'}, TS)
        cf = call('POST', '/admin/hr/attendance/confirm', {'ym': today[:7], 'employeeId': e1}, TS)
        fx2 = call('POST', f"/admin/hr/attendance/{row.get('id')}/fix", {'inAt': '08:00', 'reason': '시험 1445 확인 뒤'}, TS)
        ain = call('POST', '/admin/me/hr/clock', {'kind': 'IN'}, TA)
        arow = psql(f"SELECT id FROM acct_attendance WHERE employee_id = {int(e2 or 0)} AND work_on = '{today}'")
        self_ = call('POST', f'/admin/hr/attendance/{arow}/fix', {'inAt': '08:00', 'reason': '시험 1445 본인'}, TA) if arow.isdigit() else {}
        ok('② 근태 — 연결 전 422 · SUPER 연결 · 같은 계정 409 · 회원 422 · ADMIN 연결 403 · 출근 · 두 번 409 · 퇴근 · 두 번 409 · 내 인사 · 회원 · 담당 403 · 달 집계 · DB 시각 고침 막음 · 고침 기록 · 빠진 날 · 두 번 409 · 확인 · 확인 뒤 409 · 본인 줄 403',
           nolink.get('linked') is False and noclock.get('code') == 'HR_NOT_LINKED' and lk.get('ok') is True and taken.get('code') == 'HR_LINK_TAKEN' and member.get('code') == 'HR_LINK'
           and byadm.get('_err') == 403 and lk2.get('ok') is True and cin.get('ok') is True and cin2.get('code') == 'ATTEND_DONE' and cout.get('ok') is True and cout2.get('code') == 'ATTEND_DONE'
           and (mine.get('today') or {}).get('outHm') and b403.get('_err') == 403 and e403.get('_err') == 403 and row.get('id') and summ.get('days') == 1
           and 'ACCT_ATTEND' in guard and fx.get('ok') is True and nfix == '1|true' and add.get('ok') is True and add2.get('code') == 'ATTEND_DONE'
           and (cf.get('confirmed') or 0) >= 1 and fx2.get('code') == 'ATTEND_CONFIRMED' and ain.get('ok') is True and self_.get('code') == 'HR_SELF',
           f"{nolink.get('linked')} {noclock.get('code')} {lk.get('ok')} {taken.get('code')} {member.get('code')} {byadm.get('_err')} {lk2.get('ok')} {cin.get('ok')} {cin2.get('code')} {cout.get('ok')} {cout2.get('code')} "
           f"{(mine.get('today') or {}).get('outHm')} {b403.get('_err')} {e403.get('_err')} {row.get('id')} {summ.get('days')} {guard[-40:]} {fx.get('ok') or fx.get('code')} {nfix} {add.get('ok') or add.get('code')} {add2.get('code')} {cf.get('confirmed')} {fx2.get('code')} {ain.get('ok') or ain.get('code')} {self_.get('code')}")
    finally:
        cleanup(); rm_role(eid, '1445'); rm_role(aid, '1445')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
