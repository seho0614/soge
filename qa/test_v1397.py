"""v10.397 (D246 · docs/534) 계정별 원장 · 매입매출장
  ① (코드) 원장 · 매입매출장 함수 · API 4 · 내려받기 승인 ACCT_LEDGER(D246 CHECK · export-approval) · 화면 · 메뉴 · 명세 · 문서 534
  ② (API) 광고 청구 · 입금 → 전표 → 외상매출금 원장(기초 + 차변 − 대변 = 기말) · 보통예금 원장에 입금 · 매출장에 거래처 · 공급가 · 세액 · 매입장 모양
  ③ (API) 틀린 종류 · 날짜 · 1년 넘는 기간 422 · CSV 승인 없이 422 · 승인 뒤 받음 · 회원 403
  ④ (화면) 회계 › 원장
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


import glob
def m46():
    ps = sorted(glob.glob(os.path.join(K, 'prisma/migrations/D246_*/migration.sql')))
    return open(ps[0], encoding='utf-8').read() if ps else ''


M46 = m46()
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')


def replica(sql):
    """가드 트리거를 건너뛰고 시험 데이터만 지움(시험 끝 정리)"""
    return psql(f"BEGIN; SET LOCAL session_replication_role = replica; {sql}; COMMIT;")


def tail():
    n_ok = sum(1 for r in RES if r[0])
    print(f"\n결과: {n_ok} / {len(RES)}")
    sys.exit(0 if n_ok == len(RES) else 1)
LG = rd('src/modules/acct/ledger.ts')
EA = rd('src/modules/admin/export-approval.ts')
ok('① 코드 — 원장 · 매입매출장 · API 4 · 내려받기 승인 ACCT_LEDGER · 화면 · 메뉴 · 명세 · 문서 534 · 판 v10.397',
   'export async function accountLedger' in LG and 'export async function salesPurchaseBook' in LG and "'ACCT_LEDGER'" in M46 and "'ACCT_LEDGER'" in EA
   and "@Get('ledger')" in AC and "@Get('ledger/export')" in AC and "@Get('books')" in AC and "@Get('books/export')" in AC and "@ExportGate('ACCT_LEDGER')" in AC
   and 'export function AcctLedger' in UI and "{tab === 'acct-ledger' && <AcctLedger />}" in AP and "['acct-ledger', '원장']" in MN
   and '"SB-ADM-ACC-120"' in SJ and '원장' in doc('534_') and VT >= (10, 397), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1397', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d'); m0 = d0[:8] + '01'
    stamp = int(time.time()) % 1000000
    amt = 30000 + stamp % 9000
    name = f'시험원장1397{stamp}'
    try:
        adv = call('POST', '/admin/advertisers', {'code': f'ADV-1397-{stamp}', 'name': f'(주){name}'}, TS)
        inv = call('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': amt, 'vat': amt // 10, 'dueDate': d0, 'memo': '시험 1397'}, TS)
        sv = (psql(f"SELECT amount || '|' || vat || '|' || total FROM ad_invoices WHERE id = '{inv.get('id')}'") or '0|0|0').split('|')
        sup, vat, tot0 = (int(x) if x.lstrip('-').isdigit() else 0 for x in (sv + ['0', '0', '0'])[:3])
        pay = call('POST', f"/admin/ad-invoices/{inv.get('id')}/payments", {'amount': tot0, 'method': 'TRANSFER', 'payerName': name}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        e_inv = psql(f"SELECT id FROM acct_entries WHERE source = 'AD_INVOICE' AND source_key = '{inv.get('id')}'")
        ar = call('GET', f'/admin/acct/ledger?role=AR&from={m0}&to={d0}', None, TP)
        ca = call('GET', f'/admin/acct/ledger?role=CASH&from={m0}&to={d0}', None, TP)
        sb = call('GET', f'/admin/acct/books?kind=SALES&from={m0}&to={d0}', None, TP)
        pb = call('GET', f'/admin/acct/books?kind=PURCHASE&from={m0}&to={d0}', None, TP)
        arow = next((r for r in ar.get('rows') or [] if r.get('entryId') == e_inv), {})
        sale = next((x for x in sb.get('items') or [] if x.get('entryId') == e_inv), {})
        tot = ar.get('total') or {}
        ok('② 원장 · 장부 — 외상매출금 원장에 청구 줄 · 기초 + 차변 − 대변 = 기말 · 보통예금 원장에 입금 · 매출장에 거래처 · 공급가 · 세액 · 매입장 모양',
           bool(e_inv) and tot0 > 0 and arow.get('debit') == tot0 and ar.get('closing') == ar.get('opening', 0) + tot.get('debit', 0) - tot.get('credit', 0)
           and any(r.get('party') == f'(주){name}' and r.get('debit') == tot0 for r in ca.get('rows') or [])
           and sale.get('party') == f'(주){name}' and sale.get('supply') == sup and sale.get('vat') == vat and any(p.get('party') == f'(주){name}' for p in sb.get('parties') or [])
           and isinstance(pb.get('items'), list) and 'total' in pb,
           f"{e_inv} · {arow} · {ar.get('opening')} {tot} {ar.get('closing')} · 매출 {sale} · 매입 {len(pb.get('items') or [])}")
        bk = call('GET', f'/admin/acct/books?kind=X&from={m0}&to={d0}', None, TP)
        bd = call('GET', f'/admin/acct/ledger?role=CASH&from={d0}&to={m0}', None, TP) if d0 != m0 else {'code': 'ACCT_DATE'}
        by = call('GET', f'/admin/acct/ledger?role=CASH&from=2024-01-01&to={d0}', None, TP)
        nf = call('GET', f'/admin/acct/ledger?role=NO_SUCH&from={m0}&to={d0}', None, TP)
        mem = call('GET', f'/admin/acct/ledger?role=CASH&from={m0}&to={d0}', None, TB)
        nt = call('GET', f'/admin/acct/ledger/export?role=AR&from={m0}&to={d0}', None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_LEDGER', TS)
        cv = call('GET', f'/admin/acct/ledger/export?role=AR&from={m0}&to={d0}&ticket={tk}', None, TP) if tk else {}
        tk2 = __import__('export_ticket').get(TP, 'ACCT_LEDGER', TS)
        cb = call('GET', f'/admin/acct/books/export?kind=SALES&from={m0}&to={d0}&ticket={tk2}', None, TP) if tk2 else {}
        head = (cv.get('csv') or '').lstrip('﻿').split('\r\n')[0]
        hb = (cb.get('csv') or '').lstrip('﻿').split('\r\n')[0]
        ok('③ 검사 · CSV — 틀린 종류 422 · 시작 > 끝 422 · 1년 넘음 422 · 없는 계정 404 · 회원 403 · 승인 없이 422 · 승인 뒤 원장 · 매출장 CSV',
           bk.get('code') == 'ACCT_BOOK' and bd.get('code') == 'ACCT_DATE' and by.get('code') == 'ACCT_DATE' and nf.get('_err') == 404 and mem.get('_err') == 403
           and nt.get('code') == 'EXPORT_NEED_APPROVAL' and head.startswith('일자,전표번호,근거,적요') and hb.startswith('일자,전표번호,근거,거래처') and f'(주){name}' in (cb.get('csv') or ''),
           f"{bk.get('code')} {bd.get('code')} {by.get('code')} {nf.get('_err')} {mem.get('_err')} · {nt.get('code')} · {bool(tk)} {head[:30]} · {bool(tk2)} {hb[:30]}")
    finally:
        rm_role(pid, '1397')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-ledger]', timeout=30000)
            pg.wait_for_selector('[data-acct-ledger-rows]', timeout=30000)
            seen['rows'] = pg.locator('[data-acct-ledger-rows]').count()
            pg.click('[data-acct-ledger-mode=SALES]'); pg.wait_for_selector('[data-acct-book-total]', timeout=30000)
            seen['book'] = pg.locator('[data-acct-book-total]').count()
            seen['csv'] = pg.locator('[data-acct-ledger-csv]').count()
        res = admin_page('/#/acct-ledger', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 원장 · 원장 표 · 매출장 · CSV 단추 · 화면 오류 없음', seen.get('rows') == 1 and seen.get('book') == 1 and seen.get('csv') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')
tail()
