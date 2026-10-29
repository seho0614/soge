#!/usr/bin/env bash
# =====================================================================
# 서버 디스크 파일 → S3 옮기기 (v10.149 · 2026-10-29 · docs/229) — 사람이 ubuntu 로 실행합니다.
#
#   bash ~/sgb/deploy/aws/files-to-s3.sh                 # check  — 읽기만(버킷 · 권한 · CORS · 파일 수)
#   bash ~/sgb/deploy/aws/files-to-s3.sh copy            # copy   — 디스크 → S3 복사(aws s3 sync · 지우지 않음 · 다시 돌려도 안전)
#   bash ~/sgb/deploy/aws/files-to-s3.sh verify          # verify — DB 의 디스크 기록 파일이 S3 에 같은 크기로 있는지(읽기만)
#   bash ~/sgb/deploy/aws/files-to-s3.sh apply           # apply  — verify 통과한 파일만 DB 저장 위치를 S3 로(한 거래 · yes)
#
#   버킷 이름: .env 의 S3_BUCKET (없으면 S3_BUCKET=… 를 앞에 붙여 실행)
#   ★ 지우는 것 없음 — 디스크 파일은 그대로 남습니다(정리는 1주 뒤 사람이 · docs/229 5절).
#   ★ 앱이 S3 로 바뀐 뒤(.env S3_BUCKET + 재시작)에는 내려받기가 S3 로 갑니다 — 재시작 **전에** copy · verify 를 끝내십시오.
#
#   APP_LINK  앱 폴더(기본 ~/sgb) · DATA_DIR(기본 ~/sgb-data) · UPLOAD_DIR(.env · 기본 $DATA_DIR/uploads)
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
MODE="${1:-check}"
APP_LINK="${APP_LINK:-$HOME/sgb}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
mkdir -p "$DATA_DIR/logs"
OUT="$DATA_DIR/logs/files-to-s3_${MODE}_$(date +%Y%m%d_%H%M%S).txt"; : > "$OUT"
OKLIST="$DATA_DIR/logs/files-to-s3_verified.txt"
PASS=0; FAIL=0; WARN=0
case "$MODE" in check|copy|verify|apply) ;; *) echo "사용: files-to-s3.sh [check|copy|verify|apply]"; exit 1 ;; esac
CLI_BUCKET="${S3_BUCKET:-}"
load_env "$APP_LINK/.env" || { echo "!! $APP_LINK/.env 가 없습니다"; exit 1; }
: "${DATABASE_URL:?DATABASE_URL 이 .env 에 없습니다}"
B="${CLI_BUCKET:-${S3_BUCKET:-}}"
UP="${UPLOAD_DIR:-$DATA_DIR/uploads}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-northeast-2}}"

say "소개뱅크 파일 S3 옮기기 — $MODE ($(date '+%Y-%m-%d %H:%M:%S %Z')) · 앱 $(cat "$APP_LINK/VERSION" 2>/dev/null || echo '?')"
say "  버킷 ${B:-(없음)} · 디스크 $UP · 지역 $REGION"
[ -n "$B" ] || { bad "버킷 이름 없음" "S3_BUCKET=버킷이름 bash $0 $MODE  (또는 .env 에 S3_BUCKET)"; exit 1; }
command -v aws >/dev/null || { bad "aws 명령 없음" "AWS CLI v2 설치 — docs/229 2절"; exit 1; }

LOCAL_N=$(q "SELECT count(*) FROM files WHERE storage_provider = 'LOCAL' AND status <> 'DELETED'")
READY_N=$(q "SELECT count(*) FROM files WHERE storage_provider = 'LOCAL' AND status = 'READY'")

