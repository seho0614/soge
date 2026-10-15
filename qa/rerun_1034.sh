#!/bin/bash
cd /home/claude/qa
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 PYTHONPATH=/home/claude/qa/tools/offline_fonts
OUT=final_all_reruns_1034.txt
note(){ grep "^$1 —" /tmp/rerun_notes_1034.txt | head -1 | sed "s/^$1 — //"; }
echo "rerun start $(date +%H:%M)" > /tmp/rerun_1034.prog
python3 link_check.py > link_check.log 2>&1; echo "link_check: $(tail -1 link_check.log) — $(note link_check)" >> $OUT
echo "crawl_site: $(python3 crawl_sum.py | tail -1) — 요약(crawl_sum.py · 같은 회차)" >> $OUT
echo "crawl_admin: $(python3 crawl_admin_sum.py | tail -1) — 요약(crawl_admin_sum.py · 같은 회차)" >> $OUT
echo "RERUN-DONE $(date +%H:%M)" >> /tmp/rerun_1034.prog
