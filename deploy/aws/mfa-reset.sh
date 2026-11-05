#!/usr/bin/env bash
# =====================================================================
# v10.180 (D169 · docs/281) — 운영자 2단계 인증 비상 초기화 (ubuntu · 사람이 · 운영 화면에 아무도 못 들어갈 때만)
#
#   bash ~/sgb/deploy/aws/mfa-reset.sh                  # 등록한 운영자 목록(읽기만) · 지금 설정
#   bash ~/sgb/deploy/aws/mfa-reset.sh <이메일>          # 그 계정의 2단계 등록을 지움(확인 질문 뒤) — 다음 로그인 때 다시 등록
#   bash ~/sgb/deploy/aws/mfa-reset.sh off              # 설정 admin.mfa_required 를 off 로(확인 질문 뒤) — 모두 2단계 없이 들어옴
#
#   평소에는 운영 화면 회원 상세 「2단계 초기화」(SUPER)를 쓰십시오. 이 스크립트는 SUPER 도 들어오지 못할 때만.
#   한 일은 audit.audit_logs 에 MFA_RESET_SERVER · MFA_OFF_SERVER 로 남습니다. 설정 off 는 1분 안에 API 에 반영(30초 기억).
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
load_env "$HERE/../../.env" || { echo "!! .env 가 없습니다" >&2; exit 1; }

echo "== 지금 설정: admin.mfa_required = $(q "SELECT value FROM site_settings WHERE key = 'admin.mfa_required'")"
if [ $# -eq 0 ]; then
  echo "== 2단계 인증을 등록한 계정"
  qn "SELECT a.email || ' · ' || CASE WHEN m.enabled_at IS NULL THEN '등록 중' ELSE '등록 ' || to_char(m.enabled_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') END
             || ' · 예비 번호 ' || cardinality(m.backup_hashes)
        FROM account_mfa m JOIN accounts a ON a.id = m.account_id ORDER BY a.email"
  exit 0
fi

if [ "$1" = "off" ]; then
  read -r -p "운영자 2단계 인증을 끕니다(off). 계속하려면 yes: " a; [ "$a" = "yes" ] || { echo "그만둠"; exit 1; }
  # v10.196 — updated_by 를 비워야 중요 설정 바뀜 알림(D174)이 「via DB」로 남음(그대로 두면 전에 운영 화면에서 바꾼 사람 · APP 으로 보임)
  db -v ON_ERROR_STOP=1 -q -c "BEGIN;
    SET LOCAL app.setting_reason = 'mfa-reset.sh off (서버에서 비상 끄기)';
    UPDATE site_settings SET value = 'off', updated_by = NULL, updated_at = now() WHERE key = 'admin.mfa_required';
    INSERT INTO audit.audit_logs (action, target_type, after_data) VALUES ('MFA_OFF_SERVER', 'SETTING', '{\"by\": \"mfa-reset.sh\"}');
    COMMIT;" && echo "== 껐습니다 — 1분 안에 반영. 다시 켜기는 운영 화면 설정에서(SUPER · 먼저 등록)"
  exit $?
fi

EMAIL="$1"
printf '%s' "$EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+$' || { echo "!! 이메일 형식이 아닙니다: $EMAIL"; exit 1; }
ID="$(q "SELECT a.id FROM accounts a JOIN account_mfa m ON m.account_id = a.id WHERE a.email = '$(printf '%s' "$EMAIL" | sed "s/'/''/g")'")"
[ -n "$ID" ] || { echo "!! 2단계 인증을 등록한 계정이 아닙니다: $EMAIL"; exit 1; }
read -r -p "$EMAIL 의 2단계 등록을 지웁니다. 계속하려면 yes: " a; [ "$a" = "yes" ] || { echo "그만둠"; exit 1; }
db -v ON_ERROR_STOP=1 -q -c "BEGIN;
  DELETE FROM account_mfa WHERE account_id = '$ID';
  INSERT INTO audit.audit_logs (action, target_type, target_id, after_data) VALUES ('MFA_RESET_SERVER', 'ACCOUNT', '$ID', '{\"by\": \"mfa-reset.sh\"}');
  COMMIT;" && echo "== 지웠습니다 — $EMAIL 은 다음 로그인 때 운영 화면에서 다시 등록합니다"
