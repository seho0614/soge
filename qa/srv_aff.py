"""D001 — 제휴 링크 클릭 기록 · 파트너 정산 계좌 1원 재인증 (작업자 aff, 2026-10-02).

사용:  API=http://localhost:3011/api/v1 python3 srv_aff.py      (기본 3000)
결과:  srv_aff.json
원복:  시험 링크·시험 정산서·시험 계좌를 지우고, intro 의 정산 계좌는 새 인증 API 로 인증 상태로 둡니다.
"""
import json, os, sys, uuid, subprocess, urllib.request, urllib.error
B = os.environ.get('API') or (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000/api/v1')
DB = 'postgresql://sgb:sgb@localhost:5432/sgb'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
R = []

def q(s):
    return subprocess.run(['psql', DB, '-tAc', s], capture_output=True, text=True).stdout.strip().split('\n')[0]

def sql(s):
    p = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-qc', s], capture_output=True, text=True)
    return p.returncode, (p.stderr or '').strip()

def call(m, p, tok=None, body=None, headers=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'user-agent': UA}
    if tok: h['authorization'] = 'Bearer ' + tok
    if headers: h.update(headers)
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request(B + p, method=m, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e:
        st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:240]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:150], file=sys.stderr)

def login(e, pw='sgb-dev-1234'):
    return call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']

ADM = login('admin@x.com'); SEL = login('intro@x.com'); BUY = login('buyer@x.com')
OPS = login('ops@t.local', 'sgb-test-1234')
PID = q("select p.id from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where a.email='intro@x.com'")
ACC = {'bankCode': '004', 'bankName': '국민은행', 'accountNo': '123-456-789012', 'holderName': '김소개'}

# ═════════ A. 제휴 링크 클릭 ═════════
prod = q("select id from affiliate_products where status='ON_SALE' and landing_url ~ '^https?://' order by created_at limit 1")
land = q(f"select landing_url from affiliate_products where id='{prod}'")
st, j = call('POST', '/partner/affiliate/links', SEL, {'productId': prod, 'label': 'D001 검증'})
CODE = j.get('code') if j else None
LID = q(f"select id from partner_links where code='{CODE}'")
rec('A-0 시험 링크 발급', st < 300 and CODE, j)
clk = lambda code=CODE, v=None, ua=UA, xff='203.0.113.7': call('GET', f'/r/{code}', headers={
    **({'X-Visitor-Key': v} if v else {}), 'user-agent': ua, 'X-Forwarded-For': xff})
stat = lambda: int(q(f"select coalesce(sum(clicks),0) from partner_link_stats where link_id='{LID}'") or 0)
V1, V2 = str(uuid.uuid4()), str(uuid.uuid4())
st, j = clk(v=V1)
rec('A-1 공개 클릭 → 착지 주소 · 1회 셈 (로그인 없이)', st == 200 and j['landingUrl'] == land and j['counted'] is True and stat() == 1, (st, j))
st, j = clk(v=V1)
rec('A-2 같은 방문자 같은 날 다시 → 안 셈', st == 200 and j['counted'] is False and stat() == 1, (j, stat()))
st, j = clk(v=V2)
rec('A-3 다른 방문자 → 셈', st == 200 and j['counted'] is True and stat() == 2, (j, stat()))
st, j = clk(v=str(uuid.uuid4()), ua='facebookexternalhit/1.1')
st2, j2 = clk(v=str(uuid.uuid4()), ua='Mozilla/5.0 (compatible; kakaotalk-scrap/1.0)')
rec('A-4 미리보기 로봇 → 주소는 주되 안 셈', st == 200 and j['counted'] is False and j2['counted'] is False and stat() == 2, (j, j2, stat()))
st, j = clk(v=None, xff='198.51.100.9'); st2, j2 = clk(v=None, xff='198.51.100.9')
rec('A-5 방문자 쿠키 없음 → IP·UA 해시로 하루 1회', j['counted'] is True and j2['counted'] is False and stat() == 3, (j, j2, stat()))
raw = q(f"select count(*) from partner_link_clicks where link_id='{LID}' and (visitor_hash !~ '^[0-9a-f]{{64}}$' or visitor_hash like '%{V1}%' or visitor_hash like '%198.51%')")
n = q(f"select count(*) from partner_link_clicks where link_id='{LID}'")
rec('A-6 방문자 원문 저장 없음 (해시 64자만)', raw == '0' and n == '3', f'raw={raw} rows={n}')
st, j = call('GET', '/partner/affiliate/links', SEL)
me = next((x for x in (j or []) if x['code'] == CODE), None)
rec('A-7 내 소개링크에 클릭·오늘 클릭·공유 경로', me and me['clicks'] == 3 and me['clicksToday'] == 3 and me['sharePath'] == f'/r/{CODE}', me)
st, j = call('GET', '/partner/affiliate/dashboard', SEL)
rec('A-8 대시보드 이번 달 클릭에 반영', st == 200 and j['month']['clicks'] >= 3, j and j.get('month'))
st, j = clk(code='NOPE-000000')
st2, j2 = clk(code='a')
rec('A-9 없는 코드 · 형식 틀린 코드 → 404', st == 404 and j['code'] == 'NOT_FOUND' and st2 == 404, (st, j, st2))
sql(f"update partner_links set is_active=false where id='{LID}'")
st, j = clk(v=str(uuid.uuid4()))
sql(f"update partner_links set is_active=true where id='{LID}'")
rec('A-10 중지된 링크 → 404 LINK_INACTIVE · 안 셈', st == 404 and j['code'] == 'LINK_INACTIVE' and stat() == 3, (st, j))
off = q("select l.code from partner_links l join affiliate_products p on p.id=l.product_id where p.status<>'ON_SALE' limit 1")
if off:
    st, j = clk(code=off)
    rec('A-11 판매 중 아닌 상품 링크 → 404 PRODUCT_NOT_ON_SALE', st == 404 and j['code'] == 'PRODUCT_NOT_ON_SALE', (off, st, j))
