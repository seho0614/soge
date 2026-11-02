#!/usr/bin/env bash
# =====================================================================
# 올린 파일(디스크) 하루 백업 (v10.176 · 2026-11-02 · docs/273) — 사람이 ubuntu 로 실행하거나 cron 에 등록합니다.
#
#   bash ~/sgb/deploy/aws/uploads-backup.sh            # 오늘 묶음 만들기(이미 있으면 건너뜀 · 다시 돌려도 안전)
#   bash ~/sgb/deploy/aws/uploads-backup.sh check      # 읽기만 — 파일 수 · 크기 · 디스크 여유 · 남은 묶음
#
#   cron 예(매일 04:30 KST · 서버 시간대가 UTC 면 19:30):
#     30 19 * * * bash /home/ubuntu/sgb/deploy/aws/uploads-backup.sh >/dev/null 2>&1
#
#   왜: RDS 스냅샷에는 DB 만 들어가고 **올린 파일(사진 · 영상)은 빠집니다**.
#   무엇: UPLOAD_DIR(.env · 기본 ~/sgb-data/uploads) → BACKUP_DIR(기본 ~/sgb-data/backup/uploads)/uploads_YYYYMMDD.tar.gz
#         KEEP 개(기본 7)만 남기고 그보다 오래된 「uploads_*.tar.gz」만 지웁니다(다른 파일은 건드리지 않음).
#   ★ 같은 디스크 안의 백업입니다 — 실수로 지운 파일 · 앱 오류는 되살리지만 디스크(EBS) 자체가 망가지면 같이 잃습니다.
#     디스크 통째 보호는 EBS 스냅샷 예약(콘솔 · docs/273 4절) 또는 S3 로 옮기기(files-to-s3.sh)입니다.
#   ★ 디스크 여유가 (올린 파일 크기 + 1GB) 보다 적으면 만들지 않고 운영 알림 UPLOADS_BACKUP_SKIPPED(WARN)를 남깁니다.
#   종료 값: 0 만듦 · 이미 있음 · 올린 파일 없음 / 1 실패 / 2 디스크 부족으로 건너뜀
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
MODE="${1:-run}"
case "$MODE" in run|check) ;; *) echo "사용: uploads-backup.sh [check]"; exit 1 ;; esac
APP_LINK="${APP_LINK:-$HOME/sgb}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
KEEP="${KEEP:-7}"
mkdir -p "$DATA_DIR/logs"
OUT="$DATA_DIR/logs/uploads-backup_$(date +%Y%m%d).txt"
load_env "$APP_LINK/.env" || { echo "!! $APP_LINK/.env 가 없습니다"; exit 1; }
UP="${UPLOAD_DIR:-$DATA_DIR/uploads}"
BK="${BACKUP_DIR:-$DATA_DIR/backup/uploads}"
DAY="$(TZ=Asia/Seoul date +%Y%m%d)"
DEST="$BK/uploads_$DAY.tar.gz"

alert() {   # 운영 알림 한 줄(DB 가 안 되면 기록만) — 같은 날 두 번 남기지 않음
  [ -n "${DATABASE_URL:-}" ] || return 0
  q "INSERT INTO ops_alerts (alert_code, severity, title, detail)
     SELECT 'UPLOADS_BACKUP_SKIPPED', 'WARN', '올린 파일 백업을 건너뜀 — 디스크 여유 부족', jsonb_build_object('day', '$DAY', 'needKB', $1, 'freeKB', $2)
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_SKIPPED' AND detail->>'day' = '$DAY')" >/dev/null
}

say "== 올린 파일 백업 — $MODE ($(date '+%Y-%m-%d %H:%M:%S %Z')) · 앱 $(cat "$APP_LINK/VERSION" 2>/dev/null || echo '?')"
say "   원본 $UP · 보관 $BK · 남길 개수 $KEEP"
if [ ! -d "$UP" ] || [ -z "$(find "$UP" -type f -print -quit 2>/dev/null)" ]; then
  say "   올린 파일이 없습니다(또는 폴더 없음) — 할 일 없음"; exit 0
fi
N=$(find "$UP" -type f | wc -l)
USED_KB=$(du -sk "$UP" | cut -f1)
mkdir -p "$BK"
FREE_KB=$(df -Pk "$BK" | awk 'NR==2{print $4}')
NEED_KB=$((USED_KB + 1048576))
say "   파일 ${N}개 · $((USED_KB / 1024))MB · 디스크 여유 $((FREE_KB / 1024))MB(필요 $((NEED_KB / 1024))MB)"
say "   남은 묶음: $(ls -1 "$BK"/uploads_*.tar.gz 2>/dev/null | wc -l)개 $(ls -1 "$BK"/uploads_*.tar.gz 2>/dev/null | tail -1 | xargs -r basename)"
LAST="$(ls -1t "$BK"/uploads_*.tar.gz 2>/dev/null | head -1)"   # v10.177 — 가장 최근 묶음이 몇 시간 전인지(36시간 넘으면 운영 알림 UPLOADS_BACKUP_STALE · 하루 요약 때)
[ -n "$LAST" ] && say "   가장 최근: $(basename "$LAST") · $(( ($(date +%s) - $(stat -c %Y "$LAST")) / 3600 ))시간 전 · 되살리기는 uploads-restore.sh"

[ "$MODE" = check ] && exit 0

if [ -f "$DEST" ]; then say "   오늘 묶음이 이미 있습니다 — $DEST"; exit 0; fi
if [ "$FREE_KB" -lt "$NEED_KB" ]; then
  say "!! 디스크 여유 부족 — 만들지 않음(운영 알림 UPLOADS_BACKUP_SKIPPED)"; alert "$NEED_KB" "$FREE_KB"; exit 2
fi

TMP="$DEST.part"
if ! tar -czf "$TMP" -C "$(dirname "$UP")" "$(basename "$UP")" 2>>"$OUT"; then
  rm -f "$TMP"; say "!! 묶기 실패 — $OUT"; exit 1
fi
IN_TAR=$(tar -tzf "$TMP" 2>/dev/null | grep -vc '/$')
if [ "$IN_TAR" -lt "$N" ]; then
  rm -f "$TMP"; say "!! 묶음 확인 실패 — 묶음 ${IN_TAR}개 < 원본 ${N}개"; exit 1
fi
mv "$TMP" "$DEST"
say "   만듦 — $DEST ($(du -k "$DEST" | cut -f1 | awk '{printf "%d", $1/1024}')MB · 파일 ${IN_TAR}개)"

ls -1t "$BK"/uploads_*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old"; say "   오래된 묶음 지움 — $(basename "$old")"
done
exit 0
