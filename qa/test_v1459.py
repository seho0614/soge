"""v10.459 (D262 · docs/597) 근로계약서 전자서명 — 양식 · 초안(지문) · 보내기(간주 · 처음 꺼짐) · 본인 서명 · 서명본 · 기존 ESIGN 어댑터
  ① (코드) D262 양식 · 계약서 표 · 가드 · 스위치 hr.contract_esign · HttpESign · NOT_READY · API · 화면 · 문서 597
  ② (API · DB) 초안 · 보내기 간주 · 내 인사 서명(이름 · 동의 · 지문) · 서명본 못 고침 · 계정 연결 없음 422 · 양식 새 판 · 스위치 on = 전자계약 방식(STUB 일 때만 · 외부 호출 없음)
  ③ (화면) 회계 › 인사 › 근로계약서
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


HC = rd('src/modules/acct/hr-contract.ts')
TC = f"T1459X{stamp}"


def cleanup():
    ids = ','.join(EMPS) or '0'
    psql("SET session_replication_role = replica; "
         f"DELETE FROM hr_contracts WHERE employee_id IN ({ids}) OR template_id IN (SELECT id FROM hr_contract_templates WHERE code = '{TC}'); "
         f"DELETE FROM hr_contract_templates WHERE code = '{TC}';")
    emps_cleanup()


ok('① 코드 — D262 근로계약서 양식 · 계약서 표 · 가드 · 처음 양식 STANDARD · 스위치 hr.contract_esign(처음 off) · 기존 ESIGN 어댑터(HttpESign · EsignService.readMode) · NOT_READY · 본인 서명 · API · 화면 · 문서 597 · 판 v10.459',
   'CREATE TABLE IF NOT EXISTS public.hr_contract_templates' in M62 and 'CREATE TABLE IF NOT EXISTS public.hr_contracts' in M62 and "('STANDARD', 1," in M62
   and "VALUES ('hr.contract_esign', 'off'" in M62 and 'HR_CONTRACT_STATE' in M62
   and "from '../deal/esign.provider'" in HC and 'EsignService.readMode' in HC and "'NOT_READY'" in HC and 'HttpESign.missing()' in HC and 'new HttpESign().create' in HC
   and "@Post('me/hr/contracts/:id/sign')" in HPC and "@Post('hr/contracts/:id/send')" in HPC and "@Get('hr/contracts/templates')" in HPC
   and HPC.index("@Get('hr/contracts/templates')") < HPC.index("@Get('hr/contracts/:id')")
   and 'export function HrContracts' in UI3 and 'data-my-sign-go' in UI3 and "['hr-contract', '근로계약서']" in MN and '"SB-ADM-HRE-020"' in SJ and '근로계약서' in doc('597_') and VT >= (10, 459), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ee, eid, TE = staff('1459e', 'REVIEWER')
    pe, pid, TP = staff('1459p', 'PAYOUT')
    s0, p0 = getset('hr.contract_esign'), getset('esign.provider')
    try:
        setting('hr.contract_esign', 'off', '1459')
        e1 = emp('1459a', eid); e2 = emp('1459b', None); e3 = emp('1459c', pid)
        nm = emp_name(e1)
        tl = call('GET', '/admin/hr/contracts/templates', None, TS)
        std = next((t for t in tl.get('items', []) if t.get('code') == 'STANDARD' and t.get('active')), {})
        terms = {'company': '시험 회사', 'startOn': today, 'place': '본사', 'duties': '운영', 'workTime': '09:00 ~ 18:00', 'wageType': '월급', 'wage': '3,000,000', 'payDay': '25'}
        bad = call('POST', '/admin/hr/contracts', {'employeeId': e1, 'templateId': std.get('id'), 'terms': {**terms, 'wage': '삼백만'}}, TS)
        c1 = call('POST', '/admin/hr/contracts', {'employeeId': e1, 'templateId': std.get('id'), 'title': '시험 1459 계약', 'terms': terms}, TS)
        v1 = call('GET', f"/admin/hr/contracts/{c1.get('id')}", None, TS)
        e403, b403 = call('GET', '/admin/hr/contracts', None, TE), call('GET', '/admin/hr/contracts', None, TB)
        dr = call('GET', f"/admin/me/hr/contracts/{c1.get('id')}", None, TE)
        sd = call('POST', f"/admin/hr/contracts/{c1.get('id')}/send", None, TS)
        sd2 = call('POST', f"/admin/hr/contracts/{c1.get('id')}/send", None, TS)
        more = call('GET', '/admin/me/hr/more', None, TE)
        mc = next((c for c in more.get('contracts', []) if c.get('id') == c1.get('id')), {})
        mv = call('GET', f"/admin/me/hr/contracts/{c1.get('id')}", None, TE)
        sgw = call('POST', f"/admin/me/hr/contracts/{c1.get('id')}/sign", {'signerName': '다른이름', 'agree': True}, TE)
        sga = call('POST', f"/admin/me/hr/contracts/{c1.get('id')}/sign", {'signerName': nm, 'agree': False}, TE)
        sgh = call('POST', f"/admin/me/hr/contracts/{c1.get('id')}/sign", {'signerName': nm, 'agree': True, 'docHash': '0' * 64}, TE)
        sg = call('POST', f"/admin/me/hr/contracts/{c1.get('id')}/sign", {'signerName': nm, 'agree': True, 'docHash': mv.get('docHash')}, TE)
        sg2 = call('POST', f"/admin/me/hr/contracts/{c1.get('id')}/sign", {'signerName': nm, 'agree': True}, TE)
        po_adm, po_me, own = call('GET', f"/admin/hr/contracts/{c1.get('id')}", None, TP), call('GET', f"/admin/me/hr/contracts/{c1.get('id')}", None, TP), call('GET', f"/admin/me/hr/contracts/{c1.get('id')}", None, TE)
        ok('② 서명본 열람 — 본인 엶 · 지급 담당은 관리 화면 403 · 남의 계약서 404(서명본은 파일이 아니라 DB 본문)',
           own.get('state') == 'SIGNED' and po_adm.get('_err') == 403 and po_me.get('_err') == 404, f"{own.get('state')} {po_adm.get('_err')} {po_me.get('_err')}")
        st = psql(f"SELECT state || '|' || sign_mode || '|' || (sign_evidence->>'stub') FROM hr_contracts WHERE id = {int(c1.get('id') or 0)}")
        gb = psql(f"UPDATE hr_contracts SET body = body || 'x' WHERE id = {int(c1.get('id') or 0)}")
        gx = psql(f"DELETE FROM hr_contracts WHERE id = {int(c1.get('id') or 0)}")
        cxs = call('POST', f"/admin/hr/contracts/{c1.get('id')}/cancel", {'reason': '시험 1459'}, TS)
        ok('② 계약서 — 양식 STANDARD · 임금 글자 400 · 초안(본문에 이름 · 임금 · 지문) · 담당 · 회원 403 · 초안은 본인에게 404 · 보내기 간주 · 두 번 409 · 내 인사에 보임 · 이름 다름 422 · 동의 없음 422 · 지문 다름 409 · 서명 · 두 번 409 · 간주 표시 · DB 고치기 · 지우기 막음 · 서명본 취소 409',
           bool(std) and bad.get('_err') == 400 and c1.get('ok') is True and nm in (v1.get('body') or '') and '3,000,000' in (v1.get('body') or '') and len(v1.get('docHash') or '') == 64
           and e403.get('_err') == 403 and b403.get('_err') == 403 and dr.get('_err') == 404 and sd.get('signMode') == 'ASSUME' and sd.get('stub') is True and sd2.get('code') == 'CONTRACT_STATE'
           and mc.get('state') == 'SENT' and mv.get('state') == 'SENT' and sgw.get('code') == 'CONTRACT_SIGNER' and sga.get('code') == 'CONTRACT_AGREE' and sgh.get('code') == 'CONTRACT_HASH'
           and sg.get('state') == 'SIGNED' and sg2.get('code') == 'CONTRACT_STATE' and st == 'SIGNED|ASSUME|true' and 'HR_CONTRACT' in gb and 'HR_CONTRACT' in gx and cxs.get('code') == 'CONTRACT_STATE',
           f"{std.get('id')} {bad.get('_err')} {c1.get('ok') or c1.get('code')} {len(v1.get('docHash') or '')} {e403.get('_err')} {b403.get('_err')} {dr.get('_err')} {sd.get('signMode') or sd.get('code')} {sd2.get('code')} "
           f"{mc.get('state')} {sgw.get('code')} {sga.get('code')} {sgh.get('code')} {sg.get('state') or sg.get('code')} {sg2.get('code')} {st} {gb[-30:]} {gx[-30:]} {cxs.get('code')}")

        c2 = call('POST', '/admin/hr/contracts', {'employeeId': e2, 'templateId': std.get('id'), 'terms': terms}, TS)
        nl = call('POST', f"/admin/hr/contracts/{c2.get('id')}/send", None, TS)
        cx = call('POST', f"/admin/hr/contracts/{c2.get('id')}/cancel", {'reason': '시험 1459 취소'}, TS)
        t1 = call('POST', '/admin/hr/contracts/templates', {'code': TC, 'name': '시험 1459 양식', 'body': '시험 양식 본문 {{name}} 님 {{startOn}} 부터 일합니다. 임금 {{wage}}원.'}, TS)
        t2 = call('POST', '/admin/hr/contracts/templates', {'code': TC, 'name': '시험 1459 양식', 'body': '시험 양식 둘째 판 {{name}} 님 {{startOn}} 부터 일합니다.'}, TS)
        act = psql(f"SELECT string_agg(version || ':' || active, ',' ORDER BY version) FROM hr_contract_templates WHERE code = '{TC}'")
        old = call('POST', '/admin/hr/contracts', {'employeeId': e1, 'templateId': t1.get('id'), 'terms': terms}, TS)
        tg = psql(f"UPDATE hr_contract_templates SET body = body || 'x' WHERE id = {int(t2.get('id') or 0)}")
        stub_ok = True
        if p0 in ('', 'STUB'):
            setting('hr.contract_esign', 'on', '1459')
            c3 = call('POST', '/admin/hr/contracts', {'employeeId': e1, 'templateId': t2.get('id'), 'terms': terms}, TS)
            s3 = call('POST', f"/admin/hr/contracts/{c3.get('id')}/send", None, TS)
            lst = call('GET', '/admin/hr/contracts', None, TS)
            stub_ok = s3.get('signMode') == 'STUB' and lst.get('signMode') == 'STUB' and lst.get('ready') is True
            setting('hr.contract_esign', 'off', '1459')
        ok('② 보내기 · 양식 — 계정 연결 없는 직원 422 · 초안 취소 · 양식 새 판(옛 판 쓰지 않음) · 옛 판으로 초안 422 · 양식 본문 고치기 막음 · 스위치 on 이면 전자계약 방식(STUB)',
           nl.get('code') == 'HR_NOT_LINKED' and cx.get('state') == 'CANCELED' and t1.get('version') == 1 and t2.get('version') == 2 and act == '1:false,2:true'
           and old.get('code') == 'CONTRACT_TEMPLATE_OFF' and 'HR_CONTRACT_TEMPLATE' in tg and stub_ok,
           f"{nl.get('code')} {cx.get('state')} {t1.get('version')} {t2.get('version')} {act} {old.get('code')} {tg[-30:]} stub={stub_ok} p0={p0}")
    finally:
        cleanup(); setting('hr.contract_esign', s0 or 'off', '1459 되돌림'); rm_role(eid, '1459'); rm_role(pid, '1459')

    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-hr-contracts]', timeout=30000)
            seen['mode'] = pg.get_attribute('[data-hr-sign-mode]', 'data-hr-sign-mode')
            seen['new'] = pg.locator('[data-hr-contract-new]').count()
        res = admin_page('/#/hr-contract', chk)
        if res is None: print('  (playwright 없음 — 화면 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 인사 › 근로계약서 서명 길 표시 · 새 계약서 상자 · 화면 오류 없음', bool(seen.get('mode')) and seen.get('new') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
