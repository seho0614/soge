#!/usr/bin/env bash
# v10.784 (docs/893) 새 시험 점검판 먼저 — main 에 없는 새 시험만 지금 떠 있는 점검판에서 돌림
#   bash qa/new_tests_on_board.sh <core 작업 트리> [이 qa 폴더(기본: 이 스크립트 폴더)]
#   먼저 ~/sgb-check.sh <갈래> up (백그라운드) · 회귀 중에는 하지 않음 · 점검판 포트(13000 · 15432 · 15173 · 15174)만 씀 · 확인판 · RDS 없음
#   fork · 보조 일꾼이 쓴 시험이 시드에 없는 계정 · 틀린 칸 이름으로 전체 점검을 망가뜨리지 않게(11/25)
set -u
C=$(cd "${1:?core 작업 트리}" && pwd); Q=$(cd "${2:-$(dirname "$0")}" && pwd)
MAIN_QA=${MAIN_QA:-$HOME/sogaebank/sgb-infra/qa}
API=http://localhost:13000/api/v1
curl -sf "$API/health" >/dev/null || { echo "점검판이 떠 있지 않음 — ~/sgb-check.sh <갈래> up 먼저"; exit 2; }
NEWT=$(cd "$Q" && for f in test_v*.py; do [ -f "$MAIN_QA/$f" ] || echo "$f"; done)
[ -n "$NEWT" ] || { echo "새 시험 없음"; exit 0; }
BAD=0
for t in $NEWT; do
  r=$(docker run --rm --network host -v "$Q:/w" -v "$C:/core/sgb:ro" -w /w -e KIT=/core -e API=$API -e DB=postgresql://sgb:sgb@localhost:15432/sgb \
      -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 sgb-qa:v1 timeout 600 python3 "$t" 2>&1 | grep -E '^결과|^FAIL' | head -6)
  echo "$t | ${r:-결과 줄 없음(멈춤)}"
  echo "$r" | grep -qE '^결과: ([0-9]+) / \1$' || BAD=$((BAD + 1))
done
echo "새 시험 $(echo $NEWT | wc -w)개 · 통과 아님 $BAD"
[ $BAD = 0 ]
