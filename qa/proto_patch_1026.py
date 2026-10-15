"""v10.26 시안 고침 — spec/proto.html 을 v10.25 에서 v10.26 으로 (10/8 확인 「추천한 형태로 · 디자인은 깨지 말 것」).

  python3 proto_patch_1026.py      앞 판(SGB_Prototype_v10_25.html)에서 읽어 spec/proto.html 에 씁니다 — 몇 번을 돌려도 같은 결과(고칠 자리가 하나씩 꼭 맞아야 합니다)
고치는 곳(비교표 5절):
  1 자동완성 — PRD → PRODUCTS · 살 수 있는 것만 · 고르면 바로 검색        2 상품 그림의 「건강기능식품」 「GMP」 글자 뺌
  3 「한 달 N원 부터」 = 살 수 있는(재고 있는) 옵션만                      4 p12 → 건강식품 · 화장품 견본 p17(단품) 새로
  5 반품 신청의 품목 체크 칸 · 수량 칸 뺌                                 6 「개월 수가 길수록 …」 → 「개월 수에 따라 월 단가가 다릅니다」
  7 견본 주문 품목 이름 = 상품 이름                                       8 교환 비용 — 접수 때 결제(시험 결제)
  9 운영 화면 「소개몰 상품」(proto_patch_1026_admin.py)
"""
import re, sys
import os
P = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'
BASE = os.environ.get('BASE', '/mnt/user-data/outputs/SGB_Prototype_v10_25.html')
s = open(BASE, encoding='utf-8').read()
def rep(old, new, n=1):
    global s
    c = s.count(old)
    if c != n: sys.exit(f'자리 수가 다릅니다({c} ≠ {n}): {old[:90]!r}')
    s = s.replace(old, new)

# ── 4 p12 → 건강식품 · p17 ──
rep('''  { id:"p12", ing:"COLLA", amt:"1,500mg", seller:"green", cat:"HLT_COSMETIC",''',
    '''  /* v10.26 — 먹는 분말이라 건강식품으로 옮김(10/8 A-4). 화장품 견본은 아래 p17 */
  { id:"p12", ing:"COLLA", amt:"1,500mg", seller:"green", cat:"HLT_FOOD",''')
rep('''    caution:"의약품을 복용 중이거나 임신·수유 중이면 전문가와 상담하십시오.",
    tags:["FATIGUE","IMMUNE"] }
];''', '''    caution:"의약품을 복용 중이거나 임신·수유 중이면 전문가와 상담하십시오.",
    tags:["FATIGUE","IMMUNE"] },

  /* v10.26 — 화장품 견본(바르는 제품 · 10/8 A-4). 시안에 없던 견본이라 이름 · 값을 지어 넣었고 한 줄 설명에 「견본 상품」이라고 적었습니다.
     옵션은 개월 수가 없는 「단품」 하나 — 한 달 단가를 보이지 않습니다. 후기 · 문의 예시도 두지 않습니다(rev 0) */
  { id:"p17", ing:"COLLA", amt:"50ml", seller:"direct", cat:"HLT_COSMETIC",
    name:"데일리 콜라겐 수분 크림 50ml", sum:"견본 상품 · 바르는 보습 크림 · 무향",
    list:24000, opt:[[null,18000,40,""]],
    rate:0, rev:0, photo:0, badge:"", form:"BOTTLE",
    caution:"상처가 있는 부위에는 바르지 마십시오. 사용 중 붉은 반점 · 가려움 등 이상이 있으면 사용을 멈추십시오.",
    tags:["SKIN"] }
];''')

# ── 3 옵션 정규화 · 한 달 단가(살 수 있는 옵션만) · 단품 ──
rep('''  p.options = p.opt.map(function(o, i){
    const months = o[0], pay = o[1];
    const unit = Math.round(pay / months);
    STOCK[p.id + ":" + i] = o[2];
    return {
      i:i, months:months, pay:pay, unit:unit, tail:o[3],
      label:"월 " + unit.toLocaleString("ko-KR") + "원 × " + months + "개월 분 : "
             + p.name + (o[3] ? " " + o[3] : "")
    };
  });
  /* 카드에 뜨는 "한 달 N원 부터" = 옵션 월 단가의 최솟값 */
  p.minUnit = Math.min.apply(null, p.options.map(function(o){ return o.unit; }));''',
'''  p.options = p.opt.map(function(o, i){
    const months = o[0], pay = o[1];
    /* v10.26 — 개월 수가 없는 옵션(「단품」 · 화장품 등)은 한 달 단가가 없습니다 */
    const unit = months ? Math.round(pay / months) : null;
    STOCK[p.id + ":" + i] = o[2];
    return {
      i:i, months:months, pay:pay, unit:unit, tail:o[3],
      label:months
        ? "월 " + unit.toLocaleString("ko-KR") + "원 × " + months + "개월 분 : " + p.name + (o[3] ? " " + o[3] : "")
        : p.name + (o[3] ? " " + o[3] : "")
    };
  });
  /* 카드에 뜨는 "한 달 N원 부터" = 옵션 월 단가의 최솟값 — 처음 값. 화면은 minUnitOf(p)(살 수 있는 옵션만)를 씁니다 */
  p.minUnit = minUnitOf(p);''')
