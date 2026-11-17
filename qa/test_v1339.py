"""v10.339 (docs/472) 운영 화면 「업무 안내」(D229 ops_guides)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1339.py
  ① (코드) D229 · GET · POST /admin/ops-guides · 메뉴 · OpsGuide · screens.json · 문서 472 · 판 v10.339 · 마이그레이션 267
  ② (DB) 처음 12 · 고치기 · 지우기 막힘
  ③ (API) 목록 · 새 판 · 422 · 403
  ④ (화면) 펼침 · 「이 화면」
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

M29 = rd('prisma/migrations/D229_ops_guides/migration.sql')
OC, AM, MN = rd('src/modules/admin/ops-guide.controller.ts'), rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts')
APP, OG, SJ = rd('web/src/App.tsx'), rd('web/src/app/admin/OpsGuide.tsx'), rd('spec/screens.json')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D229(지우는 문장 없음 · 고치기 막는 트리거 · 처음 12) · 목록 API(운영 역할 모두) · 새 판 API(SUPER · 감사) · 관 관리 「업무 안내」 · 「이 화면」 · screens.json · 문서 472 · 판 v10.339 · 마이그레이션 267',
   'CREATE TABLE IF NOT EXISTS public.ops_guides' in M29 and 'trg_ops_guides_guard' in M29 and 'v_ops_guide_current' in M29 and M29.count('::jsonb') == 12
   and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M29.replace('BEFORE UPDATE OR DELETE', ''))
   and "@Controller('api/v1/admin/ops-guides')" in OC and "@Roles('SUPER')" in OC and "@Audit('OPS_GUIDE_SAVE', 'OPS_GUIDE')" in OC and 'OpsGuideController' in AM
   and "['ops-guide', '업무 안내']" in MN and "'faq', 'ops-guide', 'siteinfo'" in MN and "screen: 'SB-ADM-SIT-110'" in MN
   and "{tab === 'ops-guide' && <OpsGuide" in APP and "'ops-guide': ['ADMIN', 'SUPER', 'REVIEWER'" in APP and 'data-ops-guide-go' in OG
   and '"SB-ADM-SIT-110"' in SJ and '"POST /admin/ops-guides/{code}"' in SJ and 'D229' in doc('472_')
   and VT >= (10, 339) and len(mig) >= 267 and 'D229_ops_guides' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = int(time.time()) % 100000
    ADM = f't1339adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADM}', '시험1339', '{pw}', now()) ON CONFLICT DO NOTHING")
    adm = psql(f"SELECT id FROM accounts WHERE email = '{ADM}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1339', true); INSERT INTO account_roles (account_id, role) VALUES ('{adm}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(ADM, PW)
    TA = login(ADM)
    CODE = 'TEST_' + ''.join(chr(65 + int(c)) for c in str(stamp).zfill(5))
    clean = lambda: psql(f"SET session_replication_role = replica; DELETE FROM ops_guides WHERE code LIKE 'TEST_%'")
    clean()
    try:
        n12 = psql("SELECT count(*) FROM v_ops_guide_current WHERE code IN ('INQUIRY_ANSWER','FAQ_MANAGE','MEMBER_ROLE','REVIEW_QUEUE','CATEGORY_APPROVE','PARTNER_QUAL','DISPUTE','SETTLE_PAYOUT','MALL_OPS','OPS_ALERTS','TERMS_PUBLISH','LEAD_HALL_ON')")
        up = psql("UPDATE ops_guides SET title = '바꿈' WHERE code = 'DISPUTE'")
        de = psql("DELETE FROM ops_guides WHERE code = 'DISPUTE'")
        ok('② DB — 처음 업무 12가지 · 고치기 · 지우기는 트리거가 막음(OPS_GUIDE:)', n12 == '12' and '!' in up and 'OPS_GUIDE' in up and '!' in de, f'{n12} · {up[-60:]} · {de[-60:]}')
        l0 = call('GET', '/admin/ops-guides', None, TS)
        la = call('GET', '/admin/ops-guides', None, TA)
        g = next((r for r in (l0.get('rows') or []) if r.get('code') == 'INQUIRY_ANSWER'), {})
        s1 = call('POST', f'/admin/ops-guides/{CODE}', {'title': '시험 1339 업무', 'who': 'ADMIN', 'steps': [{'t': '첫 단계입니다', 'go': 'inquiries'}, {'t': '둘째 단계'}]}, TS)
        s2 = call('POST', f'/admin/ops-guides/{CODE}', {'title': '시험 1339 업무 고침', 'who': 'ADMIN', 'steps': [{'t': '첫 단계 고침', 'go': 'mainops/gwan'}], 'note': '알아 둘 것'}, TS)
        l1 = call('GET', '/admin/ops-guides', None, TS)
        t1 = next((r for r in (l1.get('rows') or []) if r.get('code') == CODE), {})
        bad = call('POST', f'/admin/ops-guides/{CODE}', {'title': '시험 1339', 'who': 'ADMIN', 'steps': [{'t': '단계', 'go': 'https://x.com'}]}, TS)
        bc = call('POST', '/admin/ops-guides/bad-code', {'title': '시험 1339', 'who': 'ADMIN', 'steps': [{'t': '단계'}]}, TS)
        fa = call('POST', f'/admin/ops-guides/{CODE}', {'title': '시험 1339', 'who': 'ADMIN', 'steps': [{'t': '단계'}]}, TA)
        fb = call('GET', '/admin/ops-guides', None, TB)
        vers = psql(f"SELECT count(*) FROM ops_guides WHERE code = '{CODE}'")
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'OPS_GUIDE_SAVE' AND occurred_at > now() - interval '10 minutes'")
        ok('③ API — 목록 12 이상 · 단계 · 「이 화면」 · SUPER 고칠 수 있음 · ADMIN 은 읽기만 · 새 판 1 → 2(옛 판 남음 · 감사) · 잘못된 탭 · 코드 422 · ADMIN 저장 403 · 회원 403',
           len(l0.get('rows') or []) >= 12 and l0.get('canEdit') is True and la.get('canEdit') is False and len(la.get('rows') or []) >= 12
           and (g.get('steps') or [{}])[0].get('go') == 'inquiries' and s1.get('version') == 1 and s2.get('version') == 2
           and t1.get('version') == 2 and t1.get('title') == '시험 1339 업무 고침' and t1.get('versions') == 2 and vers == '2' and int(aud or 0) >= 2
           and bad.get('_err') == 422 and bad.get('code') == 'OPS_GUIDE_TAB' and bc.get('_err') == 422 and fa.get('_err') == 403 and fb.get('_err') == 403,
           f"{len(l0.get('rows') or [])} · {l0.get('canEdit')} {la.get('canEdit')} · {s1.get('version')} {s2.get('version')} · {bad.get('code')} {bc.get('code')} · {fa.get('_err')} {fb.get('_err')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/ops-guide', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['rows'] = pg.locator('[data-ops-guide-row]').count()
                row = pg.locator('[data-ops-guide-row="INQUIRY_ANSWER"]')
                if row.count():
                    row.locator('summary').click(); pg.wait_for_timeout(600)
                    seen['steps'] = row.locator('[data-ops-guide-step]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1339_guide.png'), full_page=False)
                    row.locator('[data-ops-guide-go="inquiries"]').first.click(); pg.wait_for_timeout(2500)
                    seen['hash'] = pg.evaluate('location.hash'); seen['desk'] = pg.locator('[data-inquiry-desk]').count()
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 관 관리 › 「업무 안내」 12가지 이상 · 펼치면 단계 5 · 「이 화면」 → 회원 › 1:1 문의 · 화면 오류 없음',
                   seen.get('rows', 0) >= 12 and seen.get('steps') == 5 and seen.get('hash') == '#/inquiries' and seen.get('desk') == 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        clean()
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1339 지움', true); DELETE FROM account_roles WHERE account_id = '{adm}'; COMMIT;")
    ok('⑤ 지움 — 시험 업무 없음 · 처음 12 그대로', psql("SELECT count(*) FROM ops_guides WHERE code LIKE 'TEST_%'") == '0'
       and psql("SELECT count(*) FROM ops_guides WHERE code = 'DISPUTE'") == '1', '')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
