#!/bin/bash
# v10.34 전수 검정 — 구간별로 이어서 돌릴 수 있게(작업 환경 재시작 대비): /tmp/run_1036.prog 에 「== X done」 이 있는 구간은 건너뜀
cd /home/claude/qa
P=/tmp/run_1036.prog
for X in A B C E; do
  grep -q "== $X done" $P 2>/dev/null && continue
  echo "== $X start $(date +%H:%M)" >> $P
  if [ "$X" = "A" ]; then bash final_parts.sh A > /tmp/part_A.out 2>&1; else RERUN= bash final_parts.sh $X > /tmp/part_$X.out 2>&1; fi
  echo "== $X done $(date +%H:%M)" >> $P
done
if ! grep -q "== SWEEP done" $P; then
  export PROTO=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb/spec/proto.html
  python3 sweep_proto.py > sweep_proto.log 2>&1; echo "sweep_proto: done" >> final_all.txt
  echo "proto_report: $(python3 build_proto_report.py 2>&1 | tail -2 | tr '\n' ' ' | cut -c1-200)" >> final_all.txt
  echo "== SWEEP done $(date +%H:%M)" >> $P
fi
echo "== ALL done $(date +%H:%M)" >> $P
