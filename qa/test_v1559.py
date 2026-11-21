"""v10.559 (docs/698) 사원 카드 — 회계 › 인사 › 사원 카드(hr-card) · 읽기만 · SUPER · 지급 담당 · 열람 사유 · 감사 HR_CARD_VIEW
  ① (코드) hr-card.ts 기존 함수 재사용 · 컨트롤러 GET · @Roles · @Audit · 화면 · 메뉴 · App 역할 · 열람 사유 감쌈 · 급여 탭 이름 링크 · 화면 목록 · 권한 시드 · 디자인 · 문서 698 · 판
  ② (API · DB) SUPER 200 · 칸 모양 · 근태 · 연차 · 휴가 신청 · 가린 메일 · 민감 값 없음 · 지급 담당 200 · 일반 운영(ADMIN) 403 · 없는 번호 404 · 감사 줄 · 열람 사유 기록 · 사유 없이 열면 「미입력」(막지 않음)
  ③ (화면) 열람 사유 → 카드 칸 5 · 급여 탭 「직원」 이름 → 사원 카드
  (두 번 돌아도 통과 — 「시험직원1559-」 직원과 근태 · 연차 · 휴가는 시작 · 끝에 replica 로 지움 · 감사 · 접속기록은 쌓기만이라 남음)
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
HC, HK = rd('src/modules/acct/hr.controller.ts'), rd('src/modules/acct/hr-card.ts')
UI, AP, MN, AC = rd('web/src/app/admin/HrCard.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/app/admin/Acct.tsx')
M90 = migr('D290_')
ok('① 코드 — hr-card.ts 기존 함수 재사용(근태 · 연차 · 퇴직금 · 교육 · 평가 · 근무표) · 열람 사유 piiReason · 접속기록 EMPLOYEE · 컨트롤러 GET · SUPER · PAYOUT · 감사 HR_CARD_VIEW',
   'export async function hrCard' in HK and all(f in HK for f in ('attendanceMonth(', 'leaveBook(', 'severanceEstimate(', 'myTraining(', 'myReviews(', 'shiftWeek(', 'otRules('))
   and 'piiReason(' in HK and "'EMPLOYEE'" in HK and '사원 카드(직원 ${e.id}) · 사유 ${why}' in HK
   and "@Get('hr/employees/:id/card')" in HC and "@Roles('SUPER', 'PAYOUT')\n  @Audit('HR_CARD_VIEW', 'ACCOUNT'" in HC and "@Headers('x-pii-reason')" in HC,
   f"{len(HK)} {len(HC)}")
ok('① 화면 — HrCard(직원 고르기 · 카드 API · 자세히) · 메뉴 TABS · 인사 묶음 · PAGE SB-ADM-HRC-010 · App 역할 SUPER · PAYOUT · PiiReasonGate · 급여 탭 이름 링크 · 화면 목록',
   'export function HrCard' in UI and '/admin/hr/employees/${id}/card' in UI and "'/admin/acct/employees'" in UI and 'data-hr-card-more' in UI
   and "['hr-card', '사원 카드']" in MN and "s.tabs.unshift('hr-card')" in MN and "screen: 'SB-ADM-HRC-010'" in MN
   and "'hr-card': ['SUPER', 'PAYOUT']" in AP and '<PiiReasonGate what="사원 카드"><HrCard /></PiiReasonGate>' in AP
   and 'data-hr-card-link={x.id}' in AC and '"SB-ADM-HRC-010"' in SJ and 'GET /admin/hr/employees/{id}/card' in SJ,
   f"{len(UI)}")
_AU, _SE, _PS = rd('src/core/audit.interceptor.ts'), rd('site/src/lib/session.ts'), rd('src/modules/public/public.service.ts')
ok('① 감사 idOnly · 기기 표지 쿠키 — Audit 셋째 인자 idOnly(응답을 베끼지 않음) · 사원 카드에 씀 · sgb_dm 은 sfx.device_watch on 일 때만(꺼지면 지움) · 공개 설정에 그 키 하나',
   'idOnly' in _AU and "meta.idOnly ? { id:" in _AU and "{ idOnly: true }" in HC
   and "st['sfx.device_watch'] !== 'on'" in _SE and 'jar.delete(DM)' in _SE and "'sfx.device_watch')" in _PS)
ok('① 권한 시드 · 디자인 · 문서 · 판 — D290 에 hr-card 업무 · 주소 · 지급 담당 · 화면 인라인 글자 크기 · 모서리 없음 · 문서 698 · v10.559',
   "('hr-card', '사원 카드', 'admacc'" in M90 and "'/admin/hr/employees/{id}/card', 'hr-card', 'VIEW'" in M90 and "'R_PAYOUT', 'hr-card'" in M90
   and 'fontSize' not in UI and 'borderRadius' not in UI and 'HR_CARD_VIEW' in doc('698_') and '열람 사유' in doc('698_') and VT >= (10, 559), VER)


def call_h(m_, p, t=None, reason=None):
    """머리글 X-PII-Reason 을 붙여 부름(call 은 머리글을 못 붙임)"""
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    if reason:
        hd['X-PII-Reason'] = reason
    try:
        body = urllib.request.urlopen(urllib.request.Request(API + p, headers=hd, method=m_), timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


STAMP = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, year = kst.strftime('%Y-%m-%d'), kst.year
CLEAN = ("SET session_replication_role = replica; "
         "DELETE FROM acct_attendance_fixes WHERE attendance_id IN (SELECT a.id FROM acct_attendance a JOIN acct_employees e ON e.id = a.employee_id WHERE e.name LIKE '시험직원1559-%'); "
         "DELETE FROM acct_attendance WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1559-%'); "
         "DELETE FROM acct_leave_uses WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1559-%'); "
         "DELETE FROM acct_leave_grants WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1559-%'); "
         "DELETE FROM acct_leave_requests WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1559-%'); "
         "DELETE FROM acct_employees WHERE name LIKE '시험직원1559-%';")
EID = None
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    SID = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    psql(CLEAN)
    le, lid = mk_staff(f'1559l{STAMP % 97}', 'REVIEWER')        # 직원과 연결할 운영 계정(가린 메일 확인)
    ae, aid = mk_staff(f'1559a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    pe, pid = mk_staff(f'1559p{STAMP % 97}', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    try:
        j = (kst - datetime.timedelta(days=400)).strftime('%Y-%m-%d')
        EID = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base, nontax, dependents, account_id) VALUES ('시험직원1559-{STAMP}', '{j}', 3000000, 200000, 2, '{lid}') RETURNING id").split('\n')[0]
        att = psql(f"INSERT INTO acct_attendance (employee_id, work_on, in_at, out_at) VALUES ({EID}, '{today}', '{today} 09:00:00+09', '{today} 18:00:00+09')")
        grt = psql(f"INSERT INTO acct_leave_grants (employee_id, year, days, note) VALUES ({EID}, {year}, 15, '시험 1559 연차')")
        lrq = psql(f"INSERT INTO acct_leave_requests (employee_id, start_on, end_on, half, days, note) VALUES ({EID}, '{year}-12-30', '{year}-12-30', 'FULL', 1, '시험 1559')")
        T0 = psql("SELECT now()")
        s1 = call_h('GET', f'/admin/hr/employees/{EID}/card', TS, 'DISPUTE')
        emp_ = s1.get('employee') or {}
        acc = emp_.get('account') or {}
        att_s = (s1.get('attendance') or {}).get('summary') or {}
        lv = s1.get('leave') or {}
        pay = s1.get('pay') or {}
        docs = s1.get('docs') or {}
        work = s1.get('work') or {}
        flat = json.dumps(s1, ensure_ascii=False)
        ok('② SUPER 200 — 칸 모양(기본 · 근태 · 휴가 · 급여 · 계약 · 교육 · 평가 · 근무 · 자세히 탭) · 오류 칸 없음 · 열람 사유 「분쟁 처리」',
           EID.isdigit() and '!' not in att + grt + lrq and emp_.get('id') == EID and all(k in s1 for k in ('employee', 'attendance', 'leave', 'pay', 'docs', 'work', 'links'))
           and s1.get('errors') == [] and s1.get('viewReason') == '분쟁 처리'
           and all(k in docs for k in ('contractState', 'contracts', 'training', 'reviews')) and all(k in work for k in ('overtime', 'shifts'))
           and (s1.get('links') or {}).get('payroll') == 'acct-payroll' and (s1.get('links') or {}).get('shifts') == 'hrx-shifts',
           f"{EID} {att[-40:]} {grt[-40:]} {lrq[-40:]} {list(s1.keys())[:10]} {s1.get('errors')} {s1.get('viewReason')} {s1.get('_err')} {s1.get('message')}")
        ok('② 칸 값 — 재직일 · 연결 계정 가린 메일 · 이번 달 근태 1일 이상 · 연차 15 · 휴가 신청 1 · 월 기본급 · 부양가족 · 퇴직금 추계(1년 넘음) · 민감 값 없음',
           int(emp_.get('serviceDays') or 0) >= 400 and acc.get('linked') is True and '***@' in (acc.get('email') or '') and le not in flat and 'REVIEWER' in (acc.get('roles') or [])
           and int(att_s.get('days') or 0) >= 1 and lv.get('granted') == 15 and len(lv.get('requests') or []) == 1
           and pay.get('monthlyBase') == 3000000 and pay.get('dependents') == 2 and isinstance(pay.get('lines'), list)
           and (pay.get('severance') or {}).get('eligible') is True and int((pay.get('severance') or {}).get('estimate') or 0) > 0
           and not any(w in flat for w in ('resident', 'rrn', 'account_no', 'bank_code', '"body"')),
           f"{emp_.get('serviceDays')} {acc} {att_s} {lv.get('granted')} {len(lv.get('requests') or [])} {pay.get('monthlyBase')} {pay.get('dependents')} {pay.get('severance')}")
        p1 = call_h('GET', f'/admin/hr/employees/{EID}/card', TP, 'SETTLEMENT')
        a1 = call_h('GET', f'/admin/hr/employees/{EID}/card', TA, 'DISPUTE')
        n1 = call_h('GET', '/admin/hr/employees/999999999999/card', TS, 'DISPUTE')
        n2 = call_h('GET', '/admin/hr/employees/abc/card', TS, 'DISPUTE')
        ok('② 권한 · 없는 번호 — 지급 담당 200 · 일반 운영(ADMIN) 403 · 없는 번호 404 · 숫자 아님 404',
           (p1.get('employee') or {}).get('id') == EID and a1.get('_err') == 403 and n1.get('_err') == 404 and n2.get('_err') == 404,
           f"{(p1.get('employee') or {}).get('id') or p1} {a1.get('_err')} {a1.get('code')} {n1.get('_err')} {n2.get('_err')}")
        s2 = call_h('GET', f'/admin/hr/employees/{EID}/card', TS, None)
        time.sleep(1.5)   # 감사 · 접속기록은 응답 뒤에 씀
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'HR_CARD_VIEW' AND actor_account_id = '{SID}' AND occurred_at >= '{T0}' AND after_data ->> 'id' = '{EID}' AND NOT (after_data ? 'payroll') AND NOT (after_data ? 'employee')")   # idOnly — 급여 · 퇴직금을 감사 기록에 베끼지 않음
        audp = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'HR_CARD_VIEW' AND actor_account_id = '{pid}' AND occurred_at >= '{T0}'")
        auda = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'HR_CARD_VIEW' AND actor_account_id = '{aid}' AND occurred_at >= '{T0}'")
        pii1 = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE actor_account_id = '{SID}' AND target_type = 'EMPLOYEE' AND target_account_id = '{lid}' AND occurred_at >= '{T0}' AND reason = '사원 카드(직원 {EID}) · 사유 분쟁 처리'")
        pii2 = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE actor_account_id = '{SID}' AND target_type = 'EMPLOYEE' AND occurred_at >= '{T0}' AND reason = '사원 카드(직원 {EID}) · 사유 미입력'")
        pii3 = psql(f"SELECT count(*) FROM audit.pii_access_logs WHERE actor_account_id = '{pid}' AND occurred_at >= '{T0}' AND reason = '사원 카드(직원 {EID}) · 사유 정산 · 지급'")
        ok('② 감사 · 열람 사유 — HR_CARD_VIEW 줄(SUPER 2 · 지급 담당 1 · 막힌 ADMIN 0) · 접속기록 사유 분쟁 처리 · 정산 · 지급 · 사유 없이 열면 200 이고 「미입력」',
           int(aud or 0) >= 2 and int(audp or 0) >= 1 and auda == '0' and pii1 == '1' and pii2 == '1' and pii3 == '1'
           and (s2.get('employee') or {}).get('id') == EID and s2.get('viewReason') == '미입력',
           f"{aud} {audp} {auda} {pii1} {pii2} {pii3} {s2.get('viewReason') or s2}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-pii-gate]', timeout=30000)
                pg.check('[data-pii-reason="DISPUTE"]'); pg.click('[data-pii-reason-ok]')
                pg.wait_for_selector(f'[data-hr-card="{EID}"]', timeout=30000); pg.wait_for_timeout(1000)
                seen['secs'] = pg.locator('[data-hr-card-sec]').count()
                seen['more'] = pg.locator('[data-hr-card-more]').count()
                seen['pick'] = pg.locator('[data-hr-card-pick]').input_value()
                pg.evaluate("location.hash = '#/acct-payroll'")
                pg.wait_for_selector(f'[data-hr-card-link="{EID}"]', timeout=30000)
                pg.click(f'[data-hr-card-link="{EID}"]')
                pg.wait_for_selector(f'[data-hr-card="{EID}"]', timeout=30000)
                seen['back'] = pg.locator(f'[data-hr-card="{EID}"]').count()
            res = admin_page(f'/#/hr-card/{EID}', chk)
            if res is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res
                ok('③ 화면 — 열람 사유 고르면 카드 칸 5 · 자세히 단추 · 고른 직원 · 급여 탭 직원 이름 → 사원 카드 · 화면 오류 없음',
                   seen.get('secs') == 5 and (seen.get('more') or 0) >= 5 and seen.get('pick') == EID and seen.get('back') == 1 and not perr, f"{seen} {perr[:2]}")
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        psql(CLEAN)
        for a_, t_ in ((lid, '1559l'), (aid, '1559a'), (pid, '1559p')):
            rm_role(a_, t_)
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
