"""10/2 서버 기능 — 상담 신청(리드) 접수 · 배정 · 외부 대조 어댑터 (lead · D008 → D018).

  v10.11 — 올린 kit(v10.4.7) 흐름으로 바뀐 접수에 맞췄습니다: 로그인 없이 신청 → 휴대폰 확인 → 인증업체 1곳.
  A. 접수        GET /consult/categories · POST /consult/requests · POST /consult/requests/{id}/verify · GET /me/consult-requests
  B. 배분        확인 직후 fn_consult_deliver → fn_lead_assign(AUTO) — 1곳 · 공정 순환 · 후보 판정(fn_lead_candidates)
  C. 파트너       GET /partner/leads → POST /partner/leads/{id}/view(과금) → GET /partner/leads/{id}/contact
                 → POST /partner/fees/{id}/dispute (D003 반려 흐름 그대로)
  D. 운영         GET /admin/leads · GET /admin/leads/{id} · POST /admin/leads/{id}/assign|reassign|close · POST /admin/leads/run
  E. 탈락 조건     비활동 · 상담 축 입점 승인 없음 · 서비스 없음 · 자격 없음(GATED) · 미납 한도 · 지역 밖 · 상담 축 아님 · 신청자 본인 업체
  F. 배치         POST /admin/jobs/run {job:lead_assign} (X-Job-Token) — 만료 · 회수 · 빈자리 · 미배정
  G. DB 규칙      trg_lead_delivery_guard · 감시 뷰 0건
  H. 어댑터       계좌 1원 인증 · 중개사무소 대조 · 국세청 — 가짜 서버(srv_lead_mock.py)를 실제 HTTP 로
                 (어댑터 설정을 넣은 API 인스턴스 ADP 가 있어야 합니다. 없으면 H 는 건너뜀으로 기록)
  I. nts-recheck  scripts/nts-recheck.ts 를 자기 확인 DB(CHECK_DB)에 가짜 서버로

사용: API=http://localhost:3000 [ADP=http://localhost:3123] [MOCK=http://127.0.0.1:13023] python3 srv_lead.py
  · 가짜 서버:   python3 srv_lead_mock.py 13023
  · ADP 인스턴스: (. ./srv_lead_adp.env.sh; DATABASE_URL=… JWT_SECRET=… JOB_TOKEN=… ENC_KEY=… PORT=3123 node scripts/dev-server.js)
    — 어댑터 환경변수(BANK_VERIFY_* · BROKER_LOOKUP_* · NTS_*)만 다른 같은 코드입니다
  · I 절은 KIT(기본 /tmp/kit_lead) 에서 scripts/nts-recheck.ts 를 CHECK_DB 로 돌립니다
매 실행마다 새 계정 · 새 지역(시험도 리드xxxx)을 만들어 씁니다(재실행 안전). 공용 설정(site_settings)은 바꾸지 않습니다.
시험용으로 SQL 로 바꾸는 것: 파트너 상태 · 미납 한도 · 열람 기한 · 배정 기한(자기 시험 행만), 자격 심사 신청 행(제출 API 가 없음).
"""
import json, urllib.request, subprocess, uuid, sys, os, time
API = (os.environ.get('API') or (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3023')).rstrip('/').removesuffix('/api/v1')
ADP = (os.environ.get('ADP') or 'http://localhost:3123').rstrip('/').removesuffix('/api/v1')
MOCK = (os.environ.get('MOCK') or 'http://127.0.0.1:13023').rstrip('/')
KIT = os.environ.get('KIT') or '/tmp/kit_lead'
JOB_TOKEN = os.environ.get('JOB_TOKEN') or 'docker-test-job-token-0123456789abcdef'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'
CHECK_DB = os.environ.get('CHECK_DB') or 'postgresql://sgb:sgb@localhost:5432/sgb_lead_check'
R = []

def psql(s, db=DB):
    return subprocess.run(['psql', db, '-tAc', s], capture_output=True, text=True)
q = lambda s, db=DB: psql(s, db).stdout.strip().split('\n')[0]
qa = lambda s, db=DB: [x for x in psql(s, db).stdout.strip().split('\n') if x]

def call(m, p, tok=None, body=None, base=None, headers=None, timeout=30):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
    if tok: h['authorization'] = 'Bearer ' + tok
    h.update(headers or {})
    req = urllib.request.Request((base or API) + '/api/v1' + p, method=m,
        data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=timeout); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js

def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'skip': skip, 'detail': str(detail)[:240]})
    print('skip' if skip else ('ok  ' if ok else 'FAIL'), step, str(detail)[:150], file=sys.stderr)

def login(e, pw='sgb-dev-1234', base=None):
    return call('POST', '/auth/login', body={'email': e, 'password': pw}, base=base)[1]['accessToken']

ADM = login('admin@x.com')                   # SUPER
OPS = login('ops@t.local', 'sgb-test-1234')  # ADMIN
BUY = login('buyer@x.com')                   # MEMBER
tag = uuid.uuid4().hex[:6]
SIDO, GU = '시험도', f'리드{tag}'
CAT = {r.split('|')[0]: r.split('|')[1] for r in qa("select code||'|'||id from categories where axis='CONSULT' or code='MAL_APT'")}

def member(prefix, base=None):
    e = f'{prefix}_{tag}@t.local'
    call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': f'{prefix}시험', 'agreedTerms': []}, base=base)
    return e, login(e, 'sgb-test-1234', base)

def bizuser(prefix, company, bizno=None, base=None):
    e, T = member(prefix, base)
    call('POST', '/verifications/identity', T, {'provider': 'PASS'}, base=base)
    brn = bizno or (str(uuid.uuid4().int)[-8:] + '01')   # v10.31 — 끝 두 자리 01(가짜 국세청 「계속사업자」) — 아무 번호면 02 · 03(휴업 · 폐업)이 걸려 사업자 신청이 422 BIZ_CLOSED 로 막힐 때가 있음(w1 D04x)
    st, j = call('POST', '/businesses', T, {'bizRegNo': brn, 'companyName': f'{company}{tag}', 'ceoName': '김시험',
                                            'sido': '서울', 'sigungu': '금천구'}, base=base)
    bid = (j or {}).get('businessId') or q(f"select id from businesses where company_name='{company}{tag}'")
    call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    return {'email': e, 'tok': login(e, 'sgb-test-1234', base), 'bid': bid, 'company': f'{company}{tag}', 'apply': j, 'st': st}

def partner(prefix, company, cats, regions=((SIDO, GU),), approve=True, axis=True, cash=True):
    u = bizuser(prefix, company)
    st, j = call('POST', '/partner/apply', u['tok'])
    u['pid'] = (j or {}).get('id')
    call('POST', f"/admin/partners/{u['pid']}/approve", ADM)
    for c in cats:
        st, s = call('POST', '/partner/services', u['tok'], {'title': f'{company} {c} 상담', 'body': '시험 서비스 — 상담 축', 'categoryId': CAT[c]})
        if approve:
            call('POST', f"/admin/partners/services/{s['id']}/review", OPS, {'approve': True})
    call('POST', '/partner/regions', u['tok'], {'regions': [{'sido': a, 'sigungu': b} for a, b in regions]})
    u['account'] = q(f"select account_id from businesses where id='{u['bid']}'")
    if axis:   # D018 — 상담 축 입점: 업체가 신청하고 운영이 승인합니다(실제 API)
        s1, _ = call('POST', '/partner/axes', u['tok'], {'axes': ['CONSULT']})
        aid = q(f"select id from mal_partner_axes where business_id='{u['bid']}' and axis='CONSULT'")
        s2, _ = call('POST', f'/admin/partner-axes/{aid}/decide', OPS, {'approve': True})
        u['axis'] = (s1, s2)
    if cash:   # v10.31 (W5 · D070) — 리드 이용료 선불: 잔액이 있어야 후보가 됩니다. 시험 결제(스텁)로 충전
        st, c = call('POST', '/partner/cash/charges', u['tok'], {'amount': 100000})
        if st < 300:
            call('POST', '/partner/cash/charges/confirm', u['tok'], {'orderId': c['orderId'], 'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': 100000})
    return u

