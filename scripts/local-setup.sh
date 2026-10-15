#!/usr/bin/env bash
# =====================================================================
# 로컬 시험 환경 — 한 번에 준비합니다.
#
#   bash scripts/local-setup.sh
#
# 하는 일: DB 기동 → 마이그레이션 → 픽스처 → 개발 비밀번호 →
#          약관 발행 → 시험 데이터 → 확인
#
# ── 왜 스크립트인가 ───────────────────────────────────────────────
# 손으로 하면 db:seed:dev 를 빠뜨립니다. 그러면 로그인이 401 로 막히는데
# 원인이 안 보여서 한참 헤맵니다. 순서를 코드로 고정합니다.
#
# 여러 번 돌려도 안전합니다 — 있으면 건너뜁니다.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:54329/sgb}"
export JWT_SECRET="${JWT_SECRET:-dev-only-secret-change-me-0123456789abcdef}"
# JOB_TOKEN 은 기본값을 두지 않습니다.
#
# 소스에 박아 두면 **그 값이 그대로 배포될 수 있습니다** —
# 검정(비밀값)이 이것을 잡습니다. 없으면 그때그때 만듭니다.
if [ -z "${JOB_TOKEN:-}" ]; then
  JOB_TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
export JOB_TOKEN
Q="psql $DATABASE_URL -t -A -c"
step() { printf "\n── %s ──\n" "$1"; }

step "1. DB 확인"
# Docker 에서는 db 컨테이너가 따로 뜹니다 — 임베디드를 띄우지 않습니다.
# SKIP_DB_BOOT=1 이면 기다리기만 합니다.
if ! psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1 && [ "${SKIP_DB_BOOT:-0}" = "1" ]; then
  echo "  DB 를 기다립니다"
  for i in $(seq 1 60); do
    psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1 && break
    sleep 1
  done
fi
if ! psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
  echo "  DB 가 없습니다. 임베디드 PostgreSQL 을 띄웁니다 (포트 54329)"
  setsid node scripts/dev-db.js > /tmp/sgb-db.log 2>&1 &
  for i in $(seq 1 60); do
    psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1 && break
    sleep 1
  done
  psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1 || {
    echo "  !! DB 기동 실패 — /tmp/sgb-db.log 를 보십시오"; exit 1; }
fi
echo "  ok   $DATABASE_URL"

step "2. 스키마"
node scripts/migrate.js | tail -1

step "3. 기준 데이터 · 개발 계정"
psql "$DATABASE_URL" -q -f scripts/fixture.sql >/dev/null 2>&1
node scripts/seed-dev-passwords.js | tail -1
echo "  ok   비밀번호 sgb-dev-1234"

step "4. 약관 발행"
# 발행하지 않으면 동의 화면이 비고, 오픈 차단도 줄지 않습니다.
node scripts/gen-privacy-policy.js >/dev/null 2>&1
node scripts/gen-terms-draft.js    >/dev/null 2>&1
# ★ ADPERSONAL 이 빠져 있었습니다.
#   맞춤형 광고 동의는 B-12 회신으로 선택 약관이 되었고, 발행하지 않으면
#   **빈 DB 로 세운 환경에서만 검정이 뚫립니다** — 개발 중엔 안 보입니다.
#
#   주석을 줄 연속(\) 뒤에 넣으면 이어짐이 끊겨 EFFECTIVE_FROM 이
#   전달되지 않습니다. 명령 위에 둡니다.
EFFECTIVE_FROM="${EFFECTIVE_FROM:-2026-10-01}" \
  bash scripts/publish-terms.sh SERVICE REFUND PRIVACY ADPERSONAL OUTSOURCE THIRDPARTY HLT_SALE 2>&1 | grep -E "^  (ok|FAIL)" || true

step "5. 시험 데이터"
# 화면을 열었을 때 빈 목록만 보이면 무엇이 고장인지 알 수 없습니다.
# 흐름마다 최소 한 건씩 넣습니다.
psql "$DATABASE_URL" -q <<'SQL' 2>/dev/null
-- 사업자 인증 (파트너·소개자 흐름에 필요)
SET session_replication_role = replica;
UPDATE accounts SET identity_verified_at = now() WHERE identity_verified_at IS NULL;
UPDATE businesses SET verified_at = now() WHERE verified_at IS NULL;
SET session_replication_role = origin;

