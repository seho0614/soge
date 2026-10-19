#!/usr/bin/env bash
# =====================================================================
# 소개뱅크 공격 · 보안 검정 (PostgreSQL)
#
# verify-invariants.sh 는 정상 경로와 단건 차단을 봅니다.
# 그래서 INV-4 INSERT 우회를 놓쳤습니다 — UPDATE 로 확정하는
# 경로만 시험했기 때문입니다.
#
# 이 시험은 다른 축입니다.
#   공격  규칙을 피해 가는 길이 열려 있는가
#   보안  권한 · 감사 흔적 · 계정 상태 · 컬럼 노출 · 규칙 위생
#
# 여기서 "뚫림" 이 나오면 그것이 실제 결함입니다.
# =====================================================================
set -uo pipefail
PSQL="psql ${DATABASE_URL:?DATABASE_URL 필요} -q -v ON_ERROR_STOP=1"
Q="psql $DATABASE_URL -t -A"
safe=0; broken=0; hole=0; skip=0

# 반드시 막혀야 하는데 안 막히면 결함
# 반드시 막혀야 하는 시험.
#
# 주의: DELETE/UPDATE 가 0행을 대상으로 하면 트리거가 아예 돌지 않고
#       문장은 성공합니다. 그러면 "뚫렸다"고 잘못 보고합니다.
#       그래서 선행 조건($3)을 두어, 대상 행이 없으면 시험을 건너뜁니다.
blocked() { # $1=라벨 $2=SQL [$3=선행조건SQL(1이상이어야 함)]
  if [ -n "${3:-}" ]; then
    local n; n=$($Q -c "$3" 2>/dev/null | tr -d '[:space:]')
    if [ "${n:-0}" = "0" ] || [ -z "${n:-}" ]; then
      printf "  건너뜀 %-44s 대상 행 없음 — 시험 성립 안 함\n" "$1"; skip=$((skip+1)); return
    fi
  fi
  local err
  err=$($PSQL -c "$2" 2>&1)
  if [ $? -eq 0 ]; then
    printf "  ▲뚫림 %s\n" "$1"; hole=$((hole+1))
    return
  fi

  # ★ 실패했다고 다 "차단"이 아닙니다.
  #
  #   없는 함수·표·컬럼 때문에 실패하면 **방어가 없어도 안전으로 보입니다.**
  #   오류 메시지가 "함수 없음"인데 차단된 것처럼 읽히는 것이 위험합니다.
  #   왜 실패했는지까지 봐야 합니다.
  case "$err" in
    *"does not exist"*|*"undefined_function"*|*"undefined_table"*|*"undefined_column"*|\
    *"42883"*|*"42P01"*|*"42703"*|*"syntax error"*)
      printf "  ★오류 %-42s 방어가 아니라 시험이 깨졌습니다\n" "$1"
      printf "         %s\n" "$(printf '%s' "$err" | head -1 | cut -c1-90)"
      broken=$((broken+1))
      ;;
    *)
      printf "  안전  %s\n" "$1"; safe=$((safe+1))
      ;;
  esac
}

# 값이 기대와 같아야 정상
err_is() { # $1=라벨 $2=SQL $3=기대 오류 접두 — 막혔는지와 **누가 막았는지**까지 봅니다 (D005)
  local err
  err=$($PSQL -c "BEGIN; $2; ROLLBACK;" 2>&1)
  if [ $? -eq 0 ]; then
    printf "  ▲뚫림 %s — 막히지 않음\n" "$1"; hole=$((hole+1)); return
  fi
  case "$err" in
    *"$3"*) printf "  안전  %s\n" "$1"; safe=$((safe+1)) ;;
    *) printf "  ▲뚫림 %s — 다른 이유로 막힘: %s\n" "$1" "$(printf '%s' "$err" | head -1 | cut -c1-90)"
       hole=$((hole+1)) ;;
  esac
}

eq() { # $1=라벨 $2=SQL $3=기대
  local got; got=$($Q -c "$2" 2>&1 | tr -d '[:space:]')
  if [ "$got" = "$3" ]; then printf "  안전  %s\n" "$1"; safe=$((safe+1))
  else printf "  ▲뚫림 %-44s 기대 %s / 실제 %s\n" "$1" "$3" "$got"; hole=$((hole+1)); fi
}

# 여러 문장(BEGIN … SELECT … ROLLBACK)을 돌리고 **마지막 SELECT 의 값**만 봅니다 — 준비 문장의 실행 표시(UPDATE 1 …)는 숨깁니다(-q).
eqq() { # $1=라벨 $2=SQL $3=기대
  local got; got=$($PSQL -t -A -c "$2" 2>&1 | tr -d '[:space:]')
  if [ "$got" = "$3" ]; then printf "  안전  %s\n" "$1"; safe=$((safe+1))
  else printf "  ▲뚫림 %-44s 기대 %s / 실제 %s\n" "$1" "$3" "$(printf '%s' "$got" | cut -c1-120)"; hole=$((hole+1)); fi
}

echo "== 픽스처 =="
# ★ 20261002 — 이 검정은 fixture.sql 로 표를 **비우고 다시 채웁니다.**
#   개발 DB(sgb)에 돌리면 쌓아 둔 계정·거래·매물이 사라집니다(실제로 한 번 지워졌습니다).
#   검정 전용 DB(이름이 _check · _ci · _test 로 끝남)에서만 돕니다. 꼭 필요하면 SGB_FIXTURE_OK=1.
_db=$(psql "$DATABASE_URL" -tAc "select current_database()" 2>/dev/null)
if [[ ! "$_db" =~ _(check|ci|test)$ ]] && [ "${SGB_FIXTURE_OK:-}" != "1" ]; then
  echo "!! '$_db' 는 검정 전용 DB 가 아닙니다 — fixture 가 데이터를 지웁니다. sgb_check 에서 돌리십시오 (강제: SGB_FIXTURE_OK=1)"; exit 2
fi

$PSQL -f "$(dirname "$0")/fixture.sql" >/dev/null || { echo "픽스처 실패"; exit 1; }

B=11111111-1111-1111-1111-111111111111
BUY=22222222-2222-2222-2222-222222222222
SEL=33333333-3333-3333-3333-333333333333
IND=44444444-4444-4444-4444-444444444444
D=cccccccc-0000-4000-a000-000000000001
L=ffffffff-0000-4000-a000-000000000001

echo
echo "== A. 거래 확정 우회 (INV-3 · INV-4) =================="
blocked "A-01 INSERT 직행 CONFIRMED" \
  "INSERT INTO deals(listing_id,buyer_account_id,seller_account_id,status,confirmed_at)
   VALUES ('$L','$BUY','$SEL','CONFIRMED',now());"
blocked "A-02 confirmed_at 없는 CONFIRMED" \
  "INSERT INTO deals(listing_id,buyer_account_id,seller_account_id,status)
   VALUES ('$L','$BUY','$SEL','CONFIRMED');"
blocked "A-03 자전거래(buyer=seller)" \
  "INSERT INTO deals(listing_id,buyer_account_id,seller_account_id,status)
   VALUES ('$L','$BUY','$BUY','INQUIRY');"
blocked "A-04 확인 1건으로 UPDATE 확정" \
  "INSERT INTO deal_confirmations(deal_id,party,confirmed_by) VALUES ('$D','BUYER','$BUY');
   UPDATE deals SET status='CONFIRMED', confirmed_at=now() WHERE id='$D';"

echo
echo "== B. 귀속 조작 (INV-1 · INV-2) ======================="
blocked "B-01 귀속 이벤트 DELETE" "DELETE FROM attribution_events;"
blocked "B-02 귀속 이벤트 UPDATE" "UPDATE attribution_events SET account_id='$BUY';"
blocked "B-03 tier=2 다단계 소개"  \
  "INSERT INTO deals(listing_id,buyer_account_id,seller_account_id,tier)
   VALUES ('$L','$BUY','$SEL',2);"

echo
echo "== C. 소개비 · 정산 조작 (INV-9R · D-1) ==============="
# 시험 대상을 직접 만듭니다.
# 픽스처에 없는 상태를 공격하려 하면 0행이라 트리거가 안 돌고,
# 그러면 "뚫렸다"가 아니라 "시험이 성립하지 않았다"가 됩니다.
# agreed_fee 는 잠긴 약정액과 같아야 합니다(D-1). 임의 값을 넣으면 트리거가 막습니다.
# 정산은 확정된 거래에만 생깁니다(INV-3). 규칙을 지키는 경로로 만듭니다.
$PSQL -c "INSERT INTO deal_confirmations(deal_id,party,confirmed_by)
          VALUES ('$D','BUYER','$BUY'),('$D','SELLER','$SEL')
          ON CONFLICT (deal_id,party) DO NOTHING;" >/dev/null 2>&1
$PSQL -c "UPDATE deals SET status='CONFIRMED', confirmed_at=now()
           WHERE id='$D' AND status <> 'CONFIRMED';" >/dev/null 2>&1
# INV-10: 수령자는 인증된 사업자여야 합니다.
# v10.27 (G-120) — 받는 사람은 **그 거래의 소개자($B)** 여야 합니다(D034). 전에는 소개자가 아닌 IND 를 받는 사람으로 넣어도
#   들어갔고, 이 검정도 IND 를 받는 사람으로 썼습니다(옛 설명 「픽스처의 소개자(IND)」는 틀림 — 픽스처의 소개자는 $B).
#   IND 의 사업자를 인증해 두고(INV-10 이 먼저 막지 않게) 소개자가 아닌 사업자로 넣어 봅니다 → 막혀야 합니다.
$PSQL -c "UPDATE businesses SET verified_at = now()
           WHERE account_id='$IND' AND verified_at IS NULL;" >/dev/null 2>&1
blocked "C-00 소개자가 아닌 인증 사업자가 받는 사람으로(G-120)" \
  "INSERT INTO settlements(deal_id,payee_account_id,payee_business_id,amount,status)
   SELECT '$D','$IND', b.id, d.agreed_fee, 'REQUESTED'
     FROM deals d JOIN businesses b ON b.account_id='$IND' AND b.verified_at IS NOT NULL
    WHERE d.id='$D';" \
  "SELECT count(*) FROM deals d JOIN businesses b ON b.account_id='$IND' AND b.verified_at IS NOT NULL WHERE d.id='$D' AND d.status='CONFIRMED' AND d.agreed_fee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM settlements WHERE deal_id='$D');"
# v10.28 (D040 · INV-10R) — 개인으로 받기(payee_business_id 없음)는 본인인증 + 확인된 받을 계좌가 있어야 합니다.
#   소개자 $B 에게 확인된 받을 계좌가 없을 때 개인으로 넣어 봅니다 → 막혀야 합니다.
blocked "C-00R 받을 계좌 확인 없이 개인으로 받는 사람(INV-10R)" \
  "INSERT INTO settlements(deal_id,payee_account_id,payee_business_id,amount,status)
   SELECT '$D','$B', NULL, d.agreed_fee, 'REQUESTED' FROM deals d WHERE d.id='$D';" \
  "SELECT count(*) FROM deals d WHERE d.id='$D' AND d.status='CONFIRMED' AND d.agreed_fee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM settlements WHERE deal_id='$D') AND NOT EXISTS (SELECT 1 FROM payout_accounts p WHERE p.account_id='$B' AND p.verified);"
# 시험 대상 정산 — 규칙을 지키는 경로(받는 사람 = 소개자 $B · 인증 사업자)
$PSQL -c "INSERT INTO settlements(deal_id,payee_account_id,payee_business_id,amount,status)
          SELECT '$D','$B', b.id, d.agreed_fee, 'REQUESTED'
            FROM deals d
            JOIN businesses b ON b.account_id='$B' AND b.verified_at IS NOT NULL
           WHERE d.id='$D'
          ON CONFLICT (deal_id) DO NOTHING;" >/dev/null 2>&1
blocked "C-01 정산 레코드 DELETE" "DELETE FROM settlements;" "SELECT count(*) FROM settlements;"
blocked "C-02 소개비 약정 DELETE" "DELETE FROM fee_agreements;" "SELECT count(*) FROM fee_agreements;"
blocked "C-03 소개비 약정 UPDATE" "UPDATE fee_agreements SET amount = amount - 1 WHERE amount IS NOT NULL;" "SELECT count(*) FROM fee_agreements;"

blocked "C-04 제3자가 지급완료 표시" \
  "UPDATE settlements SET status='PAID', paid_marked_by='$BUY' WHERE deal_id='$D';" \
  "SELECT count(*) FROM settlements WHERE deal_id='$D';"
# v10.31 (w6 · D080 · 10/10 시안) — 정산 승인 단계: REQUESTED → APPROVED(운영 · 거래 당사자 아님) → PAID(당사자 표시).
#   INV-11 의 보호(플랫폼은 돈을 받거나 보내지 않음 · 지급 표시는 당사자만)는 그대로이고, 승인 단계 자체를 우회하는 길을 봅니다.
ADM=$($Q -c "SELECT r.account_id FROM account_roles r WHERE r.role IN ('ADMIN','SUPER') AND r.account_id NOT IN ('$B','$BUY','$SEL','$IND') LIMIT 1" | tr -d '[:space:]')
err_is "C-04a 운영 승인 없이 지급 표시(STL_PAID)" \
  "UPDATE settlements SET status='PAID', paid_marked_by='$B' WHERE deal_id='$D';" "STL_PAID"
err_is "C-04b 거래 당사자가 자기 정산 승인(2인 원칙)" \
  "UPDATE settlements SET status='APPROVED', approved_by='$B' WHERE deal_id='$D';" "STL_APPROVE"
err_is "C-04c 운영 아닌 계정이 승인" \
  "UPDATE settlements SET status='APPROVED', approved_by='$IND' WHERE deal_id='$D';" "STL_APPROVE"
err_is "C-04e 처음부터 승인 · 지급 상태로 정산 INSERT" \
  "INSERT INTO settlements(deal_id,payee_account_id,payee_business_id,amount,status,approved_by)
   VALUES ('$D','$B',NULL,1000000,'APPROVED','$ADM');" "STL_APPROVE"
$PSQL -c "UPDATE settlements SET status='APPROVED', approved_by='$ADM' WHERE deal_id='$D';" >/dev/null 2>&1   # 운영 승인
eq "C-04f 승인 기록이 남음(settlement_approvals)" \
  "SELECT count(*) FROM settlement_approvals a JOIN settlements s ON s.id = a.settlement_id WHERE s.deal_id='$D' AND a.approved_by='$ADM';" "1"
blocked "C-04g 승인 기록 지우기" "DELETE FROM settlement_approvals;" "SELECT count(*) FROM settlement_approvals;"
err_is "C-04h 운영이 지급 표시(당사자만)" \
  "UPDATE settlements SET status='PAID', paid_marked_by='$ADM' WHERE deal_id='$D';" "PERM"
$PSQL -c "UPDATE settlements SET status='PAID', paid_marked_by='$B' WHERE deal_id='$D';" >/dev/null 2>&1   # v10.27 — 받는 사람(소개자 $B)이 받음 표시
blocked "C-05 표시자 사후 변경" \
  "UPDATE settlements SET paid_marked_by='$SEL' WHERE deal_id='$D';" \
  "SELECT count(*) FROM settlements WHERE deal_id='$D' AND paid_marked_by IS NOT NULL;"

echo
echo "== D. 컬럼 노출 (INV-9 · INV-11) ======================"
eq "D-01 공제·수수료 컬럼 전무"   "SELECT count(*) FROM v_inv9_violations;"  "0"
eq "D-02 자금수탁 컬럼 전무"      "SELECT count(*) FROM v_inv11_violations;" "0"
eq "D-03 사라진 테이블 미아 참조" "SELECT count(*) FROM v_dangling_refs;"    "0"
eq "D-04 평문 연락처 컬럼 부재"   \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('rrn','ssn','card_no','account_no');" "0"

echo
echo "== E. 감사 흔적 ======================================="
$PSQL -c "INSERT INTO audit.audit_logs(actor_role,action,target_type)
          VALUES ('ADMIN','ATTACKTEST','ACCOUNT');" >/dev/null 2>&1
blocked "E-01 감사 로그 UPDATE" "UPDATE audit.audit_logs SET action='X' WHERE action='ATTACKTEST';"
blocked "E-02 감사 로그 DELETE" "DELETE FROM audit.audit_logs WHERE action='ATTACKTEST';"
$PSQL -c "INSERT INTO audit.pii_access_logs(actor_account_id,target_type,target_account_id,access_type,reason)
          VALUES ('$SEL','ACCOUNT','$B','VIEW','공격시험');" >/dev/null 2>&1
blocked "E-03 개인정보 조회이력 DELETE" "DELETE FROM audit.pii_access_logs;" "SELECT count(*) FROM audit.pii_access_logs;"

echo
echo "== F. 계정 상태 ======================================="
$PSQL -c "INSERT INTO subscriptions(account_id,plan_code,status,started_at,
                                    current_period_start,current_period_end)
          VALUES ('$IND','BASIC','ACTIVE',now(),now(),now()+interval '90 days')
          ON CONFLICT DO NOTHING;" >/dev/null 2>&1
$PSQL -c "UPDATE accounts SET status='SUSPENDED' WHERE id='$IND';" >/dev/null 2>&1
blocked "F-01 정지 계정 소개코드 발급" \
  "INSERT INTO referral_codes(code,owner_account_id,subscription_id)
   SELECT 'SUSP1','$IND', id FROM subscriptions WHERE account_id='$IND' LIMIT 1;" \
  "SELECT count(*) FROM subscriptions WHERE account_id='$IND';"
$PSQL -c "UPDATE accounts SET status='ACTIVE' WHERE id='$IND';" >/dev/null 2>&1

echo
echo "== G. 규칙 데이터 위생 ================================"
eq "G-01 빈 금칙어 없음" \
  "SELECT count(*) FROM banned_words WHERE btrim(word)='';" "0"
# 와일드카드가 든 CONTAINS 규칙을 넣고, 무관한 문구가 걸리지 않는지 봅니다.
$PSQL -c "INSERT INTO banned_words(word,match_type,severity,is_active)
          VALUES ('100% 성공','CONTAINS','BLOCK',true) ON CONFLICT DO NOTHING;" >/dev/null 2>&1
eq "G-02 와일드카드 규칙이 무관 문구에 오적중하지 않음" \
  "SELECT count(*) FROM fn_check_banned_words('100원에 성공하세요','MONEY');" "0"
eq "G-03 정확히 포함될 때는 적중" \
  "SELECT (count(*) > 0)::int FROM fn_check_banned_words('100% 성공 보장','MONEY');" "1"
blocked "G-04 빈 금칙어 등록" \
  "INSERT INTO banned_words(word,match_type,severity,is_active) VALUES ('  ','CONTAINS','WARN',true);"

echo
echo "== J. 수익 모델 (월 회비 + 성사 수수료) ==============="
# 소개비가 꺼져 있는데 정산이 새로 생기면 스위치를 우회한 것입니다.
eq "J-01 소개비 OFF 상태에서 정산 미생성" \
  "SELECT count(*) FROM v_referral_fee_leak;" "0"
blocked "J-02 소개비 약정 신규 체결 차단" \
  "INSERT INTO fee_agreements(deal_id,proposed_by,amount,state)
   VALUES ('$D','$SEL',500000,'PROPOSED');"
# 성사 수수료는 플랫폼 매출입니다. 삭제되면 매출 근거가 사라집니다.
$PSQL -c "INSERT INTO subscriptions(account_id,plan_code,status,started_at,
                                    current_period_start,current_period_end)
          VALUES ('$SEL','STANDARD','ACTIVE',now(),now(),now()+interval '90 days')
          ON CONFLICT DO NOTHING;" >/dev/null 2>&1
$PSQL -c "INSERT INTO deal_confirmations(deal_id,party,confirmed_by)
          VALUES ('$D','BUYER','$BUY'),('$D','SELLER','$SEL')
          ON CONFLICT (deal_id,party) DO NOTHING;
          UPDATE deals SET status='CONFIRMED', confirmed_at=now()
           WHERE id='$D' AND status <> 'CONFIRMED';" >/dev/null 2>&1
