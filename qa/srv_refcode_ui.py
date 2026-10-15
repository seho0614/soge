"""D010 · D012 소개코드(매물별) — 사용자 웹 실측 (Playwright · 실제 로그인 · 클릭).

SB-MAL-DTL-010 안심소개 상세 「소개코드 공유」 · SB-MAL-GIV-010 /mall/give · middleware ?ref= 유입 기록.

사용:  SITE=http://localhost:5311 API=http://localhost:3031 python3 srv_refcode_ui.py
       (통합 후 SITE=http://localhost:5174 API=http://localhost:3000)
       DB=postgresql://sgb:sgb@localhost:5432/sgb (기본값)
       D012 — 운영 설정 refcode.scope 기본 listing. 시험 중 잠깐 all 로 바꿨다가 반드시 listing 으로 되돌립니다(finally).
결과:  /home/claude/qa/srv_refcode_ui.json  {"pass":n,"total":n,"items":[...]}
캡처:  /home/claude/qa/web_refcode_{detail,give}_{1280,390}.png
"""
import json, os, subprocess, sys, time, urllib.request, uuid
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright

SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
API = os.environ.get('API', 'http://localhost:3000').rstrip('/')
B = API if API.endswith('/api/v1') else API + '/api/v1'
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
OUT = '/home/claude/qa'
PW = 'sgb-test-1234'
# 헤드리스 표시(HeadlessChrome)는 미리보기 로봇으로 걸러지므로 일반 브라우저 UA 로 엽니다
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
BAD = ['Application error', 'Internal Server Error', 'Unhandled Runtime Error']
R = []



# v10.31 (w1) — 가입은 시안 5단계(SignupWizard). 화면으로 가입할 때 쓰는 손잡이.
def wizard_to_terms(pg, name, email, pw, typ='PERSONAL'):
    """1 유형 → 3 담당자 정보 → 4 약관 동의 화면까지(개인 회원은 2단계 없음)"""
    pg.locator(f'.w1-jop[data-jt={typ}]').click()
    pg.locator('.w1-jnav .w1-jb.p').click()
    pg.fill('#j-nm', name); pg.fill('#j-em', email); pg.fill('#j-pw', pw); pg.fill('#j-pw2', pw)
    pg.locator('.w1-jnav .w1-jb.p').click(); pg.wait_for_selector('[data-consent]', timeout=10000)

def wizard_finish(pg):
    """4 → 5(성향은 건너뜀) → 「가입 신청하기」 → /signup/done"""
    pg.locator('.w1-jnav .w1-jb.p').click(); pg.locator('.w1-jnav .w1-jb.a').click()
    pg.wait_for_url('**/signup/done**', timeout=30000)

def rec(name, ok, detail=''):
    R.append({'step': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', name, str(detail)[:160], file=sys.stderr)


def q(sql):
    return subprocess.run(['psql', DB, '-tAc', sql], capture_output=True, text=True).stdout.strip().split('\n')[0]


def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'User-Agent': UA}
    if tok:
        h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    try:
        r = urllib.request.urlopen(urllib.request.Request(B + p, method=m, data=data, headers=h), timeout=30)
        return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'null')


def api_signup(prefix):
    e = f'{prefix}_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': e, 'password': PW, 'name': '화면시험'})
    return e, j['accessToken'], q(f"select id from accounts where email='{e}'")


def api_login(e):
    return call('POST', '/auth/login', body={'email': e, 'password': PW})[1]['accessToken']


def ui_login(ctx, email, pw=PW):
    pg = ctx.new_page()
    pg.goto(SITE + '/login', wait_until='networkidle')
    __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.locator('button', has_text='로그인').last.click()
    pg.wait_for_timeout(2500)
    ok = any(c['name'] == 'sgb_at' for c in ctx.cookies())
    pg.close()
    return ok


def watch(pg):
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return errs


def page_ok(pg, r, errs, label):
    html = pg.content()
    rec(f'{label} HTTP 200 · Application error 없음 · 콘솔 오류 0',
        r is not None and r.status == 200 and not any(b in html for b in BAD) and not errs, (r and r.status, errs[:3]))


def overflow(pg):
    return pg.evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth')


