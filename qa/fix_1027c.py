"""v10.27 — G-130 개발 반영(10/9 「G-130 시안 반영분 개발에도 반영」) 서버 · 사용자 웹 · 운영 화면 확인.

  C-1  운영 파트너사 상세 API(GET /admin/partners/:id) — 200(사업자 · 서비스 · 지역 · 이용료) · uuid 아님 400 · 없음 404 · 운영자 아님 403 · 다른 GET(fees · services/pending) 그대로
  C-2  파트너 알림 API 가 연결 주소(linkUrl)를 돌려줌 · 파트너센터 「공지 · 알림」에 「보기」(사이트 안 주소만)
  C-3  계약 상태에 양식 코드(templateCode) · 계약서 화면 「양식 전문 보기」 → /contracts/templates/{코드} — DB 의 글 그대로(조 · 표) · 없는 양식은 안내
  C-4  사기 예방 가이드(/safety/guide) — 유형 5종 · 유형 고르기(?t=) · 고객센터 · 안심소개에서 들어오는 길
  C-5  소개몰 배송 조회 「송장번호 복사」 · 「택배사에서 보기」 → 택배사 조회(/ship/carrier) — 넘기는 값 · 발송 전이면 단추 없음
  C-6  운영 화면 파트너 목록 「상세」 → 파트너사 상세(서비스 · 리드 이용료) · 닫기
사용:  python3 fix_1027c.py     결과 fix_1027c.json
"""
import sys, os, re, json, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flow_lib import *
from playwright.sync_api import sync_playwright

R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print('ok  ' if ok else 'FAIL', step, '|', str(detail)[:220], file=sys.stderr, flush=True)

A = login('admin@x.com')
# ── C-1 ──
pid = q("select p.id from partners p join partner_services s on s.partner_id=p.id group by p.id order by count(*) desc limit 1")
st, j = call('GET', f'/admin/partners/{pid}', A); j = j if isinstance(j, dict) else {}
n_svc = int(q(f"select count(*) from partner_services where partner_id='{pid}'"))
rec('C-1a 파트너사 상세 200 — 회사 · 사업자번호 · 상태 · 미청구 · 한도 · 서비스(DB 건수) · 지역 · 이용료(상태별)',
    st == 200 and j.get('company') and j.get('bizRegNo') and j.get('status') and isinstance(j.get('services'), list) and len(j['services']) == min(n_svc, 50)
    and isinstance(j.get('regions'), list) and isinstance(j.get('fees'), list) and isinstance(j.get('unpaid'), (int, float)), (st, {k: j.get(k) for k in ('company', 'status', 'unpaid', 'unpaidCap', 'stopped')}, n_svc))
pend = int(float(q(f"select coalesce(sum(amount),0) from lead_fees where partner_id='{pid}' and state='PENDING'")))
rec('C-1b 미청구 = DB 의 미청구 합계 · 수신 멈춤(stopped) = 미청구 ≥ 한도 또는 운영 중 아님', j.get('unpaid') == pend and j.get('stopped') == (pend >= j.get('unpaidCap', 0) or j.get('status') != 'ACTIVE'), (j.get('unpaid'), pend))
rec('C-1c uuid 가 아니면 400 · 없는 파트너 404 · 운영자가 아니면 403',
    (call('GET', '/admin/partners/not-a-uuid', A)[0], call('GET', f'/admin/partners/{uuid.uuid4()}', A)[0], call('GET', f'/admin/partners/{pid}', login('buyer@x.com'))[0]) == (400, 404, 403), '')
rec('C-1d 같은 주소 아래 다른 조회(GET fees · services/pending)는 그대로 200(:id 가 가로채지 않음)',
    call('GET', '/admin/partners/fees', A)[0] == 200 and call('GET', '/admin/partners/services/pending', A)[0] == 200, '')

# ── C-2 ── 파트너 알림의 연결 주소
pacct = q(f"select b.account_id from partners p join businesses b on b.id=p.business_id where p.id='{pid}'")
pemail = q(f"select email from accounts where id='{pacct}'")
tag = uuid.uuid4().hex[:6]
q(f"insert into notifications(account_id, event_code, title, body, link_url) values ('{pacct}', 'PARTNER_TEST', '알림 보기 시험 {tag}', '연결 주소 시험', '/partner/leads')")
q(f"insert into notifications(account_id, event_code, title, body, link_url) values ('{pacct}', 'PARTNER_TEST', '바깥 주소 시험 {tag}', '바깥 주소는 그리지 않음', '//evil.example/x')")
PT = login(pemail) if pemail.endswith('@x.com') else None
st, ns = call('GET', '/partner/notices', PT) if PT else (0, [])
mine = [x for x in (ns or []) if tag in (x.get('title') or '')]
rec('C-2a 파트너 알림 API 가 연결 주소(linkUrl)를 돌려줌', st == 200 and any(x.get('linkUrl') == '/partner/leads' for x in mine), (st, pemail, [(x.get('title'), x.get('linkUrl')) for x in mine]))

