"""v10.433 (D256 · docs/570) 견적서 · 주문서 · 거래명세서 · 발주서 인쇄
  ① (코드) D256 문서 표 · 가드(내용 못 고침) · 세금계산서 종류 SALES_DOC · 전표 SALES_DOC · 새 컨트롤러 · 화면 · 문서 570
  ② (API · DB) 견적 → 새 판 → 주문 → 거래명세서 · 확정 · 매출 전표(차변 = 대변) · 세금계산서 요청 · 내용 고치기 DB 막음 · ADMIN 만들기 · 상태 403 · 회원 403 · 취소 → 반대 전표
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

ok('① 코드 — D256 acct_sales_docs · 줄 · 가드 · 번호 · SALES_DOC 세금계산서 · 전표 2 · ErpController · 화면 ErpDocs · 메뉴 acct-docs · 문서 570 · 판 v10.433',
   'CREATE TABLE IF NOT EXISTS public.acct_sales_docs' in M56 and 'ACCT_DOC_FIXED' in M56 and "kind IN ('AD', 'COMMISSION', 'SALES_DOC')" in M56 and "ELSIF NEW.kind = 'SALES_DOC'" in M56
   and "name: 'SALES_DOC'" in SD and "name: 'SALES_DOC_CANCEL'" in SD and 'SALES_DOC_SOURCES' in SR and 'export class ErpController' in EC and 'ErpController' in AM
   and "@Audit('ACCT_DOC_ADD', 'SETTING')" in EC and 'export function ErpDocs' in UI and "'acct-docs'" in MN and "'acct-accounts'] }" in MN and '"SB-ADM-ACC-380"' in SJ
   and '거래명세서' in doc('570_') and VT >= (10, 433), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ae, aid = mk_staff('1433', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    pid, pnm = party('1433')
    try:
        lines = [{'item': '시험 컨설팅', 'qty': 2, 'unitPrice': 50000, 'taxType': 'TAXABLE'}, {'item': '시험 면세', 'qty': 1, 'unitPrice': 10000, 'taxType': 'EXEMPT'}]
        q1 = call('POST', '/admin/acct/sales-docs', {'kind': 'QUOTE', 'partyId': pid, 'title': f'시험 1433 {stamp}', 'lines': lines}, TA)
        bad = call('POST', '/admin/acct/sales-docs', {'kind': 'QUOTE', 'partyId': pid, 'title': 'x', 'lines': []}, TS)
        rv = call('POST', f"/admin/acct/sales-docs/{q1.get('id')}/revise", {'lines': lines + [{'item': '추가', 'qty': 1, 'unitPrice': 1000}]}, TS)
        rv2 = call('POST', f"/admin/acct/sales-docs/{q1.get('id')}/revise", {'lines': lines}, TS)
        o1 = call('POST', f"/admin/acct/sales-docs/{rv.get('id')}/convert", {'to': 'ORDER'}, TS)
        s1 = call('POST', f"/admin/acct/sales-docs/{o1.get('id')}/convert", {'to': 'STATEMENT'}, TS)
        byadm = call('POST', f"/admin/acct/sales-docs/{s1.get('id')}/state", {'state': 'ACCEPTED'}, TA)
        acc = call('POST', f"/admin/acct/sales-docs/{s1.get('id')}/state", {'state': 'ACCEPTED'}, TS)
        det = call('GET', f"/admin/acct/sales-docs/{s1.get('id')}", None, TS)
        fixed = psql(f"UPDATE acct_sales_docs SET title = '바꿈' WHERE id = '{s1.get('id')}'")
        call('POST', '/admin/acct/journal/run', None, TS)
        ent = psql(f"SELECT coalesce(sum(l.debit), 0) || '|' || coalesce(sum(l.credit), 0) || '|' || count(*) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'SALES_DOC' AND e.source_key = '{s1.get('id')}'")
        ti = call('POST', f"/admin/acct/sales-docs/{s1.get('id')}/tax-invoice", None, TS)
        ti2 = call('POST', f"/admin/acct/sales-docs/{s1.get('id')}/tax-invoice", None, TS)
        kind = psql(f"SELECT kind || '|' || total FROM acct_tax_invoices WHERE id = '{ti.get('taxInvoiceId')}'") if ti.get('taxInvoiceId') else ''
        cx_ti = call('POST', f"/admin/acct/tax/invoices/{ti.get('taxInvoiceId')}/cancel", {'reason': '시험 1433 취소'}, TS) if ti.get('taxInvoiceId') else {}
        cx = call('POST', f"/admin/acct/sales-docs/{s1.get('id')}/state", {'state': 'CANCELED', 'reason': '시험 1433 취소'}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        rev = psql(f"SELECT count(*) FROM acct_entries WHERE source = 'SALES_DOC_CANCEL' AND source_key = '{s1.get('id')}'")
        lst = call('GET', '/admin/acct/sales-docs', None, TB)
        want = 100000 + 10000 + 10000   # 과세 10만 + 부가세 1만 + 면세 1만
        ok('② 문서 — 견적(ADMIN) · 빈 품목 400/422 · 새 판 2 · 옛 판 다시 고치기 409 · 주문 · 거래명세서 · ADMIN 확정 403 · 확정 · 합계(과세 · 면세) · DB 고치기 막음 · 매출 전표 차변 = 대변 3줄 · 세금계산서 요청(SALES_DOC) · 두 번 409 · 취소 → 반대 전표 · 회원 403',
           q1.get('ok') is True and str(q1.get('docNo', '')).startswith('Q-') and bad.get('_err') in (400, 422) and rv.get('rev') == 2 and rv2.get('code') == 'ACCT_DOC_STATE'
           and str(o1.get('docNo', '')).startswith('O-') and str(s1.get('docNo', '')).startswith('S-') and byadm.get('_err') == 403 and acc.get('ok') is True
           and (det.get('doc') or {}).get('total') == want and 'ACCT_DOC_FIXED' in fixed and ent == f'{want}|{want}|3'
           and ti.get('ok') is True and ti2.get('code') == 'ACCT_DOC_STATE' and kind == f'SALES_DOC|{want}' and cx.get('ok') is True and rev == '1' and lst.get('_err') == 403,
           f"{q1.get('docNo')} {bad.get('_err')} {rv.get('rev')} {rv2.get('code')} {o1.get('docNo')} {s1.get('docNo')} {byadm.get('_err')} {acc.get('ok')} {(det.get('doc') or {}).get('total')} {fixed[-30:]} {ent} {ti.get('ok')} {ti2.get('code')} {kind} {cx.get('ok') or cx.get('code')} {rev} {lst.get('_err')}")
    finally:
        rm_role(aid, '1433')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
