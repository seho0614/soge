"""시안(spec/proto.html)에 v10.23 을 넣습니다 — 소개광장을 제시 디자인(2026-10-07)대로.

  python3 apply_proto_v1023.py     (v10.22 시안에 한 번 — 이미 v10.23 이면 아무것도 하지 않습니다)
  BASE=/path/SGB_Prototype_v10_22.html python3 apply_proto_v1023.py    (v10.22 파일에서 다시 만들 때)

10/7 사장님 지시 — 「소개몰, 소개광장 디자인대로 적용 · 하위 페이지 생성 · 색상이나 스타일을 제시한 형태를 유지 · 사진을 변환하지 않고 사용(png) ·
                    다른 부분은 현 상태를 유지 · 작업 후 전수 검사」
답 — ① 서버까지 확장(4판으로 나눔 — 이 판은 소개광장) ② 새 머리줄 · 바닥줄은 두 관에서만 ③ 사진 띠는 글자 없는 원본을 올림(오기 전에는 글자 없는 부분만) ④ 「소개뱅크몰」 유지

넣는 것
  ① 두 관 전용 머리줄 · 바닥줄(b2-*) — 그림 로고 · 주황 「무료 회원가입」 · 장바구니 · 「KR」 · 바닥줄(사업자 정보 · 통신판매중개자 고지 유지)
  ② 소개광장 4장(화면 키 5개 — cmu · commu · cmud · cmuw · cmupoll)을 제시 디자인대로
     - 목록: 사진 띠(제목 · 게시글 검색 · 확성기 안내) · 알약 탭 6개 · 표(분류 배지 3색) · 쪽 번호 · 글쓰기
       1쪽의 줄 10개는 그림의 내용 그대로입니다. 견본 글은 72건(8쪽)입니다.
     - 게시판 · 검색어 · 쪽 번호는 주소에 실립니다 — #/community?board=QNA&q=권리금&page=2
     - 글 상세(#/community/{번호} — 누른 글) · 글쓰기 · 투표: 낮은 사진 띠 + 같은 탭 · 같은 색
     - 작성자는 「김OO」처럼 첫 글자만(서버 G-146 과 같은 표기)
  ③ 그림 — 실제 웹의 PNG 파일(site/public/b2/*.png)을 **바이트 그대로** 파일 안에 넣습니다(PLZ_ART). 다시 저장하거나 줄이지 않습니다.
  ④ 스타일 — 실제 웹의 styles/b2.css · plaza.css 를 그대로 읽어 넣고, 시안의 부품(.bp · .nt · .inp · 투표 카드)에 필요한 것만 덧붙입니다.
  ⑤ 판 이름 v10.23
화면 수는 193 그대로입니다(모양만 바뀜). 소개뱅크몰은 v10.24 에서 합니다.
"""
import base64, json, os, re, shutil

_kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
K = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'spec')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
Q = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(K, 'spec/proto.html')
BASE = os.environ.get('BASE')
if BASE:
    shutil.copyfile(BASE, P)
s = open(P, encoding='utf-8').read()
n0 = len(s)
if re.search(r'<title>소개뱅크 시안 v10\.23 ', s):
    print('이미 v10.23 입니다 — 바꾸지 않았습니다'); raise SystemExit(0)
assert re.search(r'<title>소개뱅크 시안 v10\.22 ', s), 'v10.22 시안이 아닙니다'

def rep(old, new, n=1):
    global s
    assert s.count(old) == n, (old[:80], s.count(old))
    s = s.replace(old, new)

# ══ ③ 그림 — 실제 웹의 PNG 파일을 바이트 그대로 ═══════════════════════════════════════
man = json.load(open(os.path.join(Q, 'b2_assets.json'), encoding='utf8'))
art = {}
for src, parts in man.items():
    if src.startswith('_'): continue
    for name in parts:
        data = open(os.path.join(K, 'site/public/b2', name), 'rb').read()
        assert data[:8] == b'\x89PNG\r\n\x1a\n', name
        art[name[:-4]] = 'data:image/png;base64,' + base64.b64encode(data).decode()
m = re.search(r'\nvar EMBEDDED_IMG = \{.*\};\n', s); assert m
s = s[:m.end()] + ('/* v10.23 — 소개광장 · 두 관 머리줄의 그림. 받은 디자인(docs/design/plaza_design_20261007.png)에서 그 자리만 잘라 낸 PNG 를\n'
                   '   **파일 그대로**(다시 저장하지 않고) 넣었습니다 — 실제 웹의 site/public/b2/*.png 와 바이트가 같습니다(qa/cut_b2.py · qa/proto_cmu.py P-1). */\n'
                   'var PLZ_ART = ' + json.dumps(art, ensure_ascii=False) + ';\n') + s[m.end():]

