"""v10.581 (docs/723) 연차 사용 촉진 — 근로기준법 61조 일반 원칙(1차 남은 연차 알림 · 직원 계획 · 2차 쓸 날 지정 · 본인 확인)
  ① (코드) SQL hra_leave_promos · 설정 · 정기 작업 hra_daily · 권한 시드 · hr.ts remaining export · API 6 · 화면 · 메뉴 · 화면 목록 · 문서 723 · 판
  ② (DB · API) 보기 · 설정(SUPER · 2차 < 1차) · 1차 만들기(1년 미만 빼고 · 다시 눌러도 건너뜀) · 본인 확인 · 계획 · 2차 지정 · DB 지킴
  ③ (화면) 회계 › 인사 › 연차 사용 촉진
  (두 번 돌아도 통과 — 「시험직원1581-」 직원 · 연차 · 촉진 기록과 시작 뒤 만든 촉진 줄은 replica 로 지움 · 설정은 처음 값으로 되돌림)
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


def mig_has(word):
    """13차 SQL 은 메인이 D292 ~ 에 붙임(번호 모름) — 글자가 든 마이그레이션 하나를 찾아 돌려줌"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


def biz_days(n, year):
    """오늘 뒤 그 해 안 영업일 n개(없으면 짧은 목록)"""
    r = psql(f"SELECT string_agg(d::date::text, ',' ORDER BY d) FROM (SELECT d FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date + 1, '{year}-12-31'::date, interval '1 day') d WHERE fn_is_business_day(d::date) ORDER BY d LIMIT {n}) x")
    return [x for x in (r or '').split(',') if re.match(r'^\d{4}-\d{2}-\d{2}$', x)]

"""시험 몸통"""
M = mig_has('CREATE TABLE IF NOT EXISTS public.hra_leave_promos')
LP = rd('src/modules/acct/hra-leave-promo.ts')
HC = rd('src/modules/acct/hra.controller.ts')
CM = rd('src/modules/acct/hra-common.ts')
HR = rd('src/modules/acct/hr.ts')
SC = rd('src/worker/scheduler.service.ts')
UI = rd('web/src/app/admin/Hra.tsx')
MN = rd('web/src/lib/adminMenu.ts')
AP = rd('web/src/App.tsx')
ok('① 코드 — SQL hra_leave_promos(지움 막음 · 상태 앞으로만) · 설정 4(처음 off · 6 · 2 · 10) · hra_daily · 권한 시드 · remaining export · 연차 촉진 함수 · API 6 · 정기 작업 · 화면 · 메뉴 · 화면 목록 HRA-010 · 015 · 문서 723 · 판 v10.581',
   'trg_hra_leave_promo_guard' in M and "('hra.leave_promo', 'off'" in M and "('hra.leave_promo_first_months', '6'" in M and "('hra.leave_promo_second_months', '2'" in M
   and "('hra.leave_promo_reply_days', '10'" in M and "('hra_daily', 1440, 9, 50" in M and "('hra-leave-promo', '연차 사용 촉진', 'admacc'" in M
   and 'export async function remaining(' in HR and 'export function promoWindow' in LP and 'export async function leavePromoJob' in LP and "'HRA_LEAVE_PROMO'" in LP
   and "@Get('hr/leave-promo')" in HC and "@Post('hr/leave-promo/issue')" in HC and "@Post('hr/leave-promo/:id/designate')" in HC
   and "@Get('me/hr/leave-promo')" in HC and "@Post('me/hr/leave-promo/:id/plan')" in HC and "@Post('me/hr/leave-promo/:id/ack')" in HC
   and "'hra.leave_promo_second_months': '^([1-9]|10)$'" in CM and "case 'hra_daily'" in SC
   and 'export function HraLeavePromo' in UI and 'export function MyLeavePromo' in UI and "['hra-leave-promo', '연차 사용 촉진']" in MN and "'hra-leave-promo': ['SUPER', 'ADMIN']" in AP
   and '<MyLeavePromo />' in AP and '"SB-ADM-HRA-010"' in SJ and '"SB-ADM-HRA-015"' in SJ and '근로기준법 61조' in doc('723_') and VT >= (10, 581), VER)

