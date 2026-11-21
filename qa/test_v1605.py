"""v10.605 (docs/747) ㉑ 지역별 소개 페이지 · 사이트 지도
  ① (코드) 공개 GET /site/lsq/regions · /site/lsq/regions/listings · v_listing_region 재사용 · 문턱 · 등록자 · 연락처 없음 · 사용자 웹 /area 세 화면 · 사이트 지도 줄 · 화면 · 문서 747 · 판
  ② (API) 꺼짐 enabled false · 켜고 문턱 1 → 지역 목록 · 한 지역 매물(사람 칸 없음 · 30개까지) · 틀린 시도 422 · 운영 표
  (두 번 돌아도 통과 — 설정만 바꾸고 되돌림)
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


"""lsq 공통(17차) — 마이그레이션은 번호를 모르므로 글자로 찾음 · 설정 되돌리기 · 머리글 정해 부르기"""
def mig_lsq():
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            s = open(p, encoding='utf-8').read()
            if 'CREATE TABLE IF NOT EXISTS public.lsq_bulk_jobs' in s:
                return s
    return ''


def src(rel):
    return rd('src/modules/lsq/' + rel)


def call_h(m_, p, b=None, t=None, extra=None):
    hd = {'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (test lsq)'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    hd.update(extra or {})
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


class Keep:
    """설정 값 기억 → 끝에 되돌림"""
    def __init__(self, keys, tag):
        self.keys, self.tag = keys, tag
        self.old = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in keys}

    def back(self):
        for k, v in self.old.items():
            setting(k, v if v != '' else None, self.tag + ' 되돌림')


ML = mig_lsq()
SJD = json.loads(SJ) if SJ.strip().startswith('{') else {'screens': []}
SCREEN_IDS = {s.get('id') for s in SJD.get('screens', [])}
STAMP = int(time.time()) % 1000000
LETTERS = ''.join('가나다라마바사아자차'[int(c)] for c in str(STAMP))   # 숫자 없는 꼬리표(검색 낱말 규칙 — 숫자 3자리 이상은 버림)

"""시험 몸통"""
RG = src('region.ts'); SM = rd('site/src/app/sitemap.ts')
ok('① 코드 — v_listing_region 재사용 · 게시 · 우선 노출 아님 · HLT 제외 · 문턱 lsq.region_min · 등록자 칸 없음 · /area 세 화면 · 사이트 지도 lsqAreaEntries · 화면 · 문서 747 · 판 v10.605',
   'JOIN v_listing_region vr' in RG and 'NOT l.is_priority_exposed' in RG and "l.gwan_code <> 'HLT'" in RG and 'owner_account_id' not in RG
   and rd('site/src/app/area/page.tsx') and rd('site/src/app/area/[sido]/page.tsx') and rd('site/src/app/area/[sido]/[sigungu]/page.tsx')
   and 'lsqAreaEntries(o, rg)' in SM and "('lsq.region_pages', 'off'" in ML and 'SB-HOM-LSQ-010' in SCREEN_IDS and 'SB-HOM-LSQ-020' in SCREEN_IDS
   and 'v10.605' in doc('747_') and VT >= (10, 605), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keep = Keep(['lsq.region_pages', 'lsq.region_min'], '시험1605')
    try:
        setting('lsq.region_pages', 'off', '시험1605')
        off = call('GET', '/site/lsq/regions')
        setting('lsq.region_pages', 'on', '시험1605'); setting('lsq.region_min', '1', '시험1605')
        on = call('GET', '/site/lsq/regions')
        sd = (on.get('sidos') or [{}])[0].get('sido') if on.get('sidos') else None
        one = call('GET', '/site/lsq/regions/listings?sido=' + urllib.parse.quote(sd)) if sd else {'enabled': True, 'items': []}
        bad = call('GET', '/site/lsq/regions/listings?sido=abc')
        keys = set().union(*[set(x.keys()) for x in one.get('items') or [{}]])
        ok('② 공개 — 꺼짐 enabled false · 켜면 지역 목록 · 한 지역 매물(30개까지 · 등록자 · 연락처 칸 없음) · 틀린 시도 422',
           off.get('enabled') is False and on.get('enabled') is True and isinstance(on.get('sidos'), list) and one.get('enabled') is True
           and len(one.get('items') or []) <= 30 and not (keys & {'owner', 'ownerAccountId', 'phone', 'address', 'name'}) and bad.get('_err') == 422,
           f"{off.get('enabled')} {on.get('enabled')} {len(on.get('sidos') or [])} {sd} {len(one.get('items') or [])} {sorted(keys)[:8]} {bad.get('_err')}")
        adm = call('GET', '/admin/lsq/regions', None, TS)
        ok('② 운영 — 공개될 지역 수 · 문턱 아래 · 지역 표', isinstance(adm.get('rows'), list) and 'pages' in adm, str(adm)[:120])
        if SITE:
            def run_site(b, seen, perr):
                ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                ps.goto(SITE + '/area', wait_until='networkidle', timeout=120000)
                seen['area'] = ps.locator('[data-screen="SB-HOM-LSQ-010"]').count()
            r = ui(run_site)
            if r is not None:
                seen, perr = r
                ok('③ 사용자 웹 — /area 화면(SB-HOM-LSQ-010 · 오류 없음)', seen.get('area') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        keep.back()
else:
    print('  (API 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
