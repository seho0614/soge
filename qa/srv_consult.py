"""10/2 v10.11 — 올린 kit(v10.4.7) 안심소개 변경분: 축별 입점 · 법률 · 세무 월 정액 노출 (D018 · D019) API 검증.

  A. 업종      GET /consult/categories — 22종(리드형 20 · 정액 노출형 2) · 카드 · 금융 보관 · 준비 중 없음
  B. 축별 입점  GET · POST /partner/axes → GET /admin/partner-axes → POST /admin/partner-axes/{id}/decide
               부동산은 중개사 인증 필요 · 반려는 사유 5자 · 반려된 축만 재신청 · 알림
  C. 정액 노출  GET /consult/directory/{code} · GET · POST /partner/directory · GET /admin/directory
               POST /admin/directory/{id}/activate | reject | end — 자격 · 입점 승인 · 금액 · 기간 · 입금 근거
               노출 순서 섞기 · 「광고」 표시 · 기간 지나면 자동으로 빠짐 · 리드 · 상담 신청은 만들지 않음
  D. DB 규칙    trg_directory_guard · ck_directory_active · 건수 연동 칸 없음 · 감시 뷰 0
  G. 보관 기간  (v10.12) 신청 표 6개월 · 전달된 연락처 90일 — 별도 유지
  F. 기준 금액  (v10.12 · D020) 설정 directory.monthly_fee — 관리자 등록 · 시작값 300,000원 · 금액을 비우면 기준 금액

  v10.33 (D092 · 부가세 별도 · 기간 연장 A안) 에 맞춘 곳 — 까닭: 노출 기간은 이제 개월 단위(시작일 + 개월수)이고, 회차 이력이
  겹치면 DB 가 거부하며, 노출 중인 항목의 기간은 「다시 켜기」가 아니라 업체 연장 신청 → 운영 연장 입금 확인으로만 늘립니다.
    · ok_body 를 종료일(today+30) 대신 개월수(1)로 — 날짜에 따라 30일이 한 달과 어긋나는 날이 있었음
    · C-23 노출 중 항목 「다시 켜기」로 연장 → 409 NOT_ACTIVATABLE(연장 신청으로 안내)
    · F-7 다시 켤 때 시작일 = 이전 회차 종료일 다음 날(겹침 거부 때문) · F-11 기준 금액 바꾼 뒤 연장 = 연장 신청 → 입금 확인
    · F-12 금액 우선(270,000원)은 세무 항목(세무 자격 승인 뒤)에서 · F-13 monthlyFee: null 은 종료 → 다시 신청 → 다시 켜기에서
  (부가세 · 연장 · 세금계산서 자체는 qa/test_v1033_directory.py)

  (상담 신청 → 휴대폰 확인 → 1곳 배분은 srv_lead.py 가 봅니다)
사용: API=http://localhost:3000 python3 srv_consult.py     매 실행마다 새 계정을 만듭니다(재실행 안전).
"""
import json, urllib.request, subprocess, uuid, sys, os, datetime
API = (os.environ.get('API') or 'http://localhost:3000').rstrip('/').removesuffix('/api/v1')
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'
R = []

def psql(s):
    return subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True)
q = lambda s: psql(s).stdout.strip().split('\n')[0]

def call(m, p, tok=None, body=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(API + '/api/v1' + p, method=m,
        data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:240]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)

def login(e, pw='sgb-dev-1234'):
    return call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']

ADM = login('admin@x.com'); OPS = login('ops@t.local', 'sgb-test-1234'); BUY = login('buyer@x.com')
tag = uuid.uuid4().hex[:6]

def member(prefix):
    e = f'{prefix}_{tag}@t.local'
    call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': f'{prefix}시험', 'agreedTerms': []})
    return e, login(e, 'sgb-test-1234')

def bizuser(prefix, company):
    e, T = member(prefix)
    call('POST', '/verifications/identity', T, {'provider': 'PASS'})
    st, j = call('POST', '/businesses', T, {'bizRegNo': str(uuid.uuid4().int)[-10:], 'companyName': f'{company}{tag}', 'ceoName': '김시험',
                                            'sido': '서울', 'sigungu': '금천구'})
    bid = (j or {}).get('businessId')
    call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    return {'email': e, 'tok': login(e, 'sgb-test-1234'), 'bid': bid, 'company': f'{company}{tag}',
            'account': q(f"select account_id from businesses where id='{bid}'")}

def axis_id(u, axis):
    return q(f"select id from mal_partner_axes where business_id='{u['bid']}' and axis='{axis}'")

# ── A. 업종 ─────────────────────────────────────────────────────────
print('== A. 업종 ==', file=sys.stderr)
st, cats = call('GET', '/consult/categories')
cc = {c['code']: c for c in cats or []}
rec('A-1 업종 목록 공개 22 (리드형 20 · 정액 노출형 2) · 로그인 없이', st == 200 and len(cats) == 22 and sum(c['consultMode'] == 'LISTING_FEE' for c in cats) == 2
    and all(c['status'] == 'APPROVED' for c in cats), len(cats or []))
