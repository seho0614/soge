#!/usr/bin/env bash
# 약관 발행.
#
# ⚠ **법무 검토를 마친 뒤에만 실행하십시오.**
#   발행하면 이용자와의 계약 조건이 되고, 되돌려도 이미 동의한 이력은 남습니다.
#
# 사용: DATABASE_URL=... EFFECTIVE_FROM=2026-11-01 bash scripts/publish-terms.sh [코드...]
#       코드를 생략하면 10종입니다(위치기반 빼고 · v10.31 파트너 이용약관 PARTNER 포함).
#       이미 발행한 DB 에 새로 생긴 약관만 발행하려면 코드를 적습니다 — 예: v10.31 판 올린 뒤 `... publish-terms.sh PARTNER`
set -uo pipefail
cd "$(dirname "$0")/.."
# v10.160 (docs/244) — 운영 서버에서는 쓰지 않습니다. 게시는 운영 화면 › 관 관리 › 법정 고지 › 「약관」(같은 규칙 · 감사 기록 TERM_PUBLISH).
#   이 스크립트는 게시 전에 1.0 초안 본문을 킷의 docs/terms 로 덮어써서, 법무가 「고치기」로 고친 1.0 초안을 지웁니다(감사 기록도 없음).
#   개발 · 점검판 · 리허설(NODE_ENV 가 production 이 아님)에서만 돕니다. 정말 필요하면 SGB_TERMS_SCRIPT_OK=yes (대표 승인 뒤).
if { [ "${NODE_ENV:-}" = "production" ] || { [ -f .env ] && grep -qE '^[[:space:]]*NODE_ENV[[:space:]]*=[[:space:]]*"?production' .env; }; } && [ "${SGB_TERMS_SCRIPT_OK:-}" != "yes" ]; then
  echo "!! 운영 서버(NODE_ENV=production)에서는 이 스크립트로 게시하지 않습니다."
  echo "   운영 화면 › 관 관리 › 법정 고지 › 맨 아래 「약관」 에서 시행일을 넣고 「게시」 하십시오(SUPER)."
  echo "   이 스크립트는 1.0 초안 본문을 킷 원문으로 덮어써 「고치기」로 고친 글을 지웁니다."
  exit 1
fi
: "${DATABASE_URL:?DATABASE_URL 필요}"
# 10/3 (v10.16) — psql 에 넘길 주소. 앱(Node)만 아는 SSL 표기(sslmode=no-verify · uselibpqcompat)를 psql 이 아는 표기로 바꿉니다.
#   RDS 접속 주소를 앱에 맞춰 적으면 psql 이 「invalid sslmode value」로 거절해 이 스크립트가 전부 실패로 나왔습니다.
PGURL=$(printf '%s' "${DATABASE_URL:-}" | sed -E 's/([?&])uselibpqcompat=[^&]*(&|$)/\1/; s/sslmode=no-verify/sslmode=require/; s/[?&]$//')
PSQL="psql $PGURL -q -v ON_ERROR_STOP=1"
EFF="${EFFECTIVE_FROM:-}"

if [ -z "$EFF" ]; then
  echo "!! EFFECTIVE_FROM 이 필요합니다 (예: 2026-11-01)"
  echo "   시행일은 동의 이력의 기준이 되는 날짜라 과거로 지정할 수 없습니다."
  exit 1
fi

# v10.28 — 기본 대상 9종(지시서 6-3절 「/terms/* 9종」). 위치기반(LOCATION)은 빈칸 4곳이 남아 있고 폐기 상태라 뺍니다.
#   전에는 「SERVICE PRIVACY LOCATION MARKETING THIRDPARTY REFUND」 — 위치기반 빈칸 때문에 그대로는 늘 멈췄고, 판매 · 위탁 · 맞춤형 · 야간 광고가 빠져 있었습니다.
# v10.31 (D090 · 10/10 사용자 답 「파트너 약관 발행 — 전부 가능」) — 파트너 이용약관(PARTNER)을 더함. 대상은 입점한 파트너만(terms.audience) —
#   발행하면 파트너(대표 · 합류 직원)에게만 재동의가 걸리고 일반 회원 가입 · 재동의 목록에는 나오지 않습니다.
CODES="${*:-SERVICE PRIVACY REFUND THIRDPARTY HLT_SALE OUTSOURCE MARKETING MARKETING_NIGHT ADPERSONAL PARTNER}"

echo "── 미확정 항목 확인 ──"
holes=0
# 발행 전에 본문을 최신 생성물로 맞춥니다.
# 기준선은 뼈대만 담으므로, 재구축 직후에는 본문이 자리표시자입니다.
# 그 상태로 발행하면 이용자에게 "(본문은 npm run docs 가 생성합니다)"가 보입니다.
for C in $CODES; do
  F="docs/terms/$C.md"
  if [ -f "$F" ]; then
    $PSQL -c "UPDATE terms SET body = \$\$$(cat "$F")\$\$
               WHERE code='$C' AND version='1.0' AND status IN ('DRAFT','LEGAL_REVIEW');" >/dev/null 2>&1   # 10/2 — 보관(ARCHIVED)된 판은 덮지 않습니다
  fi
done

for C in $CODES; do
  # 〔시행일〕 은 발행이 직접 채우므로 미확정으로 세지 않습니다.
  n=$($PSQL -t -A -c "SELECT count(*) FROM terms t, regexp_matches(t.body, '〔[^〕]*〕', 'g') m WHERE t.code='$C' AND t.version='1.0' AND m[1] <> '〔시행일〕';")
  if [ "${n:-0}" -gt 0 ]; then
    echo "  !! $C — 미확정 표시 ${n}곳"
    holes=$((holes+1))
  fi
done
if [ $holes -gt 0 ]; then
  echo
  echo "  〔 〕로 표시된 부분이 남아 있습니다. 법무 확인 후 채우십시오."
  echo "  그대로 발행하면 이용자에게 그 표시가 그대로 보입니다."
  exit 1
fi

echo "── 발행 ──"
fail=0
for C in $CODES; do
  # 본문의 〔시행일〕도 함께 채웁니다.
  # 컬럼만 바꾸면 이용자가 보는 부칙에는 표시가 그대로 남습니다 —
  # 실제로 발행 검사가 그것을 잡아 여기서 막혔습니다.
  if $PSQL -c "UPDATE terms SET body = replace(body, '〔시행일〕', '$EFF'),
                                 status='PUBLISHED', effective_from='$EFF', blocked_by=NULL
                WHERE code='$C' AND version='1.0';" 2>/tmp/_e; then
    printf "  ok   %-12s 시행 %s\n" "$C" "$EFF"
  else
    printf "  FAIL %-12s %s\n" "$C" "$(grep -oE '(TERM|EFFECTIVE)_[A-Z_]+:.*' /tmp/_e | head -1)"
    fail=1
  fi
done

echo
n=$($PSQL -t -A -c "SELECT count(*) FROM v_open_blockers;")
echo "오픈 차단 $n건"
[ "$n" != "0" ] && $PSQL -t -A -c "SELECT '  ' || kind || '  ' || item FROM v_open_blockers;"
exit $fail
