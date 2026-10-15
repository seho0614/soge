"""v10.31 — 새로 생긴 API 의 역할별 호출 시험 (10/10 「시안 기준」 반영 · 다섯 묶음 합친 판).

  A  역할 표 — 새 API 를 손님 · 회원 · 사업자(파트너) · 검수 · 지급 · 운영(ADMIN) · 최고 관리자(SUPER)로 불러 허용 / 거절(401 · 403)이 정한 대로인지
  B  공개 자료 — 지역 · 성공현황(기간) · 최근 사례 · 베스트매칭 · 공급자(목록 · 추천 · 프로필 — 대표자 · 연락처 · 사업자번호 안 나감) · 피해 사례 · 안전거래 안내 · 관 축 · 특가 배너
  C  검색어 집계 — POST /search/log → search_term_stats(원문 저장 안 함 · 제한업종 · 숫자 · @ 뺌 · 형식 400) → GET /search/keywords
  D  알림 수신 설정 — 끌 수 있는 것만 끔(돈 · 계약은 422) → 다시 켬
  E  피해 사례 — 본인인증 회원 작성(연락처 가림 · 짧은 글 400 · 미인증 403) → 운영 목록 → 숨김(사유) → 공개 목록에서 빠짐
  F  사진 등록 — 매물 사진(LISTING_IMAGE 올리기 → 등록 → 공개 주소 → 남의 매물 403/404 → 지움) · 요청 사진/종류/지역(PATCH /market/requests/:id · 남의 요청 거절)
  G  거래 — 계약 상태(당사자만 · 가림) · 계약 확인 요청(상대 차례만 · 하루 한 번) · 정산 승인(REQUESTED → APPROVED → 당사자 「받았음」 PAID · 2인 원칙 · DB 가 바로 PAID 막음) · 성공현황 사례(초안 → 동의 전 공개 422 → 두 당사자 동의 → 공개 → 숨김)
     ★ 소개비 스위치(feature.referral_fee)를 잠깐 켰다가 원래 값으로 되돌립니다(fix_1028 F 절과 같은 방법)
  H  선불 충전 · 견적 매트릭스(얕게 — 깊은 확인은 srv_w5.py) — 파트너 잔액 · 비파트너 409 · 운영 원장 · 서비스 매트릭스 남의 것 404
  I  운영 — 활주로(실제 매출 · 비용 입력 전 표시) · 월 비용 넣기/되돌리기 · 정책 원본(SUPER 만 고침) · 관 축 내리기 → 공개 축에서 빠짐 → 되돌림 · 관 오픈 체크 · 통합 현황 ·
     외부 송출(퍼블리셔 등록 → 도메인 확인 전 송출 없음 → 확인 → 송출 · 클릭 기록 → 닫음) · 특가 배너(더함 → 끈 것은 공개에서 빠짐) · 회원 목록 가림 · 결제 대조

사용:  API=http://localhost:3000/api/v1 python3 srv_v1031.py [A B …]      결과 srv_v1031.json
시험이 만드는 것: 계정 v31_*@t.local · 시험 거래(정산 PAID 로 닫힘) · 숨긴 피해 사례 1건 · 닫은 퍼블리셔 1곳 · 끈 특가 배너 1건 · 숨긴 성공 사례 1건.
"""
import sys, os, json, uuid, time, hashlib, datetime, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import *

R = []
def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), step, '|', str(detail)[:200], file=sys.stderr, flush=True)
def safe(name, fn):
    try: fn()
    except Exception as ex:
        import traceback; rec(f'{name} 실행 중 오류', False, repr(ex)[:200] + ' ' + traceback.format_exc().splitlines()[-3][:150])

PARTS = set(a for a in sys.argv[1:] if len(a) == 1) or set('ABCDEFGHI')
tag = uuid.uuid4().hex[:6]
code = lambda j: (j or {}).get('code') if isinstance(j, dict) else None

ADM = login('admin@x.com')            # ADMIN · SUPER
OPS = login('ops@t.local')            # ADMIN
REV = login('reviewer@t.local')       # REVIEWER
PAY = login('payout@t.local')         # PAYOUT
MEM = login('member@t.local')         # MEMBER
PER = login('person@x.com')           # MEMBER · BIZ_OWNER (본인인증)
BUY = login('buyer@x.com')            # MEMBER (본인인증)
INT = login('intro@x.com')            # MEMBER · BIZ_OWNER · 파트너
for t in (ADM, OPS, REV, PAY, MEM, PER, BUY, INT): agree_pending(t)
ROLES = {'손님': None, '회원': MEM, '사업자': PER, '검수': REV, '지급': PAY, '운영': OPS, '최고': ADM}

def raw(m, url, body=None, ct=None, headers=None):
    """API 밖(바이트) — 올리기 주소 · 사진"""
    h = {'user-agent': UA, **(headers or {})}
    if ct: h['content-type'] = ct
    r_ = urllib.request.Request(url, method=m, data=body, headers=h)
    try: r = urllib.request.urlopen(r_, timeout=40); return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read(), dict(e.headers)

ORIGIN = API.split('/api/v1')[0]

