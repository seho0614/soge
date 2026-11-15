#!/usr/bin/env bash
# 마이그레이션 리허설 — 버리는 DB 에서 운영 적용을 미리 해 봄 (v10.299 · sgb-core docs/419)
#
#   bash tools/mig-rehearsal.sh <지금 운영 킷.zip> <올릴 킷.zip> [-o 결과.txt]
#
#   ① 버리는 postgres:16 컨테이너(이 스크립트만의 네트워크 · 포트를 열지 않음)를 띄움
#   ② 옛 킷 마이그레이션 + 시드(scripts/fixture.sql) → 숫자 13개(새 킷 deploy/aws/lib.sh 의 state_lines — precheck · postcheck 와 같은 식)
#   ③ 새 킷 scripts/migrate.js 로 적용(apply 3단계와 같은 도구) → 한 번 더(적용 0 이어야 함)
#   ④ 새 마이그레이션 SQL 을 psql 로 하나씩 다시 돌림(재실행 안전) → 숫자 13개를 다시 셈(다시 돌려도 같아야 함)
#   ⑤ 결과 파일(key=값 줄) — tools/ops-doc-draft.py --rehearsal 이 읽어 절차서 postcheck [11] · 점검 줄을 채움
#   v10.306 (docs/428) — 새 킷 postcheck.sh 에 DB 만 보는 방식(POSTCHECK_DB_ONLY)이 있으면 ② 뒤 · ③ 뒤에 돌려
#     「확인」 · 「실패」 줄이 무엇이 생기고 없어졌는지 적음(pc_before · pc_after · pc_new_warn · pc_gone_warn · pc_new_fail · pc_gone_fail)
#     — 절차서 postcheck 기대 숫자(지난 운영 postcheck + 이 차이)를 초안 도구가 채움 · 리허설 통과 · 실패에는 넣지 않음(보여 주기만)
#
#   운영 서버 · RDS 에 닿지 않습니다(개발 서버 rootless 도커만). 끝나면(실패해도) 컨테이너 · 네트워크 · 임시 폴더를 지웁니다.
#   종료 코드: 0 통과 · 1 리허설 실패(결과 파일 result= 줄에 까닭) · 2 쓰는 법 · 킷 문제
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
[ ${#ARGS[@]} -eq 2 ] || { echo "쓰는 법: bash tools/mig-rehearsal.sh <지금 운영 킷.zip> <올릴 킷.zip> [-o 결과.txt]" >&2; exit 2; }
OLD="${ARGS[0]}"; NEW="${ARGS[1]}"
for z in "$OLD" "$NEW"; do
  case "$z" in *.zip) ;; *) echo "킷 zip 이 아님: $z" >&2; exit 2 ;; esac
  [ -f "$z" ] || { echo "킷 zip 이 아님: $z" >&2; exit 2; }
  if unzip -Z1 "$z" | grep -qE '(^/|(^|/)\.\.(/|$))'; then echo "킷 안 이상한 경로: $z" >&2; exit 2; fi
done
command -v docker >/dev/null || { echo "docker 가 없음" >&2; exit 2; }

TAG="sgb-mreh-$$"
NET="$TAG-net"; DB="$TAG-db"
TMP=$(mktemp -d -t migreh_XXXXXX)
cleanup() {
  docker rm -f "$DB" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  [ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf -- "${TMP:?}"
}
trap cleanup EXIT INT TERM

unzip -q "$OLD" -d "$TMP/o" && unzip -q "$NEW" -d "$TMP/n" || { echo "킷을 풀지 못함" >&2; exit 2; }
top() { local d; d=$(find "$1" -mindepth 1 -maxdepth 1 -type d); [ "$(echo "$d" | wc -l)" = 1 ] && echo "$d"; }
O=$(top "$TMP/o")/sgb; N=$(top "$TMP/n")/sgb
[ -d "$O/prisma/migrations" ] && [ -d "$N/prisma/migrations" ] || { echo "킷에 sgb/prisma/migrations 가 없음" >&2; exit 2; }
OV=$(tr -d '[:space:]' < "$O/VERSION"); NV=$(tr -d '[:space:]' < "$N/VERSION")
vn() { echo "$1" | sed -n 's/^v10\.\([0-9]*\).*/\1/p'; }
[ "$(vn "$NV")" -gt "$(vn "$OV")" ] 2>/dev/null || { echo "올릴 판($NV)이 지금 판($OV)보다 높지 않음" >&2; exit 2; }

# 숫자 13개 — 새 킷 lib.sh 의 state_lines 안 SQL 을 그대로(precheck · postcheck 와 같은 식)
SL=$(python3 -I - "$N/deploy/aws/lib.sh" <<'PY'
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'^state_lines\(\) \{\n\s*qn "(.*?)"\n\}', t, re.S | re.M)
print(m.group(1) if m else '')
PY
)
[ -n "$SL" ] || { echo "새 킷 deploy/aws/lib.sh 에서 state_lines 를 찾지 못함" >&2; exit 2; }

