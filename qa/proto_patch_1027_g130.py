# v10.27 — G-130 (10/8 답 「22건 모두 만듬」) : 시안에서 「상세 · 보기 · 열기」 단추가 화면을 열지 않고 안내 글만 띄우던 것 → 화면을 엽니다.
#   새 화면 7장(시안)
#     safgd    사기 예방 가이드          (사고예방 「사기 예방 가이드 더보기 ›」 · 사고 유형 5종 카드)
#     bpolsrc  지원사업 공고 원문         (정책 상세 「원문 공고 보기」)
#     adland   광고주 랜딩 미리보기       (AI 추천 결과 · 광고 「매물 보기」 등 — 랜딩 주소가 없는 소재)
#     admptnd  운영 파트너사 상세         (파트너사 목록 「상세」 6건)
#     admaudl  운영 감사 기록             (감사 「기록 보기」)
#     admsegp  운영 옮길 대상 미리보기    (성향 학습 「대상 보기」)
#     ctrform  계약서 양식 전문           (계약서 · 체결 「양식 전문 보기」 — DB 의 INTRO_STD 1.0 글 그대로)
#   소개몰(겹쳐 뜨는 틀) 1장: SB-HLT-MYO-040 택배사 조회 미리보기(배송 조회 「택배사에서 보기」)
#   화면 이동으로 고침: 파트너 알림 「보기」 5건 → 그 알림의 화면(상담 신청 · 내 서비스 · 리드 이용료 · 정산 · 공지)
#   안내가 잘못 뜨던 것: 소개몰 상품의 이미 열린 「상세 설명」 탭 · 주문 상세 안의 자기 자신 「상세보기」
#   시안에만 있는 화면(bpolsrc · adland · admsegp)은 「개발중」 표시(10/9 「시안까지만 한 경우 개발중으로 표시」) — 실제 웹 반영분은 표시 없음.
#   proto_patch_1027.py 가 exec 로 불러 씁니다(같은 s · rep).
import html as _html, re as _re2

# ── 계약서 양식 전문 — DB(contract_templates · INTRO_STD 1.0)의 글을 그대로 HTML 로 ──
def _md(t):
    out, tbl, para = [], [], []
    def flush_tbl():
        if tbl:
            rows = [r for r in tbl if not _re2.match(r'^\|\s*-', r)]
            cells = [[_html.escape(c.strip()) for c in r.strip('|').split('|')] for r in rows]
            out.append('<div class="tw"><table class="tb2"><thead><tr>' + ''.join('<th>' + c + '</th>' for c in cells[0]) + '</tr></thead><tbody>'
                       + ''.join('<tr>' + ''.join('<td>' + c + '</td>' for c in r) + '</tr>' for r in cells[1:]) + '</tbody></table></div>')
            tbl.clear()
    def inline(x):
        x = _html.escape(x)
        return _re2.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', x)
    def flush_para():
        if para:
            out.append('<p class="ctf-p">' + '<br>'.join(inline(x) for x in para) + '</p>'); para.clear()
    quote = []
    def flush_quote():
        if quote:
            out.append('<div class="nt info">' + ' '.join(inline(x) for x in quote) + '</div>'); quote.clear()
    for line in t.split('\n'):
        if line.startswith('|'): flush_para(); flush_quote(); tbl.append(line); continue
        flush_tbl()
        if line.startswith('> '): flush_para(); quote.append(line[2:]); continue
        flush_quote()
        if line.startswith('# '): continue           # 제목은 화면 머리에
        if line.startswith('## '): flush_para(); out.append('<h3 class="ctf-h">' + inline(line[3:]) + '</h3>'); continue
        if not line.strip(): flush_para(); continue
        para.append(line.strip())
    flush_tbl(); flush_para(); flush_quote()
    return ''.join(out)
_CTF = _md(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'intro_std_v1_0.md'), encoding='utf-8').read())
import json as _json2
_CTF_JS = _json2.dumps(_CTF, ensure_ascii=False)

# ══ 1. 본체 화면(render.js) — 사기 예방 가이드 · 공고 원문 · 광고주 랜딩 ══════════════════════════
rep('''  var STIP;''', '''  var STIP;
  var SRULE, SESC;      /* v10.27 (G-130) — 사기 예방 가이드에 씀 */''')
rep('''  SGUIDE = d.safety.guides;''', '''  SGUIDE = d.safety.guides;
  SRULE = d.safety.rules || []; SESC = d.safety.escrow || [];''')
# 사고예방 화면의 단추 — 안내 글 대신 가이드 화면
rep('''                return '<button class="gd2 '+g[0]+'" data-t="'+esc(g[2])+' 예방 가이드 — 콘텐츠 기획 미확정">'+''',
    '''                return '<button class="gd2 '+g[0]+'" data-go="safgd" data-sgd="'+esc(g[0])+'">'+''')
rep('''              '<button class="hotb" data-t="사기 예방 가이드 — 콘텐츠 기획 미확정">사기 예방 가이드 더보기 ›</button>'+''',
    '''              '<button class="hotb" data-go="safgd" data-sgd="all">사기 예방 가이드 더보기 ›</button>'+''')
# 정책 상세 「원문 공고 보기」 → 공고 원문 화면
rep('''        ? '<button class="go" data-t="지원사업 상세는 원문 링크 연동 전입니다."><span>원문 공고 보기</span><small>주관 기관 누리집으로 연결합니다</small></button>\'''',
    '''        ? '<button class="go" data-axsrc="'+esc(no)+'"><span>원문 공고 보기</span><small>공고 원문 · 주관 기관 누리집 주소</small></button>\'''')

