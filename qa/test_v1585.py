"""v10.585 (docs/727) 14차 운영 ① DB 복원 반자동 리허설 — 기존 「DB 복원 시험 기록」(D238)에 스크립트 결과
  ① (코드) ops2DrillAdd · 두 주소 · 업무 안내 상자 · deploy/aws/restore-drill.sh(--run · --compare · 운영 DB 막음) · infra 리허설 도구 · 칸 source · detail · 문서 727 · bash -n
  ② (DB · API) 칸 · 검사 · 설정 · 업무 안내 판 · 권한 주소 · 넣기 · 409 · 서버가 다시 셈 · compare 422 · 400 · ADMIN 403 · 스크립트 --compare(이 DB 를 두 주소로 · 읽기만)
  ③ (화면) 업무 안내 상자
  (두 번 돌아도 통과 — rds:test1585- 줄은 시작 · 끝에 replica 로 지움 · 만든 직원 역할은 거둠 · 적으면 RESTORE_DRILL_DUE 알림이 풀림(다음 정기 작업이 다시 냄))
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
def allmig():
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return ''
    return '\n'.join(open(os.path.join(d, x, 'migration.sql'), encoding='utf-8').read() for x in sorted(os.listdir(d)) if os.path.exists(os.path.join(d, x, 'migration.sql')))


def kit(rel):
    p = os.path.join(KIT, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


MIG = allmig()
DR = rd('src/modules/ops2/drill.ts')
CT = rd('src/modules/ops2/ops2.controller.ts')
SH = rd('deploy/aws/restore-drill.sh')
RH = kit('tools/restore-drill-rehearse.sh')
UI = rd('web/src/app/admin/Ops2Drill.tsx')
OG = rd('web/src/app/admin/OpsGuide.tsx')
AM = rd('src/app.module.ts')
ok('① 코드 — 복원 시험 결과 넣기(ops2DrillAdd · 서버가 행 수 다시 셈 · compare 422 · 같은 날 · 스냅샷 409) · 컨트롤러 두 주소(SUPER) · 업무 안내 상자 · 스크립트 · 리허설 도구 · D238 칸 source · detail · 문서 727 · 판',
   'export async function ops2DrillAdd' in DR and 'ops2RowOk' in DR and "'OPS2_DRILL_MODE'" in DR and "'OPS2_DRILL_DUP'" in DR and "created_by, source, detail" in DR
   and "@Post('restore-drills/result')" in CT and "@Get('restore-drills/script')" in CT and 'Ops2Controller' in AM and 'Ops2PublicController' in AM
   and '<Ops2DrillPaste />' in OG and "tokenRoles().includes('SUPER')" in UI
   and '--compare' in SH and '--run' in SH and '운영 DB 와 같습니다' in SH and 'sgb-drill-' in SH and 'default_transaction_read_only=on' in SH
   and (not RH or ('restore-drill.sh" --compare' in RH and 'pg_restore' in RH))
   and 'ck_restore_drills_source' in MIG and "position('restore-drill.sh' in steps::text)" in MIG and 'ops2.drill_tol_pct' in MIG
   and 'restore-drill.sh' in doc('727_') and VT >= (10, 585), f"{VER} 리허설 도구 {'있음' if RH else '킷에 없음(infra)'}")
# 스크립트 문법(bash -n) — 킷 안 스크립트 두 개
bn = [subprocess.run(['bash', '-n', os.path.join(K, 'deploy/aws/restore-drill.sh')], capture_output=True).returncode]
if RH:
    bn.append(subprocess.run(['bash', '-n', os.path.join(KIT, 'tools/restore-drill-rehearse.sh')], capture_output=True).returncode)
ok('① 스크립트 문법 — restore-drill.sh · restore-drill-rehearse.sh bash -n', all(x == 0 for x in bn), str(bn))

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    SNAP = f'rds:test1585-{STAMP}'
    CLEAN = "SET session_replication_role = replica; DELETE FROM restore_drills WHERE snapshot LIKE 'rds:test1585-%';"
    psql(CLEAN)
    staff = None
    try:
        cols = psql("SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'restore_drills' AND column_name IN ('source', 'detail')")
        ck = psql("SELECT count(*) FROM pg_constraint WHERE conname IN ('ck_restore_drills_source', 'ck_restore_drills_detail')")
        tol = getset('ops2.drill_tol_pct')
        gd = psql("SELECT count(*) FROM ops_guides WHERE code = 'RESTORE_DRILL' AND position('restore-drill.sh' in steps::text) > 0")
        pm = psql("SELECT count(*) FROM perm_route_map WHERE pattern IN ('/admin/ops2/restore-drills/script', '/admin/ops2/restore-drills/result') AND task_key = 'ops-guide'")
        bad_src = psql("INSERT INTO restore_drills (drill_date, snapshot, minutes, rows_match, ok, source) VALUES (current_date, 'rds:test1585-x', 1, true, true, 'ROBOT')")
        ok('② DB — restore_drills 칸 source · detail · 검사 2 · 설정 ops2.drill_tol_pct · 업무 안내 스크립트 판 · 권한 주소 2 · 모르는 source 막음',
           cols == 'detail,source' and ck == '2' and tol.isdigit() and gd == '1' and pm == '2' and 'ck_restore_drills_source' in bad_src,
           f"{cols} {ck} {tol} {gd} {pm} {bad_src[-50:]}")
        today = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')")
        body = {'tool': 'restore-drill.sh test', 'mode': 'aws', 'drillDate': today, 'snapshot': SNAP, 'minutes': 17, 'rowsMatch': True, 'ok': True,
                'note': '시험 1585', 'tables': [{'name': 'accounts', 'src': 1000, 'drill': 990}, {'name': 'audit.audit_logs', 'src': 50000, 'drill': 48000}]}
        v0 = call('GET', '/admin/ops2/restore-drills/script', None, TS)
        r1 = call('POST', '/admin/ops2/restore-drills/result', body, TS)
        r2 = call('POST', '/admin/ops2/restore-drills/result', body, TS)
        r3 = call('POST', '/admin/ops2/restore-drills/result', {**body, 'snapshot': SNAP + '-more', 'tables': [{'name': 'accounts', 'src': 10, 'drill': 11}]}, TS)
        r4 = call('POST', '/admin/ops2/restore-drills/result', {**body, 'snapshot': SNAP + '-cmp', 'mode': 'compare'}, TS)
        r5 = call('POST', '/admin/ops2/restore-drills/result', {**body, 'snapshot': SNAP + '-bad', 'tables': [{'name': 'Accounts;drop', 'src': 1, 'drill': 1}]}, TS)
        r6 = call('POST', '/admin/ops2/restore-drills/result', {**body, 'snapshot': SNAP + '-dup', 'tables': [{'name': 'accounts', 'src': 1, 'drill': 1}, {'name': 'accounts', 'src': 1, 'drill': 1}]}, TS)
        row = psql(f"SELECT source || '|' || rows_match || '|' || ok || '|' || (detail->'tables'->0->>'name') || '|' || (detail->>'mode') FROM restore_drills WHERE snapshot = '{SNAP}'")
        row3 = psql(f"SELECT rows_match || '|' || ok || '|' || coalesce(note, '') FROM restore_drills WHERE snapshot = '{SNAP}-more'")
        v1 = call('GET', '/admin/ops2/restore-drills/script', None, TS)
        ok('② API — 보기(canEdit) · 넣기 맞음 · 같은 날 · 스냅샷 409 · 복원이 많으면 서버가 다름으로 · compare 422 · 이상한 표 이름 400 · 같은 표 두 번 422',
           isinstance(v0.get('rows'), list) and v0.get('canEdit') is True and r1.get('ok') is True and r1.get('rowsMatch') is True
           and r2.get('_err') == 409 and r2.get('code') == 'OPS2_DRILL_DUP' and r3.get('ok') is True and r3.get('rowsMatch') is False
           and r4.get('_err') == 422 and r4.get('code') == 'OPS2_DRILL_MODE' and r5.get('_err') == 400 and r6.get('_err') == 422
           and row == 'SCRIPT|true|true|accounts|aws' and row3.startswith('false|false|') and '서버가 다시 셈' in row3
           and any(x.get('snapshot') == SNAP for x in v1.get('rows') or []),
           f"{r1} {r2.get('code')} {r3.get('rowsMatch')} {r4.get('code')} {r5.get('_err')} {r6.get('code')} {row} {row3[:40]}")
        em, aid = mk_staff('1585', 'ADMIN')
        staff = aid
        tA = login(em)
        f1 = call('POST', '/admin/ops2/restore-drills/result', {**body, 'snapshot': SNAP + '-adm'}, tA)
        f2 = call('GET', '/admin/ops2/restore-drills/script', None, tA)
        ok('② 권한 — 운영(ADMIN)은 넣기 · 보기 403(SUPER 만)', f1.get('_err') == 403 and f2.get('_err') == 403, f"{f1.get('_err')} {f2.get('_err')}")
        # 스크립트 견주기(리허설) — 같은 DB 를 두 주소로(물음표 뒤만 다름) · JSON 을 서버에 넣으면 compare 라 422
        env = dict(os.environ, DATA_DIR=f'/tmp/t1585_{STAMP}')
        cp = subprocess.run(['bash', os.path.join(K, 'deploy/aws/restore-drill.sh'), '--compare', DB, DB + ('&' if '?' in DB else '?') + 'application_name=t1585'],
                            capture_output=True, text=True, env=env, timeout=120)
        js = None
        m = re.search(r'=== 붙여 넣을 결과[^\n]*\n(\{.*\})\n', cp.stdout)
        if m:
            try:
                js = json.loads(m.group(1))
            except Exception:
                js = None
        r7 = call('POST', '/admin/ops2/restore-drills/result', js, TS) if js else {}
        subprocess.run(['rm', '-rf', f'/tmp/t1585_{STAMP}'])
        ok('② 스크립트 --compare — 같은 DB 두 주소 맞음(0) · JSON 표 4개 이상 · 서버에 넣으면 compare 422',
           cp.returncode == 0 and js is not None and js.get('mode') == 'compare' and len(js.get('tables') or []) >= 4 and r7.get('code') == 'OPS2_DRILL_MODE',
           f"rc={cp.returncode} {len((js or {}).get('tables') or [])} {r7.get('code')} {cp.stdout[-120:]!r}")
    finally:
        psql(CLEAN)
        if staff:
            rm_role(staff, '1585')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['box'] = pg.locator('[data-ops2-drill]').count()
        seen['form'] = pg.locator('[data-ops2-drill-form]').count()
    s = admin_page('/#/ops-guide', chk)
    if s is not None:
        seen, perr = s
        ok('③ 화면 — 업무 안내에 「스크립트 결과 붙여 넣기」 상자 · 칸(SUPER) · 화면 오류 없음', seen.get('box', 0) >= 1 and seen.get('form', 0) >= 1 and not perr, f"{seen} {perr[:2]}")


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
