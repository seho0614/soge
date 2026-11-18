"""v10.347 (D233 · docs/481) 이용 흐름을 운영 화면에서 고치기
  ① (코드) D233 · GET /guide/flows · GET · POST /admin/guide-flows · 관 관리 「이용 흐름」 · 사용자 웹 DB 읽기 · screens.json · 문서 481 · 판 v10.347 · 마이그레이션 271
  ② (DB) 처음 7 · 고치기 막음
  ③ (API) 공개 · 새 판 · 422 · 403
  ④ (화면) 운영 탭 · 사용자 웹 새 제목
  ⑤ 지움
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

M33 = rd('prisma/migrations/D233_guide_flows/migration.sql')
GC, AM, MN = rd('src/modules/help/guide-flow.controller.ts'), rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts')
APP, GF, FP, SJ = rd('web/src/App.tsx'), rd('web/src/app/admin/GuideFlows.tsx'), rd('site/src/app/guide/flows/page.tsx'), rd('spec/screens.json')
STX = rd('src/common/i18n/server-text.en.ts')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D233(지우는 문장 없음 · 고치기 막는 트리거 · 처음 7) · 공개 API · 운영 목록 · 새 판(SUPER · 감사) · 관 관리 「이용 흐름」 · 사용자 웹 DB 읽기(못 읽으면 사전) · 서버 영어 · screens.json · 문서 481 · 판 v10.347 · 마이그레이션 271',
   'CREATE TABLE IF NOT EXISTS public.guide_flows' in M33 and 'trg_guide_flows_guard' in M33 and 'v_guide_flow_current' in M33 and M33.count('::jsonb') == 14
   and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M33.replace('BEFORE UPDATE OR DELETE', ''))
   and "@Controller('api/v1/guide/flows')" in GC and "@Controller('api/v1/admin/guide-flows')" in GC and "@Roles('SUPER')" in GC and "@Audit('GUIDE_FLOW_SAVE', 'GUIDE_FLOW')" in GC
   and 'GuideFlowPublicController' in AM and 'GuideFlowAdminController' in AM and '${' not in GC.split('note:')[0].replace('`「', '')
   and "['guide-flows', '이용 흐름']" in MN and "'checklist', 'guide-flows', 'faq', 'ops-guide', 'siteinfo'" in MN and "screen: 'SB-ADM-SIT-120'" in MN
   and "{tab === 'guide-flows' && <GuideFlows" in APP and 'data-guide-flow-save' in GF and "apiGet<{ rows: DbFlow[] }>('/guide/flows')" in FP and 'data-guide-flows-src' in FP
   and '이용 흐름은 고치거나 지우지 않고 새 판을 더합니다.' in STX and '"SB-ADM-SIT-120"' in SJ and '"GET /guide/flows"' in SJ and 'D233' in doc('481_')
   and VT >= (10, 347) and len(mig) >= 271 and 'D233_guide_flows' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = int(time.time()) % 100000
    ADM = f't1347adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADM}', '시험1347', '{pw}', now()) ON CONFLICT DO NOTHING")
    adm = psql(f"SELECT id FROM accounts WHERE email = '{ADM}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1347', true); INSERT INTO account_roles (account_id, role) VALUES ('{adm}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(ADM, PW)
    TA = login(ADM)
    TITLE = f'시험 1347 가입 {stamp}'
    clean = lambda: psql("SET session_replication_role = replica; DELETE FROM guide_flows WHERE title_ko LIKE '시험 1347 %'")
    clean()
    try:
        n7 = psql("SELECT count(*) FROM v_guide_flow_current WHERE code IN ('join','earn','consult','buy','support','partner','affiliate') AND version = 1")
        up = psql("UPDATE guide_flows SET href = '/x' WHERE code = 'join'")
        de = psql("DELETE FROM guide_flows WHERE code = 'join'")
        ok('② DB — 처음 흐름 7 · 고치기 · 지우기는 트리거가 막음(GUIDE_FLOW:)', n7 == '7' and '!' in up and 'GUIDE_FLOW' in up and '!' in de, f'{n7} · {up[-60:]} · {de[-60:]}')
        p0 = call('GET', '/guide/flows')
        j0 = next((r for r in (p0.get('rows') or []) if r.get('code') == 'join'), {})
        l0 = call('GET', '/admin/guide-flows', None, TS)
        la = call('GET', '/admin/guide-flows', None, TA)
        body = {'titleKo': TITLE, 'whoKo': j0.get('whoKo') or '처음 오신 분', 'stepsKo': j0.get('stepsKo') or ['첫 단계입니다'], 'href': '/signup'}
        s1 = call('POST', '/admin/guide-flows/join', body, TS)
        p1 = call('GET', '/guide/flows')
        j1 = next((r for r in (p1.get('rows') or []) if r.get('code') == 'join'), {})
        bh = call('POST', '/admin/guide-flows/join', {**body, 'href': 'https://x.com'}, TS)
        be = call('POST', '/admin/guide-flows/join', {**body, 'titleEn': 'Only title'}, TS)
        bc = call('POST', '/admin/guide-flows/Bad-Code', body, TS)
        fa = call('POST', '/admin/guide-flows/join', body, TA)
        fb = call('GET', '/admin/guide-flows', None, TB)
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'GUIDE_FLOW_SAVE' AND occurred_at > now() - interval '10 minutes'")
        ok('③ API — 공개 7 · 운영 목록(SUPER 고칠 수 있음 · ADMIN 읽기만) · 새 판 저장 → 공개에 새 제목 · 영어 칸 비움(사전 영어) · 판 +1 · 감사 · 주소 / 아님 422 · 영어 반쪽 422 · 코드 422 · ADMIN 저장 403 · 회원 403',
           len(p0.get('rows') or []) == 7 and j0.get('version') == 1 and l0.get('canEdit') is True and la.get('canEdit') is False and len(la.get('rows') or []) == 7
           and s1.get('version') == 2 and j1.get('titleKo') == TITLE and j1.get('titleEn') is None and j1.get('version') == 2 and int(aud or 0) >= 1
           and bh.get('code') == 'GUIDE_FLOW_HREF' and be.get('code') == 'GUIDE_FLOW_EN' and bc.get('code') == 'GUIDE_FLOW_CODE' and fa.get('_err') == 403 and fb.get('_err') == 403,
           f"{len(p0.get('rows') or [])} · {l0.get('canEdit')} {la.get('canEdit')} · {s1.get('version')} {j1.get('titleKo')} · {bh.get('code')} {be.get('code')} {bc.get('code')} · {fa.get('_err')} {fb.get('_err')}")
        if ADMIN_WEB and SITE:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/guide-flows', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['rows'] = pg.locator('[data-guide-flow-row]').count()
                seen['edit'] = pg.locator('[data-guide-flow-edit]').count()
                row = pg.locator('[data-guide-flow-row="join"]')
                if row.count():
                    row.locator('summary').click(); pg.wait_for_timeout(400)
                    seen['admtitle'] = TITLE in row.inner_text()
                pg.screenshot(path=os.path.join(HERE, 'v1347_admin.png'), full_page=False)
                ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                for i in range(3):
                    ps.goto(SITE + '/guide/flows', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                    if TITLE in ps.locator('[data-guide-flow="join"] h2').inner_text():
                        break
                    ps.wait_for_timeout(16000)
                seen['src'] = ps.locator('[data-guide-flows-src]').get_attribute('data-guide-flows-src')
                seen['sitetitle'] = TITLE in ps.locator('[data-guide-flow="join"] h2').inner_text()
                seen['flows'] = ps.locator('[data-guide-flow]').count()
                ps.screenshot(path=os.path.join(HERE, 'v1347_site.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 관 관리 › 「이용 흐름」 7줄 · 고치기(SUPER) · 새 제목 · 사용자 웹 /guide/flows DB 글 · 새 제목 · 흐름 7 · 화면 오류 없음',
                   seen.get('rows') == 7 and seen.get('edit') == 7 and seen.get('admtitle') and seen.get('src') == 'db' and seen.get('sitetitle') and seen.get('flows') == 7 and not perr,
                   f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB · SITE 없음 — ④ 건너뜀)')
    finally:
        clean()
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1347 지움', true); DELETE FROM account_roles WHERE account_id = '{adm}'; COMMIT;")
    ok('⑤ 지움 — 시험 판 없음 · 처음 판 7 그대로', psql("SELECT count(*) FROM guide_flows WHERE title_ko LIKE '시험 1347 %'") == '0'
       and psql("SELECT count(*) FROM v_guide_flow_current WHERE version = 1") == '7', '')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
