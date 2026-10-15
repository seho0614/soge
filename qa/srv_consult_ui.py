"""10/2 v10.11 · v10.12 — 축별 입점 · 법률 · 세무 월 정액 노출 (D018 · D019) · 월 노출료 기준 금액(D020) 화면 검증.

사이트(업체)와 BO(운영 ops@t.local ADMIN)를 Playwright 로 실제 로그인해 버튼까지 누릅니다.

  1. 사이트 /partner/apply · /partner/listings   축별 입점 신청 · 상태(심사 중 · 승인 · 반려 사유)
  2. BO 「안심소개 입점 심사」                    승인 · 반려(사유 5자) · 부동산은 중개사 인증 전 승인 잠김
  3. 사이트 /partner/listings                     법률 사무소 월 정액 노출 신청
  4. BO 「법률·세무 정액 노출」                   자격 전에는 「노출 켜기」 잠김 → 입금 확인 → 노출 켜기 → 종료
  5. 사이트 /mal/consult · /mal/consult/CSL_LEGAL  사무소 보기(광고 · 전화) · 종료 뒤 빠짐
  6. 사이트 /mal/give → /mall/give · 파트너센터 메뉴

  v10.33 (D092 · 부가세 별도 · 기간 연장 A안 · 세금계산서) 에 맞춘 곳 — 까닭: 노출 기간은 개월 단위(BO 「개월수」 고르기 ·
  종료일 칸 없음) · 노출 중인 항목은 BO 에서 다시 켜서 늘리지 않고 업체 「연장 신청」 → BO 「연장 신청」 탭 「연장 입금 확인」 ·
  금액 표시는 「월 N원 (부가세 별도)」. UI-3-0 · UI-4-3 · UI-4-10 · UI-5-6 의 기대값을 새 화면에 맞췄고 UI-4-13~16(세금계산서)을 더했습니다.

사용: API=http://localhost:3000/api/v1 BO=http://127.0.0.1:5173 SITE=http://localhost:5174 python3 srv_consult_ui.py
"""
import json, os, subprocess, sys, uuid, urllib.request, datetime
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)
API = os.environ.get('API', 'http://localhost:3000').rstrip('/').removesuffix('/api/v1')
BO = os.environ.get('BO', 'http://127.0.0.1:5173').rstrip('/')
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:200]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)

def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(API + '/api/v1' + p, method=m,
        data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: return st, json.loads(raw) if raw else None
    except Exception: return st, None
login = lambda e, pw='sgb-dev-1234': call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']
ADM = login('admin@x.com'); OPS = login('ops@t.local', 'sgb-test-1234')
tag = uuid.uuid4().hex[:6]
E = f'cui_{tag}@t.local'
call('POST', '/auth/signup', body={'email': E, 'password': 'sgb-test-1234', 'name': '입점화면', 'agreedTerms': []})
T = login(E, 'sgb-test-1234')
call('POST', '/verifications/identity', T, {'provider': 'PASS'})
COMPANY = f'화면법무{tag}'
bid = call('POST', '/businesses', T, {'bizRegNo': str(uuid.uuid4().int)[-10:], 'companyName': COMPANY, 'ceoName': '김화면', 'sido': '서울', 'sigungu': '금천구'})[1]['businessId']
call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
T = login(E, 'sgb-test-1234')
OFFICE = f'법무법인 화면{tag}'
today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)).date()
# v10.33 — 기간은 개월 단위: 1개월 = 시작일 + 1개월 − 1일(DB fn_directory_period_to)
until = q(f"select fn_directory_period_to('{today}'::date, 1)::text")
until2 = q(f"select fn_directory_period_to(('{until}'::date + 1), 1)::text")   # 1개월 연장 뒤 종료일

def bo_login(pg, email, pw):
    pg.goto(BO); pg.wait_for_timeout(600)
    __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
def bo_tab(pg, name):
    _bo_tab(pg, name); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
main = lambda pg: pg.evaluate("document.querySelector('.bo-main').innerText")
def site_login(pg, email, pw):
    pg.goto(SITE + '/login'); __import__('consent_ok').agree(email, pw); pg.fill('input[name=email]', email); pg.fill('input[name=password]', pw)
    pg.click('form.auth button'); pg.wait_for_timeout(2000)
