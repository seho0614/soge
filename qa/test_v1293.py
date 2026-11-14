"""v10.293 (docs/415) — 고객센터 · 파트너센터 공지 펼침 읽음 기록 · 운영 목록 「읽음 n / 대상 m」

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1293.py

  ① (코드) POST /me/notices/{id}/read(보이는 게시 중 공지만 · notice_reads) · GET /notices unread · 운영 목록 reads · target · 펼치기 부품(고객센터 · 제휴 · 안심 파트너센터) · 화면 연결 · 문서 415
  ② (API) 펼침 기록(두 번이면 횟수 2) · 남의 등급 · 관리자 · 끝난 공지 · 없는 공지 404 · 비로그인 막음 · 「새 글」(unread) · 운영 목록 읽음 1 / 대상 · 전체 공개 · 관리자는 대상 null
  ③ (화면) 사용자 웹 고객센터 › 공지사항 — 「새 글」 → 펼치면 사라짐 · 기록됨 · 화면 오류 없음
  만든 공지 · 기록은 지움(두 번 돌아도 통과).
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
MS, MC, PS = rd('src/modules/me/me.service.ts'), rd('src/modules/me/me.controller.ts'), rd('src/modules/public/public.service.ts')
SS = rd('src/modules/site/site.service.ts')
ND = rd('site/src/components/common/NoticeDetails.tsx')
PG = [rd('site/src/app/support/notices/page.tsx'), rd('site/src/app/partners/notices/page.tsx'), rd('site/src/app/partner/notices/page.tsx')]
SCR = rd('spec/screens.json')
ok('① 서버 — POST /me/notices/{id}/read(보이는 게시 중 공지만 · 관리자 등급 빼고 · 횟수) · GET /notices unread(최근 30일) · 운영 목록 reads · target',
   "@Post('notices/:id/read')" in MC and 'async readNotice(noticeId: string)' in MS and 'reads = notice_reads.reads + 1' in MS
   and "array_remove(fn_notice_grades($2::uuid), 'STAFF')" in MS and 'AS unread' in PS and "interval '30 days'" in PS
   and '(SELECT count(*)::int FROM notice_reads r WHERE r.notice_id = n.id) AS reads' in SS and "fn_notice_grades(a.id) && array_remove($1::text[], 'STAFF')" in SS, f'{len(MS)}')
ok('① 화면 — 펼치기 부품(펼치면 기록 · 「새 글」) · 고객센터 · 제휴 · 안심 파트너센터 셋 다 · 화면 연결 3곳 · 문서 415 · 판 v10.293',
   "/api/v1/me/notices/${id}/read" in ND and 'data-notice-new' in ND and all('<NoticeDetails' in x for x in PG)
   and SCR.count('"POST /me/notices/{id}/read"') == 3 and '읽음 n / 대상 m' in D415 and verok(293), f"{[('<NoticeDetails' in x) for x in PG]} · {SCR.count('POST /me/notices')} · {VER}")


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
tag = f'R{stamp}X'
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    acc = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    made = []

    def mk(title, grades):
        i = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at, is_pinned) VALUES (NULL, '시험 1293 {tag} {title}', '본문 {title}', ARRAY[{grades}]::text[], now() - interval '1 minute', true) RETURNING id").splitlines()[0]
        made.append(i)
        return i
    try:
        nM = mk('회원', "'MEMBER'"); nP = mk('전체', "'PUBLIC'"); nS = mk('판매자', "'SELLER'"); nT = mk('관리자', "'STAFF'")
        nE = psql(f"INSERT INTO notices (gwan_code, title, body, grades, published_at, ends_at) VALUES (NULL, '시험 1293 {tag} 끝남', 'x', ARRAY['MEMBER'], now() - interval '2 days', now() - interval '1 day') RETURNING id").splitlines()[0]
        made.append(nE)
        g0 = call('GET', '/notices', None, TB); gg = call('GET', '/notices', None, None)
        un = {x.get('id'): x.get('unread') for x in (g0 if isinstance(g0, list) else [])}
        ug = {x.get('id'): x.get('unread') for x in (gg if isinstance(gg, list) else [])}
        ok('② API — 고객센터 목록 「새 글」 — 회원은 펼치기 전 true(회원 · 전체 공개) · 비로그인은 false · 남의 등급 · 관리자 공지는 목록에 없음',
           un.get(nM) is True and un.get(nP) is True and ug.get(nP) is False and nS not in un and nT not in un, f'{un.get(nM)} · {un.get(nP)} · {ug.get(nP)} · {nS in un} · {nT in un}')
        r1 = call('POST', f'/me/notices/{nM}/read', {}, TB)
        r2 = call('POST', f'/me/notices/{nM}/read', {}, TB)
        rd_ = psql(f"SELECT reads FROM notice_reads WHERE notice_id = '{nM}' AND account_id = '{acc}'")
        g1 = call('GET', '/notices', None, TB)
        un1 = {x.get('id'): x.get('unread') for x in (g1 if isinstance(g1, list) else [])}
        ok('② API — 펼침 기록 ok · 두 번이면 횟수 2 · 남은 안 읽은 수(정수) · 펼친 공지는 「새 글」 아님',
           r1.get('ok') is True and isinstance(r1.get('unreadNotices'), int) and r2.get('ok') is True and r2.get('unreadNotices') == r1.get('unreadNotices')
           and rd_ == '2' and un1.get(nM) is False and un1.get(nP) is True, f'{r1} · {rd_} · {un1.get(nM)}')
        bad = [call('POST', f'/me/notices/{x}/read', {}, TB) for x in (nS, nT, nE, '00000000-0000-4000-8000-000000000000')]
        ga = call('POST', f'/me/notices/{nP}/read', {}, None)
        cnt_bad = psql(f"SELECT count(*) FROM notice_reads WHERE account_id = '{acc}' AND notice_id IN ('{nS}', '{nT}', '{nE}')")
        ok('② API — 남의 등급 · 관리자 · 끝난 · 없는 공지 404 NOT_FOUND(기록 없음) · 비로그인 401/403',
           all(x.get('_err') == 404 and x.get('code') == 'NOT_FOUND' for x in bad) and ga.get('_err') in (401, 403) and cnt_bad == '0',
           f"{[x.get('_err') for x in bad]} · {[x.get('code') for x in bad]} · {ga.get('_err')} · {cnt_bad}")
        lst = call('GET', f'/admin/notices?q={urllib.parse.quote(tag)}', None, TS)
        row = {x.get('id'): x for x in (lst if isinstance(lst, list) else [])}
        tm = psql("SELECT count(*) FROM accounts a WHERE a.status = 'ACTIVE' AND fn_notice_grades(a.id) && ARRAY['MEMBER']")
        ok('② API — 운영 목록 「읽음 n / 대상 m」 — 회원 공지 읽음 1 · 대상 = 활동 중 회원 · 전체 공개 · 관리자 공지는 대상 null · 판매자 공지 대상(정수)',
           row.get(nM, {}).get('reads') == 1 and str(row.get(nM, {}).get('target')) == tm and row.get(nP, {}).get('target') is None and row.get(nP, {}).get('reads') == 0
           and row.get(nT, {}).get('target') is None and isinstance(row.get(nS, {}).get('target'), int),
           f"{row.get(nM, {}).get('reads')}/{row.get(nM, {}).get('target')}(DB {tm}) · {row.get(nP, {}).get('target')} · {row.get(nT, {}).get('target')} · {row.get(nS, {}).get('target')}")

        if SITE:
            def run(b, seen, perr):
                ps = site_login(b, perr, 'buyer@x.com')
                ps.goto(SITE + '/support/notices', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(2000)
                box = f'[data-site-notice="{nP}"]'
                seen['row'] = ps.locator(box).count()
                seen['new'] = ps.locator(f'{box} [data-notice-new]').count()
                if seen['row']:
                    ps.click(f'{box} summary'); ps.wait_for_timeout(2500)
                seen['new2'] = ps.locator(f'{box} [data-notice-new]').count()
                seen['body'] = ps.locator(f'{box} details[open]').count()
                seen['db'] = psql(f"SELECT reads FROM notice_reads WHERE notice_id = '{nP}' AND account_id = '{acc}'")
                ps.screenshot(path=os.path.join(HERE, 'v1293_support.png'))
            r = ui(run)
            if r is None:
                print('  (화면 · playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 고객센터 › 공지사항 — 「새 글」 → 펼치면 사라짐 · 읽음 기록 1 · 화면 오류 없음',
                   seen.get('row') == 1 and seen.get('new') == 1 and seen.get('new2') == 0 and seen.get('body') == 1 and seen.get('db') == '1' and not perr, f'{seen} · {perr[:2]}')
    finally:
        for x in made:
            psql(f"DELETE FROM notice_reads WHERE notice_id = '{x}'")
            psql(f"DELETE FROM notices WHERE id = '{x}'")
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
