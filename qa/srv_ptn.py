"""10/2 서버 기능 — 파트너 운영 목록 (ptn).

  1. 검수 대기 서비스 목록        GET  /admin/partners/services/pending
  2. 리드 반려 신청 · 인정 · 기각  POST /partner/fees/{id}/dispute · GET /partner/fees/disputes
                                  GET  /admin/partners/fees/void-requests
                                  POST /admin/partners/fees/void-requests/{id}/accept|dismiss
  3. 입점 반려                    POST /admin/partners/{id}/reject
  4. 중개사 인증 심사              GET  /admin/brokers · GET /admin/brokers/{id} · POST /admin/brokers/{id}/decide

사용: API=http://localhost:3000 python3 srv_ptn.py   (기본 3013)
매 실행마다 새 사업자 계정을 만들어 씁니다(재실행 안전).
리드 배정 API 가 없어 리드 · 배정 행만 SQL 로 넣고, 열람(과금)부터는 실제 API 로 합니다.
"""
import json, urllib.request, subprocess, uuid, sys, os, time
API = os.environ.get('API') or (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3013')
API = API.rstrip('/').removesuffix('/api/v1')   # 다른 검증 스크립트처럼 /api/v1 을 붙여 줘도 받습니다
B = API.rstrip('/') + '/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'   # v10.14 — Docker 등 다른 DB 에서도 돌게(전에는 주소가 고정이라 fixtures 4번이 Docker 에서 실패)
q = lambda s: subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]
R = []

def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(B + p, method=m,
        data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:200]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:140], file=sys.stderr)

login = lambda e, pw='sgb-dev-1234': call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']

def charge(T, amount=100000):
    """v10.31 (W5 · D070) — 리드 이용료가 선불 충전으로 바뀌어, 열람(과금) 전에 시험 결제(스텁)로 잔액을 넣습니다."""
    st, c = call('POST', '/partner/cash/charges', T, {'amount': amount})
    if st >= 300: return st, c
    return call('POST', '/partner/cash/charges/confirm', T, {'orderId': c['orderId'], 'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': amount})
ADM = login('admin@x.com')                  # SUPER
OPS = login('ops@t.local', 'sgb-test-1234')  # ADMIN
BUY = login('buyer@x.com')                  # MEMBER
tag = uuid.uuid4().hex[:6]

def bizuser(prefix, company):
    """가입 → 본인인증(스텁) → 사업자 등록 → 운영 사업자 승인."""
    e = f'{prefix}_{tag}@t.local'
    call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': 'PTN 시험', 'agreedTerms': []})
    T = login(e, 'sgb-test-1234')
    call('POST', '/verifications/identity', T, {'provider': 'PASS'})
    brn = str(int(time.time() * 1000))[-10:]
    st, j = call('POST', '/businesses', T, {'bizRegNo': brn, 'companyName': f'{company}{tag}', 'ceoName': '김시험',
                                            'sido': '서울', 'sigungu': '금천구'})
    bid = (j or {}).get('id') or q(f"select id from businesses where company_name='{company}{tag}'")
    call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    return e, login(e, 'sgb-test-1234'), bid

