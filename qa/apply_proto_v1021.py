"""시안(spec/proto.html)에 v10.21 을 넣습니다.

  python3 apply_proto_v1021.py     (v10.20 시안에 한 번 — 이미 v10.21 이면 아무것도 하지 않습니다)
  BASE=/path/SGB_Prototype_v10_20.html python3 apply_proto_v1021.py    (v10.20 파일에서 다시 만들 때)

넣는 것 (10/7 사장님 지시 — 「매물 카드의 제목 · 분류 · 금액 · 지역 · 사진을 상세 화면에 넘겨 그립니다(소개장터 · 안심소개 · 소개창업 상세).
        마이 「관심」은 항목의 관에 맞는 상세로. 주소도 항목마다 다르게, 그림과 같은 형식으로 변경, 1:1 문의 · 관심 담기 · 신고하기 버튼 추가」
        · 버튼 자리 답 「맨 아래 줄에 합치기」)
  1. 매물 장부 — 관 목록(소개장터 · 안심소개 · 소개창업) · 급구급매 · 마이 관심 · 견본 3건에 매물번호를 붙입니다.
  2. 매물 상세 한 틀(detailFor) — 세 관의 상세가 그림 1(소개창업 상세) 형식. 제목 · 분류 · 금액 · 지역 · 사진은 누른 매물의 값.
     맨 아래 줄 「관심 담기 · 질문 N · 공유하기 · 신고 · 1:1 문의 시작」. 관별 안내(안심소개 소개코드 공유 · 노출료 / 소개장터 소개비 협의 / 귀속)는 그대로.
  3. 주소 — #/g/{관}/l/{매물번호}. 카드(랜딩 · 전체 목록 · 급구급매)는 그 매물의 주소로 갑니다.
  4. 마이 「관심」의 「보기」 · 「1:1 문의」가 항목의 관 · 번호로.
  5. 문의방 — #/g/{관}/chat/{매물번호}. 위쪽 요약이 그 매물, 「리스팅 보기」 · 「돌아가기」가 처음 매물로.
  6. 돌아가기 글의 옛 관 이름(소개머니 · 소개몰) → 소개장터 · 안심소개.
  7. 판 이름 v10.21
새 화면 · 없앤 화면은 없습니다(화면 수 189 · 화면 ID 는 그대로).
"""
import os, re, shutil

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
P = os.path.join(K, 'spec/proto.html')
BASE = os.environ.get('BASE')
if BASE:
    shutil.copyfile(BASE, P)
s = open(P, encoding='utf-8').read()
n0 = len(s)
if re.search(r'<title>소개뱅크 시안 v10\.21 ', s):
    print('이미 v10.21 입니다 — 바꾸지 않았습니다'); raise SystemExit(0)
assert re.search(r'<title>소개뱅크 시안 v10\.20 ', s), 'v10.20 시안이 아닙니다'

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, (old[:70], s.count(old))
    s = s.replace(old, new)

# ── 1 · 2. 매물 장부 + 상세 한 틀 (화면 묶음 ① — scDetail 자리) ─────────────────────
i0 = s.index('  function scDetail(){\n'); i1 = s.index('  /* ============ 소개받기 — 요청 등록 · 목록 · 제안 ============ */')
old_detail = s[i0:i1]
assert "/*PD:v10.20*/" in old_detail and len(re.findall(r'\n  function \w+\(', '\n' + old_detail)) == 1, re.findall(r'\n  function \w+\(', '\n' + old_detail)

