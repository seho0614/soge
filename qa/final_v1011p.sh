#!/bin/bash
# v10.11 — 전수 검정(final_all.sh) 뒤에 고친 것(입점 상태 화면 안내 · 안내 상자 색 · 신청 폼 호출 표기)을 넣고 다시 검정
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
cd /home/claude/qa; : > final_v1011p.txt
r(){ echo "$1: $2" | tee -a final_v1011p.txt; }
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check timeout 900 npm run verify > /tmp/verify.log 2>&1); r verify "exit=$? $(grep -E '^통과 [0-9]+ / 실패' /tmp/verify.log | head -1) | $(grep -E '뚫림' /tmp/verify.log | head -1) | $(grep 'SQL 대조' /tmp/verify.log)"
r matrix "$(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb npm run matrix 2>&1 | tail -2 | tr '\n' ' ')"
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173
for s in e2e srv_proto srv_consult srv_consult_ui srv_lead_ui srv_ptn_ui srv_pay_ui srv_refcode_ui csrf_check web_main web_mal; do python3 $s.py > $s.log 2>&1; r $s "$(tail -1 $s.log)"; done
bash adapters_up.sh > adapters.log 2>&1
API=http://localhost:3000 ADP=http://localhost:3123 KIT=$K CHECK_DB=postgresql://sgb:sgb@localhost:5432/sgb_check python3 srv_lead.py > srv_lead.log 2>&1; r srv_lead "$(tail -1 srv_lead.log)"
bash adapters_down.sh >> adapters.log 2>&1
python3 api_smoke.py > final_smoke.log 2>&1; r smoke "$(tail -1 final_smoke.log)"
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; r crawl_site done
python3 crawl_admin_final.py > final_admin.log 2>&1; r crawl_admin done
echo ALLDONE >> final_v1011p.txt
