"""v10.28 — 서버 · DB 확인. 반영 전에 먼저 쓰고 실패를 본 시험입니다(10/9 반영 전 확인 · 「권장대로」).

  A  발송 처리 · 구매확정(G-147 · G-194 · D035)
  (뒤에 더함) B 리뷰 · 문의 · C 순위 · D G-214 · E 상담 이메일 · F 개인 정산 · G 약관 한 벌 · 재동의

사용:  python3 fix_1028.py [A B …]      (없으면 A ~ G 전부)   결과 fix_1028.json
시험이 만드는 것: 시험 회원(fx8_*@t.local) · 그 회원의 소개몰 주문(끝에 반품 · 취소로 닫음). 계정은 남습니다.
"""
import sys, os, re, json, uuid, subprocess, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import *

HERE = os.path.dirname(os.path.abspath(__file__))
# 킷의 sgb 폴더 — 환경 값 KIT(Docker 시험은 /tmp/dock_kit/sgb) · 없으면 이 파일 옆의 ../sgb · 그것도 없으면 작업본
KITS = os.environ.get('KIT') or (os.path.join(HERE, '..', 'sgb') if os.path.isdir(os.path.join(HERE, '..', 'sgb')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')

JOB_TOKEN = os.environ.get('JOB_TOKEN', 'docker-test-job-token-0123456789abcdef')
R = []
# v10.31 (W5 · D070) — 리드 이용료가 선불 충전으로 바뀌어 잔액 0인 업체에는 상담이 배정되지 않습니다.
#   시험 전에 활동 중 업체(잔액 5만 원 미만)에 시험 결제(스텁) 30만 원을 넣습니다(kit scripts/seed-lead-cash-dev.sql 과 같은 일).
import subprocess as _sp, os as _os
_sp.run(['psql', DB, '-qc', "DO $w5$ DECLARE r record; v_id uuid; BEGIN FOR r IN SELECT p.id, p.grade FROM partners p LEFT JOIN lead_cash_wallets w ON w.partner_id = p.id WHERE p.status = 'ACTIVE' AND coalesce(w.paid_balance,0) + coalesce(w.bonus_balance,0) < 50000 LOOP INSERT INTO lead_cash_charges(partner_id, order_id, amount, bonus_rate, bonus_amount) VALUES (r.id, 'lc-seed' || replace(gen_random_uuid()::text,'-',''), 300000, 0, 0) RETURNING id INTO v_id; PERFORM fn_lead_cash_charge_done(v_id, 'stub_seed_' || v_id::text, 'STUB', true, NULL); END LOOP; END $w5$"], capture_output=True)

def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), step, '|', str(detail)[:220], file=sys.stderr, flush=True)
def safe(name, fn):
    try: fn()
    except Exception as ex: rec(f'{name} 실행 중 오류', False, repr(ex)[:300])

ADM = login('admin@x.com'); tag = uuid.uuid4().hex[:6]
PARTS = set(a for a in sys.argv[1:] if len(a) == 1) if __name__ == '__main__' else set()
PARTS = PARTS or (set('ABCDEFGHI') if __name__ == '__main__' else set())      # 인자가 없으면 전부(A ~ I)

def member(prefix='fx8', name='구매확정 시험'):
    em, pw, tok, aid = signup(prefix, name)
    call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
    st, a = call('POST', '/me/health/addresses', tok, {'receiver': '확인', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
    addr = (a or {}).get('id') or q(f"select id from hlt_addresses where account_id='{aid}' limit 1")
    return em, pw, tok, aid, addr

def product():
    r = rows("""select p.code, o.id from hlt_products p join hlt_product_options o on o.product_id=p.id and o.is_active
                where p.status='ON_SALE' and o.stock >= 5 and p.code !~ '^OPTTEST' order by p.price limit 1""")
    return r[0] if r else (None, None)

def paid_order(tok, addr):
    code, opt = product()
    st, o = call('POST', '/health/orders', tok, {'addressId': addr, 'items': [{'productCode': code, 'optionId': opt, 'qty': 1}]})
    no = (o or {}).get('orderNo')
    call('POST', f'/health/orders/{no}/pay', tok, {'method': 'CARD'})
    call('POST', f'/health/orders/{no}/pay/confirm', tok, {'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': int((o or {}).get('total', 0))})
    return no

def status(no): return q(f"select status from hlt_orders where order_no='{no}'")
def run_job(job):
    return call('POST', '/admin/jobs/run', None, {'job': job}, headers={'x-job-token': JOB_TOKEN})


def part_a():
    em, pw, T, aid, addr = member()
    st, lst = call('GET', '/admin/health/orders', ADM)
    rec('A-1 운영 「소개몰 주문」 목록 200 — 상태별 수 · 택배사 목록', st == 200 and isinstance((lst or {}).get('counts'), dict) and '우체국택배' in ((lst or {}).get('carriers') or []), st)
    st, _ = call('GET', '/admin/health/orders', T)
    rec('A-2 운영자가 아니면 403', st == 403, st)

    no = paid_order(T, addr)
    rec('A-3 (준비) 결제 완료 주문', status(no) == 'PAID', (no, status(no)))
    st, j = call('POST', f'/admin/health/orders/{no}/ship', ADM, {'carrier': '아무택배', 'trackingNo': '123456789012'})
    st2, j2 = call('POST', f'/admin/health/orders/{no}/ship', ADM, {'carrier': 'CJ대한통운', 'trackingNo': '12-34'})
    rec('A-4 발송 처리 — 목록 밖 택배사 · 형식이 틀린 송장은 거절(400/422) · 주문 그대로', st in (400, 422) and st2 in (400, 422) and status(no) == 'PAID', (st, st2))
    st, j = call('POST', f'/admin/health/orders/{no}/ship', ADM, {'carrier': 'CJ대한통운', 'trackingNo': '623600000001'})
    who = q(f"select a.email from hlt_shipments s join hlt_orders o on o.id=s.order_id join accounts a on a.id=s.created_by where o.order_no='{no}' order by s.happened_at desc limit 1")
    rec('A-5 발송 처리 → 「배송중」 · 배송 기록에 택배사 · 송장 · 넣은 사람', st < 300 and status(no) == 'SHIPPED' and who == 'admin@x.com', (st, status(no), who))
    st, j = call('POST', f'/admin/health/orders/{no}/ship', ADM, {'carrier': 'CJ대한통운', 'trackingNo': '623600000002'})
    rec('A-6 이미 발송한 주문을 또 발송 → 409 NOT_SHIPPABLE', st == 409 and (j or {}).get('code') == 'NOT_SHIPPABLE', (st, (j or {}).get('code')))
    st, j = call('POST', f'/admin/health/orders/{no}/tracking', ADM, {'carrier': '한진택배', 'trackingNo': '512300000009'})
    st2, sh = call('GET', f'/me/health/orders/{no}/shipments', T)
    last = (sh or {}).get('trackingNo') if isinstance(sh, dict) else None
    n = q(f"select count(*) from hlt_shipments s join hlt_orders o on o.id=s.order_id where o.order_no='{no}'")
    rec('A-7 송장 고치기(배송중) — 새 기록으로 더함(전 기록 남음 · 2줄) · 구매자 배송 조회에 고친 송장', st < 300 and n == '2' and ('512300000009' in json.dumps(sh, ensure_ascii=False)), (st, n, str(sh)[:160]))
    st, j = call('POST', f'/me/health/orders/{no}/confirm', T)
    rec('A-8 배송 완료 전 구매확정 → 409 NOT_DELIVERED', st == 409 and (j or {}).get('code') == 'NOT_DELIVERED', (st, (j or {}).get('code')))
    st, j = call('POST', f'/admin/health/orders/{no}/advance', ADM, {'state': 'DELIVERED'})
    due = q(f"select to_char(fn_hlt_confirm_due(id) at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') from hlt_orders where order_no='{no}'")
    want = q(f"select to_char((((delivered_at at time zone 'Asia/Seoul')::date) + greatest(7,(select coalesce(max(w.days),7) from hlt_order_items i join withdrawal_rules w on w.code=i.withdrawal_code where i.order_id=hlt_orders.id)) + 1)::timestamp,'YYYY-MM-DD HH24:MI') from hlt_orders where order_no='{no}'")
    rec('A-9 배송 완료로 → 「배송 완료」 · 자동 확정 기한 = 배송 완료 날 + max(7, 청약철회 일수) 다음 날 0시(한국)', st < 300 and status(no) == 'DELIVERED' and due == want and due.endswith('00:00'), (st, status(no), due, want))
    st, j = call('POST', f'/admin/health/orders/{no}/tracking', ADM, {'carrier': '한진택배', 'trackingNo': '512300000010'})
    rec('A-10 배송 완료 뒤 송장 고치기 → 409 NOT_SHIPPING', st == 409, st)
    _, _, T2, _, _ = member('fx8o', '남의 주문')
    st, _ = call('POST', f'/me/health/orders/{no}/confirm', T2)
    rec('A-11 남의 주문 구매확정 → 404', st == 404, st)
    # 처리 중인 신청이 있으면 확정 안 됨(서버 · DB)
    st, rr = call('POST', '/me/health/returns', T, {'orderNo': no, 'kind': 'RETURN', 'reason': 'CHANGE_MIND'})
    st2, j = call('POST', f'/me/health/orders/{no}/confirm', T)
    rc, er = sql(f"update hlt_orders set status='CONFIRMED', confirmed_by='BUYER' where order_no='{no}'")
    rec('A-12 반품 신청이 처리 중이면 구매확정 409 RETURN_IN_PROGRESS · DB 에서 직접 바꿔도 막힘(HLTC)', st < 300 and st2 == 409 and rc != 0 and 'HLTC' in (er or ''), (st, st2, (er or '')[:80]))
    rid = (rr or {}).get('id')
    if rid: call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'REJECTED', 'note': '시험 — 반려'})
    st, j = call('POST', f'/me/health/orders/{no}/confirm', T)
    st2, j2 = call('POST', f'/me/health/orders/{no}/confirm', T)
    by = q(f"select confirmed_by from hlt_orders where order_no='{no}'")
    rec('A-13 신청이 끝나면 구매확정 → CONFIRMED · BUYER · 두 번 눌러도 already:true', st < 300 and status(no) == 'CONFIRMED' and by == 'BUYER' and (j2 or {}).get('already') is True, (st, status(no), by, (j2 or {}).get('already')))
    st, my = call('GET', f'/me/health/orders/{no}', T)
    rec('A-14 내 주문 상세에 구매확정 시각', st == 200 and (my or {}).get('confirmedAt') and (my or {}).get('status') == 'CONFIRMED', (st, (my or {}).get('status')))
    # 확정 뒤에도 법정 기간 안의 반품 신청은 받음 → 승인하면 RETURNED
    st, rr = call('POST', '/me/health/returns', T, {'orderNo': no, 'kind': 'RETURN', 'reason': 'DEFECT', 'detail': '시험 — 하자'})
    rid = (rr or {}).get('id')
    st2, j = call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'APPROVED', 'note': '시험 — 승인', 'opened': False}) if rid else (0, {})
    rec('A-15 구매확정 뒤에도 법정 기간 안의 반품 신청을 받고(하자 3개월), 승인하면 「반품」', st < 300 and st2 < 300 and status(no) == 'RETURNED', (st, st2, status(no), str(j)[:120]))
    rc, er = sql(f"insert into hlt_shipments(order_id, state, note) select id,'IN_TRANSIT','시험' from hlt_orders where order_no='{no}'")
    rc2, er2 = sql(f"update hlt_shipments set note='고침' where order_id=(select id from hlt_orders where order_no='{no}')")
    rec('A-16 DB — 닫힌 주문에 배송 기록 넣기 막힘(HLTS) · 배송 기록 고치기 막힘(쌓기만)', rc != 0 and rc2 != 0 and 'HLTS' in (er or '') and 'HLTS' in (er2 or ''), ((er or '')[:60], (er2 or '')[:60]))
    # 자동 확정 — 배송 완료가 기한을 지난 주문 · 처리 중인 신청이 있는 주문
    no2 = paid_order(T, addr); no3 = paid_order(T, addr)
    for x in (no2, no3):
        call('POST', f'/admin/health/orders/{x}/ship', ADM, {'carrier': '롯데택배', 'trackingNo': '230000000' + x[-3:]})
        # v10.31 (w3 D064 fn_hlt_order_time_guard — 주문 ≤ 결제 ≤ 발송 ≤ 배송 완료) — 배송 완료를 20일 전으로 둘 때 주문 · 결제 · 발송 시각도 그 앞으로
        sql(f"update hlt_orders set created_at = now() - interval '23 days', paid_at = now() - interval '22 days', shipped_at = now() - interval '21 days' where order_no='{x}'")
        sql(f"insert into hlt_shipments(order_id, carrier, tracking_no, state, note, happened_at) select id,'롯데택배','230000000{x[-3:]}','DELIVERED','시험 — 지난 배송 완료', now() - interval '20 days' from hlt_orders where order_no='{x}'")
    st, rr3 = call('POST', '/me/health/returns', T, {'orderNo': no3, 'kind': 'RETURN', 'reason': 'DEFECT', 'detail': '시험 — 처리 중'})
    st, j = run_job('hlt_auto_confirm')
    rec('A-17 자동 확정 작업(하루 1회) — 기한이 지난 배송 완료 주문은 CONFIRMED · AUTO · 처리 중인 신청이 있는 주문은 건너뜀',
        st < 300 and status(no2) == 'CONFIRMED' and q(f"select confirmed_by from hlt_orders where order_no='{no2}'") == 'AUTO' and status(no3) == 'DELIVERED', (st, str(j)[:120], status(no2), status(no3)))
    rec('A-18 작업 일정에 hlt_auto_confirm(하루 1회)', q("select every_min from job_schedules where job='hlt_auto_confirm'") == '1440', '')
    rec('A-19 정산 대상(v_hlt_settle_ready)에 구매확정 주문도 들어감', q(f"select count(*) from v_hlt_settle_ready where order_no='{no2}'") == '1', '')
    st, lst = call('GET', '/admin/health/orders?status=CONFIRMED', ADM)
    row = next((x for x in (lst or {}).get('items', []) if x.get('orderNo') == no2), None)
    rec('A-20 운영 목록 「구매확정」 거르기 — 확정한 사람(AUTO) · 송장', st == 200 and row and row.get('confirmedBy') == 'AUTO' and row.get('trackingNo'), (st, row and {k: row.get(k) for k in ('status', 'confirmedBy', 'trackingNo')}))
    # 정리 — 남은 신청 반려 · 확정 주문은 그대로(시험 회원)
    r3 = (rr3 or {}).get('id')
    if r3: call('POST', f'/admin/health/returns/{r3}/decide', ADM, {'state': 'REJECTED', 'note': '시험 정리'})