# ══ ④ 스타일 ══════════════════════════════════════════════════════════════════════
b2 = open(os.path.join(K, 'site/src/styles/b2.css'), encoding='utf8').read()
plz = open(os.path.join(K, 'site/src/styles/plaza.css'), encoding='utf8').read()
assert '.main.main-b2 { max-width: none; padding: 0; background: #fff; }' in b2
b2 = b2.replace('.main.main-b2 { max-width: none; padding: 0; background: #fff; }\n', '')
EXTRA = r'''
/* ── 시안에만 있는 것 — 단추로 그린 머리줄 칸 · 언어 단추 · 로그인한 사람의 칸 · 시안 공용 부품의 색 ── */
.b2-hd button, .b2-ft button { font-family: inherit; cursor: pointer; }
.b2-hd .b2-find, .b2-hd .b2-login, .b2-hd .b2-lngb { background: #fff; }
.b2-hd .b2-join { border: 0; background: var(--b2-orange); }
.b2-hd .b2-adm { height: 46px; padding: 0 18px; border-radius: 23px; border: 1px solid var(--b2-navy); background: #fff; color: var(--b2-navy); font-size: 15px; font-weight: 800; white-space: nowrap; }
.b2-hd .b2-user { font-size: 15px; font-weight: 700; white-space: nowrap; color: #000; }
.b2-hd .bell { font-size: 18px; cursor: pointer; }
.b2-hd .lang { position: relative; }
.b2-lngb { height: 46px; padding: 0 24px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #F0F1F4; border-radius: 23px; color: #000; font-size: 18px; font-weight: 700; white-space: nowrap; box-sizing: border-box; }
.b2-lngb svg { flex: none; }
.b2-hd .lgm { top: calc(100% + 6px); }
.b2-ftl a[data-t] { color: var(--b2-dim); font-weight: 600; }
.b2-sns button { border: 0; background: none; padding: 0; opacity: .35; display: inline-flex; }
.plz { font-family: Pretendard, "Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", "Malgun Gothic", -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
.plz a { text-decoration: none; }
.plz-find button { padding: 0; }
.plz-sid { margin: 22px 0 0; text-align: right; color: #B0B6C3; font-size: 12px; font-family: var(--m); }
.plz-wide { margin-top: 28px; }
.plz .pgh { margin: 0 0 10px; }
.plz .pgh p { color: #333; }
.plz .bp { background: var(--plz-navy); border-color: var(--plz-navy); color: #fff; }
.plz .bp:hover { background: #001B45; }
.plz .bo { border-color: var(--plz-navy); color: var(--plz-navy); background: #fff; }
.plz .bs { border-radius: 8px; }
.plz .plz-post-btn { background: var(--plz-orange); border-color: var(--plz-orange); color: #fff; font-weight: 800; padding: 10px 28px; font-size: 16px; border-radius: 10px; }
.plz .plz-post-btn:hover { background: #E39305; }
.plz .nt.info { background: #EEF2F8; border-color: #D5DEEC; color: #1F2A44; }
.plz .nt.info b { color: var(--plz-navy); }
.plz .card { border-color: var(--plz-line); border-radius: 10px; }
.plz .fld { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.plz .fld > span { font-size: 14px; font-weight: 800; color: var(--plz-navy); }
.plz .inp { width: 100%; box-sizing: border-box; border: 1px solid var(--plz-line); border-radius: 8px; padding: 11px 13px; font-size: 15.5px; background: #fff; color: #000; }
.plz .inp:focus { outline: 2px solid var(--plz-navy); outline-offset: -1px; border-color: var(--plz-navy); }
.plz textarea.inp { resize: vertical; line-height: 1.7; }
.plz .opt.on { border-color: var(--plz-navy); background: #EEF2F8; color: var(--plz-navy); }
.plz-cmt { padding: 12px 0; border-bottom: 1px solid #ECEEF2; }
.plz-cmt:last-child { border-bottom: 0; }
.plz-cmt.re { margin-left: 26px; padding-left: 14px; border-left: 2px solid #E3E8F1; }
.plz-cmt b { color: var(--plz-navy); margin-right: 8px; }
.plz-cmt .dim { color: var(--plz-dim); font-size: 13.5px; }
.plz-cmt p { margin: 6px 0 0; font-size: 15.5px; }
.plz .px-kind { color: var(--plz-navy); background: #EEF2F8; }
.plz .px-opts li.on { border-color: var(--plz-navy); }
.plz .px-opts li.res::before { background: #EEF2F8; }
.plz .px-opt i { border-color: var(--plz-navy); }
.plz .px-opts li.on .px-opt i { background: var(--plz-navy); }
.plz .px-opt em, .plz .px-done { color: var(--plz-navy); }
@media (max-width: 900px) {
  .b2-lngb, .b2-hd .b2-adm { height: 34px; font-size: 13px; padding: 0 10px; }
  .b2-hd .b2-user { display: none; }
}
'''
css = ('\n/* ═══ v10.23 (2026-10-07) — 두 관 전용 머리줄 · 바닥줄(b2-*) · 소개광장(plz-*) — 제시 디자인 ═══\n'
       '   아래 두 덩어리는 실제 웹의 styles/b2.css · styles/plaza.css 를 **글자 그대로** 옮긴 것입니다(시안과 실제 웹이 같은 모양이 되게).\n'
       '   이름이 모두 b2- · plz- 로 시작해 시안의 다른 화면과 겹치지 않습니다(G-131 · G-138 · G-139 같은 이름 겹침을 피함). */\n'
       + b2 + '\n' + plz + EXTRA)
i = s.index('</style>'); s = s[:i] + css + s[i:]

# ══ ① ② 머리줄 · 바닥줄 · 소개광장 — 화면 묶음 ①(M_render) 안에 넣습니다(관 목록 · 로그인 상태 · 사이트 정보를 그 안에서 읽음) ══
TRADE = ['식자재 납품 단가, 지역마다 얼마나 다른가요', '카페 창업 3년차가 본 원두 거래처 고르는 법', '인테리어 업체 소개받을 때 견적서에서 볼 것', '물류창고 임대 소개는 왜 잘 안 될까요',
         '프랜차이즈 본사와 직거래 납품 뚫은 과정', '중고 주방 설비, 어디까지 믿고 사도 될까', '세무 기장료 시세 정리(음식점 기준)', '배달 대행 수수료 올해 달라진 점',
         '무인 매장 보안 업체 세 곳 써 본 이야기', '간판 · 사인물 업체는 소개가 답이었습니다', '학원 통학 차량 계약할 때 주의한 것', '건강기능식품 도매 시작하며 겪은 일',
         '병의원 소모품 납품, 첫 거래처 만드는 순서', '소형 물류 차량 지입 계약 살펴보기', '공유 주방 입점 1년 정산 이야기', '포장재 단가 협상에서 배운 것',
         '지역 광고 대행사 고르는 기준', '청소 용역 계약서에 꼭 넣는 문장', '스마트스토어 위탁 판매 거래처 구한 방법', '창업 컨설팅, 어디까지 맡기셨나요', '정수기 렌탈 대리점 수익 구조', '동네 상권 분석, 직접 발로 뛰어 본 결과']
QNA = ['소개코드가 언제 귀속되는지 헷갈립니다', '프랜차이즈 가맹 소개, 계약서 어디까지 봐야 하나요', '소개비 세금계산서는 누가 끊나요', '소개 후기는 거래가 끝나야만 쓸 수 있나요',
       '안심소개 상담 신청하면 연락은 언제 오나요', '사업자 인증 서류, 임대차계약서도 되나요', '소개받은 업체와 직접 계약해도 되나요', '중개사무소 등록번호는 어디서 확인하나요',
       '상가 권리금 양도 계약에서 소개비 기준', '소개비가 늦어질 때는 어떻게 하나요', '매물 사진은 몇 장까지 올릴 수 있나요', '소개자가 두 명이면 소개비는 어떻게 나누나요',
       '급구 표시는 얼마 동안 유지되나요', '창업 정책자금과 소개창업을 같이 쓸 수 있나요', '휴업 중인 사업자도 매물을 올릴 수 있나요', '건강몰 정기 배송 주기를 바꿀 수 있나요',
       '소개받기 요청을 고칠 수 있나요', '파트너센터 정산일이 언제인가요', '기계 · 설비 매물의 인도 조건은 어디에 적나요', '세무사 상담은 무료인가요', '법인과 개인사업자, 소개비 처리가 다른가요', '지역을 여러 곳으로 설정할 수 있나요', '소개받은 견적이 서로 다를 때 기준이 있나요']
