# v10.28 시안 — 본체 화면. proto_patch_1028.py 가 exec 로 불러 씁니다(같은 s · rep).

# ══ 2-1 로그인 안내 · 불변식 설명 — 개인도 소개비를 받음(지시서 5절 · INV-10R) ══════════════════
rep('''      '<p><b>개인 회원도 가입</b>해 요청 등록과 소개 참여를 하실 수 있습니다. 판매 등록 · 소개비 수령은 사업자 인증 후입니다.</p></div>'+   /* v10.27 G-199 */''',
    '''      '<p><b>개인 회원도 가입</b>해 요청 등록과 소개 참여를 하실 수 있습니다. <b>본인인증을 하시면 소개비도 받으십니다.</b> 판매 등록 · 거래 만들기는 사업자 인증 후입니다.</p></div>'+   /* v10.27 G-199 · v10.28 개인 소개비 */
      /* v10.28 — 약관이 새 판으로 바뀐 뒤 로그인하면 바로 동의 화면으로 갑니다(10/9 「다음 로그인 때 동의」) */
      '<div class="jc w" style="margin:10px 0 0" data-reconsent-demo="1"><span class="lb">약관이 바뀐 뒤 로그인하면</span>'+
      '로그인 직후 <b>약관 동의 화면</b>으로 갑니다 — 바뀐 점을 보시고 필수 약관에 동의하시면 가려던 화면으로 이어집니다. '+
      '<div style="margin-top:8px"><button class="jb o" data-go="trmagr">재동의 화면 보기</button></div></div>'+''')
rep('''["INV-10", "정산 수령인은 인증된 사업자여야 한다", "ACTIVE", "소개"]''',
    '''["INV-10", "정산 수령인은 인증된 사업자이거나, 본인인증 + 확인된 받을 계좌가 있는 개인이어야 한다 (v10.28 INV-10R)", "AMENDED", "소개"]''')

# ══ 2-2 정산 — 개인 회원(본인인증)도 소개비를 받음 · 받을 계좌는 정산을 신청할 때 확인 ══════════════
rep('''function scMyStl(){
  const rows = D.my.settle, b = D.my.bank;
  const sum = rows.reduce((a,x)=>a+x.fee,0);
  return myShell("mystl","정산 신청",
    "성사가 확정된 건만 신청할 수 있습니다 (INV-3). 소개비에서 떼는 금액은 없습니다 (INV-9).",
    note("ok","<b>공제 0 — 소개비 전액이 그대로 들어옵니다.</b> 회원은 전원 사업자라 원천징수 경로가 없고(B-03), "+
      "세금계산서는 소개자가 직접 발행합니다. 부가세 10%는 별도로 청구합니다.")+''',
'''/* v10.28 (작업 지시서 5절 · D040 · INV-10R · 10/9 「진행」) — 본인인증 회원이면 소개비를 받습니다.
 *   사업자 인증이 있으면 사업자로(INV-10 · 세금계산서), 없으면 개인으로 받고 개인은 **정산을 신청할 때** 받을 계좌(본인 명의 · 1원 확인)를 확인합니다.
 *   소개비는 당사자끼리 직접 지급합니다(INV-11). 소개비 기능은 연동 뒤 운영자가 켭니다 — 꺼져 있으면 맨 위에 적습니다.
 *   위의 「개인 회원 · 사업자 회원」은 시안에서 두 모습을 보여 드리는 단추입니다(실제 웹은 회원에 따라 하나만). */
function scMyStl(){
  const rows = D.my.settle, b = D.my.bank, st = S();
  const v = st.stlv || "person", person = v === "person";
  const pa = st.stlAcct || null;           /* 시연 — 개인의 받을 계좌 */
  const sum = rows.reduce((a,x)=>a+x.fee,0);
  return myShell("mystl","정산 · 소개비 받기",
    "본인인증 회원이면 소개비를 받습니다. 성사가 확정된 건만 신청할 수 있고 (INV-3) 소개비에서 떼는 금액은 없습니다 (INV-9).",
    tabs("stlv",[["person","개인 회원(본인인증)",""],["biz","사업자 회원",""]], v)+
    note("warn","<b>소개비 기능은 아직 열리지 않았습니다</b> — 본인인증 · 계좌 확인 연동을 마친 뒤 운영자가 엽니다(운영 설정 feature.referral_fee). "+
      "그 전에는 거래가 성사돼도 정산이 생기지 않습니다. 아래는 켠 뒤의 모습입니다.")+
    '<div data-stl-view="'+e(v)+'">'+
    (person
      ? note("info","<b>개인으로 받습니다</b> — 정산을 신청할 때 <b>본인 명의 받을 계좌</b>를 확인합니다. 사업자 인증을 하시면 사업자로 받습니다. "+
          "<b>소개비는 거래 당사자가 직접 지급합니다</b> — 소개뱅크는 소개비를 대신 받거나 보내지 않습니다.")+
        '<div class="card pad" data-payout-box="1" style="margin:10px 0"><b>받을 계좌</b> '+
          (pa ? '<span>'+e(pa.bank)+' ****'+e(pa.last4)+' · '+e(pa.holder)+'</span> '+(pa.ok?'<span class="bg ok">확인 간주(연동 전)</span>':'<span class="bg wait">확인 전</span>')
              : '<span class="ls">아직 없습니다</span>')+
          '<div class="ls" style="margin:6px 0">본인 명의 계좌로 1원을 보내 확인합니다. 화면에는 뒤 4자리만 보입니다. 연동 전에는 확인한 것으로 간주합니다(오픈 차단 항목).</div>'+
          (!pa ? '<div class="hbtn"><button class="bp sm" data-stl-acct="add">계좌 등록 · 1원 보내기</button></div>'
               : !pa.ok ? '<div class="hbtn"><span class="ls">입금자명 코드</span> <button class="bp sm" data-stl-acct="verify">SGB01 확인</button></div>' : '')+
        '</div>'
      : note("ok","<b>사업자로 받습니다</b> — 공제 0, 소개비 전액이 그대로 들어옵니다. 세금계산서는 소개자가 직접 발행합니다. 부가세 10%는 별도로 청구합니다."))+
    note("info","<b>세금</b> — 소개비는 받는 분의 소득이므로 세금 신고는 받는 분이 하십니다. 소개뱅크는 소개비를 지급하지 않아 원천징수하지 않습니다.")+''')