# ── 3. 입점 신청 → 반려 → 재신청 → 승인 ─────────────────────────────
e1, P1, b1 = bizuser('ptn', 'PTN상사')
st, j = call('POST', '/partner/apply', P1)
pid = (j or {}).get('id')
rec('3-0 입점 신청 (APPLIED)', st < 300 and j.get('status') == 'APPLIED', j)
st, lst = call('GET', '/admin/partners', OPS)
row = next((x for x in lst if x['id'] == pid), None) if st == 200 else None
rec('3-1 파트너 목록에 신청 시각 · 사업자 인증 표시', row and row.get('appliedAt') and row.get('bizVerified') is True, row)
st, j = call('POST', f'/admin/partners/{pid}/reject', BUY, {'reason': 'x'})
rec('3-2 일반 회원 반려 → 403', st == 403, st)
st, j = call('POST', f'/admin/partners/{pid}/reject', OPS, {})
rec('3-3 사유 없음 → 400 (DTO 검증)', st == 400, (st, j))
st, j = call('POST', f'/admin/partners/{pid}/reject', OPS, {'reason': '   '})
rec('3-4 공백 사유 → 422 REASON_REQUIRED', st == 422 and j['code'] == 'REASON_REQUIRED', (st, j))
reason = '사업자등록증 업태가 신청 업종과 다릅니다 — 업태 정정 후 다시 신청해 주십시오'
st, j = call('POST', f'/admin/partners/{pid}/reject', OPS, {'reason': reason})
rec('3-5 반려 (ADMIN) → REJECTED · 사유 저장', st < 300 and q(f"select status||'|'||suspended_reason from partners where id='{pid}'") == 'REJECTED|' + reason, (st, j))
st, j = call('POST', f'/admin/partners/{pid}/reject', OPS, {'reason': reason})
rec('3-6 다시 반려 → 409 NOT_APPLIED', st == 409, (st, j))
st, d = call('GET', '/partner/dashboard', P1)
rec('3-7 파트너 홈에 반려 사유 표시', d.get('status') == 'REJECTED' and d.get('rejectReason') == reason, d.get('rejectReason'))
rec('3-8 반려 알림이 신청자에게 감', q(f"select count(*) from notifications n join businesses b on b.account_id=n.account_id where b.id='{b1}' and n.event_code='PARTNER_REJECTED'") == '1')
out = subprocess.run(['psql', DB, '-tAc', f"update partners set status='REJECTED', suspended_reason=null where id='{pid}'"], capture_output=True, text=True)
rec('3-9 DB: 사유 없는 반려는 트리거가 막음', 'PARTNER:' in out.stderr, out.stderr.strip()[:120])
st, j = call('POST', '/partner/apply', P1)
rec('3-10 반려 후 재신청 → APPLIED (전: ALREADY_APPLIED)', st < 300 and j.get('status') == 'APPLIED'
    and q(f"select suspended_reason is null from partners where id='{pid}'") == 't', (st, j))
st, j = call('POST', '/partner/apply', P1)
rec('3-11 심사 중 재신청 → 409', st == 409, (st, j))
st, j = call('POST', f'/admin/partners/{pid}/approve', ADM)
rec('3-12 승인 (SUPER) → ACTIVE', st < 300 and j.get('status') == 'ACTIVE', (st, j))

# ── 1. 서비스 검수 대기 목록 ───────────────────────────────────────
cat = q("select id from categories where gwan_code='MNY' and status='APPROVED' and restricted_code is null and code not like 'MAL%' limit 1")
cname = q(f"select name from categories where id='{cat}'")
s_ids = []
for t in ('공장 지붕 태양광 EPC', '사무실 인테리어 시공'):
    st, j = call('POST', '/partner/services', P1, {'title': f'{t} {tag}', 'body': '시공 이력 20건, 하자보증 2년. 금천·구로 우선.', 'categoryId': cat})
    s_ids.append(j.get('id'))
rec('1-0 파트너 서비스 등록 2건 (IN_REVIEW)', all(s_ids) and q(f"select count(*) from partner_services where id in ('{s_ids[0]}','{s_ids[1]}') and status='IN_REVIEW'") == '2', s_ids)
st, pend = call('GET', '/admin/partners/services/pending', OPS)
mine = [x for x in (pend or []) if x['id'] in s_ids]
rec('1-1 검수 대기 목록 (ADMIN) = DB IN_REVIEW 건수', st == 200 and len(pend) == int(q("select count(*) from partner_services where status='IN_REVIEW'")), (st, len(pend or [])))
rec('1-2 판단 필드: 회사 · 분야 · 제출 시각 · 본문', len(mine) == 2 and all(x['company'] == f'PTN상사{tag}' and x['categoryName'] == cname
    and x['submittedAt'] and x['body'] and x['partnerStatus'] == 'ACTIVE' for x in mine), mine[:1])
st, _ = call('GET', '/admin/partners/services/pending', BUY)
rec('1-3 일반 회원 → 403', st == 403, st)
st, _ = call('GET', '/admin/partners/services/pending', ADM)
rec('1-4 SUPER 조회 → 200', st == 200, st)
st, j = call('POST', f'/admin/partners/services/{s_ids[0]}/review', OPS, {'approve': True})
rec('1-5 승인 → APPROVED', st < 300 and j.get('status') == 'APPROVED', j)
st, j = call('POST', f'/admin/partners/services/{s_ids[1]}/review', OPS, {'approve': False})
rec('1-6 사유 없는 반려 → 422', st == 422, (st, j))
st, j = call('POST', f'/admin/partners/services/{s_ids[1]}/review', OPS, {'approve': False, 'reason': 'R02 정보 불충분 — 시공 사진과 보증 조건을 적어 주십시오'})
rec('1-7 반려 → REJECTED', st < 300 and j.get('status') == 'REJECTED', j)
st, pend = call('GET', '/admin/partners/services/pending', OPS)
rec('1-8 처리한 건은 대기 목록에서 빠짐', not any(x['id'] in s_ids for x in pend), len(pend))
st, j = call('POST', f'/admin/partners/services/{s_ids[0]}/review', OPS, {'approve': True})
rec('1-9 이미 처리한 건 → 409', st == 409, st)