REVIEW = ['세무사 소개받고 기장 맡긴 지 반년 후기', '인테리어 업체 연결되어 3주 만에 개업했습니다', '식자재 거래처 바꾸고 원가가 내려간 이야기', '중고 설비 매각, 소개로 일주일 만에 끝냈어요',
          '물류 창고 임대 소개 성사 후기', '프랜차이즈 가맹 상담부터 계약까지', '학원 인수 소개받은 경험', '병원 소모품 납품처 소개 후기', '청소 업체 정기 계약 후기', '간판 업체 소개받고 달라진 점',
          '렌탈 대리점 소개로 시작한 부업', '소개자로 처음 소개비 받은 날', '이사 업체 소개받고 사무실 옮긴 후기']
NOTICE = ['[공지] 검수 처리 시간 안내 — 영업일 기준 24시간', '[공지] 제한업종 5종 안내', '[공지] 소개광장 이용 규칙', '[공지] 추석 연휴 고객센터 운영 안내']
assert len(TRADE) == 22 and len(QNA) == 23 and len(REVIEW) == 13 and len(NOTICE) == 4 and len(set(TRADE + QNA + REVIEW + NOTICE)) == 62, (len(TRADE), len(QNA), len(REVIEW), len(NOTICE))

JS = r'''
  /* ══ v10.23 (2026-10-07) — 소개광장 · 두 관 전용 머리줄 · 바닥줄 — 제시 디자인(docs/design/plaza_design_20261007.png) ══════════
     사장님 지시 — 「디자인대로 적용 · 하위 페이지 생성 · 색 · 스타일 유지 · 사진은 변환 없이 png · 다른 부분은 현 상태 유지」
     답 — 새 머리줄 · 바닥줄은 **두 관에서만** · 메뉴 이름은 「소개뱅크몰」 유지 · 사진 띠는 글자 없는 원본을 받기 전까지 글자 없는 부분만.
     · 그림은 PLZ_ART(받은 그림에서 자른 PNG 그대로)입니다. 선으로 된 기호(돋보기 · 장바구니 · ▾)만 여기서 그립니다.
     · 게시판 · 검색어 · 쪽 번호는 주소가 정합니다(#/community?board=QNA&q=…&page=2) — 새로 열어도 같은 화면입니다.
     · 작성자는 「김OO」처럼 첫 글자만 — 서버(G-146)와 같은 표기입니다.
     · 그림과 다르게 넣은 것: 표 머리 「작성자」(그림은 「작성일」이 두 번) · 「이건 어때? 투표」 탭(D021) · 사업자 정보 · 통신판매중개자 고지 ·
       지금 화면 표시는 「소개광장」에(그림은 「소개몰」) · 로그인한 사람의 칸(나의공간 · 알림 · 로그아웃 · 관리자 페이지).
     ★ 견본입니다 — 글 72건은 지어낸 예시이고 저장하지 않습니다. 1쪽의 10줄은 그림의 내용 그대로입니다. */
  var PLZ_BOARD = { REVIEW:"소개 후기", TRADE:"업종 이야기", QNA:"질문", NOTICE:"공지" };
  var PLZ_TABS = [["","전체"],["REVIEW","소개 후기"],["TRADE","업종 이야기"],["QNA","질문"],["NOTICE","공지"]];
  var PLZ_SIZE = 10, PLZ_ALL = null;
  var PLZ_LANGCODE = { "ko":"KR", "en-US":"US", "ja":"JP", "en-SG":"SG", "en-GB":"UK", "de":"DE", "fr":"FR", "hi":"IN", "id":"ID", "vi":"VN", "ar":"AE", "en-AU":"AU" };
  function plzPosts(){
    if (PLZ_ALL) return PLZ_ALL;
    /* 그림의 1쪽 — 줄 순서 · 제목 · 분류 · 작성자 · 작성일 · 조회 그대로 */
    var a = [
      [1,"식자재 공급처 소개하고 540만원 받은 이야기","REVIEW","김OO","2026.09.15",1204,2],
      [2,"무인 카페 권리금 시세가 궁금해요","QNA","이OO","2026.09.15",842,0],
      [3,"좋은 세무사 소개 부탁드립니다","QNA","박OO","2026.09.14",621,0],
      [4,"부산에서 믿을 수 있는 업체 추천해요","TRADE","최OO","2026.09.14",509,0],
      [5,"실제로 연결까지 된 병원 사례 공유합니다","REVIEW","정OO","2026.09.13",1087,0],
      [6,"요즘 프랜차이즈 창업 어떤가요 ?","TRADE","한OO","2026.09.13",432,0],
      [7,"카페 장비 납품 가능한 업체 있을까요 ?","QNA","송OO","2026.09.13",389,0],
      [8,"소개로 만난 파트너와 1년 째 거래 중입니다.","REVIEW","윤OO","2026.09.13",954,0],
      [9,"소상공인 정책자금 경험 있으신 분 ?","QNA","임OO","2026.09.13",276,0],
      [10,"지역별 배달 업체 비교 정리해봤어요","TRADE","조OO","2026.09.13",318,0]
    ].map(function(r){ return { no:r[0], t:r[1], b:r[2], w:r[3], d:r[4], v:r[5], r:r[6] }; });
    var NAMES = ["강","권","남","노","류","문","배","서","신","안","양","오","유","장","전","차","허","홍","황","구"];
    var SRC = { TRADE:__PLZ_TRADE__, QNA:__PLZ_QNA__, REVIEW:__PLZ_REVIEW__, NOTICE:__PLZ_NOTICE__ };
    var order = [], i, k, ix = { TRADE:0, QNA:0, REVIEW:0, NOTICE:0 }, seq = ["QNA","TRADE","REVIEW","QNA","TRADE","QNA","TRADE","REVIEW","QNA","TRADE","NOTICE"];
    var want = SRC.TRADE.length + SRC.QNA.length + SRC.REVIEW.length + SRC.NOTICE.length;
    for (i = 0; order.length < want && i < 5000; i++) { k = seq[i % seq.length]; if (ix[k] < SRC[k].length) order.push([k, SRC[k][ix[k]++]]); }
    var p2 = function(n){ return (n < 10 ? "0" : "") + n; };
    for (i = 0; i < order.length; i++) {
      var day = new Date(Date.UTC(2026, 8, 12)); day.setUTCDate(day.getUTCDate() - Math.floor(i * 0.7));       /* 2026.09.12 부터 거슬러 올라갑니다 */
      a.push({ no: 11 + i, t: order[i][1], b: order[i][0], w: order[i][0] === "NOTICE" ? "운영자" : NAMES[i % NAMES.length] + "OO",
               d: day.getUTCFullYear() + "." + p2(day.getUTCMonth() + 1) + "." + p2(day.getUTCDate()),
               v: order[i][0] === "NOTICE" ? 2410 - i * 9 : 120 + ((i * 137) % 760), r: (i * 7) % 5 === 0 ? (i % 9) + 1 : 0 });
    }
    PLZ_ALL = a; return a;
  }
  function plzHref(o){
    var q = [];
    if (o.board) q.push("board=" + encodeURIComponent(o.board));
    if (o.q) q.push("q=" + encodeURIComponent(o.q));
    if (o.page && o.page > 1) q.push("page=" + o.page);
    return "#/community" + (q.length ? "?" + q.join("&") : "");
  }
  function plzFind(){
    var board = PLZ_BOARD[S.plzBoard] ? S.plzBoard : "", q = String(S.plzQ || "").trim().replace(/\s+/g, " ").slice(0, 50);
    var words = q.toLowerCase().split(" ").filter(function(w){ return w.length >= 2; });       /* 서버(fn_search_match)와 같게 — 두 글자 이상인 낱말이 모두 들어 있는 글 */
    var rows = plzPosts().filter(function(p){
      if (board && p.b !== board) return false;
      var t = p.t.toLowerCase();
      return words.every(function(w){ return t.indexOf(w) >= 0; });
    });
    var pages = Math.ceil(rows.length / PLZ_SIZE), page = Math.max(1, parseInt(S.plzPage, 10) || 1);
    return { board: board, q: q, total: rows.length, pages: pages, page: page, items: rows.slice((page - 1) * PLZ_SIZE, page * PLZ_SIZE) };
  }
  function plzIc(n, size, w){
    var P = { search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>', chev:'<path d="m6 9 6 6 6-6"/>',
              cart:'<path d="M3 4h2.5l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 7H6.6"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>' };
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+w+'" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+P[n]+'</svg>';
  }
  function plzPic(n, w0, h0, h, alt){
    return '<img src="'+PLZ_ART[n]+'" width="'+Math.round(w0 * h / h0)+'" height="'+h+'" alt="'+esc(alt || "")+'"'+(alt ? '' : ' aria-hidden="true"')+'>';
  }
  /* 두 관 전용 머리줄 — cur: "cmu"(소개광장) · "hlt"(소개뱅크몰 · v10.24) */
  function b2Header(cur){
    var inn = AUTH.isLoggedIn(), nm = (AUTH.user && AUTH.user() && AUTH.user().name) || "소개하니";
    var lc = (S && S.lang) || "ko", n = 0;
    try { n = (window.__hltCartCount && window.__hltCartCount()) || 0; } catch (_) {}
    return '<header class="b2-hd"><div class="b2-in">'+
      '<a class="b2-logo" href="'+AUTH.homeHref()+'" aria-label="소개뱅크 메인으로">'+plzPic("logo",866,210,52,"소개뱅크")+'</a>'+
      '<nav class="b2-nav" aria-label="주 메뉴">'+liveGwan().map(function(g){
        var on = cur === "hlt" && g.code === "HLT";
        return '<a href="'+esc(g.code === "HLT" ? "#/health" : AUTH.gwanHref(g.code))+'"'+(on ? ' aria-current="page"' : '')+'>'+esc(g.name)+'</a>'; }).join("")+
        '<a href="#/community"'+(cur === "cmu" ? ' aria-current="page"' : '')+'>소개광장</a><a href="#" data-go="guide">이용안내</a></nav>'+
      '<div class="b2-hdr">'+
        '<button type="button" class="b2-find" data-go="src" aria-label="검색">'+plzIc("search",22,1.8)+'</button>'+
        '<div class="lang"><button type="button" class="b2-lngb" data-lang-toggle aria-haspopup="listbox" aria-expanded="'+(S.langOpen ? "true" : "false")+'" aria-label="언어 선택">'+
          esc(PLZ_LANGCODE[lc] || "KR")+' '+plzIc("chev",20,2)+'</button>'+
          (S.langOpen ? '<ul class="lgm" role="listbox">'+LANGS.map(function(x){
            return '<li><button role="option" aria-selected="'+(x.code === lc ? "true" : "false")+'"'+(x.code === lc ? ' class="on"' : '')+' data-lang="'+x.code+'">'+
              '<span class="lgf">'+x.flag+'</span><span class="lgt">'+esc(x.label)+'</span><span class="lgn">'+esc(x.country)+'</span></button></li>'; }).join("")+'</ul>' : '')+'</div>'+
        (inn
          ? '<span class="b2-user">👤 '+esc(nm)+'</span>'+
            '<button type="button" class="b2-login" data-go="my">나의공간</button>'+bell()+
            '<button type="button" class="b2-login" data-auth="out">로그아웃</button>'+
            /* 운영 진입점 — 공통 머리줄과 같습니다. ⚠ 서버를 붙일 때 운영자 권한으로 가려야 합니다. */
            '<button type="button" class="b2-adm" data-go="adm">관리자 페이지</button>'
          : '<button type="button" class="b2-login" data-auth="in">로그인</button>'+
            '<button type="button" class="b2-join" data-go="join">'+esc(CFG.promo.on ? CFG.promo.label : CFG.promo.alt)+'</button>')+
        /* 장바구니 — 소개뱅크몰은 겹쳐 뜨는 화면(#/health)이라 밖에서는 「열고 나서 갈 곳」을 맡겨 두고 엽니다(메인 LIVE 의 상품과 같은 방식) */
        '<a class="b2-cart" href="#/health" data-hltgo="#/cart" aria-label="소개뱅크몰 장바구니">'+plzIc("cart",30,1.5)+'<span class="b2-cartn">'+n+'</span></a>'+
      '</div></div></header>';
  }
  function b2Footer(){
    var t = CFG.site, inn = AUTH.isLoggedIn();
    var Q = [["소개받기","reql"],["제휴 파트너센터","p2dsh",1],["안심소개 파트너센터","ptn"],["나의공간","my"],["고객센터","cs"]]
      .filter(function(q){ return !q[2] || inn; });
    var SNS = [["페이스북","sns-1","facebook",120],["인스타그램","sns-2","instagram",120],["유튜브","sns-3","youtube",121]];
    var PXS = window.__PX || null;
    return '<footer class="b2-ft"><div class="b2-in"><div class="b2-ftr">'+
      '<a class="b2-logo" href="'+AUTH.homeHref()+'" aria-label="소개뱅크 메인으로">'+plzPic("logo-ft",802,200,50,"소개뱅크 — 소개하면 돈이 된다")+'</a>'+
      '<div class="b2-ftl"><a href="#" data-go="guide">서비스 소개</a>'+t.links.map(function(l){
        var d = FTLINK[l];
        return (d && d.go) ? '<a href="#" data-go="'+d.go+'"'+(d.tip ? ' title="'+esc(d.tip)+'"' : '')+'>'+esc(l)+'</a>'
                           : '<a href="#" data-t="'+esc(l)+' — '+esc(FTNOTE)+'">'+esc(l)+'</a>'; }).join("")+'</div>'+
      '<div class="b2-ftend"><div class="b2-sns">'+SNS.map(function(x){
        var u = PXS ? PXS.state.sns[x[2]] : "";
        return (PXS && PXS.snsOk(u))
          ? '<a class="on" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer" aria-label="'+x[0]+' (새 창)" data-sns="'+x[2]+'">'+plzPic(x[1],x[3],120,30)+'</a>'
          : '<button type="button" data-t="'+x[0]+' 계정은 준비 중입니다." aria-label="'+x[0]+' — 준비 중" data-sns="'+x[2]+'">'+plzPic(x[1],x[3],120,30)+'</button>'; }).join("")+'</div>'+
      '<span class="b2-copy">'+new Date().getFullYear()+' 소개뱅크. All rights reserved.</span></div></div>'+
      '<nav class="b2-quick" aria-label="바로가기">'+Q.map(function(q){ return '<a href="#" data-go="'+q[1]+'">'+q[0]+'</a>'; }).join("")+'</nav>'+
      '<div class="b2-legal"><p><b>'+esc(t.corp)+'</b> · 대표 '+fv(t.ceo)+' · 사업자등록번호 '+fv(t.biz)+' · 통신판매업 신고번호 '+fv(t.mail)+'<br>'+
        '직업정보제공사업 신고번호 '+fv(t.job)+' · 주소 '+fv(t.addr)+' · 전화 '+fv(t.tel)+' · 개인정보보호책임자 '+fv(t.privacy)+' · 호스팅 '+fv(t.host)+'</p>'+
        '<p class="b2-notice"><b>소개뱅크는 통신판매중개자이며 거래의 당사자가 아닙니다.</b> 상품 · 서비스 · 사업기회에 대한 정보와 거래에 관한 책임은 등록자에게 있습니다.</p>'+
      '</div></div></footer>';
  }
  /* 띠 사진 — 임시: 받은 그림은 제목 · 검색 칸이 사진 위에 박혀 있어 글자가 없는 오른쪽 부분만 넣었습니다. 글자 없는 원본을 받으면 이 한 줄만 바꿉니다. */
  function plzPhoto(){ return '<img class="plz-photo" src="'+PLZ_ART["plaza-photo-right"]+'" width="1600" height="1212" alt="" aria-hidden="true">'; }
  function plzHero(small, f){
    if (small) return '<section class="plz-hero sm" aria-label="소개광장">'+plzPhoto()+'<div class="plz-in">'+
      '<p class="plz-h"><a href="#/community">소개광장</a></p><p class="plz-lead">소개 후기와 업종 이야기가 모이는 자리입니다.</p></div></section>';
    return '<section class="plz-hero">'+plzPhoto()+'<div class="plz-in"><h1>소개광장</h1>'+
      '<p class="plz-lead">소개 후기와 업종 이야기가 모이는 자리입니다.</p>'+
      '<form class="plz-find" data-plz="find" role="search">'+
        '<input name="q" value="'+esc(f.q)+'" maxlength="50" placeholder="게시글을 검색해보세요." aria-label="게시글 검색" autocomplete="off">'+
        '<button type="submit" aria-label="검색">'+plzIc("search",22,2)+'</button></form>'+
      '<div class="plz-say"><img class="plz-mega" src="'+PLZ_ART.megaphone+'" width="415" height="370" alt="" aria-hidden="true">'+
        '<div class="plz-note"><b>누구나 쓰실 수 있습니다.</b><span>다만, 첫 글은 확인 후 올라갑니다 - 보통 하루 안에 끝납니다.</span>'+
        '<span>소개 후기는 성사된 거래가 있어야 쓰실 수 있습니다.</span></div></div>'+
    '</div></section>';
  }
  /* 알약 탭 — cur: 게시판 코드("" = 전체) · "polls" · 그 밖(고른 것 없음) */
  function plzTabs(cur, q){
    return '<nav class="plz-tabs" aria-label="게시판">'+PLZ_TABS.map(function(t){
      return '<a href="'+plzHref({ board:t[0], q:q })+'"'+(cur === t[0] ? ' aria-current="page"' : '')+'>'+t[1]+'</a>'; }).join("")+
      '<a href="#/community/polls"'+(cur === "polls" ? ' aria-current="page"' : '')+' data-polls-tab>이건 어때? 투표</a></nav>';
  }
  function plzBadge(b){ return '<span class="plz-bd plz-bd-'+String(b || "etc").toLowerCase()+'">'+esc(PLZ_BOARD[b] || b)+'</span>'; }
  function plzPager(f){
    if (f.pages < 1) return '';
    var nums = [], i, start;
    if (f.pages <= 7) { for (i = 1; i <= f.pages; i++) nums.push(i); }
    else {
      start = Math.max(1, Math.min(f.page - 2, f.pages - 4));
      if (start > 1) { nums.push(1); if (start > 2) nums.push("gap"); }
      for (i = start; i <= start + 4; i++) nums.push(i);
      if (start + 4 < f.pages) { if (start + 4 < f.pages - 1) nums.push("gap"); nums.push(f.pages); }
    }
    var href = function(p){ return plzHref({ board:f.board, q:f.q, page:p }); };
    var arrow = function(to, label, ch){
      return (to >= 1 && to <= f.pages && to !== f.page) ? '<a href="'+href(to)+'" aria-label="'+label+'">'+ch+'</a>' : '<span aria-label="'+label+'" aria-disabled="true">'+ch+'</span>'; };
    return '<nav class="plz-pager" aria-label="쪽 번호">'+arrow(f.page - 1, "이전 쪽", "‹")+nums.map(function(n){
      return n === "gap" ? '<span class="gap" aria-hidden="true">…</span>' : n === f.page ? '<span aria-current="page">'+n+'</span>' : '<a href="'+href(n)+'">'+n+'</a>'; }).join("")+
      arrow(f.page + 1, "다음 쪽", "›")+'</nav>';
  }
  function plzOpen(cur, small, f){ return '<div class="plz">'+b2Header("cmu")+plzHero(small, f)+'<div class="plz-body">'+(cur === null ? '' : plzTabs(cur, f ? f.q : "")); }
  function plzClose(sid){ return '<p class="plz-sid">'+sid+'</p></div>'+b2Footer()+'</div>'; }
  /* SB-HOM-CMU-010 — 목록 */
  function plzList(){
    var f = plzFind();
    return plzOpen(f.board, false, f)+
      (f.q ? '<p class="plz-found" role="status"><b>「'+esc(f.q)+'」</b> 검색 결과 '+f.total.toLocaleString("ko-KR")+'건 <a href="'+plzHref({ board:f.board })+'">검색 지우기</a></p>' : '')+
      (f.items.length
        ? '<div class="plz-tblw"><table class="plz-tbl"><thead><tr><th scope="col">제목</th><th scope="col">분류</th><th scope="col">작성자</th><th scope="col">작성일</th><th scope="col">조회</th></tr></thead><tbody>'+
          f.items.map(function(p){
            return '<tr><td><a href="#/community/'+p.no+'">'+esc(p.t)+'</a>'+(p.r > 0 ? '<span class="plz-cc" aria-label="댓글 '+p.r+'개">['+p.r+']</span>' : '')+'</td>'+
              '<td>'+plzBadge(p.b)+'</td><td>'+esc(p.w)+'</td><td>'+p.d+'</td><td>'+p.v.toLocaleString("ko-KR")+'</td></tr>'; }).join("")+
          '</tbody></table></div>'
        : '<p class="plz-empty">'+(f.total > 0
            ? f.page+'쪽에는 글이 없습니다. <a href="'+plzHref({ board:f.board, q:f.q })+'">1쪽으로</a>'
            : f.q ? '찾으시는 글이 없습니다. 낱말을 줄이거나 <a href="'+plzHref({ board:f.board })+'">검색을 지워</a> 보십시오.'
                  : (f.board ? PLZ_BOARD[f.board]+' 게시판에 아직 글이 없습니다.' : '아직 올라온 글이 없습니다.')+' 첫 글을 남겨 보십시오.')+'</p>')+
      '<div class="plz-foot">'+(f.items.length ? plzPager(f) : '')+'<a class="plz-write" href="#/community/write">글쓰기</a></div>'+
      plzClose("SB-HOM-CMU-010 · 견본 글 "+plzPosts().length+"건(지어낸 예시 · 저장하지 않음) · 검색은 제목에서 찾습니다(실제 웹은 제목 · 본문)");
  }
  /* SB-HOM-CMU-020 — 글 상세(#/community/{번호} — 누른 글) */
  function plzDetail(){
    var no = String(S.postId == null ? "1" : S.postId), p = null, all = plzPosts(), i;
    if (/^\d+$/.test(no)) for (i = 0; i < all.length; i++) if (all[i].no === parseInt(no, 10)) p = all[i];
    var back = '<p class="plz-backw"><a class="plz-back" href="#/community">← 목록으로</a></p>';
    if (!p) return plzOpen("none", true)+'<div class="plz-narrow"><h1>소개광장</h1><p class="plz-empty">없는 글입니다. 지워졌거나 주소가 잘못되었습니다.</p>'+back+'</div>'+plzClose("SB-HOM-CMU-020");
    var first = p.no === 1;
    return plzOpen(p.b, true)+'<div class="plz-narrow">'+
      '<article class="plz-post"><header>'+plzBadge(p.b)+'<h1>'+esc(p.t)+'</h1>'+
        '<p class="plz-meta"><span>'+esc(p.w)+'</span><span>'+p.d+'</span><span>조회 '+p.v.toLocaleString("ko-KR")+'</span></p></header>'+
        (first
          ? '<p class="doc-body">작년에 알던 사장님이 식자재 공급처를 찾는다고 하셔서 거래처를 이어 드렸습니다. 두 곳이 계약을 맺으면서 소개비를 받았습니다.<br><br>'+
            '소개비는 <b>당사자끼리 직접</b> 주고받았습니다. 소개뱅크는 한 푼도 떼지 않았습니다.</p>'
          : '<p class="doc-body">「'+esc(p.t)+'」 글의 본문 자리입니다.</p>'+
            '<p class="ls">소개광장에 담을 내용이 정해지면 작성자가 쓴 본문이 여기에 나옵니다 (N-07).</p>')+
      '</article>'+
      (p.b === "REVIEW" ? '<div class="nt info"><b>성사된 거래가 확인된 후기입니다.</b> 거래 기록이 없으면 후기를 쓰실 수 없습니다 — 거래도 안 한 사람의 후기가 가장 나쁜 광고이기 때문입니다.</div>' : '')+
      '<h2>댓글 '+p.r+'</h2><div class="card pad">'+
        (first
          ? '<div class="plz-cmt"><b>박OO</b><span class="dim">2026.09.15</span><p>소개비 세금계산서는 누가 끊나요?</p></div>'+
            '<div class="plz-cmt re"><b>'+esc(p.w)+'</b><span class="dim">2026.09.16</span><p>사업소득이면 소개자가 직접 발행합니다.</p></div>'
          : p.r > 0 ? '<p class="ls">댓글 '+p.r+'개 — 견본에는 첫 글의 댓글만 넣어 두었습니다.</p>' : '<p class="ls">아직 댓글이 없습니다.</p>')+
      '</div>'+
      '<p class="ls" style="margin:10px 0">대댓글은 1단계까지입니다. 더 깊으면 화면에서 읽기 어렵습니다.</p>'+
      '<div class="card pad"><textarea class="inp" rows="3" maxlength="2000" placeholder="댓글을 쓰십시오" aria-label="댓글"></textarea>'+
        '<div class="hbtn"><button type="button" class="bp" data-plz="cmt">댓글 달기</button>'+
        '<button type="button" class="bs" data-t="신고가 접수되었습니다. 운영자가 확인합니다.">신고</button></div></div>'+
      back+'</div>'+plzClose("SB-HOM-CMU-020 · 시연 — 댓글은 저장하지 않습니다");
  }
  /* SB-HOM-CMU-030 — 글쓰기 */
  function plzWrite(){
    var o = S.plzOpt || "질문";
    return plzOpen(null, true)+'<div class="plz-narrow"><h1>글쓰기</h1>'+
      '<p class="lead" style="margin:0 0 16px;color:#333">제목과 내용을 쓰시면 <b>어느 게시판인지 알아서 고릅니다.</b></p>'+
      '<div class="card pad">'+
        '<label class="fld"><span>제목</span><input class="inp" id="cmuT" type="text" maxlength="100" placeholder="예: 소개비 세금계산서는 누가 끊나요"></label>'+
        '<label class="fld"><span>내용</span><textarea class="inp" id="cmuB" rows="7" maxlength="10000" placeholder="열 자 이상 쓰십시오."></textarea></label>'+
      '</div>'+
      /* ★ 읽은 내용을 보여 줍니다. "AI 가 분석했습니다" 라고 쓰지 않습니다 — 규칙 엔진이라 거짓말이 됩니다. */
      '<div class="card pad" id="cmuGuess" style="margin-top:14px">'+
        '<div class="sgqh"><span class="si2">✨</span><span class="st3">게시판</span></div>'+
        '<div class="dim" style="margin-top:6px;font-size:13px">내용을 보고 고릅니다. 맞지 않으면 직접 고르십시오.</div>'+
        '<div class="opts" style="margin-top:8px">'+["소개 후기","업종 이야기","질문"].map(function(t){
          return '<button type="button" class="opt'+(t === o ? " on" : "")+'" data-plz="opt" data-v="'+t+'" aria-pressed="'+(t === o)+'">'+t+'</button>'; }).join("")+'</div>'+
      '</div>'+
      '<div class="nt warn" style="margin-top:14px"><b>첫 글은 확인 후 올라갑니다.</b> 보통 하루 안에 끝나고, 두 번째부터는 바로 올라갑니다.<br>'+
        '가입 7일이 안 되셨으면 <b>링크를 넣으실 수 없습니다.</b> 하루에 5개까지 쓰실 수 있습니다.</div>'+
      '<div class="nt info"><b>소개 후기</b>는 성사된 거래를 고르셔야 쓸 수 있습니다.</div>'+
      '<div class="hbtn"><button type="button" class="bp plz-post-btn" data-plz="post">올리기</button>'+
        '<a class="bs" href="#/community" style="display:inline-flex;align-items:center">취소</a></div>'+
    '</div>'+plzClose("SB-HOM-CMU-030 · 시연 — 글은 저장하지 않습니다");
  }
  window.__PLZ_ART = PLZ_ART;      /* 검증용 창구 — 넣은 그림이 받은 PNG 와 바이트가 같은지 밖에서 봅니다(qa/proto_cmu.py P-1) */
  var PLZ = { header:b2Header, footer:b2Footer, list:plzList, detail:plzDetail, write:plzWrite,
              open:function(cur){ return plzOpen(cur, true)+'<div class="plz-wide">'; }, close:function(sid){ return '</div>'+plzClose(sid); } };
  document.addEventListener("submit", function(ev){
    var f = ev.target && ev.target.closest && ev.target.closest('form[data-plz="find"]');
    if (!f) return;
    ev.preventDefault();
    var q = String((f.querySelector('input[name="q"]') || {}).value || "").trim().replace(/\s+/g, " ").slice(0, 50);
    var to = plzHref({ board: PLZ_BOARD[S.plzBoard] ? S.plzBoard : "", q: q });
    if (!q && !S.plzQ) { toast("찾을 낱말을 넣어 주십시오."); return; }
    if (location.hash === to) { toast("「"+q+"」 검색 결과입니다."); return; }
    location.hash = to;
  });
  document.addEventListener("click", function(ev){
    var hg = ev.target && ev.target.closest && ev.target.closest("[data-hltgo]");
    if (hg) { window.__hltPending = hg.getAttribute("data-hltgo"); return; }       /* 주소(#/health)는 링크가 바꿉니다 — 열리면서 맡겨 둔 곳으로 갑니다 */
    var el = ev.target && ev.target.closest && ev.target.closest("[data-plz]");
    if (!el || el.tagName === "FORM") return;
    var k = el.getAttribute("data-plz");
    if (k === "opt") { S.plzOpt = el.getAttribute("data-v");
      var keepT = (document.getElementById("cmuT") || {}).value, keepB = (document.getElementById("cmuB") || {}).value; render();
      if (document.getElementById("cmuT")) { document.getElementById("cmuT").value = keepT || ""; document.getElementById("cmuB").value = keepB || ""; }
      return; }
    if (k === "cmt") {
      var ta = el.closest(".card").querySelector("textarea"), v = String(ta ? ta.value : "").trim();
      if (v.length < 2) { toast("댓글을 두 글자 이상 쓰십시오."); return; }
      ta.value = ""; toast("댓글을 달았습니다 — 시연이라 저장하지 않습니다."); return; }
    if (k === "post") {
      var t = String((document.getElementById("cmuT") || {}).value || "").trim(), b = String((document.getElementById("cmuB") || {}).value || "").trim();
      if (t.length < 2) { toast("제목을 두 글자 이상 쓰십시오."); return; }
      if (b.length < 10) { toast("내용을 열 자 이상 쓰십시오."); return; }
      toast("글을 올렸습니다. 첫 글이라 확인 후 다른 분들께 보입니다 — 시연이라 저장하지 않습니다.");
      location.hash = "#/community"; return; }
  });

'''
JS = JS.replace('__PLZ_TRADE__', json.dumps(TRADE, ensure_ascii=False)).replace('__PLZ_QNA__', json.dumps(QNA, ensure_ascii=False)) \
       .replace('__PLZ_REVIEW__', json.dumps(REVIEW, ensure_ascii=False)).replace('__PLZ_NOTICE__', json.dumps(NOTICE, ensure_ascii=False))
