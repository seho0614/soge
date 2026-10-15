"""v10.33 (2026-10-11 대표 결정 · D092) — 법률 · 세무 월 정액 노출: 부가세 별도 · 기간 연장(A안) · 세금계산서

  V. 부가세 별도   공급가액 × 10% · 1원 미만 절사 · 합계 · 개월수 — 처음 켜기(입금 확인)에 기록 · 공개 목록에는 금액 없음
  I. 세금계산서    입금 확인(처음 · 연장)마다 발행 요청 1줄 · 공급자 = 운영 법인 · 공급받는 자 = 업체 ·
                  운영이 발행 번호를 넣어 「발행됨」(한 번만) · 업체는 자기 발행 내역만 봄 · 금액 고칠 수 없음
  R. 기간 연장(A)  업체 연장 신청(RENEW_REQUESTED · 노출 계속) → 운영 입금 확인(기존 종료일 다음 날부터 · 신청 때 기준 금액)
                  · 반려(사유 5자) · 회차 이력 보존 · 겹침 · 빈 날 · 고치기 · 지우기를 DB 가 거부
  E. 만료 안내     만료 7일 전 안내(알림 → 메일 대기열) · 같은 종료일에 한 번 · 연장 없이 지나면 자동 종료(정기 작업 directory_expiry)
  A. 권한 · 감사   업체 본인만(남의 항목 404 · 비로그인 403) · 운영 화면 API 는 운영만 · 감사 기록 5종
  M. 매출          v_monthly_revenue 의 노출료 = 공급가액(부가세 제외)

  시험 자료: 매 실행마다 새 업체 1곳(시험용) — 끝에 노출을 종료합니다. 회차 이력 · 세금계산서 줄 · 감사 기록은 지울 수 없어 남습니다.
사용: python3 qa/test_v1033_directory.py      (API=http://localhost:3000 · DB=postgresql://sgb:sgb@localhost:5432/sgb)
"""
import json, urllib.request, subprocess, uuid, sys, os, datetime
API = (os.environ.get('API') or 'http://localhost:3000').rstrip('/').removesuffix('/api/v1')
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'
R = []

def psql(s):
    return subprocess.run(['psql', '-X', DB, '-tAc', s], capture_output=True, text=True)
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

ADM = login('admin@x.com'); OPS = login('ops@t.local', 'sgb-test-1234')
tag = uuid.uuid4().hex[:6]
KEY = 'directory.monthly_fee'

def member(prefix):
    e = f'{prefix}_{tag}@t.local'
    call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': f'{prefix}시험', 'agreedTerms': []})
    return e, login(e, 'sgb-test-1234')

def partner(prefix, company, legal=True):
    """사업자 인증 → 입점 승인 → 상담 축 승인 → (법률 자격 승인) — 정액 노출을 켤 수 있는 시험 업체"""
    e, T = member(prefix)
    call('POST', '/verifications/identity', T, {'provider': 'PASS'})
    st, j = call('POST', '/businesses', T, {'bizRegNo': str(uuid.uuid4().int)[-10:], 'companyName': f'{company}{tag}', 'ceoName': '김시험',
                                            'sido': '서울', 'sigungu': '금천구'})
    bid = (j or {}).get('businessId')
    call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    T = login(e, 'sgb-test-1234')
    st, pj = call('POST', '/partner/apply', T)
    call('POST', f"/admin/partners/{pj['id']}/approve", ADM)
    call('POST', '/partner/axes', T, {'axes': ['CONSULT']})
    ax = q(f"select id from mal_partner_axes where business_id='{bid}' and axis='CONSULT'")
    call('POST', f'/admin/partner-axes/{ax}/decide', OPS, {'approve': True})
    if legal:
        qid = q(f"insert into qualification_reviews(business_id, category_code, doc_no) values ('{bid}','LEGAL','LAW33-{prefix}-{tag}') returning id")
        call('POST', f'/admin/qualifications/{qid}/lookup', OPS); call('POST', f'/admin/qualifications/{qid}/decide', OPS, {'approve': True})
    return {'email': e, 'tok': T, 'bid': bid, 'pid': pj['id'], 'company': f'{company}{tag}',
            'bizno': q(f"select biz_reg_no from businesses where id='{bid}'"),
            'account': q(f"select account_id from businesses where id='{bid}'")}

