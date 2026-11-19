"""v10.440 (D257 · docs/577) 장부 보관 · 내부통제 보고
  ① (코드) acct_archives(쌓기만) · 내려받기 대상 ACCT_ARCHIVE · 큰 금액 설정 · makeArchive · archiveExport · controlReport · 월보 한 줄 · API 4 · 화면 · 문서 577
  ② (API · DB) 마감 안 한 해 409 · 마감한 해 보관(지문 64자) · 목록 · 승인 없이 422 · 승인 뒤 받음(보관 때와 같음) · 지우기 DB 막음 · 내부통제 9줄 · 월보 한 줄 · 되돌림
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


M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')

M57 = migr('D257_')
AX, AU, AM, AR, RA = rd('src/modules/acct/acct-extra.controller.ts'), rd('src/modules/acct/accountant.ts'), rd('src/modules/acct/accrual.ts'), rd('src/modules/acct/archive.ts'), rd('src/modules/acct/receipt-ai.ts')
UI, AP, MN, SC, WK, APM = rd('web/src/app/admin/AcctExtra.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
AUTH, PRN, MID, RPS, EXA, SRC = rd('src/core/auth.ts'), rd('src/modules/identity/principal.service.ts'), rd('src/modules/identity/auth.middleware.ts'), rd('src/modules/site/report.service.ts'), rd('src/modules/admin/export-approval.ts'), rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
stamp = int(time.time()) % 1000000

RPP = rd('src/modules/admin/report-period.ts')
ok('① 코드 — D257 acct_archives(쌓기만) · ACCT_ARCHIVE · acct.control_big_amount · makeArchive · archiveExport · controlReport · 월보 controlLine · API 4 · 화면 · 문서 577 · 판 v10.440',
   'CREATE TABLE IF NOT EXISTS public.acct_archives' in M57 and 'trg_acct_archives_ro' in M57 and "'ACCT_LEDGER', 'ACCT_ARCHIVE'" in M57 and "'acct.control_big_amount'" in M57
   and 'export async function makeArchive' in AR and 'export async function controlReport' in AR and 'controlLine' in RPP and "'ACCT_ARCHIVE'" in EXA
   and "@ExportGate('ACCT_ARCHIVE')" in AX and "@Get('control')" in AX and 'export function ArchiveBox' in UI and '"SB-ADM-ACC-450"' in SJ and '보관' in doc('577_') and VT >= (10, 440), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1440', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    Y = 2092
    try:
        psql(f"SET session_replication_role = replica; DELETE FROM acct_archives WHERE year = {Y}; DELETE FROM acct_year_closings WHERE year = {Y};")
        nc = call('POST', '/admin/acct/archives', {'year': Y}, TS)
        psql(f"INSERT INTO acct_year_closings (year, action, net_income, revenue, expense) VALUES ({Y}, 'CLOSE', 0, 0, 0)")
        mk = call('POST', '/admin/acct/archives', {'year': Y, 'note': '시험 1440'}, TS)
        lst = call('GET', '/admin/acct/archives', None, TP)
        mine = next((x for x in lst.get('items') or [] if x.get('id') == mk.get('id')), {})
        nt = call('GET', f"/admin/acct/archives/{mk.get('id')}/export", None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_ARCHIVE', TS)
        ex = call('GET', f"/admin/acct/archives/{mk.get('id')}/export?ticket={tk}", None, TP) if tk else {}
        dl = psql(f"DELETE FROM acct_archives WHERE id = {int(mk.get('id') or 0)}")
        ct = call('GET', f'/admin/acct/control?ym={ym}', None, TP)
        mo = call('GET', '/admin/work-reports/view?kind=MONTH', None, TS)
        ok('② 보관 · 통제 — 마감 안 한 해 409 · 마감한 해 보관(전표 0 · 지문 64자) · 목록 · 승인 없이 422 · 승인 뒤 받음(같음 · 머리줄) · 지우기 DB 막음 · 내부통제 9줄 · 월보 한 줄',
           nc.get('code') == 'ARCHIVE_NOT_CLOSED' and mk.get('ok') is True and mk.get('entries') == 0 and re.fullmatch(r'[0-9a-f]{64}', str(mk.get('csvSha256') or '')) is not None
           and mine.get('year') == Y and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk) and ex.get('same') is True and str(ex.get('csv') or '').lstrip('\ufeff').startswith('일자,전표번호')
           and '!' in dl and len(ct.get('items') or []) == 9 and isinstance(ct.get('exceptions'), int) and bool((mo.get('control') or {}).get('text')),
           f"{nc.get('code')} · {mk.get('ok')} {mk.get('entries')} · {mine.get('year')} · {nt.get('code')} {bool(tk)} {ex.get('same')} · {dl[-30:]} · {len(ct.get('items') or [])} · {(mo.get('control') or {}).get('text', '')[:30]}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM acct_archives WHERE year = {Y}; DELETE FROM acct_year_closings WHERE year = {Y};")
        rm_role(pid, '1440')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