-- ★ 20260930 — 역할 행을 채웁니다.
--   가입 API 는 MEMBER 를 넣지만 픽스처 계정은 역할 행이 없어, 사업자 인증을 해도
--   BIZ_OWNER 가 아니었습니다. 실측 — intro@x.com 으로 파트너센터·내 매물이 403.
--   역할이 하나라도 생기면 기본 MEMBER 가 빠지므로 MEMBER 도 함께 넣습니다.
INSERT INTO account_roles (account_id, role)
SELECT a.id, 'MEMBER' FROM accounts a
 WHERE NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role IN ('ADMIN','SUPER'))
ON CONFLICT DO NOTHING;
INSERT INTO account_roles (account_id, role)
SELECT DISTINCT b.account_id, 'BIZ_OWNER' FROM businesses b WHERE b.verified_at IS NOT NULL
ON CONFLICT DO NOTHING;

-- 요청 1건 (소개자가 응답할 대상)
-- v10.34 — 마감일(등록 + 30일 · D044)도 채웁니다
INSERT INTO requests (gwan_code, owner_account_id, title, body, status, closes_at)
SELECT 'MNY', a.id, '사무실 인테리어 업체를 찾습니다',
       '금천구 40평 사무실입니다. 10월 중 착공 희망합니다.', 'PUBLISHED', now() + interval '30 days'
  FROM accounts a WHERE a.email = 'buyer@x.com'
   AND NOT EXISTS (SELECT 1 FROM requests WHERE title LIKE '사무실 인테리어%');

-- 파트너 (리드·이용료 흐름)
-- ★ approved_by 를 채웁니다.
--   승인자 없이 ACTIVE 면 "누가 들여보냈는가" 를 답할 수 없습니다.
--   파트너는 미수금 한도를 갖는 자리라 더 그렇습니다.
INSERT INTO partners (business_id, status, approved_at, approved_by)
SELECT b.id, 'ACTIVE', now(),
       (SELECT id FROM accounts WHERE email = 'admin@x.com' LIMIT 1)
  FROM businesses b
  JOIN accounts a ON a.id = b.account_id WHERE a.email = 'intro@x.com'
ON CONFLICT (business_id) DO UPDATE
  SET status = 'ACTIVE', approved_at = now(),
      approved_by = (SELECT id FROM accounts WHERE email = 'admin@x.com' LIMIT 1);

INSERT INTO partner_services (partner_id, title, body, status)
SELECT p.id, '사무실 인테리어 시공', '40평 이하 사무실 리모델링 전문', 'APPROVED'
  FROM partners p
 WHERE NOT EXISTS (SELECT 1 FROM partner_services WHERE partner_id = p.id);

INSERT INTO partner_regions (partner_id, sido, sigungu)
SELECT p.id, '서울', '금천구' FROM partners p
ON CONFLICT DO NOTHING;

-- 안심소개 상담 축 (D018 · 20261002) — 시연용 인증업체.
--   상담 신청은 「상담 축 입점 승인 + 그 업종의 승인 서비스 + 활동 지역」을 갖춘 업체에만 갑니다.
--   시드 파트너에 입점 승인과 「청소」(자격 서류가 필요 없는 일반 업종) 서비스를 넣어,
--   /consult 에서 「청소 · 서울 · 금천구」로 신청하면 이 업체 1곳에 전달되는 것을 바로 볼 수 있게 합니다.
INSERT INTO mal_partner_axes (business_id, axis, state, source, reason, decided_at, decided_by)
SELECT p.business_id, 'CONSULT', 'APPROVED', 'ADMIN', '개발 시드 — 시연용 인증업체', now(),
       (SELECT id FROM accounts WHERE email = 'admin@x.com' LIMIT 1)
  FROM partners p
  JOIN businesses b ON b.id = p.business_id
  JOIN accounts a ON a.id = b.account_id WHERE a.email = 'intro@x.com'
