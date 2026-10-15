"""소개뱅크몰 결제 실연동 · 환불 · 개봉 반품 — API 검증 (D006).

  스텁 모드 (TOSS_SECRET_KEY 없음):
    API=http://localhost:3021/api/v1 python3 srv_pay.py
  토스 어댑터를 가짜 토스 서버로 실제 HTTP 시험 (선택):
    API_TOSS=http://localhost:3121/api/v1 MOCK_PORT=3129 python3 srv_pay.py
    — API_TOSS 는 TOSS_SECRET_KEY=test_sk_mock TOSS_API_BASE=http://localhost:3129 로 띄운 API 입니다.
      이 스크립트가 가짜 토스 서버(MOCK_PORT)를 직접 띄웁니다. API_TOSS 가 없으면 그 부분은 건너뜁니다.

결과: srv_pay.json
"""
import base64, json, os, subprocess, sys, threading, time, uuid, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

B = os.environ.get('API', 'http://localhost:3000/api/v1')
BT = os.environ.get('API_TOSS')
MOCK_PORT = int(os.environ.get('MOCK_PORT', '3129'))
DB = os.environ.get('DATABASE_URL', 'postgresql://sgb:sgb@localhost:5432/sgb')
PROD = os.environ.get('PROD', 'RED-30')        # 45,000원 — 3만원 이상이라 배송비 무료
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
qerr = lambda s: subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', s], capture_output=True, text=True)
R = []


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:160], file=sys.stderr)


def call(m, p, tok=None, body=None, base=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request((base or B) + p, method=m, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=40); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e:
        st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js


def login(e, pw='sgb-dev-1234', base=None):
    return call('POST', '/auth/login', body={'email': e, 'password': pw}, base=base)[1]['accessToken']


stock = lambda: int(q(f"select stock from hlt_products where code='{PROD}'"))
ostat = lambda no: q(f"select status||'|'||coalesce(restocked_at::text,'-')||'|'||coalesce(restock_skipped,'-') from hlt_orders where order_no='{no}'")


def new_order(tok, base=None, method='CARD'):
    addr = next(a for a in call('GET', '/me/health/addresses', tok, base=base)[1] if a['isDefault'])['id']
    st, o = call('POST', '/health/orders', tok, {'addressId': addr, 'items': [{'productCode': PROD, 'qty': 1}]}, base=base)
    assert st < 300, (st, o)
    st, p = call('POST', f"/health/orders/{o['orderNo']}/pay", tok, {'method': method}, base=base)
    assert st < 300, (st, p)
    return o['orderNo'], int(o['total']), p


def deliver(no):
    oid = q(f"select id from hlt_orders where order_no='{no}'")
    q(f"update hlt_orders set created_at=least(created_at, now()-interval '3 days'), paid_at=least(coalesce(paid_at, now()), now()-interval '3 days') where id='{oid}'")   # v10.31 fn_hlt_order_time_guard — 주문 ≤ 결제 ≤ 발송 ≤ 배송 완료(시각을 과거로 돌릴 때 주문 · 결제 시각도 함께)
    q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid}','PICKED',now()-interval '2 days')")
    q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid}','DELIVERED',now()-interval '1 day')")


def return_id(no):
    return q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no}' order by r.created_at desc limit 1")


ADM = login('admin@x.com'); BUY = login('buyer@x.com'); OTH = login('person@x.com')

# ══ 1. 스텁 결제 흐름 ═══════════════════════════════════════════════════
s0 = stock()
no, total, p = new_order(BUY)
rec('P-1 주문 → 결제 준비(READY) · 주문 결제 대기 · 재고 1 감소', p['state'] == 'READY' and ostat(no).startswith('PENDING') and stock() == s0 - 1, (p['state'], ostat(no), s0, stock()))
key = 'stub_' + uuid.uuid4().hex
st, c = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': key, 'amount': total + 1000})
rec('P-2 금액 조작(+1000) → 422 AMOUNT_MISMATCH · 승인 안 됨 · 주문 결제 대기', st == 422 and c['code'] == 'AMOUNT_MISMATCH' and ostat(no).startswith('PENDING')
    and q(f"select count(*) from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{no}' and p.state='PAID'") == '0', (st, c))
