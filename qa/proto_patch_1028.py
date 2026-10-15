"""v10.28 시안 — v10.27 시안에서 v10.28 로 (소개몰 배송 · 구매확정 · 리뷰 · 문의 · 순위 · 선택 약관 · 상담 이메일 · 개인 정산 · 약관 재동의).

  python3 proto_patch_1028.py                 BASE(v10.27 시안)에서 읽어 OUT 에 씁니다 — 몇 번을 돌려도 같은 결과
  OUT=/path/preview.html python3 …            미리보기는 킷 밖에 씁니다
10/9 「비교 그림의 제안대로 반영」 · 「권장대로」 — 실제 웹(v10.28)과 같은 내용을 시안에도 넣습니다.
  소개몰(겹쳐 뜨는 틀)  리뷰 쓰기(별점 · 글 · 구매확정한 주문만) · 리뷰 별점 거르기(사진 없음) · 문의 비공개 고르기 · 운영자 답변 ·
                        구매확정 안내 바로잡음(확정 뒤에도 법정 기간 안 반품 · 교환) · 자동 확정 날짜 · 순위 기준(최근 7일 판매 수량 · 하루 1회)
  본체                  운영 「소개몰 주문」(SB-ADM-HOR-010) · 「소개몰 리뷰 · 문의」(SB-ADM-HRV-010) · 정산(개인 회원 · 받을 계좌 · 소개비 받기 · 세금 한 줄) ·
                        약관 동의 · 재동의(SB-HOM-ETC-022 · 바뀐 점 표 · 선택 항목 바꾸기) · 상담 신청 이메일 · 파트너 연락처 이메일 · 로그인 안내 · INV-10 설명
"""
import os, sys
P = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html'
BASE = os.environ.get('BASE', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_proto_v1027_base.html'))
OUT = os.environ.get('OUT', P)
s = open(BASE, encoding='utf-8').read()
def rep(old, new, n=1):
    global s
    c = s.count(old)
    if c != n: sys.exit(f'자리 수가 다릅니다({c} ≠ {n}): {old[:90]!r}')
    s = s.replace(old, new)

# ══ 0. 판 이름 ═══════════════════════════════════════════════════════════════════
rep('<title>소개뱅크 시안 v10.27 (2026-10-09 · 결함 수정판 — ',
    '<title>소개뱅크 시안 v10.28 (2026-10-09 · 소개몰 발송 처리 · 구매확정(배송 완료 7일 뒤 자동) · 리뷰 쓰기(별점 · 글) · 상품 문의(비공개 · 운영자 답변) · 순위(최근 7일 판매 수량) · '
    '선택 약관 바꾸기 · 상담 신청 이메일 · 개인 소개비 정산(본인인증 · 받을 계좌 확인) · 약관 한 벌 · 재동의 · v10.27: 결함 수정판 — ')

# ══ 1. 소개몰(겹쳐 뜨는 틀) ════════════════════════════════════════════════════════
# 1-1 리뷰 탭 — 사진 없이 별점 거르기(10/9 「글 + 별점만」)
rep('''/** 리뷰 탭 — 약싸몰과 같은 구성(별점 요약 · 포토리뷰 · 마스킹). 글은 우리가 지은 예시입니다. */
function reviewTab(p){
  const photos = p.reviews.filter(function(r){ return r.photo; });''',
'''/** 리뷰 탭 — 별점 요약 · 별점 거르기 · 마스킹. 글은 우리가 지은 예시입니다.
 *  v10.28 (10/9 「글 + 별점만」) — 사진은 이번 판에 받지 않습니다(파일 검사 · 가림 규칙이 따로 필요). 전의 「사진 있는 글만」 → 별점 거르기. */
function reviewTab(p){
  const rs = SCREENS["SB-HLT-PRD-010"].rvStar || 0;
  const photos = p.reviews.filter(function(r){ return !rs || r.star === rs; });''')
rep('''    + '<span class="hlt-mut">리뷰 ' + p.rev.toLocaleString("ko-KR") + '건 · 포토리뷰 '
    + p.photo + '장</span>'
    + '<button type="button" class="hlt-btn sm" data-rvfilter="photo">사진 있는 글만</button>'
    + '<button type="button" class="hlt-btn sm" data-rvfilter="all">전체</button></div>'
    + '<p class="hlt-sm hlt-mut3">구매확정한 분만 쓸 수 있습니다.</p></div>'

    + '<div class="hlt-box">'
    + (SCREENS["SB-HLT-PRD-010"].rvOnlyPhoto ? photos : p.reviews).map(function(r){''',
'''    + '<span class="hlt-mut">리뷰 ' + p.rev.toLocaleString("ko-KR") + '건</span>'
    + '<button type="button" class="hlt-btn sm' + (!rs ? ' pri' : '') + '" data-rvfilter="all">전체</button>'
    + [5, 4, 3, 2, 1].map(function(k){ return '<button type="button" class="hlt-btn sm' + (rs === k ? ' pri' : '') + '" data-rvfilter="' + k + '">' + k + '점</button>'; }).join("")
    + '</div>'
    + '<p class="hlt-sm hlt-mut3">구매확정한 분만 쓸 수 있습니다(주문 상품마다 1건 · 고치기 · 지우기는 본인만 · 운영은 가림만). 사진은 받지 않습니다.</p></div>'

    + '<div class="hlt-box" data-rvlist="' + rs + '">'
    + (photos.length ? '' : '<p class="hlt-mut">이 별점의 리뷰가 없습니다.</p>')
    + photos.map(function(r){''')
rep('''          + (r.photo ? '<span class="hlt-bdg st">사진</span>' : '') + '</div>'
          + '<p style="margin:6px 0 0">' + esc(r.text) + '</p>'
          + (r.photo ? '<div class="hlt-rv-ph">사진</div>' : '')''',
'''          + '</div>'
          + '<p style="margin:6px 0 0">' + esc(r.text) + '</p>\'''')
rep('''                + '운영 검수 대기 — 효능 암시 표현 감지: "' + esc(warn.join('", "')) + '"<br>'
                + '<span class="hlt-mut3">등록은 막지 않고 검수 큐로 보냅니다. 막으면 리뷰가 안 쌓입니다 (§9-2).</span></div>\'''',
'''                + '운영 확인 대기 — 효능 · 효과를 단정하는 표현: "' + esc(warn.join('", "')) + '"<br>'
                + '<span class="hlt-mut3">등록은 받고, 운영자가 확인한 뒤 보입니다(10/9 「바로 노출 · 금칙어면 운영 확인 뒤」).</span></div>\'''')
rep('''    if (rvf) { SCREENS["SB-HLT-PRD-010"].rvOnlyPhoto = (rvf === "photo"); render(); return; }''',
    '''    if (rvf) { SCREENS["SB-HLT-PRD-010"].rvStar = (rvf === "all" ? 0 : Number(rvf) || 0); render(); return; }   /* v10.28 — 별점 거르기 */''')

# 1-2 문의 탭 — 비공개는 고르기(기본 꺼짐) · 운영자가 답함 · 본인인증 회원
rep('''/** 문의 탭 — 비밀글 기본 · 작성자 마스킹 */''',
    '''/** 문의 탭 — 비공개는 쓴 분이 고름(쓴 분과 운영자만 봄) · 운영자가 답함 · 작성자 마스킹. v10.28 (10/9 「권장대로」) */''')
rep('''          + (q.secret ? '<span class="hlt-bdg st">비밀글</span>' : '')''',
    '''          + (q.secret ? '<span class="hlt-bdg st">비공개</span>' : '')''')
rep('''          + (q.secret ? '<span class="hlt-mut3">비밀글입니다. 작성자와 판매자만 볼 수 있습니다.</span>\'''',
    '''          + (q.secret ? '<span class="hlt-mut3">비공개 문의입니다. 쓴 분과 운영자만 볼 수 있습니다.</span>\'''')
rep('''    + '<textarea id="qnaText" placeholder="배송·성분·복용 방법 등 무엇이든 물어보십시오"></textarea></div>'
    + '<div class="hlt-chk"><input type="checkbox" id="qnaSecret" checked>'
    + '<label for="qnaSecret">비밀글로 등록 (기본)</label></div>'
    + '<button type="button" class="hlt-btn pri" id="btnQna" style="margin-top:8px">문의 등록</button>'
    + '<p class="hlt-sm hlt-mut3" style="margin-top:8px">건강 관련 문의는 영양 전문 약사가 답변합니다.</p>\'''',
'''    + '<textarea id="qnaText" placeholder="상품에 대해 궁금한 점을 적어 주십시오(5자 이상). 개인정보는 적지 마십시오."></textarea></div>'
    + '<div class="hlt-chk"><input type="checkbox" id="qnaSecret">'
    + '<label for="qnaSecret">비공개(나와 운영자만 봄)</label></div>'
    + '<button type="button" class="hlt-btn pri" id="btnQna" style="margin-top:8px">문의 등록</button>'
    + '<p class="hlt-sm hlt-mut3" style="margin-top:8px">본인인증 회원이 쓸 수 있습니다. 운영자가 답하면 알림으로 알려 드립니다.</p>\'''')
rep('''    if (t.id === "btnQna") { toast("문의가 등록되었습니다 (비밀글)"); return; }''',
    '''    if (t.id === "btnQna") {   /* v10.28 — 비공개는 고른 경우만 · 운영자가 답함 */
      const qt = (document.getElementById("qnaText") || {}).value || "", qs = (document.getElementById("qnaSecret") || {}).checked;
      if (qt.trim().length < 5) { toast("문의 내용을 5자 이상 적어 주십시오"); return; }
      toast("문의가 등록되었습니다" + (qs ? " (비공개 — 나와 운영자만 봄)" : "") + " · 운영자가 답하면 알림으로 알려 드립니다"); return;
    }''')

# 1-3 리뷰 쓰기(구매확정한 주문) — 전에는 「리뷰 작성은 P2 범위입니다」 안내만
rep('''    if (rv) { toast("리뷰 작성은 P2 범위입니다"); return; }''',
    '''    if (rv) { openReviewModal(rv); return; }   /* v10.28 — 리뷰 쓰기(별점 1 ~ 5 · 글 10 ~ 1,000자) */''')
rep('''    else if (a === "confirmYes") doConfirm(b.getAttribute("data-no"));''',
    '''    else if (a === "confirmYes") doConfirm(b.getAttribute("data-no"));
    else if (a.indexOf("rvStar:") === 0) { RVF.star = Number(a.slice(7)); paintReviewModal(); }   /* v10.28 */
    else if (a === "rvSave") saveReview(b.getAttribute("data-no"));''')
rep('''function confirmPurchase(no){
  openModal("구매를 확정하시겠습니까",
    '<div class="hlt-note danger">구매확정 후에는 취소 · 반품이 제한됩니다. '
    + '되돌릴 수 없습니다.</div>\'''',
'''function confirmPurchase(no){
  /* v10.28 (10/9 바로잡음) — 확정 뒤에도 법정 기간 안의 반품 · 교환은 받습니다(전자상거래법 17조). 전에는 「확정 후 취소 · 반품 제한」으로 적혀 있었습니다. */
  openModal("구매를 확정하시겠습니까",
    '<div class="hlt-note">상품을 잘 받으셨나요? 확정하면 <b>리뷰를 쓰실 수 있습니다.</b> '
    + '누르지 않아도 배송 완료 7일 뒤(청약철회 기간이 더 길면 그 기간 뒤) 자동으로 확정됩니다.</div>'
    + '<div class="hlt-note warn" style="margin-top:8px">확정 뒤에도 상품 하자 · 표시와 다름 · 오배송은 받으신 날부터 <b>3개월</b> 안에 반품 · 교환을 신청하실 수 있습니다.</div>\'''')
rep('''/* ── 반품 ─────────────────────────────────────────────────── */

function updateRefund(){''',
'''/* ── 리뷰 쓰기 · v10.28 (D036 · 10/9 「권장대로」) ─────────────────────
 * 구매확정한 주문의 상품마다 1건 · 별점 1 ~ 5 · 글 10 ~ 1,000자 · 사진 없음 · 고치기 · 지우기는 본인 · 운영은 가림만.
 * 효능 · 효과를 단정하는 표현(금칙어)에 걸리면 운영 확인 뒤 보입니다. 실제 웹: 주문 상세 「리뷰」 칸(ReviewForm). */
const RVF = { star:5, text:"" };
function openReviewModal(no){
  const o = S.orders.filter(function(x){ return x.no === no; })[0];
  if (!o || o.status !== "CONFIRMED") { toast("구매확정한 주문만 리뷰를 쓰실 수 있습니다"); return; }
  const mine = (S.myReviews || {})[no];
  RVF.no = no; RVF.star = mine ? mine.star : 5; RVF.text = mine ? mine.text : "";
  paintReviewModal();
}
function paintReviewModal(){
  const keep = document.getElementById("rvText"); if (keep) RVF.text = keep.value;
  const mine = (S.myReviews || {})[RVF.no];
  openModal(mine ? "내 리뷰 고치기" : "리뷰 쓰기",
    '<div data-rvmodal="1"><div class="hlt-sm hlt-mut">주문번호 ' + esc(RVF.no) + ' · 구매확정한 주문의 상품마다 1건</div>'
    + '<div style="margin:10px 0 6px;font-size:22px" role="radiogroup" aria-label="별점">' + [1,2,3,4,5].map(function(k){
        return '<button type="button" class="hlt-btn sm' + (k <= RVF.star ? ' pri' : '') + '" data-mact="rvStar:' + k + '" aria-label="' + k + '점">★</button>'; }).join("") + ' <b>' + RVF.star + '점</b></div>'
    + '<textarea id="rvText" rows="4" maxlength="1000" style="width:100%" placeholder="써 보신 느낌을 10자 이상 적어 주십시오. 효능 · 효과를 단정하는 표현은 운영 확인 뒤 보입니다.">' + esc(RVF.text) + '</textarea>'
    + '<p class="hlt-sm hlt-mut3">사진은 받지 않습니다. 고치기 · 지우기는 본인만 할 수 있고, 운영자는 가리기만 합니다(가리면 사유를 알려 드림).</p></div>',
    '<button type="button" class="hlt-btn" data-mact="close">닫기</button>'
    + '<button type="button" class="hlt-btn pri" data-mact="rvSave" data-no="' + esc(RVF.no) + '">' + (mine ? "고치기" : "등록") + '</button>');
}
function saveReview(no){
  const t = ((document.getElementById("rvText") || {}).value || "").trim();
  if (t.length < 10) { toast("리뷰 글은 10자 이상 적어 주십시오"); return; }
  const hold = reviewWarn(t);
  S.myReviews = S.myReviews || {};
  S.myReviews[no] = { star:RVF.star, text:t, hold:hold.length > 0 };
  closeModal(); render();
  toast(hold.length ? "등록했습니다 — 효능 단정 표현이 있어 운영 확인 뒤 보입니다" : "리뷰를 등록했습니다");
}

/* ── 반품 ─────────────────────────────────────────────────── */

function updateRefund(){''')
rep('''  if (o.status === "CONFIRMED") b.push('<button type="button" class="hlt-btn sm" data-review="' + o.no + '">리뷰쓰기</button>');''',
    '''  if (o.status === "CONFIRMED") {   /* v10.28 — 확정 뒤에도 법정 기간 안 반품 · 교환 · 리뷰 쓰기(쓴 리뷰는 고치기) */
    b.push('<button type="button" class="hlt-btn sm" data-review="' + o.no + '">' + ((S.myReviews || {})[o.no] ? "내 리뷰 고치기" : "리뷰쓰기") + '</button>');
    go("반품신청", "#/my/returns/new?o=" + o.no);
  }''')
rep('''  if (o.status === "CONFIRMED") {
    return { ok:false, reason:"구매확정된 주문입니다. 확정 후에는 취소·반품이 제한됩니다." };
  }''',
'''  if (o.status === "CONFIRMED") {
    /* v10.28 (10/9 바로잡음) — 구매확정은 법정 반품을 막지 않습니다. 단순 변심은 청약철회 기간 안 · 하자 · 표시와 다름 · 오배송은 받은 날부터 3개월(전자상거래법 17조) */
    const d2 = daysSince(o.deliveredAt || o.at);
    if (d2 <= 90) {
      return { ok:true, type:"RETURN",
        note:"구매확정한 주문입니다. 단순 변심은 받으신 날부터 " + RETURN_WINDOW_DAYS + "일 안, 상품 하자 · 표시와 다름 · 오배송은 3개월 안에 신청하실 수 있습니다." };
    }
    return { ok:false, reason:"받으신 날부터 3개월이 지났습니다. 고객센터로 문의해 주십시오. (HLT_RETURN_WINDOW_CLOSED)" };
  }''')

# 1-4 순위 기준 — 최근 7일 판매 수량 · 하루 1회 집계(10/9 「권장대로」 · D037)
rep('''순위 근거 — 자사 2026-09 주문 건수 기준(견본 순서) · 이름 · 값은 판매 중인 실제 상품 · 순위에는 산출 근거 · 기간을 함께 답니다.''',
    '''순위 근거 — 최근 7일 판매 수량 기준 · 하루 1회 집계(시안은 견본 순서) · 취소 · 반품 제외 · 판매 중인 상품만 · 판매가 없으면 이 칸은 감춥니다.''')
rep('''      + '<section class="shop-sec" data-shop-many="1">' + shopHead("많이 찾는 상품", "", "#/c/HLT_FOOD")''',
    '''      + '<section class="shop-sec" data-shop-many="1">' + shopHead("많이 찾는 상품", "최근 7일 주문 건수 기준 · 하루 1회 집계(시안은 견본 순서)", "#/c/HLT_FOOD")''')

exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proto_patch_1028_main.py'), encoding='utf-8').read())

open(OUT, 'w', encoding='utf-8').write(s)
print('썼습니다', OUT, len(s))
