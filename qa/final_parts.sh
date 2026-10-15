#!/bin/bash
# 최종 전수 검정을 네 구간으로 나눠 돌립니다 — 작업 환경이 중간에 다시 시작돼도 끊긴 구간부터 이어서 돌릴 수 있게 (final_all.sh 와 같은 내용 · 같은 순서).
#   bash final_parts.sh A   검정 DB 새로 만들고 verify · 광고 · 매트릭스 · 준비 자료 · e2e · 결정 · 수정     (final_all.txt 를 새로 씀)
#   bash final_parts.sh B   서버 기능(API · DB) + 화면 — 제휴 · 건강몰 · 파트너 · 결제 · 파일 · 리드 · 상담 · 배송비 · 소개코드 · 열람 한도 · 투표 · 결제/환불 정합(v10.18) · 매물 상세(v10.21) · 소개광장(v10.23) · 생활금융 상담(v10.24) · 소개몰(v10.25) · 상품 옵션 · 교환 비용(v10.26)
#   bash final_parts.sh C   사용자 웹 메인 · 안심소개 · API 조회 전수 · 쪽 넘김 · 모든 페이지 상호 확인(사용자 웹 · 운영 화면)
#   bash final_parts.sh D   시안 전수(누르기) · 상담 · 메인 · 투표 · 축 상세 · 언어 단추 · 소개광장(v10.23) · 생활금융 상담(v10.24) · 소개몰(v10.25) · 앞 판과 같은지(글자 · 모양) · 보고
#   끝난 구간은 final_all.txt 에 「PART-x-DONE」 줄이 남습니다.
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
cd /home/claude/qa
OUTF=${OUTF:-final_all.txt}
r(){ echo "$1: $2" | tee -a "$OUTF"; }      # v10.28 — 다시 돌릴 때는 OUTF=final_all_reruns_1028.txt
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173
# v10.31 — 바깥 인터넷이 막힌 작업 환경: 구글 글꼴 요청에만 빈 응답(tools/offline_fonts · 인터넷이 되는 PC 에서는 SGB_OFFLINE_FONTS=0)
export PYTHONPATH=/home/claude/qa/tools/offline_fonts${PYTHONPATH:+:$PYTHONPATH}
# v10.31 — 시안 경로(D 구간 · 기본 킷의 spec/proto.html). 시안 작업이 따로 끝난 판은 PROTO=/home/claude/work/v3/proto/SGB_Prototype_v10_31.html
export PROTO=${PROTO:-$K/spec/proto.html}
case "${1:-}" in
A)
: > final_all.txt
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS sgb_check' -c 'CREATE DATABASE sgb_check OWNER sgb'" >/dev/null 2>&1
( unset API SITE BO
# v10.16 — 3000 의 API 는 **운영 방식**(bash api_dist.sh — tsc 로 빌드한 dist/main.js · 정의에 없는 입력은 400 · /docs 없음)으로 띄워 둡니다
r api_mode "/docs → $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/docs) (404 = 운영 방식 dist/main.js · 200 = 개발 서버)"
(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check timeout 900 npm run verify > /tmp/verify.log 2>&1); r verify "exit=$? $(grep -E '^통과 [0-9]+ / 실패' /tmp/verify.log | head -1) | $(grep -E '뚫림' /tmp/verify.log | head -1) | $(grep 'SQL 대조' /tmp/verify.log)"
# v10.17 — 개발 Docker 의 ads-migrate.sh 가 기동 때 하는 것과 같은 일(시드 광고주의 확인 시각을 새로 찍음 · AD-03). 로컬 DB 는 그 스크립트를 거치지 않습니다
psql -q postgresql://sgb:sgb@localhost:5432/sgb_ads -c "UPDATE advertisers SET verified_at = now() WHERE name LIKE '%(시드)' AND suspended_at IS NULL AND (verified_at IS NULL OR verified_at < now() - interval '1 hour')" >/dev/null 2>&1
# v10.22 (G-144) — 공격 검정이 「남의 거래」를 줄 순서와 무관하게 고르는지(검정 DB 를 읽기만 함)
r attack_pick "$(DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check python3 attack_pick_test.py 2>/dev/null | tail -1)"
# v10.23 — 실제 웹에 둔 그림(site/public/b2)이 받은 디자인의 그 자리와 점 하나 같은지(자르기만 했는지)
r cut_b2 "$(python3 cut_b2.py --check 2>&1 | tail -1)"
# v10.25 — 소개몰 메인의 그림 조각(site/public/shop · 시안에 넣은 것)이 받은 그림에서 다시 압축하지 않고 자른 것인지
r cut_mall "$(python3 cut_mall.py --check 2>&1 | tail -1)"
# v10.30 — 소개장터 메인의 그림 조각(site/public/money 29장 · 시안에 넣은 53장)이 받은 그림(2026-10-09)에서 자르기만 한 것인지(점 하나까지 같음)
r cut_money "$(python3 cut_money.py --check 2>&1 | tail -1)"
r ads "$(ADS_DB=postgresql://sgb:sgb@localhost:5432/sgb_ads PGDATABASE= bash $K/../sgb-ads/scripts/verify-ads.sh 2>&1 | tail -1)"
r matrix "$(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb npm run matrix 2>&1 | tail -2 | tr '\n' ' ')"
# v10.13 — 시험 준비 자료(새로 만든 DB 에서는 몇몇 점검의 전제 자료가 없습니다 · fixtures.py 머리말). 여러 번 돌려도 같습니다
API=http://localhost:3000/api/v1 python3 fixtures.py > fixtures.log 2>&1; r fixtures "$(tail -1 fixtures.log)"
for s in e2e decisions decisions_ui fixes_1002; do python3 $s.py > final_$s.log 2>&1; r $s "$(tail -1 final_$s.log)"; done
)
echo PART-A-DONE >> final_all.txt ;;
B)
for s in srv_aff srv_hlt srv_ptn srv_aff_ui srv_hlt_ui srv_ptn_ui srv_proto; do python3 $s.py > $s.log 2>&1; r $s "$(tail -1 $s.log)"; done
# v10.31 — 파트너센터 · 제휴 영업(W5): 리드 이용료 선불 · 상담 메모 · 서비스 위자드 · 이행 보고 · 운영 /admin/partner-center/*
python3 srv_w5.py > srv_w5.log 2>&1; r srv_w5 "$(tail -1 srv_w5.log)"
# v10.31 — 새로 생긴 API 역할별 호출(성공현황 · 사진 · 피해 사례 · 공급자 · 검색어 · 알림 수신 · 계약 확인 요청 · 정산 승인 · 활주로 · 외부 송출 …)
[ -f srv_v1031.py ] && { python3 srv_v1031.py > srv_v1031.log 2>&1; r srv_v1031 "$(tail -1 srv_v1031.log)"; }
# v10.32 — 「시안대로 고칠 것」 반영분: 운영 화면 바뀐 흐름(감사 ↔ 감사 기록 · 파트너사 상세 · 새 관 · 소개몰 상품 · 성향 학습) · 실제 차이 2건(공개 문의 단독 화면 · 분쟁 증빙 · 처리 현황)
[ -f ui_adm_v1032.py ] && { python3 ui_adm_v1032.py > ui_adm_v1032.log 2>&1; r ui_adm_v1032 "$(tail -1 ui_adm_v1032.log)"; }
[ -f test_v1032_two.py ] && { python3 test_v1032_two.py > test_v1032_two.log 2>&1; r test_v1032_two "$(tail -1 test_v1032_two.log)"; }
# v10.33 — 법률 · 세무 정액 노출: 부가세 별도 · 기간 연장(A안) · 입금 확인마다 세금계산서(D092)
[ -f test_v1033_directory.py ] && { python3 test_v1033_directory.py > test_v1033_directory.log 2>&1; r test_v1033_directory "$(tail -1 test_v1033_directory.log)"; }
# v10.34 — 국세청 전자세금계산서 연결 자리 · 간주 모드(D093) · 가짜 서버로 http 어댑터
[ -f test_v1034_etax.py ] && { python3 test_v1034_etax.py > test_v1034_etax.log 2>&1; r test_v1034_etax "$(tail -1 test_v1034_etax.log)"; }
# v10.36 — 소개장터 개인 회원 등록 허용(D094) · 운영 화면 「로그인 후 첫 화면」 저장(소개몰 · 신규 가입자) · 사용자 웹 반영
[ -f test_v1036.py ] && { python3 test_v1036.py > test_v1036.log 2>&1; r test_v1036 "$(tail -1 test_v1036.log)"; }
# v10.37 — P2P(모든 업무 개인 · 인증이 필요한 등록만 그 인증) · 신규 가입자 첫 화면 사용 · 안내 글
[ -f test_v1037.py ] && { python3 test_v1037.py > test_v1037.log 2>&1; r test_v1037 "$(tail -1 test_v1037.log)"; }
# v10.38 — 파트너센터 계정 기준(D096): 본인인증 개인이 입점 · 축 · 공인중개사 · 인력대행 회신 · 개인 활동 정보는 사업자 인증 · 세금계산서에 섞이지 않음
[ -f test_v1038.py ] && { python3 test_v1038.py > test_v1038.log 2>&1; r test_v1038 "$(tail -1 test_v1038.log)"; }
# v10.39 — 리팩토링(코드 구조만): 내 파트너 찾기 한 곳 · 쓰지 않는 사업자 게이트 코드 · 통과만 하던 DB 판매 게이트(D097) — 바탕 v10.38 API(3998 · 같은 DB)와 응답 대조
[ -f test_v1039.py ] && { python3 test_v1039.py > test_v1039.log 2>&1; r test_v1039 "$(tail -1 test_v1039.log)"; }
# v10.40 — P2P 와 어긋나던 안내 글 고침(글만): 옛 글 없음 · 새 글 화면 확인
[ -f test_v1040.py ] && { python3 test_v1040.py > test_v1040.log 2>&1; r test_v1040 "$(tail -1 test_v1040.log)"; }
# v10.41 — 소개장터 「많이 찾는 키워드」 칩은 시안대로(통합 검색 결과 「전체」 탭)
[ -f test_v1041.py ] && { python3 test_v1041.py > test_v1041.log 2>&1; r test_v1041 "$(tail -1 test_v1041.log)"; }
# 10/2 서버 기능 (결제·환불 · 파일 · 리드 배정 · 어댑터) — 어댑터 인스턴스(3121·3122·3123)를 띄워 실제 HTTP 로
bash adapters_up.sh > adapters.log 2>&1
API_TOSS=http://localhost:3121/api/v1 python3 srv_pay.py > srv_pay.log 2>&1; r srv_pay "$(tail -1 srv_pay.log)"
python3 srv_pay_ui.py > srv_pay_ui.log 2>&1; r srv_pay_ui "$(tail -1 srv_pay_ui.log)"
API_S3=http://localhost:3122/api/v1 KIT=$K python3 srv_file.py > srv_file.log 2>&1; r srv_file "$(tail -1 srv_file.log)"
python3 srv_file_ui.py > srv_file_ui.log 2>&1; r srv_file_ui "$(tail -1 srv_file_ui.log)"
API=http://localhost:3000 ADP=http://localhost:3123 KIT=$K CHECK_DB=postgresql://sgb:sgb@localhost:5432/sgb_check python3 srv_lead.py > srv_lead.log 2>&1; r srv_lead "$(tail -1 srv_lead.log)"
python3 srv_lead_ui.py > srv_lead_ui.log 2>&1; r srv_lead_ui "$(tail -1 srv_lead_ui.log)"
# 10/2 v10.11 — 올린 kit(v10.4.7) 안심소개 변경분: 축별 입점 · 법률 · 세무 월 정액 노출 (D018 · D019) · v10.12 월 노출료 기준 금액(D020)
python3 srv_consult.py > srv_consult.log 2>&1; r srv_consult "$(tail -1 srv_consult.log)"
python3 srv_consult_ui.py > srv_consult_ui.log 2>&1; r srv_consult_ui "$(tail -1 srv_consult_ui.log)"
bash adapters_down.sh >> adapters.log 2>&1
# 10/2 2차 결정 — 반품 왕복 배송비 차감(D009) · 일반 회원 소개코드 · 유입 기록(D010)
python3 srv_retship.py > srv_retship.log 2>&1; r srv_retship "$(tail -1 srv_retship.log)"
python3 srv_refcode.py > srv_refcode.log 2>&1; r srv_refcode "$(tail -1 srv_refcode.log)"
python3 srv_refcode_ui.py > srv_refcode_ui.log 2>&1; r srv_refcode_ui "$(tail -1 srv_refcode_ui.log)"
# 10/2 3차 결정 — 요청 열람 한도 스위치 · 종료일 · 소개코드 범위 (D011 · D013) ★ 공용 설정을 잠깐 바꿉니다(끝에 되돌림)
python3 srv_viewlimit.py > srv_viewlimit.log 2>&1; r srv_viewlimit "$(tail -1 srv_viewlimit.log)"
python3 csrf_check.py > csrf_check.log 2>&1; r csrf "$(tail -1 csrf_check.log)"
# v10.14 — 소개광장 「이건 어때?」 투표 · 사회관계망 주소 (D021) ★ 공용 설정을 잠깐 바꿉니다(끝에 되돌림) · 시험 투표는 끝에 「감춤」
python3 srv_poll.py > srv_poll.log 2>&1; r srv_poll "$(tail -1 srv_poll.log)"
python3 srv_poll_ui.py > srv_poll_ui.log 2>&1; r srv_poll_ui "$(tail -1 srv_poll_ui.log)"
# v10.18 — 결제 · 환불 정합(D022): 정기결제 · 구독 환불 · 중복 요청 · 해지. 실제 PostgreSQL(개발 DB) + 운영 방식 API 2대(3131 · 3132) + 가짜 결제사(3139 · 실제 HTTP · 장애 주입).
#   스스로 서버를 띄우고 끕니다(승인 직후 서버를 죽이는 시험이 있어서). dist 가 빌드돼 있어야 합니다(api_dist.sh 가 빌드합니다).
KIT=$K python3 srv_billing.py > srv_billing.log 2>&1; r srv_billing "$(tail -1 srv_billing.log)"
python3 srv_billing_ui.py > srv_billing_ui.log 2>&1; r srv_billing_ui "$(tail -1 srv_billing_ui.log)"
# v10.21 — 매물 상세(D023): 조회 수 · 소개자 실적 · 누적수익 공개(본인이 켠 경우만) · 후기 작성/공개 조회 · 참 · 거짓 입력 · 요청 등록 시각. 새 계정만 씁니다(거래 3건은 넣었다가 지움)
python3 srv_detail.py > srv_detail.log 2>&1; r srv_detail "$(tail -1 srv_detail.log)"
# v10.23 — 소개광장: 작성자 이름 가림(G-146) · 게시글 검색 · 쪽 번호(GET /community/board) / 실제 웹(제시 디자인 · 두 관 전용 머리줄 · 바닥줄 · 사진은 받은 PNG 그대로)
#   시험 글은 표식을 달아 넣었다가 끝에 지웁니다. 계정은 남습니다(다른 시험과 같음).
python3 srv_cmu.py > srv_cmu.log 2>&1; r srv_cmu "$(tail -1 srv_cmu.log)"
python3 srv_cmu_ui.py > srv_cmu_ui.log 2>&1; r srv_cmu_ui "$(tail -1 srv_cmu_ui.log)"
# v10.24 — 안심소개 「생활 · 금융 상담」: 업종 상세(GET /consult/categories/:code) · 시험용 업체(개발 · 시연용 시드 — SEED=1 로 두 번 돌려 봄) · 상담하기 / 실제 웹(목록 → 상세 → 신청서 → 접수)
#   시험 신청은 끝에 운영 API 로 종료합니다. 사용자 웹이 업종 목록을 60초 기억하므로 시드 직후에는 한 번 열어 둡니다.
KIT=$K API=http://localhost:3000 SEED=1 python3 srv_fin.py > srv_fin.log 2>&1; r srv_fin "$(tail -1 srv_fin.log)"
curl -s -o /dev/null --max-time 60 "$SITE/mall?axis=consult"; curl -s -o /dev/null --max-time 60 "$SITE/mal/consult"
API=http://localhost:3000 python3 srv_fin_ui.py > srv_fin_ui.log 2>&1; r srv_fin_ui "$(tail -1 srv_fin_ui.log)"
# v10.25 — 소개몰(쇼핑몰)을 시안 기준으로: 이름 · 약관(D024) · 배송비 전 상품 무료 · 의료기기 미판매 · 건강기능식품 잠금(D025) · GET /health/categories / 실제 웹(메인 = 제시 디자인 · 하위 20쪽 = 시안의 구성 · 한글 「없는 주소」)
#   시험 주문은 끝에 취소합니다. 사용자 웹이 약관 · 갈래를 잠깐 기억하므로 시험이 먼저 한 번 열어 둡니다.
KIT=$K python3 srv_mall.py > srv_mall.log 2>&1; r srv_mall "$(tail -1 srv_mall.log)"
python3 site_mall.py > site_mall.log 2>&1; r site_mall "$(tail -1 site_mall.log)"
# v10.26 — 확장 점검에서 나온 제품 결함 10건의 수정 확인(G-173 · 177 · 178 · 182 · 174 · 179 · 180 · 181 · 183 · 186). 고치기 전에 먼저 만들어 실패를 본 시험입니다. 시험 주문은 끝에 취소합니다
python3 fix_1026.py > fix_1026.log 2>&1; r fix_1026 "$(tail -1 fix_1026.log)"
# v10.26 — 소개몰 상품 자료 · 옵션 · 교환 배송비(D027 · D028 · D029): 서버(옵션 · 재고 · 장바구니 · 주문 · 검색 제안 · 운영 상품 관리 · 교환 비용 · 약관 1.2) / 사용자 웹(메인 · 성분 · 자동완성 · 장바구니 가격 변경 · 교환 결제)
#   시험 주문 일부는 배송 완료로 남습니다(새 계정 opt_* · sopt_*). 시험 상품(OPTTEST-*)은 끝에 판매 중지
python3 srv_opt.py > srv_opt.log 2>&1; r srv_opt "$(tail -1 srv_opt.log)"
python3 site_opt.py > site_opt.log 2>&1; r site_opt "$(tail -1 site_opt.log)"
# v10.27 — 결함 수정판: 서버 · DB(G-212 · 172 · 176 · 175 · 171 · 184 · 190 · 191 · 207 · 판매 약관) · 거래 흐름(G-193) · 가입 동의(G-188) · 나의공간(G-195) · 거래 당사자 확인(G-213) · 작은 결함(G-201) · 구독 예약(G-189 ③)
#   고치기 전에 먼저 만들어 실패를 본 시험입니다. 시험 주문은 취소 · 시험 매물은 ARCHIVED 로 둡니다. 계정(fx7*_*@t.local)은 남습니다
python3 fix_1027.py > fix_1027.log 2>&1; r fix_1027 "$(tail -1 fix_1027.log)"
python3 fix_1027b.py > fix_1027b.log 2>&1; r fix_1027b "$(tail -1 fix_1027b.log)"
python3 fix_1027b_ui.py > fix_1027b_ui.log 2>&1; r fix_1027b_ui "$(tail -1 fix_1027b_ui.log)"
# v10.27 G-130 개발 반영 — 파트너사 상세 · 알림 「보기」 · 계약서 양식 전문 · 사기 예방 가이드 · 택배사 조회
python3 fix_1027c.py > fix_1027c.log 2>&1; r fix_1027c "$(tail -1 fix_1027c.log)"
# v10.28 — 두 묶음 한 판: A 발송 처리 · 구매확정 · B 리뷰 · 문의 · C 순위 · D 선택 약관 이력(G-214) · E 상담 이메일 · F 개인 소개비 정산(스위치를 잠깐 켜고 되돌림) · G 약관 한 벌 · 재동의
#   시험 회원(fx8*_*@t.local)과 그 주문 · 거래가 남습니다. 소개비 스위치(feature.referral_fee)는 시험 뒤 원래 값(off)으로 되돌립니다
python3 fix_1028.py > fix_1028.log 2>&1; r fix_1028 "$(tail -1 fix_1028.log)"
python3 fix_1028_ui.py > fix_1028_ui.log 2>&1; r fix_1028_ui "$(tail -1 fix_1028_ui.log)"
# v10.30 — 소개장터 메인(/money)을 제시 디자인대로: 머리 · 바닥(그 화면만) · 구역 = 서버 자료 · 넣지 않은 구역 · 광고(GHERO) 노출 · 클릭 기록 · 지금 있던 매물 구역 · 낱말로 매물 찾기 · 그림 · 글꼴 · 알림 종 · 좁은 화면 · 자리 대조
#   읽기만 합니다(광고 노출 · 클릭 기록 2줄만 남습니다 — 개발 DB 의 시드 광고)
python3 site_mny.py > site_mny.log 2>&1; r site_mny "$(tail -1 site_mny.log)"
echo PART-B-DONE >> final_all.txt ;;
C)
# 10/2 사용자 웹 반영 (새 메인 · 안심소개 상담 축)
# v10.13 — 메인 「hero 페이지」 디자인: 기본(그림 내용 그대로 · 5174) + 실제 자료로 켠 인스턴스(HOME_CONTENT=live · 5176 · 떠 있을 때만)
python3 web_main.py > web_main.log 2>&1; r web_main "$(tail -1 web_main.log)"; cp web_main.json web_main_sample.json 2>/dev/null; for f in web_main_*_1280.png web_main_*_390.png; do case "$f" in *_sample_*|*_live_*) ;; *) [ -f "$f" ] && cp "$f" "${f/web_main_/web_main_sample_}";; esac; done
if curl -s -o /dev/null --max-time 3 http://localhost:5176/; then SITE=http://localhost:5176 python3 web_main.py > web_main_live.log 2>&1; r web_main_live "$(tail -1 web_main_live.log)"; cp web_main.json web_main_live.json; cp web_main_sample.json web_main.json; else r web_main_live "건너뜀 — 5176 에 live 인스턴스가 없습니다"; fi
# v10.13 — 메인을 여러 번 새로 열어 수화 오류(React #418)가 한 번도 없는지 (드물게 나는 오류라 한두 번으로는 안 보입니다)
python3 hyd_home.py > hyd_home.log 2>&1; r hyd_home "$(tail -1 hyd_home.log)"
# v10.13 — 1280px 에서 각 구역이 주신 그림과 같은 자리에 있는지(±12px)
python3 measure_home.py > measure_home.log 2>&1; r measure_home "$(tail -1 measure_home.log)"
python3 web_mal.py > web_mal.log 2>&1; r web_mal "$(tail -1 web_mal.log)"
# v10.20 (G-125 · G-126) — 날짜 · 시각이 서버 시간대와 관계없이 한국 시각으로 나오는지: 소스 점검 + TZ=UTC 로 띄운 API · 사용자 웹(스스로 띄우고 끕니다 · 3177 · 5177)
python3 site_tz.py > site_tz.log 2>&1; r site_tz "$(tail -1 site_tz.log)"
# v10.21 — 실제 웹 매물 상세(그림 1 형식 · 맨 아래 줄 · 누적수익 공개 설정 · 로그인 뒤 돌아오기) — 실제 로그인 · 클릭
python3 site_detail.py > site_detail.log 2>&1; r site_detail "$(tail -1 site_detail.log)"
# v10.27 (G-94) — 목록 화면 수화 오류를 부하 속에서(창 6개 동시 · 540번)
r hyd_load "$(bash hyd_load.sh 2>&1 | tail -1)"
python3 api_smoke.py > final_smoke.log 2>&1; r smoke "$(tail -1 final_smoke.log)"
r pagetest "$(python3 pagetest.py 2>&1 | tail -3 | tr '\n' ' ')"
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; r crawl_site done
python3 crawl_admin_final.py > final_admin.log 2>&1; r crawl_admin done
echo PART-C-DONE >> final_all.txt ;;
D)
python3 sweep_proto.py > sweep_proto.log 2>&1; r sweep_proto done
# v10.12 — 시안의 상담 축 · 월 노출료 기준 금액(D020) 시연 점검
python3 proto_consult.py > proto_consult.log 2>&1; r proto_consult "$(tail -1 proto_consult.log)"
# v10.13 — 시안 새 메인(「hero 페이지」 디자인)
python3 proto_main.py > proto_main.log 2>&1; r proto_main "$(tail -1 proto_main.log)"
# v10.14 — 시안: 투표 · 사회관계망 · 지급 데스크 · 리드 배정 화면 + 이전 판(v10.13)과 화면마다 비교
python3 proto_poll.py > proto_poll.log 2>&1; r proto_poll "$(tail -1 proto_poll.log)"
# v10.18 — 시안: 「내 구독」(해지 · 환불 상태) · 운영 「결제 · 환불 확인 필요」
python3 proto_bill.py > proto_bill.log 2>&1; r proto_bill "$(tail -1 proto_bill.log)"
# v10.19 — 시안: 「급구 · 급매」 화면의 소개 버튼 3종 삭제
python3 proto_urg.py > proto_urg.log 2>&1; r proto_urg "$(tail -1 proto_urg.log)"
# v10.20 — 시안: 「상세」 화면의 소개 버튼 3종 삭제 (앞 판과 화면마다 비교는 proto_diff — v10.21 은 앞 판 v10.20 과 16장만 달라야 함)
python3 proto_detail.py > proto_detail.log 2>&1; r proto_detail "$(tail -1 proto_detail.log)"
# v10.21 — 시안: 매물 상세가 누른 매물의 내용으로(카드 83장을 하나씩) · 매물별 주소 · 세 관 한 틀 · 맨 아래 줄 · 마이 관심 · 문의방 왕복 · 소개광장 글 상세
python3 proto_item.py > proto_item.log 2>&1; r proto_item "$(tail -1 proto_item.log)"
# v10.22 — 시안: 소개창업 「인력 · 운영지원 · 정보」 축의 상세 4종 · 항목별 주소 · 축별 주소 · 인력 축 열기 / 언어 단추(G-138) · 로그인 화면
python3 proto_axis.py > proto_axis.log 2>&1; r proto_axis "$(tail -1 proto_axis.log)"
python3 proto_lang.py > proto_lang.log 2>&1; r proto_lang "$(tail -1 proto_lang.log)"
# v10.23 — 시안: 소개광장 제시 디자인(머리줄 · 바닥줄 · 목록 1쪽 = 그림 · 탭 · 검색 · 쪽 번호 · 글 상세 · 글쓰기 · 투표 · 그림 바이트 비교)
python3 proto_cmu.py > proto_cmu.log 2>&1; r proto_cmu "$(tail -1 proto_cmu.log)"
# v10.24 — 시안: 안심소개 축 주소 · 상담 줄(상세 보기 + 상담 신청) · 업종 상세 20종 · 신청서(/apply) · 접수 · 법률 · 세무 · 같이 고친 3장
KIT=$K python3 proto_fin.py > proto_fin.log 2>&1; r proto_fin "$(tail -1 proto_fin.log)"
# v10.25 — 시안: 소개몰(이름 · 두 관 전용 머리줄/바닥줄 · 메인 = 제시 디자인 · 누르기 전수 · 그림 바이트 비교 · 남기기로 한 10건 · 개발분 값 3건 · 머리줄/바닥줄 단추가 본체 화면으로)
python3 proto_mall.py > proto_mall.log 2>&1; r proto_mall "$(tail -1 proto_mall.log)"
# v10.26 — 시안: 상품 자료 고친 곳(자동완성 · 그림 글자 · 살 수 있는 옵션 단가 · p12/p17 · 반품 칸 · 안내 글 · 견본 주문 이름 · 교환 비용 결제 · 운영 「소개몰 상품」)
python3 proto_opt.py > proto_opt.log 2>&1; r proto_opt "$(tail -1 proto_opt.log)"
# v10.27 — 시안 결함(G-196 알림 · G-197 끊긴 링크 · G-198 주소 없던 화면 · G-199 글/숫자 · G-200 시연) · 구독 결제 ③
python3 fix_1027_proto.py > fix_1027_proto.log 2>&1; r fix_1027_proto "$(tail -1 fix_1027_proto.log)"
# v10.28 — 시안: 소개몰 리뷰 쓰기 · 별점 거르기 · 문의 · 구매확정 안내 · 순위 기준 · 운영 소개몰 주문 · 리뷰 · 문의 · 정산(개인) · 재동의 · 상담 이메일 · 파트너 연락처 이메일
python3 fix_1028_proto.py > fix_1028_proto.log 2>&1; r fix_1028_proto "$(tail -1 fix_1028_proto.log)"
# v10.30 — 시안: 소개장터 메인 = 제시 디자인(틀 · 글자 · 그림 53장 · 색 · 글꼴 · 누르기 전부 · 지금 있던 구역 · 로그인한 모습 · 다른 관 그대로 · 좁은 화면) + 그림 ↔ 시안 자리 대조 159곳
python3 proto_mny.py > proto_mny.log 2>&1; r proto_mny "$(tail -1 proto_mny.log)"
python3 shot_mny.py proto > measure_mny_proto.log 2>&1; python3 measure_mny.py proto >> measure_mny_proto.log 2>&1; r measure_mny_proto "$(tail -1 measure_mny_proto.log)"
# v10.27 G-130 — 「상세 · 보기」 단추가 화면을 엶(새 화면 8장 · 개발중 표시)
python3 g130_check.py > g130_check.log 2>&1; r g130_check "$(tail -1 g130_check.log)"
# 시연 보장 — 소개뱅크몰에서 이미 고른 갈래 단추를 눌러도 안내가 뜨는지(전수 누르기의 「무반응 1」로 드러난 것)
python3 proto_guard.py > proto_guard.log 2>&1; r proto_guard "$(tail -1 proto_guard.log)"
# 앞 판(v10.28)과 견줌 — 글자(proto_diff) · 모양(proto_pixel): 새 화면 0장 · 바뀌어야 할 1장(소개장터 메인 list)만 다르고 나머지는 같음(v1030_changes.py)
r proto_diff "$(python3 proto_diff.py 2>/dev/null | tail -1)"
r proto_pixel "$(python3 proto_pixel.py 2>/dev/null | tail -1)"
python3 sweep_hlt_after.py > sweep_hlt.log 2>&1; r sweep_hlt done
r proto_report "$(python3 build_proto_report.py 2>&1 | tail -2 | tr '\n' ' ' | cut -c1-200)"
echo PART-D-DONE >> "$OUTF"; [ -n "$RERUN" ] || echo ALLDONE >> "$OUTF" ;;
E)
# v10.25 점검 보강(2026-10-08) — 연동 · DB 연동 · 버튼 체크 · flow 점검.  A ~ D 가 끝난 뒤에 돕니다(검정 DB sgb_check · srv_proto.json · 준비 자료를 씁니다).
#   연동 테스트 · DB 연동 테스트: 연결 구간을 실제로 호출 · API 로 쓰고 DB 에서 확인 · 뷰 전부 조회 · 제약/트리거 거절 · 새 설치 DB 와 구조 비교
python3 db_link.py > db_link.log 2>&1; r db_link "$(tail -1 db_link.log)"
python3 link_check.py > link_check.log 2>&1; r link_check "$(tail -1 link_check.log)"
#   버튼 체크: 단추를 하나씩 누름(쓰기 요청은 서버에 닿기 전에 막음). 사용자 웹은 역할 5개를 같이, 운영 화면은 관리자 3갈래를 같이 돌린 뒤 나머지 계정을 차례로
#   v10.31 — 메모리 7GB · CPU 2 에서 다른 작업(시안 점검)과 브라우저를 나눠 쓰므로 하나씩 차례로
for x in guest person buyer intro admin; do python3 btn_site.py $x > btn_site_$x.log 2>&1; done
for x in 0 1 2; do python3 btn_bo.py admin@x.com $x/3 > btn_bo_admin_$x.log 2>&1; done
for u in ops@t.local reviewer@t.local payout@t.local member@t.local; do python3 btn_bo.py $u > btn_bo_${u%%@*}.log 2>&1; done
r btn_site "$(python3 btn_report.py site 2>&1 | tail -1)"
r btn_bo "$(python3 btn_report.py bo 2>&1 | tail -1)"
#   flow 점검: 주요 흐름을 처음부터 끝까지(화면 · 운영 화면 · API · DB). 시험이 만든 주문 · 글 · 설정은 스스로 되돌립니다. 계정(flw_*@t.local)은 남습니다
#   v10.40 — 앞 시험이 올리고 남긴 검수 건(V1036 ~ V1040)을 반려로 정리 — 검수 큐가 50건을 넘으면 flow_trade 가 방금 올린 건을 첫 쪽에서 못 찾음
python3 review_cleanup.py > review_cleanup.log 2>&1
for f in trade mall plaza biz proto; do python3 flow_$f.py > flow_$f.log 2>&1; r flow_$f "$(tail -1 flow_$f.log)"; done
echo PART-E-DONE >> "$OUTF" ;;
*) echo "사용: bash final_parts.sh A|B|C|D|E" ;;
esac
