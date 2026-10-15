"""시안(spec/proto.html)에 v10.22 를 넣습니다.

  python3 apply_proto_v1022.py     (v10.21 시안에 한 번 — 이미 v10.22 면 아무것도 하지 않습니다)
  BASE=/path/SGB_Prototype_v10_21.html python3 apply_proto_v1022.py    (v10.21 파일에서 다시 만들 때)

넣는 것 (10/7 사장님 지시 두 건)
  ① 「언어 선택 단추가 머리줄 밖으로 삐져나온 결함 … 수정」 (G-138)
     - 언어 단추와 로그인 화면이 같은 이름(.lgb · .lgc)을 써서 서로의 스타일을 받았습니다 → 언어 단추 쪽 이름을 .lngb · .lngc 로.
       (언어 단추의 「▾」가 로그인 상자 스타일을 받아 63×73 상자 · 로그인 화면은 제목이 회색, 단추가 32px 로 납작)
     - 선택자가 떨어져 나간 스타일 조각이 바로 뒤의 `.lang{position:relative}` 를 삼켜, 언어 목록이 화면 맨 아래에 열렸습니다 → 조각을 지움.
  ② 「공고 · 자문 서비스 · 정책 · 교육 상세를 만들고 주소도 항목마다 다르게(v10.21 매물 상세와 같은 방식)」 (G-140)
     답 — 인력 축 법무 회신(A-09): 「회신 완료 — 연다」 · 같은 화면의 결함(G-139 · G-141)도 같이 고치기
     - 항목 장부(공고 9101~ · 자문 서비스 9201~ · 정책 9301~ · 교육 9401~)와 상세 한 틀(axDetail) — 새 화면 4장
       bjob SB-BIZ-JOB-020 · bsvc SB-BIZ-SVC-020 · bpol SB-BIZ-POL-020 · bedu SB-BIZ-EDU-020
     - 주소 — 축: #/g/biz/jobs · /jobs/applied · /jobs/quick · /jobs/urgent · /advisory · /info · /info/edu
              상세: #/g/biz/job/{번호} · /advisory/{번호} · /policy/{번호} · /edu/{번호}
     - 인력 축을 엽니다 — 「아직 열지 않았습니다」 · 「A-09 회신 뒤에 엽니다」를 지우고, 공고 상세의 「업체 소개 요청」이 접수되어 「지원」 갈래에 쌓입니다.
     - G-139 강조 배지가 화면 왼쪽 위 구석에 찍히던 것(.hot 이름 겹침) → .axhot
     - G-141 옛 관 이름 「소개머니」 「소개몰」 · 지난 날짜(오늘 기준으로 계산) · 「창업계획 등록」이 요청 목록으로 가던 것 · 「초단기 급구」가 일반 급구급매로 가던 것
  ③ 판 이름 v10.22
화면 수 189 → 193. 실제 웹 · 서버는 바꾸지 않습니다.
"""
import json, os, re, shutil

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
P = os.path.join(K, 'spec/proto.html')
BASE = os.environ.get('BASE')
if BASE:
    shutil.copyfile(BASE, P)
s = open(P, encoding='utf-8').read()
n0 = len(s)
if re.search(r'<title>소개뱅크 시안 v10\.22 ', s):
    print('이미 v10.22 입니다 — 바꾸지 않았습니다'); raise SystemExit(0)
assert re.search(r'<title>소개뱅크 시안 v10\.21 ', s), 'v10.21 시안이 아닙니다'

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, (old[:80], s.count(old))
    s = s.replace(old, new)

# ══ ① 언어 단추 (G-138) ════════════════════════════════════════════════
# 1-1. 선택자가 떨어져 나간 조각 — 뒤의 .lang{position:relative} 를 삼키고 있었습니다(v10.1 시안에도 있던 것 · 원래 어느 요소의 것인지는 남아 있지 않습니다).
rep(""".lrow .lnk:hover{color:var(--pp);text-decoration:underline}

    padding:15px 18px;border:1.5px solid var(--bl);border-radius:12px;
    background:var(--card);color:var(--bl);font-size:15px;font-weight:800;
    text-decoration:none;transition:.15s}

""", """.lrow .lnk:hover{color:var(--pp);text-decoration:underline}

""")
# 1-2. 언어 단추의 이름 — 로그인 화면(.lgb 단추 · .lgc 상자)과 겹치지 않게
rep(""".lang{position:relative}
.lgb{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;
     border:1px solid var(--line);background:var(--card);cursor:pointer;font-size:13px}
.lgb:hover{border-color:var(--pp)}
.lgf{font-size:14px;line-height:1}
.lgt{font-weight:700;color:var(--ink)}
.lgc{color:var(--g400);font-size:10px}
""", """/* v10.22 (G-138) — 단추 · 「▾」의 이름을 .lngb · .lngc 로 바꿨습니다. 전에는 로그인 화면의 .lgb(단추) · .lgc(상자)와 같은 이름이라
   언어 단추는 로그인 상자의 여백 · 테두리를 받아 87px 로 커지고, 로그인 화면은 이 단추의 글자색 · 여백을 받아 납작해졌습니다. */
.lang{position:relative}
.lngb{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;
     border:1px solid var(--line);background:var(--card);cursor:pointer;font-size:13px}
.lngb:hover{border-color:var(--pp)}
.lgf{font-size:14px;line-height:1}
.lgt{font-weight:700;color:var(--ink)}
.lngc{color:var(--g400);font-size:10px}
""")
rep("""'<button class="lgb" data-lang-toggle""", """'<button class="lngb" data-lang-toggle""")
rep("""'<span class="lgc">▾</span></button>'""", """'<span class="lngc">▾</span></button>'""")
assert not re.search(r'class="lgb"', s) and s.count('class="lgc"') == 1     # 남은 lgc 는 로그인 상자 하나

