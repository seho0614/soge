# w3 v10.31 사본 — 10/10 시안 기준 요금제(BASIC 소개코드 0건 · D060): 정책 확인(P-00)을 더하고, 무료분 계산 규칙 시험 동안만 BASIC 을 1건으로 두었다가 되돌립니다(P-99)
"""D010 · D011 · D012 소개코드 — 일반 회원 발급 · 초과분 결제 · 유입 기록(귀속) · **매물별 코드** 검증 (API · DB 실측).

사용:  API=http://localhost:3031 python3 srv_refcode.py      (통합 후: API=http://localhost:3000)
       DB=postgresql://sgb:sgb@localhost:5432/sgb (기본값)
결과:  srv_refcode.json  {"pass":n,"total":n,"items":[...]}

새 계정만 만들어 씁니다. 공용 계정은 intro@x.com(STANDARD 포함분 · 초과 결제 확인)만 씁니다 — 시험이 만든 포함분 코드는 지우고 결제한 추가 코드는 폐기 표시합니다.

D012 (10/2 「소개코드는 매물별로」) — 운영 설정 refcode.scope 기본 listing. 시험 중 잠깐 all 로 바꿨다가 **반드시 listing 으로 되돌립니다**(finally).
"""
import json, os, subprocess, sys, threading, time, urllib.request, uuid

API = os.environ.get('API', 'http://localhost:3000').rstrip('/')
B = API if API.endswith('/api/v1') else API + '/api/v1'
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
R = []


def q(sql):
    return subprocess.run(['psql', DB, '-tAc', sql], capture_output=True, text=True).stdout.strip().split('\n')[0]


def qerr(sql):
    """SQL 을 실행하고 (성공여부, 오류문) — 차단 시험용"""
    p = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], capture_output=True, text=True)
    return p.returncode == 0, (p.stderr or '').strip()


def call(m, p, tok=None, body=None, headers=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'User-Agent': UA}
    if tok:
        h['authorization'] = 'Bearer ' + tok
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request(B + p, method=m, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e:
        st = e.code; raw = e.read()
    try:
        js = json.loads(raw) if raw else None
    except Exception:
        js = None
    return st, js


def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:160], file=sys.stderr)


def login(e, pw='sgb-test-1234', visitor=None):
    body = {'email': e, 'password': pw}
    if visitor:
        body['visitorKey'] = visitor
    st, j = call('POST', '/auth/login', body=body)
    return j['accessToken']


def signup(prefix, visitor=None):
    e = f'{prefix}_{uuid.uuid4().hex[:8]}@t.local'
    body = {'email': e, 'password': 'sgb-test-1234', 'name': '소개시험'}
    if visitor:
        body['visitorKey'] = visitor
    st, j = call('POST', '/auth/signup', body=body)
    assert st < 300, (st, j)
    return e, j['accessToken'], q(f"select id from accounts where email='{e}'")


def touch(code, visitor, tok=None, ua=UA, landing='/mall'):
    h = {'User-Agent': ua}
    if visitor is not None:
        h['X-Visitor-Key'] = visitor
    return call('POST', '/attribution/touch', tok, {'code': code, 'landingUrl': landing}, h)


def ev_count(code, visitor=None):
    w = f" and visitor_key='{visitor}'" if visitor else ''
    return int(q(f"select count(*) from attribution_events where code='{code}'{w}"))


issue = lambda tok, body=None: call('POST', '/referral-codes', tok, body or {})
quota = lambda tok, listing=None: call('GET', '/me/referral-codes/quota' + (f'?listingId={listing}' if listing else ''), tok)


def qall(sql):
    out = subprocess.run(['psql', DB, '-tAc', sql], capture_output=True, text=True).stdout.strip()
    return [x for x in out.split('\n') if x]


TADM = login('admin@x.com', 'sgb-dev-1234')


def set_scope(v):
    """운영 설정 refcode.scope — 관리자 API(PATCH /admin/site-settings)로 바꿉니다"""
    return call('PATCH', '/admin/site-settings', TADM, {'key': 'refcode.scope', 'value': v})


# 소개할 매물 — 게시 중 · 소개 가능한 업종 · 파는 쪽이 로그인할 수 있는 인증 사업자(거래 생성까지 시험)
LST = [r.split('|') for r in qall("""select l.id||'|'||a.email from listings l join accounts a on a.id=l.owner_account_id join categories c on c.id=l.category_id
  where l.status='PUBLISHED' and l.gwan_code='MAL' and a.email like 'brk_%@t.local' and a.status='ACTIVE' and not fn_category_no_intro(c.id)
    and exists(select 1 from account_roles r where r.account_id=a.id and r.role='BIZ_OWNER')
    and exists(select 1 from businesses b where b.account_id=a.id and b.verified_at is not null) order by l.published_at desc, l.id limit 8""")]
assert len(LST) >= 5, '시험할 안심소개 매물이 5건 이상 필요합니다'
(L, seller), (L2, seller2), (L3, _s3), (L4, _s4), (L5, _s5) = LST[:5]
TS = login(seller)
TS_2 = login(seller2)


def inquire_and_deal(tok, listing=None, seller_tok=None):
    """본인인증 → 그 매물에 문의 → 파는 쪽이 거래 생성"""
    call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
    st, c = call('POST', '/conversations', tok, {'targetType': 'LISTING', 'targetId': listing or L, 'message': '소개받고 문의드립니다. 상담 가능할까요?'})
    if st >= 300:
        return st, c, None
    st, d = call('POST', f"/conversations/{c['conversationId']}/deal", seller_tok or TS)
    return st, d, c['conversationId']


def deal_intro(d):
    return q(f"select coalesce(introducer_account_id::text,'-')||'|'||coalesce(attributed_code,'-') from deals where id='{(d or {}).get('dealId')}'")


BASIC_CODES = None   # w3 v10.31 — 시안 기준 BASIC 소개코드 0건(D060). 무료분 계산 규칙(본인인증 1명당 · CI 합산)은 그대로라 시험 동안만 1건으로 두고 끝에 되돌립니다


