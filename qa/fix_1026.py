"""v10.26 첫 단계 — 확장 점검(10/8)에서 나온 제품 결함 10건의 수정 확인.  고치기 전에 먼저 만들어 실패를 확인한 시험입니다.

  G-173 지운 글 노출          G-177 운영 「검수 큐」 빈 화면      G-178 운영 3화면 쓰기 요청에 로그인 토큰 없음
  G-182 소개몰 중복 주문      G-174 결제 키 이름                  G-179 결제 수단 화면
  G-180 요청 등록 뒤 404      G-181 기본 머리줄 로그아웃          G-183 취소 신청 뒤 결제      G-186 승인된 사업자의 검수 건

화면으로 끝까지 가는 확인은 flow 점검(flow_trade T3 · T5 · T7 · flow_mall M5 · flow_plaza P3 · flow_biz B1)이 함께 봅니다 — 여기는 그 흐름이 닿지 않는 곳과 서버 규칙입니다.
시험이 만든 것은 끝에 치웁니다(주문 취소 · 시험 이벤트/수집 대상/신고 삭제). 계정(fix_*@t.local)은 남습니다.
사용:  python3 fix_1026.py      결과 fix_1026.json
"""
import sys, threading
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from flow_lib import *
from playwright.sync_api import sync_playwright

R = []
def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), step, '|', str(detail)[:220], file=sys.stderr, flush=True)
def until(fn, sec=12):
    t = time.time()
    while time.time() - t < sec:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.4)
    return False
def biz_member(prefix, name):
    """사업자 회원 하나 — 가입 → 본인인증(시험) → 사업자 등록.  (email, pw, token, account id, business id)"""
    em, pw, tok, aid = signup(prefix, name)
    call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
    brn = str(uuid.uuid4().int)[:10]
    st, j = call('POST', '/businesses', tok, {'bizRegNo': brn, 'companyName': f'수정확인{em[4:10]}', 'ceoName': '김확인', 'sido': '서울', 'sigungu': '금천구'})
    return em, pw, tok, aid, (j or {}).get('id') or q(f"select id from businesses where account_id='{aid}'")