# ── 2. 리드 반려 신청 → 인정 · 기각 ─────────────────────────────────
call('POST', '/partner/regions', P1, {'regions': [{'sido': '서울', 'sigungu': '금천구'}]})
# 리드 배정 API 가 없어 리드 · 배정만 SQL 로 넣습니다 (당월 8건 → 월 한도 2건, 72시간 지난 1건)
q(f"""with l as (insert into leads(summary,sido,sigungu) select 'PTN 시험 리드 {tag} #'||g,'서울','금천구' from generate_series(1,8) g returning id)
      insert into lead_deliveries(lead_id,partner_id) select id,'{pid}' from l""")
q(f"""with l as (insert into leads(summary,sido,sigungu) values ('PTN 시험 리드 {tag} 오래됨','서울','금천구') returning id)
      insert into lead_deliveries(lead_id,partner_id,delivered_at) select id,'{pid}',now()-interval '4 days' from l""")
st, leads = call('GET', '/partner/leads', P1)
ids = [x['deliveryId'] for x in sorted(leads, key=lambda x: x['summary'])]
st, j = charge(P1)
rec('2-0a (선불 · W5) 리드 이용료 시험 충전 100,000원', st < 300 and j.get('state') == 'DONE', (st, j))
viewed = [call('POST', f'/partner/leads/{d}/view', P1)[0] for d in ids[:4]]
old = next(x['deliveryId'] for x in leads if '오래됨' in x['summary'])
viewed.append(call('POST', f'/partner/leads/{old}/view', P1)[0])
rec('2-0 리드 열람(과금) 5건 — 실제 API', all(s < 300 for s in viewed), viewed)
st, fees = call('GET', '/partner/fees', P1)
rows = fees['rows']
f_old = next(r for r in rows if '오래됨' in r['summary'])
f_new = sorted([r for r in rows if '오래됨' not in r['summary']], key=lambda r: r['id'])
rec('2-1 이용료 목록에 신청 가능 여부(disputable) 표시', all(r['disputable'] for r in f_new) and f_old['disputable'] is False, [(r['id'], r['disputable']) for r in rows])
f1, f2, f3 = f_new[0]['id'], f_new[1]['id'], f_new[2]['id']
st, j = call('POST', f'/partner/fees/{f1}/dispute', P1, {'reasonCode': 'CHANGED_MIND', 'reason': '상담이 결렬됐습니다'})
rec('2-2 허용되지 않은 사유 코드(상담 결렬 등) → 400', st == 400, (st, j))
st, j = call('POST', f'/partner/fees/{f1}/dispute', BUY, {'reasonCode': 'FALSE_INFO', 'reason': '허위 정보입니다'})
rec('2-3 파트너 아님 → 409 NOT_PARTNER', st == 409, (st, j))
st, j = call('POST', f'/partner/fees/{f1}/dispute', P1, {'reasonCode': 'UNREACHABLE', 'reason': '안내된 번호가 결번입니다. 3회 통화 시도',
                                                        'evidence': '통화 기록: 10/1 10:02 · 13:40 · 17:15 (결번 안내)'})
