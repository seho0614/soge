"""v10.37 시험 — P2P(10/13 대표 지시 「모두 개인에게 허용 · 등록 시 인증이 필요한 경우만 그 인증」)

  API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 DB=postgresql://sgb:sgb@localhost:5432/sgb python3 test_v1037.py

  개인 회원 = member@t.local(본인인증 · 사업자 없음 · MEMBER). 막힌 것이 「역할 · 사업자」(403 FORBIDDEN · BUSINESS_REQUIRED)가 아니면 통과로 봅니다 —
  기능 스위치(소개비 중개 꺼짐 422 FEATURE_OFF) · 상태(검수 중 매물 · 합의 전 계약) 때문에 막히는 것은 사업자 규칙과 무관합니다.
  ★ 개발 DB 에 시험 대화 · 거래 · 매물 · 요청 제안 · 공고를 만듭니다(제목 「V1037」). 설정은 끝에 되돌립니다.
"""
import os, json, uuid, subprocess, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

API = os.environ.get('API', 'http://localhost:3000/api/v1')
SITE = os.environ.get('SITE', 'http://localhost:5174')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
TAG = uuid.uuid4().hex[:6]
RES = []
ROLE_BLOCK = ('FORBIDDEN', 'BUSINESS_REQUIRED')


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def sql(q):
    r = subprocess.run(['psql', DB, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', q], capture_output=True, text=True)
    return r.stdout.strip()


def call(method, path, token=None, body=None, idem=False):
    h = {'content-type': 'application/json', **({'authorization': 'Bearer ' + token} if token else {})}
    if idem: h['Idempotency-Key'] = uuid.uuid4().hex
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'null')
        except Exception: return e.code, None


def login(email, pw):
    return call('POST', '/auth/login', body={'email': email, 'password': pw})[1]['accessToken']


def not_role_blocked(st, d):
    return not (st == 403 and isinstance(d, dict) and d.get('code') in ROLE_BLOCK)


__import__('consent_ok').agree('member@t.local', 'sgb-test-1234')
tm = login('member@t.local', 'sgb-test-1234'); ts = login('seller@x.com', 'sgb-dev-1234')
mid = sql("select id from accounts where email='member@t.local'")
ok('전제 — 시험 회원은 본인인증 · 사업자 없음', sql(f"select (identity_verified_at is not null)::text || '|' || (select count(*) from businesses where account_id=a.id) from accounts a where id='{mid}'") == 'true|0', mid)

# ① 문의 — 남의 게시 매물
lid = sql(f"select id from listings where status='PUBLISHED' and owner_account_id <> '{mid}' and gwan_code='MNY' order by published_at desc limit 1")
st, d = call('GET', f'/listings/{lid}?view=0', tm)
ok('문의 — 사업자 아닌 개인도 문의 가능(canInquire)', st == 200 and d.get('canInquire') is True and d.get('inquireBlockReason') is None, f"{st} canInquire={d.get('canInquire')} reason={d.get('inquireBlockReason')}")
st, d = call('POST', '/conversations', tm, {'targetType': 'LISTING', 'targetId': lid, 'message': f'V1037 개인 문의입니다 {TAG}'})
cid = (d or {}).get('id') or (d or {}).get('conversationId')
ok('문의 — 대화 열기', st in (200, 201) and cid, f'{st} {str(d)[:100]}')

# ② 거래 만들기 · 소개비 제시 · 계약서 — 개인
st, d = call('POST', f'/conversations/{cid}/deal', tm, {})
did = (d or {}).get('id') or (d or {}).get('dealId')
ok('거래 만들기 — 개인 회원(전: 사업자만 403)', st in (200, 201) and did, f'{st} {str(d)[:100]}')
st, d = call('POST', f'/deals/{did}/fee', tm, {'amount': 300000}, idem=True)
ok('소개비 제시 — 역할 · 사업자로 막히지 않음(기능 스위치 · 상태는 별개)', not_role_blocked(st, d), f'{st} {str(d)[:110]}')
st, d = call('POST', f'/deals/{did}/contract', tm, {'templateCode': 'STD_V1'}, idem=True)
ok('계약서 발급 — 역할 · 사업자로 막히지 않음', not_role_blocked(st, d), f'{st} {str(d)[:110]}')

# ③ 등록 — 모든 관 · 인증이 필요한 업종은 그 인증
def cat(g, extra=''):
    return sql(f"select id from categories where gwan_code='{g}' and status='APPROVED' and restricted_code is null {extra} order by name limit 1")
for g, extra in (('MNY', ''), ('BIZ', ''), ('MAL', "and axis='EQUIP'")):
    st, d = call('POST', '/listings', tm, {'gwanCode': g, 'categoryId': cat(g, extra), 'title': f'V1037 개인 등록 {g} {TAG}', 'body': 'P2P 개인 회원 등록 시험 본문입니다.', 'desiredFee': 100000})
    ok(f'등록 — 개인 회원 {g}', st in (200, 201) and (d or {}).get('listingId'), f'{st} {str(d)[:100]}')
gc = sql("select c.id from categories c join restricted_industries r on r.code=c.restricted_code where r.mode='GATED' and c.status='APPROVED' limit 1")
st, d = call('POST', '/listings', tm, {'gwanCode': sql(f"select gwan_code from categories where id='{gc}'"), 'categoryId': gc, 'title': f'V1037 자격 없는 게시 {TAG}', 'body': '자격 심사 없는 보험 · 의료 업종 시험 본문입니다.'})
ok('등록 — 인증이 필요한 업종(보험 · 의료 GATED)은 자격 심사 없으면 막힘(인증 규칙 유지)', st in (403, 422) and isinstance(d, dict) and d.get('code') in ('GATED', 'RESTRICTED_CATEGORY'), f'{st} {str(d)[:110]}')

# ④ 급구 · 급매 — 개인(역할로 막히지 않음)
my = sql(f"select id from listings where owner_account_id='{mid}' order by created_at desc limit 1")
st, d = call('POST', f'/listings/{my}/badges', tm, {'type': 'URGENT_SALE', 'reason': 'V1037 개인 급매 시험입니다', 'until': __import__('datetime').date.fromordinal(__import__('datetime').date.today().toordinal() + 3).isoformat()})
ok('급구 · 급매 신청 — 역할 · 사업자로 막히지 않음(전: 사업자만)', not_role_blocked(st, d), f'{st} {str(d)[:110]}')

# ⑤ 요청에 소개 제안 — 개인
rq = sql(f"select id from requests where status='PUBLISHED' and owner_account_id <> '{mid}' and (closes_at is null or closes_at > now()) and not exists (select 1 from request_proposals p where p.request_id=requests.id and p.proposer_account_id='{mid}') order by created_at desc limit 1")
# v10.41 — 여러 번 돌려 이 회원이 열린 요청 모두에 이미 제안했으면, 아무 열린 요청에 냅니다(409 ALREADY_PROPOSED 도 「역할 · 사업자로 막히지 않음」)
if not rq: rq = sql(f"select id from requests where status='PUBLISHED' and owner_account_id <> '{mid}' and (closes_at is null or closes_at > now()) order by created_at desc limit 1")
st, d = call('POST', f'/requests/{rq}/proposals', tm, {'message': f'V1037 개인 소개 제안입니다 {TAG}'})
ok('요청에 소개 제안 — 개인(전: 사업자만)', not_role_blocked(st, d) and st in (200, 201, 409, 422), f'{st} {str(d)[:110]}')

# ⑥ 구독 · 원장 — 개인
st, d = call('POST', '/subscriptions', tm, {'planCode': 'BASIC'}, idem=True)
ok('구독 시작 — 개인(전: 사업자만)', not_role_blocked(st, d), f'{st} {str(d)[:110]}')
st, d = call('GET', '/me/ledger', tm)
ok('원장 보기 — 개인', st == 200, f'{st}')

# ⑦ 소개창업 공고 · 자문 — 개인
st, d = call('POST', '/biz/axis', tm, {'kind': 'SVC', 'badge': '자문', 'title': f'V1037 개인 자문 서비스 {TAG}', 'description': '개인 회원이 올리는 자문 서비스 시험입니다.'})
ok('소개창업 자문 서비스 올리기 — 개인(전: 인증 사업자만)', st in (200, 201) and (d or {}).get('no'), f'{st} {str(d)[:110]}')

# ⑧ 막힌 단계 · 안내
st, d = call('GET', '/me/summary', tm)
ok('내 요약 — 사업자 인증이 막힌 단계로 나오지 않음', st == 200 and d.get('blockedBy') != 'BUSINESS_REQUIRED', f"blockedBy={d.get('blockedBy')}")
ok('이용약관 — 발행 · 초안 본문에 「모든 업무」 · 인증이 필요한 업종 줄', sql("select count(*) from terms where code='SERVICE' and status <> 'ARCHIVED' and body like '%**모든 업무**%' and body like '%등록에 인증이 필요한 업종%'") != '0', sql("select string_agg(version||':'||status, ' ') from terms where code='SERVICE'"))
ok('자주 묻는 질문 · 안내 문구 — 개인도 모든 업무', '모든 업무' in sql("select answer from faqs where question='개인도 가입할 수 있나요?'") and '모든 업무' in sql("select message from ui_messages where code='BUSINESS_ONLY'"), '')

# ⑨ 신규 가입자 첫 화면 — 가입 완료 화면
orig = sql("select value from site_settings where key='site.landing_new_member'")
ta = login('admin@x.com', 'sgb-dev-1234')
st, d = call('PATCH', '/admin/gwans/landing', ta, {'gwanCode': 'MAL', 'forNewMember': True})
st2, d2 = call('GET', '/site/landing?for=new')
ok('신규 가입자 첫 화면 — API ?for=new', st in (200, 201) and d2.get('value') == 'MAL', f'{st} · {d2}')

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(SITE + '/login'); txt = pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')
    ok('로그인 화면 안내 — 「모든 업무」 · 사업자만 문구 없음', '모든 업무' in txt and '판매 등록 · 거래 만들기는 사업자' not in txt, '')
    pg.fill('#lg-mail', 'member@t.local'); pg.fill('#lg-pw', 'sgb-test-1234'); pg.locator('#lg-pw').press('Enter'); pg.wait_for_timeout(2500)
    pg.goto(SITE + '/signup/done'); pg.wait_for_timeout(1500)
    a = pg.locator('[data-signup-start]')
    ok('가입 완료 화면 — 「시작하기」가 신규 가입자 첫 화면(안심소개 /mall)', a.count() == 1 and a.get_attribute('href') == '/mall' and '시작하기' in a.inner_text(), f"{a.get_attribute('href') if a.count() else '-'} {a.inner_text() if a.count() else ''}")
    pg.goto(SITE + f'/chat/{lid}?c={cid}'); pg.wait_for_timeout(2000)
    ok('대화 화면 — 개인 회원에게 「계약서 요청하기」 단추(전: 사업자 전환 안내)', pg.locator('[data-request-contract]').count() == 1, pg.url.replace(SITE, ''))
    pg.goto(SITE + '/my'); pg.wait_for_timeout(1500)
    ok('나의공간 — 「사업자 전환하기」가 막힌 단계로 나오지 않음', pg.locator('[data-my-blocked=BUSINESS]').count() == 0, '')
    pg.goto(SITE + '/my/business'); pg.wait_for_timeout(1500)
    t = pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')
    ok('사업자 전환 화면 — 개인도 모든 업무 · 사업자 인증은 사업자로 소개비 받을 때', '모든 업무' in t and '사업자만 할 수 있습니다' not in t, '')
    ok('쪽 스크립트 오류 없음', not errs, '; '.join(errs)[:200])
    b.close()

sql(f"SET session_replication_role = replica; UPDATE site_settings SET value = $${orig}$$ WHERE key = 'site.landing_new_member'")
print('되돌림:', sql("select value from site_settings where key='site.landing_new_member'"))
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