def rphone():
    return f'010-{str(uuid.uuid4().int)[-4:]}-{str(uuid.uuid4().int)[-4:]}'

def consult(T, code, memo=None, phone=None, verify=True, **kw):
    """상담 신청(로그인 없어도 됨) → 인증번호(개발 응답 devCode) 확인. 돌려주는 id 는 리드 번호(전달 안 되면 None)."""
    body = {'categoryCode': code, 'sido': SIDO, 'sigungu': GU, 'email': 'consult.test@example.com',
            'memo': memo or f'{code} 상담 부탁드립니다 — 시험 {tag} {uuid.uuid4().hex[:4]}',
            'name': '홍길동', 'phone': phone or rphone(), 'agree': True}
    body.update(kw)
    body = {k: v for k, v in body.items() if v is not None}
    st, j = call('POST', '/consult/requests', T, body)
    if st >= 300 or not verify:
        return st, j
    st2, v = call('POST', f"/consult/requests/{j['id']}/verify", T, {'code': j.get('devCode')})
    out = dict(v or {}); out['requestId'] = j['id']; out['id'] = (v or {}).get('leadId')
    return st2, out

def run_job(token=JOB_TOKEN):
    return call('POST', '/admin/jobs/run', None, {'job': 'lead_assign'}, headers={'x-job-token': token})

def deliveries(lid):
    return {r.split('|')[0]: r.split('|')[1:] for r in qa(
        f"select partner_id||'|'||state||'|'||assign_mode||'|'||id from lead_deliveries where lead_id='{lid}'")}

# ── 준비: 파트너 ────────────────────────────────────────────────────
print(f'== 준비 (지역 {SIDO} {GU}) ==', file=sys.stderr)
A = partner('lpa', 'A청소', ['CSL_CLEANING'])
B = partner('lpb', 'B청소', ['CSL_CLEANING'])
C = partner('lpc', 'C청소', ['CSL_CLEANING'])
D = partner('lpd', 'D청소', ['CSL_CLEANING'])
EX_INACT = partner('lpx1', '정지청소', ['CSL_CLEANING'])
EX_REGION = partner('lpx2', '타지역청소', ['CSL_CLEANING'], regions=((SIDO, f'다른{tag}'),))
EX_CASH = partner('lpx3', '잔액없음청소', ['CSL_CLEANING'], cash=False)   # v10.31 (W5) — 미납 한도 대신 선불 잔액 0
EX_SVC = partner('lpx4', '검수중청소', ['CSL_CLEANING'], approve=False)
EX_AXIS = partner('lpx5', '미입점청소', ['CSL_CLEANING'], axis=False)
QINS = partner('lpq', '자격보험', ['CSL_INSURANCE'])
NINS = partner('lpn', '무자격보험', ['CSL_INSURANCE'])
SELF = partner('lps', '본인웨딩', ['CSL_WEDDING'])
F = partner('lpf', 'F웨딩', ['CSL_WEDDING'])
out = psql(f"update partners set status='SUSPENDED', suspended_reason='시험 정지' where id='{EX_INACT['pid']}'")
# v10.31 (W5) — 전에는 미납 한도를 1,000원으로 낮춰 막았습니다. 이제 리드 이용료가 선불이라 잔액 0(충전 안 함)이 막는 조건입니다
# 보험 자격: 제출 API 가 없어 신청 행만 SQL, 조회 · 승인은 실제 운영 API
qid = q(f"insert into qualification_reviews(business_id, category_code, doc_no) values ('{QINS['bid']}','INSURANCE','INS-{tag}') returning id")
s1, _ = call('POST', f'/admin/qualifications/{qid}/lookup', OPS)
s2, _ = call('POST', f'/admin/qualifications/{qid}/decide', OPS, {'approve': True})
ALLP = (A, B, C, D, EX_INACT, EX_REGION, EX_CASH, EX_SVC, EX_AXIS, QINS, NINS, SELF, F)
rec('0-1 시험 파트너 13곳 준비 · 보험 자격 승인(운영 API)', all(p.get('pid') for p in ALLP)
    and s1 < 300 and s2 < 300 and q(f"select state from qualification_reviews where id='{qid}'") == 'APPROVED', (s1, s2, out.stderr[:80]))
rec('0-2 상담 축 입점 — 업체 신청 → 운영 승인(POST /partner/axes · /admin/partner-axes/{id}/decide) · 한 곳은 미입점',
    all(p['axis'][0] < 300 and p['axis'][1] < 300 for p in ALLP if 'axis' in p)
    and q(f"select count(*) from mal_partner_axes where business_id='{EX_AXIS['bid']}'") == '0'
    and q(f"select state||'|'||source from mal_partner_axes where business_id='{A['bid']}' and axis='CONSULT'") == 'APPROVED|APPLY', A.get('axis'))
CLEAN = {A['pid'], B['pid'], C['pid'], D['pid']}
byp = {p['pid']: p for p in ALLP}

# ── A. 접수 검증 (D018 — 로그인 없이 · 휴대폰 확인) ────────────────────
print('== A. 접수 ==', file=sys.stderr)
st, cats = call('GET', '/consult/categories')
cc = {c['code']: c for c in cats or []}
rec('A-1 상담 업종 22종 — 리드형 20 · 월 정액 노출형 2(법률 · 세무) · 받을 수 있는 인증업체 수', st == 200 and len(cats) == 22
    and sum(c['consultMode'] == 'LEAD' for c in cats) == 20 and {c['code'] for c in cats if c['consultMode'] == 'LISTING_FEE'} == {'CSL_LEGAL', 'CSL_TAX'}
    and all(c['status'] == 'APPROVED' and isinstance(c['partnerCount'], int) for c in cats) and cc['CSL_CLEANING']['partnerCount'] >= 4
    and 'CSL_CARD' not in cc and 'CSL_FINANCE' not in cc and cc['CSL_INSURANCE']['publishMode'] == 'GATED' and cc['CSL_CLEANING']['publishMode'] == 'OPEN',
    [(c['code'], c['partnerCount']) for c in cats or []][:6])
st, _ = call('GET', '/categories/consult')
rec('A-1b 예전 업종 API(GET /categories/consult)는 없어짐 → 404', st == 404, st)
REQ1_E, REQ1 = member('lrq1')
leads0 = int(q("select count(*) from leads"))
PHONE0 = rphone()
st, j0 = consult(None, 'CSL_CLEANING', phone=PHONE0, verify=False)
row0 = q(f"select state||'|'||(lead_id is null)||'|'||(contact_enc is not null)||'|'||(position('{PHONE0.replace('-', '')}' in encode(contact_enc,'escape'))=0)||'|'||(requester_account_id is null)||'|'||(verified_at is null) from consult_requests where id='{(j0 or {}).get('id')}'")
rec('A-2 비로그인 신청 가능 → PENDING_VERIFY · 인증번호(개발 응답) · 확인 전 리드 없음(INV-12) · 연락처는 암호문', st < 300 and j0['state'] == 'PENDING_VERIFY'
    and len(j0.get('devCode', '')) == 6 and row0 == 'PENDING_VERIFY|true|true|true|true|true' and int(q("select count(*) from leads")) == leads0, (st, j0, row0))
st, j = consult(None, 'CSL_CLEANING', agree=False)
rec('A-3 제3자 제공 동의 없음 → 422 CONSENT_REQUIRED', st == 422 and j['code'] == 'CONSENT_REQUIRED', (st, j))
st, j = consult(None, 'CSL_CLEANING', phone='12345')
rec('A-5 전화번호 형식 → 400 · 010 아닌 번호 → 422 PHONE_INVALID', st == 400 and consult(None, 'CSL_CLEANING', phone='02-1234-5678')[1].get('code') == 'PHONE_INVALID', (st, j))
st, j = consult(None, None, categoryId=CAT['MAL_APT'])
rec('A-6 상담 축이 아닌 업종(MAL_APT) → 422 CONSULT_AXIS (DB 게이트)', st == 422 and j['code'] == 'CONSULT_AXIS', (st, j))
st, j = consult(None, 'MAL_APT')
rec('A-7 업종 코드 형식(CSL_*) 밖 → 400', st == 400, (st, j))
st, j = consult(None, 'CSL_CARD')
st2, j2 = consult(None, 'CSL_LEGAL')
rec('A-8 보관 업종(카드) → 422 CONSULT_CLOSED · 정액 노출형(법률) → 422 CONSULT_DIRECTORY_ONLY (15자 넘는 코드도 사유가 그대로 감)',
    st == 422 and j['code'] == 'CONSULT_CLOSED' and st2 == 422 and j2['code'] == 'CONSULT_DIRECTORY_ONLY' and '직접 연락' in j2['message'], (st, j, st2, j2))