def confirmed_order(T, addr):
    """발송 → 배송 완료 → 구매확정까지 마친 주문"""
    no = paid_order(T, addr)
    call('POST', f'/admin/health/orders/{no}/ship', ADM, {'carrier': 'CJ대한통운', 'trackingNo': '6236' + uuid.uuid4().hex[:8].translate(str.maketrans('abcdef', '123456'))})
    call('POST', f'/admin/health/orders/{no}/advance', ADM, {'state': 'DELIVERED'})
    call('POST', f'/me/health/orders/{no}/confirm', T)
    return no


def part_b():
    em, pw, T, aid, addr = member('fx8r', '리뷰 시험')
    code, _ = product()
    no0 = paid_order(T, addr)
    st, j = call('POST', '/me/health/reviews', T, {'orderNo': no0, 'productCode': code, 'rating': 5, 'body': '구매확정 전에 쓰는 리뷰입니다.'})
    rec('B-1 구매확정 전 리뷰 → 409 NOT_CONFIRMED', st == 409 and (j or {}).get('code') == 'NOT_CONFIRMED', (st, (j or {}).get('code')))
    no = confirmed_order(T, addr)
    code = q(f"select p.code from hlt_order_items i join hlt_orders o on o.id=i.order_id join hlt_products p on p.id=i.product_id where o.order_no='{no}' limit 1")   # 고른 상품은 재고에 따라 바뀜 — 주문에서 읽음
    rec('B-2 (준비) 구매확정 주문', status(no) == 'CONFIRMED', status(no))
    st, j = call('POST', '/me/health/reviews', T, {'orderNo': no, 'productCode': code, 'rating': 5, 'body': '짧음'})
    st2, j2 = call('POST', '/me/health/reviews', T, {'orderNo': no, 'productCode': code, 'rating': 6, 'body': '별점이 범위를 벗어난 리뷰입니다.'})
    rec('B-3 글 10자 미만 · 별점 1 ~ 5 밖 → 거절(400/422)', st in (400, 422) and st2 in (400, 422), (st, st2))
    st, r = call('POST', '/me/health/reviews', T, {'orderNo': no, 'productCode': code, 'rating': 4, 'body': f'포장이 꼼꼼하고 배송이 빨랐습니다 {tag}'})
    rid = (r or {}).get('id')
    rec('B-4 리뷰 쓰기 → 바로 보임(VISIBLE)', st < 300 and (r or {}).get('state') == 'VISIBLE', (st, r))
    st, j = call('POST', '/me/health/reviews', T, {'orderNo': no, 'productCode': code, 'rating': 5, 'body': '같은 주문 상품에 두 번째 리뷰입니다.'})
    rec('B-5 같은 주문 상품에 두 번째 → 409 ALREADY_REVIEWED', st == 409 and (j or {}).get('code') == 'ALREADY_REVIEWED', (st, (j or {}).get('code')))
    st, lst = call('GET', f'/health/products/{code}/reviews')
    me_row = next((x for x in (lst or {}).get('items', []) if x.get('id') == rid), None)
    rec('B-6 상품 리뷰 목록(로그인 없이) — 평균 · 분포 · 쓴 사람은 첫 글자 + ○○ · 이메일 없음', st == 200 and me_row and me_row['writer'].endswith('○○') and em not in json.dumps(lst, ensure_ascii=False)
        and (lst or {}).get('count', 0) >= 1 and (lst or {}).get('avg') is not None, (st, me_row and me_row.get('writer'), (lst or {}).get('count'), (lst or {}).get('avg')))
    st, card = call('GET', f'/health/products/{code}')
    rec('B-7 상품 상세 · 카드에 별점 평균 · 리뷰 수', st == 200 and (card or {}).get('reviewCount', 0) >= 1 and (card or {}).get('ratingAvg') is not None, (st, (card or {}).get('ratingAvg'), (card or {}).get('reviewCount')))
    # 금칙어 — 하나 넣고 걸리면 PENDING
    w = q("select word from banned_words where is_active and severity='BLOCK' and (gwan_code is null or gwan_code='HLT') and match_type='CONTAINS' order by length(word) limit 1")
    st, j = call('PATCH', f'/me/health/reviews/{rid}', T, {'body': f'먹고 나서 좋았습니다 {w} 라고 들었어요'})
    st2, lst = call('GET', f'/health/products/{code}/reviews')
    rec(f'B-8 금칙어(「{w}」)가 들어가게 고치면 → 운영 확인 대기(PENDING) · 목록에서 빠짐', st < 300 and (j or {}).get('state') == 'PENDING' and not any(x['id'] == rid for x in (lst or {}).get('items', [])), (st, (j or {}).get('state')))
    st, pend = call('GET', '/admin/health/reviews?state=PENDING', ADM)
    rec('B-9 운영 「확인 대기」 목록에 걸린 말과 함께', st == 200 and any(x['id'] == rid and x.get('holdWord') == w for x in (pend or [])), st)
    st, j = call('POST', f'/admin/health/reviews/{rid}/decide', ADM, {'action': 'HIDE'})
    rec('B-10 가리기 — 사유가 없으면 422 REASON_REQUIRED', st == 422 and (j or {}).get('code') == 'REASON_REQUIRED', (st, (j or {}).get('code')))
    st, j = call('POST', f'/admin/health/reviews/{rid}/decide', ADM, {'action': 'HIDE', 'reason': '효능 단정 표현'})
    n = q(f"select count(*) from notifications where account_id='{aid}' and event_code='HLT_REVIEW_HIDDEN'")
    rec('B-11 운영 가림 → HIDDEN · 지우지 않음 · 쓴 사람에게 알림', st < 300 and q(f"select state from hlt_reviews where id='{rid}'") == 'HIDDEN' and n == '1', (st, n))
    st, j = call('PATCH', f'/me/health/reviews/{rid}', T, {'body': '가려진 리뷰를 고쳐 보려는 글입니다.'})
    rec('B-12 가려진 리뷰는 고칠 수 없음 → 409 HIDDEN', st == 409, st)
    _, _, T2, _, _ = member('fx8o', '남의 리뷰')
    st, _ = call('DELETE', f'/me/health/reviews/{rid}', T2)
    rec('B-13 남의 리뷰 지우기 → 404', st == 404, st)
    st, j = call('DELETE', f'/me/health/reviews/{rid}', T)
    rec('B-14 본인은 지울 수 있음', st < 300 and q(f"select count(*) from hlt_reviews where id='{rid}'") == '0', st)
    rc, er = sql(f"insert into hlt_reviews(order_item_id, order_id, product_id, account_id, rating, body) select i.id, i.order_id, i.product_id, '{aid}', 5, '배송 전 주문에 DB 로 넣는 리뷰' from hlt_order_items i join hlt_orders o on o.id=i.order_id where o.order_no='{no0}'")
    rec('B-15 DB — 구매확정 전 주문의 리뷰를 직접 넣어도 막힘(HLTR)', rc != 0 and 'HLTR' in (er or ''), (er or '')[:80])
    # 반품되면 리뷰 가림
    st, r = call('POST', '/me/health/reviews', T, {'orderNo': no, 'productCode': code, 'rating': 3, 'body': '다시 쓰는 보통 리뷰입니다 괜찮아요.'})
    rid2 = (r or {}).get('id')
    st, rr = call('POST', '/me/health/returns', T, {'orderNo': no, 'kind': 'RETURN', 'reason': 'DEFECT', 'detail': '시험 — 하자'})
    call('POST', f"/admin/health/returns/{(rr or {}).get('id')}/decide", ADM, {'state': 'APPROVED', 'note': '시험', 'opened': False})
    rec('B-16 리뷰를 쓴 주문이 반품되면 리뷰는 가림(사유 「반품된 주문의 리뷰」)', q(f"select state||'|'||hidden_reason from hlt_reviews where id='{rid2}'") == 'HIDDEN|반품된 주문의 리뷰', q(f"select state from hlt_reviews where id='{rid2}'"))
    # 문의
    st, j = call('POST', f'/health/products/{code}/qna', None, {'body': '로그인 없이 묻습니다'})
    rec('B-17 문의 — 로그인 없이 쓰면 401/403', st in (401, 403), st)
    em3, pw3, T3, aid3 = signup('fx8n', '본인인증 전')
    st, j = call('POST', f'/health/products/{code}/qna', T3, {'body': '본인인증 전에 묻습니다'})
    rec('B-18 문의 — 본인인증 전 회원은 403', st == 403, st)
    st, qa_ = call('POST', f'/health/products/{code}/qna', T, {'body': f'하루에 몇 번 먹나요 {tag}', 'isPrivate': True})
    qid = (qa_ or {}).get('id')
    st2, pub = call('GET', f'/health/products/{code}/qna')
    row = next((x for x in (pub or {}).get('items', []) if x['id'] == qid), None)
    st3, own = call('GET', f'/health/products/{code}/qna', T)
    orow = next((x for x in (own or {}).get('items', []) if x['id'] == qid), None)
    rec('B-19 비공개 문의 — 남에게는 글이 감춰짐(null) · 쓴 사람에게는 보임', st < 300 and row and row['body'] is None and orow and tag in (orow['body'] or '') and orow['mine'] is True, (st, row and row['body'], orow and orow['mine']))
    st, op = call('GET', '/admin/health/qna?open=true', ADM)
    rec('B-20 운영 「답할 문의」에 비공개 글도 보임', st == 200 and any(x['id'] == qid and tag in x['body'] for x in (op or [])), st)
    st, j = call('POST', f'/admin/health/qna/{qid}/answer', ADM, {'answer': '하루 한 번 드시면 됩니다.'})
    n = q(f"select count(*) from notifications where account_id='{aid}' and event_code='HLT_QNA_ANSWERED'")
    st2, own = call('GET', f'/health/products/{code}/qna', T)
    orow = next((x for x in (own or {}).get('items', []) if x['id'] == qid), None)
    rec('B-21 운영자가 답 → 쓴 사람에게 알림 · 답이 보임', st < 300 and n == '1' and orow and orow['answer'] == '하루 한 번 드시면 됩니다.', (st, n))
    st, j = call('POST', f'/admin/health/qna/{qid}/hide', ADM, {'reason': '시험 정리'})
    rec('B-22 운영 가림 → 목록에서 빠짐', st < 300 and not any(x['id'] == qid for x in (call('GET', f'/health/products/{code}/qna')[1] or {}).get('items', [])), st)
    st, _ = call('GET', '/admin/health/reviews', T)
    rec('B-23 운영자가 아니면 리뷰 확인 목록 403', st == 403, st)


