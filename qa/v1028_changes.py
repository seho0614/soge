"""v10.28 시안에서 앞 판(v10.27)과 달라진 화면 — 옛 판과 견주는 시험들이 함께 씁니다(proto_diff · proto_pixel · proto_urg · proto_detail · proto_poll · proto_bill).
   CHANGED: 운영 대시보드(다른 운영 화면에 소개몰 4화면) · 소개몰 정산(주문 · 리뷰 단추) · 불변식 목록(INV-10 개인 수령) · 로그인(개인 소개비 · 재동의 안내) ·
            상담 업종 상세(진행 순서에 이메일) · 정산(개인 회원 · 받을 계좌 · 세금 한 줄) · 파트너센터 상담 신청(연 연락처의 이메일) ·
            이용안내 · 약관 전문(위탁 = 「알림」 · G-218)
   NEW:     운영 「소개몰 주문」(admhor · SB-ADM-HOR-010) · 「소개몰 리뷰 · 문의」(admhrv · SB-ADM-HRV-010) · 약관 동의 · 재동의(trmagr · SB-HOM-ETC-022)
   소개몰(겹쳐 뜨는 틀)의 고친 곳(리뷰 쓰기 · 별점 거르기 · 문의 · 구매확정 · 순위 기준)은 본체 화면 목록에 들지 않고 fix_1028_proto 가 봅니다."""
CHANGED = {'adm', 'admhst', 'invreg', 'login', 'malcsld', 'mystl', 'ptnlead', 'guide', 'termsv'}      # guide · termsv — G-218 위탁 「알림」(이용안내 약관 표 · 약관 전문)
NEW = ['admhor', 'admhrv', 'trmagr']
PIX_CHANGED = set(CHANGED)
