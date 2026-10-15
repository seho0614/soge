"""소개뱅크몰 반품 배송비 차감 (D009 · 10/2 결정 「단순 변심은 왕복 배송비 차감」) — API · 화면 검증.

  API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 python3 srv_retship.py
결과: srv_retship.json

정책(health-policy.ts): 고객 사정(CHANGE_MIND · WRONG_ORDER) **반품**은 왕복 배송비 6,000원을 환불액에서 뺀다.
  무료배송 주문: 결제 − 6,000 · 배송비 낸 주문: (상품 + 3,000) − 6,000 · 발송 전 취소 · 판매자 사유: 전액.
"""
import json, os, subprocess, sys, uuid, urllib.request, urllib.error
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import bo_tab as _bo_tab, bo_tab_names as _bo_tab_names   # v10.29 — 운영 화면 묶음 메뉴(묶음 단추 → .ad-snb 탭)

B = os.environ.get('API', 'http://localhost:3000/api/v1').rstrip('/')
SITE = os.environ.get('SITE', 'http://localhost:5174').rstrip('/')
BO = os.environ.get('BO', 'http://127.0.0.1:5173').rstrip('/')
DB = os.environ.get('DATABASE_URL', 'postgresql://sgb:sgb@localhost:5432/sgb')
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
FREE = os.environ.get('PROD', 'RED-30')        # 3만원 이상 — 무료배송
CHEAP = os.environ.get('PROD_CHEAP', 'BELL-30')  # 28,000원 — 3만원 미만. v10.25 부터 배송비 0(전 상품 무료 · 전에는 3,000원) · VITD-90 은 잠긴 갈래(건강기능식품)라 못 씀
RT = 6000
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:200], file=sys.stderr)


def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request(B + p, method=m, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=40); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e:
        st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js


def login(e, pw='sgb-dev-1234'):
    return call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']


BUY = login('buyer@x.com'); ADM = login('admin@x.com')


def paid_order(code, delivered=True):
    addr = next(a for a in call('GET', '/me/health/addresses', BUY)[1] if a['isDefault'])['id']
    st, o = call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': code, 'qty': 1}]})
    assert st < 300, (st, o)
    no = o['orderNo']
    st, p = call('POST', f'/health/orders/{no}/pay', BUY, {'method': 'CARD'}); assert st < 300, (st, p)
    st, c = call('POST', f'/health/orders/{no}/pay/confirm', BUY, {'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': int(o['total'])})
    assert st < 300 and c['state'] == 'PAID', (st, c)
    if delivered:
        oid = q(f"select id from hlt_orders where order_no='{no}'")
        q(f"update hlt_orders set created_at=least(created_at, now()-interval '3 days'), paid_at=least(coalesce(paid_at, now()), now()-interval '3 days') where id='{oid}'")   # v10.31 fn_hlt_order_time_guard — 주문 ≤ 결제 ≤ 발송 ≤ 배송 완료(시각을 과거로 돌릴 때 주문 · 결제 시각도 함께)
        q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid}','PICKED',now()-interval '2 days')")
        q(f"insert into hlt_shipments(order_id,state,happened_at) values ('{oid}','DELIVERED',now()-interval '1 day')")
    return no, int(o['total']), int(o.get('shipFee') or 0)


def ret(no, kind, reason, opened=False):
    body = {'orderNo': no, 'kind': kind, 'reason': reason}
    if kind != 'CANCEL': body['opened'] = opened
    st, r = call('POST', '/me/health/returns', BUY, body); assert st < 300, (st, r)
    dec = {'state': 'APPROVED'}
    if kind == 'RETURN': dec['opened'] = opened
    st, j = call('POST', f"/admin/health/returns/{r['id']}/decide", ADM, dec)
    return r['id'], st, j


def row(rid):
    return q(f"select state||'|'||refund_amount||'|'||ship_deduction from hlt_returns where id='{rid}'")


def canceled(no):
    return q(f"select p.state||'|'||coalesce(p.canceled_amount::text,'-') from hlt_payments p join hlt_orders o on o.id=p.order_id where o.order_no='{no}' and p.payment_key is not null")


# ══ 1. 주문 상세가 내려 주는 정책 값 ══
no1, t1, f1 = paid_order(FREE)
st, od = call('GET', f'/me/health/orders/{no1}', BUY)
rs = (od or {}).get('returnShip') or {}
rec('A-1 주문 상세 returnShip — 왕복 6,000 · 대상 사유 · 예상 환불액', st == 200 and rs.get('roundTripFee') == RT
    and set(rs.get('customerReasons', [])) == {'CHANGE_MIND', 'WRONG_ORDER'} and rs.get('customerRefundEstimate') == t1 - RT, rs)
