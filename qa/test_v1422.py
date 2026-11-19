"""v10.422 (D252 · docs/559) 4대보험 취득 · 상실 신고 자료 · 처리함 · 기한 알림
  ① (코드) acct_insurance_done(쌓기만 · 한 번) · 설정 acct.insurance_alert · 정기 작업 acct_insurance(09:35) · 알림 ACCT_INSURANCE_DUE · API 2 · 감사 · 화면 · 메뉴 · 문서 559
  ② (API · DB) 입사 · 퇴사한 직원 → 취득 · 상실 줄(상실일 = 퇴사 다음 날 · 보수월액 · 기한 다음 달 15일) · 정기 작업 알림 · 처리함 · 두 번 409 · 퇴사 없는 상실 422 · 지급 담당 처리 403 · 알림 풀림
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
FL, CT, UI, SC, WK = rd('src/modules/acct/filings.ts'), rd('src/modules/acct/acct-filings.controller.ts'), rd('web/src/app/admin/AcctFilings.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — 처리함 표(쌓기만 · 한 번) · 설정 · 정기 작업 09:35 · 알림 · API 2 · 감사 · 화면 · 문서 559 · 판 v10.422',
   'CREATE TABLE IF NOT EXISTS public.acct_insurance_done' in M52 and 'trg_acct_insurance_done_ro' in M52 and "'acct.insurance_alert'" in M52 and "'acct_insurance', 1440, 9, 35" in M52
   and 'export async function acctInsuranceJob' in FL and "'ACCT_INSURANCE_DUE'" in FL and "case 'acct_insurance':" in SC and "'acct_insurance'," in WK
   and "@Audit('ACCT_INSURANCE_DONE', 'SETTING')" in CT and 'export function AcctInsurance' in UI and '"SB-ADM-ACC-290"' in SJ and '취득' in doc('559_') and VT >= (10, 422), VER)

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
    pe, pid = mk_staff('1422', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = (kst - datetime.timedelta(days=60)).strftime('%Y-%m-%d')   # 60일 전 입사 → 기한(그다음 달 15일)은 언제나 지남
    d1 = (kst - datetime.timedelta(days=5)).strftime('%Y-%m-%d')
    emp_ids = []
    try:
        e1 = call('POST', '/admin/acct/employees', {'name': f'시험직원1422-{stamp}', 'joinedOn': d0, 'leftOn': d1, 'monthlyBase': 2800000, 'nontax': 200000, 'dependents': 1}, TS)
        e2 = call('POST', '/admin/acct/employees', {'name': f'시험직원1422b-{stamp}', 'joinedOn': d1, 'monthlyBase': 2000000, 'dependents': 1}, TS)
        emp_ids += [x['id'] for x in (e1, e2) if x.get('id')]
        lst = call('GET', '/admin/acct/payroll/insurance', None, TP)
        mine = [x for x in lst.get('items') or [] if x.get('employeeId') in emp_ids]
        acq = next((x for x in mine if x.get('employeeId') == e1.get('id') and x.get('kind') == 'ACQ'), {})
        loss = next((x for x in mine if x.get('employeeId') == e1.get('id') and x.get('kind') == 'LOSS'), {})
        want_loss_on = (datetime.date.fromisoformat(d1) + datetime.timedelta(days=1)).isoformat()
        nm_ = d0[:7]; y, m = int(nm_[:4]), int(nm_[5:]); nxt = f"{y + (m == 12)}-{(m % 12) + 1:02d}-15"
        job = call('POST', '/admin/jobs', {'job': 'acct_insurance'}, TS)
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_INSURANCE_DUE' AND resolved_at IS NULL AND detail->>'key' = '{e1.get('id')}:ACQ'")
        byp = call('POST', '/admin/acct/payroll/insurance/done', {'employeeId': e1.get('id'), 'kind': 'ACQ'}, TP)
        dn = call('POST', '/admin/acct/payroll/insurance/done', {'employeeId': e1.get('id'), 'kind': 'ACQ', 'note': '시험 1422'}, TS)
        dn2 = call('POST', '/admin/acct/payroll/insurance/done', {'employeeId': e1.get('id'), 'kind': 'ACQ'}, TS)
        nol = call('POST', '/admin/acct/payroll/insurance/done', {'employeeId': e2.get('id'), 'kind': 'LOSS'}, TS)
        al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_INSURANCE_DUE' AND resolved_at IS NULL AND detail->>'key' = '{e1.get('id')}:ACQ'")
        upd = psql(f"UPDATE acct_insurance_done SET note = 'x' WHERE employee_id = {int(e1.get('id') or 0)}")
        lst2 = call('GET', '/admin/acct/payroll/insurance', None, TP)
        acq2 = next((x for x in lst2.get('items') or [] if x.get('employeeId') == e1.get('id') and x.get('kind') == 'ACQ'), {})
        ok('② 4대보험 — 취득 · 상실 줄(상실일 = 퇴사 다음 날 · 보수월액 2,600,000 · 기한 다음 달 15일) · 정기 작업 알림 · 지급 담당 403 · 처리함 · 두 번 409 · 퇴사 없는 상실 422 · 알림 풀림 · 고치기 막음 · 처리함 표시',
           len(mine) == 3 and acq.get('eventOn') == d0 and acq.get('due') == nxt and acq.get('monthlyWage') == 2600000 and loss.get('eventOn') == want_loss_on
           and job.get('ok') is not False and al == '1' and byp.get('_err') == 403 and dn.get('ok') is True and dn2.get('code') == 'ACCT_INSURANCE_DONE'
           and nol.get('code') == 'ACCT_INSURANCE' and al2 == '0' and '!' in upd and acq2.get('done') is True,
           f"{len(mine)} · {acq} · {loss.get('eventOn')} {want_loss_on} · {job.get('ok', job.get('_err'))} 알림 {al} · {byp.get('_err')} {dn.get('ok') or dn.get('code')} {dn2.get('code')} {nol.get('code')} · 풀림 {al2} · {upd[-30:]} · {acq2.get('done')}")
    finally:
        clean_payroll(2094, emp_ids)
        rm_role(pid, '1422')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
