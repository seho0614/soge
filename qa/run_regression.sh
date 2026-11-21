#!/bin/bash
# 회귀 시험 한 번에 (v10.159 · 2026-10-31) — 점검판(SITE_MODE=prod ~/sgb-check.sh 갈래 realcheck)이 떠 있을 때
#
#   bash qa/run_regression.sh [로그 파일] [기대 시험 수]
#     예) bash ~/sogaebank/sgb-infra/qa/run_regression.sh ~/reg.log 70
#         PAR=1 bash …  → 예전처럼 하나씩(시간 비교용) · PAR=4 → 동시 4개 · UI_LANE=1 → 화면 시험도 한 줄로 동시(시험해 보는 옵션)
#
#   하는 일: API 를 AI MOCK 으로 다시 띄움 → 회귀 시험(test_v109* · test_v11*) → reg_tally.py 로 줄마다 「통과 = 전체」 확인
#   · 시험 안에서 도커를 부르는 시험(HOST)은 서버에서 직접, 나머지는 sgb-qa:v1 컨테이너에서
#   · 1103 은 1097 앞(사용자 웹 언어 캐시 영향 피함) · 시험마다 앞 시험이 사용자 웹을 재시작했으면 뜰 때까지 기다림
#   · 시험별 출력은 <로그>.d/ 에 남김 — 보고 전 FAIL 줄을 전체에서 셈(tail 로 자르지 않음)
#   · 이 파일이 없던 때는 세션 임시 폴더의 run_tests_*.sh 를 썼음(세션이 바뀌면 사라짐)
#
#   v10.569 (docs/711) 시간 줄이기 — 순서: ① HOST(서버 · 하나씩 · 예전 그대로) ② 「혼자」 시험(하나씩 · 이름 순) ③ 나머지를 동시 PAR 개(기본 3)
#   · 「혼자」 판정은 reg_classify.py(규칙 · 목록 <로그>.d/_plan.tsv) — 설정을 바꾸는데 키를 못 찾음 · 공유 회원 · 표 바꾸기 · 로그인 잠김 ·
#     운영 알림 대기 목록 · 도커 · 화면(playwright) 시험은 혼자 · 설정 키(앞마디)나 정기 작업이 겹치는 시험끼리는 동시에 안 돎(잠금)
#   · 손으로: reg_solo_force.txt(늘 혼자) · reg_par_ok.txt(규칙에 걸려도 동시) — 한 줄 한 파일 · # 주석
#   · 결과 줄 모양(「시험 | 결과: n / m」 · FAIL 줄 네 칸) · 「결과」 줄 없음 = 멈춤 판정 · <로그>.d/<시험>.log 는 예전과 같음
#     (동시 실행분은 끝난 뒤 이름 순서로 로그에 붙음)
#   · 걸린 시간: 로그 끝 「걸린 시간 N분」 + 단계별 줄 · 시험마다 <로그>.d/_times.tsv · 돌 때마다 ~/reg_times.tsv 에 한 줄(REG_HISTORY 로 바꿈) ·
#     마지막 「하나씩(PAR=1)」 실행과 비교 한 줄
LOG=${1:-$HOME/reg_$(date +%m%d_%H%M).log}; EXPECT=${2:-}
Q=$(cd "$(dirname "$0")" && pwd)
K=$(ls -d ~/kits/run/current/SGB_* | tail -1)
D="$LOG.d"; mkdir -p "$D"; : > "$LOG"; : > "$D/_times.tsv"
API=http://localhost:13000/api/v1; SITE=http://localhost:15174; DB=postgresql://sgb:sgb@localhost:15432/sgb; BO=http://localhost:15173
PAR=${PAR:-3}; UI_LANE=${UI_LANE:-0}; HIST=${REG_HISTORY:-$HOME/reg_times.tsv}
HOST="test_v1103.py test_v1095.py test_v1097.py test_v1098.py test_v1099.py test_v1100.py test_v1101.py test_v1102.py test_v1122.py test_v1124.py test_v1149.py test_v1152.py test_v1155_etax.py test_v1196_daily.py test_v1200_push.py test_v1221_deps.py test_v1226_tg.py test_v1227.py test_v1233.py test_v1237.py test_v1238.py test_v1244_boot.py test_v1247_files.py test_v1250_files.py test_v1298.py test_v1299.py test_v1303.py test_v1306.py"   # v10.221 — 외부 묶음 검사는 서버 npm 으로

head -1 "$K/KIT_COMMITS.txt" | tee -a "$LOG"
# AI 를 부르는 시험은 MOCK 공급자로(실제 외부 호출 없음)
(cd "$K" && AGENT_PROVIDER=MOCK docker compose -f docker-compose.yml -f docker-compose.site-prod.yml up -d --no-deps api >/dev/null 2>&1)
for i in $(seq 1 60); do curl -sf "$API/health" >/dev/null && break; sleep 5; done
[ -f "$Q/mkpost1145.py" ] && python3 "$Q/mkpost1145.py" >/dev/null 2>&1