def links_ok(ctx, pg, label):
    hrefs = pg.eval_on_selector_all('main a[href], a[href]', 'els => els.map(e => e.getAttribute("href"))')
    bad, seen = [], set()
    for h in hrefs:
        if not h or h.startswith(('mailto:', 'tel:', 'javascript:', '#')):
            continue
        u = urljoin(SITE + '/', h).split('#')[0]
        if urlparse(u).netloc != urlparse(SITE).netloc or u in seen:
            continue
        seen.add(u)
        try:
            st = ctx.request.get(u, timeout=30000, max_redirects=10).status
        except Exception as e:  # noqa
            st = str(e)[:60]
        if st != 200:
            bad.append((u, st))
    rec(f'{label} 내부 링크 전부 200 ({len(seen)}개)', not bad, bad[:5])


_rows = subprocess.run(['psql', DB, '-tAc', """select l.id||'|'||a.email from listings l join accounts a on a.id=l.owner_account_id join categories c on c.id=l.category_id
  where l.status='PUBLISHED' and l.gwan_code='MAL' and a.email like 'brk_%@t.local' and a.status='ACTIVE' and not fn_category_no_intro(c.id)
    and exists(select 1 from account_roles r where r.account_id=a.id and r.role='BIZ_OWNER')
    and exists(select 1 from businesses b where b.account_id=a.id and b.verified_at is not null) order by l.published_at desc, l.id limit 2"""],
    capture_output=True, text=True).stdout.strip().split('\n')
(L, seller), (L2, seller2) = [x.split('|') for x in _rows]
DETAIL = f'{SITE}/mall/{L}'
DETAIL2 = f'{SITE}/mall/{L2}'
T_START = q("select now()::text")
# v10.31 (합침 · w3 D060 · 10/10 시안 기준) — 무료 요금제(BASIC) 포함 소개코드는 0건. 화면 문구 · 발급 흐름 기대값을 요금제 값(DB)에 맞춥니다
FREE = int(q("select included_codes from subscription_plans where code='BASIC'") or 0)
FREE_TXT = f'이번 달 새 매물 {FREE}건은 무료' if FREE > 0 else '무료 소개코드 없이 건당 30,000원'


