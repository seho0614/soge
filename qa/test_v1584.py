"""v10.584 (docs/726) 회계 마감 체크리스트 — 저절로 셈(월 결산 요약 · 매입 · 경비 · 급여 · 감가상각 · 미수금) + 사람 확인 · 예외 확인 · 남은 일 알림
  ① (코드) SQL 항목 · 확인 줄 · 설정 · 권한 시드 · 재사용 함수 · API 4 · 정기 작업 hra_daily · 화면 · 메뉴 · 화면 목록 · 문서 726 · 판
  ② (DB · API) 보기(지난 시험 달 2001-02) · 권한 · 확인 · 예외 확인(사유) · 풀기 · 마감한 달 409 · 항목 더하기 · 끄기 · DB 지킴
  ③ (화면) 회계 › 장부 › 마감 체크리스트
  (두 번 돌아도 통과 — 2001-02 · 03 확인 줄 · 「t1584_」 항목 · 시험 마감 줄은 replica 로 지움)
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


def mig_has(word):
    """13차 SQL 은 메인이 D292 ~ 에 붙임(번호 모름) — 글자가 든 마이그레이션 하나를 찾아 돌려줌"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


def biz_days(n, year):
    """오늘 뒤 그 해 안 영업일 n개(없으면 짧은 목록)"""
    r = psql(f"SELECT string_agg(d::date::text, ',' ORDER BY d) FROM (SELECT d FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date + 1, '{year}-12-31'::date, interval '1 day') d WHERE fn_is_business_day(d::date) ORDER BY d LIMIT {n}) x")
    return [x for x in (r or '').split(',') if re.match(r'^\d{4}-\d{2}-\d{2}$', x)]

"""시험 몸통"""
M = mig_has('CREATE TABLE IF NOT EXISTS public.hra_close_items')
CL = rd('src/modules/acct/hra-close.ts')
HC = rd('src/modules/acct/hra.controller.ts')
SC = rd('src/worker/scheduler.service.ts')
WC = rd('src/worker/worker.controller.ts')
UI = rd('web/src/app/admin/Hra.tsx')
MN = rd('web/src/lib/adminMenu.ts')
AP = rd('web/src/App.tsx')
ok('① 코드 — SQL 항목(자동 8 · 사람 2 시드 · 지우기 막음) · 확인 줄(쌓기만) · 설정 처음 off · 권한 시드(지급 담당 · 세무사 읽기) · 월 결산 요약 재사용 · API 4(/admin/acct 아래) · 정기 작업 hra_daily · 화면 · 메뉴(월 결산 뒤) · 화면 목록 HRA-040 · 문서 726 · 판 v10.584',
   "('payroll',      '급여 확정',                        'AUTO'" in M and "('cash_count'," in M and 'trg_hra_close_items_keep' in M and 'trg_hra_close_marks_ro' in M
   and "('hra.close_alert', 'off'" in M and "'R_ACCOUNTANT', 'acct-close-check', 'VIEW'" in M and 'monthSummary(db, ym)' in CL and 'depreciationPlan(a)' in CL and 'agingLine(db)' in CL
   and "'HRA_CLOSE_TODO'" in CL and 'export async function hraDailyJob' in CL
   and "@Get('acct/close-check')" in HC and "@Post('acct/close-check/marks')" in HC and "@Post('acct/close-check/items')" in HC and "@Put('acct/close-check/items/:key')" in HC
   and "'hra_daily'" in SC and "'hra_daily'," in WC and 'export function AcctCloseCheck' in UI and "['acct-close-check', '마감 체크리스트']" in MN and "'acct-month', ['acct-close-check']" in MN
   and "'acct-close-check': ['SUPER', 'PAYOUT']" in AP and '"SB-ADM-HRA-040"' in SJ and '체크리스트' in doc('726_') and VT >= (10, 584), VER)