today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)).date()
def pto(frm, months):  # fn_directory_period_to 와 같은 계산(DB 로 물어봄 — 달 끝 처리를 한곳에서)
    return q(f"select fn_directory_period_to('{frm}'::date, {months})::text")
def audit_n(action, target):
    return int(q(f"select count(*) from audit.audit_logs where action='{action}' and target_id='{target}'") or 0)
def rev_dir():
    return int(q("select coalesce(sum(amount),0) from v_monthly_revenue where kind='DIRECTORY' and month=date_trunc('month', now() at time zone 'Asia/Seoul')::date") or 0)

base0 = q(f"select value from site_settings where key='{KEY}'")
if base0 != '300000':
    call('PATCH', '/admin/site-settings', OPS, {'key': KEY, 'value': '300000'})

P = partner('d33', '한빛법무시험')
P2 = partner('d33b', '다른법무시험')
body = {'categoryCode': 'CSL_LEGAL', 'displayName': f'시험33 한빛 법률{tag}', 'intro': 'v10.33 시험용 — 실제 사무소가 아닙니다',
        'contactPhone': '02-0000-3333', 'sido': '서울'}
st, mine = call('POST', '/partner/directory', P['tok'], body)
ent = next(x for x in mine if x['categoryCode'] == 'CSL_LEGAL'); EID = ent['id']
st, mine2 = call('POST', '/partner/directory', P2['tok'], dict(body, displayName=f'시험33 다른 법률{tag}'))
EID2 = next(x for x in mine2 if x['categoryCode'] == 'CSL_LEGAL')['id']
rev0 = rev_dir()

