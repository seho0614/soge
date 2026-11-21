"""v10.607 (docs/749) ㉓ 배송 추적 연동 — 택배사 어댑터 · 처음 off · 간주
  ① (코드) 어댑터(ASSUME · LIVE · NOT_READY · 받는 사람 정보 안 보냄) · 외부 연동 CARRIER(목록표 · 키 화면 · 운영 .env 예시) · 간주 결과로 주문 안 바꿈 · 회원 배송 조회 단계 · 화면 · 문서 749 · 판
  ② (API · DB) CARRIER 줄 · 받는 키 짝 · 처음 ASSUME · 시험 배송중 주문 → 지금 한 번 → 간주 단계(배송 완료까지) · 주문은 그대로 SHIPPED · 회원 · 운영 단계
  (두 번 돌아도 통과 — 시험 주문 · 배송 기록 · 단계는 끝에 replica 로 지움 · 시작 뒤 조회 줄도 지움)
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
CA = src('carrier.adapter.ts'); TR = src('tracking.ts')
ok('① 코드 — ASSUME 은 밖으로 안 부름 · LIVE 키 없으면 NOT_READY · 택배사 · 송장만 보냄 · 배송 완료 반영은 LIVE · lsq.track_auto_deliver · 목록표 CARRIER · 키 화면 · .env 예시 · 화면 · 문서 749 · 판 v10.607',
   "source: 'NOT_READY'" in CA and 'CARRIER_TRACK_KEY' in CA and "res.source === 'LIVE' && s.trackAutoDeliver" in TR
   and "code: 'CARRIER'" in rd('src/common/integration/registry.ts') and "name: 'CARRIER_TRACK_KEY'" in rd('src/common/integration/secret.service.ts')
   and 'CARRIER_TRACK_KEY=' in rd('deploy/aws/env.production.example') and "('lsq.track_mode', 'ASSUME'" in ML and 'SB-HLT-LSQ-040' in SCREEN_IDS
   and 'v10.607' in doc('749_') and VT >= (10, 607), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    t0 = psql("SELECT clock_timestamp()")
    em, aid = mk_staff('1607', 'MEMBER')
    consent_ok.agree(em, PW)
    TM = login(em)
    oid = no = ''
    try:
        ig = psql("SELECT code || '|' || secret_key_name FROM integrations WHERE code = 'CARRIER'")
        ck = psql("SELECT position('CARRIER_TRACK_KEY' IN pg_get_constraintdef(oid)) > 0 FROM pg_constraint WHERE conname = 'ck_integ_secret_name'")
        md = getset('lsq.track_mode')
        ok('② DB — 외부 연동 CARRIER · 받는 키 짝 · 처음 ASSUME', ig == 'CARRIER|CARRIER_TRACK_KEY' and ck == 't' and md in ('ASSUME', 'LIVE'), f"{ig} {ck} {md}")
        r = psql(f"SET session_replication_role = replica; INSERT INTO hlt_orders (order_no, account_id, goods_amount, ship_fee, total, status, paid_at, shipped_at, created_at) VALUES (fn_next_hlt_order_no(), '{aid}', 10000, 0, 10000, 'SHIPPED', now() - interval '55 hours', now() - interval '50 hours', now() - interval '60 hours') RETURNING id || '|' || order_no").splitlines()[-1]
        if '|' in r:
            oid, no = r.split('|')
            psql(f"SET session_replication_role = replica; INSERT INTO hlt_shipments (order_id, carrier, tracking_no, state, note, happened_at) VALUES ('{oid}', 'CJ대한통운', '6{STAMP:06d}{STAMP % 1000:03d}', 'PICKED', '시험1607', now() - interval '50 hours')")
        run = call('POST', '/admin/lsq/tracking/run', None, TS) if md == 'ASSUME' else {'skip': 'LIVE'}
        ev = psql(f"SELECT string_agg(DISTINCT status, ',' ORDER BY status) || '|' || min(source) FROM lsq_track_events WHERE order_id = '{oid}'") if oid else ''
        stt = psql(f"SELECT status FROM hlt_orders WHERE id = '{oid}'") if oid else ''
        ok('② 지금 한 번(간주) — 단계가 배송 완료까지 쌓임 · source ASSUME · 주문은 그대로 SHIPPED(간주로 안 바꿈)',
           md != 'ASSUME' or ('DELIVERED' in ev and ev.endswith('|ASSUME') and stt == 'SHIPPED'), f"{str(run)[:120]} {ev} {stt}")
        mine = call('GET', f'/lsq/me/orders/{urllib.parse.quote(no)}/tracking', None, TM) if no else {}
        other = call('GET', f'/lsq/me/orders/{urllib.parse.quote(no)}/tracking', None, login('buyer@x.com')) if no else {}
        adm = call('GET', f'/admin/lsq/tracking/orders/{urllib.parse.quote(no)}', None, TS) if no else {}
        top = call('GET', '/admin/lsq/tracking', None, TS)
        ok('② 회원 · 운영 — 내 주문 단계(장소 · 시각만) · 남의 주문 404 · 운영 단계 · 준비 상태(키 없음이면 notReady 는 LIVE 일 때만)',
           (md != 'ASSUME' or len(mine.get('events') or []) >= 4) and other.get('_err') == 404 and isinstance(adm.get('events'), list)
           and top.get('ready', {}).get('notReady') == (top.get('ready', {}).get('mode') == 'LIVE' and not top.get('ready', {}).get('keySet'))
           and not any(k in json.dumps(mine.get('events') or [], ensure_ascii=False) for k in ('phone', 'address', 'receiver')), f"{len(mine.get('events') or [])} {other.get('_err')} {str(top)[:100]}")
        if ADMIN_WEB:
            r = admin_page('/#/lsq-track', lambda pg, seen: seen.update(n=pg.locator('[data-lsq-track-mode]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 소개몰 › 배송 추적(오류 없음)', seen.get('n') >= 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM lsq_track_events WHERE created_at >= '{t0}'; DELETE FROM lsq_track_polls WHERE last_polled_at >= '{t0}';"
             + (f" DELETE FROM hlt_shipments WHERE order_id = '{oid}'; DELETE FROM hlt_orders WHERE id = '{oid}';" if oid else ''))
        rm_role(aid, '1607')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
