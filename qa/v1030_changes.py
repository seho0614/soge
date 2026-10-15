"""v10.30 시안에서 앞 판(v10.28)과 달라진 화면 — 옛 판과 견주는 시험들이 함께 씁니다(proto_diff · proto_pixel · v1027_changes 를 거쳐 proto_urg · proto_detail · proto_poll · proto_bill).
   CHANGED: 소개장터 메인(list · SB-MNY-MAIN-010) 한 장 — 2026-10-09 제시 디자인(새 머리줄 · 맨 위 구역 · 바로가기 3 · 분야 14 · 분류 목록 · 업체 추천 · 소개 요청 · AI 추천 ·
            띠 광고 · 연결 사례 · 공급자 등록) + 지금 있던 인기 매물 · 바로가기 5를 디자인 구역 아래에.
   NEW:     없음(화면 수 그대로).
   두 관 전용 머리줄 · 바닥줄 함수(b2Header · b2Footer)에 「소개장터」 갈래를 더했지만, 소개광장 · 소개몰 화면이 내는 글자는 한 글자도 달라지지 않습니다(proto_diff 가 봅니다)."""
CHANGED = {'list'}
NEW = []
PIX_CHANGED = set(CHANGED)