NEW_DETAIL = r'''  /* ══ v10.21 매물 장부 ═══════════════════════════════════════════
   * 10/7 지시 — 「매물 카드의 제목 · 분류 · 금액 · 지역 · 사진을 상세 화면에 넘겨 그립니다 … 주소도 항목마다 다르게」.
   * 전에는 상세 화면이 관마다 한 건으로 고정이라 무엇을 눌러도 같은 상세가 나왔습니다(목록표 E-01 · G-122).
   * 카드가 쓰는 자료(관 목록 · 급구급매 · 마이 관심)에 매물번호를 붙여 두고, 상세는 주소의 번호로 그 매물을 찾아 그립니다.
   *   소개장터 5101~ · 안심소개 6101~ · 소개창업 7101~ · 급구급매 8101~ · 마이 관심은 그 번호(L-3301 → 3301)
   *   견본 3건(앞 판의 고정 상세)은 번호 그대로 — 소개창업 1042 · 소개장터 4471 · 안심소개 4468
   * 실제 서비스에서는 서버의 매물 id 가 이 번호 자리에 옵니다(/money/{id} · /mall/{id} · /biz/{id}). */
  var ITEMS = null, ITEMKEY = null, LIKES = [];
  var SAMPLE_NO = { BIZ:"1042", MNY:"4471", MAL:"4468" };
  var PHOTO_MAP = [
    ['자동차','car'],['중고차','car'],['오토바이','car'],['상용차','truck'],['화물','truck'],['물류','truck'],
    ['가전','mac'],['디지털','mac'],['장비','cnc'],['부품','cnc'],['기계','cnc'],['설비','fridge'],
    ['인테리어','int'],['사무실','int'],['가구','int'],['리모델링','int'],['오피스','int'],['임대','int'],
    ['아파트','apt'],['주택','apt'],['부동산','apt'],['건물','shop'],['상가','shop'],['점포','shop'],
    ['매장','shop'],['양수도','shop'],['토지','land'],['공장','land'],['출점','land'],['총판','land'],
    ['카페','cafe'],['무인','cafe'],['프랜차이즈','cafe'],['창업','cafe'],['가맹','cafe'],
    ['고깃집','bunsik'],['외식','bunsik'],['분식','bunsik'],['배달','bunsik'],
    ['식자재','fruit'],['농수','fruit'],['식품','fruit'],['청과','fruit'],
    ['의류','cloth'],['패션','cloth'],['잡화','cloth'],
    ['태양광','solar'],['에너지','solar'],
    ['인수','mac'],['합병','mac'],['세무','mac'],['법무','mac'],['지분','mac']
  ];
  /* 매물의 사진 — 카드와 상세가 같은 사진을 쓰도록 한 곳에서 고릅니다(자료의 사진 열쇠 → 없으면 분류 이름으로). */
  function photoKey(it){
    var T = (typeof window !== 'undefined' && window.SGB_IMG) || {};
    if (it && it.k && T[it.k]) return it.k;
    var t = String((it && (it.c || it.cd)) || '');
    for (var i = 0; i < PHOTO_MAP.length; i++) if (t.indexOf(PHOTO_MAP[i][0]) >= 0) return PHOTO_MAP[i][1];
    return 'shop';
  }
  function itemThumb(it, cls){
    var T = (typeof window !== 'undefined' && window.SGB_IMG) || {};
    var k = photoKey(it);
    return T[k] ? '<img class="' + (cls || 'thp') + '" src="' + T[k] + '" alt="">' : thumbShape(k);
  }
  function itemsInit(){
    if (ITEMS) return;
    ITEMS = {}; ITEMKEY = {};
    function put(no, g, x){
      var it = {}; for (var k in x) it[k] = x[k];
      it.no = String(no); it.g = g;
      ITEMS[it.no] = it; ITEMKEY[(g || '*') + '|' + it.t] = it.no;
      return it;
    }
    [['MNY',5101],['MAL',6101],['BIZ',7101]].forEach(function(p){
      var G = GLAND[p[0]] || {};
      (G.list || []).forEach(function(x, i){ var it = put(p[1] + i, p[0], x); it.cd = catCanon(G, x.c); });
    });
    (URG || []).forEach(function(x, i){
      put(8101 + i, null, { t:x.n, c:x.c, cd:x.c, p:x.p, r:x.r, a:'등록일 ' + x.dt, l:x.l, k:x.k, d:x.d });
    });
    (LIKES || []).forEach(function(x){
      var no = String(x.id || '').replace(/\D/g, '');
      if (no) put(no, x.g, { t:x.t, c:x.c, cd:x.c, p:'금액 협의', r:'', a:'', l:0, k:'', w:x.w });
    });
    /* 견본 3건 — 앞 판의 고정 상세. 소개창업 견본이 그림 1 그대로입니다. */
    put(1042, 'BIZ', { sample:true, t:'특A급 프리미엄 고깃집 인수 하실 분을 찾습니다.',
      th:'특A급 프리미엄 고깃집<br>인수 하실 분을 찾습니다.', c:'외식 · 식당', cd:'외식 · 식당', p:'8,500만원', r:'서울 강남구', a:'2시간 전', l:18, v:342,
      sub:'서울 강남권, 30평대, 월매출 안정적<br>성실한 창업자/인수자 연결희망합니다.',
      fee:'협의 소개비 1,275,000원 · 양도인 부담',
      desc:'강남 핵심 상권에 위치한 프리미엄 고깃집입니다. 최고급 인테리어와 설비, 검증된 메뉴와 안정적인 단골 고객층을 확보하고 있어 초보 창업자도 안정적인 운영이 가능합니다.',
      spec:[['매장규모','99.2㎡ (약 30평)'],['월매출','8,000만원 내외'],['권리금','협의 가능'],['희망조건','성실한 창업자/인수자'],['인수지원','운영 노하우 전수 및 초기 정착 지원']],
      tail:'현재 운영 중으로 실 매출 확인 및 매장 방문 상담 가능합니다.<br>관심 있으신 분은 편하게 문의 주세요!',
      qs:[['초보자도 창업 가능한가요?','2시간 전'],['지역 제한이 있나요?','3시간 전'],['수수료는 어떻게 되나요?','5시간 전'],['실제 거래까지 얼마나 걸리나요?','1일 전'],
          ['강남 외 지역도 소개 가능한가요?','1일 전'],['현재 권리금은 어떻게 되나요?','2일 전'],['인수 후 운영 지원도 가능한가요?','2일 전']],
      side:[['&#127860;','업종','일반음식점(고기전문)'],['&#128207;','면적','99.2㎡ (30평)'],['&#128200;','월매출','8,000만원 내외'],['&#128176;','권리금','협의'],['&#128077;','희망조건','성실한 창업자/인수자']],
      tags:['강남권','고깃집','창업','인수','외식업'] });
    put(4471, 'MNY', { sample:true, t:'강남 소재 프랜차이즈 본사 식자재 공급처', c:'식자재 · 원부자재', cd:'식자재 · 원부자재', p:'월 1억~1.5억', r:'서울 강남구', a:'3시간 전', l:27, v:268, k:'fruit',
      sub:'프랜차이즈 본사 식자재 정기 공급 · 월 단위<br>강남권 본사 3곳 납품 이력이 있습니다.',
      desc:'강남 소재 프랜차이즈 본사에 식자재를 월 단위로 정기 공급하실 곳을 찾습니다.',
      spec:[['소개 대상','프랜차이즈 본사 식자재 정기 공급'],['규모','월 1억~1.5억'],['거래 형태','월 단위 정기 공급'],['납품 이력','강남권 프랜차이즈 본사 3곳'],['희망 시점','2026-10 내 계약'],['소개비','협의 (A-12)']],
      tail:'납품 조건과 일정은 1:1 문의에서 맞추실 수 있습니다.' });
    put(4468, 'MAL', { sample:true, t:'수도권 물류창고 3,300㎡ 임대 이전 건', c:'부동산 · 상가', cd:'부동산 · 상가', p:'금액 협의', r:'경기 광주', a:'5시간 전', l:14, v:187, k:'truck',
      sub:'3,300㎡ · 층고 10m · 도크 6구<br>임대 또는 인수 조건으로 찾습니다.',
      desc:'수도권 물류창고 3,300㎡ 의 임대 이전 건입니다.',
      spec:[['소개 대상','수도권 물류창고 3,300㎡'],['소재지','경기 광주'],['면적 · 층고','3,300㎡ · 10m'],['도크','6구'],['희망 조건','임대 또는 인수'],['소개비','협의 (A-12)']],
      tail:'현장 확인과 조건 협의는 1:1 문의에서 진행하실 수 있습니다.' });
  }
  /* 카드가 자기 매물번호를 찾을 때 — 관 목록은 (관, 제목), 급구급매는 제목만으로 찾습니다. */
  function itemNo(g, title){ itemsInit(); return ITEMKEY[g + '|' + title] || ITEMKEY['*|' + title] || ''; }
  function itemCat(g, x){ itemsInit(); var no = itemNo(g, x.t); return (no && ITEMS[no].cd) || x.c || '기타'; }
  /* 지금 주소(#/g/{관}/l/{번호})의 매물. 번호가 없거나 다른 관의 것이면 그 관의 견본입니다. */
  function curItem(code){
    itemsInit();
    var it = ITEMS[String(S.listingId || '')];
    if (it && (!it.g || it.g === code)) return it;
    return ITEMS[SAMPLE_NO[code] || SAMPLE_NO.BIZ];
  }
  /* 문의방(#/g/{관}/chat/{번호})이 보고 있는 매물. 번호가 매물이 아니면(예: /chat/8821) 소개창업 견본입니다. */
  function chatItem(){
    itemsInit();
    var it = ITEMS[String(S.chatId || '')];
    if (it) return { it:it, code: it.g || S.gwan || 'MNY' };
    return { it:ITEMS[SAMPLE_NO.BIZ], code:'BIZ' };
  }
  function goHref(h){
    if (!h) return;
    if (/^https?:/.test(h)) { location.href = h; return; }
    if (ROUTE.href) ROUTE.href(h); else go('detail');
  }
  function openItem(no, g){
    itemsInit();
    var it = ITEMS[String(no || '')];
    if (!it) { go('detail'); return; }
    goHref(AUTH.gwanHref(g || it.g || S.gwan || 'MNY', '/l/' + it.no));
  }
  function openChat(no, g){
    itemsInit();
    var it = ITEMS[String(no || '')];
    if (!it) { go('ask'); return; }
    goHref(AUTH.gwanHref(g || it.g || S.gwan || 'MNY', '/chat/' + it.no));
  }
  var GEN_QS = [['아직 거래 가능한가요?','1시간 전'],['지역 제한이 있나요?','3시간 전'],['소개비는 어떻게 정하나요?','5시간 전'],
                ['실제 거래까지 얼마나 걸리나요?','1일 전'],['현장 확인이 가능한가요?','2일 전']];

  /* ══ v10.21 매물 상세 — 세 관이 한 틀입니다 (SB-BIZ-DTL-010 · SB-MNY-DTL-010 · SB-MAL-DTL-010) ══
   * 10/7 지시 — 「그림과 같은 형식으로 변경, 1:1 문의 · 관심 담기 · 신고하기 버튼 추가」(자리 답: 맨 아래 줄에 합치기).
   * 소개창업 상세(그림 1)의 틀에 소개장터 · 안심소개 상세를 맞췄습니다. 제목 · 분류 · 금액 · 지역 · 사진은 누른 매물의 값이고,
   * 소개자 · 소개자 실적 · 후기는 견본입니다. 견본이 아닌 매물의 설명 · 조건표 · 질문은 넘겨받은 값으로 만듭니다
   * (고깃집 설명이 자동차 매물에 나오면 안 됩니다). */
  function detailFor(code){
    var it = curItem(code), no = it.no;
    var cat = it.cd || it.c || '기타', price = it.p || '금액 협의', reg = it.r || '', when = it.a || '';
    var liked = !!S.liked[no], likes = (it.l || 0) + (liked ? 1 : 0), views = it.v || ((it.l || 0) * 19 + 7);
    var qs = it.qs || GEN_QS;
    var feeRow = code === 'MAL' ? '협의 (부동산은 노출료 · A-07)' : '협의 (A-12)';
    var spec = it.spec || [['분류', cat], ['지역', reg || '협의'], ['금액', price], ['등록', when || '—'], ['소개비', feeRow]];
    var desc = it.desc || (esc(gname(code)) + '에 등록된 <b>' + esc(it.t) + '</b> 건입니다.' + (it.d ? ' ' + esc(it.d) + '.' : '') +
               ' 분류 · 지역 · 금액은 아래 조건표와 같습니다.');
    var tail = it.tail || '조건과 일정은 1:1 문의에서 등록자와 직접 맞추실 수 있습니다.';
    var sub = it.sub || (esc((reg ? reg + ' · ' : '') + cat) + '<br>' + (it.d ? esc(it.d) : '조건은 1:1 문의에서 확인하실 수 있습니다.'));
    var side = it.side || [['&#128193;','분류',cat], ['&#128205;','지역',reg || '협의'], ['&#128176;','금액',price], ['&#128337;','등록',when || '—']];
    var tags = it.tags || String((reg ? reg.split(' ')[0] + ' ' : '') + cat).split(/[\s\/·,]+/).filter(function(x){ return x; }).slice(0, 5);
    var photo = (it.sample && code === 'BIZ') ? photoMeat() : itemThumb(it);
    return header({login:true, blueCta:true})+
      '<div class="wrap" style="padding-top:16px">'+ backLink("목록") + search(true, true) +
      '</div>'+   /* 10/6 지시(v10.20) — 상세에서는 소개하기 · 소개받고 싶어요 · 소개받기 버튼과 그 아래 안내 글을 뺍니다 */
    '<div class="wrap" style="padding-top:14px"><div class="panel" style="overflow:hidden">'+
      '<div class="dt">'+
        '<div><div class="dtimg">'+ photo +'<span class="st2">소개중</span><span class="ix">1/5</span></div></div>'+
        '<div>'+
          '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
            '<span class="dtcat">'+esc(cat)+'</span>'+
            '<span style="color:var(--ink3);font-size:15px">↗ &nbsp; ⋯</span></div>'+
          '<h2 class="dtt">'+(it.th || esc(it.t))+'</h2>'+
          '<div class="dtprice">'+esc(price)+'</div>'+
          '<div class="dtsub">'+sub+'</div>'+
          '<div class="dtmeta"><span>👁 조회 '+views+'</span><span>♡ 관심 '+likes+'</span>'+
          (when ? '<span>🕐 '+esc(when)+'</span>' : '')+
          (reg ? '<span class="dtloc">📍 '+esc(reg)+'</span>' : '')+
          '<span>🛡 신용 86점</span><span class="dtno">매물번호 L-'+esc(no)+'</span></div>'+
        '</div>'+
      '</div>'+

      '<div class="dtprof">'+
        '<span class="av" style="background:transparent;padding:0">'+ personAv(52) +'</span>'+
        '<div style="flex:1">'+
          '<div class="nm">홍길동 <span style="background:var(--or-l);color:var(--or-d);font-size:11px;'+
          'font-weight:700;padding:2px 8px;border-radius:999px">인증소개자</span></div>'+
          '<div class="mt2">활동지역 &nbsp; 서울 강남구 · 서초구 &nbsp;&nbsp; 가입일 &nbsp; 2024.03</div></div>'+
        '<button class="bq" data-askitem="'+esc(no)+'" data-g="'+code+'">💬 질문하기</button>'+
        '<button class="bcall" data-t="전화는 플랫폼 밖 통화라 소개코드 귀속(INV-2)이 끊깁니다. '+
        '먼저 1:1 대화로 시작하시는 편이 안전합니다.">📞 전화하기</button>'+
      '</div>'+

      '<div style="padding:0 17px;font-size:14px;font-weight:700;margin-bottom:9px">'+
        '소개자 실적 <span style="color:var(--g400);font-weight:400">?</span></div>'+
      '<div class="stat">'+
        '<div><div class="k">총 소개</div><div class="v">128건</div></div>'+
        '<div><div class="k">성사(계약)</div><div class="v">42건</div></div>'+
        '<div><div class="k">성사율</div><div class="v">32.8%</div></div>'+
        '<div title="누적수익은 소개자가 「누적수익 공개」를 켠 경우에만 보입니다"><div class="k">누적수익</div><div class="v">15,680,000원</div></div>'+
      '</div>'+

      '<div class="dsec"><h4>소개 상품 상세 설명</h4>'+
        '<p>'+desc+'</p>'+
        '<dl class="spec">'+
          spec.map(function(r){ return '<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>'; }).join("")+
        '</dl>'+
        '<p style="margin-top:11px">'+tail+'</p>'+
      '</div>'+

      '<div style="margin-top:18px"><div class="qna">'+
        '<div class="qh" id="qsec"><span>문의 내용 <span class="n">💬 질문 '+qs.length+'</span></span>'+
        '<span style="font-size:12px;color:var(--ink3);font-weight:400">전체 질문 보기 ›</span></div>'+
        '<div style="margin-top:8px">'+
        qs.map(function(q){
          return '<div class="qi"><span>💬 '+esc(q[0])+'</span><span>'+esc(q[1])+'</span></div>'; }).join("")+
        '</div><div class="note">ⓘ 회원들이 가장 많이 궁금해하는 내용입니다.</div></div></div>'+

      '<div class="dsec" style="margin-top:20px">'+
        '<div style="display:grid;grid-template-columns:1fr 300px;gap:16px">'+
        '<div><h4>소개자 후기</h4>'+
        '<div class="revs">'+
          [["김사장","2024.05.12","12,850,000원","정말 믿을만한 소개자입니다. 원하는 조건에 딱 맞는 분을 소개받아 계약까지 진행했어요.","m"],
           ["이대표","2024.04.28","9,230,000원","소통도 빠르고 상황에 맞는 분들을 잘 연결해주셔서 시간을 많이 아꼈습니다.","w"],
           ["박팀장","2024.04.15","7,680,000원","여러 번 소개받았는데 항상 만족스럽습니다. 지인에게도 추천했어요.","m"]].map(function(r){
            return '<div class="rv2"><div class="rvtop">'+ personAv(38, r[4]) +'<div class="rvid">'+
              '<div class="t2"><span class="nm">'+esc(r[0])+'</span>'+
              '<span class="dt3">'+esc(r[1])+'</span></div>'+
              '<div class="er">누적 수익 '+esc(r[2])+'</div></div></div>'+
              '<div class="stars">★★★★★</div><div class="tx">'+esc(r[3])+'</div></div>';
          }).join("")+
        '</div></div>'+
        '<div><h4>소개 내용</h4>'+
          '<dl class="spec ic" style="grid-template-columns:78px 1fr">'+
            side.map(function(x){
              return '<dt><i>'+x[0]+'</i>'+x[1]+'</dt><dd>'+esc(x[2])+'</dd>'; }).join("")+'</dl>'+
          '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px">'+
          tags.map(function(t){
            return '<span style="font-size:11px;color:var(--ink3);background:var(--g100);border-radius:5px;padding:3px 8px">#'+esc(t)+'</span>';
          }).join("")+'</div></div>'+
        '</div></div>'+

      /* 맨 아래 줄 — 10/7 답 「맨 아래 줄에 합치기」: 「♡ 관심 18」→「관심 담기」, 「지금 바로 문의하기」→「1:1 문의 시작」, 「신고」는 새로.
       * 신고는 접수만 하고 바로 내리지 않습니다 — 검수 큐로 갑니다(자동으로 내리면 경쟁사가 짜고 내릴 수 있습니다). */
      '<div class="abar">'+
        '<button class="bo'+(liked?" on":"")+'" data-like="'+esc(no)+'">'+(liked?"♥ 관심 담김":"♡ 관심 담기")+'</button>'+
        '<button class="bo" data-scroll="qsec">💬 질문 '+qs.length+'</button>'+
        '<button class="bo" data-share="1">↗ 공유하기</button>'+
        '<button class="bo rp" data-t="신고가 접수되었습니다. 검토 후 알려 드립니다.">신고</button><span class="sp"></span>'+
        '<button class="go" data-askitem="'+esc(no)+'" data-g="'+code+'"><span>1:1 문의 시작</span>'+
        '<small>대화가 시작되면 소개코드가 발급됩니다</small></button>'+
      '</div>'+
    '</div>'+
    /* 관마다 다른 안내는 그대로 둡니다 — 안심소개: 부동산 노출료 · 「이 매물 소개하기」(소개코드 공유) / 소개장터: 소개비 협의 / 공통: 귀속 */
    (code === 'MAL'
      ? '<div class="nt warn"><b>부동산은 소개비가 아니라 노출료입니다 (A-07).</b> 금액 체계가 아직 정해지지 않아 '+
        '이 관의 부동산 건은 정산이 생성되지 않습니다.</div>'
      : code === 'MNY'
      ? '<div class="nt info"><b>소개비는 요율표로 산정하지 않습니다 (A-12).</b> 1:1 대화에서 당사자끼리 정합니다.</div>'
      : '')+
    (code === 'MAL' && window.__refShare
      ? '<div class="panel" style="margin-top:14px"><div class="sh2" style="padding:0 0 8px"><b>이 매물 소개하기</b>'+
        '<span class="ls">일반 회원도 소개코드로 소개합니다</span></div>'+ window.__refShare('/l/' + no, it.t) +'</div>'
      : '')+
    '<div class="nt info"><b>1:1 대화가 시작되는 순간 소개코드가 발급되고 귀속이 시작됩니다 (INV-2).</b> '+
      '전화나 외부 연락으로 진행하면 귀속되지 않습니다.</div>'+
    '</div>'+ footer();
  }
  function scDetail(){ return detailFor('BIZ'); }


'''
s = s[:i0] + NEW_DETAIL + s[i1:]