pol = open(os.path.join(KIT, 'src/modules/health/health-policy.ts')).read()
util = open(os.path.join(KIT, 'site/src/components/health/util.ts')).read()
rec('A-2 화면 안내 상수 = 서버 정책 (6,000) · 주문 배송비 0 과 묶이지 않음(v10.25)', 'HLT_SHIP_FEE = 0' in pol and 'HLT_RETURN_SHIP_ROUND_TRIP = 6000' in pol and 'HLT_SHIP_FEE * 2' not in pol and 'RETURN_SHIP_ROUND_TRIP = 6000' in util)

# ══ 2. 무료배송 주문 · 단순 변심 반품 → 결제 − 6,000 ══
rid1, st, j = ret(no1, 'RETURN', 'CHANGE_MIND')
rec('B-1 무료배송 · 단순 변심 반품 승인 → 결제 − 6,000 환불 · 차감 기록', st < 300 and row(rid1) == f'REFUNDED|{t1 - RT}|{RT}', (st, row(rid1), j))
rec('B-2 결제 부분 취소 금액 = 환불액', canceled(no1) == f'CANCELED|{t1 - RT}', canceled(no1))
rec('B-3 승인 안내 문구에 차감 표시', '왕복 배송비 6,000원을 빼고' in (j or {}).get('note', ''), (j or {}).get('note'))
st, mine = call('GET', '/me/health/returns', BUY)
m = next((x for x in mine if x['id'] == rid1), {})
rec('B-4 고객 내역 shipDeduction · refundAmount', int(m.get('shipDeduction') or -1) == RT and int(m.get('refundAmount') or 0) == t1 - RT, m)
st, al = call('GET', '/admin/health/returns?state=REFUNDED', ADM)
a = next((x for x in al if x['id'] == rid1), {})
rec('B-5 운영 목록 shipDeduction', int(a.get('shipDeduction') or -1) == RT, a)
st, again = call('POST', f'/admin/health/returns/{rid1}/refund', ADM)
rec('B-6 환불 재시도 → 같은 금액 · 차감 유지(재시도 안전)', st < 300 and again.get('again') is True and int(again['refundAmount']) == t1 - RT and int(again.get('shipDeduction') or 0) == RT, (st, again))

# ══ 3. 배송비 낸 주문 · 잘못 주문 반품 → (상품 + 3,000) − 6,000 ══
no2, t2, f2 = paid_order(CHEAP)
rid2, st, j = ret(no2, 'RETURN', 'WRONG_ORDER')
rec('C-1 3만원 미만 주문도 배송비 0(전 상품 무료 · v10.25) · 잘못 주문 반품 → 결제 − 6,000', f2 == 0 and st < 300 and row(rid2) == f'REFUNDED|{t2 - RT}|{RT}', (f2, t2, row(rid2)))

# ══ 4. 판매자 사유 · 발송 전 취소 → 전액 ══
no3, t3, _ = paid_order(FREE)
rid3, st, j = ret(no3, 'RETURN', 'DEFECT')
rec('D-1 파손 · 불량 반품 → 전액 · 차감 0', st < 300 and row(rid3) == f'REFUNDED|{t3}|0', row(rid3))
no4, t4, _ = paid_order(FREE, delivered=False)
rid4, st, j = ret(no4, 'CANCEL', 'CHANGE_MIND')
rec('D-2 발송 전 취소(단순 변심) → 전액 · 차감 0', st < 300 and row(rid4) == f'REFUNDED|{t4}|0', row(rid4))
no5, t5, _ = paid_order(FREE)
rid5, st, j = ret(no5, 'RETURN', 'MISMATCH')
rec('D-3 표시와 다름 반품 → 전액', st < 300 and row(rid5) == f'REFUNDED|{t5}|0', row(rid5))

# ══ 5. DB 가 집행 ══
e = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', f"update hlt_returns set ship_deduction=6000 where id='{rid3}'"], capture_output=True, text=True)
rec('E-1 판매자 사유 반품에 차감 넣기 → DB 거부(ck_hlt_returns_ship_deduction)', e.returncode != 0 and 'ck_hlt_returns_ship_deduction' in e.stderr, e.stderr.strip()[:120])
rec('E-2 감시 뷰 v_hlt_refund_mismatch = 0', q('select count(*) from v_hlt_refund_mismatch') == '0')

