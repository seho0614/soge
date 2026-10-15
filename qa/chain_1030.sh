#!/bin/bash
# v10.30 전수 검정 — D(시안)는 따로 돌고, A → B → C 가 끝나고 D 도 끝나면 E
cd /home/claude/qa
bash final_parts.sh A > partA.log 2>&1
( RERUN=1 bash final_parts.sh D > partD.log 2>&1 ) &
bash final_parts.sh B > partB.log 2>&1
bash final_parts.sh C > partC.log 2>&1
for i in $(seq 1 720); do grep -q PART-D-DONE final_all.txt && break; sleep 10; done
bash final_parts.sh E > partE.log 2>&1
echo CHAIN-DONE >> final_all.txt