rep('''      '<div class="bank"><span>입금 계좌</span><b>'+e(b.bank)+' '+e(b.no)+' · '+e(b.holder)+'</b>'+
        (b.verified?'<span class="bg ok">실명 확인됨</span>':'<span class="bg no">확인 대기</span>')+'</div>'+
      '<div class="dact"><button class="bp" data-t="신청 → REQUESTED → 관리자 승인 → PAID. 동일 거래는 1회만 신청됩니다.">정산 신청</button>'+''',
'''      (person ? '' : '<div class="bank"><span>입금 계좌</span><b>'+e(b.bank)+' '+e(b.no)+' · '+e(b.holder)+'</b>'+
        (b.verified?'<span class="bg ok">실명 확인됨</span>':'<span class="bg no">확인 대기</span>')+'</div>')+
      '<div class="dact">'+(person
        ? (pa && pa.ok ? '<button class="bp" data-stl-claim="'+e(x.id)+'">소개비 받기</button>'
                       : '<button class="bp off" data-stl-claim="'+e(x.id)+'" title="받을 계좌를 먼저 확인해 주십시오">소개비 받기</button><span class="ls">받을 계좌 확인이 먼저입니다</span>')
        : '<button class="bp" data-t="신청 → REQUESTED → 관리자 승인 → PAID. 동일 거래는 1회만 신청됩니다.">정산 신청</button>')+''')
rep('''      : empty("신청 가능한 건이 없습니다. 성사가 확정되면 여기에 나타납니다."))+
    (rows.length ? note("info","신청 대기 <b>"+rows.length+"건 · 소개비 합계 "+won(sum)+"</b>") : "")
  );
}''', '''      : empty("신청 가능한 건이 없습니다. 성사가 확정되면 여기에 나타납니다."))+
    (rows.length ? note("info","신청 대기 <b>"+rows.length+"건 · 소개비 합계 "+won(sum)+"</b>") : "")+
    (st.stlMsg ? note(st.stlMsgK || "ok", e(st.stlMsg)) : "")+'</div>'
  );
}
/* v10.28 — 정산 화면의 시연 단추(받을 계좌 등록 · 확인 · 소개비 받기) */
document.addEventListener("click", function(ev){
  const t = ev.target.closest("[data-stl-acct],[data-stl-claim]");
  if (!t) return;
  ev.preventDefault();
  const st = S();
  if (t.hasAttribute("data-stl-acct")) {
    if (t.getAttribute("data-stl-acct") === "add") { st.stlAcct = { bank:"신한은행", last4:"4821", holder:"김소개", ok:false }; st.stlMsg = "연동 전이라 실제로 1원이 보내지지 않았습니다 — 코드는 SGB01 입니다(시연)."; st.stlMsgK = "info"; }
    else if (st.stlAcct) { st.stlAcct.ok = true; st.stlMsg = "받을 계좌를 확인했습니다(연동 전 — 확인 간주)."; st.stlMsgK = "ok"; }
  } else {
    if (!(st.stlAcct && st.stlAcct.ok)) { st.stlMsg = "소개비를 받을 계좌를 등록 · 확인해 주십시오. 본인 명의 계좌로 1원을 보내 확인합니다. (409 ACCOUNT_REQUIRED)"; st.stlMsgK = "warn"; }
    else { st.stlMsg = "정산을 신청했습니다 — 개인으로 받음 · 받을 계좌는 연동 전이라 확인한 것으로 간주했습니다."; st.stlMsgK = "ok"; }
  }
  U.render();
});''')

