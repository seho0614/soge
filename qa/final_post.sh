#!/bin/bash
# 10/2 2차 수정(CSRF 같은 출처 · 한국 날짜) 뒤 다시 검정
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
cd /home/claude/qa; : > final_post.txt
r(){ echo "$1: $2" | tee -a final_post.txt; }
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check timeout 900 npm run verify > /tmp/verify.log 2>&1); r verify "exit=$? $(grep -E '^통과 [0-9]+ / 실패' /tmp/verify.log | head -1) | $(grep -E '뚫림' /tmp/verify.log | head -1) | $(grep 'SQL 대조' /tmp/verify.log)"
r matrix "$(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb npm run matrix 2>&1 | tail -2 | tr '\n' ' ')"
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173
python3 csrf_check.py > csrf_check.log 2>&1; r csrf "$(tail -1 csrf_check.log)"
for s in e2e srv_aff srv_hlt web_main web_mal srv_file_ui srv_lead_ui srv_aff_ui srv_hlt_ui srv_ptn_ui decisions_ui; do python3 $s.py > $s.log 2>&1; r $s "$(tail -1 $s.log)"; done
r pagetest "$(python3 pagetest.py 2>&1 | tr '\n' ' ')"
python3 crawl_admin_final.py > final_admin.log 2>&1; r crawl_admin done
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; r crawl_site done
echo ALLDONE >> final_post.txt
