"""v10.363 (docs/497) 탈퇴 사유 통계
  ① (코드) API · 가림 · 화면 · 보안 보고 줄 · 문서 497 · 판 v10.363
  ② (API) 사유별 · 가림 · 403
  ③ (화면) 회원 목록 위 상자
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


def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


MC, BX, MB, SR = rd('src/modules/admin/member-ops.controller.ts'), rd('web/src/app/admin/MemberOpsBoxes.tsx'), rd('web/src/app/admin/Members.tsx'), rd('src/modules/admin/security-report.ts')
ok('① 코드 — 탈퇴 통계 API(ADMIN · SUPER · 3 ~ 12달) · 사유 이름 · 가운데 일수 · 기타 글 가림 · 회원 목록 위 상자 · 월간 보안 보고 줄 · 문서 497 · 판 v10.363',
   "@Get('reports/withdrawals')" in MC and "OTHER_SERVICE: '다른 서비스'" in MC and 'percentile_cont(0.5)' in MC and "'(메일)'" in MC and "'(번호)'" in MC
   and '<WithdrawStatsBox />' in MB and 'data-withdraw-stats' in BX and '회원 탈퇴 ${s.withdrawals}' in SR and '탈퇴' in doc('497_') and VT >= (10, 363), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    e1, a1 = mk_staff('1363a', role=None); e2, a2 = mk_staff('1363b', role=None)
    clean = lambda: psql(f"SET session_replication_role = replica; DELETE FROM account_withdrawals WHERE account_id IN ('{a1}', '{a2}')")
    clean()
    try:
        g0 = call('GET', '/admin/reports/withdrawals', None, TS)
        r0 = {x.get('code'): x.get('n') for x in (g0.get('reasons') or [])}
        psql(f"INSERT INTO account_withdrawals (account_id, reason_code, memo) VALUES ('{a1}', 'PRIVACY', NULL)")
        psql(f"INSERT INTO account_withdrawals (account_id, reason_code, memo) VALUES ('{a2}', 'OTHER', '시험 1363 연락 주세요 me1363@x.com 010-1234-5678')")
        g1 = call('GET', '/admin/reports/withdrawals?months=99', None, TS)
        r1 = {x.get('code'): x.get('n') for x in (g1.get('reasons') or [])}
        memo = next((m.get('memo') for m in (g1.get('memos') or []) if '시험 1363' in (m.get('memo') or '')), '')
        fb = call('GET', '/admin/reports/withdrawals', None, TB)
        ok('② API — 시험 탈퇴 둘 → 합계 +2 · 개인정보 걱정 +1 · 기타 +1 · 사유 이름 · 기타 글 메일 · 번호 가림 · 달 99 → 12 · 회원 403',
           g1.get('total') == (g0.get('total') or 0) + 2 and r1.get('PRIVACY', 0) == r0.get('PRIVACY', 0) + 1 and r1.get('OTHER', 0) == r0.get('OTHER', 0) + 1
           and any(x.get('label') == '개인정보 걱정' for x in (g1.get('reasons') or [])) and '(메일)' in memo and '(번호)' in memo and '@' not in memo
           and g1.get('months') == 12 and fb.get('_err') == 403, f"{g0.get('total')}→{g1.get('total')} · {memo} · {g1.get('months')} · {fb.get('_err')}")
        if ADMIN_WEB:
            def chk(pg, seen):
                seen['box'] = pg.locator('[data-withdraw-stats]').count()
            r = admin_page('/#/members', chk)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 회원 › 회원 목록 위 「탈퇴 사유 통계」 · 화면 오류 없음', seen.get('box') == 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean()
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