rep('''  /* ── 생활 · 금융 상담 축 업종 (서버 D016''', r'''  /* ══ v10.27 (G-130) — 「상세 · 보기」 단추가 여는 화면 ═════════════════════════════════════
   * safgd 사기 예방 가이드 · bpolsrc 지원사업 공고 원문 · adland 광고주 랜딩 미리보기 */
  var SGD = {
    c1: { how: ["없는 매물 · 남의 매물로 계약금을 먼저 받음", "같은 물건으로 여러 사람과 계약(이중 계약)", "권한이 없는 사람이 대리인이라며 계약"],
          stop: ["등기부 · 사업자등록증의 이름이 계약 상대와 같은지 확인", "현장 · 실물을 본 뒤 계약", "계약서는 서면으로 쓰고 사본을 보관 — 소개뱅크 계약서는 양측이 각각 서명해야 체결됩니다"] },
    c2: { how: ["선입금을 받은 뒤 연락을 끊음", "가짜 송금 확인증 · 문자로 입금했다고 속임", "제3자 · 개인 계좌로 보내라고 함"],
          stop: ["대금은 계약 상대(사업자) 명의 계좌로만 — 이름이 다르면 멈추십시오", "소개뱅크 계좌로 보내라는 요구는 사기입니다 — 소개뱅크는 대금을 받지도 보관하지도 않습니다", "입금은 문자 말고 은행 앱에서 직접 확인"] },
    c3: { how: ["가짜 배송 조회 링크로 결제 · 개인정보를 받음", "다른 물건 · 가짜 상품을 보냄", "착수금만 받고 용역을 하지 않음"],
          stop: ["송장은 택배사 공식 앱 · 누리집에서 직접 조회", "물건 · 용역을 확인한 뒤 성사 확정(양측이 각각 눌러야 확정됩니다)", "용역은 단계별로 나눠 지급"] },
    c4: { how: ["인증번호 · 비밀번호를 물어봄", "원격 조정 앱을 깔게 함", "기관 · 회사를 사칭한 전화 · 문자"],
          stop: ["인증번호 · 비밀번호는 누구에게도 알려 주지 마십시오 — 소개뱅크는 이를 묻지 않습니다", "모르는 앱 · 링크는 설치하거나 누르지 않기", "대화는 소개뱅크 대화방 안에서 — 기록이 분쟁 근거로 남습니다"] },
    c5: { how: ["「원금 보장 · 고수익」을 내건 투자 권유", "등록되지 않은 대부 · 금융 광고", "실제와 다른 허위 광고"],
          stop: ["금융 상품은 금융감독원에서 등록 여부를 먼저 확인", "대부 광고는 소개뱅크에 올릴 수 없습니다(제한 업종)", "의심되는 등록글 · 광고는 「신고」로 알려 주십시오"] }
  };
  function scSafGd(){
    var cur = S.sgdT && SGD[S.sgdT] ? S.sgdT : "all";
    var list = cur === "all" ? SGUIDE : SGUIDE.filter(function(g){ return g[0] === cur; });
    return header({login:true, blueCta:true})+
      '<div class="wrap" style="padding-top:16px">'+backLink("사고예방")+'</div>'+
      '<div class="wrap" style="padding-top:14px"><div class="panel sgd" data-sgd-page="1" style="padding:22px 24px">'+
        '<h2 class="dtt" style="margin:0 0 4px">사기 예방 가이드</h2>'+
        '<p class="ls" style="margin:0 0 14px">거래 전에 확인할 것 · 유형별 수법과 막는 법 · 피해가 났을 때 할 일입니다.</p>'+
        '<div class="chips" style="margin:0 0 14px">'+[["all","전체"]].concat(SGUIDE.map(function(g){ return [g[0], g[2]]; })).map(function(c){
          return '<button class="chip'+(c[0]===cur?" on":"")+'" data-sgdpick="'+esc(c[0])+'">'+esc(c[1])+'</button>'; }).join("")+'</div>'+
        '<div class="dsec"><h4>거래 전 꼭 확인할 것</h4><ol class="sgd-ol">'+SRULE.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join("")+'</ol></div>'+
        list.map(function(g){ var x = SGD[g[0]] || {how:[], stop:[]};
          return '<div class="dsec sgd-sec" data-sgd-sec="'+esc(g[0])+'"><h4>'+g[1]+' '+esc(g[2])+' <span class="ls">'+esc(g[3])+'</span></h4>'+
            '<dl class="spec"><dt>대표 수법</dt><dd>'+x.how.map(esc).join("<br>")+'</dd>'+
            '<dt>이렇게 막으세요</dt><dd>'+x.stop.map(esc).join("<br>")+'</dd></dl></div>'; }).join("")+
        '<div class="dsec"><h4>소개뱅크가 하는 일 · 하지 않는 일</h4><dl class="spec">'+SESC.map(function(r){
          return '<dt>'+r[0]+' '+esc(r[1])+'</dt><dd>'+esc(r[2])+'</dd>'; }).join("")+'</dl></div>'+
        '<div class="dsec" style="margin-bottom:6px"><h4>피해가 났거나 의심되면</h4><ol class="sgd-ol">'+
          SREP.map(function(r){ return '<li><b>'+esc(r[1])+'</b> — '+esc(r[2])+'</li>'; }).join("")+
          '<li><b>금전 피해</b> — 경찰(112) · 경찰청 사이버범죄 신고시스템에 함께 신고하십시오. 대화 · 계약 기록은 소개뱅크가 보존합니다.</li></ol>'+
          '<div class="abar" style="margin-top:12px"><span class="sp"></span><button class="go" data-go="report"><span>사고 신고하기</span><small>등록글 · 회원 · 거래를 신고합니다</small></button></div></div>'+
      '</div></div>'+ footer();
  }
  function scBpolSrc(){
    var it = axItem("pol"), KD = AXKIND.pol;
    return header({login:true, blueCta:true})+
      '<div class="wrap" style="padding-top:16px">'+backLink("정책 상세")+'</div>'+
      '<div class="wrap" style="padding-top:14px"><div class="panel axdt" data-bpolsrc="'+esc(it.no)+'" style="overflow:hidden">'+
        '<div class="axdh"><div class="axdhl">'+axBadge(it)+'<span class="dtcat">공고 원문</span> <span class="bg wait" data-devstate="개발중" title="시안에만 있는 화면 — 실제 웹은 개발중">개발중</span></div>'+
          '<h2 class="dtt">'+esc(it.t)+'</h2>'+
          '<div class="dtsub">'+esc(it.org || "")+' · '+esc(it.due || "")+'</div>'+
          '<div class="dtmeta"><span class="dtno">'+esc(KD.lab)+' '+KD.pre+'-'+esc(it.no)+'</span></div></div>'+
        '<div class="axsample"><b>시연용 견본 — 실제 공고가 아닙니다.</b> 실제 서비스는 주관 기관이 낸 공고 원문(글 · 붙임 파일)과 원문 주소를 그대로 보여 줍니다.</div>'+
        '<div class="dsec"><h4>공고 개요</h4><dl class="spec">'+
          '<dt>공고명</dt><dd>'+esc(it.t)+'</dd><dt>주관 기관</dt><dd>'+esc(it.org || "")+'</dd>'+
          '<dt>지원 규모</dt><dd>'+esc(it.p || "")+'</dd><dt>접수 마감</dt><dd>'+esc(it.due || "")+'</dd></dl></div>'+
        '<div class="dsec"><h4>지원 내용</h4><p>'+esc(it.desc || "")+'</p>'+
          '<dl class="spec">'+(it.spec || []).map(function(r){ return '<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>'; }).join("")+'</dl></div>'+
        '<div class="dsec"><h4>신청 방법</h4><p>접수는 <b>주관 기관 누리집</b>에서 합니다. 소개뱅크는 접수 · 선정에 관여하지 않습니다.</p>'+
          '<div class="axnote2">원문 주소 <span class="code">https://(주관 기관 누리집)/공고/'+esc(it.no)+'</span> — 실제 서비스는 공고를 올릴 때 받은 원문 주소를 새 창으로 엽니다(다른 창 · 보던 화면 유지).</div></div>'+
        '<div class="dsec" style="margin-bottom:16px"><div class="axinv"><b>이 축은 소개비 구조 밖입니다.</b> 열람과 신청 안내만 합니다.</div></div>'+
        '<div class="abar"><button class="bo" data-go="reqn">창업계획 등록</button><span class="sp"></span>'+
          '<button class="go" data-go="bpol"><span>정책 상세로</span><small>지원 한도 · 신청 기한</small></button></div>'+
      '</div></div>'+ footer();
  }
  function scAdLand(){
    var c = S.adCr || null;
    if (!c) return header({login:true, blueCta:true})+'<div class="wrap" style="padding:40px 0">'+backLink("AI 추천 결과")+
      '<div class="panel" style="padding:30px;margin-top:14px"><b>광고를 다시 눌러 주십시오.</b><p class="ls">어떤 광고의 랜딩인지 알 수 없습니다.</p></div></div>'+footer();
    return header({login:true, blueCta:true})+
      '<div class="wrap" style="padding-top:16px">'+backLink("AI 추천 결과")+'</div>'+
      '<div class="wrap" style="padding-top:14px"><div class="panel adland" data-adland="'+esc(c.id)+'" style="padding:24px">'+
        '<div class="adl-top"><span class="bg off">광고</span> <span class="bg wait" data-devstate="개발중" title="시안에만 있는 화면 — 실제 웹은 개발중">개발중</span> <span class="ls">'+esc(c.adv)+' · '+esc(c.cat || "")+' · '+esc(c.id)+'</span></div>'+
        '<h2 class="dtt" style="margin:10px 0 6px">'+esc(c.t)+'</h2>'+
        '<p style="margin:0 0 14px">'+esc(c.b)+'</p>'+
        '<div class="dsec"><h4>광고주 페이지 미리보기</h4>'+
          '<div class="adl-cta" data-adl-cta="1"><b>'+esc(c.cta)+'</b><span class="ls">광고주 페이지의 신청 · 문의 단추 자리입니다 — 이 단추부터는 광고주가 받습니다.</span></div></div>'+
        '<div class="dsec"><h4>이 화면이 뜨는 경우</h4><dl class="spec">'+
          '<dt>랜딩 주소가 있는 소재</dt><dd>검수를 통과한 광고주 주소를 새 창으로 엽니다(보던 목록 유지 · noopener).</dd>'+
          '<dt>랜딩 주소가 없는 소재</dt><dd>이 미리보기 화면 — 광고주가 주소를 등록하면 바로 그 주소로 바뀝니다.</dd>'+
          '<dt>소개뱅크가 넘기는 것</dt><dd>없음 — 클릭 수만 셉니다. 이름 · 연락처는 광고주에게 가지 않습니다.</dd></dl></div>'+
        '<div class="abar" style="margin-top:6px"><span class="sp"></span><button class="go" data-go="airec"><span>추천 결과로</span><small>다른 추천 · 광고 보기</small></button></div>'+
      '</div></div>'+ footer();
  }

  /* ── 생활 · 금융 상담 축 업종 (서버 D016''')
