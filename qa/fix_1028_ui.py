"""v10.28 — 실제 웹 · 운영 화면 확인(실제 로그인 · 클릭). fix_1028.py(서버)와 짝.

  A  운영 「소개몰 주문」 발송 처리 · 배송 완료 → 구매자 「구매확정」 · 리뷰쓰기 단추
사용:  python3 fix_1028_ui.py [A …]     결과 fix_1028_ui.json
"""
import sys, os, json, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import *
from playwright.sync_api import sync_playwright
import fix_1028 as F      # 도우미만 씀(시험 본문은 __main__ 일 때만 돎)

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = set(sys.argv[1:]) or set('ABCDEFGH')      # 인자가 없으면 전부(A ~ H)
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

# v10.31 (W5 · D070) — 리드 이용료가 선불 충전으로 바뀌어 잔액 0인 업체에는 상담이 배정되지 않습니다.
#   시험 전에 활동 중 업체(잔액 5만 원 미만)에 시험 결제(스텁) 30만 원을 넣습니다(kit scripts/seed-lead-cash-dev.sql 과 같은 일).
import subprocess as _sp, os as _os
_sp.run(['psql', DB, '-qc', "DO $w5$ DECLARE r record; v_id uuid; BEGIN FOR r IN SELECT p.id, p.grade FROM partners p LEFT JOIN lead_cash_wallets w ON w.partner_id = p.id WHERE p.status = 'ACTIVE' AND coalesce(w.paid_balance,0) + coalesce(w.bonus_balance,0) < 50000 LOOP INSERT INTO lead_cash_charges(partner_id, order_id, amount, bonus_rate, bonus_amount) VALUES (r.id, 'lc-seed' || replace(gen_random_uuid()::text,'-',''), 300000, 0, 0) RETURNING id INTO v_id; PERFORM fn_lead_cash_charge_done(v_id, 'stub_seed_' || v_id::text, 'STUB', true, NULL); END LOOP; END $w5$"], capture_output=True)

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '|', str(detail)[:220], file=sys.stderr, flush=True)
def wait_url(pg, pat, t=30000):
    try: pg.wait_for_url(pat, timeout=t)
    except Exception: pass


def part_a(b):
    em, pw, T, aid, addr = F.member('fx8u', '화면 확인')
    no = F.paid_order(T, addr)
    c = b.new_context(viewport={'width': 1400, 'height': 1000}); bo = bo_login(c)
    ok = bo_tab(bo, '소개몰 주문'); bo.wait_for_timeout(900)
    row = bo.locator(f'[data-hor-row="{no}"]')
    rec('A-U1 운영 화면 탭 「소개몰 주문」 · 「발송할 것」에 결제 완료 주문', ok and row.count() == 1, (ok, row.count()))
    row.locator('[data-hor-carrier]').select_option('우체국택배'); row.locator('[data-hor-track]').fill('6091234567890')
    row.locator('[data-hor-ship]').click(); bo.wait_for_timeout(1500)
    rec('A-U2 택배사 · 송장을 넣고 「발송 처리」 → 주문 「배송중」 · 목록에서 빠짐', F.status(no) == 'SHIPPED' and bo.locator(f'[data-hor-row="{no}"]').count() == 0,
        (F.status(no), q(f"select carrier||' '||tracking_no from hlt_shipments s join hlt_orders o on o.id=s.order_id where o.order_no='{no}' order by s.happened_at desc limit 1")))
    bo.locator('[data-hor-f="SHIPPED"]').click(); bo.wait_for_timeout(900)
    r2 = bo.locator(f'[data-hor-row="{no}"]'); r2.locator('[data-hor-deliver]').click(); bo.wait_for_timeout(1500)
    rec('A-U3 「배송중」에서 「배송 완료로」 → 주문 「배송 완료」', F.status(no) == 'DELIVERED', F.status(no))
    c.close()
    c2 = b.new_context(viewport={'width': 1400, 'height': 1000}); w = site_login(c2, em, pw)
    goto(w, f'/my/health/orders/{no}')
    t = text(w, '[data-confirm-row]') if w.locator('[data-confirm-row]').count() else ''
    rec('A-U4 내 주문 상세 — 「구매확정」 줄에 자동 확정 날짜 · 「구매확정」 단추', '자동 확정' in t and w.locator(f'[data-confirm="{no}"]').count() == 1, t)
    w.locator(f'[data-confirm="{no}"]').click(); w.locator('[data-confirm-yes]').click(); w.wait_for_timeout(2500)
    try: w.wait_for_selector('[data-review-go]', timeout=20000)
    except Exception: pass
    rec('A-U5 「구매확정」 → 확인 → 주문 「구매확정」 · 「리뷰쓰기」 단추가 생김', F.status(no) == 'CONFIRMED' and w.locator('[data-review-go]').count() >= 1, (F.status(no), w.locator('[data-review-go]').count()))
    goto(w, '/my/health/orders')
    rec('A-U6 내 주문 목록에 「구매확정」 표시', '구매확정' in (text(w, 'main') or ''), '')
    c2.close()


