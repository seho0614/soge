"""시안에 v10.24(안심소개 「생활 · 금융 상담」 — 축 주소 · 목록 단추 · 업종 상세 · 신청서 다듬기)를 넣습니다.

  BASE=/path/SGB_Prototype_v10_23.html  OUT=/path/out.html  python3 apply_proto_v1024.py
    BASE 기본: 이 폴더의 _proto_v1023_base.html (v10.23 시안)   OUT 기본: /home/claude/pv1024/proto_v1024.html (미리보기 — 킷을 건드리지 않음)

  10/7 지시 — 「안심소개 → 생활금융 부분(리스트 및 상세 보기 · 상담하기) 등을 작동 가능하게 · 디자인 모두 적용 · 시안 및 개발 적용」
  답 — ① 상세 보기 = 업종 상세  ② 디자인 = 지금 안심소개 모양으로 다듬기  ③ 준비 중 업종 = 규칙 그대로 + 시험용 업체(실제 웹 · 서버 쪽)

  넣는 것
    1) 축 주소     안심소개 세 축에 주소(#/g/mal · /realty · /consult) — 전에는 축을 골라도 #/g/mal 그대로라 새로 열면 늘 「기계 · 설비 · 시설」
    2) 목록        줄마다 「상세 보기」 + 「상담 신청」 · 업종 이름도 상세로 · 단추가 늘어나던 것(.sm 이름 겹침) · 상자 여백
    3) 업종 상세   새 화면 malcsld(SB-MAL-CSL-025 · #/mal/consult/{코드}) — 소개창업 축 상세(v10.22)와 같은 틀
    4) 신청서      주소 #/mal/consult/{코드}/apply · 입력 칸 꾸밈(전에는 브라우저 기본 모양) · 돌아가기는 업종 상세로
  모든 바꿈은 「찾은 글이 정확히 한 번 있어야」 넣습니다 — 바탕 파일이 다르면 멈춥니다.
"""
import os, re, sys

K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
BASE = os.environ.get('BASE', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_proto_v1023_base.html'))   # v10.23 시안(전달본 SGB_Prototype_v10_23.html 과 같은 파일)
OUT = os.environ.get('OUT', '/home/claude/pv1024/proto_v1024.html')
s = open(BASE, encoding='utf-8').read()
assert '소개뱅크 시안 v10.23' in s, '바탕 파일이 v10.23 이 아닙니다'
n0 = len(s)

def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:90])
    s = s.replace(old, new)

# ── 1) 축 주소 ──────────────────────────────────────────────────────────
rep('{ k:"B", nm:"기계 · 설비 · 시설", sub:"실물자산형", ui:"목록형",',
    '/* v10.24 — 안심소개의 축도 주소(path)를 가집니다: #/g/mal · /realty · /consult. 전에는 축을 골라도 주소가 #/g/mal 그대로라\n'
    '         새로 열면 늘 「기계 · 설비 · 시설」 축이었고, 생활 · 금융 상담 목록을 가리키는 주소가 없었습니다(v10.22 소개창업과 같은 방식). */\n'
    '      { k:"B", nm:"기계 · 설비 · 시설", sub:"실물자산형", ui:"목록형", path:"/",')
rep('{ k:"A", nm:"부동산", sub:"등기자산형", ui:"목록형", gate:"A-07 법무 회신 대기",', '{ k:"A", nm:"부동산", sub:"등기자산형", ui:"목록형", gate:"A-07 법무 회신 대기", path:"/realty",')
rep('{ k:"C", nm:"생활 · 금융 상담", sub:"상담신청형", ui:"상담형",', '{ k:"C", nm:"생활 · 금융 상담", sub:"상담신청형", ui:"상담형", path:"/consult",')
rep("""(t.path ? 'data-axgo="'+esc(t.path)+'"' : 'data-x="ax'+code+'"')""", """(t.path ? 'data-axgo="'+esc(t.path)+'" data-axg="'+code+'"' : 'data-x="ax'+code+'"')""")
rep('''if(ag){ e.preventDefault(); goHref(AUTH.gwanHref("BIZ", ag.getAttribute("data-axgo"))); return; }''',
    '''if(ag){ e.preventDefault(); goHref(AUTH.gwanHref(ag.getAttribute("data-axg") || "BIZ", ag.getAttribute("data-axgo"))); return; }   /* v10.24 — 어느 관의 축인지(data-axg) */''')
