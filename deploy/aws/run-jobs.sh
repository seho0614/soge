#!/usr/bin/env bash
# =====================================================================
# 배치 호출기 실행 — pm2 가 부릅니다 (프로세스 이름 sgb-jobs).
#
#   매분 POST /api/v1/admin/jobs/tick 을 부릅니다(X-Job-Token). 무엇을 언제 돌릴지는 DB(job_schedules)가 정합니다.
#   이것이 없으면 알림 발송 · 구독 청구 · 탈퇴 파기(법적 의무) · 자동 확정이 **아무 오류 없이 돌지 않습니다.**
#
#   ※ docs/25 3-5 는 운영에서 EventBridge 를 쓰라고 합니다(멈춤 알람이 있음). 서버 1대로 여는 단계에서는
#     이 호출기를 pm2 로 돌리고(죽으면 pm2 가 다시 띄움), 멈춤은 postcheck 의 v_job_stale 로 봅니다.
#     EventBridge 로 옮기면 `pm2 delete sgb-jobs` 하십시오 — 둘이 같이 돌아도 한 번만 실행됩니다(job_runs UNIQUE).
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. deploy/aws/lib.sh
load_env .env || { echo "!! $(pwd)/.env 가 없습니다"; exit 1; }
JOB_TOKEN="${JOB_TOKEN:-}"
if [ "${#JOB_TOKEN}" -lt 32 ]; then
  echo "!! JOB_TOKEN 이 없거나 32자 미만입니다 — .env 에 넣으십시오 (openssl rand -hex 24)"; exit 1
fi
export API_ORIGIN="http://127.0.0.1:${PORT:-3000}"       # 배치는 늘 이 서버의 API 를 부릅니다
export SCHEDULER_HEARTBEAT="${SCHEDULER_HEARTBEAT:-/tmp/sgb-jobs.ok}"
exec node scripts/scheduler-daemon.js