rec('2-4 반려 신청 1 (연락 불가 + 근거)', st < 300 and j.get('state') == 'REQUESTED', (st, j))
d1 = j.get('id')
st, j = call('POST', f'/partner/fees/{f1}/dispute', P1, {'reasonCode': 'UNREACHABLE', 'reason': '다시 냅니다'})
rec('2-5 같은 이용료 재신청 → 409', st == 409, (st, j))
st, j = call('POST', f"/partner/fees/{f_old['id']}/dispute", P1, {'reasonCode': 'FALSE_INFO', 'reason': '허위 정보입니다'})
rec('2-6 접수 72시간 지난 리드 → 422 (트리거)', st == 422 and '72시간' in j['message'], (st, j))
# 2-7 — 남의 이용료. v10.20 (G-118): 전에는 DB 에서 「남의 이용료 아무거나 1건」을 골라, 그 이용료에 이미 반려 신청이 있으면 409 가 나왔습니다
#   (서버가 「이미 신청했는지」를 이용료 번호만으로 먼저 봄 → 남의 이용료에 신청이 있는지를 응답으로 알 수 있었음).
#   이제 이웃 파트너를 직접 만들어 「신청 없는 이용료」와 「신청 있는 이용료」 두 경우를 모두 봅니다 — 응답이 같아야 합니다.
e2, P2, b2 = bizuser('ptn2', 'PTN이웃')
st, j = call('POST', '/partner/apply', P2); pid2 = (j or {}).get('id')
call('POST', f'/admin/partners/{pid2}/approve', ADM)
call('POST', '/partner/regions', P2, {'regions': [{'sido': '서울', 'sigungu': '금천구'}]})
st, j = call('POST', '/partner/services', P2, {'title': f'이웃 설비 점검 {tag}', 'body': '점검 이력 12건, 하자보증 1년. 금천·구로 우선.', 'categoryId': cat})
call('POST', f"/admin/partners/services/{(j or {}).get('id')}/review", OPS, {'approve': True})      # 리드 열람(과금)은 승인된 서비스 · 활동 지역이 있어야 합니다
q(f"""with l as (insert into leads(summary,sido,sigungu) select 'PTN 이웃 리드 {tag} #'||g,'서울','금천구' from generate_series(1,8) g returning id)
      insert into lead_deliveries(lead_id,partner_id) select id,'{pid2}' from l""")
st, leads2 = call('GET', '/partner/leads', P2)
charge(P2)      # v10.31 (W5 · 선불) — 열람 전 시험 충전
for d in [x['deliveryId'] for x in sorted(leads2 or [], key=lambda x: x['summary'])][:2]: call('POST', f'/partner/leads/{d}/view', P2)
st, fees2 = call('GET', '/partner/fees', P2)
n_fees = sorted([r['id'] for r in (fees2 or {}).get('rows', [])])
fA, fB = (n_fees + [None, None])[:2]
st, j = call('POST', f'/partner/fees/{fA}/dispute', P2, {'reasonCode': 'UNREACHABLE', 'reason': '이웃 파트너의 반려 신청 — 3회 통화 시도 결번'})
ok_setup = bool(fA and fB) and st < 300 and q(f"select partner_id||'|'||state from lead_fee_disputes where fee_id={fA}") == f'{pid2}|REQUESTED' \
    and q(f"select count(*) from lead_fee_disputes where fee_id={fB}") == '0'
rec('2-7a (준비) 이웃 파트너의 이용료 2건 — 하나는 반려 신청 있음 · 하나는 없음', ok_setup, (fA, fB, st, j))
st_b, j_b = call('POST', f'/partner/fees/{fB}/dispute', P1, {'reasonCode': 'FALSE_INFO', 'reason': '남의 이용료(신청 없음)'})
rec('2-7 남의 이용료(반려 신청 없음) → 422 「내 이용료가 아닙니다」 (트리거)', st_b == 422 and '내 이용료가 아닙니다' in (j_b or {}).get('message', ''), (st_b, j_b))
st_a, j_a = call('POST', f'/partner/fees/{fA}/dispute', P1, {'reasonCode': 'FALSE_INFO', 'reason': '남의 이용료(신청 있음)'})
rec('2-7b 남의 이용료(반려 신청 있음) → 같은 422 · 「이미 반려를 신청한 이용료」(409)로 답하지 않음 — 남의 신청 유무를 알려 주지 않음',
    st_a == 422 and (j_a or {}).get('code') == (j_b or {}).get('code') and (j_a or {}).get('message') == (j_b or {}).get('message'), (st_a, j_a))
rec('2-7c 이웃 파트너의 신청은 그대로(1건 · 이웃 것 · REQUESTED) · 내 신청으로 바뀌지 않음',
    q(f"select count(*)||'|'||min(partner_id::text)||'|'||min(state) from lead_fee_disputes where fee_id={fA}") == f'1|{pid2}|REQUESTED'
    and q(f"select count(*) from lead_fee_disputes where partner_id='{pid}' and fee_id in ({fA},{fB})") == '0')