rep('''/* ── 파생값 계산 ──────────────────────────────────────────── */''',
'''/* ── 파생값 계산 ──────────────────────────────────────────── */
/* v10.26 — 「한 달 N원 부터」는 **지금 살 수 있는 옵션**(재고 있음 · 개월 수 있음)만으로 셉니다(10/8 B-3).
   v10.25 는 품절 옵션도 넣어 p10 카드에 살 수 없는 값(2,900원)이 나왔습니다. 살 수 있는 옵션이 없으면 null(줄을 그리지 않음) */
function minUnitOf(p){
  const u = p.options.filter(function(o){ return o.unit != null && (STOCK[p.id + ":" + o.i] || 0) > 0; }).map(function(o){ return o.unit; });
  return u.length ? Math.min.apply(null, u) : null;
}''')
rep('''      opt:p.options[i % p.options.length].months + "개월 분",''', '''      opt:(p.options[i % p.options.length].months ? p.options[i % p.options.length].months + "개월 분" : "단품"),''')
rep('''PRODUCTS.forEach(function(p, pi){
  p.reviews = REVIEW_BODIES.map(function(r, i){''', '''PRODUCTS.forEach(function(p, pi){
  /* v10.26 — 후기 수가 0 인 견본(p17)에는 예시 후기 · 문의를 만들지 않습니다 */
  p.reviews = (p.rev ? REVIEW_BODIES : []).map(function(r, i){''')
rep('''  p.qna = QNA_BODIES.slice(0, 3 + (pi % 2)).map(function(q, i){''', '''  p.qna = (p.rev ? QNA_BODIES.slice(0, 3 + (pi % 2)) : []).map(function(q, i){''')
rep('''/** 성분별 최저 월 단가. 상품 0건이면 null — 숨기지 않고 "취급 준비 중"으로 표시합니다 */
const ingMinUnit = function(code){
  const list = byIng(code);
  if (!list.length) return null;
  return Math.min.apply(null, list.map(function(p){ return p.minUnit; }));
};''', '''/** 성분별 최저 월 단가. 상품 0건이면 null — 숨기지 않고 "취급 준비 중"으로 표시합니다
 *  v10.26 — 살 수 있는 옵션만(minUnitOf). 상품은 있는데 살 수 있는 옵션이 없으면 null */
const ingMinUnit = function(code){
  const u = byIng(code).map(minUnitOf).filter(function(x){ return x != null; });
  return u.length ? Math.min.apply(null, u) : null;
};''')
rep('''const optLabel = function(p, oi){
  const o = p.options[oi];
  return o.months + "개월 분" + (o.tail ? " " + o.tail : "");
};''', '''const optLabel = function(p, oi){
  const o = p.options[oi];
  return (o.months ? o.months + "개월 분" : "단품") + (o.tail ? " " + o.tail : "");      /* v10.26 — 개월 수 없는 옵션은 「단품」(개발분 fn_hlt_option_label 과 같음) */
};''')

# ── 2 그림의 글자 ──
rep('''  /* 인증 도안 자리 — 문구를 지어내지 않고 도안 두 개만 둡니다 */
  const seals = function(x, y, ink){
    return '<circle cx="' + (x + 5) + '" cy="' + (y + 6) + '" r="4.8" fill="none" stroke="' + ink + '" stroke-width="1" opacity=".5"/>'
      + '<text x="' + (x + 5) + '" y="' + (y + 7.4) + '" text-anchor="middle" font-size="3.8" font-weight="700" fill="' + ink
        + '" opacity=".62" textLength="7" lengthAdjust="spacingAndGlyphs">GMP</text>'
      + '<rect x="' + (x + 15) + '" y="' + (y + 1.8) + '" width="24" height="8.6" rx="2" fill="' + ink + '" opacity=".1"/>'
      + '<text x="' + (x + 27) + '" y="' + (y + 7.6) + '" text-anchor="middle" font-size="4.3" font-weight="700" fill="' + ink
        + '" opacity=".62" textLength="20" lengthAdjust="spacingAndGlyphs">건강기능식품</text>';
  };''', '''  /* 인증 도안 자리 — 문구를 지어내지 않고 도안 두 개만 둡니다
     v10.26 — 도안 안의 「GMP」 「건강기능식품」 글자를 뺐습니다(10/8 B-7). 건강식품 · 화장품에도 그려져 표시 · 광고 문제가 될 수 있었습니다 */
  const seals = function(x, y, ink){
    return '<circle cx="' + (x + 5) + '" cy="' + (y + 6) + '" r="4.8" fill="none" stroke="' + ink + '" stroke-width="1" opacity=".5"/>'
      + '<rect x="' + (x + 15) + '" y="' + (y + 1.8) + '" width="24" height="8.6" rx="2" fill="' + ink + '" opacity=".1"/>';
  };''')
