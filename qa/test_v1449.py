"""v10.449 (D260 · docs/586) 분개장
  ① (코드) books.ts dayBook · 컨트롤러 · 화면 AcctDaybook · 메뉴 acct-daybook · 화면 ID SB-ADM-LDG-010 · 권한 업무 · 문서 586
  ② (API) 이번 달 분개장 — 차변 = 대변 · 전표마다 차대 같음 · 날짜 순 · 잘못된 날짜 422 · 1년 넘음 422 · 회원 403 · CSV 승인 없이 422 · 승인 뒤 머리줄
  ③ (화면) 회계 › 장부 › 분개장
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

ok('① 코드 — 분개장 함수 · API 2 · 내려받기 승인 ACCT_LEDGER · 화면 · 메뉴 · 탭 · 화면 ID · 권한 업무 · 문서 586 · 판 v10.449',
   'export async function dayBook' in BK and "@Get('daybook')" in BC and "@Get('daybook/export')" in BC and "@ExportGate('ACCT_LEDGER')" in BC
   and 'export function AcctDaybook' in UI and "['acct-daybook', '분개장']" in MN and "{tab === 'acct-daybook' && <AcctDaybook />}" in AP and 'AcctBooksController' in AM
   and '"SB-ADM-LDG-010"' in SJ and "('acct-daybook'," in M60 and '분개장' in doc('586_') and VT >= (10, 449), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1449', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    try:
        d = call('GET', f'/admin/acct/daybook?from={m1}&to={today}', None, TP)
        es = d.get('entries') or []
        each = all(e.get('debit') == e.get('credit') and len(e.get('lines') or []) >= 2 for e in es)
        order = all((es[i]['date'], int(es[i]['entryId'])) <= (es[i + 1]['date'], int(es[i + 1]['entryId'])) for i in range(len(es) - 1))
        db_n = psql(f"SELECT count(*) FROM acct_entries WHERE entry_date BETWEEN '{m1}' AND '{today}'")
        bad = call('GET', '/admin/acct/daybook?from=2026-13-01&to=2026-11-30', None, TP)
        long_ = call('GET', '/admin/acct/daybook?from=2024-01-01&to=2026-11-30', None, TP)
        mem = call('GET', f'/admin/acct/daybook?from={m1}&to={today}', None, TB)
        nt = call('GET', f'/admin/acct/daybook/export?from={m1}&to={today}', None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_LEDGER', TS)
        ex = call('GET', f'/admin/acct/daybook/export?from={m1}&to={today}&ticket={tk}', None, TP) if tk else {}
        ok('② 분개장 — 합계 차변 = 대변 · 전표마다 같음 · 날짜 · 번호 순 · 전표 수 = DB · 잘못된 날짜 422 · 1년 넘음 422 · 회원 403 · 승인 없이 422 · 승인 뒤 CSV 머리줄',
           d.get('balanced') is True and each and order and (d.get('truncated') or str(len(es)) == db_n) and bad.get('_err') == 422 and long_.get('_err') == 422
           and mem.get('_err') == 403 and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk) and str(ex.get('csv') or '').lstrip('﻿').startswith('일자,전표번호,근거,적요,거래처,증빙,계정코드,계정,차변,대변'),
           f"{d.get('balanced')} {each} {order} {len(es)}/{db_n} · {bad.get('_err')} {long_.get('_err')} {mem.get('_err')} · {nt.get('code')} {bool(tk)} {str(ex.get('csv') or '')[:40]!r}")
    finally:
        rm_role(pid, '1449')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-daybook-balanced]', timeout=30000)
            seen['bal'] = pg.get_attribute('[data-acct-daybook-balanced]', 'data-acct-daybook-balanced')
        res = admin_page('/#/acct-daybook', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 장부 › 분개장 · 차대 맞음 · 화면 오류 없음', seen.get('bal') == 'ok' and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