rep('''  if (key === "listb") { if (!params || !("axBIZ" in params)) S.axBIZ = null; if (!params || !("axurg" in params)) S.axurg = false; }''',
    '''  if (key === "listb") { if (!params || !("axBIZ" in params)) S.axBIZ = null; if (!params || !("axurg" in params)) S.axurg = false; }
  /* v10.24 — 안심소개의 축도 주소가 정합니다. 주소에 축이 없으면(#/g/mal) 첫 축(기계 · 설비 · 시설)입니다. */
  if (key === "listl") { if (!params || !("axMAL" in params)) S.axMAL = null; }''')
rep('''  { re:/^\\/job\\/([\\w-]+)\\/?$/,      screen:"bjob",''',
    '''  /* v10.24 — 안심소개의 축: 부동산 · 생활 · 금융 상담. 관은 언제나 안심소개입니다. */
  { re:/^\\/realty\\/?$/,  screen:"listl", params:m=>({gwan:"MAL", axMAL:"A"}), title:"안심소개 · 부동산", desc:"등기부등본이 있는 자산입니다." },
  { re:/^\\/consult\\/?$/, screen:"listl", params:m=>({gwan:"MAL", axMAL:"C"}), title:"안심소개 · 생활 · 금융 상담", desc:"상담을 신청하면 인증된 업체 1곳이 연락드립니다." },
  { re:/^\\/job\\/([\\w-]+)\\/?$/,      screen:"bjob",''')
rep('''    if (prev && R[prev] && ph && /\\/(jobs|advisory|info)(\\/[\\w-]+)?\\/?$/.test(ph) && ROUTE.href) { S.back = true; ROUTE.href(ph); return; }''',
    '''    if (prev && R[prev] && ph && /\\/(jobs|advisory|info)(\\/[\\w-]+)?\\/?$/.test(ph) && ROUTE.href) { S.back = true; ROUTE.href(ph); return; }
    /* v10.24 — 안심소개의 축(#/g/mal/realty · /consult)과 상담 업종 화면(#/mal/consult · /코드 · /코드/apply)도 주소로 돌아갑니다. */
    if (prev && R[prev] && ph && /\\/(realty|consult)(\\/[A-Z_]+(\\/apply)?)?\\/?$/.test(ph) && ROUTE.href) { S.back = true; ROUTE.href(ph); return; }''')