# ══ ② 소개창업 축 — 스타일 ════════════════════════════════════════════
rep(""".axb.hot{background:#FEE2E2;color:#991B1B}
""", """/* v10.22 (G-139) — 강조 배지는 .axhot. 전에는 .hot 이라 카드 배지 스타일(.hot{position:absolute;left:8px;top:8px})을 받아 화면 왼쪽 위 구석에 찍혔습니다. */
.axb.axhot{background:#FEE2E2;color:#991B1B}
.axb.axok{background:#DCFCE7;color:#166534}
/* v10.22 — 줄 제목(누르면 그 항목의 상세) · 빈 목록 · 상세 한 틀 */
.axtt{display:inline;padding:0;margin:0;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}
.axtt:hover{color:var(--pp);text-decoration:underline}
.axempty{padding:26px 18px;border:1px dashed var(--line);border-radius:10px;text-align:center;font-size:12.5px;color:var(--ink3);line-height:1.8}
.axempty b{display:block;font-size:13.5px;color:var(--ink);margin-bottom:3px}
.axempty .bo{margin-top:10px}
.axt .axg.ok{color:#065F46}
.axnote .axw2.ok{color:#065F46}
.axdh{padding:20px 22px 16px}
.axdhl{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.axdt .dtt{margin:9px 0 6px}
.axdt .dtprice{margin:0 0 6px}
.axsample{margin:0 17px 2px;padding:10px 14px;border-radius:9px;background:#FFFBEB;border:1px solid #FDE68A;font-size:12px;color:#78350F;line-height:1.7}
.axsample b{color:#78350F}
.axdt .dsec .axwarn,.axdt .dsec .axinv{margin:0 0 10px}
.axdt .dsec .axnote2{margin:0 0 4px}
.axdt .abar{flex-wrap:wrap}
.axdt .abar .go.done{background:var(--g400);cursor:default}
@media (max-width:640px){ .axdh{padding:16px 16px 12px} .axdt .abar .go{width:100%} }
""")

# ══ ② 소개창업 축 — 축 표(AX.BIZ) ══════════════════════════════════════
rep("""              "창업부지는 소개몰 원본을 참조만 합니다(INV-GWAN2)"] },
      { k:"2", nm:"인력", sub:"매칭형", ui:"매칭형", gate:"도급만 · 개인 노출 없음",
        judge:"고용 관계가 성립합니까?", urg:"초단기 급구", cats:[] },
      { k:"3", nm:"운영지원", sub:"서비스형", ui:"서비스형",
        judge:"지속적 자문 · 수행 계약이 성립합니까?", cats:[] },
      { k:"4", nm:"정보", sub:"콘텐츠형", ui:"콘텐츠형",
        judge:"거래가 없습니다 — 열람과 신청만 합니다", cats:[] }
    ]}""", """              "창업부지는 안심소개 원본을 참조만 합니다(INV-GWAN2)"] },
      /* v10.22 — 축마다 주소(path)를 줍니다: #/g/biz · /jobs · /advisory · /info. 전에는 축을 골라도 주소가 #/g/biz 그대로라
         새로 열면 늘 「창업」 축이었습니다(G-140).
         인력 축은 엽니다(open) — 10/7 답 「A-09 회신 완료 — 연다」. 「도급만 · 개인 노출 없음」은 막는 표시가 아니라 이 축의 조건입니다. */
      { k:"2", nm:"인력", sub:"매칭형", ui:"매칭형", gate:"도급만 · 개인 노출 없음", open:true, path:"/jobs",
        openNote:"도급으로만 잇습니다 — 개인은 노출하지 않습니다.",
        judge:"고용 관계가 성립합니까?", urg:"초단기 급구", cats:[] },
      { k:"3", nm:"운영지원", sub:"서비스형", ui:"서비스형", path:"/advisory",
        judge:"지속적 자문 · 수행 계약이 성립합니까?", cats:[] },
      { k:"4", nm:"정보", sub:"콘텐츠형", ui:"콘텐츠형", path:"/info",
        judge:"거래가 없습니다 — 열람과 신청만 합니다", cats:[] }
    ]}""")
rep("""      { k:"1", nm:"창업", sub:"거래형", ui:"목록형",
        judge:"내일 아침 문을 열고 바로 장사가 됩니까?",""", """      { k:"1", nm:"창업", sub:"거래형", ui:"목록형", path:"/",
        judge:"내일 아침 문을 열고 바로 장사가 됩니까?",""")

# 축 탭 — 주소가 있는 축(소개창업)은 주소로, 없는 축(안심소개)은 전처럼 화면 안에서 바꿉니다
rep("""        var on = t.k===cur.k;
        return '<button class="axt'+(on?" on":"")+(t.gate?" gate":"")+'" role="tab" '+
          'aria-selected="'+(on?"true":"false")+'" data-x="ax'+code+'" data-xv="'+esc(t.k)+'">'+
          '<b>'+esc(t.nm)+'</b><span>'+esc(t.sub)+'</span>'+
          (t.gate?'<i class="axg">'+esc(t.gate)+'</i>':'')+'</button>';""", """        var on = t.k===cur.k, gated = t.gate && !t.open;
        return '<button class="axt'+(on?" on":"")+(gated?" gate":"")+'" role="tab" '+
          'aria-selected="'+(on?"true":"false")+'" '+
          (t.path ? 'data-axgo="'+esc(t.path)+'"' : 'data-x="ax'+code+'"')+' data-xv="'+esc(t.k)+'">'+
          '<b>'+esc(t.nm)+'</b><span>'+esc(t.sub)+'</span>'+
          (t.gate?'<i class="axg'+(t.open?" ok":"")+'">'+esc(t.gate)+'</i>':'')+'</button>';""")
rep("""      (cur.gate?'<span class="axw2">이 축은 '+esc(cur.gate)+'라 아직 열지 않았습니다. 화면만 미리 봅니다.</span>':'')+""",
    """      (cur.gate ? (cur.open
          ? '<span class="axw2 ok">이 축은 '+esc(cur.openNote || cur.gate)+'</span>'
          : '<span class="axw2">이 축은 '+esc(cur.gate)+'라 아직 열지 않았습니다. 화면만 미리 봅니다.</span>') : '')+""")

# 급구 띠 — 인력 축의 「초단기 급구」는 이 축의 초단기 공고만 추립니다
rep("""  function axUrg(code, t){
    if(!t.urg) return '';
    return '<div class="axurg"><b>🔥 '+esc(t.urg)+'</b>'+""", """  function axUrg(code, t){
    if(!t.urg) return '';
    /* v10.22 (G-141) — 인력 축의 「초단기 급구」는 이 축의 초단기 공고만 추립니다. 전에는 일반 급구급매 화면(부동산 · 자동차 매물)으로 갔습니다. */
    if(code==="BIZ" && t.k==="2"){
      var on = !!S.axurg && (S.axjob||"공고")==="공고";
      return '<div class="axurg"><b>🔥 '+esc(t.urg)+'</b>'+
        '<span>'+(on ? '초단기 공고만 보고 있습니다' : '이 축에서 마감이 임박한 건만 모읍니다')+'</span>'+
        '<button class="bo sm" data-axgo="'+(on?"/jobs":"/jobs/urgent")+'">'+(on?"전체 보기":"보러 가기 ›")+'</button></div>';
    }
    return '<div class="axurg"><b>🔥 '+esc(t.urg)+'</b>'+""")

