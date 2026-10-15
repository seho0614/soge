"""v10.27 화면 확인 — 가입 약관 동의(G-188) · 받은 문의함 · 거래 다음 단계 · 내리기(G-193) · 나의공간 첫 화면(G-195).

실제 사용자 웹(5174)을 브라우저로 누릅니다. 시험 매물은 끝에 ARCHIVED 로 둡니다. 계정(fx7u_*@t.local)은 남습니다.
사용:  python3 fix_1027b_ui.py        결과 fix_1027b_ui.json
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import *
from playwright.sync_api import sync_playwright

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

def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), step, '|', str(detail)[:200], file=sys.stderr, flush=True)
def safe(name, fn):
    try: fn()
    except Exception as ex: rec(f'{name} 실행 중 오류', False, repr(ex)[:300])

ADM = login('admin@x.com'); tag = uuid.uuid4().hex[:6]
PW = 'Sgb-fx7u-1234!'

def ui_signup(b):
    c = b.new_context(); pg = c.new_page(); errs, apis = watch(pg)
    goto(pg, '/signup')
    n_terms = int(q("select count(*) from terms where status='PUBLISHED' and not is_notice and audience='ALL'"))   # v10.31 (D090) 가입 화면 = 전체 대상 약관만(파트너 이용약관 제외)      # v10.28 (G-218) — 알림(위탁)은 동의 칸이 없음
    em = f'fx7u_{tag}@t.local'
    wizard_to_terms(pg, '화면 동의', em, PW)          # v10.31 (w1) — 시안 5단계: 약관은 4단계
    boxes = pg.locator('[data-consent-term]').count()
    rec('G-188-U1 가입 화면에 약관 동의 칸 — 전체 동의 + 발행 약관마다 한 칸', pg.locator('[data-consent-all]').count() == 1 and boxes == n_terms, (boxes, n_terms))
    pg.locator('.w1-jnav .w1-jb.p').click(); pg.wait_for_timeout(300)
    rec('G-188-U2 필수 약관에 동의하기 전에는 다음 단계로 못 감(「필수 항목에 모두 동의해야」)',
        pg.locator('[data-consent]').count() == 1 and '필수 항목에 모두 동의' in (pg.locator('.w1-err').inner_text() if pg.locator('.w1-err').count() else ''), '')
    pg.locator('[data-consent-all]').check()
    on = pg.locator('[data-consent-term]:checked').count()
    rec('G-188-U3 「전체 동의」를 누르면 모든 칸이 켜짐', on == n_terms, on)
    # 선택 하나를 끄고 가입 — 그 항목은 「거부」로 남아야 함
    opt = q("select code from terms where status='PUBLISHED' and not is_required and not is_notice and audience='ALL' order by code limit 1")
    if opt: pg.locator(f'[data-consent-term="{opt}"]').uncheck()
    try: wizard_finish(pg)
    except Exception: pass
    aid = q(f"select id from accounts where email='{em}'")
    got = dict(rows(f"select term_code, agreed::text from term_agreements where account_id='{aid}'")) if aid else {}
    rec('G-188-U4 가입 → 동의 기록이 약관마다 남음(끈 선택 항목은 거부) · 가입 완료 화면(본인인증 하기 단추)',
        aid and len(got) == n_terms and (not opt or got.get(opt) == 'false') and '/signup/done' in pg.url and pg.locator('a[href="/verify"]').count() >= 1, (pg.url, got))
    rec('G-188-U5 가입 화면 · 쪽 오류 없음', not errs, errs[:3])
    c.close()
    return em

def ui_inquiry(b, buyer_em):
    SEL = login('intro@x.com'); BUY = login(buyer_em, PW)
    call('POST', '/verifications/identity', BUY, {'provider': 'PASS'})
    cat = q("select id from categories where gwan_code='MNY' and status='APPROVED' and restricted_code is null limit 1")
    st, j = call('POST', '/listings', SEL, {'gwanCode': 'MNY', 'categoryId': cat, 'title': f'화면 문의 확인 {tag}',
                 'body': '화면 확인 시험용 매물입니다. 사무실 인테리어 업체를 소개받습니다.', 'desiredFee': 300000, 'feeBearer': 'SELLER'})
    lid = (j or {}).get('listingId')
    if (j or {}).get('reviewId') and j.get('status') != 'PUBLISHED':
        call('PATCH', f"/admin/reviews/{j['reviewId']}", ADM, {'decision': 'APPROVED'})
    st, cv = call('POST', '/conversations', BUY, {'targetType': 'LISTING', 'targetId': lid, 'message': f'화면 문의 {tag}'})
    cid = (cv or {}).get('conversationId')

    # 판매자 — 받은 문의함
    c = b.new_context(); pg = site_login(c, 'intro@x.com'); errs, apis = watch(pg)
    goto(pg, '/my/inquiries')
    row = pg.locator(f'[data-inq-row="{cid}"]')
    rec('G-193-U1 판매자 「받은 문의」 목록에 새 문의 · 안 읽음 표시', row.count() == 1 and row.locator('.unread-dot, .my-bg.no').count() >= 1 and tag in text(pg), row.count())
    rec('G-193-U2 문의한 분 이름은 첫 글자만(○○) — 이메일이 화면에 없음', '○○' in row.inner_text() and buyer_em not in text(pg), '')
    row.locator('a', has_text='대화 열기').click(); pg.wait_for_timeout(2500)
    try: pg.wait_for_url(f'**/my/inquiries/{cid}**', timeout=30000); pg.wait_for_selector('[data-msg]', timeout=15000)
    except Exception: pass
    rec('G-193-U3 대화 열기 → 대화방에 구매자 글이 보임', f'/my/inquiries/{cid}' in pg.url and pg.locator('[data-msg="other"]').count() >= 1, pg.url)
    pg.fill('.chat-input textarea', f'답변 드립니다 {tag}'); pg.click('.chat-input button'); pg.wait_for_timeout(2500)
    rec('G-193-U4 판매자가 답하면 내 글(오른쪽)로 보이고 DB 에 저장', pg.locator('[data-msg="mine"]').count() >= 1
        and q(f"select count(*) from messages where conversation_id='{cid}' and body like '답변 드립니다 {tag}%'") == '1', '')
    goto(pg, '/my/inquiries')
    rec('G-193-U5 대화를 연 뒤 받은 문의의 안 읽음 표시가 사라짐', pg.locator(f'[data-inq-row="{cid}"] .unread-dot').count() == 0, '')
    goto(pg, f'/my/inquiries?listing={lid}')
    rec('G-193-U6 내 리스팅의 「받은 문의」 링크(?listing=) → 그 매물 문의만', pg.locator('[data-inq-filter]').count() == 1 and pg.locator('[data-inq-row]').count() == 1, pg.locator('[data-inq-row]').count())
    st = goto(pg, '/my/inquiries/00000000-0000-0000-0000-000000000000')
    rec('G-193-U7 없는 대화 · 남의 대화 주소는 404', st == 404, st)

    # 판매자 — 계약서 요청하기 → 거래 → 계약서 화면
    goto(pg, f'/my/inquiries/{cid}')
    pg.click('[data-request-contract]'); pg.wait_for_timeout(3500)
    did = q(f"select id from deals where conversation_id='{cid}'")
    rec('G-193-U8 대화방 「계약서 요청하기」 → 거래 1건 생성 → 계약서 화면', did and f'/deal/{did}/contract' in pg.url, pg.url)
    goto(pg, f'/my/inquiries/{cid}'); pg.click('[data-request-contract]'); pg.wait_for_timeout(3000)
    rec('G-193-U9 한 번 더 눌러도 거래는 1건(같은 거래로 감)', q(f"select count(*) from deals where conversation_id='{cid}'") == '1' and f'/deal/{did}/contract' in pg.url, pg.url)

    # 판매자 — 내 리스팅에서 내리기
    goto(pg, '/my/listings')
    pg.click(f'[data-archive="{lid}"]'); pg.wait_for_timeout(400)
    ask = pg.locator(f'[data-archive-ask="{lid}"]').count() == 1
    pg.click(f'[data-archive-ask="{lid}"] [data-archive-yes]'); pg.wait_for_timeout(3000)
    rec('G-193-U10 내 리스팅 「내리기」 → 확인 → ARCHIVED · 「수정해서 다시 올리기」 링크', ask and q(f"select status from listings where id='{lid}'") == 'ARCHIVED'
        and pg.locator(f'[data-relist="{lid}"]').count() == 1, q(f"select status from listings where id='{lid}'"))
    pg.click(f'[data-relist="{lid}"]'); pg.wait_for_timeout(2500)
    try: pg.wait_for_url(f'**/listings/{lid}/edit**', timeout=30000); pg.wait_for_selector('input[name=title]', timeout=15000)
    except Exception: pass
    rec('G-193-U11 「수정해서 다시 올리기」 → 매물 수정 화면이 열림(빈 등록 폼 아님)', f'/listings/{lid}/edit' in pg.url and pg.locator('input[name=title]').input_value().startswith('화면 문의 확인'), pg.url)
    rec('G-193-U12 판매자 화면들 · 쪽 오류 없음', not errs, errs[:3])
    c.close()

    # 구매자 — 다시 열면 지난 대화가 보임 · 보낸 문의 · 내 거래 다음 단계
    c = b.new_context(); pg = site_login(c, buyer_em, PW); errs, apis = watch(pg)
    goto(pg, '/my/inquiries?tab=sent')
    rec('G-193-U13 구매자 「보낸 문의」에 대화가 있고 판매자 답이 안 읽음으로 보임', pg.locator(f'[data-inq-row="{cid}"] .unread-dot, [data-inq-row="{cid}"] .my-bg.no').count() == 1, '')
    goto(pg, '/my/deals')
    nxt = pg.locator(f'[data-deal-act="{did}"] [data-deal-next]')
    rec('G-193-U14 내 거래(소개 내역)에 지금 할 다음 단계 단추(계약서 작성 ›)', nxt.count() == 1 and 'contract' in (nxt.get_attribute('href') or ''), nxt.count() and nxt.get_attribute('href'))
    rec('G-193-U15 구매자 화면들 · 쪽 오류 없음', not errs, errs[:3])
    c.close()
    return lid

def ui_home(b):
    c = b.new_context(); pg = site_login(c, 'intro@x.com'); errs, apis = watch(pg)
    goto(pg, '/my')
    tiles = pg.locator('[data-my-tiles] .tile, [data-my-tiles] .my-tile').count()   # v10.31 (w3 시안) 클래스 이름 my-tile · my-mcard
    rec('G-195-U1 나의공간 첫 화면 — 프로필 한 줄 · 요약 4칸 · 바로가기', pg.locator('[data-my-prof]').count() == 1 and tiles == 4 and pg.locator('[data-my-menu] .mcard, [data-my-menu] .my-mcard').count() >= 9, tiles)
    tok = login('intro@x.com'); h = call('GET', '/me/home', tok)[1]
    tl = pg.locator('[data-my-tiles]').inner_text()
    rec('G-195-U2 요약 숫자가 서버 값과 같음(진행 중 · 성사)', f"{h['openDeals']:,}" in tl and f"{h['closedDeals']:,}" in tl, tl.replace('\n', ' ')[:120])
    bad = []
    for href in pg.locator('[data-my-menu] .mcard').evaluate_all('els => els.map(e => e.getAttribute("href"))'):
        s2 = goto(c.new_page(), href)
        if s2 != 200: bad.append((href, s2))
    rec('G-195-U3 바로가기 단추가 모두 열림(200)', not bad, bad)
    rec('G-195-U4 쪽 오류 없음', not errs, errs[:3])
    c.close()

def ui_g201(b):
    import re as _re
    # 본인인증 「돌아가기」 · 이어서 하기
    em, pw, tok, aid = signup('fx7u', '작은결함')
    c = b.new_context(); pg = site_login(c, em, pw); errs, apis = watch(pg)
    goto(pg, '/verify?next=/health/order')
    rec('G-201-e1 본인인증 「돌아가기」가 온 곳(?next=)으로 감', pg.locator('[data-verify-back]').get_attribute('href') == '/health/order', pg.locator('[data-verify-back]').get_attribute('href'))
    goto(pg, '/verify?next=//evil.example/x')
    rec('G-201-e2 밖 주소(//…)는 받지 않음 — 첫 화면으로', pg.locator('[data-verify-back]').get_attribute('href') == '/', pg.locator('[data-verify-back]').get_attribute('href'))
    # 사업자 신청 뒤 다시 오면 심사 중
    call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
    brn = str(uuid.uuid4().int)[:10]
    st, j = call('POST', '/businesses', tok, {'bizRegNo': brn, 'companyName': f'작은결함{tag}', 'ceoName': '김확인', 'sido': '서울', 'sigungu': '금천구'})
    verified = q(f"select verified_at is not null from businesses where account_id='{aid}'") == 't'
    pg2 = pg; goto(pg2, '/my/business')
    if verified:
        rec('G-201-b 사업자 신청 뒤 /my/business — 심사 중 표시', True, '개발 환경에서 신청 즉시 인증됨', skip=True)
    else:
        rec('G-201-b 사업자 신청 뒤 /my/business 에 「심사 중」 카드(빈 신청서 아님)', pg2.locator('[data-biz-pending]').count() == 1 and pg2.locator('input[name=bizRegNo]').count() == 0, (st, pg2.locator('h1').inner_text()))
    rec('G-201-e3 화면 오류 없음', not errs, errs[:3])
    c.close()
    # 결제 화면 → 내 주문 링크
    no = q("select o.order_no from hlt_orders o join accounts a on a.id=o.account_id where a.email='buyer@x.com' and o.status='PENDING' and not exists(select 1 from hlt_returns r where r.order_id=o.id and r.kind='CANCEL' and r.state='REQUESTED') order by o.created_at desc limit 1")   # v10.27(2) — 취소 신청 중인 주문은 결제 화면 대신 「취소 신청 접수」 안내(G-183)가 맞음
    made = None
    if not no:   # v10.27(2) — 결제 대기 주문이 없는 DB(Docker 등): buyer 로 1건을 만들어 확인하고 끝에 취소 신청
        BT = login('buyer@x.com'); bid = q("select id from accounts where email='buyer@x.com'")
        addr = q(f"select id from hlt_addresses where account_id='{bid}' order by is_default desc limit 1")
        if not addr:
            _s, _a = call('POST', '/me/health/addresses', BT, {'receiver': '확인', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
            addr = (_a or {}).get('id') or q(f"select id from hlt_addresses where account_id='{bid}' limit 1")
        pr = rows("select p.code, o.id from hlt_products p join hlt_product_options o on o.product_id=p.id and o.is_active where p.status='ON_SALE' and o.stock >= 3 and p.code !~ '^OPTTEST' order by p.price limit 1")
        if pr and addr:
            _s, _o = call('POST', '/health/orders', BT, {'addressId': addr, 'items': [{'productCode': pr[0][0], 'optionId': pr[0][1], 'qty': 1}]})
            no = made = (_o or {}).get('orderNo')
    c = b.new_context(); pg = site_login(c, 'buyer@x.com')
    if no:
        goto(pg, f'/health/order/pay?no={no}')
        rec('G-201-f 결제 화면에 「주문 상세 · 내 주문」 링크', pg.locator('[data-pay-myorders] a[href="/my/health/orders"]').count() == 1, no)
        if made: call('POST', '/me/health/returns', login('buyer@x.com'), {'orderNo': made, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    else:
        rec('G-201-f 결제 화면에 내 주문 링크', True, '결제 대기 주문 없음', skip=True)
    # 등록 첫 화면 — 업종이 있는 갈래부터
    c2 = b.new_context(); pg2 = site_login(c2, 'intro@x.com')      # v10.31 (w1) — 판매 등록 폼은 사업자만(개인은 잠금 안내 data-reg-locked)
    goto(pg2, '/register')      # 관은 시안처럼 고르기 칸(#f-gwan) · 업종이 없는 관은 목록에 없음
    names = [x.strip() for x in pg2.locator('#f-gwan option').all_inner_texts() if x.strip() and '선택' not in x]
    c2.close()
    goto(pg, '/register')
    # v10.36 (D094 · 10/12 대표 지시) — 소개장터는 개인 회원도 등록합니다: 잠금 안내 대신 소개장터만 고르는 등록 폼(안심소개 · 소개창업은 사업자 인증 후)
    _unused = [x.strip() for x in pg.locator('#f-gwan option').all_inner_texts() if x.strip() and '선택' not in x]
    rec('G-201-j2 개인 회원(buyer)도 모든 관 등록 폼(v10.37 P2P — 전: v10.36 소개장터만 · 그 전 잠금)',
        pg.locator('[data-reg-locked]').count() == 0 and sorted(_unused) == sorted(['소개장터', '안심소개', '소개창업']), _unused)
    rec('G-201-j 등록 화면의 관 목록에 업종 없는 갈래(「소개하고 벌기」) 없음', names and '소개하고 벌기' not in names, names)
    goto(pg, '/biz/register')
    rec('G-201-k /biz/register 첫 줄에 「매물 등록 · 사업자 인증은 나의공간」 안내', pg.locator('[data-biz-reg-note]').count() == 1 and ('매물 등록' in pg.locator('h1').inner_text() or ('등록' in pg.locator('h1').inner_text() and '매물' in pg.locator('[data-biz-reg-note]').inner_text() and '나의공간' in pg.locator('[data-biz-reg-note]').inner_text())), pg.locator('h1').inner_text())
    c.close()
    # 영문 AM/PM — 서버가 그린 화면에 섞이지 않음
    c = b.new_context(); pg = site_login(c, 'intro@x.com'); bad = []
    for path in ['/partner/leads', '/my/listings', '/my/contracts', '/consult', '/my/inquiries', '/partner']:
        goto(pg, path)
        if _re.search(r'\b(AM|PM)\b', text(pg)): bad.append(path)
    rec('G-201-g 화면에 영문 AM · PM 이 섞이지 않음(날짜는 2026-10-08 20:05 꼴)', not bad, bad)
    c.close()
    # 운영 화면 검수 큐 거르개 — 관 이름
    c = b.new_context(); pg = bo_login(c)
    ok = bo_tab(pg, '검수 큐'); pg.wait_for_timeout(1500)
    txt = ' '.join(pg.locator('[data-rq-gwan]').all_inner_texts())
    rec('G-201-c 운영 검수 큐 거르개가 관 이름(소개장터 …)으로 보임', '소개장터' in txt and 'MNY' not in txt, txt)
    c.close()

def ui_g189(b):
    em = f'fx7p_{uuid.uuid4().hex[:6]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': em, 'password': PW, 'name': '구독 화면'})
    aid = q(f"select id from accounts where email='{em}'")
    sql(f"insert into account_roles(account_id, role) values ('{aid}','BIZ_OWNER') on conflict do nothing")
    c = b.new_context(); pg = site_login(c, em, PW); errs, apis = watch(pg)
    goto(pg, '/my/subscription')
    rec('G-189-U1 구독 화면에 요금제마다 고르기 단추(전에는 결제 단추가 없었음)', pg.locator('[data-plan-pick]').count() >= 2, pg.locator('[data-plan-pick]').count())
    pg.click('[data-plan-pick="STANDARD"]'); pg.wait_for_timeout(300)
    panel = pg.locator('[data-plan-panel="NEW"]')
    payb = pg.locator('[data-plan-pay]')
    rec('G-189-U2 처음 구독 — 결제 패널(전액 49,000원) · 환불 조건 확인 전에는 결제 단추가 눌리지 않음', panel.count() == 1 and '49,000원' in panel.inner_text() and payb.is_disabled(), panel.inner_text()[:120] if panel.count() else '-')
    pg.check('[data-plan-agree]'); payb.click(); pg.wait_for_timeout(3000)
    r = rows(f"select plan_code, coalesce(next_plan_code,'-') from subscriptions where account_id='{aid}' and status='ACTIVE'")
    rec('G-189-U3 결제(시험 결제) → 오늘부터 스탠다드 · 「지금 요금제」 표시', r == [['STANDARD', '-']] and pg.locator('[data-plan-current="STANDARD"]').count() == 1, (r, text(pg, '[data-plan-msg]')))
    tok = login(em, PW); call('POST', '/me/billing-key', tok, {'authKey': 'stub_auth_' + uuid.uuid4().hex[:10]})
    goto(pg, '/my/subscription')
    pg.click('[data-plan-pick="PRO"]'); pg.wait_for_timeout(300)
    up = pg.locator('[data-plan-panel="UP"]')
    rec('G-189-U4 올리기 — 「지금 결제 없음」 · 다음 결제일부터 · 예약 단추', up.count() == 1 and '지금 결제 없음' in up.inner_text() and pg.locator('[data-plan-reserve]').count() == 1, up.inner_text()[:160] if up.count() else '-')
    n0 = q(f"select count(*) from subscription_invoices i join subscriptions s on s.id=i.subscription_id where s.account_id='{aid}'")
    pg.click('[data-plan-reserve]'); pg.wait_for_timeout(2500)
    r = rows(f"select plan_code, coalesce(next_plan_code,'-') from subscriptions where account_id='{aid}' and status='ACTIVE'")
    n1 = q(f"select count(*) from subscription_invoices i join subscriptions s on s.id=i.subscription_id where s.account_id='{aid}'")
    rec('G-189-U5 예약 → DB 에 다음 요금제 프로 · 지금은 스탠다드 · 청구서 늘지 않음 · 화면에 「예약됨」 · 내 구독에 예약 줄', r == [['STANDARD', 'PRO']] and n0 == n1
        and pg.locator('[data-plan-reserved="PRO"]').count() == 1 and pg.locator('[data-sub-reserved="PRO"]').count() == 1, (r, n0, n1))
    pg.click('[data-act="unreserve"]'); pg.wait_for_timeout(2500)
    r = rows(f"select plan_code, coalesce(next_plan_code,'-') from subscriptions where account_id='{aid}' and status='ACTIVE'")
    rec('G-189-U6 「예약 거두기」 → 예약 지움', r == [['STANDARD', '-']] and pg.locator('[data-sub-reserved]').count() == 0, r)
    goto(pg, '/my/subscription/upgrade')
    rec('G-189-U7 「구독 안내」(한도 초과에서 오는 곳)에 「요금제 고르기 ›」', pg.locator('[data-upgrade-go]').count() == 1, '')
    rec('G-189-U8 쪽 오류 없음', not errs, errs[:3])
    c.close()
    # 사업자가 아니면 고르기 단추 대신 안내
    em2, pw2, tok2, aid2 = signup('fx7p', '개인')
    c = b.new_context(); pg = site_login(c, em2, pw2); goto(pg, '/my/subscription')
    # v10.37 (D095 · P2P) — 개인 회원도 구독합니다: 고르기 단추가 보이고 「사업자 회원만」 안내는 없음
    rec('G-189-U9 개인 회원 — 고르기 단추가 보이고 「사업자 회원만」 안내 없음(v10.37 P2P)', pg.locator('[data-plan-pick]').count() >= 1 and pg.locator('[data-plan-needbiz]').count() == 0, '')
    c.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    em = None
    def s1():
        global em; em = ui_signup(b)
    safe('G-188 화면', s1)
    if em: safe('G-193 화면', lambda: ui_inquiry(b, em))
    safe('G-195 화면', lambda: ui_home(b))
    safe('G-201 화면', lambda: ui_g201(b))
    safe('G-189 화면', lambda: ui_g189(b))
    b.close()

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fix_1027b_ui.json'), 'w'), ensure_ascii=False, indent=1)
bad = [r for r in R if not r['ok']]
print(f"\n{len(R) - len(bad)}/{len(R)} 통과", file=sys.stderr)
sys.exit(1 if bad else 0)
