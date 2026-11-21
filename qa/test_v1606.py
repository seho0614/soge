"""v10.606 (docs/748) ㉒ 정기 배송 결제 실패 다시 시도(PG 간주)
  ① (코드) 기존 정기 배송(health-subscribe) 위에 — failSub 끝 고리(lsq.sub_retry off 면 그대로) · 한 건만 청구(onlyId) · 간격표 · 회원 알림 · 지금 다시 결제(회원 · 운영) · 표 두 개 · 화면 · 문서 748 · 판
  ② (API · DB) 실패한 시험 정기 배송 — 회원 목록 · 꺼짐 409 · 켜고 지금 다시(정기 배송 꺼져 있으면 NOT_DUE · 기록) · 남의 것 404 · 운영 지금 다시 · 운영 목록
  (두 번 돌아도 통과 — 시험 정기 배송 · 기록은 끝에 replica 로 지움 · 설정 되돌림)
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
HS = rd('src/modules/health/health-subscribe.ts'); SR = src('sub-retry.ts'); HK = src('sub-retry-hook.ts')
ok('① 코드 — failSub 끝 lsqAfterSubFail · onlyId 한 건만 · 고리 파일은 health-subscribe 를 import 하지 않음 · 간격표 1,3,5 · 알림 LSQ_SUB_PAY_FAIL · 오늘 회차 있으면 409 · 청구는 mallSubscribeJob 그대로 · 화면 · 문서 748 · 판 v10.606',
   'await lsqAfterSubFail(db, s, s.fail_count + 1, s.fail_count + 1 >= retry, why, today);' in HS and 'AND ($2::bigint IS NULL OR s.id = $2::bigint)' in HS
   and "from '../health/health-subscribe'" not in HK and "'LSQ_SUB_PAY_FAIL'" in HK and 'LSQ_SUB_TRIED_TODAY' in SR and 'mallSubscribeJob(db, id)' in SR
   and "('lsq.sub_retry_days', '1,3,5'" in ML and 'lsq_sub_pay_fails' in ML and 'SB-HLT-LSQ-010' in SCREEN_IDS and 'SB-ADM-LSQ-050' in SCREEN_IDS
   and 'v10.606' in doc('748_') and VT >= (10, 606), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keep = Keep(['lsq.sub_retry'], '시험1606')
    em, aid = mk_staff('1606', 'MEMBER')
    consent_ok.agree(em, PW)
    TM = login(em)
    sid = ''
    try:
        po = psql("SELECT product_id || '|' || id FROM hlt_product_options ORDER BY id LIMIT 1")
        if '|' in po:
            p, o = po.split('|')
            sid = psql(f"SET session_replication_role = replica; INSERT INTO hlt_subscriptions (account_id, product_id, option_id, qty, address_id, cycle_days, next_on, state, fail_count) VALUES ('{aid}', '{p}', '{o}', 1, gen_random_uuid(), 30, current_date + 1, 'PAUSED', 3) RETURNING id").splitlines()[-1]
        setting('lsq.sub_retry', 'off', '시험1606')
        fl = call('GET', '/lsq/me/subscriptions/fails', None, TM)
        off = call('POST', f'/lsq/me/subscriptions/{sid}/retry', None, TM)
        setting('lsq.sub_retry', 'on', '시험1606')
        on = call('POST', f'/lsq/me/subscriptions/{sid}/retry', None, TM)
        other = call('POST', f'/lsq/me/subscriptions/{sid}/retry', None, login('buyer@x.com'))
        lg = psql(f"SELECT string_agg(who || ':' || result, ',') FROM lsq_sub_retry_log WHERE sub_id = {sid or 0}")
        ok('② 회원 — 실패 목록 · 꺼짐 409 LSQ_SUB_RETRY_OFF · 켜면 지금 다시(결과 기록 · 실패로 멈춘 것은 다시 켬) · 남의 것 404',
           any(x.get('id') == sid for x in fl.get('items') or []) and off.get('_err') == 409 and off.get('code') == 'LSQ_SUB_RETRY_OFF'
           and on.get('result') in ('NOT_DUE', 'PAID', 'FAILED', 'UNCERTAIN', 'SKIPPED') and other.get('_err') == 404 and lg.startswith('MEMBER:'),
           f"{len(fl.get('items') or [])} {off.get('code')} {on} {other.get('_err')} {lg}")
        adm_run = call('POST', f'/admin/lsq/sub-retry/{sid}/run', None, TS)
        adm = call('GET', '/admin/lsq/sub-retry', None, TS)
        ok('② 운영 — 지금 다시(결과 또는 오늘 시도함 409) · 실패 중 목록(가린 이름) · 정기 배송 방식',
           (adm_run.get('result') or adm_run.get('code') == 'LSQ_SUB_TRIED_TODAY') and any(x.get('id') == sid for x in adm.get('failing') or [])
           and adm.get('subscribe', {}).get('mode') in ('ASSUME', 'LIVE'), f"{adm_run} {str(adm)[:120]}")
        if ADMIN_WEB:
            r = admin_page('/#/lsq-sub-retry', lambda pg, seen: seen.update(n=pg.locator('[data-lsq-sub]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 소개몰 › 정기 배송 결제 다시 시도(오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        if sid and not sid.startswith('!'):
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_subscription_runs WHERE sub_id = {sid}; DELETE FROM lsq_sub_retry_log WHERE sub_id = {sid}; DELETE FROM lsq_sub_pay_fails WHERE sub_id = {sid}; DELETE FROM hlt_subscriptions WHERE id = {sid};")
        keep.back()
        rm_role(aid, '1606')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
