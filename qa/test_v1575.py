"""v10.575 (docs/717) 11차 회원 · 거래 ③ 소개자 신뢰 점수 — 스위치 mtr.trust(처음 off) · 노출 순위 · 소개비 계산에 쓰지 않음
  ① (코드) 산식 표 · 부호 · 점수 함수 · 매물 · 검색 · 광고 · 정산 · 거래 코드가 이번 점수를 읽지 않음 · 문서 · 사전 열쇠
  ② (DB · API) 꺼짐 회원 on=false · 운영 산식 7 · 분포 10 · 한 사람 합 = 점수 · 404 · 422 · 부호 422 · 바꾸기 · DB 부호 · 지금 셈 · 켬 회원 점수
  (두 번 돌아도 통과 — 산식은 시작 값으로 되돌림 · 시험 중 센 점수 줄은 지움 · 설정은 되돌림)
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


def migr_has(word):
    """그 낱말이 든 마이그레이션(번호는 합칠 때 정해짐)"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


"""시험 몸통"""
MS = migr_has('fn_mtr_trust')
TR = rd('src/modules/mtr/trust.ts')
D717 = doc('717_')
# 노출 순위 · 검색 정렬 · 광고 · 소개비 계산 코드는 이번 점수를 읽지 않음
RANK_DIRS = ['src/modules/listing', 'src/modules/search', 'src/modules/market', 'src/modules/ads', 'src/modules/settlement', 'src/modules/deal',
             'src/modules/attribution', 'src/engines', 'src/modules/public', 'src/modules/catalog', 'src/modules/health', 'src/modules/mbx', 'src/modules/lpx', 'src/modules/lsx']
used = []
for d_ in RANK_DIRS:
    base = os.path.join(K, d_)
    for root, _, files in (os.walk(base) if os.path.isdir(base) else []):
        for f in files:
            if f.endswith('.ts') and re.search(r'mtr_trust|fn_mtr_trust|modules/mtr/', open(os.path.join(root, f), encoding='utf-8').read()):
                used.append(os.path.relpath(os.path.join(root, f), K))
sql_used = [l for l in re.findall(r'(?m)^.*(?:ORDER BY|exposure|rank).*$', MS) if 'mtr_trust' in l]
ok('① 코드 — 산식 표 7칸 · 부호 · 점수 함수 · 노출 순위 · 검색 · 광고 · 소개비 · 정산 코드가 이번 점수를 읽지 않음 · 문서에 못 박음 · 판',
   'CREATE TABLE IF NOT EXISTS public.mtr_trust_rules' in MS and MS.count("('BASE'") >= 1 and 'ck_mtr_trust_sign' in MS and 'FUNCTION public.fn_mtr_trust' in MS
   and not used and not sql_used and '노출 순위' in TR and '소개비' in D717 and '노출 순위' in D717 and 'fn_trust_score' in D717 and VT >= (10, 575),
   f"{VER} {used} {sql_used}")
