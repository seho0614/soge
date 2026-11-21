"""v10.536 (D282 · docs/674) 운영 대시보드 위젯 배치 — 대표 11/20 「(52) ②」
  ① (코드) staff_dash_layouts(열쇠 모양 CHECK) · 서버 정규식 = DB · 카드 열쇠 서버 = 화면(15) · 대시보드 DashSlots(옛 글자 그대로) · 화면 목록 · 문서 674
  ② (API · DB) 시험 운영자 한 명으로 — 처음 기본 · 저장 · 일부 차례 · 막힘(422 · 400 · DB CHECK) · 기본으로 · 다른 운영자 배치 그대로 · 회원 403 — 시험 계정 · 줄은 끝에 지움
  ③ (화면) 대시보드 「첫 화면 꾸미기」 열고 닫기(저장하지 않음)
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


def keys_of(src):
    blk = src.split('DASH_WIDGETS: Array<[string, string]> = [')[1].split('];')[0] if 'DASH_WIDGETS: Array<[string, string]> = [' in src else ''
    return re.findall(r"\['([a-z][a-z0-9-]*)', '", blk)


# ① 코드(API 없이도)
SQL = rd('prisma/migrations/D282_bi_export_dashboard_widgets_mobile_scan/migration.sql')
DL, CT, AM = rd('src/modules/dtx/dash-layout.ts'), rd('src/modules/dtx/dtx.controller.ts'), rd('src/app.module.ts')
DW, DS = rd('web/src/app/admin/DashWidgets.tsx'), rd('web/src/app/admin/Dashboard.tsx')
SK, WK = keys_of(DL), keys_of(DW)
ok('① D282 — 위젯 배치 표(계정마다 · 차례 · 숨김 · 열쇠 모양 CHECK · 40개) · 서버 정규식 = DB CHECK 모양 · 자기 것만(GET · PUT · DELETE)',
   'CREATE TABLE IF NOT EXISTS public.staff_dash_layouts' in SQL and "array_to_string(widget_order, ',') ~ '^([a-z][a-z0-9-]{1,23}(,|$))*$'" in SQL
   and "array_to_string(widget_hidden, ',') ~ '^([a-z][a-z0-9-]{1,23}(,|$))*$'" in SQL and "DASH_KEY_RE = /^[a-z][a-z0-9-]{1,23}$/" in DL
   and "@Get('dash-layout')" in CT and "@Put('dash-layout')" in CT and "@Delete('dash-layout')" in CT and 'DashLayoutController,' in AM, '')
ok('① 카드 열쇠 — 서버 목록 = 화면 목록(15 · 같은 차례)', len(SK) == 15 and SK == WK, f"{SK} / {WK}")
ok('① 대시보드 — DashSlots 로 그림 · 옛 글자 그대로(TodoBox 3 · 공지 · 공개 직후 · 상태 · 대표 할 일 · 판 · 확인표 · 매출 · 서버 · 고객센터 · 경보 길)',
   '<DashSlots parts={{' in DS and DS.count('<TodoBox onGo={onGo} canGo={canGo} />') == 3 and all(x in DS for x in (
       '<StaffNotices />', '<LaunchWatch />', '<StateCheck onGo={onGo} canGo={canGo} />', '<OwnerTodo onGo={onGo} canGo={canGo} />', '<ReleaseLog />',
       '<ApplyChecksBox />', '{isSuperNow() && <AcctCard onGo={onGo} />}', '<ServerTrend />', '<CsGlance onGo={onGo} canGo={canGo} />', "go: 'ops-alerts'"))
   and all(f'{k}:' in DS for k in SK) and 'data-dash-edit' in DW and 'data-dash-save' in DW and 'data-dash-reset' in DW, '')
scr = {x['id']: x for x in json.loads(SJ or '{"screens":[]}')['screens']}
ok('① 화면 SB-ADM-DTX-020 — API 3', len(scr.get('SB-ADM-DTX-020', {}).get('apis', [])) == 3, '')
D674 = doc('674_')
ok('① 문서 674 — 기본 배치 그대로 · 계정마다 서버 저장', all(x in D674 for x in ('기본 배치', '서버 저장', 'staff_dash_layouts')), '')
ok('① 판 v10.536 이상', VT >= (10, 536), VER)

if API and DB:
    TAG = 'v1536-' + str(int(time.time()))
    made = []
    try:
        import consent_ok
        em, aid = mk_staff('dw', 'ADMIN')
        made.append(em)
        try:
            consent_ok.agree(em, PW)
        except Exception:
            pass
        T, TB = login(em), login('buyer@x.com')
        admin_before = psql("SELECT count(*) FROM staff_dash_layouts sl JOIN accounts a ON a.id = sl.account_id WHERE a.email = 'admin@x.com'")
        g0 = call('GET', '/admin/dash-layout', None, T)
        mb = call('GET', '/admin/dash-layout', None, TB)
        ok('② 처음 — 저장 없음 · 기본 차례 15 · 숨김 없음 · 회원 403', g0.get('saved') is False and g0.get('order') == SK and g0.get('hidden') == [] and mb.get('_err') == 403,
           f"{g0.get('saved')} {len(g0.get('order') or [])} {mb.get('_err')}")
        rev = list(reversed(SK))
        p1 = call('PUT', '/admin/dash-layout', {'order': rev, 'hidden': ['runway', 'more']}, T)
        g1 = call('GET', '/admin/dash-layout', None, T)
        row = psql(f"SELECT array_length(widget_order, 1) || '|' || array_to_string(widget_hidden, ',') FROM staff_dash_layouts WHERE account_id = '{aid}'")
        ok('② 저장 — 거꾸로 차례 · 숨김 2 · 다시 읽어도 같음 · DB 한 줄', p1.get('ok') is True and g1.get('saved') is True and g1.get('order') == rev and g1.get('hidden') == ['runway', 'more']
           and row == '15|runway,more', f"{p1.get('note')} {g1.get('order', [])[:2]} {row}")
        p2 = call('PUT', '/admin/dash-layout', {'order': ['tiles', 'todo']}, T)
        g2 = call('GET', '/admin/dash-layout', None, T)
        ok('② 일부 차례만 — 빠진 카드는 기본 차례대로 끝에 · 숨김은 그대로', p2.get('ok') is True and (g2.get('order') or [])[:3] == ['tiles', 'todo', 'notices']
           and len(g2.get('order') or []) == 15 and g2.get('hidden') == ['runway', 'more'], f"{(g2.get('order') or [])[:3]} {g2.get('hidden')}")
        e1 = call('PUT', '/admin/dash-layout', {'order': ['zzz-none']}, T)
        e2 = call('PUT', '/admin/dash-layout', {'order': ['Bad Key']}, T)
        e3 = call('PUT', '/admin/dash-layout', {'hidden': SK}, T)
        e4 = call('PUT', '/admin/dash-layout', {'order': ['todo', 'todo']}, T)
        e5 = call('PUT', '/admin/dash-layout', {}, T)
        dbbad = psql(f"UPDATE staff_dash_layouts SET widget_order = ARRAY['Bad Key'] WHERE account_id = '{aid}'")
        ok('② 막힘 — 모르는 카드 422 · 모양 아님 400 · 모두 숨김 422 · 두 번 422 · 빈 요청 422 · DB CHECK 가 모양 막음',
           e1.get('code') == 'DASH_KEY' and e2.get('_err') == 400 and e3.get('code') == 'DASH_ALL_HIDDEN' and e4.get('code') == 'DASH_KEY' and e5.get('code') == 'DASH_NOTHING'
           and 'ck_dash_order_keys' in dbbad, f"{e1.get('code')} {e2.get('_err')} {e3.get('code')} {e4.get('code')} {e5.get('code')} {dbbad[-60:]}")
        dl = call('DELETE', '/admin/dash-layout', None, T)
        g3 = call('GET', '/admin/dash-layout', None, T)
        admin_after = psql("SELECT count(*) FROM staff_dash_layouts sl JOIN accounts a ON a.id = sl.account_id WHERE a.email = 'admin@x.com'")
        ok('② 기본으로 — 줄 지움 · 다시 기본 차례 · 다른 운영자 배치는 그대로', dl.get('ok') is True and dl.get('removed') is True and g3.get('saved') is False and g3.get('order') == SK
           and admin_before == admin_after, f"{dl.get('removed')} {g3.get('saved')} {admin_before}/{admin_after}")
    finally:
        for e in made:
            psql(f"SET session_replication_role = replica; DELETE FROM staff_dash_layouts WHERE account_id IN (SELECT id FROM accounts WHERE email = '{e}'); DELETE FROM account_roles WHERE account_id IN (SELECT id FROM accounts WHERE email = '{e}'); DELETE FROM perm_account_groups WHERE account_id IN (SELECT id FROM accounts WHERE email = '{e}'); DELETE FROM perm_account_overrides WHERE account_id IN (SELECT id FROM accounts WHERE email = '{e}'); DELETE FROM account_roles WHERE account_id IN (SELECT id FROM accounts WHERE email = '{e}'); DELETE FROM accounts WHERE email = '{e}';")
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-dash-edit]', timeout=30000)
            seen['edit'] = pg.locator('[data-dash-edit]').count()
            seen['tiles'] = pg.locator('[data-dash-tiles]').count()
            pg.click('[data-dash-edit]'); pg.wait_for_timeout(500)
            seen['editor'] = pg.locator('[data-dash-editor]').count()
            seen['items'] = pg.locator('[data-dash-item]').count()
            pg.click('[data-dash-edit]'); pg.wait_for_timeout(300)   # 닫기만(저장하지 않음 — admin 배치를 바꾸지 않음)
            seen['closed'] = pg.locator('[data-dash-editor]').count()
        r = admin_page('/#/home', chk)
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 대시보드 「첫 화면 꾸미기」 · 카드 15 목록 · 처리 대기 숫자 그대로 · 닫기 · 화면 오류 없음',
               seen.get('edit') == 1 and seen.get('tiles') == 1 and seen.get('editor') == 1 and seen.get('items') == 15 and seen.get('closed') == 0 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