# ══ ② 소개창업 축 — 항목 장부 · 목록 · 상세 (AXD ~ axBodyInfo 자리) ═══════════════════
i0 = s.index('  var AXD = {\n'); i1 = s.index('  /* ── 생활 · 금융 상담 축 업종')
old = s[i0:i1]
q0 = old.index('  /* ── 빠른 매칭 ──'); q1 = old.index('  function axBodyJob(code, t){')
assert old.count('function ') == 4 and 'function axBodyCsl' in old and 'function axBodyInfo' in old, old.count('function ')
quick = old[q0:q1]
assert quick.count('''(r[0]==="오늘"?" hot":"")''') == 1
quick = quick.replace('''(r[0]==="오늘"?" hot":"")''', '''(r[0]==="오늘"?" axhot":"")''')

NEW_DATA = r'''  /* ══ v10.22 소개창업 축 — 항목 장부 ═══════════════════════════════════════
   * 10/7 지시 — 「공고 · 자문 서비스 · 정책 · 교육 상세를 만들고 주소도 항목마다 다르게(v10.21 매물 상세와 같은 방식)」.
   * 전에는 세 축의 줄 단추 22개가 모두 안내 글만 띄웠고 상세 화면이 없었습니다(G-140).
   * 항목마다 번호를 붙여 두고, 상세는 주소의 번호로 그 항목을 찾아 그립니다.
   *   공고 9101~ (#/g/biz/job/번호) · 자문 서비스 9201~ (/advisory/번호) · 정책 9301~ (/policy/번호) · 교육 9401~ (/edu/번호)
   * 날짜는 오늘 기준으로 계산합니다 — 적어 둔 날짜는 시간이 지나면 「지난 공고」가 됩니다(전에는 9/14 · 9/20 · 9/30 이 남아 있었습니다 · G-141).
   * 자료는 시연용 견본입니다. 실제 웹 · 서버에는 이 세 축이 아직 없습니다. */
  function axDay(n){ var d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n); return d; }
  function axMD(n){ var d=axDay(n); return (d.getMonth()+1)+"/"+d.getDate(); }
  function axYMD(n){ var d=axDay(n); return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2); }
  function axSpan(a, b){ var x=axDay(a), y=axDay(b); return axMD(a)+"~"+(x.getMonth()===y.getMonth() ? y.getDate() : axMD(b)); }
  var AXKIND = {
    job:{ key:"bjob", path:"/job/",      up:"/jobs",     ax:"인력",     pre:"J", lab:"공고번호",   h:"공고 내용",   cat:"소개창업 · 인력 · 공고" },
    svc:{ key:"bsvc", path:"/advisory/", up:"/advisory", ax:"운영지원", pre:"S", lab:"서비스번호", h:"서비스 내용", cat:"소개창업 · 운영지원 · 자문 서비스" },
    pol:{ key:"bpol", path:"/policy/",   up:"/info",     ax:"정보",     pre:"P", lab:"정책번호",   h:"지원 내용",   cat:"소개창업 · 정보 · 정책 소개" },
    edu:{ key:"bedu", path:"/edu/",      up:"/info/edu", ax:"정보",     pre:"E", lab:"과정번호",   h:"과정 내용",   cat:"소개창업 · 정보 · 창업 교육" }
  };
  var AXFEE = "채용 기업이 성사 수수료를 냅니다 (INV-9 · 당사자 직접 수수)";
  var AXI = null, AXL = null;
  function axInit(){
    if (AXI) return;
    AXI = {}; AXL = { job:[], svc:[], pol:[], edu:[] };
    function put(kind, no, o){ o.no = String(no); o.kind = kind; AXI[o.no] = o; AXL[kind].push(o); }
    var d2 = axMD(2), ev = axSpan(8, 9);
    /* 공고 — [구분 · 제목 · 대금 · 조건] 은 앞 판의 줄 그대로(날짜만 오늘 기준) */
    put("job", 9101, { b:"정규", t:"주방장 (한식) — 경기 남부 프랜차이즈 직영점", p:"월 420~480만원", c:"경력 5년 이상",
      sub:"경기 남부 · 1명 · 경력 5년 이상",
      desc:"프랜차이즈 직영점의 한식 주방을 맡을 주방장을 찾는 공고입니다. 헤드헌팅사 · 인력대행업체를 통해 진행합니다.",
      spec:[["구분","정규"],["업무","한식 주방 총괄 · 조리 인력 관리"],["근무지","경기 남부 (직영점)"],["인원","1명"],["기간","정규"],
            ["대금","월 420~480만원"],["조건","경력 5년 이상"],["마감","충원 시 마감"],["수수료",AXFEE]] });
    put("job", 9102, { b:"초단기", hot:1, t:"물류센터 상하차 일용 12명 — "+d2+" 하루", p:"일 132,000원", c:"D-2 마감",
      sub:"수도권 물류센터 · 12명 · "+d2+" 하루",
      desc:"물류센터 상하차 일감을 하루 맡을 업체를 찾는 공고입니다. 도급으로만 잇습니다.",
      spec:[["구분","초단기"],["업무","상하차 · 분류 보조"],["근무지","수도권 물류센터"],["인원","12명"],["기간",d2+" 하루"],
            ["대금","일 132,000원"],["마감","D-2 마감"],["수수료",AXFEE]] });
    put("job", 9103, { b:"초단기", hot:1, t:"행사 진행 보조 6명 — "+ev, p:"일 110,000원", c:"D-8 마감",
      sub:"행사장 · 6명 · "+ev+" (2일)",
      desc:"행사 진행을 도울 일감을 이틀 맡을 업체를 찾는 공고입니다. 도급으로만 잇습니다.",
      spec:[["구분","초단기"],["업무","행사장 안내 · 진행 보조"],["근무지","행사장 (요청 접수 뒤 안내)"],["인원","6명"],["기간",ev+" (2일)"],
            ["대금","일 110,000원"],["마감","D-8 마감"],["수수료",AXFEE]] });
    put("job", 9104, { b:"정규", t:"편의점 다점포 SV (수도권 8개점)", p:"연 4,200만원", c:"경력 3년 이상",
      sub:"수도권 8개점 · 1명 · 경력 3년 이상",
      desc:"편의점 8개 점포를 맡아 관리할 슈퍼바이저를 찾는 공고입니다. 헤드헌팅사 · 인력대행업체를 통해 진행합니다.",
      spec:[["구분","정규"],["업무","8개 점포 순회 관리 · 발주 · 인력 배치"],["근무지","수도권 (8개점)"],["인원","1명"],["기간","정규"],
            ["대금","연 4,200만원"],["조건","경력 3년 이상"],["마감","충원 시 마감"],["수수료",AXFEE]] });
    /* 자문 서비스 — [구분 · 제목 · 요금 · 범위 · 성사] */
    function svc(no, b, t, p, scope, done, term, out){
      put("svc", no, { b:b, t:t, p:p, scope:scope, done:done, sub:scope+" · "+done,
        desc:t+" 자문 서비스입니다. 견적을 요청하면 조건에 맞는 컨설턴트를 이어 드리고, 계약은 당사자끼리 맺습니다.",
        spec:[["구분",b],["서비스 범위",scope],["요금",p],["진행 방식","견적 요청 → 매칭 → 계약"],["기간",term],["결과물",out],["성사 실적",done]] });
    }
    svc(9201, "창업컨설팅", "프랜차이즈 출점 타당성 검토", "건당 150만원~", "점포 입지 · 손익 추정 · 계약 검토", "성사 12건", "2~3주", "입지 · 손익 검토 보고서");
    svc(9202, "창업컨설팅", "업종 전환 · 사업 재설계",     "월 80만원~",   "3개월 단위 동행",                 "성사 7건",  "3개월 단위", "전환 계획 · 월별 점검");
    svc(9203, "회사운영",   "세무 · 노무 기장 대리",       "월 15만원~",   "창업 1년 미만 전용 요율",         "성사 31건", "월 단위 계약", "월 기장 · 신고 대리");
    svc(9204, "회사운영",   "온라인 마케팅 대행",          "월 90만원~",   "검색 · 지도 · 리뷰 관리",         "성사 19건", "월 단위 계약", "월간 운영 보고");
    /* 정책 — [구분 · 제목 · 주관 · 기한 · 한도]. 기한은 오늘 기준 */
    function pol(no, t, org, days, limit, who){
      var due = "~"+axYMD(days);
      put("pol", no, { b:"정책", t:t, p:limit, org:org, due:due, sub:org+" · 신청 기한 "+due,
        desc:org+"의 지원사업 「"+t+"」을(를) 소개하는 자리입니다. 신청은 주관 기관에서 받습니다.",
        spec:[["구분","정책"],["주관 기관",org],["지원 한도",limit],["신청 기한",due],["지원 대상",who+" (견본)"],["신청 방법","주관 기관 누리집에서 신청 — 원문 링크 연동 전"]] });
    }
    pol(9301, "소상공인 창업 초기자금 (2026년 2차)", "중소벤처기업부", 8,  "최대 7,000만원 · 연 2.5%",     "창업 초기 소상공인");
    pol(9302, "청년 창업 사업화 지원",              "창업진흥원",     23, "최대 5,000만원",               "청년 예비 · 초기 창업자");
    pol(9303, "경기도 소상공인 시설개선 보조",        "경기도",         44, "최대 1,000만원 (자부담 30%)",   "경기도 내 소상공인");
    /* 교육 — [구분 · 제목 · 기간 · 방식 · 수강료 · 정원] */
    function edu(no, t, term, fee, cap, body){
      put("edu", no, { b:"강의", t:t, p:fee, term:term, fee:fee, cap:cap, sub:term+" · "+cap,
        desc:"「"+t+"」 과정입니다. 수강 신청은 제휴 기관에서 받습니다.",
        spec:[["구분","강의"],["기간 · 방식",term],["수강료",fee],["정원",cap],["과정 내용",body],["운영","제휴 기관 (연동 전)"]] });
    }
    edu(9401, "처음 창업하는 사람을 위한 계약서 읽기", "4주 · 온라인",          "무료",   "선착순 40명", "임대차 · 가맹 · 권리금 계약서 읽는 법");
    edu(9402, "권리금 · 인수 실사 실무",              "2주 · 오프라인(서울)",  "12만원", "정원 20명",   "권리금 산정 · 매출 자료 확인 · 인수 계약 점검");
    edu(9403, "프랜차이즈 가맹 전 확인할 7가지",       "1일 특강",              "무료",   "상시",        "정보공개서 · 가맹금 · 영업 지역 등 7가지 확인 항목");
  }
  /* 지금 주소(#/g/biz/job/번호 등)의 항목. 번호가 없거나 다른 종류의 것이면 그 종류의 첫 항목입니다. */
  function axItem(kind){ axInit(); var it = AXI[String(S.axno || "")]; return (it && it.kind === kind) ? it : AXL[kind][0]; }
  function axOpen(no){ axInit(); var it = AXI[String(no || "")]; if (!it) return; goHref(AUTH.gwanHref("BIZ", AXKIND[it.kind].path + it.no)); }
  /* 줄 한 개 — 제목과 단추 모두 그 항목의 상세로 갑니다 */
  function axRow(it, badge, ls, right, btn){
    return '<div class="axrow" data-axno="'+esc(it.no)+'"><div class="axl">'+badge+
      '<b><button type="button" class="axtt" data-axopen="'+esc(it.no)+'">'+esc(it.t)+'</button></b>'+
      '<span class="ls">'+ls+'</span></div>'+
      '<div class="axr"><b>'+esc(right)+'</b>'+
      '<button class="bo sm" data-axopen="'+esc(it.no)+'">'+esc(btn)+'</button></div></div>';
  }
  function axBadge(it){ return '<span class="axb'+(it.hot?" axhot":"")+'">'+esc(it.b)+'</span>'; }


'''

