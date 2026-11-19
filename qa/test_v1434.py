"""v10.434 (D256 · docs/571) 부서 · 프로젝트별 손익
  ① (코드) D256 부서 · 프로젝트 · 꼬리표 3가지 · 바꾼 기록(쌓기만) · v_acct_line_tags · API · 화면 · 문서 571
  ② (API · DB) 부서 · 프로젝트 더하기 · 같은 코드 422 · 지급 담당 더하기 403 · 전표 꼬리표 · 근거 꼬리표(전표 전에) · 부서별 · 프로젝트별 손익 · 기록 쌓임
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


M56 = migr('D256_')
EC, SD, DP, WH, DN = rd('src/modules/acct/erp.controller.ts'), rd('src/modules/acct/salesdocs.ts'), rd('src/modules/acct/depts.ts'), rd('src/modules/acct/warehouse.ts'), rd('src/modules/acct/dunning.ts')
UI, AP, MN, SR, AM, SC, WK = rd('web/src/app/admin/Erp.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/modules/acct/sources.ts'), rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
def party(tag, email=None):
    nm = f'시험거래처{tag}-{stamp}'
    e = f"'{email}'" if email else 'NULL'
    return psql(f"INSERT INTO acct_parties (kind, name, contact_email) VALUES ('BOTH', '{nm}', {e}) RETURNING id").split('\n')[0], nm

ok('① 코드 — D256 acct_depts · acct_projects · acct_entry_tags · acct_source_tags · acct_rule_dept · acct_tag_changes · v_acct_line_tags · API · 화면 ErpDepts · 문서 571 · 판 v10.434',
   all(f'CREATE TABLE IF NOT EXISTS public.{t}' in M56 for t in ('acct_depts', 'acct_projects', 'acct_entry_tags', 'acct_source_tags', 'acct_rule_dept', 'acct_tag_changes'))
   and 'CREATE OR REPLACE VIEW public.v_acct_line_tags' in M56 and 'export async function deptPnl' in DP and "@Get('dept-pnl')" in EC and "@Audit('ACCT_TAG_SET', 'SETTING')" in EC
   and 'export function ErpDepts' in UI and "'acct-depts'" in MN and '"SB-ADM-ACC-390"' in SJ and '부서' in doc('571_') and VT >= (10, 434), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1434', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    code = f'T{stamp}'
    eids = []
    try:
        d1 = call('POST', '/admin/acct/depts', {'code': code, 'name': '시험 부서 1434'}, TS)
        dup = call('POST', '/admin/acct/depts', {'code': code, 'name': '또'}, TS)
        byp = call('POST', '/admin/acct/depts', {'code': code + 'P', 'name': 'x'}, TP)
        p1 = call('POST', '/admin/acct/projects', {'code': f'P{stamp}', 'name': '시험 프로젝트 1434', 'deptId': d1.get('id')}, TS)
        def entry(key, amt):
            return psql(f"BEGIN; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{today}', 'TEST', '{key}', '시험 1434') RETURNING id) "
                        f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'CASH', {amt}, 0 FROM e UNION ALL SELECT id, 'REV_SALES', 0, {amt} FROM e; COMMIT; "
                        f"SELECT id FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}'").split('\n')[-1]
        e1 = entry(f't1434a-{stamp}', 12340); eids.append(e1)
        tg = call('POST', f'/admin/acct/tags/entry/{e1}', {'deptId': d1.get('id'), 'reason': '시험 1434 전표'}, TP)
        st = call('POST', '/admin/acct/tags/source', {'source': 'TEST', 'sourceKey': f't1434b-{stamp}', 'projectId': p1.get('id'), 'reason': '시험 1434 근거'}, TP)
        e2 = entry(f't1434b-{stamp}', 5000); eids.append(e2)
        pd = call('GET', f'/admin/acct/dept-pnl?from={today}&to={today}&by=dept', None, TP)
        pp = call('GET', f'/admin/acct/dept-pnl?from={today}&to={today}&by=project', None, TP)
        rd_ = next((x for x in pd.get('items') or [] if x.get('key') == d1.get('id')), {})
        rp = next((x for x in pp.get('items') or [] if x.get('key') == p1.get('id')), {})
        te = call('GET', f"/admin/acct/tags/entries?ym={today[:7]}", None, TP)
        row = next((x for x in te.get('items') or [] if x.get('id') == e1), {})
        logs = psql(f"SELECT count(*) FROM acct_tag_changes WHERE reason LIKE '시험 1434%'")
        badp = call('GET', '/admin/acct/dept-pnl?from=x&to=y', None, TP)
        ok('② 부서 손익 — 부서 · 프로젝트 더하기 · 같은 코드 422 · 지급 담당 더하기 403 · 전표 꼬리표 → 부서 매출 12,340 · 근거 꼬리표(전표 전) → 프로젝트 매출 5,000 · 정하기 화면 · 기록 2 · 틀린 기간 422',
           d1.get('ok') is True and dup.get('code') == 'ACCT_DEPT_DUP' and byp.get('_err') == 403 and p1.get('ok') is True and tg.get('ok') is True and st.get('ok') is True
           and int(rd_.get('revenue') or 0) >= 12340 and int(rp.get('revenue') or 0) >= 5000 and row.get('entryDept') == d1.get('id') and int(logs or 0) >= 2 and badp.get('_err') in (400, 422),
           f"{d1.get('ok')} {dup.get('code')} {byp.get('_err')} {p1.get('ok')} {tg.get('ok')} {st.get('ok')} {rd_.get('revenue')} {rp.get('revenue')} {row.get('entryDept')} {logs} {badp.get('_err')}")
    finally:
        ids = ','.join(x for x in eids if x.isdigit()) or '0'
        psql(f"SET session_replication_role = replica; DELETE FROM acct_entry_tags WHERE entry_id IN ({ids}); DELETE FROM acct_source_tags WHERE source = 'TEST' AND source_key LIKE 't1434%'; "
             f"DELETE FROM acct_lines WHERE entry_id IN ({ids}); DELETE FROM acct_entries WHERE id IN ({ids}); DELETE FROM acct_tag_changes WHERE reason LIKE '시험 1434%'; "
             f"DELETE FROM acct_projects WHERE code LIKE 'P{stamp}%'; DELETE FROM acct_depts WHERE code LIKE 'T{stamp}%';")
        rm_role(pid, '1434')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
