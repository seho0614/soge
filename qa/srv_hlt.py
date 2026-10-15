"""소개뱅크몰 서버 기능 검증 (hlt, D002_health_catalog_stock).

  API=http://localhost:3012/api/v1 python3 srv_hlt.py     (기본 3000)

1. 취소 승인 → 재고가 **한 번만** 되돌아감 · 반려 사유 필수 · 권한
2. 청약철회 판정 (발송 후 취소 불가 · 발송 전 반품 불가 · 기간 밖 반품 거절 · 하자는 3개월)
3. 배송지 기본 변경 · 삭제 (진행 중 주문 차단 · 지난 주문 소프트 삭제 · 기본 1개)
4. 성분 · 고민 API · 상품 필터 · soldOut/categoryCode
"""
import json, os, sys, uuid, subprocess, urllib.request, urllib.parse
B = os.environ.get('API') or (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000/api/v1')
DB = os.environ.get('DATABASE_URL', 'postgresql://sgb:sgb@localhost:5432/sgb')
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []


def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request(B + p, method=m, data=data, headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:200]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:140], file=sys.stderr)


login = lambda e, pw='sgb-dev-1234': call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']
ADM = login('admin@x.com'); BUY = login('buyer@x.com'); INT = login('intro@x.com')
stock = lambda code: int(q(f"select stock from hlt_products where code='{code}'"))
oid = lambda no: q(f"select id from hlt_orders where order_no='{no}'")

