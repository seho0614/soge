"""v10.26 시안 시험 — 소개몰 상품 자료 고친 곳(비교표 5절 · 10/8 「추천한 형태로 · 디자인은 깨지 말 것」).  결과: proto_opt.json

  1 자동완성(상품 이름 · 살 수 있는 것만 · 고르면 바로 검색)   2 그림 글자(「건강기능식품」 「GMP」 없음)   3 「한 달 N원 부터」 = 살 수 있는 옵션만
  4 p12 건강식품 · 화장품 견본 p17(단품)   5 반품 신청의 품목 · 수량 칸 없음   6 「개월 수에 따라 월 단가가 다릅니다」   7 견본 주문 품목 이름
  8 교환 배송비(접수 때 시험 결제 · 내역의 결제 단추)   9 운영 「소개몰 상품」 화면
사용: python3 proto_opt.py     PROTO=/path/proto.html (기본: 킷의 spec/proto.html)
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

# v10.27 (G-199) — 시안의 견본 주문번호는 주문일(7일 · 12일 전)을 따릅니다(전: H20260908-000041 고정)
from datetime import datetime as _dt, timedelta as _td
SNO41 = 'H' + (_dt.now() - _td(days=7)).strftime('%Y%m%d') + '-000041'
SNO18 = 'H' + (_dt.now() - _td(days=12)).strftime('%Y%m%d') + '-000018'

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
FILE = os.environ.get('PROTO', K + '/spec/proto.html')
OUT = os.environ.get('OUT', os.path.dirname(os.path.abspath(__file__)))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:260], flush=True)
norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()
CLEAN = "document.querySelectorAll('.admask,.adfloat').forEach(e=>e.remove())"


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
        pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        pg.goto('file://' + FILE + '#/health'); pg.wait_for_timeout(1600); pg.evaluate(CLEAN)
        def go(h, w=350): pg.evaluate("(h) => window.__hltMall.go(h)", h); pg.wait_for_timeout(w); pg.evaluate(CLEAN)
        main_ = lambda: norm(pg.evaluate("(document.querySelector('#hltapp main') || {innerText: ''}).innerText"))
        H = "window.__hlt"

        # 2 그림 글자
        go('#/c/HLT_FOOD', 500)
        txt = pg.evaluate("[...document.querySelectorAll('#hltapp main svg text')].map(t => t.textContent).join('|')")
        rec('2 상품 그림 안에 「건강기능식품」 「GMP」 글자가 없음(성분 이름 · 함량만)', 'GMP' not in txt and '건강기능식품' not in txt and len(txt) > 0, txt[:120])

        # 3 한 달 단가 — p10(6개월 옵션 품절)
        go('#/p/p10', 450); t = main_()
        rec('3a p10 상세 「최대 할인가 한 달 2,990원 (지금 살 수 있는 옵션 기준)」 — 품절 옵션의 2,900원이 아님', '한 달 2,990원' in t and '지금 살 수 있는 옵션 기준' in t and '2,900원 (' not in t, t[t.find('최대'):t.find('최대') + 60])
        go('#/c/HLT_FOOD', 450)
        c10 = norm(pg.evaluate("""(() => { const c = [...document.querySelectorAll('#hltapp article.hlt-card')].find(a => (a.getAttribute('data-go') || '') === '#/p/p10'); return c ? c.innerText : '' })()"""))
        rec('3b p10 카드 「한 달 2,990원 부터」', '2,990원 부터' in c10, c10[:120])
        u = pg.evaluate(f"{H}.ingMinUnit('CABBAGE')")
        rec('3c 성분(양배추)의 「월 N원 부터」도 살 수 있는 옵션만 — 2,990', u == 2990, u)

        # 4 p12 · p17
        cats = pg.evaluate(f"{H}.PRODUCTS.filter(p => p.cat === 'HLT_COSMETIC').map(p => p.id)")
        p12 = pg.evaluate(f"{H}.PRODUCTS.find(p => p.id === 'p12').cat")
        rec('4a 저분자 콜라겐(p12)은 건강식품 · 화장품 갈래는 견본 p17 하나', p12 == 'HLT_FOOD' and cats == ['p17'], (p12, cats))
        go('#/p/p17', 450); t = main_()
        rec('4b p17 상세 — 옵션 줄 없이 수량 칸 · 「남은 수량 40개」 · 한 달 단가 줄 없음 · 「의약품이 아닙니다」 고지 없음(화장품)',
            pg.locator('#hltapp main [data-single]').count() == 1 and '남은 수량 40개' in t and '한 달' not in t.split('배송 · 교환')[0] and '옵션 선택' not in t and '의약품이 아닙니다' not in t, t[:160])
        pg.locator('#hltapp main button[data-addcart]').first.click(); pg.wait_for_timeout(300)
        go('#/cart', 400); t = main_()
        rec('4c p17 을 담으면 장바구니 줄의 옵션 이름 「단품」', '데일리 콜라겐 수분 크림 50ml' in t and '단품' in t, t[:200])
        go('#/c/HLT_COSMETIC', 450)
        c17 = norm(pg.evaluate("""(() => { const c = [...document.querySelectorAll('#hltapp article.hlt-card')].find(a => (a.getAttribute('data-go') || '') === '#/p/p17'); return c ? c.innerText : '' })()"""))
        rec('4d p17 카드 — 「한 달 N원 부터」 줄 없음 · 담기 단추', bool(c17) and '부터' not in c17 and pg.locator('#hltapp [data-cardadd^="p17:"]').count() == 1, c17[:120])

        # 6 안내 글 · 교환 배송비 줄
        go('#/p/p06', 450); t = main_()
        rec('6 상세 안내 「개월 수에 따라 월 단가가 다릅니다」(「길수록 내려갑니다」 없음) · 교환 배송비 「왕복 6,000원 (… 신청 때 결제 …)」',
            '개월 수에 따라 월 단가가 다릅니다' in t and '길수록' not in t and '교환 배송비 왕복 6,000원 (단순 변심 · 잘못 주문 시 신청 때 결제' in t, t[t.find('교환 배송비'):t.find('교환 배송비') + 70])

        # 7 견본 주문 품목 이름
        o = pg.evaluate(f"{H}.S.orders.find(o => o.no === '{SNO41}').items[0].name")
        rec('7 견본 주문 품목 이름 = 상품 이름(메가바이탈 비타민C 3000)', o == '메가바이탈 비타민C 3000', o)

        # 1 자동완성
        go('#/search', 400)
        box = pg.locator('#qInput'); box.fill(''); box.click(); box.type('비타', delay=40); pg.wait_for_timeout(300)
        opts = [norm(x) for x in pg.locator('#hltapp .hltsug li').all_inner_texts()]
        rec('1a 자동완성 — 성분 이름 + 상품 이름(시안 v10.25 는 상품이 빠졌음)', any('상품' in x for x in opts) and any('성분' in x for x in opts), opts)
        box.press('ArrowDown'); box.press('Enter'); pg.wait_for_timeout(500)
        route = pg.evaluate("window.__hltMall.route ? JSON.stringify(window.__hltMall.route()) : location.hash")
        first = re.sub(r'\s*(성분|상품)$', '', opts[0].replace('🔍', '').strip()) if opts else 'X'
        rec('1b ↓ + Enter — 고른 제안으로 바로 검색', first in pg.evaluate("decodeURIComponent(location.hash)") or first in main_()[:200], (first, route[:120]))
        go('#/search', 300); box = pg.locator('#qInput'); box.fill(''); box.click(); box.type('양배', delay=40); pg.wait_for_timeout(300)
        before = [norm(x) for x in pg.locator('#hltapp .hltsug li').all_inner_texts()]
        pg.evaluate(f"(() => {{ const H = {H}; const p = H.PRODUCTS.find(p => p.id === 'p10'); p.options.forEach(o => H.STOCK['p10:' + o.i] = 0) }})()")
        go('#/search', 300); box = pg.locator('#qInput'); box.fill(''); box.click(); box.type('양배', delay=40); pg.wait_for_timeout(300)
        after = [norm(x) for x in pg.locator('#hltapp .hltsug li').all_inner_texts()]
        rec('1c 살 수 있는 것만 — p10 을 모두 품절로 만들면 「양배추」 성분 · 「양배추 매스틱 1000」 상품이 제안에서 빠짐', any('양배추' in x for x in before) and not any('양배추' in x for x in after), (before, after))
        pg.evaluate(f"(() => {{ const H = {H}; H.STOCK['p10:0'] = 0; H.STOCK['p10:1'] = 48 }})()")
        go('#/search', 300); box = pg.locator('#qInput'); box.fill(''); box.click(); box.type('루테', delay=40); pg.wait_for_timeout(300)
        pg.locator('#hltapp .hltsug li').first.click(); pg.wait_for_timeout(500)
        rec('1d 제안을 누르면 바로 검색 · 결과 카드', pg.locator('#hltapp main article.hlt-card').count() >= 1, main_()[:120])

        # 5 · 8 반품 신청 · 교환 비용
        go(('#/my/returns/new?o=' + SNO41 + ''), 500)
        rec('5 반품 신청 — 품목 체크 칸 · 수량 칸 없음(주문 전체)', pg.locator('#hltapp main [data-ritem], #hltapp main [data-rq]').count() == 0 and '(주문 전체)' in main_(), main_()[:160])
        pg.locator('#hltapp main [data-rkind="EXCHANGE"]').click(); pg.wait_for_timeout(300)
        t = norm(pg.inner_text('#rCalc'))
        rec('8a 교환을 고르면 「교환 배송비 (왕복) 6,000원」 · 「접수하신 뒤 바로 결제」 · 재고 없을 때 14일 · 그때는 반품 배송비를 빼지 않음(10/8 답)', '6,000원' in t and '접수하신 뒤 바로 결제' in t and '14일' in t and '반품 배송비를 빼지 않고 전액 환불' in t, t[:260])
        pg.locator('#btnReturn').click(); pg.wait_for_timeout(500)
        md = norm(pg.evaluate("(document.querySelector('#hltmodal') || {innerText:''}).innerText"))
        rec('8b 교환 접수 → 「교환 배송비 결제」 창(6,000원 · 시험 결제)', '교환 배송비 결제' in md and '6,000원' in md and '시험 결제' in md, md[:160])
        pg.locator('#hltmodal [data-mact="payXfee"]').click(); pg.wait_for_timeout(400); t = main_()
        rec('8c 결제 → 내역에 「교환 배송비 6,000원 · 결제 완료」', '교환 배송비 6,000원 · 결제 완료' in t, t[:200])
        # 결제하지 않고 닫은 경우 — 내역의 단추로 다시
        pg.evaluate(f"""(() => {{ const H = {H}; const o = H.S.orders.find(o => o.no === '{SNO18}'); o.status = 'DELIVERED'; o.deliveredAt = new Date(Date.now() - 86400000) }})()""")
        go(('#/my/returns/new?o=' + SNO18 + ''), 500)
        pg.locator('#hltapp main [data-rkind="EXCHANGE"]').click(); pg.wait_for_timeout(300); pg.locator('#btnReturn').click(); pg.wait_for_timeout(500)
        pg.locator('#hltmodal [data-mact="close"]').click(); pg.wait_for_timeout(300)
        n_btn = pg.locator('#hltapp main [data-xfee]').count()
        rec('8d 「나중에」로 닫으면 내역에 「결제 전」 · 「교환 배송비 결제」 단추', n_btn == 1 and '결제 전' in main_(), (n_btn, main_()[:160]))
        if n_btn:
            pg.locator('#hltapp main [data-xfee]').click(); pg.wait_for_timeout(300); pg.locator('#hltmodal [data-mact="payXfee"]').click(); pg.wait_for_timeout(400)
        rec('8e 내역의 단추 → 결제 → 단추가 사라지고 「결제 완료」', pg.locator('#hltapp main [data-xfee]').count() == 0 and main_().count('결제 완료') >= 2, main_()[:160])
        # 판매자 사정 교환은 0원 · 결제 창 없음
        rec('8f 판매자 사유(파손 · 불량)의 교환은 비용 0원(계산 규칙 그대로)', pg.evaluate(f"""(() => {{ const H = {H}; const o = H.S.orders[0]; return H.refundCalc(o, 'DEFECT').party }})()""") == 'SELLER', '')

        # 9 운영 화면
        pg.goto('file://' + FILE); pg.wait_for_timeout(1500)
        pg.evaluate("__VIEW.paint('admhpr')"); pg.wait_for_timeout(300); pg.evaluate(CLEAN)
        t = norm(pg.inner_text('#screen'))
        rec('9 운영 「소개몰 상품」(SB-ADM-HPR-010) — 상품 목록 · 옵션/재고 · 변경 기록 · 성분/고민 · 갈래/판매 범위', all(w in t for w in ('소개몰 상품', '② 옵션 · 재고', '변경 기록', '성분 · 고민', '갈래 · 판매 범위', 'p17')), t[:160])
        rec('9b 그림 · 화면에 오류 0', not errs, errs[:3])
        b.close()
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'proto_opt.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
    return ok == len(R)


if __name__ == '__main__':
    sys.exit(0 if main() else 1)
