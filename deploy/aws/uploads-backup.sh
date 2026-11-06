#!/usr/bin/env bash
# =====================================================================
# 올린 파일(디스크) 하루 백업 (v10.176 · 2026-11-02 · docs/273) — 사람이 ubuntu 로 실행하거나 cron 에 등록합니다.
#
#   bash ~/sgb/deploy/aws/uploads-backup.sh            # 오늘 묶음 만들기(이미 있으면 건너뜀 · 다시 돌려도 안전)
#   bash ~/sgb/deploy/aws/uploads-backup.sh check      # 읽기만 — 파일 수 · 크기 · 디스크 여유 · 남은 묶음
#
#   v10.196 (docs/308) — **cron 필요 없음**: 배치 호출기(pm2 sgb-jobs)가 매일 04:30(한국 시간 · .env UPLOADS_BACKUP_DAILY) 뒤 한 번 부릅니다.
#     cron 을 이미 등록했어도 해 없음(오늘 묶음이 있으면 건너뜀). 옛 cron 예(매일 04:30 KST · 서버 시간대가 UTC 면 19:30):
#     30 19 * * * bash /home/ubuntu/sgb/deploy/aws/uploads-backup.sh >/dev/null 2>&1
#
#   v10.197 (docs/310) — **디스크 밖(S3)에도 한 벌**: .env 에 BACKUP_S3_BUCKET(앱 파일 저장 S3_BUCKET 과 다른 값)이 있으면
#     묶음을 aws s3 cp 로 s3://버킷/uploads-backup/ 에 올림(BACKUP_S3_PREFIX 로 바꿈 · 서버 역할(IAM) 권한 사용 · 열쇠를 .env 에 넣지 않음).
#     올린 묶음 옆에 표시 파일(uploads_YYYYMMDD.tar.gz.s3)을 두어 두 번 올리지 않음 · 오늘 묶음이 이미 있어도 아직 안 올렸으면 올림.
#     실패하면 운영 알림 UPLOADS_BACKUP_OFFSITE_FAILED(WARN · 하루 한 번) · 종료 값 3(디스크 안 묶음은 그대로 성공). 값이 없으면 지금과 같음(꺼짐).
#     S3 쪽 오래된 묶음 지우기는 버킷 보관 규칙(수명 주기)으로 — 이 스크립트는 S3 에서 지우지 않음.
#
#   v10.198 (docs/312) — **실패를 바로 알림**: 묶기 · 묶음 확인이 실패하면 운영 알림 UPLOADS_BACKUP_FAILED(WARN · 하루 한 번 · 메일 대상)
#     — 전에는 36시간 뒤 「멈춤」(UPLOADS_BACKUP_STALE)으로만 알았음.
#     **7일에 한 번 남은 묶음 전부를 압축 검사(gzip -t)** — 디스크를 더 쓰지 않음 · 깨진 묶음이 있으면 UPLOADS_BACKUP_BAD(WARN · 하루 한 번 · 메일 대상)
#     · 결과는 $BACKUP_DIR/.verified 한 줄(check · postcheck 가 보여 줌). 종료 값은 그대로(알림으로 알림).
#
#   왜: RDS 스냅샷에는 DB 만 들어가고 **올린 파일(사진 · 영상)은 빠집니다**.
#   무엇: UPLOAD_DIR(.env · 기본 ~/sgb-data/uploads) → BACKUP_DIR(기본 ~/sgb-data/backup/uploads)/uploads_YYYYMMDD.tar.gz
#         KEEP 개(기본 7)만 남기고 그보다 오래된 「uploads_*.tar.gz」만 지웁니다(다른 파일은 건드리지 않음).
#   ★ 같은 디스크 안의 백업입니다 — 실수로 지운 파일 · 앱 오류는 되살리지만 디스크(EBS) 자체가 망가지면 같이 잃습니다.
#     디스크 통째 보호는 EBS 스냅샷 예약(콘솔 · docs/273 4절) 또는 S3 로 옮기기(files-to-s3.sh)입니다.
#   ★ 디스크 여유가 (올린 파일 크기 + 1GB) 보다 적으면 만들지 않고 운영 알림 UPLOADS_BACKUP_SKIPPED(WARN)를 남깁니다.
#   종료 값: 0 만듦 · 이미 있음 · 올린 파일 없음 / 1 실패 / 2 디스크 부족으로 건너뜀 / 3 디스크 밖(S3) 올리기 실패(v10.197)
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
S3B="${BACKUP_S3_BUCKET:-}"
S3P="${BACKUP_S3_PREFIX:-uploads-backup}"
if [ -n "$S3B" ] && ! [[ "$S3B" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ && "$S3P" =~ ^[A-Za-z0-9._/-]{1,100}$ ]]; then
  echo "!! BACKUP_S3_BUCKET · BACKUP_S3_PREFIX 형식이 틀립니다 — 디스크 밖 올리기를 건너뜁니다"; S3B=""
