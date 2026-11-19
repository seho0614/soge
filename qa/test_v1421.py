"""v10.421 (D252 · docs/558) 근로소득 지급명세서 · 간이지급명세서 · 원천징수영수증
  ① (코드) wageStatements · periodRange(YYYY · H1 · H2 · YYYY-MM) · 영수증 · CSV(주민등록번호 빈 칸) · API 3 · 화면 · 메뉴 · 문서 558
  ② (API · DB) 먼 해(2095) 두 달 급여 확정 → 해 합계 = 두 달 · 반기 · 영수증 · 없는 직원 404 · 틀린 기간 422 · CSV 승인 뒤 머리줄 주민등록번호 칸
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

M52 = migr('D252_')
FL, CT, UI, MN = rd('src/modules/acct/filings.ts'), rd('src/modules/acct/acct-filings.controller.ts'), rd('web/src/app/admin/AcctFilings.tsx'), rd('web/src/lib/adminMenu.ts')
ok('① 코드 — 지급명세서 · 반기 · 영수증 · CSV 주민등록번호 빈 칸 · API 3 · 화면 · 메뉴 · 명세 · 문서 558 · 판 v10.421',
   'export async function wageStatements' in FL and 'export function periodRange' in FL and 'export async function wageReceipt' in FL and "'주민등록번호(신고 때 채움)'" in FL
   and "@Get('payroll/statements')" in CT and "@Get('payroll/statements/export')" in CT and "@Get('payroll/statements/:employeeId/receipt')" in CT
   and 'export function AcctWageStatements' in UI and 'data-acct-wage-receipt=' in UI and "['acct-wagestmt', '지급명세서']" in MN and '"SB-ADM-ACC-280"' in SJ and '지급명세서' in doc('558_') and VT >= (10, 421), VER)

def clean_payroll(YR, emp_ids):
    ids = ','.join(str(int(x)) for x in emp_ids) or '0'
    psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
         f"DELETE FROM acct_lines WHERE entry_id IN (SELECT e.id FROM acct_entries e WHERE e.source IN ('PAYROLL', 'PAYROLL_PAID') AND e.source_key IN (SELECT id::text FROM acct_payroll_runs WHERE ym LIKE '{YR}-%')); "
         f"DELETE FROM acct_entries WHERE source IN ('PAYROLL', 'PAYROLL_PAID') AND source_key IN (SELECT id::text FROM acct_payroll_runs WHERE ym LIKE '{YR}-%'); "
         f"DELETE FROM acct_payroll_lines WHERE run_id IN (SELECT id FROM acct_payroll_runs WHERE ym LIKE '{YR}-%') OR employee_id IN ({ids}); "
         f"DELETE FROM acct_payroll_runs WHERE ym LIKE '{YR}-%'; "
         f"DELETE FROM acct_insurance_done WHERE employee_id IN ({ids}); "
         f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 정리' WHERE alert_code = 'ACCT_INSURANCE_DUE' AND resolved_at IS NULL AND split_part(detail->>'key', ':', 1) IN (SELECT unnest(string_to_array('{ids}', ','))); "
         f"DELETE FROM acct_employees WHERE id IN ({ids}); COMMIT;")


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1421', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    YR = 2095
    emp_ids = []
    try:
        clean_payroll(YR, [])
        e1 = call('POST', '/admin/acct/employees', {'name': f'시험직원1421-{stamp}', 'joinedOn': f'{YR}-01-01', 'monthlyBase': 2500000, 'nontax': 100000, 'dependents': 2}, TS)
        if e1.get('id'): emp_ids.append(e1['id'])
        lines = []
        for m in ('03', '08'):
            r = call('POST', '/admin/acct/payroll/runs', {'ym': f'{YR}-{m}'}, TS)
            p = call('GET', f'/admin/acct/payroll?ym={YR}-{m}', None, TS)
            lines.append(next((x for x in p.get('lines') or [] if x.get('employeeId') == e1.get('id')), {}))
            call('POST', f"/admin/acct/payroll/runs/{r.get('id')}/fix", None, TS)
        yr = call('GET', f'/admin/acct/payroll/statements?period={YR}', None, TP)
        me = next((x for x in yr.get('items') or [] if x.get('employeeId') == e1.get('id')), {})
        h1 = call('GET', f'/admin/acct/payroll/statements?period={YR}-H1', None, TP)
        h1me = next((x for x in h1.get('items') or [] if x.get('employeeId') == e1.get('id')), {})
        rc = call('GET', f"/admin/acct/payroll/statements/{e1.get('id')}/receipt?year={YR}", None, TP)
        nf = call('GET', f'/admin/acct/payroll/statements/999999999/receipt?year={YR}', None, TP)
        bad = call('GET', '/admin/acct/payroll/statements?period=2095-H3', None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_TAX', TS)
        cv = call('GET', f'/admin/acct/payroll/statements/export?period={YR}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('\ufeff').split('\r\n')[0]
        want_it = sum(int(x.get('incomeTax') or 0) for x in lines)
        ok('② 지급명세서 — 해 = 두 달(달 2 · 총급여 5,000,000 · 비과세 200,000 · 소득세 합) · 상반기 = 3월만 · 영수증 · 없는 직원 404 · 틀린 기간 422 · CSV 주민등록번호 칸',
           me.get('months') == 2 and me.get('gross') == 5000000 and me.get('nontax') == 200000 and me.get('incomeTax') == want_it
           and h1me.get('months') == 1 and h1me.get('gross') == 2500000 and (rc.get('employee') or {}).get('gross') == 5000000
           and nf.get('_err') == 404 and bad.get('code') == 'ACCT_PERIOD' and '주민등록번호(신고 때 채움)' in head and int(cv.get('rows') or 0) >= 1,
           f"{me} · {h1me.get('months')} {h1me.get('gross')} · {(rc.get('employee') or {}).get('gross')} · {nf.get('_err')} {bad.get('code')} · {head[:40]} {cv.get('rows')}")
    finally:
        clean_payroll(YR, emp_ids)
        rm_role(pid, '1421')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
