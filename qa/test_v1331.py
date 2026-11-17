"""v10.331 (docs/461) 소개몰 공지 알림 — 판매자는 판매자센터 › 소개몰 공지로(D223) · 화면 목록 「시안만」 정리
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1331.py
  ① (코드) D223 · GET /me/health/seller/notices/{id} · NoticeHashOpen onePath · readPath · screens.json 이연 14 · 문서 461 · 판 v10.331 · 마이그레이션 261
  ② (DB) fn_notice_notify — 소개몰 공지: 판매자 → 판매자센터 주소 · 판매자 아님 → 소개광장 · 일반 공지 → 소개광장
  ③ (API) 한 건 200 · 일반 공지 404 · 판매자 아님 403
  ④ (화면 · 판매자) 첫 30개 밖 공지 #n-<id> → 「지난 공지」 펼침 · 판매자 읽음 기록(bulk 아님)
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

SV, SC = rd('src/modules/health/health-seller.service.ts'), rd('src/modules/health/health-seller.controller.ts')
HO, NP = rd('site/src/components/common/NoticeHashOpen.tsx'), rd('site/src/app/health/seller/center/notices/page.tsx')
M23, SJ = rd('prisma/migrations/D223_notice_link_seller/migration.sql'), rd('spec/screens.json')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
try:
    DEF = [x.get('id') for x in json.loads(SJ).get('deferred', [])]
except Exception:
    DEF = ['?']
ok('① 코드 — D223 판매자 알림 주소(지우는 문장 없음) · 한 건 API · NoticeHashOpen onePath · readPath · 판매자 화면 · screens.json 이연 3건 빠짐 · 문서 461 · 판 v10.331 · 마이그레이션 261',
   "THEN '/health/seller/center/notices#n-' ELSE '/community?board=NOTICE#n-' END" in M23 and 'CREATE OR REPLACE FUNCTION public.fn_notice_notify' in M23
   and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M23) and "@Get('me/health/seller/notices/:id')" in SC and 'async notice(id: string)' in SV
   and "(onePath ?? '/api/v1/notices/{id}').replace('{id}', id)" in HO and "readPath={readPath?.replace('{id}', one.id)}" in HO
   and 'onePath="/api/v1/me/health/seller/notices/{id}"' in NP and 'readPath="/api/v1/me/health/seller/notices/{id}/read"' in NP
   and not any(x in DEF for x in ('SB-BIZ-POL-030', 'SB-ADS-LND-010', 'SB-ADM-SEG-020')) and len(DEF) == 14 and '"GET /me/health/seller/notices/{id}"' in SJ
   and '시안만' not in SJ and 'D223' in doc('461_') and VT >= (10, 331) and len(mig) >= 261 and 'D223_notice_link_seller' in mig, f'{VER} · 이연 {len(DEF)} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    SEL = 'seller1331@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1331', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('buyer@x.com', PW)
    TL, TB = login(SEL), login('buyer@x.com')
    buyer = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    stamp = int(time.time()) % 100000
    T = f'시험 1331 {stamp}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notifications WHERE event_code = 'NOTICE_PUBLISHED' AND title LIKE '새 공지 — 시험 1331 %'; "
                         "DELETE FROM notice_notified WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1331 %'); "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1331 %'); "
                         "DELETE FROM ops_alerts WHERE alert_code = 'NOTICE_NOTIFY_DONE' AND title LIKE '%시험 1331 %'; "
                         "DELETE FROM notices WHERE title LIKE '시험 1331 %'; "
                         "DELETE FROM hlt_sellers WHERE name = '시험 가게 1331'")
    clean()
    try:
        psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
             f"VALUES ('TN-L{stamp}', '{aid}', 'TENANT', '시험 가게 1331', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1331')")
        vals = ', '.join(f"('HLT', '{T} {k:02d}번', '판매자 본문 1331 {k:02d}', false, now() - interval '{k + 10} seconds', ARRAY['SELLER'])" for k in range(35))
        psql(f"INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, grades) VALUES {vals}")
        hl = psql(f"INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, grades, notify) VALUES ('HLT', '{T} 알림 소개몰', '알림 본문 1331', false, now() - interval '1 second', ARRAY['MEMBER', 'SELLER'], true) RETURNING id").splitlines()[0]
        gn = psql(f"INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, grades, notify) VALUES (NULL, '{T} 알림 일반', '알림 본문 1331', false, now() - interval '1 second', ARRAY['MEMBER', 'SELLER'], true) RETURNING id").splitlines()[0]
        n1, n2 = psql(f"SELECT fn_notice_notify('{hl}'::uuid)"), psql(f"SELECT fn_notice_notify('{gn}'::uuid)")
        lk = lambda who, nid: psql(f"SELECT link_url FROM notifications WHERE account_id = '{who}' AND event_code = 'NOTICE_PUBLISHED' AND link_url LIKE '%' || '{nid}'")
        ls_, lb, lg = lk(aid, hl), lk(buyer, hl), lk(aid, gn)
        ok('② DB — 소개몰 공지 알림: 판매자는 판매자센터 · 판매자 아님은 소개광장 · 일반 공지는 판매자도 소개광장',
           ls_ == f'/health/seller/center/notices#n-{hl}' and lb == f'/community?board=NOTICE#n-{hl}' and lg == f'/community?board=NOTICE#n-{gn}',
           f'{n1} · {n2} · {ls_} · {lb} · {lg}')
        old = psql(f"SELECT id FROM notices WHERE title = '{T} 34번'")
        g1 = call('GET', f'/me/health/seller/notices/{old}', None, TL)
        g2 = call('GET', f'/me/health/seller/notices/{gn}', None, TL)
        g3 = call('GET', f'/me/health/seller/notices/{old}', None, TB)
        ok('③ API — 한 건 200(소개몰 공지 · unread) · 일반 공지 404 · 판매자 아님 403',
           g1.get('id') == old and g1.get('title') == f'{T} 34번' and g1.get('unread') is True and g2.get('_err') == 404 and g3.get('_err') == 403,
           f"{g1.get('title')} · {g1.get('unread')} · {g2.get('_err')} · {g3.get('_err')}")
        if SITE:
            def run(b, seen, perr):
                ps = site_login(b, perr, SEL)
                ps.goto(SITE + '/health/seller/center/notices', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1000)
                seen['inList'] = ps.locator(f'[data-seller-notice="{old}"]').count()
                ps.goto(SITE + f'/health/seller/center/notices#n-{old}', wait_until='networkidle', timeout=120000)
                ps.reload(wait_until='networkidle'); ps.wait_for_timeout(3000)
                box = ps.locator(f'[data-notice-hash-open="{old}"]')
                seen['hash'] = box.count()
                if box.count():
                    seen['open'] = box.locator('details').first.evaluate('e => e.open')
                ps.screenshot(path=os.path.join(HERE, 'v1331_seller.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                one = psql(f"SELECT r.bulk || ':' || r.reads FROM notice_reads r WHERE r.account_id = '{aid}' AND r.notice_id = '{old}'")
                ok('④ 판매자 화면 — 첫 30개 밖 공지를 #n-<id> 로 열면 「지난 공지」로 펼침 · 판매자 읽음 기록(bulk 아님) · 화면 오류 없음',
                   seen.get('inList') == 0 and seen.get('hash') == 1 and seen.get('open') is True and one in ('false:1', 'false:2') and not perr, f'{seen} · {one} · {perr[:2]}')
        else:
            print('  (SITE 없음 — ④ 건너뜀)')
    finally:
        clean()
    ok('⑤ 지움 — 시험 공지 · 알림 · 읽음 · 시험 가게 없음',
       psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1331 %'") == '0' and psql("SELECT count(*) FROM hlt_sellers WHERE name = '시험 가게 1331'") == '0'
       and psql("SELECT count(*) FROM notifications WHERE title LIKE '새 공지 — 시험 1331 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
