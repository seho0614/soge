#!/usr/bin/env bash
# =====================================================================
# AWS 서버에 새 판을 올립니다.   bash ~/SGB_DevDocker_Integrated_…/sgb/deploy/aws/apply.sh
#
# 순서 (앞 단계가 실패하면 거기서 멈추고, **돌던 서비스는 그대로 돕니다**)
#   0. 전제 확인      Node 22 · 메모리 3.5GB(스왑 포함) · 디스크 4GB · .env · DB 접속 · 바뀐 마이그레이션 0
#   1. 새 판 놓기     ~/sgb-releases/<판>_<시각>/ 에 복사 · 지금 .env(· start.sh) 를 가져옴
#   2. 설치 · 빌드    API(tsc) · 사용자 웹(next build) · 운영 화면(vite build)        ← 여기까지 서비스 무중단
#   3. DB             올릴 마이그레이션을 보여 주고, **스냅샷을 만들었는지 물은 뒤** 적용
#   4. 배포 점검      scripts/deploy-check.sh (오픈 차단 항목은 경고만 — 열기 전 단계)
#   5. 교체           ~/sgb 를 새 판으로 돌리고 pm2 에 sgb · sgb-site · sgb-jobs 를 다시 등록
#   6. 기동 확인      API · 사이트가 안 뜨면 **전 판으로 자동 복귀**
#   7. 적용 후 확인   postcheck.sh
#
# 하지 않는 것 (일부러) — 개발 계정 · 시험 데이터 넣기, 약관 발행, 간주 모드 끄기, Nginx · 인증서 바꾸기, DB 되돌리기
#
#   APP_LINK   앱 폴더(바로가기)   기본 ~/sgb
#   REL_ROOT   판 보관 폴더        기본 ~/sgb-releases
#   KEEP_OLD_RELEASES=1   새 판이 뜬 뒤 옛 판(지금 · 직전 판 말고)을 지우지 않음 — 기본은 지움(v10.91)
#   DATA_DIR   판과 무관한 자료     기본 ~/sgb-data  (uploads · logs)
#   SKIP_JOBS=1   배치 호출기를 띄우지 않음 (EventBridge 를 쓰는 서버)
#   ASSUME_YES=1  물음을 건너뜀 — **리허설 전용**. 운영에서는 쓰지 마십시오(스냅샷 확인을 건너뜁니다)
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NEW="$(cd "$HERE/../.." && pwd)"
. "$HERE/lib.sh"
APP_LINK="${APP_LINK:-$HOME/sgb}"
REL_ROOT="${REL_ROOT:-$HOME/sgb-releases}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
STAMP=$(date +%Y%m%d_%H%M%S)
VER="$(cat "$NEW/VERSION" 2>/dev/null || echo unknown)"
mkdir -p "$REL_ROOT" "$DATA_DIR/logs"
OUT="$DATA_DIR/logs/apply_${STAMP}.txt"; : > "$OUT"
BUILD_LOG="$DATA_DIR/logs/apply_${STAMP}_build.log"
stop() { say ""; say "!! 멈춥니다 — $1"; say "   돌던 서비스는 건드리지 않았습니다.${2:+ $2}"; say "   기록: $OUT"; exit 1; }
step() { say ""; say "[$1] $2"; }

say "소개뱅크 AWS 적용 — $VER ($(date '+%Y-%m-%d %H:%M:%S %Z'))"
say "새 킷 $NEW  →  앱 폴더 $APP_LINK"

