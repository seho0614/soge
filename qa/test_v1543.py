"""v10.543 (docs/681) 지도 매물 묶음 — 대표 11/20 「(54) ② 지도 매물 묶음」
  ① (코드) 공개 API GET /listings/map/clusters(@Roles 없음 · check-acl 공개 구역 listings) · 단계별 SIDO · SGG · GRID · LIST · OFF · 묶음 가운데 · 수만 · 격자 2km 넘음 · 최소 수 합침 · 설정 3 · 운영 미리보기 · 메뉴 vsx-map · 화면 VSX-020 · 문서 681
  ② (API · DB) 꺼짐 OFF · 켜고 단계 12 · 8 · 3(격자 꺼짐) · 응답 칸은 key · label · lat · lng · n 뿐 · 단계 0 400 · 범위 셋만 422 · 운영 미리보기 · 격자 켜고 범위(GRID 또는 LIST)
  ③ (화면) 검수 › 지도 매물 묶음
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


M84 = migr('D284_')
CT, ST = rd('src/modules/vsx/vsx.controller.ts'), rd('src/modules/vsx/vsx-settings.ts')
UI, MN, AP = rd('web/src/app/admin/Vsx.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
KOJ = rd('site/src/i18n/messages/ko/vsx.json')
ENJ = rd('site/src/i18n/messages/en/vsx.json')

MC = rd('src/modules/vsx/map-clusters.ts')
ACL = rd('scripts/check-acl.js')

ok('① 코드 — 공개 API(@Roles 없음 · listings 공개 구역) · SIDO · SGG · GRID · LIST · OFF · 격자 0.02도 넘음 · 최소 수 합침 · 매물 id · 주소 없음 · map.cluster_enabled · map.cluster_grid off · map.cluster_min 3 · 운영 미리보기 · 메뉴 vsx-map · 화면 VSX-020 · 문서 681 · 판 v10.543',
   "@Controller('api/v1/listings')" in CT and "@Get('map/clusters')" in CT and 'export class VsxMapController' in CT and "'listings'" in ACL
   and "mode: 'SIDO'" in MC and "mode: 'SGG'" in MC and "mode: 'GRID'" in MC and "mode: 'LIST'" in MC and "mode: 'OFF'" in MC and 'MAP_MIN_CELL = 0.02' in MC
   and 'listing_geo' in MC and '(gy + 0.5) * cell' in MC and "('map.cluster_enabled', 'off'" in M84 and "('map.cluster_grid', 'off'" in M84 and "('map.cluster_min', '3'" in M84
   and "@Get('map')" in CT and 'export function VsxMap' in UI and "['vsx-map', '지도 매물 묶음']" in MN and "{tab === 'vsx-map' && <VsxMap />}" in AP
   and '"SB-ADM-VSX-020"' in SJ and '"GET /listings/map/clusters"' in SJ and 'A안' in doc('681_') and VT >= (10, 543), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    old_on, old_grid = getset('map.cluster_enabled'), getset('map.cluster_grid')
    try:
        setting('map.cluster_enabled', 'off', '1543')
        off = call('GET', '/listings/map/clusters?level=12')
        setting('map.cluster_enabled', 'on', '1543')
        setting('map.cluster_grid', 'off', '1543')
        l12 = call('GET', '/listings/map/clusters?level=12')
        l8 = call('GET', '/listings/map/clusters?level=8&gwan=MAL')
        l3 = call('GET', '/listings/map/clusters?level=3&swLat=37.4&swLng=126.8&neLat=37.7&neLng=127.2')
        bad = call('GET', '/listings/map/clusters?level=0')
        bb = call('GET', '/listings/map/clusters?level=8&swLat=37.4&swLng=126.8&neLat=37.7')
        pv = call('GET', '/admin/vsx/map?level=8', None, TS)
        setting('map.cluster_grid', 'on', '1543')
        g3 = call('GET', '/listings/map/clusters?level=3&swLat=37.4&swLng=126.8&neLat=37.7&neLng=127.2')
        keys = set()
        for r in (l12, l8, l3, g3):
            for it in (r.get('items') or []):
                keys |= set(it.keys())
        ok('② 지도 묶음 — 꺼짐 OFF · 단계 12 SIDO(또는 LIST) · 8 SGG(또는 LIST) · 3 격자 꺼짐 SGG(또는 LIST) · 칸은 key · label · lat · lng · n 뿐(매물 id · 주소 없음) · 단계 0 400 · 범위 셋만 422 MAP_BBOX · 운영 미리보기 · 격자 켜고 GRID(또는 LIST)',
           off.get('enabled') is False and off.get('mode') == 'OFF' and l12.get('mode') in ('SIDO', 'LIST') and l8.get('mode') in ('SGG', 'LIST') and l3.get('mode') in ('SGG', 'LIST')
           and keys <= {'key', 'label', 'lat', 'lng', 'n'} and bad.get('_err') == 400 and bb.get('_err') == 422 and bb.get('code') == 'MAP_BBOX'
           and (pv.get('preview') or {}).get('mode') in ('SGG', 'LIST') and 'settings' in pv and g3.get('mode') in ('GRID', 'LIST'),
           f"{off.get('mode')} · {l12.get('mode')} {l8.get('mode')} {l3.get('mode')} · {sorted(keys)} · {bad.get('_err')} {bb.get('code')} · {(pv.get('preview') or {}).get('mode')} · {g3.get('mode')} {g3.get('merged')}")
        if ADMIN_WEB:
            r = admin_page('/#/vsx-map', lambda pg, seen: seen.update(n=pg.locator('[data-vsx-map]').count(), m=pg.locator('[data-vsx-map-mode]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 검수 › 지도 매물 묶음(미리보기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('m') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        setting('map.cluster_enabled', old_on or 'off', '1543 되돌림')
        setting('map.cluster_grid', old_grid or 'off', '1543 되돌림')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
