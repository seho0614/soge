#!/bin/bash
# v10.23 — 이번 판의 결과 파일을 킷의 qa/results_v10_23 로 모읍니다(문서 71 · 매트릭스의 수치가 여기서 나옵니다).
Q=/home/claude/qa; R=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa/results_v10_23
mkdir -p $R; cd $Q
cp final_all.txt $R/final_all_v1023.txt; cp final_all_first_v1023.txt $R/ 2>/dev/null
for f in srv_cmu.json srv_cmu_docker.json srv_cmu_ui.json srv_cmu_ui_docker.json proto_cmu.json proto_cmu_docker.json proto_pixel.json proto_diff.json \
         proto_lang.json proto_item.json proto_poll.json proto_detail.json proto_urg.json proto_axis.json proto_guard.json attack_pick.json \
         b2_assets.json cut_b2_check.txt docker_1023.txt \
         ps_e2e_check.json ps_e2e_down.json ps_e2e_more.json ps_e2e_realcheck.json ps_e2e_status.json ps_e2e_up.json ps_lint.txt ps_native_test.json realcheck_ps_v1023.txt realcheck_fresh_v1023.log \
         aws_rehearsal.json aws_rehearsal_ops.json aws_rehearsal_precheck.txt aws_rehearsal_apply.txt aws_rehearsal_postcheck.txt aws_rehearsal_rollback.txt aws_rehearsal_run_v1023.log; do
  [ -f "$f" ] && cp "$f" $R/ || echo "없음: $f"
done
# 비교 그림은 나란히 붙인 8장만 넣습니다(낱장 28장은 넣지 않음 — 묶음이 30MiB 를 넘어 대화로 전달되지 않았음)
for f in /home/claude/design_1007/cmp23/final/소개광장_v10.23_비교_*.png; do [ -f "$f" ] && cp "$f" $R/; done
ls $R | wc -l
