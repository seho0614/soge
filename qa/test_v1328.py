"""v10.328 (docs/456) 파트너센터 공지 — 찾기 · 지난 공지 더 보기 · 모두 읽음 · 30개 밖 공지 한 건
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1328.py
  ① (코드) NoticeListTools · 제휴 /partners/notices · 안심 /partner/notices(공지사항 탭 · 줄 #n-<id>) · screens.json · 문서 456 · 판 v10.328
  ② (화면 · intro@x.com) 두 곳 — 시험 공지 33개 첫 쪽 + 「지난 공지 더 보기」 = 33 · 찾기 1 · 지우기 · 30개 밖 #n-<id> 펼침 · 「모두 읽음」 → bulk 33 · 알림 탭에는 찾기 칸 없음
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

LT = rd('site/src/components/common/NoticeListTools.tsx')
PA, PB = rd('site/src/app/partners/notices/page.tsx'), rd('site/src/app/partner/notices/page.tsx')
SJ = rd('spec/screens.json')
ND = rd('site/src/components/common/NoticeDetails.tsx')
ok('① 코드 — NoticeListTools(찾기 · 쪽 · 빈 안내) · 두 파트너센터 공지에 찾기 · 쪽 · 모두 읽음 · 한 건 · 안심 줄 #n-<id> · 「모두 읽음」 뒤 새 글 지움 · screens.json · 문서 456 · 판 v10.328',
   'export function noticeQuery' in LT and 'data-notice-search' in LT and 'data-notice-pager' in LT and 'data-notice-older' in LT
   and all(x in PA for x in ('<NoticeSearch path="/partners/notices"', '<NoticePager path="/partners/notices"', '<PlazaReadAll', '<NoticeHashOpen'))
   and all(x in PB for x in ('<NoticeSearch path="/partner/notices"', '<NoticePager path="/partner/notices"', '<PlazaReadAll', '<NoticeHashOpen', 'id={`n-${x.id}`}'))
   and 'useEffect(() => { setNew(unread); }, [unread]);' in ND
   and SJ.count('"POST /me/notices/read-all"') >= 3 and SJ.count('"GET /notices/{id}"') >= 3 and '파트너센터' in doc('456_') and VT >= (10, 328), VER)
if API and DB and SITE:
    import consent_ok
    consent_ok.agree('intro@x.com', PW)
    acc = psql("SELECT id FROM accounts WHERE email = 'intro@x.com'")
    T = f'시험 1328 {int(time.time()) % 100000}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1328 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1328 %'")
    clean()
    try:
        vals = ', '.join(f"('{T} {k:02d}', '본문 1328 {k:02d}번', false, now() - interval '{k + 1} minutes', ARRAY['PUBLIC'])" for k in range(33))
        psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES {vals}")
        old = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T} 오래됨', '오래된 본문 1328', false, now() - interval '400 days', ARRAY['PUBLIC']) RETURNING id").splitlines()[0]

        def run(b, seen, perr):
            ps = site_login(b, perr, 'intro@x.com')
            mine = lambda: ps.locator('[id^="n-"]', has_text=T).count()
            for key, path in (('aff', '/partners/notices'), ('mal', '/partner/notices')):
                ps.goto(SITE + path, wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                c1 = mine() - (1 if ps.locator(f'[id="n-{old}"]').count() else 0)
                more = ps.locator('[data-notice-older]')
                seen[key + 'More'] = more.count()
                c2 = 0
                if more.count():
                    more.first.click(); ps.wait_for_load_state('networkidle'); ps.wait_for_timeout(1500)
                    seen[key + 'Url'] = 'np=2' in ps.url
                    seen[key + 'Newer'] = ps.locator('[data-notice-newer]').count()
                    c2 = mine() - (1 if ps.locator(f'[id="n-{old}"]').count() else 0)
                seen[key + 'Sum'] = c1 + c2
                ps.goto(SITE + path, wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1000)
                ps.fill('[data-notice-search] input[name=nq]', '1328 05번'); ps.click('[data-notice-search] button'); ps.wait_for_load_state('networkidle'); ps.wait_for_timeout(1500)
                seen[key + 'Find'] = mine()
                seen[key + 'Clear'] = ps.locator('[data-notice-search-clear]').count()
                ps.goto(SITE + path + '?nq=' + urllib.parse.quote('없는글자1328zz'), wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1000)
                seen[key + 'Empty'] = '없는글자1328zz' in ps.inner_text('body')
                ps.goto(SITE + path + f'#n-{old}', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(2500)
                bx = ps.locator(f'[data-notice-hash-open="{old}"]')
                seen[key + 'Old'] = bx.count()
                seen[key + 'OldOpen'] = bx.locator('details').first.evaluate('d => d.open') if bx.count() else None
            ps.goto(SITE + '/partner/notices?tab=alarm', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1000)
            seen['alarmSearch'] = ps.locator('[data-notice-search]').count()
            ps.goto(SITE + '/partners/notices', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            ra = ps.locator('[data-plaza-read-all]')
            seen['readAll'] = ra.count()
            if ra.count():
                ra.first.click(); ps.wait_for_timeout(3000)
                seen['newAfter'] = ps.locator('[data-notice-read][data-notice-unread="1"]', has_text=T).count()
            ps.screenshot(path=os.path.join(HERE, 'v1328_partners.png'), full_page=False)
        r = ui(run)
        if r is None:
            print('  (playwright 없음 — ② 건너뜀)')
        else:
            seen, perr = r
            bulk = psql(f"SELECT count(*) FROM notice_reads r JOIN notices n ON n.id = r.notice_id WHERE r.account_id = '{acc}' AND n.title LIKE '{T} %' AND r.bulk")
            ok('② 화면 — 두 곳 모두 첫 쪽 + 「지난 공지 더 보기」 = 33 · 2쪽 「최근 공지」 · 찾기 1 · 지우기 · 빈 안내 · 30개 밖 공지 펼침 · 알림 탭 찾기 칸 없음 · 「모두 읽음」 → 새 글 0 · bulk 33 ~ 34 · 화면 오류 없음',
               all(seen.get(k + 'More') == 1 and seen.get(k + 'Url') and seen.get(k + 'Newer') == 1 and seen.get(k + 'Sum') == 33
                   and seen.get(k + 'Find') == 1 and seen.get(k + 'Clear') == 1 and seen.get(k + 'Empty') and seen.get(k + 'Old') == 1 and seen.get(k + 'OldOpen') is True for k in ('aff', 'mal'))
               and seen.get('alarmSearch') == 0 and seen.get('readAll') == 1 and seen.get('newAfter') == 0 and bulk in ('33', '34') and not perr,
               f'{seen} · bulk {bulk} · {perr[:2]}')
    finally:
        clean()
    ok('③ 지움 — 시험 공지 · 읽음 기록 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1328 %'") == '0', '')
else:
    print('  (API · DB · SITE 없음 — ② ~ ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
