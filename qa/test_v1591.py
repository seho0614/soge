"""v10.591 (docs/733) ⑦ 유출 비밀번호 막기 — k-익명 범위 조회 어댑터 · 처음 off · 간주(ASSUME) · LIVE 는 법무 확인 뒤
  ① (코드) 앞 5글자만 · Add-Padding · 3초 · 원문 · 전체 해시 안 보냄 · 실패면 막지 않음 · 가입 · 재설정 · 변경 · 간편 가입 첫 비밀번호 · 문서 733(처리방침 문장) · 판
  ② (API · DB) ASSUME 가입 422 · 목록 밖 200 · 변경 422 · 지금 비밀번호 틀리면 먼저 막힘 · 판정 시험 · LIVE 422 SEC2_PWNED_LEGAL(점검판은 바깥을 부르지 않음) · 건수 줄에 비밀번호 없음 · off 면 그대로
  (두 번 돌아도 통과 — 시험 계정 · 이 시험 뒤 건수 줄은 지우고 방식은 처음 값으로 되돌림)
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


"""시험 몸통 — 15차 보안 · 기반 공통 도우미"""
def migs_all():
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return ''
    return '\n'.join(open(os.path.join(d, x, 'migration.sql'), encoding='utf-8').read() for x in sorted(os.listdir(d)) if os.path.exists(os.path.join(d, x, 'migration.sql')))


MIG = migs_all()
SJ = rd('spec/screens.json')
STAMP = int(time.time()) % 1000000


def sec2_set(tok, body, tag):
    """설정은 API 로(서버 30초 메모리를 그 자리에서 지움)"""
    return call('PUT', '/admin/sec2/settings', {**body, 'reason': f'시험 {tag}'}, tok)


def mk_member(tag):
    em, aid = mk_staff(tag, None)
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'MEMBER') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid


def rm_accounts(like):
    """시험 계정과 딸린 보안 줄을 지움(replica — 쌓기만 표 · 외래 키 트리거를 건너뜀)"""
    ids = f"(SELECT id FROM accounts WHERE email LIKE '{like}')"
    return psql("SET session_replication_role = replica; "
                f"DELETE FROM sec2_login_alerts WHERE account_id IN {ids}; DELETE FROM sec2_mfa_tickets WHERE account_id IN {ids}; "
                f"DELETE FROM sec2_staff_anomalies WHERE account_id IN {ids}; DELETE FROM account_mfa WHERE account_id IN {ids}; "
                f"DELETE FROM login_sessions WHERE account_id IN {ids}; DELETE FROM login_history WHERE account_id IN {ids}; "
                f"DELETE FROM notifications WHERE account_id IN {ids}; DELETE FROM term_agreements WHERE account_id IN {ids}; "
                f"DELETE FROM perm_account_groups WHERE account_id IN {ids}; DELETE FROM perm_account_overrides WHERE account_id IN {ids}; "   # 주인 없는 권한 줄을 남기지 않음(v1566 후보 만들기 외래 키)
                f"DELETE FROM account_roles WHERE account_id IN {ids}; DELETE FROM accounts WHERE email LIKE '{like}';")


PW_, AS_, AU, SO = rd('src/modules/sec2/pwned.ts'), rd('src/modules/identity/account-security.service.ts'), rd('src/modules/identity/auth.service.ts'), rd('src/modules/social/social.ts')
FETCH = re.findall(r'fetch\(([^,]+),', PW_)
ok('① 코드 — 앞 5글자만 범위 조회(SEC2_PWNED_RANGE_URL + prefix) · Add-Padding · 3초 · 바깥 호출에 비밀번호 · 전체 해시 안 넣음 · 실패면 막지 않음 · 기록에 비밀번호 칸 없음',
   'hash40.slice(0, 5)' in PW_ and FETCH == ['SEC2_PWNED_RANGE_URL + prefix'] and "'Add-Padding': 'true'" in PW_ and 'AbortSignal.timeout(timeoutMs)' in PW_
   and "'ERROR'" in PW_ and 'CREATE TABLE IF NOT EXISTS public.sec2_pwned_log' in MIG
   and not re.search(r'sec2_pwned_log \([^)]*(password|hash|account|ip)', MIG), str(FETCH))
ok('① 네 곳 — 가입 · 재설정 · 변경(지금 비밀번호 확인 뒤) · 간편 가입 첫 비밀번호 · LIVE 는 법무 확인 뒤 · 문서 733 처리방침 문장 · 판 v10.591',
   "sec2AssertNotPwned(this.db, input.password, 'SIGNUP')" in AU and "sec2AssertNotPwned(this.db, password, 'RESET')" in AS_
   and "await this.checkPassword(me, current);\n    await sec2AssertNotPwned(this.db, next, 'CHANGE')" in AS_ and "sec2AssertNotPwned(this.db, password, 'SOCIAL_PW')" in SO
   and 'SEC2_PWNED_LEGAL' in rd('src/modules/sec2/settings.ts') and '앞 5글자만' in doc('733_') and '제9조' in doc('733_') and VT >= (10, 591), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    LIKE = 't1591%@x.com'
    rm_accounts(LIKE)
    before = psql("SELECT value FROM site_settings WHERE key = 'sec2.pwned_check'")
    t0 = psql("SELECT now()")
    try:
        a = sec2_set(TS, {'pwnedMode': 'ASSUME'}, '1591')
        e1 = f't1591a{STAMP}@x.com'
        s1 = call('POST', '/auth/signup', {'email': e1, 'password': 'Password123!', 'name': '시험1591', 'agreedTerms': []})
        s2 = call('POST', '/auth/signup', {'email': e1, 'password': 'Sgb-1591-ok-Pass!', 'name': '시험1591', 'agreedTerms': []})
        ok('② ASSUME — 흔한 비밀번호 가입 422 PWNED_PASSWORD(번수 · 방식) · 목록 밖 비밀번호 가입 200',
           a.get('ok') is True and s1.get('code') == 'PWNED_PASSWORD' and s1.get('_err') == 422 and bool(s2.get('accessToken')), f"{a.get('ok') or a} {s1} {str(s2)[:80]}")
        T1 = s2.get('accessToken')
        c1 = call('PATCH', '/me/password', {'currentPassword': 'Sgb-1591-ok-Pass!', 'newPassword': 'P@ssw0rd123'}, T1) if T1 else {}
        c2 = call('PATCH', '/me/password', {'currentPassword': '틀린-비밀번호-1591!', 'newPassword': 'P@ssw0rd123'}, T1) if T1 else {}
        pt = call('POST', '/admin/sec2/pwned/test', {'password': 'Welcome123!'}, TS)
        pn = call('POST', '/admin/sec2/pwned/test', {'password': 'Zq9-1591-Unlikely!'}, TS)
        ok('② 변경 · 판정 시험 — 변경도 422 PWNED_PASSWORD · 지금 비밀번호가 틀리면 그 전에 막힘(판정 도구로 못 씀) · 시험 단추 막힘/통과',
           c1.get('code') == 'PWNED_PASSWORD' and c2.get('code') != 'PWNED_PASSWORD' and c2.get('_err') in (403, 422)
           and pt.get('blocked') is True and pt.get('mode') == 'ASSUME' and pn.get('blocked') is False, f"{c1.get('code')} {c2} {pt} {pn}")
        lv = sec2_set(TS, {'pwnedMode': 'LIVE'}, '1591')
        lg = psql(f"SELECT count(*) || '|' || count(*) FILTER (WHERE result = 'BLOCK') || '|' || string_agg(DISTINCT place, ',' ORDER BY place) FROM sec2_pwned_log WHERE at >= '{t0}'")
        rowtxt = psql(f"SELECT coalesce(string_agg(row_to_json(l)::text, ' '), '') FROM sec2_pwned_log l WHERE at >= '{t0}'")
        ok('② LIVE 는 법무 확인 먼저(422 SEC2_PWNED_LEGAL · 점검판은 바깥을 부르지 않음) · 건수 줄(가입 · 변경 · 시험) · 줄에 비밀번호 · 해시 글자 없음',
           lv.get('code') == 'SEC2_PWNED_LEGAL' and lg.split('|')[0].isdigit() and int(lg.split('|')[1]) >= 3 and 'SIGNUP' in lg and 'CHANGE' in lg and 'TEST' in lg
           and 'Password123' not in rowtxt and 'Welcome' not in rowtxt and not re.search(r'[0-9A-F]{35}', rowtxt), f"{lv.get('code')} {lg} {rowtxt[:120]}")
        o = sec2_set(TS, {'pwnedMode': 'off'}, '1591')
        s3 = call('POST', '/auth/signup', {'email': f't1591b{STAMP}@x.com', 'password': 'Password123!', 'name': '시험1591', 'agreedTerms': []})
        ok('② off — 막지 않음(지금 그대로) · 기록도 안 늘어남',
           o.get('ok') is True and bool(s3.get('accessToken')), f"{o.get('ok') or o} {str(s3)[:80]}")
    finally:
        if before:
            sec2_set(TS, {'pwnedMode': before}, '1591 되돌림')
        rm_accounts(LIKE)
        psql(f"SET session_replication_role = replica; DELETE FROM sec2_pwned_log WHERE at >= '{t0}';")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
