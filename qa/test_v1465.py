"""v10.465 (D263 · docs/603) 브라우저 알림 — 운영 화면을 열어 둔 동안 Notification API · 계정마다 켬
  ① (코드) D263 ofc_notify_prefs · ofc.browser_notify · ofc.notify_poll_sec · notifyFeed(OPS · APV · TASK) · 화면 BrowserNotify(Notification.requestPermission · 서비스 워커 · 푸시 키 없음)
           · Console 에 <BrowserNotify /> · 왼쪽 트리(AdminTree) 안 고침 · 메뉴 사무 › 내 알림 · 화면 목록 OFC-040 · 문서 603
  ② (API · DB) 처음 꺼짐 · 꺼진 계정 feed on:false · 켜기 · 나에게 온 업무 요청 · 급한 운영 알림은 ADMIN · SUPER 만 · 결재 차례(SUPER) · 전체 끄면 on:false · 켜기 422
  ③ (화면) 사무 › 내 알림 켜기 단추 · 화면 오류 없음
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

TREE = rd('web/src/app/admin/AdminTree.tsx')
ok('① 코드 — D263 ofc_notify_prefs · ofc.browser_notify on · poll 60 · notifyFeed(OPS · APV · TASK) · BrowserNotify(requestPermission · serviceWorker · PushManager 없음) · Console <BrowserNotify /> · AdminTree 안 고침 · 메뉴 · 화면 목록 OFC-040 · 문서 603 · 판 v10.465',
   'CREATE TABLE IF NOT EXISTS public.ofc_notify_prefs' in M63 and "('ofc.browser_notify', 'on'" in M63 and "('ofc.notify_poll_sec', '60'" in M63
   and 'export async function notifyFeed' in CN and 'inbox(db' in CN and "severity = 'CRITICAL'" in CN and "@Get('me/notify/feed')" in OC
   and 'export function BrowserNotify' in UI and 'Notification.requestPermission' in UI and 'serviceWorker' not in UI and 'PushManager' not in UI
   and '<BrowserNotify />' in AP and 'BrowserNotify' not in TREE and 'ofc-notify' not in TREE
   and "['ofc-notify', '내 알림']" in MN and "{tab === 'ofc-notify' && <OfcNotifyBox />}" in AP and '"SB-ADM-OFC-040"' in SJ
   and '브라우저 알림' in doc('603_') and VT >= (10, 465), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    sid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    re_, rid, TR = staff('1465r', 'REVIEWER')
    qe, qid, TQ = staff('1465q', 'PAYOUT')
    tag = f'시험1465-{stamp}'
    g0 = getset('ofc.browser_notify')
    sp0 = psql(f"SELECT enabled || '|' || array_to_string(kinds, ',') FROM ofc_notify_prefs WHERE account_id = '{sid}'")
    alert, rq = '', ''
    try:
        setting('ofc.browser_notify', 'on', '1465')
        p0 = call('GET', '/admin/me/notify', None, TR)
        f0 = call('GET', '/admin/me/notify/feed', None, TR)
        on1 = call('PUT', '/admin/me/notify', {'enabled': True, 'kinds': ['TASK', 'OPS']}, TR)
        badk = call('PUT', '/admin/me/notify', {'enabled': True, 'kinds': ['XX']}, TR)
        tk = call('POST', '/admin/office/tasks', {'title': f'{tag} 알림', 'assigneeId': rid, 'dueOn': today}, TQ)
        alert = psql("INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('OFC_TEST_1465', 'CRITICAL', '시험 1465 급한 알림', '{\"t\": 1}'::jsonb, clock_timestamp()) RETURNING id").split('\n')[0]
        f1 = call('GET', '/admin/me/notify/feed', None, TR)
        k1 = [x.get('key') for x in f1.get('items') or []]
        ok('② 검수 담당 — 처음 꺼짐 · 꺼진 feed on:false · 켜기 · 모르는 종류 400/422 · 나에게 온 업무 요청 · 기한 오늘 · 급한 운영 알림은 안 옴(ADMIN · SUPER 만)',
           p0.get('enabled') is False and p0.get('opsAllowed') is False and f0.get('on') is False and on1.get('ok') is True and badk.get('_err') in (400, 422)
           and f1.get('on') is True and f"task:{tk.get('id')}:{rid}" in k1 and f"task-due:{tk.get('id')}:{today}" in k1 and not any(str(k).startswith('ops:') for k in k1),
           f"{p0.get('enabled')} {f0.get('on')} {on1.get('ok')} {badk.get('_err')} {f1.get('on')} {k1[:6]}")
        rq = str(call('POST', '/admin/acct/requisitions', {'title': f'{tag} 품의', 'amount': 10000, 'accountRole': 'EXP_TRAVEL', 'reason': '시험 1465'}, TQ).get('id') or '')
        son = call('PUT', '/admin/me/notify', {'enabled': True, 'kinds': ['OPS', 'APV']}, TS)
        f2 = call('GET', '/admin/me/notify/feed', None, TS)
        k2 = [x.get('key') for x in f2.get('items') or []]
        ok('② SUPER — 급한 운영 알림(CRITICAL · 확인 안 함) · 결재 차례(품의) · 업무는 안 옴(종류 꺼짐)',
           son.get('ok') is True and f2.get('on') is True and f'ops:{alert}' in k2 and any(str(k).startswith(f'apv:REQ:{rq}:') for k in k2) and not any(str(k).startswith('task') for k in k2),
           f"{son.get('ok')} {alert} {rq} {k2[:6]}")
        setting('ofc.browser_notify', 'off', '1465')
        f3 = call('GET', '/admin/me/notify/feed', None, TR)
        off = call('PUT', '/admin/me/notify', {'enabled': True}, TQ)
        ok('② 전체 끄기 — 켠 계정도 feed on:false · 새로 켜기 422 OFC_NOTIFY_OFF', f3.get('on') is False and off.get('_err') == 422 and off.get('code') == 'OFC_NOTIFY_OFF',
           f"{f3.get('on')} {off.get('_err')}/{off.get('code')}")
    finally:
        setting('ofc.browser_notify', g0 or None, '1465 되돌림')
        psql(f"SET session_replication_role = replica; DELETE FROM ofc_task_comments WHERE task_id IN (SELECT id FROM ofc_tasks WHERE title LIKE '시험1465-%'); "
             f"DELETE FROM ofc_tasks WHERE title LIKE '시험1465-%'; DELETE FROM ops_alerts WHERE alert_code = 'OFC_TEST_1465'; "
             f"DELETE FROM acct_approval_steps WHERE doc_kind = 'REQ' AND doc_id IN (SELECT id FROM acct_requisitions WHERE title LIKE '시험1465-%'); "
             f"DELETE FROM acct_requisitions WHERE title LIKE '시험1465-%'; DELETE FROM ofc_notify_prefs WHERE account_id IN ('{rid}', '{qid}');")
        if sp0 and '|' in sp0:
            en, ks = sp0.split('|', 1)
            psql(f"UPDATE ofc_notify_prefs SET enabled = {'true' if en == 'true' else 'false'}, kinds = string_to_array('{ks}', ',') WHERE account_id = '{sid}'")
        else:
            psql(f"DELETE FROM ofc_notify_prefs WHERE account_id = '{sid}'")
        rm_role(rid, '1465'); rm_role(qid, '1465')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['box'] = pg.locator('[data-ofc-notify]').count()
        seen['toggle'] = pg.locator('[data-ofc-notify-toggle]').count()
        seen['kinds'] = pg.locator('[data-ofc-notify-kind]').count()
    r = admin_page('/#/ofc-notify', chk)
    if r:
        seen, perr = r
        ok('③ 화면 — 사무 › 내 알림 상자 · 켜기/끄기 단추 · 종류 셋 · 화면 오류 없음', seen.get('box') == 1 and seen.get('toggle') == 1 and seen.get('kinds') == 3 and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
