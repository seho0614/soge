"""v10.466 (D264 · docs/604) 영업 기회 CRM — 거래처 · 단계(상담 → 견적 → 계약 → 성사 · 실패) · 예상 매출 · 담당 · 다음 할 일 알림 · 견적서 연결
  ① (코드) D264 sal_opps · 기록 · 가드 · 설정 · 정기 작업 sal_opp_remind · SalesController · 메뉴 · 화면 SAL-010 · 문서 604
  ② (API · DB) 회원 403 · 만들기 · 이름 400 · 없는 거래처 404 · 고치기(보낸 칸만) · 알림(한 번) · 견적서 초안 → 견적 · 계약 · 실패 사유 422 · 성사 · 성사 뒤 409 · DB 막음 · 알림 풀림 · 메모 · 기록 · 권한 주소 7
  ③ (화면) 회계 › 영업 기회
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


M64 = migr('D264_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')

CR, SC_, AM, MN, AP, SCH, WK, UI = (rd('src/modules/acct/crm.ts'), rd('src/modules/acct/sales.controller.ts'), rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts'),
                                   rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('web/src/app/admin/Sales.tsx'))
ok('① 코드 — D264 sal_opps(단계 5 · 성사 · 실패 사유 CHECK) · 기록(쌓기만) · 가드(성사 고치기 · 지우기 · 같은 거래처 견적서) · 설정 sales.opp_remind · 정기 작업 sal_opp_remind 08:50 · SalesController(/admin/sales) · 견적서 초안(createDoc) · 알림 SAL_OPP_DUE · 메뉴 sal-crm · 화면 SAL-010 · 문서 604 · 판 v10.466',
   'CREATE TABLE IF NOT EXISTS public.sal_opps' in M64 and "CHECK (stage IN ('LEAD', 'QUOTE', 'CONTRACT', 'WON', 'LOST'))" in M64 and 'ck_sal_opp_lost' in M64
   and 'trg_sal_opp_guard' in M64 and 'trg_sal_opp_logs_ro' in M64 and "('sales.opp_remind', 'on'" in M64 and "('sal_opp_remind', 1440, 8, 50" in M64
   and 'export async function salOppRemindJob' in CR and 'createDoc(db' in CR and "'SAL_OPP_DUE'" in CR and "@Post('sales/opps/:id/quote')" in SC_ and "@Post('sales/opps/:id/stage')" in SC_
   and 'SalesController' in AM and "case 'sal_opp_remind':" in SCH and "'sal_opp_remind'," in WK and "['sal-crm', '영업 기회']" in MN and "{tab === 'sal-crm' && <SalCrm />}" in AP
   and 'export function SalCrm' in UI and '"SB-ADM-SAL-010"' in SJ and '파이프라인' in doc('604_') and VT >= (10, 466), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pid = oid = did = ''
    try:
        pid = psql(f"INSERT INTO acct_parties (kind, name, contact_name) VALUES ('CUSTOMER', '시험 1466 거래처-{stamp}', '담당 1466') RETURNING id").split('\n')[0]
        mb = call('GET', '/admin/sales/opps', None, TB)
        c = call('POST', '/admin/sales/opps', {'partyId': pid, 'title': f'시험 1466 기회-{stamp}', 'expectedAmount': 5000000, 'nextAction': '전화', 'nextActionOn': today}, TS); oid = str(c.get('id') or '')
        short = call('POST', '/admin/sales/opps', {'partyId': pid, 'title': 'x'}, TS)
        nop = call('POST', '/admin/sales/opps', {'partyId': '999999999', 'title': '시험 1466 없는 거래처'}, TS)
        ed = call('PUT', f'/admin/sales/opps/{oid}', {'memo': '시험 1466 메모'}, TS)
        keep = psql(f"SELECT expected_amount || '|' || coalesce(next_action, '') || '|' || coalesce(next_action_on::text, '') FROM sal_opps WHERE id = {int(oid or 0)}")
        call('POST', '/admin/jobs', {'job': 'sal_opp_remind'}, TS); call('POST', '/admin/jobs', {'job': 'sal_opp_remind'}, TS)
        al1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SAL_OPP_DUE' AND detail->>'opp' = '{oid}' AND resolved_at IS NULL")
        qt = call('POST', f'/admin/sales/opps/{oid}/quote', {}, TS); did = str(qt.get('quoteDocId') or '')
        dq = psql(f"SELECT kind || '|' || party_id || '|' || total FROM acct_sales_docs WHERE id::text = '{did}'") if did else ''
        dbq = psql(f"INSERT INTO acct_sales_docs (kind, doc_no, rev, party_id, title, issued_on, revenue_role, supply, vat, total) VALUES ('ORDER', 'T1466-{stamp}', 1, {int(pid or 0)}, 'x', current_date, 'REV_SALES', 1, 0, 1) RETURNING id") if pid else ''
        tmpdoc = dbq.split('\n')[0] if dbq and '!' not in dbq else ''
        badq = psql(f"UPDATE sal_opps SET quote_doc_id = '{tmpdoc}' WHERE id = {int(oid or 0)}") if tmpdoc else '!SAL_OPP_QUOTE'
        s1 = call('POST', f'/admin/sales/opps/{oid}/stage', {'stage': 'CONTRACT'}, TS)
        lost0 = call('POST', f'/admin/sales/opps/{oid}/stage', {'stage': 'LOST'}, TS)
        won = call('POST', f'/admin/sales/opps/{oid}/stage', {'stage': 'WON', 'note': '시험 1466 계약'}, TS)
        won2 = call('POST', f'/admin/sales/opps/{oid}/stage', {'stage': 'LOST', 'note': '시험 1466 뒤집기'}, TS)
        ed2 = call('PUT', f'/admin/sales/opps/{oid}', {'title': '시험 1466 고침'}, TS)
        dbu = psql(f"UPDATE sal_opps SET title = '바꿈' WHERE id = {int(oid or 0)}")
        dbd = psql(f"DELETE FROM sal_opps WHERE id = {int(oid or 0)}")
        call('POST', '/admin/jobs', {'job': 'sal_opp_remind'}, TS)
        al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SAL_OPP_DUE' AND detail->>'opp' = '{oid}' AND resolved_at IS NULL")
        nt = call('POST', f'/admin/sales/opps/{oid}/note', {'note': '시험 1466 방문'}, TS)
        det = call('GET', f'/admin/sales/opps/{oid}', None, TS)
        lro = psql(f"UPDATE sal_opp_logs SET note = '바꿈' WHERE opp_id = {int(oid or 0)}")
        lst = call('GET', '/admin/sales/opps?stage=WON', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'sal-crm'")
        kinds = sorted(l.get('kind') for l in det.get('logs') or [])
        ok('② 영업 기회 — 회원 403 · 만들기(상담) · 이름 400 · 없는 거래처 404 · 고치기(보낸 칸만 · 다른 칸 그대로) · 다음 할 일 알림 1(두 번 돌려도) · 견적서 초안(QUOTE · 같은 거래처 · 5,500,000) → 견적 · 다른 종류 문서 DB 막음 · 계약 · 실패 사유 422 · 성사 · 성사 뒤 단계 409 · 고치기 409 · DB 고치기 · 지우기 막음 · 닫으면 알림 풀림 · 메모 · 기록(쌓기만 · 만듦 · 고침 · 견적 · 단계 · 메모) · 성사 목록 · 권한 주소 7',
           mb.get('_err') == 403 and c.get('stage') == 'LEAD' and short.get('_err') == 400 and nop.get('_err') == 404 and ed.get('ok') is True and keep == f'5000000|전화|{today}'
           and al1 == '1' and qt.get('stage') == 'QUOTE' and dq == f'QUOTE|{pid}|5500000' and 'SAL_OPP_QUOTE' in badq and s1.get('stage') == 'CONTRACT' and lost0.get('code') == 'SAL_REASON'
           and won.get('stage') == 'WON' and won2.get('_err') == 409 and ed2.get('_err') == 409 and 'SAL_OPP_STATE' in dbu and 'SAL_OPP_STATE' in dbd and al2 == '0' and nt.get('ok') is True
           and det.get('opp', {}).get('stage') == 'WON' and {'CREATE', 'EDIT', 'QUOTE', 'STAGE', 'NOTE'} <= set(kinds) and '!' in lro
           and any(x.get('id') == oid for x in lst.get('items') or []) and int((lst.get('summary') or {}).get('wonThisMonth') or 0) >= 1 and rmap == '7',
           f"{mb.get('_err')} {c.get('stage') or c} {short.get('_err')} {nop.get('_err')} {ed.get('ok')} {keep} · 알림 {al1} · {qt.get('stage') or qt} {dq} {badq[-30:]} · {s1.get('stage')} {lost0.get('code')} {won.get('stage')} {won2.get('_err')} {ed2.get('_err')} {dbu[-30:]} {dbd[-30:]} · {al2} {nt.get('ok')} {kinds} {lro[-20:]} · {rmap}")
        if tmpdoc:
            psql(f"SET session_replication_role = replica; DELETE FROM acct_sales_docs WHERE id = '{tmpdoc}';")
    finally:
        if oid.isdigit():
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'SAL_OPP_DUE' AND detail->>'opp' = '{oid}'; "
                 f"DELETE FROM sal_opp_logs WHERE opp_id = {oid}; DELETE FROM sal_opps WHERE id = {oid};")
        if did:
            psql(f"SET session_replication_role = replica; DELETE FROM acct_sales_doc_lines WHERE doc_id::text = '{did}'; DELETE FROM acct_sales_docs WHERE id::text = '{did}';")
        if pid.isdigit():
            psql(f"SET session_replication_role = replica; DELETE FROM acct_sales_docs WHERE party_id = {pid} AND doc_no LIKE 'T1466-%'; DELETE FROM sal_opps WHERE party_id = {pid}; DELETE FROM acct_parties WHERE id = {pid};")
    if ADMIN_WEB:
        r = admin_page('/#/sal-crm', lambda pg, seen: seen.update(n=pg.locator('[data-sal-crm]').count(), pipe=pg.locator('[data-sal-pipe]').count(), new=pg.locator('[data-sal-new]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회계 › 영업 기회(파이프라인 3단계 · 새 기회 칸 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('pipe') == 3 and seen.get('new') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