wait_site() { for i in $(seq 1 100); do curl -sf -o /dev/null "$SITE/login" && return; sleep 3; done; }
one() {   # $1 시험 파일 · $2 host|box · $3 단계 이름(시간 기록)
  wait_site
  local t1; t1=$(date +%s)
  if [ "$2" = host ]; then
    out=$(cd "$Q" && KIT=$K SITE=$SITE API=$API DB=$DB ADMIN_WEB=$BO timeout 1800 python3 -I "$1" 2>&1)
  else
    out=$(docker run --rm --network host -v "$Q":/w -v "$K":/core:ro -w /w -e KIT=/core -e API=$API -e DB=$DB -e ADMIN_WEB=$BO -e SITE=$SITE sgb-qa:v1 timeout 1800 python3 "$1" 2>&1)
  fi
  echo "$out" > "$D/$1.log"
  printf '%s\t%s\t%s\n' "$1" "${3:-$2}" "$(( $(date +%s) - t1 ))" >> "$D/_times.tsv"
  echo "$1 | $(echo "$out" | grep -E '^결과' | tail -1)" | tee -a "$LOG"
  echo "$out" | grep '^FAIL' | sed 's/^/    /' | tee -a "$LOG"
}
ALL=$(cd "$Q" && ls test_v109*.py test_v11*.py test_v12*.py test_v13*.py test_v14*.py test_v15*.py test_v16*.py 2>/dev/null | sort)
T0=$(date +%s)
for f in $HOST; do [ -f "$Q/$f" ] && one "$f" host host; done
T1=$(date +%s)

if [ "$PAR" -le 1 ]; then
  # 예전 방식(하나씩 · 이름 순) — 시간 비교 · 동시 실행이 의심될 때
  for f in $ALL; do
    echo " $HOST " | grep -q " $f " && continue
    one "$f" box serial
  done
  T2=$(date +%s); T3=$T2; NS=0; NP=0
else
  python3 -I "$Q/reg_classify.py" "$Q" --core "$K/sgb" --write "$D/_plan.tsv" | tee -a "$LOG"
  # ② 혼자: SOLO · (UI_LANE=1 이 아니면) UI — 이름 순 · 하나씩
  SOLO=$(awk -F'\t' -v ui="$UI_LANE" '!/^#/ && ($2 == "SOLO" || ($2 == "UI" && ui != "1")) {print $1}' "$D/_plan.tsv")
  NS=0
  for f in $ALL; do
    echo " $HOST " | grep -q " $f " && continue
    echo " $(echo $SOLO) " | grep -q " $f " || continue
    one "$f" box solo; NS=$((NS + 1))
  done
  T2=$(date +%s)
  # ③ 동시: PAR · LOCK(· UI_LANE=1 이면 UI 를 한 줄로) — 끝난 뒤 이름 순으로 로그에 붙음
  NP=$(awk -F'\t' -v ui="$UI_LANE" '!/^#/ && ($2 == "PAR" || $2 == "LOCK" || ($2 == "UI" && ui == "1")) {n++} END {print n + 0}' "$D/_plan.tsv")
  UIARG=""; [ "$UI_LANE" = 1 ] && UIARG="--ui-lane"
  Q="$Q" K="$K" API="$API" DB="$DB" ADMIN_WEB="$BO" SITE="$SITE" SKIP_TESTS="$HOST" \
    python3 -I "$Q/reg_pool.py" --plan "$D/_plan.tsv" --dir "$D" --n "$PAR" $UIARG --times "$HOME/reg_last_times.tsv" | tee -a "$LOG"
  T3=$(date +%s)
fi

M=$(( (T3 - T0) / 60 ))
echo "걸린 시간 ${M}분" | tee -a "$LOG"
echo "  단계 — 서버(HOST) $(( (T1 - T0) / 60 ))분 · 혼자 $(( (T2 - T1) / 60 ))분(${NS}개) · 동시 $(( (T3 - T2) / 60 ))분(${NP}개 · 동시 ${PAR}개$( [ "$UI_LANE" = 1 ] && echo ' · 화면 한 줄'))" | tee -a "$LOG"
# 시간 비교 기록 — 한 줄: 날짜 · 동시 수 · 화면 줄 · 시험 수 · 전체 초 · 서버 · 혼자 · 동시 · 로그
NT=$(grep -c '^test_.* | ' "$LOG")
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "$PAR" "$UI_LANE" "$NT" "$((T3 - T0))" "$((T1 - T0))" "$((T2 - T1))" "$((T3 - T2))" "$LOG" >> "$HIST"
LAST1=$(awk -F'\t' '$2 == 1 {s = $5; n = $4} END {if (s) print int(s / 60) "분(" n "개)"}' "$HIST")
[ "$PAR" -gt 1 ] && [ -n "$LAST1" ] && echo "  비교 — 마지막 하나씩(PAR=1) ${LAST1} → 이번 ${M}분(${NT}개)" | tee -a "$LOG"
cp "$D/_times.tsv" "$HOME/reg_last_times.tsv" 2>/dev/null
python3 "$Q/reg_tally.py" "$LOG" ${EXPECT:+--expect $EXPECT}