gated = {c['code'] for c in cats if c['publishMode'] == 'GATED'}
rec('A-2 자격 확인(GATED) 12 = 리드형 10(보험 · 의료 · 이사짐 · 인테리어 · 건설 · 자동차 · 여행 · 교육 · 물류 · 통신) + 법률 · 세무',
    gated == {'CSL_INSURANCE', 'CSL_MEDICAL', 'CSL_MOVING', 'CSL_INTERIOR', 'CSL_CONSTRUCTION', 'CSL_AUTO', 'CSL_TRAVEL', 'CSL_EDU', 'CSL_LOGISTICS', 'CSL_TELCO', 'CSL_LEGAL', 'CSL_TAX'}, sorted(gated))
rec('A-3 일반 10 = 청소 · 웨딩 · 행사 · 렌탈 · 중고차 · 광고 · 디자인 · IT · 제조 · 유통', {c['code'] for c in cats if c['publishMode'] == 'OPEN'}
    == {'CSL_CLEANING', 'CSL_WEDDING', 'CSL_EVENT', 'CSL_RENTAL', 'CSL_USEDCAR', 'CSL_MARKETING', 'CSL_DESIGN', 'CSL_IT', 'CSL_MANUFACTURE', 'CSL_TRADE'})
rec('A-4 카드 · 금융은 보관(목록에 없음) · 렌터카는 「자동차(정비·렌트)」로 합침', 'CSL_CARD' not in cc and 'CSL_FINANCE' not in cc and 'CSL_RENTCAR' not in cc
    and cc['CSL_AUTO']['name'] == '자동차(정비·렌트)' and q("select status from categories where code='CSL_CARD'") == 'ARCHIVED')
rec('A-5 자격 규칙 — 법률 · 세무는 실제 등록증 규칙(LEGAL · TAX)에 연결', q("select count(*) from restricted_industries r join qualification_rules qr on qr.category_code=r.qual_code "
    "where r.gwan_code='MAL' and r.code in ('CSL_LEGAL','CSL_TAX') and r.qual_code in ('LEGAL','TAX')") == '2')

# ── B. 축별 입점 ─────────────────────────────────────────────────────
print('== B. 축별 입점 ==', file=sys.stderr)
P = bizuser('cax', '축입점상사')
st, j = call('POST', '/partner/axes', None, {'axes': ['CONSULT']})
rec('B-1 토큰 없이 입점 신청 → 403', st == 403, st)
e0, T0 = member('caxn')
st, j = call('POST', '/partner/axes', T0, {'axes': ['CONSULT']})
rec('B-2 본인인증 전 회원(사업자 정보 없음) → 422 IDENTITY_REQUIRED (v10.38 P2P — 사업자는 요구하지 않음)', st == 422 and j['code'] == 'IDENTITY_REQUIRED', (st, j))
st, j = call('POST', '/partner/axes', P['tok'], {'axes': ['NOPE']})
st2, j2 = call('POST', '/partner/axes', P['tok'], {'axes': []})
rec('B-3 없는 축 · 빈 목록 → 400', st == 400 and st2 == 400, (st, st2))
st, ax = call('GET', '/partner/axes', P['tok'])
rec('B-4 신청 전 내 입점 상태 = 빈 목록', st == 200 and ax == [], ax)
st, ax = call('POST', '/partner/axes', P['tok'], {'axes': ['CONSULT', 'RE', 'EQUIP', 'SOLAR']})
rec('B-5 4개 축 입점 신청 → 모두 심사 중(PENDING) · 경위 APPLY', st < 300 and len(ax) == 4 and all(a['state'] == 'PENDING' and a['source'] == 'APPLY' for a in ax), ax)
st, ax2 = call('POST', '/partner/axes', P['tok'], {'axes': ['CONSULT']})
rec('B-6 심사 중인 축을 다시 신청해도 그대로(중복 행 없음)', st < 300 and len(ax2) == 4
    and q(f"select count(*) from mal_partner_axes where business_id='{P['bid']}'") == '4', ax2)
st, _ = call('GET', '/admin/partner-axes', P['tok'])
rec('B-7 일반 회원은 관리자 목록 → 403', st == 403, st)
st, _ = call('GET', '/admin/partner-axes?state=NOPE', OPS)
rec('B-8 잘못된 state → 422', st == 422, st)
st, lst = call('GET', '/admin/partner-axes?state=PENDING', OPS)
mine = [x for x in lst or [] if x['company'] == P['company']]
rec('B-9 관리자 목록(PENDING) — 업체 · 사업자번호 · 국세청 단계 · 중개사 인증 여부', st == 200 and len(mine) == 4
    and all(x['bizRegNo'] and 'ntsEnv' in x and x['brokerVerified'] is False for x in mine), mine[:1])
re_id, csl_id, eq_id, so_id = (axis_id(P, a) for a in ('RE', 'CONSULT', 'EQUIP', 'SOLAR'))
st, j = call('POST', f'/admin/partner-axes/{re_id}/decide', OPS, {'approve': True})
rec('B-10 부동산 축 승인 — 중개사 인증 없으면 422 AXIS_BROKER (DB)', st == 422 and j['code'] == 'AXIS_BROKER'
    and q(f"select state from mal_partner_axes where id='{re_id}'") == 'PENDING', (st, j))