ANCH = '  /* 메인 한 장 — 헤더부터 푸터까지. 시연용 진입 바(demoBar)는 본문 끝에 그대로 둡니다 */'
rep(ANCH, JS.lstrip('\n') + ANCH)

# UI 에 내어 줍니다 — 다른 화면 묶음(M_render2 · M_poll)이 U.plz 로 씁니다
m = re.search(r'\nconst UI = \{\n', s); assert m
s = s[:m.end()] + '  /* v10.23 — 소개광장(제시 디자인) · 두 관 전용 머리줄 · 바닥줄 */\n  plz: PLZ,\n' + s[m.end():]

# 그리기 — 주소에 값이 없으면 처음(전체 · 1쪽)
rep("""  if (key === "listb") { if (!params || !("axBIZ" in params)) S.axBIZ = null; if (!params || !("axurg" in params)) S.axurg = false; }
""", """  if (key === "listb") { if (!params || !("axBIZ" in params)) S.axBIZ = null; if (!params || !("axurg" in params)) S.axurg = false; }
  /* v10.23 — 소개광장 목록의 게시판 · 검색어 · 쪽 번호는 주소가 정합니다. 주소에 없으면 처음(전체 · 1쪽)입니다 — 앞에서 본 것이 남으면 안 됩니다. */
  if (key === "cmu" || key === "commu") { if (!params || !("plzPage" in params)) { S.plzBoard = ""; S.plzQ = ""; S.plzPage = 1; } }
""")

