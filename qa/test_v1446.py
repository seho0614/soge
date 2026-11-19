"""v10.446 (D259 · docs/583) 휴가 신청 → 승인 — 연차 쓴 날 · 반차 · 겹침 · 모자람 · 승인 취소
  ① (코드) D259 휴가 신청 표 · 가드 · 설정 · API · 화면 · 문서 583
  ② (API · DB) 신청 · 겹침 409 · 반차 · 쉬는 날 422 · 승인 = 연차 쓴 날 · 모자람 422 · 반려 · 본인 취소 · 승인 취소 되돌림 · 본인 신청 403
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


ok('① 코드 — D259 휴가 신청 표 · 가드(앞으로만 · 내용 못 고침) · hr.leave_allow_negative · 신청 · 승인 · 승인 취소 API · 연차 쓴 날 LR- · 화면 HrLeave · 문서 583 · 판 v10.446',
   'CREATE TABLE IF NOT EXISTS public.acct_leave_requests' in M59 and 'ACCT_LEAVE_REQ_STATE' in M59 and "'hr.leave_allow_negative'" in M59
   and "@Post('me/hr/leave')" in HC and "@Post('hr/leave/:id/decide')" in HC and "@Post('hr/leave/:id/revoke')" in HC and 'LR-${id} 휴가 승인' in HR and 'LEAVE_SHORT' in HR
   and 'export function HrLeave' in UI and "'hr-leave'" in MN and '"SB-ADM-HRM-020"' in SJ and '휴가' in doc('583_') and VT >= (10, 446), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ee, eid, TE = staff('1446e', 'REVIEWER')
    ae, aid, TA = staff('1446a', 'ADMIN')
    s0 = getset('hr.leave_allow_negative')
    try:
        setting('hr.leave_allow_negative', 'off', '1446')
        e1 = emp('1446a', eid); e2 = emp('1446b', aid)
        b1, b2, b3 = bizday(1, 0), bizday(1, 1), bizday(1, 2)
        yr = int(b1[:4])
        psql(f"INSERT INTO acct_leave_grants (employee_id, year, days, note) VALUES ({e1}, {yr}, 2, '시험 1446 연차')")
        r1 = call('POST', '/admin/me/hr/leave', {'startOn': b1, 'endOn': b2, 'note': '시험 1446'}, TE)
        ov = call('POST', '/admin/me/hr/leave', {'startOn': b2}, TE)
        am = call('POST', '/admin/me/hr/leave', {'startOn': b3, 'half': 'AM'}, TE)
        pm = call('POST', '/admin/me/hr/leave', {'startOn': b3, 'half': 'PM'}, TE)
        am2 = call('POST', '/admin/me/hr/leave', {'startOn': b3, 'half': 'AM'}, TE)
        off = offday(1)
        wk = call('POST', '/admin/me/hr/leave', {'startOn': off, 'endOn': off}, TE) if off else {'code': 'LEAVE_NO_DAYS'}
        bdec, elst = call('POST', f"/admin/hr/leave/{r1.get('id')}/decide", {'decision': 'APPROVE'}, TB), call('GET', '/admin/hr/leave', None, TE)
        lst = call('GET', '/admin/hr/leave?state=REQUESTED', None, TS)
        ap = call('POST', f"/admin/hr/leave/{r1.get('id')}/decide", {'decision': 'APPROVE'}, TS)
        uses = psql(f"SELECT count(*) || '|' || sum(days) FROM acct_leave_uses WHERE employee_id = {e1} AND note LIKE 'LR-{r1.get('id')} %'")
        short = call('POST', f"/admin/hr/leave/{am.get('id')}/decide", {'decision': 'APPROVE'}, TS)
        rj0 = call('POST', f"/admin/hr/leave/{pm.get('id')}/decide", {'decision': 'REJECT'}, TS)
        rj = call('POST', f"/admin/hr/leave/{pm.get('id')}/decide", {'decision': 'REJECT', 'note': '시험 1446 반려'}, TS)
        cx = call('POST', f"/admin/me/hr/leave/{am.get('id')}/cancel", {}, TE)
        cx2 = call('POST', f"/admin/me/hr/leave/{r1.get('id')}/cancel", {}, TE)
        rv = call('POST', f"/admin/hr/leave/{r1.get('id')}/revoke", {'reason': '시험 1446 취소'}, TS)
        net = psql(f"SELECT coalesce(sum(days), 0) FROM acct_leave_uses WHERE employee_id = {e1} AND note LIKE 'LR-{r1.get('id')} %'")
        guard = psql(f"UPDATE acct_leave_requests SET days = days + 1 WHERE id = {int(r1.get('id') or 0)}")
        ar = call('POST', '/admin/me/hr/leave', {'startOn': b1, 'half': 'PM'}, TA)
        self_ = call('POST', f"/admin/hr/leave/{ar.get('id')}/decide", {'decision': 'REJECT', 'note': '시험 1446 본인'}, TA)
        ok('② 휴가 — 신청 2일 · 겹침 409 · 오전 · 오후 반차 · 오전 겹침 409 · 쉬는 날 422 · 회원 · 담당 403 · 목록 · 승인 = 연차 쓴 날 2줄 · 남은 연차 모자람 422 · 반려 사유 422 · 반려 · 본인 취소 · 승인된 것 본인 취소 409 · 승인 취소 = 되돌림 0 · DB 고치기 막음 · 본인 신청 403',
           r1.get('ok') is True and r1.get('days') == 2 and ov.get('code') == 'LEAVE_OVERLAP' and am.get('days') == 0.5 and pm.get('ok') is True and am2.get('code') == 'LEAVE_OVERLAP'
           and wk.get('code') == 'LEAVE_NO_DAYS' and bdec.get('_err') == 403 and elst.get('_err') == 403 and any(x.get('id') == r1.get('id') for x in lst.get('items', []))
           and ap.get('ok') is True and uses == '2|2.0' and short.get('code') == 'LEAVE_SHORT' and rj0.get('code') == 'LEAVE_REASON' and rj.get('state') == 'REJECTED'
           and cx.get('ok') is True and cx2.get('code') == 'LEAVE_STATE' and rv.get('ok') is True and net in ('0', '0.0') and 'ACCT_LEAVE_REQ' in guard
           and ar.get('ok') is True and self_.get('code') == 'HR_SELF',
           f"{r1.get('days')} {ov.get('code')} {am.get('days')} {pm.get('ok')} {am2.get('code')} {wk.get('code')} {bdec.get('_err')} {elst.get('_err')} {ap.get('ok') or ap.get('code')} {uses} {short.get('code')} {rj0.get('code')} {rj.get('state')} "
           f"{cx.get('ok')} {cx2.get('code')} {rv.get('ok') or rv.get('code')} {net} {guard[-40:]} {ar.get('ok') or ar.get('code')} {self_.get('code')}")
    finally:
        cleanup(); setting('hr.leave_allow_negative', s0 or 'off', '1446 되돌림'); rm_role(eid, '1446'); rm_role(aid, '1446')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