st, j = call('POST', f'/admin/partner-axes/{re_id}/decide', OPS, {'approve': False})
st2, j2 = call('POST', f'/admin/partner-axes/{re_id}/decide', OPS, {'approve': False, 'reason': '짧음'})
rec('B-11 사유 없는 · 5자 미만 반려 → 422 AXIS_REASON', st == 422 and j['code'] == 'AXIS_REASON' and st2 == 422 and j2['code'] == 'AXIS_REASON', (st, j, st2))
st, j = call('POST', f'/admin/partner-axes/{re_id}/decide', OPS, {'approve': False, 'reason': '개업공인중개사 인증을 먼저 받아 주십시오'})
rec('B-12 사유 있는 반려 → REJECTED · 신청자에게 사유 알림', st < 300 and j['state'] == 'REJECTED'
    and q(f"select count(*) from notifications where account_id='{P['account']}' and event_code='PARTNER_AXIS_DECIDED' and body like '%중개사 인증%'") == '1', (st, j))
st, j = call('POST', f'/admin/partner-axes/{csl_id}/decide', OPS, {'approve': True})
rec('B-13 상담 축 승인 → APPROVED · 판정자 · 판정 시각 · 알림', st < 300 and j['state'] == 'APPROVED'
    and q(f"select (decided_by is not null and decided_at is not null) from mal_partner_axes where id='{csl_id}'") == 't'
    and q(f"select count(*) from notifications where account_id='{P['account']}' and event_code='PARTNER_AXIS_DECIDED' and title like '%승인%'") == '1', (st, j))
st, j = call('POST', f'/admin/partner-axes/{csl_id}/decide', OPS, {'approve': False, 'reason': '다시 판정 시도입니다'})
rec('B-14 이미 판정한 신청 → 409 NOT_PENDING', st == 409 and j['code'] == 'NOT_PENDING', (st, j))
st, j = call('POST', f'/admin/partner-axes/{uuid.uuid4()}/decide', OPS, {'approve': True})
st2, _ = call('POST', '/admin/partner-axes/nope/decide', OPS, {'approve': True})
rec('B-15 없는 신청 → 409 · 번호 형식 아님 → 404', st == 409 and st2 == 404, (st, st2))
st, ax = call('POST', '/partner/axes', P['tok'], {'axes': ['RE', 'CONSULT']})
by = {a['axis']: a for a in ax or []}
rec('B-16 반려된 축(부동산)만 다시 심사로 · 승인된 축(상담)은 그대로', st < 300 and by['RE']['state'] == 'PENDING' and by['RE']['reason'] is None
    and by['CONSULT']['state'] == 'APPROVED', by)
st, lst = call('GET', '/admin/partner-axes?state=APPROVED', OPS)
rec('B-17 관리자 목록(APPROVED)에 승인 건 · 일괄 이관 건은 경위 BULK_MIGRATION', st == 200 and any(x['id'] == csl_id for x in lst)
    and (q("select count(*) from mal_partner_axes where source='BULK_MIGRATION'") == '0' or any(x['source'] == 'BULK_MIGRATION' for x in lst)), len(lst))
st, _ = call('POST', f'/admin/partner-axes/{eq_id}/decide', BUY, {'approve': True})
rec('B-18 일반 회원의 판정 → 403', st == 403, st)

# ── C. 법률 · 세무 월 정액 노출 ──────────────────────────────────────
print('== C. 정액 노출 ==', file=sys.stderr)
st, d0 = call('GET', '/consult/directory/CSL_LEGAL')
n0 = len((d0 or {}).get('entries', []))
rec('C-1 정액 노출 목록 — 로그인 없이 · 「광고」 표시 · 안내 문구', st == 200 and d0['adLabel'] == '광고' and '추천 순위가 아닙니다' in d0['note']
    and d0['category']['code'] == 'CSL_LEGAL', (st, n0))
st, _ = call('GET', '/consult/directory/CSL_CLEANING')
st2, _ = call('GET', '/consult/directory/NOPE')
rec('C-2 리드형 업종 · 없는 업종의 정액 노출 목록 → 404', st == 404 and st2 == 404, (st, st2))
body = {'categoryCode': 'CSL_LEGAL', 'displayName': f'법무법인 한빛{tag}', 'intro': '민사 · 가사 · 부동산 분쟁', 'contactPhone': '02-1234-5678',
        'websiteUrl': 'https://example.com', 'sido': '서울'}
st, j = call('POST', '/partner/directory', None, body)
rec('C-3 토큰 없이 게재 신청 → 403', st == 403, st)
st, j = call('POST', '/partner/directory', P['tok'], body)
rec('C-4 입점(파트너) 신청 전 업체 → 422 PARTNER_REQUIRED', st == 422 and j['code'] == 'PARTNER_REQUIRED', (st, j))
st, pj = call('POST', '/partner/apply', P['tok'])
P['pid'] = (pj or {}).get('id')
call('POST', f"/admin/partners/{P['pid']}/approve", ADM)
st, j = call('POST', '/partner/directory', P['tok'], dict(body, categoryCode='CSL_CLEANING'))
rec('C-5 리드형 업종으로 게재 신청 → 400(업종은 법률 · 세무만)', st == 400, (st, j))
for k, v, lab in (('contactPhone', '전화번호아님', '대표번호 형식'), ('websiteUrl', 'http://example.com', 'https 아닌 홈페이지'), ('displayName', '', '빈 사무소 이름')):
    st, j = call('POST', '/partner/directory', P['tok'], dict(body, **{k: v}))
    rec(f'C-6 {lab} → 400', st == 400, (st, j))
