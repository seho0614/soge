"""v10.414 (D250 · docs/551) 담당자 업무 일지
  ① (코드) staff_worklogs(오늘만 · 고치기 · 지우기 막음) · 확인(쌓기만) · API 3 · 화면 · 문서 551
  ② (API · DB) 운영자 쓰기 · 한 일 짧음 422 · 지난 날짜 DB 막음 · 고치기 막음 · 자기 것만 보임 · SUPER 모두 · 확인(한 줄 답) · 지급 담당 확인 403 · 회원 403 · 일보에 숫자
  ③ (화면) 보고 › 업무 일지
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')
UI, AP, MN, SC, WK, AM = rd('web/src/app/admin/Report.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')

ok('① 코드 — D250 staff_worklogs 가드(WORKLOG_DATE · WORKLOG_LOCKED) · staff_worklog_reviews(쌓기만) · API 3 · 감사 · 화면 · 문서 551 · 판 v10.414',
   'CREATE TABLE IF NOT EXISTS public.staff_worklogs' in M50 and 'WORKLOG_DATE' in M50 and 'WORKLOG_LOCKED' in M50 and 'trg_staff_worklog_reviews_ro' in M50
   and 'export async function addWorklog' in WL and 'export async function reviewWorklog' in WL and "@Audit('WORKLOG_ADD', 'ACCOUNT')" in RC and "@Audit('WORKLOG_REVIEW', 'ACCOUNT')" in RC
   and 'export function ReportWorklog' in UI and "['rpt-worklog', '업무 일지']" in MN and 'export function ReportWorklogBoard' in UI and 'export async function worklogBoard' in WL and "@Get('worklogs/board')" in RC and '"SB-ADM-WRP-040"' in SJ and '업무 일지' in doc('551_') and VT >= (10, 414), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1414', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    t0 = psql("SELECT now()")
    try:
        a1 = call('POST', '/admin/worklogs', {'done': '시험 1414 한 일', 'todo': '내일', 'blocked': '없음', 'minutes': 60}, TP)
        sh = call('POST', '/admin/worklogs', {'done': 'x'}, TP)
        past = psql(f"INSERT INTO staff_worklogs (account_id, work_date, done) VALUES ('{pid}', current_date - 3, '시험 1414 지난')")
        upd = psql(f"UPDATE staff_worklogs SET done = '바꿈' WHERE id = {int(a1.get('id') or 0)}")
        mine = call('GET', '/admin/worklogs', None, TP)
        allv = call('GET', '/admin/worklogs', None, TS)
        rv = call('POST', f"/admin/worklogs/{a1.get('id')}/review", {'note': '시험 1414 확인'}, TS)
        rvp = call('POST', f"/admin/worklogs/{a1.get('id')}/review", {'note': 'x'}, TP)
        byb = call('GET', '/admin/worklogs', None, TB)
        mine2 = call('GET', '/admin/worklogs', None, TP)
        row = next((x for x in mine2.get('items') or [] if x.get('id') == a1.get('id')), {})
        day = call('GET', f"/admin/work-reports/view?kind=DAY&period={a1.get('workDate')}", None, TS)
        wl = ((day.get('body') or {}).get('m') or {}).get('worklog') or {}
        ok('② 업무 일지 — 쓰기 · 짧음 422 · 지난 날짜 DB 막음 · 고치기 막음 · 자기 것만 · SUPER 모두 · 확인 · 지급 담당 확인 403 · 회원 403 · 답 보임 · 일보에 숫자',
           a1.get('ok') is True and sh.get('_err') in (400, 422) and 'WORKLOG_DATE' in past and 'WORKLOG_LOCKED' in upd
           and mine.get('all') is False and all(x.get('mine') for x in mine.get('items') or []) and allv.get('all') is True
           and rv.get('ok') is True and rvp.get('_err') == 403 and byb.get('_err') == 403
           and any((r.get('note') or '') == '시험 1414 확인' for r in row.get('reviews') or []) and int(wl.get('entries') or 0) >= 1 and int(wl.get('reviewed') or 0) >= 1,
           f"{a1.get('ok')} {sh.get('_err')} · {past[-30:]} · {upd[-30:]} · {mine.get('all')} {allv.get('all')} · {rv.get('ok')} {rvp.get('_err')} {byb.get('_err')} · {len(row.get('reviews') or [])} · {wl}")
        # 현황판(대표 「업무일지 현황판」) — SUPER 만 · 이 지급 담당은 오늘 「쓴 사람」 · 지급 담당 403
        bd = call('GET', '/admin/worklogs/board', None, TS)
        bdp = call('GET', '/admin/worklogs/board', None, TP)
        me = next((x for x in bd.get('people') or [] if x.get('id') == pid), {})
        ok('② 현황판 — SUPER 만 · 운영자마다 오늘 건수 · 7일 작성률 · 합계(쓴 사람 + 안 쓴 사람 = 운영자) · 지급 담당 403',
           int(me.get('n') or 0) >= 1 and int(me.get('rate7') or 0) > 0 and (bd.get('total') or {}).get('wrote', 0) + (bd.get('total') or {}).get('missing', 0) == (bd.get('total') or {}).get('staff', -1)
           and bdp.get('_err') == 403, f"{me} · {bd.get('total')} · {bdp.get('_err')}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM staff_worklog_reviews WHERE worklog_id IN (SELECT id FROM staff_worklogs WHERE account_id = '{pid}'); DELETE FROM staff_worklogs WHERE account_id = '{pid}'")
        rm_role(pid, '1414')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-rpt-worklog-form]', timeout=30000)
            seen['form'] = pg.locator('[data-rpt-worklog-form]').count(); seen['add'] = pg.locator('[data-rpt-worklog-add]').count()
        res = admin_page('/#/rpt-worklog', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 보고 › 업무 일지 · 쓰기 칸 · 남기기 단추 · 화면 오류 없음', seen.get('form') == 1 and seen.get('add') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
