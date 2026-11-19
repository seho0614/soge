"""v10.387 (D243 · docs/523) 부가세 별도 — 리드 캐시 충전 · 충전 때 세금계산서
  ① (코드) D243 · 충전 · 확인 · 자동 · 환불 · 화면
  ② (충전) 시작일 전 = 충전 금액 · 뒤 = 충전 + 부가세 · 지갑은 충전 금액만 · 세금계산서 요청 줄 · 전표
  ③ (환불) 부가세 몫 함께 취소
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




def setvat(v):
    """부가세 별도 시작일을 SQL 로(시험만 · 지난 날짜도) — 비우기는 ''"""
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {TAG}', true); UPDATE site_settings SET value = '{v}' WHERE key = 'vat.separate_from'; COMMIT;")

TAG = '1387'
M43, LC, CP, JN = rd('prisma/migrations/D243_vat_separate/migration.sql'), rd('src/modules/partner/lead-cash.service.ts'), rd('site/src/components/partner/CashPanel.tsx'), rd('src/modules/acct/journal.ts')
ok('① 코드 — D243 충전 부가세 · 충전 세금계산서 트리거 · 달 사용액은 시작일 전만 · 충전 · 확인 대조 · 자동 · 환불 부가세 몫 · 화면 · 전표 · 문서 523 · 판 v10.387',
   'trg_lead_cash_charge_invoice' in M43 and 'ON CONFLICT (partner_id, ym) WHERE charge_id IS NULL DO NOTHING' in M43 and 'payAmount: Number(c.amount) + vat' in LC
   and 'const payAmount = Number(c.amount) + Number(c.vat ?? 0);' in LC and 'amount: c.payAmount,' in LC and 'cancelAmount: part + vatPart' in LC
   and 'c0.payAmount ?? c0.amount' in CP and 'data-cash-vat=' in CP and "revenueSep('REV_LEAD'" in JN and '세금계산서' in doc('523_') and VT >= (10, 387), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('intro@x.com', PW)
    TS, TP = login('admin@x.com'), login('intro@x.com')
    v0 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'vat.separate_from'")
    is0 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'acct.include_stub'")
    st0 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'acct.start_on'")
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    today = kst.strftime('%Y-%m-%d')
    seta = lambda k, v: psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {TAG}', true); UPDATE site_settings SET value = '{v}' WHERE key = '{k}'; COMMIT;")
    wal = lambda: (call('GET', '/partner/cash', None, TP) or {})
    def charge(amt, pay):
        c = call('POST', '/partner/cash/charges', {'amount': amt}, TP)
        j = call('POST', '/partner/cash/charges/confirm', {'orderId': c.get('orderId'), 'paymentKey': f'stub_{TAG}_{time.time_ns()}', 'amount': pay(c)}, TP) if c.get('orderId') else {}
        return c, j
    try:
        seta('acct.include_stub', 'on'); seta('acct.start_on', '2026-01-01')
        setvat('')
        w0 = wal(); room = int((w0.get('limits') or {}).get('maxBalance') or 0) - int(w0.get('paid') or 0)
        if room < 60000 and int(w0.get('paid') or 0) > 0:   # 다른 시험이 채운 잔액 — 시작일 전(부가세 없음)에 덜어 둠
            call('POST', '/partner/cash/refunds', {'amount': min(int(w0.get('paid') or 0), 60000 - room), 'reason': f'시험 {TAG} 자리 만들기'}, TP)
        c0, j0 = charge(20000, lambda c: c.get('amount'))
        inv0 = psql(f"SELECT count(*) FROM lead_cash_invoices WHERE charge_id = '{c0.get('id')}'")
        setvat(today)
        w1 = wal()
        bad = call('POST', '/partner/cash/charges', {'amount': 20000}, TP)
        badc = call('POST', '/partner/cash/charges/confirm', {'orderId': bad.get('orderId'), 'paymentKey': f'stub_{TAG}_bad_{time.time_ns()}', 'amount': 20000}, TP) if bad.get('orderId') else {}
        c1, j1 = charge(20000, lambda c: c.get('payAmount'))
        w2 = wal()
        inv1 = psql(f"SELECT total || '|' || supply || '|' || vat || '|' || state FROM lead_cash_invoices WHERE charge_id = '{c1.get('id')}'")
        call('POST', '/admin/acct/journal/run', None, TS)
        en = psql(f"SELECT (SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_lines l WHERE l.entry_id = e.id) FROM acct_entries e WHERE e.source = 'LEAD_CHARGE' AND e.source_key = '{c1.get('id')}'")
        ok('② 충전 — 시작일 전 결제 = 충전 금액 · 세금계산서 줄 없음 · 뒤 결제 = 22,000(충전 금액만 보내면 422) · 지갑 +20,000 · 세금계산서 요청 22,000 = 20,000 + 2,000 · 전표 받을 돈 22,000 · 매출 20,000 · 부가세 2,000 · vatSeparate',
           j0.get('ok') is True and int(c0.get('vat') or 0) == 0 and int(c0.get('payAmount') or 0) == 20000 and inv0 == '0'
           and int(c1.get('vat') or 0) == 2000 and int(c1.get('payAmount') or 0) == 22000 and j1.get('ok') is True and badc.get('code') == 'AMOUNT_MISMATCH'
           and int(w2.get('paid') or 0) - int(w1.get('paid') or 0) == 20000 and inv1 == '22000|20000|2000|REQUESTED' and en == 'PG_RECV:22000:0,REV_LEAD:0:20000,VAT_OUT:0:2000' and w2.get('vatSeparate') is True,
           f"전 {c0.get('payAmount')} {j0.get('ok') or j0.get('code')} 줄 {inv0} · 뒤 {c1.get('payAmount')} {j1.get('ok') or j1.get('code')} · 잘못 {badc.get('code')} · 지갑 {w1.get('paid')} → {w2.get('paid')} · {inv1} · {en} · {w2.get('vatSeparate')}")
        rf = call('POST', '/partner/cash/refunds', {'amount': 10000, 'reason': f'시험 {TAG} 환불'}, TP)
        pt = psql(f"SELECT p.amount || '|' || p.vat || '|' || c.vat_refunded FROM lead_cash_refund_parts p JOIN lead_cash_charges c ON c.id = p.charge_id WHERE p.charge_id = '{c1.get('id')}' ORDER BY p.refund_id DESC LIMIT 1")
        ok('③ 환불 — 10,000 환불이면 그 충전 부가세 몫 1,000 함께 취소 · vat_refunded 1,000',
           rf.get('ok') is True and pt == '10000|1000|1000', f"{rf.get('state') or rf.get('code')} · {pt}")
    finally:
        setvat(v0); seta('acct.include_stub', is0 or 'off'); seta('acct.start_on', st0 or '2026-11-01')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
