#!/usr/bin/env bash
# =====================================================================
# 진짜 기반 이미지 확인 — `./dev.sh realcheck`   (Windows 는 `.\dev.ps1 realcheck` — 같은 순서)
#
# 왜 필요한가
#   킷을 만든 작업 환경은 Docker Hub 에 닿지 않아 기반 이미지(node:22-slim · postgres:16)를 같은 역할의
#   대체 이미지로 돌렸습니다. 이 스크립트는 **인터넷이 되는 PC 에서 진짜 이미지를 받아** 같은 것을 한 번에 확인합니다.
#
# 하는 일 (순서대로 · 하나라도 실패하면 끝에 「실패 n건」)
#   1. Docker 가 켜져 있는지
#   2. node:22-slim · postgres:16 을 Docker Hub 에서 받기            (못 받으면 여기서 멈춤)
#   3. 받은 것이 진짜인지 — 공식 이미지 표지(NODE_VERSION · PG_MAJOR) · 버전(node 22 · PostgreSQL 16)
#   4. 그 이미지로 전부 다시 빌드                                     (docker compose build --pull)
#   5. 기동 · API 준비 대기                                           (개발 데이터는 그대로 둡니다)
#   6. 마이그레이션 수 = 파일 수 · 컨테이너 안 버전
#   7. 통합 검정 컨테이너                                             (sgb_check 에서 — 개발 데이터를 건드리지 않음)
#   8. 주소 6곳이 열리는지 · 메인에 나가는 투표 3건
#   9. 운영 적용과 같은 빌드 — API tsc · 운영 화면 tsc -b && vite build (컨테이너 안 · 운영 apply.sh 의 「빌드」 단계를 미리)
#   결과는 화면과 realcheck_날짜_시각.txt 에 남습니다 — 그 파일을 보내 주시면 됩니다.
#
#   ./dev.sh realcheck          개발 데이터 유지 (권장)
#   ./dev.sh realcheck fresh    DB 볼륨을 지우고 처음부터 (새 설치 확인 — 「yes」를 쳐야 진행)
#
# (킷 작업 환경 전용) REALCHECK_SKIP_PULL=1 — 받기를 건너뜁니다. 그 환경에서는 3번이 「진짜 아님」으로 나오는 것이 맞습니다.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-keep}"
STAMP=$(date +%Y%m%d_%H%M%S)
OUT="realcheck_${STAMP}.txt"
PASS=0; FAIL=0
: > "$OUT"
say()  { echo "$*" | tee -a "$OUT"; }
ok()   { PASS=$((PASS+1)); say "  통과  $1${2:+ — $2}"; }
bad()  { FAIL=$((FAIL+1)); say "  실패  $1${2:+ — $2}"; }
chk()  { if [ "$1" = "0" ]; then ok "$2" "${3:-}"; else bad "$2" "${3:-}"; fi; }
finish() {
  say ""
  if [ "$FAIL" = "0" ]; then say "진짜 이미지 확인 — 전체 통과 (통과 $PASS · 실패 0)"; else say "진짜 이미지 확인 — 실패 $FAIL건 (통과 $PASS) · 위에서 「실패」 줄을 보십시오"; fi
  say "결과 파일: $(pwd)/$OUT"
  [ "$FAIL" = "0" ] && exit 0 || exit 1
}
envval() { local v; v=$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r'); echo "${v:-$2}"; }

say "소개뱅크 개발 Docker — 진짜 기반 이미지 확인 ($(date '+%Y-%m-%d %H:%M:%S') · 방식 $MODE)"
say "킷 폴더: $(pwd)"
[ -f .env ] || { cp .env.example .env; say ".env 를 만들었습니다 (개발용 값)."; }
API_PORT=$(envval API_PORT 3000); WEB_PORT=$(envval WEB_PORT 5173); SITE_PORT=$(envval SITE_PORT 5174); PG_USER=$(envval PG_USER sgb)

say ""; say "[1] Docker"
if docker info >/dev/null 2>&1; then ok "Docker 가 켜져 있음" "$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
else bad "Docker 가 꺼져 있음" "Docker Desktop 을 켠 뒤 다시 실행하십시오"; finish; fi

say ""; say "[2] 기반 이미지 받기 (Docker Hub)"
for img in node:22-slim postgres:16; do
  if [ "${REALCHECK_SKIP_PULL:-0}" = "1" ]; then say "  건너뜀  $img 받기 (REALCHECK_SKIP_PULL=1)"
  elif docker pull "$img" >/dev/null 2>>"$OUT"; then ok "$img 받음"
  else bad "$img 를 받지 못함" "인터넷 · 사내 프록시 · Docker Hub 로그인 한도를 확인하십시오"; finish; fi
done

say ""; say "[3] 진짜 이미지인가"
#   ※ 저장소 지문(RepoDigests)은 직접 만든 이미지에도 붙을 수 있어 근거로 쓰지 않습니다(킷 작업 환경에서 확인).
#     ① 2번에서 Docker Hub 에서 방금 받았고 ② 공식 이미지가 넣어 두는 표지(환경 값)가 있고 ③ 버전이 맞는지를 봅니다.
envs() { docker image inspect "$1" --format '{{range .Config.Env}}{{.}} {{end}}' 2>/dev/null || true; }
ne=$(envs node:22-slim | tr ' ' '\n' | grep '^NODE_VERSION=' | head -1)
case "$ne" in NODE_VERSION=22.*) ok "node:22-slim — 공식 이미지 표지" "$ne";; *) bad "node:22-slim 에 공식 이미지 표지(NODE_VERSION=22.x)가 없음 — Docker Hub 의 공식 이미지가 아님(직접 만든 대체 이미지)" "${ne:-없음}";; esac
pe=$(envs postgres:16 | tr ' ' '\n' | grep '^PG_MAJOR=' | head -1)
case "$pe" in PG_MAJOR=16) ok "postgres:16 — 공식 이미지 표지" "$pe";; *) bad "postgres:16 에 공식 이미지 표지(PG_MAJOR=16)가 없음 — Docker Hub 의 공식 이미지가 아님(직접 만든 대체 이미지)" "${pe:-없음}";; esac
nv=$(docker run --rm --entrypoint node node:22-slim -v 2>/dev/null | tr -d '\r'); case "$nv" in v22.*) ok "node 버전" "$nv";; *) bad "node 버전이 22 가 아님" "${nv:-실행 실패}";; esac
pv=$(docker run --rm --entrypoint postgres postgres:16 -V 2>/dev/null | tr -d '\r'); case "$pv" in *" 16."*) ok "PostgreSQL 버전" "$pv";; *) bad "PostgreSQL 버전이 16 이 아님" "${pv:-실행 실패}";; esac
for img in node:22-slim postgres:16; do say "        $img  $(docker image inspect "$img" --format '{{.Id}}  만든 때 {{.Created}}' 2>/dev/null)"; done

