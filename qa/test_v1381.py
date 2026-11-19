"""v10.381 (D242 · docs/517) 회계 계정표 · 전표 규칙
  ① (코드) D242 · API · 메뉴 · 화면
  ② (API · DB) 계정 · 규칙 · 코드 고치기 · 권한 · 막힘
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




M42, AC, JN, AP, MN, UI = rd('prisma/migrations/D242_acct_journal_closing_tax_type/migration.sql'), rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/journal.ts'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/app/admin/Acct.tsx')
ok('① 코드 — D242 acct_accounts(역할 · 종류 고정 · 지우기 막힘 · 15) · 규칙 13 · API(감사) · 「회계」 메뉴 4탭 · 계정 · 규칙 화면 · 문서 517 · 판 v10.381',
   'CREATE TABLE IF NOT EXISTS public.acct_accounts' in M42 and 'trg_acct_accounts_guard' in M42 and M42.count("'ASSET',") + M42.count("'LIABILITY',") + M42.count("'REVENUE',") + M42.count("'EXPENSE',") >= 15
   and JN.count("name: '") == 13 and "@Audit('ACCT_ACCOUNT_SET', 'SETTING')" in AC and "{ key: 'admacc',  label: '회계',      tabs: ['acct-month', 'acct-journal', 'acct-bank'" in MN and "'acct-accounts'] }" in MN
   and "{tab === 'acct-accounts' && <AcctAccounts />}" in AP and 'data-acct-rules=' in UI and '"SB-ADM-ACC-040"' in SJ and '세무사' in doc('517_') and VT >= (10, 381), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1381', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    e0 = psql("SELECT coalesce(ext_code, '') || '|' || coalesce(ext_name, '') FROM acct_accounts WHERE role = 'REV_SUB'")
    try:
        g = call('GET', '/admin/acct/accounts', None, TS)
        rules = g.get('rules') or []
        bal = all(sum(l['debit'] for l in r['lines']) == sum(l['credit'] for l in r['lines']) and len(r['lines']) >= 2 for r in rules)
        gp, gb = call('GET', '/admin/acct/accounts', None, TP), call('GET', '/admin/acct/accounts', None, TB)
        bad = call('PATCH', '/admin/acct/accounts/REV_SUB', {'extCode': '404', 'extName': '용역매출', 'reason': 'x'}, TS)
        s1 = call('PATCH', '/admin/acct/accounts/REV_SUB', {'extCode': '4041', 'extName': '구독용역매출', 'reason': '시험 1381 코드'}, TS)
        sp = call('PATCH', '/admin/acct/accounts/REV_SUB', {'extCode': '4042', 'reason': '시험 1381 지급 담당'}, TP)
        nf = call('PATCH', '/admin/acct/accounts/NO_SUCH', {'extCode': '1', 'reason': '시험 1381 없음'}, TS)
        now = psql("SELECT ext_code || '|' || ext_name FROM acct_accounts WHERE role = 'REV_SUB'")
        kd = psql("UPDATE acct_accounts SET kind = 'ASSET' WHERE role = 'REV_SUB'")
        dl = psql("DELETE FROM acct_accounts WHERE role = 'REV_SUB'")
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'ACCT_ACCOUNT_SET' AND occurred_at > now() - interval '10 minutes'")
        ok('② API · DB — 계정 15 · 규칙 13(모두 차변 = 대변) · 지급 담당 보기(고치기 403) · 회원 403 · 사유 422 · SUPER 코드 고침 · 없는 계정 404 · 종류 고치기 · 지우기 막힘 · 감사',
           len(g.get('accounts') or []) >= 15 and len(rules) >= 13 and bal and g.get('canEdit') is True and gp.get('canEdit') is False and gb.get('_err') == 403
           and bad.get('code') == 'ACCT_REASON' and s1.get('ok') is True and sp.get('_err') == 403 and nf.get('_err') == 404 and now == '4041|구독용역매출'
           and '!' in kd and '!' in dl and int(aud or 0) >= 1,
           f"{len(g.get('accounts') or [])} · {len(rules)} {bal} · {gp.get('canEdit')} {gb.get('_err')} · {bad.get('code')} {s1.get('ok')} {sp.get('_err')} {nf.get('_err')} · {now} · {kd[-25:]} · 감사 {aud}")
    finally:
        c, nm = (e0.split('|') + ['', ''])[:2]
        psql(f"UPDATE acct_accounts SET ext_code = nullif('{c}', ''), ext_name = nullif('{nm}', '') WHERE role = 'REV_SUB'")
        rm_role(pid, '1381')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
