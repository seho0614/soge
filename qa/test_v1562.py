"""v10.562 (D291 · docs/704) 업무 목록 → 업무그룹 → 권한그룹(업무그룹 × 수준) · 함께 못 갖는 조합
  ① (코드) perm-sets(업무 · 업무그룹 여럿 · 세트 · 더하기/빼기 · 조합) · 컨트롤러(SUPER · @ApiOkResponse) · D291 표 · fn_perm_group_expand · fn_perm_effective 새 판 · 화면 3탭 · 문서 704
  ② (API · DB) 업무 목록(주소 수) · 업무그룹 만들기(업무 하나가 두 그룹에) · 권한그룹 세트 펼침(빼기 반영) · 사원에게 붙이면 실제 권한 · 조합 422(권한그룹 · 사원) · 되돌림 · ADMIN 403
  ③ (화면) 직원 · 권한 › 권한그룹 · 업무그룹 · 업무 목록
  (두 번 돌아도 통과 — 시험 업무그룹 · 권한그룹 · 붙임은 끝에 replica 로 지움 · 바꾼 기록(쌓기만)은 남음)
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


PS, PC, MG, UI = rd('src/modules/admin/perm-sets.ts'), rd('src/modules/admin/perm-sets.controller.ts'), rd('prisma/migrations/D291_staff_perm_groups_mode/migration.sql'), rd('web/src/app/admin/StaffPerm.tsx')
ok('① 코드 — 업무그룹 여럿 · 세트 · 더하기/빼기 · 조합 422 · SUPER 컨트롤러 · D291 표 4 · 펼침 함수 · 실제 권한 새 판 · 처음 조합 3줄 · 화면 · 문서 704 · 판 v10.562',
   'export async function saveRoleGroupSets' in PS and "'PERM_CONFLICT'" in PS and 'perm_task_group_items' in PS and "@Controller('api/v1/admin/perm')" in PC and "@Roles('SUPER')" in PC
   and all(f'CREATE TABLE IF NOT EXISTS public.{t}' in MG for t in ('perm_task_group_items', 'perm_role_group_sets', 'perm_conflict_rules', 'perm_conflict_items'))
   and 'CREATE OR REPLACE FUNCTION public.fn_perm_group_expand' in MG and 'CROSS JOIN LATERAL public.fn_perm_group_expand(g.group_key)' in MG
   and "('C710_APPROVE_PAY'" in MG and 'export function PermRoles' in UI and 'export function PermGroups' in UI and 'export function PermTasks' in UI
   and '업무그룹' in doc('704_') and VT >= (10, 562), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    TG, RG, RGC = f't1562_{stamp}', f'T1562_{stamp}', f'T1562C_{stamp}'
    ea, aa = mk_staff(f'1562a{stamp % 97}', 'ADMIN')
    ep, ap = mk_staff(f'1562p{stamp % 89}', None)
    def clean():
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"DELETE FROM perm_account_groups WHERE group_key IN ('{RG}', '{RGC}'); DELETE FROM perm_account_overrides WHERE account_id IN ('{ap}', '{aa}'); "
             f"DELETE FROM perm_role_group_sets WHERE group_key IN ('{RG}', '{RGC}'); DELETE FROM perm_role_group_items WHERE group_key IN ('{RG}', '{RGC}'); "
             f"DELETE FROM perm_role_groups WHERE key IN ('{RG}', '{RGC}'); DELETE FROM perm_task_group_items WHERE group_key = '{TG}'; DELETE FROM perm_task_groups WHERE key = '{TG}'; COMMIT;")
    try:
        consent_ok.agree(ea, PW)
        TA = login(ea)
        t1 = call('GET', '/admin/perm/tasks', None, TS)
        sl = next((x for x in (t1.get('items') or []) if x.get('key') == 'staff-list'), {})
        g1 = call('PUT', f'/admin/perm/task-groups/{TG}', {'name': '시험 1562 묶음', 'tasks': ['home', 'reports', 'queue'], 'reason': '시험 1562'}, TS)
        t2 = call('GET', '/admin/perm/tasks', None, TS)
        home = next((x for x in (t2.get('items') or []) if x.get('key') == 'home'), {})
        r1 = call('PUT', f'/admin/perm/role-groups/{RG}/sets', {'name': '시험 1562', 'sets': [{'taskGroupKey': TG, 'level': 'VIEW'}, {'taskGroupKey': TG, 'level': 'EDIT'}],
                                                              'items': [{'taskKey': 'reports', 'level': 'EDIT', 'effect': 'DENY'}, {'taskKey': 'audit', 'level': 'VIEW', 'effect': 'ALLOW'}], 'reason': '시험 1562'}, TS)
        v1 = call('GET', f'/admin/perm/role-groups/{RG}/sets', None, TS)
        pv = v1.get('preview') or {}
        a1 = call('PUT', f'/admin/perm/accounts/{ap}', {'groups': [{'key': RG}], 'reason': '시험 1562 붙임'}, TS)
        eff = psql(f"SELECT string_agg(task_key || ':' || level, ',' ORDER BY task_key, level) FROM fn_perm_effective('{ap}') WHERE task_key IN ('home', 'reports', 'queue', 'audit')")
        c1 = call('PUT', f'/admin/perm/role-groups/{RGC}/sets', {'name': '시험 1562 충돌', 'sets': [], 'items': [{'taskKey': 'settlement', 'level': 'APPROVE'}, {'taskKey': 'fin-transfer', 'level': 'EDIT'}], 'reason': '시험 1562 충돌'}, TS)
        c1n = psql(f"SELECT count(*) FROM perm_role_groups WHERE key = '{RGC}'")
        c2 = call('PUT', f'/admin/perm/accounts/{ap}', {'groups': [{'key': RG}], 'overrides': [{'taskKey': 'settlement', 'level': 'APPROVE', 'effect': 'ALLOW'}, {'taskKey': 'fin-transfer', 'level': 'EDIT', 'effect': 'ALLOW'}], 'reason': '시험 1562 충돌'}, TS)
        c2n = psql(f"SELECT count(*) FROM perm_account_overrides WHERE account_id = '{ap}'")
        cf = call('GET', '/admin/perm/conflicts', None, TS)
        adm = call('GET', '/admin/perm/tasks', None, TA)
        ok('② 업무 목록 staff-list 주소 ≥ 1 · 업무그룹 만들기 · home 이 두 업무그룹에 · 세트 펼침(home · queue 보기 · 고치기 · reports 보기만(고치기 빼기) · audit 더하기) · 사원 실제 권한 같음 · 조합 422 두 곳(권한그룹 안 생김 · 개별 안 남음) · 처음 규칙 3 · ADMIN 403',
           (sl.get('routes') or 0) >= 1 and g1.get('ok') is True and len(home.get('groups') or []) >= 2 and TG in (home.get('groups') or [])
           and r1.get('ok') is True and sorted(pv.get('home') or []) == ['EDIT', 'VIEW'] and pv.get('reports') == ['VIEW'] and sorted(pv.get('queue') or []) == ['EDIT', 'VIEW'] and pv.get('audit') == ['VIEW']
           and a1.get('ok') is True and eff == 'audit:VIEW,home:EDIT,home:VIEW,queue:EDIT,queue:VIEW,reports:VIEW'
           and c1.get('code') == 'PERM_CONFLICT' and c1n == '0' and c2.get('code') == 'PERM_CONFLICT' and c2n == '0'
           and len([x for x in (cf.get('items') or []) if x.get('code') in ('C710_APPROVE_PAY', 'D173_PAY_MAL', 'D173_PAY_AFF')]) == 3 and adm.get('_err') == 403,
           f"{sl.get('routes')} · {g1.get('ok')} {home.get('groups')} · {r1.get('ok') or r1} {pv} · {a1.get('ok') or a1} {eff} · {c1.get('code')} {c1n} {c2.get('code')} {c2n} · {adm.get('_err')}")
    finally:
        clean()
        rm_role(aa, '1562')
    ok('끝 — 시험 업무그룹 · 권한그룹 · 붙임 없음', psql(f"SELECT (SELECT count(*) FROM perm_task_groups WHERE key = '{TG}') + (SELECT count(*) FROM perm_role_groups WHERE key IN ('{RG}', '{RGC}')) + (SELECT count(*) FROM perm_account_groups WHERE account_id = '{ap}')") == '0', '')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        for tab, sel in (('perm-roles', '[data-perm-roles]'), ('perm-groups', '[data-perm-groups]'), ('perm-tasks', '[data-perm-tasks]')):
            pg.goto(ADMIN_WEB + '/#/' + tab, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            seen[tab] = pg.locator(sel).count()
            if tab == 'perm-roles':   # 조합 규칙 표는 권한그룹 탭 안
                seen['sets'] = pg.locator('[data-perm-conflicts]').count()
    r = admin_page('/#/perm-roles', chk)
    if r is None:
        print('  (playwright 없음 — ③ 건너뜀)')
    else:
        seen, perr = r
        ok('③ 화면 — 권한그룹(조합 표) · 업무그룹 · 업무 목록 · 화면 오류 없음', seen.get('perm-roles') == 1 and seen.get('perm-groups') == 1 and seen.get('perm-tasks') == 1 and seen.get('sets') == 1 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (ADMIN_WEB 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
sys.exit(0 if passed == len(RES) else 1)
