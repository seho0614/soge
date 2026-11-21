"""v10.592 (docs/734) ⑧ 회원 2단계 인증(선택) — 운영자 TOTP(account_mfa · common/totp) 재사용 · sec2.member_mfa 처음 off
  ① (코드) 표 sha256 만 · 증표 전에 표 · 운영 계정 제외 · 간편 로그인 막음 · 끄기 비밀번호 + 번호 · 사용자 웹 HttpOnly 쿠키 · /login/mfa · 사전 ko · en · 문서 734 · 판
  ② (API · DB) 닫힘 422 · 켜기(TOTP 계산) · 예비 번호 10 · 로그인 표(증표 없음) · 틀린 번호 403 · 맞는 번호 증표 · 같은 표 403 · 예비 번호 로그인 · 끄기 · 운영 계정 403
  ③ (SITE) 로그인 → /login/mfa → 번호 → 들어감
  (두 번 돌아도 통과 — 시험 회원 「t1592…」 · account_mfa · 표는 끝에 지움 · 스위치는 처음 값으로 되돌림)
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
                f"DELETE FROM account_roles WHERE account_id IN {ids}; DELETE FROM accounts WHERE email LIKE '{like}';")


import base64, hashlib, hmac, struct


def totp(secret, step):
    key = base64.b32decode(secret + '=' * ((8 - len(secret) % 8) % 8))
    h = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    o = h[-1] & 15
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1000000:06d}"


MM, AU, SO = rd('src/modules/sec2/member-mfa.ts'), rd('src/modules/identity/auth.service.ts'), rd('src/modules/social/social.ts')
SS, LF, SA = rd('site/src/lib/session.ts'), rd('site/src/components/auth/LoginForm.tsx'), rd('site/src/lib/scxAuth.ts')
KO, EN = rd('site/src/i18n/messages/ko/scx.json'), rd('site/src/i18n/messages/en/scx.json')
ok('① 코드 — 운영자 2단계(account_mfa · common/totp) 재사용 · 표는 sha256 만 · 증표 전에 표 · 운영 계정 제외 · 간편 로그인 막음 · 끄기는 비밀번호 + 번호 · 문서 734 · 판 v10.592',
   "from '../../common/totp'" in MM and 'account_mfa' in MM and 'sha256(ticket)' in MM and 'CREATE TABLE IF NOT EXISTS public.sec2_mfa_tickets' in MIG
   and "const sec2Ticket = await sec2MemberMfaTicket(this.db, acc.id);\n    if (sec2Ticket) return sec2Ticket;\n\n    await this.db.query(`UPDATE accounts SET last_login_at" in AU
   and 'sec2MemberMfaBlocksSocial(this.db, accountId)' in SO and 'SEC2_MFA_STAFF' in MM and 'bcrypt.compare' in MM
   and 'sec2.member_mfa' in doc('734_') and VT >= (10, 592), VER)
ok('① 사용자 웹 — 표는 HttpOnly 쿠키(5분) · MFA_REQUIRED → /login/mfa · 2단계 화면 · 보안 칸 · 사전 ko · en 같은 키 · 새 부품에 한글 없음 · 화면 목록',
   "jar.set('sgb_mfa_t', data.ticket, { httpOnly: true" in SS and "maxAge: 300" in SS and "r.code === 'MFA_REQUIRED'" in LF and '/login/mfa' in LF
   and "'/auth/mfa/member-login'" in SA and 'SB-HOM-SCX-010' in rd('site/src/app/login/mfa/page.tsx')
   and '<ScxSecurity />' in rd('site/src/app/my/account/security/page.tsx') and KO and set(json.loads(KO)) == set(json.loads(EN or '{}'))
   and not any(re.search(r'[가-힣]', re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', rd(f'site/src/components/scx/{f}.tsx'))) for f in ('MemberMfa', 'LoginAlerts', 'MfaLoginForm'))
   and '"SB-MYP-SCX-010"' in SJ and '"SB-HOM-SCX-010"' in SJ and "import scx from './ko/scx.json'" in rd('site/src/i18n/messages/index.ts'), '')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    LIKE = 't1592%@x.com'
    rm_accounts(LIKE)
    before = psql("SELECT value FROM site_settings WHERE key = 'sec2.member_mfa'")
    try:
        me_, mid = mk_member(f'1592m{STAMP % 97}'); consent_ok.agree(me_, PW)
        se_, sid_ = mk_staff(f'1592s{STAMP % 97}', 'ADMIN'); consent_ok.agree(se_, PW)
        sec2_set(TS, {'memberMfa': False}, '1592')
        TM = login(me_)
        z0 = call('POST', '/me/mfa/setup', {}, TM)
        sec2_set(TS, {'memberMfa': True}, '1592')
        st0 = call('GET', '/me/mfa', None, TM)
        su = call('POST', '/me/mfa/setup', {}, TM)
        secret = su.get('secret') or ''
        now = int(time.time() // 30)
        en = call('POST', '/me/mfa/enable', {'code': totp(secret, now)}, TM) if secret else {}
        st1 = call('GET', '/me/mfa', None, TM)
        ok('② 켜기 — 닫혀 있으면 422 SEC2_MFA_OFF · 열면 상태 available · 등록 시작(비밀값 · otpauth) · 앱 번호로 켬 · 예비 번호 10 · 다시 등록 409',
           z0.get('code') == 'SEC2_MFA_OFF' and st0.get('available') is True and st0.get('enrolled') is False and secret and str(su.get('uri', '')).startswith('otpauth://')
           and en.get('ok') is True and len(en.get('backupCodes') or []) == 10 and st1.get('enrolled') is True and st1.get('backupLeft') == 10
           and call('POST', '/me/mfa/setup', {}, TM).get('_err') == 409, f"{z0.get('code')} {st0} {list(su.keys())} {str(en)[:80]} {st1}")
        codes = en.get('backupCodes') or []
        l1 = login_full(me_)
        tk = l1.get('ticket') or ''
        bad = call('POST', '/auth/mfa/member-login', {'ticket': tk, 'code': '000000' if totp(secret, now + 1) != '000000' else '111111'})
        good = call('POST', '/auth/mfa/member-login', {'ticket': tk, 'code': totp(secret, now + 1)})
        again = call('POST', '/auth/mfa/member-login', {'ticket': tk, 'code': codes[0] if codes else '00000-00000'})
        ok('② 로그인 — 비밀번호 뒤 mfaRequired · 표(증표 없음) · 틀린 번호 403 MFA_INVALID · 맞는 번호 증표 · 같은 표 다시 403 SEC2_TICKET_INVALID · DB 에는 해시만',
           l1.get('mfaRequired') is True and not l1.get('accessToken') and len(tk) >= 40 and bad.get('code') == 'MFA_INVALID'
           and bool(good.get('accessToken')) and again.get('code') == 'SEC2_TICKET_INVALID'
           and psql(f"SELECT count(*) FROM sec2_mfa_tickets WHERE token_hash = '{hashlib.sha256(tk.encode()).hexdigest()}' AND used_at IS NOT NULL") == '1'
           and psql(f"SELECT count(*) FROM sec2_mfa_tickets WHERE token_hash = '{tk}'") == '0', f"{str(l1)[:90]} {bad.get('code')} {bool(good.get('accessToken'))} {again.get('code')}")
        l2 = login_full(me_)
        bk = call('POST', '/auth/mfa/member-login', {'ticket': l2.get('ticket') or '', 'code': codes[1] if len(codes) > 1 else ''})
        TB = bk.get('accessToken')
        d0 = call('POST', '/me/mfa/disable', {'password': '틀린비밀번호1592!', 'code': codes[2] if len(codes) > 2 else '00000-00000'}, TB)
        d1 = call('POST', '/me/mfa/disable', {'password': PW, 'code': codes[2] if len(codes) > 2 else ''}, TB)
        l3 = login_full(me_)
        ok('② 예비 번호 · 끄기 — 예비 번호로 로그인 · 비밀번호 틀리면 403 · 비밀번호 + 예비 번호로 끔 · 끈 뒤 로그인은 바로 증표 · 감사 MFA_ENABLE · MFA_DISABLE(member)',
           bool(TB) and d0.get('_err') == 403 and d1.get('ok') is True and bool(l3.get('accessToken')) and not l3.get('mfaRequired')
           and psql(f"SELECT count(*) FROM audit.audit_logs WHERE target_id = '{mid}' AND action IN ('MFA_ENABLE', 'MFA_DISABLE') AND after_data->>'member' = 'true'") == '2',
           f"{bool(TB)} {d0.get('_err')} {d1} {str(l3)[:60]}")
        TSF = login(se_)
        sf = call('GET', '/me/mfa', None, TSF)
        sd = call('POST', '/me/mfa/disable', {'password': PW, 'code': '123456'}, TSF)
        ok('② 운영 계정 — 상태 staff · 회원 화면에서 끄기 403 SEC2_MFA_STAFF · 로그인 응답은 표가 아니라 증표(운영 화면 MfaGate 그대로)',
           sf.get('staff') is True and sd.get('code') == 'SEC2_MFA_STAFF' and bool(TSF), f"{sf} {sd}")
        if SITE:
            ue, uid = mk_member(f'1592u{STAMP % 97}'); consent_ok.agree(ue, PW)
            TU = login(ue)
            us = call('POST', '/me/mfa/setup', {}, TU).get('secret') or ''
            n2 = int(time.time() // 30)
            call('POST', '/me/mfa/enable', {'code': totp(us, n2)}, TU)

            def run(b, seen, perr):
                ps = site_login(b, perr, ue)
                seen['url1'] = ps.url
                ps.fill('#mfa-code', totp(us, n2 + 1)); ps.click('form[data-mfa-login] button'); ps.wait_for_timeout(3000)
                seen['url2'] = ps.url
            u = ui(run)
            if u is not None:
                seen, perr = u
                ok('③ 화면 — 로그인 → /login/mfa → 번호 → 들어감',
                   '/login/mfa' in seen.get('url1', '') and '/login' not in seen.get('url2', '/login') and not perr, f"{seen} {perr[:2]}")
    finally:
        if before:
            sec2_set(TS, {'memberMfa': before == 'on'}, '1592 되돌림')
        rm_accounts(LIKE)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