def part_c():
    st, j = run_job('hlt_rank')
    d = q("select (now() at time zone 'Asia/Seoul')::date")
    rec('C-1 순위 작업(hlt_rank) — 오늘 날짜로 집계', st < 300 and q(f"select count(*) > 0 from hlt_rankings where snapshot_date='{d}'") in ('t', 'f'), (st, str(j)[:100]))
    want = rows("""with s as (select i.product_id, sum(i.qty)::int qty, count(distinct i.order_id)::int orders from hlt_order_items i join hlt_orders o on o.id=i.order_id
                   join hlt_products p on p.id=i.product_id and p.status='ON_SALE'
                  where o.paid_at is not null and o.status not in ('PENDING','CANCELED','RETURNED')
                    and (o.paid_at at time zone 'Asia/Seoul')::date between (now() at time zone 'Asia/Seoul')::date - 7 and (now() at time zone 'Asia/Seoul')::date - 1
                  group by 1) select p.code, s.qty from s join hlt_products p on p.id=s.product_id order by s.qty desc, s.orders desc, s.product_id limit 10""")
    st, r = call('GET', '/health/rankings')
    got = [(x['code'], x['qty']) for x in ((r or {}).get('sales') or {}).get('items', [])]
    rec('C-2 「오늘의 건강상품」 = 어제까지 7일 판매 수량 순(취소 · 반품 · 결제 전 제외 · 판매 중 상품만) — 직접 센 값과 같음', st == 200 and [(a, int(b)) for a, b in want] == got, (got[:3], want[:3]))
    s_ = (r or {}).get('sales') or {}
    f_ = q("select ((now() at time zone 'Asia/Seoul')::date - 7)::text"); t_ = q("select ((now() at time zone 'Asia/Seoul')::date - 1)::text")
    if not want:      # 새로 설치한 DB 등 — 7일 판매가 없으면 집계 줄이 없어 기간 · 집계 시각도 없음(화면은 순위 칸을 그리지 않음 · C-U1)
        rec('C-3 (판매 없음) 기준은 오고 기간 · 집계 시각은 비어 있음 — 값을 지어 넣지 않음', '판매 수량' in (s_.get('basis') or '') and not s_.get('from') and not s_.get('items'), (s_.get('basis'), s_.get('from')))
    else:
     rec('C-3 기준 · 기간 · 집계 시각이 함께 옴(화면에 적음)', '판매 수량' in (s_.get('basis') or '') and str(s_.get('from', ''))[:10] == f_ and str(s_.get('to', ''))[:10] == t_ and s_.get('madeAt'), (s_.get('basis'), s_.get('from'), s_.get('to')))
    o_ = (r or {}).get('orders') or {}
    ords = [x['orders'] for x in o_.get('items', [])]
    rec('C-4 「많이 찾는 상품」 = 주문 건수 순', '주문 건수' in (o_.get('basis') or '') and ords == sorted(ords, reverse=True), ords[:5])
    before = q(f"select string_agg(kind||rank||product_id||qty, ',' order by kind, rank) from hlt_rankings where snapshot_date='{d}'")
    run_job('hlt_rank')
    after = q(f"select string_agg(kind||rank||product_id||qty, ',' order by kind, rank) from hlt_rankings where snapshot_date='{d}'")
    rec('C-5 같은 날 다시 돌려도 같은 결과', before == after, '')
    rec('C-6 작업 일정에 hlt_rank(하루 1회)', q("select every_min from job_schedules where job='hlt_rank'") == '1440', '')


