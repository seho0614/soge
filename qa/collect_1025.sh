#!/bin/bash
# v10.25 — 이번 판의 결과 파일을 킷의 qa/results_v10_25 로 모읍니다(문서 73 · 매트릭스의 수치가 여기서 나옵니다).
Q=/home/claude/qa; R=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa/results_v10_25
mkdir -p $R; cd $Q
cp final_all.txt $R/final_all_v1025.txt; cp final_all_first_v1025.txt $R/ 2>/dev/null
for f in srv_mall.json srv_mall_docker.json site_mall.json site_mall_docker.json proto_mall.json proto_mall_docker.json proto_pixel.json proto_diff.json \
         srv_hlt.json srv_hlt_ui.json srv_retship.json srv_cmu_ui.json fixtures.json \
         proto_cmu.json proto_lang.json proto_item.json proto_poll.json proto_detail.json proto_urg.json proto_axis.json proto_guard.json proto_consult.json proto_fin.json attack_pick.json \
         docker_1025.txt \
         ps_e2e_check.json ps_e2e_down.json ps_e2e_more.json ps_e2e_realcheck.json ps_e2e_status.json ps_e2e_up.json ps_lint.txt ps_native_test.json realcheck_ps_v1025.txt realcheck_fresh_v1025.log \
         aws_rehearsal.json aws_rehearsal_ops.json aws_rehearsal_precheck.txt aws_rehearsal_apply.txt aws_rehearsal_postcheck.txt aws_rehearsal_rollback.txt aws_rehearsal_run_v1025.log aws_rehearsal_run_v1025_first.log hyd_pages_v1025.json hyd_pages_v1025_buyer.txt srv_proto.json srv_consult_ui.json web_mal.json site_tz.json; do
  [ -f "$f" ] && cp "$f" $R/ || echo "없음: $f"
done
# 비교 그림(시안 ↔ 개발분 4장 · 반영 전 4장)은 킷에 넣지 않습니다 — 묶음 크기 한도(30MiB) 때문에 따로 전달합니다. 다시 찍는 도구: qa/cmp_mall_dump.py · qa/cmp_mall_sheet.py
rm -f $R/소개몰_*.png
cat > $R/README.txt <<'T'
v10.25 결과 폴더 — 전수 검정(final_all_v1025.txt · 첫 실행 final_all_first_v1025.txt) · 새 시험 결과(srv_mall · site_mall · proto_mall · proto_pixel · proto_diff) · Docker(docker_1025.txt · *_docker.json) · PowerShell · 새로 설치 · 서버 적용 리허설.
비교 그림(시안 ↔ 개발분)은 묶음 크기 한도(30MiB) 때문에 이 폴더에 넣지 않고 따로 전달했습니다. 다시 찍는 도구: qa/cmp_mall_dump.py · qa/cmp_mall_sheet.py
T
ls $R | wc -l
