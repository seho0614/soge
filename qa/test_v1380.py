"""v10.380 (D241 · docs/516) 내 로그인 기기
  ① (코드) D241 · 증표 sid · 미들웨어 · API · 화면
  ② (목록) 두 기기 · 다시 받기
  ③ (끊기) 비로그인 · refresh 막힘 · 404 · 감사
  ④ (이 기기 · 비밀번호) 새 줄
  ⑤ (화면) 사용자 웹 · 운영 화면
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




M41, LS, AU, MW, PG, BX, AP = rd('prisma/migrations/D241_setting_schedules_grace_mail_maint_notice_sessions/migration.sql'), rd('src/modules/identity/login-sessions.ts'), rd('src/modules/identity/auth.service.ts'), rd('src/modules/identity/auth.middleware.ts'), rd('site/src/app/my/account/security/page.tsx'), rd('web/src/app/admin/OpsPlanBoxes.tsx'), rd('web/src/App.tsx')
ok('① 코드 — D241 login_sessions · 파기에 더함 · 증표 sid · 다시 받기 이어 씀 · 미들웨어 끊긴 기기 비로그인 · API(감사) · 사용자 웹 「로그인한 기기」 · 운영 화면 상자 · 문서 516 · 판 v10.380',
   'CREATE TABLE IF NOT EXISTS public.login_sessions' in M41 and 'DELETE FROM login_sessions ls' in M41 and '...(s ? { sid: s } : {})' in AU and 'payload.sid' in AU
   and 'this.auth.sessionAlive(sid, sub)' in MW and "@Audit('SESSION_REVOKE', 'ACCOUNT')" in LS and 'data-sessions-head=""' in PG and 'data-my-sessions=' in BX
   and '<MyPassword /><MySessions />' in AP and '"GET /me/sessions"' in SJ and '로그인 기기' in doc('516_') and VT >= (10, 380), VER)
def claim(tok, k='sid'):
    try:
        p = tok.split('.')[1]; p += '=' * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get(k)
    except Exception:
        return None
if API and DB:
    import consent_ok
    em, aid = mk_staff('1380', 'MEMBER'); consent_ok.agree(em, PW)
    eo, oid = mk_staff('1380o', 'MEMBER'); consent_ok.agree(eo, PW)
    A, B, O = login_full(em), login_full(em), login_full(eo)
    sa, sb, so = claim(A.get('accessToken')), claim(B.get('accessToken')), claim(O.get('accessToken'))
    l1 = call('GET', '/me/sessions', None, A.get('accessToken'))
    ids = [x.get('id') for x in l1.get('items') or []]
    cur = [x.get('id') for x in l1.get('items') or [] if x.get('current')]
    R = call('POST', '/auth/refresh', {'refreshToken': A.get('refreshToken')})
    sr, srr = claim(R.get('accessToken')), claim(R.get('refreshToken'))
    l2 = call('GET', '/me/sessions', None, R.get('accessToken'))
    ok('② 목록 — 두 번 로그인 = 두 줄 더함(증표 sid · 약관 확인 로그인 줄도 있음) · 지금 이 기기 표시 · 다시 받아도 같은 줄(새로 안 생김) · 기기 · IP 가림',
       bool(sa) and bool(sb) and sa != sb and {sa, sb} <= set(ids) and cur == [sa] and sr == sa and srr == sa and len(l2.get('items') or []) == len(ids) and l1.get('currentKnown') is True,
       f"{len(ids)} · cur {cur == [sa]} · refresh 같은 줄 {sr == sa} · {len(l2.get('items') or [])}")
    TA = R.get('accessToken')
    v0 = call('GET', '/me/summary', None, B.get('accessToken'))
    rv = call('POST', f'/me/sessions/{sb}/revoke', None, TA)
    v1 = call('GET', '/me/summary', None, B.get('accessToken'))
    rb = call('POST', '/auth/refresh', {'refreshToken': B.get('refreshToken')})
    va = call('GET', '/me/summary', None, TA)
    l3 = call('GET', '/me/sessions', None, TA)
    other = call('POST', f'/me/sessions/{so}/revoke', None, TA)
    again = call('POST', f'/me/sessions/{sb}/revoke', None, TA)
    vo = call('GET', '/me/summary', None, O.get('accessToken'))
    aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'SESSION_REVOKE' AND target_id = '{sb}'")
    ok('③ 기기별 로그아웃 — 끊은 기기 증표는 비로그인 · 그 refresh 막힘 · 이 기기 그대로 · 목록에서 빠짐 · 남의 기기 404 · 두 번 404 · 남은 그대로 · 감사',
       '_err' not in v0 and rv.get('ok') is True and rv.get('current') is False and v1.get('_err') in (401, 403) and rb.get('code') == 'INVALID_TOKEN'
       and '_err' not in va and sa in [x.get('id') for x in l3.get('items') or []] and sb not in [x.get('id') for x in l3.get('items') or []] and len(l3.get('items') or []) == len(ids) - 1 and other.get('_err') == 404 and again.get('_err') == 404 and '_err' not in vo and aud == '1',
       f"{rv.get('ok')} {rv.get('current')} · 끊긴 {v1.get('_err')} · refresh {rb.get('code')} · 이 기기 {va.get('_err')} · {len(l3.get('items') or [])} · {other.get('_err')} {again.get('_err')} · 감사 {aud}")
    # ④ 이 기기 끊기 · 비밀번호 바꾸면 옛 줄 빠짐 · 옛 증표(sid 없음)는 그대로
    me_ = call('POST', f'/me/sessions/{sa}/revoke', None, TA)
    vs = call('GET', '/me/summary', None, TA)
    C = login_full(em)
    NEW = 'Sgb-1380-new-pass!'
    ch = call('PATCH', '/me/password', {'currentPassword': PW, 'newPassword': NEW}, C.get('accessToken'))
    l4 = call('GET', '/me/sessions', None, ch.get('accessToken'))
    ok('④ 이 기기 끊기 → 이 증표도 비로그인(current) · 비밀번호를 바꾸면 새 줄 하나만 보임(옛 줄 빠짐)',
       me_.get('current') is True and vs.get('_err') in (401, 403) and ch.get('ok') is True and len(l4.get('items') or []) == 1 and (l4.get('items') or [{}])[0].get('id') == claim(ch.get('accessToken')),
       f"{me_.get('current')} {vs.get('_err')} · {ch.get('ok')} · {len(l4.get('items') or [])}")
    psql(f"UPDATE accounts SET password_hash = (SELECT password_hash FROM accounts WHERE email = 'buyer@x.com') WHERE email = '{em}'")
    if SITE and ADMIN_WEB:
        def run(b, seen, perr):
            ps = site_login(b, perr, em)
            ps.goto(SITE + '/my/account/security', wait_until='networkidle', timeout=120000)
            ps.wait_for_selector('[data-sessions-head]', timeout=30000)
            seen['head'] = ps.locator('[data-sessions-head]').count(); seen['cur'] = ps.locator('[data-session-row=current]').count()
            pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            pg.goto(ADMIN_WEB + '/#/my-password', wait_until='networkidle', timeout=120000)
            pg.wait_for_selector('[data-my-sessions]', timeout=30000)
            seen['adm'] = pg.locator('[data-my-sessions]').count(); seen['admcur'] = pg.locator('[data-my-session=current]').count()
        res = ui(run)
        if res is None: print('  (playwright 없음 — ⑤ 건너뜀)')
        else:
            seen, perr = res
            ok('⑤ 화면 — 사용자 웹 보안 화면 「로그인한 기기」(지금 이 기기 줄) · 운영 화면 내 비밀번호 탭 「내 로그인 기기」(지금 이 기기 줄) · 화면 오류 없음',
               seen.get('head') == 1 and seen.get('cur') == 1 and seen.get('adm') == 1 and seen.get('admcur') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