if [ "$MODE" = check ]; then
  say ""; say "[1] S3 버킷 · 권한"
  if aws s3api head-bucket --bucket "$B" --region "$REGION" >/dev/null 2>&1; then ok "버킷에 닿음" "$B"; else bad "버킷에 닿지 못함" "이름 · 지역 · 서버 역할(IAM) 권한 — docs/229 2절"; fi
  pab=$(aws s3api get-public-access-block --bucket "$B" --region "$REGION" --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,BlockPublicPolicy,IgnorePublicAcls,RestrictPublicBuckets]' --output text 2>/dev/null)
  [ "$pab" = "True	True	True	True" ] && ok "공개 차단 4개 켜짐" || bad "공개 차단이 다 켜져 있지 않음" "${pab:-읽지 못함} — 파일은 서버가 만든 짧은 주소로만 엽니다"
  if aws s3api get-bucket-cors --bucket "$B" --region "$REGION" --query 'CORSRules[].AllowedOrigins[]' --output text 2>/dev/null | grep -q 'sogaebank.com'; then
    ok "CORS 에 sogaebank.com" "브라우저가 S3 로 바로 올림"
  else bad "CORS 에 sogaebank.com 없음" "docs/229 2-3 의 CORS 를 넣으십시오 — 없으면 회원 파일 올리기가 실패합니다"; fi
  t="sgb-s3-check/$(date +%s).txt"
  if echo check | aws s3 cp - "s3://$B/$t" --region "$REGION" --sse AES256 --only-show-errors 2>/dev/null && aws s3 rm "s3://$B/$t" --region "$REGION" --only-show-errors 2>/dev/null; then
    ok "쓰기 · 지우기 권한" "시험 파일 하나 올렸다 지움"
  else bad "쓰기 권한 없음" "서버 역할에 s3:PutObject · GetObject · DeleteObject · ListBucket"; fi
  say ""; say "[2] 파일"
  [ -d "$UP" ] && ok "디스크 폴더" "$UP · $(find "$UP" -type f | wc -l)개 · $(du -sh "$UP" 2>/dev/null | cut -f1)" || warn "디스크 폴더 없음" "$UP — 올린 파일이 없으면 정상"
  info "DB: 디스크 기록 $LOCAL_N개(쓰는 것 $READY_N) · S3 기록 $(q "SELECT count(*) FROM files WHERE storage_provider = 'S3' AND status <> 'DELETED'")개"
  miss=0
  while IFS= read -r k; do [ -n "$k" ] && [ ! -f "$UP/$k" ] && miss=$((miss+1)); done < <(qn "SELECT storage_key FROM files WHERE storage_provider = 'LOCAL' AND status = 'READY'")
  chk "$miss" "쓰는 파일이 디스크에 다 있음" "없는 것 ${miss}개"
  say ""; say "읽기만 했습니다. 통과 $PASS · 실패 $FAIL · 확인 $WARN · 결과 파일 $OUT"; [ "$FAIL" = 0 ]; exit $?
fi

if [ "$MODE" = copy ]; then
  [ -d "$UP" ] || { warn "디스크 폴더 없음 — 옮길 것 없음" "$UP"; exit 0; }
  say ""; say "[복사] $UP → s3://$B/ (같은 키 · 서버 쪽 암호화 AES256 · 지우지 않음)"
  aws s3 sync "$UP" "s3://$B/" --region "$REGION" --sse AES256 --no-progress --only-show-errors --exclude 'sgb-s3-check/*' 2>&1 | tee -a "$OUT"
  rc=${PIPESTATUS[0]}
  [ "$rc" = 0 ] && ok "복사 끝" "다음: bash $0 verify" || bad "복사 실패(rc=$rc)" "다시 돌려도 안전합니다 — 이미 간 파일은 건너뜀"
  exit "$rc"
fi