st, mine = call('POST', '/partner/directory', P['tok'], body)
ent = next((x for x in mine or [] if x['categoryCode'] == 'CSL_LEGAL'), None)
rec('C-7 게재 신청 → 심사 · 입금 확인 대기(PENDING) · 공개 목록에는 아직 없음', st < 300 and ent and ent['state'] == 'PENDING'
    and len(call('GET', '/consult/directory/CSL_LEGAL')[1]['entries']) == n0, ent)
st, mine = call('POST', '/partner/directory', P['tok'], dict(body, intro='민사 · 가사 · 부동산 · 상속'))
rec('C-8 다시 내면 정보만 고침(항목 1개 그대로)', st < 300 and len([x for x in mine if x['categoryCode'] == 'CSL_LEGAL']) == 1 and mine[0]['intro'].endswith('상속'), mine)
st, _ = call('GET', '/admin/directory', P['tok'])
rec('C-9 일반 회원은 정액 노출 관리 → 403', st == 403, st)
st, lst = call('GET', '/admin/directory?state=PENDING', OPS)
row = next((x for x in lst or [] if x['id'] == ent['id']), None)
rec('C-10 관리자 목록 — 업체 · 사업자번호 · 자격 확인 여부(미확인)', st == 200 and row and row['company'] == P['company'] and row['qualified'] is False, row)
today = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()
# v10.33 — 기간은 개월 단위(종료일 = 시작일 + 개월수 − 1일 · DB fn_directory_period_to)
ok_body = {'monthlyFee': 100000, 'paidFrom': str(today), 'months': 1, 'paymentRef': f'입금자 한빛 · 시험 {tag}'}
pto = lambda frm, m=1: q(f"select fn_directory_period_to('{frm}'::date, {m})::text")
nextday = lambda d: str(datetime.date.fromisoformat(d) + datetime.timedelta(days=1))
st, j = call('POST', f"/admin/directory/{ent['id']}/activate", OPS, ok_body)
rec('C-11 자격 심사 전 노출 켜기 → 422 DIRECTORY_QUALIFICATION (DB)', st == 422 and j['code'] == 'DIRECTORY_QUALIFICATION', (st, j))
qid = q(f"insert into qualification_reviews(business_id, category_code, doc_no) values ('{P['bid']}','LEGAL','LAW-{tag}') returning id")
s1, _ = call('POST', f'/admin/qualifications/{qid}/lookup', OPS)
s2, _ = call('POST', f'/admin/qualifications/{qid}/decide', OPS, {'approve': True})
rec('C-12 법률 자격 심사 승인(운영 API · 신청 행만 SQL)', s1 < 300 and s2 < 300 and q(f"select state from qualification_reviews where id='{qid}'") == 'APPROVED', (s1, s2))
st, j = call('POST', f"/admin/directory/{ent['id']}/activate", OPS, dict(ok_body, monthlyFee=0))
st2, j2 = call('POST', f"/admin/directory/{ent['id']}/activate", OPS, dict(ok_body, paymentRef=' '))
st3, j3 = call('POST', f"/admin/directory/{ent['id']}/activate", OPS, dict(ok_body, paidTo=str(today - datetime.timedelta(days=3))))
rec('C-13 노출료 0원 · 입금 근거 없음 · 종료일이 시작일보다 앞 → 거부', st in (400, 422) and st2 in (400, 422) and st3 in (400, 422, 409)
    and q(f"select state from consult_directory_entries where id='{ent['id']}'") == 'PENDING', (st, st2, st3, j3))
# 상담 축 입점 승인이 없는 업체는 자격이 있어도 켤 수 없습니다
P2 = bizuser('cax2', '미입점법무')
st, pj = call('POST', '/partner/apply', P2['tok']); call('POST', f"/admin/partners/{pj['id']}/approve", ADM)
q2 = q(f"insert into qualification_reviews(business_id, category_code, doc_no) values ('{P2['bid']}','LEGAL','LAW2-{tag}') returning id")
call('POST', f'/admin/qualifications/{q2}/lookup', OPS); call('POST', f'/admin/qualifications/{q2}/decide', OPS, {'approve': True})
st, m2 = call('POST', '/partner/directory', P2['tok'], dict(body, displayName=f'미입점 법률{tag}'))
st, j = call('POST', f"/admin/directory/{m2[0]['id']}/activate", OPS, ok_body)
rec('C-14 상담 축 입점 승인 없는 업체 → 422 DIRECTORY_AXIS (DB)', st == 422 and j['code'] == 'DIRECTORY_AXIS', (st, j))
st, j = call('POST', f"/admin/directory/{ent['id']}/activate", OPS, ok_body)
rec('C-15 입금 확인 → 노출 켜기(ACTIVE) · 금액 · 기간 · 판정자', st < 300 and j['state'] == 'ACTIVE'
    and q(f"select monthly_fee::int||'|'||(decided_by is not null)||'|'||payment_ref from consult_directory_entries where id='{ent['id']}'") == f"100000|true|입금자 한빛 · 시험 {tag}", (st, j))
