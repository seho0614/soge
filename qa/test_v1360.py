"""v10.360 (D236 · docs/494) 운영자 비밀번호 정책
  ① (코드) D236 · 12자 · 3개 · 90일 · 권한 점검 · 화면 · 영어 · 문서 494 · 판 v10.360
  ② (API) 운영 역할 422 둘 · 회원 그대로
  ③ (API) 90일 넘음
  ④ (화면) 띠
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

M26 = rd('prisma/migrations/D226_faq_feedback_inquiry_templates/migration.sql')
FB, TC = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/support/inquiry-template.controller.ts')
FS, AM = rd('src/modules/help/faq-admin.service.ts'), rd('src/app.module.ts')
HUB, FA, DESK = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
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


M36, ST, AS, RR, RRW, SS = (rd('prisma/migrations/D236_staff_session_oncall_password/migration.sql'), rd('src/modules/identity/staff-policy.ts'), rd('src/modules/identity/account-security.service.ts'),
                           rd('src/modules/admin/role-review.service.ts'), rd('web/src/app/admin/RoleReview.tsx'), rd('web/src/app/admin/StaffSession.tsx'))
STX = rd('src/common/i18n/server-text.en.ts')
ok('① 코드 — D236 password_history(고치기 막음) · 운영 역할 12자 · 최근 3개 금지 · 바꿀 때 옛 해시 · 바꾸기 · 재설정 둘 다 · 90일 · 권한 점검 칸 · 화면 띠 · 영어 · 문서 494 · 판 v10.360',
   'CREATE TABLE IF NOT EXISTS public.password_history' in M36 and 'trg_password_history_ro' in M36 and "const STAFF_MIN = 12;" in ST and "const REUSE = 3;" in ST
   and AS.count('await assertStaffPassword(this.db,') == 2 and AS.count('await keepOldPassword(this.db,') == 2 and 'PASSWORD_MAX_DAYS = 90' in ST
   and '"passwordOld"' in RR and 'data-pw-old' in RRW and 'data-pw-old-bar' in SS and '최근에 쓴 비밀번호(3개)는 다시 쓸 수 없습니다. 새 비밀번호를 넣어 주십시오.' in STX
   and '12자' in doc('494_') and VT >= (10, 360), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, adm = mk_staff('1360')
    psql(f"INSERT INTO account_roles (account_id, role) VALUES ('{adm}', 'MEMBER') ON CONFLICT DO NOTHING")   # 비밀번호 바꾸기 API 는 회원 역할
    mem, mid = mk_staff('1360m', role='MEMBER')
    consent_ok.agree(em, PW); consent_ok.agree(mem, PW)
    TA, TM = login(em), login(mem)
    NEW = 'Brand-New-Pass-1360!'
    try:
        c1 = call('PATCH', '/me/password', {'currentPassword': PW, 'newPassword': 'Short-1234a'}, TA)
        c2 = call('PATCH', '/me/password', {'currentPassword': PW, 'newPassword': NEW}, TA)
        TA2 = c2.get('accessToken') or TA
        c3 = call('PATCH', '/me/password', {'currentPassword': NEW, 'newPassword': PW}, TA2)
        hist = psql(f"SELECT count(*) FROM password_history WHERE account_id = '{adm}'")
        m1 = call('PATCH', '/me/password', {'currentPassword': PW, 'newPassword': 'Abcdef-123'}, TM)
        TM2 = m1.get('accessToken') or TM
        m2 = call('PATCH', '/me/password', {'currentPassword': 'Abcdef-123', 'newPassword': PW}, TM2)
        ok('② API — 운영 역할: 11자 422 WEAK_PASSWORD_STAFF · 새것 됨(옛 해시 기록) · 바로 전 비밀번호로 422 PASSWORD_REUSED · 회원: 10자 됨 · 바로 전으로 되돌리기도 됨',
           c1.get('code') == 'WEAK_PASSWORD_STAFF' and c2.get('ok') is True and c3.get('code') == 'PASSWORD_REUSED' and int(hist or 0) >= 1
           and m1.get('ok') is True and m2.get('ok') is True, f"{c1.get('code')} {c2.get('ok')} {c3.get('code')} · 기록 {hist} · {m1.get('ok')} {m2.get('code') or m2.get('ok')}")
        psql(f"UPDATE accounts SET password_changed_at = now() - interval '100 days' WHERE id = '{adm}'")
        ss = call('GET', '/auth/staff-session', None, TA2)
        rv = call('GET', '/admin/role-review', None, TS)
        row = next((x for x in (rv.get('items') or []) if x.get('id') == adm), {})
        ok('③ API — 바꾼 날 100일 전 → staff-session password.old · days 100 · 운영자 권한 점검 줄 passwordOld',
           (ss.get('password') or {}).get('old') is True and (ss.get('password') or {}).get('days') == 100 and row.get('passwordOld') is True,
           f"{ss.get('password')} · {row.get('passwordOld')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', em); pg.fill('input[name=password]', NEW); pg.click('button[type=submit]'); pg.wait_for_timeout(3500)
                seen['bar'] = pg.locator('[data-pw-old-bar]').get_attribute('data-pw-old-bar') if pg.locator('[data-pw-old-bar]').count() else None
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 비밀번호 100일 된 운영자로 로그인 → 「비밀번호를 바꾼 지 100일」 띠 · 화면 오류 없음', seen.get('bar') == '100' and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        rm_role(adm, '1360')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
