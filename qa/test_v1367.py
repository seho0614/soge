"""v10.367 (D238 · docs/502) 신고 처리 기한 경보
  ① (코드) 설정 · sla_alert · 오늘 할 일 · 화면 이름 · 문서 502 · 판 v10.367
  ② (정기 작업) 기한 넘긴 신고 → REPORT_OVERDUE · 오늘 할 일 over → 풀림
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


M38, SC, MO, OA = rd('prisma/migrations/D238_export_requests_restore_drills/migration.sql'), rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/member-ops.ts'), rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 코드 — 설정 ops.report_due_hours(24 · 1 ~ 168) · sla_alert 에 신고 기한(REPORT_OVERDUE · 풀림) · 오늘 할 일 rep over · 화면 이름 · 문서 502 · 판 v10.367',
   "('ops.report_due_hours', '24', 'ADMIN'" in M38 and 'const ro = await this.reportOverdue()' in SC and "this.alertOnce('REPORT_OVERDUE', 'WARN'" in SC
   and "this.resolveAlert('REPORT_OVERDUE'" in SC and 'AS rep_over,' in MO and "Number(c?.rep_over ?? 0)" in MO and "REPORT_OVERDUE: '신고 처리 기한 넘김'" in OA
   and '신고 처리 기한' in doc('502_') and VT >= (10, 367), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, tgt = mk_staff('1367', None)
    buyer = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    rc = psql("SELECT code FROM report_reasons ORDER BY sort_order LIMIT 1")
    h0 = psql("SELECT value FROM site_settings WHERE key = 'ops.report_due_hours'")
    try:
        rid = psql(f"INSERT INTO reports (target_type, target_id, reason_code, detail, reporter_id, created_at) VALUES ('PROFILE', '{tgt}', '{rc}', '시험 1367', '{buyer}', now() - interval '3 hours') RETURNING id").splitlines()[0]
        s1 = psql("UPDATE site_settings SET value = '1' WHERE key = 'ops.report_due_hours'")
        j1 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        a1 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'REPORT_OVERDUE' AND resolved_at IS NULL")
        td = call('GET', '/admin/todo', None, TS)
        rep = next((x for x in td.get('items') or [] if x.get('key') == 'rep'), {})
        s2 = psql("UPDATE site_settings SET value = '168' WHERE key = 'ops.report_due_hours'")
        j2 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        a2 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'REPORT_OVERDUE' AND resolved_at IS NULL")
        rn = psql("SELECT resolve_note FROM ops_alerts WHERE alert_code = 'REPORT_OVERDUE' ORDER BY id DESC LIMIT 1")
        ro1 = ((j1.get('detail') or {}).get('reportOverdue') or {})
        ok('② 정기 작업 · 오늘 할 일 — 기한 1시간 · 3시간 전 신고 → REPORT_OVERDUE 열림 · 작업 결과 overdue ≥ 1 · 「신고 처리 대기」 over ≥ 1 → 기한 168시간 → 풀림(기한 넘긴 신고 없음)',
           rid and '!' not in s1 and a1 == '1' and int(ro1.get('overdue') or 0) >= 1 and ro1.get('hours') == 1 and int(rep.get('over') or 0) >= 1 and rep.get('n', 0) >= 1
           and '!' not in s2 and a2 == '0' and rn == '기한 넘긴 신고 없음',
           f"{rid[:8] if rid else rid} · {s1[-30:]} · 알림 {a1}→{a2} · {ro1} · rep {rep} · {rn}")
    finally:
        psql(f"UPDATE site_settings SET value = '{h0 or '24'}' WHERE key = 'ops.report_due_hours'")
        psql(f"UPDATE reports SET state = 'DISMISSED', resolution = '시험 1367 정리', handled_at = now() WHERE detail = '시험 1367' AND state IN ('OPEN', 'QUEUED')")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
