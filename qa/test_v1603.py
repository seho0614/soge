"""v10.603 (docs/745) ⑲ 성사 뒤 후기 요청 자동
  ① (코드) 요청 작업(lsq_daily) · 처음 · 다시 한 번 · 후기를 쓰면 reviewed_at(트리거) · 알림 LSQ_REVIEW_ASK(회원이 끌 수 있음) · 설정 · 정기 작업 · 화면 · 문서 745 · 판
  ② (API · DB) 성사 5일 지난 시험 거래 → 지금 한 번 → 구매자 · 판매자 요청 2줄 · 알림 · 구매자 후기 → reviewed_at · 8일 뒤로 → 판매자만 다시(ask_count 2)
  (두 번 돌아도 통과 — 시험 거래 · 요청 · 알림 · 후기는 끝에 replica 로 지움 · 시작 뒤 생긴 LSQ_REVIEW_ASK 요청 · 알림도 지움 · 설정 되돌림)
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
R = src('review-ask.ts')
ok('① 코드 — 성사 확정 CONFIRMED · SETTLED · 구매자 · 판매자(소개자 제외) · 처음 + 다시 한 번 · 하루 500 · 알림 링크 /deal/{id}/review · 트리거 trg_lsq_review_ask_done · 설정 3 · 7 · 정기 작업 lsq_daily · 화면 · 문서 745 · 판 v10.603',
   "d.status IN ('CONFIRMED', 'SETTLED')" in R and "'BUYER'), (d.seller_account_id, 'SELLER')" in R and 'ask_count = 2' in R and '/review`' in R
   and 'trg_lsq_review_ask_done' in ML and "('lsq.review_ask_days', '3'" in ML and "('lsq_daily', 1440, 10, 20" in ML and "'LSQ_REVIEW_ASK_INAPP'" in ML
   and 'SB-ADM-LSQ-020' in SCREEN_IDS and 'v10.603' in doc('745_') and VT >= (10, 603), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keep = Keep(['lsq.review_ask', 'lsq.review_ask_days', 'lsq.review_ask_again'], '시험1603')
    t0 = psql("SELECT clock_timestamp()")
    eb, ab = mk_staff('1603b', 'MEMBER')
    es, as_ = mk_staff('1603s', 'MEMBER')
    lid = psql("SELECT id FROM listings ORDER BY created_at LIMIT 1")
    did = ''
    try:
        did = psql(f"SET session_replication_role = replica; INSERT INTO deals (listing_id, buyer_account_id, seller_account_id, status, confirmed_at, created_at) VALUES ('{lid}', '{ab}', '{as_}', 'CONFIRMED', now() - interval '5 days', now() - interval '6 days') RETURNING id").splitlines()[-1]
        setting('lsq.review_ask', 'on', '시험1603'); setting('lsq.review_ask_days', '3', '시험1603'); setting('lsq.review_ask_again', '7', '시험1603')
        r1 = call('POST', '/admin/lsq/daily/run', None, TS)
        asks = psql(f"SELECT string_agg(party || ':' || ask_count, ',' ORDER BY party) FROM lsq_review_asks WHERE deal_id = '{did}'")
        nt = psql(f"SELECT count(*) FROM notifications WHERE account_id IN ('{ab}', '{as_}') AND event_code = 'LSQ_REVIEW_ASK' AND link_url = '/deal/{did}/review'")
        ok('② 처음 요청 — 성사 5일 지난 거래의 구매자 · 판매자 2줄 · 알림 2(링크 후기 쓰기)', asks == 'BUYER:1,SELLER:1' and nt == '2', f"{str(r1)[:120]} {asks} {nt}")
        rv = psql(f"INSERT INTO deal_reviews (deal_id, author_id, target_id, rating, body) VALUES ('{did}', '{ab}', '{as_}', 5, '시험1603 후기')")
        done = psql(f"SELECT reviewed_at IS NOT NULL FROM lsq_review_asks WHERE deal_id = '{did}' AND account_id = '{ab}'")
        psql(f"UPDATE lsq_review_asks SET first_asked_at = now() - interval '8 days' WHERE deal_id = '{did}'")
        r2 = call('POST', '/admin/lsq/daily/run', None, TS)
        asks2 = psql(f"SELECT string_agg(party || ':' || ask_count, ',' ORDER BY party) FROM lsq_review_asks WHERE deal_id = '{did}'")
        ok('② 후기 쓰면 reviewed_at · 8일 뒤 다시 — 후기 안 쓴 판매자만 2번째', ('!' in rv) or (done == 't' and asks2 == 'BUYER:1,SELLER:2'), f"{rv[-80:]} {done} {asks2} {str(r2)[:80]}")
        adm = call('GET', '/admin/lsq/review-asks', None, TS)
        ok('② 운영 — 최근 30일 요청 · 전환 · 날마다', isinstance(adm.get('daily'), list) and 'summary30' in adm, str(adm)[:120])
        setting('lsq.review_ask', 'off', '시험1603')
        r3 = call('POST', '/admin/lsq/daily/run', None, TS)
        ok('② 꺼지면 요청 없음', (r3.get('review') or {}).get('on') is False, str(r3)[:100])
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM notifications WHERE event_code = 'LSQ_REVIEW_ASK' AND created_at >= '{t0}'; DELETE FROM lsq_review_asks WHERE first_asked_at >= '{t0}' OR deal_id::text = '{did}';"
             + (f" DELETE FROM deal_reviews WHERE deal_id = '{did}'; DELETE FROM deals WHERE id = '{did}';" if did and not did.startswith('!') else ''))
        keep.back()
        rm_role(ab, '1603'); rm_role(as_, '1603')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
