"""v10.485 (D268 · docs/623) 운영자 해외 접속 경고 — IP → 나라 판별 어댑터(외부 연동 GEOIP · 키 없으면 NOT_READY · 처음 간주) · 처음 꺼짐 · 해외 로그인 운영 알림 · 막기 선택
  ① (코드) D268 접속 나라 기록(고치지 않음 · 1년) · 캐시(지문) · 설정 security.* · 외부 연동 16종(GEOIP · 받는 키) · 어댑터 · 로그인 연결 · 불변식 16 · .env 예시 · 화면 SCU-030 · 문서 623
  ② (API · DB) ADMIN 설정 403 · LIVE 키 없음 422 · KR 없는 허용 422 · 경고 없이 막기 422 · 켜기(간주 US) · 운영자 로그인 → 경고(긴급 알림) · 회원 로그인은 안 봄 · 막기 → 403 GEO_BLOCKED · 허용 나라 더함 → 통과 · 판별 시험 · 30일 셈 · DB 막음 · 권한 주소 3
  ③ (화면) 위험감지 › 해외 접속 경고
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


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


M68 = migr('D268_')
GG, GC, AS_, RG, SS, VI, EV, UI, MN = (rd('src/modules/identity/geo-guard.ts'), rd('src/modules/identity/geo-guard.controller.ts'), rd('src/modules/identity/auth.service.ts'),
                                       rd('src/common/integration/registry.ts'), rd('src/common/integration/secret.service.ts'), rd('scripts/verify-invariants.sh'),
                                       rd('deploy/aws/env.production.example'), rd('web/src/app/admin/SecGeo.tsx'), rd('web/src/lib/adminMenu.ts'))
# 연동 수 16 → v10.497 (D272) SOCIAL 로 17 — 16 이상이면 통과(뒤 묶음이 연동을 더해도)
ok('① 코드 — D268 접속 나라 기록 · 캐시 · 설정 security.geo_watch off · ASSUME · 허용 KR · 막기 off · 외부 연동 GEOIP 줄 · 받는 키 GEOIP_API_KEY(CHECK · 함수 · FIRMBANK_USER_TOKEN 유지) · 어댑터(주소 틀 · NOT_READY) · 로그인 연결 · 연동 16 · .env 예시 · 메뉴 sec-geo · 화면 SCU-030 · 문서 623 · 판 v10.485',
   'CREATE TABLE IF NOT EXISTS public.sec_geo_events' in M68 and 'CREATE TABLE IF NOT EXISTS public.sec_geo_cache' in M68 and "('security.geo_watch', 'off'" in M68 and "('security.geo_block', 'off'" in M68
   and "VALUES ('GEOIP', 'IP 국가 판별'" in M68 and "('GEOIP','GEOIP_API_KEY')" in M68 and "('FIRMBANK','FIRMBANK_USER_TOKEN')" in M68 and "'FIRMBANK_USER_TOKEN', 'GEOIP_API_KEY') THEN" in M68
   and 'export class GeoIpHttp' in GG and "source: 'NOT_READY'" in GG and "'GEO_BLOCKED'" in GG and "'STAFF_LOGIN_ABROAD'" in GG and 'await assertGeoAllowed(this.db, acc.id)' in AS_
   and "code: 'GEOIP'" in RG and "name: 'GEOIP_API_KEY'" in SS and re.search(r'if \[ "\$n" = "1[6-9]" \]', VI) and 'GEOIP_API_KEY=' in EV and "@Put('security/geo')" in GC
   and 'export function SecGeo' in UI and "['sec-geo', '해외 접속 경고']" in MN and "'server-errors', 'ops-board'] }" in MN and '"SB-ADM-SCU-030"' in SJ and '해외' in doc('623_') and VT >= (10, 485), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS = login('admin@x.com')
    s0 = {k: getset(k) for k in ('security.geo_watch', 'security.geo_mode', 'security.geo_assume_country', 'security.geo_allow', 'security.geo_block')}
    es, asf = mk_staff('1485s', 'ADMIN')
    bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    mark = psql("SELECT coalesce(max(id), 0) FROM sec_geo_events")
    try:
        call('PUT', '/admin/security/geo', {'watch': False, 'block': False, 'mode': 'ASSUME', 'allow': 'KR', 'reason': '시험 1485 처음'}, TS)
        TSF = login(es)
        adm = call('PUT', '/admin/security/geo', {'watch': True, 'reason': '시험 1485'}, TSF)
        v0 = call('GET', '/admin/security/geo', None, TSF)
        live = call('PUT', '/admin/security/geo', {'mode': 'LIVE', 'reason': '시험 1485 LIVE'}, TS)
        nokr = call('PUT', '/admin/security/geo', {'allow': 'JP,US', 'reason': '시험 1485 KR 없음'}, TS)
        nob = call('PUT', '/admin/security/geo', {'block': True, 'reason': '시험 1485 막기 먼저'}, TS)
        on = call('PUT', '/admin/security/geo', {'watch': True, 'mode': 'ASSUME', 'assumeCountry': 'US', 'allow': 'KR', 'reason': '시험 1485 켬'}, TS)
        l1 = call('POST', '/auth/login', {'email': es, 'password': PW})
        e1 = psql(f"SELECT country || '|' || result || '|' || source FROM sec_geo_events WHERE account_id = '{asf}' AND id > {mark} ORDER BY id DESC LIMIT 1")
        a1 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_ABROAD' AND detail->>'accountId' = '{asf}' ORDER BY id DESC LIMIT 1")
        lb = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW})
        eb = psql(f"SELECT count(*) FROM sec_geo_events WHERE account_id = '{bid}' AND id > {mark}")
        blk = call('PUT', '/admin/security/geo', {'block': True, 'reason': '시험 1485 막기'}, TS)
        l2 = call('POST', '/auth/login', {'email': es, 'password': PW})
        e2 = psql(f"SELECT result FROM sec_geo_events WHERE account_id = '{asf}' AND id > {mark} ORDER BY id DESC LIMIT 1")
        a2 = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'STAFF_LOGIN_ABROAD_BLOCKED' AND detail->>'accountId' = '{asf}' ORDER BY id DESC LIMIT 1")
        allow = call('PUT', '/admin/security/geo', {'allow': 'KR,US', 'reason': '시험 1485 출장'}, TS)
        l3 = call('POST', '/auth/login', {'email': es, 'password': PW})
        e3 = psql(f"SELECT result FROM sec_geo_events WHERE account_id = '{asf}' AND id > {mark} ORDER BY id DESC LIMIT 1")
        tst = call('POST', '/admin/security/geo/test', {'ip': '8.8.8.8'}, TS)
        vw = call('GET', '/admin/security/geo', None, TS)
        dbu = psql(f"UPDATE sec_geo_events SET country = 'KR' WHERE account_id = '{asf}' AND id > {mark}")
        dbd = psql(f"DELETE FROM sec_geo_events WHERE account_id = '{asf}' AND id > {mark}")
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'sec-geo'")
        key_set = bool((v0.get('ready') or {}).get('keySet'))
        ok('② 해외 접속 — ADMIN 설정 403(보기는 됨) · LIVE 키 없음 422 · KR 없는 허용 422 · 경고 없이 막기 422 · 켜기(간주 US) · 운영자 로그인 통과 + 기록 US ALERT · 긴급 알림 · 회원 로그인은 기록 없음 · 막기 → 403 GEO_BLOCKED + BLOCKED · 경고 알림 · 허용 KR,US → 통과 OK · 판별 시험 US 허용 · 30일 경고 1 이상 · DB 고치기 · 지우기 막음 · 권한 주소 3',
           adm.get('_err') == 403 and 'settings' in v0 and (key_set or live.get('code') == 'GEO_NOT_READY') and nokr.get('code') == 'GEO_ALLOW_KR' and nob.get('code') == 'GEO_BLOCK_NEEDS_WATCH'
           and on.get('ok') is True and bool(l1.get('accessToken')) and e1 == 'US|ALERT|ASSUME' and a1 == 'CRITICAL' and bool(lb.get('accessToken')) and eb == '0'
           and blk.get('ok') is True and l2.get('_err') == 403 and l2.get('code') == 'GEO_BLOCKED' and e2 == 'BLOCKED' and a2 == 'WARN'
           and allow.get('ok') is True and bool(l3.get('accessToken')) and e3 == 'OK' and tst.get('country') == 'US' and tst.get('source') == 'ASSUME' and tst.get('allowed') is True
           and ((vw.get('days30') or {}).get('alert') or 0) >= 1 and 'SEC_GEO' in dbu and 'SEC_GEO' in dbd and rmap == '3',
           f"{adm.get('_err')} {'settings' in v0} {live.get('code')} {nokr.get('code')} {nob.get('code')} · {on.get('ok') or on} {bool(l1.get('accessToken'))} {e1} {a1} {bool(lb.get('accessToken'))} {eb} · {blk.get('ok')} {l2.get('_err')} {l2.get('code')} {e2} {a2} · {allow.get('ok')} {bool(l3.get('accessToken'))} {e3} · {tst} · {(vw.get('days30') or {}).get('alert')} · {dbu[-30:]} {dbd[-30:]} {rmap}")
    finally:
        call('PUT', '/admin/security/geo', {'watch': False, 'block': False, 'reason': '시험 1485 끔'}, TS)
        call('PUT', '/admin/security/geo', {'watch': s0['security.geo_watch'] == 'on', 'block': s0['security.geo_block'] == 'on' and s0['security.geo_watch'] == 'on',
                                            'assumeCountry': s0['security.geo_assume_country'] or 'KR', 'allow': s0['security.geo_allow'] or 'KR', 'reason': '시험 1485 되돌림'}, TS)
        if s0['security.geo_mode'] in ('ASSUME', 'LIVE'):
            call('PUT', '/admin/security/geo', {'mode': s0['security.geo_mode'], 'reason': '시험 1485 방식 되돌림'}, TS)
        psql(f"SET session_replication_role = replica; DELETE FROM sec_geo_events WHERE id > {mark} AND account_id IN ('{asf}', '{bid}'); "
             f"DELETE FROM ops_alerts WHERE alert_code IN ('STAFF_LOGIN_ABROAD', 'STAFF_LOGIN_ABROAD_BLOCKED') AND detail->>'accountId' = '{asf}';")
        rm_role(asf, '1485')
    if ADMIN_WEB:
        r = admin_page('/#/sec-geo', lambda pg, seen: seen.update(n=pg.locator('[data-sec-geo]').count(), on=pg.locator('[data-sec-geo-on]').get_attribute('data-sec-geo-on') if pg.locator('[data-sec-geo-on]').count() else None))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 위험감지 › 해외 접속 경고(켜짐 표시 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('on') in ('on', 'off') and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
