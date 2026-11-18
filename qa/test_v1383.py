"""v10.383 (D242 · docs/519) 신고 자료 · 세금계산서 대상 · 상품 과세
  ① (코드) D242 · API · 화면
  ② (상품) 면세 · 되돌림 · 권한
  ③ (신고 자료) 부가세 · 원천세 · 세금계산서 · CSV
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




M42, AC, RP, UI, EX = rd('prisma/migrations/D242_acct_journal_closing_tax_type/migration.sql'), rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/admin/export-approval.ts')
ok('① 코드 — D242 상품 · 주문 줄 과세 구분(옮김 트리거) · 내려받기 대상 ACCT_JOURNAL · ACCT_TAX · 부가세 · 원천세 · 세금계산서 · CSV(승인) · 신고 자료 화면 · 문서 519 · 판 v10.383',
   "ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS tax_type" in M42 and 'trg_hlt_item_tax_type' in M42 and "'ACCT_JOURNAL', 'ACCT_TAX'));" in M42
   and "ACCT_JOURNAL: ['PAYOUT'], ACCT_TAX: ['PAYOUT']" in EX and "@ExportGate('ACCT_TAX')" in AC and "@Audit('PRODUCT_TAX_TYPE', 'SETTING')" in AC
   and 'export async function vatSummary' in RP and 'data-acct-invoices=' in UI and 'data-acct-tax-type=' in UI and '면세' in doc('519_') and VT >= (10, 383), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1383', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, q = kst.strftime('%Y-%m'), f"{kst.year}-{(kst.month - 1) // 3 + 1}"
    try:
        pr = call('GET', '/admin/acct/products', None, TS)
        items = pr.get('items') or []
        code = items[0]['code'] if items else None
        t0 = items[0]['taxType'] if items else None
        tenant = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id AND s.type <> 'DIRECT' LIMIT 1")
        e1 = call('PATCH', f'/admin/acct/products/{code}/tax-type', {'taxType': 'EXEMPT', 'reason': '시험 1383 면세'}, TS) if code else {}
        db1 = psql(f"SELECT tax_type FROM hlt_products WHERE code = '{code}'") if code else ''
        e2 = call('PATCH', f'/admin/acct/products/{code}/tax-type', {'taxType': t0 or 'TAXABLE', 'reason': '시험 1383 되돌림'}, TS) if code else {}
        et = call('PATCH', f'/admin/acct/products/{tenant}/tax-type', {'taxType': 'EXEMPT', 'reason': '시험 1383 입점'}, TS) if tenant else {'_err': 404}
        ep = call('PATCH', f'/admin/acct/products/{code}/tax-type', {'taxType': 'EXEMPT', 'reason': '시험 1383 지급'}, TP) if code else {'_err': 403}
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'PRODUCT_TAX_TYPE' AND occurred_at > now() - interval '10 minutes'")
        ok('② 상품 과세 — 직판 상품 목록 · 면세로(DB) · 되돌림 · 입점 상품 404 · 지급 담당 403 · 감사',
           bool(code) and e1.get('ok') is True and db1 == 'EXEMPT' and e2.get('ok') is True and et.get('_err') == 404 and ep.get('_err') == 403 and int(aud or 0) >= 2,
           f"{code} {t0} · {e1.get('ok')} {db1} {e2.get('ok')} · 입점 {tenant or '없음'} {et.get('_err')} · {ep.get('_err')} · 감사 {aud}")
        call('POST', '/admin/acct/journal/run', None, TS)
        v = call('GET', f'/admin/acct/tax/vat?q={q}', None, TP)
        sq = psql(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role IN ('REV_SUB','REV_REFCODE','REV_AD','REV_LEAD','REV_DIRECTORY','REV_COMMISSION','REV_MALL')), 0) || '|' || coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role = 'VAT_OUT'), 0) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.entry_date >= '{(v.get('from') or '2000-01-01')}' AND e.entry_date < '{(v.get('to') or '2000-01-01')}'")
        w = call('GET', f'/admin/acct/tax/withholding?ym={ym}', None, TP)
        iv = call('GET', f'/admin/acct/tax/invoices?ym={ym}', None, TP)
        bq = call('GET', '/admin/acct/tax/vat?q=2026-5', None, TS)
        vb = call('GET', f'/admin/acct/tax/vat?q={q}', None, TB)
        nt = call('GET', f'/admin/acct/tax/export?kind=VAT&period={q}', None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_TAX', TS)
        cv = call('GET', f'/admin/acct/tax/export?kind=VAT&period={q}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('﻿').split('\r\n')[0]
        tot = v.get('total') or {}
        ok('③ 신고 자료 — 부가세 분기 합 = 전표 매출 · 부가세 줄 합 · 원천세 달 · 세금계산서 대상(아직 수) · 틀린 분기 ok false · 회원 403 · CSV 승인 없이 422 · 승인 뒤 받음',
           v.get('ok') is True and f"{tot.get('supply')}|{tot.get('vat')}" == sq and 'month' in w and 'ytd' in w and isinstance(iv.get('items'), list) and 'todo' in iv
           and bq.get('ok') is False and vb.get('_err') == 403 and nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk) and head == '분기,증빙,돈 흐름,과세 공급가,세액,면세 매출,전표 수',
           f"{tot} = {sq} · 원천 {w.get('month')} · 계산서 {len(iv.get('items') or [])} 아직 {iv.get('todo')} · {bq.get('ok')} {vb.get('_err')} · {nt.get('code')} · {bool(tk)} · {head[:30]}")
    finally:
        rm_role(pid, '1383')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