st, j = call('POST', f"/consult/requests/{j0['id']}/verify", None, {'code': '000000' if j0['devCode'] != '000000' else '111111'})
rec('A-10 틀린 인증번호 → 422 OTP_MISMATCH · 리드 없음', st == 422 and j['code'] == 'OTP_MISMATCH' and int(q("select count(*) from leads")) == leads0, (st, j))
st, j = call('POST', f"/consult/requests/{uuid.uuid4()}/verify", None, {'code': '123456'})
st2, j2 = call('POST', "/consult/requests/nope/verify", None, {'code': '123456'})
rec('A-11 없는 신청 확인 → 404 · 번호 형식 아님 → 400', st == 404 and st2 in (400, 404), (st, st2))
st, jl = consult(None, 'CSL_CLEANING', verify=False)
for i in range(5):
    call('POST', f"/consult/requests/{jl['id']}/verify", None, {'code': '000000' if jl['devCode'] != '000000' else '111111'})
st, j = call('POST', f"/consult/requests/{jl['id']}/verify", None, {'code': jl['devCode']})
rec('A-12 5회 틀리면 잠김 → 맞는 번호도 409 OTP_LOCKED · 리드 없음', st == 409 and j['code'] == 'OTP_LOCKED'
    and q(f"select lead_id is null from consult_requests where id='{jl['id']}'") == 't', (st, j))
st, j = consult(None, 'CSL_INTERIOR')
rec('A-13 자격 확인 업종에 자격 업체 없음(인테리어) → 확인해도 NO_PARTNER · 리드 없음', st < 300 and j['state'] == 'NO_PARTNER' and j['id'] is None
    and q(f"select state||'|'||(lead_id is null) from consult_requests where id='{j['requestId']}'") == 'NO_PARTNER|true', (st, j))

# ── B. 휴대폰 확인 → 인증업체 1곳 배분 · 공정 순환 ─────────────────────
print('== B. 배분 ==', file=sys.stderr)
PHONE1 = '010-' + str(uuid.uuid4().int)[-4:] + '-1111'
st, j = consult(REQ1, 'CSL_CLEANING', phone=PHONE1, memo=f'다음 달 32평 입주 청소 — 시험 {tag}')
L1 = (j or {}).get('id')
d1 = deliveries(L1) if L1 else {}
lrow = q(f"select assign_state||'|'||target_partners||'|'||source||'|'||(requester_account_id is not null)||'|'||summary from leads where id='{L1}'")
rec('B-1 확인 → 즉시 인증업체 1곳 배분 · ASSIGNED · 목표 1곳(INV-L1)', st < 300 and j['state'] == 'DELIVERED' and len(d1) == 1
    and lrow == f'ASSIGNED|1|WEB|true|다음 달 32평 입주 청소 — 시험 {tag}' and '1곳' in j['note'], (st, j, lrow))
rec('B-2 배분은 조건을 만족하는 4곳 중에서만 (탈락 업체 0)', set(d1) <= CLEAN, set(d1) - CLEAN)
rec('B-3 연락처는 pii 에 암호화 · leads 에 평문 없음 · 신청 표의 연락처는 지움', q(f"select (name_enc is not null and phone_enc is not null and consent_at is not null) from pii.lead_contacts where lead_id='{L1}'") == 't'
    and q(f"select count(*) from leads where id='{L1}' and (summary like '%{PHONE1[-4:]}%' or contact_enc is not null)") == '0'
    and q(f"select state||'|'||(contact_enc is null)||'|'||(verified_at is not null) from consult_requests where id='{j['requestId']}'") == 'DELIVERED|true|true')
rec('B-4 열람 기한 · 배정 방식 AUTO', q(f"select count(*) from lead_deliveries where lead_id='{L1}' and assign_mode='AUTO' and expires_at > now() + interval '23 hours'") == '1')
st, jj = call('POST', f"/consult/requests/{j['requestId']}/verify", None, {'code': '000000'})
rec('B-4b 이미 전달된 신청을 다시 확인해도 같은 리드 · 중복 배분 없음', st < 300 and jj['state'] == 'DELIVERED' and jj['leadId'] == L1 and len(deliveries(L1)) == 1, (st, jj))
st, j = consult(REQ1, 'CSL_CLEANING', phone=PHONE1, verify=False)
rec('B-5 같은 번호 · 같은 업종 24시간 안 재신청 → 409 DUPLICATE_REQUEST', st == 409 and j['code'] == 'DUPLICATE_REQUEST', (st, j))
REQ2_E, REQ2 = member('lrq2')
st, j = consult(REQ2, 'CSL_CLEANING')
L2 = (j or {}).get('id'); d2 = deliveries(L2) if L2 else {}
rec('B-6 공정 순환 — 둘째 신청은 첫 신청과 다른 업체로', st < 300 and len(d2) == 1 and set(d2) <= CLEAN and not (set(d2) & set(d1)), (set(d1), set(d2)))
PHONE_M = rphone()
st, j = consult(None, 'CSL_CLEANING', memo=f'연락은 {PHONE_M} 으로 주세요 — 시험 {tag}')
LM = (j or {}).get('id'); dm = deliveries(LM) if LM else {}
rec('B-6b 메모에 연락처가 있으면 요약으로 쓰지 않음(열람 전 무료 노출) · 비로그인 신청은 신청자 없음 · 셋째도 다른 업체',
    st < 300 and q(f"select summary||'|'||(requester_account_id is null) from leads where id='{LM}'") == '청소 상담 신청|true'
    and q(f"select memo_enc is not null from pii.lead_contacts where lead_id='{LM}'") == 't' and not (set(dm) & (set(d1) | set(d2))), (st, j, set(dm)))
st, det = call('GET', f'/admin/leads/{L2}', OPS)
cand = {c['partnerId']: c for c in (det or {}).get('candidates', [])}
rec('B-7 후보 순번 점수 = 최근 30일 수신 ÷ 등급 가중치', all(abs(float(c['score']) - c['recent30d'] / float(c['weight'])) < 1e-3 for c in cand.values()), [(c['company'], c['recent30d'], c['weight'], c['score']) for c in cand.values()][:5])
p1 = byp[next(iter(d1))]
notif = q(f"select count(*) from notifications where account_id='{p1['account']}' and event_code='LEAD_DELIVERED'")
rec('B-8 배분된 파트너에게 알림(LEAD_DELIVERED)', int(notif) >= 1, notif)

