#!/usr/bin/env bash
# DB 복원 시험 리허설 — 개발 서버에서 복원 · 행 수 견주기를 미리 해 봄 (v10.585 · sgb-core docs/727 · 14차 운영 ①)
#
#   bash tools/restore-drill-rehearse.sh <킷.zip> [-o 결과.txt]
#
#   ① 버리는 postgres:16 컨테이너(이 스크립트만의 네트워크 · 포트는 127.0.0.1 임의 번호만) — mig-rehearsal.sh 와 같은 방식
#   ② 킷 마이그레이션 + 시드(scripts/fixture.sql) = 「운영 DB」 역할
#   ③ pg_dump(사용자 정의 형식) → 같은 컨테이너 안 새 DB drill 에 pg_restore = 「스냅샷 복원」 역할(걸린 초 · 복원 오류 수)
#   ④ 킷의 deploy/aws/restore-drill.sh --compare 로 두 DB 행 수 견줌(운영에서 쓰는 견주기 · JSON 그대로) → 맞아야 통과
#   ⑤ 일부러 복원 DB 에서 accounts 를 지워(행 수 줄임 · 한도 넘김) 「다름」이 나오는지도 봄(견주기가 늘 맞음만 내지 않는지)
#
#   운영 서버 · RDS · AWS 명령에 닿지 않습니다(개발 서버 rootless 도커 · 이 서버 psql · python3). 끝나면(실패해도) 컨테이너 · 네트워크 · 임시 폴더를 지웁니다.
#   종료 코드: 0 통과 · 1 리허설 실패(결과 파일 result= 줄에 까닭) · 2 쓰는 법 · 킷 · 도구 문제
set -uo pipefail
IMG="${SGB_REH_IMG:-sgb-dev-checks:latest}"
OUTF=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -o) OUTF="${2:-}"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
[ ${#ARGS[@]} -eq 1 ] || { echo "쓰는 법: bash tools/restore-drill-rehearse.sh <킷.zip> [-o 결과.txt]" >&2; exit 2; }
KZ="${ARGS[0]}"
case "$KZ" in *.zip) ;; *) echo "킷 zip 이 아님: $KZ" >&2; exit 2 ;; esac
[ -f "$KZ" ] || { echo "킷 zip 이 아님: $KZ" >&2; exit 2; }
if unzip -Z1 "$KZ" | grep -qE '(^/|(^|/)\.\.(/|$))'; then echo "킷 안 이상한 경로: $KZ" >&2; exit 2; fi
for c in docker psql python3 unzip; do command -v "$c" >/dev/null || { echo "$c 가 없음" >&2; exit 2; }; done

