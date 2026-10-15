"""v10.31 (W5 · 10/10 시안 기준) — 파트너센터 · 제휴 영업 새 서버 기능 역할별 확인.

  리드 이용료 선불(D070): 충전 · 승인(두 번) · 범위 · 차감 · 잔액 부족 · 환급 · 환불 · 자동 청구 · 운영 원장 · 조정 · 불변식
  상담: 메모(전화번호 막힘) · 반려 한도 · 등급(알림톡 대역)
  서비스: 위자드(등록 방식) · 상세 · 수정(재검수) · 노출 중단/재개 · 블록 · 매트릭스 — 남의 것은 404
  이행 보고 → 소비자 확인(요청자만) · 회사 · 계정(대표만) · 전용 트랙 · 알림 읽음 · 성사 정산 · 단가 · 보상표
  제휴: 대시보드 새 칸 · 추천상품 표지 · 정산 기간(역전 · 미래) 막음
  운영(w6 이름): /admin/partner-center/*

사용: API=http://localhost:3105 DB=postgresql://sgb:sgb@localhost:5432/sgb_w5 python3 srv_w5.py
"""
import json, os, subprocess, sys, uuid, urllib.request, datetime
API = (os.environ.get('API') or 'http://localhost:3105').rstrip('/').removesuffix('/api/v1')
B = API + '/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []

def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(B + p, method=m, data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:160], file=sys.stderr)

login = lambda e, pw='sgb-dev-1234': call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']
ADM = login('admin@x.com'); OPS = login('ops@t.local', 'sgb-test-1234'); BUY = login('buyer@x.com'); PER = login('person@x.com')
P = login('intro@x.com')
pid = q("select p.id from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where a.email='intro@x.com'")
other_email = q("select a.email from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where p.status='ACTIVE' and a.email like 'ptn\\_%@t.local' limit 1")
P2 = login(other_email, 'sgb-test-1234')
tag = uuid.uuid4().hex[:6]

def charge(T, amount=50000):
    st, c = call('POST', '/partner/cash/charges', T, {'amount': amount})
    if st >= 300: return st, c, None
    st2, j = call('POST', '/partner/cash/charges/confirm', T, {'orderId': c['orderId'], 'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': amount})
    return st2, j, c

