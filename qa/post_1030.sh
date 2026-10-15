#!/bin/bash
# v10.30 — 전수 검정 뒤에 고친 것(소개장터 메인의 화면을 클라이언트 컴포넌트로 · 시험 도구 몇 곳)을 넣고, 소개장터 메인이 걸리는 시험을 다시 돌립니다.
#   결과는 final_all_reruns_1030.txt 에 「시험: 결과 — 까닭」으로 더합니다. 구글 글꼴 요청은 빈 응답으로(tools/offline_fonts — 인터넷이 막힌 환경).
cd /home/claude/qa; K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 PYTHONPATH=/home/claude/qa/tools/offline_fonts
W="소개장터 메인의 화면을 클라이언트 컴포넌트로 바꾼 뒤 다시"
r() { echo "$1: $2 — $3" >> final_all_reruns_1030.txt; echo "$1: $2"; }
python3 site_mny.py > site_mny.log 2>&1; r site_mny "$(tail -1 site_mny.log)" "$W"
API=http://localhost:3000 python3 web_main.py > web_main.log 2>&1; r web_main "$(tail -1 web_main.log)" "$W · 시험을 고친 뒤(로그인 직후 들르는 소개장터 메인의 광고 노출을 메인 광고 점검 전에 비움)"
API=http://localhost:3000 python3 web_mal.py > web_mal.log 2>&1; r web_mal "$(tail -1 web_mal.log)" "$W"
API=http://localhost:3000 python3 site_mall.py > site_mall.log 2>&1; r site_mall "$(tail -1 site_mall.log)" "$W · 시험을 고친 뒤(v10.29 에서 스크립트 글자 안에 들어간 주석 한 줄을 밖으로 — 그 줄 때문에 시험이 6단계에서 멈췄음)"
python3 srv_cmu_ui.py > srv_cmu_ui.log 2>&1; r srv_cmu_ui "$(tail -1 srv_cmu_ui.log)" "$W"
python3 fix_1026.py > fix_1026.log 2>&1; r fix_1026 "$(tail -1 fix_1026.log)" "$W"
r matrix "$(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb npm run matrix 2>&1 | tail -2 | tr '\n' ' ')" "$W"
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; r crawl_site "$(python3 crawl_sum.py site_final.json)" "$W"
python3 link_check.py > link_check.log 2>&1; r link_check "$(tail -1 link_check.log)" "$W"
for x in guest person buyer intro admin; do python3 btn_site.py $x > btn_site_$x.log 2>&1 & done; wait
r btn_site "$(python3 btn_report.py site 2>&1 | tail -1)" "$W · 시험을 고친 뒤(무작위로 바뀌는 광고 소재의 단추는 몇 번 더 열어 찾음)"
echo POST-DONE >> final_all_reruns_1030.txt
