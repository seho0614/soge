"""v10.399 (D246 · docs/536) 예산 대비 실적
  ① (코드) D246 예산 표 · 가드 · 바꾼 기록(쌓기만) · 설정 · 정기 작업 · API 2 · 화면 · 메뉴 · 명세 · 문서 536
  ② (API) 예산 넣기 · 실적 · 차이 · 넘음 → 운영 알림 ACCT_BUDGET_OVER · 예산 올리면 풀림 · 지난달 옮기기 · 0 이면 지움
  ③ (API · DB) 자산 계정 422 · 사유 없음 422 · 지급 담당 넣기 403 · 바꾼 기록 지우기 DB 가 막음
  ④ (화면) 회계 › 예산
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
BG = rd('src/modules/acct/budget.ts')
ok('① 코드 — D246 acct_budgets · 가드 · acct_budget_changes(쌓기만) · acct.budget_alert · 정기 작업 acct_budget · API 2 · 화면 · 메뉴 · 명세 · 문서 536 · 판 v10.399',
   'CREATE TABLE IF NOT EXISTS public.acct_budgets' in M46 and 'acct_budget_changes' in M46 and "'acct.budget_alert'" in M46 and "'acct_budget'" in M46
   and 'export async function budgetJob' in BG and 'export async function budgetLine' in BG and "ACCT_BUDGET_OVER" in BG
   and "@Get('budget')" in AC and "@Put('budget')" in AC and "@Audit('ACCT_BUDGET_SET', 'SETTING')" in AC
   and 'export function AcctBudget' in UI and "{tab === 'acct-budget' && <AcctBudget />}" in AP and "['acct-budget', '예산']" in MN
   and '"SB-ADM-ACC-140"' in SJ and '예산' in doc('536_') and VT >= (10, 399), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1399', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    y, m = 2001 + stamp % 9, 1 + (stamp // 9) % 11          # 다른 돌림 · 운영 달과 겹치지 않는 옛 달(끝에 알림 · 전표 정리)
    ym, ym2 = f'{y}-{m:02d}', f'{y}-{m + 1:02d}'
    key = f'{ym}:EXP_ETC'
    amt = 7000 + stamp % 900
    eid = ''
    try:
        eid = psql(f"WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{ym}-15', 'TEST', 't1399-{stamp}', '시험 1399 잡비') RETURNING id), "
                   f"l AS (INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'EXP_ETC', {amt}, 0 FROM e UNION ALL SELECT id, 'CASH', 0, {amt} FROM e) SELECT id FROM e")
        s1 = call('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': amt - 1000}, {'role': 'REV_SUB', 'amount': 500000}], 'reason': '시험 1399 예산'}, TS)
        v1 = call('GET', f'/admin/acct/budget?ym={ym}', None, TP)
        r1 = next((x for x in v1.get('items') or [] if x.get('role') == 'EXP_ETC'), {})
        al1 = psql(f"SELECT count(*) FILTER (WHERE resolved_at IS NULL) FROM ops_alerts WHERE alert_code = 'ACCT_BUDGET_OVER' AND detail->>'key' = '{key}'")
        s2 = call('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': amt + 1000}], 'reason': '시험 1399 올림'}, TS)
        al2 = psql(f"SELECT count(*) FILTER (WHERE resolved_at IS NULL) || '|' || count(*) FROM ops_alerts WHERE alert_code = 'ACCT_BUDGET_OVER' AND detail->>'key' = '{key}'")
        cp = call('PUT', '/admin/acct/budget', {'ym': ym2, 'copyFrom': ym, 'items': [], 'reason': '시험 1399 옮김'}, TS)
        v2 = call('GET', f'/admin/acct/budget?ym={ym2}', None, TP)
        r2 = next((x for x in v2.get('items') or [] if x.get('role') == 'EXP_ETC'), {})
        z = call('PUT', '/admin/acct/budget', {'ym': ym2, 'items': [{'role': 'EXP_ETC', 'amount': 0}, {'role': 'REV_SUB', 'amount': 0}], 'reason': '시험 1399 지움'}, TS)
        left = psql(f"SELECT count(*) FROM acct_budgets WHERE ym = '{ym2}'")
        ok('② 예산 — 넣기 · 실적 · 넘음 · 쓴 비율 · 운영 알림 · 올리면 풀림 · 지난달 옮기기 · 0 이면 지움',
           s1.get('changed') == 2 and r1.get('actual') == amt and r1.get('budget') == amt - 1000 and r1.get('over') is True and r1.get('diff') == -1000
           and al1 == '1' and s2.get('changed') == 1 and al2 == '0|1' and cp.get('changed') == 2 and r2.get('budget') == amt + 1000 and z.get('changed') == 2 and left == '0',
           f"{s1.get('changed')} · {r1} · 알림 {al1} → {al2} · 옮김 {cp.get('changed')} {r2.get('budget')} · 지움 {z.get('changed')} 남음 {left}")
        b1 = call('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'CASH', 'amount': 1000}], 'reason': '시험 1399 자산'}, TS)
        b2 = call('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': 1000}], 'reason': ' '}, TS)
        b3 = call('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': 1000}], 'reason': '시험 1399 지급 담당'}, TP)
        b4 = call('PUT', '/admin/acct/budget', {'ym': ym, 'items': [], 'reason': '시험 1399 빈 것'}, TS)
        dl = psql(f"DELETE FROM acct_budget_changes WHERE ym = '{ym}'")
        dbg = psql(f"INSERT INTO acct_budgets (ym, role, amount) VALUES ('{ym}', 'CASH', 1)")
        ok('③ 검사 — 자산 계정 422 · 사유 없음 422 · 지급 담당 403 · 빈 예산 422 · 바꾼 기록 지우기 · 자산 계정 예산 DB 가 막음',
           b1.get('code') == 'ACCT_BUDGET' and b2.get('code') == 'ACCT_REASON' and b3.get('_err') == 403 and b4.get('code') == 'ACCT_BUDGET' and '!' in dl and '!' in dbg,
           f"{b1.get('code')} {b2.get('code')} {b3.get('_err')} {b4.get('code')} · {dl[-30:]} · {dbg[-40:]}")
    finally:
        call('PUT', '/admin/acct/budget', {'ym': ym, 'items': [{'role': 'EXP_ETC', 'amount': 0}, {'role': 'REV_SUB', 'amount': 0}], 'reason': '시험 1399 정리'}, TS)
        replica(f"DELETE FROM ops_alerts WHERE alert_code = 'ACCT_BUDGET_OVER' AND detail->>'key' LIKE '{ym}:%'")
        if eid.isdigit():
            replica(f"DELETE FROM acct_lines WHERE entry_id = {eid}; DELETE FROM acct_entries WHERE id = {eid}")
        rm_role(pid, '1399')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-budget]', timeout=30000)
            seen['rows'] = pg.locator('[data-acct-budget-row]').count()
            seen['save'] = pg.locator('[data-acct-budget-save]').count()
        res = admin_page('/#/acct-budget', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 예산 · 계정 줄 · 저장 단추(SUPER) · 화면 오류 없음', seen.get('rows', 0) >= 1 and seen.get('save') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')
tail()