st, c = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': key, 'amount': str(total - 1)})
rec('P-2b 금액 조작(문자열 · -1) → 422', st == 422, (st, c and c.get('code')))
st, c = call('POST', f'/health/orders/{no}/pay/confirm', OTH, {'paymentKey': key, 'amount': total})
rec('P-3 남의 주문 승인 → 409 NOT_FOUND', st == 409 and c['code'] == 'NOT_FOUND', (st, c))
st, c = call('POST', f'/health/orders/{no}/pay/confirm', None, {'paymentKey': key, 'amount': total})
rec('P-3b 로그인 없이 → 403', st == 403, st)
st, c = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': 'bad key!', 'amount': total})
rec('P-3c paymentKey 형식 오류 → 400', st == 400, st)
st, c = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': key})
rec('P-3d amount 없음 → 400', st == 400, st)
st, c = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': key, 'amount': total})
rec('P-4 승인 → 결제 PAID · stub:true · 주문 PAID(트리거)', st < 300 and c['state'] == 'PAID' and c['stub'] is True and c['orderStatus'] == 'PAID'
    and ostat(no).startswith('PAID') and q(f"select payment_key from hlt_payments where payment_key='{key}'") == key, (st, c))
pid = c and c.get('id')
st, c2 = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': key, 'amount': total})
rec('P-5 같은 paymentKey 다시 → 같은 결과(again) · PAID 1건', st < 300 and c2['id'] == pid and c2['again'] is True and c2['state'] == 'PAID'
    and q(f"select count(*) from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{no}' and p.state='PAID'") == '1', (st, c2))
st, c3 = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': total})
rec('P-6 결제된 주문에 다른 키로 승인 → 409 ALREADY', st == 409 and c3['code'] == 'ALREADY', (st, c3))
st, d = call('GET', f'/me/health/orders/{no}', BUY)
rec('P-7 주문 상세에 결제 정보(stub) — 화면 "시험 결제" 표시 근거 · secret 없음', st == 200 and d['payment']['stub'] is True and d['payment']['state'] == 'PAID' and 'vbank_secret' not in json.dumps(d), d.get('payment'))
no2, total2, _ = new_order(BUY)
st, c = call('POST', f'/health/orders/{no2}/pay/confirm', BUY, {'paymentKey': key, 'amount': total2})
rec('P-8 다른 주문의 paymentKey 재사용 → 409 PAYMENT_KEY_MISMATCH', st == 409 and c['code'] == 'PAYMENT_KEY_MISMATCH', (st, c))

