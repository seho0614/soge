"""v10.373 (D240 · docs/508) 분쟁 · 정산 처리 기한 경보
  ① (코드) 설정 · 정기 작업 · 오늘 할 일 · 화면
  ② (정기 작업) 작업 셈 = DB 셈 · 알림 · 풀림
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


M40, SC, MO, OA = rd('prisma/migrations/D240_due_alerts_apply_checks_withdraw_grace/migration.sql'), rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/member-ops.ts'), rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 코드 — 설정 둘 · sla_alert 분쟁 · 정산 기한(알림 · 풀림) · 오늘 할 일 over 둘 · 화면 이름 · 문서 508 · 판 v10.373',
   "('ops.dispute_due_days', '3', 'ADMIN'" in M40 and "('ops.settle_due_days', '2', 'ADMIN'" in M40 and 'const du = await this.disputeSettleOverdue()' in SC
   and "this.alertOnce('DISPUTE_OVERDUE', 'WARN'" in SC and "this.resolveAlert('SETTLE_OVERDUE'" in SC and 'AS dsp_over,' in MO and 'AS stl_over,' in MO
   and "DISPUTE_OVERDUE: '분쟁 처리 기한 넘김'" in OA and '분쟁' in doc('508_') and VT >= (10, 373), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    k0 = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in ('ops.dispute_due_days', 'ops.settle_due_days')}
    try:
        psql("BEGIN; SELECT set_config('app.setting_reason', '시험 1373', true); UPDATE site_settings SET value = '1' WHERE key IN ('ops.dispute_due_days', 'ops.settle_due_days'); COMMIT;")
        j = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        du = (j.get('detail') or {}).get('dueOverdue') or {}
        nd = int(psql("SELECT count(*) FROM disputes WHERE status IN ('OPEN', 'IN_REVIEW') AND opened_at < now() - interval '1 day'") or 0)
        ns = int(psql("SELECT count(*) FROM settlements WHERE status = 'REQUESTED' AND requested_at < now() - interval '1 day'") or 0)
        ad = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'DISPUTE_OVERDUE' AND resolved_at IS NULL")
        as_ = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'SETTLE_OVERDUE' AND resolved_at IS NULL")
        td = call('GET', '/admin/todo', None, TS)
        it = {x.get('key'): x for x in td.get('items') or []}
        psql("BEGIN; SELECT set_config('app.setting_reason', '시험 1373 30일', true); UPDATE site_settings SET value = '30' WHERE key IN ('ops.dispute_due_days', 'ops.settle_due_days'); COMMIT;")
        j2 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        du2 = (j2.get('detail') or {}).get('dueOverdue') or {}
        nd2 = int(psql("SELECT count(*) FROM disputes WHERE status IN ('OPEN', 'IN_REVIEW') AND opened_at < now() - interval '30 days'") or 0)
        ad2 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'DISPUTE_OVERDUE' AND resolved_at IS NULL")
        ok('② 정기 작업 · 오늘 할 일 — 기한 1일: 작업 셈 = DB 셈(분쟁 · 정산) · 있으면 알림 열림 · 「오늘 할 일」 over 같음 → 기한 30일: 다시 셈 · 0 이면 풀림',
           du.get('disputes') == nd and du.get('settlements') == ns and ad == ('1' if nd else '0') and as_ == ('1' if ns else '0')
           and (it.get('dsp') or {}).get('over') == nd and (it.get('stl') or {}).get('over') == ns and du2.get('disputes') == nd2 and ad2 == ('1' if nd2 else '0'),
           f"{du} = {nd} {ns} · 알림 {ad} {as_} · over {(it.get('dsp') or {}).get('over')} {(it.get('stl') or {}).get('over')} · 30일 {du2} {ad2}")
    finally:
        for k, v in k0.items():
            psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1373 되돌림', true); UPDATE site_settings SET value = '{v or ('3' if 'dispute' in k else '2')}' WHERE key = '{k}'; COMMIT;")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
