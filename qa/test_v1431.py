"""v10.431 (D254 · docs/568) 거래처 휴폐업 조회 — 국세청 사업자 상태(키 없으면 간주) · 스위치 처음 off · 휴업 · 폐업 알림 · 매입 경고
  ① (코드) bizcheck.ts(resolveBizStatusProvider 재사용) · D254 칸 4 · 설정 · 정기 작업 acct_biz_check · API · 매입 경고 · 화면 · 문서
  ② (API) 꺼져 있으면 422 · 켜면 조회(간주 VALID) · 목록에 상태 · 번호 없는 거래처 422 · 폐업 거래처로 매입 넣으면 경고 · 정기 작업
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code
BC, PU, AC, UI, M54 = rd('src/modules/acct/bizcheck.ts'), rd('src/modules/acct/purchase.ts'), rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), migr('D254_')
ok('① 코드 — 국세청 공급자 재사용 · 칸 biz_status · 설정 acct.biz_status_check off · 정기 작업 · API biz-check · 매입 경고 · 화면 · 문서 568 · 판 v10.431',
   'resolveBizStatusProvider' in BC and 'ADD COLUMN IF NOT EXISTS biz_status' in M54 and "('acct.biz_status_check', 'off'" in M54 and "('acct_biz_check'" in M54
   and "@Post('parties/:id/biz-check')" in AC and 'supplierWarning' in PU and 'data-acct-party-bizcheck=' in UI and '휴폐업' in doc('568_') and VT >= (10, 431), VER)

if API and DB:
    import consent_ok, random
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9); d0 = kst.strftime('%Y-%m-%d')
    stamp = random.randint(100000000, 999999999)
    s0 = getset('acct.biz_status_check')
    pt = call('POST', '/admin/acct/parties', {'kind': 'SUPPLIER', 'name': f'시험1431 상사 {stamp}', 'bizNo': f'7{stamp}'}, TS)
    pn = call('POST', '/admin/acct/parties', {'kind': 'SUPPLIER', 'name': f'시험1431 번호없음 {stamp}'}, TS)
    pid = str(pt.get('id') or '')
    try:
        setting('acct.biz_status_check', 'off', '1431')
        off = call('POST', f'/admin/acct/parties/{pid}/biz-check', None, TS)
        setting('acct.biz_status_check', 'on', '1431')
        on = call('POST', f'/admin/acct/parties/{pid}/biz-check', None, TS)
        nob = call('POST', f"/admin/acct/parties/{pn.get('id')}/biz-check", None, TS)
        lst = call('GET', f'/admin/acct/parties?q=7{stamp}', None, TS)
        row = next((x for x in lst.get('items') or [] if x.get('id') == pid), {})
        psql(f"UPDATE acct_parties SET biz_status = 'CLOSED', biz_stub = false, biz_checked_at = now() WHERE id = {int(pid or 0)}")
        pu = call('POST', '/admin/acct/purchases', {'kind': 'TAX_INVOICE', 'issuedOn': d0, 'supplierName': '시험1431', 'supplierBizNo': f'7{stamp}', 'item': '시험 1431',
                                                     'supply': 1000 + stamp % 91, 'vat': 100, 'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP', 'force': True}, TS)
        job = call('POST', '/admin/jobs', {'job': 'acct_biz_check'}, TS)
        ok('② 휴폐업 — 꺼짐 422 · 켜면 조회(키 없으면 간주 VALID) · 목록에 상태 · 번호 없음 422 · 폐업 거래처 매입은 경고(막지 않음) · 정기 작업',
           off.get('code') == 'BIZ_CHECK_OFF' and on.get('ok') is True and on.get('status') in ('VALID', 'UNKNOWN', 'CLOSED', 'SUSPENDED')
           and row.get('bizStatus') == on.get('status') and nob.get('code') == 'ACCT_PARTY_BIZNO' and pu.get('ok') is True and '폐업' in (pu.get('warn') or '')
           and job.get('_err') is None,
           f"{off.get('code')} {on.get('ok')} {on.get('status')} {on.get('stub')} · {row.get('bizStatus')} · {nob.get('code')} · {pu.get('ok')} {pu.get('warn')} · {job.get('_err')}")
    finally:
        setting('acct.biz_status_check', s0 or 'off', '1431')
        psql(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1431' WHERE alert_code = 'ACCT_PARTY_CLOSED' AND resolved_at IS NULL AND detail->>'partyId' = '{pid}'")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
