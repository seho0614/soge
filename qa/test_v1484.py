"""v10.484 (D268 · docs/622) 운영자 패스키(WebAuthn) — 등록 · 확인 · 2단계 인증 대신 쓸지 SUPER 설정 · 새 npm 없음 · 처음 꺼짐
  ① (코드) D268 패스키 · 확인 문제 · 로그인 기기 passkey_at · 가드 · 설정 admin.passkey off · EXTRA · 서비스(SPKI · authData · 서명 · 서명 횟수) · AuthGuard PASSKEY_REQUIRED · 미들웨어 · 화면 SCU-020 · 문서 622
  ② (API · DB) 회원 403 · 다른 출처 422 · 등록 · 같은 패스키 409 · 새 로그인 403 PASSKEY_REQUIRED · 확인 · 다시 쓰기 422 · 서명 횟수 그대로 403(복제 의심 알림) · 틀린 서명 403 · DB 막음 · 끄기 · REPLACE_MFA(세무사 — 패스키로 2단계 확인됨) · 도메인 없이 켜기 422
  ③ (화면) 권한 계층 › 내 2단계 인증 › 패스키 구역
  시험 기기는 파이썬으로 만든 P-256 키(ES256 · 표준 라이브러리만)
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


import base64, hashlib, hmac, secrets, struct


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def totp(secret, step, digits=6):
    key = base64.b32decode(secret.upper() + '=' * (-len(secret) % 8))
    h = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    o_ = h[-1] & 15
    return str((struct.unpack('>I', h[o_:o_ + 4])[0] & 0x7fffffff) % 10 ** digits).zfill(digits)


def mfa_token(t):
    """세무사는 늘 2단계(D257) — 등록 · 켜기 뒤 확인된 증표"""
    sec = call('POST', '/auth/mfa/setup', None, t).get('secret') or ''
    if not sec: return t
    return call('POST', '/auth/mfa/enable', {'code': totp(sec, int(time.time() // 30))}, t).get('accessToken') or t


# ── 시험용 P-256 기기(ES256) — 표준 라이브러리만 ──
P_ = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
A_ = P_ - 3
N_ = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
G_ = (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296, 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5)


def _add(p1, p2):
    if p1 is None: return p2
    if p2 is None: return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2 and (y1 + y2) % P_ == 0: return None
    l_ = (3 * x1 * x1 + A_) * pow(2 * y1, -1, P_) % P_ if p1 == p2 else (y2 - y1) * pow(x2 - x1, -1, P_) % P_
    x3 = (l_ * l_ - x1 - x2) % P_
    return (x3, (l_ * (x1 - x3) - y1) % P_)


def _mul(k, pt):
    r_ = None
    while k:
        if k & 1: r_ = _add(r_, pt)
        pt = _add(pt, pt); k >>= 1
    return r_


def _der_int(v):
    b = v.to_bytes((v.bit_length() + 8) // 8, 'big')
    return b'\x02' + bytes([len(b)]) + b


class Dev:
    def __init__(self):
        self.d = secrets.randbelow(N_ - 1) + 1
        self.q = _mul(self.d, G_)
        self.cred = secrets.token_bytes(32)
        self.count = 0

    def spki(self):
        return bytes.fromhex('3059301306072a8648ce3d020106082a8648ce3d030107034200') + b'\x04' + self.q[0].to_bytes(32, 'big') + self.q[1].to_bytes(32, 'big')

    def sign(self, msg):
        z = int.from_bytes(hashlib.sha256(msg).digest(), 'big')
        while True:
            k = secrets.randbelow(N_ - 1) + 1
            r_ = _mul(k, G_)[0] % N_
            s_ = pow(k, -1, N_) * (z + r_ * self.d) % N_
            if r_ and s_: break
        body = _der_int(r_) + _der_int(s_)
        return b'\x30' + bytes([len(body)]) + body


b64u = lambda b: base64.urlsafe_b64encode(b).decode().rstrip('=')
RP = 'localhost'
ORIGIN = 'http://localhost:15173'


def reg_body(dev, ch, origin=ORIGIN, label='시험 1484 기기'):
    cd = json.dumps({'type': 'webauthn.create', 'challenge': ch, 'origin': origin}).encode()
    ad = hashlib.sha256(RP.encode()).digest() + bytes([0x45]) + struct.pack('>I', 0) + bytes(16) + struct.pack('>H', len(dev.cred)) + dev.cred + b'\xa0'
    return {'id': b64u(dev.cred), 'clientDataJSON': b64u(cd), 'authenticatorData': b64u(ad), 'publicKey': b64u(dev.spki()), 'publicKeyAlgorithm': -7, 'transports': ['internal'], 'label': label}


def ver_body(dev, ch, count=None, bad_sig=False):
    dev.count = dev.count + 1 if count is None else count
    cd = json.dumps({'type': 'webauthn.get', 'challenge': ch, 'origin': ORIGIN}).encode()
    ad = hashlib.sha256(RP.encode()).digest() + bytes([0x05]) + struct.pack('>I', dev.count)
    sig = dev.sign(ad + hashlib.sha256(cd).digest())
    if bad_sig: sig = Dev().sign(ad + hashlib.sha256(cd).digest())
    return {'id': b64u(dev.cred), 'clientDataJSON': b64u(cd), 'authenticatorData': b64u(ad), 'signature': b64u(sig)}


M68 = migr('D268_')
PK, PC, AUTH, MID, AP, UI, GATE = (rd('src/modules/identity/passkey.ts'), rd('src/modules/identity/passkey.controller.ts'), rd('src/core/auth.ts'), rd('src/modules/identity/auth.middleware.ts'),
                                  rd('web/src/App.tsx'), rd('web/src/app/admin/MyPasskey.tsx'), rd('web/src/components/PasskeyGate.tsx'))
PKG = rd('package.json')
ok('① 코드 — D268 패스키(SPKI · 알고리즘 · 서명 횟수 · 지우지 않음) · 확인 문제(지문 · 한 번) · login_sessions.passkey_at · 설정 admin.passkey off · EXTRA · 도메인 · 서비스(SPKI · authData · 출처 · 서명 · 복제 의심) · AuthGuard PASSKEY_REQUIRED · 미들웨어 · 새 npm 없음 · 화면(게이트 · 구역) · SCU-020 · 문서 622 · 판 v10.484',
   'CREATE TABLE IF NOT EXISTS public.staff_passkeys' in M68 and 'CREATE TABLE IF NOT EXISTS public.staff_passkey_challenges' in M68 and 'ADD COLUMN IF NOT EXISTS passkey_at' in M68
   and "('admin.passkey', 'off'" in M68 and "('admin.passkey_mode', 'EXTRA'" in M68 and 'trg_staff_passkey_guard' in M68
   and "createPublicKey({ key: der, format: 'der', type: 'spki' })" in PK and 'export function parseAuthData' in PK and 'export function originOk' in PK and "'PASSKEY_CLONE_SUSPECT'" in PK
   and "throw new Forbidden('PASSKEY_REQUIRED'" in AUTH and 'passkeyPending?: boolean' in AUTH and 'passkeyPending(this.db, principal, sid)' in MID
   and "@Post('auth/passkey/verify')" in PC and "@Put('admin/passkeys/policy')" in PC and 'simplewebauthn' not in PKG and 'cbor' not in PKG
   and '<PasskeyGate mode="EXTRA"' in AP and '<><MyMfa /><MyPasskey /></>' in AP and 'export function MyPasskey' in UI and 'data-passkey-gate' in GATE
   and '"SB-ADM-SCU-020"' in SJ and 'WebAuthn' in doc('622_') and VT >= (10, 484), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    s0 = {k: getset(k) for k in ('admin.passkey', 'admin.passkey_mode', 'admin.passkey_rp_id')}
    es, asf = mk_staff('1484s', 'ADMIN')
    ex, ax = mk_staff('1484x', None)
    mine = [asf, ax]
    try:
        p1 = call('PUT', '/admin/passkeys/policy', {'on': True, 'mode': 'EXTRA', 'rpId': RP, 'reason': '시험 1484'}, TS)
        T1 = login(es)
        st0 = call('GET', '/auth/passkey', None, T1)
        mb = call('POST', '/auth/passkey/register/options', None, TB)
        dev = Dev()
        o1 = call('POST', '/auth/passkey/register/options', None, T1)
        evil = call('POST', '/auth/passkey/register', reg_body(dev, o1.get('challenge', ''), origin='https://evil.example'), T1)
        rg = call('POST', '/auth/passkey/register', reg_body(dev, o1.get('challenge', '')), T1)
        o2 = call('POST', '/auth/passkey/register/options', None, T1)
        dup = call('POST', '/auth/passkey/register', reg_body(dev, o2.get('challenge', '')), T1)
        T2 = login(es)
        need = call('GET', '/admin/security/geo', None, T2)
        st1 = call('GET', '/auth/passkey', None, T2)
        v1o = call('POST', '/auth/passkey/verify/options', None, T2)
        vb = ver_body(dev, v1o.get('challenge', ''))
        v1 = call('POST', '/auth/passkey/verify', vb, T2)
        after = call('GET', '/admin/security/geo', None, T2)
        rep = call('POST', '/auth/passkey/verify', vb, T2)
        v2o = call('POST', '/auth/passkey/verify/options', None, T2)
        clone = call('POST', '/auth/passkey/verify', ver_body(dev, v2o.get('challenge', ''), count=dev.count), T2)
        alert = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'PASSKEY_CLONE_SUSPECT' AND detail->>'accountId' = '{asf}'")
        v3o = call('POST', '/auth/passkey/verify/options', None, T2)
        badsig = call('POST', '/auth/passkey/verify', ver_body(dev, v3o.get('challenge', ''), count=dev.count + 5, bad_sig=True), T2)
        pid = psql(f"SELECT id FROM staff_passkeys WHERE account_id = '{asf}' AND revoked_at IS NULL LIMIT 1")
        dbd = psql(f"DELETE FROM staff_passkeys WHERE id = {int(pid or 0)}")
        dbu = psql(f"UPDATE staff_passkeys SET alg = -8 WHERE id = {int(pid or 0)}")
        rv = call('POST', f'/auth/passkey/{pid}/revoke', {'reason': '시험 1484 끔'}, T2)
        T3 = login(es)
        free = call('GET', '/admin/security/geo', None, T3)
        ok('② 패스키 EXTRA — 켜기 · 처음 등록 0 · 회원 403 · 다른 출처 422 · 등록 · 같은 패스키 409 · 새 로그인은 운영 API 403 PASSKEY_REQUIRED(게이트 EXTRA) · 확인 → 열림 · 다시 쓰기 422 · 서명 횟수 그대로 403 + 복제 의심 알림 · 틀린 서명 403 · DB 지우기 · 키 바꾸기 막음 · 끄기 → 다시 열림',
           p1.get('ok') is True and st0.get('enrolled') == 0 and st0.get('gate') is None and mb.get('_err') == 403 and evil.get('code') == 'PASSKEY_ORIGIN'
           and rg.get('ok') is True and dup.get('code') == 'PASSKEY_DUP' and need.get('code') == 'PASSKEY_REQUIRED' and st1.get('gate') == 'EXTRA'
           and v1.get('ok') is True and 'settings' in after and rep.get('code') == 'PASSKEY_CHALLENGE' and clone.get('code') == 'PASSKEY_INVALID' and alert == '1'
           and badsig.get('code') == 'PASSKEY_INVALID' and 'PASSKEY_STATE' in dbd and 'PASSKEY_STATE' in dbu and rv.get('ok') is True and 'settings' in free,
           f"{p1.get('ok') or p1} {st0.get('enrolled')} {st0.get('gate')} {mb.get('_err')} {evil.get('code')} · {rg.get('ok') or rg} {dup.get('code')} · {need.get('code')} {st1.get('gate')} · {v1.get('ok') or v1} {'settings' in after} {rep.get('code')} {clone.get('code')} 알림 {alert} {badsig.get('code')} · {dbd[-30:]} {dbu[-30:]} {rv.get('ok')} {'settings' in free}")
        # REPLACE_MFA — 세무사(늘 2단계)가 인증 앱 번호 없이 패스키로 2단계 확인
        acc = psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1484', true); INSERT INTO account_roles (account_id, role) VALUES ('{ax}', 'ACCOUNTANT'); "
                   f"UPDATE account_roles SET expires_at = now() + interval '7 days' WHERE account_id = '{ax}' AND role = 'ACCOUNTANT'; COMMIT;")
        p2 = call('PUT', '/admin/passkeys/policy', {'mode': 'REPLACE_MFA', 'reason': '시험 1484 대신'}, TS)
        TA0 = login(ex)
        pre = call('POST', '/auth/passkey/register/options', None, TA0)
        TA = mfa_token(TA0)
        dv2 = Dev()
        o3 = call('POST', '/auth/passkey/register/options', None, TA)
        rg2 = call('POST', '/auth/passkey/register', reg_body(dv2, o3.get('challenge', ''), label='시험 1484 세무사'), TA)
        TA2 = login(ex)
        m0 = call('GET', '/auth/mfa', None, TA2)
        g2 = call('GET', '/auth/passkey', None, TA2)
        v4o = call('POST', '/auth/passkey/verify/options', None, TA2)
        v4 = call('POST', '/auth/passkey/verify', ver_body(dv2, v4o.get('challenge', '')), TA2)
        m1 = call('GET', '/auth/mfa', None, v4.get('accessToken'))
        p3 = call('PUT', '/admin/passkeys/policy', {'on': True, 'rpId': '', 'reason': '시험 1484 도메인 없음'}, TS)
        ok('② REPLACE_MFA — 세무사 2단계 전 등록 403 MFA_REQUIRED · 2단계 뒤 등록 · 새 로그인 2단계 필요 · 게이트 REPLACE_MFA · 패스키 확인 → 2단계 확인된 증표 · 도메인 없이 켜기 422',
           '!' not in acc and p2.get('ok') is True and pre.get('code') == 'MFA_REQUIRED' and rg2.get('ok') is True and m0.get('required') is True and m0.get('verified') is False
           and g2.get('gate') == 'REPLACE_MFA' and v4.get('ok') is True and bool(v4.get('accessToken')) and m1.get('verified') is True and p3.get('code') == 'PASSKEY_NOT_READY',
           f"{acc[-30:]} {p2.get('ok')} {pre.get('code')} {rg2.get('ok') or rg2} · {m0.get('required')} {m0.get('verified')} {g2.get('gate')} · {v4.get('ok') or v4} {m1.get('verified')} · {p3.get('code')}")
    finally:
        accs = ','.join(f"'{x}'" for x in mine if x)
        psql(f"SET session_replication_role = replica; DELETE FROM staff_passkeys WHERE account_id IN ({accs}); DELETE FROM staff_passkey_challenges WHERE account_id IN ({accs}); "
             f"DELETE FROM account_mfa WHERE account_id IN ({accs}); DELETE FROM ops_alerts WHERE alert_code = 'PASSKEY_CLONE_SUSPECT' AND detail->>'accountId' IN ({accs});")
        call('PUT', '/admin/passkeys/policy', {'on': s0['admin.passkey'] == 'on', 'mode': s0['admin.passkey_mode'] or 'EXTRA', 'rpId': s0['admin.passkey_rp_id'], 'reason': '시험 1484 되돌림'}, TS)
        rm_role(asf, '1484'); rm_role(ax, '1484')
    if ADMIN_WEB:
        r = admin_page('/#/my-mfa', lambda pg, seen: seen.update(n=pg.locator('[data-my-passkey]').count(), st=pg.locator('[data-passkey-state]').get_attribute('data-passkey-state') if pg.locator('[data-passkey-state]').count() else None))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 권한 계층 › 내 2단계 인증 › 패스키 구역(켜짐 표시 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('st') in ('on', 'off') and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