def main():
    global BASIC_CODES
    BASIC_CODES = q("select included_codes from subscription_plans where code='BASIC'")
    rec('P-00 정책(10/10 시안 기준) — BASIC 포함 소개코드 0건 · 소개 제안 월 10건 · 스탠다드 3건/50건 · 프로 15건/무제한',
        BASIC_CODES == '0' and q("select string_agg(code||':'||included_codes||':'||coalesce(proposal_limit::text,'∞'), ',' order by monthly_price) from subscription_plans")
        == 'BASIC:0:10,STANDARD:3:50,PRO:15:∞', BASIC_CODES)
    q("update subscription_plans set included_codes = 1 where code='BASIC'")   # 무료분 계산 규칙 시험용(끝에 되돌림)
    st, j = set_scope('listing')
    rec('S-00 운영 설정 refcode.scope = listing (기본 · 관리자 API 로 설정)', st < 300 and q("select value from site_settings where key='refcode.scope'") == 'listing', (st, j))

    # ───────────────────────── A. 일반 회원 발급 (매물별) ─────────────────────────
    eA, TA, A = signup('rcA')
    st, qa = quota(TA)
    rec('A-01 새 일반 회원 quota — 본인인증 전 무료분 0 · 구독 없음 · 결제 필요 · scope=listing · 매물 없이 부르면 current 없음',
        st == 200 and qa['freeRemaining'] == 0 and not qa['identityVerified'] and not qa['subscribed']
        and qa['planCode'] == 'BASIC' and qa['paymentRequired'] and qa['countScope'] == 'NONE'
        and qa['scope'] == 'listing' and qa['current'] is None, qa)

    st, j = issue(TA, {'listingId': L})
    rec('A-02 본인인증 전 · 결제 없이 발급 → 422 EXTRA_PAYMENT_REQUIRED (금액 · 건수 details)',
        st == 422 and j['code'] == 'EXTRA_PAYMENT_REQUIRED' and j['details']['amount'] == 30000
        and j['details']['extraCount'] == 1 and j['details']['identityVerified'] is False, j)
    rec('A-03 실패한 발급은 구독도 남기지 않음(트랜잭션 롤백)',
        q(f"select count(*) from subscriptions where account_id='{A}'") == '0')

    st1, j1 = call('POST', '/referral-codes', None, {'listingId': L})
    st2, j2 = call('GET', '/me/referral-codes', None)
    st3, j3 = call('GET', '/me/referral-codes/quota', None)
    rec('A-04 비로그인 발급 · 목록 · 현황 → 403 UNAUTHENTICATED',
        st1 == 403 and st2 == 403 and st3 == 403 and j1['code'] == 'UNAUTHENTICATED', (st1, st2, st3))

    st, j = call('POST', '/referral-codes', TA, {'listingId': L, 'count': 11})
    rec('A-05 count 11 → 400 (최대 10)', st == 400, (st, j))
    st, j = call('POST', '/referral-codes', TA, {'listingId': L, 'paymentKey': 'bad key!'})
    rec('A-06 결제키 형식 오류 → 400', st == 400, (st, j))

    # ── D012 매물별 — 형식 · 대상 ──
    st, j = issue(TA)
    rec('L-01 매물 없이 발급 → 422 LISTING_REQUIRED (scope=listing)', st == 422 and j['code'] == 'LISTING_REQUIRED', (st, j))
    st, j = issue(TA, {'listingId': L, 'count': 2})
    rec('L-02 한 번에 2건 → 422 ONE_CODE_PER_LISTING', st == 422 and j['code'] == 'ONE_CODE_PER_LISTING', (st, j))
    st, j = issue(TA, {'listingId': 'not-a-uuid'})
    sta, ja = quota(TA, 'not-a-uuid')
    rec('L-03 listingId 형식 오류 → 400 (발급 · 현황)', st == 400 and sta == 400, (st, j, sta, ja))
    ghost = str(uuid.uuid4())
    st, j = issue(TA, {'listingId': ghost})
    sta, ja = quota(TA, ghost)
    rec('L-04 없는 매물 → 404 (발급 · 현황)', st == 404 and sta == 404, (st, j, sta, ja))
    NP = q("select id from listings where status <> 'PUBLISHED' order by created_at limit 1")
    if NP:
        st, j = issue(TA, {'listingId': NP})
        sta, ja = quota(TA, NP)
        rec('L-05 게시 중이 아닌 매물 → 409 LISTING_NOT_PUBLISHED · quota.blocked · 제목은 내보내지 않음',
            st == 409 and j['code'] == 'LISTING_NOT_PUBLISHED' and ja['blocked'] == 'LISTING_NOT_PUBLISHED' and ja['listing'] is None, (st, j, ja.get('blocked')))
    else:
        rec('L-05 게시 중이 아닌 매물 (해당 매물 없음 — 건너뜀)', True, 'skip')
    st, j = issue(TS, {'listingId': L})
    sta, ja = quota(TS, L)
    rec('L-06 본인 매물 → 422 OWN_LISTING · quota.blocked', st == 422 and j['code'] == 'OWN_LISTING' and ja['blocked'] == 'OWN_LISTING', (st, j, ja.get('blocked')))

    # 본인인증 — 개발 스텁(POST /verifications/identity → ci_hash 'stub-ci', 계정 단위로 셈)
    st, j = call('POST', '/verifications/identity', TA, {'provider': 'PASS'})
    rec('A-07 본인인증(개발 스텁) — stub:true · ci_hash=stub-ci',
        st < 300 and j.get('stub') is True and q(f"select ci_hash from identity_verifications where account_id='{A}' order by completed_at desc limit 1") == 'stub-ci', j)
    st, qa = quota(TA, L)
    rec('A-08 본인인증 후 quota(매물) — 무료 1건 · 계정 단위(ACCOUNT) · 그 매물 코드 없음 · 받을 수 있음',
        qa['freeRemaining'] == 1 and qa['identityVerified'] and qa['countScope'] == 'ACCOUNT' and qa['current'] is None
        and qa['listing']['id'] == L and qa['listing']['gwanCode'] == 'MAL' and qa['blocked'] is None, qa)

    st, j = issue(TA, {'listingId': L})
    codeA1 = j[0]['code'] if st in (200, 201) else None
    rec('A-09 무료 1건 발급 — isExtra false · 매물에 묶임 · 무료 BASIC 구독이 자동으로 열림',
        st in (200, 201) and len(j) == 1 and j[0]['isExtra'] is False and not j[0]['paid']
        and j[0]['listingId'] == L and j[0]['reused'] is False
        and q(f"select listing_id from referral_codes where code='{codeA1}'") == L
        and q(f"select plan_code||':'||status from subscriptions where account_id='{A}' and status in ('ACTIVE','PAST_DUE')") == 'BASIC:ACTIVE'
        and q(f"select count(*) from subscription_invoices i join subscriptions s on s.id=i.subscription_id where s.account_id='{A}'") == '0',
        (st, j))
    st, qa = quota(TA, L)
    st, qb = quota(TA)
    st, qc = quota(TA, L2)
    rec('A-10 quota.current = 그 매물의 내 코드 · 매물 없이 부르면 null · 다른 매물은 null · 무료분 0 · 결제 필요',
        qa['current'] and qa['current']['code'] == codeA1 and qa['current']['listingId'] == L
        and qb['current'] is None and qc['current'] is None
        and qa['freeRemaining'] == 0 and qa['paymentRequired'] and qa['subscribed'], (qa['current'], qb['current'], qc['current']))
    n_before = q(f"select count(*) from referral_codes where owner_account_id='{A}'")
    quota(TA, L); quota(TA, L2)
    rec('A-11 quota 조회는 아무것도 만들지 않음', q(f"select count(*) from referral_codes where owner_account_id='{A}'") == n_before)

    st, j = issue(TA, {'listingId': L})
    st2, j2 = issue(TA, {'listingId': L, 'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': 30000})
    rec('L-07 같은 매물 두 번 = 같은 코드(reused) · 무료분 1건만 소모 · 결제 정보를 보내도 결제하지 않음',
        st in (200, 201) and j[0]['code'] == codeA1 and j[0]['reused'] is True
        and st2 in (200, 201) and j2[0]['code'] == codeA1 and j2[0]['reused'] is True
        and q(f"select count(*) from referral_codes where owner_account_id='{A}'") == '1'
        and q(f"select count(*) from referral_code_payments where account_id='{A}'") == '0', (st, j, st2))

    st, j = issue(TA, {'listingId': L2})
    rec('A-12 두 번째 매물(무료분 초과) · 결제 없음 → 422 EXTRA_PAYMENT_REQUIRED', st == 422 and j['code'] == 'EXTRA_PAYMENT_REQUIRED'
        and j['details']['freeRemaining'] == 0 and j['details']['identityVerified'] is True, j)
    st, j = issue(TA, {'listingId': L2, 'paymentKey': 'stub_' + uuid.uuid4().hex, 'amount': 10000})
    rec('A-13 결제 금액이 다름 → 422 AMOUNT_MISMATCH (발급 · 결제행 없음)', st == 422 and j['code'] == 'AMOUNT_MISMATCH'
        and q(f"select count(*) from referral_code_payments where account_id='{A}'") == '0', j)

    PK = 'stub_' + uuid.uuid4().hex
    st, j = issue(TA, {'listingId': L2, 'paymentKey': PK, 'orderId': 'rcx-' + uuid.uuid4().hex[:12], 'amount': 30000})
    codeA2 = j[0]['code'] if st in (200, 201) else None
    rec('A-14 두 번째 매물 — 결제(스텁) 후 추가 1건 발급 · isExtra · paid · 30,000원 · 그 매물에 묶임',
        st in (200, 201) and j[0]['isExtra'] and j[0]['paid'] and j[0]['extraAmount'] == 30000 and j[0]['listingId'] == L2 and codeA2 != codeA1, (st, j))
    row = q(f"select amount||'|'||code_count||'|'||stub||'|'||unit_price from referral_code_payments where payment_key='{PK}'")
    rec('A-15 결제 행: 30000원 · 1건 · stub=true · 코드 행에 결제키 · 금액',
        row == '30000|1|true|30000' and q(f"select extra_payment_key||'|'||extra_amount from referral_codes where code='{codeA2}'") == f'{PK}|30000', row)
    st, j = issue(TA, {'listingId': L3, 'paymentKey': PK, 'amount': 30000})
    rec('A-16 같은 결제키로 다른 매물 → 409 PAYMENT_KEY_USED (코드 늘지 않음)',
        st == 409 and j['code'] == 'PAYMENT_KEY_USED' and q(f"select count(*) from referral_codes where extra_payment_key='{PK}'") == '1', j)
    PK2 = 'stub_' + uuid.uuid4().hex
    st, j = issue(TA, {'listingId': L3, 'paymentKey': PK2, 'amount': 30000})
    rec('A-17 세 번째 매물 — 결제 후 1건 (매물마다 1건 · 30,000원)',
        st in (200, 201) and len(j) == 1 and j[0]['isExtra'] and j[0]['paid'] and j[0]['listingId'] == L3
        and q(f"select count(*) from referral_codes where extra_payment_key='{PK2}'") == '1'
        and q(f"select amount from referral_code_payments where payment_key='{PK2}'") == '30000', (st, j))

    st, codes = call('GET', '/me/referral-codes', TA)
    rec('A-18 내 소개코드 목록(MEMBER) — 3건 · thisMonth · paymentStub · 매물 id · 제목 · 관 코드',
        st == 200 and len(codes) == 3 and all(c['thisMonth'] for c in codes)
        and sum(1 for c in codes if c['paymentStub']) == 2
        and {c['listingId'] for c in codes} == {L, L2, L3} and all(c['listingTitle'] and c['gwanCode'] == 'MAL' and c['listingStatus'] == 'PUBLISHED' for c in codes),
        [(c['code'], c['isExtra'], c['paymentStub'], c['listingId'][:8]) for c in codes])
    st, ms = call('GET', '/me/subscription', TA)
    rec('A-19 /me/subscription (MEMBER · 자동 BASIC) 정상', st == 200 and ms['planCode'] == 'BASIC', ms)

    # DB 가 직접 막는가
    sub_a = q(f"select id from subscriptions where account_id='{A}' and status='ACTIVE'")
    ok, er = qerr(f"insert into referral_codes(code,owner_account_id,subscription_id,is_extra) values ('QX{uuid.uuid4().hex[:6].upper()}','{A}','{sub_a}',true)")
    rec('A-20 DB: 무료 요금제 초과 코드를 결제키 없이 INSERT → 차단(REFCODE)', not ok and 'REFCODE' in er, er[:120])
    ok, er = qerr(f"insert into referral_codes(code,owner_account_id,subscription_id,is_extra,extra_payment_key,extra_amount) values ('QY{uuid.uuid4().hex[:6].upper()}','{A}','{sub_a}',true,'{PK}',30000)")
    rec('A-21 DB: 이미 다 쓴 결제키로 코드 하나 더 INSERT → 차단', not ok and 'REFCODE' in er, er[:120])
    ok, er = qerr(f"update referral_code_payments set amount=0 where payment_key='{PK}'")
    rec('A-22 DB: 결제 행 수정 → 차단(append-only)', not ok, er[:120])
    buyer_exp = q("select s.id from subscriptions s join accounts a on a.id=s.account_id where s.status in ('EXPIRED','CANCELLED') limit 1")
    ok, er = qerr(f"insert into referral_codes(code,owner_account_id,subscription_id) select 'QZ{uuid.uuid4().hex[:6].upper()}', account_id, id from subscriptions where id='{buyer_exp}'")
    rec('A-23 DB: 구독 없는(만료) 코드 INSERT → 여전히 INV-8 이 막음', not ok and 'INV-8' in er, er[:120])
    ok, er = qerr(f"insert into referral_codes(code,owner_account_id,subscription_id) values ('QW{uuid.uuid4().hex[:6].upper()}','{A}',NULL)")
    rec('A-24 DB: 구독 id 없이 INSERT → 차단', not ok, er[:120])
    ok, er = qerr(f"insert into referral_codes(code,owner_account_id,subscription_id,listing_id) values ('QV{uuid.uuid4().hex[:6].upper()}','{A}','{sub_a}','{L}')")
    rec('L-08 DB: 같은 회원 · 같은 매물의 살아 있는 코드 하나 더 INSERT → 유일 인덱스가 막음', not ok and 'uq_refcode_owner_listing_live' in er, er[:140])
    ok, er = qerr(f"update referral_codes set listing_id='{L4}' where code='{codeA1}'")
    ok2, er2 = qerr(f"update referral_codes set listing_id=NULL where code='{codeA1}'")
    rec('L-09 DB: 발급된 코드의 매물 변경 · 비우기 → 차단(불변 — 판정 재현성)', not ok and not ok2 and 'REFCODE' in er and 'REFCODE' in er2, er[:120])
    if NP:
        ok, er = qerr(f"insert into referral_codes(code,owner_account_id,subscription_id,listing_id) values ('QU{uuid.uuid4().hex[:6].upper()}','{A}','{sub_a}','{NP}')")
        rec('L-10 DB: 게시 중이 아닌 매물에 묶인 코드 INSERT → 차단(trg_refcode_listing_guard)', not ok and 'REFCODE' in er, er[:120])
    own_l = q(f"select owner_account_id from listings where id='{L}'")
    # 파는 쪽에 구독이 없을 수 있어 트랜잭션 안에서 임시 구독을 만들고 되돌립니다(오류면 연결이 끊기며 되돌아가고, 성공해도 rollback)
    ok, er = qerr(f"""begin;
      with s as (insert into subscriptions(account_id,plan_code,status,current_period_start,current_period_end)
                 select '{own_l}','BASIC','ACTIVE',now(),now()+interval '30 days'
                  where not exists(select 1 from subscriptions where account_id='{own_l}' and status in ('ACTIVE','PAST_DUE')) returning id)
      select count(*) from s;
      insert into referral_codes(code,owner_account_id,subscription_id,listing_id)
        select 'QT{uuid.uuid4().hex[:6].upper()}','{own_l}', id, '{L}' from subscriptions where account_id='{own_l}' and status in ('ACTIVE','PAST_DUE');
      rollback;""")
    rec('L-11 DB: 본인 매물에 묶인 코드 INSERT → 차단(trg_refcode_listing_guard)', not ok and '본인 매물' in er, er[:120])

    # 같은 CI — 실제 PASS 연동이면 ci_hash 가 사람마다 같습니다. 스텁은 모두 'stub-ci' 라 SQL 로 같은 CI 를 넣어 흉내 냅니다.
    CI = 'qa-ci-' + uuid.uuid4().hex
    eC1, TC1, C1 = signup('rcC1')
    eC2, TC2, C2 = signup('rcC2')
    for acc in (C1, C2):
        q(f"insert into identity_verifications(account_id,provider,result,ci_hash,completed_at,raw) values ('{acc}','PASS','SUCCESS','{CI}',now(),'{{\"qa\":true}}'::jsonb); update accounts set identity_verified_at=now() where id='{acc}'")
    st, q1 = quota(TC1, L)
    st, j = issue(TC1, {'listingId': L})
    rec('A-25 같은 CI 첫 계정 — 무료 1건 발급(countScope CI)', q1['countScope'] == 'CI' and q1['freeRemaining'] == 1 and st in (200, 201) and not j[0]['isExtra'], (q1, j))
    st, q2 = quota(TC2, L)
    st2, j2 = issue(TC2, {'listingId': L})
    rec('A-26 같은 달 같은 CI 다른 계정 — 무료분 공유(0) → 같은 매물이어도 422 EXTRA_PAYMENT_REQUIRED (코드는 회원마다 따로)',
        q2['freeRemaining'] == 0 and q2['usedThisMonth'] == 1 and q2['current'] is None and st2 == 422 and j2['code'] == 'EXTRA_PAYMENT_REQUIRED', (q2, j2))

    # 동시 — 무료분이 두 번 나가지 않음 · 같은 매물 코드는 1개
    eD, TD, D = signup('rcD')
    call('POST', '/verifications/identity', TD, {'provider': 'PASS'})
    res = []
    th = [threading.Thread(target=lambda l=l: res.append(issue(TD, {'listingId': l}))) for l in (L, L2, L3, L4)]
    [t.start() for t in th]; [t.join() for t in th]
    rec('A-27 서로 다른 매물 4건을 동시에 눌러도 무료 1건만 발급(나머지 422)',
        sorted(r[0] for r in res) == [201, 422, 422, 422]
        and q(f"select count(*) from referral_codes where owner_account_id='{D}' and not is_extra") == '1', [r[0] for r in res])
    eD2, TD2, D2 = signup('rcD2')
    call('POST', '/verifications/identity', TD2, {'provider': 'PASS'})
    res = []
    th = [threading.Thread(target=lambda: res.append(issue(TD2, {'listingId': L5}))) for _ in range(6)]
    [t.start() for t in th]; [t.join() for t in th]
    rec('L-12 같은 매물을 동시에 6번 → 코드 1개(1번 발급 · 5번은 그 코드 reused)',
        all(r[0] in (200, 201) for r in res) and len({r[1][0]['code'] for r in res}) == 1
        and sum(1 for r in res if not r[1][0]['reused']) == 1
        and q(f"select count(*) from referral_codes where owner_account_id='{D2}'") == '1', [(r[0], r[1][0].get('reused') if isinstance(r[1], list) else r[1]) for r in res])

    # BIZ_OWNER (STANDARD) — 포함 3건(새 매물 기준), 넘으면 결제 후 발급 (D011 · 10/2 결정 「유료 요금제 추가 코드도 적용」)
    TI = login('intro@x.com', 'sgb-dev-1234')
    accI = q("select id from accounts where email='intro@x.com'")
    T0 = q("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
    # intro 가 아직 코드를 안 받은 매물만 씁니다(이미 받은 매물은 그 코드를 돌려주므로 포함분을 쓰지 않습니다)
    LI = [l for l, _ in LST if q(f"select count(*) from referral_codes where owner_account_id='{accI}' and listing_id='{l}' and revoked_at is null") == '0']
    st, qi = quota(TI)
    left = qi['freeRemaining'] if st == 200 else 0
    assert len(LI) >= left + 2, 'intro 가 코드를 안 받은 매물이 모자랍니다'
    free_ok = True
    for i in range(left):                       # 남은 포함분을 결제 없이 받습니다 (매물마다 1건)
        st, j = issue(TI, {'listingId': LI[i]})
        free_ok = free_ok and st in (200, 201) and j[0]['isExtra'] is False and not j[0]['paid'] and j[0]['listingId'] == LI[i]
    rec('A-28 BIZ_OWNER(intro · STANDARD) 포함분은 결제 없이 발급 (새 매물마다 1건)', qi['planCode'] == 'STANDARD' and free_ok, (qi['usedThisMonth'], left))
    st, q2 = quota(TI, LI[left])
    rec('A-28b 포함 3건을 다 쓰면 quota.paymentRequired (유료 요금제도)', st == 200 and q2['freeRemaining'] == 0 and q2['paymentRequired'] and not q2['freePlan'] and q2['current'] is None, q2)
    st, j = issue(TI, {'listingId': LI[left]})
    rec('A-28c 유료 요금제 초과(새 매물) — 결제 없이 422 EXTRA_PAYMENT_REQUIRED(30,000원) · 코드 안 늘어남',
        st == 422 and j['code'] == 'EXTRA_PAYMENT_REQUIRED' and j['details']['amount'] == 30000 and '요금제에 포함된' in j['message'], (st, j))
    PKI = 'stub_' + uuid.uuid4().hex
    st, j = issue(TI, {'listingId': LI[left], 'paymentKey': PKI, 'amount': 30000})
    rec('A-28d 유료 요금제 초과 — 결제(stub) 후 발급 · isExtra · paid · 결제 행 1건',
        st in (200, 201) and j[0]['isExtra'] and j[0]['paid'] and q(f"select code_count||'|'||amount from referral_code_payments where payment_key='{PKI}'") == '1|30000', (st, j))
    if left:
        st, j = issue(TI, {'listingId': LI[0]})
        rec('A-28g 포함분을 다 쓴 뒤에도 이미 받은 매물은 그 코드 그대로(결제 없음)', st in (200, 201) and j[0]['reused'] is True, (st, j))
    subI = q("select s.id from subscriptions s join accounts a on a.id=s.account_id where a.email='intro@x.com' and s.status in ('ACTIVE','PAST_DUE')")
    okI, erI = qerr(f"insert into referral_codes(code,subscription_id,owner_account_id,is_extra) values ('ZZ{uuid.uuid4().hex[:4].upper()}','{subI}','{accI}',true)")
    rec('A-28e 유료 요금제 초과 코드를 결제키 없이 INSERT → DB 거부(trg_refcode_extra_paid)', (not okI) and 'REFCODE' in erI, erI[:120])
    rec('A-28f 감시 뷰 v_refcode_extra_unpaid = 0', q('select count(*) from v_refcode_extra_unpaid') == '0')
    st, j = call('GET', '/me/referral-codes', TI)
    rec('A-29 BIZ_OWNER 내 소개코드 목록 정상', st == 200 and isinstance(j, list) and len(j) >= 1, st)
    # 공용 계정(intro)의 **포함분** 시험 코드는 지웁니다(다음 실행의 포함 건수가 바뀌지 않게).
    # 결제한 추가 코드는 결제 기록과 짝이라 남기되 **폐기 표시**합니다 — 그 매물을 다음 실행에서 다시 쓸 수 있게(매물마다 살아 있는 코드 1개).
    for c in (j or []):
        if c.get('issuedAt', '') >= T0:
            if not c.get('isExtra'):
                q(f"delete from referral_codes where code='{c['code']}' and not exists(select 1 from attribution_events e where e.code='{c['code']}')")
            else:
                q(f"update referral_codes set revoked_at=now() where code='{c['code']}'")

    # ───────────────────────── S. 운영 설정 refcode.scope=all (전 동작) ─────────────────────────
    st, j = set_scope('ALL')
    rec('S-01 설정 형식 검사 — refcode.scope 에 ALL → 422 SETTING_FORMAT · 값 유지', st == 422 and j['code'] == 'SETTING_FORMAT'
        and q("select value from site_settings where key='refcode.scope'") == 'listing', (st, j))
    eO, TO, O = signup('rcO')
    call('POST', '/verifications/identity', TO, {'provider': 'PASS'})
    codeAll = None
    try:
        st, j = set_scope('all')
        rec('S-02 관리자가 refcode.scope=all 로 바꿈', st < 300 and j.get('value') == 'all', (st, j))
        st, qo = quota(TO, L)
        st, j = issue(TO)
        codeAll = j[0]['code'] if st in (200, 201) else None
        rec('S-03 scope=all — 매물 없이 발급 · 코드는 매물에 안 묶임(listing_id NULL)',
            qo['scope'] == 'all' and st in (200, 201) and j[0]['listingId'] is None and not j[0]['isExtra']
            and q(f"select listing_id is null from referral_codes where code='{codeAll}'") == 't', (st, j))
        st, j = issue(TO, {'listingId': L})
        rec('S-04 scope=all — listingId 를 보내도 묶지 않음 · 누를 때마다 새 코드(무료분 초과는 결제) → 422', st == 422 and j['code'] == 'EXTRA_PAYMENT_REQUIRED', (st, j))
        st, qo = quota(TO)
        rec('S-05 scope=all — quota.current = 이번 달 받은 코드(매물 없이)', qo['current'] and qo['current']['code'] == codeAll and qo['scope'] == 'all', qo)
        PK3 = 'stub_' + uuid.uuid4().hex
        st, j = issue(TO, {'count': 2, 'paymentKey': PK3, 'amount': 60000})
        rec('S-06 scope=all — 추가 2건 = 60,000원 한 번 결제 → 2건 · 같은 결제키',
            st in (200, 201) and len(j) == 2 and all(x['isExtra'] and x['paid'] and x['listingId'] is None for x in j)
            and q(f"select count(*) from referral_codes where extra_payment_key='{PK3}'") == '2'
            and q(f"select amount from referral_code_payments where payment_key='{PK3}'") == '60000', (st, j))
    finally:
        st, j = set_scope('listing')
        rec('S-07 refcode.scope 를 listing 으로 되돌림', st < 300 and q("select value from site_settings where key='refcode.scope'") == 'listing', (st, j))
    st, j = issue(TO)
    rec('S-08 되돌린 뒤 — 매물 없이 발급은 다시 422 LISTING_REQUIRED', st == 422 and j['code'] == 'LISTING_REQUIRED', (st, j))
    PK3 = q(f"select extra_payment_key from referral_codes where owner_account_id='{O}' and is_extra limit 1")

    # ───────────────────────── T. 유입 기록 ─────────────────────────
    V = str(uuid.uuid4())
    st, j = touch(codeA1, V)
    rec('T-01 공유 링크 비로그인 방문 → recorded:true · attribution_events 1건', st == 200 and j['recorded'] and j['windowDays'] == 90
        and ev_count(codeA1, V) == 1, j)
    st, j = touch(codeA1.lower(), V)
    rec('T-02 24시간 안 재방문(소문자 코드) → recorded:false DUPLICATE · 여전히 1건', st == 200 and j == {'recorded': False, 'reason': 'DUPLICATE'}
        and ev_count(codeA1, V) == 1, j)
    ok, er = qerr(f"insert into attribution_events(code,visitor_key,expires_at) values ('{codeA1}','{V}',now()+interval '90 days')")
    rec('T-03 DB: 같은 방문자 · 같은 코드 24시간 안 직접 INSERT → 트리거가 막음(ATTR_DUP)', not ok and 'ATTR_DUP' in er, er[:120])
    V2 = str(uuid.uuid4()); out = []
    th = [threading.Thread(target=lambda: out.append(touch(codeA1, V2))) for _ in range(6)]
    [t.start() for t in th]; [t.join() for t in th]
    rec('T-04 같은 방문자 동시 6번 → 1번만 기록', sum(1 for s, j in out if j and j.get('recorded')) == 1 and ev_count(codeA1, V2) == 1,
        [j for s, j in out])

    st, j = touch(codeA1, str(uuid.uuid4()), tok=TA)
    rec('T-05 코드 주인이 로그인 상태로 자기 링크 → recorded:false SELF', j == {'recorded': False, 'reason': 'SELF'}, j)
    VA = str(uuid.uuid4()); login(eA, visitor=VA)
    st, j = touch(codeA1, VA)
    rec('T-06 주인 계정과 연결된 방문자 키(비로그인) → SELF', j == {'recorded': False, 'reason': 'SELF'} and ev_count(codeA1, VA) == 0, j)

    revoked = q(f"select code from referral_codes where extra_payment_key='{PK3}' limit 1")
    q(f"update referral_codes set revoked_at=now() where code='{revoked}'")
    st, j = touch(revoked, str(uuid.uuid4()))
    rec('T-07 폐기 코드 → recorded:false INVALID_CODE (오류 아님)', st == 200 and j == {'recorded': False, 'reason': 'INVALID_CODE'} and ev_count(revoked) == 0, j)
    st, j = touch('NOPE99', str(uuid.uuid4()))
    rec('T-08 없는 코드 → recorded:false INVALID_CODE', st == 200 and j['recorded'] is False and j['reason'] == 'INVALID_CODE', j)
    st, j = touch('a-b', str(uuid.uuid4()))
    st2, j2 = touch(codeA1, None)
    st3, j3 = touch(codeA1, 'short')
    st4, j4 = call('POST', '/attribution/touch', None, {'code': codeA1, 'landingUrl': 'javascript:alert(1)'}, {'X-Visitor-Key': str(uuid.uuid4())})
    rec('T-09 형식 오류(코드 · 방문자 키 없음 · 짧은 키 · landingUrl) → 400', (st, st2, st3, st4) == (400, 400, 400, 400), (j, j2, j3, j4))
    st, j = touch(codeA1, str(uuid.uuid4()), ua='facebookexternalhit/1.1')
    rec('T-10 링크 미리보기 로봇 → recorded:false BOT', j == {'recorded': False, 'reason': 'BOT'}, j)
    TB = login('buyer@x.com', 'sgb-dev-1234'); VB = str(uuid.uuid4())
    st, j = touch(codeA1, VB, tok=TB)
    rec('T-11 로그인 방문자 → 계정도 기록(account_id)', j['recorded'] and q(f"select account_id from attribution_events where visitor_key='{VB}'") == q("select id from accounts where email='buyer@x.com'"), j)

    # 유입 → 가입 → 문의 → 거래 생성 : 소개자 = 코드 주인 (코드의 매물 = 문의한 매물)
    eV, TV, VACC = signup('rcV', visitor=V)
    rec('T-12 그 방문자가 가입(visitorKey) → visitor_identities 연결', q(f"select count(*) from visitor_identities where visitor_key='{V}' and account_id='{VACC}'") == '1')

    # ── D012 귀속 판정을 매물에 맞춤 — A 매물 코드로 들어온 사람이 B 매물에 문의하면 소개자 없음 ──
    st, dB, _ = inquire_and_deal(TV, L2, TS_2)
    rec('L-13 A 매물 코드 유입 → **B 매물** 문의 · 거래: 소개자 · 귀속 코드 없음',
        st in (200, 201) and dB['attributedCode'] is None and deal_intro(dB) == '-|-', (st, dB, deal_intro(dB)))
    st, d, conv = inquire_and_deal(TV)
    intro = deal_intro(d) if st in (200, 201) else ''
    rec('T-13 A 매물 코드 유입 → **A 매물** 문의 → 거래 생성 시 deals.introducer_account_id = 코드 주인 · attributed_code = 코드',
        st in (200, 201) and d['attributedCode'] == codeA1 and intro == f'{A}|{codeA1}', (st, d, intro))
    r1 = q(f"select coalesce((select code from fn_attribution_resolve_listing('{VACC}','{L}',now(),1)),'-')||'|'||coalesce((select code from fn_attribution_resolve_listing('{VACC}','{L2}',now(),1)),'-')||'|'||coalesce((select code from fn_attribution_resolve('{VACC}',now(),1)),'-')")
    rec('L-14 DB 함수 — 매물용 판정: A 매물=코드 · B 매물=없음 · 기존 계정 단위 판정(fn_attribution_resolve)은 그대로',
        r1 == f'{codeA1}|-|{codeA1}', r1)
    t_before = q(f"select to_char((select min(occurred_at) from attribution_events where code='{codeA1}') - interval '1 second','YYYY-MM-DD HH24:MI:SS.USOF')")
    r2 = q(f"select count(*) from fn_attribution_resolve_listing('{VACC}','{L}','{t_before}'::timestamptz,1)")
    r3 = q(f"select string_agg(code,',') from (select code from fn_attribution_resolve_listing('{VACC}','{L}',now(),1) union all select code from fn_attribution_resolve_listing('{VACC}','{L}',now(),1)) x")
    rec('L-15 재현성 — 유입 전 시점(at)으로 판정하면 없음 · 같은 입력은 같은 결과', r2 == '0' and r3 == f'{codeA1},{codeA1}', (r2, r3))

    # 먼저 B 매물 코드(다른 회원), 나중에 A 매물 코드 → A 매물 문의는 A 매물 코드 주인 (first-touch 는 그 매물 코드 안에서)
    eP, TP, P = signup('rcP')
    call('POST', '/verifications/identity', TP, {'provider': 'PASS'})
    st, jp = issue(TP, {'listingId': L2}); codeP = jp[0]['code']
    V8 = str(uuid.uuid4())
    touch(codeP, V8); time.sleep(1.1); touch(codeA1, V8)
    eX, TX, X = signup('rcX', visitor=V8)
    st, dx, _ = inquire_and_deal(TX)
    st2, dx2, _ = inquire_and_deal(TX, L2, TS_2)
    rec('L-16 B 매물 코드(먼저) · A 매물 코드(나중) 유입 → A 매물 거래 소개자 = A 코드 주인 · B 매물 거래 소개자 = B 코드 주인',
        st in (200, 201) and deal_intro(dx) == f'{A}|{codeA1}' and st2 in (200, 201) and deal_intro(dx2) == f'{P}|{codeP}', (deal_intro(dx), deal_intro(dx2)))

    # 성사 확정 때의 판정(fn_assert_attribution_snapshot)도 매물용 함수를 씁니다 — 그 거래 시점 · 정책으로 다시 판정
    r4 = q(f"""select (select code from fn_attribution_resolve_listing(d.buyer_account_id, d.listing_id, d.created_at, 1))||'|'||
                        (select code from fn_attribution_resolve(d.buyer_account_id, d.created_at, 1))
                   from deals d where d.id='{dx['dealId']}'""")
    src_ok = q("select prosrc like '%fn_attribution_resolve_listing(NEW.buyer_account_id, NEW.listing_id, NEW.created_at, pol)%' from pg_proc where proname='fn_assert_attribution_snapshot'")
    rec('L-22 확정 시점 판정 = 매물용 함수(A 매물 거래 → A 코드. 계정 단위 판정이면 먼저 본 B 코드가 찍혔을 것)',
        r4 == f'{codeA1}|{codeP}' and src_ok == 't', (r4, src_ok))

    # 옛 코드 · scope=all 코드(listing_id NULL)는 전처럼 모든 매물
    V9 = str(uuid.uuid4())
    touch(codeAll, V9)
    eY, TY, Y = signup('rcY', visitor=V9)
    st, dy, _ = inquire_and_deal(TY)
    st2, dy2, _ = inquire_and_deal(TY, L2, TS_2)
    rec('L-17 매물에 안 묶인 코드(옛 코드 · scope=all) 유입 → 어느 매물 문의든 소개자 = 코드 주인(전처럼)',
        st in (200, 201) and deal_intro(dy) == f'{O}|{codeAll}' and st2 in (200, 201) and deal_intro(dy2) == f'{O}|{codeAll}', (deal_intro(dy), deal_intro(dy2)))

    V3 = str(uuid.uuid4())
    eW, TW, W = signup('rcW')
    st, j = touch(codeA1, V3)
    TW2 = login(eW, visitor=V3)   # 기존 회원이 링크를 열고 로그인
    st, d2, _ = inquire_and_deal(TW2)
    rec('T-14 기존 회원이 링크로 들어와 로그인 후 문의 → 소개자 = 코드 주인',
        st in (200, 201) and d2['attributedCode'] == codeA1 and q(f"select introducer_account_id from deals where id='{d2['dealId']}'") == A, (st, d2))

    # 본인 코드로 자기 유입(새 브라우저 → 로그인) → 자기 거래에 자기 소개자 안 붙음
    V4 = str(uuid.uuid4())
    eS, TS2, S = signup('rcS')
    call('POST', '/verifications/identity', TS2, {'provider': 'PASS'})
    st, js = issue(TS2, {'listingId': L}); codeS = js[0]['code']
    st, j = touch(codeS, V4)               # 아직 연결 안 된 새 방문자 키라 기록은 됩니다
    TS3 = login(eS, visitor=V4)
    st, d3, _ = inquire_and_deal(TS3)
    rec('T-15 본인 코드 → 자기 문의 거래에 소개자 없음 (판정에서 자기 유입 제외 — DB 함수)',
        st in (200, 201) and d3['attributedCode'] is None and q(f"select coalesce(introducer_account_id::text,'-') from deals where id='{d3['dealId']}'") == '-', (j, st, d3))

    st, codes2 = call('GET', '/me/referral-codes', TA)
    c1 = next((c for c in codes2 if c['code'] == codeA1), {})
    rec('T-16 내 소개코드 touches = 기록된 유입 수', c1.get('touches') == ev_count(codeA1) and c1.get('touches', 0) >= 4, (c1.get('touches'), ev_count(codeA1)))

    dup = q("""select count(*) from attribution_events a join attribution_events b on a.code=b.code and a.visitor_key=b.visitor_key and a.id<b.id
              and a.source='INTRO' and b.source='INTRO' and b.occurred_at < a.occurred_at + interval '24 hours'""")
    rec('T-17 불변식: 24시간 안 같은 방문자 · 같은 코드 중복 유입 0', dup == '0', dup)
    inv = q("""select count(*) from referral_codes rc join subscriptions s on s.id=rc.subscription_id join subscription_plans p on p.code=s.plan_code
              where rc.is_extra and p.monthly_price=0 and rc.extra_payment_key is null
                and rc.issued_at > (select applied_at from schema_migrations where name='D010_refcode_member_attribution')""")
    rec('T-18 불변식: D010 이후 무료 요금제 초과 코드는 모두 결제키 있음', inv == '0', inv)
    over = q("""select count(*) from referral_code_payments p where (select count(*) from referral_codes rc where rc.extra_payment_key=p.payment_key) > p.code_count""")
    rec('T-19 불변식: 결제 1건으로 받은 코드 수 ≤ 결제 건수', over == '0', over)
    rec('L-18 불변식: 다른 매물에 묶인 코드가 귀속된 거래 0 (v_deal_refcode_listing_mismatch)', q('select count(*) from v_deal_refcode_listing_mismatch') == '0')
    dupl = q("select count(*) from (select 1 from referral_codes where listing_id is not null and revoked_at is null group by owner_account_id, listing_id having count(*) > 1) x")
    rec('L-19 불변식: 같은 회원 · 같은 매물의 살아 있는 코드 2개 이상 0', dupl == '0', dupl)

    # ── 재로그인 귀속 (D011 · 10/2 결정 「반영」) — 예전에 로그인했던 브라우저에서 로그아웃 상태로 링크를 열고 다시 로그인 ──
    V7 = str(uuid.uuid4())
    eR, TR0, RACC = signup('rcR', visitor=V7)          # 이 브라우저(V7)로 가입 — 연결 1줄
    n0 = int(q(f"select count(*) from visitor_identities where visitor_key='{V7}' and account_id='{RACC}'"))
    TR1 = login(eR, visitor=V7)                         # 유입 없이 다시 로그인 → 연결이 늘지 않아야 합니다
    n1 = int(q(f"select count(*) from visitor_identities where visitor_key='{V7}' and account_id='{RACC}'"))
    rec('T-21 유입 없는 재로그인은 연결을 늘리지 않음', n0 == 1 and n1 == 1, (n0, n1))
    time.sleep(1.1)
    st, j = touch(codeA1, V7)                           # 로그아웃 상태로 소개 링크를 엶
    TR2 = login(eR, visitor=V7)                         # 다시 로그인
    n2 = int(q(f"select count(*) from visitor_identities where visitor_key='{V7}' and account_id='{RACC}'"))
    st, dR, _ = inquire_and_deal(TR2)
    rec('T-22 로그아웃 상태로 링크 → 다시 로그인 → 문의: 소개자 = 코드 주인 (전에는 빠짐)',
        j.get('recorded') and n2 == 2 and st in (200, 201) and dR['attributedCode'] == codeA1
        and q(f"select introducer_account_id from deals where id='{dR['dealId']}'") == A, (j, n2, st, dR))

    # ── 보험·의료(소개 금지 업종) 매물: 소개 링크로 들어와도 거래는 만들어지고 소개자만 비움 (10/2 통합 수정) ──
    #    매물에 안 묶인 코드(codeAll)로 들어옵니다 — 매물이 달라서가 아니라 **업종 때문에** 소개자가 비는지 봅니다.
    GL = q("select l.id from listings l where fn_category_no_intro(l.category_id) and l.owner_account_id=(select id from accounts where email='seller@x.com') order by l.created_at limit 1")
    if GL:
        gst = q(f"select status from listings where id='{GL}'")
        q(f"update listings set status='PUBLISHED', published_at=coalesce(published_at,now()) where id='{GL}'")
        try:
            V6 = str(uuid.uuid4())
            eG, TG, G = signup('rcG', visitor=V6)
            touch(codeAll, V6)
            call('POST', '/verifications/identity', TG, {'provider': 'PASS'})
            st, jg = issue(TG, {'listingId': GL})
            stq, qg = quota(TG, GL)
            rec('L-20 보험·의료 매물에는 소개코드 발급 불가 → 422 NO_INTRO_CATEGORY · quota.blocked · 코드 없음',
                st == 422 and jg['code'] == 'NO_INTRO_CATEGORY' and qg['blocked'] == 'NO_INTRO_CATEGORY'
                and q(f"select count(*) from referral_codes where listing_id='{GL}'") == '0', (st, jg, qg.get('blocked')))
            sub_g = q(f"select id from subscriptions where account_id='{A}' and status='ACTIVE'")
            okg, erg = qerr(f"insert into referral_codes(code,owner_account_id,subscription_id,listing_id) values ('QS{uuid.uuid4().hex[:6].upper()}','{A}','{sub_g}','{GL}')")
            rec('L-21 DB: 보험·의료 매물에 묶인 코드 INSERT → 차단(trg_refcode_listing_guard)', not okg and 'REFCODE' in erg, erg[:120])
            st, cv = call('POST', '/conversations', TG, {'targetType': 'LISTING', 'targetId': GL, 'message': '보험 상담 문의드립니다. 가능할까요?'})
            TSL = call('POST', '/auth/login', body={'email': 'seller@x.com', 'password': 'sgb-dev-1234'})[1]['accessToken']
            st2, dg = call('POST', f"/conversations/{cv['conversationId']}/deal", TSL) if st < 300 else (st, cv)
            rec('T-20 보험·의료 매물: 소개 링크로 왔어도 거래 생성 성공 · 소개자 · 귀속 코드 없음(의료법 27조)',
                st2 in (200, 201) and dg.get('attributedCode') is None
                and q(f"select coalesce(introducer_account_id::text,'-') from deals where id='{dg.get('dealId')}'") == '-'
                and q(f"select count(*) from fn_attribution_resolve_listing('{G}','{GL}',now(),1)") == '0', (st, st2, dg))
        finally:
            q(f"update listings set status='{gst}' where id='{GL}'")
    else:
        rec('T-20 보험·의료 매물 시험 (해당 매물 없음 — 건너뜀)', True, 'skip')


try:
    main()
finally:
    # 공용 설정은 시험이 어디서 끝나든 listing 으로 되돌립니다
    set_scope('listing')
    if BASIC_CODES is not None:
        q(f"update subscription_plans set included_codes = {int(BASIC_CODES)} where code='BASIC'")
        rec('P-99 끝 — BASIC 포함 소개코드를 시안 값으로 되돌림', q("select included_codes from subscription_plans where code='BASIC'") == BASIC_CODES)
    rec('S-99 끝 — 공용 설정 refcode.scope = listing', q("select value from site_settings where key='refcode.scope'") == 'listing')
    json.dump({'pass': sum(r['ok'] for r in R), 'total': len(R), 'items': R},
              open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_refcode.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
