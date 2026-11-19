"""v10.455 (D261 · docs/592) 매출 목표 대비 실적
  ① (코드) D261 목표 표(전체 · 부서 · 담당자) · 바꾼 기록 · 부서 손익 재사용 · 화면 · 문서 592
  ② (API · DB) 지급 담당 403 · 모르는 구분 400 · 부서 없이 422 · 넣기 · 고치기 · 부서 실적 · 달성률 · 담당자 · 바꾼 기록 · 구분 섞기 DB 막음
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


M61 = migr('D261_')
ST, FC, UI, AP, MN = rd('src/modules/acct/salestarget.ts'), rd('src/modules/acct/fin.controller.ts'), rd('web/src/app/admin/Fin.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, ym = kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m')

ok('① 코드 — D261 acct_sales_targets(전체 · 부서 · 담당자 · 한 줄) · 바꾼 기록(쌓기만) · 부서 손익 재사용 · 담당자 = 거래명세서 · API · 화면 FinTargets · 메뉴 · 화면 목록 FIN-030 · 문서 592 · 판 v10.455',
   'CREATE TABLE IF NOT EXISTS public.acct_sales_targets' in M61 and 'uq_ast_target' in M61 and 'trg_acct_target_changes_ro' in M61 and "import { deptPnl } from './depts'" in ST
   and "d.kind = 'STATEMENT'" in ST and "@Put('acct/sales-targets')" in FC and 'export function FinTargets' in UI and "['acct-target', '매출 목표']" in MN
   and "{tab === 'acct-target' && <FinTargets />}" in AP and '"SB-ADM-FIN-030"' in SJ and '달성률' in doc('592_') and VT >= (10, 455), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1455', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    code = f'T1455_{stamp}'
    key = f't1455-{stamp}'
    did = ''
    try:
        did = psql(f"INSERT INTO acct_depts (code, name, sort) VALUES ('{code}', '시험부서 1455', 9999) RETURNING id").split('\n')[0]
        psql(f"SET session_replication_role = replica; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{today}', 'TEST', '{key}', '시험 1455') RETURNING id) "
             f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'CASH', 330000, 0 FROM e UNION ALL SELECT id, 'REV_SALES', 0, 300000 FROM e UNION ALL SELECT id, 'VAT_OUT', 0, 30000 FROM e; "
             f"INSERT INTO acct_entry_tags (entry_id, dept_id) SELECT id, {int(did or 0)} FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}';")
        byp = call('PUT', '/admin/acct/sales-targets', {'ym': ym, 'axis': 'DEPT', 'deptId': did, 'amount': 1000000, 'reason': '시험 1455'}, TP)
        bad = call('PUT', '/admin/acct/sales-targets', {'ym': ym, 'axis': 'TEAM', 'amount': 1, 'reason': '시험 1455'}, TS)
        nod = call('PUT', '/admin/acct/sales-targets', {'ym': ym, 'axis': 'DEPT', 'amount': 1, 'reason': '시험 1455'}, TS)
        t1 = call('PUT', '/admin/acct/sales-targets', {'ym': ym, 'axis': 'DEPT', 'deptId': did, 'amount': 1000000, 'reason': '시험 1455 넣음'}, TS)
        t2 = call('PUT', '/admin/acct/sales-targets', {'ym': ym, 'axis': 'DEPT', 'deptId': did, 'amount': 600000, 'reason': '시험 1455 고침'}, TS)
        to = call('PUT', '/admin/acct/sales-targets', {'ym': ym, 'axis': 'OWNER', 'ownerId': pid, 'amount': 500000, 'reason': '시험 1455 담당'}, TS)
        v = call('GET', f'/admin/acct/sales-targets?ym={ym}', None, TP)
        dr_ = next((x for x in v.get('depts') or [] if x.get('key') == did), {})
        orow = next((x for x in v.get('owners') or [] if x.get('key') == pid), {})
        one = psql(f"SELECT count(*) FROM acct_sales_targets WHERE ym = '{ym}' AND axis = 'DEPT' AND dept_id = {int(did or 0)}")
        chg = psql(f"SELECT count(*) || '|' || coalesce(min(before), -1) FROM acct_target_changes WHERE ym = '{ym}' AND axis = 'DEPT' AND target_key = '{did}'")
        both = psql(f"INSERT INTO acct_sales_targets (ym, axis, dept_id, owner_id, amount) VALUES ('{ym}', 'DEPT', {int(did or 0)}, '{pid}', 1)")
        ok('② 목표 — 지급 담당 정하기 403 · 모르는 구분 400 · 부서 없이 422 · 넣기 · 고치기(한 줄) · 담당자 목표 · 부서 실적 300,000 · 달성률 50% · 담당자 실적 0 · 바꾼 기록 2(앞 값 1,000,000) · 구분 섞기 DB 막음',
           byp.get('_err') == 403 and bad.get('_err') == 400 and nod.get('code') == 'TARGET_DEPT' and t1.get('ok') is True and t2.get('ok') is True and to.get('ok') is True
           and dr_.get('target') == 600000 and dr_.get('actual') == 300000 and dr_.get('rate') == 50.0 and orow.get('target') == 500000 and orow.get('actual') == 0
           and one == '1' and chg == '2|1000000' and '!' in both and v.get('canEdit') is False,
           f"{byp.get('_err')} {bad.get('_err')} {nod.get('code')} {t1.get('ok')} {t2.get('ok')} {to.get('ok')} · {dr_.get('target')} {dr_.get('actual')} {dr_.get('rate')} · {orow.get('target')} {orow.get('actual')} · {one} {chg} {both[-40:]}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM acct_target_changes WHERE ym = '{ym}' AND target_key IN ('{did or '-'}', '{pid}'); "
             f"DELETE FROM acct_sales_targets WHERE ym = '{ym}' AND (dept_id = {int(did or 0)} OR owner_id = '{pid}'); "
             f"DELETE FROM acct_entry_tags WHERE entry_id IN (SELECT id FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}'); "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}'); "
             f"DELETE FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}'; DELETE FROM acct_depts WHERE code = '{code}';")
        rm_role(pid, '1455')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
