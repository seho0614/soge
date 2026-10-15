#!/bin/bash
# v10.26 전수 검정 뒤 다시 돌리기 — 검정 중에 고친 것(D030 · 시안 G-206 · 시험 갱신) 뒤 마지막 코드로.  결과는 final_all.txt 에 「_rerun」 줄로
cd /home/claude/qa
r(){ echo "$1: $2" | tee -a final_all.txt; }
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173
r verify_rerun "$(grep -E '^통과 [0-9]+ / 실패' /tmp/verify2.log | head -1) | $(grep -E '뚫림' /tmp/verify2.log | head -1) | $(grep 'SQL 대조' /tmp/verify2.log) | $(grep -c '전체 검증 통과' /tmp/verify2.log) (새 검정 DB · D030 뒤)"
python3 db_link.py > db_link.log 2>&1; r db_link_rerun "$(tail -1 db_link.log)"
python3 srv_proto.py > srv_proto.log 2>&1; r srv_proto_rerun "$(tail -1 srv_proto.log)"
python3 srv_lead_ui.py > srv_lead_ui.log 2>&1; r srv_lead_ui_rerun "$(tail -1 srv_lead_ui.log)"
python3 flow_biz.py > flow_biz.log 2>&1; r flow_biz_rerun "$(tail -1 flow_biz.log)"
echo RERUN-1-DONE >> final_all.txt
RERUN=1 bash final_parts.sh D > partD2.log 2>&1
echo RERUN-DONE >> final_all.txt
