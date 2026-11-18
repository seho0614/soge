"""v10.355 (docs/489) 운영자 활동 요약
  ① (코드) API · 묶음 · 거둘 후보 · 화면 · screens.json · 문서 489 · 판 v10.355
  ② (API) 시험 운영자 줄 · 한 일 · 로그인 · 날 범위 · ADMIN 403
  ③ (화면) 표
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

SR, SRC, SB, RR, SJ = rd('src/modules/admin/security-report.ts'), rd('src/modules/admin/security-report.controller.ts'), rd('web/src/app/admin/SecurityBoxes.tsx'), rd('web/src/app/admin/RoleReview.tsx'), rd('spec/screens.json')
ok('① 코드 — 운영자 활동 API(SUPER · 7 ~ 90) · 묶음(행위 앞마디) · 90일 쉼 거둘 후보 · 가린 이메일 · 화면 · screens.json · 문서 489 · 판 v10.355',
   'export async function staffActivity' in SR and "split_part(l.action, '_', 1)" in SR and 'idle90' in SR and "@Get('staff-activity')" in SRC and 'maskMail(r.email)' in SRC
   and 'export function StaffActivityBox' in SB and '<StaffActivityBox />' in RR and '"GET /admin/security/staff-activity"' in SJ and '거둘 후보' in doc('489_') and VT >= (10, 355), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    ADM = f't1355adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADM}', '시험1355', '{pw}', now()) ON CONFLICT DO NOTHING")
    adm = psql(f"SELECT id FROM accounts WHERE email = '{ADM}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1355', true); INSERT INTO account_roles (account_id, role) VALUES ('{adm}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    try:
        g0 = call('GET', '/admin/security/staff-activity', None, TS)
        r0 = next((r for r in (g0.get('rows') or []) if r.get('id') == adm), {})
        consent_ok.agree(ADM, PW)
        TA = login(ADM)
        psql(f"INSERT INTO audit.audit_logs (actor_account_id, action, target_type) VALUES ('{adm}', 'TESTACT_1355', 'TEST')")
        g1 = call('GET', '/admin/security/staff-activity?days=7', None, TS)
        r1 = next((r for r in (g1.get('rows') or []) if r.get('id') == adm), {})
        g2 = call('GET', '/admin/security/staff-activity?days=500', None, TS)
        fa = call('GET', '/admin/security/staff-activity', None, TA)
        ok('② API — 시험 운영자(ADMIN) 줄 · 처음엔 한 일 0 · 로그인 없음 · 거둘 후보 · 로그인 · 감사 한 줄 뒤 한 일 +1 · 묶음 TESTACT · 날 7 · 500 → 90 · 이메일 가림 · ADMIN 403',
           r0.get('acts') == 0 and r0.get('idle90') is True and r0.get('lastLogin') is None and '@' in (r0.get('email') or '') and r0.get('email') != ADM
           and int(r1.get('acts') or 0) >= 1 and any(g.get('grp') == 'TESTACT' for g in (r1.get('groups') or [])) and r1.get('lastLogin') and r1.get('idle90') is False
           and g1.get('days') == 7 and g2.get('days') == 90 and fa.get('_err') == 403,
           f"{ {k: r0.get(k) for k in ('acts', 'idle90', 'lastLogin', 'email')} } → { {k: r1.get(k) for k in ('acts', 'groups', 'idle90')} } · {fa.get('_err')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/role-review', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['box'] = pg.locator('[data-staff-activity]').count(); seen['rows'] = pg.locator('[data-staff-row]').count()
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 위험감지 › 운영자 권한 › 「운영자 활동 요약」 표 · 화면 오류 없음', seen.get('box') == 1 and seen.get('rows', 0) >= 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1355 지움', true); DELETE FROM account_roles WHERE account_id = '{adm}'; COMMIT;")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
