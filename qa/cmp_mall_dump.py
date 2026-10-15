"""소개몰 — 시안 ↔ 개발분 화면별 내용 뜨기(10/8 지시: 개발분과 시안을 비교 · 다른 점은 시안 기준).
  시안   = 미리보기 시안(proto_v1025.html · 사용자가 본 「바꿀 모양」)  21화면
  개발분 = 지금 떠 있는 사용자 웹(SITE · 기본 5174 — 미리보기와 같은 코드)  22쪽
  화면마다 본문 글자 · 단추 · 링크 · 입력칸 · 전체 그림을 떠서 /home/claude/design_1007/cmp25b/raw 에 둡니다(읽기만 — 주문 · 자료를 만들지 않음. 개발분 장바구니는 브라우저 안에만 담김).
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright
import shot_mall as sm
RAW = os.environ.get('CMPDIR', '/home/claude/design_1007/cmp25c') + '/raw'; os.makedirs(RAW, exist_ok=True)      # cmp25b = 반영 전(10/8 확인 받은 것) · cmp25c = 반영 뒤(v10.25)
PROTO = 'file://' + os.environ.get('PROTO', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'); SITE = os.environ.get('SITE', 'http://localhost:5174')
PEND = os.environ.get('PEND', 'H26100700622'); DELV = os.environ.get('DELV', 'H26100700621')
PAIRS = [  # (번호, 시안 화면, 시안 주소, 이름, 개발분 주소)
    ('01', 'SB-HLT-HUB-010', '#/', '메인', '/health'),
    ('02', 'SB-HLT-HUB-020', '#/direct', '직판관', '/health/direct'),
    ('03', 'SB-HLT-CAT-010', '#/c/HLT_FOOD', '전체제품(갈래별 목록)', '/health/c/ALL'),
    ('04', 'SB-HLT-CAT-020', '#/search?q=비타민', '검색', '/health/search?q=' + os.environ.get('WQ', '홍삼')),
    ('05', 'SB-HLT-CAT-030', '#/ingredients', '성분별', '/health/ingredients'),
    ('06', 'SB-HLT-CAT-040', '#/i/VITC', '성분 상세', '/health/i/' + os.environ.get('WING', 'GINSENG')),
    ('07', 'SB-HLT-CAT-050', '#/concerns', '고민별', '/health/concerns'),
    ('08', 'SB-HLT-CAT-060', '#/w/IMMUNE', '고민 상세', '/health/w/' + os.environ.get('WCON', 'CIRC')),
    ('09', 'SB-HLT-PRD-010', '#/p/p01', '상품 상세', '/health/p/' + os.environ.get('WPRD', 'RED-30')),
    ('10', 'SB-HLT-CRT-010', '#/cart', '장바구니', '/health/cart'),
    ('11', 'SB-HLT-ORD-010', '#/order', '주문서', '/health/order'),
    ('12', 'SB-HLT-ORD-020', '#/order/pay', '결제', f'/health/order/pay?no={PEND}'),
    ('13', 'SB-HLT-ORD-030', '#/order/done', '주문 완료', f'/health/order/done?no={DELV}'),
    ('14', 'SB-HLT-ORD-040', '#/order/fail', '주문 실패', f'/health/order/fail?no={PEND}&code=USER_CANCEL&msg=시험'),
    ('15', 'SB-HLT-MYO-010', '#/my/orders', '내 주문', '/my/health/orders'),
    ('16', 'SB-HLT-MYO-020', '#/my/orders/H20260908-000041', '주문 상세', f'/my/health/orders/{DELV}'),
    ('17', 'SB-HLT-MYO-030', '#/my/orders/H20260908-000041/track', '배송 조회', f'/my/health/orders/{DELV}/ship'),
    ('18', 'SB-HLT-RTN-010', '#/my/returns/new?o=H20260908-000041', '취소 · 반품 신청', f'/my/health/returns/new?o={DELV}'),
    ('19', 'SB-HLT-RTN-020', '#/my/returns', '취소 · 반품 내역', '/my/health/returns'),
    ('20', 'SB-HLT-ADR-010', '#/my/addresses', '배송지 관리', '/my/health/addresses'),
    ('21', 'SB-HLT-ETC-010', '#/guide', '이용안내 · 청약철회', '/health/guide'),
    ('22', None, None, '결제 승인(결제사에서 돌아오는 주소)', '/health/order/pay/success'),
]
DIG = """(sel) => { const m = document.querySelector(sel); if (!m) return null; const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const tx = e => (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
  return { text: m.innerText, heads: [...m.querySelectorAll('h1,h2,h3,h4')].filter(vis).map(e => e.tagName + ' ' + tx(e)).slice(0, 80),
    btns: [...m.querySelectorAll('button,[role=button],input[type=submit]')].filter(vis).map(tx).filter(Boolean).slice(0, 200),
    links: [...m.querySelectorAll('a')].filter(vis).map(tx).filter(Boolean).slice(0, 200),
    inputs: [...m.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'hidden' && vis(e)).map(e => (e.tagName + ':' + (e.type || '') + ':' + (e.name || e.id || '') + ':' + (e.placeholder || e.getAttribute('aria-label') || ((e.closest('label') || {}).innerText || '').slice(0, 30))).replace(/\\s+/g, ' ')).slice(0, 80),
    imgs: m.querySelectorAll('img').length, svgs: m.querySelectorAll('svg').length } }"""


def main():
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ── 시안 ──
        pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        pg.goto(PROTO + '#/health'); pg.wait_for_timeout(1600); pg.evaluate(sm.CLEAN)
        pg.evaluate("window.__hlt.addToCart('p01', 0)")
        def pshot(no):
            pg.evaluate(sm.CLEAN); pg.screenshot(path=f'{RAW}/p_{no}.png')
            h = pg.evaluate("document.getElementById('hltroot').scrollHeight"); pg.set_viewport_size({'width': 1500, 'height': max(1000, min(h, 7000))}); pg.wait_for_timeout(150)
            pg.screenshot(path=f'{RAW}/p_{no}_full.png'); pg.set_viewport_size({'width': 1500, 'height': 1000}); pg.wait_for_timeout(80)
        flow = {}
        for no, key, route, name, _ in PAIRS:
            if not key: continue
            if key == 'SB-HLT-ORD-020':        # 결제 화면은 주문서에서 두 동의를 누르고 「결제하기」를 눌러야 열립니다(바로 가면 「진행 중인 결제가 없습니다」)
                pg.evaluate("window.__hltMall.go('#/order')"); pg.wait_for_timeout(250)
                for cb in pg.locator('#hltapp main input[type=checkbox]').all():
                    if not cb.is_checked(): cb.check()
                pg.locator('#hltapp main button', has_text=re.compile('결제하기')).first.click(timeout=5000); pg.wait_for_timeout(400)
            elif key == 'SB-HLT-ORD-030':      # 주문 완료 — 결제 화면(시연)에서 「결제 성공」을 눌러야 내용이 찹니다
                pg.locator('#hltapp main button', has_text=re.compile('결제 성공')).first.click(timeout=5000); pg.wait_for_timeout(1500)
                flow['after_pay'] = pg.evaluate("window.__hltMall.route ? window.__hltMall.route() : location.hash")
            else:
                pg.evaluate("(h) => window.__hltMall.go(h)", route); pg.wait_for_timeout(280)
            d = pg.evaluate(DIG, '#hltapp main'); d['screen'] = pg.evaluate("(document.querySelector('#hltapp main') || {getAttribute(){return null}}).getAttribute('data-screen')"); d['title'] = pg.evaluate("document.title")
            pshot(no); out.setdefault(no, {'name': name})['proto'] = {'key': key, 'route': route, **d}
        out['_flow'] = flow; pg.close()
        # ── 개발분 ──
        c = b.new_context(viewport={'width': 1500, 'height': 1000}); pg = c.new_page()
        pg.goto(SITE + '/login', wait_until='networkidle'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form.auth button'); pg.wait_for_timeout(2500)
        pg.goto(SITE + '/health/p/OMG-60', wait_until='networkidle'); bt = pg.locator('main button:has-text("담기")').first
        if bt.count(): bt.click(); pg.wait_for_timeout(900)
        for no, key, route, name, path in PAIRS:
            r = pg.goto(SITE + path, wait_until='networkidle'); pg.wait_for_timeout(300)
            d = pg.evaluate(DIG, 'main'); d['status'] = r.status if r else None; d['title'] = pg.evaluate("document.title"); d['final'] = pg.evaluate("location.pathname + location.search")
            pg.screenshot(path=f'{RAW}/w_{no}.png'); pg.screenshot(path=f'{RAW}/w_{no}_full.png', full_page=True)
            out.setdefault(no, {'name': name})['web'] = {'path': path, **d}
        c.close(); b.close()
    json.dump(out, open(f'{RAW}/dump.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for no in sorted(k for k in out if k != '_flow'):
        o = out[no]; pr = o.get('proto'); w = o.get('web')
        print(no, o['name'], '| 시안', (pr or {}).get('screen'), len((pr or {}).get('text', '')), '자 | 개발분', (w or {}).get('status'), len((w or {}).get('text', '')), '자', (w or {}).get('final'))
    print(out['_flow'])


if __name__ == '__main__':
    main()