if [ "$MODE" = "fresh" ]; then
  say ""; say "[새 설치] DB 볼륨을 지우고 처음부터 합니다 — 개발 데이터(화면에서 넣은 것 포함)가 사라집니다."
  read -r -p "  계속하려면 yes 를 입력: " yn
  if [ "$yn" = "yes" ]; then docker compose --profile check down -v >/dev/null 2>&1; ok "DB 볼륨을 지움 (새 설치로 확인)"
  else say "  취소했습니다 — 개발 데이터를 둔 채로 계속합니다."; MODE=keep; fi
fi

say ""; say "[4] 진짜 이미지로 다시 빌드 (몇 분 걸립니다)"
PULL="--pull"; [ "${REALCHECK_SKIP_PULL:-0}" = "1" ] && PULL=""
docker compose --profile check build $PULL; chk $? "빌드 (migrate · api · scheduler · web · site · checks)"

say ""; say "[5] 기동"
docker compose up -d; chk $? "docker compose up -d (준비 · API 준비 대기 포함)"
st=""; for i in $(seq 1 60); do st=$(docker inspect --format '{{.State.Health.Status}}' sgb-api 2>/dev/null || true); [ "$st" = "healthy" ] && break; sleep 3; done
[ "$st" = "healthy" ]; chk $? "API 컨테이너 healthy" "$st"

