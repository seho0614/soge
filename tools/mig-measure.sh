#!/usr/bin/env bash
# 큰 운영 반영 리허설 측정 — v10.787 (sgb-core docs/896)
#
#   bash tools/mig-measure.sh <지금 운영 킷.zip> <올릴 킷.zip> [-o 결과.txt] [--rows 10000]
#
#   mig-rehearsal.sh(적용이 되나 · 다시 돌려도 같나)와 짝 — 이것은 「얼마나 걸리고 무엇을 잠그나 · 되돌리기가 안전한가」를 잼.
#   ① 버리는 postgres:16(자체 네트워크 · 포트 안 엶 · 끝나면 지움) ② 옛 킷 마이그레이션 + 시드(fixture.sql) + 부하 시드(seed-load.js · 매물 --rows 건)
#   ③ 새 마이그레이션을 tools/mig-measure.js 로 적용(migrate.js 와 같은 규칙) — 파일마다 ms · COMMIT 앞 잠금(전부터 있던 표 · 줄 수) · 되돌리기 위험 글자
#   ④ 걸린 시간 합계 · 읽기도 막는 잠금(AccessExclusive) 시간 합계 · 가장 오래 걸린 5개 · 줄 수 많은 표 잠금 · 되돌리기 판정
#      되돌리기: 운영 rollback.sh 는 킷만 옛 판으로 바꾸고 DB 는 그대로 둠 → 새 마이그레이션에 지우기 · 이름 바꾸기 · NOT NULL 더함 · 형 바꿈이 없으면
#      옛 코드가 새 DB 로 돎(「킷만 되돌려도 됨」) · 있으면 「스냅샷 복원 필요」
#   운영 서버 · RDS 에 닿지 않습니다. 버리는 DB 의 시간은 운영(RDS)과 다릅니다 — 크기 차이(어느 파일이 무겁나)를 보는 것.
#   종료 0 = 측정함 · 1 = 적용 실패 · 2 = 쓰는 법 · 킷 문제
set -uo pipefail
IMG="${SGB_REH_IMG:-sgb-dev-checks:latest}"
OUTF=""; ROWS=10000; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -o) OUTF="${2:-}"; shift 2 ;;
    --rows) ROWS="${2:-10000}"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
[ ${#ARGS[@]} -eq 2 ] || { echo "쓰는 법: bash tools/mig-measure.sh <지금 운영 킷.zip> <올릴 킷.zip> [-o 결과.txt] [--rows 10000]" >&2; exit 2; }
case "$ROWS" in ''|*[!0-9]*) echo "--rows 는 숫자" >&2; exit 2;; esac
OLD="${ARGS[0]}"; NEW="${ARGS[1]}"
for z in "$OLD" "$NEW"; do
  case "$z" in *.zip) ;; *) echo "킷 zip 이 아님: $z" >&2; exit 2 ;; esac
  [ -f "$z" ] || { echo "킷 zip 이 아님: $z" >&2; exit 2; }
  if unzip -Z1 "$z" | grep -qE '(^/|(^|/)\.\.(/|$))'; then echo "킷 안 이상한 경로: $z" >&2; exit 2; fi
