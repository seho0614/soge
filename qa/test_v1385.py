"""v10.385 (D243 · docs/521) 부가세 별도 — 구독 · 소개코드
  ① (코드) D243 · 첫 결제 · 정기 결제 · 소개코드 · 설정 막기 · 화면
  ② (설정) SUPER 만 · 지난 날짜 422 · 오늘 · 비우기
  ③ (금액) 요금제 결제 금액 · 첫 결제 청구서 공급가 · 부가세 · 소개코드 1건 금액 · CHECK
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
    """부가세 별도 시작일을 SQL 로(시험만 · 지난 날짜도) — 비우기는 ''(무늬가 빈 값을 허용)"""
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {TAG}', true); UPDATE site_settings SET value = '{v}' WHERE key = 'vat.separate_from'; COMMIT;")

TAG = '1385'
M43, BS, RB, AS, PP, RS = rd('prisma/migrations/D243_vat_separate/migration.sql'), rd('src/modules/billing/billing.service.ts'), rd('src/modules/billing/recurring-batch.service.ts'), rd('src/modules/admin/admin.service.ts'), rd('site/src/components/billing/PlanPicker.tsx'), rd('site/src/components/refcode/RefShareButton.tsx')
ok('① 코드 — D243 설정 · 셈 함수 · 청구서 공급가 · 부가세 · 소개코드 CHECK · 청구 대상 금액 · 첫 결제 · 정기 결제 · 소개코드 · SUPER 막기 · 결제 화면 · 문서 521 · 판 v10.385',
   "'vat.separate_from'" in M43 and 'FUNCTION public.fn_vat_separate(p_at timestamptz)' in M43 and 'CHECK (amount = unit_price * code_count + vat)' in M43
   and 'CREATE OR REPLACE VIEW public.v_billing_due' in M43 and 'amount: vx.total' in BS and 'const vx = await this.vatFor(extraN * price)' in BS and '"chargePrice"' in BS
   and 'supply = EXCLUDED.supply, vat = EXCLUDED.vat' in RB and "'VAT_START_PAST'" in AS and "'VAT_SETTING_SUPER'" in AS
   and 'p.chargePrice ?? p.monthlyPrice' in PP and 'q.extraCodeCharge ?? q.extraCodePrice' in RS and '부가세' in doc('521_') and VT >= (10, 385), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid = mk_staff(TAG, 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    me, mid = mk_staff(TAG + 'm', None); consent_ok.agree(me, PW); TM = login(me)
    v0 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'vat.separate_from'")
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    today, yday = kst.strftime('%Y-%m-%d'), (kst - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    try:
        na = call('PATCH', '/admin/site-settings', {'key': 'vat.separate_from', 'value': today, 'reason': f'시험 {TAG} ADMIN'}, TA)
        past = call('PATCH', '/admin/site-settings', {'key': 'vat.separate_from', 'value': yday, 'reason': f'시험 {TAG} 지난 날'}, TS)
        okd = call('PATCH', '/admin/site-settings', {'key': 'vat.separate_from', 'value': today, 'reason': f'시험 {TAG} 오늘'}, TS)
        got = psql("SELECT value FROM site_settings WHERE key = 'vat.separate_from'")
        clr = call('PATCH', '/admin/site-settings', {'key': 'vat.separate_from', 'value': '', 'reason': f'시험 {TAG} 비움'}, TS)
        got2 = psql("SELECT coalesce(value, '') FROM site_settings WHERE key = 'vat.separate_from'")
        ok('② 설정 — ADMIN 403 · 지난 날짜 422 VAT_START_PAST · SUPER 오늘 됨 · 비우기 됨',
           na.get('_err') == 403 and past.get('code') == 'VAT_START_PAST' and not okd.get('_err') and got == today and not clr.get('_err') and got2 == '',
           f"{na.get('_err')} {na.get('code')} · {past.get('code')} · {okd.get('_err') or okd.get('code')} {got} · {clr.get('_err') or clr.get('code')} [{got2}]")
        # ③ 금액 — 비었을 때 = 요금 · 시작일(오늘) 뒤 = 요금 + 내림 10%
        setvat('')
        p0 = {x['code']: x for x in (call('GET', '/subscription-plans') or []) if isinstance(x, dict)}
        setvat(today)
        p1 = {x['code']: x for x in (call('GET', '/subscription-plans') or []) if isinstance(x, dict)}
        paid = next((c for c, x in p1.items() if float(x.get('monthlyPrice') or 0) > 0), None)
        pr = float(p1.get(paid, {}).get('monthlyPrice') or 0); want = pr + (pr * 0.1 // 1)
        ex = float(p1.get(paid, {}).get('extraCodePrice') or 0)
        sub = call('POST', '/subscriptions', {'planCode': paid, 'paymentKey': f'stub_{TAG}_{int(time.time())}', 'orderId': f'sub_{TAG}_{int(time.time())}'}, TM) if paid else {}
        inv = psql(f"SELECT i.amount::bigint || '|' || coalesce(i.supply::bigint::text, '') || '|' || coalesce(i.vat::bigint::text, '') FROM subscription_invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE s.account_id = '{mid}' ORDER BY i.issued_at DESC NULLS LAST LIMIT 1")
        q = call('GET', '/me/referral-codes/quota', None, TM)
        due = psql("SELECT pg_get_viewdef('v_billing_due'::regclass) LIKE '%fn_vat_separate(now())%'")
        ck = psql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_rcp_amount'")
        ok('③ 금액 — 시작일 전 결제 금액 = 요금 · 뒤 = 요금 + 내림 10% · 첫 결제 청구서(금액 = 공급가 + 부가세) · 소개코드 1건 금액 · 청구 대상 · 소개코드 CHECK',
           paid and float(p0[paid].get('chargePrice') or 0) == pr and p0[paid].get('vatSeparate') is False and float(p1[paid].get('chargePrice') or 0) == want and p1[paid].get('vatSeparate') is True
           and inv == f'{int(want)}|{int(pr)}|{int(want - pr)}' and float(q.get('extraCodeCharge') or -1) == ex + (ex * 0.1 // 1) and q.get('vatSeparate') is True
           and due == 't' and 'vat' in ck,
           f"{paid} {pr} → {p1.get(paid, {}).get('chargePrice')} (전 {p0.get(paid, {}).get('chargePrice')}) · 구독 {sub.get('_err') or sub.get('code') or 'ok'} · 청구서 {inv} · 코드 {q.get('extraCodeCharge')} · {due} · {ck}")
    finally:
        setvat(v0)
        rm_role(aid, TAG)
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
