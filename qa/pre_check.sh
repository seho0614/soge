#!/usr/bin/env bash
# v10.628 (docs/772) 미리 검사 — 전체 점검(realcheck · 회귀) 전에 작업 트리만으로 10분 안에 막히는 것 찾기
#   bash qa/pre_check.sh <core 작업 트리> [infra 작업 트리(기본: 이 qa 의 위)] [결과 폴더]
#   ① 형 검사 API · 운영 화면 · 사용자 웹(점검판 이미지에 작업 트리 src 를 얹음 · --network none)
#   ② 마이그레이션 — 버리는 DB(자기 네트워크 · 포트 안 엶)에 처음부터 · 다시 돌려 「적용 0 · 변경감지 0」 · INV-9 · INV-11 · 정규식 반복 255 넘음 0
#      MT_SQL 환경 변수(줄마다 SQL 한 줄)가 있으면 그 DB 에서 차례로 돌려 결과를 보임(새 함수 확인용)
#   ③ verify-docs · check-acl · 컨트롤러 getter
#   ④ 옛 시험 코드 부분 — main(~/sogaebank) ↔ 작업 트리 결과 비교(닿지 않는 주소 127.0.0.1:1 · --network none)
#   점검판 · 확인판 포트 · RDS 는 쓰지 않음(버리는 DB 만 · 포트를 열지 않음).
set -u
C=$(cd "${1:?core 작업 트리}" && pwd)
I=$(cd "${2:-$(dirname "$0")/..}" && pwd)
OUT=${3:-$HOME/check-results/pre_$(date +%Y%m%d_%H%M)}
mkdir -p "$OUT"
MAIN_CORE=${MAIN_CORE:-$HOME/sogaebank/sgb-core}; MAIN_QA=${MAIN_QA:-$HOME/sogaebank/sgb-infra/qa}
TAG=$$; DB=sgb-pre-db-$TAG; NET=sgb-pre-net-$TAG; VD=$(mktemp -d "${TMPDIR:-/tmp}/sgb-pre-vd.XXXXXX")
cleanup() { docker rm -f "$DB" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; rm -rf -- "${VD:?}"; }
trap cleanup EXIT INT TERM
echo "== 미리 검사 $(TZ=Asia/Seoul date '+%m/%d %H:%M') KST · VERSION $(cat "$C/VERSION" 2>/dev/null) · 결과 $OUT"

