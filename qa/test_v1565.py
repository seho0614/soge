"""v10.565 (docs/707) 감사 기록 개인정보 줄이기 — @Audit 셋째 인자 idOnly · pick(대표 11/21)
  ① (코드) interceptor pick(최상위 칸만 · 없으면 빈 객체 · 배열이면 { n } · idOnly 가 먼저 · 옵션 없으면 그대로) · 바꾼 29곳마다 옵션 · 다른 코드가 읽는 감사(OPS_*_TEST · STAFF_IP_NGINX_APPLIED)는 그대로 · 문서 707 · 판
  ② (API · DB) 회원 상세 보기(ACCOUNT_VIEW) → after_data = { id } · 근태 넣기(HR_ATTEND_ADD · pick) → ok · id 만(직원 이름 글 없음) · 사원 카드(HR_CARD_VIEW) → { id } · 근태 고치기(HR_ATTEND_FIX · 옵션 없음) → 응답 그대로(note 있음)
  (두 번 돌아도 통과 — 「시험직원1565-」 직원 · 근태는 시작 · 끝에 replica 로 지움 · 감사 기록은 쌓기만 표라 남음)
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


def call_h(m_, p, t=None, reason=None, b=None):
    """머리글 X-PII-Reason 을 붙여 부름(call 은 머리글을 못 붙임)"""
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    if reason:
        hd['X-PII-Reason'] = reason
    data = json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None)
    try:
        body = urllib.request.urlopen(urllib.request.Request(API + p, data=data, headers=hd, method=m_), timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


"""시험 몸통"""
AU = rd('src/core/audit.interceptor.ts')
ok('① interceptor — pick?: string[] · auditAfter(최상위 칸만 · 배열이면 { n } · idOnly 가 먼저 · 옵션 없으면 응답 그대로) · idOnly 글자 그대로 · 역할로 거르지 않음',
   'pick?: string[]' in AU and 'export function auditAfter' in AU and 'if (meta.idOnly) return { id: String(params?.id' in AU
   and 'if (Array.isArray(result)) return { n: result.length };' in AU and 'Object.prototype.hasOwnProperty.call(result, k)' in AU
   and 'return result ?? {};' in AU and "meta.idOnly ? { id:" in AU and 'auditAfter(meta, req.params, result)' in AU
   and AU.index('if (meta.idOnly)') < AU.index('if (meta.pick)') and 'SUPER' not in AU, '')

CHANGED = [
    ('src/modules/admin/admin.controller.ts', "@Audit('ACCOUNT_VIEW', 'ACCOUNT', { idOnly: true })"),
    ('src/modules/settlement/settlement-summary.controller.ts', "@Audit('ACCOUNT_SETTLEMENT_VIEW', 'ACCOUNT', { idOnly: true })"),
    ('src/modules/acct/hr.controller.ts', "@Audit('HR_CARD_VIEW', 'ACCOUNT', { idOnly: true })"),
    ('src/modules/admin/admin.controller.ts', "@Audit('ACCOUNT_LIST', 'ACCOUNT', { pick: [] })"),
    ('src/modules/sfx/sfx.controller.ts', "@Audit('SFX_DEVICE_VIEW', 'ACCOUNT', { pick: ['mark', 'accounts'] })"),
    ('src/modules/identity/staff-ip.controller.ts', "@Audit('STAFF_IP_NGINX_SCRIPT', 'SETTING', { pick: ['count', 'hash', 'file', 'appliedSame'] })"),
    ('src/modules/partner/partner.controller.ts', "@Audit('LEAD_VIEW', 'LEAD', { pick: ['fee', 'viewedAt', 'parts'] })"),
    ('src/modules/introducer/introducer.controller.ts', "@Audit('INTRO_INVITE', 'INVITE', { pick: ['id', 'state', 'expiresAt', 'channel'] })"),
    ('src/modules/ads/ads.controller.ts', "@Audit('PROFILE_REGISTER', 'ACCOUNT', { pick: ['consentedAt'] })"),
    ('src/modules/deal/esign.controller.ts', "@Audit('CONTRACT_ESIGN', 'DEAL', { pick: ['mode', 'contractState', 'state', 'stub', 'docId', 'docHash', 'requestedAt'] })"),
    ('src/modules/affiliate/affiliate.controller.ts', "@Audit('PARTNER_SETTLE_RUN', 'SETTLEMENT', { pick: ['ok', 'created'] })"),
    ('src/modules/partner/partner-center.controller.ts', "@Audit('LEAD_CASH_AUTO_RUN', 'PARTNER', { pick: ['ran'] })"),
    ('src/modules/health/health-shop.controller.ts', "@Audit('HLT_PAY', 'HLT_ORDER', { pick: ['id', 'method', 'amount', 'state', 'stub', 'pgStatus', 'approvedAt', 'orderNo'] })"),
    ('src/modules/health/health-shop.controller.ts', "@Audit('HLT_PAY_CONFIRM', 'HLT_ORDER', { pick: ['id', 'method', 'amount', 'state', 'stub', 'pgStatus', 'approvedAt', 'orderNo', 'orderStatus', 'again'] })"),
    ('src/modules/acct/hrx.controller.ts', "@Audit('HRX_OT_DECIDE', 'SETTING', { pick: ['ok', 'id', 'state', 'weekApproved', 'warning'] })"),
    ('src/modules/acct/hrx.controller.ts', "@Audit('HRX_OT_REVOKE', 'SETTING', { pick: ['ok', 'id', 'state'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_TRAINING_DECIDE', 'SETTING', { pick: ['ok', 'id', 'state'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_TRAINING_VOID', 'SETTING', { pick: ['ok', 'id', 'state'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_CONTRACT_CREATE', 'SETTING', { pick: ['ok', 'id', 'docHash'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_CONTRACT_SEND', 'SETTING', { pick: ['ok', 'id', 'signMode', 'stub'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_REVIEW_MANAGER', 'SETTING', { pick: ['ok', 'cycleId', 'employeeId', 'mgrAvg', 'suggested', 'grade'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_APPLICANT_ADD', 'SETTING', { pick: ['ok', 'id'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_APPLICANT_STAGE', 'SETTING', { pick: ['ok', 'id', 'stage', 'purgeDueOn'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_INTERVIEW_ADD', 'SETTING', { pick: ['ok', 'id'] })"),
    ('src/modules/acct/hr-people.controller.ts', "@Audit('HR_APPLICANT_HIRE', 'SETTING', { pick: ['ok', 'id', 'employeeId'] })"),
    ('src/modules/acct/hr.controller.ts', "@Audit('HR_ATTEND_ADD', 'SETTING', { pick: ['ok', 'id'] })"),
    ('src/modules/acct/hr.controller.ts', "@Audit('HR_EMPLOYEE_LINK', 'SETTING', { pick: ['ok', 'employeeId', 'accountId'] })"),
    ('src/modules/acct/hr.controller.ts', "@Audit('HR_LEAVE_DECIDE', 'SETTING', { pick: ['ok', 'id', 'state', 'days', 'remaining'] })"),
    ('src/modules/acct/hr.controller.ts', "@Audit('HR_LEAVE_REVOKE', 'SETTING', { pick: ['ok', 'id', 'state', 'returned'] })"),
    ('src/modules/acct/hr.controller.ts', "@Audit('ACCT_YEAREND_CHECK', 'SETTING', { pick: ['ok', 'id'] })"),
]
miss = [s for f, s in CHANGED if s not in rd(f)]
ok('① 바꾼 곳 — idOnly 3(회원 상세 · 회원 정산 명세 · 사원 카드) · pick 27 이 모두 붙음', not miss, f"{len(CHANGED)} 중 빠짐 {miss[:3]}")

KEEP = [
    ('src/modules/admin/ops-review.controller.ts', "@Audit('OPS_MAIL_TEST', 'OPS_ALERT')"),
    ('src/modules/admin/ops-review.controller.ts', "@Audit('OPS_PUSH_TEST', 'OPS_ALERT')"),
    ('src/modules/admin/ops-review.controller.ts', "@Audit('OPS_SLACK_TEST', 'OPS_ALERT')"),
    ('src/modules/identity/staff-ip.controller.ts', "@Audit('STAFF_IP_NGINX_APPLIED', 'SETTING')"),
    ('src/modules/acct/hr.controller.ts', "@Audit('HR_ATTEND_FIX', 'SETTING')"),
]
kmiss = [s for f, s in KEEP if s not in rd(f)]
ok('① 그대로 둔 곳 — 다른 코드가 after_data 를 읽는 감사(메일 · 푸시 · 슬랙 시험 결과 · Nginx 반영 지문)와 시험용 기본 동작(HR_ATTEND_FIX)은 옵션 없음',
   not kmiss and "after_data AS result FROM audit.audit_logs WHERE action = 'OPS_MAIL_TEST'" in rd('src/modules/admin/ops-alerts.service.ts')
   and "l.after_data->>'hash' AS hash" in rd('src/modules/identity/nginx-allow-script.ts'), f"{kmiss}")

D7 = doc('707_')
ok('① 문서 707 — 결론 · 분류 기준(A · B · C) · 바꾼 곳 표 · 그대로 둔 이유 · 이미 쌓인 기록 그대로 · 판 v10.565',
   'idOnly' in D7 and 'pick' in D7 and '분류' in D7 and '이미 쌓인' in D7 and 'ACCOUNT_VIEW' in D7 and 'HR_APPLICANT_ADD' in D7 and VT >= (10, 565), VER)

STAMP = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
CLEAN = ("SET session_replication_role = replica; "
         "DELETE FROM acct_attendance_fixes WHERE attendance_id IN (SELECT a.id FROM acct_attendance a JOIN acct_employees e ON e.id = a.employee_id WHERE e.name LIKE '시험직원1565-%'); "
         "DELETE FROM acct_attendance WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1565-%'); "
         "DELETE FROM acct_employees WHERE name LIKE '시험직원1565-%';")
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    SID = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    BID = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    psql(CLEAN)
    try:
        ENAME = f'시험직원1565-{STAMP}'
        j = (kst - datetime.timedelta(days=60)).strftime('%Y-%m-%d')
        EID = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, nontax, dependents) VALUES ('{ENAME}', '{j}', 2500000, 200000, 1) RETURNING id").split('\n')[0]
        T0 = psql("SELECT now()")
        # ⓐ 보기(idOnly) — 회원 상세
        v = call_h('GET', f'/admin/accounts/{BID}', TS, 'DISPUTE')
        # ⓑ 쓰기(pick) — 근태 넣기(응답 note 에 직원 이름)
        w = call('POST', '/admin/hr/attendance/add', {'employeeId': EID, 'workOn': today, 'inAt': '09:00', 'outAt': '18:00', 'reason': '시험 1565 넣기'}, TS) if EID.isdigit() else {}
        # ⓒ 사원 카드(idOnly · v10.559)
        c = call_h('GET', f'/admin/hr/employees/{EID}/card', TS, 'DISPUTE') if EID.isdigit() else {}
        # ⓓ 옵션 없음 — 근태 고치기는 응답 그대로
        f = call('POST', f"/admin/hr/attendance/{w.get('id')}/fix", {'inAt': '09:10', 'outAt': '18:00', 'reason': '시험 1565 고침'}, TS) if w.get('id') else {}
        time.sleep(1.5)   # 감사는 응답 뒤에 씀
        q = lambda act, extra='': psql(f"SELECT coalesce(string_agg(after_data::text, ' | '), '') FROM audit.audit_logs WHERE action = '{act}' AND actor_account_id = '{SID}' AND occurred_at >= '{T0}' {extra}")
        av = q('ACCOUNT_VIEW', f"AND target_id = '{BID}'")
        aw = q('HR_ATTEND_ADD')
        ac = q('HR_CARD_VIEW', f"AND after_data ->> 'id' = '{EID}'")
        af = q('HR_ATTEND_FIX')
        ok('② 보기 idOnly — 회원 상세 200 · after_data 는 { id } 하나(계정 · 사업자 · 역할 칸 없음 · 메일 글자 없음)',
           v.get('ok') is True and av != '' and json.loads(av.split(' | ')[0]) == {'id': BID} and 'buyer@x.com' not in av and '"account"' not in av,
           f"{v.get('ok') or v} {av[:120]}")
        ok('② 쓰기 pick — 근태 넣기 200 · after_data 는 ok · id 만(note 없음 · 직원 이름 글자 없음)',
           w.get('ok') is True and ENAME in (w.get('note') or '') and aw != '' and '"note"' not in aw and ENAME not in aw
           and json.loads(aw.split(' | ')[0]) == {'ok': True, 'id': w.get('id')},
           f"{w.get('ok') or w} {aw[:120]}")
        ok('② 사원 카드 idOnly — 카드 200 · after_data 에 급여 · 직원 칸 없음',
           (c.get('employee') or {}).get('id') == EID and ac != '' and '"pay"' not in ac and '"employee"' not in ac and ENAME not in ac,
           f"{(c.get('employee') or {}).get('id') or c} {ac[:120]}")
        ok('② 기본 동작 그대로 — 근태 고치기(옵션 없음) after_data = 응답(ok · id · note)',
           f.get('ok') is True and af != '' and json.loads(af.split(' | ')[0]) == {'ok': True, 'id': f.get('id'), 'note': f.get('note')},
           f"{f.get('ok') or f} {af[:120]}")
    finally:
        psql(CLEAN)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