rep('''    var ao=e.target.closest("[data-axopen]");    /* v10.22 — 줄의 항목 상세로 */''', '''    var asrc=e.target.closest("[data-axsrc]");    /* v10.27 (G-130) — 정책 상세 → 그 공고의 원문 */
    if(asrc){ e.preventDefault(); goHref(AUTH.gwanHref("BIZ", "/policy/" + asrc.getAttribute("data-axsrc") + "/source")); return; }
    var ao=e.target.closest("[data-axopen]");    /* v10.22 — 줄의 항목 상세로 */''')
rep('''bpol:function(){return axDetail("pol");},''','''bpol:function(){return axDetail("pol");},safgd:scSafGd,bpolsrc:scBpolSrc,adland:scAdLand,''')
rep('''    reqn:"소개받기 등록", reg:"등록하기", ask:"문의", cs:"고객센터"};''',
    '''    reqn:"소개받기 등록", reg:"등록하기", ask:"문의", cs:"고객센터",
    safgd:"사기 예방 가이드", bpolsrc:"공고 원문", adland:"광고주 랜딩"};   /* v10.27 (G-130) */''')
rep('''  var META = {"bjob": {''', '''  var META = {"safgd": {"id": "SB-MNY-SAF-020", "url": "sogaebaenk.co.kr/safety/guide", "chip": "03 탐색", "note": "사기 예방 가이드 — 거래 전 확인 · 유형별 수법과 막는 법 · 피해 시 할 일(v10.27 · G-130)."}, "bpolsrc": {"id": "SB-BIZ-POL-030", "url": "biz.sogaebaenk.co.kr/policy/9301/source", "chip": "03 탐색", "note": "지원사업 공고 원문 — 공고 개요 · 지원 내용 · 원문 주소(실제 서비스는 새 창)(v10.27 · G-130) · 실제 웹 개발중."}, "adland": {"id": "SB-ADS-LND-010", "url": "sogaebaenk.co.kr/ad/{소재}", "chip": "광고", "note": "광고주 랜딩 미리보기 — 랜딩 주소가 없는 소재를 눌렀을 때(v10.27 · G-130) · 실제 웹 개발중."}, "bjob": {''')
rep('''    cs:"main2", win:"list", bst:"list", urg:"list", saf:"list",''',
    '''    cs:"main2", win:"list", bst:"list", urg:"list", saf:"list",
    safgd:"saf", bpolsrc:"bpol", adland:"airec",   /* v10.27 (G-130) */''')

