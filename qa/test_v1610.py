"""v10.610 (docs/752) ㉖ 광고 예산 소진 알림 · 자동 정지 — 광고 › 광고 예산(bzx-ad-budget)
  ① (코드) ad_events 셈 · 예상 노출 제안 · 알림 · 자동 정지 스위치 · 하루 예산 다음 날 다시 노출 · 정기 작업 bzx_frequent · 화면 · SQL · 문서 752 · 판
  ② (API · DB) 입력 400 · 404 · 기준 넘음 알림 한 줄 · 다 씀 알림(스위치 꺼짐 = 멈추지 않음) · 다시 채움 · 스위치 켬 → 소재 PAUSED · 다시 채움 → ACTIVE · 기록 고치기 막음 · 끈 예산 409
  ③ (화면) 광고 예산 탭 · 줄 · 넣기 상자
  (두 번 돌아도 통과 — 「T1610…」 슬롯 · 소재 · 광고 기록 · 예산 · 알림은 시작 · 끝에 replica 로 지움 · 설정은 되돌림)
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



def migr_has(text):
    """18차 SQL 은 메인이 마이그레이션 번호를 붙임(D292 ~) — 번호 없이 모든 마이그레이션에서 글자를 찾음"""
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return False
    for x in sorted(os.listdir(d)):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p) and text in open(p, encoding='utf-8').read():
            return True
    return False


def job(name, tok):
    return call('POST', '/admin/jobs', {'job': name}, tok)


STAMP = int(time.time()) % 1000000
KST = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
TODAY = KST.strftime('%Y-%m-%d')
def day(n):
    return (KST + datetime.timedelta(days=n)).strftime('%Y-%m-%d')


"""시험 몸통"""
AB, CT, JB = rd('src/modules/bzx/ad-budget.ts'), rd('src/modules/bzx/bzx.controller.ts'), rd('src/modules/bzx/jobs.ts')
UI, AP, MN, SC, WC = rd('web/src/app/admin/Bzx.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — ad-budget.ts 기존 ad_events 셈 · 예약 예상 노출 제안 · 알림 BZX_AD_BUDGET · 자동 정지 스위치 · 하루 예산 다음 날 다시 노출 · 정기 작업 bzx_frequent',
   all(f in AB for f in ('FROM ad_events', 'expected_impressions', "'BZX_AD_BUDGET'", "'bzx.ad_autopause'", "status = 'PAUSED' WHERE id = $1::uuid AND status = 'ACTIVE'", 'resumeCreative(', "'PAUSED_BY_BUDGET'"))
   and "@Put('ad-budgets/:creativeId')" in CT and "@Post('ad-budgets/:id/reset')" in CT and 'adBudgetJob(db)' in JB and "case 'bzx_frequent'" in SC and "'bzx_frequent'," in WC,
   f"{len(AB)}")
ok('① 화면 · SQL · 문서 — 광고 › 광고 예산(bzx-ad-budget · SB-ADM-BZX-020) · 표 · 쌓기만 기록 · 설정 처음 off · 문서 752 · 판',
   'export function BzxAdBudgets' in UI and "['bzx-ad-budget', '광고 예산']" in MN and "screen: 'SB-ADM-BZX-020'" in MN and "'bzx-ad-budget': ['ADMIN', 'SUPER']" in AP
   and '"SB-ADM-BZX-020"' in SJ and migr_has('CREATE TABLE IF NOT EXISTS public.bzx_ad_budgets') and migr_has("('bzx.ad_autopause', 'off'") and migr_has("('bzx_frequent', 10,")
   and '자동 정지' in doc('752_') and VT >= (10, 610), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    sl, code = f'T1610{STAMP}', f'T1610{STAMP}'
    old = getset('bzx.ad_autopause')
    def imps(cid, k):
        return psql(f"INSERT INTO ad_events (creative_id, slot_code, event_type) SELECT '{cid}', '{sl}', 'IMPRESSION' FROM generate_series(1, {k})")
    def clean():
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'BZX_AD_BUDGET' AND detail->>'creativeId' IN (SELECT id::text FROM ad_placements WHERE creative_code = '{code}'); "
             f"DELETE FROM bzx_ad_budget_events WHERE budget_id IN (SELECT b.id FROM bzx_ad_budgets b JOIN ad_placements p ON p.id = b.creative_id WHERE p.creative_code = '{code}'); "
             f"DELETE FROM bzx_ad_budgets WHERE creative_id IN (SELECT id FROM ad_placements WHERE creative_code = '{code}'); "
             f"DELETE FROM ad_events WHERE creative_id IN (SELECT id FROM ad_placements WHERE creative_code = '{code}'); "
             f"DELETE FROM ad_placements WHERE creative_code = '{code}'; DELETE FROM ad_slots WHERE code = '{sl}';")
    clean()
    try:
        setting('bzx.ad_autopause', 'off', '1610')
        psql(f"INSERT INTO ad_slots (code, name, placement, is_active) VALUES ('{sl}', '시험 1610', '시험', true)")
        cid = psql(f"INSERT INTO ad_placements (slot_code, creative_code, advertiser, title, body, status) VALUES ('{sl}', '{code}', '시험광고1610', '시험 소재', '문구', 'ACTIVE') RETURNING id").split('\n')[0]
        b0 = call('PUT', f'/admin/bzx/ad-budgets/{cid}', {'capKind': 'IMPRESSION', 'capValue': 0}, TS)
        b1 = call('PUT', f'/admin/bzx/ad-budgets/{cid}', {'capKind': 'IMPRESSION', 'capValue': 10, 'period': 'TOTAL', 'alertPct': 40}, TS)
        b404 = call('PUT', '/admin/bzx/ad-budgets/00000000-0000-0000-0000-000000000000', {'capKind': 'IMPRESSION', 'capValue': 10}, TS)
        bs = call('PUT', f'/admin/bzx/ad-budgets/{cid}', {'capKind': 'IMPRESSION', 'capValue': 10, 'period': 'TOTAL', 'alertPct': 80, 'autoPause': True}, TS)
        bid = str(bs.get('id') or '')
        ok('② 예산 넣기 — 상한 0 · 알림 40% 는 400 · 없는 소재 404 · 넣음(자동 정지 고름)',
           b0.get('_err') == 400 and b1.get('_err') == 400 and b404.get('_err') == 404 and bid.isdigit() and bs.get('created') is True, f"{b0.get('_err')} {b1.get('_err')} {b404.get('_err')} {bs}")
        imps(cid, 8)
        j1 = job('bzx_frequent', TS)
        near = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'BZX_AD_BUDGET' AND detail->>'budgetId' = '{bid}' AND title LIKE '%80%%'")
        j1b = job('bzx_frequent', TS)
        near2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'BZX_AD_BUDGET' AND detail->>'budgetId' = '{bid}'")
        lst = call('GET', '/admin/bzx/ad-budgets', None, TS)
        row = next((x for x in lst.get('items') or [] if x.get('id') == bid), {})
        ok('② 노출 8 / 10 → 기준(80%) 넘음 운영 알림 한 줄(두 번 돌려도 한 줄) · 목록 쓴 양 8 · 80%',
           near == '1' and near2 == '1' and row.get('used') == 8 and row.get('pct') == 80 and row.get('state') == 'ON', f"{j1.get('detail') or j1} {near} {near2} {row}")
        imps(cid, 3)
        job('bzx_frequent', TS)
        sp = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'BZX_AD_BUDGET' AND detail->>'budgetId' = '{bid}' AND title LIKE '%다 씀%' AND title LIKE '%스위치 꺼짐%'")
        stA = psql(f"SELECT status FROM ad_placements WHERE id = '{cid}'")
        ok('② 11 / 10 → 다 씀 알림 · 자동 정지 스위치 꺼져 있어 소재는 ACTIVE 그대로', sp == '1' and stA == 'ACTIVE', f"{sp} {stA}")
        r1 = call('POST', f'/admin/bzx/ad-budgets/{bid}/reset', None, TS)
        setting('bzx.ad_autopause', 'on', '1610')
        time.sleep(1.1)
        imps(cid, 11)
        job('bzx_frequent', TS)
        stP = psql(f"SELECT p.status || '|' || b.state FROM ad_placements p JOIN bzx_ad_budgets b ON b.creative_id = p.id WHERE p.id = '{cid}'")
        evp = psql(f"SELECT count(*) FROM bzx_ad_budget_events WHERE budget_id = {bid} AND kind = 'PAUSED'")
        ok('② 다시 채움 → 셈 0 부터 · 스위치 켬 · 11 / 10 → 소재 PAUSED · 예산 PAUSED_BY_BUDGET · 기록 PAUSED',
           r1.get('ok') is True and stP == 'PAUSED|PAUSED_BY_BUDGET' and evp == '1', f"{r1} {stP} {evp}")
        r2 = call('POST', f'/admin/bzx/ad-budgets/{bid}/reset', None, TS)
        stR = psql(f"SELECT p.status || '|' || b.state FROM ad_placements p JOIN bzx_ad_budgets b ON b.creative_id = p.id WHERE p.id = '{cid}'")
        g = psql(f"UPDATE bzx_ad_budget_events SET note = 'x' WHERE budget_id = {bid}")
        of = call('POST', f'/admin/bzx/ad-budgets/{bid}/off', None, TS)
        r3 = call('POST', f'/admin/bzx/ad-budgets/{bid}/reset', None, TS)
        ok('② 다시 채움 → 우리가 멈춘 소재 다시 ACTIVE(resumed) · 기록은 고치기 막힘 · 끄기 · 끈 예산 다시 채움 409',
           r2.get('resumed') is True and stR == 'ACTIVE|ON' and '!' in g and of.get('ok') is True and r3.get('_err') == 409, f"{r2} {stR} {g[-40:]} {of} {r3.get('code')}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-bzx-ad]', timeout=30000); pg.wait_for_timeout(800)
                seen['row'] = pg.locator(f'[data-bzx-ad-row="{bid}"]').count()
                seen['form'] = pg.locator('[data-bzx-ad-form]').count()
            res3 = admin_page('/#/bzx-ad-budget', chk)
            if res3 is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res3
                ok('③ 화면 — 광고 › 광고 예산 · 예산 줄 · 넣기 상자 · 화면 오류 없음', seen.get('row') == 1 and seen.get('form') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        clean()
        setting('bzx.ad_autopause', old or 'off', '1610 되돌림')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
