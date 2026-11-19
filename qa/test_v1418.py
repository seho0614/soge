"""v10.418 (D251 · docs/555) 회계 숫자 · 알림 빠진 것 — 퇴직금 장부 잔액에 기초 잔액 · 법인세 · 급여 · 카드 대금 기한
  ① (코드) severance 장부 잔액(acct_opening_sets · 확정 판) · month.ts corpDeadlines · PAY · CARD · acct.deadline_payday · 문서
  ② (API) 기한 목록에 급여 · 카드 대금(목록엔 늘) · 알림은 처음 꺼짐 · 켜면 7일 안 급여 기한 알림 하나
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


import glob
def mig(prefix):
    fs = sorted(glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(fs[0], encoding='utf-8').read() if fs else ''


M48 = mig('D248')

M51 = mig('D251')
SV, MO = rd('src/modules/acct/severance.ts'), rd('src/modules/acct/month.ts')
ok('① 코드 — 퇴직금 장부 잔액 = 확정 기초 잔액 판 + 그 뒤 전표 · 법인세 기한(CORP) 합침 · 급여(PAY) · 카드(CARD) 기한 · 알림 스위치 acct.deadline_payday(처음 off) · 문서 555 · 판 v10.418',
   'acct_opening_sets' in SV and "o.role = 'SEVERANCE_RES'" in SV and 'corpDeadlines' in MO and "kind: 'PAY'" in MO and "kind: 'CARD'" in MO and 's.payAlert' in MO
   and "'acct.deadline_payday', 'off'" in M51 and '기한' in doc('555_') and VT >= (10, 418), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    keep = {k: getset(k) for k in ('acct.pay_day', 'acct.deadline_payday', 'acct.deadline_days_before', 'acct.deadline_alert')}
    t0 = psql("SELECT now()")
    try:
        d0 = call('GET', '/admin/acct/deadlines', None, TS)
        kinds = {x.get('kind') for x in d0.get('list') or []}
        # 급여일을 이틀 뒤로(28일 넘으면 건너뜀) · 알림 켜고 정기 작업
        day2 = (kst + datetime.timedelta(days=2)).day
        if day2 <= 28:
            setting('acct.pay_day', str(day2), '1418'); setting('acct.deadline_days_before', '7', '1418'); setting('acct.deadline_alert', 'on', '1418')
            setting('acct.deadline_payday', 'off', '1418')
            call('POST', '/admin/jobs', {'job': 'acct_deadline'}, TS)
            d1 = call('GET', '/admin/acct/deadlines', None, TS)
            pay = next((x for x in d1.get('list') or [] if x.get('kind') == 'PAY' and x.get('daysLeft', 99) <= 7), {})
            off_n = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_DEADLINE' AND detail->>'key' = '{pay.get('key')}' AND raised_at >= '{t0}'::timestamptz") if pay else '0'
            setting('acct.deadline_payday', 'on', '1418')
            call('POST', '/admin/jobs', {'job': 'acct_deadline'}, TS); call('POST', '/admin/jobs', {'job': 'acct_deadline'}, TS)
            on_n = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_DEADLINE' AND detail->>'key' = '{pay.get('key')}'") if pay else '0'
            ok('② 기한 — 목록에 급여 · 카드 대금 · 급여 기한 7일 안 · 알림 꺼짐이면 없음 · 켜면 하나(두 번 돌려도)',
               {'PAY', 'CARD'} <= kinds and bool(pay) and off_n == '0' and on_n == '1', f"{sorted(k for k in kinds if k)} · {pay} · 꺼짐 {off_n} · 켬 {on_n}")
        else:
            ok('② 기한 — 목록에 급여 · 카드 대금(월말이라 알림 확인 건너뜀)', {'PAY', 'CARD'} <= kinds, f"{sorted(k for k in kinds if k)}")
    finally:
        for k, v in keep.items():
            if v: setting(k, v, '1418 되돌림')
        psql(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1418' WHERE alert_code = 'ACCT_DEADLINE' AND resolved_at IS NULL AND detail->>'kind' IN ('PAY', 'CARD') AND raised_at >= '{t0}'::timestamptz")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