NEW_LISTS = r'''  var AXWARN_B2B = '<div class="axwarn"><b>기업 대 기업으로만 잇습니다.</b> 개인 구직자를 직접 노출하지 않고 '+
      '헤드헌팅사 · 인력대행업체를 소개합니다. '+
      '소개자는 양쪽을 잇고 빠집니다 — <b>고용 과정에 개입하지 않습니다.</b></div>';
  function axBodyJob(code, t){
    axInit();
    var d = S.axjob || "공고", urg = !!S.axurg && d==="공고", req = S.axreq || {};
    var PATH = { "공고":"/jobs", "지원":"/jobs/applied", "빠른 매칭":"/jobs/quick" };
    /* v10.22 (G-141) — 「지원」 갈래는 내가 소개를 요청한 공고입니다. 전에는 「공고」와 같은 4건이 그대로 나왔습니다. */
    var list = d==="지원" ? AXL.job.filter(function(x){ return req[x.no]; })
                          : AXL.job.filter(function(x){ return !urg || x.hot; });
    return axUrg(code,t)+
      '<div class="panel"><div class="axdir" role="tablist" aria-label="인력 방향">'+
      ["공고","지원","빠른 매칭"].map(function(x){
        return '<button class="axd'+(d===x?" on":"")+'" role="tab" aria-selected="'+(d===x?"true":"false")+
          '" data-axgo="'+PATH[x]+'" data-xv="'+esc(x)+'">'+esc(x)+'</button>'; }).join("")+'</div>'+
      /* ★ A-09 회신 완료(2026-09-18) — 빠른 매칭을 엽니다. v10.22 (10/7 답 「회신 완료 — 연다」) — 공고 상세 · 소개 요청도 엽니다.
       *   다만 **개인은 여전히 노출하지 않습니다.** 회신이 푼 것은
       *   도급 매칭이지 근로자 파견이 아닙니다. 개인을 직접 이으면
       *   근로자파견법에 걸리는 것은 그대로입니다. */
      AXWARN_B2B+
      (d==="빠른 매칭"
        ? axQuickMatch()
        : d==="지원" && !list.length
        ? '<div class="axempty"><b>아직 소개 요청한 공고가 없습니다.</b>'+
          '「공고」에서 공고를 열어 「업체 소개 요청」을 누르면 여기에 쌓입니다.<br>'+
          '<button class="bo sm" data-axgo="/jobs">공고 보러 가기</button></div>'
        : '<div class="axrows">'+list.map(function(x){
            return d==="지원"
              ? axRow(x, '<span class="axb axok">접수됨</span>', esc(x.c)+' · 소개 요청 접수 — 업체 회신을 기다리는 중입니다', x.p, "지원 내역")
              : axRow(x, axBadge(x), esc(x.c)+' · 채용 기업이 성사 수수료를 냅니다(INV-9 · 당사자 직접 수수)', x.p, "공고 보기");
          }).join("")+'</div>')+
      '</div>';
  }
  function axBodyCsl(code, t){
    axInit();
    return '<div class="panel">'+
      '<div class="sh2" style="padding:0 0 12px"><b>🧭 창업 컨설팅 · 회사운영 자문</b>'+
      '<span class="ls">견적 요청 → 매칭 → 계약. 소개장터의 용역 흐름을 그대로 씁니다</span></div>'+
      '<div class="axrows">'+AXL.svc.map(function(x){
        return axRow(x, axBadge(x), esc(x.scope)+' · '+esc(x.done), x.p, "상세 보기"); }).join("")+'</div>'+
      '<div class="axnote2">컨설턴트는 <b>소개자이기도 합니다</b> — 창업 성사 건을 직접 이으면 소개비도 함께 받습니다.</div>'+
      '</div>';
  }
  function axBodyInfo(code, t){
    axInit();
    var d = S.axinfo || "정책";
    var PATH = { "정책":"/info", "교육":"/info/edu" };
    return '<div class="panel">'+
      '<div class="axdir" role="tablist" aria-label="정보 종류">'+
      ["정책","교육"].map(function(x){
        return '<button class="axd'+(d===x?" on":"")+'" role="tab" aria-selected="'+(d===x?"true":"false")+
          '" data-axgo="'+PATH[x]+'" data-xv="'+esc(x)+'">'+esc(x==="정책"?"정책 소개":"창업 교육")+'</button>'; }).join("")+'</div>'+
      '<div class="axinv"><b>이 축은 소개비 구조 밖입니다.</b> 거래가 없으므로 INV-9(소개비 직접 수수) 적용 대상이 아니고, '+
      '카드에 소개비 · 방향(팝니다/삽니다) 칸이 없습니다.</div>'+
      '<div class="axrows">'+(d==="교육" ? AXL.edu : AXL.pol).map(function(x){
        return d==="교육" ? axRow(x, axBadge(x), esc(x.term)+' · '+esc(x.fee), x.cap, "상세 보기")
                          : axRow(x, axBadge(x), esc(x.org)+' · '+esc(x.due), x.p, "공고 보기"); }).join("")+'</div>'+
      (d==="정책"
        ? '<div class="axcta"><b>내 창업계획 등록하기</b>'+
          '<span>정책을 보다가 바로 "이런 걸 찾습니다"를 남깁니다 — 소개받기(BUY) 리스팅이 만들어집니다</span>'+
          /* v10.22 (G-141) — 등록 양식으로 갑니다. 전에는 요청 목록(reql)으로 갔습니다. */
          '<button class="bp sm" data-go="reqn">창업계획 등록</button></div>'
        : '')+
      '</div>';
  }

  /* ══ v10.22 상세 한 틀 — 공고(SB-BIZ-JOB-020) · 자문 서비스(SB-BIZ-SVC-020) · 정책(SB-BIZ-POL-020) · 교육(SB-BIZ-EDU-020) ══
   * 구분 · 제목 · 값 · 번호 · 내용표 · 안내 · 맨 아래 줄. 줄에서 넘겨받은 값으로 그립니다.
   * 신청 단추 가운데 아직 연결되지 않은 것(자문 요청 · 원문 공고 · 수강 신청)은 목록에 있던 안내 글을 그대로 씁니다. */
  function axDetail(kind){
    var KD = AXKIND[kind], it = axItem(kind), no = it.no;
    var prev = S.hist.length ? S.hist[S.hist.length-1] : null;
    var backNm = (!prev || prev === "listb") ? KD.ax : (NAVNAME[prev] || "이전 화면");
    var share = '<button class="bo" data-share="1">↗ 공유하기</button>';
    var report = '<button class="bo rp" data-t="신고가 접수되었습니다. 검토 후 알려 드립니다.">신고</button>';
    var notes = "", bar = "", sample = "";
    if (kind === "job") {
      var req = !!(S.axreq && S.axreq[no]);
      notes = AXWARN_B2B +
        '<div class="axwarn"><b>대금은 당사자끼리 주고받습니다.</b> 소개뱅크 계좌로 보내지 마십시오 — 저희는 수탁하지 않습니다(INV-9 · INV-11).</div>';
      bar = share + report + '<span class="sp"></span>' + (req
        ? '<button class="go done" data-t="이미 접수된 요청입니다 — 「지원」 갈래에서 볼 수 있습니다."><span>요청 접수됨</span>'+
          '<small>업체 회신을 기다리는 중입니다</small></button>'
        : '<button class="go" data-axreq="'+esc(no)+'"><span>업체 소개 요청</span>'+
          '<small>인력대행업체 · 헤드헌팅사를 이어 드립니다</small></button>');
    } else if (kind === "svc") {
      notes = '<div class="axnote2">컨설턴트는 <b>소개자이기도 합니다</b> — 창업 성사 건을 직접 이으면 소개비도 함께 받습니다.</div>';
      bar = share + report + '<span class="sp"></span>'+
        '<button class="go" data-t="자문 요청 폼은 소개장터 용역 흐름을 재사용합니다 — 아직 연결 전입니다."><span>자문 요청</span>'+
        '<small>견적 요청 → 매칭 → 계약</small></button>';
    } else {
      sample = '<div class="axsample"><b>시연용 견본 — '+(kind==="pol" ? "실제 공고가 아닙니다." : "실제 모집 중인 과정이 아닙니다.")+'</b> '+
        '기관 이름 · 금액 · 기한은 화면 구성을 보이기 위한 예시입니다. 실제 서비스에서는 '+(kind==="pol" ? "주관 기관의 원문" : "제휴 기관의 과정 안내")+'을 연결합니다.</div>';
      notes = '<div class="axinv"><b>이 축은 소개비 구조 밖입니다.</b> 거래가 없으므로 INV-9(소개비 직접 수수) 적용 대상이 아닙니다 — 열람과 신청만 합니다.</div>';
      bar = share + (kind==="pol" ? '<button class="bo" data-go="reqn">창업계획 등록</button>' : '') + '<span class="sp"></span>' + (kind==="pol"
        ? '<button class="go" data-t="지원사업 상세는 원문 링크 연동 전입니다."><span>원문 공고 보기</span><small>주관 기관 누리집으로 연결합니다</small></button>'
        : '<button class="go" data-t="수강 신청은 제휴 기관 연동 전입니다."><span>수강 신청</span><small>제휴 기관에서 접수합니다</small></button>');
    }
    return header({login:true, blueCta:true})+
      '<div class="wrap" style="padding-top:16px"><button class="bkl" data-back="1">← '+esc(backNm)+'(으)로 돌아가기</button></div>'+
      '<div class="wrap" style="padding-top:14px"><div class="panel axdt" data-kind="'+kind+'" data-no="'+esc(no)+'" style="overflow:hidden">'+
        '<div class="axdh">'+
          '<div class="axdhl">'+axBadge(it)+'<span class="dtcat">'+esc(KD.cat)+'</span></div>'+
          '<h2 class="dtt">'+esc(it.t)+'</h2>'+
          '<div class="dtprice">'+esc(it.p)+'</div>'+
          '<div class="dtsub">'+esc(it.sub)+'</div>'+
          '<div class="dtmeta"><span class="dtno">'+esc(KD.lab)+' '+KD.pre+'-'+esc(no)+'</span></div>'+
        '</div>'+
        sample+
        '<div class="dsec"><h4>'+esc(KD.h)+'</h4>'+
          '<p>'+esc(it.desc)+'</p>'+
          '<dl class="spec">'+it.spec.map(function(r){ return '<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>'; }).join("")+'</dl>'+
        '</div>'+
        '<div class="dsec" style="margin-bottom:16px">'+notes+'</div>'+
        '<div class="abar">'+bar+'</div>'+
      '</div></div>'+ footer();
  }

'''
s = s[:i0] + NEW_DATA + quick + NEW_LISTS + s[i1:]

