"""v10.374 (D240 · docs/509) 운영 적용 확인표
  ① (코드) D240 · API · 화면
  ② (API) 넣기 · 409 · 422 · 맞음 · 다름 알림 · 고치기 막힘 · 403
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


M40, OW, AC, DB_ = rd('prisma/migrations/D240_due_alerts_apply_checks_withdraw_grace/migration.sql'), rd('src/modules/admin/ops-week.controller.ts'), rd('src/modules/admin/apply-checks.ts'), rd('web/src/app/admin/Dashboard.tsx')
ok('① 코드 — D240 ops_apply_checks · ops_apply_marks(쌓기만) · API(SUPER 넣기 · 감사 · 다름 알림) · 표 읽기 · 첫 화면 상자 · 지우는 문장 없음 · 문서 509 · 판 v10.374',
   'CREATE TABLE IF NOT EXISTS public.ops_apply_checks' in M40 and 'trg_ops_apply_marks_ro' in M40 and not re.search(r'\b(DROP|DELETE FROM|TRUNCATE)\b', M40)
   and "@Audit('APPLY_CHECKS_SET', 'SETTING')" in OW and "'APPLY_CHECK_NG', 'WARN'" in OW and 'export function parseApplyItems' in AC and '<ApplyChecksBox />' in DB_
   and '확인표' in doc('509_') and VT >= (10, 374), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    V = f"v1374.{int(time.time()) % 100000}"
    TXT = "| # | 곳 (정확한 위치) | 맞으면 |\n|---|---|---|\n| 1 | 운영 화면 첫 화면 › **「지금 판」** | v10.372 |\n| 2 | 사용자 웹 머리줄 | 「고객센터」 |\n| 3 | 위험감지 › 운영 알림 | 전과 같음 |\n"
    s1 = call('POST', '/admin/apply-checks', {'version': V, 'text': TXT}, TS)
    s2 = call('POST', '/admin/apply-checks', {'version': V, 'text': TXT}, TS)
    e0 = call('POST', '/admin/apply-checks', {'version': V + '1', 'text': '|---|---|\n'}, TS)
    g = call('GET', f'/admin/apply-checks?version={V}', None, TS)
    items = g.get('items') or []
    i1, i2 = (items + [{}, {}])[0].get('id'), (items + [{}, {}])[1].get('id')
    m1 = call('POST', f'/admin/apply-checks/{i1}/mark', {'result': 'OK'}, TS)
    m2 = call('POST', f'/admin/apply-checks/{i2}/mark', {'result': 'NG', 'memo': '시험 1374 다름'}, TS)
    ng = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'APPLY_CHECK_NG' AND detail->>'version' = '{V}'")
    m3 = call('POST', f'/admin/apply-checks/{i2}/mark', {'result': 'OK'}, TS)
    g2 = call('GET', f'/admin/apply-checks?version={V}', None, TS)
    up = psql(f"UPDATE ops_apply_checks SET item = '바꿈' WHERE version = '{V}'")
    fb = call('GET', '/admin/apply-checks', None, TB)
    cur = call('GET', '/admin/apply-checks', None, TS)
    ok('② API — 표 3줄(머리 · 구분 뺌 · 「곳 — 맞으면」 · ** 뺌) · 다시 409 · 항목 없음 422 · 맞음 · 다름 → 알림 · 다시 맞음(최근이 지금) · 완료 3 중 2 · 고치기 막힘 · 회원 403 · 버전 없으면 지금 판',
           s1.get('count') == 3 and s2.get('code') == 'APPLY_CHECKS_EXIST' and e0.get('code') == 'APPLY_CHECKS_EMPTY' and items[0].get('item') == '운영 화면 첫 화면 › 「지금 판」 — v10.372'
           and m1.get('ok') and m2.get('ok') and ng == '1' and m3.get('ok') and g2.get('done') == 2 and g2.get('ng') == 0 and g2.get('total') == 3
           and '!' in up and fb.get('_err') == 403 and re.match(r'^v\d+\.\d+$', cur.get('version') or '') is not None and g2.get('canSet') is True,
           f"{s1.get('count')} {s2.get('code')} {e0.get('code')} · {items[0].get('item') if items else None} · {ng} · {g2.get('done')} {g2.get('ng')} · {up[-30:]} · {fb.get('_err')} · {cur.get('version')}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