rep('''      + '<rect x="32" y="30" width="48" height="8.5" fill="' + k.band + '"/>'
      + '<text x="56" y="36.2" text-anchor="middle" font-size="5" font-weight="700" fill="' + k.bandInk
        + '" textLength="30" lengthAdjust="spacingAndGlyphs">건강기능식품</text>'
''', '''      + '<rect x="32" y="30" width="48" height="8.5" fill="' + k.band + '"/>'      /* v10.26 — 띠 안의 「건강기능식품」 글자 뺌 */
''')

# ── 카드 「한 달 N원 부터」 ──
rep('''    + '<div class="hlt-unit" data-unit="1"><span class="hlt-k">한 달</span> <b>'
    + won(p.minUnit) + '</b> 부터</div>\'''' if False else '''    + '<div class="hlt-unit" data-unit="1"><span class="hlt-k">한 달</span> <b>'
    + won(p.minUnit) + '</b> 부터</div>'
''', '''    + (minUnitOf(p) != null ? '<div class="hlt-unit" data-unit="1"><span class="hlt-k">한 달</span> <b>'
    + won(minUnitOf(p)) + '</b> 부터</div>' : '')
''')

# ── 상품 상세 ──
rep('''      /* ★ 월 단가 */
      + '<div class="hlt-unit big" data-unit="1" style="margin-top:6px">최대 할인가 <b>한 달 '
      + won(p.minUnit) + '</b> (가장 긴 개월 수 옵션 기준)</div>'
      + '<div class="hlt-star" style="margin-top:6px">★ ' + p.rate + ' · 리뷰 '
      + p.rev.toLocaleString("ko-KR") + '건</div>\'''' if False else '''      /* ★ 월 단가 */
      + '<div class="hlt-unit big" data-unit="1" style="margin-top:6px">최대 할인가 <b>한 달 '
      + won(p.minUnit) + '</b> (가장 긴 개월 수 옵션 기준)</div>'
      + '<div class="hlt-star" style="margin-top:6px">★ ' + p.rate + ' · 리뷰 '
      + p.rev.toLocaleString("ko-KR") + '건</div>'
''', '''      /* ★ 월 단가 — v10.26 지금 살 수 있는 옵션 가운데서(품절 옵션 · 개월 수 없는 옵션 제외 · 10/8 B-3) */
      + (minUnitOf(p) != null && p.options.length > 1 ? '<div class="hlt-unit big" data-unit="1" style="margin-top:6px">최대 할인가 <b>한 달 '
      + won(minUnitOf(p)) + '</b> (지금 살 수 있는 옵션 기준)</div>' : '')
      + (p.rev ? '<div class="hlt-star" style="margin-top:6px">★ ' + p.rate + ' · 리뷰 '
      + p.rev.toLocaleString("ko-KR") + '건</div>' : '<div class="hlt-star" style="margin-top:6px">리뷰 0건</div>')
''')
rep('''      /* 옵션 = 복용 개월 수. 라벨 앞에 월 단가를 박습니다 */
      + '<div style="margin-top:16px"><h3>옵션 선택 <span class="hlt-sm hlt-mut3">(복용 개월 수)</span></h3>'
      + p.options.map(function(o){''', '''      /* 옵션 = 복용 개월 수. 라벨 앞에 월 단가를 박습니다
         v10.26 — 옵션이 하나뿐인 상품(단품 · 화장품 견본 p17)은 옵션 줄 없이 수량 칸과 남은 수량만(개발분과 같음) */
      + (p.options.length === 1
        ? '<div style="margin-top:16px" data-single="1"><span class="hlt-qty">'
          + '<button type="button" data-qm="0" aria-label="수량 줄이기">−</button>'
          + '<input type="number" id="q_' + p.id + '_0" value="1" min="1" max="' + Math.max(stockOf(p.id, 0), 1) + '" aria-label="' + esc(p.name) + ' 수량"'
          + (stockOf(p.id, 0) <= 0 ? ' disabled' : '') + '>'
          + '<button type="button" data-qp="0" aria-label="수량 늘리기">+</button></span> '
          + '<span class="hlt-sm hlt-mut3">' + (stockOf(p.id, 0) > 0 ? '남은 수량 ' + stockOf(p.id, 0) + '개' : '지금은 품절입니다') + '</span></div>'
        : '<div style="margin-top:16px"><h3>옵션 선택 <span class="hlt-sm hlt-mut3">(복용 개월 수)</span></h3>'
      + p.options.map(function(o){''')
