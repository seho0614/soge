"""v10.376 (D240 · docs/511) 회원 탈퇴 유예 · 철회
  ① (코드) D240 · 로그인 · API · 사용자 웹
  ② (꺼짐) 전과 같음
  ③ (켬) 유예 · 취소 · 다시 탈퇴
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


M40, AU, OW, LF, SS = rd('prisma/migrations/D240_due_alerts_apply_checks_withdraw_grace/migration.sql'), rd('src/modules/identity/auth.service.ts'), rd('src/modules/admin/ops-week.controller.ts'), rd('site/src/components/auth/LoginForm.tsx'), rd('site/src/lib/session.ts')
ok('① 코드 — 설정 member.withdraw_grace_days(0) · 보관 기한 트리거 유예 · 탈퇴 함수 다시 탈퇴 · canceled_at · 로그인 WITHDRAW_PENDING · 취소 API(감사) · 사용자 웹 「탈퇴 취소」 · 문서 511 · 판 v10.376',
   "('member.withdraw_grace_days', '0', 'ADMIN'" in M40 and "make_interval(days => fn_setting_int('member.withdraw_grace_days', 0))" in M40 and 'ON CONFLICT (account_id) DO UPDATE' in M40
   and "code: 'WITHDRAW_PENDING'" in AU and "@Post('auth/withdraw/cancel')" in OW and "@Audit('ACCOUNT_WITHDRAW_CANCEL', 'ACCOUNT')" in OW
   and 'data-withdraw-cancel=""' in LF and "'/auth/withdraw/cancel'" in SS and '"agreeGrace"' in rd('site/src/i18n/messages/ko/my.json') and 'graceDays: grace,' in rd('src/modules/identity/account-security.service.ts') and '법무' in doc('511_') and VT >= (10, 376), VER)
if API and DB:
    g0 = psql("SELECT value FROM site_settings WHERE key = 'member.withdraw_grace_days'")
    setg = lambda v: psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1376', true); UPDATE site_settings SET value = '{v}' WHERE key = 'member.withdraw_grace_days'; COMMIT;")
    def mk(tag):   # 가입 API 대신(같은 IP 가입 상한에 걸리지 않게) — 회원 역할만 있는 계정
        em, aid = mk_staff(f'1376{tag}', 'MEMBER')
        __import__('consent_ok').agree(em, PW)
        return em, aid
    def wd(em):
        t = login(em)
        return call('POST', '/me/withdraw', {'password': PW, 'reason': 'LOW_USE'}, t)
    try:
        setg('0')
        e1, _ = mk('a'); w1 = wd(e1)
        l1 = call('POST', '/auth/login', {'email': e1, 'password': PW})
        c1 = call('POST', '/auth/withdraw/cancel', {'email': e1, 'password': PW})
        r1 = psql(f"SELECT (retention_until = withdrawn_at::date) FROM accounts WHERE email = '{e1}'")
        ok('② 꺼짐(0) — 탈퇴 → 로그인 ACCOUNT_INACTIVE · 취소 409 · 파기 날 = 탈퇴한 날(전과 같음)',
           w1.get('ok') is True and l1.get('code') == 'ACCOUNT_INACTIVE' and c1.get('code') == 'WITHDRAW_CANCEL_CLOSED' and r1 == 't', f"{w1.get('ok')} {w1.get('code')} · {l1.get('code')} · {c1.get('code')} · {r1}")
        setg('7')
        e2, _ = mk('b')
        ck = call('GET', '/me/withdraw/check', None, login(e2))
        w2 = wd(e2)
        r2 = psql(f"SELECT (retention_until = (withdrawn_at + interval '7 days')::date) FROM accounts WHERE email = '{e2}'")
        l2 = call('POST', '/auth/login', {'email': e2, 'password': PW})
        bad = call('POST', '/auth/withdraw/cancel', {'email': e2, 'password': 'wrong-pass-1376'})
        c2 = call('POST', '/auth/withdraw/cancel', {'email': e2, 'password': PW})
        st = psql(f"SELECT a.status || '|' || (a.withdrawn_at IS NULL) || '|' || (a.retention_until IS NULL) || '|' || (w.canceled_at IS NOT NULL) FROM accounts a JOIN account_withdrawals w ON w.account_id = a.id WHERE a.email = '{e2}'")
        l3 = call('POST', '/auth/login', {'email': e2, 'password': PW})
        w3 = wd(e2)
        again = psql(f"SELECT a.status || '|' || (w.canceled_at IS NULL) FROM accounts a JOIN account_withdrawals w ON w.account_id = a.id WHERE a.email = '{e2}'")
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'ACCOUNT_WITHDRAW_CANCEL' AND occurred_at > now() - interval '10 minutes'")
        ok('③ 켬(7) — 탈퇴 확인 화면 graceDays 7 · 안내 줄 · 파기 날 +7 · 로그인 WITHDRAW_PENDING(취소 가능 때) · 틀린 비밀번호 403 · 취소 → ACTIVE(탈퇴 시각 · 보관 기한 비움 · canceled_at) · 다시 로그인 · 다시 탈퇴 가능(canceled_at 비움) · 감사',
           ck.get('graceDays') == 7 and any('7일 안에 다시 로그인' in n_ for n_ in ck.get('notes') or []) and w2.get('ok') is True and r2 == 't' and l2.get('code') == 'WITHDRAW_PENDING' and bad.get('code') == 'INVALID_CREDENTIALS' and c2.get('ok') is True
           and st == 'ACTIVE|t|t|t' and bool(l3.get('accessToken')) and w3.get('ok') is True and again == 'WITHDRAWN|t' and int(aud or 0) >= 1,
           f"{r2} · {l2.get('code')} {l2.get('message')} · {bad.get('code')} · {c2.get('ok')} · {st} · {bool(l3.get('accessToken'))} · {w3.get('ok')} {w3.get('code')} · {again} · 감사 {aud}")
    finally:
        setg(g0 or '0')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
