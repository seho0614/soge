"""v10.470 (docs/608) 운영 화면 다크 모드 — 대표 11/20 ㉞ 「운영 화면만 어두운 테마 · 상단바 해 · 달 단추」
  ① (코드) ThemeToggle(이 브라우저에만 sgb.admTheme · try/catch · 처음 밝게 · <html data-theme>) · 상단바 「사용자 화면으로」 앞 · main.tsx 첫 그림 전 initTheme
     · tokens.css :root[data-theme='dark'] 색 단계 · 글자 대비 4.5 이상(토큰 값으로 셈) · app.css 다크 묶음은 # 색 없이 토큰만 · sgb-tokens · sgb-buttons 는 사용자 웹 사본 그대로
     · 사용자 웹(site/)은 다크 모드 코드 없음 · 문서 608
  ② (화면) 처음 밝게 → 단추 → data-theme=dark · 저장 · 바탕색이 바뀜 · 본문 글자 대비 4.5 이상 · 새로 고쳐도 어둡게 · 다시 누르면 밝게(처음 바탕색) · 화면 오류 없음
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



def hx(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(rgb):
    c = [x / 255 for x in rgb]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def cr(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)


def rgb_css(s):
    """getComputedStyle 의 'rgb(1, 2, 3)' · 'rgba(1, 2, 3, 1)' → (1, 2, 3)"""
    m = re.findall(r'[\d.]+', s or '')
    return tuple(int(float(x)) for x in m[:3]) if len(m) >= 3 else None


# ── ① 코드 ──
TT, APP, MAIN = rd('web/src/components/ThemeToggle.tsx'), rd('web/src/App.tsx'), rd('web/src/main.tsx')
TK, CSS = rd('web/src/styles/tokens.css'), rd('web/src/styles/app.css')
ok('① ThemeToggle — 열쇠 sgb.admTheme · 저장 읽기 · 쓰기 try/catch · 처음 밝게 · <html data-theme> · 단추 표식 data-theme-toggle',
   "THEME_KEY = 'sgb.admTheme'" in TT and TT.count('try {') >= 2 and "=== 'dark' ? 'dark' : 'light'" in TT and 'document.documentElement.dataset.theme = t' in TT
   and 'data-theme-toggle={theme}' in TT and 'export function initTheme' in TT and 'prefers-color-scheme' not in TT, '')
i_t, i_s = APP.find('<ThemeToggle />'), APP.find('>사용자 화면으로</a>')
ok('① 상단바 오른쪽(.ad-hr) 「사용자 화면으로」 바로 앞 · import', "import { ThemeToggle } from './components/ThemeToggle';" in APP
   and 0 < APP.find('className="ad-hr"') < i_t < i_s, f'{i_t} < {i_s}')
ok('① main.tsx — 첫 그림(createRoot) 전에 initTheme() · 디자인 시트 읽는 순서 그대로', 0 < MAIN.find('initTheme();') < MAIN.find('createRoot(')
   and 0 <= MAIN.find("'./styles/sgb-tokens.css'") < MAIN.find("'./styles/admin-fonts.css'") < MAIN.find("'./styles/tokens.css'"), '')
DK = TK[TK.find(":root[data-theme='dark'] {"):] if ":root[data-theme='dark'] {" in TK else ''
DK = DK[:DK.find('\n}') + 2]
tv = lambda n: (re.search(re.escape(n) + r':\s*(#[0-9a-fA-F]{6})', DK) or [None, None])[1]
need = ['--sgb-bg', '--paper', '--surface', '--g100', '--sgb-ink', '--sgb-ink-2', '--sgb-ink-3', '--sgb-line', '--sgb-navy', '--sgb-on-point', '--sgb-point-l',
        '--sgb-link', '--sgb-gr-text', '--sgb-rd-text', '--sgb-or-text', '--st-warn-bg', '--st-bad-bg', '--st-ok-bg', '--ahd']
miss = [n for n in need if not tv(n)]
ok("① tokens.css — :root[data-theme='dark'] 색 단계(바탕 · 카드 · 옅은 칸 · 글자 3단 · 선 · 밝은 남색 · 상태 색 · 상태 칸 · 상단바 어둡게) · color-scheme",
   DK and not miss and 'color-scheme: dark' in DK, str(miss))
low = {}
if not miss:
    bgs = ['--sgb-bg', '--paper', '--surface', '--g100', '--sgb-point-l', '--st-warn-bg', '--st-bad-bg', '--st-ok-bg']
    for t in ['--sgb-ink', '--sgb-ink-2', '--sgb-ink-3', '--sgb-navy', '--sgb-link', '--sgb-gr-text', '--sgb-rd-text', '--sgb-or-text']:
        for b in bgs:
            v = cr(hx(tv(t)), hx(tv(b)))
            if v < 4.5: low[f'{t}/{b}'] = round(v, 2)
    for a, b in (('--sgb-on-point', '--sgb-navy'), ('--paper', '--sgb-navy'), ('--sgb-on-point', '--sgb-gr-text'), ('--paper', '--sgb-ink')):
        v = cr(hx(tv(a)), hx(tv(b)))
        if v < 4.5: low[f'{a}/{b}'] = round(v, 2)
    mn = min(cr(hx(tv('--sgb-ink-3')), hx(tv(b))) for b in bgs)
ok('① 대비 — 글자 · 강조 · 상태 색이 다크 바탕 · 카드 · 옅은 칸 · 상태 칸 모두 4.5 이상 · 밝은 남색 위 단추 글자도', not miss and not low,
   str(low) if low else (f'흐린 글자 최저 {mn:.2f}' if not miss else ''))
blk = CSS[CSS.find('v10.112 운영 로그인'):] if 'v10.112 운영 로그인' in CSS else ''
dblk = CSS[CSS.find('v10.470 (docs/608) 운영 화면 다크 모드'):] if 'v10.470 (docs/608) 운영 화면 다크 모드' in CSS else ''
fs = [v for v in re.findall(r'font-size:\s*([\d.]+)px', dblk) if v not in {'12', '13', '14', '16', '18', '20', '24', '30'}]
ok('① app.css 다크 묶음 — 무게 0 앞머리 :where(:root[data-theme=dark]) · # 색 없음(로그인 뒤 전체) · 흰 칸 · 상태 칸 · 밝은 강조 위 글자 · 상단바 「☰ 메뉴」 · 글자 크기 시트 단계',
   dblk and ":where(:root[data-theme='dark']) .card" in dblk and ':where(.bo-main)' in dblk and 'var(--st-warn-bg)' in dblk and 'var(--st-bad-bg)' in dblk
   and 'var(--st-ok-bg)' in dblk and 'color: var(--sgb-on-point)' in dblk and '.ad-tr-tg { color: var(--ahd-fg); }' in dblk
   and not re.search(r'#[0-9a-fA-F]{3,8}\b', blk) and not fs and not re.search(r'^\.btn-', dblk, re.M), str(fs))
ok('① 디자인 시트 · 단추 사본은 사용자 웹과 글자 그대로(고치지 않음) · 옛 단추 줄 그대로',
   rd('web/src/styles/sgb-tokens.css') and rd('web/src/styles/sgb-tokens.css') == rd('site/src/styles/sgb-tokens.css')
   and rd('web/src/styles/sgb-buttons.css') == rd('site/src/styles/sgb-buttons.css')
   and '.btn-no { background: #fff; color: var(--danger); border-color: var(--danger); }' in CSS and '.ad-bg.hi { background: var(--sgb-gr-text); color: #fff;' in CSS, '')
site_hit = []
for dp, _, fs_ in os.walk(os.path.join(K, 'site/src')):
    for f in fs_:
        if f.endswith(('.ts', '.tsx')):
            s = open(os.path.join(dp, f), encoding='utf-8', errors='ignore').read()
            if 'sgb.admTheme' in s or 'ThemeToggle' in s: site_hit.append(f)
ok('① 사용자 웹(site/) — 운영 다크 모드 코드 없음', not site_hit, str(site_hit[:3]))
ok('① 화면 코드 숫자 색 → 토큰(펼친 줄 3곳 · 추천 관계도 칸)', "'#FAFBFD'" not in rd('web/src/app/admin/Collect.tsx') + rd('web/src/app/admin/ReportQueue.tsx') + rd('web/src/app/admin/Events.tsx')
   and "'#fff'" not in rd('web/src/app/admin/affiliates/RcmGraph.tsx') and "'#fff3d6'" not in rd('web/src/app/admin/affiliates/RcmGraph.tsx'), '')
ok('① 문서 608 · 판 v10.470 이상', '다크 모드' in doc('608_') and VT >= (10, 470), VER)

# ── ② 화면 ──
if ADMIN_WEB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    JS_BG = "() => ({theme: document.documentElement.dataset.theme || '', body: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color, " \
            "tree: (document.querySelector('.ad-tree') ? getComputedStyle(document.querySelector('.ad-tree')).backgroundColor : ''), " \
            "saved: (() => { try { return localStorage.getItem('sgb.admTheme') || ''; } catch (e) { return '?'; } })(), btn: document.querySelectorAll('[data-theme-toggle]').length})"

    def chk(pg, seen):
        pg.wait_for_selector('[data-theme-toggle]', timeout=30000)
        seen['a'] = pg.evaluate(JS_BG)
        pg.click('[data-theme-toggle]'); pg.wait_for_timeout(500)
        seen['b'] = pg.evaluate(JS_BG)
        pg.reload(wait_until='networkidle', timeout=120000); pg.wait_for_selector('[data-theme-toggle]', timeout=30000); pg.wait_for_timeout(800)
        seen['c'] = pg.evaluate(JS_BG)
        pg.click('[data-theme-toggle]'); pg.wait_for_timeout(500)
        seen['d'] = pg.evaluate(JS_BG)
        try: pg.screenshot(path=os.path.join(os.environ.get('SGB_QA_OUT', '.'), 'v1470_light_again.png'))
        except Exception: pass
    res = admin_page('/#/home', chk)
    if res is None: print('  (playwright 없음 — ② 건너뜀)')
    else:
        seen, perr = res
        a, b, c, d = (seen.get(k) or {} for k in 'abcd')
        ok('② 처음 밝게 · 단추 하나', a.get('theme') == 'light' and a.get('btn') == 1 and a.get('saved') in ('', 'light'), str(a))
        bi, bb = rgb_css(b.get('ink')), rgb_css(b.get('body'))
        con = cr(bi, bb) if bi and bb else 0
        ok('② 누르면 data-theme=dark · 이 브라우저에 저장 · 화면 바탕 · 트리 바탕이 바뀜 · 본문 글자 대비 4.5 이상',
           b.get('theme') == 'dark' and b.get('saved') == 'dark' and b.get('body') != a.get('body') and b.get('tree') != a.get('tree') and con >= 4.5,
           f"{b} 대비 {con:.2f}")
        ok('② 새로 고쳐도 어둡게(같은 바탕)', c.get('theme') == 'dark' and c.get('body') == b.get('body'), str(c))
        ok('② 다시 누르면 밝게 · 처음 바탕색 · 저장 light · 화면 오류 없음', d.get('theme') == 'light' and d.get('saved') == 'light'
           and d.get('body') == a.get('body') and d.get('tree') == a.get('tree') and not perr, f"{d} {perr[:2]}")
else:
    print('  (화면 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