# 안심소개 상담 축의 강조 배지(.hot → .axhot)
rep("""'<div class="axrow"><div class="axl"><span class="axb hot">자격 확인</span><b>'""", """'<div class="axrow"><div class="axl"><span class="axb axhot">자격 확인</span><b>'""")
rep("""'<span class="axb'+(r[2]==="GATED"?" hot":"")+'">'""", """'<span class="axb'+(r[2]==="GATED"?" axhot":"")+'">'""")
assert 'axb hot' not in s and '?" hot":"")' not in s[i0:i0 + 40000]

# ══ ② 화면 표 · 이름 · 돌아갈 곳 ══════════════════════════════════════
rep("""         reg:function(){return scReg(false);},regm:function(){return scReg(true);}};""",
    """         reg:function(){return scReg(false);},regm:function(){return scReg(true);},
         /* v10.22 — 소개창업 축의 상세 4종 */
         bjob:function(){return axDetail("job");},bsvc:function(){return axDetail("svc");},
         bpol:function(){return axDetail("pol");},bedu:function(){return axDetail("edu");}};""")
rep("""    detail:"소개창업 상세", dtm:"상세",""", """    detail:"소개창업 상세", dtm:"상세", bjob:"공고 상세", bsvc:"자문 서비스 상세", bpol:"정책 상세", bedu:"교육 상세",   /* v10.22 */""")
rep("""    detail:"list", dtm:"list", dtlm:"lstm", dtll:"lstl2",
""", """    detail:"list", dtm:"list", dtlm:"lstm", dtll:"lstl2",
    bjob:"listb", bsvc:"listb", bpol:"listb", bedu:"listb",   /* v10.22 */
""")
# 돌아가기 — 축 · 갈래의 주소로
rep("""    if (prev && R[prev] && ph && /\\/(l|chat)\\/[\\w-]+\\/?$/.test(ph) && ROUTE.href) { S.back = true; ROUTE.href(ph); return; }
    if (prev && R[prev]) { S.back = true; go(prev); return; }
""", """    if (prev && R[prev] && ph && /\\/(l|chat|job|advisory|policy|edu)\\/[\\w-]+\\/?$/.test(ph) && ROUTE.href) { S.back = true; ROUTE.href(ph); return; }
    /* v10.22 — 소개창업의 축 · 갈래(#/g/biz/jobs · /jobs/applied · /advisory · /info/edu …)도 주소로 돌아갑니다. 화면 키(listb)만으로는 「창업」 축이 열립니다. */
    if (prev && R[prev] && ph && /\\/(jobs|advisory|info)(\\/[\\w-]+)?\\/?$/.test(ph) && ROUTE.href) { S.back = true; ROUTE.href(ph); return; }
    /* v10.22 — 주소로 바로 연 축 상세는 그 종류의 목록으로 돌아갑니다. 바로 열면 이력에는 처음 상태(메인 · 주소 없음) 하나만 있습니다. */
    var axk = { bjob:"job", bsvc:"svc", bpol:"pol", bedu:"edu" }[S.screen];
    if (axk && ROUTE.href && (!prev || (!ph && !S.hist.length && (prev === "main1" || prev === "main2")))) {
      S.back = true; goHref(AUTH.gwanHref("BIZ", AXKIND[axk].up)); return; }
    if (prev && R[prev]) { S.back = true; go(prev); return; }
""")
# 누르는 것 — 축 주소 · 항목 상세 · 업체 소개 요청
rep("""    var ai=e.target.closest("[data-askitem]");   /* v10.21 — 매물을 들고 문의방으로 */
""", """    var ag=e.target.closest("[data-axgo]");      /* v10.22 — 소개창업 축 · 갈래의 주소로 */
    if(ag){ e.preventDefault(); goHref(AUTH.gwanHref("BIZ", ag.getAttribute("data-axgo"))); return; }
    var ao=e.target.closest("[data-axopen]");    /* v10.22 — 줄의 항목 상세로 */
    if(ao){ e.preventDefault(); axOpen(ao.getAttribute("data-axopen")); return; }
    var ar=e.target.closest("[data-axreq]");     /* v10.22 — 공고 상세의 「업체 소개 요청」(10/7 답 「회신 완료 — 연다」). 개인은 노출하지 않고 업체를 잇습니다 */
    if(ar){ S.axreq = S.axreq || {}; S.axreq[ar.getAttribute("data-axreq")] = true; render();
      toast("소개 요청을 접수했습니다 — 조건에 맞는 인력대행업체 · 헤드헌팅사가 회신하면 알려 드립니다."); return; }
    var ai=e.target.closest("[data-askitem]");   /* v10.21 — 매물을 들고 문의방으로 */
""")
# 그릴 때 — 주소에 없는 값은 비웁니다
rep("""  if (!params || !("postId" in params)) S.postId = null;
""", """  if (!params || !("postId" in params)) S.postId = null;
  /* v10.22 — 소개창업의 축은 주소가 정합니다. 주소에 축이 없으면(#/g/biz) 「창업」 축입니다 — 앞에서 본 축이 남으면 안 됩니다. */
  if (!params || !("axno" in params)) S.axno = null;
  if (key === "listb") { if (!params || !("axBIZ" in params)) S.axBIZ = null; if (!params || !("axurg" in params)) S.axurg = false; }
""")