# ── E. 탈락 조건 ──────────────────────────────────────────────────
print('== E. 탈락 조건 ==', file=sys.stderr)
st, det = call('GET', f'/admin/leads/{L1}', OPS)
cand = {c['partnerId']: c for c in det['candidates']}
why = lambda p: ' · '.join(cand.get(p['pid'], {}).get('reasons') or [])
got = set(d1) | set(d2) | set(dm)
rec('E-1 비활동(SUSPENDED) 업체 제외 · 사유', 'SUSPENDED' in why(EX_INACT) and EX_INACT['pid'] not in got, why(EX_INACT))
rec('E-2 지역 밖 업체 제외 · 사유', '활동 지역 밖' in why(EX_REGION) and EX_REGION['pid'] not in got, why(EX_REGION))
rec('E-3 리드 이용료 잔액 부족 업체 제외 · 사유(선불 · W5)', '리드 이용료 잔액 부족' in why(EX_CASH) and EX_CASH['pid'] not in got, why(EX_CASH))
rec('E-4 서비스 미승인(검수 중) 업체 제외 · 사유', '승인된 서비스 없음' in why(EX_SVC) and EX_SVC['pid'] not in got, why(EX_SVC))
rec('E-4b 상담 축 입점 승인 없는 업체 제외 · 사유(D018)', '상담 축 입점 승인 없음' in why(EX_AXIS) and EX_AXIS['pid'] not in got, why(EX_AXIS))
rec('E-5 이미 배정한 업체는 "이미 배정함"', all('이미 배정함' in (cand[p]['reasons'] or []) for p in d1), [cand[p]['reasons'] for p in d1])
st, j = consult(REQ2, 'CSL_INSURANCE')
LI = (j or {}).get('id'); di = deliveries(LI) if LI else {}
st2, det = call('GET', f'/admin/leads/{LI}', OPS)
ci = {c['partnerId']: c for c in det['candidates']}
rec('E-6 GATED(보험) — 자격 승인 업체에만 · 무자격 업체 제외', st < 300 and QINS['pid'] in di and NINS['pid'] not in di
    and '자격 심사 미통과' in (ci.get(NINS['pid'], {}).get('reasons') or []), (j, ci.get(NINS['pid'], {}).get('reasons')))
st, j = consult(SELF['tok'], 'CSL_WEDDING')
LS = (j or {}).get('id'); ds = deliveries(LS) if LS else {}
st2, det = call('GET', f'/admin/leads/{LS}', OPS)
cs = {c['partnerId']: c for c in det['candidates']}
rec('E-7 신청자 본인 업체에는 보내지 않음(로그인한 채 신청)', st < 300 and SELF['pid'] not in ds and F['pid'] in ds
    and '신청자 본인 업체' in (cs.get(SELF['pid'], {}).get('reasons') or []), (j, cs.get(SELF['pid'], {}).get('reasons')))

# ── C. 파트너 — 열람 · 과금 · 연락처 · 반려 ──────────────────────────
print('== C. 파트너 ==', file=sys.stderr)
pa = p1
pb = next(p for p in (A, B, C, D) if p['pid'] not in d1)
st, leads = call('GET', '/partner/leads', pa['tok'])
mine = next((x for x in leads if x['leadId'] == L1), None)
rec('C-1 파트너 리드 목록에 배정 건(업종 · 기한 · 미열람 · 연락처 없음)', st == 200 and mine and mine['categoryName'] == '청소' and mine['state'] == 'DELIVERED'
    and mine['expiresAt'] and mine['viewedAt'] is None and mine['contact'] is None and mine['hasContact'] is True, mine)
did = mine['deliveryId']
st, j = call('GET', f'/partner/leads/{did}/contact', pa['tok'])
rec('C-2 열람 전 연락처 → 422 NOT_VIEWED', st == 422 and j['code'] == 'NOT_VIEWED', (st, j))
logs0 = int(q(f"select count(*) from audit.pii_access_logs where lead_id='{L1}'"))
st, v = call('POST', f'/partner/leads/{did}/view', pa['tok'])
rec('C-3 열람 → 이용료 3,000(lead.default_fee) · 상태 VIEWED · 응답에 연락처 없음', st < 300 and v['fee'] == 3000 and 'phone' not in json.dumps(v)
    and q(f"select state from lead_deliveries where id='{did}'") == 'VIEWED' and q(f"select amount::int from lead_fees where delivery_id='{did}'") == '3000', (st, v))
st, c = call('GET', f'/partner/leads/{did}/contact', pa['tok'])
rec('C-4 열람 후 연락처 — 이름 · 번호 복호화', st == 200 and c['contact']['name'] == '홍길동' and c['contact']['phone'] == PHONE1.replace('-', ''), (st, c))
rec('C-5 연락처 조회는 pii_access_logs 에 남음 · 감사 로그(audit_logs)에 평문 없음',
    int(q(f"select count(*) from audit.pii_access_logs where lead_id='{L1}' and access_type='VIEW'")) == logs0 + 1
    and q(f"select count(*) from audit.audit_logs where after_data::text like '%{PHONE1.replace('-', '')}%'") == '0')
st, j = call('GET', f'/partner/leads/{did}/contact', pb['tok'])
rec('C-6 남의 배정 연락처 → 409', st == 409, (st, j))
st, v2 = call('POST', f'/partner/leads/{did}/view', pa['tok'])
rec('C-7 재열람 → 이용료 한 번만', st < 300 and q(f"select count(*) from lead_fees where delivery_id='{did}'") == '1', (st, v2))
st, fees = call('GET', '/partner/fees', pa['tok'])
fee = next(r for r in fees['rows'] if r['summary'].endswith(tag))
st, j = call('POST', f"/partner/fees/{fee['id']}/dispute", pa['tok'], {'reasonCode': 'UNREACHABLE', 'reason': '안내된 번호로 3회 통화했으나 결번 안내', 'evidence': '통화 기록 캡처'})
rec('C-8 반려 신청 (D003 흐름) → REQUESTED', st < 300 and j.get('state') == 'REQUESTED' and fee['disputable'], (st, j))
st, j2 = call('POST', f"/admin/partners/fees/void-requests/{j['id']}/accept", OPS, {'ruleCode': 'RSK-02', 'note': '결번 확인'})
rec('C-9 반려 인정 → 이용료 VOIDED', st < 300 and q(f"select state from lead_fees where id={fee['id']}") == 'VOIDED', (st, j2))
st, my = call('GET', '/me/consult-requests', REQ1)
m1 = next((x for x in my if x['id'] == L1), {})
rec('C-10 신청자 화면(로그인한 채 신청): 보낸 곳 1곳 · 연락처를 받아 간 업체(제3자 제공 내역)', st == 200 and m1.get('sentTo') == 1 and [x['company'] for x in m1.get('providedTo', [])] == [pa['company']], m1)
st, _ = call('GET', '/me/consult-requests')
rec('C-10b 「내 상담 신청」은 로그인 필요 → 403', st == 403, st)

# ── D. 운영 — 대기열 · 수동 배정 · 재배정 · 종료 ─────────────────────
print('== D. 운영 ==', file=sys.stderr)
st, _ = call('GET', '/admin/leads', BUY)
rec('D-1 일반 회원 → 403', st == 403, st)
st, j = call('GET', '/admin/leads?state=NOPE', OPS)
rec('D-2 잘못된 state → 422', st == 422, st)
st, lst = call('GET', '/admin/leads?state=ALL', OPS)
row = next((x for x in lst['items'] if x['id'] == L1), None)
rec('D-3 대기열(ALL) — 상태 · 배정 현황 · 보낼 수 있는 업체 수 · 설정(목표 1 · 최대 1)', st == 200 and row and row['assignState'] == 'ASSIGNED' and row['active'] == 1
    and row['viewed'] == 1 and row['eligibleCount'] == 3 and len(row['deliveries']) == 1 and lst['settings']['target'] == 1 and lst['settings']['maxPartners'] == 1,
    row and ({k: row[k] for k in ('assignState', 'active', 'viewed', 'eligibleCount')}, lst['settings']))
st, _ = call('GET', f'/admin/leads/{uuid.uuid4()}', OPS)
rec('D-4 없는 신청 → 404', st == 404, st)
st, j = call('POST', f'/admin/leads/{L1}/assign', BUY, {'partnerIds': [pb['pid']]})
rec('D-5 일반 회원 수동 배정 → 403', st == 403, st)
st, j = call('POST', f'/admin/leads/{L1}/assign', OPS, {'partnerIds': ['nope']})
rec('D-6 partnerIds 형식 → 400', st == 400, (st, j))
st, j = call('POST', f'/admin/leads/{L1}/assign', OPS, {'partnerIds': [pb['pid']]})
rec('D-7 이미 1곳이 받은 신청에 다른 업체 수동 배정 → 422 LEAD_ASSIGN (최대 1곳 — 1리드 = 1업체)', st == 422 and j['code'] == 'LEAD_ASSIGN' and '최대 1곳' in j['message']
    and len(deliveries(L1)) == 1, (st, j))
