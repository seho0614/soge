"""v10.406 (D248 · docs/543) 퇴직금 추계 · 연차 대장
  ① (코드) D248 계정 · 추계 기록 · 연차 표 · 설정 · API · 화면 · 문서
  ② (API · DB) 퇴직금 — 추계액 셈 · 1년 미만 뺌 · 지급 담당 403 · 차이만 전표 · 두 번 409 · 이번 달 422 (⑭ 직원 표가 있을 때)
  ③ (API · DB) 연차 — 생긴 날 SUPER · 쓴 날 · 음수 사유 · 남은 날 · 쌓기만
  ④ (화면) 회계 › 퇴직금 · 연차
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
def mig(prefix):
    fs = sorted(glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(fs[0], encoding='utf-8').read() if fs else ''


M48 = mig('D248')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
SV = rd('src/modules/acct/severance.ts')
ok('① 코드 — D248 계정(퇴직급여충당부채 · 퇴직급여) · 추계 기록(쌓기만 · 달마다 한 번) · 연차 생긴 날 · 쓴 날(쌓기만) · 설정 acct.leave_* · API 5 · 감사 · 화면 · 메뉴 · 명세 · 문서 543 · 판 v10.406',
   "('SEVERANCE_RES'" in M48 and "('EXP_SEVERANCE'" in M48 and 'CREATE TABLE IF NOT EXISTS public.acct_severance_runs' in M48 and 'ym           text NOT NULL UNIQUE' in M48
   and 'CREATE TABLE IF NOT EXISTS public.acct_leave_grants' in M48 and 'CREATE TABLE IF NOT EXISTS public.acct_leave_uses' in M48 and "'acct.leave_base_days'" in M48
   and "@Get('severance')" in AC and "@Post('severance/run')" in AC and "@Get('leave')" in AC and "@Post('leave/grant')" in AC and "@Post('leave/use')" in AC
   and "@Audit('ACCT_SEVERANCE_RUN', 'SETTING')" in AC and "'SEVERANCE_ACCRUE'" in SV
   and 'export function AcctSeverance' in UI and "{tab === 'acct-severance' && <AcctSeverance />}" in AP and "['acct-severance', '퇴직금 · 연차']" in MN
   and '"SB-ADM-ACC-210"' in SJ and '퇴직금' in doc('543_') and VT >= (10, 406), VER)


def month_end(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    nx = datetime.date(y + (m == 12), m % 12 + 1, 1)
    return nx - datetime.timedelta(days=1)


def ym_add(ym, k):
    y, m = int(ym[:4]), int(ym[5:7]) - 1 + k
    return f'{y + m // 12}-{m % 12 + 1:02d}'


if API and DB and psql("SELECT to_regclass('public.acct_employees') IS NOT NULL") != 't':
    print('  (⑭ 직원 표 acct_employees 없음 — ② ③ 건너뜀)')
elif API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1406', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    # 지난 해의 아무 달(추계 기록이 없는 달) — 회사 장부 · 실제 달과 겹치지 않게 · 끝에 지움
    ym = next(c for c in (f'{2012 + (stamp + i) % 8}-{(stamp // 8 + i) % 12 + 1:02d}' for i in range(96))
              if psql(f"SELECT count(*) FROM acct_severance_runs WHERE ym = '{c}'") == '0' and psql(f"SELECT count(*) FROM acct_closings WHERE ym = '{c}'") == '0')
    end = month_end(ym)
    e1 = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base) VALUES ('시험1406가{stamp}', '2010-01-01', 3000000) RETURNING id").splitlines()[0]
    e2 = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base) VALUES ('시험1406나{stamp}', '{ym_add(ym, -2)}-10', 2400000) RETURNING id").splitlines()[0]
    yr = int(kst.strftime('%Y'))
    try:
        g = call('GET', f'/admin/acct/severance?ym={ym}', None, TP)
        r1 = next((r for r in g.get('rows') or [] if r.get('employeeId') == e1), {})
        r2 = next((r for r in g.get('rows') or [] if r.get('employeeId') == e2), {})
        sd = (end - datetime.date(2010, 1, 1)).days + 1
        cal3 = (end - datetime.date.fromisoformat(f'{ym_add(ym, -2)}-01')).days + 1
        want1 = int(3000000 * 3 / cal3 * 30 * sd / 365 + 0.5)   # JS Math.round 과 같게(반올림)
        bad = call('GET', '/admin/acct/severance?ym=2026-13', None, TP)
        byp = call('POST', '/admin/acct/severance/run', {'ym': ym}, TP)
        run = call('POST', '/admin/acct/severance/run', {'ym': ym}, TS)
        run2 = call('POST', '/admin/acct/severance/run', {'ym': ym}, TS)
        now = call('POST', '/admin/acct/severance/run', {'ym': kst.strftime('%Y-%m')}, TS)
        amt = abs(int(run.get('diff') or 0))
        ln = psql(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.role) FROM acct_lines l WHERE l.entry_id = {run.get('entryId') or 0}") if run.get('entryId') else ''
        want_ln = (','.join(sorted([f'EXP_SEVERANCE:{amt}:0', f'SEVERANCE_RES:0:{amt}'])) if int(run.get('diff') or 0) > 0 else ','.join(sorted([f'EXP_SEVERANCE:0:{amt}', f'SEVERANCE_RES:{amt}:0']))) if amt else ''
        ok('② 퇴직금 — 1년 이상 직원 추계액 = 1일 평균임금 × 30 × 재직일 ÷ 365(월 기본급 기준) · 1년 미만은 합계 뺌 · 틀린 달 422 · 지급 담당 실행 403 · SUPER 실행 = 차이만 전표 · 두 번 409 · 이번 달 422',
           r1.get('estimate') == want1 and r1.get('eligible') is True and r2.get('eligible') is False and r1.get('basis') == 'BASE'
           and bad.get('code') == 'ACCT_SEVERANCE' and byp.get('_err') == 403 and run.get('ok') is True and ln == want_ln
           and run2.get('code') == 'ACCT_SEVERANCE_DONE' and now.get('code') == 'ACCT_SEVERANCE',
           f"{ym} · 가 {r1.get('estimate')} (기대 {want1}) {r1.get('eligible')} {r1.get('basis')} · 나 {r2.get('eligible')} · {bad.get('code')} · {byp.get('_err')} · 차이 {run.get('diff')} 전표 {run.get('entryId')} {ln} · {run2.get('code')} · {now.get('code')}")

        gp = call('POST', '/admin/acct/leave/grant', {'employeeId': e1, 'year': yr, 'days': 15, 'note': '시험 1406'}, TP)
        gs = call('POST', '/admin/acct/leave/grant', {'employeeId': e1, 'year': yr, 'days': 15, 'note': '시험 1406 연차'}, TS)
        nf = call('POST', '/admin/acct/leave/grant', {'employeeId': '999999999', 'year': yr, 'days': 1, 'note': '시험 1406 없음'}, TS)
        u1 = call('POST', '/admin/acct/leave/use', {'employeeId': e1, 'usedOn': kst.strftime('%Y-%m-%d'), 'days': 1.5, 'note': '시험'}, TP)
        u0 = call('POST', '/admin/acct/leave/use', {'employeeId': e1, 'usedOn': kst.strftime('%Y-%m-%d'), 'days': -0.5}, TP)
        u2 = call('POST', '/admin/acct/leave/use', {'employeeId': e1, 'usedOn': kst.strftime('%Y-%m-%d'), 'days': -0.5, 'note': '반차 취소'}, TP)
        lb = call('GET', f'/admin/acct/leave?year={yr}', None, TP)
        row = next((r for r in lb.get('rows') or [] if r.get('employeeId') == e1), {})
        x1 = psql(f"UPDATE acct_leave_uses SET days = 9 WHERE employee_id = {e1}")
        ok('③ 연차 — 지급 담당 생긴 날 403 · SUPER 넣음 · 없는 직원 404 · 쓴 날 1.5 · 음수 사유 없으면 422 · 취소 0.5 · 남은 날 14 · 제안(15 이상) · 고치기 DB 가 막음',
           gp.get('_err') == 403 and gs.get('ok') is True and nf.get('_err') == 404 and u1.get('ok') is True and u0.get('code') == 'ACCT_LEAVE' and u2.get('ok') is True
           and row.get('granted') == 15 and row.get('used') == 1 and row.get('remaining') == 14 and (row.get('suggest') or 0) >= 15 and 'append-only' in x1,
           f"{gp.get('_err')} · {gs.get('ok')} · {nf.get('_err')} · {u1.get('ok')} {u0.get('code')} {u2.get('ok')} · {row} · {x1[-40:]}")
    finally:
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source = 'SEVERANCE_ACCRUE' AND source_key = '{ym}'); "
             f"DELETE FROM acct_severance_runs WHERE ym = '{ym}'; "
             f"DELETE FROM acct_entries WHERE source = 'SEVERANCE_ACCRUE' AND source_key = '{ym}'; "
             f"DELETE FROM acct_leave_grants WHERE employee_id IN ({e1}, {e2}); DELETE FROM acct_leave_uses WHERE employee_id IN ({e1}, {e2}); "
             f"DELETE FROM acct_employees WHERE id IN ({e1}, {e2})")
        rm_role(pid, '1406')
if API and DB and ADMIN_WEB:
    def chk(pg, seen):
        pg.wait_for_selector('[data-acct-severance]', timeout=30000)
        seen['sev'] = pg.locator('[data-acct-severance]').count()
        seen['sum'] = pg.locator('[data-acct-severance-sum]').count()
        seen['leave'] = pg.locator('[data-acct-leave]').count()
    res = admin_page('/#/acct-severance', chk)
    if res is None: print('  (playwright 없음 — ④ 건너뜀)')
    else:
        seen, perr = res
        ok('④ 화면 — 회계 › 퇴직금 · 연차 · 추계 합계 줄 · 연차 표 · 화면 오류 없음',
           seen.get('sev') == 1 and seen.get('sum') == 1 and seen.get('leave') == 1 and not perr, f"{seen} {perr[:2]}")
if not (API and DB):
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