# CSS — 금액 · 매물번호 · 신고 단추
rep("  .dtsub{font-size:14px;color:var(--ink2);line-height:1.6}\n",
    "  .dtsub{font-size:14px;color:var(--ink2);line-height:1.6}\n"
    "  .dtprice{font-size:22px;font-weight:900;letter-spacing:-.03em;color:var(--or-d);margin:0 0 8px}   /* v10.21 */\n"
    "  .dtmeta .dtno{font-family:var(--m);color:var(--g400)}\n"
    "  .abar .rp{color:var(--g500);border-color:transparent;background:transparent;padding:7px 10px}\n"
    "  .dtimg img.thp{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}\n"
    "  /* v10.21 (G-131) — 후기 카드가 다른 화면(후기 작성)의 .rv2 규칙(2칸 격자 · 340px)을 같이 받아 넓어져, 세 번째 후기가 잘리고 옆의 「소개 내용」 상자가 화면 밖으로 밀렸습니다. */\n"
    "  .revs .rv2{display:block;min-width:0}\n"
    "  .dsec > div > div{min-width:0}\n")

# ── 3. 카드 → 그 매물의 주소 ─────────────────────────────────────────
# 랜딩 카드(prodGrid)
rep("""    return '<div class="pgrid">'+items.map(function(x,i){
      return '<button class="pgc" data-open="'+(i%5)+'">'+
        '<div class="pgt">'+thumbArt(x.k)+""",
    """    var gc = gcode(G);   /* v10.21 — 카드는 자기 매물번호를 달고, 상세와 같은 사진을 씁니다 */
    return '<div class="pgrid">'+items.map(function(x,i){
      return '<button class="pgc" data-open="'+itemNo(gc, x.t)+'" data-g="'+gc+'">'+
        '<div class="pgt">'+itemThumb(x)+""")
