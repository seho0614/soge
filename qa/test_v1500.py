"""v10.500 (D272 · docs/638) 웹 접근성 도구 — 대표 11/20 「㊷ ④」
  ① (코드) 보기 설정(글자 크게 · 고대비 · 이 브라우저) · data 속성 · 토큰만 · 그리기 전 붙이기 · Esc · aria-pressed · 사전 ko · en · 문서 키보드 목록
  ② (API) 서버 설정 · 기록 없음
  ③ (사용자 웹 · SITE) 단추 · 아주 크게 · 유지 · 고대비 · 처음대로 · Esc
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
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로) — 빈 값은 NULL 로(무늬 트리거가 '' 를 막는 키가 있음)"""
    v = 'NULL' if value is None or value == '' else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def callh(m_, p, b=None, t=None, headers=None):
    """머리글을 더 붙여 부름(감시 토큰 등)"""
    hd = {'content-type': 'application/json', **(headers or {})}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def http_get(url):
    """사용자 웹 정적 파일 · 화면(상태 · 머리글 · 본문 앞 2만 자)"""
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0 qa'}), timeout=60)
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(200000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, {}, ''
    except Exception as e:
        return 0, {}, str(e)[:120]


STAMP = int(time.time()) % 1000000


# 새 토큰은 upt-tokens.css 로 옮김(sgb-tokens.css 는 디자인 시트 사본 그대로 · test_v1052 · 1067 · 1470) — 두 파일을 합쳐 봄
AT, AB, UC_, TK, LY = rd('site/src/components/upt/A11yTools.tsx'), rd('site/src/components/upt/A11yBoot.tsx'), rd('site/src/styles/upt.css'), (rd('site/src/styles/sgb-tokens.css') or '') + (rd('site/src/styles/upt-tokens.css') or ''), rd('site/src/app/layout.tsx')
try:
    KOJ = json.loads(rd('site/src/i18n/messages/ko.json') or '{}').get('upt') or {}
    ENJ = json.loads(rd('site/src/i18n/messages/en.json') or '{}').get('upt') or {}
except Exception:
    KOJ, ENJ = {}, {}
a11y_css = UC_.split('/* ── 보기 설정')[1] if '/* ── 보기 설정' in UC_ else ''
ok('① 코드 — 보기 설정(글자 크게 · 고대비) · html data-a11y-font · data-a11y-contrast · 이 브라우저만(localStorage · try) · Esc 로 닫고 단추로 · aria-pressed · 그리기 전 붙이기 · layout 연결 · CSS 는 토큰만(# 색 없음) · 새 토큰 · 사전 upt ko · en 같은 열쇠 · 글자 값만 · 문서 638 키보드 목록 · 판 v10.500',
   "setAttribute('data-a11y-font'" in AT and "setAttribute('data-a11y-contrast'" in AT and 'localStorage' in AT and 'catch' in AT and "e.key === 'Escape'" in AT and 'aria-pressed' in AT
   and "localStorage.getItem('sgb_a11y')" in AB and '<A11yBoot />' in LY and '<A11yTools />' in LY and "import '@/styles/upt.css'" in LY
   and "html[data-a11y-font='xl'] body { zoom: var(--sgb-a11y-zoom-xl); }" in UC_ and "html[data-a11y-contrast='high']" in UC_ and not re.search(r'#[0-9a-fA-F]{3,8}\b', UC_)
   and '--sgb-a11y-zoom-xl:' in TK and '--sgb-hc-ink:' in TK and '--sgb-kakao-bg:' in TK
   and len(KOJ) >= 100 and set(KOJ) == set(ENJ) and all(isinstance(v, str) for v in list(KOJ.values()) + list(ENJ.values())) and not any(re.search('[가-힣]', v) for v in ENJ.values())
   and '키보드 이동 점검 목록' in doc('638_') and VT >= (10, 500), f'{VER} ko {len(KOJ)} en {len(ENJ)}')

if API and DB:
    pub = call('GET', '/site-settings/public')
    ok('② 보기 설정은 서버 설정 · 기록이 없음(공개 설정에 a11y 키 없음)', isinstance(pub, dict) and not any(k.startswith('site.a11y') for k in pub), '')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if SITE:
    def run(b, seen, perr):
        pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
        pg.goto(SITE + '/', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
        seen['btn'] = pg.locator('[data-a11y-open]').count()
        if not seen['btn']:
            return
        pg.click('[data-a11y-open]'); pg.wait_for_timeout(300)
        pg.click('[data-a11y-font-set="xl"]'); pg.wait_for_timeout(300)
        seen['xl'] = pg.evaluate("document.documentElement.getAttribute('data-a11y-font')")
        pg.reload(wait_until='networkidle'); pg.wait_for_timeout(1000)
        seen['kept'] = pg.evaluate("document.documentElement.getAttribute('data-a11y-font')")
        pg.click('[data-a11y-open]'); pg.wait_for_timeout(300)
        pg.click('[data-a11y-contrast-set="high"]'); pg.wait_for_timeout(300)
        seen['hc'] = pg.evaluate("document.documentElement.getAttribute('data-a11y-contrast')")
        pg.click('[data-a11y-reset]'); pg.wait_for_timeout(300)
        seen['reset'] = pg.evaluate("[document.documentElement.getAttribute('data-a11y-font'), document.documentElement.getAttribute('data-a11y-contrast'), localStorage.getItem('sgb_a11y')].join('|')")
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        seen['esc'] = pg.locator('[data-a11y-tools]').first.get_attribute('data-a11y-tools')
        seen['focus'] = pg.evaluate("document.activeElement && document.activeElement.hasAttribute('data-a11y-open')")
    r = ui(run)
    if r is not None:
        seen, perr = r
        ok('③ 사용자 웹 — 보기 설정 단추 · 아주 크게 → data-a11y-font=xl · 새로 고침 뒤 유지 · 고대비 → high · 처음대로 → 없음(저장도 지움) · Esc 로 닫고 단추로',
           seen.get('btn') == 1 and seen.get('xl') == 'xl' and seen.get('kept') == 'xl' and seen.get('hc') == 'high' and seen.get('reset') == '||'
           and seen.get('esc') == 'closed' and seen.get('focus') is True and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
