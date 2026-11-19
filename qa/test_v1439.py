"""v10.439 (D257 · docs/576) 고정비 자동 전표 — 계약 달 금액 → 미지급 비용 · 매입 맞춤 → 되돌림
  ① (코드) 규칙 · 달 줄 표 · 가드 · 설정 · 정기 작업 acct_accrual · 전표 2가지(ACCRUAL_SOURCES) · API 3 · 화면 · 문서 576
  ② (API · DB) 정기 작업 → 줄(부가세 포함 ÷ 1.1) · 전표 차변 지급임차료 · 대변 미지급금 · 비용 아닌 계정 422 · 같은 거래처 매입 → 자동 맞춤 → 되돌림 전표 · 두 번 맞춤 409 · 되돌림
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


M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')

M57 = migr('D257_')
AX, AU, AM, AR, RA = rd('src/modules/acct/acct-extra.controller.ts'), rd('src/modules/acct/accountant.ts'), rd('src/modules/acct/accrual.ts'), rd('src/modules/acct/archive.ts'), rd('src/modules/acct/receipt-ai.ts')
UI, AP, MN, SC, WK, APM = rd('web/src/app/admin/AcctExtra.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
AUTH, PRN, MID, RPS, EXA, SRC = rd('src/core/auth.ts'), rd('src/modules/identity/principal.service.ts'), rd('src/modules/identity/auth.middleware.ts'), rd('src/modules/site/report.service.ts'), rd('src/modules/admin/export-approval.ts'), rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
stamp = int(time.time()) % 1000000

ok('① 코드 — D257 acct_contract_accrual_rules · acct_contract_accruals(가드 · 고유) · acct.contract_accrue(off) · acct_accrual 01:20 · ACCRUAL_SOURCES · API 3 · 화면 · 문서 576 · 판 v10.439',
   'CREATE TABLE IF NOT EXISTS public.acct_contract_accruals' in M57 and 'ACCRUAL_ROLE' in M57 and "('acct.contract_accrue', 'off'" in M57 and "('acct_accrual', 1440, 1, 20" in M57
   and "name: 'CONTRACT_ACCRUE'" in AM and "name: 'CONTRACT_ACCRUE_REV'" in AM and 'ACCRUAL_SOURCES' in SRC and "case 'acct_accrual':" in SC and "'acct_accrual'," in WK
   and "@Get('accruals')" in AX and "@Put('accruals/rules/:contractId')" in AX and 'export function AccrualBox' in UI and '"SB-ADM-ACC-440"' in SJ and '고정비' in doc('576_') and VT >= (10, 439), VER)

def lines_of(src, key):
    return psql(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.source = '{src}' AND e.source_key = '{key}'")

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    T0 = psql("SELECT clock_timestamp()::text")   # 이 시각 뒤 생긴 고정비 줄 · 전표 · 알림은 모두 시험 것 — 끝에 지움(다른 계약에 생긴 줄도)
    pe, pid = mk_staff('1439', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    s0 = getset('acct.contract_accrue')
    biz = str(7000000000 + stamp)[:10]
    party = psql(f"INSERT INTO acct_parties (kind, name, biz_no) VALUES ('SUPPLIER', '시험임대1439-{stamp}', '{biz}') RETURNING id")
    con = psql(f"INSERT INTO acct_contracts (party_id, title, kind, start_on, monthly_amount, pay_day) VALUES ({party}, '시험 사무실 1439 {stamp}', 'RENT', date_trunc('month', current_date)::date, 110000, 25) RETURNING id")
    acc = ''
    try:
        bad = call('PUT', f'/admin/acct/accruals/rules/{con}', {'accountRole': 'CASH', 'vatIncluded': True, 'enabled': True}, TS)
        setting('acct.contract_accrue', 'on', '1439')
        call('POST', '/admin/jobs', {'job': 'acct_accrual'}, TS)
        row = psql(f"SELECT id || '|' || account_role || '|' || amount || '|' || state FROM acct_contract_accruals WHERE contract_id = {con}")
        acc = row.split('|')[0] if '|' in row else ''
        call('POST', '/admin/acct/journal/run', None, TS)
        l1 = lines_of('CONTRACT_ACCRUE', acc)
        pu = call('POST', '/admin/acct/purchases', {'kind': 'TAX_INVOICE', 'issuedOn': d0, 'supplierName': f'시험임대1439-{stamp}', 'supplierBizNo': biz, 'item': '11월 임대료',
                                                 'supply': 100000, 'vat': 10000, 'accountRole': 'EXP_RENT', 'payRole': 'AP', 'force': True}, TP)
        call('POST', '/admin/jobs', {'job': 'acct_accrual'}, TS)
        st = psql(f"SELECT state || '|' || coalesce(matched_by, '') || '|' || coalesce(purchase_id::text, '') FROM acct_contract_accruals WHERE id = {acc or 0}")
        call('POST', '/admin/acct/journal/run', None, TS)
        l2 = lines_of('CONTRACT_ACCRUE_REV', acc)
        again = call('POST', f'/admin/acct/accruals/{acc}/match', {'purchaseId': str(pu.get('id') or 0)}, TS)
        view = call('GET', f'/admin/acct/accruals?ym={ym}', None, TP)
        mine = next((c for c in view.get('contracts') or [] if c.get('id') == con), {})
        ok('② 고정비 — 비용 아닌 계정 422 · 정기 작업 → 줄(지급임차료 · 110,000 ÷ 1.1 = 100,000) · 전표 차변 지급임차료 / 대변 미지급금 · 같은 거래처 매입 → 자동 맞춤 · 되돌림 전표 · 두 번 맞춤 409 · 화면 줄',
           bad.get('code') == 'ACCRUAL_ROLE' and row.endswith('|EXP_RENT|100000|ACCRUED') and l1 == 'EXP_RENT:100000:0,AP:0:100000'
           and pu.get('id') is not None and st.startswith('MATCHED|AUTO|') and l2 == 'AP:100000:0,EXP_RENT:0:100000' and again.get('_err') == 409
           and mine.get('accrualState') == 'MATCHED',
           f"{bad.get('code')} · {row} · {l1} · {pu.get('id') or pu.get('code')} · {st} · {l2} · {again.get('_err')} · {mine.get('accrualState')}")
    finally:
        setting('acct.contract_accrue', s0 or 'off', '1439')
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('CONTRACT_ACCRUE', 'CONTRACT_ACCRUE_REV') AND source_key = '{acc or 0}'); "
             f"DELETE FROM acct_entries WHERE source IN ('CONTRACT_ACCRUE', 'CONTRACT_ACCRUE_REV') AND source_key = '{acc or 0}'; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'ACCT_ACCRUAL_UNMATCHED' AND detail->>'accrualId' = '{acc or 0}'; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT e.id FROM acct_entries e JOIN acct_contract_accruals x ON x.id::text = e.source_key WHERE e.source IN ('CONTRACT_ACCRUE', 'CONTRACT_ACCRUE_REV') AND x.created_at >= '{T0}'); "
             f"DELETE FROM acct_entries e USING acct_contract_accruals x WHERE x.id::text = e.source_key AND e.source IN ('CONTRACT_ACCRUE', 'CONTRACT_ACCRUE_REV') AND x.created_at >= '{T0}'; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'ACCT_ACCRUAL_UNMATCHED' AND raised_at >= '{T0}'; "
             f"DELETE FROM acct_contract_accruals WHERE contract_id = {con} OR created_at >= '{T0}'; DELETE FROM acct_contract_accrual_rules WHERE contract_id = {con}; "
             f"DELETE FROM acct_contracts WHERE id = {con};")
        rm_role(pid, '1439')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
