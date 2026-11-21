"""v10.583 (docs/725) 급여 이체 파일 — 확정 급여 → 은행 대량 이체 CSV · 계좌 암호문 · 화면 가림 · 양식 짝짓기(SUPER) · 내려받기 승인(HRA_PAY_FILE)
  ① (코드) SQL 계좌 · 바뀐 기록 · 양식 · 내려받은 기록 · INV-11 낱말 없음 · 승인 대상 · 스위치 · API 6 · 화면 · 메뉴 · 화면 목록 · 문서 725 · 판
  ② (DB · API) 보기 · 권한 · 계좌 넣기(암호문 · 끝 4자리 · 기록 · 알림) · 양식 · 내려받기(승인 · 스위치 · CSV · SHA-256 · 감사 원문 없음 · 한 번)
  ③ (화면) 회계 › 인사 › 급여 이체 파일 — 가린 계좌
  (두 번 돌아도 통과 — 「시험직원1583-」 직원 · 2001-01 급여 · 계좌 · 양식 · 기록 · 알림 · 승인 요청은 지움 · 스위치는 처음 값으로)
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


def mig_has(word):
    """13차 SQL 은 메인이 D292 ~ 에 붙임(번호 모름) — 글자가 든 마이그레이션 하나를 찾아 돌려줌"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


def biz_days(n, year):
    """오늘 뒤 그 해 안 영업일 n개(없으면 짧은 목록)"""
    r = psql(f"SELECT string_agg(d::date::text, ',' ORDER BY d) FROM (SELECT d FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date + 1, '{year}-12-31'::date, interval '1 day') d WHERE fn_is_business_day(d::date) ORDER BY d LIMIT {n}) x")
    return [x for x in (r or '').split(',') if re.match(r'^\d{4}-\d{2}-\d{2}$', x)]

"""시험 몸통"""
M = mig_has('CREATE TABLE IF NOT EXISTS public.hra_pay_banks')
PF = rd('src/modules/acct/hra-payfile.ts')
HC = rd('src/modules/acct/hra.controller.ts')
EA = rd('src/modules/admin/export-approval.ts')
UI = rd('web/src/app/admin/Hra.tsx')
MN = rd('web/src/lib/adminMenu.ts')
AP = rd('web/src/App.tsx')
MS = re.sub(r'/\*.*?\*/', '', M, flags=re.S)
ok('① 코드 — SQL 계좌(암호문 · 끝 4자리) · 바뀐 기록 · 양식(기본 하나) · 내려받은 기록(쌓기만) · INV-11 낱말 칸 없음 · 승인 대상 HRA_PAY_FILE(DB · 서버 · 옛 배열 글자 그대로) · 스위치 처음 off · API 6 · ExportGate · 화면 가림 · 메뉴 · 화면 목록 HRA-030 · 문서 725 · 판 v10.583',
   'acct_enc     bytea NOT NULL' in M and 'trg_hra_pay_bank_changes_ro' in M and 'trg_hra_payfile_logs_ro' in M and 'uq_hra_bank_formats_default' in M
   and not re.search(r'\b\w*(account_no|bank_code|pg_provider|pg_tid|escrow|vaccount|card_no)\w*\s+(text|bytea|varchar)', MS)
   and "'HRA_PAY_FILE'" in M and "('hra.payfile_export', 'off'" in M and "('hra-payfile', '급여 이체 파일', 'admacc'" in M
   and "(EXPORT_TARGETS as unknown as string[]).push('HRA_PAY_FILE')" in EA and "'PTN_LEADS', 'ITS_SURVEY'] as const" in EA
   and 'pgp_sym_encrypt($3::text, fn_enc_key())' in PF and "'****' || b.acct_tail" in PF and "'HRA_PAY_BANK_CHANGED'" in PF and 'fin-transfer' in PF
   and "@ExportGate(HRA_PAY_FILE_TARGET)" in HC and "@Get('hra/payfile/export')" in HC and "@Put('hra/pay-banks/:id')" in HC and "@Post('hra/bank-formats')" in HC
   and 'export function HraPayFile' in UI and "['hra-payfile', '급여 이체 파일']" in MN and "'hra-payfile': ['SUPER', 'PAYOUT']" in AP and '"SB-ADM-HRA-030"' in SJ
   and '계좌' in doc('725_') and VT >= (10, 583), VER)

STAMP = int(time.time()) % 1000000
EMP = f'시험직원1583-{STAMP}'
YM = '2001-01'
ACC = '123-456-789012'
CLEAN = ("SET session_replication_role = replica; "
         f"DELETE FROM hra_payfile_logs WHERE ym = '{YM}'; "
         "DELETE FROM hra_pay_bank_changes WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1583-%'); "
         "DELETE FROM hra_pay_banks WHERE employee_id IN (SELECT id FROM acct_employees WHERE name LIKE '시험직원1583-%'); "
         "DELETE FROM hra_bank_formats WHERE name LIKE '시험1583-%'; "
         f"DELETE FROM acct_payroll_lines WHERE run_id IN (SELECT id FROM acct_payroll_runs WHERE ym = '{YM}'); "
         f"DELETE FROM acct_payroll_runs WHERE ym = '{YM}'; "
         "DELETE FROM ops_alerts WHERE alert_code = 'HRA_PAY_BANK_CHANGED' AND detail->>'employeeId' IN (SELECT id::text FROM acct_employees WHERE name LIKE '시험직원1583-%'); "
         "DELETE FROM acct_employees WHERE name LIKE '시험직원1583-%';")