st, j = call('POST', f'/admin/leads/{L1}/assign', OPS, {'partnerIds': [pa['pid']]})
rec('D-8 이미 배정한 업체 → 422', st == 422, (st, j))
st, j = call('POST', f'/admin/leads/{L1}/assign', ADM, {})
rec('D-11 목표 수 이상 배정된 신청에 자동 고르기 → 422', st == 422, (st, j))
viewed_did = did
st, j = call('POST', f'/admin/leads/{L1}/reassign', OPS, {'deliveryIds': [viewed_did], 'reason': '시험'})
rec('D-12 열람한 배정 회수 → 409 ALREADY_VIEWED', st == 409 and j['code'] == 'ALREADY_VIEWED', (st, j))
p2 = byp[next(iter(d2))]
st, j = call('POST', f'/admin/leads/{L2}/reassign', OPS, {'deliveryIds': [d2[p2['pid']][2]]})
rec('D-13 사유 없는 재배정 → 400', st == 400, (st, j))
G = partner('lpg', 'G청소', ['CSL_CLEANING'])
st, j = call('POST', f'/admin/leads/{L2}/reassign', OPS, {'deliveryIds': [d2[p2['pid']][2]], 'reason': '업체 휴무로 연락 불가 — 다른 업체로', 'partnerIds': [G['pid']]})
dd = deliveries(L2)
rec('D-14 재배정 — 안 연 배정 회수(REVOKED) · 새 업체 1곳(REASSIGN) · 같은 때에 받은 곳은 1곳', st < 300 and dd[p2['pid']][0] == 'REVOKED' and dd[G['pid']][:2] == ['DELIVERED', 'REASSIGN']
    and q(f"select count(*) from lead_deliveries where lead_id='{L2}' and state in ('DELIVERED','VIEWED')") == '1', (st, j))
rec('D-15 회수된 업체에 사유 알림 · 목록에서 빠짐', q(f"select count(*) from notifications where account_id='{p2['account']}' and event_code='LEAD_REVOKED'") == '1'
    and not any(x['leadId'] == L2 for x in call('GET', '/partner/leads', p2['tok'])[1]))
psql(f"update partners set grade='PLATINUM' where id='{G['pid']}'")
st, det = call('GET', f'/admin/leads/{L1}', OPS)
cg = next((c for c in det['candidates'] if c['partnerId'] == G['pid']), {})
rec('B-9 등급 가중치 — PLATINUM 은 가중치 2 · 같은 수신이면 점수 절반(먼저 받음)', float(cg.get('weight', 0)) == 2.0
    and abs(float(cg['score']) - cg['recent30d'] / 2) < 1e-3 and cg['recent30d'] >= 1, cg)
st, j = call('POST', f"/partner/leads/{dd[p2['pid']][2]}/view", p2['tok'])
rec('D-16 회수된 배정 열람 → 422 LEAD_DELIVERY (트리거)', st == 422 and j['code'] == 'LEAD_DELIVERY', (st, j))
REQ3_E, REQ3 = member('lrq3')
st, j = consult(REQ3, 'CSL_CLEANING')
L3 = j['id']
st, j = call('POST', f'/admin/leads/{L3}/close', OPS, {'reason': '  '})
rec('D-17 공백 사유 종료 → 422', st == 422, (st, j))
st, j = call('POST', f'/admin/leads/{L3}/close', OPS, {'reason': '장난 신청 — 결번 확인'})
rec('D-18 종료 → CLOSED · 안 연 배정 전부 회수', st < 300 and j['revoked'] >= 1 and q(f"select assign_state from leads where id='{L3}'") == 'CLOSED'
    and q(f"select count(*) from lead_deliveries where lead_id='{L3}' and state<>'REVOKED'") == '0', (st, j))
st, j = call('POST', f'/admin/leads/{L3}/close', OPS, {'reason': '다시'})
rec('D-19 다시 종료 → 409', st == 409, st)
st, j = call('POST', f'/admin/leads/{L3}/assign', ADM, {})
rec('D-20 종료된 신청 배정 → 422', st == 422 and '종료' in j['message'], (st, j))

# ── F. 받을 업체 없음 · 배치 ─────────────────────────────────────────
print('== F. 배치 ==', file=sys.stderr)
REQ4_E, REQ4 = member('lrq4')
leads1 = int(q("select count(*) from leads"))
st, j = consult(REQ4, 'CSL_USEDCAR')
RW = j['requestId']
rec('F-1 받을 업체 없음 → NO_PARTNER · 리드를 만들지 않음 · 연락처는 신청 표에만(다른 곳에 넘기지 않음)', st < 300 and j['state'] == 'NO_PARTNER' and j['id'] is None
    and int(q("select count(*) from leads")) == leads1 and '넘기지 않습니다' in j['note']
    and q(f"select state||'|'||(lead_id is null)||'|'||(contact_enc is not null) from consult_requests where id='{RW}'") == 'NO_PARTNER|true|true', (st, j))
st, my = call('GET', '/me/consult-requests', REQ4)
rec('C-11 받을 업체가 없던 신청도 「내 상담 신청」에 NO_PARTNER 로 보임', st == 200 and any(x['id'] == RW and x['assignState'] == 'NO_PARTNER' and x['sentTo'] == 0 for x in my), my[:1])
st, j = run_job('x' * 40)
rec('F-2 잘못된 작업 토큰 → 403', st == 403, st)
H1 = partner('lph1', 'H중고차', ['CSL_USEDCAR'])
H2 = partner('lph2', 'I중고차', ['CSL_USEDCAR'])
st, j = call('POST', f'/consult/requests/{RW}/verify', None, {'code': '000000'})
LW = (j or {}).get('leadId'); dw = deliveries(LW) if LW else {}
rec('F-3 업체가 생긴 뒤 같은 신청을 다시 확인 → 그때 1곳에 전달(DELIVERED)', st < 300 and j['state'] == 'DELIVERED' and len(dw) == 1 and set(dw) <= {H1['pid'], H2['pid']}, (st, j))
hx = H1 if H1['pid'] in dw else H2
hy = H2 if hx is H1 else H1
psql(f"update lead_deliveries set expires_at = now() - interval '1 minute' where lead_id='{LW}' and partner_id='{hx['pid']}'")
lh = next(x for x in call('GET', '/partner/leads', hx['tok'])[1] if x['leadId'] == LW)
st, j = call('POST', f"/partner/leads/{lh['deliveryId']}/view", hx['tok'])
rec('F-5 열람 기한 지난 배정 열람 → 422 LEAD_DELIVERY (배치 전에도)', st == 422 and j['code'] == 'LEAD_DELIVERY' and q(f"select count(*) from lead_fees where delivery_id='{lh['deliveryId']}'") == '0', (st, j))
st, j = run_job()
dw = deliveries(LW); det = (j or {}).get('detail') or {}
rec('F-3b 배치(lead_assign) — 기한 지난 배정 EXPIRED · 다른 1곳으로 넘김 · 같은 때 받은 곳은 1곳', st < 300 and j['job'] == 'lead_assign' and dw[hx['pid']][0] == 'EXPIRED'
    and dw.get(hy['pid'], [''])[0] == 'DELIVERED' and det.get('expired', 0) >= 1
    and q(f"select count(*) from lead_deliveries where lead_id='{LW}' and state in ('DELIVERED','VIEWED')") == '1', (dw, det))
st, j = run_job()
rec('F-4 다시 돌려도 중복 배정 없음(멱등)', len(deliveries(LW)) == 2, j and j.get('detail'))
H3 = partner('lph3', 'J중고차', ['CSL_USEDCAR'])
psql(f"update partners set status='SUSPENDED', suspended_reason='시험 정지' where id='{hy['pid']}'")
st, j = run_job()
dw = deliveries(LW)
det = (j or {}).get('detail') or {}
rec('F-6 배치 — 정지 업체의 안 연 배정 REVOKED · 빈자리를 새 업체 1곳에', dw[hy['pid']][0] == 'REVOKED'
    and dw.get(H3['pid'], [''])[0] == 'DELIVERED' and det.get('revoked', 0) >= 1, (dw, det))
