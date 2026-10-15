# w3 v10.31 사본 — D064(주문 시각 순서: 주문 ≤ 결제 ≤ 발송 ≤ 배송 완료)에 맞춰 과거로 돌릴 때 주문 · 결제 시각도 함께 돌림
"""v10.26 사용자 웹 시험 — 옵션 · 성분군 · 자동완성 · 메인 구역 · 장바구니 가격 변경 · 교환 비용 결제 (Playwright, 실제 로그인 · 누르기)

  python3 site_opt.py            결과: results_v10_26/site_opt.json
  필요한 것: API(3000) · 사용자 웹(5174) · 개발 DB 의 견본 시드(seed-hlt-samples.sql — p01 ~ p17)
  만드는 것: 새 시험 계정(sopt_*@t.local) 1개 · 그 계정의 주문 2건(배송 완료로 바꿈) · 교환 신청 2건(시험 결제)
"""
import json, os, re, sys, uuid
from urllib.parse import quote
from playwright.sync_api import sync_playwright
import flow_lib as fl
from flow_lib import call, q, rows, sql, signup

SITE = fl.SITE
OUT = os.environ.get('OUT', '/home/claude/qa/results_v10_26'); os.makedirs(OUT, exist_ok=True)
R = []
EXPECTED = []


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:160] if not ok else '', flush=True)


def G(d, *ks):
    for k in ks:
        try: d = d[k]
        except Exception: return None
    return d


def safe(step, fn):
    try: fn()
    except Exception as e: rec(f'{step} (실행 오류)', False, repr(e)[:240])


