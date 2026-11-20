"""v10.462 (D263 · docs/600) 사내 일정 캘린더
  ① (코드) D263 ofc_events · 지우기 막음 트리거 · 모아 읽기(휴가 · 품의 · 신고 기한 · 계약 · 급여일 · 출장 · 업무) · OfcController · 화면 OfcCalendar · 메뉴 · 화면 목록 OFC-010 · 문서 600
  ② (API · DB) 62일 넘음 422 · 개인 일정 · 검수 담당 회사 일정 403 · SUPER 회사 일정 · 남의 개인 일정 안 보임 · 급여일 · 신고 기한(지급 담당 · SUPER 만) · 고치기 · 남이 고치기 404 · 지우기 · 다시 지우기 409 · DB DELETE 막음
  ③ (화면) 사무 › 사내 일정 달 칸 · 화면 오류 없음
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


def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def staff(tag, role):
    """운영 계정 하나 + 약관 동의 + 증표(시험 끝에 역할 지움)"""
    import consent_ok
    em, aid = mk_staff(tag, role)
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M63 = migr('D263_')
CC, CT, CR, CN, OC = (rd('src/modules/acct/ofc-calendar.ts'), rd('src/modules/acct/ofc-tasks.ts'), rd('src/modules/acct/ofc-trips.ts'),
                      rd('src/modules/acct/ofc-notify.ts'), rd('src/modules/acct/ofc.controller.ts'))
UI, AP, MN, AM, SC, WK = (rd('web/src/app/admin/Ofc.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'),
                          rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, ym = kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m')
day = lambda n: (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')

ok('① 코드 — D263 ofc_events · trg_ofc_event_guard · calendarView(휴가 · 품의 · deadlines · 계약 · 출장 · 업무) · OfcController · OfcCalendar · 메뉴 ofc-calendar · 화면 목록 OFC-010 · 문서 600 · 판 v10.462',
   'CREATE TABLE IF NOT EXISTS public.ofc_events' in M63 and 'trg_ofc_event_guard' in M63 and "'ofc-calendar', '사내 일정', 'admoff'" in M63
   and 'export async function calendarView' in CC and 'acct_leave_requests' in CC and 'deadlines(db' in CC and 'acct_contracts' in CC and 'ofc_trips' in CC and 'ofc_tasks' in CC
   and "@Get('office/calendar')" in OC and 'OfcController' in AM and 'export function OfcCalendar' in UI
   and "['ofc-calendar', '사내 일정']" in MN and "'my-hr', 'ofc-calendar'" in MN and "{tab === 'ofc-calendar' && <OfcCalendar />}" in AP and '"SB-ADM-OFC-010"' in SJ
   and '사내 일정' in doc('600_') and VT >= (10, 462), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    re_, rid, TR = staff('1462r', 'REVIEWER')
    pe, pid, TP = staff('1462p', 'PAYOUT')
    tag = f'시험1462-{stamp}'
    first = today[:8] + '01'
    nxt = (datetime.date.fromisoformat(first) + datetime.timedelta(days=32)).replace(day=1)
    last = (nxt - datetime.timedelta(days=1)).isoformat()
    try:
        far = call('GET', '/admin/office/calendar?from=2026-01-01&to=2026-06-01', None, TR)
        p1 = call('POST', '/admin/office/events', {'title': f'{tag} 개인', 'startOn': today, 'time': '10:30', 'memo': '시험'}, TR)
        c403 = call('POST', '/admin/office/events', {'scope': 'COMPANY', 'title': f'{tag} 회사(막힘)', 'startOn': today}, TR)
        c1 = call('POST', '/admin/office/events', {'scope': 'COMPANY', 'title': f'{tag} 회사', 'startOn': today, 'endOn': today}, TS)
        vr = call('GET', f'/admin/office/calendar?from={first}&to={last}', None, TR)
        vs = call('GET', f'/admin/office/calendar?from={first}&to={last}', None, TS)
        vp = call('GET', f'/admin/office/calendar?from={first}&to={last}', None, TP)
        keys = lambda v: [x.get('key') for x in v.get('items') or []]
        kinds = lambda v: {x.get('kind') for x in v.get('items') or []}
        ok('② 모아 보기 — 62일 넘음 422 · 개인 일정 · 검수 담당 회사 일정 403 · SUPER 회사 일정 · 검수 담당은 둘 다 보임 · SUPER 는 남의 개인 일정 안 보임 · 급여일 모두 · 신고 기한은 지급 담당 · SUPER 만',
           far.get('code') == 'OFC_RANGE' and p1.get('ok') is True and c403.get('_err') == 403 and c403.get('code') == 'OFC_EVENT_SCOPE' and c1.get('ok') is True
           and f"EVENT:{p1.get('id')}" in keys(vr) and f"EVENT:{c1.get('id')}" in keys(vr) and f"EVENT:{p1.get('id')}" not in keys(vs) and f"EVENT:{c1.get('id')}" in keys(vs)
           and 'PAY' in kinds(vr) and 'TAX' not in kinds(vr) and vr.get('finance') is False and vr.get('canCompany') is False
           and 'TAX' in kinds(vp) and vp.get('finance') is True and vs.get('canCompany') is True,
           f"{far.get('code')} {p1.get('ok')} {c403.get('_err')}/{c403.get('code')} {c1.get('ok')} · r {sorted(kinds(vr))} s {sorted(kinds(vs))} p {sorted(kinds(vp))}")
        e1 = call('PUT', f"/admin/office/events/{p1.get('id')}", {'title': f'{tag} 개인 고침', 'time': None}, TR)
        e404 = call('PUT', f"/admin/office/events/{p1.get('id')}", {'title': f'{tag} 남이 고침'}, TS)
        row = psql(f"SELECT title || '|' || coalesce(at_time, '-') || '|' || coalesce(memo, '-') FROM ofc_events WHERE id = {int(p1.get('id') or 0)}")
        badt = call('PUT', f"/admin/office/events/{c1.get('id')}", {'endOn': day(-40)}, TS)
        r1 = call('POST', f"/admin/office/events/{p1.get('id')}/remove", None, TR)
        r2 = call('POST', f"/admin/office/events/{p1.get('id')}/remove", None, TR)
        vr2 = call('GET', f'/admin/office/calendar?from={first}&to={last}', None, TR)
        dl = psql(f"DELETE FROM ofc_events WHERE id = {int(c1.get('id') or 0)}")
        ok('② 고치기 · 지우기 — 보낸 칸만(시각 비움 · 메모 그대로) · 남의 개인 일정 404 · 끝이 시작보다 앞 422 · 지우기 · 다시 지우기 409 · 지운 일정 안 보임 · DB DELETE 막음',
           e1.get('ok') is True and row == f'{tag} 개인 고침|-|시험' and e404.get('_err') == 404 and badt.get('code') == 'OFC_EVENT_DATE'
           and r1.get('ok') is True and r2.get('_err') == 409 and r2.get('code') == 'OFC_EVENT_REMOVED' and f"EVENT:{p1.get('id')}" not in keys(vr2) and '!' in dl,
           f"{e1.get('ok')} {row} {e404.get('_err')} {badt.get('code')} {r1.get('ok')} {r2.get('_err')}/{r2.get('code')} {dl[-40:]}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM ofc_events WHERE title LIKE '시험1462-%'")
        rm_role(rid, '1462'); rm_role(pid, '1462')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['grid'] = pg.locator('[data-ofc-cal-grid]').count()
        seen['days'] = pg.locator('[data-ofc-cal-day]').count()
        pg.locator('[data-ofc-cal-mode=week]').click(); pg.wait_for_timeout(1500)
        seen['week'] = pg.locator('[data-ofc-cal-day]').count()
    r = admin_page('/#/ofc-calendar', chk)
    if r:
        seen, perr = r
        ok('③ 화면 — 사무 › 사내 일정 달 칸(28 ~ 42) · 주 7칸 · 화면 오류 없음', seen.get('grid') == 1 and 28 <= seen.get('days', 0) <= 42 and seen.get('week') == 7 and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