# ── 1. 리드 이용료(선불) ─────────────────────────────────────────────
st, j = call('GET', '/partner/cash')
rec('1-1 로그인 없이 GET /partner/cash → 403 UNAUTHENTICATED(기존 규약)', st in (401, 403), st)
st, j = call('GET', '/partner/cash', BUY)
rec('1-2 파트너 아님(MEMBER) → 409 NOT_PARTNER', st == 409 and j.get('code') == 'NOT_PARTNER', (st, j))
st, c0 = call('GET', '/partner/cash', P)
rec('1-3 파트너 — 총 잔액 · 유상 · 보너스 · 자동 청구 · 한도 · 사용 내역 · 범위 안내', st == 200 and {'total', 'paid', 'bonus', 'auto', 'limits', 'log', 'scope'} <= set(c0), list(c0)[:8])
st, j = call('POST', '/partner/cash/charges', P, {'amount': 5000})
rec('1-4 최소 금액 미만 → 422 CHARGE_TOO_SMALL', st == 422 and j['code'] == 'CHARGE_TOO_SMALL', (st, j))
st, j = call('POST', '/partner/cash/charges', P, {'amount': 99999999})
rec('1-5 최대 금액 초과 → 422 CHARGE_TOO_LARGE', st == 422 and j['code'] == 'CHARGE_TOO_LARGE', (st, j))
st, j = call('POST', '/partner/cash/charges', P, {'amount': 10000.5})
rec('1-6 원 단위 아님 → 400', st == 400, st)
st, j, c = charge(P, 50000)
rec('1-7 충전 → 승인(스텁) → 유상 +50,000 · 보너스 +등급 할인', st < 300 and j['state'] == 'DONE' and j['paid'] >= c0['paid'] + 50000 and j['bonus'] >= c0['bonus'] + 10000, (st, j))
st, j2 = call('POST', '/partner/cash/charges/confirm', P, {'orderId': c['orderId'], 'paymentKey': 'stub_again', 'amount': 50000})
rec('1-8 같은 주문 두 번 승인 → 한 번만(already)', st < 300 and j2.get('already') is True and q(f"select count(*) from lead_cash_entries where kind='CHARGE' and ref_id=(select id::text from lead_cash_charges where order_id='{c['orderId']}')") == '1', (st, j2))
st, c2 = call('POST', '/partner/cash/charges', P, {'amount': 10000})
st, j = call('POST', '/partner/cash/charges/confirm', P2, {'orderId': c2['orderId'], 'paymentKey': 'stub_x', 'amount': 10000})
rec('1-9 남의 충전 주문 승인 → 404', st == 404, (st, j))
st, j = call('POST', '/partner/cash/charges/confirm', P, {'orderId': c2['orderId'], 'paymentKey': 'stub_x', 'amount': 99999})
rec('1-10 금액이 다른 승인 → 422 AMOUNT_MISMATCH', st == 422 and j['code'] == 'AMOUNT_MISMATCH', (st, j))
st, j = call('POST', '/partner/cash/refunds', P, {'amount': 10**9, 'reason': '시험'})
rec('1-11 유상 잔액보다 큰 환불 → 422(보너스는 환불 안 함)', st == 422 and '유상 잔액' in j['message'], (st, j))
st, j = call('POST', '/partner/cash/refunds', P, {'amount': 10000, 'reason': 'W5 시험 환불'})
rec('1-12 환불 10,000 → 결제 취소(스텁) · 그 충전 보너스 회수', st < 300 and j['state'] == 'DONE' and j['refunded'] == 10000 and j['clawback'] >= 0, (st, j))
st, j = call('PUT', '/partner/cash/auto', P, {'on': True, 'below': 1000, 'amount': 5000})
rec('1-13 자동 청구 — 충전 금액이 최소보다 작음 → 422', st == 422, (st, j))
st, j = call('PUT', '/partner/cash/auto', P, {'on': False})
rec('1-14 자동 청구 끄기', st < 300 and j['on'] is False, (st, j))
st, j = call('GET', '/admin/partner-center/cash', P)
rec('1-15 운영 잔액 목록 — 파트너 → 403', st == 403, st)
st, j = call('GET', '/admin/partner-center/cash', OPS)
rec('1-16 운영 잔액 목록(ADMIN) — 합계 · 불변식 0', st == 200 and j['invariants']['ok'] is True and j['totals']['paid'] >= 0, (st, j.get('invariants'), j.get('totals')))
st, j = call('GET', f'/admin/partner-center/cash/{pid}', ADM)
rec('1-17 운영 원장(SUPER) — 거래마다 줄(차변 · 대변)', st == 200 and all(sum(l['amount'] for l in e['lines']) == 0 for e in j['entries']) and len(j['entries']) > 0, len(j.get('entries', [])))
st, j = call('POST', f'/admin/partner-center/cash/{pid}/adjust', OPS, {'account': 'BONUS', 'amount': -10**9, 'reason': '시험 — 너무 큰 감액'})
rec('1-18 조정 — 잔액 아래로 감액 → 422', st == 422, (st, j))
st, j = call('POST', f'/admin/partner-center/cash/{pid}/adjust', OPS, {'account': 'BONUS', 'amount': 1000, 'reason': 'W5 시험 조정'})
rec('1-19 조정(+1,000 보너스) — 원장 ADJUST', st < 300 and j['ok'], (st, j))
out = subprocess.run(['psql', DB, '-tAc', 'update lead_cash_lines set amount = amount where id = (select max(id) from lead_cash_lines)'], capture_output=True, text=True)
rec('1-20 DB: 원장 줄은 고칠 수 없음', 'LEADCASH:' in out.stderr, out.stderr.strip()[:100])
out = subprocess.run(['psql', DB, '-tAc', f"update lead_cash_wallets set paid_balance = paid_balance - 1000000000000 where partner_id='{pid}'"], capture_output=True, text=True)
rec('1-21 DB: 지갑 잔액은 0 아래로 못 감(CHECK)', 'check' in out.stderr.lower(), out.stderr.strip()[:100])