def part_b(b):
    em, pw, T, aid, addr = F.member('fx8v', '리뷰 화면')
    no = F.confirmed_order(T, addr)
    code = q(f"select p.code from hlt_order_items i join hlt_orders o on o.id=i.order_id join hlt_products p on p.id=i.product_id where o.order_no='{no}' limit 1")
    c = b.new_context(viewport={'width': 1400, 'height': 1000}); w = site_login(c, em, pw)
    goto(w, f'/my/health/orders/{no}#review')
    f = w.locator(f'[data-review-form="{code}"]')
    rec('B-U1 구매확정 주문 상세에 「리뷰」 칸 — 상품마다 쓰기 상자', w.locator('[data-review-sec]').count() == 1 and f.count() == 1, f.count())
    f.locator('[data-star="4"]').click(); body = f'화면에서 쓴 리뷰입니다 {F.tag} 잘 받았어요'
    f.locator('[data-review-body]').fill(body); f.locator('[data-review-send]').click(); w.wait_for_timeout(2500)
    try: w.wait_for_selector('[data-myreview]', timeout=15000)
    except Exception: pass
    rid = q(f"select r.id from hlt_reviews r join hlt_orders o on o.id=r.order_id where o.order_no='{no}'")
    rec('B-U2 별점 4 · 글 → 「리뷰 올리기」 → DB 에 VISIBLE · 화면에 「내 리뷰」', rid != '' and q(f"select state||rating from hlt_reviews where id='{rid}'") == 'VISIBLE4' and w.locator(f'[data-myreview="{rid}"]').count() == 1, (rid, q(f"select state||rating from hlt_reviews where id='{rid}'") if rid else ''))
    goto(w, f'/health/p/{code}?tab=reviews')
    row = w.locator(f'[data-review="{rid}"]')
    rec('B-U3 상품 상세 「리뷰」 탭 — 내 리뷰가 보이고 이름은 첫 글자 + ○○ · 별점 거르기', row.count() == 1 and '○○' in row.inner_text() and em not in text(w) and w.locator('[data-rvfilter="4"]').count() == 1, row.inner_text()[:80] if row.count() else '-')
    w.locator('[data-rvfilter="5"]').click(); w.wait_for_timeout(1500)
    rec('B-U4 별점 거르기 「5점」 → 4점 리뷰는 빠짐', w.locator(f'[data-review="{rid}"]').count() == 0, w.url)
    # 문의
    goto(w, f'/health/p/{code}?tab=qna')
    w.locator('[data-qna-body]').fill(f'화면 문의 {F.tag} 몇 알씩 먹나요'); w.locator('[data-qna-private]').check(); w.locator('[data-qna-send]').click(); w.wait_for_timeout(2500)
    qid = q(f"select id from hlt_qna where body like '%화면 문의 {F.tag}%'")
    rec('B-U5 「문의」 탭 — 비공개로 문의 → DB 에 is_private · 내 화면에 글이 보임', qid != '' and q(f"select is_private from hlt_qna where id='{qid}'") == 't' and w.locator(f'[data-qna-row="{qid}"]').count() == 1, qid)
    c.close()
    c3 = b.new_context(viewport={'width': 1400, 'height': 1000}); g = c3.new_page(); goto(g, f'/health/p/{code}?tab=qna')
    rr = g.locator(f'[data-qna-row="{qid}"]')
    rec('B-U6 로그인하지 않은 사람에게는 「비공개 문의입니다」 · 로그인 안내', rr.count() == 1 and '비공개 문의입니다' in rr.inner_text() and F.tag not in rr.inner_text() and g.locator('[data-qna-login]').count() == 1, rr.inner_text()[:60] if rr.count() else '-')
    c3.close()
    # 운영 — 문의 답 · 리뷰 확인 대기
    st, r2 = call('PATCH', f'/me/health/reviews/{rid}', T, {'body': f'먹고 나서 좋았습니다 {q("select word from banned_words where is_active and severity=$$BLOCK$$ and (gwan_code is null or gwan_code=$$HLT$$) and match_type=$$CONTAINS$$ order by length(word) limit 1")} 라고 들었어요'})
    c2 = b.new_context(viewport={'width': 1400, 'height': 1000}); bo = bo_login(c2)
    ok = bo_tab(bo, '소개몰 리뷰 · 문의'); bo.wait_for_timeout(900)
    row = bo.locator(f'[data-hrv-row="{rid}"]')
    rec('B-U7 운영 탭 「소개몰 리뷰 · 문의」 — 금칙어에 걸린 리뷰가 「확인 대기」에 걸린 말과 함께', ok and row.count() == 1 and '걸린 말' in row.inner_text(), (ok, row.count()))
    row.locator('[data-hrv-show]').click(); bo.wait_for_timeout(1500)
    rec('B-U8 「보이기」 → VISIBLE', q(f"select state from hlt_reviews where id='{rid}'") == 'VISIBLE', q(f"select state from hlt_reviews where id='{rid}'"))
    bo.locator('[data-hrv-sub="qna"]').click(); bo.wait_for_timeout(1000)
    qr = bo.locator(f'[data-hqn-row="{qid}"]')
    qr.locator('[data-hqn-ans]').fill('하루 두 알 드시면 됩니다.'); qr.locator('[data-hqn-send]').click(); bo.wait_for_timeout(1500)
    rec('B-U9 「상품 문의」 — 비공개 문의도 보이고 답하기 → DB 에 답 · 알림', q(f"select answer from hlt_qna where id='{qid}'") == '하루 두 알 드시면 됩니다.' and q(f"select count(*) from notifications where account_id='{aid}' and event_code='HLT_QNA_ANSWERED'") == '1', q(f"select answer from hlt_qna where id='{qid}'"))
    c2.close()
    # 정리 — 금칙어가 든 시험 리뷰 · 시험 문의는 남기지 않음(시연 화면에 보이지 않게)
    call('DELETE', f'/me/health/reviews/{rid}', T); call('POST', f'/admin/health/qna/{qid}/hide', F.ADM, {'reason': '시험 정리'})


