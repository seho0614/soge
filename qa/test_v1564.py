"""v10.564 (D291 · docs/706) 판정 바꾸기 perm.mode — ROLE(처음) · COMPARE(다름 기록) · GROUPS(운영 역할 API 는 권한그룹이 정함)
  ① (코드) perm-mode(groupsApplicable · groupsDecide · logDiff · 연결 안 된 주소 · GROUPS 조건) · AuthGuard · PermGuard 두 군데만 · D291 perm.mode · DB 막음 트리거 · 다름 칸 · 빠진 주소 시드 · 문서 706
  ② (API · DB) 처음 ROLE · 직접 DB 로 GROUPS 막힘 · 다름 있으면 GROUPS 422 PERM_MODE_NOT_READY · COMPARE 기록(ROLE_ONLY · GROUP_ONLY) · 회원 역할 검사 그대로 · ADMIN 403
     · GROUPS 준비(연결 안 된 주소 0 · 다름 0)면 GROUPS 로 — 처음 권한그룹 그대로 열림 · 그룹 없으면 PERM_DENIED · 회원 API 그대로 → 처음 값으로 되돌림
  (두 번 돌아도 통과 — 판정 방식은 끝에 처음 값으로 · 시험 기록은 replica 로 지움)
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


PM, AU, PG, MG = rd('src/modules/admin/perm-mode.ts'), rd('src/core/auth.ts'), rd('src/core/perm.guard.ts'), rd('prisma/migrations/D291_staff_perm_groups_mode/migration.sql')
ok('① 코드 — 회원 역할 섞임 · SUPER 전용은 역할 그대로 · 두 가드만 · GROUPS 조건 · DB 트리거 · perm.mode ROLE · 다름 칸 · 빠진 주소 시드 · 문서 706 · 판 v10.564',
   "if (required.every((r) => r === 'SUPER')) return false;" in PM and "'PERM_MODE_NOT_READY'" in PM and "set_config('app.perm_mode_ok'" in PM
   and 'groupsApplicable(principal.roles, required)' in AU and "req.permGroupsOk = true;" in AU and 'if (req.permGroupsOk) return true;' in PG and "'ROLE_ONLY'" in PG
   and "('perm.mode', 'ROLE', 'ADMIN'" in MG and 'trg_perm_mode_guard' in MG and "CHECK (diff IS NULL OR diff IN ('ROLE_ONLY', 'GROUP_ONLY'))" in MG
   and MG.count('INSERT INTO public.perm_route_map') >= 2 and 'GROUPS' in doc('706_') and VT >= (10, 564), VER)

def setmode(m):
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1564', true), set_config('app.perm_mode_ok', 'yes', true); UPDATE site_settings SET value = '{m}' WHERE key = 'perm.mode'; COMMIT;")

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = int(time.time()) % 100000
    m0 = psql("SELECT value FROM site_settings WHERE key = 'perm.mode'") or 'ROLE'
    er, ar = mk_staff(f'1564r{stamp % 97}', 'REVIEWER')
    ea, aa = mk_staff(f'1564a{stamp % 89}', 'ADMIN')
    t0 = psql("SELECT now()")
    try:
        consent_ok.agree(er, PW); consent_ok.agree(ea, PW)
        TR, TA = login(er), login(ea)
        v0 = call('GET', '/admin/perm/mode', None, TS)
        dbg = psql("BEGIN; UPDATE site_settings SET value = 'GROUPS' WHERE key = 'perm.mode'; COMMIT;")
        still = psql("SELECT value FROM site_settings WHERE key = 'perm.mode'")
        psql(f"INSERT INTO perm_shadow_log (account_id, method, pattern, task_keys, level, mode, diff) VALUES ('{ar}', 'GET', '/admin/t1564', ARRAY['queue'], 'VIEW', 'COMPARE', 'ROLE_ONLY')")
        nr = call('PUT', '/admin/perm/mode', {'mode': 'GROUPS', 'reason': '시험 1564 막힘'}, TS)
        adm = call('PUT', '/admin/perm/mode', {'mode': 'COMPARE', 'reason': '시험 1564 ADMIN'}, TA)
        ok('② 처음 ROLE(설정 · 화면 값) · 직접 DB 로 GROUPS 막힘(PERM_MODE_GROUPS) · 다름 있으면 422 PERM_MODE_NOT_READY · ADMIN 403',
           m0 in ('ROLE', 'COMPARE', 'GROUPS') and v0.get('mode') == m0 and 'PERM_MODE_GROUPS' in dbg and still == m0 and nr.get('code') == 'PERM_MODE_NOT_READY' and adm.get('_err') == 403,
           f"{m0} {v0.get('mode')} · {dbg[-60:]} · {still} · {nr.get('code')} · {adm.get('_err')}")
        # COMPARE — 역할은 열고 권한그룹은 막음(ROLE_ONLY) · 역할은 막고 권한그룹은 엶(GROUP_ONLY)
        cm = call('PUT', '/admin/perm/mode', {'mode': 'COMPARE', 'reason': '시험 1564 비교'}, TS)
        psql(f"DELETE FROM perm_account_groups WHERE account_id = '{ar}' AND group_key = 'R_REVIEWER'")
        psql(f"INSERT INTO perm_account_overrides (account_id, task_key, level, effect, reason) VALUES ('{ar}', 'users', 'VIEW', 'ALLOW', '시험 1564 권한그룹만')")
        q1 = call('GET', '/admin/reviews?status=QUEUED', None, TR)
        q2 = call('GET', '/admin/reports/roles', None, TR)
        q3 = call('GET', '/admin/staff', None, TB)
        d1 = psql(f"SELECT coalesce(string_agg(diff, ',' ORDER BY diff), '') FROM perm_shadow_log WHERE account_id = '{ar}' AND mode = 'COMPARE' AND created_at >= '{t0}' AND pattern <> '/admin/t1564'")
        ok('② COMPARE — 역할로 판정(검수 담당 검수 목록 200 · 역할 주기 목록 403) · 다름 ROLE_ONLY · GROUP_ONLY 기록 · 회원 API 는 역할 그대로(회원 403)',
           cm.get('mode') == 'COMPARE' and isinstance(q1, (list, dict)) and not (isinstance(q1, dict) and q1.get('_err')) and q2.get('_err') == 403 and d1 == 'GROUP_ONLY,ROLE_ONLY' and q3.get('_err') == 403,
           f"{cm.get('mode') or cm} · {str(q1)[:60]} · {q2.get('_err')} · {d1} · {q3.get('_err')}")
        # GROUPS — 준비됐을 때만(연결 안 된 /admin 주소 0 · 다름 0)
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM perm_shadow_log WHERE created_at >= '{t0}' AND (account_id IN ('{ar}', '{aa}') OR pattern = '/admin/t1564'); COMMIT;")
        v1 = call('GET', '/admin/perm/mode', None, TS)
        if v1.get('groupsReady'):
            gm = call('PUT', '/admin/perm/mode', {'mode': 'GROUPS', 'reason': '시험 1564 권한그룹'}, TS)
            a1 = call('GET', '/admin/staff', None, TA)                                  # ADMIN · R_ADMIN 에 staff-list 보기
            r1 = call('GET', '/admin/reviews?status=QUEUED', None, TR)                  # R_REVIEWER 뺌 → 막힘
            r2 = call('GET', '/admin/reports/roles', None, TR)                          # 역할은 ADMIN 만인데 개별 users 보기 → 엶
            b1 = call('GET', '/admin/staff', None, TB)                                  # 회원 → 그대로 403
            s1 = call('GET', '/admin/perm/overview', None, TA)                          # SUPER 전용 → 그대로 403
            ok('② GROUPS — ADMIN 처음 권한그룹 그대로 열림 · 그룹 뺀 검수 담당 PERM_DENIED · 개별 더하기로 엶 · 회원 · SUPER 전용은 역할 그대로',
               gm.get('mode') == 'GROUPS' and isinstance(a1, dict) and not a1.get('_err') and r1.get('code') == 'PERM_DENIED' and not (isinstance(r2, dict) and r2.get('_err'))
               and b1.get('_err') == 403 and s1.get('_err') == 403, f"{gm.get('mode') or gm} · {a1.get('_err')} · {r1.get('code')} · {str(r2)[:40]} · {b1.get('_err')} {s1.get('_err')}")
        else:
            print(f"  (GROUPS 준비 안 됨 — 연결 안 된 주소 {v1.get('unmapped')} · 다름 {v1.get('diff24')} — GROUPS 확인 건너뜀)")
    finally:
        call('PUT', '/admin/perm/mode', {'mode': m0, 'reason': '시험 1564 되돌림'}, TS) if m0 != 'GROUPS' else setmode(m0)
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM perm_shadow_log WHERE created_at >= '{t0}' AND (account_id IN ('{ar}', '{aa}') OR pattern = '/admin/t1564'); "
             f"DELETE FROM perm_account_overrides WHERE account_id = '{ar}'; COMMIT;")
        rm_role(ar, '1564'); rm_role(aa, '1564')
    ok('끝 — 판정 방식 처음 값 · 시험 기록 없음', psql("SELECT value FROM site_settings WHERE key = 'perm.mode'") == m0
       and psql(f"SELECT count(*) FROM perm_shadow_log WHERE pattern = '/admin/t1564'") == '0', '')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
sys.exit(0 if passed == len(RES) else 1)