st, j = call('POST', f"/partner/leads/{lh['deliveryId']}/view", hx['tok'])
rec('F-7 만료된 배정 열람 → 422', st == 422, st)
rec('F-7b 여러 번 넘어가도 상담 리드를 같은 때에 두 곳이 받은 적 없음(v_lead_multi_delivery)', q("select count(*) from v_lead_multi_delivery") == '0')
K0 = partner('lpk0', 'K0렌탈', ['CSL_RENTAL'])
REQ5_E, REQ5 = member('lrq5')
st, j = consult(REQ5, 'CSL_RENTAL')
LU = j['id']
psql(f"update partners set status='SUSPENDED', suspended_reason='시험 정지' where id='{K0['pid']}'")
call('POST', '/admin/leads/run', OPS)
psql(f"update leads set assign_deadline = now() - interval '1 minute' where id in ('{LU}','{LW}')")
st, j = call('POST', '/admin/leads/run', OPS)
rec('F-8 기한 지난 신청 — 받은 곳 있으면 ASSIGNED · 없으면 UNMATCHED (운영 실행 API)', st < 300 and q(f"select assign_state from leads where id='{LW}'") == 'ASSIGNED'
    and q(f"select assign_state from leads where id='{LU}'") == 'UNMATCHED' and j['unmatched'] >= 1, (st, j))
K1 = partner('lpk1', 'K1렌탈', ['CSL_RENTAL'])
REQ6_E, REQ6 = member('lrq6')
st, j = consult(REQ6, 'CSL_RENTAL')
psql(f"update partners set status='SUSPENDED', suspended_reason='시험 정지' where id='{K1['pid']}'")
psql(f"update leads set assign_deadline = now() - interval '1 minute' where id='{j['id']}'")
st, j = run_job()
rec('F-10 배치가 미배정 전환 → 경보 LEAD_UNMATCHED', st < 300 and (j['detail'] or {}).get('unmatched', 0) >= 1
    and q("select count(*) from ops_alerts where alert_code='LEAD_UNMATCHED' and raised_at > now() - interval '2 minutes'") != '0', j and j.get('detail'))
st, lst = call('GET', '/admin/leads', OPS)
rec('D-21 기본 대기열(QUEUE) = OPEN · UNMATCHED 만, 미배정 먼저', st == 200 and all(x['assignState'] in ('OPEN', 'UNMATCHED') for x in lst['items'])
    and any(x['id'] == LU for x in lst['items']) and (not lst['items'] or lst['items'][0]['assignState'] == 'UNMATCHED'), lst['counts'])
st, j = call('POST', f'/admin/leads/{LU}/assign', OPS, {})
rec('D-22 미배정 건 — 후보 없으면 수동 배정도 422 NO_CANDIDATE', st == 422 and j['code'] == 'NO_CANDIDATE', (st, j))
KR = partner('lpkr', '타지역렌탈', ['CSL_RENTAL'], regions=((SIDO, f'다른{tag}'),))
KA = partner('lpka', '미입점렌탈', ['CSL_RENTAL'], axis=False)
st, j = call('POST', f'/admin/leads/{LU}/assign', OPS, {'partnerIds': [KR['pid']]})
rec('D-9a 조건 밖 업체(지역) 수동 배정 → 422 LEAD_ASSIGN · 사유', st == 422 and j['code'] == 'LEAD_ASSIGN' and '활동 지역 밖' in j['message'], (st, j))
st, j = call('POST', f'/admin/leads/{LU}/assign', OPS, {'partnerIds': [KA['pid']]})
rec('D-9b 상담 축 입점 승인 없는 업체 수동 배정 → 422 LEAD_ASSIGN · 사유', st == 422 and j['code'] == 'LEAD_ASSIGN' and '상담 축 입점 승인 없음' in j['message'], (st, j))
st, j = call('POST', f'/admin/leads/{LU}/assign', OPS, {'partnerIds': [NINS['pid']]})
rec('D-9c 그 업종 서비스 없는 업체 → 422', st == 422 and j['code'] == 'LEAD_ASSIGN', (st, j))
K = partner('lpk', 'K렌탈', ['CSL_RENTAL'])
st, j = call('POST', f'/admin/leads/{LU}/assign', OPS, {'partnerIds': [K['pid']]})
rec('D-10 · D-23 업체가 생긴 뒤 수동 배정(ADMIN) → MANUAL · 배정자 기록 · 미배정이 ASSIGNED 로', st < 300 and len(j['assigned']) == 1
    and q(f"select assign_mode||'|'||(assigned_by is not null) from lead_deliveries where lead_id='{LU}' and partner_id='{K['pid']}'") == 'MANUAL|true'
    and q(f"select assign_state from leads where id='{LU}'") == 'ASSIGNED', (st, j))
PH9 = rphone(); codes = []
for i in range(6):
    st, j = consult(None, 'CSL_RENTAL', phone=PH9, verify=False)
    codes.append(st if st < 300 else j['code'])
rec('A-9 같은 번호 하루 신청 한도(lead.intake.daily_limit=5) → 6번째 422', all(isinstance(c, int) for c in codes[:5]) and codes[5] == 'TOO_MANY_REQUESTS', codes)

# ── G. DB 규칙 · 감시 뷰 ─────────────────────────────────────────────
print('== G. DB ==', file=sys.stderr)
def blocked(sql, word):
    o = psql(f"BEGIN; {sql}; ROLLBACK;")
    return word in o.stderr, o.stderr.strip()[:140]
ok, e = blocked(f"insert into lead_deliveries(lead_id, partner_id) values ('{L2}','{EX_INACT['pid']}')", 'LEAD_ASSIGN')
rec('G-1 비활동 파트너에게 직접 배정 → 트리거 거부', ok, e)
ok, e = blocked(f"insert into lead_deliveries(lead_id, partner_id) values ('{LI}','{NINS['pid']}')", 'LEAD_GATED')
rec('G-2 자격 없는 업체에 GATED 리드 직접 배정 → 트리거 거부', ok, e)
ok, e = blocked(f"insert into lead_deliveries(lead_id, partner_id) values ('{L2}','{QINS['pid']}')", 'LEAD_ASSIGN')
rec('G-3 그 업종 승인 서비스 없는 업체에 직접 배정 → 트리거 거부', ok, e)
ok, e = blocked(f"insert into lead_deliveries(lead_id, partner_id) values ('{L1}','{pb['pid']}')", 'LEAD_ASSIGN')
rec('G-4 한 신청 최대 업체 수(1) 초과 → 트리거 거부', ok and '최대 1곳' in e, e)
ok, e = blocked(f"insert into lead_deliveries(lead_id, partner_id) values ('{L3}','{EX_AXIS['pid']}')", 'LEAD_')
rec('G-4b 상담 축 입점 승인 없는 업체에 직접 배정 → 트리거 거부', ok, e)
ok, e = blocked(f"update leads set assign_state='OPEN', closed_at=null, close_reason=null where id='{L3}'; insert into lead_deliveries(lead_id, partner_id) values ('{L3}','{EX_AXIS['pid']}')", 'LEAD_PARTNER_AXIS')
rec('G-4c 사유가 입점 승인(LEAD_PARTNER_AXIS)', ok, e)
ok, e = blocked(f"update lead_deliveries set state='REVOKED', end_reason='x' where id='{did}'", 'LEAD_DELIVERY')
rec('G-5 열람한 배정 회수(직접 UPDATE) → 거부', ok, e)
ok, e = blocked(f"update lead_deliveries set state='DELIVERED' where lead_id='{LW}' and partner_id='{hx['pid']}'", 'LEAD_DELIVERY')
rec('G-6 만료된 배정 되살리기 → 거부', ok, e)
ok, e = blocked(f"update lead_deliveries set viewed_at = now() - interval '1 day' where id='{did}'", 'LEAD_DELIVERY')
rec('G-7 열람 시각 고치기 → 거부', ok, e)
ok, e = blocked(f"insert into lead_deliveries(lead_id, partner_id) values ('{L1}','{pa['pid']}')", 'LEAD_ASSIGN')
rec('G-8 같은 업체 중복 배정 → 거부(최대 1곳 · UNIQUE)', ok or 'duplicate key' in e, e)
ok, e = blocked(f"insert into leads(category_id, sido, sigungu, summary) values ('{CAT['MAL_APT']}','서울','금천구','시험')", 'LEAD_AXIS')
rec('G-9 상담 축 밖 업종 리드 → 거부(LEAD_AXIS)', ok, e)
ok, e = blocked(f"insert into leads(category_id, sido, sigungu, summary) values ('{CAT['CSL_CLEANING']}','서울','금천구','연락 010-9999-8888')", 'ck_leads_summary_no_phone')
rec('G-10 요약에 연락처 → CHECK 거부', ok, e)
ok, e = blocked(f"insert into leads(category_id, sido, sigungu, summary) values ('{CAT['CSL_LEGAL']}','서울','금천구','시험')", 'LEAD_DIRECTORY_ONLY')
ok2, e2 = blocked(f"insert into leads(category_id, sido, sigungu, summary) values ('{CAT['CSL_CARD']}','서울','금천구','시험')", 'LEAD_CATEGORY_CLOSED')
rec('G-11 정액 노출형(법률) 리드 → LEAD_DIRECTORY_ONLY · 보관 업종(카드) 리드 → LEAD_CATEGORY_CLOSED', ok and ok2, (e, e2))
ok, e = blocked(f"select * from fn_consult_deliver('{j0['id']}')", 'CONSULT_UNVERIFIED')
rec('G-12 확인 전 신청을 DB 함수로 직접 배분 → CONSULT_UNVERIFIED', ok, e)
ok, e = blocked(f"set local session_replication_role=replica; update qualification_reviews set state='REJECTED' where id='{qid}'; set local session_replication_role=origin; "
                f"update lead_deliveries set viewed_at=now() where lead_id='{LI}' and partner_id='{QINS['pid']}'", 'LEAD_GATED')
