#!/bin/bash
# v10.31 — 5차 다시 돌림(시험을 고친 2개) — chain_1031b 가 끝난 뒤(한 번에 하나)
cd /home/claude/qa
while ! grep -q CHAIN-B-DONE final_all.txt; do sleep 30; done
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 PYTHONPATH=/home/claude/qa/tools/offline_fonts
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
O=final_all_reruns_1031.txt
r() { echo "$1: $2 — $3" >> $O; echo "$1: $2"; }
B="다시 빌드한 뒤(19:2x)"
python3 site_mall.py > rr_site_mall.log 2>&1; r site_mall "$(tail -1 rr_site_mall.log)" "$B · 결함 고친 뒤(V-16 INV-H4 · 커밋 fe6b3b1) · 시험을 고친 뒤(w3 내 주문 · 순위 상자 · 배송 완료 시험 주문의 시각을 몇십 분 전으로 — 나흘 전이면 buyer@x.com 의 최근 50건 밖으로 밀림)"
python3 fix_1028_ui.py > rr_fix_1028_ui.log 2>&1; r fix_1028_ui "$(tail -1 rr_fix_1028_ui.log)" "$B · 결함 고친 뒤(C-U1 순위 기간 · 커밋 21b3f6c) · 시험을 고친 뒤(F-U8 — W3 P4-a 시안 글 「몇 가지는 사업자만」 + 개인 수령 안내 · G-U2 — 이용약관 1.3 의 바뀐 점 = change_note)"
# D(시안) — 시험을 v10.31 시안에 맞춘 것 · 결과 폴더 · 앞 판(v10.30) 기준 파일
export PROTO=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html
U="시험을 고친 뒤"
python3 proto_main.py > rr_proto_main.log 2>&1; r proto_main "$(tail -1 rr_proto_main.log)" "$U(v10.31 시안 — 검색 단추 · 추천 칩은 body 의 검색 팝업(#spop)을 엶 → 반응 판정에 팝업을 넣음)"
python3 proto_poll.py > rr_proto_poll.log 2>&1; r proto_poll "$(tail -1 rr_proto_poll.log)" "$U(F-4 — W5 D070 리드 이용료 선불: 탈락 사유 「미납 한도 초과」 → 「잔액 0 — 충전 전까지 받지 않음」)"
for t in proto_bill proto_urg proto_detail; do python3 $t.py > rr_$t.log 2>&1; r $t "$(tail -1 rr_$t.log)" "$U(앞 판 시안 v10.17 · v10.18 · v10.19 가 이 작업 환경에 없음 — 그것과 견주는 단계는 건너뜀으로(전: None 과 견줘 실패) · v10.30 첫 회차도 같은 줄 수 실패)"; done
for t in proto_item proto_axis proto_fin; do python3 $t.py > rr_$t.log 2>&1; r $t "$(tail -1 rr_$t.log)" "$U(화면 211장 = 206 + v10.31 시안 키 5장 admdspt · dspu · qna · terms · verify)"; done
python3 proto_cmu.py > rr_proto_cmu.log 2>&1; r proto_cmu "$(tail -1 rr_proto_cmu.log)" "$U(머리줄 돋보기 = 검색 팝업 — 주소만 바꿔 다시 열 때 팝업을 닫음)"
python3 proto_mall.py > rr_proto_mall.log 2>&1; r proto_mall "$(tail -1 rr_proto_mall.log)" "$U(같음 · H-5 소개몰 안의 돋보기 = 본체 검색 화면(src) 또는 검색 팝업)"
python3 proto_mny.py > rr_proto_mny.log 2>&1; r proto_mny "$(tail -1 rr_proto_mny.log)" "$U(같음 — 머리줄 돋보기 = 검색 팝업)"
python3 fix_1027_proto.py > rr_fix_1027_proto.log 2>&1; r fix_1027_proto "$(tail -1 rr_fix_1027_proto.log)" "$U(G-198-1 — #/terms 는 v10.31 시안 키 「terms」 화면)"
python3 g130_check.py > rr_g130_check.log 2>&1; r g130_check "$(tail -1 rr_g130_check.log)" "환경을 고친 뒤(결과 폴더 qa/g130 이 없었음 — v10.30 과 같음)"
r proto_diff "$(python3 proto_diff.py 2>/dev/null | tail -1)" "$U(앞 판 = v10.30 · 바뀐 화면 63장 · 새 화면 5장 — v1031_changes.py)"
r proto_pixel "$(python3 proto_pixel.py 2>/dev/null | tail -1)" "$U(앞 판 = v10.30 · v1031_changes.py)"
# flow 점검 — 시험을 v10.31 화면에 맞춘 것(각 흐름은 처음부터 다시)
U2="시험을 고친 뒤"
python3 flow_trade.py > flow_trade.log 2>&1; r flow_trade "$(tail -1 flow_trade.log)" "$U2(T1-5 동의 줄 class w1-agr · T3-3 부담 주체 = 업종의 fee_bearer(인테리어 · 시공 = BUYER) · T5-9 w1 시안 요청 상세 — 본문 · 「등록 N시간 전」 줄)"
python3 flow_mall.py > flow_mall.log 2>&1; r flow_mall "$(tail -1 flow_mall.log)" "$U2(w3 시안 반품 · 취소 신청 — 「① 항목 선택 (주문 전체 · 상태)」 · 품목 「이름 N개」 → M4 · M5 · M7(배송지 삭제는 M4 가 막혀 생긴 것))"
python3 flow_plaza.py > flow_plaza.log 2>&1; r flow_plaza "$(tail -1 flow_plaza.log)" "$U2(P1-3 관 화면 틀의 축 단추 .gw-axt)"
python3 flow_biz.py > flow_biz.log 2>&1; r flow_biz "$(tail -1 flow_biz.log)" "$U2(B1-5 결제 수단 「등록된 카드 · 카드사 ****1234」 칸 · B4-3 입점 단계 칸 — 이름 · 상태 사이 빈칸 없음)"
python3 flow_proto.py > flow_proto.log 2>&1; r flow_proto "$(tail -1 flow_proto.log)" "$U2(S8-7 파트너 첫 화면 「리드 이용료 잔액」(선불) · S10-10 약관 · 정책 표 11줄 — 파트너 이용약관)"
echo RERUN-E-DONE >> $O