fi

alert() {   # 운영 알림 한 줄(DB 가 안 되면 기록만) — 같은 날 두 번 남기지 않음
  [ -n "${DATABASE_URL:-}" ] || return 0
  q "INSERT INTO ops_alerts (alert_code, severity, title, detail)
     SELECT 'UPLOADS_BACKUP_SKIPPED', 'WARN', '올린 파일 백업을 건너뜀 — 디스크 여유 부족', jsonb_build_object('day', '$DAY', 'needKB', $1, 'freeKB', $2)
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_SKIPPED' AND detail->>'day' = '$DAY')" >/dev/null
}

note() {   # v10.198 — 운영 알림 한 줄(종류 · 제목 · detail jsonb 식) — 같은 종류 · 같은 날 한 번
  [ -n "${DATABASE_URL:-}" ] || return 0
  q "INSERT INTO ops_alerts (alert_code, severity, title, detail)
     SELECT '$1', 'WARN', '$2', $3
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = '$1' AND detail->>'day' = '$DAY')" >/dev/null
}

# v10.198 — 7일에 한 번 남은 묶음 전부 압축 검사(gzip -t · 읽기만). 깨진 것이 있으면 UPLOADS_BACKUP_BAD
VER="$BK/.verified"
verify_weekly() {
  [ -f "$VER" ] && [ -z "$(find "$VER" -mtime +6 2>/dev/null)" ] && return 0
  local all=0 bad=() f
  for f in "$BK"/uploads_*.tar.gz; do
    [ -f "$f" ] || continue; all=$((all + 1))
    gzip -t "$f" 2>>"$OUT" || bad+=("$(basename "$f")")
  done
  echo "$(date '+%Y-%m-%d %H:%M') 묶음 ${all}개 · 깨짐 ${#bad[@]}${bad[*]:+ (${bad[*]})}" > "$VER"
  if [ "${#bad[@]}" -gt 0 ]; then
    say "!! 묶음 검사 — 깨진 묶음 ${#bad[@]}개: ${bad[*]}(운영 알림 UPLOADS_BACKUP_BAD)"
    note UPLOADS_BACKUP_BAD '올린 파일 백업 묶음이 깨짐 — 되살리기에 쓸 수 없음 · 디스크를 확인' "jsonb_build_object('day', '$DAY', 'bad', '${bad[*]}', 'all', $all)"
  else
    say "   묶음 검사 — ${all}개 모두 정상(gzip -t · 다음 검사 7일 뒤)"
  fi
}