# ══ ② 주소 ══════════════════════════════════════════════════════
rep("""  /* 루트: 관 안이면 그 관의 랜딩, 통합 메인이면 로그인 여부로 갈립니다 */
""", """  /* v10.22 — 소개창업의 축(인력 · 운영지원 · 정보) · 갈래와 상세 4종. 관은 언제나 소개창업입니다(주소에 /g/biz 가 없어도). */
  { re:/^\\/jobs\\/?$/,          screen:"listb", params:m=>({gwan:"BIZ", axBIZ:"2", axjob:"공고", axurg:false}), title:"소개창업 · 인력", desc:"일감을 맡을 업체를 잇습니다 — 도급만, 개인은 노출하지 않습니다." },
  { re:/^\\/jobs\\/urgent\\/?$/,  screen:"listb", params:m=>({gwan:"BIZ", axBIZ:"2", axjob:"공고", axurg:true}),  title:"소개창업 · 인력 · 초단기 급구", desc:"마감이 임박한 초단기 공고만 모았습니다." },
  { re:/^\\/jobs\\/applied\\/?$/, screen:"listb", params:m=>({gwan:"BIZ", axBIZ:"2", axjob:"지원", axurg:false}), title:"소개창업 · 인력 · 지원", desc:"내가 소개를 요청한 공고입니다." },
  { re:/^\\/jobs\\/quick\\/?$/,   screen:"listb", params:m=>({gwan:"BIZ", axBIZ:"2", axjob:"빠른 매칭", axurg:false}), title:"소개창업 · 인력 · 빠른 매칭", desc:"급한 일감을 맡을 업체를 바로 찾습니다." },
  { re:/^\\/advisory\\/?$/,      screen:"listb", params:m=>({gwan:"BIZ", axBIZ:"3"}), title:"소개창업 · 운영지원", desc:"창업 컨설팅 · 회사운영 자문 서비스입니다." },
  { re:/^\\/info\\/?$/,          screen:"listb", params:m=>({gwan:"BIZ", axBIZ:"4", axinfo:"정책"}), title:"소개창업 · 정보 · 정책 소개", desc:"창업 지원 정책을 소개합니다." },
  { re:/^\\/info\\/edu\\/?$/,     screen:"listb", params:m=>({gwan:"BIZ", axBIZ:"4", axinfo:"교육"}), title:"소개창업 · 정보 · 창업 교육", desc:"창업 교육 과정을 소개합니다." },
  { re:/^\\/job\\/([\\w-]+)\\/?$/,      screen:"bjob", params:m=>({gwan:"BIZ", axno:m[1]}), title:"공고 상세", desc:"공고 내용과 조건을 봅니다." },
  { re:/^\\/advisory\\/([\\w-]+)\\/?$/, screen:"bsvc", params:m=>({gwan:"BIZ", axno:m[1]}), title:"자문 서비스 상세", desc:"서비스 범위와 요금을 봅니다." },
  { re:/^\\/policy\\/([\\w-]+)\\/?$/,   screen:"bpol", params:m=>({gwan:"BIZ", axno:m[1]}), title:"정책 상세", desc:"지원 한도와 신청 기한을 봅니다." },
  { re:/^\\/edu\\/([\\w-]+)\\/?$/,      screen:"bedu", params:m=>({gwan:"BIZ", axno:m[1]}), title:"교육 상세", desc:"과정 내용과 수강료를 봅니다." },
  /* 루트: 관 안이면 그 관의 랜딩, 통합 메인이면 로그인 여부로 갈립니다 */
""")
rep("""  lstm:"/list", lstl2:"/list", lstb2:"/list", dtlm:"/l/4471", dtll:"/l/4468",
  regb:"/register/biz", src:"/search", lsth:"/listings",""", """  lstm:"/list", lstl2:"/list", lstb2:"/list", dtlm:"/l/4471", dtll:"/l/4468",
  bjob:"/job/9101", bsvc:"/advisory/9201", bpol:"/policy/9301", bedu:"/edu/9401",   /* v10.22 */
  regb:"/register/biz", src:"/search", lsth:"/listings",""")
