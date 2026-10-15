#!/usr/bin/env bash
# 소개뱅크 개발 Docker — macOS · Linux 도우미.  사용법은 dev.ps1 과 같습니다.
#   ./dev.sh up | logs | check | reset | down | wipe | status | realcheck [fresh]
#   realcheck — 진짜 기반 이미지(node:22-slim · postgres:16)로 받기 → 빌드 → 기동 → 검정 → 주소 확인. 결과는 realcheck_날짜_시각.txt
set -euo pipefail
cd "$(dirname "$0")"
need_env() { [ -f .env ] || { cp .env.example .env; echo ".env 를 만들었습니다 (개발용 값)."; }; }
case "${1:-up}" in
  up)     need_env; docker compose up -d --build; docker compose ps
          printf '\nAPI   http://localhost:3000/docs\nBO    http://localhost:5173  (admin@x.com / sgb-dev-1234)\n웹    http://localhost:5174\n' ;;
  logs)   docker compose logs -f migrate ads-migrate api ;;
  check)  need_env; docker compose --profile check run --rm --build checks ;;   # --build: 킷을 바꾼 뒤 낡은 검정 이미지로 도는 것을 막음 (10/2)
  reset)  need_env; SGB_RESET=1 docker compose run --rm migrate; SGB_RESET=1 docker compose run --rm ads-migrate; docker compose restart api ;;
  down)   docker compose down ;;
  wipe)   docker compose down -v ;;
  status) docker compose ps ;;
  realcheck) exec bash docker/realcheck.sh "${2:-keep}" ;;
  *)      echo "사용법: ./dev.sh [up|logs|check|reset|down|wipe|status|realcheck]"; exit 1 ;;
esac
