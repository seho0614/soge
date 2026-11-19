"""v10.420 (D252 · docs/557) 원천세 이행상황신고서 미리보기
  ① (코드) filings.whtReturn · 칸 A01 · A20 · A25 · A99 · 기한(영업일) · API 2 · 내려받기 승인 ACCT_TAX · 화면 · 메뉴 · 명세 · 문서 557
  ② (API · DB) 먼 해(2096) 급여 확정 → A01 인원 · 지급액 · 소득세 · 합계 · 기한 다음 달 10일 이후 · 틀린 달 422 · ADMIN 403 · CSV 승인 없이 422 · 승인 뒤 머리줄
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
FL, CT, UI, MN, AP = rd('src/modules/acct/filings.ts'), rd('src/modules/acct/acct-filings.controller.ts'), rd('web/src/app/admin/AcctFilings.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
ok('① 코드 — 신고서 칸 A01 · A20 · A25 · A99 · 기한 영업일 · API 2 · ACCT_TAX 승인 · 화면 · 메뉴 · 명세 · 문서 557 · 판 v10.420',
   'export async function whtReturn' in FL and all(c in FL for c in ("code: 'A01'", "code: 'A20'", "code: 'A25'", "code: 'A99'")) and 'fn_is_business_day' in FL
   and "@Get('tax/wht-return')" in CT and "@Get('tax/wht-return/export')" in CT and "@ExportGate('ACCT_TAX')" in CT
   and 'export function AcctWhtReturn' in UI and "['acct-whtreturn', '원천세 신고서']" in MN and "'acct-whtreturn'" in AP and '"SB-ADM-ACC-270"' in SJ and '이행상황' in doc('557_') and VT >= (10, 420), VER)

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
    pe, pid = mk_staff('1420', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    ae, aid = mk_staff('1420a', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    stamp = int(time.time()) % 1000000
    YR = 2096; YM = f'{YR}-{(stamp % 11) + 1:02d}'
    emp_ids = []
    try:
        clean_payroll(YR, [])
        e1 = call('POST', '/admin/acct/employees', {'name': f'시험직원1420-{stamp}', 'joinedOn': f'{YR}-01-01', 'monthlyBase': 3000000, 'nontax': 200000, 'dependents': 1}, TS)
        if e1.get('id'): emp_ids.append(e1['id'])
        r1 = call('POST', '/admin/acct/payroll/runs', {'ym': YM}, TS)
        p = call('GET', f'/admin/acct/payroll?ym={YM}', None, TS)
        ln = next((x for x in p.get('lines') or [] if x.get('employeeId') == e1.get('id')), {})
        fx = call('POST', f"/admin/acct/payroll/runs/{r1.get('id')}/fix", None, TS)
        w = call('GET', f'/admin/acct/tax/wht-return?ym={YM}', None, TP)
        rows = {r.get('code'): r for r in w.get('rows') or []}
        a01, tot = rows.get('A01') or {}, w.get('total') or {}
        bad = call('GET', '/admin/acct/tax/wht-return?ym=2096-13', None, TP)
        byad = call('GET', f'/admin/acct/tax/wht-return?ym={YM}', None, TA)
        nt = call('GET', f'/admin/acct/tax/wht-return/export?ym={YM}', None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_TAX', TS)
        cv = call('GET', f'/admin/acct/tax/wht-return/export?ym={YM}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('\ufeff').split('\r\n')[0]
        nxt = f"{YR}-{int(YM[5:]) + 1:02d}"
        ok('② 신고서 — A01 = 확정 급여(인원 1 · 지급액 3,000,000 · 소득세 = 급여 줄) · A99 합계 · 기한 다음 달 10일 이후(영업일) · 틀린 달 422 · ADMIN 403 · 승인 없이 422 · 승인 뒤 CSV',
           fx.get('ok') is True and a01.get('people') == 1 and a01.get('paid') == 3000000 and a01.get('incomeTax') == ln.get('incomeTax') and a01.get('localTax') == ln.get('localTax')
           and tot.get('code') == 'A99' and tot.get('incomeTax', -1) >= a01.get('incomeTax', 0) and set(rows) == {'A01', 'A20', 'A25'}
           and str(w.get('due', '')) >= f'{nxt}-10' and str(w.get('due', '')).startswith(nxt) and bad.get('code') == 'ACCT_PERIOD' and byad.get('_err') == 403
           and nt.get('code') == 'EXPORT_NEED_APPROVAL' and head.startswith('귀속 · 지급 달,코드') and int(cv.get('rows') or 0) == 4,
           f"{fx.get('ok') or fx.get('code')} · {a01} · {ln.get('incomeTax')} · {tot} · {w.get('due')} · {bad.get('code')} {byad.get('_err')} · {nt.get('code')} · {head[:20]} {cv.get('rows')}")
    finally:
        clean_payroll(YR, emp_ids)
        rm_role(pid, '1420'); rm_role(aid, '1420a')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
