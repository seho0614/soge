"""v10.546 (docs/684) 같은 기기 여러 계정 탐지 — 대표 11/20 「(55) ① 같은 기기 여러 계정 탐지」
  ① (코드) D285 sfx_device_marks(해시만 · 지문 없음) · fn_sfx_device_seen(꺼짐이면 0 · 오류 삼킴) · 위험감지 RSK-SFX(auto_detect + detect_sql · 잠든 규칙 아님) · 설정 처음 off · 기기 표지 머리글(모양 검사) · 로그인 · 가입 연결 · 사용자 웹 쿠키 sgb_dm · 서버 · 메뉴 · 화면 · 문서 684
  ② (API · DB) 꺼짐이면 안 쌓음 · 켜고 세 계정 같은 표지 → 경보 1 · 운영 알림 · 다시 로그인해도 경보 1 · 자동 탐지 두 번 안 넣음 · 모양 틀린 표지 무시 · 운영 목록 · 계정 보기(가린 이메일 · 감사 기록) · 회원 403 · 없는 표지 404 · 권한 주소 · 되돌림
  ③ (화면) 위험감지 › 같은 기기 여러 계정 · 사용자 웹 로그인 뒤 sgb_dm 쿠키(HttpOnly · SITE 있을 때)
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


def callh(m_, p, b=None, t=None, h=None):
    """call 과 같되 머리글(X-Device-Mark 등)을 더함"""
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    hd.update(h or {})
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


M85 = migr('D285_')
CT = rd('src/modules/sfx/sfx.controller.ts')
UI = rd('web/src/app/admin/Sfx.tsx')
MN = rd('web/src/lib/adminMenu.ts')
AP = rd('web/src/App.tsx')
SJ = rd('spec/screens.json')
T0 = psql("SELECT clock_timestamp()::text") if (API and DB) else ''

import hashlib, uuid

DV = rd('src/modules/sfx/device.ts')
MW = rd('src/core/context.middleware.ts')
RC = rd('src/core/request-context.ts')
LH = rd('src/modules/identity/login-history.ts')
AS = rd('src/modules/identity/auth.service.ts')
SS = rd('site/src/lib/session.ts')

ok('① 코드 — D285 기기 표지 표(해시 64자만) · 쌓기 함수(꺼짐 0 · 오류 삼킴) · 위험감지 RSK-SFX(auto_detect true + detect_sql) · 운영 알림 SFX_DEVICE_MULTI · 설정 sfx.device_watch off · 기준 3 · 보관 180 · 머리글 모양 검사 · 로그인 · 가입 연결 · 사용자 웹 쿠키 sgb_dm(HttpOnly) · 서버 · 메뉴 · 화면 SFX-010 · 문서 684 · 판 v10.546',
   'CREATE TABLE IF NOT EXISTS public.sfx_device_marks' in M85 and "CHECK (mark_hash ~ '^[0-9a-f]{64}$')" in M85
   and 'FUNCTION public.fn_sfx_device_seen(p_hash text, p_account uuid, p_via text)' in M85 and "('RSK-SFX', '같은 기기 여러 계정'" in M85
   and 'SFX_DEVICE_MULTI' in M85 and "('sfx.device_watch', 'off'" in M85 and "('sfx.device_threshold', '3'" in M85 and "('sfx.device_keep_days', '180'" in M85
   and "createHash('sha256').update(`sgb-dm:${mark}`)" in DV and 'export async function sfxDeviceSeen' in DV and "deviceMark: markOf(req.headers['x-device-mark'])" in MW
   and 'deviceMark?: string;' in RC and "if (ok) await sfxDeviceSeen(db, accountId, 'LOGIN');" in LH and "await sfxDeviceSeen(this.db, acc.id, 'SIGNUP');" in AS
   and "const DM = 'sgb_dm';" in SS and "h['X-Device-Mark'] = dm" in SS and 'async function ensureDeviceMark' in SS and 'headers: await fwdHeaders()' in SS and 'httpOnly: true' in SS
   and "@Get('device/:mark')" in CT and "@Audit('SFX_DEVICE_VIEW', 'ACCOUNT')" in CT and 'export function SfxDevice' in UI
   and "['sfx-device', '같은 기기 여러 계정']" in MN and "'admrsk')?.tabs, 'opx-risk', ['sfx-device']" in MN and "{tab === 'sfx-device' && <SfxDevice />}" in AP
   and '"SB-ADM-SFX-010"' in SJ and '지문' in doc('684_') and VT >= (10, 546), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    sw0, th0 = getset('sfx.device_watch'), getset('sfx.device_threshold')
    mark = str(uuid.uuid4())
    h = hashlib.sha256(f'sgb-dm:{mark}'.encode()).hexdigest()
    sub = f'device:{h[:16]}'
    HD = {'X-Device-Mark': mark}
    accs = []
    try:
        for t in ('a', 'b', 'c'):
            em, aid = mk_staff(f'1546{t}{stamp % 89}', role=None)
            consent_ok.agree(em, PW)
            accs.append((em, aid))
        setting('sfx.device_watch', 'off', '1546')
        r_off = callh('POST', '/auth/login', {'email': accs[0][0], 'password': PW}, None, HD)
        n_off = psql(f"SELECT count(*) FROM sfx_device_marks WHERE mark_hash = '{h}'")
        setting('sfx.device_watch', 'on', '1546'); setting('sfx.device_threshold', '3', '1546')
        lg = [callh('POST', '/auth/login', {'email': e, 'password': PW}, None, HD) for e, _ in accs]
        n_on = psql(f"SELECT count(*) FROM sfx_device_marks WHERE mark_hash = '{h}'")
        al1 = psql(f"SELECT count(*) FROM risk_alerts WHERE rule_code = 'RSK-SFX' AND subject = '{sub}' AND state IN ('OPEN', 'REVIEWING')")
        oa = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SFX_DEVICE_MULTI' AND detail->>'mark' = '{h[:16]}'")
        again = callh('POST', '/auth/login', {'email': accs[0][0], 'password': PW}, None, HD)
        seen = psql(f"SELECT seen_count FROM sfx_device_marks WHERE mark_hash = '{h}' AND account_id = '{accs[0][1]}'")
        scan = psql("SELECT inserted::text || '|' || ok::text FROM fn_risk_scan() WHERE rule_code = 'RSK-SFX'")
        al2 = psql(f"SELECT count(*) FROM risk_alerts WHERE rule_code = 'RSK-SFX' AND subject = '{sub}' AND state IN ('OPEN', 'REVIEWING')")
        dormant = psql("SELECT count(*) FROM v_risk_dormant WHERE code = 'RSK-SFX'")
        badmark = callh('POST', '/auth/login', {'email': accs[1][0], 'password': PW}, None, {'X-Device-Mark': 'short'})
        nbad = psql(f"SELECT count(*) FROM sfx_device_marks WHERE account_id = '{accs[1][1]}'")
        ov = call('GET', '/admin/sfx/device', None, TS)
        g = next((x for x in ov.get('groups') or [] if x.get('mark') == h[:16]), {})
        dt = call('GET', f'/admin/sfx/device/{h[:16]}', None, TS)
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'SFX_DEVICE_VIEW' AND occurred_at >= '{T0}'::timestamptz")
        mb = call('GET', '/admin/sfx/device', None, login(accs[2][0]))
        nf = call('GET', '/admin/sfx/device/zzzz', None, TS)
        nf2 = call('GET', f'/admin/sfx/device/{"0" * 16}', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'sfx-device'")
        ok('② 같은 기기 — 꺼짐이면 안 쌓음 · 켜고 세 계정 → 표지 3줄 · 경보 1 · 운영 알림 · 다시 로그인 횟수 2 · 경보 그대로 1 · 자동 탐지 0 넣음(정상) · 잠든 규칙 아님 · 모양 틀린 표지 무시 · 운영 목록(기준 넘음) · 계정 보기(가린 이메일 · 감사) · 회원 403 · 없는 표지 404 · 권한 주소 2',
           r_off.get('accessToken') and n_off == '0' and all(x.get('accessToken') for x in lg) and n_on == '3' and al1 == '1' and oa != '0'
           and again.get('accessToken') and seen == '2' and scan == '0|true' and al2 == '1' and dormant == '0'
           and badmark.get('accessToken') and nbad == '1'
           and ov.get('on') is True and g.get('accounts') == 3 and g.get('overThreshold') is True and g.get('alertOpen') is True
           and dt.get('accounts') == 3 and all('****' in str(x.get('email')) for x in dt.get('rows') or []) and aud != '0'
           and mb.get('_err') == 403 and nf.get('_err') == 404 and nf2.get('_err') == 404 and rmap == '2',
           f"{n_off} {n_on} 경보 {al1}/{al2} 알림 {oa} 횟수 {seen} 탐지 {scan} 잠듦 {dormant} 틀린 {nbad} · {g} · {dt.get('accounts')} 감사 {aud} · {mb.get('_err')} {nf.get('_err')} {nf2.get('_err')} {rmap}")
    finally:
        ids = ','.join(f"'{a}'" for _, a in accs) or "'00000000-0000-0000-0000-000000000000'"
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"DELETE FROM risk_actions WHERE alert_id IN (SELECT id FROM risk_alerts WHERE rule_code = 'RSK-SFX' AND subject = '{sub}'); "
             f"DELETE FROM risk_alerts WHERE rule_code = 'RSK-SFX' AND subject = '{sub}'; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'SFX_DEVICE_MULTI' AND detail->>'mark' = '{h[:16]}'; "
             f"DELETE FROM sfx_device_marks WHERE mark_hash = '{h}' OR account_id IN ({ids}); COMMIT;")
        setting('sfx.device_watch', sw0 or 'off', '1546 되돌림'); setting('sfx.device_threshold', th0 or '3', '1546 되돌림')
        ok('② 되돌림 — 표지 · 경보 · 운영 알림 지움 · 스위치 처음 값',
           psql(f"SELECT count(*) FROM sfx_device_marks WHERE mark_hash = '{h}'") == '0' and getset('sfx.device_watch') == (sw0 or 'off'), getset('sfx.device_watch'))
    if ADMIN_WEB:
        r = admin_page('/#/sfx-device', lambda pg, seen: seen.update(n=pg.locator('[data-sfx-device]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 위험감지 › 같은 기기 여러 계정(스위치 줄 · 화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        def run_site(b, seen, perr):
            ps = site_login(b, perr, 'buyer@x.com')
            ck = [c for c in ps.context.cookies() if c.get('name') == 'sgb_dm']
            seen['dm'] = len(ck)
            seen['http'] = bool(ck and ck[0].get('httpOnly'))
            seen['shape'] = bool(ck and re.match(r'^[A-Za-z0-9-]{16,64}$', ck[0].get('value') or ''))
        r2 = ui(run_site)
        if r2 is not None:
            seen2, perr2 = r2
            ok('③ 화면 — 사용자 웹 로그인 뒤 기기 표지 쿠키 sgb_dm(HttpOnly · 무작위 값 모양)', seen2.get('dm') == 1 and seen2.get('http') and seen2.get('shape') and not perr2, f"{seen2} {perr2[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
