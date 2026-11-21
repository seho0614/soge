"""v10.473 (D265 · docs/611) 회의실 · 장비 예약 — 자원 · 시간대 예약 · 같은 자원 시간 겹침은 DB 배제 제약이 막음(동시에 두 넣기도 하나만) · 취소 · 쓰지 않는 자원
  ① (코드) D265 자원 · 예약 표 · 배제 제약 · 설정 2 · 23P01 · 캘린더 읽기 함수 · API · 화면 · 문서 611
  ② (API · DB) 자원 넣기 · 예약 · 겹침 409 · 바로 뒤 됨 · 시각 422 4가지 · DB 직접 겹침 · 동시 넣기 하나만 · 못 고침 · 취소 권한 · 사유 · 다시 예약 · 범위 · 쓰지 않음
  ③ (화면) 사무 › 회의실 · 장비 예약
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


HB = rd('src/modules/acct/hrx-booking.ts')
RES_IDS = []


def cleanup():
    ids = ','.join(RES_IDS) or '0'
    psql(f"SET session_replication_role = replica; DELETE FROM hrx_bookings WHERE resource_id IN ({ids}); DELETE FROM hrx_resources WHERE id IN ({ids});")


ok('① 코드 — D265 예약 자원 · 예약 표 · 배제 제약(같은 자원 · [시작, 끝) · 취소 빠짐) · 가드 · 설정 2 · 겹침 409 · 23P01 잡음 · 캘린더 읽기 함수 · API · 화면 · 문서 611 · 판 v10.473',
   'CREATE TABLE IF NOT EXISTS public.hrx_resources' in M65 and 'CREATE TABLE IF NOT EXISTS public.hrx_bookings' in M65
   and "ex_hrx_booking_overlap EXCLUDE USING gist (resource_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (canceled_at IS NULL)" in M65
   and 'CREATE EXTENSION IF NOT EXISTS btree_gist' in M65 and "'hrx.book_ahead_days'" in M65 and "'hrx.book_max_hours'" in M65
   and "'HRX_BOOK_OVERLAP'" in HB and "'23P01'" in HB and 'export async function bookingCalItems' in HB
   and "@Post('hrx/booking')" in HC and "@Post('hrx/booking/:id/cancel')" in HC and "@Put('hrx/booking/resources/:id')" in HC
   and 'export function HrxBooking' in UI and "['hrx-booking', '회의실 · 장비 예약']" in MN and '"SB-ADM-HRX-030"' in SJ and '배제' in doc('611_') and VT >= (10, 473), VER)

if API and DB:
    import consent_ok, threading
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ee, eid, TE = staff('1473e', 'REVIEWER')
    fe, fid, TF = staff('1473f', 'PAYOUT')
    ae, aid, TA = staff('1473a', 'ADMIN')
    saved = hrx_defaults('1473')
    try:
        nm = f'시험회의실1473-{stamp}'
        r1 = call('POST', '/admin/hrx/booking/resources', {'kind': 'ROOM', 'name': nm, 'location': '3층', 'capacity': 6}, TA)
        if r1.get('id'): RES_IDS.append(r1['id'])
        dup = call('POST', '/admin/hrx/booking/resources', {'kind': 'ROOM', 'name': nm}, TA)
        r403 = call('POST', '/admin/hrx/booking/resources', {'kind': 'EQUIP', 'name': f'시험장비1473-{stamp}'}, TE)
        rid = r1.get('id')
        d2 = day(2)
        b1 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': d2, 'startHm': '10:00', 'endHm': '11:00', 'title': '시험 1473 회의'}, TE)
        b2 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': d2, 'startHm': '10:30', 'endHm': '11:30', 'title': '시험 1473 겹침'}, TF)
        b3 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': d2, 'startHm': '11:00', 'endHm': '12:00', 'title': '시험 1473 바로 뒤'}, TF)
        t1 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': d2, 'startHm': '12:00', 'endHm': '11:00', 'title': '거꾸로'}, TE)
        t2 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': day(-1), 'startHm': '10:00', 'endHm': '11:00', 'title': '지난 날'}, TE)
        t3 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': day(120), 'startHm': '10:00', 'endHm': '11:00', 'title': '먼 날'}, TE)
        t4 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': d2, 'startHm': '08:00', 'endHm': '17:30', 'title': '너무 김'}, TE)
        ok('② 예약 — 자원 넣기 · 같은 이름 409 · 담당 자원 넣기 403 · 예약 · 겹침 409 HRX_BOOK_OVERLAP · 바로 뒤(11:00 ~ 12:00) 됨 · 끝이 앞 422 · 지난 날 422 · 90일 넘음 422 · 8시간 넘음 422',
           r1.get('ok') is True and dup.get('code') == 'HRX_RESOURCE_DUP' and r403.get('_err') == 403 and b1.get('ok') is True and b2.get('code') == 'HRX_BOOK_OVERLAP'
           and b3.get('ok') is True and t1.get('code') == 'HRX_BOOK_TIME' and t2.get('code') == 'HRX_BOOK_TIME' and t3.get('code') == 'HRX_BOOK_TIME' and t4.get('code') == 'HRX_BOOK_TIME',
           f"{r1.get('ok') or r1.get('code')} {dup.get('code')} {r403.get('_err')} {b1.get('ok') or b1.get('code')} {b2.get('code')} {b3.get('ok') or b3.get('code')} {t1.get('code')} {t2.get('code')} {t3.get('code')} {t4.get('code')}")

        # DB 가 막음 — 서버를 거치지 않은 겹친 넣기 · 동시에 두 넣기(하나만 들어감)
        acc = psql(f"SELECT id FROM accounts WHERE email = '{ee}'")
        dx = psql(f"INSERT INTO hrx_bookings (resource_id, booked_by, title, start_at, end_at) VALUES ({rid}, '{acc}', '시험 DB 겹침', '{d2} 10:15:00+09', '{d2} 10:45:00+09')")
        d3 = day(3)
        outs = []
        def race(i):
            outs.append(psql(f"INSERT INTO hrx_bookings (resource_id, booked_by, title, start_at, end_at) VALUES ({rid}, '{acc}', '시험 동시 {i}', '{d3} 14:00:00+09', '{d3} 15:00:00+09') RETURNING id"))
        th = [threading.Thread(target=race, args=(i,)) for i in range(2)]
        [t.start() for t in th]; [t.join() for t in th]
        live = psql(f"SELECT count(*) FROM hrx_bookings WHERE resource_id = {rid} AND canceled_at IS NULL AND start_at = '{d3} 14:00:00+09'")
        g1 = psql(f"UPDATE hrx_bookings SET title = '고침' WHERE id = {int(b1.get('id') or 0)}")
        g2 = psql(f"DELETE FROM hrx_bookings WHERE id = {int(b1.get('id') or 0)}")
        ok('③ DB — 겹친 직접 넣기 배제 제약(ex_hrx_booking_overlap) · 동시에 같은 시간 두 넣기는 하나만 · 내용 못 고침 · 못 지움',
           'ex_hrx_booking_overlap' in dx and live == '1' and sum(1 for o in outs if 'ex_hrx_booking_overlap' in o or 'deadlock detected' in o) == 1 and 'HRX_BOOKING' in g1 and 'HRX_BOOKING' in g2,
           f"{dx[-50:]} {live} {[o[-30:] for o in outs]} {g1[-40:]} {g2[-40:]}")

        c403 = call('POST', f"/admin/hrx/booking/{b1.get('id')}/cancel", {}, TF)
        cr = call('POST', f"/admin/hrx/booking/{b1.get('id')}/cancel", {}, TA)
        c1 = call('POST', f"/admin/hrx/booking/{b1.get('id')}/cancel", {}, TE)
        c2 = call('POST', f"/admin/hrx/booking/{b1.get('id')}/cancel", {}, TE)
        b4 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': d2, 'startHm': '10:00', 'endHm': '11:00', 'title': '시험 1473 취소 뒤'}, TF)
        bd = call('GET', f'/admin/hrx/booking?from={d2}&to={d3}', None, TE)
        mine = [x for x in bd.get('items', []) if x.get('resourceId') == rid]
        rg = call('GET', f'/admin/hrx/booking?from={d2}&to={day(30)}', None, TE)
        ok('④ 취소 — 남의 예약 403 · 관리자 사유 없이 422 · 본인 취소 · 두 번 409 · 취소한 자리 다시 예약 · 현황(내 것 표시 · 남의 메모 안 보임) · 14일 넘는 범위 422',
           c403.get('code') == 'HRX_BOOK_OWNER' and cr.get('code') == 'HRX_BOOK_REASON' and c1.get('ok') is True and c2.get('code') == 'HRX_BOOK_STATE' and b4.get('ok') is True
           and len(mine) >= 3 and any(x.get('mine') is False for x in mine) and rg.get('code') == 'HRX_BOOK_RANGE',
           f"{c403.get('code')} {cr.get('code')} {c1.get('ok') or c1.get('code')} {c2.get('code')} {b4.get('ok') or b4.get('code')} {len(mine)} {rg.get('code')}")

        off = call('PUT', f'/admin/hrx/booking/resources/{rid}', {'active': False}, TA)
        b5 = call('POST', '/admin/hrx/booking', {'resourceId': rid, 'day': d2, 'startHm': '15:00', 'endHm': '16:00', 'title': '쓰지 않는 자원'}, TE)
        k0 = call('PUT', f'/admin/hrx/booking/resources/{rid}', {'kind': 'EQUIP'}, TA)
        ok('⑤ 자원 — 쓰지 않음(앞으로 예약 수 알림) · 쓰지 않는 자원 예약 422 · 종류 바꾸기 422',
           off.get('active') is False and (off.get('futureBookings') or 0) >= 2 and b5.get('code') == 'HRX_BOOK_RESOURCE' and k0.get('code') == 'HRX_RESOURCE',
           f"{off.get('active')} {off.get('futureBookings')} {b5.get('code')} {k0.get('code')}")
    finally:
        cleanup(); hrx_restore(saved, '1473'); rm_role(eid, '1473'); rm_role(fid, '1473'); rm_role(aid, '1473')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-hrx-booking]', timeout=30000); pg.wait_for_timeout(1000)
            seen['new'] = pg.locator('[data-hrx-book-new]').count()
            seen['res'] = pg.locator('[data-hrx-resources]').count()
        res = admin_page('/#/hrx-booking', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('⑥ 화면 — 사무 › 회의실 · 장비 예약 · 예약하기 · 자원 관리 · 화면 오류 없음', seen.get('new') == 1 and seen.get('res') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
