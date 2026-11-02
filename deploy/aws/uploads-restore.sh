#!/usr/bin/env bash
# =====================================================================
# 올린 파일 되살리기 (v10.177 · 2026-11-02 · docs/275) — 사람이 ubuntu 로 실행합니다. uploads-backup.sh 의 짝입니다.
#
#   bash ~/sgb/deploy/aws/uploads-restore.sh                         # 묶음 목록(읽기만)
#   bash ~/sgb/deploy/aws/uploads-restore.sh show latest             # 묶음 안 파일 수 · 앞 20개(읽기만)
#   bash ~/sgb/deploy/aws/uploads-restore.sh extract latest          # 따로 있는 폴더(~/sgb-data/restore/…)에 통째로 풀기
#   bash ~/sgb/deploy/aws/uploads-restore.sh file latest 2026/11/a.jpg   # 파일 하나만 올린 파일 폴더로(이미 있으면 거절)
#
#   묶음 이름은 uploads_YYYYMMDD.tar.gz · uploads_YYYYMMDD · YYYYMMDD · latest(가장 최근) 중 하나.
#   ★ 올린 파일 폴더(UPLOAD_DIR)의 파일을 **덮어쓰거나 지우지 않습니다**. 통째로 되돌릴 때는 extract 로 푼 뒤
#     사람이 눈으로 확인하고 필요한 것만 옮기십시오(예: cp -n -r 풀린곳/uploads/. ~/sgb-data/uploads/).
#   종료 값: 0 됨 / 1 실패 · 거절
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
MODE="${1:-list}"
case "$MODE" in list|show|extract|file) ;; *) echo "사용: uploads-restore.sh [list | show 묶음 | extract 묶음 | file 묶음 경로]"; exit 1 ;; esac
APP_LINK="${APP_LINK:-$HOME/sgb}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
load_env "$APP_LINK/.env" || { echo "!! $APP_LINK/.env 가 없습니다"; exit 1; }
UP="${UPLOAD_DIR:-$DATA_DIR/uploads}"
BK="${BACKUP_DIR:-$DATA_DIR/backup/uploads}"
TOP="$(basename "$UP")"   # 묶음 안의 맨 위 폴더 이름(uploads-backup.sh 가 -C 부모 폴더로 묶음)

pick() {   # 묶음 이름 → 전체 경로
  local a="${1:-}" f
  case "$a" in
    latest) f="$(ls -1t "$BK"/uploads_*.tar.gz 2>/dev/null | head -1)" ;;
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) f="$BK/uploads_$a.tar.gz" ;;
    uploads_[0-9]*.tar.gz) f="$BK/$a" ;;
    uploads_[0-9]*) f="$BK/$a.tar.gz" ;;
    *) f="" ;;
  esac
  [ -n "$f" ] && [ -f "$f" ] && { echo "$f"; return 0; }
  echo "!! 묶음을 찾지 못했습니다: '${a}' — 목록: bash $0" >&2; return 1
}

say "== 올린 파일 되살리기 — $MODE ($(date '+%Y-%m-%d %H:%M:%S %Z'))"
say "   보관 $BK · 올린 파일 폴더 $UP"

if [ "$MODE" = list ]; then
  n=0
  for f in $(ls -1t "$BK"/uploads_*.tar.gz 2>/dev/null); do
    n=$((n + 1)); say "   $(basename "$f") · $(du -k "$f" | cut -f1 | awk '{printf "%d", $1/1024}')MB · $(( ($(date +%s) - $(stat -c %Y "$f")) / 3600 ))시간 전"
  done
  [ "$n" = 0 ] && say "   묶음이 없습니다 — 먼저 uploads-backup.sh 를 돌리십시오(docs/273 4절 2)"
  exit 0
fi

F="$(pick "${2:-}")" || exit 1

if [ "$MODE" = show ]; then
  say "   $(basename "$F") — 파일 $(tar -tzf "$F" 2>/dev/null | grep -vc '/$')개 · 앞 20개:"
  tar -tzf "$F" 2>/dev/null | grep -v '/$' | head -20 | sed 's/^/     /'
  exit 0
fi

if [ "$MODE" = extract ]; then
  DEST="$DATA_DIR/restore/$(basename "$F" .tar.gz)_$(date +%H%M%S)"
  mkdir -p "$DEST" || exit 1
  if ! tar -xzf "$F" -C "$DEST" --no-same-owner 2>/dev/null; then say "!! 풀기 실패 — $F"; exit 1; fi
  say "   풀었습니다 — $DEST/$TOP (파일 $(find "$DEST" -type f | wc -l)개)"
  say "   올린 파일 폴더는 그대로입니다. 필요한 것만 옮기십시오 — 있는 파일은 건너뜀: cp -n -r \"$DEST/$TOP/.\" \"$UP/\""
  exit 0
fi

# file — 파일 하나
REL="${3:-}"
REL="${REL#/}"; REL="${REL#"$TOP"/}"
if [ -z "$REL" ] || [[ "$REL" == *..* ]]; then say "!! 경로가 비었거나 .. 가 들어 있습니다 — 올린 파일 폴더 안 경로(예: 2026/11/a.jpg)"; exit 1; fi
if [ -e "$UP/$REL" ]; then say "!! 이미 있는 파일입니다 — 덮어쓰지 않습니다: $UP/$REL"; exit 1; fi
if ! tar -tzf "$F" "$TOP/$REL" >/dev/null 2>&1; then say "!! 묶음 안에 없는 파일입니다: $TOP/$REL"; exit 1; fi
mkdir -p "$(dirname "$UP/$REL")" || exit 1
if ! tar -xzf "$F" -C "$(dirname "$UP")" --no-same-owner "$TOP/$REL" 2>/dev/null; then say "!! 되살리기 실패 — $REL"; exit 1; fi
say "   되살렸습니다 — $UP/$REL ($(basename "$F") 에서)"
exit 0
