#!/bin/bash
# 수정 뒤 전수 검정을 마지막 코드로 처음부터 — A → B → C, 그리고 D(따로 돌고 있음)와 C 가 끝나면 E
cd /home/claude/qa
bash final_parts.sh A > partA.log 2>&1
bash final_parts.sh B > partB.log 2>&1
bash final_parts.sh C > partC.log 2>&1
for i in $(seq 1 360); do grep -q PART-D-DONE final_all.txt && break; sleep 10; done
bash final_parts.sh E > partE.log 2>&1
echo CHAIN-DONE >> final_all.txt
