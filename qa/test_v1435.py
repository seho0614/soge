"""v10.435 (D256 · docs/572) 창고 여러 곳 · 재고 이동 · 바코드
  ① (코드) D256 창고 · 본 창고 · 수불부 창고 칸 · 이동(쌓기만) · 창고별 수량 보기 · 바코드 표 · Code128 패턴 107개(너비 합 11 · 끝 13) · API · 화면 · 문서 572
  ② (API · DB) 창고 더하기 · 창고 입고 · 이동 · 모자람 409 · 실사(차이만) · 바코드 정하기 · 찾기 · 지급 담당 실사 403
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

pats = re.findall(r"'([1-4]{6,7})'", (UI.split('const C128 = [', 1) + [''])[1].split('];', 1)[0])
ok('① 코드 — D256 acct_warehouses(본 창고) · warehouse_id · acct_stock_transfers · v_acct_wh_stock · acct_barcodes · Code128 107(합 11 · 끝 13) · API · 화면 ErpWarehouses · 문서 572 · 판 v10.435',
   'CREATE TABLE IF NOT EXISTS public.acct_warehouses' in M56 and "'MAIN', '본 창고', true" in M56 and 'ADD COLUMN IF NOT EXISTS warehouse_id' in M56
   and 'CREATE TABLE IF NOT EXISTS public.acct_stock_transfers' in M56 and 'CREATE OR REPLACE VIEW public.v_acct_wh_stock' in M56 and 'CREATE TABLE IF NOT EXISTS public.acct_barcodes' in M56
   and len(pats) == 107 and all(sum(int(c) for c in p) == 11 for p in pats[:106]) and sum(int(c) for c in pats[106]) == 13 and len(set(pats)) == 107
   and 'export async function transferStock' in WH and "@Post('warehouses/transfer')" in EC and 'export function ErpWarehouses' in UI and 'BarcodeDetector' in UI
   and "'acct-wh'" in MN and '"SB-ADM-ACC-400"' in SJ and '창고' in doc('572_') and VT >= (10, 435), f"{VER} · 패턴 {len(pats)}")

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1435', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    opt = psql("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' ORDER BY o.id LIMIT 1")
    if not re.match(r'^[0-9a-f-]{36}$', opt or ''):
        print('  (직판 옵션 없음 — ② 건너뜀)')
    else:
        had_bc = psql(f"SELECT count(*) FROM acct_barcodes WHERE option_id = '{opt}'") == '1'
        main = psql("SELECT id FROM acct_warehouses WHERE is_main")
        wid = ''
        try:
            w1 = call('POST', '/admin/acct/warehouses', {'code': f'W{stamp}', 'name': '시험 창고 1435'}, TS); wid = str(w1.get('id') or '')
            i1 = call('POST', '/admin/acct/warehouses/in', {'optionId': opt, 'whId': wid, 'qty': 5, 'unitCost': 1000, 'note': '시험 1435'}, TP)
            t1 = call('POST', '/admin/acct/warehouses/transfer', {'optionId': opt, 'fromWh': wid, 'toWh': main, 'qty': 2, 'note': '시험 1435'}, TP)
            t2 = call('POST', '/admin/acct/warehouses/transfer', {'optionId': opt, 'fromWh': wid, 'toWh': main, 'qty': 10, 'note': '시험 1435'}, TP)
            q1 = psql(f"SELECT coalesce(sum(qty), 0) FROM v_acct_wh_stock WHERE option_id = '{opt}' AND wh_id = {int(wid or 0)}")
            ap = call('POST', '/admin/acct/warehouses/adjust', {'optionId': opt, 'whId': wid, 'counted': 1, 'reason': '시험 1435 실사'}, TP)
            a1 = call('POST', '/admin/acct/warehouses/adjust', {'optionId': opt, 'whId': wid, 'counted': 1, 'reason': '시험 1435 실사'}, TS)
            q2 = psql(f"SELECT coalesce(sum(qty), 0) FROM v_acct_wh_stock WHERE option_id = '{opt}' AND wh_id = {int(wid or 0)}")
            st = call('GET', '/admin/acct/warehouses/stock', None, TP)
            row = next((x for x in st.get('items') or [] if x.get('optionId') == opt), {})
            bc = call('POST', f'/admin/acct/barcodes/{opt}', {}, TP)
            code = bc.get('code') or psql(f"SELECT code FROM acct_barcodes WHERE option_id = '{opt}'")
            fd = call('GET', f'/admin/acct/barcodes/find?code={urllib.parse.quote(code or "")}', None, TP)
            bc2 = call('POST', f'/admin/acct/barcodes/{opt}', {}, TP)
            ok('② 창고 — 더하기 · 입고 5 · 이동 2 · 모자람 409 · 남은 3 · 지급 담당 실사 403 · 실사 1(차이 -2) · 창고별 표 · 바코드(정하기 · 이미 있음 409) · 찾기',
               w1.get('ok') is True and i1.get('ok') is True and t1.get('ok') is True and t2.get('code') == 'ACCT_WH_STOCK' and q1 == '3'
               and ap.get('_err') == 403 and a1.get('diff') == -2 and q2 == '1' and int((row.get('byWh') or {}).get(wid, -1)) == 1
               and (bc.get('ok') is True or had_bc) and (fd.get('option') or {}).get('id') == opt and bc2.get('code') == 'ACCT_BARCODE_SET',
               f"{w1.get('ok')} {i1.get('ok')} {t1.get('ok')} {t2.get('code')} {q1} {ap.get('_err')} {a1.get('diff')} {q2} {(row.get('byWh') or {}).get(wid)} {bc.get('ok') or bc.get('code')} {(fd.get('option') or {}).get('id') == opt} {bc2.get('code')}")
        finally:
            if wid.isdigit():
                psql(f"SET session_replication_role = replica; DELETE FROM acct_stock_transfers WHERE from_wh = {wid} OR to_wh = {wid}; DELETE FROM acct_stock_moves WHERE warehouse_id = {wid}; DELETE FROM acct_warehouses WHERE id = {wid};"
                     + ('' if had_bc else f" DELETE FROM acct_barcodes WHERE option_id = '{opt}';"))
    rm_role(pid, '1435')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
