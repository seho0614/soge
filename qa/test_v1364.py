"""v10.364 (docs/498) 역할별 「오늘 할 일」
  ① (코드) API · 역할별 줄 · 첫 화면 · 문서 498 · 판 v10.364
  ② (API) SUPER 12 · 문의 +1 · 검수자 · 지급 담당 · 403
  ③ (화면) 오늘 할 일 · 열기
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


MO, MC, BX, DS = rd('src/modules/admin/member-ops.ts'), rd('src/modules/admin/member-ops.controller.ts'), rd('web/src/app/admin/MemberOpsBoxes.tsx'), rd('web/src/app/admin/Dashboard.tsx')
ok('① 코드 — 오늘 할 일 API(운영 역할 모두) · 역할별 줄(검수 · 지급 · 문의 · 분쟁 · 신고 · 정산 · 사업자 · 급한 알림 · 입점 · 자격 · 제휴) · 첫 화면 세 갈래 · 문서 498 · 판 v10.364',
   "@Get('todo')" in MC and "@Roles('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF')" in MC and "if (has('PAYOUT'))" in MO and "'report-queue'" in MO
   and DS.count('<TodoBox onGo={onGo} canGo={canGo} />') == 3 and 'data-todo-go' in BX and '오늘 할 일' in doc('498_') and VT >= (10, 364), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    er, rv = mk_staff('1364r', 'REVIEWER'); ep, py = mk_staff('1364p', 'PAYOUT')
    consent_ok.agree(er, PW); consent_ok.agree(ep, PW)
    TR, TP = login(er), login(ep)
    stamp = int(time.time()) % 100000
    clean = lambda: psql("SET session_replication_role = replica; DELETE FROM inquiries WHERE title LIKE '시험 1364 %'")
    clean()
    try:
        t0 = call('GET', '/admin/todo', None, TS)
        iq = call('POST', '/inquiries', {'category': 'ETC', 'title': f'시험 1364 {stamp}', 'body': '시험 1364 문의 본문'}, TB)
        t1 = call('GET', '/admin/todo', None, TS)
        tr = call('GET', '/admin/todo', None, TR); tp = call('GET', '/admin/todo', None, TP)
        fb = call('GET', '/admin/todo', None, TB)
        n = lambda t, k: next((x.get('n') for x in (t.get('items') or []) if x.get('key') == k), None)
        ok('② API — SUPER 줄 12 · 시험 문의 → 문의 줄 +1 · 검수자는 검수 대기 한 줄 · 지급 담당은 지급 대기 한 줄 · 갈 탭 · 회원 403',
           len(t0.get('items') or []) == 12 and n(t1, 'inq') == (n(t0, 'inq') or 0) + 1 and [x.get('key') for x in (tr.get('items') or [])] == ['review']
           and [x.get('key') for x in (tp.get('items') or [])] == ['pay'] and next((x.get('tab') for x in (t1.get('items') or []) if x.get('key') == 'inq'), '') == 'inquiries'
           and fb.get('_err') == 403, f"{len(t0.get('items') or [])} · {n(t0, 'inq')}→{n(t1, 'inq')} · {[x.get('key') for x in (tr.get('items') or [])]} {[x.get('key') for x in (tp.get('items') or [])]} · {fb.get('_err')}")
        if ADMIN_WEB:
            def chk(pg, seen):
                seen['box'] = pg.locator('[data-todo]').count()
                go = pg.locator('[data-todo-go="inquiries"]')
                seen['go'] = go.count()
                if go.count():
                    go.first.click(); pg.wait_for_timeout(2500); seen['hash'] = pg.evaluate('location.hash')
            r = admin_page('/#/home', chk)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 첫 화면 「오늘 할 일」 · 1:1 문의 줄 「열기」 → 1:1 문의 탭 · 화면 오류 없음',
                   seen.get('box') == 1 and seen.get('go', 0) >= 1 and seen.get('hash') == '#/inquiries' and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean(); rm_role(rv, '1364'); rm_role(py, '1364')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
