"""v10.25 소개몰 — 서버(API · DB) 점검. 결과: srv_mall.json

  10/8 확정 — 시안을 기준으로 · 4판으로 나눔. v10.25 서버분:
    ① 관 이름 「소개몰」 · 약관 3종의 관 이름 · 직판 고지 문구 (D024)
    ② 배송비 — 시안 값 「전 상품 무료」(전에는 3만원 이상 무료 · 미만 3,000원). 반품 왕복 6,000원은 그대로
    ③ 취급 갈래 — 시안 값: 의료기기는 판매하지 않음 · 건강기능식품은 잠금(신고 뒤에 엶) (D025)
       회원 간 도매 · 납품 매물의 규칙(restricted_industries)은 건드리지 않음

  N. 이름 · 약관 · 고지      S. 배송비      L. 취급 갈래(잠금 · 미판매)      K. 그대로인 것      E. 등록부 · 고정 SQL
사용:  python3 srv_mall.py        API=http://localhost:3000 · DB=postgresql://…/sgb · KIT=킷의 sgb 폴더
  시험 주문 1건은 끝에 취소 · 승인해 재고를 되돌립니다.
"""
import json, os, re, subprocess, sys, uuid
from detail_fixture import call, q, DB, login

OUT = os.path.dirname(os.path.abspath(__file__))
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:260], file=sys.stderr)

def rows(sql):
    p = subprocess.run(['psql', DB, '-tA', '-F', '\t', '-c', sql], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:300]
    return [l.split('\t') for l in p.stdout.strip().split('\n') if l]

def psql_err(sql):
    """되돌리는 거래 안에서 돌려 보고 오류 글만 받습니다(자료는 바뀌지 않음)"""
    p = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', 'BEGIN; ' + sql + '; ROLLBACK;'], capture_output=True, text=True)
    return p.stderr.strip()