# ── 광고 클릭(랜딩 주소 · 이동 화면이 없는 소재) → 광고주 랜딩 미리보기 ──
rep('''      U.toast("광고 클릭 — "+(c?c.adv:"")+" · "+id+". 실제 서비스에서는 광고주 랜딩으로 나갑니다(집계 서버 없음).");
      return;''', '''      /* v10.27 (G-130) — 안내 글 대신 광고주 랜딩 미리보기 화면 */
      U.state.adCr = c ? JSON.parse(JSON.stringify(c)) : null; U.go("adland");
      return;''')

# ══ 2. 운영 · 나의공간 화면(screens.js) — 파트너사 상세 · 감사 기록 · 옮길 대상 · 계약서 양식 전문 ══════
rep('''      '<div class="mact"><button class="bo sm" data-t="파트너사 상세는 파트너센터 쪽 화면을 그대로 씁니다.">상세</button></div>'+''',
    '''      '<div class="mact"><button class="bo sm" data-go="admptnd" data-ptnid="'+e(x.id)+'">상세</button></div>'+''')
rep('''    '<button class="bs" data-t="감사 기록을 봅니다.">기록 보기</button></div>'+''',
    '''    '<button class="bs" data-go="admaudl">기록 보기</button></div>'+''')
rep('''    '<button class="bs" data-t="옮길 대상을 미리 봅니다.">대상 보기</button></div>');''',
    '''    '<button class="bs" data-go="admsegp">대상 보기</button></div>');''')
rep('''    '<button class="bs">양식 전문 보기</button>'+''', '''    '<button class="bs" data-go="ctrform">양식 전문 보기</button>'+''')
# 파트너 알림 「보기」 → 그 알림의 화면
rep('''          '<div class="lact"><button class="bo sm" data-t="알림에서 해당 화면으로 바로 갑니다.">보기</button></div>'+''',
    '''          '<div class="lact">'+(a[0]==="공지" ? '<button class="bo sm" data-ptnnotice="1">보기</button>'
            : '<button class="bo sm" data-go="'+({"리드":"ptnlead","검수":"ptnsvc","리드 이용료":"ptncash","정산":"ptnstl"}[a[0]]||"ptn")+'">보기</button>')+'</div>'+''')