def cancel(tok, adm, no):
    st, r = call('POST', '/me/health/returns', tok, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    if st < 300 and isinstance(r, dict) and r.get('id'): call('POST', f"/admin/health/returns/{r['id']}/decide", adm, {'state': 'APPROVED', 'note': '수정 확인 시험 정리'})

def main():
    ADM = login('admin@x.com'); tag = uuid.uuid4().hex[:6]
    code, price, s0 = rows("select code, price, stock from hlt_products where status='ON_SALE' and stock >= 8 and (select count(*) from hlt_product_options o where o.product_id=hlt_products.id and o.is_active)=1 order by price limit 1")[0]; s0 = int(s0)
    em, pw, TOK, aid = signup('fix', '수정확인'); call('POST', '/verifications/identity', TOK, {'provider': 'PASS'})
    st, a = call('POST', '/me/health/addresses', TOK, {'receiver': '확인', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
    addr = (a or {}).get('id') or q(f"select id from hlt_addresses where account_id='{aid}' limit 1")
    orders = lambda: int(q(f"select count(*) from hlt_orders where account_id='{aid}'"))
    stock = lambda: int(q(f"select stock from hlt_products where code='{code}'"))
    cartq = lambda: q(f"select coalesce((select qty from hlt_cart_items c join hlt_products p on p.id=c.product_id where c.account_id='{aid}' and p.code='{code}'),0)")

    # ── G-173 지운 글 ─────────────────────────────────────────────────────────
    title = f'수정확인 지운 글 {tag}'; body = f'지운 뒤에는 보이면 안 되는 본문입니다 {tag}'
    st, p = call('POST', '/me/community/posts', TOK, {'board': 'QNA', 'title': title, 'body': body}); pid = q(f"select id from posts where title='{title}'")
    call('POST', f'/admin/community/posts/{pid}/approve', ADM)
    st, c = call('POST', f'/me/community/posts/{pid}/comments', login('buyer@x.com'), {'body': f'남는 댓글 {tag}'})
    st, live = call('GET', f'/community/posts/{pid}')
    rec('G-173-0 (준비) 승인된 글은 제목 · 본문 · 댓글이 보임', st == 200 and (live or {}).get('title') == title and len((live or {}).get('comments') or []) == 1, st)
    call('DELETE', f'/me/community/posts/{pid}', TOK)
    st, g = call('GET', f'/community/posts/{pid}'); g = g if isinstance(g, dict) else {}; js = json.dumps(g, ensure_ascii=False)
    rec('G-173-1 지운 글을 남이 주소로 열면 — 「지운 글」 표식만 · 제목 · 본문이 응답 어디에도 없음', st == 200 and g.get('deleted') is True and 'title' not in g and 'body' not in g and title not in js and body not in js, (st, sorted(g)[:8]))
    rec('G-173-2 달린 댓글은 남음(대화가 끊기지 않게)', len(g.get('comments') or []) == 1 and f'남는 댓글 {tag}' in js, len(g.get('comments') or []))
    st, m = call('GET', f'/community/posts/{pid}', TOK); m = m if isinstance(m, dict) else {}
    rec('G-173-3 쓴 사람이 열어도 같음(지운 글은 본문을 다시 내보내지 않음)', st == 200 and m.get('deleted') is True and 'body' not in m, sorted(m)[:8])
    v0 = q(f"select views from posts where id='{pid}'"); call('GET', f'/community/posts/{pid}'); v1 = q(f"select views from posts where id='{pid}'")
    rec('G-173-4 지운 글은 조회 수를 올리지 않음', v0 == v1, (v0, v1))
    import urllib.request as _u
    try: html = _u.urlopen(_u.Request(f'{SITE}/community/{pid}', headers={'user-agent': UA}), timeout=40).read().decode('utf8', 'ignore')
    except Exception as ex: html = 'ERR ' + str(ex)
    rec('G-173-5 실제 웹 글 상세(/community/{id}) — 제목 · 본문이 없고 「지운 글」 안내와 댓글이 있음', title not in html and body not in html and '지운 글' in html and f'남는 댓글 {tag}' in html, ('제목 보임', title in html, '본문 보임', body in html, '안내', '지운 글' in html))

    # ── G-177 검수 큐 ─────────────────────────────────────────────────────────
    st, rq = call('GET', '/admin/reviews', ADM)
    items = rq.get('items') if isinstance(rq, dict) else None
    rec('G-177-1 검수 큐 응답이 선언한 모양({ items: [...], nextCursor }) — 화면이 읽는 모양과 같음', st == 200 and isinstance(items, list) and 'nextCursor' in (rq if isinstance(rq, dict) else {}), (st, type(rq).__name__, len(items or [])))
    if isinstance(items, list) and len(items) >= 50:
        st, r2 = call('GET', '/admin/reviews?cursor=' + urllib.request.quote(rq.get('nextCursor') or ''), ADM); i2 = (r2 or {}).get('items') or []
        rec('G-177-2 50건이 넘으면 다음 쪽 열쇠(nextCursor)로 이어 받음 — 겹치는 건 없음', bool(rq.get('nextCursor')) and st == 200 and not ({x['id'] for x in items} & {x['id'] for x in i2}), (rq.get('nextCursor'), len(i2)))
    else:
        rec('G-177-2 50건이 안 되면 다음 쪽 열쇠는 비어 있음', isinstance(rq, dict) and rq.get('nextCursor') is None, (len(items or []), (rq or {}).get('nextCursor') if isinstance(rq, dict) else None))

    # ── G-186 승인된 사업자의 검수 건 ────────────────────────────────────────
    bem, bpw, BT, baid, bid = biz_member('fix_bz', '수정확인사업')
    r0 = rows(f"select id, status from review_items where target_type='BUSINESS' and target_id='{bid}'")
    rec('G-186-0 (준비) 사업자 등록을 하면 검수 대기 건이 생김', len(r0) == 1 and r0[0][1] == 'QUEUED', r0)
    st, _ = call('PATCH', f'/admin/businesses/{bid}/verify', ADM, {})
    r1 = rows(f"select status, decided_at is not null, decision_by is not null from review_items where target_type='BUSINESS' and target_id='{bid}'")
    rec('G-186-1 「사업자 인증」에서 승인하면 그 사업자의 검수 대기 건도 함께 승인으로 닫힘', st < 300 and r1 and r1[0] == ['APPROVED', 't', 't'], (st, r1))
    stale = q("select count(*) from review_items r join businesses b on b.id=r.target_id where r.target_type='BUSINESS' and r.status in ('QUEUED','IN_PROGRESS') and b.verified_at is not null")
    rec('G-186-2 이미 승인된 사업자의 검수 대기 건이 남아 있지 않음(쌓인 건 정리 — 마이그레이션)', stale == '0', stale)

    # ── G-174 결제 키 이름 ───────────────────────────────────────────────────
    kn = q("select secret_key_name from integrations where code='PG'")
    src = open(f'{KIT}/src/modules/billing/payment.provider.ts', encoding='utf8').read(); doc = open(f'{KIT}/docs/26_환경설치절차서.md', encoding='utf8').read()
    rec('G-174-1 연동 표의 결제 키 이름 = 서버가 읽는 환경 변수 이름(TOSS_SECRET_KEY)', kn == 'TOSS_SECRET_KEY' and f'process.env.{kn}' in src, kn)
    rec('G-174-2 설치 절차서의 시크릿 목록도 같은 이름', 'TOSS_SECRET_KEY' in doc and 'PG_SECRET_KEY' not in doc, ('PG_SECRET_KEY' in doc, 'TOSS_SECRET_KEY' in doc))

    # ── G-182 중복 주문(서버 규칙) ───────────────────────────────────────────
    n0 = orders()
    # 참 · 거짓 입력은 받은 값 그대로 검사(@StrictBoolean · G-134) — 글자 "false" 가 true 로 바뀌어 장바구니 대조를 타거나, 글자 "true" 가 통과하면 안 됩니다
    bad = [call('POST', '/health/orders', TOK, {'addressId': addr, 'fromCart': v, 'items': [{'productCode': code, 'qty': 1}]})[0] for v in ('false', 'true', 1, 'yes')]
    rec('G-182-0 fromCart 에 참 · 거짓이 아닌 값(글자 "false" · "true" · 숫자 1 · "yes")을 보내면 모두 400 — 주문이 생기지 않음', bad == [400, 400, 400, 400] and orders() == n0, (bad, orders() - n0))
    st, e = call('POST', '/health/orders', TOK, {'addressId': addr, 'fromCart': True, 'items': [{'productCode': code, 'qty': 1}]})
    rec('G-182-1 주문서에서 온 주문(fromCart)인데 장바구니에 그 상품이 없으면 거절 — 주문 · 재고 그대로', st == 409 and (e or {}).get('code') == 'CART_CHANGED' and orders() == n0 and stock() == s0, (st, (e or {}).get('code')))
    call('POST', '/me/health/cart', TOK, {'productCode': code, 'qty': 1})
    st, e = call('POST', '/health/orders', TOK, {'addressId': addr, 'fromCart': True, 'items': [{'productCode': code, 'qty': 2}]})
    rec('G-182-2 장바구니 수량(1)과 다른 수량(2)으로 온 주문도 거절 — 장바구니는 그대로', st == 409 and orders() == n0 and cartq() == '1', (st, (e or {}).get('code'), cartq()))
    st, o1 = call('POST', '/health/orders', TOK, {'addressId': addr, 'fromCart': True, 'items': [{'productCode': code, 'qty': 1}]}); o1 = o1 if isinstance(o1, dict) else {}
    rec('G-182-3 장바구니와 같은 주문은 접수 — 같은 거래에서 장바구니 줄이 비워짐', st < 300 and orders() == n0 + 1 and cartq() == '0' and stock() == s0 - 1, (st, o1.get('orderNo'), cartq()))
    st, e = call('POST', '/health/orders', TOK, {'addressId': addr, 'fromCart': True, 'items': [{'productCode': code, 'qty': 1}]})
    rec('G-182-4 같은 주문서를 한 번 더 보내면(뒤로 가서 다시 누름) 거절 — 주문이 하나 더 생기지 않고 재고도 그대로', st == 409 and (e or {}).get('code') == 'CART_CHANGED' and orders() == n0 + 1 and stock() == s0 - 1, (st, (e or {}).get('code'), orders() - n0))
    call('POST', '/me/health/cart', TOK, {'productCode': code, 'qty': 1}); res = []
    th = [threading.Thread(target=lambda: res.append(call('POST', '/health/orders', TOK, {'addressId': addr, 'fromCart': True, 'items': [{'productCode': code, 'qty': 1}]}))) for _ in range(4)]
    [t.start() for t in th]; [t.join() for t in th]
    rec('G-182-5 같은 주문서를 네 번 동시에 보내도 주문은 한 건', sorted(r[0] for r in res) == [201, 409, 409, 409] and orders() == n0 + 2, (sorted(r[0] for r in res), orders() - n0))
    st, o3 = call('POST', '/health/orders', TOK, {'addressId': addr, 'items': [{'productCode': code, 'qty': 1}]})
    rec('G-182-6 전과 같은 방식(fromCart 없이 품목을 바로 보냄)은 그대로 됨', st < 300 and orders() == n0 + 3, st)

    # ── G-183 취소 신청 뒤 결제 ──────────────────────────────────────────────
    no = (o3 or {}).get('orderNo')
    st, od = call('GET', f'/me/health/orders/{no}', TOK)
    rec('G-183-0 (준비) 결제 대기 주문 — 취소 신청 표식 없음 · 결제 준비가 됨', st == 200 and (od or {}).get('cancelRequested') is False and call('POST', f'/health/orders/{no}/pay', TOK, {'method': 'CARD'})[0] < 300, (st, (od or {}).get('cancelRequested')))
    st, rr = call('POST', '/me/health/returns', TOK, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'}); rid = (rr or {}).get('id')
    st1, p1 = call('POST', f'/health/orders/{no}/pay', TOK, {'method': 'CARD'})
    st2, p2 = call('POST', f'/health/orders/{no}/pay/confirm', TOK, {'paymentKey': 'stub_' + no, 'amount': int(price)})
    rec('G-183-1 취소 신청이 접수된 주문은 결제 준비 · 결제 승인이 모두 거절 — 주문은 결제 대기 그대로',
        st1 == 409 and (p1 or {}).get('code') == 'CANCEL_REQUESTED' and st2 == 409 and q(f"select status from hlt_orders where order_no='{no}'") == 'PENDING', (st1, (p1 or {}).get('code'), st2, (p2 or {}).get('code')))
    st, od = call('GET', f'/me/health/orders/{no}', TOK); st_, lst = call('GET', '/me/health/orders', TOK)
    row = next((x for x in (lst or []) if x.get('orderNo') == no), {})
    rec('G-183-2 내 주문 목록 · 상세 응답에 「취소 신청 중」 표식(cancelRequested)이 실림', (od or {}).get('cancelRequested') is True and row.get('cancelRequested') is True, ((od or {}).get('cancelRequested'), row.get('cancelRequested')))
    call('POST', f'/admin/health/returns/{rid}/decide', ADM, {'state': 'REJECTED', 'note': '수정 확인 — 반려하면 다시 결제할 수 있어야 함'})
    st, p3 = call('POST', f'/health/orders/{no}/pay', TOK, {'method': 'CARD'})
    rec('G-183-3 운영이 취소 신청을 반려하면 다시 결제할 수 있음', st < 300 and call('GET', f'/me/health/orders/{no}', TOK)[1].get('cancelRequested') is False, (st, (p3 or {}).get('state')))

    # ── G-203 금칙어 중복 줄 ────────────────────────────────────────────────
    #   공격 점검(scripts/attack-check.sh G-02)이 돌 때마다 「100% 성공」 줄이 하나씩 더 들어감 — 막을 유일 규칙이 없어 ON CONFLICT 가 아무 일도 하지 않았음.
    #   기준선(B900)에도 422줄이 들어가 새로 설치한 DB 에도 그대로 들어감.
    dup = q("select count(*) from (select 1 from banned_words group by lower(btrim(word)), match_type, coalesce(gwan_code, '*') having count(*) > 1) x")
    rec('G-203-1 금칙어에 같은 줄(같은 말 · 맞춤 방식 · 관)이 둘 이상 없음', dup == '0', (dup, q("select count(*) from banned_words where word='100% 성공'")))
    w_ = f'수정확인 금칙어 {tag}'
    for _ in range(2): sql(f"INSERT INTO banned_words(word,match_type,severity,is_active) VALUES ('{w_}','CONTAINS','BLOCK',false) ON CONFLICT DO NOTHING")
    rec('G-203-2 같은 금칙어를 두 번 넣어도(ON CONFLICT DO NOTHING) 한 줄 — 공격 점검을 여러 번 돌려도 늘지 않음', q(f"select count(*) from banned_words where word='{w_}'") == '1', q(f"select count(*) from banned_words where word='{w_}'"))
    sql(f"DELETE FROM banned_words WHERE word='{w_}'")
    w2 = f'수정확인 금칙어 API {tag}'
    a1 = call('POST', '/admin/banned-words', ADM, {'word': w2, 'severity': 'WARN'}); a2 = call('POST', '/admin/banned-words', ADM, {'word': f'  {w2} ', 'severity': 'WARN'})
    rec('G-203-3 운영 화면에서 같은 금칙어를 두 번 넣으면 둘째는 「이미 등록된 금칙어입니다」(409 WORD_EXISTS) — 전에는 조용히 한 줄 더 들어감',
        a1[0] < 300 and a2[0] == 409 and (a2[1] or {}).get('code') == 'WORD_EXISTS' and q(f"select count(*) from banned_words where btrim(word)='{w2}'") == '1', (a1[0], a2[0], (a2[1] or {}).get('code')))
    sql(f"DELETE FROM banned_words WHERE btrim(word)='{w2}'")

    with sync_playwright() as PWR:
        b = PWR.chromium.launch()
        # ── G-182 화면 — 바로구매 → 결제 화면 → 「← 뒤로」 · 브라우저 뒤로 가기 ──
        ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = site_login(ctx, em, pw)
        n1 = orders(); goto(pg, f'/health/p/{code}')
        try:
            pg.get_by_role('button', name='바로구매').click(); pg.wait_for_url('**/health/order', timeout=20000); pg.wait_for_timeout(1500)
            for c_ in pg.locator('.hlt-chk input').all(): c_.check()
            pg.locator('button.cta-primary').click(); pg.wait_for_url('**/health/order/pay**', timeout=25000); pg.wait_for_timeout(2000)
            pg.locator('[data-back]').click(); pg.wait_for_url('**/health/order', timeout=15000)
            ok_ = until(lambda: '주문할 상품이 없습니다' in text(pg, '.hlt'), 12); t1 = text(pg, '.hlt')
        except Exception as ex:
            ok_ = False; t1 = 'ERR ' + str(ex)[:120]
        rec('G-182-7 바로구매로 주문한 뒤 결제 화면의 「← 뒤로」 — 주문서에 방금 주문한 상품이 다시 나오지 않음(「주문할 상품이 없습니다」) · 결제 단추 없음',
            ok_ and pg.locator('.hlt button.cta-primary').count() == 0 and orders() == n1 + 1, (t1[-60:].replace('\n', ' '), orders() - n1))
        try:
            pg.go_back(); pg.wait_for_timeout(600); pg.go_back(); pg.wait_for_timeout(600)       # 브라우저의 뒤로 가기로 주문서까지 되돌아감(화면이 기억해 둔 예전 주문서가 다시 뜰 수 있는 길)
            hist = pg.url.replace(SITE, '')
            goto(pg, '/health/order') if '/health/order' not in pg.url or '/pay' in pg.url else None
            ok_ = until(lambda: '주문할 상품이 없습니다' in text(pg, '.hlt') or pg.locator('.hlt button.cta-primary').count() == 0, 12)
        except Exception as ex:
            ok_ = False; hist = 'ERR ' + str(ex)[:100]
        rec('G-182-8 브라우저의 뒤로 가기로 돌아가도 주문서에 결제 단추가 남지 않음 — 주문은 여전히 한 건', ok_ and orders() == n1 + 1, (hist, orders() - n1))
        # ── G-183 화면 ──
        st, rr = call('POST', '/me/health/returns', TOK, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
        goto(pg, '/my/health/orders'); card = pg.locator('.hlt', has_text=no)
        t_ = text(pg, 'main') or text(pg)
        pay_links = pg.locator(f'a[href*="/health/order/pay?no={no}"]').count()
        rec('G-183-4 내 주문 화면 — 취소 신청 중인 주문에는 「결제하기」가 없고 「취소 신청 중」이 보임', pay_links == 0 and '취소 신청 중' in t_, (pay_links, '취소 신청 중' in t_))
        goto(pg, f'/health/order/pay?no={no}&m=CARD'); t_ = text(pg, '.hlt')
        rec('G-183-5 결제 화면을 주소로 열어도 결제 단추 대신 「취소 신청이 접수된 주문」 안내', '취소 신청' in t_ and pg.locator('.hlt button.cta-primary').count() == 0, t_[-120:].replace('\n', ' '))

        # ── G-181 기본 머리줄 ──
        goto(pg, '/mall'); pg.wait_for_timeout(1500)      # v10.30 — 공통 머리줄의 보기를 안심소개로(소개장터 메인은 10/9 디자인의 머리줄 — site_mny.py B-2 가 로그인한 모습을 봄)
        hd = lambda p_: p_.evaluate("(()=>{const h=document.querySelector('header.pc-hd');return h?{t:h.innerText.replace(/\\s+/g,' '),out:[...h.querySelectorAll('button')].filter(b=>b.innerText.includes('로그아웃')).length,login:[...h.querySelectorAll('a')].filter(a=>a.getAttribute('href')==='/login'||a.getAttribute('href')==='/signup').length}:null})()")   # v10.29 — 공통 머리줄 header.hd → header.pc-hd(오른쪽 .hd-right → .pc-hr)
        ok_ = until(lambda: (hd(pg) or {}).get('out') == 1, 8); h1 = hd(pg) or {}
        rec('G-181-1 로그인한 사람의 기본 머리줄(소개장터) — 「로그아웃」이 있고 「로그인 · 회원가입」은 없음', ok_ and h1.get('login') == 0, h1)
        g = b.new_context(viewport={'width': 1280, 'height': 900}).new_page(); goto(g, '/mall'); g.wait_for_timeout(1500); h2 = hd(g) or {}
        rec('G-181-2 로그인하지 않은 사람에게는 그대로 「로그인 · 회원가입」', h2.get('out') == 0 and h2.get('login') == 2, h2)
        goto(pg, '/my'); pg.wait_for_timeout(1200)
        try: pg.locator('header.pc-hd button', has_text='로그아웃').click(timeout=5000)   # v10.29 — 공통 머리줄 header.hd → header.pc-hd(오른쪽 .hd-right → .pc-hr)
        except Exception as ex: pass
        out = until(lambda: not any(c['name'] in ('sgb_at', 'sgb_rt') for c in ctx.cookies()), 10)
        st_my = goto(pg, '/my'); pg.wait_for_timeout(800)
        rec('G-181-3 「로그아웃」을 누르면 로그인 쿠키가 지워지고 나의공간은 로그인 화면으로 보냄', out and '/login' in pg.url, (out, pg.url.replace(SITE, '')))
        ctx.close()

        # ── G-178 운영 화면의 쓰기 요청 ──
        raw = []
        for root, _, files in os.walk(f'{KIT}/web/src/app'):
            for f in files:
                if f.endswith('.tsx'):
                    for i, line in enumerate(open(os.path.join(root, f), encoding='utf8').read().split('\n'), 1):
                        if 'fetch(' in line and '/internal/' not in line: raw.append(f'{f}:{i}')
        rec('G-178-1 운영 화면 코드에 로그인 토큰 없이 바로 보내는 요청(fetch)이 없음 — 모두 공용 함수(api)를 거침', not raw, raw)
        ev = f'FIX{tag.upper()}'; cs = f'FIX_{tag.upper()}'
        sql(f"INSERT INTO events(code, title, body, benefit, starts_at, ends_at, status, join_type) VALUES ('{ev}', '수정확인 이벤트 {tag}', '시험', '시험 혜택', now(), now() + interval '7 days', 'DRAFT', 'NONE')")
        sql(f"INSERT INTO collect_sources(code, name, base_url, kind, state) VALUES ('{cs}', '수정확인 수집 {tag}', 'https://example.invalid', 'OPEN_DATA', 'STOPPED')")
        lst_ = q("select id from listings where status='PUBLISHED' order by created_at limit 1"); reason = q('select code from report_reasons limit 1')
        sql(f"INSERT INTO reports(target_type, target_id, reason_code, detail, state, reporter_id) VALUES ('LISTING', '{lst_}', '{reason}', '수정확인 신고 {tag}', 'OPEN', '{aid}')")
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}); bo = bo_login(ctx)
        sent = []
        bo.on('request', lambda r: sent.append((r.method, r.url.split('/api/v1')[-1], bool(r.headers.get('authorization')))) if '/api/' in r.url and r.method != 'GET' else None)
        resp = []
        bo.on('response', lambda r: resp.append((r.request.method, r.url.split('/api/v1')[-1], r.status)) if '/api/' in r.url and r.request.method != 'GET' else None)
        def did(path_part):
            bo.wait_for_timeout(500)      # 응답 기록은 브라우저 쪽 호출을 하는 동안에만 들어옵니다 — DB 를 기다린 뒤 한 번 돌려 줍니다
            return [x for x in sent if path_part in x[1]], [x for x in resp if path_part in x[1]]
        bo_tab(bo, '이벤트'); row = bo.locator('.bo-main table.tbl tbody tr', has_text=ev)
        try: row.locator('button', has_text='발행').click(timeout=8000)
        except Exception as ex: pass
        ok_ = until(lambda: q(f"select status from events where code='{ev}'") == 'PUBLISHED', 10); s_, r_ = did(f'/admin/events/{ev}/status')
        rec('G-178-2 운영 「이벤트」 — 「발행」을 누르면 로그인 토큰이 실린 요청이 나가고 처리됨(DB 상태 PUBLISHED)', ok_ and s_ and s_[-1][2] and r_ and r_[-1][2] < 300, (s_[-1:] , r_[-1:], q(f"select status from events where code='{ev}'")))
        bo_tab(bo, '수집 관리'); row = bo.locator('.bo-main table.tbl tbody tr', has_text=cs)
        try:
            row.locator('button', has_text='관리').click(timeout=8000); bo.wait_for_timeout(400)
            bo.locator('.bo-main table.tbl button', has_text=re.compile(r'^\s*차단\s*$')).first.click(timeout=5000)
        except Exception as ex: pass
        ok_ = until(lambda: q(f"select state from collect_sources where code='{cs}'") == 'BLOCKED', 10); s_, r_ = did(f'/admin/collect/sources/{cs}/')
        rec('G-178-3 운영 「수집 관리」 — 「관리 › 차단」을 누르면 로그인 토큰이 실린 요청이 나가고 처리됨(DB 상태 BLOCKED)', ok_ and s_ and s_[-1][2] and r_ and r_[-1][2] < 300, (s_[-1:], r_[-1:], q(f"select state from collect_sources where code='{cs}'")))
        bo_tab(bo, '신고 처리'); row = bo.locator('.bo-main table.tbl tbody tr', has_text=f'수정확인 신고 {tag}').first
        try:
            row.locator('button.btn-sm', has_text='처리').click(timeout=8000); bo.wait_for_timeout(400)
            bo.fill('.bo-main table.tbl textarea', '수정 확인 시험 — 기각합니다'); bo.locator('.bo-main table.tbl button', has_text='아닙니다 (기각)').click(timeout=5000)
        except Exception as ex: pass
        ok_ = until(lambda: q(f"select state from reports where detail='수정확인 신고 {tag}'") == 'DISMISSED', 10); s_, r_ = did('/admin/reports/')
        rec('G-178-4 운영 「신고 처리」 — 「처리 › 기각」을 누르면 로그인 토큰이 실린 요청이 나가고 처리됨(DB 상태 DISMISSED)', ok_ and s_ and s_[-1][2] and r_ and r_[-1][2] < 300, (s_[-1:], r_[-1:], q(f"select state from reports where detail='수정확인 신고 {tag}'")))
        # ── G-177 화면 ──
        # v10.26 — 대기 건이 하나도 없는 DB(Docker 의 쓰던 볼륨 등)에서도 화면을 볼 수 있게, 그때만 시험용 대기 건 1개를 넣었다가 끝에 지웁니다
        tmp_rv = None
        if q("select count(*) from review_items where status in ('QUEUED','IN_PROGRESS')") == '0':
            lid = q("select id from listings order by created_at desc limit 1"); aid_ = q("select id from accounts where email='admin@x.com'")
            if lid and aid_:
                tmp_rv = q(f"insert into review_items(target_type,target_id,gwan_code,submitted_by,sla_due_at,manual_reasons) select 'LISTING', id, gwan_code, '{aid_}', now() + interval '1 day', ARRAY['수정확인 시험 {tag}'] from listings where id='{lid}' returning id")
        bo_tab(bo, '검수 큐'); bo.wait_for_timeout(1500)
        st, rq = call('GET', '/admin/reviews', ADM); n_api = len(rq.get('items') or []) if isinstance(rq, dict) else len(rq or [])
        cards = bo.locator('.bo-main article.card').count()
        rec('G-177-3 운영 화면 「검수 큐」가 서버의 대기 건을 그대로 그림(건수 같음 · 0건이 아님)', n_api > 0 and cards == n_api, (cards, n_api))
        if tmp_rv: sql(f"DELETE FROM review_items WHERE id='{tmp_rv.split()[0]}'")
        ctx.close(); b.close()

    # ── 정리 ──
    sql(f"DELETE FROM events WHERE code='{ev}'"); sql(f"DELETE FROM collect_sources WHERE code='{cs}'")
    # 신고 기록은 지울 수 없습니다(제재 근거 — DB 가 막음). 화면에서 처리하지 못했으면 운영 API 로 기각해 닫아 둡니다
    for r_ in rows(f"select id from reports where detail='수정확인 신고 {tag}' and state='OPEN'"):
        call('PATCH', f'/admin/reports/{r_[0]}/resolve', ADM, {'state': 'DISMISSED', 'resolution': '수정 확인 시험 정리'})
    for r_ in rows(f"select order_no, status from hlt_orders where account_id='{aid}'"):
        if r_[1] in ('PENDING', 'PAID', 'PREPARING'):
            pend = q(f"select r.id from hlt_returns r join hlt_orders o on o.id=r.order_id where o.order_no='{r_[0]}' and r.state='REQUESTED' limit 1")
            if pend: call('POST', f'/admin/health/returns/{pend}/decide', ADM, {'state': 'APPROVED', 'note': '수정 확인 시험 정리'})
            else: cancel(TOK, ADM, r_[0])
    call('PATCH', f'/me/health/cart/{code}', TOK, {'qty': 0})
    left = rows(f"select order_no, status from hlt_orders where account_id='{aid}' and status not in ('CANCELED','REFUNDED')")
    rec(f'Z-1 (정리) 시험 주문이 모두 취소되고 재고가 처음({s0})과 같음 · 시험 이벤트 · 수집 대상을 지움 · 시험 신고는 처리됨(열린 것 0)', not left and stock() == s0 and q(f"select count(*) from events where code='{ev}'") == '0' and q(f"select count(*) from reports where detail='수정확인 신고 {tag}' and state='OPEN'") == '0', (left, stock()))

    json.dump(R, open(f'{HERE}/fix_1026.json', 'w'), ensure_ascii=False, indent=1)
    bad = [r for r in R if not r['ok'] and not r.get('skip')]
    print(f"\n통과 {sum(1 for r in R if r['ok'])} / {len(R)}" + (f" · 실패 {len(bad)}: " + ' · '.join(b['step'].split(' ')[0] for b in bad) if bad else ''))

if __name__ == '__main__':
    main()
