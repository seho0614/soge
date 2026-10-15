"""시안 v10.25 의 둘째 걸음 — 2026-10-08 확정분(apply_proto_v1025.py 가 부릅니다).

  ① 소개몰 안의 머리줄 · 바닥줄(본체 것)을 누르면 본체가 처리 — 이용안내 · 검색 · 회원가입 · 언어 · 약관 · 고객센터 … (전에는 소개몰의 「없는 주소입니다」)
  ② 개발분 값 3건 — 전화 1688-2887 · 상호/주소 표기 · 청약철회 제한 확정 문구
  ③ 남기기로 한 개발분 10건을 시안에도
       1 청약철회 제한 문구(카드 · 상세 · 장바구니 · 주문서 · 주문 완료 · 주문 상세)   2 「의약품이 아닙니다」 고지(상세 · 고민별 · 고민 상세 · 이용안내)
       3 판매자 정보 · 약관 전문(이용안내)   4 판매 금지 품목 안내(전체제품 → 이용안내)   5 품절 표시(카드의 안내 글)
       6 교환 · 개봉 여부 · 신청 마감일(반품 신청)   7 단계별 시각 · 발송 날짜(내 주문 · 주문 상세 · 배송 조회)
       8 배송 · 환불 기한 안내(이용안내)   9 내 주문 쪽 메뉴 줄(6화면)   10 도매 · 납품 매물 구역(메인)
"""
import json