st, j = call('POST', '/partner/fees/999999999/dispute', P1, {'reasonCode': 'FALSE_INFO', 'reason': '없는 이용료 번호'})
rec('2-7d 없는 이용료 번호 → 같은 422 (있는 번호인지도 알려 주지 않음)', st == 422 and (j or {}).get('message') == (j_b or {}).get('message'), (st, j))
st, j = call('POST', f'/partner/fees/{fA}/dispute', P2, {'reasonCode': 'UNREACHABLE', 'reason': '이웃이 자기 것을 다시 냅니다'})
rec('2-7e 본인이 자기 이용료를 다시 신청 → 409 ALREADY_REQUESTED (그대로)', st == 409 and (j or {}).get('code') == 'ALREADY_REQUESTED', (st, j))
st, j = call('POST', f'/partner/fees/{f2}/dispute', P1, {'reasonCode': 'DUPLICATE', 'reason': '지난주 같은 요청자의 같은 건을 받았습니다'})
rec('2-8 반려 신청 2 (중복)', st < 300, (st, j))
d2 = j.get('id')
st, j = call('POST', f'/partner/fees/{f3}/dispute', P1, {'reasonCode': 'FALSE_INFO', 'reason': '면적이 실제와 다릅니다'})
rec('2-9 월 한도(수신 8건 × 15% → 2건) 초과 → 422', st == 422 and '한도' in j['message'], (st, j))
st, vr = call('GET', '/admin/partners/fees/void-requests', OPS)
mine = {x['id']: x for x in vr['items'] if x['partnerId'] == pid}
x1 = mine.get(d1) or {}
# 10/6 (v10.17) — 「당월 수신」 기대값: 방금 넣은 8건 + 「4일 전」 1건이 이번 달이면 1건 더.
#   전에는 8 로 고정해 두어 **매달 5일부터 이 항목만 실패**했습니다(1 ~ 4일에는 4일 전이 지난달이라 8, 5일부터는 9). 서버의 계산은 맞습니다.
month_recv = 8 + int(q("select (date_trunc('month', now() - interval '4 days') = date_trunc('month', now()))::int") or 0)
rec('2-10 반려 신청 목록 (ADMIN): 사유 · 근거 · 회사 · 금액 · 월 근거', len(mine) == 2 and x1.get('evidence', '').startswith('통화 기록')
    and x1.get('company') == f'PTN상사{tag}' and float(x1.get('amount') or 0) > 0 and x1.get('monthReceived') == month_recv and x1.get('monthRequested') == 2,
    {k: x1.get(k) for k in ('company', 'amount', 'monthReceived', 'monthRequested')} | {'기대 당월 수신': month_recv})
rec('2-11 인정 근거 규칙 목록(rules) 함께 옴', any(r['code'] == 'RSK-02' for r in vr['rules']), len(vr['rules']))
st, _ = call('GET', '/admin/partners/fees/void-requests', BUY)
rec('2-12 일반 회원 → 403', st == 403, st)
st, j = call('GET', '/admin/partners/fees/void-requests?state=BOGUS', OPS)
rec('2-13 잘못된 state → 422', st == 422, st)
st, j = call('POST', f'/admin/partners/fees/void-requests/{d1}/accept', OPS, {})
rec('2-14 규칙 없는 인정 → 400', st == 400, (st, j))
st, j = call('POST', f'/admin/partners/fees/void-requests/{d1}/accept', OPS, {'ruleCode': 'RSK-99'})
rec('2-15 없는 규칙 → 4xx (FK)', 400 <= st < 500, (st, j))
st, j = call('POST', f'/admin/partners/fees/void-requests/{d1}/accept', OPS, {'ruleCode': 'RSK-02', 'note': '결번 확인'})
rec('2-16 인정 → 이용료 VOIDED · void_rule', st < 300 and q(f"select state||'|'||void_rule from lead_fees where id={f1}") == 'VOIDED|RSK-02', (st, j))
rec('2-16b (선불 · W5) 인정 → 확인비용이 잔액으로 환급(RESTORE 한 번) · 원장 불변식 0',
    q(f"select count(*) from lead_cash_entries where kind='RESTORE' and ref_type='LEAD_FEE' and ref_id='{f1}'") == '1'
    and q("select count(*) from v_lead_cash_invariants") == '0', q(f"select count(*) from lead_cash_entries where kind='RESTORE' and ref_id='{f1}'"))
