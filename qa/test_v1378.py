"""v10.378 (D241 · docs/514) 탈퇴 유예 끝 전날 메일
  ① (코드) D241 · 정기 작업 · 메일 글
  ② (작업) 대상 · 메일 준비 · 이른 · 취소
  ③ (다시 탈퇴) 표시 비움
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




M41, NJ, SC, WK = rd('prisma/migrations/D241_setting_schedules_grace_mail_maint_notice_sessions/migration.sql'), rd('src/modules/admin/member-notice-jobs.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — D241 grace_mailed_at · 다시 탈퇴하면 비움 · 정기 작업 매시간 · 유예 2일 이상 · 1일 ~ 1시간 남음 · 메일 글(취소 기한 · 로그인 주소) · 문서 514 · 판 v10.378',
   'ADD COLUMN IF NOT EXISTS grace_mailed_at timestamptz' in M41 and 'canceled_at = NULL, grace_mailed_at = NULL' in M41 and "('withdraw_grace_mail', 60," in M41
   and 'if (days < 2)' in NJ and "- interval '1 day'" in NJ and "- interval '1 hour'" in NJ and '탈퇴 취소는' in NJ and '/login' in NJ
   and "case 'withdraw_grace_mail':" in SC and "'withdraw_grace_mail'," in WK and '전날' in doc('514_') and VT >= (10, 378), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    g0 = psql("SELECT value FROM site_settings WHERE key = 'member.withdraw_grace_days'")
    setg = lambda v: psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1378', true); UPDATE site_settings SET value = '{v}' WHERE key = 'member.withdraw_grace_days'; COMMIT;")
    def mk(tag):
        em, aid = mk_staff(f'1378{tag}', 'MEMBER'); consent_ok.agree(em, PW); return em, aid
    def wd(em):
        return call('POST', '/me/withdraw', {'password': PW, 'reason': 'LOW_USE'}, login(em))
    back = lambda em, s: psql(f"UPDATE accounts SET withdrawn_at = now() - interval '{s}' WHERE email = '{em}'")
    mailed = lambda em: psql(f"SELECT (w.grace_mailed_at IS NOT NULL)::text FROM account_withdrawals w JOIN accounts a ON a.id = w.account_id WHERE a.email = '{em}'")
    try:
        setg('0')
        j0 = call('POST', '/admin/jobs', {'job': 'withdraw_grace_mail'}, TS)
        setg('7')
        e1, _ = mk('a'); e2, _ = mk('b'); e3, _ = mk('c')
        w1, w2, w3 = wd(e1), wd(e2), wd(e3)
        back(e1, '6 days 1 hour'); back(e3, '6 days 1 hour')
        c3 = call('POST', '/auth/withdraw/cancel', {'email': e3, 'password': PW})
        psql(f"UPDATE accounts SET status = 'WITHDRAWN', withdrawn_at = now() - interval '6 days 1 hour' WHERE email = '{e3}'")
        j1 = call('POST', '/admin/jobs', {'job': 'withdraw_grace_mail'}, TS)
        d1 = j1.get('detail') or {}
        m1, m2, m3 = mailed(e1), mailed(e2), mailed(e3)
        sent_ok = (d1.get('reason') == 'MAIL_NOT_READY' and m1 == 'false') or (int(d1.get('mailed') or 0) >= 1 and m1 == 'true')
        ok('② 작업 — 유예 0 이면 GRACE_OFF · 유예 7 · 끝까지 1일 안 남은 회원이 대상(메일 준비 안 됨이면 MAIL_NOT_READY · 표시 안 함 / 준비면 보냄 · 표시) · 아직 이른 회원 · 취소한 회원은 대상 아님',
           (j0.get('detail') or {}).get('reason') == 'GRACE_OFF' and w1.get('ok') is True and w2.get('ok') is True and c3.get('ok') is True
           and int(d1.get('due') or 0) >= 1 and sent_ok and m2 == 'false' and m3 == 'false',
           f"{(j0.get('detail') or {}).get('reason')} · {d1} · {m1} {m2} {m3}")
        # ③ 다시 탈퇴하면 표시 비움 — 표시를 DB 로 넣고 취소 → 다시 탈퇴
        psql(f"UPDATE account_withdrawals SET grace_mailed_at = now() WHERE account_id = (SELECT id FROM accounts WHERE email = '{e1}')")
        c1 = call('POST', '/auth/withdraw/cancel', {'email': e1, 'password': PW})
        w1b = wd(e1)
        ok('③ 다시 탈퇴 — 취소 뒤 다시 탈퇴하면 메일 표시 비움(새 유예에 다시 한 번)', c1.get('ok') is True and w1b.get('ok') is True and mailed(e1) == 'false', f"{c1.get('ok')} {w1b.get('ok')} {mailed(e1)}")
    finally:
        setg(g0 or '0')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
