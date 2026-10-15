#!/bin/bash
# v10.39 — 다시 돌림: 작업 환경이 다시 시작돼 운영 화면(5173)이 내려가 있던 동안 돈 A · B 구간 화면 시험(운영 화면을 띄운 뒤 같은 명령으로)
cd /home/claude/qa
O=final_all_reruns_1039.txt
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
export PYTHONPATH=/home/claude/qa/tools/offline_fonts
N=" — 환경을 고친 뒤 다시 돌림(작업 환경 재시작으로 운영 화면 5173 이 내려가 있었음 · 띄운 뒤 같은 명령)"
( unset API SITE BO; python3 decisions_ui.py > final_decisions_ui.log 2>&1; echo "decisions_ui: $(tail -1 final_decisions_ui.log)$N" >> $O )
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173
for s in srv_aff_ui srv_hlt_ui srv_ptn_ui ui_adm_v1032 test_v1036; do python3 $s.py > $s.log 2>&1; echo "$s: $(tail -1 $s.log)$N" >> $O; done
bash adapters_up.sh > adapters.log 2>&1
for s in srv_pay_ui srv_file_ui srv_lead_ui srv_consult_ui; do python3 $s.py > $s.log 2>&1; echo "$s: $(tail -1 $s.log)$N" >> $O; done
bash adapters_down.sh >> adapters.log 2>&1
for s in srv_retship srv_viewlimit srv_poll_ui; do python3 $s.py > $s.log 2>&1; echo "$s: $(tail -1 $s.log)$N" >> $O; done
echo RERUN-DONE >> /tmp/rerun_1039.done