STAMP = int(time.time()) % 1000000
YM, YM2 = '2001-02', '2001-03'
KEY = f't1584_{STAMP}'
CLEAN = ("SET session_replication_role = replica; "
         f"DELETE FROM hra_close_marks WHERE ym IN ('{YM}', '{YM2}'); "
         "DELETE FROM hra_close_marks WHERE item_key LIKE 't1584\\_%'; DELETE FROM hra_close_items WHERE key LIKE 't1584\\_%'; "
         f"DELETE FROM acct_closings WHERE ym = '{YM2}' AND note = '시험 1584';")
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    psql(CLEAN)
    pe, pid = mk_staff(f'1584p{STAMP % 97}', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    ae, aid = mk_staff(f'1584a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    try:
        c0 = call('GET', f'/admin/acct/close-check?ym={YM}', None, TS)
        st = lambda v, k: next((x.get('status') for x in v.get('rows') or [] if x.get('key') == k), None)
        keys = [x.get('key') for x in c0.get('rows') or []]
        a403 = call('GET', f'/admin/acct/close-check?ym={YM}', None, TA)
        ok('② 보기 — 항목 10(자동 8 · 사람 2) · 통장 없음 남음 · 세금계산서 끝 · 급여(그 달 직원 없음) 끝 · 감가상각(시작 달 전) 끝 · 사람 확인 남음 · 마감 안 함 · ADMIN 403',
           all(k in keys for k in ('journal', 'bank', 'invoices', 'purchase', 'expense', 'payroll', 'depreciation', 'receivable', 'cash_count', 'accountant'))
           and st(c0, 'bank') == 'TODO' and st(c0, 'invoices') == 'OK' and st(c0, 'payroll') == 'OK' and st(c0, 'depreciation') == 'OK' and st(c0, 'cash_count') == 'TODO'
           and c0.get('closed') is False and c0.get('ready') is False and c0.get('errors') == [] and a403.get('_err') == 403,
           f"{keys} {[(k, st(c0, k)) for k in ('bank', 'invoices', 'payroll', 'depreciation', 'cash_count')]} {c0.get('errors')} {a403.get('_err')}")
        m1 = call('POST', '/admin/acct/close-check/marks', {'ym': YM, 'key': 'cash_count', 'note': '시재 맞음'}, TP)
        m2 = call('POST', '/admin/acct/close-check/marks', {'ym': YM, 'key': 'bank'}, TP)
        m3 = call('POST', '/admin/acct/close-check/marks', {'ym': YM, 'key': 'bank', 'note': '그 달 통장 거래 없음'}, TP)
        m4 = call('POST', '/admin/acct/close-check/marks', {'ym': YM, 'key': 'nope_x'}, TP)
        c1 = call('GET', f'/admin/acct/close-check?ym={YM}', None, TP)
        m5 = call('POST', '/admin/acct/close-check/marks', {'ym': YM, 'key': 'cash_count', 'done': False}, TP)
        c2 = call('GET', f'/admin/acct/close-check?ym={YM}', None, TP)
        ok('② 확인 — 사람 확인 끝 · 자동 항목 사유 없으면 422 · 사유와 함께 예외 확인 · 없는 항목 404 · 풀면 다시 남음 · 남은 수 줄어듦',
           m1.get('ok') is True and m2.get('code') == 'HRA_CLOSE_REASON' and m3.get('ok') is True and m4.get('_err') == 404
           and st(c1, 'cash_count') == 'OK' and st(c1, 'bank') == 'OVERRIDE' and int((c1.get('count') or {}).get('left') or 0) < int((c0.get('count') or {}).get('left') or 0)
           and m5.get('ok') is True and st(c2, 'cash_count') == 'TODO',
           f"{m1.get('ok') or m1} {m2.get('code')} {m3.get('ok')} {m4.get('_err')} {st(c1, 'cash_count')} {st(c1, 'bank')} {c1.get('count')} {st(c2, 'cash_count')}")
        cl = psql(f"INSERT INTO acct_closings (ym, entries, debit_sum, note) VALUES ('{YM2}', 0, 0, '시험 1584') ON CONFLICT DO NOTHING")
        m6 = call('POST', '/admin/acct/close-check/marks', {'ym': YM2, 'key': 'cash_count'}, TP)
        c3 = call('GET', f'/admin/acct/close-check?ym={YM2}', None, TP)
        i1 = call('POST', '/admin/acct/close-check/items', {'key': KEY, 'label': '시험 1584 항목'}, TS)
        i2 = call('POST', '/admin/acct/close-check/items', {'key': KEY, 'label': '시험 1584 항목'}, TS)
        i3 = call('POST', '/admin/acct/close-check/items', {'key': KEY + 'p', 'label': '시험 1584 지급'}, TP)
        c4 = call('GET', f'/admin/acct/close-check?ym={YM}', None, TS)
        u1 = call('PUT', f'/admin/acct/close-check/items/{KEY}', {'active': False}, TS)
        c5 = call('GET', f'/admin/acct/close-check?ym={YM}', None, TS)
        ok('② 마감한 달 · 항목 — 마감한 달 확인 409 · 마감 표시 · SUPER 항목 더하기 · 같은 열쇠 409 · 지급 담당 403 · 새 항목 남음 · 끄면 빠짐',
           '!' not in cl and m6.get('_err') == 409 and c3.get('closed') is True and i1.get('ok') is True and i2.get('_err') == 409 and i3.get('_err') == 403
           and st(c4, KEY) == 'TODO' and u1.get('ok') is True and st(c5, KEY) is None,
           f"{cl[-40:]} {m6.get('_err')} {c3.get('closed')} {i1.get('ok') or i1} {i2.get('_err')} {i3.get('_err')} {st(c4, KEY)} {st(c5, KEY)}")
        dm = psql(f"DELETE FROM hra_close_marks WHERE ym = '{YM}'")
        di = psql(f"DELETE FROM hra_close_items WHERE key = '{KEY}'")
        uk = psql(f"UPDATE hra_close_items SET kind = 'AUTO' WHERE key = '{KEY}'")
        ok('② DB — 확인 줄 지우기 · 항목 지우기 · 종류 바꾸기 막음', '!' in dm and 'HRA_CLOSE' in di and 'HRA_CLOSE' in uk, f"{dm[-40:]} {di[-40:]} {uk[-40:]}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-acct-close-check]', timeout=30000)
                pg.fill('input[type=month]', YM); pg.wait_for_timeout(2500)
                seen['rows'] = pg.locator('[data-acct-close-row]').count()
                seen['bank'] = pg.locator('[data-acct-close-row="bank"]').get_attribute('data-acct-close-status') if pg.locator('[data-acct-close-row="bank"]').count() else None
            res = admin_page('/#/acct-close-check', chk)
            if res is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res
                ok('③ 화면 — 마감 체크리스트 항목 10 이상 · 통장 예외 확인 표시 · 화면 오류 없음', int(seen.get('rows') or 0) >= 10 and seen.get('bank') == 'OVERRIDE' and not perr, f"{seen} {perr[:2]}")
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        psql(CLEAN)
        for a_, t_ in ((pid, '1584p'), (aid, '1584a')):
            rm_role(a_, t_)
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
