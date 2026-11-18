"""v10.329 (docs/457) 공지 읽음 CSV — 노출 › 메인 운영 › 콘텐츠 › 공지 「읽음」 › 「CSV 받기」(SUPER)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1329.py
  ① (코드) GET /admin/notices/{id}/reads/export · SUPER · NOTICE_READS_EXPORT · 이름 가림 · 운영 화면 「CSV 받기」 · screens.json · 문서 457 · 판 v10.329
  ② (API) 회원 공지 · 펼침 2 · 모두 읽음 1 → CSV 머리 · 등급별 · 회원 3줄(모두 읽음 줄 뒤) · 이름 가림 · 감사 1줄 · 없는 공지 404 · 회원 403
  ③ (운영 화면) 「CSV 받기」 → 내려받은 파일 · 감사 1줄 더
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

SS, SC = rd('src/modules/site/site.service.ts'), rd('src/modules/site/site.controller.ts')
MO = rd('web/src/app/admin/MainOps.tsx')
ok('① 코드 — reads/export · SUPER · 감사 NOTICE_READS_EXPORT · 이름 가림 · 수식 막기 · 「CSV 받기」 · screens.json · 문서 457 · 판 v10.329',
   "@Get('notices/:id/reads/export')" in SC and 'async noticeReadsCsv(id: string)' in SS and "'NOTICE_READS_EXPORT'" in SS and 'maskName(x.name)' in SS
   and "@Roles('SUPER')" in SC.split("@Get('notices/:id/reads/export')")[1][:80] and 'data-notice-reads-csv' in MO
   and '"GET /admin/notices/{id}/reads/export"' in rd('spec/screens.json') and 'CSV' in doc('457_') and VT >= (10, 329), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    acc = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    bname = psql(f"SELECT name FROM accounts WHERE id = '{acc}'")
    oth = psql(f"SELECT id FROM accounts WHERE status = 'ACTIVE' AND id <> '{acc}' ORDER BY created_at LIMIT 2").splitlines()
    T = f'시험 1329 {int(time.time()) % 100000}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1329 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1329 %'")
    clean()
    try:
        nid = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T}', 'CSV 본문', false, now(), ARRAY['MEMBER']) RETURNING id").splitlines()[0]
        psql(f"INSERT INTO notice_reads (notice_id, account_id, bulk, reads) VALUES ('{nid}', '{acc}', false, 2), ('{nid}', '{oth[0]}', false, 1), ('{nid}', '{oth[1]}', true, 1)")
        aud = lambda: psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'NOTICE_READS_EXPORT' AND target_id = '{nid}'")
        tk = __import__('export_ticket').get(TA, 'NOTICE_READS')   # v10.366 (D238) 내려받기 승인 — 404 는 번호를 쓰지 않으므로 먼저
        nf = call('GET', f'/admin/notices/00000000-0000-4000-8000-000000000000/reads/export?ticket={tk}', None, TA)
        js = call('GET', f'/admin/notices/{nid}/reads/export?ticket={tk}', None, TA)
        csv = js.get('csv', '') if isinstance(js, dict) else ''
        lines = csv.lstrip('\ufeff').split('\r\n')
        ci = next((i for i, l in enumerate(lines) if l.startswith('회원 번호(앞 8자리)')), -1)
        body = [l for l in lines[ci + 1:] if l] if ci >= 0 else []
        bl = next((l for l in body if l.startswith(acc[:8])), '')
        a1 = aud()
        fb = call('GET', f'/admin/notices/{nid}/reads/export', None, TB)
        ok('② API — 파일 이름 · BOM · 머리(제목 · 읽음 2 / 대상) · 등급별 표 · 회원 3줄 · 「모두 읽음」 줄 맨 뒤 · 내 줄 횟수 2 · 이름 가림 · 감사 1 · 없는 공지 404 · 회원 403',
           str(js.get('filename', '')).startswith('notice-reads-') and csv.startswith('\ufeff공지 읽음 기록') and T in lines[0] and any(l.startswith('읽음 / 대상,2 / ') for l in lines)
           and '등급,대상,읽음,비율' in lines and len(body) == 3 and body[-1].endswith(',예') and bl.endswith(',2,아니오')
           and (len(bname) < 2 or bname not in csv) and js.get('rows') == 3 and a1 == '1' and nf.get('_err') == 404 and fb.get('_err') == 403,
           f'{js.get("filename")} · {lines[:4]} · {body} · 감사 {a1} · {nf.get("_err")} · {fb.get("_err")}')
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.on('dialog', lambda d: d.accept('시험 1329 내려받기') if d.type == 'prompt' else d.accept())   # v10.366 (D238) 내려받기 사유 창
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/mainops/content', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                pg.fill('[data-notice-q]', T); pg.click('[data-notice-q-go]'); pg.wait_for_timeout(2500)
                bt = pg.locator(f'[data-notice-reads-open="{nid}"]')
                if bt.count():
                    bt.first.click(); pg.wait_for_timeout(2500)
                    cb = pg.locator(f'[data-notice-reads-csv="{nid}"]')
                    seen['btn'] = cb.count()
                    if cb.count():
                        with pg.expect_download(timeout=30000) as dl:
                            cb.first.click()
                        d = dl.value
                        seen['file'] = d.suggested_filename
                        p = d.path()
                        seen['head'] = open(p, encoding='utf-8-sig').readline().strip() if p else None
                    pg.screenshot(path=os.path.join(HERE, 'v1329_csv.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                a2 = aud()
                ok('③ 운영 화면 — 「CSV 받기」 → notice-reads-…csv 내려받음 · 첫 줄 「공지 읽음 기록」 · 감사 2 · 화면 오류 없음',
                   seen.get('btn') == 1 and str(seen.get('file') or '').startswith('notice-reads-') and str(seen.get('head') or '').startswith('공지 읽음 기록')
                   and a2 == '2' and not perr, f'{seen} · 감사 {a2} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean()
    ok('④ 지움 — 시험 공지 · 읽음 기록 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1329 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