def part_d():
    req = [x['code'] for x in (call('GET', '/terms/required', ADM)[1] or []) if x.get('isRequired')]
    opt = {x['code'] for x in (call('GET', '/terms/required', ADM)[1] or []) if not x.get('isRequired')}
    em = f'fx8c_{uuid.uuid4().hex[:6]}@t.local'; pw = 'Sgb-flw-1234!'
    items = req + ['MARKETING']        # 가입 API 는 동의한 약관 코드 목록(고르지 않은 선택 약관은 거부로 남음)
    st, j = call('POST', '/auth/signup', body={'email': em, 'password': pw, 'name': '동의 바꾸기', 'agreedTerms': items})
    T = (j or {}).get('accessToken') or login(em, pw); aid = q(f"select id from accounts where email='{em}'")
    def cur(code): return q(f"select agreed::text from v_term_consent_current where account_id='{aid}' and term_code='{code}'")
    def nrows(code): return q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='{code}'")
    rec('D-1 (준비) 가입 — 마케팅 동의 · 맞춤형 광고 거부', st < 300 and cur('MARKETING') == 'true' and cur('ADPERSONAL') == 'false', (st, cur('MARKETING'), cur('ADPERSONAL')))
    st, j = call('POST', '/terms/agree', T, {'items': [{'code': 'MARKETING', 'agreed': False}]})
    rec('D-2 마케팅을 끔 → 새 줄이 쌓이고(2줄) 지금 상태는 거부 · 409 아님(G-214)', st < 300 and nrows('MARKETING') == '2' and cur('MARKETING') == 'false', (st, nrows('MARKETING'), cur('MARKETING'), str(j)[:80]))
    st, j = call('POST', '/terms/agree', T, {'items': [{'code': 'MARKETING', 'agreed': False}]})
    rec('D-3 같은 값을 다시 보내면 줄을 더하지 않음(unchanged)', st < 300 and nrows('MARKETING') == '2' and 'MARKETING' in ((j or {}).get('unchanged') or []), (st, nrows('MARKETING')))
    st, rq = call('GET', '/terms/required', T)
    m = next((x for x in (rq or []) if x['code'] == 'MARKETING'), {})
    rec('D-4 약관 동의 상태(/terms/required) = 가장 최근 줄 · 바꾼 때', st == 200 and m.get('agreed') is False and m.get('changedAt'), (st, m))
    st, p0 = call('GET', '/me/persona', T)
    call('POST', '/terms/agree', T, {'items': [{'code': 'ADPERSONAL', 'agreed': True}]})
    st1, p1 = call('GET', '/me/persona', T)
    call('POST', '/terms/agree', T, {'items': [{'code': 'ADPERSONAL', 'agreed': False}]})
    st2, p2 = call('GET', '/me/persona', T)
    rec('D-5 맞춤형 광고 — 켜면 동의 · 다시 끄면 동의 아님(AI 동의 확인이 가장 최근 줄을 봄)', (p0 or {}).get('consented') is False and (p1 or {}).get('consented') is True and (p2 or {}).get('consented') is False,
        ((p0 or {}).get('consented'), (p1 or {}).get('consented'), (p2 or {}).get('consented')))
    st, j = call('POST', '/terms/agree', T, {'items': [{'code': req[0], 'agreed': False}]}) if req else (422, {'code': 'REQUIRED_TERM'})
    rec('D-6 필수 약관은 끌 수 없음 → 422 REQUIRED_TERM', st == 422 and (j or {}).get('code') == 'REQUIRED_TERM', (st, (j or {}).get('code')))
    rc, er = sql(f"update term_agreements set agreed = true where account_id='{aid}' and term_code='MARKETING'")
    rc2, er2 = sql(f"delete from term_agreements where account_id='{aid}' and term_code='MARKETING'")
    rec('D-7 DB — 동의 기록은 여전히 고치거나 지울 수 없음(쌓기만)', rc != 0 and rc2 != 0, ((er or '')[:50], (er2 or '')[:50]))
    # 감시 — 마케팅 알림: 동의 중에 보낸 것은 위반 아님 · 끈 뒤에 보낸 것은 위반
    t_on = q(f"select min(agreed_at) from term_agreements where account_id='{aid}' and term_code='MARKETING' and agreed")
    sql(f"insert into notifications(account_id, event_code, title, body, created_at) values ('{aid}','MARKETING_TEST','시험 — 동의 중','x','{t_on}')")
    sql(f"insert into notifications(account_id, event_code, title, body) values ('{aid}','MARKETING_TEST','시험 — 끈 뒤','x')")
    v = rows(f"select title from v_marketing_no_consent n join notifications x on x.id=n.id where n.account_id='{aid}'")
    rec('D-8 마케팅 감시(v_marketing_no_consent) — 보낸 그 시각의 동의로 판단(동의 중 0 · 끈 뒤 1)', [r[0] for r in v] == ['시험 — 끈 뒤'], v)
    st, h = call('GET', '/terms/agreements', T)
    mk = [x for x in (h or []) if x.get('code') == 'MARKETING']
    rec('D-9 내 동의 이력에 바꾼 기록이 모두(마케팅 2줄)', st == 200 and len(mk) == 2, (st, len(mk)))
    rec('D-10 필수 약관 미동의 목록(v_term_not_agreed)에 이 회원 없음(가장 최근 줄 기준)', q(f"select count(*) from v_term_not_agreed where account_id='{aid}'") == '0', '')


def part_e():
    ph = lambda: f'010-{str(uuid.uuid4().int)[-4:]}-{str(uuid.uuid4().int)[-4:]}'
    base = {'categoryCode': 'CSL_CLEANING', 'name': '이메일 시험', 'sido': '서울', 'sigungu': '금천구', 'memo': f'이메일 시험 {tag} 입주 청소', 'agree': True}
    st, j = call('POST', '/consult/requests', None, dict(base, phone=ph()))
    st2, j2 = call('POST', '/consult/requests', None, dict(base, phone=ph(), email='not-an-email'))
    rec('E-1 이메일 없이 · 형식이 틀린 이메일 → 거절(400/422)', st in (400, 422) and st2 in (400, 422), (st, st2))
    em = f'cslmail_{tag}@example.com'
    st, j = call('POST', '/consult/requests', None, dict(base, phone=ph(), email=em))
    rid = (j or {}).get('id')
    raw = q(f"select row_to_json(c)::text from consult_requests c where id='{rid}'") if rid else ''
    rec('E-2 이메일과 함께 신청 → 받음 · DB 에 이메일 원문 없음(암호문) · 동의서 판 CSL-2026-10-09', st < 300 and rid and em not in raw and q(f"select consent_version from consult_requests where id='{rid}'") == 'CSL-2026-10-09', (st, em in raw))
    rec('E-3 응답에 이메일이 실리지 않음', em not in json.dumps(j, ensure_ascii=False), '')
    rec('E-4 휴대폰 확인 전 — 리드 · 업체 쪽에 아무것도 없음', q(f"select lead_id is null from consult_requests where id='{rid}'") == 't', '')
    st, v = call('POST', f'/consult/requests/{rid}/verify', None, {'code': (j or {}).get('devCode')})
    lid = (v or {}).get('leadId')
    rec('E-5 확인 → 업체 1곳 전달 · 리드 연락처에 이메일 암호문(email_enc)', st < 300 and (v or {}).get('state') == 'DELIVERED' and lid and q(f"select email_enc is not null from pii.lead_contacts where lead_id='{lid}'") == 't', (st, v))
    if not lid: return
    rec('E-6 요약(열기 전 업체가 보는 것)에 이메일 없음', em not in q(f"select coalesce(summary,'') from leads where id='{lid}'"), '')
    pacc = q(f"select a.email from lead_deliveries d join partners p on p.id=d.partner_id join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where d.lead_id='{lid}' order by d.delivered_at limit 1")
    did = q(f"select d.id from lead_deliveries d where d.lead_id='{lid}' order by d.delivered_at limit 1")
    PT = login(pacc)
    st, lst = call('GET', '/partner/leads', PT)
    rec('E-7 배정받은 업체의 받은 상담 목록(열기 전)에 이메일 없음', st == 200 and em not in json.dumps(lst, ensure_ascii=False), (st, pacc))
    st, c0 = call('GET', f'/partner/leads/{did}/contact', PT)
    rec('E-8 열기(과금) 전 연락처 → 422 NOT_VIEWED', st == 422, st)
    call('POST', f'/partner/leads/{did}/view', PT)
    n0 = q(f"select count(*) from audit.pii_access_logs where lead_id='{lid}'")
    st, c = call('GET', f'/partner/leads/{did}/contact', PT)
    n1 = q(f"select count(*) from audit.pii_access_logs where lead_id='{lid}'")
    rec('E-9 연 뒤 연락처 → 이름 · 휴대폰 · 이메일 · 열람 기록 1줄 더', st == 200 and ((c or {}).get('contact') or {}).get('email') == em and int(n1) == int(n0) + 1, (st, ((c or {}).get('contact') or {}).get('email'), n0, n1))
    other = q(f"select a.email from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where p.id not in (select partner_id from lead_deliveries where lead_id='{lid}') and p.status='ACTIVE' limit 1")
    st, x = call('GET', f'/partner/leads/{did}/contact', login(other)) if other else (409, {})
    rec('E-10 배정받지 않은 업체는 그 연락처 · 이메일을 못 봄', st in (403, 404, 409) and em not in json.dumps(x, ensure_ascii=False), (st, other))
    # 파기 — 보관 기한을 지난 것처럼(기한은 앞당기기만 됨) → 작업 → 이메일도 비움
    sql(f"update pii.lead_contacts set retention_until = collected_at::date + 1 where lead_id='{lid}'")
    sql(f"update pii.lead_contacts set collected_at = collected_at - interval '200 days', retention_until = (collected_at - interval '200 days')::date + 1 where lead_id='{lid}'")
    run_job('pii_purge')
    rec('E-11 전달 연락처 파기(pii_purge) → 이메일도 비움 · 파기 뒤 다시 넣기 막힘', q(f"select (purged_at is not null and email_enc is null)::text from pii.lead_contacts where lead_id='{lid}'") == 'true', q(f"select purged_at, email_enc is null from pii.lead_contacts where lead_id='{lid}'"))
    rc, er = sql(f"update pii.lead_contacts set email_enc = 'x'::bytea where lead_id='{lid}'")
    rec('E-12 DB — 파기된 연락처에 이메일을 다시 넣을 수 없음', rc != 0 and 'PRIVACY' in (er or ''), (er or '')[:80])