st, d1 = call('GET', '/consult/directory/CSL_LEGAL')
e1 = next((x for x in d1['entries'] if x['id'] == ent['id']), None)
rec('C-16 공개 목록에 사무소 · 대표번호 · 홈페이지 — 사업자번호 · 금액 · 입금 근거는 내려가지 않음', st == 200 and e1 and e1['contactPhone'] == '02-1234-5678'
    and e1['websiteUrl'] == 'https://example.com' and len(d1['entries']) == n0 + 1
    and not any(k in json.dumps(d1) for k in ('monthlyFee', 'paymentRef', 'bizRegNo', '입금자')), e1)
st, cats = call('GET', '/consult/categories')
rec('C-17 업종 목록의 법률 「게재 N곳」 = 공개 목록 수', next(c for c in cats if c['code'] == 'CSL_LEGAL')['partnerCount'] == len(d1['entries']), len(d1['entries']))
st, mine = call('GET', '/partner/directory', P['tok'])
rec('C-18 업체 화면 — 노출 중 · 기간 · 금액(v10.33 부가세 별도 — 공급가액 100,000 · 부가세 10,000 · 합계 110,000)', st == 200 and mine[0]['state'] == 'ACTIVE' and mine[0]['paidTo'] == pto(today)
    and float(mine[0]['monthlyFee']) == 100000 and mine[0]['vatAmount'] == 10000 and mine[0]['totalAmount'] == 110000, mine[0])
order_today = q(f"select string_agg(id::text, ',' order by md5(id::text || (now() at time zone 'Asia/Seoul')::date::text)) from v_consult_directory_public where category_id=(select id from categories where code='CSL_LEGAL')")
rec('C-19 노출 순서 = 날짜로 섞은 순서(돈 · 신청 순서와 무관)', ','.join(x['id'] for x in d1['entries']) == order_today, order_today[:60])
leads0 = q("select count(*) from leads"); cr0 = q("select count(*) from consult_requests")
st, j = call('POST', '/consult/requests', None, {'categoryCode': 'CSL_LEGAL', 'name': '이영희', 'phone': '010-4444-5555', 'email': 'consult.test@example.com', 'sido': '서울', 'agree': True})
rec('C-20 정액 노출형(법률) 상담 신청 → 422 CONSULT_DIRECTORY_ONLY · 리드 · 신청 행 안 생김', st == 422 and j['code'] == 'CONSULT_DIRECTORY_ONLY'
    and q("select count(*) from leads") == leads0 and q("select count(*) from consult_requests") == cr0, (st, j))
ok = psql(f"BEGIN; update consult_directory_entries set paid_to = (now() at time zone 'Asia/Seoul')::date - 1, paid_from = (now() at time zone 'Asia/Seoul')::date - 31 where id='{ent['id']}'; "
          f"select 'in_public='||count(*) from v_consult_directory_public where id='{ent['id']}'; select 'lapsed='||count(*) from v_consult_directory_lapsed where id='{ent['id']}'; ROLLBACK;").stdout
rec('C-21 노출 기간이 지나면 공개 목록에서 자동으로 빠짐 · 운영 관찰 뷰에 보임', 'in_public=0' in ok and 'lapsed=1' in ok, ok.strip()[-60:])
ok = psql(f"BEGIN; set local session_replication_role=replica; update qualification_reviews set state='REJECTED' where id='{qid}'; set local session_replication_role=origin; "
          f"select 'in_public='||count(*) from v_consult_directory_public where id='{ent['id']}'; ROLLBACK;").stdout
rec('C-22 자격 승인이 풀리면 공개 목록에서 빠짐', 'in_public=0' in ok, ok.strip()[-40:])
st, j = call('POST', f"/admin/directory/{ent['id']}/activate", OPS, dict(ok_body, months=2))
rec('C-23 (v10.33 A안) 노출 중인 항목을 「다시 켜기」로 연장 → 409 NOT_ACTIVATABLE — 연장은 업체 연장 신청 → 연장 입금 확인', st == 409 and j['code'] == 'NOT_ACTIVATABLE'
    and q(f"select paid_to::text from consult_directory_entries where id='{ent['id']}'") == pto(today), (st, j))
st, j = call('POST', f"/admin/directory/{ent['id']}/reject", OPS, {'reason': '노출 중인 것은 반려할 수 없습니다'})
rec('C-24 노출 중인 항목 반려 → 409 NOT_CLOSABLE', st == 409 and j['code'] == 'NOT_CLOSABLE', (st, j))
st, j = call('POST', f"/admin/directory/{ent['id']}/end", OPS, {'reason': '짧'})
rec('C-25 사유 없는 종료 → 422 DIRECTORY_REASON', st == 422 and j['code'] == 'DIRECTORY_REASON', (st, j))
st, j = call('POST', f"/admin/directory/{ent['id']}/end", OPS, {'reason': '계약 기간 종료 요청'})
st2, d2 = call('GET', '/consult/directory/CSL_LEGAL')
rec('C-26 종료 → 공개 목록에서 빠짐 · 업체 화면에 사유', st < 300 and not any(x['id'] == ent['id'] for x in d2['entries'])
    and call('GET', '/partner/directory', P['tok'])[1][0]['reason'] == '계약 기간 종료 요청', (st, j))
