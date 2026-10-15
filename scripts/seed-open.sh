#!/usr/bin/env bash
# 오픈 준비 데이터 입력.
#
# 법무 회신과 사업자 등록이 끝난 뒤 한 번 돌립니다.
# **실제 값이 없으면 실행되지 않습니다** — 자리표시자를 넣으면 DB 가 거부하고,
# 통과하더라도 그대로 푸터에 나가면 통신판매업 고지 위반입니다.
#
# 사용:
#   DATABASE_URL=... \
#   BIZ_REG_NO=123-45-67890 \
#   MAIL_ORDER_NO=제2027-서울강남-01234호 \
#   ADDRESS="서울특별시 강남구 테헤란로 1, 2층" \
#   PHONE=02-1234-5678 \
#   HOSTING="Amazon Web Services" \
#   CEO_NAME=홍길동 \
#   PRIVACY_OFFICER=김보안 \
#   bash scripts/seed-open.sh
set -uo pipefail
: "${DATABASE_URL:?DATABASE_URL 필요}"
# 10/3 (v10.16) — psql 에 넘길 주소. 앱(Node)만 아는 SSL 표기(sslmode=no-verify · uselibpqcompat)를 psql 이 아는 표기로 바꿉니다.
#   RDS 접속 주소를 앱에 맞춰 적으면 psql 이 「invalid sslmode value」로 거절해 이 스크립트가 전부 실패로 나왔습니다.
PGURL=$(printf '%s' "${DATABASE_URL:-}" | sed -E 's/([?&])uselibpqcompat=[^&]*(&|$)/\1/; s/sslmode=no-verify/sslmode=require/; s/[?&]$//')
PSQL="psql $PGURL -q -v ON_ERROR_STOP=1"

# 값이 없으면 여기서 멈춥니다. 기본값을 두지 않는 것이 의도입니다
missing=()
for v in BIZ_REG_NO MAIL_ORDER_NO ADDRESS PHONE HOSTING CEO_NAME PRIVACY_OFFICER; do
  [ -z "${!v:-}" ] && missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "!! 다음 값이 필요합니다: ${missing[*]}"
  echo
  echo "   자리표시자를 넣지 마십시오. DB 가 거부하고, 통과하더라도"
  echo "   그대로 푸터에 나가면 통신판매업 고지 위반입니다."
  echo
  echo "   형식:"
  $PSQL -t -A -c "
    SELECT '     ' || key || '  →  ' || coalesce(value_example, '자유 입력')
      FROM site_settings WHERE is_required_for_open AND key LIKE 'footer.%' ORDER BY key;" 2>/dev/null
  exit 1
fi

echo "── 푸터 법정 고지 ──"
apply() {
  if $PSQL -c "UPDATE site_settings SET value = \$\$$2\$\$, updated_at = now() WHERE key = '$1';" 2>/tmp/_e; then
    printf "  ok   %-24s %s\n" "$1" "$2"
  else
    printf "  FAIL %-24s %s\n" "$1" "$(grep -oE 'SETTING_[A-Z_]+:.*' /tmp/_e | head -1)"
    FAILED=1
  fi
}
FAILED=0
apply footer.biz_reg_no      "$BIZ_REG_NO"
apply footer.mail_order_no   "$MAIL_ORDER_NO"
apply footer.address         "$ADDRESS"
apply footer.phone           "$PHONE"
apply footer.hosting         "$HOSTING"
apply footer.ceo_name        "$CEO_NAME"
apply footer.privacy_officer "$PRIVACY_OFFICER"

echo
echo "── 오픈 차단 확인 ──"
n=$($PSQL -t -A -c "SELECT count(*) FROM v_open_blockers;")
if [ "$n" = "0" ]; then
  echo "  오픈 차단 0건 — deploy-check 통과 가능"
else
  echo "  남은 항목 $n건:"
  $PSQL -t -A -c "SELECT '    ' || kind || '  ' || item || '  —  ' || reason FROM v_open_blockers;"
fi

echo
echo "※ 약관은 API 로 발행하십시오 — 내용과 시행일이 필요합니다."
echo "   PUT   /admin/terms/{code}          초안 저장"
echo "   PATCH /admin/terms/{code}/publish  발행"
echo "※ 외부 연동은 관리자 화면에서 관리합니다 (외부 연동 탭)."
echo "   발신 IP 를 먼저 등록하십시오 — 심사에 2~4주 걸립니다."
exit $FAILED
