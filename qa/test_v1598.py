"""v10.598 (docs/740) 16차 회원 · 성장 ⑭ 첫 거래 안내 체크리스트 — 나의공간 첫 화면 · 본인 기록만 셈(grw.first_steps 처음 on · 표시만)
  ① (코드) 단계 여덟 · 이미 있는 표로만 셈 · grw_first_steps · 설정 · 카드 · 사전 ko/en · 화면 · 문서 740
  ② (API · DB) 새 회원 보임 · 그만 보기 · 다시 보기 · 끄면 OFF · 오래되면 OLD · 로그인 없이 · 형식 오류 · 운영 숫자 · 회원 403
  ③ (화면) 나의공간 카드 · 운영 칸
  (두 번 돌아도 통과 — 시험 회원은 매번 새 사람 · grw_first_steps 줄은 지움 · 설정은 되돌림)
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

M = mig_with('grw_first_steps')
FS = rd('site/src/components/grw/FirstSteps.tsx')
MY = rd('site/src/app/my/page.tsx')
codes = re.findall(r"\{ code: '([A-Z]+)', href:", GRW['first-steps'])
ok('① 코드 — 단계 여덟(본인인증 · 관심 성향 · 관심 담기 · 문의 · 매물/요청 · 거래 · 알림 설정 · 추천 코드) · 이미 있는 표로만 셈 · grw_first_steps(그만 보기 · 다 끝냄) · grw.first_steps on · 60일 · 나의공간 카드 · 사전 ko/en 같은 키 · 화면 MYP-GRW-010 · 문서 740 · 판 v10.598',
   codes == ['VERIFY', 'PROFILE', 'LIKE', 'ASK', 'POST', 'DEAL', 'NOTIFY', 'SHARE']
   and all(t in GRW['first-steps'] for t in ('member_ad_profiles', 'favorites', 'conversations', 'introducer_referrals', 'notification_preferences'))
   and 'CREATE TABLE IF NOT EXISTS public.grw_first_steps' in M and "('grw.first_steps', 'on', 'ADMIN'" in M and "('grw.first_steps_days', '60', 'ADMIN'" in M
   and 'SB-MYP-GRW-010' in FS and '<GrwFirstSteps />' in MY and keys(KO) == keys(EN) and all(f'first.step.{c}' in keys(KO) for c in codes)
   and 'SB-MYP-GRW-010' in SJ and '740' in doc('740_')[:20] and VT >= (10, 598), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid, TM = mk_member('1598')
    old = {k: getset(k) for k in ('grw.first_steps', 'grw.first_steps_days')}
    try:
        setting('grw.first_steps', 'on', '1598')
        a = call('GET', '/me/grw/first-steps', None, TM)
        st = {x.get('code'): x.get('done') for x in a.get('steps') or []}
        h1 = call('POST', '/me/grw/first-steps/hide', {'hidden': True}, TM)
        b = call('GET', '/me/grw/first-steps', None, TM)
        h2 = call('POST', '/me/grw/first-steps/hide', {'hidden': False}, TM)
        c = call('GET', '/me/grw/first-steps', None, TM)
        setting('grw.first_steps', 'off', '1598')
        d = call('GET', '/me/grw/first-steps', None, TM)
        setting('grw.first_steps', 'on', '1598')
        psql(f"UPDATE accounts SET created_at = now() - interval '400 days' WHERE id = '{aid}'")
        e = call('GET', '/me/grw/first-steps', None, TM)
        guest = call('GET', '/me/grw/first-steps')
        badh = call('POST', '/me/grw/first-steps/hide', {'hidden': 'x'}, TM)
        ok('② 회원 — 새 회원 보임(8단계 · 본인인증 끝 · 첫 거래 아님) · 그만 보기 → HIDDEN · 다시 보기 → 보임 · 끄면 OFF · 가입 오래되면 OLD · 로그인 없이 401/403 · 형식 오류 400',
           a.get('show') is True and a.get('total') == 8 and st.get('VERIFY') is True and st.get('DEAL') is False
           and h1.get('hidden') is True and b.get('reason') == 'HIDDEN' and h2.get('hidden') is False and c.get('show') is True
           and d.get('reason') == 'OFF' and e.get('reason') == 'OLD' and guest.get('_err') in (401, 403) and badh.get('_err') == 400,
           f"{a.get('show')} {st} {b.get('reason')} {c.get('show')} {d.get('reason')} {e.get('reason')} {guest.get('_err')} {badh.get('_err')}")
        s = call('GET', '/admin/grw/first-steps?days=30', None, TS)
        sm = call('GET', '/admin/grw/first-steps', None, TM)
        ok('② 운영 — 단계 여덟 숫자 · 회원 목록 없음 · 회원 403',
           len(s.get('steps') or []) == 8 and isinstance(s.get('members'), int) and 'items' not in s and sm.get('_err') == 403, f"{s.get('members')} {sm.get('_err')}")
    finally:
        for k, v in old.items():
            setting(k, v or ('on' if k == 'grw.first_steps' else '60'), '1598')
        psql(f"DELETE FROM grw_first_steps WHERE account_id = '{aid}'")

    if SITE:
        em2, aid2, _ = mk_member('1598s')
        def run(b, seen, perr):
            ps = site_login(b, perr, em2)
            ps.goto(SITE + '/my', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['card'] = ps.locator('[data-screen="SB-MYP-GRW-010"]').count()
            seen['steps'] = ps.locator('[data-grw-step]').count()
        r = ui(run)
        if r:
            seen, perr = r
            ok('③ 사용자 웹 — 나의공간 첫 화면 첫 거래 안내 카드 · 8줄', seen.get('card') == 1 and seen.get('steps') == 8 and not perr, f'{seen} {perr[:2]}')
    if ADMIN_WEB:
        def look(pg, seen):
            pg.click('[data-grw-part="first"]'); pg.wait_for_timeout(2000)
            seen['n'] = pg.locator('[data-grw-first-step]').count()
        r = admin_page('/#/grw-ops', look)
        if r:
            seen, perr = r
            ok('③ 운영 화면 — 회원 성장 › 첫 거래 안내 8줄', seen.get('n') == 8 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