(docker run --rm --network none -v "$C/src:/app/src:ro" --entrypoint sh sgb-dev-api:latest -c 'npx tsc -p tsconfig.json --noEmit' > "$OUT/tsc_api.txt" 2>&1; echo "① tsc API rc=$?") &
(docker run --rm --network none -v "$C/web/src:/app/src:ro" --entrypoint sh sgb-dev-web:latest -c 'npx tsc -p tsconfig.json --noEmit' > "$OUT/tsc_web.txt" 2>&1; echo "① tsc 운영 화면 rc=$?") &
(docker run --rm --network none -v "$C/site/src:/app/src:ro" --entrypoint sh sgb-dev-site:latest -c 'npx tsc --noEmit' > "$OUT/tsc_site.txt" 2>&1; echo "① tsc 사용자 웹 rc=$?") &
(
  docker network create "$NET" >/dev/null 2>&1
  docker run -d --rm --name "$DB" --network "$NET" -e POSTGRES_USER=sgb -e POSTGRES_PASSWORD=sgb -e POSTGRES_DB=sgb postgres:16 >/dev/null
  for _ in $(seq 1 60); do docker exec "$DB" pg_isready -U sgb -q 2>/dev/null && break; sleep 1; done; sleep 2
  mig() { docker run --rm --network "$NET" -e DATABASE_URL=postgresql://sgb:sgb@$DB:5432/sgb -e SGB_FIXTURE_OK=0 -v "$C/prisma:/app/prisma:ro" -v "$C/scripts:/app/scripts:ro" -v "$VD:/app/docs" -w /app --entrypoint node sgb-dev-checks:latest scripts/migrate.js 2>&1; }
  P() { docker exec "$DB" psql -U sgb -d sgb -At -c "$1" 2>&1; }
  { echo "-- 처음"; mig | tail -3
    for q in "SELECT count(*) || '|' || max(name) FROM schema_migrations" "SELECT count(*) FROM v_inv9_violations" "SELECT count(*) FROM v_inv11_violations" \
             "SELECT count(*) FROM pg_constraint WHERE contype='c' AND pg_get_constraintdef(oid) ~ '\{[0-9]*,(2[6-9][0-9]|[3-9][0-9][0-9])\}'" \
             "SELECT count(*) FROM pg_proc WHERE prosrc ~ '\{[0-9]*,(2[6-9][0-9]|[3-9][0-9][0-9])\}'"; do echo "> $q"; P "$q"; done
    if [ -n "${MT_SQL:-}" ]; then while IFS= read -r q; do [ -n "$q" ] && { echo "> $q"; P "$q"; }; done <<< "$MT_SQL"; fi
    echo "-- 다시 돌림"; mig | tail -1; } > "$OUT/migrate.txt"
  echo "② 마이그레이션 끝"
) &
wait
for f in tsc_api tsc_web tsc_site; do [ -s "$OUT/$f.txt" ] && { echo "-- $f"; head -c 1500 "$OUT/$f.txt"; }; done
cat "$OUT/migrate.txt"

echo "== ③ verify-docs · check-acl · getter"
cp -r "$C/docs" "$C/spec" "$VD/"
docker run --rm --network none -v "$C/src:/app/src:ro" -v "$C/scripts:/app/scripts:ro" -v "$C/prisma:/app/prisma:ro" -v "$VD/docs:/app/docs" -v "$VD/spec:/app/spec" -w /app --entrypoint bash sgb-dev-checks:latest \
  -c "node scripts/gen-docs.js >/dev/null; npm run docs:swagger >/dev/null 2>&1; node scripts/merge-openapi.js >/dev/null; node scripts/verify-docs.js > /tmp/vd.txt 2>&1; echo verify-docs rc=\$?; grep -vE '^\s+ok ' /tmp/vd.txt | head -30" > "$OUT/verify_docs.txt" 2>&1
cat "$OUT/verify_docs.txt"
docker run --rm --network none -v "$C/src:/app/src:ro" -v "$C/scripts:/app/scripts:ro" -w /app --entrypoint node sgb-dev-api:latest scripts/check-acl.js 2>&1 | tail -4
grep -rnE "^\s+(private |public |protected )?get [a-zA-Z_]+\(\)" "$C/src" --include=*.controller.ts | head -5

echo "== ④ 옛 시험 코드 부분(main ↔ 작업 트리)"
run() { local Q=$1 K=$2 O=$3; (cd "$Q" && ls test_v1*.py | xargs -P 6 -I{} sh -c "docker run --rm --network none -v $Q:/w:ro -v $K:/core/sgb:ro -w /w -e KIT=/core -e API=http://127.0.0.1:1/x -e DB=postgresql://x:x@127.0.0.1:1/x sgb-qa:v1 timeout 120 python3 {} 2>&1 | grep -E '^결과|^FAIL' | sed 's#^#{} | #'" | sort > "$O"); }
run "$MAIN_QA" "$MAIN_CORE" "$OUT/static_main.txt"
run "$I/qa" "$C" "$OUT/static_new.txt"
norm() { sed -E 's/[0-9]+/N/g' "$1"; }
echo "main $(wc -l < "$OUT/static_main.txt") 줄 · 작업 트리 $(wc -l < "$OUT/static_new.txt") 줄 — 다른 줄(앞 40):"
diff <(norm "$OUT/static_main.txt") <(norm "$OUT/static_new.txt") | grep '^[<>]' | head -40
echo "-- 작업 트리에서만 FAIL(앞 30):"
grep -E '\| FAIL' "$OUT/static_new.txt" | grep -vF -f <(grep -E '\| FAIL' "$OUT/static_main.txt"; echo '@@없음@@') | head -30
echo "== 미리 검사 끝 $(TZ=Asia/Seoul date '+%H:%M') KST"