st, mine = call('POST', '/partner/directory', P['tok'], body)
rec('C-27 종료된 항목을 다시 내면 심사 대기로(PENDING · 사유 지움)', st < 300 and mine[0]['state'] == 'PENDING' and mine[0]['reason'] is None, mine[0])
st, j = call('POST', f"/admin/directory/{m2[0]['id']}/reject", OPS, {'reason': '상담 축 입점 승인을 먼저 받아 주십시오'})
rec('C-28 심사 중인 신청 반려 → REJECTED · 사유', st < 300 and j['state'] == 'REJECTED', (st, j))
st, tx = call('POST', '/partner/directory', P['tok'], dict(body, categoryCode='CSL_TAX', displayName=f'한결 세무회계{tag}'))
ent_t = next(x for x in tx if x['categoryCode'] == 'CSL_TAX')
st, j = call('POST', f"/admin/directory/{ent_t['id']}/activate", OPS, ok_body)
rec('C-29 세무는 세무 자격(TAX)이 따로 — 법률 자격만으로는 422 DIRECTORY_QUALIFICATION', st == 422 and j['code'] == 'DIRECTORY_QUALIFICATION' and 'TAX' in j['message'], (st, j))

# ── D. DB 규칙 ──────────────────────────────────────────────────────
print('== D. DB ==', file=sys.stderr)
def blocked(sql, word):
    o = psql(f"BEGIN; {sql}; ROLLBACK;")
    return word in o.stderr, o.stderr.strip()[:140]
ok, e = blocked(f"insert into consult_directory_entries(partner_id,category_id,display_name,contact_phone,sido) values ('{P['pid']}',(select id from categories where code='CSL_CLEANING'),'청소업체','02-123-4567','서울')", 'DIRECTORY_CATEGORY')
rec('D-1 리드형 업종에 정액 노출 → 트리거 거부(DIRECTORY_CATEGORY)', ok, e)
ok, e = blocked(f"update consult_directory_entries set state='ACTIVE', monthly_fee=100000, paid_from=current_date, paid_to=current_date+30, payment_ref=null where id='{ent['id']}'", 'ck_directory_active')
rec('D-2 입금 근거 없이 ACTIVE → 제약 거부(ck_directory_active)', ok, e)
ok, e = blocked(f"update consult_directory_entries set state='ENDED', reason=null where id='{ent['id']}'", 'ck_directory_reason')
rec('D-3 사유 없이 종료 → 제약 거부(ck_directory_reason)', ok, e)
rec('D-4 노출료는 기간 정액 — 클릭 · 연락 · 성사 건수와 잇는 칸 없음', q("select count(*) from information_schema.columns where table_name='consult_directory_entries' and column_name ~ '(click|contact_count|per_lead|success|commission)'") == '0')
ok, e = blocked(f"insert into mal_partner_axes(business_id,axis,state,decided_at) values ((select id from businesses where id not in (select business_id from mal_partner_axes where axis='SOLAR') limit 1),'SOLAR','REJECTED',now())", 'AXIS_REASON')
rec('D-5 축 반려는 사유 필수(DB 트리거)', ok, e)
rec('D-6 연락처 원문 칸 없음(consult_requests — 암호문만)', q("select count(*) from information_schema.columns where table_name='consult_requests' and column_name in ('phone','name','contact')") == '0')
for v in ('v_directory_lead_leak', 'v_consult_lead_unverified', 'v_lead_multi_delivery', 'v_consult_purge_overdue'):
    n = q(f"select count(*) from {v}")
    rec(f'D-V {v} = 0', n == '0', n)

# ── F. 월 노출료 기준 금액(D020 · v10.12) — 관리자가 등록 · 시작값 300,000원 ──────────
print('== F. 기준 금액 ==', file=sys.stderr)
KEY = 'directory.monthly_fee'
base0 = q(f"select value from site_settings where key='{KEY}'")
def set_base(v, tok=None):
    return call('PATCH', '/admin/site-settings', tok or OPS, {'key': KEY, 'value': v})
