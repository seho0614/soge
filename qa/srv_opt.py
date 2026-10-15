# w3 v10.31 사본 — D064(주문 시각 순서: 주문 ≤ 결제 ≤ 발송 ≤ 배송 완료)에 맞춰 과거로 돌릴 때 주문 · 결제 시각도 함께 돌림
"""v10.26 소개몰 — 상품 자료 · 옵션 · 성분군 · 화장품 갈래 · 견본 16종 · 검색 제안 · 운영 상품 관리 · 교환 배송비 (서버 · DB 시험)

  10/8 확정(문서 「…비교표_반영전확인_v10.26_20261008.md」): A-1 교환 접수 때 온라인 결제 · A-2 견본 16종 모두 직판 · A-3 일부 반품 넣지 않음 ·
  A-4 p12 는 건강식품 + 바르는 화장품 견본 1종(p17) · B 14가지 추천값 · 시안의 5곳은 바르게(「한 달 N원 부터」는 살 수 있는 옵션만 · 제안에 상품 이름 · …)
  ★ 고치기 전에 먼저 돌려 실패를 봅니다(시험 먼저).

  D 구조     P 상품 자료     L 목록 · 카드     I 성분 · 군     C 갈래     S 검색 · 제안     K 장바구니 · 옵션 · 가격 변경 · 재고
  X 교환 배송비     A 운영 상품 관리     Z 뒷정리
사용: python3 srv_opt.py      API=http://localhost:3000/api/v1(flow_lib 기본) · 결과 srv_opt.json
  만든 자료 — 시험 계정 opt_*@t.local(남음) · 시험 주문(끝에 취소 승인 → 재고 복원) · 시험 상품 OPTTEST-*(판매 중지로 남김 · 지울 수 없음: 주문 기록)
"""
import json, os, sys, threading, uuid
from urllib.parse import quote
import flow_lib as fl
from flow_lib import call, q, rows, sql, login, signup

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = json.load(open(f'{HERE}/v1026_proto_products.json', encoding='utf8'))
PS = {p['id']: p for p in SEED['products']}
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else '| ' + str(detail)[:240], file=sys.stderr, flush=True)
def G(o, *ks, d=None):
    for k in ks:
        if isinstance(o, dict): o = o.get(k)
        elif isinstance(o, list) and isinstance(k, int) and -len(o) <= k < len(o): o = o[k]
        else: return d
        if o is None: return d
    return o
def safe(step, fn):
    try: fn()
    except Exception as e: rec(step, False, f'예외 {type(e).__name__}: {e}')


