"""v10.442 (D258 · docs/579) 업무별 권한 검사(PermGuard)
  ① (코드) 가드(AuthGuard 다음 · 운영 역할만 · SUPER 통과 · 표에 없는 주소는 역할만 · OFF · SHADOW · ON) · perm.* 설정 SUPER 만 · 문서 579
  ② (API · DB) 지급 담당이 그룹을 빼면 — SHADOW 는 통과 + 기록 · ON 은 403 PERM_DENIED · 그룹을 다시 붙이면 통과 · SUPER 는 늘 통과
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

PG, AS_ = rd('src/core/perm.guard.ts'), rd('src/modules/admin/admin.service.ts')
AM = rd('src/app.module.ts')
PS, AU = rd('src/modules/admin/perm.service.ts'), rd('src/core/auth.ts')
ok('① 넓히기 코드 — perm.allow_widen(처음 off) · 검사 ON 일 때만 · 금지 목록 · 감사 PERM_WIDEN · AuthGuard 역할 실패 지점에서 판정 · 기록 표',
   'export async function widenAllowed' in PS and "'PERM_WIDEN'" in PS and 'WIDEN_DENY' in PS and "(await permMode(db)) !== 'ON'" in PS
   and 'await widenAllowed(this.db, principal, req' in AU and 'async canActivate' in AU and 'perm_widen_log' in migr('D258') and "'perm.allow_widen', 'off'" in migr('D258'))
ok('① 코드 — PermGuard(운영 역할만 · SUPER 통과 · 표에 없으면 역할만 · SHADOW 기록 · ON 403) · 전역 가드 AuthGuard 다음 · perm.* SUPER 만 · 문서 579 · 판 v10.442',
   "throw new Forbidden('PERM_DENIED'" in PG and 'isSuper(principal.roles)' in PG and "mode === 'OFF'" in PG and 'logDenied' in PG
   and AM.find('useClass: AuthGuard') < AM.find('useClass: PermGuard') and "key.startsWith('perm.')" in AS_ and 'SHADOW' in doc('579_') and VT >= (10, 442), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1442', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    m0 = getset('perm.enforce')
    t0 = psql("SELECT now()")
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9); ym = kst.strftime('%Y-%m')
    try:
        base = call('GET', f'/admin/acct/journal?ym={ym}', None, TP)
        cut = call('PUT', f'/admin/perm/accounts/{pid}', {'kind': 'STAFF', 'groups': [], 'overrides': [], 'reason': '시험 1442 그룹 뺌'}, TS)
        setting('perm.enforce', 'SHADOW', '1442'); time.sleep(32)
        sh = call('GET', f'/admin/acct/journal?ym={ym}', None, TP)
        logged = psql(f"SELECT count(*) FROM perm_shadow_log WHERE account_id = '{pid}' AND created_at > '{t0}' AND 'acct-journal' = ANY(task_keys)")
        setting('perm.enforce', 'ON', '1442'); time.sleep(32)
        on = call('GET', f'/admin/acct/journal?ym={ym}', None, TP)
        # 보안 점검(11/19) 3 — 대문자 주소 · HEAD 도 표에서 찾아 막음(Express 는 주소 대소문자를 가리지 않음)
        up = call('GET', f'/ADMIN/ACCT/JOURNAL?ym={ym}', None, TP)
        try:
            hr = urllib.request.urlopen(urllib.request.Request(API + f'/admin/acct/journal?ym={ym}', headers={'Authorization': 'Bearer ' + TP}, method='HEAD'), timeout=60); head_st = hr.status
        except urllib.error.HTTPError as e:
            head_st = e.code
        sup = call('GET', f'/admin/acct/journal?ym={ym}', None, TS)
        back = call('PUT', f'/admin/perm/accounts/{pid}', {'kind': 'STAFF', 'groups': [{'key': 'R_PAYOUT'}], 'overrides': [], 'reason': '시험 1442 되돌림'}, TS)
        again = call('GET', f'/admin/acct/journal?ym={ym}', None, TP)
        ok('② 검사 — 처음 통과 · 그룹 뺌 · SHADOW 통과 + 기록 · ON 403 PERM_DENIED · SUPER 통과 · 그룹 되돌리면 통과',
           '_err' not in base and cut.get('ok') is True and '_err' not in sh and int(logged or 0) >= 1 and on.get('_err') == 403 and on.get('code') == 'PERM_DENIED'
           and '_err' not in sup and back.get('ok') is True and '_err' not in again,
           f"{base.get('_err')} {cut.get('ok')} {sh.get('_err')} {logged} {on.get('_err')} {on.get('code')} {sup.get('_err')} {back.get('ok')} {again.get('_err')}")
        ok('② 검사 — 대문자 주소 · HEAD 요청도 ON 이면 막힘(표에서 소문자로 찾음 · HEAD = GET)',
           up.get('_err') == 403 and up.get('code') == 'PERM_DENIED' and head_st == 403, f"{up.get('_err')} {up.get('code')} · HEAD {head_st}")
        # ③ 권한 넓히기(perm.allow_widen · 처음 off) — 검수 담당(REVIEWER)은 역할로 전표 화면을 못 봄 → 개인권한 「전표 보기」 + 넓히기 on 이면 통과 · 금지 목록(SUPER 전용)은 그대로 403
        w0 = getset('perm.allow_widen')
        re_, rid = mk_staff('1442w', 'REVIEWER'); consent_ok.agree(re_, PW); TR = login(re_)
        try:
            ov = call('PUT', f'/admin/perm/accounts/{rid}', {'kind': 'STAFF', 'groups': [{'key': 'R_REVIEWER'}], 'overrides': [{'taskKey': 'acct-journal', 'level': 'VIEW', 'effect': 'ALLOW', 'reason': '시험 1442 넓히기'}], 'reason': '시험 1442 넓히기'}, TS)
            w_off = call('GET', f'/admin/acct/journal?ym={ym}', None, TR)
            setting('perm.allow_widen', 'on', '1442'); time.sleep(32)
            w_on = call('GET', f'/admin/acct/journal?ym={ym}', None, TR)
            w_deny = call('GET', '/admin/perm/overview', None, TR)
            w_write = call('POST', '/admin/acct/journal/run', None, TR)
            wlog = psql(f"SELECT count(*) FROM perm_widen_log WHERE account_id = '{rid}' AND created_at > '{t0}'")
            waud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'PERM_WIDEN' AND actor_account_id = '{rid}' AND created_at > '{t0}'")
            ok('③ 넓히기 — 꺼짐이면 역할로 403 · 켜면(검사 ON) 개인권한으로 전표 보기 통과 · 기록 · 감사 PERM_WIDEN · SUPER 전용(권한 관리) 은 그대로 403 · 쓰기(전표 만들기)는 권한 없어 403',
               ov.get('ok') is True and w_off.get('_err') == 403 and '_err' not in w_on and int(wlog or 0) >= 1 and int(waud or 0) >= 1
               and w_deny.get('_err') == 403 and w_write.get('_err') == 403,
               f"{ov.get('ok')} {w_off.get('_err')} {w_on.get('_err')} {w_on.get('code')} {wlog} {waud} {w_deny.get('_err')} {w_write.get('_err')}")
        finally:
            setting('perm.allow_widen', w0 or 'off', '1442 되돌림')
            call('PUT', f'/admin/perm/accounts/{rid}', {'kind': 'STAFF', 'groups': [], 'overrides': [], 'reason': '시험 1442 넓히기 정리'}, TS)
            rm_role(rid, '1442w')
        # 보안 점검(11/19) 2 — 역할을 주면 R_역할 그룹이 붙고 · 기한을 바꾸면 같이 · 역할을 빼면 그룹도 빠짐
        de, did = mk_staff('1442d', 'REVIEWER')
        try:
            g1 = psql(f"SELECT count(*) FROM perm_account_groups WHERE account_id = '{did}' AND group_key = 'R_REVIEWER'")
            psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1442 기한', true); UPDATE account_roles SET expires_at = now() + interval '3 days' WHERE account_id = '{did}' AND role = 'REVIEWER'; COMMIT;")
            ex = psql(f"SELECT (g.expires_at = r.expires_at)::text FROM perm_account_groups g JOIN account_roles r ON r.account_id = g.account_id AND 'R_' || r.role = g.group_key WHERE g.account_id = '{did}' AND g.group_key = 'R_REVIEWER'")
            rm_role(did, '1442d')
            g2 = psql(f"SELECT count(*) FROM perm_account_groups WHERE account_id = '{did}' AND group_key = 'R_REVIEWER'")
        finally:
            psql(f"DELETE FROM perm_account_groups WHERE account_id = '{did}'")
        ok('② 처음 변환 그룹 — 역할 주면 R_REVIEWER 붙음 · 역할 기한 바꾸면 그룹 기한 같음 · 역할 빼면 그룹 빠짐(넓히기로 뺏긴 역할 범위에 못 들어옴)',
           g1 == '1' and ex == 'true' and g2 == '0', f"{g1} {ex} {g2}")
    finally:
        setting('perm.enforce', m0 or 'SHADOW', '1442 되돌림'); setting('perm.allow_widen', 'off', '1442 되돌림'); time.sleep(32)   # 서버의 모드 기억(30초)이 풀린 뒤 다음 시험
        rm_role(pid, '1442')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