rep("  function prodGrid(G, items){\n",
    "  function gcode(G){ for (var c in GLAND) if (GLAND[c] === G) return c; return S.gwan || 'MNY'; }\n  function prodGrid(G, items){\n")
# 급구급매 카드
rep("""              return '<button class="uc" data-open="'+(i%5)+'">'+
                '<div class="uimg">'+thumbArt(x.k)+""",
    """              return '<button class="uc" data-open="'+itemNo('*', x.n)+'">'+
                '<div class="uimg">'+itemThumb({k:x.k, c:x.c})+""")
# 누르면 — 그 매물의 주소로 / 그 매물의 문의방으로
rep("""    if(t.hasAttribute("data-go")){ go(t.getAttribute("data-go")); return; }
    if(t.hasAttribute("data-open")){ go("detail"); return; }
""", """    if(t.hasAttribute("data-go")){ go(t.getAttribute("data-go")); return; }
    if(t.hasAttribute("data-open")){ openItem(t.getAttribute("data-open"), t.getAttribute("data-g")); return; }   /* v10.21 */
""")
rep("""    var t=e.target.closest("[data-go],[data-open],[data-cat],[data-tab],[data-act],[data-t],[data-back]");
    if(!t) return;
""", """    var ai=e.target.closest("[data-askitem]");   /* v10.21 — 매물을 들고 문의방으로 */
    if(ai){ e.preventDefault(); openChat(ai.getAttribute("data-askitem"), ai.getAttribute("data-g")); return; }
    var t=e.target.closest("[data-go],[data-open],[data-cat],[data-tab],[data-act],[data-t],[data-back]");
    if(!t) return;
""")
# 자료 — 마이 관심
rep("  GLAND = d.gwan;\n", "  GLAND = d.gwan;\n  LIKES = (d.my && d.my.likes) || [];   /* v10.21 — 매물 장부 */\n  ITEMS = null;\n")
# 도구 묶음 — 화면 묶음 ② 가 같은 장부 · 같은 상세를 씁니다
rep("""  cfg: function(){ return CFG; },
  gwan: function(){ return GWAN; }
};""", """  cfg: function(){ return CFG; },
  gwan: function(){ return GWAN; },
  /* v10.21 — 매물 장부 · 상세 한 틀 */
  listingNo: function(g, title){ return itemNo(g, title); },
  listingCat: function(g, x){ return itemCat(g, x); },
  listingThumb: function(x, cls){ return itemThumb(x, cls); },
  listingDetail: function(code){ return detailFor(code); }
};""")
# 주소 도우미 — 관 + 경로
rep("""                       gwanHref: code => gwanHref(code, "/") });""",
    """                       gwanHref: (code, path) => gwanHref(code, path || "/") });   /* v10.21 — 매물 주소(/l/{번호}) · 문의방 주소(/chat/{번호}) */""")
