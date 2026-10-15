# v10.27 시안 결함 G-196 ~ G-200 — proto_patch_1027.py 가 exec 로 불러 씁니다(같은 s · rep 를 씀).
# ── G-196 알림 — 머리줄 종 · 나의공간 「설정 · 알림」 → 알림 센터(myntf) ──────────────────────
rep('''    return '<span class="bell" data-t="알림 정책(G-03) 확정 후 활성화됩니다.">🔔'+''',
    '''    return '<span class="bell" data-go="myntf" role="button" tabindex="0" title="알림 센터">🔔'+   /* v10.27 G-196 */''')
rep('''    '<a href="#" data-t="알림 정책(G-03)이 확정되면 붙입니다.">설정 · 알림</a></aside>';''',
    '''    '<a href="#" data-go="myntf">설정 · 알림</a></aside>';   /* v10.27 G-196 */''')

# ── G-198 주소가 없던 화면 — 주소 표(ROUTES · TO_PATH)에 더함 ─────────────────────────────
rep('''  /* ── 1:1 문의 · 챗봇 ── */
  { re:/^\\/ask\\/list\\/?$/,''', '''  /* ── v10.27 (G-198) 어느 단추로도 · 주소로도 열리지 않던 화면 ── */
  { re:/^\\/my\\/payment\\/?$/,        screen:"mypaym",  title:"결제 수단", desc:"정기결제에 쓰는 카드입니다." },
  { re:/^\\/my\\/notifications\\/?$/,  screen:"myntf",   title:"알림 센터", desc:"거래 · 정산 · 검수 소식." },
  { re:/^\\/my\\/subscription\\/upgrade\\/?$/, screen:"mysubup", title:"한도 안내 · 요금제", desc:"한도를 넘었을 때 요금제를 고르는 자리입니다." },
  { re:/^\\/my\\/business\\/?$/,       screen:"mybiz2",  title:"사업자 전환", desc:"소개비를 받으려면 사업자 인증이 필요합니다." },
  { re:/^\\/my\\/intro\\/invite\\/?$/, screen:"introinv", title:"초대 보내기", desc:"아는 사람을 소개뱅크에 초대합니다." },
  { re:/^\\/my\\/intro\\/activity\\/?$/, screen:"introact", title:"소개 활동 · 포인트", desc:"내가 한 소개와 받은 포인트." },
  { re:/^\\/my\\/intro\\/?$/,          screen:"introhome", title:"소개자 홈", desc:"소개 활동을 한눈에 봅니다." },
  { re:/^\\/deal\\/(\\d+)\\/review\\/?$/, screen:"rvw",    title:"후기 작성", desc:"성사된 거래의 후기를 남깁니다." },
  { re:/^\\/admin\\/main\\/banner\\/?$/,  screen:"admmain1", title:"메인 운영 · 배너 · 광고", desc:"메인 배너와 광고 자리." },
  { re:/^\\/admin\\/main\\/gwan\\/?$/,    screen:"admmain2", title:"메인 운영 · 관 노출", desc:"메인에 보일 관과 순서." },
  { re:/^\\/admin\\/main\\/layout\\/?$/,  screen:"admmain3", title:"메인 운영 · 화면 구성", desc:"메인의 구역 순서." },
  { re:/^\\/admin\\/main\\/content\\/?$/, screen:"admmain4", title:"메인 운영 · 콘텐츠", desc:"메인 글 · 공지." },
  { re:/^\\/admin\\/review\\/rules\\/?$/, screen:"admrev3", title:"자동검수 규칙", desc:"자동 승인 · 보류 규칙." },
  { re:/^\\/admin\\/review\\/audit\\/?$/, screen:"admrev4", title:"표본 감사", desc:"자동 승인 건을 표본으로 다시 봅니다." },
  { re:/^\\/admin\\/site-integrations\\/?$/, screen:"admsit8", title:"외부 연동 관리", desc:"국세청 · 결제 · 본인인증 연동 상태." },
  { re:/^\\/admin\\/codes\\/?$/,       screen:"admcod",  title:"코드 라벨", desc:"상태 코드의 화면 글." },
  { re:/^\\/admin\\/badges\\/?$/,      screen:"admbdg",  title:"배지 신청 검수", desc:"서류 확인 배지 신청." },
  { re:/^\\/admin\\/billing\\/?$/,     screen:"admbil",  title:"청구 현황", desc:"정기결제 · 연체 · 재시도." },
  { re:/^\\/terms\\/?$/,               screen:"termsv",  title:"약관 전문", desc:"발행된 약관과 시행일." },

  /* ── 1:1 문의 · 챗봇 ── */
  { re:/^\\/ask\\/list\\/?$/,''')
