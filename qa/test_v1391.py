"""v10.391 (D244 · docs/528) 전자세금계산서 — 광고 청구 · 입점 수수료
  ① (코드) D244 요청 표 · 가드 · 전송 기록 종류 · 전자세금계산서 종류 · API · 화면 · 문서
  ② (API · DB) 광고 청구 — 요청(금액 고정) · 두 번 409 · 금액 고치기 DB 가 막음 · 간주 발행 → 청구서에 번호 · 전송 기록 AD
  ③ (API · DB) 입점 수수료 — 요청(수수료 + 수수료 부가세) · 요청 취소 · 다시 요청 · 간주 발행 → 정산 ISSUED · 개인 판매자 발행 422
  ④ (화면) 회계 › 신고 자료 › 세금계산서 「발행 요청」
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


M44 = rd('prisma/migrations/D244_acct_bank_format_deadline_etax/migration.sql')
AC, RP, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
ES, EC = rd('src/modules/etax/etax.service.ts'), rd('src/modules/etax/etax.controller.ts')
ok('① 코드 — D244 요청 표(근거마다 하나 · 전송 칸 · 가드 · 근거에 번호) · 전송 기록 AD · COMMISSION · 전자세금계산서 종류 ad · commission · API 2 · 감사 · 화면 · 문서 528 · 판 v10.391',
   'CREATE TABLE IF NOT EXISTS public.acct_tax_invoices' in M44 and 'uq_ati_source' in M44 and 'fn_acct_tax_invoice_issued' in M44 and "CHECK (invoice_kind IN ('DIRECTORY', 'LEAD_CASH', 'AD', 'COMMISSION'))" in M44
   and "ad: { table: 'acct_tax_invoices', kind: 'AD'" in ES and "commission: { table: 'acct_tax_invoices', kind: 'COMMISSION'" in ES and "'ad', 'commission'] })" in EC
   and "@Post('tax/invoices/request')" in AC and "@Post('tax/invoices/:id/cancel')" in AC and "@Audit('TAXINV_REQUEST', 'INVOICE')" in AC
   and 'export async function requestTaxInvoice' in RP and 'data-acct-taxinv-request=' in UI and 'data-acct-taxinv-send=' in UI and '전자세금계산서' in doc('528_') and VT >= (10, 391), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1391', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    ae0 = getset('assume.etax')
    setting('assume.etax', 'on', '1391')
    try:
        adv = call('POST', '/admin/advertisers', {'code': f'ADV-1391-{stamp}', 'name': f'시험광고1391 {stamp}', 'bizRegNo': '123-45-67890'}, TS)
        inv = call('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 50000, 'dueDate': d0, 'memo': '시험 1391'}, TS)
        iv = call('GET', f'/admin/acct/tax/invoices?ym={ym}', None, TP)
        row = next((x for x in iv.get('items') or [] if x.get('kind') == 'AD' and x.get('id') == inv.get('id')), {})
        r1 = call('POST', '/admin/acct/tax/invoices/request', {'kind': 'AD', 'sourceId': inv.get('id')}, TP)
        r2 = call('POST', '/admin/acct/tax/invoices/request', {'kind': 'AD', 'sourceId': inv.get('id')}, TP)
        fx = psql(f"UPDATE acct_tax_invoices SET supply = 1, total = 5001 WHERE id = '{r1.get('id')}'")
        sd = call('POST', f"/admin/etax/ad/{r1.get('id')}/send", None, TS)
        no = psql(f"SELECT coalesce(tax_invoice_no, '') FROM ad_invoices WHERE id = '{inv.get('id')}'")
        lg = psql(f"SELECT invoice_kind FROM etax_send_log WHERE invoice_id = '{r1.get('id')}' LIMIT 1")
        iv2 = call('GET', f'/admin/acct/tax/invoices?ym={ym}', None, TP)
        row2 = next((x for x in iv2.get('items') or [] if x.get('kind') == 'AD' and x.get('id') == inv.get('id')), {})
        ok('② 광고 청구 — 발행 요청 가능 · 요청(공급가 50,000 · 세액 5,000) · 두 번 409 · 금액 고치기 DB 가 막음 · 간주 발행 · 청구서에 「간주-SGB-A-…」 · 전송 기록 AD · 목록 발행함',
           row.get('canRequest') is True and r1.get('supply') == 50000 and r1.get('vat') == 5000 and r2.get('code') == 'TAXINV_REQUESTED' and 'ACCT_TAX_INVOICE_FIXED' in fx
           and sd.get('assumed') is True and no.startswith('간주-SGB-A-') and lg == 'AD' and row2.get('issued') is True and row2.get('canRequest') is False,
           f"{row.get('canRequest')} · {r1.get('supply')}/{r1.get('vat')} · {r2.get('code')} · {fx[-40:]} · {sd.get('assumed')} {sd.get('code') or ''} · {no} · {lg} · {row2.get('issued')}")

        # ③ 입점 수수료 — 정산을 바로 만듦(주간 7일 · 확인)
        def seller(code, biz):
            return psql(f"INSERT INTO hlt_sellers (code, type, name, personal, status, applied_at, reviewed_at, submerchant_id, commission_rate, ship_fee, return_ship_fee, biz_reg_no) "
                        f"VALUES ('{code}', 'TENANT', '시험판매자 {code}', {'false' if biz else 'true'}, 'ACTIVE', now(), now(), 'SUB-{code}', 12, 0, 6000, {repr(biz) if biz else 'NULL'}) RETURNING id").splitlines()[0]
        def settle(sid):
            s = psql(f"INSERT INTO hlt_settlements (seller_id, period_from, period_to, gross_amount, commission, commission_vat, refund_amount, carried_in, net_amount, status) "
                     f"VALUES ('{sid}', '2026-01-05', '2026-01-12', 10000, 1200, 120, 0, 0, 8680, 'DRAFT') RETURNING id").splitlines()[0]
            psql(f"UPDATE hlt_settlements SET status = 'CONFIRMED' WHERE id = '{s}'")
            return s
        s1 = settle(seller(f'TN-T1391-{stamp}', '234-56-78901'))
        s2 = settle(seller(f'TN-T1391P-{stamp}', None))
        c1 = call('POST', '/admin/acct/tax/invoices/request', {'kind': 'COMMISSION', 'sourceId': s1}, TP)
        cx = call('POST', f"/admin/acct/tax/invoices/{c1.get('id')}/cancel", {'reason': '시험 취소'}, TP)
        cx2 = call('POST', f"/admin/acct/tax/invoices/{c1.get('id')}/cancel", {'reason': '시험 취소'}, TP)
        c2 = call('POST', '/admin/acct/tax/invoices/request', {'kind': 'COMMISSION', 'sourceId': s1}, TP)
        sd2 = call('POST', f"/admin/etax/commission/{c2.get('id')}/send", None, TS)
        ss = psql(f"SELECT invoice_state || '|' || coalesce(invoice_no, '') FROM hlt_settlements WHERE id = '{s1}'")
        p1 = call('POST', '/admin/acct/tax/invoices/request', {'kind': 'COMMISSION', 'sourceId': s2}, TP)
        sp = call('POST', f"/admin/etax/commission/{p1.get('id')}/send", None, TS)
        draft = psql(f"INSERT INTO hlt_settlements (seller_id, period_from, period_to, gross_amount, commission, commission_vat, refund_amount, carried_in, net_amount, status) VALUES ('{psql(f'SELECT seller_id FROM hlt_settlements WHERE id = ' + chr(39) + s1 + chr(39))}', '2026-01-12', '2026-01-19', 10000, 1200, 120, 0, 0, 8680, 'DRAFT') RETURNING id").splitlines()[0]
        dr = call('POST', '/admin/acct/tax/invoices/request', {'kind': 'COMMISSION', 'sourceId': draft}, TP)
        ok('③ 입점 수수료 — 요청(1,200 + 120) · 보내기 전 취소 · 두 번 취소 409 · 다시 요청 · 간주 발행 → 정산 ISSUED · 번호 · 개인 판매자(사업자번호 없음) 요청은 되지만 발행 422 · 확인 전 정산 422',
           c1.get('supply') == 1200 and c1.get('vat') == 120 and cx.get('ok') is True and cx2.get('code') == 'TAXINV_NOT_CANCELABLE' and bool(c2.get('id')) and c2.get('id') != c1.get('id')
           and sd2.get('assumed') is True and ss.startswith('ISSUED|간주-SGB-C-') and p1.get('hasBizNo') is False and sp.get('code') == 'ETAX_PERSON_BUYER' and dr.get('code') == 'TAXINV_NOT_ELIGIBLE',
           f"{c1.get('supply')}/{c1.get('vat')} · 취소 {cx.get('ok')} {cx2.get('code')} · 다시 {bool(c2.get('id'))} · {sd2.get('assumed')} {sd2.get('code') or ''} · {ss} · 개인 {p1.get('hasBizNo')} {sp.get('code')} · {dr.get('code')}")
    finally:
        if ae0: setting('assume.etax', ae0, '1391 되돌림')
        rm_role(pid, '1391')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-invoices]', timeout=30000)
            seen['inv'] = pg.locator('[data-acct-invoices]').count()
            seen['issued'] = pg.locator('[data-acct-invoice="issued"]').count()
        res = admin_page('/#/acct-tax', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 신고 자료 › 세금계산서 표(발행함 줄) · 화면 오류 없음',
               seen.get('inv') == 1 and seen.get('issued', 0) >= 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
