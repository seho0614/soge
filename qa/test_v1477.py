"""v10.477 (D266 · docs/615) 전자계산서(면세) — 세금계산서 표 · 전자세금계산서 어댑터 재사용(종류 EXEMPT · 부가세 0 · 간주) · 처음 꺼짐 · 거래명세서 세금계산서는 과세 몫만
  ① (코드) D266 CHECK · 트리거 3 · 설정 · etax 패치(exempt · taxType EXEMPT · 스위치) · salesdocs taxableShare · 메뉴 · 화면 FIN2-030 · 문서 615
  ② (API · DB) 꺼짐 422 · 후보 · 세금계산서 과세 몫 · 면세만 422 · 요청 · 겹침 409 · DB 막음 2 · 간주 발행 · 문서 번호 · 다시 409 · 문서 취소 막음 · 요청 취소 · 꺼지면 발행 422 · 권한 주소 4
  ③ (화면) 회계 › 전자계산서(면세)
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


M66 = migr('D266_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
AM, MN, AP, SCH, WK = rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
OC, UI = rd('src/modules/acct/acct-ops.controller.ts'), rd('web/src/app/admin/AcctOps.tsx')

EX, ES, EH, EA, SD = rd('src/modules/acct/exemptinv.ts'), rd('src/modules/etax/etax.service.ts'), rd('src/modules/etax/etax.http.ts'), rd('src/modules/etax/etax.adapter.ts'), rd('src/modules/acct/salesdocs.ts')
ok('① 코드 — D266 종류 EXEMPT(CHECK · 부가세 0 · 전송 기록) · 요청 검사 트리거 · 발행 번호 트리거 · 거래명세서 가드 · 설정 acct.exempt_invoice off · 전자세금계산서 어댑터 재사용(exempt 종류 · taxType EXEMPT · 스위치) · 거래명세서 세금계산서 과세 몫(taxableShare) · 외부 연동 줄 더하지 않음 · API 4 · 메뉴 acct-exemptinv · 화면 FIN2-030 · 문서 615 · 판 v10.477',
   "CHECK (kind IN ('AD', 'COMMISSION', 'SALES_DOC', 'EXEMPT'))" in M66 and "CHECK (kind <> 'EXEMPT' OR vat = 0)" in M66 and "'SALES_DOC', 'EXEMPT'))" in M66
   and 'trg_acct_tax_invoice_exempt_chk' in M66 and "ELSIF NEW.kind = 'EXEMPT' THEN" in M66 and 'trg_acct_sales_doc_exempt_guard' in M66 and "('acct.exempt_invoice', 'off'" in M66
   and 'INSERT INTO public.integrations' not in M66
   and "exempt: { table: 'acct_tax_invoices', kind: 'EXEMPT', letter: 'E'" in ES and "k.kind === 'EXEMPT' && !(await exemptOn(this.db))" in ES
   and "taxType: doc.kind === 'EXEMPT' ? 'EXEMPT' : 'TAX'" in EH and "| 'SALES_DOC' | 'EXEMPT'" in EA
   and ('const share = await taxableShare(db, id, d)' in SD or 'const share = await taxableShare(db, id, { supply: d.supply, vat: d.vat })' in SD) and 'export async function taxableShare' in EX and "this.etax.send('exempt', id, 'send')" in OC
   and "['acct-exemptinv', '전자계산서(면세)']" in MN and "{tab === 'acct-exemptinv' && <AcctExemptInvoices />}" in AP and 'export function AcctExemptInvoices' in UI
   and '"SB-ADM-FIN2-030"' in SJ and '계산서' in doc('615_') and VT >= (10, 477), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    sw0, assume = getset('acct.exempt_invoice'), getset('assume.etax')
    fname, fbiz = getset('footer.company_name'), getset('footer.biz_reg_no')
    pid = d1 = d2 = ''
    no1, no2 = f'S-9477-{stamp:06d}', f'S-9478-{stamp:06d}'
    try:
        if not fname: setting('footer.company_name', '시험 1477 공급자', '1477')
        if not fbiz: setting('footer.biz_reg_no', '123-45-67890', '1477')
        pid = psql(f"INSERT INTO acct_parties (kind, name, biz_no) VALUES ('CUSTOMER', '시험 1477 거래처-{stamp}', '9{stamp:09d}') RETURNING id").split('\n')[0]
        # 확정한 거래명세서 2장(확정일은 회계 시작 전 — 매출 전표가 생기지 않게) · 1: 과세 + 면세 · 2: 면세만
        d1 = psql(f"INSERT INTO acct_sales_docs (kind, doc_no, rev, party_id, title, issued_on, supply, vat, total, state, accepted_at) VALUES ('STATEMENT', '{no1}', 1, {int(pid or 0)}, '시험 1477 섞임', '2020-01-02', 150000, 10000, 160000, 'ACCEPTED', '2020-01-02') RETURNING id").split('\n')[0]
        d2 = psql(f"INSERT INTO acct_sales_docs (kind, doc_no, rev, party_id, title, issued_on, supply, vat, total, state, accepted_at) VALUES ('STATEMENT', '{no2}', 1, {int(pid or 0)}, '시험 1477 면세만', '2020-01-02', 30000, 0, 30000, 'ACCEPTED', '2020-01-02') RETURNING id").split('\n')[0]
        psql(f"INSERT INTO acct_sales_doc_lines (doc_id, seq, item, qty, unit_price, supply, vat, tax_type) VALUES ('{d1}', 1, '시험 과세', 1, 100000, 100000, 10000, 'TAXABLE'), ('{d1}', 2, '시험 면세', 1, 50000, 50000, 0, 'EXEMPT'), ('{d2}', 1, '시험 면세 2', 1, 30000, 30000, 0, 'EXEMPT')")
        setting('acct.exempt_invoice', 'off', '1477')
        mb = call('GET', '/admin/acct/exempt-invoices', None, TB)
        off = call('POST', '/admin/acct/exempt-invoices', {'docId': d1}, TS)
        setting('acct.exempt_invoice', 'on', '1477')
        lst = call('GET', '/admin/acct/exempt-invoices', None, TS)
        cand = any(c.get('id') == d1 and c.get('exemptSupply') == 50000 for c in lst.get('candidates') or [])
        tx = call('POST', f'/admin/acct/sales-docs/{d1}/tax-invoice', {}, TS)
        txrow = psql(f"SELECT supply || '|' || vat || '|' || total FROM acct_tax_invoices WHERE kind = 'SALES_DOC' AND source_id = '{d1}' AND state <> 'CANCELED'")
        only = call('POST', f'/admin/acct/sales-docs/{d2}/tax-invoice', {}, TS)
        rq = call('POST', '/admin/acct/exempt-invoices', {'docId': d1}, TS); xid = str(rq.get('id') or '')
        xrow = psql(f"SELECT kind || '|' || supply || '|' || vat || '|' || total || '|' || state FROM acct_tax_invoices WHERE id::text = '{xid}'")
        dup = call('POST', '/admin/acct/exempt-invoices', {'docId': d1}, TS)
        badsup = psql(f"INSERT INTO acct_tax_invoices (kind, source_id, supply, vat, total, buyer_name, item) VALUES ('EXEMPT', '{d2}', 1, 0, 1, 'x', 'x')")
        badvat = psql(f"INSERT INTO acct_tax_invoices (kind, source_id, supply, vat, total, buyer_name, item) VALUES ('EXEMPT', '{d2}', 30000, 1, 30001, 'x', 'x')")
        sent = call('POST', f'/admin/acct/exempt-invoices/{xid}/send', {}, TS)
        docno = psql(f"SELECT coalesce(exempt_invoice_no, '') FROM acct_sales_docs WHERE id = '{d1}'")
        again = call('POST', f'/admin/acct/exempt-invoices/{xid}/send', {}, TS)
        log = psql(f"SELECT count(*) FROM etax_send_log WHERE invoice_kind = 'EXEMPT' AND invoice_id::text = '{xid}'")
        dcan = psql(f"UPDATE acct_sales_docs SET state = 'CANCELED', canceled_at = now(), cancel_reason = '시험 취소' WHERE id = '{d1}'")
        r2 = call('POST', '/admin/acct/exempt-invoices', {'docId': d2}, TS); x2 = str(r2.get('id') or '')
        cx = call('POST', f'/admin/acct/exempt-invoices/{x2}/cancel', {'reason': '시험 1477 취소'}, TS)
        r3 = call('POST', '/admin/acct/exempt-invoices', {'docId': d2}, TS); x3 = str(r3.get('id') or '')
        setting('acct.exempt_invoice', 'off', '1477')
        offsend = call('POST', f'/admin/acct/exempt-invoices/{x3}/send', {}, TS)
        offetax = call('POST', f'/admin/etax/exempt/{x3}/send', {}, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'acct-exemptinv'")
        sent_ok = (sent.get('etaxStatus') == 'ASSUMED' and str(sent.get('invoiceNo') or '').startswith('간주-SGB-E-') and docno == sent.get('invoiceNo')) if assume == 'on' else sent.get('_err') in (None, 422)
        ok('② 전자계산서 — 회원 403 · 꺼짐 422 · 요청 후보(면세 50,000) · 세금계산서는 과세 몫만(100,000 · 10,000) · 면세만 문서 세금계산서 422 · 요청(EXEMPT · 부가세 0) · 겹침 409 · DB 공급가 다름 · 부가세 막음 · 발행(간주 · 번호 간주-SGB-E- · 문서에 번호) · 다시 409 · 전송 기록 · 발행한 문서 취소 막음 · 요청 취소 → 다시 요청 · 꺼지면 발행 422(두 길 모두) · 권한 주소 4',
               mb.get('_err') == 403 and off.get('code') == 'EXEMPT_OFF' and cand and tx.get('ok') is True and txrow == '100000|10000|110000' and only.get('code') == 'ACCT_DOC_EXEMPT_ONLY'
               and xrow == 'EXEMPT|50000|0|50000|REQUESTED' and dup.get('_err') == 409 and 'ACCT_EXEMPT_INVOICE' in badsup and 'ck_ati_exempt_vat' in badvat
               and sent_ok and (again.get('_err') == 409 or assume != 'on') and (log == '1' or assume != 'on') and ('전자계산서' in dcan or assume != 'on')
               and cx.get('ok') is True and r3.get('ok') is True and offsend.get('code') == 'EXEMPT_OFF' and offetax.get('code') == 'EXEMPT_OFF' and rmap == '4',
               f"{mb.get('_err')} {off.get('code')} 후보 {cand} · {tx.get('ok') or tx} {txrow} {only.get('code')} · {xrow} {dup.get('_err')} {badsup[-40:]} {badvat[-40:]} · assume {assume} {sent.get('etaxStatus') or sent} {docno} {again.get('_err')} {log} {dcan[-40:]} · "
               f"{cx.get('ok')} {r3.get('ok') or r3} {offsend.get('code')} {offetax.get('code')} · {rmap}")
    finally:
        setting('acct.exempt_invoice', sw0 or 'off', '1477')
        if not fname: setting('footer.company_name', fname or None, '1477')
        if not fbiz: setting('footer.biz_reg_no', fbiz or None, '1477')
        ids = "'" + "','".join(x for x in (d1, d2) if x) + "'"
        if d1 or d2:
            psql(f"SET session_replication_role = replica; DELETE FROM etax_send_log WHERE invoice_id::text IN (SELECT id::text FROM acct_tax_invoices WHERE source_id::text IN ({ids})); "
                 f"DELETE FROM acct_tax_invoices WHERE source_id::text IN ({ids}); DELETE FROM acct_sales_doc_lines WHERE doc_id::text IN ({ids}); DELETE FROM acct_sales_docs WHERE id::text IN ({ids});")
        if pid.isdigit():
            psql(f"SET session_replication_role = replica; DELETE FROM acct_sales_docs WHERE party_id = {pid}; DELETE FROM acct_parties WHERE id = {pid};")
    if ADMIN_WEB:
        r = admin_page('/#/acct-exemptinv', lambda pg, seen: seen.update(n=pg.locator('[data-exempt]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회계 › 전자계산서(면세)(화면 · 화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