# ── 2. 상담 — 차감 · 잔액 부족 · 메모 · 등급 ─────────────────────────
mk = lambda summ, req=None: q(f"""with l as (insert into leads(category_id, sido, sigungu, summary, requester_account_id)
    select id,'서울','송파구','{summ}', {f"(select id from accounts where email='{req}')" if req else 'NULL'} from categories where code='CSL_MOVING' returning id)
    insert into lead_deliveries(lead_id, partner_id, expires_at) select l.id, '{pid}', now()+interval '1 day' from l returning id""")
d1 = mk(f'[W5 시험 {tag}] 등급 리드', req='buyer@x.com')
lid1 = q(f"select lead_id from lead_deliveries where id='{d1}'")
st, j = call('POST', f'/admin/partner-center/leads/{lid1}/grade', P, {'alimState': 'CONFIRMED', 'grade': 'A'})
rec('2-1 등급 입력 — 파트너 → 403', st == 403, st)
st, j = call('POST', f'/admin/partner-center/leads/{lid1}/grade', OPS, {'alimState': 'NO_RESPONSE', 'grade': 'A'})
rec('2-2 등급 — 알림톡 대역 밖(미응답에 A+) → 422 LEADGRADE', st == 422 and j['code'] == 'LEADGRADE', (st, j))
st, j = call('POST', f'/admin/partner-center/leads/{lid1}/grade', OPS, {'alimState': 'CONFIRMED', 'grade': 'A'})
rec('2-3 등급 A+ · 알림톡 확정', st < 300 and j['gradeLabel'] == 'A+', (st, j))
st, leads = call('GET', '/partner/leads', P)
row = next((x for x in leads if x['deliveryId'] == d1), {})
base = int(float(q("select coalesce(max(top_fee), (select lead_fee from categories where code='CSL_MOVING')) from partner_services where partner_id='" + pid + "' and status='APPROVED' and category_id=(select id from categories where code='CSL_MOVING')") or 3000))
rec('2-4 목록에 등급 배지 · 알림톡 · 예상 확인비용 = 기준 × 85%', row.get('gradeLabel') == 'A+' and row.get('alimState') == 'CONFIRMED' and int(float(row.get('feeQuote') or 0)) == round(base * 0.85), (row.get('gradeLabel'), row.get('feeQuote'), base))
bal0 = call('GET', '/partner/cash', P)[1]['total']
st, v = call('POST', f'/partner/leads/{d1}/view', P)
bal1 = call('GET', '/partner/cash', P)[1]['total']
rec('2-5 열람 → 잔액에서 확인비용 차감(보너스 먼저)', st < 300 and bal0 - bal1 == v['fee'] and v['parts'] is not None, (st, v.get('fee'), v.get('parts'), bal0, bal1))
st, j = call('POST', f'/partner/leads/{d1}/memo', P, {'body': '오전 통화 · 견적 재요청'})
rec('2-6 메모 남기기', st < 300 and j['body'], (st, j))
st, j = call('POST', f'/partner/leads/{d1}/memo', P, {'body': '연락처 010-1234-5678'})
rec('2-7 메모에 전화번호 → 422 LEADMEMO', st == 422 and j['code'] == 'LEADMEMO', (st, j))
st, j = call('POST', f'/partner/leads/{d1}/memo', P2, {'body': '남의 메모'})
rec('2-8 남의 배정에 메모 → 422(받은 리드가 아님)', st == 422, (st, j))
st, j = call('GET', '/partner/rejects', P)
rec('2-9 반려 한도(이번 달 · 15%) · 내역', st == 200 and {'month', 'received', 'used', 'cap'} <= set(j['cap']), j.get('cap'))
# 잔액 부족: 이웃 파트너 지갑을 0으로 만들고(조정) 리드 열람
pid2 = q(f"select p.id from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where a.email='{other_email}'")
w2 = call('GET', f'/admin/partner-center/cash/{pid2}', ADM)[1]['wallet']
if w2['paid']: call('POST', f'/admin/partner-center/cash/{pid2}/adjust', ADM, {'account': 'PAID', 'amount': -w2['paid'], 'reason': 'W5 시험 — 잔액 0 만들기'})
if w2['bonus']: call('POST', f'/admin/partner-center/cash/{pid2}/adjust', ADM, {'account': 'BONUS', 'amount': -w2['bonus'], 'reason': 'W5 시험 — 잔액 0 만들기'})
d2 = q(f"""with l as (insert into leads(summary,sido,sigungu) values ('[W5 시험 {tag}] 잔액 없음','서울','금천구') returning id)
           insert into lead_deliveries(lead_id, partner_id, expires_at) select id, '{pid2}', now()+interval '1 day' from l returning id""")
