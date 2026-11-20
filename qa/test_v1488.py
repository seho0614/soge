"""v10.488 (D269 · docs/626) 소송 · 분쟁 사건 대장 — 사건 · 기일(7 · 1일 전 알림) · 비용(경비 청구 · 매입 연결) · 결과
  ① (코드) D269 사건 · 기일 · 비용 표 · 가드 · 같은 전표 두 번 막음 · 설정 lgl.hearing_alert_days · API · 화면 · 메뉴 · 화면 ID · 문서 626
  ② (API · DB) 사건 · 기일(시각 틀림 400) · 정기 작업 1일 차례 급함 · 끝남이면 풀림 · 다시 고치기 409 · 7일 차례 경고 · 비용(경비 청구 연결 · 두 번 409 · 둘 다 422 · 무효) · 끝냄(남은 기일 취소) · DB 막음
  ③ (화면) 사무 › 소송 · 분쟁
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

CASES, CLAIMS = [], []


def cleanup():
    ids, cl = ids_sql(CASES), ids_sql(CLAIMS)
    psql("SET session_replication_role = replica; "
         f"DELETE FROM ops_alerts WHERE alert_code = 'LGL_HEARING_DUE' AND detail->>'caseId' IN (SELECT x::text FROM unnest(ARRAY[{ids}]::bigint[]) x); "
         f"DELETE FROM lgl_case_costs WHERE case_id IN ({ids}); "
         f"DELETE FROM lgl_case_hearings WHERE case_id IN ({ids}); "
         f"DELETE FROM lgl_cases WHERE id IN ({ids}); "
         f"DELETE FROM acct_expense_claims WHERE id IN ({cl});")
    files_cleanup()


ok('① 코드 — D269 사건 · 기일 · 비용 표 · 가드 · 같은 전표 두 번 막음(ux_lgl_cost_claim) · 설정 lgl.hearing_alert_days · LGL_HEARING_DUE · API 9 · 화면 LglCases · 메뉴 · 화면 ID · 문서 626 · 판 v10.488',
   'CREATE TABLE IF NOT EXISTS public.lgl_cases' in M69 and 'CREATE TABLE IF NOT EXISTS public.lgl_case_hearings' in M69 and 'CREATE TABLE IF NOT EXISTS public.lgl_case_costs' in M69
   and 'ux_lgl_cost_claim' in M69 and 'REFERENCES public.acct_expense_claims(id)' in M69 and "'lgl.hearing_alert_days'" in M69 and "('lgl-cases', '소송 · 분쟁', 'admoff'" in M69
   and "@Post('cases/:id/hearings')" in LC and "@Put('hearings/:id')" in LC and "@Post('cases/:id/costs')" in LC and "@Post('cases/:id/close')" in LC and 'LGL_HEARING_DUE' in LDU
   and 'export async function addCost' in LCS and 'export function LglCases' in UI and "['lgl-cases', '소송 · 분쟁']" in MN and '<LglCases />' in AP
   and '"SB-ADM-LGL-030"' in SJ and '기일' in doc('626_') and VT >= (10, 488), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid, TA = staff('1488a', 'ADMIN')
    pe, pid, TP = staff('1488p', 'PAYOUT')
    try:
        f1 = upload(TA, 'case1488.pdf')
        c1 = call('POST', '/admin/legal/cases', {'caseRef': f'2026가단{stamp}', 'title': f'시험 1488 물품대금 {stamp}', 'kind': 'CIVIL', 'ourSide': 'PLAINTIFF', 'counterparty': '시험 상대',
                                                  'forum': '시험 법원', 'counsel': '시험 변호사', 'claimAmount': 30000000, 'fileIds': [f1]}, TA)
        if c1.get('id'): CASES.append(c1.get('id'))
        C1 = c1.get('id') or '0'
        hbad = call('POST', f'/admin/legal/cases/{C1}/hearings', {'at': '내일 10시'}, TA)
        h1 = call('POST', f'/admin/legal/cases/{C1}/hearings', {'at': f'{day(1)}T10:00', 'kind': 'HEARING', 'place': '시험 법정', 'note': '1차 변론'}, TA)
        H1 = h1.get('id') or '0'
        jb = call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        a1 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'LGL_HEARING_DUE' AND resolved_at IS NULL AND detail->>'key' = 'HEAR:{H1}:{day(1)}:1'")
        call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        a1n = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_HEARING_DUE' AND detail->>'hearingId' = '{H1}'")
        dn = call('PUT', f'/admin/legal/hearings/{H1}', {'state': 'DONE', 'outcome': '다음 기일 지정'}, TA)
        a1r = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_HEARING_DUE' AND resolved_at IS NULL AND detail->>'hearingId' = '{H1}'")
        dn2 = call('PUT', f'/admin/legal/hearings/{H1}', {'state': 'CANCELED'}, TA)
        h2 = call('POST', f'/admin/legal/cases/{C1}/hearings', {'at': f'{day(5)}T14:00:00+09:00', 'kind': 'DEADLINE'}, TA)
        H2 = h2.get('id') or '0'
        call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        a7 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'LGL_HEARING_DUE' AND resolved_at IS NULL AND detail->>'key' = 'HEAR:{H2}:{day(5)}:7'")
        gh = psql(f"DELETE FROM lgl_case_hearings WHERE id = {int(H1)}")
        ok('② 기일 — 사건 넣기 · 시각 틀림 400 · 내일 기일 1일 차례 급함 · 두 번 돌려도 한 번 · 끝남(결과 한 줄)이면 풀림 · 끝난 기일 고치기 409 · 5일 뒤 기한 7일 차례 경고 · DB 지우기 막음',
           c1.get('ok') is True and hbad.get('_err') == 400 and h1.get('ok') is True and jb.get('job') == 'lgl_due' and a1 == 'CRITICAL' and a1n == '1'
           and dn.get('state') == 'DONE' and a1r == '0' and dn2.get('code') == 'LGL_HEARING_STATE' and h2.get('ok') is True and a7 == 'WARN' and 'LGL_HEARING' in gh,
           f"{c1.get('ok') or c1.get('code')} {hbad.get('_err')} {h1.get('ok') or h1.get('code')} {jb.get('job') or jb} {a1} {a1n} {dn.get('state') or dn.get('code')} {a1r} {dn2.get('code')} {h2.get('ok') or h2.get('code')} {a7} {gh[-30:]}")

        cl = psql(f"SET session_replication_role = replica; INSERT INTO acct_expense_claims (claimant, spent_on, account_role, amount, evidence, item) VALUES ('{aid}', '{today}', 'EXP_FEE', 3300000, 'SIMPLE', '시험 1488 착수금') RETURNING id").split('\n')[-1]
        if cl.isdigit(): CLAIMS.append(cl)
        k1 = call('POST', f'/admin/legal/cases/{C1}/costs', {'kind': 'COUNSEL', 'amount': 3300000, 'paidOn': today, 'expenseClaimId': cl, 'note': '착수금'}, TA)
        k2 = call('POST', f'/admin/legal/cases/{C1}/costs', {'kind': 'COUNSEL', 'amount': 3300000, 'paidOn': today, 'expenseClaimId': cl}, TA)
        kb = call('POST', f'/admin/legal/cases/{C1}/costs', {'amount': 1000, 'paidOn': today, 'expenseClaimId': cl, 'purchaseId': '1'}, TA)
        kf = call('POST', f'/admin/legal/cases/{C1}/costs', {'amount': 1000, 'paidOn': day(2)}, TA)
        k3 = call('POST', f'/admin/legal/cases/{C1}/costs', {'kind': 'STAMP', 'amount': 120000, 'paidOn': today}, TA)
        v3 = call('POST', f"/admin/legal/costs/{k3.get('id')}/void", {'reason': '시험 1488 잘못 넣음'}, TA)
        v3b = call('POST', f"/admin/legal/costs/{k3.get('id')}/void", {'reason': '시험 1488 잘못 넣음'}, TA)
        gc = psql(f"UPDATE lgl_case_costs SET amount = 1 WHERE id = {int(k1.get('id') or 0)}")
        one = call('GET', f'/admin/legal/cases/{C1}', None, TA)
        bd = call('GET', '/admin/legal/cases', None, TA)
        row = next((x for x in bd.get('items', []) if x.get('id') == C1), {})
        ok('② 비용 — 경비 청구 연결 · 같은 청구 두 번 409 · 청구 · 매입 둘 다 422 · 앞날 422 · 연결 없는 줄 · 무효 · 두 번 409 · DB 고치기 막음 · 합계(유효만) 3,300,000 · 목록 비용 합 · 다음 기일',
           k1.get('ok') is True and k2.get('code') == 'LGL_COST_DUP' and kb.get('code') == 'LGL_COST_LINK' and kf.get('code') == 'LGL_DATE' and k3.get('ok') is True
           and v3.get('ok') is True and v3b.get('code') == 'LGL_COST_STATE' and 'LGL_COST' in gc and one.get('costTotal') == 3300000 and row.get('costTotal') == 3300000 and bool(row.get('nextAt')),
           f"{k1.get('ok') or k1.get('code')} {k2.get('code')} {kb.get('code')} {kf.get('code')} {k3.get('ok') or k3.get('code')} {v3.get('ok')} {v3b.get('code')} {gc[-30:]} {one.get('costTotal')} {row.get('costTotal')} {row.get('nextAt')}")

        cbad = call('POST', f'/admin/legal/cases/{C1}/close', {'result': 'NOPE'}, TA)
        cc = call('POST', f'/admin/legal/cases/{C1}/close', {'result': 'SETTLED', 'resultNote': '시험 1488 합의'}, TA)
        h2s = psql(f"SELECT state FROM lgl_case_hearings WHERE id = {int(H2)}")
        a7r = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_HEARING_DUE' AND resolved_at IS NULL AND detail->>'hearingId' = '{H2}'")
        cc2 = call('POST', f'/admin/legal/cases/{C1}/close', {'result': 'WIN'}, TA)
        ch = call('POST', f'/admin/legal/cases/{C1}/hearings', {'at': f'{day(9)}T10:00'}, TA)
        cu = call('PUT', f'/admin/legal/cases/{C1}', {'memo': 'x'}, TA)
        gd = psql(f"DELETE FROM lgl_cases WHERE id = {int(C1)}")
        gr = psql(f"UPDATE lgl_cases SET state = 'OPEN', result = NULL, closed_on = NULL WHERE id = {int(C1)}")
        ok('② 끝냄 — 모르는 결과 400 · 합의로 끝냄 · 남은 예정 기일 취소 · 그 알림 풀림 · 두 번 409 · 끝난 사건 기일 · 고치기 409 · DB 지우기 · 되돌리기 막음',
           cbad.get('_err') == 400 and cc.get('ok') is True and cc.get('canceledHearings') == 1 and h2s == 'CANCELED' and a7r == '0' and cc2.get('code') == 'LGL_CASE_STATE'
           and ch.get('code') == 'LGL_CASE_STATE' and cu.get('code') == 'LGL_CASE_STATE' and 'LGL_CASE' in gd and 'LGL_CASE' in gr,
           f"{cbad.get('_err')} {cc.get('canceledHearings') if cc.get('ok') else cc.get('code')} {h2s} {a7r} {cc2.get('code')} {ch.get('code')} {cu.get('code')} {gd[-30:]} {gr[-30:]}")
        fo_own, fo_sup, fo_pay = call('GET', f'/files/{f1}', None, TA), call('GET', f'/files/{f1}', None, TS), call('GET', f'/files/{f1}', None, TP)
        ok('② 법무 서류 LGL_DOC 열람 — 사건 서류는 올린 사람 · SUPER 엶 · 지급 담당 404',
           bool(fo_own.get('url')) and bool(fo_sup.get('url')) and fo_pay.get('_err') == 404, f"{bool(fo_own.get('url'))} {bool(fo_sup.get('url'))} {fo_pay.get('_err')}")
    finally:
        cleanup(); rm_role(aid, '1488'); rm_role(pid, '1488')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-lgl-cases]', timeout=30000)
            pg.wait_for_timeout(1500)
            seen['form'] = pg.locator('[data-lgl-case-form]').count()
            seen['list'] = pg.locator('[data-lgl-case-list]').count()
        res = admin_page('/#/lgl-cases', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 사무 › 소송 · 분쟁 넣기 상자 · 목록 · 화면 오류 없음', seen.get('form') == 1 and seen.get('list') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