# 6 안내 글
rep('''      + '<p class="hlt-sm hlt-mut3" style="margin-top:6px">개월 수가 길수록 월 단가가 내려갑니다. '
      + '라벨 앞의 월 단가로 바로 비교하십시오.</p></div>'
''', '''      + '<p class="hlt-sm hlt-mut3" style="margin-top:6px">개월 수에 따라 월 단가가 다릅니다. '      /* v10.26 — p06 · p13 은 두 옵션의 월 단가가 같아 「길수록 내려갑니다」가 맞지 않았습니다 */
      + '라벨 앞의 월 단가로 바로 비교하십시오.</p></div>')
''')
# 8 교환 배송비 줄
rep('''      + row("교환 배송비", won(s.exchangeFee))''', '''      + row("교환 배송비", "왕복 " + won(s.exchangeFee) + " (단순 변심 · 잘못 주문 시 신청 때 결제 · 하자 · 오배송은 무료)")      /* v10.26 — 10/8 A-1 */''')

# ── 성분 상세 — 월 단가는 살 수 있는 옵션만 ──
rep('''      return sort === "UNIT" ? a.minUnit - b.minUnit''', '''      const ua = minUnitOf(a), ub = minUnitOf(b);      /* v10.26 — 살 수 있는 옵션의 월 단가 · 없으면 뒤로 */
      return sort === "UNIT" ? (ua == null ? 1e9 : ua) - (ub == null ? 1e9 : ub)''')
rep('''      + (list.length
          ? '<div class="hlt-unit big" style="margin-top:8px">최저 <b>월 '
            + won(Math.min.apply(null, list.map(function(p){ return p.minUnit; })))
            + '</b> · 상품 ' + list.length + '개</div>'
          : '')''', '''      + (ingMinUnit(g.code) != null || (g.group && list.some(function(p){ return minUnitOf(p) != null; }))
          ? '<div class="hlt-unit big" style="margin-top:8px">최저 <b>월 '
            + won(Math.min.apply(null, list.map(minUnitOf).filter(function(x){ return x != null; })))
            + '</b> · 상품 ' + list.length + '개</div>'
          : '')''')

# ── 7 견본 주문 품목 이름 = 상품 이름 ──
rep('''name:"데일리 비타민C 3000", opt:"3개월 분" }''', '''name:"메가바이탈 비타민C 3000", opt:"3개월 분" }''')

# ── 5 반품 신청 — 품목 체크 칸 · 수량 칸 뺌(일부 반품은 넣지 않음 · 10/8 A-3) ──
rep('''      /* ① 항목·수량 */
      + '<div class="hlt-box"><h3>① 항목 선택</h3>'
      + o.items.map(function(i, idx){
          return '<div class="hlt-ci" style="padding-left:0">'
            + '<input type="checkbox" id="ri_' + idx + '" data-ritem="' + idx + '" checked '
            + 'style="margin-top:22px">'
            + '<div class="th">' + thIc(i) + '</div><div class="bd">'
            + '<label for="ri_' + idx + '"><b>' + esc(i.name) + '</b></label>'
            + '<span class="hlt-sm hlt-mut">' + esc(i.opt) + '</span>'
            + '<span class="hlt-qty"><button type="button" data-rm="' + idx + '" aria-label="수량 줄이기">−</button>'
            + '<input type="number" value="' + i.qty + '" min="1" max="' + i.qty + '" data-rq="' + idx
            + '" aria-label="' + esc(i.name) + ' 반품 수량">'
            + '<button type="button" data-rp="' + idx + '" aria-label="수량 늘리기">+</button></span>'
            + '</div></div>';
        }).join("") + '</div>'
''', '''      /* ① 항목 — v10.26 품목 체크 칸 · 수량 칸을 뺐습니다(10/8 A-3 · 일부 반품은 넣지 않음). 신청은 주문 전체입니다 */
      + '<div class="hlt-box"><h3>① 항목 선택 <span class="hlt-sm hlt-mut3">(주문 전체)</span></h3>'
      + o.items.map(function(i){
          return '<div class="hlt-ci" style="padding-left:0">'
            + '<div class="th">' + thIc(i) + '</div><div class="bd">'
            + '<b>' + esc(i.name) + '</b>'
            + '<span class="hlt-sm hlt-mut">' + esc(i.opt) + ' × ' + i.qty + '개</span>'
            + '</div></div>';
        }).join("") + '</div>'
''')

