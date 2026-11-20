"""v10.502 (D273 · docs/640) 비교하기 — 대표 11/20 「㊸ 회원 2 ②」
  ① (코드) GET /site/mbx/compare(최대 4 · 공개 칸만 · 표 없음) · 설정 mbx.compare(처음 off) · 오류 코드 · 화면 HOM-MBX-020 · 사용자 웹 /compare · 사전 칸 23 · 문서 640
  ② (API · DB) 꺼짐 · 매물 2개(순서 · 빠진 수 · 개인정보 칸 없음) · 5개 · 형식 · 비어 있음 · 종류 422 · 상품 비교 — 읽기만(설정은 되돌림)
  ③ (화면) 사용자 웹 /compare
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

ok('① 코드 — 비교 공개 API /site/mbx/compare(최대 4 · 공개 칸만 · 표 없음) · 설정 mbx.compare off · 오류 MBX_COMPARE_MAX · MBX_COMPARE_IDS · 화면 HOM-MBX-020 · 사용자 웹 /compare(이 브라우저 비교함) · 사전 compare.f 23칸 ko · en · 문서 640 · 판 v10.502',
   "@Get('site/mbx/compare')" in MB['mbx.controller'] and 'COMPARE_MAX = 4' in MB['common'] and "('mbx.compare', 'off'" in M73
   and "'MBX_COMPARE_MAX'" in MB['compare'] and "'MBX_COMPARE_IDS'" in MB['compare'] and 'owner_account_id AS' not in MB['compare'] and 'l.body' not in MB['compare']
   and '"SB-HOM-MBX-020"' in SJ and 'data-screen="SB-HOM-MBX-020"' in rd('site/src/app/compare/page.tsx') and 'sgb_mbx_cmp' in rd('site/src/components/mbx/mbxLocal.ts')
   and len((KO.get('compare') or {}).get('f') or {}) == 23 and len((EN.get('compare') or {}).get('f') or {}) == 23
   and '공개' in doc('640_') and VT >= (10, 502), VER)

if API and DB:
    old = getset('mbx.compare')
    try:
        L = [x for x in psql("SELECT id FROM listings WHERE status = 'PUBLISHED' ORDER BY published_at DESC NULLS LAST, id LIMIT 4").split('\n') if x]
        P = [x for x in psql("SELECT code FROM hlt_products WHERE status IN ('ON_SALE', 'SOLD_OUT') ORDER BY code LIMIT 2").split('\n') if x]
        setting('mbx.compare', 'off', '1502')
        c0 = call('GET', f"/site/mbx/compare?type=LISTING&ids={','.join(L[:2])}")
        setting('mbx.compare', 'on', '1502')
        ghost = '00000000-0000-4000-8000-00000000' + f'{stamp:06d}'[-4:]
        c1 = call('GET', f"/site/mbx/compare?type=LISTING&ids={','.join(L[:2] + [ghost])}")
        items = c1.get('items') or []
        keys = set().union(*[set(x.keys()) for x in items]) if items else set()
        txt = json.dumps(c1, ensure_ascii=False)
        five = call('GET', f"/site/mbx/compare?type=LISTING&ids={','.join(L[:1] * 1 + [ghost[:-1] + str(i) for i in range(4)])}")
        bad = call('GET', '/site/mbx/compare?type=LISTING&ids=not-a-uuid')
        none = call('GET', '/site/mbx/compare?type=LISTING&ids=')
        bt = call('GET', f"/site/mbx/compare?type=NOPE&ids={L[0] if L else ''}")
        cp = call('GET', f"/site/mbx/compare?type=PRODUCT&ids={','.join(P)}") if P else {'items': [], 'enabled': True}
        ok('② 비교 — 꺼짐 빈 목록 · 매물 2개(고른 순서 · 빠진 1 · 칸 12 이름 · 등록자는 회사명 · 「개인」만 · 이름 · 연락처 · 좌표 · 본문 칸 없음) · 5개 422 · 형식 422 · 비어 있음 422 · 종류 422 · 상품 비교',
           c0.get('enabled') is False and c0.get('items') == [] and len(L) >= 2 and c1.get('enabled') is True and [x.get('id') for x in items] == L[:2] and c1.get('missing') == 1
           and len(c1.get('fields') or []) == 12 and not ({'owner_account_id', 'ownerAccountId', 'body', 'phone', 'lat', 'lng', 'geo'} & keys)
           and all(isinstance(x.get('owner'), dict) and 'companyName' in x['owner'] and 'name' not in x['owner'] for x in items)
           and five.get('code') == 'MBX_COMPARE_MAX' and bad.get('code') == 'MBX_COMPARE_IDS' and none.get('code') == 'MBX_COMPARE_IDS' and bt.get('code') == 'MBX_TYPE'
           and cp.get('enabled') is True and len(cp.get('items') or []) == len(P) and all('price' in x for x in cp.get('items') or []),
           f"{c0.get('enabled')} {c0.get('items')} L{len(L)} {[str(x.get('id'))[:8] for x in items]} missing {c1.get('missing')} fields {len(c1.get('fields') or [])} keys-bad {sorted({'owner_account_id', 'body', 'phone', 'lat', 'lng', 'geo'} & keys)} · "
           f"{five.get('code')} {bad.get('code')} {none.get('code')} {bt.get('code')} · 상품 {len(cp.get('items') or [])}/{len(P)}")
    finally:
        setting('mbx.compare', old, '1502 되돌림')
    if SITE:
        def run(b, seen, perr):
            pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
            pg.goto(SITE + '/compare', wait_until='networkidle', timeout=120000)
            seen['scr'] = pg.locator('[data-screen="SB-HOM-MBX-020"]').count()
            seen['state'] = pg.locator('[data-mbx-cmp-off], [data-mbx-cmp-empty]').count()
        r = ui(run)
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 사용자 웹 /compare(꺼짐 안내 또는 빈 비교함)', seen.get('scr') == 1 and seen.get('state') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