# ══ 화면 묶음 ②(M_render2) — 소개광장 화면 넷은 U.plz 가 그립니다 ══
a = s.index('/* 소개광장 (SB-HOM-ETC-020) */\nfunction scCommunity(){'); b = s.index('/* 이벤트존 — 퀵메뉴 ⑤ (NAV-8) */', a)
s = s[:a] + '''/* 소개광장 (SB-HOM-ETC-020) — v10.23: 제시 디자인의 목록 하나로 합쳤습니다(전에는 머리줄 메뉴가 여는 이 화면과 주소 #/community 가 여는 scCmu 가 따로였습니다). */
function scCommunity(){ return U.plz.list(); }
''' + s[b:]
a = s.index('/* ── SB-HOM-CMU-010 · 소개광장 목록 ─────────────────────────── */\nfunction scCmu(){'); b = s.index('/* ── SB-ADM-CMU-010 · 소개광장 검수 큐', a)
s = s[:a] + '''/* ── SB-HOM-CMU-010 · 020 · 030 — 소개광장 목록 · 글 상세 · 글쓰기 ─────────────
   v10.23 (2026-10-07) — 제시 디자인대로 다시 그렸습니다. 그리는 곳은 화면 묶음 ①의 plzList · plzDetail · plzWrite 입니다
   (두 관 전용 머리줄 · 바닥줄이 관 목록 · 로그인 상태 · 사이트 정보를 그 안에서 읽기 때문입니다). */
function scCmu(){ return U.plz.list(); }
function scCmuD(){ return U.plz.detail(); }
function scCmuW(){ return U.plz.write(); }

''' + s[b:]