def set_scope(v):
    """운영 설정 refcode.scope — 관리자 API. 사이트는 공개 설정을 30초 캐시합니다"""
    tok = call('POST', '/auth/login', body={'email': 'admin@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
    return call('PATCH', '/admin/site-settings', tok, {'key': 'refcode.scope', 'value': v})


import atexit
atexit.register(lambda: set_scope('listing'))     # 시험이 어디서 끝나든 공용 설정은 listing 으로


def wait_give_scope(ctx, want_button, limit=45):
    """/mall/give 가 설정을 반영할 때까지(캐시 30초) 기다립니다 — 받기 버튼 칸([data-refshare])이 scope=all 에만 있습니다"""
    t0 = time.time()
    while True:
        pg = ctx.new_page()
        pg.goto(SITE + '/mall/give', wait_until='networkidle')
        has = pg.locator('[data-refshare]').count() > 0
        pg.close()
        if has == want_button or time.time() - t0 > limit:
            return has == want_button, round(time.time() - t0)
        time.sleep(3)


with sync_playwright() as p:
    br = p.chromium.launch()

    # ── 1. 비로그인 ─────────────────────────────────────────────
    set_scope('listing')
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}, user_agent=UA)
    okw, sec = wait_give_scope(ctx, False)
    rec('[설정] refcode.scope=listing 이 사이트에 반영됨', okw, f'{sec}s')
    pg = ctx.new_page(); errs = watch(pg)
    r = pg.goto(DETAIL, wait_until='networkidle')
    page_ok(pg, r, errs, '[비로그인] /mall/{id}')
    rec(f'[비로그인] 상세 문구 — 「매물마다 따로」 · 「{FREE_TXT}」', '매물마다 따로' in pg.inner_text('[data-refshare]')
        and FREE_TXT in pg.inner_text('[data-refshare]'), pg.inner_text('[data-refshare]')[:160])
    rec('[비로그인] 상세 「소개코드 공유」 칸 — 로그인 안내', pg.locator('[data-refshare-login]').count() == 1
        and '로그인하고 소개코드 받기' in pg.inner_text('[data-refshare]'))
    pg2 = ctx.new_page(); errs2 = watch(pg2)
    r = pg2.goto(SITE + '/mall/give', wait_until='networkidle')
    page_ok(pg2, r, errs2, '[비로그인] /mall/give')
    t = pg2.inner_text('body')
    rec('[비로그인] /mall/give 「준비 중」 문구 없음 · 매물 없이 누르는 공유 버튼 없음 · 「매물 상세에서 소개코드 공유」 안내 · 매물 보러 가기',
        '준비 중' not in t and pg2.locator('[data-refshare-open]').count() == 0 and pg2.locator('[data-refshare]').count() == 0
        and '소개할 매물 상세의 「소개코드 공유」를 누릅니다' in t and '매물마다 따로' in t and pg2.locator('a[href="/mall"]', has_text='매물 보러 가기').count() >= 1, t[:200])
    ctx.close()

    # ── 2. 일반 회원 — 본인인증 전 → 결제 안내 → 시험 결제로 추가 1건 ─────────
    eN, TN, N = api_signup('uiN')
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}, user_agent=UA)
    rec('[회원N] 화면 로그인', ui_login(ctx, eN))
    pg = ctx.new_page(); errs = watch(pg)
    r = pg.goto(DETAIL, wait_until='networkidle')
    page_ok(pg, r, errs, '[회원N · 본인인증 전] /mall/{id}')
    rec('[회원N] 본인인증 전 안내 표시', pg.locator('[data-refshare-verify]').count() == 1)
    pg.click('[data-refshare-open]'); pg.wait_for_selector('[data-refshare-pay]', timeout=10000)
    txt = pg.inner_text('[data-refshare-pay]')
    rec('[회원N] 「소개코드 공유」 → 무료분 없음 → 「추가 1건 30,000원」 결제 안내(본인인증 링크 포함)',
        '30,000원' in txt and '본인인증' in txt and q(f"select count(*) from referral_codes where owner_account_id='{N}'") == '0', txt[:160])
    pg.click('[data-refshare-paybtn]'); pg.wait_for_selector('[data-refshare-code]', timeout=15000)
    codeN = pg.get_attribute('[data-refshare-code]', 'data-refshare-code')
    rec('[회원N] 시험 결제(스텁) → 추가 코드 발급 · 결제 행 stub',
        q(f"select count(*) from referral_code_payments where account_id='{N}' and stub and amount=30000") == '1'
        and q(f"select is_extra::text||extra_amount||listing_id from referral_codes where code='{codeN}'") == f'true30000{L}', codeN)
    rec('[회원N] 콘솔 오류 0 (클릭 후)', not errs, errs[:3])
    ctx.close()

    # ── 3. 일반 회원 M — 본인인증 후 무료 1건 · 다시 눌러도 같은 코드 ────────────
    eM, TM, M = api_signup('uiM')
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}, user_agent=UA)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=SITE)
    rec('[회원M] 화면 로그인', ui_login(ctx, eM))
    pv = ctx.new_page(); ev = watch(pv)
    pv.goto(SITE + '/verify', wait_until='networkidle')
    pv.locator('button', has_text='PASS 로 본인인증').click(); pv.wait_for_timeout(2500)
    rec('[회원M] /verify 「PASS 로 본인인증」 클릭 → 인증됨(스텁)', q(f"select identity_verified_at is not null from accounts where id='{M}'") == 't', ev[:2])
    pv.close()
    pg = ctx.new_page(); errs = watch(pg)
    r = pg.goto(DETAIL, wait_until='networkidle')
    page_ok(pg, r, errs, '[회원M] /mall/{id}')
    pg.click('[data-refshare-open]')
    if FREE > 0:
        pg.wait_for_selector('[data-refshare-code]', timeout=15000)
    else:
        # v10.31 (합침 · D060) — 무료 요금제 포함 0건: 본인인증 회원도 결제 안내(「무료 소개코드 없음 · 건당 30,000원」) → 시험 결제로 받음
        pg.wait_for_selector('[data-refshare-pay]', timeout=15000)
        txt0 = pg.inner_text('[data-refshare-pay]')
        rec('[회원M] 「소개코드 공유」 → 무료분 없음(BASIC 0건) → 「무료 소개코드 없음 · 건당 30,000원」 안내 · 아직 발급 안 됨',
            '무료 소개코드 없음' in txt0 and '30,000원' in txt0 and q(f"select count(*) from referral_codes where owner_account_id='{M}'") == '0', txt0[:160])
        pg.click('[data-refshare-paybtn]'); pg.wait_for_selector('[data-refshare-code]', timeout=15000)
    codeM = pg.get_attribute('[data-refshare-code]', 'data-refshare-code')
    link = pg.get_attribute('[data-refshare-link]', 'data-refshare-link')
    rec('[회원M] 「소개코드 공유」 → ' + ('무료 코드' if FREE > 0 else '시험 결제 코드') + ' 발급(그 매물에 묶임) · 공유 링크 = {사이트}/mall/{id}?ref=코드',
        link == f'{DETAIL}?ref={codeM}' and q(f"select is_extra::text||listing_id from referral_codes where code='{codeM}'") == f"{'false' if FREE > 0 else 'true'}{L}", link)
    pg.click('[data-refshare-copy]'); pg.wait_for_timeout(500)
    clip = pg.evaluate('() => navigator.clipboard.readText()')
    rec('[회원M] 「링크 복사」 → 클립보드 = 공유 링크', clip == link, clip)
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.screenshot(path=f'{OUT}/web_refcode_detail_1280.png', full_page=True)
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    rec('[회원M] /mall/{id} 390px 가로 넘침 없음(코드 표시 상태)', overflow(pg) <= 0, overflow(pg))
    pg.screenshot(path=f'{OUT}/web_refcode_detail_390.png', full_page=True)
    pg.set_viewport_size({'width': 1280, 'height': 900})
    r = pg.goto(DETAIL, wait_until='networkidle')
    pg.click('[data-refshare-open]'); pg.wait_for_selector('[data-refshare-code]', timeout=15000)
    again = pg.get_attribute('[data-refshare-code]', 'data-refshare-code')
    rec('[회원M] 같은 매물은 다시 눌러도 같은 코드(이 매물에 받은 코드) · 새로 발급 안 함 · 무료분 1건만 소모',
        again == codeM and '이 매물에 받은 코드' in pg.inner_text('[data-refshare-code]')
        and q(f"select count(*) from referral_codes where owner_account_id='{M}'") == '1', again)
    # 두 번째 매물 — 무료분(새 매물 1건)을 이미 썼으므로 결제 안내 → 시험 결제 → 그 매물의 코드
    r = pg.goto(DETAIL2, wait_until='networkidle')
    pg.click('[data-refshare-open]'); pg.wait_for_selector('[data-refshare-pay]', timeout=15000)
    txt2 = pg.inner_text('[data-refshare-pay]')
    rec('[회원M] 두 번째 매물 「소개코드 공유」 → 결제 안내(새 매물은 추가 결제) · 아직 발급 안 됨',
        '30,000원' in txt2 and ('새 매물의 코드는 추가 결제 후' in txt2 if FREE > 0 else '무료 소개코드 없음' in txt2)
        and q(f"select count(*) from referral_codes where owner_account_id='{M}'") == '1', txt2[:160])
    pg.click('[data-refshare-paybtn]'); pg.wait_for_selector('[data-refshare-code]', timeout=15000)
    codeM2 = pg.get_attribute('[data-refshare-code]', 'data-refshare-code')
    link2 = pg.get_attribute('[data-refshare-link]', 'data-refshare-link')
    rec('[회원M] 두 번째 매물 — 시험 결제 후 **다른 코드** · 그 매물 링크',
        codeM2 != codeM and link2 == f'{DETAIL2}?ref={codeM2}'
        and q(f"select is_extra::text||listing_id from referral_codes where code='{codeM2}'") == f'true{L2}', (codeM2, link2))
    r = pg.goto(DETAIL, wait_until='networkidle')
    rec('[회원M] 콘솔 오류 0 (클릭 후)', not errs, errs[:3])
    n_before = q(f"select count(*) from attribution_events where code='{codeM}'")
    pg.goto(f'{DETAIL}?ref={codeM}', wait_until='networkidle')
    rec('[회원M] 로그인 상태로 자기 링크 열기 → 유입 기록 안 됨(본인)', q(f"select count(*) from attribution_events where code='{codeM}'") == n_before)
    ctx_m = ctx

    # ── 4. 공유 링크로 비로그인 방문 → 중복 없음 → 가입 → 본인인증 → 문의 → 거래 ────
    vctx = br.new_context(viewport={'width': 1280, 'height': 900}, user_agent=UA)
    pg = vctx.new_page(); errs = watch(pg)
    r = pg.goto(link, wait_until='networkidle')
    page_ok(pg, r, errs, '[방문자] 공유 링크 열기')
    ck = {c['name']: c['value'] for c in vctx.cookies()}
    vis = ck.get('sgb_visitor')
    rec('[방문자] sgb_visitor 생성 · sgb_ref = 코드(90일)', bool(vis) and ck.get('sgb_ref') == codeM,
        {k: v for k, v in ck.items() if k.startswith('sgb_')})
    exp = [c for c in vctx.cookies() if c['name'] == 'sgb_ref']
    rec('[방문자] sgb_ref 만료 약 90일 · SameSite=Lax', exp and 89 * 86400 < exp[0]['expires'] - __import__('time').time() <= 90 * 86400 + 60
        and exp[0]['sameSite'] == 'Lax', exp)
    rec('[방문자] attribution_events 1건 (코드 · 방문자 키)', q(f"select count(*) from attribution_events where code='{codeM}' and visitor_key='{vis}'") == '1')
    pg.goto(link, wait_until='networkidle'); pg.reload(wait_until='networkidle')
    rec('[방문자] 같은 링크 재방문 · 새로고침 → 중복 기록 없음(여전히 1건)',
        q(f"select count(*) from attribution_events where code='{codeM}' and visitor_key='{vis}'") == '1')
    eV = f'uiV_{uuid.uuid4().hex[:8]}@t.local'
    pg.goto(SITE + '/signup', wait_until='networkidle')
    wizard_to_terms(pg, '소개받은사람', eV, PW); pg.locator('[data-consent-all]').check(); wizard_finish(pg)      # v10.31 (w1) — 시안 5단계 가입 → 가입 완료
    pg.goto(SITE + '/verify', wait_until='networkidle')
    VACC = q(f"select id from accounts where email='{eV}'")
    rec('[방문자] 화면 가입 → 방문자 키가 새 계정에 연결(visitor_identities)',
        q(f"select count(*) from visitor_identities where visitor_key='{vis}' and account_id='{VACC}'") == '1', VACC)
    pg.wait_for_load_state('networkidle')
    pg.locator('button', has_text='PASS 로 본인인증').click(); pg.wait_for_timeout(2500)
    rec('[방문자] 화면 본인인증', q(f"select identity_verified_at is not null from accounts where id='{VACC}'") == 't')
    TV = api_login(eV)
    st, c = call('POST', '/conversations', TV, {'targetType': 'LISTING', 'targetId': L, 'message': '소개 링크로 보고 문의드립니다. 상담 가능할까요?'})
    st2, d = call('POST', f"/conversations/{(c or {}).get('conversationId')}/deal", api_login(seller))
    intro = q(f"select introducer_account_id||'|'||attributed_code from deals where id='{(d or {}).get('dealId')}'")
    rec('[방문자] 그 매물에 문의 → 거래 생성 → deals.introducer_account_id = 코드 주인(회원M)', intro == f'{M}|{codeM}', (st, st2, d, intro))
    eV2 = f'uiW_{uuid.uuid4().hex[:8]}@t.local'
    w = br.new_context(viewport={'width': 1280, 'height': 900}, user_agent=UA)
    pw_ = w.new_page(); pw_.goto(link, wait_until='networkidle')          # A 매물 링크로 들어옴
    pw_.goto(SITE + '/signup', wait_until='networkidle')
    wizard_to_terms(pw_, '다른매물문의', eV2, PW); pw_.locator('[data-consent-all]').check(); wizard_finish(pw_)      # v10.31 (w1) — 시안 5단계 가입 → 가입 완료
    pw_.goto(SITE + '/verify', wait_until='networkidle')
    pw_.wait_for_load_state('networkidle')
    pw_.locator('button', has_text='PASS 로 본인인증').click(); pw_.wait_for_timeout(2500)
    TW = api_login(eV2)
    st, c = call('POST', '/conversations', TW, {'targetType': 'LISTING', 'targetId': L2, 'message': '다른 매물을 보고 문의드립니다. 상담 가능할까요?'})
    st2, d = call('POST', f"/conversations/{(c or {}).get('conversationId')}/deal", api_login(seller2))
    intro2 = q(f"select coalesce(introducer_account_id::text,'-')||'|'||coalesce(attributed_code,'-') from deals where id='{(d or {}).get('dealId')}'")
    rec('[방문자2] A 매물 링크로 들어와 **B 매물**에 문의 → 거래에 소개자 없음', st2 in (200, 201) and intro2 == '-|-', (st, st2, d, intro2))
    w.close()
    vctx.close()

    # ── 5. /mall/give — 내 소개코드 · 유입 수 · 링크 · 390px ───────────────────
    pg = ctx_m.new_page(); errs = watch(pg)
    r = pg.goto(SITE + '/mall/give', wait_until='networkidle')
    page_ok(pg, r, errs, '[회원M] /mall/give')
    t = pg.inner_text('body')
    touches = pg.get_attribute(f'li[data-code="{codeM}"] [data-touches]', 'data-touches')
    rec('[회원M] /mall/give 내 소개코드 목록 2건 · 유입 수 = DB', pg.locator('ul.rc-list li').count() == 2
        and touches == q(f"select count(*) from attribution_events where code='{codeM}'") and int(touches) >= 1, touches)
    li = pg.locator(f'li[data-code="{codeM}"]')
    rec('[회원M] /mall/give 목록 — 매물 제목 · 매물로 가는 링크 · 그 매물 공유 링크',
        li.get_attribute('data-listing') == L and li.locator('a[data-code-listing]').get_attribute('href') == f'/mall/{L}'
        and li.locator('a[data-code-listing]').inner_text().strip() == q(f"select title from listings where id='{L}'")
        and li.locator('[data-refshare-link]').get_attribute('data-refshare-link') == f'{DETAIL}?ref={codeM}',
        li.inner_text()[:120])
    rec('[회원M] /mall/give 내 요금제 줄 — ' + (f'이번 달 무료 사용 1/{FREE}' if FREE > 0 else '「무료 소개코드 없음 · 건당 30,000원」') + ' · 「준비 중」 없음',
        (f'1 / {FREE}건 사용' in t if FREE > 0 else '무료 소개코드 없음 · 건당 30,000원' in t) and '준비 중' not in t, t[:200])
    rec('[회원M] /mall/give 매물 없이 누르는 공유 버튼 없음(scope=listing) · 안내 문구',
        pg.locator('[data-refshare-open]').count() == 0 and '소개할 매물 상세의 「소개코드 공유」를 누릅니다' in t)
    links_ok(ctx_m, pg, '[회원M] /mall/give')
    pg.screenshot(path=f'{OUT}/web_refcode_give_1280.png', full_page=True)
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(300)
    rec('[회원M] /mall/give 390px 가로 넘침 없음', overflow(pg) <= 0, overflow(pg))
    pg.screenshot(path=f'{OUT}/web_refcode_give_390.png', full_page=True)
    rec('[회원M] /mall/give 콘솔 오류 0', not errs, errs[:3])
    pg3 = ctx_m.new_page(); e3 = watch(pg3)
    r = pg3.goto(SITE + '/my/subscription', wait_until='networkidle')
    page_ok(pg3, r, e3, '[회원M · MEMBER] /my/subscription')
    pg4 = ctx_m.new_page(); e4 = watch(pg4)
    r = pg4.goto(SITE + '/mall/give/pay?paymentKey=x&orderId=bad', wait_until='networkidle')
    page_ok(pg4, r, e4, '[회원M] /mall/give/pay 잘못된 값')
    rec('[회원M] /mall/give/pay 잘못된 값 → 안내 · 발급 안 함', '결제 정보가 올바르지 않습니다' in pg4.inner_text('body')
        and q(f"select count(*) from referral_codes where owner_account_id='{M}'") == '2')
    r = pg4.goto(SITE + f'/mall/give/pay?paymentKey=stub_{uuid.uuid4().hex}&orderId=rcx-{uuid.uuid4().hex[:12]}&amount=30000', wait_until='networkidle')
    rec('[회원M] /mall/give/pay 매물(listing) 없이 → 발급하지 않음(scope=listing)', '결제 정보가 올바르지 않습니다' in pg4.inner_text('body')
        and q(f"select count(*) from referral_codes where owner_account_id='{M}'") == '2')
    # 결제창 성공 주소가 매물을 이어받음 — 이미 받은 매물이면 그 코드를 그대로(결제 없음) · 링크는 그 매물
    pk = f'stub_{uuid.uuid4().hex}'
    r = pg4.goto(SITE + f'/mall/give/pay?paymentKey={pk}&orderId=rcx-{uuid.uuid4().hex[:12]}&amount=30000&listing={L}', wait_until='networkidle')
    pg4.wait_for_selector('[data-refshare-code]', timeout=15000)
    rec('[회원M] /mall/give/pay?listing= 매물을 이어받음 — 이미 받은 매물은 같은 코드 · 결제 안 함 · 그 매물 링크',
        pg4.get_attribute('[data-refshare-code]', 'data-refshare-code') == codeM
        and pg4.get_attribute('[data-refshare-link]', 'data-refshare-link') == f'{DETAIL}?ref={codeM}'
        and q(f"select count(*) from referral_code_payments where payment_key='{pk}'") == '0', e4[:2])

    # ── 5b. 운영 설정 refcode.scope=all — /mall/give 에서 바로 받기(전 동작). 시험 뒤 반드시 listing ──
    try:
        st, j = set_scope('all')
        okw, sec = wait_give_scope(ctx_m, True)
        rec('[설정 all] 관리자가 all 로 바꾸면 /mall/give 에 받기 버튼이 다시 보임', st < 300 and okw, f'{sec}s')
        pg5 = ctx_m.new_page(); e5 = watch(pg5)
        r = pg5.goto(SITE + '/mall/give', wait_until='networkidle')
        page_ok(pg5, r, e5, '[설정 all] /mall/give')
        pg5.click('[data-refshare-open]'); pg5.wait_for_selector('[data-refshare-pay],[data-refshare-code]', timeout=15000)
        rec('[설정 all] 「소개코드 공유」(매물 없이) 동작 — 무료분을 다 써서 결제 안내', pg5.locator('[data-refshare-pay]').count() == 1, pg5.inner_text('[data-refshare]')[:120])
        pg5.close()
    finally:
        st, j = set_scope('listing')
        okw, sec = wait_give_scope(ctx_m, False)
        rec('[설정] refcode.scope 를 listing 으로 되돌림 · 사이트 반영', st < 300 and okw
            and q("select value from site_settings where key='refcode.scope'") == 'listing', f'{sec}s')
    ctx_m.close()

    # ── 6. 기존 BIZ_OWNER(intro · STANDARD) 화면도 그대로 ────────────────────
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}, user_agent=UA)
    rec('[intro] 화면 로그인', ui_login(ctx, 'intro@x.com', 'sgb-dev-1234'))
    pg = ctx.new_page(); errs = watch(pg)
    r = pg.goto(DETAIL, wait_until='networkidle')
    page_ok(pg, r, errs, '[intro] /mall/{id}')
    TI = call('POST', '/auth/login', body={'email': 'intro@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
    qi = call('GET', f'/me/referral-codes/quota?listingId={L}', TI)[1]
    want_code = bool(qi.get('current')) or qi.get('freeRemaining', 0) > 0
    pg.click('[data-refshare-open]'); pg.wait_for_selector('[data-refshare-code],[data-refshare-pay],[data-refshare-msg]', timeout=15000)
    rec('[intro] 「소개코드 공유」(STANDARD) → 포함분이 남았거나 이미 받은 매물이면 코드 · 아니면 결제 안내',
        pg.locator('[data-refshare-code]').count() == (1 if want_code else 0) and pg.locator('[data-refshare-pay]').count() == (0 if want_code else 1),
        (qi.get('freeRemaining'), bool(qi.get('current'))))
    # 공용 계정(intro)에 이 시험이 만든 포함분 코드를 남기지 않습니다
    q(f"delete from referral_codes rc where owner_account_id=(select id from accounts where email='intro@x.com') and listing_id='{L}' and not is_extra and issued_at >= '{T_START}'::timestamptz and not exists(select 1 from attribution_events e where e.code=rc.code)")
    r = pg.goto(SITE + '/mall/give', wait_until='networkidle')
    page_ok(pg, r, errs, '[intro] /mall/give')
    ctx.close()
    br.close()

json.dump({'pass': sum(x['ok'] for x in R), 'total': len(R), 'items': R},
          open(f'{OUT}/srv_refcode_ui.json', 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(x['ok'] for x in R)} / {len(R)}")
