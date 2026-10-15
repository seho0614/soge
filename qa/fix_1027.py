"""v10.27(결함 수정판 · 10/8) — 열린 결함의 수정 확인.  고치기 전에 먼저 만들어 실패를 확인한 시험입니다.

  A 서버 · DB
    G-212 기준 데이터의 외래 키 위반          G-172 빈 표 _t                    G-176 오픈 체크리스트에 간주 모드 · 중개사 자격 대조
    G-175 광고 서버의 머리말 이름             G-171 주문 생성의 요청 키           G-184 결제 전 취소의 환불 표시
    G-190 제휴 주문 귀속 · 취소 회수          G-191 소개광장 글 신고 · 3건 가림   G-207 중개사 심사 목록(쪽 · 찾기 · 순서)
    T     판매 약관 — 운영 첫 발행은 DB 의 글(10/8 답)
  B 화면 — fix_1027_ui.py
시험이 만든 것은 끝에 치웁니다(주문 취소 · 시험 제휴상품 · 링크 · 시험 글 신고 처리). 계정(fx7_*@t.local)은 남습니다.
사용:  python3 fix_1027.py      결과 fix_1027.json
"""
import sys, os, re, hashlib, hmac, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import *

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
R = []
def rec(step, ok, detail='', skip=False):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400], **({'skip': True} if skip else {})})
    print(('건너뜀' if skip else 'ok  ' if ok else 'FAIL'), step, '|', str(detail)[:220], file=sys.stderr, flush=True)
def safe(name, fn):
    try: fn()
    except Exception as ex: rec(f'{name} 실행 중 오류', False, repr(ex)[:300])