def part_c(b):
    run_job = F.run_job; run_job('hlt_rank')
    c = b.new_context(viewport={'width': 1400, 'height': 1000}); w = c.new_page(); goto(w, '/health')
    sec = w.locator('[data-shop-rank="sales"], [data-shop-rank="1"]').first   # v10.31 (w3 시안) — 순위 상자 하나에 탭 3(실시간 인기 = 판매 수량 · 새 상품 · 많이 찾는 = 주문 건수)
    n = int(q("select count(*) from hlt_rankings where snapshot_date=(now() at time zone 'Asia/Seoul')::date and kind='SALES_7D'") or 0)
    if n:
        # v10.32 — 순위는 바로 위에서 다시 집계(run_job)했는데 사용자 웹은 순위를 잠깐 기억합니다(stale-while-revalidate).
        #   맨 앞이 DB 1위와 다르면 한 번 열어 새로 받게 하고 기억 시간을 넘겨 다시 봅니다(srv_mall · site_mny 와 같은 방식)
        def _first_pid():
            return (sec.locator('[data-rank="1"]').get_attribute('data-product') if sec.locator('[data-rank="1"]').count() else (sec.locator('[data-rank-pid]').first.get_attribute('data-rank-pid') if sec.locator('[data-rank-pid]').count() else None))
        _db1 = q("select p.code from hlt_rankings r join hlt_products p on p.id=r.product_id where r.snapshot_date=(now() at time zone 'Asia/Seoul')::date and r.kind='SALES_7D' order by rank limit 1")
        if sec.count() and _first_pid() != _db1:
            w.wait_for_timeout(65000); goto(w, '/health'); w.wait_for_timeout(1500); goto(w, '/health')
            sec = w.locator('[data-shop-rank="sales"], [data-shop-rank="1"]').first
        t = sec.inner_text() if sec.count() else ''
        first = q("select p.code from hlt_rankings r join hlt_products p on p.id=r.product_id where r.snapshot_date=(now() at time zone 'Asia/Seoul')::date and r.kind='SALES_7D' order by rank limit 1")
        per = q("select to_char((now() at time zone 'Asia/Seoul')::date - 7, 'FMMM.FMDD') || ' ~ ' || to_char((now() at time zone 'Asia/Seoul')::date - 1, 'FMMM.FMDD')")
        rec('C-U1 소개몰 메인 「오늘의 건강상품」 — 기준(최근 7일 판매 수량) · 기간(한국 날짜) · 집계 날짜 · 1위가 맨 앞', sec.count() == 1 and '판매 수량' in t and per in t and '집계' in t and (sec.locator('[data-rank="1"]').get_attribute('data-product') if sec.locator('[data-rank="1"]').count() else (sec.locator('[data-rank-pid]').first.get_attribute('data-rank-pid') if sec.locator('[data-rank-pid]').count() else None)) == first, (per, t[:140]))
    else:
        rec('C-U1 소개몰 메인 — 집계된 판매가 없으면 순위 칸을 그리지 않음(값을 지어 넣지 않음)', sec.count() == 0, sec.count())
    many = w.locator('[data-shop-rank="orders"], [data-shop-many="1"]').first
    rec('C-U2 「많이 찾는 상품」 칸 — 주문 건수 기준', (many.count() == 1 and '주문 건수' in many.inner_text()) if n else True, '')
    c.close()


