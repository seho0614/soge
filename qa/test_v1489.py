"""v10.489 (D269 · docs/627) 회사 보험 증권 · 만기 — 증권 · 만기 30일 전 알림 · 갱신 · 보험료 선급비용 · 비용 전표 초안(수동 전표 요청)
  ① (코드) D269 증권 · 초안 기록 표 · 계정 PREPAID_EXP · EXP_INS_POLICY · 가드 · 설정 lgl.insurance_alert_days · API · 화면 · 메뉴 · 화면 ID · 문서 627
  ② (API · DB) 넣기 · 지급 담당 목록 · 넣기 403 · 계획(달마다 합계 = 보험료) · 낼 때 초안(선급비용 / 보통예금) · 두 번 409 · 달마다 넘김 · 앞날 422 · 관리자 초안 403 · 취소 뒤 다시 · 월납 · 만기 알림 · 갱신 · 지남 급함 · 끝냄
  ③ (화면) 사무 › 회사 보험
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


PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
FILES = []


def upload(tok, name, purpose='LGL_DOC'):
    """POST /files → 올리기 → complete(시험 PDF) · 파일 번호는 FILES 에 모아 끝에 지움(replica · DELETED)"""
    t = call('POST', '/files', {'purpose': purpose, 'name': name, 'contentType': 'application/pdf', 'size': len(PDF)}, tok)
    origin = API.rsplit('/api/v1', 1)[0]
    url = t.get('uploadUrl') or ''
    if url: raw(t.get('method') or 'PUT', (origin + url) if url.startswith('/') else url, PDF, (t.get('headers') or {}).get('Content-Type', 'application/pdf'))
    call('POST', f"/files/{t.get('fileId')}/complete", None, tok)
    if t.get('fileId'):
        FILES.append(t.get('fileId'))
    return t.get('fileId')


def files_cleanup():
    for f in FILES:
        psql(f"SET session_replication_role = replica; UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id = '{f}' AND status <> 'DELETED';")


def staff(tag, role):
    em, aid = mk_staff(tag, role)
    __import__('consent_ok').agree(em, PW)
    return em, aid, login(em)


def ids_sql(xs):
    return ','.join(str(int(x)) for x in xs if str(x or '').isdigit()) or '0'


M69 = migr('D269_')
LC = rd('src/modules/legal/legal.controller.ts')
LCM, LLI, LRV, LCS, LIN, LDU = rd('src/modules/legal/lgl-common.ts'), rd('src/modules/legal/lgl-licenses.ts'), rd('src/modules/legal/lgl-reviews.ts'), rd('src/modules/legal/lgl-cases.ts'), rd('src/modules/legal/lgl-insurance.ts'), rd('src/modules/legal/lgl-due.ts')
UI, AP, MN, AM, SC, WK = rd('web/src/app/admin/Legal.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
def day(n):
    return (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')
T0 = psql("SELECT now()")

POLS, MANS = [], []


def cleanup():
    ids, ms = ids_sql(POLS), ids_sql(MANS)
    psql("SET session_replication_role = replica; "
         f"DELETE FROM ops_alerts WHERE alert_code = 'LGL_INSURANCE_DUE' AND detail->>'policyId' IN (SELECT x::text FROM unnest(ARRAY[{ids}]::bigint[]) x); "
         f"DELETE FROM lgl_insurance_postings WHERE policy_id IN ({ids}); "
         f"DELETE FROM acct_approval_steps WHERE doc_kind = 'MANUAL' AND doc_id IN ({ms}); "
         f"DELETE FROM acct_manual_entries WHERE id IN ({ms}); "
         f"UPDATE lgl_insurance_policies SET renewed_from = NULL WHERE id IN ({ids}); "
         f"DELETE FROM lgl_insurance_policies WHERE id IN ({ids}); "
         "DELETE FROM lgl_insurance_policies WHERE title = '시험 1489' AND insurer = '시험' AND created_by IS NULL;")
    files_cleanup()


def add_pol(tok, body):
    r = call('POST', '/admin/legal/insurance', body, tok)
    if r.get('id'): POLS.append(r.get('id'))
    return r


def man(r):
    if r.get('manualId'): MANS.append(r.get('manualId'))
    return r


ok('① 코드 — D269 보험 증권 · 초안 기록 표 · 계정 선급비용 PREPAID_EXP · 보험료(회사 보험) EXP_INS_POLICY · 가드(보험료 · 기간 못 고침 · 같은 달 초안 막음) · 설정 · 수동 전표 요청 재사용 · API 6 · 화면 LglInsurance · 메뉴 · 화면 ID · 문서 627 · 판 v10.489',
   'CREATE TABLE IF NOT EXISTS public.lgl_insurance_policies' in M69 and 'CREATE TABLE IF NOT EXISTS public.lgl_insurance_postings' in M69 and "('PREPAID_EXP',    '선급비용'" in M69 and "('EXP_INS_POLICY'" in M69
   and 'LGL_POSTING_DUP' in M69 and 'ck_lgl_ins_monthly' in M69 and "'lgl.insurance_alert_days'" in M69 and "('lgl-insurance', '회사 보험', 'admoff'" in M69 and "('R_PAYOUT', 'lgl-insurance')" in M69
   and "import { addManual } from '../acct/manual'" in LIN and 'export function amortPlan' in LIN and "@Post('insurance/:id/journal')" in LC and "@Roles('PAYOUT')" in LC and 'LGL_INSURANCE_DUE' in LDU
   and 'export function LglInsurance' in UI and "['lgl-insurance', '회사 보험']" in MN and '<LglInsurance />' in AP and "'lgl-insurance': ['SUPER', 'ADMIN', 'PAYOUT']" in AP
   and '"SB-ADM-LGL-040"' in SJ and '선급비용' in doc('627_') and VT >= (10, 489), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid, TA = staff('1489a', 'ADMIN')
    pe, pid, TP = staff('1489p', 'PAYOUT')
    try:
        acc = psql("SELECT string_agg(role || ':' || kind, ',' ORDER BY role) FROM acct_accounts WHERE role IN ('PREPAID_EXP', 'EXP_INS_POLICY')")
        f1 = upload(TA, 'ins1489.pdf')
        s1 = day(-40)
        e1 = (datetime.date.fromisoformat(s1) + datetime.timedelta(days=365)).isoformat()
        p1 = add_pol(TA, {'kind': 'LIABILITY', 'title': f'시험 1489 배상 {stamp}', 'insurer': '시험 화재', 'policyRef': f'P-{stamp}', 'coverage': 100000000, 'premium': 1200000,
                          'startsOn': s1, 'endsOn': e1, 'payMode': 'LUMP', 'bookMode': 'PREPAID', 'fileIds': [f1]})
        P1 = p1.get('id') or '0'
        pl = call('GET', '/admin/legal/insurance', None, TP)
        pp = call('POST', '/admin/legal/insurance', {'title': '시험', 'insurer': '시험', 'premium': 1, 'startsOn': today, 'endsOn': day(30)}, TP)
        one = call('GET', f'/admin/legal/insurance/{P1}', None, TP)
        plan = one.get('plan', [])
        am = [x for x in plan if x.get('kind') == 'AMORT']
        j403 = call('POST', f'/admin/legal/insurance/{P1}/journal', {'kind': 'PAY'}, TA)
        j1 = man(call('POST', f'/admin/legal/insurance/{P1}/journal', {'kind': 'PAY', 'on': today}, TP))
        lines = psql(f"SELECT state || '|' || total || '|' || (lines->0->>'role') || '|' || (lines->1->>'role') FROM acct_manual_entries WHERE id = {int(j1.get('manualId') or 0)}")
        j1b = call('POST', f'/admin/legal/insurance/{P1}/journal', {'kind': 'PAY', 'on': today}, TP)
        ym0 = s1[:7]
        j2 = man(call('POST', f'/admin/legal/insurance/{P1}/journal', {'kind': 'AMORT', 'ym': ym0, 'on': today}, TP))
        l2 = psql(f"SELECT (lines->0->>'role') || '|' || (lines->1->>'role') FROM acct_manual_entries WHERE id = {int(j2.get('manualId') or 0)}")
        jfut = call('POST', f'/admin/legal/insurance/{P1}/journal', {'kind': 'AMORT', 'ym': am[-1].get('ym') if am else '2099-01'}, TP)
        jmon = call('POST', f'/admin/legal/insurance/{P1}/journal', {'kind': 'MONTHLY', 'ym': ym0}, TP)
        cx = call('POST', f"/admin/acct/manual/{j1.get('manualId')}/cancel", None, TP)
        j1c = man(call('POST', f'/admin/legal/insurance/{P1}/journal', {'kind': 'PAY', 'on': today}, TS))
        gp = psql(f"UPDATE lgl_insurance_policies SET premium = 1 WHERE id = {int(P1)}")
        gpd = psql(f"INSERT INTO lgl_insurance_postings (policy_id, kind, ym, amount, manual_id) VALUES ({int(P1)}, 'PAY', '{today[:7]}', 1, {int(j1c.get('manualId') or 0)})")
        ok('② 증권 · 초안 — 계정 2개 · 넣기 · 지급 담당 목록 · 넣기 403 · 계획(낼 때 1 + 달마다 넘김 합 = 보험료) · 관리자 초안 403 · 낼 때 초안(요청 · 선급비용 / 보통예금) · 두 번 409 · 달마다 넘김(보험료 / 선급비용) · 앞날 422 · 일시납 월납 422 · 취소 뒤 다시 · DB 보험료 고치기 · 같은 달 기록 막음',
           acc == 'EXP_INS_POLICY:EXPENSE,PREPAID_EXP:ASSET' and p1.get('ok') is True and any(x.get('id') == P1 for x in pl.get('items', [])) and pp.get('_err') == 403
           and len([x for x in plan if x.get('kind') == 'PAY']) == 1 and sum(x.get('amount', 0) for x in am) == 1200000 and len(am) >= 12 and j403.get('_err') == 403
           and lines == 'REQUESTED|1200000|PREPAID_EXP|CASH' and j1b.get('code') == 'LGL_POSTING_DUP' and l2 == 'EXP_INS_POLICY|PREPAID_EXP' and j2.get('amount', 0) > 0
           and jfut.get('code') == 'LGL_POSTING' and jmon.get('code') == 'LGL_POSTING' and cx.get('state') == 'CANCELED' and bool(j1c.get('manualId')) and 'LGL_INSURANCE' in gp and 'LGL_POSTING' in gpd,
           f"{acc} {p1.get('ok') or p1.get('code')} {pp.get('_err')} {len(plan)} {sum(x.get('amount', 0) for x in am)} {j403.get('_err')} {lines} {j1b.get('code')} {l2} {j2.get('amount') or j2.get('code')} "
           f"{jfut.get('code')} {jmon.get('code')} {cx.get('state') or cx.get('code')} {j1c.get('manualId') or j1c.get('code')} {gp[-30:]} {gpd[-30:]}")

        p2 = add_pol(TA, {'kind': 'CAR', 'title': f'시험 1489 월납 {stamp}', 'insurer': '시험 화재', 'premium': 120001, 'startsOn': s1, 'endsOn': e1, 'payMode': 'MONTHLY', 'bookMode': 'PREPAID'})
        P2 = p2.get('id') or '0'
        bm = psql(f"SELECT book_mode FROM lgl_insurance_policies WHERE id = {int(P2)}")
        mp = [x for x in call('GET', f'/admin/legal/insurance/{P2}', None, TA).get('plan', []) if x.get('kind') == 'MONTHLY']
        jm = man(call('POST', f'/admin/legal/insurance/{P2}/journal', {'kind': 'MONTHLY', 'ym': ym0, 'on': today}, TP))
        jpay = call('POST', f'/admin/legal/insurance/{P2}/journal', {'kind': 'PAY'}, TP)
        gck = psql(f"INSERT INTO lgl_insurance_policies (title, insurer, premium, starts_on, ends_on, pay_mode, book_mode) VALUES ('시험 1489', '시험', 1, '{today}', '{day(30)}', 'MONTHLY', 'PREPAID')")
        ok('② 월납 — 월납이면 바로 비용 · 달마다 합계 = 보험료(마지막 달 끝수) · 월납 초안(보험료 / 보통예금) · 월납에 낼 때 422 · DB 월납 + 선급비용 막음',
           bm == 'EXPENSE' and sum(x.get('amount', 0) for x in mp) == 120001 and jm.get('amount') == 120001 // len(mp or [1]) and jpay.get('code') == 'LGL_POSTING' and 'ck_lgl_ins_monthly' in gck,
           f"{bm} {sum(x.get('amount', 0) for x in mp)} {jm.get('amount') or jm.get('code')} {jpay.get('code')} {gck[-40:]}")

        p3 = add_pol(TA, {'kind': 'FIRE', 'title': f'시험 1489 만기 {stamp}', 'insurer': '시험 화재', 'premium': 500000, 'startsOn': day(-355), 'endsOn': day(10)})
        P3 = p3.get('id') or '0'
        p4 = add_pol(TA, {'kind': 'CYBER', 'title': f'시험 1489 지남 {stamp}', 'insurer': '시험 화재', 'premium': 500000, 'startsOn': day(-400), 'endsOn': day(-5)})
        P4 = p4.get('id') or '0'
        jb = call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        a3 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'LGL_INSURANCE_DUE' AND resolved_at IS NULL AND detail->>'key' = 'INS:{P3}:{day(10)}'")
        a4 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'LGL_INSURANCE_DUE' AND resolved_at IS NULL AND detail->>'key' = 'INS:{P4}:{day(-5)}:X'")
        call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        a3n = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_INSURANCE_DUE' AND detail->>'policyId' = '{P3}'")
        rn = add_pol(TA, {'kind': 'FIRE', 'title': f'시험 1489 만기 갱신 {stamp}', 'insurer': '시험 화재', 'premium': 520000, 'startsOn': day(10), 'endsOn': day(375), 'renewedFrom': P3})
        a3r = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_INSURANCE_DUE' AND resolved_at IS NULL AND detail->>'policyId' = '{P3}'")
        rn2 = call('POST', '/admin/legal/insurance', {'kind': 'FIRE', 'title': '시험 1489 두 번', 'insurer': '시험', 'premium': 1, 'startsOn': day(10), 'endsOn': day(375), 'renewedFrom': P3}, TA)
        bd = call('GET', '/admin/legal/insurance', None, TA)
        r3 = next((x for x in bd.get('items', []) if x.get('id') == P3), {})
        en = call('POST', f'/admin/legal/insurance/{P4}/end', {'reason': '시험 1489 해지'}, TA)
        a4r = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_INSURANCE_DUE' AND resolved_at IS NULL AND detail->>'policyId' = '{P4}'")
        eu = call('PUT', f'/admin/legal/insurance/{P4}', {'memo': 'x'}, TA)
        gdl = psql(f"DELETE FROM lgl_insurance_policies WHERE id = {int(P4)}")
        ok('② 만기 — 10일 남음 경고 · 5일 지남 급함 · 두 번 돌려도 한 번 · 갱신 증권 넣으면 풀림 · 두 번 갱신 409 · 목록 갱신함 표시 · 끝냄이면 풀림 · 끝낸 것 고치기 409 · DB 지우기 막음',
           jb.get('job') == 'lgl_due' and a3 == 'WARN' and a4 == 'CRITICAL' and a3n == '1' and rn.get('renewedFrom') == P3 and a3r == '0' and rn2.get('code') == 'LGL_INSURANCE_RENEW'
           and r3.get('renewedBy') == rn.get('id') and r3.get('due') is False and en.get('ok') is True and a4r == '0' and eu.get('code') == 'LGL_INSURANCE_STATE' and 'LGL_INSURANCE' in gdl,
           f"{jb.get('job') or jb} {a3} {a4} {a3n} {rn.get('renewedFrom') or rn.get('code')} {a3r} {rn2.get('code')} {r3.get('renewedBy')} {r3.get('due')} {en.get('ok')} {a4r} {eu.get('code')} {gdl[-30:]}")
        f9 = upload(TA, 'ins1489-free.pdf')
        fo_pay, fo_free, fo_own = call('GET', f'/files/{f1}', None, TP), call('GET', f'/files/{f9}', None, TP), call('GET', f'/files/{f9}', None, TA)
        ok('② 법무 서류 LGL_DOC 열람 — 보험 증권에 붙은 파일은 지급 담당도 엶 · 붙지 않은 법무 서류는 지급 담당 404 · 올린 사람은 엶',
           bool(fo_pay.get('url')) and fo_free.get('_err') == 404 and bool(fo_own.get('url')), f"{bool(fo_pay.get('url'))} {fo_free.get('_err')} {bool(fo_own.get('url'))}")
    finally:
        cleanup(); rm_role(aid, '1489'); rm_role(pid, '1489')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-lgl-insurance]', timeout=30000)
            pg.wait_for_timeout(1500)
            seen['form'] = pg.locator('[data-lgl-policy-form]').count()
            seen['list'] = pg.locator('[data-lgl-policy-list]').count()
        res = admin_page('/#/lgl-insurance', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 사무 › 회사 보험 넣기 상자 · 목록 · 화면 오류 없음', seen.get('form') == 1 and seen.get('list') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
