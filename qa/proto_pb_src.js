var M_bill = (function(){
/* ═══════════════════════════════════════════════════════════════════
   v10.18 (2026-10-06) — 결제 · 환불의 실제 결과를 그대로 보여 주는 두 자리 (서버 D022)
   ───────────────────────────────────────────────────────────────────
   ① 마이 「구독 · 소개코드」(mysub · SB-MYP-SUB-010) 위쪽 「내 구독」
        자동 갱신 해지 · 해지 철회 · 환불 신청. 환불은 세 가지 말만 씁니다 —
        환불 완료(결제사 취소 확인) · 환불 결과 확인 중(결제사 답 없음) · 환불 실패(결제사 거절)
   ② 운영 「청구 현황」(admbil · SB-ADM-BIL-010) 위쪽 「결제 · 환불 확인 필요」
        결제사 결과가 확정되지 않은 청구 · 끝나지 않은 환불 · 결과가 불명확한 요청. 비어 있어야 정상.
   ★ 시연입니다 — 이 브라우저 안에서만 바뀌고 저장하지 않습니다(새로고침하면 처음으로 돌아갑니다).
     문구와 순서는 실제 웹(SubscriptionManage.tsx · Billing.tsx)과 서버(recurring.service)와 같게 그렸습니다.
     「시연 — 결제사 응답」은 시안에만 있습니다(실제 화면에는 없음): 세 가지 결과를 차례로 보여 드리기 위한 것입니다.
   ═══════════════════════════════════════════════════════════════════ */
let U = null, D = null;
const e = x => U.esc(x);
const won = n => Number(n).toLocaleString("ko-KR") + "원";
const today = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
const FV = {};
function keep(){ document.querySelectorAll("[data-pbv]").forEach(el => { FV[el.getAttribute("data-pbv")] = el.value; }); }
const fv = (k, d) => (k in FV ? FV[k] : (d == null ? "" : d));

const FRESH = () => ({
  n: 0, status: "ACTIVE", cancelAt: null, refund: null, msg: null, rmsg: null,
  review: [
    { k: "inv", what: "정기결제 청구", sub: "2번째 시도", pg: "AMOUNT_MISMATCH", amount: 49000, wait: "3시간", ref: "sub_7f3a…_a2" },
    { k: "inv", what: "정기결제 청구", sub: "1번째 시도", pg: null, amount: 149000, wait: "12분", ref: "sub_c91e…_a1" },
    { k: "ref", what: "구독 환불", sub: "1번째 시도", pg: null, amount: 49000, wait: "8분", ref: "환불 요청 5d0b…" },
    { k: "req", what: "요청 POST /subscriptions", sub: "", pg: "UNKNOWN", amount: 49000, wait: "5분", ref: "ord_18c2…" }
  ]
});
let PB = FRESH();
const PG_NOTE = { AMOUNT_MISMATCH: "금액이 다르게 승인됨 — 자동으로 닫지 않습니다", UNKNOWN: "결제 결과 불명확 — 같은 요청이 다시 오면 대조합니다" };

function flash(m, key){
  return m ? '<div class="px-flash' + (m[0] === "ok" ? '' : ' bad') + '" role="' + (m[0] === "ok" ? 'status' : 'alert') + '" data-pb-flash="' + m[0] + '" data-pb-of="' + key + '" data-n="' + PB.n + '">' + e(m[1]) + '</div>' : '';
}
function refundNote(r){
  const label = r.state === "SUCCEEDED" ? "환불 완료" : r.state === "FAILED" ? "환불 실패" : "환불 결과 확인 중";
  const note = r.state === "SUCCEEDED" ? "결제사에서 결제 취소를 확인했습니다. 카드사에 따라 영업일 기준 3~5일 안에 반영됩니다."
    : r.state === "FAILED" ? "결제사가 결제 취소를 받아들이지 않았습니다. 구독과 결제는 그대로입니다 — 다시 신청하시거나 고객센터로 문의해 주십시오."
    : "결제사에서 결과를 확인하는 중입니다. 다시 결제하거나 다른 조치를 하지 않으셔도 됩니다 — 확인되는 대로 반영됩니다.";
  return '<div class="nt ' + (r.state === "SUCCEEDED" ? "ok" : "warn") + '" data-pb-refund="' + r.state + '"><b>' + label + '</b> <span class="ls">' + won(r.amount) + ' · 신청 ' + e(r.at) + '</span>' +
    (r.state === "FAILED" ? ' — ' + e(r.why) : '') + '<br>' + note + '</div>';
}

/* ── ① 내 구독 (mysub 위쪽) ───────────────────────────────────────── */
function myBox(){
  const s = D.my.sub, cur = (D.my.plans.find(p => p.code === s.plan) || D.my.plans[0]);
  const rf = PB.refund, open = !!rf && rf.state === "UNKNOWN", done = !!rf && rf.state === "SUCCEEDED";
  const notice = open ? "환불 결과를 확인하는 중입니다. 결과가 나올 때까지 이 구독의 이용 · 갱신이 멈춥니다."
    : PB.cancelAt && !done ? "해지 예약되었습니다. " + e(s.next) + "까지 이용할 수 있고 이후 청구되지 않습니다." : "";
  const pgSel = '<label class="ls" style="display:inline-flex;gap:6px;align-items:center">시연 — 결제사 응답 ' +
    '<select class="inp" style="width:auto" data-pbv="pg" aria-label="시연용 결제사 응답">' +
    [["ok", "정상(취소 확인)"], ["lost", "응답 없음"], ["deny", "거절"]].map(o => '<option value="' + o[0] + '"' + (fv("pg", "ok") === o[0] ? " selected" : "") + '>' + o[1] + '</option>').join("") + '</select></label>';
  return '<section class="subnow" data-pb-box="my" style="display:block">' +
    '<h2 class="s2" style="margin-top:0">내 구독</h2>' +
    (done
      ? '<p class="ls">이용 중인 구독이 없습니다.</p>'
      : '<table class="tb"><tbody>' +
        '<tr><th>요금제</th><td>' + e(cur.name) + ' <span class="ls">월 ' + won(cur.price) + '</span></td></tr>' +
        '<tr><th>상태</th><td>이용 중</td></tr>' +
        '<tr><th>이용 기간</th><td>' + e(s.from) + ' ~ ' + e(s.next) + '</td></tr>' +
        '<tr><th>자동 갱신</th><td>' + (PB.cancelAt ? '해지함 (' + e(PB.cancelAt) + ')' : '자동 갱신') + '</td></tr>' +
        '<tr><th>다음 청구</th><td>' + (PB.cancelAt || open ? '청구 예정 없음' : e(s.next)) + '</td></tr>' +
        '</tbody></table>') +
    (notice ? '<div class="nt warn" data-pb-notice>' + notice + '</div>' : '') +
    (rf ? refundNote(rf) : '') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">' +
    (done
      ? '<button class="bo" data-pb="reset">처음 상태로 (시연)</button>'
      : open
        ? '<button class="bp" data-pb="recheck">환불 결과 다시 확인</button>' + pgSel
        : (PB.cancelAt
            ? '<button class="bo" data-pb="resume">해지 철회</button>'
            : '<button class="bo" data-pb="cancel">자동 갱신 해지</button>') +
          '<input class="inp" style="flex:1;min-width:160px" data-pbv="reason" maxlength="200" placeholder="환불 사유 (필수)" aria-label="환불 사유" value="' + e(fv("reason")) + '">' +
          '<button class="bo" data-pb="refund">환불 신청</button>' + pgSel) +
    '</div>' +
    flash(PB.msg, "my") +
    '<p class="ls" style="margin:8px 0 0">환불은 결제 당일 · 미이용일 때만 신청할 수 있습니다. 결제사가 결제 취소를 확인한 뒤에만 「환불 완료」가 됩니다.</p>' +
    '</section>';
}

/* ── ② 결제 · 환불 확인 필요 (admbil 위쪽) ─────────────────────────── */
function admBox(){
  const rv = PB.review;
  return '<section data-pb-box="adm">' +
    '<h2 class="s2">결제 · 환불 확인 필요 <em>' + rv.length + '</em></h2>' +
    (rv.length
      ? '<div class="nt warn">비어 있어야 정상입니다. 청구 · 환불은 배치가 결제사에 조회해 닫습니다 — 하루 넘게 남아 있으면 결제사 관리자 화면과 대조해 주십시오.</div>' +
        '<div style="overflow-x:auto"><table class="tb"><thead><tr><th>구분</th><th>상태</th><th>금액</th><th>기다린 시간</th><th>주문번호 · 결제 키</th></tr></thead><tbody>' +
        rv.map(r => '<tr data-pb-row="' + r.k + '"><td>' + e(r.what) + (r.sub ? ' <span class="ls">(' + e(r.sub) + ')</span>' : '') + '</td>' +
          '<td>' + (r.pg ? '<b class="warnx">' + e(PG_NOTE[r.pg]) + '</b>' : (r.k === "ref" ? "환불 결과 확인 중" : "결제사 결과 확인 중")) + '</td>' +
          '<td class="num">' + Number(r.amount).toLocaleString("ko-KR") + '</td><td>' + e(r.wait) + '</td><td class="ls">' + e(r.ref) + '</td></tr>').join("") +
        '</tbody></table></div>'
      : '<p class="mut">결과가 확정되지 않은 청구 · 환불 · 요청이 없습니다.</p>') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">' +
    '<button class="bo" data-pb="reconcile">지금 대조 (시연)</button>' +
    '<button class="bo" data-pb="rreset">처음 상태로 (시연)</button></div>' +
    flash(PB.rmsg, "adm") +
    '</section>';
}

/* ══ 처리기 — data-pb 가 붙은 것만 듣습니다 ══════════════════════════ */
const ACT = {
  cancel(){ PB.cancelAt = today(); PB.msg = ["ok", D.my.sub.next + "까지 이용할 수 있습니다. 이후 자동 청구되지 않습니다."]; },
  resume(){ PB.cancelAt = null; PB.msg = ["ok", "자동 갱신으로 돌아갑니다."]; },
  refund(){
    const why = String(fv("reason")).trim();
    if (!why) { PB.msg = ["err", "환불 사유를 적어 주십시오."]; return; }
    const cur = (D.my.plans.find(p => p.code === D.my.sub.plan) || D.my.plans[0]);
    const r = { amount: cur.price, at: today(), why: "" }, pg = fv("pg", "ok");
    if (pg === "deny") { r.state = "FAILED"; r.why = "취소 할 수 없는 결제 입니다."; PB.msg = ["err", "환불 실패 — " + r.why + " 구독과 결제는 그대로입니다."]; }
    else if (pg === "lost") { r.state = "UNKNOWN"; PB.msg = ["err", "환불 결과 확인 중 — 결제사 응답을 받지 못했습니다. 다시 신청하지 않으셔도 됩니다."]; }
    else { r.state = "SUCCEEDED"; PB.msg = ["ok", "환불 완료 — 결제사에서 결제 취소를 확인했습니다."]; delete FV.reason; }
    PB.refund = r;
  },
  recheck(){
    if (fv("pg", "ok") === "lost") { PB.msg = ["err", "환불 결과 확인 중 — 아직 결제사에서 확인되지 않았습니다(같은 취소를 다시 보내도 한 번만 처리됩니다)."]; return; }
    if (fv("pg", "ok") === "deny") { PB.refund.state = "FAILED"; PB.refund.why = "취소 할 수 없는 결제 입니다."; PB.msg = ["err", "환불 실패 — 결제사가 결제 취소를 받아들이지 않았습니다."]; return; }
    PB.refund.state = "SUCCEEDED"; PB.msg = ["ok", "환불 완료 — 결제사에 조회해 결제 취소를 확인했습니다."]; delete FV.reason;
  },
  reset(){ const keepReview = PB.review, n = PB.n; PB = FRESH(); PB.review = keepReview; PB.n = n; delete FV.reason; delete FV.pg; PB.msg = ["ok", "처음 상태로 돌렸습니다."]; },
  reconcile(){
    const closed = PB.review.filter(r => !r.pg), left = PB.review.filter(r => r.pg);
    PB.review = left;
    PB.rmsg = closed.length
      ? ["ok", "결제사에 조회해 " + closed.length + "건을 닫았습니다(청구 → 결제 완료 · 환불 → 환불 완료). 남은 " + left.length + "건은 사람이 확인해야 합니다."]
      : ["err", "자동으로 닫을 수 있는 것이 없습니다 — 남은 " + left.length + "건은 결제사 관리자 화면과 대조해 주십시오."];
  },
  rreset(){ PB.review = FRESH().review; PB.rmsg = ["ok", "처음 상태로 돌렸습니다."]; }
};
function bind(){
  document.addEventListener("click", ev => {
    const t = ev.target.closest && ev.target.closest("[data-pb]");
    if (!t) return;
    const k = t.getAttribute("data-pb");
    if (!ACT[k]) return;
    ev.preventDefault(); keep(); PB.n += 1;
    ACT[k]();
    U.render();
  });
}
function install(ui, data){
  U = ui; D = data;
  bind();
  window.__PB = { state: () => PB, myBox: myBox, admBox: admBox };
}
  return { install: install };
})();