# ══ 6. 화면 ══
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(); pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(SITE + '/login'); __import__('consent_ok').agree('buyer@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234')
    pg.click('form.auth button'); pg.wait_for_timeout(2500)
    no6, t6, _ = paid_order(FREE)
    pg.goto(f'{SITE}/my/health/returns/new?o={no6}', wait_until='networkidle')
    pg.locator('button[role=radio]', has_text='반품').first.click()
    pg.select_option('form.hlt-form select', 'CHANGE_MIND'); pg.wait_for_timeout(300)
    est = pg.locator('[data-refund-estimate]')
    txt = pg.inner_text('form.hlt-form')
    rec('U-1 반품 신청 화면: 단순 변심 → 왕복 배송비 6,000원 안내 · 예상 환불액 = 서버 값',
        '왕복 배송비 6,000원' in txt and est.count() == 1 and est.get_attribute('data-refund-estimate') == str(t6 - RT), txt[-200:])
    pg.select_option('form.hlt-form select', 'DEFECT'); pg.wait_for_timeout(300)
    rec('U-2 판매자 사유로 바꾸면 예상 차감 없음', pg.locator('[data-refund-estimate]').count() == 0 and '배송비가 들지 않습니다' in pg.inner_text('form.hlt-form'))
    pg.goto(f'{SITE}/my/health/returns', wait_until='networkidle')
    cell = pg.locator(f'[data-ship-deduction="{RT}"]')
    rec('U-3 취소 · 반품 내역: 환불 금액 옆 「왕복 배송비 6,000원 차감」', cell.count() >= 1 and '왕복 배송비 6,000원 차감' in cell.first.inner_text(), cell.count())
    pg.goto(f'{SITE}/health/guide', wait_until='networkidle')
    rec('U-4 이용 안내에 6,000원 · 환불 금액에서 뺌', '왕복 배송비 6,000원' in pg.inner_text('main'))
    rec('U-5 화면 스크립트 오류 0', not errs, errs[:2])
    c.close()
    ret(no6, 'RETURN', 'DEFECT')   # 정리 — 화면 확인용 주문을 판매자 사유 반품으로 닫아 재고를 되돌립니다
    # 운영 BO — 승인 전 미리 보기 · 환불 완료 표시
    no7, t7, _ = paid_order(FREE)
    st, r7 = call('POST', '/me/health/returns', BUY, {'orderNo': no7, 'kind': 'RETURN', 'reason': 'CHANGE_MIND', 'opened': False})
    c = b.new_context(); pg = c.new_page(); dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    pg.goto(BO); pg.wait_for_timeout(800)
    __import__('consent_ok').agree('admin@x.com', 'sgb-dev-1234'); pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('form button[type=submit]'); pg.wait_for_timeout(1500)
    _bo_tab(pg, '소개몰 정산'); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
    rowl = pg.locator(f'tr[data-return="{r7["id"]}"]')
    prev = rowl.locator('[data-deduct-preview]')
    rec('U-6 BO 승인 전 미리 보기: 왕복 배송비 6,000원을 빼고 (결제 − 6,000)원 환불',
        prev.count() == 1 and f'{t7 - RT:,}원을 환불' in prev.inner_text(), prev.inner_text() if prev.count() else rowl.count())
    rowl.get_by_label('미개봉 — 재고로 되돌림').check()
    rowl.locator('button', has_text='승인').click(); pg.wait_for_timeout(2500)
    rec('U-7 BO 승인 확인창에 차감 · 환불액 · 실제 환불 = 결제 − 6,000',
        any('왕복 배송비 6,000원을 빼고' in m and f'{t7 - RT:,}원을 환불' in m for m in dialogs) and row(r7['id']) == f'REFUNDED|{t7 - RT}|{RT}',
        (dialogs[-1:] if dialogs else None, row(r7['id'])))
    pg.reload(); pg.wait_for_timeout(1000)
    _bo_tab(pg, '소개몰 정산'); pg.wait_for_timeout(1500)   # v10.29 — 묶음 단추 → .ad-snb 탭
    pg.locator('button', has_text='환불 완료').first.click(); pg.wait_for_timeout(1500)
    done = pg.locator(f'tr[data-return="{r7["id"]}"] [data-ship-deduction="{RT}"]')
    rec('U-8 BO 처리 후: 「환불 N원 (왕복 배송비 6,000원 차감)」 표시', done.count() == 1 and '왕복 배송비 6,000원 차감' in done.inner_text(),
        done.inner_text() if done.count() else '-')
    c.close(); b.close()

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_retship.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
