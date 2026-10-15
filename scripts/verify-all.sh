#!/usr/bin/env bash
# 전체 검증. CI 와 로컬에서 같은 것을 돕니다.
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
step() { echo; echo "── $1 ──"; }

# 의존성이 없으면 이후 단계가 전부 의미 없는 실패를 냅니다.
if [ ! -d node_modules ]; then
  echo "!! node_modules 없음 — 먼저 npm install 하십시오"
  exit 1
fi

step "마이그레이션 적용"
bash scripts/migrate.sh | tail -1 || FAIL=1

step "재실행 안전성"
out=$(bash scripts/migrate.sh | tail -1); echo "$out"
echo "$out" | grep -q "적용 0" || { echo "!! 재실행에서 다시 적용됨"; FAIL=1; }

node scripts/gen-terms-draft.js >/dev/null

step "DB 불변식"
# 두 번 돌립니다(다시 돌려도 같은 결과여야 합니다). 10/6 (v10.17) — 실패하면 **어느 항목인지** 보여 줍니다.
#   전에는 「통과 257 / 실패 1」 한 줄만 나와, 통합 검정이 실패해도 무엇이 틀렸는지 알 수 없었습니다.
#   첫 번째 결과도 판정에 넣습니다(전에는 두 번째만 봤습니다 — 화면에는 실패가 보이는데 통과로 끝날 수 있었습니다).
for round in 1 2; do
  inv=$(bash scripts/verify-invariants.sh 2>&1)
  [ "$round" = 1 ] && echo "$inv" | tail -1
  if ! echo "$inv" | tail -1 | grep -q "실패 0"; then
    [ "$round" = 2 ] && echo "다시 돌렸을 때: $(echo "$inv" | tail -1)"
    echo "$inv" | grep -E "FAIL|^!!" | head -20 | sed 's/^/   /'
    FAIL=1
  fi
done

step "연동 로직 시험"
npx ts-node -P tsconfig.scripts.json scripts/test-nts.ts | tail -1 || FAIL=1

step "비밀값 유출 점검"
bash scripts/check-secrets.sh | tail -1 || FAIL=1

step "국세청 어댑터 (오프라인)"
npx ts-node -P tsconfig.scripts.json scripts/test-nts-offline.ts | tail -1 || FAIL=1

step "결제 어댑터 (오프라인)"
npx ts-node -P tsconfig.scripts.json scripts/test-payment-offline.ts | tail -1 || FAIL=1

step "메일 발송기 (오프라인 · v10.43)"
npx ts-node -P tsconfig.scripts.json scripts/test-mail-offline.ts | tail -1 || FAIL=1

step "공격 검정"
# 두 번 돌립니다. 실패하면 어느 항목인지 보여 줍니다(10/6 · v10.17 — 불변식과 같은 이유).
for round in 1 2; do
  atk=$(bash scripts/attack-check.sh 2>&1)
  [ "$round" = 1 ] && echo "$atk" | tail -1
  if ! echo "$atk" | tail -1 | grep -q "뚫림 0"; then
    [ "$round" = 2 ] && echo "다시 돌렸을 때: $(echo "$atk" | tail -1)"
    echo "$atk" | grep -E "^[[:space:]]+(▲뚫림|★오류)|^!!" | head -20 | sed 's/^/   /'
    FAIL=1
  fi
done

step "OpenAPI 병합"
npx ts-node -P tsconfig.scripts.json scripts/dump-swagger.ts || FAIL=1

step "생성 파일 드리프트"
node scripts/gen-docs.js >/dev/null
# ★ merge 는 docs/_swagger_from_code.json 을 읽습니다.
#   docs:swagger 를 안 거치면 **낡은 것과 병합**해 x-status 가 비고,
#   그러면 패키징이 "미구현 226건" 으로 거부합니다 — 원인과 증상이 멉니다.
npm run docs:swagger >/dev/null 2>&1 || FAIL=1
node scripts/merge-openapi.js || FAIL=1
node scripts/gen-api-list.js
node scripts/gen-mvp-plan.js
node scripts/gen-db-doc.js
node scripts/gen-flow-doc.js
node scripts/gen-privacy-policy.js
node scripts/gen-code-doc.js
node scripts/gen-message-doc.js
node scripts/gen-prototype.js
node scripts/gen-codes.js > /tmp/_codes.ts
diff -q /tmp/_codes.ts src/generated/codes.ts >/dev/null && echo "codes.ts 일치" || { echo "!! codes.ts 드리프트"; FAIL=1; }

step "문서 정합성"
node scripts/verify-docs.js | tail -1 || FAIL=1

step "부팅 스모크"
JWT_SECRET="${JWT_SECRET:-$(head -c40 /dev/urandom | base64 | head -c40)}" \
npx ts-node -P tsconfig.scripts.json scripts/smoke-boot.ts | head -1 || FAIL=1

step "타입 검사 (백엔드)"
npx tsc -p tsconfig.json --noEmit && echo "백엔드 타입 오류 0" || FAIL=1

step "타입 검사 (프런트)"
if [ -d web/node_modules ]; then
  (cd web && npx tsc --noEmit) && echo "프런트 타입 오류 0" || FAIL=1
else
  echo "건너뜀 — web/ 에서 npm install 하십시오"
fi

echo
[ $FAIL -eq 0 ] && echo "전체 검증 통과" || echo "전체 검증 실패"
exit $FAIL
