#!/bin/bash
# v10.31 — 마지막(6): 사용자 웹을 next build 로 다시 만들어 띄우고 crawl_site · btn_site(5역할) 한 번 더
cd /home/claude/qa
while ! grep -q RERUN-E-DONE final_all_reruns_1031.txt; do sleep 30; done
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 PYTHONPATH=/home/claude/qa/tools/offline_fonts
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
O=final_all_reruns_1031.txt
r() { echo "$1: $2 — $3" >> $O; echo "$1: $2"; }
bash site_up.sh > final_site_up.log 2>&1; BID=$(cat /home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/site/.next/BUILD_ID); T=$(date +%H:%M)
r site_build "$(tail -1 final_site_up.log)" "다시 빌드한 뒤(마지막 · $T · BUILD_ID $BID)"
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; r crawl_site "$(python3 crawl_sum.py | tail -1)" "다시 빌드한 뒤(마지막 · $T)"
for x in guest person buyer intro admin; do python3 btn_site.py $x > btn_site_$x.log 2>&1; done
r btn_site "$(python3 btn_report.py site 2>&1 | tail -1)" "다시 빌드한 뒤(마지막 · $T) · 시험을 고친 뒤(떠 있는 광고의 ✕ 가 세션 동안 숨김 — 다시 열 때 그 표시를 지움 · 접힌 <details> 안의 단추는 펼친 뒤 누름)"
echo FINAL-DONE >> $O
