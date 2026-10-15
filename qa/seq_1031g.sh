#!/bin/bash
# v10.31 마지막 빌드(성사 확정 고침 15ea55e 뒤 · next build) 위에서 한 번에 하나씩: flow 3 · 모든 페이지(crawl_site) · 버튼 체크(btn_site 5역할)
cd /home/claude/qa
source /home/claude/work/verify/env.sh; export PYTHONPATH=/home/claude/qa/tools/offline_fonts
O=seq_1031g.out
for f in mall plaza proto; do python3 flow_$f.py > flow_$f.log 2>&1; echo "flow_$f: $(tail -1 flow_$f.log)" >> $O; done
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; echo "crawl_site: $(python3 crawl_sum.py | tail -1)" >> $O
for x in guest person buyer intro admin; do python3 btn_site.py $x > btn_site_$x.log 2>&1; echo "btn_site_$x: $(tail -1 btn_site_$x.log | cut -c1-120)" >> $O; done
echo "btn_site: $(python3 btn_report.py site 2>&1 | tail -1)" >> $O
echo SEQ-G-DONE >> $O
