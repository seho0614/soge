"""v10.471 (D265 · docs/609) 연장 · 야간 · 휴일 근로 — 신청 → 승인(본인 아님) · DB 가 분 · 야간 · 날 종류 셈 · 겹침 배제 제약 · 주 52시간 한도 · 근태와 비교 · 수당을 급여 대장으로
  ① (코드) D265 연장 근로 표 · 배제 제약 · 넘김 기록 · 설정 6 · 정기 작업 hrx_ot_week · 수당 셈 · API · 화면 · 연결 · 문서 609
  ② (API · DB) 본인 신청 · 겹침 409 · 본인 승인 403 · 먼 해 한 주(분 · 야간 240 · 휴일 · 토요일 휴무일) · 주 한도 422 · 규칙(SUPER) · 수당 30,000 · 160,000 · 급여 대장 넘김 · 되돌림 · 확정 뒤 409 · 주 경고 알림
  ③ (화면) 회계 › 인사 › 연장 근로
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


M65 = migr('D265_')
HC = rd('src/modules/acct/hrx.controller.ts')
UI = rd('web/src/app/admin/Hrx.tsx')
AP, MN, AM, SC, WK = rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
T0 = psql("SELECT now()")
EMPS = []
HRX_KEYS = {'hrx.ot_rates': 'OT:50,NIGHT:50,HOL:50,HOL8:100', 'hrx.week_limits': 'BASE:40,OT:12,WARN:48', 'hrx.std_month_hours': '209', 'hrx.ot_over_block': 'on',
            'hrx.sat_as_holiday': 'off', 'hrx.ot_pay_basis': 'MIN', 'hrx.shift_grace_min': '10', 'hrx.book_ahead_days': '90', 'hrx.book_max_hours': '8'}


def day(n, base=None):
    b = base or kst
    return (b + datetime.timedelta(days=n)).strftime('%Y-%m-%d')


def hrx_defaults(tag):
    """hrx.* 설정을 처음 값으로(시험 동안) — 되돌릴 옛 값을 돌려줌"""
    saved = {k: getset(k) for k in HRX_KEYS}
    for k, v in HRX_KEYS.items():
        setting(k, v, tag)
    return saved


def hrx_restore(saved, tag):
    for k, v in saved.items():
        setting(k, v or HRX_KEYS[k], f'{tag} 되돌림')


def emp(tag, account_id=None, joined_days=60, base=2090000):
    j = (kst - datetime.timedelta(days=joined_days)).strftime('%Y-%m-%d')
    acc = f"'{account_id}'" if account_id else 'NULL'
    e = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, account_id) VALUES ('시험직원{tag}-{stamp}', '{j}', {base}, {acc}) RETURNING id").split('\n')[0]
    if e.isdigit():
        EMPS.append(e)
    return e


def staff(tag, role):
    em, aid = mk_staff(tag, role)
    __import__('consent_ok').agree(em, PW)
    return em, aid, login(em)


def emps_cleanup():
    """시험 직원과 그 직원에 붙은 근태 · 연장 근로 · 근무표 줄을 지움(replica)"""
    if EMPS:
        ids = ','.join(EMPS)
        psql("SET session_replication_role = replica; "
             f"DELETE FROM hrx_ot_pay_links WHERE request_id IN (SELECT id FROM hrx_ot_requests WHERE employee_id IN ({ids})); "
             f"DELETE FROM hrx_ot_requests WHERE employee_id IN ({ids}); DELETE FROM hrx_shifts WHERE employee_id IN ({ids}); "
             f"DELETE FROM acct_attendance_fixes WHERE attendance_id IN (SELECT id FROM acct_attendance WHERE employee_id IN ({ids})); "
             f"DELETE FROM acct_attendance WHERE employee_id IN ({ids}); DELETE FROM acct_leave_uses WHERE employee_id IN ({ids}); "
             f"DELETE FROM acct_payroll_lines WHERE employee_id IN ({ids}); "
             f"UPDATE acct_employees SET account_id = NULL WHERE id IN ({ids}); DELETE FROM acct_employees WHERE id IN ({ids});")


HO = rd('src/modules/acct/hrx-overtime.ts')
RUNS = []


def cleanup():
    rid = ','.join(RUNS) or '0'
    psql("SET session_replication_role = replica; "
         f"DELETE FROM hrx_ot_pay_links WHERE run_id IN ({rid}); "
         f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('PAYROLL', 'PAYROLL_PAID') AND source_key IN (SELECT id::text FROM acct_payroll_runs WHERE id IN ({rid}))); "
         f"DELETE FROM acct_entries WHERE source IN ('PAYROLL', 'PAYROLL_PAID') AND source_key IN (SELECT id::text FROM acct_payroll_runs WHERE id IN ({rid})); "
         f"DELETE FROM acct_payroll_lines WHERE run_id IN ({rid}); DELETE FROM acct_payroll_runs WHERE id IN ({rid}); "
         f"DELETE FROM ops_alerts WHERE alert_code = 'HRX_OT_WEEK' AND raised_at >= '{T0}';")
    emps_cleanup()


ok('① 코드 — D265 연장 근로 표 · 배제 제약 · 넘김 기록 · 가드 · 설정 6 · 정기 작업 hrx_ot_week · 수당 셈 · 주 한도 · 급여 대장 넘김(updateLine) · API · 화면 · 연결 · 문서 609 · 판 v10.471',
   'CREATE TABLE IF NOT EXISTS public.hrx_ot_requests' in M65 and 'ex_hrx_ot_overlap EXCLUDE USING gist' in M65 and 'CREATE TABLE IF NOT EXISTS public.hrx_ot_pay_links' in M65
   and 'fn_hrx_ot_guard' in M65 and all(k in M65 for k in ("'hrx.ot_rates'", "'hrx.week_limits'", "'hrx.std_month_hours'", "'hrx.ot_over_block'", "'hrx.sat_as_holiday'", "'hrx.ot_pay_basis'"))
   and "'hrx_ot_week'" in M65 and 'export function hrxOtPay' in HO and "'HRX_OT_LIMIT'" in HO and 'await updateLine(db' in HO and 'export async function otWeekJob' in HO
   and "@Post('hrx/overtime/:id/decide')" in HC and "@Post('hrx/overtime/payroll')" in HC and "@Post('me/hrx/overtime')" in HC
   and 'export function HrxOvertime' in UI and "['hrx-overtime', '연장 근로']" in MN and 'HrxController' in AM and "case 'hrx_ot_week'" in SC and "'hrx_ot_week'" in WK
   and '"SB-ADM-HRX-010"' in SJ and '노무사' in doc('609_') and VT >= (10, 471), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ee, eid, TE = staff('1471e', 'REVIEWER')
    ae, aid, TA = staff('1471a', 'ADMIN')
    saved = hrx_defaults('1471')
    try:
        e1 = emp('1471a', eid); e2 = emp('1471b', aid)
        # ── 본인 신청 · 겹침 · 날짜 · 본인 승인 막음 · 권한 ──
        d3 = day(3)
        m1 = call('POST', '/admin/me/hrx/overtime', {'workOn': d3, 'startHm': '18:00', 'endHm': '21:00', 'reason': '시험 1471 연장'}, TE)
        m2 = call('POST', '/admin/me/hrx/overtime', {'workOn': d3, 'startHm': '19:00', 'endHm': '20:00', 'reason': '시험 1471 겹침'}, TE)
        m3 = call('POST', '/admin/me/hrx/overtime', {'workOn': day(40), 'startHm': '18:00', 'endHm': '19:00', 'reason': '시험 1471 먼 날'}, TE)
        m4 = call('POST', '/admin/me/hrx/overtime', {'workOn': d3, 'startHm': '25:00', 'endHm': '19:00', 'reason': '시험'}, TE)
        a1 = call('POST', '/admin/me/hrx/overtime', {'workOn': d3, 'startHm': '18:00', 'endHm': '19:00', 'reason': '시험 1471 관리자 본인'}, TA)
        self403 = call('POST', f"/admin/hrx/overtime/{a1.get('id')}/decide", {'decision': 'APPROVE'}, TA)
        e403, b403 = call('GET', '/admin/hrx/overtime', None, TE), call('GET', '/admin/hrx/overtime', None, TB)
        rj0 = call('POST', f"/admin/hrx/overtime/{m1.get('id')}/decide", {'decision': 'REJECT'}, TA)
        ap1 = call('POST', f"/admin/hrx/overtime/{m1.get('id')}/decide", {'decision': 'APPROVE'}, TA)
        cn1 = call('POST', f"/admin/me/hrx/overtime/{m1.get('id')}/cancel", None, TE)
        me = call('GET', '/admin/me/hrx', None, TE)
        ls = call('GET', f"/admin/hrx/overtime?ym={d3[:7]}", None, TA)
        it = next((x for x in ls.get('items', []) if x.get('id') == m1.get('id')), {})
        ok('② 신청 — 본인 신청 180분 · 겹침 409 · 31일 넘는 날 422 · 시각 400 · 관리자 본인 신청 승인 403 · 담당 · 회원 목록 403 · 사유 없는 반려 422 · 승인 · 승인 뒤 본인 취소 409 · 내 인사에 보임 · 목록에 근태 비교 칸',
           m1.get('ok') is True and m1.get('minutes') == 180 and m2.get('code') == 'HRX_OT_OVERLAP' and m3.get('code') == 'HRX_OT_DATE' and m4.get('_err') == 400
           and a1.get('ok') is True and self403.get('code') == 'HR_SELF' and e403.get('_err') == 403 and b403.get('_err') == 403 and rj0.get('code') == 'HRX_OT_REASON'
           and ap1.get('state') == 'APPROVED' and cn1.get('code') == 'HRX_OT_STATE' and me.get('linked') is True and any(x.get('id') == m1.get('id') for x in (me.get('overtime') or {}).get('items', []))
           and it.get('state') == 'APPROVED' and it.get('flag') == 'FUTURE' and 'pay' in it,
           f"{m1.get('ok') or m1.get('code')} {m1.get('minutes')} {m2.get('code')} {m3.get('code')} {m4.get('_err')} {a1.get('ok') or a1.get('code')} {self403.get('code')} {e403.get('_err')} {b403.get('_err')} "
           f"{rj0.get('code')} {ap1.get('state') or ap1.get('code')} {cn1.get('code')} {me.get('linked')} {it.get('flag')}")

        # ── 먼 해(2093)의 한 주 — DB 가 분 · 야간 · 날 종류를 셈 · 주 한도 · 급여 대장 ──
        YR = 2093
        used = psql(f"SELECT coalesce(string_agg(ym, ','), '') FROM acct_payroll_runs WHERE ym LIKE '{YR}-%'").split(',')
        mon = next((m for m in [(stamp + i) % 12 + 1 for i in range(12)] if f'{YR}-{m:02d}' not in used), 12)
        YM = f'{YR}-{mon:02d}'
        first = datetime.date(YR, mon, 1)
        M = first + datetime.timedelta(days=(7 - first.weekday()) % 7 or 7)   # 그 달 첫 월요일(1일이면 다음 주)
        Md, Tu, Sa, Su = M.isoformat(), (M + datetime.timedelta(days=1)).isoformat(), (M + datetime.timedelta(days=5)).isoformat(), (M + datetime.timedelta(days=6)).isoformat()
        def ins(d, s, e, next_day=False):
            e_day = (datetime.date.fromisoformat(d) + datetime.timedelta(days=1)).isoformat() if next_day else d
            return psql(f"INSERT INTO hrx_ot_requests (employee_id, work_on, start_at, end_at, reason) VALUES ({e1}, '{d}', '{d} {s}:00+09', '{e_day} {e}:00+09', '시험 1471 먼 해') RETURNING id || '|' || minutes || '|' || night_min || '|' || day_kind").split('\n')[0]
        r1 = ins(Md, '18:00', '21:00').split('|')
        r2 = ins(Su, '10:00', '20:00').split('|')
        r3 = ins(Tu, '22:00', '02:00', True).split('|')
        r4 = ins(Sa, '10:00', '11:00').split('|')
        ovl = psql(f"INSERT INTO hrx_ot_requests (employee_id, work_on, start_at, end_at, reason) VALUES ({e1}, '{Md}', '{Md} 19:00:00+09', '{Md} 20:00:00+09', '시험 겹침')")
        g1 = psql(f"UPDATE hrx_ot_requests SET reason = '고침' WHERE id = {int(r1[0] or 0)}")
        g2 = psql(f"DELETE FROM hrx_ot_requests WHERE id = {int(r1[0] or 0)}")
        ok('③ DB — 분 180 · 일요일 휴일 600 · 화 22 ~ 02시 야간 240 · 토요일 휴무일(연장) · 같은 직원 시간 겹침 배제 제약이 막음 · 내용 못 고침 · 못 지움',
           r1[1:] == ['180', '0', 'WORKDAY'] and r2[1:] == ['600', '0', 'HOLIDAY'] and r3[1:] == ['240', '240', 'WORKDAY'] and r4[3:] == ['OFFDAY']
           and 'ex_hrx_ot_overlap' in ovl and 'HRX_OT' in g1 and 'HRX_OT' in g2, f"{r1} {r2} {r3} {r4} {ovl[-50:]} {g1[-40:]} {g2[-40:]}")

        ok1 = call('POST', f"/admin/hrx/overtime/{r1[0]}/decide", {'decision': 'APPROVE'}, TA)
        lim = call('POST', f"/admin/hrx/overtime/{r2[0]}/decide", {'decision': 'APPROVE'}, TA)
        rl403 = call('PUT', '/admin/hrx/overtime/rules', {'block': False, 'reason': '시험 1471'}, TA)
        rlbad = call('PUT', '/admin/hrx/overtime/rules', {'rates': 'OT:50', 'reason': '시험 1471'}, TS)
        rl = call('PUT', '/admin/hrx/overtime/rules', {'block': False, 'reason': '시험 1471 한도 끔'}, TS)
        ok2 = call('POST', f"/admin/hrx/overtime/{r2[0]}/decide", {'decision': 'APPROVE'}, TA)
        setting('hrx.ot_over_block', 'on', '1471 다시 켬')
        ok('④ 주 한도 — 승인 180분 · 일요일 600분 승인하면 780분 > 720분 422 HRX_OT_LIMIT · 규칙 고치기 ADMIN 403 · 모양 틀림 400 · SUPER 가 막기 끔 · 승인됨 · 경고',
           ok1.get('state') == 'APPROVED' and lim.get('code') == 'HRX_OT_LIMIT' and rl403.get('_err') == 403 and rlbad.get('_err') == 400 and rl.get('ok') is True
           and ok2.get('state') == 'APPROVED' and ok2.get('weekApproved') == 780 and bool(ok2.get('warning')),
           f"{ok1.get('state') or ok1.get('code')} {lim.get('code')} {rl403.get('_err')} {rlbad.get('_err')} {rl.get('ok') or rl.get('code')} {ok2.get('state') or ok2.get('code')} {ok2.get('weekApproved')}")

        # 근태(MIN 기준) — 월 09:00 ~ 20:00(신청 18 ~ 21 과 겹침 120분) · 일 09:00 ~ 21:00(600분 다 겹침)
        psql(f"INSERT INTO acct_attendance (employee_id, work_on, in_at, out_at) VALUES ({e1}, '{Md}', '{Md} 09:00:00+09', '{Md} 20:00:00+09'), ({e1}, '{Su}', '{Su} 09:00:00+09', '{Su} 21:00:00+09')")
        nr = call('POST', '/admin/hrx/overtime/payroll', {'ym': YM}, TS)
        run = call('POST', '/admin/acct/payroll/runs', {'ym': YM}, TS)
        if run.get('id'): RUNS.append(run['id'])
        pv = call('GET', f'/admin/hrx/overtime/payroll?ym={YM}', None, TA)
        pays = sorted(int(x.get('pay') or 0) for x in pv.get('ready', []) if x.get('employeeId') == e1)
        flags = sorted(x.get('flag') for x in pv.get('ready', []) if x.get('employeeId') == e1)
        p403 = call('POST', '/admin/hrx/overtime/payroll', {'ym': YM}, TA)
        g0 = psql(f"SELECT gross FROM acct_payroll_lines WHERE run_id = {int(run.get('id') or 0)} AND employee_id = {e1}")
        ps = call('POST', '/admin/hrx/overtime/payroll', {'ym': YM}, TS)
        g1x = psql(f"SELECT gross || '|' || (net = gross - income_tax - local_tax - np - hi - ltc - ei) FROM acct_payroll_lines WHERE run_id = {int(run.get('id') or 0)} AND employee_id = {e1}")
        ps2 = call('POST', '/admin/hrx/overtime/payroll', {'ym': YM}, TS)
        rv = call('POST', f"/admin/hrx/overtime/{r1[0]}/revoke", {'reason': '시험 1471'}, TA)
        un = call('POST', '/admin/hrx/overtime/payroll/undo', {'ym': YM}, TS)
        g2x = psql(f"SELECT gross FROM acct_payroll_lines WHERE run_id = {int(run.get('id') or 0)} AND employee_id = {e1}")
        lk = psql(f"SELECT count(*) FROM hrx_ot_pay_links WHERE run_id = {int(run.get('id') or 0)}")
        ok('⑤ 급여 대장 — 대장 없으면 422 · 미리보기 수당 30,000(겹친 120분 × 150%) · 160,000(휴일 480분 150% + 120분 200%) · 근태 짧음 표시 · ADMIN 넘기기 403 · SUPER 넘김 2건 190,000 · 지급액 2,090,000 → 2,280,000 · 다시 셈(실지급 맞음) · 두 번째 0건 · 넘긴 승인 취소 409 · 되돌리기 · 지급액 되돌아옴 · 넘김 기록 0',
           nr.get('code') == 'HRX_OT_NO_RUN' and bool(run.get('id')) and pays == [30000, 160000] and 'SHORT' in flags and p403.get('_err') == 403 and g0 == '2090000'
           and ps.get('pushed') == 2 and ps.get('amount') == 190000 and g1x == '2280000|t' and ps2.get('pushed') == 0 and rv.get('code') == 'HRX_OT_PAID'
           and un.get('undone') == 2 and g2x == '2090000' and lk == '0',
           f"{nr.get('code')} {run.get('id') or run.get('code')} {pays} {flags} {p403.get('_err')} {g0} {ps.get('pushed') or ps.get('code')} {ps.get('amount')} {g1x} {ps2.get('pushed')} {rv.get('code')} {un.get('undone') or un.get('code')} {g2x} {lk}")

        ps3 = call('POST', '/admin/hrx/overtime/payroll', {'ym': YM}, TS)
        fx = call('POST', f"/admin/acct/payroll/runs/{run.get('id')}/fix", None, TS)
        un2 = call('POST', '/admin/hrx/overtime/payroll/undo', {'ym': YM}, TS)
        dl = psql(f"DELETE FROM hrx_ot_pay_links WHERE run_id = {int(run.get('id') or 0)}")
        ps4 = call('POST', '/admin/hrx/overtime/payroll', {'ym': YM}, TS)
        ok('⑥ 확정 뒤 — 다시 넘김 · 급여 확정 · 되돌리기 409 · DB 도 넘김 기록 지우기 막음 · 넘기기 409',
           ps3.get('pushed') == 2 and fx.get('ok') is True and un2.get('code') == 'HRX_OT_RUN_FIXED' and 'HRX_OT_PAY' in dl and ps4.get('code') == 'HRX_OT_RUN_FIXED',
           f"{ps3.get('pushed') or ps3.get('code')} {fx.get('ok') or fx.get('code')} {un2.get('code')} {dl[-40:]} {ps4.get('code')}")

        # ── 정기 작업 — 이번 주 월요일 10시간 → 경고 넘음 1명 이상 ──
        monday = (kst.date() - datetime.timedelta(days=kst.weekday())).isoformat()
        wk = call('POST', '/admin/hrx/overtime', {'employeeId': e1, 'workOn': monday, 'startHm': '08:00', 'endHm': '18:00', 'reason': '시험 1471 주 경고'}, TA)
        jb = call('POST', '/admin/jobs', {'job': 'hrx_ot_week'}, TS)
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'HRX_OT_WEEK' AND resolved_at IS NULL AND detail->>'key' = '{monday}' AND (detail->>'count')::int >= 1")
        ok('⑦ 주 52시간 경고 — 관리자 대신 신청 600분 · 경고 · 정기 작업 hrx_ot_week · 운영 알림 HRX_OT_WEEK(이번 주 · 수만)',
           wk.get('ok') is True and bool(wk.get('warning')) and al == '1', f"{wk.get('ok') or wk.get('code')} {wk.get('warning')} {jb} {al}")
    finally:
        cleanup(); hrx_restore(saved, '1471'); rm_role(eid, '1471'); rm_role(aid, '1471')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-hrx-overtime]', timeout=30000); pg.wait_for_timeout(1000)
            seen['for'] = pg.locator('[data-hrx-ot-for]').count()
            seen['rules'] = pg.locator('[data-hrx-ot-rules]').count()
        res = admin_page('/#/hrx-overtime', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('⑧ 화면 — 회계 › 인사 › 연장 근로 · 대신 신청 · 규칙 · 화면 오류 없음', seen.get('for') == 1 and seen.get('rules') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