rep("""  back() {
    if (history.length > 1) { history.back(); return; }""",
    """  /* v10.21 — 주소로 바로 이동(매물 상세 · 매물 문의방). 화면 키만으로는 어느 매물인지 실을 수 없습니다. */
  href(h) {
    if (HASH_MODE) { location.hash = String(h).replace(/^#/, ""); return; }
    writePath(h); paint();
  },
  back() {
    if (history.length > 1) { history.back(); return; }""")

# 화면을 그릴 때 — 주소에 번호가 없으면 매물을 비웁니다(앞에서 본 매물이 남지 않게) · 돌아갈 주소를 함께 쌓습니다
rep("""function paint(key, params){
  if (params) for (var k in params) S[k] = params[k];
""", """function paint(key, params){
  /* v10.21 — 주소에 매물번호 · 문의방 번호가 없으면 비웁니다(앞에서 본 매물이 다음 화면에 남으면 안 됩니다). */
  if (!params || !("listingId" in params)) S.listingId = null;
  if (!params || !("chatId" in params)) S.chatId = null;
  if (params) for (var k in params) S[k] = params[k];
""")
rep("""    S.hist.push(S.screen);
    if (S.hist.length > 30) S.hist.shift();
  }
  S.screen = key;
""", """    S.hist.push(S.screen); S.histHash.push(S.curHash || "");
    if (S.hist.length > 30) { S.hist.shift(); S.histHash.shift(); }
  }
  S.screen = key;
  S.curHash = (typeof location !== "undefined" && location.hash) || "";   /* v10.21 — 이 화면의 주소(돌아가기가 매물 · 문의방을 정확히 찾도록) */
""")
rep("""    var prev = S.hist.length ? S.hist.pop() : null;
    if (prev && R[prev]) { S.back = true; go(prev); return; }
""", """    var prev = S.hist.length ? S.hist.pop() : null;
    var ph = S.histHash.length ? S.histHash.pop() : "";
    /* v10.21 — 돌아갈 곳이 매물 상세 · 매물 문의방이면 화면 키가 아니라 그때의 주소로 갑니다(어느 매물이었는지가 주소에 있습니다). */
    if (prev && R[prev] && ph && /\\/(l|chat)\\/[\\w-]+\\/?$/.test(ph) && ROUTE.href) { S.back = true; ROUTE.href(ph); return; }
    if (prev && R[prev]) { S.back = true; go(prev); return; }
""")
m = re.search(r"  var S=\{ screen:\"main1\", ", s); assert m
rep('  var S={ screen:"main1", ', '  var S={ histHash:[], curHash:"", listingId:null, chatId:null,   /* v10.21 */\n          screen:"main1", ')