say ""; say "[6] 마이그레이션 · 컨테이너 안 버전"
files=$(find sgb/prisma/migrations -mindepth 2 -maxdepth 2 -name migration.sql | wc -l | tr -d ' ')
applied=$(docker compose exec -T db psql -U "$PG_USER" -d sgb -tAc "select count(*) from schema_migrations" 2>/dev/null | tr -d '[:space:]')
[ -n "$applied" ] && [ "$applied" = "$files" ]; chk $? "마이그레이션 적용 수 = 파일 수" "적용 ${applied:-?} / 파일 $files"
cn=$(docker compose exec -T api node -v 2>/dev/null | tr -d '\r'); case "$cn" in v22.*) ok "API 컨테이너의 node" "$cn";; *) bad "API 컨테이너의 node 가 22 가 아님" "${cn:-?}";; esac
cp_=$(docker compose exec -T db postgres -V 2>/dev/null | tr -d '\r'); case "$cp_" in *" 16."*) ok "DB 컨테이너의 PostgreSQL" "$cp_";; *) bad "DB 컨테이너의 PostgreSQL 이 16 이 아님" "${cp_:-?}";; esac

say ""; say "[7] 통합 검정 컨테이너 (sgb_check — 개발 데이터를 건드리지 않습니다 · 몇 분 걸립니다)"
docker compose --profile check run --rm checks 2>&1 | tee /tmp/realcheck_checks.$$ | tail -25
rc=${PIPESTATUS[0]}
for pat in '^통과 [0-9]+ / 실패' '뚫림' 'SQL 대조' '통합 검정 —'; do l=$(grep -aE "$pat" /tmp/realcheck_checks.$$ | head -1); [ -n "$l" ] && echo "        $l" >> "$OUT"; done
chk "$rc" "통합 검정 — 전체 통과" "종료 코드 $rc"; rm -f /tmp/realcheck_checks.$$

say ""; say "[8] 주소 · 투표"
PROTO=$(ls SGB_Prototype_v*.html 2>/dev/null | head -1)
probe() {   # 이름 · 주소 — 사용자 웹은 개발 모드라 첫 요청이 느립니다(최대 4분 · 3번까지)
  local code="000"
  for t in 1 2 3; do code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 240 "$2" 2>/dev/null); [ "$code" = "200" ] && break; sleep 5; done
  [ "$code" = "200" ]; chk $? "$1" "$2 → $code"
}
probe "API"                 "http://localhost:${API_PORT}/api/v1/health"
probe "운영 화면"            "http://localhost:${WEB_PORT}/"
probe "사용자 웹 메인"        "http://localhost:${SITE_PORT}/"
probe "소개광장 투표 목록"     "http://localhost:${SITE_PORT}/community/polls"
probe "안심소개"             "http://localhost:${SITE_PORT}/mall"
[ -n "$PROTO" ] && probe "시안" "http://localhost:${SITE_PORT}/proto/${PROTO}"
kinds=$(curl -s --max-time 60 "http://localhost:${API_PORT}/api/v1/community/polls?scope=home" 2>/dev/null | grep -o '"kind":"[A-Z]*"' | cut -d'"' -f4 | tr '\n' ' ' | sed 's/ $//')
[ "$kinds" = "VS ASK USED" ]; chk $? "메인에 나가는 투표 3건(비교해요 · 궁금해요 · 써본 의견)" "${kinds:-없음}"

# 2026-10-30 — 점검판은 API 를 ts-node(형식 검사 느슨) · 운영 화면을 vite 개발 서버로 돌려 운영 apply.sh 의 빌드 오류를 못 봄
#   (v10.153 운영 화면 문법 오류가 realcheck 21/21 을 통과함). 같은 빌드를 컨테이너 안에서 돌림 — 결과물은 컨테이너의 /tmp 에만
say ""; say "[9] 운영 적용과 같은 빌드 (컨테이너 안 · 1분쯤)"
build() {   # 이름 · 서비스 · 명령
  local log; log=$(docker compose exec -T "$2" sh -c "$3" 2>&1); local rc=$?
  chk "$rc" "$1" "종료 코드 $rc"
  [ "$rc" = "0" ] || echo "$log" | grep -aE "error|Error" | head -20 | sed 's/^/        /' | tee -a "$OUT"
}
build "API 빌드(tsc)"                       api 'npx tsc -p tsconfig.json --noEmit'
build "운영 화면 빌드(tsc -b · vite build)"  web 'npx tsc -b && npx vite build --outDir /tmp/rc-web --emptyOutDir --logLevel error'

finish
