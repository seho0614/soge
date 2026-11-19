"""v10.419 (D251 · docs/556) 영어 문장 · 공휴일 정리 — 올리기 결과 문장 번역 틀 · 사전 없는 문장 · 업무 일지 작성률 영업일
  ① (코드) 은행 · PG 결과 문장 늘 같은 모양 · 매출장/매입장 문장 · 사전 줄 · worklog 영업일 · 문서
  ② (API) 일지 현황판 영업일 수(biz7) = DB 영업일 수 · 작성률 100% 넘지 않음
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


import glob
def mig(prefix):
    fs = sorted(glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(fs[0], encoding='utf-8').read() if fs else ''


M48 = mig('D248')

M51 = mig('D251')
BK, PG, AC, EN, WL = rd('src/modules/acct/bank.ts'), rd('src/modules/acct/pgsettle.ts'), rd('src/modules/acct/acct.controller.ts'), rd('src/common/i18n/server-text.en.ts'), rd('src/modules/admin/worklog.ts')
keys = ['"거래 {0}줄 중 새로 {1} · 이미 있음 {2} · 못 읽음 {3}."', '"정산 {0}줄 중 새로 {1} · 이미 있음 {2} · 못 읽음 {3} · 자동 맞춤 {4}."', '"자동 맞춤 {0} · 건너뜀 {1}."',
        '"작업 실행 권한이 없습니다."', '"품의 금액(허용 비율 포함)을 넘습니다 — 다시 품의하십시오."']
ok('① 코드 — 은행 · PG 결과 문장(조건부 글자 없음) · 매출장/매입장 문장째 · 사전 줄 5 · 일지 작성률 영업일(fn_is_business_day) · 문서 556 · 판 v10.419',
   "· 못 읽음 ${bad}.`" in BK and '${bad ? `' not in BK and '${bad ? `' not in PG and '${skipped ? `' not in PG
   and "r.kind === 'SALES' ? `매출장" in AC and all(k in EN for k in keys) and 'fn_is_business_day' in WL and 'biz7' in WL and '영업일' in doc('556_') and VT >= (10, 419), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    bd = call('GET', '/admin/worklogs/board', None, TS)
    tot = bd.get('total') or {}
    want = psql(f"SELECT count(*) FROM generate_series('{bd.get('from7')}'::date, '{bd.get('date')}'::date, interval '1 day') g(d) WHERE fn_is_business_day(g.d::date)") if bd.get('date') else '-1'
    ok('② 현황판 — 영업일 수(biz7) = DB 영업일(주말 · 공휴일 뺌) · 사람마다 작성률 0 ~ 100%',
       str(tot.get('biz7')) == str(max(1, int(want or 0))) and all(0 <= int(p.get('rate7') or 0) <= 100 for p in bd.get('people') or []),
       f"{tot.get('biz7')} = {want} · {[p.get('rate7') for p in (bd.get('people') or [])][:5]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
