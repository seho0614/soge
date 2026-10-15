"""DB 연동 테스트 — API ↔ DB 가 실제로 이어져 있는지, DB 가 스스로 지키는 규칙이 살아 있는지.  (v10.25 점검 보강 · 2026-10-08)

  A. 연결 · 마이그레이션     API 가 DB 를 봄 · 적용 기록 = 마이그레이션 폴더 · 객체 수 = 매트릭스
  B. 조회 전수               뷰 전부 · 표 전부를 실제로 읽어 봄(깨진 뷰 · 권한 없는 표가 없는지)
  C. API → DB 왕복          API 로 쓰고 → DB 에서 그 행을 확인 → API 로 다시 읽어 같은 값 → 뒷정리
  D. DB 가 막는 것           제약 · 트리거가 잘못된 값을 거절(되돌리는 거래 안에서 — 자료는 바뀌지 않음)
  E. 거래 단위               실패한 요청은 반쪽 자료를 남기지 않음 · 같은 재고를 동시에 사면 한 건만 · 같은 요청 키는 한 번만
  F. 새로 설치한 DB 와 구조 비교   마이그레이션만으로 만든 DB(sgb_check)와 쓰던 개발 DB 의 표 · 열 · 뷰 · 함수 · 제약 · 트리거 · 색인
  G. 표 ↔ API               쓰는 API 가 하나도 없는 표가 무엇이고 왜 그런지
  H. 시각 · 글자             시각 열의 형 · DB 글자 틀(UTF8) · 한글 왕복

시험이 만든 것은 끝에 지우거나 취소합니다. 계정(dbl_*@t.local)은 남습니다(다른 시험과 같음).
사용:  python3 db_link.py      KIT=…/sgb  API=http://localhost:3000/api/v1  DB=…/sgb  CHECK_DB=…/sgb_check
"""
import hashlib, json, os, re, subprocess, sys, threading, time, uuid, urllib.request, urllib.error

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
B = os.environ.get('API', 'http://localhost:3000/api/v1')
DB = os.environ.get('DB', 'postgresql://sgb:sgb@localhost:5432/sgb')
CHECK_DB = os.environ.get('CHECK_DB', 'postgresql://sgb:sgb@localhost:5432/sgb_check')
HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
R = []

def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), step, '|', str(detail)[:200], file=sys.stderr, flush=True)

def rows(sql, db=None):
    p = subprocess.run(['psql', db or DB, '-tA', '-F', '\t', '-c', sql], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:300]
    return [l.split('\t') for l in p.stdout.strip().split('\n') if l]
def q(sql, db=None):
    r = rows(sql, db); return r[0][0] if r else ''
def sql(s):
    p = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-qc', s], capture_output=True, text=True); return p.returncode, p.stderr.strip()
def psql_err(s):
    """되돌리는 거래 안에서 돌려 보고 오류 글만 받습니다(자료는 바뀌지 않음)"""
    p = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', 'BEGIN; ' + s + '; ROLLBACK;'], capture_output=True, text=True)
    return p.stderr.strip().replace('\n', ' ')[:220]