_G130_B = r'''/* ══ v10.27 (G-130) — 「상세 · 보기」 단추가 여는 운영 · 나의공간 화면 ═════════════════════ */
function scAdmPtnD(){
  const P2 = D.admin.partner, id = S().ptnId, x = P2.list.filter(p => p.id === id)[0] || P2.list[0];
  const ok = x.st === "운영중", stop = !ok || /막힙/.test(x.warn || "");
  return ptnShell("admptn", "파트너사 상세", "입점 파트너사 한 곳의 계약 · 서비스 · 리드 · 이용료를 한 화면에서 봅니다. <b>SB-ADM-PTN-011</b>",
    '<div class="prof" data-ptn-detail="'+e(x.id)+'"><div class="av">'+e(x.corp.replace(/^\(주\)/,"").slice(0,1))+'</div>'+
    '<div class="pi"><b>'+e(x.corp)+'</b> '+badge(x.st)+
    '<div class="ps">'+e(x.id)+' · 사업자 '+e(x.biz)+' · '+e(x.at)+' 입점</div>'+
    '<div class="ps">'+e(x.cat)+' · 단가 방식 '+e(x.form)+'</div></div></div>'+
    (x.warn ? note("warn", "<b>"+e(x.warn)+"</b>") : "")+
    '<div class="g130kpi">'+[[String(x.svc),"서비스"],[String(x.lead),"받은 리드"],[won(x.cash),"리드 이용료 잔액"],[stop?"수신 멈춤":"수신 중","리드 수신"]]
      .map(k=>'<div class="kc"><div class="kv">'+e(k[0])+'</div><div class="kl">'+e(k[1])+'</div></div>').join("")+'</div>'+
    '<h2 class="st2">계약 · 서류</h2>'+
    table(["항목","상태","근거"],[
      ["파트너 표준계약서 1.0", ok ? '<span class="bg ok">체결</span>' : '<span class="bg wait">입점 심사 뒤 체결</span>', "PARTNER_STD · 전자서명"],
      ["사업자 상태 조회", '<span class="bg ok">계속사업자</span>', "국세청 조회(입점 신청 때)"],
      ["업종 자격", x.warn && /자격|심의/.test(x.warn) ? '<span class="bg wait">확인 대기</span>' : '<span class="bg ok">해당 없음 · 확인</span>', e(x.cat)]
    ])+
    '<h2 class="st2">서비스 '+x.svc+'개</h2>'+
    (x.svc ? table(["서비스","지역","상태"], Array.from({length: Math.min(x.svc, 4)}, (_, i)=>[
        e(x.cat)+" "+["기본","프리미엄","긴급","정기"][i], ["서울 전역","경기 남부","인천","서울 · 경기"][i], '<span class="bg ok">노출</span>']))
      : note("info","<b>아직 등록한 서비스가 없습니다.</b> 입점 · 자격 심사를 마치면 서비스를 등록합니다."))+
    '<h2 class="st2">처리 바로가기</h2>'+
    '<div class="hbtn"><button class="bo" data-go="admptna">입점 신청</button><button class="bo" data-go="admptns">서비스 검수</button>'+
    '<button class="bo" data-go="admptnw">리드 이용료</button><button class="bo" data-go="admptnq">자격 심사</button>'+
    '<button class="bs" data-go="admptn">← 파트너사 목록</button></div>');
}
function scAdmAudL(){
  return admShell("admrsk","감사 기록",
    "운영 · 회원 행위 기록입니다. 고치거나 지울 수 없습니다. <b>SB-ADM-AUD-020</b>",
    '<div class="chips" style="margin:6px 0 10px">'+["전체","운영","회원","개인정보 열람"].map((c,i)=>'<button class="chip'+(i===0?" on":"")+'">'+e(c)+'</button>').join("")+'</div>'+
    table(["일시","행위","대상","역할","누가"],[
      ["10-08 21:42","BUSINESS_VERIFY · 사업자 인증 승인","BUSINESS · 소개사","ADMIN","운영자 김○○"],
      ["10-08 21:30","HLT_RETURN_DECIDE · 반품 판정","HLT_RETURN · H26100800231","ADMIN","운영자 이○○"],
      ["10-08 20:55","SITE_SETTING_UPDATE · 사이트 설정","SITE_SETTING · refcode.scope","ADMIN","운영자 김○○"],
      ["10-08 20:12","SUBSCRIPTION_CHANGE · 요금제 예약","SUBSCRIPTION · 스탠다드 → 프로","BIZ_OWNER","회원 박○○"],
      ["10-08 19:48","PARTNER_APPROVE · 입점 승인","PARTNER · P-1039","ADMIN","운영자 이○○"],
      ["10-08 18:03","PII_VIEW · 연락처 열람(사유: 분쟁 확인)","ACCOUNT · 회원 정○○","ADMIN","운영자 김○○"]
    ])+
    note("info","<b>감사 기록은 고치거나 지울 수 없습니다.</b> DB 가 막습니다(바꾸기 · 지우기 모두 거절 — 공격 검정 E-01 · E-02). 보관 3년.")+
    note("warn","<b>개인정보를 본 기록에는 사유가 함께 남습니다.</b> 사유 없이 본 기록은 징후(NO_REASON)로 잡힙니다.")+
    '<div class="hbtn"><button class="bs" data-go="admaud">← 감사 징후</button></div>');
}
function scAdmSegP(){
  return admShell("admrsk","옮길 대상 미리보기",
    '<span class="bg wait" data-devstate="개발중" title="시안에만 있는 화면 — 실제 웹은 개발중">개발중</span> 학습을 실행하면 옮겨질 회원입니다. 실행 전에 확인합니다. <b>SB-ADM-SEG-020</b>',
    '<div class="g130kpi">'+[["3","옮김"],["2","보류"],["0","동의 안 함 제외","ok"],["5","최소 클릭"]]
      .map(k=>'<div class="kc"><div class="kv '+(k[2]||'')+'">'+e(k[0])+'</div><div class="kl">'+e(k[1])+'</div></div>').join("")+'</div>'+
    table(["회원","지금","옮길 곳","원래 쪽 클릭","새 쪽 클릭","판정"],[
      ["박○○","SEG-A 부동산","SEG-C 물류","0","6",'<span class="bg ok">옮김</span>'],
      ["이○○","SEG-B 창업","SEG-F 에너지","1","7",'<span class="bg ok">옮김</span>'],
      ["최○○","SEG-D 시공","SEG-A 부동산","2","9",'<span class="bg ok">옮김</span>'],
      ["정○○","SEG-E IT","SEG-B 창업","2","4",'<span class="bg wait">보류 — 클릭 5회 미만</span>'],
      ["한○○","SEG-C 물류","SEG-A 부동산","3","7",'<span class="bg wait">보류 — 차이 3배 미만</span>']
    ])+
    note("info","<b>이름은 첫 글자만 보입니다.</b> 광고주는 이 목록을 받지 않습니다 — 여전히 <b>집계만</b> 받습니다.")+
    note("warn","<b>여러 세그먼트를 겨냥한 소재의 클릭은 세지 않습니다.</b> 어느 쪽이 끌었는지 몰라 신호로 쓰지 않습니다.")+
    '<div class="hbtn"><button class="bs" data-go="admseg">← 성향 학습</button></div>');
}
function scCtrForm(){
  return myShell("myctr","계약서 양식 전문",
    "소개 표준계약서 1.0 — 조항은 고칠 수 없고 빈칸만 채웁니다. 시행일 2026-11-11.",
    '<div class="card pad ctf" data-ctform="INTRO_STD">'+__CTF__+'</div>'+
    note("info","<b>실제 웹과 같은 글입니다.</b> 계약서 양식은 DB(contract_templates · INTRO_STD 1.0)에 있고, 화면은 그 글을 그대로 보여 줍니다(GET /contract-templates/INTRO_STD).")+
    '<div class="hbtn"><button class="bs" data-go="myctrd">← 계약서 · 체결</button></div>');
}

const SCREENS = {
  /* 신규 7화면 (2026-09-18)'''