try:
    # ── V. 부가세 별도 ────────────────────────────────────────────────
    print('== V. 부가세 별도 ==', file=sys.stderr)
    rec('V-1 부가세 = 공급가액 × 10% · 1원 미만 절사 (300,000→30,000 · 333,333→33,333 · 9→0)',
        q("select fn_directory_vat(300000)||'|'||fn_directory_vat(333333)||'|'||fn_directory_vat(9)") == '30000|33333|0')
    st, pub = call('GET', '/site-settings/public')
    rec('V-2 기준 금액 = 공급가액 월 300,000원(부가세 별도) — 업체 신청 화면 안내용 공개 설정', pub.get(KEY) == '300000', pub.get(KEY))
    st, j = call('POST', f'/admin/directory/{EID}/activate', OPS, {'paidFrom': str(today), 'months': 3, 'monthlyFee': 1.5, 'paymentRef': '시험'})
    rec('V-3 원 단위가 아닌 금액(1.5원) → 422 DIRECTORY_FEE', st == 422 and j['code'] == 'DIRECTORY_FEE', (st, j))
    st, j = call('POST', f'/admin/directory/{EID}/activate', OPS, {'paidFrom': str(today), 'paidTo': str(today + datetime.timedelta(days=5)), 'paymentRef': '시험'})
    st2, j2 = call('POST', f'/admin/directory/{EID}/activate', OPS, {'paidFrom': str(today), 'months': 13, 'paymentRef': '시험'})
    rec('V-4 개월 단위가 아닌 기간 · 13개월 → 거부(422 DIRECTORY_PERIOD · 400)', st == 422 and j['code'] == 'DIRECTORY_PERIOD' and '개월' in j['message'] and st2 == 400, (st, j, st2))
    to3 = pto(today, 3)
    st, j = call('POST', f'/admin/directory/{EID}/activate', OPS, {'paidFrom': str(today), 'months': 3, 'paymentRef': f'입금자 한빛 · 990,000원 · 시험 {tag}'})
    rec('V-5 입금 확인 → 켜기 3개월 · 기준 금액(비움) — 공급가액 900,000 · 부가세 90,000 · 합계 990,000 · 종료일 = 시작일 + 3개월 − 1일',
        st < 300 and j['state'] == 'ACTIVE' and j['months'] == 3 and j['supplyAmount'] == 900000 and j['vatAmount'] == 90000
        and j['totalAmount'] == 990000 and j['monthlyFee'] == 300000 and j['paidTo'] == to3 and j['rounds'] == 1, (st, j))
    st, mine = call('GET', '/partner/directory', P['tok'])
    me = next(x for x in mine if x['id'] == EID)
    rec('V-6 업체 화면 — 월 300,000원(공급가액) · 부가세 · 합계 · 개월수 · 회차 1', me['monthlyFee'] == 300000 and me['vatAmount'] == 90000
        and me['totalAmount'] == 990000 and me['months'] == 3 and me['rounds'] == 1 and me['renewal'] is None, me)
    st, lst = call('GET', '/admin/directory?state=ACTIVE', OPS)
    row = next((x for x in lst if x['id'] == EID), {})
    rec('V-7 운영 목록 — 합계(부가세 포함) · 공급가액 · 부가세가 숫자로', row.get('totalAmount') == 990000 and row.get('supplyAmount') == 900000 and row.get('vatAmount') == 90000, row)
    st, d = call('GET', '/consult/directory/CSL_LEGAL')
    rec('V-8 공개 사무소 목록에는 금액 미표시(v10.12 그대로) · 「광고」 표시', st == 200 and d['adLabel'] == '광고' and any(x['id'] == EID for x in d['entries'])
        and not any(k in json.dumps(d) for k in ('monthlyFee', 'supply', 'vat', 'total', '990000', '330000')), len(d['entries']))
    o = psql(f"BEGIN; update consult_directory_entries set vat_amount = 90001 where id='{EID}'; ROLLBACK;")
    rec('V-9 DB — 부가세 · 합계가 공급가액과 맞지 않으면 거부(ck_directory_amounts)', 'ck_directory_amounts' in o.stderr, o.stderr.strip()[:120])
    rec('V-10 소개 대가 금지 그대로 — 건수 · 성사와 잇는 칸 없음(항목 · 회차 · 연장 · 세금계산서)',
        q("select count(*) from information_schema.columns where table_name in ('consult_directory_entries','consult_directory_periods','consult_directory_renewals','consult_directory_invoices') and column_name ~ '(click|contact_count|per_lead|success|commission|lead_)'") == '0')

    # ── I. 세금계산서 ────────────────────────────────────────────────
    print('== I. 세금계산서 ==', file=sys.stderr)
    inv = psql(f"select id, state, supply, vat, total, supplier_name, supplier_biz_no, buyer_name, buyer_biz_no from consult_directory_invoices where entry_id='{EID}'").stdout.strip().split('\n')
    sname = q("select value from site_settings where key='footer.company_name'"); sno = q("select value from site_settings where key='footer.biz_reg_no'")
    f = inv[0].split('|') if inv and inv[0] else []
    INV1 = f[0] if f else None
    rec('I-1 입금 확인 1건 → 발행 요청 1줄(REQUESTED) · 900,000 + 90,000 = 990,000', len(inv) == 1 and f[1:5] == ['REQUESTED', '900000', '90000', '990000'], inv)
    rec('I-2 공급자 = 소개하는 자(운영 법인 · 설정 footer) · 공급받는 자 = 노출료를 낸 업체(상호 · 사업자번호)',
        f and f[5] == sname and f[6] == sno and f[7] == P['company'] and f[8] == P['bizno'] and '한국바이오헬스케어' in sname, f[5:9])
    st, mi = call('GET', '/partner/directory/invoices', P['tok'])
    st2, mi2 = call('GET', '/partner/directory/invoices', P2['tok'])
    st3, _ = call('GET', '/partner/directory/invoices')
    rec('I-3 업체는 자기 발행 내역만 — 남의 업체 목록에 없음 · 비로그인 403', st == 200 and [x['id'] for x in mi] == [INV1] and mi[0]['total'] == 990000
        and mi[0]['seq'] == 1 and mi[0]['kind'] == 'INITIAL' and not any(x['id'] == INV1 for x in mi2) and st3 == 403, (st, len(mi), st3))
    st, ai = call('GET', '/admin/directory/invoices?state=REQUESTED', OPS)
    st2, _ = call('GET', '/admin/directory/invoices', P['tok'])
    rec('I-4 운영 발행 요청 목록 — 운영만(업체 403)', st == 200 and any(x['id'] == INV1 for x in ai) and st2 == 403, (st, st2))
    st, j = call('POST', f'/admin/directory/invoices/{INV1}/issue', OPS, {'invoiceNo': '', 'issuedOn': str(today)})
    st2, j2 = call('POST', f'/admin/directory/invoices/{INV1}/issue', P['tok'], {'invoiceNo': f'T33-{tag}-1', 'issuedOn': str(today)})
    rec('I-5 발행 번호 없음 → 400 · 업체가 발행 표시 → 403', st == 400 and st2 == 403, (st, st2))
    st, j = call('POST', f'/admin/directory/invoices/{INV1}/issue', OPS, {'invoiceNo': f'T33-{tag}-1', 'issuedOn': str(today)})
    rec('I-6 발행 번호 · 발행일 입력 → 「발행됨」(ISSUED)', st < 300 and j['state'] == 'ISSUED' and j['invoiceNo'] == f'T33-{tag}-1', (st, j))
    st, j = call('POST', f'/admin/directory/invoices/{INV1}/issue', OPS, {'invoiceNo': f'T33-{tag}-9', 'issuedOn': str(today)})
    rec('I-7 이미 발행된 줄을 다시 → 409 NOT_REQUESTED', st == 409 and j['code'] == 'NOT_REQUESTED', (st, j))
    st, mi = call('GET', '/partner/directory/invoices', P['tok'])
    rec('I-8 업체 화면에 발행 번호 · 일자 · 금액', mi[0]['state'] == 'ISSUED' and mi[0]['invoiceNo'] == f'T33-{tag}-1' and mi[0]['issuedOn'] == str(today), mi[0])
    st, s = call('GET', '/partner/settlement', P['tok'])
    rec('I-9 파트너센터 「정산」 세금계산서 표에도 노출료 줄(kind DIRECTORY)', st == 200 and any(x['kind'] == 'DIRECTORY' and x['invoiceNo'] == f'T33-{tag}-1' and x['total'] == 990000 for x in s['invoices']), (st, [x['kind'] for x in (s or {}).get('invoices', [])][:5]))
    o1 = psql(f"BEGIN; update consult_directory_invoices set supply = 1 where id='{INV1}'; ROLLBACK;")
    o2 = psql(f"BEGIN; delete from consult_directory_invoices where id='{INV1}'; ROLLBACK;")
    rec('I-10 DB — 발행된 줄 고치기 · 줄 지우기 거부', 'DIRECTORY_INVOICE_ISSUED' in o1.stderr and 'append-only' in o2.stderr, (o1.stderr.strip()[:60], o2.stderr.strip()[:60]))

    # ── R. 기간 연장 A안 ───────────────────────────────────────────────
    print('== R. 기간 연장 ==', file=sys.stderr)
    st, j = call('POST', f'/partner/directory/{EID}/renew', None, {'months': 2})
    st2, j2 = call('POST', f'/partner/directory/{EID}/renew', P2['tok'], {'months': 2})
    st3, _ = call('POST', f'/partner/directory/{EID}/renew', P['tok'], {'months': 0})
    st4, _ = call('POST', f'/partner/directory/{EID}/renew', P['tok'], {'months': 13})
    st5, _ = call('POST', '/partner/directory/nope/renew', P['tok'], {'months': 1})
    rec('R-1 연장 신청 권한 · 형식 — 비로그인 403 · 남의 항목 404 · 0개월 · 13개월 400 · 번호 형식 아님 404',
        st == 403 and st2 == 404 and st3 == 400 and st4 == 400 and st5 == 404 and q(f"select state from consult_directory_entries where id='{EID}'") == 'ACTIVE', (st, st2, st3, st4, st5))
    st, j = call('POST', f'/partner/directory/{EID2}/renew', P2['tok'], {'months': 1})
    rec('R-2 노출 중이 아닌(심사 대기) 항목의 연장 신청 → 409 DIRECTORY_RENEW_STATE', st == 409 and j['code'] == 'DIRECTORY_RENEW_STATE', (st, j))
    st, mine = call('POST', f'/partner/directory/{EID}/renew', P['tok'], {'months': 2})
    me = next(x for x in mine if x['id'] == EID); rn = me.get('renewal') or {}
    nf = str(datetime.date.fromisoformat(to3) + datetime.timedelta(days=1))
    rec('R-3 연장 신청 2개월 → RENEW_REQUESTED · 신청 때 기준 금액 300,000 × 2 = 600,000 + 60,000 = 660,000 · 이어질 기간 = 종료일 다음 날부터',
        st < 300 and me['state'] == 'RENEW_REQUESTED' and rn.get('months') == 2 and rn.get('supplyAmount') == 600000 and rn.get('vatAmount') == 60000
        and rn.get('totalAmount') == 660000 and rn.get('from') == nf and rn.get('to') == pto(nf, 2), (st, me['state'], rn))
    st, d = call('GET', '/consult/directory/CSL_LEGAL')
    rec('R-4 연장 신청 중에도 노출은 계속(공개 목록에 그대로)', any(x['id'] == EID for x in d['entries']))
    st, j = call('POST', f'/partner/directory/{EID}/renew', P['tok'], {'months': 1})
    st2, j2 = call('POST', f'/admin/directory/{EID}/activate', OPS, {'paidFrom': str(today), 'months': 1, 'paymentRef': '시험'})
    rec('R-5 연장 신청 두 번 → 409 DIRECTORY_RENEW_OPEN · 연장 중 항목을 「처음 켜기」로 → 409 NOT_ACTIVATABLE',
        st == 409 and j['code'] == 'DIRECTORY_RENEW_OPEN' and st2 == 409 and j2['code'] == 'NOT_ACTIVATABLE', (st, j, st2, j2))
    st, lst = call('GET', '/admin/directory?state=RENEW_REQUESTED', OPS)
    row = next((x for x in lst if x['id'] == EID), {})
    rec('R-6 운영 「연장 신청」 목록 — 합계 660,000원(부가세 포함)을 보여 줌', st == 200 and (row.get('renewal') or {}).get('totalAmount') == 660000, row.get('renewal'))
    call('PATCH', '/admin/site-settings', OPS, {'key': KEY, 'value': '350000'})
    st, j = call('POST', f'/admin/directory/{EID}/renew/confirm', OPS, {'paymentRef': ' '})
    st2, j2 = call('POST', f'/admin/directory/{EID}/renew/confirm', P['tok'], {'paymentRef': '업체가 스스로 확인'})
    rec('R-7 입금 근거 없이(빈칸) 확인 → 거부(400 · 422) · 업체가 입금 확인 → 403', st in (400, 422) and st2 == 403
        and q(f"select state from consult_directory_entries where id='{EID}'") == 'RENEW_REQUESTED', (st, st2))
    n_inv0 = int(q(f"select count(*) from consult_directory_invoices where entry_id='{EID}'"))
    st, j = call('POST', f'/admin/directory/{EID}/renew/confirm', OPS, {'paymentRef': f'입금자 한빛 · 660,000원 · 연장 시험 {tag}'})
    to5 = pto(nf, 2)
    rec('R-8 연장 입금 확인 → ACTIVE · 기간 이어짐(종료일 = 기존 종료일 다음 날 + 2개월 − 1일) · 회차 2 · 처음 시작일 그대로',
        st < 300 and j['state'] == 'ACTIVE' and j['paidTo'] == to5 and j['paidFrom'] == str(today) and j['rounds'] == 2, (st, j))
    rec('R-9 금액은 연장 신청 때의 기준 금액(300,000) — 확인 전에 기준 금액을 350,000 으로 바꿔도 그대로 · 공급가액 600,000 · 부가세 60,000',
        j.get('monthlyFee') == 300000 and j.get('supplyAmount') == 600000 and j.get('vatAmount') == 60000 and j.get('totalAmount') == 660000, j)
    per = psql(f"select seq||'|'||kind||'|'||period_from||'|'||period_to from consult_directory_periods where entry_id='{EID}' order by seq").stdout.split()
    rec('R-10 회차 이력 — 1회차(처음) · 2회차(연장, 1회차 종료일 다음 날 시작) · 빈 날 · 겹침 없음',
        per == [f'1|INITIAL|{today}|{to3}', f'2|RENEWAL|{nf}|{to5}'], per)
    n_inv1 = int(q(f"select count(*) from consult_directory_invoices where entry_id='{EID}'"))
    rec('R-11 연장 입금 확인마다 세금계산서 발행 요청 1줄 더(합계 660,000)', n_inv1 == n_inv0 + 1
        and q(f"select total||'|'||state from consult_directory_invoices i join consult_directory_periods p on p.id=i.period_id where p.entry_id='{EID}' and p.seq=2") == '660000|REQUESTED', (n_inv0, n_inv1))
    rec('R-12 업체에 알림(연장 입금 확인)', q(f"select count(*) from notifications where account_id='{P['account']}' and event_code='DIRECTORY_RENEW_DECIDED' and title like '%입금 확인%'") == '1')
    st, j = call('POST', f'/admin/directory/{EID}/renew/confirm', OPS, {'paymentRef': '두 번째 확인 시도'})
    rec('R-13 연장 신청 없이 입금 확인 → 409 DIRECTORY_RENEW_NONE', st == 409 and j['code'] == 'DIRECTORY_RENEW_NONE', (st, j))
    call('PATCH', '/admin/site-settings', OPS, {'key': KEY, 'value': '300000'})
    # DB 규칙 — 겹침 · 빈 날 · 고치기 · 지우기
    ins = lambda frm, kind, months=1, ren='null': psql(
        f"BEGIN; insert into consult_directory_periods(entry_id,kind,renewal_id,period_from,period_to,months,monthly_fee,supply_amount,vat_amount,total_amount,payment_ref) "
        f"values ('{EID}','{kind}',{ren},'{frm}'::date, fn_directory_period_to('{frm}'::date,{months}),{months},300000,{300000*months},{30000*months},{330000*months},'시험'); ROLLBACK;")
    rid = q(f"select id from consult_directory_renewals where entry_id='{EID}' and state='CONFIRMED'")
    o1 = ins(str(today + datetime.timedelta(days=10)), 'INITIAL')
    o2 = ins(str(datetime.date.fromisoformat(to5) + datetime.timedelta(days=3)), 'RENEWAL', ren=f"'{rid}'")
    o3 = ins(to5, 'RENEWAL', ren=f"'{rid}'")
    rec('R-14 DB — 이전 기간과 겹치는 처음 켜기 · 빈 날이 생기는 연장 · 겹치는 연장 → 거부',
        'DIRECTORY_PERIOD_OVERLAP' in o1.stderr and 'DIRECTORY_PERIOD_CHAIN' in o2.stderr and 'DIRECTORY_PERIOD_CHAIN' in o3.stderr,
        (o1.stderr.strip()[:50], o2.stderr.strip()[:50], o3.stderr.strip()[:50]))
    o = psql(f"BEGIN; set local session_replication_role=replica; insert into consult_directory_periods(entry_id,seq,kind,period_from,period_to) values ('{EID}',99,'LEGACY','{today}','{today}'); ROLLBACK;")
    rec('R-15 DB — 트리거를 끄고 넣어도 같은 항목의 기간 겹침은 제약이 거부(EXCLUDE ex_dir_period_overlap)', 'ex_dir_period_overlap' in o.stderr, o.stderr.strip()[:100])
    o1 = psql(f"BEGIN; update consult_directory_periods set period_to = period_to + 1 where entry_id='{EID}' and seq=2; ROLLBACK;")
    o2 = psql(f"BEGIN; delete from consult_directory_periods where entry_id='{EID}'; ROLLBACK;")
    rec('R-16 DB — 회차 이력은 고치거나 지울 수 없음(append-only)', 'append-only' in o1.stderr and 'append-only' in o2.stderr, (o1.stderr.strip()[:60],))
    # 반려
    st, mine = call('POST', f'/partner/directory/{EID}/renew', P['tok'], {'months': 1})
    st, j = call('POST', f'/admin/directory/{EID}/renew/reject', OPS, {'reason': '짧음'})
    st2, j2 = call('POST', f'/admin/directory/{EID}/renew/reject', P['tok'], {'reason': '업체가 스스로 반려 시도'})
    rec('R-17 연장 반려 — 사유 5자 미만 → 422 DIRECTORY_REASON · 업체 → 403', st == 422 and j['code'] == 'DIRECTORY_REASON' and st2 == 403, (st, j, st2))
    n_per = q(f"select count(*) from consult_directory_periods where entry_id='{EID}'"); n_inv = q(f"select count(*) from consult_directory_invoices where entry_id='{EID}'")
    st, j = call('POST', f'/admin/directory/{EID}/renew/reject', OPS, {'reason': '입금 금액이 안내 금액과 다릅니다 — 다시 신청해 주십시오'})
    rec('R-18 연장 반려 → ACTIVE(노출 지금 기간까지 그대로) · 회차 · 세금계산서 줄 안 생김 · 종료일 그대로', st < 300 and j['state'] == 'ACTIVE' and j['paidTo'] == to5
        and q(f"select count(*) from consult_directory_periods where entry_id='{EID}'") == n_per and q(f"select count(*) from consult_directory_invoices where entry_id='{EID}'") == n_inv, (st, j))
    st, mine = call('GET', '/partner/directory', P['tok'])
    me = next(x for x in mine if x['id'] == EID)
    rec('R-19 업체 화면에 반려 사유 · 업체 알림', (me.get('lastRenewal') or {}).get('state') == 'REJECTED' and '안내 금액' in (me['lastRenewal'].get('reason') or '')
        and q(f"select count(*) from notifications where account_id='{P['account']}' and event_code='DIRECTORY_RENEW_DECIDED' and body like '%안내 금액%'") == '1', me.get('lastRenewal'))
    o = psql(f"BEGIN; update consult_directory_renewals set state='REJECTED', reason=null, decided_at=now() where entry_id='{EID}' and state='CONFIRMED'; ROLLBACK;")
    rec('R-20 DB — 사유 없는 반려 거부(ck_dir_renew_reject) · 열린 연장 신청은 항목마다 하나(ux_dir_renewal_open)', 'ck_dir_renew_reject' in o.stderr
        and q("select count(*) from pg_indexes where indexname='ux_dir_renewal_open'") == '1', o.stderr.strip()[:80])
    st, h = call('GET', f'/admin/directory/{EID}/history', OPS)
    st2, _ = call('GET', f'/admin/directory/{EID}/history', P['tok'])
    rec('R-21 운영 이력 화면 — 회차 2 · 연장 신청 2(확인 · 반려) · 세금계산서 2 · 업체 403', st == 200 and [p['seq'] for p in h['periods']] == [1, 2]
        and sorted(r['state'] for r in h['renewals']) == ['CONFIRMED', 'REJECTED'] and len(h['invoices']) == 2 and st2 == 403, (st, st2))

    # ── E. 만료 7일 전 안내 · 자동 종료 (날짜를 넣어 DB 함수를 부르고 되돌림) ──────────
    print('== E. 만료 안내 · 자동 종료 ==', file=sys.stderr)
    d7 = str(datetime.date.fromisoformat(to5) - datetime.timedelta(days=7))
    o = psql(f"BEGIN; select 'n1='||noticed from fn_directory_expiry_tick('{d7}'); select 'n2='||noticed from fn_directory_expiry_tick('{d7}'); "
             f"select 'note='||count(*) from notifications where account_id='{P['account']}' and event_code='DIRECTORY_EXPIRING' and body like '%{to5}%'; "
             f"select 'mark='||(end_notice_for = paid_to) from consult_directory_entries where id='{EID}'; ROLLBACK;").stdout
    rec('E-1 만료 7일 전 → 업체 알림(종료일 · 연장 안내) · 같은 날 다시 돌려도 한 번만', 'note=1' in o and 'mark=true' in o, o.split())
    o = psql(f"BEGIN; select fn_directory_expiry_tick('{d7}'); select 'q='||count(*) from v_notify_queue v join notifications n on n.id=v.notification_id "
             f"where n.account_id='{P['account']}' and n.event_code='DIRECTORY_EXPIRING' and v.email is not null; ROLLBACK;").stdout
    rec('E-2 안내는 메일 발송 대기열(v_notify_queue · notify_dispatch)에 올라감 — 업체 계정 메일 주소', 'q=1' in o, o.split())
    d8 = str(datetime.date.fromisoformat(to5) - datetime.timedelta(days=8))
    o = psql(f"BEGIN; select fn_directory_expiry_tick('{d8}'); select 'note='||count(*) from notifications where account_id='{P['account']}' and event_code='DIRECTORY_EXPIRING' and body like '%{to5}%'; ROLLBACK;").stdout
    rec('E-3 8일 전에는 안내하지 않음', 'note=0' in o, o.split())
    o = psql(f"BEGIN; select fn_directory_renew_request('{EID}', 1, null); select fn_directory_expiry_tick('{d7}'); "
             f"select 'note='||count(*) from notifications where account_id='{P['account']}' and event_code='DIRECTORY_EXPIRING' and body like '%{to5}%'; ROLLBACK;").stdout
    rec('E-4 이미 연장 신청을 낸 항목에는 만료 안내를 보내지 않음', 'note=0' in o, o.split())
    dx = str(datetime.date.fromisoformat(to5) + datetime.timedelta(days=1))
    o = psql(f"BEGIN; select 'ended='||ended from fn_directory_expiry_tick('{dx}'); select 'st='||state||'|'||(reason like '%자동 종료%') from consult_directory_entries where id='{EID}'; "
             f"select 'note='||count(*) from notifications where account_id='{P['account']}' and event_code='DIRECTORY_ENDED'; ROLLBACK;").stdout
    rec('E-5 연장 없이 종료일이 지나면 자동 종료(ENDED · 사유) · 업체 알림', 'st=ENDED|true' in o and 'note=1' in o, o.split())
    o = psql(f"BEGIN; select fn_directory_renew_request('{EID}', 1, null); select fn_directory_expiry_tick('{dx}'); "
             f"select 'st='||state from consult_directory_entries where id='{EID}'; select 'rn='||state||'|'||(reason is not null) from consult_directory_renewals where entry_id='{EID}' order by requested_at desc limit 1; ROLLBACK;").stdout
    rec('E-6 연장 신청만 내고 입금 확인 없이 종료일이 지나도 자동 종료 · 열린 연장 신청은 닫힘(CANCELED · 사유)', 'st=ENDED' in o and 'rn=CANCELED|true' in o, o.split())
    rec('E-7 정기 작업 directory_expiry 가 job_schedules 에 등록(매일 09:05)', q("select every_min||'|'||at_hour||'|'||at_minute||'|'||is_active from job_schedules where job='directory_expiry'") == '1440|9|5|true')
    st, j = call('POST', '/admin/jobs', ADM, {'job': 'directory_expiry'})
    rec('E-8 운영 「작업 실행」으로 directory_expiry 실행 → 결과(안내 · 종료 건수)', st < 300 and j['job'] == 'directory_expiry' and 'noticed' in (j.get('detail') or {}), (st, j))

    # ── M. 매출 ───────────────────────────────────────────────────────
    print('== M. 매출 ==', file=sys.stderr)
    rev1 = rev_dir()
    rec('M-1 이번 달 노출료 매출 = 공급가액 합(900,000 + 600,000) — 부가세(150,000)는 매출 아님', rev1 - rev0 == 1500000, (rev0, rev1))

    # ── A. 감사 기록 ──────────────────────────────────────────────────
    print('== A. 감사 ==', file=sys.stderr)
    import time; time.sleep(0.5)
    acts = {a: audit_n(a, EID) for a in ('DIRECTORY_ACTIVATE', 'DIRECTORY_RENEW_REQUEST', 'DIRECTORY_RENEW_CONFIRM', 'DIRECTORY_RENEW_REJECT')}
    acts['DIRECTORY_INVOICE_ISSUE'] = audit_n('DIRECTORY_INVOICE_ISSUE', INV1)
    rec('A-1 감사 기록 — 처음 켜기 · 연장 신청(2) · 입금 확인 · 반려 · 세금계산서 발행', acts == {'DIRECTORY_ACTIVATE': 1, 'DIRECTORY_RENEW_REQUEST': 2,
        'DIRECTORY_RENEW_CONFIRM': 1, 'DIRECTORY_RENEW_REJECT': 1, 'DIRECTORY_INVOICE_ISSUE': 1}, acts)
    rec('A-2 반려 감사 기록에 사유가 남음', q(f"select count(*) from audit.audit_logs where action='DIRECTORY_RENEW_REJECT' and target_id='{EID}' and after_data::text like '%안내 금액%'") == '1')
    st, _ = call('GET', '/admin/directory?state=RENEW_REQUESTED', P['tok'])
    st2, _ = call('POST', f'/admin/directory/{EID}/end', P['tok'], {'reason': '업체가 스스로 종료 시도'})
    rec('A-3 운영 목록 · 종료는 운영만(업체 403)', st == 403 and st2 == 403, (st, st2))
finally:
    call('PATCH', '/admin/site-settings', OPS, {'key': KEY, 'value': '300000'})
    call('POST', f'/admin/directory/{EID}/end', OPS, {'reason': 'v10.33 시험 끝 — 시험용 노출 종료'})
    call('POST', f'/admin/directory/{EID2}/reject', OPS, {'reason': 'v10.33 시험 끝 — 시험용 신청 정리'})
rec('Z-1 시험 뒤 정리 — 시험 노출 종료 · 기준 금액 300,000원', q(f"select state from consult_directory_entries where id='{EID}'") == 'ENDED'
    and q('select fn_directory_base_fee()::int') == '300000')

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_v1033_directory.json')
json.dump({'tag': tag, 'entry': EID, 'entry2': EID2, 'invoice1': INV1, 'results': R}, open(out, 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