rec('G-13 배정 뒤 자격이 풀린 업체의 열람 → 거부(LEAD_GATED — 열람할 때 자격을 다시 봄)', ok, e)
rec('G-14 자격 확인 업종 전환 시각(mode_since) — 이사짐 · 자동차는 D016 적용 시각, 옛 규칙(보험)은 -infinity',
    q("select (select mode_since = '-infinity' from restricted_industries where gwan_code='MAL' and code='CSL_INSURANCE')::text||'|'||"
      "(select mode_since > '2026-01-01' from restricted_industries where gwan_code='MAL' and code='CSL_MOVING')::text") == 'true|true')
for v in ('v_lead_delivery_gated_leak', 'v_lead_delivery_overcap', 'v_lead_delivery_state_mismatch',
          'v_lead_contact_unlogged', 'v_lead_axis_leak', 'v_lead_restricted_leak', 'v_lead_assign_stuck',
          'v_consult_lead_unverified', 'v_lead_multi_delivery', 'v_directory_lead_leak', 'v_consult_purge_overdue'):
    n = q(f"select count(*) from {v}")
    rec(f'G-V {v} = 0', n == '0', n)

# ── H. 어댑터 (가짜 서버 · 실제 HTTP) ────────────────────────────────
print('== H. 어댑터 ==', file=sys.stderr)
try:
    adp_up = call('GET', '/consult/categories', base=ADP, timeout=5)[0] == 200
    mock_up = urllib.request.urlopen(MOCK + '/_log', timeout=3).status == 200
except Exception:
    adp_up = mock_up = False
if not (adp_up and mock_up):
    rec('H 어댑터 시험 — ADP · MOCK 이 떠 있지 않아 건너뜀', True, f'ADP={ADP} MOCK={MOCK}', skip=True)