rep('''  brkapp:"/broker/apply", brkmy:"/broker/status",''', '''  brkapp:"/broker/apply", brkmy:"/broker/status",
  /* v10.27 (G-198) */
  mypaym:"/my/payment", myntf:"/my/notifications", mysubup:"/my/subscription/upgrade", mybiz2:"/my/business",
  introhome:"/my/intro", introinv:"/my/intro/invite", introact:"/my/intro/activity", rvw:"/deal/7710/review",
  admmain1:"/admin/main/banner", admmain2:"/admin/main/gwan", admmain3:"/admin/main/layout", admmain4:"/admin/main/content",
  admrev3:"/admin/review/rules", admrev4:"/admin/review/audit", admsit8:"/admin/site-integrations",
  admcod:"/admin/codes", admbdg:"/admin/badges", admbil:"/admin/billing", termsv:"/terms",''')
# 운영 대시보드 아래 — 다른 운영 화면으로 가는 단추
rep('''    note("warn","<b>이 숫자는 가정치입니다.</b> "+e(r.note)));''',
    '''    note("warn","<b>이 숫자는 가정치입니다.</b> "+e(r.note))+
    /* v10.27 (G-198) — 위 메뉴 줄에 없는 운영 화면. 전에는 어느 단추로도 열 수 없었습니다 */
    '<h2 class="s2">다른 운영 화면</h2><div class="mgrid" data-adm-more="1">'+
    [["admmain1","메인 운영 · 배너 · 광고"],["admmain2","메인 운영 · 관 노출"],["admmain3","메인 운영 · 화면 구성"],["admmain4","메인 운영 · 콘텐츠"],
     ["admrev3","자동검수 규칙"],["admrev4","표본 감사"],["admsit8","외부 연동 관리"],["admcod","코드 라벨"],["admbdg","배지 신청 검수"],["admbil","청구 현황"]]
      .map(x=>'<button class="mcard" data-go="'+x[0]+'"><b>'+e(x[1])+'</b></button>').join("")+'</div>');''')
# 소개 내역 → 후기 작성
rep('''        badge(x.st), x.fee?'<b>'+won(x.fee)+'</b>':'<span class="ls">확정 전</span>', e(x.date)]))));''',
    '''        badge(x.st), x.fee?'<b>'+won(x.fee)+'</b>':'<span class="ls">확정 전</span>', e(x.date)])))+
    /* v10.27 (G-198) — 후기 작성 화면으로 가는 길(전에는 없었음) */
    '<div class="btns" style="margin-top:12px"><button class="bo" data-go="rvw" data-rvw-link="1">성사된 거래에 후기 쓰기 ›</button></div>');''')

# ── G-199 글 · 숫자 맞추기 ────────────────────────────────────────────────────────
# 개인 회원 — 가입 가능(결정 ⑤)과 맞춤
rep('''      '<p>소개뱅크는 <b>사업자 회원 전용</b>입니다.</p></div>'+''',
    '''      '<p><b>개인 회원도 가입</b>해 요청 등록과 소개 참여를 하실 수 있습니다. 판매 등록 · 소개비 수령은 사업자 인증 후입니다.</p></div>'+   /* v10.27 G-199 */''')
rep('''      '<button class="jb o lgb" data-s="join">사업자로 회원가입</button>'+''',
    '''      '<button class="jb o lgb" data-s="join">회원가입</button>'+''')
