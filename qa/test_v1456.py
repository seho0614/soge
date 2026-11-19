"""v10.456 (D261 · docs/593) 거래처별 원장
  ① (코드) 받을 돈 · 갚을 돈 원장 · CSV 내려받기 승인 · 거래처 색인 · 화면 · 문서 593
  ② (API · DB) 요약(기초 · 늘어남 · 줄어듦 · 기말) · 대장 없는 이름 · 한 거래처 줄 · CSV 승인 없이 422 · 회원 403 · 없는 번호 404 · 1년 넘는 기간 422
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
PL, FC, UI, AP, MN = rd('src/modules/acct/partyledger.ts'), rd('src/modules/acct/fin.controller.ts'), rd('web/src/app/admin/Fin.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
d40, d10, d5 = ((kst - datetime.timedelta(days=n)).strftime('%Y-%m-%d') for n in (40, 10, 5))

ok('① 코드 — 거래처 원장(받을 돈 · 갚을 돈 · 기초 · 기말) · 대장 없는 이름 · CSV 내려받기 승인 ACCT_LEDGER · 거래처 색인 · 화면 FinPartyLedger · 메뉴 · 화면 목록 FIN-040 · 문서 593 · 판 v10.456',
   "PARTY_ROLES = ['AR', 'AP', 'CARD_AP']" in PL and 'export function partyLedgerCsv' in PL and "@ExportGate('ACCT_LEDGER')" in FC and "@Get('acct/party-ledger/:id/export')" in FC
   and 'ix_acct_entries_party' in M61 and 'export function FinPartyLedger' in UI and "['acct-partyledger', '거래처 원장']" in MN and "{tab === 'acct-partyledger' && <FinPartyLedger />}" in AP
   and '"SB-ADM-FIN-040"' in SJ and '거래처' in doc('593_') and VT >= (10, 456), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1456', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    nm, nm2 = f'시험거래처1456-{stamp}', f'시험거래처1456-{stamp}-대장없음'
    keys = [f't1456-{stamp}-{i}' for i in range(4)]
    def ent(k, d, party, lines):
        sel = ' UNION ALL '.join(f"SELECT id, '{r}', {dbt}, {crd} FROM e" for r, dbt, crd in lines)
        return psql(f"SET session_replication_role = replica; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo, party) VALUES ('{d}', 'TEST', '{k}', '시험 1456', '{party}') RETURNING id) "
                    f"INSERT INTO acct_lines (entry_id, role, debit, credit) {sel};")
    ptid = ''
    try:
        ptid = psql(f"INSERT INTO acct_parties (kind, name) VALUES ('BOTH', '{nm}') RETURNING id").split('\n')[0]
        ent(keys[0], d40, nm, [('AR', 110000, 0), ('REV_SALES', 0, 100000), ('VAT_OUT', 0, 10000)])
        ent(keys[1], d5, nm, [('CASH', 50000, 0), ('AR', 0, 50000)])
        ent(keys[2], d5, nm, [('EXP_SUPPLIES', 30000, 0), ('AP', 0, 30000)])
        ent(keys[3], d5, nm2, [('EXP_SUPPLIES', 7000, 0), ('AP', 0, 7000)])
        sm = call('GET', f'/admin/acct/party-ledger?from={d10}&to={today}', None, TP)
        row = next((x for x in sm.get('items') or [] if x.get('party') == nm), {})
        row2 = next((x for x in sm.get('items') or [] if x.get('party') == nm2), {})
        dt = call('GET', f'/admin/acct/party-ledger/{ptid}?from={d10}&to={today}', None, TP)
        ex = call('GET', f'/admin/acct/party-ledger/{ptid}/export?from={d10}&to={today}', None, TP)
        mb = call('GET', f'/admin/acct/party-ledger?from={d10}&to={today}', None, TB)
        nf = call('GET', '/admin/acct/party-ledger/x1', None, TP)
        lg = call('GET', f'/admin/acct/party-ledger?from=2024-01-01&to={today}', None, TP)
        ok('② 원장 — 요약(받을 돈 기초 110,000 · 줄어듦 50,000 · 기말 60,000 · 갚을 돈 늘어남 30,000) · 대장 없는 이름 표시 · 한 거래처 줄 2 · 잔액 · CSV 승인 없이 422 · 회원 403 · 없는 번호 404 · 1년 넘는 기간 422',
           row.get('partyId') == ptid and row.get('inBook') is True and (row.get('ar') or {}).get('open') == 110000 and (row.get('ar') or {}).get('dec') == 50000
           and (row.get('ar') or {}).get('close') == 60000 and (row.get('ap') or {}).get('inc') == 30000 and (row.get('ap') or {}).get('close') == 30000 and row2.get('inBook') is False
           and (dt.get('opening') or {}).get('AR') == 110000 and len(dt.get('rows') or []) == 2 and (dt.get('closing') or {}).get('AR') == 60000 and (dt.get('closing') or {}).get('AP') == 30000
           and ex.get('code') == 'EXPORT_NEED_APPROVAL' and mb.get('_err') == 403 and nf.get('_err') == 404 and lg.get('code') == 'ACCT_DATE',
           f"{row.get('partyId')} {row.get('inBook')} {row.get('ar')} {row.get('ap')} {row2.get('inBook')} · {dt.get('opening')} {len(dt.get('rows') or [])} {dt.get('closing')} · {ex.get('code')} {mb.get('_err')} {nf.get('_err')} {lg.get('code')}")
    finally:
        ks = ','.join(f"'{k}'" for k in keys)
        psql(f"SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source = 'TEST' AND source_key IN ({ks})); "
             f"DELETE FROM acct_entries WHERE source = 'TEST' AND source_key IN ({ks}); DELETE FROM acct_parties WHERE name = '{nm}';")
        rm_role(pid, '1456')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