# ── 8 교환 비용 — 안내 · 접수 때 결제(시험 결제) ──
rep('''      + (c.party === "SELLER" ? '판매자 귀책이라 <b>비용이 들지 않습니다.</b>'
                              : '고객 귀책이라 <b>왕복 배송비 ' + won(xf) + '을 부담</b>하십니다.') + '</div>';''',
'''      + (c.party === "SELLER" ? '판매자 귀책이라 <b>비용이 들지 않습니다.</b>'
                              : '고객 귀책이라 <b>왕복 배송비 ' + won(xf) + '을 부담</b>하십니다 — 접수하신 뒤 바로 결제합니다. 반려되거나 판매자 귀책으로 판정되면 돌려드립니다.') + '</div>'
      /* v10.26 — 재고가 없을 때(판매 약관 · 10/8 답 「14일」) */
      + '<p class="hlt-sm hlt-mut3" style="margin-top:8px">교환할 상품이 다 팔렸으면 입고를 14일까지 기다린 뒤 반품으로 바꿔 드립니다(원하시면 바로 반품). 그때는 반품 배송비를 빼지 않고 전액 환불하며, 교환 배송비도 돌려드립니다.</p>';''')
rep('''    reasonLabel:c.label, party:c.party, fee:xfee, refund:(exch ? 0 : c.refund),
    status:(j.type === "CANCEL" ? "APPROVED" : "REQUESTED")
  });
  location.hash = "/my/returns";''', '''    reasonLabel:c.label, party:c.party, fee:xfee, refund:(exch ? 0 : c.refund),
    status:(j.type === "CANCEL" ? "APPROVED" : "REQUESTED"),
    /* v10.26 — 회원 사정 교환은 왕복 배송비를 접수 때 결제(10/8 A-1 ①). 결제 전 UNPAID → PAID · 판매자 사정이면 비용 없음 */
    feeState:(exch ? (xfee > 0 ? "UNPAID" : "NONE") : null)
  });
  location.hash = "/my/returns";
  if (exch && xfee > 0) { xfeeModal(S.returns[S.returns.length - 1].no); return; }''')
rep('''function submitReturn(){''', '''/* v10.26 — 교환 배송비 결제(시험 결제). 개발분은 POST /me/health/returns/{id}/fee/pay → /fee/confirm(키가 없으면 스텁) */
function xfeeModal(rno){
  const r = S.returns.filter(function(x){ return x.no === rno; })[0];
  if (!r) return;
  openModal("교환 배송비 결제",
    '<p style="margin:0">교환을 접수했습니다. <b>교환 배송비(왕복) ' + won(r.fee) + '</b>을 결제하시면 확인 뒤 처리합니다.</p>'
    + '<p class="hlt-sm hlt-mut3" style="margin-top:8px">반려되거나 판매자 귀책으로 판정되면 돌려드립니다. 결제수단은 카드 · 계좌이체입니다. '
    + '이 시안에서는 <b>시험 결제</b>입니다 — 실제 돈은 오가지 않습니다.</p>',
    '<button type="button" class="hlt-btn" data-mact="close">나중에</button>'
    + '<button type="button" class="hlt-btn pri" data-mact="payXfee" data-no="' + esc(rno) + '">' + won(r.fee) + ' 결제</button>');
}
function payXfee(rno){
  const r = S.returns.filter(function(x){ return x.no === rno; })[0];
  if (r) r.feeState = "PAID";
  closeModal(); toast("교환 배송비 결제가 승인되었습니다 (시험 결제)"); render();
}

function submitReturn(){''')
rep('''    else if (a === "confirmYes") doConfirm(b.getAttribute("data-no"));''', '''    else if (a === "confirmYes") doConfirm(b.getAttribute("data-no"));
    else if (a === "payXfee") payXfee(b.getAttribute("data-no"));      /* v10.26 */''')
# 내역 — 교환 배송비 줄 · 결제 단추
rep('''            + row("환불 예정액", r.type === "EXCHANGE" ? "없음 (교환)" : won(r.refund))
            + '</table></div>'
            + '<div class="hlt-btns" style="margin-top:9px">'
            + '<button type="button" class="hlt-btn sm" data-go="#/my/orders/' + r.orderNo
            + '">주문 상세</button></div></div>';''', '''            + row("환불 예정액", r.type === "EXCHANGE" ? "없음 (교환)" : won(r.refund))
            /* v10.26 — 교환 배송비(접수 때 결제) */
            + (r.type === "EXCHANGE" ? row("교환 배송비", r.fee > 0 ? won(r.fee) + " · " + ({ UNPAID:"결제 전 — 결제하셔야 교환을 처리합니다", PAID:"결제 완료", REFUNDED:"돌려드림" })[r.feeState || "UNPAID"] : "없음 (판매자 부담)") : "")
            + '</table></div>'
            + '<div class="hlt-btns" style="margin-top:9px">'
            + (r.type === "EXCHANGE" && r.feeState === "UNPAID" ? '<button type="button" class="hlt-btn sm pri" data-xfee="' + esc(r.no) + '">교환 배송비 결제</button>' : '')
            + '<button type="button" class="hlt-btn sm" data-go="#/my/orders/' + r.orderNo
            + '">주문 상세</button></div></div>';''')
