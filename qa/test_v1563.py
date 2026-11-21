"""v10.563 (D291 · docs/705) 사원 권한 = 권한그룹 + 회원 · 직원 분리 A안(회원 목록 · 정지 · 일괄 · 캠페인 · 역할 주기 직원 연결 · 퇴사 알림)
  ① (코드) 회원 상세 보기만 · 회원 목록 staff 거르기 · 운영자 정지 SUPER 만 · 캠페인 · 문자 대상 운영자 빼기 · 역할 주기 직원 연결 · D291 퇴사 트리거 · 알림 이름 · 사원 권한 화면 · 문서 705
  ② (API · DB) 회원 목록 기본 회원만 · include · only / 운영자 정지 ADMIN 403 STAFF_TARGET_SUPER_ONLY(일괄도) · SUPER 됨 /
     역할 주기 — 안쪽 역할 직원 없음 422 · 외부 역할 기한 없음 422 · 기한 있으면 됨 · 직원 고르면 연결되고 됨 / 퇴사 → STAFF_LEFT_ROLE · 남은 역할 · 모두 거두기 → 풀림 / 사원 권한 목록
  ③ (화면) 회원 목록 「운영자 포함」 · 사원 권한 표
  (두 번 돌아도 통과 — 시험 직원 · 알림은 끝에 replica 로 지움 · 시험 계정 역할은 뺌)
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


MR, MB, AS, CP, SM, RS, MG, OA, UI = (rd('web/src/app/admin/MemberRoles.tsx'), rd('web/src/app/admin/Members.tsx'), rd('src/modules/admin/admin-member.service.ts'), rd('src/modules/marketing/campaign.ts'),
                                      rd('src/modules/mkx/sms.ts'), rd('src/modules/site/report.service.ts'), rd('prisma/migrations/D291_staff_perm_groups_mode/migration.sql'), rd('web/src/app/admin/OpsAlerts.tsx'), rd('web/src/app/admin/StaffPerm.tsx'))
ok('① 코드 — 보기만(data-member-roles="view" · 역할 주기 링크) · 운영자 포함 거르기 · STAFF_TARGET_SUPER_ONLY · 캠페인 · 문자 운영자 빼기 · assertStaffGrant · 퇴사 트리거 · 알림 이름 · 사원 권한 · 문서 705 · 판 v10.563',
   'data-member-roles="view"' in MR and "'/admin/reports/roles'" not in MR and 'href="#/roles"' in MR and "'&staff=include'" in MB
   and "'STAFF_TARGET_SUPER_ONLY'" in AS and "$4::text = 'include'" in AS and CP.count("NOT EXISTS (SELECT 1 FROM account_roles xr WHERE xr.account_id = a.id") == 1 and 'NOT EXISTS (SELECT 1 FROM account_roles xr' in SM
   and 'await assertStaffGrant(this.db, accountId, role' in RS and 'trg_staff_left_role' in MG and "STAFF_LEFT_ROLE: '퇴사 직원 계정에 운영 역할 남음'" in OA
   and 'export function PermStaff' in UI and '"SB-ADM-STF-020"' in SJ and '직원 대장' in doc('705_') and VT >= (10, 563), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    EMP = f'시험1563_{stamp}'
    er, ar = mk_staff(f'1563r{stamp % 97}', 'REVIEWER')
    ea, aa = mk_staff(f'1563a{stamp % 89}', 'ADMIN')
    eg, ag = mk_staff(f'1563g{stamp % 83}', None)
    try:
        consent_ok.agree(ea, PW)
        TA = login(ea)
        # 회원 목록 거르기
        l0 = call('GET', f'/admin/accounts?q={urllib.parse.quote(er)}', None, TS)
        l1 = call('GET', f'/admin/accounts?q={urllib.parse.quote(er)}&staff=include', None, TS)
        l2 = call('GET', '/admin/accounts?limit=100&staff=only', None, TS)
        lg = call('GET', f'/admin/accounts?q={urllib.parse.quote(eg)}', None, TS)
        ok('② 회원 목록 — 운영자는 기본 빠짐 · include 면 보임(isStaff) · only 는 운영자만 · 회원은 기본에 보임',
           isinstance(l0, list) and len(l0) == 0 and len(l1) == 1 and l1[0].get('isStaff') is True
           and isinstance(l2, list) and all(x.get('isStaff') for x in l2) and len(lg) == 1 and lg[0].get('isStaff') is False, f'{l0} · {l1} · {len(l2) if isinstance(l2, list) else l2} · {lg}')
        # 운영자 정지는 SUPER 만
        s1 = call('PATCH', f'/admin/accounts/{ar}/status', {'status': 'SUSPENDED', 'reason': '시험 1563 ADMIN'}, TA)
        b1 = call('POST', '/admin/opx/bulk/members', {'ids': [ar], 'action': 'SUSPEND', 'reason': f'시험 1563 일괄 {stamp}'}, TA)
        bf = next((x for x in (b1.get('results') or []) if x.get('id') == ar), {})
        s2 = call('PATCH', f'/admin/accounts/{ar}/status', {'status': 'SUSPENDED', 'reason': '시험 1563 SUPER'}, TS)
        s3 = call('PATCH', f'/admin/accounts/{ar}/status', {'status': 'ACTIVE', 'reason': '시험 1563 되돌림'}, TS)
        ok('② 운영자 정지 — ADMIN 403 STAFF_TARGET_SUPER_ONLY · 일괄 줄 실패(같은 코드) · SUPER 정지 · 되돌림',
           s1.get('_err') == 403 and s1.get('code') == 'STAFF_TARGET_SUPER_ONLY' and bf.get('ok') is False and bf.get('code') == 'STAFF_TARGET_SUPER_ONLY'
           and s2.get('status') == 'SUSPENDED' and s3.get('status') == 'ACTIVE', f"{s1.get('_err')} {s1.get('code')} · {bf} · {s2.get('status') or s2} {s3.get('status') or s3}")
        # 역할 주기 — 직원 대장
        g1 = call('POST', '/admin/reports/roles', {'accountId': ag, 'role': 'REVIEWER', 'grant': True, 'reason': '시험 1563 직원 없음'}, TS)
        g2 = call('POST', '/admin/reports/roles', {'accountId': ag, 'role': 'PARTNER_MAL', 'grant': True, 'reason': '시험 1563 외부 기한 없음'}, TS)
        g3 = call('POST', '/admin/reports/roles', {'accountId': ag, 'role': 'PARTNER_MAL', 'grant': True, 'reason': '시험 1563 외부 7일', 'expiresDays': 7}, TS)
        emp = (psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base) VALUES ('{EMP}', current_date - 30, 0) RETURNING id") or '0').splitlines()[0]
        g4 = call('POST', '/admin/reports/roles', {'accountId': ag, 'role': 'REVIEWER', 'grant': True, 'reason': '시험 1563 직원 연결', 'employeeId': emp}, TS)
        link = psql(f"SELECT account_id FROM acct_employees WHERE id = {int(emp or 0)}")
        ok('② 역할 주기 — 안쪽 역할 직원 없음 422 STAFF_EMPLOYEE_REQUIRED · 외부 역할 기한 없음 422 STAFF_EXTERNAL_EXPIRY · 기한 7일 됨 · 직원 고르면 그 자리에서 연결 · 됨',
           g1.get('code') == 'STAFF_EMPLOYEE_REQUIRED' and g2.get('code') == 'STAFF_EXTERNAL_EXPIRY' and g3.get('granted') is True
           and g4.get('granted') is True and g4.get('employeeId') == emp and link == ag, f"{g1.get('code')} {g2.get('code')} {g3.get('granted')} · {g4} · {link}")
        # 퇴사 → 알림 · 거두기
        psql(f"UPDATE acct_employees SET left_on = current_date - 1 WHERE id = {int(emp or 0)}")
        al = psql(f"SELECT severity || '|' || (resolved_at IS NULL) FROM ops_alerts WHERE alert_code = 'STAFF_LEFT_ROLE' AND detail->>'accountId' = '{ag}' ORDER BY id DESC LIMIT 1")
        st = call('GET', '/admin/staff', None, TS)
        row = next((x for x in (st.get('items') or []) if x.get('id') == ag), {})
        er1 = call('GET', f'/admin/staff/employees/{emp}/roles', None, TS)
        er2 = call('GET', f'/admin/staff/employees/{emp}/roles', None, TA)
        rv = call('POST', f'/admin/staff/{ag}/revoke-all', {'reason': '시험 1563 퇴사'}, TS)
        al2 = psql(f"SELECT (resolved_at IS NOT NULL) FROM ops_alerts WHERE alert_code = 'STAFF_LEFT_ROLE' AND detail->>'accountId' = '{ag}' ORDER BY id DESC LIMIT 1")
        left = psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{ag}' AND role <> 'MEMBER'")
        why = psql(f"SELECT reason FROM role_changes WHERE account_id = '{ag}' AND action = 'REVOKE' ORDER BY id DESC LIMIT 1")
        rv2 = call('POST', f'/admin/staff/{ag}/revoke-all', {'reason': '시험 1563 두 번'}, TS)
        ok('② 퇴사 — STAFF_LEFT_ROLE(WARN · 열림) · 운영자 목록 「퇴사 · 역할 남음」 · 남은 역할(SUPER 만 · ADMIN 403) · 모두 거두기 → 역할 0 · 기록 사유 · 알림 풀림 · 두 번 409',
           al.startswith('WARN|t') and row.get('leftWithRole') is True and sorted(er1.get('roles') or []) == ['PARTNER_MAL', 'REVIEWER'] and er2.get('_err') == 403
           and sorted(rv.get('revoked') or []) == ['PARTNER_MAL', 'REVIEWER'] and left == '0' and why == '시험 1563 퇴사' and al2 in ('t', 'true') and rv2.get('code') == 'NO_SUCH_ROLE',
           f"{al} · {row.get('leftWithRole')} · {er1.get('roles')} {er2.get('_err')} · {rv} · {left} {why} {al2} · {rv2.get('code')}")
        ps = call('GET', '/admin/perm/staff', None, TS)
        pr = next((x for x in (ps.get('items') or []) if x.get('id') == ar), {})
        ok('② 사원 권한 목록 — 시험 검수 담당 줄 · 처음 권한그룹 R_REVIEWER · 실제 업무 ≥ 1 · 조합 어긋남 없음',
           any(g.get('key') == 'R_REVIEWER' for g in (pr.get('groups') or [])) and (pr.get('tasks') or 0) >= 1 and pr.get('conflicts') == [], str(pr)[:200])
    finally:
        rm_role(ar, '1563'); rm_role(aa, '1563'); rm_role(ag, '1563')
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'STAFF_LEFT_ROLE' AND detail->>'accountId' = '{ag}'; DELETE FROM acct_employees WHERE name = '{EMP}'; COMMIT;")
    ok('끝 — 시험 직원 · 알림 없음', psql(f"SELECT (SELECT count(*) FROM acct_employees WHERE name = '{EMP}') + (SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_LEFT_ROLE' AND detail->>'accountId' = '{ag}')") == '0', '')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        pg.wait_for_selector('[data-member-list], [data-member-staff-filter]', timeout=30000)
        seen['filter'] = pg.locator('[data-member-staff-filter]').count()
        pg.goto(ADMIN_WEB + '/#/perm-staff', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
        seen['perm'] = pg.locator('[data-perm-staff]').count()
    r = admin_page('/#/members', chk)
    if r is None:
        print('  (playwright 없음 — ③ 건너뜀)')
    else:
        seen, perr = r
        ok('③ 화면 — 회원 목록 「운영자 포함」 · 직원 · 권한 › 사원 권한 표 · 화면 오류 없음', seen.get('filter') == 1 and seen.get('perm') == 1 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (ADMIN_WEB 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
sys.exit(0 if passed == len(RES) else 1)
