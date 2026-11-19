"""v10.450 (D260 · docs/587) 현금출납장
  ① (코드) books.ts cashBook · 계정 CASH_HAND(현금 101) · API 2 · 화면 AcctCashbook · 메뉴 · 화면 ID SB-ADM-LDG-020 · 문서 587
  ② (API) 보통예금 · 현금 — 기초 + 들어옴 − 나감 = 기말 · 날짜별 합 = 전체 · 원장과 같은 기말 · 모르는 계정은 보통예금 · 회원 403 · CSV 승인
  ③ (화면) 회계 › 장부 › 현금출납장
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


M60 = migr('D260_')
BK, BC = rd('src/modules/acct/books.ts'), rd('src/modules/acct/acct-books.controller.ts')
UI, AP, MN, AM, AT, MA = rd('web/src/app/admin/AcctBooks.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/acct/manual.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d'); ym = today[:7]; m1 = ym + '-01'
stamp = int(time.time()) % 1000000
ok('① 코드 — 출납장 함수 · 현금 계정 CASH_HAND(101) · API 2 · 내려받기 승인 · 화면 · 메뉴 · 탭 · 화면 ID · 권한 업무 · 문서 587 · 판 v10.450',
   'export async function cashBook' in BK and "CASHBOOK_ROLES = ['CASH', 'CASH_HAND']" in BK and "('CASH_HAND'," in M60 and "@Get('cashbook')" in BC and "@Get('cashbook/export')" in BC
   and 'export function AcctCashbook' in UI and "['acct-cashbook', '현금출납장']" in MN and "{tab === 'acct-cashbook' && <AcctCashbook />}" in AP
   and '"SB-ADM-LDG-020"' in SJ and "('acct-cashbook'," in M60 and '현금출납장' in doc('587_') and VT >= (10, 450), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1450', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    try:
        c = call('GET', f'/admin/acct/cashbook?role=CASH&from={m1}&to={today}', None, TP)
        h = call('GET', f'/admin/acct/cashbook?role=CASH_HAND&from={m1}&to={today}', None, TP)
        x = call('GET', f'/admin/acct/cashbook?role=AR&from={m1}&to={today}', None, TP)
        lg = call('GET', f'/admin/acct/ledger?role=CASH&from={m1}&to={today}', None, TP)
        t = c.get('total') or {}
        days = c.get('days') or []
        same = c.get('opening', 0) + t.get('in', -1) - t.get('out', 0) == c.get('closing') and sum(d['in'] for d in days) == t.get('in') and sum(d['out'] for d in days) == t.get('out')
        mem = call('GET', f'/admin/acct/cashbook?from={m1}&to={today}', None, TB)
        nt = call('GET', f'/admin/acct/cashbook/export?role=CASH&from={m1}&to={today}', None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_LEDGER', TS)
        ex = call('GET', f'/admin/acct/cashbook/export?role=CASH&from={m1}&to={today}&ticket={tk}', None, TP) if tk else {}
        ok('② 출납장 — 기초 + 들어옴 − 나감 = 기말 · 날짜별 합 = 전체 · 원장 기말과 같음 · 현금(시재) 계정 · 모르는 계정은 보통예금 · 회원 403 · 승인 없이 422 · 승인 뒤 머리줄',
           c.get('role') == 'CASH' and same and c.get('closing') == lg.get('closing') and h.get('role') == 'CASH_HAND' and (h.get('account') or {}).get('name') == '현금(시재)'
           and x.get('role') == 'CASH' and mem.get('_err') == 403 and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk)
           and str(ex.get('csv') or '').lstrip('﻿').startswith('일자,전표번호,근거,적요,거래처,들어옴,나감,잔액'),
           f"{c.get('role')} {same} {c.get('closing')}/{lg.get('closing')} · {h.get('role')} {(h.get('account') or {}).get('name')} · {x.get('role')} · {mem.get('_err')} · {nt.get('code')} {bool(tk)} {str(ex.get('csv') or '')[:30]!r}")
    finally:
        rm_role(pid, '1450')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-cashbook-closing]', timeout=30000)
            seen['role'] = pg.get_attribute('[data-acct-cashbook]', 'data-acct-cashbook')
        res = admin_page('/#/acct-cashbook', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 장부 › 현금출납장(보통예금) · 화면 오류 없음', seen.get('role') == 'CASH' and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
