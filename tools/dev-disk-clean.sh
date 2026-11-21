#!/usr/bin/env bash
# =====================================================================
# 개발 서버 디스크 정리(강화) — v10.589 (sgb-core docs/731 · 14차 운영 ⑤) · sgbdev 로 실행
#
#   bash tools/dev-disk-clean.sh            # 읽기만 — 지울 수 있는 것 · 크기 · 많이 차지하는 곳(기본)
#   bash tools/dev-disk-clean.sh --apply    # 위 목록을 보여 준 뒤 yes 를 받고 지움(CLEAN_YES=1 이면 묻지 않음)
#   bash tools/dev-disk-clean.sh --auto     # ~/sgb-check.sh 점검 전 정리용 — 묻지 않고 「늘 지워도 되는 것」만,
#                                            디스크가 PRESSURE_PCT(80) 이상이면 「여유가 없을 때만」 것까지
#
#   늘 지워도 되는 것(--apply · --auto)
#     ① 점검 결과 — ~/check-results 최근 KEEP_RESULTS(19)개 밖(지금 sgb-check.sh 의 tail -n +20 과 같음 — 점검이 곧 새 결과 하나를 만들어 20개)
#     ② 킷 — ~/kits/out · ~/kits/release 판 번호 큰 KEEP_KITS(3)판 밖(zip · tar.gz) · ~/kits/ops 큰 KEEP_OPS(2)판 밖 · ~/kits/reh*_diff.txt 30일 넘은 것
#     ③ 도커 — 멈춘 지 24시간 넘은 리허설 컨테이너(sgb-mreh-* · sgb-rdreh-*) · 이름 없는 이미지 · 매이지 않은 볼륨 · 빌드 캐시 BUILD_CACHE_MAX(4gb) 넘는 부분
#     ④ 임시 — /tmp 의 내 파일 중 리허설 · 화면 시험이 남긴 것(migreh_* · rdreh_* · playwright*) 1일 넘은 것
#   여유가 없을 때만(--apply 는 늘 · --auto 는 디스크 PRESSURE_PCT 이상일 때)
#     ⑤ 점검 결과 안 무거운 파일 — 남긴 결과 중 3일 넘은 폴더의 그림 · 동영상 · trace(*.png · *.webm · *.zip · 1MB 넘는 것) — summary · 기록은 남김
#     ⑥ 도커 빌드 캐시를 2gb 까지 · 14일 넘게 안 쓴 이름 있는 이미지(돌거나 멈춘 컨테이너가 쓰는 것 · KEEP_IMAGES 는 빼고)
#     ⑦ npm 캐시 1GB 넘으면 · pip 캐시 500MB 넘으면 비움
#   지우지 않는 것: 저장소(~/sogaebank) · ~/outputs · ~/backup(backup-full.sh 가 2벌만) · ~/kits/run(지금 점검판) · 도는 컨테이너 · 이름 있는 볼륨 중 매인 것 · 남의 /tmp 파일
#   결과: 화면 + ~/check-results/disk-clean_날짜_시각.txt(최근 10개만) · 마지막 줄 「== 디스크 정리 뒤 사용 N% · 지운 약 X MB」
#   종료 코드: 0 · 2 쓰는 법 · 1 지우지 않음(yes 아님)
# =====================================================================
set -uo pipefail
MODE="${1:-list}"
case "$MODE" in list|--apply|--auto) ;; *) echo "사용: dev-disk-clean.sh [--apply|--auto]"; exit 2 ;; esac
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
KEEP_RESULTS="${KEEP_RESULTS:-19}"; KEEP_KITS="${KEEP_KITS:-3}"; KEEP_OPS="${KEEP_OPS:-2}"
BUILD_CACHE_MAX="${BUILD_CACHE_MAX:-4gb}"; PRESSURE_PCT="${PRESSURE_PCT:-80}"
KEEP_IMAGES="${KEEP_IMAGES:-sgb-dev-checks postgres:16}"
RESDIR="${RESDIR:-$HOME/check-results}"
TMPROOT="${TMPROOT:-/tmp}"   # 시험은 다른 폴더로(진짜 /tmp 를 건드리지 않게)
mkdir -p "$RESDIR"
OUT="$RESDIR/disk-clean_$(date +%Y%m%d_%H%M%S).txt"; : > "$OUT"
say() { echo "$*" | tee -a "$OUT"; }
info() { say "        $*"; }
kb_of() { du -skx "$@" 2>/dev/null | awk '{s+=$1} END {print s+0}'; }
mb() { echo "$(( $1 / 1024 ))MB"; }
use_pct() { df --output=pcent / | tail -1 | tr -dc 0-9; }
DOCK=0; docker info >/dev/null 2>&1 && DOCK=1
U0=$(use_pct)
HEAVY=0
if [ "$MODE" = --apply ]; then HEAVY=1; elif [ "$MODE" = --auto ] && [ "${U0:-0}" -ge "$PRESSURE_PCT" ]; then HEAVY=1; fi

