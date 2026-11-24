"""v10.338 (docs/471) 운영 화면 「리드 현황」 · 리드관 영어 이름 Consult Leads(마이그레이션 없음)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1338.py
  ① (코드) GET /admin/lead-status · 하위 탭 · 영어 이름 · screens.json · 문서 471 · 판 v10.338
  ② (API) 꺼진 채 · 업종 줄 · 시험 신청 → 셈 · days 범위 · 회원 403
  ③ (화면) 리드 현황
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

LC, AM = rd('src/modules/partner/lead-status.controller.ts'), rd('src/app.module.ts')
PT, LS, KEYS = rd('web/src/app/admin/Partners.tsx'), rd('web/src/app/admin/partners/LeadStatus.tsx'), rd('site/src/i18n/keys.ts')
UH, SH, SJ = rd('site/src/components/common/UniHeader.tsx'), rd('site/src/components/common/SiteHeader.tsx'), rd('spec/screens.json')
EN = json.loads(rd('site/src/i18n/messages/en.json') or '{}')
CEN = json.loads(rd('site/src/i18n/messages/en/consult.json') or '{}')
STX = rd('src/common/i18n/server-text.en.ts')
LEDN = 'Leeds' if VT >= (10, 788) else 'Consult Leads'   # v10.788 (docs/897) 영어 이름 「Leeds」(대표 11/25)
ok('① 코드 — 리드 현황 API(읽기만 · PARTNER_MAL) · 하위 탭 「리드 현황」 · 머리줄 영어 Consult Leads · /lead 영어 제목 · 서버 영어 · screens.json · 문서 471 · 판 v10.338',
   "@Controller('api/v1/admin/lead-status')" in LC and "@Roles('ADMIN', 'SUPER', 'PARTNER_MAL')" in LC and '@Post' not in LC and 'LeadStatusController' in AM
   and "{ key: 'status', label: '리드 현황', screen: 'SB-ADM-PTN-100' }" in PT and 'data-lead-status' in LS
   and "'LED'" in KEYS and 'isHeaderGwanKey as isGwanKey' in UH and 'isHeaderGwanKey as isGwanKey' in SH
   and EN.get('header', {}).get('gwan', {}).get('LED') == LEDN and CEN.get('lead', {}).get('title') == LEDN
   and 'Sogae Lead' not in STX and '"SB-ADM-PTN-100"' in SJ and '"GET /admin/lead-status"' in SJ and 'Consult Leads' in doc('471_') and VT >= (10, 338), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    MEMO = '시험 1338 리드 현황'
    clean = lambda: psql(f"SET session_replication_role = replica; DELETE FROM consult_requests WHERE memo = '{MEMO}'")
    clean()
    try:
        s0 = call('GET', '/admin/lead-status', None, TA)
        rows0 = s0.get('rows') or []
        code = next((r.get('code') for r in rows0 if r.get('status') == 'APPROVED'), None) or (rows0[0].get('code') if rows0 else None)
        r0 = next((r for r in rows0 if r.get('code') == code), {})
        ins = psql(f"SET session_replication_role = replica; INSERT INTO consult_requests (category_id, phone_hash, sido, memo, consent_version, consented_at, state, verified_at) "
                   f"SELECT id, 'test1338', '서울', '{MEMO}', 'v1', now(), 'NO_PARTNER', now() FROM categories WHERE code = '{code}'")
        s1 = call('GET', '/admin/lead-status', None, TA)
        r1 = next((r for r in (s1.get('rows') or []) if r.get('code') == code), {})
        d1, d2 = call('GET', '/admin/lead-status?days=1', None, TA), call('GET', '/admin/lead-status?days=500', None, TA)
        fb = call('GET', '/admin/lead-status', None, TB)
        hall = s0.get('hall') or {}
        ok('② API — 리드관 꺼진 채 · lead.legal_ok off · 상담 업종 줄 · 법률 · 세무 빠짐 · 시험 신청(파트너 없음) → 신청 · 파트너 없음 +1 · 합계 +1 · days 1 → 7 · 500 → 90 · 회원 403',
           hall.get('active') is False and hall.get('legalOk') == 'off' and isinstance(hall.get('notifyReady'), bool) and len(rows0) > 0
           and not any(str(r.get('code', '')).endswith(('LEGAL', 'TAX')) for r in rows0) and '!' not in ins
           and r1.get('requests') == (r0.get('requests') or 0) + 1 and r1.get('noPartner') == (r0.get('noPartner') or 0) + 1
           and (s1.get('total') or {}).get('requests') == (s0.get('total') or {}).get('requests', 0) + 1
           and d1.get('days') == 7 and d2.get('days') == 90 and fb.get('_err') == 403,
           f"{hall} · 업종 {len(rows0)} · {code} {r0.get('requests')}→{r1.get('requests')} · {ins[-80:]} · {fb.get('_err')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/partners/status', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['box'] = pg.locator('[data-lead-status]').count()
                seen['hall'] = pg.locator('[data-lead-hall-state] tr').count()
                seen['rows'] = pg.locator('[data-lead-row]').count()
                pg.screenshot(path=os.path.join(HERE, 'v1338_status.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 파트너사 › 「리드 현황」 세 줄 · 업종 표 · 화면 오류 없음',
                   seen.get('box') == 1 and seen.get('hall') == 3 and seen.get('rows', 0) >= 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean()
    ok('④ 지움 — 시험 신청 없음', psql(f"SELECT count(*) FROM consult_requests WHERE memo = '{MEMO}'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
