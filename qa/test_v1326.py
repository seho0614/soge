"""v10.326 (docs/453) 메인 공지 띠 「오늘 하루 안 보기」
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1326.py
  ① (코드) noticeHide.ts(한국 날짜 + 공지 번호 · 저장소 못 쓰면 그대로 보임) · HomeView ✕ 단추 · 사전 ko · en · 44px · 문서 453 · 판 v10.326
  ② (사용자 웹) ✕ → 띠 숨김 → 새로 고쳐도 숨김 → 날짜가 바뀌면 다시 보임 → 다시 숨김 → 새 고정 공지가 오르면 다시 보임 · 화면 오류 없음
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

NH, HV, HC = rd('site/src/components/home/noticeHide.ts'), rd('site/src/components/home/HomeView.tsx'), rd('site/src/styles/home.css')
KO = lambda n: json.loads(rd(f'site/src/i18n/messages/ko/{n}.json') or '{}')
EN = lambda n: json.loads(rd(f'site/src/i18n/messages/en/{n}.json') or '{}')
ok('① 코드 — 한국 날짜 + 공지 번호로 숨김 · 저장소 오류면 보임 · ✕ 단추 · 사전 ko · en · 44px · 문서 453 · 판 v10.326',
   "NOTICE_HIDE_KEY = 'sgb.homeNoticeHide'" in NH and '9 * 3600 * 1000' in NH and 'v.ids === noticeIdsKey(ids)' in NH and 'catch {\n    return false;' in NH
   and 'data-home-notice-hide' in HV and 'notices.length > 0 && !ntcHidden &&' in HV and 'writeNoticeHidden(ntcIds)' in HV
   and KO('main')['ntc'].get('hide') == '오늘 하루 안 보기' and EN('main')['ntc'].get('hide') and '.home-ntcx' in HC and 'min-height: 44px; min-width: 44px' in HC
   and '오늘 하루' in doc('453_') and VT >= (10, 326), VER)
if API and DB and SITE:
    T = f'시험 1326 {int(time.time()) % 100000}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1326 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1326 %'")
    clean()
    try:
        na = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T} A', '띠 본문', true, now() + interval '1 second', ARRAY['PUBLIC']) RETURNING id").splitlines()[0]
        time.sleep(2)

        def run(b, seen, perr):
            ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
            strip = lambda: ps.locator('[data-home-notices]').count()
            ps.goto(SITE + '/', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(2000)
            seen['a'] = ps.locator(f'[data-home-notice="{na}"]').count()
            ps.click('[data-home-notice-hide]'); ps.wait_for_timeout(500)
            seen['hid'] = strip()
            ps.reload(wait_until='networkidle'); ps.wait_for_timeout(2000)
            seen['reload'] = strip()
            ps.evaluate("() => { const k = 'sgb.homeNoticeHide'; const v = JSON.parse(localStorage.getItem(k)); v.d = '2000-01-01'; localStorage.setItem(k, JSON.stringify(v)); }")
            ps.reload(wait_until='networkidle'); ps.wait_for_timeout(2000)
            seen['day'] = strip()
            ps.click('[data-home-notice-hide]'); ps.wait_for_timeout(500)
            psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T} B', '새 띠', true, now() + interval '1 second', ARRAY['PUBLIC'])")
            time.sleep(2)
            ps.reload(wait_until='networkidle'); ps.wait_for_timeout(2000)
            seen['new'] = strip()
            ps.screenshot(path=os.path.join(HERE, 'v1326_home.png'))
        r = ui(run)
        if r is None:
            print('  (playwright 없음 — ② 건너뜀)')
        else:
            seen, perr = r
            ok('② 사용자 웹 — 띠에 시험 공지 · ✕ → 숨김 · 새로 고쳐도 숨김 · 날짜 바뀌면 보임 · 새 고정 공지면 보임 · 화면 오류 없음',
               seen.get('a') == 1 and seen.get('hid') == 0 and seen.get('reload') == 0 and seen.get('day') == 1 and seen.get('new') == 1 and not perr,
               f'{seen} · {perr[:2]}')
    finally:
        clean()
    ok('③ 지움 — 시험 공지 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1326 %'") == '0', '')
else:
    print('  (API · DB · SITE 없음 — ② · ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