# ── C-3 ──
did = q("select deal_id from deal_contracts order by issued_at desc limit 1")
if not did:   # v10.27(2) — 계약서가 하나도 없는 DB(새로 만든 DB · Docker): intro 매물 → 새 회원 문의 → 거래 → 계약서 발급을 시험이 만듦
    import uuid as _u; _tag = _u.uuid4().hex[:6]; SEL = login('intro@x.com')
    lid = q("select l.id from listings l join accounts a on a.id=l.owner_account_id where a.email='intro@x.com' and l.status='PUBLISHED' limit 1")
    if not lid:
        cat = q("select id from categories where gwan_code='MNY' and status='APPROVED' and restricted_code is null limit 1")
        _st, _j = call('POST', '/listings', SEL, {'gwanCode': 'MNY', 'categoryId': cat, 'title': f'양식 확인 시험 매물 {_tag}',
                       'body': '계약 양식 확인용 시험 매물입니다. 사무실 인테리어 업체를 소개받습니다.', 'desiredFee': 300000, 'feeBearer': 'SELLER'})
        if isinstance(_j, dict) and _j.get('reviewId') and _j.get('status') != 'PUBLISHED': call('PATCH', f"/admin/reviews/{_j['reviewId']}", A, {'decision': 'APPROVED'})
        lid = (_j or {}).get('listingId')
    _em, _pw, BUY, _bid = signup('fx7c', '양식 확인'); call('POST', '/verifications/identity', BUY, {'provider': 'PASS'})
    _st, cv = call('POST', '/conversations', BUY, {'targetType': 'LISTING', 'targetId': lid, 'message': f'양식 확인 {_tag}'})
    _st, d = call('POST', f"/conversations/{cv['conversationId']}/deal", SEL)
    call('POST', f"/deals/{d['dealId']}/contract", SEL, {'templateCode': 'STD_V1'})
    did = q("select deal_id from deal_contracts order by issued_at desc limit 1")