rc1, e1 = sql(f"update partner_links set landing_url='javascript:alert(1)' where id='{LID}'")
rc2, e2 = sql(f"update partner_links set landing_url='//evil.example' where id='{LID}'")
rec('A-12 DB 가 javascript: · //외부 착지 차단 (열린 리다이렉트)', rc1 != 0 and 'LANDING' in e1 and rc2 != 0 and 'LANDING' in e2, (e1[:80], e2[:80]))
sql(f"update partner_links set landing_url='/health' where id='{LID}'")
st, j = clk(v=str(uuid.uuid4()))
rec('A-13 내부 경로 착지 허용', st == 200 and j['landingUrl'] == '/health', j)
sql(f"begin; set local session_replication_role=replica; update partner_links set landing_url='javascript:alert(1)' where id='{LID}'; commit;")
st, j = clk(v=str(uuid.uuid4()))
rec('A-14 (트리거 우회로 들어간) 위험 착지 → API 도 404 BAD_LANDING', st == 404 and j['code'] == 'BAD_LANDING', (st, j))
sql(f"begin; set local session_replication_role=replica; update partner_links set landing_url=null where id='{LID}'; commit;")
pc = 'D001-X-' + uuid.uuid4().hex[:6]
st, j = call('POST', '/admin/affiliates/products', ADM, {'code': pc, 'name': 'D001 위험 착지', 'commission': 1000, 'landingUrl': 'javascript:alert(1)//'})
rec('A-15 운영 상품 등록 — javascript: 착지 422', st == 422 and j['code'] == 'LANDING' and q(f"select count(*) from affiliate_products where code='{pc}'") == '0', (st, j))
st, j = call('GET', '/admin/affiliates/applications', ADM)
exp = int(q("select count(*) from partners p join businesses b on b.id=p.business_id where p.status='APPLIED'"))
rec('A-16 (회귀) 입점 심사 목록 = APPLIED 건수', st == 200 and len(j['items']) == exp, f"{len(j['items'])}/{exp}")

# ═════════ B. 정산 계좌 1원 재인증 ═════════
st, j = call('POST', '/partner/affiliate/settlement-account/verify/request')
rec('B-1 비로그인 → 403', st == 403, (st, j))
st, j = call('POST', '/partner/affiliate/settlement-account/verify/request', BUY)
rec('B-2 파트너 아님 → ok:false', st < 300 and j['ok'] is False, j)
e = f'aff_{uuid.uuid4().hex[:6]}@t.local'
call('POST', '/auth/signup', body={'email': e, 'password': 'sgb-test-1234', 'name': '미인증'})
NOID = login(e, 'sgb-test-1234')
s1, j1 = call('POST', '/partner/affiliate/settlement-account/verify/request', NOID)
s2, j2 = call('POST', '/partner/affiliate/settlement-account/verify', NOID, {'code': 'SGB01'})
rec('B-3 본인인증 없으면 → 403 IDENTITY_REQUIRED (두 API)', s1 == 403 and j1['code'] == 'IDENTITY_REQUIRED' and s2 == 403, (s1, j1, s2))

