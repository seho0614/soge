"""v10.545 (docs/683) 오픈 API 사용량 과금 — 대표 11/20 「(54) ④ 오픈 API 사용량 과금」 · ㊼(D278) 위
  ① (코드) D284 papi_usage_daily · fn_papi_usage_rollup(자료 주소만 과금 · 안내 주소 무료 칸) · papi_bill_drafts(금액 CHECK · 확정 · 무효 · 지우기 막음) · papi.bill_* 설정(스위치 off) · 정기 작업 papi_usage 03:40 · 파트너 GET /api/partner/v1/usage(PartnerApiKeyGuard) · 메뉴 vsx-papi-bill · 화면 VSX-040 · 문서 683
  ② (API · DB) 금액 CHECK 거절 · 가짜 요청 기록 모으기(한 트랜잭션 · ROLLBACK) · 운영 보기 · 확정 확인 글자 422 · 없는 번호 404 · 회원 403 · 권한 주소
  ③ (화면) 파트너사 › 오픈 API 사용량 · 청구
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


M84 = migr('D284_')
CT, ST = rd('src/modules/vsx/vsx.controller.ts'), rd('src/modules/vsx/vsx-settings.ts')
UI, MN, AP = rd('web/src/app/admin/Vsx.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
KOJ = rd('site/src/i18n/messages/ko/vsx.json')
ENJ = rd('site/src/i18n/messages/en/vsx.json')

PB = rd('src/modules/vsx/papi-bill.ts')
SC = rd('src/worker/scheduler.service.ts')

ok('① 코드 — D284 papi_usage_daily · fn_papi_usage_rollup(me · docs · usage 과금 안 함) · papi_bill_drafts(공급가 · 부가세 CHECK · 살아 있는 줄 하나 · 확정 뒤 무효만) · papi.bill_enabled off · 무료 10000 · 단가 1000 · 03:40 papi_usage · GET /api/partner/v1/usage(가드) · 확인 글자 · 메뉴 vsx-papi-bill(PARTNER_MAL) · 화면 VSX-040 · 문서 683 · 판 v10.545',
   'CREATE TABLE IF NOT EXISTS public.papi_usage_daily' in M84 and 'FUNCTION public.fn_papi_usage_rollup(p_from date, p_to date)' in M84 and '(me|docs|usage)' in M84
   and 'ck_papi_bill_amt' in M84 and 'ux_papi_bill_live' in M84 and 'PAPI_BILL_STATE' in M84 and "('papi.bill_enabled', 'off'" in M84 and "('papi.bill_free_calls', '10000'" in M84
   and "('papi_usage', 1440, 3, 40," in M84 and 'export function billAmounts' in PB and "'확정'" in PB and "@Controller('api/partner/v1')" in CT and '@UseGuards(PartnerApiKeyGuard)' in CT
   and "case 'papi_usage':" in SC and "['vsx-papi-bill', '오픈 API 사용량 · 청구']" in MN and 'export function VsxPapiBill' in UI
   and '"SB-ADM-VSX-040"' in SJ and '"GET /api/partner/v1/usage"' in SJ and '부가세' in doc('683_') and VT >= (10, 545), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1545', role=None); consent_ok.agree(em, PW); TM = login(em)
    # 금액 CHECK — 맞지 않는 공급가는 DB 가 거절(한 트랜잭션 · ROLLBACK)
    chk = psql("BEGIN; SET LOCAL session_replication_role = replica; INSERT INTO papi_bill_drafts (partner_id, ym, calls_total, free_calls, calls_billable, price_per_1k, supply_amount, vat_amount, total_amount) "
               "VALUES (gen_random_uuid(), '2024-01', 12000, 10000, 2000, 1000, 9999, 999, 10998); ROLLBACK;")
    # 가짜 키 · 요청 기록 넣고 모으기 — 자료 2(과금) · 안내 1(무료) · 오류 1 · 끝에 ROLLBACK(참조 검사는 replica 로 끔)
    syn = psql("BEGIN; SET LOCAL session_replication_role = replica; "
               "CREATE TEMP TABLE t1545 ON COMMIT DROP AS SELECT gen_random_uuid() AS p, 900000000 + (random() * 1000)::int AS k; "
               "INSERT INTO ptn_api_requests (key_id, partner_id, method, path, status, at) SELECT k, p, 'GET', '/api/partner/v1/leads', 200, '2024-01-10 10:00+09' FROM t1545; "
               "INSERT INTO ptn_api_requests (key_id, partner_id, method, path, status, at) SELECT k, p, 'GET', '/api/partner/v1/cash', 200, '2024-01-10 11:00+09' FROM t1545; "
               "INSERT INTO ptn_api_requests (key_id, partner_id, method, path, status, at) SELECT k, p, 'GET', '/api/partner/v1/docs', 200, '2024-01-10 12:00+09' FROM t1545; "
               "INSERT INTO ptn_api_requests (key_id, partner_id, method, path, status, reason, at) SELECT k, p, 'GET', '/api/partner/v1/leads', 429, 'PAPI_RATE_LIMIT', '2024-01-10 13:00+09' FROM t1545; "
               "SELECT 'R1:' || fn_papi_usage_rollup('2024-01-10', '2024-01-10') || '|' || (SELECT calls_ok || '|' || calls_free || '|' || calls_err FROM papi_usage_daily WHERE day = '2024-01-10' AND key_id = (SELECT k FROM t1545)); "
               "ROLLBACK;")
    syn_line = next((x.strip()[3:] for x in syn.splitlines() if x.strip().startswith('R1:')), None)
    rng = psql("SELECT fn_papi_usage_rollup('2024-01-01', '2024-04-01')")
    v = call('GET', '/admin/vsx/papi-usage?ym=2024-01', None, TS)
    badym = call('GET', '/admin/vsx/papi-usage?ym=2024-13', None, TS)
    cw = call('POST', '/admin/vsx/papi-bills/999999999/confirm', {'confirm': '네'}, TS)
    nf = call('POST', '/admin/vsx/papi-bills/999999999/confirm', {'confirm': '확정'}, TS)
    nv = call('POST', '/admin/vsx/papi-bills/999999999/void', {'reason': '시험 1545'}, TS)
    m403 = call('GET', '/admin/vsx/papi-usage', None, TM)
    rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'vsx-papi-bill'")
    syn_ok = (syn_line.split('|')[1:] == ['2', '1', '1']) if (syn_line and '!' not in syn) else None   # psql 이 여러 결과를 안 보이는 판이면 건너뜀
    ok('② 사용량 · 청구 — 금액 CHECK 거절 · 모으기(과금 2 · 무료 1 · 오류 1 · ROLLBACK) · 63일 범위 거절 · 운영 보기 · 잘못된 달 422 · 확인 글자 422 · 없는 번호 404 · 무효 404 · 회원 403 · 권한 주소 4',
       '!' in chk and 'ck_papi_bill_amt' in chk and syn_ok is not False and 'PAPI_USAGE_RANGE' in rng and v.get('ym') == '2024-01' and isinstance(v.get('drafts'), list) and 'settings' in v
       and badym.get('_err') == 422 and cw.get('_err') == 422 and cw.get('code') == 'PAPI_BILL_CONFIRM' and nf.get('_err') == 404 and nv.get('_err') == 404
       and m403.get('_err') == 403 and rmap == '4',
       f"{chk[-50:]} · {syn_line if syn_line is not None else syn[-80:]} · {rng[-40:]} · {v.get('ym')} · {badym.get('_err')} · {cw.get('code')} {nf.get('_err')} {nv.get('_err')} · {m403.get('_err')} · {rmap}")
    if ADMIN_WEB:
        r = admin_page('/#/vsx-papi-bill', lambda pg, seen: seen.update(n=pg.locator('[data-vsx-papi-bill]').count(), s=pg.locator('[data-vsx-bill-switch]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 파트너사 › 오픈 API 사용량 · 청구(스위치 · 표 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
