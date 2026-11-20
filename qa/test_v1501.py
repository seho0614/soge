"""v10.501 (D273 · docs/639) 최근 본 매물 · 상품 — 대표 11/20 「㊸ 회원 2 ①」
  ① (코드) mbx_recent_views · 개수 트리거 · 설정 mbx.recent(처음 off) · /me/recent · merge · 공개 스위치 · mbx_daily · 메뉴 · 화면 HOM-MBX-010 · 사용자 웹 /recent · 상세 줄 · 사전 · 문서 639
  ② (API · DB) 꺼짐 saved=false · 켜짐 적기 · 개수 넘침(설정 5) · 최근 순 · 횟수 · 404 · 400 · 403 · 하나 · 모두 지우기 · 합치기 건너뜀 · 422 · 운영 한눈에 — 시험 회원은 새로 만들고 기록은 지움(두 번 돌아도 같음)
  ③ (화면) 회원 › 회원 편의 기능 · 사용자 웹 /recent
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


def mk_member(tag):
    """시험 회원(본인인증 · MEMBER) — 이메일에 시각을 넣어 두 번 돌아도 새 사람"""
    em, aid = mk_staff(tag, 'MEMBER')
    import consent_ok
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M73 = migr('D273_')
stamp = int(time.time()) % 1000000
MB = {k: rd(f'src/modules/mbx/{k}.ts') for k in ('common', 'recent', 'compare', 'price', 'dm', 'jobs', 'mbx.controller')}
MN, AP, WC, SC = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/worker.controller.ts'), rd('src/worker/scheduler.service.ts')
KO = json.loads(rd('site/src/i18n/messages/ko/mbx.json') or '{}')
EN = json.loads(rd('site/src/i18n/messages/en/mbx.json') or '{}')

ok('① 코드 — D273 mbx_recent_views(회원 · 대상 고유) · 개수 트리거 trg_mbx_recent_trim · 설정 mbx.recent off · recent_max 20 · keep 90 · API /me/recent · merge · 공개 /site/mbx/switches · 정기 작업 mbx_daily · 메뉴 mbx-ops · 화면 HOM-MBX-010 · 사용자 웹 /recent · 상세 줄 MbxItemTools · 사전 mbx.recent · 문서 639 · 판 v10.501',
   'CREATE TABLE IF NOT EXISTS public.mbx_recent_views' in M73 and 'trg_mbx_recent_trim' in M73 and "('mbx.recent', 'off'" in M73 and "('mbx.recent_max', '20'" in M73
   and "('mbx.recent_keep_days', '90'" in M73 and "('mbx_daily', 1440, 4, 35" in M73
   and "@Get('me/recent')" in MB['mbx.controller'] and "@Post('me/recent/merge')" in MB['mbx.controller'] and "@Get('site/mbx/switches')" in MB['mbx.controller']
   and 'export async function purgeRecent' in MB['recent'] and "'mbx_daily'," in WC and "case 'mbx_daily'" in SC
   and "['mbx-ops', '회원 편의 기능']" in MN and "{tab === 'mbx-ops' && <MbxOps />}" in AP and '"SB-HOM-MBX-010"' in SJ
   and 'data-screen="SB-HOM-MBX-010"' in rd('site/src/app/recent/page.tsx') and 'MbxItemTools' in rd('site/src/app/[gwan]/[id]/page.tsx')
   and 'MbxItemTools' in rd('site/src/app/health/p/[code]/page.tsx') and 'memberNote' in (KO.get('recent') or {}) and 'memberNote' in (EN.get('recent') or {})
   and '처리방침 고칠 곳' in doc('639_') and VT >= (10, 501), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid, TM = mk_member('1501')
    old = {k: getset(k) for k in ('mbx.recent', 'mbx.recent_max')}
    try:
        L = [x for x in psql(f"SELECT id FROM listings WHERE status = 'PUBLISHED' AND owner_account_id <> '{aid}' ORDER BY published_at DESC NULLS LAST, id LIMIT 6").split('\n') if x]
        P = psql("SELECT code FROM hlt_products WHERE status IN ('ON_SALE', 'SOLD_OUT') ORDER BY code LIMIT 1")
        setting('mbx.recent', 'off', '1501')
        sw0 = call('GET', '/site/mbx/switches')
        off = call('POST', '/me/recent', {'type': 'LISTING', 'key': L[0] if L else '00000000-0000-0000-0000-000000000000'}, TM)
        g0 = call('GET', '/me/recent', None, TM)
        setting('mbx.recent', 'on', '1501'); setting('mbx.recent_max', '5', '1501')
        sw1 = call('GET', '/site/mbx/switches')
        saved = [call('POST', '/me/recent', {'type': 'LISTING', 'key': x}, TM).get('saved') for x in L]
        if P:
            saved.append(call('POST', '/me/recent', {'type': 'PRODUCT', 'key': P}, TM).get('saved'))
        rows = int(psql(f"SELECT count(*) FROM mbx_recent_views WHERE account_id = '{aid}'") or 0)
        g1 = call('GET', '/me/recent', None, TM)
        items = g1.get('items') or []
        newest = (items[0] if items else {}).get('key')
        again = call('POST', '/me/recent', {'type': 'LISTING', 'key': L[-1]}, TM) if L else {}
        cnt = psql(f"SELECT coalesce(max(view_count), 0) FROM mbx_recent_views WHERE account_id = '{aid}' AND target_type = 'LISTING'")
        nf = call('POST', '/me/recent', {'type': 'LISTING', 'key': '00000000-0000-4000-8000-000000000000'}, TM)
        bt = call('POST', '/me/recent', {'type': 'NOPE', 'key': 'x'}, TM)
        guest = call('GET', '/me/recent')
        rm = call('DELETE', f"/me/recent/LISTING/{L[-1]}", None, TM) if L else {}
        future = (datetime.datetime.utcnow() + datetime.timedelta(days=3)).isoformat() + 'Z'
        mg = call('POST', '/me/recent/merge', {'items': [{'type': 'LISTING', 'key': L[0]}, {'type': 'LISTING', 'key': 'not-a-uuid'}, {'type': 'LISTING', 'key': L[0], 'at': future}]}, TM) if L else {}
        many = call('POST', '/me/recent/merge', {'items': [{'type': 'LISTING', 'key': L[0]}] * 6}, TM) if L else {}
        cl = call('DELETE', '/me/recent', None, TM)
        g2 = call('GET', '/me/recent', None, TM)
        ok('② 최근 본 — 꺼짐 saved=false · 목록 비활성 · 켜짐 스위치 · 적기 · 개수 넘침 트리거(5) · 최근 순 · 같은 것 횟수 +1 · 없는 것 404 · 종류 400 · 로그인 없이 403 · 하나 지우기 · 합치기(건너뜀 2) · 너무 많음 422 · 모두 지우기',
           sw0.get('recent') is False and off.get('saved') is False and g0.get('enabled') is False and sw1.get('recent') is True and len(L) >= 2
           and all(s is True for s in saved) and rows == min(5, len(saved)) and (newest == P if P else newest == L[-1]) and again.get('saved') is True and int(cnt or 0) >= 2
           and nf.get('_err') == 404 and bt.get('_err') == 400 and guest.get('_err') in (401, 403) and rm.get('removed') == 1
           and mg.get('saved') == 1 and mg.get('skipped') == 2 and many.get('code') == 'MBX_RECENT_MANY' and cl.get('ok') is True and (g2.get('items') or []) == [],
           f"{sw0.get('recent')} {off} {g0.get('enabled')} {sw1.get('recent')} L{len(L)} {saved} rows {rows} newest {str(newest)[:8]} {again.get('saved')} cnt {cnt} · "
           f"{nf.get('_err')} {bt.get('_err')} {guest.get('_err')} {rm} · {mg} {many.get('code')} {cl.get('ok')} {len(g2.get('items') or [])}")
        ov = call('GET', '/admin/mbx/overview', None, TS)
        ok('② 운영 한눈에 — 스위치 · 설정 · 수 · 정기 작업', (ov.get('settings') or {}).get('recent') is True and 'recentRows' in (ov.get('counts') or {}) and (ov.get('jobs') or {}).get('purge') == '매일 04:35',
           f"{(ov.get('settings') or {}).get('recent')} {list((ov.get('counts') or {}).keys())[:3]}")
    finally:
        psql(f"DELETE FROM mbx_recent_views WHERE account_id = '{aid}'")
        for k, v in old.items():
            setting(k, v, '1501 되돌림')
        rm_role(aid, '1501')
    if ADMIN_WEB:
        r = admin_page('/#/mbx-ops', lambda pg, seen: seen.update(n=pg.locator('[data-mbx-ops="loaded"]').count(), sw=pg.locator('[data-mbx-switch]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 회원 편의 기능(스위치 4 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('sw') == 4 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        def run(b, seen, perr):
            pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
            pg.goto(SITE + '/recent', wait_until='networkidle', timeout=120000)
            seen['scr'] = pg.locator('[data-screen="SB-HOM-MBX-010"]').count()
            seen['state'] = pg.locator('[data-mbx-recent-off], [data-mbx-recent-where="browser"]').count()
        r = ui(run)
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 사용자 웹 /recent(로그인 전 · 꺼짐 안내 또는 이 브라우저 목록)', seen.get('scr') == 1 and seen.get('state') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
