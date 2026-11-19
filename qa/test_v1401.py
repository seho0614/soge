"""v10.401 (D247 · docs/538) 받을 돈 · 갚을 돈 기간 분석
  ① (코드) FIFO 나이 · 설정 · 정기 작업 acct_aging · 알림 ACCT_AGING_OVER · API · 화면 · 문서
  ② (API) 시험 거래처 50,000(100일 전) + 20,000(10일 전) − 30,000 → 남은 40,000 · 넘음 20,000 · 30일 안 20,000
  ③ (정기 작업) 넘은 몫 알림 하나(두 번 돌려도) · 다 받으면 풀림
  ④ (화면) 회계 › 기간 분석
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


import glob as _glob
def mig(prefix):
    xs = sorted(_glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(xs[0], encoding='utf-8').read() if xs else ''


M47 = mig('D247')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SR = rd('src/modules/acct/sources.ts')
SC, WK = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')


AG = rd('src/modules/acct/aging.ts')
ok('① 코드 — 기간 분석(AR · AP · CARD_AP · FIFO · 30 · 60 · 90 · 넘음) · 설정 2 · 정기 작업 acct_aging(09:25) · 알림 ACCT_AGING_OVER · 월 결산 한 줄 · API · 화면 · 문서 538 · 판 v10.401',
   'export async function aging' in AG and "'ACCT_AGING_OVER'" in AG and 'export async function agingLine' in AG and "'acct.aging_alert_days'" in M47 and "('acct_aging', 1440, 9, 25," in M47
   and "case 'acct_aging':" in SC and "'acct_aging'" in WK and "@Get('aging')" in AC and 'export function AcctAging' in UI and "'acct-aging'" in MN
   and '"SB-ADM-ACC-160"' in SJ and '기간 분석' in doc('538_') and VT >= (10, 401), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1401', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    today = kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    party = f'시험거래처1401-{stamp}'
    keep = {k: getset(k) for k in ('acct.aging_alert_days', 'acct.aging_alert')}
    t0 = psql("SELECT now()")
    def entry(d, key, lines):
        vals = ', '.join(f"('{r}', {dbt}, {crd})" for r, dbt, crd in lines)
        return psql(f"WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo, party) VALUES ('{d}', 'TEST', '{key}', '시험 1401', '{party}') RETURNING id) "
                    f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT e.id, x.r, x.d, x.c FROM e, (VALUES {vals}) AS x(r, d, c)")
    old = (kst - datetime.timedelta(days=100)).strftime('%Y-%m-%d')
    new = (kst - datetime.timedelta(days=10)).strftime('%Y-%m-%d')
    try:
        setting('acct.aging_alert_days', '90', '1401'); setting('acct.aging_alert', 'on', '1401')
        e1 = entry(old, f't1401a-{stamp}', [('AR', 50000, 0), ('REV_AD', 0, 50000)])
        e2 = entry(new, f't1401b-{stamp}', [('AR', 20000, 0), ('REV_AD', 0, 20000)])
        e3 = entry(today, f't1401c-{stamp}', [('CASH', 30000, 0), ('AR', 0, 30000)])
        g = call('GET', '/admin/acct/aging', None, TP)
        row = next((x for x in g.get('rows') or [] if x.get('party') == party and x.get('role') == 'AR'), {})
        mb = call('GET', '/admin/acct/aging', None, TB)
        ok('② 기간 분석 — 50,000(100일 전) + 20,000(10일 전) − 30,000(오늘) = 남은 40,000 · 먼저 생긴 몫부터 갚음 → 90일 넘음 20,000 · 30일 안 20,000 · 가장 오래된 날 100일 전 · 회원 403',
           '!' not in e1 + e2 + e3 and row.get('open') == 40000 and row.get('over') == 20000 and row.get('b30') == 20000 and row.get('oldest') == old and mb.get('_err') == 403,
           f"{(e1 + e2 + e3)[-60:]} · {row} · {mb.get('_err')}")
        key = f'AR|{party}'
        j1 = call('POST', '/admin/jobs', {'job': 'acct_aging'}, TS)
        j2 = call('POST', '/admin/jobs', {'job': 'acct_aging'}, TS)
        n1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_AGING_OVER' AND resolved_at IS NULL AND detail->>'key' = '{key}'")
        e4 = entry(today, f't1401d-{stamp}', [('CASH', 40000, 0), ('AR', 0, 40000)])
        call('POST', '/admin/jobs', {'job': 'acct_aging'}, TS)
        n2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_AGING_OVER' AND resolved_at IS NULL AND detail->>'key' = '{key}'")
        rs = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_AGING_OVER' AND resolved_at IS NOT NULL AND detail->>'key' = '{key}'")
        ok('③ 정기 작업 — 넘은 몫 있으면 ACCT_AGING_OVER 하나(두 번 돌려도) · 다 받으면 풀림',
           n1 == '1' and n2 == '0' and int(rs or 0) >= 1 and not j1.get('_err') and not j2.get('_err') and '!' not in e4, f"{n1} → {n2} · 풀림 {rs} · {j1.get('_err') or ''}{j2.get('_err') or ''}")
    finally:
        for k, v in keep.items():
            if v: setting(k, v, '1401 되돌림')
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source = 'TEST' AND source_key LIKE 't1401_-{stamp}'); "
             f"DELETE FROM acct_entries WHERE source = 'TEST' AND source_key LIKE 't1401_-{stamp}'; COMMIT;")
        psql(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1401' WHERE alert_code = 'ACCT_AGING_OVER' AND resolved_at IS NULL AND raised_at >= '{t0}'::timestamptz")
        rm_role(pid, '1401')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-aging]', timeout=30000); pg.wait_for_timeout(1500)
            seen['totals'] = pg.locator('[data-aging-total]').count()
        res = admin_page('/#/acct-aging', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 기간 분석 · 합계 3줄(받을 돈 · 갚을 돈 · 카드) · 화면 오류 없음', seen.get('totals') == 3 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
