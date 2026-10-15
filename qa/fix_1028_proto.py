"""v10.28 시안 확인 — 소개몰 리뷰 쓰기 · 별점 거르기 · 문의 비공개 · 구매확정 안내 · 순위 기준 · 운영 소개몰 주문 · 리뷰 · 문의 ·
정산(개인 회원) · 약관 재동의 · 상담 이메일 · 파트너 연락처 이메일.   결과: fix_1028_proto.json
사용: python3 fix_1028_proto.py      PROTO=/path/proto.html (기본: 킷의 spec/proto.html)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.environ.get('OUT', os.path.dirname(os.path.abspath(__file__)))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '|', str(detail)[:200], flush=True)
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove()); const sp=document.getElementById('spop'); if(sp) sp.classList.remove('on')"
SRC = open(FILE, encoding='utf-8').read()

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
    pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg.goto('file://' + FILE); pg.wait_for_timeout(1500); pg.evaluate(CLEAN)
    scr = lambda: pg.evaluate("window.__VIEW.state.screen")
    def paint(k): pg.evaluate("location.hash=''"); pg.evaluate("(k) => { window.__VIEW.paint(k); }", k); pg.wait_for_timeout(300); pg.evaluate(CLEAN)
    def hash_(h): pg.evaluate("(h) => { location.hash = h }", h); pg.wait_for_timeout(500); pg.evaluate(CLEAN)
    def body(): return norm(pg.inner_text('#app'))
    def click(sel): pg.locator(sel).first.click(); pg.wait_for_timeout(350); pg.evaluate(CLEAN)

    rec('H-0 판 이름 v10.28 이후', re.search(r'시안 v10\.(2[89]|[3-9]\d)', SRC[:400]) is not None, SRC[140:200])      # v10.30 — 그 뒤 판에서도 돌 수 있게
    rec('H-0b 불변식 설명 INV-10 — 개인 수령(INV-10R)', '본인인증 + 확인된 받을 계좌가 있는 개인' in SRC and '"정산 수령인은 인증된 사업자여야 한다", "ACTIVE"' not in SRC, '')

    # ── 로그인 안내 · 재동의 ──
    paint('login'); lg = body()
    rec('H-1 로그인 — 「본인인증을 하시면 소개비도 받으십니다」 · 「약관이 바뀐 뒤 로그인하면」 안내', '본인인증을 하시면 소개비도 받으십니다' in lg and '약관이 바뀐 뒤 로그인하면' in lg and '소개비 수령은 사업자 인증 후' not in lg, lg[:160])
    click('#app [data-reconsent-demo] [data-go="trmagr"]')
    t = body()
    rec('H-2 재동의 화면(SB-HOM-ETC-022) — 「약관이 바뀌었습니다」 · 바뀐 점 표 4줄 · 선택 항목 바꾸기', scr() == 'trmagr' and '약관이 바뀌었습니다' in t and pg.locator('#app [data-reconsent-table] tbody tr').count() == 4 and '선택 항목 바꾸기' in t, (scr(), t[:120]))
    mk0 = norm(pg.locator('#app [data-trm-opt="MARKETING"]').inner_text())
    click('#app [data-trm-opt="MARKETING"]'); mk1 = norm(pg.locator('#app [data-trm-opt="MARKETING"]').inner_text())
    rec('H-3 선택 항목 바꾸기 — 마케팅 「동의 철회」 → 「동의하기」', mk0 == '동의 철회' and mk1 == '동의하기', (mk0, mk1))
    click('#app [data-trm-agree]')
    rec('H-4 「동의하고 계속」 → 동의 저장 · 가려던 화면으로(시연 — 나의공간 단추)', '동의를 저장했습니다' in body() and pg.locator('#app [data-go="my"]').count() >= 1, body()[:120])

    # ── 정산 — 개인 회원 ──
    paint('mystl'); t = body()
    rec('H-5 정산 — 개인 회원: 「소개비 기능은 아직 열리지 않았습니다」 · 「개인으로 받습니다」 · 세금 한 줄 · 받을 계좌 칸 · 「사업자만」 없음',
        '소개비 기능은 아직 열리지 않았습니다' in t and '개인으로 받습니다' in t and '세금 신고는 받는 분이' in t and pg.locator('#app [data-payout-box]').count() == 1 and '회원은 전원 사업자' not in t, t[:200])
    click('#app [data-stl-claim]')
    rec('H-6 계좌 확인 전 「소개비 받기」 → 「받을 계좌를 등록 · 확인해 주십시오」(409 ACCOUNT_REQUIRED)', 'ACCOUNT_REQUIRED' in body() and '받을 계좌를 등록' in body(), '')
    click('#app [data-stl-acct="add"]')
    rec('H-7 계좌 등록 · 1원 보내기 → 뒤 4자리 · 「확인 전」 · 코드 안내(SGB01)', '****4821' in body() and '확인 전' in body() and 'SGB01' in body(), '')
    click('#app [data-stl-acct="verify"]')
    rec('H-8 입금자명 코드 확인 → 「확인 간주(연동 전)」', '확인 간주(연동 전)' in body(), '')
    click('#app [data-stl-claim]')
    rec('H-9 「소개비 받기」 → 정산 신청 · 개인으로 받음', '정산을 신청했습니다 — 개인으로 받음' in body(), '')
    click('#app [data-x="stlv"][data-xv="biz"]'); t = body()
    rec('H-10 사업자 회원 보기 → 「사업자로 받습니다」 · 입금 계좌 · 「정산 신청」', '사업자로 받습니다' in t and '입금 계좌' in t and pg.locator('#app [data-stl-view="biz"]').count() == 1, t[:120])

    # ── 운영 — 소개몰 주문 · 리뷰 · 문의 ──
    paint('adm'); t = body()
    rec('H-11 운영 대시보드 「다른 운영 화면」에 소개몰 주문 · 리뷰 · 문의 · 정산 · 상품', all(pg.locator(f'#app [data-adm-more] [data-go="{k}"]').count() == 1 for k in ('admhor', 'admhrv', 'admhst', 'admhpr')), '')
    paint('admhor'); t = body()
    rec('H-12 소개몰 주문(SB-ADM-HOR-010) — 발송할 것 2건 · 택배사 고르기 · 송장 칸', 'SB-ADM-HOR-010' in t and pg.locator('#app [data-hor-track]').count() == 2 and pg.locator('#app [data-hor-carrier] option').count() >= 5, t[:120])
    pg.locator('#app [data-hor-track="H26100900012"]').fill('12-34'); click('#app [data-hor="ship"][data-no="H26100900012"]')
    rec('H-13 형식이 틀린 송장 → 「숫자 10 ~ 14자리」 · 그대로', '숫자 10 ~ 14자리' in body() and pg.locator('#app [data-hor-track="H26100900012"]').count() == 1, '')
    pg.locator('#app [data-hor-carrier="H26100900012"]').select_option('우체국택배'); pg.locator('#app [data-hor-track="H26100900012"]').fill('6091234567890'); click('#app [data-hor="ship"][data-no="H26100900012"]')
    rec('H-14 발송 처리 → 「발송할 것」에서 빠지고 「배송중」으로', '발송 처리했습니다' in body() and pg.locator('#app [data-hor-track="H26100900012"]').count() == 0, '')
    click('#app [data-x="horf"][data-xv="SHIPPED"]'); click('#app [data-hor="deliver"][data-no="H26100900012"]')
    rec('H-15 「배송 완료로」 → 7일 뒤 자동 구매확정 안내 · 송장 고침은 배송중일 때만', '7일 뒤 자동 구매확정' in body() and '배송중일 때만' in body(), '')
    paint('admhrv'); t = body()
    rec('H-16 리뷰 · 문의(SB-ADM-HRV-010) — 확인 대기 리뷰 · 걸린 말 · 보이기 · 가리기(지우지 않음)', 'SB-ADM-HRV-010' in t and '걸린 말' in t and '보이기' in t and '가리기' in t and '지우지 않고 가립니다' in t, t[:120])
    click('#app [data-x="hrvsub"][data-xv="qna"]'); t = body()
    rec('H-17 상품 문의 — 답할 문의 · 비공개 표시 · 답하기', '비공개' in t and '답하기' in t and '본인인증 회원' in t, t[:120])

    # ── 상담 신청 이메일 ──
    hash_('#/mal/consult/CSL_CLEANING/apply'); t = norm(pg.inner_text('body'))
    rec('H-18 상담 신청서 — 이메일 칸 · 동의 문구 「이름 · 휴대폰 번호 · 이메일 · 지역 · 상담 내용」', pg.locator('#csl-mail').count() == 1 and '이름 · 휴대폰 번호 · 이메일 · 지역 · 상담 내용을 이 업종의 인증업체 1곳에' in t, t[:120])
    pg.fill('#csl-name', '홍길동'); pg.fill('#csl-tel', '010-1234-5678'); pg.locator('[data-csl-otp]').click(); pg.wait_for_timeout(400)
    pg.select_option('#csl-area', index=1); pg.check('#csl-agree'); pg.fill('#csl-mail', 'not-mail'); pg.locator('[data-csl-submit]').click(); pg.wait_for_timeout(500)
    rec('H-19 형식이 틀린 이메일 → 「이메일을 확인해 주십시오」 · 접수 안 됨', '이메일을 확인해 주십시오' in norm(pg.inner_text('body')) and '상담 신청을 받았습니다' not in norm(pg.inner_text('body')), '')
    pg.fill('#csl-mail', 'clean@example.com'); pg.check('#csl-agree'); pg.locator('[data-csl-submit]').click(); pg.wait_for_timeout(700)
    rec('H-20 이메일을 넣으면 접수', '상담 신청을 받았습니다' in norm(pg.inner_text('body')), '')
    hash_('#/mal/consult/CSL_CLEANING'); t = norm(pg.inner_text('body'))
    rec('H-21 업종 상세의 진행 순서 — 이메일도 적고, 연락처를 열 때 전달', '이름 · 휴대폰 · 이메일 · 지역을 적습니다' in t and '이름 · 휴대폰 · 이메일은 그 업체가 연락처를 열 때' in t, '')

    # ── 파트너센터 상담 신청 — 연 연락처에 이메일 ──
    paint('ptnlead')
    rec('H-22 파트너센터 상담 신청 — 확인 완료(연) 건에 이메일 · 열람 기록', pg.locator('#app [data-contact-email]').count() >= 1 and 'example.com' in body(), pg.locator('#app [data-contact-email]').count())

    # ── 소개몰 ──
    hash_('/health'); pg.wait_for_timeout(900); pg.evaluate(CLEAN)
    hm = norm(pg.inner_text('#hltapp'))
    rec('H-23 소개몰 메인 순위 기준 — 최근 7일 판매 수량 · 하루 1회 · 많이 찾는 = 주문 건수', '최근 7일 판매 수량 기준' in hm and '최근 7일 주문 건수 기준' in hm and '자사 2026-09 주문 건수 기준' not in hm, '')
    pg.evaluate("(h) => window.__hltMall.go(h)", '#/p/p01'); pg.wait_for_timeout(400)
    tab = pg.locator('#hltapp [data-tab="review"]')
    if tab.count(): tab.first.click(); pg.wait_for_timeout(400)
    t = norm(pg.inner_text('#hltapp'))
    rec('H-24 상품 리뷰 탭 — 사진 거르기 없음 · 별점 거르기(전체 · 5 ~ 1점)', '사진 있는 글만' not in t and '포토리뷰' not in t and pg.locator('#hltapp [data-rvfilter]').count() == 6, pg.locator('#hltapp [data-rvfilter]').count())
    pg.locator('#hltapp [data-rvfilter="5"]').click(); pg.wait_for_timeout(300)
    stars = pg.evaluate("[...document.querySelectorAll('#hltapp [data-rvlist] .hlt-rv-h b')].map(b => b.innerText)")
    rec('H-25 5점 거르기 → 5점 리뷰만', all(s_.strip() == '★ 5' for s_ in stars), stars[:5])
    qt = pg.locator('#hltapp [data-tab="qna"]')
    if qt.count(): qt.first.click(); pg.wait_for_timeout(400)
    t = norm(pg.inner_text('#hltapp'))
    rec('H-26 문의 탭 — 비공개는 고르기(기본 꺼짐) · 운영자가 답함 · 본인인증 회원', pg.locator('#qnaSecret').count() == 1 and not pg.locator('#qnaSecret').is_checked() and '운영자가 답하면' in t and '본인인증 회원' in t and '영양 전문 약사' not in t, t[-160:])
    # 구매확정 · 리뷰 쓰기
    no = pg.evaluate("(() => { const o = window.__hlt.S.orders.find(o => o.status === 'DELIVERED'); return o ? o.no : null })()")
    if no:
        pg.evaluate("(h) => window.__hltMall.go(h)", '#/my/orders/' + no); pg.wait_for_timeout(400)
        pg.locator(f'#hltapp [data-confirm="{no}"]').first.click(); pg.wait_for_timeout(300)
        md = norm(pg.inner_text('#hltmodal'))
        rec('H-27 구매확정 안내 — 「취소 · 반품이 제한」 없음 · 확정 뒤에도 3개월 안 반품 · 교환 · 7일 뒤 자동', '제한됩니다' not in md and '3개월' in md and '자동으로 확정' in md, md[:160])
        pg.locator('#hltmodal [data-mact="confirmYes"]').click(); pg.wait_for_timeout(400)
        rv = pg.locator(f'#hltapp [data-review="{no}"]')
        rec('H-28 확정 → 「리뷰쓰기」 · 「반품신청」(법정 기간 안)', rv.count() >= 1 and pg.locator('#hltapp a, #hltapp button', has_text='반품신청').count() >= 1, rv.count())
        rv.first.click(); pg.wait_for_timeout(300)
        rec('H-29 「리뷰쓰기」 → 리뷰 쓰기 창(별점 · 글 · 사진 없음) — 「P2 범위」 안내 없음', pg.locator('#hltmodal [data-rvmodal]').count() == 1 and '사진은 받지 않습니다' in norm(pg.inner_text('#hltmodal')), '')
        pg.locator('#hltmodal [data-mact="rvStar:4"]').click(); pg.wait_for_timeout(200)
        pg.fill('#rvText', '짧음'); pg.locator('#hltmodal [data-mact="rvSave"]').click(); pg.wait_for_timeout(300)
        short_blocked = pg.locator('#hltmodal [data-rvmodal]').count() == 1
        pg.fill('#rvText', '알이 작아서 삼키기 편합니다. 다음에도 살게요.'); pg.locator('#hltmodal [data-mact="rvSave"]').click(); pg.wait_for_timeout(400)
        rec('H-30 10자 미만은 막고 · 등록하면 「내 리뷰 고치기」 · 별점 4', short_blocked and pg.locator(f'#hltapp [data-review="{no}"]', has_text='내 리뷰 고치기').count() >= 1 and pg.evaluate(f"window.__hlt.S.myReviews['{no}'].star") == 4, short_blocked)
        pg.evaluate("(h) => window.__hltMall.go(h)", '#/my/returns/new?o=' + no); pg.wait_for_timeout(400)
        rt = norm(pg.inner_text('#hltapp'))
        rec('H-31 구매확정한 주문의 반품 신청 — 막지 않음(법정 기간 안)', '확정 후에는 취소·반품이 제한' not in rt and '구매확정한 주문입니다' in rt, rt[:160])
    else:
        rec('H-27 배송 완료 견본 주문', False, '없음')
    # ── 위탁은 「알림」(G-218 · D042) ──
    paint('trmagr'); t = body()
    rec('H-32 약관 동의 화면 — 「알림 · 개인정보 처리업무 위탁 안내 — 동의를 받는 항목이 아니라 …」 · 선택 항목에 위탁 없음',
        pg.locator('#app [data-notice-terms]').count() == 1 and '동의를 받는 항목이 아니라' in t and pg.locator('#app [data-trm-opt="OUTSOURCE"]').count() == 0, t[-200:])
    paint('guide'); t = body()
    rec('H-33 이용안내 약관 표 — 「개인정보 처리업무 위탁 안내 · 발행 · 알림(동의 받지 않음)」', '개인정보 처리업무 위탁 안내' in t and '알림(동의 받지 않음)' in t, '')
    paint('termsv'); pg.locator('#app [data-termpick]', has_text='위탁').first.click(); pg.wait_for_timeout(300); t = norm(pg.inner_text('#app [data-terms-body]'))
    rec('H-34 약관 전문 — 위탁 안내: 「알림 — 동의를 받는 항목이 아님(개인정보 보호법 제26조 · 공개)」', '동의를 받는 항목이 아님' in t and '제26조' in t, t[:160])
    rec('H-35 가입 4단계 — 동의 칸에 위탁 없음 · 「알림 · 개인정보 처리업무 위탁 안내」 한 줄', '<b>개인정보 처리업무 위탁 안내</b> — 동의를 받는 항목이 아니라' in SRC and '"개인정보 처리 위탁 동의"' not in SRC, '')
    rec('Z 스크립트 오류 0', not errs, errs[:3])
    b.close()

json.dump(R, open(os.path.join(OUT, 'fix_1028_proto.json'), 'w'), ensure_ascii=False, indent=1)
bad = [r for r in R if not r['ok']]
print(f"통과 {len(R) - len(bad)} / {len(R)}")
sys.exit(1 if bad else 0)
