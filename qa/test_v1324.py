"""v10.324 (docs/451) 지난 공지 더 보기 · 찾기 — 소개광장 › 공지
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1324.py
  ① (코드) GET /notices q · page(30개씩) · 소개광장 공지 찾기 칸 · 「지난 공지 더 보기」 · 사전 ko · en · 문서 451 · 판 v10.324
  ② (API) 시험 공지 33개 → 1쪽 30 · 2쪽 3(겹침 없음) · 로그인 회원은 회원 공지까지 · 본문 찾기 · 값 없으면 전처럼 30개까지 · 잘못된 page 는 1쪽
  ③ (사용자 웹) 찾기 → 30개 · 「지난 공지 더 보기」 → 3개 · 「최근 공지」 · 없는 글자면 빈 안내 · 화면 오류 없음
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

PS, PC = rd('src/modules/public/public.service.ts'), rd('src/modules/public/public.controller.ts')
PN, CP = rd('site/src/components/community/PlazaNotices.tsx'), rd('site/src/app/community/page.tsx')
KO = lambda n: json.loads(rd(f'site/src/i18n/messages/ko/{n}.json') or '{}')
EN = lambda n: json.loads(rd(f'site/src/i18n/messages/en/{n}.json') or '{}')
KEYS = ('qPh', 'qGo', 'qClear', 'qEmpty', 'pageEmpty', 'older', 'newer', 'pager')
ok('① 코드 — GET /notices q · page 30개씩 · 찾기 칸 · 지난 공지 더 보기 · 사전 ko · en · 문서 451 · 판 v10.324',
   'static readonly NOTICE_PAGE = 30;' in PS and 'OFFSET $4' in PS and "strpos(lower(body), lower($3)) > 0" in PS
   and "@ApiQuery({ name: 'q', required: false" in PC and "@Query('page') page?: string" in PC
   and 'data-plaza-notice-search' in PN and 'data-plaza-notice-older' in PN and 'data-plaza-notice-newer' in PN and 'nq={nq} np={np}' in CP
   and all(KO('plaza')['ntc'].get(k) and EN('plaza')['ntc'].get(k) for k in KEYS)
   and '지난 공지' in doc('451_') and VT >= (10, 324), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('buyer@x.com', PW)
    TB = login('buyer@x.com')
    T = '시험 1324'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1324 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1324 %'")
    clean()
    try:
        vals = ', '.join(f"('{T} {k:02d}', '본문 {k}', false, now() - interval '{k + 1} minutes', ARRAY['PUBLIC'])" for k in range(33))
        psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES {vals}, "
             f"('{T} 회원', '회원만 · 본문찾기1324', false, now() - interval '50 minutes', ARRAY['MEMBER'])")
        qq = urllib.parse.quote(T)
        p1 = call('GET', f'/notices?q={qq}')
        p2 = call('GET', f'/notices?q={qq}&page=2')
        m2 = call('GET', f'/notices?q={qq}&page=2', None, TB)
        bd = call('GET', '/notices?q=' + urllib.parse.quote('본문찾기1324'), None, TB)
        bd0 = call('GET', '/notices?q=' + urllib.parse.quote('본문찾기1324'))
        d0 = call('GET', '/notices')
        bad = call('GET', f'/notices?q={qq}&page=abc')
        ids = lambda js: [x.get('id') for x in js] if isinstance(js, list) else []
        ok('② API — 1쪽 30 · 2쪽 3(겹침 없음 · 새 글 먼저) · 회원은 2쪽 4 · 본문 찾기(회원만 1 · 손님 0) · 값 없으면 30개까지 · page=abc 는 1쪽',
           len(ids(p1)) == 30 and len(ids(p2)) == 3 and not set(ids(p1)) & set(ids(p2))
           and isinstance(p1, list) and p1[0].get('title') == f'{T} 00' and isinstance(p2, list) and p2[-1].get('title') == f'{T} 32'
           and len(ids(m2)) == 4 and len(ids(bd)) == 1 and len(ids(bd0)) == 0
           and isinstance(d0, list) and len(d0) <= 30 and ids(bad) == ids(p1),
           f'{len(ids(p1))} · {len(ids(p2))} · {len(ids(m2))} · {len(ids(bd))} · {len(ids(bd0))} · {len(d0) if isinstance(d0, list) else d0} · {ids(bad) == ids(p1)}')
        if SITE:
            def run(b, seen, perr):
                ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                ps.goto(SITE + '/community?board=NOTICE', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                ps.fill('[data-plaza-notice-search] input[name=nq]', T); ps.click('[data-plaza-notice-search] button[type=submit]')
                ps.wait_for_load_state('networkidle'); ps.wait_for_timeout(2000)
                seen['p1'] = ps.locator('[data-plaza-notice]').count()
                seen['clear'] = ps.locator('[data-plaza-notice-search-clear]').count()
                seen['older'] = ps.locator('[data-plaza-notice-older]').count()
                if seen['older']:
                    ps.click('[data-plaza-notice-older]'); ps.wait_for_load_state('networkidle'); ps.wait_for_timeout(2000)
                    seen['p2'] = ps.locator('[data-plaza-notice]').count()
                    seen['newer'] = ps.locator('[data-plaza-notice-newer]').count()
                    seen['older2'] = ps.locator('[data-plaza-notice-older]').count()
                    ps.screenshot(path=os.path.join(HERE, 'v1324_page2.png'))
                ps.goto(SITE + '/community?board=NOTICE&nq=' + urllib.parse.quote('없는글자1324zz'), wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                seen['empty'] = ps.locator('[data-plaza-notices-empty]').count()
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 사용자 웹 — 찾기 30 · 지우기 링크 · 「지난 공지 더 보기」 → 3 · 「최근 공지」 있음 · 더 보기 없음 · 없는 글자면 빈 안내 · 화면 오류 없음',
                   seen.get('p1') == 30 and seen.get('clear') == 1 and seen.get('older') == 1 and seen.get('p2') == 3
                   and seen.get('newer') == 1 and seen.get('older2') == 0 and seen.get('empty') == 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (SITE 없음 — ③ 건너뜀)')
    finally:
        clean()
    ok('④ 지움 — 시험 공지 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1324 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