def part_d(b):
    req = [x['code'] for x in (call('GET', '/terms/required', F.ADM)[1] or []) if x.get('isRequired')]
    em = f'fx8w_{uuid.uuid4().hex[:6]}@t.local'; pw = 'Sgb-flw-1234!'
    call('POST', '/auth/signup', body={'email': em, 'password': pw, 'name': '동의 화면', 'agreedTerms': req + ['MARKETING']})
    aid = q(f"select id from accounts where email='{em}'")
    c = b.new_context(viewport={'width': 1300, 'height': 1000}); w = site_login(c, em, pw); goto(w, '/terms/agree')
    row = w.locator('[data-opt-row="MARKETING"]')
    rec('D-U1 약관 동의 화면 「선택 항목 바꾸기」 — 마케팅 「동의」 · 바꾼 때', w.locator('[data-optional-consents]').count() == 1 and row.get_attribute('data-opt-state') == 'on', row.count())
    row.locator('[data-opt-flip="MARKETING"]').click(); w.wait_for_timeout(2500)
    try: w.wait_for_selector('[data-opt-row="MARKETING"][data-opt-state="off"]', timeout=15000)
    except Exception: pass
    rec('D-U2 「거부로 바꾸기」 → 화면 「거부」 · DB 에 새 줄(2줄 · 가장 최근 거부)', w.locator('[data-opt-row="MARKETING"]').get_attribute('data-opt-state') == 'off'
        and q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='MARKETING'") == '2'
        and q(f"select agreed::text from v_term_consent_current where account_id='{aid}' and term_code='MARKETING'") == 'false', '')
    c.close()


def part_e(b):
    c = b.new_context(viewport={'width': 1300, 'height': 1100}); g = c.new_page(); goto(g, '/mal/consult/CSL_CLEANING/apply')
    agree = g.locator('label.chk').inner_text() if g.locator('label.chk').count() else ''
    rec('E-U1 상담 신청서 — 이메일 칸 · 동의 문구에 「이름 · 휴대폰 번호 · 이메일 · 지역 · 상담 내용」(처리방침 제4조 ③과 같은 항목)', g.locator('input[name=email]').count() == 1 and '이름 · 휴대폰 번호 · 이메일 · 지역 · 상담 내용' in agree, agree[:80])
    g.fill('input[name=name]', '이메일 화면'); g.fill('input[name=phone]', f'010-{str(uuid.uuid4().int)[-4:]}-{str(uuid.uuid4().int)[-4:]}')
    g.select_option('select[name=sido]', index=1); g.check('input[name=agree]'); g.locator('form.mal-form [data-csl-otp], form.mal-form button[type=submit]').first.click(); g.wait_for_timeout(1200)
    rec('E-U2 이메일 없이 「인증번호 받고 신청」 → 화면이 막고 「이메일을 확인해 주십시오」', '이메일을 확인해' in (text(g, 'form.mal-form') or ''), '')
    c.close()
    # 파트너 — 연 뒤 「연락처 보기」에 이메일
    em = f'cslui_{F.tag}@example.com'
    st, j = call('POST', '/consult/requests', None, {'categoryCode': 'CSL_CLEANING', 'name': '이메일 화면', 'phone': f'010-{str(uuid.uuid4().int)[-4:]}-{str(uuid.uuid4().int)[-4:]}', 'email': em, 'sido': '서울', 'sigungu': '금천구', 'agree': True})
    st, v = call('POST', f"/consult/requests/{(j or {}).get('id')}/verify", None, {'code': (j or {}).get('devCode')})
    lid = (v or {}).get('leadId')
    did = q(f"select id from lead_deliveries where lead_id='{lid}' order by delivered_at limit 1") if lid else ''
    pacc = q(f"select a.email from lead_deliveries d join partners p on p.id=d.partner_id join businesses bz on bz.id=p.business_id join accounts a on a.id=bz.account_id where d.id='{did}'") if did else ''
    if not did:
        rec('E-U3 (준비) 업체에 전달된 상담', False, v); return
    call('POST', f'/partner/leads/{did}/view', login(pacc))
    c2 = b.new_context(viewport={'width': 1300, 'height': 1100}); w = site_login(c2, pacc); goto(w, '/partner/leads')
    row = w.locator(f'[data-lead-row="{did}"]')
    if row.count(): row.locator('button', has_text='연락처 보기').click(); w.wait_for_timeout(2000)
    rec('E-U3 파트너센터 — 연 상담의 「연락처 보기」에 이메일(mailto)', row.locator('[data-contact-email]').count() == 1 and em in row.inner_text(), (row.count(), pacc))
    c2.close()


