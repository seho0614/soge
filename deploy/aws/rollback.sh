#!/usr/bin/env bash
# =====================================================================
# 전 판으로 되돌립니다 (코드만).   bash ~/sgb/deploy/aws/rollback.sh
#
#   ~/sgb 바로가기를 직전 판 폴더로 돌리고 pm2 프로세스를 다시 띄웁니다.
#   ★ **DB 는 되돌리지 않습니다.** 마이그레이션은 전진 전용이라, 전 판 코드가 새 DB 구조 위에서 돕니다.
#     DB 까지 되돌리려면 적용 전에 만든 RDS 스냅샷을 복원하십시오(절차서 v2.5 13-3 — 새 인스턴스로 복원 → .env 의 접속 주소 교체).
#   직전 판이 v10.15 이전 킷(배치 · 사이트 실행 스크립트가 없는 판)이면 API 만 예전 방식으로 띄웁니다.
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
APP_LINK="${APP_LINK:-$HOME/sgb}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
PREV="$(cat "$DATA_DIR/previous" 2>/dev/null || true)"
CUR="$(readlink -f "$APP_LINK" 2>/dev/null || true)"
[ -n "$PREV" ] && [ -d "$PREV" ] || { echo "!! 되돌릴 전 판이 없습니다 ($DATA_DIR/previous)"; exit 1; }
[ "$PREV" != "$CUR" ] || { echo "!! 이미 전 판입니다 ($PREV)"; exit 1; }

echo "되돌리기: $CUR → $PREV"
ln -sfn "$PREV" "$APP_LINK" || { echo "!! 바로가기를 바꾸지 못했습니다"; exit 1; }
echo "$CUR" > "$DATA_DIR/previous"; echo "$PREV" > "$DATA_DIR/current"
load_env "$APP_LINK/.env"
pm2 delete sgb sgb-site sgb-jobs >/dev/null 2>&1
if [ -f "$APP_LINK/deploy/aws/run-api.sh" ]; then
  pm2 start "$APP_LINK/deploy/aws/run-api.sh"  --name sgb      --interpreter bash --time >/dev/null 2>&1
  pm2 start "$APP_LINK/deploy/aws/run-site.sh" --name sgb-site --interpreter bash --time >/dev/null 2>&1
  JOB_TOKEN="${JOB_TOKEN:-}"
  [ "${SKIP_JOBS:-0}" != "1" ] && [ "${#JOB_TOKEN}" -ge 32 ] && pm2 start "$APP_LINK/deploy/aws/run-jobs.sh" --name sgb-jobs --interpreter bash --time >/dev/null 2>&1
else
  # 예전 킷 — .env 를 pm2 가 물려받게 한 채로 띄웁니다(절차서 v2.5 7-6 과 같은 방식)
  export NODE_ENV="${NODE_ENV:-production}"
  # ★ 앱 폴더에서 띄웁니다 — pm2 는 명령을 친 자리를 작업 폴더로 삼고, start.sh 의 `npm start` 는 그 자리의 package.json 을 찾습니다
  if [ -x "$APP_LINK/start.sh" ]; then ( cd "$APP_LINK" && pm2 start ./start.sh --name sgb --interpreter bash --time >/dev/null 2>&1 )
  else ( cd "$APP_LINK" && pm2 start dist/main.js --name sgb --time >/dev/null 2>&1 ); fi
  echo "   (전 판에는 사용자 웹 · 배치 실행 스크립트가 없어 API 만 띄웠습니다)"
fi
pm2 save >/dev/null 2>&1
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT:-3000}/api/v1/health")" = "200" ] && { echo "되돌림 완료 — API 가 떴습니다 ($PREV)"; exit 0; }
  sleep 2
done
echo "!! 되돌린 판의 API 가 뜨지 않습니다 — pm2 logs sgb --lines 50 을 보십시오"
exit 1
