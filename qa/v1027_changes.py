"""v10.27 시안에서 앞 판(v10.26)과 달라진 화면 — 옛 판과 견주는 시험들이 함께 씁니다(proto_diff · proto_pixel · proto_urg · proto_detail …).
   CHANGED: 나의공간 왼쪽 메뉴 · 운영 대시보드 · 이용안내 · 가입 · 로그인 · 소개 내역 · 내 리스팅 · 구독(26장)
            + G-116(10/8 답 「세 화면에도 단추 삭제」) 베스트매칭 · 사고예방 · 성공현황(3장)
            + G-130(10/8 답 「22건 모두 만듬」) 「상세 · 보기」 단추가 화면을 여는 쪽: 감사 · 파트너사 목록 · 성향 학습 · 정책 상세(4장)
              (사고예방 · 계약서 · 체결은 위에 이미 있음 · 파트너 알림의 「보기」는 알림 탭 안이라 첫 화면은 같음)
            + bedu — 내용은 같고 「← (앞 화면)으로 돌아가기」의 앞 화면 이름만 다름(화면을 키 순서로 차례로 그려서, 바로 앞에 새 화면 adland 가 낌)
   NEW:     약관 전문(termsv) + G-130 새 화면 7장(safgd · bpolsrc · adland · admptnd · admaudl · admsegp · ctrform)
   G-137(견본 그림 14장)은 그림만 바뀌어 글자 비교(proto_diff)에는 안 드러나고, 그림 비교(proto_pixel)는 G137_PIX 로 따로 셉니다."""
G116 = {'bst', 'saf', 'win'}
G130 = {'admaud', 'admptn', 'admseg', 'bpol'}
G130_NEW = ['safgd', 'bpolsrc', 'adland', 'admptnd', 'admaudl', 'admsegp', 'ctrform']
CHANGED = {'adm', 'ctrd', 'ctrw', 'guide', 'introact', 'introhome', 'introinv', 'join', 'login', 'my', 'myacc', 'mybiz2', 'myctr', 'myctrd', 'mydeal', 'myevt',
           'mylik', 'mylst', 'myntf', 'mypay', 'mypaym', 'myrpt', 'mystl', 'mysub', 'mysubup', 'report'} | G116 | G130 | {'bedu'}
NEW = ['termsv'] + G130_NEW
# 그림 비교(proto_pixel) — G-137 견본 그림이 보이는 화면(카드 · 상세)은 점이 달라지고,
#   G-130 의 단추 속성만 바뀐 화면(글자 · 모양 같음)과 bedu(앞 화면 이름 — 그림 비교는 화면마다 새로 열어 같음)는 점이 같음
G137_PIX = {'admgux', 'dtll', 'dtlm', 'list', 'listb', 'listl', 'lstb2', 'lstl2', 'lstm', 'reqdm', 'urg'}
PIX_SAME = {'admaud', 'admptn', 'admseg', 'bedu'}
PIX_CHANGED = (CHANGED - PIX_SAME) | G137_PIX
# v10.28 — 옛 판(v10.13 ~ v10.19)과 견주는 시험(proto_urg · proto_detail · proto_poll · proto_bill)은 그 뒤 판에서 달라진 것을 모두 더해 봅니다.
#   앞 판 하나와 견주는 proto_diff · proto_pixel 은 v1028_changes 를 씁니다(앞 판 = v10.27).
from v1028_changes import CHANGED as _C28, NEW as _N28
CHANGED = CHANGED | _C28
NEW = NEW + _N28
PIX_CHANGED = PIX_CHANGED | _C28
# v10.30 — 소개장터 메인(list)이 제시 디자인으로 바뀜
from v1030_changes import CHANGED as _C30, NEW as _N30
CHANGED = CHANGED | _C30
NEW = NEW + _N30
PIX_CHANGED = PIX_CHANGED | _C30
# v10.31 — 시안 기준 반영 · 시안 스스로 동작하지 않던 곳(63장 · 새 화면 5장)
from v1031_changes import CHANGED as _C31, NEW as _N31
CHANGED = CHANGED | _C31
NEW = NEW + _N31
PIX_CHANGED = PIX_CHANGED | _C31
