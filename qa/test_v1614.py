"""v10.614 (docs/756) ㉚ 인건비 시뮬레이션 — 회계 › 인건비 시뮬레이션(bzx-hc-sim)
  ① (코드) 급여 요율표 재사용 · calcLine 과 같은 회사 몫 식 · 퇴직금 1/12 · 12개월마다 인상 · 화면 · SQL · 문서 756 · 판
  ② (API · DB) 셈 값이 요율표 식과 같음 · 단기 자리 빠짐 · 인상 · 1년 미만 · 입력 400 · 422 · ADMIN 403 · 계획 저장 · 다시 셈 · 고치기 · 보관 · 보관 뒤 409 · DB 지우기 막음
  ③ (화면) 인건비 시뮬레이션 · 셈하기 → 12개월 표
  (두 번 돌아도 통과 — 「시험1614-」 계획은 replica 로 지움)
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



def migr_has(text):
    """18차 SQL 은 메인이 마이그레이션 번호를 붙임(D292 ~) — 번호 없이 모든 마이그레이션에서 글자를 찾음"""
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return False
    for x in sorted(os.listdir(d)):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p) and text in open(p, encoding='utf-8').read():
            return True
    return False


def job(name, tok):
    return call('POST', '/admin/jobs', {'job': name}, tok)


STAMP = int(time.time()) % 1000000
KST = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
TODAY = KST.strftime('%Y-%m-%d')
def day(n):
    return (KST + datetime.timedelta(days=n)).strftime('%Y-%m-%d')


"""시험 몸통"""
HS, CT = rd('src/modules/bzx/hc-sim.ts'), rd('src/modules/bzx/bzx.controller.ts')
UI, AP, MN = rd('web/src/app/admin/Bzx.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
ok('① 코드 — 급여 요율표 재사용(ratesOf) · calcLine 과 같은 회사 몫 식(연금 하한 · 상한 · 건강 · 장기요양 · 고용 회사 · 산재) · 퇴직금 1/12 · 인상 12개월마다 · 합계만',
   all(f in HS for f in ("from '../acct/payroll'", 'ratesOf(db, y)', 'np_base_min', 'np_base_max', 'ltc_rate', 'ei_company_rate', 'ia_company_rate', 'Math.round(g / 12)', 'Math.floor(i / 12)'))
   and "@Post('hc-sim')" in CT and "@Post('hc-plans/:id/archive')" in CT, f"{len(HS)}")
ok('① 화면 · SQL · 문서 — 회계 › 인건비 시뮬레이션(bzx-hc-sim · SB-ADM-BZX-050 · SUPER · 지급 담당) · 계획 표 · 문서 756 · 판',
   'export function BzxHcSim' in UI and "['bzx-hc-sim', '인건비 시뮬레이션']" in MN and "screen: 'SB-ADM-BZX-050'" in MN and "'bzx-hc-sim': ['SUPER', 'PAYOUT']" in AP
   and '"SB-ADM-BZX-050"' in SJ and migr_has('CREATE TABLE IF NOT EXISTS public.bzx_hc_plans') and migr_has("('bzx-hc-sim', '인건비 시뮬레이션', 'admacc'")
   and '일반 원칙' in doc('756_') and VT >= (10, 614), VER)

def f10(v):
    return int(v // 10) * 10
def cost(g, nt, r):
    tx = max(0, g - min(nt, g))
    base = min(max(tx, r.get('np_base_min', 0)), r.get('np_base_max', 10 ** 15))
    np_ = f10(base * r.get('np_rate', 0) / 100) if tx > 0 else 0
    hi = f10(tx * r.get('hi_rate', 0) / 100); ltc = f10(hi * r.get('ltc_rate', 0) / 100)
    return np_ + hi + ltc + f10(tx * r.get('ei_company_rate', 0) / 100) + f10(tx * r.get('ia_company_rate', 0) / 100)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff(f'1614p{STAMP % 97}', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    ae, aid = mk_staff(f'1614a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    CLEAN = "SET session_replication_role = replica; DELETE FROM bzx_hc_plans WHERE title LIKE '시험1614-%';"
    psql(CLEAN)
    try:
        y0 = KST.year + 1
        start = f'{y0}-01'
        rr = psql(f"SELECT string_agg(key || '=' || value, ';') FROM (SELECT DISTINCT ON (key) key, value::text AS value FROM acct_payroll_rates WHERE year <= {y0} ORDER BY key, year DESC) x")
        R = {k: float(v) for k, v in (p.split('=') for p in rr.split(';') if '=' in p)} if rr and '!' not in rr else {}
        plan = {'title': f'시험1614-{STAMP}', 'startYm': start, 'months': 13, 'raisePct': 10, 'includeCurrent': False,
                'lines': [{'role': '개발자', 'count': 2, 'monthlyBase': 4000000, 'nontax': 200000, 'startYm': start},
                          {'role': '단기 보조', 'count': 1, 'monthlyBase': 2500000, 'nontax': 0, 'startYm': start, 'endYm': f'{y0}-06'}]}
        s1 = call('POST', '/admin/bzx/hc-sim', plan, TP)
        m = s1.get('months') or []
        exp0 = 2 * (4000000 + cost(4000000, 200000, R) + round(4000000 / 12)) + (2500000 + cost(2500000, 0, R) + round(2500000 / 12))
        g12 = round(4000000 * 1.1)
        exp12 = 2 * (g12 + cost(g12, 200000, R) + round(g12 / 12))
        lines = s1.get('lines') or [{}, {}]
        ok('② 셈(지급 담당) — 13개월 · 첫 달 인원 3 · 합계 = 지급액 + 회사 4대보험(요율표 식) + 퇴직금 1/12 · 7월부터 단기 보조 빠짐 · 13번째 달 10% 인상 · 1년 미만 표시',
           len(m) == 13 and m[0].get('people') == 3 and m[0].get('total') == exp0 and m[6].get('people') == 2 and m[12].get('gross') == 2 * g12 and m[12].get('total') == exp12
           and lines[1].get('shortStay') is True and lines[0].get('shortStay') is False and (s1.get('total') or {}).get('current') == 0,
           f"{len(m)} {m[0] if m else s1} exp0={exp0} {m[12].get('total') if len(m) > 12 else ''} exp12={exp12} {lines} R={R}")
        bad1 = call('POST', '/admin/bzx/hc-sim', {**plan, 'months': 37}, TP)
        bad2 = call('POST', '/admin/bzx/hc-sim', {**plan, 'lines': [{'role': 'x', 'count': 0, 'monthlyBase': 1, 'startYm': start}]}, TP)
        bad3 = call('POST', '/admin/bzx/hc-sim', {**plan, 'lines': []}, TP)
        cur = call('POST', '/admin/bzx/hc-sim', {**plan, 'includeCurrent': True}, TP)
        na = call('POST', '/admin/bzx/hc-sim', plan, TA)
        ok('② 검사 — 37개월 400 · 인원 0 은 422 BZX_HC_INPUT · 줄 없고 지금 직원 빼면 422 · 지금 직원 함께면 current 셈 · 운영 관리자(ADMIN) 403',
           bad1.get('_err') == 400 and bad2.get('_err') == 422 and bad2.get('code') == 'BZX_HC_INPUT' and bad3.get('_err') == 422
           and (cur.get('total') or {}).get('current', -1) >= 0 and na.get('_err') == 403,
           f"{bad1.get('_err')} {bad2.get('code')} {bad3.get('code')} {(cur.get('total') or {}).get('current')} {na.get('_err')}")
        sv = call('POST', '/admin/bzx/hc-plans', plan, TP)
        pid_ = str(sv.get('id') or '')
        one = call('GET', f'/admin/bzx/hc-plans/{pid_}', None, TS)
        ed = call('PUT', f'/admin/bzx/hc-plans/{pid_}', {**plan, 'title': f'시험1614-{STAMP}-고침', 'months': 12}, TP)
        lst = call('GET', '/admin/bzx/hc-plans', None, TP)
        ar = call('POST', f'/admin/bzx/hc-plans/{pid_}/archive', None, TP)
        ed2 = call('PUT', f'/admin/bzx/hc-plans/{pid_}', plan, TP)
        g = psql(f"DELETE FROM bzx_hc_plans WHERE id = {pid_ or 0}")
        ok('② 계획 — 저장 · 다시 셈(같은 합계) · 고치기 · 목록 · 보관 · 보관한 계획 고치기 409 · DB 가 지우기 막음(BZX_HC)',
           pid_.isdigit() and (one.get('total') or {}).get('total') == (s1.get('total') or {}).get('total') and ed.get('ok') is True
           and any(x.get('id') == pid_ and x.get('months') == 12 for x in lst.get('items') or []) and ar.get('ok') is True and ed2.get('_err') == 409 and 'BZX_HC' in g,
           f"{sv} {(one.get('total') or {}).get('total')} {ed} {ar} {ed2.get('code')} {g[-50:]}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-bzx-hc-form]', timeout=30000)
                pg.fill('[data-bzx-hc-role="0"]', '시험 자리'); pg.click('[data-bzx-hc-sim]')
                pg.wait_for_selector('[data-bzx-hc-result]', timeout=30000)
                seen['months'] = pg.locator('[data-bzx-hc-result]').get_attribute('data-bzx-hc-result')
            res3 = admin_page('/#/bzx-hc-sim', chk)
            if res3 is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res3
                ok('③ 화면 — 회계 › 인건비 시뮬레이션 · 셈하기 → 12개월 표 · 화면 오류 없음', seen.get('months') == '12' and not perr, f"{seen} {perr[:2]}")
    finally:
        psql(CLEAN)
        rm_role(pid, '1614p'); rm_role(aid, '1614a')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