# ══ 2-3 상담 신청 — 이메일(필수 · 형식 검사) · 동의 문구(처리방침 제4조 ③과 같은 항목) ═════════════
rep('''        '<button class="bo sm" data-csl-otp="1">' + (st.cslOtp ? "확인됨 (시연)" : "인증번호 받기") + '</button></span></label>' +''',
    '''        '<button class="bo sm" data-csl-otp="1">' + (st.cslOtp ? "확인됨 (시연)" : "인증번호 받기") + '</button></span></label>' +
      /* v10.28 (지시서 4절) — 이메일 필수 · 확인 번호를 보내는 데 쓰고 상담을 맡는 업체에도 전달(업체가 연락처를 열 때) */
      '<label>이메일<input class="inp" id="csl-mail" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" maxlength="120" value="' + e(v.mail || "") + '"></label>' +''')
rep('''        '<span><b>개인정보 제3자 제공에 동의합니다.</b> 이름 · 휴대폰 · 지역 · 상담 내용을 이 업종의 인증업체 1곳에 제공합니다. ' +''',
    '''        '<span><b>개인정보 제3자 제공에 동의합니다.</b> 이름 · 휴대폰 번호 · 이메일 · 지역 · 상담 내용을 이 업종의 인증업체 1곳에 제공합니다. ' +''')
rep('''    st.cslForm = { name: val("csl-name"), tel: val("csl-tel"), area: val("csl-area"), memo: val("csl-memo"), agree: val("csl-agree") };''',
    '''    st.cslForm = { name: val("csl-name"), tel: val("csl-tel"), mail: val("csl-mail"), area: val("csl-area"), memo: val("csl-memo"), agree: val("csl-agree") };   /* v10.28 이메일 */''')
rep('''      : !st.cslOtp ? "휴대폰 확인을 먼저 해 주십시오."''',
    '''      : !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(f.mail || "") ? "이메일을 확인해 주십시오 (예: name@example.com)."
      : !st.cslOtp ? "휴대폰 확인을 먼저 해 주십시오."''')
rep('''        '<li class="on"><span class="n">1</span><div><b>상담 신청</b><p>이름 · 휴대폰 · 지역을 적습니다. 로그인하지 않아도 됩니다.</p></div></li>' +''',
    '''        '<li class="on"><span class="n">1</span><div><b>상담 신청</b><p>이름 · 휴대폰 · 이메일 · 지역을 적습니다. 로그인하지 않아도 됩니다.</p></div></li>' +''')
rep('''<p>상담 요약이 그 업체에 가고, 이름 · 휴대폰은 그 업체가 연락처를 열 때 전달됩니다.</p>''',
    '''<p>상담 요약이 그 업체에 가고, 이름 · 휴대폰 · 이메일은 그 업체가 연락처를 열 때 전달됩니다.</p>''')

# ══ 2-4 파트너센터 상담 신청 — 연 연락처에 이메일(열람 기록) ═════════════════════════════════
rep('''        ? '<button class="bp sm" data-t="열면 리드 이용료에서 확인비용이 빠집니다 — 보너스 잔액부터 차감됩니다.">연락처 열기</button>\'''',
    '''        ? '<button class="bp sm" data-t="열면 리드 이용료에서 확인비용이 빠집니다 — 보너스 잔액부터 차감됩니다. 이름 · 휴대폰 · 이메일이 보이고 열람 기록이 남습니다.">연락처 열기</button>\'''')
