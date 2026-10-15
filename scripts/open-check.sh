#!/usr/bin/env bash
# =====================================================================
# open-check.sh  ·  오픈 전 최종 점검
#
# ── 왜 따로 있나 ─────────────────────────────────────────────────────
# `deploy-check.sh` 는 **배포할 수 있는가**를 봅니다.
# 이것은 **열어도 되는가**를 봅니다 — 다릅니다.
#
# 배포는 코드가 도는지의 문제지만, 오픈은 **간주 모드가 켜져 있는지 ·
# 약관이 발행됐는지 · 연동이 붙었는지**의 문제입니다. 코드가 완벽해도
# 결제가 안 되는데 열면 회복이 안 됩니다.
#
# 모두 0이어야 열 수 있습니다.
# =====================================================================
set -uo pipefail
: "${DATABASE_URL:?DATABASE_URL 을 설정하십시오}"
# 10/3 (v10.16) — psql 에 넘길 주소. 앱(Node)만 아는 SSL 표기(sslmode=no-verify · uselibpqcompat)를 psql 이 아는 표기로 바꿉니다.
#   RDS 접속 주소를 앱에 맞춰 적으면 psql 이 「invalid sslmode value」로 거절해 이 스크립트가 전부 실패로 나왔습니다.
PGURL=$(printf '%s' "${DATABASE_URL:-}" | sed -E 's/([?&])uselibpqcompat=[^&]*(&|$)/\1/; s/sslmode=no-verify/sslmode=require/; s/[?&]$//')
DB="$PGURL"
Q() { psql "$DB" -t -A -c "$1" 2>/dev/null | tr -d '[:space:]'; }

fail=0; warn=0
chk() { # 이름 · SQL · 기대값
  local got; got=$(Q "$2")
  if [ "$got" = "$3" ]; then printf "  ok   %-36s %s\n" "$1" "$got"
  else printf "  ✗    %-36s %s (기대 %s)\n" "$1" "${got:-?}" "$3"; fail=$((fail+1)); fi
}
note() { # 이름 · SQL — 경고만
  local got; got=$(Q "$2")
  if [ "$got" = "0" ]; then printf "  ok   %-36s 0\n" "$1"
  else printf "  ▲    %-36s %s\n" "$1" "${got:-?}"; warn=$((warn+1)); fi
}

echo "== 오픈 차단 =========================================="
chk "오픈 차단 항목"          "SELECT count(*) FROM v_open_blockers;" "0"
chk "간주 모드 (결제·중개사·계좌·전자세금계산서)"  "SELECT count(*) FROM v_assumed_on;" "0"

echo
echo "== 법적 방어 =========================================="
chk "제한업종 미연결"          "SELECT count(*) FROM v_restricted_unlinked;" "0"
chk "건강몰 판매불가 노출"      "SELECT count(*) FROM v_hlt_sale_violation;" "0"
chk "심의번호 없는 의료기기"    "SELECT count(*) FROM v_gated_no_review;" "0"
chk "보험·의료 소개비·소개자"    "SELECT count(*) FROM v_no_intro_leak;" "0"
chk "자격 없는 보험·의료 게시"   "SELECT count(*) FROM v_gated_unqualified_public;" "0"
chk "중개사 인증 누락 매물"      "SELECT count(*) FROM v_broker_gate_leak;" "0"
chk "직업소개 업종 승인"        "SELECT count(*) FROM categories
                                 WHERE labor_law_flag='APPLICABLE' AND status='APPROVED';" "0"

echo
echo "== 약관 =============================================="
chk "발행된 약관 6종 이상"      "SELECT (count(*) >= 6)::int FROM terms WHERE status='PUBLISHED';" "1"
# 좌표 컬럼이 생기면 위치기반서비스 신고가 필요할 수 있습니다.
chk "좌표 컬럼 없음"           "SELECT count(*) FROM v_location_columns;" "0"
chk "시행일이 정해짐"          "SELECT count(*) FROM terms
                                 WHERE status='PUBLISHED' AND effective_from IS NULL;" "0"

echo
echo "== 발송 준비 =========================================="
# 메일이 안 가면 **청구 안내도 안 갑니다.** 오픈 차단은 아니지만
# 열기 전에 확인하십시오 — 스팸으로 빠지면 미납으로 보입니다.
note "발신 주소 비어 있음"      "SELECT (coalesce(btrim(value),'')='')::int
                                 FROM site_settings WHERE key='notify.mail_from';"
