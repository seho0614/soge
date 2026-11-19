"""v10.447 (D259 · docs/584) 급여명세서 — 확정 급여 줄 · 본인 열람 · 알림 메일(처음 꺼짐 · 금액 없음)
  ① (코드) D259 알림 기록 표 · 설정 · API · 화면 · 문서 584
  ② (API · DB) 목록 · 한 장 · 본인 열람 · 다른 직원 404 · 403 · 꺼짐 422 · 켜면 기록
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


ok('① 코드 — D259 명세서 알림 기록 · acct.payslip_mail(처음 off) · 목록 · 한 장 · 본인 · 알림 API · 금액 없는 메일 · 화면 AcctPayslip · 문서 584 · 판 v10.447',
   'CREATE TABLE IF NOT EXISTS public.acct_payslip_mails' in M59 and "('acct.payslip_mail', 'off'" in M59 and "@Get('acct/payslips/:lineId')" in HC and "@Get('me/hr/payslips/:lineId')" in HC
   and "@Post('acct/payslips/notify')" in HC and '금액을 넣지 않습니다' in PS and 'PAYSLIP_MAIL_OFF' in PS and 'export function AcctPayslip' in UI and "'acct-payslip'" in MN
   and '"SB-ADM-HRM-030"' in SJ and '명세서' in doc('584_') and VT >= (10, 447), VER)


def run_with_line(ym, eid_, gross, it):
    """확정한 급여 한 달(시험 전용 달) — 줄 넣기는 DRAFT 일 때만 · 뒤에 FIXED"""
    lt, np_, hi, ltc, ei = it // 10, 135000, 106350, 13770, 27000
    net = gross - it - lt - np_ - hi - ltc - ei
    rid = psql(f"INSERT INTO acct_payroll_runs (ym, pay_day) VALUES ('{ym}', '{ym}-25') RETURNING id").split('\n')[0]
    if not rid.isdigit():
        return None, None, rid
    lid = psql(f"INSERT INTO acct_payroll_lines (run_id, employee_id, gross, nontax, income_tax, local_tax, np, hi, ltc, ei, net, company_np, company_hi) "
               f"VALUES ({rid}, {eid_}, {gross}, 200000, {it}, {lt}, {np_}, {hi}, {ltc}, {ei}, {net}, {np_}, {hi}) RETURNING id").split('\n')[0]
    psql(f"UPDATE acct_payroll_runs SET state = 'FIXED', fixed_at = now() WHERE id = {rid}")
    return rid, lid, net


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ee, eid, TE = staff('1447e', 'REVIEWER')
    oe, oid, TO = staff('1447o', 'REVIEWER')
    s0 = getset('acct.payslip_mail')
    try:
        setting('acct.payslip_mail', 'off', '1447')
        e1 = emp('1447a', eid); e2 = emp('1447b', oid)
        ym = next((f'2000-{m:02d}' for m in [(stamp + i) % 12 + 1 for i in range(12)] if psql(f"SELECT count(*) FROM acct_payroll_runs WHERE ym = '2000-{m:02d}'") == '0'), None)
        rid, lid, net = run_with_line(ym, e1, 3000000, 74350)
        lst = call('GET', f'/admin/acct/payslips?ym={ym}', None, TS)
        it = next((x for x in lst.get('items', []) if str(x.get('id')) == str(lid)), {})
        one = call('GET', f'/admin/acct/payslips/{lid}', None, TS)
        mine = call('GET', f'/admin/me/hr/payslips/{lid}', None, TE)
        other = call('GET', f'/admin/me/hr/payslips/{lid}', None, TO)
        e403, b403 = call('GET', f'/admin/acct/payslips?ym={ym}', None, TE), call('GET', f'/admin/me/hr', None, TB)
        me = call('GET', '/admin/me/hr', None, TE)
        off = call('POST', '/admin/acct/payslips/notify', {'ym': ym}, TS)
        setting('acct.payslip_mail', 'on', '1447')
        on = call('POST', '/admin/acct/payslips/notify', {'ym': ym}, TS)
        logs = psql(f"SELECT string_agg(result, ',') FROM acct_payslip_mails WHERE line_id = {int(lid or 0)}")
        norun = call('POST', '/admin/acct/payslips/notify', {'ym': '2000-13'}, TS)
        ok('② 명세서 — 목록 실지급 · 공제 · 한 장(지급 3 · 공제 6) · 본인 열람 · 다른 직원 404 · 담당 · 회원 403 · 내 인사 목록 · 꺼짐 422 · 켜면 기록(보냄 · 준비 안 됨) · 형식 400',
           lid and it.get('net') == net and it.get('deductions') == 3000000 - net and one.get('net') == net and len(one.get('pay', [])) == 3 and len(one.get('deductions', [])) == 6
           and mine.get('net') == net and other.get('_err') == 404 and e403.get('_err') == 403 and b403.get('_err') == 403 and any(str(p.get('id')) == str(lid) for p in me.get('payslips', []))
           and off.get('code') == 'PAYSLIP_MAIL_OFF' and on.get('ok') is True and bool(logs) and set(logs.split(',')) <= {'SENT', 'NOT_READY', 'FAILED'} and norun.get('_err') == 400,
           f"{ym} {lid} {net} {it.get('net')} {it.get('deductions')} {one.get('net')} {len(one.get('pay', []))} {len(one.get('deductions', []))} {mine.get('net')} {other.get('_err')} {e403.get('_err')} {b403.get('_err')} "
           f"{len(me.get('payslips', []))} {off.get('code')} {on.get('ok') or on.get('code')} {logs} {norun.get('_err')}")
    finally:
        cleanup(); setting('acct.payslip_mail', s0 or 'off', '1447 되돌림'); rm_role(eid, '1447'); rm_role(oid, '1447')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