# ── 2) 목록 줄 ──────────────────────────────────────────────────────────
a = s.index("  function axBodyLead(code, t){"); b = s.index("  /* 운영 화면(다른 묶음)에서 이 표를 읽고 씁니다 */", a)
s = s[:a] + r'''  /* v10.24 — 줄마다 「상세 보기」(업종 상세 #/mal/consult/코드)와 「상담 신청」(신청서 …/apply)을 둡니다. 업종 이름을 눌러도 상세로 갑니다.
     전에는 줄의 단추가 바로 신청서로 갔고 상세 화면이 없었습니다. 법률 · 세무(월 정액 노출형)는 그대로 「사무소 보기」입니다.
     줄 하나는 cslRow 가 그립니다 — 업종 고르기 화면(#/mal/consult)도 같은 줄을 씁니다. */
  function cslRow(r){
    var d = '#/mal/consult/'+esc(r[0]);
    if(r[5]==="dir") return '<div class="axrow" data-csl="'+esc(r[0])+'"><div class="axl"><span class="axb axhot">자격 확인</span><b><a href="'+d+'">'+esc(r[1])+'</a></b>'+
      '<span class="ls">'+esc(r[3])+' · 게재 '+r[4]+'곳</span></div>'+
      '<div class="axr"><span class="ls">광고</span><a class="bo sm" href="'+d+'">사무소 보기</a></div></div>';
    var shut = r[5]!=="open" || r[4]===0;
    return '<div class="axrow" data-csl="'+esc(r[0])+'"><div class="axl">'+
      '<span class="axb'+(r[2]==="GATED"?" axhot":"")+'">'+(r[2]==="GATED"?"자격 확인":"일반")+'</span>'+
      '<b><a href="'+d+'">'+esc(r[1])+'</a></b>'+
      '<span class="ls">'+esc(r[3])+' · 인증업체 '+r[4]+'곳</span></div>'+
      '<div class="axr">'+(shut
        ? '<span class="ls">'+(r[5]==="shut"?"준비 중 — 법무 재확인":r[5]==="hold"?"준비 중 — 법무 확인 전":"받을 업체가 아직 없습니다")+'</span>'+
          '<a class="bo sm" href="'+d+'">상세 보기</a><button class="bo sm off" disabled>준비 중</button>'
        : '<a class="bo sm" href="'+d+'">상세 보기</a><a class="bp sm" href="'+d+'/apply">상담 신청</a>')+
      '</div></div>';
  }
  window.__cslRow = cslRow;
  function axBodyLead(code, t){
    return '<div class="panel cslL">'+
      '<div class="sh2" style="padding:0 0 12px"><b>🤝 생활 · 금융 상담</b>'+
      '<span class="ls">업종을 고르고 상담을 신청하면 인증된 업체 1곳이 연락드립니다</span></div>'+
      '<div class="axwarn ok"><b>신청 정보는 업체 1곳에만 전달됩니다.</b> '+
      '동의하신 업체 말고는 연락처를 볼 수 없고, 휴대폰 확인을 마친 신청만 전달됩니다.</div>'+
      '<div class="axrows">'+LEADCAT.map(cslRow).join("")+'</div>'+
      '<div class="axcta"><b>업체이신가요?</b>'+
      '<span>안심소개 파트너센터에서 입점 신청과 자격 서류를 내면 이 목록에 오릅니다</span>'+
      '<button class="bo sm" data-go="ptnapply">인증업체 등록</button></div>'+
      '</div>';
  }
''' + s[b:]