# ── F 개인 소개비 정산 (지시서 5절 · D040 · INV-10R) ─────────────────────────────────────────
UA_ = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

def intro_listing():
    """소개할 매물 — 게시 중 · 소개 가능 업종 · 인증 사업자.
    v10.31 (w2 D056 A-07) — 안심소개 부동산(시험 사업자 brk_* 의 사무실 · 오피스)은 소개비 약정 · 정산이 없습니다. 그래서
      첫째 = intro@x.com 의 소개장터 매물(부동산 아님 — 판매자), 둘째 = brk_* 인증 사업자(사업자 소개자로만 씀 · 그 매물은 쓰지 않음)."""
    first = rows("""select l.id, a.email from listings l join accounts a on a.id=l.owner_account_id join categories c on c.id=l.category_id
      where l.status='PUBLISHED' and a.email='intro@x.com' and not fn_category_no_intro(c.id) and not fn_is_realty_category(c.id) order by l.published_at, l.id limit 1""")
    return first + _intro_listing_brk()[:1]

def _intro_listing_brk():
    r = rows("""select l.id, a.email from listings l join accounts a on a.id=l.owner_account_id join categories c on c.id=l.category_id
      where l.status='PUBLISHED' and l.gwan_code='MAL' and a.email like 'brk_%@t.local' and a.status='ACTIVE' and not fn_category_no_intro(c.id)
        and exists(select 1 from account_roles r where r.account_id=a.id and r.role='BIZ_OWNER')
        and exists(select 1 from businesses b where b.account_id=a.id and b.verified_at is not null) order by l.published_at desc, l.id limit 2""")
    return r

def intro_deal(code, L, TS, fee=300000, confirm=True):
    """소개코드 유입 → 가입 → 본인인증 → 문의 → 파는 쪽 거래 생성 → (스위치 켜짐이면) 소개비 제안 · 양측 동의 → 계약서(약정 고정) → 양측 확인.
    돌려줌: (dealId, 구매자 토큰)"""
    V = str(uuid.uuid4())
    call('POST', '/attribution/touch', None, {'code': code, 'landingUrl': '/mall'}, headers={'X-Visitor-Key': V, 'User-Agent': UA_})
    e = f'fx8b_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', None, {'email': e, 'password': TEST_PW, 'name': '구매 시험', 'visitorKey': V})
    TB = (j or {}).get('accessToken')
    call('POST', '/verifications/identity', TB, {'provider': 'PASS'})
    st, c = call('POST', '/conversations', TB, {'targetType': 'LISTING', 'targetId': L, 'message': '소개받고 문의드립니다. 상담 가능할까요?'})
    st, d = call('POST', f"/conversations/{(c or {}).get('conversationId')}/deal", TS)
    did = (d or {}).get('dealId')
    if fee:
        st, f = call('POST', f'/deals/{did}/fee', TS, {'amount': fee}, headers={'Idempotency-Key': uuid.uuid4().hex})
        st, a = call('POST', f"/deals/{did}/fee/{(f or {}).get('version')}/agree", TB)
        call('POST', f"/deals/{did}/fee/{(a or {}).get('version')}/agree", TS)
        call('POST', f'/deals/{did}/contract', TS, {})
    if confirm:
        call('POST', f'/deals/{did}/confirm', TB, {}, headers={'Idempotency-Key': uuid.uuid4().hex})
        call('POST', f'/deals/{did}/confirm', TS, {}, headers={'Idempotency-Key': uuid.uuid4().hex})
    return did, TB

def _paid_code():
    return {'paymentKey': 'stub_' + uuid.uuid4().hex, 'orderId': 'rcx-' + uuid.uuid4().hex[:12], 'amount': 30000}

def feature(v):
    return call('PATCH', '/admin/site-settings', ADM, {'key': 'feature.referral_fee', 'value': v})

def settle(tok, did):
    return call('POST', '/settlements', tok, {'dealId': did})

def verified_payout(tok):
    st, a = call('POST', '/me/payout-accounts', tok, {'bankCode': '004', 'bankName': '국민은행', 'accountNo': '1002' + str(uuid.uuid4().int)[-8:], 'holderName': '정산 시험'})
    st2, v = call('POST', f"/me/payout-accounts/{(a or {}).get('id')}/verify", tok, {'code': 'SGB01'})
    return st, a, st2, v