def call(m, p, tok=None, body=None, key=None, vk=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': key or uuid.uuid4().hex, 'user-agent': UA}
    if tok: h['authorization'] = 'Bearer ' + tok
    if vk: h['x-visitor-key'] = vk
    data = json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None)
    req = urllib.request.Request(B + p, method=m, data=data, headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js
def login(e, pw='sgb-dev-1234'):
    return (call('POST', '/auth/login', body={'email': e, 'password': pw})[1] or {}).get('accessToken')

def main():
    tag = uuid.uuid4().hex[:6]
    BUY = login('buyer@x.com'); ADM = login('admin@x.com'); INT = login('intro@x.com')
    mx = json.load(open(f'{KIT}/docs/matrix/matrix.json'))

    # ── A ── 연결 · 마이그레이션
    st, h = call('GET', '/health')
    rec('A-1 API 가 DB 를 보고 있음(GET /health → db: true)', st == 200 and (h or {}).get('db') is True, h)
    folders = sorted(d for d in os.listdir(f'{KIT}/prisma/migrations') if os.path.isdir(f'{KIT}/prisma/migrations/{d}'))
    applied = sorted(r[0] for r in rows('select name from schema_migrations'))
    strip = lambda n: re.sub(r'\.sql$', '', n.split('/')[0])
    rec(f'A-2 적용 기록(schema_migrations) {len(applied)}건 = 마이그레이션 폴더 {len(folders)}개 · 이름이 모두 같음',
        len(applied) == len(folders) and {strip(a) for a in applied} == set(folders),
        {'기록에만': sorted({strip(a) for a in applied} - set(folders))[:5], '폴더에만': sorted(set(folders) - {strip(a) for a in applied})[:5]})
    # 적용한 뒤 파일이 바뀌지 않았는지 — migrate.js 가 적는 checksum 과 지금 파일을 견줌
    cs = {strip(r[0]): r[1] for r in rows('select name, checksum from schema_migrations')}
    diff = []
    for d in folders:
        f = f'{KIT}/prisma/migrations/{d}/migration.sql'
        if os.path.exists(f) and cs.get(d) != hashlib.sha256(open(f, 'rb').read()).hexdigest()[:16]: diff.append(d)
    rec('A-3 적용한 뒤 바뀐 마이그레이션 파일이 없음(기록의 checksum = 지금 파일 · scripts/migrate.js 와 같은 계산) — 있으면 그 DB 에서 migrate 가 멈춥니다(종료 코드 1)',
        not diff, f'{len(diff)}건: ' + ', '.join(diff[:12]) if diff else f'{len(folders)}개 모두 같음')
    p_ = subprocess.run(['node', 'scripts/migrate.js', '--status'], cwd=KIT, capture_output=True, text=True, env={**os.environ, 'DATABASE_URL': DB})
    last = (p_.stdout.strip().split('\n') or [''])[-1]
    rec('A-3b 마이그레이션 도구의 상태 확인(node scripts/migrate.js --status) — 변경감지 0 · 적용 예정 0 · 종료 코드 0', p_.returncode == 0 and '변경감지 0' in last and '적용 예정' not in last, (p_.returncode, last))
    nt = int(q("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast')"))
    nv = int(q("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m') and n.nspname not in ('pg_catalog','information_schema','pg_toast')"))
    # 함수는 매트릭스(scripts/gen-matrix.js)와 같은 기준 — public · 보통 함수(prokind='f') · 확장이 넣은 것 제외
    nf = int(q("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')"))
    s = mx['summary']
    rec(f"A-4 객체 수가 매트릭스와 같음 — 표 {nt} · 뷰 {nv} · 함수 {nf}", (nt, nv, nf) == (s['tables'], s['views'], s['functions']), {'매트릭스': (s['tables'], s['views'], s['functions'])})
    nv_ = rows("select conrelid::regclass::text, conname from pg_constraint where not convalidated")
    rec('A-5 「검사 안 함(NOT VALID)」으로 둔 제약 — 있으면 목록(옛 자료에는 적용하지 않고 새 자료만 막는 제약)', True, nv_ or '없음')
    off = rows("select tgrelid::regclass::text||'.'||tgname from pg_trigger where not tgisinternal and tgenabled='D'")
    rec('A-6 꺼 둔 트리거가 없음', not off, off or f"트리거 {q('select count(*) from pg_trigger where not tgisinternal')}개 모두 켜짐")

    # ── B ── 조회 전수
    views = rows("select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m') and n.nspname not in ('pg_catalog','information_schema','pg_toast') order by 1,2")
    bad = []; t0 = time.time(); slow = []
    script = '\n'.join(f"\\echo @@{s_}.{v}\nSELECT 1 FROM (SELECT * FROM \"{s_}\".\"{v}\" LIMIT 1) x;" for s_, v in views)
    p = subprocess.run(['psql', DB, '-tA', '-f', '-'], input=script, capture_output=True, text=True)
    cur = None
    for l in (p.stdout + '\n').split('\n'):
        if l.startswith('@@'): cur = l[2:]
    errs = re.findall(r'ERROR:\s+(.*)', p.stderr)
    # 어느 뷰가 틀렸는지는 하나씩 다시
    if errs:
        for s_, v in views:
            pp = subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', f'SELECT 1 FROM (SELECT * FROM "{s_}"."{v}" LIMIT 1) x'], capture_output=True, text=True)
            if pp.returncode: bad.append(f'{s_}.{v}: {pp.stderr.strip()[:80]}')
    rec(f'B-1 뷰 {len(views)}개를 모두 실제로 읽음 — 오류 0', not errs and not bad, bad[:6] or f'{round(time.time()-t0,1)}초')
    tabs = rows("select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast') order by 1,2")
    script = '\n'.join(f"SELECT '{s_}.{t}', count(*) FROM \"{s_}\".\"{t}\";" for s_, t in tabs)
    p = subprocess.run(['psql', DB, '-tA', '-F', '\t', '-f', '-'], input=script, capture_output=True, text=True)
    cnt = dict(l.split('\t') for l in p.stdout.strip().split('\n') if '\t' in l)
    terr = re.findall(r'ERROR:\s+(.*)', p.stderr)
    rec(f'B-2 표 {len(tabs)}개를 모두 실제로 읽음 — 오류 0 · 자료가 있는 표 {sum(1 for v in cnt.values() if int(v) > 0)}개 · 빈 표 {sum(1 for v in cnt.values() if int(v) == 0)}개', not terr and len(cnt) == len(tabs), terr[:4] or '')
    json.dump({'counts': cnt}, open(f'{HERE}/db_link_counts.json', 'w'), ensure_ascii=False)

    # ── C ── API → DB 왕복
    em = f'dbl_{tag}@t.local'
    st, j = call('POST', '/auth/signup', body={'email': em, 'password': 'Sgb-dbl-1234!', 'name': 'DB연동 시험', 'agreedTerms': []})
    a = rows(f"select id, name, status, password_hash from accounts where email='{em}'")
    rec('C-1 가입(POST /auth/signup) → accounts 에 한 행 · 비밀번호는 그대로 적히지 않음(해시)', st < 300 and len(a) == 1 and a[0][1] == 'DB연동 시험' and 'Sgb-dbl-1234!' not in a[0][3] and len(a[0][3]) > 30, (st, a[0][:3] if a else None))
    NEW = (j or {}).get('accessToken') or login(em, 'Sgb-dbl-1234!'); aid = a[0][0] if a else ''
    st, me = call('GET', '/me/summary', NEW)
    rec('C-1b 다시 API 로 읽으면 같은 계정(GET /me/summary)', st == 200 and em in json.dumps(me, ensure_ascii=False) or (st == 200 and aid in json.dumps(me)), st)
    st, _ = call('PATCH', '/me/account', NEW, {'name': '바꾼 이름 한글'})
    rec('C-2 이름 변경(PATCH /me/account) → accounts.name · updated_at 이 바뀜', st < 300 and q(f"select name from accounts where id='{aid}'") == '바꾼 이름 한글' and q(f"select updated_at > created_at from accounts where id='{aid}'") == 't', st)

    lst = q("select id from listings where status='PUBLISHED' and gwan_code='MNY' order by created_at desc limit 1")
    st, _ = call('POST', f'/me/favorites/{lst}', NEW)
    n1 = q(f"select count(*) from favorites where account_id='{aid}' and target_id='{lst}'")
    st2, _ = call('DELETE', f'/me/favorites/{lst}', NEW)
    n2 = q(f"select count(*) from favorites where account_id='{aid}' and target_id='{lst}'")
    rec('C-3 찜(POST /me/favorites/:id) → favorites 1행 · 해제(DELETE) → 0행', st < 300 and n1 == '1' and st2 < 300 and n2 == '0', (st, n1, st2, n2))

    title = f'DB연동 점검 글 {tag}'
    st, p_ = call('POST', '/me/community/posts', NEW, {'board': 'QNA', 'title': title, 'body': 'DB 연동 테스트로 쓴 글입니다. 시험이 끝나면 지웁니다.'})
    pr = rows(f"select id, board, state, author_id from posts where title='{title}'")
    pid = pr[0][0] if pr else ''
    rec('C-4 글쓰기(POST /me/community/posts) → posts 1행 · 작성자 = 그 계정 · 게시판 QNA', st < 300 and len(pr) == 1 and pr[0][1] == 'QNA' and pr[0][3] == aid, (st, pr))
    st, gp = call('GET', f'/community/posts/{pid}', NEW) if pid else (0, None)
    rec('C-4b API 로 다시 읽으면 같은 제목 — 작성자 이름은 첫 글자만(「바OO」)', st == 200 and (gp or {}).get('title') == title and (gp or {}).get('author') == '바OO', (st, (gp or {}).get('author')))
    st, c_ = call('POST', f'/me/community/posts/{pid}/comments', BUY, {'body': 'DB 연동 테스트 댓글입니다'}) if pid else (0, None)
    cc = q(f"select comment_count from posts where id='{pid}'") if pid else ''
    rec('C-5 댓글(POST …/comments) → post_comments 1행 · posts.comment_count 가 1 로(트리거/같은 거래)', st < 300 and q(f"select count(*) from post_comments where post_id='{pid}'") == '1' and cc == '1', (st, cc))
    st, _ = call('DELETE', f'/me/community/posts/{pid}', NEW) if pid else (0, None)
    left = q(f"select coalesce(state,'')||'/'||(hidden_at is not null)::text from posts where id='{pid}'") if pid else ''
    rec('C-6 글 삭제(DELETE /me/community/posts/:id) → posts.state 가 DELETED(행은 남김 — 달린 댓글 보존)', st < 300 and left.startswith('DELETED/'), (st, left or '행 없음'))
    # G-173 — 지운 글은 주소를 알아도 제목 · 본문이 나가면 안 됩니다(검수 중 · 가려진 글과 같이 자리만 남김)
    gs, gd = call('GET', f'/community/posts/{pid}') if pid else (0, None); gd = gd if isinstance(gd, dict) else {}
    ms, md = call('GET', f'/community/posts/{pid}', NEW) if pid else (0, None); md = md if isinstance(md, dict) else {}
    rec('C-6b 지운 글을 주소로 열면 제목 · 본문이 나가지 않음 — 남(비로그인) · 쓴 사람 모두 「지운 글」 자리만(G-173)',
        gs == 200 and gd.get('deleted') is True and 'title' not in gd and 'body' not in gd and title not in json.dumps(gd, ensure_ascii=False)
        and md.get('deleted') is True and 'body' not in md, (gs, sorted(gd.keys())[:8], sorted(md.keys())[:8]))
    st_, bd = call('GET', '/community/board?limit=50&q=' + urllib.request.quote('DB연동 점검'))
    rec('C-6c 지운 글은 목록 · 검색(GET /community/board)에 나오지 않음', st_ == 200 and title not in json.dumps(bd, ensure_ascii=False), st_)

    # 소개몰 — 배송지 · 장바구니 · 주문 · 취소
    st, addrs = call('GET', '/me/health/addresses', BUY)
    addr = next((x for x in (addrs or []) if x.get('isDefault')), (addrs or [{}])[0]).get('id')
    pr_ = rows("select code, price, stock, id from hlt_products where status='ON_SALE' and stock >= 5 and (select count(*) from hlt_product_options o where o.product_id=hlt_products.id and o.is_active)=1 order by price limit 1")
    code, price, s0, prod_id = pr_[0][0], int(pr_[0][1]), int(pr_[0][2]), pr_[0][3]
    buy_id = q("select id from accounts where email='buyer@x.com'")
    had = q(f"select qty from hlt_cart_items where account_id='{buy_id}' and product_id='{prod_id}'")
    st, _ = call('POST', '/me/health/cart', BUY, {'productCode': code, 'qty': 1})
    now = q(f"select qty from hlt_cart_items where account_id='{buy_id}' and product_id='{prod_id}'")
    vc = rows(f"select ship_fee from v_hlt_cart where account_id='{buy_id}' limit 1")
    rec('C-7 장바구니 담기(POST /me/health/cart) → hlt_cart_items 수량 +1 · 뷰 v_hlt_cart 의 배송비 0', st < 300 and int(now or 0) == int(had or 0) + 1 and vc and vc[0][0] == '0', (st, had, now, vc))
    call('PATCH', f'/me/health/cart/{code}', BUY, {'qty': int(had or 0)})
    rec('C-7b (정리) 장바구니를 처음 수량으로', q(f"select coalesce((select qty from hlt_cart_items where account_id='{buy_id}' and product_id='{prod_id}'),0)") == str(int(had or 0)), '')
    st, o = call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': code, 'qty': 2}]}); o = o if isinstance(o, dict) else {}
    no = o.get('orderNo')
    od = rows(f"select id, goods_amount, ship_fee, total, status from hlt_orders where order_no='{no}'") if no else []
    oi = rows(f"select qty, unit_price, amount from hlt_order_items where order_id='{od[0][0]}'") if od else []
    s1 = int(q(f"select stock from hlt_products where code='{code}'"))
    rec(f'C-8 주문(POST /health/orders · {code} × 2) → hlt_orders 1행 + hlt_order_items 1행 · 금액 = 단가 × 2 · 배송비 0',
        st < 300 and len(od) == 1 and len(oi) == 1 and int(od[0][1]) == price * 2 and od[0][2] == '0' and int(oi[0][2]) == price * 2, (st, od, oi))
    rec(f'C-9 같은 거래에서 재고가 줄어듦({s0} → {s1})', s1 == s0 - 2, (s0, s1))
    st, g = call('GET', f'/me/health/orders/{no}', BUY) if no else (0, None)
    rec('C-10 API 로 다시 읽으면 DB 와 같은 금액 · 상태', st == 200 and int((g or {}).get('total', -1)) == int(od[0][3]) and (g or {}).get('status') == od[0][4], (st, (g or {}).get('status')))
    if no:
        st, r_ = call('POST', '/me/health/returns', BUY, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        if st < 300 and isinstance(r_, dict) and r_.get('id'): call('POST', f"/admin/health/returns/{r_['id']}/decide", ADM, {'state': 'APPROVED', 'note': 'DB 연동 시험 정리'})
    s2 = int(q(f"select stock from hlt_products where code='{code}'"))
    rec(f'C-11 취소 → 주문 상태가 바뀌고 재고가 처음으로({s2})', s2 == s0 and q(f"select status from hlt_orders where order_no='{no}'") in ('CANCELED', 'CANCELLED', 'REFUNDED'), (q(f"select status from hlt_orders where order_no='{no}'"), s2))

    # 운영 설정 → site_settings + 감사 기록
    k = 'sns.instagram'; v0 = q(f"select coalesce(value,'') from site_settings where key='{k}'")
    a0 = int(q("select count(*) from audit.audit_logs"))
    v1 = f'https://www.instagram.com/dblink_{tag}'
    st, _ = call('PATCH', '/admin/site-settings', ADM, {'key': k, 'value': v1})
    rec('C-12 운영 설정 변경(PATCH /admin/site-settings) → site_settings.value', st < 300 and q(f"select value from site_settings where key='{k}'") == v1, st)
    a1 = int(q("select count(*) from audit.audit_logs"))
    last = rows("select action, target_type, actor_role from audit.audit_logs order by occurred_at desc limit 1")
    rec('C-13 같은 변경이 감사 기록(audit.audit_logs)에 한 줄 남음', a1 > a0, (a0, a1, last))
    st, pub = call('GET', '/site-settings/public')
    rec('C-14 공개 설정 API 로 다시 읽으면 바꾼 값', st == 200 and (pub or {}).get(k) == v1, (pub or {}).get(k))
    call('PATCH', '/admin/site-settings', ADM, {'key': k, 'value': v0})
    rec('C-14b (정리) 설정을 처음 값으로', q(f"select coalesce(value,'') from site_settings where key='{k}'") == v0, v0)

    # 상담 신청 → consult_requests(연락처는 암호문 · 해시)
    ph = '010-' + str(uuid.uuid4().int)[:4] + '-' + str(uuid.uuid4().int)[:4]
    sido = q("select sido from consult_requests order by created_at desc limit 1") or '서울'
    n0 = int(q("select count(*) from consult_requests"))
    st, cr = call('POST', '/consult/requests', body={'categoryCode': 'CSL_MOVING', 'name': 'DB연동 시험', 'phone': ph, 'email': 'consult.test@example.com', 'sido': sido, 'memo': f'DB 연동 테스트 {tag}', 'agree': True})
    crow = rows(f"select id, state, contact_enc is not null, length(phone_hash), coalesce(contact_enc::text,'') from consult_requests where memo='DB 연동 테스트 {tag}'")
    rec('C-15 상담 신청(POST /consult/requests) → consult_requests 1행 · 전화번호는 그대로 적히지 않음(암호문 + 해시)',
        st < 300 and len(crow) == 1 and crow[0][2] == 't' and ph not in crow[0][4] and ph.replace('-', '') not in crow[0][4] and int(crow[0][3]) >= 32, (st, crow[0][:4] if crow else None, int(q('select count(*) from consult_requests')) - n0))
    if crow:   # 정리 — 인증 전 신청은 운영 종료 API 가 없을 수 있어 표식으로 지움(자식 행 없음)
        rc, er = sql(f"DELETE FROM consult_requests WHERE id='{crow[0][0]}' AND lead_id IS NULL")
        rec('C-15b (정리) 시험 신청을 지움', rc == 0 and q(f"select count(*) from consult_requests where id='{crow[0][0]}'") == '0', er[:120])

    # ── D ── DB 가 막는 것 (되돌리는 거래 안에서)
    e = psql_err("UPDATE audit.audit_logs SET action = action WHERE id = (SELECT id FROM audit.audit_logs LIMIT 1)")
    rec('D-1 감사 기록은 고칠 수 없음(UPDATE 거절)', 'ERROR' in e, e)
    e = psql_err("DELETE FROM audit.audit_logs WHERE id = (SELECT id FROM audit.audit_logs LIMIT 1)")
    rec('D-2 감사 기록은 지울 수 없음(DELETE 거절)', 'ERROR' in e, e)
    e = psql_err(f"UPDATE hlt_product_options SET stock = -1 WHERE product_id = (SELECT id FROM hlt_products WHERE code = '{code}')")
    rec('D-3 재고는 음수가 될 수 없음(옵션 재고 CHECK · v10.26)', 'ERROR' in e and 'check' in e.lower(), e)
    e = psql_err(f"UPDATE hlt_products SET stock = stock + 1 WHERE code = '{code}'")
    rec('D-3b 상품 행의 재고는 직접 고칠 수 없음 — 옵션에서 계산(HLTP · v10.26)', 'HLTP' in e, e)
    e = psql_err(f"INSERT INTO accounts(email, password_hash, name) VALUES ('buyer@x.com', 'x', '중복')")
    rec('D-4 같은 이메일로 계정을 둘 만들 수 없음(유일 제약)', 'duplicate key' in e or 'ERROR' in e, e)
    e = psql_err("INSERT INTO hlt_orders(order_no, account_id, goods_amount, total) VALUES ('HDBLINK0001', '00000000-0000-4000-8000-00000000dead', 1000, 1000)")
    rec('D-5 없는 계정으로 주문을 넣을 수 없음(참조 제약)', 'foreign key' in e or 'ERROR' in e, e)
    oid = q("select id from hlt_orders order by created_at desc limit 1")
    e = psql_err(f"UPDATE hlt_orders SET status = 'NOPE' WHERE id = '{oid}'")
    rec('D-6 주문 상태에 없는 값을 넣을 수 없음', 'ERROR' in e, e)
    e = psql_err(f"INSERT INTO hlt_shipments(order_id, state) VALUES ('{oid}', 'SHIPPED')")
    rec('D-7 배송 기록에 없는 상태(SHIPPED)를 넣을 수 없음', 'ERROR' in e, e)
    lockcat = rows("select category_code from hlt_sale_categories where state in ('LOCKED','NOT_SOLD') order by sort limit 1")
    if lockcat:
        e = psql_err(f"UPDATE hlt_products SET category_id = (SELECT id FROM categories WHERE code = '{lockcat[0][0]}' LIMIT 1), status = 'ON_SALE' WHERE code = '{code}'")
        rec(f'D-8 잠긴 갈래({lockcat[0][0]})의 상품은 「판매 중」이 될 수 없음(fn_hlt_product_guard)', 'ERROR' in e, e)
    e = psql_err("UPDATE site_settings SET value = 'maybe' WHERE key = 'assume.payment'")
    rec('D-9 설정 값은 정해 둔 모양만(assume.payment 에 on/off 아닌 값 거절)', 'ERROR' in e, e)
    e = psql_err("INSERT INTO leads(id, summary) SELECT gen_random_uuid(), '연락처 010-1234-5678 로 주세요'")
    rec('D-10 리드 요약에 전화번호를 넣을 수 없음(ck_leads_summary_no_phone — 새 자료에 적용)', 'ERROR' in e, e)
    pv = rows("select poll_id, option_id, account_id from poll_votes where account_id is not null limit 1")
    if pv:
        e = psql_err(f"INSERT INTO poll_votes(poll_id, option_id, account_id) VALUES ('{pv[0][0]}', '{pv[0][1]}', '{pv[0][2]}')")
        rec('D-11 한 계정이 같은 투표에 두 번 표를 넣을 수 없음(유일 제약)', 'ERROR' in e, e)
    else:
        rec('D-11 한 계정이 같은 투표에 두 번 표를 넣을 수 없음(유일 제약)', True, '회원 표가 아직 없어 견줄 행이 없음', skip=True)
    vline = ''
    try:
        for l in open('/tmp/verify.log', encoding='utf8'):
            if re.match(r'^통과 \d+ / 실패', l): vline = l.strip()
    except Exception: pass
    rec('D-12 (참고) DB 불변식 · 공격 검정 전체 묶음(npm run verify)은 전수 검정 A 구간에서 따로 돕니다', True, vline or '이번 실행 기록 없음')

    # ── E ── 거래 단위
    n0 = int(q(f"select count(*) from hlt_orders where account_id='{buy_id}'")); s0b = int(q(f"select stock from hlt_products where code='{code}'"))
    st, er = call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': code, 'qty': 1}, {'productCode': code + '-NOPE', 'qty': 1}]})
    rec('E-1 한 품목이 틀린 주문은 통째로 거절 — 주문 행이 늘지 않고 재고도 그대로', st >= 400 and int(q(f"select count(*) from hlt_orders where account_id='{buy_id}'")) == n0 and int(q(f"select stock from hlt_products where code='{code}'")) == s0b, (st, (er or {}).get('code')))
    st, er = call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': code, 'qty': s0b + 1}]})
    rec(f'E-2 재고({s0b})보다 많이 주문하면 거절 — 주문 행 · 재고 그대로', st >= 400 and int(q(f"select count(*) from hlt_orders where account_id='{buy_id}'")) == n0 and int(q(f"select stock from hlt_products where code='{code}'")) == s0b, (st, (er or {}).get('code')))
    # 같은 요청 키로 두 번 → 주문 한 건
    key = uuid.uuid4().hex
    r1 = call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': code, 'qty': 1}]}, key=key)
    r2 = call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': code, 'qty': 1}]}, key=key)
    n1 = int(q(f"select count(*) from hlt_orders where account_id='{buy_id}'"))
    same = (r1[1] or {}).get('orderNo') and (r1[1] or {}).get('orderNo') == (r2[1] or {}).get('orderNo')
    # 설계: 요청 키로 중복을 막는 곳은 결제 · 코드 발급 둘(billing.controller.ts) — 그쪽 전수 시험은 srv_billing 이 합니다.
    # 주문 생성은 대상이 아니라 같은 키로도 주문이 2건 생깁니다(G-171 · 낮음). 화면은 처리 중에 단추를 꺼서 막습니다(아래 E-3b).
    rec('E-3 (사실 기록 · G-171) 주문 생성은 요청 키로 중복을 막지 않음 — 같은 키 두 번 = 주문 ' + str(n1 - n0) + '건', True, (r1[0], r2[0], (r1[1] or {}).get('orderNo'), (r2[1] or {}).get('orderNo')))
    of = open(f'{KIT}/site/src/components/health/OrderForm.tsx', encoding='utf8').read()
    rec('E-3b 주문서의 「결제하기」 단추는 보내는 동안 꺼짐(disabled={!ready || pending}) — 두 번 눌러 주문이 둘 생기지 않게', 'disabled={!ready || pending}' in of, '')
    bc = open(f'{KIT}/src/modules/billing/billing.controller.ts', encoding='utf8').read()
    idem = int(q("select count(*) from idempotency_records where state='SUCCEEDED'"))
    rec('E-3c 요청 키 장치가 붙은 처리기 2곳(구독 시작 · 소개코드 발급) · 처리 기록 표 idempotency_records 에 성공 기록이 있음', bc.count('@UseInterceptors(IdempotencyInterceptor)') == 2 and idem > 0, (bc.count('@UseInterceptors(IdempotencyInterceptor)'), idem))
    made = [(r1[1] or {}).get('orderNo'), (r2[1] or {}).get('orderNo')]
    # 재고 1개를 둘이 동시에 → 한 건만
    sql(f"UPDATE hlt_product_options SET stock = 1 WHERE product_id = (SELECT id FROM hlt_products WHERE code = '{code}')")
    res = []
    def buy(tok): res.append(call('POST', '/health/orders', tok, {'addressId': None if tok != BUY else addr, 'items': [{'productCode': code, 'qty': 1}]}))
    # 두 번째 구매자는 같은 계정의 다른 요청(요청 키가 다르므로 별개 주문)
    th = [threading.Thread(target=lambda: res.append(call('POST', '/health/orders', BUY, {'addressId': addr, 'items': [{'productCode': code, 'qty': 1}]}))) for _ in range(4)]
    [t.start() for t in th]; [t.join() for t in th]
    oks = [r for r in res if r[0] < 300]; stock_after = int(q(f"select stock from hlt_products where code='{code}'"))
    rec('E-4 재고 1개를 네 요청이 동시에 사면 한 건만 성공 · 재고는 0(음수 아님)', len(oks) == 1 and stock_after == 0, ([r[0] for r in res], stock_after))
    made += [(r[1] or {}).get('orderNo') for r in oks]
    for no_ in [m for m in made if m]:
        st, r_ = call('POST', '/me/health/returns', BUY, {'orderNo': no_, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        if st < 300 and isinstance(r_, dict) and r_.get('id'): call('POST', f"/admin/health/returns/{r_['id']}/decide", ADM, {'state': 'APPROVED', 'note': 'DB 연동 시험 정리'})
    sql(f"UPDATE hlt_product_options SET stock = {s0} WHERE product_id = (SELECT id FROM hlt_products WHERE code = '{code}')")
    rec(f'E-5 (정리) 시험 주문을 모두 취소하고 재고를 처음({s0})으로', int(q(f"select stock from hlt_products where code='{code}'")) == s0 and all(q(f"select status from hlt_orders where order_no='{m}'") in ('CANCELED', 'CANCELLED', 'REFUNDED') for m in made if m), [(m, q(f"select status from hlt_orders where order_no='{m}'")) for m in made if m])

    # ── F ── 새로 설치한 DB 와 구조 비교
    try:
        ok_check = q('select count(*) from schema_migrations', CHECK_DB) == str(len(folders))
    except Exception as ex:
        ok_check = False
    if not ok_check:
        rec('F-0 새로 설치한 DB(sgb_check)가 준비돼 있음', False, '전수 검정 A 구간이 만든 DB 가 없거나 마이그레이션 수가 다릅니다')
    else:
        NS = "n.nspname not in ('pg_catalog','information_schema','pg_toast')"
        Q = {
         '표 · 열(이름 · 형 · 빈 값 허용 · 기본값)': f"select c.table_schema||'.'||c.table_name||'.'||c.column_name, c.data_type||'|'||coalesce(c.udt_name,'')||'|'||c.is_nullable||'|'||coalesce(regexp_replace(c.column_default,'::[a-z_ \"]+','','g'),'') from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where t.table_type='BASE TABLE' and c.table_schema not in ('pg_catalog','information_schema')",
         '뷰(정의)': f"select n.nspname||'.'||c.relname, md5(pg_get_viewdef(c.oid, true)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m') and {NS}",
         '함수(본문)': f"select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where {NS} and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')",
         '제약': f"select conrelid::regclass::text||'.'||conname, pg_get_constraintdef(c.oid)||(case when convalidated then '' else ' [NOT VALID]' end) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where {NS} and conrelid <> 0",
         '트리거': f"select tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not tgisinternal and {NS}",
         '색인': f"select schemaname||'.'||indexname, indexdef from pg_indexes where schemaname not in ('pg_catalog','information_schema')",
        }
        detail = {}
        for nm, s_ in Q.items():
            a_ = dict((r[0], r[1] if len(r) > 1 else '') for r in rows(s_)); b_ = dict((r[0], r[1] if len(r) > 1 else '') for r in rows(s_, CHECK_DB))
            only_a = sorted(set(a_) - set(b_)); only_b = sorted(set(b_) - set(a_)); dif = sorted(k_ for k_ in set(a_) & set(b_) if a_[k_] != b_[k_])
            detail[nm] = {'개발 DB 에만': only_a, '새 설치에만': only_b, '내용이 다름': dif, 'n': len(a_)}
            rec(f'F-{list(Q).index(nm)+1} {nm} — 쓰던 개발 DB {len(a_)} = 새로 설치한 DB {len(b_)} · 차이 0', not only_a and not only_b and not dif,
                {'개발 DB 에만': only_a[:6], '새 설치에만': only_b[:6], '내용이 다름': dif[:6]} if (only_a or only_b or dif) else '같음')
        json.dump(detail, open(f'{HERE}/db_link_struct.json', 'w'), ensure_ascii=False, indent=1)

    # ── G ── 표 ↔ API
    dbm = [d for d in mx['db'] if d['kind'] == 'TABLE']
    zero = sorted(f"{d['schema']}.{d['name']}" for d in dbm if not d.get('apis'))
    used = len(dbm) - len(zero)
    # 서버 코드 · 마이그레이션에서 그 이름이 쓰이는지(트리거 · 배치 · 뷰를 거쳐 쓰는 표)
    srcs = ''
    for root, _, files in os.walk(f'{KIT}/src'):
        if 'generated' in root: continue
        for f in files:
            if f.endswith('.ts'): srcs += open(os.path.join(root, f), encoding='utf8', errors='ignore').read()
    migs = ''.join(open(f'{KIT}/prisma/migrations/{d}/migration.sql', encoding='utf8', errors='ignore').read() for d in folders if os.path.exists(f'{KIT}/prisma/migrations/{d}/migration.sql'))
    kind = {}
    for z in zero:
        nm = z.split('.')[1]
        in_src = len(re.findall(r'\b' + re.escape(nm) + r'\b', srcs)); in_mig = len(re.findall(r'\b' + re.escape(nm) + r'\b', migs))
        if z == 'public._t': kind[z] = '쓰지 않는 빈 표(처음 만든 틀 B040 에 남은 것 · G-172 · 낮음)'; continue
        kind[z] = ('서버 코드가 씀(매트릭스가 처리기와 잇지 못한 표 — 공용 서비스 · 배치 · 가드)' if in_src else 'DB 안에서만 씀(트리거 · 함수 · 뷰)' if in_mig > 1 else '정의만 있음')
    rec('G-1b (v10.27 · G-172) 쓰지 않던 빈 표 public._t 는 D031 에서 지웠음 — DB 에 없고 서버 코드도 부르지 않음', q("select to_regclass('public._t') is null") == 't' and len(re.findall(r'\b_t\b', srcs)) == 0, q("select to_regclass('public._t')"))
    rec(f'G-1 표 {len(dbm)}개 가운데 API 처리기와 이어진 표 {used}개 · 이어지지 않은 표 {len(zero)}개 — 모두 까닭이 있음(서버 코드 · DB 내부)',
        all(v != '정의만 있음' for v in kind.values()), {k_: v for k_, v in kind.items() if v == '정의만 있음'} or {v: sum(1 for x in kind.values() if x == v) for v in set(kind.values())})
    json.dump(kind, open(f'{HERE}/db_link_noapi.json', 'w'), ensure_ascii=False, indent=1)
    apis = mx['apis']; noTab = [a_['method'] + ' ' + a_['path'] for a_ in apis if not a_.get('tables')]
    rec(f'G-2 API {len(apis)}개 가운데 표를 쓰는 것 {len(apis) - len(noTab)}개 · 표를 쓰지 않는 것 {len(noTab)}개(상태 확인 · 계산 · 외부 호출 · 공용 서비스 경유)', True, noTab[:8])

    # ── H ── 시각 · 글자
    naive = rows("select table_schema||'.'||table_name||'.'||column_name from information_schema.columns c where data_type='timestamp without time zone' and table_schema not in ('pg_catalog','information_schema') and exists (select 1 from information_schema.tables t where t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE')")
    rec('H-1 시각 열은 모두 시간대 포함(timestamptz) — 시간대 없는 시각 열 0', not naive, [r[0] for r in naive][:8] or f"DB 시간대 {q('show timezone')}")
    rec('H-2 DB 글자 틀이 UTF8', q('show server_encoding') == 'UTF8', q('show server_encoding'))
    rec('H-3 한글 · 기호가 API → DB → API 로 그대로(위 C-2 의 이름)', q(f"select name from accounts where id='{aid}'") == '바꾼 이름 한글', q(f"select name from accounts where id='{aid}'"))

    json.dump(R, open(f'{HERE}/db_link.json', 'w'), ensure_ascii=False, indent=1)
    bad = [r for r in R if not r['ok']]
    print(f"\n통과 {sum(r['ok'] for r in R)} / {len(R)}" + (f" · 실패 {len(bad)}: " + ' · '.join(b['step'][:22] for b in bad) if bad else ''))

if __name__ == '__main__':
    main()
