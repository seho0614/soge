"""v10.576 (docs/718) 11차 회원 · 거래 ④ 회원 휴면 계정 — 스위치 mtr.dormant(처음 off · 법무 확인 필요 · 회사 선택)
  ① (코드) 상태 DORMANT · 금고 · 지킴 트리거 · 후보 뷰 · SQL 글에 조각 끼우기 없음 · 로그인 · 간편 로그인 · 재설정 연결
  ② (DB · API) 꺼짐 작업 건너뜀 · 직접 DORMANT 막음 · (다른 대상이 없을 때만) 켜서 알림 → 31일 뒤 휴면(이름 · 전화 금고) → 로그인하면 풀림(되돌림 · 알림) · 운영 풀기 400 · 409
  (두 번 돌아도 통과 — 시험 계정은 매번 새로 만들고 끝에 탈퇴 상태로 · 알림 · 휴면 줄 · 금고는 replica 로 지움 · 설정은 되돌림)
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


def migr_has(word):
    """그 낱말이 든 마이그레이션(번호는 합칠 때 정해짐)"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


"""시험 몸통"""
MS = migr_has('mtr_dormant_vault')
DM = rd('src/modules/mtr/dormant.ts')
AU = rd('src/modules/identity/auth.service.ts')
SO = rd('src/modules/social/social.ts')
AS = rd('src/modules/identity/account-security.service.ts')
D718 = doc('718_')
ok('① 코드 — 상태 DORMANT 넓힘 · 금고(pii · 암호화) · 지킴 트리거(휴면 함수만 · 풀면 되돌림) · 후보 뷰(운영 역할 · 진행 거래 · 유료 구독 · 파트너 뺌) · 스위치 · 메일 처음 off · 문서 법무 확인 필요 · 판',
   "'DORMANT'::text" in MS and 'pii.mtr_dormant_vault' in MS and 'pgp_sym_encrypt' in MS and 'fn_mtr_dormant_guard' in MS and 'app.mtr_dormant' in MS
   and 'v_mtr_dormant_pool' in MS and "('mtr.dormant', 'off'" in MS and "('mtr.dormant_mail', 'off'" in MS
   and 'v_mtr_dormant_pool' in DM and not any('${' in m for m in re.findall(r'`([^`]*)`', DM) if re.search(r'\b(SELECT|UPDATE|INSERT|DELETE)\b', m))
   and '법무' in D718 and '2023' in D718 and VT >= (10, 576), VER)
