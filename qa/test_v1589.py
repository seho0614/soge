"""v10.589 (docs/731) 14차 운영 ⑤ 개발 서버 디스크 정리 강화 — infra tools/dev-disk-clean.sh · ~/sgb-check.sh 는 제안 패치만
  ① (코드 · 문서) 도구 모드 · 지우는 길 범위 · bash -n · 문서 제안 패치
  ② (가짜 HOME · 가짜 /tmp · 붙지 않는 가짜 도커) 읽기만은 안 지움 · --auto 는 점검 결과 19 · 킷 3판 · ops 2판 · 차이 파일 · 리허설 찌꺼기만
  (서버 진짜 폴더 · 도커는 건드리지 않음 · 임시 폴더는 끝에 지움 — 두 번 돌아도 같음)
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
import shutil, tempfile


def kit(rel):
    p = os.path.join(KIT, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


DC_P = os.path.join(KIT, 'tools/dev-disk-clean.sh')
DC = kit('tools/dev-disk-clean.sh')
D = doc('731_')
rmlines = [l for l in DC.splitlines() if 'rm -rf' in l and not l.lstrip().startswith('#')]
ok('① 코드 · 문서 — 정리 도구(읽기만 기본 · --apply · --auto · 여유 없을 때만 무거운 것) · 지우는 길은 $HOME · $TMPROOT 안만 · sudo 없음 · 문서 731 제안 패치(kits-keep 표시 그대로) · 판 v10.589',
   bool(DC) and '--auto' in DC and '--apply' in DC and 'PRESSURE_PCT' in DC and 'TMPROOT' in DC and 'sudo ' not in DC.replace('sudo 가 필요', '')
   and all('"$HOME"/*|"$TMPROOT"/*' in l for l in rmlines) and 'bash "$DC" --auto' in D and 'kits-keep-begin' in D and VT >= (10, 589),
   f"{VER} 도구 {'있음' if DC else '킷에 없음'} rm 줄 {len(rmlines)}")
bn = subprocess.run(['bash', '-n', DC_P], capture_output=True).returncode if DC else 1
ok('① 도구 문법 — bash -n', bn == 0, str(bn))

if DC:
    T = tempfile.mkdtemp(prefix='t1589_')
    try:
        H = os.path.join(T, 'home'); TM = os.path.join(T, 'tmp'); B = os.path.join(T, 'bin')
        for d in (H + '/check-results', H + '/kits/out', H + '/kits/release', H + '/kits/ops', TM, B):
            os.makedirs(d, exist_ok=True)
        now = time.time()
        for i in range(1, 24):
            p = os.path.join(H, 'check-results', f'r{i:02d}')
            os.makedirs(p); os.utime(p, (now - i * 86400, now - i * 86400))
        for v in ('10_500', '10_510', '10_520', '10_530'):
            for ext in ('zip', 'tar.gz'):
                open(os.path.join(H, 'kits/out', f'SGB_DevDocker_Integrated_20261002_v{v}.{ext}'), 'w').close()
        for v in ('10_331', '10_456', '10_558'):
            open(os.path.join(H, 'kits/ops', f'SGB_DevDocker_Integrated_20261002_v{v}.zip'), 'w').close()
        old = os.path.join(H, 'kits', 'reh100_diff.txt'); open(old, 'w').close(); os.utime(old, (now - 40 * 86400, now - 40 * 86400))
        junk = os.path.join(TM, 'migreh_abc'); os.makedirs(junk); os.utime(junk, (now - 3 * 86400, now - 3 * 86400))
        keep_tmp = os.path.join(TM, 'other_keep'); os.makedirs(keep_tmp); os.utime(keep_tmp, (now - 3 * 86400, now - 3 * 86400))
        with open(os.path.join(B, 'docker'), 'w') as f:
            f.write('#!/bin/sh\nexit 1\n')   # 도커는 붙지 않음 — 도커 항목 건너뜀(서버 도커를 건드리지 않음)
        os.chmod(os.path.join(B, 'docker'), 0o755)
        env = dict(os.environ, HOME=H, TMPROOT=TM, PATH=B + ':' + os.environ.get('PATH', ''), PRESSURE_PCT='101')
        r1 = subprocess.run(['bash', DC_P], capture_output=True, text=True, env=env, timeout=120)
        n_res1 = len([x for x in os.listdir(H + '/check-results') if x.startswith('r')])
        n_out1 = len(os.listdir(H + '/kits/out'))
        r2 = subprocess.run(['bash', DC_P, '--auto'], capture_output=True, text=True, env=env, timeout=120)
        n_res2 = len([x for x in os.listdir(H + '/check-results') if x.startswith('r')])
        outs = sorted(os.listdir(H + '/kits/out')); ops = sorted(os.listdir(H + '/kits/ops'))
        ok('② 읽기만 — 아무것도 안 지움 · 마지막 줄 · 도커 건너뜀',
           r1.returncode == 0 and n_res1 == 23 and n_out1 == 8 and '== 디스크 정리 뒤 사용' in r1.stdout and '도커 안 붙음' in r1.stdout, f"rc={r1.returncode} {n_res1} {n_out1}")
        ok('② --auto — 점검 결과 19개 · 킷 out 3판(6파일 · v10_500 지움) · ops 2판(v10_331 지움) · 30일 넘은 차이 파일 · 내 리허설 찌꺼기 지움 · 다른 /tmp 폴더는 남김',
           r2.returncode == 0 and n_res2 == 19 and len(outs) == 6 and not any('v10_500' in x for x in outs) and ops == ['SGB_DevDocker_Integrated_20261002_v10_456.zip', 'SGB_DevDocker_Integrated_20261002_v10_558.zip']
           and not os.path.exists(old) and not os.path.exists(junk) and os.path.exists(keep_tmp),
           f"rc={r2.returncode} {n_res2} {len(outs)} {ops} {os.path.exists(old)} {os.path.exists(junk)} {os.path.exists(keep_tmp)} {r2.stdout[-160:]!r}")
    finally:
        shutil.rmtree(T, ignore_errors=True)


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
