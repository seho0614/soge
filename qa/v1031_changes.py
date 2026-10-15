"""v10.31 시안에서 앞 판(v10.30)과 달라진 화면 — 옛 판과 견주는 시험들이 함께 씁니다(proto_diff · proto_pixel · v1027_changes 를 거쳐 proto_urg · proto_detail · proto_poll · proto_bill).
   10/10 시안 v10.31 작업(시안 스스로 동작하지 않던 곳 · 시연 안 되던 단추)의 결과를 앞 판과 화면마다 글자로 견줘 얻은 63장 — 갈래별로 시안 제목의 설명과 맞춰 봤습니다.
   NEW: 시안 키 5장(admdspt 분쟁 처리 · dspu 분쟁 접수 · qna 공개 문의 · terms 약관 · verify 본인 · 사업자 인증)."""
# 운영 화면 머리줄(공통 adm 머리줄 · 상태 꼬리표 · 대시보드) — 38장
# 제휴 하위 메뉴(aff*) — 5장
# 검색(추천 칩 · 「이렇게 찾습니다」 · Enter · 통합 결과 · #/search?q=) — 3장
# 소개광장(머리줄 돋보기 = 검색 팝업) — 5장
# 계약 진행 막대 · 나의공간 · 10/10 결정 글(개인 소개비 · 리드 이용료 선불 · 퍼블리셔 지급 닫음) — 9장
# 시안 키 · 이용안내 · 가입 · 약관 전문(로그인 · 회원가입 · 본인 · 사업자 인증 · 분쟁 · 약관 · 공개 문의) — 3장
CHANGED = {'acl', 'admInv', 'admacl', 'admadb', 'admadi', 'admais', 'admbdg', 'admbil', 'admbrkd', 'admcod', 'admcol', 'admevt', 'admhor', 'admhpr', 'admhrv', 'admhst', 'admmain1', 'admmain2', 'admmain3', 'admmain4', 'admmbr', 'admmbrd', 'admown', 'admptn', 'admptnw', 'admrev3', 'admrev4', 'admrpt', 'admsit8', 'admusr', 'adx', 'affapl', 'affgol', 'affmtr', 'affprd', 'affstl', 'aicls', 'cmu', 'cmud', 'cmupoll', 'cmuw', 'commu', 'ctrform', 'guide', 'gwansep', 'integ', 'invreg', 'join', 'my', 'mybiz2', 'mystl', 'mysub', 'payout', 'ptn', 'ptncash', 'ptnlead', 'ptnnoti', 'schres', 'src', 'srvhub', 'srvops', 'srvstk', 'termsv'}
NEW = ['admdspt', 'dspu', 'qna', 'terms', 'verify']
# 그림 비교(proto_pixel)는 글자 비교와 13장이 다릅니다(10/10 확인 — 앞 판 · 새 판 그림을 나란히 봄):
#  · 글자는 같고 모양만 바뀐 12장 — v10.31 시안이 고친 공통 모양 두 가지가 닿는 화면
#      상태 꼬리표(앞 판은 꼬리표 틀이 빠져 글자만 칸 아래로 처져 보였음 → 둥근 꼬리표): admaud · myevt · myrpt · myacc
#      계약 진행 막대(앞 판은 지난 단계가 네모 칸으로 깨져 보였음 → 한 줄 막대) · 같은 틀의 나의공간 표: ask · ctrd · myctr · myctrd · p2lnk · p2ord · p2qna · p2stl
#  · 글자 비교(innerHTML)로는 바뀌었고 그림은 같은 1장 — aicls(화면 함수 scAiCls 는 두 판이 같음 — 공통 부품의 속성 · 보이지 않는 글자만 바뀜)
PIX_STYLE_ONLY = {'admaud', 'myevt', 'myrpt', 'myacc', 'ask', 'ctrd', 'myctr', 'myctrd', 'p2lnk', 'p2ord', 'p2qna', 'p2stl'}
PIX_TEXT_ONLY = {'aicls'}
PIX_CHANGED = (set(CHANGED) - PIX_TEXT_ONLY) | PIX_STYLE_ONLY