try:
    rec('F-1 설정 directory.monthly_fee 가 있고 형식 규칙 · 예시가 붙어 있음',
        q(f"select (value ~ value_pattern)::text||'|'||scope||'|'||is_required_for_open::text||'|'||value_example from site_settings where key='{KEY}'") == 'true|GLOBAL|false|300000', base0)
    if base0 != '300000': set_base('300000')
    rec('F-2 시작값 300,000원 — fn_directory_base_fee() = 300000', q('select fn_directory_base_fee()::int') == '300000')
    st, pub = call('GET', '/site-settings/public')
    rec('F-3 공개 설정에 기준 금액이 실림(업체 신청 화면 안내용)', st == 200 and pub.get(KEY) == '300000', pub.get(KEY))
    st, lst = call('GET', '/admin/site-settings', OPS)
    row = next((x for x in lst if x['key'] == KEY), None)
    rec('F-4 관리자 설정 목록에 보이고 오류 표시 없음', st == 200 and row and row['value'] == '300000' and not row['hasIssue'], row)
    st, j = set_base('300000', P['tok'])
    st2, j2 = call('PATCH', '/admin/site-settings', None, {'key': KEY, 'value': '1'})
    rec('F-5 기준 금액 변경은 관리자만 — 업체 403 · 비로그인 403(UNAUTHENTICATED)', st == 403 and st2 == 403 and j2['code'] == 'UNAUTHENTICATED' and q('select fn_directory_base_fee()::int') == '300000', (st, st2))
    bad = []
    for v in ('30만원', '0', '300,000', '-1', '12', '3000000000', ''):
        st, j = set_base(v)
        bad.append((v, st, (j or {}).get('code')))
    rec('F-6 형식이 틀린 값은 저장하지 않음(422 SETTING_FORMAT) — 글자 · 0 · 쉼표 · 음수 · 너무 작음 · 너무 큼 · 빈 값',
        all(s == 422 and c == 'SETTING_FORMAT' for _, s, c in bad) and q('select fn_directory_base_fee()::int') == '300000', bad)
    # ent 는 C-27 에서 다시 내 PENDING 입니다 — 금액을 비우고 켭니다
    # v10.33 — 이전 회차(C-15)와 겹치면 DB 가 거부하므로 그 종료일 다음 날부터 켭니다
    nofee = {k: v for k, v in ok_body.items() if k != 'monthlyFee'}
    nofee['paidFrom'] = nextday(pto(today))
    st, j = call('POST', f"/admin/directory/{ent['id']}/activate", OPS, nofee)
    rec('F-7 금액을 비우고 켜면 기준 금액으로 기록(300,000원)', st < 300 and j['state'] == 'ACTIVE'
        and q(f"select monthly_fee::int from consult_directory_entries where id='{ent['id']}'") == '300000', (st, j))
    st, mine = call('GET', '/partner/directory', P['tok'])
    me = next(x for x in mine if x['id'] == ent['id'])
    rec('F-8 업체 화면에 기록된 금액 300,000원', float(me['monthlyFee']) == 300000, me.get('monthlyFee'))
    st, j = set_base('350000')
    rec('F-9 기준 금액 변경 → 350,000원 · 감사 기록(SITE_SETTING_UPDATE)', st < 300 and j['value'] == '350000' and q('select fn_directory_base_fee()::int') == '350000'
        and int(q("select count(*) from audit.audit_logs where action='SITE_SETTING_UPDATE' and occurred_at > now() - interval '1 minute'")) >= 1, (st, j))
    rec('F-10 이미 노출 중인 건의 금액은 그대로(300,000원) — 기준 금액은 다음에 켜는 건부터',
        q(f"select monthly_fee::int from consult_directory_entries where id='{ent['id']}'") == '300000')
    # v10.33 A안 — 연장은 업체 연장 신청(그때 기준 금액) → 운영 연장 입금 확인
    st, j = call('POST', f"/partner/directory/{ent['id']}/renew", P['tok'], {'months': 1})
    st2, j2 = call('POST', f"/admin/directory/{ent['id']}/renew/confirm", OPS, {'paymentRef': f'연장 입금 · 시험 {tag}'})
    rec('F-11 기간 연장(연장 신청 → 입금 확인) → 바뀐 기준 금액 350,000원으로 기록', st < 300 and st2 < 300
        and q(f"select monthly_fee::int from consult_directory_entries where id='{ent['id']}'") == '350000', (st, st2, j2))
    qt = q(f"insert into qualification_reviews(business_id, category_code, doc_no) values ('{P['bid']}','TAX','TAX-{tag}') returning id")
    call('POST', f'/admin/qualifications/{qt}/lookup', OPS); call('POST', f'/admin/qualifications/{qt}/decide', OPS, {'approve': True})
    st, j = call('POST', f"/admin/directory/{ent_t['id']}/activate", OPS, dict(ok_body, monthlyFee=270000))
    rec('F-12 금액을 적으면 그 금액이 우선(270,000원) — 건별 조정(세무 항목 · 세무 자격 승인 뒤)', st < 300
        and q(f"select monthly_fee::int from consult_directory_entries where id='{ent_t['id']}'") == '270000', (st, j))
    call('POST', f"/admin/directory/{ent['id']}/end", OPS, {'reason': 'F-13 다시 켜기 시험'})
    call('POST', '/partner/directory', P['tok'], body)
    last = q(f"select max(period_to)::text from consult_directory_periods where entry_id='{ent['id']}'")
    st, j = call('POST', f"/admin/directory/{ent['id']}/activate", OPS, dict(nofee, paidFrom=nextday(last), monthlyFee=None))
    rec('F-13 monthlyFee: null 도 기준 금액으로(종료 → 다시 신청 → 다시 켜기)', st < 300
        and q(f"select monthly_fee::int from consult_directory_entries where id='{ent['id']}'") == '350000', (st, j))
    o = psql(f"BEGIN; update site_settings set value='미정' where key='{KEY}'; ROLLBACK;")
    rec('F-14 DB 도 형식이 틀린 기준 금액을 받지 않음(직접 SQL → fn_setting_validate 거부)', 'SETTING' in o.stderr and '형식' in o.stderr, o.stderr.strip()[:120])
    o = psql(f"BEGIN; delete from site_settings where key='{KEY}'; select 'base='||coalesce(fn_directory_base_fee()::text,'null'); ROLLBACK;").stdout
    rec('F-14b 기준 금액 설정이 없으면 fn_directory_base_fee() 는 null — 서버가 422 DIRECTORY_FEE 로 막음(금액을 적으라고 안내)', 'base=null' in o, o.strip()[-40:])
    st, d3 = call('GET', '/consult/directory/CSL_LEGAL')
    rec('F-15 공개 목록에는 금액이 나가지 않음', st == 200 and not any(k in json.dumps(d3) for k in ('monthlyFee', '350000', '300000', '270000')))
    rec('F-16 노출료는 여전히 기간 정액 — 기준 금액은 건수와 무관', q("select count(*) from site_settings where key ~ '^directory\\.' and key ~ '(click|per_lead|success|commission)'") == '0')