rep('''const SCREENS = {
  /* 신규 7화면 (2026-09-18)''', _G130_B.replace('__CTF__', _CTF_JS))
rep('''  admptn:scAdmPtn, admptna:scAdmPtnApply, admptns:scAdmPtnSvc, admptnm:scAdmPtnMed,''',
    '''  admptn:scAdmPtn, admptna:scAdmPtnApply, admptns:scAdmPtnSvc, admptnm:scAdmPtnMed,
  admptnd:scAdmPtnD, admaudl:scAdmAudL, admsegp:scAdmSegP, ctrform:scCtrForm,   /* v10.27 (G-130) */''')
rep('''  admptn: M("SB-ADM-PTN-010",''', '''  admptnd: M("SB-ADM-PTN-011","admin.sogaebaenk.co.kr/partners/{id}","운영","파트너사 상세 — 계약 · 서류 · 서비스 · 리드 이용료 · 처리 바로가기(v10.27 · G-130)."),
  admaudl: M("SB-ADM-AUD-020","admin.sogaebaenk.co.kr/audit/logs","운영","감사 기록 — 일시 · 행위 · 대상 · 역할 · 누가. 고치거나 지울 수 없음(v10.27 · G-130)."),
  admsegp: M("SB-ADM-SEG-020","admin.sogaebaenk.co.kr/ads/segments/preview","운영","옮길 대상 미리보기 — 학습 실행 전 확인(v10.27 · G-130) · 실제 웹 개발중."),
  ctrform: M("SB-MYP-CTR-030","sogaebaenk.co.kr/contracts/templates/INTRO_STD","05 성사","계약서 양식 전문 — DB 의 INTRO_STD 1.0 글 그대로(v10.27 · G-130)."),
  admptn: M("SB-ADM-PTN-010",''')
rep('''  admptn:"파트너사", admptna:"입점 신청", admptns:"서비스 검수", admptnm:"의료 심의",''',
    '''  admptn:"파트너사", admptna:"입점 신청", admptns:"서비스 검수", admptnm:"의료 심의",
  admptnd:"파트너사 상세", admaudl:"감사 기록", admsegp:"옮길 대상", ctrform:"계약서 양식",   /* v10.27 (G-130) */''')

# 숫자 칸(4칸) 모양 — 기존 .kpi4 는 모양 정의가 없어 표처럼 늘어섰습니다(새 화면은 이 칸을 씀)
rep('''  .kc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;''',
    '''  .g130kpi{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 14px}      /* v10.27 (G-130) */
  .g130kpi .kc{display:flex;flex-direction:column;gap:3px}.g130kpi .kv{font-size:20px;font-weight:800;letter-spacing:-.03em}.g130kpi .kv.ok{color:var(--s1,#059669)}
  .ctf .ctf-h{font-size:15px;margin:16px 0 6px}.ctf .ctf-p{margin:0 0 8px;line-height:1.75;font-size:13.5px}
  .sgd-ol{margin:6px 0 0 18px;line-height:1.85;font-size:13.5px}.adl-cta{display:flex;flex-direction:column;gap:4px;border:1px dashed var(--line);border-radius:10px;padding:14px}
  .kc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;''')

