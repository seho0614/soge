"""v10.354 (D235 · docs/488) 월간 보안 보고
  ① (코드) D235 설정 · 정기 작업 · 글 · 같은 달 한 번 · API · 문서 488 · 판 v10.354
  ② (API) 미리 보기 · 403
  ③ (정기 작업) 보냄 · 다시 돌리면 건너뜀 · off
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

M26 = rd('prisma/migrations/D226_faq_feedback_inquiry_templates/migration.sql')
FB, TC = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/support/inquiry-template.controller.ts')
FS, AM = rd('src/modules/help/faq-admin.service.ts'), rd('src/app.module.ts')
HUB, FA, DESK = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
SJ = rd('spec/screens.json')

M35, SR, SRC = rd('prisma/migrations/D235_audit_chain_security_monthly/migration.sql'), rd('src/modules/admin/security-report.ts'), rd('src/modules/admin/security-report.controller.ts')
SC, WC, SB = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('web/src/app/admin/SecurityBoxes.tsx')
ok('① 코드 — D235 설정 ops.security_monthly · 정기 작업 security_monthly(매일 09:20) · 지난달 숫자 글 · 같은 달 한 번(detail.month) · 미리 보기 API(SUPER) · 작업 이름 · 화면 · 문서 488 · 판 v10.354',
   "('ops.security_monthly', 'on', 'ADMIN'" in M35 and "VALUES ('security_monthly', 1440, 9, 20, NULL, true" in M35 and 'export function securityMonthlyText' in SR
   and "date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month'" in SR and "alert_code = 'SECURITY_MONTHLY' AND detail->>'month' = $1" in SC
   and "@Get('monthly')" in SRC and "'security_monthly'," in WC and 'data-sec-monthly-toggle' in SB and 'security_monthly' in doc('488_') and VT >= (10, 354), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = int(time.time()) % 100000
    ADM = f't1354adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADM}', '시험1354', '{pw}', now()) ON CONFLICT DO NOTHING")
    adm = psql(f"SELECT id FROM accounts WHERE email = '{ADM}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1354', true); INSERT INTO account_roles (account_id, role) VALUES ('{adm}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(ADM, PW)
    TA = login(ADM)
    try:
        m = call('GET', '/admin/security/monthly', None, TS)
        st = m.get('stats') or {}
        lines = (m.get('text') or '').split('\n')
        prev = (datetime.date.today().replace(day=1) - datetime.timedelta(days=1)).strftime('%Y-%m')
        fa = call('GET', '/admin/security/monthly', None, TA); fb = call('GET', '/admin/security/monthly', None, TB)
        ok('② API — 미리 보기 글 10줄(제목 · 권한 · 설정 · 개인정보 · 로그인 · 막힌 접속 · 급한 알림 · 탈퇴 · 가입 차단(v10.363) · 감사 기록 · 끄기) · 지난달 · ADMIN · 회원 403',
           len(lines) == 10 and lines[0] == f'[소개뱅크] 월간 보안 보고 {st.get("month")}' and st.get('month') in (prev, datetime.date.today().strftime('%Y-%m'))
           and isinstance(st.get('grants'), int) and 'ops.security_monthly' in lines[-1] and fa.get('_err') == 403 and fb.get('_err') == 403,
           f"{lines[:1]} · {st.get('month')} · {fa.get('_err')} {fb.get('_err')}")
        mon = st.get('month') or ''
        dele = lambda: psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'SECURITY_MONTHLY' AND detail->>'month' = '{mon}'")
        dele()
        t0 = psql("SELECT now()")
        j1 = call('POST', '/admin/jobs', {'job': 'security_monthly'}, TS)
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SECURITY_MONTHLY' AND detail->>'month' = '{mon}'")
        bd = psql(f"SELECT count(*) FROM ops_board_posts WHERE title LIKE '월간 보안 보고%' AND created_at >= '{t0}'")
        j2 = call('POST', '/admin/jobs', {'job': 'security_monthly'}, TS)
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'ops.security_monthly'")
        dele()
        j3 = call('POST', '/admin/jobs', {'job': 'security_monthly'}, TS)
        al3 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SECURITY_MONTHLY' AND detail->>'month' = '{mon}'")
        ok('③ 정기 작업 — 그달 보고 없으면 보냄(운영 알림 · 게시판) · 다시 돌리면 ALREADY_SENT · off 면 안 보냄',
           (j1.get('detail') or {}).get('sent') is True and al == '1' and bd == '1' and (j2.get('detail') or {}).get('skipped') == 'ALREADY_SENT'
           and (j3.get('detail') or {}).get('off') is True and al3 == '0', f"{j1.get('detail', {}).get('sent')} {al} {bd} · {j2.get('detail')} · {j3.get('detail')} {al3}")
    finally:
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'ops.security_monthly'")
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1354 지움', true); DELETE FROM account_roles WHERE account_id = '{adm}'; COMMIT;")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
