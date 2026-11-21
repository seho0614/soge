"""v10.578 (docs/720) 12차 ② 입점 열기 2차 점검 — 대표 11/21 「16개 모두 동시에」
  ① (코드) 2차 점검 18줄(약관 · 정산 · 반품 · 세금계산서 · 판매자 교육 · 연락처) · API · 소개몰 판매자 탭 1차 점검 아래 · 화면 목록 · 권한 주소 · 문서 720
  ② (API · DB) 줄 · 묶음 · 상태 · 막힘 수 · DB 와 같은 줄(전화 · 판매자 안내 흐름 · 반품 주소) · 회원 403 · 1차 점검 그대로
  ③ (화면) 소개몰 › 소개몰 판매자
  (읽기만 — 데이터를 바꾸지 않음 · 두 번 돌아도 같음)
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


def migr_has(marker):
    """마이그레이션 번호를 메인이 정하므로(D292 ~) 글자로 찾음 — 그 글자가 든 migration.sql"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            s = open(p, encoding='utf-8').read()
            if marker in s:
                return s
    return ''


def first(x):
    return (x or '').splitlines()[0] if x and not x.startswith('!') else ''


SJ = rd('spec/screens.json')
M = migr_has('CREATE TABLE IF NOT EXISTS public.smq_seller_grades')
STAMP = int(time.time()) % 1000000
RP = 'SET session_replication_role = replica; '

"""시험 몸통"""
R2, CT, UI, TAB = rd('src/modules/smq/ready2.ts'), rd('src/modules/smq/smq.controller.ts'), rd('web/src/app/admin/Smq.tsx'), rd('web/src/app/admin/HealthSellerTab.tsx')
EXPECT = ['terms-seller', 'terms-sale', 'terms-penalty', 'settle-job', 'statement', 'return-addr', 'return-fee', 'return-stale', 'invoice-dir', 'etax', 'invoice-wait',
          'seller-guide', 'qna-switch', 'cs-phone', 'mail-order', 'support-hours', 'seller-tel', 'seller-ecom']
ok('① 코드 — 2차 점검 읽기만(약관 · 정산 · 반품 · 세금계산서 · 판매자 교육 · 연락처 18줄 · 1차와 같은 줄 모양) · GET /admin/smq/tenant-ready2 · 소개몰 판매자 탭 1차 점검 아래 · 화면 목록에 API · 권한 주소 · 문서 720 · 판',
   'export async function tenantReady2' in R2 and all(f"key: '{k}'" in R2 for k in EXPECT) and "@Get('tenant-ready2')" in CT and 'export function SmqTenantReady2' in UI
   and '<SmqTenantReady2 />' in TAB and '<HealthTenantReady />' in TAB and '"GET /admin/smq/tenant-ready2"' in SJ and "('GET', '/admin/smq/tenant-ready2', 'hlt-sellers', 'VIEW')" in M
   and '판매자 교육' in doc('720_') and VT >= (10, 578), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1578', role=None)
    consent_ok.agree(em, PW)
    TM = login(em)
    d = call('GET', '/admin/smq/tenant-ready2', None, TS)
    rows = d.get('rows') or []
    by = {r.get('key'): r for r in rows}
    phone = getset('footer.phone').strip()
    guide = psql("SELECT EXISTS (SELECT 1 FROM v_guide_flow_current WHERE code = 'seller' AND is_active)")
    noaddr = psql("SELECT count(*) FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE' AND coalesce(btrim(return_addr), '') = ''")
    todo = sum(1 for r in rows if r.get('state') == 'todo')
    m403 = call('GET', '/admin/smq/tenant-ready2', None, TM)
    one = call('GET', '/admin/health/tenant/readiness', None, TS)
    ok('② 2차 점검 — 18줄 · 6묶음 · 상태 ok · todo · info 만 · 막힘 수 = todo · 준비됨 = 막힘 0 · 고객센터 전화 · 판매자 안내 흐름 · 반품 주소 줄이 DB 와 같음 · 회원 403 · 1차 점검 그대로',
           sorted(by.keys()) == sorted(EXPECT) and len(d.get('groups') or []) == 6 and all(r.get('state') in ('ok', 'todo', 'info') for r in rows)
           and d.get('todo') == todo and d.get('ready') is (todo == 0)
           and (by.get('cs-phone') or {}).get('state') == ('ok' if phone else 'todo')
           and (by.get('seller-guide') or {}).get('state') == ('ok' if guide == 't' else 'todo')
           and (by.get('return-addr') or {}).get('state') == ('ok' if noaddr == '0' else 'todo')
           and m403.get('_err') == 403 and isinstance(one.get('rows'), list),
           f"{sorted(by.keys()) == sorted(EXPECT)} {len(d.get('groups') or [])} {todo} {d.get('todo')} {d.get('ready')} · {(by.get('cs-phone') or {}).get('state')} {bool(phone)} · {(by.get('seller-guide') or {}).get('state')} {guide} · {(by.get('return-addr') or {}).get('state')} {noaddr} · {m403.get('_err')}")
    if ADMIN_WEB:
        r = admin_page('/#/hlt-sellers', lambda pg, seen: seen.update(n=pg.locator('[data-smq-ready2]').count(), g=pg.locator('[data-smq-ready2-group]').count(), one=pg.locator('[data-tenant-ready]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 소개몰 판매자(1차 점검 아래 2차 점검 · 6묶음 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('g') == 6 and seen.get('one') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
