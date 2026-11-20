"""v10.460 (D262 · docs/598) 인사 평가 · 목표 — 분기 차례 · 목표(가중치 100) · 자기 평가 · 상사 평가(본인 아님) · 등급 · 본인 것만 보기
  ① (코드) D262 차례 · 목표 · 결과 표 · 가드 · 등급 기준 · 가중 평균 · API · 화면 · 문서 598
  ② (API · DB) 목표 · 평가 · 닫음 단계 · 단계마다 막힘 · 제출 뒤 못 고침 · 본인 평가 403 · 가중 평균 4.2 · 등급 A · 닫기 전 직원에게 안 보임 · 닫은 뒤 보임 · DB 막음
  ③ (화면) 회계 › 인사 › 인사 평가
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
FILES = []


def upload(tok, name, purpose):
    """POST /files → 올리기 → complete(시험 PDF) · 파일 번호는 FILES 에 모아 끝에 지움"""
    t = call('POST', '/files', {'purpose': purpose, 'name': name, 'contentType': 'application/pdf', 'size': len(PDF)}, tok)
    origin = API.rsplit('/api/v1', 1)[0]
    url = t.get('uploadUrl') or ''
    if url: raw(t.get('method') or 'PUT', (origin + url) if url.startswith('/') else url, PDF, (t.get('headers') or {}).get('Content-Type', 'application/pdf'))
    call('POST', f"/files/{t.get('fileId')}/complete", None, tok)
    if t.get('fileId'):
        FILES.append(t.get('fileId'))
    return t.get('fileId')


def files_cleanup():
    for f in FILES:
        psql(f"SET session_replication_role = replica; UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id = '{f}' AND status <> 'DELETED';")


M62 = migr('D262_')
HPC = rd('src/modules/acct/hr-people.controller.ts')
UI3, AP, MN, AM, SC, WK = rd('web/src/app/admin/HrPeople.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
T0 = psql("SELECT now()")
EMPS = []


def emp(tag, account_id=None, joined_days=60):
    j = (kst - datetime.timedelta(days=joined_days)).strftime('%Y-%m-%d')
    acc = f"'{account_id}'" if account_id else 'NULL'
    e = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, account_id) VALUES ('시험직원{tag}-{stamp}', '{j}', 3000000, {acc}) RETURNING id").split('\n')[0]
    if e.isdigit():
        EMPS.append(e)
    return e


def staff(tag, role):
    em, aid = mk_staff(tag, role)
    __import__('consent_ok').agree(em, PW)
    return em, aid, login(em)


def emp_name(e):
    return psql(f"SELECT name FROM acct_employees WHERE id = {int(e or 0)}")


def emps_cleanup():
    if EMPS:
        ids = ','.join(EMPS)
        psql(f"SET session_replication_role = replica; UPDATE acct_employees SET account_id = NULL WHERE id IN ({ids}); DELETE FROM acct_employees WHERE id IN ({ids});")


HV = rd('src/modules/acct/hr-review.ts')
CYC = []


def cleanup():
    ids = ','.join(EMPS) or '0'
    cs = ','.join(CYC) or '0'
    psql("SET session_replication_role = replica; "
         f"DELETE FROM hr_review_goals WHERE cycle_id IN ({cs}) OR employee_id IN ({ids}); "
         f"DELETE FROM hr_review_results WHERE cycle_id IN ({cs}) OR employee_id IN ({ids}); "
         f"DELETE FROM hr_review_cycles WHERE id IN ({cs});")
    emps_cleanup()


ok('① 코드 — D262 평가 차례 · 목표 · 결과 표 · 가드(단계마다 고칠 칸 · 닫으면 못 고침) · 등급 기준 hr.review_grade_cuts · 가중 평균 · 본인 평가 막음 · 상사 칸은 닫은 뒤 · API · 화면 · 문서 598 · 판 v10.460',
   'CREATE TABLE IF NOT EXISTS public.hr_review_cycles' in M62 and 'CREATE TABLE IF NOT EXISTS public.hr_review_goals' in M62 and 'CREATE TABLE IF NOT EXISTS public.hr_review_results' in M62
   and 'HR_REVIEW_CLOSED' in M62 and "'hr.review_grade_cuts'" in M62 and 'export function weighted' in HV and 'export function gradeFor' in HV and "'HR_SELF'" in HV
   and 'mgrScore: closed ? g.mgrScore : null' in HV and "@Put('me/hr/reviews/:cycleId/goals')" in HPC and "@Put('hr/reviews/:id/employees/:employeeId')" in HPC
   and 'export function HrReviews' in UI3 and "['hr-review', '인사 평가']" in MN and '"SB-ADM-HRE-030"' in SJ and '평가' in doc('598_') and VT >= (10, 460), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ee, eid, TE = staff('1460e', 'REVIEWER')
    ae, aid, TA = staff('1460a', 'ADMIN')
    g0 = getset('hr.review_grade_cuts')
    try:
        setting('hr.review_grade_cuts', 'S:4.5,A:3.5,B:2.5,C:1.5', '1460')
        e1 = emp('1460a', eid); e2 = emp('1460b', aid)
        used = psql("SELECT coalesce(string_agg(year || '-' || quarter, ','), '') FROM hr_review_cycles WHERE year BETWEEN 2060 AND 2099").split(',')
        yq = next(((y, q) for y in range(2060 + stamp % 30, 2100) for q in (1, 2, 3, 4) if f"{y}-{q}" not in used), (2099, 4))
        cc = call('POST', '/admin/hr/reviews', {'year': yq[0], 'quarter': yq[1], 'title': '시험 1460 평가'}, TS)
        if cc.get('id'): CYC.append(cc['id'])
        dup = call('POST', '/admin/hr/reviews', {'year': yq[0], 'quarter': yq[1]}, TS)
        cid = cc.get('id')
        w90 = call('PUT', f"/admin/me/hr/reviews/{cid}/goals", {'goals': [{'title': '시험 목표 하나', 'weight': 60}, {'title': '시험 목표 둘', 'weight': 30}]}, TE)
        gs = call('PUT', f"/admin/me/hr/reviews/{cid}/goals", {'goals': [{'title': '시험 목표 하나', 'measure': '숫자', 'weight': 60}, {'title': '시험 목표 둘', 'weight': 40}]}, TE)
        gids = psql(f"SELECT string_agg(id::text, ',' ORDER BY weight DESC) FROM hr_review_goals WHERE cycle_id = {int(cid or 0)} AND employee_id = {e1}").split(',')
        sg0 = call('POST', f"/admin/me/hr/reviews/{cid}/self", {'comment': '시험'}, TE)
        mg0 = call('PUT', f"/admin/hr/reviews/{cid}/employees/{e1}", {'grade': 'A'}, TS)
        e403, b403 = call('GET', '/admin/hr/reviews', None, TE), call('GET', '/admin/hr/reviews', None, TB)
        ad1 = call('POST', f"/admin/hr/reviews/{cid}/advance", None, TS)
        gs2 = call('PUT', f"/admin/me/hr/reviews/{cid}/goals", {'goals': [{'title': '시험 목표 새것', 'weight': 100}]}, TE)
        gw = psql(f"UPDATE hr_review_goals SET weight = 50 WHERE id = {int(gids[0] or 0)}")
        sp = call('POST', f"/admin/me/hr/reviews/{cid}/self", {'scores': [{'goalId': gids[0], 'score': 4}], 'submit': True}, TE)
        sv = call('POST', f"/admin/me/hr/reviews/{cid}/self", {'scores': [{'goalId': gids[0], 'score': 4}, {'goalId': gids[1], 'score': 3}], 'comment': '시험 1460 자기 평가', 'submit': True}, TE)
        sv2 = call('POST', f"/admin/me/hr/reviews/{cid}/self", {'comment': '고침'}, TE)
        slf = call('PUT', f"/admin/hr/reviews/{cid}/employees/{e2}", {'comment': '본인'}, TA)
        bs = call('PUT', f"/admin/hr/reviews/{cid}/employees/{e1}", {'scores': [{'goalId': gids[0], 'score': 6}]}, TA)
        mg = call('PUT', f"/admin/hr/reviews/{cid}/employees/{e1}", {'scores': [{'goalId': gids[0], 'score': 5}, {'goalId': gids[1], 'score': 3}], 'comment': '시험 1460 상사 의견', 'grade': 'A'}, TA)
        dt = call('GET', f"/admin/hr/reviews/{cid}", None, TS)
        p1 = next((p for p in dt.get('people', []) if p.get('employeeId') == e1), {})
        m1 = call('GET', '/admin/me/hr/more', None, TE)
        r1 = next((r for r in m1.get('reviews', []) if (r.get('cycle') or {}).get('id') == cid), {})
        ad2 = call('POST', f"/admin/hr/reviews/{cid}/advance", None, TS)
        ad3 = call('POST', f"/admin/hr/reviews/{cid}/advance", None, TS)
        m2 = call('GET', '/admin/me/hr/more', None, TE)
        r2 = next((r for r in m2.get('reviews', []) if (r.get('cycle') or {}).get('id') == cid), {})
        gc = psql(f"UPDATE hr_review_goals SET self_note = 'x' WHERE id = {int(gids[0] or 0)}")
        rc = psql(f"UPDATE hr_review_results SET grade = 'S' WHERE cycle_id = {int(cid or 0)} AND employee_id = {e1}")
        ok('② 평가 — 차례 · 같은 분기 409 · 가중치 합 422 · 목표 2 · 목표 단계 자기 · 상사 409 · 담당 · 회원 403 · 평가 단계로 · 목표 못 고침 409 · DB 가중치 막음 · 점수 빠진 제출 422 · 제출 · 두 번 409 · 본인 평가 403 · 점수 6 은 400 · 상사 점수 · 등급 · 가중 평균 4.2 · 제안 A · 닫기 전 직원에게 등급 안 보임 · 닫기 · 닫은 뒤 409 · 직원에게 보임 · 닫으면 DB 못 고침',
           cc.get('ok') is True and dup.get('code') == 'REVIEW_EXISTS' and w90.get('code') == 'REVIEW_WEIGHT' and gs.get('count') == 2 and len(gids) == 2
           and sg0.get('code') == 'REVIEW_STATE' and mg0.get('code') == 'REVIEW_STATE' and e403.get('_err') == 403 and b403.get('_err') == 403 and ad1.get('state') == 'REVIEW'
           and gs2.get('code') == 'REVIEW_STATE' and 'HR_REVIEW_STATE' in gw and sp.get('code') == 'REVIEW_SCORE' and sv.get('submitted') is True and sv2.get('code') == 'REVIEW_SUBMITTED'
           and slf.get('code') == 'HR_SELF' and bs.get('_err') == 400 and mg.get('ok') is True and mg.get('mgrAvg') == 4.2 and mg.get('suggested') == 'A' and (p1.get('result') or {}).get('grade') == 'A'
           and (r1.get('result') or {}).get('grade') is None and all(g.get('mgrScore') is None for g in r1.get('goals', [{}]))
           and ad2.get('state') == 'CLOSED' and ad3.get('code') == 'REVIEW_STATE' and (r2.get('result') or {}).get('grade') == 'A' and (r2.get('result') or {}).get('mgrAvg') == 4.2
           and 'HR_REVIEW_CLOSED' in gc and 'HR_REVIEW_CLOSED' in rc,
           f"{cc.get('ok') or cc.get('code')} {dup.get('code')} {w90.get('code')} {gs.get('count')} {gids} {sg0.get('code')} {mg0.get('code')} {e403.get('_err')} {b403.get('_err')} {ad1.get('state')} {gs2.get('code')} {gw[-30:]} "
           f"{sp.get('code')} {sv.get('submitted') or sv.get('code')} {sv2.get('code')} {slf.get('code')} {bs.get('_err')} {mg.get('mgrAvg')} {mg.get('suggested')} {(p1.get('result') or {}).get('grade')} "
           f"{(r1.get('result') or {}).get('grade')} {ad2.get('state')} {ad3.get('code')} {(r2.get('result') or {}).get('grade')} {gc[-30:]} {rc[-30:]}")
    finally:
        cleanup(); setting('hr.review_grade_cuts', g0 or 'S:4.5,A:3.5,B:2.5,C:1.5', '1460 되돌림'); rm_role(eid, '1460'); rm_role(aid, '1460')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-hr-reviews]', timeout=30000)
            seen['create'] = pg.locator('[data-hr-cycle-create]').count()
        res = admin_page('/#/hr-review', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 인사 › 인사 평가 차례 만들기 · 화면 오류 없음', seen.get('create') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
