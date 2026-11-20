"""v10.475 (D266 · docs/613) 업무용 차량 운행기록부 — 차량 · 운행(출퇴근 · 업무 · 비업무 · 계기판) · 비용 · 해마다 업무 사용 비율 · 손금 인정(일반 원칙 · 세무사 확인)
  ① (코드) D266 acct_vehicles · 운행 · 비용 · 가드 · 설정 2 · vehicleYear · AcctOpsController · 메뉴 · 화면 FIN2-010 · 문서 613
  ② (API · DB) 회원 403 · 번호 400 · 겹침 409 · 운행 4(끊김 안내) · 계기판 422 · 비용 · 해 셈(파이썬과 같음) · 취소 · 보험 없음 · 번호 고치기 409 · DB 막음 · 권한 주소 8
  ③ (화면) 회계 › 업무용 차량
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


M66 = migr('D266_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
AM, MN, AP, SCH, WK = rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
OC, UI = rd('src/modules/acct/acct-ops.controller.ts'), rd('web/src/app/admin/AcctOps.tsx')

VH = rd('src/modules/acct/vehicles.ts')
ok('① 코드 — D266 acct_vehicles(번호 CHECK = 서버 PLATE_RE) · 운행(거리 계산 칸 · 계기판 CHECK · 취소만) · 비용(같은 매입 한 번) · 가드 3 · 설정 2(1,500만 · 800만 · 일반 원칙) · vehicleYear(기록부 · 없음 · 보험 없음 · 대상 아님) · AcctOpsController 8 · 메뉴 acct-vehicle · 화면 FIN2-010 · 문서 613 · 판 v10.475',
   'CREATE TABLE IF NOT EXISTS public.acct_vehicles' in M66 and "CHECK (plate ~ '^([가-힣]{2})?[0-9]{2,3}[가-힣][0-9]{4}$')" in M66
   and "PLATE_RE = /^([가-힣]{2})?[0-9]{2,3}[가-힣][0-9]{4}$/" in VH and 'distance     integer GENERATED ALWAYS AS (odo_end - odo_start) STORED' in M66
   and 'uq_acct_vcosts_purchase' in M66 and 'trg_acct_vehicle_guard' in M66 and 'trg_acct_vehicle_trip_guard' in M66 and 'trg_acct_vehicle_cost_guard' in M66
   and "('acct.vehicle_nolog_limit', '15000000'" in M66 and "('acct.vehicle_dep_limit', '8000000'" in M66
   and 'export function vehicleYear' in VH and "'NO_INSURANCE'" in VH and "'EXCLUDED'" in VH and "'NO_LOG'" in VH
   and "@Post('acct/vehicles/:id/trips')" in OC and "@Post('acct/vehicles/:id/costs/:costId/cancel')" in OC and 'AcctOpsController' in AM
   and "['acct-vehicle', '업무용 차량']" in MN and "{tab === 'acct-vehicle' && <AcctVehicles />}" in AP and 'export function AcctVehicles' in UI
   and '"SB-ADM-FIN2-010"' in SJ and '운행기록부' in doc('613_') and VT >= (10, 475), VER)


def year_calc(cost, dep, total, biz, months, nolog, deplim, insured=True, excluded=False):
    """vehicles.ts vehicleYear 와 같은 셈(파이썬)"""
    if excluded:
        return cost, 0
    if not insured:
        return 0, cost
    ratio = min(1, biz / total) if total > 0 else (1 if cost <= 0 else min(1, round(nolog * months / 12) / cost))
    biz_cost = round(cost * ratio); dep_biz = round(dep * ratio); over = max(0, dep_biz - round(deplim * months / 12))
    return biz_cost - over, cost - (biz_cost - over)


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    year = today[:4]
    plate = f"{10 + stamp % 90}바{stamp % 10000:04d}"
    vid = ''
    try:
        psql(f"SET session_replication_role = replica; DELETE FROM acct_vehicle_costs WHERE vehicle_id IN (SELECT id FROM acct_vehicles WHERE plate = '{plate}'); "
             f"DELETE FROM acct_vehicle_trips WHERE vehicle_id IN (SELECT id FROM acct_vehicles WHERE plate = '{plate}'); DELETE FROM acct_vehicles WHERE plate = '{plate}';")
        mb = call('GET', '/admin/acct/vehicles', None, TB)
        badp = call('POST', '/admin/acct/vehicles', {'plate': '12-3456', 'name': '시험 1475', 'acquiredOn': f'{year}-01-01'}, TS)
        c = call('POST', '/admin/acct/vehicles', {'plate': plate, 'name': f'시험 1475 차-{stamp}', 'acquiredOn': f'{year}-01-01', 'bizInsurance': True}, TS); vid = str(c.get('id') or '')
        dup = call('POST', '/admin/acct/vehicles', {'plate': plate, 'name': '시험 1475 겹침', 'acquiredOn': f'{year}-01-01'}, TS)
        base = {'tripOn': today, 'driver': '시험 1475', 'dept': '영업'}
        t1 = call('POST', f'/admin/acct/vehicles/{vid}/trips', {**base, 'purpose': 'BUSINESS', 'odoStart': 1000, 'odoEnd': 1100}, TS)
        t2 = call('POST', f'/admin/acct/vehicles/{vid}/trips', {**base, 'purpose': 'PERSONAL', 'odoStart': 1100, 'odoEnd': 1200}, TS)
        t3 = call('POST', f'/admin/acct/vehicles/{vid}/trips', {**base, 'purpose': 'COMMUTE', 'odoStart': 1200, 'odoEnd': 1250}, TS)
        t4 = call('POST', f'/admin/acct/vehicles/{vid}/trips', {**base, 'purpose': 'BUSINESS', 'odoStart': 1300, 'odoEnd': 1350}, TS)
        bado = call('POST', f'/admin/acct/vehicles/{vid}/trips', {**base, 'purpose': 'BUSINESS', 'odoStart': 1400, 'odoEnd': 1400}, TS)
        c1 = call('POST', f'/admin/acct/vehicles/{vid}/costs', {'costOn': today, 'kind': 'FUEL', 'amount': 1000000, 'liters': 500}, TS)
        c2 = call('POST', f'/admin/acct/vehicles/{vid}/costs', {'costOn': today, 'kind': 'DEPRECIATION', 'amount': 15000000}, TS)
        nolog, deplim = int(getset('acct.vehicle_nolog_limit') or 15000000), int(getset('acct.vehicle_dep_limit') or 8000000)
        det = call('GET', f'/admin/acct/vehicles/{vid}?year={year}', None, TS)
        cl = det.get('calc') or {}
        exp1 = year_calc(16000000, 15000000, 300, 200, 12, nolog, deplim)
        cx = call('POST', f"/admin/acct/vehicles/{vid}/trips/{t2.get('id')}/cancel", {'reason': '시험 1475 비업무 취소'}, TS)
        cx2 = call('POST', f"/admin/acct/vehicles/{vid}/trips/{t2.get('id')}/cancel", {'reason': '시험 1475 두 번'}, TS)
        det2 = call('GET', f'/admin/acct/vehicles/{vid}?year={year}', None, TS)
        exp2 = year_calc(16000000, 15000000, 200, 200, 12, nolog, deplim)
        ins = call('PUT', f'/admin/acct/vehicles/{vid}', {'bizInsurance': False}, TS)
        det3 = call('GET', f'/admin/acct/vehicles/{vid}?year={year}', None, TS)
        pfix = call('PUT', f'/admin/acct/vehicles/{vid}', {'plate': '99바9999'}, TS)
        empty = call('PUT', f'/admin/acct/vehicles/{vid}', {}, TS)
        keep = psql(f"SELECT name || '|' || car_class || '|' || ownership FROM acct_vehicles WHERE id = {int(vid or 0)}")
        dbu = psql(f"UPDATE acct_vehicle_trips SET odo_end = odo_end + 1 WHERE id = {int(t1.get('id') or 0)}")
        dbd = psql(f"DELETE FROM acct_vehicles WHERE id = {int(vid or 0)}")
        lst = call('GET', f'/admin/acct/vehicles?year={year}', None, TS)
        mine = next((x for x in lst.get('items') or [] if x.get('id') == vid), {})
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'acct-vehicle'")
        ok('② 업무용 차량 — 회원 403 · 번호 400 · 넣기 · 겹침 409 · 운행 4(계기판 끊김 안내 1) · 계기판 422 · 비용 2 · 해 셈(거리 비율 · 감가상각 한도 이월 = 파이썬 셈) · 운행기록부 줄 4 · 취소 → 비율 100% · 두 번 409 · 보험 없음 → 모두 불인정 · 번호 고치기 409 · 빈 고치기 422(다른 칸 그대로) · DB 고치기 · 지우기 막음 · 목록 · 권한 주소 8',
           mb.get('_err') == 403 and badp.get('_err') == 400 and c.get('ok') is True and dup.get('_err') == 409
           and t1.get('distance') == 100 and t3.get('gap') is None and (t4.get('gap') or {}).get('prevEnd') == 1250 and bado.get('_err') == 422 and bado.get('code') == 'VEH_ODO'
           and c1.get('ok') is True and c2.get('ok') is True and det.get('totalKm') == 300 and det.get('bizKm') == 200 and len(det.get('gaps') or []) == 1 and len(det.get('log') or []) == 4
           and cl.get('rule') == 'LOG' and (cl.get('allowed'), cl.get('disallowed')) == exp1 and cl.get('depOver', 0) > 0
           and cx.get('ok') is True and cx2.get('_err') == 409 and (det2.get('calc') or {}).get('ratio') == 1 and ((det2.get('calc') or {}).get('allowed'), (det2.get('calc') or {}).get('disallowed')) == exp2
           and ins.get('ok') is True and (det3.get('calc') or {}).get('rule') == 'NO_INSURANCE' and (det3.get('calc') or {}).get('disallowed') == 16000000
           and pfix.get('_err') == 409 and empty.get('code') == 'VEH_EMPTY' and keep.startswith(f'시험 1475 차-{stamp}|PASSENGER|OWNED')
           and 'ACCT_VEHICLE_LINE' in dbu and 'ACCT_VEHICLE' in dbd and mine.get('cost') == 16000000 and rmap == '8',
           f"{mb.get('_err')} {badp.get('_err')} {c.get('ok') or c} {dup.get('_err')} · {t1.get('distance')} {t3.get('gap')} {t4.get('gap')} {bado.get('code')} · {det.get('totalKm')} {det.get('bizKm')} {len(det.get('gaps') or [])} {len(det.get('log') or [])} · "
           f"{cl.get('rule')} {(cl.get('allowed'), cl.get('disallowed'))} 기대 {exp1} · {cx.get('ok')} {cx2.get('_err')} {(det2.get('calc') or {}).get('ratio')} 기대 {exp2} · {(det3.get('calc') or {}).get('rule')} · {pfix.get('_err')} {empty.get('code')} {keep} · {dbu[-30:]} {dbd[-30:]} · {mine.get('cost')} {rmap}")
    finally:
        if vid.isdigit():
            psql(f"SET session_replication_role = replica; DELETE FROM acct_vehicle_costs WHERE vehicle_id = {vid}; DELETE FROM acct_vehicle_trips WHERE vehicle_id = {vid}; DELETE FROM acct_vehicles WHERE id = {vid};")
    if ADMIN_WEB:
        r = admin_page('/#/acct-vehicle', lambda pg, seen: seen.update(n=pg.locator('[data-veh]').count(), new=pg.locator('[data-veh-new]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회계 › 업무용 차량(목록 · 차량 넣기 단추 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('new') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