rep('''        (x.why ?'<div class="wn">반려 사유 — '+e(x.why)+'</div>':'')+'</div>'+
      '<div class="lstat"><span>확인비용 <b>'+won(x.fee)+'</b></span></div>'+''',
    '''        (x.why ?'<div class="wn">반려 사유 — '+e(x.why)+'</div>':'')+
        /* v10.28 (지시서 4절) — 연 상담에는 이메일도(열기 전 요약에는 없음 · 열람 기록 남음) */
        (x.st==="확인 완료"?'<div class="ls" data-contact-email="1">연락처 — '+e(x.who)+' · 010-****-'+e(String(x.id).replace(/\\D/g,"").slice(-4).padStart(4,"0"))+' · <a href="mailto:sample@example.com">sample@example.com</a> <span class="ck">열람 기록 남음</span></div>':'')+'</div>'+
      '<div class="lstat"><span>확인비용 <b>'+won(x.fee)+'</b></span></div>'+''')

# ══ 2-5 운영 — 소개몰 주문(발송 처리) · 소개몰 리뷰 · 문의 ═══════════════════════════════════════
rep('''/* ── 소개몰 상품 (SB-ADM-HPR-010) · v10.26 ─────────────────────────────''',
'''/* ── 소개몰 주문 (SB-ADM-HOR-010) · v10.28 ─────────────────────────────
 * 결제 완료 주문에 택배사(고르기) · 송장번호(숫자 10 ~ 14자리)를 넣고 「발송 처리」 → 배송중 · 「배송 완료로」 · 배송중일 때만 송장 고침.
 * 택배사 연동은 계약 뒤(10/9 「권장대로」) — 운영자가 직접 넣습니다. 모든 처리는 감사 기록. 배송 완료 7일 뒤 자동 구매확정(하루 1회).
 * 실제 웹: 운영 화면(web) 탭 「소개몰 주문」(HealthOrders.tsx). */
const HOR_CARRIERS = ["CJ대한통운","한진택배","롯데택배","우체국택배","로젠택배"];
function scAdmHor(){
  const st = S(), f = st.horf || "PAID";
  const R = st.horRows || (st.horRows = [
    { no:"H26100900012", who:"김○○", item:"비타민C 1000 · 3개월", at:"10-09 09:12", s:"PAID" },
    { no:"H26100900018", who:"이○○", item:"오메가3 · 단품", at:"10-09 10:40", s:"PAID" },
    { no:"H26100800231", who:"박○○", item:"유산균 · 1개월", at:"10-08 15:02", s:"SHIPPED", carrier:"CJ대한통운", track:"623600000001" },
    { no:"H26100600107", who:"최○○", item:"마그네슘 · 3개월", at:"10-06 11:20", s:"DELIVERED", carrier:"우체국택배", track:"6091234567890", due:"10-14" }]);
  const LB = { PAID:"발송할 것", SHIPPED:"배송중", DELIVERED:"배송 완료" };
  const rows = R.filter(x => x.s === f);
  return admShell("admhst","소개몰 주문",
    "결제 완료 주문의 발송을 처리합니다 — 택배사 · 송장번호를 넣으면 배송중, 「배송 완료로」를 누르면 배송 완료. <b>SB-ADM-HOR-010</b>",
    '<div class="tabs2">'+["PAID","SHIPPED","DELIVERED"].map(k=>'<button class="tb'+(k===f?" on":"")+'" data-x="horf" data-xv="'+k+'">'+LB[k]+'<i>'+R.filter(x=>x.s===k).length+'</i></button>').join("")+'</div>'+
    (rows.length ? table(["주문","받는 분 · 상품","결제","택배사 · 송장","처리"], rows.map(x=>[
      '<b class="code">'+e(x.no)+'</b>', e(x.who)+'<div class="ls">'+e(x.item)+'</div>', e(x.at),
      x.s==="PAID" ? '<select class="inp" data-hor-carrier="'+e(x.no)+'">'+HOR_CARRIERS.map(c=>'<option>'+e(c)+'</option>').join("")+'</select> '+
                     '<input class="inp" data-hor-track="'+e(x.no)+'" inputmode="numeric" placeholder="숫자 10 ~ 14자리" style="width:150px">'
                   : e(x.carrier)+' <span class="code">'+e(x.track)+'</span>'+(x.due?'<div class="ls">자동 구매확정 '+e(x.due)+'</div>':''),
      x.s==="PAID" ? '<button class="bp sm" data-hor="ship" data-no="'+e(x.no)+'">발송 처리</button>'
      : x.s==="SHIPPED" ? '<button class="bp sm" data-hor="deliver" data-no="'+e(x.no)+'">배송 완료로</button> <button class="bo sm" data-hor="fix" data-no="'+e(x.no)+'" data-t="배송중일 때만 송장을 고칩니다 — 새 기록으로 더하고 전 기록은 남습니다(감사 기록).">송장 고침</button>'
      : '<span class="ls">배송 완료 7일 뒤 자동 구매확정</span>'])) : empty("해당하는 주문이 없습니다."))+
    (st.horMsg ? note(st.horMsgK || "ok", e(st.horMsg)) : "")+
    note("info","<b>택배사 연동은 계약 뒤입니다.</b> 지금은 운영자가 송장을 직접 넣고 배송 단계를 바꿉니다. 구매자의 배송 조회에는 넣은 택배사 · 송장이 그대로 보입니다.")+
    note("warn","<b>송장은 배송중일 때만 고칩니다.</b> 배송 완료 날이 구매확정 · 반품 기한의 기준이라, 완료 뒤에는 고치지 않습니다.")+
    '<div class="hbtn"><button class="bs" data-go="admhrv">소개몰 리뷰 · 문의 →</button><button class="bs" data-go="admhst">소개몰 정산 →</button></div>');
}
document.addEventListener("click", function(ev){
  const t = ev.target.closest("[data-hor]");
  if (!t || t.hasAttribute("data-t")) return;
  ev.preventDefault();
  const st = S(), no = t.getAttribute("data-no"), x = (st.horRows || []).filter(r => r.no === no)[0];
  if (!x) return;
  if (t.getAttribute("data-hor") === "ship") {
    const tr = (document.querySelector('[data-hor-track="'+no+'"]') || {}).value || "", ca = (document.querySelector('[data-hor-carrier="'+no+'"]') || {}).value;
    if (!/^[0-9]{10,14}$/.test(tr.trim())) { st.horMsg = "송장번호는 숫자 10 ~ 14자리입니다."; st.horMsgK = "warn"; }
    else { x.s = "SHIPPED"; x.carrier = ca; x.track = tr.trim(); st.horMsg = no + " — 발송 처리했습니다(배송중 · 감사 기록)."; st.horMsgK = "ok"; }
  } else if (t.getAttribute("data-hor") === "deliver") { x.s = "DELIVERED"; x.due = "7일 뒤"; st.horMsg = no + " — 배송 완료로 바꿨습니다. 7일 뒤 자동 구매확정됩니다."; st.horMsgK = "ok"; }
  U.render();
});

/* ── 소개몰 리뷰 · 문의 (SB-ADM-HRV-010) · v10.28 ─────────────────────────
 * 리뷰는 바로 보이고, 효능 · 효과를 단정하는 표현(금칙어)에 걸린 것만 「확인 대기」로 와서 운영자가 보이게 하거나 가립니다(지우지 않음 · 사유를 쓴 분에게 알림).
 * 상품 문의는 운영자가 답합니다(답하면 쓴 분에게 알림). 비공개 문의도 운영자는 봅니다. 실제 웹: 운영 화면 탭 「소개몰 리뷰 · 문의」(HealthReviews.tsx). */
function scAdmHrv(){
  const st = S(), sub = st.hrvsub || "reviews";
  const RV = [
    { p:"비타민C 1000", star:5, body:"감기에 안 걸리게 해 주는 최고의 약이에요. 매일 먹습니다.", hold:"감기에 안 걸리", who:"김○○", s:"PENDING" },
    { p:"오메가3", star:4, body:"알이 작아서 삼키기 편하고 비린 맛이 거의 없어요.", hold:"", who:"이○○", s:"VISIBLE" },
    { p:"유산균", star:2, body:"배송이 늦었어요. 포장은 괜찮았습니다.", hold:"", who:"박○○", s:"HIDDEN", why:"주문과 관계없는 광고 글" }];
  const QN = [
    { p:"마그네슘", q:"하루 몇 알 먹으면 되나요?", priv:false, who:"최○○", a:"" },
    { p:"비타민D", q:"임신 중에 먹어도 되나요?", priv:true, who:"정○○", a:"" },
    { p:"오메가3", q:"유통기한이 얼마나 남았나요?", priv:false, who:"한○○", a:"받으시는 날 기준 12개월 이상 남은 상품을 보내 드립니다." }];
  const rf = st.hrvf || "PENDING", qf = st.hqnf || "open";
  return admShell("admhst","소개몰 리뷰 · 문의",
    "리뷰는 바로 보이고, 효능 · 효과를 단정하는 표현에 걸린 것만 여기서 확인합니다. 상품 문의는 운영자가 답합니다. <b>SB-ADM-HRV-010</b>",
    tabs("hrvsub",[["reviews","리뷰",""],["qna","상품 문의",""]], sub)+
    (sub === "reviews"
      ? tabs("hrvf",[["PENDING","확인 대기",RV.filter(x=>x.s==="PENDING").length],["VISIBLE","보이는 리뷰",""],["HIDDEN","가린 리뷰",""]], rf)+
        table(["상품","별점","글","쓴 분","처리"], RV.filter(x=>x.s===rf).map(x=>[e(x.p), "★".repeat(x.star),
          e(x.body)+(x.hold?'<div class="wn">걸린 말: 「'+e(x.hold)+'」</div>':'')+(x.why?'<div class="ls">가린 사유: '+e(x.why)+'</div>':''), e(x.who),
          (x.s!=="VISIBLE"?'<button class="bp sm" data-t="보이게 했습니다 — 상품 리뷰 목록에 나옵니다(감사 기록).">보이기</button> ':'')+
          (x.s!=="HIDDEN"?'<button class="bo sm" data-t="가렸습니다 — 지우지 않습니다. 쓴 분에게 사유를 알립니다(HLT_REVIEW_HIDDEN).">가리기</button>':'')]))+
        note("info","<b>운영자는 리뷰를 지우지 않고 가립니다.</b> 가리면 쓴 분에게 사유를 알립니다. 고치기 · 지우기는 쓴 분만 합니다.")
      : tabs("hqnf",[["open","답할 문의",QN.filter(x=>!x.a).length],["done","답한 문의",""]], qf)+
        table(["상품","문의","쓴 분","답"], QN.filter(x=>qf==="open"?!x.a:!!x.a).map(x=>[e(x.p), (x.priv?'<b>🔒 비공개 · </b>':'')+e(x.q), e(x.who),
          (x.a?'<div class="ls">지금 답: '+e(x.a)+'</div>':'')+'<button class="bp sm" data-t="답했습니다 — 쓴 분에게 알림이 갑니다(HLT_QNA_ANSWERED).">'+(x.a?'답 고치기':'답하기')+'</button> '+
          '<button class="bo sm" data-t="가렸습니다 — 상품 문의 목록에서 빠집니다.">가리기</button>']))+
        note("info","<b>비공개 문의는 쓴 분과 운영자만 봅니다.</b> 문의는 본인인증 회원이 씁니다."))+
    '<div class="hbtn"><button class="bs" data-go="admhor">← 소개몰 주문</button></div>');
}

/* ── 약관 동의 · 재동의 (SB-HOM-ETC-022) · v10.28 ──────────────────────────
 * 필수 약관의 새 판이 발행됐거나(약관 한 벌 · D041) 약관 발행 전에 가입해 동의한 적이 없는 회원은 로그인 직후, 그리고 로그인이 필요한 화면을 열 때 여기로 옵니다.
 * 둘러보기 · 약관 보기 · 로그아웃은 그대로 됩니다(10/9 「권장대로」). 선택 약관은 지금 상태 그대로 — 바꾸려면 아래 「선택 항목 바꾸기」(G-214).
 * 실제 웹: /terms/agree?next=… (미들웨어 · 로그인 처리) */
function scTrmAgr(){
  const st = S(), done = !!st.trmDone;
  const CH = [["이용약관","1.1","1.2","개인도 가입(만 19세 이상) · 확인 단계별로 열리는 기능 표 · 본인인증 회원도 소개비 받기 · 정산을 신청할 때 받을 계좌 확인"],
              ["개인정보처리방침","1.0","1.1","가입 때 필수 항목은 이름 · 연락처 · 이메일만 · 상담 신청 정보(이메일 포함) · 인증업체 1곳 전달 · 방문자 쿠키 · 보호책임자 전화"],
              ["구독 환불 정책","1.0","1.1","「리드를 열람」 → 「요청 · 상담 신청을 열람」"],
              ["제3자 제공 동의 (회원 간)","1.1","1.2","「사업자끼리」 → 「회원끼리」 · 상담 신청은 따로 동의 · 「소개광장 · 소개몰」"]];
  const OPT = [["MARKETING","마케팅 수신 동의",true],["ADPERSONAL","맞춤형 광고 동의",false],["MARKETING_NIGHT","야간 광고 수신 동의",false]];
  return H({login:true})+'<div class="wrap" data-screen="SB-HOM-ETC-022">'+page("약관 동의",
    done ? "필수 약관에 모두 동의하셨습니다." : "동의가 필요한 필수 약관이 "+CH.length+"건 있습니다. <b>SB-HOM-ETC-022</b>")+
    (done ? note("ok","<b>동의를 저장했습니다.</b> 가려던 화면으로 이어집니다(시연 — 나의공간).")+'<div class="hbtn"><button class="bp" data-go="my">나의공간으로</button></div>'
      : note("warn","<b>약관이 바뀌었습니다</b> — 필수 약관에 동의하셔야 로그인이 필요한 기능을 쓰실 수 있습니다. 둘러보기 · 약관 보기 · 로그아웃은 그대로 됩니다. 선택 항목은 지금 상태 그대로입니다.")+
        '<div data-reconsent-table="1">'+table(["약관","동의하신 판","지금 판","바뀐 점"], CH.map(x=>[e(x[0]), e(x[1]), '<b>'+e(x[2])+'</b>', e(x[3])]))+'</div>'+
        '<h2 class="s2">필수</h2>'+CH.map(x=>'<label class="chk"><input type="checkbox" checked> <b>[필수]</b> '+e(x[0])+' <a href="#" data-go="guide" class="lnk">전문 보기</a></label>').join("<br>")+
        '<div class="hbtn" style="margin-top:12px"><button class="bp" data-trm-agree="1">동의하고 계속</button></div>')+
    '<h2 class="s2">선택 항목 바꾸기</h2>'+
    table(["항목","지금 상태","",""], OPT.map(o=>{ const on = (st.trmOpt||{})[o[0]] !== undefined ? st.trmOpt[o[0]] : o[2];
      return [e(o[1]), on?'<span class="bg ok">동의</span>':'<span class="bg">동의 안 함</span>',
        '<button class="bo sm" data-trm-opt="'+e(o[0])+'">'+(on?'동의 철회':'동의하기')+'</button>', '<span class="ls">바꿀 때마다 기록 한 줄(지우거나 고치지 않음)</span>']; }))+
    note("info","<b>동의 시각이 기록됩니다.</b> 광고 · 알림은 가장 최근 기록을 따릅니다. 필수 약관은 끌 수 없습니다(탈퇴로만).")+
    '</div>'+F();
}
document.addEventListener("click", function(ev){
  const t = ev.target.closest("[data-trm-agree],[data-trm-opt]");
  if (!t) return;
  ev.preventDefault();
  const st = S();
  if (t.hasAttribute("data-trm-agree")) st.trmDone = true;
  else { st.trmOpt = st.trmOpt || {}; const k = t.getAttribute("data-trm-opt"); const def = k === "MARKETING"; st.trmOpt[k] = !((st.trmOpt[k] !== undefined) ? st.trmOpt[k] : def); }
  U.render();
});

/* ── 소개몰 상품 (SB-ADM-HPR-010) · v10.26 ─────────────────────────────''')
rep('''  admadb:scAdmAdb, admcol:scAdmCol, admhst:scAdmHst, admhpr:scAdmHpr,''',
    '''  admadb:scAdmAdb, admcol:scAdmCol, admhst:scAdmHst, admhpr:scAdmHpr,
  admhor:scAdmHor, admhrv:scAdmHrv, trmagr:scTrmAgr,   /* v10.28 */''')