# ── 5. 문의방 — 보고 있던 매물 ───────────────────────────────────────
rep("""    // 리스팅 요약 바
    h+='<div class="askbar"><div class="th">'+photoMeat()+'</div>'+
      '<div class="tx"><div class="c">소개창업 · 외식 · 식당</div>'+
      '<b>특A급 프리미엄 고깃집 인수 하실 분을 찾습니다.</b>'+
      '<div class="m"><span class="bd biz">소개창업</span><span class="pr">8,500만원</span>'+
      '<span class="fe">협의 소개비 1,275,000원 · 양도인 부담</span></div></div>'+
      '<button class="lk" data-s="detail">리스팅 보기 ›</button></div>';
""", """    // 리스팅 요약 바 — v10.21: 문의를 시작한 그 매물(주소 #/g/{관}/chat/{매물번호}). 매물 없이 열면 소개창업 견본입니다.
    var ci = chatItem(), cit = ci.it, cg = ci.code;
    h+='<div class="askbar"><div class="th">'+((cit.sample && cg==="BIZ") ? photoMeat() : itemThumb(cit))+'</div>'+
      '<div class="tx"><div class="c">'+esc(gname(cg))+' · '+esc(cit.cd || cit.c || "기타")+'</div>'+
      '<b>'+esc(cit.t)+'</b>'+
      '<div class="m"><span class="bd '+({MNY:"mny",MAL:"mal",BIZ:"biz"}[cg]||"biz")+'">'+esc(gname(cg))+'</span><span class="pr">'+esc(cit.p || "금액 협의")+'</span>'+
      '<span class="fe">'+esc(cit.fee || "소개비 협의 (A-12)")+'</span></div></div>'+
      '<button class="lk" data-open="'+esc(cit.no)+'" data-g="'+cg+'">리스팅 보기 ›</button></div>';
""")

# 문의방의 대화 · 예상 소개비 — 견본(고깃집)이 아닌 매물에는 그 매물 기준으로
rep("""      '<div class="chb">'+ CHAT.concat(S.msgs).map(function(m){""",
    """      '<div class="chb">'+ (cit.sample && cg==="BIZ" ? CHAT : [
          ["d","2026년 8월 26일"],
          ["them","홍길동","안녕하세요. 「"+cit.t+"」 문의 주셔서 감사합니다.\\n자세한 자료는 이 대화로 보내드릴 수 있습니다.","10:12"],
          ["me","나","금액은 협의가 가능한가요?","10:18"],
          ["them","홍길동",(cit.p || "금액")+" 기준으로 조율할 수 있습니다.\\n현장 확인 일정을 잡아드릴까요?","10:24"],
          ["me","나","네, 이번 주 목요일 오후 가능할까요?","10:26"],
          ["them","홍길동","목요일 15시로 잡아두겠습니다. 확인하실 서류 목록을 정리해 보내드릴게요.","10:31"]
        ]).concat(S.msgs).map(function(m){""")
rep("""          '<div class="fee2"><b>1,275,000원</b><span>당사자 협의 금액 · 양도인 부담 · 부가세 별도</span></div>'+
          '<div class="nt2">거래금액 8,500만원 기준입니다. <b>의뢰 사업자는 소개비를 내지 않습니다.</b></div></div>'+""",
    """          (cit.sample && cg==="BIZ"
            ? '<div class="fee2"><b>1,275,000원</b><span>당사자 협의 금액 · 양도인 부담 · 부가세 별도</span></div>'
            : '<div class="fee2"><b>협의</b><span>당사자 협의 금액 · 부가세 별도 (A-12)</span></div>')+
          '<div class="nt2">거래금액 '+esc(cit.p || "협의")+' 기준입니다. <b>의뢰 사업자는 소개비를 내지 않습니다.</b></div></div>'+""")

# ── 6. 돌아가기 글의 관 이름 ─────────────────────────────────────────
rep('  var NAVNAME={main1:"메인", main2:"메인", list:"소개머니", listl:"소개몰", listb:"소개창업",',
    '  var NAVNAME={main1:"메인", main2:"메인", list:"소개장터", listl:"안심소개", listb:"소개창업",   /* v10.21 — 관 이름(10/2 확정)으로 */')
rep('    detail:"상세", dtm:"상세", reql:"소개받기 목록",', '    detail:"소개창업 상세", dtm:"상세", reql:"소개받기 목록",')
rep('  lstm:"소개머니 목록", lstl2:"소개몰 목록", lstb2:"소개창업 목록",\n  dtlm:"소개머니 상세", dtll:"소개몰 상세", regb:"창업 등록",',
    '  lstm:"소개장터 목록", lstl2:"안심소개 목록", lstb2:"소개창업 목록",\n  dtlm:"소개장터 상세", dtll:"안심소개 상세", regb:"창업 등록",')
