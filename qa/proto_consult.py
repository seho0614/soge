"""시안 v10.12 · v10.13 — 안심소개 상담 축 변경분 + 월 노출료 기준 금액(D020) 시연 점검 (업종 22종 · 법률 · 세무 사무소 보기 · 상담 신청 → 인증 → 접수).
파일(file://)로 열어 실제로 누릅니다. 결과: proto_consult.json"""
import re, json, os, sys
from playwright.sync_api import sync_playwright
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
P = 'file://' + os.environ.get('PROTO', K + '/spec/proto.html')   # v10.31 PROTO
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:200]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:140], file=sys.stderr)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(P); pg.wait_for_timeout(1500)
    src_title = open(os.environ.get('PROTO', K + '/spec/proto.html'), encoding='utf-8').read(4000).split('<title>')[1].split('</title>')[0]
    rec('P-0 파일 제목이 v10.13 이후 · 기준 금액 표기', bool(re.search(r'v10\.1[3-9]', src_title)) and '기준 금액 300,000원' in src_title, src_title[:80])
    cats = pg.evaluate("window.__LEADCAT")
    rec('P-1 상담 업종 22종 — 공개(상담 신청) 20 · 월 정액 노출형 2 · 준비 중 0 · 카드 · 금융 없음', len(cats) == 22 and sum(c[5] == 'open' for c in cats) == 20
        and [c[0] for c in cats if c[5] == 'dir'] == ['CSL_LEGAL', 'CSL_TAX'] and not any(c[0] in ('CSL_CARD', 'CSL_FINANCE', 'CSL_RENTCAR') for c in cats), [c[0] for c in cats][:5])
    rec('P-2 자격 확인(GATED) 12 · 일반 10 — 서버 업종과 같은 코드', sum(c[2] == 'GATED' for c in cats) == 12 and sum(c[2] == 'OPEN' for c in cats) == 10)
    pg.evaluate("location.hash='#/mal/consult'"); pg.wait_for_timeout(700)
    t = pg.inner_text('body')
    rows = pg.locator('.axrow')
    # v10.24 — 줄의 단추가 「고르기」 하나에서 「상세 보기」 + 「상담 신청」으로 바뀌었습니다(법률 · 세무는 「사무소 보기」). 업종 이름도 상세로 갑니다
    btn = lambda t: pg.locator('.axrow .axr a', has_text=t).count()
    rec('P-3 #/mal/consult 업종 목록 22줄 · 「상세 보기」 20 · 「상담 신청」 20 · 「사무소 보기」 2(법률 · 세무)', rows.count() == 22 and (btn('상세 보기'), btn('상담 신청'), btn('사무소 보기')) == (20, 20, 2), (rows.count(), btn('상세 보기'), btn('상담 신청'), btn('사무소 보기')))
    # 리드형 — 신청 → 인증 → 접수
    pg.evaluate("location.hash='#/mal/consult/CSL_INSURANCE/apply'"); pg.wait_for_timeout(700)      # v10.24 — 신청서 주소는 …/apply (앞 주소는 업종 상세)
    t = pg.inner_text('body')
    rec('P-4 보험 — 공개(준비 중 아님) · 자격 확인 안내 · 신청서', '보험 상담 신청' in t and '자격 확인 업종입니다' in t and '아직 받지 않습니다' not in t and pg.locator('#csl-name').count() == 1, t[:120])
    pg.evaluate("location.hash='#/mal/consult/CSL_CLEANING/apply'"); pg.wait_for_timeout(700)
    pg.fill('#csl-name', '홍길동'); pg.fill('#csl-tel', '010-1234-5678')
    sub = pg.locator('[data-csl-submit]')
    sub.click(); pg.wait_for_timeout(600)
    t1 = pg.inner_text('body')
    rec('P-5 휴대폰 확인 · 동의 없이 신청 → 접수되지 않고 안내', '상담 신청을 받았습니다' not in t1, t1[-160:])
    pg.locator('[data-csl-otp]').click(); pg.wait_for_timeout(600)
    rec('P-6 「인증번호 받기」 → 확인됨(시연) 표시', '확인됨' in pg.locator('[data-csl-otp]').inner_text(), pg.locator('[data-csl-otp]').inner_text())
    pg.select_option('#csl-area', index=1)
    pg.fill('#csl-memo', '32평 입주 청소')
    if pg.locator('#csl-mail').count(): pg.fill('#csl-mail', 'clean@example.com')     # v10.28 — 이메일 필수(지시서 4절)
    pg.check('#csl-agree')
    pg.locator('[data-csl-submit]').click(); pg.wait_for_timeout(800)
    t = pg.inner_text('body')
    rec('P-7 신청 → 접수 화면(접수번호 · 「인증된 업체 1곳」 · 시연 안내)', '청소 상담 신청을 받았습니다' in t and '접수번호' in t and '인증된 업체 1곳' in t and '시연 화면입니다' in t, t[:200])
    pg.locator('[data-csl-reset]').click(); pg.wait_for_timeout(600)
    rec('P-8 「새로 신청」 → 신청서로', pg.locator('#csl-name').count() == 1)
    # 정액 노출형
    for code, name, office in (('CSL_LEGAL', '법률', '법무법인 한빛'), ('CSL_TAX', '세무', '한결 세무회계')):
        pg.evaluate(f"location.hash='#/mal/consult/{code}'"); pg.wait_for_timeout(700)
        t = pg.inner_text('body')
        rec(f'P-9 {name} — 월 정액 노출형: 신청서 없음 · 「광고」 · 사무소 · 전화 링크 · 추천 · 연결 안 함 안내',
            pg.locator('#csl-name').count() == 0 and '월 정액 노출형' in t and office in t and '광고' in t and '추천하거나 연결하지 않습니다' in t
            and pg.locator('a[href^="tel:"]').count() >= 2, t[:160])
    pg.locator('button[data-go="ptnapply"]', has_text='사무소 게재 신청').click(); pg.wait_for_timeout(700)
    t = pg.inner_text('body')
    rec('P-10 「사무소 게재 신청」 → 입점 신청 화면 · 축별 자격 안내(등록 · 허가증 업종 / 사업자 인증 업종)', '입점' in t and '이사짐' in t and '청소' in t, t[:160])
    pg.evaluate("location.hash='#/mal/consult'"); pg.wait_for_timeout(500)
    pg.locator('.axrow .axr a[href="#/mal/consult/CSL_INTERIOR/apply"]').click(); pg.wait_for_timeout(700)
    rec('P-11 목록의 「상담 신청」 → 그 업종 신청서', '인테리어 상담 신청' in pg.inner_text('body'))
    # 안심소개 메인의 상담 축
    pg.evaluate("location.hash=''"); pg.evaluate("__VIEW.paint('listl')"); pg.wait_for_timeout(800)
    pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())")   # 진입 광고(시연)를 닫고 누릅니다
    tab = pg.locator('.axt', has_text='상담')
    if tab.count(): tab.first.click(); pg.wait_for_timeout(700)
    t = pg.inner_text('body')
    rec('P-12 안심소개 메인 상담 축 — 22줄 · 법률 · 세무는 「광고」 · 「사무소 보기」 2개 · 준비 중 표시 없음', pg.locator('.axrow').count() == 22
        and pg.locator('.axrow a', has_text='사무소 보기').count() == 2 and '광고' in t and '법무 재확인' not in t, pg.locator('.axrow').count())
    row = pg.locator('.axrow', has_text='법률').first
    row.locator('a', has_text='사무소 보기').click(); pg.wait_for_timeout(700)
    rec('P-12b 메인의 법률 줄 「사무소 보기」 → 사무소 목록(월 정액 노출형)', '월 정액 노출형' in pg.inner_text('body') and '법무법인 한빛' in pg.inner_text('body'))
    # v10.12 — 월 노출료 기준 금액 (운영 화면 admptnw · 파트너 화면 ptnlst)
    def paint(k):
        pg.evaluate("location.hash=''"); pg.evaluate(f"__VIEW.paint('{k}')"); pg.wait_for_timeout(700)
        pg.evaluate("document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())")
    paint('admptnw')
    t = pg.inner_text('body')
    rec('P-14 운영 「리드 이용료 · 등급」 화면에 「월 노출료 기준 금액」 상자 · 지금 월 300,000원 · 입력 칸 300000',
        '월 노출료 기준 금액' in t and '월 300,000원' in t and pg.locator('[data-dirfee="300000"]').count() == 1 and pg.input_value('#dirfee-in') == '300000', t[-200:])
    pg.fill('#dirfee-in', '30만원'); pg.locator('[data-dirfee-save]').click(); pg.wait_for_timeout(500)
    rec('P-15 글자가 섞인 금액 → 저장하지 않고 안내 · 기준 금액 그대로', '숫자만 적어 주십시오' in pg.inner_text('body') and pg.locator('[data-dirfee="300000"]').count() == 1)
    pg.locator('[data-dirfee-on="1"]').click(); pg.wait_for_timeout(500)
    rec('P-16 「입금 확인 · 켜기」(금액 비움) → 노출 중 · 월 300,000원', '노출 중 · 월 300,000원' in pg.inner_text('body'))
    pg.fill('#dirfee-in', '350000'); pg.locator('[data-dirfee-save]').click(); pg.wait_for_timeout(500)
    t = pg.inner_text('body')
    rec('P-17 기준 금액 350000 저장 → 지금 월 350,000원 · 이미 노출 중인 건은 300,000원 그대로',
        pg.locator('[data-dirfee="350000"]').count() == 1 and '저장했습니다' in t and '노출 중 · 월 300,000원' in t, t[-160:])
    pg.locator('[data-dirfee-on=""]').click(); pg.wait_for_timeout(400)
    rec('P-18 노출 종료 → 다시 켜기 버튼에 새 기준 금액(월 350,000원)', '금액 비움 → 월 350,000원' in pg.inner_text('body'))
    paint('ptnlst')
    # v10.33 — 안내 문구가 「노출료는 월 350,000원 (부가세 별도)」 · 입금 월 385,000원으로 바뀜(부가세 별도 결정)
    rec('P-19 파트너 「내 매물」 화면 안내에 같은 기준 금액(월 350,000원 (부가세 별도) · 입금 월 385,000원)', pg.locator('[data-dirfee-note="350000"]').count() == 1
        and '월 350,000원 (부가세 별도)' in pg.inner_text('body') and '월 385,000원' in pg.inner_text('body'))
    pg.evaluate("__VIEW && (window.__st = 1)")
    pg.reload(); pg.wait_for_timeout(1200); paint('ptnlst')
    rec('P-20 새로 열면 시작값 300,000원(시연은 저장하지 않음)', pg.locator('[data-dirfee-note="300000"]').count() == 1)
    # ── v10.33 (D092) — 부가세 별도 · 기간 연장 A안 · 세금계산서 시연 ─────────────────
    paint('admptnw')
    t = pg.inner_text('body')
    rec('P-21 (v10.33) 운영 상자 — 「월 300,000원 (부가세 별도)」 · 입금 합계 월 330,000원 × 개월수', '월 300,000원 (부가세 별도)' in t and '월 330,000원 × 개월수' in t, t[-200:])
    pg.locator('[data-dirfee-on="1"]').click(); pg.wait_for_timeout(500)
    rec('P-22 (v10.33) 켜기 → 1회차 · 세금계산서 발행 요청 1건(300,000 + 30,000 = 330,000)', pg.locator('[data-dir-inv="1"]').count() == 1
        and '330,000원' in pg.locator('[data-dir-inv]').inner_text() and '발행 요청' in pg.locator('[data-dir-inv]').inner_text())
    paint('ptnlst')
    pg.select_option('#dir-renew-m', '3'); pg.wait_for_timeout(300)
    rec('P-23 (v10.33) 파트너 화면 — 노출 중 · 연장 칸(개월수 고르기)', pg.locator('[data-dir-partner="ACTIVE"]').count() == 1, pg.locator('[data-dir-partner]').inner_text()[-160:] if pg.locator('[data-dir-partner]').count() else '')
    pg.locator('[data-dir-renew]').click(); pg.wait_for_timeout(500)
    t = pg.inner_text('body')
    rec('P-24 (v10.33) 「연장 신청」 3개월 → 연장 입금 확인 대기 · 입금하실 금액 990,000원 · 노출 계속', pg.locator('[data-dir-partner="RENEW_REQUESTED"]').count() == 1 and '990,000원' in t, t[-200:])
    paint('admptnw')
    rec('P-25 (v10.33) 운영 화면에 연장 신청 줄 — 합계 990,000원', pg.locator('[data-dir-renew-row="990000"]').count() == 1)
    pg.locator('[data-dir-renew-ok]').click(); pg.wait_for_timeout(500)
    t = pg.inner_text('body')
    rec('P-26 (v10.33) 연장 입금 확인 → 2회차 · 세금계산서 2건 · 안내', '2회차' in t and pg.locator('[data-dir-inv="2"]').count() == 1 and '연장 입금(합계 990,000원)' in t, t[-200:])
    pg.locator('[data-dir-inv-issue="0"]').click(); pg.wait_for_timeout(400)
    rec('P-27 (v10.33) 「발행됨으로」 → 발행됨 · 시연 번호', '발행됨' in pg.locator('[data-dir-inv]').inner_text() and '시연-' in pg.locator('[data-dir-inv]').inner_text())
    paint('ptnlst'); pg.locator('[data-dir-renew]').click(); pg.wait_for_timeout(400)
    paint('admptnw'); pg.locator('[data-dir-renew-no]').click(); pg.wait_for_timeout(400)
    rec('P-28 (v10.33) 연장 반려 → 지금 노출 그대로 · 세금계산서 늘지 않음', '반려했습니다' in pg.inner_text('body') and pg.locator('[data-dir-inv="2"]').count() == 1)
    rec('P-13 스크립트 오류 0', not errs, errs[:3])
    b.close()
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proto_consult.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
