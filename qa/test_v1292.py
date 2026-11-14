"""v10.292 (docs/415) — 운영 화면 공지 목록 걸러 보기 · 제목 찾기 · 50줄씩 넘기기

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1292.py

  ① (코드) adminNotices(status · q · page · total) · 컨트롤러 쿼리 · 노출 › 메인 운영 › 콘텐츠 「공지」 표 걸러 보기 · 찾기 · 넘기기 · 문서 415 · 마이그레이션 254 · 판 v10.292
  ② (API) 초안 55 + 게시 1(같은 표시) — 찾기 56 · 첫 쪽 50 · 둘째 쪽 6(겹침 없음) · 상태 DRAFT 55 · LIVE 1 · 이상한 상태는 무시 · 대소문자 안 가림 · 응답은 배열 · 회원 403
  ③ (화면) 상태 고르기 · 찾기 · 「뒤」 쪽 · 「모두 보기」 · 화면 오류 없음
  만든 공지는 지움(두 번 돌아도 통과).
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB, SITE = os.environ.get('ADMIN_WEB'), os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D415 = next((open(os.path.join(K, 'docs', x), encoding='utf-8').read() for x in docs if x.startswith('415_')), '')
mig = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))] if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
verok = lambda n: tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, n)
SS, SC, MO = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts'), rd('web/src/app/admin/MainOps.tsx')

ok('① 서버 — adminNotices(상태 5개만 · 제목 글자 그대로 · 50줄 · 줄마다 total) · 쿼리 status · q · page',
   'async adminNotices(' in SS and "NOTICE_STATUSES = ['DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'TAKEN_DOWN']" in SS and 'strpos(lower(x.title), lower($3)) > 0' in SS
   and 'LIMIT 50 OFFSET $4' in SS and 'count(*) OVER ()::int AS total' in SS and "@ApiQuery({ name: 'page'" in SC and 'this.svc.adminNotices({ gwanCode, status, q' in SC, f'{len(SS)}')
ok('① 화면 · 문서 — 「공지」 표 상태 고르기 · 찾기 · 「앞」 · 「뒤」 · 쪽 · 문서 415 · 마이그레이션 254 · 판 v10.292',
   all(x in MO for x in ('data-notice-filter-status', 'data-notice-q-go', 'data-notice-prev', 'data-notice-next', 'data-notice-page', 'data-notice-filter-clear', 'data-notice-total'))
   and '걸러 보기' in D415 and len(mig) == 254 and verok(292), f'{len(mig)} · {VER} · 415 {bool(D415)}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()



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


stamp = str(int(time.time()))[-7:]
tag = f'Q{stamp}X'
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    try:
        psql(f"INSERT INTO notices (gwan_code, title, body, grades) SELECT 'HLT', '시험 1292 {tag} ' || g, 'x', ARRAY['MEMBER'] FROM generate_series(1, 55) g")
        psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at) VALUES ('HLT', '시험 1292 {tag} 게시', 'x', ARRAY['MEMBER'], now() - interval '1 minute')")
        q = urllib.parse.quote(tag.lower())
        p1 = call('GET', f'/admin/notices?q={q}', None, TS)
        p2 = call('GET', f'/admin/notices?q={q}&page=2', None, TS)
        ids1 = {x.get('id') for x in p1} if isinstance(p1, list) else set()
        ids2 = {x.get('id') for x in p2} if isinstance(p2, list) else set()
        ok('② API — 제목 찾기(대소문자 안 가림) 56 · 첫 쪽 50 · 둘째 쪽 6 · 겹침 없음 · 줄마다 total 56 · page',
           isinstance(p1, list) and len(p1) == 50 and isinstance(p2, list) and len(p2) == 6 and not (ids1 & ids2)
           and all(x.get('total') == 56 for x in p1 + p2) and p2[0].get('page') == 2, f"{len(p1) if isinstance(p1, list) else p1} · {len(p2) if isinstance(p2, list) else p2} · {(p1 or [{}])[0].get('total') if isinstance(p1, list) else ''}")
        dr = call('GET', f'/admin/notices?q={q}&status=DRAFT', None, TS)
        lv = call('GET', f'/admin/notices?q={q}&status=LIVE', None, TS)
        bad = call('GET', f'/admin/notices?q={q}&status=BOGUS', None, TS)
        none = call('GET', f'/admin/notices?q={q}&status=ENDED', None, TS)
        ok('② API — 상태 DRAFT 55(모두 초안) · LIVE 1 · 끝남 0 · 이상한 상태는 무시(56)',
           isinstance(dr, list) and dr and dr[0].get('total') == 55 and all(x.get('status') == 'DRAFT' for x in dr)
           and isinstance(lv, list) and len(lv) == 1 and lv[0].get('status') == 'LIVE' and isinstance(none, list) and none == []
           and isinstance(bad, list) and bad and bad[0].get('total') == 56, f"{(dr or [{}])[0].get('total') if isinstance(dr, list) and dr else dr} · {len(lv) if isinstance(lv, list) else lv} · {none} · {(bad or [{}])[0].get('total') if isinstance(bad, list) and bad else bad}")
        al = call('GET', '/admin/notices', None, TS)
        mb = call('GET', '/admin/notices', None, TB)
        ok('② API — 조건 없이도 배열(50줄 아래) · 회원 403',
           isinstance(al, list) and 0 < len(al) <= 50 and mb.get('_err') == 403 if isinstance(mb, dict) else False, f"{len(al) if isinstance(al, list) else al} · {mb.get('_err') if isinstance(mb, dict) else mb}")

        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: perr.append(str(e)[:120])); pg.on('dialog', lambda d: d.dismiss())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.wait_for_selector('[data-state-check]', timeout=30000)
                pg.goto(ADMIN_WEB + '/#/mainops/content', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['bar'] = pg.locator('[data-notice-filter]').count()
                pg.fill('[data-notice-q]', tag); pg.click('[data-notice-q-go]'); pg.wait_for_timeout(2000)
                seen['q'] = pg.locator('[data-notice-row]').count(); seen['page'] = pg.locator('[data-notice-page]').get_attribute('data-notice-page')
                pg.click('[data-notice-next]'); pg.wait_for_timeout(2000)
                seen['q2'] = pg.locator('[data-notice-row]').count(); seen['page2'] = pg.locator('[data-notice-page]').get_attribute('data-notice-page')
                pg.select_option('[data-notice-filter-status]', 'LIVE'); pg.wait_for_timeout(2000)
                seen['live'] = pg.locator('[data-notice-row][data-notice-status="LIVE"]').count(); seen['rows'] = pg.locator('[data-notice-row]').count()
                pg.screenshot(path=os.path.join(HERE, 'v1292_filter.png'), full_page=False)
                pg.click('[data-notice-filter-clear]'); pg.wait_for_timeout(2000)
                seen['clear'] = pg.locator('[data-notice-filter-clear]').count(); seen['all'] = pg.locator('[data-notice-row]').count()
            r = ui(run)
            if r is None:
                print('  (화면 · playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 노출 › 메인 운영 › 콘텐츠 「공지」 — 찾기 50줄(1/2쪽) → 「뒤」 6줄(2/2쪽) → 「게시 중」 1줄 → 「모두 보기」 · 화면 오류 없음',
                   seen.get('bar') == 1 and seen.get('q') == 50 and seen.get('page') == '1/2' and seen.get('q2') == 6 and seen.get('page2') == '2/2'
                   and seen.get('live') == 1 and seen.get('rows') == 1 and seen.get('clear') == 0 and (seen.get('all') or 0) >= 1 and not perr, f'{seen} · {perr[:2]}')
    finally:
        psql(f"DELETE FROM notices WHERE title LIKE '시험 1292 {tag}%'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