ok('① 화면 — SB-ADM-MTR-030 · SB-MYP-MTR-020 · 나의공간 화면은 켜졌을 때만 점수 · 영어 사전 같은 열쇠',
   'SB-ADM-MTR-030' in SJ and 'SB-MYP-MTR-020' in SJ and "'/me/mtr/trust'" in rd('site/src/app/my/trust/page.tsx')
   and set(json.loads(rd('site/src/i18n/messages/ko/mtr.json') or '{}')) == set(json.loads(rd('site/src/i18n/messages/en/mtr.json') or '{}')) != set(), '')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    consent_ok.agree('buyer@x.com', PW)
    TS = login('admin@x.com')
    TB = login('buyer@x.com')
    T0 = psql("SELECT now()::text")
    old_on = getset('mtr.trust')
    rules0 = psql("SELECT string_agg(code || '=' || points || '/' || coalesce(full_at::text, ''), ',' ORDER BY code) FROM mtr_trust_rules")
    try:
        setting('mtr.trust', 'off', '1575')
        m0 = call('GET', '/me/mtr/trust', None, TB)
        ov = call('GET', '/admin/mtr/trust', None, TS)
        lk = call('GET', '/admin/mtr/trust/lookup?email=buyer@x.com', None, TS)
        items = lk.get('items') or []
        tot = sum(float(i.get('got') or 0) for i in items)
        base = next((float(i.get('got')) for i in items if i.get('code') == 'BASE'), None)
        ok('② 꺼짐 — 회원 화면 on=false(점수 없음) · 운영 산식 7 · 분포 10칸 · 한 사람 미리 보기 7칸 · 합 = 점수(0 ~ 100) · 시작 15 · 메일 가림',
           m0.get('on') is False and 'score' not in m0 and len(ov.get('rules') or []) == 7 and len(ov.get('bands') or []) == 10
           and len(items) == 7 and abs(max(0, min(100, tot)) - float(lk.get('score', -1))) <= 0.3 and base == 15.0 and '***' in (lk.get('email') or ''),
           f"{m0} {len(ov.get('rules') or [])} {len(items)} {tot} {lk.get('score')} {base} {lk.get('email')}")
        nf = call('GET', '/admin/mtr/trust/lookup?email=nobody1575@x.com', None, TS)
        be = call('GET', '/admin/mtr/trust/lookup?email=abc', None, TS)
        sg = call('PUT', '/admin/mtr/trust/rules', {'rules': [{'code': 'REPORT', 'points': 5}], 'reason': '시험 1575 부호'}, TS)
        rs = call('PUT', '/admin/mtr/trust/rules', {'rules': [{'code': 'RESPONSE', 'fullAt': 1}], 'reason': '시험 1575 기준'}, TS)
        ch = call('PUT', '/admin/mtr/trust/rules', {'rules': [{'code': 'DEAL', 'points': 30}], 'reason': '시험 1575 바꾸기'}, TS)
        db_sign = psql("UPDATE mtr_trust_rules SET points = 5 WHERE code = 'REPORT'")
        ok('② 산식 — 없는 회원 404 · 이메일 형식 422 · 신고 칸 양수 422 MTR_TRUST_SIGN · 응답 기준 1 이하 422 · 바꾸기 됨(30) · DB 도 부호 막음',
           nf.get('_err') == 404 and be.get('_err') == 422 and sg.get('_err') == 422 and sg.get('code') == 'MTR_TRUST_SIGN' and rs.get('_err') == 422
           and ch.get('ok') is True and any(r.get('code') == 'DEAL' and float(r.get('points')) == 30 for r in ch.get('rules') or []) and 'ck_mtr_trust_sign' in db_sign,
           f"{nf.get('_err')} {be.get('_err')} {sg.get('code')} {rs.get('_err')} {ch.get('ok') or ch} {db_sign[-40:]}")
        rc = call('POST', '/admin/mtr/trust/recompute', {}, TS)
        setting('mtr.trust', 'on', '1575')
        m1 = call('GET', '/me/mtr/trust', None, TB)
        ok('② 켬 — 지금 셈 됨 · 회원 화면에 점수 · 칸 7 · 노출 순위에 안 쓴다는 안내',
           isinstance(rc.get('computed'), int) and m1.get('on') is True and len(m1.get('items') or []) == 7 and 0 <= float(m1.get('score', -1)) <= 100 and '순서' in (m1.get('note') or ''),
           f"{rc} {m1.get('on')} {m1.get('score')}")
        nofn = psql("SELECT count(*) FROM fn_mtr_trust(gen_random_uuid())")
        ok('② DB — 없는 계정은 줄 없음', nofn == '0', nofn)
    finally:
        setting('mtr.trust', old_on or 'off', '1575 되돌림')
        for part in (rules0 or '').split(','):
            if '=' in part and not part.startswith('!'):
                code, rest = part.split('=', 1)
                pts, full = rest.split('/', 1)
                psql(f"UPDATE mtr_trust_rules SET points = {pts}, full_at = {full or 'NULL'} WHERE code = '{code}'")
        psql(f"DELETE FROM mtr_trust_scores WHERE computed_at >= '{T0}'")

    if ADMIN_WEB:
        r = admin_page('/#/mtr-trust', lambda pg, seen: seen.update(n=pg.locator('[data-mtr-trust]').count(), b=pg.locator('[data-mtr-trust-bands]').count(), r=pg.locator('[data-mtr-trust-rules]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 소개자 신뢰 점수(분포 · 산식 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('b') == 1 and seen.get('r') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