else:
    mlog = lambda: json.loads(urllib.request.urlopen(MOCK + '/_log', timeout=3).read())
    # H-1 계좌 1원 인증
    ue, UT = member('lbank', base=ADP)
    acct = lambda tail: '1002' + str(uuid.uuid4().int)[-4:] + tail
    t0 = time.time(); st, j = call('POST', '/me/payout-accounts', UT, {'bankCode': '004', 'bankName': '국민', 'accountNo': acct('1234'), 'holderName': 'lbank시험'}, base=ADP)
    last = mlog()[-1]
    rec('H-1 1원 송금 — 실제 HTTP · 지도대로 중첩 본문 · 인증 헤더 · stub:false', st < 300 and j['stub'] is False and last['path'] == '/bank/v1/one-won'
        and last['auth'] == 'KEY bank-test-key' and last['body']['data']['bank_cd'] == '004' and last['body']['data']['acct_no'].endswith('1234'), (st, j, last.get('body')))
    pid_ = j.get('id')
    st, j = call('POST', f'/me/payout-accounts/{pid_}/verify', UT, {'code': '0000'}, base=ADP)
    rec('H-2 틀린 코드 → 422 CODE_MISMATCH (서버 저장 코드와 대조)', st == 422 and j['code'] == 'CODE_MISMATCH', (st, j))
    st, j = call('POST', f'/me/payout-accounts/{pid_}/verify', UT, {'code': '4821'}, base=ADP)
    rec('H-3 업체가 준 코드(4821) → 인증 · stub:false', st < 300 and j['verified'] is True and j['stub'] is False, (st, j))
    for tail, want, label in (('0000', '시험 문구', '업체 거절(rsp_code E101) → 오류 코드 문구 지도'),
                              ('4000', '기관: bank code mismatch', 'HTTP 400 → 계좌 확인 + 기관 메시지'),
                              ('5000', '장애', 'HTTP 503 → 기관 장애'),
                              ('7777', '예금주명', '응답 예금주 다름 → 거부'),
                              ('9999', '늦습니다', '응답 지연(1초 제한) → 시간 초과')):
        t0 = time.time()
        st, j = call('POST', '/me/payout-accounts', UT, {'bankCode': '004', 'bankName': '국민', 'accountNo': acct(tail), 'holderName': 'lbank시험'}, base=ADP)
        el = time.time() - t0
        rec(f'H-4 1원 송금 실패 — {label} → 422 BANK_SEND_FAILED', st == 422 and j['code'] == 'BANK_SEND_FAILED' and want in j['message']
            and (tail != '9999' or el < 2.8), (st, j and j.get('message'), round(el, 2)))
    rec('H-5 키가 응답 · 감사 로그에 없음', q("select count(*) from audit.audit_logs where after_data::text like '%bank-test-key%'") == '0')
    st, j = call('POST', '/me/payout-accounts', UT, {'bankCode': '004', 'bankName': '국민', 'accountNo': acct('1234'), 'holderName': 'lbank시험'})
    rec('H-6 키 없는 인스턴스(API)는 그대로 스텁 · stub:true', st < 300 and j['stub'] is True, (st, j))
    # H-7 중개사무소 대조
    cases = [('11545-2026-10001', '가산공인중개사사무소', '김시험', 'MATCH', ''),
             ('11545-2026-10002', '엉뚱한공인중개사', '이시험', 'MISMATCH', '사무소명 불일치'),
             ('11545-2026-10003', '휴업공인중개사사무소', '박시험', 'MISMATCH', '영업 상태 아님'),
             ('11545-2026-55555', '없는사무소', '최시험', 'NOT_FOUND', '조회되지 않습니다'),
             ('11545-2026-99998', '지연사무소', '최시험', None, '늦어'),
             ('11545-2026-99997', '장애사무소', '최시험', None, '장애'),
             ('11545-2026-99996', '형식사무소', '최시험', None, '형식'),
             ('11545-2026-99995', '한도사무소', '최시험', None, '결과 코드 22')]
    bv = []
    for i, (no, office, ceo, want, word) in enumerate(cases):
        u = bizuser(f'lbr{i}', f'BR{i}상사', base=ADP)
        st, j = call('POST', '/partner/broker', u['tok'], {'licenseNo': no, 'officeName': office, 'ceoName': ceo}, base=ADP)
        bv.append((j or {}).get('id'))
        src = q(f"select coalesce(lookup_result,'-')||'|'||coalesce(lookup_source,'-')||'|'||coalesce(lookup_detail,'') from broker_verifications where id='{(j or {}).get('id')}'")
        rec(f'H-7 중개사 대조 {no[-5:]} → {want or "미조회"}', st < 300 and j.get('lookupResult') == want and j.get('stub') is False
            and word in (j.get('lookupDetail') or '') and src.startswith(f"{want or '-'}|{'API' if want else '-'}"), (st, j and {k: j.get(k) for k in ('lookupResult', 'lookupSource', 'lookupDetail')}))
    last = [x for x in mlog() if x['path'].startswith('/broker')][-1]
    rec('H-8 대조 요청 — 키 쿼리(apiKey) · 파라미터 지도(regNo) · 고정값(format)', 'apiKey=broker-test-key' in last['path'] and 'regNo=' in last['path'] and 'format=json' in last['path'], last['path'][:120])
    st, j = call('POST', f"/admin/brokers/{bv[4]}/lookup", OPS, base=ADP)
    rec('H-9 운영 다시 조회 (지연 건) → 미조회 유지 · 사유', st < 300 and j['looked'] is False and j['lookupResult'] is None and '늦어' in j['lookupDetail'], (st, j))
    st, j = call('POST', f"/admin/brokers/{bv[1]}/lookup", OPS, base=ADP)
    rec('H-10 운영 다시 조회 (불일치 건) → API 결과 갱신', st < 300 and j['looked'] is True and j['lookupResult'] == 'MISMATCH' and j['lookupSource'] == 'API', (st, j))
    st, j = call('POST', f"/admin/brokers/{bv[0]}/lookup", OPS)
    rec('H-11 설정 없는 인스턴스에서 다시 조회 → 422 LOOKUP_NOT_CONFIGURED', st == 422 and j['code'] == 'LOOKUP_NOT_CONFIGURED', (st, j))
    st, j = call('POST', f"/admin/brokers/{bv[3]}/decide", ADM, {'state': 'VERIFIED'}, base=ADP)
    rec('H-12 NOT_FOUND 승인 → 422 BROKER (DB)', st == 422 and j['code'] == 'BROKER', (st, j))
    st, j = call('POST', f"/admin/brokers/{bv[0]}/decide", ADM, {'state': 'VERIFIED'}, base=ADP)
    rec('H-13 실제 대조 MATCH 승인 → VERIFIED · 간주 승인 목록(v_broker_verified_assumed)에 없음', st < 300 and j['state'] == 'VERIFIED'
        and q(f"select count(*) from v_broker_verified_assumed where id='{bv[0]}'") == '0', (st, j))
    st, a = call('GET', f"/admin/brokers/{bv[1]}", OPS, base=ADP)
    rec('H-14 운영 상세에 lookupSource · lookupDetail', st == 200 and a['lookupSource'] == 'API' and '사무소명' in (a['lookupDetail'] or ''), a and a.get('lookupDetail'))
    # 뒷정리 — 이 시험이 넣은 심사 대기 신청을 반려로 닫습니다(남기면 운영 목록 「심사 대기」가 쌓여 200건 한도 밖으로 새 신청이 밀립니다 — G-207)
    for x in bv[1:]:
        if x: call('POST', f"/admin/brokers/{x}/decide", ADM, {'state': 'REJECTED', 'reason': '시험 정리(srv_lead)'}, base=ADP)
    # H-15 국세청
    for tail, want, word in (('01', 'VALID', '계속사업자'), ('02', 'SUSPENDED', '휴업자'), ('03', 'CLOSED', '폐업자'),
                             ('04', 'UNKNOWN', '등록되지 않은'), ('05', 'UNKNOWN', 'HTTP 500'), ('06', 'UNKNOWN', '지연')):
        brn = str(uuid.uuid4().int)[-8:] + tail
        u = bizuser(f'lnts{tail}', f'NTS{tail}상사', bizno=brn, base=ADP)
        j = u['apply'] or {}
        env = q(f"select coalesce(nts_env,'-')||'|'||coalesce(nts_status,'-') from businesses where biz_reg_no='{brn}'")
        if want in ('SUSPENDED', 'CLOSED'):
            # v10.31 (w1 · 10/10 시안 jfail) — 휴업 · 폐업이면 사업자 신청 자체를 거부(422 BIZ_CLOSED · 국세청 글 함께) · 사업자 행 없음 (전: 받아 두고 검수자에게)
            rec(f'H-15 국세청 {tail} → {want} · 신청 거부 422 BIZ_CLOSED(국세청 「{word}」) · 사업자 행 없음', u['st'] == 422 and j.get('code') == 'BIZ_CLOSED'
                and word in (j.get('message') or '') and env == '', (u['st'], j.get('code'), j.get('message'), env))
            continue
        rec(f'H-15 국세청 {tail} → {want} · stub:false · 단계 TEST(공식 주소 아님)', u['st'] < 300 and j.get('ntsStatus') == want and j.get('ntsStub') is False
            and word in (j.get('ntsDetail') or '') and env == f'TEST|{want}', (u['st'], j.get('ntsStatus'), j.get('ntsDetail'), env))
    last = [x for x in mlog() if x['path'].startswith('/nts')][-1]
    rec('H-16 국세청 요청 — /status?serviceKey=…&returnType=JSON · 본문 b_no 배열', 'serviceKey=nts-test-key' in last['path'] and 'returnType=JSON' in last['path']
        and isinstance(last['body']['b_no'], list) and len(last['body']['b_no'][0]) == 10, last)

# ── I. nts-recheck (자기 확인 DB) ───────────────────────────────────
print('== I. nts-recheck ==', file=sys.stderr)
if not mock_up:
    rec('I nts-recheck — MOCK 없음 · 건너뜀', True, '', skip=True)
else:
    acc = q(f"insert into accounts(email,password_hash,name) values ('nts_{tag}@t.local','x','재조회') returning id", CHECK_DB)
    nos = {t: str(uuid.uuid4().int)[-8:] + t for t in ('01', '03', '05')}
    for t, n in nos.items():
        psql(f"insert into businesses(account_id,biz_reg_no,company_name,ceo_name,nts_status,nts_env) values ('{acc}','{n}','재조회{t}{tag}','김','VALID','STUB')", CHECK_DB)
    env = dict(os.environ, DATABASE_URL=CHECK_DB, NTS_SERVICE_KEY='nts-test-key', NTS_API_BASE=MOCK + '/nts', NTS_TIMEOUT_MS='1000')
    run = lambda *a: subprocess.run(['npx', 'ts-node', '-P', 'tsconfig.scripts.json', 'scripts/nts-recheck.ts', *a], cwd=KIT, env=env, capture_output=True, text=True, timeout=180)
    psql("update integrations set status='TESTING' where code='NTS'", CHECK_DB)
    r1 = run('--apply')
    rec('I-1 국세청 연동이 LIVE 아니면 --apply 거부', r1.returncode == 1 and 'LIVE 가 아닙니다' in r1.stderr, (r1.returncode, r1.stderr[-120:]))
    psql("update integrations set status='LIVE' where code='NTS'", CHECK_DB)
    r0 = run()
    rec('I-2 대상만 보기(기본) — 아무것도 바꾸지 않음', r0.returncode == 0 and '공식 아님' in r0.stdout and q(f"select count(*) from businesses where biz_reg_no in ('{nos['01']}','{nos['03']}') and nts_env='STUB'", CHECK_DB) == '2', r0.stdout[:160])
    r2 = run('--apply')
    got = {t: q(f"select nts_env||'|'||nts_status from businesses where biz_reg_no='{n}'", CHECK_DB) for t, n in nos.items()}
    rec('I-3 --apply (가짜 서버) — 계속 · 폐업 기록, 500 은 그대로 · 공식 주소 아니라 TEST 로 기록', r2.returncode == 0 and got == {'01': 'TEST|VALID', '03': 'TEST|CLOSED', '05': 'STUB|VALID'}, (got, r2.stdout[-160:]))
    psql("update integrations set status='TESTING' where code='NTS'", CHECK_DB)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_lead.json')
json.dump(R, open(out, 'w'), ensure_ascii=False, indent=1)
real = [r for r in R if not r['skip']]
print(f"통과 {sum(r['ok'] for r in real)} / {len(real)}" + (f" · 건너뜀 {len(R) - len(real)}" if len(R) > len(real) else ''))
