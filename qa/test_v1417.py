"""v10.417 (D251 · docs/554) 품의 금액 지키기 — 매입 · 경비에 품의 번호 · 합계 한도(DB REQ_OVER) · 쓴 돈 · 남은 돈
  ① (코드) D251 requisition_id · fn_acct_req_link_guard · v_acct_req_spend · API 품의 고르기 · 화면 · 문서
  ② (API · DB) 품의(지급 담당) → SUPER 승인 → 매입 붙임(한도 안) → 두 번째 매입 한도 넘음 422 REQ_OVER · 쓴 돈 · 남은 돈 · USED · 품의 번호 바꾸기 막힘 · 승인 전 품의 붙이기 막힘
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
def mig(prefix):
    fs = sorted(glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(fs[0], encoding='utf-8').read() if fs else ''


M48 = mig('D248')

M51 = mig('D251')
PU, EX, RQ, AC, UI = rd('src/modules/acct/purchase.ts'), rd('src/modules/acct/expense.ts'), rd('src/modules/acct/requisitions.ts'), rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx')
ok('① 코드 — 매입 · 경비 requisition_id · 합계 한도 가드(REQ_OVER · REQ_LINK_FIXED · REQ_STATE) · 처음 붙으면 USED · v_acct_req_spend · API requisitionId · 화면 품의 고르기 · 쓴 돈 · 문서 554 · 판 v10.417',
   'ADD COLUMN IF NOT EXISTS requisition_id' in M51 and 'fn_acct_req_link_guard' in M51 and "'REQ_OVER:" in M51 and 'REQ_LINK_FIXED' in M51 and 'v_acct_req_spend' in M51 and 'fn_acct_req_link_used' in M51
   and 'requisition_id' in PU and 'requisitionId' in PU and 'requisition_id' in EX and 'v_acct_req_spend' in RQ and AC.count('requisitionId?: string') >= 2
   and 'function ReqPicker' in UI and 'data-acct-req-pick=' in UI and 'data-acct-req-spent=' in UI and '품의' in doc('554_') and VT >= (10, 417), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1417', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 100000
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9); d0 = kst.strftime('%Y-%m-%d')
    biz = lambda k: f"{(stamp * 7 + k) % 9000000000 + 1000000000}"
    tol0 = getset('acct.req_tolerance_pct')
    r1, r2 = {}, {}
    try:
        setting('acct.req_tolerance_pct', '10', '1417')
        r1 = call('POST', '/admin/acct/requisitions', {'title': f'시험 1417 품의 {stamp}', 'amount': 10000, 'accountRole': 'EXP_SUPPLIES', 'reason': '시험 1417 사무용품'}, TP)
        r2 = call('POST', '/admin/acct/requisitions', {'title': f'시험 1417 승인 전 {stamp}', 'amount': 5000, 'accountRole': 'EXP_SUPPLIES', 'reason': '시험 1417 승인 전'}, TP)
        ap = call('POST', f"/admin/acct/requisitions/{r1.get('id')}/decide", {'approve': True, 'note': '시험 1417'}, TS)
        body = lambda sup, vat, k, rid: {'kind': 'CASH', 'issuedOn': d0, 'supplierName': f'시험1417상회{stamp}', 'supplierBizNo': biz(k), 'item': '시험 1417 용지',
                                          'supply': sup, 'vat': vat, 'deductible': True, 'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP', 'force': True, 'requisitionId': str(rid)}
        p1 = call('POST', '/admin/acct/purchases', body(9000, 900, 1, r1.get('id')), TP)       # 9,900 ≤ 11,000
        p2 = call('POST', '/admin/acct/purchases', body(2000, 0, 2, r1.get('id')), TP)         # 9,900 + 2,000 > 11,000 → REQ_OVER
        p3 = call('POST', '/admin/acct/purchases', body(1000, 100, 3, r2.get('id')), TP)       # 승인 전 → REQ_STATE
        lst = call('GET', '/admin/acct/requisitions', None, TS)
        row = next((x for x in lst.get('items') or [] if str(x.get('id')) == str(r1.get('id'))), {})
        fix = psql(f"UPDATE acct_purchases SET requisition_id = {int(r2.get('id') or 0)} WHERE id = {int(p1.get('id') or 0)}")
        ok('② 품의 한도 — 승인 · 한도 안 매입 붙음 · 넘으면 422 REQ_OVER · 승인 전 품의 422 REQ_STATE · 쓴 돈 9,900 · 남은 1,100 · USED · 품의 번호 바꾸기 DB 막음',
           ap.get('ok') is True and p1.get('ok') is True and p2.get('code') == 'REQ_OVER' and p3.get('code') == 'REQ_STATE'
           and int(row.get('spent') or 0) == 9900 and int(row.get('remaining') or 0) == 1100 and row.get('state') == 'USED' and 'REQ_LINK_FIXED' in fix,
           f"{ap.get('ok')} · {p1.get('ok') or p1.get('code')} · {p2.get('code')} · {p3.get('code')} · {row.get('spent')} {row.get('remaining')} {row.get('state')} · {fix[-40:]}")
    finally:
        setting('acct.req_tolerance_pct', tol0 or '10', '1417 되돌림')
        if r2.get('id'): call('POST', f"/admin/acct/requisitions/{r2.get('id')}/cancel", {'reason': '시험 1417 정리'}, TP)
        rm_role(pid, '1417')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
