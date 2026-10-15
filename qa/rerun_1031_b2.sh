#!/bin/bash
# v10.31 — 2차 다시 돌림(화면 시험 · 사용자 웹을 다시 빌드하지 않아도 되는 것 · 버튼 체크와 같이 돌아도 됨 — 쓰기는 각 시험의 새 계정 · 새 자료)
cd /home/claude/qa; K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 PYTHONPATH=/home/claude/qa/tools/offline_fonts
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
O=final_all_reruns_1031.txt
r() { echo "$1: $2 — $3" >> $O; echo "$1: $2"; }
U="시험을 고친 뒤"
python3 fix_1027b.py > rr_fix_1027b.log 2>&1; r fix_1027b "$(tail -1 rr_fix_1027b.log)" "$U(D090 가입 약관 = 전체 대상만 — 파트너 이용약관 제외)"
python3 srv_detail.py > rr_srv_detail.log 2>&1; r srv_detail "$(tail -1 rr_srv_detail.log)" "결함 고친 뒤(S-2 — 새 입력 10곳 @StrictBoolean · 커밋 f649c55 · 소스 점검) · $U(D047 빈 후기 422 · 같은 거래 후기는 고쳐 씀 · 저장할 때 가림 글자)"
python3 srv_v1031.py > rr_srv_v1031.log 2>&1; r srv_v1031 "$(tail -1 rr_srv_v1031.log)" "새 시험 — 계약은 판매 쪽 합의(SENT) 뒤 확인 요청 · 사례 요약 5자 이상 · 외부 송출 확인 전 422 · 월 비용 칸은 날짜"
python3 decisions_ui.py > rr_decisions_ui.log 2>&1; r decisions_ui "$(tail -1 rr_decisions_ui.log)" "$U(w1 시안 성사 확정 화면 — 누르면 「확인 1 / 2 · 확인 완료」 · 양쪽이면 「확인 2 / 2 · 양측 확인이 끝났습니다」)"
python3 srv_ptn_ui.py > rr_srv_ptn_ui.log 2>&1; r srv_ptn_ui "$(tail -1 rr_srv_ptn_ui.log)" "$U(w2 시안 중개사 신청 — 「신청하고 대조하기」 · 예시 번호 칸 · 「새로 신청」)"
python3 srv_hlt_ui.py > rr_srv_hlt_ui.log 2>&1; r srv_hlt_ui "$(tail -1 rr_srv_hlt_ui.log)" "$U(D064 시각 순서 — 발송 뒤 배송 완료)"
python3 srv_cmu_ui.py > rr_srv_cmu_ui.log 2>&1; r srv_cmu_ui "$(tail -1 rr_srv_cmu_ui.log)" "$U(w1 — /cart-count 에 bell · ops 칸 · 메뉴 「이용안내」 = /guide)"
bash adapters_up.sh > rr_adapters2.log 2>&1
python3 srv_lead_ui.py > rr_srv_lead_ui.log 2>&1; r srv_lead_ui "$(tail -1 rr_srv_lead_ui.log)" "$U(w2 시안 CSL-030 한 장 신청서 — 「인증번호 받기」 → 「상담 신청」)"
API_TOSS=http://localhost:3121/api/v1 python3 srv_pay.py > rr_srv_pay.log 2>&1; r srv_pay "$(tail -1 rr_srv_pay.log)" "$U(가짜 결제사의 승인 · 취소 시각을 지금으로 — 전: 10/2 고정이라 D064 「결제 시각 ≥ 주문 시각」에 걸림 · 배송 완료 시각 순서)"
python3 srv_pay_ui.py > rr_srv_pay_ui.log 2>&1; r srv_pay_ui "$(tail -1 rr_srv_pay_ui.log)" "$U(D064 시각 순서)"
python3 srv_retship.py > rr_srv_retship.log 2>&1; r srv_retship "$(tail -1 rr_srv_retship.log)" "$U(D064 시각 순서 — 미리 고쳐 둔 것 확인)"
bash adapters_down.sh >> rr_adapters2.log 2>&1
KIT=$K API=http://localhost:3000 python3 srv_fin_ui.py > rr_srv_fin_ui.log 2>&1; r srv_fin_ui "$(tail -1 rr_srv_fin_ui.log)" "$U(w2 — /consult 업종 줄 「상세 보기 · 상담 신청」 · 돌아가기 줄 · 한 장 신청서)"
python3 site_opt.py > rr_site_opt.log 2>&1; r site_opt "$(tail -1 rr_site_opt.log)" "$U(w3 시안 — 「오늘의 건강상품」 · 「많이 찾는 상품」을 서버 값으로 다시 그림)"
python3 fix_1027b_ui.py > rr_fix_1027b_ui.log 2>&1; r fix_1027b_ui "$(tail -1 rr_fix_1027b_ui.log)" "$U(가입 약관 = 전체 대상 · w3 나의공간 · 문의함 딱지 · w2 사업 기회 등록 제목)"
python3 fix_1027c.py > rr_fix_1027c.log 2>&1; r fix_1027c "$(tail -1 rr_fix_1027c.log)" "$U(고객센터 첫 화면 /support/new · 계약서 양식 링크 ?deal= · 파트너 알림 탭 ?tab=alarm)"
python3 site_mny.py > rr_site_mny.log 2>&1; r site_mny "$(tail -1 rr_site_mny.log)" "$U(w2 — 7구역을 서버 자료로 그림 · 쪽 번호 · 제한 업종 표시 · 글꼴 · 지역으로 찾기)"
API=http://localhost:3000 python3 web_mal.py > rr_web_mal.log 2>&1; r web_mal "$(tail -1 rr_web_mal.log)" "$U(급매 띠 → /money/urgent · 한 장 신청서)"
python3 site_detail.py > rr_site_detail.log 2>&1; r site_detail "$(tail -1 rr_site_detail.log)" "$U(v10.29 이후 상세 틀 gw-dt* · 누적수익 「비공개」 4칸 · 요청 카드 D-n — v10.29 부터 넘어온 실패 13단계)"
echo RERUN-B2-DONE >> $O
