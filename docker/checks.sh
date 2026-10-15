#!/usr/bin/env bash
# =====================================================================
# 통합 검정 — `docker compose --profile check run --rm checks`
#
# 검정 전용 DB(sgb_check)에서 돕니다. 개발 DB(sgb)는 건드리지 않습니다.
#   1. 본체 npm run verify  (마이그레이션·재실행·불변식·공격·어댑터·오류코드·ACL)
#   2. 광고 verify-ads.sh   (sgb_ads)
# =====================================================================
set -uo pipefail
cd /app
FAIL=0
echo "════ 1. 본체 검정 (sgb_check) ════"
npm run verify --silent || FAIL=1

echo; echo "════ 2. 광고 플랫폼 검정 (sgb_ads) ════"
bash /ads/scripts/verify-ads.sh | tee /tmp/ads.log
grep -q "▲위험 0" /tmp/ads.log || FAIL=1

echo
[ $FAIL = 0 ] && echo "통합 검정 — 전체 통과" || echo "통합 검정 — 실패 있음 (위 로그 확인)"
exit $FAIL