rep("""  const inGwan = ["win","bst","urg","saf","detail","dtm","evt","dtlm","dtll","regb"].includes(screen);""",
    """  const inGwan = ["win","bst","urg","saf","detail","dtm","evt","dtlm","dtll","regb","bjob","bsvc","bpol","bedu"].includes(screen);""")
# 홈 퀵메뉴 — 축을 주소로 지정
rep("""  "창업 지원":            {href:"#/g/biz", ax:["BIZ","4"], info:"정책"},   /* ★ §4-2 확정 */""",
    """  "창업 지원":            {href:"#/g/biz/info"},   /* ★ §4-2 확정 · v10.22 — 축은 주소로 지정합니다(정보 축 · 정책 소개) */""")
rep("""  "창업 상담":            {href:"#/g/biz", ax:["BIZ","3"]}""", """  "창업 상담":            {href:"#/g/biz/advisory"}   /* v10.22 — 운영지원 축 */""")

# ══ ② 화면 ID (화면 정보 표 · proto_ids.json) ═══════════════════════════════
NEW = {
    'bjob': ('SB-BIZ-JOB-020', 'biz.sogaebaenk.co.kr/job/9101',      '공고 상세',        '소개창업 인력 축의 공고 상세. 누른 공고의 내용으로 열립니다. 도급으로만 잇고 개인은 노출하지 않습니다(A-09 회신 완료). 실제 웹에는 아직 없습니다.'),
    'bsvc': ('SB-BIZ-SVC-020', 'biz.sogaebaenk.co.kr/advisory/9201', '자문 서비스 상세', '소개창업 운영지원 축의 자문 서비스 상세. 자문 요청은 소개장터 용역 흐름을 재사용합니다(연결 전). 실제 웹에는 아직 없습니다.'),
    'bpol': ('SB-BIZ-POL-020', 'biz.sogaebaenk.co.kr/policy/9301',   '정책 상세',        '소개창업 정보 축의 정책 상세. 소개비 구조 밖입니다. 시연용 견본 — 원문 링크 연동 전. 실제 웹에는 아직 없습니다.'),
    'bedu': ('SB-BIZ-EDU-020', 'biz.sogaebaenk.co.kr/edu/9401',      '교육 상세',        '소개창업 정보 축의 교육 상세. 소개비 구조 밖입니다. 시연용 견본 — 제휴 기관 연동 전. 실제 웹에는 아직 없습니다.'),
}
m = re.search(r'\n  var META = \{', s); assert m
ins = ''.join('"%s": %s, ' % (k, json.dumps({'id': sid, 'url': url, 'chip': '03 → 04', 'note': note}, ensure_ascii=False)) for k, (sid, url, name, note) in NEW.items())
s = s[:m.end()] + ins + s[m.end():]
ids_path = os.path.join(K, 'spec/proto_ids.json')
raw = open(ids_path, encoding='utf-8').read(); ids = json.loads(raw)
for k, (sid, url, name, note) in NEW.items():
    ids[k] = {'ids': [sid], 'h1': name, 'mapped': '20261007 v10.22 — 시안에만 있는 화면(실제 웹 미구현) · #/g/biz' + {'bjob': '/job/9101', 'bsvc': '/advisory/9201', 'bpol': '/policy/9301', 'bedu': '/edu/9401'}[k]}