# 지급 창구 확인용 시험 정산서 (확정 상태)
SID = str(uuid.uuid4())
# v10.40 — 지급까지 간 시험 정산서는 지울 수 없어(PAID) 남습니다. 같은 기간이 걸리면(UNIQUE) 준비가 실패하던 것 — 비어 있는 기간을 고를 때까지 다시
for _try in range(8):
    if sql(f"insert into partner_settlements(id,partner_id,track,period_from,period_to,gross_amount,withholding,net_amount) values ('{SID}','{PID}','AFFILIATE','2031-01-01'::date + (random()*330)::int, '2031-12-31', 1000, 33, 967)")[0] == 0: break
st, j = call('POST', f'/admin/payouts/partner/{SID}/confirm', OPS, {})
rec('B-4 (준비) 시험 정산서 확정', st < 300 and q(f"select state from partner_settlements where id='{SID}'") == 'CONFIRMED', (st, j))

st, j = call('POST', '/partner/affiliate/settlement-account', SEL, ACC)
rec('B-5 계좌 재등록 → 인증 풀림', st < 300 and j['ok'] and q(f"select verified_at is null from partner_settlement_accounts where partner_id='{PID}'") == 't', j)
bl = q(f"select coalesce(blocker,'-') from v_payout_queue where id='{SID}'")
rec('B-6 지급 창구 blocker = 계좌 1원 인증 전', bl == '계좌 1원 인증 전', bl)
st, j = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': 'SGB01'})
rec('B-7 1원 받기 전 확인 → 409 NOT_REQUESTED', st == 409 and j['code'] == 'NOT_REQUESTED', (st, j))
st, j = call('POST', '/partner/affiliate/settlement-account/verify/request', SEL)
rec('B-8 1원 받기 → 스텁 · 코드 · 10분 만료', st < 300 and j['ok'] and j['stub'] is True and j.get('devCode') == 'SGB01' and j['expiresAt']
    and q(f"select (verify_expires_at between now()+interval '9 min' and now()+interval '11 min') and verify_code_hash ~ '^[0-9a-f]{{64}}$' from partner_settlement_accounts where partner_id='{PID}'") == 't', j)
st, j = call('POST', '/partner/affiliate/settlement-account/verify/request', SEL)
rec('B-9 바로 다시 받기 → 422 TOO_SOON', st == 422 and j['code'] == 'TOO_SOON', (st, j))
st, j = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': '!!'})
st2, j2 = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {})
rec('B-10 코드 형식 틀림·없음 → 400', st == 400 and st2 == 400, (st, j, st2))
st, j = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': 'WRONG1'})
rec('B-11 틀린 코드 → 422 CODE_MISMATCH · 시도 1', st == 422 and j['code'] == 'CODE_MISMATCH' and q(f"select verify_tries from partner_settlement_accounts where partner_id='{PID}'") == '1', (st, j))
st, j = call('GET', '/partner/affiliate/settlements', SEL)
a = j['account']
rec('B-12 정산내역에 인증 진행 상태', a['verifiedAt'] is None and a['verifyPending'] is True and a['verifyTries'] == 1 and a['verifyLocked'] is False, a)
sql(f"update partner_settlement_accounts set verify_expires_at=now()-interval '1 min' where partner_id='{PID}'")
st, j = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': 'SGB01'})
rc, err = sql(f"update partner_settlement_accounts set verified_at=now() where partner_id='{PID}'")
rec('B-13 만료된 코드 → 422 CODE_EXPIRED · DB 도 차단', st == 422 and j['code'] == 'CODE_EXPIRED' and rc != 0 and 'VERIFY_EXPIRED' in err, (st, j, err[:80]))
sql(f"update partner_settlement_accounts set verify_sent_at=now()-interval '1 min' where partner_id='{PID}'")
st, j = call('POST', '/partner/affiliate/settlement-account/verify/request', SEL)
rec('B-14 다시 받기 → 새 코드', st < 300 and j['ok'] and j['stub'], j)
st, j = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': ' sgb01 '})
row = q(f"select (verified_at is not null)::text||'/'||coalesce(verify_code_hash,'null')||'/'||verify_tries from partner_settlement_accounts where partner_id='{PID}'")
rec('B-15 맞는 코드(대소문자·공백 무시) → 인증 · 코드 지움 · 시도 0', st < 300 and j['ok'] and j['verified'] and row == 'true/null/0', (j, row))
bl = q(f"select ready::text||'/'||coalesce(blocker,'-') from v_payout_queue where id='{SID}'")
st, j = call('GET', '/admin/payouts', ADM)
qrow = next((x for x in j['queue'] if x['id'] == SID), None)
rec('B-16 지급 창구 blocker 풀림 (v_payout_queue · GET /admin/payouts)', bl == 'true/-' and qrow and qrow['ready'] is True and qrow['blocker'] is None, (bl, qrow))
s1, j1 = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': 'SGB01'})
s2, j2 = call('POST', '/partner/affiliate/settlement-account/verify/request', SEL)
rec('B-17 인증된 뒤 다시 → 이미 인증됨(변화 없음)', j1['verified'] and j2['verified'] and j2.get('devCode') is None, (j1, j2))