# 준비 — buyer 배송지 (없으면 추가)
st, addrs = call('GET', '/me/health/addresses', BUY)
if not addrs:
    call('POST', '/me/health/addresses', BUY, {'receiver': '검증', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
    st, addrs = call('GET', '/me/health/addresses', BUY)
ADDR = next(a for a in addrs if a['isDefault'])['id']
PROD = q("select code from hlt_products where status='ON_SALE' and stock>=5 and (select count(*) from hlt_product_options o where o.product_id=hlt_products.id and o.is_active)=1 order by stock desc limit 1")


def new_order(qty=2, addr=None):
    st, o = call('POST', '/health/orders', BUY, {'addressId': addr or ADDR, 'items': [{'productCode': PROD, 'qty': qty}]})
    assert st < 300, (st, o)
    return o['orderNo']


# ── 1. 취소 → 승인 → 재고 한 번 ─────────────────────────────────────
s0 = stock(PROD)
no = new_order(2)
rec('1a 주문 시 재고 차감', stock(PROD) == s0 - 2, f'{s0}->{stock(PROD)}')
st, r = call('POST', '/me/health/returns', BUY, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
rec('1b 발송 전 취소 신청 접수', st < 300 and r['state'] == 'REQUESTED', (st, r))
rid = r['id']
st, lst = call('GET', '/admin/health/returns', ADM)
rec('1c 운영 목록에 접수 건이 보임', st == 200 and any(x['id'] == rid for x in lst), st)
st, j = call('GET', '/admin/health/returns', BUY)
rec('1d 고객은 운영 목록 불가(403)', st == 403, st)
st, j = call('POST', f'/admin/health/returns/{rid}/decide', BUY, {'state': 'APPROVED'})
rec('1e 고객은 승인 불가(403)', st == 403, st)
st, j = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'MAYBE'})
rec('1f 상태 형식 오류 400', st == 400, st)
st, j = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'REJECTED'})
rec('1g 반려는 사유 필수(422)', st == 422 and j['code'] == 'NOTE_REQUIRED', (st, j))
st, j = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED', 'note': '발송 전 취소'})
rec('1h 승인 → 주문 CANCELED · restockedAt', st < 300 and j['orderStatus'] == 'CANCELED' and j['restockedAt'], (st, j))
rec('1i 재고가 원래대로 (한 번)', stock(PROD) == s0, f'{s0} now {stock(PROD)}')
st, j = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED'})
rec('1j 같은 신청 재승인 409', st == 409 and j['code'] == 'ALREADY_DECIDED', (st, j))
# 결제 취소 트리거 · 직접 상태 갱신으로 또 되돌리려 해도 재고 그대로
o = oid(no)
q(f"insert into hlt_payments(order_id,method,amount,state) select id,'CARD',total,'CANCELED' from hlt_orders where id='{o}'")
q(f"update hlt_orders set status='CANCELED' where id='{o}'")
rec('1k 결제 취소·재갱신에도 재고 두 번 안 돌아옴', stock(PROD) == s0, stock(PROD))
err = subprocess.run(['psql', DB, '-tAc', f"update hlt_orders set status='PAID' where id='{o}'"], capture_output=True, text=True).stderr
rec('1l 취소된 주문을 되살릴 수 없음(HLTO)', 'HLTO' in err, err.strip()[:120])
st, j = call('POST', '/me/health/returns', BUY, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
rec('1m 취소된 주문 재신청 409', st == 409, (st, j))

# 결제 취소(PG) 경로 — 결제 완료 주문을 결제 취소하면 재고 한 번 복구
s1 = stock(PROD)
no2 = new_order(1); o2 = oid(no2)
q(f"insert into hlt_payments(order_id,method,amount,state,approved_at,payment_key) select id,'CARD',total,'PAID',now(),'srvhlt_'||gen_random_uuid() from hlt_orders where id='{o2}'")  # D006: PAID 는 거래 키 필수
q(f"update hlt_payments set state='CANCELED', canceled_at=now() where order_id='{o2}' and state='PAID'")
rec('1n 결제 취소 트리거 → 주문 취소 · 재고 복구', q(f"select status from hlt_orders where id='{o2}'") == 'CANCELED' and stock(PROD) == s1, (q(f"select status from hlt_orders where id='{o2}'"), s1, stock(PROD)))

# ── 2. 청약철회 판정 ─────────────────────────────────────────────────
no3 = new_order(1); o3 = oid(no3)
st, j = call('POST', '/me/health/returns', BUY, {'orderNo': no3, 'kind': 'RETURN', 'reason': 'CHANGE_MIND'})
rec('2a 발송 전 반품 → 422 HLT_RETURN_BEFORE_SHIP', st == 422 and j['code'] == 'HLT_RETURN_BEFORE_SHIP', (st, j))
st, j = call('POST', '/me/health/returns', BUY, {'orderNo': no3, 'kind': 'CANCEL', 'reason': '아무말'})
rec('2b 모르는 사유 코드 400', st == 400, st)
# v10.31 (w3 D06x fn_hlt_order_time_guard — 주문 ≤ 결제 ≤ 발송 ≤ 배송 완료) — 시각을 과거로 돌릴 때 주문 · 결제 시각도 함께
q(f"update hlt_orders set status='PAID', created_at=now()-interval '13 days', paid_at=now()-interval '13 days' where id='{o3}'")
q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{o3}','PICKED',now()-interval '12 days')")
st, j = call('POST', '/me/health/returns', BUY, {'orderNo': no3, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
rec('2c 발송 후 취소 → 422 HLT_CANCEL_AFTER_SHIP', st == 422 and j['code'] == 'HLT_CANCEL_AFTER_SHIP', (st, j))
st, od = call('GET', f'/me/health/orders/{no3}', BUY)
rec('2d 배송 중(수령 전) 반품은 가능으로 판정', od['returnable']['return']['ok'] is True and od['returnable']['cancel']['ok'] is False, od.get('returnable'))
q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{o3}','DELIVERED',now()-interval '10 days')")
st, j = call('POST', '/me/health/returns', BUY, {'orderNo': no3, 'kind': 'RETURN', 'reason': 'CHANGE_MIND'})
rec('2e 받은 지 10일 · 단순 변심 반품 → 422 HLT_WITHDRAWAL_EXPIRED', st == 422 and j['code'] == 'HLT_WITHDRAWAL_EXPIRED', (st, j))
err = subprocess.run(['psql', DB, '-tAc', f"insert into hlt_returns(order_id,kind,reason) values ('{o3}','RETURN','CHANGE_MIND')"], capture_output=True, text=True).stderr
rec('2f 앱을 거치지 않아도 트리거가 막음(HLTR)', 'HLTR' in err, err.strip()[:120])
st, od = call('GET', f'/me/health/orders/{no3}', BUY)
rec('2g 주문 상세 판정: 변심 불가 · 하자 가능', od['returnable']['return']['ok'] is False and od['returnable']['returnSellerFault']['ok'] is True, od['returnable'])
st, j = call('POST', '/me/health/returns', BUY, {'orderNo': no3, 'kind': 'RETURN', 'reason': 'DEFECT', 'detail': '파손'})
rec('2h 하자 사유는 3개월 안이라 접수', st < 300 and j.get('deadline'), (st, j))
s3 = stock(PROD)
st, j = call('POST', f"/admin/health/returns/{j['id']}/decide", ADM, {'state': 'APPROVED', 'note': '파손 확인', 'opened': False})  # D006: 반품 승인은 개봉 판정 필수
rec('2i 반품 승인 → RETURNED · 재고 +1', st < 300 and j['orderStatus'] == 'RETURNED' and stock(PROD) == s3 + 1, (st, j, s3, stock(PROD)))
no4 = new_order(1); o4 = oid(no4)
q(f"update hlt_orders set status='PAID', created_at=now()-interval '5 days', paid_at=now()-interval '5 days' where id='{o4}'")   # v10.31 시각 순서
q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{o4}','PICKED',now()-interval '4 days')")
q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{o4}','DELIVERED',now()-interval '3 days')")
st, j = call('POST', '/me/health/returns', BUY, {'orderNo': no4, 'kind': 'RETURN', 'reason': 'CHANGE_MIND'})
rec('2j 받은 지 3일 단순 변심 반품 접수', st < 300, (st, j))
st, j = call('POST', f"/admin/health/returns/{j['id']}/decide", ADM, {'state': 'REJECTED', 'note': '개봉 확인 — 식품 밀봉 훼손'})
rec('2k 반려 → 주문 상태 유지 · 재고 그대로', st < 300 and j['orderStatus'] == 'DELIVERED' and not j['restockedAt'], (st, j))
st, j = call('POST', '/me/health/returns', INT, {'orderNo': no4, 'kind': 'RETURN', 'reason': 'DEFECT'})
rec('2l 남의 주문 반품 신청 → 409 NOT_FOUND', st == 409, (st, j))

# ── 3. 배송지 ──────────────────────────────────────────────────────────
tag = uuid.uuid4().hex[:4]
st, a1 = call('POST', '/me/health/addresses', BUY, {'label': f'검증A{tag}', 'receiver': '검증', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 A'})
st, a2 = call('POST', '/me/health/addresses', BUY, {'label': f'검증B{tag}', 'receiver': '검증', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 B'})
st, j = call('PATCH', f"/me/health/addresses/{a1['id']}/default", BUY)
ndef = q("select count(*) from hlt_addresses a join accounts c on c.id=a.account_id where c.email='buyer@x.com' and a.is_default")
rec('3a 기본 배송지 변경 · 기본은 1개', st < 300 and q(f"select is_default from hlt_addresses where id='{a1['id']}'") == 't' and ndef == '1', (st, j, ndef))
st, j = call('PATCH', f"/me/health/addresses/{a1['id']}/default", INT)
rec('3b 남의 배송지 기본 지정 → 409', st == 409, st)
st, j = call('DELETE', f"/me/health/addresses/{a1['id']}", INT)
rec('3c 남의 배송지 삭제 → 409', st == 409, st)
no5 = new_order(1, a2['id'])
st, j = call('DELETE', f"/me/health/addresses/{a2['id']}", BUY)
rec('3d 진행 중 주문의 배송지 삭제 → 409 ADDRESS_IN_USE', st == 409 and j['code'] == 'ADDRESS_IN_USE', (st, j))
q(f"update hlt_orders set status='CANCELED' where order_no='{no5}'")
st, j = call('DELETE', f"/me/health/addresses/{a2['id']}", BUY)
rec('3e 지난 주문 배송지 삭제 → 소프트 삭제(행 남음)', st < 300 and q(f"select deleted_at is not null from hlt_addresses where id='{a2['id']}'") == 't', (st, j))
st, lst = call('GET', '/me/health/addresses', BUY)
rec('3f 지운 배송지는 목록에 없음', all(x['id'] != a2['id'] for x in lst), len(lst))
st, j = call('POST', '/health/orders', BUY, {'addressId': a2['id'], 'items': [{'productCode': PROD, 'qty': 1}]})
rec('3g 지운 배송지로 주문 불가 422', st == 422 and j['code'] == 'BAD_ADDRESS', (st, j))
st, j = call('DELETE', f"/me/health/addresses/{a1['id']}", BUY)
rec('3h 기본 배송지 삭제(주문 없음) → 행 삭제 · 다른 배송지가 기본', st < 300 and q(f"select count(*) from hlt_addresses where id='{a1['id']}'") == '0' and j['newDefault'], (st, j))
ndef = q("select count(*) from hlt_addresses a join accounts c on c.id=a.account_id where c.email='buyer@x.com' and a.is_default and a.deleted_at is null")
rec('3i 삭제 후에도 기본 1개', ndef == '1', ndef)
# 원래 기본 복원
call('PATCH', f'/me/health/addresses/{ADDR}/default', BUY)
st, j = call('DELETE', '/me/health/addresses/not-a-uuid', BUY)
rec('3j 형식 틀린 id → 409 NOT_FOUND', st == 409, st)
st, j = call('DELETE', f"/me/health/addresses/{ADDR}")
rec('3k 비로그인 삭제 → 401/403', st in (401, 403), st)

# ── 4. 성분 · 고민 ─────────────────────────────────────────────────────
st, cs = call('GET', '/health/concerns')
rec('4a 고민 14개(시안 · D027) · 성분 있는 것만', st == 200 and len(cs) == 14 and all(c['ingredientCount'] > 0 for c in cs), [c['code'] for c in cs] if cs else st)
st, c = call('GET', '/health/concerns/circ')
rec('4b 고민 상세 (대소문자 무관) 성분·상품', st == 200 and {g['code'] for g in c['ingredients']} == {'OMEGA3', 'REDGIN'} and len(c['products']) >= 1, (st, c and [p['code'] for p in c['products']]))
st, j = call('GET', '/health/concerns/NOPE')
rec('4c 없는 고민 409', st == 409, st)
# v10.25 (D025) — 건강기능식품 · 의료기기는 잠금 · 미판매라 그 상품(VITD-90 · OMG-60 · LACT-30 …)은 목록에 나오지 않습니다. 열린 갈래(건강식품)의 홍삼 스틱으로 봅니다
st, g = call('GET', '/health/ingredients/REDGIN')   # v10.26 (D027) — GINSENG → REDGIN(홍삼)
rec('4d 성분 상세 상품·고민', st == 200 and any(p['code'] == 'RED-30' for p in g['products']) and {k['code'] for k in g['concerns']} == {'CIRC', 'FATIGUE'}, (st, g and g.get('concerns')))
st, g = call('GET', '/health/ingredients/MULTI')   # v10.26 — 비타민D 는 견본 p02(건강식품)가 생겨 멀티비타민(견본 p15 · 잠긴 갈래뿐)으로 봅니다
rec('4d-2 잠긴 갈래에만 상품이 있는 성분(멀티비타민) — 성분은 남고 상품은 0', st == 200 and g['products'] == [] and {k['code'] for k in g['concerns']} == {'IMMUNE', 'FATIGUE'}, (st, g and g.get('products')))
st, j = call('GET', '/health/ingredients/WATER')
rec('4e 부형제 상세 409', st == 409, st)
st, gs = call('GET', '/health/ingredients')
rec('4f 성분 목록에 productCount · minPrice', st == 200 and all('productCount' in x for x in gs), gs[0] if gs else st)
st, ps = call('GET', '/health/products?ingredient=REDGIN')
rec('4g ?ingredient= 필터', st == 200 and [p['code'] for p in ps] == ['RED-30'], [p['code'] for p in ps] if ps else st)
st, ps = call('GET', '/health/products?concern=CIRC')
rec('4h ?concern= 필터(혈행 = 오메가3 · 홍삼 → 견본 p03 · 홍삼 스틱)', st == 200 and {p['code'] for p in ps} == {'p03', 'RED-30'}, [p['code'] for p in ps] if ps else st)
st, ps = call('GET', '/health/products?ingredient=MULTI')   # v10.26 — 고민마다 열린 갈래의 견본이 생겨, 잠긴 갈래뿐인 성분으로 봅니다
rec('4h-2 잠긴 갈래의 상품뿐인 성분(멀티비타민) — 상품 0', st == 200 and ps == [], [p['code'] for p in ps] if ps else st)
st, ps = call('GET', '/health/products')
rec('4i 목록에 categoryCode', st == 200 and all('categoryCode' in p for p in ps), ps[0] if ps else st)
# 품절 본보기였던 유산균(LACT-30)이 잠긴 갈래라, 홍삼 스틱의 재고를 잠깐 0 으로 두고 봅니다(바로 되돌림)
s_red = q("select stock from hlt_products where code='RED-30'")
try:
    q("update hlt_product_options set stock=0 where product_id=(select id from hlt_products where code='RED-30')")
    st, p = call('GET', '/health/products/RED-30')
    rec('4j 상세에 soldOut · ingredients', st == 200 and p['soldOut'] is True and p['ingredients'][0]['code'] == 'REDGIN', p)
finally:
    q(f"update hlt_product_options set stock={int(s_red)} where product_id=(select id from hlt_products where code='RED-30')")
rec('4j-2 (정리) 홍삼 스틱 재고를 되돌림', q("select stock from hlt_products where code='RED-30'") == s_red, (s_red, q("select stock from hlt_products where code='RED-30'")))
err = subprocess.run(['psql', DB, '-tAc', "insert into hlt_concerns(code,name) values ('ZZ_TEST','당뇨 개선')"], capture_output=True, text=True).stderr
rec('4k 고민 이름에 질병명 금지(HLTK)', 'HLTK' in err, err.strip()[:120])

# 불변식
rec('INV 취소·반품 주문은 모두 재고 되돌림 기록(또는 개봉 미복구 사유 — D006)', q("select count(*) from hlt_orders where status in ('CANCELED','RETURNED') and (restocked_at is null) = (restock_skipped is null)") == '0')
rec('INV 계정당 기본 배송지 ≤1 · 지운 배송지는 기본 아님', q("select count(*) from (select account_id from hlt_addresses where is_default group by 1 having count(*)>1) x") == '0' and q("select count(*) from hlt_addresses where is_default and deleted_at is not null") == '0')

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_hlt.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
