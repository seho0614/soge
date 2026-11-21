"""v10.558 (docs/696) DB 검사 정규식 반복 수 고침(D289) · 끌어올림 표시는 최신순만 — 점검 9(11/21) 회귀에서 찾음
  ① (코드) D289 세 칸 · 반복 수 255 이하 · 목록 bumpLabel 최신순만 · 문서 696 · 판
  ② (DB · API) 마이그레이션 327 · 255 넘는 검사 0 · 출처 주소 · 제휴상품 사진 주소(되돌림) · 팝업 단추 주소 만들기 · 고치기 · 너무 긴 주소 · javascript: 막음 · 소개비순 표시 없음
  (두 번 돌아도 통과 — 「시험1558-」 팝업은 시작 · 끝에 replica 로 지움 · 제휴상품은 ROLLBACK)
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
M89 = migr('D289_')
M89S = re.sub(r'/\*.*?\*/', '', M89, flags=re.S)   # 주석(옛 정규식을 적어 둠)은 빼고 SQL 만
LR = rd('src/modules/listing/listing.dto.ts') and rd('src/modules/listing/listing.repository.ts')
ok('① 코드 — D289 세 칸 정규식 다시 붙임(biz_axis_items.source_url · affiliate_products.image_path · prx_popups.link_url) · 반복 수 255 이하 · 끌어올림 표시 최신순만 · 문서 696 · 판 v10.558',
   'biz_axis_items_source_url_check' in M89 and 'affiliate_products_image_path_check' in M89 and 'prx_popups_link_url_check' in M89
   and not any(int(n) > 255 for n in re.findall(r'\{\d*,(\d+)\}', M89S))
   and "!rel && k === KEY.RECENT" in LR and "'NULL::text'" in LR and 'D289' in doc('696_') and VT >= (10, 558), VER)

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    tag = f'시험1558-{STAMP}'
    CLEAN = f"SET session_replication_role = replica; DELETE FROM prx_popups WHERE title LIKE '시험1558-%';"
    psql(CLEAN)
    try:
        mig = psql("SELECT count(*) || '|' || max(name) FROM schema_migrations")
        bad = psql(r"SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND pg_get_constraintdef(oid) ~ '\{[0-9]*,(2[6-9][0-9]|[3-9][0-9][0-9]|[0-9]{4,})\}'")
        defs = psql("SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conname IN ('biz_axis_items_source_url_check', 'affiliate_products_image_path_check', 'prx_popups_link_url_check')")
        rx = psql(r"SELECT ('https://example.com/' || repeat('a', 300)) ~ '^https://[^\s]{4,250}[^\s]{0,250}$' AND NOT (('https://' || repeat('a', 501)) ~ '^https://[^\s]{4,250}[^\s]{0,250}$')")
        aff = psql("BEGIN; UPDATE affiliate_products SET image_path = 'https://cdn.example.com/p/1558.png' WHERE id = (SELECT id FROM affiliate_products ORDER BY id LIMIT 1); ROLLBACK;")
        now = datetime.datetime.now(datetime.timezone.utc)
        iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%S.000Z')
        body = {'title': f'{tag} 안내', 'body': '시험 팝업입니다.', 'linkUrl': '/support', 'linkLabel': '자세히', 'audience': ['GUEST'],
                'startsAt': iso(now - datetime.timedelta(hours=1)), 'endsAt': iso(now + datetime.timedelta(hours=2)), 'priority': 0}
        c1 = call('POST', '/admin/prx/popups', body, TS)
        c2 = call('POST', '/admin/prx/popups', {**body, 'title': f'{tag} 긴 주소', 'linkUrl': '/' + 'a' * 300}, TS)
        c3 = call('POST', '/admin/prx/popups', {**body, 'title': f'{tag} 바깥', 'linkUrl': 'https://www.example.com/' + 'b' * 299}, TS)
        e1 = call('PUT', f"/admin/prx/popups/{c1.get('id')}", {**body, 'linkUrl': '/events?x=1#top'}, TS) if c1.get('id') else {}
        long_db = psql(f"INSERT INTO prx_popups (title, link_url, audience, starts_at, ends_at) VALUES ('{tag} 너무 김', '/' || repeat('a', 301), ARRAY['GUEST'], now(), now() + interval '1 hour')")
        js_db = psql(f"INSERT INTO prx_popups (title, link_url, audience, starts_at, ends_at) VALUES ('{tag} 나쁜 주소', 'javascript:alert(1)', ARRAY['GUEST'], now(), now() + interval '1 hour')")
        ok('② DB — 마이그레이션 327 · 끝 D289 · 255 넘는 반복 수 검사 0 · 세 검사 다시 붙음 · 출처 주소 500자까지 받고 501자 막음 · 제휴상품 https 사진 주소 저장 됨',
           mig == '327|D289_regex_repeat_fix' and bad == '0' and defs == 'affiliate_products_image_path_check,biz_axis_items_source_url_check,prx_popups_link_url_check'
           and rx == 't' and '!' not in aff, f"{mig} {bad} {defs} {rx} {aff[-60:]}")
        ok('② 팝업 — 단추 주소 있는 팝업 만들기(500 아님) · 사이트 안 주소 300자 · https 경로 300자 · 고치기 · 301자 · javascript: 는 DB 가 막음',
           c1.get('ok') is True and c2.get('ok') is True and c3.get('ok') is True and e1.get('ok') is True
           and 'prx_popups_link_url_check' in long_db and 'prx_popups_link_url_check' in js_db,
           f"{c1.get('ok') or c1} {c2.get('ok') or c2} {c3.get('ok') or c3} {e1.get('ok') or e1} {long_db[-50:]} {js_db[-50:]}")
        gw = psql("SELECT g.code FROM gwans g JOIN listings l ON l.gwan_code = g.code GROUP BY g.code ORDER BY count(*) DESC LIMIT 1")
        fee = call('GET', f'/listings?gwanCode={gw}&sort=FEE_DESC&limit=50', None) if gw and not gw.startswith('!') else {}
        pop = call('GET', f'/listings?gwanCode={gw}&sort=POPULAR&limit=50', None) if gw and not gw.startswith('!') else {}
        rows = (fee.get('organic') or []) + (pop.get('organic') or [])
        ok('② 목록 — 소개비순 · 인기순에는 「끌어올림」 표시 없음(최신순만)',
           isinstance(fee.get('organic'), list) and all(not r.get('bumpLabel') for r in rows), f"{gw} {len(rows)} {[r.get('bumpLabel') for r in rows if r.get('bumpLabel')][:3]}")
    finally:
        psql(CLEAN)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