# ── 0. 전제 ────────────────────────────────────────────────────────
step 0 "전제 확인"
[ "$(readlink -f "$NEW")" != "$(readlink -f "$APP_LINK" 2>/dev/null)" ] || stop "지금 돌고 있는 앱 폴더 안에서 실행했습니다" "새로 푼 킷 폴더의 apply.sh 를 실행하십시오."
case "$(readlink -f "$NEW")" in "$(readlink -f "$REL_ROOT")"/*) stop "판 보관 폴더 안의 apply.sh 입니다" "새로 푼 킷 폴더의 apply.sh 를 실행하십시오.";; esac
for c in node npm pm2 psql curl sha256sum; do command -v $c >/dev/null 2>&1 || stop "$c 가 없습니다" "절차서 v2.5 6-1 의 설치를 먼저 하십시오."; done
nv=$(node -v)
case "$nv" in
  v22.*) ok "Node.js $nv" ;;
  *) [ "${ALLOW_OTHER_NODE:-0}" = "1" ] && warn "Node.js $nv — 킷은 22 에서 검정했습니다 (ALLOW_OTHER_NODE=1 로 계속)" \
       || stop "Node.js 가 $nv 입니다 — 킷은 22 에서 검정했습니다" "22 로 올린 뒤 다시 실행하십시오 (절차서 4-2 ①).";;
esac
mt=$(mem_total_mb)
[ "$mt" -ge 3500 ] || [ "${SKIP_MEM_CHECK:-0}" = "1" ] || stop "메모리 + 스왑이 ${mt}MB 입니다 (3.5GB 필요)" "스왑 2GB 를 만든 뒤 다시 실행하십시오 (절차서 4-2 ②)."
ok "메모리 + 스왑 ${mt}MB"
df_free=$(df -Pm "$REL_ROOT" | awk 'NR==2 {print $4}')
[ "${df_free:-0}" -ge 4000 ] || [ "${SKIP_DISK_CHECK:-0}" = "1" ] || stop "디스크 여유가 ${df_free}MB 입니다 (4GB 필요)" "ls $REL_ROOT 에서 오래된 판을 지우십시오."
ok "디스크 여유 ${df_free}MB"
[ -f "$APP_LINK/.env" ] || stop "$APP_LINK/.env 가 없습니다" "처음 세우는 서버면 절차서 v2.5 7-3 대로 ~/sgb/.env 를 먼저 만드십시오."
for k in DATABASE_URL JWT_SECRET; do env_has "$APP_LINK/.env" $k || stop ".env 에 $k 가 없습니다"; done
grep -Eq 'dev-only-|docker-dev-|docker-test-|sgb-dev-1234' "$APP_LINK/.env" && [ "${ALLOW_DEV_SECRETS:-0}" != "1" ] \
  && stop ".env 에 개발용 값이 남아 있습니다" "JWT_SECRET · ENC_KEY · JOB_TOKEN 을 서버에서 새로 만든 값으로 바꾸십시오."
load_env "$APP_LINK/.env"
[ "${#JWT_SECRET}" -ge 32 ] || stop "JWT_SECRET 이 32자 미만입니다"
db -c "SELECT 1" >/dev/null 2>&1 || stop "DB 에 붙지 못했습니다" "DATABASE_URL · 보안 그룹 · sslmode 를 확인하십시오."
ok "DB 접속 $(q "select current_database() || ' · PostgreSQL ' || current_setting('server_version')")"
ST=$(mig_status "$NEW/prisma/migrations")
DRIFT=$(echo "$ST" | grep -c '^바뀜'); PEND=$(echo "$ST" | grep -c '^올릴것'); DONE=$(echo "$ST" | grep -c '^적용됨')
[ "$DRIFT" = "0" ] || { echo "$ST" | grep '^바뀜' | tee -a "$OUT"; stop "이미 적용된 마이그레이션 파일이 새 킷과 다릅니다 ($DRIFT건)" "서버에 올렸던 킷과 이 킷의 파일이 다릅니다 — 적용하지 말고 알려 주십시오."; }
ok "마이그레이션 — 적용됨 $DONE · 올릴 것 $PEND · 바뀐 파일 0"

# ── 1. 새 판 놓기 ───────────────────────────────────────────────────
step 1 "새 판 놓기"
REL="$REL_ROOT/${VER}_${STAMP}"
mkdir -p "$REL"
( cd "$NEW" && tar cf - --exclude=./node_modules --exclude=./site/node_modules --exclude=./web/node_modules \
     --exclude=./site/.next --exclude=./web/dist --exclude=./dist --exclude=./uploads --exclude=./.env . ) | ( cd "$REL" && tar xf - ) \
  || stop "새 판을 복사하지 못했습니다"
cp -p "$APP_LINK/.env" "$REL/.env"; chmod 600 "$REL/.env"
[ -f "$APP_LINK/start.sh" ] && { cp -p "$APP_LINK/start.sh" "$REL/start.sh"; info "start.sh 를 가져왔습니다 (ENC_KEY 를 읽는 스크립트)"; }
ok "복사 $REL"
env_has "$REL/.env" NODE_ENV || { printf '\nNODE_ENV=production\n' >> "$REL/.env"; info ".env 에 NODE_ENV=production 을 넣었습니다"; }
if ! env_has "$REL/.env" S3_BUCKET && ! env_has "$REL/.env" UPLOAD_DIR; then
  mkdir -p "$DATA_DIR/uploads"
  printf '\n# 올린 파일 — 앱 폴더 밖(판을 바꿔도 남습니다). S3 를 쓰려면 이 줄 대신 S3_BUCKET=버킷이름\nUPLOAD_DIR=%s\n' "$DATA_DIR/uploads" >> "$REL/.env"
  info ".env 에 UPLOAD_DIR=$DATA_DIR/uploads 를 넣었습니다 (S3_BUCKET 이 없어서)"
  if [ -d "$APP_LINK/uploads" ] && [ -n "$(ls -A "$APP_LINK/uploads" 2>/dev/null)" ]; then
    cp -an "$APP_LINK/uploads/." "$DATA_DIR/uploads/" && info "전 판의 uploads 를 $DATA_DIR/uploads 로 복사했습니다"
  fi
fi
load_env "$REL/.env"
if [ -n "${UPLOAD_DIR:-}" ] && [ -z "${S3_BUCKET:-}" ]; then
  case "$UPLOAD_DIR" in /*) mkdir -p "$UPLOAD_DIR" && ok "파일 저장 — 서버 디스크 $UPLOAD_DIR";; *) warn "UPLOAD_DIR 가 상대 경로($UPLOAD_DIR)" "앱 폴더 안에 저장되어 판을 바꾸면 안 보입니다 — 절대 경로로 바꾸십시오";; esac
elif [ -n "${S3_BUCKET:-}" ]; then ok "파일 저장 — S3 $S3_BUCKET"; fi

# ── 2. 설치 · 빌드 ──────────────────────────────────────────────────
step 2 "설치 · 빌드 (10 ~ 20분 · 자세한 출력은 $BUILD_LOG)"
: > "$BUILD_LOG"
run() { # 이름 · 폴더 · 명령…  — NODE_ENV=production 이면 npm 이 빌드 도구(devDependencies)를 빼므로 설치 때는 뗍니다
  local name="$1" dir="$2"; shift 2
  local t0=$SECONDS
  echo "=== $name ($dir) $*" >> "$BUILD_LOG"
  ( cd "$dir" && "$@" ) >> "$BUILD_LOG" 2>&1 || { tail -15 "$BUILD_LOG" | tee -a "$OUT"; stop "$name 실패" "위 출력과 $BUILD_LOG 를 보십시오. 새 판 폴더($REL)는 지워도 됩니다."; }
  ok "$name" "$((SECONDS - t0))초"
}
run "API 설치"        "$REL"      env -u NODE_ENV npm ci --include=dev --no-audit --no-fund
# 앱(Node 드라이버)으로도 DB 에 붙는지 — psql 은 붙는데 앱은 못 붙는 접속 주소가 있습니다(SSL 표기 차이 · lib.sh psql_url)
ms=$(cd "$REL" && node scripts/migrate.js --status 2>&1 | tail -1)
case "$ms" in 적용*) ok "앱 방식(Node)으로 DB 접속" "$ms";; *) stop "앱 방식(Node)으로 DB 에 붙지 못했습니다 — $ms" "접속 주소의 SSL 표기를 확인하십시오 (deploy/aws/env.production.example). 새 판 폴더($REL)는 지워도 됩니다.";; esac
run "API 빌드"        "$REL"      npm run build
run "사용자 웹 설치"   "$REL/site" env -u NODE_ENV npm ci --include=dev --no-audit --no-fund
SITE_API="${API_ORIGIN:-http://127.0.0.1:${PORT:-3000}}"
SITE_HOME="${HOME_CONTENT:-live}"; [ "$SITE_HOME" = "sample" ] && SITE_HOME=""
run "사용자 웹 빌드"   "$REL/site" env -u PORT API_ORIGIN="$SITE_API" API_BASE="${API_BASE:-${SITE_API%/}/api/v1}" HOME_CONTENT="$SITE_HOME" npm run build
run "운영 화면 설치"   "$REL/web"  env -u NODE_ENV npm ci --include=dev --no-audit --no-fund
run "운영 화면 빌드"   "$REL/web"  npm run build
[ -f "$REL/dist/main.js" ] && [ -f "$REL/site/.next/BUILD_ID" ] && [ -f "$REL/web/dist/index.html" ] || stop "빌드 결과물이 없습니다" "$BUILD_LOG 를 보십시오."

# ── 3. DB ───────────────────────────────────────────────────────────
step 3 "DB 마이그레이션"
if [ "$PEND" = "0" ]; then
  ok "올릴 것이 없습니다 (적용됨 $DONE)"
else
  echo "$ST" | grep '^올릴것' | awk '{print $2}' | paste -sd' ' | fold -s -w 110 | sed 's/^/        올릴 것: /' | tee -a "$OUT"
  say "        ★ 마이그레이션은 되돌릴 수 없습니다(전진 전용). 되돌리는 길은 **RDS 스냅샷 복원**뿐입니다."
  if [ "${ASSUME_YES:-0}" != "1" ]; then
    read -r -p "        RDS 스냅샷을 방금 만들었습니까? 만들었으면 yes 를 입력: " yn
    [ "$yn" = "yes" ] || stop "스냅샷 확인이 없어 DB 를 건드리지 않았습니다" "RDS → sgb-db → 작업 → 스냅샷 생성 뒤 다시 실행하십시오. 빌드한 새 판($REL)은 지워도 됩니다."
  else
    info "ASSUME_YES=1 — 스냅샷 확인을 건너뜁니다 (리허설)"
  fi
  mo=$(cd "$REL" && node scripts/migrate.js 2>&1); mrc=$?
  echo "$mo" >> "$BUILD_LOG"
  echo "$mo" | grep -E '^(ok|!!) ' | sed 's/^/        /' | tee -a "$OUT"
  say "        $(echo "$mo" | tail -1)"
  [ $mrc = 0 ] && echo "$mo" | tail -1 | grep -q "변경감지 0" || stop "마이그레이션 실패" "실패한 파일은 통째로 되돌아갔고, 그 앞 파일까지는 적용된 상태입니다. 돌던 서비스는 전 판 그대로입니다 — 출력과 함께 알려 주십시오."
  applied=$(q "select count(*) from schema_migrations"); files=$(echo "$ST" | wc -l | tr -d ' ')
  [ "$applied" = "$files" ] && ok "마이그레이션 적용 수 = 파일 수" "$applied / $files" || stop "적용 수($applied)와 파일 수($files)가 다릅니다"
fi

# ── 4. 배포 점검 ────────────────────────────────────────────────────
step 4 "배포 점검 (scripts/deploy-check.sh · 오픈 차단 항목은 경고만)"
dc=$(cd "$REL" && ENVIRONMENT=stg bash scripts/deploy-check.sh 2>&1); drc=$?
echo "$dc" >> "$BUILD_LOG"
echo "$dc" | grep -E '^\s+(ok|FAIL|→)|^배포' | sed 's/^/      /' | tee -a "$OUT"
[ $drc = 0 ] || stop "배포 점검 실패" "DB 는 새 구조로 올라갔고(3단계), 서비스는 전 판 그대로입니다 — 출력과 함께 알려 주십시오."

# ── 5. 교체 ─────────────────────────────────────────────────────────
step 5 "교체 · pm2 등록"
if [ -L "$APP_LINK" ]; then PREV=$(readlink -f "$APP_LINK")
elif [ -d "$APP_LINK" ]; then
  PREV="$REL_ROOT/prev_${STAMP}"
  mv "$APP_LINK" "$PREV" || stop "$APP_LINK 를 보관 폴더로 옮기지 못했습니다"
  info "전 판을 $PREV 로 옮겼습니다"
else PREV=""; fi
ln -sfn "$REL" "$APP_LINK" || stop "바로가기를 만들지 못했습니다"
echo "$PREV" > "$DATA_DIR/previous"; echo "$REL" > "$DATA_DIR/current"
ok "$APP_LINK → $REL"
pm2_up() {
  pm2 delete sgb sgb-site sgb-jobs >/dev/null 2>&1
  pm2 start "$APP_LINK/deploy/aws/run-api.sh"  --name sgb      --interpreter bash --time >/dev/null 2>&1
  pm2 start "$APP_LINK/deploy/aws/run-site.sh" --name sgb-site --interpreter bash --time >/dev/null 2>&1
  JOB_TOKEN="${JOB_TOKEN:-}"
  if [ "${SKIP_JOBS:-0}" = "1" ]; then info "배치 호출기는 띄우지 않습니다 (SKIP_JOBS=1)"
  elif [ "${#JOB_TOKEN}" -ge 32 ]; then pm2 start "$APP_LINK/deploy/aws/run-jobs.sh" --name sgb-jobs --interpreter bash --time >/dev/null 2>&1
  else warn "JOB_TOKEN 이 없어 배치 호출기(sgb-jobs)를 띄우지 않았습니다" ".env 에 JOB_TOKEN(openssl rand -hex 24)을 넣고 pm2 start $APP_LINK/deploy/aws/run-jobs.sh --name sgb-jobs"; fi
  pm2 save >/dev/null 2>&1
}
pm2_up

# ── 6. 기동 확인 ────────────────────────────────────────────────────
step 6 "기동 확인"
wait_up() { local url="$1" i; for i in $(seq 1 45); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url")" = "200" ] && return 0; sleep 2; done; return 1; }
API_URL="http://127.0.0.1:${PORT:-3000}/api/v1/health"; SITE_URL="http://127.0.0.1:${SITE_PORT:-5174}/"
# 주소가 답하는 것만으로는 모자랍니다 — 같은 포트를 **다른 프로세스**(다른 이름으로 띄워 둔 전 판 등)가 쥐고 있으면
# 새 프로세스는 계속 죽었다 살아나는데 주소는 전 판이 답합니다. 새 프로세스가 죽지 않고 떠 있는지를 함께 봅니다.
fresh_ok() { local st; st=$(pm2_state "$1"); set -- $st; [ "${1:-}" = "online" ] && [ "${2:-9}" = "0" ]; }
if wait_up "$API_URL" && wait_up "$SITE_URL" && sleep 8 && fresh_ok sgb && fresh_ok sgb-site; then
  ok "API · 사용자 웹이 떴습니다 (새 프로세스 · 재시작 0회)"
  # v10.91 — 새 판이 뜬 뒤에만 옛 판 정리(지금 판 · 직전 판은 남김 · 되돌리기용) — 끄기 KEEP_OLD_RELEASES=1
  prune_releases "$REL_ROOT" "$REL" "$PREV"
else
  say "        pm2: sgb=$(pm2_state sgb | cut -d' ' -f1-2) · sgb-site=$(pm2_state sgb-site | cut -d' ' -f1-2)  (online 0 이 아니면 포트를 다른 프로세스가 쓰고 있을 수 있습니다 — pm2 list)"
  say "  실패  새 판이 뜨지 않습니다 — 전 판으로 되돌립니다"
  pm2 logs sgb --lines 15 --nostream 2>/dev/null | tail -20 | tee -a "$OUT"
  pm2 logs sgb-site --lines 10 --nostream 2>/dev/null | tail -12 | tee -a "$OUT"
  bash "$HERE/rollback.sh" 2>&1 | tee -a "$OUT"
  say "!! 적용 실패 — 전 판으로 되돌렸습니다(DB 는 새 구조 그대로). 위 로그와 $OUT 을 보내 주십시오."
  exit 1
fi

# ── 7. 적용 후 확인 ─────────────────────────────────────────────────
say ""; say "적용 끝 — 이어서 적용 후 확인을 돌립니다."
say "기록: $OUT"
APP_LINK="$APP_LINK" DATA_DIR="$DATA_DIR" bash "$APP_LINK/deploy/aws/postcheck.sh"
