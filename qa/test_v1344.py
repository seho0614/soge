"""v10.344 (docs/478) 운영 첫 화면 「고객센터 한눈에」 · 하루 요약 리드관 줄
  ① (코드) GET /admin/cs-glance · 첫 화면 상자 · leadDigestLine · screens.json · 문서 478 · 판 v10.344
  ② (API) 답변 전 · 기한 넘김 · 다시 열림 · 해결률 · 못 찾은 낱말 · 리드관 · 회원 403
  ③ (화면) 첫 화면 상자 · 「1:1 문의로」
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

CG, AM, LW = rd('src/modules/support/cs-glance.controller.ts'), rd('src/app.module.ts'), rd('src/modules/admin/launch-watch.service.ts')
DS, CGW, SJ = rd('web/src/app/admin/Dashboard.tsx'), rd('web/src/app/admin/CsGlance.tsx'), rd('spec/screens.json')
ok('① 코드 — 고객센터 한눈에 API(ADMIN · SUPER · 읽기만) · 첫 화면 상자 · 하루 요약 리드관 줄 · screens.json · 문서 478 · 판 v10.344',
   "@Controller('api/v1/admin/cs-glance')" in CG and "@Roles('ADMIN', 'SUPER')" in CG and '@Post' not in CG and 'CsGlanceController' in AM
   and 'leadDigestLine' in LW and "'리드관 꺼짐'" in LW and '<CsGlance onGo={onGo} canGo={canGo} />' in DS and 'data-cs-glance-go' in CGW
   and '"GET /admin/cs-glance"' in SJ and 'cs-glance' in doc('478_') and VT >= (10, 344), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = ''.join(chr(97 + int(c)) for c in str(int(time.time()) % 100000).zfill(5))
    T, W = f'시험 1344 {stamp}', f'시험한눈 {stamp}'
    clean = lambda: psql(f"SET session_replication_role = replica; DELETE FROM inquiries WHERE title LIKE '시험 1344 %'; DELETE FROM faq_search_misses WHERE word LIKE '시험한눈 %'")
    clean()
    try:
        g0 = call('GET', '/admin/cs-glance', None, TA)
        i1 = call('POST', '/inquiries', {'category': 'ETC', 'title': f'{T} 하나', 'body': '시험 1344 문의 본문'}, TB).get('id')
        i2 = call('POST', '/inquiries', {'category': 'ETC', 'title': f'{T} 둘', 'body': '시험 1344 문의 본문'}, TB).get('id')
        od = psql(f"SET session_replication_role = replica; UPDATE inquiries SET due_at = now() - interval '1 hour' WHERE id = '{i1}'")
        call('POST', f'/admin/inquiries/{i2}/answer', {'answer': '시험 1344 답변입니다'}, TA)
        fbk = call('POST', f'/me/inquiries/{i2}/feedback', {'resolved': False}, TB)
        mi = psql(f"INSERT INTO faq_search_misses (word, day, hits) VALUES ('{W}', (now() AT TIME ZONE 'Asia/Seoul')::date, 99999)")
        g1 = call('GET', '/admin/cs-glance', None, TA)
        fb = call('GET', '/admin/cs-glance', None, TB)
        lead = g1.get('lead') or {}
        ok('② API — 답변 전 +2 · 기한 넘김 +1 · 다시 열림 +1 · 30일 아직 +1 · 해결률 숫자 · 못 찾은 낱말 맨 위 · 리드관 칸 넷 · 회원 403',
           i1 and i2 and '!' not in od and '!' not in mi and fbk.get('_err') is None
           and g1.get('open') == (g0.get('open') or 0) + 2 and g1.get('overdue') >= (g0.get('overdue') or 0) + 1
           and g1.get('reopened') == (g0.get('reopened') or 0) + 1 and g1.get('unresolved30') == (g0.get('unresolved30') or 0) + 1
           and isinstance(g1.get('resolvedRate30'), (int, float)) and ((g1.get('misses') or [{}])[0]).get('word') == W and len(g1.get('misses') or []) <= 3
           and isinstance(lead.get('active'), bool) and all(isinstance(lead.get(k), int) for k in ('requests24h', 'noPartner24h', 'emptyCategories'))
           and fb.get('_err') == 403,
           f"{ {k: g1.get(k) for k in ('open', 'overdue', 'reopened', 'unresolved30', 'resolvedRate30')} } · {g0.get('open')} · {(g1.get('misses') or [{}])[0]} · {lead} · {fb.get('_err')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/home', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['box'] = pg.locator('[data-cs-glance]').count()
                seen['lines'] = pg.locator('[data-cs-glance-misses], [data-cs-glance-lead]').count()
                seen['word'] = W in (pg.locator('[data-cs-glance-misses]').first.inner_text() if seen['lines'] else '')
                pg.screenshot(path=os.path.join(HERE, 'v1344_glance.png'), full_page=False)
                if pg.locator('[data-cs-glance-go="inquiries"]').count():
                    pg.locator('[data-cs-glance-go="inquiries"]').click(); pg.wait_for_timeout(2500)
                seen['hash'] = pg.evaluate('location.hash')
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 첫 화면 「고객센터 한눈에」 · 낱말 · 리드관 줄 · 「1:1 문의로」 → 1:1 문의 탭 · 화면 오류 없음',
                   seen.get('box') == 1 and seen.get('lines') == 2 and seen.get('word') and seen.get('hash') == '#/inquiries' and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean()
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