ON CONFLICT (business_id, axis) DO NOTHING;

INSERT INTO partner_services (partner_id, category_id, title, body, status)
SELECT p.id, c.id, '입주 · 사무실 청소', '서울 금천구 일대 입주 · 사무실 · 정기 청소 상담', 'APPROVED'
  FROM partners p
  JOIN businesses b ON b.id = p.business_id
  JOIN accounts a ON a.id = b.account_id
  JOIN categories c ON c.gwan_code = 'MAL' AND c.code = 'CSL_CLEANING'
 WHERE a.email = 'intro@x.com'
   AND NOT EXISTS (SELECT 1 FROM partner_services s WHERE s.partner_id = p.id AND s.category_id = c.id);

-- 리드 1건 (열람하면 이용료가 발생합니다)
INSERT INTO leads (summary, sido, sigungu)
SELECT '사무실 인테리어 40평', '서울', '금천구'
 WHERE NOT EXISTS (SELECT 1 FROM leads);

INSERT INTO lead_deliveries (lead_id, partner_id)
SELECT l.id, p.id FROM leads l CROSS JOIN partners p
ON CONFLICT DO NOTHING;
SQL
# v10.24 — 시연용 인증업체가 생활 · 금융 상담의 리드형 업종을 모두 받게 합니다(개발 · 시연용 · 여러 번 돌려도 같음).
#   규칙(받을 업체가 0곳이면 신청을 막음)은 그대로이고, 전에는 「청소」 말고는 모두 「준비 중」이라 상담 신청을 끝까지 눌러 볼 수 없었습니다.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f scripts/seed-consult-demo.sql >/dev/null 2>&1 \
  && echo "  상담 시드  받는 업종 $($Q "SELECT count(DISTINCT e.category_id) FROM v_consult_eligible_partner e")종" || echo "  !! 상담 시드 실패 — 계속합니다"
# v10.34 — 메인 「이건 어때?」 투표 3건(개발 · 시연용 · 없을 때만). 전에는 bootstrap.sh 의 두 번째 기동부터 넣어, 새로 설치한 DB 는 처음 한 번 메인 카드가 「준비 중」이었습니다
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f scripts/seed-polls.sql >/dev/null 2>&1 \
  && echo "  투표 시드  메인 $($Q "SELECT count(*) FROM v_poll_home")건" || echo "  !! 투표 시드 실패 — 계속합니다"
$Q "SELECT '  요청 '||(SELECT count(*) FROM requests)||' · 파트너 '||(SELECT count(*) FROM partners)||' · 리드 '||(SELECT count(*) FROM lead_deliveries)"

step "6. 확인"
$Q "SELECT '  오픈 차단 '||count(*)||'건' FROM v_open_blockers"
$Q "SELECT '  결정 대기 '||count(*)||'건 (착수 전 확인)' FROM v_pending_decisions"
n=$($Q "SELECT count(*) FROM v_term_not_agreed")
# ── 실제 같은 시드 ──────────────────────────────────────────────────
#
# ★ 검정(verify-invariants · attack-check)은 `fixture.sql` 로 DB 를
#   비우고 시작합니다. 그게 맞습니다 — 앞 시험이 남긴 데이터가
#   뒤 시험을 통과시키면 안 되기 때문입니다.
#
#   그래서 시드는 **검정 뒤에** 다시 넣어야 합니다.
#   `npm run verify` 를 돌리면 시드가 사라지므로, 화면을 보실 때는
#   이 스크립트를 다시 돌리거나 아래 명령만 따로 치십시오.
#
#   ★ 20261002 — 이제 검정은 **검정 전용 DB(이름 끝 _check · _ci · _test)에서만** 돕니다.
#     개발 DB 에서는 멈춥니다. 예: createdb sgb_check && DATABASE_URL=.../sgb_check npm run verify
#
#     node scripts/seed-realistic.js
step "8. 실제 같은 시드"
node scripts/seed-realistic.js 2>&1 | grep -E "시드|로그인" || true
# v10.26 — 소개몰 견본 상품(시안의 16종 + 화장품 견본 1종 · 옵션 35개 · 모두 직판). 개발 · 시연용 · 이미 있는 코드는 건너뜀(운영 DB 에는 돌리지 않음)
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f scripts/seed-hlt-samples.sql >/dev/null 2>&1 \
  && echo "  소개몰 견본  판매 중 $($Q "SELECT count(*) FROM hlt_products WHERE code ~ '^p[0-9]{2}$' AND status = 'ON_SALE'")종" || echo "  !! 소개몰 견본 시드 실패 — 계속합니다"

