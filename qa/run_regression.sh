#!/bin/bash
# 회귀 시험 한 번에 (v10.159 · 2026-10-31) — 점검판(SITE_MODE=prod ~/sgb-check.sh 갈래 realcheck)이 떠 있을 때
#
#   bash qa/run_regression.sh [로그 파일] [기대 시험 수]
#     예) bash ~/sogaebank/sgb-infra/qa/run_regression.sh ~/reg.log 70
#
#   하는 일: API 를 AI MOCK 으로 다시 띄움 → 회귀 시험(test_v109* · test_v11*) → reg_tally.py 로 줄마다 「통과 = 전체」 확인
#   · 시험 안에서 도커를 부르는 시험(HOST)은 서버에서 직접, 나머지는 sgb-qa:v1 컨테이너에서
#   · 1103 은 1097 앞(사용자 웹 언어 캐시 영향 피함) · 시험마다 앞 시험이 사용자 웹을 재시작했으면 뜰 때까지 기다림
#   · 시험별 출력은 <로그>.d/ 에 남김 — 보고 전 FAIL 줄을 전체에서 셈(tail 로 자르지 않음)
#   · 이 파일이 없던 때는 세션 임시 폴더의 run_tests_*.sh 를 썼음(세션이 바뀌면 사라짐)
LOG=${1:-$HOME/reg_$(date +%m%d_%H%M).log}; EXPECT=${2:-}
Q=$(cd "$(dirname "$0")" && pwd)
K=$(ls -d ~/kits/run/current/SGB_* | tail -1)
D="$LOG.d"; mkdir -p "$D"; : > "$LOG"
API=http://localhost:13000/api/v1; SITE=http://localhost:15174; DB=postgresql://sgb:sgb@localhost:15432/sgb; BO=http://localhost:15173
HOST="test_v1103.py test_v1095.py test_v1097.py test_v1098.py test_v1099.py test_v1100.py test_v1101.py test_v1102.py test_v1122.py test_v1124.py test_v1149.py test_v1152.py test_v1155_etax.py"

head -1 "$K/KIT_COMMITS.txt" | tee -a "$LOG"
# AI 를 부르는 시험은 MOCK 공급자로(실제 외부 호출 없음)
(cd "$K" && AGENT_PROVIDER=MOCK docker compose -f docker-compose.yml -f docker-compose.site-prod.yml up -d --no-deps api >/dev/null 2>&1)
for i in $(seq 1 60); do curl -sf "$API/health" >/dev/null && break; sleep 5; done
[ -f "$Q/mkpost1145.py" ] && python3 "$Q/mkpost1145.py" >/dev/null 2>&1

wait_site() { for i in $(seq 1 100); do curl -sf -o /dev/null "$SITE/login" && return; sleep 3; done; }
one() {   # $1 시험 파일 · $2 host|box
  wait_site
  if [ "$2" = host ]; then
    out=$(cd "$Q" && KIT=$K SITE=$SITE API=$API DB=$DB ADMIN_WEB=$BO timeout 1800 python3 -I "$1" 2>&1)
  else
    out=$(docker run --rm --network host -v "$Q":/w -v "$K":/core:ro -w /w -e KIT=/core -e API=$API -e DB=$DB -e ADMIN_WEB=$BO -e SITE=$SITE sgb-qa:v1 timeout 1800 python3 "$1" 2>&1)
  fi
  echo "$out" > "$D/$1.log"
  echo "$1 | $(echo "$out" | grep -E '^결과' | tail -1)" | tee -a "$LOG"
  echo "$out" | grep '^FAIL' | sed 's/^/    /' | tee -a "$LOG"
}
T0=$(date +%s)
for f in $HOST; do [ -f "$Q/$f" ] && one "$f" host; done
for f in $(cd "$Q" && ls test_v109*.py test_v11*.py | sort); do
  echo " $HOST " | grep -q " $f " && continue
  one "$f" box
done
echo "걸린 시간 $(( ($(date +%s) - T0) / 60 ))분" | tee -a "$LOG"
python3 "$Q/reg_tally.py" "$LOG" ${EXPECT:+--expect $EXPECT}
