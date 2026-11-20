"""v10.512 (D275 · docs/650) 기능 스위치 한눈에 — 대표 11/20 「㊺ ④」 · 읽기만
  ① (코드) 스위치 판별(값 무늬 ^(갑|을)$ · on · off · ASSUME · LIVE · SHADOW 등) · 처음 값(켤 조건 표 → 가장 오래된 바뀐 기록 → 지금) · 켤 조건 표 시드(docs/594 4-3 · ㉛ ~ ㊹) · 읽기만 · 「전체 설정」으로 가는 길 · 화면 OPX-040 · 문서 650
  ② (API · DB) 회원 403 · 스위치 20개 넘음 · signup.open · opx.archive(꺼짐 · 켤 조건) · 고를 값이 모두 스위치 낱말 · 비밀 키 없음 · 처음과 다름 셈 · 고치기 API 없음
  ③ (화면) 정책 › 기능 스위치 한눈에
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


M75 = migr('D275_')
SW, OC, MN, AP, UI = (rd('src/modules/opx/switches.ts'), rd('src/modules/opx/opx.controller.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/Opx.tsx'))
ok('① 코드 — opx_switch_docs(처음 값 · 켤 조건 · 문서) 시드 · isSwitchPattern · 처음 값 순서 · 고치기 없음(GET 만) · 메뉴 정책 › 기능 스위치 한눈에 · 「전체 설정」 단추 · 화면 OPX-040 · 문서 650 · 판 v10.512',
   'CREATE TABLE IF NOT EXISTS public.opx_switch_docs' in M75 and "('signup.open', 'on'," in M75 and "('perm.enforce', 'SHADOW'," in M75 and "('opx.archive', 'off', '보관 폴더" in M75
   and 'export function isSwitchPattern' in SW and 'site_setting_changes' in SW and "@Get('switches')" in OC and "@Put('switches" not in OC and "@Post('switches" not in OC
   and "['opx-switches', '기능 스위치 한눈에']" in MN and "hrxAddTabs(GROUPS.find((g) => g.key === 'admpol')?.tabs, 'settings', ['opx-switches'])" in MN
   and "<OpxSwitches onGo=" in AP and 'data-opx-go-settings' in UI and '"SB-ADM-OPX-040"' in SJ and '켤 조건' in doc('650_') and VT >= (10, 512), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    mb = call('GET', '/admin/opx/switches', None, TB)
    sw = call('GET', '/admin/opx/switches', None, TS)
    items = sw.get('items') or []
    by = {x.get('key'): x for x in items}
    words = {'on', 'off', 'true', 'false', 'ASSUME', 'LIVE', 'SHADOW', 'ON', 'OFF'}
    so, oa = by.get('signup.open') or {}, by.get('opx.archive') or {}
    secret = [k for k in by if re.search(r'(^|[._])(secret|token|password|api_key)$', k or '')]
    cnt = psql("SELECT count(*) FROM opx_switch_docs")
    ok('② 기능 스위치 — 회원 403 · 20개 넘음 · signup.open(켤 조건) · opx.archive(처음 off · 켤 조건 · 문서 647) · 고를 값 모두 스위치 낱말 · 비밀 키 없음 · 처음과 다름 수 = 줄 수 · 켤 조건 표 60줄 넘음',
           mb.get('_err') == 403 and len(items) >= 20 and so.get('cond') and oa.get('initial') == 'off' and oa.get('cond') and '647' in str(oa.get('docRef'))
           and all(set(x.get('choices') or []) <= words and len(x.get('choices') or []) >= 2 for x in items) and not secret
           and (sw.get('counts') or {}).get('changed') == sum(1 for x in items if x.get('changed')) and int(cnt or 0) >= 60,
           f"{mb.get('_err')} {len(items)} {so.get('cond')} {oa.get('initial')} {oa.get('docRef')} {secret} {(sw.get('counts') or {})} {cnt}")
    if ADMIN_WEB:
        r = admin_page('/#/opx-switches', lambda pg, seen: seen.update(n=int(pg.get_attribute('[data-opx-switches]', 'data-opx-switches') or 0), rows=pg.locator('[data-opx-sw]').count(), go=pg.locator('[data-opx-go-settings]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 정책 › 기능 스위치 한눈에(줄 20 넘음 · 「전체 설정」 단추 · 화면 오류 없음)', seen.get('n', 0) >= 20 and seen.get('rows', 0) >= 20 and seen.get('go') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
