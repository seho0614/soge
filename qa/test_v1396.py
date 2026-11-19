"""v10.396 (D246 · docs/533) 시산표 · 손익계산서 · 재무상태표 · 기초 잔액
  ① (코드) D246 자본 종류 · 기초 잔액 표 · 가드 · trialBalance · API · 화면 · 메뉴 · 명세 · 문서 533
  ② (API) 시산표 차대 맞음 · 손익계산서 · 재무상태표 모양 · 지급 담당 보기 · 회원 403
  ③ (API · DB) 기초 잔액 — 판 만들기 · 같은 기준일 422 · 줄 저장 · 안 맞으면 확정 422 · 맞으면 확정 · 확정 뒤 줄 넣기 · 고치기 DB 가 막음 · 시산표 기초에 반영
  ④ (화면) 회계 › 재무제표
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
def m46():
    ps = sorted(glob.glob(os.path.join(K, 'prisma/migrations/D246_*/migration.sql')))
    return open(ps[0], encoding='utf-8').read() if ps else ''


M46 = m46()
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')


def replica(sql):
    """가드 트리거를 건너뛰고 시험 데이터만 지움(시험 끝 정리)"""
    return psql(f"BEGIN; SET LOCAL session_replication_role = replica; {sql}; COMMIT;")


def tail():
    n_ok = sum(1 for r in RES if r[0])
    print(f"\n결과: {n_ok} / {len(RES)}")
    sys.exit(0 if n_ok == len(RES) else 1)
ST = rd('src/modules/acct/statements.ts')
ok('① 코드 — D246 EQUITY 종류 · 기초 잔액 판 · 가드 · trialBalance · API 7 · 감사 · 화면 · 메뉴 · 명세 · 문서 533 · 판 v10.396',
   "'EQUITY'" in M46 and 'acct_accounts_kind_check' in M46 and 'CREATE TABLE IF NOT EXISTS public.acct_opening_sets' in M46 and 'ACCT_OPENING_UNBALANCED' in M46
   and "('EQUITY_CAPITAL'" in M46 and 'export async function trialBalance' in ST and 'export async function balanceSheet' in ST
   and "@Get('statements/trial')" in AC and "@Get('statements/balance')" in AC and "@Post('opening/:id/fix')" in AC and "@Audit('ACCT_OPENING_FIX', 'SETTING')" in AC
   and 'export function AcctStatements' in UI and "{tab === 'acct-statements' && <AcctStatements />}" in AP and "['acct-statements', '재무제표']" in MN
   and '"SB-ADM-ACC-110"' in SJ and '재무상태표' in doc('533_') and VT >= (10, 396), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1396', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    as_of = (datetime.date(1990, 1, 1) + datetime.timedelta(days=stamp % 3000)).isoformat()   # 다른 판과 겹치지 않는 옛 날짜 · 끝에 지움
    sid = ''
    try:
        tb = call('GET', f'/admin/acct/statements/trial?from={d0[:4]}-01-01&to={d0}', None, TP)
        inc = call('GET', f'/admin/acct/statements/income?from={d0[:4]}-01-01&to={d0}', None, TP)
        bs = call('GET', f'/admin/acct/statements/balance?asOf={d0}', None, TP)
        bad = call('GET', '/admin/acct/statements/trial?from=2026-13-01&to=2026-11-30', None, TP)
        mem = call('GET', f'/admin/acct/statements/balance?asOf={d0}', None, TB)
        ok('② 보기 — 시산표 차변 = 대변 · 손익 합계 = 매출 − 비용 · 재무상태표 합계 칸 · 틀린 날짜 422 · 회원 403',
           tb.get('balanced') is True and isinstance(tb.get('rows'), list) and (inc.get('total') or {}).get('profit') == (inc.get('total') or {}).get('revenue', 0) - (inc.get('total') or {}).get('expense', 0)
           and 'assets' in (bs.get('total') or {}) and 'unclosedProfit' in bs and bad.get('code') == 'ACCT_DATE' and mem.get('_err') == 403,
           f"{tb.get('balanced')} {len(tb.get('rows') or [])} · {inc.get('total')} · {bs.get('total')} {bs.get('balanced')} · {bad.get('code')} · {mem.get('_err')}")

        mk = call('POST', '/admin/acct/opening', {'asOf': as_of, 'note': '시험 1396'}, TS)
        sid = str(mk.get('id') or '')
        dup = call('POST', '/admin/acct/opening', {'asOf': as_of}, TS)
        byp = call('POST', '/admin/acct/opening', {'asOf': as_of}, TP)
        amt = 100000 + stamp % 9000
        l1 = call('PUT', f'/admin/acct/opening/{sid}/lines', {'lines': [{'role': 'CASH', 'debit': amt}, {'role': 'EQUITY_CAPITAL', 'credit': amt - 1}]}, TS)
        f0 = call('POST', f'/admin/acct/opening/{sid}/fix', {'reason': '시험 1396 안 맞음'}, TS)
        l2 = call('PUT', f'/admin/acct/opening/{sid}/lines', {'lines': [{'role': 'CASH', 'debit': amt, 'memo': '시험 통장'}, {'role': 'EQUITY_CAPITAL', 'credit': amt}]}, TS)
        bl = call('PUT', f'/admin/acct/opening/{sid}/lines', {'lines': [{'role': 'CASH', 'debit': 5, 'credit': 5}]}, TS)
        f1 = call('POST', f'/admin/acct/opening/{sid}/fix', {'reason': '시험 1396 확정'}, TS)
        l3 = call('PUT', f'/admin/acct/opening/{sid}/lines', {'lines': [{'role': 'CASH', 'debit': 1}, {'role': 'EQUITY_CAPITAL', 'credit': 1}]}, TS)
        upd = psql(f"UPDATE acct_opening SET debit = debit + 1 WHERE set_id = {sid or 0} AND role = 'CASH'")
        ins = psql(f"INSERT INTO acct_opening (set_id, role, debit) VALUES ({sid or 0}, 'CASH', 1)")
        t2 = call('GET', f'/admin/acct/statements/trial?from={as_of}&to={as_of}', None, TS)
        cash = next((r for r in t2.get('rows') or [] if r.get('role') == 'CASH'), {})
        cap = next((r for r in t2.get('rows') or [] if r.get('role') == 'EQUITY_CAPITAL'), {})
        ok('③ 기초 잔액 — 판 만들기 · 같은 기준일 422 · 지급 담당 403 · 안 맞으면 확정 422 · 저장 · 줄 차대 둘 다 422 · 확정 · 확정 뒤 줄 422 · 고치기 · 넣기 DB 가 막음 · 시산표 기초에 반영',
           bool(sid) and dup.get('code') == 'ACCT_OPENING_DUP' and byp.get('_err') == 403 and l1.get('balanced') is False and f0.get('code') == 'ACCT_OPENING_UNBALANCED'
           and l2.get('balanced') is True and bl.get('code') == 'ACCT_OPENING' and f1.get('ok') is True and l3.get('code') == 'ACCT_OPENING_FIXED'
           and '!' in upd and '!' in ins and cash.get('opening') == amt and cap.get('opening') == amt and (t2.get('openingSet') or {}).get('id') == sid,
           f"{sid} · {dup.get('code')} · {byp.get('_err')} · {l1.get('balanced')} {f0.get('code')} · {l2.get('balanced')} {bl.get('code')} · {f1.get('ok') or f1.get('code')} · {l3.get('code')} · {upd[-40:]} · {ins[-40:]} · {cash.get('opening')} {cap.get('opening')} {t2.get('openingSet')}")
    finally:
        if sid:
            replica(f"DELETE FROM acct_opening WHERE set_id = {sid}; DELETE FROM acct_opening_sets WHERE id = {sid}")
        rm_role(pid, '1396')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-statements]', timeout=30000)
            seen['bs'] = pg.locator('[data-acct-bs]').count()
            pg.click('[data-acct-stmt-tab=tb]'); pg.wait_for_selector('[data-acct-tb]', timeout=30000)
            seen['tb'] = pg.locator('[data-acct-tb]').count()
            pg.click('[data-acct-stmt-tab=op]'); pg.wait_for_selector('[data-acct-opening]', timeout=30000)
            seen['op'] = pg.locator('[data-acct-opening]').count()
        res = admin_page('/#/acct-statements', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 재무제표 · 재무상태표 · 시산표 · 기초 잔액 · 화면 오류 없음', seen.get('bs') == 1 and seen.get('tb') == 1 and seen.get('op') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')
tail()
