#!/bin/bash
# v10.24 — 이번 판의 결과 파일을 킷의 qa/results_v10_24 로 모읍니다(문서 72 · 매트릭스의 수치가 여기서 나옵니다).
Q=/home/claude/qa; R=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa/results_v10_24
mkdir -p $R; cd $Q
cp final_all.txt $R/final_all_v1024.txt; cp final_all_first_v1024.txt $R/ 2>/dev/null
for f in srv_fin.json srv_fin_docker.json srv_fin_ui.json srv_fin_ui_docker.json proto_fin.json proto_fin_docker.json proto_pixel.json proto_diff.json fin_matrix.json \
         srv_lead.json srv_lead_ui.json srv_consult_ui.json web_mal.json \
         proto_cmu.json proto_lang.json proto_item.json proto_poll.json proto_detail.json proto_urg.json proto_axis.json proto_guard.json proto_consult.json attack_pick.json \
         docker_1024.txt \
         ps_e2e_check.json ps_e2e_down.json ps_e2e_more.json ps_e2e_realcheck.json ps_e2e_status.json ps_e2e_up.json ps_lint.txt ps_native_test.json realcheck_ps_v1024.txt realcheck_fresh_v1024.log \
         aws_rehearsal.json aws_rehearsal_ops.json aws_rehearsal_precheck.txt aws_rehearsal_apply.txt aws_rehearsal_postcheck.txt aws_rehearsal_rollback.txt aws_rehearsal_run_v1024.log; do
  [ -f "$f" ] && cp "$f" $R/ || echo "없음: $f"
done
# 비교 그림(나란히 붙인 7장 · 2.1MiB)은 킷에 넣지 않습니다 — 넣으면 묶음이 31.8MiB 가 되어 대화로 전달할 수 있는 한도(30MiB)를 넘습니다. 따로 전달합니다(생활금융_v10.24_1 … 7.png).
#   다시 찍으려면: API=http://localhost:3000 python3 shot_fin_final.py
rm -f $R/생활금융_v10.24_*.png
cat > $R/README.txt <<'T'
v10.24 결과 폴더 — 전수 검정(final_all_v1024.txt · 첫 실행 final_all_first_v1024.txt) · 새 시험 결과(srv_fin · srv_fin_ui · proto_fin · fin_matrix) · Docker(docker_1024.txt · *_docker.json) · PowerShell · 새로 설치 · 서버 적용 리허설.
비교 그림(시안 ↔ 개발분 7장 · 반영 전 9장)은 묶음 크기 한도(30MiB) 때문에 이 폴더에 넣지 않고 따로 전달했습니다. 다시 찍는 도구: qa/shot_fin_final.py
T
ls $R | wc -l
