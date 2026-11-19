"""v10.436 (D256 · docs/573) 미수금 독촉 · 입금 예정
  ① (코드) D256 문안 3단계 · 보낸 기록(쌓기만) · 입금 예정 · 설정 acct.dunning off · 정기 작업 acct_dunning · API · 화면 · 문서 573
  ② (API · DB) 45일 지난 받을 돈 → 1단계 · 미리 보기 · 보내기(메일 준비 안 됨이면 NOT_READY 로 기록) · 지급 담당 보내기 403 · 문안 날수 차례 422 · 입금 예정 → 자금 흐름 예정 · 닫기 → 예정 취소 · 정기 작업(꺼짐)
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

ok('① 코드 — D256 acct_dunning_templates(3) · acct_dunning_sends(쌓기만) · acct_receipt_promises · acct.dunning off · acct_dunning 09:35 · API · scheduler · 화면 ErpDunning · 문서 573 · 판 v10.436',
   'CREATE TABLE IF NOT EXISTS public.acct_dunning_templates' in M56 and 'trg_acct_dunning_sends_ro' in M56 and 'CREATE TABLE IF NOT EXISTS public.acct_receipt_promises' in M56
   and "('acct.dunning', 'off'" in M56 and "('acct_dunning', 1440, 9, 35" in M56 and 'export async function dunningJob' in DN and "case 'acct_dunning':" in SC and "'acct_dunning'," in WK
   and "@Post('dunning/send')" in EC and 'export function ErpDunning' in UI and "'acct-dunning'" in MN and '"SB-ADM-ACC-410"' in SJ and '독촉' in doc('573_') and VT >= (10, 436), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1436', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    ptid, pnm = party('1436', f't1436-{stamp}@x.com')
    d45 = (kst - datetime.timedelta(days=45)).strftime('%Y-%m-%d')
    key = f't1436-{stamp}'
    eid = ''
    try:
        eid = psql(f"SET session_replication_role = replica; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo, party) VALUES ('{d45}', 'TEST', '{key}', '시험 1436', '{pnm}') RETURNING id) "
                   f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'AR', 55000, 0 FROM e UNION ALL SELECT id, 'REV_SALES', 0, 55000 FROM e; "
                   f"SELECT id FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}'").split('\n')[-1]
        v = call('GET', '/admin/acct/dunning', None, TP)
        row = next((x for x in v.get('rows') or [] if x.get('party') == pnm), {})
        pv = call('POST', '/admin/acct/dunning/preview', {'party': pnm}, TP)
        sp = call('POST', '/admin/acct/dunning/send', {'party': pnm}, TP)
        sd = call('POST', '/admin/acct/dunning/send', {'party': pnm}, TS)
        logn = psql(f"SELECT count(*) || '|' || coalesce(max(result), '') FROM acct_dunning_sends WHERE party_name = '{pnm}'")
        bt = call('PUT', '/admin/acct/dunning/templates/1', {'days': 70, 'subject': '시험 제목', 'body': '시험 본문 열 글자 넘게 씀'}, TS)
        pm = call('POST', '/admin/acct/receipt-promises', {'party': pnm, 'amount': 55000, 'dueOn': (kst + datetime.timedelta(days=5)).strftime('%Y-%m-%d'), 'note': '시험 1436'}, TP)
        plan = psql(f"SELECT direction || '|' || amount || '|' || state FROM acct_cash_plans WHERE id = {int(pm.get('cashPlanId') or 0)}")
        cl = call('POST', f"/admin/acct/receipt-promises/{pm.get('id')}/close", {'state': 'KEPT', 'note': '시험 1436 입금'}, TP)
        plan2 = psql(f"SELECT state FROM acct_cash_plans WHERE id = {int(pm.get('cashPlanId') or 0)}")
        jb = call('POST', '/admin/jobs', {'job': 'acct_dunning'}, TS)
        ok('② 독촉 — 45일 → 1단계 · 메일 가림 · 미리 보기(거래처 · 금액) · 지급 담당 보내기 403 · SUPER 보내기(SENT · NOT_READY) 기록 1 · 문안 날수 차례 422 · 입금 예정 → 자금 흐름 IN · 닫기 → 예정 취소 · 정기 작업',
           row.get('stage') == 1 and row.get('due') is True and '***@' in str(row.get('email')) and pnm in str(pv.get('text')) and '55,000' in str(pv.get('text'))
           and sp.get('_err') == 403 and sd.get('result') in ('SENT', 'NOT_READY', 'FAILED') and logn.split('|')[0] == '1' and bt.get('code') == 'ACCT_DUNNING'
           and plan == '|'.join(['IN', '55000', 'ACTIVE']) and cl.get('ok') is True and plan2 == 'CANCELED' and jb.get('_err') is None,
           f"{row.get('stage')} {row.get('due')} {row.get('email')} · {str(pv.get('subject'))[:30]} · {sp.get('_err')} {sd.get('result')} {logn} {bt.get('code')} {plan} {cl.get('ok')} {plan2} {jb.get('_err')}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}'); "
             f"DELETE FROM acct_entries WHERE source = 'TEST' AND source_key = '{key}'; DELETE FROM acct_dunning_sends WHERE party_name = '{pnm}'; "
             f"WITH p AS (DELETE FROM acct_receipt_promises WHERE party_name = '{pnm}' RETURNING cash_plan_id) DELETE FROM acct_cash_plans WHERE id IN (SELECT cash_plan_id FROM p); "
             f"DELETE FROM acct_parties WHERE name = '{pnm}';")
        rm_role(pid, '1436')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
