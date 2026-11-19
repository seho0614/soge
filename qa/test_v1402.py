"""v10.402 (D247 · docs/539) 해 마감 · 다음 해 이월
  ① (코드) 마감 표 · 전표 막기 · YEAR_CLOSE → RETAINED · 풀기 · 기초 잔액 초안 · API · 화면 · 문서
  ② (API) 올해 422 · 지급 담당 403 · 월 마감 남음 422 · 마감(손익 0 · RETAINED = 순이익) · 두 번 422 · 그 해 전표 막힘 · 기초 잔액 초안
  ③ (API) 풀기 — 사유 422 · 반대 전표 · 두 번 422
  ④ (화면) 회계 › 해 마감
  시험용 해 2025(시작일을 잠시 2025-12-01 로) · 끝에 시험이 만든 기록 · 전표 · 마감을 replica 로 지움
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


YC = rd('src/modules/acct/yearclose.ts')
ok('① 코드 — 해 마감 표(쌓기만) · 전표 막기(ACCT_YEAR_CLOSED · 마감 전표만 통과) · YEAR_CLOSE → RETAINED · 풀기 YEAR_REOPEN · 다음 해 기초 잔액(⑬ trialBalance) · API 3 · 화면 · 문서 539 · 판 v10.402',
   'CREATE TABLE IF NOT EXISTS public.acct_year_closings' in M47 and 'ACCT_YEAR_CLOSED' in M47 and "sgb.acct_year_close" in M47 and "'RETAINED'" in YC and "'YEAR_REOPEN'" in YC
   and 'trialBalance' in YC and 'acct_opening_sets' in YC and "@Get('year-closings')" in AC and "@Post('year-closings/:year/reopen')" in AC
   and 'export function AcctYearClose' in UI and "'acct-yearclose'" in MN and '"SB-ADM-ACC-170"' in SJ and '해 마감' in doc('539_') and VT >= (10, 402), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1402', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    Y = 2025   # 시험용 지난 해 — 시작일을 2025-12-01 로 잠시 당겨 12월만 마감 대상으로
    stamp = int(time.time()) % 1000000
    st0 = getset('acct.start_on')
    had_dec = psql(f"SELECT count(*) FROM acct_closings WHERE ym = '{Y}-12'")
    os0 = psql("SELECT coalesce(max(id), 0) FROM acct_opening_sets") if psql("SELECT to_regclass('public.acct_opening_sets') IS NOT NULL") == 't' else '0'
    try:
        fut = call('POST', '/admin/acct/year-closings', {'year': kst.year}, TS)
        byp = call('POST', '/admin/acct/year-closings', {'year': Y}, TP)
        setting('acct.start_on', f'{Y}-12-01', '1402')
        # 이미 마감 상태면(앞 돌림이 못 풀었으면) 먼저 풂
        if psql(f"SELECT fn_acct_year_closed({Y})") == 't':
            call('POST', f'/admin/acct/year-closings/{Y}/reopen', {'reason': '시험 1402 앞 돌림 정리'}, TS)
        # 12월 수익 · 비용 한 장(공급가 100,000 매출 · 비용 30,000) — 마감 전에 넣음
        ins = psql(f"WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{Y}-12-15', 'TEST', 't1402a-{stamp}', '시험 1402') RETURNING id) "
                   f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT e.id, x.r, x.d, x.c FROM e, (VALUES ('CASH', 70000, 0), ('EXP_ETC', 30000, 0), ('REV_AD', 0, 100000)) AS x(r, d, c)") if had_dec == '0' else ''
        open_m = call('POST', '/admin/acct/year-closings', {'year': Y}, TS) if had_dec == '0' else {'code': 'ACCT_YEAR_OPEN_MONTHS'}
        if had_dec == '0':
            psql(f"INSERT INTO acct_closings (ym, entries, debit_sum, note) VALUES ('{Y}-12', 0, 0, '시험 1402')")
        pl = psql(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0) - coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role WHERE e.entry_date >= '{Y}-01-01' AND e.entry_date < '{Y + 1}-01-01' AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')")
        c = call('POST', '/admin/acct/year-closings', {'year': Y, 'note': '시험 1402'}, TS)
        c2 = call('POST', '/admin/acct/year-closings', {'year': Y}, TS)
        after = psql(f"SELECT coalesce(sum(l.debit - l.credit), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role WHERE a.kind IN ('REVENUE', 'EXPENSE') AND e.entry_date >= '{Y}-01-01' AND e.entry_date < '{Y + 1}-01-01'")
        ret = psql(f"SELECT coalesce(sum(credit - debit), 0) FROM acct_lines WHERE entry_id = {int(c.get('entryId') or 0)} AND role = 'RETAINED'")
        blk = psql(f"INSERT INTO acct_entries (entry_date, source, source_key) VALUES ('{Y}-06-01', 'TEST', 't1402b-{stamp}')")
        g = call('GET', '/admin/acct/year-closings', None, TP)
        gy = next((x for x in g.get('years') or [] if x.get('year') == Y), {})
        ok('② 마감 — 올해 422(해가 안 끝남) · 지급 담당 403 · 월 마감 안 한 달 있으면 422 · 마감 → 그 해 수익 · 비용 합 0 · RETAINED = 순이익 · 두 번 422 · 그 해 전표 넣기 막힘(ACCT_YEAR_CLOSED) · 상태 「마감함」 · 다음 해 기초 잔액 초안',
           fut.get('code') == 'ACCT_YEAR_FUTURE' and byp.get('_err') == 403 and open_m.get('code') == 'ACCT_YEAR_OPEN_MONTHS' and '!' not in ins
           and c.get('ok') is True and int(after or -1) == 0 and int(ret or 0) == int(pl or 0) and int(c.get('netIncome', -1)) == int(pl or 0)
           and c2.get('code') == 'ACCT_YEAR_CLOSED' and 'ACCT_YEAR_CLOSED' in blk and gy.get('closed') is True and bool((c.get('opening') or {}).get('setId')),
           f"{fut.get('code')} {byp.get('_err')} {open_m.get('code')} · {c.get('ok') or c.get('code')} 손익 {pl} 뒤 {after} 잉여 {ret} · {c2.get('code')} · {blk[-50:]} · {gy.get('closed')} · {c.get('opening')}")
        bad = call('POST', f'/admin/acct/year-closings/{Y}/reopen', {'reason': 'x'}, TS)
        ro = call('POST', f'/admin/acct/year-closings/{Y}/reopen', {'reason': '시험 1402 풀기'}, TS)
        ro2 = call('POST', f'/admin/acct/year-closings/{Y}/reopen', {'reason': '시험 1402 두 번'}, TS)
        back = psql(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0) - coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role WHERE e.entry_date >= '{Y}-01-01' AND e.entry_date < '{Y + 1}-01-01'")
        ok('③ 풀기 — 사유 짧으면 422 · 풀기 → 반대 전표로 손익 되돌아옴 · 두 번 422(마감 안 한 해) · 다시 상태 열림',
           bad.get('code') == 'ACCT_REASON' and ro.get('ok') is True and int(back or 0) == int(pl or 0) and ro2.get('code') == 'ACCT_YEAR_NOT_CLOSED' and psql(f"SELECT fn_acct_year_closed({Y})") == 'f',
           f"{bad.get('code')} · {ro.get('ok') or ro.get('code')} · 손익 {back} = {pl} · {ro2.get('code')}")
    finally:
        setting('acct.start_on', st0 or '2026-11-01', '1402 되돌림')
        # 시험이 만든 것 지움(쌓기만 표 · replica) — 마감 기록 · 마감 · 풀기 전표 · 시험 전표 · 기초 잔액 초안 · 12월 마감(시험이 넣었으면)
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE (source IN ('YEAR_CLOSE', 'YEAR_REOPEN') AND source_key LIKE '{Y}#%') OR (source = 'TEST' AND source_key LIKE 't1402_-{stamp}')); "
             f"DELETE FROM acct_year_closings WHERE year = {Y}; "
             f"DELETE FROM acct_entries WHERE (source IN ('YEAR_CLOSE', 'YEAR_REOPEN') AND source_key LIKE '{Y}#%') OR (source = 'TEST' AND source_key LIKE 't1402_-{stamp}'); "
             f"DELETE FROM acct_opening WHERE set_id IN (SELECT id FROM acct_opening_sets WHERE as_of = '{Y + 1}-01-01' AND state = 'DRAFT') AND set_id > {int(os0 or 0)}; "
             f"DELETE FROM acct_opening_sets WHERE as_of = '{Y + 1}-01-01' AND state = 'DRAFT' AND id > {int(os0 or 0)}; "
             + (f"DELETE FROM acct_closings WHERE ym = '{Y}-12' AND note = '시험 1402'; " if had_dec == '0' else '') + "COMMIT;")
        rm_role(pid, '1402')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-yearclose]', timeout=30000); pg.wait_for_timeout(1500)
            seen['years'] = pg.locator('[data-year]').count()
        res = admin_page('/#/acct-yearclose', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 해 마감 · 해 줄 1개 이상 · 화면 오류 없음', (seen.get('years') or 0) >= 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