step "9. 권한 시험 계정 (역할 7종 · @t.local · 비밀번호 sgb-test-1234)"
# ★ 20260930 — 스크립트는 있었는데 준비 절차에서 부르지 않아, BIZ_STAFF · REVIEWER ·
#   PAYOUT 화면을 로컬에서 볼 방법이 없었습니다.
# v10.34 — 리드 이용료가 선불(D070)이라 잔액 0 인 파트너는 상담 배정 후보에서 빠집니다. 새로 설치한 DB 는 잔액이 모두 0 이어서
#   「생활 · 금융 상담」 리드형 업종이 모두 「받을 업체 없음」이었습니다 — 개발 · 시연용 시험 결제(스텁) 충전을 넣습니다(잔액 0 인 곳만)
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f scripts/seed-lead-cash-dev.sql >/dev/null 2>&1 \
  && echo "  리드 이용료  시험 충전 $($Q "SELECT count(*) FROM lead_cash_wallets WHERE paid_balance + bonus_balance > 0")곳" || echo "  !! 리드 이용료 시험 충전 실패 — 계속합니다"
# v10.34 — 상담 시드는 실제 같은 시드(인증업체)가 있어야 업종을 받습니다. 5단계에서는 업체가 아직 없어 「0종」이라, 시드 뒤에 한 번 더 넣습니다(여러 번 돌려도 같음)
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f scripts/seed-consult-demo.sql >/dev/null 2>&1 \
  && echo "  상담 시드  받는 업종 $($Q "SELECT count(DISTINCT e.category_id) FROM v_consult_eligible_partner e")종(실제 같은 시드 뒤)" || echo "  !! 상담 시드 실패 — 계속합니다"
node scripts/seed-test-roles.js 2>&1 | tail -1 || true

# ★ 20260930 수정 — 전에는 이 조건이 6번 끝에 `&&` 로 걸려 있어
#   미동의가 0건이면 8번(시드)이 통째로 건너뛰어졌습니다.
if [ "${n:-0}" -gt 0 ]; then echo "  약관 미동의 ${n}건 — /terms/agree 에서 동의하면 줄어듭니다"; fi

if [ "${SKIP_DB_BOOT:-0}" = "1" ]; then
  cat <<'DOCKEREOF'

── 준비 끝났습니다 ─────────────────────────────────────────────

  API      http://localhost:3000        문서 /docs
  관리자    http://localhost:5173
  사용자    http://localhost:5174

  계정: admin@x.com · intro@x.com · buyer@x.com · person@x.com
  비밀번호: sgb-dev-1234

DOCKEREOF
  exit 0
fi

cat <<'EOF'

── 이제 띄우십시오 ─────────────────────────────────────────────

  npm run dev &              API      http://localhost:3000
  (cd web && npm run dev) &  관리자    http://localhost:5173
  (cd site && npm run dev)   사용자    http://localhost:5174
  npm run scheduler &        배치 (선택)

── 계정 (비밀번호 전부 sgb-dev-1234) ───────────────────────────

  admin@x.com    관리자 전체
  intro@x.com    파트너 · 소개자 (인증 완료)
  buyer@x.com    요청 등록
  person@x.com   개인회원

── 볼 만한 곳 ──────────────────────────────────────────────────

  http://localhost:3000/docs    API 문서
  http://localhost:5173         경영 지표 · 결정 대기 · 권한 관리
  http://localhost:5174/partner 파트너센터 (intro@x.com)
  http://localhost:5174/terms/agree  약관 동의

EOF