rep('''  admhst: M("SB-ADM-HST-010",''',
    '''  admhor: M("SB-ADM-HOR-010","sogaebaenk.co.kr/admin/health/orders","운영","소개몰 주문 — 결제 완료 주문에 택배사 · 송장번호를 넣고 발송 처리 · 배송 완료로 · 배송중일 때만 송장 고침 · 감사 기록(v10.28)."),
  admhrv: M("SB-ADM-HRV-010","sogaebaenk.co.kr/admin/health/reviews","운영","소개몰 리뷰 · 문의 — 금칙어에 걸린 리뷰 확인(보이기 · 가리기 · 지우지 않음) · 상품 문의에 답하기(v10.28)."),
  trmagr: M("SB-HOM-ETC-022","sogaebaenk.co.kr/terms/agree","전역","약관 동의 · 재동의 — 필수 약관의 새 판 · 동의한 적 없는 회원은 로그인 직후 · 로그인이 필요한 화면에서 여기로. 바뀐 점 표 · 선택 항목 바꾸기(v10.28)."),
  admhst: M("SB-ADM-HST-010",''')
rep('''  { re:/^\\/admin\\/health\\/settlements\\/?$/, screen:"admhst", title:"소개몰 정산",''',
    '''  /* v10.28 */
  { re:/^\\/admin\\/health\\/orders\\/?$/, screen:"admhor", title:"소개몰 주문", desc:"발송 처리 · 배송 완료 · 송장 고침." },
  { re:/^\\/admin\\/health\\/reviews\\/?$/, screen:"admhrv", title:"소개몰 리뷰 · 문의", desc:"금칙어 리뷰 확인 · 문의 답하기." },
  { re:/^\\/terms\\/agree\\/?$/, screen:"trmagr", title:"약관 동의", desc:"필수 약관 동의 · 재동의 · 선택 항목 바꾸기." },
  { re:/^\\/admin\\/health\\/settlements\\/?$/, screen:"admhst", title:"소개몰 정산",''')
