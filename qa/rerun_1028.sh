#!/bin/bash
# v10.28 — 전수 검정(chain_1028.sh) 뒤 고친 것(G-218 위탁 = 알림 · D042 · G-220 · 기대값 맞춤) 반영해 다시 돌림. 결과: final_all_reruns_1028.txt
#   A 의 검정 DB(sgb_check)는 새로 만들어 verify(통합 · 공격 검정) · D(시안 전수)는 따로 · 그동안 B/C 의 해당 시험 · 끝나면 E(연동 · 단추 · flow)
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
cd /home/claude/qa
export OUTF=final_all_reruns_1028.txt
r(){ echo "$1: $2" | tee -a "$OUTF"; }
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
: > "$OUTF"
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS sgb_check' -c 'CREATE DATABASE sgb_check OWNER sgb'" >/dev/null 2>&1
(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check timeout 900 npm run verify > /tmp/verify.log 2>&1); r verify "exit=$? $(grep -E '^통과 [0-9]+ / 실패' /tmp/verify.log | head -1) | $(grep -E '뚫림' /tmp/verify.log | head -1) | $(grep 'SQL 대조' /tmp/verify.log)"
r matrix "$(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb npm run matrix 2>&1 | tail -2 | tr '\n' ' ')"
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173
( RERUN=1 bash final_parts.sh D > partD_r.log 2>&1 ) &
API=http://localhost:3000 ADP=http://localhost:3123 KIT=$K CHECK_DB=postgresql://sgb:sgb@localhost:5432/sgb_check python3 srv_lead.py > srv_lead.log 2>&1; r srv_lead "$(tail -1 srv_lead.log)"
KIT=$K python3 srv_mall.py > srv_mall.log 2>&1; r srv_mall "$(tail -1 srv_mall.log)"
python3 site_mall.py > site_mall.log 2>&1; r site_mall "$(tail -1 site_mall.log)"
python3 fix_1026.py > fix_1026.log 2>&1; r fix_1026 "$(tail -1 fix_1026.log)"
python3 fix_1027b.py > fix_1027b.log 2>&1; r fix_1027b "$(tail -1 fix_1027b.log)"
python3 fix_1027b_ui.py > fix_1027b_ui.log 2>&1; r fix_1027b_ui "$(tail -1 fix_1027b_ui.log)"
python3 fix_1028.py > fix_1028.log 2>&1; r fix_1028 "$(tail -1 fix_1028.log)"
python3 fix_1028_ui.py > fix_1028_ui.log 2>&1; r fix_1028_ui "$(tail -1 fix_1028_ui.log)"
for i in $(seq 1 720); do grep -q PART-D-DONE "$OUTF" && break; sleep 10; done
bash final_parts.sh E > partE_r.log 2>&1
echo RERUN-DONE >> "$OUTF"