R=()   # 결과 줄
r() { R+=("$1"); }
FAIL=""
fail() { [ -z "$FAIL" ] && FAIL="$1"; }

docker network create "$NET" >/dev/null || { echo "도커 네트워크를 만들지 못함" >&2; exit 2; }
docker run -d --rm --name "$DB" --network "$NET" -e POSTGRES_USER=sgb -e POSTGRES_PASSWORD=sgb -e POSTGRES_DB=sgb postgres:16 >/dev/null \
  || { echo "버리는 DB 를 띄우지 못함" >&2; exit 2; }
for _ in $(seq 1 60); do docker exec "$DB" pg_isready -U sgb -q 2>/dev/null && break; sleep 1; done
sleep 2
mig() {   # $1 = 킷 sgb 폴더 · 나머지 = bash 명령
  local d="$1"; shift
  docker run --rm --network "$NET" -e DATABASE_URL="postgresql://sgb:sgb@$DB:5432/sgb" -e SGB_FIXTURE_OK=0 \
    -v "$d/prisma:/app/prisma:ro" -v "$d/scripts:/app/scripts:ro" -w /app --entrypoint bash "$IMG" -c "$*" 2>&1
}
psqlq() { docker exec -i "$DB" psql -U sgb -tA -v ON_ERROR_STOP=1 "$@" 2>&1; }
# v10.306 — postcheck DB 만 보는 방식(새 킷 스크립트 · $1 = 마이그레이션 상태를 견줄 킷 sgb 폴더)
PCDB=0; grep -q 'POSTCHECK_DB_ONLY' "$N/deploy/aws/postcheck.sh" 2>/dev/null && PCDB=1
pcdb() {
  docker run --rm --network "$NET" -e DATABASE_URL="postgresql://sgb:sgb@$DB:5432/sgb" -e POSTCHECK_DB_ONLY=1 -e APP_DIR=/app \
    -v "$N/deploy:/pc/deploy:ro" -v "$1/prisma:/app/prisma:ro" -v "$1/VERSION:/app/VERSION:ro" --entrypoint bash "$IMG" /pc/deploy/aws/postcheck.sh 2>&1
}
pcsum() { echo "$1" | sed -n 's/^적용 후 확인 — //p' | tail -1; }
pclines() { echo "$1" | sed -n "s/^  $2  //p" | sed 's/ — .*//; s/[[:space:]]*$//' | sort -u; }

# ② 옛 판 + 시드
o1=$(mig "$O" 'node scripts/migrate.js | tail -1; [ -f scripts/fixture.sql ] && psql "$DATABASE_URL" -q -f scripts/fixture.sql >/dev/null 2>&1; true')
OA=$(psqlq -c "select count(*) from schema_migrations" | tail -1)
echo "$o1" | grep -q "변경감지 0" || fail "옛 킷 마이그레이션부터 실패: $(echo "$o1" | tail -1)"
BEFORE=$(psqlq -c "$SL")
[ "$PCDB" = 1 ] && PCB=$(pcdb "$O")

# ③ 새 판 적용 · 한 번 더
m1=$(mig "$N" 'node scripts/migrate.js')
FIRST=$(echo "$m1" | tail -1)
echo "$m1" | grep -q '^!! ' && fail "새 마이그레이션 적용 실패: $(echo "$m1" | grep -m1 '^!! ')"
echo "$FIRST" | grep -q "변경감지 0" || fail "새 마이그레이션 적용 실패: $FIRST"
AFTER=$(psqlq -c "$SL")
[ "$PCDB" = 1 ] && PCA=$(pcdb "$N")
m2=$(mig "$N" 'node scripts/migrate.js | tail -1')
SECOND=$(echo "$m2" | tail -1)
echo "$SECOND" | grep -qE '^적용 0 · ' || fail "두 번째 실행이 적용 0 이 아님: $SECOND"