def main():
    BUY = login('buyer@x.com'); ADM = login('admin@x.com')

    # ── N ── 이름 · 약관 · 고지
    st, g = call('GET', '/gwans'); hlt = next((x for x in (g or []) if x.get('code') == 'HLT'), {})
    rec('N-1 관 이름이 「소개몰」(GET /gwans)', st == 200 and hlt.get('name') == '소개몰', hlt.get('name'))
    tx = {c: call('GET', '/terms/doc/' + c)[1] or {} for c in ('HLT_SALE', 'SERVICE', 'THIRDPARTY')}
    old = {c: [w for w in ('소개머니', '건강상품관', '건강몰', '소개뱅크몰') if w in (t.get('body') or '')] for c, t in tx.items()}
    rec('N-2 약관 3종 본문에 옛 이름이 없음 · 판매 약관 「소개장터 · 안심소개 · 소개창업 회사는 중개만 …」 · 이용약관 「소개몰(직판)」',
        not any(old.values()) and '소개장터 · 안심소개 · 소개창업 회사는 중개만' in (tx['HLT_SALE'].get('body') or '') and '소개몰(직판)' in (tx['SERVICE'].get('body') or '') and '소개광장 · 소개몰' in (tx['THIRDPARTY'].get('body') or ''), old)
    _, pub = call('GET', '/site-settings/public'); dn = (pub or {}).get('legal.direct_notice') or ''
    rec('N-3 직판 고지 문구가 공개 설정으로 내려오고 이름이 「소개몰」', '소개몰에서 판매하는 상품은 소개뱅크가 직접 판매' in dn and '건강상품관' not in dn, dn[:80])
    syn = {r[0]: r[1] for r in rows("select term, canonical from search_synonyms where kind='GWAN'")}
    rec('N-4 검색 사전 — 「소개뱅크몰」 「소개쇼핑몰」 「건강몰」 → 소개몰 · 「소개몰 → 안심소개」 줄은 없음', syn.get('소개뱅크몰') == '소개몰' and syn.get('소개쇼핑몰') == '소개몰' and syn.get('건강몰') == '소개몰' and '소개몰' not in syn, {k: v for k, v in syn.items() if '몰' in k or '몰' in v})

    # ── S ── 배송비: 전 상품 무료
    st, addrs = call('GET', '/me/health/addresses', BUY)
    if not addrs:
        call('POST', '/me/health/addresses', BUY, {'receiver': '검증', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'}); st, addrs = call('GET', '/me/health/addresses', BUY)
    addr = next((a for a in addrs if a.get('isDefault')), addrs[0])['id']
    cheap = rows("select code, price, stock from hlt_products where status='ON_SALE' and stock>=2 and price < 30000 and (select count(*) from hlt_product_options o where o.product_id=hlt_products.id and o.is_active)=1 order by price limit 1")
    rec('S-0 (준비) 3만원 미만이면서 재고가 있는 판매 중 상품이 있음', bool(cheap), cheap)
    code, price, s0 = (cheap[0][0], int(cheap[0][1]), int(cheap[0][2])) if cheap else ('X', 0, 0)
    st, o = call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': code, 'qty': 1}]}); o = o if isinstance(o, dict) else {}
    rec(f'S-1 3만원 미만 주문({code} {price:,}원 × 1) — 배송비 0 · 결제 금액 = 상품 금액(전에는 + 3,000원)', st < 300 and o.get('shipFee') == 0 and int(o.get('total', -1)) == price, (st, {k: o.get(k) for k in ('shipFee', 'total', 'note')}))
    rec('S-1b 주문 응답의 안내 글이 「3만원」을 말하지 않음', st < 300 and '3만원' not in (o.get('note') or ''), o.get('note'))
    no = o.get('orderNo')
    dbo = rows(f"select goods_amount, ship_fee, total from hlt_orders where order_no='{no}'") if no else []
    rec('S-2 DB 의 주문 — ship_fee 0 · total = goods_amount', bool(dbo) and dbo[0][1] == '0' and dbo[0][0] == dbo[0][2], dbo)
    st, od = call('GET', f'/me/health/orders/{no}', BUY) if no else (0, {}); od = od if isinstance(od, dict) else {}
    rs = od.get('returnShip') or {}
    # v10.27 (G-184) — 결제 전 주문은 낸 돈이 없어 환불 예상액 0 · 「결제 전」. 반품 차감은 시험 결제(스텁)를 마친 뒤 봅니다
    rec('S-3a 결제 전 주문 — 환불 기준 금액 0 · paid false(G-184)', st == 200 and rs.get('paid') is False and rs.get('paidAmount') == 0 and rs.get('customerRefundEstimate') == 0, rs)
    if no:
        st_p, _ = call('POST', f'/health/orders/{no}/pay', BUY, {'method': 'CARD'})
        st_c, _ = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': int(o.get('total', 0))})
        st, od = call('GET', f'/me/health/orders/{no}', BUY); od = od if isinstance(od, dict) else {}
        rs = od.get('returnShip') or {}
    rec('S-3 반품 왕복 배송비는 6,000원 그대로 — 고객 사정 반품의 환불 예상액 = 결제 금액 − 6,000원', st == 200 and rs.get('roundTripFee') == 6000 and rs.get('customerRefundEstimate') == max(0, price - 6000), rs)
    call('POST', '/me/health/cart', BUY, {'productCode': code, 'qty': 1}); st, cart = call('GET', '/me/health/cart', BUY); cart = cart if isinstance(cart, dict) else {}
    rec('S-4 장바구니 요약 — 배송비 0 · 합계 = 상품 금액 · 안내 글에 「3만원」 「더 담으시면」 없음', st == 200 and cart.get('shipFee') == 0 and cart.get('total') == cart.get('goods') and not re.search('3만원|더 담으시면', cart.get('note') or ''), {k: cart.get(k) for k in ('goods', 'shipFee', 'total', 'note')})
    call('PATCH', f'/me/health/cart/{code}', BUY, {'qty': 0})
    body = tx['HLT_SALE'].get('body') or ''
    rec('S-5 판매 약관 — 「배송비는 받지 않습니다」가 있고 「3만원」 「배송비를 내신 주문」이 없음 · 왕복 6,000원 조항은 그대로', '배송비는 받지 않습니다' in body and '3만원' not in body and '배송비를 내신 주문' not in body and '왕복 배송비 6,000원' in body, [l for l in body.split('\n') if '배송비' in l][:6])
    src = open(os.path.join(KIT, 'src/modules/health/health-policy.ts'), encoding='utf-8').read()
    rec('S-6 정책 파일 — 왕복 반품 배송비를 「편도 배송비 × 2」로 계산하지 않음(배송비가 0 이 되어도 6,000원이 유지되게)', 'HLT_SHIP_FEE * 2' not in src and re.search(r'HLT_RETURN_SHIP_ROUND_TRIP\s*=\s*6000', src) is not None, re.findall(r'export const HLT_\w+ = [^;]+;', src))
    # 시험 주문은 취소 · 승인해 재고를 되돌립니다
    if no:
        st, r = call('POST', '/me/health/returns', BUY, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        if st < 300: call('POST', f"/admin/health/returns/{r['id']}/decide", ADM, {'state': 'APPROVED', 'note': '시험 주문 정리'})
    rec('S-9 (정리) 시험 주문을 취소해 재고가 처음과 같음', int(q(f"select stock from hlt_products where code='{code}'") or -1) == s0, (s0, q(f"select stock from hlt_products where code='{code}'")))

    # ── L ── 취급 갈래: 의료기기 미판매 · 건강기능식품 잠금
    st, cats = call('GET', '/health/categories'); cats = cats if isinstance(cats, list) else []
    by = {c.get('code'): c for c in cats}
    rec('L-1 GET /health/categories → 200 · 줄마다 code · name · state · note · productCount', st == 200 and cats and all(set(c) == {'code', 'name', 'state', 'note', 'productCount'} for c in cats), (st, cats[:2]))
    rec('L-2 건강식품 = 열림(OPEN) · 건강기능식품 = 잠금(LOCKED · 안내 글 있음) · 의료기기 = 판매하지 않음(NOT_SOLD · 안내 글 있음)',
        (by.get('HLT_FOOD') or {}).get('state') == 'OPEN' and (by.get('HLT_FUNC') or {}).get('state') == 'LOCKED' and bool((by.get('HLT_FUNC') or {}).get('note')) and (by.get('HLT_MEDDEV') or {}).get('state') == 'NOT_SOLD' and bool((by.get('HLT_MEDDEV') or {}).get('note')), {k: (v.get('state'), v.get('note')) for k, v in by.items()})
    rec('L-2b 잠금 · 미판매 갈래의 상품 수는 0 · 열린 갈래의 상품 수는 DB 의 판매 중(품절 포함) 수와 같음',
        all(c['productCount'] == 0 for c in cats if c['state'] != 'OPEN') and all(c['productCount'] == int(q(f"select count(*) from hlt_products p join categories c on c.id=p.category_id where c.code='{c['code']}' and p.status in ('ON_SALE','SOLD_OUT')")) for c in cats if c['state'] == 'OPEN'), [(c['code'], c['productCount']) for c in cats])
    st, prods = call('GET', '/health/products'); prods = prods if isinstance(prods, list) else []
    closed = [p['code'] for p in prods if p.get('categoryCode') in ('HLT_FUNC', 'HLT_MEDDEV')]
    rec('L-3 상품 목록에 건강기능식품 · 의료기기 상품이 없음', st == 200 and prods and not closed, closed)
    locked = rows("select p.code, p.status, c.code from hlt_products p join categories c on c.id=p.category_id where c.code in ('HLT_FUNC','HLT_MEDDEV') order by 1")
    rec('L-4 DB — 건강기능식품 · 의료기기 상품은 모두 판매 중지(STOPPED) · 지우지 않음', bool(locked) and all(r[1] == 'STOPPED' for r in locked), locked)
    lc = locked[0][0] if locked else 'VITD-90'
    st, d = call('GET', f'/health/products/{lc}')
    rec(f'L-5 잠긴 갈래의 상품 상세({lc}) — 200 이 아님(판매 중인 상품이 아닙니다)', st in (404, 409), (st, d))
    st, d = call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': lc, 'qty': 1}]})
    rec(f'L-6 잠긴 갈래의 상품 주문({lc}) — 거절(주문이 생기지 않음)', st in (409, 422) and (d or {}).get('code') == 'NOT_ON_SALE', (st, d))
    if st < 300 and isinstance(d, dict) and d.get('orderNo'):        # 거절되지 않고 주문이 생겼으면(= 실패) 그 주문은 취소해 재고를 되돌립니다
        st_, r_ = call('POST', '/me/health/returns', BUY, {'orderNo': d['orderNo'], 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        if st_ < 300: call('POST', f"/admin/health/returns/{r_['id']}/decide", ADM, {'state': 'APPROVED', 'note': '시험 주문 정리'})
    e1 = psql_err(f"update hlt_products set status='ON_SALE' where code='{lc}'")
    rec('L-7 DB 규칙 — 잠긴 갈래의 상품을 「판매 중」으로 바꾸면 거절(HLTP)', 'HLTP' in e1, e1[:160])
    fc = rows("select p.code from hlt_products p join categories c on c.id=p.category_id where c.code='HLT_FOOD' limit 1")
    e2 = psql_err(f"update hlt_products set status='ON_SALE' where code='{fc[0][0]}'") if fc else 'no food product'
    rec('L-7b 열린 갈래(건강식품)의 상품은 「판매 중」으로 둘 수 있음', e2 == '', e2[:160])
    st, ings = call('GET', '/health/ingredients'); ings = ings if isinstance(ings, list) else []
    truth = {r[0]: int(r[1]) for r in rows("select pi.ingredient_code, count(distinct p.id) from hlt_product_ingredients pi join hlt_products p on p.id=pi.product_id and p.status in ('ON_SALE','SOLD_OUT') group by 1")}
    # v10.26 (D027) — 성분군(군)의 상품 수는 아래 성분의 상품을 모은 값이라 낱 성분만 견줍니다(군은 srv_opt I-7)
    ings = [i for i in ings if not i.get('isGroup')]
    rec('L-8 성분 목록의 상품 수가 판매 중 상품만 센 값과 같음(잠긴 갈래의 상품은 세지 않음 · 성분군 제외)', st == 200 and all(i['productCount'] == truth.get(i['code'], 0) for i in ings), [(i['code'], i['productCount'], truth.get(i['code'], 0)) for i in ings if i['productCount'] != truth.get(i['code'], 0)])

    # ── K ── 그대로인 것 — 회원 간 도매 · 납품 매물의 규칙
    ri = {r[0]: r[1] for r in rows("select code, mode from restricted_industries where gwan_code='HLT'")}
    rec('K-1 매물 등록 규칙(restricted_industries · HLT)은 그대로 — 의료기기 = 심의필(GATED) · 의약품 · 의료 서비스 = 금지(BLOCK)', ri == {'MEDDEV': 'GATED', 'MEDICAL': 'BLOCK', 'PHARM': 'BLOCK'}, ri)
    rec('K-2 판매불가 매물 노출 0(v_hlt_sale_violation)', q('select count(*) from v_hlt_sale_violation') == '0', q('select count(*) from v_hlt_sale_violation'))
    rec('K-3 결제 전 주문 · 지난 주문은 그대로 — 주문 품목이 가리키는 상품이 모두 남아 있음', q('select count(*) from hlt_order_items i left join hlt_products p on p.id=i.product_id where p.id is null') == '0')
    # K-4 · K-5 — 10/8 확정: 의료기기는 팔지 않습니다 → 청약철회 규칙의 이름에서도 뺍니다 / 시안의 이용안내에 싣는 약관 전문이 DB 의 지금 약관과 같은 글
    lab = q("select label from withdrawal_rules where code = 'DEVICE'")
    rec('K-4 청약철회 규칙 DEVICE 의 이름에 「의료기기」가 없음(건강기기) — 팔지 않는 품목을 규칙 이름에 두지 않음', '의료기기' not in lab and '건강기기' in lab, lab)
    snap = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hlt_sale_terms.md'), encoding='utf-8').read().strip() if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hlt_sale_terms.md')) else None
    cur = subprocess.run(['psql', DB, '-tA', '-c', "select body from terms where code = 'HLT_SALE' and status = 'PUBLISHED' order by effective_from desc limit 1"], capture_output=True, text=True).stdout.strip()
    # v10.28 — 시행일 줄의 날짜는 DB 마다 다름(그 DB 에서 발행한 날 · 개발 Docker 볼륨은 10/1) — D041 의 fn_term_body_norm 과 같게 날짜만 맞춰 견줌
    _nd = lambda t: re.sub(r'시행일 ([0-9]{4}년 [0-9]{1,2}월 [0-9]{1,2}일|[0-9]{4}-[0-9]{2}-[0-9]{2}|〔시행일〕)', '시행일 〔시행일〕', t or '')
    cur, snap = (_nd(cur), _nd(snap) if snap is not None else None)
    rec('K-5 시안의 이용안내에 싣는 판매 약관 전문(qa/hlt_sale_terms.md)이 DB 의 지금 약관(HLT_SALE · 게시 중)과 같은 글(시행일 날짜만 다를 수 있음)', snap is not None and cur == snap, (len(cur), len(snap or ''), [x for x in zip(cur.split('\n'), (snap or '').split('\n')) if x[0] != x[1]][:2]))

    # ── E ── 등록부 · 고정 SQL
    sc = json.load(open(os.path.join(KIT, 'spec/screens.json'), encoding='utf-8')); scr = sc if isinstance(sc, list) else sc.get('screens', [])
    used = [s['id'] for s in scr if 'GET /health/categories' in (s.get('apis') or [])]
    rec('E-1 새 API(GET /health/categories)가 화면 등록부에 연결됨', bool(used), used)
    svc = open(os.path.join(KIT, 'src/modules/health/health-catalog.service.ts'), encoding='utf-8').read()   # v10.86 — health-shop.service 에서 나눔
    i = svc.find('categories()'); seg = svc[i:i + 1400] if i > 0 else ''
    rec('E-2 새 조회의 SQL 이 고정 문자열(끼워 넣기 없음)', i > 0 and '${' not in seg.split('\n  }')[0], seg[:120])

    json.dump(R, open(os.path.join(OUT, 'srv_mall.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    bad = [r for r in R if not r['ok']]
    print(f'통과 {len(R) - len(bad)} / {len(R)}')


if __name__ == '__main__':
    try: main()
    except Exception as e:
        import traceback; traceback.print_exc(); print(f'통과 {len([r for r in R if r["ok"]])} / {len(R)} 에서 멈춤 — {type(e).__name__}: {str(e)[:160]}')
