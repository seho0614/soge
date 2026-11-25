#!/usr/bin/env bash
# =====================================================================
# ERP 점검판 (e1.5 · docs/005) — 떠 있는 소개뱅크 점검판(~/sgb-check.sh … up)에 ERP API · 화면을 붙임
#
#   bash tools/erp-board.sh [갈래=main] [up|check|down]
#     up     CodeCommit 의 그 갈래를 받아(git archive) 이미지 두 개를 만들고 · 점검판 DB 컨테이너(sgb-db)에 데이터베이스 sgb_erp 를 만든 뒤
#            sgb-erp-api(13100 → 3100) · sgb-erp-web(15175 → 5175)를 점검판 네트워크(sgb-dev_default)에 띄움 · 마이그레이션은 API 가 시작할 때
#     check  up 뒤 확인 줄 — 건강(DB · 판 · 마이그레이션 수) · 화면 200 · 로그인 없이 /me 401 · sgb 와 다른 데이터베이스
#     down   ERP 컨테이너 둘만 내림(소개뱅크 점검판은 그대로 · ~/sgb-check.sh main down 이 소개뱅크를 내림)
#   포트는 13100 · 15175 만(2026-11-25 대표 승인 · CLAUDE.md) · 확인판 · RDS 에 닿지 않음 · 정기 작업 타이머는 끔(ERP_JOBS=off)
#   소개뱅크 연결: SGB_API_URL=http://sgb-api:3000/api/v1 · 서비스 토큰은 ERP_SVC_TOKEN 이 있으면 넘김(시험이 만든 토큰)
#   종료 0 = 통과 · 1 = 실패 · 2 = 쓰는 법 · 점검판 없음
# =====================================================================
set -uo pipefail
BR="${1:-main}"; MODE="${2:-up}"
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
NET=sgb-dev_default; DBC=sgb-db
REPO="${ERP_REPO:-$HOME/sogaebank/sgb-erp}"
say(){ echo "$*"; }
FAIL=0; ok(){ say "  통과  $1${2:+ — $2}"; }; bad(){ say "  실패  $1${2:+ — $2}"; FAIL=1; }

case "$MODE" in up|check|down) ;; *) echo "쓰는 법: bash tools/erp-board.sh [갈래] [up|check|down]"; exit 2 ;; esac
if [ "$MODE" = down ]; then docker rm -f sgb-erp-api sgb-erp-web >/dev/null 2>&1; say "== ERP 점검판 내림"; exit 0; fi
docker inspect "$DBC" >/dev/null 2>&1 || { echo "[중단] 소개뱅크 점검판이 떠 있지 않음 — ~/sgb-check.sh <갈래> up 먼저"; exit 2; }

if [ "$MODE" = up ]; then
  W=$(mktemp -d -t erpboard_XXXXXX); trap 'rm -rf -- "${W:?}"' EXIT
  (cd "$REPO" && git fetch -q origin && git archive "origin/$BR" 2>/dev/null || git archive "$BR") | tar -x -C "$W" || { echo "[중단] 갈래 $BR 를 받지 못함"; exit 1; }
  say "== ERP 점검판: $BR ($(cat "$W/VERSION" 2>/dev/null))"
  docker build -q -t sgb-erp-api:board -f "$W/api/Dockerfile" "$W" >/dev/null || { echo "[중단] ERP API 이미지 실패"; exit 1; }
  docker build -q -t sgb-erp-web:board "$W/web" >/dev/null || { echo "[중단] ERP 화면 이미지 실패"; exit 1; }
  docker exec "$DBC" psql -U sgb -d sgb -Atc "SELECT 1 FROM pg_database WHERE datname = 'sgb_erp'" | grep -q 1 \
    || docker exec "$DBC" psql -U sgb -d sgb -qc "CREATE DATABASE sgb_erp" || { echo "[중단] sgb_erp 만들기 실패"; exit 1; }
  docker rm -f sgb-erp-api sgb-erp-web >/dev/null 2>&1
  docker run -d --name sgb-erp-api --network "$NET" -p 13100:3100 \
    -e DATABASE_URL=postgresql://sgb:sgb@sgb-db:5432/sgb_erp -e SGB_API_URL=http://sgb-api:3000/api/v1 \
    -e SGB_SERVICE_TOKEN="${ERP_SVC_TOKEN:-}" -e ERP_JOBS=off sgb-erp-api:board >/dev/null || { echo "[중단] ERP API 시작 실패"; exit 1; }
  docker run -d --name sgb-erp-web --network "$NET" -p 15175:5175 -e ERP_API_ORIGIN=http://sgb-erp-api:3100 sgb-erp-web:board >/dev/null || { echo "[중단] ERP 화면 시작 실패"; exit 1; }
  for i in $(seq 1 60); do curl -sf http://localhost:13100/api/v1/health >/dev/null && break; sleep 3; done
  for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:15175/ && break; sleep 3; done
fi

say "[ERP] 확인"
H=$(curl -sf http://localhost:13100/api/v1/health || echo '{}')
echo "$H" | grep -q '"db":true' && ok "ERP API 건강 · DB" "$(echo "$H" | tr -d '\n' | cut -c1-160)" || bad "ERP API 건강" "$H"
echo "$H" | grep -q '"database":"sgb_erp"' && ok "데이터베이스 sgb_erp(소개뱅크 sgb 와 다름)" || bad "데이터베이스 이름" "$H"
M=$(docker exec "$DBC" psql -U sgb -d sgb_erp -Atc "SELECT count(*) FROM schema_migrations WHERE name ~ '^E[0-9]{3}_'" 2>/dev/null || echo 0)
F=$(docker exec sgb-erp-api sh -c 'ls -d /app/prisma/migrations/E[0-9][0-9][0-9]_*/ 2>/dev/null | wc -l' 2>/dev/null || echo -1)
[ "$M" = "$F" ] && [ "$M" -ge 1 ] && ok "ERP 마이그레이션 적용 수 = 파일 수" "$M / $F" || bad "ERP 마이그레이션" "적용 $M / 파일 $F"
C=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:13100/api/v1/me); [ "$C" = 401 ] && ok "로그인 없이 /me 401" || bad "로그인 없이 /me" "$C"
W2=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:15175/); [ "$W2" = 200 ] && ok "ERP 화면 200" || bad "ERP 화면" "$W2"
P=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:15175/api/v1/health); [ "$P" = 200 ] && ok "화면 → API 프록시" || bad "화면 → API 프록시" "$P"
say "== ERP 점검판 $( [ $FAIL = 0 ] && echo 통과 || echo 실패 )"
exit $FAIL
