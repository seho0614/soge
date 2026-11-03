#!/usr/bin/env bash
# =====================================================================
# 운영 서버 디스크 정리 (v10.186 · 2026-11-04 · docs/292) — 사람이 ubuntu 로 실행합니다.
#
#   bash ~/sgb/deploy/aws/cleanup.sh            # 읽기만 — 지울 수 있는 것 · 크기 · 많이 차지하는 폴더를 보여 줌(기본)
#   bash ~/sgb/deploy/aws/cleanup.sh --apply    # 위 목록을 보여 준 뒤 yes 를 받고 지움
#
#   지우는 것(이것만):
#     ① 푼 킷 · 킷 묶음 — 집 폴더 바로 아래 SGB_DevDocker_Integrated_* (폴더 · .zip · .tar.gz) 중 **지금 판 이하**인 것
#        (지금 판보다 새 킷은 적용을 기다리는 것이라 남김)
#     ② 적용 · 점검 기록 — ~/sgb-data/logs 의 파일 중 DAYS(기본 30)일 넘은 것
#     ③ npm 캐시 — ~/.npm/_cacache (다음 적용 때 다시 받음 · 설치가 조금 느려짐)
#     ④ pm2 로그 — ~/.pm2/logs/*.log 중 50MB 넘는 것을 비움(파일은 남김 · 앱이 계속 씀)
#   지우지 않는 것: 올린 파일(uploads) · 백업 묶음(uploads-backup.sh 가 KEEP 개만 남김) · 판 폴더(apply 가 정리) · .env · DB
#   sudo 가 필요한 것(시스템 기록 · snap)은 명령만 알려 줍니다.
#   결과: 화면 + ~/sgb-data/logs/cleanup_날짜_시각.txt
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
MODE="${1:-list}"
case "$MODE" in list|--apply) ;; *) echo "사용: cleanup.sh [--apply]"; exit 1 ;; esac
APP_LINK="${APP_LINK:-$HOME/sgb}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
DAYS="${DAYS:-30}"
mkdir -p "$DATA_DIR/logs"
OUT="$DATA_DIR/logs/cleanup_$(date +%Y%m%d_%H%M%S).txt"; : > "$OUT"
CURVER="$(cat "$APP_LINK/VERSION" 2>/dev/null || echo v0)"
kb_of() { du -skx "$@" 2>/dev/null | awk '{s+=$1} END {print s+0}'; }
mb() { echo "$(( $1 / 1024 ))MB"; }
TODO=()   # 지울 것 — 「종류<탭>경로」
TOTAL=0
add() { TODO+=("$1	$2"); TOTAL=$((TOTAL + $3)); info "$(printf '%-8s' "$(mb "$3")") $2"; }

say "소개뱅크 디스크 정리 — $([ "$MODE" = --apply ] && echo '지우기' || echo '읽기만') ($(date '+%Y-%m-%d %H:%M:%S %Z')) · 지금 판 $CURVER"
say "디스크: $(df -Ph / | awk 'NR==2 {print $5 " 사용 · 남은 " $4 " / " $2}')"

say ""; say "[1] 푼 킷 · 킷 묶음 (지금 판 $CURVER 이하)"
n=0
for f in "$HOME"/SGB_DevDocker_Integrated_*; do
  [ -e "$f" ] || continue
  v=$(basename "$f" | sed -E 's/^SGB_DevDocker_Integrated_[0-9]+_(v[0-9_]+)(\.zip|\.tar\.gz)?$/\1/; s/_/./g')
  case "$v" in v[0-9]*) ;; *) info "건너뜀(판을 읽지 못함) $f"; continue;; esac
  if [ "$(printf '%s\n%s\n' "$v" "$CURVER" | sort -V | tail -1)" = "$CURVER" ]; then add kit "$f" "$(kb_of "$f")"; n=$((n+1))
  else info "남김(지금보다 새 판 — 적용 대기) $f"; fi
done
[ "$n" = 0 ] && info "없음"

say ""; say "[2] 적용 · 점검 기록 ($DATA_DIR/logs · ${DAYS}일 넘은 것)"
old=$(find "$DATA_DIR/logs" -maxdepth 1 -type f -mtime +"$DAYS" ! -name "$(basename "$OUT")" 2>/dev/null)
if [ -n "$old" ]; then
  k=$(echo "$old" | tr '\n' '\0' | xargs -0 du -skc 2>/dev/null | tail -1 | cut -f1)
  add logs "$DATA_DIR/logs 의 ${DAYS}일 넘은 파일 $(echo "$old" | wc -l)개" "${k:-0}"
else info "없음"; fi

say ""; say "[3] npm 캐시"
if [ -d "$HOME/.npm/_cacache" ]; then add npm "$HOME/.npm/_cacache" "$(kb_of "$HOME/.npm/_cacache")"; else info "없음"; fi

say ""; say "[4] pm2 로그 (50MB 넘는 것을 비움)"
n=0
for f in "$HOME"/.pm2/logs/*.log; do
  [ -f "$f" ] || continue
  k=$(kb_of "$f"); [ "$k" -gt 51200 ] || continue
  add pm2log "$f" "$k"; n=$((n+1))
done
[ "$n" = 0 ] && info "없음"

say ""; say "[5] 많이 차지하는 곳 (읽기만 · 참고)"
du -skx "$HOME"/* "$HOME"/.[!.]* /var/log /var/cache /var/lib/snapd /usr /opt /tmp 2>/dev/null | sort -rn | head -8 \
  | awk '{printf "        %6.1fGB  %s\n", $1/1024/1024, $2}' | tee -a "$OUT"
say "        (시스템 기록 줄이기 — sudo journalctl --vacuum-size=500M · snap 옛 판 — sudo snap set system refresh.retain=2: 사람이 판단)"

say ""; say "지울 수 있는 것 합계 약 $(mb "$TOTAL") · ${#TODO[@]}건"
if [ "$MODE" != --apply ]; then
  say "읽기만 했습니다. 지우려면: bash $HERE/cleanup.sh --apply"
  say "기록: $OUT"; exit 0
fi
[ "${#TODO[@]}" -gt 0 ] || { say "지울 것이 없습니다."; exit 0; }
yn=""
if [ "${CLEANUP_YES:-0}" = "1" ]; then yn=yes; else read -r -p "위 ${#TODO[@]}건(약 $(mb "$TOTAL"))을 지웁니까? 지우려면 yes: " yn; fi
[ "$yn" = "yes" ] || { say "지우지 않았습니다."; exit 1; }
for t in "${TODO[@]}"; do
  kind="${t%%	*}"; path="${t#*	}"
  case "$kind" in
    kit)    rm -rf -- "$path" && info "지움 $path" ;;
    logs)   find "$DATA_DIR/logs" -maxdepth 1 -type f -mtime +"$DAYS" ! -name "$(basename "$OUT")" -delete && info "지움 ${DAYS}일 넘은 기록" ;;
    npm)    rm -rf -- "$path" && info "지움 $path" ;;
    pm2log) : > "$path" && info "비움 $path" ;;
  esac
done
say "디스크: $(df -Ph / | awk 'NR==2 {print $5 " 사용 · 남은 " $4 " / " $2}')"
say "기록: $OUT"