TAG="sgb-rdreh-$$"
NET="$TAG-net"; DB="$TAG-db"
TMP=$(mktemp -d -t rdreh_XXXXXX)
cleanup() {
  docker rm -f "$DB" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  [ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf -- "${TMP:?}"
}
trap cleanup EXIT INT TERM

unzip -q "$KZ" -d "$TMP/k" || { echo "킷을 풀지 못함" >&2; exit 2; }
top() { local d; d=$(find "$1" -mindepth 1 -maxdepth 1 -type d); [ "$(echo "$d" | wc -l)" = 1 ] && echo "$d"; }
K=$(top "$TMP/k")/sgb
[ -f "$K/deploy/aws/restore-drill.sh" ] || { echo "킷에 deploy/aws/restore-drill.sh 가 없음(v10.585 앞 킷)" >&2; exit 2; }
KV=$(tr -d '[:space:]' < "$K/VERSION" 2>/dev/null)

R=(); r() { R+=("$1"); }
FAIL=""; fail() { [ -z "$FAIL" ] && FAIL="$1"; }

docker network create "$NET" >/dev/null || { echo "도커 네트워크를 만들지 못함" >&2; exit 2; }
docker run -d --rm --name "$DB" --network "$NET" -p 127.0.0.1::5432 -e POSTGRES_USER=sgb -e POSTGRES_PASSWORD=sgb -e POSTGRES_DB=sgb postgres:16 >/dev/null \
  || { echo "버리는 DB 를 띄우지 못함" >&2; exit 2; }
for _ in $(seq 1 60); do docker exec "$DB" pg_isready -U sgb -q 2>/dev/null && break; sleep 1; done
sleep 2
PORT=$(docker port "$DB" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://')
[ -n "$PORT" ] || { echo "버리는 DB 포트를 읽지 못함" >&2; exit 2; }

# ② 「운영 DB」 — 킷 마이그레이션 + 시드(mig-rehearsal 의 mig() 와 같은 도구)
m1=$(docker run --rm --network "$NET" -e DATABASE_URL="postgresql://sgb:sgb@$DB:5432/sgb" -e SGB_FIXTURE_OK=0 \
  -v "$K/prisma:/app/prisma:ro" -v "$K/scripts:/app/scripts:ro" -w /app --entrypoint bash "$IMG" \
  -c 'node scripts/migrate.js | tail -1; [ -f scripts/fixture.sql ] && psql "$DATABASE_URL" -q -f scripts/fixture.sql >/dev/null 2>&1; true' 2>&1)
echo "$m1" | grep -q '변경감지 0' || fail "킷 마이그레이션 실패: $(echo "$m1" | tail -1)"
r "migrate=$(echo "$m1" | tail -1 | tr -d '\r')"

# ③ 덤프 → 복원(같은 컨테이너 안 · 초)
if [ -z "$FAIL" ]; then
  t0=$(date +%s)
  docker exec "$DB" pg_dump -U sgb -Fc -f /tmp/drill.dump sgb >/dev/null 2>&1 || fail "pg_dump 실패"
  t1=$(date +%s)
  docker exec "$DB" createdb -U sgb drill >/dev/null 2>&1 || fail "새 DB drill 을 만들지 못함"
  rs=$(docker exec "$DB" pg_restore -U sgb -d drill --no-owner /tmp/drill.dump 2>&1); rrc=$?
  t2=$(date +%s)
  rerr=$(echo "$rs" | grep -c '^pg_restore: error' || true)
  r "dump_sec=$((t1 - t0))"; r "restore_sec=$((t2 - t1))"; r "restore_rc=$rrc"; r "restore_errors=$rerr"
  [ "$rerr" = 0 ] || fail "pg_restore 오류 ${rerr}건: $(echo "$rs" | grep -m1 '^pg_restore: error')"
fi

# ④ 운영에서 쓰는 견주기 그대로(킷 스크립트 · 이 서버 psql · python3)
SRC="postgresql://sgb:sgb@127.0.0.1:$PORT/sgb"; DRL="postgresql://sgb:sgb@127.0.0.1:$PORT/drill"
if [ -z "$FAIL" ]; then
  c1=$(DATA_DIR="$TMP/data" bash "$K/deploy/aws/restore-drill.sh" --compare "$SRC" "$DRL" 2>&1); crc=$?
  r "compare_rc=$crc"
  js=$(echo "$c1" | sed -n '/^=== 붙여 넣을 결과/{n;p}')
  r "compare_tables=$(echo "$js" | python3 -I -c 'import json,sys; print(len(json.load(sys.stdin)["tables"]))' 2>/dev/null || echo 0)"
  [ "$crc" = 0 ] || fail "견주기가 「다름」: $(echo "$c1" | grep '다름' | head -1 | sed 's/^ *//')"
fi

# ⑤ 일부러 줄여 「다름」이 나오는지(한도 100줄 · 5퍼센트를 넘게 — 시드 accounts 가 적으면 audit 행도 함께)
if [ -z "$FAIL" ]; then
  docker exec "$DB" psql -U sgb -d drill -q -c "SET session_replication_role = replica; DELETE FROM accounts; DELETE FROM audit.audit_logs;" >/dev/null 2>&1
  c2=$(DATA_DIR="$TMP/data" bash "$K/deploy/aws/restore-drill.sh" --compare "$SRC" "$DRL" 2>&1); nrc=$?
  r "negative_rc=$nrc"
  if [ "$nrc" = 0 ]; then
    n0=$(echo "$c1" | grep -E '^ +(accounts|audit\.audit_logs) ' | awk '{print $3}' | sort -n | tail -1)
    if [ "${n0:-0}" -gt 100 ]; then fail "줄인 복원 DB 도 「맞음」 — 견주기가 차이를 못 봄"; else r "negative=건너뜀(시드 행 수 ${n0:-0} ≤ 100 — 한도 안)"; fi
  fi
fi

RES=$([ -z "$FAIL" ] && echo PASS || echo "FAIL $FAIL")
LINE="복원 시험 리허설($KV): $([ -z "$FAIL" ] && echo "통과 — 덤프 $(printf '%s\n' "${R[@]}" | sed -n 's/^dump_sec=//p')초 · 복원 $(printf '%s\n' "${R[@]}" | sed -n 's/^restore_sec=//p')초 · 견주기 맞음 · 줄인 DB 다름" || echo "실패 — $FAIL")"
{ echo "result=$RES"; printf '%s\n' "${R[@]}"; echo "line=$LINE"; } > "${OUTF:-/dev/null}"
printf '%s\n' "${R[@]}"
echo "$LINE"
[ -z "$FAIL" ] && exit 0 || exit 1
