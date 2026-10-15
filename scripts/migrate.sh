#!/usr/bin/env bash
# 마이그레이션 적용. verify-all.sh 이 **두 번 돌려** 재실행 안전성을 봅니다.
#
# 두 번째에도 "적용 0" 이 나와야 합니다 — 다시 적용되면 같은 DDL 이
# 두 번 돌아 운영에서 데이터가 덮어써질 수 있습니다.
set -euo pipefail
exec node "$(dirname "$0")/migrate.js" "$@"
