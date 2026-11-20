"""v10.508 (docs/646) 회원 화면 사용 통계 — 대표 11/20 「㊹ ④」
  ① (코드) D274 site_usage_daily · site_usage_goals(개인 식별 칸 없음) · 더하기 함수 · 공개 beat · DNT · GPC · 로봇 · UsageBeacon(쿠키 없음) · 메뉴 · 화면 · 문서 646
  ② (API · DB) 꺼짐 · 첫 화면 · 이어 봄 · :id 묶음 · 물음표 뒤 버림 · 전환 · 받지 않는 경우 · 칸 목록 · 주소 CHECK · 표본 보정 · 운영 보기
  ③ (화면) 통합 현황 › 화면 사용 통계
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


def beat(body, ua='Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36', extra=None):
    """POST /site/usage/beat — 사람 브라우저처럼(로그인 없이) · 응답 본문 · 오류 코드"""
    hd = {'content-type': 'application/json', 'user-agent': ua, **(extra or {})}
    r = urllib.request.Request(API + '/site/usage/beat', data=json.dumps(body).encode(), headers=hd, method='POST')
    try:
        return json.loads(urllib.request.urlopen(r, timeout=60).read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


M74 = migr('D274_')
stamp = int(time.time()) % 1000000
SU, SC, BC, LY, UI, MN, AP, DOC = (rd('src/modules/site/site-usage.ts'), rd('src/modules/site/site-usage.controller.ts'), rd('site/src/components/common/UsageBeacon.tsx'),
                                   rd('site/src/app/layout.tsx'), rd('web/src/app/admin/SiteUsage.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), doc('646_'))

ok('① 코드 — D274 하루 × 주소 묶음 표(계정 · IP · 브라우저 칸 없음) · 주소 정규식 = 서버 · 전환 표 · 더하기 함수(주소 상한 /_other) · site.usage_stats off · 표본 · 보관 · 공개 /site/usage/beat · DNT · GPC · 로봇 · 쿠키 없음 · layout UsageBeacon · 메뉴 site-usage · 화면 MLX-040 · 문서 646(쿠키 동의 · 처리방침 고칠 곳 · 법무) · 판 v10.508',
   'CREATE TABLE IF NOT EXISTS public.site_usage_daily' in M74 and 'CREATE TABLE IF NOT EXISTS public.site_usage_goals' in M74 and "CHECK (path ~ '^/[A-Za-z0-9/_:.-]{0,119}$')" in M74
   and r"/^\/[A-Za-z0-9/_:.-]{0,119}$/" in SU and 'FUNCTION public.fn_site_usage_add' in M74 and "'/_other'" in M74 and "('site.usage_stats', 'off', 'GLOBAL'" in M74
   and "('site.usage_sample', '100', 'GLOBAL'" in M74 and "('site.usage_keep_days', '400'" in M74 and "@Post('site/usage/beat')" in SC and "h.dnt === '1' || h.gpc === '1'" in SU
   and 'BOT_UA' in SU and 'document.cookie' not in BC and 'sessionStorage' in BC and 'doNotTrack' in BC and '<UsageBeacon settings={settings} />' in LY
   and "['site-usage', '화면 사용 통계']" in MN and "{tab === 'site-usage' && <SiteUsage />}" in AP and 'export function SiteUsage' in UI
   and '"SB-ADM-MLX-040"' in SJ and '"SB-HOM-MLX-030"' in SJ and '쿠키' in DOC and '처리방침 고칠 곳' in DOC and '법무' in DOC and VT >= (10, 508), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('site.usage_stats', 'site.usage_sample')
    s0 = {k: getset(k) for k in keys}
    CLEAN = "SET session_replication_role = replica; DELETE FROM site_usage_daily WHERE path LIKE '/qa1508%'; DELETE FROM site_usage_goals WHERE entry_path LIKE '/qa1508%';"
    day = psql("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date")
    try:
        psql(CLEAN)
        setting('site.usage_stats', 'off', '1508'); setting('site.usage_sample', '100', '1508')
        b0 = beat({'p': '/qa1508/a'})
        setting('site.usage_stats', 'on', '1508')
        b1 = beat({'p': '/qa1508/a?q=개인검색어'})
        b2 = beat({'p': '/qa1508/b', 'e': '/qa1508/a', 's': True})
        b3 = beat({'p': '/qa1508/b/3f0c1d2e-1111-4222-8333-444455556666', 'e': '/qa1508/a', 'g': 'SIGNUP'})
        b4 = beat({'p': '/qa1508/p/OMEGA3-60X'})
        bd = beat({'p': '/qa1508/a'}, extra={'dnt': '1'})
        bg = beat({'p': '/qa1508/a'}, extra={'sec-gpc': '1'})
        bb = beat({'p': '/qa1508/a'}, ua='Googlebot/2.1')
        ba = beat({'p': '/admin/x'})
        bx = beat({'p': '/qa1508/a', 'g': 'NOPE'})
        ra = psql(f"SELECT views || '|' || entries || '|' || engaged FROM site_usage_daily WHERE day = '{day}' AND path = '/qa1508/a'")
        rb = psql(f"SELECT views || '|' || entries || '|' || engaged FROM site_usage_daily WHERE day = '{day}' AND path = '/qa1508/b'")
        rid = psql(f"SELECT count(*) FROM site_usage_daily WHERE day = '{day}' AND path IN ('/qa1508/b/:id', '/qa1508/p/:id')")
        rg = psql(f"SELECT n FROM site_usage_goals WHERE day = '{day}' AND goal = 'SIGNUP' AND entry_path = '/qa1508/a'")
        cols = psql("SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('site_usage_daily', 'site_usage_goals')")
        badp = psql(f"INSERT INTO site_usage_daily (day, path) VALUES ('{day}', '/qa1508 bad')")
        setting('site.usage_sample', '50', '1508')
        beat({'p': '/qa1508/c'})
        est = psql(f"SELECT est_views FROM site_usage_daily WHERE day = '{day}' AND path = '/qa1508/c'")
        setting('site.usage_sample', '100', '1508')
        v403 = call('GET', '/admin/site-usage?days=1', None, None)
        v = call('GET', '/admin/site-usage?days=1', None, TS)
        pa = next((x for x in (v.get('paths') or []) if x.get('path') == '/qa1508/a'), {})
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'site-usage'")
        ok('② 사용 통계 — 꺼짐 ok:false · 첫 화면 · 둘째 화면(이어 봄) · uuid · 상품 코드는 :id · 물음표 뒤 버림 · 전환 SIGNUP · DNT · GPC · 로봇 · 운영 주소 받지 않음 · 틀린 목표 400 · a = 보기 1 · 첫 1 · 이어 봄 1 · b = 1 · 0 · 0 · 전환 1 · 칸에 계정 · IP · 브라우저 없음 · 주소 CHECK · 표본 50 → 추정 2 · 로그인 없이 운영 403 · 운영 보기 이탈 0 · 권한 주소 1',
           b0.get('ok') is False and b0.get('reason') == 'OFF' and b1.get('ok') is True and b2.get('ok') is True and b3.get('ok') is True and b4.get('ok') is True
           and bd.get('reason') == 'DNT' and bg.get('reason') == 'DNT' and bb.get('reason') == 'BOT' and ba.get('reason') == 'PATH' and bx.get('_err') == 400
           and ra == '1|1|1' and rb == '1|0|0' and rid == '2' and rg == '1'
           and sorted(cols.split(',')) == sorted(['day', 'day', 'engaged', 'entries', 'entry_path', 'est_views', 'goal', 'n', 'path', 'views']) and '!' in badp and est == '2.00'
           and v403.get('_err') in (401, 403) and v.get('on') is True and str(pa.get('bouncePct')) in ('0', '0.0') and rmap == '1',
           f"{b0} {b1} {b2} {b3} {b4} · {bd.get('reason')} {bg.get('reason')} {bb.get('reason')} {ba.get('reason')} {bx.get('_err')} · {ra} {rb} {rid} {rg} · {cols} {badp[-40:]} {est} · {v403.get('_err')} {v.get('on')} {pa} {rmap}")
    finally:
        psql(CLEAN)
        for k, x in s0.items():
            setting(k, x or None, '1508 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/site-usage', lambda pg, seen: seen.update(n=pg.locator('[data-site-usage]').count(), d=pg.locator('[data-usage-days]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 통합 현황 › 화면 사용 통계(기간 단추 4 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('d') == 4 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
