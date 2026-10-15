#!/bin/bash
# v10.26 — 이번 판의 결과 파일을 킷의 qa/results_v10_26 로 모읍니다(문서 75 · 매트릭스의 수치가 여기서 나옵니다).
Q=/home/claude/qa; R=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa/results_v10_26
mkdir -p $R; cd $Q
cp final_all.txt $R/final_all_v1026.txt
[ -d $Q/results_v10_26 ] && cp $Q/results_v10_26/*.json $R/ 2>/dev/null
for f in srv_opt.json proto_opt.json fix_1026.json srv_mall.json site_mall.json proto_mall.json proto_pixel.json proto_diff.json srv_hlt_ui.json srv_proto.json srv_lead_ui.json \
         link_check.json db_link.json db_link_struct.json db_link_counts.json btn_site.json btn_bo.json flow_trade.json flow_mall.json flow_plaza.json flow_biz.json flow_proto.json findings_r2.json defects.json \
         admin_final.json fixtures.json e2e.json attack_pick.json \
         srv_opt_docker.json site_opt_docker.json proto_opt_docker.json srv_mall_docker.json site_mall_docker.json proto_mall_docker.json docker_1026.txt \
         ps_e2e_check.json ps_e2e_down.json ps_e2e_more.json ps_e2e_realcheck.json ps_e2e_status.json ps_e2e_up.json ps_lint.txt ps_native_test.json realcheck_ps_v1026.txt realcheck_fresh_v1026.log \
         aws_rehearsal.json aws_rehearsal_ops.json aws_rehearsal_precheck.txt aws_rehearsal_apply.txt aws_rehearsal_postcheck.txt aws_rehearsal_rollback.txt aws_rehearsal_run_v1026.log; do
  [ -f "$f" ] && cp "$f" $R/ || echo "없음: $f"
done
rm -f $R/*.png
cat > $R/README.txt <<'T'
v10.26 결과 폴더 — 전수 검정(final_all_v1026.txt · 다시 돌린 것은 「_rerun」 줄) · 새 시험(srv_opt · site_opt · proto_opt · fix_1026) · 확장 점검(연동 · DB 연동 · 버튼 · flow) · 발견 목록(findings_r2 · defects) · Docker(docker_1026.txt · *_docker.json) · PowerShell · 새로 설치 · 서버 적용 리허설.
비교 그림(반영 전 5장 · 반영 후 4장 · 시안 전후 2장)은 묶음 크기 한도(30MiB) 때문에 이 폴더에 넣지 않고 따로 전달했습니다. 다시 찍는 도구: qa/cmp_1026.py · qa/proto_cmp_1026.py
T
ls $R | wc -l
# 새로 설치(realcheck fresh) 위에서 돌린 소개몰 시험 · 마지막 통합 검정 기록 · Docker 통합 검정(./dev.ps1 check — CP949 를 UTF-8 로)
for f in srv_opt_fresh.json srv_mall_fresh.json verify_v1026_final.log; do [ -f "$Q/$f" ] && cp "$Q/$f" $R/; done
[ -f /tmp/dock_check.log ] && iconv -f cp949 -t utf-8 /tmp/dock_check.log > $R/docker_check_v1026.log