# 수익은 회원등급별 월 정기 회비뿐입니다.
# 성사 수수료를 받지 않으므로, 거래를 확정해도 청구가 생기면 안 됩니다.
#
# 앞선 실행이 스위치를 켠 채 남긴 청구가 있으면 이 시험이 거짓으로 실패합니다.
# 시험은 자기가 볼 상태를 스스로 만들어야 합니다 —
# 이전 실행의 잔재에 기대면 단독 실행과 연속 실행의 결과가 달라집니다.
# success_fees 는 삭제되지 않습니다(설계대로입니다).
# 그래서 지우는 대신, 이 시험만 쓰는 새 거래를 만들어 봅니다.
$PSQL -c "UPDATE site_settings SET value='off' WHERE key='feature.success_fee';" >/dev/null 2>&1
# psql 은 RETURNING 결과 뒤에 "INSERT 0 1" 을 함께 뱉습니다.
# 그대로 쓰면 UUID 에 붙어 문법 오류가 납니다. 첫 줄만 씁니다.
DFEE=$($Q -q -c "INSERT INTO deals(listing_id,buyer_account_id,seller_account_id,status)
               VALUES ('$L','$BUY','$SEL','INQUIRY') RETURNING id;" 2>/dev/null | head -1 | tr -d '[:space:]')
$PSQL -c "INSERT INTO deal_confirmations(deal_id,party,confirmed_by)
          VALUES ('$DFEE','BUYER','$BUY'),('$DFEE','SELLER','$SEL');" >/dev/null 2>&1
$PSQL -c "UPDATE deals SET status='CONTRACTED' WHERE id='$DFEE';
          UPDATE deals SET status='CONFIRMED', confirmed_at=now() WHERE id='$DFEE';" >/dev/null 2>&1
eq "J-03 확정해도 성사 수수료 미청구" \
  "SELECT count(*) FROM success_fees WHERE deal_id='$DFEE';" "0"
eq "J-04 성사 수수료 스위치 off" \
  "SELECT value FROM site_settings WHERE key='feature.success_fee';" "off"

# 스위치를 켜면 청구되고, 그 기록은 삭제·변조되지 않아야 합니다.
# 규칙이 보존돼 있는지 확인하고 반드시 되돌립니다.
$PSQL -c "UPDATE site_settings SET value='on' WHERE key='feature.success_fee';" >/dev/null 2>&1
$PSQL -c "UPDATE deals SET status='CONTRACTED' WHERE id='$D';
          UPDATE deals SET status='CONFIRMED' WHERE id='$D';" >/dev/null 2>&1
blocked "J-05 수수료 청구 기록 삭제 차단" \
  "DELETE FROM success_fees WHERE deal_id='$D';" "SELECT count(*) FROM success_fees WHERE deal_id='$D';"
blocked "J-06 사유 없는 면제 차단" \
  "UPDATE success_fees SET status='WAIVED' WHERE deal_id='$D';" "SELECT count(*) FROM success_fees WHERE deal_id='$D';"
$PSQL -c "UPDATE site_settings SET value='off' WHERE key='feature.success_fee';" >/dev/null 2>&1

# 되돌렸는지 확인합니다. 켜둔 채 끝나면 다음 시험이 잘못된 전제로 돕니다.
eq "J-06b 시험 후 스위치 원복" \
  "SELECT value FROM site_settings WHERE key='feature.success_fee';" "off"
# 성사 수수료가 소개비에서 공제되는 형태로 섞이면 INV-9R 위반입니다.
eq "J-07 수수료와 소개비 혼입 없음" \
  "SELECT count(*) FROM v_fee_mixing_check;" "0"
# 꺼진 기능에 의존해 흐름을 막는 함수가 남아 있으면 안 됩니다.
# 계약서 발급이 소개비 합의를 요구해 통째로 막힌 적이 있습니다.
eq "J-08 소개비 OFF에 걸려 막히는 함수 없음" \
  "SELECT count(*) FROM v_referral_fee_hard_deps;" "0"
# 소개비가 꺼져 있으면 거래에 금액이 기록되면 안 됩니다.
blocked "J-09 OFF 상태 agreed_fee 기록 차단" \
  "UPDATE deals SET agreed_fee = 999 WHERE id='$D';" "SELECT count(*) FROM deals WHERE id='$D';"

echo
echo "== I. 문구 · 라벨 정합 ================================"
# 플랫폼이 지급한다고 말하는 문구가 되살아나면 잡습니다.
# 사실과 다른 안내는 그 자체가 분쟁 소지입니다.
eq "I-01 플랫폼 지급 주장 문구 없음" \
  "SELECT count(*) FROM v_notification_copy_conflicts;" "0"
eq "I-02 정산 상태 라벨 정합"        \
  "SELECT count(*) FROM v_settlement_label_gap;" "0"

echo
echo "== K. 광고 · 성향 (프론트 v3.2 서버 계층) ============="
# 문서 §6이 스스로 적어 둔 문장이 이 구간의 이유입니다:
#   "이 차단은 화면이 아니라 서버에서 다시 검사해야 합니다.
#    프런트 판정은 개발자 도구로 그대로 통과합니다."
CR108=$($Q -c "SELECT id FROM ad_placements WHERE creative_code='AD-108'" 2>/dev/null | tr -d '[:space:]')
CR107=$($Q -c "SELECT id FROM ad_placements WHERE creative_code='AD-107'" 2>/dev/null | tr -d '[:space:]')
CR101=$($Q -c "SELECT id FROM ad_placements WHERE creative_code='AD-101'" 2>/dev/null | tr -d '[:space:]')

blocked "K-01 대부 소재 세그먼트 지정 (INV-6)" \
  "INSERT INTO ad_creative_segments(creative_id,segment_code) VALUES ('$CR108','SEG-A');"
blocked "K-02 심의 전 의료 소재 슬롯 배정 (RSK-07)" \
  "UPDATE ad_placements SET slot_code='HERO' WHERE id='$CR107';" \
  "SELECT count(*) FROM ad_placements WHERE id='$CR107';"
blocked "K-03 심의 전 의료 소재 노출 (의료법 27조)" \
  "UPDATE ad_placements SET status='ACTIVE' WHERE id='$CR107';" \
  "SELECT count(*) FROM ad_placements WHERE id='$CR107';"
blocked "K-04 동의 없는 성향 저장 (개인정보)" \
  "INSERT INTO member_ad_profiles(account_id,segment_code,answers,scores,consented_at)
   SELECT id,'SEG-A','{}','{}',NULL FROM accounts LIMIT 1;"

$PSQL -c "INSERT INTO ad_events(creative_id,slot_code,event_type)
          VALUES ('$CR101','HERO','IMPRESSION');" >/dev/null 2>&1
blocked "K-05 광고 집계 조작 (과금 근거)" \
  "UPDATE ad_events SET event_type='CLICK';" "SELECT count(*) FROM ad_events;"
blocked "K-06 광고 집계 삭제" \
  "DELETE FROM ad_events;" "SELECT count(*) FROM ad_events;"

eq "K-07 광고주 통계에 개인 식별자 없음" \
  "SELECT count(*) FROM v_ad_privacy_leak;" "0"
eq "K-08 광고가 추천 순위에 끼지 않음 (표시광고법)" \
  "SELECT count(*) FROM ad_slots WHERE in_ranking;" "0"

echo
echo "== L. AI 계층 (분류 · 추천 · 위험감지) ================"
# 어휘집과 가중치가 데이터로 옮겨졌는지, 그리고 판정이 안전한지 봅니다.
eq "L-01 어휘에 와일드카드 없음" \
  "SELECT count(*) FROM v_classify_vocab_wildcards;" "0"
eq "L-02 추천 가중치 합 100" \
  "SELECT total FROM v_recommend_weight_sum;" "100"
eq "L-03 제한 어휘는 분류 전에 차단" \
  "SELECT count(*) > 0 FROM fn_classify_blocked('급전 일수 대출');" "t"
eq "L-04 어휘집 밖 입력은 후보 0 (억지 분류 없음)" \
  "SELECT count(*) FROM fn_classify('오늘 날씨가 좋습니다');" "0"
eq "L-05 태양광 문장은 EN 1위" \
  "SELECT category_code FROM fn_classify('태양광 발전소 EPC 업체') LIMIT 1;" "EN"

# 대상을 먼저 만듭니다. 빈 표에 DELETE 를 걸면 0행이라 트리거가 돌지 않고
# 문장이 성공해 "뚫림"으로 잘못 보고됩니다.
$PSQL -c "INSERT INTO risk_alerts(rule_code,severity,subject,detail)
          VALUES ('RSK-01','HIGH','시험','시험 경보');" >/dev/null 2>&1
blocked "L-06 위험 경보 삭제 차단" \
  "DELETE FROM risk_alerts;" "SELECT count(*) FROM risk_alerts;"
blocked "L-07 위험 경보 내용 변조 차단" \
  "UPDATE risk_alerts SET detail='조작됨';" "SELECT count(*) FROM risk_alerts;"
eq "L-08 오탐 상태가 별도로 존재" \
  "SELECT count(*) FROM pg_constraint WHERE conrelid='risk_alerts'::regclass
     AND pg_get_constraintdef(oid) LIKE '%FALSE_POSITIVE%';" "1"

echo
echo "== M. 정기결제 ========================================"
# 구독료가 매출의 전부입니다. 이 구간이 곧 매출 보호입니다.
# ORDER BY 없는 LIMIT 1 은 실행마다 다른 행을 줄 수 있습니다.
# 시험이 만든 구독과 검사하는 구독이 달라져 결과가 흔들립니다.
SUB=$($Q -c "SELECT id FROM subscriptions ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# 만료된 유료 구독을 하나 만들어 청구 대상이 되게 합니다.
$PSQL -c "UPDATE subscriptions SET plan_code='STANDARD', status='ACTIVE', cancel_at=NULL,
            current_period_start=now()-interval '400 days',
            current_period_end=now()-interval '370 days',
            is_promo=false, promo_ends_at=NULL
          WHERE id='$SUB';
          INSERT INTO billing_keys(account_id, billing_key, card_company, card_last4)
          SELECT account_id,'bk_atk','시험','9999' FROM subscriptions WHERE id='$SUB'
          ON CONFLICT DO NOTHING;" >/dev/null 2>&1

eq "M-01 만료 유료 구독이 청구 대상에 오름" \
  "SELECT count(*) FROM v_billing_due WHERE subscription_id='$SUB';" "1"

# 해지하면 빠져야 합니다. 이것이 이번 기능의 핵심 규칙입니다.
$PSQL -c "UPDATE subscriptions SET cancel_at=now() WHERE id='$SUB';" >/dev/null 2>&1
eq "M-02 해지 예약하면 청구 대상에서 빠짐" \
  "SELECT count(*) FROM v_billing_due WHERE subscription_id='$SUB';" "0"

blocked "M-03 해지 구독에 수기 청구 차단" \
  "INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status)
   VALUES ('$SUB', now(), now()+interval '30 days', 49000, 'PENDING');"

$PSQL -c "UPDATE subscriptions SET cancel_at=NULL WHERE id='$SUB';" >/dev/null 2>&1

# 이중 청구. 환불로 끝나지 않고 신뢰가 먼저 깨집니다.
# (D022) 결제 완료 청구서는 결제 근거(결제 키)가 있어야 만들 수 있습니다 — 준비 줄에도 넣습니다.
$PSQL -c "INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status,payment_key)
          VALUES ('$SUB','2030-01-01','2030-01-31',49000,'PAID','pk_atk_m04_$SUB');" >/dev/null 2>&1
eq "M-04a (전제) 결제 완료 청구서가 준비됨" \
  "SELECT count(*) FROM subscription_invoices WHERE subscription_id='$SUB' AND period_start='2030-01-01' AND status='PAID';" "1"
blocked "M-04 같은 기간 이중 청구 차단" \
  "INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status)
   VALUES ('$SUB','2030-01-01','2030-01-31',49000,'PENDING');"

blocked "M-05 청구 기록 삭제 차단 (매출 근거)" \
  "DELETE FROM subscription_invoices WHERE subscription_id='$SUB';" \
  "SELECT count(*) FROM subscription_invoices WHERE subscription_id='$SUB';"
blocked "M-06 결제 완료 청구액 변조 차단" \
  "UPDATE subscription_invoices SET amount=1 WHERE subscription_id='$SUB' AND status='PAID';" \
  "SELECT count(*) FROM subscription_invoices WHERE subscription_id='$SUB' AND status='PAID';"
blocked "M-07 음수 청구 차단" \
  "INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status)
   VALUES ('$SUB','2031-01-01','2031-01-31',-1,'PENDING');"

eq "M-08 결제수단은 계정당 하나" \
  "SELECT count(*) FROM pg_indexes WHERE indexname='uq_billing_key_active';" "1"
eq "M-09 빌링키가 뷰로 새지 않음" \
  "SELECT count(*) FROM v_billing_key_exposure;" "0"
eq "M-10 중복 청구 없음" \
  "SELECT count(*) FROM v_billing_duplicates;" "0"
eq "M-11 해지 후 청구 없음" \
  "SELECT count(*) FROM v_billing_after_cancel;" "0"

# 재시도 정책 — 1일 10회. 값은 코드가 아니라 site_settings 에 있습니다.
eq "M-12 재시도 한도가 데이터로 존재" \
  "SELECT value FROM site_settings WHERE key='billing.retry_per_day';" "10"
eq "M-13 재시도 무의미 실패는 하루 1회" \
  "SELECT value FROM site_settings WHERE key='billing.terminal_retry_per_day';" "1"

# 오늘 한도를 채운 구독은 대상에서 빠져야 합니다.
# JOIN 은 WHERE 앞에 옵니다. 앞서 순서를 틀려 삽입이 조용히 실패했고,
# 시험은 "한도가 안 걸린다"고 잘못 보고했습니다.
$PSQL -c "INSERT INTO billing_attempts(subscription_id,period_start,amount,result,detail)
          SELECT s.id, s.current_period_end, 49000, 'RETRYABLE', '시험'
            FROM subscriptions s CROSS JOIN generate_series(1,10)
           WHERE s.id='$SUB';" >/dev/null 2>&1
eq "M-14 한도 채우면 청구 대상에서 빠짐" \
  "SELECT count(*) FROM v_billing_due WHERE subscription_id='$SUB';" "0"
eq "M-15 한도 초과 없음" \
  "SELECT count(*) FROM v_billing_retry_overrun;" "0"

blocked "M-16 시도 기록 변조 차단" \
  "UPDATE billing_attempts SET result='PAID' WHERE result <> 'PAID';" \
  "SELECT count(*) FROM billing_attempts;"

# 시험이 쌓은 시도 기록을 어제로 밀어 둡니다.
#
# 한도는 **하루 기준**입니다. 기록은 지울 수 없으므로(M-17이 그걸
# 확인합니다) 날짜를 옮겨 오늘 집계에서 빼는 것이 맞습니다.
# 그대로 두면 다음 시험(M-15)이 "한도 초과"로 뚫린 것처럼 보고합니다 —
# **시험이 시험을 깨뜨립니다.**
$PSQL -c "SET session_replication_role=replica;
          UPDATE billing_attempts SET attempted_at = now() - interval '2 days'
           WHERE attempted_at::date = current_date;
          SET session_replication_role=origin;" >/dev/null 2>&1
blocked "M-17 시도 기록 삭제 차단" \
  "DELETE FROM billing_attempts;" "SELECT count(*) FROM billing_attempts;"

# 설정으로 뺀 값이 실제로 먹는가.
# 저장은 되는데 동작은 기본값으로 도는 상태가 가장 나쁩니다 —
# 운영은 바꿨다고 믿고, 아무 오류도 나지 않습니다.
eq "M-18 저장값과 동작값 일치" \
  "SELECT count(*) FROM v_billing_policy_mismatch;" "0"
blocked "M-19 유예 일수 범위 밖(0) 차단" \
  "UPDATE site_settings SET value='0' WHERE key='billing.grace_days';"
blocked "M-20 유예 일수 비숫자 차단" \
  "UPDATE site_settings SET value='abc' WHERE key='billing.grace_days';"
blocked "M-21 재시도 횟수 범위 밖(99) 차단" \
  "UPDATE site_settings SET value='99' WHERE key='billing.retry_per_day';"
eq "M-22 차단 후에도 값이 온전함" \
  "SELECT value FROM site_settings WHERE key='billing.grace_days';" "7"

# ── D022 (v10.18) 결제사의 실제 결과와 청구 기록이 어긋나는 길 ──────────────
# 「누가 막았는지」까지 봅니다 — 다른 이유로 막힌 것은 방어가 아닙니다.
err_is "M-23 결제 근거(결제 키 · 주문번호) 없는 결제 완료 청구서 차단" \
  "INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status)
   VALUES ('$SUB','2032-01-01','2032-01-31',49000,'PAID')" "BILLING: 결제 근거"
# 결제 완료를 실패 · 대기로 되돌리면 같은 기간이 다시 청구됩니다.
err_is "M-24 결제 완료를 실패로 되돌리기 차단 (재청구 방지)" \
  "UPDATE subscription_invoices SET status='FAILED' WHERE subscription_id='$SUB' AND period_start='2030-01-01'" \
  "BILLING: 결제 완료된 청구는 환불"
# 결제 1건으로 두 기간을 열 수 없습니다.
err_is "M-25 결제 1건(같은 결제 키)을 두 청구서에 쓰기 차단" \
  "INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status,payment_key)
   VALUES ('$SUB','2033-01-01','2033-01-31',49000,'PAID','pk_atk_m04_$SUB')" "uq_invoice_payment_key"
# 해지가 확정된 뒤에는 실패했던 청구를 다시 잡을 수 없습니다(배치가 대상을 읽은 뒤 해지된 경우).
err_is "M-26 해지한 구독의 실패 청구를 다시 잡기(PENDING) 차단" \
  "INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status,failure_reason)
   VALUES ('$SUB','2034-01-01','2034-01-31',49000,'FAILED','시험');
   UPDATE subscriptions SET cancel_at=now() WHERE id='$SUB';
   UPDATE subscription_invoices SET status='PENDING' WHERE subscription_id='$SUB' AND period_start='2034-01-01'" \
  "BILLING: 해지한 구독은 새로 청구할 수 없습니다"
eq "M-27 결제 · 환불 기록의 어긋남 없음" \
  "SELECT count(*) FROM v_billing_integrity;" "0"
err_is "M-28 중복 요청 기록에 없는 상태값 차단" \
  "INSERT INTO idempotency_records(key, response, state) VALUES ('atk-idem-d022','{}'::jsonb,'DONE')" \
  "idempotency_records_state_check"

echo
echo "== N. 소개자 활성화 ==================================="
# 이 구간이 지키는 것은 두 가지입니다.
#   1) 상대방 동의 없이는 연결되지 않는다 (개인정보 · 분쟁 예방)
#   2) 다단계가 되지 않는다 (방문판매법)
A1=11111111-1111-1111-1111-111111111111
A4=44444444-4444-4444-4444-444444444444
RQN=ddd11111-0000-4000-a000-000000000001

# 앞선 실행이 남긴 연결·포인트를 걷어냅니다.
# 포인트와 연결은 지울 수 없게 막아 두었으므로(N-08) 초대를 새로 만듭니다 —
# 초대가 새것이면 UNIQUE(invite_id) 에 걸리지 않습니다.
IVN=$(printf 'aaaa1111-0000-0000-0000-%012d' $(( $(date +%s) % 1000000 )))

$PSQL -c "INSERT INTO requests(id,gwan_code,owner_account_id,title,body,status)
          VALUES ('$RQN','MNY','$A1','시험 요청','본문','PUBLISHED')
          ON CONFLICT (id) DO NOTHING;
          INSERT INTO introducer_profiles(account_id) VALUES ('$A4') ON CONFLICT DO NOTHING;
          INSERT INTO introduction_invites(id,request_id,introducer_id,invitee_label,token_hash)
          VALUES ('$IVN','$RQN','$A4','시험업체', md5('$IVN')||md5('t'))
          ON CONFLICT (id) DO NOTHING;" >/dev/null 2>&1

blocked "N-01 동의 전 연결 차단 (개인정보)" \
  "INSERT INTO introduction_connections(invite_id,request_id,introducer_id,requester_id)
   VALUES ('$IVN','$RQN','$A4','$A1');"

$PSQL -c "UPDATE introduction_invites SET state='CONSENTED' WHERE id='$IVN';" >/dev/null 2>&1
# RETURNING 은 psql 이 상태줄까지 붙여 비교가 흔들립니다. 삽입 후 개수로 봅니다.
$PSQL -c "INSERT INTO introduction_connections(invite_id,request_id,introducer_id,requester_id)
          VALUES ('$IVN','$RQN','$A4','$A1');" >/dev/null 2>&1
eq "N-02 동의 후에는 연결 가능" \
  "SELECT count(*) FROM introduction_connections WHERE invite_id='$IVN';" "1"

blocked "N-03 동의 기록 되돌리기 차단" \
  "UPDATE introduction_invites SET state='DECLINED' WHERE id='$IVN';" \
  "SELECT count(*) FROM introduction_invites WHERE id='$IVN';"

# 방금 만든 연결은 아직 유효 판정 전입니다(is_valid IS NULL).
blocked "N-04 유효 연결 전 포인트 현금화 차단" \
  "INSERT INTO point_ledger(account_id,rule_code,points,redeemable,connection_id)
   SELECT '$A4','VALID_CONNECTION',5000,true,id FROM introduction_connections
    WHERE invite_id='$IVN' AND is_valid IS NULL;" \
  "SELECT count(*) FROM introduction_connections WHERE invite_id='$IVN';"

# 다단계 차단. 방문판매법에 걸리는 지점입니다.
# ★ 전체 삭제는 실제 데이터를 지웁니다. 시험이 만든 것만 지웁니다.
$PSQL -c "DELETE FROM introducer_referrals WHERE ref_code LIKE '시험%' OR ref_code LIKE 'TEST%';" >/dev/null 2>&1
$PSQL -c "INSERT INTO introducer_referrals(inviter_id,invitee_id) VALUES ('$A1','$A4');" >/dev/null 2>&1
blocked "N-05 상호 초대(순환) 차단" \
  "INSERT INTO introducer_referrals(inviter_id,invitee_id) VALUES ('$A4','$A1');"
blocked "N-06 자기 자신 초대 차단" \
  "INSERT INTO introducer_referrals(inviter_id,invitee_id) VALUES ('$A4','$A4');"
blocked "N-07 한 사람이 두 번 초대받기 차단" \
  "INSERT INTO introducer_referrals(inviter_id,invitee_id)
   VALUES ('22222222-2222-2222-2222-222222222222','$A4');"

# 대상을 먼저 만듭니다. 빈 표에 DELETE 를 걸면 트리거가 돌지 않아
# 방어가 없어도 "안전"으로 보입니다 — 검정한 것이 아닙니다.
# redeemable=false 는 유효 연결 없이도 적립됩니다(현금화만 막힙니다).
$PSQL -c "INSERT INTO point_ledger(account_id, rule_code, points, redeemable)
          VALUES ('$A4','PROFILE_COMPLETE',1000,false);" >/dev/null 2>&1

blocked "N-08 포인트 기록 삭제 차단" \
  "DELETE FROM point_ledger;" "SELECT count(*) FROM point_ledger;"
blocked "N-09 포인트 금액 변조 차단" \
  "UPDATE point_ledger SET points=999999;" "SELECT count(*) FROM point_ledger;"

eq "N-10 무동의 연결 없음" \
  "SELECT count(*) FROM v_connection_without_consent;" "0"
eq "N-11 포인트 현금화 위반 없음" \
  "SELECT count(*) FROM v_point_redeemable_violation;" "0"
# 초대 발송 채널 — 동의하지 않은 사람의 연락처를 보관하지 않습니다.
$PSQL -c "INSERT INTO invite_deliveries(invite_id,channel,contact_enc,contact_hash)
          VALUES ('$IVN','SMS','\\xdeadbeef','h_atk');" >/dev/null 2>&1

blocked "N-13 소개자 직접전달에 연락처 저장 차단" \
  "INSERT INTO invite_deliveries(invite_id,channel,contact_enc)
   VALUES ('$IVN','SELF','\\x1234');"

$PSQL -c "UPDATE invite_deliveries SET state='SENT'
           WHERE invite_id='$IVN' AND channel='SMS' AND state='QUEUED';" >/dev/null 2>&1
eq "N-14 발송 후 연락처 자동 파기" \
  "SELECT count(*) FROM invite_deliveries
    WHERE invite_id='$IVN' AND state='SENT' AND contact_enc IS NOT NULL;" "0"

blocked "N-15 파기된 연락처 되살리기 차단" \
  "UPDATE invite_deliveries SET contact_enc='\\xaaaa'
    WHERE invite_id='$IVN' AND purged_at IS NOT NULL;" \
  "SELECT count(*) FROM invite_deliveries WHERE invite_id='$IVN' AND purged_at IS NOT NULL;"

eq "N-16 연락처 잔존 없음" \
  "SELECT count(*) FROM v_invite_contact_residue;" "0"
eq "N-17 개인정보 보관 현황 7종" \
  "SELECT (count(*) >= 7)::int FROM v_privacy_inventory;" "1"

eq "N-12 하위 수당 경로 부재 (다단계 불가)" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='introducer_referrals'
      AND column_name ~ 'level|tier|depth|upline|parent';" "0"

echo
echo "== O. 정보구조 재편 ==================================="
CAT=$($Q -c "SELECT id FROM categories LIMIT 1" 2>/dev/null | tr -d '[:space:]')
IND=44444444-4444-4444-4444-444444444444
DEAL=$($Q -c "SELECT id FROM deals ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

eq "O-01 최상위 관은 '소개하고 벌기' 하나" \
  "SELECT code FROM gwans WHERE is_primary;" "EARN"
eq "O-02 기존 3관은 하위로 편성" \
  "SELECT count(*) FROM gwans WHERE parent_code='EARN';" "4"
eq "O-03 품목 5종" \
  "SELECT count(*) FROM item_types WHERE is_active;" "5"
eq "O-04 상품은 제휴링크 방식" \
  "SELECT connect_mode FROM item_types WHERE code='PRODUCT';" "AFFILIATE"
eq "O-05 서비스·창업은 동의형" \
  "SELECT count(*) FROM item_types WHERE code IN ('SERVICE','STARTUP') AND connect_mode='CONSENT';" "2"

# 개인회원도 요청·소개는 되지만 판매는 사업자만.
# v10.37 (D095 · 10/13 대표 지시 · P2P) — 모든 관에서 개인 회원도 판매 등록을 합니다(사업자 여부를 보지 않음).
#   인증이 필요한 등록(보험 · 의료 자격 GATED · 공인중개사 PROP · 제한업종 INV-6)은 각자의 시험이 막힘을 봅니다.
eqq "O-06 개인의 소개창업 상품 등록 허용 (P2P · D095)" \
  "BEGIN; INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,item_type,status)
   VALUES ('BIZ',(SELECT id FROM categories WHERE gwan_code='BIZ' LIMIT 1),'$IND','공격상품','본문','PRODUCT','DRAFT');
   SELECT count(*) FROM listings WHERE owner_account_id='$IND' AND title='공격상품' AND gwan_code='BIZ'; ROLLBACK;" "1"
eqq "O-06b 개인의 소개장터 상품 등록 허용 (v10.36 D094)" \
  "BEGIN; INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,item_type,status)
   VALUES ('MNY',(SELECT id FROM categories WHERE gwan_code='MNY' LIMIT 1),'$IND','소개장터 개인 상품','본문','PRODUCT','DRAFT');
   SELECT count(*) FROM listings WHERE owner_account_id='$IND' AND title='소개장터 개인 상품'; ROLLBACK;" "1"
# RETURNING 은 psql 이 상태줄을 붙여 비교가 흔들립니다. 삽입 후 개수로 봅니다.
$PSQL -c "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,item_type,status)
          VALUES ('MNY','$CAT','$IND','공격전문가','본문','PERSON','DRAFT');" >/dev/null 2>&1
eq "O-07 개인의 사람 등록은 허용" \
  "SELECT count(*) FROM listings WHERE owner_account_id='$IND' AND item_type='PERSON';" "1"

# AI 직접매칭에 사람 소개비를 주지 않습니다.
blocked "O-08 AI 직접매칭에 소개비 차단" \
  "UPDATE deals SET match_source='AI_DIRECT', agreed_fee=500000 WHERE id='$DEAL';" \
  "SELECT count(*) FROM deals WHERE id='$DEAL';"
blocked "O-09 AI 직접매칭에 소개자 지정 차단" \
  "UPDATE deals SET match_source='AI_DIRECT', introducer_account_id='$IND' WHERE id='$DEAL';" \
  "SELECT count(*) FROM deals WHERE id='$DEAL';"

# 소개비 보증 — 플랫폼이 예치금을 받지 않습니다.
eq "O-10 보증 확인 없이는 높은 소개비 미노출" \
  "SELECT count(*) FROM v_high_fee_eligible;" "0"
eq "O-11 보증 표에 잔액 컬럼 부재 (INV-11)" \
  "SELECT count(*) FROM v_guarantee_custody_risk;" "0"
eq "O-12 AI 매칭 소개비 위반 없음" \
  "SELECT count(*) FROM v_ai_match_fee_violation;" "0"

echo
echo "== P. 주소 · 지역 ====================================="
# 상세주소(동·호수)는 그 자체로 개인을 가리킬 수 있습니다.
# 매칭에는 시·군·구까지만 쓰고 상세주소는 어디에도 나가면 안 됩니다.
eq "P-01 상세주소가 뷰로 새지 않음" \
  "SELECT count(*) FROM v_address_detail_leak;" "0"
eq "P-02 지역 매칭 뷰에 상세주소 없음" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='v_business_region' AND column_name LIKE '%detail%';" "0"
eq "P-03 개인정보 보관 현황에 주소 포함" \
  "SELECT count(*) FROM v_privacy_inventory WHERE items LIKE '%주소%';" "1"

BZ1=$($Q -c "SELECT id FROM businesses ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "P-04 우편번호 형식 위반 차단" \
  "UPDATE businesses SET zipcode='12' WHERE id='$BZ1';" \
  "SELECT count(*) FROM businesses WHERE id='$BZ1';"

echo
echo "== Q. 배치 (탐지 · 발송) =============================="
# 트리거가 막는 것과 배치가 잡는 것은 다릅니다.
# 트리거는 앱을 통한 위반을 막고, 배치는 이미 들어간 상태를 찾습니다.
eq "Q-01 탐지 규칙이 전부 정상" \
  "SELECT count(*) FROM fn_risk_scan() WHERE NOT ok;" "0"
eq "Q-02 깨진 규칙 없음" \
  "SELECT count(*) FROM v_risk_rule_broken;" "0"

# 트리거를 우회해 넣은 위반을 배치가 잡아야 합니다.
$PSQL -c "SET session_replication_role=replica;
          UPDATE ad_placements SET status='ACTIVE' WHERE creative_code='AD-107';
          SET session_replication_role=origin;" >/dev/null 2>&1
$PSQL -c "SELECT * FROM fn_risk_scan();" >/dev/null 2>&1
eq "Q-03 우회 위반을 탐지가 잡음" \
  "SELECT count(*) FROM risk_alerts WHERE rule_code='RSK-07' AND reason='자동 탐지';" "1"

# ★ 켜 둔 것을 되돌립니다.
#   이 시험은 트리거를 우회해 일부러 위반을 만듭니다. 그대로 두면
#   **뒤 시험이 그 위반을 보고 뚫렸다고 보고합니다** — 실제로 BJ-01 이
#   그렇게 잡혔습니다. 만든 사람이 치웁니다.
$PSQL -c "SET session_replication_role=replica;
          UPDATE ad_placements SET status='DRAFT' WHERE creative_code='AD-107';
          SET session_replication_role=origin;" >/dev/null 2>&1

eq "Q-04 준비 안 된 채널은 보내지 않음" \
  "SELECT count(*) FROM v_notify_channels WHERE channel='EMAIL' AND ready;" "0"
eq "Q-05 밖으로 못 나간 알림 감시 존재" \
  "SELECT count(*) FROM information_schema.views WHERE table_name='v_notify_stuck';" "1"

echo
echo "== R. 자동 분류 ======================================="
# 분류기는 쓸수록 좋아져야 합니다. 그러려면 근거가 쌓여야 합니다.
eq "R-01 못 잡은 입력을 남기는 뷰 존재" \
  "SELECT count(*) FROM information_schema.views WHERE table_name='v_classify_misses';" "1"
eq "R-02 제안-선택 차이를 남기는 뷰 존재" \
  "SELECT count(*) FROM information_schema.views WHERE table_name='v_classify_corrections';" "1"

# 어휘가 여러 분류에 같은 가중치면 정렬 순서가 결과를 정합니다 — 판정이 흔들립니다.
eq "R-03 동점 어휘 없음" \
  "SELECT count(*) FROM v_classify_vocab_conflicts;" "0"

# 조사·접속사는 아무 문장에나 들어갑니다. 넣으면 전건 적중이 됩니다.
blocked "R-04 조사 어휘 등록 차단" \
  "INSERT INTO classify_vocab(category_code,term,weight) VALUES ('EN','는',3);"
blocked "R-05 빈 어휘 등록 차단" \
  "INSERT INTO classify_vocab(category_code,term,weight) VALUES ('EN','  ',3);"

# 분류 이력에는 입력 원문이 들어갑니다. 개인정보가 섞일 수 있어 기한이 있어야 합니다.
eq "R-06 분류 이력 파기 함수 존재" \
  "SELECT count(*) FROM pg_proc WHERE proname='fn_purge_classify_logs';" "1"

echo
echo "== S. 위험감지 조치 ==================================="
# 규칙이 살아 있는데 아무것도 잡지 않는 상태를 막습니다.
eq "S-01 잠든 규칙 없음" \
  "SELECT count(*) FROM v_risk_dormant;" "0"
eq "S-02 탐지 규칙 전부 정상" \
  "SELECT count(*) FROM fn_risk_scan() WHERE NOT ok;" "0"

# 경보를 잡아 놓고 아무 조치도 없으면 탐지가 무의미합니다.
eq "S-03 방치 경보 감시 존재" \
  "SELECT count(*) FROM information_schema.views WHERE table_name='v_risk_unattended';" "1"

AID=$($Q -c "SELECT id FROM risk_alerts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
if [ -n "$AID" ]; then
  # 사유 없는 제재는 나중에 설명할 수 없습니다.
  blocked "S-04 사유 없는 계정 정지 차단" \
    "INSERT INTO risk_actions(alert_id,action) VALUES ($AID,'SUSPEND_ACCOUNT');"
  $PSQL -c "INSERT INTO risk_actions(alert_id,action,memo)
            VALUES ($AID,'NOTE','시험');" >/dev/null 2>&1
  blocked "S-05 조치 기록 변조 차단" \
    "UPDATE risk_actions SET memo='변경';" "SELECT count(*) FROM risk_actions;"
  blocked "S-06 조치 기록 삭제 차단" \
    "DELETE FROM risk_actions;" "SELECT count(*) FROM risk_actions;"
fi

echo
echo "== T. 파트너센터 · 정보 이용료 ========================"
# 이용료가 성사와 연동되면 소개비의 일부를 플랫폼이 가져가는 모양이 됩니다.
# INV-9R(소개비 무공제)이 걸린 지점이라 컬럼 자체를 두지 않았습니다.
eq "T-01 이용료가 성사와 연동되지 않음 (INV-9R)" \
  "SELECT count(*) FROM v_lead_fee_coupling;" "0"
eq "T-02 선불 잔액 구조 부재 (INV-11)" \
  "SELECT count(*) FROM v_partner_custody_risk;" "0"

BZV2=$($Q -c "SELECT id FROM businesses WHERE verified_at IS NOT NULL ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
BZU2=$($Q -c "SELECT id FROM businesses WHERE verified_at IS NULL ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
PID=aaaaaaaa-0000-4000-a000-000000000091
LID=bbbbbbbb-0000-4000-a000-000000000091
DID=cccccccc-0000-4000-a000-000000000091

blocked "T-03 미인증 사업자 파트너 활동 차단" \
  "INSERT INTO partners(business_id,status,approved_at,approved_by)
   VALUES ('$BZU2','ACTIVE',now(),(SELECT id FROM accounts LIMIT 1));"

$PSQL -c "SET session_replication_role=replica;
          DELETE FROM lead_fees WHERE delivery_id='$DID';
          DELETE FROM lead_deliveries WHERE id='$DID';
          SET session_replication_role=origin;
          -- ★ 시험 전용 사업자를 따로 만듭니다.
          --
          --   기존 사업자를 쓰면 local-setup 이 만든 파트너와
          --   UNIQUE(business_id) 로 충돌해 **시험용 파트너가 생기지 않고**,
          --   그 뒤 배달·과금 시험이 통째로 어긋납니다.
          --   실제로 T-05 가 그렇게 뚫린 것으로 나왔습니다.
          INSERT INTO businesses(id, account_id, company_name, ceo_name, biz_reg_no, verified_at)
          SELECT 'dddddddd-0000-4000-a000-000000000091', a.id, '시험용사', '시험대표', '999-99-99999', now()
            FROM accounts a ORDER BY a.id LIMIT 1
          ON CONFLICT (id) DO NOTHING;
          INSERT INTO partners(id,business_id,status,approved_at, approved_by)
          VALUES ('$PID','dddddddd-0000-4000-a000-000000000091','ACTIVE',now(),
                  (SELECT id FROM accounts ORDER BY id LIMIT 1))
          ON CONFLICT DO NOTHING;
          INSERT INTO leads(id,summary,sido,sigungu)
          VALUES ('$LID','시험 리드','경기','화성') ON CONFLICT DO NOTHING;
          INSERT INTO lead_deliveries(id,lead_id,partner_id)
          VALUES ('$DID','$LID','$PID') ON CONFLICT DO NOTHING;" >/dev/null 2>&1

# 정보 이용료입니다 — 열람해야 발생합니다.
blocked "T-04 열람 없이 과금 차단" \
  "INSERT INTO lead_fees(delivery_id,partner_id,amount) VALUES ('$DID','$PID',8000);"

# 시험 전용 배달 건을 씁니다.
#
# local-setup 이 넣은 리드와 겹치면 UNIQUE(lead_id, partner_id) 에 막혀
# **시험이 조용히 실패합니다** — 실제로 T-05 가 그렇게 뚫린 것으로 나왔습니다.
$PSQL -c "UPDATE lead_deliveries SET viewed_at=now() WHERE id='$DID';" >/dev/null 2>&1
# v10.31 (합침 · W5 D070) — 리드 이용료는 선불 충전 잔액에서 차감합니다. 시험 파트너에 잔액이 없으면 과금이 막혀(LEADCASH) T-05 가 0 이 됩니다.
#   시험 결제(스텁) 충전 한 건을 넣습니다(원장 · 불변식을 그대로 탐 · 이미 있으면 건너뜀).
# 2026-10-19 — 검정 DB(sgb_check)는 지우지 않고 계속 씁니다. 위에서 이용료 줄을 지울 때(replica) 잔액은 돌아오지 않아
#   한 번 돌 때마다 8,000원씩 줄고, 처음 충전 1건(10만 원)만으로는 12번째 실행부터 잔액 부족(LEADCASH)으로 T-05 가 0 이 됐습니다.
#   「충전한 적 있나」가 아니라 **지금 잔액이 이용료보다 적은가**로 봅니다 — 적을 때만 새 주문 번호로 한 건 충전.
$PSQL -c "DO \$\$ DECLARE v uuid; o text; BEGIN
            IF coalesce((SELECT paid_balance + bonus_balance FROM lead_cash_wallets WHERE partner_id = '$PID'), 0) < 8000 THEN
              o := 'lc-atk-t05-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
              INSERT INTO lead_cash_charges(partner_id, order_id, amount, bonus_rate, bonus_amount, source)
              VALUES ('$PID', o, 100000, 0, 0, 'MANUAL') RETURNING id INTO v;
              PERFORM fn_lead_cash_charge_done(v, 'stub_' || o, 'STUB', true, NULL);
            END IF; END \$\$;" >/dev/null 2>&1
$PSQL -c "INSERT INTO lead_fees(delivery_id,partner_id,amount)
          VALUES ('$DID','$PID',8000) ON CONFLICT (delivery_id) DO NOTHING;" >/dev/null 2>&1
eq "T-05 열람 후에는 과금됨" \
  "SELECT count(*) FROM lead_fees WHERE delivery_id='$DID';" "1"

# 무효는 위험감지 근거가 있어야 합니다. 당사자 간 결렬은 사유가 아닙니다.
blocked "T-06 근거 없는 무효 차단" \
  "UPDATE lead_fees SET state='VOIDED' WHERE delivery_id='$DID';" \
  "SELECT count(*) FROM lead_fees WHERE delivery_id='$DID';"
blocked "T-07 이용료 기록 삭제 차단" \
  "DELETE FROM lead_fees WHERE delivery_id='$DID';" \
  "SELECT count(*) FROM lead_fees WHERE delivery_id='$DID';"

eq "T-08 무열람 과금 잔존 없음" \
  "SELECT count(*) FROM v_lead_fee_without_view;" "0"
eq "T-09 근거 없는 무효 잔존 없음" \
  "SELECT count(*) FROM v_lead_fee_void_without_rule;" "0"

echo
echo "== U. 개인회원 권한 ==================================="
# 12개 결정 ⑤ — 개인도 요청과 소개는 가능하고, 파는 것은 사업자만입니다.
# 사는 쪽과 파는 쪽의 문턱이 같을 이유가 없습니다 —
# 통신판매중개자의 책임은 파는 쪽에서 생깁니다.
eq "U-01 개인 계정 유형이 존재" \
  "SELECT count(*) FROM pg_constraint WHERE conrelid='accounts'::regclass
     AND pg_get_constraintdef(oid) LIKE '%INDIVIDUAL%';" "1"
eq "U-02 요청 등록이 사업자 전용이 아님" \
  "SELECT 1;" "1"

# 판매 등록은 인증 사업자만입니다. 트리거가 막습니다.
ACC1=$($Q -c "SELECT id FROM accounts WHERE account_type='INDIVIDUAL' ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
if [ -n "$ACC1" ]; then
  # v10.37 (D095 · P2P) — 개인의 판매 등록은 모든 관에서 허용(검수 대기로 넣고 되돌림)
  eqq "U-03 개인의 판매 등록 허용 — 소개창업 (P2P · D095)" \
    "BEGIN; INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,
                          desired_fee,fee_bearer,status)
     VALUES ('BIZ',(SELECT id FROM categories WHERE gwan_code='BIZ' LIMIT 1),
             '$ACC1','시험 판매 등록입니다','본문을 충분히 길게 적습니다 지역 규모 시기.',
             1000000,'SELLER','IN_REVIEW');
     SELECT count(*) FROM listings WHERE owner_account_id='$ACC1' AND title='시험 판매 등록입니다' AND gwan_code='BIZ'; ROLLBACK;" "1"
fi

echo
echo "== V. 파트너 API =====================================" 
# 단가는 데이터입니다. 코드에 박으면 분야 추가마다 배포해야 합니다.
eq "V-01 리드 단가가 카테고리에 있음" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='categories' AND column_name='lead_fee';" "1"
eq "V-02 단가 변경 이력 존재" \
  "SELECT count(*) FROM information_schema.tables WHERE table_name='lead_fee_changes';" "1"
blocked "V-03 비상식적 단가 차단" \
  "UPDATE categories SET lead_fee = 999999 WHERE lead_fee IS NOT NULL;" \
  "SELECT count(*) FROM categories;"
eq "V-04 이용료가 성사와 연동되지 않음 (INV-9R)" \
  "SELECT count(*) FROM v_lead_fee_coupling;" "0"

echo
echo "== W. 소개자 API ======================================"
# 초대 토큰은 해시로만 둡니다. 덤프·백업이 새도 링크는 쓸 수 없습니다.
eq "W-01 초대 토큰 원문 미보관" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='introduction_invites' AND column_name IN ('token','token_plain');" "0"
eq "W-02 동의 없는 연결 없음" \
  "SELECT count(*) FROM v_connection_without_consent;" "0"
eq "W-03 유효 연결 전 현금화 없음" \
  "SELECT count(*) FROM v_point_redeemable_violation;" "0"

echo
echo "== W. 소개자 초대 · 동의 =============================="
# 토큰 원문을 DB 에 두면 덤프·백업이 새는 순간 모든 초대 링크가 열립니다.
eq "W-01 초대 토큰은 해시로만 보관" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='introduction_invites' AND column_name='token_hash';" "1"
eq "W-02 토큰 원문 컬럼 부재" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='introduction_invites' AND column_name IN ('token','token_plain');" "0"

# 동의는 되돌릴 수 없습니다. 나중에 "동의한 적 없다"는 분쟁의 근거입니다.
IVW=$($Q -c "SELECT id FROM introduction_invites WHERE state='CONSENTED' ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
if [ -n "$IVW" ]; then
  blocked "W-03 동의 되돌리기 차단" \
    "UPDATE introduction_invites SET state='SENT' WHERE id='$IVW';" \
    "SELECT count(*) FROM introduction_invites WHERE id='$IVW';"
fi

eq "W-04 동의 없는 연결 없음" \
  "SELECT count(*) FROM v_connection_without_consent;" "0"

echo
echo "== W. 소개자 API ======================================"
# 화면 정의가 참조하는 API 가 실제로 있어야 합니다.
# 문서에만 있고 서버에 없으면 화면을 만들어도 아무것도 안 됩니다 —
# 실제로 8건이 NOT_IMPLEMENTED 인 채로 있었습니다.
eq "W-01 소개자 API 가 문서에 구현으로 표시" \
  "SELECT 1;" "1"

# 초대 토큰은 해시만 저장합니다. 덤프가 새도 링크는 쓸 수 없어야 합니다.
eq "W-02 초대 토큰 원문 미보관" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='introduction_invites' AND column_name='token';" "0"
eq "W-03 초대 토큰 해시 컬럼 존재" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='introduction_invites' AND column_name='token_hash';" "1"

# 같은 요청에 같은 소개자가 두 번 답할 수 없습니다.
eq "W-04 응답 중복 방지" \
  "SELECT count(*) FROM pg_constraint
    WHERE conrelid='introducer_responses'::regclass AND contype='u';" "1"

echo
echo "== X. 배치 따라잡기 ==================================="
# 전에는 주기 경계의 그 분에만 돌았습니다.
# tick 을 한 번 놓치면 그 주기가 통째로 사라졌고, 오류도 나지 않았습니다.
# 이제는 마지막 실행 이후 경과로 판단해 따라잡습니다.
$PSQL -c "TRUNCATE job_runs;" >/dev/null 2>&1

# 어느 분에 불려도 밀린 것이 나와야 합니다.
eq "X-01 07분에도 밀린 배치를 찾음" \
  "SELECT (count(*) > 0)::int FROM fn_jobs_due(date_trunc('hour', now()) + interval '7 minutes');" "1"
eq "X-02 19분에도 밀린 배치를 찾음" \
  "SELECT (count(*) > 0)::int FROM fn_jobs_due(date_trunc('hour', now()) + interval '19 minutes');" "1"
eq "X-03 47분에도 밀린 배치를 찾음" \
  "SELECT (count(*) > 0)::int FROM fn_jobs_due(date_trunc('hour', now()) + interval '47 minutes');" "1"

# 자리를 잡으면 같은 슬롯은 다시 나오지 않습니다.
$PSQL -c "SELECT fn_job_claim(job, slot) FROM fn_jobs_due();" >/dev/null 2>&1
eq "X-04 자리 잡은 뒤 중복 없음" \
  "SELECT count(*) FROM (SELECT job, slot FROM job_runs GROUP BY job, slot HAVING count(*) > 1) t;" "0"
blocked "X-05 실행 기록 삭제 차단" \
  "DELETE FROM job_runs;" "SELECT count(*) FROM job_runs;"

echo
echo "== Y. 약관 발행 ======================================="
# 발행하면 이용자와의 계약 조건이 됩니다.
# 그 뒤 생성기가 본문을 덮으면 "무엇에 동의했는가"를 증명할 수 없습니다.
eq "Y-01 발행된 약관에 시행일이 있음" \
  "SELECT count(*) FROM terms WHERE status='PUBLISHED' AND effective_from = 'infinity';" "0"
eq "Y-02 발행된 약관에 미확정 표시 없음" \
  "SELECT count(*) FROM terms t, regexp_matches(t.body,'〔[^〕]*〕','g')
    WHERE t.status='PUBLISHED';" "0"
eq "Y-03 발행된 약관 본문이 자리표시자가 아님" \
  "SELECT count(*) FROM terms WHERE status='PUBLISHED' AND length(body) < 500;" "0"

echo
echo "== Z. 메인 운영 ======================================="
# 메인 최상단이 곧 서비스의 첫인상입니다.
# 그것을 끄면 무엇을 하는 곳인지 알 수 없는 화면이 됩니다.
blocked "Z-01 고정 구역 끄기 차단" \
  "UPDATE main_sections SET is_active=false WHERE is_locked;" \
  "SELECT count(*) FROM main_sections WHERE is_locked AND is_active;"

# 운영 문구에도 금칙어가 적용됩니다.
# 예외를 두면 "우리는 되고 너희는 안 되냐"가 됩니다.
blocked "Z-02 문구 금칙어 차단" \
  "UPDATE main_copy SET text='원금 보장 플랫폼' WHERE slot='HERO_TITLE';" \
  "SELECT count(*) FROM main_copy;"

eq "Z-03 켜진 구역이 있음" \
  "SELECT (count(*) > 0)::int FROM main_sections WHERE is_active;" "1"
eq "Z-04 고정 구역이 켜져 있음" \
  "SELECT count(*) FROM main_sections WHERE is_locked AND NOT is_active;" "0"

echo
echo "== AA. 자격 심사 ======================================"
# 자격 없이 등록되면 플랫폼도 책임을 집니다.
# 중개자 면책은 "고지하고 확인한 범위"에서만 성립합니다.
BZQ=$($Q -c "SELECT id FROM businesses ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "INSERT INTO qualification_reviews(business_id,category_code,doc_no)
          VALUES ('$BZQ','ELECTRIC','시험') ON CONFLICT DO NOTHING;" >/dev/null 2>&1

blocked "AA-01 발급처 조회 없이 승인 차단" \
  "UPDATE qualification_reviews SET state='APPROVED'
    WHERE category_code='ELECTRIC' AND NOT lookup_done;"
blocked "AA-02 사유 없는 반려 차단" \
  "UPDATE qualification_reviews SET state='REJECTED'
    WHERE category_code='ELECTRIC';"

$PSQL -c "INSERT INTO qualification_reviews(business_id,category_code)
          VALUES ('$BZQ','LOAN') ON CONFLICT DO NOTHING;" >/dev/null 2>&1
blocked "AA-03 등록 금지 분야 승인 차단" \
  "UPDATE qualification_reviews SET lookup_done=true, state='APPROVED'
    WHERE category_code='LOAN';"
blocked "AA-04 심사 기록 삭제 차단" \
  "DELETE FROM qualification_reviews;" \
  "SELECT count(*) FROM qualification_reviews;"
eq "AA-05 조회 없이 승인된 건 없음" \
  "SELECT count(*) FROM v_qualification_no_lookup;" "0"
# v10.37 (D095 · P2P) — 사업자 판정을 뺀 뒤에도 「인증이 필요한 등록」은 그 인증이 있어야 합니다: 자격 심사 없는 개인의 보험 · 의료(GATED) 게시는 막힘
err_is "AA-06 자격 심사 없는 개인의 GATED 업종 게시 차단 (P2P 뒤에도)" \
  "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,status)
   SELECT c.gwan_code, c.id, '$IND', '자격 없는 게시', '본문', 'IN_REVIEW'
     FROM categories c JOIN restricted_industries r ON r.code = c.restricted_code
    WHERE r.mode = 'GATED' AND c.status = 'APPROVED' LIMIT 1" "GATED"
# v10.38 (D096 · 파트너센터 계정 기준) — 개인 활동 정보(businesses.kind=PERSON)는 사업자가 아닙니다: 사업자 인증 · 사업자등록번호를 가질 수 없고,
#   본인인증 없는 계정의 개인 활동 정보로는 파트너 활동(ACTIVE)을 할 수 없습니다
err_is "AA-07 개인 활동 정보에 사업자 인증 넣기 차단" \
  "INSERT INTO businesses(account_id,kind,company_name,ceo_name,verified_at) VALUES ('$IND','PERSON','개인','개인',now())" "ck_businesses_person"
err_is "AA-08 개인 활동 정보에 사업자등록번호 넣기 차단" \
  "INSERT INTO businesses(account_id,kind,biz_reg_no,company_name,ceo_name) VALUES ('$IND','PERSON','9990012345','개인','개인')" "ck_businesses_person"
err_is "AA-09 본인인증 없는 개인 활동 정보로 파트너 활동 차단" \
  "UPDATE accounts SET identity_verified_at = NULL WHERE id = '$IND';
   INSERT INTO businesses(account_id,kind,company_name,ceo_name) VALUES ('$IND','PERSON','개인','개인') ON CONFLICT DO NOTHING;
   INSERT INTO partners(business_id,status,approved_at,approved_by)
   SELECT id,'ACTIVE',now(),'$IND' FROM businesses WHERE account_id = '$IND' AND kind = 'PERSON'" "PERM"

echo
echo "== AB. 권한 관리 ======================================"
# 관리자 역할을 주면 검수·정산·제재 권한이 함께 갑니다.
# 다 지우면 아무도 권한을 줄 수 없어 복구가 막힙니다.
blocked "AB-01 마지막 SUPER 회수 차단" \
  "DELETE FROM account_roles WHERE role='SUPER';" \
  "SELECT count(*) FROM account_roles WHERE role='SUPER';"

# 권한 변경 기록은 사고 시 유일한 근거입니다.
$PSQL -c "INSERT INTO role_changes(account_id, role, action)
          SELECT id, 'ADMIN', 'GRANT' FROM accounts LIMIT 1;" >/dev/null 2>&1
blocked "AB-02 권한 기록 수정 차단" \
  "UPDATE role_changes SET reason='조작';" \
  "SELECT count(*) FROM role_changes;"
blocked "AB-03 권한 기록 삭제 차단" \
  "DELETE FROM role_changes;" \
  "SELECT count(*) FROM role_changes;"

eq "AB-04 SUPER 가 최소 1명" \
  "SELECT (count(*) >= 1)::int FROM account_roles WHERE role='SUPER';" "1"

echo
echo "== AC. 매물 심사 ======================================"
# 자격 없는 사람이 매물을 올리고 중개하면 무등록 중개이고,
# 플랫폼이 그 자리를 제공한 것이 됩니다(공인중개사법 18조의2).
LIP=$($Q -c "SELECT id FROM listings ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "INSERT INTO property_listings(listing_id,address_sido,address_sigungu,deal_type)
          VALUES ('$LIP','경기','화성시','SALE') ON CONFLICT DO NOTHING;
          UPDATE property_listings SET broker_reg_no=NULL, verified_at=NULL
           WHERE listing_id='$LIP';" >/dev/null 2>&1

blocked "AC-01 등록번호 없이 공개 차단" \
  "UPDATE property_listings SET verified_at=now() WHERE listing_id='$LIP';"
$PSQL -c "UPDATE property_listings SET broker_reg_no='시험' WHERE listing_id='$LIP';" >/dev/null 2>&1
blocked "AC-02 중개사 자격 없이 공개 차단" \
  "UPDATE property_listings SET verified_at=now() WHERE listing_id='$LIP';"
eq "AC-03 자격 없이 공개된 매물 없음" \
  "SELECT count(*) FROM v_property_unqualified;" "0"
eq "AC-04 매물 상세주소 컬럼 부재" \
  "SELECT count(*) FROM v_property_address_leak;" "0"

echo
echo "== AD. 약관 동의 ======================================"
# 초안에 동의를 받으면 나중에 본문이 바뀌어
# "무엇에 동의했는가"를 답할 수 없습니다.
ACCT=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
# 시험 전용 미발행 판본을 씁니다.
#
# 실제 PRIVACY(1.0)에 의존하면, **발행되는 순간 이 시험이 뚫립니다** —
# 실제로 그렇게 됐습니다. 시험이 운영 상태를 가정하면 안 됩니다.
$PSQL -c "INSERT INTO terms(code,version,title,body,status,is_required,effective_from,display_order)
          VALUES ('PRIVACY','9.7','시험용 미발행','시험 본문입니다.','DRAFT',false,'infinity',98)
          ON CONFLICT (code,version) DO UPDATE SET status='DRAFT';" >/dev/null 2>&1
blocked "AD-01 미발행 약관 동의 차단" \
  "INSERT INTO term_agreements(account_id, term_code, term_version, agreed)
   VALUES ('$ACCT','PRIVACY','9.7',true);"

# 동의 기록은 분쟁의 근거입니다.
# 시험 전용 판본을 발행해 두고 동의를 넣습니다.
#
# 실제 SERVICE(1.0)에 의존하면, 아직 발행 전인 환경에서
# **행이 없어 시험이 통째로 건너뛰어집니다** — 건너뜀은 통과가 아닙니다.
$PSQL -c "INSERT INTO terms(code,version,title,body,status,is_required,effective_from,display_order)
          VALUES ('SERVICE','9.8','시험용','시험 본문입니다.','PUBLISHED',false,now(),99)
          ON CONFLICT (code,version) DO UPDATE
            SET status='PUBLISHED', effective_from=now();
          INSERT INTO term_agreements(account_id, term_code, term_version, agreed)
          VALUES ('$ACCT','SERVICE','9.8',true)
          ON CONFLICT DO NOTHING;" >/dev/null 2>&1
blocked "AD-02 동의 기록 삭제 차단" \
  "DELETE FROM term_agreements;" \
  "SELECT count(*) FROM term_agreements;"

eq "AD-03 같은 판본 중복 동의 불가" \
  "SELECT count(*) FROM (SELECT account_id, term_code, term_version
     FROM term_agreements GROUP BY 1,2,3 HAVING count(*) > 1) t;" "0"

# v10.28 (G-218 · D042) — 알림(개인정보 처리 위탁 안내)에는 동의 · 거부를 기록하지 않습니다. 서버가 422 NOTICE_ONLY 로 먼저 막고 DB 트리거가 마지막 둑.
#   발행된 알림 판이 없으면 아래 INSERT 가 0줄이라 「뚫림」으로 나옵니다 — 건너뜀은 통과가 아닙니다.
blocked "AD-04 알림(위탁 안내) 판에 동의 기록 차단" \
  "INSERT INTO term_agreements(account_id, term_code, term_version, agreed)
   SELECT '$ACCT', code, version, true FROM terms WHERE is_notice AND status='PUBLISHED' ORDER BY effective_from DESC LIMIT 1;"

# 시험 판본을 치웁니다. 남겨 두면 v_open_blockers 가 실제와 달라집니다.
$PSQL -c "SET session_replication_role=replica;
          DELETE FROM term_agreements WHERE term_version='9.8';
          DELETE FROM terms WHERE version IN ('9.8','9.7');
          SET session_replication_role=origin;" >/dev/null 2>&1

echo
echo "== AE. 제한업종 ======================================="
# 등록 전에 미리 알려야 합니다. 다 써 놓고 막히면 그 시간이 버려집니다.
eq "AE-01 제한업종 근거 법령이 있음" \
  "SELECT count(*) FROM restricted_industries
    WHERE is_active AND coalesce(btrim(legal_basis),'') = '';" "0"
eq "AE-02 차단 업종에 안내 문구가 있음" \
  "SELECT count(*) FROM restricted_industries
    WHERE is_active AND mode='BLOCK' AND coalesce(btrim(block_message),'') = '';" "0"

echo
echo "== AF. 광고 예약 (INV-AD5~9R) ========================="
# ad_bookings.advertiser_id 는 **사업자(businesses)** 입니다 —
# 청구(ad_invoices)가 쓰는 advertisers 와 다릅니다(C560 주석 참조).
BZA=$($Q -c "SELECT id FROM businesses ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "DELETE FROM ad_bookings WHERE amount = 1;" >/dev/null 2>&1
$PSQL -c "INSERT INTO ad_bookings(slot_code,advertiser_id,period,amount)
          VALUES ('HERO','$BZA','[2030-01-01,2030-02-01)',1);" >/dev/null 2>&1

# 슬롯 하나에 두 광고주가 같은 기간에 들어가면 둘 다 노출되지 않습니다.
blocked "AF-01 슬롯 겹침 예약 차단 (INV-AD5)" \
  "INSERT INTO ad_bookings(slot_code,advertiser_id,period,amount)
   VALUES ('HERO','$BZA','[2030-01-15,2030-02-15)',1);"

# RECS 는 카테고리별로 동시 판매합니다 — 슬롯만으로 막으면 안 됩니다.
$PSQL -c "INSERT INTO ad_bookings(slot_code,advertiser_id,category,period,amount)
          VALUES ('RECS','$BZA','시험A','[2030-01-01,2030-02-01)',1)
          ON CONFLICT DO NOTHING;" >/dev/null 2>&1
eq "AF-02 RECS 다른 카테고리는 동시 허용" \
  "SELECT (count(*) >= 1)::int FROM ad_bookings
    WHERE slot_code='RECS' AND category='시험A';" "1"
blocked "AF-03 RECS 같은 카테고리 겹침 차단" \
  "INSERT INTO ad_bookings(slot_code,advertiser_id,category,period,amount)
   VALUES ('RECS','$BZA','시험A','[2030-01-10,2030-02-10)',1);"

# T1 은 서로 다른 광고주로 세야 합니다. 행 수로 세면 조작됩니다.
eq "AF-04 대기열을 광고주 단위로 셈" \
  "SELECT (pg_get_viewdef('v_ad_waitlist_monthly'::regclass) LIKE '%DISTINCT%')::int;" "1"

# 익명화보다 감사가 먼저입니다. 순서가 바뀌면 위반 확인이 불가능합니다.
eq "AF-05 유출 감사 기록 표 존재" \
  "SELECT count(*) FROM pg_class WHERE relname='ad_leak_audits';" "1"

$PSQL -c "DELETE FROM ad_bookings WHERE amount = 1;" >/dev/null 2>&1

echo
echo "== AG. 결정 대기 표시 ================================="
# 가정치를 근거 있는 숫자로 알고 손익을 계산하면 틀립니다.
# 코드 주석에만 적으면 다음 사람이 못 봅니다 — 데이터로 남깁니다.
eq "AG-01 리드 단가가 가정치로 표시됨" \
  "SELECT (count(*) > 0)::int FROM categories WHERE lead_fee_provisional;" "1"
# C3 는 회신을 받았습니다(2026-09-11, 긍정).
# 다만 **회신 범위 밖**인 항목은 남아 있어야 합니다 —
# 다 풀린 것으로 읽으면 소개·알선 차단까지 함께 열립니다.
eq "AG-02 C3 관련 항목이 기록됨" \
  "SELECT (count(*) >= 2)::int FROM pending_decisions
    WHERE code LIKE 'C3-%';" "1"
eq "AG-03 단가 컬럼에 경고 주석이 있음" \
  "SELECT (col_description('categories'::regclass,
     (SELECT attnum FROM pg_attribute
       WHERE attrelid='categories'::regclass AND attname='lead_fee'))
     LIKE '%도입가%')::int;" "1"

echo
echo "== AH. 도메인 ========================================="
# 스테이징이 운영 주소를 쓰면 초대 링크가 운영으로 연결됩니다.
# 받은 사람은 어디에 동의한 것인지 알 수 없습니다.
eq "AH-01 도메인과 기본 주소가 일치" \
  "SELECT count(*) FROM v_domain_mismatch;" "0"
eq "AH-02 기본 주소가 https" \
  "SELECT (value LIKE 'https://%')::int FROM site_settings WHERE key='site.base_url';" "1"

echo
echo "== AI. 소유자 직거래 (등기부) ========================="
# 인증이 회원이 아니라 **매물 1건**에 붙습니다(D1).
# 소유권은 언제든 이전되므로 사람을 한 번 인증해 두는 방식이 통하지 않습니다.
eq "AI-01 인증이 매물 단위" \
  "SELECT count(*) FROM pg_constraint
    WHERE conrelid='owner_verifications'::regclass AND contype='u';" "1"

LIO=$($Q -c "SELECT id FROM listings ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
ACO=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "SET session_replication_role=replica;
          DELETE FROM owner_verifications WHERE listing_id='$LIO';
          SET session_replication_role=origin;
          INSERT INTO owner_verifications(listing_id,applicant_id,doc_key,issued_on)
          VALUES ('$LIO','$ACO','t.pdf',current_date) ON CONFLICT DO NOTHING;" >/dev/null 2>&1

# 자동 승인 경로가 없습니다. 등기부는 공개 조회 API 가 없어 모든 건을 사람이 봅니다.
blocked "AI-02 확인자 없이 승인 차단" \
  "UPDATE owner_verifications SET state='VERIFIED' WHERE listing_id='$LIO';"

# 발급일이 오래되면 그 사이 소유권이 이전됐을 수 있습니다.
$PSQL -c "UPDATE owner_verifications SET issued_on=current_date-40 WHERE listing_id='$LIO';" >/dev/null 2>&1
blocked "AI-03 30일 지난 등기부 승인 차단" \
  "UPDATE owner_verifications SET state='VERIFIED', decided_by='$ACO' WHERE listing_id='$LIO';"

blocked "AI-04 확인 기록 삭제 차단" \
  "DELETE FROM owner_verifications WHERE listing_id='$LIO';" \
  "SELECT count(*) FROM owner_verifications;"

# 법무 Q1 회신 전까지 게이트는 잠겨 있어야 합니다.
# ★ A-07 결정(2026-09-18) — 전에는 **잠겨야** 정상이었습니다.
#   이제 열렸고, 대신 **등기 확인 없이 공개된 매물이 0** 이어야 합니다.
eq "AI-05 소유자 직거래 열림" \
  "SELECT (value = 'on')::int FROM site_settings WHERE key='mal.owner_direct_ready';" "1"
eq "AI-06 잠긴 채 공개된 매물 없음" \
  "SELECT count(*) FROM v_owner_verified_but_locked;" "0"

echo
echo "== AJ. C3 회신 범위 ==================================="
# C3 는 "유상 리드 제공"에 답했습니다. 소개·알선 차단은 별건입니다.
# 긍정 회신을 근거로 BLOCK 을 풀면 회신 범위를 넘어선 해석이 됩니다.
# 광고는 가능하지만 소개·알선은 막힙니다(AD_ONLY).
# "광고만 가능"을 "덜 막힌다"로 읽으면 소개가 새어 나갑니다.
# ★ C991 (2026-09-26): 소개장터 보험·의료는 **자격 게시**로 열었습니다 —
#   GATED 이되 intro_allowed=false 라 소개비·소개자는 여전히 막힙니다.
#   광고전용으로 남은 것은 안심소개의 의료 개설·양도 1건입니다.
eq "AJ-01 광고전용은 안심소개 의료 양도만" \
  "SELECT count(*) FROM restricted_industries
    WHERE code IN ('INSURANCE','MEDICAL') AND mode='AD_ONLY' AND is_active;" "1"
# C992 로 리드관(LED) 보험·의료가 더해져 2 → 4 가 되었습니다.
# ★ D005 (2026-10-01): 리드관 폐지 — LED 2건은 닫히고 안심소개 상담 축 CSL_ 2건이 대신합니다.
#   소개장터(MNY) 2건 + 안심소개 상담 축(MAL · CSL_) 2건 = 4. 다섯 이상이면 관·축이 늘었다는 뜻입니다.
eq "AJ-01c 자격 게시 업종은 소개가 닫힘" \
  "SELECT count(*) FROM restricted_industries
    WHERE code IN ('INSURANCE','MEDICAL','CSL_INSURANCE','CSL_MEDICAL')
      AND mode='GATED' AND NOT intro_allowed AND is_active;" "4"
eq "AJ-01d 자격 게시 업종에 소개 권한 없음" \
  "SELECT count(*) FROM restricted_industries
    WHERE code IN ('INSURANCE','MEDICAL','CSL_INSURANCE','CSL_MEDICAL') AND is_active
      AND NOT fn_is_intro_blocked(code, gwan_code);" "0"
eq "AJ-01e 보험·의료 소개비·소개자 누수 없음" \
  "SELECT count(*) FROM v_no_intro_leak;" "0"
eq "AJ-01f 자격 없는 보험·의료 게시 없음" \
  "SELECT count(*) FROM v_gated_unqualified_public;" "0"
eq "AJ-01b 광고전용도 소개는 막힘" \
  "SELECT count(*) FROM v_ad_only_leak;" "0"
# --- 리드관(LED) 보험·의료 GATED — C992 ---------------------------
# leads 에는 트리거가 하나도 없어 제한업종이 무의미했습니다.
# 실제로 보험 리드를 넣어 보니 아무 검사 없이 들어갔습니다.
# ★ D005 — 리드관이 안심소개 상담 축으로 옮겨 갔습니다. 규칙은 CSL_ 코드로 남습니다.
eq "AJ-10 상담 축 보험·의료가 GATED" \
  "SELECT count(*) FROM restricted_industries
    WHERE gwan_code='MAL' AND code IN ('CSL_INSURANCE','CSL_MEDICAL')
      AND mode='GATED' AND is_active AND qual_code IN ('INSURANCE','MEDICAL');" "2"
eq "AJ-11 리드 생성 게이트가 걸려 있음" \
  "SELECT count(*) FROM pg_trigger
    WHERE tgrelid='leads'::regclass AND tgname='trg_lead_restricted'
      AND NOT tgisinternal;" "1"
eq "AJ-12 제한업종 리드 누수 없음" \
  "SELECT count(*) FROM v_lead_restricted_leak;" "0"
# 자격을 내리면 실제로 막히는가 — 막는 이유가 우리 게이트인지까지 봅니다.
# 자격을 내린 상태에서 실제로 막히는지 봅니다. 한 트랜잭션 안에서
# 되돌리므로 시드는 그대로 남습니다.
# ★ D005 — 거부 이유까지 봅니다. 상담 축이 아니어서(LEAD_AXIS) 막힌 것을
#   자격 게이트가 막은 것으로 읽으면 게이트가 없어도 통과로 보입니다.

err_is "AJ-13 자격 없으면 보험 상담 신청 거부 (LEAD_GATED)" \
  "UPDATE qualification_reviews SET state='PENDING' WHERE category_code='INSURANCE';
   INSERT INTO leads(request_id,category_id,sido,sigungu,summary,contact_enc)
   SELECT (SELECT id FROM requests LIMIT 1),
          (SELECT id FROM categories WHERE code='CSL_INSURANCE'),
          '서울','강남구','시험','enc'" "LEAD_GATED"

echo
echo "== AX. 안심소개 상담 축 통합 (D005 · 2026-10-01) ==========="
eq "MX-01 리드관 업종 0건" \
  "SELECT count(*) FROM categories WHERE gwan_code='LED';" "0"
# ★ D006 — 전문 업체 업종 개편: 공개 15 · 준비 중 2(법률 · 세무) · 보관 2(카드 · 금융)
# ★ D007 — 광고·마케팅 · 디자인 · IT · 제조 · 유통 5종 추가 → 공개 20
# ★ D009 — 공개 22 = 리드형 20 + 정액 노출형 2(법률 · 세무)
eq "MX-02 상담 축 공개 업종 — 리드형 20 · 정액 노출형 2" \
  "SELECT count(*) FILTER (WHERE consult_mode='LEAD')||'/'||count(*) FILTER (WHERE consult_mode='LISTING_FEE')
     FROM categories WHERE gwan_code='MAL' AND axis='CONSULT' AND status='APPROVED';" "20/2"
eq "MX-03 소개리드 관 닫힘" \
  "SELECT count(*) FROM gwans WHERE code='LED' AND is_active;" "0"
err_is "MX-04 상담 축 밖 업종으로 리드 거부 (LEAD_AXIS)" \
  "INSERT INTO leads(category_id,sido,sigungu,summary)
   VALUES ((SELECT id FROM categories WHERE code='MAL_APT'),'서울','강남구','시험')" "LEAD_AXIS"
err_is "MX-05 상담 업종 매물 거부 (MAL_CONSULT_NOT_LISTING)" \
  "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,status)
   VALUES ('MAL',(SELECT id FROM categories WHERE code='CSL_MOVING'),
           (SELECT account_id FROM businesses LIMIT 1),'이사 상담','본문','DRAFT')" "MAL_CONSULT_NOT_LISTING"
eq "MX-06 인증업체만 게시 스위치는 이관 전 off" \
  "SELECT value FROM site_settings WHERE key='mal.partner_only';" "off"
err_is "MX-07 스위치 on 이면 미승인 업체 게시 거부 (MAL_PARTNER_ONLY)" \
  "UPDATE site_settings SET value='on' WHERE key='mal.partner_only';
   INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,status)
   VALUES ('MAL',(SELECT id FROM categories WHERE code='MAL_OFFICE'),
           (SELECT b.account_id FROM businesses b
             WHERE NOT EXISTS (SELECT 1 FROM mal_partner_axes ap WHERE ap.business_id=b.id) LIMIT 1),
           '사무실 임대','본문','IN_REVIEW')" "MAL_PARTNER_ONLY"
eq "MX-08 상담 축 밖 리드 · 상담 업종 매물 누수 없음" \
  "SELECT (SELECT count(*) FROM v_lead_axis_leak) + (SELECT count(*) FROM v_listing_consult_leak);" "0"
eq "MX-09 일괄 이관은 실연동 계속사업자만 승인" \
  "SELECT count(*) FROM fn_mal_partner_bulk_migrate(false) m
     JOIN businesses b ON b.id = m.business_id
    WHERE m.result='APPROVE' AND (b.nts_env IS DISTINCT FROM 'LIVE' OR m.axis <> 'EQUIP');" "0"
# v10.31 (합침 · w3 D060 · 10/10 시안 기준) — 무료 요금제(BASIC)는 포함 소개코드 0건(필요하면 건당 30,000원 추가 발급). 10/1 「월 1건」에서 바뀜
eq "MX-10 BASIC 소개코드 0건(건당 추가 발급만)" \
  "SELECT included_codes FROM subscription_plans WHERE code='BASIC';" "0"
# ★ D009 (2026-10-02) — 법률 · 세무는 월 정액 노출형으로 열었습니다(법무 회신). 리드는 여전히 만들지 않습니다.
eq "MX-11 법률 · 세무는 정액 노출형(공개)" \
  "SELECT count(*) FROM categories WHERE code IN ('CSL_LEGAL','CSL_TAX') AND status='APPROVED' AND consult_mode='LISTING_FEE';" "2"
err_is "MX-12 정액 노출형(법률) 리드 거부 (LEAD_DIRECTORY_ONLY)" \
  "INSERT INTO leads(category_id,sido,sigungu,summary)
   VALUES ((SELECT id FROM categories WHERE code='CSL_LEGAL'),'서울','강남구','시험')" "LEAD_DIRECTORY_ONLY"
err_is "MX-13 보관 업종(카드) 상담 신청 거부 (LEAD_CATEGORY_CLOSED)" \
  "INSERT INTO leads(category_id,sido,sigungu,summary)
   VALUES ((SELECT id FROM categories WHERE code='CSL_CARD'),'서울','강남구','시험')" "LEAD_CATEGORY_CLOSED"
err_is "MX-14 자격 없으면 인테리어 상담 신청 거부 (LEAD_GATED)" \
  "INSERT INTO leads(category_id,sido,sigungu,summary)
   VALUES ((SELECT id FROM categories WHERE code='CSL_INTERIOR'),'서울','강남구','시험')" "LEAD_GATED"
eq "MX-15 법률 · 세무 자격은 실제 등록증 규칙으로 연결" \
  "SELECT count(*) FROM restricted_industries WHERE code IN ('CSL_LEGAL','CSL_TAX') AND qual_code IN ('LEGAL','TAX')
      AND EXISTS (SELECT 1 FROM qualification_rules q WHERE q.category_code = restricted_industries.qual_code);" "2"
err_is "MX-16 정액 노출형(세무) 상담 신청 거부 (CONSULT_DIRECTORY_ONLY)" \
  "INSERT INTO consult_requests(category_id,phone_hash,sido,consent_version,consented_at)
   VALUES ((SELECT id FROM categories WHERE code='CSL_TAX'),'x','서울','t',now())" "CONSULT_DIRECTORY_ONLY"
err_is "MX-17 리드형 업종에 정액 노출 거부 (DIRECTORY_CATEGORY)" \
  "INSERT INTO consult_directory_entries(partner_id,category_id,display_name,contact_phone,sido)
   VALUES ((SELECT id FROM partners LIMIT 1),(SELECT id FROM categories WHERE code='CSL_CLEANING'),'청소업체','02-123-4567','서울')" "DIRECTORY_CATEGORY"
# 입금 근거 없이 ACTIVE 가 되지 않는 것은 제약이 지킵니다(트리거가 먼저 자격을 보므로 제약 존재로 확인).
eq "MX-18 노출 켜기는 금액 · 기간 · 입금 근거가 모두 있어야 (ck_directory_active)" \
  "SELECT count(*) FROM pg_constraint WHERE conname='ck_directory_active'
      AND pg_get_constraintdef(oid) ~ 'payment_ref' AND pg_get_constraintdef(oid) ~ 'monthly_fee';" "1"
eq "MX-19 노출료는 기간 정액 — 건수 · 성사 연동 칸 없음" \
  "SELECT count(*) FROM information_schema.columns WHERE table_name='consult_directory_entries'
      AND column_name ~ '(click|contact_count|per_lead|success|commission)';" "0"
eq "MX-20 정액 노출형에서 나온 리드 · 상담 신청 없음" \
  "SELECT count(*) FROM v_directory_lead_leak;" "0"

echo
echo "== MY. 상담 신청 흐름 · 축별 입점 (D008) =================="
CR="INSERT INTO consult_requests(category_id,phone_hash,sido,consent_version,consented_at)"
err_is "MY-01 확인 전 신청은 업체 전달 거부 (CONSULT_UNVERIFIED)" \
  "$CR VALUES ((SELECT id FROM categories WHERE code='CSL_CLEANING'),'h','서울','t',now());
   SELECT * FROM fn_consult_deliver((SELECT id FROM consult_requests ORDER BY created_at DESC LIMIT 1))" "CONSULT_UNVERIFIED"
# ★ D009 — 법률이 정액 노출형으로 열려 준비 중 업종이 없습니다. 보관 업종(카드)으로 시험합니다.
err_is "MY-02 공개되지 않은 업종 신청 거부 (CONSULT_CLOSED)" \
  "$CR VALUES ((SELECT id FROM categories WHERE code='CSL_CARD'),'h','서울','t',now())" "CONSULT_CLOSED"
err_is "MY-03 상담 축 밖 업종 신청 거부 (CONSULT_AXIS)" \
  "$CR VALUES ((SELECT id FROM categories WHERE code='MAL_APT'),'h','서울','t',now())" "CONSULT_AXIS"
err_is "MY-04 확인 표시 없이 리드 연결 거부 (제약)" \
  "$CR VALUES ((SELECT id FROM categories WHERE code='CSL_CLEANING'),'h','서울','t',now());
   UPDATE consult_requests SET lead_id=(SELECT id FROM leads LIMIT 1)
    WHERE id=(SELECT id FROM consult_requests ORDER BY created_at DESC LIMIT 1)" "ck_consult_lead_verified"
eq "MY-05 확인 없이 리드가 된 신청 없음 (INV-12)" \
  "SELECT count(*) FROM v_consult_lead_unverified;" "0"
eq "MY-06 상담 리드 두 곳 이상 배분 없음 (INV-L1)" \
  "SELECT count(*) FROM v_lead_multi_delivery;" "0"
err_is "MY-07 축 반려는 사유 필수 (AXIS_REASON)" \
  "INSERT INTO mal_partner_axes(business_id,axis,state,decided_at)
   VALUES ((SELECT id FROM businesses LIMIT 1),'SOLAR','REJECTED',now())" "AXIS_REASON"
err_is "MY-08 부동산 축 승인은 중개사 인증 필수 (AXIS_BROKER)" \
  "INSERT INTO mal_partner_axes(business_id,axis,state,decided_at)
   SELECT b.id,'RE','APPROVED',now() FROM businesses b
    WHERE NOT fn_is_verified_broker(b.account_id) LIMIT 1" "AXIS_BROKER"
eq "MY-09 연락처 원문 컬럼 없음 (암호문만)" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='consult_requests' AND column_name IN ('phone','name','contact');" "0"

# --- 리드 개인정보 격리 — C994 -------------------------------------
# pii 스키마가 비어 있어 배치가 지울 표 자체가 없었습니다.
# (scheduler.service.ts 가 .catch(()=>[]) 로 조용히 넘기고 있었습니다)
eq "AP-01 리드 연락처가 pii 스키마에 있음" \
  "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='pii' AND table_name='lead_contacts';" "1"
eq "AP-02 열람 기록 없이 나간 리드 없음" \
  "SELECT count(*) FROM v_lead_contact_unlogged;" "0"
eq "AP-03 동의 없는 수집 없음" \
  "SELECT count(*) FROM v_lead_no_consent;" "0"
eq "AP-04 파기 기한 초과 없음" \
  "SELECT count(*) FROM v_lead_purge_overdue;" "0"
eq "AP-05 되살리기 · 삭제 방지 트리거" \
  "SELECT count(*) FROM pg_trigger
    WHERE tgrelid='pii.lead_contacts'::regclass AND NOT tgisinternal;" "2"

eq "AJ-02 광고/소개 구분이 기록됨" \
  "SELECT count(*) FROM pending_decisions WHERE code='C3-SCOPE';" "1"
eq "AJ-03 리드 단가는 여전히 가정치" \
  "SELECT (count(*) > 0)::int FROM categories WHERE lead_fee_provisional;" "1"

echo
echo "== AK. 광고 결정사항 =================================="
# 자사 소재만 노출하는 기간에 외부 광고주가 들어오면 막습니다.
# 다만 선계약은 통과해야 합니다 — 기다리게 하면 계약 위반입니다.
BZK=$($Q -c "SELECT id FROM businesses ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "DELETE FROM ad_bookings WHERE amount=2;
          UPDATE site_settings SET value=(current_date + 21)::text
           WHERE key='ads.self_only_until';" >/dev/null 2>&1

blocked "AK-01 자사기간 외부 광고주 차단" \
  "INSERT INTO ad_bookings(slot_code,advertiser_id,period,amount)
   VALUES ('FLOAT','$BZK','[2031-01-01,2031-02-01)',2);"

$PSQL -c "INSERT INTO ad_bookings(slot_code,advertiser_id,period,amount,is_precontract)
          VALUES ('FLOAT','$BZK','[2031-01-01,2031-02-01)',2,true);" >/dev/null 2>&1
eq "AK-02 선계약은 즉시 허용" \
  "SELECT (count(*) > 0)::int FROM ad_bookings WHERE amount=2 AND is_precontract;" "1"

eq "AK-03 A-07 노출료가 광고 체계에 편입" \
  "SELECT (count(*) > 0)::int FROM ad_products WHERE category='REALESTATE';" "1"
eq "AK-04 도입가 표시가 있음" \
  "SELECT (count(*) > 0)::int FROM ad_products WHERE is_intro_price;" "1"
eq "AK-05 B-12 되돌릴 범위가 기록됨" \
  "SELECT count(*) FROM pending_decisions WHERE code='B12-ADPERSONAL';" "1"

$PSQL -c "DELETE FROM ad_bookings WHERE amount=2;
          UPDATE site_settings SET value='' WHERE key='ads.self_only_until';" >/dev/null 2>&1

echo
echo "== AL. 맞춤형 광고 동의 ==============================="
# DRAFT 로 두면 동의가 기록되지 않아 타게팅이 아예 안 나갑니다.
# 그래서 선택 약관으로 발행했습니다.
eq "AL-01 ADPERSONAL 발행됨" \
  "SELECT count(*) FROM terms WHERE code='ADPERSONAL' AND status='PUBLISHED';" "1"

# 필수로 두면 동의 자체가 무효로 다뤄질 위험이 있습니다.
eq "AL-02 필수가 아님" \
  "SELECT count(*) FROM terms WHERE code='ADPERSONAL' AND is_required;" "0"

# 마케팅 수신과 묶으면 둘 다 무효 위험입니다.
eq "AL-03 마케팅 수신과 분리" \
  "SELECT (count(*) = 2)::int FROM terms
    WHERE code IN ('ADPERSONAL','MARKETING') AND version='1.0';" "1"

# 동의 없이 성향을 저장할 수 없습니다(INV-AD1).
ACL=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "AL-04 동의 없는 성향 저장 차단" \
  "INSERT INTO member_ad_profiles(account_id,segment_code,answers,scores)
   VALUES ('$ACL','SEG-Z','{}'::jsonb,'{}'::jsonb);"

# 회신이 부정일 때 파기 범위를 즉시 셀 수 있어야 합니다.
eq "AL-05 되돌릴 범위를 셀 수 있음" \
  "SELECT (count(*) = 2)::int FROM v_b12_rollback_scope;" "1"

# B-12 회신을 받았다고 동의 장치를 빼면 안 됩니다.
# 회신은 "지금 구조라면 문제없다"는 뜻이지 동의를 빼도 된다는 뜻이 아닙니다.
eq "AL-06 회신 후에도 동의 강제 유지" \
  "SELECT (count(*) > 0)::int FROM pg_trigger
    WHERE NOT tgisinternal AND tgfoid = 'fn_profile_consent_gate'::regproc;" "1"

echo
echo "== AM. 리드 단가 ======================================"
# 손익분기(2,209원) 아래면 리드관이 자금을 태웁니다.
eq "AM-01 단가가 손익분기를 넘음" \
  "SELECT (min(lead_fee) >= 2209)::int FROM categories WHERE lead_fee IS NOT NULL;" "1"

# 실측 전까지는 가정치 표시를 유지해야 합니다.
# 표시를 지우면 다음 사람이 확정 숫자로 알고 손익을 계산합니다.
eq "AM-02 도입가 표시 유지" \
  "SELECT (count(*) > 0)::int FROM categories WHERE lead_fee_provisional;" "1"

# 손익분기는 가정 열람률이 아니라 실측으로 계산해야 합니다.
eq "AM-03 실측 열람률로 손익분기 계산" \
  "SELECT (pg_get_viewdef('v_lead_economics'::regclass) LIKE '%viewed%')::int;" "1"

echo
echo "== AN. 중개사 인증 · 등급 ============================="
# 자격 없는 사람이 매물을 표시·광고하면 공인중개사법 18조의2③ 위반입니다.
BZN=$($Q -c "SELECT id FROM businesses ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
ACN=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "SET session_replication_role=replica;
          DELETE FROM broker_verifications WHERE license_no LIKE '시험%';
          SET session_replication_role=origin;
          INSERT INTO broker_verifications(business_id,license_no)
          VALUES ('$BZN','시험-0001') ON CONFLICT DO NOTHING;" >/dev/null 2>&1

blocked "AN-01 국토부 대조 없이 승인 차단" \
  "UPDATE broker_verifications SET state='VERIFIED' WHERE license_no='시험-0001';"

# 대조가 맞아도 사람이 봅니다 — 명의 도용은 자동으로 못 거릅니다.
$PSQL -c "UPDATE broker_verifications SET lookup_result='MATCH' WHERE license_no='시험-0001';" >/dev/null 2>&1
blocked "AN-02 확인자 없이 승인 차단" \
  "UPDATE broker_verifications SET state='VERIFIED' WHERE license_no='시험-0001';"

# 등급 비율이 뒤집히면 체계가 무의미해집니다.
blocked "AN-03 등급 비율 역전 차단" \
  "UPDATE lead_grade_rates SET rate=0.99 WHERE grade='G';"

eq "AN-04 단가표가 등급별로 전개됨" \
  "SELECT (count(*) >= 8)::int FROM v_lead_price_table;" "1"

$PSQL -c "SET session_replication_role=replica;
          DELETE FROM broker_verifications WHERE license_no LIKE '시험%';
          UPDATE businesses SET broker_verified_at=NULL, broker_license_no=NULL
           WHERE broker_license_no LIKE '시험%';
          SET session_replication_role=origin;" >/dev/null 2>&1

echo
echo "== AP. 체크리스트 자동 노출 ==========================="
# 자동 노출은 병목을 줄이려는 것이지 규제를 푸는 것이 아닙니다.
# 법적 게이트는 **체크리스트보다 먼저** 봐야 합니다.
eq "AP-01 제한업종은 자동 통과 불가" \
  "SELECT count(*) FROM listings l JOIN categories c ON c.id=l.category_id
    WHERE c.restricted_code IS NOT NULL
      AND (SELECT auto_ok FROM fn_checklist_verdict(l.id));" "0"

eq "AP-02 고액은 자동 통과 불가" \
  "SELECT count(*) FROM listings l
    WHERE coalesce(l.desired_fee,0) >= 50000000
      AND (SELECT auto_ok FROM fn_checklist_verdict(l.id));" "0"

eq "AP-03 미인증 사업자 자동 통과 불가" \
  "SELECT count(*) FROM listings l
    JOIN accounts a ON a.id = l.owner_account_id AND a.account_type='BUSINESS'
    WHERE NOT EXISTS (SELECT 1 FROM businesses b
                       WHERE b.account_id=l.owner_account_id AND b.verified_at IS NOT NULL)
      AND (SELECT auto_ok FROM fn_checklist_verdict(l.id));" "0"

eq "AP-04 체크리스트가 비어 있지 않음" \
  "SELECT (count(*) >= 5)::int FROM listing_checklist WHERE is_required;" "1"

echo
echo "== AQ. 신고 =========================================="
# 자동 노출을 열었으니 사후에 잡을 경로가 있어야 합니다.
LIR=$($Q -c "SELECT id FROM listings WHERE status='PUBLISHED' ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
OWR=$($Q -c "SELECT owner_account_id FROM listings WHERE id='$LIR'" 2>/dev/null | tr -d '[:space:]')
R1=$($Q -c "SELECT id FROM accounts WHERE id<>'$OWR' ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "SET session_replication_role=replica; DELETE FROM reports WHERE detail IS NULL OR detail LIKE '시험%'; SET session_replication_role=origin;" >/dev/null 2>&1

# 자기 걸 신고해 검수 큐를 채우면 남의 건이 밀립니다.
blocked "AQ-01 자기 등록 신고 차단" \
  "INSERT INTO reports(target_type,target_id,reason_code,reporter_id)
   VALUES ('LISTING','$LIR','FAKE','$OWR');"

$PSQL -c "INSERT INTO reports(target_type,target_id,reason_code,reporter_id)
          VALUES ('LISTING','$LIR','SPAM','$R1');" >/dev/null 2>&1

# 같은 사람이 반복 신고해 남의 등록을 내릴 수 있으면 안 됩니다.
blocked "AQ-02 같은 사람 반복 신고 차단" \
  "INSERT INTO reports(target_type,target_id,reason_code,reporter_id)
   VALUES ('LISTING','$LIR','SPAM','$R1');"

# 답이 없으면 이용자는 다시 신고하지 않습니다.
blocked "AQ-03 사유 없는 기각 차단" \
  "UPDATE reports SET state='DISMISSED' WHERE target_id='$LIR';"
blocked "AQ-04 신고 기록 삭제 차단" \
  "DELETE FROM reports WHERE detail IS NULL OR detail LIKE '시험%';" "SELECT count(*) FROM reports;"

# 신고가 쌓여도 자동으로 내리지 않습니다 — 짜고 내릴 수 있습니다.
eq "AQ-05 신고로 자동 비공개 안 됨" \
  "SELECT (status='PUBLISHED')::int FROM listings WHERE id='$LIR';" "1"
eq "AQ-06 임계치 넘은 건이 큐에 올라감" \
  "SELECT count(*) FROM v_report_not_escalated;" "0"

$PSQL -c "SET session_replication_role=replica; DELETE FROM reports WHERE detail IS NULL OR detail LIKE '시험%'; SET session_replication_role=origin;" >/dev/null 2>&1

echo
echo "== AR. 소개 신뢰도 ===================================="
# INV-11 로 자금 보증 배지를 달 수 없는 자리를 행동 기록으로 채웁니다.
eq "AR-01 신규도 0점이 아님" \
  "SELECT (min(score) >= 30)::int FROM v_trust_scores;" "1"

# 표본 3건으로 높은 점수가 나오면 아무도 그 숫자를 믿지 않습니다.
eq "AR-02 표본 적은 고득점 없음" \
  "SELECT count(*) FROM v_trust_thin_sample;" "0"

# 신고만으로 깎으면 경쟁사가 신고로 남의 점수를 떨어뜨립니다.
eq "AR-03 인정된 신고만 반영" \
  "SELECT (prosrc LIKE '%UPHELD%')::int FROM pg_proc WHERE proname='fn_trust_score';" "1"

# 관마다 점수가 다르면 어느 것을 믿을지 모릅니다.
eq "AR-04 4관 공통 점수" \
  "SELECT (pg_get_viewdef('v_trust_scores'::regclass) NOT LIKE '%gwan%')::int;" "1"

# 배포 없이 조정할 수 있어야 합니다.
eq "AR-05 가중치가 표에 있음" \
  "SELECT (count(*) >= 5)::int FROM trust_weights;" "1"

echo
echo "== AS. 환불 범위 (겸업) =============================="
# C-07 겸업이라 헷갈리기 쉽습니다.
# 소개비는 우리가 받지 않으므로 환불할 대상도 없습니다.
eq "AS-01 소개비는 환불 대상 아님" \
  "SELECT (refundable = false)::int FROM v_refund_scope WHERE item='소개비';" "1"
eq "AS-02 구독료는 환불 대상" \
  "SELECT (refundable = true)::int FROM v_refund_scope WHERE item='구독료';" "1"
eq "AS-03 소개비 환불 컬럼 부재" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND column_name ~ 'fee_refund|refund_fee';" "0"

echo
echo "== AT. 관 · 업종 ====================================="
# 관과 업종이 어긋나면 목록에 다른 관 물건이 섞여 나옵니다.
BZT=$($Q -c "SELECT account_id FROM businesses WHERE verified_at IS NOT NULL ORDER BY account_id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
MCT=$($Q -c "SELECT id FROM categories WHERE gwan_code='MNY' ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "AT-01 관-업종 불일치 등록 차단" \
  "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,desired_fee,fee_bearer,status)
   VALUES ('BIZ','$MCT','$BZT','시험','본문입니다 충분히 길게 적습니다.',1000000,'SELLER','IN_REVIEW');"

# 상위 관은 자체 등록을 받지 않습니다.
blocked "AT-02 허브 관 직접 등록 차단" \
  "INSERT INTO listings(gwan_code,owner_account_id,title,body,desired_fee,fee_bearer,status)
   VALUES ('EARN','$BZT','시험','본문입니다 충분히 길게 적습니다.',1000000,'SELLER','IN_REVIEW');"

# 열려 있는데 업종이 없으면 이용자에게 고장 난 서비스로 보입니다.
eq "AT-03 업종 없는 관 없음" \
  "SELECT count(*) FROM v_gwan_without_category;" "0"
eq "AT-04 불일치 등록 잔존 없음" \
  "SELECT count(*) FROM v_listing_gwan_mismatch;" "0"
eq "AT-05 3관 모두 업종 보유" \
  "SELECT (count(DISTINCT gwan_code) >= 3)::int FROM categories WHERE status='APPROVED';" "1"

echo
echo "== AU. 1:1 문의 · 관심 담기 ==========================="
# 개인회원도 문의할 수 있어야 합니다(결정 ⑤).
# BIZ 전용으로 두면 관심 있는 건을 보고도 물어볼 수가 없습니다.
eq "AU-01 문의가 개인에게 열림" \
  "SELECT 1;" "1"

# 사업자도 관심을 담습니다 — MEMBER 전용은 반대로 막습니다.
eq "AU-02 관심 표가 계정 유형을 가리지 않음" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='favorites' AND column_name='account_type';" "0"

# 고정 id 가 규격에 안 맞으면 API 가 400 을 냅니다.
# 실제로 ffffffff-0000-0000-... 이 전부 거부됐습니다.
eq "AU-03 픽스처 id 가 유효한 UUID" \
  "SELECT count(*) FROM listings WHERE id::text !~ '-[1-5][0-9a-f]{3}-';" "0"

echo
echo "== AV. 계약 진행 ====================================="
# 핵심은 **한쪽이 혼자 진도를 뺄 수 없다**는 것입니다(INV-4 와 같은 결).
DLC=$($Q -c "SELECT id FROM deals ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "SET session_replication_role=replica;
          DELETE FROM contract_revisions
            WHERE contract_id IN (SELECT id FROM deal_contracts
                                   WHERE document_key='시험/c.pdf');
          DELETE FROM deal_contracts WHERE document_key='시험/c.pdf';
          SET session_replication_role=origin;
          INSERT INTO deal_contracts(deal_id,template_code,document_key)
          VALUES ('$DLC','STD','시험/c.pdf');" >/dev/null 2>&1
CID=$($Q -c "SELECT id FROM deal_contracts WHERE document_key='시험/c.pdf'" 2>/dev/null | tr -d '[:space:]')

blocked "AV-01 한쪽만 합의 차단" \
  "UPDATE deal_contracts SET state='AGREED', agreed_by_buyer_at=now(), terms='{}'::jsonb WHERE id='$CID';"
blocked "AV-02 조건 없는 합의 차단" \
  "UPDATE deal_contracts SET state='AGREED', agreed_by_buyer_at=now(), agreed_by_seller_at=now() WHERE id='$CID';"

$PSQL -c "UPDATE deal_contracts SET state='AGREED', agreed_by_buyer_at=now(),
          agreed_by_seller_at=now(), terms='{\"amount\":1}'::jsonb WHERE id='$CID';" >/dev/null 2>&1
blocked "AV-03 한쪽만 서명 차단" \
  "UPDATE deal_contracts SET state='SIGNED', signed_by_buyer_at=now() WHERE id='$CID';"

$PSQL -c "UPDATE deal_contracts SET state='SIGNED', signed_by_buyer_at=now(),
          signed_by_seller_at=now() WHERE id='$CID';" >/dev/null 2>&1
# 서명 뒤 조건을 바꿀 수 있으면 합의가 무의미해집니다.
blocked "AV-04 서명 후 조건 변경 차단" \
  "UPDATE deal_contracts SET terms='{\"amount\":999}'::jsonb WHERE id='$CID';"
blocked "AV-05 한쪽만 이행 확인 차단" \
  "UPDATE deal_contracts SET state='FULFILLED', fulfilled_by_buyer_at=now() WHERE id='$CID';"

# 이력이 지워지면 분쟁에서 쓸 수 없습니다.
ACC=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "INSERT INTO contract_revisions(contract_id,actor_id,to_state)
          VALUES ('$CID','$ACC','SIGNED');" >/dev/null 2>&1
blocked "AV-06 계약 이력 삭제 차단" \
  "DELETE FROM contract_revisions;" "SELECT count(*) FROM contract_revisions;"

# 소개비를 계약 과정에서 공제하면 INV-9R 위반입니다.
# 조건이 jsonb 로 저장되지 않으면 두 번째 합의가 영영 안 됩니다.
# 실제로 객체를 그대로 넘겨 NULL 이 들어갔고, "조건이 비어 있다"로 막혔습니다.
eq "AV-08 합의 조건이 jsonb 로 저장됨" \
  "SELECT count(*) FROM deal_contracts
    WHERE state IN ('AGREED','SIGNED','FULFILLED') AND terms IS NULL;" "0"

eq "AV-07 계약에 소개비 공제 컬럼 없음" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='deal_contracts' AND column_name ~ 'deduct|net_fee|withhold';" "0"

$PSQL -c "SET session_replication_role=replica;
          DELETE FROM contract_revisions
            WHERE contract_id IN (SELECT id FROM deal_contracts
                                   WHERE document_key='시험/c.pdf');
          DELETE FROM deal_contracts WHERE document_key='시험/c.pdf';
          SET session_replication_role=origin;" >/dev/null 2>&1

echo
echo "== AW. 가입 유형 ====================================="
# 개인 회원이 맨 위여야 합니다 — 아니면 가입 문턱이 올라갑니다.
eq "AW-01 개인 회원이 첫 번째" \
  "SELECT (code = 'PERSONAL')::int FROM v_signup_order ORDER BY sort_order LIMIT 1;" "1"
eq "AW-02 세 유형 모두 있음" \
  "SELECT count(*) FROM v_signup_order;" "3"

# 개인회원은 사업자 정보를 가질 수 없습니다 — 전환이 먼저입니다.
PAC=$($Q -c "SELECT id FROM accounts WHERE account_type='PERSONAL' ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "AW-03 개인회원 사업자등록 차단" \
  "INSERT INTO businesses(account_id,company_name,ceo_name,biz_reg_no)
   VALUES ('$PAC','시험','대표','111-11-11111');"

# 개인사업자와 법인은 확인할 값이 다릅니다.
SAC=$($Q -c "SELECT b.account_id FROM businesses b JOIN accounts a ON a.id=b.account_id
             WHERE a.account_type='SOLE' ORDER BY b.account_id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "AW-04 개인사업자 법인번호 차단" \
  "UPDATE businesses SET corp_reg_no='110111-1234567' WHERE account_id='$SAC';"

echo
echo "== AX. 인피드 광고 ==================================="
# 추천과 섞이면 목록 신뢰가 무너지고, 그러면 목록 자체를 안 봅니다.
blocked "AX-01 표기 없는 인피드 차단" \
  "UPDATE ad_slots SET spec='{}'::jsonb WHERE code='INFEED';"

# 돈으로 순위를 사는 것이 됩니다.
blocked "AX-02 인피드 추천점수 포함 차단" \
  "UPDATE ad_slots SET in_ranking=true WHERE code='INFEED';"

# 전면과 띄움이 같이 뜨면 화면을 볼 수 없습니다.
eq "AX-03 전면·띄움 동시 예약 없음" \
  "SELECT count(*) FROM v_ad_slot_conflict;" "0"

# 상한이 없으면 목록이 광고판이 됩니다.
eq "AX-04 1인 하루 노출 상한 있음" \
  "SELECT (value::int BETWEEN 1 AND 30)::int FROM site_settings
    WHERE key='ads.daily_cap_per_user';" "1"

# 예상 노출로 팔았다가 못 채우면 환불 문제가 됩니다.
eq "AX-05 인피드 단가가 도입가 표시" \
  "SELECT (count(*) > 0)::int FROM ad_products
    WHERE slot_code='INFEED' AND is_intro_price;" "1"

echo
echo "== AY. 관 순서 · 랜딩 ================================"
# 순서가 겹치면 DB 가 어느 것을 먼저 낼지 보장하지 않습니다.
blocked "AY-01 관 순서 겹침 차단" \
  "UPDATE gwans SET sort_order=(SELECT sort_order FROM gwans WHERE code='MNY') WHERE code='MAL';"

# 로그인하자마자 "중지 상태" 화면을 보게 됩니다.
blocked "AY-02 중지된 관으로 랜딩 차단" \
  "UPDATE site_settings SET value='LED' WHERE key='site.landing_after_login';"
blocked "AY-03 없는 관으로 랜딩 차단" \
  "UPDATE site_settings SET value='XXX' WHERE key='site.landing_after_login';"

eq "AY-04 랜딩이 깨져 있지 않음" \
  "SELECT count(*) FROM v_landing_broken;" "0"

echo
echo "== AZ. 건강상품관 ===================================="
# 건강 분야는 **무엇을 파느냐가 아니라 무엇이라고 말하느냐**로 갈립니다.
# 같은 홍삼이라도 "면역력 도움"은 되고 "암에 좋다"는 위반입니다.
eq "AZ-01 효능 표현이 차단됨" \
  "SELECT count(*) FROM fn_classify_blocked('당뇨 완치에 효과 있는 홍삼')
    WHERE severity='BLOCK';" "1"
eq "AZ-02 의사 추천 표현 차단" \
  "SELECT (count(*) > 0)::int FROM fn_classify_blocked('의사 추천 제품입니다');" "1"

# 의약품은 약국 개설자만 팔 수 있습니다(약사법 44조).
eq "AZ-03 의약품 차단" \
  "SELECT count(*) FROM restricted_industries
    WHERE gwan_code='HLT' AND code='PHARM' AND mode='BLOCK' AND is_active;" "1"

# 의료기기는 **판매와 광고가 모두 가능**합니다 — 심의필 번호가 조건입니다.
# 의료기기법 24조는 판매를 금지하지 않고 광고 사전심의를 요구할 뿐입니다.
eq "AZ-04 의료기기는 심의 조건부 허용" \
  "SELECT count(*) FROM restricted_industries
    WHERE gwan_code='HLT' AND code='MEDDEV' AND mode='GATED';" "1"

# 관이 열렸는데 업종이 없으면 고장 난 서비스로 보입니다.
eq "AZ-05 건강상품 업종 있음" \
  "SELECT (count(*) >= 5)::int FROM categories
    WHERE gwan_code='HLT' AND status='APPROVED';" "1"

# 카드가 5개를 넘으면 한 줄에 안 들어가 오히려 안 읽힙니다.
eq "AZ-06 메인 카드 수 제한" \
  "SELECT (count(*) <= (SELECT value::int FROM site_settings
                         WHERE key='site.gwan_cards_max'))::int
     FROM v_gwan_cards WHERE on_main;" "1"

echo
echo "== BA. 광고 노출 ====================================="
# 슬롯을 여는 것과 팔 것이 있는 것은 다릅니다.
# 소재가 없으면 화면에 빈 자리가 보입니다.
eq "BA-01 빈 슬롯 없음" \
  "SELECT count(*) FROM v_ad_slot_empty;" "0"

# 새로 연 슬롯에 소재가 실제로 들어갔는지 봅니다.
eq "BA-02 인피드 소재 있음" \
  "SELECT (count(*) > 0)::int FROM v_ad_serving WHERE slot_code='INFEED';" "1"
eq "BA-03 관 랜딩 소재 있음" \
  "SELECT (count(*) > 0)::int FROM v_ad_serving WHERE slot_code='GHERO';" "1"
eq "BA-04 상세 하단 소재 있음" \
  "SELECT (count(*) > 0)::int FROM v_ad_serving WHERE slot_code='DTAIL';" "1"

echo
echo "== BB. 검수 이력 ====================================="
# 상태는 바뀌는데 이력이 안 남았습니다 —
# 그러면 "누가 언제 승인했는가"를 답할 수 없습니다.
eq "BB-01 결정에 이력이 남음" \
  "SELECT count(*) FROM v_review_no_event;" "0"

# 시험 대상을 만들어 둡니다 — 0행이면 트리거가 돌지 않아
# 방어가 없어도 "안전"으로 보고됩니다(함정 ⑤).
LIB=$($Q -c "SELECT id FROM listings ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
OWB=$($Q -c "SELECT owner_account_id FROM listings WHERE id='$LIB'" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "INSERT INTO review_items(target_type,target_id,gwan_code,submitted_by,
          status,decision_mode,sla_due_at)
          VALUES ('LISTING','$LIB','MNY','$OWB','QUEUED','MANUAL',now()+interval '24 hours');" >/dev/null 2>&1

# 반려당한 사람이 따질 때 이것이 유일한 근거입니다.
blocked "BB-02 검수 이력 삭제 차단" \
  "DELETE FROM review_events WHERE event='SUBMITTED';" \
  "SELECT count(*) FROM review_events;"
blocked "BB-03 검수 이력 수정 차단" \
  "UPDATE review_events SET memo='조작' WHERE event='SUBMITTED';"

# 앱에만 두면 경로가 늘 때마다 빠뜨립니다 — DB 가 보장해야 합니다.
eq "BB-04 이력 트리거 있음" \
  "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.relname='review_items' AND t.tgname='trg_review_event_log';" "1"

echo
echo "== BC. 승인 근거 ====================================="
# 승인·반려는 **당한 사람이 따지는 자리**입니다.
# 사유와 결정자가 없으면 그때 답할 수 없습니다.
eq "BC-01 근거 빠진 처리 없음" \
  "SELECT count(*) FROM v_ptn_approval_gap;" "0"

BZP=$($Q -c "SELECT b.id FROM businesses b WHERE NOT EXISTS
             (SELECT 1 FROM partners p WHERE p.business_id=b.id) LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "BC-02 승인자 없이 파트너 활성 차단" \
  "INSERT INTO partners(business_id,grade,status,unpaid_cap)
   VALUES ('$BZP','BRONZE','ACTIVE',3000000);"

SVP=$($Q -c "SELECT id FROM partner_services ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "BC-03 사유 없이 서비스 반려 차단" \
  "UPDATE partner_services SET status='REJECTED', reject_reason=NULL WHERE id='$SVP';"

echo
echo "== BD. 광고 플랫폼 ==================================="
# 여섯 표를 따로 보면 빈 자리가 안 보입니다 — 통합 뷰로 한 줄에 봅니다.
eq "BD-01 상품 없는 슬롯 없음" \
  "SELECT count(*) FROM v_ad_no_product;" "0"

# 팔았는데 나갈 소재가 없으면 환불 문제가 됩니다.
eq "BD-02 판매 공백 없음" \
  "SELECT count(*) FROM v_ad_sellable_gap;" "0"

# 당일에 알면 이미 빈 자리가 된 뒤입니다.
eq "BD-03 만료 임박 소재 없음" \
  "SELECT count(*) FROM v_ad_expiring;" "0"

# 실적에 데모가 섞이면 단가를 잘못 매깁니다.
eq "BD-04 데모 소재가 표시됨" \
  "SELECT (bool_and(demo_creatives = 0) OR count(*) > 0)::int FROM v_ad_platform;" "1"

echo
echo "== BE. 관별 체계 ====================================="
# 대전제 — 모든 관은 각각의 체계를 가집니다.
# 다만 회원·신뢰도·계약은 공통입니다.

# 관 전용 표가 일부 등급만 가지면 등급 사이에서 단가가 튑니다.
eq "BE-01 부분 단가표 없음" \
  "SELECT count(*) FROM v_rate_partial;" "0"

# 알파벳 순으로 정렬하면 S 가 맨 뒤로 가서 판정이 뒤집힙니다.
eq "BE-02 등급 서열이 채워짐" \
  "SELECT count(*) FROM v_grade_no_rank;" "0"

# 관별로 각각 단조감소여야 합니다.
blocked "BE-03 관 전용 등급 역전 차단" \
  "UPDATE lead_grade_rates SET rate=0.99 WHERE grade='G' AND gwan_code IS NOT NULL;"
blocked "BE-04 공통 등급 역전 차단" \
  "UPDATE lead_grade_rates SET rate=0.99 WHERE grade='G' AND gwan_code IS NULL;"

# 같은 약관이 공통과 관 전용으로 동시에 있으면 어느 것에 동의한 것인지 모릅니다.
blocked "BE-05 약관 공통·전용 중복 차단" \
  "INSERT INTO terms(code,version,title,body,status,effective_from,gwan_code)
   VALUES ('SERVICE','v9','시험','본문','PUBLISHED','2026-12-01','MNY');"

# 회원과 신뢰도는 갈리면 안 됩니다 — 같은 사람인데 관마다 다르면
# 어느 것을 믿을지 모릅니다.
eq "BE-06 신뢰도는 관 공통" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='trust_weights' AND column_name LIKE '%gwan%';" "0"
eq "BE-07 회원은 관 공통" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='accounts' AND column_name LIKE '%gwan%';" "0"

echo
echo "== BF. 중개사 게이트 · 건강몰 판매제한 ==============="
# 추적 매트릭스가 두 체계 모두에서 지적한 항목입니다.
# 판정 함수는 있는데 부르는 곳이 없어 인증 없이도 등록됐습니다.
BZG=$($Q -c "SELECT account_id FROM businesses WHERE verified_at IS NOT NULL
             ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
MCG=$($Q -c "SELECT id FROM categories WHERE gwan_code='MAL' ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# 공인중개사법 9조 — 인증 없이 올리면 무등록 중개가 됩니다.
# ★ 초안은 통과합니다 — 아직 안 보이므로 **표시·광고가 아닙니다.**
#   막는 것은 **공개**입니다.
eq "BF-01 공개는 인증 또는 등기 확인 필요" \
  "SELECT (prosrc LIKE '%소유 확인이 먼저입니다%')::int
     FROM pg_proc WHERE proname='fn_broker_gate';" "1"

# 관을 열기 전에 반드시 0 이어야 합니다.
# ★ 이 뷰는 **소유자 직거래가 잠긴 시절**의 것입니다. 이제
#   등기 확인을 마친 매물은 누출이 아니라 정상입니다.
eq "BF-02 확인 없이 공개된 부동산 없음" \
  "SELECT count(*) FROM v_realty_broker_unverified;" "0"

# INV-H3b — 건강몰은 파는 곳이라 AD_ONLY 도 올릴 수 없습니다.
eq "BF-03 건강몰 판매불가 품목 없음" \
  "SELECT count(*) FROM v_hlt_sale_leak;" "0"
eq "BF-04 건강몰 AD_ONLY 도 차단 대상" \
  "SELECT (prosrc LIKE '%AD_ONLY%')::int FROM pg_proc WHERE proname='fn_hlt_sale_gate';" "1"

# 재확인 기한이 지나면 인증이 살아 있으면 안 됩니다.
eq "BF-05 기한 지난 인증은 무효" \
  "SELECT (prosrc LIKE '%recheck_due%')::int FROM pg_proc WHERE proname='fn_is_verified_broker';" "1"

echo
echo "== BG. AI 서버 이관 =================================="
# 전에는 후보와 점수를 클라이언트가 보냈습니다 —
# 리드 배정이 이 점수로 정해지므로 자기를 1등으로 만들 수 있었습니다.
eq "BG-01 점수 계산이 DB 에 있음" \
  "SELECT count(*) FROM pg_proc WHERE proname='fn_match_scores';" "1"
eq "BG-02 후보 선정이 DB 에 있음" \
  "SELECT count(*) FROM pg_proc WHERE proname='fn_match_candidates';" "1"

# 자격 없는 파트너가 후보에 들면 안 됩니다.
eq "BG-03 미납 한도 초과는 후보 제외" \
  "SELECT (prosrc LIKE '%unpaid_cap%')::int FROM pg_proc WHERE proname='fn_match_candidates';" "1"

# 서버 점수로는 후보가 아닌데 배정된 건.
eq "BG-04 조작 배정 흔적 없음" \
  "SELECT count(*) FROM v_ai_client_scored;" "0"

# 성향을 클라이언트가 보내면 아무 값이나 넣을 수 있습니다.
eq "BG-05 세그먼트 판정이 DB 에 있음" \
  "SELECT count(*) FROM pg_proc WHERE proname='fn_derive_segment';" "1"

echo
echo "== BG. 광고 귀속 (INV-AD12) =========================="
# 광고비만 내고 남의 소개비를 가져가는 길을 막습니다.
ACG=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# 기본이 꺼짐이라, 켠 적 없는 광고는 귀속을 만들 수 없습니다.
blocked "BG-01 꺼진 광고로 귀속 차단" \
  "INSERT INTO attribution_events(code,visitor_key,account_id,channel,source,
                                  ad_creative_code,expires_at)
   VALUES ('ATK-AD1','vk1','$ACG','WEB','AD','AD-202',now()+interval '90 days');"

# 어느 광고인지 모르면 결국 아무에게나 붙습니다.
blocked "BG-02 소재 없는 광고 귀속 차단" \
  "INSERT INTO attribution_events(code,visitor_key,account_id,channel,source,expires_at)
   VALUES ('ATK-AD2','vk2','$ACG','WEB','AD',now()+interval '90 days');"

# 출처가 섞이면 누구 소개인지 답할 수 없습니다.
blocked "BG-03 소개에 광고정보 혼입 차단" \
  "INSERT INTO attribution_events(code,visitor_key,account_id,channel,source,
                                  ad_creative_code,expires_at)
   VALUES ('ATK-AD3','vk3','$ACG','WEB','INTRO','AD-202',now()+interval '90 days');"

# 누구에게 귀속되는지 모르는 건은 결국 분쟁이 됩니다.
eq "BG-04 광고주 없는 귀속 없음" \
  "SELECT count(*) FROM v_ad_attr_orphan;" "0"

# 켜는 것이 예외여야 합니다 — 기본이 켜져 있으면 모르는 사이 소개자가 손해를 봅니다.
eq "BG-05 귀속 기본값은 꺼짐" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='ad_placements' AND column_name='attribution_enabled'
      AND column_default = 'false';" "1"

echo
echo "== BH. 정산 무효 처리 ================================"
# 이용료를 지우는 것은 돈이 오가는 일입니다.
# **왜 지웠는지가 안 남으면 따질 근거가 없습니다.**

# voided_at 만 찍고 state 를 두면 감시 뷰가 못 잡던 구멍입니다.
# ★ 대상이 없으면 UPDATE 가 0행에 걸려 **성공으로 돌아옵니다**(함정 ⑤).
#   이용료가 실제로 있는 건을 골라야 시험이 성립합니다.
DVV=$($Q -c "SELECT delivery_id FROM lead_fees
             WHERE voided_at IS NULL ORDER BY incurred_at DESC LIMIT 1" 2>/dev/null | tr -d '[:space:]')

blocked "BH-01 규칙 없이 무효 차단" \
  "UPDATE lead_fees SET voided_at=now(), void_rule=NULL WHERE delivery_id='$DVV';" \
  "SELECT count(*) FROM lead_fees WHERE delivery_id='$DVV';"

eq "BH-02 규칙 없는 무효 없음" \
  "SELECT count(*) FROM v_lead_fee_void_without_rule;" "0"

# "무효인데 PENDING" 같은 행은 집계를 틀리게 만듭니다.
eq "BH-03 무효 시각과 상태 일치" \
  "SELECT count(*) FROM v_lead_fee_void_mismatch;" "0"

echo
echo "== BH. 제한업종 어휘 (INV-6) ========================="
# 이름 한 단어로만 찾으면 대부분 통과합니다.
# 올리는 사람은 "의료 서비스" 가 아니라 "성형외과" 라고 씁니다.
eq "BH-01 어휘 없는 제한업종 없음" \
  "SELECT count(*) FROM v_restrict_no_vocab;" "0"

# 실제로 쓰는 말로 막히는가 — 시드 데이터에서 뽑은 문장입니다.
eq "BH-02 도박 차단" \
  "SELECT (count(*)>0)::int FROM fn_classify_blocked('온라인 카지노 회원 모집');" "1"
eq "BH-03 대부 차단" \
  "SELECT (count(*)>0)::int FROM fn_classify_blocked('무담보 대출 즉시 대환 상담');" "1"
eq "BH-04 의료 유인 차단" \
  "SELECT (count(*)>0)::int FROM fn_classify_blocked('성형외과 시술 상담 소개');" "1"
eq "BH-05 성인·유흥 차단" \
  "SELECT (count(*)>0)::int FROM fn_classify_blocked('유흥주점 종업원 모집 대행');" "1"
eq "BH-06 다단계 차단" \
  "SELECT (count(*)>0)::int FROM fn_classify_blocked('네트워크 마케팅 방식 사업자 모집');" "1"

# 정상 등록까지 막으면 서비스가 안 돕니다.
eq "BH-07 정상 등록은 통과" \
  "SELECT count(*) FROM fn_classify_blocked('강남역 인근 1층 상가 33평 매매 급매');" "0"

echo
echo "== BI. 간주 모드 ====================================="
# 연동 전까지 "된 것으로 간주" 하고 화면을 만들었습니다.
# **오픈 전에 반드시 꺼야 합니다** — 켠 채로 열면 결제도 인증도
# 실제로는 안 되는데 된 줄 알고 운영합니다.
eq "BI-01 간주 항목이 설정으로 관리됨" \
  "SELECT (count(*) >= 2)::int FROM site_settings WHERE key LIKE 'assume.%';" "1"

# 간주 상태를 화면이 읽을 수 있어야 표시할 수 있습니다.
eq "BI-02 간주 설정이 공개 범위" \
  "SELECT count(*) FROM site_settings WHERE key LIKE 'assume.%' AND scope <> 'GLOBAL';" "0"

# 간주로 들어온 중개사 인증은 나중에 찾을 수 있어야 합니다.
eq "BI-03 간주 인증 추적 가능" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='broker_verifications' AND column_name='lookup_result';" "1"

echo
echo "== BJ. 광고 노출 기록 ================================"
# 기록이 안 되면 과금 근거가 비고, 광고주에게 청구할 수 없습니다.
# 화면이 슬롯을 빠뜨렸다고 매출이 사라지면 안 됩니다.
# 소재는 자기 슬롯을 압니다 — 화면에 다시 들려 보내라고 할 이유가 없습니다.
# 슬롯이 없으면 기록할 자리를 알 수 없어 **과금 근거가 비어 버립니다.**
#
# ★ 배정 전(DRAFT·BLOCKED) 소재는 슬롯이 없을 수 있습니다 — 안 나가니까요.
#   나가는 것(ACTIVE)만 봅니다.
eq "BJ-01 나가는 소재에 슬롯이 있음" \
  "SELECT count(*) FROM ad_placements WHERE status='ACTIVE' AND slot_code IS NULL;" "0"

# 과금 근거입니다.
blocked "BJ-03 노출 기록 수정 차단" \
  "UPDATE ad_events SET event_type='CLICK' WHERE event_type='IMPRESSION';"

echo
echo "== BK. 신고 접수 ====================================="
# 표와 규칙은 있는데 **접수할 길이 없었습니다** —
# 신고할 수 없는 신고 체계는 아무것도 막지 못합니다.
eq "BK-01 접수 경로가 있음" \
  "SELECT (count(*) > 0)::int FROM report_reasons;" "1"

# 자기 등록을 신고해 내리는 일을 막습니다.
LIR=$($Q -c "SELECT id FROM listings WHERE status='PUBLISHED' ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
OWR=$($Q -c "SELECT owner_account_id FROM listings WHERE id='$LIR'" 2>/dev/null | tr -d '[:space:]')
blocked "BK-02 자기 등록 신고 차단" \
  "INSERT INTO reports(target_type,target_id,reason_code,reporter_id,state)
   VALUES ('LISTING','$LIR','FAKE','$OWR','OPEN');"

# 근거 없는 기각이 기록에 남으면 안 됩니다.
$PSQL -c "INSERT INTO reports(target_type,target_id,reason_code,detail,reporter_id,state)
          SELECT 'LISTING','$LIR','FAKE','시험','$(echo $ACG)','OPEN'
           WHERE NOT EXISTS (SELECT 1 FROM reports WHERE target_id='$LIR');" >/dev/null 2>&1
blocked "BK-03 사유 없이 인정 차단" \
  "UPDATE reports SET state='UPHELD', resolution='' WHERE state='OPEN';"
blocked "BK-04 사유 없이 기각 차단" \
  "UPDATE reports SET state='DISMISSED', resolution='' WHERE state='OPEN';"

# 신고만으로 자동으로 내리면 여럿이 짜고 남의 등록을 내릴 수 있습니다.
eq "BK-05 신고로 자동 비공개 안 됨" \
  "SELECT count(*) FROM listings l
    WHERE l.status='SUSPENDED'
      AND NOT EXISTS (SELECT 1 FROM review_items ri
                       WHERE ri.target_id = l.id AND ri.status='APPROVED');" "0"

echo
echo "== BL. 구독 환불 (당일 한정) ========================="
# 구독을 켜면 그 순간부터 리드를 열람할 수 있습니다.
# 하루만 써도 남의 연락처를 다 보고 환불받는 일을 막습니다.
SBR=$($Q -c "SELECT id FROM subscriptions ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# ── D022 (v10.18) 환불은 「환불 요청」으로 접수하고, 결제사 취소를 확인한 뒤에만 완료됩니다 ──
# 전에는 구독 줄에 refunded_at 을 바로 적는 길을 시험했습니다. 그 길은 이제 조건과 무관하게 막히므로
# (결제사 취소가 확인된 환불 요청이 있어야 함) 「당일 · 미이용 · 사유」는 환불 요청을 넣는 길에서 봅니다.
# 아래는 모두 BEGIN … ROLLBACK 안에서 돕니다(err_is). 준비: 오늘 결제한 유료 구독 + 결제 완료 청구서.
BLS="UPDATE subscriptions SET plan_code='STANDARD', status='ACTIVE', cancel_at=NULL, refunded_at=NULL, refund_reason=NULL,
            is_promo=false, promo_ends_at=NULL, current_period_start=now(), current_period_end=now()+interval '30 days',
            request_views_used=0, codes_used_this_period=0 WHERE id='$SBR';
     INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status,payment_key,paid_at)
     SELECT id,current_period_start,current_period_end,49000,'PAID','pk_atk_bl',now() FROM subscriptions WHERE id='$SBR'"
BLI="INSERT INTO subscription_refunds(subscription_id,invoice_id,account_id,amount,reason)
     SELECT s.id,i.id,s.account_id,i.amount,'시험 환불' FROM subscriptions s
       JOIN subscription_invoices i ON i.subscription_id=s.id AND i.payment_key='pk_atk_bl' WHERE s.id='$SBR'"
BLOK="UPDATE subscription_refunds SET state='SUCCEEDED', canceled_amount=49000 WHERE subscription_id='$SBR'"

eqq "BL-00 (전제) 당일 결제 · 미이용이면 환불 요청이 접수됨" \
  "BEGIN; $BLS; $BLI; SELECT count(*) FROM subscription_refunds WHERE subscription_id='$SBR' AND state='REQUESTED'; ROLLBACK;" "1"

# 결제 당일이 아니면 환불할 수 없습니다.
err_is "BL-01 당일 아닌 환불 요청 차단" \
  "$BLS; UPDATE subscription_invoices SET paid_at = now() - interval '3 days' WHERE payment_key='pk_atk_bl'; $BLI" \
  "REFUND: 환불은 결제 당일"
# 당일이어도 열람했으면 안 됩니다 — 연락처는 되돌릴 수 없습니다.
err_is "BL-02 이용 후 환불 요청 차단" \
  "$BLS; UPDATE subscriptions SET request_views_used = 2 WHERE id='$SBR'; $BLI" "REFUND: 이미 이용"
# 사유 없는 환불은 기록에 남으면 안 됩니다.
err_is "BL-03 사유 없는 환불 요청 차단" \
  "$BLS; INSERT INTO subscription_refunds(subscription_id,invoice_id,account_id,amount,reason)
         SELECT s.id,i.id,s.account_id,i.amount,'  ' FROM subscriptions s
           JOIN subscription_invoices i ON i.subscription_id=s.id AND i.payment_key='pk_atk_bl' WHERE s.id='$SBR'" \
  "subscription_refunds_reason_check"

# 돈이 돌아가지 않았는데 「환불 완료」가 되면 안 됩니다.
err_is "BL-05 결제사 취소 확인 없이 구독을 환불로 적기 차단" \
  "$BLS; UPDATE subscriptions SET refunded_at=now(), refund_reason='직접 적기', status='CANCELLED' WHERE id='$SBR'" \
  "REFUND: 결제사 취소가 확인된 환불 요청이 없습니다"
err_is "BL-06 환불 요청만 있고 취소 미확인 — 구독을 환불로 적기 차단" \
  "$BLS; $BLI; UPDATE subscriptions SET refunded_at=now(), refund_reason='직접 적기', status='CANCELLED' WHERE id='$SBR'" \
  "REFUND: 결제사 취소가 확인된 환불 요청이 없습니다"
err_is "BL-07 결제사 취소 확인 없이 청구서를 환불로 바꾸기 차단" \
  "$BLS; $BLI; UPDATE subscription_invoices SET status='REFUNDED' WHERE payment_key='pk_atk_bl'" \
  "BILLING: 결제사 취소가 확인된 환불 요청이 없습니다"
err_is "BL-08 환불 요청을 처음부터 완료 상태로 넣기 차단" \
  "$BLS; INSERT INTO subscription_refunds(subscription_id,invoice_id,account_id,amount,reason,state,canceled_amount)
         SELECT s.id,i.id,s.account_id,i.amount,'시험','SUCCEEDED',i.amount FROM subscriptions s
           JOIN subscription_invoices i ON i.subscription_id=s.id AND i.payment_key='pk_atk_bl' WHERE s.id='$SBR'" \
  "REFUND: 환불 요청은 접수"
err_is "BL-09 취소된 금액이 다른데 완료로 적기 차단" \
  "$BLS; $BLI; UPDATE subscription_refunds SET state='SUCCEEDED', canceled_amount=100 WHERE subscription_id='$SBR'" \
  "REFUND: 결제사가 취소한 금액"
err_is "BL-10 환불 금액 부풀리기 차단" \
  "$BLS; INSERT INTO subscription_refunds(subscription_id,invoice_id,account_id,amount,reason)
         SELECT s.id,i.id,s.account_id,i.amount+1000,'시험' FROM subscriptions s
           JOIN subscription_invoices i ON i.subscription_id=s.id AND i.payment_key='pk_atk_bl' WHERE s.id='$SBR'" \
  "REFUND: 환불 금액은 결제 금액과 같아야"
err_is "BL-11 남의 구독으로 환불 요청 차단" \
  "$BLS; INSERT INTO subscription_refunds(subscription_id,invoice_id,account_id,amount,reason)
         SELECT s.id,i.id,(SELECT a.id FROM accounts a WHERE a.id <> s.account_id ORDER BY a.id LIMIT 1),i.amount,'시험' FROM subscriptions s
           JOIN subscription_invoices i ON i.subscription_id=s.id AND i.payment_key='pk_atk_bl' WHERE s.id='$SBR'" \
  "REFUND: 본인의 구독이 아닙니다"
# 같은 환불이 두 번 접수되면 결제사 취소도 두 번 나갑니다.
err_is "BL-12 같은 결제에 환불 요청 두 번 차단" \
  "$BLS; $BLI; $BLI" "uq_sub_refund_live"
err_is "BL-13 끝난 환불 요청의 상태 되돌리기 차단" \
  "$BLS; $BLI; $BLOK; UPDATE subscription_refunds SET state='UNKNOWN' WHERE subscription_id='$SBR'" \
  "REFUND: 끝난 환불 요청"
err_is "BL-14 환불 요청 기록 삭제 차단" \
  "$BLS; $BLI; DELETE FROM subscription_refunds WHERE subscription_id='$SBR'" \
  "REFUND: 환불 요청 기록은 지울 수 없습니다"
# 환불을 걸어 두고 그 사이에 쓰거나 다음 달을 청구하면 안 됩니다.
err_is "BL-15 환불 처리 중 유료 이용(열람) 차단" \
  "$BLS; $BLI; UPDATE subscriptions SET request_views_used = request_views_used + 1 WHERE id='$SBR'" \
  "REFUND: 환불 처리 중인 구독"
err_is "BL-16 환불 처리 중 다음 기간 청구 차단" \
  "$BLS; $BLI; INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status)
               SELECT id,current_period_end,current_period_end+interval '30 days',49000,'PENDING' FROM subscriptions WHERE id='$SBR'" \
  "BILLING: 환불 처리 중인 구독"
err_is "BL-17 환불된 청구를 결제 완료로 되돌리기 차단" \
  "$BLS; $BLI; $BLOK; UPDATE subscription_invoices SET status='REFUNDED' WHERE payment_key='pk_atk_bl';
   UPDATE subscription_invoices SET status='PAID' WHERE payment_key='pk_atk_bl'" \
  "BILLING: 환불된 청구"
# 정상 흐름은 통과해야 합니다 — 막기만 하면 환불이 영영 안 됩니다.
eqq "BL-18 접수 → 취소 확인 → 청구서 · 구독이 함께 환불로 (정상 흐름)" \
  "BEGIN; $BLS; $BLI; $BLOK; UPDATE subscription_invoices SET status='REFUNDED' WHERE payment_key='pk_atk_bl';
   UPDATE subscriptions SET refunded_at=now(), refund_reason='시험 환불', status='CANCELLED' WHERE id='$SBR';
   SELECT (SELECT status FROM subscription_invoices WHERE payment_key='pk_atk_bl') || '/' || (SELECT status FROM subscriptions WHERE id='$SBR'); ROLLBACK;" \
  "REFUNDED/CANCELLED"

# 조건을 벗어난 환불이 남아 있으면 같은 요구가 계속 들어옵니다.
eq "BL-04 환불 위반 없음" \
  "SELECT count(*) FROM v_refund_violation;" "0"

echo
echo "== BM. 이벤트 ========================================"
# 끝난 이벤트가 걸려 있으면 서비스가 관리되지 않는 것으로 보입니다.
EVA=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# 혜택 없는 이벤트는 이벤트가 아닙니다.
blocked "BM-01 혜택 없이 발행 차단" \
  "INSERT INTO events(code,title,body,benefit,starts_at,ends_at,status,created_by)
   VALUES ('ATK-E1','시험','본문','',now(),now()+interval '7 days','PUBLISHED','$EVA');"

# 줄 수 있는 만큼만 받아야 나중에 못 준다는 말을 안 하게 됩니다.
blocked "BM-02 인원 없는 참여형 차단" \
  "INSERT INTO events(code,title,body,benefit,join_type,starts_at,ends_at,status,created_by)
   VALUES ('ATK-E2','시험','본문','쿠폰','CLICK',now(),now()+interval '7 days','PUBLISHED','$EVA');"

# "잠깐만 다시 열자" 가 제일 위험합니다.
blocked "BM-03 끝난 이벤트 재발행 차단" \
  "INSERT INTO events(code,title,body,benefit,starts_at,ends_at,status,created_by)
   VALUES ('ATK-E3','시험','본문','쿠폰',now()-interval '30 days',now()-interval '1 day','PUBLISHED','$EVA');"

# 참여 기록은 지급 근거입니다.
#
# ★ 지울 행이 없으면 트리거가 돌지 않아 "안전" 으로 보고됩니다(함정 ⑤).
#   시험이 대상을 만들고 시작합니다.
$PSQL -c "INSERT INTO events(code,title,body,benefit,join_type,max_joins,
                             starts_at,ends_at,status,created_by)
          VALUES ('ATK-EV','시험 이벤트','본문','시험 혜택','CLICK',10,
                  now()-interval '1 hour', now()+interval '7 days','PUBLISHED','$EVA')
          ON CONFLICT (code) DO NOTHING;
          INSERT INTO event_joins(event_id, account_id)
          SELECT e.id, '$EVA' FROM events e WHERE e.code='ATK-EV'
          ON CONFLICT DO NOTHING;" >/dev/null 2>&1
blocked "BM-04 참여 기록 삭제 차단" \
  "DELETE FROM event_joins;"

# 배치가 내리지 않으면 끝난 것이 계속 보입니다.
eq "BM-05 닫아야 할 이벤트 없음" \
  "SELECT count(*) FROM v_events_to_close;" "0"

echo
echo "== BN. 한글 검색 ====================================="
# pg_trgm 은 로케일이 C 이면 한글을 쪼개지 못해 **0건**을 냅니다.
# 785건이 있는데 0건이 나왔고, 1만 건을 넣고서야 드러났습니다.
# 있는데 안 나오는 것은 **없는 것보다 나쁩니다** —
# 이용자는 매물이 없다고 믿고 떠납니다.
eq "BN-01 한글 검색 함수가 있음" \
  "SELECT count(*) FROM pg_proc WHERE proname='fn_search_match';" "1"

# 코드가 trgm 으로 되돌아가면 검색이 조용히 0건이 됩니다.
eq "BN-02 검색이 trgm 에 기대지 않음" \
  "SELECT (prosrc LIKE '%position%')::int FROM pg_proc WHERE proname='fn_search_match';" "1"

# 두 글자 미만으로 찾으면 전부 걸립니다.
eq "BN-03 한 글자 검색은 무시" \
  "SELECT fn_search_match('강남 상가','본문','가')::int;" "1"

# 여러 낱말은 전부 들어야 합니다 — 하나만 들어도 나오면 쓸모없습니다.
eq "BN-04 여러 낱말은 AND" \
  "SELECT fn_search_match('강남 상가 매매','본문','강남 공장')::int;" "0"

echo
echo "== BO. AI 판정 이력 =================================="
# 성향을 해지해도 "그때 왜 그렇게 나왔나" 는 답할 수 있어야 합니다.
$PSQL -c "INSERT INTO ai_decisions(kind, account_id, result, rule_version)
          VALUES ('CLS','$ACG','{\"t\":1}','atk')
          ON CONFLICT DO NOTHING;" >/dev/null 2>&1

blocked "BO-01 판정 이력 수정 차단" \
  "UPDATE ai_decisions SET result='{}' WHERE rule_version='atk';"
blocked "BO-02 판정 이력 삭제 차단" \
  "DELETE FROM ai_decisions WHERE rule_version='atk';"

# 판본이 없으면 "그때 어떤 어휘집이었나" 를 알 수 없습니다.
eq "BO-03 판정에 판본이 남음" \
  "SELECT count(*) FROM ai_decisions WHERE rule_version IS NULL;" "0"

# 원문을 남기면 개인정보가 이력표에 쌓입니다.
eq "BO-04 입력 원문을 안 남김" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='ai_decisions' AND column_name IN ('input_text','raw_text');" "0"

# 최초 등록 시각은 재진단해도 바뀌면 안 됩니다 — 동의 시점의 근거입니다.
eq "BO-05 성향 최초시각 컬럼 있음" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='member_ad_profiles' AND column_name='registered_at';" "1"

echo
echo "== BP. 제한업종 연결 (INV-H3b) ======================="
# 트리거는 categories.restricted_code 를 보고 판정합니다.
# **연결이 없으면 그냥 통과합니다** — 29개 업종 중 1개만 연결돼 있어
# 제한업종 방어가 사실상 돌지 않았습니다.
eq "BP-01 제한업종에 업종이 연결됨" \
  "SELECT count(*) FROM v_restricted_unlinked;" "0"

HB=$($Q -c "SELECT account_id FROM businesses WHERE verified_at IS NOT NULL
             ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# 건강몰은 판매와 광고가 모두 가능합니다.
# 다만 의약품·의료서비스는 **법이 막습니다**(약사법 44조 · 의료법 27조).
eq "BP-02 건강몰 판매불가 품목 없음" \
  "SELECT count(*) FROM v_hlt_sale_violation;" "0"

# 의료기기는 심의필 번호가 있으면 팔 수 있습니다(GATED).
eq "BP-02a 의료기기는 GATED" \
  "SELECT count(*) FROM restricted_industries
    WHERE gwan_code='HLT' AND code='MEDDEV' AND mode='GATED';" "1"

# 심의 없는 의료기기 광고는 의료기기법 24조 위반입니다.
eq "BP-02b 심의번호 없는 노출 없음" \
  "SELECT count(*) FROM v_gated_no_review;" "0"

# "나중에 받겠다" 를 허용하면 심의 없는 광고가 그대로 나갑니다.
blocked "BP-02c 심의번호 없이 의료기기 등록 차단" \
  "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,
                        desired_fee,fee_bearer,status)
   SELECT 'HLT', c.id, '$HB', '시험 의료기기', '본문입니다 충분히 길게 적습니다.',
          1000000, 'SELLER', 'IN_REVIEW'
     FROM categories c WHERE c.gwan_code='HLT' AND c.code='HLT_MEDDEV';"

# 의약품은 약국 개설자만 팝니다(약사법 44조) — 심의번호가 있어도 안 됩니다.
HP=$($Q -c "SELECT id FROM categories WHERE gwan_code='HLT' AND code='HLT_PHARM'" 2>/dev/null | tr -d '[:space:]')
blocked "BP-03 건강몰 의약품 등록 차단" \
  "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,
                        desired_fee,fee_bearer,status)
   VALUES ('HLT','$HP','$HB','시험','본문입니다 충분히 길게 적습니다.',
           1000000,'SELLER','IN_REVIEW');"

# 의료기기는 심의필 번호가 있으면 **팔 수 있습니다** — 형식은 봅니다.
HM=$($Q -c "SELECT id FROM categories WHERE gwan_code='HLT' AND code='HLT_MEDDEV'" 2>/dev/null | tr -d '[:space:]')
blocked "BP-04 잘못된 심의번호 차단" \
  "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,
                        desired_fee,fee_bearer,status,review_no)
   VALUES ('HLT','$HM','$HB','시험','본문입니다 충분히 길게 적습니다.',
           1000000,'SELLER','IN_REVIEW','받는 중');"

# 직업소개에 해당하는 업종은 승인할 수 없습니다(A-14).
eq "BP-05 직업소개 업종은 미승인" \
  "SELECT count(*) FROM categories
    WHERE labor_law_flag='APPLICABLE' AND status='APPROVED';" "0"

echo
echo "== BQ. 분류 연결 ====================================="
# 분류가 실제 업종에 연결되지 않으면, 분류해도 **어느 업종을 고르라는
# 것인지 화면이 알 수 없습니다.** 9건이 그 상태였는데 볼 화면이
# 없어 아무도 몰랐습니다.
eq "BQ-01 분류가 업종에 연결됨" \
  "SELECT count(*) FROM v_classify_unlinked;" "0"

# 같은 말이 여러 분류에 걸리면 어느 쪽으로 갈지 정해지지 않습니다.
eq "BQ-02 어휘 충돌 없음" \
  "SELECT count(*) FROM v_classify_vocab_conflicts;" "0"

# AI 는 본체와 같은 DB 에 둡니다 — 판정 재료가 본체 데이터입니다.
eq "BQ-03 제한업종 어휘가 살아 있음" \
  "SELECT (count(*) >= 60)::int FROM restrict_vocab;" "1"

echo
echo "== BR. 약관 분리 ====================================="
# 위탁과 제3자 제공은 성격이 다릅니다.
#   위탁  = 우리를 대신해 처리 (결제사 · 클라우드) → 고지만
#   제3자 = 거래 상대방 (다른 회원)                → 동의 필요
#
# 섞으면 **회원 간 전달에 동의를 안 받게 되고**, 나중에 제3자 제공으로
# 판단되면 그때까지 연결된 전부가 무동의 제공이 됩니다.
eq "BR-01 위탁 고지가 발행됨" \
  "SELECT count(*) FROM terms WHERE code='OUTSOURCE' AND status='PUBLISHED';" "1"

# 위탁은 동의 사항이 아닙니다 — 필수 동의로 걸면 거부할 수 있는 것처럼
# 보이지만 거부하면 서비스가 안 됩니다.
eq "BR-02 위탁은 동의 대상 아님" \
  "SELECT count(*) FROM terms WHERE code='OUTSOURCE' AND is_required;" "0"

# 회원 간 전달은 **반드시 동의**를 받아야 합니다.
eq "BR-03 제3자 제공은 필수 동의" \
  "SELECT count(*) FROM terms
    WHERE code='THIRDPARTY' AND is_required AND status='PUBLISHED';" "1"

# 위치기반은 폐기했습니다(2026-09-16) — 단말기 위치를 수집하지 않고
# 주소를 직접 입력받을 뿐이라 해당하지 않습니다.
#
# 없는 서비스의 약관을 두면 **"위치기반서비스를 한다" 고 선언하는 꼴**이라
# 신고 의무가 따라붙습니다.
eq "BR-04 위치기반은 미발행" \
  "SELECT count(*) FROM terms WHERE code='LOCATION' AND status='PUBLISHED';" "0"

# ★ 좌표 컬럼이 생기면 **위치정보를 다루기 시작한 것**입니다.
#   "내 주변 보기" 는 이용자가 가장 먼저 요청할 기능이라,
#   컬럼 하나 추가하는 것으로 조용히 넘어가지 않게 잡습니다.
eq "BR-05 좌표 컬럼 없음" \
  "SELECT count(*) FROM v_location_columns;" "0"

echo
echo "== BS. 감사 이상 징후 ================================"
# 기록이 남는 것과 이상을 아는 것은 다릅니다.
# **새벽에 한 사람이 개인정보 50건을 열어도 아무 일도 안 일어났습니다.**
eq "BS-01 이상 판정 기준이 있음" \
  "SELECT (count(*) >= 5)::int FROM audit_thresholds WHERE is_active;" "1"

# 기준을 코드에 박으면 운영이 못 고칩니다.
eq "BS-02 기준을 DB 에서 조절" \
  "SELECT count(*) FROM audit_thresholds WHERE threshold <= 0 OR window_hrs <= 0;" "0"

# 감사 기록은 고쳐쓸 수 없어야 합니다.
eq "BS-03 감사 기록 보호 트리거" \
  "SELECT (count(*) >= 2)::int FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'audit' AND NOT t.tgisinternal;" "1"

# 열람에 이유가 없으면 나중에 설명할 수 없습니다.
eq "BS-04 이유 없는 열람 없음" \
  "SELECT count(*) FROM v_audit_no_reason;" "0"

# 지금은 이상이 없어야 합니다.
eq "BS-05 이상 징후 없음" \
  "SELECT count(*) FROM v_audit_anomalies;" "0"

echo
echo "== BT. 수금 계좌 ====================================="
# 이 계좌는 **우리가 받을 돈**만 들어옵니다 — 구독료 · 리드비 · 광고비.
# 거래 대금이 들어오면 **자금 수탁**이 되어 전자금융거래법 등록
# 대상입니다(미등록 3년 이하 · 2천만원 이하). INV-11 이 그것을 막습니다.
eq "BT-01 수금 계좌 설정이 있음" \
  "SELECT count(*) FROM site_settings WHERE key LIKE 'company.bank%';" "3"

# 오픈 전에 채워야 합니다 — 비면 무통장 입금을 못 받습니다.
eq "BT-02 계좌가 오픈 필수 항목" \
  "SELECT count(*) FROM site_settings
    WHERE key LIKE 'company.bank%' AND NOT is_required_for_open;" "0"

# ★ 계좌는 오픈 전까지 비어 있는 것이 정상이라, 시험이 직접 채웁니다.
#   빈 상태로는 형식 검사도 이력도 확인할 수 없습니다.
$PSQL -c "UPDATE site_settings SET value='국민은행', updated_by='$ACG'
           WHERE key='company.bank_name';
          UPDATE site_settings SET value='123456-01-234567', updated_by='$ACG'
           WHERE key='company.bank_account';
          UPDATE site_settings SET value='주식회사 소개뱅크', updated_by='$ACG'
           WHERE key='company.bank_holder';" >/dev/null 2>&1

# 형식이 틀린 계좌번호는 입금이 안 들어옵니다.
blocked "BT-03 형식 틀린 계좌 차단" \
  "UPDATE site_settings SET value='국민' WHERE key='company.bank_account';"

# 계좌 변경은 **돈이 어디로 가는지가 바뀌는 일**입니다.
eq "BT-04 변경 이력이 남음" \
  "SELECT (count(*) > 0)::int FROM company_account_changes;" "1"

blocked "BT-05 계좌 이력 수정 차단" \
  "UPDATE company_account_changes SET after_val='x';"
blocked "BT-06 계좌 이력 삭제 차단" \
  "DELETE FROM company_account_changes;"

# ★ 가상 계좌로 열면 **입금이 아무 데도 안 들어옵니다.**
#   값만 채우고 끝내면 오픈 점검이 통과해 버립니다.
eq "BT-07 간주 계좌가 표시됨" \
  "SELECT count(*) FROM site_settings WHERE key='assume.bank';" "1"

# 실계좌를 넣으면 간주가 자동으로 내려가야 합니다 —
# 사람이 두 곳을 고치게 하면 한 곳을 빠뜨립니다.
eq "BT-08 간주 자동 해제 방어" \
  "SELECT (prosrc LIKE '%assume.bank%')::int
     FROM pg_proc WHERE proname='fn_bank_assume_off';" "1"

# ★ 채워 둔 것을 되돌립니다 — 그대로 두면 **오픈 점검이 통과해 버려**
#   실제로 계좌를 안 넣고도 열 수 있는 것처럼 보입니다.
$PSQL -c "SET session_replication_role=replica;
          UPDATE site_settings SET value='시험용가상은행' WHERE key='company.bank_name';
          UPDATE site_settings SET value='999999-99-999999' WHERE key='company.bank_account';
          UPDATE site_settings SET value='주식회사 소개뱅크 시험용' WHERE key='company.bank_holder';
          UPDATE site_settings SET value='on' WHERE key='assume.bank';
          DELETE FROM company_account_changes
            WHERE changed_at >= now() - interval '1 hour';
          SET session_replication_role=origin;" >/dev/null 2>&1

echo
echo "== BU. 광고 과금 ====================================="
# 광고비는 **우리가 받는 돈**이고, 소개비는 당사자끼리 주고받는
# 돈입니다(INV-9R · INV-11). 정산 표를 같이 쓰면 언젠가 섞입니다.
eq "BU-01 광고주 표가 있음" \
  "SELECT (count(*) >= 1)::int FROM information_schema.tables
    WHERE table_name='advertisers';" "1"

# 예약이 실재하지 않는 광고주를 가리키면 "누가 냈나" 를 답할 수 없습니다.
# 청구는 실재하는 광고주를 가리켜야 합니다 — "누가 냈나" 를 답하려면.
eq "BU-02 청구가 광고주를 가리킴" \
  "SELECT count(*) FROM pg_constraint
    WHERE conrelid='ad_invoices'::regclass AND contype='f'
      AND confrelid='advertisers'::regclass;" "1"

# 합계가 틀린 청구서는 그대로 나갑니다.
ADV=$($Q -c "SELECT id FROM advertisers LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "BU-03 합계 안 맞는 청구 차단" \
  "INSERT INTO ad_invoices(invoice_no,advertiser_id,period_from,period_to,
                           amount,vat,total,due_date)
   VALUES ('ATK-1','$ADV','2026-10-01','2026-10-31',1000000,100000,999,'2026-10-15');"

# ★ 지울 행이 없으면 트리거가 돌지 않아 "안전" 으로 보고됩니다(함정 ⑤).
#   시험이 대상을 만들고 시작합니다.
$PSQL -c "INSERT INTO advertisers(code,name) VALUES ('ATK-PAY','시험 광고주2')
          ON CONFLICT (code) DO NOTHING;
          INSERT INTO ad_invoices(invoice_no, advertiser_id, period_from, period_to,
                                  amount, vat, total, due_date)
          SELECT 'ATK-INV-1', id, '2026-10-01','2026-10-31', 100000, 10000, 110000, '2026-10-15'
            FROM advertisers WHERE code='ATK-PAY'
          ON CONFLICT (invoice_no) DO NOTHING;
          INSERT INTO ad_payments(invoice_id, amount)
          SELECT id, 50000 FROM ad_invoices WHERE invoice_no='ATK-INV-1';" >/dev/null 2>&1

# 돈이 들어온 기록은 고칠 수 없어야 합니다.
blocked "BU-04 입금 기록 수정 차단" \
  "UPDATE ad_payments SET amount = 1;"
blocked "BU-05 입금 기록 삭제 차단" \
  "DELETE FROM ad_payments;"

# 받지 못한 채 노출만 계속하면 손해가 커집니다.
eq "BU-06 연체인데 나가는 광고 없음" \
  "SELECT count(*) FROM v_ad_overdue_running;" "0"

# 시험이 만든 것을 치웁니다 — 그대로 두면 미수금이 있는 것처럼 보입니다.
$PSQL -c "SET session_replication_role=replica;
          DELETE FROM ad_payments WHERE invoice_id IN
            (SELECT id FROM ad_invoices WHERE invoice_no LIKE 'ATK-%');
          DELETE FROM ad_invoices WHERE invoice_no LIKE 'ATK-%';
          SET session_replication_role=origin;" >/dev/null 2>&1

echo
echo "== BV. 수집 게이트 (INV-C1~7) ========================"
# 남의 사이트에서 데이터를 가져오는 일이라, 잘못하면 **저작권 침해이거나
# 업무방해**가 됩니다.
$PSQL -c "INSERT INTO collect_sources(code,name,base_url)
          VALUES ('ATK-SRC','시험 출처','https://example.com')
          ON CONFLICT (code) DO NOTHING;" >/dev/null 2>&1

# INV-C7 — 법무 회신 전에는 READY 로 못 올립니다.
blocked "BV-01 게이트 없이 READY 차단" \
  "UPDATE collect_sources SET state='READY' WHERE code='ATK-SRC';"

# INV-C4 — 초 간격 · 동시 1. 빠르게 두드리면 업무방해입니다.
blocked "BV-02 1초 미만 간격 차단" \
  "UPDATE collect_sources SET interval_ms=100 WHERE code='ATK-SRC';"
blocked "BV-03 동시 실행 늘리기 차단" \
  "UPDATE collect_sources SET concurrency=5 WHERE code='ATK-SRC';"

# INV-C3 — 사진 · 리뷰 본문 · HTML 원문은 **담을 컬럼이 없습니다.**
eq "BV-04 저작물 컬럼 없음" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='collect_items'
      AND column_name ~ 'image|photo|html|review|thumb';" "0"

# INV-C6 — 출처 없는 데이터는 못 들어옵니다.
eq "BV-05 출처가 필수" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='collect_items' AND column_name='fetch_id'
      AND is_nullable='NO';" "1"

# INV-C5 — 차단을 풀면 게이트를 다시 통과해야 합니다.
$PSQL -c "UPDATE collect_sources SET state='BLOCKED' WHERE code='ATK-SRC';" >/dev/null 2>&1
blocked "BV-06 차단에서 READY 직행 차단" \
  "UPDATE collect_sources SET state='READY' WHERE code='ATK-SRC';"

# 멈춘 수집을 그대로 두면 다음 실행이 막힙니다.
eq "BV-07 멈춘 수집 없음" \
  "SELECT count(*) FROM v_collect_stuck;" "0"

$PSQL -c "DELETE FROM collect_sources WHERE code='ATK-SRC';" >/dev/null 2>&1

echo
echo "== BW. 건강몰 직판 ==================================="
# ★ 관마다 지위가 다릅니다.
#     MNY · MAL · BIZ   통신판매**중개**업자 — 거래 당사자가 아닙니다
#     HLT               통신판매업자        — 우리가 파는 당사자입니다
#
#   섞이면 "중개라더니 왜 환불을 안 해주냐" 는 분쟁이 생기고, 그때
#   우리가 집니다.
eq "BW-01 건강몰만 직판" \
  "SELECT count(*) FROM gwans WHERE sale_mode='DIRECT' AND code <> 'HLT';" "0"

eq "BW-02 직판 고지가 있음" \
  "SELECT count(*) FROM v_direct_notice_missing;" "0"

# 직판은 건강몰만입니다.
eq "BW-03 다른 관 상품 없음" \
  "SELECT count(*) FROM v_hlt_wrong_gwan;" "0"

# 의약품은 약국 개설자만 팝니다(약사법 44조).
HPC=$($Q -c "SELECT id FROM categories WHERE gwan_code='HLT' AND code='HLT_PHARM'" 2>/dev/null | tr -d '[:space:]')
blocked "BW-04 의약품 판매 차단" \
  "INSERT INTO hlt_products(code,name,category_id,price,stock,status)
   VALUES ('ATK-P1','시험','$HPC',10000,10,'ON_SALE');"

# 의료기기는 심의필 번호가 있어야 팝니다(의료기기법 24조).
HMC=$($Q -c "SELECT id FROM categories WHERE gwan_code='HLT' AND code='HLT_MEDDEV'" 2>/dev/null | tr -d '[:space:]')
blocked "BW-05 심의번호 없는 기기 판매 차단" \
  "INSERT INTO hlt_products(code,name,category_id,price,stock,status)
   VALUES ('ATK-P2','시험 혈압계','$HMC',50000,5,'ON_SALE');"

# 청약철회는 법이 정한 최소치입니다 — 약관에 적어도 무효입니다.
blocked "BW-06 7일 미만 청약철회 차단" \
  "UPDATE withdrawal_rules SET days=3 WHERE code='FOOD_SEALED';"

# 거절에는 근거가 있어야 합니다 — 청약철회는 법이 준 권리입니다.
eq "BW-07 이유 없는 거절 방어" \
  "SELECT (prosrc LIKE '%이유를 적어야%')::int FROM pg_proc WHERE proname='fn_hlt_return_guard';" "1"

# 3영업일 안에 돌려줘야 합니다(전자상거래법 18조 2항).
eq "BW-08 환불 지연 감시" \
  "SELECT count(*) FROM v_hlt_refund_pending WHERE days_since > 3;" "0"

echo
echo "== BX. 장바구니 · 결제 · 배송 ========================"
# 장바구니는 **재고를 잡지 않습니다** — 담아 놓고 안 사는 사람 때문에
# 실제 살 사람이 못 사면 안 됩니다. 대신 담을 때 재고를 봅니다.
HPC=$($Q -c "SELECT id FROM hlt_products LIMIT 1" 2>/dev/null | tr -d '[:space:]')
HAC=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
if [ -n "$HPC" ]; then
  blocked "BX-01 재고 넘겨 담기 차단" \
    "INSERT INTO hlt_carts(account_id) VALUES ('$HAC') ON CONFLICT DO NOTHING;
     INSERT INTO hlt_cart_items(account_id,product_id,qty) VALUES ('$HAC','$HPC',999);"
else
  echo "  안전  BX-01 재고 넘겨 담기 차단 (상품 없음 — 건너뜀)"
fi

# 99개를 넘으면 도매라 따로 문의받는 편이 낫습니다.
eq "BX-02 수량 상한이 있음" \
  "SELECT count(*) FROM pg_constraint
    WHERE conname='hlt_cart_qty_check';" "1"

# 카드번호는 **어디에도** 남기지 않습니다 — 직판이어도 마찬가지입니다.
# PG 가 처리하고 우리는 거래번호만 받습니다.
eq "BX-03 카드번호 컬럼 없음" \
  "SELECT count(*) FROM v_card_columns;" "0"

# 대금을 받아도 되는 관은 직판뿐입니다.
eq "BX-03a 중개 관은 대금 수탁 불가" \
  "SELECT count(*) FROM gwans
    WHERE is_active AND sale_mode='BROKER' AND fn_may_hold_funds(code);" "0"

# 결제 후 3일 넘게 안 보낸 주문 — 약속이 영업일 1~3일입니다.
eq "BX-04 발송 지연 없음" \
  "SELECT count(*) FROM v_hlt_ship_overdue;" "0"

# 배송 완료일이 **청약철회 7일의 기준**입니다.
eq "BX-05 배송완료가 주문에 반영됨" \
  "SELECT (prosrc LIKE '%delivered_at%')::int
     FROM pg_proc WHERE proname='fn_hlt_ship_apply';" "1"

$PSQL -c "DELETE FROM hlt_cart_items WHERE qty > 99;" >/dev/null 2>&1

echo
echo "== BY. 정산 계좌 · 1원 인증 =========================="
# 계좌번호는 손으로 칩니다 — **한 자리만 틀려도 남의 계좌로 갑니다.**
# 예금주 이름만 대조하면 동명이인이 걸립니다.
PAC=$($Q -c "SELECT id FROM accounts ORDER BY id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# 인증 안 된 계좌로 지급이 나가면 사고입니다.
blocked "BY-01 미인증 계좌를 기본으로 차단" \
  "INSERT INTO payout_accounts(account_id,bank_name,holder_name,account_enc,is_default)
   VALUES ('$PAC','국민은행','시험','\\x00'::bytea,true);"

# 은행 코드 · 계좌번호 형식
# ★ 평문 컬럼이 없습니다 — 함수로만 넣습니다(D-04).
blocked "BY-02 잘못된 은행코드 차단" \
  "SELECT fn_payout_add('$PAC','4','국민은행','111111-11-111111','시험','C',true);"
blocked "BY-03 잘못된 계좌번호 차단" \
  "SELECT fn_payout_add('$PAC','004','국민은행','12','시험','C',true);"

# 찍어서 맞히는 것을 막습니다.
blocked "BY-04 시도 6회 차단" \
  "INSERT INTO payout_accounts(account_id,bank_name,holder_name,account_enc,verify_tries)
   VALUES ('$PAC','국민은행','시험','\\x00'::bytea,6);"

# 스텁으로 통과한 계좌로 돈이 나가면 안 됩니다.
eq "BY-05 스텁 통과 계좌 감시" \
  "SELECT (count(*) >= 0)::int FROM v_payout_stub;" "1"

$PSQL -c "DELETE FROM payout_accounts WHERE holder_name='시험';" >/dev/null 2>&1

echo
echo "== BZ. 약관 상태 =================================="
# ★ 위치기반 약관은 **폐기한 것**이라 ARCHIVED 가 정상입니다.
#   검정이 되돌리는 바람에 초안으로 되살아나 푸터에 링크가
#   다시 붙을 뻔했습니다. 없는 서비스의 약관을 두면 신고 의무가
#   따라붙습니다.
eq "BZ-01 위치기반 약관은 폐기 상태" \
  "SELECT count(*) FROM terms WHERE code='LOCATION' AND status='ARCHIVED';" "1"

eq "BZ-02 폐기 약관은 푸터에 없음" \
  "SELECT count(*) FROM footer_links f
    WHERE f.is_active
      AND EXISTS (SELECT 1 FROM terms t
                   WHERE t.code = f.target_ref AND t.status = 'ARCHIVED');" "0"

echo
echo "== BZ. 직무 분리 (A-08) =============================="
# ★ 부정 판정을 만드는 사람과 돈을 내보내는 사람이 같으면
#   **사고가 나도 되돌릴 근거가 없습니다.**
eq "BZ-01 승인·지급 겸임 없음" \
  "SELECT count(*) FROM v_duty_conflict;" "0"

# 한 사람에게 둘 다 주려 하면 막아야 합니다.
DTA=$($Q -c "SELECT id FROM accounts WHERE email='ops@t.local'" 2>/dev/null | tr -d '[:space:]')
if [ -n "$DTA" ]; then
  blocked "BZ-02 ADMIN 에게 PAYOUT 추가 차단" \
    "INSERT INTO account_roles(account_id,role,granted_by) VALUES ('$DTA','PAYOUT','$DTA');"
else
  echo "  안전  BZ-02 ADMIN 에게 PAYOUT 추가 차단 (시험 계정 없음 — 건너뜀)"
fi

# 권한은 누가 줬는지 남아야 회수할 근거가 있습니다.
eq "BZ-03 권한 부여자 기록 컬럼" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='account_roles' AND column_name='granted_by';" "1"

# 내부 API 는 사람 토큰이 없어 키로 막습니다.
eq "BZ-04 내부 API 키 설정됨" \
  "SELECT count(*) FROM site_settings WHERE key='internal.api_key';" "1"

echo
echo "== BZ. 위치기반 약관 폐기 ============================"
# ★ 단말기 위치를 수집하지 않아 위치정보법 대상이 아닙니다(2026-09-18 확정).
#   **없는 서비스의 약관을 두면 신고 의무가 따라붙습니다** —
#   위치기반서비스사업자 신고와 매년 실적 보고를 해야 합니다.
eq "BZ-01 폐기 판단이 기록됨" \
  "SELECT count(*) FROM site_settings WHERE key='legal.location_waived';" "1"

eq "BZ-02 폐기 근거가 적혀 있음" \
  "SELECT (length(value) >= 10)::int FROM site_settings
    WHERE key='legal.location_waived_note';" "1"

# 좌표를 담기 시작하면 판단이 무효가 됩니다 — "내 주변" 을 넣는 순간입니다.
eq "BZ-03 좌표 컬럼 없음" \
  "SELECT count(*) FROM v_location_waiver_broken;" "0"

# 약관은 폐기 상태로 남아 있어야 합니다.
eq "BZ-04 위치 약관 ARCHIVED" \
  "SELECT count(*) FROM terms WHERE code='LOCATION' AND status='PUBLISHED';" "0"

echo
echo "== CA. 건강몰 판매자 · 판매수수료 ===================="
# ★ 소개비와 다른 돈입니다.
#     소개형 4관   소개비 — 우리 몫 0원 (INV-9)
#     건강몰       판매수수료 — 우리가 뗍니다
#   그래서 공제 컬럼 예외는 **hlt_ 접두어만** 둡니다.
eq "CA-01 소개형 4관은 공제 0 유지" \
  "SELECT count(*) FROM v_broker_commission_leak;" "0"

# 직판은 하나뿐이어야 합니다 — 여럿이면 어느 것이 우리 것인지 모릅니다.
eq "CA-02 직판 판매자 1곳" \
  "SELECT count(*) FROM hlt_sellers WHERE type='DIRECT';" "1"

# 한 주문에 여러 판매자가 섞이면 부분 취소가 지옥이 됩니다.
eq "CA-03 주문 분리 방어" \
  "SELECT (prosrc LIKE '%여러 판매자를 담을 수 없습니다%')::int
     FROM pg_proc WHERE proname='fn_hlt_order_seller_guard';" "1"

# 요율만 두고 재계산하면 요율을 바꾼 순간 지난 정산이 달라집니다.
eq "CA-04 주문에 요율·금액 박힘" \
  "SELECT count(*) FROM information_schema.columns
    WHERE table_name='hlt_order_items'
      AND column_name IN ('commission_rate','commission_amount');" "2"

# ★ 지울 행이 없으면 트리거가 돌지 않아 "안전" 으로 보고됩니다(함정 ⑤).
#   시험이 대상을 만들고 시작합니다.
$PSQL -c "INSERT INTO hlt_commission_changes(scope,target,after_rate)
          VALUES ('CATEGORY','ATK-TEST',9.99);" >/dev/null 2>&1

# 돈이 얼마나 빠지는지가 바뀌는 일이라 기록이 남아야 합니다.
blocked "CA-05 요율 이력 수정 차단" \
  "UPDATE hlt_commission_changes SET after_rate = 99;"
blocked "CA-06 요율 이력 삭제 차단" \
  "DELETE FROM hlt_commission_changes;"

# 시험이 만든 이력을 치웁니다 — 그대로 두면 "요율을 자주 바꾼다" 로 보입니다.
$PSQL -c "SET session_replication_role=replica;
          DELETE FROM hlt_commission_changes WHERE reason IS NULL
            AND changed_at > now() - interval '1 minute';
          SET session_replication_role=origin;" >/dev/null 2>&1

# 하위가맹점이 없으면 돈이 안 나갑니다 — PG 계약 뒤에 채웁니다.
# 시험이 만든 것을 치웁니다 — 이력은 못 지우니 session_replication_role 로.
$PSQL -c "SET session_replication_role=replica;
          DELETE FROM hlt_commission_changes WHERE target='ATK-TEST';
          SET session_replication_role=origin;" >/dev/null 2>&1

eq "CA-07 미지급 판매자 감시" \
  "SELECT (count(*) >= 0)::int FROM v_hlt_seller_no_submerchant;" "1"

# 이월은 막지 않되 보입니다.
eq "CA-08 큰 이월 감시" \
  "SELECT (count(*) >= 0)::int FROM v_hlt_carryover_large;" "1"

echo
echo "== CA. 건강몰 판매수수료 · 정산 ======================"
# ★ 판매수수료는 소개비와 **다른 돈**입니다.
#     소개비      소개형 4관 · 소개자가 받음 · 우리 몫 0원 (INV-9)
#     판매수수료  건강몰      · 우리가 받음 · 판매가의 N%
#   섞이면 "전액이라더니 왜 떼느냐" 는 분쟁이 납니다.

# 소개형 4관의 공제 0원은 그대로입니다 — hlt_ 만 예외입니다.
eq "CA-01 중개 관 공제 컬럼 없음" \
  "SELECT count(*) FROM v_inv9_violations;" "0"

eq "CA-02 중개 관은 수수료 불가" \
  "SELECT count(*) FROM v_broker_commission_leak;" "0"

# 요율은 소개뱅크가 정합니다 — 50% 를 넘으면 판매자가 밑집니다.
CAS=$($Q -c "SELECT id FROM hlt_sellers WHERE type='DIRECT' LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "CA-03 요율 50% 초과 차단" \
  "UPDATE hlt_sellers SET commission_rate = 60 WHERE id = '$CAS';"

# 소개자 몫이 수수료를 넘으면 우리가 밑지고 줍니다.
blocked "CA-04 소개자몫 > 수수료 차단" \
  "UPDATE hlt_commission_rates SET referral_pct = 99 WHERE category_code = 'HLT_FOOD';"

# ★ 지울 행이 없으면 트리거가 돌지 않아 "안전" 으로 보고됩니다(함정 ⑤).
#   시험이 대상을 만들고 시작합니다 — 요율을 한 번 바꾸면 이력이 남습니다.
$PSQL -c "UPDATE hlt_commission_rates SET rate = rate + 1 WHERE category_code = 'HLT_FOOD';
          UPDATE hlt_commission_rates SET rate = rate - 1 WHERE category_code = 'HLT_FOOD';" >/dev/null 2>&1

# 요율 변경은 **돈이 얼마나 빠지는지가 바뀌는 일**입니다.
blocked "CA-05 요율 이력 수정 차단" \
  "UPDATE hlt_commission_changes SET after_rate = 1;"
blocked "CA-06 요율 이력 삭제 차단" \
  "DELETE FROM hlt_commission_changes;"

# 한 주문에 판매자가 섞이면 부분 취소·반품이 지옥이 됩니다(INV-H9).
eq "CA-07 주문 분리 방어" \
  "SELECT (prosrc LIKE '%INV-H9%')::int FROM pg_proc WHERE proname='fn_hlt_one_seller';" "1"

# 정산은 주 단위입니다 — 다른 길이면 집계 기준이 흔들립니다.
eq "CA-08 정산 기간 7일 고정" \
  "SELECT count(*) FROM pg_constraint WHERE conname='hlt_settle_week_check';" "1"

# 음수는 지급이 아니라 이월입니다 — 계좌에서 빼 올 수 없습니다.
eq "CA-09 음수 지급 방어" \
  "SELECT (prosrc LIKE '%음수%')::int FROM pg_proc WHERE proname='fn_hlt_settle_guard';" "1"

# 보낼 곳이 없으면 지급할 수 없습니다.
eq "CA-10 지급 막힌 판매자 감시" \
  "SELECT (count(*) >= 0)::int FROM v_hlt_settle_blocked;" "1"

# 자격이 만료됐는데 팔고 있으면 판매자도 우리도 책임을 집니다(INV-H10).
eq "CA-11 자격 만료 판매 없음" \
  "SELECT count(*) FROM v_hlt_license_expired;" "0"

# 주 단위 정산이면 늦어도 2주 안에는 들어가야 합니다.
eq "CA-12 정산 누락 없음" \
  "SELECT count(*) FROM v_hlt_settle_missed;" "0"

# ★ 시험에서 드러났습니다 — DRAFT 에서 **바로 PAID 로 갔습니다.**
#   정산서는 판매자가 확인하고 이의를 낼 시간이 있어야 합니다.
CAN=$($Q -c "SELECT id FROM hlt_sellers LIMIT 1" 2>/dev/null | tr -d '[:space:]')
$PSQL -c "INSERT INTO hlt_settlements(seller_id,period_from,period_to,gross_amount,commission,net_amount,status)
          VALUES ('$CAN','2026-08-03','2026-08-10',100000,10000,90000,'DRAFT')
          ON CONFLICT DO NOTHING;" >/dev/null 2>&1

blocked "CA-13 확인 없이 지급 차단" \
  "UPDATE hlt_settlements SET status='PAID' WHERE period_from='2026-08-03';"

$PSQL -c "UPDATE hlt_settlements SET status='CONFIRMED' WHERE period_from='2026-08-03';" >/dev/null 2>&1
$PSQL -c "UPDATE hlt_settlements SET status='PAID', paid_by=(SELECT id FROM accounts LIMIT 1)
          WHERE period_from='2026-08-03';" >/dev/null 2>&1

# 지급한 것은 되돌릴 수 없습니다 — 이미 나간 돈입니다.
blocked "CA-14 지급 되돌리기 차단" \
  "UPDATE hlt_settlements SET status='DRAFT' WHERE period_from='2026-08-03';"

# 사고가 났을 때 누가 눌렀는지 알아야 합니다.
eq "CA-15 지급자 기록 있음" \
  "SELECT count(*) FROM v_hlt_paid_no_actor;" "0"

$PSQL -c "SET session_replication_role=replica;
          DELETE FROM hlt_settlements WHERE period_from='2026-08-03';
          SET session_replication_role=origin;" >/dev/null 2>&1

echo
echo "== CB. 표준계약서 · 전자계약 ========================="
# ★ 계약서를 당사자가 자유롭게 쓰면 **분쟁 때 판단 근거가 없습니다.**
#   소개비 귀속 · 성사 시점 · 해지 조건이 계약마다 달라집니다.
eq "CB-01 표준 양식이 등록됨" \
  "SELECT (count(*) >= 3)::int FROM contract_templates WHERE is_active;" "1"

eq "CB-02 자유 양식 계약 없음" \
  "SELECT count(*) FROM v_contract_no_template;" "0"

# 양식은 불변식과 같은 말을 해야 합니다 — 갈리면 어느 쪽이 맞는지 모릅니다.
eq "CB-03 소개 양식이 INV-9 를 담음" \
  "SELECT ('INV-9' = ANY(invariants))::int FROM contract_templates WHERE code='INTRO_STD';" "1"

eq "CB-04 건강몰 양식이 INV-H1 을 담음" \
  "SELECT ('INV-H1' = ANY(invariants))::int FROM contract_templates WHERE code='HLT_SELLER_STD';" "1"

# 발급된 계약이 실재하는 양식을 가리켜야 합니다.
eq "CB-05 양식 FK 가 걸림" \
  "SELECT count(*) FROM pg_constraint WHERE conname='deal_contracts_template_fk';" "1"

# 본문이 너무 짧으면 양식이라 할 수 없습니다.
blocked "CB-06 빈 양식 차단" \
  "INSERT INTO contract_templates(code,name,version,scope,body,effective_from)
   VALUES ('ATK-TPL','시험','1.0','INTRO','짧음','2026-10-01');"

# 스텁으로 서명된 계약은 **법적 효력이 없습니다.**
eq "CB-07 스텁 서명 계약 감시" \
  "SELECT count(*) FROM v_contract_stub;" "0"

# ★ 골격 4장 — **조항 존재는 확정**입니다. 빠지면 분쟁 때
#   "소개뱅크도 당사자 아니냐" 는 주장을 막을 근거가 없습니다.
eq "CB-08 비당사자 조항 있음" \
  "SELECT (body LIKE '%당사자가 아닙니다%')::int
     FROM contract_templates WHERE code='INTRO_STD';" "1"

# ★ B-06 확정(2026-09-18) — 전에는 **미확정 표시가 있어야** 정상이었습니다.
#   문구가 정해졌으니 이제 **없어야** 정상입니다. 남아 있으면
#   확정된 계약서에 "검토 대기" 라고 적어 내미는 셈입니다.
eq "CB-09 미확정 표시 없음" \
  "SELECT (body LIKE '%법무 검토 대기%')::int
     FROM contract_templates WHERE code='INTRO_STD';" "0"

# 조항을 개별 수정하면 **변호사법 109조**(비변호사의 법률사무)입니다.
eq "CB-10 편집 불가 고지 있음" \
  "SELECT (body LIKE '%고치실 수 없습니다%')::int
     FROM contract_templates WHERE code='INTRO_STD';" "1"

# 부동산은 A-07 회신 전까지 열 수 없습니다(공인중개사법 48조).
eq "CB-11 부동산 양식 잠김" \
  "SELECT count(*) FROM contract_templates
    WHERE code='REALTY_STD' AND is_active;" "0"

# 대금은 우리를 거치지 않습니다(INV-11).
eq "CB-12 플랫폼 비경유 명시" \
  "SELECT (body LIKE '%계좌를 거치지 않습니다%')::int
     FROM contract_templates WHERE code='INTRO_STD';" "1"

echo
echo "== CC. 마케팅 수신 동의 ============================="
# ★ 동의 없이 광고성 정보를 보내면 **정보통신망법 50조 위반**입니다
#   (과태료 3천만원 이하). 약관만 만들고 발송을 안 막으면 소용없습니다.
eq "CC-01 마케팅 약관 발행됨" \
  "SELECT count(*) FROM terms WHERE code='MARKETING' AND status='PUBLISHED';" "1"

# 선택 동의여야 합니다 — 필수로 두면 동의를 강제하는 것입니다.
eq "CC-02 선택 동의임" \
  "SELECT (NOT is_required)::int FROM terms WHERE code='MARKETING';" "1"

# 동의 없이 나간 광고성 알림.
eq "CC-03 동의 없는 발송 없음" \
  "SELECT count(*) FROM v_marketing_no_consent;" "0"

# 2년이 지나면 다시 여쭈어야 합니다.
eq "CC-04 오래된 동의 감시" \
  "SELECT (count(*) >= 0)::int FROM v_marketing_consent_stale;" "1"

# 계약 전에 켜 두면 발송 실패만 쌓입니다.
eq "CC-05 발송 스위치 존재" \
  "SELECT count(*) FROM site_settings WHERE key='marketing.send_enabled';" "1"

# 법이 정한 표기 — 없으면 약관이 있어도 위반입니다.
eq "CC-06 광고 표기 조항 있음" \
  "SELECT (body LIKE '%(광고)%')::int FROM terms WHERE code='MARKETING';" "1"
eq "CC-07 수신거부 방법 명시" \
  "SELECT (body LIKE '%수신거부%')::int FROM terms WHERE code='MARKETING';" "1"

echo
echo "== CC. 마케팅 수신 동의 =============================="
# ★ 동의 없이 광고를 보내면 **정보통신망법 50조 위반**입니다
#   (3천만원 이하 과태료). 계약만 하고 보낼 근거가 없으면 돈만 나갑니다.
eq "CC-01 마케팅 약관 발행됨" \
  "SELECT count(*) FROM terms WHERE code='MARKETING' AND status='PUBLISHED';" "1"

# 야간(21~08시)은 **별도 동의**가 필요합니다(50조 3항).
#   하나로 묶으면 야간 동의 없이 밤에 보내게 됩니다.
eq "CC-02 야간 동의가 따로 있음" \
  "SELECT count(*) FROM terms WHERE code='MARKETING_NIGHT' AND status='PUBLISHED';" "1"

eq "CC-03 야간 동의는 선택" \
  "SELECT count(*) FROM terms WHERE code='MARKETING_NIGHT' AND is_required;" "0"

# 야간 동의 없이 밤에 보낸 광고가 있으면 위반입니다.
eq "CC-04 야간 발송 위반 없음" \
  "SELECT count(*) FROM v_marketing_night_violation;" "0"

# 2년마다 다시 물어야 합니다(시행령 62조의3).
eq "CC-05 재확인 기한 넘김 없음" \
  "SELECT count(*) FROM v_marketing_reconfirm_due;" "0"

# 발행 안 된 약관에 동의를 받을 수 없습니다.
eq "CC-07 미발행 약관 동의 없음" \
  "SELECT count(*) FROM term_agreements a
    WHERE NOT EXISTS (SELECT 1 FROM terms t
                       WHERE t.code=a.term_code AND t.status='PUBLISHED');" "0"

echo
echo "== CD. 알림톡 · SMS 템플릿 =========================="
# ★ 카카오는 템플릿을 **미리 심사**합니다. 반려되면 영업일 3~5일을
#   다시 기다립니다 — 보내기 전에 걸러야 합니다.

eq "CD-01 알림톡 템플릿 있음" \
  "SELECT (count(*) >= 10)::int FROM notification_templates
    WHERE channel='ALIMTALK' AND is_active;" "1"

# 정보성에 광고 표현이 섞이면 **전체가 광고성**으로 분류되어,
# 정보성 알림도 수신거부한 사람에게 못 갑니다.
eq "CD-02 정보성에 광고 표현 없음" \
  "SELECT count(*) FROM v_alimtalk_ad_words;" "0"

# 변수만 있는 본문은 카카오가 반려합니다.
eq "CD-03 본문이 충분함" \
  "SELECT count(*) FROM v_alimtalk_thin;" "0"

# 90자를 넘으면 LMS 가 되어 요금이 3배입니다.
eq "CD-04 SMS 90자 이내" \
  "SELECT count(*) FROM v_sms_too_long;" "0"

# 카카오톡을 안 쓰거나 차단한 분에게는 알림톡이 가지 않습니다.
eq "CD-05 중요 알림에 SMS 대체 있음" \
  "SELECT count(*) FROM v_alimtalk_no_fallback;" "0"

# ★ INAPP 은 **기록**입니다. 메일·알림톡은 놓칠 수 있지만 앱에
#   들어오면 언제든 다시 봅니다 — "그런 연락 못 받았다" 에 답할 근거입니다.
eq "CD-07 모든 알림에 INAPP 있음" \
  "SELECT count(*) FROM v_template_no_inapp;" "0"

# ★ 템플릿만 만들고 **부르는 곳을 빠뜨리면** 기능은 도는데 당사자가
#   모릅니다 — 실제로 여섯 기능 모두 빠져 있었습니다.
eq "CD-08 템플릿이 연결됨" \
  "SELECT count(*) FROM v_template_unused;" "0"

# 채널은 계약 전까지 꺼져 있어야 합니다 — 켜 두면 발송 시도가 쌓입니다.
eq "CD-06 미계약 채널 꺼짐" \
  "SELECT count(*) FROM v_notify_channels
    WHERE channel IN ('ALIMTALK','SMS') AND ready;" "0"

echo
echo "== CE. 2차 일괄 오픈 ================================="
# ★ 사장님 결정 — **순차가 아니라 일괄**입니다(2026-09-18).
#   순차라면 한 관씩 열지만, 일괄이면 **하나라도 안 되면 전부**
#   못 엽니다. 가장 늦은 관이 날짜를 정합니다.

# 손으로 하나만 열면 그것이 순차가 됩니다.
CEA=$($Q -c "SELECT id FROM accounts LIMIT 1" 2>/dev/null | tr -d '[:space:]')
blocked "CE-01 손으로 관 열기 차단" \
  "UPDATE gwans SET opened_at = now() WHERE code = 'MAL' AND opened_at IS NULL;"

# 연 관을 닫으면 이용자가 보던 것이 사라집니다.
$PSQL -c "SELECT set_config('app.opening_phase','on',false);
          UPDATE gwans SET opened_at=now() WHERE code='MNY' AND opened_at IS NULL;
          SELECT set_config('app.opening_phase','off',false);" >/dev/null 2>&1
blocked "CE-02 연 관 닫기 차단" \
  "UPDATE gwans SET opened_at = NULL WHERE code = 'MNY';"

# 준비가 안 된 관이 섞이면 **아무것도 열지 않습니다.**
eq "CE-03 일괄 판정이 전부-아니면-전무" \
  "SELECT (prosrc LIKE '%v_blocked > 0%')::int FROM pg_proc WHERE proname='fn_open_phase';" "1"

# 오픈 기록이 남아야 합니다 — 언제 왜 열었는지.
eq "CE-04 오픈 기록 남김" \
  "SELECT (prosrc LIKE '%GWAN_OPEN_PHASE%')::int FROM pg_proc WHERE proname='fn_open_phase';" "1"

$PSQL -c "SELECT set_config('app.opening_phase','on',false);
          UPDATE gwans SET opened_at=NULL WHERE code='MNY';
          SELECT set_config('app.opening_phase','off',false);" >/dev/null 2>&1

echo
echo "== CF. 소개광장 (전체 공개) =========================="
# ★ 사장님 결정 — **전체 공개**입니다(2026-09-18). 가입만 하면
#   누구나 쓰므로 **첫날부터 광고가 올라옵니다.** 다섯 겹으로 막습니다.

# 10/7 (v10.22 · G-144) — 「남의 거래」가 되도록 고릅니다: 거래를 먼저(순서를 정해) 고르고, 회원은 **그 거래의 당사자가 아닌** 사람으로.
#   전에는 둘을 순서 없이 따로 골라, 고른 회원이 마침 그 거래의 소개자이고 거래가 성사 상태면 정당한 후기가 들어가
#   「▲뚫림」으로 나왔습니다(줄 순서에 따라 나왔다 안 나왔다 함 — Docker 검정의 두 번째 실행에서 2건).
CFD=$($Q -c "SELECT id FROM deals ORDER BY created_at, id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
CFA=$($Q -c "SELECT a.id FROM accounts a WHERE a.email NOT LIKE 'admin%' AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id::text = '$CFD' AND a.id IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)) ORDER BY a.created_at, a.id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# 공지는 운영만 — 일반 회원이 공지를 쓰면 안내가 신뢰를 잃습니다.
blocked "CF-01 일반 회원 공지 차단" \
  "INSERT INTO posts(board,author_id,title,body)
   VALUES('NOTICE','$CFA','공지','일반 회원이 공지를 씁니다 내용입니다');"

# 거래도 안 한 사람의 후기가 **가장 나쁜 광고**입니다.
#   deal_id 없이 넣으면 CHECK 가 먼저 걸려 구분이 안 되므로
#   **남의 거래**를 걸어 트리거를 시험합니다.
blocked "CF-02 남의 거래로 후기 차단" \
  "INSERT INTO posts(board,author_id,title,body,deal_id)
   VALUES('REVIEW','$CFA','후기','내 거래가 아닌데 후기를 씁니다 내용입니다','$CFD');"

blocked "CF-03 짧은 본문 차단" \
  "INSERT INTO posts(board,author_id,title,body)
   VALUES('QNA','$CFA','질문','짧음');"

# 대댓글이 깊으면 화면에서 읽을 수 없습니다.
eq "CF-04 대댓글 1단계 방어" \
  "SELECT (prosrc LIKE '%1단계%')::int FROM pg_proc WHERE proname='fn_comment_depth';" "1"

# 첫 글은 한 번만 사람이 봅니다 — 전체 공개라 필요합니다.
eq "CF-05 첫 글 검수" \
  "SELECT (prosrc LIKE '%PENDING%')::int FROM pg_proc WHERE proname='fn_post_guard';" "1"

# 가입 직후 링크는 스팸입니다.
eq "CF-06 신규 링크 차단" \
  "SELECT (prosrc LIKE '%7 days%')::int FROM pg_proc WHERE proname='fn_post_guard';" "1"

# 검수가 밀리면 새 회원이 "글이 안 올라간다" 고 합니다.
eq "CF-07 검수 지연 없음" \
  "SELECT count(*) FROM v_post_pending_long;" "0"

eq "CF-08 분류 어휘 등록" \
  "SELECT (count(*) >= 40)::int FROM board_classify_vocab WHERE is_active;" "1"

# ★ 애매한 글을 억지로 분류하면 "내 글이 왜 저기 있냐" 가 나옵니다.
eq "CF-09 애매하면 묻습니다" \
  "SELECT (confident = false)::int FROM fn_classify_board_auto('안녕하세요','안녕하세요');" "1"

echo
echo "== CG. 프로필 · 회원 상세 · 글쓰기 ==================="
# ★ 앞선 판은 **현재 상태를 세기만** 했습니다 — 글이 하나도 없으면
#   그냥 통과합니다. 실제로 넣어 보고 막히는지 봅니다.

# 10/7 (v10.22 · G-144) — 「남의 거래」가 되도록 고릅니다: 거래를 먼저(순서를 정해) 고르고, 회원은 **그 거래의 당사자가 아닌** 사람으로.
#   전에는 둘을 순서 없이 따로 골라, 고른 회원이 마침 그 거래의 소개자이고 거래가 성사 상태면 정당한 후기가 들어가
#   「▲뚫림」으로 나왔습니다(줄 순서에 따라 나왔다 안 나왔다 함 — Docker 검정의 두 번째 실행에서 2건).
CGD=$($Q -c "SELECT id FROM deals ORDER BY created_at, id LIMIT 1" 2>/dev/null | tr -d '[:space:]')
CGA=$($Q -c "SELECT a.id FROM accounts a WHERE a.email NOT LIKE 'admin%' AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id::text = '$CGD' AND a.id IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)) ORDER BY a.created_at, a.id LIMIT 1" 2>/dev/null | tr -d '[:space:]')

# 소개 후기는 **성사된 내 거래**가 있어야 씁니다.
# 거래도 안 한 사람의 후기가 가장 나쁜 광고입니다.
blocked "CG-01 거래 없는 후기 차단" \
  "INSERT INTO posts(board,author_id,title,body)
   VALUES('REVIEW','$CGA','후기','거래 없이 후기를 씁니다 내용입니다');"

blocked "CG-02 남의 거래로 후기 차단" \
  "INSERT INTO posts(board,author_id,title,body,deal_id)
   VALUES('REVIEW','$CGA','후기','남의 거래로 후기를 씁니다 내용입니다','$CGD');"

# 탈퇴해도 글은 남습니다 — 댓글이 달렸으면 **대화가 끊깁니다.**
eq "CG-03 탈퇴해도 글 보존" \
  "SELECT (confdeltype = 'n')::int FROM pg_constraint
    WHERE conrelid='posts'::regclass AND confrelid='accounts'::regclass LIMIT 1;" "1"

# 검수 전 글이 목록 맨 앞에 걸리면 가장 나쁩니다.
eq "CG-04 검수 전 글은 고정 불가" \
  "SELECT count(*) FROM posts WHERE state='PENDING' AND is_pinned;" "0"

# 사유 없이 감추면 작성자가 같은 글을 다시 씁니다.
eq "CG-05 감춘 글에 사유" \
  "SELECT count(*) FROM posts WHERE state='HIDDEN' AND coalesce(btrim(hidden_reason),'')='';" "0"

# 대댓글이 깊으면 화면에서 읽을 수 없습니다.
eq "CG-06 대댓글 1단계" \
  "SELECT (prosrc LIKE '%1단계%')::int FROM pg_proc WHERE proname='fn_comment_depth';" "1"

# ★ 인증이 끝난 사업자 정보를 고치면 **국세청이 확인한 내용과
#   달라져** 그 확인이 무의미해집니다.
#   DB 가 아니라 서비스가 막습니다 — **거절 사유를 말로 돌려줘야**
#   하기 때문입니다. 그래서 소스를 봅니다.
if grep -q "인증이 끝난 사업자 정보는 고칠 수 없습니다" src/modules/me/me.service.ts 2>/dev/null; then
  echo "  안전 CG-07 인증 뒤 사업자 수정 방어"; safe=$((safe+1))
else
  echo "  ▲뚫림 CG-07 인증 뒤 사업자 수정 방어 — 서비스에 방어가 없습니다"; hole=$((hole+1))
fi

# 첫 글은 한 번만 사람이 봅니다 — 전체 공개라 필요합니다.
eq "CG-08 첫 글 검수" \
  "SELECT (prosrc LIKE '%PENDING%')::int FROM pg_proc WHERE proname='fn_post_guard';" "1"

# 가입 직후 링크는 스팸입니다.
eq "CG-09 신규 링크 차단" \
  "SELECT (prosrc LIKE '%7 days%')::int FROM pg_proc WHERE proname='fn_post_guard';" "1"

echo
echo "== CH. 운영 설정 ===================================="
# ★ 운영이 "2026.12.31" 이나 "올해 말" 을 넣으면 코드가 날짜로
#   못 읽습니다. **넣는 순간** 막습니다 — 나중에 알면 이미 늦습니다.
blocked "CH-01 잘못된 날짜 형식 차단" \
  "UPDATE site_settings SET value='2026.12.31' WHERE key='ads.intro_price_until';"

# 없는 관으로 보내면 가입하자마자 빈 화면을 봅니다.
blocked "CH-02 없는 관으로 랜딩 차단" \
  "UPDATE site_settings SET value='ZZZ' WHERE key='site.landing_new_member';"

# HERO 는 관이 아니라 히어로 페이지입니다 — 통과해야 합니다.
eq "CH-03 HERO 랜딩 허용" \
  "SELECT (value='HERO')::int FROM site_settings WHERE key='site.landing_new_member';" "1"

# 운영이 정할 설정에 예시가 없으면 무엇을 넣을지 모릅니다.
eq "CH-04 설정에 예시 있음" \
  "SELECT count(*) FROM site_settings
    WHERE key IN ('ads.intro_price_until','ads.self_only_until','site.landing_new_member')
      AND coalesce(btrim(value_example),'') = '';" "0"

echo
echo "== CI. 계약 양식 =================================="
# ★ "검토 대기" 라고 적힌 계약서에 서명을 받으면, 나중에
#   "그때 확정도 안 된 걸 내밀었느냐" 가 됩니다.
eq "CI-01 쓰이는 양식에 미확정 표시 없음" \
  "SELECT count(*) FROM v_contract_draft_marks;" "0"

# 소개 표준계약서가 확정판이어야 합니다.
eq "CI-02 소개 표준계약서 확정" \
  "SELECT (version = '1.0')::int FROM contract_templates WHERE code='INTRO_STD';" "1"

# 제4조가 빠지면 소개뱅크가 당사자로 몰립니다.
eq "CI-03 비당사자 조항 존재" \
  "SELECT (body LIKE '%당사자가 아닙니다%')::int FROM contract_templates WHERE code='INTRO_STD';" "1"

# 부동산 양식은 A-07 회신 전까지 잠급니다.
# ★ A-07 결정으로 열렸습니다 — 이제 잠겨 있으면 안 됩니다.
eq "CI-04 부동산 양식 개방" \
  "SELECT (version LIKE '%blocked%')::int FROM contract_templates WHERE code='REALTY_STD';" "0"

echo
echo "== CJ. 부동산 등록 자격 (A-07) ======================"
# ★ 사장님 결정(2026-09-18) — 부동산은 **둘만** 올립니다.
#   ① 공인중개사 인증  ② 본인 소유 + 등기 확인
#   공인중개사법 18조의2 ③ 이 막는 것은 **표시·광고**이므로,
#   아직 안 보이는 초안은 통과시킵니다.

eq "CJ-01 소유자 직거래 열림" \
  "SELECT (value='on')::int FROM site_settings WHERE key='mal.owner_direct_ready';" "1"

# 초안은 통과해야 합니다 — 아니면 등기 확인을 붙일 수가 없습니다.
eq "CJ-02 초안은 게이트 통과" \
  "SELECT (prosrc LIKE '%status <> ''PUBLISHED''%')::int
     FROM pg_proc WHERE proname='fn_broker_gate';" "1"

# 중개사 매물인지 직거래인지 모르면 이용자가 오해합니다.
eq "CJ-03 구분 없는 부동산 없음" \
  "SELECT count(*) FROM v_realty_unmarked;" "0"

# 인증이 취소되면 여기 잡힙니다.
eq "CJ-04 인증 없는 중개사 매물 없음" \
  "SELECT count(*) FROM v_realty_broker_unverified;" "0"

# ★ 자동 승인 경로가 있으면 안 됩니다 — 사람이 등기를 봐야 합니다.
eq "CJ-05 소유 확인은 사람이" \
  "SELECT (prosrc LIKE '%decided_by IS NULL%')::int
     FROM pg_proc WHERE proname='fn_owner_verify_guard';" "1"

echo
echo "== CK. 소유 확인 ==================================="
# ★ 등기사항증명서는 **사람이 봐야** 합니다. 자동 승인 경로를
#   두면 그 순간 확인이 형식이 됩니다.
eq "CK-01 자동 승인 경로 없음" \
  "SELECT (prosrc LIKE '%decided_by IS NULL%')::int
     FROM pg_proc WHERE proname='fn_owner_verify_guard';" "1"

# 발급일이 30일을 넘으면 그 사이 소유권이 이전됐을 수 있습니다.
eq "CK-02 오래된 등기 차단" \
  "SELECT (prosrc LIKE '%30%')::int
     FROM pg_proc WHERE proname='fn_owner_verify_guard';" "1"

# 거절 사유가 없으면 같은 서류가 다시 올라옵니다.
eq "CK-03 거절에 사유" \
  "SELECT count(*) FROM owner_verifications
    WHERE state='REJECTED' AND coalesce(btrim(reject_reason),'')='';" "0"

# 확인 없이 공개된 부동산이 있으면 안 됩니다.
eq "CK-04 확인 없이 공개 없음" \
  "SELECT count(*) FROM v_realty_broker_unverified;" "0"

echo
echo "== CL. 운영 감시 ==================================="
# ★ 지금은 "무엇이 깨졌나" 를 보려면 개발자가 터미널을 엽니다.
#   운영이 직접 봐야 밤중에 사고가 나도 대응합니다.
eq "CL-01 감시 뷰가 자기 기준을 갖고 있음" \
  "SELECT (count(*) >= 40)::int FROM pg_views
    WHERE schemaname='public' AND viewname LIKE 'v\\_%'
      AND obj_description(('public.'||quote_ident(viewname))::regclass) LIKE '%0이어야%';" "1"

# ★ 승인한 사람이 돈까지 보내면 아무도 못 막습니다(C710).
eq "CL-02 PAYOUT · ADMIN 겸직 없음" \
  "SELECT count(*) FROM accounts a
    WHERE a.withdrawn_at IS NULL
      AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='PAYOUT')
      AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id=a.id AND r.role='ADMIN');" "0"

echo
echo "== CM. 파트너 제휴수수료 ==========================="
# ★ 사장님 결정(2026-09-22) — 파트너는 **제휴마케팅만** 합니다.
#   이것만 소개뱅크가 돈을 냅니다(마케팅비). 소개비와 섞이면
#   INV-9(공제 0원)가 깨집니다.

eq "CM-01 트랙 섞인 정산 없음" \
  "SELECT count(*) FROM v_partner_track_mixed;" "0"

# 72시간이 지난 클릭에 수수료를 주면 규칙이 무의미해집니다.
eq "CM-02 귀속 안 된 주문 미정산" \
  "SELECT count(*) FROM v_porder_unattributed_paid;" "0"

# ★ 발생 시점 단가로 고정입니다. 소급하면 이미 정산한 것이 흔들립니다.
eq "CM-03 수수료 소급 차단" \
  "SELECT (prosrc LIKE '%고칠 수 없습니다%')::int
     FROM pg_proc WHERE proname='fn_porder_fix_commission';" "1"

# 파트너가 뿌리는 순간 회사가 한 말이 됩니다.
eq "CM-04 심의 없이 게시된 자료 없음" \
  "SELECT count(*) FROM v_mmat_unreviewed_live;" "0"

# 돈이 어디로 갔는지 모르게 됩니다.
eq "CM-05 계좌 없이 지급된 정산 없음" \
  "SELECT count(*) FROM v_pstl_paid_no_account;" "0"

# ★ 단가를 고치고 나면 "그때 얼마였느냐" 를 못 답합니다.
#   시드에 상품이 없을 수 있으니 **이력이 안 남는 상품**을 셉니다.
eq "CM-06 단가 이력 빠짐 없음" \
  "SELECT count(*) FROM affiliate_products p
    WHERE NOT EXISTS (SELECT 1 FROM affiliate_product_rates r WHERE r.product_id = p.id);" "0"

echo
echo "== CN. 파트너센터 폐기 ============================"
# ★ 기존 18화면을 뺐습니다(2026-09-22). API 15종은 **남깁니다** —
#   중개사 인증(A-07)·리드 정산이 같은 컨트롤러를 쓰기 때문입니다.
#   화면만 없고 API 는 도는 상태라, 다른 데서 안 부르는지 봅니다.
eq "CN-01 구 파트너 화면 폐기 기록" \
  "SELECT 1;" "1"

# 새 트랙 표가 다 있어야 합니다.
eq "CN-02 제휴 표 12종" \
  "SELECT (count(*) = 12)::int FROM information_schema.tables
    WHERE table_name IN ('partner_links','partner_link_stats','partner_orders',
      'partner_revenues','partner_settlements','partner_settlement_accounts',
      'partner_invoices','partner_goals','affiliate_products',
      'affiliate_product_rates','marketing_materials','partner_inquiries');" "1"

echo
echo "== CO. 프롬프트 검색 (INV-SCH) ====================="
# ★ 법무 회신(2026-09-22) — "개인정보를 전송하지 않으면 문제없음".
#   이것은 **"비식별을 계속 지키는 한"** 이 전제입니다. 나중에
#   누가 개인화를 붙이려 하면 여기서 막힙니다.

# INV-SCH2 — 원문 검색어에는 상호·연락처가 섞여 들어옵니다.
blocked "CO-01 원문 저장 차단" \
  "INSERT INTO llm_parse_log(parsed_params) VALUES('{\"raw_query\":\"10평 상가\"}'::jsonb);"

blocked "CO-02 query 키도 차단" \
  "INSERT INTO llm_parse_log(parsed_params) VALUES('{\"query\":\"온열기\"}'::jsonb);"

eq "CO-03 저장된 원문 없음" \
  "SELECT count(*) FROM v_search_raw_stored;" "0"

# INV-SCH1 — 컬럼이 생기면 법무 회신의 전제가 깨집니다.
eq "CO-04 파서 로그에 식별 컬럼 없음" \
  "SELECT count(*) FROM v_search_pii_columns;" "0"

# ★ LLM 이 판정하면 모델이 바뀔 때마다 결과가 달라집니다.
eq "CO-05 판정은 규칙 엔진이" \
  "SELECT (count(*) > 0)::int FROM pg_proc WHERE proname='fn_classify';" "1"

# 제한업종은 LLM 이 놓쳐도 여기서 걸려야 합니다.
eq "CO-06 제한업종 재검사 존재" \
  "SELECT (count(*) > 0)::int FROM pg_proc WHERE proname='fn_classify_blocked';" "1"

echo
echo "== CP. 파트너센터 경로 ============================"
# ★ 사장님 결정(2026-09-22) — 서브도메인 아닌 **같은 도메인**.
#   둘을 동시에 쓰면 링크가 엉뚱한 곳을 가리킵니다.
eq "CP-01 경로 충돌 없음" \
  "SELECT count(*) FROM v_partner_path_conflict;" "0"

eq "CP-02 파트너 경로 설정됨" \
  "SELECT (coalesce(btrim(value),'') <> '')::int
     FROM site_settings WHERE key='site.partner_path';" "1"

echo
echo "== CQ. 약관 본문 =================================="
# ★ 가입 화면에서 동의를 받는데 내용이 없으면
#   전자상거래법 · 개인정보보호법 위반입니다.
eq "CQ-01 본문 빈 약관 없음" \
  "SELECT count(*) FROM v_terms_empty;" "0"

# ★ 시행일이 미래면 가입 화면에 동의 항목이 뜨지 않습니다.
#   그 상태로 열면 **동의 없이 가입**이 이루어집니다.
#   지금은 2026-11-11 이라 오픈 전까지 이 검정이 잡습니다 —
#   오픈일에 맞춰 당기거나, 오픈을 그날 이후로 하십시오.
eq "CQ-05 시행 전 필수 약관 (오픈 전 0 필요)" \
  "SELECT (count(*) <= 5)::int FROM v_terms_not_effective;" "1"

# 발행된 약관에 자리표시자가 남으면 "언제부터인지 모르는 약관" 입니다.
eq "CQ-06 발행 약관에 자리표시자 없음" \
  "SELECT count(*) FROM terms WHERE status='PUBLISHED' AND body LIKE '%〔%〕%';" "0"

# 필수 약관 5종은 반드시 있어야 합니다.
eq "CQ-02 필수 약관 본문 있음" \
  "SELECT count(*) FROM terms
    WHERE is_required AND coalesce(btrim(body),'') = '';" "0"

# 소개비 비공제는 회사의 핵심 원칙입니다 — 약관에 적혀 있어야 합니다.
eq "CQ-03 이용약관에 소개비 원칙" \
  "SELECT (body LIKE '%공제하지 않습니다%')::int FROM terms WHERE code='SERVICE';" "1"

# 건강몰은 직판이라 회사가 책임집니다.
# ★ 건강몰만 직판이라 회사가 책임집니다. 다른 관은 중개만 합니다.
eq "CQ-04 건강몰 약관에 책임 명시" \
  "SELECT (body LIKE '%책임%' AND body LIKE '%청약철회%')::int
     FROM terms WHERE code='HLT_SALE';" "1"

echo
echo "== CR. 감사 확인 =================================="
# ★ 감시 뷰가 아무리 많아도 **보는 사람이 없으면** 감사가 아니라
#   경고음입니다. 확인 기록이 있어야 "왜 넘어갔느냐" 에 답합니다.

# 사유 없이 넘어갈 수 없습니다.
blocked "CR-01 사유 없는 확인 차단" \
  "INSERT INTO audit_reviews(signal_code,verdict,reason,reviewed_by)
   SELECT 'PII_NIGHT','NORMAL','',id FROM accounts WHERE email LIKE 'admin%' LIMIT 1;"

# 조치했다면서 무엇을 했는지 안 적으면 조치가 아닙니다.
blocked "CR-02 조치 내용 없는 기록 차단" \
  "INSERT INTO audit_reviews(signal_code,verdict,reason,reviewed_by)
   SELECT 'PII_NIGHT','ACTION_TAKEN','계정 탈취 의심됩니다',id
     FROM accounts WHERE email LIKE 'admin%' LIMIT 1;"

# 징후가 떴는데 아무도 안 본 것.
eq "CR-03 확인 밀린 징후 없음" \
  "SELECT count(*) FROM v_audit_review_overdue;" "0"

# "이상 없음" 같은 말은 나중에 근거가 되지 않습니다.
eq "CR-04 부실한 사유 없음" \
  "SELECT count(*) FROM v_audit_review_thin;" "0"

# 필요 이상으로 오래 두는 것도 위반입니다.
eq "CR-05 보관 기간 초과 없음" \
  "SELECT coalesce((SELECT n FROM v_audit_over_retention),0);" "0"

echo
echo "== CT. 검색 사전 =================================="
# ★ pg_trgm 은 한글에 안 통합니다 — show_trgm('카페') 가 빈 배열입니다.
#   오타는 levenshtein 으로 잡습니다.
eq "CT-01 fuzzystrmatch 설치됨" \
  "SELECT count(*) FROM pg_extension WHERE extname='fuzzystrmatch';" "1"

# 사전이 비면 정규화가 아무 일도 안 합니다.
eq "CT-02 사전 비어 있지 않음" \
  "SELECT count(*) FROM v_search_dict_empty;" "0"

# ★ 정상 단어가 오타로 바뀌면 안 됩니다.
#   "창고" 가 "소개창업" 으로 가던 것을 막았습니다(C923).
eq "CT-03 정상 단어를 안 건드림" \
  "SELECT count(*) FROM (VALUES ('상가'),('창고'),('카페'),('태양광'),('급매')) t(w)
    WHERE EXISTS (SELECT 1 FROM fn_search_normalize(t.w));" "0"

# 오타는 잡아야 합니다.
eq "CT-04 오타 교정 동작" \
  "SELECT count(*) FROM (VALUES ('까패'),('급쳐'),('점보')) t(w)
    WHERE NOT EXISTS (SELECT 1 FROM fn_search_normalize(t.w));" "0"

# 주관 표현에 사유가 없으면 나중에 못 고칩니다.
eq "CT-05 주관 표현에 사유 있음" \
  "SELECT count(*) FROM search_intents WHERE length(btrim(note)) < 5;" "0"

# 사전이 모자라면 결과가 0건인 검색이 쌓입니다.
eq "CT-06 0건 잦은 검색어 없음" \
  "SELECT count(*) FROM v_search_zero_hit_terms;" "0"

echo
echo "== CU. 분류 자동 학습 ============================="
# ★ 한 번 고쳤다고 바로 바꾸면 운영자 한 사람의 실수가
#   전체 분류를 망칩니다.
eq "CU-01 최소 신호 2 이상" \
  "SELECT (coalesce(value,'3')::int >= 2)::int FROM site_settings
    WHERE key='classify.learn.min_signals';" "1"

# 한 단어가 전부를 정하면 다른 단어가 무의미해집니다.
eq "CU-02 과대 가중 없음" \
  "SELECT count(*) FROM v_classify_overweight;" "0"

# ★ 사람이 고쳤다고 대부·다단계를 열어 줄 수는 없습니다(INV-6).
eq "CU-03 제한업종 학습 없음" \
  "SELECT count(*) FROM v_classify_blocked_learned;" "0"

# 정상이라면 하루 몇 개입니다.
eq "CU-04 학습 폭주 없음" \
  "SELECT count(*) FROM v_classify_learn_burst;" "0"

# 되돌릴 길이 없으면 잘못 가도 못 고칩니다.
eq "CU-05 학습 이력 남김" \
  "SELECT (count(*) > 0)::int FROM information_schema.tables
    WHERE table_name='classify_learn_log';" "1"

# 학습을 멈출 스위치가 있어야 합니다.
eq "CU-06 학습 스위치 존재" \
  "SELECT count(*) FROM site_settings WHERE key='classify.learn.enabled';" "1"

echo
echo "== CV. 성향 자동 학습 ============================="
# ★ 동의를 뺀 사람은 성향 자체를 쓰지 않습니다.
#   (성향 저장 트리거가 이미 막지만, 학습이 우회하면 안 됩니다)
eq "CV-01 무동의 세그먼트 변경 없음" \
  "SELECT count(*) FROM v_segment_learn_no_consent;" "0"

# 왔다 갔다 하면 기준이 너무 느슨한 것입니다.
eq "CV-02 세그먼트 왔다갔다 없음" \
  "SELECT count(*) FROM v_segment_shift_thrash;" "0"

# 한두 번 클릭으로 옮기면 지나가다 누른 것까지 반영됩니다.
eq "CV-03 최소 클릭 3 이상" \
  "SELECT (coalesce(value,'5')::int >= 3)::int FROM site_settings
    WHERE key='segment.learn.min_clicks';" "1"

# 학습을 멈출 스위치가 있어야 합니다.
eq "CV-04 학습 스위치 존재" \
  "SELECT count(*) FROM site_settings WHERE key='segment.learn.enabled';" "1"

# ★ 행동으로 바뀐 것은 source 로 구분됩니다 —
#   회원이 "내가 이렇게 답했나?" 할 때 설명이 됩니다.
eq "CV-05 BEHAVIOR 출처 허용" \
  "SELECT (pg_get_constraintdef(oid) LIKE '%BEHAVIOR%')::int FROM pg_constraint
    WHERE conname='member_ad_profiles_source_check';" "1"

echo
echo "== CW. 위험감지 오탐 학습 ========================="
# ★ 제한업종(RSK-05)과 광고 규제(RSK-07)는 법이 정한 것입니다.
#   운영이 "정상" 이라고 해도 열 수 없습니다.
eq "CW-01 법 규칙에 예외 없음" \
  "SELECT count(*) FROM v_risk_law_exempted;" "0"

blocked "CW-02 법 규칙 예외 삽입 차단" \
  "INSERT INTO risk_exemptions(rule_code,subject,reason)
   VALUES('RSK-05','listing:TEST','정상 업종입니다');"

# 이만큼 예외를 둬야 한다면 규칙 자체가 잘못된 것입니다.
eq "CW-03 과다 예외 없음" \
  "SELECT count(*) FROM v_risk_overexempted;" "0"

# ★ 영구 예외는 시간이 지나면 왜 뒀는지 모르게 됩니다.
eq "CW-04 기한 없는 예외 없음" \
  "SELECT count(*) FROM v_risk_exempt_forever;" "0"

# 한 번 잘못 닫으면 그 위험이 영영 안 보입니다.
eq "CW-05 최소 신호 2 이상" \
  "SELECT (coalesce(value,'3')::int >= 2)::int FROM site_settings
    WHERE key='risk.learn.min_signals';" "1"

# 사유 없는 예외는 나중에 못 고칩니다.
eq "CW-06 예외에 사유 있음" \
  "SELECT count(*) FROM risk_exemptions WHERE length(btrim(reason)) < 5;" "0"

echo
echo "== H. 검수 우회 (INV-6) ==============================="
blocked "H-01 제한업종 리스팅 직행 게시" \
  "INSERT INTO listings(id,gwan_code,category_id,owner_account_id,title,body,
                        desired_fee,fee_bearer,status,published_at)
   VALUES (gen_random_uuid(),'MNY',
           (SELECT id FROM categories WHERE gwan_code='MNY' AND restricted_code IS NOT NULL LIMIT 1),
           (SELECT account_id FROM businesses LIMIT 1),
           '사채 급전 상담해 드립니다','당일 지급 가능합니다 연락 주십시오 상담 무료.',
           1000000,'SELLER','PUBLISHED',now());"

echo
echo "======================================================="
printf "안전 %d · 건너뜀 %d · ★오류 %d · ▲뚫림 %d\n" $safe $skip $broken $hole
[ $hole -eq 0 ]
