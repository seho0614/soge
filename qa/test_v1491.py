"""v10.491 (D270 · docs/629) IT 자산 · SaaS 구독
  ① (코드) D270 its_assets(지우기 막음 · 해지만) · 자산 번호 정규식 서버 = DB · 자금 흐름 예정(acct_cash_plans) 잇기 · 정기 작업 its_office_daily 08:55 · 화면 ItsAssets · 메뉴 · 화면 목록 ITS-020 · 문서 629
  ② (API · DB) 넣기 → 매달 예정(OUT · MONTHLY) · 금액 바꾸면 옛 예정 취소 · 새 예정 · 메모만 바꾸면 그대로 · 매년 = 한 번 예정 · 무료 금액 422 · 갱신일 없음 422 · 검수 담당 403 · 갱신 알림 ITS_ASSET_RENEW(7 · 30일 칸) · 자동 갱신일 옮김 · 해지 → 예정 취소 · 두 번 409 · DB 가 지우기 막음
  ③ (화면) 사무 › IT 자산 · 구독 목록 · 넣기 상자 · 화면 오류 없음
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


M70 = migr('D270_')
KY, AS, SG, SV, DY, IC = (rd('src/modules/admin/its-keys.ts'), rd('src/modules/admin/its-assets.ts'), rd('src/modules/admin/its-suggest.ts'),
                          rd('src/modules/admin/its-survey.ts'), rd('src/modules/admin/its-daily.ts'), rd('src/modules/admin/its.controller.ts'))
UI, AP, MN, AM, SC, WK = (rd('web/src/app/admin/Its.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'),
                          rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
day = lambda n: (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')

ok('① 코드 — D270 its_assets · trg_its_asset_guard · 자산 번호 정규식 같음 · syncCashPlan · its_office_daily 08:55 · ItsController 자산 4 · ItsAssets · 메뉴 · 화면 목록 ITS-020 · 문서 629 · 판 v10.491',
   'CREATE TABLE IF NOT EXISTS public.its_assets' in M70 and 'trg_its_asset_guard' in M70 and "asset_tag ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'" in M70
   and "ASSET_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/" in AS and 'export async function syncCashPlan' in AS and 'INSERT INTO acct_cash_plans' in AS
   and "('its_office_daily', 1440, 8, 55" in M70 and "case 'its_office_daily':" in SC and "'its_office_daily'," in WK and 'itsAssetRenewJob' in DY
   and "@Post('its/assets/:id/cancel')" in IC and 'export function ItsAssets' in UI and "['its-assets', 'IT 자산 · 구독']" in MN and "{tab === 'its-assets' && <ItsAssets />}" in AP
   and '"SB-ADM-ITS-020"' in SJ and 'deduct' not in M70 and 'account_no' not in M70 and '구독' in doc('629_') and VT >= (10, 491), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid, TA = staff('1491a', 'PAYOUT')
    be, bid, TB = staff('1491b', 'REVIEWER')
    tag = f'시험1491-{stamp}'
    t0 = psql("SELECT now()")
    s0, d0 = getset('its.asset_alert'), getset('its.asset_alert_days')
    plan = lambda pid: psql(f"SELECT state || '|' || direction || '|' || repeat || '|' || amount::text || '|' || due_on::text || '|' || memo FROM acct_cash_plans WHERE id = {int(pid or 0)}")
    try:
        setting('its.asset_alert', 'on', '1491'); setting('its.asset_alert_days', '30,7', '1491')
        n1 = call('POST', '/admin/its/assets', {'kind': 'SAAS', 'name': f'{tag} 협업', 'vendor': '시험사', 'seats': 10, 'seatsUsed': 7, 'ownerId': aid,
                                                 'billingCycle': 'MONTHLY', 'costAmount': 50000, 'renewOn': day(5), 'cashPlan': True}, TA)
        p1 = plan(n1.get('cashPlanId'))
        f403 = call('GET', '/admin/its/assets', None, TB)
        e1 = call('PUT', f"/admin/its/assets/{n1.get('id')}", {'costAmount': 60000}, TA)
        p1b = plan(n1.get('cashPlanId'))
        new_pid = psql(f"SELECT cash_plan_id FROM its_assets WHERE id = {int(n1.get('id') or 0)}")
        p1c = plan(new_pid)
        e2 = call('PUT', f"/admin/its/assets/{n1.get('id')}", {'memo': '메모만'}, TA)
        same = psql(f"SELECT cash_plan_id FROM its_assets WHERE id = {int(n1.get('id') or 0)}") == new_pid
        ok('② 넣기 · 고치기 — 매달 예정(OUT · MONTHLY · 50,000 · 「IT 구독 · …」) · 검수 담당 403 · 금액 바꾸면 옛 예정 취소 · 새 예정 60,000 · 메모만 바꾸면 예정 그대로',
           n1.get('ok') is True and p1.startswith('ACTIVE|OUT|MONTHLY|50000|') and f'IT 구독 · {tag}' in p1 and f403.get('_err') == 403
           and e1.get('cashPlanChanged') is True and p1b.startswith('CANCELED|') and p1c.startswith('ACTIVE|OUT|MONTHLY|60000|') and e2.get('cashPlanChanged') is False and same,
           f"{n1.get('ok')} {p1[:40]} {f403.get('_err')} {e1.get('cashPlanChanged')} {p1b[:20]} {p1c[:30]} {e2.get('cashPlanChanged')} {same}")
        n2 = call('POST', '/admin/its/assets', {'kind': 'DOMAIN', 'name': f'{tag} 도메인', 'billingCycle': 'YEARLY', 'costAmount': 1200000, 'renewOn': day(20)}, TA)
        p2 = plan(n2.get('cashPlanId'))
        lst = call('GET', '/admin/its/assets', None, TA)
        it2 = next((x for x in lst.get('items') or [] if x.get('id') == n2.get('id')), {})
        free = call('POST', '/admin/its/assets', {'kind': 'SAAS', 'name': f'{tag} 무료', 'billingCycle': 'FREE', 'costAmount': 100}, TA)
        nodate = call('POST', '/admin/its/assets', {'kind': 'SAAS', 'name': f'{tag} 날짜 없음', 'billingCycle': 'MONTHLY', 'costAmount': 1000}, TA)
        badtag = call('POST', '/admin/its/assets', {'kind': 'DEVICE', 'name': f'{tag} 노트북', 'assetTag': '-bad tag', 'billingCycle': 'ONCE'}, TA)
        ok('② 매년 · 검사 — 매년 = 한 번 예정(NONE · 갱신일) · 달 비용 100,000 · 무료에 금액 422 · 매달인데 갱신일 없음 422 · 자산 번호 모양 400',
           p2.startswith(f'ACTIVE|OUT|NONE|1200000|{day(20)}|') and it2.get('monthly') == 100000 and free.get('code') == 'ITS_ASSET_COST'
           and nodate.get('code') == 'ITS_ASSET_DATE' and badtag.get('_err') == 400,
           f"{p2[:40]} {it2.get('monthly')} {free.get('code')} {nodate.get('code')} {badtag.get('_err')}")
        n3 = call('POST', '/admin/its/assets', {'kind': 'CLOUD', 'name': f'{tag} 서버', 'billingCycle': 'YEARLY', 'costAmount': 240000, 'renewOn': day(-3), 'autoRenew': True}, TA)
        jb = call('POST', '/admin/jobs', {'job': 'its_office_daily'}, TS)
        r3 = psql(f"SELECT renew_on::text FROM its_assets WHERE id = {int(n3.get('id') or 0)}")
        p3 = plan(psql(f"SELECT cash_plan_id FROM its_assets WHERE id = {int(n3.get('id') or 0)}"))
        d3 = kst - datetime.timedelta(days=3)
        nx = d3.replace(year=d3.year + 1).strftime('%Y-%m-%d') if not (d3.month == 2 and d3.day == 29) else ''
        al1 = psql(f"SELECT severity || '|' || title FROM ops_alerts WHERE alert_code = 'ITS_ASSET_RENEW' AND detail->>'key' = '{n1.get('id')}|{day(5)}|7' AND resolved_at IS NULL")
        al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ITS_ASSET_RENEW' AND detail->>'key' = '{n2.get('id')}|{day(20)}|30' AND resolved_at IS NULL")
        ok('② 정기 작업 its_office_daily — 자동 갱신 지난 갱신일을 1년 뒤로 · 새 예정 · 갱신 알림 7일 칸 · 30일 칸',
           jb.get('_err') is None and (not nx or r3 == nx) and r3 > today and p3.startswith(f'ACTIVE|OUT|NONE|240000|{r3}|') and al1.startswith('WARN|') and tag in al1 and al2 == '1',
           f"{jb.get('_err')} {r3} {nx} {p3[:40]} {al1[:30]} {al2}")
        c1 = call('POST', f"/admin/its/assets/{n1.get('id')}/cancel", {'reason': '시험 1491 해지'}, TA)
        c2 = call('POST', f"/admin/its/assets/{n1.get('id')}/cancel", {'reason': '시험 1491 해지'}, TA)
        e3 = call('PUT', f"/admin/its/assets/{n1.get('id')}", {'memo': '해지 뒤'}, TA)
        p1d = plan(new_pid)
        call('POST', '/admin/jobs', {'job': 'its_office_daily'}, TS)
        al1r = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ITS_ASSET_RENEW' AND detail->>'assetId' = '{n1.get('id')}' AND resolved_at IS NULL")
        dl = psql(f"DELETE FROM its_assets WHERE id = {int(n1.get('id') or 0)}")
        ok('② 해지 — 예정 취소 · 두 번 409 · 해지 뒤 고치기 409 · 알림 풀림 · DB 가 지우기 막음',
           c1.get('ok') is True and c2.get('_err') == 409 and e3.get('_err') == 409 and p1d.startswith('CANCELED|') and al1r == '0' and '!' in dl,
           f"{c1.get('ok')} {c2.get('_err')} {e3.get('_err')} {p1d[:12]} {al1r} {dl[-40:]}")
    finally:
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'ITS_ASSET_RENEW' AND detail->>'assetId' IN (SELECT id::text FROM its_assets WHERE name LIKE '시험1491-%'); "
             f"DELETE FROM its_assets WHERE name LIKE '시험1491-%'; DELETE FROM acct_cash_plans WHERE memo LIKE 'IT 구독 · 시험1491-%';")
        setting('its.asset_alert', s0 or None, '1491 되돌림'); setting('its.asset_alert_days', d0 or None, '1491 되돌림')
        rm_role(aid, '1491'); rm_role(bid, '1491')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['sec'] = pg.locator('[data-its-assets]').count()
        pg.locator('[data-its-asset-add]').click(); pg.wait_for_timeout(800)
        seen['form'] = pg.locator('[data-its-asset-form]').count()
    r = admin_page('/#/its-assets', chk)
    if r:
        seen, perr = r
        ok('③ 화면 — 사무 › IT 자산 · 구독 · 넣기 상자 · 화면 오류 없음', seen.get('sec') == 1 and seen.get('form') == 1 and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
