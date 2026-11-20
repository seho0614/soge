"""v10.472 (D265 · docs/610) 근무표 · 교대 — 교대 유형 · 주 근무표 · DB 가 유형 시각을 옮겨 적음 · 7일 잠금 · 근태와 다름(늦음 · 일찍 감 · 근태 없음 · 휴가 · 근무표에 없는 날) · 복사 · 내 근무표
  ① (코드) D265 유형 · 근무표 표 · 가드 · 여유 설정 · 다름 표시 · 복사 · API · 화면 · 문서 610
  ② (API · DB) 칸 저장 · 없는 유형 · 지난 칸 422 · DB 옮겨 적기 · 직접 고치기 막음 · 근태와 다름 5가지 · 유형(SUPER) · 복사(빈 칸만) · 내 인사
  ③ (화면) 회계 › 인사 › 근무표
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


HS = rd('src/modules/acct/hrx-shifts.ts')
TYPES = []


def cleanup():
    ts = ','.join(f"'{t}'" for t in TYPES) or "''"
    ids = ','.join(EMPS) or '0'
    psql(f"SET session_replication_role = replica; DELETE FROM hrx_shifts WHERE employee_id IN ({ids}) OR type_code IN ({ts}); DELETE FROM hrx_shift_types WHERE code IN ({ts});")
    emps_cleanup()


def cell(week, eid_, d, tok):
    w = call('GET', f'/admin/hrx/shifts?week={d}', None, tok)
    row = next((r for r in w.get('rows', []) if r.get('employeeId') == eid_), {})
    return next((c for c in row.get('cells', []) if c.get('day') == d), {}), row, w


ok('① 코드 — D265 교대 유형 · 근무표 표 · 처음 유형 5개 · 유형 시각 옮겨 적기 · 7일 잠금(HRX_SHIFT_PAST) · 여유 설정 · 근태와 다름 · 복사 · API · 화면 · 문서 610 · 판 v10.472',
   'CREATE TABLE IF NOT EXISTS public.hrx_shift_types' in M65 and 'CREATE TABLE IF NOT EXISTS public.hrx_shifts' in M65 and "('NIGHT', '야간', 'WORK', '22:00', '07:00', 60, true, 40)" in M65
   and 'NEW.start_hm := t.start_hm' in M65 and 'HRX_SHIFT_PAST' in M65 and "'hrx.shift_grace_min'" in M65
   and "flags.push('LATE')" in HS and "flags.push('UNPLANNED')" in HS and 'export async function copyLastWeek' in HS
   and "@Put('hrx/shifts')" in HC and "@Post('hrx/shifts/copy')" in HC and "@Put('hrx/shifts/types/:code')" in HC
   and 'export function HrxShifts' in UI and "['hrx-shifts', '근무표']" in MN and '"SB-ADM-HRX-020"' in SJ and '근무표' in doc('610_') and VT >= (10, 472), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ee, eid, TE = staff('1472e', 'REVIEWER')
    ae, aid, TA = staff('1472a', 'ADMIN')
    saved = hrx_defaults('1472')
    try:
        e1 = emp('1472a', eid); e2 = emp('1472b')
        y1, y2, t1, t2 = day(-1), day(-2), day(1), day(2)
        sv = call('PUT', '/admin/hrx/shifts', {'cells': [{'employeeId': e1, 'day': y1, 'type': 'DAY'}, {'employeeId': e1, 'day': y2, 'type': 'DAY'}, {'employeeId': e2, 'day': y2, 'type': 'DAY'},
                                                           {'employeeId': e1, 'day': t1, 'type': 'NIGHT'}, {'employeeId': e2, 'day': t1, 'type': 'OFF'}]}, TA)
        bad = call('PUT', '/admin/hrx/shifts', {'cells': [{'employeeId': e1, 'day': t2, 'type': 'NOPE'}]}, TA)
        past = call('PUT', '/admin/hrx/shifts', {'cells': [{'employeeId': e1, 'day': day(-10), 'type': 'DAY'}]}, TA)
        e403 = call('GET', '/admin/hrx/shifts', None, TE)
        row = psql(f"SELECT kind || '|' || start_hm || '|' || end_hm || '|' || break_min FROM hrx_shifts WHERE employee_id = {e1} AND work_on = '{t1}'")
        g1 = psql(f"UPDATE hrx_shifts SET start_hm = '10:00' WHERE employee_id = {e1} AND work_on = '{t1}'")
        g2 = psql(f"INSERT INTO hrx_shifts (employee_id, work_on, type_code) VALUES ({e1}, '{day(-10)}', 'DAY')")
        ch = call('PUT', '/admin/hrx/shifts', {'cells': [{'employeeId': e1, 'day': t1, 'type': 'EARLY'}]}, TA)
        row2 = psql(f"SELECT start_hm || '|' || end_hm FROM hrx_shifts WHERE employee_id = {e1} AND work_on = '{t1}'")
        ok('② 저장 — 5칸 · 없는 유형 422 · 7일 넘게 지난 칸 422 · 담당 403 · DB 가 유형 시각 옮겨 적음(야간 22 ~ 07 · 휴게 60) · 칸 시각 직접 고치기 막음 · DB 도 지난 칸 막음 · 유형 바꾸면 시각 바뀜',
           sv.get('saved') == 5 and bad.get('code') == 'HRX_SHIFT_TYPE' and past.get('code') == 'HRX_SHIFT_PAST' and e403.get('_err') == 403 and row == 'WORK|22:00|07:00|60'
           and 'HRX_SHIFT' in g1 and 'HRX_SHIFT_PAST' in g2 and ch.get('saved') == 1 and row2 == '07:00|16:00',
           f"{sv.get('saved') or sv.get('code')} {bad.get('code')} {past.get('code')} {e403.get('_err')} {row} {g1[-40:]} {g2[-40:]} {ch.get('saved')} {row2}")

        # 근태 — e1 어제 09:30 ~ 17:00(늦음 · 일찍 감) · e1 그제 근태 없음(근태 없음) · e2 그제 휴가(휴가) · e2 어제 근무표 없이 일함(근무표에 없는 날)
        psql(f"INSERT INTO acct_attendance (employee_id, work_on, in_at, out_at) VALUES ({e1}, '{y1}', '{y1} 09:30:00+09', '{y1} 17:00:00+09'), ({e2}, '{y1}', '{y1} 09:00:00+09', '{y1} 18:00:00+09')")
        psql(f"INSERT INTO acct_leave_uses (employee_id, used_on, days, note) VALUES ({e2}, '{y2}', 1, '시험 1472 휴가')")
        c1, r1, w1 = cell(None, e1, y1, TA)
        c2, _, _ = cell(None, e1, y2, TA)
        c3, _, _ = cell(None, e2, y2, TA)
        c4, _, _ = cell(None, e2, y1, TA)
        ok('③ 근태와 다름 — 늦음 · 일찍 감 · 근태 없음 · 휴가 · 근무표에 없는 날 일함 · 근태 시각 보임 · 주 계획 시간 · 다른 칸 수',
           set(c1.get('flags') or []) == {'LATE', 'EARLY'} and (c1.get('att') or {}).get('inHm') == '09:30' and c2.get('flags') == ['ABSENT'] and c3.get('flags') == ['LEAVE']
           and c4.get('flags') == ['UNPLANNED'] and isinstance(r1.get('plannedHours'), (int, float)) and r1.get('plannedHours') > 0 and (w1.get('diffs') or 0) >= 2,
           f"{c1.get('flags')} {c1.get('att')} {c2.get('flags')} {c3.get('flags')} {c4.get('flags')} {r1.get('plannedHours')} {w1.get('diffs')}")

        # 유형(SUPER) · 복사 · 내 근무표
        code = f'T{stamp}'
        tt = call('PUT', f'/admin/hrx/shifts/types/{code}', {'name': '시험 1472', 'kind': 'WORK', 'startHm': '10:00', 'endHm': '19:00', 'breakMin': 60, 'sort': 900}, TS)
        if tt.get('ok'): TYPES.append(code)
        t403 = call('PUT', f'/admin/hrx/shifts/types/{code}', {'name': '고침'}, TA)
        tk = call('PUT', f'/admin/hrx/shifts/types/{code}', {'kind': 'OFF'}, TS)
        tb = call('PUT', '/admin/hrx/shifts/types/lower', {'name': 'x'}, TS)
        call('PUT', '/admin/hrx/shifts', {'cells': [{'employeeId': e2, 'day': t2, 'type': code}]}, TA)
        mon_next = day(7 - kst.weekday())
        before = psql(f"SELECT count(*) FROM hrx_shifts WHERE employee_id IN ({e1}, {e2}) AND work_on >= '{mon_next}'")
        cp = call('POST', '/admin/hrx/shifts/copy', {'week': mon_next}, TA)
        after = psql(f"SELECT count(*) FROM hrx_shifts WHERE employee_id IN ({e1}, {e2}) AND work_on >= '{mon_next}'")
        cp2 = call('POST', '/admin/hrx/shifts/copy', {'week': mon_next}, TA)
        after2 = psql(f"SELECT count(*) FROM hrx_shifts WHERE employee_id IN ({e1}, {e2}) AND work_on >= '{mon_next}'")
        mine = call('GET', '/admin/me/hrx', None, TE)
        md = next((x for x in (mine.get('shifts') or {}).get('days', []) if x.get('day') == t1), {})
        ok('④ 유형 · 복사 · 내 근무표 — SUPER 새 유형 · ADMIN 403 · 종류 바꾸기 422 · 코드 모양 422 · 이번 주 → 다음 주 복사(빈 칸만 · 두 번째는 늘지 않음) · 내 인사에 내 칸(조출)',
           tt.get('created') is True and t403.get('_err') == 403 and tk.get('code') == 'HRX_SHIFT_TYPE' and tb.get('code') == 'HRX_SHIFT_TYPE'
           and int(after or 0) > int(before or 0) and after2 == after and (md.get('shift') or {}).get('code') == 'EARLY',
           f"{tt.get('created') or tt.get('code')} {t403.get('_err')} {tk.get('code')} {tb.get('code')} {before}→{after}→{after2} {cp.get('copied')} {cp2.get('copied')} {md}")
    finally:
        cleanup(); hrx_restore(saved, '1472'); rm_role(eid, '1472'); rm_role(aid, '1472')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-hrx-shifts]', timeout=30000); pg.wait_for_timeout(1000)
            seen['grid'] = pg.locator('[data-hrx-shift-grid]').count()
            seen['copy'] = pg.locator('[data-hrx-shift-copy]').count()
        res = admin_page('/#/hrx-shifts', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('⑤ 화면 — 회계 › 인사 › 근무표 · 주 칸 · 지난주 복사 · 화면 오류 없음', seen.get('grid') == 1 and seen.get('copy') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
