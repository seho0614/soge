"""v10.597 (docs/739) 16차 회원 · 성장 ⑬ 가입 퍼널 분석 — 읽기만 · 가입 화면 단계 하루 수(grw.signup_steps 처음 off)
  ① (코드) grw_signup_steps_daily(개인 식별 칸 없음) · fn_grw_step_add · 설정 정규식 서버 = DB · 공개 주소 · DNT · GPC · 로봇 · 가입 화면 grwStep · 퍼널 재사용(유입 기록 · 추천 관계 · 화면 사용 통계) · 메뉴 · 화면 · 문서 739
  ② (API · DB) 꺼짐 · 켬 · DNT · 로봇 · 틀린 단계 · 칸 목록 · 퍼널 모양 · 회원 403 · 설정 SUPER · 사유 · 권한 시드 7
  ③ (화면) 회원 › 회원 성장 · 가입 퍼널
  (두 번 돌아도 통과 — 단계 수는 늘기만 · 설정은 처음 값으로 되돌림 · 시험 회원은 매번 새 사람)
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


def mk_member(tag):
    """시험 회원(본인인증 · MEMBER) — 이메일에 시각을 넣어 두 번 돌아도 새 사람"""
    em, aid = mk_staff(tag, 'MEMBER')
    import consent_ok
    consent_ok.agree(em, PW)
    return em, aid, login(em)


def mig_with(word):
    """grw_ SQL 이 들어간 마이그레이션(번호는 메인이 정함 — 글자로 찾음 · 여러 개면 이어 붙임)"""
    d = os.path.join(K, 'prisma', 'migrations')
    out = []
    for x in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.isfile(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                out.append(t)
    return '\n'.join(out)


"""시험 몸통"""
GRW = {k: rd(f'src/modules/grw/{k}.ts') for k in ('common', 'funnel', 'first-steps', 'digest', 'tier', 'fill', 'grw.controller')}
MN, AP, AM = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/app.module.ts')
GW = rd('web/src/app/admin/Grw.tsx')
KO = json.loads(rd('site/src/i18n/messages/ko/grw.json') or '{}')
EN = json.loads(rd('site/src/i18n/messages/en/grw.json') or '{}')
STAMP = int(time.time()) % 1000000


def keys(d, p=''):
    out = set()
    for k, v in (d or {}).items():
        out |= keys(v, p + k + '.') if isinstance(v, dict) else {p + k}
    return out

M = mig_with('grw_signup_steps_daily')
PAT = re.search(r"GRW_PATTERNS: Record<string, string> = \{(.*?)\};", GRW['common'], re.S)
pats = dict(re.findall(r"'(grw\.[a-z_]+)': '([^']+)'", PAT.group(1))) if PAT else {}
db_pats = dict(re.findall(r"\('(grw\.[a-z_]+)', '[^']*', 'ADMIN', '[^']*', false, '([^']+)'", mig_with('grw.signup_steps')))
SW = rd('site/src/lib/grwStep.ts')
SZ = rd('site/src/components/auth/SignupWizard.tsx')
ok('① 코드 — 가입 단계 하루 수 표(계정 · IP · 브라우저 칸 없음) · 더하기 함수 · grw.signup_steps off · 정규식 서버 = DB · 공개 /site/grw/signup-step · DNT · GPC · 로봇 · 가입 화면 단계 보내기 · 퍼널(유입 기록 · 추천 관계 · 화면 사용 통계 재사용 · 직원 뺌) · 메뉴 grw-ops · 화면 GRW-020 · 문서 739 · 판 v10.597',
   'CREATE TABLE IF NOT EXISTS public.grw_signup_steps_daily' in M and 'fn_grw_step_add' in M and "('grw.signup_steps', 'off', 'ADMIN'" in M
   and not re.search(r'grw_signup_steps_daily \([^;]*\b(account|ip|visitor|ua|user_agent)', M)
   and pats and all(db_pats.get(k) == v for k, v in pats.items() if k in db_pats) and len(db_pats) >= 1
   and "@Post('site/grw/signup-step')" in GRW['grw.controller'] and "h.dnt === '1' || h.gpc === '1'" in GRW['funnel']
   and 'attribution_events' in GRW['funnel'] and 'introducer_referrals' in GRW['funnel'] and 'site_usage_daily' in GRW['funnel'] and 'STAFF_ROLES' in GRW['funnel']
   and "grwStep(step)" in SZ and 'doNotTrack' in SW and 'document.cookie' not in SW
   and "['grw-ops', '회원 성장']" in MN and "'grw-ops':" in MN and "tab === 'grw-ops'" in AP and 'GrwAdminController' in AM
   and 'SB-ADM-GRW-020' in SJ and 'SB-ADM-GRW-020' in GW and '처리방침' in doc('739_') and VT >= (10, 597), f'{VER} {sorted(pats)} {sorted(db_pats)}')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid, TM = mk_member('1597')
    sem, said = mk_staff('1597a', 'ADMIN')
    consent_ok.agree(sem, PW)
    TA = login(sem)
    old = getset('grw.signup_steps')
    UA = {'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120 t1597'}

    def beat(body, extra=None):
        hd = {'content-type': 'application/json', **UA, **(extra or {})}
        r = urllib.request.Request(API + '/site/grw/signup-step', data=json.dumps(body).encode(), headers=hd, method='POST')
        try:
            return json.loads(urllib.request.urlopen(r, timeout=60).read() or b'{}')
        except urllib.error.HTTPError as e:
            return {'_err': e.code}
    today = "(now() AT TIME ZONE 'Asia/Seoul')::date"
    added = 0
    try:
        setting('grw.signup_steps', 'off', '1597')
        off = beat({'s': 3})
        sw0 = call('GET', '/site/grw/switches')
        setting('grw.signup_steps', 'on', '1597')
        n0 = int(psql(f"SELECT coalesce(sum(n), 0) FROM grw_signup_steps_daily WHERE day = {today} AND step = 3") or 0)
        on = beat({'s': 3})
        n1 = int(psql(f"SELECT coalesce(sum(n), 0) FROM grw_signup_steps_daily WHERE day = {today} AND step = 3") or 0)
        added = n1 - n0
        dnt = beat({'s': 3}, {'dnt': '1'})
        bot = beat({'s': 3}, {'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)'})
        bad = beat({'s': 9})
        n2 = int(psql(f"SELECT coalesce(sum(n), 0) FROM grw_signup_steps_daily WHERE day = {today} AND step = 3") or 0)
        cols = psql("SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'grw_signup_steps_daily'")
        ok('② 단계 수 — 꺼짐 OFF · 켬 → 단계 3 하나 늘어남 · DNT · 로봇은 안 셈 · 틀린 단계 400 · 칸은 day · step · n 뿐 · 공개 스위치',
           off.get('reason') == 'OFF' and sw0.get('signupSteps') is False and on.get('ok') is True and n1 == n0 + 1
           and dnt.get('reason') == 'DNT' and bot.get('reason') == 'BOT' and bad.get('_err') == 400 and n2 == n1 and cols == 'day,step,n',
           f'{off} {on} {n0}->{n1}->{n2} {dnt} {bot} {bad} {cols}')
        f = call('GET', '/admin/grw/funnel?days=30', None, TS)
        fm = call('GET', '/admin/grw/funnel', None, TM)
        ok('② 퍼널 — 경로 넷(추천 · 소개코드 · 광고 · 직접) · 단계 다섯 · 합계 = 경로 합 · 이번에 만든 회원이 가입에 셈 · 회원 403',
           [x.get('source') for x in f.get('bySource') or []] == ['RECOMMEND', 'REFCODE', 'AD', 'DIRECT'] and len(f.get('steps') or []) == 5
           and f.get('total', {}).get('signed') == sum(x.get('signed', 0) for x in f.get('bySource') or []) and f.get('total', {}).get('signed', 0) >= 1
           and fm.get('_err') == 403, f"{f.get('total')} {fm.get('_err')}")
        s_admin = call('PUT', '/admin/grw/settings', {'signupSteps': False, 'reason': '시험 1597'}, TA)
        s_noreason = call('PUT', '/admin/grw/settings', {'signupSteps': False}, TS)
        s_ok = call('PUT', '/admin/grw/settings', {'signupSteps': False, 'reason': '시험 1597 끔'}, TS)
        ov = call('GET', '/admin/grw/overview', None, TA)
        ok('② 설정 — 바꾸기는 SUPER(ADMIN 403) · 사유 없음 400 · SUPER 끔 → 꺼짐 · 보기는 ADMIN 도',
           s_admin.get('_err') == 403 and s_noreason.get('_err') == 400 and s_ok.get('ok') is True and s_ok.get('settings', {}).get('signupSteps') is False
           and ov.get('settings', {}).get('signupSteps') is False, f"{s_admin.get('_err')} {s_noreason.get('_err')} {s_ok.get('ok')}")
        rt = psql("SELECT count(*) FROM perm_route_map WHERE pattern LIKE '/admin/grw/%' AND task_key = 'grw-ops'")
        ok('② 권한 시드 — grw-ops 주소 7(overview · settings · funnel · first-steps · digest · tier · fill)', rt == '7', rt)
    finally:
        if added > 0:   # 시험이 더한 수만 되돌림(공유 숫자 남기지 않음)
            psql(f"UPDATE grw_signup_steps_daily SET n = greatest(n - {added}, 0) WHERE day = {today} AND step = 3")
        setting('grw.signup_steps', old or 'off', '1597')
        rm_role(said, '1597a')

    if ADMIN_WEB:
        r = admin_page('/#/grw-ops', lambda pg, seen: seen.update(t=pg.inner_text('body')[:4000], f=pg.locator('[data-grw-funnel]').count()))
        if r:
            seen, perr = r
            ok('③ 화면 — 회원 › 회원 성장 · 가입 퍼널 칸 · 오류 없음', seen.get('f', 0) >= 1 and '유입 경로별' in seen.get('t', '') and not perr, f"{seen.get('f')} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
