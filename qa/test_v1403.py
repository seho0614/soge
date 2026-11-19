"""v10.403 (D247 · docs/540) 급여 대장 · 4대보험
  ① (코드) 직원 · 대장 · 줄 · 요율 · 간이세액표 · 계정 · 전표 PAYROLL · PAYROLL_PAID · API · 화면 · 문서
  ② (API) 직원 넣기(400 · 403) · 간이세액표 올림 · 대장 만들기 · 같은 달 409 · 셈(4대보험 10원 버림 · 소득세 · 지방소득세 · 실지급)
  ③ (API) 초안 줄 다시 셈 · 확정 뒤 409 · DB 도 막음 · 급여 전표 차대 같음 · 지급 처리 · 지급 전표
  ④ (화면) 회계 › 급여
  시험용 해 2098 · 끝에 직원 · 대장 · 전표 · 간이세액표를 replica 로 지움
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


import glob as _glob
def mig(prefix):
    xs = sorted(_glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(xs[0], encoding='utf-8').read() if xs else ''


M47 = mig('D247')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SR = rd('src/modules/acct/sources.ts')
SC, WK = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')


PR = rd('src/modules/acct/payroll.ts')
ok('① 코드 — 직원(주민번호 · 계좌 없음) · 급여 대장(초안 → 확정 → 지급 · 앞으로만) · 줄(net = 지급 − 공제) · 요율 표 · 간이세액표 · 계정 INS_PAYABLE · EXP_INSURANCE · 전표 PAYROLL · PAYROLL_PAID · API · 화면 · 문서 540 · 판 v10.403',
   'CREATE TABLE IF NOT EXISTS public.acct_employees' in M47 and 'CREATE TABLE IF NOT EXISTS public.acct_payroll_runs' in M47 and 'CREATE TABLE IF NOT EXISTS public.acct_payroll_lines' in M47
   and 'ck_apl_net' in M47 and 'acct_payroll_rates' in M47 and 'acct_wht_table' in M47 and "'INS_PAYABLE'" in M47 and "'EXP_INSURANCE'" in M47 and "'acct.pay_day'" in M47
   and 'resident' not in M47.lower() and "name: 'PAYROLL'" in PR and "name: 'PAYROLL_PAID'" in PR and 'PAYROLL_SOURCES' in SR
   and "@Post('payroll/runs')" in AC and "@Post('payroll/wht-table')" in AC and 'export function AcctPayroll' in UI and "'acct-payroll'" in MN
   and '"SB-ADM-ACC-180"' in SJ and '급여' in doc('540_') and VT >= (10, 403), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1403', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    YR = 2098   # 시험용 먼 해 — 실제 급여 · 요율과 겹치지 않음(요율은 가장 가까운 앞 해 2026 초안을 씀)
    YM = f'{YR}-{(stamp % 12) + 1:02d}'
    nm = f'시험직원1403-{stamp}'
    emp_ids, run_id = [], None
    try:
        # 다른 시험이 남긴 같은 달 대장이 있으면 지움(replica)
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM acct_payroll_lines WHERE run_id IN (SELECT id FROM acct_payroll_runs WHERE ym = '{YM}'); DELETE FROM acct_payroll_runs WHERE ym = '{YM}'; COMMIT;")
        badd = call('POST', '/admin/acct/employees', {'name': nm, 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000, 'dependents': 12}, TS)
        byp = call('POST', '/admin/acct/employees', {'name': nm, 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000}, TP)
        e1 = call('POST', '/admin/acct/employees', {'name': nm, 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000, 'nontax': 200000, 'dependents': 1}, TS)
        if e1.get('id'): emp_ids.append(e1['id'])
        # 간이세액표 시험 줄(천원 단위 · 2,700 ~ 2,900 천원 · 가족 1 = 50,000원)
        csv = '이상,미만,1,2\n2700,2900,50000,30000\n'
        wt = call('POST', '/admin/acct/payroll/wht-table', {'year': YR, 'csv': csv, 'reason': '시험 1403'}, TS)
        rates = call('GET', f'/admin/acct/payroll/rates?year={YR}', None, TP).get('rates') or {}
        r1 = call('POST', '/admin/acct/payroll/runs', {'ym': YM}, TS)
        run_id = r1.get('id')
        r2 = call('POST', '/admin/acct/payroll/runs', {'ym': YM}, TS)
        p = call('GET', f'/admin/acct/payroll?ym={YM}', None, TP)
        ln = next((x for x in p.get('lines') or [] if x.get('employeeId') == e1.get('id')), {})
        f10 = lambda v: int(v // 10 * 10)
        tx = 2800000
        base = min(max(tx, rates.get('np_base_min', 0)), rates.get('np_base_max', 10 ** 12))
        np_ = f10(base * rates.get('np_rate', 0) / 100); hi = f10(tx * rates.get('hi_rate', 0) / 100); ltc = f10(hi * rates.get('ltc_rate', 0) / 100); ei = f10(tx * rates.get('ei_rate', 0) / 100)
        want_net = 3000000 - 50000 - 5000 - np_ - hi - ltc - ei
        mb = call('GET', f'/admin/acct/payroll?ym={YM}', None, TB)
        ok('② 직원 · 대장 — 가족 12명 400 · 지급 담당 넣기 403 · 넣음 · 간이세액표 올림 · 대장 만들기 · 같은 달 409 · 셈(과세 2,800,000 · 국민연금 · 건강 · 장기요양 · 고용 10원 버림 · 소득세 50,000 · 지방 5,000 · 실지급 = 지급 − 공제) · 회원 403',
           badd.get('_err') == 400 and byp.get('_err') == 403 and bool(e1.get('id')) and wt.get('rows') == 2 and bool(run_id) and r2.get('code') == 'ACCT_PAYROLL_EXISTS'
           and ln.get('gross') == 3000000 and ln.get('nontax') == 200000 and ln.get('incomeTax') == 50000 and ln.get('localTax') == 5000
           and ln.get('np') == np_ and ln.get('hi') == hi and ln.get('ltc') == ltc and ln.get('ei') == ei and ln.get('net') == want_net and ln.get('whtMissing') is False and mb.get('_err') == 403,
           f"{badd.get('_err')} {byp.get('_err')} · {e1.get('id')} · 표 {wt.get('rows') or wt.get('code')} · 대장 {run_id} {r2.get('code')} · {ln} · 기대 {np_} {hi} {ltc} {ei} {want_net} · {mb.get('_err')}")
        up = call('PATCH', f"/admin/acct/payroll/lines/{ln.get('id')}", {'gross': 3100000}, TS)
        dbnet = psql(f"SELECT net = gross - income_tax - local_tax - np - hi - ltc - ei FROM acct_payroll_lines WHERE id = {int(ln.get('id') or 0)}")
        fx = call('POST', f'/admin/acct/payroll/runs/{run_id}/fix', None, TS)
        up2 = call('PATCH', f"/admin/acct/payroll/lines/{ln.get('id')}", {'gross': 3200000}, TS)
        raw = psql(f"UPDATE acct_payroll_lines SET gross = 1 WHERE id = {int(ln.get('id') or 0)}")
        call('POST', '/admin/acct/journal/run', None, TS)
        pe1 = psql(f"SELECT coalesce(sum(debit), 0) || '|' || coalesce(sum(credit), 0) || '|' || coalesce(sum(debit) FILTER (WHERE role = 'EXP_SALARY'), 0) FROM acct_lines WHERE entry_id = (SELECT id FROM acct_entries WHERE source = 'PAYROLL' AND source_key = '{run_id}')")
        pd = call('POST', f'/admin/acct/payroll/runs/{run_id}/paid', None, TP)
        call('POST', '/admin/acct/journal/run', None, TS)
        pe2 = psql(f"SELECT count(*) FROM acct_entries WHERE source = 'PAYROLL_PAID' AND source_key = '{run_id}'")
        d, c_, sal = (pe1.split('|') + ['', '', ''])[:3]
        ok('③ 확정 · 지급 · 전표 — 초안 줄 고치면 다시 셈(net 맞음) · 확정 뒤 고치기 409 · DB 도 막음 · 급여 전표 차변 = 대변 · 직원급여 = 지급액 합 · 지급 담당이 지급 처리 · 지급 전표 하나',
           up.get('ok') is True and dbnet == 't' and fx.get('ok') is True and up2.get('code') == 'ACCT_PAYROLL_FIXED' and 'ACCT_PAYROLL_FIXED' in raw
           and d == c_ and int(sal or 0) >= 3100000 and pd.get('ok') is True and pe2 == '1',
           f"{up.get('ok') or up.get('code')} {dbnet} · {fx.get('ok') or fx.get('code')} · {up2.get('code')} · {raw[-40:]} · 전표 {pe1} · {pd.get('ok') or pd.get('code') or pd.get('_err')} · 지급 전표 {pe2}")
    finally:
        # 시험 대장 · 줄 · 전표 · 직원 · 간이세액표 지움(replica)
        rid = int(run_id or 0)
        ids = ','.join(str(int(x)) for x in emp_ids) or '0'
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('PAYROLL', 'PAYROLL_PAID') AND source_key = '{rid}'); "
             f"DELETE FROM acct_entries WHERE source IN ('PAYROLL', 'PAYROLL_PAID') AND source_key = '{rid}'; "
             f"DELETE FROM acct_payroll_lines WHERE run_id = {rid} OR employee_id IN ({ids}); DELETE FROM acct_payroll_runs WHERE id = {rid}; "
             f"DELETE FROM acct_employees WHERE id IN ({ids}); DELETE FROM acct_wht_table WHERE year = {YR}; COMMIT;")
        rm_role(pid, '1403')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-payroll]', timeout=30000); pg.wait_for_timeout(1500)
            seen['emps'] = pg.locator('[data-acct-employees]').count()
        res = admin_page('/#/acct-payroll', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 급여 · 직원 표 · 화면 오류 없음', seen.get('emps') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
