"""v10.398 (D246 · docs/535) 고정자산 대장 · 감가상각
  ① (코드) D246 고정자산 · 상각 표 · 가드 · 정기 작업 · 전표 4가지 · API 5 · 화면 · 메뉴 · 명세 · 문서 535
  ② (API) 직접 넣기(정액 12달 · 시작 전 달 경고) · 상각 계획 합 = 취득가 − 잔존 · 정률 계획 마지막 달 잔존 · 틀린 값 422 · 지급 담당 넣기 403
  ③ (API · DB) 상각 한 줄 → 전표(감가상각비 / 누계액) · 상각 뒤 취득가 고치기 · 지우기 DB 가 막음 · 처분 → 처분 전표(차대 맞음) · 두 번 처분 422
  ④ (API) ⑫ 매입에서 넘기기 — 취득가 = 공급가 · 두 번 422 · 「자산으로 넘기기」 전표
  ⑤ (화면) 회계 › 고정자산
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
AS = rd('src/modules/acct/assets.ts')
ok('① 코드 — D246 acct_assets · acct_depreciations(쌓기만) · 가드 · 정기 작업 acct_depreciation · 전표 4 · API 5 · 화면 · 메뉴 · 명세 · 문서 535 · 판 v10.398',
   'CREATE TABLE IF NOT EXISTS public.acct_assets' in M46 and 'CREATE TABLE IF NOT EXISTS public.acct_depreciations' in M46 and "'acct_depreciation'" in M46 and 'ACCT_ASSET_DISPOSED' in M46
   and 'export const ASSET_SOURCES' in AS and "name: 'DEPRECIATION'" in AS and "name: 'ASSET_DISPOSE'" in AS and 'ASSET_SOURCES' in SRC
   and "@Post('assets')" in AC and "@Post('assets/:id/dispose')" in AC and "@Post('assets/depreciate')" in AC
   and 'export function AcctAssets' in UI and "{tab === 'acct-assets' && <AcctAssets />}" in AP and "['acct-assets', '고정자산']" in MN
   and '"SB-ADM-ACC-130"' in SJ and '감가상각' in doc('535_') and VT >= (10, 398), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1398', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0, ym = kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m')
    stamp = int(time.time()) % 1000000
    start = (getset('acct.start_on') or '2026-11-01')[:7]
    try:
        a1 = call('POST', '/admin/acct/assets', {'name': f'시험노트북1398-{stamp}', 'acquiredOn': '2026-01-15', 'cost': 1200000, 'residual': 0, 'lifeMonths': 12, 'method': 'STRAIGHT', 'payRole': 'NONE'}, TS)
        aid = str(a1.get('id') or '')
        det = call('GET', f'/admin/acct/assets/{aid}', None, TP)
        plan = det.get('plan') or []
        lst = call('GET', '/admin/acct/assets', None, TP)
        it = next((x for x in lst.get('items') or [] if x.get('id') == aid), {})
        a2 = call('POST', '/admin/acct/assets', {'name': f'시험서버1398-{stamp}', 'acquiredOn': d0, 'cost': 5000000, 'residual': 250000, 'lifeMonths': 60, 'method': 'DECLINING', 'payRole': 'AP'}, TS)
        p2 = call('GET', f"/admin/acct/assets/{a2.get('id')}", None, TP).get('plan') or []
        bad = call('POST', '/admin/acct/assets', {'name': '시험', 'acquiredOn': d0, 'cost': 1000, 'residual': 1000, 'lifeMonths': 12, 'method': 'STRAIGHT', 'payRole': 'AP'}, TS)
        bad2 = call('POST', '/admin/acct/assets', {'name': '시험', 'acquiredOn': d0, 'cost': 1000, 'lifeMonths': 0, 'method': 'STRAIGHT'}, TS)
        byp = call('POST', '/admin/acct/assets', {'name': '시험', 'acquiredOn': d0, 'cost': 1000, 'lifeMonths': 12, 'method': 'STRAIGHT'}, TP)
        ok('② 넣기 · 계획 — 정액 12달 × 100,000 · 합 = 취득가 · 시작 전 달 경고 · 정률 마지막 장부가 = 잔존 · 잔존 ≥ 취득가 422 · 연수 0 은 400 · 지급 담당 403',
           bool(aid) and len(plan) == 12 and all(p.get('amount') == 100000 for p in plan) and sum(p.get('amount', 0) for p in plan) == 1200000
           and (it.get('gapBeforeStart') or 0) > 0 and p2 and p2[-1].get('bookAfter') == 250000 and sum(p.get('amount', 0) for p in p2) == 4750000
           and bad.get('code') == 'ACCT_ASSET' and bad2.get('_err') == 400 and byp.get('_err') == 403,
           f"{aid} · {len(plan)} {plan[:1]} · gap {it.get('gapBeforeStart')} · 정률 {len(p2)} {p2[-1:] } · {bad.get('code')} {bad2.get('_err')} {byp.get('_err')}")

        # 상각 한 줄(이번 달 · 정기 작업은 끝난 달만이라 시험이 직접) → 전표
        psql(f"INSERT INTO acct_depreciations (asset_id, ym, amount, book_after) VALUES ({aid or 0}, '{ym}', 100000, 1100000) ON CONFLICT DO NOTHING")
        dj = call('POST', '/admin/acct/assets/depreciate', None, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        did = psql(f"SELECT id FROM acct_depreciations WHERE asset_id = {aid or 0} AND ym = '{ym}'")
        dep = psql(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.debit DESC) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'DEPRECIATION' AND e.source_key = '{did}'")
        upd = psql(f"UPDATE acct_assets SET cost = cost + 1 WHERE id = {aid or 0}")
        dlt = psql(f"DELETE FROM acct_assets WHERE id = {aid or 0}")
        dd = psql(f"DELETE FROM acct_depreciations WHERE id = {did or 0}")
        ds = call('POST', f'/admin/acct/assets/{aid}/dispose', {'disposedOn': d0, 'amount': 50000, 'reason': '시험 1398 매각'}, TS)
        ds2 = call('POST', f'/admin/acct/assets/{aid}/dispose', {'disposedOn': d0, 'amount': 0, 'reason': '시험 1398 두 번'}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        dsp = psql(f"SELECT coalesce(sum(l.debit), 0) || '|' || coalesce(sum(l.credit), 0) || '|' || coalesce(string_agg(l.role, ',' ORDER BY l.id), '') FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'ASSET_DISPOSE' AND e.source_key = '{aid}'")
        acc_now = ds.get('accumulated') or 0
        ok('③ 상각 · 처분 — 상각 전표 감가상각비 / 누계액 · 지금 상각 응답 · 상각 뒤 취득가 고치기 · 자산 · 상각 지우기 DB 가 막음 · 처분(손실) · 처분 전표 차대 같음 · 두 번 처분 422',
           dep == 'EXP_DEPR:100000:0,ACC_DEPR:0:100000' and 'made' in dj and '!' in upd and '!' in dlt and '!' in dd
           and ds.get('ok') is True and ds.get('gain') == 50000 + acc_now - 1200000 and ds2.get('code') == 'ACCT_ASSET_DISPOSED'
           and dsp.split('|')[0] == dsp.split('|')[1] == '1200000',
           f"{dep} · {dj} · {upd[-30:]} · {dlt[-30:]} · {dd[-30:]} · {ds.get('gain')} {acc_now} · {ds2.get('code')} · {dsp}")

        # ⑫ 매입에서 넘기기
        item = f'시험모니터1398-{stamp}'
        pr = call('POST', '/admin/acct/purchases', {'kind': 'TAX_INVOICE', 'issuedOn': d0, 'supplierName': '(주)시험전산', 'supplierBizNo': f'{1000000000 + stamp:010d}'[:10],
                                                    'item': item, 'supply': 300000 + stamp % 1000, 'vat': (300000 + stamp % 1000) // 10, 'deductible': True,
                                                    'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP', 'force': True}, TS)
        prid = psql(f"SELECT id FROM acct_purchases WHERE item = '{item}'")
        call('POST', '/admin/acct/journal/run', None, TS)
        f1 = call('POST', '/admin/acct/assets', {'purchaseId': prid, 'lifeMonths': 60, 'method': 'STRAIGHT'}, TS)
        f2 = call('POST', '/admin/acct/assets', {'purchaseId': prid, 'lifeMonths': 60, 'method': 'STRAIGHT'}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        fa = psql(f"SELECT cost || '|' || pay_role || '|' || coalesce(from_role, '') FROM acct_assets WHERE id = {f1.get('id') or 0}")
        fe = psql(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.debit DESC) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = 'ASSET_FROM_PURCHASE' AND e.source_key = '{f1.get('id')}'")
        sup = 300000 + stamp % 1000
        ok('④ 매입에서 — 취득가 = 공급가 · PURCHASE · 원래 계정 소모품비 · 두 번 422 · 전표 비품 / 소모품비',
           bool(prid) and f1.get('ok') is True and fa == f'{sup}|PURCHASE|EXP_SUPPLIES' and f2.get('code') == 'ACCT_ASSET_DUP' and fe == f'FIXED_ASSET:{sup}:0,EXP_SUPPLIES:0:{sup}',
           f"{pr.get('_err') or pr.get('code') or ''} {prid} · {f1.get('ok') or f1.get('code')} · {fa} · {f2.get('code')} · {fe}")
    finally:
        rm_role(pid, '1398')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-assets]', timeout=30000)
            seen['rows'] = pg.locator('[data-acct-asset]').count()
            seen['add'] = pg.locator('[data-acct-asset-add]').count()
        res = admin_page('/#/acct-assets', chk)
        if res is None: print('  (playwright 없음 — ⑤ 건너뜀)')
        else:
            seen, perr = res
            ok('⑤ 화면 — 회계 › 고정자산 · 대장 줄 · 넣기 상자 · 화면 오류 없음', seen.get('rows', 0) >= 1 and seen.get('add') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ ⑤ 건너뜀)')
tail()
