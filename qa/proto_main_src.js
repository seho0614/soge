  /* ══ 메인 v10.13 — 「hero 페이지」 디자인 (2026-10-02 사장님이 주신 그림) ════════════════
     메인 전용 헤더 → 히어로(검색 탭 · 검색창 · 넘겨 보는 안내/HERO 광고 · 추천 칩) → 오늘의 소개뱅크 →
     지금, 어떤 소개가 필요하세요? → 오늘의 PICK → 이건 어때? → 띠배너 → 지금 우리동네 →
     믿고 연결받는 안심소개 → 최근 뜨는 창업 → 나를 위한 소개 → 소개뱅크 핵심 → 메인 전용 푸터
     · 새 헤더 · 푸터는 메인에서만 씁니다(사장님 결정). 다른 화면은 header() · footer() 그대로입니다.
     · 메뉴 이름은 관 이름 그대로입니다(「소개뱅크몰」 유지).
     · 내용은 그림의 예시 그대로입니다 — 순위 · 평점 · 인물은 예시입니다(푸터에 적어 둡니다).
       ★ v10.14 — 「이건 어때?」는 예시 숫자가 아니라 **실제 투표**입니다(참여 수 = 넣은 표 수). 사회관계망 아이콘은 운영이 넣은 주소로 연결됩니다.
       실제 웹(site/src/app/page.tsx)은 같은 모양에 서버 데이터를 넣습니다.
     · 사진 · 아이콘 · 로고는 **주신 그림에서 그대로 잘라 낸 것**입니다(MHX_ART — spec/design/hero_page_20261002.png · qa/crop_design.py).
       새로 그리지 않았습니다. 화살표 · 돋보기 같은 선 기호만 화면 요소입니다. 그림 속 글자가 뭉개진 곳은 뜻이 통하게 적었습니다.
     · 스타일은 #mhx-style — 실제 웹의 styles/home.css 와 같은 내용입니다(qa/apply_proto_main.py 가 넣습니다).
     · 예전 메인(v10.4 구성1)은 mainBodyV2() 로 남겨 둡니다 — 되돌리기는 MH_USE_V2 한 줄입니다. */
  var MH_USE_V2 = false;
  var MHX_LINE = /*MHX_LINE*/{};
  var MHX_PIC = /*MHX_PIC*/{};     /* 잘라 낸 그림의 원래 크기 [폭, 높이] */
  var MHX_ART = /*MHX_ART*/{};     /* 잘라 낸 그림(PNG) — 파일 안에 들어 있습니다 */
  var MHX_CHIPS = ["판교 가족식당 추천해줘","1천만원대로 시작할 창업아이템 있어?","음식물처리기 요즘 뭐가 좋아?","믿을 만한 세무사 소개받고 싶어"];
  var MHX_TABS = [["ai","AI 검색","예) 판교에서 부모님 모실만한 한식당 추천해줘"],["product","상품","예) 음식물처리기, 공기청정기"],
                  ["service","서비스","예) 사무실 인테리어, 이사 · 청소"],["company","업체","예) 우리동네 인테리어 업체"],
                  ["biz","창업","예) 1천만원대로 시작할 창업 아이템"],["town","동네정보","예) 판교 가족식당 추천해줘"],
                  ["pro","사람/전문가","예) 믿을 만한 세무사 소개받고 싶어"]];
  window.__MHX = { art: function(n){ return MHX_ART[n] || ""; } };   /* v10.14 — 투표 목록(M_poll)이 같은 그림을 씁니다 */
  function mxImg(n, cls){ return '<img'+(cls?' class="'+cls+'"':'')+' src="'+(MHX_ART[n]||"")+'" alt="" loading="lazy">'; }
  /* 그림 속 아이콘 — 높이 h(px)에 맞춰 같은 비율로 */
  function mxPic(n, h, alt){
    var z = MHX_PIC[n] || [1,1];
    return '<img class="home-pic" src="'+(MHX_ART[n]||"")+'" width="'+Math.round(z[0]*h/z[1])+'" height="'+h+'" alt="'+(alt||"")+'"'+(alt?'':' aria-hidden="true"')+'>';
  }
  function mxLn(n, size, w){ size = size || 20;
    return '<svg class="home-ln" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+(w||2)+
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(MHX_LINE[n]||"")+'</svg>'; }
  function mxBadge(t, tone, bw){ return '<span class="home-bdg '+tone+(bw?' fit" style="width:'+bw+'%':'')+'">'+esc(t)+'</span>'; }
  function mxLogo(){ return '<a class="home-logo" href="'+AUTH.homeHref()+'" aria-label="소개뱅크 메인으로">'+mxPic("logo",48,"소개뱅크")+'</a>'; }
  function mxGwanHref(code){ return code==="HLT" ? "#/health" : AUTH.gwanHref(code); }
  function mxGwanOn(code){ return liveGwan().some(function(g){ return g.code===code; }); }

  /* 메인 전용 헤더 — 관 메뉴(관 이름 그대로) + 소개광장 + 이용안내 · 검색 · 로그인 · 무료 회원가입 */
  function mxHeader(){
    var inn = AUTH.isLoggedIn();
    var nm = (AUTH.user && AUTH.user() && AUTH.user().name) || "소개하니";
    return '<header class="home-hd"><div class="home-in">'+mxLogo()+
      '<nav class="gnb">'+liveGwan().map(function(g){
        return '<a href="'+esc(mxGwanHref(g.code))+'">'+esc(g.name)+'</a>'; }).join("")+
        '<a href="#" data-go="commu">소개광장</a><a href="#" data-go="guide">이용안내</a></nav>'+
      '<div class="home-hdr">'+
        '<button type="button" class="home-icbtn" data-mhx="search" aria-label="검색">'+mxLn("search",22,2.4)+'</button>'+
        (inn
          ? '<span class="home-user">👤 '+esc(nm)+'</span>'+
            '<button type="button" class="home-pill" data-go="my">나의공간</button>'+
            '<button type="button" class="home-pill" data-auth="out">로그아웃</button>'+
            /* 운영 진입점 — 공통 헤더와 같습니다. ⚠ 서버를 붙일 때 운영자 권한으로 가려야 합니다. */
            '<button type="button" class="home-pill p" data-go="adm">관리자 페이지</button>'
          : '<button type="button" class="home-pill" data-auth="in">로그인</button>'+
            '<button type="button" class="home-pill p" data-go="join">'+esc(CFG.promo.on ? CFG.promo.label : CFG.promo.alt)+'</button>')+
      '</div></div></header>';
  }

  /* 히어로 오른쪽 카드 — 첫 장은 HERO 광고(__AD.heroSlot() 그대로 · 소재가 있을 때), 나머지는 안내.
     그림은 「2 / 5」 장(전문가 포트폴리오)을 보여 주므로 처음에 그 장을 엽니다. 그 장의 그림은 주신 그림 그대로입니다. */
  function mxSlides(){
    var L = [["pf","전문가 포트폴리오","인기 포트폴리오를\n바로 확인하세요","검증된 전문가들의\n실제 작업물과 후기를 한눈에!","지금 둘러보기","MAL","promo-art"]];
    if(mxGwanOn("BIZ")) L.push(["biz","소개창업","뜨는 창업 아이템을\n한눈에 보세요","관심이 모이는 창업 매물을\n모았습니다","지금 둘러보기","BIZ",["pick-3","start-2"]]);
    if(mxGwanOn("HLT")) L.push(["hlt","소개뱅크몰","필요한 상품을\n비교해 보세요","건강관 상품부터\n차례로 넓혀 갑니다","지금 둘러보기","HLT",["pick-1","poll-purifier"]]);
    L.push(["commu","소개광장","우리 이야기를\n나눠 보세요","소개 후기와 동네 이야기를\n함께 봅니다","지금 둘러보기","commu",["pick-4","town-3"]]);
    return L;
  }
  function mxLines(s){ return s.split("\n").map(function(x){ return '<span>'+esc(x)+'</span>'; }).join(""); }
  function mxPromo(){
    var adh = (window.__AD && window.__AD.heroSlot) ? window.__AD.heroSlot() : "";
    var hasAd = !!adh && adh.indexOf("adhero none") < 0;
    var L = mxSlides(), n = L.length + (hasAd ? 1 : 0);
    var i = (S.mhxSlide == null) ? (hasAd ? 1 : 0) : S.mhxSlide;
    if(i >= n || i < 0) i = 0;
    var onAd = hasAd && i === 0, s = hasAd ? L[i-1] : L[i];
    var top = '<div class="home-ptop"><span class="home-ptag">'+(onAd ? "광고" : esc(s[1]))+'</span>'+
      '<span class="home-pnav"><span class="home-pno" aria-live="polite">'+(i+1)+' / '+n+'</span>'+
      '<button type="button" class="home-pnext" data-mhx="pnext" data-n="'+n+'" data-i="'+i+'" aria-label="다음 안내">'+mxLn("chev",16,2.6)+'</button></span></div>';
    if(onAd)
      return '<aside class="home-promo" aria-label="소개뱅크 안내"><div class="home-ps ad" data-slide="ad">'+top+
        '<div class="home-padw">'+adh+'</div></div></aside>';
    var href = s[5]==="commu" ? "#" : mxGwanHref(s[5]);
    return '<aside class="home-promo" aria-label="소개뱅크 안내"><div class="home-ps" data-slide="'+s[0]+'">'+top+
      '<div class="home-pbody has-art"><h2>'+mxLines(s[2])+'</h2><p>'+mxLines(s[3])+'</p>'+
        '<a class="home-pcta" href="'+esc(href)+'"'+(s[5]==="commu"?' data-go="commu"':'')+'>'+esc(s[4])+' '+mxLn("arrow",18,2.4)+'</a>'+
        '<span class="home-part" aria-hidden="true">'+
          (typeof s[6]==="string" ? mxImg(s[6],"home-partimg") : mxImg(s[6][0],"home-pf f0")+mxImg(s[6][1],"home-pf f1"))+'</span>'+
      '</div></div></aside>';
  }
  function mxHero(){
    var tab = S.mhxTab || "ai";
    var cur = MHX_TABS.filter(function(t){ return t[0]===tab; })[0] || MHX_TABS[0];
    return '<section class="home-hero" aria-labelledby="mh-h1"><div class="home-in">'+
      '<div class="home-heroin"><div class="home-herol">'+
        '<span class="home-aibdg">'+mxPic("spark-s",19)+' 소뱅AI 연결</span>'+
        '<h1 id="mh-h1">무엇을 찾고 계세요?<br><em>소뱅AI가 딱 맞는 소개</em>를 이어드려요.</h1>'+
        '<p class="home-lead">사람, 상품, 서비스, 창업, 동네정보까지 <br>소개뱅크 안에서 더 빠르고 똑똑하게 연결해드려요.</p>'+
        '<div class="home-search">'+
          '<div class="home-stabs" role="tablist" aria-label="검색 범위">'+MHX_TABS.map(function(t){
            var on = t[0]===cur[0];
            return '<button type="button" role="tab" aria-selected="'+on+'" class="home-stab'+(on?" on":"")+'" data-mhxtab="'+t[0]+'" data-ph="'+esc(t[2])+'">'+esc(t[1])+'</button>';
          }).join("")+'</div>'+
          /* 검색창을 누르면 기존 검색 팝업(spop)이 열립니다 — .si · #mh-q · form.mh-sb 는 그 연결에 쓰는 이름이라 그대로 둡니다 */
          '<form class="home-sb mh-sb" role="search" data-search="1" action="#" novalidate data-scope="'+cur[0]+'">'+
            '<div class="home-sbin"><span class="home-spark" aria-hidden="true">'+mxPic("spark",34)+'</span>'+
              '<span class="home-sbtx"><label class="home-sblab" for="mh-q">소개뱅크에서 무엇이든 물어보세요</label>'+
              '<input class="si" id="mh-q" name="q" type="search" autocomplete="off" placeholder="'+esc(cur[2])+'"'+
              ' role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sugl" value="'+esc(S.q||"")+'"></span>'+
              '<button class="home-go" type="submit" aria-label="검색">'+mxLn("search",24,2.6)+'</button></div>'+
            '<ul class="sug" id="sugl" role="listbox" hidden></ul>'+
          '</form></div>'+
      '</div>'+mxPromo()+'</div>'+
      '<div class="home-chips">'+MHX_CHIPS.map(function(c){
        return '<button type="button" class="home-chip mh-chip" data-q="'+esc(c)+'">'+mxLn("search",18,2.4)+esc(c)+'</button>'; }).join("")+'</div>'+
    '</div></section>';
  }
  function mxHead(ic, t, d, go){
    return '<div class="home-sh">'+mxPic(ic,36)+'<h2>'+esc(t)+'</h2>'+(d?'<span class="home-sd">'+d+'</span>':'')+
      (go ? '<a class="home-more" href="'+esc(go[1]||"#")+'"'+(go[0]?' data-go="'+go[0]+'"':'')+'>전체보기 '+mxLn("chev",14,2.4)+'</a>' : '')+'</div>';
  }
  function mxRank(k, badge, tone, title, user, art, rows, attr){
    return '<article class="home-rk" data-rank="'+k+'"><div class="home-rkh"><span class="home-bdg '+tone+'">'+esc(badge)+'</span>'+
      '<h3>'+(user?mxPic("rank-user",22):'')+esc(title)+'</h3></div><span class="home-rka" aria-hidden="true">'+mxImg(art)+'</span>'+
      '<ol class="home-rkl">'+rows.map(function(r,i){ return '<li><a '+attr+'><i>'+(i+1)+'</i><span>'+esc(r)+'</span></a></li>'; }).join("")+'</ol></article>';
  }
  function mxToday(){
    return '<section class="home-band today"><div class="home-in">'+
      mxHead("sec-today","오늘의 소개뱅크","지금 가장 많이 찾는 정보와 실시간 트렌드를 확인해보세요.",["src","#"])+
      /* 큰 배너 — 그림의 배너를 그대로 깔고, 글자 자리에 같은 글을 화면 요소로 덮습니다(선명하게 · 누를 수 있게) */
      '<div class="home-today"><div class="home-bn">'+mxImg("banner")+
        '<div class="home-bnc"><span class="home-hot">'+mxPic("flame",22)+' 지금 가장 많이 찾는 곳</span>'+
        '<h3>가을 나들이 맛집<br>TOP 10</h3><p>지금 많이 찾는 가족 외식 장소를<br>소개해드려요.</p>'+
        '<a class="home-dark" href="#" data-go="commu">지금 바로 보기 '+mxLn("arrow",18,2.4)+'</a></div></div>'+
      '<div class="home-rks3">'+
        (mxGwanOn("HLT") ? mxRank("product","실시간 LIVE","red","인기 급상승 상품",0,"rank-1",["음식물처리기","에어프라이어","커피머신"],'href="#/health"') : '')+
        mxRank("request","NEW","blue","소개를 기다리는 요청",0,"rank-2",["세무 상담이 필요해요","상가 인테리어 업체","학원 강사 구해요"],'href="#" data-go="reql"')+
        mxRank("community","우리동네 인기","violet","판교 · 분당",1,"rank-3",["판교 가족식당","분당 의원","정자동 카페"],'href="#" data-go="commu"')+
      '</div></div></div></section>';
  }
  function mxNeeds(){
    var N = [["HLT","need-1","물건이 필요해요","다양한 상품을","비교하고 구매하세요"],["MNY","need-2","사람을 찾고 있어요","전문가 · 인맥을","연결해드려요"],
             ["MAL","need-3","업체가 필요해요","믿을 수 있는 업체를","소개받으세요"],["BIZ","need-4","창업을 알아봐요","유망한 창업 아이템을","확인하세요"],
             ["CMU","need-5","동네정보가 궁금해요","우리동네 맛집, 생활정보를","만나보세요"]]
      .filter(function(c){ return c[0]==="CMU" || mxGwanOn(c[0]); });
    return '<section class="home-band needs"><div class="home-in">'+
      mxHead("sec-need","지금, 어떤 소개가 필요하세요?","원하는 목적을 선택하면, 소개뱅크가 딱 맞는 정보를 찾아드려요.")+
      '<nav class="home-needs" aria-label="관 바로가기" style="--n:'+N.length+'">'+N.map(function(c){
        return '<a class="home-nd" data-gwan="'+c[0]+'" '+(c[0]==="CMU"?'href="#" data-go="commu"':'href="'+esc(mxGwanHref(c[0]))+'"')+'>'+mxPic(c[1],50)+
          '<b>'+c[2]+'</b><span>'+c[3]+' <br>'+c[4]+'</span><i aria-hidden="true">'+mxLn("chev",18,2.4)+'</i></a>'; }).join("")+'</nav></div></section>';
  }
  function mxPicks(){
    /* [꼬리표, 색, 꼬리표 폭(%), 종류, 사진, 제목, 굵은 값, 할인율, 설명, 별점, 이동] — 그림의 5장 그대로 */
    var P = [["오늘 할인 TOP","hot",56,"상품","pick-1","AI 음식물처리기 A1","238,000원","32%","","4.8 (532)",'href="#/health"'],
             ["본사 검증","teal",40,"전문가","pick-2","김현우 세무사","","","개인 · 법인 세무 상담","4.9 (320)",'href="#/mal/consult"'],
             ["관심 급상승","hot",51,"창업","pick-3","무인 스터디카페 창업","","","3천만원 이하 가능","4.7 (118)",'href="'+esc(mxGwanHref("BIZ"))+'"'],
             ["내 주변","mint",39,"동네정보","pick-4","판교 가족식당 추천","","","도보 5분 · 후기 1,234건","4.8 (1,234)",'href="#" data-go="commu"'],
             ["1,842명 참여","blue",55,"설문","pick-5","카페에서 중요한 것은?","","","지금 투표해보세요","4.6 (1,842)",'href="#" data-go="commu"']];
    return '<section class="home-band picks"><div class="home-in">'+
      mxHead("sec-pick","오늘의 PICK","지금 주목받는 상품, 전문가, 창업아이템, 동네정보를 한눈에!",["src","#"])+
      '<div class="home-railw"><div class="home-rail" role="list" aria-label="오늘의 PICK" tabindex="0">'+P.map(function(c){
        return '<a class="home-pk" role="listitem" data-kind="'+c[3]+'" '+c[10]+'><span class="home-pki">'+mxImg(c[4])+mxBadge(c[0],c[1],c[2])+'</span>'+
          '<span class="home-pkb"><span class="home-kind'+(c[1]==="hot"?"":" "+c[1])+'">'+c[3]+'</span><b>'+esc(c[5])+'</b>'+
          (c[6]?'<strong>'+c[6]+(c[7]?'<em class="home-off">'+c[7]+'</em>':'')+'</strong>':'')+
          (c[8]?'<span class="home-pks">'+esc(c[8])+'</span>':'')+
          (c[9]?'<span class="home-pkm home-rate">'+mxPic("star",15)+' '+c[9]+'</span>':'')+'</span></a>'; }).join("")+'</div>'+
      '<button type="button" class="home-railnext" data-mhx="railnext" aria-label="다음 보기">'+mxLn("chev",20,2.6)+'</button></div></div></section>';
  }
  /* 이건 어때? — v10.14: 실제 웹처럼 **고르고 투표합니다**(서버 D021). 상태 · 규칙은 투표 모듈(M_poll → window.__PX)이 들고 있고,
     여기는 그림의 모양대로 그리기만 합니다. 참여 수는 실제 표 수입니다(그림의 3,482명 등은 쓰지 않습니다 — 사장님 결정).
     그 종류의 열린 투표가 없으면 그림의 문구로 모양만 두고 「준비 중」으로 표시합니다. */
  function mxPoll(){
    var P = window.__PX, hm = P ? P.home() : {};
    function art(n, fb){ return mxImg(MHX_ART[n] ? n : fb); }
    function foot(p, cta){
      var can = P.canVote(p), my = P.mine(p), t = P.total(p), m = P.state.msg[p.id];
      return '<div class="home-plf">'+
        (can ? '<button type="button" class="home-vbtn" data-px="vote" data-id="'+p.id+'" data-vote>'+cta+' '+mxLn("arrow",16,2.4)+'</button>'
             : '<span class="home-vdone" data-done>'+(my ? '투표했습니다' : '마감된 투표')+'</span>')+
        '<span data-total="'+t+'">'+t.toLocaleString("ko-KR")+'명 참여</span></div>'+
        (m ? '<p class="home-plmsg '+m[0]+'" role="'+(m[0]==="ok"?"status":"alert")+'" data-n="'+P.state.n+'">'+esc(m[1])+
             (m[0]==="login" ? ' <a href="#" data-go="login">로그인</a>' : '')+'</p>' : '');
    }
    function row(p, o){
      var can = P.canVote(p), res = P.result(p), on = can ? P.state.sel[p.id]===o.id : P.mine(p)===o.id, v = P.pct(p, o);
      var inner = '<i aria-hidden="true"></i><span>'+esc(o.label)+'</span>'+(res ? '<em>'+v+'%</em>' : '');
      return '<li class="'+(res?'res':'')+(on?' on':'')+'"'+(res?' style="--p:'+v+'%"':'')+'>'+
        (can ? '<button type="button" class="home-opt" role="radio" aria-checked="'+on+'" data-px="pick" data-id="'+p.id+'" data-opt="'+o.id+'">'+inner+'</button>'
             : '<span class="home-opt" data-opt="'+o.id+'">'+inner+'</span>')+'</li>';
    }
    function tile(p, o, fb){
      if(!o) return '';
      var can = P.canVote(p), res = P.result(p), on = can ? P.state.sel[p.id]===o.id : P.mine(p)===o.id;
      var inner = art(o.img, fb)+'<b>'+esc(o.label)+'</b><span>'+(res ? P.pct(p,o)+'% · '+o.n.toLocaleString("ko-KR")+'표' : esc(o.sub||" "))+'</span>';
      return can ? '<button type="button" class="home-vsi'+(on?' on':'')+'" aria-pressed="'+on+'" data-px="pick" data-id="'+p.id+'" data-opt="'+o.id+'">'+inner+'</button>'
                 : '<span class="home-vsi'+(on?' on':'')+'" data-opt="'+o.id+'">'+inner+'</span>';
    }
    function open(p){ return '<article class="home-pl" data-poll="'+p.id+'" data-kind="'+p.kind+'" data-voted="'+(P.mine(p)?1:0)+'">'; }
    function soonFoot(w){ return '<div class="home-plf"><a class="home-vbtn" href="#" data-go="cmupoll">투표 보러 가기 '+mxLn("arrow",16,2.4)+'</a><span>'+w+'</span></div>'; }
    function soonRows(a){ return '<ul>'+a.map(function(o){ return '<li><span class="home-opt"><i aria-hidden="true"></i><span>'+o+'</span></span></li>'; }).join("")+'</ul>'; }
    var vs = hm.VS, ask = hm.ASK, used = hm.USED;
    return '<section class="home-band poll"><div class="home-in">'+
      mxHead("sec-poll","이건 어때? 여러분의 의견을 알려주세요.","실제 사용자들의 생각이 더 나은 선택을 만듭니다.",["cmupoll","#"])+
      '<div class="home-polls">'+
        (vs ? open(vs)+'<span class="home-bdg blue">비교해요</span><h3>'+esc(vs.title)+'</h3>'+
              '<div class="home-vs" role="group" aria-label="'+esc(vs.title)+'">'+tile(vs, vs.opts[0], "vs-a")+'<i aria-hidden="true">VS</i>'+tile(vs, vs.opts[1], "vs-b")+'</div>'+
              foot(vs, "투표하기")+'</article>'
            : '<article class="home-pl" data-kind="VS" data-soon="1"><span class="home-bdg blue">비교해요</span><span class="home-exs">준비 중</span><h3>로봇청소기를 산다면, 어느 쪽을 고르시겠어요?</h3>'+
              '<div class="home-vs"><span class="home-vsi">'+mxImg("vs-a")+'<b>흡입력 우선</b><span>값이 더 나가도 잘 빨아들이는 쪽</span></span><i aria-hidden="true">VS</i>'+
              '<span class="home-vsi">'+mxImg("vs-b")+'<b>가성비 우선</b><span>기본 기능에 값이 싼 쪽</span></span></div>'+soonFoot("투표는 곧 열립니다")+'</article>')+
        (ask ? open(ask)+'<span class="home-bdg lilac">궁금해요</span><h3>'+esc(ask.title)+'</h3>'+
               '<div class="home-ask"><ul role="radiogroup" aria-label="'+esc(ask.title)+'">'+ask.opts.map(function(o){ return row(ask, o); }).join("")+'</ul>'+
               '<span class="home-aska" aria-hidden="true">'+art(ask.img, "poll-bags")+'</span></div>'+foot(ask, "투표하기")+'</article>'
             : '<article class="home-pl" data-kind="ASK" data-soon="1"><span class="home-bdg lilac">궁금해요</span><span class="home-exs">준비 중</span><h3>소개받아 살 때 가장 먼저 보는 것은?</h3>'+
               '<div class="home-ask">'+soonRows(["가격","써 본 사람의 후기","소개한 사람에 대한 믿음","사후관리(A/S)","브랜드"])+'<span class="home-aska" aria-hidden="true">'+mxImg("poll-bags")+'</span></div>'+
               soonFoot("투표는 곧 열립니다")+'</article>')+
        (used ? open(used)+'<span class="home-bdg mint">써본 의견이 필요해요</span><h3>'+esc(used.title)+'</h3>'+
                '<div class="home-op"><span class="home-opa" aria-hidden="true">'+art(used.img, "poll-purifier")+'</span>'+
                '<div>'+(used.desc ? '<p class="home-opd">'+esc(used.desc)+'</p>' : '')+
                '<ul role="radiogroup" aria-label="'+esc(used.title)+'">'+used.opts.map(function(o){ return row(used, o); }).join("")+'</ul></div></div>'+
                foot(used, "의견 남기기")+'</article>'
              : '<article class="home-pl" data-kind="USED" data-soon="1"><span class="home-bdg mint">써본 의견이 필요해요</span><span class="home-exs">준비 중</span>'+
                '<h3>공기청정기를 써 보신 분들의 의견을 들려주세요!</h3><div class="home-op"><span class="home-opa" aria-hidden="true">'+mxImg("poll-purifier")+'</span>'+
                '<div><p class="home-opd">필터 값 · 소음 · 전기료 — 솔직한 의견을 기다려요.</p>'+soonRows(["사용 중이에요","사용해봤어요","아직 안 써봤어요"])+'</div></div>'+
                soonFoot("의견 남기기는 곧 열립니다")+'</article>')+
      '</div></div></section>';
  }
  function mxStrip(){
    return '<div class="home-band strip"><div class="home-in"><a class="home-strip" href="#" data-go="commu">'+
      '<span class="home-stl" aria-hidden="true">'+mxImg("strip-left")+'</span>'+
      '<span class="home-stc"><span class="home-sttag">가을엔, 우리동네가 더 특별해요</span><b>지금, 동네 <em>맛집 카페</em>를 만나보세요!</b>'+
      '<span>소개뱅크가 추천하는 우리동네 감성 핫플레이스</span></span>'+
      '<span class="home-stleaf" aria-hidden="true">'+mxImg("leaf-1")+mxImg("leaf-2")+'</span>'+
      '<span class="home-stb">지금 둘러보기 '+mxLn("arrow",18,2.4)+'</span>'+
      '<span class="home-str" aria-hidden="true">'+mxImg("strip-right")+'</span></a></div></div>';
  }
  function mxTown(){
    var T = [["동네픽","지금 핫한 맛집","우리동네 사람들이","많이 찾는 맛집이에요.","town-1","판교역 300m"],
             ["동네소개","우리동네 가볼 만한 곳","카페, 핫플, 맛집, 생활정보까지","한눈에 확인하세요.","town-2","정자동 500m"],
             ["동네참여","우리동네 이야기","지금 우리동네 사람들의","생생한 이야기를 만나보세요.","town-3","분당구 1km"]];
    return '<section class="home-band town"><div class="home-in">'+
      mxHead("sec-town","지금 우리동네",mxPic("town-pin",24)+' 내 위치 기준으로 바로 보여드려요. (위치 허용 시)',["commu","#"]).replace('class="home-sd"','class="home-sd pin"')+
      '<div class="home-towns">'+T.map(function(t){
        return '<a class="home-tw" href="#" data-go="commu"><span class="home-twi" aria-hidden="true">'+mxImg(t[4])+'</span>'+
          '<span class="home-twb"><span class="home-bdg sky">'+t[0]+'</span><b>'+t[1]+'</b><span>'+t[2]+'<br>'+t[3]+'</span></span>'+
          '<span class="home-twl">'+mxLn("pin",15)+' '+t[5]+' '+mxLn("chev",15,2.4)+'</span></a>'; }).join("")+'</div></div></section>';
  }
  function mxTrust(){
    var T = [["trust-1","전문가 소개","검증된 전문가와 1:1 상담","",'href="#/mal/consult"'],
             ["trust-2","업체 소개","믿을 수 있는 지역업체","",'href="'+esc(mxGwanHref("MAL"))+'"'],
             ["trust-3","물건 소개","검증된 인기 상품","",'href="'+esc(mxGwanHref("MAL"))+'"'],
             ["trust-4","당일연락 소개","이사 · 청소 · 수리 등","검증된 당일 연락",'href="#/mal/consult"']];
    return '<section class="home-band trust"><div class="home-in">'+
      mxHead("sec-trust","믿고 연결받는 안심소개","본사 차원 · 검증된 전문가와 업체만 소개해드립니다.",["",mxGwanHref("MAL")])+
      '<div class="home-trusts">'+T.map(function(t){
        return '<a class="home-tr" '+t[4]+'><span class="home-tri">'+mxPic(t[0],72)+'</span><span class="home-trb"><b>'+t[1]+'</b>'+
          '<span>'+t[2]+(t[3]?'<br>'+t[3]:'')+'</span><em>소개받기 '+mxLn("arrow",16,2.4)+'</em></span></a>'; }).join("")+'</div></div></section>';
  }
  function mxStartup(){
    var B = [["관심 급상승 +30%","hot",53,"start-1","무인카페 창업","저렴한 초기비용으로 시작"],["3천만원 이하","blue",43,"start-2","무인 편의점 창업","소자본으로 가능한 창업"],
             ["1인 운영","hot",32,"start-3","반려동물 케어샵","1인으로 운영 가능한 아이템"],["무점포","hot",31,"start-4","1인 온라인 스토어","지금 많이 시작하는 창업"]];
    return '<section class="home-band startup"><div class="home-in">'+
      mxHead("sec-startup","최근 뜨는 창업","새로운 시작을 소개뱅크와 함께하세요.",["",mxGwanHref("BIZ")])+
      '<div class="home-starts">'+B.map(function(b){
        return '<a class="home-st" href="'+esc(mxGwanHref("BIZ"))+'"><span class="home-sti">'+mxImg(b[3])+mxBadge(b[0],b[1],b[2])+'</span>'+
          '<b>'+b[4]+'</b><span>'+b[5]+'</span></a>'; }).join("")+'</div></div></section>';
  }
  function mxForMe(){
    var inn = AUTH.isLoggedIn();
    return '<section class="home-band forme"><div class="home-in"><div class="home-forme">'+mxPic("sec-forme",38)+'<h2>나를 위한 소개</h2>'+
      '<span class="home-sd">'+(inn?'관심 성향을 넣으면 추천이 더 정확해져요.':'로그인하면 관심사와 활동을 바탕으로 맞춤 소개를 보여드려요.')+'</span>'+
      '<span class="home-fma">'+(inn
        ? '<button type="button" class="home-pill p" data-go="aiprf">성향 분석하고 추천받기</button>'
        : '<button type="button" class="home-pill" data-auth="in">로그인</button>'+
          '<button type="button" class="home-pill p" data-go="join">'+esc(CFG.promo.on ? CFG.promo.label : CFG.promo.alt)+'</button>')+
      '</span></div></div></section>';
  }
  function mxCore(){
    var C = [["core-1","AI로 찾고","필요한 것을 빠르게 찾아줘요",'href="#mh-q"'],["core-2","실시간으로 비교하고","여러 정보를 한 번에",'href="#" data-go="airec"'],
             ["core-3","안심하고 소개받고","검증된 연결로 안심하게",'href="'+esc(mxGwanHref("MAL"))+'"'],["core-4","좋은 연결로 이어져요","사람 · 상품 · 기업의 연결",'href="#" data-go="reql"']];
    return '<section class="home-band core"><div class="home-in"><div class="home-cores">'+
      '<div class="home-coreh">'+mxPic("sec-core",36)+'<h2>소개뱅크 핵심</h2></div>'+C.map(function(c){
        return '<a class="home-core" '+c[3]+'>'+mxPic(c[0],40)+'<span><b>'+c[1]+'</b><span>'+c[2]+'</span></span></a>'; }).join("")+'</div></div></section>';
  }
  /* 메인 전용 푸터 — 그림의 모양(로고 · 링크 · 사회관계망 · 저작권) + 바로가기 + 법정 표시(어느 화면에서도 빠지면 안 됩니다) */
  function mxFooter(){
    var t = CFG.site, inn = AUTH.isLoggedIn(), adm = mhIsAdmin();
    var Q = [["소개받기","reql"],["제휴 파트너센터","p2dsh",1],["안심소개 파트너센터","ptn"],["AI 자동 분류","aicls"],["AI 추천","airec"],
             ["성향 분석","aiprf"],["나의공간","my"],["고객센터","cs"],["광고 관리","admad",2]]
      .filter(function(q){ return !q[2] || (q[2]===1 && inn) || (q[2]===2 && adm); });
    /* v10.14 — 사회관계망 주소는 운영 「사이트 기본 정보」에서 넣습니다. 주소를 넣은 아이콘만 그 주소로(새 창) 연결되고, 비면 「준비 중」입니다 */
    var SNS = [["페이스북","sns-1","facebook"],["인스타그램","sns-2","instagram"],["엑스","sns-3","x"],["유튜브","sns-4","youtube"]];
    var PXS = window.__PX || null;
    return '<footer class="home-ft"><div class="home-in"><div class="home-ftr">'+mxLogo()+
      '<div class="home-ftl">'+t.links.map(function(l){
        var d = FTLINK[l];
        return (d && d.go) ? '<a href="#" data-go="'+d.go+'"'+(d.tip?' title="'+esc(d.tip)+'"':'')+'>'+esc(l)+'</a>'
                           : '<a href="#" data-t="'+esc(l)+' — '+esc(FTNOTE)+'">'+esc(l)+'</a>'; }).join("")+'</div>'+
      '<div class="home-ftend"><div class="home-sns">'+SNS.map(function(x){
        var u = PXS ? PXS.state.sns[x[2]] : "";
        return (PXS && PXS.snsOk(u))
          ? '<a class="home-snsi on" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer" aria-label="'+x[0]+' (새 창)" data-sns="'+x[2]+'">'+mxPic(x[1],30)+'</a>'
          : '<button type="button" class="home-snsi" data-t="'+x[0]+' 계정은 준비 중입니다." aria-label="'+x[0]+' — 준비 중" data-sns="'+x[2]+'">'+mxPic(x[1],30)+'</button>'; }).join("")+'</div>'+
      '<span class="home-copy">© '+new Date().getFullYear()+' 소개뱅크. All rights reserved.</span></div></div>'+
      '<nav class="home-quick" aria-label="바로가기">'+Q.map(function(q){ return '<a href="#" data-go="'+q[1]+'">'+q[0]+'</a>'; }).join("")+'</nav>'+
      '<div class="home-legal"><p><b>'+esc(t.corp)+'</b> · 대표 '+fv(t.ceo)+' · 사업자등록번호 '+fv(t.biz)+' · 통신판매업 신고번호 '+fv(t.mail)+'<br>'+
        '직업정보제공사업 신고번호 '+fv(t.job)+' · 주소 '+fv(t.addr)+' · 전화 '+fv(t.tel)+' · 개인정보보호책임자 '+fv(t.privacy)+' · 호스팅 '+fv(t.host)+'</p>'+
        '<p class="home-notice"><b>소개뱅크는 통신판매중개자이며 거래의 당사자가 아닙니다.</b> 상품 · 서비스 · 사업기회에 대한 정보와 거래에 관한 책임은 등록자에게 있습니다.</p>'+
        '<p class="home-artnote">메인의 사진 · 순위 · 평점 · 인물은 <b>디자인 예시</b>입니다(「이건 어때?」의 참여 수는 실제로 넣은 표 수) — 실제 매물 · 상품 · 후기가 아닙니다. 다른 화면의 사진도 <b>목업(예시)</b>이며 운영에서는 <b>등록자가 올린 사진</b>으로 바뀝니다.</p></div>'+
    '</div></footer>';
  }
  /* 메인 한 장 — 헤더부터 푸터까지. 시연용 진입 바(demoBar)는 본문 끝에 그대로 둡니다 */
  function mainPageX(){
    return '<div class="home" data-content="sample">'+mxHeader()+mxHero()+mxToday()+mxNeeds()+mxPicks()+mxPoll()+mxStrip()+mxTown()+
      (mxGwanOn("MAL") ? mxTrust() : '')+(mxGwanOn("BIZ") ? mxStartup() : '')+mxForMe()+mxCore()+
      (window.__AD && window.__AD.demoBar ? '<div class="wrap home-demo">'+window.__AD.demoBar()+'</div>' : '')+
      mxFooter()+'</div>';
  }
  /* 새 메인의 동작 — 검색 탭 · 안내 카드 넘기기 · PICK 화살표 · 헤더 검색 */
  document.addEventListener("click", function(ev){
    var t = ev.target.closest && ev.target.closest("[data-mhxtab]");
    if(t){
      ev.preventDefault();
      S.mhxTab = t.getAttribute("data-mhxtab");
      var box = t.parentNode, i, q = document.getElementById("mh-q"), f = document.querySelector("form.home-sb");
      for(i = 0; i < box.children.length; i++){
        var on = box.children[i] === t;
        box.children[i].classList.toggle("on", on); box.children[i].setAttribute("aria-selected", on ? "true" : "false");
      }
      if(q) q.setAttribute("placeholder", t.getAttribute("data-ph") || "");
      if(f) f.setAttribute("data-scope", S.mhxTab);
      return;
    }
    var b = ev.target.closest && ev.target.closest("[data-mhx]");
    if(!b) return;
    var k = b.getAttribute("data-mhx");
    ev.preventDefault();
    if(k === "pnext"){
      S.mhxSlide = (Number(b.getAttribute("data-i")) + 1) % Number(b.getAttribute("data-n"));
      render();
    } else if(k === "railnext"){
      var r = document.querySelector(".home-rail"); if(!r) return;
      /* 카드가 한 화면에 다 들어와 넘길 것이 없으면(그림의 5장) 「전체보기」와 같은 곳으로 갑니다 */
      if(r.scrollWidth <= r.clientWidth + 8){ go("src"); return; }
      var end = r.scrollLeft + r.clientWidth >= r.scrollWidth - 8;
      r.scrollTo({ left: end ? 0 : r.scrollLeft + Math.round(r.clientWidth * 0.8), behavior: "smooth" });
      r.setAttribute("data-moved", String((Number(r.getAttribute("data-moved")) || 0) + 1));   /* 넘겼다는 표시 — 화면 낭독기 · 점검 도구가 변화를 알 수 있게 */
    } else if(k === "search"){
      var i2 = document.getElementById("mh-q"); if(i2) i2.focus();
    }
  });
