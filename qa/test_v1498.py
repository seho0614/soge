"""v10.498 (D272 · docs/636) 카카오 · 네이버 간편 로그인 — 대표 11/20 「㊷ ②」
  ① (코드) 표 · 설정 처음 off · 외부 연동 SOCIAL(17) · 받는 키 · state · PKCE · 묶음 · 저절로 합치지 않음 · 운영 역할 막음 · 사이트 처리기 · 이어서 · 내 간편 로그인 · 메뉴 · 화면 · 문서(처리방침)
  ② (API · DB · 간주) 꺼짐 422 · 처리방침 없이 LIVE 422 · state 위조 · 재사용 409 · 처음 회원 가입 · 다시 로그인 · 마지막 연결 · 첫 비밀번호 · 같은 이메일은 비밀번호 확인 뒤 연결 · 운영 역할 막음 · 정리
  ③ (화면) 로그인 화면 카카오 단추
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
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로) — 빈 값은 NULL 로(무늬 트리거가 '' 를 막는 키가 있음)"""
    v = 'NULL' if value is None or value == '' else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def callh(m_, p, b=None, t=None, headers=None):
    """머리글을 더 붙여 부름(감시 토큰 등)"""
    hd = {'content-type': 'application/json', **(headers or {})}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def http_get(url):
    """사용자 웹 정적 파일 · 화면(상태 · 머리글 · 본문 앞 2만 자)"""
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0 qa'}), timeout=60)
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(200000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, {}, ''
    except Exception as e:
        return 0, {}, str(e)[:120]


STAMP = int(time.time()) % 1000000


M72 = migr('D272_')
SV, SP, SCT, AM = rd('src/modules/social/social.ts'), rd('src/modules/social/social.provider.ts'), rd('src/modules/social/social.controller.ts'), rd('src/app.module.ts')
RG, SS, VI, EV = rd('src/common/integration/registry.ts'), rd('src/common/integration/secret.service.ts'), rd('scripts/verify-invariants.sh'), rd('deploy/aws/env.production.example')
LG, ST_, CB, CT = rd('site/src/app/login/page.tsx'), rd('site/src/app/login/social/[provider]/route.ts'), rd('site/src/app/login/social/[provider]/callback/route.ts'), rd('site/src/app/login/social/continue/page.tsx')
MS, SA, UI, MN = rd('site/src/app/my/account/social/page.tsx'), rd('site/src/lib/socialAuth.ts'), rd('web/src/app/admin/Uptime.tsx'), rd('web/src/lib/adminMenu.ts')
ok('① 코드 — D272 연결 · state · 이어서 · 기록 표 · social.kakao · naver off · 간주 · 처리방침 확인 off · 외부 연동 SOCIAL(17) · 받는 키 4(CHECK · 함수 · GEOIP 유지) · state 지문 · PKCE S256 · 묶음 대조 · 저절로 합치지 않음(비밀번호 확인) · 운영 역할 막음 · 운영 서버 간주 막음 · 사이트 시작 · 돌아옴 처리기 · 이어서 · 내 간편 로그인 · 로그인 화면 단추 · 메뉴 soc-login · 연동 수 17 · .env 예시 · 화면 UPT-020 · 문서 636(처리방침 고칠 곳) · 판 v10.498',
   'CREATE TABLE IF NOT EXISTS public.soc_links' in M72 and 'CREATE TABLE IF NOT EXISTS public.soc_states' in M72 and 'CREATE TABLE IF NOT EXISTS public.soc_pending' in M72
   and "('social.kakao', 'off'" in M72 and "('social.naver', 'off'" in M72 and "('social.mode', 'ASSUME'" in M72 and "('social.privacy_ok', 'off'" in M72
   and "VALUES ('SOCIAL', '간편 로그인(카카오 · 네이버)'" in M72 and "('SOCIAL','NAVER_CLIENT_SECRET')" in M72 and "('GEOIP','GEOIP_API_KEY')" in M72 and "'NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET') THEN" in M72
   and "code_challenge_method: 'S256'" in SP and 'subjectHash' in SP and "'SOCIAL_STATE_INVALID'" in SV and 'binding_hash !== sha(' in SV and "'SOCIAL_STAFF_NOT_ALLOWED'" in SV
   and "'SOCIAL_ASSUME_PROD'" in SV and "'SOCIAL_NO_MATCH'" in SV and 'bcrypt.compare' in SV and "'SOCIAL_LAST_METHOD'" in SV and "@Post('auth/social/:provider/callback')" in SCT
   and 'SocialAuthService' in AM and "code: 'SOCIAL'" in RG and "name: 'NAVER_CLIENT_SECRET'" in SS and ('if [ "$n" = "17" ]' in VI or 'if [ "$n" = "18" ]' in VI) and 'NAVER_CLIENT_SECRET=' in EV
   and '<SocialButtons next={nextUrl}' in LG and 'setSocCookie(SOC_BIND' in ST_ and "/auth/social/${provider}/callback" in CB and 'SB-HOM-UPT-020' in CT and 'SB-MYP-UPT-010' in MS
   and "httpOnly: true" in SA and 'export function SocLogin' in UI and "['soc-login', '간편 로그인']" in MN and '"SB-HOM-UPT-020"' in SJ and '"SB-ADM-UPT-020"' in SJ and '"SB-MYP-UPT-010"' in SJ
   and '처리방침 고칠 곳' in doc('636_') and VT >= (10, 498), VER)

import base64, secrets
RU = 'http://localhost:15174/login/social/kakao/callback'


def state_of(url):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url or '').query)
    return (q.get('state') or [''])[0]


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('social.kakao', 'social.naver', 'social.mode', 'social.privacy_ok')
    s0 = {k: getset(k) for k in keys}
    es, asf = mk_staff('1498a', 'ADMIN')
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1498', true); INSERT INTO account_roles (account_id, role) VALUES ('{asf}', 'MEMBER') ON CONFLICT DO NOTHING; COMMIT;")
    em2, aid2 = mk_staff('1498m', None)
    psql(f"INSERT INTO account_roles (account_id, role) VALUES ('{aid2}', 'MEMBER') ON CONFLICT DO NOTHING")
    mark = psql("SELECT coalesce(max(id), 0) FROM soc_states")
    mark = mark if mark.isdigit() else '0'
    new_email = f't1498s{STAMP}@x.com'
    ids = [asf, aid2]
    try:
        call('PUT', '/admin/social/settings', {'kakao': False, 'naver': False, 'mode': 'ASSUME', 'privacyOk': False, 'reason': '시험 1498 처음'}, TS)
        b0 = secrets.token_urlsafe(32)
        s_off = call('POST', '/auth/social/kakao/start', {'redirectUri': RU, 'binding': b0})
        TA = login(es)
        adm = call('PUT', '/admin/social/settings', {'kakao': True, 'reason': '시험 1498 ADMIN'}, TA)
        live = call('PUT', '/admin/social/settings', {'kakao': True, 'mode': 'LIVE', 'reason': '시험 1498 LIVE'}, TS)
        on = call('PUT', '/admin/social/settings', {'kakao': True, 'reason': '시험 1498 켬'}, TS)
        pv = call('GET', '/auth/social/providers')
        prod = not any(x.get('provider') == 'KAKAO' for x in pv.get('items', []))
        ok('② 설정 — 꺼짐이면 시작 422 SOCIAL_OFF · ADMIN 바꾸기 403 · 처리방침 확인 없이 LIVE 422 · 켜기(간주) · 단추 목록에 카카오(운영 서버면 비어 있음)',
           s_off.get('code') == 'SOCIAL_OFF' and adm.get('_err') == 403 and live.get('code') in ('SOCIAL_PRIVACY_FIRST', 'SOCIAL_ASSUME_PROD') and on.get('ok') is True,
           f"{s_off.get('code')} {adm.get('_err')} {live.get('code')} {on.get('ok') or on} prod={prod}")
        if prod:
            print('  (운영 빌드 — 간주 로그인이 막혀 흐름 시험 건너뜀)')
        else:
            b1 = secrets.token_urlsafe(32)
            st = call('POST', '/auth/social/kakao/start', {'redirectUri': RU, 'binding': b1})
            s1 = state_of(st.get('authorizeUrl'))
            tag = f't1498n{STAMP}'
            wrong = call('POST', '/auth/social/kakao/callback', {'code': f'ASSUME.{tag}', 'state': s1, 'binding': secrets.token_urlsafe(32), 'redirectUri': RU})
            again = call('POST', '/auth/social/kakao/callback', {'code': f'ASSUME.{tag}', 'state': s1, 'binding': b1, 'redirectUri': RU})
            badru = call('POST', '/auth/social/kakao/start', {'redirectUri': 'https://evil.example/cb', 'binding': b1})
            b2 = secrets.token_urlsafe(32)
            s2 = state_of(call('POST', '/auth/social/kakao/start', {'redirectUri': RU, 'binding': b2}).get('authorizeUrl'))
            p1 = call('POST', '/auth/social/kakao/callback', {'code': f'ASSUME.{tag}', 'state': s2, 'binding': b2, 'redirectUri': RU})
            tk = p1.get('ticket') or ''
            pvw = call('POST', '/auth/social/pending/view', {'ticket': tk})
            req_terms = [t['code'] for t in (call('GET', '/terms/required') or []) if isinstance(t, dict) and t.get('isRequired')]
            noagree = call('POST', '/auth/social/pending/signup', {'ticket': tk, 'name': '시험1498', 'email': new_email, 'agreedTerms': []})
            su = call('POST', '/auth/social/pending/signup', {'ticket': tk, 'name': '시험1498', 'email': new_email, 'agreedTerms': req_terms})
            nid = psql(f"SELECT id FROM accounts WHERE email = '{new_email}'")
            if nid and '!' not in nid:
                ids.append(nid)
            reuse = call('POST', '/auth/social/pending/signup', {'ticket': tk, 'name': '시험1498', 'email': new_email, 'agreedTerms': req_terms})
            b3 = secrets.token_urlsafe(32)
            s3 = state_of(call('POST', '/auth/social/kakao/start', {'redirectUri': RU, 'binding': b3}).get('authorizeUrl'))
            lg = call('POST', '/auth/social/kakao/callback', {'code': f'ASSUME.{tag}', 'state': s3, 'binding': b3, 'redirectUri': RU})
            hashrow = psql(f"SELECT (subject_hash ~ '^[0-9a-f]{{64}}$')::text || '|' || (position('{tag}' in subject_hash) = 0)::text FROM soc_links WHERE account_id = '{nid}'")
            ok('② 흐름(간주) — 시작 → 간주 주소 · 다른 묶음 409 · 쓴 state 다시 409 · 바깥 돌아올 주소 422 · 처음 회원 PENDING(이메일 받기) · 약관 없이 422 · 가입 → 증표 · 이어서 표 다시 409 · 같은 회원 다시 → LOGIN · 회원 번호는 지문만',
                   'ASSUME.' in (st.get('authorizeUrl') or '') and wrong.get('code') == 'SOCIAL_STATE_INVALID' and again.get('code') == 'SOCIAL_STATE_INVALID' and badru.get('code') == 'SOCIAL_REDIRECT'
                   and p1.get('result') == 'PENDING' and pvw.get('needEmail') is True and pvw.get('provider') == 'KAKAO'
                   and (noagree.get('code') == 'REQUIRED_TERM' or not req_terms) and su.get('result') == 'SIGNUP' and bool(su.get('accessToken'))
                   and reuse.get('code') == 'SOCIAL_TICKET_INVALID' and lg.get('result') == 'LOGIN' and bool(lg.get('accessToken')) and hashrow == 'true|true',
                   f"{(st.get('authorizeUrl') or '')[:60]} {wrong.get('code')} {again.get('code')} {badru.get('code')} {p1.get('result')} {pvw} {noagree.get('code')} {su.get('result') or su} {reuse.get('code')} {lg.get('result') or lg} {hashrow}")
            T_N = lg.get('accessToken')
            m1 = call('GET', '/me/social', None, T_N)
            last = call('DELETE', '/me/social/kakao', None, T_N)
            pwc = call('POST', '/me/social/password', {'password': 'Sgb-dev-1498!pw'}, T_N)
            pw2 = call('POST', '/me/social/password', {'password': 'Sgb-dev-1498!pw'}, T_N)
            unl = call('DELETE', '/me/social/kakao', None, T_N)
            ok('② 내 간편 로그인 — 연결 1 · 비밀번호 없음 · 마지막 연결 끊기 422 · 첫 비밀번호 만들기 · 다시 409 · 그 뒤 끊기',
                   len(m1.get('links') or []) == 1 and m1.get('hasPassword') is False and last.get('code') == 'SOCIAL_LAST_METHOD' and pwc.get('ok') is True
                   and pw2.get('code') == 'PASSWORD_EXISTS' and unl.get('ok') is True,
                   f"{m1} {last.get('code')} {pwc.get('ok') or pwc} {pw2.get('code')} {unl.get('ok') or unl}")
            etag = f't1498e{STAMP}'
            b4 = secrets.token_urlsafe(32)
            s4 = state_of(call('POST', '/auth/social/kakao/start', {'redirectUri': RU, 'binding': b4}).get('authorizeUrl'))
            code4 = f'ASSUME.{etag}.' + base64.urlsafe_b64encode(em2.encode()).decode().rstrip('=')
            p4 = call('POST', '/auth/social/kakao/callback', {'code': code4, 'state': s4, 'binding': b4, 'redirectUri': RU})
            t4 = p4.get('ticket') or ''
            dup = call('POST', '/auth/social/pending/signup', {'ticket': t4, 'name': '시험1498', 'agreedTerms': req_terms})
            wpw = call('POST', '/auth/social/pending/link', {'ticket': t4, 'password': 'wrong-password-1498'})
            lk = call('POST', '/auth/social/pending/link', {'ticket': t4, 'password': PW})
            lrow = psql(f"SELECT count(*) FROM soc_links WHERE account_id = '{aid2}' AND provider = 'KAKAO'")
            TSF = login(es)
            stf = call('POST', '/me/social/kakao/start', {'redirectUri': RU, 'binding': secrets.token_urlsafe(32)}, TSF)
            ev = psql(f"SELECT count(DISTINCT kind) FROM soc_events WHERE account_id IN ('{aid2}', '{nid}')")
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'soc-login'")
            nint = psql("SELECT count(*)::text || '|' || (SELECT secret_key_name FROM integrations WHERE code = 'SOCIAL') FROM integrations")
            key = psql("BEGIN; SET LOCAL app.enc_key = 'inv-check-enc-key-0123456789abcdef'; SELECT o_last4 FROM fn_integ_secret_set('SOCIAL', 'NAVER_CLIENT_ID', 'qa1498naverid', NULL); ROLLBACK;")
            vwa = call('GET', '/admin/social', None, TA)
            ok('② 같은 이메일 — 확인된 이메일이면 연결 후보 · 가입은 409 DUPLICATE(저절로 합치지 않음) · 틀린 비밀번호 403 · 맞으면 연결 · 로그인 · 운영 역할 연결 403 · 기록 · 권한 주소 2 · 연동 17 · SOCIAL 키 받음 · 운영 화면 보기',
                   p4.get('result') == 'PENDING' and p4.get('emailMatch') is True and dup.get('code') == 'DUPLICATE' and wpw.get('_err') == 403 and wpw.get('code') == 'INVALID_CREDENTIALS'
                   and lk.get('result') == 'LOGIN' and lk.get('linked') is True and lrow == '1' and stf.get('_err') == 403 and int(ev or 0) >= 3 and rmap == '2'
                   and nint == '17|NAVER_CLIENT_SECRET' and key.endswith('erid') and 'settings' in vwa,
                   f"{p4.get('result')} {p4.get('emailMatch')} {dup.get('code')} {wpw.get('code')} {lk.get('result') or lk} {lrow} {stf.get('_err')} {stf.get('code')} {ev} {rmap} {nint} {key[-20:]} {'settings' in vwa}")
        if SITE and not prod:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                seen['btn'] = pg.locator('[data-social="KAKAO"]').count()
                if not seen['btn']:   # 사용자 웹은 켜진 업체 목록을 30초 담아 둠 — 시험 앞에서 「꺼짐」을 담았으면 한 번 지나고 다시 엶
                    pg.wait_for_timeout(32000); pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    seen['btn'] = pg.locator('[data-social="KAKAO"]').count()
                seen['href'] = pg.locator('[data-social="KAKAO"]').first.get_attribute('href') if seen['btn'] else None
            r = ui(run)
            if r is not None:
                seen, perr = r
                ok('③ 사용자 웹 — 로그인 화면 카카오 단추(켜졌을 때) · 시작 주소 /login/social/kakao', seen.get('btn') == 1 and str(seen.get('href') or '').startswith('/login/social/kakao?next=') and not perr, f'{seen} {perr[:2]}')
    finally:
        rm_role(asf, '1498')
        call('PUT', '/admin/social/settings', {'kakao': False, 'naver': False, 'reason': '시험 1498 끔'}, TS)
        for k in keys:
            setting(k, s0[k] or None, '1498 되돌림')
        idl = ', '.join(f"'{x}'" for x in ids if x and '!' not in x)
        psql(f"SET session_replication_role = replica; DELETE FROM soc_links WHERE account_id IN ({idl}); DELETE FROM soc_events WHERE account_id IN ({idl}); "
             f"DELETE FROM soc_states WHERE id > {int(mark)} AND redirect_uri = '{RU}'; DELETE FROM soc_pending WHERE created_at > now() - interval '1 hour' AND subject_hash IN "
             f"(SELECT encode(sha256(convert_to('soc|KAKAO|assume-' || x, 'UTF8')), 'hex') FROM unnest(ARRAY['t1498n{STAMP}', 't1498e{STAMP}']) x);")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