# v10.197 — 디스크 밖(S3) 한 벌. 이미 올렸으면(표시 파일) 건너뜀. 실패 = 운영 알림(하루 한 번) · 종료 값 3
offsite() {
  [ -n "$S3B" ] || return 0
  [ -f "$DEST.s3" ] && { say "   디스크 밖(S3)에 이미 올림 — s3://$S3B/$S3P/$(basename "$DEST")"; return 0; }
  if aws s3 cp "$DEST" "s3://$S3B/$S3P/$(basename "$DEST")" --only-show-errors >>"$OUT" 2>&1; then
    date '+%Y-%m-%d %H:%M:%S %Z' > "$DEST.s3"; say "   디스크 밖(S3)에 올림 — s3://$S3B/$S3P/$(basename "$DEST")"; return 0
  fi
  say "!! 디스크 밖(S3) 올리기 실패 — $OUT(운영 알림 UPLOADS_BACKUP_OFFSITE_FAILED)"
  [ -n "${DATABASE_URL:-}" ] && q "INSERT INTO ops_alerts (alert_code, severity, title, detail)
     SELECT 'UPLOADS_BACKUP_OFFSITE_FAILED', 'WARN', '올린 파일 백업을 디스크 밖(S3)에 올리지 못함 — 서버 역할 권한 · 버킷을 확인', jsonb_build_object('day', '$DAY', 'bucket', '$S3B')
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'UPLOADS_BACKUP_OFFSITE_FAILED' AND detail->>'day' = '$DAY')" >/dev/null
  return 3
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
if [ -n "$S3B" ]; then
  LS3="$(ls -1t "$BK"/uploads_*.tar.gz.s3 2>/dev/null | head -1)"
  say "   디스크 밖(S3): 켜짐 s3://$S3B/$S3P/ · 마지막 올린 묶음 $([ -n "$LS3" ] && basename "$LS3" .s3 || echo '없음')"
else
  say "   디스크 밖(S3): 꺼짐(.env BACKUP_S3_BUCKET 없음)"
fi
say "   묶음 검사(7일마다 gzip -t): $([ -f "$VER" ] && cat "$VER" || echo '아직 없음')"

[ "$MODE" = check ] && exit 0

if [ -f "$DEST" ]; then say "   오늘 묶음이 이미 있습니다 — $DEST"; verify_weekly; offsite; exit $?; fi
if [ "$FREE_KB" -lt "$NEED_KB" ]; then
  say "!! 디스크 여유 부족 — 만들지 않음(운영 알림 UPLOADS_BACKUP_SKIPPED)"; alert "$NEED_KB" "$FREE_KB"; exit 2
fi

TMP="$DEST.part"
if ! tar -czf "$TMP" -C "$(dirname "$UP")" "$(basename "$UP")" 2>>"$OUT"; then
  rm -f "$TMP"; say "!! 묶기 실패 — $OUT(운영 알림 UPLOADS_BACKUP_FAILED)"
  note UPLOADS_BACKUP_FAILED '올린 파일 백업 실패 — 묶기 실패 · 서버 로그 확인' "jsonb_build_object('day', '$DAY', 'step', 'tar')"; exit 1
fi
IN_TAR=$(tar -tzf "$TMP" 2>/dev/null | grep -vc '/$')
if [ "$IN_TAR" -lt "$N" ]; then
  rm -f "$TMP"; say "!! 묶음 확인 실패 — 묶음 ${IN_TAR}개 < 원본 ${N}개(운영 알림 UPLOADS_BACKUP_FAILED)"
  note UPLOADS_BACKUP_FAILED '올린 파일 백업 실패 — 묶음 파일 수가 원본보다 적음' "jsonb_build_object('day', '$DAY', 'step', 'verify', 'inTar', $IN_TAR, 'files', $N)"; exit 1
fi
mv "$TMP" "$DEST"
say "   만듦 — $DEST ($(du -k "$DEST" | cut -f1 | awk '{printf "%d", $1/1024}')MB · 파일 ${IN_TAR}개)"

ls -1t "$BK"/uploads_*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old" "$old.s3"; say "   오래된 묶음 지움 — $(basename "$old")"
done
verify_weekly
offsite; exit $?