if API and DB:
    import consent_ok, hashlib
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    SID = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    psql(CLEAN)
    T0 = psql("SELECT now()")
    keep = getset('hra.payfile_export')
    ae, aid = mk_staff(f'1583a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    pe, pid = mk_staff(f'1583p{STAMP % 97}', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    try:
        E = psql(f"INSERT INTO acct_employees (name, joined_on, monthly_base) VALUES ('{EMP}', '2000-01-01', 3000000) RETURNING id").split('\n')[0]
        R = psql(f"INSERT INTO acct_payroll_runs (ym, pay_day) VALUES ('{YM}', '2001-01-25') RETURNING id").split('\n')[0]
        L = psql(f"INSERT INTO acct_payroll_lines (run_id, employee_id, gross, net) VALUES ({R}, {E}, 3000000, 3000000)")
        F = psql(f"UPDATE acct_payroll_runs SET state = 'FIXED', fixed_by = '{SID}', fixed_at = now() WHERE id = {R}")
        v0 = call('GET', f'/admin/hra/payfile?ym={YM}', None, TS)
        ln = lambda v: next((x for x in v.get('lines') or [] if x.get('employeeId') == E), {})
        a403 = call('GET', f'/admin/hra/payfile?ym={YM}', None, TA)
        p200 = call('GET', f'/admin/hra/payfile?ym={YM}', None, TP)
        ok('② 보기 — 확정 급여 · 시험 직원 줄(계좌 없음) · 빠진 계좌 ≥ 1 · 준비 안 됨 · 처음 양식 · ADMIN 403 · 지급 담당 200',
           R.isdigit() and '!' not in L + F and (v0.get('run') or {}).get('state') == 'FIXED' and ln(v0).get('net') == 3000000 and ln(v0).get('bank') is None
           and int((v0.get('total') or {}).get('missing') or 0) >= 1 and v0.get('ready') is False and any(f.get('isDefault') for f in v0.get('formats') or [])
           and a403.get('_err') == 403 and (p200.get('run') or {}).get('state') == 'FIXED',
           f"{R} {L[-40:]} {F[-40:]} {(v0.get('run') or {}).get('state')} {ln(v0)} {v0.get('total')} {a403.get('_err')}")
        b1 = call('PUT', f'/admin/hra/pay-banks/{E}', {'bank': '04', 'acct': ACC, 'holder': '홍길동', 'reason': '시험 1583'}, TS)
        b2 = call('PUT', f'/admin/hra/pay-banks/{E}', {'bank': '004', 'acct': ACC, 'holder': '홍길동', 'reason': '시험 1583 본인 요청'}, TP)
        enc = psql(f"SELECT acct_tail || '|' || (position('123456789012' in encode(acct_enc, 'escape')) = 0) FROM hra_pay_banks WHERE employee_id = {E}")
        ch = psql(f"SELECT count(*) || '|' || coalesce(max(tail_after), '') FROM hra_pay_bank_changes WHERE employee_id = {E}")
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'HRA_PAY_BANK_CHANGED' AND detail->>'employeeId' = '{E}' AND raised_at >= '{T0}'")
        v1 = call('GET', f'/admin/hra/payfile?ym={YM}', None, TS)
        flat = json.dumps(v1, ensure_ascii=False)
        dl = psql(f"DELETE FROM hra_pay_banks WHERE employee_id = {E}")
        inv = psql("SELECT count(*) FROM v_inv11_violations WHERE table_name LIKE 'hra\\_%'")
        ok('② 계좌 — 은행 코드 2자리 400 · 지급 담당 넣기(끝 4자리만 돌려줌) · 암호문(원문 없음) · 바뀐 기록 · 운영 알림 · 화면 응답에 원문 없음 · 지우기 막음 · INV-11 0',
           b1.get('_err') == 400 and b2.get('ok') is True and b2.get('account') == '****9012' and b2.get('created') is True and enc in ('9012|t', '9012|true') and ch == '1|9012'
           and int(al or 0) >= 1 and ln(v1).get('account') == '****9012' and '123456789012' not in flat and ACC not in flat and 'HRA_PAY_BANK' in dl and inv == '0',
           f"{b1.get('_err')} {b2.get('account') or b2} {enc} {ch} {al} {ln(v1).get('account')} {dl[-40:]} {inv}")
        f1 = call('POST', '/admin/hra/bank-formats', {'name': f'시험1583-{STAMP} 계좌 없음', 'columns': [{'field': 'bank'}, {'field': 'amount'}]}, TS)
        f2 = call('POST', '/admin/hra/bank-formats', {'name': f'시험1583-{STAMP}', 'columns': [{'field': 'name', 'title': '이름'}, {'field': 'bank', 'title': '은행'}, {'field': 'acct', 'title': '계좌'}, {'field': 'amount', 'title': '금액'}, {'field': 'pay_day', 'title': '지급일'}], 'header': True, 'dateStyle': 'YYYY-MM-DD'}, TS)
        f3 = call('POST', '/admin/hra/bank-formats', {'name': f'시험1583-{STAMP}', 'columns': [{'field': 'bank'}, {'field': 'acct'}, {'field': 'amount'}]}, TS)
        f4 = call('POST', '/admin/hra/bank-formats', {'name': f'시험1583-{STAMP} 지급', 'columns': [{'field': 'bank'}, {'field': 'acct'}, {'field': 'amount'}]}, TP)
        ok('② 양식 — 계좌 칸 없으면 422 · SUPER 만들기 · 같은 이름 409 · 지급 담당 403',
           f1.get('code') == 'HRA_BANK_FORMAT' and f2.get('ok') is True and f3.get('_err') == 409 and f4.get('_err') == 403,
           f"{f1.get('code')} {f2.get('ok') or f2} {f3.get('_err')} {f4.get('_err')}")
        n1 = call('GET', f'/admin/hra/payfile/export?ym={YM}', None, TS)
        tkt = __import__('export_ticket').get(TS, 'HRA_PAY_FILE', TS)
        if not tkt:
            ok('② 내려받기 — 승인 번호 없으면 422 EXPORT_NEED_APPROVAL(승인 번호를 못 받는 점검판이라 나머지 건너뜀)', n1.get('code') == 'EXPORT_NEED_APPROVAL', f"{n1.get('code')}")
        else:
            off = call('GET', f'/admin/hra/payfile/export?ym={YM}&formatId={f2.get("id")}&ticket={tkt}', None, TS)
            on = call('PUT', '/admin/hra/settings', {'payfileExport': True, 'reason': '시험 1583'}, TS)
            x1 = call('GET', f'/admin/hra/payfile/export?ym={YM}&formatId={f2.get("id")}&ticket={tkt}', None, TS)
            x2 = call('GET', f'/admin/hra/payfile/export?ym={YM}&formatId={f2.get("id")}&ticket={tkt}', None, TS)
            csv = x1.get('csv') or ''
            lg = psql(f"SELECT count(*) || '|' || max(sha256) FROM hra_payfile_logs WHERE ym = '{YM}' AND made_at >= '{T0}'")
            time.sleep(1.5)
            au = psql(f"SELECT count(*) || '|' || bool_and(position('123456789012' in after_data::text) = 0) FROM audit.audit_logs WHERE action = 'HRA_PAYFILE_EXPORT' AND actor_account_id = '{SID}' AND occurred_at >= '{T0}'")
            ok('② 내려받기 — 승인 없으면 422 · 꺼져 있으면 422(번호 안 씀) · 켜고 내려받기 · CSV 에 원문 계좌 · 양식 칸 · 지급일 모양 · SHA-256 기록 · 감사에 원문 없음 · 같은 번호 두 번째 422',
               n1.get('code') == 'EXPORT_NEED_APPROVAL' and off.get('code') == 'HRA_PAYFILE_OFF' and on.get('ok') is True and x1.get('ok') is True
               and '123456789012' in csv and EMP in csv and ',004,' in csv and '3000000' in csv and '2001-01-25' in csv and csv.startswith('﻿이름,은행,계좌,금액,지급일')
               and lg == f"1|{hashlib.sha256(csv.encode('utf-8')).hexdigest()}" and x1.get('sha256') == hashlib.sha256(csv.encode('utf-8')).hexdigest()
               and au.startswith('1|t') and x2.get('code') == 'EXPORT_NEED_APPROVAL',
               f"{n1.get('code')} {off.get('code')} {on.get('ok')} {x1.get('ok') or x1} {csv[:60]!r} {lg} {au} {x2.get('code')}")
        if ADMIN_WEB:
            def chk(pg, seen):
                pg.wait_for_selector('[data-hra-payfile]', timeout=30000)
                pg.fill('input[type=month]', YM); pg.wait_for_timeout(2500)
                seen['masked'] = pg.locator(f'[data-hra-payfile-line="{E}"] [data-hra-acct-masked]').first.inner_text() if pg.locator(f'[data-hra-payfile-line="{E}"]').count() else ''
                seen['raw'] = '123456789012' in pg.content()
            res = admin_page('/#/hra-payfile', chk)
            if res is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = res
                ok('③ 화면 — 급여 이체 파일 줄에 가린 계좌(****9012) · 원문 없음 · 화면 오류 없음', seen.get('masked') == '****9012' and seen.get('raw') is False and not perr, f"{seen} {perr[:2]}")
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        psql(CLEAN)
        psql(f"DELETE FROM export_requests WHERE target = 'HRA_PAY_FILE' AND requested_at >= '{T0}'")
        setting('hra.payfile_export', keep or 'off', '1583 되돌림')
        for a_, t_ in ((aid, '1583a'), (pid, '1583p')):
            rm_role(a_, t_)
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
