"""v10.443 (D258 · docs/580) 권한 관리 화면 · API(SUPER)
  ① (코드) 컨트롤러 API 10 · 감사 · 화면 PermAdmin(권한그룹 매트릭스 · 개인권한 · 미리보기 · SHADOW · 기록) · 메뉴 사무 › 권한 관리 · 명세 PRM-010 · 문서 580
  ② (API · DB) 한눈에 · 권한그룹 만들기(항목) · 다시 고치기 · 없는 업무 422 · 지급 담당 403 · 개인권한(그룹 + 개별 더하기 · 빼기 · 기한) · 미리보기 · 바꾼 기록 · 운영 알림
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

PC, UI, MN, APP = rd('src/modules/admin/perm.controller.ts'), rd('web/src/app/admin/Perm.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
ok('① 코드 — API 10 · 감사 3 · 화면 · 메뉴 · 명세 · 문서 580 · 판 v10.443',
   all(f"@{m}('{p}')" in PC for m, p in (('Get', 'me'), ('Get', 'overview'), ('Put', 'role-groups/:key'), ('Patch', 'task-groups/:key'), ('Patch', 'tasks/:key'), ('Put', 'accounts/:id'), ('Get', 'shadow'), ('Get', 'changes')))
   and "@Audit('PERM_ROLE_GROUP_SET'" in PC and "@Audit('PERM_ACCOUNT_SET'" in PC and 'export function PermAdmin' in UI and 'data-perm-group-save' in UI
   and "['perm-admin', '권한 관리']" in MN and "{tab === 'perm-admin' && <PermAdmin />}" in APP and '"SB-ADM-PRM-010"' in SJ and '권한그룹' in doc('580_') and VT >= (10, 443), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1443', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    t0 = psql("SELECT now()")
    try:
        ov = call('GET', '/admin/perm/overview', None, TS)
        byp = call('GET', '/admin/perm/overview', None, TP)
        body = {'name': '시험 1443', 'kind': 'STAFF', 'items': [{'taskKey': 'acct-journal', 'level': 'VIEW'}, {'taskKey': 'acct-journal', 'level': 'EXPORT'}], 'reason': '시험 1443 만들기'}
        g1 = call('PUT', '/admin/perm/role-groups/T1443', body, TS)
        g2 = call('PUT', '/admin/perm/role-groups/T1443', {**body, 'items': body['items'][:1], 'reason': '시험 1443 고치기'}, TS)
        gd = call('GET', '/admin/perm/role-groups/T1443', None, TS)
        bad = call('PUT', '/admin/perm/role-groups/T1443', {**body, 'items': [{'taskKey': 'no-such-tab', 'level': 'VIEW'}]}, TS)
        mgr = call('PUT', f'/admin/perm/accounts/{pid}', {'kind': 'STAFF', 'groups': [{'key': 'R_ADMIN'}], 'reason': '시험 1443 관리자 그룹'}, TS)
        sa = call('PUT', f'/admin/perm/accounts/{pid}', {'kind': 'STAFF', 'groups': [{'key': 'T1443', 'expiresAt': '2099-12-31'}],
                  'overrides': [{'taskKey': 'queue', 'level': 'VIEW', 'effect': 'ALLOW'}, {'taskKey': 'acct-journal', 'level': 'VIEW', 'effect': 'DENY'}], 'reason': '시험 1443 개인'}, TS)
        pv = call('GET', f'/admin/perm/accounts/{pid}', None, TS)
        prev = pv.get('preview') or {}
        ch = call('GET', '/admin/perm/changes', None, TS)
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'PERM_CHANGED' AND raised_at > '{t0}'")
        ok('② API — 한눈에 · 지급 담당 403 · 만들기 · 고치기(항목 1) · 없는 업무 422 · 관리자 그룹은 업무용에 못 붙임 · 개인(그룹 기한 · 더하기 · 빼기) · 미리보기(검수 보기 있음 · 전표 보기 빠짐) · 기록 · 알림',
           len(ov.get('tasks') or []) >= 100 and any(g.get('key') == 'R_PAYOUT' for g in ov.get('roleGroups') or []) and byp.get('_err') == 403
           and g1.get('ok') is True and g2.get('items') == 1 and len(gd.get('items') or []) == 1 and bad.get('code') == 'PERM_TASK'
           and mgr.get('_err') in (409, 422) and sa.get('ok') is True and 'VIEW' in (prev.get('queue') or []) and 'VIEW' not in (prev.get('acct-journal') or [])
           and any(c.get('target') == 'T1443' for c in ch.get('items') or []) and int(al or 0) >= 1,
           f"{len(ov.get('tasks') or [])} {byp.get('_err')} · {g1.get('ok')} {g2.get('items')} {len(gd.get('items') or [])} {bad.get('code')} · {mgr.get('code')} · {sa.get('ok')} {prev.get('queue')} {prev.get('acct-journal')} · 알림 {al}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM perm_account_overrides WHERE account_id = '{pid}'; DELETE FROM perm_account_groups WHERE group_key = 'T1443'; "
             "DELETE FROM perm_role_group_items WHERE group_key = 'T1443'; DELETE FROM perm_role_groups WHERE key = 'T1443';")
        rm_role(pid, '1443')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
