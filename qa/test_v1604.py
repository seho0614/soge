"""v10.604 (docs/746) ⑳ 검색 클릭 분석 — 익명 · 순위 자료만
  ① (코드) 공개 POST /site/lsq/search-click · 계정 · IP 저장 없음 · DNT · GPC · 로봇 · 낱말 손질(숫자 3자리 · @ · 제한업종) · 표 두 개(사람 칸 없음) · 사용자 웹 보내기(광고 줄 빼고 순위) · 화면 · 문서 746 · 판
  ② (API · DB) 꺼짐 ok:false OFF · 켜고 클릭 → 날 × 낱말 × 순위 1 · 매물 1 · DNT 받지 않음 · 전화번호 모양 낱말 버림 · 순위 0 은 400 · 운영 분석 · 보관 정리
  (두 번 돌아도 통과 — 「시험클릭」 낱말 줄은 시작 · 끝에 지움 · 설정 되돌림)
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
SC = src('search-click.ts'); SP = rd('site/src/app/search/page.tsx'); BC = rd('site/src/components/lsq/ClickBeacon.tsx')
ok('① 코드 — 공개 POST(@Roles 없음 · site 구역) · 계정 안 읽음 · IP 는 메모리 제한만 · DNT · GPC · 로봇 · 숫자 3자리 · @ · 제한업종 버림 · 표에 사람 칸 없음 · 사용자 웹 data-lsq-pos(광고 빼고) · 화면 · 문서 746 · 판 v10.604',
   "@Post('site/lsq/search-click')" in src('lsq.controller.ts') and 'RequestCtx' not in SC and "h.dnt === '1' || h.gpc === '1'" in SC and 'BOT_UA' in SC and 'restricted_industries' in SC
   and not re.search(r'lsq_search_click(s|_items) \([^;]*(account|visitor|ip_)', ML) and 'data-lsq-pos={r.ad ? undefined' in SP and 'globalPrivacyControl' in BC
   and 'SB-HOM-LSQ-030' in SCREEN_IDS and 'SB-ADM-LSQ-030' in SCREEN_IDS and 'v10.604' in doc('746_') and VT >= (10, 604), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keep = Keep(['lsq.search_click'], '시험1604')
    term = f'시험클릭{LETTERS}'
    CLEAN = "DELETE FROM lsq_search_clicks WHERE term LIKE '시험클릭%'; DELETE FROM lsq_search_click_items WHERE term LIKE '시험클릭%';"
    psql(CLEAN)
    try:
        lid = psql("SELECT id FROM listings WHERE status = 'PUBLISHED' ORDER BY created_at LIMIT 1")
        setting('lsq.search_click', 'off', '시험1604')
        off = call_h('POST', '/site/lsq/search-click', {'q': term, 'pos': 2, 'gwan': 'ALL'})
        setting('lsq.search_click', 'on', '시험1604')
        on1 = call_h('POST', '/site/lsq/search-click', {'q': term, 'pos': 2, 'gwan': 'ALL', 'listingId': lid or None})
        dnt = call_h('POST', '/site/lsq/search-click', {'q': term, 'pos': 2, 'gwan': 'ALL'}, extra={'dnt': '1'})
        phone = call_h('POST', '/site/lsq/search-click', {'q': '010 1234 5678', 'pos': 1})
        bad = call_h('POST', '/site/lsq/search-click', {'q': term, 'pos': 0})
        row = psql(f"SELECT coalesce(sum(clicks), 0) FROM lsq_search_clicks WHERE term = lower('{term}') AND pos = 2")
        item = psql(f"SELECT coalesce(sum(clicks), 0) FROM lsq_search_click_items WHERE term = lower('{term}')")
        ok('② 받기 — 꺼짐 OFF · 켜면 1번 셈(매물도) · DNT 받지 않음 · 전화번호 모양 TERM · 순위 0 은 400',
           off.get('ok') is False and off.get('reason') == 'OFF' and on1.get('ok') is True and dnt.get('reason') == 'DNT' and phone.get('reason') == 'TERM'
           and bad.get('_err') == 400 and row == '1' and item == ('1' if lid and not lid.startswith('!') else '0'), f"{off} {on1} {dnt} {phone} {bad.get('_err')} {row} {item}")
        cols = psql("SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_name IN ('lsq_search_clicks', 'lsq_search_click_items')")
        ok('② 표 — 사람 · 기기 칸 없음(day · term · gwan · pos · listing_id · clicks 만)', not re.search(r'account|visitor|ip|agent|session', cols), cols)
        adm = call('GET', '/admin/lsq/search-clicks?days=1', None, TS)
        ok('② 운영 — 오늘 낱말에 시험 낱말 · 평균 순위', any(t.get('term') == term.lower() for t in adm.get('terms') or []) and adm.get('summary', {}).get('clicks', 0) >= 1, str(adm)[:160])
        if SITE:
            def run_site(b, seen, perr):
                ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                ps.goto(SITE + '/search?q=' + urllib.parse.quote('카페'), wait_until='networkidle', timeout=120000)
                seen['links'] = ps.locator('a[data-lsq-pos]').count()
            r = ui(run_site)
            if r is not None:
                seen, perr = r
                ok('③ 사용자 웹 — 검색 결과에 화면 오류 없음(매물 줄 data-lsq-pos)', not perr, f"{seen} {perr[:2]}")
    finally:
        psql(CLEAN)
        keep.back()
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
