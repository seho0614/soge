"""v10.529 (D280 · docs/667) ㊿ 고객센터 · 회원 ② 이탈 위험 신호
  ① (코드) fn_csx_churn_build(앞 60일 · 최근 30일 · 운영 역할 뺌) · 가린 메일 · 내려받기 없음 · 재방문 안내는 캠페인 대상 CHURN_RISK(마케팅 동의자만) · 메뉴 · 화면 ID · 문서
  ② (DB · API) 꺼짐 422 · 시험 회원(앞 10일 · 최근 0일) → 100 · HIGH · 운영 역할 빠짐 · 목록 가린 메일 · 동의 없음 · CHECK 가 CHURN_RISK 받음 — 로그인 줄 · 새 신호 · 설정 되돌림
  ③ (화면) 회원 › 이탈 위험 신호
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


M80 = migr('D280_')
CH, CP, MK = rd('src/modules/csx/churn.ts'), rd('src/modules/marketing/campaign.ts'), rd('web/src/app/admin/MktCampaigns.tsx')
stamp = int(time.time()) % 1000000

ok('① D280 — fn_csx_churn_build(앞 60일 · 최근 30일 · 운영 역할 · 쓰지 않는 계정 뺌 · 90 이상 HIGH) · 신호 표 · 하루 기록 · 캠페인 대상 CHECK 에 CHURN_RISK · 정기 작업 06:20',
   'CREATE OR REPLACE FUNCTION public.fn_csx_churn_build()' in M80 and "d BETWEEN v_day - 89 AND v_day - 30" in M80 and "d BETWEEN v_day - 29 AND v_day" in M80
   and "r.role NOT IN ('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')" in M80 and "CASE WHEN sc.s >= 90 THEN 'HIGH' ELSE 'MID' END" in M80
   and "CHECK (audience IN ('ALL', 'RECENT_90', 'CHURN_RISK'))" in M80 and "('csx_daily', 1440, 6, 20," in M80, '')
ok('① 개인 식별은 운영 화면 안에서만 — 가린 메일 · 이름 첫 글자 · 내려받기 없음 · 재방문 안내는 마케팅 동의자만(캠페인 받는 사람 SQL 은 동의 JOIN 그대로 + 신호 표)',
   'maskMail(email)' in CH and 'name.slice(0, 1)' in CH and 'text/csv' not in CH and 'Content-Disposition' not in CH
   and re.search(r"CAMPAIGN_AUDIENCES = \[[^\]]*'CHURN_RISK'[^\]]*\] as const", CP) and "($2 = 'CHURN_RISK' AND EXISTS (SELECT 1 FROM csx_churn_signals cs WHERE cs.account_id = a.id))" in CP
   and "m.term_code = 'MARKETING' AND m.agreed" in CP and "CHURN_RISK: '이탈 위험 신호 회원(동의자만)'" in MK, '')
ok('① 연결 — 메뉴 · 화면 ID · 문서 667 · 판 v10.529', "['csx-churn', '이탈 위험 신호']" in rd('web/src/lib/adminMenu.ts') and '"SB-ADM-CSX-020"' in SJ
   and '"POST /admin/csx/churn/rebuild"' in SJ and doc('667_') and VT >= (10, 529), VER)


def mk_member(tag):
    em = f"t{tag}m{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash) VALUES ('{em}', '시험{tag}', '{h}') ON CONFLICT DO NOTHING")
    return em, psql(f"SELECT id FROM accounts WHERE email = '{em}'")


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('csx.churn', 'csx.churn_min_prev_days', 'csx.churn_drop_pct')
    before = {k: getset(k) for k in keys}
    sig0 = set((psql("SELECT account_id FROM csx_churn_signals") or '').split('\n')) - {''}
    day0 = psql("SELECT count(*) FROM csx_churn_daily WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date")
    em1, a1 = mk_member('1529')
    em2, a2 = mk_staff('1529', 'REVIEWER')
    try:
        # 앞 60일(40 ~ 80일 전)에 10일 로그인 · 최근 30일 없음 — 두 사람(회원 · 운영 역할)
        for aid in (a1, a2):
            psql("INSERT INTO login_history (account_id, at, ok, ua_kind) SELECT '" + aid + "', now() - make_interval(days => d), true, 't1529' FROM generate_series(40, 76, 4) d")
        setting('csx.churn', 'off', '1529')
        off = call('POST', '/admin/csx/churn/rebuild', None, TS)
        setting('csx.churn', 'on', '1529'); setting('csx.churn_min_prev_days', '3', '1529'); setting('csx.churn_drop_pct', '70', '1529')
        rb = call('POST', '/admin/csx/churn/rebuild', None, TS)
        row = psql(f"SELECT prev_days || '|' || recent_days || '|' || score || '|' || level FROM csx_churn_signals WHERE account_id = '{a1}'")
        staff = psql(f"SELECT count(*) FROM csx_churn_signals WHERE account_id = '{a2}'")
        found, page = None, 1
        while page <= 40 and found is None:
            lst = call('GET', f'/admin/csx/churn?level=HIGH&page={page}', None, TS)
            found = next((r for r in lst.get('rows') or [] if r.get('accountId') == a1), None)
            if not lst.get('more'):
                break
            page += 1
        aud = psql("BEGIN; INSERT INTO mkt_campaigns (title, channel, subject, body, audience) VALUES ('시험 1529 대상', 'EMAIL', '시험', '시험 1529 본문 열 자 넘게', 'CHURN_RISK') RETURNING audience; ROLLBACK;")
        ok('② 꺼짐 422 CSX_CHURN_OFF · 켜고 다시 셈 → 앞 10일 · 최근 0일 · 100 · HIGH · 운영 역할 회원은 빠짐',
           off.get('code') == 'CSX_CHURN_OFF' and rb.get('ok') is True and row == '10|0|100|HIGH' and staff == '0', f"{off.get('code')} {rb} {row} {staff}")
        ok('② 운영 목록 — 가린 메일(원문 메일 안 보임) · 이름 첫 글자 · 마케팅 동의 없음 표시 · 캠페인 대상 CHURN_RISK 를 DB 가 받음',
           found is not None and em1 not in json.dumps(found, ensure_ascii=False) and (found.get('email') or '').startswith(em1[:2]) and '***@' in (found.get('email') or '')
           and found.get('nameHead') == '시*' and found.get('marketing') is False and 'CHURN_RISK' in aud, f"{found} {aud[:60]}")
    finally:
        for k in keys:
            setting(k, before[k] or None, '1529 되돌림')
        for aid in (a1, a2):
            if aid:
                psql(f"DELETE FROM login_history WHERE account_id = '{aid}' AND ua_kind = 't1529';")
        if a2:
            rm_role(a2, '1529')
        new = set((psql("SELECT account_id FROM csx_churn_signals") or '').split('\n')) - {''} - sig0
        if new:
            psql("DELETE FROM csx_churn_signals WHERE account_id IN (" + ','.join(f"'{x}'" for x in new) + ");")
        if day0 == '0':
            psql("DELETE FROM csx_churn_daily WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date;")
    if ADMIN_WEB:
        r = admin_page('/#/csx-churn', lambda pg, seen: seen.update(n=pg.locator('[data-csx-churn]').count(), s=pg.locator('[data-csx-settings]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 이탈 위험 신호(설정 상자 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