indent = 0 if raw.startswith('{\n"') else 1 if raw.startswith('{\n "') else 2 if raw.startswith('{\n  "') else None
out = json.dumps(ids, ensure_ascii=False, indent=indent) + ('\n' if raw.endswith('\n') else '')
if out != raw:
    open(ids_path, 'w', encoding='utf-8').write(out)

# ══ 시연 보장 — 소개뱅크몰에서 「변화가 있었는지」를 보는 법 ══════════════════════════
# 몰의 상품 그림(SVG)은 다시 그릴 때마다 일련번호(id="ar37" → "ar40")가 바뀝니다. 전에는 화면 글자를 다섯 자마다 하나씩만 봐서,
# 그 번호가 우연히 걸리면 「변화 있음」으로 보고 안내를 띄우지 않았습니다(이미 고른 갈래 단추 「전체」를 눌러도 아무것도 안 보임).
# 번호는 빼고, 모든 글자를 봅니다.
rep("""    if(hlt){ var y=(r?r.innerHTML:(h?h.innerHTML:''))+'|'+(ht?ht.innerHTML:''), w=0; for(var j=0;j<y.length;j+=5) w=(w*31+y.charCodeAt(j))|0;""",
    """    /* v10.22 — 상품 그림(SVG)의 일련번호(id="ar37" · url(#ar37))는 다시 그릴 때마다 바뀝니다. 그것만 바뀐 것은 「변화」가 아닙니다.
       전에는 다섯 자마다 하나씩만 봐서 그 번호가 우연히 걸리면 「변화 있음」이 되어, 이미 고른 갈래 단추를 눌렀을 때 안내가 뜨지 않았습니다. */
    if(hlt){ var y=((r?r.innerHTML:(h?h.innerHTML:''))+'|'+(ht?ht.innerHTML:'')).replace(/(id="|url\\(#)ar\\d+/g,'$1ar'), w=0; for(var j=0;j<y.length;j++) w=(w*31+y.charCodeAt(j))|0;""")

# ══ ③ 판 이름 ══════════════════════════════════════════════════════
m = re.search(r'<title>소개뱅크 시안 v10\.21 \(2026-10-07 · ', s); assert m
s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.22 (2026-10-07 · 소개창업 인력 · 운영지원 · 정보 상세 4종 · 항목별 주소 · 언어 단추 수정 · ', 1)
s = s.replace('SGB_Prototype_v10_21.html', 'SGB_Prototype_v10_22.html')

open(P, 'w', encoding='utf-8').write(s)
print(f'proto {n0:,} → {len(s):,} bytes · proto_ids {len(ids)}')