def apply(s, terms_path):
    def rep(old, new, n=1):
        nonlocal s
        assert s.count(old) == n, (s.count(old), old[:100])
        s = s.replace(old, new)

    terms = open(terms_path, encoding='utf-8').read().strip()
    for w in ('제1조 (판매자)', '제9조 (분쟁)', '배송비는 받지 않습니다', '소개장터 · 안심소개 · 소개창업 회사는 중개만'):
        assert w in terms, w
    assert '3만원' not in terms and '건강몰' not in terms and '소개뱅크몰' not in terms

    # ══ ① 본체 쪽 ═══════════════════════════════════════════════════════════
    # 소개몰 안의 머리줄 장바구니는 소개몰이 맡습니다 — 「열고 나서 갈 곳」을 맡겨 두면 다음에 열 때 엉뚱하게 장바구니로 갑니다
    rep('''    if (hg) { window.__hltPending = hg.getAttribute("data-hltgo"); return; }''',
        '''    if (hg) {      /* v10.25 — 소개몰 안에서 누른 것은 소개몰이 이미 옮겼습니다(다시 그려 단추가 문서에서 떨어졌을 수 있어 이벤트 경로로 봅니다) */
      if (!(ev.composedPath && ev.composedPath().some(function(n){ return n && n.id === "hlthost"; }))) window.__hltPending = hg.getAttribute("data-hltgo");
      return; }''')
    rep('''    if(e.composedPath && e.composedPath().some(function(n){ return n && n.id==="hlthost"; })) return;
    var el, a;''', '''    if(e.composedPath && e.composedPath().some(function(n){ return n && n.id==="hlthost"; })){
      /* v10.25 — 소개몰 안이라도 두 관 전용 머리줄 · 바닥줄(본체 것)은 본체가 처리합니다 — 이용안내 · 검색 · 회원가입 · 언어 · 약관 · 고객센터 …
         전에는 소개몰이 제 주소로 알고 「없는 주소입니다」를 띄웠습니다. 장바구니(data-hltgo)는 소개몰이 맡습니다. */
      if(!(e.target.closest && e.target.closest("#hltapp header.b2-hd, #hltapp footer.b2-ft")) || e.target.closest("[data-hltgo]")) return;
      setTimeout(function(){ if(window.__hltx && window.__hltx.isOpen() && window.__hltMall && window.__hltMall.rehead) window.__hltMall.rehead(); }, 0);
    }
    var el, a;''')
    # 본체 알림은 소개몰 뒤에 가려 안 보입니다 — 소개몰이 열려 있으면 소개몰의 알림 칸에 띄웁니다(바닥줄의 「준비 중」 안내 등)
    rep('''  var tt; function toast(m){var e=$("#toast"); if(!e) return; e.textContent=m;e.classList.add("on");''',
        '''  var tt; function toast(m){
    var hh=document.getElementById("hlttoast");
    if(hh && window.__hltx && window.__hltx.isOpen && window.__hltx.isOpen()){      /* v10.25 */
      hh.innerHTML='<div class="hlt-toast" role="status"></div>'; hh.firstChild.textContent=m; var mine=hh.innerHTML;
      clearTimeout(tt); tt=setTimeout(function(){ if(hh.innerHTML===mine) hh.innerHTML=""; },3200); return; }
    var e=$("#toast"); if(!e) return; e.textContent=m;e.classList.add("on");''')

    # ══ ② 개발분 값 3건 ═══════════════════════════════════════════════════════
    rep('''    company:"주식회사 한국바이오헬스케어", ceo:"노명석",
    bizNo:"429-88-01533", ecom:"제2020-서울금천-1772호",
    addr:"서울 금천구 디지털로9길 65 307호", csTel:"02-0000-0000",
    shipFee:0, freeAt:0, returnFee:6000, exchangeFee:6000,
    returnAddr:"서울 금천구 디지털로9길 65 307호"''',
        '''    /* v10.25 — 임시 값을 개발분 값으로(10/8 확정): 상호 · 주소 · 전화 */
    company:"(주)한국바이오헬스케어 소개뱅크 사업부", ceo:"노명석",
    bizNo:"429-88-01533", ecom:"제2020-서울금천-1772호",
    addr:"서울 금천구 디지털로9길 65 (가산동, 백상스타타워1차) 307호", csTel:"1688-2887",
    shipFee:0, freeAt:0, returnFee:6000, exchangeFee:6000,
    returnAddr:"서울 금천구 디지털로9길 65 (가산동, 백상스타타워1차) 307호"''')
    rep('''zip:"08505", addr1:"서울 금천구 디지털로9길 65", addr2:"307호", def:true }''',
        '''zip:"08505", addr1:"서울 금천구 디지털로9길 65 (가산동, 백상스타타워1차)", addr2:"307호", def:true }''')
    # 쓰이지 않는 옛 바닥(본체를 못 부를 때만)도 같은 값으로
    rep('''    + '주식회사 한국바이오헬스케어 소개뱅크 사업부 · 대표 노명석<br>'
    + '서울 금천구 디지털로9길 65 307호 · 사업자등록번호 429-88-01533<br>\'''',
        '''    + '(주)한국바이오헬스케어 소개뱅크 사업부 · 대표 노명석<br>'
    + '서울 금천구 디지털로9길 65 (가산동, 백상스타타워1차) 307호 · 사업자등록번호 429-88-01533 · 1688-2887<br>\'''')

    # ══ ③ 자료 · 도우미 ═══════════════════════════════════════════════════════
    rep('''  S.orders.push({ no:"H20260908-000041", sellerId:"direct", at:d(7), deliveredAt:d(2),''',
        '''  S.orders.push({ no:"H20260908-000041", sellerId:"direct", at:d(7), paidAt:d(7), shippedAt:d(5), deliveredAt:d(2),''')
    rep('''  S.orders.push({ no:"H20260903-000018", sellerId:"hansol", at:d(12), deliveredAt:d(10),''',
        '''  S.orders.push({ no:"H20260903-000018", sellerId:"hansol", at:d(12), paidAt:d(12), shippedAt:d(11), deliveredAt:d(10),''')
    rep('''  S.orders.push({ no:"H20260914-000073", sellerId:"green", at:d(1), deliveredAt:null,''',
        '''  S.orders.push({ no:"H20260914-000073", sellerId:"green", at:d(1), paidAt:d(1), shippedAt:null, deliveredAt:null,''')
    rep('''      no:no, sellerId:o.sellerId, at:new Date(), deliveredAt:null,''',
        '''      no:no, sellerId:o.sellerId, at:new Date(), paidAt:new Date(), shippedAt:null, deliveredAt:null,''')
    rep('''  RETURN_REQUESTED:"반품 접수", ''', '''  RETURN_REQUESTED:"반품 접수", EXCHANGE_REQUESTED:"교환 접수", ''')
    rep('''const seller = function(id){ return SELLERS[id]; };''', '''const seller = function(id){ return SELLERS[id]; };
/* v10.25 — 청약철회 규칙. 개발분(withdrawal_rules)과 같은 값입니다 — 사시기 전에 아셔야 나중에 다투지 않습니다.
   화장품 갈래는 개발분에 아직 없어(v10.26 에서 정함) 일반 규칙으로 둡니다. */
const WD_RULE = {
  FOOD_SEALED:{ short:"개봉 시 청약철회 제한", blocked:"포장을 개봉했거나 밀봉이 훼손된 경우", law:"전자상거래법 17조 2항 2호" },
  GENERAL:{ short:"수령 후 7일 청약철회", blocked:"", law:"전자상거래법 17조 1항" }
};
const wdOf = function(p){ return WD_RULE[p && p.grp !== "COSMETIC" ? "FOOD_SEALED" : "GENERAL"]; };
const wdLine = function(it){
  const w = wdOf(prod(it.pid));
  return w.blocked ? '<div class="hlt-sm hlt-mut3" data-wdline="1">청약철회 제한: ' + esc(w.blocked) + '</div>' : '';
};
const NOT_DRUG = "건강기능식품은 질병의 예방이나 치료를 위한 의약품이 아닙니다. 복용 중인 약이 있으시면 의사나 약사와 상의하십시오.";
/* 날짜 + 시각 — 단계별 시각(주문 · 결제 · 발송 · 배송 완료)에 씁니다 */
const fmtDT = function(d){
  const x = new Date(d);
  return fmtDate(x) + " " + String(x.getHours()).padStart(2,"0") + ":" + String(x.getMinutes()).padStart(2,"0");
};
function notSoldHint(){
  return '<p class="hlt-sm hlt-mut3" style="margin-top:8px">의약품 · 의료 서비스 · 의료기기는 팔지 않습니다 — '
    + '<a href="#/guide" data-go="#/guide" data-notsold-link="1" style="text-decoration:underline">취급하지 않는 것</a></p>';
}''')

    # ══ 1 · 5 — 상품 카드: 청약철회 문구 · 품절 안내 ═══════════════════════════════
    rep('''    + won(p.minUnit) + '</b> 부터</div>'
    + '<div class="hlt-card-f">\'''', '''    + won(p.minUnit) + '</b> 부터</div>'
    + '<div class="hlt-sm hlt-mut3 hlt-wd" data-wd="1">' + esc(wdOf(p).short) + '</div>'
    + '<div class="hlt-card-f">\'''')
    rep('''    + (so ? '' : '<button type="button" class="hlt-cartic" data-cardadd="' + p.id + ':' + cheap.i''',
        '''    + (so ? '<span class="hlt-sm hlt-mut3" data-soldhint="1">품절 — 입고되면 다시 담으실 수 있습니다</span>'
          : '<button type="button" class="hlt-cartic" data-cardadd="' + p.id + ':' + cheap.i''')

    # ══ 1 · 2 — 상품 상세: 철회 제한 줄 · 「의약품이 아닙니다」 ═══════════════════════
    rep('''      + row("청약철회", "수령 후 " + RETURN_WINDOW_DAYS + "일 이내 (전자상거래법 제17조)")
      + '</table></div></div>'
      + '</div></div>\'''', '''      + row("청약철회", "수령 후 " + RETURN_WINDOW_DAYS + "일 이내 (전자상거래법 제17조)")
      + (wdOf(p).blocked ? row("철회 제한", wdOf(p).blocked) + row("근거", wdOf(p).law) : "")
      + '</table></div>'
      + '<p class="hlt-sm hlt-mut3" style="margin-top:8px">자세한 것은 <a href="#/guide" data-go="#/guide" style="text-decoration:underline">이용안내 · 청약철회</a></p></div>'
      + '</div></div>'
      + (p.grp !== "COSMETIC" ? '<div class="hlt-note" data-notdrug="1" style="margin-top:14px">' + NOT_DRUG + '</div>' : '')''')

    # ══ 1 — 장바구니 · 주문서 · 주문 완료 · 주문 상세 ═══════════════════════════════
    rep('''          + '<div class="hlt-sm hlt-mut">' + esc(it.opt) + '</div>'
          + (it.state === "OUT_OF_STOCK"''', '''          + '<div class="hlt-sm hlt-mut">' + esc(it.opt) + '</div>'
          + wdLine(it)
          + (it.state === "OUT_OF_STOCK"''')
    rep('''          + '<div class="hlt-sm hlt-mut">' + esc(it.opt) + ' · ' + it.qty + '개</div>'
          + '<div><b>' + won(it.price * it.qty) + '</b></div></div></div>';''', '''          + '<div class="hlt-sm hlt-mut">' + esc(it.opt) + ' · ' + it.qty + '개</div>'
          + wdLine(it)
          + '<div><b>' + won(it.price * it.qty) + '</b></div></div></div>';''')
    rep('''      + '<label for="agree1">[필수] 주문 내용을 확인했으며 구매에 동의합니다</label></div>\'''',
        '''      + '<label for="agree1">[필수] 주문 내용과 청약철회 조건을 확인했으며 구매에 동의합니다 '
      + '(<a href="#/guide" data-go="#/guide" style="text-decoration:underline">이용안내 · 청약철회</a>)</label></div>\'''')
    rep('''      + '<div class="hlt-btns" style="margin-top:16px">'
      + '<button type="button" class="hlt-btn pri" data-go="#/my/orders">주문 상세</button>\'''',
        '''      + '<div class="hlt-note" data-wd-done="1" style="margin-top:12px">받으신 날부터 <b>7일 안</b>이면 이유를 묻지 않고 청약철회하실 수 있습니다(전자상거래법 17조). '
      + '다만 식품은 개봉하면 반품이 어렵습니다 — 여시기 전에 확인해 주십시오.'
      + list.map(function(o){ return o.items.map(function(i){
          const w = wdOf(prod(i.pid));
          return w.blocked ? '<br>· ' + esc(i.name) + ': ' + esc(w.blocked) + ' 철회가 제한됩니다.' : ''; }).join(""); }).join("")
      + '</div>'
      + '<div class="hlt-btns" style="margin-top:16px">'
      + '<button type="button" class="hlt-btn pri" data-go="' + (list.length === 1 ? "#/my/orders/" + list[0].no : "#/my/orders") + '">주문 상세</button>\'''')
    rep('''            + '<span class="hlt-sm hlt-mut">' + esc(i.opt) + ' · ' + i.qty + '개</span>'
            + '<b>' + won(i.price * i.qty) + '</b></div></div>';
        }).join("") + '</div>\'''', '''            + '<span class="hlt-sm hlt-mut">' + esc(i.opt) + ' · ' + i.qty + '개</span>'
            + '<span class="hlt-sm hlt-mut3">청약철회 ' + RETURN_WINDOW_DAYS + '일 · ' + esc(wdOf(prod(i.pid)).short) + '</span>'
            + '<b>' + won(i.price * i.qty) + '</b></div></div>';
        }).join("") + '</div>\'''')

    # ══ 4 — 전체제품: 팔지 않는 품목 안내로 가는 길 ═══════════════════════════════
    rep('''      + catBar(code)
      + '<p class="hlt-sm hlt-mut" style="margin:10px 0">전체 ' + list.length + '개</p>\'''', '''      + catBar(code)
      + notSoldHint()
      + '<p class="hlt-sm hlt-mut" style="margin:10px 0">전체 ' + list.length + '개</p>\'''')

    # ══ 2 — 고민별 · 고민 상세 ═════════════════════════════════════════════════
    rep('''      + '고민 이름과 설명은 그 자체가 광고 문구로 읽히므로 자동 사전검사 대상입니다 (INV-H4).</div>';''',
        '''      + '고민 이름과 설명은 그 자체가 광고 문구로 읽히므로 자동 사전검사 대상입니다 (INV-H4).</div>'
      + '<div class="hlt-note" data-notdrug="1" style="margin-top:12px">고민별 분류는 이 고민으로 <b>많이 찾는 성분</b>을 모은 것입니다. '
      + '건강기능식품은 질병의 예방이나 치료를 위한 의약품이 아니며, 표시된 기능성은 식품의약품안전처가 인정한 범위입니다.</div>';''')
    rep('''                     : empty("📦", "이 고민에 연결된 상품이 아직 없습니다.", "고민별 보기", "#/concerns"));''',
        '''                     : empty("📦", "이 고민에 연결된 상품이 아직 없습니다.", "고민별 보기", "#/concerns"))
      + '<div class="hlt-note" data-notdrug="1" style="margin-top:16px">' + NOT_DRUG + '</div>';''')

    # ══ 7 — 내 주문 · 주문 상세 · 배송 조회: 날짜 · 시각 ══════════════════════════════
    rep('''            + '<b>' + won(o.total) + '</b></div></div>'
            + '<div class="hlt-btns">' + orderButtons(o) + '</div></div>';''', '''            + '<b>' + won(o.total) + '</b></div></div>'
            + (o.shippedAt ? '<p class="hlt-sm hlt-mut3" data-dates="1" style="margin:0 0 9px">발송 ' + fmtDate(o.shippedAt)
                + (o.deliveredAt ? ' · 배송 완료 ' + fmtDate(o.deliveredAt) : '') + '</p>' : '')
            + '<div class="hlt-btns">' + orderButtons(o) + '</div></div>';''')
    rep('''          return '<span' + (i <= cur ? ' class="on"' : '') + '>' + (i ? "→ " : "") + l + '</span>';
        }).join("") + '</div></div>\'''', '''          return '<span' + (i <= cur ? ' class="on"' : '') + '>' + (i ? "→ " : "") + l + '</span>';
        }).join("") + '</div>'
      + '<div class="hlt-scroll"><table class="hlt-tbl" data-times="1" style="margin-top:10px">'
      + row("주문", fmtDT(o.at)) + row("결제", o.paidAt ? fmtDT(o.paidAt) : "결제 전")
      + row("발송", o.shippedAt ? fmtDT(o.shippedAt) : "-") + row("배송 완료", o.deliveredAt ? fmtDT(o.deliveredAt) : "-")
      + '</table></div></div>\'''')
    rep('''    const tl = [
      ["집화 처리", true], ["간선 상차", true], ["간선 하차", true],
      ["배송 출발", true], ["배송 완료", done]
    ];''', '''    const tl = [
      ["집화 처리", true, o.shippedAt], ["간선 상차", true], ["간선 하차", true],
      ["배송 출발", true], ["배송 완료", done, done ? o.deliveredAt : null]
    ];''')
    rep('''      + row("송장번호", "4188-2201-" + no.slice(-4))
      + row("상태", ORDER_LABEL[o.status]) + '</table></div>\'''', '''      + row("송장번호", "4188-2201-" + no.slice(-4))
      + row("발송", o.shippedAt ? fmtDT(o.shippedAt) : "발송 전")
      + row("상태", ORDER_LABEL[o.status]) + '</table></div>\'''')
    rep('''            + (t[1] ? '' : ' <span class="hlt-mut3">예정</span>') + '</li>';''',
        '''            + (t[1] ? (t[2] ? ' <span class="hlt-mut3">' + fmtDT(t[2]) + '</span>' : '') : ' <span class="hlt-mut3">예정</span>') + '</li>';''')

    # ══ 6 — 반품 신청: 신청 종류(반품 · 교환) · 개봉 여부 · 신청 마감일 ═══════════════════
    rep('''      return { ok:true, type:"RETURN",
        note:"수령 후 " + Math.floor(d) + "일 지났습니다. 반품 가능 기간은 "
             + RETURN_WINDOW_DAYS + "일입니다." };''', '''      return { ok:true, type:"RETURN",
        note:"수령 후 " + Math.floor(d) + "일 지났습니다. 반품 가능 기간은 "
             + RETURN_WINDOW_DAYS + "일입니다. (신청 마감 "
             + fmtDate(new Date(new Date(o.deliveredAt).getTime() + RETURN_WINDOW_DAYS * 86400000 - 1)) + ")" };''')
    rep('''    const s = seller(o.sellerId);
    return '<div class="hlt-crumb">내 주문 › ' + esc(no) + ' › 취소·반품</div>'
      + '<h1>' + (j.type === "CANCEL" ? "주문 취소" : "반품 신청") + '</h1>\'''', '''    const s = seller(o.sellerId);
    /* v10.25 — 발송 뒤에는 반품과 교환 가운데 고릅니다 · 포장을 여셨는지도 받습니다(참고용 — 판단은 반송된 상품을 보고 합니다) */
    const SC = SCREENS["SB-HLT-RTN-010"];
    const kind = j.type === "CANCEL" ? "CANCEL" : (SC.kind || "RETURN");
    const chips = function(attr, cur, list, label){
      return '<div class="hlt-catstrip" role="radiogroup" aria-label="' + label + '" style="margin-top:9px">'
        + list.map(function(k){
            return '<button type="button" role="radio" aria-checked="' + (cur === k[0] ? "true" : "false") + '" class="hlt-catchip'
              + (cur === k[0] ? ' on' : '') + '" ' + attr + '="' + k[0] + '">' + k[1] + '</button>'; }).join("") + '</div>';
    };
    return '<div class="hlt-crumb">내 주문 › ' + esc(no) + ' › 취소·반품</div>'
      + '<h1>' + ({ CANCEL:"주문 취소", RETURN:"반품 신청", EXCHANGE:"교환 신청" })[kind] + '</h1>\'''')
    rep('''      + (j.note ? '<div class="hlt-note" style="margin-bottom:12px">' + esc(j.note) + '</div>' : '')

      /* ① 항목·수량 */''', '''      + (j.note ? '<div class="hlt-note" style="margin-bottom:12px">' + esc(j.note) + '</div>' : '')
      + (j.type === "RETURN"
          ? '<div class="hlt-box"><h3>신청 종류</h3>' + chips("data-rkind", kind, [["RETURN","반품"],["EXCHANGE","교환"]], "신청 종류") + '</div>' : '')

      /* ① 항목·수량 */''')
    rep('''      + '<p class="hlt-sm hlt-mut3">귀책은 사유가 정합니다 — 사용자가 고르지 않습니다.</p></div>'

      /* ③ 환불 예상 — 서버 계산값 */
      + '<div class="hlt-box"><h3>③ 환불 예상</h3><div id="rCalc"></div>\'''', '''      + '<p class="hlt-sm hlt-mut3">귀책은 사유가 정합니다 — 사용자가 고르지 않습니다.</p></div>'
      + (j.type === "RETURN"
          ? '<div class="hlt-box"><h3>포장을 여셨나요?</h3>'
            + chips("data-ropen", SC.opened, [["0","열지 않았습니다"],["1","열었습니다"]], "개봉 여부")
            + '<p class="hlt-sm hlt-mut3" id="rOpenHint" style="margin-top:8px"></p></div>' : '')

      /* ③ 환불 예상 — 서버 계산값 */
      + '<div class="hlt-box"><h3>' + (kind === "EXCHANGE" ? "③ 교환 비용" : "③ 환불 예상") + '</h3><div id="rCalc"></div>\'''')
    rep('''          : '<div class="hlt-note warn">반품은 수거 후 검수를 거쳐 환불됩니다. '
            + '반품 주소: ' + esc(s.returnAddr) + '</div>')

      + '<button type="button" class="hlt-btn lg pri" id="btnReturn" style="margin-top:14px">'
      + (j.type === "CANCEL" ? "취소 접수" : "반품 접수") + '</button>';''', '''          : '<div class="hlt-note warn">' + (kind === "EXCHANGE" ? '교환은 수거 후 검수를 거쳐 같은 상품을 다시 보내 드립니다. ' : '반품은 수거 후 검수를 거쳐 환불됩니다. ')
            + '반품 주소: ' + esc(s.returnAddr) + '</div>')

      + '<button type="button" class="hlt-btn lg pri" id="btnReturn" style="margin-top:14px">'
      + ({ CANCEL:"취소 접수", RETURN:"반품 접수", EXCHANGE:"교환 접수" })[kind] + '</button>'
      + '<p class="hlt-sm hlt-mut3" style="margin-top:8px">접수 후 3영업일 안에 결과를 알려 드립니다. 환불은 반품 상품을 받은 날부터 영업일 3일 안에 합니다.</p>';''')
    # 환불 예상 — 교환은 환불이 없습니다 · 개봉 여부의 안내 글
    rep('''  const code = (document.getElementById("rReason") || {}).value || "CHANGE_MIND";
  const c = refundCalc(o, code);
  box.innerHTML = sum("결제 금액", won(o.total))''', '''  const code = (document.getElementById("rReason") || {}).value || "CHANGE_MIND";
  const c = refundCalc(o, code);
  const SC = SCREENS["SB-HLT-RTN-010"], hint = document.getElementById("rOpenHint");
  if (hint) hint.textContent = SC.opened === "1"
    ? (c.party === "SELLER" ? "상품이 상했거나 다른 것이 왔으면 여셨더라도 돌려받으실 수 있습니다."
                            : "식품 · 건강기능식품은 포장을 여시면 청약철회가 제한될 수 있습니다. 여신 상품은 다시 팔 수 없어 재고로 돌리지 않습니다.")
    : "알려 주시면 빠르게 처리됩니다. 최종 판단은 반송된 상품을 확인한 뒤 저희가 합니다.";
  if (c.type === "RETURN" && SC.kind === "EXCHANGE") {
    const xf = c.party === "SELLER" ? 0 : seller(o.sellerId).exchangeFee;
    box.innerHTML = sum("교환 배송비 (왕복)", won(xf), true)
      + '<div class="hlt-note ' + (c.party === "SELLER" ? '' : 'warn') + '" style="margin-top:10px">교환은 <b>환불 없이</b> 같은 상품을 다시 보내 드립니다. '
      + (c.party === "SELLER" ? '판매자 귀책이라 <b>비용이 들지 않습니다.</b>'
                              : '고객 귀책이라 <b>왕복 배송비 ' + won(xf) + '을 부담</b>하십니다.') + '</div>';
    return;
  }
  box.innerHTML = sum("결제 금액", won(o.total))''')
    rep('''  o.status = j.type === "CANCEL" ? "CANCELED" : "RETURN_REQUESTED";''',
        '''  const SC = SCREENS["SB-HLT-RTN-010"];
  const exch = j.type === "RETURN" && SC.kind === "EXCHANGE";
  const xfee = exch ? (c.party === "SELLER" ? 0 : seller(o.sellerId).exchangeFee) : c.fee;
  o.status = j.type === "CANCEL" ? "CANCELED" : (exch ? "EXCHANGE_REQUESTED" : "RETURN_REQUESTED");''')
    rep('''    type:j.type, typeLabel:(j.type === "CANCEL" ? "주문 취소" : "반품"),
    reasonLabel:c.label, party:c.party, fee:c.fee, refund:c.refund,''',
        '''    type:(exch ? "EXCHANGE" : j.type), typeLabel:(j.type === "CANCEL" ? "주문 취소" : (exch ? "교환" : "반품")),
    opened:(j.type === "CANCEL" ? null : SC.opened),
    reasonLabel:c.label, party:c.party, fee:xfee, refund:(exch ? 0 : c.refund),''')
    rep('''  toast(j.type === "CANCEL" ? "취소가 접수되었습니다 (판매자 승인 없이)" : "반품이 접수되었습니다");''',
        '''  toast(j.type === "CANCEL" ? "취소가 접수되었습니다 (판매자 승인 없이)" : (exch ? "교환이 접수되었습니다" : "반품이 접수되었습니다"));''')
    rep('''            + row("환불 예정액", won(r.refund))
            + '</table></div>\'''', '''            + (r.opened === "0" || r.opened === "1" ? row("개봉 여부", r.opened === "1" ? "열었습니다" : "열지 않았습니다") : "")
            + row("환불 예정액", r.type === "EXCHANGE" ? "없음 (교환)" : won(r.refund))
            + '</table></div>\'''')
    rep('''                  + ' · 환불 예정 ' + won(r.refund) + '</div>';''',
        '''                  + (r.type === "EXCHANGE" ? ' · 환불 없음(교환)' : ' · 환불 예정 ' + won(r.refund)) + '</div>';''')
    # 주문이 바뀌면 고른 것을 처음으로
    rep('''    SCREENS["SB-HLT-RTN-010"].orderNo = m ? decodeURIComponent(m[1]) : null;''',
        '''    SCREENS["SB-HLT-RTN-010"].orderNo = m ? decodeURIComponent(m[1]) : null;
    if (SCREENS["SB-HLT-RTN-010"]._for !== SCREENS["SB-HLT-RTN-010"].orderNo) {      /* v10.25 — 다른 주문이면 신청 종류 · 개봉 여부를 처음으로 */
      SCREENS["SB-HLT-RTN-010"]._for = SCREENS["SB-HLT-RTN-010"].orderNo;
      SCREENS["SB-HLT-RTN-010"].kind = "RETURN"; SCREENS["SB-HLT-RTN-010"].opened = null;
    }''')

    # ══ 9 — 내 주문 쪽 메뉴 줄 · 머리줄만 다시 그리기 ═══════════════════════════════
    rep('''/** 뒤로가기 — 이력 스택이 있으면 그것, 없으면 화면별 PARENT */''', '''/* v10.25 — 내 주문 쪽 6화면은 「← 뒤로」 대신 메뉴 줄(개발분과 같게 · 10/8 「남김」). 「나의공간」은 본체 화면입니다 */
const MY_SCREENS = ["SB-HLT-MYO-010","SB-HLT-MYO-020","SB-HLT-MYO-030","SB-HLT-RTN-010","SB-HLT-RTN-020","SB-HLT-ADR-010"];
function myNav(key){
  const on = (key === "SB-HLT-RTN-010" || key === "SB-HLT-RTN-020") ? "returns" : key === "SB-HLT-ADR-010" ? "addresses" : "orders";
  return '<nav class="hlt-mynav" aria-label="내 소개몰">'
    + '<a role="link" tabindex="0" data-go="my">나의공간</a>'
    + [["orders","내 주문","#/my/orders"],["returns","취소 · 반품 내역","#/my/returns"],["addresses","배송지 관리","#/my/addresses"]].map(function(t){
        return '<a role="link" tabindex="0" data-go="' + t[2] + '"' + (t[0] === on ? ' class="on" aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join("")
    + '<a role="link" tabindex="0" data-go="#/">소개몰 가기</a></nav>';
}
/* 반품 신청에서 신청 종류 · 개봉 여부를 바꿀 때 — 적어 둔 사유 · 수량을 지우지 않고 다시 그립니다 */
function rtnRedraw(){
  const a = document.getElementById("hltapp"), root = document.getElementById("hltroot");
  const keep = { reason:(a.querySelector("#rReason") || {}).value, text:(a.querySelector("#rText") || {}).value,
    items:[].map.call(a.querySelectorAll("[data-ritem]"), function(c){ return c.checked; }),
    qty:[].map.call(a.querySelectorAll("[data-rq]"), function(c){ return c.value; }) };
  const y = root.scrollTop;
  render();
  if (keep.reason && a.querySelector("#rReason")) a.querySelector("#rReason").value = keep.reason;
  if (a.querySelector("#rText")) a.querySelector("#rText").value = keep.text || "";
  [].forEach.call(a.querySelectorAll("[data-ritem]"), function(c, i){ if (i < keep.items.length) c.checked = keep.items[i]; });
  [].forEach.call(a.querySelectorAll("[data-rq]"), function(c, i){ if (i < keep.qty.length) c.value = keep.qty[i]; });
  root.scrollTop = y;
  updateRefund();
}

/** 뒤로가기 — 이력 스택이 있으면 그것, 없으면 화면별 PARENT */''')
    rep('''  repaint:function(){ try{ render(); }catch(_){} } };''', '''  repaint:function(){ try{ render(); }catch(_){} },
  /* v10.25 — 머리줄만 다시 그립니다(언어 고르기 · 로그인 상태). 화면을 통째로 다시 그리면 적던 글 · 동의 표시가 지워집니다 */
  rehead:function(){ try{
    const h = document.querySelector("#hltapp > [data-b2-tone] > header.b2-hd");
    if (h) h.parentNode.outerHTML = header();
  }catch(_){} } };''')

    # ══ 누르기 — 머리줄 · 바닥줄은 본체로 / 본체 화면 열쇠 / 반품 신청의 단추 ══════════════════
    rep('''  app.onclick = function(e){
    const t = e.target.closest("[data-cardadd],[data-go],[data-back],[data-tbd],[data-q],[data-addcart],[data-buynow],"''',
        '''  app.onclick = function(e){
    /* v10.25 — 두 관 전용 머리줄 · 바닥줄(본체 것). 장바구니만 소개몰이 맡고(소개몰의 장바구니로), 나머지는 본체의 처리기가 받습니다 */
    if (e.target.closest("header.b2-hd, footer.b2-ft")) {
      const hg = e.target.closest("[data-hltgo]");
      if (hg) { e.preventDefault(); location.hash = hg.getAttribute("data-hltgo").replace(/^#/, ""); }
      return;
    }
    const t = e.target.closest("[data-cardadd],[data-go],[data-back],[data-tbd],[data-q],[data-addcart],[data-buynow],[data-rkind],[data-ropen],"''')
    rep('''    const go = t.getAttribute("data-go");
    if (go) { location.hash = go.replace(/^#/, ""); return; }''', '''    const go = t.getAttribute("data-go");
    if (go) {
      /* v10.25 — 「#」으로 시작하지 않으면 본체의 화면 열쇠입니다(나의공간 · 전체 목록). 본체로 넘기면 주소가 바뀌어 소개몰이 닫힙니다 */
      if (go.charAt(0) !== "#") { if (window.__B2 && window.__B2.go) window.__B2.go(go); return; }
      location.hash = go.replace(/^#/, ""); return;
    }
    /* v10.25 — 반품 신청: 신청 종류 · 개봉 여부. 이미 고른 것을 다시 누르면 그렇다고 알려 줍니다(무반응이 아니게) */
    const rk = t.getAttribute("data-rkind"), ro = t.getAttribute("data-ropen");
    if (rk || ro) {
      const SC = SCREENS["SB-HLT-RTN-010"], lab = t.textContent.trim();
      if (rk) { if ((SC.kind || "RETURN") === rk) { toast("신청 종류는 이미 「" + lab + "」입니다"); return; } SC.kind = rk; }
      else { if (SC.opened === ro) { toast("이미 「" + lab + "」로 고르셨습니다"); return; } SC.opened = ro; }
      rtnRedraw(); return;
    }''')

    # ══ 10 — 메인: 도매 · 납품 매물 구역 ══════════════════════════════════════════
    rep('''function shopTo(code, list){ return code ? "#/i/" + code : (list || "#/ingredients"); }''',
        '''/* v10.25 — 도매 · 납품 매물(10/8 「남김」). 개발분의 시험용 매물 4건과 같은 값(견본)입니다 — [갈래, 제목, 희망 소개비]. 누르면 본체의 전체 목록으로 갑니다 */
var SHOP_WS = [["건강기능식품","홍삼 농축액 스틱 도매 · 건강기능식품 인정번호 제2019-15호",360000],["건강식품","국산 도라지청 납품 · 품목제조신고 제2024-8821호",240000],
               ["운동 · 재활 용품","재활용 실내 자전거 20대 도매",420000],["위생 · 방역 용품","손소독제 대용량 납품 · 의약외품 신고 완료",150000]];
function shopTo(code, list){ return code ? "#/i/" + code : (list || "#/ingredients"); }''')
    rep('''      + '<a class="go" role="link" tabindex="0" data-go="#/c/HLT_FOOD">특가 상품 보러가기 →</a></section>'
      + '</div>';''', '''      + '<a class="go" role="link" tabindex="0" data-go="#/c/HLT_FOOD">특가 상품 보러가기 →</a></section>'
      + '<section class="shop-sec" data-shop-wholesale="1">' + shopHead("도매 · 납품 매물", "사업자 사이의 건강 상품 거래를 소개합니다.", "lsth")
      + '<div class="shop-ws">' + SHOP_WS.map(function(x){
          return '<a class="shop-wsc" role="link" tabindex="0" data-go="lsth"><span class="cat">' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b><span class="fee">' + won(x[2]) + '</span></a>'; }).join("") + '</div>'
      + '<p class="shop-basis" data-ws-note="1">매물은 회원 사이의 거래입니다 — 소개뱅크는 통신판매중개자입니다. 여기 4건은 견본이고, 누르면 전체 목록으로 갑니다.</p></section>'
      + '</div>';''')

    # ══ 3 · 4 · 8 — 이용안내: 철회 제한(확정) · 환불/배송 기한 · 판매자 정보 · 약관 전문 ════════════
    i = s.index('SCREENS["SB-HLT-ETC-010"] = {'); j = s.index('/* ═══', i)
    guide = r'''/* v10.25 — 판매 약관(HLT_SALE 1.1) 전문. 개발 DB 의 지금 약관 글 그대로입니다(qa/hlt_sale_terms.md) */
const HLT_SALE_TERMS = __TERMS__;
SCREENS["SB-HLT-ETC-010"] = {
  path:"#/guide", parent:"#/", title:"이용안내 · 청약철회",
  render:function(){
    const s = SELLERS.direct;
    const locked = Object.keys(CAT_OF).filter(function(k){ return CAT_OF[k].phase > OPEN_PHASE; });
    return '<h1>이용안내 · 청약철회</h1>'
      + '<div class="hlt-box" style="margin-top:14px"><h3>소개몰은 어떤 곳입니까</h3>'
      + '<p class="hlt-sm" style="margin-top:8px">소개몰은 <b>본사 직판</b>과 <b>입점 판매</b>를 함께 운영합니다. '
      + '상품마다 판매자가 다르고, 판매자 유형에 따라 책임 주체가 다릅니다.</p>'
      + '<div class="hlt-scroll"><table class="hlt-tbl" style="margin-top:10px">'
      + '<tr><th>직판</th><td>(주)한국바이오헬스케어가 직접 판매합니다. 당사가 통신판매업자입니다.</td></tr>'
      + '<tr><th>공식 · 입점</th><td>판매자가 등록·판매하며 당사는 통신판매중개자입니다. '
      + '상품·거래에 대한 책임은 판매자에게 있습니다.</td></tr>'
      + '</table></div></div>'

      + '<div class="hlt-box"><h3>청약철회 (전자상거래법 제17조)</h3>'
      + '<div class="hlt-scroll"><table class="hlt-tbl" style="margin-top:8px">'
      + row("기간", "상품을 받으신 날부터 " + RETURN_WINDOW_DAYS + "일 이내 — 이유를 묻지 않습니다")
      + row("발송 전 취소", "판매자 승인 없이 바로 접수됩니다")
      + row("발송 후", "취소가 아니라 반품으로 진행됩니다")
      + row("단순 변심 · 잘못 주문", "왕복 배송비 6,000원을 환불 금액에서 뺍니다 (발송 전 취소는 비용 없음)")
      + row("파손 · 오배송 · 표시 상이", "비용이 들지 않습니다 — 여셨더라도 돌려받으실 수 있습니다")
      /* 10/8 확정 — 「회신 대기」였던 자리를 개발분의 확정 문구로 */
      + row("철회 제한", "개봉한 식품 · 건강기능식품, 사용 흔적이 있거나 위생상 재판매가 어려운 건강기기")
      + row("환불", "반품 상품을 받은 날부터 영업일 3일 안 (카드는 카드사 사정으로 더 걸릴 수 있습니다)")
      + '</table></div>'
      + '<div class="hlt-btns" style="margin-top:12px">'
      + '<button type="button" class="hlt-btn" data-go="#/my/returns/new">취소 · 반품 신청</button>'
      + '<button type="button" class="hlt-btn" data-go="#/my/orders">내 주문</button></div></div>'

      + '<div class="hlt-box" data-ship-guide="1"><h3>배송</h3>'
      + '<p class="hlt-sm" style="margin-top:8px">결제 확인 후 영업일 2일 안에 보내 드립니다. <b>배송비는 받지 않습니다</b>(전 상품 무료).</p></div>'

      + '<div class="hlt-box" data-notsold="1"><h3>취급하지 않는 것</h3>'
      + '<div class="hlt-scroll"><table class="hlt-tbl" style="margin-top:8px">'
      + row("의약품", "약사법 제44조 — 약국 개설자가 아니면 판매할 수 없습니다")
      + row("의료기기", "의료기기법 제24조 — 광고 사전심의 대상. 현재 판매하지 않습니다")
      + row("의료 서비스", "의료법 제27조 — 환자 유인·알선 금지")
      + '</table></div>'
      + locked.map(function(k){
          return '<p class="hlt-sm hlt-mut3" style="margin-top:8px">🔒 ' + esc(CAT_OF[k].name) + '은(는) 준비 중입니다. ' + CAT_OF[k].phase + '단계에 엽니다.</p>'; }).join("")
      + '</div>'

      + '<div class="hlt-box"><h3>표시 · 광고</h3>'
      + '<p class="hlt-sm" style="margin-top:8px">건강기능식품은 질병의 예방이나 치료를 위한 <b>의약품이 아니며</b>, '
      + '표시된 기능성은 식품의약품안전처가 인정한 범위입니다.<br>'
      + '건강기능식품의 기능성 문구는 <b>사전심의를 받은 문구만</b> 노출됩니다. 심의받은 문구와 한 글자라도 다르면 저장되지 않습니다.<br>'
      + '"완치 · 치료 · 암 예방 · 부작용 없음 · 의사 추천" 같은 표현은 식품표시광고법 제8조 위반이라 '
      + '등록 자체가 막힙니다.</p></div>'

      + '<div class="hlt-box" data-seller-block="1"><h3>판매자 정보</h3>'
      + '<div class="hlt-scroll"><table class="hlt-tbl" style="margin-top:8px">'
      + row("상호", s.company) + row("대표자", s.ceo) + row("사업자등록번호", s.bizNo)
      + row("통신판매업 신고번호", s.ecom || "—") + row("사업장 주소", s.addr) + row("연락처", s.csTel)
      + '</table></div>'
      + '<div class="hlt-legal" style="margin-top:10px">' + noticeText(s) + '</div></div>'

      + '<div class="hlt-box" data-terms="HLT_SALE"><h3>판매 약관 전문</h3>'
      + '<p class="hlt-sm hlt-mut3" style="margin-top:6px">개발분에 게시 중인 판매 약관(HLT_SALE)과 같은 글입니다.</p>'      /* 버전 번호는 적지 않습니다 — 쓰던 DB 에서는 1.1(D024 가 새 버전으로 발행) · 새로 설치한 DB 에서는 1.0 이고 글은 같습니다 */
      + '<div class="hlt-terms">' + esc(HLT_SALE_TERMS) + '</div></div>';
  },
  mixed:function(){ return false; }
};

'''.replace('__TERMS__', json.dumps(terms, ensure_ascii=False))
    s = s[:i] + guide + s[j:]

    # ══ 모양 ═══════════════════════════════════════════════════════════════
    rep('''#hltroot .hlt-ci .th svg { display: block; border-radius: 8px; }
''', '''#hltroot .hlt-ci .th svg { display: block; border-radius: 8px; }
/* v10.25 둘째 걸음(10/8 확정) — 내 주문 쪽 메뉴 줄 · 카드의 청약철회 문구 · 약관 전문 · 도매/납품 매물 */
#hltroot .hlt-mynav { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 0 0 16px; padding: 0 0 10px; border-bottom: 1px solid var(--line, #e5e7eb); font-size: 14.5px; }
#hltroot .hlt-mynav a { cursor: pointer; font-weight: 600; opacity: .72; padding-bottom: 2px; }
#hltroot .hlt-mynav a.on { opacity: 1; color: var(--pri); box-shadow: 0 2px 0 var(--pri); }
#hltroot .hlt-wd { margin-top: 4px; }
#hltroot .hlt-terms { white-space: pre-wrap; word-break: keep-all; font-size: 13.5px; line-height: 1.75; margin-top: 10px; padding: 14px 16px; border: 1px solid var(--line, #e5e7eb); border-radius: 10px; }
#hltroot .shop-ws { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 0 10px; }
#hltroot .shop-wsc { display: flex; flex-direction: column; gap: 8px; min-height: 132px; padding: 16px; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; }
#hltroot .shop-wsc .cat { font-size: 12.5px; font-weight: 700; color: var(--shop-green); }
#hltroot .shop-wsc b { font-size: 15.5px; line-height: 1.4; color: #111; }
#hltroot .shop-wsc .fee { margin-top: auto; font-size: 15.5px; font-weight: 800; color: var(--shop-navy); }
@media (max-width: 900px) { #hltroot .shop-ws { grid-template-columns: 1fr 1fr; } }
@media (max-width: 520px) { #hltroot .shop-ws { grid-template-columns: 1fr; } }
''')

    # ══ 자가 점검(window.__hltcheck) — 지금의 틀(두 관 전용 머리줄 · 바닥줄)에 맞춤. 전에는 옛 머리줄(.hlt-hd)을 찾아 13항목 가운데 6항목이 늘 실패했습니다(G-167) ══
    i = s.index('window.__hltcheck = function(){'); j = s.index('/** 상품 상세 전용 — 법정 필수 4블록이 다 있는가 */', i)
    s = s[:i] + r"""window.__hltcheck = function(){
  const out = [];
  const ok = function(name, cond, detail){ out.push({ name:name, ok:!!cond, detail:detail || "" }); };
  const app = document.getElementById("hltapp");
  const main = app.querySelector("main");
  const key = main ? main.getAttribute("data-screen") : "(없음)";

  /* 머리줄 — v10.25 부터 두 관 전용 머리줄(소개광장과 같은 것 · 본체가 그립니다) */
  const hd = app.querySelector("header.b2-hd");
  ok("공통 머리줄 존재 (두 관 전용)", !!hd);
  ok("머리줄은 하나", app.querySelectorAll("header").length === 1, app.querySelectorAll("header").length + "개");
  const on = hd && hd.querySelector('.b2-nav a[aria-current="page"]');
  ok("지금 메뉴 표시 (aria-current = 소개몰)", !!on && on.textContent.trim() === "소개몰", on ? on.textContent.trim() : "");
  ok("머리줄에 장바구니 (소개몰의 장바구니로)", !!(hd && hd.querySelector('.b2-cart[data-hltgo="#/cart"]')));

  /* 역할 탭은 없어야 합니다 — 본문만 봅니다(바닥줄의 바로가기 「소개받기」는 본체의 것) */
  ok("역할 탭 없음 (소개 행위 없는 관)",
     !main || (main.textContent.indexOf("소개 합니다") < 0 && main.textContent.indexOf("소개받기") < 0));

  /* 바닥줄 */
  const ft = app.querySelector("footer.b2-ft");
  const ftText = [].map.call(app.querySelectorAll("footer"), function(f){ return f.textContent; }).join(" ");
  ok("공통 바닥줄 존재 (두 관 전용)", !!ft);
  ok("바닥 법정 고지 (사업자등록번호 한 번)", (ftText.match(/429-88-01533/g) || []).length === 1);
  ok("바닥 고지 두 가지 (직판 · 통신판매중개자)", !!(ft && ft.querySelector('[data-notice="direct"]') && ft.querySelector('[data-notice="inter"]')));
  ok("임시 값 없음 (빈칸 표기 · 임시 전화번호)", app.textContent.indexOf("[　") < 0 && app.textContent.indexOf("02-0000" + "-0000") < 0);

  /* 입력 이름 — v3.9 에서 21개 고친 규칙 */
  let noLabel = 0;
  [].forEach.call(app.querySelectorAll("input,select,textarea"), function(el){
    if (el.type === "hidden") return;
    const hasFor = el.id && app.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    const wrapped = el.closest("label");
    if (!hasFor && !wrapped && !el.getAttribute("aria-label")) noLabel++;
  });
  ok("이름 없는 입력 0개", noLabel === 0, noLabel + "개");

  /* 중복 id */
  const ids = {}; let dup = 0;
  [].forEach.call(app.querySelectorAll("[id]"), function(el){
    if (ids[el.id]) dup++; else ids[el.id] = 1;
  });
  ok("중복 id 0개", dup === 0, dup + "개");

  /* data-go 전수 대조 — 「#」으로 시작하면 소개몰의 주소, 아니면 본체의 화면 열쇠입니다. 없는 곳을 가리키면 "페이지 없음"이 뜹니다 */
  const dead = [];
  [].forEach.call(app.querySelectorAll("[data-go]"), function(el){
    const h = el.getAttribute("data-go");
    if (h.indexOf("#/gwan/") === 0) return;
    if (h.charAt(0) === "#") { if (!resolve(h)) dead.push(h); }
    else if (!(window.__VIEW && window.__VIEW.screens && window.__VIEW.screens[h])) dead.push(h);
  });
  ok("없는 링크 0개 (data-go 전수)", dead.length === 0, dead.join(", "));

  /* 클래스 충돌 — 본문은 hlt- · shop- 접두여야 합니다(머리줄 · 바닥줄은 본체의 것이라 보지 않습니다) */
  let badCls = 0; const badNames = {};
  [].forEach.call((main || app).querySelectorAll("[class]"), function(el){
    /* SVG 요소의 className 은 문자열이 아니라 SVGAnimatedString 입니다.
       그냥 String() 을 씌우면 "[object SVGAnimatedString]" 이 되어
       엉뚱한 위반으로 잡힙니다 — 실제로 한 번 걸렸습니다. */
    const cn = (el.className && el.className.baseVal !== undefined)
      ? el.className.baseVal : el.className;
    String(cn).split(/\s+/).forEach(function(c){
      if (!c) return;
      if (c.indexOf("hlt-") !== 0 && c.indexOf("shop-") !== 0 && ["shop","on","pri","sm","lg","danger","warn","tot","bad","tbd",
        "direct","brand","tenant","soldout","st","ok","done","cancel","off","now","was",
        "nm","th","bd","ic","lock","mut","bar","big","pr","basis",
        "cream","pale","sp","ph","spec","tag","go","sample","tx","ds","l","r","cat","fee",
        /* 검색 자동완성 칸은 본체의 것(.sug)을 일부러 같이 씁니다 */ "sug","hltsug","sgq","si2","st3","sk"].indexOf(c) < 0) { badCls++; badNames[c] = 1; }
    });
  });
  ok("클래스 접두 규칙 (본문은 hlt- · shop-)", badCls === 0, badCls ? badCls + "개: " + Object.keys(badNames).slice(0, 8).join(" ") : "");

  /* 그림 설명 — 꾸밈 그림은 alt="" + 읽지 않게(aria-hidden) 둡니다. alt 속성 자체가 없으면 위반 */
  let noAlt = 0;
  [].forEach.call(app.querySelectorAll("img"), function(im){
    if (!im.hasAttribute("alt") || (!im.alt && !im.closest('[aria-hidden="true"]'))) noAlt++;
  });
  ok("설명 없는 그림 0개", noAlt === 0, noAlt + "개");

  return { screen:key, items:out };
};

""" + s[j:]

    for w in ('02-0000-0000', '디지털로9길 65 307호', '법무 H-6 회신 대기'):
        assert w not in s, w
    return s