rep('''      '<div class="nt3" style="text-align:center;margin-top:12px">개인 회원 가입은 제공하지 않습니다. '+
      '법인 · 개인사업자 모두 가입할 수 있으며, 휴업 · 폐업 사업자는 가입할 수 없습니다.</div>'+''',
    '''      '<div class="nt3" style="text-align:center;margin-top:12px">개인 회원 · 개인사업자 · 법인 모두 가입할 수 있습니다. '+
      '휴업 · 폐업 사업자는 사업자 인증을 받을 수 없습니다.</div>'+''')
rep('''        '<div class="jop no" data-jt="person"><span class="rd x">✕</span>'+
        '<div><b>개인 회원</b><span>가입할 수 없습니다. 눌러보면 안내가 나옵니다.</span></div></div>'+''', '')
rep('''"intro": "소개뱅크는 사업자끼리 소개하고 소개비를 받는 곳입니다. 개인 회원은 없습니다 (A-00).",''',
    '''"intro": "소개뱅크는 소개하고 소개비를 받는 곳입니다. 개인 회원도 가입해 요청 등록과 소개 참여를 할 수 있고, 판매 등록 · 소개비 수령은 사업자 인증 후입니다.",''')
# 약관 — 「발행」 표와 「미확정」 안내가 엇갈림 → 발행 기준으로 맞추고 전문 화면을 엶
rep('''    table(["문서","상태"], g.terms.map(t=>['<b>'+e(t[0])+'</b>',
      t[1]==="TBD"?'<span class="tbd">TBD</span>':e(t[1])]))+
    note("warn","<b>약관 6종의 내용이 아직 확정되지 않았습니다 (B-12 · D-02).</b> "+
      "값이 들어오면 이 표와 전 화면 푸터에 동시에 반영됩니다.")+''',
    '''    table(["문서","상태"], g.terms.map((t,i)=>['<a href="#" class="lnk" data-go="termsv" data-term="'+i+'"><b>'+e(t[0])+'</b></a>',
      t[1]==="TBD"?'<span class="tbd">TBD</span>':e(t[1])]))+
    /* v10.27 (G-199) — 표는 「발행」인데 아래 안내는 「미확정」이었습니다. 10/8 결정(운영 첫 발행 = DB 의 글)에 맞춥니다 */
    note("info","<b>문서 이름을 누르면 전문이 열립니다.</b> 실제 웹은 DB 에 발행된 판을 그대로 보여 줍니다(/terms/{코드}) — 시행일 · 판 번호가 함께 나옵니다.")+''')
rep('''        '<div class="jc e" style="margin-top:10px"><span class="lb">약관 본문 미확정</span>'+
        '이용약관 · 개인정보처리방침 등 6종은 <b>확정 후 연결</b>됩니다(결정 B-12). '+
        '지금은 링크만 배치되어 있습니다.</div></div>';''',
    '''        '<div class="jc i" style="margin-top:10px"><span class="lb">약관 전문</span>'+
        '「보기 ›」를 누르면 약관 전문이 열립니다. 필수 항목에 모두 동의해야 다음으로 넘어갑니다.</div></div>';   /* v10.27 G-199 · G-200 */''')
rep('''            '<span class="vw">보기 ›</span></div>';''',
    '''            '<span class="vw" data-go="termsv">보기 ›</span></div>';''')
