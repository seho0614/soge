"""요청 열람 한도 스위치 (D011 · 10/2 결정) — API · 사용자 웹 · 운영 BO 검증.

  API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 python3 srv_viewlimit.py
결과: srv_viewlimit.json

결정: 「초기 홍보 기간은 제한 없음, 정식 서비스 때 제약. 관리자가 지정. 무료(BASIC)와 일반 회원은 똑같이 적용하고 나중에 관리자가 바꿈」
  request.view.limit        off(홍보 기간) | on(정식 서비스)
  request.view.free_monthly 무료 요금제 · 구독 없는 일반 회원 공통 월 열람 건수

★ 공용 개발 DB 의 설정을 잠깐 바꿉니다(끝에 원래 값으로 되돌림 — 실패해도 finally 로). 다른 시험과 같이 돌리지 마십시오.
"""
import json, os, subprocess, sys, uuid, urllib.request, urllib.error
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)

B = os.environ.get('API', 'http://localhost:3000/api/v1').rstrip('/')
if not B.endswith('/api/v1'): B += '/api/v1'
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
BO = os.environ.get('BO', 'http://127.0.0.1:5173').rstrip('/')
DB = os.environ.get('DATABASE_URL', 'postgresql://sgb:sgb@localhost:5432/sgb')
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:220], file=sys.stderr)


def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request(B + p, method=m, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=40); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e:
        st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js


def login(e, pw='sgb-dev-1234'):
    return call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']


def signup(prefix):
    e = f'{prefix}_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': '열람시험', 'agreedTerms': []})
    assert st < 300, (st, j)
    return e, j['accessToken']


ADM = login('admin@x.com')
setv = lambda k, v, tok=None: call('PATCH', '/admin/site-settings', tok or ADM, {'key': k, 'value': v})
cur = lambda k: q(f"select value from site_settings where key='{k}'")
ORIG = {k: cur(k) for k in ('request.view.limit', 'request.view.free_monthly', 'request.view.limit_from', 'refcode.scope')}
REQS = [x for x in subprocess.run(['psql', DB, '-tAc', "select id from requests where status='PUBLISHED' order by created_at desc limit 6"],
                                  capture_output=True, text=True).stdout.split() if x]
assert len(REQS) >= 4, '게시된 요청이 4건 이상 필요합니다'
view = lambda tok, i: call('GET', f'/requests/{REQS[i]}', tok)