rep('''  safgd:"/safety/guide", bpolsrc:"/policy/9301/source", adland:"/ad/AD-110", admptnd:"/admin/partners/P-1041",''',
    '''  safgd:"/safety/guide", bpolsrc:"/policy/9301/source", adland:"/ad/AD-110", admptnd:"/admin/partners/P-1041",
  admhor:"/admin/health/orders", admhrv:"/admin/health/reviews", trmagr:"/terms/agree",   /* v10.28 */''')
rep('''     ["admrev3","자동검수 규칙"],["admrev4","표본 감사"],["admsit8","외부 연동 관리"],["admcod","코드 라벨"],["admbdg","배지 신청 검수"],["admbil","청구 현황"]]''',
    '''     ["admrev3","자동검수 규칙"],["admrev4","표본 감사"],["admsit8","외부 연동 관리"],["admcod","코드 라벨"],["admbdg","배지 신청 검수"],["admbil","청구 현황"],
     ["admhor","소개몰 주문 · 발송"],["admhrv","소개몰 리뷰 · 문의"],["admhst","소개몰 정산"],["admhpr","소개몰 상품"]]   /* v10.28 — 소개몰 운영 4화면 */''')
rep('''  + '<div class="hbtn" style="margin-top:16px">'
  + '<button class="bp">이번 주 마감</button>'
  + '<button class="bs">정산서 내려받기</button></div>\'''',
    '''  + '<div class="hbtn" style="margin-top:16px">'
  + '<button class="bp">이번 주 마감</button>'
  + '<button class="bs">정산서 내려받기</button>'
  + '<button class="bs" data-go="admhor">소개몰 주문 · 발송</button>'   /* v10.28 */
  + '<button class="bs" data-go="admhrv">소개몰 리뷰 · 문의</button></div>\'''')