def part_f(b):
    """개인 소개비 정산 — 정산 화면(SB-MYP-STL-010) · 받을 계좌 · 「소개비 받기」"""
    emK, pwK, TK, K = signup('fx8uk', '인증 전 화면')
    c = b.new_context(viewport={'width': 1300, 'height': 1100}); w = site_login(c, emK, pwK); goto(w, '/my/settlement')
    rec('F-U1 본인인증 전 — 「본인인증을 하시면 소개비를 받으실 수 있습니다」 · 본인인증하기 · 「사업자만」 없음',
        w.locator('[data-stl-need="IDENTITY"]').count() == 1 and w.locator('a[href="/verify"]').count() >= 1 and '사업자만' not in text(w, 'main'), text(w, 'main')[:160])
    c.close()
    LL = F.intro_listing(); (L, seller) = LL[0]; TS = login(seller)
    emI, pwI, TI, I = signup('fx8ui', '화면 소개자')
    call('POST', '/verifications/identity', TI, {'provider': 'PASS'})
    st, j = call('POST', '/referral-codes', TI, {'listingId': L, **F._paid_code()}); code = j[0]['code']   # v10.31 (D060) 무료 0건 → 결제(스텁) 뒤 발급
    c = b.new_context(viewport={'width': 1300, 'height': 1100}); w = site_login(c, emI, pwI); goto(w, '/my/settlement')
    t = text(w, 'main')
    rec('F-U2 (스위치 꺼짐) 본인인증 개인 — 「소개비 기능은 아직 열리지 않았습니다」 · 「개인으로 받습니다」 · 세금 한 줄 · 받을 계좌 칸',
        w.locator('[data-stl-off]').count() == 1 and w.locator('[data-stl-payee="PERSON"]').count() == 1 and '세금' in text(w, '[data-stl-tax]')
        and w.locator('[data-payout-form]').count() == 1, t[:200])
    before = q("select value from site_settings where key='feature.referral_fee'")
    try:
        F.feature('on')
        d1, _ = F.intro_deal(code, L, TS)
        goto(w, '/my/settlement')
        row = w.locator(f'[data-stl-due-row="{d1}"]')
        rec('F-U3 (스위치 켜짐) 「받을 소개비」에 성사 거래 · 300,000원 · 「소개비 받기」 · 「받을 계좌 확인이 먼저입니다」 · 꺼짐 안내 없음',
            row.count() == 1 and '300,000' in row.inner_text() and row.locator(f'[data-stl-claim="{d1}"]').count() == 1 and '계좌 확인이 먼저' in row.inner_text()
            and w.locator('[data-stl-off]').count() == 0, row.inner_text() if row.count() else '')
        row.locator(f'[data-stl-claim="{d1}"]').click(); w.wait_for_timeout(1800)
        rec('F-U4 계좌 확인 전 「소개비 받기」 → 「받을 계좌를 등록 · 확인해 주십시오」 · 정산 줄 없음',
            '계좌' in (text(w, '[data-stl-claim-err]') if w.locator('[data-stl-claim-err]').count() else '') and q(f"select count(*) from settlements where deal_id='{d1}'") == '0',
            text(w, '[data-stl-claim-err]') if w.locator('[data-stl-claim-err]').count() else '')
        w.locator('[data-payout-bank]').select_option('088'); w.locator('[data-payout-no]').fill('110-' + str(uuid.uuid4().int)[-3:] + '-' + str(uuid.uuid4().int)[-6:])
        w.locator('[data-payout-holder]').fill('화면 소개자'); w.locator('[data-payout-add]').click(); w.wait_for_timeout(2200)
        pr = w.locator('[data-payout-row]')
        rec('F-U5 받을 계좌 등록 → 「1원 보내기」 · 목록에 신한은행 뒤 4자리만 · 「확인 전」 · 코드 칸',
            pr.count() == 1 and pr.first.get_attribute('data-payout-state') == 'PENDING' and '신한은행 ****' in pr.first.inner_text() and w.locator('[data-payout-code]').count() == 1, pr.first.inner_text() if pr.count() else '')
        w.locator('[data-payout-code]').fill('SGB01'); w.locator('[data-payout-verify-send]').click(); w.wait_for_timeout(2200)
        pr = w.locator('[data-payout-row]')
        rec('F-U6 입금자명 코드 → 「확인 간주(연동 전)」(간주 모드 표시)', pr.count() == 1 and pr.first.get_attribute('data-payout-state') == 'ASSUMED' and '확인 간주' in pr.first.inner_text(), pr.first.inner_text() if pr.count() else '')
        w.locator(f'[data-stl-claim="{d1}"]').click(); w.wait_for_timeout(2500)
        try: w.wait_for_selector(f'[data-stl-row] [data-stl-row-payee="PERSON"]', timeout=15000)
        except Exception: pass
        rec('F-U7 「소개비 받기」 → 정산 내역에 「개인으로 받음」 · 받을 소개비에서 빠짐 · DB 개인 정산 줄',
            w.locator('[data-stl-row-payee="PERSON"]').count() >= 1 and w.locator(f'[data-stl-due-row="{d1}"]').count() == 0
            and q(f"select (payee_business_id is null and payee_account_id='{I}')::text from settlements where deal_id='{d1}'") == 'true', text(w, 'main')[:200])
    finally:
        F.feature(before or 'off')
    goto(w, '/my/business')
    t1 = text(w, 'main'); goto(w, '/verify'); t2 = text(w, 'main')
    # v10.31 (W3 P4 · P4-a · 10/10 사용자 답 「개인도 소개비 수령 가능 — 지금 방식 유지」) — 시안 글 「몇 가지는 사업자만 할 수 있습니다」 · 「소개비 수령(사업자 인증 후)」은 들어오되
    #   「사업자 인증 전 성사 건의 소개비는 … 개인으로 받습니다」 안내가 같이 있어야 함(개인 수령 유지). 「소개비는 사업자만」이라는 글은 없어야 함
    # v10.32 — 인증 화면이 시안 scVerify 글(「본인인증을 하면 소개비를 개인으로 받고 …」)로 바뀜 — 같은 뜻(개인 수령 = 본인인증)이라 둘 다 받음
    rec('F-U8 사업자 전환 · 인증 화면 — 「소개비는 사업자만」 문구 없음 · 개인 수령 안내 있음 · 「소개비를 받으려면 본인인증」', '소개비는 사업자만' not in t1 and ('개인으로 받습니다' in t1 or '사업자 인증 완료' in t1) and ('소개비를 받으려면 본인인증' in t2 or '본인인증을 하면 소개비를 개인으로' in t2) and '소개비는 사업자만' not in t2, (t1[:120], t2[:160]))
    c.close()


