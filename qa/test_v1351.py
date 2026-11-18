"""v10.351 (docs/485) 업무 안내 · 이용 흐름 — 지난 판 보기 · 되돌리기
  ① (코드) API 둘 · 공용 부품 · 두 화면 · screens.json · 문서 485 · 판 v10.351
  ② (API) 지난 판 · 404 · 회원 403
  ③ (화면) 지난 판 · 다른 줄 · 되돌리기 → 새 판
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

OC, GC, VH = rd('src/modules/admin/ops-guide.controller.ts'), rd('src/modules/help/guide-flow.controller.ts'), rd('web/src/app/admin/VersionHistory.tsx')
OG, GF, SJ = rd('web/src/app/admin/OpsGuide.tsx'), rd('web/src/app/admin/GuideFlows.tsx'), rd('spec/screens.json')
ok('① 코드 — 지난 판 API 둘(404) · 공용 부품(다른 줄 · 되돌리기 = 새 판) · 업무 안내 · 이용 흐름 「지난 판」 · screens.json · 문서 485 · 판 v10.351',
   "@Get(':code/versions')" in OC and "@Get(':code/versions')" in GC and "NotFound('그 업무 안내가 없습니다.')" in OC and 'data-version-restore' in VH and 'data-version-del' in VH
   and '<VersionHistory path={`/admin/ops-guides/${g.code}/versions`}' in OG and '<VersionHistory path={`/admin/guide-flows/${f.code}/versions`}' in GF
   and '"GET /admin/ops-guides/{code}/versions"' in SJ and '"GET /admin/guide-flows/{code}/versions"' in SJ and '지난 판' in doc('485_') and VT >= (10, 351), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = int(time.time()) % 100000
    CODE = 'TEST_V' + ''.join(chr(65 + int(c)) for c in str(stamp).zfill(5))
    clean = lambda: psql("SET session_replication_role = replica; DELETE FROM ops_guides WHERE code LIKE 'TEST_V%'")
    clean()
    try:
        s1 = call('POST', f'/admin/ops-guides/{CODE}', {'title': '시험 1351 처음', 'who': 'ADMIN', 'steps': [{'t': '첫 단계', 'go': 'inquiries'}, {'t': '둘째 단계'}]}, TS)
        s2 = call('POST', f'/admin/ops-guides/{CODE}', {'title': '시험 1351 고침', 'who': 'ADMIN', 'steps': [{'t': '첫 단계 고침'}], 'note': '알아 둘 것'}, TS)
        v = call('GET', f'/admin/ops-guides/{CODE}/versions', None, TS)
        rows = v.get('rows') or []
        nf = call('GET', '/admin/ops-guides/NO_SUCH_CODE/versions', None, TS)
        gv = call('GET', '/admin/guide-flows/join/versions', None, TS)
        gn = call('GET', '/admin/guide-flows/nosuch/versions', None, TS)
        fb = call('GET', f'/admin/ops-guides/{CODE}/versions', None, TB)
        fg = call('GET', '/admin/guide-flows/join/versions', None, TB)
        ok('② API — 업무 안내 지난 판 2(높은 판부터 · 글 · 단계) · 없는 코드 404 · 이용 흐름 join 지난 판 · 없는 흐름 404 · 회원 403',
           s1.get('version') == 1 and s2.get('version') == 2 and [r.get('version') for r in rows] == [2, 1] and rows[1].get('title') == '시험 1351 처음'
           and (rows[1].get('steps') or [{}])[0].get('go') == 'inquiries' and nf.get('_err') == 404 and (gv.get('rows') or [{}])[-1].get('version') == 1
           and gn.get('_err') == 404 and fb.get('_err') == 403 and fg.get('_err') == 403,
           f"{[r.get('version') for r in rows]} · {nf.get('_err')} {gn.get('_err')} · {fb.get('_err')} {fg.get('_err')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.on('dialog', lambda d: d.accept())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/ops-guide', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                row = pg.locator(f'[data-ops-guide-row="{CODE}"]')
                if row.count():
                    row.locator('summary').click(); pg.wait_for_timeout(500)
                    row.locator(f'[data-ops-guide-hist="{CODE}"]').click(); pg.wait_for_timeout(1500)
                    seen['rows'] = row.locator('[data-version-row]').count()
                    seen['del'] = row.locator('[data-version-del]').count(); seen['add'] = row.locator('[data-version-add]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1351_versions.png'), full_page=False)
                    row.locator('[data-version-restore="1"]').click(); pg.wait_for_timeout(2500)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                v3 = call('GET', f'/admin/ops-guides/{CODE}/versions', None, TS).get('rows') or []
                ok('③ 화면 — 「지난 판」 → 판 2줄 · 빠진 줄 · 더한 줄 · 「이 판으로 되돌리기」(1판) → 3판 = 1판 글 · 화면 오류 없음',
                   seen.get('rows') == 2 and seen.get('del', 0) >= 1 and seen.get('add', 0) >= 1 and len(v3) == 3 and v3[0].get('title') == '시험 1351 처음'
                   and len(v3[0].get('steps') or []) == 2 and not perr, f"{seen} · {[(r.get('version'), r.get('title')) for r in v3]} · {perr[:2]}")
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean()
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