# 소개몰 바닥줄 약관 — 「법무 회신 대기」 안내 대신 약관 전문으로
rep('''class="tbd" title="법무 회신 대기 — B-12" data-tbd="1">''', '''class="tbd" title="약관 전문" data-termsv="1">''', 6)
# 이번 주 특별 할인 카드 — 그 성분의 실제 상품 값으로(10/8 답 「실제 상품값으로」). 모양(사진 · 3줄 · 값 · 별점)은 시안 그대로.
#   전에는 카드 「비타민C 1,000mg 프리미엄 정」 → 누르면 상품 「메가바이탈 비타민C 3000」(이름 · 값이 다름 · G-199)
rep('''      + '<div class="shop-deal">' + SHOP_DEAL.map(function(x){
          return '<a class="shop-dealc" role="link" tabindex="0" data-go="' + shopTo(x[8]) + '"><span class="ph">' + shopPic(x[0], 76) + '</span>'
            + '<b>' + esc(x[1]) + '</b><span class="ds">' + esc(x[2]) + '</span><span class="ds">' + esc(x[3]) + '</span>'
            + '<span class="pr"><strong>' + won(x[4]) + '</strong><s>' + won(x[5]) + '</s><i>' + shopPct(x[4], x[5]) + '%</i></span>'
            + '<span class="shop-star">' + x[6] + ' <i>(' + x[7].toLocaleString("ko-KR") + ')</i></span></a>'; }).join("") + '</div></section>\'''',
    '''      + '<div class="shop-deal">' + SHOP_DEAL.map(function(x){
          /* v10.27 (G-199 · 10/8 「실제 상품값으로」) — 그 성분의 판매 중인 상품 값(성분 · 함량 · 이름 · 판매가 · 정가 · 할인율 · 별점 · 후기 수).
             누르면 그 상품 상세로 갑니다. 그 성분의 상품이 없으면 시안 값 그대로 · 성분 목록으로 */
          var p = openProducts().filter(function(q){ return q.ing === x[8]; })[0];
          var t1 = p ? p.ingName + " " + p.amt : x[1], t2 = p ? p.name : x[2], now = p ? p.sale : x[4], was = p ? p.list : x[5];
          return '<a class="shop-dealc" role="link" tabindex="0" data-go="' + (p ? "#/p/" + p.id : shopTo(x[8])) + '"' + (p ? ' data-deal-pid="' + p.id + '"' : '') + '><span class="ph">' + shopPic(x[0], 76) + '</span>'
            + '<b>' + esc(t1) + '</b><span class="ds">' + esc(t2) + '</span><span class="ds">' + esc(x[3]) + '</span>'
            + '<span class="pr"><strong>' + won(now) + '</strong>' + (was > now ? '<s>' + won(was) + '</s><i>' + shopPct(now, was) + '%</i>' : '') + '</span>'
            + '<span class="shop-star">' + (p ? p.rate : x[6]) + ' <i>(' + Number(p ? p.rev : x[7]).toLocaleString("ko-KR") + ')</i></span></a>'; }).join("") + '</div></section>\'''')
# 견본 주문번호의 날짜 = 주문일
rep('''(function seed(){
  const d = function(n){ return new Date(Date.now() - n * 86400000); };''',
    '''/* v10.27 (G-199) — 견본 주문번호의 날짜를 주문일에 맞춥니다(전에는 번호 2026-09-08 · 주문일 「7일 전」). 번호 = H + 주문일 + 순번 */
const HDAY = function(n){ const t = new Date(Date.now() - n * 86400000), p = function(x){ return String(x).padStart(2, "0"); };
  return "H" + t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()); };
const SAMPLE_NO = HDAY(7) + "-000041";
(function seed(){
  const d = function(n){ return new Date(Date.now() - n * 86400000); };''')
rep('''no:"H20260908-000041", sellerId:"direct", at:d(7)''', '''no:SAMPLE_NO, sellerId:"direct", at:d(7)''')
rep('''no:"H20260903-000018", sellerId:"hansol", at:d(12)''', '''no:HDAY(12) + "-000018", sellerId:"hansol", at:d(12)''')
rep('''no:"H20260914-000073", sellerId:"green", at:d(1)''', '''no:HDAY(1) + "-000073", sellerId:"green", at:d(1)''')
rep('''"SB-HLT-MYO-020":"#/my/orders/H20260908-000041",''', '''"SB-HLT-MYO-020":"#/my/orders/" + SAMPLE_NO,''')
rep('''"SB-HLT-MYO-030":"#/my/orders/H20260908-000041/track",''', '''"SB-HLT-MYO-030":"#/my/orders/" + SAMPLE_NO + "/track",''')

