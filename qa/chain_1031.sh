#!/bin/bash
# v10.31 전수 검정 — A → B → C → E 차례로(메모리 7GB · CPU 2 · 시안 점검 작업과 브라우저를 나눠 씀 → 한 번에 하나).
#   D(시안)는 시안 작업이 끝난 뒤 따로: PROTO=/home/claude/work/v3/proto/SGB_Prototype_v10_31.html RERUN=1 bash final_parts.sh D
cd /home/claude/qa
bash final_parts.sh A > partA.log 2>&1
bash final_parts.sh B > partB.log 2>&1
bash final_parts.sh C > partC.log 2>&1
bash final_parts.sh E > partE.log 2>&1
echo CHAIN-ABCE-DONE >> final_all.txt