ok('① 연결 — 이메일 로그인 · 간편 로그인 · 재설정 링크에서 풂 · 재설정 요청은 휴면 계정도 · 화면 목록 SB-ADM-MTR-040',
   "mtrDormantWake(this.db, acc.id, 'LOGIN')" in AU and "mtrDormantWake(this.db, accountId, 'SOCIAL')" in SO
   and "fn_mtr_dormant_wake(t.account_id, 'PW_RESET')" in AS and "status IN ('ACTIVE', 'DORMANT')" in AS and 'SB-ADM-MTR-040' in SJ, '')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    T0 = psql("SELECT now()::text")
    old = {k: getset(k) for k in ('mtr.dormant', 'mtr.dormant_mail', 'mtr.dormant_days', 'mtr.dormant_notice_days')}
    em, aid = mk_staff('1576', 'MEMBER')
    CLEAN = lambda: psql(f"SET session_replication_role = replica; DELETE FROM notifications WHERE account_id = '{aid}' AND event_code LIKE 'MTR_DORMANT%'; "
                         f"DELETE FROM pii.mtr_dormant_vault WHERE account_id = '{aid}'; DELETE FROM mtr_dormant WHERE account_id = '{aid}'; "
                         f"UPDATE accounts SET status = 'WITHDRAWN', withdrawn_at = now(), name = '시험1576' WHERE id = '{aid}';")
    try:
        setting('mtr.dormant', 'off', '1576'); setting('mtr.dormant_mail', 'off', '1576')
        pv0 = call('GET', '/admin/mtr/dormant?view=NOTICED', None, TS)
        p0 = (pv0.get('preview') or {}).get('notice', -1)
        psql(f"UPDATE accounts SET phone = '010-1576-0000', created_at = now() - interval '500 days', last_login_at = now() - interval '400 days' WHERE id = '{aid}'")
        g0 = psql(f"UPDATE accounts SET status = 'DORMANT' WHERE id = '{aid}'")
        jb0 = call('POST', '/admin/jobs', {'job': 'mtr_daily'}, TS)
        ok('② 꺼짐 — 하루 작업은 아무것도 안 함 · 운영 미리 보기 숫자 · 직접 DORMANT 로 바꾸기는 DB 가 막음(MTR_DORMANT)',
           (jb0.get('detail') or {}).get('dormant', {}).get('skipped') == 'OFF' and isinstance(p0, int) and p0 >= 0 and 'MTR_DORMANT' in g0,
           f"{(jb0.get('detail') or {}).get('dormant')} {p0} {g0[-60:]}")
        if p0 != 0:
            print(f'  (다른 계정 {p0}명이 이미 휴면 알림 대상 — 공유 데이터를 건드리지 않으려고 작업 흐름은 건너뜀)')
        else:
            setting('mtr.dormant', 'on', '1576')
            j1 = call('POST', '/admin/jobs', {'job': 'mtr_daily'}, TS)
            s1 = psql(f"SELECT state || '|' || (SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'MTR_DORMANT_NOTICE') FROM mtr_dormant WHERE account_id = '{aid}'")
            psql(f"UPDATE mtr_dormant SET noticed_at = now() - interval '31 days' WHERE account_id = '{aid}'")
            j2 = call('POST', '/admin/jobs', {'job': 'mtr_daily'}, TS)
            s2 = psql(f"SELECT a.status || '|' || a.name || '|' || coalesce(a.phone, '-') || '|' || (SELECT count(*) FROM pii.mtr_dormant_vault v WHERE v.account_id = a.id) || '|' || m.state FROM accounts a JOIN mtr_dormant m ON m.account_id = a.id WHERE a.id = '{aid}'")
            ok('② 켬 — 첫날 미리 알림(사이트 알림 1) · 알림 31일 뒤 휴면 — 상태 DORMANT · 이름 「휴면 회원」 · 전화 비움 · 금고 1줄',
               s1 == 'NOTICED|1' and s2 == 'DORMANT|휴면 회원|-|1|DORMANT' and (j2.get('detail') or {}).get('dormant', {}).get('dormant', 0) >= 1,
               f"{s1} {s2} {(j1.get('detail') or {}).get('dormant')} {(j2.get('detail') or {}).get('dormant')}")
            lst = call('GET', '/admin/mtr/dormant?view=DORMANT', None, TS)
            row = next((r for r in (lst.get('rows') or []) if r.get('accountId') == aid), None)
            bw = call('POST', f'/admin/mtr/dormant/{aid}/wake', {'reason': '짧음'}, TS)
            ok('② 운영 목록 — 휴면 줄 · 메일 가림 · 풀기 사유 5자 미만 400',
               row is not None and '***' in (row.get('email') or '') and bw.get('_err') == 400, f"{bool(row)} {row and row.get('email')} {bw.get('_err')}")
            lg = call('POST', '/auth/login', {'email': em, 'password': PW})
            s3 = psql(f"SELECT a.status || '|' || a.name || '|' || coalesce(a.phone, '-') || '|' || (SELECT count(*) FROM pii.mtr_dormant_vault v WHERE v.account_id = a.id) || '|' || m.state || '|' || m.restored_via || '|' || (SELECT count(*) FROM notifications n WHERE n.account_id = a.id AND n.event_code = 'MTR_DORMANT_WAKE') FROM accounts a JOIN mtr_dormant m ON m.account_id = a.id WHERE a.id = '{aid}'")
            nw = call('POST', f'/admin/mtr/dormant/{aid}/wake', {'reason': '본인 전화 확인 — 시험'}, TS)
            ok('② 로그인하면 풀림 — 증표 받음 · ACTIVE · 이름 · 전화 되돌림 · 금고 지움 · 풀린 길 LOGIN · 환영 알림 · 이미 풀린 계정 풀기 409',
               bool(lg.get('accessToken')) and s3 == 'ACTIVE|시험1576|010-1576-0000|0|RESTORED|LOGIN|1' and nw.get('_err') == 409,
               f"{bool(lg.get('accessToken')) or lg} {s3} {nw.get('_err')}")
    finally:
        for k, v in old.items():
            setting(k, v or None, '1576 되돌림')
        CLEAN()

    if ADMIN_WEB:
        r = admin_page('/#/mtr-dormant', lambda pg, seen: seen.update(n=pg.locator('[data-mtr-dormant]').count(), v=pg.locator('[data-mtr-dormant-view]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 휴면 계정(보기 단추 3 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('v') == 3 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