# ── G-200 시연이 어색한 곳 ────────────────────────────────────────────────────────
# 내 등록 리스팅 — 제목 · 「수정」이 그 매물의 수정 화면으로
rep('''        '<b class="lnk" data-go="'+(x.st==="반려"?"reged":"reg")+'">'+e(x.t)+'</b>'+''',
    '''        '<b class="lnk" data-go="reged" data-edit="'+e(x.id)+'">'+e(x.t)+'</b>'+   /* v10.27 G-200 — 그 매물의 수정 화면 */''')
rep('''        (x.st==="반려"
          ? '<button class="bo sm" data-go="reged">수정</button>'
          : x.st==="노출중"
            ? '<button class="bo sm" data-go="reg" data-t="노출중인 리스팅을 수정하면 재검수 대상이 됩니다.">수정</button>'
            : '<button class="bo sm" data-go="reg">수정</button>')+''',
    '''        '<button class="bo sm" data-go="reged" data-edit="'+e(x.id)+'">수정</button>'+''')
rep('''function scRegEdit(){
  const r = D.reg.reject;''', '''function scRegEdit(){
  /* v10.27 (G-200) — 누른 매물로 엽니다(전에는 늘 같은 견본 반려 건 · 또는 빈 새 등록 화면). 반려가 아니면 반려 사유 대신 재검수 안내 */
  const ed = S().editLst || null, base = D.reg.reject;
  const r = !ed ? base
    : ed.st === "반려" ? Object.assign({}, base, { title: ed.t, code: ed.why || base.code, reason: ed.fix || base.reason })
    : Object.assign({}, base, { title: ed.t, body: ed.t + " — 등록하신 설명이 여기 채워집니다.", code: null, reason: null, hits: [], stLabel: ed.st });''')
rep('''    note("warn","<b>반려 사유 — "+e(r.code)+"</b><br>"+e(r.reason))+
    (r.hits.length''', '''    (r.code ? note("warn","<b>반려 사유 — "+e(r.code)+"</b><br>"+e(r.reason))
            : note("info","<b>「"+e(r.stLabel || "노출중")+"」인 등록을 고칩니다.</b> 고치면 다시 검수를 받고, 받은 배지는 회수됩니다 — 확인한 때의 내용과 달라지기 때문입니다."))+
    (r.hits.length''')
# 취소 · 반품 내역 상태 — 영문 코드 대신 한국어
rep('''  RETURN_REQUESTED:"반품 접수", EXCHANGE_REQUESTED:"교환 접수", REFUNDED:"환불 완료", EXPIRED:"주문 만료"
};''', '''  RETURN_REQUESTED:"반품 접수", EXCHANGE_REQUESTED:"교환 접수", REFUNDED:"환불 완료", EXPIRED:"주문 만료"
};
/* v10.27 (G-200) — 취소 · 반품 접수 상태(전에는 REQUESTED 가 그대로 보였음) */
const RET_LABEL = { REQUESTED:"접수", APPROVED:"승인", REJECTED:"반려", PICKED_UP:"회수 완료", COMPLETED:"처리 완료", REFUNDED:"환불 완료" };''')
rep('''esc(r.status)''', '''esc(RET_LABEL[r.status] || r.status)''', 2)
# 창 제목 — 소개몰이 닫혀 있을 때는 바꾸지 않음(처음 열면 「소개몰」이던 것)
rep('''  document.title = sc.title === "소개몰" ? "소개몰" : sc.title + " · 소개몰";''',
    '''  if (!window.__hltx || window.__hltx.isOpen()) document.title = sc.title === "소개몰" ? "소개몰" : sc.title + " · 소개몰";   /* v10.27 G-200 */''')
rep('''    document.title = "없는 화면 · 소개몰";''', '''    if (!window.__hltx || window.__hltx.isOpen()) document.title = "없는 화면 · 소개몰";''')
rep('''    if(window.__hltMall && window.__hltMall.repaint) window.__hltMall.repaint();
    host.classList.add("on");''', '''    host.classList.add("on");   /* v10.27 — 먼저 열어 두고 그립니다(창 제목이 열린 화면을 따르게) */
    if(window.__hltMall && window.__hltMall.repaint) window.__hltMall.repaint();''')