# ── 취소 → 승인 → 환불 (재고 한 번) ──
s1 = stock()
st, r = call('POST', '/me/health/returns', BUY, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND', 'opened': True})
rid = r['id']
rec('R-1 결제된 주문 취소 신청 (취소에 보낸 개봉 표시는 무시)', st < 300 and q(f"select coalesce(customer_opened::text,'null') from hlt_returns where id='{rid}'") == 'null', (st, r))
st, j = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED', 'opened': True})
rec('R-2 취소에 opened:true → 422 CANCEL_NOT_OPENED', st == 422 and j['code'] == 'CANCEL_NOT_OPENED', (st, j))
st, j = call('POST', f'/admin/health/returns/{rid}/refund', ADM)
rec('R-3 승인 전 환불 → 409 NOT_APPROVED', st == 409 and j['code'] == 'NOT_APPROVED', (st, j))
st, j = call('POST', f'/admin/health/returns/{rid}/decide', BUY, {'state': 'APPROVED'})
rec('R-3b 구매자가 승인 → 403', st == 403, st)
st, j = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED'})
rec('R-4 승인 → 주문 CANCELED · 환불 REFUNDED(전액) · 결제 CANCELED', st < 300 and j['state'] == 'REFUNDED' and j['orderStatus'] == 'CANCELED'
    and j['refund']['state'] == 'REFUNDED' and int(j['refund']['amount']) == total
    and q(f"select state||'|'||refund_amount||'|'||(refunded_at is not null) from hlt_returns where id='{rid}'") == f'REFUNDED|{total}|true'
    and q(f"select state||'|'||canceled_amount from hlt_payments where payment_key='{key}'") == f'CANCELED|{total}', (st, j))
rec('R-5 재고 한 번 복구 (+1)', stock() == s1 + 1 and ostat(no).split('|')[1] != '-', (s1, stock(), ostat(no)))
st, j = call('POST', f'/admin/health/returns/{rid}/refund', ADM)
rec('R-6 환불 다시 → 같은 결과(again) · 재고 그대로', st < 300 and j['again'] is True and j['state'] == 'REFUNDED' and stock() == s1 + 1, (st, j))
st, mr = call('GET', '/me/health/returns', BUY)
m = next((x for x in mr if x['id'] == rid), {})
rec('R-7 고객 내역에 환불 완료 · 금액', m.get('state') == 'REFUNDED' and int(m.get('refundAmount') or 0) == total, m)
st, j = call('POST', f'/admin/health/returns/{rid}/refund', BUY)
rec('R-8 구매자가 환불 API → 403', st == 403, st)

# ── 미결제 주문 취소: 환불 없음 ──
st, r = call('POST', '/me/health/returns', BUY, {'orderNo': no2, 'kind': 'CANCEL', 'reason': 'WRONG_ORDER'})
rid2 = r['id']
st, j = call('POST', f'/admin/health/returns/{rid2}/decide', ADM, {'state': 'APPROVED'})
rec('R-9 미결제 주문 취소 승인 → 환불 없음(APPROVED 유지) · 주문 CANCELED', st < 300 and j['state'] == 'APPROVED' and j['refund']['state'] == 'NONE' and j['orderStatus'] == 'CANCELED', (st, j))
st, j = call('POST', f'/admin/health/returns/{rid2}/refund', ADM)
rec('R-10 미결제 건 환불 API → 409 NOT_PAID', st == 409 and j['code'] == 'NOT_PAID', (st, j))

# ══ 2. 반품 — 개봉 / 미개봉 ═════════════════════════════════════════════
def paid_delivered():
    n, t, _ = new_order(BUY)
    k = 'stub_' + uuid.uuid4().hex
    st, c = call('POST', f'/health/orders/{n}/pay/confirm', BUY, {'paymentKey': k, 'amount': t})
    assert st < 300 and c['state'] == 'PAID', (st, c)
    deliver(n)
    return n, t, k

no3, t3, k3 = paid_delivered()
st, r = call('POST', '/me/health/returns', BUY, {'orderNo': no3, 'kind': 'RETURN', 'reason': 'CHANGE_MIND', 'opened': True, 'detail': '열어 봤습니다'})
rid3 = r['id']
rec('O-1 반품 신청 + 고객 개봉 표시(참고) 저장', st < 300 and r.get('customerOpened') is True, (st, r))
st, j = call('POST', f'/admin/health/returns/{rid3}/decide', ADM, {'state': 'APPROVED'})
rec('O-2 반품 승인에 개봉 판정 없음 → 422 OPENED_REQUIRED · 주문 그대로', st == 422 and j['code'] == 'OPENED_REQUIRED' and ostat(no3).startswith('DELIVERED'), (st, j))
st, j = call('POST', f'/admin/health/returns/{rid3}/decide', ADM, {'state': 'APPROVED', 'opened': 'yes'})
rec('O-2b opened 형식 오류 → 400', st == 400, st)
s3 = stock()
st, j = call('POST', f'/admin/health/returns/{rid3}/decide', ADM, {'state': 'APPROVED', 'opened': True})
rec('O-3 개봉 반품 승인 → RETURNED · 재고 미복구(restock_skipped=OPENED) · 환불', st < 300 and j['orderStatus'] == 'RETURNED' and j['restockSkipped'] == 'OPENED'
    and not j['restockedAt'] and stock() == s3 and j['state'] == 'REFUNDED' and q(f"select opened from hlt_returns where id='{rid3}'") == 't', (st, j, s3, stock()))
rec('O-4 결제 CANCELED 가 반품을 취소로 바꾸지 않음 (주문 RETURNED 유지)', ostat(no3) == 'RETURNED|-|OPENED' and q(f"select state from hlt_payments where payment_key='{k3}'") == 'CANCELED', ostat(no3))
# 공용 개발 DB 정리 — 개봉 반품은 설계상 재고를 줄인 채 둡니다. 시험이 줄인 1개만 되돌립니다(다른 작업자 시험 보호)
q(f"update hlt_product_options set stock = stock + 1 where product_id=(select id from hlt_products where code='{PROD}')")

no4, t4, k4 = paid_delivered()
st, r = call('POST', '/me/health/returns', BUY, {'orderNo': no4, 'kind': 'RETURN', 'reason': 'DEFECT', 'opened': False})
rid4 = r['id']; s4 = stock()
st, j = call('POST', f'/admin/health/returns/{rid4}/decide', ADM, {'state': 'APPROVED', 'opened': False})
rec('O-5 미개봉 반품 승인 → RETURNED · 재고 +1 · 환불 REFUNDED', st < 300 and j['orderStatus'] == 'RETURNED' and j['restockedAt'] and not j['restockSkipped']
    and stock() == s4 + 1 and j['state'] == 'REFUNDED', (st, j, s4, stock()))
st, al = call('GET', '/admin/health/returns?state=REFUNDED', ADM)
row = next((x for x in al if x['id'] == rid3), {})
# 10/2 결정(D009) — 단순 변심 반품은 왕복 배송비 6,000원을 빼고 환불합니다
rec('O-6 운영 목록 REFUNDED 탭 · 개봉 판정 · 고객 표시 · 환불액(결제 − 왕복 배송비 6,000)', row.get('opened') is True and row.get('customerOpened') is True and row.get('restockSkipped') == 'OPENED'
    and int(row.get('refundAmount') or 0) == t3 - 6000 and int(row.get('shipDeduction') or 0) == 6000, row)

# ── DB 가 집행하는 규칙 ──
oid4 = q(f"select id from hlt_orders where order_no='{no4}'")
e = qerr(f"update hlt_orders set restock_skipped='OPENED' where id='{oid4}'")
rec('G-1 이미 재고 복구한 반품에 미복구 사유 붙이기 → 거부', e.returncode != 0 and q(f"select coalesce(restock_skipped,'-') from hlt_orders where id='{oid4}'") == '-', e.stderr.strip()[:120])
oid3 = q(f"select id from hlt_orders where order_no='{no3}'")
e = qerr(f"update hlt_orders set restock_skipped=NULL where id='{oid3}'")
rec('G-2 미복구 사유는 지울 수 없음 (트리거가 되돌림)', q(f"select restock_skipped from hlt_orders where id='{oid3}'") == 'OPENED', e.stderr.strip()[:80])
no5, t5, _ = new_order(BUY)
oid5 = q(f"select id from hlt_orders where order_no='{no5}'")
e = qerr(f"update hlt_orders set status='CANCELED', restock_skipped='OPENED' where id='{oid5}'")
rec('G-3 취소에 미복구(개봉) 사유 → 거부', e.returncode != 0 and ostat(no5).startswith('PENDING'), e.stderr.strip()[:120])
e = qerr(f"update hlt_payments set state='PAID', approved_at=now() where order_id='{oid5}' and state='READY'")
rec('G-4 거래 키 없는 PAID → 거부 (ck_hlt_pay_paid_key)', e.returncode != 0 and ostat(no5).startswith('PENDING'), e.stderr.strip()[:120])
call('POST', '/me/health/returns', BUY, {'orderNo': no5, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
call('POST', f'/admin/health/returns/{return_id(no5)}/decide', ADM, {'state': 'APPROVED'})
rec('G-5 불변식: 취소·반품 주문은 재고 복구 또는 미복구 사유 중 정확히 하나',
    q("select count(*) from hlt_orders where status in ('CANCELED','RETURNED') and (restocked_at is null) = (restock_skipped is null)") == '0')

# ══ 3. 가상계좌 + 웹훅 (스텁) ═════════════════════════════════════════════
no6, t6, p6 = new_order(BUY, method='VBANK')
k6 = 'stub_' + uuid.uuid4().hex
st, c = call('POST', f'/health/orders/{no6}/pay/confirm', BUY, {'paymentKey': k6, 'amount': t6})
rec('W-1 가상계좌 승인 → 입금 대기(READY + 계좌 안내) · 주문 결제 대기', st < 300 and c['state'] == 'READY' and c['pgStatus'] == 'WAITING_FOR_DEPOSIT'
    and c['vbank'] and c['vbank'].get('accountNumber') and ostat(no6).startswith('PENDING'), (st, c))
st, c2 = call('POST', f'/health/orders/{no6}/pay/confirm', BUY, {'paymentKey': k6, 'amount': t6})
rec('W-2 같은 키 다시 → 같은 입금 대기(again)', st < 300 and c2['again'] is True and c2['state'] == 'READY', (st, c2 and c2.get('state')))
st, c3 = call('POST', f'/health/orders/{no6}/pay', BUY, {'method': 'CARD'})
rec('W-3 가상계좌 발급 뒤 수단 변경 → 409 VBANK_WAITING', st == 409 and c3['code'] == 'VBANK_WAITING', (st, c3))
st, w = call('POST', '/webhooks/toss', None, {'createdAt': '2026-10-02T10:00:00.000000', 'secret': 'x', 'status': 'DONE', 'transactionKey': 't', 'orderId': 'H00000000000'})
rec('W-4 웹훅 — 모르는 주문 → 200 IGNORED', st in (200, 201) and w['action'] == 'IGNORED', (st, w))
st, w = call('POST', '/webhooks/toss', None, {'eventType': 'PAYMENT_STATUS_CHANGED', 'data': {'paymentKey': 'unknown_' + uuid.uuid4().hex, 'status': 'DONE'}})
rec('W-5 웹훅 — 모르는 paymentKey → IGNORED (본문 DONE 을 믿지 않음)', st in (200, 201) and w['action'] == 'IGNORED', (st, w))
st, w = call('POST', '/webhooks/toss', None, {'createdAt': '2026-10-02T10:00:00.000000', 'status': 'DONE', 'transactionKey': 't', 'orderId': no6, 'secret': 's'})
rec('W-6 입금 알림(DEPOSIT_CALLBACK, 로그인 없음) → 재조회 DONE → 결제 PAID · 주문 PAID', st in (200, 201) and w['action'] == 'PAID' and ostat(no6).startswith('PAID')
    and q(f"select state||'|'||stub from hlt_payments where payment_key='{k6}'") == 'PAID|true', (st, w))
st, w = call('POST', '/webhooks/toss', None, {'eventType': 'PAYMENT_STATUS_CHANGED', 'data': {'paymentKey': k6, 'orderId': no6, 'status': 'DONE'}})
rec('W-7 같은 알림 재전송 → ALREADY (변화 없음)', st in (200, 201) and w['action'] == 'ALREADY' and ostat(no6).startswith('PAID'), (st, w))
st, w = call('POST', '/webhooks/toss', None, {})
rec('W-8 빈 본문 → IGNORED', st in (200, 201) and w['action'] == 'IGNORED', (st, w))
# 정리 — 결제 완료된 시험 주문은 취소·환불로 닫습니다(재고 원복)
call('POST', '/me/health/returns', BUY, {'orderNo': no6, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
st, j = call('POST', f'/admin/health/returns/{return_id(no6)}/decide', ADM, {'state': 'APPROVED'})
rec('W-9 가상계좌 결제 취소 승인 → 스텁 환불 REFUNDED', st < 300 and j['state'] == 'REFUNDED', (st, j and j.get('note')))

# ══ 4. 실제 토스 어댑터 ↔ 가짜 토스 서버 ══════════════════════════════════
MOCK = {'pay': {}, 'log': [], 'cancel_fail': set(), 'lookup_fail': set(), 'idem': {}}
SECRET = 'test_sk_mock'


class Toss(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, st, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(st); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(raw)))
        self.end_headers(); self.wfile.write(raw)

    def _auth_ok(self):
        return self.headers.get('Authorization') == 'Basic ' + base64.b64encode(f'{SECRET}:'.encode()).decode()

    def _payment(self, p):
        return {'paymentKey': p['key'], 'orderId': p['orderId'], 'status': p['status'], 'totalAmount': p['amount'],
                'balanceAmount': p['amount'] - p.get('canceled', 0), 'method': p['method'], 'approvedAt': p.setdefault('at', time.strftime('%Y-%m-%dT%H:%M:%S+09:00', time.localtime(time.time() + 9 * 3600 - (time.localtime().tm_gmtoff or 0)))),   # v10.31 — 지금 시각(D064 주문 ≤ 결제 시각 순서 · 전: 10/2 고정)
                'lastTransactionKey': 'tx_' + p['key'][-6:], 'secret': p.get('secret'),
                'virtualAccount': p.get('va'), 'cancels': p.get('cancels', [])}

    def do_GET(self):
        MOCK['log'].append({'m': 'GET', 'path': self.path, 'auth': self.headers.get('Authorization')})
        if not self._auth_ok(): return self._send(401, {'code': 'UNAUTHORIZED_KEY', 'message': '인증되지 않은 시크릿 키'})
        parts = self.path.split('/')
        if self.path.startswith('/v1/payments/orders/'):
            p = next((x for x in MOCK['pay'].values() if x['orderId'] == parts[-1]), None)
        else:
            p = MOCK['pay'].get(parts[-1])
        if p and p['key'] in MOCK['lookup_fail']: return self._send(500, {'code': 'FAILED_INTERNAL_SYSTEM_PROCESSING', 'message': '내부 오류'})
        if not p: return self._send(404, {'code': 'NOT_FOUND_PAYMENT', 'message': '존재하지 않는 결제'})
        self._send(200, self._payment(p))

    def do_POST(self):
        n = int(self.headers.get('content-length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        MOCK['log'].append({'m': 'POST', 'path': self.path, 'auth': self.headers.get('Authorization'), 'body': body, 'idem': self.headers.get('Idempotency-Key')})
        if not self._auth_ok(): return self._send(401, {'code': 'UNAUTHORIZED_KEY', 'message': '인증되지 않은 시크릿 키'})
        if self.path == '/v1/payments/confirm':
            k = body['paymentKey']; amt = body['amount']
            if k.startswith('mk-reject'): return self._send(400, {'code': 'REJECT_CARD_COMPANY', 'message': '카드사에서 거절했습니다'})
            if k.startswith('mk-500'): return self._send(500, {'code': 'FAILED_INTERNAL_SYSTEM_PROCESSING', 'message': '토스 내부 오류'})
            if k in MOCK['pay']: return self._send(400, {'code': 'ALREADY_PROCESSED_PAYMENT', 'message': '이미 처리된 결제 입니다.'})
            p = {'key': k, 'orderId': body['orderId'], 'amount': amt, 'status': 'DONE', 'method': '카드'}
            if k.startswith('mk-short'): p['amount'] = amt - 100
            if k.startswith('mk-vbank'):
                p.update(status='WAITING_FOR_DEPOSIT', method='가상계좌', secret='sec_' + k[-8:],
                         va={'accountNumber': '12345678901234', 'bankCode': '20', 'customerName': '구매자', 'dueDate': '2026-10-05T23:59:59+09:00', 'refundStatus': 'NONE'})
            MOCK['pay'][k] = p
            if k.startswith('mk-already'):     # 승인은 됐는데 응답이 유실된 것처럼
                return self._send(400, {'code': 'ALREADY_PROCESSED_PAYMENT', 'message': '이미 처리된 결제 입니다.'})
            return self._send(200, self._payment(p))
        if self.path.endswith('/cancel'):
            k = self.path.split('/')[-2]; p = MOCK['pay'].get(k)
            idem = self.headers.get('Idempotency-Key')
            if idem and idem in MOCK['idem']: return self._send(200, MOCK['idem'][idem])
            if not p: return self._send(404, {'code': 'NOT_FOUND_PAYMENT', 'message': '존재하지 않는 결제'})
            if k in MOCK['cancel_fail']: return self._send(403, {'code': 'NOT_CANCELABLE_AMOUNT', 'message': '취소 할 수 없는 금액 입니다.'})
            if p['method'] == '가상계좌' and p['status'] == 'DONE' and not body.get('refundReceiveAccount'):
                return self._send(400, {'code': 'INVALID_REFUND_ACCOUNT_INFO', 'message': '환불 계좌 정보가 필요합니다.'})
            ca = body.get('cancelAmount', p['amount'] - p.get('canceled', 0))
            p['canceled'] = p.get('canceled', 0) + ca
            p['status'] = 'CANCELED' if p['canceled'] >= p['amount'] else 'PARTIAL_CANCELED'
            p.setdefault('cancels', []).append({'cancelAmount': ca, 'cancelReason': body.get('cancelReason'), 'canceledAt': time.strftime('%Y-%m-%dT%H:%M:%S+09:00', time.localtime(time.time() + 9 * 3600 - (time.localtime().tm_gmtoff or 0))),
                                                'transactionKey': 'ctx_' + uuid.uuid4().hex[:8], 'cancelStatus': 'DONE'})
            out = self._payment(p)
            if idem: MOCK['idem'][idem] = out
            return self._send(200, out)
        self._send(404, {'code': 'NOT_FOUND', 'message': self.path})


if BT:
    srv = ThreadingHTTPServer(('127.0.0.1', MOCK_PORT), Toss)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    BUYT = login('buyer@x.com', base=BT); ADMT = login('admin@x.com', base=BT)
    T = lambda m, p, tok=None, body=None: call(m, p, tok, body, base=BT)

    n1, t1, _ = new_order(BUYT, base=BT)
    st, c = T('POST', f'/health/orders/{n1}/pay/confirm', BUYT, {'paymentKey': 'mk-reject-' + uuid.uuid4().hex[:8], 'amount': t1})
    rec('T-1 토스 거절(400 REJECT_CARD_COMPANY) → 422 PAY_REJECTED · 토스 문구 · 주문 결제 대기 · READY 유지(사유 기록)', st == 422 and c['code'] == 'PAY_REJECTED' and '거절' in c['message']
        and ostat(n1).startswith('PENDING') and q(f"select state||'|'||(fail_reason is not null) from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{n1}' order by p.created_at desc limit 1") == 'READY|true', (st, c))
    st, c = T('POST', f'/health/orders/{n1}/pay/confirm', BUYT, {'paymentKey': 'mk-500-' + uuid.uuid4().hex[:8], 'amount': t1})
    rec('T-2 토스 500 → 422 PAY_REJECTED (성공으로 바꾸지 않음)', st == 422 and c['code'] == 'PAY_REJECTED' and ostat(n1).startswith('PENDING'), (st, c))
    st, c = T('POST', f'/health/orders/{n1}/pay/confirm', BUYT, {'paymentKey': 'mk-short-' + uuid.uuid4().hex[:8], 'amount': t1})
    rec('T-3 토스 승인 금액 ≠ 주문 금액 → 422 · 승인 안 함', st == 422 and '불일치' in c['message'] and ostat(n1).startswith('PENDING'), (st, c))
    k1 = 'mk-done-' + uuid.uuid4().hex[:12]
    nlog = len(MOCK['log'])
    st, c = T('POST', f'/health/orders/{n1}/pay/confirm', BUYT, {'paymentKey': k1, 'amount': t1})
    sent = next((x for x in MOCK['log'][nlog:] if x['path'] == '/v1/payments/confirm'), {})
    rec('T-4 토스 승인(DONE) → PAID · stub:false · 주문 PAID', st < 300 and c['state'] == 'PAID' and c['stub'] is False and ostat(n1).startswith('PAID'), (st, c))
    rec('T-5 토스로 간 요청: Basic 시크릿 · {paymentKey, orderId=주문번호, amount=주문금액} · 본문에 키 없음',
        sent.get('auth') == 'Basic ' + base64.b64encode(f'{SECRET}:'.encode()).decode() and sent.get('body') == {'paymentKey': k1, 'orderId': n1, 'amount': t1}
        and SECRET not in json.dumps(sent.get('body')), sent)
    nlog = len(MOCK['log'])
    st, c2 = T('POST', f'/health/orders/{n1}/pay/confirm', BUYT, {'paymentKey': k1, 'amount': t1})
    rec('T-6 같은 키 다시 → 토스를 다시 부르지 않고 같은 결과', st < 300 and c2['again'] is True and c2['id'] == c['id']
        and not any(x['path'] == '/v1/payments/confirm' for x in MOCK['log'][nlog:]), (st, c2 and c2.get('again')))
    # 승인 응답 유실 복구
    n2, t2, _ = new_order(BUYT, base=BT)
    st, c = T('POST', f'/health/orders/{n2}/pay/confirm', BUYT, {'paymentKey': 'mk-already-' + uuid.uuid4().hex[:8], 'amount': t2})
    rec('T-7 ALREADY_PROCESSED_PAYMENT → 조회(DONE · 같은 주문·금액)로 승인 복구', st < 300 and c['state'] == 'PAID' and ostat(n2).startswith('PAID'), (st, c))

    # 환불 — 성공 · 실패 · 재시도
    T('POST', '/me/health/returns', BUYT, {'orderNo': n1, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    r1 = return_id(n1); nlog = len(MOCK['log'])
    st, j = T('POST', f'/admin/health/returns/{r1}/decide', ADMT, {'state': 'APPROVED'})
    cx = next((x for x in MOCK['log'][nlog:] if x['path'].endswith('/cancel')), {})
    rec('T-8 취소 승인 → 토스 취소(전액) → REFUNDED · 결제 CANCELED', st < 300 and j['state'] == 'REFUNDED' and q(f"select state||'|'||pg_status from hlt_payments where payment_key='{k1}'") == 'CANCELED|CANCELED', (st, j))
    rec('T-9 토스 취소 요청: 경로 /v1/payments/{key}/cancel · Idempotency-Key=hlt-refund-{신청id} · cancelReason · 전액이라 cancelAmount 없음',
        cx.get('path') == f'/v1/payments/{k1}/cancel' and cx.get('idem') == f'hlt-refund-{r1}' and cx.get('body', {}).get('cancelReason') and 'cancelAmount' not in cx.get('body', {}), cx)
    k2 = q(f"select payment_key from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{n2}' and p.state='PAID'")
    MOCK['cancel_fail'].add(k2)
    T('POST', '/me/health/returns', BUYT, {'orderNo': n2, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    r2 = return_id(n2)
    st, j = T('POST', f'/admin/health/returns/{r2}/decide', ADMT, {'state': 'APPROVED'})
    rec('T-10 환불 실패 → 승인(APPROVED) 유지 · ok:false · 오류 기록 · 결제 PAID 유지', st < 300 and j.get('ok') is False and j['state'] == 'APPROVED' and j['refund']['state'] == 'FAILED'
        and q(f"select state||'|'||(refund_error is not null) from hlt_returns where id='{r2}'") == 'APPROVED|true' and q(f"select state from hlt_payments where payment_key='{k2}'") == 'PAID'
        and ostat(n2).startswith('CANCELED'), (st, j))
    st, j = T('POST', f'/admin/health/returns/{r2}/refund', ADMT)
    rec('T-11 다시 시도도 실패 → 502 REFUND_FAILED · 토스 문구', st == 502 and j['code'] == 'REFUND_FAILED' and '취소 할 수 없는' in j['message'], (st, j))
    MOCK['cancel_fail'].discard(k2)
    st, j = T('POST', f'/admin/health/returns/{r2}/refund', ADMT)
    rec('T-12 원인 해소 후 다시 시도 → REFUNDED · 오류 지움', st < 300 and j['state'] == 'REFUNDED' and q(f"select state||'|'||coalesce(refund_error,'-') from hlt_returns where id='{r2}'") == 'REFUNDED|-', (st, j))

    # 가상계좌 + 웹훅 (본문을 믿지 않음)
    n3, t3, _ = new_order(BUYT, base=BT, method='VBANK')
    k3 = 'mk-vbank-' + uuid.uuid4().hex[:12]
    st, c = T('POST', f'/health/orders/{n3}/pay/confirm', BUYT, {'paymentKey': k3, 'amount': t3})
    rec('T-13 가상계좌 → WAITING_FOR_DEPOSIT · 계좌 안내 · secret 은 응답에 없음', st < 300 and c['state'] == 'READY' and c['vbank']['accountNumber'] == '12345678901234'
        and 'sec_' not in json.dumps(c) and q(f"select vbank_secret from hlt_payments where payment_key='{k3}'") == 'sec_' + k3[-8:], (st, c))
    st, w = T('POST', '/webhooks/toss', None, {'createdAt': 'x', 'secret': 'sec_' + k3[-8:], 'status': 'DONE', 'transactionKey': 't', 'orderId': n3})
    rec('T-14 입금 알림 본문은 DONE 이지만 토스 조회는 WAITING → 반영 안 함', st in (200, 201) and w['action'] == 'WAITING' and ostat(n3).startswith('PENDING'), (st, w))
    st, w = T('POST', '/webhooks/toss', None, {'createdAt': 'x', 'secret': 'forged', 'status': 'DONE', 'transactionKey': 't', 'orderId': n3})
    rec('T-15 secret 불일치 입금 알림 → REJECTED', st in (200, 201) and w['action'] == 'REJECTED' and ostat(n3).startswith('PENDING'), (st, w))
    MOCK['pay'][k3]['status'] = 'DONE'
    MOCK['lookup_fail'].add(k3)
    st, w = T('POST', '/webhooks/toss', None, {'eventType': 'PAYMENT_STATUS_CHANGED', 'data': {'paymentKey': k3, 'orderId': n3, 'status': 'DONE'}})
    rec('T-16 토스 조회 실패 → 502 (토스가 재전송) · 반영 안 함', st == 502 and ostat(n3).startswith('PENDING'), (st, w))
    MOCK['lookup_fail'].discard(k3)
    st, w = T('POST', '/webhooks/toss', None, {'createdAt': 'x', 'secret': 'sec_' + k3[-8:], 'status': 'DONE', 'transactionKey': 't', 'orderId': n3})
    rec('T-17 실제 입금(조회 DONE) → PAID · 주문 PAID', st in (200, 201) and w['action'] == 'PAID' and ostat(n3).startswith('PAID'), (st, w))
    st, w = T('POST', '/webhooks/toss', None, {'eventType': 'PAYMENT_STATUS_CHANGED', 'data': {'paymentKey': k3, 'orderId': n3, 'status': 'DONE'}})
    rec('T-18 재전송 → ALREADY', st in (200, 201) and w['action'] == 'ALREADY', (st, w))
    # VBANK 입금 전 만료
    n4, t4, _ = new_order(BUYT, base=BT, method='VBANK')
    k4 = 'mk-vbank-' + uuid.uuid4().hex[:12]
    T('POST', f'/health/orders/{n4}/pay/confirm', BUYT, {'paymentKey': k4, 'amount': t4})
    MOCK['pay'][k4]['status'] = 'EXPIRED'
    st, w = T('POST', '/webhooks/toss', None, {'eventType': 'PAYMENT_STATUS_CHANGED', 'data': {'paymentKey': k4, 'orderId': n4, 'status': 'EXPIRED'}})
    rec('T-19 입금 전 만료 → 결제 FAILED · 주문은 결제 대기(취소로 바꾸지 않음)', st in (200, 201) and w['action'] == 'FAILED' and ostat(n4).startswith('PENDING')
        and q(f"select state from hlt_payments where payment_key='{k4}'") == 'FAILED', (st, w))
    # 정리 — 시험 주문 닫기 (재고 원복)
    for n in (n3, n4):
        T('POST', '/me/health/returns', BUYT, {'orderNo': n, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        T('POST', f'/admin/health/returns/{return_id(n)}/decide', ADMT, {'state': 'APPROVED'})
    rv = return_id(n3)
    rec('T-20a 입금된 가상계좌 취소 승인 → 환불 계좌 없어 실패 · APPROVED 유지', q(f"select state||'|'||(refund_error is not null) from hlt_returns where id='{rv}'") == 'APPROVED|true',
        q(f"select refund_error from hlt_returns where id='{rv}'"))
    st, j = T('POST', f'/admin/health/returns/{rv}/refund', ADMT, {'refundReceiveAccount': {'bank': '20', 'accountNumber': '110-123-456789', 'holderName': '구매자'}})
    cx = [x for x in MOCK['log'] if x['path'] == f'/v1/payments/{k3}/cancel']
    rec('T-20b 가상계좌 환불 → refundReceiveAccount 가 토스로 감 · REFUNDED · 계좌는 DB 에 안 남음', q(f"select state from hlt_returns where id='{rv}'") == 'REFUNDED'
        and cx and cx[-1]['body'].get('refundReceiveAccount', {}).get('accountNumber') == '110-123-456789'
        and q("select count(*) from hlt_payments where vbank::text like '%110-123-456789%'") == '0', (st, j, cx[-1]['body'] if cx else None))
    srv.shutdown()
else:
    print('API_TOSS 없음 — 토스 어댑터(가짜 서버) 시험을 건너뜁니다', file=sys.stderr)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_pay.json')
json.dump(R, open(out, 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
