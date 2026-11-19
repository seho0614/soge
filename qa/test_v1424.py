"""v10.424 (D253 · docs/561) 결재선 여러 단계 — 품의 · 경비 청구 · 수동 전표
  ① (코드) acct_approval_lines · steps(쌓기만 · 본인 · 두 단계 · 순서 · 결재자 DB 가드) · 기존 승인에 assertStepsDone · recordFinal · API 5 · 화면 · 문서 561
  ② (API · DB) 품의 결재선(ADMIN → SUPER) · SUPER 바로 승인 409 · 결재함 · 본인 422 · ADMIN 1단계 · 다시 422(마지막) · SUPER 승인 · 기록 2줄 · 결재선 되돌림
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
UI, AP, MN, SC, WK, AM = rd('web/src/app/admin/Report.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')

ok('① 코드 — D250 report_sends · report.send off · send_kinds · sendSnapshot(텔레그램 · 슬랙 · 메일) · sendAfterJob · API · 감사 · 화면 · 문서 552 · 판 v10.415',
   'CREATE TABLE IF NOT EXISTS public.report_sends' in M50 and "('report.send', 'off'" in M50 and "'report.send_kinds'" in M50
   and 'export async function sendSnapshot' in RS and 'export async function sendAfterJob' in RS and 'telegram.send' in RS and 'slack.send' in RS and 'mail.send' in RS
   and "@Audit('REPORT_SEND', 'SETTING')" in RC and "@Audit('REPORT_SETTING', 'SETTING')" in RC and 'data-rpt-settings=' in UI and 'data-rpt-send=' in UI
   and '보내기' in doc('552_') and VT >= (10, 415), VER)

M53 = migr('D253_')

AP, OC, RQ, EX, MA = rd('src/modules/acct/approval.ts'), rd('src/modules/acct/office.controller.ts'), rd('src/modules/acct/requisitions.ts'), rd('src/modules/acct/expense.ts'), rd('src/modules/acct/manual.ts')
UI, MN = rd('web/src/app/admin/Office.tsx'), rd('web/src/lib/adminMenu.ts')
ok('① 코드 — D253 결재선 · 단계 표 · 가드(APV_SELF · APV_DUP · APV_ORDER · APV_WHO · 마지막 SUPER) · 기존 승인 3곳 연결 · API 5 · 결재함 화면 · 메뉴 · 문서 561 · 판 v10.424',
   'CREATE TABLE IF NOT EXISTS public.acct_approval_lines' in M53 and 'CREATE TABLE IF NOT EXISTS public.acct_approval_steps' in M53 and all(k in M53 for k in ('APV_SELF', 'APV_DUP', 'APV_ORDER', 'APV_WHO', 'APV_LINE_LAST'))
   and all("assertStepsDone(db, '%s'" % k in s for k, s in (('REQ', RQ), ('EXPENSE', EX), ('MANUAL', MA))) and all("recordFinal(db, '%s'" % k in s for k, s in (('REQ', RQ), ('EXPENSE', EX), ('MANUAL', MA)))
   and "@Get('acct/approvals/inbox')" in OC and "@Post('acct/approvals/:kind/:id/step')" in OC and "@Put('acct/approval-lines')" in OC
   and 'export function ApprovalInbox' in UI and "['approvals', '결재함']" in MN and '"SB-ADM-APV-010"' in SJ and '결재선' in doc('561_') and VT >= (10, 424), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid = mk_staff('1424a', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    pe, pid = mk_staff('1424p', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    before = [l for l in (call('GET', '/admin/acct/approval-lines', None, TS).get('lines') or []) if l.get('docKind') == 'REQ']
    rid = None
    try:
        put = call('PUT', '/admin/acct/approval-lines', {'docKind': 'REQ', 'lines': [{'upto': None, 'steps': [{'role': 'ADMIN'}, {'role': 'SUPER'}]}], 'reason': '시험 1424'}, TS)
        badl = call('PUT', '/admin/acct/approval-lines', {'docKind': 'REQ', 'lines': [{'upto': None, 'steps': [{'role': 'ADMIN'}]}], 'reason': '시험 1424 마지막'}, TS)
        byp = call('PUT', '/admin/acct/approval-lines', {'docKind': 'REQ', 'lines': [], 'reason': '시험 1424 지급'}, TP)
        r = call('POST', '/admin/acct/requisitions', {'title': f'시험 품의 1424-{stamp}', 'amount': 1234000, 'accountRole': 'EXP_SUPPLIES', 'reason': '시험 1424 결재선'}, TP)
        rid = r.get('id')
        early = call('POST', f'/admin/acct/requisitions/{rid}/decide', {'approve': True}, TS)
        ib = call('GET', '/admin/acct/approvals/inbox', None, TA)
        mine = next((x for x in ib.get('items') or [] if x.get('kind') == 'REQ' and str(x.get('id')) == str(rid)), {})
        selfs = call('POST', f'/admin/acct/approvals/REQ/{rid}/step', {'approve': True}, TP)
        s1 = call('POST', f'/admin/acct/approvals/REQ/{rid}/step', {'approve': True, 'note': '시험 1424 1단계'}, TA)
        s2 = call('POST', f'/admin/acct/approvals/REQ/{rid}/step', {'approve': True}, TA)
        fin = call('POST', f'/admin/acct/requisitions/{rid}/decide', {'approve': True, 'note': '시험 1424 최종'}, TS)
        st = call('GET', f'/admin/acct/approvals/REQ/{rid}', None, TS)
        rows = psql(f"SELECT count(*) || '|' || string_agg(decision, ',' ORDER BY id) FROM acct_approval_steps WHERE doc_kind = 'REQ' AND doc_id = {int(rid or 0)}")
        upd = psql(f"UPDATE acct_approval_steps SET note = 'x' WHERE doc_kind = 'REQ' AND doc_id = {int(rid or 0)}")
        ok('② 결재선 — 정하기 · 마지막 SUPER 아니면 422 · 지급 담당 정하기 403 · SUPER 바로 승인 409(앞 단계) · 결재함에 1/2 · 본인 422 · ADMIN 1단계 · 다시 422(마지막) · SUPER 승인 · 기록 2줄(쌓기만)',
           put.get('ok') is True and badl.get('code') == 'APV_LINE_LAST' and byp.get('_err') == 403 and bool(rid) and early.get('code') == 'APV_PENDING'
           and mine.get('step') == 1 and mine.get('of') == 2 and selfs.get('code') == 'APV_SELF' and s1.get('ok') is True and s2.get('code') == 'APV_LAST'
           and fin.get('ok') is True and st.get('state') == 'APPROVED' and rows == '2|APPROVE,APPROVE' and '!' in upd,
           f"{put.get('ok')} {badl.get('code')} {byp.get('_err')} · {rid} {early.get('code')} · {mine.get('step')}/{mine.get('of')} · {selfs.get('code')} {s1.get('ok')} {s2.get('code')} · {fin.get('ok')} {st.get('state')} · {rows} · {upd[-30:]}")
    finally:
        call('PUT', '/admin/acct/approval-lines', {'docKind': 'REQ', 'lines': [{'upto': (int(l['upto']) if l.get('upto') else None), 'steps': l['steps']} for l in before], 'reason': '시험 1424 되돌림'}, TS)
        if rid: call('POST', f'/admin/acct/requisitions/{rid}/cancel', None, TS)
        rm_role(aid, '1424a'); rm_role(pid, '1424p')
    left = [l for l in (call('GET', '/admin/acct/approval-lines', None, TS).get('lines') or []) if l.get('docKind') == 'REQ']
    ok('② 되돌림 — 품의 결재선이 시험 전과 같음(옛 시험 1410 은 SUPER 한 번)', len(left) == len(before), f"{len(before)} → {len(left)}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
