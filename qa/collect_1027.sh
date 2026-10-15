#!/bin/bash
# v10.27 — 이번 판의 결과 파일을 킷의 qa/results_v10_27 로 모읍니다(문서 76 · 매트릭스의 수치가 여기서 나옵니다).
#   전수 검정(chain_1027.sh)이 끝난 뒤에 돌립니다 — 돌고 있으면 멈춥니다(FORCE=1 이면 그래도 모음).
#   그림은 묶음 크기 한도(30MiB) 때문에 작은 것만 넣습니다 — 한 장 PNG_MAX_KB(기본 1024) 이하 · 모두 PNG_BUDGET_KB(기본 2048) 안 · 전후 비교 그림 먼저.
Q=/home/claude/qa; R=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa/results_v10_27
PNG_MAX_KB=${PNG_MAX_KB:-1024}; PNG_BUDGET_KB=${PNG_BUDGET_KB:-2048}
if [ -z "$FORCE" ] && pgrep -f chain_1027.sh >/dev/null; then echo "전수 검정(chain_1027.sh)이 아직 돕니다 — 끝난 뒤에 다시(FORCE=1 이면 그래도 모음)"; exit 1; fi
mkdir -p $R $R/logs; cd $Q
cp final_all.txt $R/final_all_v1027.txt
[ -f final_all_reruns_1027.txt ] && cp final_all_reruns_1027.txt $R/
[ -d $Q/results_v10_27 ] && cp $Q/results_v10_27/*.json $R/ 2>/dev/null
# 결과 JSON · 글 — 이번 판의 새 시험 · 앞 판과 비교 · G-114(srv_billing) · flow · 수화 오류 부하 · 확장 점검 · 발견 목록 · Docker · PowerShell · 리허설
for f in fix_1027.json fix_1027b.json fix_1027b_ui.json fix_1027c.json fix_1027_proto.json g130/g130_check.json proto_diff.json proto_pixel.json srv_billing.json srv_billing_ui.json \
         flow_trade.json flow_mall.json flow_plaza.json flow_biz.json flow_proto.json hyd_pages.json hyd_load.txt \
         srv_opt.json site_opt.json proto_opt.json fix_1026.json srv_mall.json site_mall.json proto_mall.json srv_hlt_ui.json srv_proto.json srv_lead_ui.json \
         link_check.json db_link.json db_link_struct.json db_link_counts.json btn_site.json btn_bo.json findings_r2.json defects.json \
         admin_final.json site_final.json fixtures.json e2e.json attack_pick.json api_smoke.json \
         fix_1027_docker.json fix_1027b_docker.json fix_1027b_ui_docker.json fix_1027c_docker.json fix_1027_proto_docker.json g130_check_docker.json fix_1027_fresh.json fix_1027b_fresh.json fix_1027b_ui_fresh.json fix_1027c_fresh.json docker_1027.txt ps_chain_1027.out \
         ps_e2e_check.json ps_e2e_down.json ps_e2e_more.json ps_e2e_realcheck.json ps_e2e_status.json ps_e2e_up.json ps_lint.txt ps_native_test.json realcheck_ps_v1027.txt realcheck_fresh_v1027.log \
         aws_rehearsal.json aws_rehearsal_ops.json aws_rehearsal_precheck.txt aws_rehearsal_apply.txt aws_rehearsal_postcheck.txt aws_rehearsal_rollback.txt aws_rehearsal_run_v1027.log; do
  [ -f "$f" ] && cp "$f" $R/ || echo "없음: $f"
done
# 전수 검정 기록(final_parts.sh 가 남기는 로그 · 구간 로그 · 통합 검정 로그)
for f in partA.log partB.log partC.log partD.log partE.log fixtures.log final_e2e.log final_decisions.log final_decisions_ui.log final_fixes_1002.log \
         srv_aff.log srv_hlt.log srv_ptn.log srv_aff_ui.log srv_hlt_ui.log srv_ptn_ui.log srv_proto.log adapters.log srv_pay.log srv_pay_ui.log srv_file.log srv_file_ui.log \
         srv_lead.log srv_lead_ui.log srv_consult.log srv_consult_ui.log srv_retship.log srv_refcode.log srv_refcode_ui.log srv_viewlimit.log csrf_check.log srv_poll.log srv_poll_ui.log \
         srv_billing.log srv_billing_ui.log srv_detail.log srv_cmu.log srv_cmu_ui.log srv_fin.log srv_fin_ui.log srv_mall.log site_mall.log fix_1026.log srv_opt.log site_opt.log \
         fix_1027.log fix_1027b.log fix_1027b_ui.log fix_1027c.log \
         web_main.log web_main_live.log hyd_home.log measure_home.log web_mal.log site_tz.log site_detail.log final_smoke.log final_site.log final_admin.log \
         sweep_proto.log proto_consult.log proto_main.log proto_poll.log proto_bill.log proto_urg.log proto_detail.log proto_item.log proto_axis.log proto_lang.log proto_cmu.log \
         proto_fin.log proto_mall.log proto_opt.log fix_1027_proto.log g130_check.log proto_guard.log sweep_hlt.log \
         db_link.log link_check.log flow_trade.log flow_mall.log flow_plaza.log flow_biz.log flow_proto.log; do
  [ -f "$f" ] && cp "$f" $R/logs/ || echo "없음(로그): $f"
done
for f in btn_site_*.log btn_bo_*.log; do [ -f "$f" ] && cp "$f" $R/logs/; done
[ -f /tmp/verify.log ] && cp /tmp/verify.log $R/logs/verify_v1027.log
# 그림 — G-130 전후 · G-137 견본 그림 전후(작은 것만 · 비교 그림 먼저)
rm -f $R/*.png; rm -rf $R/g130 $R/g137; used=0; skipped=""
for p in $(ls g130/*전후*.png g137/shots/*전후*.png 2>/dev/null) $(ls g130/*.png g137/shots/*.png 2>/dev/null | grep -v 전후); do
  kb=$(( ($(stat -c %s "$p") + 1023) / 1024 ))
  if [ $kb -le $PNG_MAX_KB ] && [ $((used + kb)) -le $PNG_BUDGET_KB ]; then
    d=$R/$(dirname "$p" | cut -d/ -f1); mkdir -p $d; cp "$p" $d/; used=$((used + kb))
  else skipped="$skipped $p(${kb}KB)"; fi
done
echo "그림 ${used}KB 넣음 · 빠진 것:${skipped:- 없음}"
cat > $R/README.txt <<T
v10.27 결과 폴더 — 전수 검정(final_all_v1027.txt · 다시 돌린 것은 final_all_reruns_1027.txt — 같은 시험의 줄은 다시 돌린 줄이 앞섬) · 새 시험(fix_1027 · fix_1027b · fix_1027b_ui · fix_1027c · fix_1027_proto · g130_check)
· 앞 판과 비교(proto_diff · proto_pixel) · G-114 가상 결제사(srv_billing — 확인표 T-1 ~ T-10) · 수화 오류 부하(hyd_load.txt · hyd_pages.json) · flow(v10.27 기준) · 확장 점검 · 발견 목록(findings_r2 · defects)
· Docker(docker_1027.txt) · PowerShell · 새로 설치 · 서버 적용 리허설 · 로그(logs/).
그림(g130/ · g137/)은 묶음 크기 한도(30MiB) 때문에 작은 것만 넣었습니다(한 장 ${PNG_MAX_KB}KB 이하 · 모두 ${PNG_BUDGET_KB}KB 안). 빠진 것:${skipped:- 없음}
다시 찍는 도구: qa/g130_check.py · qa/g137/ (원본 qa/g137/src)
T
ls $R | wc -l
