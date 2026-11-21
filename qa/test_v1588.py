"""v10.588 (docs/730) 14차 운영 ④ 사용자 웹 느린 화면 측정(웹 바이탈) — 「회원 화면 사용 통계」(D274) 방식 그대로
  ① (코드) 받는 길 · 보기 · 사용자 웹 비컨 · layout · 탭 web-vitals · 켜기 SUPER · 표 검사 정규식 = 서버 정규식 · 문서 730
  ② (DB · API) 표 · 설정 · 권한 · 공개 설정 · 꺼짐 OFF · 켜면 넣음(주소 묶기 · 등급 서버) · DNT · 로봇 · 400 · 보기 · ADMIN 켜기 403
  ③ (화면) 화면 속도 탭
  (두 번 돌아도 통과 — /t1588x/ 줄은 시작 · 끝에 지움 · 스위치는 처음 값으로 · 만든 직원 역할은 거둠)
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


def beat(body, headers=None):
    hd = {'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (t1588)'}
    hd.update(headers or {})
    r = urllib.request.Request(API + '/site/vitals', data=json.dumps(body).encode(), headers=hd, method='POST')
    try:
        return json.loads(urllib.request.urlopen(r, timeout=60).read() or b'{}')
    except urllib.error.HTTPError as e:
        return {'_err': e.code}


MIG = allmig()
VT_ = rd('src/modules/ops2/vitals.ts')
SU = rd('src/modules/site/site-usage.ts')
WB = rd('site/src/components/common/WebVitalsBeacon.tsx')
LY = rd('site/src/app/layout.tsx')
MN = rd('web/src/lib/adminMenu.ts')
AP = rd('web/src/App.tsx')
AS = rd('src/modules/admin/admin.service.ts')
rx_srv = re.search(r"USAGE_PATH = /(.+?)/;", SU)
ok('① 코드 — 받는 길(normPath 재사용 · 등급은 서버) · 보기 · 사용자 웹 비컨(useReportWebVitals · DNT · GPC · 표본) · layout · 탭 web-vitals(TABS · PAGE · 위험감지 · 렌더) · 켜기 SUPER · 표 검사 정규식 = 서버 정규식 · 문서 730 · 판',
   "import { normPath } from '../site/site-usage'" in VT_ and 'ops2Rating' in VT_ and 'percentile_cont(0.75)' in VT_
   and "useReportWebVitals" in WB and 'doNotTrack' in WB and 'globalPrivacyControl' in WB and "'/api/v1/site/vitals'" in WB
   and '<WebVitalsBeacon settings={settings} />' in LY and "['web-vitals', '화면 속도']" in MN and "'web-vitals':" in MN and "'server-errors', ['web-vitals']" in MN
   and "{tab === 'web-vitals' && <Ops2WebVitals />}" in AP and "'ops2.web_vitals'" in AS
   and rx_srv is not None and ("path ~ '^" + rx_srv.group(1).lstrip('^').rstrip('$').replace('\\/', '/') + "$'") in MIG
   and 'ops2_vitals' in doc('730_') and VT >= (10, 588), f"{VER} {rx_srv.group(1) if rx_srv else None}")

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    CLEAN = "DELETE FROM ops2_vitals WHERE path LIKE '/t1588x/%';"
    psql(CLEAN)
    sw0 = getset('ops2.web_vitals')
    staff = None
    try:
        tbl = psql("SELECT count(*) FROM information_schema.tables WHERE table_name = 'ops2_vitals'")
        sets = psql("SELECT string_agg(key || '=' || coalesce(value, '') || ':' || scope, ',' ORDER BY key) FROM site_settings WHERE key LIKE 'ops2.web_vitals%'")
        pt = psql("SELECT count(*) FROM perm_tasks WHERE key = 'web-vitals' AND group_key = 'admrsk'")
        pm = psql("SELECT count(*) FROM perm_route_map WHERE pattern = '/admin/ops2/web-vitals' AND task_key = 'web-vitals'")
        pub = call('GET', '/site-settings/public')
        ok('② DB — 표 · 설정 셋(스위치 · 표본 GLOBAL · 보관 ADMIN) · 처음 off · 업무 web-vitals(위험감지) · 권한 주소 · 공개 설정에 스위치 · 표본',
           tbl == '1' and 'ops2.web_vitals=' in sets and ':GLOBAL' in sets and 'ops2.web_vitals_keep_days=' in sets and pt == '1' and pm == '1'
           and 'ops2.web_vitals' in pub and 'ops2.web_vitals_sample' in pub and 'ops2.web_vitals_keep_days' not in pub,
           f"{tbl} {sets} {pt} {pm} 처음 {sw0}")
        setting('ops2.web_vitals', 'off', '1588')
        b0 = beat({'p': f'/t1588x/{STAMP}', 'n': 'LCP', 'v': 5000})
        setting('ops2.web_vitals', 'on', '1588')
        b1 = beat({'p': f'/t1588x/{STAMP}?q=비밀', 'n': 'LCP', 'v': 5000})
        b2 = beat({'p': f'/t1588x/{STAMP}', 'n': 'CLS', 'v': 0.05})
        b3 = beat({'p': f'/t1588x/{STAMP}', 'n': 'INP', 'v': 300}, {'dnt': '1'})
        b4 = beat({'p': f'/t1588x/{STAMP}', 'n': 'FID', 'v': 10})
        b5 = beat({'p': f'/t1588x/{STAMP}', 'n': 'LCP', 'v': -1})
        b6 = beat({'p': '/admin/x', 'n': 'LCP', 'v': 100})
        b7 = beat({'p': f'/t1588x/{STAMP}', 'n': 'TTFB', 'v': 100}, {'user-agent': 'Googlebot/2.1'})
        rows = psql("SELECT string_agg(path || '|' || metric || '|' || value::float || '|' || rating, ',' ORDER BY metric) FROM ops2_vitals WHERE path LIKE '/t1588x/%'")
        ok('② 받기 — 꺼짐 OFF · 켜면 넣음(물음표 뒤 버림 · 번호는 :id · 등급은 서버 LCP 5000 POOR · CLS 0.05 GOOD) · DNT · 로봇 · 운영 주소는 안 넣음 · 모르는 지표 · 음수 400',
           b0.get('reason') == 'OFF' and b1.get('ok') is True and b2.get('ok') is True and b3.get('reason') == 'DNT' and b4.get('_err') == 400 and b5.get('_err') == 400
           and b6.get('reason') == 'PATH' and b7.get('reason') == 'BOT' and rows == '/t1588x/:id|CLS|0.05|GOOD,/t1588x/:id|LCP|5000|POOR',
           f"{b0} {b1} {b2} {b3} {b4} {b5} {b6} {b7} {rows}")
        v = call('GET', '/admin/ops2/web-vitals?days=1', None, TS)
        mine = next((x for x in v.get('paths') or [] if x.get('path') == '/t1588x/:id'), None)
        ok('② 보기 — 켜짐 · 지표 LCP · CLS · 화면 묶음 /t1588x/:id(LCP 75번째 5000) · 기준표',
           v.get('on') is True and {'LCP', 'CLS'} <= {m.get('metric') for m in v.get('metrics') or []} and mine is not None and float(mine.get('lcp') or 0) == 5000
           and v.get('thresholds', {}).get('LCP') == [2500, 4000], f"{v.get('on')} {[m.get('metric') for m in v.get('metrics') or []]} {mine}")
        setting('ops2.web_vitals', 'off', '1588')
        em, aid = mk_staff('1588', 'ADMIN')
        staff = aid
        tA = login(em)
        p1 = call('PATCH', '/admin/site-settings', {'key': 'ops2.web_vitals', 'value': 'on', 'reason': '시험 1588 켜기'}, tA)
        p2 = call('GET', '/admin/ops2/web-vitals?days=7', None, tA)
        ok('② 권한 — 운영(ADMIN)은 켜기 403(SUPER 만) · 보기는 됨', p1.get('_err') == 403 and isinstance(p2.get('metrics'), list), f"{p1.get('_err')} {p1.get('code')} {p2.get('_err')}")
    finally:
        psql(CLEAN)
        setting('ops2.web_vitals', sw0 or 'off', '1588 되돌림')
        if staff:
            rm_role(staff, '1588')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['page'] = pg.locator('[data-ops2-vitals]').count()
    s = admin_page('/#/web-vitals', chk)
    if s is not None:
        seen, perr = s
        ok('③ 화면 — 위험감지 › 화면 속도 그려짐 · 화면 오류 없음', seen.get('page', 0) >= 1 and not perr, f"{seen} {perr[:2]}")


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
