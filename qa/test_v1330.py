"""v10.330 (docs/459) 판매자센터 소개몰 공지 — 「새 글」 · 지난 공지 모두 보기 + 소개광장 「모두 읽음」 화면
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1330.py
  ① (코드) GET /me/health/seller/notices · center unread · noticeTotal · 「지난 공지 모두 보기」 · 새 화면 · NoticeDetails readPath · screens.json SB-HLT-SEL-030 · 문서 459 · 판 v10.330
  ② (API) 소개몰 공지 35 + 일반 공지 1 — center 5건 = DB 위 5건 · noticeTotal = DB 셈 · unread · 찾기 1쪽 30 + 2쪽 5(일반 공지 빠짐) · 한 건 찾기 1 · 펼친 공지 unread 꺼짐 · 판매자 아님 403
  ③ (화면 · 판매자) 「새 글」 · 「지난 공지 모두 보기」 → 새 화면 30 + 2쪽 5 · 펼치면 판매자 읽음 기록(bulk 아님) · 「새 글」 지움
  ④ (화면 · buyer) 소개광장 › 공지 「모두 읽음」 → 새로 고치지 않아도 「새 글」 0
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
CT, NP = rd('site/src/components/health/SellerCenter.tsx'), rd('site/src/app/health/seller/center/notices/page.tsx')
ND, SJ = rd('site/src/components/common/NoticeDetails.tsx'), rd('spec/screens.json')
ok('① 코드 — 판매자 공지 API · center unread · noticeTotal · 「지난 공지 모두 보기」 · 새 화면 · readPath · screens.json · 문서 459 · 판 v10.330',
   "@Get('me/health/seller/notices')" in SC and 'async notices(qIn?: string, pageIn?: string)' in SV and 'noticeTotal' in SV and 'AS unread' in SV
   and 'data-seller-notices-all' in CT and "t('noticeNew')" in CT and 'readPath={`/api/v1/me/health/seller/notices/${x.id}/read`}' in NP
   and '<NoticeSearch path={path}' in NP and '<NoticePager path={path}' in NP and 'PlazaReadAll' not in NP
   and 'void fetch(readPath ?? `/api/v1/me/notices/${id}/read`' in ND and '"SB-HLT-SEL-030"' in SJ and '"GET /me/health/seller/notices"' in SJ
   and '모두 읽음' in doc('459_') and VT >= (10, 330), VER)
if API and DB:
    import consent_ok
    SEL = 'seller1330@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1330', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('buyer@x.com', PW)
    TL, TB = login(SEL), login('buyer@x.com')
    buyer = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    stamp = int(time.time()) % 100000
    T = f'시험 1330 {stamp}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE title LIKE '시험 1330 %'); "
                         "DELETE FROM notices WHERE title LIKE '시험 1330 %'; "
                         "DELETE FROM hlt_sellers WHERE name = '시험 가게 1330'")
    clean()
    try:
        psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
             f"VALUES ('TN-K{stamp}', '{aid}', 'TENANT', '시험 가게 1330', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1330')")
        vals = ', '.join(f"('HLT', '{T} {k:02d}번', '판매자 본문 1330 {k:02d}', false, now() - interval '{k + 1} seconds', ARRAY['SELLER'])" for k in range(35))
        psql(f"INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, grades) VALUES {vals}")
        psql(f"INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, grades) VALUES (NULL, '{T} 일반', '일반 본문 1330', false, now(), ARRAY['SELLER'])")
        W = ("gwan_code = 'HLT' AND published_at IS NOT NULL AND published_at <= now() AND (ends_at IS NULL OR ends_at > now()) "
             f"AND grades && array_remove(fn_notice_grades('{aid}'::uuid), 'STAFF')")
        top5 = psql(f"SELECT id FROM notices WHERE {W} ORDER BY is_pinned DESC, published_at DESC, id LIMIT 5").splitlines()
        tot = int(psql(f"SELECT count(*) FROM notices WHERE {W}") or -1)
        c0 = call('GET', '/me/health/seller/center', None, TL)
        ns = c0.get('notices') or [] if isinstance(c0, dict) else []
        q = urllib.parse.quote(T)
        p1 = call('GET', f'/me/health/seller/notices?q={q}', None, TL)
        p2 = call('GET', f'/me/health/seller/notices?q={q}&page=2', None, TL)
        f1 = call('GET', '/me/health/seller/notices?q=' + urllib.parse.quote(f'{T} 07번'), None, TL)
        nid = next((x['id'] for x in (p2 if isinstance(p2, list) else []) if x.get('title') == f'{T} 33번'), None)
        rd_ = call('POST', f'/me/health/seller/notices/{nid}/read', None, TL) if nid else {}
        p2b = call('GET', f'/me/health/seller/notices?q={q}&page=2', None, TL)
        u2 = next((x.get('unread') for x in (p2b if isinstance(p2b, list) else []) if x.get('id') == nid), None)
        fb = call('GET', '/me/health/seller/notices', None, TB)
        tl = lambda rows: [x.get('title') for x in (rows if isinstance(rows, list) else [])]
        ok('② API — center 5건 = DB 위 5건 · noticeTotal = DB 셈 · unread · 1쪽 30 + 2쪽 5(일반 공지 빠짐) · 찾기 1 · 펼친 공지 unread 꺼짐 · 판매자 아님 403',
           [x.get('id') for x in ns] == top5 and c0.get('noticeTotal') == tot and tot >= 35 and all(x.get('unread') is True for x in ns if str(x.get('title', '')).startswith(T))
           and len(tl(p1)) == 30 and len(tl(p2)) == 5 and f'{T} 일반' not in tl(p1) + tl(p2) and len(set(tl(p1) + tl(p2))) == 35
           and tl(f1) == [f'{T} 07번'] and rd_.get('ok') is True and u2 is False and fb.get('_err') == 403,
           f'{len(ns)} · {c0.get("noticeTotal") if isinstance(c0, dict) else c0} / {tot} · {len(tl(p1))} + {len(tl(p2))} · {tl(f1)} · {rd_} · {u2} · {fb.get("_err")}')
        if SITE:
            psql(f"INSERT INTO notices (title, body, is_pinned, published_at, grades) VALUES ('{T} 광장 1', '광장 본문 1330', false, now(), ARRAY['MEMBER']), ('{T} 광장 2', '광장 본문 1330', false, now(), ARRAY['MEMBER'])")

            def run(b, seen, perr):
                ps = site_login(b, perr, SEL)
                ps.goto(SITE + '/health/seller/center', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(2000)
                box = ps.locator('[data-seller-notices]')
                seen['new'] = box.locator('[data-notice-new]').count() if box.count() else None
                al = ps.locator('[data-seller-notices-all]')
                seen['all'] = al.count()
                if al.count():
                    al.first.click(); ps.wait_for_load_state('networkidle'); ps.wait_for_timeout(1500)
                    seen['url'] = ps.url.endswith('/health/seller/center/notices')
                ps.goto(SITE + '/health/seller/center/notices?nq=' + urllib.parse.quote(T), wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                seen['p1'] = ps.locator('[data-seller-notice]', has_text=T).count()
                seen['readAll'] = ps.locator('[data-plaza-read-all]').count()
                old = ps.locator('[data-notice-older]')
                if old.count():
                    old.first.click(); ps.wait_for_load_state('networkidle'); ps.wait_for_timeout(1500)
                    seen['p2'] = ps.locator('[data-seller-notice]', has_text=T).count()
                    row = ps.locator('[data-seller-notice]', has_text=f'{T} 34번')
                    if row.count():
                        seen['before'] = row.locator('[data-notice-new]').count()
                        row.locator('summary').first.click(); ps.wait_for_timeout(2500)
                        seen['after'] = row.locator('[data-notice-new]').count()
                ps.screenshot(path=os.path.join(HERE, 'v1330_seller.png'), full_page=False)
                pb = site_login(b, perr, 'buyer@x.com')
                pb.goto(SITE + '/community?board=NOTICE', wait_until='networkidle', timeout=120000); pb.wait_for_timeout(2000)
                seen['plazaNew'] = pb.locator('[data-notice-read][data-notice-unread="1"]', has_text=T).count()
                ra = pb.locator('[data-plaza-read-all]')
                if ra.count():
                    ra.first.click(); pb.wait_for_timeout(3000)
                    seen['plazaAfter'] = pb.locator('[data-notice-read][data-notice-unread="1"]', has_text=T).count()
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ ④ 건너뜀)')
            else:
                seen, perr = r
                one = psql(f"SELECT r.bulk || ':' || r.reads FROM notice_reads r JOIN notices n ON n.id = r.notice_id WHERE r.account_id = '{aid}' AND n.title = '{T} 34번'")
                ok('③ 판매자 화면 — 「새 글」 · 「지난 공지 모두 보기」 → 새 화면 30 + 2쪽 5 · 「모두 읽음」 없음 · 펼치면 읽음 기록(bulk 아님) · 「새 글」 지움 · 화면 오류 없음',
                   (seen.get('new') or 0) >= 1 and seen.get('all') == 1 and seen.get('url') and seen.get('p1') == 30 and seen.get('p2') == 5 and seen.get('readAll') == 0
                   and seen.get('before') == 1 and seen.get('after') == 0 and one == 'false:1' and not perr, f'{seen} · {one} · {perr[:2]}')
                bk = psql(f"SELECT count(*) FROM notice_reads r JOIN notices n ON n.id = r.notice_id WHERE r.account_id = '{buyer}' AND n.title LIKE '{T} 광장 %' AND r.bulk")
                ok('④ 소개광장 › 공지 「모두 읽음」 — 누르기 전 「새 글」 2 · 누른 뒤 새로 고치지 않아도 0 · bulk 2',
                   seen.get('plazaNew') == 2 and seen.get('plazaAfter') == 0 and bk == '2', f"{seen.get('plazaNew')} → {seen.get('plazaAfter')} · bulk {bk}")
        else:
            print('  (SITE 없음 — ③ ④ 건너뜀)')
    finally:
        clean()
    ok('⑤ 지움 — 시험 공지 · 읽음 · 시험 가게 없음',
       psql("SELECT count(*) FROM notices WHERE title LIKE '시험 1330 %'") == '0' and psql("SELECT count(*) FROM hlt_sellers WHERE name = '시험 가게 1330'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
