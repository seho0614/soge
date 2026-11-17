"""v10.342 (docs/475) 리드관 경고 → 운영 알림 LEAD_NO_PARTNER · LEAD_UNDELIVERED(D232)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1342.py
  ① (코드) D232 · sla_alert · 운영 알림 이름 · 문서 475 · 판 v10.342 · 마이그레이션 270
  ② (DB) 꺼진 채 0 · 켜고 시험 업종 · 시험 신청 → 두 알림 · 지우면 풂 · 끄면 풂
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

M32 = rd('prisma/migrations/D232_lead_alerts/migration.sql')
SC, OA = rd('src/worker/scheduler.service.ts'), rd('web/src/app/admin/OpsAlerts.tsx')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D232(지우는 문장 없음 · 리드관 켜졌을 때만 · 두 알림 · 풂) · sla_alert 가 부름 · 운영 알림 한국어 이름 · 문서 475 · 판 v10.342 · 마이그레이션 270',
   'CREATE OR REPLACE FUNCTION public.fn_lead_alert()' in M32 and "'LEAD_NO_PARTNER', 'WARN'" in M32 and "'LEAD_UNDELIVERED', 'CRITICAL'" in M32
   and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M32) and 'SELECT fn_lead_alert() AS n' in SC and 'LEAD_NO_PARTNER:' in OA and 'LEAD_UNDELIVERED:' in OA
   and 'D232' in doc('475_') and VT >= (10, 342) and len(mig) >= 270 and 'D232_lead_alerts' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if DB:
    MEMO, CODE = '시험 1342 리드 경고', 'CSL_TEST1342'
    open_ = lambda c: psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = '{c}' AND resolved_at IS NULL")
    def cleanup():
        psql(f"SET session_replication_role = replica; DELETE FROM consult_requests WHERE memo = '{MEMO}'; DELETE FROM categories WHERE code = '{CODE}'")
        psql("UPDATE gwans SET is_active = false WHERE code = 'LED'")
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'lead.legal_ok'")
        psql("SELECT fn_lead_alert()")
    cleanup()
    try:
        st0 = psql("SELECT (SELECT is_active::text FROM gwans WHERE code = 'LED')")
        z = psql("SELECT fn_lead_alert()")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'lead.legal_ok'")
        on = psql("UPDATE gwans SET is_active = true WHERE code = 'LED'")
        ins = psql(f"SET session_replication_role = replica; INSERT INTO categories (gwan_code, code, name, status, axis, consult_mode) VALUES ('MAL', '{CODE}', '시험1342업종', 'APPROVED', 'CONSULT', 'LEAD'); "
                   f"INSERT INTO consult_requests (category_id, phone_hash, sido, memo, consent_version, consented_at, state, verified_at) "
                   f"SELECT id, 'test1342', '서울', '{MEMO}', 'v1', now(), 'NO_PARTNER', now() FROM categories, generate_series(1, 3) WHERE code = '{CODE}'")
        n1 = psql("SELECT fn_lead_alert()")
        a1, b1 = open_('LEAD_NO_PARTNER'), open_('LEAD_UNDELIVERED')
        cats = psql("SELECT detail->>'categories' FROM ops_alerts WHERE alert_code = 'LEAD_NO_PARTNER' AND resolved_at IS NULL ORDER BY raised_at DESC LIMIT 1")
        psql(f"SET session_replication_role = replica; DELETE FROM consult_requests WHERE memo = '{MEMO}'; DELETE FROM categories WHERE code = '{CODE}'")
        psql("SELECT fn_lead_alert()")
        b2 = open_('LEAD_UNDELIVERED')
        psql("UPDATE gwans SET is_active = false WHERE code = 'LED'")
        psql("SELECT fn_lead_alert()")
        a3, b3 = open_('LEAD_NO_PARTNER'), open_('LEAD_UNDELIVERED')
        ok('② DB — 리드관 꺼진 채 0 · 켜고 업체 0곳 시험 업종 · 전달 못 한 시험 신청 3건 → LEAD_NO_PARTNER(업종 이름) · LEAD_UNDELIVERED 열림 · 시험 줄 지우면 전달 못 함 풂 · 끄면 모두 풂',
           st0 == 'false' and z == '0' and '!' not in on and '!' not in ins and int(n1 or 0) >= 4 and a1 == '1' and b1 == '1' and '시험1342업종' in (cats or '')
           and b2 == '0' and a3 == '0' and b3 == '0', f'{st0} {z} · {on[-60:]} {ins[-60:]} · {n1} · {a1} {b1} · {b2} · {a3} {b3}')
    finally:
        cleanup()
    ok('③ 되돌림 — 리드관 꺼짐 · lead.legal_ok off · 시험 줄 없음',
       psql("SELECT is_active::text FROM gwans WHERE code = 'LED'") == 'false' and psql("SELECT value FROM site_settings WHERE key = 'lead.legal_ok'") == 'off'
       and psql(f"SELECT count(*) FROM categories WHERE code = '{CODE}'") == '0', '')
else:
    print('  (DB 없음 — ② ~ ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
