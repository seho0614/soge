"""v10.322 (D222 · docs/449) 안 읽은 공지 — #n-<id> 로 오면 펼친 채 · 메인 띠 · 고정 줄 「새 글」 · 소개광장 공지 「모두 읽음」
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1322.py
  ① (코드) D222 notice_reads.bulk · 모두 읽음 API(요율 변경 공지 뺌) · 펼쳐 본 수는 bulk 빼고 · NoticeDetails #n-id · 「새 글」 · 사전 · 문서 449 · 마이그레이션 260
  ② (DB) bulk 칸 · schema_migrations D222
  ③ (API) buyer 안 읽은 공지 → 모두 읽음(marked ≥ 1 · bulk) → 운영 「펼쳐 본 회원」 0 → 실제로 펼치면 bulk 꺼짐 · 1 · 한 번 더 모두 읽음은 0
  ④ (사용자 웹 · buyer) /community?board=NOTICE#n-<id> 로 열면 그 공지가 펼쳐지고 읽음 기록 · 메인 띠 「새 글」
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

M22 = rd('prisma/migrations/D222_notice_reads_bulk/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if x[:1] in 'ABCD') if os.path.isdir(os.path.join(K, 'prisma/migrations')) else []
MS, MC, SS = rd('src/modules/me/me.service.ts'), rd('src/modules/me/me.controller.ts'), rd('src/modules/site/site.service.ts')
ND, PN, PR, HV = rd('site/src/components/common/NoticeDetails.tsx'), rd('site/src/components/community/PlazaNotices.tsx'), rd('site/src/components/community/PlazaReadAll.tsx'), rd('site/src/components/home/HomeView.tsx')
KO = lambda n: json.loads(rd(f'site/src/i18n/messages/ko/{n}.json') or '{}')
EN = lambda n: json.loads(rd(f'site/src/i18n/messages/en/{n}.json') or '{}')
ok('① DB · API 코드 — D222 bulk 칸(지우는 문장 없음) · POST /me/notices/read-all · 요율 변경 공지 뺌 · 펼치면 bulk 꺼짐 · 운영 「펼쳐 본 회원」은 bulk 빼고 · 마이그레이션 260',
   'ADD COLUMN IF NOT EXISTS bulk boolean NOT NULL DEFAULT false' in M22 and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', M22)
   and "@Post('notices/read-all')" in MC and 'async readAllNotices()' in MS and 'h.notice_id = n.id OR h.cancel_notice_id = n.id' in MS and 'bulk = false' in MS
   and 'AND NOT r.bulk) AS reads' in SS and len(mig) >= 260 and 'D222_notice_reads_bulk' in mig, f'{len(mig)}')
ok('① 사용자 웹 코드 — #n-<id> 면 펼친 채(hashchange 도) · 고정 줄 · 메인 띠 「새 글」 · 「모두 읽음」(로그인 · 안 읽은 것 있을 때) · 사전 ko · en · 문서 449 · 판 v10.322',
   'window.location.hash !== `#n-${id}`' in ND and "addEventListener('hashchange', openIfHash)" in ND and 'data-plaza-pin-new' in PN and 'data-home-notice-new' in HV and 'publishedAt: n.publishedAt, unread: n.unread' in rd('site/src/app/page.tsx')
   and "fetch('/api/v1/me/notices/read-all'" in PR and 'login && rows.some((n) => n.unread === true) && <>' in PN
   and KO('plaza')['ntc'].get('readAll') == '모두 읽음' and EN('plaza')['ntc'].get('readAll') and KO('main')['ntc'].get('new') == '새 글' and EN('main')['ntc'].get('new') == 'New'
   and '모두 읽음' in doc('449_') and VT >= (10, 322), VER)
if API and DB:
    ok('② DB — notice_reads.bulk · schema_migrations D222',
       psql("SELECT data_type || ' ' || column_default FROM information_schema.columns WHERE table_name = 'notice_reads' AND column_name = 'bulk'") == 'boolean false'
       and psql("SELECT count(*) FROM schema_migrations WHERE name = 'D222_notice_reads_bulk'") == '1', '')
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    acc = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    t0 = psql('SELECT now()')
    T = f'시험 1322 {int(time.time()) % 100000}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1322 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1322 %'")
    clean()
    try:
        nid = psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T}', '회원 공지 본문', true, now(), ARRAY['MEMBER']) RETURNING id").splitlines()[0]
        def reads():
            js = call('GET', '/admin/notices?q=' + urllib.parse.quote(T), None, TA)
            return next((x.get('reads') for x in js if isinstance(x, dict) and x.get('id') == nid), None) if isinstance(js, list) else js
        u0 = call('GET', '/me/summary', None, TB).get('unreadNotices')
        ra = call('POST', '/me/notices/read-all', {}, TB)
        b1 = psql(f"SELECT bulk || ' ' || reads FROM notice_reads WHERE notice_id = '{nid}' AND account_id = '{acc}'")
        r1 = reads()
        rd1 = call('POST', f'/me/notices/{nid}/read', {}, TB)
        b2 = psql(f"SELECT bulk || ' ' || reads FROM notice_reads WHERE notice_id = '{nid}' AND account_id = '{acc}'")
        r2 = reads()
        ra2 = call('POST', '/me/notices/read-all', {}, TB)
        ok('③ API — 모두 읽음(marked ≥ 1 · 안 읽은 0 · bulk) → 운영 「펼쳐 본 회원」 0 → 펼치면 bulk 꺼짐 · 1 → 다시 모두 읽음 marked 0',
           isinstance(u0, int) and u0 >= 1 and (ra.get('marked') or 0) >= 1 and ra.get('unreadNotices') == 0 and b1 == 'true 1' and r1 == 0
           and rd1.get('ok') is True and b2 == 'false 1' and r2 == 1 and ra2.get('marked') == 0, f'{u0} · {ra} · {b1} · {r1} · {b2} · {r2} · {ra2}')
        if SITE:
            psql(f"DELETE FROM notice_reads WHERE notice_id = '{nid}' AND account_id = '{acc}'")

            def run(b, seen, perr):
                ps = site_login(b, perr, 'buyer@x.com')
                ps.goto(SITE + '/', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                seen['homeNew'] = ps.locator(f'[data-home-notice="{nid}"] [data-home-notice-new]').count()
                ps.goto(SITE + f'/community?board=NOTICE#n-{nid}', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(3000)
                d = ps.locator(f'[data-notice-read="{nid}"]')
                seen['open'] = d.evaluate('e => e.open') if d.count() else None
                ps.screenshot(path=os.path.join(HERE, 'v1322_hash.png'))
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                rec = psql(f"SELECT bulk || ' ' || reads FROM notice_reads WHERE notice_id = '{nid}' AND account_id = '{acc}'")
                ok('④ 사용자 웹(buyer) — 메인 띠 「새 글」 → #n-<id> 로 열면 그 공지 펼쳐짐 · 읽음 기록(bulk 아님) · 화면 오류 없음',
                   seen.get('homeNew') == 1 and seen.get('open') is True and rec == 'false 1' and not perr, f'{seen} · {rec} · {perr[:2]}')
        else:
            print('  (SITE 없음 — ④ 건너뜀)')
    finally:
        clean()
        psql(f"DELETE FROM notice_reads WHERE account_id = '{acc}' AND bulk AND first_at >= '{t0}'")   # 모두 읽음이 남의 공지에 단 표시도 되돌림
    ok('⑤ 지움 — 시험 공지 · 이번 「모두 읽음」 표시 없음', psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1322 %'") == '0'
       and psql(f"SELECT count(*) FROM notice_reads WHERE account_id = '{acc}' AND bulk AND first_at >= '{t0}'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