def main():
    em, pw, TOK, aid = signup('sopt', '웹 옵션 시험'); call('POST', '/verifications/identity', TOK, {'provider': 'PASS'})
    call('POST', '/me/health/addresses', TOK, {'receiver': '웹시험', 'phone': '010-1234-5678', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
    addr = G(call('GET', '/me/health/addresses', TOK)[1], 0, 'id')
    ings = call('GET', '/health/ingredients')[1] or []
    by = {g['code']: g for g in ings}
    p01 = call('GET', '/health/products/p01')[1] or {}
    p03 = call('GET', '/health/products/p03')[1] or {}

    def delivered():
        oo = G(p03, 'options', 1, 'id')
        sql(f"UPDATE hlt_product_options SET stock = GREATEST(stock, 6) WHERE id = '{oo}'")      # 시험 준비 — 배송 완료로 남는 시험 주문이 재고를 가져가므로 모자라면 채움(개발 DB)
        st, o = call('POST', '/health/orders', TOK, {'addressId': addr, 'items': [{'productCode': 'p03', 'optionId': oo, 'qty': 1}]}); no = G(o, 'orderNo')
        call('POST', f'/health/orders/{no}/pay', TOK, {'method': 'CARD'})
        call('POST', f'/health/orders/{no}/pay/confirm', TOK, {'paymentKey': 'stub_' + uuid.uuid4().hex[:12], 'amount': int(G(o, 'total') or 0)})
        sql(f"UPDATE hlt_orders SET status='DELIVERED', created_at=now()-interval '4 day', paid_at=now()-interval '3 day', shipped_at=now()-interval '2 day', delivered_at=now()-interval '1 day' WHERE order_no='{no}'")
        return no

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1400, 'height': 1000})
        pg = fl.site_login(ctx, em, pw)
        errs, apis = fl.watch(pg)

        # ── 메인 ──
        def M():
            fl.goto(pg, '/health')
            low = pg.locator('[data-shop-low] .shop-lowc')
            units = sorted(int(g['minUnit']) for g in ings if g.get('minUnit') is not None and not g.get('isGroup'))
            first = low.first.get_attribute('data-unit') if low.count() else None
            rec('W-1 메인 「성분별 최저가」 — 「N원 / 30일」(성분의 한 달 단가 · 살 수 있는 옵션) · 낮은 순 · 규격(성분 | 함량)',
                low.count() >= 1 and '/ 30일' in low.first.inner_text() and first is not None and int(first) == units[0], (low.count(), first, units[:3]))
            new = pg.locator('[data-shop-new] .shop-newc'); deal = pg.locator('[data-shop-deal] .shop-dealc')
            dcodes = [deal.nth(i).get_attribute('data-product') for i in range(deal.count())]
            want = sorted(r[0] for r in rows("select p.code from hlt_products p join categories c on c.id=p.category_id where p.badge='특별가격' and p.status='ON_SALE' and p.list_price > p.price and c.code <> 'HLT_FUNC' and p.stock > 0"))
            rec('W-2 메인 「새로 올라온 상품」 4장 · 「이번 주 특별 할인」 = 배지 「특별가격」 상품(값 · 정가 취소선 · 할인율)',
                new.count() == 4 and sorted(dcodes) == want and all('%' in deal.nth(i).inner_text() for i in range(deal.count())), (new.count(), dcodes, want))
            # v10.31 (w3 · 10/10 시안) — 「오늘의 건강상품」 · 「많이 찾는 상품」을 서버 값으로 다시 그림(site_mall M-6 이 내용을 봄) · 예전 「소개몰 상품」 구역은 없음 · 별점 표시는 지어내지 않음
            rec('W-3 메인 — 예전 「소개몰 상품」 구역 없음 · 순위 구역은 서버 값만(지어낸 별점 없음)',
                pg.locator('[data-shop-products]').count() == 0 and pg.locator('[data-shop-today] .star, [data-shop-many] .star').count() == 0, pg.locator('[data-shop-today], [data-shop-many]').count())
        safe('M', M)

        # ── 성분별 ──
        def I():
            fl.goto(pg, '/health/ingredients')
            sec = lambda k: [pg.locator(f'[data-ing-sec="{k}"] [data-ing]').nth(i).get_attribute('data-ing') for i in range(pg.locator(f'[data-ing-sec="{k}"] [data-ing]').count())]
            feat = sorted(g['code'] for g in ings if g.get('featured') and not g.get('isGroup'))
            rec('W-4 성분별 — 「많이 찾는 성분」 = 서버의 많이 찾는 성분 · 「전체 성분」에는 군 · 군 아래 성분이 없음', sorted(sec('featured')) == feat
                and not any(by.get(c, {}).get('parent') or by.get(c, {}).get('isGroup') for c in sec('all')), (sec('featured'), sec('all')[:5]))
            kids = [pg.locator('[data-ing-group="BERRY"] [data-ing]').nth(i).get_attribute('data-ing') for i in range(pg.locator('[data-ing-group="BERRY"] [data-ing]').count())]
            rec('W-5 「성분군」 상자 — 블루베리·베리류 아래 블루베리 · 빌베리', kids == ['BLUEB', 'BILB'], kids)
            vc = pg.locator('[data-ing="VITC"]').first.inner_text()
            rec('W-6 성분 칩 「월 N원 부터 · N개」(비타민C 3,900원)', '월 3,900원 부터' in vc.replace('\n', ' '), vc)
            pg.fill('input[aria-label="성분 찾기"]', '블루'); pg.wait_for_timeout(300)
            found = [pg.locator('[data-ing-found] [data-ing]').nth(i).get_attribute('data-ing') for i in range(pg.locator('[data-ing-found] [data-ing]').count())]
            rec('W-7 「성분 찾기」 — 글자를 치면 묶음 없이 맞는 성분만(군 아래 성분도 찾음)', 'BLUEB' in found and 'VITC' not in found and pg.locator('[data-ing-sec]').count() == 0, found)
        safe('I', I)

        # ── 성분 상세 ──
        def D():
            fl.goto(pg, '/health/i/VITC'); t = pg.inner_text('main')
            rec('W-8 성분 상세 머리 「최저 월 N원 · 상품 N개」', '최저 월 3,900원' in t, t[:120])
            pg.select_option('#ingSort', 'name'); pg.wait_for_url(re.compile(r'sort=name'), timeout=8000)
            rec('W-9 정렬 고르기 — 「이름순」을 고르면 주소가 ?sort=name 으로 바뀌어 서버가 정렬', 'sort=name' in pg.url, pg.url)
            multi = next((g for g in ings if len((call('GET', '/health/ingredients/' + g['code'])[1] or {}).get('amounts') or []) > 1), None)
            if not multi:
                rec('W-10 함량 단추 — 함량이 2가지 이상인 성분이 견본에 없음(단추를 그리지 않는 쪽만 봄)', pg.locator('[data-amounts]').count() == 0, '')
                return
            dg = call('GET', '/health/ingredients/' + multi['code'])[1]; a = dg['amounts'][0]
            fl.goto(pg, '/health/i/' + quote(multi['code'])); pg.locator(f'[data-amt="{a}"]').click(); pg.wait_for_url(re.compile('amt='), timeout=8000); pg.wait_for_timeout(300)
            shown = sorted(pg.locator('.hlt-grid [data-product]').evaluate_all('e => e.map(x => x.dataset.product)'))
            want = sorted(x['code'] for x in dg['products'] if x.get('ingAmount') == a)
            rec(f'W-10 함량 단추({multi["name"]} {a}) — 그 함량의 상품만', shown == want and shown, (shown, want))
        safe('D', D)

        # ── 검색 ──
        def S():
            fl.goto(pg, '/health/search')
            pop = pg.locator('[data-popular] .hlt-chip').all_inner_texts()
            rec('W-11 인기 검색어 — 시안의 5개(비타민C · 유산균 · 루테인 · 마그네슘 · 콜라겐) 가운데 살 수 있는 것', pop == ['비타민C', '유산균', '루테인', '마그네슘', '콜라겐'], pop)
            box = pg.locator('#qInput'); box.click(); box.type('비타', delay=50); pg.wait_for_selector('[data-suggest] [role=option]', timeout=8000)
            opts = pg.locator('[data-suggest] [role=option]').all_inner_texts()
            rec('W-12 자동완성 — 성분 이름 + 상품 이름(시안 글대로) · 8줄까지', any('상품' in o for o in opts) and any('성분' in o for o in opts) and len(opts) <= 8, opts)
            box.press('ArrowDown'); box.press('Enter'); pg.wait_for_url(re.compile(r'q='), timeout=8000)
            first = opts[0].replace('🔍', '').replace('성분', '').replace('상품', '').strip()
            rec('W-13 ↓ + Enter — 고른 말로 바로 검색(시안은 칸에 넣기만 · 10/8 B-11)', quote(first) in pg.url or first in pg.url, (pg.url, first))
            fl.goto(pg, '/health/search'); box = pg.locator('#qInput'); box.click(); box.type('루테', delay=50)
            pg.wait_for_selector('[data-suggest] [role=option]', timeout=8000); pg.locator('[data-suggest] [role=option]').first.click()
            pg.wait_for_url(re.compile(r'q='), timeout=8000); pg.wait_for_timeout(500)
            rec('W-14 제안을 누르면 바로 검색 · 결과 카드', pg.locator('.hlt-grid [data-product]').count() >= 1, pg.url)
            fl.goto(pg, '/health/search'); box = pg.locator('#qInput'); box.click(); box.type('비타', delay=50)
            pg.wait_for_selector('[data-suggest]', timeout=8000); box.press('Escape'); pg.wait_for_timeout(200)
            rec('W-15 Esc — 목록 닫힘', pg.locator('[data-suggest]').count() == 0, '')
        safe('S', S)

        # ── 상품 상세 ──
        def P():
            fl.goto(pg, '/health/p/p01'); t = pg.inner_text('main')
            rec('W-16 상품 상세 — 옵션 줄 3개 · 「교환 배송비 왕복 6,000원」 줄 · 「최대 할인가 한 달 3,900원」',
                pg.locator('[data-option-row], .hlt-optrow').count() >= 3 and pg.locator('[data-exchange-fee="6000"]').count() == 1 and '한 달 3,900원' in t, (pg.locator('.hlt-optrow').count(), t[:100]))
        safe('P', P)

        # ── 장바구니 · 가격 변경 확인 ──
        def C():
            sql(f"DELETE FROM hlt_cart_items WHERE account_id='{aid}'")
            o0 = G(p01, 'options', 0)
            call('POST', '/me/health/cart', TOK, {'productCode': 'p01', 'optionId': o0['id'], 'qty': 1})
            fl.goto(pg, '/health/cart')
            lab = pg.locator(f'[data-cart-line="{o0["id"]}"] [data-optlabel]')
            rec('W-17 장바구니 줄 — 옵션 이름 · 작은 그림', lab.count() == 1 and o0['label'] in lab.inner_text() and pg.locator(f'[data-cart-line="{o0["id"]}"] .hlt-mini').count() == 1, (o0.get('label'), lab.all_inner_texts()))
            sql(f"UPDATE hlt_cart_items SET added_price = added_price - 1000 WHERE account_id='{aid}'")
            fl.goto(pg, '/health/cart')
            chg = pg.locator('[data-price-changed]').count(); dis = pg.locator('button.cta-primary[disabled]', has_text='주문하기').count()
            rec('W-18 담은 뒤 값이 바뀌면 「가격이 변경되었습니다」 · 주문하기 잠김', chg == 1 and dis == 1, (chg, dis))
            pg.locator('[data-price-ack] input').click(); pg.wait_for_timeout(1500)      # 누르면 서버가 맞추고 칸이 사라집니다(체크 표시를 남기지 않음)
            rec('W-19 「확인했습니다」를 누르면 담을 때 값을 지금 값으로 맞추고 주문하기가 열림', pg.locator('[data-price-changed]').count() == 0 and pg.locator('a.cta-primary', has_text='주문하기').count() == 1
                and q(f"select count(*) from hlt_cart_items where account_id='{aid}' and added_price <> (select price from hlt_product_options where id=option_id)") == '0', '')
            sql(f"DELETE FROM hlt_cart_items WHERE account_id='{aid}'")
        safe('C', C)

        # ── 교환 신청 · 교환 배송비 결제 ──
        def X():
            no = delivered()
            fl.goto(pg, f'/my/health/returns/new?o={no}')
            pg.locator('main button[role=radio]', has_text=re.compile(r'^\s*교환\s*$')).click(); pg.wait_for_timeout(300)
            bx = pg.locator('[data-exchange-box]')
            rec('W-20 교환을 고르면 「교환 비용」 상자 — 단순 변심 = 왕복 6,000원 · 환불 예상 표는 없음 · 재고 없으면 14일 뒤 반품(반품 배송비를 빼지 않음)', bx.count() == 1 and bx.get_attribute('data-exchange-fee') == '6000' and pg.locator('[data-refund-table]').count() == 0 and '반품 배송비를 빼지 않고 전액 환불' in bx.inner_text(), bx.all_inner_texts())
            pg.select_option('main select', 'DEFECT'); pg.wait_for_timeout(200)
            rec('W-21 판매자 사유(파손 · 불량)를 고르면 0원 · 「비용이 들지 않습니다」', bx.get_attribute('data-exchange-fee') == '0' and '비용이 들지 않습니다' in bx.inner_text(), bx.inner_text()[:120])
            pg.select_option('main select', 'CHANGE_MIND'); pg.locator('button.cta-primary', has_text='교환 접수').click()
            pg.wait_for_selector('[data-fee-pay]', timeout=10000)
            rid = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no}' and r.kind='EXCHANGE'")
            rec('W-22 접수하면 그 자리에서 「교환 배송비 결제」(6,000원) 단추', pg.locator('[data-fee-pay] .hlt-sum').inner_text().replace('\n', ' ').find('6,000원') >= 0 and bool(rid), rid)
            pg.locator('[data-fee-pay] button.cta-primary').click(); pg.wait_for_selector('[data-fee-paid]', timeout=10000)
            rec('W-23 시험 결제(스텁) → 승인 · 결제 기록 PAID 6,000원', q(f"select state || ':' || amount from hlt_exchange_fees where return_id='{rid}' and state='PAID'") == 'PAID:6000', q(f"select string_agg(state, ',') from hlt_exchange_fees where return_id='{rid}'"))
            fl.goto(pg, '/my/health/returns'); row = pg.locator('[data-fee-state]').first
            rec('W-24 취소 · 반품 내역 — 교환 배송비 「결제 완료」', row.get_attribute('data-fee-state') == 'PAID' and '결제 완료' in row.inner_text(), row.inner_text()[:100])
            # 결제 전에 나간 경우 — 내역 · 주문 상세의 「결제하기」로 다시
            no2 = delivered(); st, r2 = call('POST', '/me/health/returns', TOK, {'orderNo': no2, 'kind': 'EXCHANGE', 'reason': 'WRONG_ORDER'})
            fl.goto(pg, f'/my/health/orders/{no2}')
            lk = pg.locator('[data-fee-pay-link]')
            ok_detail = lk.count() == 1 and pg.locator('[data-item] .hlt-mini svg, [data-item] .hlt-mini img').count() >= 1 and pg.locator('[data-item] [data-optlabel]').count() >= 1
            rec('W-25 주문 상세 — 작은 그림 · 옵션 이름 · 결제 전 교환의 「결제하기」', ok_detail, (lk.count(), pg.locator('[data-item]').count()))
            lk.click(); pg.wait_for_selector('[data-fee-pay]', timeout=10000)
            pg.locator('[data-fee-pay] button.cta-primary').click(); pg.wait_for_selector('[data-fee-paid]', timeout=10000)
            rec('W-26 「결제하기」 → 교환 배송비 결제 화면 → 승인', q(f"select state from hlt_exchange_fees where return_id='{G(r2, 'id')}' and state='PAID'") == 'PAID', G(r2, 'id'))
            fl.goto(pg, f'/my/health/returns/{G(r2, "id")}/fee'); t = pg.inner_text('main')
            rec('W-27 이미 낸 신청의 결제 화면을 다시 열면 「이미 결제하셨습니다」(두 번 내지 않음)', '이미 결제하셨습니다' in t, t[:100])
            EXPECTED.append(f"422 POST /me/health/returns/{G(r2, 'id')}/fee/")      # 아래 W-28 이 일부러 만드는 거절(주소가 60자에서 잘려 기록됨)
            fl.goto(pg, f'/my/health/returns/{G(r2, "id")}/fee?paymentKey=stub_x{uuid.uuid4().hex[:6]}&orderId=x&amount=1'); pg.wait_for_timeout(1500); t = pg.inner_text('main')
            rec('W-28 결제창 성공 주소를 금액만 바꿔 열어도 승인하지 않음(서버가 교환 배송비와 대조 · AMOUNT_MISMATCH)', pg.locator('.hlt-fail').count() == 1 and '다릅니다' in t
                and q(f"select count(*) from hlt_exchange_fees where return_id='{G(r2, 'id')}' and state='PAID'") == '1', t[:160])
        safe('X', X)

        bad_api = [a for a in apis if not a.startswith('401') and a not in EXPECTED]
        rec('W-29 다닌 쪽에 화면 오류 없음', not errs, errs[:3])
        rec('W-30 다닌 쪽에서 실패한 API 응답 없음(일부러 보낸 잘못된 결제 확인 · 결제 끝난 신청 다시 열기는 뺌)',
            not bad_api, bad_api[:5])
        b.close()
    sql(f"DELETE FROM hlt_cart_items WHERE account_id='{aid}'")
    ok = sum(r['ok'] for r in R)
    json.dump({'pass': ok, 'total': len(R), 'items': R}, open(f'{OUT}/site_opt.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}' + ('' if ok == len(R) else ' · 실패 ' + ' '.join(r['step'].split()[0] for r in R if not r['ok'])))
    return ok == len(R)


if __name__ == '__main__':
    sys.exit(0 if main() else 1)