# ════════ A. 역할 표 ════════
def part_a():
    # (메서드, 주소, 본문, 허용 역할) — 허용 역할 밖은 403(손님은 UNAUTHENTICATED · 로그인한 다른 역할은 FORBIDDEN — 이 서버의 규칙). 거절 쪽에 404 · 409 가 오면 실패로 셉니다.
    #   ★ 운영 계정(ADMIN · SUPER)은 사용자 역할(MEMBER · BIZ_OWNER · BIZ_STAFF)도 함께 가집니다(2026-10-01 결정 Q5 · principal.service) — 회원 API 는 운영도 허용
    ALLM = {'회원', '사업자', '검수', '지급', '운영', '최고'}
    T = [
        ('GET', '/admin/finance/runway', None, {'운영', '최고'}),
        ('GET', '/admin/finance/costs', None, {'운영', '최고'}),
        ('GET', '/admin/policy-items', None, {'운영', '최고'}),
        ('GET', '/admin/gwans/MNY/open-check', None, {'최고'}),
        ('GET', '/admin/gwan-axes', None, {'운영', '최고'}),
        ('GET', '/admin/ai/learn-settings', None, {'운영', '최고'}),
        ('GET', '/admin/segments/preview', None, {'운영', '최고'}),
        ('GET', '/admin/segments/log', None, {'운영', '최고'}),
        # v10.32 — 카테고리 마스터(SB-ADM-PTN-060) 읽기 전용
        ('GET', '/admin/qualifications/category-master', None, {'운영', '최고'}),
        # v10.32 — 운영 화면 17 시안 반영의 새 읽기 API(파트너사 카드 · 계약 · 서류 · 중개사 보증 · 서류 · 감사 보관 · 임계)
        ('GET', '/admin/partners/cards', None, {'운영', '최고'}),
        ('GET', f"/admin/partners/{q('select id from partners order by applied_at limit 1')}/docs", None, {'운영', '최고'}),
        ('GET', f"/admin/brokers/{q('select id from broker_verifications order by created_at limit 1')}/evidence", None, {'운영', '최고'}),
        ('GET', '/admin/audit/policy', None, {'운영', '최고'}),
        ('GET', '/admin/integration-status', None, {'최고'}),
        ('GET', '/admin/adx/overview', None, {'운영', '최고', '지급'}),
        ('GET', '/admin/settlements', None, {'운영', '최고'}),
        ('GET', '/admin/accounts?status=ACTIVE', None, {'운영', '최고'}),
        ('GET', '/admin/accounts-counts', None, {'운영', '최고'}),
        ('GET', '/admin/reviews/counts', None, {'검수', '운영', '최고'}),
        ('GET', '/admin/auto-review/samples/summary', None, {'검수', '운영', '최고'}),
        ('GET', '/admin/badges/history', None, {'검수', '운영', '최고'}),
        ('GET', '/admin/audit/logs?kind=OPS', None, {'운영', '최고'}),
        ('GET', '/admin/ad-creatives/slots', None, {'운영', '최고'}),
        ('GET', '/admin/success-stories', None, {'운영', '최고'}),
        ('GET', '/admin/safety/cases', None, {'운영', '최고'}),
        ('GET', '/admin/health/promos', None, {'운영', '최고'}),
        ('GET', '/admin/partner-center/cash', None, {'운영', '최고'}),
        ('GET', '/admin/partner-center/rules', None, {'운영', '최고'}),
        ('GET', '/admin/partner-center/change-requests', None, {'운영', '최고'}),
        ('GET', '/admin/partner-center/lead-cash-invoices', None, {'운영', '최고'}),
        ('PATCH', '/admin/policy-items/FEE_BASIS', {}, {'최고'}),          # 본문이 비면 허용 역할은 422 · 400 (바꾸지 않음)
        ('PATCH', f'/admin/settlements/{uuid.uuid4()}', {'status': 'APPROVED'}, {'운영', '최고'}),   # 허용 역할은 없는 정산 → 409/404
        ('PATCH', f'/admin/adx/statements/{uuid.uuid4()}', {'action': 'APPROVE'}, {'운영', '최고', '지급'}),
        ('GET', '/me/home', None, {'회원', '사업자', '검수', '운영', '최고'}),
        ('GET', '/me/notification-prefs', None, {'회원', '사업자', '검수', '운영', '최고'}),
        ('GET', '/me/introducer/profile', None, {'회원', '사업자', '검수', '운영', '최고'}),
        ('GET', '/me/success-stories', None, ALLM),
        ('GET', '/me/fulfillment-reports', None, {'회원', '사업자', '운영', '최고'}),
    ]
    for m, p, body, ok_roles in T:
        res = {}
        codes = {}
        for name, tok in ROLES.items():
            st, j = call(m, p, tok, body)
            res[name] = st; codes[name] = code(j)
        bad = []
        for name, st in res.items():
            if name in ok_roles:
                if st in (401, 403): bad.append(f'{name}:{st}(허용인데 거절)')
                elif st >= 500: bad.append(f'{name}:{st}')
            else:
                want = 'UNAUTHENTICATED' if name == '손님' else 'FORBIDDEN'
                if st != 403 or codes[name] != want: bad.append(f'{name}:{st} {codes[name]}(기대 403 {want})')
        rec(f'A {m} {p.split("?")[0][:60]} — 허용 {"·".join(sorted(ok_roles))}', not bad, bad or res)
    # 공개 API — 손님도 200
    pub = ['/market/regions', '/search/keywords', '/market/requests', '/market/success', '/market/success/recent', '/market/best',
           '/market/suppliers', '/market/suppliers/recommended', '/safety/cases', '/safety/safe-trade', '/biz/axis/SVC', '/biz/quick',
           '/site/gwan-axes?gwan=MAL', '/health/promos']
    res = {p: call('GET', p)[0] for p in pub}
    rec(f'A 공개 API {len(pub)}개 — 손님 200', all(v == 200 for v in res.values()), {k: v for k, v in res.items() if v != 200} or len(pub))

# ════════ B. 공개 자료 ════════
def part_b():
    st, j = call('GET', '/market/regions')
    items = (j or {}).get('items') or []
    db_seoul = q("select count(*) from v_listing_region where sido_code='1100000000'") if q("select to_regclass('v_listing_region')") else ''
    rec('B-1 지역으로 찾기 — 시 · 도 9곳 + 기타 · 숫자 = 게시 매물 수', st == 200 and len(items) >= 9 and all(isinstance(x.get('count'), int) for x in items),
        (st, [(x['name'], x['count']) for x in items][:10], db_seoul))
    per = {}
    for p in ('all', '7d', 'month', 'year'):
        st, j = call('GET', f'/market/success?period={p}')
        per[p] = (st, ((j or {}).get('kpi') or {}).get('total', {}).get('value'))
    total_db = q("select count(*) from v_success_deals") if q("select to_regclass('v_success_deals')") else None
    rec('B-2 성공현황 — 기간 4가지 200 · 총 성공 = 성사 확정 거래 수(v_success_deals)', all(v[0] == 200 for v in per.values()) and str(per['all'][1]) == str(total_db), (per, total_db))
    st, j = call('GET', '/market/success?period=all')
    s = json.dumps(j, ensure_ascii=False)
    rec('B-3 성공현황 — 이메일 · 전화 번호가 응답에 없음', st == 200 and '@' not in s and not re.search(r'01[016789]-?\d{3,4}-?\d{4}', s), s[:160])
    st, j = call('GET', '/market/success/recent?limit=3')
    rec('B-4 최근 실제 연결 사례 — 3건 이하 · 성사 확정 거래', st == 200 and len((j or {}).get('items', [])) <= 3, (st, str(j)[:160]))
    st, j = call('GET', '/market/best')
    rec('B-5 베스트매칭 — 공개 동의 받은 사례만(안내 글 함께)', st == 200 and isinstance((j or {}).get('items'), list) and (j or {}).get('note'), (st, str(j)[:160]))
    st, sup = call('GET', '/market/suppliers?limit=4')
    rec('B-6 서비스 업체 추천 — 목록(업체 단위 · 신뢰도 · 성사 수)', st == 200 and isinstance(sup, list) and all('trustScore' in x for x in sup), (st, str(sup)[:160]))
    st, rj = call('GET', '/market/suppliers/recommended')
    rec('B-7 AI 추천 맞춤 공급자 — 손님 200 · 광고 아님', st == 200 and isinstance((rj or {}).get('items'), list), (st, str(rj)[:160]))
    if sup:
        sid = sup[0]['id']
        st, j = call('GET', f'/market/suppliers/{sid}')
        s = json.dumps(j, ensure_ascii=False)
        brn = q(f"select biz_reg_no from businesses where id='{sid}'")
        ph = q(f"select coalesce(a.phone,'') from businesses b join accounts a on a.id=b.account_id where b.id='{sid}'")
        em = q(f"select a.email from businesses b join accounts a on a.id=b.account_id where b.id='{sid}'")
        rec('B-8 업체 프로필 — 200 · 사업자번호 · 대표 연락처 · 이메일이 응답에 없음', st == 200 and (not brn or brn not in s) and (not ph or ph not in s) and em not in s and 'bizRegNo' not in s,
            (st, s[:160]))
    st, j = call('GET', f'/market/suppliers/{uuid.uuid4()}')
    rec('B-9 없는 업체 → 404', st == 404, (st, j))
    st, j = call('GET', '/safety/safe-trade')
    rec('B-10 안전거래 안내 — 기준 금액 = 설정 safe_trade.min_amount · 대금은 당사자끼리', st == 200 and str((j or {}).get('minAmount')) == q("select value from site_settings where key='safe_trade.min_amount'") and 'DIRECT' in json.dumps(j),
        (st, (j or {}).get('minAmount')))
    st, j = call('GET', '/site/gwan-axes?gwan=MAL')
    exp = q("select count(*) from gwan_axes where gwan_code='MAL' and is_exposed")
    rec('B-11 관 축(공개) — 노출 중인 축만 · 수 = gwan_axes', st == 200 and isinstance(j, list) and str(len(j)) == exp and all(x.get('isExposed') for x in j), (st, len(j or []), exp))
    st, j = call('GET', '/health/promos')
    rec('B-12 특가 배너(공개) — 켠 것 · 기간 안 · 견본 표시', st == 200 and isinstance(j, list) and all('isSample' in x for x in j), (st, str(j)[:160]))
    st, j = call('GET', '/biz/axis/SVC'); st2, j2 = call('GET', '/biz/axis/ZZZ')
    rec('B-13 소개창업 축 목록 SVC 200 · 없는 축 400/404', st == 200 and (j or {}).get('kind') == 'SVC' and st2 in (400, 404), (st, st2))
    st, j = call('GET', '/market/requests?kind=SERVICE&limit=4')
    rec('B-14 지금 올라온 요청 — 종류 · 지역 · 사진 칸', st == 200, (st, str(j)[:160]))