st, j = call('POST', f'/partner/leads/{d2}/view', P2)
rec('2-10 잔액 0 → 열람 막힘 422 LEADCASH · 열람 기록도 남지 않음', st == 422 and j['code'] == 'LEADCASH' and q(f"select viewed_at is null from lead_deliveries where id='{d2}'") == 't', (st, j))
charge(P2, 10000)
st, j = call('POST', f'/partner/leads/{d2}/view', P2)
rec('2-11 충전 뒤 열람 → 됨', st < 300, (st, j))

# ── 3. 서비스 ─────────────────────────────────────────────────────
st, f = call('GET', '/partner/service-forms', P)
mv = next(c for c in f['categories'] if c['form'] == 'MATRIX')
rec('3-1 위자드 정의 — 등록 방식 6종 · 매트릭스 축(이사짐 4×6) · 등급 비율', st == 200 and len(f['forms']) == 6 and len(mv['rows']) == 4 and len(mv['cols']) == 6 and len(f['rates']) == 8, (len(f['forms']), mv['name']))
st, s = call('POST', '/partner/services', P, {'title': f'[W5 시험 {tag}] 포장이사', 'body': '시험 서비스', 'categoryId': mv['id'], 'wizard': True,
                                              'topFee': 22000, 'referralRate': 0.08, 'rebateBonus': 5000, 'matrix': [{'row': 'PACK', 'col': 'R3', 'amount': 1050000}],
                                              'blocks': [{'kind': 'INTRO', 'body': '20년 경력'}]})