def part_f():
    LL = intro_listing()
    rec('F-0 (준비) 소개할 안심소개 매물 2건 · 파는 쪽 인증 사업자', len(LL) >= 2, LL)
    (L, seller), (L2, seller2) = LL[:2]
    TS, TS2 = login(seller), login(seller2)
    before = q("select value from site_settings where key='feature.referral_fee'")
    # ── 스위치가 꺼진 상태(기본) ──
    emI, pwI, TI, I = signup('fx8i', '개인 소개자')
    call('POST', '/verifications/identity', TI, {'provider': 'PASS'})
    st, j = call('POST', '/referral-codes', TI, {'listingId': L, **_paid_code()})   # v10.31 (D060) — 무료 요금제 소개코드 0건 → 30,000원 결제(스텁) 뒤 발급
    code = (j or [{}])[0].get('code') if isinstance(j, list) else None
    rec('F-0b (준비) 본인인증 개인이 매물 소개코드 발급(결제 1건 — v10.31 무료 0건)', st in (200, 201) and code, (st, str(j)[:120]))
    d0, _ = intro_deal(code, L, TS, fee=0)
    rec('F-0c (준비 · 스위치 꺼짐) 소개 거래 성사 — 약정 없음 · 정산 줄 없음 · 받을 소개비 목록에 없음',
        q(f"select status||'|'||coalesce(agreed_fee::text,'-')||'|'||(introducer_account_id='{I}')::text from deals where id='{d0}'") == 'CONFIRMED|-|true'
        and q(f"select count(*) from settlements where deal_id='{d0}'") == '0'
        and d0 not in json.dumps(call('GET', '/me/settlements/due', TI)[1]), q(f"select status, agreed_fee from deals where id='{d0}'"))
    try:
        st, j = feature('on')
        rec('F-0d 켜는 길 — 운영자가 운영 설정 feature.referral_fee = on (관리자 API · 형식 검사 · 감사 기록)', st < 300 and q("select value from site_settings where key='feature.referral_fee'") == 'on', (st, j))
        st, j = call('GET', '/features')
        rec('F-0e 공개 기능 스위치 조회 → referral_fee enabled:true (화면이 이 값으로 갈림)', any(x.get('feature') == 'referral_fee' and x.get('enabled') is True for x in (j or [])), str(j)[:160])

        d1, TB1 = intro_deal(code, L, TS)
        rec('F-1a (스위치 켜짐) 개인 소개자 · 받을 계좌 없음 → 성사 확정 · 약정 300,000 · 정산 줄 없음',
            q(f"select status||'|'||agreed_fee from deals where id='{d1}'") == 'CONFIRMED|300000' and q(f"select count(*) from settlements where deal_id='{d1}'") == '0',
            q(f"select status, agreed_fee from deals where id='{d1}'"))
        note = q(f"select body||'|'||link_url from notifications where account_id='{I}' and template_code='SETTLEMENT_BLOCKED_INDIVIDUAL_INAPP' order by id desc limit 1")
        rec('F-1b 소개자에게 알림 「받을 계좌를 확인해 주십시오」 · 금액 300,000 · 연결 /my/settlement · 「사업자만」 문구 없음',
            '300,000' in note and note.endswith('/my/settlement') and '사업자만' not in note, note[:160])
        st, due = call('GET', '/me/settlements/due', TI)
        rec('F-1c 받을 소개비 목록(GET /me/settlements/due) — 그 거래 · 금액 · 개인 회원도 200', st == 200 and any(x.get('dealId') == d1 and x.get('amount') == 300000 for x in (due or [])), (st, str(due)[:160]))
        st, j = settle(TI, d1)
        rec('F-3 본인인증 개인 · 받을 계좌 없음 → 409 ACCOUNT_REQUIRED · 계좌 등록 안내 · 정산 줄 없음 (지시서 5-4 #3)',
            st == 409 and (j or {}).get('code') == 'ACCOUNT_REQUIRED' and '계좌' in (j or {}).get('message', '') and q(f"select count(*) from settlements where deal_id='{d1}'") == '0', (st, j))

        emJ, pwJ, TJ, J = signup('fx8j', '다른 개인')
        call('POST', '/verifications/identity', TJ, {'provider': 'PASS'})
        verified_payout(TJ)
        st, j = settle(TJ, d1)
        rc, er = sql(f"insert into settlements (deal_id, payee_account_id, payee_business_id, amount, status) values ('{d1}','{J}',NULL,300000,'REQUESTED')")
        rec('F-4 소개자가 아닌 본인인증 개인(계좌 확인됨) → 서비스 403 NOT_PARTY · DB 직접 넣기도 INV-9R 로 막힘 (지시서 #4 두 곳)',
            st == 403 and (j or {}).get('code') == 'NOT_PARTY' and rc != 0 and 'INV-9R' in (er or ''), (st, (j or {}).get('code'), (er or '')[:90]))

        st, a, st2, v = verified_payout(TI)
        rec('F-5a 받을 계좌 등록 · 1원 확인 — 연동 전 간주(stub) · 계좌번호 뒤 4자리만 · 암호문 보관',
            st < 300 and st2 < 300 and (v or {}).get('verified') is True and q(f"select (is_stub and verified and account_enc is not null)::text from payout_accounts where id='{(a or {}).get('id')}'") == 'true'
            and len(call('GET', '/me/payout-accounts', TI)[1][0]['accountNo'].replace('*', '')) == 4, (st, a, st2, v))
        st, j = settle(TI, d1)
        rec('F-1 본인인증 개인 · 소개자 본인 · 계좌 확인 → 정산 신청 됨 · 개인으로(payee_business_id 없음) · 금액 = 약정 · 「확인 간주」 안내 (지시서 #1)',
            st in (200, 201) and (j or {}).get('payee') == 'PERSON' and (j or {}).get('amount') == 300000 and '간주' in ((j or {}).get('note') or '')
            and q(f"select (payee_business_id is null and payee_account_id='{I}' and status='REQUESTED')::text from settlements where deal_id='{d1}'") == 'true', (st, j))
        st, j = settle(TI, d1)
        rec('F-1d 같은 거래를 또 신청 → 409 ALREADY_REQUESTED', st == 409 and (j or {}).get('code') == 'ALREADY_REQUESTED', (st, j))
        st, mine = call('GET', '/me/settlements', TI)
        rec('F-1e 내 정산 목록(개인 회원 200) — 그 줄 · payee PERSON · 받을 소개비 목록에서는 빠짐',
            st == 200 and any(x.get('dealId') == d1 and x.get('payee') == 'PERSON' for x in (mine or []))
            and d1 not in json.dumps(call('GET', '/me/settlements/due', TI)[1]), (st, str(mine)[:160]))
        d2, _ = intro_deal(code, L, TS, fee=200000)
        rec('F-1f 계좌를 확인한 개인 소개자 → 다음 성사 때 정산 줄이 저절로 생김(개인 · 200,000 · fn_confirm_when_both)',
            q(f"select (payee_business_id is null and amount=200000 and payee_account_id='{I}')::text from settlements where deal_id='{d2}'") == 'true',
            q(f"select payee_business_id, amount from settlements where deal_id='{d2}'"))

        emK, pwK, TK, K = signup('fx8k', '인증 전 개인')
        st, j = settle(TK, d1)
        st2, j2 = call('GET', '/me/settlements', TK)
        rec('F-2 본인인증 전 개인 → 403 IDENTITY_REQUIRED(본인인증 안내) · 정산 목록도 403 (지시서 #2)',
            st == 403 and (j or {}).get('code') == 'IDENTITY_REQUIRED' and st2 == 403, (st, j, st2))

        # #5 사업자 소개자 — 전처럼 사업자로 받음(계좌 묻지 않음)
        st, j = call('POST', '/referral-codes', TS2, {'listingId': L, **_paid_code()})
        bcode = (j or [{}])[0].get('code') if isinstance(j, list) else None
        S2 = q(f"select id from accounts where email='{seller2}'")
        if bcode:
            d3, _ = intro_deal(bcode, L, TS, fee=150000, confirm=True)
            row = q(f"select (payee_business_id is not null and payee_account_id='{S2}' and amount=150000)::text from settlements where deal_id='{d3}'")
            auto = row == 'true'
            if not auto:
                st, j = settle(TS2, d3)
                row = q(f"select (payee_business_id is not null and payee_account_id='{S2}')::text from settlements where deal_id='{d3}'")
            rec('F-5 사업자 소개자 → 전처럼 사업자로 받음(성사 때 자동 · 받을 계좌를 묻지 않음 · payee_business_id 있음) (지시서 #5)', row == 'true', (auto, row, bcode))
        else:
            rec('F-5 사업자 소개자 → 전처럼 사업자로 받음 (지시서 #5)', False, ('소개코드 발급 실패', st, str(j)[:160]))

        # #6 개인 당사자 — 거래 만들기 · 소개비 제시 · 계약서 발급은 사업자 그대로
        d4, TB4 = intro_deal(code, L, TS, fee=0, confirm=False)
        conv = q(f"select conversation_id from deals where id='{d4}'")
        s_a, j_a = call('POST', f'/conversations/{conv}/deal', TB4)
        s_b, j_b = call('POST', f'/deals/{d4}/fee', TB4, {'amount': 100000}, headers={'Idempotency-Key': uuid.uuid4().hex})
        s_c, j_c = call('POST', f'/deals/{d4}/contract', TB4, {})
        # v10.37 (D095 · 10/13 대표 지시 「모두 개인에게 허용」 · P2P) — 개인(본인인증)도 거래 만들기 · 소개비 제시 · 계약서 발급. 역할로 막히지 않고 서버 오류(500)도 없음
        #   (계약서는 합의한 소개비가 없으면 422 CONTRACT_FEE — 전에는 같은 경우 500 이었음)
        rec('F-6 개인(본인인증)도 거래 만들기 · 소개비 제시 · 계약서 발급 — 403 아님 · 500 아님 (v10.37 P2P · 지시서 #6 을 바꿈)',
            all(x not in (403, 500) for x in (s_a, s_b, s_c)) and s_b in (200, 201) and (s_c in (200, 201) or (j_c or {}).get('code') == 'CONTRACT_FEE'),
            (s_a, (j_a or {}).get('code'), s_b, (j_b or {}).get('code'), s_c, (j_c or {}).get('code')))
    finally:
        st, j = feature(before or 'off')
        rec('F-9 시험 뒤 스위치를 원래 값으로 되돌림(기본 off)', q("select value from site_settings where key='feature.referral_fee'") == (before or 'off'), (before, st))

    # #7 꺼진 상태 — 약정이 없는 성사 거래의 정산 신청은 전처럼 422 (계좌까지 확인한 개인이라 계좌 안내가 아니라 규칙에서 막힘)
    st, j = settle(TI, d0)
    fa0 = q(f"select count(*) from fee_agreements where deal_id='{d4}'")   # v10.37 — F-6 에서 개인이 스위치를 켠 동안 제시한 줄은 그대로 두고, 꺼진 뒤 새로 생기지 않는지를 봅니다
    st2, j2 = call('POST', f'/deals/{d4}/fee', TS, {'amount': 100000}, headers={'Idempotency-Key': uuid.uuid4().hex})
    rec('F-7 스위치 꺼짐 — 약정 없는 성사 거래 정산 신청 422(INV-9) · 진행 중 거래에 사업자가 소개비 제안해도 422 (지시서 #7)',
        st == 422 and st2 == 422 and q(f"select count(*) from fee_agreements where deal_id='{d4}'") == fa0, (st, (j or {}).get('code'), st2, (j2 or {}).get('code'), fa0))
    rec('F-10 불변식 INV-9 · INV-9R · INV-10 · INV-10R 위반 0',
        q("select coalesce(sum(violation_count),0) from fn_verify_invariants() where inv in ('INV-9','INV-10','INV-10R')") == '0', q("select string_agg(inv||'='||violation_count, ',') from fn_verify_invariants() where violation_count > 0"))
    # #8 이용약관 제4조 표 ↔ 서버 자격 검사 — 표의 「본인인증」 줄에 「소개비 받기」, 서버는 IDENTITY_VERIFIED
    src = open(os.path.join(KITS, 'src', 'modules', 'public', 'public.controller.ts'), encoding='utf-8').read()
    m = re.search(r"@Post\('settlements'\)(.*?)settlement\(", src, re.S)
    gate = re.findall(r"@RequireGate\('([A-Z_]+)'\)", m.group(1)) if m else []
    terms = [open(os.path.join(KITS, 'docs', 'terms', 'SERVICE.md'), encoding='utf-8').read(),
             subprocess.run(['psql', DB, '-tAc', "select body from terms where code='SERVICE' and status='PUBLISHED' order by effective_from desc nulls last limit 1"], capture_output=True, text=True).stdout]
    def row_of(t, label):
        return next((ln for ln in t.splitlines() if ln.startswith('|') and label in ln.split('|')[1]), '')
    # v10.37 — 사업자 줄은 「사업자 인증(선택) | 사업자로 소개비 받기」(세금계산서) — 개인 수령은 본인인증 줄
    ok_t = all('소개비 받기' in row_of(t, '본인인증') and '사업자로 소개비 받기' in row_of(t, '사업자 인증') for t in terms)
    rec('F-8 이용약관 제4조 표(생성기 글 · 발행 글) 「본인인증 — 소개비 받기」 ↔ 서버 정산 신청 자격 IDENTITY_VERIFIED (지시서 #8)',
        gate == ['IDENTITY_VERIFIED'] and ok_t, (gate, [row_of(t, '본인인증')[:80] for t in terms]))

# ── G 약관 한 벌 · 재동의 (G-217 · D041 · 지시서 3절 · 6-1절) ─────────────────────────────────────
CODES8 = ['SERVICE', 'PRIVACY', 'REFUND', 'THIRDPARTY', 'OUTSOURCE', 'MARKETING', 'MARKETING_NIGHT', 'ADPERSONAL']

def doc(code): return open(os.path.join(KITS, 'docs', 'terms', f'{code}.md'), encoding='utf-8').read()
def old_consent(aid, code, ver):
    """시험 자료 — 예전 판에 동의한 줄을 맨 뒤에 넣음(그 판은 보관돼 규칙이 막으므로 이 한 줄만 규칙을 건너뜀). 「새 판 발행 전에 동의한 회원」"""
    return sql(f"BEGIN; SET LOCAL session_replication_role = replica; INSERT INTO term_agreements (account_id, term_code, term_version, agreed, agreed_at) SELECT '{aid}', '{code}', '{ver}', true, coalesce(max(agreed_at), now()) + interval '1 millisecond' FROM term_agreements WHERE account_id = '{aid}' AND term_code = '{code}'; COMMIT;")

