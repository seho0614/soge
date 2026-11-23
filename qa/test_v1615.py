"""v10.615 (docs/757) 권한그룹 전환 준비 — 역할 이름으로 막는 곳 조사 · 권한그룹과 함께 보게 고침 · GROUPS 조건에 「남은 문제 0」
  ① (코드) 도우미 pgx-perm · 남은 문제 PGX_OPEN 빈 배열 · 고친 곳 20(서버 13 · 화면 3 · DB 4) · 옛 시험이 보는 글자 남음 · SQL(퍼센트 없음 · 4함수 · 도움말 주소) · 역할 이름 검사 줄 수 기준 · 문서 757
  ② (API · DB) ROLE 에서 pgx_groups_task 거짓 · /admin/perm/me decide · /admin/perm/mode roleChecksOpen 0 · 도움말 주소 = 모든 업무 · 4함수 본문 ·
     (한 트랜잭션 ROLLBACK) GROUPS 에서 개별 더하기 받은 검수 담당은 참 · 받지 않은 업무는 거짓
  (두 번 돌아도 통과 — DB 는 ROLLBACK 만 · 공유 데이터 남기지 않음 · API 가 닿지 않으면 ② 건너뜀)
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




def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


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


def migr_has(text):
    d = os.path.join(K, 'prisma', 'migrations')
    for x in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if text in t:
                return t
    return ''


def api_up():
    try:
        urllib.request.urlopen(API.rsplit('/api/', 1)[0] + '/api/v1/health', timeout=5)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


ROLE_RE = re.compile(r"'(ADMIN|SUPER|PAYOUT|REVIEWER|PARTNER_MAL|PARTNER_AFF|ACCOUNTANT)'")
ROLE_LINES_MAX = 326   # c1569 318 + v10.615 패치 5(문의 담당 SQL 의 운영 역할 목록) + v10.653 PAGE_IMAGE 올리기 1 + v10.680 관 담당자 운영 계정 2(docs/757 3-3) — 늘면 docs/757 3절 표에 줄을 더하고 이 값을 고침


def role_lines():
    n = 0
    for dp, _, fs in os.walk(os.path.join(K, 'src')):
        if 'generated' in dp:
            continue
        for f in fs:
            if f.endswith('.ts'):
                for ln in open(os.path.join(dp, f), encoding='utf-8'):
                    if ROLE_RE.search(ln) and '@Roles(' not in ln:
                        n += 1
    return n


"""시험 몸통"""
PP, PO = rd('src/modules/admin/pgx-perm.ts'), rd('src/modules/admin/pgx-open.ts')
AS, MO, MC = rd('src/modules/admin/admin-search.service.ts'), rd('src/modules/admin/member-ops.ts'), rd('src/modules/admin/member-ops.controller.ts')
IQ, HB, FS = rd('src/modules/support/inquiry-admin.service.ts'), rd('src/modules/acct/hrx-booking.ts'), rd('src/modules/file/file.service.ts')
OC, ON, HL = rd('src/modules/acct/ofc-calendar.ts'), rd('src/modules/acct/ofc-notify.ts'), rd('src/modules/acct/hra-library.ts')
LS, SX, PB = rd('src/modules/listing/listing.service.ts'), rd('src/modules/slx/slx.controller.ts'), rd('src/modules/public/public.service.ts')
TH, PS, PM = rd('src/modules/sec2/tab-help.ts'), rd('src/modules/admin/perm.service.ts'), rd('src/modules/admin/perm-mode.ts')
WP, APP, LG = rd('web/src/app/admin/Perm.tsx'), rd('web/src/App.tsx'), rd('web/src/components/Login.tsx')
ok('① 도우미 · 남은 문제 — pgxCan · pgxEffective · pgxEffectiveOf · GROUPS 만 · PGX_OPEN 빈 배열 · GROUPS 조건 · 판정 방식 화면',
   all(f in PP for f in ('export async function pgxCan(', 'export async function pgxEffective(', 'export async function pgxEffectiveOf(', "=== 'GROUPS'", "PGX_EDIT_UP: readonly string[] = ['EDIT', 'APPROVE']"))
   and re.search(r'export const PGX_OPEN: readonly string\[\] = \[\];', PO) is not None
   and "import { PGX_OPEN } from './pgx-open';" in PM and 'if (PGX_OPEN.length) {' in PM and 'roleChecksOpen: PGX_OPEN.length' in PM and 'PGX_OPEN.length === 0' in PM, f"{len(PP)} {len(PO)}")
ok('① 서버 고친 곳 13 — 찾기 · 오늘 할 일 · 문의 담당 2 · 예약 관리자 · 올리기 · 재무 일정 · 운영 알림 · 검수 사진 · 리뷰 사진 · 공지 첨부 · 자료실 관리 · 도움말',
   'PGX_SEARCH_TASKS' in AS and "eff.has(`${t}:VIEW`)" in AS
   and 'eff: Set<string> | null = null' in MO and "'affiliates:EDIT'" in MO and 'await pgxEffective(this.db, p?.accountId ?? null, roles)' in MC
   and IQ.count("e.task_key = 'inquiries' AND e.level IN ('EDIT', 'APPROVE')") == 2
   and "['hrx-booking'], ['APPROVE'], ['ADMIN']" in HB and 'await isManager(db, v)' in HB
   and 'PGX_UPLOAD_TASKS' in FS and "PRODUCT_IMAGE: ['hlt-products']" in FS
   and "['acct-month'], ['VIEW'], ['PAYOUT']" in OC and ON.count("['ops-alerts'], ['VIEW'], ['ADMIN']") == 2
   and "['hra-library'], PGX_EDIT_UP, ['ADMIN']" in HL
   and "pgx_groups_task($1::uuid, ARRAY['queue'], ARRAY['VIEW'])" in LS and "pgx_groups_task($1::uuid, ARRAY['queue'], ARRAY['VIEW'])" in SX
   and "pgx_groups_task($3::uuid, ARRAY['mainops'], ARRAY['VIEW'])" in PB
   and 'pgxEffectiveOf(db, RequestCtx.actorId() ?? null)' in TH and "const decide = ['ROLE', 'COMPARE', 'GROUPS']" in PS, '')
ok('① 화면 고친 곳 3 — /admin/perm/me decide · GROUPS 면 탭 · 단추 권한그룹대로 · 로그인 운영 역할 모두',
   "ME.decide === 'GROUPS'" in WP and 'export const permGroupsTab' in WP and 'permGroupsTab(t) && !superTab(t)' in APP
   and "const OPS_MORE = ['PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];" in LG and 'OPS_MORE.includes(x)' in LG, '')
ok('① 옛 시험이 보는 글자 남음(v1112 · v1444 · v1051 · v1289 · v1364 · v1611)',
   "const OPS = ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT'];" in LG and 'canSee(t, roles) && permVisible(t)' in APP and '!hasRole(p.roles, ...uploaders)' in FS
   and "members:  { roles: ['ADMIN']" in AS and "if (has('PAYOUT'))" in MO and "INQUIRY_ATTACHMENT: ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN']" in FS, '')
MS = migr_has('pgx_groups_task')
body = re.sub(r'--[^\n]*', '', MS)
ok('① SQL — pgx_groups_task(GROUPS · 운영 역할 · fn_perm_effective) · 4함수 다시 씀 · 도움말 주소 모든 업무 + 새 업무 트리거 · 퍼센트 없음',
   'CREATE OR REPLACE FUNCTION public.pgx_groups_task(' in MS and "<> 'GROUPS' THEN RETURN false" in MS
   and all(f'CREATE OR REPLACE FUNCTION public.{fn}(' in MS for fn in ('fn_settlement_approval', 'fn_post_guard', 'fn_bzx_inquiry_file_guard', 'fn_file_can_read'))
   and "SELECT 'GET', '/admin/help/tab', t.key, 'VIEW' FROM public.perm_tasks t" in MS and 'trg_pgx_task_help_route' in MS
   and not re.search(r"RAISE EXCEPTION '[^']*%", body), f"{len(MS)}")
n_role = role_lines()
ok(f'① 역할 이름 검사 줄 수 {n_role} ≤ {ROLE_LINES_MAX}(늘면 docs/757 표에 줄을 더하고 기준을 고침)', 0 < n_role <= ROLE_LINES_MAX, str(n_role))
ok('① 문서 757(조사 표 · 고친 곳 20 · 남은 문제 0 · GROUPS 조건) · 판', all(f in doc('757_') for f in ('3-1. 고친 곳(20)', '남은 문제 0', 'PERM_MODE_NOT_READY', 'G13'))
   and VT >= (10, 615), VER)

if API and DB and api_up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    mode0 = getset('perm.mode') or 'ROLE'
    me = call('GET', '/admin/perm/me', None, TS)
    pm = call('GET', '/admin/perm/mode', None, TS)
    nt = psql("SELECT count(*) FROM perm_tasks")
    nh = psql("SELECT count(*) FROM perm_route_map WHERE method = 'GET' AND pattern = '/admin/help/tab'")
    fd = psql("SELECT count(*) FROM pg_proc WHERE proname IN ('fn_settlement_approval', 'fn_post_guard', 'fn_bzx_inquiry_file_guard', 'fn_file_can_read') AND prosrc LIKE '%pgx_groups_task%'")
    ok('② /admin/perm/me decide · /admin/perm/mode roleChecksOpen 0 · 도움말 주소 = 모든 업무 · 4함수가 pgx_groups_task 를 씀',
       me.get('decide') == mode0 and pm.get('roleChecksOpen') == 0 and nt == nh and fd == '4', f"{me.get('decide')} {mode0} · {pm.get('roleChecksOpen')} · {nt}/{nh} · {fd}")
    stamp = int(time.time()) % 1000000
    em = f't1615r{stamp}@x.com'
    out = psql(
        "BEGIN; "
        f"INSERT INTO accounts(email, name, password_hash) SELECT '{em}', '시험1615', password_hash FROM accounts WHERE email = 'buyer@x.com'; "
        "SELECT set_config('app.role_reason', '시험 1615', true), set_config('app.setting_reason', '시험 1615', true), set_config('app.perm_mode_ok', 'yes', true); "
        f"INSERT INTO account_roles(account_id, role) SELECT id, 'REVIEWER' FROM accounts WHERE email = '{em}'; "
        f"INSERT INTO perm_account_overrides(account_id, task_key, level, effect, reason) SELECT id, 'inquiries', 'EDIT', 'ALLOW', '시험 1615' FROM accounts WHERE email = '{em}'; "
        f"SELECT 'R' || public.pgx_groups_task((SELECT id FROM accounts WHERE email = '{em}'), ARRAY['inquiries'], ARRAY['EDIT', 'APPROVE'])::text WHERE (SELECT value FROM site_settings WHERE key = 'perm.mode') <> 'GROUPS'; "
        "UPDATE site_settings SET value = 'GROUPS' WHERE key = 'perm.mode'; "
        f"SELECT 'G' || public.pgx_groups_task((SELECT id FROM accounts WHERE email = '{em}'), ARRAY['inquiries'], ARRAY['EDIT', 'APPROVE'])::text; "
        f"SELECT 'N' || public.pgx_groups_task((SELECT id FROM accounts WHERE email = '{em}'), ARRAY['settlement'], ARRAY['EDIT', 'APPROVE'])::text; "
        "SELECT 'S' || public.pgx_groups_task(NULL, ARRAY['inquiries'], ARRAY['EDIT'])::text; "
        "ROLLBACK;")
    lines = [x for x in out.splitlines() if x[:1] in 'RGNS!']
    left = psql(f"SELECT count(*) FROM accounts WHERE email = '{em}'")
    ok('② (ROLLBACK) ROLE 에서 거짓 · GROUPS 에서 개별 더하기 받은 검수 담당 참 · 받지 않은 업무 거짓 · 계정 없음 거짓 · 남은 것 없음',
       ('Rfalse' in lines or mode0 == 'GROUPS') and 'Gtrue' in lines and 'Nfalse' in lines and 'Sfalse' in lines and left == '0' and getset('perm.mode') == mode0,
       f"{lines} · {left} · {getset('perm.mode')}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