try:
    rec('V-0 기본값: 홍보 기간(off) · 무료 · 일반 회원 월 3건 · 종료일 비어 있음 (10/2 결정)',
        ORIG['request.view.limit'] == 'off' and ORIG['request.view.free_monthly'] == '3' and ORIG['request.view.limit_from'] == '', ORIG)
    # ══ 1. 홍보 기간 (off) — 아무도 막지 않음 ══
    setv('request.view.limit', 'off'); setv('request.view.limit_from', ''); setv('request.view.free_monthly', '2')
    eG, TG = signup('vlG')
    sts = [view(TG, i) for i in range(4)]
    rec('V-1 홍보 기간(off): 구독 없는 일반 회원이 4건을 모두 열람 · viewLimit.enabled=false',
        all(s == 200 for s, _ in sts) and sts[0][1]['viewLimit']['enabled'] is False and sts[0][1]['viewLimit']['basis'] == 'OFF', [s for s, _ in sts])
    rec('V-2 꺼져 있어도 열람은 기록됨(통계 · 나중에 켤 때 기준)', q(f"select count(*) from request_views v join accounts a on a.id=v.viewer_account_id where a.email='{eG}'") == '4')

    # ══ 2. 정식 서비스 (on · 월 2건) — 구독 없는 일반 회원 ══
    st, j = setv('request.view.limit', 'on')
    rec('V-3 운영이 한도를 켬 (PATCH /admin/site-settings)', st == 200 and cur('request.view.limit') == 'on', (st, j))
    eN, TN = signup('vlN')
    a = view(TN, 0); b = view(TN, 1); c = view(TN, 2)
    rec('V-4 한도 2건: 1 · 2번째 열람 통과 · viewLimit(FREE · 2건 · 남은 수)', a[0] == 200 and b[0] == 200
        and a[1]['viewLimit'] == {'enabled': True, 'basis': 'FREE', 'limit': 2, 'used': 1, 'remaining': 1}
        and b[1]['viewLimit']['remaining'] == 0, (a[1].get('viewLimit'), b[1].get('viewLimit')))
    rec('V-5 3번째 요청 → 422 VIEW_QUOTA_EXCEEDED · 한국어 안내', c[0] == 422 and c[1]['code'] == 'VIEW_QUOTA_EXCEEDED' and '한도(2건)' in c[1]['message'], c)
    d = view(TN, 0)
    rec('V-6 이미 본 요청은 다시 열려도 세지 않음', d[0] == 200 and d[1]['viewCharged'] is False and d[1]['viewLimit']['used'] == 2, d[1].get('viewLimit'))
    rec('V-7 홍보 기간에 4건 본 회원도 켠 뒤에는 새 요청이 막힘(이번 달 열람 수 기준)', view(TG, 4)[0] == 422)

    # ══ 3. 무료 BASIC 회원 — 구독 없는 회원과 **같은 값** ══
    eB, TB = signup('vlB')
    call('POST', '/verifications/identity', TB, {'provider': 'PASS'})
    LST = q("select l.id from listings l where l.status='PUBLISHED' and l.gwan_code='MAL' and not fn_category_no_intro(l.category_id) order by l.published_at desc limit 1")
    st, cj = call('POST', '/referral-codes', TB, {'listingId': LST, 'paymentKey': 'stub_' + uuid.uuid4().hex, 'orderId': 'rcx-' + uuid.uuid4().hex[:12], 'amount': 30000})   # 소개코드는 매물별(D012) · v10.31 (D060) BASIC 무료 0건 → 30,000원 결제(스텁) 뒤 발급
    plan = q(f"select s.plan_code from subscriptions s join accounts a on a.id=s.account_id where a.email='{eB}' and s.status='ACTIVE'")
    b1 = view(TB, 0); b2 = view(TB, 1); b3 = view(TB, 2)
    rec('V-8 소개코드를 받아 무료 BASIC 이 생긴 회원도 같은 한도(2건) — 3번째 422',
        st in (200, 201) and plan == 'BASIC' and b1[0] == 200 and b2[0] == 200 and b3[0] == 422
        and b1[1]['viewLimit']['basis'] == 'FREE' and b1[1]['viewLimit']['limit'] == 2, (plan, b1[0], b2[0], b3[0], b1[1].get('viewLimit')))

    # ══ 4. 관리자가 건수를 바꾸면 둘 다 즉시 바뀜 ══
    st, j = setv('request.view.free_monthly', '3')
    n3 = view(TN, 2); bb3 = view(TB, 2)
    rec('V-9 운영이 3건으로 올림 → 일반 회원 · 무료 BASIC 둘 다 3번째 열람 통과', st == 200 and n3[0] == 200 and bb3[0] == 200
        and n3[1]['viewLimit']['limit'] == 3 and bb3[1]['viewLimit']['limit'] == 3, (n3[0], bb3[0]))
    rec('V-10 4번째는 둘 다 422', view(TN, 3)[0] == 422 and view(TB, 3)[0] == 422)

    # ══ 5. 유료 요금제는 요금제 값 ══
    TI = login('intro@x.com')
    own = set(subprocess.run(['psql', DB, '-tAc', "select r.id from requests r join accounts a on a.id=r.owner_account_id where a.email='intro@x.com'"], capture_output=True, text=True).stdout.split())
    rid = next(r for r in REQS if r not in own)
    st, j = call('GET', f'/requests/{rid}', TI)
    rec('V-11 유료(STANDARD) 회원은 요금제 값(월 30건) — basis PLAN', st in (200, 422) and (st == 422 or (j['viewLimit']['basis'] == 'PLAN' and j['viewLimit']['limit'] == 30)), (st, (j or {}).get('viewLimit')))

    # ══ 6. 설정 형식 · 권한 ══
    st, j = setv('request.view.limit', 'ON')
    rec('V-12 형식이 틀린 값(ON) → 422 SETTING_FORMAT · 값 그대로', st == 422 and j['code'] == 'SETTING_FORMAT' and cur('request.view.limit') == 'on', (st, j))
    st, j = setv('request.view.free_monthly', '0')
    rec('V-13 월 0건 → 422 SETTING_FORMAT', st == 422 and cur('request.view.free_monthly') == '3', (st, j))
    st, j = setv('request.view.limit', 'off', TN)
    rec('V-14 일반 회원이 설정 변경 → 403', st == 403 and cur('request.view.limit') == 'on', st)
    st, j = call('GET', f'/requests/{REQS[0]}')
    rec('V-15 비로그인 열람은 세지 않고 열림(viewLimit 없음)', st == 200 and not j.get('viewLimit'), st)

    # ══ 6-1. 홍보 기간 종료일 (D013) — 스위치가 off 여도 그날부터 적용 ══
    import datetime
    kst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date()
    setv('request.view.limit', 'off')
    eD, TD = signup('vlD')
    setv('request.view.limit_from', (kst + datetime.timedelta(days=30)).isoformat())
    fut = [view(TD, i)[0] for i in range(4)]
    rec('V-16 종료일이 30일 뒤 + 스위치 off → 아직 홍보 기간(4건 모두 열림)', fut == [200, 200, 200, 200], fut)
    st, j = setv('request.view.limit_from', kst.isoformat())
    d5 = view(TD, 4)
    rec('V-17 종료일 = 오늘 + 스위치 off → 한도 적용(이번 달 4건 봤으므로 새 요청 422)', st == 200 and d5[0] == 422 and d5[1]['code'] == 'VIEW_QUOTA_EXCEEDED', (st, d5[0]))
    st, j = setv('request.view.limit_from', '2026-13-01')
    rec('V-18 종료일 형식 오류(13월) → 422 SETTING_FORMAT', st == 422 and j['code'] == 'SETTING_FORMAT', (st, j))
    st, j = setv('request.view.limit_from', '')
    rec('V-19 종료일을 비우면 다시 스위치만 봄(off → 열림)', st == 200 and view(TD, 4)[0] == 200, st)
    setv('request.view.limit', 'on')

    # ══ 7. 사용자 웹 ══
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        br = p.chromium.launch()
        c = br.new_context(); pg = c.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        eU, TU = signup('vlU')
        pg.goto(SITE + '/login'); __import__('consent_ok').agree(eU, 'sgb-test-1234'); pg.fill('input[name=email]', eU); pg.fill('input[name=password]', 'sgb-test-1234')
        pg.click('form.auth button'); pg.wait_for_timeout(2500)
        r1 = pg.goto(f'{SITE}/request/{REQS[0]}', wait_until='networkidle')
        lim = pg.locator('[data-view-limit]')
        rec('U-1 요청 상세에 「이번 달 요청 열람 1 / 3건」', r1.status == 200 and lim.count() == 1 and lim.get_attribute('data-view-limit') == '1/3', lim.count())
        pg.goto(f'{SITE}/request/{REQS[1]}', wait_until='networkidle'); pg.goto(f'{SITE}/request/{REQS[2]}', wait_until='networkidle')
        r4 = pg.goto(f'{SITE}/request/{REQS[3]}', wait_until='networkidle')
        t = pg.inner_text('main')
        rec('U-2 한도를 넘으면 오류 화면이 아니라 안내 + 「요금제 보기」', pg.locator('[data-view-quota="exceeded"]').count() == 1 and '한도(3건)' in t
            and pg.locator('a[href="/my/subscription/upgrade"]').count() >= 1 and 'Application error' not in t, (r4.status, t[:120]))
        up = pg.goto(SITE + '/my/subscription/upgrade', wait_until='networkidle')
        rec('U-3 「요금제 보기」 링크가 열림', up.status == 200, up.status)
        import time
        time.sleep(31)   # 공개 설정은 30초 캐시합니다
        pg.goto(SITE + '/my/subscription', wait_until='networkidle'); pg.reload(wait_until='networkidle')
        basic = pg.locator('[data-view-limit="BASIC"]'); std = pg.locator('[data-view-limit="STANDARD"]')
        rec('U-5 구독 화면: 한도 켜짐 → 무료 「월 3건」(운영 설정값) · 스탠다드 「월 30건」',
            basic.count() == 1 and '월 3건' in basic.inner_text() and '월 30건' in std.inner_text(), (basic.inner_text() if basic.count() else '-', std.inner_text() if std.count() else '-'))
        rec('U-4 화면 스크립트 오류 0', not errs, errs[:2])
        c.close()

        # ══ 8. 운영 BO — 스위치 ══
        c = br.new_context(); pg = c.new_page()
        pg.goto(BO); pg.wait_for_timeout(800)
        __import__('consent_ok').agree('admin@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
        for name in ('법정 고지', '사이트 정보', '사이트 기본 정보'):
            if _bo_tab(pg, name): break      # v10.29 — 묶음 단추 → .ad-snb 탭
        pg.wait_for_timeout(1500)
        box = pg.locator('section[data-view-limit]')
        rec('B-1 BO 「요청 열람 한도」 상자 — 지금 상태(on) 표시', box.count() == 1 and box.get_attribute('data-view-limit') == 'on', box.count())
        box.get_by_label('홍보 기간 — 모든 회원 제한 없음').click(); pg.wait_for_timeout(1500)
        rec('B-2 BO 에서 「홍보 기간」 선택 → 설정 off', cur('request.view.limit') == 'off' and pg.locator('section[data-view-limit]').get_attribute('data-view-limit') == 'off', cur('request.view.limit'))
        rec('B-3 끄자마자 막혔던 회원이 다시 열람', view(TN, 3)[0] == 200)
        inp = pg.locator('input[name=view-free-monthly]'); inp.fill('7'); inp.blur(); pg.wait_for_timeout(1500)
        rec('B-4 BO 에서 월 건수 7 저장', cur('request.view.free_monthly') == '7', cur('request.view.free_monthly'))
        pg.locator('section[data-view-limit]').get_by_label('정식 서비스 — 한도 적용').click(); pg.wait_for_timeout(1500)
        rec('B-5 BO 에서 「정식 서비스」 선택 → 설정 on', cur('request.view.limit') == 'on', cur('request.view.limit'))
        d = pg.locator('input[name=view-limit-from]'); d.fill('2027-01-02'); d.blur(); pg.wait_for_timeout(1500)
        rec('B-6 BO 에서 홍보 기간 종료일 저장', cur('request.view.limit_from') == '2027-01-02', cur('request.view.limit_from'))
        sc = pg.locator('section[data-refcode-scope]')
        rec('B-7 BO 「소개코드 범위」 상자 — 지금 매물별', sc.count() == 1 and sc.get_attribute('data-refcode-scope') == 'listing', sc.count())
        sc.get_by_label('전체 — 코드 1개로 모든 매물').click(); pg.wait_for_timeout(1500)
        a1 = cur('refcode.scope')
        pg.locator('section[data-refcode-scope]').get_by_label('매물별 — 매물마다 코드가 따로').click(); pg.wait_for_timeout(1500)
        rec('B-8 BO 에서 전체 ↔ 매물별 전환', a1 == 'all' and cur('refcode.scope') == 'listing', (a1, cur('refcode.scope')))
        c.close(); br.close()
finally:
    for k, v in ORIG.items():
        q(f"update site_settings set value='{v}' where key='{k}'")
    rec('Z-1 설정 원래 값으로 되돌림', all(cur(k) == v for k, v in ORIG.items()), ORIG)

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_viewlimit.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