def part_g():
    import subprocess as sp
    tt = json.loads(sp.run(['node', '-e', 'process.stdout.write(JSON.stringify(require(process.argv[1])))', os.path.join(KITS, 'scripts', 'terms-text.js')], capture_output=True, text=True).stdout or '{}')
    same = [c for c in CODES8 if tt.get(c, '').strip() == doc(c).strip()]
    rec('G-1 생성기의 글(scripts/terms-text.js) = docs/terms/*.md — 8종(이용 · 방침 · 환불 · 제3자 · 위탁 · 마케팅 · 야간 · 맞춤형)', len(same) == 8, [c for c in CODES8 if c not in same])
    bad = []
    for c in CODES8:
        n = sp.run(['psql', DB, '-tAc', f"select count(*) from terms where code='{c}' and status <> 'ARCHIVED' and fn_term_body_norm(body) <> fn_term_body_norm($SGBT${doc(c)}$SGBT$)"], capture_output=True, text=True).stdout.strip()
        if n != '0': bad.append((c, n))
    rec('G-2 개발 DB 의 발행 · 초안 본문 = docs/terms(시행일 날짜만 다름) — 8종', not bad, bad)
    S, P, RF, TP = (sp.run(['psql', DB, '-tAc', f"select body from terms where code='{c}' and status='PUBLISHED'"], capture_output=True, text=True).stdout for c in ('SERVICE', 'PRIVACY', 'REFUND', 'THIRDPARTY'))
    checks = {
        'SERVICE 제2조 ① 회원끼리': '**회원끼리 서로를 찾도록 잇고' in S,
        'SERVICE 제4조 ① 만 19세 이상 · 개인과 사업자': '**만 19세 이상**이면 개인과 사업자 모두' in S,
        'SERVICE 제4조 표 본인인증 줄 소개비 받기': '| 본인인증 |' in S and '**소개비 받기** |' in S,
        'SERVICE 표 아래 계좌 확인': '정산을 신청하실 때**는 받으실 **계좌를 확인**' in S,
        'SERVICE ③ 본인인증과 사업자 진위 확인 · ④ 19세 미만': '**본인인증과 사업자 진위 확인**' in S and '④ 만 19세 미만은 가입할 수 없습니다.' in S,
        'PRIVACY 가입 때 필수 3가지 · 단계별': '**이름 · 연락처 · 이메일만** 필수' in P and '본인인증을 하실 때' in P and '사업자 인증을 하실 때' in P,
        'PRIVACY 상담을 신청할 때(이메일 · 확인 전 전달 없음)': '### 상담을 신청할 때' in P and '**확인을 마치기 전에는 업체에 아무것도 전달하지 않습니다.**' in P,
        'PRIVACY 제3조 상담 신청 6개월': '| 상담 신청 정보 | 상담이 끝나거나 **6개월** |' in P,
        'PRIVACY 제4조 ③': '③ **상담을 신청하며 동의**하신 경우' in P,
        'PRIVACY 제10조 ③': '**유입 기록과\n   투표 중복 방지**' in P,
        'PRIVACY 제11조 만 19세 이상만': '**만 19세 이상만 가입**' in P and '사업자만 가입' not in P,
        'REFUND 제2조 요청 · 상담 신청': '요청 · 상담 신청을 열람한 경우' in RF and '리드를' not in RF,
        'THIRDPARTY 머리글 · 제1조 · 제5조 ③': '**회원끼리 서로를 찾도록 잇는**' in TP and '안심소개 **상담 신청**은 신청 화면에서 따로 동의' in TP and '(둘러보기 · 소개광장 · 소개몰)' in TP,
    }
    rec('G-3 지시서 3절의 조항이 발행된 글에 있음(13곳)', all(checks.values()), [k for k, v in checks.items() if not v])
    old = q("select string_agg(code||' '||version, ', ') from terms where status <> 'ARCHIVED' and body ~ '소개머니|건강상품관|건강몰|소개뱅크몰|리드관|소개리드|사업자끼리|사업자만'")
    olddoc = [c for c in CODES8 + ['HLT_SALE'] if re.search('소개머니|건강상품관|건강몰|소개뱅크몰|리드관|소개리드|사업자끼리|사업자만', doc(c))]
    rec('G-4 옛 이름 · 옛 규칙(소개머니 · 건강상품관 · 건강몰 · 소개뱅크몰 · 리드관 · 소개리드 · 사업자끼리 · 사업자만) — DB 9종 · docs 9종 0', not old and not olddoc, (old, olddoc))
    st = {k: q(f"select value from site_settings where key='{k}'") for k in ('footer.company_name', 'footer.ceo_name', 'footer.biz_reg_no', 'footer.address', 'footer.privacy_officer', 'footer.privacy_contact')}
    ok5 = all(st[k] and st[k] in S for k in ('footer.company_name', 'footer.ceo_name', 'footer.biz_reg_no', 'footer.address')) and \
          f"책임자   {st['footer.privacy_officer']}" in P and f"전화     {st['footer.privacy_contact']}" in P
    rec('G-5 명의 · 책임자 = 법정 고지 값(회사명 · 대표 · 사업자번호 · 주소 · 보호책임자 · 전화)', ok5, st)
    form = open(os.path.join(KITS, 'site', 'src', 'app', 'consult', 'ConsultForm.tsx'), encoding='utf-8').read()
    m1 = re.search(r'동의합니다\.</b> (.+?)을 이 업종의 인증업체 1곳', form)
    m2 = re.search(r'인증업체 1곳\*\*에\s*\n?\s*(.+?)을 전달합니다', P, re.S)
    items = lambda t: [x.strip().strip('*') for x in re.sub(r'\s+', ' ', t).split('·')] if t else []
    rec('G-6 상담 신청 화면의 동의 문구 항목 = 처리방침 제4조 ③ 항목(글자 대조)', m1 and m2 and items(m1.group(1)) == items(m2.group(1)), (m1 and items(m1.group(1)), m2 and items(m2.group(1))))
    pt = open(os.path.join(KITS, 'scripts', 'publish-terms.sh'), encoding='utf-8').read()
    m3 = re.search(r'CODES="\$\{\*:-([A-Z_ ]+)\}"', pt)
    rec('G-7 발행 스크립트 기본 대상 = 10종(위치기반 빼고 · v10.31 파트너 이용약관 PARTNER 더함 — 10/10 사용자 답 「파트너 약관 발행」)', m3 and sorted(m3.group(1).split()) == sorted(CODES8 + ['HLT_SALE', 'PARTNER']), m3 and m3.group(1))
    # v10.31 — D041 은 v10.28 의 글입니다. 그 뒤 D062(이용약관 1.1 · 10/10 시안 요금제)가 글을 바꿨으므로 D041 을 개발 DB 에 다시 돌리면
    #   옛 글로 새 판(1.2)을 발행해 버립니다(10/10 검정 중 실제로 일어남 — 개발 DB 를 1.3 으로 바로잡음). 그래서 「같은 글이면 건너뜀」은
    #   **가장 나중의 글 마이그레이션(D062)** 을 한 트랜잭션 안에서 두 번 돌려 보고(ROLLBACK — 남기지 않음) 두 번째에 판이 더 생기지 않는지로 봅니다.
    n0 = q("select count(*) from terms")
    # v10.37 — 가장 나중의 이용약관 글 마이그레이션은 D095(P2P 제4조) — D062 를 다시 돌리면 옛 글로 새 판을 냅니다(위 설명과 같은 까닭)
    mig = open(os.path.join(KITS, 'prisma', 'migrations', 'D095_p2p_all_individual', 'migration.sql'), encoding='utf-8').read()
    p_ = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tA'], input="BEGIN;\n" + mig + "\nSELECT 'C1=' || count(*) FROM terms;\nDROP TABLE IF EXISTS _terms_text;\n" + mig + "\nSELECT 'C2=' || count(*) FROM terms;\nROLLBACK;\n", capture_output=True, text=True)
    c1 = re.search(r'C1=(\d+)', p_.stdout); c2 = re.search(r'C2=(\d+)', p_.stdout)
    rec('G-8 약관 글 마이그레이션(D095 · 가장 나중)을 다시 돌려도 판이 더 생기지 않음(같은 글이면 건너뜀 · 한 트랜잭션에서 두 번 · ROLLBACK)', p_.returncode == 0 and c1 and c2 and c1.group(1) == c2.group(1) == n0 and q("select count(*) from terms") == n0,
        (p_.returncode, c1 and c1.group(1), c2 and c2.group(1), n0, p_.stderr[-160:]))
    # 재동의 — 새 판 발행 전에 동의한 회원(예전 판 줄) · 약관 발행 전에 가입한 회원(동의 없음)
    em, pw, T, aid = signup('fx8g', '재동의 시험')
    cur = q("select version from terms where code='SERVICE' and status='PUBLISHED'")
    prev = q(f"select version from terms where code='SERVICE' and status='ARCHIVED' order by split_part(version,'.',2)::int desc limit 1")
    old_consent(aid, 'SERVICE', prev)
    st, lst = call('GET', '/terms/required', T)
    sv = next((t for t in (lst or []) if t.get('code') == 'SERVICE'), {})
    rec('G-9 예전 판에 동의한 회원 → 이용약관 agreed:false · 동의하신 판(agreedVersion)=예전 판 · 바뀐 점(changeNote) 있음',
        st == 200 and sv.get('agreed') is False and sv.get('agreedVersion') == prev and sv.get('version') == cur and (sv.get('changeNote') or '') != '' and sv.get('changeNote') == q(f"select change_note from terms where code='SERVICE' and version='{cur}'"), (st, sv))   # v10.31 — 바뀐 점 = 지금 판(1.1 · 요금제)의 글(전: v10.28 판의 「소개비 받기」)
    em2, pw2, T2, aid2 = signup('fx8g', '동의 없는 회원', agree=False)
    st, lst2 = call('GET', '/terms/required', T2)
    pend = [t['code'] for t in (lst2 or []) if t.get('isRequired') and not t.get('agreed')]
    rec('G-10 약관에 동의한 적 없는 회원 → 필수 약관 전부 동의 필요 · agreedVersion 없음', set(pend) >= {'SERVICE', 'PRIVACY', 'REFUND', 'THIRDPARTY'} and all(not t.get('agreedVersion') for t in lst2 if t.get('isRequired')), pend)
    st, j = call('POST', '/terms/agree', T, {'items': [{'code': 'SERVICE', 'agreed': True}]})
    st2, lst = call('GET', '/terms/required', T)
    sv = next((t for t in (lst or []) if t.get('code') == 'SERVICE'), {})
    rec('G-11 다시 동의 → 지금 판 동의 · 동의 기록 한 줄 더(지우지 않음)', st < 300 and sv.get('agreed') is True and q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='SERVICE'") == '3', (st, sv, q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='SERVICE'")))

