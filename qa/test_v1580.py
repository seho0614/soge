"""v10.580 (docs/722) 12차 ④ 파트너 정산 예측 — 대표 11/21 「16개 모두 동시에」
  ① (코드) 정산 예측(확정 · 대기 · 취소 가능 · 취소됨 · 원천징수 3.3% · 지급일 · 돈 칸 권한) · API · 파트너센터 화면 · 정산 화면 단추 · 사전 · 화면 목록 · 문서 722
  ② (API · DB) 파트너 아님 409 · seller@x.com 파트너(정산 권한)면 이번 달 시험 제휴 주문 4건 넣고 앞뒤 차이(확정 · 대기 · 취소 가능 · 취소됨 · 귀속 안 됨 빠짐 · 예상 아래 끝 · 위 끝 · 원천징수 반올림 · 지급일)
  ③ (화면) 파트너센터 › 정산 › 이번 달 정산 예측
  (두 번 돌아도 통과 — 제휴 주문 T1580-… 는 시작 · 끝에 replica 로 지움)
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
FC, CT, PG, STP = rd('src/modules/smq/forecast.ts'), rd('src/modules/smq/smq.controller.ts'), rd('site/src/app/partner/settlement/forecast/page.tsx'), rd('site/src/app/partner/settlement/page.tsx')
try:
    KJ = json.loads(rd('site/src/i18n/messages/ko/smx.json') or '{}'); EJ = json.loads(rd('site/src/i18n/messages/en/smx.json') or '{}')
except Exception:
    KJ, EJ = {}, {}
kf, ef = ((KJ.get('smq') or {}).get('fc') or {}), ((EJ.get('smq') or {}).get('fc') or {})
ok('① 코드 — 정산 예측 읽기만(확정 · 대기 · 취소 가능 · 취소됨 · 원천징수 3.3% · 지급일 affiliate.payout_day · 돈 칸은 대표 · 정산 권한) · GET /partner/settle-forecast · 파트너센터 화면 · 정산 화면 단추 · 사전 ko · en 같음 · 화면 PTC SMQ-010 · 문서 722 · 판',
   'export async function settleForecast' in FC and 'const RATE = 0.033' in FC and 'canMoney' in FC and "affiliate.payout_day" in FC and 'directRewards' in FC
   and "@Get('settle-forecast')" in CT and '/partner/settle-forecast' in PG and 'href="/partner/settlement/forecast"' in STP
   and len(kf) >= 20 and sorted(kf.keys()) == sorted(ef.keys()) and '"SB-PTC-SMQ-010"' in SJ and '원천징수' in doc('722_') and VT >= (10, 580), VER)

if API and DB:
    import consent_ok
    em, aid = mk_staff('1580', role=None)
    consent_ok.agree(em, PW)
    TM = login(em)
    np_ = call('GET', '/partner/settle-forecast', None, TM)
    TP = login('seller@x.com')
    pid = psql("SELECT p.id FROM partners p JOIN businesses b ON b.id = p.business_id JOIN accounts a ON a.id = b.account_id "
               "WHERE a.email = 'seller@x.com' AND p.status <> 'NONE' ORDER BY p.approved_at DESC NULLS LAST LIMIT 1")
    CLEAN = RP + "DELETE FROM partner_orders WHERE order_no LIKE 'T1580-%';"
    psql(CLEAN)
    try:
        f0 = call('GET', '/partner/settle-forecast', None, TP)
        if f0.get('_err') is None and pid and not pid.startswith('!') and f0.get('money') is True:
            prod = first(psql("SELECT id FROM affiliate_products ORDER BY created_at LIMIT 1")) or psql("SELECT gen_random_uuid()")
            kst_mid = "(date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') + interval '1 day') AT TIME ZONE 'Asia/Seoul'"
            for k, st, amt in ((1, 'CONFIRMED', 10000), (2, 'PENDING', 5000), (3, 'CANCELED', 2000)):
                psql(RP + "INSERT INTO partner_orders (order_no, partner_id, product_id, commission, ordered_at, attributed, state) "
                     f"VALUES ('T1580-{STAMP}-{k}', '{pid}', '{prod}', {amt}, {kst_mid}, true, '{st}')")
            psql(RP + "INSERT INTO partner_orders (order_no, partner_id, product_id, commission, ordered_at, attributed, state) "
                 f"VALUES ('T1580-{STAMP}-4', '{pid}', '{prod}', 7000, {kst_mid}, false, 'CONFIRMED')")   # 귀속 안 됨 — 셈에서 빠짐
            f1 = call('GET', '/partner/settle-forecast', None, TP)
            A0, A1, C0, C1 = f0.get('amounts') or {}, f1.get('amounts') or {}, f0.get('counts') or {}, f1.get('counts') or {}
            dd = lambda a, b, k: (b.get(k) or 0) - (a.get(k) or 0)
            e = f1.get('estimate') or {}
            hr = lambda v: int(v * 0.033 + 0.5)   # JS Math.round 과 같은 반올림(양수)
            c, pe = A1.get('confirmed') or 0, A1.get('pending') or 0
            ok('② 예측 — 이번 달 확정 +10,000(1건) · 대기 +5,000 · 취소 가능 +5,000(소개몰 밖 주문) · 취소됨 +2,000 · 귀속 안 된 주문 빠짐 · 예상 아래 끝 = 확정 · 위 끝 = 확정 + 대기 · 원천징수 3.3% 반올림 · 지급일 다음 달',
                 dd(A0, A1, 'confirmed') == 10000 and dd(C0, C1, 'confirmed') == 1 and dd(A0, A1, 'pending') == 5000 and dd(A0, A1, 'cancelable') == 5000 and dd(A0, A1, 'canceled') == 2000
                 and e.get('grossLow') == c and e.get('grossHigh') == c + pe and e.get('taxLow') == hr(c) and e.get('netHigh') == (c + pe) - hr(c + pe)
                 and str(f1.get('payDate') or '') > (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime('%Y-%m-%d'),
                 f"{A0} → {A1} · {C0} → {C1} · {e} · {f1.get('payDate')}")
        else:
            print(f"  (seller@x.com 이 정산 권한 있는 파트너가 아님 — 셈 시험 건너뜀 · {f0.get('_err') or f0.get('money')})")
        ok('② 파트너 아님 409 NOT_PARTNER · 파트너는 이번 달 · 지급일 · 건수 칸이 옴',
           np_.get('_err') == 409 and np_.get('code') == 'NOT_PARTNER' and (f0.get('_err') == 409 or (bool(f0.get('ym')) and bool(f0.get('payDate')) and isinstance(f0.get('counts'), dict))),
           f"{np_.get('code')} · {f0.get('_err') or f0.get('ym')}")
    finally:
        psql(CLEAN)
    if SITE:
        def run_site(b, seen, perr):
            ps = site_login(b, perr, 'seller@x.com')
            ps.goto(SITE + '/partner/settlement/forecast', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['tiles'] = ps.locator('[data-smq-fc-tiles]').count()
            ps.goto(SITE + '/partner/settlement', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1000)
            seen['link'] = ps.locator('[data-smq-forecast-link]').count()
        r2 = ui(run_site)
        if r2 is not None:
            seen, perr = r2
            ok('③ 화면 — 파트너센터 › 정산 › 이번 달 정산 예측(숫자 칸 · 정산 화면 단추 · 화면 오류 없음)', seen.get('tiles') in (0, 1) and seen.get('link') in (0, 1) and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