STAMP = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, year = kst.strftime('%Y-%m-%d'), kst.year
EMP = f'시험직원1581-{STAMP}'
CLEAN = ("SET session_replication_role = replica; "
         "DELETE FROM hra_leave_promos WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1581-%'); "
         "DELETE FROM acct_leave_grants WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1581-%'); "
         "DELETE FROM acct_employees WHERE name LIKE '시험직원1581-%';")
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    psql(CLEAN)
    T0 = psql("SELECT now()")
    keep = {k: getset(k) for k in ('hra.leave_promo_first_months', 'hra.leave_promo_second_months', 'hra.leave_promo_reply_days')}
    le, lid = mk_staff(f'1581l{STAMP % 97}', 'REVIEWER'); consent_ok.agree(le, PW); TL = login(le)
    pe, pid = mk_staff(f'1581p{STAMP % 97}', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    ae, aid = mk_staff(f'1581a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    try:
        j = (kst - datetime.timedelta(days=800)).strftime('%Y-%m-%d')
        E1 = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, account_id) VALUES ('{EMP}a', '{j}', 3000000, '{lid}') RETURNING id").split('\n')[0]
        E2 = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base) VALUES ('{EMP}b', '{j}', 3000000) RETURNING id").split('\n')[0]
        E3 = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base) VALUES ('{EMP}c', '{today}', 3000000) RETURNING id").split('\n')[0]
        g = psql(f"INSERT INTO acct_leave_grants (employee_id, year, days, note) VALUES ({E1}, {year}, 15, '시험 1581'), ({E2}, {year}, 15, '시험 1581'), ({E3}, {year}, 1, '시험 1581')")
        v0 = call('GET', f'/admin/hr/leave-promo?year={year}', None, TS)
        row = lambda v, e: next((r for r in (v.get('rows') or []) if r.get('employeeId') == e), {})
        p403 = call('GET', f'/admin/hr/leave-promo?year={year}', None, TP)
        ok('② 보기 — 직원 줄 · 남은 15 · 다음 「1차 만들 차례」 · 1년 미만은 대상 아님 · 기간 · 설정 처음 off · 지급 담당 403',
           E1.isdigit() and '!' not in g and row(v0, E1).get('remaining') == 15 and row(v0, E1).get('next') == 'ISSUE' and row(v0, E3).get('eligible') is False
           and row(v0, E3).get('next') == 'FIRST_YEAR' and (v0.get('window') or {}).get('end') == f'{year}-12-31' and (v0.get('settings') or {}).get('on') is False and p403.get('_err') == 403,
           f"{E1} {g[-40:]} {row(v0, E1)} {row(v0, E3).get('next')} {v0.get('window')} {v0.get('settings')} {p403.get('_err')}")
        sa = call('PUT', '/admin/hra/settings', {'secondMonths': 1, 'reason': '시험 1581'}, TA)
        sb = call('PUT', '/admin/hra/settings', {'secondMonths': 7, 'reason': '시험 1581'}, TS)
        s1 = call('PUT', '/admin/hra/settings', {'secondMonths': 1, 'reason': '시험 1581 — 2차 기한을 이달 말로'}, TS)
        ok('② 설정 — ADMIN 403 · 2차 ≥ 1차 이면 422 · SUPER 바꿈(2차 1개월)',
           sa.get('_err') == 403 and sb.get('code') == 'HRA_SETTING_VALUE' and s1.get('ok') is True and (s1.get('settings') or {}).get('secondMonths') == 1,
           f"{sa.get('_err')} {sb.get('code')} {s1.get('ok') or s1}")
        if today > f'{year}-11-30':
            i1 = call('POST', '/admin/hr/leave-promo/issue', {'year': year}, TS)
            ok('② 12월 — 2차 기한(가장 늦게 11/30)이 지나 1차 만들기 422(나머지는 건너뜀)', i1.get('code') == 'HRA_LEAVE_PROMO_LATE', f"{i1.get('code') or i1}")
        else:
            i1 = call('POST', '/admin/hr/leave-promo/issue', {'year': year}, TS)
            r1 = psql(f"SELECT round || '|' || state || '|' || unused_days || '|' || (reply_due - issued_on) FROM hra_leave_promos WHERE employee_id = {E1} AND year = {year}")
            none3 = psql(f"SELECT count(*) FROM hra_leave_promos WHERE employee_id = {E3}")
            i2 = call('POST', '/admin/hr/leave-promo/issue', {'year': year}, TS)
            ok('② 1차 만들기 — 남은 15 · 기한 10일 · 기간 밖 경고 · 1년 미만 안 만듦 · 다시 눌러도 같은 직원은 건너뜀',
               i1.get('ok') is True and int(i1.get('made') or 0) >= 2 and r1 == '1|ISSUED|15.0|10' and none3 == '0' and i1.get('outOfWindow') in (True, False)
               and (i1.get('warning') is None) == (i1.get('outOfWindow') is False) and i2.get('ok') is True and any(x.get('employeeId') == E1 and x.get('why') == 'EXISTS' for x in i2.get('skipped') or []),
               f"{i1.get('made') or i1} {r1} {none3} {i1.get('outOfWindow')} {str(i1.get('warning'))[:30]} {i2.get('made')}")
            m1 = call('GET', '/admin/me/hr/leave-promo', None, TL)
            pr = next((x for x in m1.get('items') or [] if x.get('round') == 1 and x.get('year') == year), {})
            a1 = call('POST', f"/admin/me/hr/leave-promo/{pr.get('id')}/ack", None, TL) if pr else {}
            a2 = call('POST', f"/admin/me/hr/leave-promo/{pr.get('id')}/ack", None, TL) if pr else {}
            days = biz_days(3, year)
            pl = call('POST', f"/admin/me/hr/leave-promo/{pr.get('id')}/plan", {'dates': days[:1]}, TL) if pr and days else {}
            pl2 = call('POST', f"/admin/me/hr/leave-promo/{pr.get('id')}/plan", {'dates': days[:1]}, TL) if pr and days else {}
            other = call('POST', f"/admin/me/hr/leave-promo/{pr.get('id')}/ack", None, TP) if pr else {}
            st1 = psql(f"SELECT state || '|' || cardinality(plan_dates) || '|' || (acked_at IS NOT NULL) FROM hra_leave_promos WHERE employee_id = {E1} AND year = {year} AND round = 1")
            ok('② 본인 — 내 알림 1 · 받았습니다(두 번째는 already) · 쓸 날 내기 → PLANNED · 다시 내기 409 · 남의 기록 422(연결 없음)',
               bool(pr) and m1.get('linked') is True and a1.get('already') is False and a2.get('already') is True
               and (not days or (pl.get('ok') is True and pl2.get('_err') == 409 and st1.startswith('PLANNED|1|'))) and other.get('_err') in (404, 422),
               f"{pr.get('id')} {a1.get('already')} {a2.get('already')} {days} {pl.get('ok') or pl} {pl2.get('_err')} {st1} {other.get('_err')}")
            psql(f"SET session_replication_role = replica; UPDATE hra_leave_promos SET issued_on = current_date - 20, reply_due = current_date - 10 WHERE employee_id = {E2} AND year = {year} AND round = 1")
            v1 = call('GET', f'/admin/hr/leave-promo?year={year}', None, TS)
            r2id = ((row(v1, E2).get('round1')) or {}).get('id')
            r1id = ((row(v1, E1).get('round1')) or {}).get('id')
            bad = call('POST', f'/admin/hr/leave-promo/{r2id}/designate', {'dates': [today]}, TS) if r2id else {}
            d1 = call('POST', f'/admin/hr/leave-promo/{r2id}/designate', {'dates': days[:2]}, TS) if r2id and len(days) >= 2 else {}
            d2 = call('POST', f'/admin/hr/leave-promo/{r2id}/designate', {'dates': days[:2]}, TS) if r2id and len(days) >= 2 else {}
            d3 = call('POST', f'/admin/hr/leave-promo/{r1id}/designate', {'dates': days[:1]}, TS) if r1id and days else {}
            r2 = psql(f"SELECT state || '|' || cardinality(designated_dates) FROM hra_leave_promos WHERE employee_id = {E2} AND year = {year} AND round = 2")
            ok('② 2차 — 기한 지나면 NO_PLAN · 오늘 날짜 422 · 지정 → DESIGNATED 2일 · 다시 409 · 계획 낸 직원 409',
               row(v1, E2).get('next') == 'DESIGNATE' and bad.get('code') == 'HRA_LEAVE_PROMO_DATES'
               and (len(days) < 2 or (d1.get('ok') is True and d2.get('code') == 'HRA_LEAVE_PROMO_DONE' and r2 == 'DESIGNATED|2'))
               and (not days or d3.get('code') == 'HRA_LEAVE_PROMO_STATE'),
               f"{row(v1, E2).get('next')} {bad.get('code')} {d1.get('ok') or d1} {d2.get('code')} {d3.get('code')} {r2}")
            del1 = psql(f"DELETE FROM hra_leave_promos WHERE employee_id = {E1}")
            up1 = psql(f"UPDATE hra_leave_promos SET unused_days = 1 WHERE employee_id = {E1}")
            ok('② DB — 촉진 기록 지우기 · 남은 연차 고치기 막음', 'HRA_LEAVE_PROMO' in del1 and 'HRA_LEAVE_PROMO' in up1, f"{del1[-60:]} {up1[-60:]}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-hra-leave-promo]', timeout=30000); pg.wait_for_timeout(1000)
                seen['rows'] = pg.locator(f'[data-hra-promo-row="{E1}"]').count()
                seen['phase'] = pg.locator('[data-hra-promo-phase]').count()
            res = admin_page('/#/hra-leave-promo', chk)
            if res is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res
                ok('③ 화면 — 연차 사용 촉진 표에 시험 직원 줄 · 기간 줄 · 화면 오류 없음', seen.get('rows') == 1 and seen.get('phase') == 1 and not perr, f"{seen} {perr[:2]}")
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        psql(CLEAN)
        psql(f"SET session_replication_role = replica; DELETE FROM hra_leave_promos WHERE created_at >= '{T0}';")
        for k, v in keep.items():
            setting(k, v or None, '1581 되돌림')
        for a_, t_ in ((lid, '1581l'), (pid, '1581p'), (aid, '1581a')):
            rm_role(a_, t_)
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
