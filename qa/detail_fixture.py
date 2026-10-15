"""매물 상세 시험의 준비 자료 — srv_detail.py · site_detail.py 가 같이 씁니다. 새 계정만 만들어 씁니다(공용 계정은 운영 계정 admin@x.com 뿐).

  make()  →  {'owner': {email,tok,id,company}, 'buyer': {...}, 'listing': id, 'gwan': 'MNY', 'deals': {'inquiry','confirmed','settled'}, 'settled': 700000}

만드는 것
  1. 등록자 O — 가입 → 본인인증(개발 스텁) → 사업자 등록 → 운영 승인 → 매물 1건 등록 → 검수 승인(게시)
  2. 구매자 U — 가입 → 본인인증 → 사업자 등록 → 운영 승인 (후기를 쓰려면 사업자여야 합니다)
  3. 판매자 X — 가입만
  4. 거래 3건 — O 가 소개자(introducer)인 거래: 문의 중 1 · 성사 확정 1 · 정산 완료 1(소개비 700,000원). DB 에 바로 넣습니다
     (소개코드 귀속으로 생기는 거래와 같은 모양 · 실적 집계 v_introducer_stats 가 보는 것은 이 표뿐입니다).
"""
import json, os, subprocess, time, urllib.request, uuid

API = os.environ.get('API', 'http://localhost:3000').rstrip('/')
B = API if API.endswith('/api/v1') else API + '/api/v1'
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
PW = 'Sgb-detail-1234!'


def q(sql):
    return subprocess.run(['psql', DB, '-tAc', sql], capture_output=True, text=True).stdout.strip().split('\n')[0]


def call(m, p, tok=None, body=None, headers=None, raw=False):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'User-Agent': UA}
    if tok: h['authorization'] = 'Bearer ' + tok
    if headers: h.update(headers)
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None)
    req = urllib.request.Request(B + p, method=m, data=data, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=30); st = r.status; txt = r.read()
    except urllib.error.HTTPError as e:
        st = e.code; txt = e.read()
    if raw: return st, txt.decode('utf8', 'ignore')
    try: js = json.loads(txt) if txt else None
    except Exception: js = None
    return st, js


def _tx(sql):
    """거래 표의 규칙(트리거)을 한 트랜잭션 안에서만 끄고 sql 을 실행합니다. 실패하면 전부 되돌아갑니다."""
    p = subprocess.run(['psql', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-c',
                        f"BEGIN; ALTER TABLE deals DISABLE TRIGGER USER; {sql}; ALTER TABLE deals ENABLE TRIGGER USER; COMMIT;"], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:300]


def cleanup(f):
    """make() 가 넣은 거래(와 거기 달린 후기)를 지웁니다 — 규칙을 건너뛰고 넣은 자료를 개발 DB 에 남기지 않습니다. 계정 · 매물은 남습니다(다른 시험과 같습니다)."""
    ids = ",".join("'" + d + "'" for d in (f or {}).get('deals', {}).values())
    if ids:
        _tx(f"DELETE FROM deals WHERE id IN ({ids})")
    return q("select count(*) from pg_trigger where tgrelid='deals'::regclass and not tgisinternal and tgenabled <> 'O'") == '0'


def login(e, pw='sgb-dev-1234'):
    st, j = call('POST', '/auth/login', body={'email': e, 'password': pw})
    assert st < 300, (e, st, j)
    return j['accessToken']


def member(prefix, name, business=None, adm=None):
    """새 회원. business 를 주면 본인인증 → 사업자 등록 → 운영 승인까지."""
    e = f'{prefix}_{uuid.uuid4().hex[:8]}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': e, 'password': PW, 'name': name, 'agreedTerms': []})
    assert st < 300, (st, j)
    tok = (j or {}).get('accessToken') or login(e, PW)
    out = {'email': e, 'tok': tok, 'id': q(f"select id from accounts where email='{e}'"), 'name': name, 'company': None}
    if business:
        st, j = call('POST', '/verifications/identity', tok, {'provider': 'PASS'}); assert st < 300, ('identity', st, j)
        brn = str(int(time.time() * 1000))[-10:]
        st, j = call('POST', '/businesses', tok, {'bizRegNo': brn, 'companyName': business, 'ceoName': name, 'sido': '서울', 'sigungu': '금천구'}); assert st < 300, ('business', st, j)
        bid = (j or {}).get('id') or q(f"select id from businesses where account_id='{out['id']}'")
        st, j = call('PATCH', f'/admin/businesses/{bid}/verify', adm, {}); assert st < 300, ('verify', st, j)
        out['tok'] = login(e, PW); out['company'] = business      # 역할(BIZ_OWNER)이 실린 새 토큰
        time.sleep(0.01)
    return out