# ══ 투표(M_poll) — 같은 머리줄 · 낮은 띠 · 알약 탭 ══
rep("""  return H({}) + '<div class="wrap aiw">' + B("이전 화면") +
    page("이건 어때?", "여러분의 의견을 알려 주세요. 실제 사용자들의 생각이 더 나은 선택을 만듭니다. <b>SB-HOM-CMU-040</b>",
      '<button class="bo" data-go="cmu">소개광장으로</button>') +""",
    """  /* v10.23 — 소개광장의 한 갈래입니다: 같은 머리줄 · 낮은 사진 띠 · 알약 탭(「이건 어때? 투표」가 고른 탭). 투표 카드 · 규칙은 그대로입니다. */
  return U.plz.open("polls") +
    page("이건 어때?", "여러분의 의견을 알려 주세요. 실제 사용자들의 생각이 더 나은 선택을 만듭니다.",
      '<a class="bo" href="#/community">소개광장으로</a>') +""")
rep("""      "넣은 표는 바꿀 수 없고, 결과는 투표한 뒤에 보입니다. 참여 수는 <b>실제로 투표한 수</b>입니다.") +
    cmuTabs("cmupoll") +
""", """      "넣은 표는 바꿀 수 없고, 결과는 투표한 뒤에 보입니다. 참여 수는 <b>실제로 투표한 수</b>입니다.") +
""")
rep("""      "<span class=\\"code\\">POST /community/polls/{id}/vote</span> · 같은 사람의 두 번째 표는 DB 가 막습니다(409).") +
    '</div>' + F();
}

/* ── SB-ADM-CMU-020 · 투표 관리""", """      "<span class=\\"code\\">POST /community/polls/{id}/vote</span> · 같은 사람의 두 번째 표는 DB 가 막습니다(409).") +
    U.plz.close("SB-HOM-CMU-040");
}

/* ── SB-ADM-CMU-020 · 투표 관리""")

