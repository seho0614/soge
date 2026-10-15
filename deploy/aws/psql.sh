#!/usr/bin/env bash
# =====================================================================
# 운영 DB 에 psql 로 붙습니다 — 앱 폴더 .env 의 DATABASE_URL 로.   bash ~/sgb/deploy/aws/psql.sh [psql 인자…]
#
#   bash ~/sgb/deploy/aws/psql.sh -c "select count(*) from accounts"
#   bash ~/sgb/deploy/aws/psql.sh -v ON_ERROR_STOP=1 -f ~/sgb/scripts/seed-polls.sql
#
#   (`source .env` 를 쓰지 않습니다 — 접속 주소에 & 가 있으면 셸이 줄을 자릅니다)
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
load_env "$HERE/../../.env" || { echo "!! .env 가 없습니다" >&2; exit 1; }
exec psql "$(psql_url "$DATABASE_URL")" -X "$@"