body = lambda pg: pg.evaluate("document.querySelector('main') ? document.querySelector('main').innerText : document.body.innerText")

def until_ok(pg, url, cond, tries=8, gap=10000):
    """사이트는 공개 목록을 60초 캐시합니다 — 바뀐 값이 보일 때까지 다시 엽니다."""
    for i in range(tries):
        pg.goto(url, wait_until='networkidle')
        if cond(pg): return True
        pg.wait_for_timeout(gap)
    return False

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    # ── 1. 사이트 — 축별 입점 신청 ─────────────────────────────────────
    c1 = b.new_context(viewport={'width': 1280, 'height': 900}); sp = c1.new_page()
    sp.on('pageerror', lambda e: errs.append('site: ' + str(e)))
    site_login(sp, E, 'sgb-test-1234')
    sp.goto(SITE + '/partner/apply', wait_until='networkidle')
    box = sp.locator('[data-axis-apply]')
    rows = box.locator('tr[data-axis]')
    rec('UI-1-1 /partner/apply 에 「입점할 축」 표 — 4축 · 모두 미신청', box.count() == 1 and rows.count() == 4
        and all(rows.nth(i).get_attribute('data-axis-state') == 'NONE' for i in range(4)) and '개업공인중개사 인증' in box.inner_text(), box.inner_text()[:160] if box.count() else '')
    box.locator('button', has_text='고른 축 입점 신청').click(); sp.wait_for_timeout(800)
    rec('UI-1-2 아무 축도 고르지 않고 신청 → 화면이 막고 사유', '하나 이상 고르십시오' in box.inner_text(), box.inner_text()[-80:])
    for a in ('CONSULT', 'EQUIP', 'RE'):
        box.locator(f'input[name=axis-{a}]').check()
    box.locator('button', has_text='고른 축 입점 신청').click(); sp.wait_for_timeout(2000)
    st = {a: q(f"select state from mal_partner_axes where business_id='{bid}' and axis='{a}'") for a in ('CONSULT', 'EQUIP', 'RE', 'SOLAR')}
    rec('UI-1-3 3개 축 신청 → 서버에 PENDING 3건 · 화면 「심사 중」 · 신청한 축은 다시 고를 수 없음', st == {'CONSULT': 'PENDING', 'EQUIP': 'PENDING', 'RE': 'PENDING', 'SOLAR': ''}
        and box.locator('tr[data-axis-state="PENDING"]').count() == 3 and box.locator('input[name=axis-CONSULT]').is_disabled()
        and not box.locator('input[name=axis-SOLAR]').is_disabled() and '신청했습니다' in box.inner_text(), st)

    # ── 2. BO — 안심소개 입점 심사 ─────────────────────────────────────
    c2 = b.new_context(viewport={'width': 1440, 'height': 900}); pg = c2.new_page()
    pg.on('pageerror', lambda e: errs.append('bo: ' + str(e)))
    bo_login(pg, 'ops@t.local', 'sgb-test-1234')
    bo_tab(pg, '안심소개 입점 심사')
    ids = {a: q(f"select id from mal_partner_axes where business_id='{bid}' and axis='{a}'") for a in ('CONSULT', 'EQUIP', 'RE')}
    sec = pg.locator('[data-partner-axes]')
    rec('UI-2-1 BO 「안심소개 입점 심사」 탭 — 심사 대기 목록에 신청 3건(업체 · 축 · 국세청 단계)', sec.count() == 1
        and all(sec.locator(f'[data-axis-row="{i}"]').count() == 1 for i in ids.values()) and COMPANY in sec.inner_text(), main(pg)[:160])
    re_row = sec.locator(f'[data-axis-row="{ids["RE"]}"]')
    rec('UI-2-2 부동산 축 — 중개사 미인증이라 「승인」 잠김', re_row.locator('button[data-act=approve]').is_disabled() and '미인증' in re_row.inner_text(), re_row.inner_text()[:120])
    eq_row = sec.locator(f'[data-axis-row="{ids["EQUIP"]}"]')
    eq_row.locator('input[aria-label="반려 사유"]').fill('짧음')
    eq_row.locator('button[data-act=reject]').click(); pg.wait_for_timeout(1000)
    rec('UI-2-3 5자 미만 사유로 반려 → 화면이 막음 · 서버 그대로', '5자 이상' in main(pg) and q(f"select state from mal_partner_axes where id='{ids['EQUIP']}'") == 'PENDING', main(pg)[:200])
    eq_row.locator('input[aria-label="반려 사유"]').fill('설비 매물 등록 실적을 확인할 서류를 내 주십시오')
    eq_row.locator('button[data-act=reject]').click(); pg.wait_for_timeout(2000)
    rec('UI-2-4 사유 있는 반려 → REJECTED · 안내 문구', q(f"select state||'|'||reason from mal_partner_axes where id='{ids['EQUIP']}'") == 'REJECTED|설비 매물 등록 실적을 확인할 서류를 내 주십시오'
        and '반려했습니다' in main(pg), main(pg)[:200])
    sec.locator(f'[data-axis-row="{ids["CONSULT"]}"] button[data-act=approve]').click(); pg.wait_for_timeout(2000)
    rec('UI-2-5 상담 축 「승인」 → APPROVED · 대기 목록에서 빠짐', q(f"select state from mal_partner_axes where id='{ids['CONSULT']}'") == 'APPROVED'
        and sec.locator(f'[data-axis-row="{ids["CONSULT"]}"]').count() == 0 and '승인했습니다' in main(pg), main(pg)[:200])
    sec.locator('button[data-axes-state=APPROVED]').click(); pg.wait_for_timeout(1500)
    rec('UI-2-6 「승인」 탭에 승인 건 · 판정 칸은 「승인됨」', sec.locator(f'[data-axis-row="{ids["CONSULT"]}"]').count() == 1
        and '승인됨' in sec.locator(f'[data-axis-row="{ids["CONSULT"]}"]').inner_text(), '')

    # ── 3. 사이트 — 입점 상태 · 정액 노출 신청 ──────────────────────────
    pid = call('POST', '/partner/apply', T)[1]['id']
    call('POST', f'/admin/partners/{pid}/approve', ADM)
    sp.goto(SITE + '/partner/listings', wait_until='networkidle'); sp.wait_for_timeout(1200)
    box = sp.locator('[data-axis-apply]')
    t = box.inner_text()
    rec('UI-3-1 /partner/listings — 축별 상태(상담 승인 · 설비 반려 + 사유 · 부동산 심사 중) · 반려된 축만 다시 신청 가능',
        box.locator('tr[data-axis=CONSULT]').get_attribute('data-axis-state') == 'APPROVED' and box.locator('tr[data-axis=EQUIP]').get_attribute('data-axis-state') == 'REJECTED'
        and '설비 매물 등록 실적' in t and not box.locator('input[name=axis-EQUIP]').is_disabled() and box.locator('input[name=axis-CONSULT]').is_disabled(), t[:200])
    dbox = sp.locator('[data-directory-apply]')
    call('PATCH', '/admin/site-settings', OPS, {'key': 'directory.monthly_fee', 'value': '300000'})
    sp.reload(wait_until='networkidle'); sp.wait_for_timeout(1200)
    rec('UI-3-0 (v10.12 · v10.33) 정액 노출 신청 상자에 「월 300,000원 (부가세 별도)」 · 입금 월 330,000원 안내', dbox.locator('[data-base-fee="300000"]').count() == 1
        and '월 300,000원 (부가세 별도)' in dbox.inner_text() and '월 330,000원' in dbox.inner_text(), dbox.inner_text()[:200])
    dbox.locator('button', has_text='노출 신청').click(); sp.wait_for_timeout(800)
    rec('UI-3-2 정액 노출 신청 — 빈 칸으로 내면 화면이 막고 사유', '사무소 이름을 적어 주십시오' in dbox.inner_text()
        and q(f"select count(*) from consult_directory_entries where partner_id='{pid}'") == '0', dbox.inner_text()[-80:])
    dbox.locator('select[name=dir-category]').select_option('CSL_LEGAL')
    dbox.locator('input[name=dir-name]').fill(OFFICE)
    dbox.locator('textarea[name=dir-intro]').fill('민사 · 가사 · 부동산 분쟁')
    dbox.locator('input[name=dir-phone]').fill('02-555-0101')
    dbox.locator('input[name=dir-url]').fill('http://example.com')
    dbox.locator('input[name=dir-sido]').fill('서울')
    dbox.locator('button', has_text='노출 신청').click(); sp.wait_for_timeout(800)
    rec('UI-3-3 https 가 아닌 홈페이지 → 화면이 막음', 'https://' in dbox.locator('.form-error').inner_text(), dbox.locator('.form-error').inner_text())
    dbox.locator('input[name=dir-url]').fill('https://example.com')
    dbox.locator('button', has_text='노출 신청').click(); sp.wait_for_timeout(2000)
    eid = q(f"select id from consult_directory_entries where partner_id='{pid}'")
    rowm = dbox.locator('tr[data-dir-mine=CSL_LEGAL]')
    rec('UI-3-4 노출 신청 → 서버 PENDING · 표에 「심사 · 입금 확인 대기」 · 안내', bool(eid) and rowm.count() == 1 and rowm.get_attribute('data-dir-state') == 'PENDING'
        and '입금 확인 대기' in rowm.inner_text() and '신청했습니다' in dbox.inner_text(), rowm.inner_text() if rowm.count() else '')

    # ── 4. BO — 법률·세무 정액 노출 ────────────────────────────────────
    bo_tab(pg, '법률·세무 정액 노출')
    dsec = pg.locator('[data-directory-admin]')
    drow = dsec.locator(f'[data-dir-row="{eid}"]')
    pg.wait_for_timeout(600)
    bbox = dsec.locator('[data-base-fee]')
    rec('UI-4-0 (v10.12) BO 탭 맨 위 「월 노출료 기준 금액」 — 지금 300,000원 · 입력 칸 300000 · 바꾸지 않으면 「기준 금액 등록」 잠김',
        bbox.get_attribute('data-base-fee') == '300000' and bbox.locator('input[name=base-fee]').input_value() == '300000'
        and '지금 300,000원' in bbox.inner_text() and bbox.locator('button[data-act=save-base]').is_disabled(), bbox.inner_text()[:160])
    rec('UI-4-0b (v10.12) 대기 줄의 금액 칸 안내 — 「기준 300,000원 (비우면 기준 금액)」',
        '기준 300,000원' in (drow.locator('input[aria-label="월 노출료"]').get_attribute('placeholder') or ''), drow.locator('input[aria-label="월 노출료"]').get_attribute('placeholder'))
    rec('UI-4-1 BO 「법률·세무 정액 노출」 탭 — 대기 목록에 신청(사무소 · 업체 · 자격 미확인) · 「노출 켜기」 잠김', drow.count() == 1 and OFFICE in drow.inner_text()
        and '미확인' in drow.inner_text() and drow.locator('button[data-act=activate]').is_disabled(), drow.inner_text()[:160] if drow.count() else main(pg)[:160])
    qid = q(f"insert into qualification_reviews(business_id, category_code, doc_no) values ('{bid}','LEGAL','LAW-UI-{tag}') returning id")
    call('POST', f'/admin/qualifications/{qid}/lookup', OPS); call('POST', f'/admin/qualifications/{qid}/decide', OPS, {'approve': True})
    pg.reload(); pg.wait_for_timeout(1200); bo_tab(pg, '법률·세무 정액 노출')
    drow = pg.locator(f'[data-dir-row="{eid}"]')
    drow.locator('button[data-act=activate]').click(); pg.wait_for_timeout(800)
    rec('UI-4-2 자격 승인 뒤 — 금액 · 기간 · 입금 근거 없이 「노출 켜기」 → 화면이 막음', '모두 적어 주십시오' in main(pg)
        and q(f"select state from consult_directory_entries where id='{eid}'") == 'PENDING', main(pg)[:200])
    drow.locator('input[aria-label="월 노출료"]').fill('150000')
    drow.locator('input[aria-label="시작일"]').fill(str(today))
    drow.locator('select[aria-label="개월수"]').select_option('1')
    drow.locator('input[aria-label="입금 근거"]').fill(f'입금자 화면법무 · {tag}')
    rec('UI-4-2b (v10.33) 입금 확인 칸에 합계 미리 보기 — 공급가액 150,000 + 부가세 15,000 = 165,000원', drow.locator('[data-dir-quote="165000"]').count() == 1
        and '합계 165,000원' in drow.inner_text(), drow.inner_text()[-120:])
    drow.locator('button[data-act=activate]').click(); pg.wait_for_timeout(2500)
    rec('UI-4-3 입금 확인 → 「노출 켜기」 → ACTIVE · 금액 · 기간 저장', q(f"select state||'|'||monthly_fee::int||'|'||paid_from||'|'||paid_to from consult_directory_entries where id='{eid}'")
        == f'ACTIVE|150000|{today}|{until}' and '노출을 켰습니다' in main(pg), main(pg)[:200])
    pg.locator('button[data-dir-state=ACTIVE]').click(); pg.wait_for_timeout(1500)
    drow = pg.locator(f'[data-dir-row="{eid}"]')
    rec('UI-4-4 「노출 중」 탭 — 기간이 저장한 날짜 그대로(하루 밀리지 않음) · 월 150,000원', drow.count() == 1 and f'{today} ~ {until}' in drow.inner_text()
        and '150,000원' in drow.inner_text(), drow.inner_text()[:200] if drow.count() else '')

    # ── 4c. (v10.12 · D020) 기준 금액 등록 · 변경 → 금액을 비우고 켜면 기준 금액 ─────────
    bbox = pg.locator('[data-directory-admin] [data-base-fee]')
    bbox.locator('input[name=base-fee]').fill('30만'); bbox.locator('button[data-act=save-base]').click(); pg.wait_for_timeout(800)
    rec('UI-4-7 (v10.12) 「30만」처럼 형식이 틀린 기준 금액 → 화면이 막음 · 설정 그대로', '1,000원 이상의 숫자' in main(pg)
        and q("select value from site_settings where key='directory.monthly_fee'") == '300000', main(pg)[:160])
    try:
        bbox.locator('input[name=base-fee]').fill('320000'); bbox.locator('button[data-act=save-base]').click(); pg.wait_for_timeout(2500)
        bbox = pg.locator('[data-directory-admin] [data-base-fee]')
        rec('UI-4-8 (v10.12) 기준 금액 320000 등록 → 설정 320000 · 안내 · 상자 「지금 320,000원」', q("select value from site_settings where key='directory.monthly_fee'") == '320000'
            and '320,000원으로 등록했습니다' in main(pg) and bbox.get_attribute('data-base-fee') == '320000' and '지금 320,000원' in bbox.inner_text(), main(pg)[:200])
        rec('UI-4-9 (v10.12) 이미 노출 중인 건은 150,000원 그대로', q(f"select monthly_fee::int from consult_directory_entries where id='{eid}'") == '150000'
            and '150,000원' in pg.locator(f'[data-dir-row="{eid}"]').inner_text())
        # v10.33 A안 — 업체가 /partner/listings 에서 「연장 신청」(1개월 · 그때 기준 금액 320,000원) → BO 「연장 신청」 탭에서 입금 확인
        sp.goto(SITE + '/partner/listings', wait_until='networkidle'); sp.wait_for_timeout(1500)
        rowm = sp.locator('[data-directory-apply] tr[data-dir-mine=CSL_LEGAL]')
        rowm.locator('select[name=renew-months]').select_option('1')
        rec('UI-4-10a (v10.33) 업체 화면 연장 칸 — 320,000원 × 1개월 + 부가세 32,000원 = 352,000원 미리 보기', rowm.locator('[data-renew-quote="352000"]').count() == 1, rowm.inner_text()[-120:])
        rowm.locator('button[data-act=renew]').click(); sp.wait_for_timeout(2500)
        rowm = sp.locator('[data-directory-apply] tr[data-dir-mine=CSL_LEGAL]')
        rec('UI-4-10b (v10.33) 「연장 신청」 → RENEW_REQUESTED · 노출 계속 · 입금하실 금액 352,000원 안내', rowm.get_attribute('data-dir-state') == 'RENEW_REQUESTED'
            and rowm.locator('[data-renew-open="352000"]').count() == 1 and '352,000원' in sp.locator('[data-directory-apply] .form-ok').inner_text(), rowm.inner_text()[:200])
        pg.locator('button[data-dir-state=RENEW_REQUESTED]').click(); pg.wait_for_timeout(1500)
        drow = pg.locator(f'[data-dir-row="{eid}"]')
        drow.locator('button[data-act=renew-confirm]').click(); pg.wait_for_timeout(800)
        rec('UI-4-10c (v10.33) BO 「연장 신청」 탭 — 합계 352,000원 · 입금 근거 없이 확인 → 화면이 막음', drow.locator('[data-dir-renewal="352000"]').count() == 1
            and '입금 근거' in main(pg) and q(f"select state from consult_directory_entries where id='{eid}'") == 'RENEW_REQUESTED', drow.inner_text()[:200])
        drow.locator('input[aria-label="입금 근거"]').fill(f'입금자 화면법무 · 연장 {tag}')
        drow.locator('button[data-act=renew-confirm]').click(); pg.wait_for_timeout(2500)
        rec('UI-4-10 (v10.12 · v10.33) 연장 입금 확인 → 기준 금액 320,000원으로 기록 · 기간이 기존 종료일 다음 날부터 이어짐', q(f"select state||'|'||monthly_fee::int||'|'||paid_to from consult_directory_entries where id='{eid}'") == f'ACTIVE|320000|{until2}'
            and '연장 입금(합계 352,000원)을 확인했습니다' in main(pg), main(pg)[:200])
        pg.locator('button[data-dir-state=ACTIVE]').click(); pg.wait_for_timeout(1500)
        drow = pg.locator(f'[data-dir-row="{eid}"]')
        rec('UI-4-10d (v10.33) 「노출 중」 줄 — 월 320,000원 (부가세 별도) · 2회차 · 기간', '월 320,000원 (부가세 별도)' in drow.inner_text() and '2회차' in drow.inner_text()
            and f'{today} ~ {until2}' in drow.inner_text(), drow.inner_text()[:200])
        sp.goto(SITE + '/partner/listings', wait_until='networkidle'); sp.wait_for_timeout(1200)
        dbx = sp.locator('[data-directory-apply]')
        rec('UI-4-11 (v10.12) 업체 화면 — 안내 「기준 금액은 320,000원」 · 내 노출 줄 「월 320,000원」', dbx.locator('[data-base-fee="320000"]').count() == 1
            and '월 320,000원' in dbx.locator('tr[data-dir-mine=CSL_LEGAL]').inner_text(), dbx.inner_text()[:200])
        bbox = pg.locator('[data-directory-admin] [data-base-fee]')
        bbox.locator('input[name=base-fee]').fill('300000'); bbox.locator('button[data-act=save-base]').click(); pg.wait_for_timeout(2500)
        rec('UI-4-12 (v10.12) 기준 금액을 300000 으로 되돌림(화면) · 노출 중인 건은 320,000원 그대로', q("select value from site_settings where key='directory.monthly_fee'") == '300000'
            and q(f"select monthly_fee::int from consult_directory_entries where id='{eid}'") == '320000', main(pg)[:160])
        # ── 4d. (v10.33) 세금계산서 — 입금 확인마다 1건 · BO 에서 발행 번호 → 업체 화면 ──────
        pg.locator('button[data-dir-state=INVOICES]').click(); pg.wait_for_timeout(1500)
        irows = pg.locator('[data-dir-invoices] tr[data-inv-row]').filter(has_text=COMPANY)
        rec('UI-4-13 (v10.33) BO 「세금계산서」 탭 — 이 업체 발행 요청 2건(처음 165,000 · 연장 352,000) · 공급자 운영 법인', irows.count() == 2
            and '165,000원' in irows.nth(0).inner_text() + irows.nth(1).inner_text() and '352,000원' in irows.nth(0).inner_text() + irows.nth(1).inner_text()
            and '한국바이오헬스케어' in irows.nth(0).inner_text(), irows.count())
        ir = irows.filter(has_text='352,000원').first
        iid = ir.get_attribute('data-inv-row')
        ir.locator('button[data-act=issue]').click(); pg.wait_for_timeout(800)
        rec('UI-4-14 (v10.33) 발행 번호 없이 「발행됨으로」 → 화면이 막음', '발행 번호와 발행일' in main(pg) and q(f"select state from consult_directory_invoices where id='{iid}'") == 'REQUESTED', main(pg)[:160])
        ir.locator('input[aria-label="발행 번호"]').fill(f'UI33-{tag}')
        ir.locator('input[aria-label="발행일"]').fill(str(today))
        ir.locator('button[data-act=issue]').click(); pg.wait_for_timeout(2500)
        rec('UI-4-15 (v10.33) 발행 번호 · 발행일 → ISSUED', q(f"select state||'|'||invoice_no from consult_directory_invoices where id='{iid}'") == f'ISSUED|UI33-{tag}' and '발행됨' in main(pg), main(pg)[:160])
        sp.goto(SITE + '/partner/listings', wait_until='networkidle'); sp.wait_for_timeout(1500)
        it = sp.locator('[data-directory-apply] [data-dir-invoices]')
        rec('UI-4-16 (v10.33) 업체 화면 세금계산서 표 — 2건 · 발행 번호 · 일자 · 금액', it.locator('tr[data-inv]').count() == 2 and f'UI33-{tag}' in it.inner_text()
            and str(today) in it.inner_text() and '352,000원' in it.inner_text() and '발행 요청' in it.inner_text(), it.inner_text()[:200] if it.count() else '')
        pg.locator('button[data-dir-state=ACTIVE]').click(); pg.wait_for_timeout(1500)
    finally:
        call('PATCH', '/admin/site-settings', OPS, {'key': 'directory.monthly_fee', 'value': '300000'})

    # ── 5. 사이트 — 사무소 보기 ────────────────────────────────────────
    c3 = b.new_context(viewport={'width': 1280, 'height': 900}); gp = c3.new_page()
    gp.on('pageerror', lambda e: errs.append('guest: ' + str(e)))
    ok = until_ok(gp, SITE + '/mal/consult/CSL_LEGAL', lambda x: x.locator(f'[data-dir-entry="{eid}"]').count() == 1)
    ent = gp.locator(f'[data-dir-entry="{eid}"]')
    t = body(gp)
    rec('UI-5-1 비로그인 /mal/consult/CSL_LEGAL — 사무소 · 「광고」 표시 · 전화 링크 · 홈페이지(nofollow sponsored) · 신청서 없음', ok and OFFICE in ent.inner_text() and '광고' in ent.inner_text()
        and ent.locator('a[href="tel:025550101"]').count() == 1 and ent.locator('a[rel*="sponsored"][href="https://example.com"]').count() == 1
        and gp.locator('form.mal-form').count() == 0 and '추천하거나 연결하지 않습니다' in t, t[:200])
    n_pub = len(call('GET', '/consult/directory/CSL_LEGAL')[1]['entries'])
    ok = until_ok(gp, SITE + '/mal/consult', lambda x: f'게재 {n_pub}곳' in x.locator('.mal-row[data-csl="CSL_LEGAL"]').inner_text())
    row = gp.locator('.mal-row[data-csl="CSL_LEGAL"]')
    rec('UI-5-2 /mal/consult 법률 줄 — 「게재 N곳」 = API · 「사무소 보기」 → 사무소 목록', ok and row.locator('a.mal-btn[href="/mal/consult/CSL_LEGAL"]').count() == 1, row.inner_text())      # v10.24 — 업종 이름도 같은 곳으로 가는 링크라 단추만 셉니다
    row.locator('a.mal-btn').click(); gp.wait_for_load_state('networkidle')
    rec('UI-5-3 「사무소 보기」 클릭 → /mal/consult/CSL_LEGAL', gp.url.endswith('/mal/consult/CSL_LEGAL') and gp.locator('[data-consult-dir="CSL_LEGAL"]').count() == 1, gp.url)
    r = gp.goto(SITE + '/consult?cat=CSL_LEGAL', wait_until='networkidle')
    rec('UI-5-4 /consult?cat=CSL_LEGAL → 신청서 대신 사무소 목록으로 보냄', gp.url.endswith('/mal/consult/CSL_LEGAL'), gp.url)
    r = gp.goto(SITE + '/mal/consult/CSL_NOPE', wait_until='networkidle')
    rec('UI-5-5 없는 업종 → 404', r.status == 404, r.status)
    sp.goto(SITE + '/partner/listings', wait_until='networkidle'); sp.wait_for_timeout(1200)
    rowm = sp.locator('[data-directory-apply] tr[data-dir-mine=CSL_LEGAL]')
    rec('UI-5-6 업체 화면 /partner/listings — 「노출 중」 · 기간(v10.33 연장으로 이어진 종료일)', rowm.get_attribute('data-dir-state') == 'ACTIVE' and f'{today} ~ {until2}' in rowm.inner_text(), rowm.inner_text())

    # ── 4b. BO — 종료 ─────────────────────────────────────────────────
    drow = pg.locator(f'[data-dir-row="{eid}"]')   # v10.33 — 「노출 중」 탭의 줄
    drow.locator('input[aria-label="사유"]').fill('짧')
    drow.locator('button[data-act=end]').click(); pg.wait_for_timeout(800)
    rec('UI-4-5 5자 미만 사유로 종료 → 화면이 막음', '5자 이상' in main(pg) and q(f"select state from consult_directory_entries where id='{eid}'") == 'ACTIVE')
    drow.locator('input[aria-label="사유"]').fill('화면 시험 — 계약 기간 종료')
    drow.locator('button[data-act=end]').click(); pg.wait_for_timeout(2500)
    rec('UI-4-6 종료 → ENDED · 사유 저장', q(f"select state||'|'||reason from consult_directory_entries where id='{eid}'") == 'ENDED|화면 시험 — 계약 기간 종료' and '끝냈습니다' in main(pg), main(pg)[:160])
    ok = until_ok(gp, SITE + '/mal/consult/CSL_LEGAL', lambda x: x.locator(f'[data-dir-entry="{eid}"]').count() == 0)
    rec('UI-5-7 종료 뒤 공개 사무소 목록에서 빠짐', ok, body(gp)[:120])

    # ── 6. 그 밖의 연결 ───────────────────────────────────────────────
    r = gp.goto(SITE + '/mal/give', wait_until='networkidle')
    rec('UI-6-1 /mal/give(올린 kit 의 주소) → /mall/give 소개하기 안내로', gp.url.endswith('/mall/give') and r.status == 200 and '소개' in body(gp), gp.url)
    gp.goto(SITE + '/mall?axis=consult', wait_until='networkidle')
    rec('UI-6-2 /mall?axis=consult 비로그인 카드 — 「인증업체 등록」 · 「입점 상태 보기」', gp.locator('.mal-cta a[href="/partner/apply"]').count() == 1
        and gp.locator('.mal-cta a[href="/partner/listings"]').count() == 1)
    sp.goto(SITE + '/partner', wait_until='networkidle')
    rec('UI-6-3 파트너센터 메뉴에 「내 매물 · 입점 상태」 → /partner/listings', sp.locator('a[href="/partner/listings"]').count() >= 1, sp.url)
    for w in (390,):
        m = b.new_context(viewport={'width': w, 'height': 800}); mp = m.new_page()
        ov = []
        for u in ('/mal/consult', '/mal/consult/CSL_CLEANING', '/mal/consult/CSL_LEGAL', '/consult'):
            mp.goto(SITE + u, wait_until='networkidle')
            ov.append((u, mp.evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth')))
        rec(f'UI-6-4 {w}px 폭에서 새 화면 4개 가로 넘침 없음', all(x[1] <= 1 for x in ov), ov)
        m.close()
    rec('UI-9 화면 스크립트 오류 0', not errs, errs[:3])
    c1.close(); c2.close(); c3.close(); b.close()

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_consult_ui.json')
json.dump(R, open(out, 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
