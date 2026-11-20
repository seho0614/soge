"""v10.487 (D269 · docs/625) 계약 검토 요청 — 계약서 파일 · 요청 → 검토 의견 → SUPER 승인 · 반려 · ⑯ 계약 대장 연결 · 희망일 지남 알림
  ① (코드) D269 검토 요청 · 의견 표 · 가드(요청한 사람 의견 · 결정 막음) · API · 화면 · 메뉴 · 화면 ID · 문서 625
  ② (API · DB) 파일 없음 400 · 갱신인데 계약 없음 422 · 지난 희망일 422 · 요청 · 의견 전 결정 409 · 요청한 사람 의견 403 · 의견 · 관리자 결정 403 · 반려 사유 422 · 승인 · 연결(한 번) · 취소 · 늦음 알림
  ③ (화면) 사무 › 계약 검토
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

REVS, CONS = [], []


def cleanup():
    ids, cids = ids_sql(REVS), ids_sql(CONS)
    psql("SET session_replication_role = replica; "
         f"DELETE FROM lgl_review_opinions WHERE review_id IN ({ids}); "
         f"DELETE FROM lgl_contract_reviews WHERE id IN ({ids}); "
         f"DELETE FROM acct_contracts WHERE id IN ({cids}); "
         f"DELETE FROM ops_alerts WHERE alert_code = 'LGL_REVIEW_LATE' AND detail->>'reviewId' IN (SELECT x::text FROM unnest(ARRAY[{ids}]::bigint[]) x);")
    files_cleanup()


ok('① 코드 — D269 계약 검토 요청 · 의견 표 · 가드(요청한 사람 의견 · 결정 · 내용 고치기 막음) · ⑯ acct_contracts 연결 · API 7 · 화면 LglReviews · 메뉴 · 화면 ID · 문서 625 · 판 v10.487',
   'CREATE TABLE IF NOT EXISTS public.lgl_contract_reviews' in M69 and 'CREATE TABLE IF NOT EXISTS public.lgl_review_opinions' in M69 and 'REFERENCES public.acct_contracts(id)' in M69
   and 'ck_lgl_rv_self' in M69 and 'LGL_SELF' in M69 and 'trg_lgl_review_opinions_guard' in M69 and "('lgl-reviews', '계약 검토', 'admoff'" in M69
   and "@Post('reviews/:id/opinions')" in LC and "@Post('reviews/:id/decide')" in LC and "@Post('reviews/:id/link')" in LC and 'LGL_REVIEW_LATE' in LDU
   and 'export async function decideReview' in LRV and 'export function LglReviews' in UI and "['lgl-reviews', '계약 검토']" in MN and '<LglReviews />' in AP
   and '"SB-ADM-LGL-020"' in SJ and '계약 검토' in doc('625_') and VT >= (10, 487), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid, TA = staff('1487a', 'ADMIN')
    be, bid, TB2 = staff('1487b', 'ADMIN')
    pe, pid, TP = staff('1487p', 'PAYOUT')
    ve, vid, TV = staff('1487v', 'REVIEWER')
    try:
        f1 = upload(TA, 'ct1487.pdf')
        c = psql(f"INSERT INTO acct_contracts (title, kind, start_on, created_by) VALUES ('시험 1487 계약 {stamp}', 'SERVICE', '{today}', '{aid}') RETURNING id").split('\n')[0]
        if c.isdigit(): CONS.append(c)
        nof = call('POST', '/admin/legal/reviews', {'title': '시험 1487', 'fileIds': []}, TA)
        rnc = call('POST', '/admin/legal/reviews', {'title': '시험 1487 갱신', 'kind': 'RENEW', 'fileIds': [f1]}, TA)
        past = call('POST', '/admin/legal/reviews', {'title': '시험 1487', 'wantedOn': day(-1), 'fileIds': [f1]}, TA)
        r1 = call('POST', '/admin/legal/reviews', {'title': f'시험 1487 물류 {stamp}', 'counterparty': '시험 상대', 'amount': 1200000, 'wantedOn': day(3), 'summary': '손해배상 조항', 'fileIds': [f1]}, TA)
        if r1.get('id'): REVS.append(r1.get('id'))
        R1 = r1.get('id') or '0'
        d0 = call('POST', f'/admin/legal/reviews/{R1}/decide', {'approve': True}, TS)
        self_ = call('POST', f'/admin/legal/reviews/{R1}/opinions', {'body': '내 의견', 'risk': 'LOW'}, TA)
        op = call('POST', f'/admin/legal/reviews/{R1}/opinions', {'body': '제9조 손해배상 한도 없음', 'risk': 'HIGH', 'outside': True}, TB2)
        st1 = psql(f"SELECT state FROM lgl_contract_reviews WHERE id = {int(R1)}")
        dA = call('POST', f'/admin/legal/reviews/{R1}/decide', {'approve': True}, TB2)
        rj = call('POST', f'/admin/legal/reviews/{R1}/decide', {'approve': False}, TS)
        ap = call('POST', f'/admin/legal/reviews/{R1}/decide', {'approve': True, 'note': '수정본으로 진행'}, TS)
        op2 = call('POST', f'/admin/legal/reviews/{R1}/opinions', {'body': '늦은 의견'}, TB2)
        gs = psql(f"INSERT INTO lgl_review_opinions (review_id, author, body) VALUES ({int(R1)}, '{aid}', '시험')")
        gt = psql(f"UPDATE lgl_contract_reviews SET title = '바꿈' WHERE id = {int(R1)}")
        one = call('GET', f'/admin/legal/reviews/{R1}', None, TA)
        bd = call('GET', '/admin/legal/reviews', None, TA)
        row = next((x for x in bd.get('items', []) if x.get('id') == R1), {})
        ok('② 검토 — 파일 없음 400 · 갱신인데 계약 없음 422 · 지난 희망일 422 · 요청 · 의견 전 결정 409 · 요청한 사람 의견 403 · 다른 운영자 의견 → REVIEWED · 관리자 결정 403 · 반려 사유 422 · SUPER 승인 · 결정 뒤 의견 409 · DB 요청한 사람 의견 · 내용 고치기 막음 · 상세 · 목록 위험 높음',
           nof.get('_err') == 400 and rnc.get('code') == 'LGL_REVIEW_LINK' and past.get('code') == 'LGL_DATE' and r1.get('state') == 'REQUESTED'
           and d0.get('code') == 'LGL_REVIEW_STATE' and self_.get('code') == 'LGL_SELF' and op.get('ok') is True and st1 == 'REVIEWED' and dA.get('_err') == 403
           and rj.get('code') == 'LGL_REASON' and ap.get('state') == 'APPROVED' and op2.get('code') == 'LGL_REVIEW_STATE' and ('LGL_SELF' in gs or 'LGL_REVIEW_STATE' in gs) and 'LGL_REVIEW' in gt
           and len(one.get('opinions', [])) == 1 and (one.get('opinions') or [{}])[0].get('outside') is True and row.get('riskLevel') == 3,
           f"{nof.get('_err')} {rnc.get('code')} {past.get('code')} {r1.get('state') or r1.get('code')} {d0.get('code')} {self_.get('code')} {op.get('ok') or op.get('code')} {st1} {dA.get('_err')} "
           f"{rj.get('code')} {ap.get('state') or ap.get('code')} {op2.get('code')} {gs[-30:]} {gt[-30:]} {len(one.get('opinions', []))} {row.get('riskLevel')}")

        ln = call('POST', f'/admin/legal/reviews/{R1}/link', {'contractId': c}, TA)
        ln2 = call('POST', f'/admin/legal/reviews/{R1}/link', {'contractId': c}, TA)
        ln0 = call('POST', f'/admin/legal/reviews/{R1}/link', {'contractId': '999999999'}, TA)
        r2 = call('POST', '/admin/legal/reviews', {'title': f'시험 1487 갱신 {stamp}', 'kind': 'RENEW', 'contractId': c, 'fileIds': [f1]}, TA)
        if r2.get('id'): REVS.append(r2.get('id'))
        R2 = r2.get('id') or '0'
        cx403 = call('POST', f'/admin/legal/reviews/{R2}/cancel', None, TB2)
        cx = call('POST', f'/admin/legal/reviews/{R2}/cancel', None, TA)
        cx2 = call('POST', f'/admin/legal/reviews/{R2}/cancel', None, TA)
        r3 = call('POST', '/admin/legal/reviews', {'title': f'시험 1487 늦음 {stamp}', 'wantedOn': today, 'fileIds': [f1]}, TA)
        if r3.get('id'): REVS.append(r3.get('id'))
        R3 = r3.get('id') or '0'
        psql(f"SET session_replication_role = replica; UPDATE lgl_contract_reviews SET wanted_on = '{day(-2)}' WHERE id = {int(R3)};")
        jb = call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        late = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_REVIEW_LATE' AND resolved_at IS NULL AND detail->>'key' = 'REV:{R3}'")
        call('POST', '/admin/jobs', {'job': 'lgl_due'}, TS)
        late2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_REVIEW_LATE' AND detail->>'key' = 'REV:{R3}'")
        call('POST', f'/admin/legal/reviews/{R3}/cancel', None, TS)
        lateR = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'LGL_REVIEW_LATE' AND resolved_at IS NULL AND detail->>'key' = 'REV:{R3}'")
        ok('② 연결 · 취소 · 늦음 — 계약 대장 연결 · 두 번 409 · 없는 계약 422 · 갱신 요청(계약 있음) · 남이 취소 403 · 요청한 사람 취소 · 두 번 409 · 희망일 지나면 LGL_REVIEW_LATE 한 번 · SUPER 취소하면 풀림',
           ln.get('contractId') == c and ln2.get('code') == 'LGL_REVIEW_LINK' and ln0.get('code') == 'LGL_REVIEW_LINK' and r2.get('ok') is True
           and cx403.get('_err') == 403 and cx.get('state') == 'CANCELED' and cx2.get('code') == 'LGL_REVIEW_STATE' and jb.get('job') == 'lgl_due' and late == '1' and late2 == '1' and lateR == '0',
           f"{ln.get('contractId') or ln.get('code')} {ln2.get('code')} {ln0.get('code')} {r2.get('ok') or r2.get('code')} {cx403.get('_err')} {cx.get('state') or cx.get('code')} {cx2.get('code')} {jb.get('job') or jb} {late} {late2} {lateR}")
        fo_own, fo_adm, fo_pay, fo_rev = (call('GET', f'/files/{f1}', None, t) for t in (TA, TB2, TP, TV))
        ok('② 법무 서류 LGL_DOC 열람 — 계약서는 올린 사람 · 다른 운영 관리자 엶 · 지급 담당 · 검수 담당 404',
           bool(fo_own.get('url')) and bool(fo_adm.get('url')) and fo_pay.get('_err') == 404 and fo_rev.get('_err') == 404,
           f"{bool(fo_own.get('url'))} {bool(fo_adm.get('url'))} {fo_pay.get('_err')} {fo_rev.get('_err')}")
    finally:
        cleanup(); rm_role(aid, '1487'); rm_role(bid, '1487'); rm_role(pid, '1487'); rm_role(vid, '1487')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-lgl-reviews]', timeout=30000)
            pg.wait_for_timeout(1500)
            seen['form'] = pg.locator('[data-lgl-review-form]').count()
            seen['list'] = pg.locator('[data-lgl-review-list]').count()
        res = admin_page('/#/lgl-reviews', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 사무 › 계약 검토 요청 상자 · 목록 · 화면 오류 없음', seen.get('form') == 1 and seen.get('list') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
