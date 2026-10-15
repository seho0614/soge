#!/bin/bash
# v10.31 마지막 정리(이어받음) — final_1031.sh 의 crawl_site 가 끝나면 그 사슬을 멈추고(btn_site 는 아래에서 다시) 한 번에 하나씩:
#   flow_trade · flow_plaza · flow_biz(시험을 고친 것) → proto_pixel(바뀌어야 할 화면 목록) → btn_site 5역할
cd /home/claude/qa
while ! grep -q "^crawl_site: .*마지막" final_all_reruns_1031.txt; do sleep 15; done
pkill -f "bash final_1031.sh"; sleep 1; pkill -f "btn_site.py"; sleep 3
source /home/claude/work/verify/env.sh; export PYTHONPATH=/home/claude/qa/tools/offline_fonts
O=seq_1031f.out
for f in trade plaza biz; do python3 flow_$f.py > flow_$f.log 2>&1; echo "flow_$f: $(tail -1 flow_$f.log)" >> $O; done
echo "proto_pixel: $(python3 proto_pixel.py 2>/dev/null | tail -1)" >> $O
echo FLOWS-DONE >> $O
for x in guest person buyer intro admin; do python3 btn_site.py $x > btn_site_$x.log 2>&1; done
echo "btn_site: $(python3 btn_report.py site 2>&1 | tail -1)" >> $O
echo SEQ-DONE >> $O
