"""v10.372 (D239 · docs/507) 운영 권한 기한
  ① (코드) D239 · API · 정기 작업 · 화면
  ② (API · 정기 작업) 기한 · 400 · SUPER 막음 · 3일 알림 · 지나면 거둠
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


M39, RS, RC, SC, MR, RR = rd('prisma/migrations/D239_alert_mutes_maintenance_role_expiry/migration.sql'), rd('src/modules/site/report.service.ts'), rd('src/modules/site/report.controller.ts'), rd('src/worker/scheduler.service.ts'), rd('web/src/app/admin/MemberRoles.tsx'), rd('web/src/app/admin/RoleReview.tsx')
ok('① 코드 — D239 account_roles.expires_at · 권한 주기 expiresDays(7 · 30 · 90) · 마지막 SUPER 막음 · 정기 작업 거둠 · 3일 알림 · 화면 기한 고르기 · 「기한」 칸 · 문서 507 · 판 v10.372',
   'ADD COLUMN IF NOT EXISTS expires_at timestamptz' in M39 and "@IsOptional() @IsIn([7, 30, 90]) expiresDays?: number;" in RC and "'ROLE_EXPIRY_LAST_SUPER'" in RS
   and 'const rx = await this.roleExpire()' in SC and "'ROLE_EXPIRING', 'INFO'" in SC and ('data-member-role-days=""' in MR or 'data-role-grant-days=""' in rd('web/src/app/admin/RoleAdmin.tsx')) and 'data-role-expires=' in RR and '기한' in doc('507_') and VT >= (10, 372), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1372', None)
    try:
        emp1372 = (psql("INSERT INTO acct_employees (name, joined_on, monthly_base) VALUES ('시험1372', current_date, 0) RETURNING id") or '0').splitlines()[0]   # v10.563 (D291) 안쪽 역할은 직원 대장 연결 필수
        g1 = call('POST', '/admin/reports/roles', {'accountId': aid, 'role': 'REVIEWER', 'grant': True, 'reason': '시험 1372 기한 30일', 'expiresDays': 30, 'employeeId': emp1372}, TS)
        ex1 = psql(f"SELECT round(extract(epoch FROM expires_at - now()) / 86400) FROM account_roles WHERE account_id = '{aid}' AND role = 'REVIEWER'")
        bad = call('POST', '/admin/reports/roles', {'accountId': aid, 'role': 'REVIEWER', 'grant': True, 'reason': '시험 1372 15일', 'expiresDays': 15}, TS)
        sup = call('POST', '/admin/reports/roles', {'accountId': aid, 'role': 'SUPER', 'grant': True, 'reason': '시험 1372 SUPER 기한', 'expiresDays': 7}, TS)
        others = int(psql(f"SELECT count(*) FROM account_roles WHERE role = 'SUPER' AND expires_at IS NULL AND account_id <> '{aid}'") or 0)
        rv = call('GET', '/admin/role-review', None, TS)
        me = next((x for x in (rv.get('items') or []) if x.get('id') == aid), {})
        psql(f"UPDATE account_roles SET expires_at = now() + interval '2 days' WHERE account_id = '{aid}' AND role = 'REVIEWER'")
        j1 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        soon = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'ROLE_EXPIRING' AND resolved_at IS NULL")
        psql(f"UPDATE account_roles SET expires_at = now() - interval '1 minute' WHERE account_id = '{aid}' AND role = 'REVIEWER'")
        j2 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        left = psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{aid}' AND role = 'REVIEWER'")
        why = psql(f"SELECT reason FROM role_changes WHERE account_id = '{aid}' AND role = 'REVIEWER' AND action = 'REVOKE' ORDER BY id DESC LIMIT 1")
        rec = psql("SELECT severity || '|' || (resolved_at IS NOT NULL) FROM ops_alerts WHERE alert_code = 'ROLE_EXPIRED' ORDER BY id DESC LIMIT 1")
        rx = ((j2.get('detail') or {}).get('roleExpire') or {})
        ok('② API · 정기 작업 — 30일 기한 · 15일 400 · 다른 기한 없는 SUPER 가 있으면 SUPER 기한 허용 / 없으면 422 · 운영자 권한 표 기한 · 3일 안 ROLE_EXPIRING · 지나면 거둠 · 사유 「기한 지남」 · 기록 알림(풀림)',
           g1.get('granted') is True and ex1 in ('30', '29') and bad.get('_err') == 400 and ((others > 0 and sup.get('granted') is True) or (others == 0 and sup.get('code') == 'ROLE_EXPIRY_LAST_SUPER'))
           and bool(me.get('expiresAt')) and soon == '1' and left == '0' and (why or '').startswith('기한 지남') and rec.startswith('INFO|t') and int(rx.get('revoked') or 0) >= 1,
           f"{g1.get('granted')} {ex1} · {bad.get('_err')} · SUPER {others} {sup.get('granted')} {sup.get('code')} · {me.get('expiresAt')} · {soon} · {left} · {why} · {rec} · {rx}")
    finally:
        psql(f"UPDATE account_roles SET expires_at = NULL WHERE account_id = '{aid}'")
        rm_role(aid, '1372')
        psql("BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM acct_employees WHERE name = '시험1372'; COMMIT;")   # v10.563 시험 직원
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
