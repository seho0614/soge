"""v10.593 (docs/735) ⑨ 회원 낯선 로그인 알림 넓힘 — LOGIN_NEW_DEVICE(D191) · 내 로그인 기기(D241) 재사용 · 「내가 아니에요」
  ① (코드) 세 곳(로그인 · 2단계 로그인 · 간편 로그인) · 기기 번호 · 알림 링크 · 몰림 알림 · 화면 · 문서 735 · 판
  ② (API · DB) 낯선 브라우저 두 번 → 줄 둘 · 링크 ?alert= · 내가 아니에요 → 그 기기 로그아웃 · 두 번 409 · 남의 줄 404 · 나였어요 · 감사 · 몰림 기준 1 → MEMBER_NOT_ME_SURGE
  (두 번 돌아도 통과 — 시험 회원 · 알림 · 줄 · 이 시험의 몰림 알림은 끝에 지움 · 기준은 되돌림)
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


LA, AU, SO, CT = rd('src/modules/sec2/login-alert.ts'), rd('src/modules/identity/auth.service.ts'), rd('src/modules/social/social.ts'), rd('src/modules/sec2/sec2.controller.ts')
ok('① 코드 — 낯선 기기(D191 notifyNewDevice) 결과 → 증표 뒤 sec2LoginAlert(기기 번호 sid · 알림 링크 ?alert=) · 세 곳(로그인 · 2단계 로그인 · 간편 로그인) · 몰림 알림 · 문서 735 · 판 v10.593',
   'const newDev = await notifyNewDevice(this.db, acc.id);' in AU and 'sec2LoginAlert(this.db, acc.id, newDev, await this.issue(acc.id))' in AU
   and 'sec2LoginAlert(this.db, accountId, newDev, await this.auth.issue(accountId))' in SO and 'sec2LoginAlert(this.db, id, wasNew' in CT
   and 'jwt.decode(tokens.accessToken)' in LA and "/my/account/security?alert=" in LA and "'MEMBER_NOT_ME_SURGE'" in LA
   and 'CREATE TABLE IF NOT EXISTS public.sec2_login_alerts' in MIG and 'LOGIN_NEW_DEVICE' in doc('735_') and VT >= (10, 593), VER)
ok('① 화면 — 나의공간 › 보안 「낯선 기기 로그인」(나였어요 · 내가 아니에요) · 화면 목록 SB-MYP-SCX-020',
   'data-scx-notme' in rd('site/src/components/scx/LoginAlerts.tsx') and 'answerLoginAlert' in rd('site/src/lib/scxAuth.ts') and '"SB-MYP-SCX-020"' in SJ, '')


def call_ua(m_, p, b=None, t=None, ua='Mozilla/5.0'):
    hd = {'content-type': 'application/json', 'user-agent': ua}
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


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    LIKE = 't1593%@x.com'
    rm_accounts(LIKE)
    t0 = psql("SELECT now()")
    before = psql("SELECT value FROM site_settings WHERE key = 'sec2.not_me_surge'")
    try:
        me_, mid = mk_member(f'1593m{STAMP % 97}'); consent_ok.agree(me_, PW)        # 「기타」 브라우저로 첫 성공 로그인 — 비교할 기록
        oe, oid = mk_member(f'1593o{STAMP % 97}'); consent_ok.agree(oe, PW); TO = login(oe)
        W = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
        M = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) Gecko/20100101 Firefox/120.0'
        T1 = call_ua('POST', '/auth/login', {'email': me_, 'password': PW}, ua=W).get('accessToken')
        T2 = call_ua('POST', '/auth/login', {'email': me_, 'password': PW}, ua=M).get('accessToken')
        rows = psql(f"SELECT id || '|' || coalesce(ua_kind, '') || '|' || (session_id IS NOT NULL) FROM sec2_login_alerts WHERE account_id = '{mid}' ORDER BY id")
        rs = [r.split('|') for r in rows.splitlines() if r]
        link = psql(f"SELECT link_url FROM notifications WHERE account_id = '{mid}' AND event_code = 'LOGIN_NEW_DEVICE' ORDER BY id DESC LIMIT 1")
        ok('② 낯선 기기 두 번 → 줄 둘(Chrome · Windows · Firefox · Mac · 기기 번호) · 알림 링크가 그 줄로',
           bool(T1) and bool(T2) and len(rs) == 2 and rs[0][1] == 'Chrome · Windows' and rs[1][1] == 'Firefox · Mac' and all(r[2] == 't' for r in rs)
           and link == f'/my/account/security?alert={rs[1][0]}', f"{rows} {link}")
        a1, a2 = (rs[0][0], rs[1][0]) if len(rs) == 2 else ('0', '0')
        li = call_ua('GET', '/me/login-alerts', None, T1, W)
        nm = call_ua('POST', f'/me/login-alerts/{a2}/answer', {'answer': 'NOT_ME'}, T1, W)
        gone = call_ua('GET', '/me/sessions', None, T2, M)
        nm2 = call_ua('POST', f'/me/login-alerts/{a2}/answer', {'answer': 'ME'}, T1, W)
        other = call('POST', f'/me/login-alerts/{a1}/answer', {'answer': 'ME'}, TO)
        me1 = call_ua('POST', f'/me/login-alerts/{a1}/answer', {'answer': 'ME'}, T1, W)
        ok('② 답 — 목록(답 안 한 것 2) · 내가 아니에요 → 그 기기 로그아웃(그 증표로 403) · 두 번 409 · 남의 줄 404 · 나였어요 · 감사 LOGIN_NOT_ME',
           li.get('open') == 2 and nm.get('revoked') is True and nm.get('next') == '/my/account' and gone.get('_err') in (401, 403)
           and nm2.get('_err') == 409 and other.get('_err') == 404 and me1.get('ok') is True
           and psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'LOGIN_NOT_ME' AND target_id = '{mid}'") == '1',
           f"{li.get('open')} {nm} {gone.get('_err')} {nm2.get('_err')} {other.get('_err')} {me1.get('ok')}")
        sec2_set(TS, {'notMeSurge': 1}, '1593')
        jb = call('POST', '/admin/jobs', {'job': 'sec2_tick'}, TS)
        nmj = ((jb.get('detail') or {}).get('notMe') or {})
        ok('② 몰림 — 기준 1 · 1시간 「내가 아니에요」 ≥ 1 → 운영 알림 MEMBER_NOT_ME_SURGE(1시간 한 번)',
           nmj.get('skipped') in (None, 'RECENT') and nmj.get('n', 0) >= 1
           and psql("SELECT count(*) > 0 FROM ops_alerts WHERE alert_code = 'MEMBER_NOT_ME_SURGE' AND raised_at > now() - interval '1 hour'") == 't', str(jb)[:200])
    finally:
        if before:
            sec2_set(TS, {'notMeSurge': int(before)}, '1593 되돌림')
        rm_accounts(LIKE)
        psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'MEMBER_NOT_ME_SURGE' AND raised_at >= '{t0}';")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
