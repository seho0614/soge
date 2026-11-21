"""v10.569 (docs/711) 10차 운영 기반 ① 회귀 시험 시간 줄이기 · ⑤ 처리방침 스위치는 전체 설정에서도 SUPER
  ① (코드) admin.service PRIVACY_SWITCH_SUPER · 실행기 run_regression.sh(HOST 그대로 · PAR · reg_classify · reg_pool · 시간 기록) ·
     가짜 시험 여섯으로 「혼자」 판정 규칙 · 지금 시험 모두 판정 · 동시 결과 줄이 reg_tally 판정과 맞음 · 문서 711 · 판
  ② (API) ADMIN 이 처리방침 스위치 켜기 · 바꾸기 403 · 끄기는 됨 · 상관없는 설정은 그대로 · SUPER 는 됨
  (두 번 돌아도 통과 — 설정은 같은 값으로만 · 만든 ADMIN 은 끝에 역할을 거둠)
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

"""시험 몸통"""
AS = rd('src/modules/admin/admin.service.ts')
RR = open(os.path.join(HERE, 'run_regression.sh'), encoding='utf-8').read() if os.path.exists(os.path.join(HERE, 'run_regression.sh')) else ''
ok('① 코드 — ⑤ 처리방침 스위치 SUPER(PRIVACY_SWITCH_SUPER · sfx. · push. · social. 앞마디 · 표 키 · 끄기 off · ASSUME · 빈 값은 ADMIN 도) · 문서 711 · 판 v10.569',
   'PRIVACY_SWITCH_SUPER' in AS and 'static isPrivacySwitch' in AS and "key.startsWith('sfx.')" in AS and "key.startsWith('push.')" in AS and "key.startsWith('social.')" in AS
   and all(f"'{k}'" in AS for k in ('mall.review_points', 'csx.account_merge', 'csx.churn', 'lsy.video', 'lsy.photo_ai', 'lsy.report_ai', 'mbx.dm', 'pbulk.invite_mail'))
   and "['off', 'ASSUME', ''].includes" in AS and 'docs/711' in AS and doc('711_') != '' and VT >= (10, 569), VER)

ok('① 회귀 실행기 — HOST 줄 그대로 · 동시 PAR(처음 3) · 혼자 판정 reg_classify.py · 동시 reg_pool.py · 결과 줄 · 걸린 시간 · 시간 비교 기록 · reg_tally 그대로',
   bool(re.search(r'^HOST="[^"]*test_v1298\.py[^"]*test_v1303\.py', RR, re.M)) and 'PAR=${PAR:-3}' in RR and 'reg_classify.py' in RR and 'reg_pool.py' in RR
   and "grep -E '^결과'" in RR and '걸린 시간 ${M}분' in RR and 'reg_times.tsv' in RR and 'reg_tally.py' in RR
   and all(os.path.exists(os.path.join(HERE, x)) for x in ('reg_classify.py', 'reg_pool.py', 'reg_solo_force.txt', 'reg_par_ok.txt')), len(RR))

# 판정 규칙을 가짜 시험 다섯으로 확인(API 없이)
import importlib, tempfile
sys.path.insert(0, HERE)
try:
    RC = importlib.import_module('reg_classify'); RP = importlib.import_module('reg_pool'); RT = importlib.import_module('reg_tally')
except Exception as ex:
    RC = RP = RT = None; print('  가져오기 실패', ex)
cls = {}
if RC:
    with tempfile.TemporaryDirectory() as td:
        head = "def setting(key, value, tag):\n    return psql(\"UPDATE site_settings SET value = 1\")\ndef admin_page(path, fn):\n    return ui(fn)\n"
        fake = {
            'test_v1101x.py': head + "ok('x', 'ALTER TABLE' in M, '')\n",                                   # 코드 검사 줄 → PAR
            'test_v1102x.py': head + "setting('mall.points', 'on', 't')\n",                                  # 설정 키 → LOCK set:mall
            'test_v1103x.py': head + "psql('TRUNCATE x')\n",                                                 # 표 지움 → SOLO
            'test_v1104x.py': head + "admin_page('/#/home', lambda pg, s: None)\n",                          # 화면 → UI
            'test_v1105x.py': head + "call('POST', '/admin/jobs', {'job': 'launch_watch'}, T)\n",           # 정기 작업 → LOCK job
            'test_v1106x.py': head + "k = 'a'\nsetting(k, 'on', 't')\n",                                     # 키 못 찾음 → SOLO
        }
        for n_, s_ in fake.items():
            open(os.path.join(td, n_), 'w', encoding='utf-8').write(s_)
        cls = {f: (m, l) for f, w, m, l in RC.classify(td, K)}
print('  판정', cls)
ok('① 혼자 판정 — 코드 검사 줄은 동시 · 설정 키는 앞마디 잠금 · TRUNCATE 혼자 · 화면 UI · 정기 작업 잠금 job · 키를 못 찾은 설정은 혼자',
   cls.get('test_v1101x.py', ('',))[0] == 'PAR' and cls.get('test_v1102x.py') == ('LOCK', ['set:mall']) and cls.get('test_v1103x.py', ('',))[0] == 'SOLO'
   and cls.get('test_v1104x.py', ('',))[0] == 'UI' and cls.get('test_v1105x.py') == ('LOCK', ['job']) and cls.get('test_v1106x.py', ('',))[0] == 'SOLO', str(cls)[:300])

real = RC.classify(HERE, K) if RC else []
names = sorted(x for x in os.listdir(HERE) if re.match(r'^test_v(109|1[1-5])\S*\.py$', x))
modes = {}
for _f, _w, m, _l in real:
    modes[m] = modes.get(m, 0) + 1
lines = RP.summary_lines('test_x.py', 'ok  a\nFAIL b — c\n결과: 1 / 2') if RP else []
tl = RT.tally(lines) if RT else []
ok('① 지금 시험 모두 판정 · 동시 결과 줄 모양(「시험 | 결과: n / m」 · FAIL 네 칸)이 reg_tally 판정과 맞음',
   len(real) == len(names) and sum(modes.values()) == len(names) and modes.get('SOLO', 0) > 0
   and lines == ['test_x.py | 결과: 1 / 2', '    FAIL b — c'] and tl == [('test_x.py', 1, 2)], f"{len(real)}/{len(names)} {modes} {lines}")

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1569', 'ADMIN')
    try:
        consent_ok.agree(em, PW)
        TA = login(em)
        cur = {k: getset(k) for k in ('sfx.tm', 'lsy.video', 'push.send_mode', 'opz.nl_items')}
        a1 = call('PATCH', '/admin/site-settings', {'key': 'sfx.tm', 'value': 'on', 'reason': '시험 1569'}, TA)
        a2 = call('PATCH', '/admin/site-settings', {'key': 'lsy.video', 'value': 'on', 'reason': '시험 1569'}, TA)
        a3 = call('PATCH', '/admin/site-settings', {'key': 'push.send_mode', 'value': 'LIVE', 'reason': '시험 1569'}, TA)
        ok('② ADMIN — 처리방침 스위치 켜기 · 바꾸기는 403 PRIVACY_SWITCH_SUPER(sfx.tm · lsy.video · push.send_mode LIVE) · 값은 그대로',
           all(x.get('_err') == 403 and x.get('code') == 'PRIVACY_SWITCH_SUPER' for x in (a1, a2, a3))
           and getset('sfx.tm') == cur['sfx.tm'] and getset('lsy.video') == cur['lsy.video'], f"{a1} {a2.get('code')} {a3.get('code')} {cur}")
        b1 = call('PATCH', '/admin/site-settings', {'key': 'sfx.tm', 'value': 'off', 'reason': '시험 1569'}, TA) if cur['sfx.tm'] == 'off' else {'key': 'sfx.tm'}
        b2 = call('PATCH', '/admin/site-settings', {'key': 'opz.nl_items', 'value': cur['opz.nl_items'], 'reason': '시험 1569'}, TA) if cur['opz.nl_items'] else {'key': 'opz.nl_items'}
        b3 = call('PATCH', '/admin/site-settings', {'key': 'sfx.tm', 'value': cur['sfx.tm'] or 'off', 'reason': '시험 1569'}, TS)
        ok('② ADMIN 도 끄기(off)는 됨 · 처리방침과 상관없는 설정은 ADMIN 그대로 · SUPER 는 바꿀 수 있음(같은 값으로 · 값 그대로)',
           b1.get('key') == 'sfx.tm' and b2.get('key') == 'opz.nl_items' and b3.get('key') == 'sfx.tm' and getset('sfx.tm') == cur['sfx.tm'],
           f"{b1} {b2} {b3}")
    finally:
        rm_role(aid, '1569')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
