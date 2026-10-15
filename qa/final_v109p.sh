#!/bin/bash
# v10.9 시안 반영 뒤 최종 검정
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
cd /home/claude/qa; : > final_v109p.txt
r(){ echo "$1: $2" | tee -a final_v109p.txt; }
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check timeout 900 npm run verify > /tmp/verify.log 2>&1); r verify "exit=$? $(grep -E '^통과 [0-9]+ / 실패' /tmp/verify.log | head -1) | $(grep -E '뚫림' /tmp/verify.log | head -1) | $(grep 'SQL 대조' /tmp/verify.log)"
r matrix "$(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb npm run matrix 2>&1 | tail -2 | tr '\n' ' ')"
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173
for s in srv_proto e2e srv_retship srv_refcode srv_refcode_ui csrf_check web_main web_mal srv_hlt_ui; do python3 $s.py > $s.log 2>&1; r $s "$(tail -1 $s.log)"; done
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; r crawl_site done
python3 crawl_admin_final.py > final_admin.log 2>&1; r crawl_admin done
python3 sweep_proto.py > sweep_proto.log 2>&1; r sweep_proto done
python3 sweep_hlt_after.py > sweep_hlt.log 2>&1; r sweep_hlt done
echo ALLDONE >> final_v109p.txt
