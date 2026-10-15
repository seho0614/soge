"""v10.39 시험 — 리팩토링(코드 구조만 · 동작 그대로)

  API=http://localhost:3000/api/v1 OLD=http://localhost:3998/api/v1 DB=postgresql://sgb:sgb@localhost:5432/sgb python3 test_v1039.py

  ① 구조: 「내 파트너 · 신청 줄 찾기」가 한 곳(PartnerActorService) · 쓰지 않는 사업자 게이트 코드가 없음 · 통과만 하던 DB 판매 게이트(D097)가 없음
  ② 동작 그대로: 바탕 v10.38 API(OLD · 같은 DB)와 이번 판 API(API)에 같은 계정 · 같은 요청을 보내 응답이 같은지 견줍니다
     계정 — 사업자 파트너 대표 · 그 파트너에 합류한 직원(시험 중에만) · 개인 파트너(v10.38 시험이 만든 것) · 파트너 아닌 본인인증 회원 · 본인인증 안 한 회원
  ③ 매물 저장 — 게이트를 뺀 뒤에도 개인 등록 · 고치기가 되고, 인증이 필요한 등록(보험 · 의료 GATED)은 그대로 막힘
"""
import os, re, json, uuid, subprocess, urllib.request, urllib.error, urllib.parse

API = os.environ.get('API', 'http://localhost:3000/api/v1')
OLD = os.environ.get('OLD', 'http://localhost:3998/api/v1')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
TAG = uuid.uuid4().hex[:6]
PW = 'sgb-test-1234'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def sql(q):
    r = subprocess.run(['psql', DB, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', q], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else 'ERR:' + r.stderr.strip()[:200]


def call(base, method, path, token=None, body=None):
    h = {'content-type': 'application/json', **({'authorization': 'Bearer ' + token} if token else {})}
    path = urllib.parse.quote(path, safe='/?=&:-_.')
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'null')
        except Exception: return e.code, None


def login(email, pw):
    return call(API, 'POST', '/auth/login', body={'email': email, 'password': pw})[1]['accessToken']


def mk(email, name, verified):
    return sql(f"""INSERT INTO accounts (email, password_hash, name, account_type, status, identity_verified_at)
                   VALUES ('{email}', crypt('{PW}', gen_salt('bf', 10)), '{name}', 'INDIVIDUAL', 'ACTIVE', {'now()' if verified else 'NULL'}) RETURNING id""").splitlines()[0]


# ── ① 구조 ───────────────────────────────────────────────────────
src = subprocess.run(['grep', '-rln', 'LEFT JOIN business_members m ON m.business_id = b.id AND m.account_id = $1', K + '/src'], capture_output=True, text=True).stdout.split()
ok('구조 — 「대표 또는 합류한 직원의 파트너」 조회가 한 곳(partner-actor.service)', [os.path.basename(f) for f in src] == ['partner-actor.service.ts'], str([os.path.basename(f) for f in src]))
src = subprocess.run(['grep', '-rn', 'fn_actor_business', K + '/src'], capture_output=True, text=True).stdout.strip().splitlines()
ok('구조 — 신청 줄(fn_actor_business) 부르는 곳이 한 곳', len({l.split(':')[0] for l in src}) == 1 and 'partner-actor.service.ts' in src[0], f'{len(src)}줄 · ' + ' '.join(sorted({os.path.basename(l.split(":")[0]) for l in src})))
g = subprocess.run(['grep', '-rnE', "Forbidden\\('BUSINESS_REQUIRED'|'BUSINESS_VERIFIED'|BUSINESS_REQUIRED:", K + '/src', K + '/site/src', K + '/web/src'], capture_output=True, text=True).stdout.strip()
ok('구조 — 쓰지 않는 사업자 게이트 코드 없음(BUSINESS_VERIFIED 게이트 · BUSINESS_REQUIRED 안내 표)', g == '', g[:160])
ok('구조 — 통과만 하던 DB 판매 게이트(트리거 3 · 함수 2) 없음(D097)',
   sql("select count(*) from pg_trigger where tgname in ('trg_listing_seller_gate','trg_listing_business_gate','trg_listing_business_gate_u')") == '0'
   and sql("select count(*) from pg_proc where proname in ('fn_listing_seller_gate','fn_listing_requires_business')") == '0', '')

# ── ② 동작 그대로(바탕 v10.38 API 와 견줌) ────────────────────────
st, _ = call(OLD, 'GET', '/health')
ok('준비 — 바탕 v10.38 API 가 같은 DB 로 떠 있음', st == 200, OLD)
owner_tok = login('seller@x.com', 'sgb-dev-1234')
biz = sql("select b.id from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where a.email='seller@x.com' and b.kind='BUSINESS' limit 1")
sid = mk(f'v1039s-{TAG}@t.local', f'직원{TAG[:3]}', True)
r = sql(f"INSERT INTO business_members (business_id, account_id, member_role, can_settle, invited_at, joined_at) VALUES ('{biz}','{sid}','STAFF',false,now(),now()) RETURNING business_id")
ok('준비 — 사업자 파트너에 합류한 직원(정산 권한 없음)', not r.startswith('ERR'), r[:120])
pers = sql("select a.email from partners p join businesses b on b.id=p.business_id join accounts a on a.id=b.account_id where b.kind='PERSON' and p.status='ACTIVE' order by p.applied_at desc limit 1")
nid = mk(f'v1039n-{TAG}@t.local', f'회원{TAG[:3]}', True)
uid = mk(f'v1039u-{TAG}@t.local', f'미인증{TAG[:3]}', False)
for e in (f'v1039s-{TAG}@t.local', f'v1039n-{TAG}@t.local', f'v1039u-{TAG}@t.local'):
    __import__('consent_ok').agree(e, PW)
TOK = {'사업자 대표': owner_tok, '직원': login(f'v1039s-{TAG}@t.local', PW), '개인 파트너': login(pers, PW) if pers else None,
       '파트너 아닌 회원': login(f'v1039n-{TAG}@t.local', PW), '본인인증 안 한 회원': login(f'v1039u-{TAG}@t.local', PW)}
GETS = ['/partner/dashboard', '/partner/cash', '/partner/company', '/partner/directory', '/partner/directory/invoices', '/partner/axes',
        '/partner/affiliate/dashboard', '/partner/settlement', '/partner/broker', '/partner/services', '/partner/regions', '/partner/stats',
        '/partner/rejects', '/partner/performance', '/partner/staff/invitations', '/me/summary',
        '/partner/leads', '/partner/fees', '/partner/fees/disputes', '/partner/reviews', '/partner/trust', '/partner/pricing',
        '/partner/pricing/rewards', '/partner/notices', '/partner/tracks', '/partner/service-forms',
        '/partner/affiliate/links', '/partner/affiliate/orders', '/partner/affiliate/revenues', '/partner/affiliate/settlements',
        '/me/fulfillment-reports', '/biz/quick']
VOL = re.compile(r'"(?:at|now|serverTime|generatedAt|today|asOf|nextCheck|expiresAt)":\s*"[^"]*"')


def norm(d):
    return VOL.sub('"…":"…"', json.dumps(d, ensure_ascii=False, sort_keys=True))


same = diff = 0; diffs = []
for who, t in TOK.items():
    if not t: continue
    for path in GETS:
        a, b = call(OLD, 'GET', path, t), call(API, 'GET', path, t)
        if a[0] == b[0] and norm(a[1]) == norm(b[1]): same += 1
        else: diff += 1; diffs.append(f'{who} {path} {a[0]}→{b[0]} {norm(a[1])[:70]} ≠ {norm(b[1])[:70]}')
ok(f'동작 그대로 — 계정 {sum(1 for t in TOK.values() if t)} × 조회 {len(GETS)}: 상태 코드 · 응답 본문이 바탕 v10.38 과 같음', diff == 0, f'같음 {same} · 다름 {diff} ' + ' | '.join(diffs[:3]))

# 쓰기 요청의 거절(막히는 쪽만 — 자료를 만들지 않음): 같은 코드 · 같은 문구
POSTS = [('본인인증 안 한 회원', '/partner/apply', {}), ('본인인증 안 한 회원', '/partner/axes', {'axes': ['EQUIP']}),
         ('본인인증 안 한 회원', '/partner/broker', {'licenseNo': '11680-2026-00001', 'officeName': 'x', 'ceoName': 'x'}),
         ('사업자 대표', '/partner/apply', {}), ('개인 파트너', '/partner/apply', {}), ('직원', '/partner/cash/charges', {'amount': 100000}),
         ('파트너 아닌 회원', '/partner/cash/charges', {'amount': 100000}), ('본인인증 안 한 회원', f'/biz/quick/{uuid.uuid4()}/offer', {}),
         ('사업자 대표', '/partner/axes', {'axes': ['NOPE']})]
pd = []; pn = 0
for who, path, body in POSTS:
    t = TOK.get(who)
    if not t: continue
    a, b = call(OLD, 'POST', path, t, body), call(API, 'POST', path, t, body)
    pn += 1
    if not (a[0] == b[0] and norm(a[1]) == norm(b[1]) and a[0] >= 400): pd.append(f'{who} {path} {a[0]}→{b[0]} {str(b[1])[:80]}')
ok(f'동작 그대로 — 막히는 쓰기 요청 {pn}건: 코드 · 문구가 바탕 v10.38 과 같음', not pd, ' | '.join(pd[:3]))

# ── ③ 매물 저장(게이트를 뺀 뒤) ─────────────────────────────────
tn = TOK['파트너 아닌 회원']
c = sql("select id from categories where gwan_code='BIZ' and status='APPROVED' and restricted_code is null order by name limit 1")
st, d = call(API, 'POST', '/listings', tn, {'gwanCode': 'BIZ', 'categoryId': c, 'title': f'V1039 개인 등록 {TAG}', 'body': '게이트를 뺀 뒤 개인 회원 등록 시험 본문입니다.', 'desiredFee': 100000})
lid = (d or {}).get('listingId')
ok('매물 — 개인 회원 등록(소개창업)', st in (200, 201) and lid, f'{st} {str(d)[:90]}')
r = sql(f"UPDATE listings SET title = title || ' 고침' WHERE id = '{lid}' RETURNING id") if lid else 'ERR'
ok('매물 — 고치기(UPDATE 트리거 경로)', not r.startswith('ERR') and r, r[:100])
gc = sql("select c.id from categories c join restricted_industries r on r.code=c.restricted_code where r.mode='GATED' and c.status='APPROVED' limit 1")
st, d = call(API, 'POST', '/listings', tn, {'gwanCode': sql(f"select gwan_code from categories where id='{gc}'"), 'categoryId': gc, 'title': f'V1039 자격 없는 게시 {TAG}', 'body': '자격 심사 없는 보험 · 의료 업종 시험 본문입니다.'})
ok('매물 — 인증이 필요한 업종(GATED)은 그대로 막힘', st in (403, 422) and (d or {}).get('code') in ('GATED', 'RESTRICTED_CATEGORY'), f'{st} {str(d)[:100]}')

sql(f"UPDATE business_members SET removed_at = now() WHERE account_id = '{sid}' AND removed_at IS NULL")
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
