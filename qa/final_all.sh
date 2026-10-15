#!/bin/bash
# 최종 전수 검정 — 순서대로 돌리고 결과 한 줄씩 남깁니다
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
cd /home/claude/qa; : > final_all.txt
r(){ echo "$1: $2" | tee -a final_all.txt; }
# v10.16 — 3000 의 API 는 **운영 방식**(bash api_dist.sh — tsc 로 빌드한 dist/main.js · 정의에 없는 입력은 400 · /docs 없음)으로 띄워 둡니다
r api_mode "/docs → $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/docs) (404 = 운영 방식 dist/main.js · 200 = 개발 서버)"
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check timeout 900 npm run verify > /tmp/verify.log 2>&1); r verify "exit=$? $(grep -E '^통과 [0-9]+ / 실패' /tmp/verify.log | head -1) | $(grep -E '뚫림' /tmp/verify.log | head -1) | $(grep 'SQL 대조' /tmp/verify.log)"
r ads "$(ADS_DB=postgresql://sgb:sgb@localhost:5432/sgb_ads PGDATABASE= bash $K/../sgb-ads/scripts/verify-ads.sh 2>&1 | tail -1)"
r matrix "$(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb npm run matrix 2>&1 | tail -2 | tr '\n' ' ')"
# v10.13 — 시험 준비 자료(새로 만든 DB 에서는 몇몇 점검의 전제 자료가 없습니다 · fixtures.py 머리말). 여러 번 돌려도 같습니다
API=http://localhost:3000/api/v1 python3 fixtures.py > fixtures.log 2>&1; r fixtures "$(tail -1 fixtures.log)"
for s in e2e decisions decisions_ui fixes_1002; do python3 $s.py > final_$s.log 2>&1; r $s "$(tail -1 final_$s.log)"; done
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173
for s in srv_aff srv_hlt srv_ptn srv_aff_ui srv_hlt_ui srv_ptn_ui srv_proto; do python3 $s.py > $s.log 2>&1; r $s "$(tail -1 $s.log)"; done
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
# 10/2 사용자 웹 반영 (새 메인 · 안심소개 상담 축)
# v10.13 — 메인 「hero 페이지」 디자인: 기본(그림 내용 그대로 · 5174) + 실제 자료로 켠 인스턴스(HOME_CONTENT=live · 5176 · 떠 있을 때만)
python3 web_main.py > web_main.log 2>&1; r web_main "$(tail -1 web_main.log)"; cp web_main.json web_main_sample.json 2>/dev/null; for f in web_main_*_1280.png web_main_*_390.png; do case "$f" in *_sample_*|*_live_*) ;; *) [ -f "$f" ] && cp "$f" "${f/web_main_/web_main_sample_}";; esac; done
if curl -s -o /dev/null --max-time 3 http://localhost:5176/; then SITE=http://localhost:5176 python3 web_main.py > web_main_live.log 2>&1; r web_main_live "$(tail -1 web_main_live.log)"; cp web_main.json web_main_live.json; cp web_main_sample.json web_main.json; else r web_main_live "건너뜀 — 5176 에 live 인스턴스가 없습니다"; fi
# v10.13 — 메인을 여러 번 새로 열어 수화 오류(React #418)가 한 번도 없는지 (드물게 나는 오류라 한두 번으로는 안 보입니다)
python3 hyd_home.py > hyd_home.log 2>&1; r hyd_home "$(tail -1 hyd_home.log)"
# v10.13 — 1280px 에서 각 구역이 주신 그림과 같은 자리에 있는지(±12px)
python3 measure_home.py > measure_home.log 2>&1; r measure_home "$(tail -1 measure_home.log)"
python3 web_mal.py > web_mal.log 2>&1; r web_mal "$(tail -1 web_mal.log)"
python3 api_smoke.py > final_smoke.log 2>&1; r smoke "$(tail -1 final_smoke.log)"
r pagetest "$(python3 pagetest.py 2>&1 | tail -3 | tr '\n' ' ')"
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; r crawl_site done
python3 crawl_admin_final.py > final_admin.log 2>&1; r crawl_admin done
python3 sweep_proto.py > sweep_proto.log 2>&1; r sweep_proto done
# v10.12 — 시안의 상담 축 · 월 노출료 기준 금액(D020) 시연 점검
python3 proto_consult.py > proto_consult.log 2>&1; r proto_consult "$(tail -1 proto_consult.log)"
# v10.13 — 시안 새 메인(「hero 페이지」 디자인)
python3 proto_main.py > proto_main.log 2>&1; r proto_main "$(tail -1 proto_main.log)"
# v10.14 — 시안: 투표 · 사회관계망 · 지급 데스크 · 리드 배정 화면 + 이전 판(v10.13)과 화면마다 비교
python3 proto_poll.py > proto_poll.log 2>&1; r proto_poll "$(tail -1 proto_poll.log)"
# v10.16 — 시안은 화면 변화가 없습니다: 제목 · 파일 이름을 빼면 v10.15 와 글자 하나 다르지 않은지
r proto_same "$(python3 proto_same.py 2>/dev/null | tail -1)"
python3 sweep_hlt_after.py > sweep_hlt.log 2>&1; r sweep_hlt done
r proto_report "$(python3 build_proto_report.py 2>&1 | tail -2 | tr '\n' ' ' | cut -c1-200)"
echo ALLDONE >> final_all.txt