TODO=(); TOTAL=0
add() { TODO+=("$1	$2"); TOTAL=$((TOTAL + $3)); info "$(printf '%-8s' "$(mb "$3")") $2"; }

say "개발 서버 디스크 정리 — $(case "$MODE" in list) echo 읽기만;; --apply) echo 지우기;; *) echo "점검 전 자동(여유 없을 때 것 $([ "$HEAVY" = 1 ] && echo 포함 || echo 뺌))";; esac) ($(date '+%Y-%m-%d %H:%M:%S %Z'))"
say "디스크: ${U0}% 사용 · $(df -Ph / | awk 'NR==2 {print "남은 " $4 " / " $2}') · 도커 $([ "$DOCK" = 1 ] && echo 붙음 || echo '안 붙음(도커 항목 건너뜀)')"

say ""; say "[1] 점검 결과 — 최근 ${KEEP_RESULTS}개 밖"
n=0
while IFS= read -r d; do [ -n "$d" ] || continue; add results "$d" "$(kb_of "$d")"; n=$((n+1)); done \
  < <(ls -1dt "$RESDIR"/*/ 2>/dev/null | tail -n +"$((KEEP_RESULTS + 1))")
[ "$n" = 0 ] && info "없음"

say ""; say "[2] 킷 — out · release 큰 ${KEEP_KITS}판 · ops 큰 ${KEEP_OPS}판 밖 · 30일 넘은 리허설 차이 파일"
n=0
for kd in "$HOME/kits/out:$KEEP_KITS" "$HOME/kits/release:$KEEP_KITS" "$HOME/kits/ops:$KEEP_OPS"; do
  dir="${kd%:*}"; keep="${kd##*:}"
  while read -r v; do
    [ -n "$v" ] || continue
    for f in "$dir"/SGB_DevDocker_Integrated_*_"$v".zip "$dir"/SGB_DevDocker_Integrated_*_"$v".tar.gz; do
      [ -f "$f" ] && { add kit "$f" "$(kb_of "$f")"; n=$((n+1)); }
    done
  done < <(ls -1 "$dir" 2>/dev/null | sed -n 's/^SGB_DevDocker_Integrated_[0-9]*_\(v[0-9]*_[0-9]*\)\.\(zip\|tar\.gz\)$/\1/p' | sort -uV | head -n -"$keep")
done
while IFS= read -r f; do [ -n "$f" ] && { add file "$f" "$(kb_of "$f")"; n=$((n+1)); }; done \
  < <(find "$HOME/kits" -maxdepth 1 -type f -name 'reh*_diff.txt' -mtime +30 2>/dev/null)
[ "$n" = 0 ] && info "없음"

say ""; say "[3] 도커 — 멈춘 리허설 컨테이너 · 이름 없는 이미지 · 매이지 않은 볼륨 · 빌드 캐시"
if [ "$DOCK" = 1 ]; then
  docker system df 2>/dev/null | sed 's/^/        /' | tee -a "$OUT" >/dev/null
  while IFS= read -r c; do [ -n "$c" ] && add container "$c" 0; done \
    < <(docker ps -a --filter status=exited --filter status=created --format '{{.Names}} {{.Status}}' 2>/dev/null \
        | awk '$1 ~ /^sgb-(mreh|rdreh)-/ && ($0 ~ /days? ago/ || $0 ~ /weeks? ago/ || $0 ~ /months? ago/) {print $1}')
  add docker-prune "이름 없는 이미지 · 매이지 않은 볼륨 · 빌드 캐시 $BUILD_CACHE_MAX 넘는 부분(docker prune)" 0
else info "건너뜀"; fi

say ""; say "[4] 임시 — /tmp 의 내 리허설 · 화면 시험 찌꺼기(1일 넘은 것)"
n=0
while IFS= read -r f; do [ -n "$f" ] && { add tmp "$f" "$(kb_of "$f")"; n=$((n+1)); }; done \
  < <(find "$TMPROOT" -maxdepth 1 -user "$(id -u)" \( -name 'migreh_*' -o -name 'rdreh_*' -o -name 'playwright*' \) -mtime +0 2>/dev/null)
[ "$n" = 0 ] && info "없음"

say ""; say "[5] 남긴 점검 결과 안 무거운 파일(3일 넘은 폴더 · 1MB 넘는 그림 · 동영상 · trace) $([ "$HEAVY" = 1 ] && echo '' || echo '— 이번에는 안 지움(여유 있음)')"
k=$(find "$RESDIR" -mindepth 2 -type f \( -name '*.png' -o -name '*.webm' -o -name '*.zip' \) -size +1M -mtime +2 -print0 2>/dev/null | du -skc --files0-from=- 2>/dev/null | tail -1 | cut -f1)
c=$(find "$RESDIR" -mindepth 2 -type f \( -name '*.png' -o -name '*.webm' -o -name '*.zip' \) -size +1M -mtime +2 2>/dev/null | wc -l)
if [ "${c:-0}" -gt 0 ]; then [ "$HEAVY" = 1 ] && add heavy "점검 결과 안 무거운 파일 ${c}개" "${k:-0}" || info "$(mb "${k:-0}") ${c}개(여유 없을 때 지움)"; else info "없음"; fi

say ""; say "[6] 도커 빌드 캐시 2gb · 14일 넘게 안 쓴 이름 있는 이미지 $([ "$HEAVY" = 1 ] && echo '' || echo '— 이번에는 안 지움(여유 있음)')"
IMGS=()
if [ "$DOCK" = 1 ]; then
  used=$(docker ps -a --format '{{.Image}}' 2>/dev/null | sort -u)
  while read -r ref id created; do
    [ -n "${ref:-}" ] || continue
    case "$ref" in '<none>:<none>') continue ;; esac
    skip=0; for kp in $KEEP_IMAGES; do case "$ref" in "$kp"|"$kp":*) skip=1 ;; esac; done
    echo "$used" | grep -qxF "$ref" && skip=1
    echo "$used" | grep -qxF "${ref%:latest}" && skip=1
    [ "$skip" = 1 ] && continue
    old=$(( ( $(date +%s) - $(date -d "${created% *}" +%s 2>/dev/null || date +%s) ) / 86400 ))
    [ "$old" -ge 14 ] || continue
    IMGS+=("$ref")
    [ "$HEAVY" = 1 ] && add image "$ref (${old}일)" 0 || info "이미지 $ref (${old}일 · 여유 없을 때 지움)"
  done < <(docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}' 2>/dev/null | awk '{print $1, $2, $3" "$4}')
  [ "$HEAVY" = 1 ] && add docker-cache2 "빌드 캐시를 2gb 까지" 0
  [ ${#IMGS[@]} -eq 0 ] && info "오래된 이름 있는 이미지 없음"
else info "건너뜀"; fi

say ""; say "[7] npm · pip 캐시 $([ "$HEAVY" = 1 ] && echo '' || echo '— 이번에는 안 지움(여유 있음)')"
kn=$(kb_of "$HOME/.npm/_cacache"); kp=$(kb_of "$HOME/.cache/pip")
if [ "$kn" -gt 1048576 ]; then [ "$HEAVY" = 1 ] && add npm "$HOME/.npm/_cacache" "$kn" || info "$(mb "$kn") npm 캐시(여유 없을 때 지움)"; else info "npm 캐시 $(mb "$kn") — 1GB 아래 · 둠"; fi
if [ "$kp" -gt 524288 ]; then [ "$HEAVY" = 1 ] && add pip "$HOME/.cache/pip" "$kp" || info "$(mb "$kp") pip 캐시(여유 없을 때 지움)"; else info "pip 캐시 $(mb "$kp") — 500MB 아래 · 둠"; fi

say ""; say "[8] 많이 차지하는 곳(읽기만 · 참고)"
du -skx "$HOME"/* "$HOME"/.[!.]* "$HOME/.local/share/docker" 2>/dev/null | sort -rn | head -8 | awk '{printf "        %6.1fGB  %s\n", $1/1024/1024, $2}' | tee -a "$OUT" >/dev/null
say "        (/var/log · snap · 다른 사용자 파일은 sudo 가 필요 — 대표 · 사람이 판단)"

say ""; say "지울 수 있는 것 약 $(mb "$TOTAL")(도커 정리 크기는 실행 뒤 디스크로 셈) · ${#TODO[@]}건"
if [ "$MODE" = list ]; then
  say "읽기만 했습니다. 지우려면: bash $0 --apply"
  ls -1t "$RESDIR"/disk-clean_*.txt 2>/dev/null | tail -n +11 | xargs -r rm -f
  say "== 디스크 정리 뒤 사용 ${U0}% · 지운 약 0MB(읽기만)"; exit 0
fi
if [ "$MODE" = --apply ] && [ "${CLEAN_YES:-0}" != 1 ]; then
  yn=""; read -r -p "위 ${#TODO[@]}건을 지웁니까? 지우려면 yes: " yn
  [ "$yn" = yes ] || { say "지우지 않았습니다."; exit 1; }
fi
for t in "${TODO[@]}"; do
  kind="${t%%	*}"; path="${t#*	}"
  case "$kind" in
    results|kit|tmp|npm|pip) case "$path" in "$HOME"/*|"$TMPROOT"/*) rm -rf -- "$path" ;; esac ;;
    file)         rm -f -- "$path" ;;
    container)    docker rm -f "$path" >/dev/null 2>&1 ;;
    docker-prune) docker image prune -f >/dev/null 2>&1; docker volume prune -f >/dev/null 2>&1; docker builder prune -f --max-used-space "$BUILD_CACHE_MAX" >/dev/null 2>&1 ;;
    heavy)        find "$RESDIR" -mindepth 2 -type f \( -name '*.png' -o -name '*.webm' -o -name '*.zip' \) -size +1M -mtime +2 -delete 2>/dev/null ;;
    image)        docker image rm "${path%% *}" >/dev/null 2>&1 ;;
    docker-cache2) docker builder prune -f --max-used-space 2gb >/dev/null 2>&1 ;;
  esac
done
ls -1t "$RESDIR"/disk-clean_*.txt 2>/dev/null | tail -n +11 | xargs -r rm -f
U1=$(use_pct)
say "== 디스크 정리 뒤 사용 ${U1}% · 지운 약 $(mb "$TOTAL")(도커 정리 빼고) · 정리 전 ${U0}%"
[ "${U1:-0}" -lt 85 ] || say "[주의] 디스크 ${U1}% — 85% 이상입니다. 운영 쪽 cleanup.sh 확인이 필요합니다"
exit 0
