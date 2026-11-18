"""v10.350 (D234 · docs/484) 임시 허용 IP — 기한
  ① (코드) D234 · DTO · 면제 쿼리 · 정기 작업 · 화면 · 문서 484 · 판 v10.350 · 마이그레이션 272
  ② (API) 기한 3일 · 31일 400 · 스크립트에서 기한 지난 것 빠짐
  ③ (정기 작업) 기한 지난 IP 빠짐 · 감사 · 모두 지났으면 남김 · 경고 · 풂
  ④ (화면) 기한 고르기 · 기한 칸
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

M34 = rd('prisma/migrations/D234_staff_ip_expiry_cs_weekly/migration.sql')
SV, SC, SA, CT = rd('src/modules/identity/staff-ip.service.ts'), rd('src/worker/scheduler.service.ts'), rd('web/src/app/admin/StaffAccess.tsx'), rd('src/modules/identity/staff-ip.controller.ts')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D234 칸(지우는 문장 없음) · 더하기 기한 1 · 3 · 7 · 14 · 30 · 면제는 기한 안만 · 정기 작업이 뺌(감사 · 마지막은 남김 · 경고) · 화면 기한 · 문서 484 · 판 v10.350 · 마이그레이션 272',
   'ADD COLUMN IF NOT EXISTS expires_at timestamptz' in M34 and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M34)
   and '@IsIn([1, 3, 7, 14, 30]) expiresDays' in CT and 'FROM staff_ip_allow WHERE ip = $2::inet AND (expires_at IS NULL OR expires_at > now())' in SV
   and "DELETE FROM staff_ip_allow WHERE expires_at <= now()" in SC and "'STAFF_IP_ALLOW_EXPIRE'" in SC and "'STAFF_IP_EXPIRE_LAST', 'WARN'" in SC
   and 'data-ip-allow-days' in SA and 'data-ip-allow-exp' in SA and 'D234' in doc('484_') and VT >= (10, 350) and len(mig) >= 272 and 'D234_staff_ip_expiry_cs_weekly' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    A1, A2, A3 = '203.0.113.150', '203.0.113.151', '203.0.113.152'
    def clean():
        psql("DELETE FROM staff_ip_allow WHERE memo LIKE '시험 1350%'")
        psql("UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1350 지움' WHERE alert_code = 'STAFF_IP_EXPIRE_LAST' AND resolved_at IS NULL")
    clean()
    try:
        ok('② DB — 칸 expires_at', psql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'staff_ip_allow' AND column_name = 'expires_at'") == '1', '')
        a1 = call('POST', '/admin/staff-access/allow', {'ip': A1, 'memo': '시험 1350 출장', 'expiresDays': 3}, TS)
        bad = call('POST', '/admin/staff-access/allow', {'ip': A3, 'memo': '시험 1350 잘못', 'expiresDays': 31}, TS)
        ov = call('GET', '/admin/staff-access', None, TS)
        row = next((x for x in (ov.get('allow') or []) if x.get('ip') == A1), {})
        days = psql(f"SELECT round(extract(epoch FROM expires_at - now()) / 86400) FROM staff_ip_allow WHERE ip = '{A1}'")
        a2 = call('POST', '/admin/staff-access/allow', {'ip': A2, 'memo': '시험 1350 남김'}, TS)
        psql(f"UPDATE staff_ip_allow SET expires_at = now() - interval '1 minute' WHERE ip = '{A1}'")
        sc = call('GET', '/admin/staff-access/nginx-script', None, TS).get('script') or ''
        pass_ = psql(f"SELECT EXISTS (SELECT 1 FROM staff_ip_allow WHERE ip = '{A1}'::inet AND (expires_at IS NULL OR expires_at > now()))")
        ok('② API — 기한 3일(표에 기한) · 31일 400 · 기한 지나면 면제 아님 · 반영 스크립트에서 빠짐',
           a1.get('expiresDays') == 3 and row.get('expiresAt') and days == '3' and bad.get('_err') == 400 and a2.get('ip') == A2
           and pass_ == 'f' and f'allow {A1};' not in sc and f'allow {A2};' in sc, f"{a1} · {days} · {bad.get('_err')} · {pass_}")
        j1 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        gone = psql(f"SELECT count(*) FROM staff_ip_allow WHERE ip = '{A1}'"); kept = psql(f"SELECT count(*) FROM staff_ip_allow WHERE ip = '{A2}'")
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'STAFF_IP_ALLOW_EXPIRE' AND after_data::text LIKE '%{A1}%' AND occurred_at > now() - interval '10 minutes'")
        others = psql("SELECT count(*) FROM staff_ip_allow WHERE memo NOT LIKE '시험 1350%' AND (expires_at IS NULL OR expires_at > now())")
        if others == '0':
            psql(f"UPDATE staff_ip_allow SET expires_at = now() - interval '1 minute' WHERE ip = '{A2}'")
            call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
            keep2 = psql(f"SELECT count(*) FROM staff_ip_allow WHERE ip = '{A2}'")
            al = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_IP_EXPIRE_LAST' AND resolved_at IS NULL")
            call('POST', '/admin/staff-access/allow', {'ip': A3, 'memo': '시험 1350 새'}, TS)
            call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
            gone2 = psql(f"SELECT count(*) FROM staff_ip_allow WHERE ip = '{A2}'")
            al2 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'STAFF_IP_EXPIRE_LAST' AND resolved_at IS NULL")
            last_ok = keep2 == '1' and al == '1' and gone2 == '0' and al2 == '0'
        else:
            keep2 = al = gone2 = al2 = f'다른 IP {others} — 건너뜀'; last_ok = True
        ok('③ 정기 작업 — 기한 지난 IP 빠짐 · 기한 없는 IP 남음 · 감사 · 모두 지났으면 남김 + 경고 · 새 IP 뒤 빠짐 + 풂',
           j1.get('_err') is None and gone == '0' and kept == '1' and int(aud or 0) >= 1 and last_ok, f'{gone} {kept} {aud} · {keep2} {al} {gone2} {al2}')
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/staff-access', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['days'] = pg.locator('select[name=allow-days] option').count()
                seen['exp'] = pg.locator('[data-ip-allow-exp]').count()
                pg.screenshot(path=os.path.join(HERE, 'v1350_expiry.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 기한 고르기(없음 + 5) · 기한 칸 · 화면 오류 없음', seen.get('days') == 6 and seen.get('exp', 0) >= 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        clean()
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