sid = s.get('id')
rec('3-2 위자드 등록 → 검수 대기 · 등록 방식 MATRIX', st < 300 and s['formType'] == 'MATRIX' and s['status'] == 'IN_REVIEW', (st, s))
st, j = call('POST', '/partner/services', P, {'title': 'x', 'body': 'y', 'categoryId': mv['id'], 'wizard': True, 'referralRate': 0.2})
rec('3-3 소개비율 범위 밖(20%) → 400', st == 400, st)
st, j = call('GET', f'/partner/services/{sid}', P2)
rec('3-4 남의 서비스 상세 → 404', st == 404, st)
st, j = call('PATCH', f'/partner/services/{sid}', P2, {'title': '남이 고침'})
rec('3-5 남의 서비스 수정 → 404', st == 404, st)
call('POST', f'/admin/partners/services/{sid}/review', OPS, {'approve': True})
st, j = call('PATCH', f'/partner/services/{sid}', P, {'topFee': 25000})
rec('3-6 확인비용만 바꿈 → 노출 그대로(APPROVED)', st < 300 and j['status'] == 'APPROVED' and not j['reReview'], (st, j))
st, j = call('PATCH', f'/partner/services/{sid}', P, {'body': '시험 서비스 — 고친 설명'})
rec('3-7 내용 수정 → 재검수(IN_REVIEW)', st < 300 and j['status'] == 'IN_REVIEW' and j['reReview'], (st, j))
call('POST', f'/admin/partners/services/{sid}/review', OPS, {'approve': True})
st, j = call('POST', f'/partner/services/{sid}/suspend', P)
st2, j2 = call('POST', f'/partner/services/{sid}/resume', P)
rec('3-8 노출 중단 → 재개', st < 300 and j['status'] == 'SUSPENDED' and st2 < 300 and j2['status'] == 'APPROVED', (st, st2))
st, j = call('PUT', f'/partner/services/{sid}/blocks/FAQ', P, {'body': '문의 010-1111-2222'})
rec('3-9 블록에 전화번호 → 422', st == 422, (st, j))
st, j = call('PUT', f'/partner/services/{sid}/blocks/BOGUS', P, {'body': 'x'})
rec('3-10 없는 블록 → 422', st == 422, st)
st, j = call('PUT', f'/partner/services/{sid}/matrix', P, {'cells': [{'row': 'NOPE', 'col': 'R1', 'amount': 1}]})
rec('3-11 업종에 없는 구간 → 422', st == 422, (st, j))
st, d = call('GET', f'/partner/services/{sid}', P)
rec('3-12 상세 — 블록 6 · 매트릭스 · 처리 이력(검수 · 승인 · 수정 · 중단 · 재개)', st == 200 and len(d['blocks']) == 6
    and {'SUBMIT', 'APPROVE', 'EDIT', 'SUSPEND', 'RESUME'} <= {e['action'] for e in d['events']}, [e['action'] for e in d['events']])
st, pr = call('GET', '/partner/pricing', P)
mxr = next((r for r in pr if r['formType'] == 'MATRIX'), {})
rec('3-13 단가 — 단가 폼 · 구간(4×6) · 내 단가 = 최고 확인비용', mxr.get('range') == '4×6 구간' and mxr.get('myFee') == 25000, mxr)
rec('3-14 결함: 상담 업종 「단가 미정」 0(기준가가 비어 있는 행 없음)', all(r['baseFee'] is not None for r in pr), [r['categoryName'] for r in pr if r['baseFee'] is None])
st, rw = call('GET', '/partner/pricing/rewards', P)
rec('3-15 소개비 보상표 — 성사 % · 재소개 보너스', st == 200 and any(x['referralRate'] == 0.08 and x['rebateBonus'] == 5000 for x in rw['items']), len(rw['items']))

