"""v10.458 (D262 · docs/596) 법정 의무교육 — 종류(일반 원칙 값 · SUPER 고침) · 직원별 이수 · 증빙 · 확인 · 기한 알림
  ① (코드) D262 종류 · 이수 표 · 가드 · 증빙 파일 지우기 막음 · 설정 · 정기 작업 · API · 화면 · 메뉴 · 문서 596
  ② (API · DB) 제출(증빙) · 집합 등록(본인 줄 제출) · 본인 확인 403 · 확인 · 무효 · DB 막음 · 종류 고치기(SUPER) · 주기 409 · 정기 작업 OVERDUE(종류 만든 날 뒤 기간만) · DUE
  ③ (화면) 회계 › 인사 › 의무교육
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


TR = rd('src/modules/acct/hr-training.ts')
KC = f"TST1458_{stamp}"


def cleanup():
    ids = ','.join(EMPS) or '0'
    psql("SET session_replication_role = replica; "
         f"DELETE FROM hr_training_records WHERE employee_id IN ({ids}) OR kind_code = '{KC}'; "
         f"DELETE FROM hr_training_kinds WHERE code = '{KC}'; "
         f"DELETE FROM ops_alerts WHERE alert_code IN ('HR_TRAINING_DUE', 'HR_TRAINING_OVERDUE') AND raised_at >= '{T0}'::timestamptz;")
    files_cleanup(); emps_cleanup()


ok('① 코드 — D262 의무교육 종류 · 이수 표 · 가드 · 증빙 파일 지우기 막음 · 설정 hr.training_due_days · 정기 작업 hr_training_due · API · 화면 HrTraining · 메뉴 · 화면 ID · 문서 596 · 판 v10.458',
   'CREATE TABLE IF NOT EXISTS public.hr_training_kinds' in M62 and 'CREATE TABLE IF NOT EXISTS public.hr_training_records' in M62 and "'SEXUAL_HARASSMENT'" in M62 and "'SAFETY'" in M62
   and 'HR_TRAINING_STATE' in M62 and 'trg_hr_files_guard' in M62 and "'CORP_DOC','HR_DOC']" in M62 and "IF f.purpose = 'HR_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER'])" in M62 and "'hr.training_due_days'" in M62 and "'hr_training_due'" in M62 and "('hr-training', '법정 의무교육'" in M62
   and 'export async function trainingDueJob' in TR and 'HR_TRAINING_OVERDUE' in TR and "@Get('hr/training')" in HPC and "@Put('hr/training/kinds/:code')" in HPC and "@Post('me/hr/training')" in HPC
   and 'HrPeopleController' in AM and "case 'hr_training_due'" in SC and "'hr_training_due'" in WK
   and 'export function HrTraining' in UI3 and 'export function MyHrMore' in UI3 and "['hr-training', '의무교육']" in MN and '<HrTraining />' in AP
   and '"SB-ADM-HRE-010"' in SJ and '의무교육' in doc('596_') and VT >= (10, 458), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ee, eid, TE = staff('1458e', 'REVIEWER')
    ae, aid, TA = staff('1458a', 'ADMIN')
    pe, pid, TP = staff('1458p', 'PAYOUT')
    re_, rid, TR = staff('1458r', 'REVIEWER')
    d0 = getset('hr.training_due_days')
    try:
        e1 = emp('1458a', eid); e2 = emp('1458b', aid); e3 = emp('1458c', None, 400)
        kl = call('GET', '/admin/hr/training/kinds', None, TS)
        codes = [k.get('code') for k in kl.get('items', [])]
        bd = call('GET', '/admin/hr/training', None, TS)
        sh = next((b for b in bd.get('boards', []) if b.get('kind') == 'SEXUAL_HARASSMENT'), {})
        f1 = upload(TE, 'edu1458.pdf', 'HR_DOC')
        nof = call('POST', '/admin/me/hr/training', {'kind': 'SEXUAL_HARASSMENT', 'doneOn': today, 'hours': 1}, TE)
        sub = call('POST', '/admin/me/hr/training', {'kind': 'SEXUAL_HARASSMENT', 'doneOn': today, 'hours': 1, 'fileId': f1, 'provider': '시험 1458'}, TE)
        fut = call('POST', '/admin/me/hr/training', {'kind': 'SEXUAL_HARASSMENT', 'doneOn': (kst + datetime.timedelta(days=3)).strftime('%Y-%m-%d'), 'hours': 1, 'fileId': f1}, TE)
        e403, b403 = call('GET', '/admin/hr/training', None, TE), call('GET', '/admin/hr/training', None, TB)
        bulk = call('POST', '/admin/hr/training/records', {'employeeIds': [e1, e2], 'kind': 'PRIVACY', 'doneOn': today, 'hours': 1, 'method': 'CLASS', 'note': '시험 1458 집합'}, TA)
        r_e2 = psql(f"SELECT id || '|' || state FROM hr_training_records WHERE employee_id = {e2} AND kind_code = 'PRIVACY' ORDER BY id DESC LIMIT 1").split('|')
        self_ = call('POST', f"/admin/hr/training/records/{r_e2[0]}/decide", {'decision': 'CONFIRM'}, TA)
        ok_e2 = call('POST', f"/admin/hr/training/records/{r_e2[0]}/decide", {'decision': 'CONFIRM'}, TS)
        rj0 = call('POST', f"/admin/hr/training/records/{sub.get('id')}/decide", {'decision': 'REJECT'}, TS)
        cf = call('POST', f"/admin/hr/training/records/{sub.get('id')}/decide", {'decision': 'CONFIRM'}, TS)
        cf2 = call('POST', f"/admin/hr/training/records/{sub.get('id')}/decide", {'decision': 'CONFIRM'}, TS)
        fdel = psql(f"UPDATE files SET status = 'DELETED' WHERE id = '{f1}'")
        gd = psql(f"UPDATE hr_training_records SET hours = 2 WHERE id = {int(sub.get('id') or 0)}")
        gx = psql(f"DELETE FROM hr_training_records WHERE id = {int(sub.get('id') or 0)}")
        bd2 = call('GET', '/admin/hr/training', None, TS)
        sh2 = next((b for b in bd2.get('boards', []) if b.get('kind') == 'SEXUAL_HARASSMENT'), {})
        row1 = next((r for r in sh2.get('rows', []) if r.get('employeeId') == e1), {})
        mine = call('GET', '/admin/me/hr/more', None, TE)
        my_sh = next((x for x in (mine.get('training') or {}).get('items', []) if x.get('kind') == 'SEXUAL_HARASSMENT'), {})
        vd = call('POST', f"/admin/hr/training/records/{sub.get('id')}/void", {'reason': '시험 1458 무효'}, TS)
        fo_own, fo_adm, fo_sup = call('GET', f'/files/{f1}', None, TE), call('GET', f'/files/{f1}', None, TA), call('GET', f'/files/{f1}', None, TS)
        fo_pay, fo_rev = call('GET', f'/files/{f1}', None, TP), call('GET', f'/files/{f1}', None, TR)
        fpur = psql(f"SELECT purpose FROM files WHERE id = '{f1}'")
        ok('② 인사 서류 HR_DOC 열람 — 본인(올린 직원) · 운영 관리자 · SUPER 엶 · 지급 담당 · 다른 검수 담당 404',
           fpur == 'HR_DOC' and bool(fo_own.get('url')) and bool(fo_adm.get('url')) and bool(fo_sup.get('url')) and fo_pay.get('_err') == 404 and fo_rev.get('_err') == 404,
           f"{fpur} {bool(fo_own.get('url'))} {bool(fo_adm.get('url'))} {bool(fo_sup.get('url'))} {fo_pay.get('_err')} {fo_rev.get('_err')}")
        ok('② 의무교육 — 종류 4 · 현황 · 증빙 없는 제출 400 · 제출 · 앞날 422 · 담당 · 회원 403 · 집합 등록(본인 줄 제출) · 본인 확인 403 · 다른 관리자 확인 · 돌려보냄 사유 422 · 확인 · 두 번 409 · 붙은 증빙 지우기 막음 · DB 고치기 · 지우기 막음 · 이수 표시 · 내 인사 · 무효',
           all(c in codes for c in ('SEXUAL_HARASSMENT', 'PRIVACY', 'DISABILITY_AWARENESS', 'SAFETY')) and sh.get('total', 0) >= 2 and nof.get('_err') == 400
           and sub.get('ok') is True and fut.get('code') == 'TRAINING_DATE' and e403.get('_err') == 403 and b403.get('_err') == 403
           and bulk.get('confirmed') == 1 and bulk.get('submitted') == 1 and r_e2[-1] == 'SUBMITTED' and self_.get('code') == 'HR_SELF' and ok_e2.get('state') == 'CONFIRMED'
           and rj0.get('code') == 'TRAINING_REASON' and cf.get('state') == 'CONFIRMED' and cf2.get('code') == 'TRAINING_STATE'
           and 'FILE:' in fdel and 'HR_TRAINING' in gd and 'HR_TRAINING' in gx and row1.get('done') is True and my_sh.get('done') is True and vd.get('state') == 'VOID',
           f"{codes} {sh.get('total')} {nof.get('_err')} {sub.get('ok') or sub.get('code')} {fut.get('code')} {e403.get('_err')} {b403.get('_err')} {bulk.get('confirmed')}/{bulk.get('submitted')} {r_e2} {self_.get('code')} "
           f"{ok_e2.get('state')} {rj0.get('code')} {cf.get('state')} {cf2.get('code')} {fdel[-40:]} {gd[-30:]} {gx[-30:]} {row1.get('done')} {my_sh.get('done')} {vd.get('state') or vd.get('code')}")

        mk = call('PUT', f"/admin/hr/training/kinds/{KC}", {'name': '시험 1458 교육', 'cycleMonths': 12, 'minHours': 2, 'active': True}, TS)
        mka = call('PUT', f"/admin/hr/training/kinds/{KC}", {'minHours': 3}, TA)
        mk2 = call('PUT', f"/admin/hr/training/kinds/{KC}", {'minHours': 1.5}, TS)
        rec = call('POST', '/admin/hr/training/records', {'employeeIds': [e1], 'kind': KC, 'doneOn': today, 'hours': 1}, TS)
        cyc = call('PUT', f"/admin/hr/training/kinds/{KC}", {'cycleMonths': 6}, TS)
        mh = psql(f"SELECT min_hours FROM hr_training_kinds WHERE code = '{KC}'")
        kca = psql(f"UPDATE hr_training_kinds SET created_at = created_at - interval '1 day' WHERE code = '{KC}'")
        ok('② 종류 고치기 — SUPER 새 종류 · 관리자 403 · 최소 시간 고침 · 이수 있으면 주기 409 · 만든 시각 못 고침',
           mk.get('created') is True and mka.get('_err') == 403 and mk2.get('ok') is True and mh in ('1.5',) and rec.get('confirmed') == 1 and cyc.get('code') == 'TRAINING_KIND_USED' and 'HR_TRAINING_KIND' in kca,
           f"{mk.get('created') or mk.get('code')} {mka.get('_err')} {mk2.get('ok')} {mh} {rec.get('confirmed') or rec.get('code')} {cyc.get('code')} {kca[-30:]}")

        y = int(today[:4])
        left = (datetime.date(y, 12, 31) - datetime.date(y, int(today[5:7]), int(today[8:10]))).days
        if left < 179: setting('hr.training_due_days', str(max(1, left + 1)), '1458')
        jb0 = call('POST', '/admin/jobs', {'job': 'hr_training_due'}, TS)
        od0 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'HR_TRAINING_OVERDUE' AND detail->>'kind' = '{KC}'")
        psql(f"SET session_replication_role = replica; UPDATE hr_training_kinds SET created_at = now() - interval '800 days' WHERE code = '{KC}';")
        jb = call('POST', '/admin/jobs', {'job': 'hr_training_due'}, TS)
        od = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'HR_TRAINING_OVERDUE' AND resolved_at IS NULL AND severity = 'CRITICAL' AND detail->>'kind' = '{KC}' AND detail->>'period' = '{y - 1}'")
        du = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'HR_TRAINING_DUE' AND resolved_at IS NULL AND detail->>'kind' = 'SEXUAL_HARASSMENT' AND detail->>'period' = '{y}'")
        jb2 = call('POST', '/admin/jobs', {'job': 'hr_training_due'}, TS)
        dup = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'HR_TRAINING_OVERDUE' AND detail->>'kind' = '{KC}' AND detail->>'period' = '{y - 1}'")
        off = call('PUT', f"/admin/hr/training/kinds/{KC}", {'active': False}, TS)
        ok('② 기한 알림 — 종류 만든 날 전에 끝난 기간은 OVERDUE 없음 · 만든 날을 앞당기면 지난해 미이수(400일 전 입사 직원) OVERDUE(급함) · 기한 안이면 DUE · 두 번 돌려도 한 번 · 쓰지 않음',
           jb0.get('job') == 'hr_training_due' and od0 == '0' and jb.get('job') == 'hr_training_due' and od == '1' and (left >= 179 or du not in ('', '0'))
           and jb2.get('job') == 'hr_training_due' and dup == '1' and off.get('ok') is True,
           f"{jb0.get('job') or jb0} {od0} {jb.get('job') or jb} {od} {du} left={left} {dup} {off.get('ok')}")
    finally:
        cleanup(); setting('hr.training_due_days', d0 or '30', '1458 되돌림'); rm_role(eid, '1458'); rm_role(aid, '1458'); rm_role(pid, '1458'); rm_role(rid, '1458')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-hr-training]', timeout=30000)
            seen['boards'] = pg.locator('[data-hr-boards]').count()
            seen['add'] = pg.locator('[data-hr-train-add]').count()
        res = admin_page('/#/hr-training', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 인사 › 의무교육 표 · 등록 상자 · 화면 오류 없음', seen.get('boards') == 1 and seen.get('add') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