parties = rows(f"select a.email from deals d join accounts a on a.id in (d.buyer_account_id, d.seller_account_id) where d.id='{did}'")
pt_email = next((r[0] for r in parties if r[0].endswith('@x.com')), parties[0][0] if parties else None)
st, cs = call('GET', f'/deals/{did}/contract/state', login(pt_email)) if pt_email and pt_email.endswith('@x.com') else (0, {})
rec('C-3a 계약 상태에 양식 코드(templateCode) = DB 의 계약 양식', st == 200 and cs.get('templateCode') == q(f"select template_code from deal_contracts where deal_id='{did}' order by issued_at desc limit 1"), (st, (cs or {}).get('templateCode'), pt_email))

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); errs, apis = watch(pg)
    # C-4 사기 예방 가이드(로그인 없이)
    s0 = goto(pg, '/safety/guide'); t = text(pg, 'main') or text(pg)
    rec('C-4a /safety/guide 200 — 거래 전 확인 · 유형 5종 · 소개뱅크가 하는 일 · 신고', s0 == 200 and pg.locator('[data-sgd-sec]').count() == 5 and '소개뱅크 계좌로 보내라는 요구는 사기' in t and '피해가 났거나 의심되면' in t, (s0, pg.locator('[data-sgd-sec]').count()))
    pg.locator('[data-sgd-pick="c2"]').click(); pg.wait_for_timeout(1200)
    rec('C-4b 유형 「대금사기」 고르기 → 주소 ?t=c2 · 그 유형만', pg.url.endswith('?t=c2') and pg.locator('[data-sgd-sec]').count() == 1 and pg.locator('[data-sgd-sec="c2"]').count() == 1, pg.url)
    goto(pg, '/support/new')   # v10.31 (w1 시안) — 고객센터 첫 화면 = /support/new (/support 는 챗봇 1:1 문의)
    rec('C-4c 고객센터에서 「사기 예방 가이드」로 가는 길', pg.locator('a[href="/safety/guide"]').count() >= 1, '')
    goto(pg, '/mall')
    rec('C-4d 안심소개 「먼저 확인할 것」 상자에서 「사기 예방 가이드 보기」', pg.locator('a[data-sgd-link]').count() >= 1, pg.locator('a[data-sgd-link]').count())
    # C-3 양식 전문(로그인 없이도 보는 글)
    s1 = goto(pg, '/contracts/templates/INTRO_STD'); t = text(pg, 'main') or text(pg)
    rec('C-3b /contracts/templates/INTRO_STD — DB 의 글 그대로(제1조 ~ 제8조 · 표 2개 · 변호사법 안내 · 시행일)',
        s1 == 200 and all(f'제{i}조' in t for i in range(1, 9)) and pg.locator('[data-ctform] table').count() == 2 and '변호사법 109조' in t and '시행일 2026-11-11' in t, (s1, pg.locator('[data-ctform] table').count()))
    goto(pg, '/contracts/templates/STD_V1'); t = text(pg, 'main') or text(pg)
    rec('C-3c 구 양식(STD_V1)은 그 글 + 지금 쓰는 양식(INTRO_STD)으로 가는 길', '구 버전' in t and pg.locator('a[href="/contracts/templates/INTRO_STD"]').count() == 1, t[:80])
    goto(pg, '/contracts/templates/NO_SUCH'); t = text(pg, 'main') or text(pg)
    rec('C-3d 없는 양식 → 「없는 양식입니다」(오류 화면 아님)', '없는 양식입니다' in t, t[:80])
    rec('C-4e 이 쪽들에서 스크립트 오류 0', not errs, errs[:3])
    ctx.close()

    # C-3e 계약서 화면 「양식 전문 보기」
    if pt_email and pt_email.endswith('@x.com'):
        c2 = br.new_context(); pg2 = site_login(c2, pt_email)
        goto(pg2, f'/my/contracts/{did}')
        lk = pg2.locator('a[data-ctform-link]')
        href = lk.get_attribute('href') if lk.count() else None
        rec('C-3e 계약서 화면에 「양식 전문 보기」 → 그 계약의 양식', (href or '').split('?')[0] == f"/contracts/templates/{cs.get('templateCode')}", href)   # v10.31 (w3) — ?deal= 를 붙여 돌아오는 길을 줌
        c2.close()
    # C-2b 파트너센터 「공지 · 알림」의 「보기」
    if PT:
        c3 = br.new_context(); pg3 = site_login(c3, pemail); goto(pg3, '/partner/notices?tab=alarm')   # v10.31 (W5 시안) — 공지사항 · 알림 두 탭, 알림은 ?tab=alarm
        hrefs = [a.get_attribute('href') for a in pg3.locator('a[data-ntgo]').all()]
        rec('C-2b 파트너센터 「공지 · 알림」 — 연결 주소가 있는 알림에 「보기」 · 바깥 주소(//…)는 그리지 않음', '/partner/leads' in hrefs and not any(h.startswith('//') for h in hrefs), hrefs[:5])
        c3.close()
    # C-5 소개몰 배송 조회
    no = q("select o.order_no from hlt_orders o join hlt_shipments s on s.order_id=o.id join accounts a on a.id=o.account_id where a.email='buyer@x.com' and s.tracking_no is not null order by o.created_at desc limit 1")
    no0 = q("select o.order_no from hlt_orders o join accounts a on a.id=o.account_id where a.email='buyer@x.com' and not exists(select 1 from hlt_shipments s where s.order_id=o.id) order by o.created_at desc limit 1")
    made_pnd = None
    if not no or not no0:   # v10.27(2) — 새로 만든 DB · Docker: buyer 의 주문이 없으면 시험이 만듦(발송 처리 API 가 없어 집화 기록은 DB 에 넣음 — flow_mall 과 같은 방식 · G-147 은 v10.28)
        import uuid as _u2
        BT = login('buyer@x.com'); bid = q("select id from accounts where email='buyer@x.com'")
        addr = q(f"select id from hlt_addresses where account_id='{bid}' order by is_default desc limit 1")
        if not addr:
            _s, _a = call('POST', '/me/health/addresses', BT, {'receiver': '확인', 'phone': '010-1111-2222', 'zipcode': '06000', 'addr1': '서울 강남구 테헤란로 1'})
            addr = (_a or {}).get('id') or q(f"select id from hlt_addresses where account_id='{bid}' limit 1")
        pr = rows("select p.code, o.id from hlt_products p join hlt_product_options o on o.product_id=p.id and o.is_active where p.status='ON_SALE' and o.stock >= 3 and p.code !~ '^OPTTEST' order by p.price limit 1")
        def _order():
            _s, _o = call('POST', '/health/orders', BT, {'addressId': addr, 'items': [{'productCode': pr[0][0], 'optionId': pr[0][1], 'qty': 1}]}) if pr and addr else (0, {})
            return (_o or {}).get('orderNo'), (_o or {})
        if not no:
            no, od = _order()
            if no:
                call('POST', f"/health/orders/{no}/pay", BT, {'method': 'CARD'})
                call('POST', f"/health/orders/{no}/pay/confirm", BT, {'paymentKey': 'stub_' + _u2.uuid4().hex, 'amount': int(od.get('total', 0))})
                q(f"insert into hlt_shipments(order_id, carrier, tracking_no, state, note) select id, 'CJ대한통운', '6{_u2.uuid4().int % 10**11:011d}', 'PICKED', '수정 확인 {tag} — 집화' from hlt_orders where order_no='{no}'")
        if not no0:
            no0, _ = _order(); made_pnd = no0
    c4 = br.new_context(); pg4 = site_login(c4, 'buyer@x.com')
    if no:
        goto(pg4, f'/my/health/orders/{no}/ship')
        rec('C-5a 배송 조회 — 「송장번호 복사」 · 「택배사에서 보기」', pg4.locator('button[data-copy]').count() == 1 and pg4.locator('a[data-carrier-link]').count() == 1, (no,))
        pg4.locator('a[data-carrier-link]').click(); pg4.wait_for_timeout(1500)
        try: pg4.wait_for_url('**/ship/carrier', timeout=30000); pg4.wait_for_selector('[data-carrier]', timeout=15000)   # v10.27(2) — Docker(개발 방식)는 처음 여는 화면을 그때 빌드
        except Exception: pass
        tn = q(f"select s.tracking_no from hlt_shipments s join hlt_orders o on o.id=s.order_id where o.order_no='{no}' and s.tracking_no is not null limit 1")
        t = text(pg4, 'main') or text(pg4)
        rec('C-5b 택배사 조회 화면 — 택배사 · 송장번호(DB) · 넘기는 값(이름 · 주소 · 연락처는 넘기지 않음)', pg4.url.endswith(f'/ship/carrier') and pg4.locator('[data-carrier]').count() == 1 and tn in t and '넘기지 않습니다' in t, (pg4.url[-40:], tn))
    else:
        rec('C-5a 배송 조회 — 송장번호가 있는 시험 주문을 만들지 못함', False, '')   # v10.27(2) — 전에는 건너뜀을 통과로 셈
    if no0:
        goto(pg4, f'/my/health/orders/{no0}/ship/carrier'); t = text(pg4, 'main') or text(pg4)
        rec('C-5c 발송 전 주문의 택배사 조회 — 「발송 전」 안내 · 복사 단추 없음', '발송 전' in t and pg4.locator('button[data-copy]').count() == 0, t[:60])
        if made_pnd: call('POST', '/me/health/returns', login('buyer@x.com'), {'orderNo': made_pnd, 'kind': 'CANCEL', 'reason': 'CHANGE_MIND'})
    c4.close()
    # C-6 운영 화면
    c5 = br.new_context(viewport={'width': 1400, 'height': 1000}); bo = bo_login(c5)
    ok_tab = bo_tab(bo, '파트너사') or bo_tab(bo, '파트너')
    bo.wait_for_timeout(1500)
    btn = bo.locator(f'button[data-ptn-open="{pid}"]')
    if btn.count() == 0: btn = bo.locator('button[data-ptn-open]').first
    want = btn.get_attribute('data-ptn-open') if btn.count() else None
    if want: btn.click(); bo.wait_for_timeout(1500)
    d = bo.locator('[data-ptn-detail]')
    rec('C-6a 운영 화면 파트너 목록 「상세」 → 그 파트너사 상세(서비스 · 리드 이용료)', ok_tab and d.count() == 1 and d.get_attribute('data-ptn-detail') == want and '리드 이용료' in d.inner_text(), (ok_tab, want, d.count()))
    if d.count(): bo.locator('[data-ptn-close]').click(); bo.wait_for_timeout(500)
    rec('C-6b 「닫기」 → 상세가 닫힘', bo.locator('[data-ptn-detail]').count() == 0, '')
    c5.close()
    br.close()

try: q(f"delete from notifications where title like '%시험 {tag}'")
except Exception: pass      # 알림을 지우지 못하게 막혀 있으면 남김(시험 글 표시)
json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fix_1027c.json'), 'w'), ensure_ascii=False, indent=1)
bad = [r for r in R if not r['ok']]
print(f"\n{len(R) - len(bad)}/{len(R)} 통과", file=sys.stderr)
print(f"통과 {len(R) - len(bad)} / {len(R)}")
sys.exit(1 if bad else 0)
