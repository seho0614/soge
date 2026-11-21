"""v10.568 (docs/710) 직원 입사 · 퇴사 흐름 — 직원 대장 · 계정 초대 · 연결 · 역할 · 근로계약서 · 의무교육 / 퇴사일 · 권한 거두기 · 장비 반납 · 퇴직금 · 서류 보관
  ① (코드) 재사용 함수 · API 9 · 메뉴 · 그리기 · 알림 이름 · SQL · 화면 목록 · 문서 710 · 판
  ② (DB · API) 입사 열기 · 두 번 · ADMIN 403 · 단계 · 초대 · 손으로 됨 · 건너뜀 검사 · 역할 주기로 연결 · 끝내기 · 퇴사 열기 · STAFF_LEFT_ROLE · 권한 거두기 · 자산 · 서류 · 되돌리기 · 취소 · DB 지우기 막음
  ③ (화면) 직원 · 권한 › 입사 · 퇴사
  (두 번 돌아도 통과 — 시험 계정 · 직원은 실행마다 새로 · 흐름 · 단계 · 자산 · 알림 · 직원은 끝에 replica 로 지움 · 역할 기록 · 권한 변경 기록(쌓기만)은 남음)
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


def mig_with(word):
    """마이그레이션 번호는 메인이 정하므로 글자로 찾음"""
    d = os.path.join(K, 'prisma', 'migrations')
    for x in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


CS, RC, MENU, APP, OA, MG = (rd('src/modules/admin/prr-cases.ts'), rd('src/modules/admin/prr.controller.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'),
                             rd('web/src/app/admin/OpsAlerts.tsx'), mig_with('CREATE TABLE IF NOT EXISTS public.prr_cases'))
SCR = rd('web/src/app/admin/PrrStaff.tsx')
ok('① 코드 — 직원 넣기 · 퇴사일 · 역할 거두기 · 의무교육 · 퇴직금 추계 재사용 · IT 자산 · 근로계약서 · API 9 · 메뉴 · 그리기 · 알림 이름 · SQL(표 2 · 트리거 2 · 설정 4 · 업무 · 주소 9) · 화면 목록 · 문서 710 · 판',
   all(k in CS for k in ('addEmployee(db', 'updateEmployee(db', 'revokeAll(db', 'myTraining(db', 'severanceEstimate(db', 'FROM its_assets', 'FROM hr_contracts', "'STAFF_CASE_OPEN'", "'STAFF_LEAVE_OVERDUE'"))
   and all(k in RC for k in ("@Get('cases')", "@Get('cases/:id')", "@Post('cases')", "@Post('cases/:id/invite')", "@Put('cases/:id/steps/:step')", "@Delete('cases/:id/steps/:step')",
                             "@Post('cases/:id/revoke')", "@Post('cases/:id/close')", "@Post('cases/:id/cancel')"))
   and "['staff-cases', '입사 · 퇴사']" in MENU and "'SB-ADM-PRR-020'" in MENU and '<StaffCases />' in APP and 'STAFF_CASE_OPEN:' in OA and 'export function StaffCases' in SCR
   and all(k in MG for k in ('trg_prr_case_guard', 'trg_prr_case_step_guard', "'prr.join_days'", "'prr.leave_grace'", "'prr.keep_labor_years'", "'prr.keep_tax_years'",
                             "('staff-cases', '입사 · 퇴사', 'acl'", "('POST', '/admin/staff/cases/{id}/close', 'staff-cases', 'EDIT')"))
   and '"SB-ADM-PRR-020"' in SJ and '입사' in doc('710_') and VT >= (10, 568), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    EMP, EMP2 = f'시험1568_{stamp}', f'시험1568c_{stamp}'
    ea, aa = mk_staff(f'1568a{stamp % 97}', 'ADMIN')     # ADMIN 보기만
    en_, an = mk_staff(f'1568n{stamp % 89}', None)       # 새 직원이 가입한 계정
    TAG = f'T1568-{stamp}'
    cases = []
    try:
        consent_ok.agree(ea, PW)
        TA = login(ea)
        # ── 입사 ──
        o1 = call('POST', '/admin/staff/cases', {'kind': 'JOIN', 'name': EMP, 'joinedOn': psql("SELECT to_char(current_date - 1, 'YYYY-MM-DD')"), 'monthlyBase': 0}, TS)
        cid, emp = o1.get('id'), o1.get('employeeId')
        cases.append(cid)
        o2 = call('POST', '/admin/staff/cases', {'kind': 'JOIN', 'employeeId': emp}, TS)
        oa = call('POST', '/admin/staff/cases', {'kind': 'JOIN', 'employeeId': emp}, TA)
        ol = call('POST', '/admin/staff/cases', {'kind': 'LEAVE'}, TS)
        al1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_CASE_OPEN' AND resolved_at IS NULL AND detail->>'caseId' = '{cid}'")
        ok('② 입사 흐름 열기 — 새 직원 넣고 열림 · 운영 알림 STAFF_CASE_OPEN(열림) · 같은 직원 두 번 409 PRR_CASE_OPEN · ADMIN 403 · 퇴사 직원 없음 422 PRR_EMPLOYEE',
           o1.get('ok') is True and emp and o2.get('code') == 'PRR_CASE_OPEN' and oa.get('_err') == 403 and ol.get('code') == 'PRR_EMPLOYEE' and al1 == '1',
           f"{o1} · {o2.get('code')} {oa.get('_err')} {ol.get('code')} · {al1}")
        g1 = call('GET', f'/admin/staff/cases/{cid}', None, TA)
        st = {s['key']: s['state'] for s in (g1.get('steps') or [])}
        ok('② 흐름 보기(ADMIN) — 입사 단계 6 · 직원 대장 됨 · 초대 · 계정 · 근로계약서 남음 · 고치기 못함',
           list(st) == ['EMPLOYEE', 'INVITE', 'ACCOUNT', 'ROLE_GROUP', 'CONTRACT', 'TRAINING'] and st['EMPLOYEE'] == 'DONE' and st['INVITE'] == 'TODO'
           and st['ACCOUNT'] == 'TODO' and st['CONTRACT'] == 'TODO' and g1.get('canEdit') is False, str(st))
        iv0 = call('POST', f'/admin/staff/cases/{cid}/invite', {'email': 'not-mail'}, TS)
        iv = call('POST', f'/admin/staff/cases/{cid}/invite', {'email': en_}, TS)
        cl0 = call('POST', f'/admin/staff/cases/{cid}/close', {}, TS)
        s1 = call('PUT', f'/admin/staff/cases/{cid}/steps/CONTRACT', {'action': 'DONE'}, TS)
        s2 = call('PUT', f'/admin/staff/cases/{cid}/steps/EMPLOYEE', {'action': 'SKIP', 'note': '시험'}, TS)
        s3 = call('PUT', f'/admin/staff/cases/{cid}/steps/CONTRACT', {'action': 'SKIP'}, TS)
        s4 = call('PUT', f'/admin/staff/cases/{cid}/steps/ROLES', {'action': 'SKIP', 'note': '시험'}, TS)
        ok('② 초대 — 메일 모양 400 · 가입한 계정 찾음 · 안내문 · 남은 단계로 끝내기 409 PRR_STEPS_LEFT · 저절로 단계 「됨」 422 PRR_STEP_AUTO · 직원 대장 422 PRR_STEP_CORE · 사유 없는 건너뜀 422 PRR_NOTE · 다른 흐름 단계 422 PRR_STEP',
           iv0.get('_err') == 400 and iv.get('accountFound') is True and '가입' in str(iv.get('guide') or '') and cl0.get('code') == 'PRR_STEPS_LEFT'
           and s1.get('code') == 'PRR_STEP_AUTO' and s2.get('code') == 'PRR_STEP_CORE' and s3.get('code') == 'PRR_NOTE' and s4.get('code') == 'PRR_STEP',
           f"{iv0.get('_err')} {iv.get('accountFound')} {cl0.get('code')} {s1.get('code')} {s2.get('code')} {s3.get('code')} {s4.get('code')}")
        gr = call('POST', '/admin/reports/roles', {'accountId': an, 'role': 'REVIEWER', 'grant': True, 'reason': f'시험 1568 입사 {stamp}', 'employeeId': emp}, TS)
        g2 = call('GET', f'/admin/staff/cases/{cid}', None, TS)
        st2 = {s['key']: s['state'] for s in (g2.get('steps') or [])}
        for k in ('CONTRACT', 'TRAINING', 'ROLE_GROUP'):
            if st2.get(k) == 'TODO':
                call('PUT', f'/admin/staff/cases/{cid}/steps/{k}', {'action': 'SKIP', 'note': '시험 1568 건너뜀'}, TS)
        cl = call('POST', f'/admin/staff/cases/{cid}/close', {'note': '시험 끝'}, TS)
        cl2 = call('POST', f'/admin/staff/cases/{cid}/close', {}, TS)
        s5 = call('PUT', f'/admin/staff/cases/{cid}/steps/CONTRACT', {'action': 'SKIP', 'note': '닫힌 뒤'}, TS)
        tail = psql(f"SELECT state || '|' || (invite_email IS NULL) FROM prr_cases WHERE id = {int(cid or 0)}")
        al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_CASE_OPEN' AND resolved_at IS NULL AND detail->>'caseId' = '{cid}'")
        ok('② 역할 주기(직원 고르기)로 계정 연결 · 역할 · 권한그룹 저절로 됨 · 끝내기 DONE · 초대 메일 지움 · 알림 풀림 · 두 번 · 닫힌 뒤 단계 409 PRR_CASE_CLOSED',
           gr.get('granted') is True and st2.get('ACCOUNT') == 'DONE' and st2.get('INVITE') == 'DONE' and st2.get('ROLE_GROUP') == 'DONE'
           and cl.get('state') == 'DONE' and cl2.get('code') == 'PRR_CASE_CLOSED' and s5.get('code') == 'PRR_CASE_CLOSED' and tail in ('DONE|t', 'DONE|true') and al2 == '0',
           f"{gr.get('granted')} {st2} · {cl.get('state') or cl} {cl2.get('code')} {s5.get('code')} · {tail} {al2}")
        # ── 퇴사 ──
        lo = psql("SELECT to_char(current_date, 'YYYY-MM-DD')")
        p1 = call('POST', '/admin/staff/cases', {'kind': 'LEAVE', 'employeeId': emp, 'leftOn': '2000-01-01'}, TS)
        p2 = call('POST', '/admin/staff/cases', {'kind': 'LEAVE', 'employeeId': emp, 'leftOn': lo}, TS)
        lid = p2.get('id'); cases.append(lid)
        lal = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LEFT_ROLE' AND resolved_at IS NULL AND detail->>'accountId' = '{an}'")
        psql(f"INSERT INTO its_assets (kind, name, asset_tag, owner_id, billing_cycle, cost_amount, cash_plan) VALUES ('DEVICE', '시험1568 노트북', '{TAG}', '{an}', 'FREE', 0, false)")
        h1 = call('GET', f'/admin/staff/cases/{lid}', None, TS)
        hs = {s['key']: s for s in (h1.get('steps') or [])}
        docs = (hs.get('DOCS', {}).get('data') or {}).get('docs') or []
        ok('② 퇴사 흐름 열기 — 입사일 앞 퇴사일 422 PRR_LEFT_ON · 열림 · 역할 남아 STAFF_LEFT_ROLE · 단계 5 · 권한 · 장비(자산 목록) 남음 · 1년 미만 퇴직금 저절로 됨 · 서류 5종(3년 · 5년)',
           p1.get('code') == 'PRR_LEFT_ON' and p2.get('ok') is True and lal == '1' and list(hs) == ['LEFT_ON', 'ROLES', 'ASSETS', 'SEVERANCE', 'DOCS']
           and hs['ROLES']['state'] == 'TODO' and hs['ASSETS']['state'] == 'TODO' and any(x.get('assetTag') == TAG for x in (hs['ASSETS'].get('data') or {}).get('assets') or [])
           and hs['SEVERANCE']['state'] == 'DONE' and len(docs) == 5 and {d.get('years') for d in docs} == {3, 5}, f"{p1.get('code')} {lal} {[(k, v['state']) for k, v in hs.items()]} {docs[:1]}")
        rv = call('POST', f'/admin/staff/cases/{lid}/revoke', {'reason': f'시험 1568 퇴사 {stamp}'}, TS)
        rv2 = call('POST', f'/admin/staff/cases/{lid}/revoke', {'reason': '시험 1568 두 번'}, TS)
        left = psql(f"SELECT (SELECT count(*) FROM account_roles WHERE account_id = '{an}' AND role <> 'MEMBER') + (SELECT count(*) FROM perm_account_groups WHERE account_id = '{an}')")
        lal2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LEFT_ROLE' AND resolved_at IS NULL AND detail->>'accountId' = '{an}'")
        psql(f"UPDATE its_assets SET state = 'CANCELED', canceled_on = current_date, cancel_reason = '시험 1568 반납' WHERE asset_tag = '{TAG}'")
        d1 = call('PUT', f'/admin/staff/cases/{lid}/steps/DOCS', {'action': 'DONE', 'note': '시험 보관 확인'}, TS)
        u1 = call('DELETE', f'/admin/staff/cases/{lid}/steps/DOCS', None, TS)
        u2 = call('DELETE', f'/admin/staff/cases/{lid}/steps/DOCS', None, TS)
        call('PUT', f'/admin/staff/cases/{lid}/steps/DOCS', {'action': 'DONE'}, TS)
        h2 = call('GET', f'/admin/staff/cases/{lid}', None, TS)
        hs2 = {s['key']: s['state'] for s in (h2.get('steps') or [])}
        lc = call('POST', f'/admin/staff/cases/{lid}/close', {}, TS)
        ok('② 권한 모두 거두기(역할 · 권한그룹 0 · STAFF_LEFT_ROLE 풀림 · 두 번 409 NO_SUCH_ROLE) · 자산 해지 → 장비 됨 · 서류 손으로 됨 · 되돌리기 · 없는 것 404 · 끝내기',
           (rv.get('revoked') or []) == ['REVIEWER'] and rv2.get('code') == 'NO_SUCH_ROLE' and left == '0' and lal2 == '0' and d1.get('state') == 'DONE'
           and u1.get('state') == 'TODO' and u2.get('_err') == 404 and all(v == 'DONE' for v in hs2.values()) and h2.get('canClose') is True and lc.get('state') == 'DONE',
           f"{rv} {rv2.get('code')} {left} {lal2} · {d1.get('state')} {u1.get('state')} {u2.get('_err')} · {hs2} {lc.get('state') or lc}")
        # ── 취소 ──
        c1 = call('POST', '/admin/staff/cases', {'kind': 'JOIN', 'name': EMP2, 'joinedOn': psql("SELECT to_char(current_date, 'YYYY-MM-DD')")}, TS)
        cases.append(c1.get('id'))
        cc0 = call('POST', f"/admin/staff/cases/{c1.get('id')}/cancel", {'reason': ''}, TS)
        cc = call('POST', f"/admin/staff/cases/{c1.get('id')}/cancel", {'reason': '시험 1568 취소'}, TS)
        cal = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_CASE_OPEN' AND resolved_at IS NULL AND detail->>'caseId' = '{c1.get('id')}'")
        dl = psql(f"BEGIN; DELETE FROM prr_cases WHERE id = {int(c1.get('id') or 0)}; COMMIT;")
        lst = call('GET', '/admin/staff/cases', None, TA)
        ok('② 취소 — 사유 없음 400 · CANCELED · 알림 풀림 · 흐름은 DB 가 못 지움(PRR_CASE_KEEP) · 목록(ADMIN · 직원 고르기 목록 없음) · 정기 작업 prr_daily',
           cc0.get('_err') == 400 and cc.get('state') == 'CANCELED' and cal == '0' and 'PRR_CASE_KEEP' in dl and isinstance(lst.get('items'), list)
           and lst.get('employees') == [] and psql("SELECT count(*) FROM job_schedules WHERE job = 'prr_daily'") == '1', f"{cc0.get('_err')} {cc.get('state')} {cal} {dl[-60:]} {lst.get('employees')}")
    finally:
        rm_role(aa, '1568'); rm_role(an, '1568')
        ids = ",".join(str(int(x)) for x in cases if x) or '0'
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"DELETE FROM prr_case_steps WHERE case_id IN ({ids}); "
             f"DELETE FROM ops_alerts WHERE alert_code IN ('STAFF_CASE_OPEN', 'STAFF_JOIN_OVERDUE', 'STAFF_LEAVE_OVERDUE') AND detail->>'caseId' IN (SELECT id::text FROM prr_cases WHERE id IN ({ids})); "
             f"DELETE FROM ops_alerts WHERE alert_code = 'STAFF_LEFT_ROLE' AND detail->>'accountId' = '{an}'; "
             f"DELETE FROM prr_cases WHERE id IN ({ids}) OR employee_id IN (SELECT id FROM acct_employees WHERE name IN ('{EMP}', '{EMP2}')); "
             f"DELETE FROM its_assets WHERE asset_tag = '{TAG}'; DELETE FROM perm_account_groups WHERE account_id IN ('{aa}', '{an}'); "
             f"DELETE FROM acct_employees WHERE name IN ('{EMP}', '{EMP2}'); COMMIT;")
    ok('끝 — 시험 흐름 · 단계 · 직원 · 자산 · 알림 없음',
       psql(f"SELECT (SELECT count(*) FROM acct_employees WHERE name IN ('{EMP}', '{EMP2}')) + (SELECT count(*) FROM its_assets WHERE asset_tag = '{TAG}') "
            f"+ (SELECT count(*) FROM prr_cases WHERE id IN ({ids})) + (SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LEFT_ROLE' AND detail->>'accountId' = '{an}')") == '0', '')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        pg.wait_for_selector('[data-staff-cases]', timeout=30000)
        seen['box'] = pg.locator('[data-staff-cases]').count()
        seen['new'] = pg.locator('[data-staff-case-new]').count()
        seen['open'] = pg.locator('[data-staff-case-open]').count()
    r = admin_page('/#/staff-cases', chk)
    if r is None:
        print('  (playwright 없음 — ③ 건너뜀)')
    else:
        seen, perr = r
        ok('③ 화면 — 직원 · 권한 › 입사 · 퇴사 목록 · 흐름 열기 칸(SUPER) · 화면 오류 없음', seen.get('box') == 1 and seen.get('new') == 1 and seen.get('open') == 1 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (ADMIN_WEB 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
sys.exit(0 if passed == len(RES) else 1)
