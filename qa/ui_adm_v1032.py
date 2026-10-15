"""v10.32 운영 화면 바뀐 흐름 점검 — 감사 ↔ 감사 기록 · 파트너사 상세 열기/닫기 · 새 관 다음/이전 · 소개몰 상품 고치기 · 성향 학습 ↔ 미리보기"""
import sys; sys.path.insert(0, '/home/claude/qa')
from flow_lib import q
from playwright.sync_api import sync_playwright
BO = 'http://127.0.0.1:5173'; R = []
def rec(n, ok, d=''): R.append(ok); print(('ok  ' if ok else 'FAIL'), n, d)
with sync_playwright() as p:
    __import__('consent_ok').agree('admin@x.com', 'sgb-dev-1234')
    b = p.chromium.launch(); c = b.new_context(viewport={'width': 1280, 'height': 900}); pg = c.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.goto(BO); pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form button[type=submit]')
    pg.wait_for_selector('.bo-head nav button', timeout=60000)
    h1 = lambda: pg.inner_text('.ad-pgh h1')
    # 감사
    pg.goto(BO + '/#/gov-audit'); pg.reload(); pg.wait_for_selector('[data-audit-logs]', timeout=30000)
    rec('AUD-1 감사 쪽에 감사 기록 표가 붙어 있지 않음 · 보관 표 · 임계 칸', pg.locator('[data-audit-log-table]').count() == 0 and pg.locator('[data-audit-retention]').count() == 1 and '20건' in pg.inner_text('[data-audit-signals]'), h1())
    pg.click('[data-audit-logs]'); pg.wait_for_selector('input[aria-label="행위"]', timeout=15000)
    rec('AUD-2 「기록 보기」 → #/gov-audit/logs · 제목 감사 기록', pg.evaluate('location.hash') == '#/gov-audit/logs' and h1() == '감사 기록', pg.evaluate('location.hash'))
    pg.fill('input[aria-label="행위"]', 'ACCOUNT_LIST'); pg.click('form.search-row button'); pg.wait_for_timeout(1500)
    rows = pg.locator('[data-audit-log-table] tbody tr')
    rec('AUD-3 행위로 찾기', rows.count() > 0 and all('ACCOUNT_LIST' in rows.nth(i).inner_text() for i in range(min(5, rows.count()))), rows.count())
    pg.click('[data-audit-back]'); pg.wait_for_selector('[data-audit-retention]', timeout=15000)
    rec('AUD-4 「← 감사 징후」 → 감사', h1() == '감사' and pg.evaluate('location.hash').startswith('#/gov-audit'), pg.evaluate('location.hash'))
    pg.click('[data-audit-review]'); pg.wait_for_selector('[data-audit-form]', timeout=5000)
    rec('AUD-5 「징후 확인」 → 판단 칸(징후 고르기)', pg.locator('[data-audit-form] select[aria-label="징후"] option').count() >= 7, '')
    # 파트너사 상세
    pg.goto(BO + '/#/partners/list'); pg.reload(); pg.wait_for_selector('[data-ptn-open]', timeout=30000)
    want = pg.get_attribute('[data-ptn-open] >> nth=0', 'data-ptn-open')
    # v10.34 — 새로 설치한 DB 처럼 파트너가 20곳 이하면 「더 보기」 없이 전부(전에는 개발 DB 에 118곳이 쌓여 있다고 가정)
    _np = int(q("select count(*) from partners") or 0)
    rec('PTN-1 목록 카드 20곳씩 · 더 보기(20곳 넘을 때만)', pg.locator('[data-ptn-row]').count() == min(20, _np) and pg.locator('[data-ptn-more]').count() == (1 if _np > 20 else 0), (pg.locator('[data-ptn-row]').count(), _np))
    pg.locator('[data-ptn-open]').first.click(); pg.wait_for_selector('[data-ptn-detail]', timeout=15000); pg.wait_for_timeout(1500)
    rec('PTN-2 상세 따로 열림(목록 없음) · 계약 · 서류', pg.get_attribute('[data-ptn-detail]', 'data-ptn-detail') == want and pg.locator('[data-ptn-row]').count() == 0
        and pg.locator('[data-ptn-docs] tbody tr').count() >= 2 and h1() == '파트너사 상세', pg.evaluate('location.hash'))
    pg.click('[data-ptn-close]'); pg.wait_for_selector('[data-ptn-row]', timeout=15000)
    rec('PTN-3 「← 파트너사 목록」', pg.locator('[data-ptn-detail]').count() == 0 and h1() == '파트너사', '')
    pg.locator('[data-ptn-open]').first.click(); pg.wait_for_selector('[data-ptn-detail]', timeout=15000); pg.go_back(); pg.wait_for_selector('[data-ptn-row]', timeout=15000)
    rec('PTN-4 뒤로 가기 → 목록', pg.locator('[data-ptn-detail]').count() == 0, pg.evaluate('location.hash'))
    # 새 관
    pg.goto(BO + '/#/gwans/new'); pg.reload(); pg.wait_for_selector('[data-gwan-step="1"]', timeout=30000)
    pg.locator('label', has_text='자산 · 매물').click(); pg.click('[data-gwan-next]'); pg.wait_for_selector('[data-gwan-step="2"]', timeout=5000)
    rec('SIT-1 1단계 → 다음 → 2단계(코드 · 이름) · 소개 대상 유지', '자산 · 매물' in pg.inner_text('[data-gwan-step="2"]') and pg.locator('input[placeholder="예) EDU"]').count() == 1
        and pg.locator('.ad-nsteps li.on .n').inner_text() == '2', '')
    pg.locator('button', has_text='← 이전').click(); pg.wait_for_selector('[data-gwan-step="1"]', timeout=5000)
    rec('SIT-2 ← 이전 → 1단계(고른 것 유지)', pg.locator('input[aria-label="자산 · 매물"]').is_checked(), '')
    # 소개몰 상품
    pg.goto(BO + '/#/hlt-products'); pg.reload(); pg.wait_for_selector('[data-hpr-preview]', timeout=30000)
    rec('HPR-1 한 쪽에 상품 · 고치기(읽기) · 변경 기록 · 성분 · 갈래', all(pg.locator(s).count() == 1 for s in ('[data-products]', '[data-hpr-preview]', '[data-history]', '[data-ingredients]', '[data-sale-categories]')), '')
    code = pg.get_attribute('[data-hpr-preview]', 'data-hpr-preview')
    pg.click('[data-act="product-open-edit"]'); pg.wait_for_selector('[data-screen="SB-ADM-HPR-011"]', timeout=15000)
    rec('HPR-2 「고치기」 → 입력 화면(같은 상품)', pg.get_attribute('[data-screen="SB-ADM-HPR-011"]', 'data-edit') == code, code)
    pg.locator('button', has_text='← 상품 목록').click(); pg.wait_for_selector('[data-hpr-preview]', timeout=15000)
    pg.locator('.subtabs button', has_text='갈래 · 판매 범위').click(); pg.wait_for_timeout(1200)
    y = pg.evaluate("document.querySelector('[data-sale-categories]').getBoundingClientRect().top")
    rec('HPR-3 「갈래 · 판매 범위」 칩 → 같은 쪽 그 구역으로', 0 <= y < 400, y)
    # 성향 학습 ↔ 미리보기
    pg.goto(BO + '/#/ai-ops/segments'); pg.reload(); pg.wait_for_selector('[data-seg-preview]', timeout=30000)
    pg.click('[data-seg-preview]'); pg.wait_for_selector('[data-seg-preview-view]', timeout=15000)
    rec('SEG-1 대상 보기 → #/ai-ops/segments-preview · 제목', pg.evaluate('location.hash') == '#/ai-ops/segments-preview' and h1() == '옮길 대상 미리보기', h1())
    pg.locator('button', has_text='← 성향 학습').click(); pg.wait_for_selector('[data-seg-preview]', timeout=15000)
    rec('SEG-2 ← 성향 학습 · 제목 AI 운영', h1() == 'AI 운영', h1())
    rec('JS 오류 없음', not errs, errs[:2])
    b.close()
print(f'통과 {sum(R)} / {len(R)}')