# ══ 3. 주소(라우터) — 새 화면 7장 ═════════════════════════════════════════════════════
rep('''const ROUTES = [
  { re:/^\\/admin\\/health\\/products\\/?$/, screen:"admhpr", title:"소개몰 상품",''', '''const ROUTES = [
  /* v10.27 (G-130) — 「상세 · 보기」가 여는 화면 */
  { re:/^\\/safety\\/guide\\/?$/, screen:"safgd", title:"사기 예방 가이드", desc:"거래 전 확인 · 유형별 수법과 막는 법." },
  { re:/^\\/policy\\/([\\w-]+)\\/source\\/?$/, screen:"bpolsrc", params:m=>({gwan:"BIZ", axno:m[1]}), title:"공고 원문", desc:"주관 기관의 공고 원문입니다." },
  { re:/^\\/ad\\/([\\w-]+)\\/?$/, screen:"adland", title:"광고주 랜딩", desc:"광고주 페이지 미리보기." },
  { re:/^\\/admin\\/partners\\/([\\w-]+)\\/?$/, screen:"admptnd", params:m=>({ptnId:m[1]}), title:"파트너사 상세", desc:"계약 · 서비스 · 리드 · 이용료." },
  { re:/^\\/admin\\/audit\\/logs\\/?$/, screen:"admaudl", title:"감사 기록", desc:"운영 · 회원 행위 기록." },
  { re:/^\\/admin\\/ads\\/segments\\/preview\\/?$/, screen:"admsegp", title:"옮길 대상", desc:"학습 실행 전 확인." },
  { re:/^\\/contracts\\/templates\\/([\\w-]+)\\/?$/, screen:"ctrform", title:"계약서 양식 전문", desc:"소개 표준계약서 1.0." },
  { re:/^\\/admin\\/health\\/products\\/?$/, screen:"admhpr", title:"소개몰 상품",''')
rep('''const TO_PATH = {
  brkapp:"/broker/apply", brkmy:"/broker/status",''', '''const TO_PATH = {
  brkapp:"/broker/apply", brkmy:"/broker/status",
  /* v10.27 (G-130) */
  safgd:"/safety/guide", bpolsrc:"/policy/9301/source", adland:"/ad/AD-110", admptnd:"/admin/partners/P-1041",
  admaudl:"/admin/audit/logs", admsegp:"/admin/ads/segments/preview", ctrform:"/contracts/templates/INTRO_STD",''')

# ══ 4. 소개몰(겹쳐 뜨는 틀) ══════════════════════════════════════════════════════════
# 주문 상세 안에서는 자기 자신으로 가는 「상세보기」를 그리지 않음
rep('''function orderButtons(o){''', '''function orderButtons(o, self){''')
rep('''  go("상세보기", "#/my/orders/" + o.no);
  return b.join("");''', '''  if (!self) go("상세보기", "#/my/orders/" + o.no);      /* v10.27 (G-130) — 주문 상세 안에서는 그리지 않음(자기 자신) */
  return b.join("");''')
rep('''      + '<div class="hlt-btns" style="margin-top:14px">' + orderButtons(o) + '</div>';''',
    '''      + '<div class="hlt-btns" style="margin-top:14px">' + orderButtons(o, true) + '</div>';''')
# 택배사 조회 미리보기 화면
rep('''/* ── SB-HLT-RTN-010 취소 · 반품 신청 ★ ───────────────────── */''', '''/* ── SB-HLT-MYO-040 택배사 조회 미리보기 · v10.27 (G-130) ──────────
 * 「택배사에서 보기」 — 실제 서비스는 택배사 조회 창을 새 창으로 엽니다(택배사 코드 + 송장번호).
 * 시안은 넘길 값과 조회 결과 자리를 보입니다. 택배사 화면을 흉내 내지 않습니다. */
SCREENS["SB-HLT-MYO-040"] = {
  path:"#/my/orders/:no/track/carrier", parent:"#/my/orders/", title:"택배사 조회", param:true,
  render:function(no){
    const o = S.orders.filter(function(x){ return x.no === no; })[0];
    if (!o) return empty("🚚", "주문을 찾을 수 없습니다.", "주문 내역", "#/my/orders");
    const inv = "4188-2201-" + no.slice(-4);
    return '<div class="hlt-crumb">내 주문 › ' + esc(no) + ' › 배송 조회 › 택배사 조회</div>'
      + '<h1>택배사 조회</h1>'
      + '<div class="hlt-box" data-carrier="1" style="margin-top:12px">'
      + '<p class="hlt-sm hlt-mut">실제 서비스는 아래 값으로 <b>택배사 조회 창을 새 창</b>으로 엽니다. 보던 소개몰 화면은 그대로 남습니다.</p>'
      + '<div class="hlt-scroll"><table class="hlt-tbl">'
      + row("택배사", "한진택배") + row("송장번호", inv)
      + row("넘기는 값", "택배사 코드 · 송장번호만 — 이름 · 주소 · 연락처는 넘기지 않습니다")
      + row("연동 전", "송장번호 복사 · 택배사 누리집에서 직접 조회") + '</table></div>'
      + '<div class="hlt-btns" style="margin-top:10px">'
      + '<button type="button" class="hlt-btn sm" id="btnCopyTrack">송장번호 복사</button>'
      + '<button type="button" class="hlt-btn sm" data-go="#/my/orders/' + esc(no) + '/track">← 배송 조회</button></div></div>';
  },
  mixed:function(){ return false; }
};

/* ── SB-HLT-RTN-010 취소 · 반품 신청 ★ ───────────────────── */''')
rep('''  "SB-HLT-MYO-030":"#/my/orders/" + SAMPLE_NO + "/track",''', '''  "SB-HLT-MYO-030":"#/my/orders/" + SAMPLE_NO + "/track",
  "SB-HLT-MYO-040":"#/my/orders/" + SAMPLE_NO + "/track/carrier",      /* v10.27 (G-130) */''')
