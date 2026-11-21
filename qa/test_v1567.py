"""v10.567 (docs/709) 내 사원 카드(본인) — 사무 › 내 인사(my-hr) 맨 위 「내 카드」 · GET /admin/me/hr/card · 읽기만 · 본인 것만
  ① (코드) hr-card-self.ts 기존 본인 함수 재사용 · 퇴직금 · 열람 사유 · 관리자 메모 없음 · 닫힌 평가만 · 컨트롤러 GET · @Roles(...SELF) · 감사 없음 · 화면(HrCard 칸 부품 재사용) · App · 화면 목록 · 문서 709 · 판
  ② (API · DB) 연결된 직원 계정 200 · 칸 모양 · 남의 것 못 봄(다른 직원 이름 · 휴가 · 평가 없음) · 퇴직금 · 금액 · 메모 없음 · 평가는 닫힌 차례의 내 결과만(의견 · 평가자 메모 없음) · 자세히는 모두 내 인사 · 연결 없는 운영 계정 200 + linked false · 세무사 403
  ③ (화면) 연결된 직원으로 로그인 → 내 인사 → 「내 카드」 펼치면 칸 5 · 자세히(같은 화면 안) · 관리자 탭 단추 없음
  (두 번 돌아도 통과 — 「시험직원1567-」 직원 · 근태 · 연차 · 휴가 · 「시험평가1567-」 평가 차례는 시작 · 끝에 replica 로 지움 · 시험 계정 역할은 끝에 거둠)
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
import hashlib, hmac, struct
HC, HS = rd('src/modules/acct/hr.controller.ts'), rd('src/modules/acct/hr-card-self.ts')
UI, HCU, HRU, AP = rd('web/src/app/admin/MyHrCard.tsx'), rd('web/src/app/admin/HrCard.tsx'), rd('web/src/app/admin/Hr.tsx'), rd('web/src/App.tsx')
_i = HC.find("@Get('me/hr/card')")
CARD_BLOCK = HC[_i:HC.find('myCard()', _i)] if _i >= 0 else ''
_s = re.search(r"const SELF = \[([^\]]*)\]", HC)
ok('① 코드 — hr-card-self.ts 본인 함수 재사용(myHr · 교육 · 계약 · 평가 · 근무표 · 연장 근로 규칙) · 닫힌 평가만 · 퇴직금 · 열람 사유 · 접속기록 · 관리자 메모 · 금액 줄 없음 · 컨트롤러 GET me/hr/card · @Roles(...SELF) · 세무사 빠짐 · 감사 없음',
   'export async function hrCardSelf' in HS and all(f in HS for f in ('myHr(', 'myTraining(', 'myContracts(', 'myReviews(', 'shiftWeek(', 'otRules('))
   and "x.cycle.state === 'CLOSED'" in HS and not any(w in HS for w in ('severanceEstimate', 'piiReason', 'pii_access_logs', 'leaveBook', 'mgrComment', 'mgrNote', 'monthly_base', 'acct_payroll_lines'))
   and 'linked: false' in HS and "MY_HR_CARD_LINKS" in HS
   and "import { hrCardSelf } from './hr-card-self'" in HC and CARD_BLOCK.startswith("@Get('me/hr/card')\n  @Roles(...SELF)") and '@Audit' not in CARD_BLOCK and '@ApiOkResponse' in CARD_BLOCK
   and _s is not None and 'ACCOUNTANT' not in _s.group(1),
   f"{len(HS)} {len(CARD_BLOCK)}")
ok('① 화면 — MyHrCard(내 카드 API · 펼칠 때 부름 · 칸 부품 HrCard 의 Sec 재사용 · 자세히 같은 화면 · 명세서 인쇄 재사용) · HrCard · Hr 내보냄 · App 내 인사 맨 위 · 화면 목록 HRS-050 · 디자인',
   'export function MyHrCard' in UI and "'/admin/me/hr/card'" in UI and "from './HrCard'" in UI and 'Sec' in UI and 'data-my-hr-card-more' in UI
   and '/admin/me/hr/payslips/${lineId}' in UI and 'printSlip' in UI and '#/hr-' not in UI and '#/acct-' not in UI
   and 'export { Sec,' in HCU and 'export { printSlip }' in HRU
   and "{tab === 'my-hr' && <MyHrCard />}\n      {tab === 'my-hr' && <MyHr />}" in AP and "import { MyHrCard } from './app/admin/MyHrCard'" in AP
   and '"SB-ADM-HRS-050"' in SJ and 'GET /admin/me/hr/card' in SJ
   and 'fontSize' not in UI and 'borderRadius' not in UI,
   f"{len(UI)}")
ok('① 문서 · 판 — 문서 709(본인 · 퇴직금 없음 · 닫힌 평가) · v10.567',
   '/admin/me/hr/card' in doc('709_') and '퇴직금' in doc('709_') and '닫힌' in doc('709_') and VT >= (10, 567), VER)


def totp(secret, step, digits=6):
    key = base64.b32decode(secret.upper() + '=' * (-len(secret) % 8))
    h = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    o_ = h[-1] & 15
    return str((struct.unpack('>I', h[o_:o_ + 4])[0] & 0x7fffffff) % 10 ** digits).zfill(digits)


def mfa_token(t):
    """세무사는 늘 2단계(D257) — 등록 · 켜기 뒤 확인된 증표(test_v1437 과 같음)"""
    sec = call('POST', '/auth/mfa/setup', None, t).get('secret') or ''
    if not sec:
        return t
    return call('POST', '/auth/mfa/enable', {'code': totp(sec, int(time.time() // 30))}, t).get('accessToken') or t


def staff_page(path, email, fn):
    """admin_page 와 같되 시험 직원 계정으로 로그인"""
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", email); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


STAMP = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, year = kst.strftime('%Y-%m-%d'), kst.year
EMPS = "(SELECT id FROM acct_employees WHERE name LIKE '시험직원1567-%')"
CYC = "(SELECT id FROM hr_review_cycles WHERE title LIKE '시험평가1567-%')"
CLEAN = ("SET session_replication_role = replica; "
         f"DELETE FROM hr_review_goals WHERE cycle_id IN {CYC} OR employee_id IN {EMPS}; "
         f"DELETE FROM hr_review_results WHERE cycle_id IN {CYC} OR employee_id IN {EMPS}; "
         "DELETE FROM hr_review_cycles WHERE title LIKE '시험평가1567-%'; "
         f"DELETE FROM acct_attendance_fixes WHERE attendance_id IN (SELECT id FROM acct_attendance WHERE employee_id IN {EMPS}); "
         f"DELETE FROM acct_attendance WHERE employee_id IN {EMPS}; "
         f"DELETE FROM acct_leave_uses WHERE employee_id IN {EMPS}; "
         f"DELETE FROM acct_leave_grants WHERE employee_id IN {EMPS}; "
         f"DELETE FROM acct_leave_requests WHERE employee_id IN {EMPS}; "
         "DELETE FROM acct_employees WHERE name LIKE '시험직원1567-%';")
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    SID = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    psql(CLEAN)
    me_e, me_id = mk_staff(f'1567m{STAMP % 97}', 'REVIEWER'); consent_ok.agree(me_e, PW); TM = login(me_e)      # 연결된 직원(나)
    ot_e, ot_id = mk_staff(f'1567o{STAMP % 97}', 'ADMIN'); consent_ok.agree(ot_e, PW); TO = login(ot_e)        # 연결된 다른 직원
    nl_e, nl_id = mk_staff(f'1567n{STAMP % 97}', 'PAYOUT'); consent_ok.agree(nl_e, PW); TN = login(nl_e)       # 연결 없는 운영 계정
    ac_e, ac_id = mk_staff(f'1567c{STAMP % 97}', None)                                                        # 세무사
    try:
        acr = psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1567 세무사', true); INSERT INTO account_roles (account_id, role) VALUES ('{ac_id}', 'ACCOUNTANT'); "
                   f"UPDATE account_roles SET expires_at = now() + interval '7 days' WHERE account_id = '{ac_id}' AND role = 'ACCOUNTANT'; COMMIT;")
        consent_ok.agree(ac_e, PW)
        TC = mfa_token(login(ac_e) or '')
        j = (kst - datetime.timedelta(days=400)).strftime('%Y-%m-%d')
        OTHER = f'시험직원1567-B{STAMP}'
        EID = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, nontax, dependents, memo, account_id) VALUES ('시험직원1567-A{STAMP}', '{j}', 3000000, 200000, 2, 'MEMO1567관리자메모', '{me_id}') RETURNING id").split('\n')[0]
        EID2 = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, dependents, account_id) VALUES ('{OTHER}', '{j}', 4000000, 1, '{ot_id}') RETURNING id").split('\n')[0]
        seed = psql(f"INSERT INTO acct_attendance (employee_id, work_on, in_at, out_at) VALUES ({EID}, '{today}', '{today} 09:00:00+09', '{today} 18:00:00+09'), ({EID2}, '{today}', '{today} 08:00:00+09', '{today} 17:00:00+09'); "
                    f"INSERT INTO acct_leave_grants (employee_id, year, days, note) VALUES ({EID}, {year}, 15, '시험 1567 연차'), ({EID2}, {year}, 20, '시험 1567 연차 B'); "
                    f"INSERT INTO acct_leave_requests (employee_id, start_on, end_on, half, days, note) VALUES ({EID}, '{year}-12-30', '{year}-12-30', 'FULL', 1, '시험 1567'), "
                    f"({EID2}, '{year}-12-29', '{year}-12-29', 'FULL', 1, '시험 1567 B'), ({EID2}, '{year}-12-28', '{year}-12-28', 'FULL', 1, '시험 1567 B2')")
        # 평가 — 2100 년 4분기 닫힘(내 결과 · 의견 · 메모 있음) · 3분기 평가 중(안 보여야 함) · 다른 직원 결과
        rv = psql("SET session_replication_role = replica; "
                  f"INSERT INTO hr_review_cycles (year, quarter, title, state, closed_at, closed_by) VALUES (2100, 4, '시험평가1567-닫힘', 'CLOSED', now(), '{SID}'); "
                  "INSERT INTO hr_review_cycles (year, quarter, title, state) VALUES (2100, 3, '시험평가1567-진행', 'REVIEW'); "
                  f"INSERT INTO hr_review_goals (cycle_id, employee_id, title, weight, self_score, self_note, mgr_score, mgr_note) "
                  f"SELECT c.id, {EID}, g.t, 50, 4, 'SELFNOTE1567', 4, 'MGRNOTE1567' FROM hr_review_cycles c, (VALUES ('목표 하나'), ('목표 둘')) g(t) WHERE c.title LIKE '시험평가1567-%'; "
                  f"INSERT INTO hr_review_goals (cycle_id, employee_id, title, weight, mgr_score, mgr_note) SELECT id, {EID2}, '남의 목표', 100, 2, 'OTHERNOTE1567' FROM hr_review_cycles WHERE title LIKE '시험평가1567-%'; "
                  f"INSERT INTO hr_review_results (cycle_id, employee_id, self_comment, self_submitted_at, mgr_comment, mgr_avg, grade, reviewed_by, reviewed_at) "
                  f"SELECT id, {EID}, 'SELFCOMMENT1567', now(), 'MGRCOMMENT1567', 4.00, CASE WHEN state = 'CLOSED' THEN 'A' ELSE 'B' END, '{SID}', now() FROM hr_review_cycles WHERE title LIKE '시험평가1567-%'; "
                  f"INSERT INTO hr_review_results (cycle_id, employee_id, mgr_comment, mgr_avg, grade, reviewed_by, reviewed_at) "
                  f"SELECT id, {EID2}, 'OTHERCOMMENT1567', 2.00, 'D', '{SID}', now() FROM hr_review_cycles WHERE title LIKE '시험평가1567-%'")
        CLOSED_ID = psql("SELECT id FROM hr_review_cycles WHERE title = '시험평가1567-닫힘'")
        OPEN_ID = psql("SELECT id FROM hr_review_cycles WHERE title = '시험평가1567-진행'")

        c1 = call('GET', '/admin/me/hr/card', None, TM)
        emp_ = c1.get('employee') or {}
        att_s = (c1.get('attendance') or {}).get('summary') or {}
        lv = c1.get('leave') or {}
        pay = c1.get('pay') or {}
        docs = c1.get('docs') or {}
        work = c1.get('work') or {}
        flat = json.dumps(c1, ensure_ascii=False)
        ok('② 연결된 직원 200 — linked · self · 칸 모양(기본 · 근태 · 휴가 · 명세서 · 계약 · 교육 · 평가 · 근무 · 자세히) · 오류 칸 없음 · 자세히는 모두 내 인사',
           EID.isdigit() and EID2.isdigit() and '!' not in seed + rv + acr and c1.get('linked') is True and c1.get('self') is True and emp_.get('id') == EID
           and all(k in c1 for k in ('employee', 'attendance', 'leave', 'pay', 'docs', 'work', 'links')) and c1.get('errors') == []
           and all(k in docs for k in ('contractState', 'contracts', 'training', 'reviews')) and all(k in work for k in ('overtime', 'shifts'))
           and set((c1.get('links') or {}).values()) == {'my-hr'},
           f"{EID} {EID2} {seed[-60:]} {rv[-60:]} {acr[-40:]} {list(c1.keys())[:12]} {c1.get('errors')} {c1.get('_err')} {c1.get('message')}")
        ok('② 칸 값 — 재직일 · 부양가족 · 내 역할 · 이번 달 근태 · 연차 15 · 휴가 신청 1(내 것만) · 명세서 목록(금액 없음) · 퇴직금 · 월 기본급 · 관리자 메모 없음',
           int(emp_.get('serviceDays') or 0) >= 400 and emp_.get('dependents') == 2 and 'REVIEWER' in ((emp_.get('account') or {}).get('roles') or [])
           and int(att_s.get('days') or 0) >= 1 and lv.get('granted') == 15 and len(lv.get('requests') or []) == 1
           and list(pay.keys()) == ['payslips'] and isinstance(pay.get('payslips'), list) and all(set(p.keys()) <= {'lineId', 'ym', 'payDay', 'state'} for p in pay.get('payslips') or [])
           and not any(w in flat for w in ('"severance"', '"monthlyBase"', '"nontax"', '"gross"', '"net"', '"lines"', 'MEMO1567', '"memo"', '"viewReason"', 'resident', 'account_no', 'signUrl')),
           f"{emp_.get('serviceDays')} {emp_.get('dependents')} {emp_.get('account')} {att_s} {lv.get('granted')} {len(lv.get('requests') or [])} {list(pay.keys())}")
        rvs = docs.get('reviews') or []
        mine_rv = next((r for r in rvs if r.get('cycleId') == CLOSED_ID), {})
        ok('② 평가 — 닫힌 차례의 내 결과만(등급 A · 상사 평균 4 · 목표 2) · 진행 중 차례 없음 · 의견 · 평가자 메모 · 다른 직원 결과 없음',
           mine_rv.get('grade') == 'A' and float(mine_rv.get('mgrAvg') or 0) == 4.0 and mine_rv.get('goals') == 2 and all(r.get('state') == 'CLOSED' for r in rvs)
           and not any(r.get('cycleId') == OPEN_ID for r in rvs)
           and not any(w in flat for w in ('MGRNOTE1567', 'MGRCOMMENT1567', 'SELFCOMMENT1567', 'SELFNOTE1567', 'OTHERNOTE1567', 'OTHERCOMMENT1567', 'mgrComment', 'mgrNote', 'selfComment')) and all(r.get('grade') != 'D' for r in rvs),
           f"{CLOSED_ID} {OPEN_ID} {rvs}")
        o1 = call('GET', '/admin/me/hr/card', None, TO)
        ok('② 남의 것 못 봄 — 내 카드에 다른 직원 이름 · 휴가 · 연차 없음 · 다른 직원은 자기 카드(연차 20 · 휴가 2) · 직원 번호를 받는 길 없음',
           OTHER not in flat and '시험 1567 B' not in flat and (o1.get('employee') or {}).get('id') == EID2 and (o1.get('leave') or {}).get('granted') == 20
           and len((o1.get('leave') or {}).get('requests') or []) == 2 and f'시험직원1567-A{STAMP}' not in json.dumps(o1, ensure_ascii=False)
           and call('GET', f'/admin/me/hr/card?id={EID2}', None, TM).get('employee', {}).get('id') == EID,
           f"{(o1.get('employee') or {}).get('id')} {(o1.get('leave') or {}).get('granted')} {o1.get('_err')}")
        n1 = call('GET', '/admin/me/hr/card', None, TN)
        a1 = call('GET', '/admin/me/hr/card', None, TC)
        u1 = call('GET', '/admin/me/hr/card', None, None)
        ok('② 연결 없음 · 권한 — 연결 없는 운영 계정 200 + linked false(직원 칸 없음) · 세무사 403 · 로그인 없이 401',
           n1.get('_err') is None and n1.get('linked') is False and 'employee' not in n1 and a1.get('_err') == 403 and u1.get('_err') == 401,
           f"{n1} {a1.get('_err')} {a1.get('code')} {u1.get('_err')}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-my-hr-card-open]', timeout=30000)
                pg.click('[data-my-hr-card-open]')
                pg.wait_for_selector(f'[data-my-hr-card="{EID}"]', timeout=30000); pg.wait_for_timeout(1000)
                seen['secs'] = pg.locator('[data-my-hr-card] [data-hr-card-sec]').count()
                seen['more'] = pg.locator('[data-my-hr-card-more]').count()
                seen['adm'] = pg.locator('[data-my-hr-card] [data-hr-card-more]').count()
                seen['rv'] = pg.locator(f'[data-my-hr-card] [data-my-hr-card-review]').count()
                seen['other'] = pg.locator(f'text={OTHER}').count()
                pg.click('[data-my-hr-card-more="data-my-leave"]'); pg.wait_for_timeout(800)
                seen['hash'] = pg.evaluate('location.hash')
            res = staff_page('/#/my-hr', me_e, chk)
            if res is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res
                ok('③ 화면 — 내 인사 「내 카드」 펼치면 칸 5 · 자세히 단추(같은 화면 안) · 관리자 탭 단추 없음 · 닫힌 평가 1 · 다른 직원 없음 · 자세히 눌러도 내 인사 그대로 · 화면 오류 없음',
                   seen.get('secs') == 5 and (seen.get('more') or 0) >= 5 and seen.get('adm') == 0 and seen.get('rv') == 1 and seen.get('other') == 0
                   and str(seen.get('hash') or '').startswith('#/my-hr') and not perr, f"{seen} {perr[:2]}")
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        psql(CLEAN)
        psql(f"SET session_replication_role = replica; DELETE FROM account_mfa WHERE account_id = '{ac_id}';")
        for a_, t_ in ((me_id, '1567m'), (ot_id, '1567o'), (nl_id, '1567n'), (ac_id, '1567c')):
            rm_role(a_, t_)
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