rep('"03 → 04","소개머니 상세. 1:1 대화가 시작되는 순간 소개코드가 발급됩니다(INV-2)."', '"03 → 04","소개장터 상세. 누른 매물의 내용으로 열립니다. 1:1 대화가 시작되는 순간 소개코드가 발급됩니다(INV-2)."')
rep('"03 → 04","소개몰 상세. 부동산은 소개비가 아니라 노출료입니다(A-07 미결)."', '"03 → 04","안심소개 상세. 누른 매물의 내용으로 열립니다. 부동산은 소개비가 아니라 노출료입니다(A-07 미결)."')

# ── 화면 묶음 ② — 전체 목록 카드 · 관 상세 · 마이 관심 ────────────────────
rep("""      '<button class="pc" data-go="'+({MNY:"dtlm",MAL:"dtll",BIZ:"detail"}[code])+'">'+""",
    """      '<button class="pc" data-open="'+U.listingNo(code, it.t)+'" data-g="'+code+'">'+   /* v10.21 — 그 매물의 주소로 */""")
rep("""      '<div class="pcimg">'+cardPhoto(it.c||"")+'</div>'+""", """      '<div class="pcimg">'+U.listingThumb(it, "pcp")+'</div>'+""")
rep("""        '<span class="ck">'+e(it.c||"기타")+'</span></div>'+""", """        '<span class="ck">'+e(U.listingCat(code, it))+'</span></div>'+""")
j0 = s.index('/* 관 상세 — 관마다 강조하는 항목이 다릅니다 */\nfunction gwanDetail(code){'); j1 = s.index('/* 창업 등록 (SB-BIZ-REG-010) */')
assert 'window.__refShare("/l/4468"' in s[j0:j1]
s = s[:j0] + '/* 관 상세 — v10.21: 세 관이 한 틀(화면 묶음 ① 의 detailFor)입니다. 관별 안내(노출료 · 소개코드 공유 · 소개비 협의)도 거기서 그립니다. */\n' + s[j1:]
rep('  dtlm:()=>gwanDetail("MNY"), dtll:()=>gwanDetail("MAL"),', '  dtlm:()=>U.listingDetail("MNY"), dtll:()=>U.listingDetail("MAL"),')
# cardPhoto 는 이제 쓰는 곳이 없습니다 — 사진 고르기는 화면 묶음 ① 의 photoKey 한 곳
k0 = s.index('/* 카드 사진.\n *\n * 카테고리 이름으로 어울리는 사진을 고릅니다.'); k1 = s.index('function gwanList(code){')
blk = s[k0:k1]
c0 = blk.index('function cardPhoto(cat){'); c1 = blk.index('function trustBadge') if 'function trustBadge' in blk else None
assert c1 is not None, 'trustBadge 를 찾지 못했습니다'
# trustBadge 앞의 주석 시작 자리까지 잘라 냅니다
c1c = blk.rfind('/*', 0, c1)
s = s[:k0] + blk[c1c:] + s[k1:] if c1c > c0 else s[:k0] + blk[c1:] + s[k1:]
assert 'cardPhoto(' not in s, 'cardPhoto 사용처가 남았습니다'
rep("""          '<button class="bo sm" data-go="dtlm">보기</button>'+
          '<button class="bp sm" data-go="ask">1:1 문의 ›</button>'+""",
    """          /* v10.21 — 「보기」는 항목의 관에 맞는 상세로(전에는 전부 소개장터 상세 · 목록표 E-02), 「1:1 문의」도 그 매물의 문의방으로 */
          '<button class="bo sm" data-open="'+e(String(x.id||"").replace(/\\D/g,""))+'" data-g="'+e(x.g)+'">보기</button>'+
          '<button class="bp sm" data-askitem="'+e(String(x.id||"").replace(/\\D/g,""))+'" data-g="'+e(x.g)+'">1:1 문의 ›</button>'+""")

# ── 소개광장 글 목록 → 글 상세 (목록표 E-05 · G-124 · G-132) ─────────────────
# 글 목록(SB-HOM-CMU-010)이 없는 자료(D.community)를 읽어 빈 표였고, 글 상세(SB-HOM-CMU-020)로 들어가는 길이 없었습니다.
rep("""  const c = D.community || {};
  const rows = (c.posts||[]).map(p=>[
    '<a href="#" data-go="cmud">'+e(p.t)+'</a>'+(p.r?' <span class="cnt">'+p.r+'</span>':''),
    e(p.c), e(p.w), e(p.d), String(p.v||0)
  ]);""", """  /* v10.21 — 글 자료는 content.community 에 있습니다(전에는 없는 D.community 를 읽어 표가 비었습니다). 제목은 그 글의 주소(#/community/{번호})로 갑니다. */
  const c = D.community || (D.content && D.content.community) || {};
  const rows = (c.posts||[]).map((p,i)=>[
    (p.pin?'<span class="bg ok">공지</span> ':'')+'<a href="#/community/'+(i+1)+'">'+e(p.t)+'</a>'+(p.r?' <span class="cnt">'+p.r+'</span>':''),
    e(p.c), e(p.w), e(p.d), Number(p.v||0).toLocaleString("ko-KR")
  ]);""")
rep("""      '<button class="tb'+(i===1?" on":"")+'">'+e(t)+'</button>').join("")+
    '</div>'+
    table(["제목","분류","작성자","작성일","조회"], rows)+""", """      '<button class="tb'+(i===0?" on":"")+'">'+e(t)+'</button>').join("")+
    '</div>'+
    table(["제목","분류","작성자","작성일","조회"], rows)+""")