rep('''    const t = e.target.closest("[data-cardadd],[data-go],[data-back],[data-tbd],[data-q],[data-addcart],[data-buynow],[data-rkind],[data-ropen],"''',
    '''    const t = e.target.closest("[data-cardadd],[data-go],[data-back],[data-tbd],[data-q],[data-addcart],[data-buynow],[data-rkind],[data-ropen],[data-xfee],"''')
rep('''    /* v10.25 — 반품 신청: 신청 종류 · 개봉 여부.''', '''    const xf = t.getAttribute("data-xfee");
    if (xf) { xfeeModal(xf); return; }      /* v10.26 — 내역의 「교환 배송비 결제」 */
    /* v10.25 — 반품 신청: 신청 종류 · 개봉 여부.''')

# ── 1 자동완성 — PRD → PRODUCTS · 살 수 있는 것만 · 고르면 바로 검색 ──
rep('''    function pool(){
      var out = [];
      try { ING.forEach(function(x){ out.push({t:x.name, k:"성분"}); }); } catch(e){}
      try { PRD.forEach(function(p){ out.push({t:p.name, k:"상품"}); }); } catch(e){}''', '''    /* v10.26 — 상품 이름이 제안되지 않던 것(없는 이름 PRD)을 PRODUCTS 로 · **살 수 있는 것만**
       (열린 갈래 · 품절 아님 · 그런 상품이 있는 성분) · 고르면 바로 검색합니다(10/8 B-11 — 개발분 GET /health/suggest 와 같음) */
    function pool(){
      var out = [], live = openProducts().filter(function(p){ return !soldOut(p); });
      try { ING.forEach(function(x){ if (!x.group && live.some(function(p){ return p.ing === x.code; })) out.push({t:x.name, k:"성분"}); }); } catch(e){}
      try { live.forEach(function(p){ out.push({t:p.name, k:"상품"}); }); } catch(e){}''')
rep('''      else if (ev.key === "Enter" && active >= 0){
        ev.preventDefault(); inp.value = cur[active].t; box.hidden = true;
        inp.dispatchEvent(new Event("change", {bubbles:true})); return;
      }''', '''      else if (ev.key === "Enter" && active >= 0){
        ev.preventDefault(); ev.stopPropagation(); inp.value = cur[active].t; box.hidden = true;
        location.hash = "/search?q=" + encodeURIComponent(inp.value); return;      /* v10.26 — 바로 검색 */
      }''')
rep('''          inp.value = li.getAttribute("data-hsug");
          li.parentNode.hidden = true;
          inp.dispatchEvent(new Event("change", {bubbles:true}));''', '''          inp.value = li.getAttribute("data-hsug");
          li.parentNode.hidden = true;
          location.hash = "/search?q=" + encodeURIComponent(inp.value);      /* v10.26 — 바로 검색 */''')

# 자동완성의 ↑ ↓ Enter 를 소개몰 본문의 Enter(친 글자로 검색)보다 먼저 받습니다 — 잡는 단계(capture)로
rep("""      else if (ev.key === "Escape"){ box.hidden = true; return; }
      else return;
      paint(box);
    });""", """      else if (ev.key === "Escape"){ box.hidden = true; return; }
      else return;
      paint(box);
    }, true);      /* v10.26 — 잡는 단계: 고른 제안으로 검색되게(본문의 Enter 처리보다 먼저) */""")

