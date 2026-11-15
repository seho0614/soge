#!/usr/bin/env bash
# 점검에 넣는 마이그레이션 리허설 — v10.303 (docs/424)
#   사용: bash tools/reh-check.sh <새 킷.zip> <결과 폴더>
#   ~/sgb-check.sh 가 realcheck 때 킷을 만든 뒤 부름(SGB_NO_REH=1 이면 건너뜀).
#   운영 킷: ${SGB_OPS_KITS:-~/kits/ops}/SGB_DevDocker_Integrated_*.zip 중 판 번호가 가장 큰 것
#            — 지금 운영에 올라간 킷. 운영 적용이 끝나면 그 킷을 이 폴더에 넣음(오래된 킷 자동 정리에서 빠짐).
#   리허설은 tools/mig-rehearsal.sh 그대로(버리는 DB · 자체 네트워크 · 포트 안 엶 · 실패해도 지움) · 결과 파일 <결과 폴더>/rehearsal.txt
#   표준 출력 한 줄: 「리허설(운영 킷 → 새 킷): …」
#   종료 0 = 통과 · 건너뜀(운영 킷 없음) · 못 함(판 거꾸로 등 — 점검은 막지 않음) / 1 = 리허설 실패(realcheck 도 실패) / 2 = 쓰는 법
set -u
NEW="${1:-}"; OUT="${2:-}"
[ -n "$NEW" ] && [ -n "$OUT" ] || { echo "쓰는 법: bash tools/reh-check.sh <새 킷.zip> <결과 폴더>" >&2; exit 2; }
H="$(cd "$(dirname "$0")" && pwd)"
D="${SGB_OPS_KITS:-$HOME/kits/ops}"
OPSK=$(ls -1 "$D"/SGB_DevDocker_Integrated_*.zip 2>/dev/null | sort -V | tail -1)
if [ -z "$OPSK" ]; then echo "리허설(운영 킷 → 새 킷): 건너뜀 — 운영 킷 없음($D)"; exit 0; fi
mkdir -p "$OUT" || { echo "리허설(운영 킷 → 새 킷): 못 함 — 결과 폴더를 만들지 못함($OUT)"; exit 0; }
ERR=$(bash "$H/mig-rehearsal.sh" "$OPSK" "$NEW" -o "$OUT/rehearsal.txt" 2>&1 >/dev/null); RC=$?
LAST=$(printf '%s\n' "$ERR" | grep -v '^$' | tail -1)
case $RC in
  0) echo "리허설(운영 킷 → 새 킷): ${LAST#리허설: }" ;;
  1) echo "[실패] 리허설(운영 킷 → 새 킷): ${LAST#리허설: } — $OUT/rehearsal.txt"; exit 1 ;;
  *) echo "리허설(운영 킷 → 새 킷): 못 함 — ${LAST:-까닭 모름}($(basename "$OPSK"))" ;;
esac
exit 0