rep('''  if ((m = h.match(/^#\\/my\\/orders\\/([^/]+)\\/track$/)))  return { key:"SB-HLT-MYO-030", p:m[1] };''',
    '''  if ((m = h.match(/^#\\/my\\/orders\\/([^/]+)\\/track\\/carrier$/))) return { key:"SB-HLT-MYO-040", p:m[1] };      /* v10.27 (G-130) */
  if ((m = h.match(/^#\\/my\\/orders\\/([^/]+)\\/track$/)))  return { key:"SB-HLT-MYO-030", p:m[1] };''')
rep('''const MY_SCREENS = ["SB-HLT-MYO-010","SB-HLT-MYO-020","SB-HLT-MYO-030",''', '''const MY_SCREENS = ["SB-HLT-MYO-010","SB-HLT-MYO-020","SB-HLT-MYO-030","SB-HLT-MYO-040",''')
rep('''    if (t.id === "btnCarrier") { toast("택배사 창은 시연에서 열지 않습니다"); return; }''',
    '''    if (t.id === "btnCarrier") {      /* v10.27 (G-130) — 택배사 조회 미리보기 화면 */
      const mm = (location.hash || "").match(/^#\\/my\\/orders\\/([^/]+)\\/track/);
      if (mm) { location.hash = "#/my/orders/" + mm[1] + "/track/carrier"; return; }
      toast("주문을 찾을 수 없습니다"); return;
    }''')
# 이미 열린 탭(소개몰 「상세 설명」 등)을 다시 누르면 아무 안내도 띄우지 않음 — 바뀔 것이 없는 것이 맞는 동작
rep('''      if(sibs.length>1 && sibs.length<=12 && label.length && label.length<=16 && !el.hasAttribute('data-go')){''',
    '''      /* v10.27 (G-130) — 이미 열려 있는 탭을 다시 누르면 「시안은 표시만 바꿉니다」 대신 지금 보고 있는 탭이라고 알림(무반응도 아님 — 시연 보장) */
      if(el.getAttribute('role')==='tab' && (el.classList.contains('on') || el.getAttribute('aria-selected')==='true')){ say('지금 보고 있는 «'+label+'»입니다.', inHlt0); return; }
      if(sibs.length>1 && sibs.length<=12 && label.length && label.length<=16 && !el.hasAttribute('data-go')){''')

# ══ 5. 누른 것을 기억(유형 · 파트너사) · 칩 고르기 ══════════════════════════════════════
rep('''/*PF:END*/''', r'''/*PF:END*/
/*PG:BEGIN*/
var M_g130 = (function(){
/* v10.27 (G-130) — 「상세 · 보기」 단추가 여는 화면에 「무엇을 눌렀는지」를 넘깁니다(사고 유형 · 파트너사 · 공지 탭). */
function install(ui){
  document.addEventListener("click", function(ev){
    const t = ev.target, U = ui;
    const sg = t.closest && t.closest("[data-sgd]");
    if (sg) U.state.sgdT = sg.getAttribute("data-sgd");
    const pk = t.closest && t.closest("[data-sgdpick]");
    if (pk) { ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      U.state.sgdT = pk.getAttribute("data-sgdpick"); U.render(); return; }
    const pi = t.closest && t.closest("[data-ptnid]");
    if (pi) { ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      U.state.ptnId = pi.getAttribute("data-ptnid"); location.hash = "#/admin/partners/" + encodeURIComponent(U.state.ptnId); return; }      /* 그 파트너사의 주소로 */
    const pn = t.closest && t.closest("[data-ptnnotice]");
    if (pn) { ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      U.state.ntab = "notice"; U.render(); window.scrollTo(0, 0); return; }
  }, true);
  return { screens: {}, meta: {}, nav: {} };
}
  return { install: install };
})();
/*PG:END*/''')
rep('''    View.addScreens(M_fix27.install(View.UI, data));   /*PF:INSTALL*/''',
    '''    View.addScreens(M_fix27.install(View.UI, data));   /*PF:INSTALL*/
    View.addScreens(M_g130.install(View.UI));   /*PG:INSTALL*/ /* v10.27 — G-130 상세 · 보기 화면 */''')
rep(''' · 견본 그림 14칸을 분류마다 다른 그림으로 · v10.26: 2026-10-08 · ''',
    ''' · 견본 그림 14칸을 분류마다 다른 그림으로 · 「상세 · 보기」 단추가 화면을 엶(새 화면 8장) · v10.26: 2026-10-08 · ''')