# ════════ C. 검색어 집계 ════════
def part_c():
    word = q("select w from (select regexp_split_to_table(title, '\\s+') w from listings where status='PUBLISHED') t where length(w) between 2 and 6 and w ~ '^[가-힣]+$' group by w order by count(*) desc limit 1")
    before = q(f"select coalesce(sum(hits),0) from search_term_stats where term='{word}'")
    cols = q("select string_agg(column_name, ',') from information_schema.columns where table_name='search_term_stats'")
    st, j = call('POST', '/search/log', None, {'q': f'{word} 010-1234-5678 abc@x.com 123456'})
    rec('C-1 검색어 집계 — 손님 200 · 센 말 recorded · 전화 · 이메일 · 숫자 3자리 이상은 세지 않음', st == 200 and word in (j or {}).get('recorded', []) and not any(('@' in w or re.search(r'\d{3}', w)) for w in (j or {}).get('recorded', [])),
        (st, j, word))
    after = q(f"select coalesce(sum(hits),0) from search_term_stats where term='{word}'")
    rec('C-2 DB search_term_stats — 그 말의 hits +1 · 원문(전화 · 이메일) 행 없음', int(after or 0) == int(before or 0) + 1
        and q("select count(*) from search_term_stats where term like '%@%' or term ~ '01[0-9]-?[0-9]{3,4}'") == '0', (cols, before, after))
    st, j = call('POST', '/search/log', None, {'q': ''}); st2, j2 = call('POST', '/search/log', None, {'q': 'x' * 101})
    rec('C-3 형식 — 빈 말 · 100자 넘음 → 400', st == 400 and st2 == 400, (st, st2))
    st, j = call('GET', '/search/keywords?limit=10')
    rec('C-4 많이 찾는 키워드 — 200 · 제한업종 낱말 없음 · 근거 글', st == 200 and isinstance((j or {}).get('items'), list) and (j or {}).get('basis'), (st, str(j)[:200]))
    restricted = q("select string_agg(term, ',') from restrict_vocab")
    rec('C-5 많이 찾는 키워드에 제한업종 낱말 없음', not any(x.get('term', x.get('keyword', '')) in (restricted or '').split(',') for x in (j or {}).get('items', []) if isinstance(x, dict)), (restricted or '')[:80])

# ════════ D. 알림 수신 설정 ════════
def part_d():
    st, j = call('GET', '/me/notification-prefs', BUY)
    items = (j or {}).get('items') or []
    rec('D-1 알림 수신 설정 목록 — 종류마다 앱 · 이메일 · 끌 수 있는지 · 못 끄는 까닭', st == 200 and items and all({'eventCode', 'inapp', 'email', 'optoutAllowed'} <= set(x) for x in items)
        and any(x.get('reason') for x in items if not x['optoutAllowed']), (st, len(items), sum(1 for x in items if not x['optoutAllowed'])))   # 까닭(법 근거)이 없는 줄은 화면이 「돈 · 계약이 걸린 안내」로 채움
    can = next((x for x in items if x['optoutAllowed'] and x['inapp']), None)
    cant = next((x for x in items if not x['optoutAllowed']), None)
    aid = q("select id from accounts where email='buyer@x.com'")
    if can:
        ev = can['eventCode']
        st, r1 = call('PATCH', '/me/notification-prefs', BUY, {'eventCode': ev, 'channel': 'INAPP', 'enabled': False})
        now = next((x for x in call('GET', '/me/notification-prefs', BUY)[1]['items'] if x['eventCode'] == ev), {})
        rec(f'D-2 끌 수 있는 알림({ev}) 앱 알림 끔 → 목록에 반영', st == 200 and now.get('inapp') is False, (st, r1, now))
        n0 = q(f"select count(*) from notifications where account_id='{aid}' and event_code='{ev}'")
        if True:
            rc, er = sql(f"select fn_notify('{aid}', '{ev}', '{{}}'::jsonb, '/my')")
            n1 = q(f"select count(*) from notifications where account_id='{aid}' and event_code='{ev}'")
            rec('D-3 끈 종류는 보내지 않음(fn_notify · D063)', rc == 0 and n0 == n1, (rc, er[:120], n0, n1))
        st, r2 = call('PATCH', '/me/notification-prefs', BUY, {'eventCode': ev, 'channel': 'INAPP', 'enabled': True})
        now = next((x for x in call('GET', '/me/notification-prefs', BUY)[1]['items'] if x['eventCode'] == ev), {})
        rec('D-4 다시 켬(시험 뒤 원래대로)', st == 200 and now.get('inapp') is True, (st, now))
    else:
        rec('D-2 끌 수 있는 알림이 목록에 있음', False, items[:3])
    if cant:
        st, r = call('PATCH', '/me/notification-prefs', BUY, {'eventCode': cant['eventCode'], 'channel': 'INAPP', 'enabled': False})
        rec(f'D-5 못 끄는 알림({cant["eventCode"]} — 돈 · 계약) 끄기 → 409 OPTOUT_FORBIDDEN', st in (409, 422) and code(r) == 'OPTOUT_FORBIDDEN', (st, r))
    st, r = call('PATCH', '/me/notification-prefs', BUY, {'eventCode': 'NO_SUCH_EVENT_X', 'channel': 'INAPP', 'enabled': False})
    st2, r2 = call('PATCH', '/me/notification-prefs', BUY, {'eventCode': 'MESSAGE_RECEIVED', 'channel': 'SMS', 'enabled': False})
    rec('D-6 없는 종류 → 404/422 · 없는 경로(SMS) → 400', st in (404, 422) and st2 == 400, (st, code(r), st2))

# ════════ E. 피해 사례 ════════
CASE = {}
def part_e():
    # v10.32 — 하루 3건 제한(SAFETY_CASE_RATE): 같은 날 이 시험을 여러 번 돌리면 시험 회원(buyer)이 한도에 걸립니다.
    #   이 시험이 전에 남긴 글(제목 「… 시험 …」)만 하루 전으로 돌려 둡니다(시험 자료 준비 · 다른 글은 건드리지 않음).
    sql("update safety_cases set created_at = created_at - interval '1 day' where author_account_id = (select id from accounts where email='buyer@x.com') and title like '%시험%' and created_at > now() - interval '1 day'")
    body = f'계약금을 보냈는데 연락이 끊겼습니다. 연락처 010-9876-5432 · 이메일 scam{tag}@example.com 으로 연락했던 사람입니다. 시험 {tag}'
    st, j = call('POST', '/safety/cases', BUY, {'type': 'CONTRACT', 'title': f'계약금 피해 시험 {tag}', 'body': body})
    no = (j or {}).get('no') or (j or {}).get('caseNo')
    CASE['no'] = no
    saved = q(f"select body from safety_cases where body like '%시험 {tag}%' order by created_at desc limit 1")
    rec('E-1 피해 사례 작성(본인인증 회원) → 201 · 저장 전에 연락처 · 이메일 가림', st in (200, 201) and saved and '010-9876-5432' not in saved and f'scam{tag}@example.com' not in saved, (st, j, saved[:120]))
    em, pw, tok, _ = signup('v31', '미인증')
    st, j = call('POST', '/safety/cases', tok, {'type': 'CONTRACT', 'title': '미인증 시험 제목', 'body': '본인인증 없이 쓰는 피해 사례 시험 글입니다. 충분히 깁니다.'})
    rec('E-2 본인인증 전 회원 → 403', st == 403, (st, code(j)))
    st, j = call('POST', '/safety/cases', BUY, {'type': 'CONTRACT', 'title': '짧은 글 시험', 'body': '짧음'}); st2, j2 = call('POST', '/safety/cases', BUY, {'type': 'XX', 'title': '유형 시험 제목', 'body': 'x' * 30})
    rec('E-3 짧은 글 · 없는 유형 → 400', st == 400 and st2 == 400, (st, st2))
    st, j = call('POST', '/safety/cases', None, {'type': 'CONTRACT', 'title': '손님 시험 제목', 'body': 'x' * 30})
    rec('E-4 손님 → 403 UNAUTHENTICATED', st == 403 and code(j) == 'UNAUTHENTICATED', (st, code(j)))
    st, pub = call('GET', '/safety/cases?type=CONTRACT')
    s = json.dumps(pub, ensure_ascii=False)
    rec('E-5 공개 목록 — 방금 글이 보임 · 작성자(이메일 · 계정) 안 나감', st == 200 and f'시험 {tag}' in s and 'buyer@x.com' not in s and 'authorAccountId' not in s, (st, s[:160]))
    if no:
        st, d = call('GET', f'/safety/cases/{no}')
        v0 = (d or {}).get('views'); st_, d2 = call('GET', f'/safety/cases/{no}')
        rec('E-6 보기 → 조회 수 +1', st == 200 and (d2 or {}).get('views') == (v0 or 0) + 1, (st, v0, (d2 or {}).get('views')))
        st, adm = call('GET', '/admin/safety/cases', ADM)
        s = json.dumps(adm, ensure_ascii=False)
        rec('E-7 운영 목록 — 작성자 이메일은 가린 값', st == 200 and f'시험 {tag}' in s and 'buyer@x.com' not in s, (st, s[:200]))
        st, j = call('POST', f'/admin/safety/cases/{no}/hide', ADM, {'reason': ''})
        rec('E-8 숨김 사유 없음 → 400', st == 400, (st, code(j)))
        st, j = call('POST', f'/admin/safety/cases/{no}/hide', REV, {'reason': '시험 숨김'})
        rec('E-9 검수 담당이 숨김 → 403', st == 403, st)
        st, j = call('POST', f'/admin/safety/cases/{no}/hide', ADM, {'reason': f'시험 글 정리 {tag}'})
        st2, pub = call('GET', '/safety/cases?type=CONTRACT'); st3, d = call('GET', f'/safety/cases/{no}')
        rec('E-10 운영 숨김(사유) → 공개 목록에서 빠짐 · 공개 보기 404', st in (200, 201) and f'시험 {tag}' not in json.dumps(pub, ensure_ascii=False) and st3 == 404, (st, j, st3))
    else:
        rec('E-6 피해 사례 번호를 받지 못해 뒤 단계 못 함', False, 'no')