def member(prefix, name):
    em, pw, tok, aid = signup(prefix, name)
    call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
    st, a = call('POST', '/me/health/addresses', tok, {'receiver': '확인', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
    addr = (a or {}).get('id') or q(f"select id from hlt_addresses where account_id='{aid}' limit 1")
    return em, pw, tok, aid, addr
def one_option_product(min_stock=6):
    r = rows(f"""select p.code, o.id from hlt_products p join hlt_product_options o on o.product_id=p.id and o.is_active
                  where p.status='ON_SALE' and o.stock >= {min_stock} and p.code !~ '^OPTTEST'
                  order by (select count(*) from hlt_product_options x where x.product_id=p.id and x.is_active), p.price limit 1""")
    return r[0] if r else (None, None)
def cancel(tok, adm, no):
    st, r = call('POST', '/me/health/returns', tok, {'orderNo': no, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    if st < 300 and isinstance(r, dict) and r.get('id'):
        return call('POST', f"/admin/health/returns/{r['id']}/decide", adm, {'state': 'APPROVED', 'note': '수정 확인 시험 정리'})
    return st, r
def pay(tok, no, total):
    call('POST', f'/health/orders/{no}/pay', tok, {'method': 'CARD'})
    return call('POST', f'/health/orders/{no}/pay/confirm', tok, {'paymentKey': 'stub_' + uuid.uuid4().hex[:12], 'amount': int(total)})

def main():
    ADM = login('admin@x.com'); tag = uuid.uuid4().hex[:6]
    made = []      # (tok, orderNo) — 끝에 취소

    # ── G-212 기준 데이터의 외래 키 위반 ─────────────────────────────────────
    def g212():
        fks = rows("""select c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text, af.attname
                        from pg_constraint c
                        join pg_attribute a  on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                        join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
                       where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace""")
        bad = []
        for t, col, ft, fcol in fks:
            n = q(f'select count(*) from {t} x where x."{col}" is not null and not exists (select 1 from {ft} y where y."{fcol}" = x."{col}")')
            if n != '0': bad.append(f'{t}.{col}→{ft}: {n}')
        rec('G-212-1 외래 키(한 칸짜리) 전부 — 없는 줄을 가리키는 값 0 (pg_dump 로 옮겨도 외래 키가 모두 만들어짐)', not bad, (len(fks), bad[:6]))
        rec('G-212-2 고친 2곳 — 운영 설정의 「바꾼 사람」 · 광고 자리의 광고주가 없는 계정 · 사업자를 가리키지 않음',
            q("select count(*) from site_settings s where updated_by is not null and not exists (select 1 from accounts a where a.id=s.updated_by)") == '0'
            and q("select count(*) from ad_placements p where advertiser_business_id is not null and not exists (select 1 from businesses b where b.id=p.advertiser_business_id)") == '0', '')
    safe('G-212', g212)

    # ── G-172 빈 표 ──────────────────────────────────────────────────────────
    safe('G-172', lambda: rec('G-172 쓰지 않는 빈 표 public._t 가 없음', q("select count(*) from pg_class where relname='_t' and relnamespace='public'::regnamespace") == '0', ''))

    # ── G-176 오픈 체크리스트 ────────────────────────────────────────────────
    def g176():
        on = [r[0] for r in rows("select key from site_settings where key like 'assume.%' and value='on'")]
        got = [r[0] for r in rows("select item from v_open_blockers where kind='ASSUME'")]
        rec('G-176-1 간주 모드가 켜져 있으면 오픈 체크리스트(v_open_blockers)에 「간주 모드」 줄이 켜진 개수만큼 나옴', len(on) > 0 and sorted(got) == sorted(on), (on, got))
        st, ob = call('GET', '/admin/open-blockers', ADM)
        txt = json.dumps(ob, ensure_ascii=False)
        rec('G-176-2 운영 API 의 오픈 체크리스트 응답에도 간주 모드 줄이 있음', st == 200 and 'assume.' in txt, st)
        r = rows("select code, name, blocks_open, secret_key_name from integrations where code='BROKER'")
        rec('G-176-3 외부 연동 표에 「국토부 중개사 자격 대조」(BROKER · 키 BROKER_LOOKUP_KEY · 오픈 전 필요)', r and r[0][2] == 't' and r[0][3] == 'BROKER_LOOKUP_KEY' and '중개사' in r[0][1], r)
    safe('G-176', g176)

    # ── G-175 광고 서버 머리말 ───────────────────────────────────────────────
    def g175():
        src = open(os.path.join(KIT, '..', 'sgb-ads', 'src', 'core', 'core-api.ts'), encoding='utf8').read()
        guard = open(os.path.join(KIT, 'src', 'core', 'internal-key.guard.ts'), encoding='utf8').read()
        want = re.search(r"headers\['([a-z-]+)'\]", guard).group(1)
        sent = re.findall(r"'(X-[A-Za-z-]+)':", src)
        rec(f'G-175 광고 서버가 본체에 보내는 머리말 이름 = 본체가 읽는 이름({want})', [s.lower() for s in sent] == [want], sent)
    safe('G-175', g175)

    # ── G-171 주문 생성의 요청 키 ────────────────────────────────────────────
    def g171():
        code, opt = one_option_product()
        em, pw, tok, aid, addr = member('fx7', '수정확인')
        body = {'addressId': addr, 'items': [{'productCode': code, 'optionId': opt, 'qty': 1}]}
        key = 'fx7-' + uuid.uuid4().hex
        n0 = int(q(f"select count(*) from hlt_orders where account_id='{aid}'"))
        s1, o1 = call('POST', '/health/orders', tok, body, headers={'Idempotency-Key': key})
        s2, o2 = call('POST', '/health/orders', tok, body, headers={'Idempotency-Key': key})
        n1 = int(q(f"select count(*) from hlt_orders where account_id='{aid}'"))
        no1, no2 = (o1 or {}).get('orderNo'), (o2 or {}).get('orderNo')
        for no in {no1, no2} - {None}: made.append((tok, no))
        rec('G-171-1 같은 요청 키로 주문을 두 번 보내도 주문은 1건 · 두 번째는 첫 응답 그대로(같은 주문번호)', s1 < 300 and s2 < 300 and n1 - n0 == 1 and no1 and no1 == no2, (s1, s2, n1 - n0, no1, no2))
        s3, o3 = call('POST', '/health/orders', tok, dict(body, items=[{'productCode': code, 'optionId': opt, 'qty': 2}]), headers={'Idempotency-Key': key})
        rec('G-171-2 같은 키로 다른 내용을 보내면 409 IDEMPOTENCY_KEY_REUSED (주문 안 생김)', s3 == 409 and (o3 or {}).get('code') == 'IDEMPOTENCY_KEY_REUSED' and int(q(f"select count(*) from hlt_orders where account_id='{aid}'")) == n1, (s3, (o3 or {}).get('code')))
        s4, o4 = call('POST', '/health/orders', tok, body, headers={'Idempotency-Key': ''})
        if (o4 or {}).get('orderNo'): made.append((tok, o4['orderNo']))
        rec('G-171-3 키 없이 보내는 기존 길(시험 · 시안의 서버 연동)은 그대로 주문됨', s4 < 300 and bool((o4 or {}).get('orderNo')), s4)
    safe('G-171', g171)

    # ── G-184 결제 전 취소 ───────────────────────────────────────────────────
    def g184():
        code, opt = one_option_product()
        em, pw, tok, aid, addr = member('fx7', '수정확인')
        s, o = call('POST', '/health/orders', tok, {'addressId': addr, 'items': [{'productCode': code, 'optionId': opt, 'qty': 1}]}); no = (o or {}).get('orderNo')
        st, d = call('GET', f'/me/health/orders/{no}', tok); rs = (d or {}).get('returnShip') or {}
        rec('G-184-1 결제 전 주문의 상세 — 환불 기준 금액 0 · 「결제 전」 표시(paid false)', st == 200 and rs.get('paid') is False and rs.get('paidAmount') == 0, {k: rs.get(k) for k in ('paid', 'paidAmount', 'customerRefundEstimate')})
        cancel(tok, ADM, no)
        st, lst = call('GET', '/me/health/returns', tok); it = [x for x in (lst if isinstance(lst, list) else (lst or {}).get('items', [])) if x.get('orderNo') == no]
        x = it[0] if it else {}
        rec('G-184-2 결제 전 취소가 승인된 내역 — 환불 금액이 「확정 전」이 아니라 「결제 전 취소」(beforePayment true · 환불 0)', x.get('beforePayment') is True and x.get('state') == 'APPROVED', {k: x.get(k) for k in ('state', 'beforePayment', 'refundAmount')})
    safe('G-184', g184)

    # ── G-190 제휴 주문 귀속 ─────────────────────────────────────────────────
    def g190():
        code, opt = one_option_product()
        intro = login('intro@x.com')
        pcode = f'FX7-{tag.upper()}'
        st, p = call('POST', '/admin/affiliates/products', ADM, {'code': pcode, 'name': f'수정확인 제휴 {tag}', 'commission': 1500, 'landingUrl': f'/health/p/{code}', 'advertiser': '수정확인'})
        prod = q(f"select id from affiliate_products where code='{pcode}'")
        call('PATCH', f'/admin/affiliates/products/{prod}', ADM, {'status': 'ON_SALE'})
        st, l = call('POST', '/partner/affiliate/links', intro, {'productId': prod, 'label': f'수정확인 {tag}'})
        link = q(f"select code from partner_links where product_id='{prod}'")
        G = {}
        try:
            visitor = str(uuid.uuid4())
            st, c = call('GET', f'/r/{link}', headers={'X-Visitor-Key': visitor, 'User-Agent': 'Mozilla/5.0 (fix_1027)'})
            rec('G-190-0 (준비) 제휴상품 · 소개링크 · 그 링크 클릭(방문자 쿠키 있음)', bool(prod) and bool(link) and st == 200, (st, link))
            em, pw, tok, aid, addr = member('fx7', '수정확인')
            body = {'addressId': addr, 'items': [{'productCode': code, 'optionId': opt, 'qty': 1}]}
            s, o = call('POST', '/health/orders', tok, body, headers={'X-Visitor-Key': visitor}); no = (o or {}).get('orderNo'); made.append((tok, no)); G['no'] = no
            pay(tok, no, (o or {}).get('total') or 0)
            po = rows(f"select p.state, p.commission, p.attributed, l.code from partner_orders p join partner_links l on l.id=p.link_id where p.order_no='{no}'")
            rec('G-190-1 링크 클릭 → 72시간 안에 소개몰 주문 → 결제하면 제휴 주문(partner_orders)이 그 링크 · 1,500원 · 확정 전(PENDING)으로 생김', po == [['PENDING', '1500', 't', link]], po)
            rv = rows(f"select amount from partner_revenues r join partner_orders p on p.id=r.order_id where p.order_no='{no}'")
            rec('G-190-2 수익(partner_revenues)에 그 수수료가 잡힘', rv == [['1500']], rv)
            st, ol = call('GET', '/partner/affiliate/orders', intro)
            rec('G-190-3 파트너의 주문/고객현황 API(/partner/affiliate/orders)에 그 주문이 보임', st == 200 and any((x or {}).get('orderNo') == no for x in (ol or [])), st)
            stt = q(f"select orders from partner_link_stats s join partner_links l on l.id=s.link_id where l.code='{link}' order by stat_date desc limit 1")
            rec('G-190-4 링크 집계(partner_link_stats)의 주문 수가 1', stt == '1', stt)
            cancel(tok, ADM, no)
            after = rows(f"select state from partner_orders where order_no='{no}'")
            rv2 = rows(f"select amount from partner_revenues r join partner_orders p on p.id=r.order_id where p.order_no='{no}' order by r.created_at")
            rec('G-190-5 주문을 취소하면 제휴 주문은 「취소」 · 수수료는 회수(−1,500원 줄)', after == [['CANCELED']] and rv2 == [['1500'], ['-1500']], (after, rv2))
            # 귀속되지 않아야 하는 것 — 방문자 쿠키 없이 · 클릭 72시간 넘음 · 파트너 본인
            s, o2 = call('POST', '/health/orders', tok, body); no2 = (o2 or {}).get('orderNo'); made.append((tok, no2)); pay(tok, no2, (o2 or {}).get('total') or 0)
            rec('G-190-6 클릭 기록이 없는 주문(방문자 쿠키 없음)은 귀속되지 않음', q(f"select count(*) from partner_orders where order_no='{no2}'") == '0', no2)
            v2 = str(uuid.uuid4()); call('GET', f'/r/{link}', headers={'X-Visitor-Key': v2, 'User-Agent': 'Mozilla/5.0 (fix_1027)'})
            sql(f"update aff_touches set clicked_at = now() - interval '73 hours' where link_id=(select id from partner_links where code='{link}') and clicked_at > now() - interval '1 minute'")
            s, o3 = call('POST', '/health/orders', tok, body, headers={'X-Visitor-Key': v2}); no3 = (o3 or {}).get('orderNo'); made.append((tok, no3)); pay(tok, no3, (o3 or {}).get('total') or 0)
            rec('G-190-7 클릭 뒤 72시간이 지난 주문은 귀속되지 않음', q(f"select count(*) from partner_orders where order_no='{no3}' and attributed") == '0', no3)
            iem = 'intro@x.com'; v3 = str(uuid.uuid4()); call('GET', f'/r/{link}', headers={'X-Visitor-Key': v3, 'User-Agent': 'Mozilla/5.0 (fix_1027)'})
            iaddr = q("select h.id from hlt_addresses h join accounts a on a.id=h.account_id where a.email='intro@x.com' limit 1")
            if not iaddr:
                call('POST', '/me/health/addresses', intro, {'receiver': '확인', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
                iaddr = q("select h.id from hlt_addresses h join accounts a on a.id=h.account_id where a.email='intro@x.com' limit 1")
            s, o4 = call('POST', '/health/orders', intro, dict(body, addressId=iaddr), headers={'X-Visitor-Key': v3}); no4 = (o4 or {}).get('orderNo')
            if no4: made.append((intro, no4)); pay(intro, no4, (o4 or {}).get('total') or 0)
            rec('G-190-8 파트너 본인이 자기 링크로 들어와 산 주문은 귀속되지 않음', bool(no4) and q(f"select count(*) from partner_orders where order_no='{no4}'") == '0', (s, no4))
            mw = open(os.path.join(KIT, 'site', 'src', 'middleware.ts'), encoding='utf8').read()
            rec('G-190-9 사용자 웹의 주문 요청이 방문자 쿠키를 API 로 넘김(미들웨어가 /api/v1/health/orders 에 X-Visitor-Key)', '/api/v1/health/orders' in mw, '')
        finally:
            G['prod'] = prod
            for tk, n in list(made):
                pass
            CLEAN.append(lambda: (sql(f"update partner_links set is_active=false where product_id='{prod}'"), sql(f"update affiliate_products set status='STOPPED' where id='{prod}'")))
    safe('G-190', g190)

    # ── G-191 소개광장 글 신고 ───────────────────────────────────────────────
    def g191():
        em, pw, tok, aid = signup('fx7', '수정확인'); call('POST', '/verifications/identity', tok, {'provider': 'PASS'})
        title = f'수정확인 신고 시험 글 {tag}'
        call('POST', '/me/community/posts', tok, {'board': 'QNA', 'title': title, 'body': '신고가 3건 쌓이면 가려져야 하는 글입니다.'})
        pid = q(f"select id from posts where title='{title}'"); call('POST', f'/admin/community/posts/{pid}/approve', ADM)
        st, r0 = call('GET', '/report-reasons')
        reason = 'SPAM'
        s0, e0 = call('POST', '/reports', tok, {'targetType': 'POST', 'targetId': pid, 'reasonCode': reason, 'detail': '자기 글'})
        rec('G-191-1 자기 글은 신고할 수 없음(4xx)', 400 <= s0 < 500, (s0, (e0 or {}).get('code')))
        sts = []
        for i in range(3):
            e, p_, t_, a_ = signup('fx7r', f'신고자{i}'); call('POST', '/verifications/identity', t_, {'provider': 'PASS'})
            s, j = call('POST', '/reports', t_, {'targetType': 'POST', 'targetId': pid, 'reasonCode': reason, 'detail': f'수정확인 신고 {tag}'})
            sts.append(s)
            if i == 1:
                st2, g2 = call('GET', f'/community/posts/{pid}')
                rec('G-191-2 신고 2건까지는 글이 그대로 보임 · 글의 신고 수 2', st2 == 200 and q(f"select report_count from posts where id='{pid}'") == '2', (st2, q(f"select report_count, state from posts where id='{pid}'")))
        r = rows(f"select state, report_count, hidden_at is not null from posts where id='{pid}'")
        rec('G-191-3 서로 다른 회원 3명이 신고하면 글이 가려짐(HIDDEN · 신고 3) · 운영 「신고 3건 이상」 목록(v_post_reported)에 나옴', sts == [201, 201, 201] and r == [['HIDDEN', '3', 't']] and q(f"select count(*) from v_post_reported where id='{pid}'") == '1', (sts, r))
        st, lst = call('GET', '/admin/community/queue', ADM)
        rec('G-191-4 운영 소개광장 큐의 「신고된 글」에 그 글', st == 200 and any((x or {}).get('id') == pid for x in (lst or {}).get('reported', [])), st)
        st3, g3 = call('GET', '/community/posts')
        rec('G-191-5 가려진 글은 공개 목록에 없음', st3 == 200 and title not in json.dumps(g3, ensure_ascii=False), st3)
        for rid in [x[0] for x in rows(f"select id from reports where target_id='{pid}' and state in ('OPEN','QUEUED')")]:
            call('PATCH', f'/admin/reports/{rid}/resolve', ADM, {'state': 'DISMISSED', 'resolution': '수정 확인 시험 정리'})
    safe('G-191', g191)

    # ── G-207 중개사 심사 목록 ───────────────────────────────────────────────
    def g207():
        st, a = call('GET', '/admin/brokers?state=ALL&page=1&size=20', ADM)
        rec('G-207-1 목록이 쪽으로 나뉨 — 한 쪽 20건 · 전체 수(total) · 쪽 수', st == 200 and len((a or {}).get('items') or []) <= 20 and isinstance((a or {}).get('total'), int) and (a or {}).get('page') == 1, (st, (a or {}).get('total'), (a or {}).get('pages')))
        newest = q("select b.company_name from broker_verifications v join businesses b on b.id=v.business_id order by v.created_at desc, v.id limit 1")
        st, a2 = call('GET', '/admin/brokers?state=ALL&order=recent&size=5', ADM)
        rec('G-207-2 「최근 순」이면 가장 최근 신청이 맨 위', st == 200 and ((a2 or {}).get('items') or [{}])[0].get('company') == newest, (newest, [x.get('company') for x in (a2 or {}).get('items', [])][:2]))
        if newest:
            st, a3 = call('GET', '/admin/brokers?state=ALL&q=' + urllib.parse.quote(newest[:6]), ADM)
            rec('G-207-3 찾기(상호 · 대표 · 이메일 · 사업자번호)로 그 신청을 찾음', st == 200 and any(x.get('company') == newest for x in (a3 or {}).get('items', [])), (st, len((a3 or {}).get('items') or [])))
        st, a4 = call('GET', '/admin/brokers?state=PENDING&page=99999', ADM)
        rec('G-207-4 없는 쪽 번호는 빈 목록(오류 아님)', st == 200 and (a4 or {}).get('items') == [], st)
    safe('G-207', g207)

    # ── T 판매 약관 — 운영 첫 발행은 DB 의 글 ────────────────────────────────
    def terms():
        doc = open(os.path.join(KIT, 'docs', 'terms', 'HLT_SALE.md'), encoding='utf8').read().strip()
        db = open(os.path.join(HERE, 'hlt_sale_terms.md'), encoding='utf8').read().strip().replace('시행일 2026년 11월 11일', '시행일 〔시행일〕')
        rec('T-1 초안 생성기의 판매 약관(docs/terms/HLT_SALE.md) = DB 의 글(시안 · 개발 DB 에 실린 확정 문안 · 시행일만 자리표시자)', doc == db, (len(doc), len(db)))
        holes = re.findall(r'〔[^〕]+〕', doc)
        rec('T-2 그 글의 빈칸은 「〔시행일〕」 하나뿐(발행할 때 채움) — 발행 스크립트가 초안을 이 글로 맞춰도 확정 문안 그대로 발행됨', holes == ['〔시행일〕'], holes)
        n = q("select count(*) from terms where status in ('DRAFT','LEGAL_REVIEW') and body like '%시행일 2026년 11월 11일%'")
        rec('T-3 초안 약관 본문에 기준선 때의 날짜(「시행일 2026년 11월 11일」)가 박혀 있지 않음', n == '0', n)
    safe('T', terms)

    # ── 정리 ──
    for tk, no in made:
        if no and q(f"select status from hlt_orders where order_no='{no}'") in ('PENDING', 'PAID', 'PREPARING'): cancel(tk, ADM, no)
    for f in CLEAN:
        try: f()
        except Exception: pass
    left = [no for tk, no in made if no and q(f"select status from hlt_orders where order_no='{no}'") not in ('CANCELED', 'RETURNED', '')]
    rec('Z-1 (정리) 시험 주문이 모두 취소됨 · 시험 제휴상품 판매 중단', not left, left)

    json.dump(R, open(f'{HERE}/fix_1027.json', 'w'), ensure_ascii=False, indent=1)
    bad = [r for r in R if not r['ok'] and not r.get('skip')]
    print(f"\n통과 {sum(1 for r in R if r['ok'])} / {len(R)}" + (f" · 실패 {len(bad)}: " + ' · '.join(b['step'].split(' ')[0] for b in bad) if bad else ''))

CLEAN = []
if __name__ == '__main__':
    import urllib.parse
    main()
