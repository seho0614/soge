"""v10.394 (D245 · docs/531) 자금 흐름 90일
  ① (코드) 표 acct_cash_balances(쌓기만) · acct_cash_plans(취소만) · 설정 6 · 정기 작업 acct_cashflow(09:20) · API 5 · 화면 · 문서 531
  ② (API) 90일 날마다 잔액 · 회원 403 · 잔액 넣기 SUPER 만 · 넣은 잔액이 시작 잔액 · 날마다 잔액 = 전날 + 들어옴 − 나감
  ③ (예정) 예정 넣기 → 그날 나감 줄 · 지난 날짜 · 금액 0 은 422 · 날짜 모양 400 · 취소(두 번째 422) · 지우기는 DB 가 막음
  ④ (정기 작업) 기준 밑이면 ACCT_CASH_SHORT 하나(두 번 돌려도) · 넉넉해지면 풀림
  ⑤ (화면) 회계 › 자금 흐름 · 가장 낮은 날 줄
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


import glob
M45 = next((open(p, encoding='utf-8').read() for p in glob.glob(os.path.join(K, 'prisma/migrations/D245_*/migration.sql'))), '')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
CF, SC, WK = rd('src/modules/acct/cashflow.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — 표 2(쌓기만 · 취소만) · 설정 6 · 정기 작업 acct_cashflow(09:20) · 알림 ACCT_CASH_SHORT · API 5 · 화면 · 메뉴 탭 · 화면 ID · 문서 531 · 판 v10.394',
   'CREATE TABLE IF NOT EXISTS public.acct_cash_balances' in M45 and 'CREATE TABLE IF NOT EXISTS public.acct_cash_plans' in M45 and 'trg_acct_cash_balances_ro' in M45 and 'fn_acct_cash_plan_guard' in M45
   and all(f"'acct.{k}'" in M45 for k in ('pg_settle_days', 'card_pay_day', 'ap_pay_days', 'seller_pay_days', 'cash_floor', 'cash_alert'))
   and "('acct_cashflow', 1440, 9, 20," in M45 and "'ACCT_CASH_SHORT'" in CF and 'export async function cashflow' in CF and 'export async function acctCashflowJob' in CF
   and "case 'acct_cashflow':" in SC and "'acct_cashflow'," in WK
   and "@Get('cashflow')" in AC and "@Post('cashflow/balance')" in AC and "@Get('cashflow/plans')" in AC and "@Post('cashflow/plans')" in AC and "@Post('cashflow/plans/:id/cancel')" in AC
   and 'export function AcctCashflow' in UI and "'acct-cash'" in MN and "'acct-cash'" in AP and '"SB-ADM-ACC-090"' in SJ and '자금 흐름' in doc('531_') and VT >= (10, 394), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1394', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    today = kst.strftime('%Y-%m-%d')
    day5 = (kst + datetime.timedelta(days=5)).strftime('%Y-%m-%d')
    keep = {k: getset(k) for k in ('acct.cash_floor', 'acct.cash_alert')}
    t0 = psql("SELECT now()")
    stamp = int(time.time()) % 1000000
    X = 900000000000 + stamp          # 넉넉한 시작 잔액(시험만 · 끝나면 지움)
    Y = 1000 + stamp % 9000
    memo = f'시험1394 {stamp}'
    plan_id = None
    try:
        c0 = call('GET', '/admin/acct/cashflow?days=90', None, TP)
        cb = call('GET', '/admin/acct/cashflow', None, TB)
        bp = call('POST', '/admin/acct/cashflow/balance', {'asOf': today, 'amount': X}, TP)
        bs = call('POST', '/admin/acct/cashflow/balance', {'asOf': today, 'amount': X, 'note': '시험 1394'}, TS)
        c1 = call('GET', '/admin/acct/cashflow?days=90', None, TP)
        rows = c1.get('rows') or []
        chain = all(rows[i]['balance'] == (rows[i - 1]['balance'] if i else c1.get('start')) + rows[i]['in'] - rows[i]['out'] for i in range(len(rows)))
        ok('② 90일 — 날 90줄 · 회원 403 · 잔액 넣기는 SUPER 만(PAYOUT 403) · 넣은 잔액이 시작 잔액(오늘 · 직접 넣음) · 날마다 잔액 = 전날 + 들어옴 − 나감 · 가장 낮은 날',
           len(c0.get('rows') or []) == 90 and cb.get('_err') == 403 and bp.get('_err') == 403 and bs.get('ok') is True
           and (c1.get('base') or {}).get('source') == 'MANUAL' and (c1.get('base') or {}).get('date') == today and int(c1.get('start', -1)) == X
           and len(rows) == 90 and chain and isinstance((c1.get('lowest') or {}).get('balance'), int) and c1.get('hasBase') is True,
           f"{len(c0.get('rows') or [])} · {cb.get('_err')} · {bp.get('_err')} {bs.get('ok')} · {c1.get('base')} start {c1.get('start')} = {X} · 이음 {chain} · {c1.get('lowest')}")

        pa = call('POST', '/admin/acct/cashflow/plans', {'dueOn': day5, 'direction': 'OUT', 'amount': Y, 'memo': memo}, TP)
        plan_id = pa.get('id')
        c2 = call('GET', '/admin/acct/cashflow?days=90', None, TP)
        r5 = next((r for r in c2.get('rows') or [] if r['date'] == day5), {})
        hit = [x for x in r5.get('items') or [] if x.get('kind') == 'PLAN_OUT' and x.get('amount') == Y and str(x.get('label', '')).startswith(memo)]
        r5b = next((r for r in c1.get('rows') or [] if r['date'] == day5), {})
        past = call('POST', '/admin/acct/cashflow/plans', {'dueOn': '2020-01-01', 'direction': 'OUT', 'amount': 1000, 'memo': memo}, TP)
        zero = call('POST', '/admin/acct/cashflow/plans', {'dueOn': day5, 'direction': 'IN', 'amount': 0, 'memo': memo}, TP)
        bad = call('POST', '/admin/acct/cashflow/plans', {'dueOn': '2026-13-01', 'direction': 'IN', 'amount': 1000, 'memo': memo}, TP)
        cn1 = call('POST', f'/admin/acct/cashflow/plans/{plan_id}/cancel', {'reason': '시험 1394 취소'}, TP) if plan_id else {}
        cn2 = call('POST', f'/admin/acct/cashflow/plans/{plan_id}/cancel', {'reason': '시험 1394 취소'}, TP) if plan_id else {}
        dl = psql(f"DELETE FROM acct_cash_plans WHERE id = {int(plan_id or 0)}")
        c3 = call('GET', '/admin/acct/cashflow?days=90', None, TP)
        r5c = next((r for r in c3.get('rows') or [] if r['date'] == day5), {})
        ok('③ 예정 — 넣으면 그날 나감 줄(금액 · 메모) · 그날 나감이 그만큼 늘어남 · 지난 날짜 · 금액 0 은 422 CASH_PLAN · 날짜 모양 400 · 취소(두 번째 422) · 취소하면 빠짐 · 지우기는 DB 가 막음',
           bool(plan_id) and len(hit) == 1 and r5.get('out', 0) - r5b.get('out', 0) == Y
           and past.get('_err') == 422 and past.get('code') == 'CASH_PLAN' and zero.get('_err') == 422 and bad.get('_err') == 400
           and cn1.get('ok') is True and cn2.get('_err') == 422 and '지우지 않습니다' in dl and r5c.get('out', -1) == r5b.get('out', -2),
           f"{plan_id} · {len(hit)} · 나감 {r5b.get('out')} → {r5.get('out')} → {r5c.get('out')} · {past.get('_err')}/{past.get('code')} {zero.get('_err')} {bad.get('_err')} · {cn1.get('ok')} {cn2.get('_err')} · {dl[-40:]}")

        # ④ 정기 작업 — 기준을 아주 크게 → 알림 하나(두 번 돌려도) · 기준 0 이면(잔액 넉넉) 풀림
        setting('acct.cash_alert', 'on', '1394'); setting('acct.cash_floor', '9999999999999', '1394')
        j1 = call('POST', '/admin/jobs', {'job': 'acct_cashflow'}, TS)
        j2 = call('POST', '/admin/jobs', {'job': 'acct_cashflow'}, TS)
        n_open = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CASH_SHORT' AND resolved_at IS NULL AND raised_at >= '{t0}'::timestamptz")
        setting('acct.cash_floor', '0', '1394')
        j3 = call('POST', '/admin/jobs', {'job': 'acct_cashflow'}, TS)
        n_left = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CASH_SHORT' AND resolved_at IS NULL")
        c4 = call('GET', '/admin/acct/cashflow?days=90', None, TP)
        ok('④ 정기 작업 — 기준 밑이면 ACCT_CASH_SHORT 하나(두 번 돌려도) · 기준 0 · 잔액 넉넉하면 풀림',
           n_open == '1' and n_left == '0' and c4.get('short') is False and not (j1.get('_err') or j2.get('_err') or j3.get('_err')),
           f"열림 {n_open} · 남음 {n_left} · short {c4.get('short')} · {j1.get('_err') or ''}{j2.get('_err') or ''}{j3.get('_err') or ''}")
    finally:
        for k, v in keep.items():
            if v: setting(k, v, '1394 되돌림')
        psql(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1394' WHERE alert_code = 'ACCT_CASH_SHORT' AND resolved_at IS NULL AND raised_at >= '{t0}'::timestamptz")
        psql(f"UPDATE acct_cash_plans SET state = 'CANCELED', cancel_note = '시험 1394 정리', canceled_at = now() WHERE memo LIKE '시험1394 %' AND state = 'ACTIVE'")
        # 시험이 넣은 잔액은 지움(쌓기만 표 — 시험에서만 replica)
        psql(f"SET session_replication_role = replica; DELETE FROM acct_cash_balances WHERE amount >= 900000000000 AND created_at >= '{t0}'::timestamptz")
        rm_role(pid, '1394')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-cash-rows]', timeout=30000)
            seen['rows'] = pg.locator('[data-acct-cash-rows]').count()
            seen['low'] = pg.locator('[data-acct-cash-lowest]').count()
            seen['plan'] = pg.locator('[data-acct-cash-plan-add]').count()
        res = admin_page('/#/acct-cash', chk)
        if res is None: print('  (playwright 없음 — ⑤ 건너뜀)')
        else:
            seen, perr = res
            ok('⑤ 화면 — 회계 › 자금 흐름 · 날마다 잔액 표 · 가장 낮은 날 한 줄 · 예정 넣기 · 화면 오류 없음',
               seen.get('rows') == 1 and seen.get('low') == 1 and seen.get('plan') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