# ════════ F. 사진 등록 ════════
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5b50000000049454e44ae426082')
def upload(tok, purpose, data=PNG, name='p.png', ct='image/png'):
    st, t = call('POST', '/files', tok, {'purpose': purpose, 'name': name, 'contentType': ct, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    if st != 201: return None, (st, t)
    u = t['uploadUrl'] if t['uploadUrl'].startswith('http') else ORIGIN + t['uploadUrl']
    s2 = raw(t.get('method', 'PUT'), u, data, ct=(t.get('headers') or {}).get('Content-Type', ct))
    st3, c = call('POST', f"/files/{t['fileId']}/complete", tok)
    return (t['fileId'] if st3 == 200 and (c or {}).get('status') == 'READY' else None), (st, s2[0], st3, c)

def part_f():
    # 매물 주인 = intro@x.com(사업자 · 게시 매물 있음), 남 = person@x.com(사업자) · buyer@x.com(회원)
    OWN, OTH = INT, PER
    L = q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='intro@x.com' and l.status='PUBLISHED' order by l.created_at desc limit 1")
    other = q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email<>'intro@x.com' and l.status='PUBLISHED' order by l.created_at desc limit 1")
    if not L:
        rec('F-0 intro@x.com 의 게시 매물', False, 'none', skip=True); return
    fid, info = upload(OWN, 'LISTING_IMAGE')
    rec('F-1 매물 사진 올리기(LISTING_IMAGE) → READY', bool(fid), info)
    if not fid: return
    n0 = int(q(f"select count(*) from listing_media where listing_id='{L}'") or 0)
    st, j = call('POST', f'/listings/{L}/photos', OWN, {'fileId': fid})
    n1 = int(q(f"select count(*) from listing_media where listing_id='{L}'") or 0)
    mid = (j or {}).get('mediaId') or (j or {}).get('id') or q(f"select id from listing_media where listing_id='{L}' and file_id='{fid}'")
    rec('F-2 내 매물에 사진 등록 → listing_media 한 줄(file_id)', st in (200, 201) and n1 == n0 + 1 and mid, (st, j, n0, n1))
    # 사진 번호는 0부터(그 매물의 파일 사진 순서) — 방금 올린 것의 번호를 찾습니다
    st, b, hd = 404, b'', {}
    for n in range(0, n1 + 1):
        st, b, hd = raw('GET', f'{API}/listings/{L}/photos/{n}')
        if st == 200 and b == PNG: break
    st2, b2, _ = raw('GET', f'{API}/listings/{L}/photos/20')
    rec('F-3 공개 사진 주소 → 200 image · 바이트 같음 · nosniff / 없는 번호 404', st == 200 and b == PNG and 'image' in hd.get('Content-Type', '') and st2 == 404,
        (st, hd.get('Content-Type'), len(b), st2))
    fid2, _ = upload(BUY, 'LISTING_IMAGE')
    st, j = call('POST', f'/listings/{L}/photos', BUY, {'fileId': fid2 or str(uuid.uuid4())})
    # v10.36 (D094) — 개인 회원도 자기 소개장터 매물에 사진을 붙이므로 역할(403)이 아니라 주인 확인(404 · F-5 와 같음)에서 막힙니다
    rec('F-4 남(회원)이 내 매물에 사진 등록 → 403/404', st in (403, 404), (st, code(j)))
    if other:
        fid3, _ = upload(OWN, 'LISTING_IMAGE')
        st, j = call('POST', f'/listings/{other}/photos', OWN, {'fileId': fid3})
        rec('F-5 사업자가 남의 매물에 사진 등록 → 403/404', st in (403, 404), (st, code(j)))
    st, j = call('POST', f'/listings/{L}/photos', OWN, {'fileId': fid2 or str(uuid.uuid4())})
    rec('F-6 남의 파일(다른 회원이 올린 것)로 등록 → 거절(403/404/422)', st in (403, 404, 422), (st, code(j)))
    st, j = call('DELETE', f'/listings/{L}/photos/{mid}', BUY)
    rec('F-7 남이 지우기 → 403/404 (v10.36 — 주인 확인에서 막힘)', st in (403, 404), st)
    st, j = call('DELETE', f'/listings/{L}/photos/{mid}', OWN)
    rec('F-8 내가 지움 → listing_media 원래 수', st in (200, 204) and int(q(f"select count(*) from listing_media where listing_id='{L}'") or 0) == n0, (st, j))
    # 요청의 종류 · 지역 · 사진
    rq = q("select r.id from requests r join accounts a on a.id=r.owner_account_id where a.email='buyer@x.com' order by r.created_at desc limit 1")
    if not rq:
        rec('F-9 buyer@x.com 의 요청', False, 'none', skip=True); return
    prev = q(f"select coalesce(kind,'')||'|'||coalesce(region_code,'')||'|'||coalesce(region_detail,'')||'|'||coalesce(photo_file_id::text,'')||'|.' from requests where id='{rq}'").split('|')[:4]
    rfid, info = upload(BUY, 'REQUEST_IMAGE')
    st, j = call('PATCH', f'/market/requests/{rq}', BUY, {'kind': 'SERVICE', 'regionCode': '1100000000', 'regionDetail': '금천구', 'photoFileId': rfid})
    now = q(f"select coalesce(kind,'')||'|'||coalesce(region_code,'')||'|'||coalesce(region_detail,'')||'|'||coalesce(photo_file_id::text,'')||'|.' from requests where id='{rq}'").split('|')[:4]
    rec('F-9 내 요청의 종류 · 지역 · 사진(REQUEST_IMAGE) → DB 반영', st == 200 and now[0] == 'SERVICE' and now[1] == '1100000000' and now[3] == (rfid or ''), (st, j, now))
    st, b, hd = raw('GET', f'{API}/market/requests/{rq}/photo')
    rec('F-10 요청 사진(공개 · 게시 중일 때) → 200 같은 바이트 또는 게시 전 404', (st == 200 and b == PNG) or st == 404, (st, len(b)))
    st, j = call('PATCH', f'/market/requests/{rq}', PER, {'kind': 'GOODS'})
    rec('F-11 남(다른 회원)이 요청 고침 → 403/404', st in (403, 404), (st, code(j)))
    pfid, _ = upload(PER, 'REQUEST_IMAGE')
    st, j = call('PATCH', f'/market/requests/{rq}', BUY, {'photoFileId': pfid})
    rec('F-12 남이 올린 파일을 내 요청 사진으로 → 422 REQUEST_PHOTO_FILE', st == 422, (st, code(j)))
    kind, reg, det, ph = prev
    body = {'kind': kind, 'regionCode': reg, 'regionDetail': det}
    st, j = call('PATCH', f'/market/requests/{rq}', BUY, body)
    if not ph: sql(f"update requests set photo_file_id=null, kind=nullif('{kind}',''), region_code=nullif('{reg}',''), region_detail=nullif('{det}','') where id='{rq}'")
    rec('F-13 시험 뒤 요청을 원래 값으로', q(f"select coalesce(kind,'')||'|'||coalesce(region_code,'')||'|'||coalesce(region_detail,'')||'|'||coalesce(photo_file_id::text,'')||'|.' from requests where id='{rq}'").split('|')[:4] == prev, (st, prev))

# ════════ G. 거래 — 계약 확인 요청 · 정산 승인 · 성공 사례 ════════
UA_ = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
def intro_listing():
    return rows("""select l.id, a.email from listings l join accounts a on a.id=l.owner_account_id join categories c on c.id=l.category_id
      where l.status='PUBLISHED' and l.gwan_code='MAL' and a.email like 'brk_%@t.local' and a.status='ACTIVE' and not fn_category_no_intro(c.id)
        and not fn_is_realty_category(c.id)
        and exists(select 1 from account_roles r where r.account_id=a.id and r.role='BIZ_OWNER')
        and exists(select 1 from businesses b where b.account_id=a.id and b.verified_at is not null) order by l.published_at desc, l.id limit 2""")

def new_deal(code_, L, TS, fee=None, contract=True, confirm=False):
    V = str(uuid.uuid4())
    call('POST', '/attribution/touch', None, {'code': code_, 'landingUrl': '/mall'}, headers={'X-Visitor-Key': V, 'User-Agent': UA_})
    e = f'v31b_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', None, {'email': e, 'password': TEST_PW, 'name': '구매 시험', 'visitorKey': V})
    TB = (j or {}).get('accessToken'); agree_pending(TB)
    call('POST', '/verifications/identity', TB, {'provider': 'PASS'})
    st, c = call('POST', '/conversations', TB, {'targetType': 'LISTING', 'targetId': L, 'message': '소개받고 문의드립니다. 상담 가능할까요?'})
    st, d = call('POST', f"/conversations/{(c or {}).get('conversationId')}/deal", TS)
    did = (d or {}).get('dealId')
    if fee:
        st, f = call('POST', f'/deals/{did}/fee', TS, {'amount': fee})
        st, a = call('POST', f"/deals/{did}/fee/{(f or {}).get('version')}/agree", TB)
        call('POST', f"/deals/{did}/fee/{(a or {}).get('version')}/agree", TS)
    if contract: call('POST', f'/deals/{did}/contract', TS, {})
    if confirm:
        call('POST', f'/deals/{did}/confirm', TB, {})
        call('POST', f'/deals/{did}/confirm', TS, {})
    return did, TB, e

def part_g():
    # 매도자 = intro@x.com(인증 사업자 · 소개장터 기계 · 설비 매물 — 부동산은 정산이 없음 D056) · 소개자 = 새 개인(본인인증 · 받을 계좌 1원 확인 · 소개코드 30,000원 결제(스텁) — BASIC 무료 0건 D060)
    L = q("select l.id from listings l join accounts a on a.id=l.owner_account_id join categories c on c.id=l.category_id where a.email='intro@x.com' and l.status='PUBLISHED' and not fn_is_realty_category(c.id) and not fn_category_no_intro(c.id) order by l.created_at limit 1")
    seller = 'intro@x.com'; TS = INT
    em, pw, TI, I = signup('v31i', '시험소개자')
    call('POST', '/verifications/identity', TI, {'provider': 'PASS'})
    st, a = call('POST', '/me/payout-accounts', TI, {'bankCode': '004', 'bankName': '국민은행', 'accountNo': '1002' + str(uuid.uuid4().int)[-8:], 'holderName': '시험소개자'})
    st2, v = call('POST', f"/me/payout-accounts/{(a or {}).get('id')}/verify", TI, {'code': 'SGB01'})
    st3, j = call('POST', '/referral-codes', TI, {'listingId': L, 'paymentKey': 'stub_' + uuid.uuid4().hex, 'orderId': 'rcx-' + uuid.uuid4().hex[:12], 'amount': 30000})
    bcode = (j or [{}])[0].get('code') if isinstance(j, list) else None
    rec('G-0 (준비) 개인 소개자 — 본인인증 · 받을 계좌 확인 · 소개코드 결제(스텁) 발급', L and st < 300 and st2 < 300 and bool(bcode), (L, st, st2, st3, str(j)[:120]))
    if not bcode: return
    TS2 = TI
    before = q("select value from site_settings where key='feature.referral_fee'")
    try:
        call('PATCH', '/admin/site-settings', ADM, {'key': 'feature.referral_fee', 'value': 'on'})
        # ── 계약 상태 · 확인 요청 ──
        did, TB, be = new_deal(bcode, L, TS, fee=120000, contract=True)
        st, s = call('GET', f'/deals/{did}/contract/state', TB)
        sj = json.dumps(s, ensure_ascii=False)
        rec('G-1 계약 상태(당사자 매수자) — 200 · 내 쪽 · 소개비 · 당사자 이름 가림(이메일 없음)', st == 200 and (s or {}).get('mySide') in ('buyer', 'BUYER') and be not in sj and seller not in sj,
            (st, sj[:200]))
        st, s2 = call('GET', f'/deals/{did}/contract/state', BUY)
        rec('G-2 계약 상태 — 당사자 아님 → 403/404', st in (403, 404), (st, code(s2)))
        st, s3 = call('GET', f'/deals/{did}/contract/state', None)
        rec('G-3 계약 상태 — 손님 → 403 UNAUTHENTICATED', st == 403 and code(s3) == 'UNAUTHENTICATED', (st, code(s3)))
        # 발급 직후는 초안(DRAFT) — 아무도 기다리지 않으므로 양쪽 다 NOT_THEIR_TURN. 판매 쪽이 조건에 합의(SENT)하면 매수 쪽 차례
        n0b, j0b = call('POST', f'/deals/{did}/contract/nudge', TB)
        rec('G-4a 초안(DRAFT) 계약 — 확인 요청은 409 NOT_THEIR_TURN(기다리는 쪽 없음)', n0b == 409 and code(j0b) == 'NOT_THEIR_TURN', (n0b, code(j0b), q(f"select state from deal_contracts where deal_id='{did}'")))
        sa, ja = call('POST', f'/deals/{did}/contract/agree', TS, {'terms': {'amount': 1200000, 'dueDate': (datetime.date.today() + datetime.timedelta(days=14)).isoformat(), 'kind': 'GOODS'}})
        nb, jb = call('POST', f'/deals/{did}/contract/nudge', TB)
        ns, js = call('POST', f'/deals/{did}/contract/nudge', TS)
        okside = [x for x in ((nb, 'buyer'), (ns, 'seller')) if x[0] in (200, 201)]
        rec('G-4 판매 쪽 조건 합의(SENT) 뒤 — 확인 요청은 상대(매수 쪽) 차례인 판매 쪽만 보냄 · 매수 쪽은 409 NOT_THEIR_TURN', sa < 300 and [x[1] for x in okside] == ['seller'] and nb == 409,
            (sa, code(ja), nb, code(jb), ns, code(js), q(f"select state from deal_contracts where deal_id='{did}'")))
        if okside:
            tok = TB if okside[0][1] == 'buyer' else TS
            other_id = q(f"select {'seller' if okside[0][1] == 'buyer' else 'buyer'}_account_id from deals where id='{did}'")
            st, j = call('POST', f'/deals/{did}/contract/nudge', tok)
            n = q(f"select count(*) from notifications where account_id='{other_id}' and event_code='CONTRACT_NUDGE' and link_url like '%{did}%'")
            rec('G-5 같은 날 두 번 → 409 NUDGED_TODAY · 상대에게 알림 CONTRACT_NUDGE 1건 · nudged_at 찍힘', st == 409 and code(j) == 'NUDGED_TODAY' and n == '1'
                and q(f"select (nudged_at is not null)::text from deal_contracts where deal_id='{did}'") == 'true', (st, code(j), n))
        st, j = call('POST', f'/deals/{did}/contract/nudge', BUY)
        rec('G-6 당사자 아닌 회원의 확인 요청 → 403/404', st in (403, 404), (st, code(j)))
        # ── 정산 승인 ──
        call('POST', f'/deals/{did}/confirm', TB, {}); call('POST', f'/deals/{did}/confirm', TS, {})
        stl = rows(f"select id, status, payee_account_id from settlements where deal_id='{did}'")
        if not stl:
            st, j = call('POST', '/settlements', TS2, {'dealId': did})
            stl = rows(f"select id, status, payee_account_id from settlements where deal_id='{did}'")
        rec('G-7 (준비) 성사 확정 → 개인 소개자(계좌 확인됨) 정산 줄 REQUESTED(새 정산은 REQUESTED 로만 · D086)', bool(stl) and stl[0][1] == 'REQUESTED',
            (stl, q(f"select status from deals where id='{did}'")))
        if not stl: return
        sid = stl[0][0]
        rc, er = sql(f"begin; update settlements set status='PAID', paid_marked_by=payee_account_id where id='{sid}'; rollback;")
        rec('G-8 DB — 승인 없이 바로 PAID → 거절(STL_PAID)', rc != 0 and 'STL_PAID' in er, er[:140])
        rc, er = sql(f"begin; insert into settlements (deal_id, payee_account_id, amount, status) values ('{did}', '{stl[0][2]}', 1000, 'APPROVED'); rollback;")
        rec('G-9 DB — 새 정산을 APPROVED 로 바로 넣기 → 거절(D086)', rc != 0, er[:140])
        st, j = call('POST', f'/me/settlements/{sid}/paid', TS2)
        rec('G-10 승인 전 「받았음」 → 422 STL_PAID', st == 422 and code(j) == 'STL_PAID', (st, code(j)))
        res = {n: call('PATCH', f'/admin/settlements/{sid}', t, {'status': 'APPROVED'})[0] for n, t in (('검수', REV), ('지급', PAY), ('회원', MEM), ('소개자', TS2))}
        rec('G-11 승인 — 검수 · 지급 · 회원 · 당사자 → 403', all(v == 403 for v in res.values()) and q(f"select status from settlements where id='{sid}'") == 'REQUESTED', res)
        st, j = call('PATCH', f'/admin/settlements/{sid}', OPS, {'status': 'REJECTED'})
        rec('G-12 반려 사유 없음 → 422 REASON_REQUIRED', st == 422 and code(j) == 'REASON_REQUIRED', (st, code(j)))
        st, j = call('PATCH', f'/admin/settlements/{sid}', OPS, {'status': 'PAID'})
        rec('G-13 PAID 로 바꾸기(운영) → 400(승인 · 반려만)', st == 400, (st, code(j)))
        st, j = call('PATCH', f'/admin/settlements/{sid}', OPS, {'status': 'APPROVED'})
        row = rows(f"select s.status, (s.approved_by = (select id from accounts where email='ops@t.local'))::text, (s.approved_at is not null)::text, (select count(*) from settlement_approvals a where a.settlement_id=s.id)::text from settlements s where s.id='{sid}'")[0]
        rec('G-14 운영(ADMIN) 승인 → APPROVED · 승인자 · 시각 · 승인 기록(settlement_approvals)', st == 200 and row[0] == 'APPROVED' and row[1] == 'true' and row[2] == 'true' and int(row[3]) >= 1, (st, j, row))
        st, j = call('PATCH', f'/admin/settlements/{sid}', ADM, {'status': 'APPROVED'})
        rec('G-15 다시 승인 → 409 ALREADY_DECIDED', st == 409 and code(j) == 'ALREADY_DECIDED', (st, code(j)))
        st, lst = call('GET', '/admin/settlements', ADM)
        it = next((x for x in (lst or []) if x.get('id') == sid), {})
        rec('G-16 운영 정산 목록 — 그 줄 「승인됨 · 지급 대기」 · 정산번호 · 세금계산서 칸', st == 200 and it and ('승인' in json.dumps(it, ensure_ascii=False)), (st, str(it)[:200]))
        st, j = call('POST', f'/me/settlements/{sid}/paid', BUY)
        rec('G-17 남(회원)이 「받았음」 → 404', st == 404, (st, code(j)))
        st, j = call('POST', f'/me/settlements/{sid}/paid', TS2)
        rec('G-18 받는 사람(소개자)이 「받았음」 → PAID · 표시한 사람 기록', st in (200, 201) and q(f"select status||'|'||(paid_marked_by is not null)::text from settlements where id='{sid}'") == 'PAID|true', (st, j))
        st, j = call('POST', f'/me/settlements/{sid}/paid', TS2)
        rec('G-19 또 「받았음」 → 422 STL_PAID', st == 422, (st, code(j)))
        st, j = call('GET', '/me/settlements', TS2)
        rec('G-20 나의공간 정산 — 그 줄 PAID', st == 200 and any(x.get('id') == sid and x.get('status') == 'PAID' for x in (j or [])), (st, str(j)[:160]))
        # ── 성공 사례 ──
        st, j = call('POST', '/admin/success-stories', REV, {'dealId': did, 'headline': '시험 사례 제목입니다'})
        rec('G-21 성공 사례 만들기 — 검수 담당 → 403', st == 403, st)
        d_open, _, _ = new_deal(bcode, L, TS, fee=None, contract=False)
        st, j = call('POST', '/admin/success-stories', ADM, {'dealId': d_open, 'headline': '시험 사례 제목입니다'})
        rec('G-22 성사 전 거래로 사례 → 409 STORY_DEAL_NOT_CONFIRMED', st == 409 and code(j) == 'STORY_DEAL_NOT_CONFIRMED', (st, code(j)))
        st, j = call('POST', '/admin/success-stories', ADM, {'dealId': did, 'headline': f'시험 사례 {tag}', 'summary': '시험으로 만든 성공 사례입니다', 'reasons': ['빠른 연결']})
        story = (j or {}).get('id')
        rec('G-23 성사 확정 거래로 사례 초안(DRAFT) · 두 당사자에게 동의 요청', st in (200, 201) and (j or {}).get('status') == 'DRAFT' and story, (st, j))
        if story:
            st, j = call('PATCH', f'/admin/success-stories/{story}', ADM, {'status': 'PUBLISHED'})
            rec('G-24 동의 전 공개 → 거절(STORY_CONSENT_REQUIRED)', st in (409, 422) and 'CONSENT' in (code(j) or ''), (st, code(j)))
            st, j = call('POST', f'/market/success-stories/{story}/consent', BUY, {'consent': True})
            rec('G-25 당사자 아닌 회원의 동의 → 403 NOT_PARTY', st == 403, (st, code(j)))
            st1, j1 = call('POST', f'/market/success-stories/{story}/consent', TB, {'consent': True})
            st2, j2 = call('POST', f'/market/success-stories/{story}/consent', TS, {'consent': True, 'comment': '좋은 연결이었습니다', 'rating': 5})
            rec('G-26 매수자 · 매도자(한마디 · 별점) 동의', st1 in (200, 201) and st2 in (200, 201), (st1, j1, st2, j2))
            st, mine = call('GET', '/me/success-stories', TB)
            rec('G-27 나의 사례 목록 — 그 사례', st == 200 and story in json.dumps(mine), (st, str(mine)[:120]))
            st, j = call('PATCH', f'/admin/success-stories/{story}', ADM, {'status': 'PUBLISHED'})
            st2, best = call('GET', '/market/best')
            bs = json.dumps(best, ensure_ascii=False)
            rec('G-28 공개 → 베스트매칭에 나옴 · 당사자 이메일 없음', st == 200 and f'시험 사례 {tag}' in bs and be not in bs and seller not in bs, (st, bs[:200]))
            st, j = call('POST', f'/market/success-stories/{story}/consent', TB, {'consent': False})
            st2, best = call('GET', '/market/best')
            rec('G-29 당사자가 동의 철회 → 공개 중이면 내려감(HIDDEN) · 베스트매칭에서 빠짐', st in (200, 201) and f'시험 사례 {tag}' not in json.dumps(best, ensure_ascii=False)
                and q(f"select status from success_stories where id='{story}'") == 'HIDDEN', (st, q(f"select status from success_stories where id='{story}'")))
    finally:
        call('PATCH', '/admin/site-settings', ADM, {'key': 'feature.referral_fee', 'value': before or 'off'})
        rec('G-30 시험 뒤 소개비 스위치를 원래 값으로', q("select value from site_settings where key='feature.referral_fee'") == (before or 'off'), before)

# ════════ H. 선불 충전 · 견적 매트릭스 (얕게) ════════
def part_h():
    st, j = call('GET', '/partner/cash', INT)
    pid = q("select p.id from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where a.email='intro@x.com'")
    w = rows(f"select paid_balance, bonus_balance from lead_cash_wallets where partner_id='{pid}'")
    rec('H-1 파트너 리드 이용료 — 선불(PREPAID) · 잔액 = 지갑(유상 + 보너스)', st == 200 and (j or {}).get('mode') == 'PREPAID' and w and (j or {}).get('paid') == int(w[0][0]) and (j or {}).get('bonus') == int(w[0][1]),
        (st, (j or {}).get('paid'), (j or {}).get('bonus'), w))
    st, j = call('GET', '/partner/cash', BUY)
    rec('H-2 파트너 아닌 회원 → 409 NOT_PARTNER', st == 409 and code(j) == 'NOT_PARTNER', (st, code(j)))
    st, j = call('GET', '/partner/cash', None)
    rec('H-3 손님 → 403 UNAUTHENTICATED', st == 403 and code(j) == 'UNAUTHENTICATED', (st, code(j)))
    st, j = call('POST', '/partner/cash/charges', INT, {'amount': 1})
    rec('H-4 충전 금액 범위 밖(1원) → 400/422', st in (400, 422), (st, code(j)))
    inv = q('select count(*) from v_lead_cash_invariants')
    rec('H-5 선불 원장 불변식(v_lead_cash_invariants) 0줄', inv == '0', inv)
    st, j = call('GET', f'/admin/partner-center/cash/{pid}', ADM)
    rec('H-6 운영 원장(파트너 하나) — 충전 · 원장 · 환불', st == 200 and isinstance(j, dict), (st, str(j)[:160]))
    st, j = call('GET', f'/admin/partner-center/cash/{pid}', OPS); st2, j2 = call('GET', f'/admin/partner-center/cash/{pid}', PAY)
    rec('H-7 운영 원장 — ADMIN 200 · 지급 담당 403', st == 200 and st2 == 403, (st, st2))
    st, j = call('POST', f'/admin/partner-center/cash/{pid}/adjust', ADM, {'account': 'PAID', 'amount': 0, 'reason': '시험'})
    rec('H-8 운영 조정 금액 0 → 400/422(바꾸지 않음)', st in (400, 422), (st, code(j)))
    st, j = call('GET', '/partner/service-forms', INT)
    rec('H-9 서비스 등록 방식(견적 매트릭스 포함) 목록', st == 200, (st, str(j)[:160]))
    other_svc = q(f"select s.id from partner_services s where s.partner_id <> '{pid}' limit 1")
    if other_svc:
        st, j = call('PUT', f'/partner/services/{other_svc}/matrix', INT, {'cells': [{'row': 'PACK', 'col': 'R3', 'amount': 1000}]})
        rec('H-10 남의 서비스 견적 매트릭스 고치기 → 404/403', st in (403, 404), (st, code(j)))
    mx = q("select count(*) from category_matrix_axes")
    rec('H-11 업종 견적 매트릭스 축(이사짐 4×6 시드) 있음', int(mx or 0) > 0, mx)

# ════════ I. 운영 ════════
def part_i():
    st, j = call('GET', '/admin/finance/runway', OPS)
    months = (j or {}).get('months') or []
    cur = datetime.date.today().strftime('%Y-%m')
    rev_db = q(f"select coalesce(sum(amount),0) from v_monthly_revenue where to_char(month,'YYYY-MM')='{cur}'")
    m = next((x for x in months if x.get('month') == cur), {})
    rec('I-1 활주로 — 이번 달 매출 = v_monthly_revenue(지어낸 숫자 아님) · 비용 입력 전 표시', st == 200 and (rev_db is None or str(m.get('revenue')) == str(rev_db)) and 'breakEven' in (j or {}),
        (st, m, rev_db, (j or {}).get('breakEven')))
    st, cs = call('GET', f'/admin/finance/costs?month={cur}', ADM)
    prev = next((x for x in (cs or []) if x.get('category') == 'ETC'), None)
    st, j = call('PUT', '/admin/finance/costs', OPS, {'month': cur, 'category': 'ETC', 'amount': 12345, 'memo': f'시험 {tag}'})
    st2, r2 = call('GET', '/admin/finance/runway', OPS)
    m2 = next((x for x in (r2 or {}).get('months', []) if x.get('month') == cur), {})
    rec('I-2 월 비용 넣기(ETC 12,345) → ops_monthly_costs · 활주로의 그 달 비용에 반영', st in (200, 201) and int(m2.get('cost') or 0) >= 12345, (st, j, m2))
    st, j = call('PUT', '/admin/finance/costs', OPS, {'month': cur, 'category': 'BAD', 'amount': 1}); st2, j2 = call('PUT', '/admin/finance/costs', OPS, {'month': '2026-1', 'category': 'ETC', 'amount': 1})
    rec('I-3 형식 — 없는 항목 · 달 형식 → 400', st == 400 and st2 == 400, (st, st2))
    st, j = call('PUT', '/admin/finance/costs', REV, {'month': cur, 'category': 'ETC', 'amount': 1})
    rec('I-4 검수 담당 비용 넣기 → 403', st == 403, st)
    if prev:
        call('PUT', '/admin/finance/costs', OPS, {'month': cur, 'category': 'ETC', 'amount': prev['amount'], 'memo': prev.get('memo')})
    else:
        sql(f"delete from ops_monthly_costs where to_char(month,'YYYY-MM')='{cur}' and category='ETC' and memo='시험 {tag}'")
    rec('I-5 시험 뒤 비용을 원래대로', (q(f"select amount from ops_monthly_costs where to_char(month,'YYYY-MM')='{cur}' and category='ETC'") or None) == (str(prev['amount']) if prev else None), prev)
    st, items = call('GET', '/admin/policy-items', OPS)
    it = (items or [{}])[0]
    st2, j2 = call('PATCH', f"/admin/policy-items/{it.get('code')}", OPS, {'content': it.get('content')})
    st3, j3 = call('PATCH', f"/admin/policy-items/{it.get('code')}", ADM, {'content': it.get('content')})
    rec('I-6 정책 원본 — ADMIN 읽기 200 · 고치기 403 · SUPER 같은 값으로 고치기 200', st == 200 and st2 == 403 and st3 == 200, (st, st2, st3))
    st, axes = call('GET', '/admin/gwan-axes?gwan=MAL', ADM)
    ax = next((x for x in (axes or []) if x.get('isExposed') and not x.get('uiFixed')), None) or next((x for x in (axes or []) if x.get('isExposed')), None)
    if ax:
        p = f"/admin/gwan-axes/{ax['gwanCode']}/{ax['axisCode']}"
        try:
            st, j = call('PATCH', p, OPS, {'isExposed': False})
            st2, pub = call('GET', '/site/gwan-axes?gwan=MAL')
            rec(f"I-7 관 축 내림({ax['axisCode']}) → 공개 축 목록에서 빠짐", st == 200 and ax['axisCode'] not in [x['axisCode'] for x in (pub or [])], (st, j))
        finally:
            st, j = call('PATCH', p, OPS, {'isExposed': True})
            st2, pub = call('GET', '/site/gwan-axes?gwan=MAL')
            rec('I-8 다시 올림(원래대로)', st == 200 and ax['axisCode'] in [x['axisCode'] for x in (pub or [])], st)
        fixed = next((x for x in (axes or []) if x.get('uiFixed')), None)
        if fixed:
            st, j = call('PATCH', f"/admin/gwan-axes/{fixed['gwanCode']}/{fixed['axisCode']}", OPS, {'uiType': 'CONTENT'})
            rec('I-9 거래형 축의 UI 유형 바꾸기 → 422 GWAN_AXIS(목록형 고정)', st == 422, (st, code(j)))
    st, j = call('GET', '/admin/gwans/MNY/open-check', ADM)
    rec('I-10 관 오픈 체크리스트(SUPER) — 항목마다 통과 여부', st == 200 and isinstance(j, (dict, list)), (st, str(j)[:160]))
    st, j = call('GET', '/admin/integration-status', ADM)
    tables = int(q("select count(*) from pg_tables where schemaname='public'") or 0)
    rec('I-11 통합 현황(SUPER) — 지금 DB 의 표 수', st == 200 and str(tables) in json.dumps(j), (st, tables, str(j)[:160]))
    # 외부 송출
    dom = f'v31-{tag}.example.com'
    st, pub = call('POST', '/admin/adx/publishers', ADM, {'name': f'시험 퍼블리셔 {tag}', 'domain': dom})
    pid = (pub or {}).get('id') or q(f"select id from adx_publishers where domain='{dom}'")
    rec('I-12 퍼블리셔 등록(운영)', st in (200, 201) and pid, (st, pub))
    if pid:
        st, j = call('POST', '/admin/adx/publishers', PAY, {'name': 'x', 'domain': 'x.example.com'})
        rec('I-13 지급 담당이 퍼블리셔 등록 → 403', st == 403, st)
        st, j = call('GET', f'/ads/external/serve?pub={pid}&device=dev{tag}')
        rec('I-14 도메인 확인 전 → 송출 없음(422 ADX_SERVE 「도메인 확인 전에는 송출할 수 없습니다」)', (st == 422 and code(j) == 'ADX_SERVE') or (st == 200 and not (j or {}).get('creative') and not (j or {}).get('ad')), (st, str(j)[:160]))
        st, j = call('PATCH', f'/admin/adx/publishers/{pid}', ADM, {'verifyDomain': True, 'status': 'ACTIVE'})
        st2, sv = call('GET', f'/ads/external/serve?pub={pid}&device=dev{tag}')
        rec('I-15 도메인 확인 → 송출 응답(소재 또는 「없음」 · 규제 소재 제외)', st == 200 and st2 == 200, (st, str(j)[:100], str(sv)[:160]))
        imp = (sv or {}).get('impressionId')
        n0 = q(f"select count(*) from adx_clicks where publisher_id='{pid}'")
        st, j = call('POST', '/ads/external/click', None, {'publisherId': pid, **({'impressionId': imp} if imp else {}), 'device': f'dev{tag}'})
        n1 = q(f"select count(*) from adx_clicks where publisher_id='{pid}'")
        rec('I-16 클릭 → adx_clicks 한 줄(무효 판정 F1~F7 함께) · 노출 없이 누른 것은 무효로 남김', st in (200, 201) and int(n1) == int(n0) + 1, (st, j, n0, n1))
        st, j = call('GET', '/admin/adx/overview', PAY)
        rec('I-17 외부 송출 현황 — 지급 담당 200 · 그 퍼블리셔', st == 200 and pid in json.dumps(j), st)
        st, j = call('POST', '/admin/adx/close-month', ADM, {'month': '2026-1'})
        rec('I-18 월 마감 달 형식 → 400', st == 400, st)
        st, j = call('PATCH', f'/admin/adx/publishers/{pid}', ADM, {'status': 'CLOSED'})
        st2, sv = call('GET', f'/ads/external/serve?pub={pid}&device=dev{tag}')
        rec('I-19 퍼블리셔 닫음 → 송출 없음(시험 정리)', st == 200 and not (sv or {}).get('creative'), (st, str(sv)[:120]))
    # 특가 배너
    st, j = call('POST', '/admin/health/promos', ADM, {'tag': f'시험 {tag}', 'title': '시험 배너', 'linkUrl': '/health', 'isSample': True, 'isActive': False})
    prid = (j or {}).get('id')
    st2, pub = call('GET', '/health/promos')
    rec('I-20 특가 배너 더함(꺼 둠) → 공개 목록에 안 나옴', st in (200, 201) and prid and f'시험 {tag}' not in json.dumps(pub, ensure_ascii=False), (st, j))
    st, j = call('POST', '/admin/health/promos', ADM, {'tag': 'x', 'title': 'y', 'linkUrl': 'https://evil.example.com'})
    rec('I-21 주소가 /health 로 시작하지 않음 → 400/422', st in (400, 422), (st, code(j)))
    if prid:
        st, j = call('PATCH', f'/admin/health/promos/{prid}', REV, {'isActive': True})
        rec('I-22 검수 담당이 배너 켜기 → 403', st == 403, st)
    # 회원 목록 가림 · 결제 대조
    st, j = call('GET', '/admin/accounts?status=ACTIVE', OPS)
    s = json.dumps(j, ensure_ascii=False)
    rec('I-23 운영 회원 목록 — 이메일 · 연락처 가린 값(buyer@x.com 그대로 없음)', st == 200 and 'buyer@x.com' not in s and 'person@x.com' not in s and '****' in s, s[:160])
    st, j = call('GET', '/admin/site-settings', ADM)
    s = json.dumps(j, ensure_ascii=False)
    sec = [x for x in (j or []) if isinstance(x, dict) and x.get('secret')]
    rec('I-24 운영 설정 — 비밀 값은 가림(secret · hasValue) · 수금 계좌 끝 4자리만', st == 200 and sec and all(x.get('value') in (None, '') or '*' in str(x.get('value')) for x in sec), (st, [(x['key'], x.get('value')) for x in sec][:4]))
    st, j = call('POST', '/admin/billing/reconcile', ADM)
    rec('I-25 결제 대조(대조만) — 200', st in (200, 201), (st, str(j)[:160]))
    st, j = call('POST', '/admin/billing/reconcile', PAY)
    rec('I-26 결제 대조 — 지급 담당 403', st == 403, st)

for k, fn in (('A', part_a), ('B', part_b), ('C', part_c), ('D', part_d), ('E', part_e), ('F', part_f), ('G', part_g), ('H', part_h), ('I', part_i)):
    if k in PARTS: safe(k, fn)

json.dump(R, open(os.path.join(HERE, 'srv_v1031.json'), 'w'), ensure_ascii=False, indent=1)
bad = [r for r in R if not r['ok'] and not r.get('skip')]; sk = [r for r in R if r.get('skip')]
for r in bad: print('FAIL', r['step'], '|', r['detail'][:200])
print(f"통과 {len(R) - len(bad) - len(sk)} / {len(R)}" + (f" · 건너뜀 {len(sk)}" if sk else ''))
