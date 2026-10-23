#!/usr/bin/env bash
# 서버판 realcheck — 사용: ~/sgb-check.sh [갈래=main] [realcheck|check|up|down] [keep|fresh]
#   SITE_MODE=prod ~/sgb-check.sh …  — 사용자 웹을 운영 방식(next build → next start)으로 (v10.74 · docker-compose.site-prod.yml)
#   원본: sgb-infra/qa/sgb-check.sh (고치면 둘 다 고침)
set -u
BR="${1:-main}"; MODE="${2:-realcheck}"
export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
RUN=~/kits/run/current
if [ "$MODE" = down ]; then (cd "$RUN"/*/ 2>/dev/null && bash dev.sh down); exit; fi
TS=$(date +%Y%m%d_%H%M); RES=~/check-results/${TS}_${BR//\//_}; mkdir -p "$RES"
bash ~/make-kit.sh "$BR" >/dev/null || { echo "[중단] kit 만들기 실패"; exit 1; }
T=$(ls -t ~/kits/out/*.tar.gz | head -1)
(cd "$RUN"/*/ 2>/dev/null && bash dev.sh down >/dev/null 2>&1)
rm -rf "$RUN" && mkdir -p "$RUN" && tar -xzf "$T" -C "$RUN"
K=$(dirname "$(dirname "$(find "$RUN" -maxdepth 3 -path '*/sgb/VERSION' | head -1)")")
cd "$K" || exit 1
[ -f .env ] || cp .env.example .env
for kv in API_PORT=13000 WEB_PORT=15173 SITE_PORT=15174 PG_PORT=15432; do
  k=${kv%%=*}; if grep -q "^$k=" .env; then sed -i "s/^$k=.*/$kv/" .env; else echo "$kv" >> .env; fi
done
sed -i '/^COMPOSE_FILE=/d' .env
if [ "${SITE_MODE:-dev}" = prod ]; then
  [ -f docker-compose.site-prod.yml ] || { echo "[중단] 이 kit 에는 docker-compose.site-prod.yml 이 없습니다"; exit 1; }
  echo "COMPOSE_FILE=docker-compose.yml:docker-compose.site-prod.yml" >> .env
fi
echo "== $MODE: $BR ($(cat sgb/VERSION)) · 사용자 웹 ${SITE_MODE:-dev} → $RES"
{ [ "${3:-}" = fresh ] && echo yes; } | bash dev.sh "$MODE" ${3:-} 2>&1 | tee "$RES/$MODE.log"; RC=${PIPESTATUS[1]}
cp realcheck_*.txt "$RES/" 2>/dev/null; cp -r qa/results_* "$RES/" 2>/dev/null
tail -30 "$RES/$MODE.log" > "$RES/summary.txt"
echo "== 끝: 결과 코드 $RC · 결과 폴더 $RES"
exit $RC