# ── 3) · 4) 상담 묶음(M_ansim) — 업종 상세 · 신청서 ─────────────────────────
a = s.index("function shell(title, sub, body){", s.index("var M_ansim = (function(){")); b = s.index("function scGive(){", a)
s = s[:a] + r'''/* v10.24 — 돌아가기를 「직전 화면」이 아니라 정해 둔 곳으로 둡니다(back 을 주면). 전에는 주소로 바로 열면 「메인(으)로 돌아가기」였습니다.
   목록(상담 축) ← 업종 상세 ← 신청서 · 접수. */
const LIST = "#/g/mal/consult";
function shell(title, sub, body, back){
  return U.header({}) + '<div class="wrap aiw">' +
    (back ? '<a class="bkl" href="' + back[0] + '">← ' + e(back[1]) + '(으)로 돌아가기</a>' : U.backLink("안심소개")) +
    '<div class="pgh"><div><h1>' + e(title) + '</h1><p>' + sub + '</p></div></div>' + body + '</div>' + U.footer();
}
const BACK_LIST = [LIST, "생활 · 금융 상담"];

/* 월 정액 노출형(법률 · 세무 — 서버 D019). 상담 신청(리드)을 만들지 않고, 순서는 날마다 섞고, 「광고」를 붙입니다. 상세 주소 · 신청서 주소 모두 이 화면입니다. */
function dirList(c){
  const code = c[0];
  const DEMO = { CSL_LEGAL: [["법무법인 한빛","민사 · 가사 · 부동산 분쟁","서울특별시","02-1234-5678"],["정의 법률사무소","형사 · 교통사고","경기도","031-222-3333"],["바른 법무사사무소","등기 · 공탁 · 개인회생","인천광역시","032-444-5555"]],
                 CSL_TAX: [["한결 세무회계","종합소득세 · 법인 기장","서울특별시","02-777-8888"],["미래 회계법인","외부감사 · 재무 자문","경기도","031-999-0000"]] }[code] || [];
  const day = new Date().getDate(); const list = DEMO.map((x, i) => [x, (i * 7 + day) % 5]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  return shell(c[1], "월 정액 노출형 · <b>SB-MAL-CSL-050</b> (제안)",
    '<div class="axwarn ok"><b>소개뱅크는 사무소를 추천하거나 연결하지 않습니다.</b> 아래는 월 정액으로 게재한 「광고」이며, 순서는 날마다 바뀝니다. ' +
    '자격(등록) 확인을 마친 곳만 보입니다. 상담 · 수임은 사무소와 직접 정하십시오.</div>' +
    '<div class="panel cslP"><div class="axrows">' + list.map(x =>
      '<div class="axrow"><div class="axl"><span class="axb">광고</span><b>' + e(x[0]) + '</b><span class="ls">' + e(x[1]) + ' · ' + e(x[2]) + '</span></div>' +
      '<div class="axr"><a class="bp sm" href="tel:' + e(x[3]) + '">' + e(x[3]) + '</a></div></div>').join("") + '</div></div>' +
    '<div class="prfact"><a class="bo" href="' + LIST + '">다른 업종 보기</a><button class="bo" data-go="ptnapply">사무소 게재 신청</button></div>', BACK_LIST);
}
function noCat(){
  return shell("상담 업종", "<b>SB-MAL-CSL-025</b>",
    '<div class="axwarn"><b>없는 업종입니다.</b> 주소를 다시 확인하시거나 목록에서 골라 주십시오.</div>' +
    '<div class="prfact"><a class="bo" href="' + LIST + '">생활 · 금융 상담 목록</a></div>', BACK_LIST);
}
/* 받는 지역(시연 값) — 서버는 시 · 도별 인증업체 수를 내려 줍니다(GET /consult/categories/{code}). 시안은 인증업체 수에서 어림해 보여 줍니다. */
function demoRegions(n){
  if (!n) return [];
  return [["서울", n], ["경기", Math.max(1, Math.round(n * 0.6))], ["인천", Math.max(1, Math.round(n * 0.3))]];
}

/* ══ v10.24 업종 상세 — SB-MAL-CSL-025 · #/mal/consult/{코드} ══════════════════════════════
 * 목록의 줄 → 이 화면 → 맨 아래 줄 「상담 신청」 → 신청서(…/apply). 소개창업 축 상세(v10.22 axDetail)와 같은 틀입니다.
 * 업체 이름 · 연락처는 보여 주지 않습니다 — 어느 업체에 갈지는 서버가 1곳으로 정합니다. */
function scCslD(){
  /* 주소에 업종이 없으면(점검 도구 · 화면 목록에서 화면만 연 경우) 받는 중인 첫 업종을 보입니다 — 소개창업 축 상세 4종(v10.22)과 같은 규칙. 주소에 없는 코드가 적혀 있으면 「없는 업종」 안내입니다. */
  const first = (cats().filter(x => x[5] === "open" && x[4] > 0)[0] || cats()[0] || [""])[0];
  const code = hashCat() || first, c = catOf(code);
  if (!c) return noCat();
  if (c[5] === "dir") return dirList(c);
  const gated = c[2] === "GATED", shut = c[5] !== "open" || c[4] === 0, regs = demoRegions(shut ? 0 : c[4]);
  const why = c[5] === "shut" ? "안심소개로 옮긴 뒤의 법무 확인을 기다리고 있습니다." : c[5] === "hold" ? "법무 확인을 마친 뒤에 엽니다."
    : gated ? "자격 심사를 통과한 업체가 아직 없습니다." : "받을 수 있는 인증업체가 아직 없습니다.";
  return U.header({}) +
    '<div class="wrap" style="padding-top:16px"><a class="bkl" href="' + LIST + '">← 생활 · 금융 상담(으)로 돌아가기</a></div>' +
    '<div class="wrap" style="padding-top:14px"><div class="panel axdt cslD" data-csl="' + e(code) + '" style="overflow:hidden">' +
      '<div class="axdh">' +
        '<div class="axdhl"><span class="axb' + (gated ? " axhot" : "") + '">' + (gated ? "자격 확인" : "일반") + '</span><span class="axb">상담신청형</span>' +
          '<span class="dtcat">안심소개 · 생활 · 금융 상담</span></div>' +
        '<h2 class="dtt">' + e(c[1]) + '</h2>' +
        '<div class="dtsub">' + e(c[3]) + '</div>' +
        '<div class="dtmeta"><span>' + (gated ? "등록 · 허가가 필요한 업종 — 자격 심사를 통과한 업체에만 연결합니다" : "사업자 인증과 입점 승인을 받은 업체에 연결합니다") + '</span>' +
          '<span class="dtno">SB-MAL-CSL-025</span></div>' +
      '</div>' +
      '<div class="csls"><div class="cell"><div class="k">받을 수 있는 인증업체</div><div class="v">' + c[4] + '곳</div></div>' +
        '<div class="cell"><div class="k">받는 지역</div><div class="v">' + regs.length + '곳</div></div>' +
        '<div class="cell"><div class="k">신청 정보 전달</div><div class="v">1곳에만</div></div></div>' +
      '<div class="dsec"><h4>받는 지역</h4>' + (regs.length
        ? '<ul class="cslreg">' + regs.map(r => '<li><b>' + e(r[0]) + '</b><span>' + r[1] + '곳</span></li>').join("") + '</ul>' +
          '<p class="ls" style="margin-top:8px">여기에 없는 시 · 도로 신청하면 업체에 전달하지 않고 「받을 업체 없음」으로 알려 드립니다. · 업체 수 · 지역은 시연 값입니다.</p>'
        : '<p class="ls">아직 받는 지역이 없습니다.</p>') + '</div>' +
      '<div class="dsec"><h4>이렇게 진행됩니다</h4><ol class="nsteps" style="margin-bottom:0">' +
        '<li class="on"><span class="n">1</span><div><b>상담 신청</b><p>이름 · 휴대폰 · 지역을 적습니다. 로그인하지 않아도 됩니다.</p></div></li>' +
        '<li><span class="n">2</span><div><b>휴대폰 확인</b><p>인증번호 6자리를 5분 안에 넣습니다. 확인 전에는 업체에 아무것도 가지 않습니다.</p></div></li>' +
        '<li><span class="n">3</span><div><b>인증업체 1곳이 연락</b><p>상담 요약이 그 업체에 가고, 이름 · 휴대폰은 그 업체가 연락처를 열 때 전달됩니다.</p></div></li>' +
      '</ol></div>' +
      '<div class="dsec" style="margin-bottom:16px"><h4>알아 두실 것</h4><ul class="axul" style="margin:0">' +
        '<li>신청 정보는 동의하신 업체 <b>1곳에만 전달</b>됩니다 — 여러 곳에 넘기지 않습니다</li>' +
        '<li>등록 · 허가가 필요한 업종은 자격 심사를 통과한 업체만 받습니다</li>' +
        '<li>상담 내용과 계약 조건은 업체가 정합니다 — 소개뱅크는 자격을 확인할 뿐 결과를 보증하지 않습니다</li>' +
        '<li>같은 번호로 하루 5번까지 신청할 수 있고, 같은 업종은 24시간 안에 다시 신청할 수 없습니다</li>' +
        '<li>업체가 24시간 안에 확인하지 않으면 다른 인증업체 1곳으로 넘깁니다</li>' +
      '</ul></div>' +
      '<div class="abar"><a class="bo" href="' + LIST + '">목록으로</a><span class="sp"></span>' + (shut
        ? '<span class="ls">' + e(why) + '</span><button class="go done" disabled><span>준비 중</span><small>아직 받지 않습니다</small></button>'
        : '<a class="go" href="#/mal/consult/' + e(code) + '/apply"><span>상담 신청</span><small>인증업체 1곳이 연락드립니다</small></a>') + '</div>' +
    '</div></div>' + U.footer();
}

function scCsl(){
  const st = S(), code = hashCat(), c = catOf(code);
  if (!code) {
    /* 업종 고르기(SB-MAL-CSL-020) — 메인의 「전문가 소개」 등이 여는 곳. 상담 축 목록과 같은 줄입니다(v10.24). */
    return shell("상담 신청", "업종을 고르십시오 · <b>SB-MAL-CSL-020</b>",
      '<div class="panel cslL"><div class="axrows">' + cats().map(window.__cslRow).join("") + '</div></div>', BACK_LIST);
  }
  if (!c) return noCat();
  if (c[5] === "dir") return dirList(c);
  const BACK_D = ["#/mal/consult/" + e(code), c[1]];
  if (c[5] !== "open" || c[4] === 0) {
    return shell(c[1] + " 상담", "<b>SB-MAL-CSL-030</b>",
      '<div class="axwarn"><b>' + e(c[1]) + ' 상담은 아직 받지 않습니다.</b> ' +
      (c[5] === "shut" ? '안심소개로 옮긴 뒤의 법무 확인을 기다리고 있습니다.'
        : c[5] === "hold" ? '소개 대가를 받을 수 있는지 법무 확인을 마친 뒤에 엽니다.'
        : '자격 심사를 통과한 업체가 아직 없습니다.') +
      '</div><div class="prfact"><a class="bo" href="' + LIST + '">다른 업종 보기</a></div>', BACK_D);
  }
  const done = st.cslDone && st.cslDone.code === code ? st.cslDone : null;
  if (done) {
    return shell("상담 신청 접수", "<b>SB-MAL-CSL-040</b>",
      '<div class="panel cslP"><div class="sh2" style="padding:0 0 10px"><b>✓ ' + e(c[1]) + ' 상담 신청을 받았습니다</b>' +
      '<span class="ls">접수번호 ' + e(done.no) + '</span></div>' +
      '<p>인증된 업체 1곳이 연락드립니다. 신청 정보는 그 업체에만 전달되고, 다른 곳에 넘기지 않습니다.</p>' +
      '<div class="axwarn">시연 화면입니다 — 서버에 저장되지 않았습니다. 실제로는 휴대폰 확인을 마친 신청만 업체에 전달됩니다(INV-12).</div>' +
      '<div class="prfact"><button class="bo" data-csl-reset="1">새로 신청</button><a class="bp" href="' + LIST + '">안심소개로</a></div></div>', BACK_D);
  }
  const v = st.cslForm || {};
  return shell(c[1] + " 상담 신청", e(c[3]) + " · <b>SB-MAL-CSL-030</b>",
    (c[2] === "GATED" ? '<div class="axwarn ok"><b>자격 확인 업종입니다.</b> 자격 심사를 통과한 업체에만 연결합니다.</div>' : '') +
    '<div class="panel cslP"><div class="cslf">' +
      '<label>이름<input class="inp" id="csl-name" autocomplete="name" value="' + e(v.name || "") + '"></label>' +
      '<label>휴대폰<span class="inl"><input class="inp" id="csl-tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" value="' + e(v.tel || "") + '">' +
        '<button class="bo sm" data-csl-otp="1">' + (st.cslOtp ? "확인됨 (시연)" : "인증번호 받기") + '</button></span></label>' +
      '<label>지역<select class="inp" id="csl-area">' + ["", "서울특별시", "경기도", "인천광역시", "그 밖의 지역"].map(r =>
        '<option' + (v.area === r ? " selected" : "") + ' value="' + e(r) + '">' + (r || "고르십시오") + '</option>').join("") + '</select></label>' +
      '<label>원하는 상담 내용 <span class="ls">(선택)</span><textarea class="inp" id="csl-memo" rows="3">' + e(v.memo || "") + '</textarea></label>' +
      '<label class="chk"><input type="checkbox" id="csl-agree"' + (v.agree ? " checked" : "") + '>' +
        '<span><b>개인정보 제3자 제공에 동의합니다.</b> 이름 · 휴대폰 · 지역 · 상담 내용을 이 업종의 인증업체 1곳에 제공합니다. ' +
        '상담이 끝나거나 6개월이 지나면 파기합니다. 동의하지 않으면 신청할 수 없습니다.</span></label>' +
      (st.cslOtpNote ? '<div class="ls">' + e(st.cslOtpNote) + '</div>' : '') +
      (st.cslErr ? '<div class="cslerr" role="alert">' + e(st.cslErr) + '</div>' : '') +
      '<div class="prfact"><button class="bp" data-csl-submit="' + e(code) + '">상담 신청</button>' +
        '<a class="bo" href="' + LIST + '">업종 다시 고르기</a></div>' +
    '</div></div>', BACK_D);
}

''' + s[b:]

