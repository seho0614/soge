"""v10.327 (docs/455) 오래된 공지 바로 열기 — 소개광장 › 공지 #n-<id> 가 첫 쪽(30개) 밖이면 한 건만 불러 펼친 채
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1327.py
  ① (코드) GET /notices/{id} · notice() · NoticeHashOpen · PlazaNotices · 글자 · screens.json · 문서 455 · 판 v10.327
  ② (API) 시험 공지 33개 + 오래된 1 · 회원 1 · 끝남 1 — 오래된 공지는 첫 쪽에 없고 한 건 200 · 회원 공지 손님 404 · 회원 200 · 끝남 404 · 없는 번호 · 이상한 번호 404
  ③ (화면) 손님 #n-<오래된> → 「지난 공지」 펼침 · 회원은 읽음 기록 · 끝난 공지는 「볼 수 없습니다」
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

PC, PS = rd('src/modules/public/public.controller.ts'), rd('src/modules/public/public.service.ts')
HO, PN = rd('site/src/components/common/NoticeHashOpen.tsx'), rd('site/src/components/community/PlazaNotices.tsx')
ok('① 코드 — GET /notices/{id} · notice() · NoticeHashOpen(주소 · 한 건 · 볼 수 없음) · 소개광장 공지에 붙음 · 글자 · screens.json · 문서 455 · 판 v10.327',
   "@Get('notices/:id')" in PC and 'async notice(id: string)' in PS and 'data-notice-hash-open' in HO and 'data-notice-hash-gone' in HO
   and ('/api/v1/notices/${id}' in HO or "'/api/v1/notices/{id}'" in HO) and '<NoticeHashOpen shown={rows.map((n) => n.id)}' in PN
   and '"oldOne"' in rd('site/src/i18n/messages/ko/plaza.json') and '"gone"' in rd('site/src/i18n/messages/en/plaza.json')
   and '"GET /notices/{id}"' in rd('spec/screens.json') and '오래된 공지' in doc('455_') and VT >= (10, 327), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('buyer@x.com', PW)
    TB = login('buyer@x.com')
    acc = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    T = f'시험 1327 {int(time.time()) % 100000}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1327 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1327 %'")
    clean()
    try:
        vals = ', '.join(f"('{T} {k:02d}', '본문 {k}', false, now() - interval '{k + 1} minutes', ARRAY['PUBLIC'])" for k in range(33))
        psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES {vals}")
        old = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T} 오래됨', '오래된 본문 1327', false, now() - interval '400 days', ARRAY['PUBLIC']) RETURNING id").splitlines()[0]
        mem = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T} 회원', '회원 본문', false, now() - interval '401 days', ARRAY['MEMBER']) RETURNING id").splitlines()[0]
        end = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, ends_at, grades) VALUES ('{T} 끝남', '끝난 본문', false, now() - interval '402 days', now() - interval '1 day', ARRAY['PUBLIC']) RETURNING id").splitlines()[0]
        p1 = call('GET', '/notices')
        ids1 = [x.get('id') for x in p1] if isinstance(p1, list) else []
        one = call('GET', f'/notices/{old}')
        mg, mb = call('GET', f'/notices/{mem}'), call('GET', f'/notices/{mem}', None, TB)
        ed = call('GET', f'/notices/{end}')
        nf = call('GET', '/notices/00000000-0000-4000-8000-000000000000')
        bad = call('GET', '/notices/abc')
        ok('② API — 오래된 공지는 첫 쪽 밖 · 한 건 200(제목 · 본문 · files 칸) · 회원 공지 손님 404 · 회원 200 · 끝남 404 · 없는 번호 404 · 이상한 번호 404',
           len(ids1) == 30 and old not in ids1 and isinstance(one, dict) and one.get('id') == old and one.get('title') == f'{T} 오래됨' and 'files' in one
           and mg.get('_err') == 404 and mb.get('id') == mem and ed.get('_err') == 404 and nf.get('_err') == 404 and bad.get('_err') == 404,
           f'{len(ids1)} · {one.get("title") if isinstance(one, dict) else one} · {mg.get("_err")} · {mb.get("title")} · {ed.get("_err")} · {nf.get("_err")} · {bad.get("_err")}')
        if SITE:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(SITE + f'/community?board=NOTICE#n-{old}', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                box = pg.locator(f'[data-notice-hash-open="{old}"]')
                seen['guest'] = box.count()
                seen['guestOpen'] = box.locator('details').first.evaluate('d => d.open') if box.count() else None
                seen['guestBody'] = '오래된 본문 1327' in (box.first.inner_text() if box.count() else '')
                pg.goto(SITE + f'/community?board=NOTICE#n-{end}', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['gone'] = pg.locator('[data-notice-hash-gone]').count()
                ps = site_login(b, perr, 'buyer@x.com')
                ps.goto(SITE + f'/community?board=NOTICE#n-{mem}', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(3000)
                seen['member'] = ps.locator(f'[data-notice-hash-open="{mem}"]').count()
                ps.screenshot(path=os.path.join(HERE, 'v1327_old.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                rr = psql(f"SELECT count(*) FROM notice_reads WHERE notice_id = '{mem}' AND account_id = '{acc}' AND NOT bulk")
                ok('③ 화면 — 손님 「지난 공지」 펼침 · 본문 · 끝난 공지 「볼 수 없습니다」 · 회원은 회원 공지 펼침 · 읽음 기록 1 · 화면 오류 없음',
                   seen.get('guest') == 1 and seen.get('guestOpen') is True and seen.get('guestBody') and seen.get('gone') == 1
                   and seen.get('member') == 1 and rr == '1' and not perr, f'{seen} · 읽음 {rr} · {perr[:2]}')
        else:
            print('  (SITE 없음 — ③ 건너뜀)')
    finally:
        clean()
    ok('④ 지움 — 시험 공지 · 읽음 기록 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1327 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
