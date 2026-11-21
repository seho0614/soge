"""v10.587 (docs/729) 14차 운영 ③ 서버 오류 묶기 — 기존 「서버 오류 30일 기록」(D204 ops_server_error_days) 위 트리거 · 묶음 표
  ① (코드) 보기 · 상태 바꾸기 · 서버 오류 화면 상자 · 알림 이름 · 트리거 · 지문 함수 · 문서 729
  ② (DB · API) 처음 나면 묶음 · 알림 · 더하기 · 목록 · 고침 → 다시 나면 열림 · 409 · 422 · 404 · 400 · 스위치 off 면 알림 없음
  ③ (화면) 서버 오류 아래 상자
  (두 번 돌아도 통과 — /api/v1/t1587/ 줄 · 묶음 · 알림은 시작 · 끝에 replica 로 지움 · 스위치는 되돌림)
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

"""시험 몸통"""
def allmig():
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return ''
    return '\n'.join(open(os.path.join(d, x, 'migration.sql'), encoding='utf-8').read() for x in sorted(os.listdir(d)) if os.path.exists(os.path.join(d, x, 'migration.sql')))


MIG = allmig()
EG = rd('src/modules/ops2/error-groups.ts')
CT = rd('src/modules/ops2/ops2.controller.ts')
SE = rd('web/src/app/admin/ServerErrors.tsx')
UI = rd('web/src/app/admin/Ops2ErrorGroups.tsx')
OA = rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 코드 — 묶음 보기 · 상태 바꾸기(409 · 422 · 404) · 서버 오류 화면에 「오류 묶음」 · 알림 이름 둘 · 트리거 · 지문 함수 · 처음 채움 · 스위치 · 문서 729 · 판',
   'export async function ops2ErrorGroups' in EG and "'OPS2_ERROR_SAME'" in EG and "'OPS2_ERROR_NOTE'" in EG and "@Post('error-groups/:fp/state')" in CT
   and '<Ops2ErrorGroups />' in SE and 'data-ops2-error-groups' in UI and 'SERVER_ERROR_NEW:' in OA and 'SERVER_ERROR_REOPEN:' in OA
   and 'trg_ops2_error_group_touch' in MIG and 'fn_ops2_error_fp' in MIG and 'ops2.error_new_alert' in MIG
   and 'ops2_error_groups' in doc('729_') and VT >= (10, 587), VER)

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    P1 = f'/api/v1/t1587/{STAMP}/a'
    P2 = f'/api/v1/t1587/{STAMP}/b'
    CLEAN = ("SET session_replication_role = replica; DELETE FROM ops_server_error_days WHERE path LIKE '/api/v1/t1587/%'; "
             "DELETE FROM ops2_error_groups WHERE path LIKE '/api/v1/t1587/%'; DELETE FROM ops_alerts WHERE alert_code IN ('SERVER_ERROR_NEW', 'SERVER_ERROR_REOPEN') AND detail->>'path' LIKE '/api/v1/t1587/%';")
    psql(CLEAN)
    sw0 = getset('ops2.error_new_alert')
    try:
        tbl = psql("SELECT count(*) FROM information_schema.tables WHERE table_name = 'ops2_error_groups'")
        trg = psql("SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_ops2_error_group_touch'")
        pm = psql("SELECT count(*) FROM perm_route_map WHERE pattern IN ('/admin/ops2/error-groups', '/admin/ops2/error-groups/{fp}/state') AND task_key = 'server-errors'")
        setting('ops2.error_new_alert', 'on', '1587')
        cap = psql("SELECT count(*) FROM ops_alerts WHERE alert_code IN ('SERVER_ERROR_NEW', 'SERVER_ERROR_REOPEN') AND raised_at > now() - interval '1 hour'")
        ins = psql(f"INSERT INTO ops_server_error_days (day, method, path, code, status, n, last_detail, last_request_id) VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, 'GET', '{P1}', 'INTERNAL_ERROR', 500, 2, '[42702] column reference \"id\" is ambiguous', 'rq-1587')")
        fp = psql(f"SELECT fn_ops2_error_fp('GET', '{P1}', 'INTERNAL_ERROR', 500, '[42702] x')")
        g1 = psql(f"SELECT total_n || '|' || state || '|' || coalesce(pg_code, '') || '|' || days_seen FROM ops2_error_groups WHERE fp = '{fp}'")
        a1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SERVER_ERROR_NEW' AND detail->>'fp' = '{fp}'")
        up = psql(f"UPDATE ops_server_error_days SET n = n + 3 WHERE path = '{P1}'")
        g2 = psql(f"SELECT total_n FROM ops2_error_groups WHERE fp = '{fp}'")
        a_ok = (a1 == '1') if cap.isdigit() and int(cap) < 10 else True
        ok('② DB — 표 · 트리거 · 권한 주소 2 · 처음 나면 묶음(2 · 열림 · [42702] · 1일) · 알림 SERVER_ERROR_NEW(한 시간 10건 안이면) · 더하면 5',
           tbl == '1' and trg == '1' and pm == '2' and '!' not in ins and g1 == '2|OPEN|42702|1' and a_ok and g2 == '5', f"{tbl} {trg} {pm} {ins[-40:]} {g1} {a1}(앞 {cap}) {up[-30:]} {g2}")
        v = call('GET', '/admin/ops2/error-groups?days=1', None, TS)
        mine = next((x for x in v.get('rows') or [] if x.get('fp') == fp), None)
        s1 = call('POST', f'/admin/ops2/error-groups/{fp}/state', {'state': 'FIXED', 'note': '시험 1587 고침'}, TS)
        s2 = call('POST', f'/admin/ops2/error-groups/{fp}/state', {'state': 'FIXED'}, TS)
        s3 = call('POST', f'/admin/ops2/error-groups/{fp}/state', {'state': 'MUTED', 'note': ''}, TS)
        s4 = call('POST', '/admin/ops2/error-groups/zzzz/state', {'state': 'ACK'}, TS)
        s5 = call('POST', f'/admin/ops2/error-groups/{fp}/state', {'state': 'GONE'}, TS)
        psql(f"UPDATE ops_server_error_days SET n = n + 1 WHERE path = '{P1}'")
        g3 = psql(f"SELECT state || '|' || reopened_n || '|' || total_n FROM ops2_error_groups WHERE fp = '{fp}'")
        a3 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SERVER_ERROR_REOPEN' AND detail->>'fp' = '{fp}'")
        a3_ok = (a3 == '1') if cap.isdigit() and int(cap) < 9 else True
        ok('② API — 목록에 내 묶음(7일 5) · 고침 · 같은 상태 409 · 알리지 않음 메모 없으면 422 · 없는 지문 404 · 모르는 상태 400 · 고친 뒤 다시 나면 열림 · 다시 남 1 · 알림 SERVER_ERROR_REOPEN',
           mine is not None and mine.get('week') == 5 and mine.get('total') == 5 and s1.get('ok') is True and s2.get('_err') == 409 and s3.get('_err') == 422
           and s4.get('_err') == 404 and s5.get('_err') == 400 and g3 == 'OPEN|1|6' and a3_ok,
           f"{bool(mine)} {(mine or {}).get('week')} {s1} {s2.get('code')} {s3.get('code')} {s4.get('_err')} {s5.get('_err')} {g3} {a3}")
        setting('ops2.error_new_alert', 'off', '1587')
        psql(f"INSERT INTO ops_server_error_days (day, method, path, code, status, n) VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, 'POST', '{P2}', 'INTERNAL_ERROR', 503, 1)")
        fp2 = psql(f"SELECT fn_ops2_error_fp('POST', '{P2}', 'INTERNAL_ERROR', 503, NULL)")
        g4 = psql(f"SELECT count(*) FROM ops2_error_groups WHERE fp = '{fp2}'")
        a4 = psql(f"SELECT count(*) FROM ops_alerts WHERE detail->>'fp' = '{fp2}'")
        ok('② 스위치 off — 묶기만 하고 알리지 않음', g4 == '1' and a4 == '0', f"{g4} {a4}")
    finally:
        psql(CLEAN)
        if sw0:
            setting('ops2.error_new_alert', sw0, '1587 되돌림')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['box'] = pg.locator('[data-ops2-error-groups]').count()
    s = admin_page('/#/server-errors', chk)
    if s is not None:
        seen, perr = s
        ok('③ 화면 — 서버 오류 아래 「오류 묶음」 상자 · 화면 오류 없음', seen.get('box', 0) >= 1 and not perr, f"{seen} {perr[:2]}")


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