# ── 9 운영 화면 「소개몰 상품」(SB-ADM-HPR-010) — 시안에 없던 화면(10/8 「시안에도 같은 화면을 추가」 · 제안 그림 ⑤ · 개발분 운영 화면 탭 「소개몰 상품」) ──
ADM = r"""

/* ── 소개몰 상품 (SB-ADM-HPR-010) · v10.26 ─────────────────────────────
 * 상품 · 옵션(복용 개월 수) · 재고 · 그림 · 고시 · 주의사항 · 성분/고민 · 갈래를 운영이 넣고 고치는 화면.
 * v10.25 까지는 시안 · 개발분 모두 이 화면이 없어 상품이 시드로만 들어갔습니다(G-147).
 * 개발분: 운영 화면(web) 탭 「소개몰 상품」 — 하위 탭 상품(HPR-010) · 성분 · 고민(HPR-020) · 갈래 · 판매 범위(HPR-030).
 * 시안은 세 탭의 내용을 한 화면에 차례로 보입니다. 값은 시안의 견본 상품(소개몰 겹쳐 뜨는 틀의 PRODUCTS)과 같습니다.
 * ───────────────────────────────────────────────────────────────── */
function scAdmHpr(){
  return H({login:true, admin:true}) + '<div class="wrap">'
  + '<h1 class="pt">소개몰 상품</h1>'
  + '<p class="lead">상품 · 옵션(복용 개월 수) · 재고 · 그림 · 고시를 넣고 고칩니다. <b>본사 운영자만</b> 씁니다(입점 판매자용 화면은 v10.28).</p>'
  + note("info","<b>상품의 값 · 재고는 옵션에서 계산됩니다.</b> 대표 판매가 = 가장 짧은 개월 수 옵션의 결제 금액 · 재고 = 켠 옵션 재고의 합. "
      + "상품 줄의 값 · 재고를 직접 고치면 DB 가 막습니다 — 옵션을 고치십시오.")

  + '<h2 class="st2">상품 <span class="dim">(SB-ADM-HPR-010)</span></h2>'
  + table(["코드","상품","갈래","판매자","옵션","대표 판매가","재고","상태"],[
      ["p01","메가바이탈 비타민C 3000","건강식품","직판","3","14,700","111",'<span class="st ok">판매 중</span>'],
      ["p02","선데이 비타민D 2000","건강식품","입점","3","9,900","124",'<span class="st ok">판매 중</span>'],
      ["p10","양배추 매스틱 1000","건강식품","직판","2 <span class=\"dim\">(1개 품절)</span>","8,970","48",'<span class="st ok">판매 중</span>'],
      ["p13","굿나잇 멜라토닌 3","건강식품","입점","2","9,900","35",'<span class="st ok">판매 중</span>'],
      ["p15","멀티비타민 데일리팩","건강기능식품 🔒","입점","2","19,800","74",'<span class="st">판매 중지</span>'],
      ["p17","데일리 콜라겐 수분 크림 50ml","화장품","직판","단품","18,000","40",'<span class="st ok">판매 중</span>']
    ])
  + '<div class="hbtn" style="margin-top:10px"><button class="bp">+ 상품 등록</button></div>'
  + note("info","<b>새 상품은 초안으로 만들어집니다.</b> 판매 시작은 옵션이 하나 이상 있어야 합니다. 잠긴 갈래(건강기능식품)와 팔지 않는 갈래(의료기기)의 상품은 판매를 시작할 수 없습니다.")

  + '<h2 class="st2">상품 고치기 — p01 메가바이탈 비타민C 3000</h2>'
  + table(["① 기본",""],[
      ["이름 · 한 줄 설명","메가바이탈 비타민C 3000 · 1일 1포 · 물 없이 먹는 분말형 · 3g × 90포"],
      ["갈래 · 판매자","건강식품 · 소개뱅크 직판관"],
      ["정가 · 배지","36,750원 · 신규입점"],
      ["대표 성분 | 함량","비타민C | 3,000mg <span class=\"dim\">(상품명보다 위에 보이는 표제)</span>"],
      ["기능성 문구 · 심의필 번호",'<span class="dim">건강기능식품만 — 금지 표현은 저장 때 DB 가 막습니다</span>']
    ])
  + table(["② 옵션 · 재고","개월 수","결제 금액","한 달 단가","재고","꼬리 글자","켬"],[
      ["1","9","35,100","3,900","26","2+1","켬"],
      ["2","6","25,200","4,200","31","1+1","켬"],
      ["3","3","14,700","4,900","54","","켬"]
    ])
  + '<div class="hbtn" style="margin-top:8px"><button class="bs">+ 옵션 줄 더하기</button><button class="bp">저장</button></div>'
  + table(["③ 그림 · ④ 고시 · 주의사항",""],[
      ["그림","사진이 없으면 그린 그림(꼴 · 색) — 사진은 jpg · png 5MB 까지"],
      ["상품정보제공고시","갈래 묶음의 항목 순서대로 · 비우면 「상세 설명 참조」"],
      ["주의사항","위가 약한 분은 식후에 드십시오. 1일 권장량을 넘기지 마십시오."]
    ])
  + '<h2 class="st2">변경 기록 <span class="dim">(견본)</span></h2>'
  + table(["때","누가","항목","전","후"],[
      ["10-08 14:20","운영자","옵션 3 재고","60","54"],
      ["10-08 14:18","운영자","옵션 1 결제 금액","36,000","35,100"]
    ])
  + note("info","<b>결제 금액 · 재고 · 상태를 바꾼 기록은 지울 수 없습니다.</b> 누가 언제 무엇을 바꿨는지 남습니다.")

  + '<h2 class="st2">성분 · 고민 <span class="dim">(SB-ADM-HPR-020)</span></h2>'
  + table(["성분","다른 이름","군","많이 찾는","상품"],[
      ["비타민C","—","—","✓","1"],
      ["유산균","락토바실러스","—","✓","1"],
      ["블루베리","—","블루베리·베리류","","0"],
      ["홍삼","인삼농축액","홍삼·한방성분","","1"]
    ])
  + note("info","<b>성분 트리는 2단까지</b>입니다(군 → 성분). 3단은 DB 가 막습니다. 고민 이름에 질병명 · 효능 표현은 넣을 수 없습니다.")

  + '<h2 class="st2">갈래 · 판매 범위 <span class="dim">(SB-ADM-HPR-030)</span></h2>'
  + table(["갈래","판매 범위","수수료율","청약철회"],[
      ["건강식품",'<span class="st ok">열림</span>',"10%","개봉 시 제한"],
      ["화장품",'<span class="st ok">열림</span>',"10%","일반"],
      ["건강기능식품",'<span class="st">잠김</span>',"12%","개봉 시 제한"],
      ["의료기기",'<span class="st bad">팔지 않음</span>',"—","—"]
    ])
  + note("warn","<b>판매 범위는 이 화면에서 바꾸지 않습니다</b> — 법무 확인 뒤 운영 정책으로 바꿉니다. 여기서는 읽기만 합니다.")
  + '</div>' + F();
}
"""
rep("""

/* ══════════════════════════════════════════════════════════════
 * 신규 7화면 (2026-09-18)""", ADM + """

/* ══════════════════════════════════════════════════════════════
 * 신규 7화면 (2026-09-18)""")