# ── 4. 이행 보고 → 소비자 확인 ─────────────────────────────────────
d0 = mk(f'[W5 시험 {tag}] 안 연 리드')
st, j = call('POST', '/partner/performance', P, {'deliveryId': d0, 'content': '이사 완료', 'doneOn': '2026-10-01'})
rec('4-1 연락처를 열지 않은 건 이행 보고 → 422', st == 422, (st, j))
st, rp = call('POST', '/partner/performance', P, {'deliveryId': d1, 'content': '이사 · 쓰리룸 · 송파', 'doneOn': '2026-10-01', 'amount': 1050000})
rec('4-2 이행 보고 → 고객 확인 대기', st < 300 and rp['consumerState'] == 'WAITING', (st, rp))
st, j = call('POST', f"/me/fulfillment-reports/{rp['id']}/confirm", PER, {'result': 'CONFIRMED', 'rating': 5})
rec('4-3 신청자가 아닌 회원의 확인 → 409', st == 409, (st, j))
st, lst = call('GET', '/me/fulfillment-reports', BUY)
rec('4-4 신청자(buyer)의 이행 보고 목록', st == 200 and any(x['id'] == rp['id'] for x in lst), len(lst or []))
st, j = call('POST', f"/me/fulfillment-reports/{rp['id']}/confirm", BUY, {'result': 'CONFIRMED', 'rating': 5})
rec('4-5 신청자 확인 → 성사(CONFIRMED)', st < 300 and j['state'] == 'CONFIRMED', (st, j))
st, j = call('POST', f"/me/fulfillment-reports/{rp['id']}/confirm", BUY, {'result': 'DISPUTED', 'note': '다시'})
rec('4-6 한 번만 확인', st == 409, st)
st, sstat = call('GET', '/partner/stats', P)
rec('4-7 실적 — 성사 · 성사율 · 8등급 분포(A+ 1건 이상)', st == 200 and sstat['confirmed'] >= 1 and any(x['label'] == 'A+' and x['count'] >= 1 for x in sstat['dist']), (sstat.get('confirmed'), sstat.get('convRate')))
st, tr = call('GET', '/partner/trust', P)
rec('4-8 신뢰 배지 4종(조건이 만듦)', st == 200 and len(tr['badges']) == 4, [b['name'] + ':' + b['state'] for b in tr['badges']])

# ── 5. 회사 · 계정 · 트랙 · 알림 · 정산 ───────────────────────────────
st, co = call('GET', '/partner/company', P)
rec('5-1 회사 · 계정 — 사업자 정보 · 계정 · 약관(파트너 이용약관 포함) · 회사 관리', st == 200 and co['isOwner'] and any(t['code'] == 'PARTNER' for t in co['terms']), [t['code'] for t in co['terms']][-3:])
st, j = call('POST', '/partner/company/change-requests', P, {'field': 'BIZ_ITEM', 'afterValue': f'화물운송주선 {tag}', 'reason': '종목 추가'})
crid = (j or {}).get('id')
rec('5-2 사업자 정보 변경 요청 접수', st < 300 and j['state'] == 'REQUESTED', (st, j))
st, j = call('POST', f'/admin/partner-center/change-requests/{crid}/decide', OPS, {'approve': True})
rec('5-3 운영 승인 → 사업자 정보에 바로 반영', st < 300 and q(f"select biz_item from businesses b join partners p on p.business_id=b.id where p.id='{pid}'") == f'화물운송주선 {tag}', (st, j))
st, j = call('POST', '/partner/company/staff', P, {'email': f'nobody_{tag}@nowhere.example'})
rec('5-4 가입 안 한 이메일 초대 → 422 NO_ACCOUNT', st == 422 and j['code'] == 'NO_ACCOUNT', (st, j))
st, j = call('POST', '/partner/company/staff', P2, {'email': 'buyer@x.com'})
st2, j2 = call('POST', '/partner/company/staff', BUY, {'email': 'person@x.com'})
rec('5-5 파트너 아님 → 409 · (이웃 파트너 대표는 초대 가능)', st2 == 409, (st, st2))
BUYER_ID = q("select id from accounts where email='buyer@x.com'")
if st < 300: call('DELETE', f"/partner/company/staff/{BUYER_ID}", P2)
st, t = call('GET', '/partner/tracks', P)
rec('5-6 전용 트랙 3탭 자료', st == 200 and {'repair', 'car', 'catalog'} <= set(t), {k: len(t[k]) for k in ('repair', 'car', 'catalog')})
st, j = call('POST', f'/partner/tracks/repair/{d0}/quote', P, {'amount': 300000})
rec('5-7 연락처를 열지 않은 요청에 견적 → 422', st == 422, (st, j))
st, j = call('POST', '/partner/tracks/catalog', P, {'name': f'정수기 시험 {tag}', 'saleKind': 'RENTAL', 'price': 39900})
rec('5-8 카탈로그 품목 등록', st < 300 and j['state'] == 'LISTED', (st, j))
st, j = call('POST', '/partner/notices/read-all', P)
rec('5-9 알림 모두 읽음', st < 300 and j['ok'], (st, j))
st, sl = call('GET', '/partner/settlement', P)
rec('5-10 정산 — 성사 정산(payouts) · 수령 계좌 · 세금계산서 · 옛 필드', st == 200 and {'payouts', 'account', 'invoices', 'unpaid', 'months'} <= set(sl), list(sl))
rec('5-11 결함: 정산 기간 역전 0 (시작 ≤ 끝)', q('select count(*) from partner_settlements where period_from > period_to') == '0', '')
st, d = call('GET', '/partner/dashboard', P)
rec('5-12 파트너 홈 — 오늘 상담 · 이번 달 이용료 · 정산 예정 · 업체 카드', st == 200 and {'today', 'month', 'settlement', 'card', 'balance'} <= set(d), d.get('card'))

