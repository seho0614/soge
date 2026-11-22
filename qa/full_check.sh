#!/usr/bin/env bash
# v10.628 (docs/772) 전체 점검 — 묶음 끝에 한 번(세션 임시 스크립트 pipeNNNN.sh 를 저장소로)
#   NEW="test_v1627 test_v1631" HOSTNEW="test_v1635" bash qa/full_check.sh <갈래> [결과 폴더]
#   ① realcheck fresh(SITE_MODE=prod) — 실패면 점검판 내리고 멈춤
#   ② 기능 점검 func_check.sh(집계 · 건너뜀 줄까지 보임)
#   ③ 이 묶음 새 시험 NEW(점검판 · 컨테이너) · HOSTNEW(서버에서 python3 -I)
#   ④ 회귀 run_regression.sh(PAR · UI_LANE 그대로 넘김) — 기대 수는 reg_classify 판정 줄 수(직접 셈)
#   ⑤ ~/sgb-check.sh main down
#   이 qa 폴더(작업 트리)의 시험을 그대로 씀 — 돌리는 동안 시험 파일을 고치지 말 것.
set -u
B=${1:?갈래 이름(예 feature/v10.627)}
Q=$(cd "$(dirname "$0")" && pwd)
OUT=${2:-$HOME/check-results/full_$(date +%Y%m%d_%H%M)}
mkdir -p "$OUT"
export PATH=$HOME/.local/bin:$PATH
DBU=postgresql://sgb:sgb@localhost:15432/sgb
say() { echo "$*"; echo "$*" >> "$OUT/summary.txt"; }
: > "$OUT/summary.txt"
say "== 전체 점검 $B · 시작 $(TZ=Asia/Seoul date '+%m/%d %H:%M') KST · 결과 $OUT"

SITE_MODE=prod ~/sgb-check.sh "$B" realcheck fresh > "$OUT/realcheck.log" 2>&1; say "① realcheck rc=$?"
say "$(sed -n 3p "$OUT/realcheck.log")"; say "$(grep '진짜 이미지 확인' "$OUT/realcheck.log" | tail -1)"; say "$(grep '리허설' "$OUT/realcheck.log" | tail -1)"
grep -q "진짜 이미지 확인 — 전체 통과" "$OUT/realcheck.log" || { ~/sgb-check.sh main down >/dev/null 2>&1; say "realcheck 실패 — 멈춤"; exit 1; }
K=$(ls -d ~/kits/run/current/SGB_* | tail -1); say "$(cat "$K/KIT_COMMITS.txt")"

SITE_MODE=prod bash "$Q/func_check.sh" > "$OUT/func_check.log" 2>&1; say "② 기능 점검 rc=$?"
say "$(grep -E '기능 점검 집계|건너뜀 [1-9]|실패 [1-9]' "$OUT/func_check.log" | tail -6)"

for t in ${NEW:-}; do
  docker run --rm --network host -v "$Q:/w" -v "$K:/core:ro" -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 -e DB=$DBU \
    -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 sgb-qa:v1 timeout 1800 python3 "$t.py" > "$OUT/$t.log" 2>&1
  say "③ $t rc=$? $(grep -c '^FAIL' "$OUT/$t.log") FAIL · $(grep -E '^결과' "$OUT/$t.log" | tail -1)"; grep -E '^FAIL' "$OUT/$t.log" | cut -c1-300 >> "$OUT/summary.txt"
done
for t in ${HOSTNEW:-}; do
  (cd "$Q" && KIT=$K timeout 1800 python3 -I "$t.py" > "$OUT/$t.log" 2>&1); say "③ $t(서버) rc=$? · $(grep -E '^결과' "$OUT/$t.log" | tail -1)"
  grep -E '^FAIL' "$OUT/$t.log" | cut -c1-300 >> "$OUT/summary.txt"
done

EXP=$(cd "$Q" && python3 -I -c "import sys; sys.path.insert(0, '.'); import reg_classify as R; print(len(R.classify('.', '$K/sgb')))" 2>/dev/null || echo 0)
PAR=${PAR:-3} UI_LANE=${UI_LANE:-0} bash "$Q/run_regression.sh" "$OUT/regression.log" "$EXP" > "$OUT/regression.out" 2>&1; say "④ 회귀 rc=$? · 기대 $EXP"
say "$(grep -E '실패  test|회귀 집계' "$OUT/regression.out")"; say "$(grep -E '걸린 시간|단계 —' "$OUT/regression.log" | tail -2)"

~/sgb-check.sh main down >/dev/null 2>&1; say "⑤ main down rc=$?"
say "== 끝 $(TZ=Asia/Seoul date '+%m/%d %H:%M') KST"