# verify · apply 공통 — DB 의 디스크 기록 파일(지운 것 빼고)마다 S3 에 같은 크기로 있는지
say ""; say "[대조] DB 디스크 기록 ${LOCAL_N}개 ↔ s3://$B"
listing=$(mktemp); trap 'rm -f "$listing"' EXIT
aws s3api list-objects-v2 --bucket "$B" --region "$REGION" --query 'Contents[].[Key,Size]' --output text 2>/dev/null > "$listing" || { bad "버킷 목록을 읽지 못함"; exit 1; }
: > "$OKLIST.tmp"; good=0; miss=0; diff=0
while IFS='|' read -r id k sz; do
  [ -n "$id" ] || continue
  s3sz=$(awk -v k="$k" '$1 == k { print $2; exit }' "$listing")
  if [ -z "$s3sz" ]; then miss=$((miss+1)); [ "$miss" -le 10 ] && info "S3 에 없음: $k"
  elif [ "$s3sz" != "$sz" ]; then diff=$((diff+1)); [ "$diff" -le 10 ] && info "크기 다름: $k (DB $sz · S3 $s3sz)"
  else good=$((good+1)); echo "$id" >> "$OKLIST.tmp"; fi
done < <(qn "SELECT id || '|' || storage_key || '|' || size_bytes FROM files WHERE storage_provider = 'LOCAL' AND status <> 'DELETED'")
mv "$OKLIST.tmp" "$OKLIST"
say "  같음 $good · S3 에 없음 $miss · 크기 다름 $diff (UPLOADING 은 올리다 만 것 — 없어도 됩니다)"
ready_ok=$(q "SELECT count(*) FROM files WHERE storage_provider = 'LOCAL' AND status = 'READY' AND id::text IN ($( (sed "s/.*/'&'/" "$OKLIST"; echo "''") | paste -sd, -))")
ready_bad=$(( READY_N - ${ready_ok:-0} ))
[ "$ready_bad" -le 0 ] && ok "쓰는 파일(READY)이 S3 에 다 있음" || bad "쓰는 파일 중 S3 에 없거나 다른 것 $ready_bad 개" "copy 를 다시 돌린 뒤 verify"

if [ "$MODE" = verify ]; then
  say ""; say "읽기만 했습니다. 다음: bash $0 apply · 결과 파일 $OUT"; [ "$FAIL" = 0 ]; exit $?
fi

# apply — verify 를 통과한 파일만 DB 저장 위치를 S3 로
[ "$FAIL" = 0 ] || { say "  멈춤 — 쓰는 파일이 다 옮겨지지 않았습니다. 아무것도 바꾸지 않았습니다"; exit 1; }
n=$(grep -c . "$OKLIST" 2>/dev/null || echo 0)
[ "$n" -gt 0 ] || { ok "바꿀 것 없음" "디스크 기록 0"; exit 0; }
say ""; say "[적용] 대조가 같은 파일 ${n}개의 저장 위치를 S3 로 (한 거래 · 디스크 파일은 지우지 않음)"
printf "앱이 이미 S3_BUCKET 으로 재시작되었습니까? 바꾸면 이 파일들은 S3 에서만 엽니다 (yes/no): "
read -r yn
[ "$yn" = "yes" ] || { say "  멈춤 — 아무것도 바꾸지 않았습니다"; exit 1; }
ids=$(sed "s/.*/'&'/" "$OKLIST" | paste -sd, -)
res=$(db -v ON_ERROR_STOP=1 -t -A -c "BEGIN; SET LOCAL sgb.files_move = 'on'; UPDATE files SET storage_provider = 'S3' WHERE storage_provider = 'LOCAL' AND id IN ($ids); COMMIT;" 2>&1)
if echo "$res" | grep -q '^UPDATE\|COMMIT'; then ok "저장 위치 바꿈" "$(echo "$res" | grep '^UPDATE')"; else bad "적용 실패 — 되돌려짐" "$(echo "$res" | head -3)"; fi
say "  남은 디스크 기록 $(q "SELECT count(*) FROM files WHERE storage_provider = 'LOCAL' AND status <> 'DELETED'")개 · 결과 파일 $OUT"
[ "$FAIL" = 0 ]
