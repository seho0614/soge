"""v10.325 (docs/452) 공지 읽음 자세히 — 노출 › 메인 운영 › 콘텐츠 › 공지 목록 「읽음」
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1325.py
  ① (코드) GET /admin/notices/{id}/reads · NoticeReadsDto · 운영 화면 「읽음 n / 대상 m (p%)」 단추 · 자세히 칸 · screens.json · 문서 452 · 판 v10.325
  ② (API) 회원 · 판매자 등급 공지 — 읽음 1 · 「모두 읽음」 1(셈에서 뺌) · 대상 · 비율 · 등급별이 DB 셈과 같음 · 없는 공지 404 · 회원은 403
  ③ (운영 화면) 「읽음」 누르면 자세히 칸 · 모두 읽음 1 · 등급 2줄 · 화면 오류 없음
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

SS, SC, SD = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts'), rd('src/modules/site/site.dto.ts')
MO = rd('web/src/app/admin/MainOps.tsx')
ok('① 코드 — GET /admin/notices/{id}/reads · NoticeReadsDto · 등급별 · bulk 따로 · 운영 화면 비율 단추 · 자세히 칸 · screens.json · 문서 452 · 판 v10.325',
   "@Get('notices/:id/reads')" in SC and 'async noticeReads(id: string)' in SS and 'export class NoticeReadsDto' in SD and 'export class NoticeReadGradeDto' in SD
   and 'count(*) FILTER (WHERE bulk)::int AS bulk' in SS and 'data-notice-reads-open' in MO and 'data-notice-reads-detail' in MO and 'data-notice-reads-grade' in MO
   and '"GET /admin/notices/{id}/reads"' in rd('spec/screens.json') and '읽음' in doc('452_') and VT >= (10, 325), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    acc = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    oth = psql(f"SELECT id FROM accounts WHERE status = 'ACTIVE' AND id <> '{acc}' ORDER BY created_at LIMIT 1")
    T = f'시험 1325 {int(time.time()) % 100000}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1325 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1325 %'")
    clean()
    try:
        nid = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T}', '읽음 본문', false, now(), ARRAY['MEMBER','SELLER']) RETURNING id").splitlines()[0]
        psql(f"INSERT INTO notice_reads (notice_id, account_id, bulk) VALUES ('{nid}', '{acc}', false), ('{nid}', '{oth}', true)")
        js = call('GET', f'/admin/notices/{nid}/reads', None, TA)
        tg = int(psql("SELECT count(*) FROM accounts a WHERE a.status = 'ACTIVE' AND fn_notice_grades(a.id) && ARRAY['MEMBER','SELLER']") or -1)
        gm = {g: (int(psql(f"SELECT count(*) FROM accounts a WHERE a.status = 'ACTIVE' AND '{g}' = ANY(fn_notice_grades(a.id))") or -1),
                  int(psql(f"SELECT count(*) FROM accounts a WHERE a.id = '{acc}' AND a.status = 'ACTIVE' AND '{g}' = ANY(fn_notice_grades(a.id))") or -1))
              for g in ('MEMBER', 'SELLER')}
        bg = {x.get('code'): (x.get('target'), x.get('reads')) for x in (js.get('byGrade') or [])} if isinstance(js, dict) else {}
        rate = int(1000 / tg + 0.5) / 10 if tg else None
        nf = call('GET', '/admin/notices/00000000-0000-4000-8000-000000000000/reads', None, TA)
        fb = call('GET', f'/admin/notices/{nid}/reads', None, TB)
        lst = call('GET', '/admin/notices?q=' + urllib.parse.quote(T), None, TA)
        lr = next((x.get('reads') for x in lst if x.get('id') == nid), None) if isinstance(lst, list) else lst
        ok('② API — 읽음 1 · 모두 읽음 1 · 대상 · 비율 · 등급 2줄(DB 셈과 같음) · 목록 「읽음」도 1 · 없는 공지 404 · 회원 403',
           isinstance(js, dict) and js.get('reads') == 1 and js.get('bulk') == 1 and js.get('target') == tg and js.get('rate') == rate
           and list(bg) == ['MEMBER', 'SELLER'] and all(bg[g] == gm[g] for g in gm) and lr == 1
           and nf.get('_err') == 404 and fb.get('_err') == 403, f'{js} · {tg} · {gm} · {lr} · {nf.get("_err")} · {fb.get("_err")}')
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/mainops/content', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                pg.fill('[data-notice-q]', T); pg.click('[data-notice-q-go]'); pg.wait_for_timeout(2500)
                bt = pg.locator(f'[data-notice-reads-open="{nid}"]')
                seen['btn'] = bt.first.inner_text() if bt.count() else None
                if bt.count():
                    bt.first.click(); pg.wait_for_timeout(2500)
                    seen['detail'] = pg.locator(f'[data-notice-reads-detail="{nid}"]').count()
                    seen['bulk'] = pg.locator('[data-notice-reads-bulk]').first.get_attribute('data-notice-reads-bulk') if pg.locator('[data-notice-reads-bulk]').count() else None
                    seen['grades'] = pg.locator('[data-notice-reads-grade]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1325_reads.png'), full_page=True)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 운영 화면 — 「읽음 1 / 대상 m (p%)」 단추 → 자세히 칸 · 모두 읽음 1 · 등급 2줄 · 화면 오류 없음',
                   str(seen.get('btn') or '').startswith('읽음 1 / 대상') and seen.get('detail') == 1 and seen.get('bulk') == '1'
                   and seen.get('grades') == 2 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean()
    ok('④ 지움 — 시험 공지 · 읽음 기록 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1325 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
