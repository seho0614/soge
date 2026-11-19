"""v10.412 (D250 · docs/549) 업무 보고 — 일보
  ① (코드) D250 보고 기록(쌓기만) · 정기 작업 ops_report · 일보 숫자 · API · 메뉴 「보고」 · 화면 · 문서 549
  ② (API · DB) 일보 보기(어제 · 지금 계산) · 지금 만들기 · 다시 보면 남긴 보고 · 고치기 막힘 · 회원 403 · 틀린 종류 · 날짜 422 · 정기 작업 두 번이어도 같은 기간 JOB 하나
  ③ (화면) 보고 › 일보
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

ok('① 코드 — D250 report_snapshots(쌓기만) · ops_report 07:00 · 일보 숫자(회원 · 거래 · 소개몰 · 매출 · 고객센터 · 알림 · 일지) · API · 메뉴 · 화면 · 문서 549 · 판 v10.412',
   'CREATE TABLE IF NOT EXISTS public.report_snapshots' in M50 and 'trg_report_snapshots_ro' in M50 and "('ops_report', 1440, 7, 0" in M50
   and 'export async function metrics' in RD and 'account_withdrawals' in RD and "e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')" in RD and 'export function textOf' in RD
   and "@Get('work-reports/view')" in RC and "@Audit('REPORT_MAKE', 'SETTING')" in RC and 'WorkReportController' in AM
   and "case 'ops_report':" in SC and "'ops_report'," in WK and "['rpt-day', '일보']" in MN and "label: '보고'" in MN and 'export function ReportDay' in UI and "'rpt-day'" in AP
   and '"SB-ADM-WRP-010"' in SJ and '일보' in doc('549_') and VT >= (10, 412), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    today, yday = kst.strftime('%Y-%m-%d'), (kst - datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    v0 = call('GET', f'/admin/work-reports/view?kind=DAY&period={yday}', None, TS)
    mk = call('POST', '/admin/work-reports/make', {'kind': 'DAY', 'period': today}, TS)
    v1 = call('GET', f'/admin/work-reports/view?kind=DAY&period={today}', None, TS)
    upd = psql(f"UPDATE report_snapshots SET period = period WHERE id = {int(mk.get('id') or 0)}")
    byb = call('GET', f'/admin/work-reports/view?kind=DAY&period={today}', None, TB)
    badk = call('GET', '/admin/work-reports/view?kind=YEAR', None, TS)
    badp = call('GET', '/admin/work-reports/view?kind=DAY&period=2026-13-40', None, TS)
    ok('② 일보 — 어제 보기(숫자 묶음 7 · 글) · 지금 만들기 · 다시 보면 남긴 보고 · 고치기 DB 막힘 · 회원 403 · 틀린 종류 · 날짜 422',
       set((v0.get('body') or {}).get('m', {}).keys()) >= {'members', 'trade', 'mall', 'money', 'cs', 'alerts', 'worklog'} and '업무 일보' in (v0.get('text') or '')
       and mk.get('ok') is True and (v1.get('snapshot') or {}).get('id') == mk.get('id') and v1.get('live') is False
       and '!' in upd and byb.get('_err') == 403 and badk.get('code') == 'REPORT_KIND' and badp.get('code') == 'REPORT_PERIOD',
       f"{list(((v0.get('body') or {}).get('m') or {}).keys())} · {mk.get('ok')} {mk.get('id')} · {(v1.get('snapshot') or {}).get('id')} {v1.get('live')} · {upd[-40:]} · {byb.get('_err')} {badk.get('code')} {badp.get('code')}")
    j1 = call('POST', '/admin/jobs', {'job': 'ops_report'}, TS)
    j2 = call('POST', '/admin/jobs', {'job': 'ops_report'}, TS)
    nj = psql(f"SELECT count(*) FROM report_snapshots WHERE kind = 'DAY' AND period = '{yday}' AND source = 'JOB'")
    ok('② 정기 작업 ops_report — 두 번 돌려도 어제 일보 JOB 은 하나',
       nj == '1' and not j1.get('_err') and not j2.get('_err'), f"{nj} · {j1.get('_err') or 'ok'} {j2.get('_err') or 'ok'}")
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-rpt="DAY"]', timeout=30000)
            seen['sec'] = pg.locator('[data-rpt="DAY"]').count(); seen['tbl'] = pg.locator('[data-rpt-table]').count(); seen['make'] = pg.locator('[data-rpt-make]').count()
        res = admin_page('/#/rpt-day', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 보고 › 일보 · 표 · 지금 만들기 · 화면 오류 없음', seen.get('sec') == 1 and seen.get('tbl') == 1 and seen.get('make') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