rep("""  admadb:scAdmAdb, admcol:scAdmCol, admhst:scAdmHst,""", """  admadb:scAdmAdb, admcol:scAdmCol, admhst:scAdmHst, admhpr:scAdmHpr,""")
rep("""  admhst: M("SB-ADM-HST-010",""", """  admhpr: M("SB-ADM-HPR-010","sogaebaenk.co.kr/admin/health/products","운영","소개몰 상품. 상품 · 옵션(복용 개월 수) · 재고 · 그림 · 고시를 넣고 고칩니다 — 값 · 재고는 옵션에서 계산되고 바꾼 기록이 남습니다(v10.26)."),
  admhst: M("SB-ADM-HST-010",""")
rep("""  { re:/^\\/admin\\/health\\/settlements\\/?$/, screen:"admhst", title:"소개몰 정산",""", """  { re:/^\\/admin\\/health\\/products\\/?$/, screen:"admhpr", title:"소개몰 상품",
    desc:"상품 · 옵션 · 재고 · 그림 · 고시. 값 · 재고는 옵션에서 계산됩니다(v10.26)." },
  { re:/^\\/admin\\/health\\/settlements\\/?$/, screen:"admhst", title:"소개몰 정산",""")

# ── 판 올림(제목) — 앞 판들의 설명은 뒤에 그대로 ──
rep("""<title>소개뱅크 시안 v10.25 (2026-10-08 · """, """<title>소개뱅크 시안 v10.26 (2026-10-08 · 소개몰 상품 자료 — 옵션(복용 개월 수 · 단품) · 「한 달 N원 부터」는 살 수 있는 옵션만 · 그림의 「건강기능식품」 「GMP」 글자 뺌 · 자동완성(상품 이름 · 살 수 있는 것만 · 고르면 바로 검색) · 저분자 콜라겐 → 건강식품 · 화장품 견본(바르는 크림 · 단품) · 반품 신청의 품목 · 수량 칸 뺌 · 교환 배송비 접수 때 결제(시험 결제) · 운영 「소개몰 상품」(SB-ADM-HPR-010) · v10.25: 2026-10-08 · """)

# ── 판매 약관 전문 — 개발분 HLT_SALE 1.2(D028 · 10/8 「약관 확정」)와 같은 글(qa/hlt_sale_terms.md) ──
import json as _json
_old_t = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hlt_sale_terms_v1_1.md'), encoding='utf-8').read().strip()
_new_t = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hlt_sale_terms.md'), encoding='utf-8').read().strip()
rep('const HLT_SALE_TERMS = ' + _json.dumps(_old_t, ensure_ascii=False) + ';', 'const HLT_SALE_TERMS = ' + _json.dumps(_new_t, ensure_ascii=False) + ';')

# 시연 보장 표(MAP) — 새 화면에서 눌러도 변화가 없는 단추는 「실제 동작은 구현 화면 …」 안내(운영 화면 탭 「소개몰 상품」)
rep("""(function(){
  var MAP = {""", """(function(){
  var MAP = {"admhpr": {"id": "SB-ADM-HPR-010", "url": "/admin/health/products", "name": "소개몰 상품"}, """)

# 서버 연동(srvstk) — v10.26 부터 옵션이 여럿인 상품은 옵션을 골라 주문합니다(OPTION_REQUIRED). 카드의 담기 옵션(cartOptionId)으로
rep("""  const O = await api('buyer', 'POST', '/health/orders', { addressId: addr.id, items: [{ productCode: p.code, qty: 1 }] });""",
    """  const O = await api('buyer', 'POST', '/health/orders', { addressId: addr.id, items: [{ productCode: p.code, optionId: p.cartOptionId || undefined, qty: 1 }] });      /* v10.26 — 옵션 */""")


if __name__ == '__main__':
    open(P, 'w', encoding='utf-8').write(s)
    print('시안 v10.26 고침 —', P)
