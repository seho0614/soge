#!/usr/bin/env bash
# 배포 전 점검. 통과하지 못하면 배포하지 않습니다.
#
# 사용: DATABASE_URL=... ENVIRONMENT=stg|prod bash scripts/deploy-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ENV="${ENVIRONMENT:-stg}"
FAIL=0
ok(){ printf "  ok   %s\n" "$1"; }
no(){ printf "  FAIL %s%s\n" "$1" "${2:+ → $2}"; FAIL=$((FAIL+1)); }
: "${DATABASE_URL:?DATABASE_URL 필요}"
# 10/3 (v10.16) — psql 에 넘길 주소. 앱(Node)만 아는 SSL 표기(sslmode=no-verify · uselibpqcompat)를 psql 이 아는 표기로 바꿉니다.
#   RDS 접속 주소를 앱에 맞춰 적으면 psql 이 「invalid sslmode value」로 거절해 이 스크립트가 전부 실패로 나왔습니다.
PGURL=$(printf '%s' "${DATABASE_URL:-}" | sed -E 's/([?&])uselibpqcompat=[^&]*(&|$)/\1/; s/sslmode=no-verify/sslmode=require/; s/[?&]$//')
PSQL="psql $PGURL -t -A -c"

echo "환경: $ENV"
echo
echo "── 1. 코드 ──"
[ -d node_modules ] || { echo "!! npm install 먼저"; exit 1; }
npx tsc -p tsconfig.json --noEmit >/dev/null 2>&1 && ok "타입 오류 0" || no "타입 오류"
node scripts/gen-docs.js >/dev/null 2>&1
node scripts/gen-codes.js > /tmp/_c.ts 2>/dev/null
diff -q /tmp/_c.ts src/generated/codes.ts >/dev/null && ok "생성 파일 최신" || no "생성 파일 드리프트" "npm run docs"

echo
echo "── 2. 마이그레이션 ──"
# 10/3 (v10.16) — 전에는 "적용 예정" 글자를 세어, 맨 끝 요약 줄(… · 적용 예정 N)까지 세는 바람에 **1건 많게** 나왔습니다. 줄 머리(→)로 셉니다.
pend=$(node scripts/migrate.js --status 2>/dev/null | grep -c "^→" || true)
[ "$pend" = "0" ] && ok "미적용 마이그레이션 없음" || printf "  →   적용 예정 %s건\n" "$pend"
drift=$(node scripts/migrate.js --status 2>/dev/null | grep -c "변경됨" || true)
[ "$drift" = "0" ] && ok "적용된 파일 변조 없음" || no "마이그레이션 변조 $drift건"

echo
echo "── 3. 불변식 ──"
v=$($PSQL "SELECT coalesce(sum(violation_count),0) FROM fn_verify_invariants();" 2>/dev/null || echo ERR)
[ "$v" = "0" ] && ok "불변식 위반 0건" || no "불변식 위반 $v건" "롤백 대상"

echo
echo "── 4. 코드 라벨 ──"
m=$($PSQL "SELECT count(*) FROM v_code_missing_labels;" 2>/dev/null || echo ERR)
[ "$m" = "0" ] && ok "라벨 누락 0건" || no "라벨 없는 코드 $m건" "화면에 영문이 나갑니다"

echo
echo "── 5. 오픈 차단 항목 ──"
b=$($PSQL "SELECT count(*) FROM v_open_blockers;" 2>/dev/null || echo ERR)
brk=$($PSQL "SELECT string_agg(kind||':'||c, ' ') FROM (SELECT kind, count(*) c FROM v_open_blockers GROUP BY kind) x;" 2>/dev/null)
if [ "$ENV" = "prod" ]; then
  [ "$b" = "0" ] && ok "필수 설정 전건 입력" || no "오픈 차단 $b건" "$brk"
else
  printf "  →   오픈 차단 %s건 [%s] (stg 는 경고만)\n" "$b" "$brk"
fi

echo
echo "── 6. 운영 경보 ──"
c=$($PSQL "SELECT count(*) FROM ops_alerts WHERE severity='CRITICAL' AND acknowledged_at IS NULL;" 2>/dev/null || echo 0)
[ "$c" = "0" ] && ok "미확인 CRITICAL 경보 없음" || no "미확인 CRITICAL $c건" "먼저 처리하십시오"

echo
echo "── 7. 부팅 ──"
JWT_SECRET="${JWT_SECRET:-$(head -c40 /dev/urandom|base64|head -c40)}" \
npx ts-node -P tsconfig.scripts.json \
  scripts/smoke-boot.ts >/tmp/_boot.txt 2>&1 \
  && ok "$(head -1 /tmp/_boot.txt) 등록" || no "부팅 실패" "$(tail -2 /tmp/_boot.txt|head -1)"

echo
echo "── 8. AWS 기동 전제 ──"
# ★ start 스크립트가 없어 `npm start` 가 안 됐습니다(2026-09-23).
#   절차서 6부는 이것을 전제합니다 — 없으면 서버를 못 띄웁니다.
node -e "process.exit(require('./package.json').scripts.start?0:1)" 2>/dev/null \
  && ok "start 스크립트" \
  || no "start 스크립트 없음" "npm start 가 안 되면 AWS 에서 서버를 못 띄웁니다"

# Node 버전을 못 박지 않으면 AWS 기본(18)에서 안 돌 수 있습니다.
node -e "process.exit(require('./package.json').engines?.node?0:1)" 2>/dev/null \
  && ok "engines.node 지정" \
  || no "engines.node 없음" "AWS 기본 Node 가 낮으면 기동에 실패합니다"

echo
[ $FAIL -eq 0 ] && echo "배포 가능" || echo "배포 불가 — 실패 $FAIL건"
exit $FAIL
