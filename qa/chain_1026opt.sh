#!/bin/bash
# v10.26 반영 뒤 전수 검정 — A → B → C (D 는 따로 같이 돎) → D 가 끝나면 E
cd /home/claude/qa
bash final_parts.sh A > partA.log 2>&1
bash final_parts.sh B > partB.log 2>&1
bash final_parts.sh C > partC.log 2>&1
for i in $(seq 1 720); do grep -q PART-D-DONE final_all.txt && break; sleep 10; done
bash final_parts.sh E > partE.log 2>&1
echo CHAIN-DONE >> final_all.txt
