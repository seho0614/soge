#!/bin/bash
# G-94 (v10.27) — 수화 오류(#418)를 부하 속에서: 창 6개를 동시에 띄워 목록 화면 3곳을 30번씩(모두 540번) 새로 엽니다.
#   고치기 전(10/8 실측) /money/list 27/180 · /mall/list 20/180 · /partner/notices 10/180 → 고친 뒤 0 이어야 합니다.
cd /home/claude/qa; rm -f /tmp/hydl_*.log
for i in 1 2 3 4 5 6; do timeout 600 python3 hyd_pages.py guest:/money/list person:/partner/notices guest:/mall/list 30 > /tmp/hydl_$i.log 2>&1 & done; wait
t=$(cat /tmp/hydl_*.log | grep -c "오류"); e=$(cat /tmp/hydl_*.log | grep "오류" | sed -E 's/.*오류 ([0-9]+) \/.*/\1/' | paste -sd+ | bc)
cat /tmp/hydl_*.log | grep "오류" > hyd_load.txt
[ "$e" = "0" ] && [ "$t" = "18" ] && echo "통과 — 오류 0 / 540 (창 6개 동시 · 3곳 × 180)" || echo "실패 — 오류 $e / 540 · 결과 줄 $t/18"