# ── 6. 제휴 영업 ──────────────────────────────────────────────────
st, ad = call('GET', '/partner/affiliate/dashboard', P)
rec('6-1 제휴 대시보드 — 오늘 · 어제 · 소개 고객 · 등급 · 정산 예정일 · 알림 · 이름 · 피드', st == 200 and {'today', 'customers', 'tier', 'payoutDate', 'unread', 'displayName', 'feed'} <= set(ad), {k: ad.get(k) for k in ('payoutDate', 'displayName')})
rec('6-2 피드에 다른 회원 이름 없음(시 · 도 · 상품 · 금액만)', all(set(x) <= {'at', 'kind', 'product', 'area', 'amount'} for x in ad['feed']), ad['feed'][:1])
st, pr = call('GET', '/partner/affiliate/products', P)
rec('6-3 추천상품에 표지 · 사진 칸', st == 200 and all('tag' in x and 'imagePath' in x for x in pr), len(pr))
st, j = call('POST', '/admin/affiliates/settlements/run', ADM, {'track': 'AFFILIATE', 'periodFrom': '2026-09-30', 'periodTo': '2026-09-01'})
rec('6-4 정산 기간 역전 → 422', st == 422 and j['code'] == 'BAD_PERIOD', (st, j))
fut = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
st, j = call('POST', '/admin/affiliates/settlements/run', ADM, {'track': 'AFFILIATE', 'periodFrom': '2026-10-01', 'periodTo': fut})
rec('6-5 끝나지 않은 기간 → 422', st == 422 and j['code'] == 'BAD_PERIOD', (st, j))
out = subprocess.run(['psql', DB, '-tAc', f"insert into partner_settlements(partner_id,track,period_from,period_to) values ('{pid}','AFFILIATE','2029-07-09','2029-02-10')"], capture_output=True, text=True)
rec('6-6 DB: 기간 역전 줄 → CHECK 거절', 'ck_pstl_period' in out.stderr, out.stderr.strip()[:100])

# ── 7. 운영 기타 ─────────────────────────────────────────────────
st, j = call('POST', '/admin/partner-center/lead-cash-invoices/run', OPS, {'ym': datetime.date.today().strftime('%Y-%m')})
rec('7-1 끝나지 않은 달 세금계산서 요청 → 422', st == 422, (st, j))
st, j = call('GET', '/admin/partner-center/rules', OPS)
rec('7-2 규칙(등급 할인 · 등급 기준 · 배지)', st == 200 and len(j['bonusRates']) == 4 and len(j['badgeRules']) == 4, st)
st, j = call('GET', '/admin/partner-center/change-requests', BUY)
rec('7-3 운영 API — 회원 → 403', st == 403, st)
rec('7-4 원장 불변식 0 (끝)', q('select count(*) from v_lead_cash_invariants') == '0', q('select string_agg(code,\',\') from v_lead_cash_invariants'))

ok = sum(r['ok'] for r in R)
print(f'통과 {ok} / {len(R)}', file=sys.stderr)
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_w5.json'), 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if ok == len(R) else 1)
