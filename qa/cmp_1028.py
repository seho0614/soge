"""v10.28 반영 전 비교 그림 — (가) 소개몰 배송 · 구매확정 · 후기 · 문의 · 순위 · G-214  (나) 상담 이메일 · 개인 정산 · 약관 재동의
   (2026-10-09 · 비교 그림 → 확인 → 반영)

  python3 cmp_1028.py shoot     화면을 뜹니다 — 읽기만 합니다(주문 · 신청 · 동의를 만들거나 바꾸지 않음)
                                제안 그림은 지금 화면 위에 바꿀 모습을 덧그린 것입니다(노란 바탕 = 새로 생기는 것). 실제 코드는 아직 바꾸지 않았습니다.
  python3 cmp_1028.py sheet     떠 둔 그림을 나란히 붙입니다
결과: /home/claude/design_1009/cmp28   (raw/ = 낱장 · v10.28_반영전_*.png = 붙인 그림)
"""
import json, os, re, sys
from PIL import Image
from playwright.sync_api import sync_playwright
import shot_mall as sm
import shot_mall2 as s2
import flow_lib as fl

OUT = os.environ.get('CMPDIR', '/home/claude/design_1009/cmp28'); RAW = OUT + '/raw'; os.makedirs(RAW, exist_ok=True)
PROTO = 'file://' + os.environ.get('PROTO', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'); SITE = fl.SITE
P_ORDER = os.environ.get('P_ORDER', 'H20261002-000041')       # 시안 견본의 배송 완료 주문(shoot 에서 견본을 읽어 다시 정함)
W_ORDER = fl.q("select o.order_no from hlt_orders o join accounts a on a.id=o.account_id where a.email='buyer@x.com' and o.status='DELIVERED' order by o.created_at desc limit 1")
NEWBG = 'background:#fff3b0;outline:2px dashed #e0a800;outline-offset:2px'
MARK = f'style="{NEWBG}"'

# ── 제안 그림 — 지금 화면에 덧그리는 것(노란 바탕 = 새로 생김) ──────────────────────
JS_REVIEW = """(M) => {
  const m = document.querySelector('main') || document.body;
  const d = document.createElement('section'); d.setAttribute('style', M + ';margin:16px 0;padding:16px;border-radius:10px');
  d.innerHTML = `<h2 style="margin:0 0 6px">리뷰 쓰기 <small style="font-weight:400;color:#666">— 구매확정한 주문만 · 상품마다 1건</small></h2>
   <div style="font-size:15px;margin:6px 0">상품 <b>(이 주문의 상품 · 옵션)</b></div>
   <div style="font-size:26px;letter-spacing:4px;color:#f5a400">★★★★★ <span style="font-size:14px;color:#333;letter-spacing:0">5점 (눌러서 고름 · 1 ~ 5)</span></div>
   <textarea rows="4" style="width:100%;margin:8px 0" placeholder="10자 이상 1,000자 이내 — 효능 · 효과를 단정하는 표현은 가려질 수 있습니다"></textarea>
   <div style="display:flex;gap:8px"><button class="cta-primary" type="button">리뷰 올리기</button><button class="btn-sm" type="button">취소</button></div>
   <p class="hint" style="margin-top:8px">올린 리뷰는 <b>본인만</b> 고치거나 지울 수 있습니다. 운영자는 지우지 않고 <b>가림</b>만 합니다(가린 사유는 본인에게 알림).
   · 「구매확정」은 배송 완료 7일 뒤 자동으로 되며, 그 전에 직접 누를 수 있습니다.</p>`;
  const __h=m.querySelector('h1'); const __at=__h?(__h.closest('.page-head')||__h):null; if(__at) __at.after(d); else m.insertBefore(d,m.firstChild);
}"""

JS_SHIP_ADMIN = """([M, rows]) => {
  const root = document.querySelector('.bo-main') || document.querySelector('main') || document.body;
  const d = document.createElement('section'); d.setAttribute('style', M + ';margin:12px 0 18px;padding:14px;border-radius:8px;background-color:#fff3b0');
  d.innerHTML = `<h3 style="margin:0 0 4px">새 탭 「소개몰 주문」 — 발송 처리</h3>
   <p class="muted" style="margin:0 0 8px">결제 완료 주문에 택배사 · 송장번호를 넣고 「발송 처리」 → 주문이 「배송중」. 단계는 운영자가 바꿈(택배사 연동은 계약 뒤). 모든 처리는 감사 기록에 남음.</p>
   <table class="tbl" style="width:100%"><thead><tr><th>주문번호</th><th>상품</th><th>결제</th><th>상태</th><th>택배사</th><th>송장번호</th><th>처리</th></tr></thead><tbody>${rows.map(r => `<tr>
     <td class="mono">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td>
     <td><select><option>CJ대한통운</option><option>한진택배</option><option>롯데택배</option><option>우체국택배</option><option>로젠택배</option></select></td>
     <td><input style="width:140px" placeholder="숫자 10 ~ 14자리" value="${r[4]||''}"></td>
     <td>${r[3]==='결제 완료' ? '<button class="btn-ok">발송 처리</button>' : r[3]==='배송중' ? '<button class="btn-plain">배송 완료로</button> <button class="btn-plain">송장 고치기</button>' : '<span class="muted">구매확정 대기(7일 뒤 자동)</span>'}</td></tr>`).join('')}</tbody></table>`;
  root.insertBefore(d, root.firstChild);
}"""

JS_G214 = """(M) => {
  const m = document.querySelector('main') || document.body;
  const d = document.createElement('section'); d.setAttribute('style', M + ';margin:16px 0;padding:16px;border-radius:10px');
  d.innerHTML = `<h2 style="margin:0 0 6px">선택 항목 바꾸기 <small style="font-weight:400;color:#666">— 언제든 켜고 끌 수 있음 (G-214)</small></h2>
   <table class="tbl" style="width:100%"><thead><tr><th>항목</th><th>지금</th><th></th><th>마지막으로 바꾼 때</th></tr></thead><tbody>
   <tr><td>마케팅 정보 수신</td><td><b>동의</b></td><td><button class="btn-sm">거부로 바꾸기</button></td><td>2026-10-09 가입 때</td></tr>
   <tr><td>맞춤형 광고</td><td><b>거부</b></td><td><button class="btn-sm">동의로 바꾸기</button></td><td>2026-10-09 가입 때</td></tr>
   <tr><td>야간 광고 수신(21시 ~ 8시)</td><td><b>거부</b></td><td><button class="btn-sm">동의로 바꾸기</button></td><td>—</td></tr></tbody></table>
   <p class="hint" style="margin-top:8px">바꿀 때마다 기록이 <b>한 줄씩 쌓이고</b>(지우거나 고치지 않음), 광고 · 알림은 <b>가장 최근 줄</b>을 따릅니다. 필수 약관은 여기서 끌 수 없습니다(탈퇴로만).</p>`;
  const __h=m.querySelector('h1'); const __at=__h?(__h.closest('.page-head')||__h):null; if(__at) __at.after(d); else m.insertBefore(d,m.firstChild);
}"""

JS_CONSULT = """(M) => {
  const ph = document.querySelector('input[name=phone]'); const lab = ph && ph.closest('label');
  if (lab) { const e = document.createElement('label'); e.className = 'fld'; e.setAttribute('style', M);
    e.innerHTML = '<span>이메일 <b>(필수)</b></span><input name="email" type="email" placeholder="name@example.com" autocomplete="email"><small class="hint">휴대폰 확인을 마친 뒤 인증업체 1곳에 전달 · 확인 번호 메일은 메일 발송 수단을 갖춘 뒤</small>';
    lab.after(e); }
  const walk = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT); const hit = [];
  while (walk.nextNode()) { const t = walk.currentNode; if (/이름\\s*·\\s*휴대폰/.test(t.nodeValue)) hit.push(t); }
  hit.forEach(t => { const s = document.createElement('span'); s.innerHTML = t.nodeValue.replace(/(이름\\s*·\\s*휴대폰)/, '$1 · <mark style="' + M + '">이메일</mark>'); t.replaceWith(s); });
  return hit.length;
}"""

JS_LEAD = """(M) => {
  const m = document.querySelector('main') || document.body;
  const d = document.createElement('section'); d.setAttribute('style', M + ';margin:12px 0;padding:14px;border-radius:10px');
  d.innerHTML = `<b>연락처를 연 뒤 보이는 것</b> — 이름 · 휴대폰 · <mark style="${M}">이메일</mark>
   <div style="margin-top:6px;font-size:15px">홍○○ · 010-****-1234 · <mark style="${M}">h***@example.com</mark> <small class="hint">(연 때 · 연 사람이 조회 기록에 남음)</small></div>
   <p class="hint" style="margin:6px 0 0">열기 전 요약(업종 · 지역 · 상담 내용)에는 이메일이 없습니다. 배정받지 않은 업체는 볼 수 없습니다. 상담 종료 또는 6개월 · 전달 90일이 지나면 이메일도 지웁니다.</p>`;
  const __h=m.querySelector('h1'); const __at=__h?(__h.closest('.page-head')||__h):null; if(__at) __at.after(d); else m.insertBefore(d,m.firstChild);
}"""

JS_SETTLE = """(M) => {
  const m = document.querySelector('main') || document.body;
  m.querySelectorAll('.notice, .notice-act').forEach(e => e.style.opacity = .35);
  const d = document.createElement('section'); d.setAttribute('style', M + ';margin:12px 0;padding:16px;border-radius:10px');
  d.innerHTML = `<h2 style="margin:0 0 6px">소개비 받기 <small style="font-weight:400;color:#666">— 본인인증 회원도 받습니다(사업자 전환 필요 없음)</small></h2>
   <div class="rows"><div class="row"><div class="row-main">받을 계좌 <b>등록 전</b></div><div class="row-meta"><button class="cta-primary" type="button">계좌 등록 · 확인</button></div></div></div>
   <p class="hint">계좌는 <b>정산을 신청할 때</b> 확인합니다(본인 명의 계좌만 · 화면에는 뒤 4자리). 계좌 확인 연동 전에는 「확인 간주」로 표시됩니다.</p>
   <p class="hint">소개비는 거래 당사자가 직접 지급합니다 — 소개뱅크는 돈을 받아 두지 않습니다.</p>
   <p class="hint"><b>받으신 소개비는 소득세 신고 대상일 수 있습니다.</b> <span style="color:#999">(한 줄 안내 · 문구 확정 전)</span></p>
   <p class="hint" style="color:#a00">지금은 소개비 기능이 꺼져 있어 신청을 받지 않습니다 — 본인인증 · 계좌 확인 연동 뒤 운영자가 켭니다.</p>`;
  const __h=m.querySelector('h1'); const __at=__h?(__h.closest('.page-head')||__h):null; if(__at) __at.after(d); else m.insertBefore(d,m.firstChild);
}"""

JS_RECONSENT = """(M) => {
  const m = document.querySelector('main') || document.body;
  const d = document.createElement('section'); d.setAttribute('style', M + ';margin:12px 0;padding:16px;border-radius:10px');
  d.innerHTML = `<h2 style="margin:0 0 6px">약관이 바뀌었습니다 — 2026-11-11 시행</h2>
   <p style="margin:0 0 8px">약관이 발행되기 전에 가입하셨거나 약관이 새 판으로 바뀌었습니다. <b>계속 이용하시려면 필수 약관에 동의</b>해 주십시오(로그인 직후 한 번).</p>
   <table class="tbl" style="width:100%"><thead><tr><th>약관</th><th>구분</th><th>바뀐 점</th></tr></thead><tbody>
   <tr><td>이용약관</td><td>필수</td><td>만 19세 이상 개인 · 사업자 가입 · 확인 단계별 기능 표 · 본인인증 회원도 소개비 받기</td></tr>
   <tr><td>개인정보처리방침</td><td>필수</td><td>상담 신청 항목에 이메일 · 인증업체 1곳 제공 · 보관 6개월</td></tr>
   <tr><td>제3자 제공 동의</td><td>필수</td><td>「회원끼리」 · 상담 신청은 따로 동의</td></tr>
   <tr><td>구독 환불 정책</td><td>필수</td><td>「요청 · 상담 신청을 열람한 경우」</td></tr></tbody></table>
   <div style="margin-top:8px"><label><input type="checkbox"> 바뀐 필수 약관에 모두 동의합니다</label></div>
   <div style="display:flex;gap:8px;margin-top:8px"><button class="cta-primary" type="button">동의하고 계속</button><button class="btn-sm" type="button">로그아웃</button></div>
   <p class="hint">선택 약관(마케팅 · 맞춤형 광고 · 야간 광고)은 지금 상태를 그대로 두고, 「선택 항목 바꾸기」에서 바꿀 수 있습니다.</p>`;
  const __h=m.querySelector('h1'); const __at=__h?(__h.closest('.page-head')||__h):null; if(__at) __at.after(d); else m.insertBefore(d,m.firstChild);
}"""

# (번호, 이름, 시안, 지금(개발분 주소 · 계정), 제안 JS, 높이 한도)
#   시안: ('hlt', 주소) · ('main', 화면 키) · None
ITEMS = [
    ('01', '소개몰 메인 — 순위 · 많이 찾는 · 새로 올라온 · 특별 할인 (기준: 판매 수량 · 최근 7일 · 하루 1회 · 화면에 기준 · 기간)', ('hlt', '#/'), ('/health', 'buyer@x.com'), None, 2700),
    ('02', '상품 상세 — 리뷰 탭(별점 · 리뷰 수 · 리뷰 목록)', ('hlt', '#/p/p01', 'review'), ('/health/p/p01', 'buyer@x.com'), None, 2300),
    ('03', '상품 상세 — 문의 탭(운영자 답 · 쓴 사람이 비공개 선택)', ('hlt', '#/p/p01', 'qna'), ('/health/p/p01', 'buyer@x.com'), None, 2300),
    ('04', '내 주문 상세 — 「구매확정」 · 「리뷰쓰기」 단추 · 단계', ('hlt', f'#/my/orders/{P_ORDER}'), (f'/my/health/orders/{W_ORDER}', 'buyer@x.com'), None, 1900),
    ('05', '배송 조회 — 택배사 · 송장번호 · 단계', ('hlt', f'#/my/orders/{P_ORDER}/track'), (f'/my/health/orders/{W_ORDER}/ship', 'buyer@x.com'), None, 1700),
    ('06', '리뷰 쓰기 — 시안: 누르면 「리뷰 작성은 P2 범위입니다」 안내만 · 개발분: 없음 → 제안', ('hlt', '#/my/orders', 'reviewbtn'), (f'/my/health/orders/{W_ORDER}', 'buyer@x.com'), JS_REVIEW, 1700),
    ('07', '운영 화면 — 송장 입력 · 배송 단계 (시안 · 개발분 모두 없음 → 새 탭 제안)', ('main', 'admhst'), ('BO:소개몰 정산', 'admin@x.com'), JS_SHIP_ADMIN, 1500),
    ('08', '선택 약관 동의 바꾸기(G-214) — 지금: 바꿀 길 없음 → 제안', None, ('/terms/agree', 'buyer@x.com'), JS_G214, 1800),
    ('09', '상담 신청서 — 이메일 칸(필수) · 동의 문구에 이메일', ('main', 'malcsl'), ('/mal/consult/CSL_MEDICAL/apply', None), JS_CONSULT, 2000),
    ('10', '파트너센터 받은 상담 — 연락처를 연 뒤 이메일도 보임', None, ('/partner/leads', 'intro@x.com'), JS_LEAD, 1500),
    ('11', '정산(개인 회원 person@x.com) — 지금: 「사업자 전환하기」 → 제안: 본인인증 회원도 소개비 받기 · 계좌 확인 · 세금 한 줄', None, ('/my/settlement', 'person@x.com'), JS_SETTLE, 1300),
    ('12', '약관 발행 뒤 — 다음 로그인 때 재동의(새 화면) · 지금은 동의 화면만 있음', None, ('/terms/agree', 'person@x.com'), JS_RECONSENT, 1700),
]


def shoot():
    meta = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ── 시안 ──
        pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        pg.goto(PROTO + '#/health'); pg.wait_for_timeout(1400)
        pno = pg.evaluate("(window.__hlt.S.orders.filter(o=>o.status==='DELIVERED')[0]||{}).no")
        print('시안 배송 완료 주문', pno)
        for no, name, pr, wr, js, cap in ITEMS:
            if pr and pr[0] == 'hlt' and pno: pr = (pr[0], pr[1].replace(P_ORDER, pno)) + tuple(pr[2:])
            meta[no] = {'name': name}
            if not pr: continue
            if pr[0] == 'hlt':
                pg.goto(PROTO + '#/health'); pg.wait_for_timeout(1400); pg.evaluate(sm.CLEAN)
                pg.evaluate("(h) => window.__hltMall.go(h)", pr[1]); pg.wait_for_timeout(500)
                extra = pr[2] if len(pr) > 2 else None
                if extra in ('review', 'qna'):
                    pg.locator(f'#hltapp [data-tab="{extra}"]').first.click(); pg.wait_for_timeout(500)
                if extra == 'reviewbtn':
                    # 시안 견본에 구매확정 주문이 없으면 배송 완료 주문을 구매확정 → 「리뷰쓰기」를 누름(시안 안에서만 · 저장 없음)
                    if not pg.locator('#hltapp [data-review]').count() and pg.locator('#hltapp [data-confirm]').count():
                        pg.locator('#hltapp [data-confirm]').first.click(); pg.wait_for_timeout(600)
                        if pg.locator('#hlt-modal button, #hltapp .hlt-modal button', has_text='확정').count(): pg.locator('#hlt-modal button, #hltapp .hlt-modal button', has_text='확정').first.click(); pg.wait_for_timeout(500)
                    if pg.locator('#hltapp [data-review]').count(): pg.locator('#hltapp [data-review]').first.click(); pg.wait_for_timeout(300)
                h = pg.evaluate("(document.getElementById('hltroot')||document.body).scrollHeight")
                pg.set_viewport_size({'width': 1500, 'height': max(1000, min(h, 6000))}); pg.wait_for_timeout(200)
                pg.screenshot(path=f'{RAW}/p_{no}.png'); pg.set_viewport_size({'width': 1500, 'height': 1000})
                meta[no].update({'proto': pr[1] + (f' ({pr[2]})' if len(pr) > 2 else ''), 'proto_text': pg.evaluate("(document.querySelector('#hltapp main')||document.querySelector('#hltapp')||{innerText:''}).innerText")[:4000],
                                 'proto_toast': pg.evaluate("(document.getElementById('hlttoast')||{innerText:''}).innerText")})
            else:
                pg.goto(PROTO); pg.wait_for_timeout(1400); pg.evaluate(f"__VIEW.paint('{pr[1]}')"); pg.wait_for_timeout(600); pg.evaluate(sm.CLEAN)
                if pr[1] == 'malcsl':      # 업종 목록 → 「의료」 줄의 「상담 신청」 = 신청서
                    bt = pg.locator('#screen button, #screen a', has_text='상담 신청')
                    if bt.count(): bt.first.click(); pg.wait_for_timeout(700); pg.evaluate(sm.CLEAN)
                pg.screenshot(path=f'{RAW}/p_{no}.png', full_page=True)
                meta[no].update({'proto': pr[1], 'proto_text': pg.evaluate("(document.querySelector('#screen')||document.body).innerText")[:4000]})
        pg.close()
        # ── 개발분(지금) · 제안 ──
        ctxs = {}
        def page_for(who):
            if who not in ctxs:
                c = b.new_context(viewport={'width': 1500, 'height': 1000})
                ctxs[who] = (c, fl.site_login(c, who) if who else c.new_page())
            return ctxs[who][1]
        for no, name, pr, wr, js, cap in ITEMS:
            path, who = wr
            if path.startswith('BO:'):
                c = b.new_context(viewport={'width': 1500, 'height': 1000}); w = fl.bo_login(c, who); ok = fl.bo_tab(w, path[3:]); w.wait_for_timeout(800)
                st = 200 if ok else None
            else:
                w = page_for(who); r = w.goto(SITE + path, wait_until='networkidle'); w.wait_for_timeout(500); st = r.status if r else None
            w.screenshot(path=f'{RAW}/w_{no}.png', full_page=True)
            meta[no].update({'web': path, 'web_who': who, 'web_status': st, 'web_text': (w.inner_text('main') if w.locator('main').count() else w.inner_text('body'))[:4000]})
            if js:
                if no == '07':
                    rows = fl.rows("select o.order_no, coalesce((select p.name from hlt_order_items i join hlt_products p on p.id=i.product_id where i.order_id=o.id limit 1),'-'), to_char(o.paid_at at time zone 'Asia/Seoul','MM-DD HH24:MI'), case o.status when 'PAID' then '결제 완료' when 'SHIPPED' then '배송중' else '배송 완료' end, (select s.tracking_no from hlt_shipments s where s.order_id=o.id and s.tracking_no is not null limit 1) from hlt_orders o where o.status in ('PAID','SHIPPED','DELIVERED') order by (o.status='PAID') desc, o.created_at desc limit 5")
                    w.evaluate(js, [NEWBG, [list(r) for r in rows]])
                else:
                    meta[no]['inject'] = w.evaluate(js, NEWBG)
                w.wait_for_timeout(300); w.screenshot(path=f'{RAW}/n_{no}.png', full_page=True)
            if path.startswith('BO:'): c.close()
        for c, _ in ctxs.values(): c.close()
        b.close()
    json.dump(meta, open(f'{RAW}/meta.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    for no in sorted(meta):
        m = meta[no]; print(no, m['name'][:28], '| 시안', m.get('proto'), (m.get('proto_toast') or '')[:40], '| 지금', m.get('web'), m.get('web_status'), '| 덧그림', m.get('inject'))


def tile(no, name, pr, wr, js, cap):
    cols = []
    spec = []
    if pr: spec.append((f'{RAW}/p_{no}.png', '시안(기준)', s2.NEWC))
    spec.append((f'{RAW}/w_{no}.png', f'개발분(지금 · v10.27)  {re.sub(r"H[0-9]{6,}", "(주문번호)", wr[0].replace("BO:", "운영 화면 탭 「") + ("」" if wr[0].startswith("BO:") else ""))}' + (f' · {wr[1]}' if wr[1] else ''), s2.OLDC))
    if js: spec.append((f'{RAW}/n_{no}.png', '제안(v10.28 바꾼 뒤 · 노란 바탕 = 새로 생김 · 덧그린 그림)', '#8a6d00'))
    w = 1000 if len(spec) == 2 else 760
    for pth, lab, tone in spec:
        if os.path.exists(pth):
            im = Image.open(pth).convert('RGB'); im = im.crop((0, 0, im.size[0], min(im.size[1], cap)))
        else: im = Image.new('RGB', (1500, 260), '#f3f3f3')
        cols.append(s2.colim(im, lab, tone, w=w))
    body = s2.row_img(cols, gap=12); hd = s2.band(f'{int(no)}. {name}', body.size[0], tone='#222222', h=48, size=22)
    c = Image.new('RGB', (body.size[0], hd.size[1] + body.size[1]), '#8a8a8a'); c.paste(hd, (0, 0)); c.paste(body, (0, hd.size[1])); return c


def sheet():
    T = {it[0]: tile(*it) for it in ITEMS}
    def save(title, nos, out, scale=0.8):
        tiles = [T[n] for n in nos]; W = max(t.size[0] for t in tiles)
        rows = [s2.note([title, '시안(기준) · 개발분(지금 v10.27) · 제안(바꾼 뒤 — 지금 화면에 덧그림, 노란 바탕이 새로 생기는 것). 긴 화면은 위에서부터 한도까지만 붙였습니다. 실제 코드는 아직 바꾸지 않았습니다.'], W), *tiles]
        H = sum(r.size[1] for r in rows) + 10 * (len(rows) - 1); s = Image.new('RGB', (W, H), '#8a8a8a'); y = 0
        for r in rows: s.paste(r, (0, y)); y += r.size[1] + 10
        s = s.resize((int(W * scale), int(H * scale)), Image.LANCZOS); s.save(f'{OUT}/{out}', optimize=True); print(out, s.size, os.path.getsize(f'{OUT}/{out}') // 1024, 'KB')
    save('v10.28 반영 전 ① 소개몰 — 메인 순위 · 상품 상세 리뷰 · 문의', ['01', '02', '03'], 'v10.28_반영전_1_메인순위_리뷰_문의.png')
    save('v10.28 반영 전 ② 소개몰 — 주문 상세(구매확정) · 배송 조회 · 리뷰 쓰기', ['04', '05', '06'], 'v10.28_반영전_2_구매확정_배송조회_리뷰쓰기.png')
    save('v10.28 반영 전 ③ 운영 송장 입력 · 선택 약관 바꾸기(G-214)', ['07', '08'], 'v10.28_반영전_3_송장입력_동의바꾸기.png')
    save('v10.28 반영 전 ④ 상담 신청 이메일 · 파트너 연락처 · 개인 정산 · 재동의', ['09', '10', '11', '12'], 'v10.28_반영전_4_상담이메일_개인정산_재동의.png')


if __name__ == '__main__':
    {'shoot': shoot, 'sheet': sheet}[sys.argv[1]]()
