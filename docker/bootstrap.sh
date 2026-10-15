#!/usr/bin/env bash
# =====================================================================
# 본체 준비 — migrate 컨테이너가 `docker compose up` 때마다 실행합니다.
#
#   처음 (accounts 0건)   local-setup.sh 전체 — 스키마·계정·약관·시드
#   두 번째부터           마이그레이션만 — 새 파일이 있으면 적용 (+ v10.15: 메인 투표 시드 확인 — 없을 때만)
#   SGB_RESET=1           처음처럼 다시 (개발 데이터 지워짐)
#
# ── 왜 나눴는가 (20260930) ─────────────────────────────────────────
# 전에는 매번 local-setup.sh 를 돌렸고, 그 안의 fixture.sql 이
# accounts · requests 등을 DELETE 합니다. 실측 — 화면에서 넣은 요청이
# `up` 한 번에 사라졌습니다.
# =====================================================================
set -uo pipefail
cd /app

for i in $(seq 1 60); do
  psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1 && break; sleep 1
done

n=$(psql "$DATABASE_URL" -t -A -c \
  "SELECT CASE WHEN to_regclass('public.accounts') IS NULL THEN 0
               ELSE (SELECT count(*) FROM accounts) END" 2>/dev/null || echo 0)

if [ "${SGB_RESET:-0}" = "1" ] || [ "${n:-0}" = "0" ]; then
  echo "── 처음 준비 (계정 ${n}건 · RESET=${SGB_RESET:-0}) ──"
  exec bash scripts/local-setup.sh
fi

echo "── 기존 데이터 유지 (계정 ${n}건) — 마이그레이션만 ──"
out=$(node scripts/migrate.js); rc=$?
echo "$out" | tail -1
echo "$out" | grep -q "변경감지 0" || { echo "!! 적용된 마이그레이션 파일이 바뀌었습니다"; exit 1; }
[ $rc = 0 ] || exit $rc
# v10.15 — 메인 「이건 어때?」 투표 3건(개발 · 시연용 시드). 투표가 하나도 없거나 v10.14 의 예시 문구 투표가 남아 있을 때만 넣습니다.
#   전에는 처음 준비 때만 넣어, 쓰던 DB 를 올리면 메인 카드 3장이 「준비 중」으로 남았습니다. 운영이 만든 투표가 있으면 건드리지 않습니다.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/seed-polls.sql && echo "투표 시드 확인 (메인 $(psql "$DATABASE_URL" -tAc 'select count(*) from v_poll_home')건)" || echo "!! 투표 시드 실패 — 계속합니다"
# v10.24 — 생활 · 금융 상담: 시연용 인증업체가 리드형 업종을 모두 받게 합니다(개발 · 시연용 시드 · 있는 것은 건너뜀).
#   쓰던 DB 를 올려도 「준비 중」 19업종이 열리게 — 처음 준비 때만 넣으면 v10.23 까지 쓰던 DB 에는 들어가지 않습니다.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/seed-consult-demo.sql >/dev/null 2>&1 && echo "상담 시드 확인 (받는 업종 $(psql "$DATABASE_URL" -tAc 'select count(distinct category_id) from v_consult_eligible_partner')종)" || echo "!! 상담 시드 실패 — 계속합니다"
# v10.26 — 소개몰 견본 상품(시안의 16종 + 화장품 견본 · 개발 · 시연용). 쓰던 DB 를 올려도 들어가게 — 이미 있는 코드는 건너뜀(운영자가 고친 값 · 재고를 덮지 않음)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/seed-hlt-samples.sql >/dev/null 2>&1 && echo "소개몰 견본 확인 (판매 중 $(psql "$DATABASE_URL" -tAc "select count(*) from hlt_products where code ~ '^p[0-9]{2}$' and status = 'ON_SALE'")종)" || echo "!! 소개몰 견본 시드 실패 — 계속합니다"
exit 0
