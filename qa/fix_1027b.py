"""v10.27 — 거래 흐름(G-193) · 구독 예약(G-189 ③) · 가입 동의(G-188) · 작은 결함(G-201) 서버 확인.

  G-193-①  계약서 요청: 같은 대화에 두 번 눌러도 거래는 하나(existing:true)
  G-193-②  받은 문의 · 보낸 문의 목록(/me/conversations) · 읽음 표시 · 이름 가림
  G-193-③  /me/deals 에 다음 단계 표시(내가 확정했는지 · 대금 신고 · 후기)
  G-193-④  매물 내리기(POST /listings/:id/archive) · 남의 매물 404 · 다시 올리기 = 수정 → 재검수
시험이 만든 매물은 끝에 ARCHIVED 로 둡니다(지우지 않음 — 감사 기록 유지). 계정(fx7b_*@t.local)은 남습니다.
사용:  python3 fix_1027b.py [part...]     결과 fix_1027b.json
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import *

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
R = []
def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), step, '|', str(detail)[:220], file=sys.stderr, flush=True)
def safe(name, fn):
    try: fn()
    except Exception as ex: rec(f'{name} 실행 중 오류', False, repr(ex)[:300])

PARTS = set(sys.argv[1:]) or {'g193', 'g188', 'g195', 'g213', 'g201', 'g189', 'g127', 'g120'}
ADM = login('admin@x.com'); tag = uuid.uuid4().hex[:6]

def new_listing(tok, title):
    cat = q("select id from categories where gwan_code='MNY' and status='APPROVED' and restricted_code is null limit 1")
    st, j = call('POST', '/listings', tok, {'gwanCode': 'MNY', 'categoryId': cat, 'title': title,
                 'body': '수정 확인 시험용 매물입니다. 사무실 인테리어 업체를 소개받습니다.', 'desiredFee': 300000, 'feeBearer': 'SELLER'})
    if isinstance(j, dict) and j.get('reviewId') and j.get('status') != 'PUBLISHED':
        call('PATCH', f"/admin/reviews/{j['reviewId']}", ADM, {'decision': 'APPROVED'})
    return st, (j or {}).get('listingId'), cat

def g193():
    SEL = login('intro@x.com')
    em, pw, BUY, bid = signup('fx7b', '문의 확인')
    call('POST', '/verifications/identity', BUY, {'provider': 'PASS'})
    st, lid, cat = new_listing(SEL, f'거래흐름 확인 {tag}')
    rec('준비 — 시험 매물 게시', st < 300 and q(f"select status from listings where id='{lid}'") == 'PUBLISHED', (st, lid))

    st, c = call('POST', '/conversations', BUY, {'targetType': 'LISTING', 'targetId': lid, 'message': f'문의 드립니다 {tag}'})
    cid = (c or {}).get('conversationId')
    # ② 받은 문의 · 보낸 문의
    st, rcv = call('GET', f'/me/conversations?role=RECEIVED&listingId={lid}', SEL)
    one = (rcv or [{}])[0] if isinstance(rcv, list) and rcv else {}
    rec('G-193-2a 판매자 「받은 문의」에 새 문의가 보임(제목 · 마지막 글 · 안 읽음 1)',
        st == 200 and one.get('id') == cid and one.get('role') == 'RECEIVED' and one.get('unread') == 1 and tag in (one.get('lastBody') or ''), (st, one))
    rec('G-193-2b 상대 이름은 첫 글자만(○○) — 실명 · 이메일이 응답에 없음',
        (one.get('counterpartName') or '').endswith('○○') and em not in json.dumps(rcv, ensure_ascii=False), one.get('counterpartName'))
    st, snt = call('GET', '/me/conversations?role=SENT', BUY)
    rec('G-193-2c 구매자 「보낸 문의」에 같은 대화가 보임', st == 200 and any(x.get('id') == cid and x.get('role') == 'SENT' for x in (snt or [])), st)
    st, rcv2 = call('GET', '/me/conversations?role=RECEIVED', BUY)
    rec('G-193-2d 구매자 「받은 문의」에는 그 대화가 없음(역할 거름)', st == 200 and not any(x.get('id') == cid for x in (rcv2 or [])), st)
    st, msgs = call('GET', f'/conversations/{cid}/messages', SEL)
    st2, after = call('GET', f'/me/conversations?id={cid}', SEL)
    rec('G-193-2e 판매자가 대화를 열면 읽음 처리 — 안 읽음 0 · 내 글 여부(mine) 표시',
        st == 200 and st2 == 200 and after and after[0].get('unread') == 0 and msgs and msgs[0].get('mine') is False, (st, (after or [{}])[0].get('unread')))
    st, oth = call('GET', f'/me/conversations?id={cid}', login('buyer@x.com'))
    rec('G-193-2f 당사자가 아닌 회원은 그 대화를 못 봄(빈 목록)', st == 200 and oth == [], (st, oth))
    st, _ = call('GET', '/me/conversations?listingId=not-a-uuid', SEL)
    rec('G-193-2g 잘못된 listingId 는 무시(500 아님)', st == 200, st)

    # ① 계약서 요청 = 거래 만들기 — 두 번 눌러도 하나
    st, d1 = call('POST', f'/conversations/{cid}/deal', SEL)
    st2, d2 = call('POST', f'/conversations/{cid}/deal', SEL)
    n = q(f"select count(*) from deals where conversation_id='{cid}'")
    rec('G-193-1 계약서 요청을 두 번 눌러도 거래는 1건 — 두 번째는 existing:true',
        st < 300 and st2 < 300 and d1.get('dealId') == d2.get('dealId') and d2.get('existing') is True and n == '1', (st, st2, n))
    did = d1.get('dealId')
    st, after = call('GET', f'/me/conversations?id={cid}', SEL)
    rec('G-193-2h 문의 목록에 거래 번호가 붙음(거래로 이어짐)', after and after[0].get('dealId') == did, (after or [{}])[0].get('dealId'))

    # ③ /me/deals 다음 단계 표시
    st, ds = call('GET', '/me/deals', BUY)
    d = next((x for x in (ds or []) if x.get('id') == did), {})
    rec('G-193-3a 내 거래에 제목 · 매물 · 대화 · 단계 표시(iConfirmed/paymentReported/iReviewed) 가 옴',
        d.get('title') and d.get('listingId') == lid and d.get('conversationId') == cid
        and d.get('iConfirmed') is False and d.get('paymentReported') is False and d.get('iReviewed') is False, d)
    st, _ = call('POST', f'/deals/{did}/confirm', BUY)
    st2, ds = call('GET', '/me/deals', BUY)
    d = next((x for x in (ds or []) if x.get('id') == did), {})
    rec('G-193-3b 구매자가 확정을 누르면 iConfirmed=true', d.get('iConfirmed') is True, (st, d.get('status')))

    # ④ 내리기
    st, a = call('POST', f'/listings/{lid}/archive', BUY)
    rec('G-193-4a 남의 매물은 내릴 수 없음', st in (403, 404), st)
    st, a = call('POST', f'/listings/{lid}/archive', SEL)
    rec('G-193-4b 주인이 내리면 ARCHIVED', st < 300 and a.get('status') == 'ARCHIVED' and q(f"select status from listings where id='{lid}'") == 'ARCHIVED', (st, a))
    st, pub = call('GET', f'/listings/{lid}')
    rec('G-193-4c 내린 매물은 공개 상세에서 안 보임', st in (404, 410) or (isinstance(pub, dict) and pub.get('status') == 'ARCHIVED'), st)
    st, a2 = call('POST', f'/listings/{lid}/archive', SEL)
    rec('G-193-4d 다시 눌러도 그대로 ARCHIVED(오류 아님)', st < 300 and a2.get('status') == 'ARCHIVED', st)
    st, my = call('GET', '/me/listings', SEL)
    row = next((x for x in (my or []) if x.get('id') == lid), {})
    ver = row.get('version')
    st, up = call('PATCH', f'/listings/{lid}', SEL, {'version': ver, 'gwanCode': 'MNY', 'categoryId': cat,
                  'title': f'거래흐름 확인 {tag} 다시', 'body': '수정 확인 시험용 매물입니다. 다시 올립니다.', 'desiredFee': 300000, 'feeBearer': 'SELLER'})
    rec('G-193-4e 수정해서 다시 올리면 재검수(IN_REVIEW) 또는 자동 통과(PUBLISHED)', st < 300 and up.get('status') in ('IN_REVIEW', 'PUBLISHED'), (st, up))
    call('POST', f'/listings/{lid}/archive', SEL)
    sus = q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='intro@x.com' and l.status='SUSPENDED' limit 1")
    if sus:
        st, _ = call('POST', f'/listings/{sus}/archive', SEL)
        rec('G-193-4f 운영자가 정지한 매물은 주인도 못 내림(409)', st == 409, st)
    else:
        rec('G-193-4f 운영자가 정지한 매물은 주인도 못 내림(409)', True, '정지 매물 없음', skip=True)

if 'g193' in PARTS: safe('G-193', g193)

def g188():
    req = [r[0] for r in rows("select code from terms where status='PUBLISHED' and is_required and audience='ALL'")]   # v10.31 (D090) — 가입 때는 전체 대상 약관만(파트너 이용약관 PARTNER 는 입점 뒤)
    opt = [r[0] for r in rows("select code from terms where status='PUBLISHED' and not is_required and not is_notice and audience='ALL'")]      # v10.28 (G-218) — 알림(위탁)은 동의 항목이 아님
    base = {'password': 'Sgb-fx7b-1234!', 'name': '동의 확인'}
    st, j = call('POST', '/auth/signup', None, {**base, 'email': f'fx7b_t1_{tag}@t.local', 'agreedTerms': req[:-1]})
    rec('G-188-1 필수 약관 하나라도 빠지면 가입 거절(422 REQUIRED_TERM) · 계정 안 만들어짐',
        st == 422 and (j or {}).get('code') == 'REQUIRED_TERM' and q(f"select count(*) from accounts where email='fx7b_t1_{tag}@t.local'") == '0', (st, j))
    st, j = call('POST', '/auth/signup', None, {**base, 'email': f'fx7b_t2_{tag}@t.local', 'agreedTerms': req + ['NOPE_TERM']})
    rec('G-188-2 발행되지 않은 약관 코드는 거절(422)', st == 422, (st, (j or {}).get('code')))
    em = f'fx7b_t3_{tag}@t.local'
    st, j = call('POST', '/auth/signup', None, {**base, 'email': em, 'agreedTerms': req + opt[:1]})
    aid = q(f"select id from accounts where email='{em}'")
    got = dict(rows(f"select term_code, agreed::text from term_agreements where account_id='{aid}'"))
    rec('G-188-3 필수 + 선택 1개 동의 → 발행 약관마다 한 줄(필수 · 고른 선택 = 동의, 안 고른 선택 = 거부)',
        st < 300 and set(got) == set(req + opt) and all(got[c] == 'true' for c in req + opt[:1]) and all(got[c] == 'false' for c in opt[1:]), (st, got))
    rec('G-188-4 이 회원은 「필수 약관 미동의」 목록(v_term_not_agreed)에 없음',
        q(f"select count(*) from v_term_not_agreed where account_id='{aid}'") == '0', '')
    st, j = call('POST', '/auth/signup', None, {**base, 'email': f'fx7b_t4_{tag}@t.local', 'agreedTerms': 'SERVICE'})
    rec('G-188-5 형식이 틀리면(문자열) 422', st in (400, 422), st)
    st, j = call('POST', '/auth/signup', None, {**base, 'email': f'fx7b_t5_{tag}@t.local'})
    st, j = call('POST', '/auth/signup', None, {**base, 'email': f'fx7b_t6_{tag}@t.local', 'agreedTerms': []})
    rec('G-188-7 빈 목록([])도 예전처럼 가입(기존 시험 호환) — 기록 없음', st < 300 and q(f"select count(*) from term_agreements g join accounts a on a.id=g.account_id where a.email='fx7b_t6_{tag}@t.local'") == '0', st)
    rec('G-188-6 agreedTerms 없이 부르면 예전처럼 가입(API 호환) — 기록 없음', st < 300 and q(f"select count(*) from term_agreements g join accounts a on a.id=g.account_id where a.email='fx7b_t5_{tag}@t.local'") == '0', st)

if 'g188' in PARTS: safe('G-188', g188)

def g195():
    tok = login('intro@x.com'); aid = q("select id from accounts where email='intro@x.com'")
    st, h = call('GET', '/me/home', tok)
    exp = {
        'openDeals': q(f"select count(*) from deals where '{aid}' in (buyer_account_id,seller_account_id,introducer_account_id) and status not in ('CONFIRMED','SETTLED','CANCELLED')"),
        'closedDeals': q(f"select count(*) from deals where '{aid}' in (buyer_account_id,seller_account_id,introducer_account_id) and status in ('CONFIRMED','SETTLED')"),
        'settlePending': q(f"select count(*) from settlements where payee_account_id='{aid}' and status in ('REQUESTED','HELD')"),
        'earned': q(f"select coalesce(sum(amount),0)::bigint from settlements where payee_account_id='{aid}' and status='PAID'"),
        'favorites': q(f"select count(*) from favorites where account_id='{aid}'"),
    }
    diff = {k: (h.get(k), v) for k, v in exp.items() if str(h.get(k)) != v}
    rec('G-195-1 나의공간 첫 화면 숫자(/me/home)가 DB 와 같음 — 진행 중 · 성사 · 정산 대기 · 누적 수익 · 관심', st == 200 and not diff, diff or st)
    st, _ = call('GET', '/me/home', None)
    rec('G-195-2 로그인 없이 /me/home 은 막힘', st in (401, 403), st)

if 'g195' in PARTS: safe('G-195', g195)

def g213():
    # 거래 당사자가 아닌 회원의 대금 신고 — 고치기 전에는 아무 회원이나 남의 거래에 신고를 남기고 상태를 바꿀 수 있었음
    did = q("select id from deals where status in ('CONTRACTED','INQUIRY') and buyer_account_id <> (select id from accounts where email='buyer@x.com') and seller_account_id <> (select id from accounts where email='buyer@x.com') and coalesce(introducer_account_id::text,'') <> (select id::text from accounts where email='buyer@x.com') limit 1")
    before = q(f"select count(*) from deal_payment_records where deal_id='{did}'"); st0 = q(f"select status from deals where id='{did}'")
    st, j = call('POST', f'/deals/{did}/payment-report', login('buyer@x.com'), {'method': 'CASH', 'memo': '당사자 아님 시험'})
    rec('G-213-1 거래 당사자가 아니면 대금 신고가 막힘(403 · 기록 없음 · 상태 그대로)', st in (403, 409) and q(f"select count(*) from deal_payment_records where deal_id='{did}'") == before
        and q(f"select status from deals where id='{did}'") == st0, (st, (j or {}).get('code')))

    # 시험용 거래 하나 — intro(판매) · 새 회원(구매) · 판매자가 계약서 발급
    SEL = login('intro@x.com')
    em, pw, BUY, bid = signup('fx7b', '계약 확인')
    call('POST', '/verifications/identity', BUY, {'provider': 'PASS'})
    lid = q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='intro@x.com' and l.status='PUBLISHED' limit 1")
    if not lid:   # v10.27(2) — 새로 만든 DB · 오래 쓴 Docker DB 에는 intro 의 공개 매물이 없을 수 있음 → 시험이 만듦
        _, lid, _ = new_listing(SEL, f'계약 확인 시험 매물 {tag}')
    st, cv = call('POST', '/conversations', BUY, {'targetType': 'LISTING', 'targetId': lid, 'message': f'계약 확인 {tag}'})
    st, d = call('POST', f"/conversations/{cv['conversationId']}/deal", SEL)
    did2 = d['dealId']
    T = login('buyer@x.com')
    st, j = call('POST', f'/deals/{did2}/contract', login('seller@x.com'), {'templateCode': 'STD_V1'})
    rec('G-213-4 당사자가 아닌 사업자(seller@x.com)는 남의 거래에 계약서를 발급 못 함(403 · 계약서 없음)', st == 403 and q(f"select count(*) from deal_contracts where deal_id='{did2}'") == '0', st)
    st, j = call('POST', f'/deals/{did2}/contract', SEL, {'templateCode': 'STD_V1'})
    rec('G-213-5 당사자(판매자)는 계약서 발급', st < 300 and q(f"select count(*) from deal_contracts where deal_id='{did2}'") == '1', (st, str(j)[:120]))
    for path, name in [(f'/deals/{did2}/contract/state', '계약 상태'), (f'/deals/{did2}/contract/history', '계약 이력(당사자 실명)'), (f'/deals/{did2}/contract/esign', '전자서명 상태')]:
        st, j = call('GET', path, T)
        rec(f'G-213-2 당사자가 아니면 {name} 을(를) 못 봄(403)', st == 403, (st, str(j)[:80]))
    st, _ = call('GET', f'/deals/{did2}/contract/state', BUY)
    rec('G-213-3 당사자(구매자)는 계약 상태를 그대로 봄(200)', st == 200, st)

if 'g213' in PARTS: safe('G-213', g213)

def g201():
    pid = q("select id from posts where state='PUBLISHED' order by created_at desc limit 1")
    if not pid:   # v10.27(2) — 공개 글이 없는 DB 에서는 시험 글을 하나 써서 공개(끝에 지움)
        _em, _pw, tokP, aidP = signup('fx7b', '가림 확인')
        st, j = call('POST', '/me/community/posts', tokP, {'board': 'QNA', 'title': f'가림 확인 {tag}', 'body': '운영 글 가림의 사유 확인용 시험 글입니다.'})
        pid = (j or {}).get('id') or q(f"select id from posts where author_id='{aidP}' order by created_at desc limit 1")
        if q(f"select state from posts where id='{pid}'") == 'PENDING': call('POST', f'/admin/community/posts/{pid}/approve', ADM)
    st, j = call('POST', f'/admin/community/posts/{pid}/hide', ADM, {'reason': '  '})
    rec('G-201-h1 운영 글 가림 — 사유가 비면 422 REASON_REQUIRED(전: 201 에 ok:false) · 글 그대로', st == 422 and (j or {}).get('code') == 'REASON_REQUIRED'
        and q(f"select state from posts where id='{pid}'") == 'PUBLISHED', (st, j))
    if 'tokP' in dir(): call('DELETE', f'/me/community/posts/{pid}', tokP)   # 만든 시험 글은 지움
    st, j = call('POST', '/admin/community/posts/00000000-0000-0000-0000-000000000000/hide', ADM, {'reason': '시험'})
    rec('G-201-h2 없는 글을 가리면 404(전: 201 에 ok:false)', st == 404, st)
    # 글쓴이 본인 조회는 조회 수에 안 셈 — 시험 회원이 글을 쓰고(첫 글 검수 → 운영 승인) 본인 · 남이 차례로 엶
    em, pw, tokA, aid = signup('fx7b', '조회 확인')
    st, j = call('POST', '/me/community/posts', tokA, {'board': 'QNA', 'title': f'조회 수 확인 {tag}', 'body': '글쓴이 본인 조회는 조회 수에 세지 않는지 확인하는 시험 글입니다.'})
    mp = (j or {}).get('id') or q(f"select id from posts where author_id='{aid}' order by created_at desc limit 1")
    if q(f"select state from posts where id='{mp}'") == 'PENDING': call('POST', f'/admin/community/posts/{mp}/approve', ADM)
    v0 = q(f"select views from posts where id='{mp}'")
    call('GET', f'/community/posts/{mp}', tokA)
    v1 = q(f"select views from posts where id='{mp}'")
    call('GET', f'/community/posts/{mp}', login('buyer@x.com'))
    v2 = q(f"select views from posts where id='{mp}'")
    rec('G-201-i 글쓴이 본인이 열면 조회 수 그대로 · 다른 회원이 열면 +1', v0 != '' and v0 == v1 and int(v2) == int(v1) + 1, (st, v0, v1, v2))
    call('DELETE', f'/me/community/posts/{mp}', tokA)
    # 대금 신고 응답에 거래 상태
    did = q("select d.id from deals d join accounts a on a.id=d.buyer_account_id where a.email='buyer@x.com' and d.status='CONFIRMED' limit 1")
    if did:
        st, j = call('POST', f'/deals/{did}/payment-report', login('buyer@x.com'), {'method': 'BANK_TRANSFER', 'memo': 'G-201 확정 뒤 신고'})
        rec('G-201-a 확정된 거래에 대금 신고 → 응답에 dealStatus=CONFIRMED(화면 안내를 상태에 맞춤)', st < 300 and (j or {}).get('dealStatus') == 'CONFIRMED', (st, j))
    else:
        rec('G-201-a 확정된 거래 대금 신고 응답', True, '확정 거래 없음', skip=True)

if 'g201' in PARTS: safe('G-201', g201)

def g189():
    def biz(prefix):
        em, pw, tok, aid = signup(prefix, '구독 예약')
        sql(f"insert into account_roles(account_id, role) values ('{aid}','BIZ_OWNER') on conflict do nothing")
        return login(em, pw), aid
    def sub_row(aid):
        r = rows(f"select plan_code, coalesce(next_plan_code,''), status, current_period_start::text, current_period_end::text, coalesce(cancel_at::text,'') from subscriptions where account_id='{aid}' and status in ('ACTIVE','PAST_DUE')")
        return r[0] if r else None
    def invs(aid):
        return rows(f"select i.amount::int::text, i.status, coalesce(i.plan_code,'') from subscription_invoices i join subscriptions s on s.id=i.subscription_id where s.account_id='{aid}' order by i.issued_at")
    def pay(tok, plan):
        return call('POST', '/subscriptions', tok, {'planCode': plan, 'paymentKey': 'stub_' + uuid.uuid4().hex[:16], 'orderId': 'ord_' + uuid.uuid4().hex[:16]})
    def ask(tok, plan):
        return call('POST', '/subscriptions', tok, {'planCode': plan})

    tok, aid = biz('fx7s')
    st, j = pay(tok, 'STANDARD')
    r0 = sub_row(aid)
    rec('G-189-1 처음 유료 구독(구독 없음 → 스탠다드)은 지금 결제 · 오늘부터 시작 · 청구서 1건(요금제 표시)', st < 300 and not (j or {}).get('reserved') and r0 and r0[0] == 'STANDARD'
        and invs(aid) == [['49000', 'PAID', 'STANDARD']], (st, r0, invs(aid)))
    st, j = ask(tok, 'PRO')
    rec('G-189-2 카드 없이 올리기 예약 → 422 BILLING_KEY_REQUIRED · 바뀐 것 없음', st == 422 and (j or {}).get('code') == 'BILLING_KEY_REQUIRED' and sub_row(aid) == r0, (st, j))
    st, k = call('POST', '/me/billing-key', tok, {'authKey': 'stub_auth_' + uuid.uuid4().hex[:10]})
    st, j = ask(tok, 'PRO')
    r1 = sub_row(aid)
    rec('G-189-3 카드 등록 뒤 「올리기」 → 예약(reserved) · 지금 결제 없음 · 지금 요금제 · 기간 그대로 · 청구서 그대로',
        st < 300 and (j or {}).get('reserved') is True and (j or {}).get('nextPlanCode') == 'PRO' and r1[0] == 'STANDARD' and r1[1] == 'PRO'
        and r1[3:5] == r0[3:5] and len(invs(aid)) == 1, (st, (j or {}).get('note'), r1))
    st, j = pay(tok, 'PRO')
    rec('G-189-4 결제 키를 함께 보내도(예전 화면) 예약으로 처리 — 청구서가 늘지 않음', st < 300 and (j or {}).get('reserved') is True and len(invs(aid)) == 1, (st, len(invs(aid))))
    st, d = call('GET', '/me/subscription/detail', tok)
    rec('G-189-5 구독 상세에 예약 요금제 · 다음 결제 금액(프로 149,000) · 안내', st == 200 and d.get('nextPlanCode') == 'PRO' and d.get('nextChargeAmount') == 149000 and '프로' in (d.get('notice') or ''), (st, d.get('nextChargeAmount'), d.get('notice')))
    st, j = call('DELETE', '/subscriptions/reservation', tok)
    rec('G-189-6 예약 거두기 → 다음 결제일에도 지금 요금제', st < 300 and sub_row(aid)[1] == '', (st, sub_row(aid)))
    # 무료로 내리기 → 기간 끝에 무료로(청구 없음)
    st, j = ask(tok, 'BASIC')
    rec('G-189-7 「내리기」(베이직) 예약 — 지금 결제 · 변경 없음', st < 300 and (j or {}).get('reserved') is True and sub_row(aid)[:2] == ['STANDARD', 'BASIC'], (st, sub_row(aid)))
    sql(f"update subscriptions set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' where account_id='{aid}' and status='ACTIVE'")
    st, b = call('POST', '/admin/billing/charge-due', ADM)
    r2 = sub_row(aid)
    rec('G-189-8 다음 결제일 — 베이직 예약은 청구 없이 무료로 바뀜 · 새 기간 · 예약 지움', st < 300 and r2[0] == 'BASIC' and r2[1] == '' and len(invs(aid)) == 1 and r2[4] > r0[4], (st, r2, invs(aid)))
    # 올리기 예약 → 다음 결제일에 프로 값으로 청구 → 결제되면 프로
    tok2, aid2 = biz('fx7s')
    pay(tok2, 'STANDARD'); call('POST', '/me/billing-key', tok2, {'authKey': 'stub_auth_' + uuid.uuid4().hex[:10]})
    st, j = ask(tok2, 'PRO')
    sql(f"update subscriptions set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' where account_id='{aid2}' and status='ACTIVE'")
    st, b = call('POST', '/admin/billing/charge-due', ADM)
    r3 = sub_row(aid2); iv = invs(aid2)
    rec('G-189-9 다음 결제일 — 프로 예약은 프로 값(149,000)으로 청구 · 결제되면 프로로 바뀜 · 예약 지움',
        r3[0] == 'PRO' and r3[1] == '' and iv[-1] == ['149000', 'PAID', 'PRO'], (r3, iv))
    # 해지 예약 중에는 요금제 예약 불가
    tok3, aid3 = biz('fx7s'); pay(tok3, 'STANDARD'); call('POST', '/me/billing-key', tok3, {'authKey': 'stub_auth_' + uuid.uuid4().hex[:10]})
    call('POST', '/me/subscription/cancel', tok3, {'reason': '시험'})
    st, j = ask(tok3, 'PRO')
    rec('G-189-10 해지 예약 중에 요금제를 바꾸면 409 CANCEL_SCHEDULED(먼저 해지 거두기)', st == 409 and (j or {}).get('code') == 'CANCEL_SCHEDULED', (st, j))
    # 같은 요금제를 고르면 예약이 아님(해지 예약 거두기 — 기존 D022 길)
    st, j = ask(tok3, 'STANDARD')
    rec('G-189-11 지금 요금제를 다시 고르면 예약이 아님(결제가 필요 — 예전 길 그대로)', st == 422 and (j or {}).get('code') == 'PAYMENT_REQUIRED', (st, (j or {}).get('code')))

if 'g189' in PARTS: safe('G-189', g189)

def g127():
    rec('G-127-1 소개몰 주문번호의 날짜 = 한국 날짜(DB 함수가 Asia/Seoul 로 셈)',
        q("select prosrc ilike '%Asia/Seoul%' from pg_proc where proname='fn_next_hlt_order_no'") == 't'
        and q("select substr(fn_next_hlt_order_no(), 2, 6) = to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYMMDD')") == 't', '')
    rec('G-127-2 제휴 링크 클릭 집계 날짜 = 한국 날짜(current_date 안 씀)',
        q("select prosrc ilike '%Asia/Seoul%' and prosrc not ilike '%current_date%' from pg_proc where proname='fn_plink_click'") == 't', '')
    src = {f: open(os.path.join(KIT, f)).read() for f in ('src/modules/affiliate/affiliate.service.ts', 'src/modules/partner/partner.service.ts', 'src/modules/site/report.service.ts', 'src/modules/ads/ad-billing.service.ts',
                                                       'src/modules/partner/partner-admin.service.ts')   # v10.45 — partner.service 에서 나눈 운영용
           if os.path.exists(os.path.join(KIT, f))}
    bad = [f for f, t in src.items() if re.search(r"date_trunc\('month', now\(\)\)|to_char\(now\(\),'YYYY-MM'\)|to_char\(incurred_at,'YYYY-MM'\)", t)]
    rec('G-127-3 월 경계(제휴 이번 달 · 목표 기간 · 이용료 월별 · 경영 지표 · 광고 청구)가 한국 시각 기준', not bad, bad)

if 'g127' in PARTS: safe('G-127', g127)

def g127b():
    # 10/9 흐름 점검에서 찾음 — 한국 날짜로 쌓는 값(클릭 집계 · 광고 기간 · 서류 발급일 · 자격 만료일)을 DB 의 current_date(UTC)와 견주던 곳
    src = {f: open(os.path.join(KIT, f)).read() for f in ('src/modules/affiliate/affiliate.service.ts', 'src/modules/ads/ads.service.ts',
                                                       'src/modules/realty/realty.service.ts', 'src/modules/health/health-shop.service.ts')}
    bad = [f for f, t in src.items() if re.search(r'current_date', t)]
    rec('G-127-4 한국 날짜 값과 견주는 곳(제휴 「오늘 클릭」 · 광고 게재 기간 · 등기 서류 경과일 · 판매자 자격 만료)이 current_date(UTC) 대신 한국 날짜', not bad, bad)

if 'g127' in PARTS: safe('G-127b', g127b)

def g120():
    # 정산 신청(수동) POST /settlements — 그 거래의 소개자만. 고치기 전에는 인증된 사업자면 누구나 남의 거래의 받는 사람으로 자신을 올리려 할 수 있었음
    S = login('seller@x.com')     # 인증된 사업자 · 아래 거래들의 소개자가 아님
    did = q("select d.id from deals d where d.status='CONFIRMED' and d.introducer_account_id is distinct from (select id from accounts where email='seller@x.com') and not exists(select 1 from settlements s where s.deal_id=d.id) limit 1")
    if not did:   # v10.27(2) — 확정 거래가 없는 DB(Docker): 소개자 확인이 상태 확인보다 먼저라 아무 거래로도 같은 확인이 됨
        did = q("select d.id from deals d where d.introducer_account_id is distinct from (select id from accounts where email='seller@x.com') and not exists(select 1 from settlements s where s.deal_id=d.id) order by d.created_at desc limit 1")
    n0 = q("select count(*) from settlements")
    st, j = call('POST', '/settlements', S, {'dealId': did})
    rec('G-120-1 소개자가 아닌 인증 사업자의 정산 신청 → 403 NOT_PARTY · 정산 생기지 않음', st == 403 and (j or {}).get('code') == 'NOT_PARTY' and q("select count(*) from settlements") == n0, (st, (j or {}).get('code')))
    st, j = call('POST', '/settlements', S, {'dealId': str(uuid.uuid4())})
    rec('G-120-2 없는 거래 → 404', st == 404, (st, (j or {}).get('code')))
    did2 = q("select d.id from deals d join accounts a on a.id=d.introducer_account_id where a.email='intro@x.com' and d.status not in ('CONFIRMED','SETTLED') and not exists(select 1 from settlements s where s.deal_id=d.id) limit 1")
    st, j = call('POST', '/settlements', login('intro@x.com'), {'dealId': did2})
    rec('G-120-3 그 거래의 소개자는 소개자 확인을 지나 다음 규칙(확정 전 · 422)으로 감 — 403 아님 · 정산 생기지 않음', st == 422 and q("select count(*) from settlements") == n0, (st, (j or {}).get('code')))
    rec('G-120-4 DB 규칙(fn_assert_settlement_rules) — 받는 사람 = 그 거래의 소개자(D034)',
        q("select prosrc ilike '%introducer_account_id%' and prosrc ilike '%G-120%' from pg_proc where proname='fn_assert_settlement_rules'") == 't', '')

if 'g120' in PARTS: safe('G-120', g120)

if __name__ == '__main__':
    json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fix_1027b.json'), 'w'), ensure_ascii=False, indent=1)
    bad = [r for r in R if not r['ok']]
    print(f"\n{len(R) - len(bad)}/{len(R)} 통과", file=sys.stderr)
    sys.exit(1 if bad else 0)