def part_g(b):
    """재동의 — 필수 약관의 새 판(D041)에 동의하지 않은 회원: 로그인 직후 · 로그인이 필요한 화면 → 동의 화면 · 바뀐 점 표 · 동의하면 가려던 곳"""
    em, pw, T, aid = signup('fx8ug', '재동의 화면')
    prev = q("select version from terms where code='SERVICE' and status='ARCHIVED' order by split_part(version,'.',2)::int desc limit 1")
    cur = q("select version from terms where code='SERVICE' and status='PUBLISHED'")
    if not prev:      # 새로 설치한 DB — 이용약관의 앞 판이 없어 「바뀐 약관」 재동의가 생길 수 없음(처음 동의는 아래 G-U8)
        rec('G-U1 ~ U7 (새로 설치) 이용약관 앞 판이 없어 「바뀐 약관」 재동의 대상 없음 — 처음 동의는 G-U8 이 봄', q("select count(*) from terms where code='SERVICE' and status='ARCHIVED'") == '0', cur)
    else:
     _g_reconsent(b, em, pw, T, aid, prev, cur)
    _g_first(b)

def _g_reconsent(b, em, pw, T, aid, prev, cur):
    call('POST', '/terms/agree', T, {'items': [{'code': 'MARKETING', 'agreed': True}]})
    F.old_consent(aid, 'SERVICE', prev)
    mk0 = q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='MARKETING'")
    c = b.new_context(viewport={'width': 1300, 'height': 1100}); w = site_login(c, em, pw, agree=False)
    wait_url(w, '**/terms/agree**', 15000)
    rec('G-U1 로그인 직후 → 동의 화면(/terms/agree?next=…) · 「약관이 바뀌었습니다」', '/terms/agree' in w.url and w.locator('[data-reconsent]').count() == 1 and '약관이 바뀌었습니다' in text(w, '[data-reconsent]'), w.url)
    row = w.locator('[data-reconsent-row="SERVICE"]')
    # v10.31 — 이용약관이 1.3(D090 · 판매 쪽 합의 · 무료 소개코드 0건 …)이 되어 바뀐 점 글이 그 판의 change_note — 전에는 1.2 의 「소개비 받기 …」를 그대로 기대
    note = q(f"select coalesce(change_note,'') from terms where code='SERVICE' and version='{cur}'")
    rec('G-U2 바뀐 점 표 — 이용약관 · 동의하신 판 → 지금 판 · 바뀐 점(= 지금 판의 change_note 첫 구절)', row.count() == 1 and prev in row.inner_text() and cur in row.inner_text() and bool(note) and note.split(' · ')[0][:20] in row.inner_text(), (row.inner_text() if row.count() else '', note[:60]))
    goto(w, '/my')
    rec('G-U3 동의 전 로그인이 필요한 화면(/my) → 동의 화면으로(next=/my)', '/terms/agree' in w.url and 'next=%2Fmy' in w.url, w.url)
    st1 = goto(w, '/'); u1 = w.url; st2 = goto(w, '/terms/SERVICE'); u2 = w.url
    rec('G-U4 둘러보기(/) · 약관 보기(/terms/SERVICE)는 그대로 열림', '/terms/agree' not in u1 and u2.endswith('/terms/SERVICE') and st1 == 200 and st2 == 200, (u1, u2, st1, st2))
    goto(w, '/my/settlement'); wait_url(w, '**/terms/agree**', 8000)
    w.locator('[data-agree-term="SERVICE"]').check(); w.locator('[data-agree-submit]').click()
    wait_url(w, '**/my/settlement', 20000); w.wait_for_timeout(800)
    rec('G-U5 필수 약관에 동의 → 가려던 곳(/my/settlement)으로 · 지금 판 동의 기록', w.url.endswith('/my/settlement') and q(f"select term_version from v_term_consent_current where account_id='{aid}' and term_code='SERVICE'") == cur, (w.url, q(f"select term_version||' '||agreed from v_term_consent_current where account_id='{aid}' and term_code='SERVICE'")))
    rec('G-U6 선택 약관(마케팅)은 그대로 — 재동의 때 기록이 더 생기지 않음 · 지금 상태 동의', q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='MARKETING'") == mk0 and q(f"select agreed::text from v_term_consent_current where account_id='{aid}' and term_code='MARKETING'") == 'true', mk0)
    goto(w, '/my')
    rec('G-U7 동의 뒤에는 /my 가 그대로 열림', w.url.rstrip('/').endswith('/my'), w.url)
    c.close()

def _g_first(b):
    em2, pw2, T2, aid2 = signup('fx8ug', '처음 동의', agree=False)
    c2 = b.new_context(viewport={'width': 1300, 'height': 1100}); w2 = site_login(c2, em2, pw2, agree=False)
    wait_url(w2, '**/terms/agree**', 15000)
    rec('G-U8 약관에 동의한 적 없는 회원(발행 전 가입) → 로그인 직후 동의 화면 · 「약관 동의가 필요합니다」 · 표에 「처음 동의」', '/terms/agree' in w2.url and '약관 동의가 필요합니다' in text(w2, '[data-reconsent]') and '처음 동의' in text(w2, '[data-reconsent-table]'), w2.url)
    c2.close()


def part_h(b):
    """위탁은 「알림」(G-218 · D042) — 가입 · 약관 동의 · 선택 항목 화면에 위탁 동의 칸이 없고 「알림」 링크 한 줄 · 약관 목록 · 전문에 「알림」"""
    c = b.new_context(viewport={'width': 1300, 'height': 1100}); w = c.new_page()
    goto(w, '/signup'); w.wait_for_timeout(600)
    wizard_to_terms(w, '위탁 확인', f'fx8uhw_{uuid.uuid4().hex[:6]}@t.local', 'Sgb-fx8h-1234!')      # v10.31 (w1) — 약관은 가입 4단계
    rec('H-U1 가입 — 동의 칸에 위탁 없음 · 다른 약관 칸은 있음(이용약관 · 마케팅)',
        w.locator('[data-consent-term="OUTSOURCE"]').count() == 0 and w.locator('[data-consent-term="SERVICE"]').count() == 1 and w.locator('[data-consent-term="MARKETING"]').count() == 1,
        w.locator('[data-consent-term]').evaluate_all("es=>es.map(e=>e.getAttribute('data-consent-term'))"))
    rec('H-U2 가입 — 「알림 · 개인정보 처리업무 위탁 안내 — 동의를 받는 항목이 아니라 …」 링크 한 줄(/terms/OUTSOURCE)',
        w.locator('[data-notice-terms] a[data-notice-term="OUTSOURCE"][href="/terms/OUTSOURCE"]').count() == 1 and '동의를 받는 항목이 아니라' in text(w, '[data-notice-terms]'), text(w, '[data-notice-terms]') if w.locator('[data-notice-terms]').count() else '')
    goto(w, '/terms'); w.wait_for_timeout(300)
    chip = w.locator('a[href="/terms/OUTSOURCE"][data-notice-chip]')      # v10.31 (w1) — 약관 화면은 시안 「약관 전문」 탭(칩)
    rec('H-U3 약관 목록(탭) — 위탁에 「(알림)」 · 다른 약관에는 없음', chip.count() == 1 and '(알림)' in chip.inner_text() and w.locator('[data-notice-chip]').count() == 1, chip.inner_text() if chip.count() else '')
    goto(w, '/terms/OUTSOURCE'); w.wait_for_timeout(300)
    rec('H-U4 위탁 전문 — 「알림(동의를 받지 않는 안내)」 · 본문 「동의를 받는 항목이 아니며」', w.locator('[data-term-notice]').count() == 1 and '동의를 받는 항목이 아니며' in text(w, '.doc-body'), text(w, '.doc-meta'))
    c.close()
    em, pw, T, aid = signup('fx8uh', '위탁 알림 화면')
    c = b.new_context(viewport={'width': 1300, 'height': 1100}); w = site_login(c, em, pw)
    goto(w, '/terms/agree'); w.wait_for_timeout(600)
    rec('H-U5 약관 동의 화면 — 위탁 동의 칸 없음 · 선택 항목 바꾸기에도 위탁 없음 · 마케팅은 있음',
        w.locator('[data-agree-term="OUTSOURCE"]').count() == 0 and w.locator('[data-opt-row="OUTSOURCE"]').count() == 0 and w.locator('[data-opt-row="MARKETING"]').count() == 1,
        (w.locator('[data-agree-term]').count(), w.locator('[data-opt-row]').evaluate_all("es=>es.map(e=>e.getAttribute('data-opt-row'))")))
    rec('H-U6 약관 동의 화면 — 「알림」 링크 한 줄', w.locator('[data-notice-terms] a[data-notice-term="OUTSOURCE"]').count() == 1, '')
    rec('H-U7 이 회원의 위탁 기록 0줄(가입 · 화면 어디서도 동의 · 거부를 남기지 않음)', q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='OUTSOURCE'") == '0', '')
    c.close()


with sync_playwright() as p:
    b = p.chromium.launch()
    for k, fn in (('A', part_a), ('B', part_b), ('C', part_c), ('D', part_d), ('E', part_e), ('F', part_f), ('G', part_g), ('H', part_h)):
        if k in PARTS:
            try: fn(b)
            except Exception as ex: rec(f'{k} 실행 중 오류', False, repr(ex)[:300])
    b.close()

json.dump(R, open(os.path.join(HERE, 'fix_1028_ui.json'), 'w'), ensure_ascii=False, indent=1)
bad = [r for r in R if not r['ok']]
print(f"\n{len(R) - len(bad)}/{len(R)} 통과", file=sys.stderr)
print(f"통과 {len(R) - len(bad)} / {len(R)}")
sys.exit(1 if bad else 0)
