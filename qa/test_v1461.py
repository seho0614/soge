"""v10.461 (D262 · docs/599) 채용 — 공고 · 지원자(최소 개인정보) · 면접 · 합격 → 직원 대장 · 불합격 서류 자동 파기(보관 기간 · 정기 작업 · 기록 · 감사)
  ① (코드) D262 공고 · 지원자 · 면접 · 파기 기록 표 · 가드 · 보관 기간 설정 · 정기 작업 · API · 화면 · 문서 599
  ② (API · DB) 지원 · 서류 · 연락처 가림 · 면접 · 단계 · 합격 → 직원 대장 · 불합격 파기 예정일 · 정기 작업 파기 · 지금 파기 · 파기 기록 · 감사 기록 · DB 막음
  ③ (화면) 회계 › 인사 › 채용
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


RQ = rd('src/modules/acct/hr-recruit.ts')
POSTS = []


def cleanup():
    ps = ','.join(POSTS) or '0'
    hired = psql(f"SELECT coalesce(string_agg(employee_id::text, ','), '') FROM hr_applicants WHERE posting_id IN ({ps}) AND employee_id IS NOT NULL")
    for h in [x for x in hired.split(',') if x.isdigit()]:
        if h not in EMPS: EMPS.append(h)
    psql("SET session_replication_role = replica; "
         f"DELETE FROM hr_applicant_purges WHERE posting_id IN ({ps}); "
         f"DELETE FROM hr_interviews WHERE applicant_id IN (SELECT id FROM hr_applicants WHERE posting_id IN ({ps})); "
         f"DELETE FROM hr_applicants WHERE posting_id IN ({ps}); DELETE FROM hr_job_postings WHERE id IN ({ps});")
    files_cleanup(); emps_cleanup()


ok('① 코드 — D262 공고 · 지원자 · 면접 · 파기 기록 표 · 가드(앞으로만 · 파기 뒤 못 고침 · 지우기 막음) · 보관 기간 hr.applicant_retention_days · 정기 작업 hr_applicant_purge · 감사 HR_APPLICANT_PURGE · 합격 → 직원 대장 · 메일 무늬 = DB CHECK · API · 화면 · 문서 599 · 판 v10.461',
   'CREATE TABLE IF NOT EXISTS public.hr_job_postings' in M62 and 'CREATE TABLE IF NOT EXISTS public.hr_applicants' in M62 and 'CREATE TABLE IF NOT EXISTS public.hr_interviews' in M62
   and 'CREATE TABLE IF NOT EXISTS public.hr_applicant_purges' in M62 and 'HR_APPLICANT_PURGED' in M62 and "'hr.applicant_retention_days'" in M62 and "'hr_applicant_purge'" in M62
   and "phone ~ '^[0-9]{9,11}$'" in M62 and 'APPLICANT_PHONE_RE = /^[0-9]{9,11}$/' in RQ and 'export async function applicantPurgeJob' in RQ and "'HR_APPLICANT_PURGE'" in RQ and 'INSERT INTO acct_employees' in RQ
   and "case 'hr_applicant_purge'" in SC and "'hr_applicant_purge'" in WK and "@Post('hr/recruit/applicants/:id/hire')" in HPC and "@Post('hr/recruit/applicants/:id/purge')" in HPC
   and 'export function HrRecruit' in UI3 and "['hr-recruit', '채용']" in MN and '"SB-ADM-HRE-040"' in SJ and '파기' in doc('599_') and VT >= (10, 461), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ee, eid, TE = staff('1461e', 'REVIEWER')
    pe, pid, TP = staff('1461p', 'PAYOUT')
    r0 = getset('hr.applicant_retention_days')
    try:
        setting('hr.applicant_retention_days', '180', '1461')
        dp = call('POST', '/admin/hr/recruit/postings', {'title': f'시험 1461 초안 {stamp}', 'opensOn': today, 'closesOn': today}, TS)
        op = call('POST', '/admin/hr/recruit/postings', {'title': f'시험 1461 공고 {stamp}', 'dept': '운영', 'opensOn': today, 'closesOn': today, 'state': 'OPEN'}, TS)
        for x in (dp, op):
            if x.get('id'): POSTS.append(x['id'])
        e403 = call('GET', '/admin/hr/recruit', None, TE)
        f1, f2 = upload(TS, 'cv1461a.pdf', 'HR_DOC'), upload(TS, 'cv1461b.pdf', 'HR_DOC')
        ad0 = call('POST', '/admin/hr/recruit/applicants', {'postingId': dp.get('id'), 'name': '시험지원자', 'email': 'a1461@example.com'}, TS)
        nc = call('POST', '/admin/hr/recruit/applicants', {'postingId': op.get('id'), 'name': '시험지원자'}, TS)
        bp = call('POST', '/admin/hr/recruit/applicants', {'postingId': op.get('id'), 'name': '시험지원자', 'phone': '123'}, TS)
        a1 = call('POST', '/admin/hr/recruit/applicants', {'postingId': op.get('id'), 'name': f'시험합격{stamp}', 'email': 'a1461@example.com', 'fileIds': [f1]}, TS)
        re1 = call('POST', '/admin/hr/recruit/applicants', {'postingId': op.get('id'), 'name': '시험지원자', 'phone': '010-1234-5678', 'fileIds': [f1]}, TS)
        a2 = call('POST', '/admin/hr/recruit/applicants', {'postingId': op.get('id'), 'name': '시험불합격', 'phone': '010-1234-5678', 'fileIds': [f2], 'memo': '시험 1461'}, TS)
        a3 = call('POST', '/admin/hr/recruit/applicants', {'postingId': op.get('id'), 'name': '시험철회', 'email': 'w1461@example.com'}, TS)
        dt = call('GET', f"/admin/hr/recruit/postings/{op.get('id')}", None, TS)
        fo_own, fo_pay, fo_rev = call('GET', f'/files/{f1}', None, TS), call('GET', f'/files/{f1}', None, TP), call('GET', f'/files/{f1}', None, TE)
        fdel = call('DELETE', f'/files/{f1}', None, TS)
        ok('② 지원자 서류 HR_DOC — 올린 관리자 엶 · 지급 담당 · 검수 담당 404 · 붙은 서류는 지우기 막음',
           bool(fo_own.get('url')) and fo_pay.get('_err') == 404 and fo_rev.get('_err') == 404 and fdel.get('_err') in (409, 422, 500) and psql(f"SELECT status FROM files WHERE id = '{f1}'") == 'READY',
           f"{bool(fo_own.get('url'))} {fo_pay.get('_err')} {fo_rev.get('_err')} {fdel.get('_err')}")
        m1 = next((x for x in dt.get('applicants', []) if x.get('id') == a1.get('id')), {})
        iv = call('POST', f"/admin/hr/recruit/applicants/{a1.get('id')}/interviews", {'at': f"{today}T15:00:00+09:00", 'place': '시험 회의실', 'interviewers': '시험 면접관'}, TS)
        st1 = psql(f"SELECT stage FROM hr_applicants WHERE id = {int(a1.get('id') or 0)}")
        ivu = call('PUT', f"/admin/hr/recruit/interviews/{iv.get('id')}", {'result': 'PASS', 'note': '시험 메모'}, TS)
        back = call('POST', f"/admin/hr/recruit/applicants/{a1.get('id')}/stage", {'stage': 'SCREEN'}, TS)
        hr_ = call('POST', f"/admin/hr/recruit/applicants/{a1.get('id')}/hire", {'joinedOn': today, 'monthlyBase': 2500000}, TS)
        if str(hr_.get('employeeId') or '').isdigit(): EMPS.append(str(hr_['employeeId']))
        en = psql(f"SELECT name || '|' || monthly_base FROM acct_employees WHERE id = {int(hr_.get('employeeId') or 0)}")
        hr2 = call('POST', f"/admin/hr/recruit/applicants/{a1.get('id')}/hire", {'joinedOn': today}, TS)
        rj = call('POST', f"/admin/hr/recruit/applicants/{a2.get('id')}/stage", {'stage': 'REJECTED', 'note': '시험 1461 불합격'}, TS)
        due = (kst + datetime.timedelta(days=180)).strftime('%Y-%m-%d')
        ph = call('POST', f"/admin/hr/recruit/applicants/{a1.get('id')}/purge", None, TS)
        ok('② 채용 — 초안 공고 지원 409 · 연락처 없음 422 · 휴대폰 무늬 422 · 지원자(서류) · 같은 서류 다시 422 · 연락처 가림 · 면접 → 면접 단계 · 결과 · 뒤로 409 · 합격 → 직원 대장 · 두 번 409 · 불합격 파기 예정 180일 · 합격자 파기 409 · 담당 403',
           ad0.get('code') == 'RECRUIT_STATE' and nc.get('code') == 'RECRUIT_INPUT' and bp.get('code') == 'RECRUIT_INPUT' and a1.get('ok') is True and re1.get('code') == 'RECRUIT_FILE'
           and a2.get('ok') is True and '***' in (m1.get('email') or '') and iv.get('ok') is True and st1 == 'INTERVIEW' and ivu.get('ok') is True and back.get('code') == 'RECRUIT_STATE'
           and hr_.get('ok') is True and en == f'시험합격{stamp}|2500000' and hr2.get('code') == 'RECRUIT_STATE' and rj.get('purgeDueOn') == due and ph.get('code') == 'RECRUIT_STATE' and e403.get('_err') == 403,
           f"{ad0.get('code')} {nc.get('code')} {bp.get('code')} {a1.get('ok') or a1.get('code')} {re1.get('code')} {a2.get('ok')} {m1.get('email')} {iv.get('ok')} {st1} {ivu.get('ok')} {back.get('code')} "
           f"{hr_.get('ok') or hr_.get('code')} {en} {hr2.get('code')} {rj.get('purgeDueOn')}/{due} {ph.get('code')} {e403.get('_err')}")

        psql(f"UPDATE hr_applicants SET purge_due_on = current_date - 1 WHERE id = {int(a2.get('id') or 0)}")
        jb = call('POST', '/admin/jobs', {'job': 'hr_applicant_purge'}, TS)
        p2 = psql(f"SELECT name || '|' || coalesce(phone, '-') || '|' || coalesce(memo, '-') || '|' || cardinality(file_ids) || '|' || (purged_at IS NOT NULL) FROM hr_applicants WHERE id = {int(a2.get('id') or 0)}")
        fs = psql(f"SELECT status FROM files WHERE id = '{f2}'")
        lg = psql(f"SELECT reason || '|' || files FROM hr_applicant_purges WHERE applicant_id = {int(a2.get('id') or 0)}")
        au = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'HR_APPLICANT_PURGE' AND after_data->>'applicantId' = '{a2.get('id')}' AND occurred_at >= '{T0}'::timestamptz")
        wd = call('POST', f"/admin/hr/recruit/applicants/{a3.get('id')}/stage", {'stage': 'WITHDRAWN'}, TS)
        mp = call('POST', f"/admin/hr/recruit/applicants/{a3.get('id')}/purge", None, TS)
        mp2 = call('POST', f"/admin/hr/recruit/applicants/{a3.get('id')}/purge", None, TS)
        lg3 = psql(f"SELECT reason FROM hr_applicant_purges WHERE applicant_id = {int(a3.get('id') or 0)}")
        gu = psql(f"UPDATE hr_applicants SET memo = 'x' WHERE id = {int(a2.get('id') or 0)}")
        gx = psql(f"DELETE FROM hr_applicants WHERE id = {int(a3.get('id') or 0)}")
        glog = psql(f"DELETE FROM hr_applicant_purges WHERE applicant_id = {int(a3.get('id') or 0)}")
        ok('② 파기 — 정기 작업(예정일 지남) · 이름 (파기됨) · 연락처 · 메모 · 서류 비움 · 파일 DELETED · 파기 기록 RETENTION · 감사 기록 · 철회 지금 파기 MANUAL · 두 번 409 · 파기 뒤 고치기 · 지우기 · 기록 지우기 막음',
           jb.get('job') == 'hr_applicant_purge' and p2 == '(파기됨)|-|-|0|true' and fs == 'DELETED' and lg == 'RETENTION|1' and au == '1'
           and wd.get('stage') == 'WITHDRAWN' and mp.get('ok') is True and mp2.get('code') == 'RECRUIT_PURGED' and lg3 == 'MANUAL'
           and 'HR_APPLICANT_PURGED' in gu and 'HR_APPLICANT' in gx and '!' in glog,
           f"{jb.get('job') or jb} {p2} {fs} {lg} {au} {wd.get('stage')} {mp.get('ok') or mp.get('code')} {mp2.get('code')} {lg3} {gu[-30:]} {gx[-30:]} {glog[-30:]}")
    finally:
        cleanup(); setting('hr.applicant_retention_days', r0 or '180', '1461 되돌림'); rm_role(eid, '1461'); rm_role(pid, '1461')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-hr-recruit]', timeout=30000)
            seen['new'] = pg.locator('[data-hr-posting-new]').count()
        res = admin_page('/#/hr-recruit', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 인사 › 채용 새 공고 상자 · 화면 오류 없음', seen.get('new') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