st, j = call('POST', f'/admin/partners/fees/void-requests/{d1}/accept', OPS, {'ruleCode': 'RSK-02'})
rec('2-17 이미 판정 → 409', st == 409, st)
st, j = call('POST', f'/admin/partners/fees/void-requests/{d2}/dismiss', ADM, {})
rec('2-18 사유 없는 기각 → 400', st == 400, (st, j))
dis = '같은 요청자라도 요청 내용이 다른 별건입니다 — 중복이 아닙니다'
st, j = call('POST', f'/admin/partners/fees/void-requests/{d2}/dismiss', ADM, {'reason': dis})
rec('2-19 기각 (SUPER) → DISMISSED · 이용료 그대로(선불 차감 = BILLED · W5)', st < 300 and q(f"select state from lead_fees where id={f2}") == 'BILLED'
    and q(f"select state||'|'||decided_by::text from lead_fee_disputes where id={d2}").startswith('DISMISSED|'), (st, j))
st, my = call('GET', '/partner/fees/disputes', P1)
m = {x['id']: x for x in my}
rec('2-20 파트너가 판정 결과 · 기각 사유를 봄', m.get(d1, {}).get('state') == 'ACCEPTED' and m.get(d2, {}).get('decisionReason') == dis, [(k, v['state']) for k, v in m.items()])
out = subprocess.run(['psql', DB, '-tAc', f"update lead_fee_disputes set state='ACCEPTED', rule_code='RSK-02' where id={d2}"], capture_output=True, text=True)
rec('2-21 DB: 판정된 신청은 바꿀 수 없음', 'LEADFEE:' in out.stderr, out.stderr.strip()[:120])
st, vr = call('GET', '/admin/partners/fees/void-requests?state=ALL', OPS)
rec('2-22 state=ALL 에 판정자 · 판정 시각', any(x['id'] == d1 and x['decidedBy'] == 'ops@t.local' and x['decidedAt'] for x in vr['items']), st)

# ── 4. 중개사 인증 심사 ────────────────────────────────────────────
e4, P4, b4 = bizuser('brk', 'BRK상사')
cat = q("select id from categories where code='MAL_OFFICE'")
# v10.31 (w2 · 10/10 시안 기준 · A-07) — 부동산(축 RE)은 소개비가 아니라 노출료: 희망 소개비를 넣으면 422 RE_EXPOSURE_FEE
st, j = call('POST', '/listings', P4, {'gwanCode': 'MAL', 'categoryId': cat, 'title': f'금천구 사무실 임대 소개 {tag}',
    'body': '가산디지털단지역 도보 5분 사무실 30평 임대 소개합니다. 관리비 포함 조건 협의 가능합니다.', 'desiredFee': 300000, 'feeBearer': 'SELLER'})
rec('4-0a 부동산 매물에 희망 소개비 → 422 RE_EXPOSURE_FEE (A-07)', st == 422 and j.get('code') == 'RE_EXPOSURE_FEE', (st, j))
st, j = call('POST', '/listings', P4, {'gwanCode': 'MAL', 'categoryId': cat, 'title': f'금천구 사무실 임대 소개 {tag}',
    'body': '가산디지털단지역 도보 5분 사무실 30평 임대 소개합니다. 관리비 포함 조건 협의 가능합니다.', 'feeBearer': 'SELLER'})
lid, rid = j.get('listingId'), j.get('reviewId')
st, j = call('PATCH', f'/admin/reviews/{rid}', ADM, {'decision': 'APPROVED'})
rec('4-0 인증 전 부동산 매물 공개 → 422 BROKER (게이트)', st == 422 and j['code'] == 'BROKER', (st, j))
st, j = call('POST', '/partner/broker', P4, {'licenseNo': f'11545-2026-{tag[:5]}', 'officeName': f'가산공인중개사{tag}', 'ceoName': '김시험'})
rec('4-1 중개사 인증 신청 (site API)', st < 300 and j.get('state') == 'PENDING', (st, j))
bv = j.get('id')
st, lst = call('GET', '/admin/brokers', OPS)
it = next((x for x in lst['items'] if x['id'] == bv), None)
rec('4-2 심사 목록 (ADMIN): 대기 건 · 대표자 일치 · 대기 매물', it and it['state'] == 'PENDING' and it['ceoMatch'] is True and it['malWaiting'] >= 1
    and it['canPublish'] is False and lst['counts']['pending'] >= 1, it)
