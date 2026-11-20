"""v10.464 (D263 · docs/602) 출장 신청(품의) → 다녀온 뒤 여비 정산 → 경비 청구
  ① (코드) D263 ofc_trips · ofc_trip_settlements(claim_id 고유 · 두 번 청구 가드) · 여비 기준 설정 · addRequisition · createExpense 재사용 · OfcController · 화면 OfcTrips · 메뉴 · 화면 목록 OFC-030 · 문서 602
  ② (API · DB) 날짜 거꾸로 422 · 신청 = 품의(EXP_TRAVEL · 예상 금액) · 결재 전 정산 409 · SUPER 결재 · 남이 정산 403 · 정산 = 경비 청구(간이 · 부가세 0 · 품의 연결 · 품의 씀) · 다시 정산 409 · DB 가 같은 청구 · 지우기 막음
           · 청구 반려 뒤 넘는 금액 422 · 다시 정산 · 기준 고치기 SUPER 만 · 취소 = 품의 취소
  ③ (화면) 사무 › 출장 신청 상자 · 화면 오류 없음
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


def staff(tag, role):
    """운영 계정 하나 + 약관 동의 + 증표(시험 끝에 역할 지움)"""
    import consent_ok
    em, aid = mk_staff(tag, role)
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M63 = migr('D263_')
CC, CT, CR, CN, OC = (rd('src/modules/acct/ofc-calendar.ts'), rd('src/modules/acct/ofc-tasks.ts'), rd('src/modules/acct/ofc-trips.ts'),
                      rd('src/modules/acct/ofc-notify.ts'), rd('src/modules/acct/ofc.controller.ts'))
UI, AP, MN, AM, SC, WK = (rd('web/src/app/admin/Ofc.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'),
                          rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, ym = kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m')
day = lambda n: (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')

ok('① 코드 — D263 ofc_trips · ofc_trip_settlements · fn_ofc_trip_settle_guard(OFC_TRIP_DOUBLE) · uq_ots_claim · ofc.trip_per_diem · lodging_caps · addRequisition · createExpense · OfcTrips · 메뉴 · 화면 목록 OFC-030 · 문서 602 · 판 v10.464',
   'CREATE TABLE IF NOT EXISTS public.ofc_trips' in M63 and 'CREATE TABLE IF NOT EXISTS public.ofc_trip_settlements' in M63 and 'OFC_TRIP_DOUBLE' in M63 and 'uq_ots_claim' in M63
   and "('ofc.trip_per_diem', '25000'" in M63 and "'SEOUL:100000,METRO:80000,OTHER:70000'" in M63
   and 'addRequisition(db' in CR and 'createExpense(db' in CR and "accountRole: 'EXP_TRAVEL'" in CR and "@Post('office/trips/:id/settle')" in OC
   and 'export function OfcTrips' in UI and "['ofc-trips', '출장']" in MN and "{tab === 'ofc-trips' && <OfcTrips />}" in AP and '"SB-ADM-OFC-030"' in SJ
   and '여비' in doc('602_') and VT >= (10, 464), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    te, tid_, TT = staff('1464t', 'ADMIN')
    tag = f'시험1464-{stamp}'
    trips, reqs, claims = [], [], []
    try:
        lst = call('GET', '/admin/office/trips', None, TT)
        sd = lst.get('standards') or {}
        per, meal, cap = int(sd.get('perDiem') or 0), int(sd.get('meal') or 0), int((sd.get('lodgingCaps') or {}).get('METRO') or 0)
        tol = int(psql("SELECT coalesce(value, '10') FROM site_settings WHERE key = 'acct.req_tolerance_pct'") or 10)
        bad = call('POST', '/admin/office/trips', {'destination': f'{tag} 거꾸로', 'region': 'METRO', 'purpose': '시험', 'departOn': day(-2), 'returnOn': day(-3)}, TT)
        n1 = call('POST', '/admin/office/trips', {'destination': f'{tag} 부산', 'region': 'METRO', 'purpose': '거래처 협의 시험', 'departOn': day(-3), 'returnOn': day(-2), 'transportEst': 50000}, TT)
        tr1, rq1 = str(n1.get('id') or ''), str(n1.get('requisitionId') or '')
        if tr1: trips.append(tr1)
        if rq1: reqs.append(rq1)
        exp = per * 2 + meal * 2 + cap * 1 + 50000
        rq = psql(f"SELECT account_role || '|' || amount || '|' || state || '|' || (requester = '{tid_}') FROM acct_requisitions WHERE id = {int(rq1 or 0)}")
        early = call('POST', f'/admin/office/trips/{tr1}/settle', {'transport': 40000, 'lodging': 60000}, TT)
        ok('② 신청 — 날짜 거꾸로 422 · 품의 같이(EXP_TRAVEL · 예상 = 일비 × 2 + 식비 × 2 + 광역시 상한 × 1 + 교통 5만 · 결재 기다림 · 본인) · 결재 전 정산 409',
           bad.get('code') == 'OFC_TRIP_DATE' and n1.get('ok') is True and n1.get('estimate') == exp and rq == f'EXP_TRAVEL|{exp}|REQUESTED|true'
           and early.get('_err') == 409 and early.get('code') == 'OFC_TRIP_STATE', f"{bad.get('code')} {n1.get('estimate')}/{exp} {rq} {early.get('_err')}/{early.get('code')}")
        dc = call('POST', f'/admin/acct/requisitions/{rq1}/decide', {'approve': True, 'note': '시험 1464'}, TS)
        if dc.get('_err'):   # 결재선이 여러 단계로 남아 있으면(다른 시험) 마지막 SUPER 결재를 DB 로 대신
            sid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
            psql(f"UPDATE acct_requisitions SET state = 'APPROVED', decided_by = '{sid}', decided_at = now() WHERE id = {int(rq1 or 0)} AND state = 'REQUESTED'")
        who = call('POST', f'/admin/office/trips/{tr1}/settle', {'transport': 40000, 'lodging': 60000}, TS)
        s1 = call('POST', f'/admin/office/trips/{tr1}/settle', {'transport': 40000, 'lodging': 90000, 'nights': 1, 'memo': 'KTX'}, TT)
        c1 = str(s1.get('claimId') or '')
        if c1: claims.append(c1)
        tot1 = per * 2 + meal * 2 + min(90000, cap) + 40000
        cl = psql(f"SELECT claimant = '{tid_}' AND account_role = 'EXP_TRAVEL' AND evidence = 'SIMPLE' AND vat = 0 AND requisition_id = {int(rq1 or 0)} AND state = 'REQUESTED' AND amount = {tot1} FROM acct_expense_claims WHERE id = {int(c1 or 0)}")
        rs = psql(f"SELECT state FROM acct_requisitions WHERE id = {int(rq1 or 0)}")
        tst = psql(f"SELECT state || '|' || coalesce(claim_id::text, '') FROM ofc_trips WHERE id = {int(tr1 or 0)}")
        dbl = call('POST', f'/admin/office/trips/{tr1}/settle', {'transport': 1000, 'lodging': 0}, TT)
        dup = psql(f"INSERT INTO ofc_trip_settlements (trip_id, claim_id, amount, detail) VALUES ({int(tr1 or 0)}, {int(c1 or 0)}, 1, '{{}}'::jsonb)")
        dl = psql(f"DELETE FROM ofc_trips WHERE id = {int(tr1 or 0)}")
        ok('② 정산 — 남(SUPER)이 정산 403 · 본인 정산 = 경비 청구(본인 · EXP_TRAVEL · 간이 · 부가세 0 · 품의 연결 · 금액 = 일비 · 식비 · 숙박 상한까지 · 교통) · 품의 씀 · 출장 정산함 · 다시 정산 409 · DB 가 같은 청구 · 지우기 막음',
           who.get('_err') == 403 and who.get('code') == 'OFC_TRIP_WHO' and s1.get('ok') is True and s1.get('amount') == tot1 and cl == 't' and rs == 'USED' and tst == f'SETTLED|{c1}'
           and dbl.get('_err') == 409 and dbl.get('code') == 'OFC_TRIP_DOUBLE' and '!' in dup and '!' in dl,
           f"{who.get('_err')}/{who.get('code')} {s1.get('amount')}/{tot1} {cl} {rs} {tst} {dbl.get('_err')}/{dbl.get('code')} {dup[-40:]} {dl[-30:]}")
        rj = call('POST', f'/admin/acct/expenses/{c1}/decide', {'decision': 'reject', 'reason': '시험 1464 반려'}, TS)
        over = call('POST', f'/admin/office/trips/{tr1}/settle', {'transport': 10000000, 'lodging': 0}, TT)
        s2 = call('POST', f'/admin/office/trips/{tr1}/settle', {'transport': 30000, 'lodging': 50000}, TT)
        c2 = str(s2.get('claimId') or '')
        if c2: claims.append(c2)
        tst2 = psql(f"SELECT claim_id::text FROM ofc_trips WHERE id = {int(tr1 or 0)}")
        nset = psql(f"SELECT count(*) FROM ofc_trip_settlements WHERE trip_id = {int(tr1 or 0)}")
        ok(f'② 반려 뒤 — 청구 반려 · 품의 넘는 금액 422(허용 {tol}%) · 다시 정산 = 새 청구 · 출장이 새 청구를 가리킴 · 정산 줄 2',
           rj.get('_err') is None and over.get('_err') == 422 and over.get('code') == 'OFC_TRIP_OVER' and s2.get('ok') is True and c2 and c2 != c1 and tst2 == c2 and nset == '2',
           f"{rj.get('_err')} {over.get('code')} {s2.get('ok')} {c1}→{c2} {tst2} {nset}")
        sp = call('PUT', '/admin/office/trip-standards', {'perDiem': per, 'reason': '시험 1464'}, TT)
        n2 = call('POST', '/admin/office/trips', {'destination': f'{tag} 제주', 'region': 'OTHER', 'purpose': '취소 시험', 'departOn': day(10), 'returnOn': day(12)}, TT)
        tr2, rq2 = str(n2.get('id') or ''), str(n2.get('requisitionId') or '')
        if tr2: trips.append(tr2)
        if rq2: reqs.append(rq2)
        cn = call('POST', f'/admin/office/trips/{tr2}/cancel', {'reason': '시험 1464 취소'}, TT)
        st2 = psql(f"SELECT t.state || '|' || r.state FROM ofc_trips t JOIN acct_requisitions r ON r.id = t.requisition_id WHERE t.id = {int(tr2 or 0)}")
        cn2 = call('POST', f'/admin/office/trips/{tr2}/cancel', {'reason': '시험 1464 취소'}, TT)
        ok('② 기준 · 취소 — 기준 고치기는 SUPER 만(403) · 출장 취소 = 품의 취소 · 다시 취소 409',
           sp.get('_err') == 403 and n2.get('ok') is True and cn.get('ok') is True and st2 == 'CANCELED|CANCELED' and cn2.get('_err') == 409,
           f"{sp.get('_err')} {n2.get('ok')} {cn.get('ok')} {st2} {cn2.get('_err')}")
    finally:
        ts_, rs_, cs_ = ','.join(trips) or '0', ','.join(reqs) or '0', ','.join(claims) or '0'
        psql(f"SET session_replication_role = replica; DELETE FROM ofc_trip_settlements WHERE trip_id IN ({ts_}); DELETE FROM ofc_trips WHERE id IN ({ts_}); "
             f"DELETE FROM acct_entries WHERE source IN ('EXPENSE_APPROVED', 'EXPENSE_PAID') AND source_key IN (SELECT id::text FROM acct_expense_claims WHERE id IN ({cs_})); "
             f"DELETE FROM acct_approval_steps WHERE (doc_kind = 'EXPENSE' AND doc_id IN ({cs_})) OR (doc_kind = 'REQ' AND doc_id IN ({rs_})); "
             f"DELETE FROM acct_expense_claims WHERE id IN ({cs_}); DELETE FROM acct_requisitions WHERE id IN ({rs_}); "
             f"DELETE FROM ofc_trips WHERE destination LIKE '시험1464-%';")
        rm_role(tid_, '1464')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['new'] = pg.locator('[data-ofc-trip-new]').count()
        seen['std'] = pg.locator('[data-ofc-trip-std]').count()
        seen['edit'] = pg.locator('[data-ofc-trip-std-edit]').count()
    r = admin_page('/#/ofc-trips', chk)
    if r:
        seen, perr = r
        ok('③ 화면 — 사무 › 출장 신청 상자 · 여비 기준 줄 · SUPER 기준 고치기 단추 · 화면 오류 없음', seen.get('new') == 1 and seen.get('std') == 1 and seen.get('edit') == 1 and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