# ═════════ C. 다섯 번 틀리면 막힘 (intro 로 시험 → 재등록·재인증으로 원복) ═════════
call('POST', '/partner/affiliate/settlement-account', SEL, ACC)
call('POST', '/partner/affiliate/settlement-account/verify/request', SEL)
codes = [call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': f'BAD{i}'}) for i in range(5)]
rec('C-1 다섯 번째 틀림 → 422 TOO_MANY_TRIES', [c[1]['code'] for c in codes] == ['CODE_MISMATCH'] * 4 + ['TOO_MANY_TRIES'], [c[1]['code'] for c in codes])
s1, j1 = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': 'SGB01'})
s2, j2 = call('POST', '/partner/affiliate/settlement-account/verify/request', SEL)
rec('C-2 막힌 뒤 맞는 코드·다시 받기도 422', s1 == 422 and j1['code'] == 'TOO_MANY_TRIES' and s2 == 422 and j2['code'] == 'TOO_MANY_TRIES', (j1, j2))
rc, err = sql(f"update partner_settlement_accounts set verified_at=now() where partner_id='{PID}'")
rec('C-3 DB 도 막힌 계좌 인증 차단', rc != 0 and 'VERIFY_LOCKED' in err, err[:100])
st, j = call('GET', '/partner/affiliate/settlements', SEL)
rec('C-4 정산내역에 막힘 표시', j['account']['verifyLocked'] is True, j['account'])
bl = q(f"select coalesce(blocker,'-') from v_payout_queue where id='{SID}'")
rec('C-5 막힌 동안 지급 창구 blocker 유지', bl == '계좌 1원 인증 전', bl)
call('POST', '/partner/affiliate/settlement-account', SEL, ACC)
rec('C-6 계좌 다시 등록 → 시도·코드 초기화(DB 트리거)', q(f"select verify_tries||'/'||(verify_code_hash is null)::text||'/'||(verified_at is null)::text from partner_settlement_accounts where partner_id='{PID}'") == '0/true/true', '')
s1, j1 = call('POST', '/partner/affiliate/settlement-account/verify/request', SEL)
s2, j2 = call('POST', '/partner/affiliate/settlement-account/verify', SEL, {'code': j1.get('devCode') or 'SGB01'})
rec('C-7 재등록 뒤 다시 인증 → 풀림', s2 < 300 and j2['verified'] is True, j2)

# ═════════ 원복 ═════════
sql(f"delete from partner_settlements where id='{SID}'")
sql(f"delete from partner_links where id='{LID}'")
fin = q(f"select (verified_at is not null)::text from partner_settlement_accounts where partner_id='{PID}'")
rec('Z-1 원복 — intro 정산 계좌 인증 상태 · 시험 링크/정산서 삭제', fin == 'true' and q(f"select count(*) from partner_links where id='{LID}'") == '0', fin)

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_aff.json'), 'w'), ensure_ascii=False, indent=1)
print(f"통과 {sum(r['ok'] for r in R)} / {len(R)}")