rep('const SCREENS = { malcsl: scCsl, malgive: scGive };', 'const SCREENS = { malcsl: scCsl, malcsld: scCslD, malgive: scGive };')
rep('''  malgive: M("SB-MAL-GIV-010", "sogaebaenk.co.kr/mal/give", "10.4 상담 축",''',
    '''  malcsld: M("SB-MAL-CSL-025", "sogaebaenk.co.kr/mal/consult/{업종}", "10.4 상담 축", "v10.24 상담 업종 상세 — 인증업체 수 · 받는 지역 · 진행 순서 · 알아 둘 것. 맨 아래 줄의 「상담 신청」으로 신청서(SB-MAL-CSL-030 · …/apply)에 갑니다. 법률 · 세무는 같은 주소에서 사무소 목록."),
  malgive: M("SB-MAL-GIV-010", "sogaebaenk.co.kr/mal/give", "10.4 상담 축",''')
rep('const NAVS = { malcsl: "상담 신청", malgive: "소개하기 안내", ptnlst: "내 매물" };', 'const NAVS = { malcsl: "상담 신청", malcsld: "상담 업종", malgive: "소개하기 안내", ptnlst: "내 매물" };')
rep('''  { re: /^\\/mal\\/consult\\/([A-Z_]+)\\/?$/, screen: "malcsl", params: m => ({ cslCat: m[1] }), title: "상담 신청", desc: "생활 · 금융 상담" },''',
    '''  /* v10.24 — /mal/consult/{코드} 는 업종 상세(malcsld), 신청서는 /mal/consult/{코드}/apply 로 옮겼습니다 */
  { re: /^\\/mal\\/consult\\/([A-Z_]+)\\/apply\\/?$/, screen: "malcsl", params: m => ({ cslCat: m[1] }), title: "상담 신청", desc: "생활 · 금융 상담" },
  { re: /^\\/mal\\/consult\\/([A-Z_]+)\\/?$/, screen: "malcsld", params: m => ({ cslCat: m[1] }), title: "상담 업종", desc: "인증업체 수 · 받는 지역 · 진행 순서" },''')