rep("""function scCmuD(){
  return cmuShell("식자재 공급처 소개하고 540만원 받은 이야기",
    "소개 후기 · 소개하니 · 2026-08-29 · 조회 1,204 <b>SB-HOM-CMU-020</b>",
    '<div class="card pad">'+
    '<p>작년에 알던 사장님이 식자재 공급처를 찾는다고 하셔서 '+
    '거래처를 이어 드렸습니다. 두 곳이 계약을 맺으면서 소개비를 받았습니다.</p>'+
    '<p>소개비는 <b>당사자끼리 직접</b> 주고받았습니다. 소개뱅크는 '+
    '한 푼도 떼지 않았습니다.</p></div>'+
    note("ok","<b>성사된 거래가 확인된 후기입니다.</b> "+
      "거래 기록이 없으면 후기를 쓰실 수 없습니다 — "+
      "거래도 안 한 사람의 후기가 가장 나쁜 광고이기 때문입니다.")+

    '<h2 class="st2">댓글 18</h2>'+""", """function scCmuD(){
  /* v10.21 — 누른 글(#/community/{번호})의 제목 · 분류 · 작성자 · 작성일 · 조회 · 댓글 수로 그립니다. 본문은 첫 글만 견본이 있고 나머지는 자리만 둡니다(N-07 · 담을 내용 미확정). */
  const posts = ((D.community || (D.content && D.content.community) || {}).posts) || [];
  const n = parseInt(S().postId, 10) || 1;
  const p = posts[n-1] || posts[0] || { t:"식자재 공급처 소개하고 540만원 받은 이야기", c:"소개 후기", w:"소개하니", d:"2026-08-29", v:1204, r:18 };
  const first = (p === posts[0]) || !posts.length;
  return cmuShell(p.t,
    e(p.c)+" · "+e(p.w)+" · "+e(p.d)+" · 조회 "+Number(p.v||0).toLocaleString("ko-KR")+" <b>SB-HOM-CMU-020</b>",
    '<div class="card pad">'+
    (first
      ? '<p>작년에 알던 사장님이 식자재 공급처를 찾는다고 하셔서 '+
        '거래처를 이어 드렸습니다. 두 곳이 계약을 맺으면서 소개비를 받았습니다.</p>'+
        '<p>소개비는 <b>당사자끼리 직접</b> 주고받았습니다. 소개뱅크는 '+
        '한 푼도 떼지 않았습니다.</p>'
      : '<p>「'+e(p.t)+'」 글의 본문 자리입니다.</p>'+
        '<p class="ls">소개광장에 담을 내용이 정해지면 작성자가 쓴 본문이 여기에 나옵니다 (N-07).</p>')+
    '</div>'+
    (p.c === "소개 후기"
      ? note("ok","<b>성사된 거래가 확인된 후기입니다.</b> "+
          "거래 기록이 없으면 후기를 쓰실 수 없습니다 — "+
          "거래도 안 한 사람의 후기가 가장 나쁜 광고이기 때문입니다.")
      : '')+

    '<h2 class="st2">댓글 '+Number(p.r||0)+'</h2>'+""")
rep("""  { re:/^\/community\/(?!write)[^/]+\/?$/, screen:"cmud", title:"글 상세",""",
    """  { re:/^\/community\/((?!write)[^/]+)\/?$/, screen:"cmud", params:m => ({ postId:m[1] }), title:"글 상세",   /* v10.21 — 글 번호 */""")
rep("""  if (!params || !("chatId" in params)) S.chatId = null;
""", """  if (!params || !("chatId" in params)) S.chatId = null;
  if (!params || !("postId" in params)) S.postId = null;
""")

# ── 누적수익 공개 설정 (10/7 답 「본인이 켠 경우만 공개」 · 실제 웹 /my/account 와 같은 자리) ─────────────
rep("""    note("warn","<b>본인인증을 마치셨습니다.</b> 이름을 바꾸시면 "+
      "다시 인증해야 합니다 — 인증한 이름과 달라지기 때문입니다.")+

    '<h2 class="st2">사업자 정보</h2>'+""", """    note("warn","<b>본인인증을 마치셨습니다.</b> 이름을 바꾸시면 "+
      "다시 인증해야 합니다 — 인증한 이름과 달라지기 때문입니다.")+

    /* v10.21 — 공개 설정. 매물 상세의 「소개자 실적」에서 누적수익(정산받은 소개비 합계)은 기본으로 숨기고,
     * 본인이 여기서 켠 경우에만 4번째 칸으로 나옵니다(서버 D023 · accounts.earnings_public). */
    '<h2 class="st2">공개 설정</h2>'+
    '<div class="card pad">'+
      '<label class="fld" style="display:flex;gap:9px;align-items:flex-start;cursor:pointer">'+
      '<input type="checkbox" name="earningsPublic"'+(S().earnPub?' checked':'')+' style="margin-top:4px">'+
      '<span><b>누적수익 공개</b> — 내 매물 상세의 「소개자 실적」에 누적수익(정산받은 소개비 합계)을 보여 줍니다.</span></label>'+
      '<p class="ls" style="margin:6px 0 0">꺼 두면 총 소개 · 성사(계약) · 성사율만 나옵니다. 로그인하지 않은 사람도 보는 화면이니, 공개를 원하실 때만 켜십시오.</p>'+
      '<div class="hbtn"><button class="bp" data-earnsave="1">공개 설정 저장</button></div>'+
    '</div>'+

    '<h2 class="st2">사업자 정보</h2>'+""")
rep("""    var ai=e.target.closest("[data-askitem]");   /* v10.21 — 매물을 들고 문의방으로 */""",
    """    var es=e.target.closest("[data-earnsave]");   /* v10.21 — 누적수익 공개 설정 저장 */
    if(es){ var cb=document.querySelector('#screen input[name=earningsPublic]'); S.earnPub=!!(cb && cb.checked);
      toast(S.earnPub ? "누적수익을 공개합니다. 내 매물 상세의 소개자 실적에 나옵니다." : "누적수익 공개를 껐습니다. 총 소개 · 성사 · 성사율만 나옵니다."); return; }
    var ai=e.target.closest("[data-askitem]");   /* v10.21 — 매물을 들고 문의방으로 */""")

# ── 7. 판 이름 ──
m = re.search(r'<title>소개뱅크 시안 v10\.20 \(2026-10-06 · ', s); assert m
s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.21 (2026-10-07 · 매물 상세 3종 한 틀 · 누른 매물의 내용 · 매물별 주소 · 맨 아래 줄 「관심 담기 · 신고 · 1:1 문의 시작」 · ', 1)
s = s.replace('SGB_Prototype_v10_20.html', 'SGB_Prototype_v10_21.html')

open(P, 'w', encoding='utf-8').write(s)
print(f'proto {n0:,} → {len(s):,} bytes')