def main():
    ADM = login('admin@x.com')
    em, pw, TOK, aid = signup('opt', '옵션 시험'); call('POST', '/verifications/identity', TOK, {'provider': 'PASS'})
    call('POST', '/me/health/addresses', TOK, {'receiver': '옵션시험', 'phone': '010-1234-5678', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
    addr = G(call('GET', '/me/health/addresses', TOK)[1], 0, 'id')
    made_orders = []

    # ── D 구조 ────────────────────────────────────────────────────────────
    def D():
        cols = lambda t: {r[0] for r in rows(f"select column_name from information_schema.columns where table_schema='public' and table_name='{t}'")}
        rec('D-1 옵션 표 hlt_product_options(개월 수 · 결제 금액 · 재고 · 꼬리 글자 · 순서 · 켬)', {'product_id', 'months', 'price', 'stock', 'tag', 'sort', 'is_active'} <= cols('hlt_product_options'), sorted(cols('hlt_product_options')))
        rec('D-2 모든 상품에 옵션이 하나 이상(지금 상품은 「단품」 옵션 1개로 옮김)', q("select count(*) from hlt_products p where not exists (select 1 from hlt_product_options o where o.product_id=p.id)") == '0', q("select string_agg(code, ',') from hlt_products p where not exists (select 1 from hlt_product_options o where o.product_id=p.id)"))
        bad = rows("""select p.code, p.price, p.stock, (select o.price from hlt_product_options o where o.product_id=p.id and o.is_active order by o.months nulls first, o.sort desc limit 1),
                      (select coalesce(sum(o.stock),0) from hlt_product_options o where o.product_id=p.id and o.is_active) from hlt_products p""")
        mis = [r for r in bad if r[3] and (r[1] != r[3] or r[2] != r[4])]
        rec('D-3 상품의 값 · 재고 = 옵션에서 나온 값(대표 판매가 = 가장 짧은 개월 수 옵션 · 재고 = 켠 옵션 재고의 합)', not mis and bad, mis[:3])
        rec('D-4 장바구니 줄 · 주문 품목이 옵션을 가리킴(option_id) · 장바구니에 「담을 때 값」', {'option_id', 'added_price'} <= cols('hlt_cart_items') and {'option_id', 'option_label'} <= cols('hlt_order_items'), (sorted(cols('hlt_cart_items')), sorted(cols('hlt_order_items'))))
        uq = q("select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid='hlt_cart_items'::regclass and contype='u'")
        rec('D-5 장바구니 유일 규칙이 「계정 + 옵션」(같은 상품의 두 옵션을 함께 담을 수 있음)', 'option_id' in (uq or '') and 'product_id' not in (uq or ''), uq)
        rec('D-6 상품 자료 열 — 한 줄 설명 · 정가 · 배지 · 주의사항 · 고시 · 그림(꼴 · 색 · 사진) · 기능성 문구', {'summary', 'list_price', 'badge', 'caution', 'notice', 'art_form', 'art_tone', 'image_file_id', 'ad_copy'} <= cols('hlt_products'), sorted(cols('hlt_products')))
        rec('D-7 성분 — 군(상위 성분) · 많이 찾는 표시 · 상품의 표제 성분 표시', {'parent_code', 'is_group', 'is_featured'} <= cols('ingredients') and 'is_main' in cols('hlt_product_ingredients'), (sorted(cols('ingredients')), sorted(cols('hlt_product_ingredients'))))
        rec('D-8 교환 비용 — 신청에 교환 배송비 · 결제 기록 표', 'exchange_fee' in cols('hlt_returns') and {'return_id', 'amount', 'state', 'payment_key'} <= cols('hlt_exchange_fees'), (sorted(cols('hlt_returns')), sorted(cols('hlt_exchange_fees'))))
        rec('D-9 상품 변경 기록 표(결제 금액 · 재고 · 상태를 누가 언제 바꿨는지)', {'product_id', 'actor_id', 'field', 'before', 'after'} <= cols('hlt_product_history'), sorted(cols('hlt_product_history')))
        e = fl.sql("BEGIN; INSERT INTO hlt_product_options (product_id, months, price, stock, sort) SELECT id, 3, 0, 1, 99 FROM hlt_products LIMIT 1; ROLLBACK;")[1]
        e2 = fl.sql("BEGIN; UPDATE hlt_product_options SET stock = -1 WHERE id = (SELECT id FROM hlt_product_options LIMIT 1); ROLLBACK;")[1]
        rec('D-10 옵션 규칙을 DB 가 막음 — 결제 금액 0 · 재고 음수', 'check' in e.lower() and 'check' in e2.lower(), (e[:90], e2[:90]))
    safe('D', D)

    # ── P 상품 자료 ───────────────────────────────────────────────────────
    def P():
        st, p = call('GET', '/health/products/p01'); p = p or {}
        op = p.get('options') or []
        rec('P-1 견본 p01 상세 — 시안의 이름 · 한 줄 설명 · 정가 · 배지 · 표제 성분 「비타민C | 3,000mg」', st == 200 and p.get('name') == PS['p01']['name'] and p.get('summary') == PS['p01']['sum']
            and p.get('listPrice') == 36750 and p.get('badge') == '신규입점' and G(p, 'mainIngredient', 'code') == 'VITC' and G(p, 'mainIngredient', 'amount') == '3,000mg', (st, {k: p.get(k) for k in ('name', 'summary', 'listPrice', 'badge', 'mainIngredient')}))
        rec('P-2 옵션 3개 — 개월 수 9 · 6 · 3 / 결제 금액 35,100 · 25,200 · 14,700 / 한 달 단가 3,900 · 4,200 · 4,900 / 꼬리 글자 · 재고', [(o.get('months'), o.get('price'), o.get('unit'), o.get('tag') or '') for o in op] == [(9, 35100, 3900, '2+1'), (6, 25200, 4200, '1+1'), (3, 14700, 4900, '')]
            and all(isinstance(o.get('stock'), int) and o.get('id') for o in op), op)
        rec('P-3 옵션 이름 「9개월 분 2+1」 · 대표 판매가 14,700(가장 짧은 개월 수) · 할인율 60% · 한 달 최저 3,900원', G(op, 0, 'label') == '9개월 분 2+1' and p.get('price') == 14700 and p.get('offPct') == 60 and p.get('minUnit') == 3900, {k: p.get(k) for k in ('price', 'offPct', 'minUnit')} | {'label0': G(op, 0, 'label')})
        nt = p.get('notice') or []
        rec('P-4 상품정보제공고시 — 식품 11항목(시안의 항목 · 순서) · 비운 값은 「상세 설명 참조」 · 유통기한 「제조일로부터 24개월」', [x.get('label') for x in nt] == list(PS['p01']['notice'].keys())
            and {x['label']: x['value'] for x in nt} == PS['p01']['notice'], nt[:4])
        rec('P-5 주의사항 · 제목(식품 「섭취 · 사용상 주의사항」) · 교환 배송비 6,000 · 반품 주소', p.get('caution') == PS['p01']['caution'] and p.get('cautionTitle') == '섭취 · 사용상 주의사항' and p.get('exchangeFee') == 6000 and bool(p.get('returnAddr')),
            {k: p.get(k) for k in ('caution', 'cautionTitle', 'exchangeFee', 'returnAddr')})
        rec('P-6 그림 — 꼴 BOX · 색 GOLD (사진이 없으면 화면이 그림을 그림)', G(p, 'art', 'form') == 'BOX' and G(p, 'art', 'tone') == 'GOLD' and 'imageUrl' in p, p.get('art'))
        st, p10 = call('GET', '/health/products/p10'); o10 = (p10 or {}).get('options') or []
        rec('P-7 ★ p10 — 품절 옵션(6개월 · 재고 0)은 「품절」 표시 · 한 달 최저는 **살 수 있는 옵션만**: 2,990원(시안의 2,900원은 품절 옵션 값)', st == 200 and G(o10, 0, 'soldOut') is True and G(o10, 1, 'soldOut') is False and (p10 or {}).get('minUnit') == 2990, (st, [(o.get('months'), o.get('stock'), o.get('soldOut')) for o in o10], (p10 or {}).get('minUnit')))
        st, r30 = call('GET', '/health/products/RED-30'); o30 = (r30 or {}).get('options') or []
        rec('P-8 지금 상품 RED-30 — 「단품」 옵션 1개(개월 수 없음 · 한 달 단가 없음) · 값 그대로', st == 200 and len(o30) == 1 and G(o30, 0, 'months') is None and G(o30, 0, 'unit') is None and G(o30, 0, 'label') == '단품' and (r30 or {}).get('minUnit') is None, o30)
        st, _ = call('GET', '/health/products/p15')
        rec('P-9 p15(건강기능식품 · 잠긴 갈래)는 손님에게 보이지 않음(판매 중 아님)', st in (404, 409), st)
        st, p12 = call('GET', '/health/products/p12')
        rec('P-10 A-4 — p12 「저분자 콜라겐 1500」은 건강식품 갈래', st == 200 and (p12 or {}).get('categoryCode') == 'HLT_FOOD', (st, (p12 or {}).get('categoryCode')))
        st, p17 = call('GET', '/health/products/p17'); p17 = p17 or {}
        rec('P-11 A-4 — 화장품 견본 p17 — 갈래 화장품 · 단품 · 고시 화장품 11항목 · 주의사항 제목 「사용할 때의 주의사항」 · 청약철회 일반 규칙(GENERAL)', st == 200 and p17.get('categoryCode') == 'HLT_COSMETIC' and len(p17.get('notice') or []) == 11
            and G(p17, 'notice', 0, 'label') == '용량 또는 중량' and p17.get('cautionTitle') == '사용할 때의 주의사항' and p17.get('withdrawal') == 'GENERAL', (st, {k: p17.get(k) for k in ('categoryCode', 'cautionTitle', 'withdrawal')}, len(p17.get('notice') or [])))
        rec('P-12 「의약품이 아닙니다」 고지 — 식품에는 보임 · 화장품에는 보이지 않음(notMedicine)', p.get('notMedicine') is True and p17.get('notMedicine') is False, (p.get('notMedicine'), p17.get('notMedicine')))
        st, rel = call('GET', '/health/products/p01'); others = (rel or {}).get('sameIngredient')
        rec('P-13 상세의 「같은 성분의 다른 상품」 목록(시안 기준 · 성분이 같은 상품)', isinstance(others, list), others)
    safe('P', P)

    # ── L 목록 · 카드 ─────────────────────────────────────────────────────
    def L():
        st, ls = call('GET', '/health/products?category=HLT_FOOD'); ls = ls if isinstance(ls, list) else []
        by = {x.get('code'): x for x in ls}
        want = [k for k, v in PS.items() if v['cat'] == 'HLT_FOOD' or k == 'p12']
        rec('L-1 건강식품 목록에 견본 15종(p01 ~ p16 가운데 건강식품 · p12 포함)', all(k in by for k in want), sorted(set(want) - set(by)))
        c = by.get('p01', {})
        rec('L-2 카드 항목 — 표제 성분 · 정가 · 대표 판매가 · 할인율 · 한 달 최저 · 배지 · 그림 · 판매자 유형(직판)', G(c, 'mainIngredient', 'name') == '비타민C' and c.get('listPrice') == 36750 and c.get('price') == 14700 and c.get('offPct') == 60
            and c.get('minUnit') == 3900 and c.get('badge') == '신규입점' and G(c, 'art', 'form') == 'BOX' and c.get('sellerType') == 'DIRECT', {k: c.get(k) for k in ('mainIngredient', 'listPrice', 'price', 'offPct', 'minUnit', 'badge', 'art', 'sellerType')})
        rec('L-3 A-2 — 견본 16종 모두 직판(판매자 SGB-DIRECT)', q("select count(*) from hlt_products p join hlt_sellers s on s.id=p.seller_id where p.code ~ '^p[0-9]{2}$' and s.type <> 'DIRECT'") == '0' and q("select count(*) from hlt_products where code ~ '^p[0-9]{2}$'") == '17', q("select count(*) from hlt_products where code ~ '^p[0-9]{2}$'"))
        st, cats = call('GET', '/health/products?category=HLT_COSMETIC')
        rec('L-4 화장품 목록 — p17 하나', st == 200 and [x.get('code') for x in (cats or [])] == ['p17'], [x.get('code') for x in (cats or [])])
        rec('L-5 카드의 「담기」 옵션 — 재고가 있는 옵션 가운데 결제 금액이 가장 싼 것(cartOptionId)', c.get('cartOptionId') == G(call('GET', '/health/products/p01')[1], 'options', 2, 'id'), c.get('cartOptionId'))
    safe('L', L)

    # ── C 갈래 ───────────────────────────────────────────────────────────
    def C():
        st, cs = call('GET', '/health/categories'); by = {x.get('code'): x for x in (cs or [])}
        rec('C-1 갈래에 화장품(열림 · 상품 1)', G(by, 'HLT_COSMETIC', 'state') == 'OPEN' and G(by, 'HLT_COSMETIC', 'productCount') == 1, by.get('HLT_COSMETIC'))
        rec('C-2 건강기능식품은 그대로 잠김 · 의료기기는 그대로 팔지 않음 · 운동 · 재활 용품은 남김', G(by, 'HLT_FUNC', 'state') == 'LOCKED' and G(by, 'HLT_MEDDEV', 'state') == 'NOT_SOLD' and 'HLT_FITNESS' in by, {k: G(by, k, 'state') for k in ('HLT_FUNC', 'HLT_MEDDEV', 'HLT_FITNESS')})
        rec('C-3 화장품 수수료율 줄(10% — 건강식품과 같게)', q("select rate from hlt_commission_rates where category_code='HLT_COSMETIC'") in ('10', '10.00'), q("select rate from hlt_commission_rates where category_code='HLT_COSMETIC'"))
    safe('C', C)

    # ── I 성분 · 군 ───────────────────────────────────────────────────────
    def I():
        st, ig = call('GET', '/health/ingredients'); ig = ig if isinstance(ig, list) else []
        by = {x.get('code'): x for x in ig}
        rec('I-1 시안의 성분 26줄이 모두 있음', all(i['code'] in by for i in SEED['ingredients']), sorted({i['code'] for i in SEED['ingredients']} - set(by)))
        rec('I-2 지금 성분은 시안 코드로 합침 — VIT-D → VITD · CA → CALC · LACTO → PROBIO · GINSENG → REDGIN(옛 이름은 다른 이름으로 남음) · 비타민 B군은 그대로', not any(k in by for k in ('VIT-D', 'CA', 'LACTO', 'GINSENG')) and 'VIT-B' in by
            and '홍삼 농축액' in (G(by, 'REDGIN', 'aliases') or []), [k for k in ('VIT-D', 'CA', 'LACTO', 'GINSENG') if k in by])
        rec('I-3 많이 찾는 성분 7종(비타민C · 비타민D · 칼슘 · 오메가3 · 루테인 · 유산균 · 멀티비타민)', sorted(k for k, v in by.items() if v.get('featured')) == sorted(['VITC', 'VITD', 'CALC', 'OMEGA3', 'LUTEIN', 'PROBIO', 'MULTI']), sorted(k for k, v in by.items() if v.get('featured')))
        rec('I-4 성분군 2개 — 블루베리·베리류(블루베리 · 빌베리) · 홍삼·한방성분(홍삼 · 녹용)', G(by, 'BERRY', 'isGroup') is True and G(by, 'HONG', 'isGroup') is True and G(by, 'BLUEB', 'parent') == 'BERRY' and G(by, 'DEER', 'parent') == 'HONG' and G(by, 'REDGIN', 'parent') == 'HONG', {k: (G(by, k, 'isGroup'), G(by, k, 'parent')) for k in ('BERRY', 'HONG', 'BLUEB', 'REDGIN')})
        rec('I-5 성분 카드의 「월 N원 부터」(minUnit) — 비타민C 3,900 · 양배추 2,990(★ 품절 옵션 뺌) · 상품 없는 성분은 null', G(by, 'VITC', 'minUnit') == 3900 and G(by, 'CABBAGE', 'minUnit') == 2990 and G(by, 'GARCI', 'minUnit') is None, {k: G(by, k, 'minUnit') for k in ('VITC', 'CABBAGE', 'GARCI')})
        rec('I-6 「자격 필요」 표는 내려보내지 않음(뜻이 정해지지 않음 — 추천값 B-6)', not any('reg' in x or 'qualified' in x for x in ig), [k for k in (ig[0] if ig else {})])
        st, hg = call('GET', '/health/ingredients/HONG')
        rec('I-7 군의 상세 — 아래 성분의 상품을 모음(홍삼·한방성분 → RED-30)', st == 200 and 'RED-30' in [x.get('code') for x in (hg or {}).get('products') or []] and [c.get('code') for c in (hg or {}).get('children') or []] == ['REDGIN', 'DEER'], (st, [x.get('code') for x in (hg or {}).get('products') or []]))
        st, vc = call('GET', '/health/ingredients/VITC')
        rec('I-8 성분 상세 머리 「최저 월 N원」(minUnit) · 함량 목록(amounts — 2가지 이상일 때만 화면이 단추를 그림)', st == 200 and (vc or {}).get('minUnit') == 3900 and (vc or {}).get('amounts') == ['3,000mg'], (st, (vc or {}).get('minUnit'), (vc or {}).get('amounts')))
        st, srt = call('GET', '/health/ingredients/BERRY?sort=unit')
        rec('I-9 성분 상세 정렬 — sort=unit(월 단가 낮은 순 · 기본) · sort=name 을 받음', st == 200, st)
        e = fl.sql("BEGIN; UPDATE ingredients SET parent_code='BLUEB' WHERE code='VITC'; ROLLBACK;")[1]
        rec('I-10 성분군은 2단까지 — 군 아래 성분 아래에 또 달면 DB 가 막음', bool(e), e[:120])
        # 함량 단추로 거르려면 상품마다 「이 성분의 함량」이 있어야 합니다(대표 성분이 다른 상품도 있음)
        want = {r[0]: (r[1] if len(r) > 1 else '') for r in rows("SELECT p.code, coalesce(pi.amount,'') FROM hlt_product_ingredients pi JOIN hlt_products p ON p.id = pi.product_id WHERE pi.ingredient_code='VITC' AND p.status IN ('ON_SALE','SOLD_OUT')")}
        got = {x.get('code'): x.get('ingAmount') for x in (vc or {}).get('products') or []}
        rec('I-11 성분 상세의 상품마다 그 성분의 함량(ingAmount) — 함량 단추가 이것으로 거름', bool(want) and all((got.get(k) or '') == v for k, v in want.items()), (want, got))
    safe('I', I)

    # ── S 검색 · 제안 ─────────────────────────────────────────────────────
    def S():
        codes = lambda kw: [x.get('code') for x in (call('GET', '/health/products?keyword=' + quote(kw))[1] or [])]
        rec('S-1 검색이 한 줄 설명도 찾음 — 「분말형」 → p01', 'p01' in codes('분말형'), codes('분말형'))
        rec('S-2 성분 이름 · 다른 이름으로 찾음 — 「유산균」 → p05 · 「홍삼 농축액」 → RED-30', 'p05' in codes('유산균') and 'RED-30' in codes('홍삼 농축액'), (codes('유산균'), codes('홍삼 농축액')))
        rec('S-3 갈래 이름으로 찾음 — 「화장품」 → p17', codes('화장품') == ['p17'], codes('화장품'))
        sg = lambda kw: call('GET', '/health/suggest?q=' + quote(kw))[1] or []
        a = sg('메가'); words = [(x.get('word'), x.get('kind')) for x in a]
        rec('S-4 ★ 자동완성이 상품 이름도 제안 — 「메가」 → 상품 「메가바이탈 비타민C 3000」 + 성분 「오메가3」', ('메가바이탈 비타민C 3000', '상품') in words and ('오메가3', '성분') in words, words)
        b = [x.get('word') for x in sg('멀티')] + [x.get('word') for x in sg('블루')]
        rec('S-5 ★ 살 수 없는 것은 제안하지 않음 — 「멀티비타민」(잠긴 갈래뿐) · 「블루베리」(상품 없음)', '멀티비타민' not in b and '블루베리' not in b and '멀티비타민 데일리팩' not in b, b)
        rec('S-6 제안은 8줄까지 · 앞에서부터 맞는 낱말이 먼저', len(sg('비')) <= 8 and (G(sg('비타'), 0, 'word') or '').startswith('비타'), [x.get('word') for x in sg('비')])
        st, _ = call('GET', '/health/suggest?q=')
        rec('S-7 빈 낱말이면 빈 목록(200)', st == 200 and (_ == []), (st, _))
    safe('S', S)

    # ── K 장바구니 · 옵션 · 가격 변경 · 재고 ───────────────────────────────
    def K():
        p01 = call('GET', '/health/products/p01')[1] or {}; o9, o6, o3 = [o.get('id') for o in p01.get('options') or [None, None, None]][:3] if len(p01.get('options') or []) >= 3 else (None, None, None)
        st, e = call('POST', '/me/health/cart', TOK, {'productCode': 'p01', 'qty': 1})
        rec('K-1 옵션이 여럿인 상품을 옵션 없이 담으면 거절(OPTION_REQUIRED)', st in (409, 422) and G(e, 'code') == 'OPTION_REQUIRED', (st, G(e, 'code')))
        call('POST', '/me/health/cart', TOK, {'productCode': 'p01', 'optionId': o9, 'qty': 1}); st, cart = call('POST', '/me/health/cart', TOK, {'productCode': 'p01', 'optionId': o3, 'qty': 2})
        it = (cart or {}).get('items') or []
        rec('K-2 같은 상품의 두 옵션을 함께 담음 — 줄 2개 · 옵션 이름 · 담을 때 값', len(it) == 2 and {x.get('optionLabel') for x in it} == {'9개월 분 2+1', '3개월 분'} and all(x.get('addedPrice') == x.get('price') for x in it), [(x.get('optionLabel'), x.get('qty'), x.get('addedPrice')) for x in it])
        rec('K-3 장바구니 합계 = 35,100 × 1 + 14,700 × 2 = 64,500', (cart or {}).get('goods') == 64500, (cart or {}).get('goods'))
        st, r30 = call('POST', '/me/health/cart', TOK, {'productCode': 'RED-30', 'qty': 1})
        rec('K-4 옵션이 하나뿐인 상품(단품)은 옵션 없이 담아도 됨(지금 화면 · API 그대로)', st < 300, st)
        call('PATCH', '/me/health/cart/RED-30', TOK, {'qty': 0})
        # 가격 변경 — 운영이 9개월 옵션 값을 바꿈
        sql(f"UPDATE hlt_product_options SET price = price + 1000 WHERE id = '{o9}'")
        cart = call('GET', '/me/health/cart', TOK)[1] or {}; l9 = next((x for x in cart.get('items') or [] if x.get('optionId') == o9), {})
        rec('K-5 담은 뒤 값이 바뀌면 장바구니 줄에 「가격 변경」 표시(담을 때 35,100 → 현재 36,100)', l9.get('priceChanged') is True and l9.get('addedPrice') == 35100 and l9.get('price') == 36100, {k: l9.get(k) for k in ('priceChanged', 'addedPrice', 'price')})
        items = [{'productCode': 'p01', 'optionId': o9, 'qty': 1}, {'productCode': 'p01', 'optionId': o3, 'qty': 2}]
        st, e = call('POST', '/health/orders', TOK, {'addressId': addr, 'fromCart': True, 'items': items})
        rec('K-6 가격이 바뀐 줄이 있는데 확인(priceAck) 없이 주문하면 거절(PRICE_CHANGED) — 주문 · 장바구니 그대로', st == 409 and G(e, 'code') == 'PRICE_CHANGED' and len((call('GET', '/me/health/cart', TOK)[1] or {}).get('items') or []) == 2, (st, G(e, 'code')))
        s9 = int(q(f"select stock from hlt_product_options where id='{o9}'") or 0); s3 = int(q(f"select stock from hlt_product_options where id='{o3}'") or 0); sp = int(q("select stock from hlt_products where code='p01'") or 0)
        st, o = call('POST', '/health/orders', TOK, {'addressId': addr, 'fromCart': True, 'priceAck': True, 'items': items}); no = G(o, 'orderNo'); made_orders.append(no)
        rec('K-7 확인하고 주문 — 주문 금액 = 현재 값(36,100 + 29,400 = 65,500) · 품목에 옵션 이름 복사', st < 300 and G(o, 'total') in (65500, '65500') and sorted(r[0] for r in rows(f"select option_label from hlt_order_items i join hlt_orders o on o.id=i.order_id where o.order_no='{no}'")) == ['3개월 분', '9개월 분 2+1'], (st, G(o, 'total')))
        rec('K-8 재고는 옵션에서 줄고(9개월 −1 · 3개월 −2) 상품 재고(합)도 −3', int(q(f"select stock from hlt_product_options where id='{o9}'") or -9) == s9 - 1 and int(q(f"select stock from hlt_product_options where id='{o3}'") or -9) == s3 - 2 and int(q("select stock from hlt_products where code='p01'") or -9) == sp - 3,
            (s9, q(f"select stock from hlt_product_options where id='{o9}'"), s3, q(f"select stock from hlt_product_options where id='{o3}'"), sp, q("select stock from hlt_products where code='p01'")))
        st, mo = call('GET', f'/me/health/orders/{no}', TOK)
        rec('K-9 내 주문 상세의 품목에 옵션 이름', sorted(x.get('optionLabel') or '' for x in (mo or {}).get('items') or []) == ['3개월 분', '9개월 분 2+1'], [x.get('optionLabel') for x in (mo or {}).get('items') or []])
        sql(f"UPDATE hlt_product_options SET price = price - 1000 WHERE id = '{o9}'")
        # 취소 → 승인 → 옵션 재고 복원
        call('POST', '/me/health/returns', TOK, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        rid = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no}' and r.state='REQUESTED'")
        call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED', 'note': '시험 취소'})
        rec('K-10 취소 승인 — 옵션 재고가 한 번만 돌아옴(9개월 · 3개월 모두 처음 값)', int(q(f"select stock from hlt_product_options where id='{o9}'") or -9) == s9 and int(q(f"select stock from hlt_product_options where id='{o3}'") or -9) == s3, (q(f"select stock from hlt_product_options where id='{o9}'"), s9))
        # 품절 옵션
        p10 = call('GET', '/health/products/p10')[1] or {}; z = G(p10, 'options', 0, 'id')
        st, e = call('POST', '/me/health/cart', TOK, {'productCode': 'p10', 'optionId': z, 'qty': 1})
        # 앞 판과 같은 응답 모양(422 · 「남은 수량이 0개입니다 — 상품 이름」 · flow_mall M6) — 옵션 이름을 덧붙임
        rec('K-11 품절 옵션은 담기 거절(422 SOLD_OUT · 「남은 수량이 0개입니다 — 상품 이름 옵션 이름」)', st == 422 and G(e, 'code') == 'SOLD_OUT' and '남은 수량이 0개입니다' in (G(e, 'message') or '') and G(p10, 'name') in (G(e, 'message') or ''), (st, G(e, 'code'), G(e, 'message')))
        o10b = G(p10, 'options', 1, 'id'); st10 = int(q(f"select stock from hlt_product_options where id='{o10b}'") or 0)
        st, e = call('POST', '/health/orders', TOK, {'addressId': addr, 'items': [{'productCode': 'p10', 'optionId': o10b, 'qty': st10 + 1}]})
        rec('K-12 옵션 재고보다 많이 주문하면 DB 가 거절 — 주문 생기지 않음', st >= 400 and int(q(f"select stock from hlt_product_options where id='{o10b}'") or -1) == st10, (st, G(e, 'code')))
        call('PATCH', f'/me/health/cart/lines/{o9}', TOK, {'qty': 0})
        rec('K-13 장바구니 줄 수량 바꾸기 · 빼기는 옵션 단위(PATCH /me/health/cart/lines/{옵션})', not any(x.get('optionId') == o9 for x in (call('GET', '/me/health/cart', TOK)[1] or {}).get('items') or []), '')
        sql(f"DELETE FROM hlt_cart_items WHERE account_id='{aid}'")
    safe('K', K)

    # ── X 교환 배송비 ─────────────────────────────────────────────────────
    def X():
        p03 = call('GET', '/health/products/p03')[1] or {}; oo = G(p03, 'options', 1, 'id')
        sql(f"UPDATE hlt_product_options SET stock = GREATEST(stock, 12) WHERE id = '{oo}'")      # 시험 준비 — 배송 완료로 남는 시험 주문이 재고를 가져가므로 모자라면 채움(개발 DB)
        def delivered():
            st, o = call('POST', '/health/orders', TOK, {'addressId': addr, 'items': [{'productCode': 'p03', 'optionId': oo, 'qty': 1}]}); no = G(o, 'orderNo'); made_orders.append(no)
            call('POST', f'/health/orders/{no}/pay', TOK, {'method': 'CARD'}); call('POST', f'/health/orders/{no}/pay/confirm', TOK, {'paymentKey': 'stub_' + uuid.uuid4().hex[:12], 'amount': int(G(o, 'total') or 0)})
            sql(f"UPDATE hlt_orders SET status='DELIVERED', created_at=now()-interval '4 day', paid_at=now()-interval '3 day', shipped_at=now()-interval '2 day', delivered_at=now()-interval '1 day' WHERE order_no='{no}'")
            return no
        no = delivered()
        st, r = call('POST', '/me/health/returns', TOK, {'orderNo': no, 'kind': 'EXCHANGE', 'reason': 'CHANGE_MIND'}); rid = G(r, 'id')
        rec('X-1 고객 사정 교환 신청 — 교환 배송비 6,000 · 결제 전(feeState UNPAID)', st < 300 and G(r, 'exchangeFee') == 6000 and G(r, 'feeState') == 'UNPAID', (st, r))
        st, e = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED', 'note': '시험'})
        rec('X-2 교환 배송비를 내기 전에는 운영이 승인할 수 없음(FEE_UNPAID)', st == 409 and G(e, 'code') == 'FEE_UNPAID', (st, G(e, 'code')))
        st, pr = call('POST', f'/me/health/returns/{rid}/fee/pay', TOK, {'method': 'CARD'})
        st2, pc = call('POST', f'/me/health/returns/{rid}/fee/confirm', TOK, {'paymentKey': 'stub_' + uuid.uuid4().hex[:12], 'amount': 6000})
        rec('X-3 교환 배송비 결제(준비 → 승인 · 시험 결제) — 6,000원 PAID · 주문 상태는 그대로(배송 완료)', st < 300 and st2 < 300 and G(pc, 'state') == 'PAID' and q(f"select status from hlt_orders where order_no='{no}'") == 'DELIVERED', (st, st2, pc))
        st, e = call('POST', f'/me/health/returns/{rid}/fee/confirm', TOK, {'paymentKey': 'stub_x', 'amount': 5000})
        rec('X-4 금액이 다르면 승인하지 않음(AMOUNT_MISMATCH)', st >= 400, (st, G(e, 'code')))
        st, mo = call('GET', f'/me/health/orders/{no}', TOK)
        rec('X-5 내 주문 상세에 교환 진행 표시(exchange — 접수 · 비용 결제됨)', G(mo, 'exchange', 'state') == 'REQUESTED' and G(mo, 'exchange', 'feeState') == 'PAID', G(mo, 'exchange'))
        st, d = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED', 'note': '시험 승인'})
        rec('X-6 비용을 낸 뒤 운영 승인 — 승인 · 환불 없음 · 재고 · 주문 그대로', st < 300 and q(f"select state from hlt_returns where id='{rid}'") == 'APPROVED' and q(f"select status from hlt_orders where order_no='{no}'") == 'DELIVERED', (st, G(d, 'code')))
        # 반려하면 비용 환불
        no2 = delivered(); r2 = G(call('POST', '/me/health/returns', TOK, {'orderNo': no2, 'kind': 'EXCHANGE', 'reason': 'WRONG_ORDER'})[1], 'id')
        call('POST', f'/me/health/returns/{r2}/fee/pay', TOK, {'method': 'CARD'}); call('POST', f'/me/health/returns/{r2}/fee/confirm', TOK, {'paymentKey': 'stub_' + uuid.uuid4().hex[:12], 'amount': 6000})
        st, _ = call('POST', f'/admin/health/returns/{r2}/decide', ADM, {'state': 'REJECTED', 'note': '시험 반려'})
        rec('X-7 반려하면 낸 교환 배송비 6,000원을 돌려줌(REFUNDED)', st < 300 and q(f"select state from hlt_exchange_fees where return_id='{r2}' order by created_at desc limit 1") == 'REFUNDED', (st, q(f"select state from hlt_exchange_fees where return_id='{r2}'")))
        # 판매자 사정 — 비용 없음
        no3 = delivered(); st, r3 = call('POST', '/me/health/returns', TOK, {'orderNo': no3, 'kind': 'EXCHANGE', 'reason': 'DEFECT', 'detail': '시험 — 파손'})
        rec('X-8 판매자 사정 교환 — 비용 0 · 결제 없이 승인 가능', G(r3, 'exchangeFee') == 0 and G(r3, 'feeState') == 'NONE' and call('POST', f"/admin/health/returns/{G(r3, 'id')}/decide", ADM, {'state': 'APPROVED', 'note': '시험'})[0] < 300, r3)
        # 운영이 판매자 사정으로 판정 → 낸 비용 환불
        no4 = delivered(); r4 = G(call('POST', '/me/health/returns', TOK, {'orderNo': no4, 'kind': 'EXCHANGE', 'reason': 'CHANGE_MIND'})[1], 'id')
        call('POST', f'/me/health/returns/{r4}/fee/pay', TOK, {'method': 'CARD'}); call('POST', f'/me/health/returns/{r4}/fee/confirm', TOK, {'paymentKey': 'stub_' + uuid.uuid4().hex[:12], 'amount': 6000})
        st, _ = call('POST', f'/admin/health/returns/{r4}/decide', ADM, {'state': 'APPROVED', 'note': '확인해 보니 불량', 'sellerFault': True})
        rec('X-9 운영이 「판매자 사정」으로 판정해 승인 — 낸 6,000원 환불', st < 300 and q(f"select state from hlt_exchange_fees where return_id='{r4}' order by created_at desc limit 1") == 'REFUNDED', (st, q(f"select state from hlt_exchange_fees where return_id='{r4}'")))
        # 재고가 없어 반품으로 바꿈(14일 규칙 — 운영이 처리)
        no5 = delivered(); r5 = G(call('POST', '/me/health/returns', TOK, {'orderNo': no5, 'kind': 'EXCHANGE', 'reason': 'CHANGE_MIND'})[1], 'id')
        call('POST', f'/me/health/returns/{r5}/fee/pay', TOK, {'method': 'CARD'}); call('POST', f'/me/health/returns/{r5}/fee/confirm', TOK, {'paymentKey': 'stub_' + uuid.uuid4().hex[:12], 'amount': 6000})
        st, cv = call('POST', f'/admin/health/returns/{r5}/convert', ADM, {'note': '재고 없음 — 14일 안에 입고되지 않음'})
        rec('X-10 교환할 재고가 없어 반품으로 바꿈 — 교환 신청은 닫히고 반품 신청이 생김 · 교환 배송비 환불', st < 300 and q(f"select state from hlt_exchange_fees where return_id='{r5}' order by created_at desc limit 1") == 'REFUNDED'
            and q(f"select count(*) from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no5}' and r.kind='RETURN' and r.state='REQUESTED'") == '1', (st, cv))
        # 10/8 답 「빼지 않음」 — 재고가 없어 바꾼 반품은 회사 사정이라 반품 배송비를 빼지 않고 전액 환불(약관 1.2 제3조 ③)
        nr = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no5}' and r.kind='RETURN' and r.state='REQUESTED'")
        paid5 = int(q(f"select total from hlt_orders where order_no='{no5}'") or 0)
        st, dj = call('POST', f'/admin/health/returns/{nr}/decide', ADM, {'state': 'APPROVED', 'opened': False})
        rec('X-12 바꾼 반품을 승인하면 반품 배송비를 빼지 않고 전액 환불(차감 0 · 환불 = 결제 금액)', st < 300 and q(f"select state||'|'||refund_amount||'|'||ship_deduction from hlt_returns where id='{nr}'") == f'REFUNDED|{paid5}|0', (st, q(f"select state||'|'||refund_amount||'|'||ship_deduction from hlt_returns where id='{nr}'"), paid5, G(dj, 'note')))
        rec('X-11 교환 배송비는 「교환 + 고객 사정」에만(DB 규칙) — 반품 신청에 교환 비용을 적으면 막힘', bool(fl.sql(f"BEGIN; UPDATE hlt_returns SET exchange_fee=6000 WHERE kind='RETURN' AND id=(select id from hlt_returns where kind='RETURN' limit 1); ROLLBACK;")[1]), '')
        # 뒷정리 — 교환 주문들은 배송 완료로 둠(시험 계정)
    safe('X', X)

    # ── A 운영 상품 관리 ──────────────────────────────────────────────────
    def A():
        st, ls = call('GET', '/admin/health/products', ADM)
        rec('A-1 운영 상품 목록(모든 상태 · 옵션 · 재고 합)', st == 200 and len(G(ls, 'items') or []) >= 25, (st, len(G(ls, 'items') or [])))
        st, _ = call('GET', '/admin/health/products', TOK)
        rec('A-2 일반 회원은 운영 상품 목록을 볼 수 없음(403)', st in (401, 403), st)
        code = 'OPTTEST-' + uuid.uuid4().hex[:5].upper()
        st, c = call('POST', '/admin/health/products', ADM, {'code': code, 'name': '시험 오메가3 1000', 'categoryCode': 'HLT_FOOD', 'summary': '시험 상품', 'listPrice': 30000,
                                                              'mainIngredient': {'code': 'OMEGA3', 'amount': '1,000mg'}, 'options': [{'months': 3, 'price': 21000, 'stock': 5, 'tag': ''}, {'months': 1, 'price': 9000, 'stock': 3}]})
        rec('A-3 상품 등록 — 초안(DRAFT)으로 만들어짐 · 옵션 2개 · 대표 판매가 9,000(1개월)', st < 300 and G(c, 'status') == 'DRAFT' and q(f"select price from hlt_products where code='{code}'") == '9000' and q(f"select count(*) from hlt_product_options o join hlt_products p on p.id=o.product_id where p.code='{code}'") == '2', (st, c))
        st, e = call('GET', f'/health/products/{code}')
        rec('A-4 초안은 손님에게 보이지 않음', st in (404, 409), st)
        st, e = call('PATCH', f'/admin/health/products/{code}', ADM, {'name': '시험 오메가3 완치 1000'})
        rec('A-5 금지 표현(「완치」 등)이 든 이름은 저장되지 않음', st in (400, 409, 422) and q(f"select name from hlt_products where code='{code}'") == '시험 오메가3 1000', (st, G(e, 'code')))
        st, s = call('POST', f'/admin/health/products/{code}/status', ADM, {'status': 'ON_SALE'})
        rec('A-6 판매 시작 — 손님 목록에 보임', st < 300 and code in [x.get('code') for x in (call('GET', '/health/products?keyword=' + quote('시험 오메가3'))[1] or [])], (st, G(s, 'code')))
        oid = q(f"select o.id from hlt_product_options o join hlt_products p on p.id=o.product_id where p.code='{code}' and o.months=1")
        st, _ = call('PATCH', f'/admin/health/products/{code}/options/{oid}', ADM, {'price': 9500, 'stock': 7})
        h = rows(f"select field, before, after from hlt_product_history h join hlt_products p on p.id=h.product_id where p.code='{code}' order by h.created_at")
        rec('A-7 옵션 값 · 재고를 바꾸면 변경 기록(누가 · 언제 · 전 → 뒤) · 대표 판매가도 따라 바뀜', st < 300 and ['option.price', '9000', '9500'] in h and ['option.stock', '3', '7'] in h and q(f"select price from hlt_products where code='{code}'") == '9500', (st, h[-4:]))
        st, hs = call('GET', f'/admin/health/products/{code}/history', ADM)
        rec('A-8 변경 기록 조회(운영 화면 「변경 기록」)', st == 200 and len(hs or []) >= 2, (st, len(hs or [])))
        st, e = call('POST', '/admin/health/products', ADM, {'code': code + 'X', 'name': '잠긴 갈래 시험', 'categoryCode': 'HLT_FUNC', 'options': [{'months': 1, 'price': 1000, 'stock': 1}]})
        st2, e2 = call('POST', f"/admin/health/products/{code + 'X'}/status", ADM, {'status': 'ON_SALE'})
        rec('A-9 잠긴 갈래(건강기능식품) 상품은 판매 중으로 바꿀 수 없음(DB 규칙 그대로)', st2 >= 400 and q(f"select status from hlt_products where code='{code}X'") in ('DRAFT', ''), (st, st2, G(e2, 'message')))
        call('POST', f"/admin/health/products/{code + 'X'}/status", ADM, {'status': 'STOPPED'})   # 정리 — 잠긴 갈래의 시험 상품은 판매 중지로(srv_mall L-4 는 그 갈래 상품이 모두 STOPPED 인지 봄)
        st, _ = call('POST', f'/admin/health/products/{code}/options', ADM, {'months': 6, 'price': 39000, 'stock': 2, 'tag': '1+1'})
        rec('A-10 옵션 더하기', st < 300 and q(f"select count(*) from hlt_product_options o join hlt_products p on p.id=o.product_id where p.code='{code}'") == '3', st)
        st, _ = call('PATCH', f'/admin/health/products/{code}/options/{oid}', ADM, {'active': False})
        rec('A-11 옵션 끄기(주문 기록이 있어도 지우지 않고 끔) — 손님 상세에서 빠짐', st < 300 and oid not in [o.get('id') for o in (call('GET', f'/health/products/{code}')[1] or {}).get('options') or []], st)
        st, _ = call('POST', f'/admin/health/products/{code}/status', ADM, {'status': 'STOPPED'})
        rec('A-12 판매 중지 — 손님에게 보이지 않음', st < 300 and call('GET', f'/health/products/{code}')[0] in (404, 409), st)
        st, ig = call('GET', '/admin/health/ingredients', ADM)
        rec('A-13 운영 성분 목록', st == 200 and len(ig or []) >= 26, (st, len(ig or [])))
        st, _ = call('PATCH', '/admin/health/ingredients/MAGNE', ADM, {'featured': True})
        rec('A-14 「많이 찾는 성분」 켜기 → 손님 성분 목록에 반영', st < 300 and G({x['code']: x for x in call('GET', '/health/ingredients')[1] or []}, 'MAGNE', 'featured') is True, st)
        call('PATCH', '/admin/health/ingredients/MAGNE', ADM, {'featured': False})
        st, sc = call('GET', '/admin/health/sale-categories', ADM)
        rec('A-15 운영 갈래 · 판매 범위 조회(화장품 열림 · 건강기능식품 잠김)', st == 200 and {x.get('code'): x.get('state') for x in sc or []}.get('HLT_COSMETIC') == 'OPEN', (st, sc))
    safe('A', A)

    # ── T 약관 ───────────────────────────────────────────────────────────
    def T():
        st, t = call('GET', '/terms/doc/HLT_SALE'); b = (t or {}).get('body') or ''
        # 이미 발행된 DB 는 「지금 판의 다음 번호」가 새로 발행되고(개발 DB 1.1 → 1.2 · Docker 의 쓰던 볼륨 1.0 → 1.1), 새로 설치한 DB 는 1.0 초안에 들어간 채 발행됩니다(D014 · D024 와 같은 방식)
        pub = q("select version from terms where code='HLT_SALE' and status='PUBLISHED' order by split_part(version,'.',1)::int desc, split_part(version,'.',2)::int desc limit 1")
        top = q("select version from terms where code='HLT_SALE' order by split_part(version,'.',1)::int desc, split_part(version,'.',2)::int desc limit 1")
        rec('T-1 판매 약관 새 판(발행된 판 = 가장 새 번호) — 제3조 「반품 · 교환 비용」 · 회원 사정 교환 6,000원 신청 때 결제 · 반려/회사 사정이면 전액 돌려드림 · 재고 없으면 14일 · 그때 반품 배송비를 빼지 않음',
            (t or {}).get('version') == pub == top and '반품 · 교환 비용' in b and '교환을 신청하실 때 결제' in b and '14일' in b and '반품 배송비를 빼지 않고' in b and '교환 배송비 6,000원 신청 때 결제' in b, ((t or {}).get('version'), pub, top, len(b)))
        rec('T-2 앞 판은 모두 보관 · 발행된 판은 하나', q("select count(*) from terms where code='HLT_SALE' and status='PUBLISHED'") == '1' and q(f"select count(*) from terms where code='HLT_SALE' and version <> '{pub}' and status <> 'ARCHIVED'") == '0', q("select string_agg(version||':'||status, ',' order by version) from terms where code='HLT_SALE'"))
    safe('T', T)

    # ── Z 뒷정리 ──────────────────────────────────────────────────────────
    for no in made_orders:
        if not no: continue
        if q(f"select status from hlt_orders where order_no='{no}'") == 'PENDING':
            call('POST', '/me/health/returns', TOK, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
            rid = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no}' and r.state='REQUESTED'")
            if rid: call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED', 'note': '시험 정리'})
    sql(f"DELETE FROM hlt_cart_items WHERE account_id='{aid}'")
    sql("UPDATE hlt_products SET status = 'STOPPED' WHERE code LIKE 'OPTTEST-%' AND status <> 'STOPPED'")   # 시험 상품은 지울 수 없어(주문 기록 · 변경 기록) 판매 중지로 남김
    json.dump(R, open(f'{HERE}/srv_opt.json', 'w'), ensure_ascii=False, indent=1)
    bad = [r['step'].split(' ')[0] for r in R if not r['ok']]
    print(f"통과 {len(R) - len(bad)} / {len(R)}" + (f" · 실패 {len(bad)}: {' '.join(bad[:40])}" if bad else ''))


if __name__ == '__main__':
    main()