# ══ 2-9 위탁은 「알림」(G-218 · 10/9 답 「알림으로」 · D042) — 동의 받는 항목이 아니라 맡기는 곳 · 일을 알리는 안내(개인정보 보호법 제26조) ══
rep('''["개인정보 처리업무 위탁", "발행 · 2026-10-01 시행"]''',
    '''["개인정보 처리업무 위탁 안내", "발행 · 알림(동의 받지 않음)"]''')
rep('''  "개인정보 처리업무 위탁": ["결제 · 본인인증 · 알림 발송 위탁처", "위탁 범위"],''',
    '''  "개인정보 처리업무 위탁 안내": ["알림 — 동의를 받는 항목이 아님(개인정보 보호법 제26조 · 공개)", "결제 · 본인인증 · 알림 발송 위탁처", "위탁 범위 · 바뀌면 이 안내를 고쳐 미리 알림"],   /* v10.28 G-218 */''')
rep('''    note("info","<b>동의 시각이 기록됩니다.</b> 광고 · 알림은 가장 최근 기록을 따릅니다. 필수 약관은 끌 수 없습니다(탈퇴로만).")+''',
    '''    note("info","<b>동의 시각이 기록됩니다.</b> 광고 · 알림은 가장 최근 기록을 따릅니다. 필수 약관은 끌 수 없습니다(탈퇴로만).")+
    /* v10.28 (G-218) — 위탁은 동의 칸이 아니라 알림 링크 한 줄 */
    '<p class="ls" data-notice-terms="1"><b>알림</b> <a href="#" class="lnk" data-go="termsv">개인정보 처리업무 위탁 안내</a> — 동의를 받는 항목이 아니라 알려 드리는 안내입니다. 따로 고르실 것이 없습니다.</p>'+''')
rep('''        '<div class="jc i" style="margin-top:10px"><span class="lb">약관 전문</span>'+
        '「보기 ›」를 누르면 약관 전문이 열립니다. 필수 항목에 모두 동의해야 다음으로 넘어갑니다.</div></div>';   /* v10.27 G-199 · G-200 */''',
    '''        '<div class="jc i" style="margin-top:10px"><span class="lb">약관 전문</span>'+
        '「보기 ›」를 누르면 약관 전문이 열립니다. 필수 항목에 모두 동의해야 다음으로 넘어갑니다.</div>'+   /* v10.27 G-199 · G-200 */
        '<div class="jc i" style="margin-top:10px" data-notice-terms="1"><span class="lb">알림</span>'+
        '<b>개인정보 처리업무 위탁 안내</b> — 동의를 받는 항목이 아니라 맡기는 곳 · 일을 알려 드리는 안내입니다(따로 고르실 것 없음). <span class="vw" data-go="termsv">보기 ›</span></div></div>';   /* v10.28 G-218 */''')
