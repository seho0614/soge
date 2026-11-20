"""v10.474 (D265 · docs/612) 자산 실사 — 고정자산 QR 라벨(SGB-AST-번호 · 화면 QR · 새 npm 없음) · 실사 회차 · QR 읽기 · 찾음 · 없음 · 닫기 · 없어진 자산 처분 전표
  ① (코드) D265 회차 · 줄 · 가드 · 자산 코드 · 읽기 · 처분(disposeAsset) · qr.ts · 라벨 인쇄 · API · 화면 · 문서 612
  ② (API · DB) 라벨 코드 · 회차 열기 · 읽기(두 번 · 소문자) · 못 읽음 · 없는 자산 · 없음 표시 · 닫기(확인 전 422 · 없음으로) · 닫은 뒤 409 · DB 막음 · 처분(SUPER) · 처분 전표
  ③ (화면) 회계 › 매입 · 경비 › 자산 실사
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


M65 = migr('D265_')
HC = rd('src/modules/acct/hrx.controller.ts')
UI = rd('web/src/app/admin/Hrx.tsx')
AP, MN, AM, SC, WK = rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
T0 = psql("SELECT now()")
EMPS = []
HRX_KEYS = {'hrx.ot_rates': 'OT:50,NIGHT:50,HOL:50,HOL8:100', 'hrx.week_limits': 'BASE:40,OT:12,WARN:48', 'hrx.std_month_hours': '209', 'hrx.ot_over_block': 'on',
            'hrx.sat_as_holiday': 'off', 'hrx.ot_pay_basis': 'MIN', 'hrx.shift_grace_min': '10', 'hrx.book_ahead_days': '90', 'hrx.book_max_hours': '8'}


def day(n, base=None):
    b = base or kst
    return (b + datetime.timedelta(days=n)).strftime('%Y-%m-%d')


def hrx_defaults(tag):
    """hrx.* 설정을 처음 값으로(시험 동안) — 되돌릴 옛 값을 돌려줌"""
    saved = {k: getset(k) for k in HRX_KEYS}
    for k, v in HRX_KEYS.items():
        setting(k, v, tag)
    return saved


def hrx_restore(saved, tag):
    for k, v in saved.items():
        setting(k, v or HRX_KEYS[k], f'{tag} 되돌림')


def emp(tag, account_id=None, joined_days=60, base=2090000):
    j = (kst - datetime.timedelta(days=joined_days)).strftime('%Y-%m-%d')
    acc = f"'{account_id}'" if account_id else 'NULL'
    e = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, account_id) VALUES ('시험직원{tag}-{stamp}', '{j}', {base}, {acc}) RETURNING id").split('\n')[0]
    if e.isdigit():
        EMPS.append(e)
    return e


def staff(tag, role):
    em, aid = mk_staff(tag, role)
    __import__('consent_ok').agree(em, PW)
    return em, aid, login(em)


def emps_cleanup():
    """시험 직원과 그 직원에 붙은 근태 · 연장 근로 · 근무표 줄을 지움(replica)"""
    if EMPS:
        ids = ','.join(EMPS)
        psql("SET session_replication_role = replica; "
             f"DELETE FROM hrx_ot_pay_links WHERE request_id IN (SELECT id FROM hrx_ot_requests WHERE employee_id IN ({ids})); "
             f"DELETE FROM hrx_ot_requests WHERE employee_id IN ({ids}); DELETE FROM hrx_shifts WHERE employee_id IN ({ids}); "
             f"DELETE FROM acct_attendance_fixes WHERE attendance_id IN (SELECT id FROM acct_attendance WHERE employee_id IN ({ids})); "
             f"DELETE FROM acct_attendance WHERE employee_id IN ({ids}); DELETE FROM acct_leave_uses WHERE employee_id IN ({ids}); "
             f"DELETE FROM acct_payroll_lines WHERE employee_id IN ({ids}); "
             f"UPDATE acct_employees SET account_id = NULL WHERE id IN ({ids}); DELETE FROM acct_employees WHERE id IN ({ids});")


HK = rd('src/modules/acct/hrx-stocktake.ts')
QR = rd('web/src/lib/qr.ts')
ASSETS, STS = [], []


def cleanup():
    a = ','.join(ASSETS) or '0'
    s = ','.join(STS) or '0'
    psql("SET session_replication_role = replica; "
         f"DELETE FROM hrx_stocktake_lines WHERE stocktake_id IN ({s}) OR asset_id IN ({a}); DELETE FROM hrx_stocktakes WHERE id IN ({s}); "
         f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE (source IN ('ASSET_DISPOSE', 'ASSET_ACQUIRE', 'ASSET_FROM_PURCHASE') AND source_key IN (SELECT id::text FROM acct_assets WHERE id IN ({a}))) "
         f"  OR (source = 'DEPRECIATION' AND source_key IN (SELECT id::text FROM acct_depreciations WHERE asset_id IN ({a})))); "
         f"DELETE FROM acct_entries WHERE (source IN ('ASSET_DISPOSE', 'ASSET_ACQUIRE', 'ASSET_FROM_PURCHASE') AND source_key IN (SELECT id::text FROM acct_assets WHERE id IN ({a}))) "
         f"  OR (source = 'DEPRECIATION' AND source_key IN (SELECT id::text FROM acct_depreciations WHERE asset_id IN ({a}))); "
         f"DELETE FROM acct_depreciations WHERE asset_id IN ({a}); DELETE FROM acct_assets WHERE id IN ({a});")


ok('① 코드 — D265 실사 회차 · 줄 · 가드(닫으면 못 고침 · 처분 시각 한 번) · 자산 코드 SGB-AST · 읽기 · 닫기(확인 전 → 없음) · 처분(⑬ disposeAsset) · QR 그림(새 npm 없음) · 라벨 인쇄 · API · 화면 · 문서 612 · 판 v10.474',
   'CREATE TABLE IF NOT EXISTS public.hrx_stocktakes' in M65 and 'CREATE TABLE IF NOT EXISTS public.hrx_stocktake_lines' in M65 and 'HRX_STOCKTAKE_CLOSED' in M65 and 'HRX_STOCKTAKE_DISPOSE' in M65
   and "`SGB-AST-${String(id).padStart(6, '0')}`" in HK and 'export function hrxParseAssetCode' in HK and 'await disposeAsset(db' in HK
   and 'export function qrMatrix' in QR and 'export function qrSvg' in QR and 'import ' not in QR.split('*/', 1)[-1].split('export')[0]
   and "from '../../lib/qr'" in UI and 'function printLabels' in UI and "@Post('hrx/stocktakes/:id/dispose')" in HC and "@Get('hrx/asset-labels')" in HC
   and 'export function HrxStocktake' in UI and "['hrx-stocktake', '자산 실사']" in MN and '"SB-ADM-HRX-040"' in SJ and '실사' in doc('612_') and VT >= (10, 474), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ee, eid, TE = staff('1474e', 'REVIEWER')
    ae, aid, TA = staff('1474a', 'ADMIN')
    fe, fid, TF = staff('1474f', 'PAYOUT')
    try:
        acq = day(-30)
        for i, nm in enumerate(['노트북', '모니터', '의자']):
            r = call('POST', '/admin/acct/assets', {'name': f'시험{nm}1474-{stamp}', 'category': '비품', 'acquiredOn': acq, 'cost': 1200000 + i * 100000, 'residual': 0, 'lifeMonths': 60, 'method': 'STRAIGHT', 'payRole': 'NONE'}, TS)
            if r.get('id'): ASSETS.append(r['id'])
        A, Bx, Cx = (ASSETS + ['0', '0', '0'])[:3]
        lb = call('GET', f'/admin/hrx/asset-labels?ids={A},{Bx}', None, TF)
        codes = sorted(x.get('code') for x in lb.get('items', []))
        o403 = call('POST', '/admin/hrx/stocktakes', {'title': '시험 1474'}, TE)
        op = call('POST', '/admin/hrx/stocktakes', {'title': f'시험 1474 실사-{stamp}', 'asOf': today}, TA)
        if op.get('id'): STS.append(op['id'])
        sid = op.get('id')
        bad = call('POST', '/admin/hrx/stocktakes', {'title': '시험 1474 내일', 'asOf': day(1)}, TA)
        s1 = call('POST', f'/admin/hrx/stocktakes/{sid}/scan', {'code': f'SGB-AST-{int(A):06d}', 'location': '3층'}, TF)
        s2 = call('POST', f'/admin/hrx/stocktakes/{sid}/scan', {'code': f' ast-{A} '}, TF)
        s3 = call('POST', f'/admin/hrx/stocktakes/{sid}/scan', {'code': 'XYZ'}, TF)
        s4 = call('POST', f'/admin/hrx/stocktakes/{sid}/scan', {'code': 'SGB-AST-999999999999'}, TF)
        mk = call('PUT', f'/admin/hrx/stocktakes/{sid}/lines/{Bx}', {'result': 'MISSING', 'note': '시험 1474 없음'}, TA)
        mkb = call('PUT', f'/admin/hrx/stocktakes/{sid}/lines/{Bx}', {'result': 'LOST'}, TA)
        ok('② 회차 · 읽기 — 라벨 코드 SGB-AST-000… · 담당 403 · 회차 열기(자산 3개 이상) · 내일 기준일 422 · QR 읽기 찾음(둔 곳) · 두 번째 읽기(소문자 · 빈칸) again · 못 읽음 422 · 회차에 없는 자산 404 · 손으로 없음 · 틀린 결과 400',
           codes == sorted([f'SGB-AST-{int(A):06d}', f'SGB-AST-{int(Bx):06d}']) and o403.get('_err') == 403 and (op.get('assets') or 0) >= 3 and bad.get('code') == 'HRX_ST_DATE'
           and s1.get('ok') is True and s1.get('again') is False and s2.get('again') is True and s3.get('code') == 'HRX_ST_CODE' and s4.get('_err') == 404
           and mk.get('result') == 'MISSING' and mkb.get('_err') == 400,
           f"{codes} {o403.get('_err')} {op.get('assets') or op.get('code')} {bad.get('code')} {s1.get('again')} {s2.get('again')} {s3.get('code')} {s4.get('_err')} {mk.get('result') or mk.get('code')} {mkb.get('_err')}")

        cl0 = call('POST', f'/admin/hrx/stocktakes/{sid}/close', {}, TA)
        cl = call('POST', f'/admin/hrx/stocktakes/{sid}/close', {'pendingAsMissing': True}, TA)
        dt = call('GET', f'/admin/hrx/stocktakes/{sid}', None, TF)
        res_of = {x.get('assetId'): x.get('result') for x in dt.get('lines', [])}
        loc = next((x.get('location') for x in dt.get('lines', []) if x.get('assetId') == A), None)
        s5 = call('POST', f'/admin/hrx/stocktakes/{sid}/scan', {'code': A}, TF)
        m5 = call('PUT', f'/admin/hrx/stocktakes/{sid}/lines/{A}', {'result': 'MISSING'}, TA)
        g1 = psql(f"UPDATE hrx_stocktake_lines SET result = 'FOUND' WHERE stocktake_id = {int(sid or 0)} AND asset_id = {int(Cx)}")
        g2 = psql(f"DELETE FROM hrx_stocktakes WHERE id = {int(sid or 0)}")
        g3 = psql(f"UPDATE hrx_stocktake_lines SET disposed_at = now() WHERE stocktake_id = {int(sid or 0)} AND asset_id = {int(Bx)}")
        ok('③ 닫기 — 확인 전 남으면 422 · 확인 전은 없음으로 바꾸고 닫음 · 찾음 · 없음 · 둔 곳 · 닫은 뒤 읽기 · 적기 409 · DB 도 닫은 줄 못 고침 · 회차 못 지움 · 처분 전 처분 시각 못 씀',
           cl0.get('code') == 'HRX_ST_PENDING' and cl.get('ok') is True and (cl.get('madeMissing') or 0) >= 1 and res_of.get(A) == 'FOUND' and res_of.get(Bx) == 'MISSING' and res_of.get(Cx) == 'MISSING'
           and loc == '3층' and s5.get('code') == 'HRX_ST_STATE' and m5.get('code') == 'HRX_ST_STATE' and 'HRX_STOCKTAKE_CLOSED' in g1 and 'HRX_STOCKTAKE' in g2 and 'HRX_STOCKTAKE_DISPOSE' in g3,
           f"{cl0.get('code')} {cl.get('ok') or cl.get('code')} {cl.get('madeMissing')} {res_of.get(A)} {res_of.get(Bx)} {res_of.get(Cx)} {loc} {s5.get('code')} {m5.get('code')} {g1[-40:]} {g2[-40:]} {g3[-40:]}")

        d403 = call('POST', f'/admin/hrx/stocktakes/{sid}/dispose', {'assetIds': [Bx, Cx]}, TA)
        dp = call('POST', f'/admin/hrx/stocktakes/{sid}/dispose', {'assetIds': [Bx, Cx]}, TS)
        st = psql(f"SELECT string_agg(id || ':' || state || ':' || (coalesce(dispose_amount, -1))::text || ':' || coalesce((dispose_reason LIKE '%실사%')::text, ''), ',' ORDER BY id) FROM acct_assets WHERE id IN ({A}, {Bx}, {Cx})")
        dd = psql(f"SELECT count(*) FROM hrx_stocktake_lines WHERE stocktake_id = {int(sid or 0)} AND asset_id IN ({Bx}, {Cx}) AND disposed_at IS NOT NULL")
        dp2 = call('POST', f'/admin/hrx/stocktakes/{sid}/dispose', {'assetIds': [Bx, Cx]}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        je = psql(f"SELECT count(DISTINCT e.id) || '|' || (sum(l.debit) = sum(l.credit))::text || '|' || coalesce(sum(l.debit) FILTER (WHERE l.role = 'LOSS_DISPOSAL'), 0) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.source = 'ASSET_DISPOSE' AND e.source_key = '{Bx}'")
        want = [f'{A}:ACTIVE:-1:', f'{Bx}:DISPOSED:0:true', f'{Cx}:DISPOSED:0:true']
        got = (st or '').split(',')
        ok('④ 처분 — ADMIN 403 · SUPER 가 없음 자산 2개 처분(받은 돈 0 · 사유 실사) · 찾은 자산은 그대로 · 줄에 처분 시각 · 두 번째 422 · 처분 전표(차변 = 대변 · 처분 손실)',
           d403.get('_err') == 403 and dp.get('disposed') == 2 and got[1:] == want[1:] and got[0].startswith(f'{A}:ACTIVE') and dd == '2' and dp2.get('code') == 'HRX_ST_NOTHING'
           and je.split('|')[0] == '1' and je.split('|')[1] == 'true' and int(float(je.split('|')[2] or 0)) > 0,
           f"{d403.get('_err')} {dp.get('disposed') or dp.get('code')} {dp.get('failed')} {st} {dd} {dp2.get('code')} {je}")
    finally:
        cleanup(); rm_role(eid, '1474'); rm_role(aid, '1474'); rm_role(fid, '1474')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-hrx-stocktake]', timeout=30000); pg.wait_for_timeout(1000)
            seen['labels'] = pg.locator('[data-hrx-labels]').count()
            seen['new'] = pg.locator('[data-hrx-st-new]').count()
        res = admin_page('/#/hrx-stocktake', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('⑤ 화면 — 회계 › 매입 · 경비 › 자산 실사 · QR 라벨 인쇄 · 새 회차 · 화면 오류 없음', seen.get('labels') == 1 and seen.get('new') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