# ④ 새 마이그레이션 SQL 을 하나씩 다시
NEWM=()
for d in $(ls "$N/prisma/migrations"); do
  [ -f "$N/prisma/migrations/$d/migration.sql" ] || continue
  [ -f "$O/prisma/migrations/$d/migration.sql" ] && continue
  NEWM+=("$d")
done
RN=0; RF=0
for d in "${NEWM[@]}"; do
  out=$(psqlq -q < "$N/prisma/migrations/$d/migration.sql"); rc=$?
  RN=$((RN + 1))
  if [ $rc -ne 0 ]; then RF=$((RF + 1)); r "rerun_fail=$d: $(echo "$out" | grep -m1 ERROR | cut -c1-160)"; fi
  echo "$out" | grep -oE 'NOTICE: +.*' | sed -E 's/NOTICE: +//' | while IFS= read -r l; do echo "rerun_notice=$d: $l"; done >> "$TMP/rn.txt"
done
[ $RF -eq 0 ] || fail "다시 돌리면 오류 $RF 개"
RERUN=$(psqlq -c "$SL")
[ "$AFTER" = "$RERUN" ] || fail "다시 돌리면 숫자가 바뀜(재실행 안전 아님)"

# ⑤ 결과
r "# mig-rehearsal $(date -u '+%Y-%m-%d %H:%M UTC') · 버리는 DB(postgres:16 · 시드 scripts/fixture.sql) — 운영 값이 아님(차이만 봄)"
r "old=$OV"; r "new=$NV"
r "old_kit=$(basename "$OLD" .zip)"; r "new_kit=$(basename "$NEW" .zip)"
r "old_applied=$OA"
r "first=$FIRST"
r "first_ok=$(echo "$m1" | sed -n 's/^ok \([^ ]*\).*/\1/p' | paste -sd, -)"
while IFS= read -r l; do [ -n "$l" ] && r "first_notice=$l"; done < <(echo "$m1" | sed -n 's/^   NOTICE //p')
r "second=$SECOND"
r "rerun=$((RN - RF))/$RN"
[ -f "$TMP/rn.txt" ] && while IFS= read -r l; do r "$l"; done < "$TMP/rn.txt"
paste -d'|' <(echo "$BEFORE") <(echo "$AFTER") | while IFS='|' read -r b a; do
  echo "state=${b%%=*}|${b#*=}|${a#*=}"
done > "$TMP/st.txt"
while IFS= read -r l; do r "$l"; done < "$TMP/st.txt"
if [ "$PCDB" = 1 ]; then
  r "pc_before=$(pcsum "$PCB")"; r "pc_after=$(pcsum "$PCA")"
  for kind in 확인:warn 실패:fail; do
    ko=${kind%%:*}; en=${kind#*:}
    comm -13 <(pclines "$PCB" "$ko") <(pclines "$PCA" "$ko") | while IFS= read -r l; do [ -n "$l" ] && echo "pc_new_$en=$l"; done >> "$TMP/pc.txt"
    comm -23 <(pclines "$PCB" "$ko") <(pclines "$PCA" "$ko") | while IFS= read -r l; do [ -n "$l" ] && echo "pc_gone_$en=$l"; done >> "$TMP/pc.txt"
  done
  [ -f "$TMP/pc.txt" ] && while IFS= read -r l; do r "$l"; done < "$TMP/pc.txt"
else
  r "pc_skip=새 킷 postcheck.sh 에 DB 만 보는 방식 없음(v10.306 전)"
fi
SAME=$(awk -F'|' '$2==$3' "$TMP/st.txt" | wc -l | tr -d ' '); DIFF=$(awk -F'|' '$2!=$3' "$TMP/st.txt" | wc -l | tr -d ' ')
if [ -z "$FAIL" ]; then r "result=통과"; else r "result=실패 — $FAIL"; fi

if [ -n "$OUTF" ]; then printf '%s\n' "${R[@]}" > "$OUTF"; else printf '%s\n' "${R[@]}"; fi
echo "리허설: $OV → $NV · ${FIRST} · 두 번째 「${SECOND}」 · 다시 돌림 $((RN - RF))/$RN · 숫자 같음 $SAME · 바뀜 $DIFF · $( [ -z "$FAIL" ] && echo 통과 || echo "실패 — $FAIL")" >&2
[ -z "$FAIL" ]