rep('const PATHS = { malcsl: "/mal/consult", malgive: "/mal/give", ptnlst: "/partner/listings" };', 'const PATHS = { malcsl: "/mal/consult", malcsld: "/mal/consult", malgive: "/mal/give", ptnlst: "/partner/listings" };')

# ── 스타일 ──────────────────────────────────────────────────────────────
CSS = r'''
/* ══ v10.24 안심소개 「생활 · 금융 상담」 — 목록 · 업종 상세 · 신청서 ══ */
.cslL{padding:16px 17px 17px}
.cslP{padding:18px 20px 20px}
.axrow .axl b a{color:inherit}
.axrow .axl b a:hover{color:var(--pp)}
/* 작은 링크 단추가 3칸 격자로 늘어나던 것(.sm 이름 겹침). 전에 단추(button.bo.sm · button.bp.sm)만 되돌려 두었고 링크(a)는 빠져 있었습니다 —
   상담 줄 22 · 알림 화면 3 · 소개자 홈 1. 같은 뜻으로 링크도 되돌립니다(10/7 답 「같이 고침」). */
a.bo.sm, a.bp.sm{display:inline-flex;align-items:center;justify-content:center;grid-template-columns:none;width:max-content;margin:0;gap:6px}
.cslL .axr a.sm, .cslL .axr button.sm{min-width:88px;white-space:nowrap}
.cslP .axr a.sm{min-width:118px;white-space:nowrap}
/* 요약 세 칸 · 받는 지역 */
.csls{display:grid;grid-template-columns:repeat(3,1fr);margin:0 17px;border:1px solid var(--line);border-radius:11px}
.csls .cell{padding:15px 10px;text-align:center;border-left:1px solid var(--line);min-width:0}
.csls .cell:first-child{border-left:0}
.csls .k{font-size:12.5px;color:var(--ink3)}
.csls .v{font-size:17px;font-weight:900;margin-top:4px}
.cslreg{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.cslreg li{display:inline-flex;align-items:baseline;gap:8px;padding:8px 13px;border:1px solid var(--line);border-radius:9px;font-size:13px}
.cslreg li span{font-size:12px;color:var(--ink3)}
.cslD .abar a.go{text-align:center;display:inline-flex;flex-direction:column;align-items:center}
.cslD .abar .go[disabled]{background:var(--g400);cursor:default}
.cslD .nsteps li p{margin:2px 0 0}
/* 입력 칸 — 전에는 .inp 에 꾸밈이 없어 브라우저 기본 모양(높이 21px · 2px 테두리)이었습니다.
   .cslf 를 쓰는 두 곳(상담 신청서 · 운영 화면 「월 노출료 기준 금액」) 모두에 적용합니다(10/7 답 「같이 고침」). */
.cslf .inp{width:100%;min-width:0;font:inherit;font-size:14px;font-weight:400;color:var(--ink);background:var(--card,#fff);border:1px solid var(--line);border-radius:8px;padding:9px 12px;min-height:40px;line-height:1.4}
.cslf select.inp{appearance:auto;height:40px}
.cslf textarea.inp{min-height:84px;resize:vertical}
.cslf .inp:focus{outline:2px solid var(--pp);outline-offset:1px;border-color:var(--pp)}
.cslf .inl{display:flex;gap:8px;align-items:center}
.cslf .inl .inp{flex:1 1 auto}
.cslf .inl .bo, .cslf .inl .bp{flex:0 0 auto;min-height:40px;white-space:nowrap}
.cslf .chk b{font-size:13px;font-weight:700}
.cslf .chk input{margin-top:3px;flex:0 0 auto}
.cslf .prfact{margin-top:4px}
@media (max-width:640px){ .csls{margin:0 12px} .csls .cell{padding:12px 4px} .csls .k{font-size:11.5px} .csls .v{font-size:15px}
  .cslL{padding:13px 12px 14px} .cslP{padding:14px 13px 16px} .cslL .axrow .axr{width:100%} .cslD .abar .sp{display:none} .cslD .abar a.go, .cslD .abar button.go{width:100%} }
'''
i = s.index('</style>')
s = s[:i] + CSS + s[i:]

# ── 판 이름 ─────────────────────────────────────────────────────────────
# 제목은 판마다 앞에 덧붙입니다(뒤의 내력은 그대로 — 옛 판 시험들이 그 내력의 글자를 봅니다)
head = '<title>소개뱅크 시안 v10.23 (2026-10-07 · '
assert s.count(head) == 1
s = s.replace(head, '<title>소개뱅크 시안 v10.24 (2026-10-07 · 안심소개 「생활 · 금융 상담」 — 업종 상세 20종(SB-MAL-CSL-025) · 줄마다 「상세 보기」 + 「상담 신청」 · 축 주소(#/g/mal/consult) · 신청서 다듬기 · v10.23: ')
s = s.replace('SGB_Prototype_v10_23.html', 'SGB_Prototype_v10_24.html')

open(OUT, 'w', encoding='utf-8').write(s)
print(f'{BASE} → {OUT}  {n0:,} → {len(s):,} 자')