note "메일 인증 미완 (SPF·DKIM)" "SELECT (value <> 'on')::int
                                 FROM site_settings WHERE key='notify.email_verified';"

echo
echo "== 정산 · 과금 ========================================"
# 계좌가 비면 **무통장 입금을 받을 수 없습니다** — 사업자는
# 세금계산서 때문에 계좌이체를 선호합니다.
chk "수금 계좌 채워짐"          "SELECT missing FROM v_company_account;" "0"
# ★ 값이 채워졌다고 끝이 아닙니다 — **가상 계좌로 열면 입금이
#   아무 데도 들어오지 않습니다.** 실계좌를 넣으면 간주가 자동으로
#   내려갑니다.
chk "가상 계좌로 돌고 있지 않음"  "SELECT count(*) FROM v_bank_assumed;" "0"
# ★ 스텁으로 통과한 정산 계좌는 **실제로 확인되지 않은 계좌**입니다.
#   그리로 돈이 나가면 돌려받기 어렵습니다.
chk "스텁 인증 계좌 없음"      "SELECT count(*) FROM v_payout_stub;" "0"
# ★ 입점 판매자가 있으면 **하위가맹점 ID 가 있어야** 지급됩니다.
#   PG 계약 전에는 집계만 되고 돈이 안 나갑니다.
chk "지급 막힌 판매자 없음"    "SELECT count(*) FROM v_hlt_settle_blocked;" "0"
chk "자격 만료 판매 없음"      "SELECT count(*) FROM v_hlt_license_expired;" "0"
# ★ 스텁 서명은 **법적 효력이 없습니다** — 실제로 서명되지 않았습니다.
chk "스텁 서명 계약 없음"      "SELECT count(*) FROM v_contract_stub;" "0"
# ★ 알림톡 · SMS 계약 전에 **마케팅 약관부터** 발행해야 합니다.
#   동의 없이 보내면 정보통신망법 위반입니다(3천만원 이하).
# 10/3 (v10.16) — 전에는 작은따옴표 앞에 \ 가 붙어 SQL 이 문법 오류였습니다. 그래서 이 줄은 **늘 「?」로 차단**이었고,
#   약관을 전부 발행해도 「열 수 없습니다」가 풀리지 않았습니다(운영 방식 리허설에서 확인).
chk "미발행 약관 없음"        "SELECT count(*) FROM terms WHERE status='DRAFT';" "0"
chk "야간 발송 위반 없음"      "SELECT count(*) FROM v_marketing_night_violation;" "0"
chk "자유 양식 계약 없음"      "SELECT count(*) FROM v_contract_no_template;" "0"
chk "환불 규칙 위반"            "SELECT count(*) FROM v_refund_violation;" "0"
chk "슬롯 없이 켜진 광고"        "SELECT count(*) FROM v_ad_no_slot;" "0"

echo
echo "== AI · 검색 =========================================="
chk "분류 업종 미연결"          "SELECT count(*) FROM v_classify_unlinked;" "0"
chk "한글 검색이 돎"            "SELECT (like_hits = fn_hits)::int FROM v_search_sanity;" "1"

echo
echo "== 감사 =============================================="
chk "이상 판정 기준"            "SELECT (count(*) >= 5)::int FROM audit_thresholds WHERE is_active;" "1"
note "이상 징후"                "SELECT count(*) FROM v_audit_anomalies;"
note "이유 없는 개인정보 열람"   "SELECT count(*) FROM v_audit_no_reason;"

echo
echo "== 운영 =============================================="
note "닫아야 할 이벤트"          "SELECT count(*) FROM v_events_to_close;"
note "결정 대기 (HIGH)"          "SELECT count(*) FROM v_pending_decisions WHERE risk='HIGH';"

echo
echo "======================================================"
if [ "$fail" -gt 0 ]; then
  echo "  ✗ 열 수 없습니다 — 차단 ${fail}건"
  echo "    위 항목을 먼저 해소하십시오."
  exit 1
fi
[ "$warn" -gt 0 ] && echo "  ▲ 경고 ${warn}건 — 열 수는 있으나 확인하십시오"
echo "  ok 오픈 가능"