# ══ 주소 — 게시판 · 검색어 · 쪽 번호 ══
rep("""  { re:/^\\/community\\/?$/,        screen:"cmu",     title:"소개광장",
    desc:"소개 후기와 업종 이야기." },""",
    """  /* v10.23 — #/community?board=QNA&q=권리금&page=2 — 게시판 · 검색어 · 쪽 번호를 주소에서 읽습니다(없으면 전체 · 1쪽). */
  { re:/^\\/community\\/?(?:\\?(.*))?$/, screen:"cmu", title:"소개광장",
    params:m => { const q = new URLSearchParams(m[1] || ""); const pg = parseInt(q.get("page"), 10);
      return { plzBoard: q.get("board") || "", plzQ: (q.get("q") || "").trim().replace(/\\s+/g, " ").slice(0, 50), plzPage: pg >= 1 ? pg : 1 }; },
    desc:"소개 후기와 업종 이야기." },""")

# ══ ⑤ 판 이름 ══
m = re.search(r'<title>소개뱅크 시안 v10\.22 \(2026-10-07 · ', s); assert m
s = s.replace(m.group(0), '<title>소개뱅크 시안 v10.23 (2026-10-07 · 소개광장 제시 디자인 적용(남색 + 주황 · 사진 띠 · 게시글 검색 · 쪽 번호 · 작성자 가림) · 두 관 전용 머리줄 · ', 1)
s = s.replace('SGB_Prototype_v10_22.html', 'SGB_Prototype_v10_23.html')

open(P, 'w', encoding='utf-8').write(s)
print(f'proto {n0:,} → {len(s):,} bytes · 그림 {len(art)}개 · 견본 글 {10 + 62}건')