done
H="$(cd "$(dirname "$0")" && pwd)"
TAG="sgb-mmeas-$$"; NET="$TAG-net"; DB="$TAG-db"
TMP=$(mktemp -d -t migmeas_XXXXXX)
cleanup() { docker rm -f "$DB" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; [ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf -- "${TMP:?}"; }
trap cleanup EXIT INT TERM

unzip -q "$OLD" -d "$TMP/o" && unzip -q "$NEW" -d "$TMP/n" || { echo "킷을 풀지 못함" >&2; exit 2; }
top() { local d; d=$(find "$1" -mindepth 1 -maxdepth 1 -type d); [ "$(echo "$d" | wc -l)" = 1 ] && echo "$d"; }
O=$(top "$TMP/o")/sgb; N=$(top "$TMP/n")/sgb
[ -d "$O/prisma/migrations" ] && [ -d "$N/prisma/migrations" ] || { echo "킷에 sgb/prisma/migrations 가 없음" >&2; exit 2; }
OV=$(tr -d '[:space:]' < "$O/VERSION"); NV=$(tr -d '[:space:]' < "$N/VERSION")

docker network create "$NET" >/dev/null || { echo "도커 네트워크를 만들지 못함" >&2; exit 2; }
docker run -d --rm --name "$DB" --network "$NET" -e POSTGRES_USER=sgb -e POSTGRES_PASSWORD=sgb -e POSTGRES_DB=sgb postgres:16 >/dev/null || { echo "버리는 DB 를 띄우지 못함" >&2; exit 2; }
for _ in $(seq 1 60); do docker exec "$DB" pg_isready -U sgb -q 2>/dev/null && break; sleep 1; done; sleep 2
run() {   # $1 = 킷 sgb 폴더 · 나머지 = bash 명령
  local d="$1"; shift
  docker run --rm --network "$NET" -e DATABASE_URL="postgresql://sgb:sgb@$DB:5432/sgb" -e SGB_FIXTURE_OK=0 -e N_LISTINGS="$ROWS" \
    -e N_ACCOUNTS=$(( ROWS / 20 + 50 )) -e N_REQUESTS=$(( ROWS * 3 / 20 + 10 )) \
    -v "$d/prisma:/app/prisma:ro" -v "$d/scripts:/app/scripts:ro" -v "$H/mig-measure.js:/app/mig-measure.js:ro" -v "$TMP:/out" -w /app --entrypoint bash "$IMG" -c "$*" 2>&1
}
T0=$(date +%s)
o1=$(run "$O" 'node scripts/migrate.js | tail -1; [ -f scripts/fixture.sql ] && psql "$DATABASE_URL" -q -f scripts/fixture.sql >/dev/null 2>&1; true')
echo "$o1" | grep -q "변경감지 0" || { echo "옛 킷 마이그레이션부터 실패: $(echo "$o1" | head -1)" >&2; exit 1; }
# 부하 시드는 새 킷 scripts/seed-load.js 로(옛 킷 것은 상담 업종을 골라 멈출 수 있음 · v10.787 고침) — 옛 판 DB 에 넣음
SEED=$(run "$N" '[ -f scripts/seed-load.js ] && node scripts/seed-load.js 2>&1 | tail -1 || echo "seed-load 없음"')
docker exec "$DB" psql -U sgb -q -c "ANALYZE" >/dev/null 2>&1   # 줄 수(reltuples)를 맞춤
SIZE=$(docker exec "$DB" psql -U sgb -tA -c "SELECT pg_size_pretty(pg_database_size('sgb'))")
BIG=$(docker exec "$DB" psql -U sgb -tA -c "SELECT string_agg(relname || ' ' || greatest(reltuples,0)::bigint, ' · ' ORDER BY reltuples DESC) FROM (SELECT relname, reltuples FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace ORDER BY reltuples DESC LIMIT 5) x")
T1=$(date +%s)
m=$(run "$N" 'node mig-measure.js prisma/migrations /out/measure.tsv'); RC=$?
T2=$(date +%s)
[ -f "$TMP/measure.tsv" ] || : > "$TMP/measure.tsv"

R=$(python3 -I - "$TMP/measure.tsv" "$OV" "$NV" "$SIZE" "$BIG" "$ROWS" "$((T2 - T1))" "$RC" <<'PY'
import sys
f, ov, nv, size, big, rows, wall, rc = sys.argv[1:9]
L = [l.rstrip('\n').split('\t') for l in open(f, encoding='utf-8') if l.strip()]
ok = [x for x in L if x[1] != '-1']
tot = sum(int(x[1]) for x in ok)
ax = [x for x in ok if 'AccessExclusive' in x[2]]
axms = sum(int(x[1]) for x in ax)
risk = [x for x in ok if x[3] != '-']
out = [f"# mig-measure · 버리는 DB(postgres:16 · fixture + 부하 시드 매물 {rows}건 · DB {size}) — 운영(RDS) 시간과 다름 · 크기 차이를 봄",
       f"old={ov}", f"new={nv}", f"big_tables={big}", f"migrations={len(ok)}", f"total_ms={tot}", f"wall_s={wall}",
       f"access_exclusive_files={len(ax)}", f"access_exclusive_ms={axms}"]
for x in sorted(ok, key=lambda x: -int(x[1]))[:5]:
    out.append(f"slow={x[0]}|{x[1]}ms|{x[2]}")
for x in ok:
    for t in (x[2].split(',') if x[2] != '-' else []):
        name, mode, n = t.split(':')
        if mode == 'AccessExclusive' and int(n) >= 1000:
            out.append(f"big_lock={x[0]}|{name}|{n}줄|{x[1]}ms")
for x in risk:
    out.append(f"rollback_risk={x[0]}|{x[3]}")
for x in L:
    if x[1] == '-1':
        out.append(f"error={x[0]}|{x[3]}")
out.append('rollback=' + ('킷만 되돌려도 됨(지우기 · 이름 바꾸기 · NOT NULL · 형 바꿈 없음)' if not risk else f'스냅샷 복원 필요 가능 — 위험 {len(risk)}개 파일(옛 코드가 새 DB 에서 깨질 수 있음)'))
out.append('result=' + ('측정함' if rc == '0' else '적용 실패'))
summary = (f"측정: {ov} → {nv} · 마이그레이션 {len(ok)}개 {tot/1000:.1f}초 · 읽기 막는 잠금 {len(ax)}개 파일 {axms/1000:.1f}초 · "
           + ('되돌리기 킷만' if not risk else f'되돌리기 위험 {len(risk)}') + f" · DB {size}")
print('\n'.join(out)); print('@@' + summary)
PY
)
BODY=$(printf '%s\n' "$R" | grep -v '^@@'); SUM=$(printf '%s\n' "$R" | sed -n 's/^@@//p')
{ printf '%s\n' "$BODY"; echo "--- 파일마다(이름 · ms · 잠금 표:모드:줄 수 · 되돌리기 위험)"; cat "$TMP/measure.tsv"; } > "${OUTF:-/dev/stdout}"
echo "$SUM · 준비 $((T1 - T0))초 · 부하 시드 「${SEED}」" >&2
[ "$RC" = 0 ]
