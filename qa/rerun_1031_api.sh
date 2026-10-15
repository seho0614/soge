#!/bin/bash
# v10.31 — 전수 검정에서 실패한 시험을 원인별로 고친 뒤 다시 돌림(1차 · API · DB 시험 — 서버 · 사용자 웹을 다시 띄우지 않아도 되는 것)
#   결과: final_all_reruns_1031.txt 에 「시험: 결과 — 까닭」
cd /home/claude/qa; K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 PYTHONPATH=/home/claude/qa/tools/offline_fonts
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
O=final_all_reruns_1031.txt
r() { echo "$1: $2 — $3" >> $O; echo "$1: $2"; }
python3 decisions.py > rr_decisions.log 2>&1; r decisions "$(tail -1 rr_decisions.log)" "시험을 고친 뒤(Q4-2 — 두 SQL 이 같은 파트너를 고르게 ORDER BY · 파트너가 늘어 LIMIT 1 이 서로 다른 줄을 골랐음)"
python3 srv_hlt.py > rr_srv_hlt.log 2>&1; r srv_hlt "$(tail -1 rr_srv_hlt.log)" "시험을 고친 뒤(w3 D064 주문 ≤ 결제 ≤ 발송 ≤ 배송 완료 — 시각을 과거로 돌릴 때 주문 · 결제 시각도 함께)"
python3 srv_viewlimit.py > rr_srv_viewlimit.log 2>&1; r srv_viewlimit "$(tail -1 rr_srv_viewlimit.log)" "시험을 고친 뒤(D060 BASIC 무료 소개코드 0건 → 결제(스텁) 뒤 발급)"
python3 fix_1027b.py > rr_fix_1027b.log 2>&1; r fix_1027b "$(tail -1 rr_fix_1027b.log)" "시험을 고친 뒤(D090 가입 약관 = 전체 대상만 — 파트너 이용약관 제외)"
python3 srv_detail.py > rr_srv_detail.log 2>&1; r srv_detail "$(tail -1 rr_srv_detail.log)" "결함 고친 뒤(S-2 — 새 입력 10곳 @StrictBoolean · 커밋 f649c55 · 소스 점검) · 시험을 고친 뒤(D047 빈 후기 422 · 같은 거래 후기는 고쳐 씀)"
KIT=$K python3 srv_billing.py > rr_srv_billing.log 2>&1; r srv_billing "$(tail -1 rr_srv_billing.log)" "시험을 고친 뒤(3-17 — D060 소개코드 결제(스텁) 포함 동시 8건)"
python3 fix_1028.py > rr_fix_1028.log 2>&1; r fix_1028 "$(tail -1 rr_fix_1028.log)" "시험을 고친 뒤(A-17 시각 순서 · F 부동산 아닌 매물 + 소개코드 결제 · G-7 PARTNER · G-8 가장 나중의 글 마이그레이션을 ROLLBACK 안에서 두 번 · G-9 바뀐 점) · 결함 고친 뒤(H-3 toLocale 2곳 · 커밋 435237d)"
python3 srv_v1031.py > rr_srv_v1031.log 2>&1; r srv_v1031 "$(tail -1 rr_srv_v1031.log)" "새 시험을 이 서버의 규칙(손님 403 UNAUTHENTICATED · 운영 계정은 회원 역할도 가짐 · 칸 이름)에 맞춘 뒤 전부(A ~ I)"
bash adapters_up.sh > rr_adapters.log 2>&1
API_TOSS=http://localhost:3121/api/v1 python3 srv_pay.py > rr_srv_pay.log 2>&1; r srv_pay "$(tail -1 rr_srv_pay.log)" "시험을 고친 뒤(배송 완료 만들 때 주문 · 결제 시각을 앞으로 — D064)"
API=http://localhost:3000 ADP=http://localhost:3123 KIT=$K CHECK_DB=postgresql://sgb:sgb@localhost:5432/sgb_check python3 srv_lead.py > rr_srv_lead.log 2>&1; r srv_lead "$(tail -1 rr_srv_lead.log)" "시험을 고친 뒤(시험 사업자번호 끝 01 — 임의 번호가 02 · 03 이면 휴업 · 폐업으로 신청 거부 · H-15 휴업 · 폐업은 422 BIZ_CLOSED(w1 시안 jfail))"
bash adapters_down.sh >> rr_adapters.log 2>&1
echo RERUN-API-DONE >> $O