finally:
    set_base('300000')
rec('F-17 시험 뒤 기준 금액 300,000원으로 되돌림', q('select fn_directory_base_fee()::int') == '300000')
call('POST', f"/admin/directory/{ent['id']}/end", OPS, {'reason': '기준 금액 시험 종료'})
call('POST', f"/admin/directory/{ent_t['id']}/end", OPS, {'reason': '기준 금액 시험 종료'})

# ── G. 보관 기간 — 10/2 결정 「별도로」: 신청 표 6개월 · 업체에 전달된 연락처 90일(설정) 을 따로 둡니다 ──
print('== G. 보관 기간 ==', file=sys.stderr)
rec('G-1 상담 신청 표(consult_requests)의 파기 기한 기본값은 6개월 — 동의 문구와 같음',
    '6 mons' in q("select column_default from information_schema.columns where table_name='consult_requests' and column_name='purge_after'"))
rec('G-2 업체에 전달된 연락처 보관은 설정 privacy.lead_retention_days = 90 (신청 표 기한과 별도)',
    q("select value from site_settings where key='privacy.lead_retention_days'") == '90')
rec('G-3 두 기한은 서로 다른 곳에서 읽음 — 신청 표 파기 함수는 purge_after 만, 리드 연락처는 설정값만',
    q("select (position('purge_after' in pg_get_functiondef('fn_consult_purge'::regproc)) > 0 and position('lead_retention_days' in pg_get_functiondef('fn_consult_purge'::regproc)) = 0)::text") == 'true')

# ── E. 개발이 아닌 환경 — 알림톡 연동 전에는 신청을 받지 않습니다(인증번호가 응답으로 나가지 않음) ──
print('== E. 환경 ==', file=sys.stderr)
STG = (os.environ.get('API_STG') or 'http://localhost:3124').rstrip('/')
def call_stg(m, p, body=None):
    req = urllib.request.Request(STG + '/api/v1' + p, method=m, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'content-type': 'application/json'})
    try: r = urllib.request.urlopen(req, timeout=8); return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
try: stg_up = call_stg('GET', '/consult/categories')[0] == 200
except Exception: stg_up = False
if not stg_up:
    R.append({'step': 'E staging 인스턴스(3124)가 떠 있지 않아 건너뜀 — bash adapters_up.sh', 'ok': True, 'skip': True, 'detail': STG})
    print('skip E', STG, file=sys.stderr)
else:
    n0 = q("select count(*) from consult_requests")
    st, j = call_stg('POST', '/consult/requests', {'categoryCode': 'CSL_CLEANING', 'name': '환경시험', 'phone': '010-3124-3124', 'email': 'consult.test@example.com', 'sido': '서울', 'agree': True})
    rec('E-1 NODE_ENV=staging · 알림톡 연동 전 → 422 NOTIFY_NOT_READY · 응답에 인증번호 없음 · 신청 행 안 생김', st == 422 and j['code'] == 'NOTIFY_NOT_READY'
        and 'devCode' not in json.dumps(j) and q("select count(*) from consult_requests") == n0, (st, j))
    # 10/3 (v10.16) — 번호를 매번 새로: 같은 번호는 하루 신청 횟수 제한이 있어, 같은 날 여러 번 돌리면 이 항목만 TOO_MANY_REQUESTS 로 떨어졌습니다
    st, j = call('POST', '/consult/requests', None, {'categoryCode': 'CSL_CLEANING', 'name': '환경시험', 'phone': '010-%04d-%04d' % (uuid.uuid4().int % 9000 + 1000, uuid.uuid4().int % 10000), 'email': 'consult.test@example.com', 'sido': '서울', 'agree': True})
    rec('E-2 NODE_ENV=development 에서는 개발용 인증번호(devCode)가 응답에 있음', st < 300 and len(j.get('devCode', '')) == 6, (st, {k: v for k, v in (j or {}).items() if k != 'devCode'}))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_consult.json')
json.dump(R, open(out, 'w'), ensure_ascii=False, indent=1)
real = [r for r in R if not r.get('skip')]
print(f"통과 {sum(r['ok'] for r in real)} / {len(real)}" + (f" · 건너뜀 {len(R) - len(real)}" if len(R) > len(real) else ''))