st, _ = call('GET', '/admin/brokers', BUY)
rec('4-3 일반 회원 → 403', st == 403, st)
st, _ = call('GET', '/admin/brokers?state=NOPE', OPS)
rec('4-4 잘못된 state → 422', st == 422, st)
st, _ = call('GET', f'/admin/brokers/{uuid.uuid4()}', OPS)
rec('4-5 없는 신청 → 404', st == 404, st)
st, d = call('GET', f'/admin/brokers/{bv}', OPS)
rec('4-6 상세 (ADMIN)', st == 200 and d['licenseNo'].startswith('11545-2026') and d['accountEmail'] == e4, (st, d and d.get('company')))
st, j = call('POST', f'/admin/brokers/{bv}/decide', OPS, {'state': 'APPROVED'})
rec('4-7 형식 밖 state → 400', st == 400, (st, j))
st, j = call('POST', f'/admin/brokers/{bv}/decide', OPS, {'state': 'REJECTED'})
rec('4-8 사유 없는 반려 → 422', st == 422 and j['code'] == 'REASON_REQUIRED', (st, j))
rj = '등록증의 사무소 상호와 다릅니다 — 등록증에 적힌 그대로 입력해 주십시오'
st, j = call('POST', f'/admin/brokers/{bv}/decide', OPS, {'state': 'REJECTED', 'reason': rj})
rec('4-9 반려 (ADMIN)', st < 300 and j.get('state') == 'REJECTED', (st, j))
st, me = call('GET', '/partner/broker', P4)
rec('4-10 신청자 화면 API 에 반려 · 사유 · 판정 시각', me.get('state') == 'REJECTED' and me.get('rejectReason') == rj and me.get('decidedAt'), me)
st, j = call('POST', '/partner/broker', P4, {'licenseNo': f'11545-2026-{tag[:5]}', 'officeName': f'가산공인중개사사무소{tag}', 'ceoName': '김시험'})
rec('4-11 반려 후 재신청 → PENDING (전: UNIQUE 위반 500)', st < 300 and j.get('state') == 'PENDING' and j.get('id') == bv, (st, j))
st, j = call('POST', '/partner/broker', P4, {'licenseNo': 'x', 'officeName': 'y', 'ceoName': 'z'})
rec('4-12 심사 중 재신청 → 409', st == 409, (st, j))
q(f"update broker_verifications set lookup_result=null where id='{bv}'")
st, j = call('POST', f'/admin/brokers/{bv}/decide', ADM, {'state': 'VERIFIED'})
rec('4-13 국토부 대조 없으면 승인 불가 → 422 BROKER (트리거)', st == 422 and j['code'] == 'BROKER', (st, j))
q(f"update broker_verifications set lookup_result='MATCH', lookup_at=now() where id='{bv}'")
st, j = call('POST', f'/admin/brokers/{bv}/decide', ADM, {'state': 'VERIFIED'})
rec('4-14 승인 (SUPER) → VERIFIED · 재확인 기한 · canPublish', st < 300 and j.get('state') == 'VERIFIED' and j.get('recheckDue') and j.get('canPublish') is True, (st, j))
rec('4-15 businesses.broker_verified_at 동기화', q(f"select broker_verified_at is not null from businesses where id='{b4}'") == 't')
st, j = call('POST', f'/admin/brokers/{bv}/decide', ADM, {'state': 'REJECTED', 'reason': 'x'})
rec('4-16 이미 판정 → 409', st == 409, st)
st, j = call('PATCH', f'/admin/reviews/{rid}', ADM, {'decision': 'APPROVED'})
rec('4-17 승인 후 같은 매물 공개 → PUBLISHED (게이트 열림)', st < 300 and q(f"select status from listings where id='{lid}'") == 'PUBLISHED', (st, j))
st, me = call('GET', '/partner/broker', P4)
rec('4-18 신청자 화면 API: VERIFIED · canPublish', me.get('state') == 'VERIFIED' and me.get('canPublish') is True, me)
rec('4-19 판정 알림 2건 (반려 · 승인)', q(f"select count(*) from notifications n join businesses b on b.account_id=n.account_id where b.id='{b4}' and n.event_code like 'BROKER_%'") == '2')

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_ptn.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