# ── H 이번 판에 찾은 결함 ──────────────────────────────────────────────────────────────
def part_h():
    # G-220 운영 「검수 큐」 다음 쪽 — 마지막 줄이 다음 쪽에 또 나옴(열쇠를 밀리초로 자름) · 같은 마감 시각 줄을 건너뜀
    seen, pages, cur, dup = [], 0, None, []
    while pages < 40:
        st, j = call('GET', '/admin/reviews' + (f'?cursor={urllib.parse.quote(cur)}' if cur else ''), ADM)
        if st != 200: break
        ids = [x['id'] for x in (j or {}).get('items') or []]
        dup += [i for i in ids if i in seen]; seen += ids; pages += 1
        cur = (j or {}).get('nextCursor')
        if not cur: break
    n = q("select count(*) from review_items where status in ('QUEUED','IN_PROGRESS')")
    rec('H-1 (G-220) 검수 큐를 끝까지 넘기면 겹치는 줄 0 · 빠진 줄 0(DB 의 대기 건수와 같음)', st == 200 and not dup and str(len(seen)) == n, (pages, len(seen), n, dup[:3]))
    st, j = call('GET', '/admin/reviews?cursor=not-a-date', ADM)
    rec('H-2 형식이 틀린 열쇠 → 400', st == 400, st)
    # G-222 — 서버 · 브라우저가 같이 그리는 화면에서 toLocaleString/DateString/TimeString('ko-KR') 은 서버(Node) 「PM」 · 브라우저 「오후」로 달라 수화 오류(#418)
    #   (G-201 규칙 — lib/format 의 ymdKst · dtKst · hmKst 를 씀). 사용자 웹 소스에서 날짜를 toLocale… 로 쓰는 곳 0(lib/format 의 ago 날짜 줄은 날짜만이라 같음 — 빼고 셈)
    hits = []
    for root, _, fs in os.walk(os.path.join(KITS, 'site', 'src')):
        for f in fs:
            if f.endswith(('.ts', '.tsx')):
                for i, l in enumerate(open(os.path.join(root, f), encoding='utf-8'), 1):
                    if re.search(r'new Date\([^)]*\)\.toLocale(Date|Time)?String\(', l) and not (f == 'format.ts' and 'toLocaleDateString' in l):
                        hits.append(f'{f}:{i}')
    rec('H-3 (G-222) 사용자 웹에서 날짜 · 시각을 toLocale… 로 그리는 곳 0(서버 · 브라우저 글자가 달라 수화 오류)', not hits, hits[:5])

# ── I 위탁은 「알림」 (G-218 · 10/9 답 「알림으로」 · D042) ────────────────────────────────────────────
def part_i():
    pub = q("select version||'|'||is_notice||'|'||is_required||'|'||title from terms where code='OUTSOURCE' and status='PUBLISHED'")
    ver, notice, req, title = (pub.split('|') + ['', '', '', ''])[:4]
    fresh = q("select count(*) from terms where code='OUTSOURCE' and status='ARCHIVED'") == '0'      # 새로 설치(앞 판 없음) — 초안 1.0 이 알림으로 발행됨
    rec('I-1 위탁(OUTSOURCE) 발행 판 = 알림 · 필수 아님 · 제목 「… 안내」(쓰던 DB 는 D042 가 새 판으로 · 새로 설치는 1.0 이 그대로 알림)', notice == 'true' and req == 'false' and title.endswith('안내') and (ver == '1.0' if fresh else ver not in ('', '1.0')), (pub, '새로 설치' if fresh else '쓰던 DB'))
    old = q("select count(*) from terms where code='OUTSOURCE' and version='1.0' and status='ARCHIVED' and not is_notice")
    if fresh: rec('I-2 (새로 설치) 보관된 위탁 판 없음 — 처음부터 알림', old == '0', old)
    else: rec('I-2 예전 판 1.0 은 보관 · 알림 표시 없음(그때는 동의였음 — 그 판의 기록은 그대로)', old == '1', old)
    d = doc('OUTSOURCE')
    rec('I-3 글 — 「알림」 · 「동의를 받는 항목이 아닙니다」 · 「동의를 거부할 권리」 없음 · 「위탁 동의」 없음 · 개인정보 보호법 제26조',
        '**알림**' in d and '동의를 받는 항목이 아닙니다' in d and '동의를 거부할 권리' not in d and '위탁 동의' not in d and '제26조' in d, d[:80])
    n = q(f"select count(*) from terms where code='OUTSOURCE' and status <> 'ARCHIVED' and fn_term_body_norm(body) <> fn_term_body_norm($SGBT${d}$SGBT$)")
    rec('I-4 DB 의 발행 본문 = docs/terms/OUTSOURCE.md(시행일 날짜만 다름)', n == '0', n)
    st, lst = call('GET', '/terms/required', ADM)
    rec('I-5 동의 목록(/terms/required)에 위탁 없음 · 다른 선택 약관(마케팅 등)은 그대로', st == 200 and not any(t['code'] == 'OUTSOURCE' for t in lst or []) and any(t['code'] == 'MARKETING' for t in lst or []), [t['code'] for t in lst or []])
    st, lst = call('GET', '/terms')
    o = next((t for t in lst or [] if t['code'] == 'OUTSOURCE'), {})
    rec('I-6 약관 목록(/terms)에는 위탁이 「알림」으로(isNotice) · 다른 약관은 알림 아님', st == 200 and o.get('isNotice') is True and all(not t.get('isNotice') for t in lst if t['code'] != 'OUTSOURCE'), (st, o.get('version'), o.get('isNotice')))
    st, o = call('GET', '/terms/doc/OUTSOURCE')
    rec('I-7 위탁 전문(/terms/doc/OUTSOURCE) — isNotice · 지금 판', st == 200 and (o or {}).get('isNotice') is True and (o or {}).get('version') == ver, (st, (o or {}).get('version')))
    em = f'fx8i_{tag}@t.local'; pw = 'Sgb-flw-1234!'
    reqs = [t['code'] for t in (call('GET', '/terms/required', ADM)[1] or []) if t.get('isRequired')]
    st, j = call('POST', '/auth/signup', body={'email': em, 'password': pw, 'name': '위탁 알림', 'agreedTerms': reqs + ['OUTSOURCE']})
    rec('I-8 가입 때 위탁에 「동의」를 보내면 422 NOTICE_ONLY · 계정 안 만들어짐', st == 422 and (j or {}).get('code') == 'NOTICE_ONLY' and q(f"select count(*) from accounts where email='{em}'") == '0', (st, j))
    st, j = call('POST', '/auth/signup', body={'email': em, 'password': pw, 'name': '위탁 알림', 'agreedTerms': reqs})
    aid = q(f"select id from accounts where email='{em}'")
    rows_ = q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='OUTSOURCE'")
    rec('I-9 필수만 골라 가입 → 위탁 기록 0줄(알림이라 동의 · 거부를 남기지 않음) · 다른 선택 약관은 거부로 한 줄씩', st < 300 and rows_ == '0' and q(f"select agreed::text from v_term_consent_current where account_id='{aid}' and term_code='MARKETING'") == 'false', (st, rows_))
    T = (j or {}).get('accessToken') or login(em, pw)
    for v in (True, False):
        st, j = call('POST', '/terms/agree', T, {'items': [{'code': 'OUTSOURCE', 'agreed': v}]})
        rec(f'I-10{"a" if v else "b"} 「약관 동의」로 위탁을 {"동의" if v else "거부"}하면 422 NOTICE_ONLY · 기록 0줄', st == 422 and (j or {}).get('code') == 'NOTICE_ONLY' and q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='OUTSOURCE'") == '0', (st, j))
    err = sql(f"INSERT INTO term_agreements(account_id, term_code, term_version, agreed) VALUES ('{aid}','OUTSOURCE','{ver}',true)")
    rec('I-11 DB 로 바로 넣어도 막힘(트리거 trg_term_agreement_no_notice · 마지막 둑)', 'NOTICE_ONLY' in str(err) and q(f"select count(*) from term_agreements where account_id='{aid}' and term_code='OUTSOURCE'") == '0', str(err)[:120])
    st, lst = call('GET', '/terms/required', T)
    rec('I-12 이 회원의 동의 상태에 위탁이 없고 필수는 모두 동의(재동의 화면으로 가지 않음)', st == 200 and not any(t['code'] == 'OUTSOURCE' for t in lst) and all(t['agreed'] for t in lst if t['isRequired']), [(t['code'], t['agreed']) for t in lst or []])
    st, j = call('POST', '/terms/agree', T, {'items': [{'code': 'MARKETING', 'agreed': True}]})
    rec('I-13 다른 선택 약관(마케팅)은 그대로 켜고 끔', st < 300 and q(f"select agreed::text from v_term_consent_current where account_id='{aid}' and term_code='MARKETING'") == 'true', st)

PART_FN = {'A': part_a, 'B': part_b, 'C': part_c, 'D': part_d, 'E': part_e, 'F': part_f, 'G': part_g, 'H': part_h, 'I': part_i}

if __name__ == '__main__':        # fix_1028_ui.py 가 도우미(member · paid_order …)만 가져다 씀
    for k in sorted(PARTS):
        if k in PART_FN: safe(k, PART_FN[k])
    json.dump(R, open(os.path.join(HERE, 'fix_1028.json'), 'w'), ensure_ascii=False, indent=1)
    bad = [r for r in R if not r['ok']]
    print(f"\n{len(R) - len(bad)}/{len(R)} 통과", file=sys.stderr)
    print(f"통과 {len(R) - len(bad)} / {len(R)}")
    sys.exit(1 if bad else 0)
