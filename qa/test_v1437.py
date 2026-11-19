"""v10.437 (D257 · docs/574) 세무사 공유 계정 — 운영 역할 ACCOUNTANT(읽기 전용 · 기한 꼭)
  ① (코드) 역할 CHECK · 기한 미룬 트리거 · 증빙 열람 · 권한 검사 세무사 읽기 · 기한 지난 역할 빠짐 · 접속 기록 · 줄 수 있는 역할 · 내려받기 대상 · API · 화면 · 문서 574
  ② (API · DB) 기한 없이 주기 DB 막음 · 기한 두고 주기 · 회계 GET 200 · 쓰기 403 · 다른 운영 화면 403 · 질문 · SUPER 답 · 세무사 답 403 · 접속 기록 · 기한 지나면 403
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

ok('① 코드 — D257 역할 CHECK ACCOUNTANT · 기한 트리거 · fn_file_can_read · AuthGuard 세무사 읽기 · principal 기한 · 접속 기록 · setRole · TARGET_ROLES · API 3 · 화면 · 메뉴 · 문서 574 · 판 v10.437',
   "'PARTNER_AFF','ACCOUNTANT']" in M57 and 'trg_accountant_role_expiry' in M57 and "'ACCOUNTANT' = ANY (p_roles) AND f.purpose = 'ACCT_EVIDENCE'" in M57
   and "'ACCOUNTANT';" in AUTH and 'accountantRead(principal, req, required)' in AUTH and "r.role = 'ACCOUNTANT' AND (r.expires_at IS NULL" in PRN and 'logAccountantAccess' in MID
   and "'ACCOUNTANT_EXPIRY'" in RPS and "ACCT_JOURNAL: ['PAYOUT', 'ACCOUNTANT']" in EXA and "@Get('accountant')" in AX and "@Post('accountant/notes')" in AX
   and 'export function AccountantDesk' in UI and "'acct-accountant'" in MN and "{tab === 'acct-accountant' && <AccountantDesk />}" in AP and '"SB-ADM-ACC-420"' in SJ
   and '세무사' in doc('574_') and VT >= (10, 437), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1437', None)
    try:
        noexp = psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1437 기한 없음', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ACCOUNTANT'); COMMIT;")
        good = psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1437', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ACCOUNTANT'); "
                    f"UPDATE account_roles SET expires_at = now() + interval '7 days' WHERE account_id = '{aid}' AND role = 'ACCOUNTANT'; COMMIT;")
        consent_ok.agree(em, PW)
        TA = login(em)
        acc = call('GET', '/admin/acct/accounts', None, TA)
        mon = call('GET', f'/admin/acct/month?ym={ym}', None, TA)
        run = call('POST', '/admin/acct/journal/run', None, TA)
        pur = call('POST', '/admin/acct/purchases', {'kind': 'SIMPLE', 'issuedOn': d0, 'supplierName': '시험1437', 'item': 'x', 'supply': 1000, 'accountRole': 'EXP_ETC', 'payRole': 'AP'}, TA)
        other = call('GET', '/admin/storage-status', None, TA)
        nt = call('POST', '/admin/acct/accountant/notes', {'ym': ym, 'body': f'시험 1437 질문 {stamp}'}, TA)
        rp = call('POST', f"/admin/acct/accountant/notes/{nt.get('id')}/reply", {'body': '시험 1437 답'}, TS)
        rpa = call('POST', f"/admin/acct/accountant/notes/{nt.get('id')}/reply", {'body': 'x'}, TA)
        desk = call('GET', f'/admin/acct/accountant?ym={ym}', None, TA)
        sdesk = call('GET', '/admin/acct/accountant', None, TS)
        mine = next((x for x in desk.get('notes') or [] if x.get('id') == nt.get('id')), {})
        time.sleep(1)
        logs = psql(f"SELECT count(*) FROM acct_accountant_access WHERE account_id = '{aid}'")
        psql(f"UPDATE account_roles SET expires_at = now() - interval '1 minute' WHERE account_id = '{aid}' AND role = 'ACCOUNTANT'")
        late = call('GET', '/admin/acct/accounts', None, TA)
        ok('② 세무사 — 기한 없이 주기 DB 막음 · 기한 두고 주기 · 회계 GET 200 · 전표 만들기 · 매입 넣기 403 · 다른 운영 화면 403 · 질문 · SUPER 답 · 세무사 답 403 · 내 질문 · 답 보임 · SUPER 목록 · 접속 기록 · 기한 지나면 403',
           'ACCOUNTANT_EXPIRY' in noexp and '!' not in good and isinstance(acc.get('accounts'), list) and mon.get('ym') == ym
           and run.get('_err') == 403 and pur.get('_err') == 403 and other.get('_err') == 403
           and nt.get('ok') is True and rp.get('ok') is True and rpa.get('_err') == 403 and desk.get('isAccountant') is True
           and any(r.get('body') == '시험 1437 답' for r in mine.get('replies') or []) and any(x.get('id') == aid for x in sdesk.get('accountants') or [])
           and int(logs or 0) >= 3 and late.get('_err') in (401, 403),
           f"{noexp[-40:]} · {good[-30:]} · {bool(acc.get('accounts'))} {mon.get('ym')} · {run.get('_err')} {pur.get('_err')} {other.get('_err')} · {nt.get('ok')} {rp.get('ok')} {rpa.get('_err')} {desk.get('isAccountant')} · {logs} · {late.get('_err')}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM acct_accountant_replies WHERE note_id IN (SELECT id FROM acct_accountant_notes WHERE account_id = '{aid}'); "
             f"DELETE FROM acct_accountant_notes WHERE account_id = '{aid}'; DELETE FROM acct_accountant_access WHERE account_id = '{aid}';")
        rm_role(aid, '1437')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-accountant]', timeout=30000)
            seen['who'] = pg.get_attribute('[data-acct-accountant]', 'data-acct-accountant')
        res = admin_page('/#/acct-accountant', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 세무사(SUPER 는 운영자 쪽) · 화면 오류 없음', seen.get('who') == 'staff' and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
