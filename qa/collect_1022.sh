#!/bin/bash
# v10.22 — 이번 판의 결과 파일을 킷의 qa/results_v10_22 로 모읍니다(문서 70 · 매트릭스의 수치가 여기서 나옵니다).
Q=/home/claude/qa; R=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa/results_v10_22
mkdir -p $R; cd $Q
cp final_all.txt $R/final_all_v1022.txt
for f in proto_axis.json proto_axis_docker.json proto_axis_job.png proto_axis_svc.png proto_axis_pol.png proto_axis_edu.png proto_axis_list_jobs.png proto_axis_list_advisory.png proto_axis_list_info.png \
         proto_lang.json proto_lang_docker.json proto_lang_header.png proto_lang_login.png proto_pixel.json proto_pixel_listb_old.png proto_pixel_listb_new.png \
         proto_diff.json proto_guard.json proto_guard_docker.json attack_pick.json proto_item.json proto_item_docker.json proto_urg.json proto_urg_docker.json proto_detail.json proto_detail_docker.json \
         srv_detail_docker.json site_detail_docker.json docker_1022.txt biz_axes.json \
         srv_lead_ui_first.json srv_retship_first.json srv_lead_ui_rerun.log srv_retship_rerun.log srv_proto_rerun.log \
         ps_e2e_check.json ps_e2e_down.json ps_e2e_more.json ps_e2e_realcheck.json ps_e2e_status.json ps_e2e_up.json ps_lint.txt ps_native_test.json realcheck_ps_v1022.txt realcheck_fresh_v1022.log \
         aws_rehearsal.json aws_rehearsal_ops.json aws_rehearsal_precheck.txt aws_rehearsal_apply.txt aws_rehearsal_postcheck.txt aws_rehearsal_rollback.txt aws_rehearsal_run_v1022.log; do
  [ -f "$f" ] && cp "$f" $R/ || echo "없음: $f"
done
ls $R | wc -l
