"""소개뱅크몰 결제 · 환불 · 개봉 반품 — 화면 검증 (Playwright, 실제 로그인 · 버튼 클릭) (D006).

  API=http://localhost:3021/api/v1 SITE=http://localhost:5201 BO=http://localhost:5202 python3 srv_pay_ui.py
  선택: SITE_KEY=http://localhost:5291 — NEXT_PUBLIC_TOSS_CLIENT_KEY 를 넣어 빌드한 사이트.
        토스 SDK(js.tosspayments.com/v1/payment)를 가짜 SDK 로 가로채 결제창 → 성공 주소 → 승인 경로를 봅니다.
결과: srv_pay_ui.json
"""
import json, os, sys, uuid, subprocess, urllib.request
from playwright.sync_api import sync_playwright
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)

B = os.environ.get('API', 'http://localhost:3000/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174')
SITE_KEY = os.environ.get('SITE_KEY')
BO = os.environ.get('BO', 'http://127.0.0.1:5173')
DB = os.environ.get('DATABASE_URL', 'postgresql://sgb:sgb@localhost:5432/sgb')
PROD = os.environ.get('PROD', 'RED-30')
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:200]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)


def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(B + p, method=m, data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')


BUY = call('POST', '/auth/login', body={'email': 'buyer@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
ADDR = next(a for a in call('GET', '/me/health/addresses', BUY)[1] if a['isDefault'])['id']
stock = lambda: int(q(f"select stock from hlt_products where code='{PROD}'"))
ostat = lambda no: q(f"select status||'|'||coalesce(restocked_at::text,'-')||'|'||coalesce(restock_skipped,'-') from hlt_orders where order_no='{no}'")
text = lambda pg: pg.evaluate("document.body.innerText")


def order():
    st, o = call('POST', '/health/orders', BUY, {'addressId': ADDR, 'items': [{'productCode': PROD, 'qty': 1}]})
    assert st < 300, (st, o)
    return o['orderNo'], int(o['total'])


def paid_delivered():
    no, t = order()
    call('POST', f'/health/orders/{no}/pay', BUY, {'method': 'CARD'})
    st, c = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': t})
    assert c['state'] == 'PAID', c
    oid = q(f"select id from hlt_orders where order_no='{no}'")
    q(f"update hlt_orders set created_at=least(created_at, now()-interval '3 days'), paid_at=least(coalesce(paid_at, now()), now()-interval '3 days') where id='{oid}'")   # v10.31 fn_hlt_order_time_guard — 주문 ≤ 결제 ≤ 발송 ≤ 배송 완료(시각을 과거로 돌릴 때 주문 · 결제 시각도 함께)
    q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid}','PICKED',now()-interval '2 days')")
    q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid}','DELIVERED',now()-interval '1 day')")
    return no, t


def site_login(b, base):
    c = b.new_context(); pg = c.new_page(); pg.on('dialog', lambda d: d.accept())
    pg.goto(base + '/login'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234')
    pg.click('form.auth button'); pg.wait_for_timeout(2000)
    return c, pg


with sync_playwright() as p:
    b = p.chromium.launch()
    c, pg = site_login(b, SITE)

    # ── 시험 결제(스텁) — 카드 ──
    no, t = order()
    pg.goto(f'{SITE}/health/order/pay?no={no}'); t1 = text(pg)
    btn = pg.locator('button.cta-primary')
    rec('U-1 키 없는 환경: "시험 결제(스텁)" 버튼 · 안내', '시험 결제(스텁)' in btn.inner_text() and '실제 돈은 오가지 않습니다' in t1, btn.inner_text())
    btn.click(); pg.wait_for_url('**/health/order/done**', timeout=20000); pg.wait_for_timeout(500); t2 = text(pg)
    rec('U-2 버튼 → 승인 → 주문 완료 화면 · "시험 결제" 표시 · 결제 완료', '결제가 완료되었습니다' in t2 and '시험 결제' in t2 and '결제 완료' in t2
        and ostat(no).startswith('PAID') and q(f"select stub from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{no}' and p.state='PAID'") == 't', t2[:160])
    # 정리 — 결제한 시험 주문 취소·환불 (재고 원복)
    call('POST', '/me/health/returns', BUY, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    rid0 = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no}'")

    # ── 가상계좌 (스텁) → 웹훅 입금 ──
    nv, tv = order()
    pg.goto(f'{SITE}/health/order/pay?no={nv}')
    pg.locator('.hlt-chip', has_text='가상계좌').click()
    pg.locator('button.cta-primary').click(); pg.wait_for_url('**/health/order/done**', timeout=20000); pg.wait_for_timeout(500); t3 = text(pg)
    rec('U-3 가상계좌 → 입금하실 계좌 안내 · 결제 대기', '입금하실 계좌' in t3 and '000-0000-0000-00' in t3 and ostat(nv).startswith('PENDING'), t3[:200])
    st, w = call('POST', '/webhooks/toss', None, {'createdAt': 'x', 'status': 'DONE', 'transactionKey': 't', 'orderId': nv, 'secret': 's'})
    pg.reload(); t4 = text(pg)
    rec('U-4 입금 알림(웹훅) 뒤 새로고침 → 결제 완료', w.get('action') == 'PAID' and '결제가 완료되었습니다' in t4, (w.get('action'), t4[:80]))
    call('POST', '/me/health/returns', BUY, {'orderNo': nv, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})

    # ── 결제창 성공 주소 직접 (금액 조작 · 정상) ──
    ns, ts = order()
    call('POST', f'/health/orders/{ns}/pay', BUY, {'method': 'CARD'})
    pg.goto(f'{SITE}/health/order/pay/success?paymentKey=stub_{uuid.uuid4().hex}&orderId={ns}&amount={ts - 1000}')
    pg.wait_for_url('**/health/order/fail**', timeout=20000); pg.wait_for_timeout(300); t5 = text(pg)
    rec('U-5 성공 주소 amount 조작 → 주문 실패 화면 · AMOUNT_MISMATCH · 결제 대기 유지', 'AMOUNT_MISMATCH' in t5 and '돈은 나가지 않았습니다' in t5 and ostat(ns).startswith('PENDING'), t5[:160])
    pg.goto(f'{SITE}/health/order/pay/success?paymentKey=stub_{uuid.uuid4().hex}&orderId={ns}&amount={ts}')
    pg.wait_for_url('**/health/order/done**', timeout=20000); pg.wait_for_timeout(300)
    rec('U-6 성공 주소 정상 → 승인 → 주문 완료', '결제가 완료되었습니다' in text(pg) and ostat(ns).startswith('PAID'), ostat(ns))
    call('POST', '/me/health/returns', BUY, {'orderNo': ns, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    pg.goto(f'{SITE}/health/order/fail?step=pay&no={ns}&code=PAY_PROCESS_CANCELED&message=%EC%82%AC%EC%9A%A9%EC%9E%90%EA%B0%80%20%EA%B2%B0%EC%A0%9C%EB%A5%BC%20%EC%B7%A8%EC%86%8C%ED%96%88%EC%8A%B5%EB%8B%88%EB%8B%A4')
    t6 = text(pg)
    rec('U-7 토스 실패 주소(code · message) → 문구 · 안내 표시', '사용자가 결제를 취소했습니다' in t6 and '결제를 취소하셨습니다' in t6, t6[:120])

    # ── 고객 반품 신청: 개봉 여부 ──
    nr, tr = paid_delivered()
    pg.goto(f'{SITE}/my/health/returns/new?o={nr}')
    pg.locator('.hlt-chip', has_text='열었습니다').click(); t7 = text(pg)
    pg.locator('button.cta-primary').click(); pg.wait_for_timeout(2000)
    rid_open = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{nr}'")
    rec('U-8 반품 신청 화면 "포장을 여셨나요?" → 열었습니다 → 접수 (참고값 저장)', '포장을 여셨나요' in t7 and pg.locator('.ok-note').count() == 1
        and q(f"select customer_opened from hlt_returns where id='{rid_open}'") == 't', t7[:80])
    nr2, tr2 = paid_delivered()
    st, r2 = call('POST', '/me/health/returns', BUY, {'orderNo': nr2, 'kind': 'RETURN', 'reason': 'DEFECT'})
    rid_un = r2['id']
    c.close()

    # ── 운영(BO): 개봉 판정 · 환불 · 다시 시도 ──
    c = b.new_context(); pg = c.new_page(); dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    pg.goto(BO); pg.wait_for_timeout(800)
    __import__('consent_ok').agree('admin@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
    _bo_tab(pg, '소개몰 정산'); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
    row = pg.locator(f'tr[data-return="{rid_open}"]')
    ok_btn = row.locator('button', has_text='승인')
    rec('U-9 반품: 개봉 판정 전 승인 버튼 잠김 · 고객 표시 보임', row.count() == 1 and ok_btn.is_disabled() and '열었다고 적음' in row.inner_text(), row.count())
    row.get_by_label('개봉됨 — 재판매 불가, 재고로 되돌리지 않음').check()
    s_open = stock()
    ok_btn.click(); pg.wait_for_timeout(2500)
    rec('U-10 개봉됨 선택 → 승인 → 반품 완료 · 재고 그대로 · 환불 · 확인창에 재고 미복구 안내',
        ostat(nr) == 'RETURNED|-|OPENED' and stock() == s_open and q(f"select state from hlt_returns where id='{rid_open}'") == 'REFUNDED'
        and any('재고로 되돌리지 않습니다' in m and '환불' in m for m in dialogs), (ostat(nr), s_open, stock(), dialogs[-1:] if dialogs else None))
    q(f"update hlt_product_options set stock = stock + 1 where product_id=(select id from hlt_products where code='{PROD}')")   # 공용 개발 DB — 개봉 반품 시험이 줄인 1개 원복
    row = pg.locator(f'tr[data-return="{rid_un}"]')
    row.get_by_label('미개봉 — 재고로 되돌림').check()
    s_un = stock()
    row.locator('button', has_text='승인').click(); pg.wait_for_timeout(2500)
    rec('U-11 미개봉 선택 → 승인 → 반품 완료 · 재고 +1 · 환불', ostat(nr2).startswith('RETURNED|2') and stock() == s_un + 1
        and q(f"select state from hlt_returns where id='{rid_un}'") == 'REFUNDED', (ostat(nr2), s_un, stock()))
    # 취소 승인 (위 고객 화면에서 결제한 주문) → 환불
    row = pg.locator(f'tr[data-return="{rid0}"]')
    row.locator('button', has_text='승인').click(); pg.wait_for_timeout(2500)
    rec('U-12 결제된 주문 취소 승인 → 환불 완료 메시지', q(f"select state from hlt_returns where id='{rid0}'") == 'REFUNDED' and '환불했습니다' in text(pg), text(pg)[:0])
    for no_ in (nv, ns):
        rid_ = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{no_}'")
        call('POST', f'/admin/health/returns/{rid_}/decide', call('POST', '/auth/login', body={'email': 'admin@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken'], {'state': 'APPROVED'})

    # 환불 실패 상태(승인 · 결제 PAID · 사유)를 만들어 「환불 다시 시도」 버튼을 누릅니다 (스텁은 취소가 늘 성공하므로 DB 로 실패 뒤 상태를 재현)
    nf, tf = order()
    call('POST', f'/health/orders/{nf}/pay', BUY, {'method': 'CARD'})
    call('POST', f'/health/orders/{nf}/pay/confirm', BUY, {'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': tf})
    st, rf = call('POST', '/me/health/returns', BUY, {'orderNo': nf, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    oidf = q(f"select id from hlt_orders where order_no='{nf}'")
    q(f"update hlt_orders set status='CANCELED' where id='{oidf}'")
    q(f"update hlt_returns set state='APPROVED', decided_at=now(), refund_error='시험: PG 응답 지연', refund_tried_at=now() where id='{rf['id']}'")
    pg.locator('.acts button', has_text='승인').first.click(); pg.wait_for_timeout(1500)
    row = pg.locator(f'tr[data-return="{rf["id"]}"]')
    rec('U-13 승인 탭: 환불 실패 사유 · 「환불 다시 시도」 버튼', row.count() == 1 and '환불 실패: 시험: PG 응답 지연' in row.inner_text() and row.locator('button', has_text='환불 다시 시도').count() == 1, row.count())
    row.locator('button', has_text='환불 다시 시도').click(); pg.wait_for_timeout(2500)
    rec('U-14 다시 시도 → 환불 완료 · 결제 취소', q(f"select state||'|'||coalesce(refund_error,'-') from hlt_returns where id='{rf['id']}'") == 'REFUNDED|-'
        and q(f"select state from hlt_payments where order_id='{oidf}' and payment_key is not null") == 'CANCELED', q(f"select state from hlt_returns where id='{rf['id']}'"))
    pg.locator('.acts button', has_text='환불 완료').first.click(); pg.wait_for_timeout(1500)
    rt = pg.locator(f'tr[data-return="{rid_open}"]').inner_text() if pg.locator(f'tr[data-return="{rid_open}"]').count() else ''
    rec('U-15 환불 완료 탭: 판정(개봉) · 환불액 · 재고 미복구 표시', '판정: 개봉' in rt and '환불' in rt and '재고 미복구' in rt, rt[:120])
    c.close()

    # ── 결제창(토스 SDK v1) 경로 — 가짜 SDK 로 가로챔 ──
    if SITE_KEY:
        FAKE = """window.TossPayments = function (ck) { return { requestPayment: function (m, p) {
          window.__toss = { ck: ck, m: m, p: p }; localStorage.setItem('__toss', JSON.stringify(window.__toss));
          if (window.__tossCancel) return Promise.reject({ code: 'USER_CANCEL', message: '취소' });
          location.href = p.successUrl + '?paymentKey=stub_sdk' + Date.now() + '&orderId=' + p.orderId + '&amount=' + p.amount;
          return new Promise(function () {}); } }; };"""
        c, pg = site_login(b, SITE_KEY)
        seen = []
        pg.route('https://js.tosspayments.com/v1/payment', lambda r: (seen.append(r.request.url), r.fulfill(status=200, content_type='application/javascript', body=FAKE)))
        nk, tk = order()
        pg.goto(f'{SITE_KEY}/health/order/pay?no={nk}')
        rec('U-16 키 있는 환경: "결제하기" 버튼(스텁 문구 없음)', '결제하기' in pg.locator('button.cta-primary').inner_text() and '시험 결제(스텁)' not in text(pg), pg.locator('button.cta-primary').inner_text())
        pg.evaluate("window.__tossCancel = true")
        pg.locator('button.cta-primary').click(); pg.wait_for_timeout(2000)
        rec('U-17 결제창 닫음(USER_CANCEL) → 안내 · 결제 대기 유지', '결제를 취소하셨습니다' in text(pg) and ostat(nk).startswith('PENDING'), text(pg)[:0])
        pg.evaluate("window.__tossCancel = false")
        pg.locator('button.cta-primary').click(); pg.wait_for_url('**/health/order/done**', timeout=20000); pg.wait_for_timeout(500)
        tp = json.loads(pg.evaluate("localStorage.getItem('__toss')") or '{}')
        rec('U-18 SDK 로드(공식 v1 주소) · requestPayment(카드, orderId=주문번호, amount=주문금액, success/fail 주소)',
            seen and seen[0] == 'https://js.tosspayments.com/v1/payment' and tp.get('m') == '카드' and tp['p']['orderId'] == nk and tp['p']['amount'] == tk
            and tp['p']['successUrl'].endswith('/health/order/pay/success') and '/health/order/fail?step=pay' in tp['p']['failUrl'] and tp.get('ck', '').startswith('test_ck_'), tp)
        rec('U-19 성공 주소 → 서버 승인 → 주문 완료', '결제가 완료되었습니다' in text(pg) and ostat(nk).startswith('PAID'), ostat(nk))
        call('POST', '/me/health/returns', BUY, {'orderNo': nk, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        rid_ = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{nk}'")
        call('POST', f'/admin/health/returns/{rid_}/decide', call('POST', '/auth/login', body={'email': 'admin@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken'], {'state': 'APPROVED'})
        c.close()
    b.close()

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_pay_ui.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