def make():
    adm = login('admin@x.com')
    tag = uuid.uuid4().hex[:6]
    owner = member('dtO', '상세시험등록', f'상세시험상사{tag}', adm)
    buyer = member('dtU', '김구매', f'상세구매상사{tag}', adm)
    seller = member('dtX', '박판매')
    cat = q("select id from categories where gwan_code='MNY' and status='APPROVED' and restricted_code is null and labor_law_flag is distinct from 'REQUIRED' limit 1")
    title = f'상세시험 사무실 인테리어 소개 {tag}'
    st, j = call('POST', '/listings', owner['tok'], {'gwanCode': 'MNY', 'categoryId': cat, 'title': title,
        'body': '금천구 사무실 40평 인테리어 업체를 소개해 주시면 소개비를 드립니다. 시공 이력 확인 가능합니다.', 'desiredFee': 500000, 'feeBearer': 'SELLER',
        'regions': [{'sido': '서울', 'sigungu': '금천구'}]})
    if st >= 300:   # 입력 항목 이름이 다른 판을 위해 한 번 더(지역 없이)
        st, j = call('POST', '/listings', owner['tok'], {'gwanCode': 'MNY', 'categoryId': cat, 'title': title,
            'body': '금천구 사무실 40평 인테리어 업체를 소개해 주시면 소개비를 드립니다. 시공 이력 확인 가능합니다.', 'desiredFee': 500000})
    assert st < 300, ('listing', st, j)
    lid = (j or {}).get('listingId') or (j or {}).get('id')
    if q(f"select status from listings where id='{lid}'") != 'PUBLISHED':
        rid = q(f"select id from review_items where target_id='{lid}' order by submitted_at desc limit 1")
        st, j = call('PATCH', f'/admin/reviews/{rid}', adm, {'decision': 'APPROVED'}); assert st < 300, ('approve', st, j)
    assert q(f"select status from listings where id='{lid}'") == 'PUBLISHED', '매물이 게시되지 않았습니다'
    deals = {}
    for key, status, extra in (('inquiry', 'INQUIRY', ''), ('confirmed', 'CONFIRMED', ", confirmed_at = now(), confirm_mode = 'BOTH'"),
                               ('settled', 'SETTLED', ", confirmed_at = now(), confirm_mode = 'BOTH', agreed_fee = 700000, agreed_fee_fixed_at = now()")):
        did = q(f"insert into deals (listing_id, buyer_account_id, seller_account_id, introducer_account_id) values ('{lid}','{buyer['id']}','{seller['id']}','{owner['id']}') returning id")
        assert did, '거래를 넣지 못했습니다'
        if status != 'INQUIRY':
            # 성사 확정 · 정산 완료는 DB 가 여러 규칙으로 지킵니다(귀속 근거 INV-2 · 양쪽 확정 INV-4 · 소개비 잠금). 시험 자료는 그 절차를 다 밟을 수 없어
            # (소개비 중개가 정책상 꺼져 있어 정산 완료 거래는 지금 만들 수 없습니다) 한 트랜잭션 안에서만 규칙을 잠깐 끄고 넣습니다 — 실패하면 통째로 되돌아가 규칙은 켜진 채입니다.
            # 이 거래들은 시험이 끝나면 cleanup() 이 지웁니다.
            _tx(f"UPDATE deals SET status = '{status}'{extra} WHERE id = '{did}'")
        assert q(f"select status from deals where id='{did}'") == status, (key, q(f"select status from deals where id='{did}'"))
        deals[key] = did
    assert q("select count(*) from pg_trigger where tgrelid='deals'::regclass and not tgisinternal and tgenabled <> 'O'") == '0', '거래 표의 규칙이 꺼진 채 남았습니다'
    return {'owner': owner, 'buyer': buyer, 'seller': seller, 'listing': lid, 'title': title, 'gwan': 'MNY', 'deals': deals, 'settled': 700000, 'admin': adm}


if __name__ == '__main__':
    f = make(); print('cleanup', cleanup(f)); print(json.dumps({k: (v if not isinstance(v, dict) or k == 'deals' else {kk: vv for kk, vv in v.items() if kk != 'tok'}) for k, v in f.items() if k != 'admin'}, ensure_ascii=False, indent=1))