# ── 모듈: 끊긴 링크(#키) · 매물 수정 · 가입 단계 확인 · 약관 전문 · 나의공간 숫자 ──────────────
rep('''/*PS:END*/''', r'''/*PS:END*/
/*PF:BEGIN*/
var M_fix27 = (function(){
/* ═══════════════════════════════════════════════════════════════════
   v10.27 (2026-10-08) — 시안 결함 G-196 ~ G-200 중 화면 하나에 묶이지 않는 것
     G-197  「#mysub」 같은 화면 키 링크가 주소로 해석돼 「페이지를 찾을 수 없습니다」 → 화면 키면 그 화면으로,
            쪽 안의 칸 이름(#mh-q)이면 그 칸으로 내려가 커서를 둡니다
     G-198  나의공간 바로가기에 결제 수단 · 알림 · 한도 안내 · 사업자 전환 · 소개 활동을 더함
     G-199  나의공간 메뉴의 숫자 = 그 목록의 실제 건수 · 운영 대시보드 「정산 승인 대기」 = 정산 승인 화면의 건수 · 합계
     G-200  내 등록 리스팅의 「수정」 → 그 매물 · 가입 3 · 4단계는 필수 값 · 필수 약관이 없으면 넘어가지 않음
     약관 전문 화면(termsv) — 이용안내 · 가입 「보기 ›」 · 소개몰 바닥줄에서 엶
   ═══════════════════════════════════════════════════════════════════ */
let U = null, D = null;
const e = x => U.esc(x);
const won = n => Number(n).toLocaleString("ko-KR") + "원";
const TERMS = {
  "이용약관": ["서비스 이용 조건", "회원의 권리와 의무", "소개 · 소개비(당사자끼리 정함 · 플랫폼은 관여하지 않음)", "이용 제한 · 해지"],
  "개인정보처리방침": ["모으는 항목과 목적", "보관 기간", "제3자 제공 · 처리 위탁", "회원의 권리"],
  "구독 환불 정책": ["결제 당일 · 열람 전에만 환불", "요금제 바꾸기는 다음 결제일부터(올리기 · 내리기 모두)", "해지하면 그 기간까지 쓰고 더 청구하지 않음"],
  "제3자 제공 동의": ["거래 상대에게 주는 정보(이름 첫 글자 · 연락은 대화방 안에서)", "제공 목적 · 보관 기간"],
  "개인정보 처리업무 위탁": ["결제 · 본인인증 · 알림 발송 위탁처", "위탁 범위"],
  "건강상품 판매 약관": ["판매자 = 소개뱅크 직판(통신판매업자)", "청약철회 7일", "반품 · 교환 비용(제3조)", "배송 · 환불"],
  "맞춤형 광고 동의": ["쓰는 정보(둘러본 업종 · 지역)", "이름 · 연락처는 쓰지 않음", "언제든 철회"],
  "마케팅 수신 동의": ["보내는 소식", "언제든 철회"],
  "야간 광고 수신 동의": ["21시 ~ 다음 날 8시 발송 — 별도 동의", "언제든 철회"]
};
function scTerms(){
  const g = D.content.guide, pick = Number((U.state && U.state.termIdx) || 0);
  const list = g.terms.filter(t => t[1].indexOf("폐기") < 0);
  const cur = list[pick] || list[0];
  return U.header({}) + '<div class="wrap srcw">' + U.backLink("이용안내") +
    '<div class="ph"><h1>약관 전문</h1><p class="ls">발행된 약관입니다. 실제 웹은 DB 에 발행된 판을 그대로 보여 줍니다(/terms/{코드}) — 시행일 · 판 번호가 함께 나옵니다.</p></div>' +
    '<div class="chips" style="margin:10px 0">' + list.map((t, i) => '<button class="chip' + (t === cur ? ' on' : '') + '" data-termpick="' + i + '">' + e(t[0]) + '</button>').join("") + '</div>' +
    '<section class="mcard" data-terms-body="1" style="cursor:default"><b>' + e(cur[0]) + '</b><span>' + e(cur[1]) + '</span>' +
    '<ol style="margin:8px 0 0 18px;font-size:13px;line-height:1.8">' + (TERMS[cur[0]] || ["조항 목록은 실제 웹에서 봅니다"]).map((c, i) => '<li>제' + (i + 1) + '조 — ' + e(c) + '</li>').join("") + '</ol></section>' +
    '</div>' + U.footer();
}
function counts(){
  /* G-199 — 메뉴 숫자는 그 목록의 실제 건수(전에는 메뉴 9 ↔ 목록 6 · 17 ↔ 4) */
  const n = { mylst: (D.my.listings || []).length, mylik: (D.my.likes || []).length, mydeal: (D.my.deals || []).length,
              myctr: (D.my.contracts || []).length };
  D.my.menu.forEach(m => { if (n[m[2]] != null) m[3] = String(n[m[2]]); });
  /* G-198 — 바로가기에 없던 화면 */
  const have = D.my.menu.map(m => m[2]);
  [["결제 수단", "정기결제에 쓰는 카드", "mypaym", ""], ["알림", "거래 · 정산 · 검수 소식", "myntf", ""],
   ["한도 안내 · 요금제", "열람 · 슬롯 한도와 요금제", "mysubup", ""], ["사업자 전환", "소개비를 받으려면", "mybiz2", ""],
   ["소개 활동", "초대 · 활동 · 포인트", "introhome", ""]].forEach(x => { if (have.indexOf(x[2]) < 0) D.my.menu.push(x); });
  /* G-199 — 운영 대시보드 「정산 승인 대기」 = 정산 승인 화면의 신청 건수 · 합계(전에는 1,842만원 ↔ 18,840,000원) */
  try {
    const req = D.admin.settle.rows.filter(r => r.tab === "req"), sum = req.reduce((a, r) => a + r.fee, 0);
    D.admin.dash.tiles.forEach(t => { if (t[3] === "admstl") { t[1] = String(req.length); t[4] = "합계 " + won(sum); } });
  } catch (_) {}
}
function joinCheck(btn){
  /* G-200 — 가입 3 · 4단계에서 「다음 ▶」: 필수 칸 · 필수 약관이 비면 넘어가지 않음 */
  const to = Number(btn.getAttribute("data-js")), from = to - 1;
  if (!(btn.classList.contains("p") && to > 1)) return null;
  const sec = document.querySelector(".jp") || document;
  if (from === 3) {
    const flds = [].slice.call(sec.querySelectorAll(".fl")).filter(f => f.querySelector(".rq"));
    const empty = flds.filter(f => { const i = f.querySelector("input"); return i && !i.value.trim(); });
    if (empty.length) return "필수 칸을 채워 주십시오 — " + empty.map(f => f.querySelector("label").textContent.replace("*", "").trim()).join(" · ");
    const ins = [].slice.call(sec.querySelectorAll(".fl input")), pw = ins.filter(i => /비밀번호/.test(i.closest(".fl").textContent));
    const mail = ins.filter(i => /이메일/.test(i.closest(".fl").textContent))[0];
    if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.value.trim())) return "이메일 형식이 아닙니다.";
    if (pw.length >= 2 && pw[0].value.length < 10) return "비밀번호는 10자 이상입니다.";
    if (pw.length >= 2 && pw[0].value !== pw[1].value) return "비밀번호 확인이 다릅니다.";
  }
  if (from === 4) {
    const miss = [].slice.call(sec.querySelectorAll(".ag")).filter(a => a.querySelector(".rq2.r") && !a.querySelector(".cb.on"));
    if (miss.length) return "필수 약관에 모두 동의해 주십시오 — " + miss.map(a => a.querySelector(".t").textContent).join(" · ");
  }
  return null;
}
function bind(){
  document.addEventListener("click", ev => {
    const t = ev.target;
    /* G-197 — 화면 키 링크 */
    const a = t.closest && t.closest('a[href^="#"]');
    if (a && !a.hasAttribute("data-go")) {
      const key = a.getAttribute("href").slice(1);
      if (key && !/^\//.test(key)) {
        const el = document.getElementById(key);
        if (el) { ev.preventDefault(); ev.stopPropagation(); el.scrollIntoView({ block: "center" }); if (el.focus) el.focus(); return; }
        if (window.__VIEW && window.__VIEW.screens && window.__VIEW.screens[key]) { ev.preventDefault(); ev.stopPropagation(); U.go(key);
          /* 주소가 이미 그 화면 주소면 hashchange 가 안 나서 그대로 있습니다 — 그때는 바로 그립니다 */
          setTimeout(() => { if (window.__VIEW.state.screen !== key) { window.__VIEW.paint(key); } }, 60); return; }
      }
    }
    /* G-200 — 매물 수정: 누른 매물을 기억 */
    const ed = t.closest && t.closest("[data-edit]");
    if (ed) U.state.editLst = (D.my.listings || []).filter(x => x.id === ed.getAttribute("data-edit"))[0] || null;
    else if (t.closest && t.closest('[data-go="reged"],[data-go="reg"]')) U.state.editLst = null;
    /* 약관 전문 — 어느 약관을 열지 */
    const tm = t.closest && t.closest("[data-term]");
    if (tm) U.state.termIdx = Number(tm.getAttribute("data-term")) || 0;
    else if (t.closest && t.closest('[data-go="termsv"]')) U.state.termIdx = 0;
    const tp = t.closest && t.closest("[data-termpick]");
    if (tp) { ev.preventDefault(); ev.stopPropagation(); U.state.termIdx = Number(tp.getAttribute("data-termpick")); U.render(); return; }
    /* 소개몰 바닥줄 약관 → 소개몰을 닫고 약관 전문 */
    const tv = t.closest && t.closest("[data-termsv]");
    if (tv) { ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      const nm = tv.textContent.trim(), list = D.content.guide.terms.filter(x => x[1].indexOf("폐기") < 0);
      U.state.termIdx = Math.max(0, list.findIndex(x => x[0].replace(/\s/g, "").indexOf(nm.replace(/\s/g, "").replace("유료서비스약관", "구독환불정책")) >= 0));
      if (window.__hltx) window.__hltx.closeHealth(); location.hash = "/terms"; return; }
    /* G-200 — 가입 단계 확인 */
    const js = t.closest && t.closest("[data-js]");
    if (js) { const why = joinCheck(js); if (why) { ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation(); U.toast(why); } }
  }, true);
}
function install(ui, data){
  U = ui; D = data;
  counts(); bind();
  window.__PF = { joinCheck: joinCheck };
  return { screens: { termsv: scTerms },
           meta: { termsv: { id: "SB-HOM-ETC-021", url: "sogaebaenk.co.kr/terms/{code}", chip: "전역", note: "약관 전문 — 발행된 판 · 시행일. 실제 웹은 DB 의 글을 그대로 보여 줍니다(v10.27 · G-199)." } },
           nav: {} };
}
  return { install: install };
})();
/*PF:END*/''')
rep('''    M_plan.install(View.UI, data);   /*PS:INSTALL*/''',
    '''    M_plan.install(View.UI, data);   /*PS:INSTALL*/
    View.addScreens(M_fix27.install(View.UI, data));   /*PF:INSTALL*/ /* v10.27 — 시안 결함 G-196 ~ G-200 */''')

# ── 판 이름(창 제목의 앞) ─────────────────────────────────────────────────────────
rep('''<title>소개뱅크 시안 v10.26 (2026-10-08 · ''',
    '''<title>소개뱅크 시안 v10.27 (2026-10-09 · 결함 수정판 — 구독 결제(처음 유료 = 지금 결제 · 올리기 · 내리기 = 다음 결제일부터 예약) · 알림 센터 연결 · 끊긴 링크 9곳 · 열 수 없던 화면 19장에 주소 · 단추 · 약관 전문 · 개인 회원 가입 안내 · 메뉴 건수 · 정산 합계 · 견본 주문번호 날짜 · 매물 수정 · 가입 3 · 4단계 확인 · 반품 상태 한국어 · 특별 할인 = 실제 상품 · v10.26: 2026-10-08 · ''')
