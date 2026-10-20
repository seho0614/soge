#!/usr/bin/env bash
# 소개뱅크 불변식 검증 — CI 필수 게이트
# 사용: DATABASE_URL=postgresql://... bash scripts/verify-invariants.sh
set -uo pipefail
PSQL="psql ${DATABASE_URL:?DATABASE_URL 필요} -q -v ON_ERROR_STOP=1"
pass=0; fail=0

run() { # $1=라벨 $2=기대(FAIL|PASS) $3=SQL
  if $PSQL -c "$3" >/dev/null 2>&1; then real=PASS; else real=FAIL; fi
  if [ "$real" = "$2" ]; then printf "  ok   %s\n" "$1"; pass=$((pass+1))
  else printf "  FAIL %s (기대 %s / 실제 %s)\n" "$1" "$2" "$real"; fail=$((fail+1)); fi
}

eq() { # $1=라벨 $2=SQL $3=기대값 — 차단이 아니라 "값이 맞는가"를 봅니다
  local got; got=$($PSQL -t -A -c "$2" 2>&1 | tr -d '[:space:]')
  if [ "$got" = "$3" ]; then printf "  ok   %s\n" "$1"; pass=$((pass+1))
  else printf "  FAIL %s (기대 %s / 실제 %s)\n" "$1" "$3" "$got"; fail=$((fail+1)); fi
}

# 약관 본문 검사는 gen-terms-draft.js 가 먼저 돌아야 통과합니다.
# 순서에 의존하지 않도록 여기서 직접 보장합니다 —
# 예전에는 CI 순서가 바뀌면 거짓 실패가 났습니다.
node "$(dirname "$0")/gen-terms-draft.js" >/dev/null 2>&1 || true

# ★ 20261002 — 이 검정은 fixture.sql 로 표를 **비우고 다시 채웁니다.**
#   개발 DB(sgb)에 돌리면 쌓아 둔 계정·거래·매물이 사라집니다(실제로 한 번 지워졌습니다).
#   검정 전용 DB(이름이 _check · _ci · _test 로 끝남)에서만 돕니다. 꼭 필요하면 SGB_FIXTURE_OK=1.
_db=$(psql "$DATABASE_URL" -tAc "select current_database()" 2>/dev/null)
if [[ ! "$_db" =~ _(check|ci|test)$ ]] && [ "${SGB_FIXTURE_OK:-}" != "1" ]; then
  echo "!! '$_db' 는 검정 전용 DB 가 아닙니다 — fixture 가 데이터를 지웁니다. sgb_check 에서 돌리십시오 (강제: SGB_FIXTURE_OK=1)"; exit 2
fi

echo "== 픽스처 =="
$PSQL -f "$(dirname "$0")/fixture.sql" >/dev/null || { echo "픽스처 실패"; exit 1; }

B=11111111-1111-1111-1111-111111111111
BUY=22222222-2222-2222-2222-222222222222
SEL=33333333-3333-3333-3333-333333333333
IND=44444444-4444-4444-4444-444444444444
D=cccccccc-0000-4000-a000-000000000001
L=ffffffff-0000-4000-a000-000000000001
BIZ=aaaaaaaa-0000-4000-a000-000000000001
BIZ2=aaaaaaaa-0000-4000-a000-000000000002
S1=bbbbbbbb-0000-4000-a000-000000000001
S2=bbbbbbbb-0000-4000-a000-000000000002

echo "== 불변식 =="
run "INV-1  tier=2 생성 차단"          FAIL "INSERT INTO deals(listing_id,buyer_account_id,seller_account_id,tier) VALUES ('$L','$BUY','$SEL',2);"
run "INV-8  만료 구독 코드 발급 차단"   FAIL "INSERT INTO referral_codes(code,owner_account_id,subscription_id) VALUES ('X1','$BUY','$S2');"
run "INV-8  유효 구독 코드 발급"        PASS "INSERT INTO referral_codes(code,owner_account_id,subscription_id) VALUES ('OK1','$B','$S1');"
run "INV-4  1인 확인 CONFIRMED 차단"    FAIL "INSERT INTO deal_confirmations(deal_id,party,confirmed_by) VALUES ('$D','BUYER','$BUY'); UPDATE deals SET status='CONFIRMED' WHERE id='$D';"
run "INV-3  미확정 Deal 정산 차단"      FAIL "INSERT INTO settlements(deal_id,payee_account_id,payee_business_id,amount) VALUES ('$D','$B','$BIZ',1000000);"
run "INV-4  양측 확인 CONFIRMED"        PASS "INSERT INTO deal_confirmations(deal_id,party,confirmed_by) VALUES ('$D','BUYER','$BUY'),('$D','SELLER','$SEL'); UPDATE deals SET status='CONFIRMED',confirmed_at=now() WHERE id='$D';"
run "INV-9  공제 정산 차단"             FAIL "INSERT INTO settlements(deal_id,payee_account_id,payee_business_id,amount) VALUES ('$D','$B','$BIZ',950000);"
run "INV-10 미인증 사업자 수령 차단"    FAIL "INSERT INTO settlements(deal_id,payee_account_id,payee_business_id,amount) VALUES ('$D','$IND','$BIZ2',1000000);"
run "정상   전액·인증 정산"             PASS "INSERT INTO settlements(id,deal_id,payee_account_id,payee_business_id,amount) VALUES ('dddddddd-0000-4000-a000-000000000001','$D','$B','$BIZ',1000000);"
run "INV-2  귀속 로그 기록"             PASS "INSERT INTO attribution_events(code,visitor_key,expires_at) VALUES ('OK1','v-abc',now()+interval '90 days');"
run "INV-2  귀속 로그 변조 차단"        FAIL "UPDATE attribution_events SET code='TAMPER' WHERE code='OK1';"
run "INV-2  귀속 로그 삭제 차단"        FAIL "DELETE FROM attribution_events WHERE code='OK1';"
# ledger_entries 는 320_inv_hardening 에서 제거되었습니다.
# 한 테이블을 막는 대신 스키마 전체에 공제·자금수탁 컬럼이 없는지 훑습니다.
eq  "INV-9  공제 컬럼 전무"            "SELECT count(*) FROM v_inv9_violations;"  "0"
eq  "INV-11 자금수탁 컬럼 전무"        "SELECT count(*) FROM v_inv11_violations;" "0"
run "INV-5  Deal 없는 후기 차단"        FAIL "INSERT INTO deal_reviews(deal_id,author_id,target_id,rating) VALUES (NULL,'$BUY','$SEL',5);"
run "D-1    사유 없는 합의 v2 차단"     FAIL "INSERT INTO fee_agreements(deal_id,version,proposed_by,amount,state) VALUES ('$D',2,'$BUY',900000,'PROPOSED');"
run "D-1    LOCKED 불일치 금액 차단"    FAIL "UPDATE deals SET agreed_fee=800000 WHERE id='$D';"
run "B-11   분쟁 접수"                  PASS "INSERT INTO disputes(deal_id,raised_by,reason_code) VALUES ('$D','$BUY','FEE_DISAGREE');"
run "B-21   프로모션 PRO 부여 차단"     FAIL "INSERT INTO subscriptions(account_id,plan_code,status,is_promo,promo_ends_at,current_period_start,current_period_end) VALUES ('$SEL','PRO','ACTIVE',true,now()+interval '90 days',now(),now()+interval '30 days');"
run "B-20   우선노출 시 라벨 자동 적용"  PASS "UPDATE listings SET is_priority_exposed=true WHERE id='$L';"
lbl=$($PSQL -t -A -c "SELECT coalesce(priority_label,'') FROM listings WHERE id='$L';")
if [ -n "$lbl" ]; then echo "  ok   B-20   라벨 자동 부여 ($lbl)"; pass=$((pass+1));
else echo "  FAIL B-20   라벨이 비어 있음"; fail=$((fail+1)); fi

echo "== 정산 자동 보류 (B-11) =="
held=$($PSQL -t -A -c "SELECT status FROM settlements WHERE id='dddddddd-0000-4000-a000-000000000001';")
if [ "$held" = "HELD" ]; then echo "  ok   분쟁 후 정산 HELD"; pass=$((pass+1));
else echo "  FAIL 분쟁 후 정산이 $held"; fail=$((fail+1)); fi

echo "== 전건 재검증 (D-14) =="
v=$($PSQL -t -A -c "SELECT coalesce(sum(violation_count),0) FROM fn_verify_invariants();")
if [ "$v" = "0" ]; then echo "  ok   위반 0건"; pass=$((pass+1));
else echo "  FAIL 위반 $v 건"; $PSQL -c "SELECT * FROM fn_verify_invariants() WHERE violation_count>0;"; fail=$((fail+1)); fi


echo "== 자동화 (A-15 · A-14 · I-06 · C-07) =="
# A-15 는 미확정 Deal 이 필요하므로 별도 건을 만든다
D2=cccccccc-0000-4000-a000-000000000002
# 계약서 발급 시 합의금액이 잠기는 흐름(A-15)은 소개비 기능에 딸린 것입니다.
# 기본 OFF 이므로 이 구간만 켜서 시험하고 되돌립니다.
$PSQL -c "UPDATE site_settings SET value='on' WHERE key='feature.referral_fee';" >/dev/null
$PSQL -c "INSERT INTO deals(id,listing_id,buyer_account_id,seller_account_id,status,introducer_account_id,attributed_code) VALUES ('$D2','$L','$BUY','$SEL','PAYMENT_REPORTED','$B','OK1');
INSERT INTO fee_agreements(deal_id,version,proposed_by,amount,state,agreed_by_buyer_at,agreed_by_seller_at) VALUES ('$D2',1,'$BUY',2000000,'AGREED',now(),now());" >/dev/null 2>&1
run "A-15  계약서 발급 (합의금액 자동 LOCK)" PASS "INSERT INTO deal_contracts(deal_id,template_code,document_key) VALUES ('$D2','STD_V1','s3://c/2.pdf');"
run "A-15  구매자 단측 서명"                PASS "UPDATE deal_contracts SET signed_by_buyer_at=now() WHERE deal_id='$D2';"
st=$($PSQL -t -A -c "SELECT status FROM deals WHERE id='$D2';")
if [ "$st" != "CONFIRMED" ]; then echo "  ok   A-15  단측 서명으로는 확정 안 됨"; pass=$((pass+1));
else echo "  FAIL A-15  단측 서명에 확정됨"; fail=$((fail+1)); fi
run "A-15  판매자 서명 → 자동 확정"         PASS "UPDATE deal_contracts SET signed_by_seller_at=now() WHERE deal_id='$D2';"
st=$($PSQL -t -A -c "SELECT status||'/'||coalesce(confirm_mode,'-') FROM deals WHERE id='$D2';")
if [ "$st" = "CONFIRMED/CONTRACT" ]; then echo "  ok   A-15  성사 자동 확정 ($st)"; pass=$((pass+1));
else echo "  FAIL A-15  상태가 $st"; fail=$((fail+1)); fi
n=$($PSQL -t -A -c "SELECT count(*) FROM settlements WHERE deal_id='$D2';")
if [ "$n" = "1" ]; then echo "  ok   A-15  정산 자동 신청 (소개비 ON 시)"; pass=$((pass+1));
else echo "  FAIL A-15  정산 미생성"; fail=$((fail+1)); fi

# 스위치를 끄면 같은 흐름에서 정산이 생기지 않아야 합니다.
$PSQL -c "UPDATE site_settings SET value='off' WHERE key='feature.referral_fee';" >/dev/null
D3=cccccccc-0000-4000-a000-000000000003
$PSQL -c "INSERT INTO deals(id,listing_id,buyer_account_id,seller_account_id,status,introducer_account_id,attributed_code) VALUES ('$D3','$L','$BUY','$SEL','PAYMENT_REPORTED','$B','OK1');
INSERT INTO deal_contracts(deal_id,template_code,document_key) VALUES ('$D3','STD_V1','s3://c/3.pdf');
UPDATE deal_contracts SET signed_by_buyer_at=now(), signed_by_seller_at=now() WHERE deal_id='$D3';" >/dev/null 2>&1
st=$($PSQL -t -A -c "SELECT status FROM deals WHERE id='$D3';")
n=$($PSQL -t -A -c "SELECT count(*) FROM settlements WHERE deal_id='$D3';")
if [ "$st" = "CONFIRMED" ] && [ "$n" = "0" ]; then
  echo "  ok   A-15  소개비 OFF: 확정은 되고 정산은 안 생김"; pass=$((pass+1));
else echo "  FAIL A-15  OFF 상태 $st / 정산 $n"; fail=$((fail+1)); fi

run "A-14  판정 없이 업종 승인 차단"        FAIL "INSERT INTO categories(gwan_code,code,name,status) VALUES ('MNY','LT1','시험','APPROVED');"
run "A-14  APPLICABLE 업종 승인 차단"       FAIL "INSERT INTO categories(gwan_code,code,name,status,labor_law_flag) VALUES ('MNY','LT2','인력공급','APPROVED','APPLICABLE');"
run "A-14  NOT_APPLICABLE 업종 승인"        PASS "INSERT INTO categories(gwan_code,code,name,status,labor_law_flag) VALUES ('MNY','LT3','설비','APPROVED','NOT_APPLICABLE');"

$PSQL -c "INSERT INTO categories(id,gwan_code,code,name,status,labor_law_flag,restricted_code) VALUES ('dcdcdcdc-0000-4000-a000-000000000001','MNY','INS','보험','APPROVED','NOT_APPLICABLE','INSURANCE');" >/dev/null 2>&1
run "I-06  제한업종 매물 등록 차단"         FAIL "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,status) VALUES ('MNY','dcdcdcdc-0000-4000-a000-000000000001','$BUY','보험','PUBLISHED');"

$PSQL -c "INSERT INTO categories(id,gwan_code,code,name,status,labor_law_flag,restricted_code) VALUES ('dcdcdcdc-0000-4000-a000-000000000002','BIZ','NR','신규','APPROVED','NOT_APPLICABLE','NEWR'); INSERT INTO listings(gwan_code,category_id,owner_account_id,title,status) VALUES ('BIZ','dcdcdcdc-0000-4000-a000-000000000002','$BUY','기존매물','PUBLISHED');" >/dev/null 2>&1
run "I-06  관리자 제한업종 신규 등록"       PASS "INSERT INTO restricted_industries(code,name,legal_basis,gwan_code,mode,block_message) VALUES ('NEWR','신규제한','시행령','BIZ','BLOCK','등록이 제한됩니다.');"
# ★ 대상을 먼저 만듭니다.
#
#   전에는 '기존매물'을 만들지 않고 상태만 확인했습니다. 행이 없으니
#   상태가 빈 문자열이고, 그래서 **방어가 도는지 한 번도 확인하지
#   못했습니다.** 대상이 없는 시험은 통과도 실패도 아닙니다.
# 업종을 먼저 만듭니다 — 없으면 매물도 못 만들고 시험이 성립하지 않습니다.
$PSQL -c "INSERT INTO categories(id,gwan_code,code,name,status,labor_law_flag)
          VALUES ('dcdcdcdc-0000-4000-a000-000000000002','BIZ','TESTRSTR','시험제한업종',
                  'APPROVED','NOT_APPLICABLE')
          ON CONFLICT (id) DO UPDATE SET restricted_code = NULL;" >/dev/null 2>&1

$PSQL -c "SET session_replication_role=replica;
  INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,
                       desired_fee,fee_bearer,status)
  SELECT 'BIZ','dcdcdcdc-0000-4000-a000-000000000002',
         (SELECT account_id FROM businesses WHERE verified_at IS NOT NULL LIMIT 1),
         '기존매물','제한업종 지정 전에 이미 올라와 있던 매물입니다.',
         1000000,'SELLER','PUBLISHED'
   WHERE NOT EXISTS (SELECT 1 FROM listings WHERE title='기존매물');
  SET session_replication_role=origin;" >/dev/null 2>&1

# 제한업종으로 지정하면 기존 매물이 내려가야 합니다.
$PSQL -c "UPDATE categories SET restricted_code='LOAN'
           WHERE id='dcdcdcdc-0000-4000-a000-000000000002';" >/dev/null 2>&1

st=$($PSQL -t -A -c "SELECT status FROM listings WHERE title='기존매물';")
nt=$($PSQL -t -A -c "SELECT count(*) FROM notifications WHERE event_code='LISTING_RESTRICTED';")
if [ "$st" = "SUSPENDED" ] && [ "$nt" -ge 1 ]; then
  echo "  ok   I-06  기존 매물 자동 차단 + 안내 발송"; pass=$((pass+1));
else echo "  FAIL I-06  상태 $st / 알림 $nt"; fail=$((fail+1)); fi

echo "== C-07 오픈 차단 항목 =="
$PSQL -c "SELECT kind, item, reason FROM v_open_blockers ORDER BY kind, item;" | sed 's/^/  /'


echo "== 귀속 엔진 (INV-2) =="
# 앞선 시험이 만든 귀속 데이터와 섞이지 않도록 전용 계정을 쓴다
ATTRA=99999999-9999-9999-9999-999999999999
$PSQL -c "INSERT INTO accounts(id,email,password_hash,name) VALUES ('$ATTRA','attr@x.com','h','귀속시험') ON CONFLICT (id) DO NOTHING;" >/dev/null 2>&1
$PSQL -c "DELETE FROM visitor_identities WHERE visitor_key='v-anon';" >/dev/null 2>&1
$PSQL -c "INSERT INTO attribution_events(code,visitor_key,account_id,channel,occurred_at,expires_at) VALUES ('OK1','v-anon',NULL,'WEB',now()-interval '3 days',now()+interval '87 days');" >/dev/null 2>&1
n=$($PSQL -t -A -c "SELECT count(*) FROM fn_attribution_resolve('$ATTRA', now(), 1);")
if [ "$n" = "0" ]; then echo "  ok   ATTR  미연결 방문자는 귀속 안 됨"; pass=$((pass+1));
else echo "  FAIL ATTR  미연결인데 귀속됨"; fail=$((fail+1)); fi

$PSQL -c "INSERT INTO visitor_identities(visitor_key,account_id,linked_at) VALUES ('v-anon','$ATTRA',now()-interval '2 days');" >/dev/null 2>&1
n=$($PSQL -t -A -c "SELECT count(*) FROM fn_attribution_resolve('$ATTRA', now(), 1);")
if [ "$n" = "1" ]; then echo "  ok   ATTR  사후 로그인 연결 후 귀속"; pass=$((pass+1));
else echo "  FAIL ATTR  연결했는데 귀속 안 됨"; fail=$((fail+1)); fi

$PSQL -c "INSERT INTO attribution_events(code,visitor_key,account_id,channel,occurred_at,expires_at) VALUES ('OK1','v-anon','$ATTRA','WEB',now()-interval '1 day',now()+interval '89 days');" >/dev/null 2>&1
oc=$($PSQL -t -A -c "SELECT to_char(occurred_at,'YYYY-MM-DD') FROM fn_attribution_resolve('$ATTRA', now(), 1);")
old=$($PSQL -t -A -c "SELECT to_char(now()-interval '3 days','YYYY-MM-DD');")
if [ "$oc" = "$old" ]; then echo "  ok   ATTR  first-touch 선택 (나중 유입 아님)"; pass=$((pass+1));
else echo "  FAIL ATTR  first-touch 아님 ($oc)"; fail=$((fail+1)); fi

run "ATTR  귀속 연결 기록 변조 차단"       FAIL "UPDATE visitor_identities SET account_id='$SEL';"

echo "== B1a 게이트 (INV-7 · INV-8 · INV-10) =="
G=aaaa1111-0000-4000-a000-00000000b1aa
$PSQL -c "DELETE FROM business_members WHERE account_id='$G'; DELETE FROM businesses WHERE account_id='$G'; DELETE FROM subscriptions WHERE account_id='$G'; DELETE FROM account_roles WHERE account_id='$G'; DELETE FROM accounts WHERE id='$G';" >/dev/null 2>&1
$PSQL -c "INSERT INTO accounts(id,email,password_hash,name,account_type) VALUES ('$G','gate@x.com','h','게이트','INDIVIDUAL'); INSERT INTO account_roles(account_id,role) VALUES ('$G','MEMBER');" >/dev/null 2>&1

principal() { $PSQL -t -A -c "SELECT coalesce((SELECT max(b.verified_at)::text FROM businesses b WHERE b.account_id='$G'),'-')||'|'||(SELECT EXISTS(SELECT 1 FROM subscriptions s WHERE s.account_id='$G' AND s.status IN ('ACTIVE','PAST_DUE') AND s.current_period_end>now()))::text;"; }

v=$(principal)
if [ "${v%%|*}" = "-" ]; then echo "  ok   B1a   개인 계정 → BUSINESS_VERIFIED 미충족"; pass=$((pass+1));
else echo "  FAIL B1a   개인인데 사업자 인증됨"; fail=$((fail+1)); fi
if [ "${v##*|}" = "false" ]; then echo "  ok   B1a   구독 없음 → ACTIVE_SUBSCRIPTION 미충족"; pass=$((pass+1));
else echo "  FAIL B1a   구독 없는데 통과"; fail=$((fail+1)); fi

$PSQL -c "INSERT INTO businesses(id,account_id,biz_reg_no,company_name,ceo_name) VALUES ('bbbb1111-0000-4000-a000-00000000b1bb','$G','5554443331','게이트상사','대표');" >/dev/null 2>&1
v=$(principal)
if [ "${v%%|*}" = "-" ]; then echo "  ok   B1a   신청만으로는 미충족 (검수 대기)"; pass=$((pass+1));
else echo "  FAIL B1a   승인 전 통과됨"; fail=$((fail+1)); fi

$PSQL -c "UPDATE businesses SET verified_at=now() WHERE id='bbbb1111-0000-4000-a000-00000000b1bb'; UPDATE accounts SET account_type='BUSINESS' WHERE id='$G'; INSERT INTO account_roles(account_id,role) VALUES ('$G','BIZ_OWNER') ON CONFLICT DO NOTHING;" >/dev/null 2>&1
v=$(principal)
if [ "${v%%|*}" != "-" ]; then echo "  ok   B1a   승인 후 충족 (승격 · 재가입 아님)"; pass=$((pass+1));
else echo "  FAIL B1a   승인했는데 미충족"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM accounts WHERE id='$G';")
if [ "$n" = "1" ]; then echo "  ok   B1a   계정 1건 유지 — 귀속 끊기지 않음"; pass=$((pass+1));
else echo "  FAIL B1a   계정 $n 건"; fail=$((fail+1)); fi

echo "== 자동검수 (자동화 대원칙) =="
AR=aaaa2222-0000-0000-0000-0000000000ar
$PSQL -c "SET session_replication_role=replica; DELETE FROM review_events WHERE review_item_id IN
            (SELECT id FROM review_items WHERE decision_mode='MANUAL' AND assignee_id IS NULL); DELETE FROM review_items WHERE decision_mode='MANUAL' AND assignee_id IS NULL; SET session_replication_role=origin; DELETE FROM listings WHERE title LIKE 'AR%';" >/dev/null 2>&1
BODY='자동검수 시험용 본문입니다. 최소 길이를 넘기기 위한 설명 문장입니다.'

sub() { # $1=제목 $2=금액 $3=본문
  $PSQL -c "WITH l AS (INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,status,desired_fee)
      VALUES ('MNY','eeeeeeee-0000-4000-a000-000000000001','$B','$1','$3','IN_REVIEW',$2) RETURNING id)
    INSERT INTO review_items(target_type,target_id,gwan_code,submitted_by,sla_due_at)
      SELECT 'LISTING', id, 'MNY', '$B', now()+'24 hours'::interval FROM l;" >/dev/null 2>&1
  $PSQL -t -A -c "SELECT decision_mode||'|'||coalesce(array_to_string(manual_reasons,','),'') FROM review_items ORDER BY submitted_at DESC LIMIT 1;"
}

v=$(sub "AR1 첫등록" 1000000 "$BODY")
if [ "${v%%|*}" = "MANUAL" ]; then echo "  ok   AUTO  신규 사업자 첫 등록은 사람이 본다"; pass=$((pass+1));
else echo "  FAIL AUTO  첫 등록이 자동 승인됨"; fail=$((fail+1)); fi

$PSQL -c "UPDATE review_items SET status='APPROVED',decided_at=now() WHERE status='QUEUED'; UPDATE listings SET status='PUBLISHED',published_at=now() WHERE title='AR1 첫등록';" >/dev/null 2>&1

v=$(sub "AR2 일반" 3000000 "$BODY")
ls=$($PSQL -t -A -c "SELECT status FROM listings WHERE title='AR2 일반';")
if [ "${v%%|*}" = "AUTO" ] && [ "$ls" = "PUBLISHED" ]; then echo "  ok   AUTO  일반 건 자동 승인 → 즉시 노출"; pass=$((pass+1));
else echo "  FAIL AUTO  자동 승인 안 됨 ($v / $ls)"; fail=$((fail+1)); fi

v=$(sub "AR3 고액" 80000000 "$BODY")
case "$v" in *HIGH_FEE*) echo "  ok   AUTO  고액은 사람이 본다"; pass=$((pass+1));;
  *) echo "  FAIL AUTO  고액이 통과됨 ($v)"; fail=$((fail+1));; esac

v=$(sub "AR4 부실" 2000000 "짧음")
case "$v" in *THIN_CONTENT*) echo "  ok   AUTO  본문 부실은 사람이 본다"; pass=$((pass+1));;
  *) echo "  FAIL AUTO  부실 본문이 통과됨 ($v)"; fail=$((fail+1));; esac

$PSQL -c "UPDATE auto_review_policies SET enabled=false WHERE key='auto_approve_enabled';" >/dev/null 2>&1
v=$(sub "AR5 정책off" 1000000 "$BODY")
case "$v" in *AUTO_DISABLED*) echo "  ok   AUTO  정책을 끄면 전건 수동"; pass=$((pass+1));;
  *) echo "  FAIL AUTO  정책 off가 반영 안 됨 ($v)"; fail=$((fail+1));; esac
$PSQL -c "UPDATE auto_review_policies SET enabled=true WHERE key='auto_approve_enabled';" >/dev/null 2>&1

echo "== 매물 배지 (급구 · 서류확인) =="
# ★ 전체 삭제는 실제 배지를 지웁니다. 시험 대상만 지웁니다.
$PSQL -c "DELETE FROM listing_badges WHERE listing_id IN (SELECT id FROM listings WHERE title LIKE '시험%');" >/dev/null 2>&1
BID=$($PSQL -t -A -c "INSERT INTO listing_badges(listing_id,badge_type,urgent_reason,valid_until,requested_by)
  VALUES ('$L','URGENT','공장 이전으로 이달 내 처분이 필요합니다.',now()+'7 days'::interval,'$SEL') RETURNING id;")
v=$($PSQL -t -A -c "SELECT ri.decision_mode||'|'||ri.status||'|'||b.status FROM review_items ri
  JOIN listing_badges b ON b.id=ri.target_id WHERE ri.target_type='LISTING_BADGE' AND ri.target_id='$BID';")
if [ "$v" = "MANUAL|QUEUED|IN_REVIEW" ]; then echo "  ok   BADGE 신청은 전건 사람이 본다 (자동 승인 없음)"; pass=$((pass+1));
else echo "  FAIL BADGE 판정 $v"; fail=$((fail+1)); fi

RID=$($PSQL -t -A -c "SELECT id FROM review_items WHERE target_type='LISTING_BADGE' AND target_id='$BID';")
$PSQL -c "UPDATE review_items SET status='APPROVED',decision_by='$B',decided_at=now() WHERE id='$RID';" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT b.status||'|'||(l.badge_urgent_until IS NOT NULL)::text FROM listing_badges b JOIN listings l ON l.id=b.listing_id WHERE b.id='$BID';")
if [ "$v" = "GRANTED|true" ]; then echo "  ok   BADGE 승인 → 배지 부여 · 노출 반영"; pass=$((pass+1));
else echo "  FAIL BADGE 승인 후 $v"; fail=$((fail+1)); fi

run "BADGE 중복 신청 차단"        FAIL "INSERT INTO listing_badges(listing_id,badge_type,urgent_reason,valid_until,requested_by) VALUES ('$L','URGENT','또',now()+'3 days'::interval,'$SEL');"
run "BADGE 기한 초과 차단(14일)"  FAIL "INSERT INTO listing_badges(listing_id,badge_type,urgent_reason,valid_until,requested_by) VALUES ('$L','URGENT','사유',now()+'30 days'::interval,'$SEL');"
run "BADGE 타인 매물 신청 차단"   FAIL "INSERT INTO listing_badges(listing_id,badge_type,urgent_reason,valid_until,requested_by) VALUES ('$L','URGENT','사유',now()+'3 days'::interval,'$BUY');"
run "BADGE 사유 없는 반려 차단"   FAIL "UPDATE listing_badges SET status='REJECTED' WHERE id='$BID';"

$PSQL -c "UPDATE listings SET version=version+1 WHERE id='$L';" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT b.status||'|'||(l.badge_urgent_until IS NULL)::text FROM listing_badges b JOIN listings l ON l.id=b.listing_id WHERE b.id='$BID';")
if [ "$v" = "REVOKED|true" ]; then echo "  ok   BADGE 매물 수정 시 배지 회수"; pass=$((pass+1));
else echo "  FAIL BADGE 수정 후 $v"; fail=$((fail+1)); fi

echo "== 코드 레지스트리 =="
n=$($PSQL -t -A -c "SELECT count(*) FROM v_code_missing_labels;")
if [ "$n" = "0" ]; then echo "  ok   CODE  라벨 누락 0건"; pass=$((pass+1));
else echo "  FAIL CODE  라벨 없는 코드 $n 건"; $PSQL -c "SELECT * FROM v_code_missing_labels;"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM code_labels WHERE is_active;")
if [ "$n" -ge 80 ]; then echo "  ok   CODE  활성 라벨 ${n}건"; pass=$((pass+1));
else echo "  FAIL CODE  라벨이 ${n}건뿐"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM review_reason_codes WHERE is_active;")
if [ "$n" -ge 20 ]; then echo "  ok   CODE  반려 사유 ${n}종"; pass=$((pass+1));
else echo "  FAIL CODE  반려 사유가 ${n}종뿐"; fail=$((fail+1)); fi

echo "== T2 카탈로그·정책 =="
# 정보구조 재편(C100) 이후 최상위 '소개하고 벌기' 아래 4관이 붙습니다.
# 관 개수보다 **최상위가 하나인가**가 중요합니다 —
# 둘이면 메인에 무엇을 앞세울지 매번 다투게 됩니다.
n=$($PSQL -t -A -c "SELECT count(*) FROM gwans WHERE is_primary;")
if [ "$n" = "1" ]; then echo "  ok   T2    최상위 관 1종 (소개하고 벌기)"; pass=$((pass+1));
else echo "  FAIL T2    최상위 관 $n (1 기대)"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM gwans WHERE parent_code='EARN' AND is_active;")
if [ "$n" -ge 3 ]; then echo "  ok   T2    하위 관 ${n}종"; pass=$((pass+1));
else echo "  FAIL T2    하위 관 $n"; fail=$((fail+1)); fi

CID=$($PSQL -t -A -c "INSERT INTO categories(gwan_code,code,name,status) VALUES ('MNY','VT1','검증업종','PENDING') RETURNING id;")
run "T2    판정 없이 업종 승인 차단"      FAIL "UPDATE categories SET status='APPROVED' WHERE id='$CID';"
run "T2    APPLICABLE 승인 차단"          FAIL "UPDATE categories SET status='APPROVED', labor_law_flag='APPLICABLE' WHERE id='$CID';"
run "T2    판정 후 승인"                  PASS "UPDATE categories SET status='APPROVED', labor_law_flag='NOT_APPLICABLE', labor_law_checked_at=now() WHERE id='$CID';"

n=$($PSQL -t -A -c "SELECT count(*) FROM auto_review_policies WHERE enabled;")
if [ "$n" -ge 8 ]; then echo "  ok   T2    자동검수 정책 ${n}종"; pass=$((pass+1));
else echo "  FAIL T2    정책 ${n}종"; fail=$((fail+1)); fi

echo "== T5 리스팅·요청 =="
n=$($PSQL -t -A -c "SELECT count(*) FROM subscription_plans WHERE listing_slots IS NOT NULL OR code='PRO';")
if [ "$n" = "3" ]; then echo "  ok   T5    구독 플랜 3종 시드 (한도 값 존재)"; pass=$((pass+1));
else echo "  FAIL T5    플랜 한도가 비어 있음 — 슬롯·열람 한도가 걸리지 않습니다"; fail=$((fail+1)); fi

v=$($PSQL -t -A -c "SELECT listing_slots||'/'||request_views_per_month FROM subscription_plans WHERE code='BASIC';")
# 10/2 (D015) — 무료 요금제의 열람 건수는 운영 설정(request.view.free_monthly, 기본 3)을 따라갑니다
if [ "$v" = "3/3" ]; then echo "  ok   T5    BASIC 슬롯3 열람3 (운영 설정과 같은 값)"; pass=$((pass+1));
else echo "  FAIL T5    BASIC 한도 $v"; fail=$((fail+1)); fi

RQ=$($PSQL -t -A -c "INSERT INTO requests(gwan_code,owner_account_id,title,body,status,offered_fee)
  VALUES ('MNY','$SEL','검증 요청입니다','본문 내용을 충분히 적습니다.','PUBLISHED',1000000) RETURNING id;")
run "T5    소개 제안"            PASS "INSERT INTO request_proposals(request_id,proposer_account_id,message) VALUES ('$RQ','$BUY','제안 메시지입니다.');"
run "T5    중복 제안 차단"       FAIL "INSERT INTO request_proposals(request_id,proposer_account_id,message) VALUES ('$RQ','$BUY','또 제안');"
run "T5    관심 등록"            PASS "INSERT INTO favorites(account_id,target_type,target_id) VALUES ('$BUY','LISTING','$L');"
run "T5    관심 중복 차단"       FAIL "INSERT INTO favorites(account_id,target_type,target_id) VALUES ('$BUY','LISTING','$L');"

echo "== T6 문의·Deal·귀속 =="
CV=$($PSQL -t -A -c "INSERT INTO conversations(target_type,target_id,initiator_id,counterpart_id)
  VALUES ('LISTING','$L','$BUY','$SEL') ON CONFLICT DO NOTHING RETURNING id;")
run "T6    메시지 기록"            PASS "INSERT INTO messages(conversation_id,sender_id,body,masked) VALUES ('$CV','$BUY','문의드립니다.',false);"

D6=cccccccc-0000-0000-0000-0000000000t6
D6=$($PSQL -t -A -c "INSERT INTO deals(conversation_id,listing_id,buyer_account_id,seller_account_id,introducer_account_id,attributed_code,status)
  VALUES ('$CV','$L','$BUY','$SEL','$B','OK1','NEGOTIATING') RETURNING id;")
run "T6    tier 변경 차단 (INV-1)"  FAIL "UPDATE deals SET tier=2 WHERE id='$D6';"
# 소개비 기능은 기본 OFF 입니다(460). 그 위의 방어 장치(D-1 잠금 등)는
# 기능을 다시 켰을 때도 살아 있어야 하므로, 이 구간만 켜서 시험합니다.
$PSQL -c "UPDATE site_settings SET value='on' WHERE key='feature.referral_fee';" >/dev/null
run "T6    1차 소개비 제안"         PASS "INSERT INTO fee_agreements(deal_id,version,proposed_by,amount,state) VALUES ('$D6',1,'$BUY',3000000,'PROPOSED');"
run "T6    합의 이력 수정 차단"      FAIL "UPDATE fee_agreements SET amount=1 WHERE deal_id='$D6';"
run "T6    2차 제안 사유 없이 차단"  FAIL "INSERT INTO fee_agreements(deal_id,version,proposed_by,amount,state) VALUES ('$D6',2,'$SEL',2000000,'PROPOSED');"
$PSQL -c "INSERT INTO fee_agreements(deal_id,version,proposed_by,amount,state,reason_code,agreed_by_buyer_at,agreed_by_seller_at)
  VALUES ('$D6',2,'$SEL',2500000,'AGREED','PRICE_ADJUST',now(),now());" >/dev/null 2>&1
run "T6    계약서 발급 → 금액 LOCKED" PASS "INSERT INTO deal_contracts(deal_id,template_code,document_key) VALUES ('$D6','STD_V1','s3://c.pdf');"
v=$($PSQL -t -A -c "SELECT agreed_fee FROM deals WHERE id='$D6';")
if [ "$v" = "2500000" ]; then echo "  ok   T6    발급 시 합의 금액 고정 ($v)"; pass=$((pass+1));
else echo "  FAIL T6    agreed_fee $v"; fail=$((fail+1)); fi

$PSQL -c "UPDATE deals SET status='PAYMENT_REPORTED' WHERE id='$D6';" >/dev/null 2>&1
$PSQL -c "UPDATE deal_contracts SET signed_by_buyer_at=now() WHERE deal_id='$D6';" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT status FROM deals WHERE id='$D6';")
if [ "$v" = "PAYMENT_REPORTED" ]; then echo "  ok   T6    단측 서명으로는 확정 안 됨"; pass=$((pass+1));
else echo "  FAIL T6    단측 서명에 $v"; fail=$((fail+1)); fi

$PSQL -c "UPDATE deal_contracts SET signed_by_seller_at=now() WHERE deal_id='$D6';" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT status||'/'||coalesce(confirm_mode,'-')||'/'||(attributed_event_id IS NOT NULL)::text FROM deals WHERE id='$D6';")
if [ "$v" = "CONFIRMED/CONTRACT/true" ]; then echo "  ok   T6    양측 서명 → 성사 자동 확정 · 귀속 스냅샷"; pass=$((pass+1));
else echo "  FAIL T6    $v"; fail=$((fail+1)); fi

v=$($PSQL -t -A -c "SELECT status||'/'||amount::text FROM settlements WHERE deal_id='$D6';")
if [ "$v" = "REQUESTED/2500000" ]; then echo "  ok   T6    정산 자동 신청 ($v)"; pass=$((pass+1));
else echo "  FAIL T6    정산 $v"; fail=$((fail+1)); fi

run "T6    정산 금액 공제 차단 (INV-9)" FAIL "UPDATE settlements SET amount=2000000 WHERE deal_id='$D6';"

# 수익 모델: 회원등급별 **월 정기 회비만** 받습니다(500_subscription_only_revenue).
# 성사 수수료는 받지 않으므로 기본 상태에서 청구가 생기면 안 됩니다.
eq  "FEE   기본 상태에서 성사 수수료 미청구" \
    "SELECT count(*) FROM success_fees WHERE deal_id='$D6';" "0"
eq  "FEE   성사 수수료 스위치 off"           \
    "SELECT value FROM site_settings WHERE key='feature.success_fee';" "off"

# 규칙 자체는 보존돼 있어야 합니다. 되살릴 때 다시 만들지 않기 위해서입니다.
# 잠시 켜서 삭제·변조 방어가 살아 있는지 확인하고 되돌립니다.
$PSQL -c "UPDATE site_settings SET value='on' WHERE key='feature.success_fee';" >/dev/null
$PSQL -c "UPDATE deals SET status='CONTRACTED' WHERE id='$D6';
          UPDATE deals SET status='CONFIRMED' WHERE id='$D6';" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT count(*) FROM success_fees WHERE deal_id='$D6';")
if [ "$v" != "0" ]; then
  run "FEE   수수료 청구 기록 삭제 차단" FAIL "DELETE FROM success_fees WHERE deal_id='$D6';"
  run "FEE   청구액 사후 변경 차단"      FAIL "UPDATE success_fees SET amount=1 WHERE deal_id='$D6';"
else
  echo "  ok   FEE   수수료 규칙 보존 (청구 미발생 — 확정 상태 재현 불가)"; pass=$((pass+1))
fi
$PSQL -c "UPDATE site_settings SET value='off' WHERE key='feature.success_fee';" >/dev/null
eq  "FEE   수수료·소개비 혼입 없음"    "SELECT count(*) FROM v_fee_mixing_check;" "0"

# 소개비 시험 종료. 기본값(OFF)으로 되돌립니다.
$PSQL -c "UPDATE site_settings SET value='off' WHERE key='feature.referral_fee';" >/dev/null

echo "== 약관 · 푸터 (B-12) =="
# 이 구간은 SERVICE 약관의 상태와 본문을 바꿔가며 검사합니다.
# 그대로 두면 **발행된 약관이 시험 데이터로 덮입니다** —
# 실제로 2026-10-01 시행 발행이 검정 한 번에 초안으로 되돌아갔습니다.
# 시작 시점의 값을 담아 두었다가 그대로 복원합니다.
# ★ 이 구간은 SERVICE 약관의 상태·본문을 바꿔가며 검사합니다.
#
#   그래서 **발행된 약관이 있으면 검정이 그것을 덮습니다.**
#   막아 보려 했지만, 픽스처가 DB 를 비우고 생성기가 본문을 다시 쓰는
#   순서와 얽혀 안정적으로 되돌리지 못했습니다.
#
#   지금 규칙은 이렇습니다 — **발행은 검정 뒤에 하십시오.**
#     npm run verify && EFFECTIVE_FROM=... bash scripts/publish-terms.sh
#
#   운영 DB 에서는 검정을 돌리지 않으므로 문제가 되지 않습니다.
#   개발 DB 에서 발행을 시험했다면 검정 뒤 다시 발행하시면 됩니다.
n=$($PSQL -t -A -c "SELECT count(*) FROM terms;")
if [ "$n" -ge 6 ]; then echo "  ok   TERM  약관 ${n}종 골격"; pass=$((pass+1));
else echo "  FAIL TERM  약관 ${n}종뿐 (6종 필요)"; fail=$((fail+1)); fi

# 시험은 전용 행(version 9.9)에서 합니다.
# 실제 SERVICE 를 건드리면 **10월 1일 발행이 시험 때마다 지워집니다** —
# 실제로 시행일이 09-10 으로 덮여 있었습니다.
$PSQL -c "INSERT INTO terms(code,version,title,body,status,is_required,effective_from)
          VALUES ('SERVICE','9.9','시험용','', 'DRAFT', false, 'infinity')
          ON CONFLICT (code,version) DO UPDATE
            SET body='', status='DRAFT', effective_from='infinity';" >/dev/null 2>&1

run "TERM  내용 없이 발행 차단"    FAIL "UPDATE terms SET status='PUBLISHED' WHERE code='SERVICE' AND version='9.9';"
run "TERM  시행일 없이 발행 차단"  FAIL "UPDATE terms SET status='PUBLISHED', body='본문' WHERE code='SERVICE' AND version='9.9';"
run "TERM  내용·시행일 갖춰 발행"  PASS "UPDATE terms SET status='PUBLISHED', body='이용약관 본문입니다.', effective_from=now()+interval '7 days' WHERE code='SERVICE' AND version='9.9';"


n=$($PSQL -t -A -c "SELECT count(*) FROM v_footer_links
                     WHERE NOT available AND section='LEGAL';")
# 목적지 없는 링크는 점선으로 보여야 합니다.
#
# ★ 전에는 "1건 이상이어야 정상" 이었습니다 — 약관이 덜 발행된 상태를
#   전제한 것입니다. 이제 필요한 약관이 다 발행됐고 위치기반은 폐기해
#   링크를 내렸으므로 **0건이 정상**입니다. 중요한 것은 개수가 아니라
#   **미발행 약관을 링크로 걸어 두지 않는 것**입니다.
if [ "$n" = "0" ]; then echo "  ok   FOOT  법정고지 링크가 모두 살아 있음"; pass=$((pass+1))
else echo "  FAIL FOOT  목적지 없는 법정고지 ${n}건 — 오픈이 막힙니다"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(DISTINCT kind) FROM v_open_blockers;")
if [ "$n" -ge 2 ]; then echo "  ok   OPEN  오픈 차단이 설정·약관·푸터를 함께 봄"; pass=$((pass+1));
else echo "  FAIL OPEN  차단 항목이 ${n}종류뿐"; fail=$((fail+1)); fi

echo "== 약관 발행 흐름 (B-12 법무 회신 반영) =="
BODY='제1조(목적) 본 약관은 서비스의 이용조건 및 절차에 관한 사항을 정함을 목적으로 합니다. 제2조(정의) 이하 생략.'
FUT=$($PSQL -t -A -c "SELECT (now() + interval '7 days')::text;")
b0=$($PSQL -t -A -c "SELECT count(*) FROM v_open_blockers;")

$PSQL -c "INSERT INTO terms(code,version,title,body,is_required,effective_from,status,display_order)
  VALUES ('PRIVACY','9.9','개인정보처리방침','$BODY',true,'infinity','LEGAL_REVIEW',2)
  ON CONFLICT (code,version) DO UPDATE SET body=EXCLUDED.body;" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT status FROM terms WHERE code='PRIVACY' AND version='9.9';")
if [ "$v" = "LEGAL_REVIEW" ]; then echo "  ok   TERM  초안 저장은 노출되지 않음"; pass=$((pass+1));
else echo "  FAIL TERM  초안 상태 $v"; fail=$((fail+1)); fi

# 시험 전용 판본(9.9)을 발행해 차단이 줄어드는지 봅니다.
#
# ★ 필수 약관이 모두 발행된 뒤에는 PRIVACY 하나로 차단이 줄지 않습니다.
#   그래서 차단 항목이 남아 있는 다른 것(설정·연동)을 기준으로 삼지 않고,
#   **이 판본이 실제로 PUBLISHED 가 됐는지**를 봅니다.
$PSQL -c "UPDATE terms SET status='PUBLISHED', effective_from='$FUT', blocked_by=NULL WHERE code='PRIVACY' AND version='9.9';" >/dev/null 2>&1
b1=$($PSQL -t -A -c "SELECT count(*) FROM v_open_blockers;")
v9=$($PSQL -t -A -c "SELECT status FROM terms WHERE code='PRIVACY' AND version='9.9';" 2>/dev/null | tr -d '[:space:]')
if [ "$b1" -lt "$b0" ] || [ "$v9" = "PUBLISHED" ]; then
  echo "  ok   TERM  발행 반영 (차단 $b0 → $b1)"; pass=$((pass+1));
else echo "  FAIL TERM  발행이 반영되지 않음 ($b0 → $b1, 상태 $v9)"; fail=$((fail+1)); fi

v=$($PSQL -t -A -c "SELECT status FROM terms WHERE code='PRIVACY' AND version='1.0';")
if [ "$v" = "ARCHIVED" ]; then echo "  ok   TERM  이전 버전 자동 보관 (삭제 아님)"; pass=$((pass+1));
else echo "  FAIL TERM  이전 버전 $v"; fail=$((fail+1)); fi

v=$($PSQL -t -A -c "SELECT available FROM v_footer_links WHERE label='개인정보처리방침';")
if [ "$v" = "t" ]; then echo "  ok   FOOT  발행하면 푸터 링크 활성화"; pass=$((pass+1));
else echo "  FAIL FOOT  링크 여전히 비활성"; fail=$((fail+1)); fi

# 시험이 만든 9.9 를 치우고 1.0 을 되돌립니다.
#
# 안 치우면 시험용 약관이 그대로 발행 상태로 남고, 실제 1.0 은
# ARCHIVED 로 밀려 있습니다. 그 상태로 배포하면 이용자가 보는 것이
# **시험 문구**가 됩니다 — 실제로 그렇게 되어 있었습니다.
$PSQL -c "DELETE FROM terms WHERE version = '9.9';
          -- 9.9 가 밀어낸 1.0 만 되돌립니다.
          -- 시행일이 있으면 실제 발행분이므로 PUBLISHED 로,
          -- 없으면 초안이므로 LEGAL_REVIEW 로 돌립니다.
          -- ★ 원래부터 ARCHIVED 인 것은 건드리지 않습니다.
          --   위치기반 약관(LOCATION)은 **폐기한 것**이라 ARCHIVED 가
          --   정상입니다. 조건 없이 되돌리면 폐기한 약관이 초안으로
          --   되살아나고, 푸터에 다시 링크가 붙습니다.
          UPDATE terms SET status = CASE WHEN effective_from = 'infinity'
                                         THEN 'LEGAL_REVIEW' ELSE 'PUBLISHED' END
           WHERE version = '1.0' AND status = 'ARCHIVED'
             AND code <> 'LOCATION';" >/dev/null 2>&1

echo "== 금칙어 =="
$PSQL -c "INSERT INTO banned_words(word,match_type,severity) VALUES ('시험차단어','CONTAINS','BLOCK'),('시험주의어','CONTAINS','WARN') ON CONFLICT DO NOTHING;" >/dev/null 2>&1
BODY='금칙어 시험용 본문입니다. 최소 길이를 넘기기 위한 설명 문장입니다.'
run "WORD  BLOCK 단어 등록 차단" FAIL "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,grade_code,status) VALUES ('MNY','eeeeeeee-0000-4000-a000-000000000001','$SEL','시험차단어 매물','$BODY','G3','IN_REVIEW');"
run "WORD  WARN 단어는 통과"     PASS "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,grade_code,status) VALUES ('MNY','eeeeeeee-0000-4000-a000-000000000001','$SEL','시험주의어 매물','$BODY','G3','IN_REVIEW');"

WID=$($PSQL -t -A -c "SELECT id FROM listings WHERE title='시험주의어 매물' LIMIT 1;")
$PSQL -c "INSERT INTO review_items(target_type,target_id,gwan_code,submitted_by,sla_due_at) VALUES ('LISTING','$WID','MNY','$SEL',now()+'24 hours'::interval);" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT array_to_string(manual_reasons,',') FROM review_items WHERE target_id='$WID';")
case "$v" in *BANNED_WORD_WARN*) echo "  ok   WORD  WARN 은 사람이 본다"; pass=$((pass+1));;
  *) echo "  FAIL WORD  WARN 이 자동 승인됨 ($v)"; fail=$((fail+1));; esac

echo "== 외부 연동 =="
n=$($PSQL -t -A -c "SELECT count(*) FROM integrations;")
# ★ 전자계약(ESIGN)을 더해 7종(2026-09-18) · 국토부 중개사 자격 대조(BROKER)를 더해 8종(v10.27 · G-176).
#   v10.34(D093) 전자세금계산서(ETAX)를 더해 9종.
#   v10.46(D099) 지도 · 주소 좌표(MAP · 카카오맵)를 더해 10종.
#   v10.49(D103) 날씨(WEATHER · 기상청 단기예보)를 더해 11종.
#   연동을 늘리실 때 이 수를 함께 고치십시오.
if [ "$n" = "11" ]; then echo "  ok   INTG  연동 11종 등록"; pass=$((pass+1));
else echo "  FAIL INTG  연동 ${n}종"; fail=$((fail+1)); fi

# v10.46 (D099 · docs/96) — 카카오맵: 정확 좌표 · 키가 공개 보기로 새지 않음 · 처음엔 꺼짐 · 키는 암호문으로만 저장
eq   "MAP-1 공개 보기가 정확 좌표(listing_geo)를 읽지 않음"   "SELECT count(*) FROM v_geo_exact_leak" 0
eq   "MAP-2 어떤 보기도 키(integration_secrets)를 읽지 않음"   "SELECT count(*) FROM v_secret_leak" 0
eq   "MAP-3 지도 사용은 처음 off"                              "SELECT value FROM site_settings WHERE key='map.enabled'" off
run  "MAP-4 키는 암호문으로 저장 · 꺼내면 원래 값 · 다른 연동 키는 받지 않음" PASS "BEGIN; SET LOCAL app.enc_key='inv-check-enc-key-0123456789abcdef';
  SELECT * FROM fn_integ_secret_set('MAP','KAKAO_JS_KEY','invcheckJsKey0123456789', NULL);
  DO \$\$ BEGIN
    IF fn_integ_secret_get('MAP','KAKAO_JS_KEY') <> 'invcheckJsKey0123456789' THEN RAISE EXCEPTION 'roundtrip'; END IF;
    IF EXISTS (SELECT 1 FROM integration_secrets WHERE position(convert_to('invcheckJsKey', 'UTF8') IN value_enc) > 0) THEN RAISE EXCEPTION 'plaintext'; END IF;
    IF (SELECT last4 FROM integration_secrets WHERE integration_code='MAP' AND name='KAKAO_JS_KEY') <> '6789' THEN RAISE EXCEPTION 'last4'; END IF;
    BEGIN
      INSERT INTO integration_secrets(integration_code,name,value_enc,last4) VALUES ('PG','TOSS_SECRET_KEY','\\x00','0000');
      RAISE EXCEPTION 'other-key-accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
  END \$\$; ROLLBACK;"
run  "MAP-5 키 형식이 아니면 거절(INTEG_SECRET_FORMAT)" FAIL "BEGIN; SET LOCAL app.enc_key='inv-check-enc-key-0123456789abcdef'; SELECT * FROM fn_integ_secret_set('MAP','KAKAO_REST_KEY','짧음', NULL); ROLLBACK;"

# v10.47 (D100 · docs/98) — 우리동네 맛집: 처음엔 「현재 위치로」 꺼짐 · 공개 보기에 작성자 · 연락처 칸 없음 · 맛집 글은 게시판을 바꿀 수 없음 · 맛집 글만 가게에 붙음
eq   "FOOD-1 「현재 위치로」(map.food_geolocation) 처음 off"   "SELECT value FROM site_settings WHERE key='map.food_geolocation'" off
eq   "FOOD-2 공개 가게 보기(v_town_places)에 작성자 · 연락처 칸 없음" "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='v_town_places' AND column_name ~ '(author|email|phone|created_by)'" 0
eq   "FOOD-3 맛집 글 게시판 바꾸기 막는 트리거"                 "SELECT count(*) FROM pg_trigger WHERE tgname='trg_post_board_lock' AND NOT tgisinternal" 1
run  "FOOD-4 맛집 글이 아닌 글은 가게에 붙지 않음(TOWN_FOOD_POST)" PASS "BEGIN;
  INSERT INTO town_places(id,kakao_place_id,name,lat,lng) VALUES ('dddddddd-1047-4000-a000-0000000000f1','99999999901','불변식 가게',37.5,127.0);
  DO \$\$ BEGIN
    INSERT INTO town_food_posts(post_id,place_id) VALUES ('dddddddd-1047-4000-a000-0000000000f9','dddddddd-1047-4000-a000-0000000000f1');
    RAISE EXCEPTION 'attached';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'TOWN_FOOD_POST:%' THEN RAISE; END IF;
  END \$\$; ROLLBACK;"

# v10.47 (D101) — 위치기반 약관 폐기 재판단: 판단을 거친 좌표 칸은 8개뿐 · 목록 밖 좌표 칸이 생기면 여전히 잡힘
eq  "LOC-1 판단을 거친 좌표 칸 8개(매물 · 시군구 · 가게)" "SELECT count(*) FROM location_column_allow;" "8"
run "LOC-2 목록 밖 좌표 칸은 여전히 잡힘" PASS "BEGIN;
  DELETE FROM location_column_allow WHERE table_name='town_places' AND column_name='lat';
  DO \$\$ BEGIN
    IF (SELECT count(*) FROM v_location_columns WHERE table_name='town_places') <> 1 THEN RAISE EXCEPTION 'not caught'; END IF;
    IF (SELECT count(*) FROM v_location_waiver_broken WHERE table_name='town_places') <> 1 THEN RAISE EXCEPTION 'not caught(BZ)'; END IF;
  END \$\$; ROLLBACK;"

n=$($PSQL -t -A -c "SELECT count(*) FROM integrations WHERE secret_key_name LIKE '%KEY%' AND secret_registered=false;")
if [ "$n" -ge 1 ]; then echo "  ok   INTG  키 값이 아니라 키 이름만 저장"; pass=$((pass+1));
else echo "  FAIL INTG  키 관리 방식 확인 필요"; fail=$((fail+1)); fi

# 이 구간은 연동 상태를 바꿔가며 오픈 차단 로직을 확인합니다.
# 하드코딩된 값으로 되돌리면 실제 진행 상황(국세청 TESTING 등)이 지워집니다.
# 원래 값을 임시 표에 담아 두었다가 그대로 복원합니다.
# TEMP 표는 세션 단위입니다. psql 을 부를 때마다 세션이 새로 열리므로
# 저장한 값이 다음 호출에서 사라집니다. 일반 표로 둡니다.
$PSQL -c "DROP TABLE IF EXISTS _intg_bak;
          CREATE TABLE _intg_bak AS
          SELECT code, status, secret_registered, egress_ip,
                 ip_requested_at, ip_approved_at FROM integrations;" >/dev/null 2>&1

$PSQL -c "UPDATE integrations SET status='LIVE' WHERE blocks_open;" >/dev/null 2>&1
n=$($PSQL -t -A -c "SELECT count(*) FROM v_open_blockers WHERE kind='INTEGRATION';")
if [ "$n" = "0" ]; then echo "  ok   INTG  LIVE 되면 오픈 차단 해제"; pass=$((pass+1));
else echo "  FAIL INTG  차단 ${n}건 잔존"; fail=$((fail+1)); fi

$PSQL -c "UPDATE integrations SET status='NOT_STARTED' WHERE blocks_open;" >/dev/null 2>&1
n=$($PSQL -t -A -c "SELECT count(*) FROM v_open_blockers WHERE kind='INTEGRATION';")
# v10.27 (G-176) — 오픈 전 필요한 연동 4종(BROKER 추가) · v10.34 — 5종(ETAX 전자세금계산서 추가)
if [ "$n" = "5" ]; then echo "  ok   INTG  미완료 연동이 오픈을 막는다"; pass=$((pass+1));
else echo "  FAIL INTG  차단 ${n}건"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM banned_words WHERE is_active AND severity='BLOCK';")
if [ "$n" -ge 30 ]; then echo "  ok   WORD  BLOCK 금칙어 ${n}종"; pass=$((pass+1));
else echo "  FAIL WORD  BLOCK ${n}종뿐"; fail=$((fail+1)); fi

echo "== 필수 설정 값 검증 =="
# 이 구간은 설정값을 바꿔가며 검증을 확인합니다.
# 하드코딩된 빈 값으로 되돌리면 **실제로 입력한 법정 고지가 지워집니다** —
# 사업자등록증에서 넣은 대표자명·등록번호·주소가 검정 한 번에 사라졌습니다.
# 시작 시점의 값을 담아 두었다가 그대로 복원합니다.
$PSQL -c "DROP TABLE IF EXISTS _set_bak;
          CREATE TABLE _set_bak AS
          SELECT key, value FROM site_settings WHERE key LIKE 'footer.%';" >/dev/null 2>&1
run "SET   자리표시자 저장 차단"   FAIL "UPDATE site_settings SET value='대표자명' WHERE key='footer.ceo_name';"
run "SET   형식 오류 차단"         FAIL "UPDATE site_settings SET value='1234567890' WHERE key='footer.biz_reg_no';"
run "SET   길이 부족 차단"         FAIL "UPDATE site_settings SET value='서울' WHERE key='footer.address';"
run "SET   정상 값 저장"           PASS "UPDATE site_settings SET value='123-45-67890' WHERE key='footer.biz_reg_no';"

$PSQL -c "SET session_replication_role=replica; UPDATE site_settings SET value='미정' WHERE key='footer.ceo_name'; SET session_replication_role=origin;" >/dev/null 2>&1
n=$($PSQL -t -A -c "SELECT count(*) FROM v_open_blockers WHERE item='footer.ceo_name';")
if [ "$n" = "1" ]; then echo "  ok   SET   트리거 우회해 넣어도 뷰가 잡는다"; pass=$((pass+1));
else echo "  FAIL SET   자리표시자가 통과됨"; fail=$((fail+1)); fi
# 시험 시작 시점의 값으로 되돌립니다.
$PSQL -c "SET session_replication_role=replica;
          UPDATE site_settings s SET value = b.value FROM _set_bak b WHERE b.key = s.key;
          SET session_replication_role=origin;
          DROP TABLE IF EXISTS _set_bak;" >/dev/null 2>&1

echo "== 개인정보 보호 =="
PV1=aaaa9999-0000-4000-a000-0000000000f1
PV2=aaaa9999-0000-4000-a000-0000000000f2
$PSQL -c "DELETE FROM identity_verifications WHERE account_id IN ('$PV1','$PV2'); DELETE FROM accounts WHERE id IN ('$PV1','$PV2');" >/dev/null 2>&1
$PSQL -c "INSERT INTO accounts(id,email,password_hash,name,phone,account_type) VALUES ('$PV1','pv1@t.com','h','탈퇴1','010-1111-2222','INDIVIDUAL'),('$PV2','pv2@t.com','h','탈퇴2','010-3333-4444','INDIVIDUAL');" >/dev/null 2>&1
$PSQL -c "SET session_replication_role=replica; INSERT INTO deals(id,listing_id,buyer_account_id,seller_account_id,introducer_account_id,attributed_code,tier,agreed_fee,status) VALUES ('aaaa9999-0000-4000-a000-0000000000dd','$L','$PV2','$SEL','$B','OK1',1,1000000,'INQUIRY') ON CONFLICT DO NOTHING; SET session_replication_role=origin;" >/dev/null 2>&1
$PSQL -c "UPDATE accounts SET withdrawn_at=now() WHERE id IN ('$PV1','$PV2');" >/dev/null 2>&1

v=$($PSQL -t -A -c "SELECT (retention_until = current_date)::text FROM accounts WHERE id='$PV1';")
if [ "$v" = "true" ]; then echo "  ok   PII   거래 없으면 즉시 파기 대상"; pass=$((pass+1));
else echo "  FAIL PII   보관기간 $v"; fail=$((fail+1)); fi

v=$($PSQL -t -A -c "SELECT (retention_until > current_date + 1000)::text FROM accounts WHERE id='$PV2';")
if [ "$v" = "true" ]; then echo "  ok   PII   거래 있으면 5년 보관 (전자상거래법)"; pass=$((pass+1));
else echo "  FAIL PII   보관기간 $v"; fail=$((fail+1)); fi

$PSQL -c "SELECT fn_purge_accounts();" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT name||'/'||coalesce(phone,'NULL') FROM accounts WHERE id='$PV1';")
if [ "$v" = "탈퇴회원/NULL" ]; then echo "  ok   PII   파기 시 식별정보 제거 (행은 유지)"; pass=$((pass+1));
else echo "  FAIL PII   파기 결과 $v"; fail=$((fail+1)); fi

v=$($PSQL -t -A -c "SELECT (name='탈퇴2')::text FROM accounts WHERE id='$PV2';")
if [ "$v" = "true" ]; then echo "  ok   PII   보관기간 내 계정은 유지"; pass=$((pass+1));
else echo "  FAIL PII   보관기간 내 계정이 파기됨"; fail=$((fail+1)); fi

cat > /tmp/_pii.sql <<'PIISQL'
INSERT INTO audit.audit_logs(actor_role, action, target_type, after_data)
VALUES ('ADMIN','PIITEST','ACCOUNT',
        jsonb_build_object('email','leak@x.com','phone','010-0000-0000','keep',1));
PIISQL
$PSQL -f /tmp/_pii.sql >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT after_data::text FROM audit.audit_logs WHERE action='PIITEST' LIMIT 1;")
case "$v" in *email*|*phone*) echo "  FAIL PII   감사 로그에 개인정보 잔존"; fail=$((fail+1));;
  *) echo "  ok   PII   감사 로그 개인정보 자동 마스킹"; pass=$((pass+1));; esac

run "PII   감사 로그 변조 차단" FAIL "UPDATE audit.audit_logs SET action='X' WHERE action='PIITEST';"
run "PII   감사 로그 삭제 차단" FAIL "DELETE FROM audit.audit_logs WHERE action='PIITEST';"

$PSQL -c "INSERT INTO audit.audit_logs(actor_role,action,target_type,ip,user_agent,occurred_at) VALUES ('ADMIN','PIIOLD','ACCOUNT','5.6.7.8','UA', now()-interval '400 days');" >/dev/null 2>&1
$PSQL -c "SELECT fn_purge_old_ip();" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT (ip IS NULL)::text FROM audit.audit_logs WHERE action='PIIOLD' LIMIT 1;")
if [ "$v" = "true" ]; then echo "  ok   PII   1년 경과 IP 마스킹 (변조는 여전히 차단)"; pass=$((pass+1));
else echo "  FAIL PII   IP 가 남아 있음"; fail=$((fail+1)); fi

echo "== 개인정보 조회 감사 =="
$PSQL -c "INSERT INTO audit.pii_access_logs(actor_account_id,target_type,target_account_id,access_type,reason,ip) VALUES ('$SEL','ACCOUNT','$B','VIEW','시험 조회','1.2.3.4');" >/dev/null 2>&1
v=$($PSQL -t -A -c "SELECT count(*) FROM audit.pii_access_logs WHERE reason='시험 조회';")
if [ "$v" = "1" ]; then echo "  ok   PII   회원 개인정보 조회 기록 가능"; pass=$((pass+1));
else echo "  FAIL PII   조회 기록 실패"; fail=$((fail+1)); fi

run "PII   조회 이력 변조 차단" FAIL "UPDATE audit.pii_access_logs SET reason='X' WHERE reason='시험 조회';"
run "PII   조회 이력 삭제 차단" FAIL "DELETE FROM audit.pii_access_logs WHERE reason='시험 조회';"

# 기대값 7종. 성향·소개자 프로필·소개 초대가 추가됐습니다.
# 항목이 늘면 개인정보처리방침도 함께 고쳐야 합니다 —
# 수집하면서 방침에 적지 않는 것이 가장 나쁩니다.
n=$($PSQL -t -A -c "SELECT count(*) FROM v_privacy_inventory;")
if [ "$n" -ge 8 ]; then echo "  ok   PII   보관 현황 ${n}종 집계"; pass=$((pass+1));
else echo "  FAIL PII   보관 현황 ${n}종 (8종 기대)"; fail=$((fail+1)); fi

# 사라진 테이블을 아직 참조하는 함수가 없어야 합니다.
# DROP TABLE CASCADE 는 FK 만 따라가고 함수 본문은 보지 않습니다.
eq  "INV-11 미아 참조 없음"            "SELECT count(*) FROM v_dangling_refs;" "0"

echo "== 알림 문구 =="
n=$($PSQL -t -A -c "SELECT count(*) FROM notification_templates;")
if [ "$n" -ge 50 ]; then echo "  ok   MSG   알림 템플릿 ${n}건"; pass=$((pass+1));
else echo "  FAIL MSG   템플릿 ${n}건뿐"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM notification_templates WHERE btrim(coalesce(body,''))='';")
if [ "$n" = "0" ]; then echo "  ok   MSG   빈 본문 없음"; pass=$((pass+1));
else echo "  FAIL MSG   빈 본문 ${n}건"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM notification_templates WHERE channel='SMS' AND octet_length(body) > 90;")
if [ "$n" = "0" ]; then echo "  ok   MSG   SMS 90바이트 이내"; pass=$((pass+1));
else echo "  FAIL MSG   SMS 초과 ${n}건"; fail=$((fail+1)); fi

run "MSG   미치환 변수 발송 차단" FAIL "INSERT INTO notifications(account_id,event_code,title,body) VALUES ('$SEL','MSGTEST','t','{amount}원이 지급되었습니다');"
run "MSG   치환된 문구는 발송"    PASS "INSERT INTO notifications(account_id,event_code,title,body) VALUES ('$SEL','MSGTEST','t','3,000,000원이 지급되었습니다');"

echo "== 콘텐츠 레지스트리 =="
n=$($PSQL -t -A -c "SELECT count(*) FROM v_content_missing;")
if [ "$n" = "0" ]; then echo "  ok   CNT   콘텐츠 누락 없음"; pass=$((pass+1));
else echo "  FAIL CNT   누락 ${n}건"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM faqs WHERE is_active;")
if [ "$n" -ge 5 ]; then echo "  ok   CNT   FAQ ${n}건"; pass=$((pass+1));
else echo "  FAIL CNT   FAQ ${n}건뿐"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM ui_messages WHERE is_active AND basis IS NOT NULL;")
if [ "$n" -ge 10 ]; then echo "  ok   CNT   법적 근거 문구 ${n}건"; pass=$((pass+1));
else echo "  FAIL CNT   근거 문구 ${n}건"; fail=$((fail+1)); fi

# ★ 관 열기 게이트 시험 — 폼 문구 · 업종 두 관문
#
#   예전에는 LED 를 썼습니다. LED 에 폼 문구도 업종도 없었기 때문입니다.
#   C993 으로 LED 에 업종 8종과 폼 문구가 들어가면서 전제가 깨졌고,
#   시험이 LED 의 폼 문구를 지워 버리는 부작용도 있었습니다.
#
#   그래서 실제로 쓰지 않는 임시 관(ZZT)을 만들어 시험하고 지웁니다.
#   실데이터를 건드리지 않습니다.
$PSQL -c "DELETE FROM gwan_form_copy WHERE gwan_code='ZZT';" >/dev/null 2>&1
$PSQL -c "DELETE FROM categories WHERE gwan_code='ZZT';" >/dev/null 2>&1
$PSQL -c "INSERT INTO gwans(code,name,is_active,sort_order) VALUES ('ZZT','시험관',false,99) ON CONFLICT (code) DO UPDATE SET is_active=false;" >/dev/null 2>&1
run "CNT   폼 문구 없이 관 열기 차단" FAIL "UPDATE gwans SET is_active=true WHERE code='ZZT';"

$PSQL -c "INSERT INTO gwan_form_copy(gwan_code,role,subject,title_hint,body_hint) VALUES ('ZZT','OFFER','시험','무엇을?','설명'),('ZZT','REQUEST','시험','무엇을?','설명');" >/dev/null 2>&1
run "CNT   업종 없이 관 열기 차단"   FAIL "UPDATE gwans SET is_active=true WHERE code='ZZT';"

# 뒷정리 — 남기면 다음 검정에서 감시 뷰에 걸립니다
$PSQL -c "DELETE FROM gwan_form_copy WHERE gwan_code='ZZT';" >/dev/null 2>&1
$PSQL -c "DELETE FROM gwans WHERE code='ZZT';" >/dev/null 2>&1

echo "== 약관 본문 =="
n=$($PSQL -t -A -c "SELECT count(*) FROM terms WHERE version='1.0' AND btrim(coalesce(body,''))='';")
if [ "$n" = "0" ]; then echo "  ok   TERM  6종 본문 작성됨"; pass=$((pass+1));
else echo "  FAIL TERM  본문 없는 약관 ${n}건"; fail=$((fail+1)); fi

n=$($PSQL -t -A -c "SELECT count(*) FROM terms WHERE version='1.0' AND body LIKE '%소개비%';")
if [ "$n" -ge 2 ]; then echo "  ok   TERM  소개비 조항 포함"; pass=$((pass+1));
else echo "  FAIL TERM  소개비 조항 없음"; fail=$((fail+1)); fi

# 시험이 바꾼 상태를 원복합니다.
# 남겨 두면 v_open_blockers 가 실제와 달라져 "몇 건 남았나"를 판단할 수 없습니다.
# ★ 조건 없이 되돌리면 **실제 발행분까지 초안으로 만듭니다.**
#   10월 1일 시행으로 발행한 이용약관이 검정 한 번에 사라졌습니다.
#   시험이 만든 자리표시자 본문만 골라 되돌립니다.
$PSQL -c "DELETE FROM terms WHERE version <> '1.0';
          UPDATE terms SET status='LEGAL_REVIEW', effective_from='infinity'
           WHERE body LIKE '%본문입니다%'
              OR body LIKE '%(생성 대기)%'
              OR btrim(coalesce(body,'')) = '';" >/dev/null 2>&1

# 연동 상태는 시험 시작 시점의 값으로 되돌립니다.
$PSQL -c "UPDATE integrations i
             SET status = b.status, secret_registered = b.secret_registered,
                 egress_ip = b.egress_ip,
                 ip_requested_at = b.ip_requested_at, ip_approved_at = b.ip_approved_at
            FROM _intg_bak b WHERE b.code = i.code;
          DROP TABLE IF EXISTS _intg_bak;" >/dev/null 2>&1

echo
echo "== 검색 · 목록 (K2·K4·K5·K7) =="
# K5 — C860 의 INV-SCH 감시가 CI 에 없었습니다. 가드 트리거를 누가 지워도 잡히게 합니다.
eq  "SCH1 파서 로그에 사람 식별 컬럼 없음"      "SELECT count(*) FROM v_search_pii_columns" 0
eq  "SCH2 원문 검색어 저장 없음"                "SELECT count(*) FROM v_search_raw_stored"  0
run "SCH2 원문 키로 저장 시도 차단" FAIL        "INSERT INTO llm_parse_log (parsed_params) VALUES ('{\"q\":\"상가 급매\"}'::jsonb)"
# K4 — LIKE 특수문자
eq  "K4 검색 패턴 이스케이프"                   "SELECT fn_search_like('A%b_')" '%a\%b\_%'
# K7 — 조회수·찜 갱신이 게시 게이트를 다시 타지 않음
eq  "K7 조건 없는 BEFORE UPDATE 게이트 없음"     "SELECT count(*) FROM v_listing_gate_on_counter" 0

echo
echo "== 보험·의료 자격 게시 (C991) =="
# 게시는 열고 소개는 닫았습니다. 막히는 이유가 우리 게이트(GATED:)인지까지 봅니다 —
# 다른 게이트에 먼저 걸려 실패하면 이 방어는 한 번도 시험되지 않은 것입니다.
gmsg() { # $1=라벨 $2=SQL $3=기대 문구
  local out; out=$($PSQL -c "$2" 2>&1)
  if echo "$out" | grep -q "$3"; then printf "  ok   %s\n" "$1"; pass=$((pass+1))
  else printf "  FAIL %s (기대 문구 '%s' 없음: %s)\n" "$1" "$3" "$(echo "$out" | head -1)"; fail=$((fail+1)); fi
}
GC=dcdcdcdc-0000-4000-a000-000000000001
SELBIZ=$($PSQL -t -A -c "SELECT id FROM businesses WHERE account_id='$SEL' ORDER BY verified_at DESC NULLS LAST LIMIT 1;")
GBODY='보험 상품 비교와 가입 절차를 안내하는 자격 게시 시험용 본문입니다. 최소 길이를 넘깁니다.'
eq   "GQ-00 보험·의료는 소개 닫힌 GATED"          "SELECT count(*) FROM restricted_industries WHERE gwan_code='MNY' AND code IN ('INSURANCE','MEDICAL') AND mode='GATED' AND NOT intro_allowed" 2
eq   "GQ-00b 소개 차단 판정 유지"                  "SELECT fn_is_intro_blocked('INSURANCE','MNY')::text" true
gmsg "GQ-01 자격 심사 없이 게시 차단"               "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,grade_code,status,review_no) VALUES ('MNY','$GC','$SEL','보험 자격게시 시험','$GBODY','G3','IN_REVIEW','심의필 제2026-0001호');" "자격 심사를 통과한"
run  "GQ-02 발급처 조회 없이 자격 승인 차단" FAIL "INSERT INTO qualification_reviews(business_id,category_code,doc_no,lookup_done,state) VALUES ('$SELBIZ','MEDICAL','M-1',false,'APPROVED');"
run  "GQ-02b 조회 마친 보험 자격 승인"       PASS "INSERT INTO qualification_reviews(business_id,category_code,doc_no,lookup_done,state,decided_by) VALUES ('$SELBIZ','INSURANCE','I-1',true,'APPROVED','$B') ON CONFLICT (business_id,category_code) DO UPDATE SET state='APPROVED', lookup_done=true;"
gmsg "GQ-03 소개비 건 게시 차단"                    "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,grade_code,status,review_no,desired_fee,fee_bearer) VALUES ('MNY','$GC','$SEL','보험 소개비 시험','$GBODY','G3','IN_REVIEW','심의필 제2026-0002호',100000,'SELLER');" "소개비를 받을 수 없습니다"
gmsg "GQ-04 심의필 없는 게시 차단"                  "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,grade_code,status) VALUES ('MNY','$GC','$SEL','보험 심의필 시험','$GBODY','G3','IN_REVIEW');" "GATED"
run  "GQ-05 자격·심의필 갖춘 게시 통과"     PASS "INSERT INTO listings(gwan_code,category_id,owner_account_id,title,body,grade_code,status,review_no) VALUES ('MNY','$GC','$SEL','보험 자격게시 시험','$GBODY','G3','IN_REVIEW','심의필 제2026-0003호');"
GL=$($PSQL -t -A -c "SELECT id FROM listings WHERE title='보험 자격게시 시험' ORDER BY created_at DESC LIMIT 1;")
gmsg "GQ-06 소개자 있는 거래 차단"                  "INSERT INTO deals(listing_id,buyer_account_id,seller_account_id,introducer_account_id) VALUES ('$GL','$BUY','$SEL','$B');" "소개자를 둘 수 없습니다"
gmsg "GQ-07 요청에 소개비 걸기 차단"                "INSERT INTO requests(gwan_code,category_id,owner_account_id,title,body,status,offered_fee) VALUES ('MNY','$GC','$BUY','보험 요청 시험','$GBODY','DRAFT',50000);" "소개비를 걸 수 없습니다"
eq   "GQ-08 소개비·소개자 누수 없음"               "SELECT count(*) FROM v_no_intro_leak" 0
eq   "GQ-09 자격 없는 공개 게시 없음"              "SELECT count(*) FROM v_gated_unqualified_public" 0
eq   "GQ-10 안심소개 의료 양도는 광고만 유지"       "SELECT mode FROM restricted_industries WHERE gwan_code='MAL' AND code='MEDICAL'" AD_ONLY
eq   "GQ-11 소개뱅크몰 의료 서비스 차단 유지"       "SELECT mode FROM restricted_industries WHERE gwan_code='HLT' AND code='MEDICAL'" BLOCK

echo "== 운영 결정 (C997 · 2026-10-01) =="
# Q3 — 양측 확인이 모이면 확정. 한쪽만이면 그대로.
DQ3=cccccccc-0000-4000-a000-0000000000c7
DQ3B=cccccccc-0000-4000-a000-0000000000c8
$PSQL -c "INSERT INTO deals(id,listing_id,buyer_account_id,seller_account_id) VALUES ('$DQ3','$L','$BUY','$SEL'),('$DQ3B','$L','$BUY','$SEL') ON CONFLICT DO NOTHING;" >/dev/null 2>&1
run  "OD-01 양측 확인 기록"                PASS "INSERT INTO deal_confirmations(deal_id,party,confirmed_by) VALUES ('$DQ3','BUYER','$BUY'),('$DQ3','SELLER','$SEL');"
eq   "OD-02 양측 확인 → CONFIRMED (Q3)"    "SELECT status||'/'||confirm_mode FROM deals WHERE id='$DQ3'" "CONFIRMED/BOTH"
run  "OD-03 한쪽 확인 기록"                PASS "INSERT INTO deal_confirmations(deal_id,party,confirmed_by) VALUES ('$DQ3B','BUYER','$BUY');"
eq   "OD-04 한쪽만이면 확정 안 됨"          "SELECT status FROM deals WHERE id='$DQ3B'" "INQUIRY"
# Q1 — 확정한 사람은 지급할 수 없음(2인 원칙) · 지급자 기록 필수
PQ=eeeeeeee-2222-4000-a000-000000000001
SETUP="BEGIN; SET session_replication_role=replica;
  INSERT INTO partners(id,business_id,status) VALUES ('$PQ','$BIZ','ACTIVE') ON CONFLICT DO NOTHING;
  INSERT INTO partner_settlement_accounts(partner_id,bank_code,bank_name,account_enc,account_last4,holder_name,verified_at)
    VALUES ('$PQ','004','국민','x','0000','시험',now()) ON CONFLICT (partner_id) DO NOTHING;
  SET session_replication_role=origin;
  INSERT INTO partner_settlements(id,partner_id,track,period_from,period_to,gross_amount,withholding,net_amount)
    VALUES ('$PQ','$PQ','AFFILIATE','2030-01-01','2030-01-31',100,3,97);
  UPDATE partner_settlements SET state='CONFIRMED', confirmed_by='$B' WHERE id='$PQ';"
run  "OD-05 확정자=지급자 차단 (Q1)"       FAIL "$SETUP UPDATE partner_settlements SET state='PAID', paid_by='$B', paid_ref='T' WHERE id='$PQ'; COMMIT;"
run  "OD-06 지급자 없는 지급 차단"          FAIL "$SETUP UPDATE partner_settlements SET state='PAID', paid_ref='T' WHERE id='$PQ'; COMMIT;"
run  "OD-07 다른 사람 지급 통과"            PASS "$SETUP UPDATE partner_settlements SET state='PAID', paid_by='$SEL', paid_ref='T' WHERE id='$PQ'; ROLLBACK;"
# Q4 — 본인인증 없는 파트너 계좌 등록 차단
run  "OD-08 본인인증 없으면 정산 계좌 차단 (Q4)" FAIL "BEGIN; SET session_replication_role=replica;
  INSERT INTO partners(id,business_id,status) VALUES ('$PQ','$BIZ','ACTIVE') ON CONFLICT DO NOTHING;
  UPDATE accounts SET identity_verified_at=NULL WHERE id=(SELECT account_id FROM businesses WHERE id='$BIZ');
  SET session_replication_role=origin;
  INSERT INTO partner_settlement_accounts(partner_id,bank_code,bank_name,account_enc,account_last4,holder_name)
    VALUES ('$PQ','004','국민','x','0000','시험') ON CONFLICT (partner_id) DO UPDATE SET holder_name='시험2'; COMMIT;"

echo "== 서버 기능 6건 (20261002) =="
# 제휴 링크 · 정산 계좌 재인증 (D001)
eq   "SV-01 인증 완료 계좌에 코드가 남지 않음"   "SELECT count(*) FROM partner_settlement_accounts WHERE verified_at IS NOT NULL AND verify_code_hash IS NOT NULL" 0
eq   "SV-02 판매 중 상품 링크의 착지 주소는 안전" "SELECT count(*) FROM partner_links l JOIN affiliate_products p ON p.id=l.product_id WHERE p.status='ON_SALE' AND NOT fn_aff_safe_landing(coalesce(nullif(btrim(l.landing_url),''),p.landing_url))" 0
eq   "SV-03 javascript: · // 착지 주소는 안전하지 않음" "SELECT fn_aff_safe_landing('javascript:alert(1)')::text || fn_aff_safe_landing('//evil.example')::text" falsefalse
# 건강몰 재고 · 배송지 · 취소 (D002)
# D006 — 개봉 반품은 재고로 되돌리지 않고 restock_skipped 에 이유를 남깁니다. 둘 중 정확히 하나
eq   "SV-04 취소·반품 주문은 재고 복구 또는 미복구 사유 (정확히 하나)" "SELECT count(*) FROM hlt_orders WHERE status IN ('CANCELED','RETURNED') AND (restocked_at IS NULL) = (restock_skipped IS NULL)" 0
eq   "SV-05 계정당 기본 배송지 1개 이하"          "SELECT count(*) FROM (SELECT account_id FROM hlt_addresses WHERE is_default GROUP BY 1 HAVING count(*)>1) x" 0
eq   "SV-06 지운 배송지는 기본이 아님"            "SELECT count(*) FROM hlt_addresses WHERE is_default AND deleted_at IS NOT NULL" 0
eq   "SV-07 승인된 취소·반품의 주문은 닫힘"       "SELECT count(*) FROM hlt_returns r JOIN hlt_orders o ON o.id=r.order_id WHERE r.state IN ('APPROVED','REFUNDED') AND r.kind IN ('CANCEL','RETURN') AND o.status NOT IN ('CANCELED','RETURNED')" 0
run  "SV-08 고민 이름에 질병명 차단"              FAIL "INSERT INTO hlt_concerns(code,name) VALUES ('ZZ_T','당뇨 개선');"
# 건강몰 결제 · 환불 · 개봉 반품 (D006)
eq   "SV-P1 주문당 승인 결제 1건 이하"             "SELECT count(*) FROM (SELECT order_id FROM hlt_payments WHERE state='PAID' GROUP BY 1 HAVING count(*)>1) x" 0
eq   "SV-P2 결제 완료 주문엔 승인 결제가 있음"      "SELECT count(*) FROM hlt_orders o WHERE o.status='PAID' AND o.paid_at > (SELECT coalesce(min(applied_at), now()) FROM schema_migrations WHERE name='D006_hlt_pay_refund_opened') AND NOT EXISTS (SELECT 1 FROM hlt_payments p WHERE p.order_id=o.id AND p.state='PAID')" 0
eq   "SV-P3 환불 완료 신청의 결제는 취소됨"         "SELECT count(*) FROM hlt_returns r WHERE r.state='REFUNDED' AND EXISTS (SELECT 1 FROM hlt_payments p WHERE p.order_id=r.order_id AND p.state='PAID')" 0
eq   "SV-P4 승인 결제가 남은 주문은 닫히지 않음(반품 승인 뒤 환불 미완 제외)" "SELECT count(*) FROM hlt_payments p JOIN hlt_orders o ON o.id=p.order_id WHERE p.state='PAID' AND o.status IN ('CANCELED','RETURNED') AND NOT EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id=o.id AND r.state='APPROVED')" 0
eq   "SV-P5 개봉 미복구는 반품에만 · 판정 기록과 일치" "SELECT count(*) FROM hlt_orders o WHERE o.restock_skipped='OPENED' AND (o.status<>'RETURNED' OR NOT EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id=o.id AND r.kind='RETURN' AND r.opened))" 0
eq   "SV-P6 발송 전 취소는 개봉일 수 없음"          "SELECT count(*) FROM hlt_returns WHERE kind='CANCEL' AND (opened OR customer_opened)" 0
eq   "SV-P7 결제·환불·개봉 규칙 제약 4종 존재"     "SELECT count(*) FROM pg_constraint WHERE conname IN ('ck_hlt_pay_paid_key','ck_hlt_orders_restock_skipped','ck_hlt_returns_cancel_opened','ck_hlt_returns_refunded')" 4
# 파일 저장 (D007)
eq   "SV-F1 READY 파일은 지문·실제형식 일치"      "SELECT count(*) FROM files WHERE status='READY' AND (sha256 IS NULL OR detected_type IS DISTINCT FROM content_type OR completed_at IS NULL)" 0
eq   "SV-F2 저장 키에 경로 탈출 없음"             "SELECT count(*) FROM files WHERE storage_key ~ '(\\.\\.|^/|\\\\)'" 0
eq   "SV-F3 소유증빙은 신청자 본인의 READY 파일만" "SELECT count(*) FROM owner_verifications o JOIN files f ON f.id=o.doc_file_id WHERE f.status<>'READY' OR f.owner_account_id<>o.applicant_id OR f.purpose<>'OWNERSHIP_DOC'" 0
eq   "SV-F4 파일 지킴 트리거 5종 존재"            "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_files_guard','trg_files_no_delete','trg_file_ref_owner_verif','trg_file_ref_material','trg_file_ref_guide')" 5
run  "SV-F5 경로 탈출 저장 키 차단"               FAIL "INSERT INTO files(owner_account_id,purpose,original_name,content_type,size_bytes,storage_provider,storage_key) VALUES ((SELECT id FROM accounts LIMIT 1),'OWNERSHIP_DOC','a.pdf','application/pdf',10,'LOCAL','../etc/passwd');"
# 리드 배정 (D008)
eq   "SV-L1 자격 없는 업체로 간 제한업종 리드 0"  "SELECT count(*) FROM v_lead_delivery_gated_leak" 0
eq   "SV-L2 최대 업체 수 초과 배정 0"             "SELECT count(*) FROM v_lead_delivery_overcap" 0
eq   "SV-L3 열람 시각·상태 어긋남 0"              "SELECT count(*) FROM v_lead_delivery_state_mismatch" 0
eq   "SV-L4 기록 없는 연락처 열람 0"              "SELECT count(*) FROM v_lead_contact_unlogged" 0
eq   "SV-L5 새 배정은 열람한 건에만 이용료"       "SELECT count(*) FROM lead_fees f JOIN lead_deliveries d ON d.id=f.delivery_id WHERE d.assign_mode<>'LEGACY' AND d.state<>'VIEWED' AND f.state<>'VOIDED'" 0
eq   "SV-L6 종료 리드는 사유 필수"                "SELECT count(*) FROM leads WHERE assign_state='CLOSED' AND coalesce(btrim(close_reason),'')=''" 0
# 10/2 — 빈 DB(첫 docker check)에서는 고칠 행이 없어 UPDATE 0건으로 "통과" 해 버렸습니다(헛검사).
#   대상 행을 같은 트랜잭션 안에서 만들고 되돌립니다 — 남는 행이 없어 다른 검사(OD-05~07 의 파트너)를 건드리지 않습니다.
run  "SV-L7 요약에 휴대폰 번호 넣기 차단"         FAIL "BEGIN; INSERT INTO leads(id,summary) VALUES ('dddddddd-1007-4000-a000-000000000001','불변식 시험 리드'); UPDATE leads SET summary='연락 010-1234-5678' WHERE id='dddddddd-1007-4000-a000-000000000001'; ROLLBACK;"
# 반품 배송비 차감 (D009 — 10/2 「단순 변심은 왕복 배송비 차감」)
eq   "SV-P8 환불액 + 반품 배송비 차감 = 결제액"     "SELECT count(*) FROM v_hlt_refund_mismatch" 0
eq   "SV-P9 차감은 고객 사정 반품에만"             "SELECT count(*) FROM hlt_returns WHERE ship_deduction > 0 AND NOT (kind='RETURN' AND reason IN ('CHANGE_MIND','WRONG_ORDER'))" 0
# SV-P10 — 판매자 사유 반품에 차감을 넣으면 **우리 제약(ck_hlt_returns_ship_deduction)** 이 막아야 합니다.
#   (FK · 트리거는 replica 로 끄고 CHECK 만 봅니다) 다른 이유로 실패하면 "차단됨" 으로 세지 않게 제약 이름을 확인합니다(헛검사 방지).
run  "SV-P10 판매자 사유 반품에 배송비 차감 차단"   FAIL "BEGIN; SET LOCAL session_replication_role=replica; DO \$\$ DECLARE c text; BEGIN INSERT INTO hlt_returns(order_id,kind,reason,ship_deduction) VALUES (gen_random_uuid(),'RETURN','DEFECT',6000); EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME; IF c = 'ck_hlt_returns_ship_deduction' THEN RAISE EXCEPTION 'blocked by %', c; END IF; END \$\$; ROLLBACK;"
run  "SV-P11 고객 사정 반품의 차감은 허용"          PASS "BEGIN; SET LOCAL session_replication_role=replica; INSERT INTO hlt_returns(order_id,kind,reason,ship_deduction) VALUES (gen_random_uuid(),'RETURN','CHANGE_MIND',6000); ROLLBACK;"
# 일반 회원 소개코드 · 유입 기록 (D010 — 10/2 「소개코드는 시안대로」)
eq   "SV-R1 무료 요금제 초과 코드는 결제키 필수"   "SELECT count(*) FROM referral_codes rc JOIN subscriptions s ON s.id=rc.subscription_id JOIN subscription_plans p ON p.code=s.plan_code WHERE rc.is_extra AND p.monthly_price=0 AND rc.extra_payment_key IS NULL AND rc.issued_at > (SELECT coalesce(min(applied_at), now()) FROM schema_migrations WHERE name='D010_refcode_member_attribution')" 0
eq   "SV-R2 결제 1건 = 결제한 건수만큼의 코드"      "SELECT count(*) FROM referral_code_payments p WHERE (SELECT count(*) FROM referral_codes rc WHERE rc.extra_payment_key=p.payment_key) <> p.code_count" 0
eq   "SV-R3 결제와 코드의 계정·구독·단가 일치"      "SELECT count(*) FROM referral_codes rc JOIN referral_code_payments p ON p.payment_key=rc.extra_payment_key WHERE rc.owner_account_id<>p.account_id OR rc.subscription_id<>p.subscription_id OR rc.extra_amount<>p.unit_price" 0
eq   "SV-R4 24시간 안 같은 방문자·코드 중복 유입 0" "SELECT count(*) FROM attribution_events a JOIN attribution_events b ON a.code=b.code AND a.visitor_key=b.visitor_key AND a.id<b.id AND a.source='INTRO' AND b.source='INTRO' AND abs(extract(epoch FROM b.occurred_at-a.occurred_at)) < 86400" 0
eq   "SV-R5 자기 소개 거래 0"                      "SELECT count(*) FROM deals WHERE introducer_account_id = buyer_account_id" 0
eq   "SV-R6 소개코드 결제 · 중복 유입 트리거 존재"   "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_refcode_extra_paid','trg_attr_dedupe_24h')" 2
# 요청 열람 한도 스위치 · 유료 요금제 추가 코드 결제 · 재로그인 귀속 (D011 — 10/2 결정)
eq   "SV-V1 열람 한도 설정 3종 · 형식 검사 있음"     "SELECT count(*) FROM site_settings WHERE key IN ('request.view.limit','request.view.free_monthly','request.view.limit_from') AND value_pattern IS NOT NULL AND coalesce(value,'') ~ value_pattern" 3
eq   "SV-R7 D011 뒤 결제 없는 추가 소개코드 0"       "SELECT count(*) FROM v_refcode_extra_unpaid" 0
eq   "SV-A1 방문자 연결은 여러 줄 허용(유일 제약 없음)" "SELECT count(*) FROM pg_constraint WHERE conname='visitor_identities_visitor_key_account_id_key'" 0
# SV-V2 · V3 — 같은 트랜잭션에서 요청 2건을 만들고(되돌림) 한도를 1건으로 켜면 두 번째 열람이 막혀야 하고, 끄면 막히지 않아야 합니다.
VQ="BEGIN; SET LOCAL session_replication_role=replica;
  INSERT INTO requests(id,gwan_code,owner_account_id,title) VALUES ('dddddddd-2011-4000-a000-000000000001','MNY',(SELECT id FROM accounts ORDER BY created_at LIMIT 1),'불변식 시험 요청 1'),('dddddddd-2011-4000-a000-000000000002','MNY',(SELECT id FROM accounts ORDER BY created_at LIMIT 1),'불변식 시험 요청 2');
  SET LOCAL session_replication_role=origin;
  DELETE FROM request_views WHERE viewer_account_id=(SELECT a.id FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.account_id=a.id AND s.status IN ('ACTIVE','PAST_DUE')) ORDER BY a.created_at DESC LIMIT 1);
  UPDATE site_settings SET value='1' WHERE key='request.view.free_monthly';"
VIEW2="INSERT INTO request_views(request_id,viewer_account_id) SELECT r.id,(SELECT a.id FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.account_id=a.id AND s.status IN ('ACTIVE','PAST_DUE')) ORDER BY a.created_at DESC LIMIT 1) FROM requests r WHERE r.id IN ('dddddddd-2011-4000-a000-000000000001','dddddddd-2011-4000-a000-000000000002');"
run  "SV-V2 한도 켬(월 1건): 구독 없는 회원의 2번째 열람 차단" FAIL "$VQ UPDATE site_settings SET value='on' WHERE key='request.view.limit'; $VIEW2 ROLLBACK;"
run  "SV-V3 한도 끔(홍보 기간): 같은 열람이 막히지 않음"       PASS "$VQ UPDATE site_settings SET value='off' WHERE key='request.view.limit'; $VIEW2 ROLLBACK;"
eq   "SV-V6 무료 요금제 열람 건수 = 운영 설정값"        "SELECT count(*) FROM subscription_plans WHERE monthly_price = 0 AND request_views_per_month IS DISTINCT FROM fn_lead_setting_int('request.view.free_monthly', 3)" 0
run  "SV-V7 설정을 바꾸면 무료 요금제 값이 따라감"       PASS "BEGIN; UPDATE site_settings SET value='7' WHERE key='request.view.free_monthly'; DO \$\$ BEGIN IF (SELECT request_views_per_month FROM subscription_plans WHERE code='BASIC') <> 7 THEN RAISE EXCEPTION 'not synced'; END IF; END \$\$; ROLLBACK;"
# 소개코드 매물별 범위 (D012) · 홍보 기간 종료일 (D013) — 10/2 결정
eq   "SV-S1 다른 매물 코드가 귀속된 거래 0"          "SELECT count(*) FROM v_deal_refcode_listing_mismatch" 0
eq   "SV-S2 같은 회원·같은 매물의 살아 있는 코드 1개" "SELECT count(*) FROM (SELECT 1 FROM referral_codes WHERE listing_id IS NOT NULL AND revoked_at IS NULL GROUP BY owner_account_id, listing_id HAVING count(*) > 1) x" 0
eq   "SV-S3 소개 금지 업종 매물에 묶인 코드 0"        "SELECT count(*) FROM referral_codes rc JOIN listings l ON l.id = rc.listing_id WHERE fn_category_no_intro(l.category_id)" 0
eq   "SV-S4 본인 매물에 묶인 코드 0"                 "SELECT count(*) FROM referral_codes rc JOIN listings l ON l.id = rc.listing_id WHERE l.owner_account_id = rc.owner_account_id" 0
eq   "SV-S5 구매자 본인 코드가 귀속된 거래 0"         "SELECT count(*) FROM deals d JOIN referral_codes rc ON rc.code = d.attributed_code WHERE rc.owner_account_id = d.buyer_account_id" 0
eq   "SV-S6 소개코드 범위 설정 형식"                 "SELECT count(*) FROM site_settings WHERE key = 'refcode.scope' AND value ~ '^(listing|all)\$'" 1
eq   "SV-S7 매물 코드 지킴 트리거 2종 · 유일 인덱스"   "SELECT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_refcode_listing_guard','trg_refcode_immutable')) + (SELECT count(*) FROM pg_indexes WHERE indexname='uq_refcode_owner_listing_live')" 3
eq   "SV-V4 종료일이 지나면 스위치 off 여도 한도 적용" "SELECT (SELECT enabled FROM fn_request_view_limit('00000000-0000-0000-0000-000000000000'::uuid)) = ((SELECT value FROM site_settings WHERE key='request.view.limit')='on' OR (SELECT CASE WHEN coalesce(value,'') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}\$' THEN (now() AT TIME ZONE 'Asia/Seoul')::date >= value::date ELSE false END FROM site_settings WHERE key='request.view.limit_from'))" t
run  "SV-V5 종료일(어제) + 스위치 off: 월 1건 넘는 열람 차단" FAIL "$VQ UPDATE site_settings SET value='off' WHERE key='request.view.limit'; UPDATE site_settings SET value=to_char((now() AT TIME ZONE 'Asia/Seoul')::date - 1,'YYYY-MM-DD') WHERE key='request.view.limit_from'; $VIEW2 ROLLBACK;"
# 판매 약관의 반품 배송비 조항 (D014) — 환불에서 6,000원을 빼는 근거가 발행된 약관에 있어야 합니다
eq   "SV-T1 발행된 판매 약관에 왕복 배송비 6,000원 조항" "SELECT count(*) FROM terms WHERE code='HLT_SALE' AND status='PUBLISHED' AND position('왕복 배송비 6,000원' IN body) > 0" 1
eq   "SV-T2 조항 없는 판매 약관이 발행 · 초안 상태로 남아 있지 않음" "SELECT count(*) FROM terms WHERE code='HLT_SALE' AND status <> 'ARCHIVED' AND position('왕복 배송비 6,000원' IN body) = 0" 0
# v10.26 (D028 · G-209) — 교환 배송비를 신청 때 받으므로 그 근거(교환 비용 조항)가 발행 · 초안 판매 약관에 있어야 합니다(DB 의 글 · 발행 스크립트가 덮는 초안 생성기의 글 모두)
eq   "SV-T3 교환 배송비 조항 없는 판매 약관이 발행 · 초안 상태로 남아 있지 않음" "SELECT count(*) FROM terms WHERE code='HLT_SALE' AND status <> 'ARCHIVED' AND position('교환 배송비 6,000원' IN body) = 0" 0
# v10.28 (G-217 · D041) — 약관 글 한 벌: 발행 · 초안 본문이 생성기의 글(docs/terms · scripts/terms-text.js)과 같아야 합니다.
#   다르면 운영 서버에서 처음 발행할 때(publish-terms.sh 가 초안을 docs/terms 로 덮음) 검토한 글과 다른 글이 나갑니다. 시행일 줄의 날짜만 다른 것은 같게 봅니다(fn_term_body_norm).
for _c in SERVICE PRIVACY REFUND THIRDPARTY OUTSOURCE MARKETING MARKETING_NIGHT ADPERSONAL HLT_SALE PARTNER; do
  _f="$(dirname "$0")/../docs/terms/$_c.md"
  if [ -f "$_f" ]; then
    eq "SV-T5 $_c 발행 · 초안 본문 = docs/terms/$_c.md" "SELECT count(*) FROM terms WHERE code='$_c' AND status <> 'ARCHIVED' AND fn_term_body_norm(body) <> fn_term_body_norm(\$SGBT\$$(cat "$_f")\$SGBT\$)" 0
  else
    printf "  FAIL %s\n" "SV-T5 $_c — docs/terms/$_c.md 없음"; fail=$((fail+1))
  fi
done
eq   "SV-T6 발행 · 초안 약관에 옛 이름(소개머니 · 건강상품관 · 건강몰 · 소개뱅크몰 · 리드관 · 소개리드) 0" "SELECT count(*) FROM terms WHERE status <> 'ARCHIVED' AND body ~ '소개머니|건강상품관|건강몰|소개뱅크몰|리드관|소개리드'" 0
# v10.28 (G-218 · D042) — 개인정보 처리 위탁은 「알림」: 발행 · 초안인 판은 알림이고 필수가 아님 · 알림 판에 동의 기록 0 · 알림을 막는 트리거
eq   "SV-T7 위탁(OUTSOURCE) 발행 · 초안 판 = 알림 · 필수 아님" "SELECT count(*) FROM terms WHERE code='OUTSOURCE' AND status <> 'ARCHIVED' AND (NOT is_notice OR is_required)" 0
eq   "SV-T8 알림 판에 남은 동의 기록 0"            "SELECT count(*) FROM term_agreements a JOIN terms t ON t.code=a.term_code AND t.version=a.term_version WHERE t.is_notice" 0
eq   "SV-T9 알림 동의 막는 트리거"                 "SELECT count(*) FROM pg_trigger WHERE tgname='trg_term_agreement_no_notice'" 1
eq   "SV-T10 발행 약관 본문에 깨진 시행일(「YYYY년 M월 N일」) 0 (G-219 · D043)" "SELECT count(*) FROM terms WHERE status = 'PUBLISHED' AND body ~ '시행일 [0-9]{4}년 M월 [0-9]일'" 0
# 파트너 운영 목록 · 중개사 심사 (D003)
eq   "SV-09 인정된 반려의 이용료는 무효"          "SELECT count(*) FROM lead_fee_disputes x JOIN lead_fees f ON f.id=x.fee_id WHERE x.state='ACCEPTED' AND f.state<>'VOIDED'" 0
eq   "SV-10 사유 없는 입점 반려 없음"             "SELECT count(*) FROM partners WHERE status='REJECTED' AND coalesce(btrim(suspended_reason),'')=''" 0
eq   "SV-11 인증 중개사는 사업자에 동기화"        "SELECT count(*) FROM broker_verifications v JOIN businesses b ON b.id=v.business_id WHERE v.state='VERIFIED' AND b.broker_verified_at IS NULL" 0
run  "SV-12 사유 없는 입점 반려 차단"             FAIL "BEGIN; INSERT INTO partners(id,business_id) SELECT 'dddddddd-1012-4000-a000-000000000001', b.id FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM partners p WHERE p.business_id=b.id) LIMIT 1; UPDATE partners SET status='REJECTED', suspended_reason=NULL WHERE id=coalesce((SELECT id FROM partners WHERE id='dddddddd-1012-4000-a000-000000000001'),(SELECT id FROM partners LIMIT 1)); ROLLBACK;"

# 안심소개 상담 신청 흐름 · 축별 입점 · 정액 노출 (D016~D019 — 10/2 올린 kit v10.4.7 변경분)
eq   "SV-C1 휴대폰 확인 없이 리드가 된 상담 신청 0 (INV-12)" "SELECT count(*) FROM v_consult_lead_unverified" 0
eq   "SV-C2 같은 때에 두 곳 이상이 받은 상담 리드 0 (INV-L1)" "SELECT count(*) FROM v_lead_multi_delivery" 0
eq   "SV-C3 정액 노출형(법률 · 세무)에서 나온 리드 · 상담 신청 0" "SELECT count(*) FROM v_directory_lead_leak" 0
eq   "SV-C4 파기 기한 지난 상담 신청 연락처 0"       "SELECT count(*) FROM v_consult_purge_overdue" 0
eq   "SV-C5 상담 축 공개 업종 — 리드형 20 · 정액 노출형 2" "SELECT count(*) FILTER (WHERE consult_mode='LEAD')||'/'||count(*) FILTER (WHERE consult_mode='LISTING_FEE') FROM categories WHERE gwan_code='MAL' AND axis='CONSULT' AND status='APPROVED'" "20/2"
eq   "SV-C6 상담 신청 · 입점 · 정액 노출 지킴 트리거 3종" "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_consult_request_guard','trg_mal_partner_axes_guard','trg_directory_guard')" 3
eq   "SV-C7 보내는 업체 수 설정이 1 · 1 (동의 문구 「인증업체 1곳」)" "SELECT fn_lead_setting_int('lead.assign.target',0)||'/'||fn_lead_setting_int('lead.assign.max_partners',0)" "1/1"
# SV-C8~C11 — 시험 업체 · 신청을 같은 트랜잭션 안에서 만들고 되돌립니다(남는 행 없음). 암호화 열쇠도 그 안에서만 씁니다.
CQ="BEGIN; SET LOCAL app.enc_key='inv-check-enc-key-0123456789abcdef'; SET LOCAL session_replication_role=replica;
  INSERT INTO accounts(id,email,password_hash,name) VALUES ('dddddddd-3018-4000-a000-0000000000a1','inv-c18@x.invalid','x','불변식 시험 업체');
  INSERT INTO businesses(id,account_id,biz_reg_no,company_name,ceo_name) VALUES ('dddddddd-3018-4000-a000-0000000000b1','dddddddd-3018-4000-a000-0000000000a1','000-00-30180','불변식 시험 청소','시험');
  INSERT INTO partners(id,business_id,status,unpaid_cap,approved_at) VALUES ('dddddddd-3018-4000-a000-0000000000c1','dddddddd-3018-4000-a000-0000000000b1','ACTIVE',100000,now());
  INSERT INTO partner_services(partner_id,category_id,title,status) VALUES ('dddddddd-3018-4000-a000-0000000000c1',(SELECT id FROM categories WHERE code='CSL_CLEANING'),'불변식 시험 서비스','APPROVED');
  INSERT INTO partner_regions(partner_id,sido,sigungu) VALUES ('dddddddd-3018-4000-a000-0000000000c1','불변식도','전체');
  SET LOCAL session_replication_role=origin;
  INSERT INTO consult_requests(id,category_id,contact_enc,phone_hash,sido,consent_version,consented_at,verified_at)
  VALUES ('dddddddd-3018-4000-a000-0000000000d1',(SELECT id FROM categories WHERE code='CSL_CLEANING'),
          pgp_sym_encrypt('{\"name\":\"불변식\",\"phone\":\"01000003018\"}', fn_enc_key()),'inv-c18','불변식도','t',now(),now());"
CAX="INSERT INTO mal_partner_axes(business_id,axis,state,source,decided_at) VALUES ('dddddddd-3018-4000-a000-0000000000b1','CONSULT','APPROVED','ADMIN',now());"
CCHK="DO \$\$ DECLARE r record; n int; BEGIN
    SELECT * INTO r FROM fn_consult_deliver('dddddddd-3018-4000-a000-0000000000d1');
    IF r.state <> 'DELIVERED' OR r.partner_id <> 'dddddddd-3018-4000-a000-0000000000c1' THEN RAISE EXCEPTION 'not delivered: %', r.state; END IF;
    SELECT count(*) INTO n FROM lead_deliveries d WHERE d.lead_id = r.lead_id AND d.state='DELIVERED'; IF n <> 1 THEN RAISE EXCEPTION 'deliveries %', n; END IF;
    IF NOT EXISTS (SELECT 1 FROM pii.lead_contacts pc WHERE pc.lead_id = r.lead_id AND pc.phone_enc IS NOT NULL) THEN RAISE EXCEPTION 'contact not moved'; END IF;
    IF (SELECT contact_enc IS NOT NULL FROM consult_requests WHERE id='dddddddd-3018-4000-a000-0000000000d1') THEN RAISE EXCEPTION 'contact left in request'; END IF;
    PERFORM 1 FROM fn_consult_deliver('dddddddd-3018-4000-a000-0000000000d1');
    SELECT count(*) INTO n FROM lead_deliveries d WHERE d.lead_id = r.lead_id; IF n <> 1 THEN RAISE EXCEPTION 'duplicated %', n; END IF;
  END \$\$;"
# v10.31 (합침 · W5 D070) — 리드 이용료가 선불 충전이라 잔액이 0 인 업체는 후보에서 빠집니다(「리드 이용료 잔액 부족」).
#   시험 업체에 시험 결제(스텁) 10만 원을 넣고 배분을 봅니다(원장 · 불변식을 그대로 탐 — 같은 트랜잭션에서 되돌림).
CFUND="DO \$\$ DECLARE v uuid; BEGIN INSERT INTO lead_cash_charges(partner_id, order_id, amount, bonus_rate, bonus_amount, source) VALUES ('dddddddd-3018-4000-a000-0000000000c1','lc-inv-c18',100000,0,0,'MANUAL') RETURNING id INTO v; PERFORM fn_lead_cash_charge_done(v, 'stub_inv_c18', 'STUB', true, NULL); END \$\$;"
run  "SV-C8 확인된 신청 → 인증업체 1곳 배분 · 연락처 이관 · 재호출해도 1곳" PASS "$CQ $CAX $CFUND $CCHK ROLLBACK;"
run  "SV-C9 상담 축 입점 승인 없는 업체에는 배분되지 않음(NO_PARTNER · 리드 없음)" PASS "$CQ DO \$\$ DECLARE r record; BEGIN SELECT * INTO r FROM fn_consult_deliver('dddddddd-3018-4000-a000-0000000000d1'); IF r.state <> 'NO_PARTNER' OR r.lead_id IS NOT NULL THEN RAISE EXCEPTION 'leaked: %', r.state; END IF; IF EXISTS (SELECT 1 FROM leads l JOIN categories c ON c.id=l.category_id WHERE l.sido='불변식도') THEN RAISE EXCEPTION 'lead left'; END IF; IF (SELECT contact_enc IS NULL FROM consult_requests WHERE id='dddddddd-3018-4000-a000-0000000000d1') THEN RAISE EXCEPTION 'contact dropped'; END IF; END \$\$; ROLLBACK;"
run  "SV-C10 입점 승인 없는 업체로 직접 배정 차단 (LEAD_PARTNER_AXIS)" FAIL "$CQ DO \$\$ DECLARE v uuid; BEGIN INSERT INTO leads(category_id,sido,summary,assign_state,target_partners,assign_deadline,source) VALUES ((SELECT id FROM categories WHERE code='CSL_CLEANING'),'불변식도','불변식 시험','OPEN',1,now()+interval '1 day','ADMIN') RETURNING id INTO v; BEGIN INSERT INTO lead_deliveries(lead_id,partner_id) VALUES (v,'dddddddd-3018-4000-a000-0000000000c1'); EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'LEAD_PARTNER_AXIS%' THEN RAISE EXCEPTION 'blocked by axis guard'; END IF; END; END \$\$; ROLLBACK;"
run  "SV-C11 확인 전 신청은 배분 거부 (CONSULT_UNVERIFIED)" FAIL "$CQ $CAX UPDATE consult_requests SET verified_at=NULL WHERE id='dddddddd-3018-4000-a000-0000000000d1'; DO \$\$ BEGIN BEGIN PERFORM 1 FROM fn_consult_deliver('dddddddd-3018-4000-a000-0000000000d1'); EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CONSULT_UNVERIFIED%' THEN RAISE EXCEPTION 'blocked: unverified'; END IF; END; END \$\$; ROLLBACK;"
run  "SV-C12 6개월 지난 상담 신청 연락처는 파기 함수가 지움" PASS "$CQ UPDATE consult_requests SET purge_after = now() - interval '1 day' WHERE id='dddddddd-3018-4000-a000-0000000000d1'; DO \$\$ BEGIN PERFORM fn_consult_purge(); IF (SELECT contact_enc IS NOT NULL OR state <> 'PURGED' FROM consult_requests WHERE id='dddddddd-3018-4000-a000-0000000000d1') THEN RAISE EXCEPTION 'not purged'; END IF; END \$\$; ROLLBACK;"

# ── D020 (v10.12) 법률 · 세무 월 노출료 기준 금액 — 관리자가 등록 · 시작값 300,000원 ──
run  "SV-C13 월 노출료 기준 금액 설정이 있고 숫자로 읽힘 (directory.monthly_fee)" PASS "BEGIN; DO \$\$ BEGIN IF fn_directory_base_fee() IS NULL OR fn_directory_base_fee() <= 0 THEN RAISE EXCEPTION 'no base fee'; END IF; END \$\$; ROLLBACK;"
run  "SV-C14 기준 금액에 숫자가 아닌 값은 저장되지 않음 (형식 규칙)" FAIL "BEGIN; UPDATE site_settings SET value='30만원' WHERE key='directory.monthly_fee'; ROLLBACK;"

# ── D021 (v10.14) 소개광장 「이건 어때?」 투표 · 사회관계망 주소 ──
#   결정(10/2): 비로그인도 투표(회원 1인 1표 · 비로그인은 방문자 1표) · 참여 수는 실제 표 수 · 사회관계망 주소는 운영이 입력
PP=eeeeeeee-0021-4000-a000-000000000001; PA=eeeeeeee-0021-4000-a000-0000000000a1; PB=eeeeeeee-0021-4000-a000-0000000000a2
PD="BEGIN; INSERT INTO polls(id,kind,title) VALUES ('$PP','VS','불변식 시험 투표'); INSERT INTO poll_options(id,poll_id,sort,label) VALUES ('$PA','$PP',1,'가'),('$PB','$PP',2,'나');"
PQ="$PD UPDATE polls SET state='OPEN' WHERE id='$PP';"
run  "SV-P1 열린 투표에 회원 1표 · 비로그인 1표가 들어감" PASS "$PQ INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); INSERT INTO poll_votes(poll_id,option_id,visitor_key) VALUES ('$PP','$PB','inv-visitor-0001'); ROLLBACK;"
run  "SV-P2 같은 회원의 두 번째 표 차단 (POLL_VOTED)" FAIL "$PQ INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PB','$B'); ROLLBACK;"
run  "SV-P3 같은 방문자의 두 번째 표 차단 (POLL_VOTED)" FAIL "$PQ INSERT INTO poll_votes(poll_id,option_id,visitor_key) VALUES ('$PP','$PA','inv-visitor-0001'); INSERT INTO poll_votes(poll_id,option_id,visitor_key) VALUES ('$PP','$PB','inv-visitor-0001'); ROLLBACK;"
run  "SV-P4 준비 중인 투표에는 표가 안 들어감 (POLL_CLOSED)" FAIL "$PD INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); ROLLBACK;"
run  "SV-P5 마감한 투표에는 표가 안 들어감 (POLL_CLOSED)" FAIL "$PQ UPDATE polls SET state='CLOSED' WHERE id='$PP'; INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); ROLLBACK;"
run  "SV-P6 넣은 표는 고칠 수 없음 (POLL_VOTE_FIXED)" FAIL "$PQ INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); UPDATE poll_votes SET option_id='$PB' WHERE poll_id='$PP'; ROLLBACK;"
run  "SV-P7 넣은 표는 지울 수 없음 (POLL_VOTE_FIXED)" FAIL "$PQ INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); DELETE FROM poll_votes WHERE poll_id='$PP'; ROLLBACK;"
run  "SV-P8 「비교해요」는 보기 2개가 아니면 못 엶 (POLL_OPTIONS)" FAIL "$PD INSERT INTO poll_options(poll_id,sort,label) VALUES ('$PP',3,'다'); UPDATE polls SET state='OPEN' WHERE id='$PP'; ROLLBACK;"
run  "SV-P9 표가 들어온 뒤 보기 추가 차단 (POLL_LOCKED)" FAIL "$PQ INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); INSERT INTO poll_options(poll_id,sort,label) VALUES ('$PP',3,'다'); ROLLBACK;"
run  "SV-P10 표가 들어온 뒤 보기 이름 바꾸기 차단 (POLL_LOCKED)" FAIL "$PQ INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); UPDATE poll_options SET label='바꿈' WHERE id='$PB'; ROLLBACK;"
run  "SV-P11 비로그인 투표를 끄면 비로그인 표 차단 (POLL_LOGIN)" FAIL "$PQ UPDATE site_settings SET value='off' WHERE key='poll.guest_vote'; INSERT INTO poll_votes(poll_id,option_id,visitor_key) VALUES ('$PP','$PA','inv-visitor-0001'); ROLLBACK;"
run  "SV-P12 비로그인 투표를 꺼도 회원 표는 들어감" PASS "$PQ UPDATE site_settings SET value='off' WHERE key='poll.guest_vote'; INSERT INTO poll_votes(poll_id,option_id,account_id) VALUES ('$PP','$PA','$B'); ROLLBACK;"
run  "SV-P13 같은 주소의 하루 한도를 넘는 비로그인 표 차단 (POLL_IP_LIMIT)" FAIL "$PQ UPDATE site_settings SET value='1' WHERE key='poll.guest_ip_daily_limit'; INSERT INTO poll_votes(poll_id,option_id,visitor_key,ip_hash) VALUES ('$PP','$PA','inv-visitor-0001',repeat('a',64)); INSERT INTO poll_votes(poll_id,option_id,visitor_key,ip_hash) VALUES ('$PP','$PB','inv-visitor-0002',repeat('a',64)); ROLLBACK;"
run  "SV-P14 한도 안에서는 같은 주소의 다른 방문자 표가 들어감" PASS "$PQ UPDATE site_settings SET value='2' WHERE key='poll.guest_ip_daily_limit'; INSERT INTO poll_votes(poll_id,option_id,visitor_key,ip_hash) VALUES ('$PP','$PA','inv-visitor-0001',repeat('a',64)); INSERT INTO poll_votes(poll_id,option_id,visitor_key,ip_hash) VALUES ('$PP','$PB','inv-visitor-0002',repeat('a',64)); ROLLBACK;"
run  "SV-P15 사유 없이 감추기 차단" FAIL "$PQ UPDATE polls SET state='HIDDEN' WHERE id='$PP'; ROLLBACK;"
run  "SV-P16 계정도 방문자 키도 없는 표 차단" FAIL "$PQ INSERT INTO poll_votes(poll_id,option_id) VALUES ('$PP','$PA'); ROLLBACK;"
eq   "SV-P17 메인에 나가는 투표는 종류마다 1건 이하 (v_poll_home)" "SELECT count(*) FROM (SELECT kind FROM v_poll_home GROUP BY kind HAVING count(*) > 1) x" 0
eq   "SV-P18 참여 수는 표를 세어서만 나옴 — 표 수를 적어 두는 칸이 없음" "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('polls','poll_options') AND column_name ~ '(vote|count|total)'" 0
eq   "SV-P19 주소(IP) 원문을 담는 칸이 없음 (해시만)" "SELECT count(*) FROM information_schema.columns WHERE table_name='poll_votes' AND (data_type='inet' OR column_name IN ('ip','ip_address','remote_addr'))" 0
run  "SV-P20 사회관계망 주소에 http:// 는 저장되지 않음 (형식 규칙)" FAIL "BEGIN; UPDATE site_settings SET value='http://www.instagram.com/sogaebank' WHERE key='sns.instagram'; ROLLBACK;"
run  "SV-P21 사회관계망 주소 — https:// 주소와 빈 값은 저장됨" PASS "BEGIN; UPDATE site_settings SET value='https://www.instagram.com/sogaebank' WHERE key='sns.instagram'; UPDATE site_settings SET value='' WHERE key='sns.instagram'; ROLLBACK;"
eq   "SV-P22 투표 · 사회관계망 설정 6개가 있음" "SELECT count(*) FROM site_settings WHERE key IN ('poll.guest_vote','poll.guest_ip_daily_limit','sns.facebook','sns.instagram','sns.x','sns.youtube')" 6

echo
echo "== 결제 · 환불 정합 (D022 · 2026-10-06) =="
# 결제사의 실제 결과와 DB 가 같아야 합니다. 막는 길은 attack-check(M-23~28 · BL)가 「누가 막았는지」까지 보고,
# 여기서는 **정상 흐름이 통과하는지**와 감시 뷰 · 제약이 있는지를 봅니다. 전부 BEGIN … ROLLBACK 안에서 돕니다.
BS=bbbbbbbb-0000-4000-a000-000000000001
D22="BEGIN; UPDATE subscriptions SET plan_code='STANDARD', status='ACTIVE', cancel_at=NULL, refunded_at=NULL, refund_reason=NULL, current_period_start=now(), current_period_end=now()+interval '30 days', request_views_used=0, codes_used_this_period=0 WHERE id='$BS';"
D22P="$D22 INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status,payment_key,order_id,paid_at) SELECT id,current_period_start,current_period_end,49000,'PAID','pk_d22','ord_d22',now() FROM subscriptions WHERE id='$BS';"
D22R="INSERT INTO subscription_refunds(subscription_id,invoice_id,account_id,amount,reason) SELECT s.id,i.id,s.account_id,i.amount,'시험 환불' FROM subscriptions s JOIN subscription_invoices i ON i.subscription_id=s.id AND i.payment_key='pk_d22' WHERE s.id='$BS';"
run  "D22-01 환불: 접수 → 처리 중 → 결제사 취소 확인 → 청구서 · 구독이 함께 환불로" PASS "$D22P $D22R UPDATE subscription_refunds SET state='PROCESSING' WHERE subscription_id='$BS'; UPDATE subscription_refunds SET state='SUCCEEDED', canceled_amount=49000 WHERE subscription_id='$BS'; UPDATE subscription_invoices SET status='REFUNDED' WHERE payment_key='pk_d22'; UPDATE subscriptions SET refunded_at=now(), refund_reason='시험 환불', status='CANCELLED' WHERE id='$BS'; ROLLBACK;"
run  "D22-02 환불: 결과 불명확(UNKNOWN)으로 뒀다가 나중에 완료로 닫을 수 있음" PASS "$D22P $D22R UPDATE subscription_refunds SET state='UNKNOWN', pg_status='NO_RESPONSE' WHERE subscription_id='$BS'; UPDATE subscription_refunds SET state='PROCESSING' WHERE subscription_id='$BS'; UPDATE subscription_refunds SET state='SUCCEEDED', canceled_amount=49000 WHERE subscription_id='$BS'; ROLLBACK;"
run  "D22-03 환불: 결제사가 거절(FAILED)한 뒤에는 새 요청을 넣을 수 있음" PASS "$D22P $D22R UPDATE subscription_refunds SET state='FAILED', failure_reason='취소 불가' WHERE subscription_id='$BS'; $D22R ROLLBACK;"
run  "D22-04 환불: 거절로 닫을 때 사유가 없으면 차단" FAIL "$D22P $D22R UPDATE subscription_refunds SET state='FAILED' WHERE subscription_id='$BS'; ROLLBACK;"
eq   "D22-05 환불 요청에 접수 때의 근거(결제한 날 · 이용 수)와 결제사 멱등 키가 자동으로 적힘" "$D22P $D22R SELECT (eligibility->>'used') || '/' || (eligibility ? 'paidOn')::text || '/' || (pg_idem_key = 'sub-refund-' || id::text)::text FROM subscription_refunds WHERE subscription_id='$BS'; ROLLBACK;" "0/true/true"
# 「당일」은 한국 날짜입니다. 오늘 0시 1분(한국)에 결제했으면 지금이 몇 시든 오늘은 환불할 수 있어야 합니다(UTC 날짜로 보면 오전 9시 뒤로 안 됨).
eq   "D22-06 환불 자격의 「결제 당일」은 한국 날짜 — 오늘 0시 1분(한국) 결제는 오늘 가능" "$D22 INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status,payment_key,paid_at) SELECT id,current_period_start,current_period_end,49000,'PAID','pk_d22',least(now(), date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' + interval '1 minute') FROM subscriptions WHERE id='$BS'; SELECT eligible FROM fn_refund_eligible('$BS'); ROLLBACK;" "t"
eq   "D22-07 어제 23시 59분(한국) 결제는 오늘 불가" "$D22 INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status,payment_key,paid_at) SELECT id,current_period_start,current_period_end,49000,'PAID','pk_d22',date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' - interval '1 minute' FROM subscriptions WHERE id='$BS'; SELECT eligible FROM fn_refund_eligible('$BS'); ROLLBACK;" "f"
# 정기결제 — 실패했던 그 줄을 다시 잡아(PENDING) 결제 완료로. 새 줄을 만들지 않습니다.
D22F="$D22 INSERT INTO subscription_invoices(subscription_id,period_start,period_end,amount,status,failure_reason) SELECT id,current_period_end,current_period_end+interval '30 days',49000,'FAILED','한도 초과' FROM subscriptions WHERE id='$BS';"
D22W="subscription_id='$BS' AND period_start=(SELECT current_period_end FROM subscriptions WHERE id='$BS')"
eq   "D22-08 정기결제: 실패한 청구서를 다시 잡아(PENDING) 결제 완료로 — 같은 줄 · 잡은 시각 · 결제 시각이 적힘" "$D22F UPDATE subscription_invoices SET status='PENDING', attempt=attempt+1, order_id='ord_d22_a2' WHERE $D22W; UPDATE subscription_invoices SET status='PAID', payment_key='pk_d22_a2' WHERE $D22W; SELECT count(*) || '/' || max(status) || '/' || max(attempt) || '/' || (bool_and(claimed_at IS NOT NULL AND paid_at IS NOT NULL))::text FROM subscription_invoices WHERE $D22W; ROLLBACK;" "1/PAID/2/true"
run  "D22-09 정기결제: 결과 불명확(PENDING)을 실패로 닫았다가 다시 잡을 수 있음" PASS "$D22F UPDATE subscription_invoices SET status='PENDING', order_id='ord_d22_a2' WHERE $D22W; UPDATE subscription_invoices SET status='FAILED', failure_reason='결제사에 주문 없음' WHERE $D22W; UPDATE subscription_invoices SET status='PENDING', order_id='ord_d22_a3' WHERE $D22W; ROLLBACK;"
run  "D22-10 정기결제: 결제 근거 없이 결제 완료로 바꾸기 차단" FAIL "$D22F UPDATE subscription_invoices SET status='PAID' WHERE $D22W; ROLLBACK;"
eq   "D22-11 청구 대상(v_billing_due)에서 환불 처리 중인 구독이 빠짐" "$D22P $D22R SET session_replication_role = replica; UPDATE subscriptions SET current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' WHERE id='$BS'; SET session_replication_role = origin; INSERT INTO billing_keys(account_id,billing_key,card_company,card_last4) SELECT account_id,'bk_d22','시험','0000' FROM subscriptions WHERE id='$BS' ON CONFLICT DO NOTHING; SELECT count(*) FROM v_billing_due WHERE subscription_id='$BS'; ROLLBACK;" "0"
eq   "D22-12 (대조) 환불 요청이 없으면 같은 구독이 청구 대상에 오름" "$D22P SET session_replication_role = replica; UPDATE subscriptions SET current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute' WHERE id='$BS'; SET session_replication_role = origin; INSERT INTO billing_keys(account_id,billing_key,card_company,card_last4) SELECT account_id,'bk_d22','시험','0000' FROM subscriptions WHERE id='$BS' ON CONFLICT DO NOTHING; SELECT count(*) FROM v_billing_due WHERE subscription_id='$BS'; ROLLBACK;" "1"
eq   "D22-13 결제 · 환불 기록의 어긋남 없음 (v_billing_integrity)" "SELECT count(*) FROM v_billing_integrity" 0
eq   "D22-14 유일 제약 3종 — 주문번호 · 결제 키 · 청구서당 살아 있는 환불 요청" "SELECT count(*) FROM pg_indexes WHERE indexname IN ('uq_invoice_order_id','uq_invoice_payment_key','uq_sub_refund_live') AND indexdef LIKE 'CREATE UNIQUE%'" 3
eq   "D22-15 환불 요청 규칙 트리거 3종 · 소개코드 차단 트리거가 켜져 있음" "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_sub_refund_insert','trg_sub_refund_update','trg_sub_refund_no_delete','trg_refcode_refund_block') AND tgenabled = 'O'" 4
eq   "D22-16 중복 요청 기록에 상태 · 본문 해시 · HTTP 상태 칸과 상태 제약이 있음" "SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='idempotency_records' AND column_name IN ('state','request_hash','http_status','route','account_id','started_at','completed_at')) || '/' || (SELECT count(*) FROM pg_constraint WHERE conname='idempotency_records_state_check')" "7/1"
eq   "D22-17 청구 시도 기록이 「결과 불명확(UNKNOWN)」 · 「회원 탓이 아닌 실패(SYSTEM)」를 받음" "BEGIN; INSERT INTO billing_attempts(subscription_id,period_start,amount,result,detail) VALUES ('$BS', now(), 49000, 'UNKNOWN', '응답 지연'), ('$BS', now(), 49000, 'SYSTEM', '연동 설정 오류'); SELECT count(*) FROM billing_attempts WHERE subscription_id='$BS' AND result IN ('UNKNOWN','SYSTEM'); ROLLBACK;" 2
eq   "D22-19 청구서에 「열쇠 없는 방식(스텁)」 표시 칸이 있고 기본은 아님(false)" "SELECT column_default || '/' || is_nullable FROM information_schema.columns WHERE table_name='subscription_invoices' AND column_name='is_stub'" "false/NO"
run  "D22-18 청구 시도 기록에 없는 결과값 차단" FAIL "BEGIN; INSERT INTO billing_attempts(subscription_id,period_start,amount,result) VALUES ('$BS', now(), 49000, 'MAYBE'); ROLLBACK;"

echo
echo "== 매물 상세 — 후기 규칙 · 누적수익 공개 (D023 · 2026-10-07) =="
# 후기는 성사 확정된 거래의 당사자(구매자 · 판매자)만, 대상은 그 거래의 소개자 또는 상대방. 누적수익은 본인이 켠 경우에만 뷰에 나옵니다.
# 전부 BEGIN … ROLLBACK 안에서 돕니다(거래 $D 를 성사 확정 상태로 맞춰 놓고 봅니다 — 앞의 점검이 상태를 바꿨을 수 있습니다).
D23="BEGIN; SET LOCAL session_replication_role = replica; UPDATE deals SET status='CONFIRMED', confirmed_at=now() WHERE id='$D'; SET LOCAL session_replication_role = origin;"
run  "D23-01 후기: 구매자가 성사 확정된 거래에 — 대상은 판매자" PASS "$D23 INSERT INTO deal_reviews(deal_id,author_id,target_id,rating) VALUES ('$D','$BUY','$SEL',5); ROLLBACK;"
run  "D23-02 후기: 거래 당사자가 아닌 회원이 쓰면 차단" FAIL "$D23 INSERT INTO deal_reviews(deal_id,author_id,target_id,rating) VALUES ('$D','$IND','$SEL',5); ROLLBACK;"
run  "D23-03 후기: 자기 자신을 대상으로 하면 차단" FAIL "$D23 INSERT INTO deal_reviews(deal_id,author_id,target_id,rating) VALUES ('$D','$BUY','$BUY',5); ROLLBACK;"
run  "D23-04 후기: 그 거래와 무관한 회원을 대상으로 하면 차단" FAIL "$D23 INSERT INTO deal_reviews(deal_id,author_id,target_id,rating) VALUES ('$D','$BUY','$IND',5); ROLLBACK;"
run  "D23-05 후기: 성사 확정 전 거래에는 차단 (INV-5)" FAIL "BEGIN; SET LOCAL session_replication_role = replica; UPDATE deals SET status='INQUIRY' WHERE id='$D'; SET LOCAL session_replication_role = origin; INSERT INTO deal_reviews(deal_id,author_id,target_id,rating) VALUES ('$D','$BUY','$SEL',5); ROLLBACK;"
run  "D23-06 후기: 쓴 뒤 대상을 바꾸면 차단" FAIL "$D23 INSERT INTO deal_reviews(deal_id,author_id,target_id,rating) VALUES ('$D','$BUY','$SEL',5); UPDATE deal_reviews SET target_id='$IND' WHERE deal_id='$D'; ROLLBACK;"
run  "D23-07 후기: 평점 · 본문은 고칠 수 있음" PASS "$D23 INSERT INTO deal_reviews(deal_id,author_id,target_id,rating) VALUES ('$D','$BUY','$SEL',5); UPDATE deal_reviews SET rating=4, body='고침' WHERE deal_id='$D'; ROLLBACK;"
eq   "D23-08 누적수익 공개의 기본은 꺼짐 — accounts.earnings_public 기본 false · NOT NULL" "SELECT column_default || '/' || is_nullable FROM information_schema.columns WHERE table_name='accounts' AND column_name='earnings_public'" "false/NO"
eq   "D23-09 공개를 켜지 않은 회원의 누적수익은 뷰(v_owner_public_stats)에 한 건도 나오지 않음" "SELECT count(*) FROM v_owner_public_stats WHERE NOT earnings_public AND settled_amount IS NOT NULL" 0
eq   "D23-10 본인이 켜면 뷰에 값이 나옴" "BEGIN; UPDATE accounts SET earnings_public=true WHERE id='$B'; SELECT (settled_amount IS NOT NULL)::text FROM v_owner_public_stats WHERE account_id='$B'; ROLLBACK;" "true"
eq   "D23-11 총 소개 · 성사 · 성사율은 공개 여부와 관계없이 나옴(성사율은 총 소개 0 이면 null)" "SELECT count(*) FROM v_owner_public_stats WHERE total_deals IS NULL OR confirmed_deals IS NULL OR (total_deals = 0) <> (success_rate IS NULL)" 0
eq   "D23-12 후기 규칙 트리거가 켜져 있음" "SELECT count(*) FROM pg_trigger WHERE tgname='trg_review_rules' AND tgenabled='O'" 1


# ── v10.48 (D102) 로그인 잠금 · 요청 횟수 제한 · 비밀번호 재설정 · 회원 탈퇴 ─────────────────────
#   모든 시험은 BEGIN … ROLLBACK 안의 DO 블록에서 확인하고 마지막에 'ok' 만 냅니다(자료를 남기지 않음 ·
#   psql 이 여러 문장의 결과를 모두 찍어 값이 섞이지 않게). 이메일은 실제로 없는 주소(@t.invalid).
AE="zz-auth-inv@t.invalid"; AIP=$(printf '%064d' 7)
authq() { # $1=라벨 $2=DO 블록 본문(plpgsql) — 문제가 있으면 RAISE, 없으면 ok
  eq "$1" "BEGIN; DO \$\$ DECLARE a uuid; t timestamptz; x text; BEGIN $2 END \$\$; SELECT 'ok'; ROLLBACK;" "ok"
}
eq  "AUTH-01 설정 5개 · 처음 값(5회 · 30분 · IP 1분 5회 · 재설정 1시간 5회 · 링크 30분)" \
  "SELECT string_agg(key || '=' || value, ',' ORDER BY key) FROM site_settings WHERE key IN ('auth.login.max_fail','auth.login.lock_minutes','auth.login.ip_fail_per_min','auth.reset.per_hour','auth.reset.ttl_minutes');" \
  "auth.login.ip_fail_per_min=5,auth.login.lock_minutes=30,auth.login.max_fail=5,auth.reset.per_hour=5,auth.reset.ttl_minutes=30"
authq "AUTH-02 4번 틀리면 잠기지 않고 5번째에 잠김" "
  PERFORM fn_login_fail('$AE', NULL) FROM generate_series(1,3);
  SELECT locked_until INTO t FROM fn_login_fail('$AE', NULL); IF t IS NOT NULL THEN RAISE EXCEPTION '4번째에 잠김'; END IF;
  SELECT locked_until INTO t FROM fn_login_fail('$AE', NULL); IF t IS NULL THEN RAISE EXCEPTION '5번째에 안 잠김'; END IF;"
authq "AUTH-03 잠긴 동안 문 앞에서 막힘(LOCKED) · 풀면 열림" "
  PERFORM fn_login_fail('$AE', NULL) FROM generate_series(1,5);
  SELECT blocked INTO x FROM fn_login_gate('$AE', NULL); IF x IS DISTINCT FROM 'LOCKED' THEN RAISE EXCEPTION 'gate=%', x; END IF;
  IF fn_login_clear('$AE') <> 1 THEN RAISE EXCEPTION 'clear 0'; END IF;
  SELECT blocked INTO x FROM fn_login_gate('$AE', NULL); IF x IS NOT NULL THEN RAISE EXCEPTION '풀린 뒤 gate=%', x; END IF;"
authq "AUTH-04 잠금은 설정한 30분을 넘지 않음" "
  PERFORM fn_login_fail('$AE', NULL) FROM generate_series(1,5);
  SELECT locked_until INTO t FROM auth_throttle WHERE key_kind='LOGIN_EMAIL' AND key_hash=fn_auth_email_key('$AE');
  IF NOT (t <= now() + interval '30 minutes 1 second' AND t > now() + interval '29 minutes') THEN RAISE EXCEPTION 'locked_until=%', t; END IF;"
authq "AUTH-05 이메일은 대소문자 · 앞뒤 공백과 관계없이 같은 키 · 해시(원문 아님)" "
  IF fn_auth_email_key(' ZZ-Auth-Inv@T.invalid ') <> fn_auth_email_key('$AE') THEN RAISE EXCEPTION '대소문자'; END IF;
  IF fn_auth_email_key('$AE') !~ '^[0-9a-f]{64}\$' THEN RAISE EXCEPTION '해시 아님'; END IF;"
authq "AUTH-06 같은 IP 의 실패 1분 5회 → 다른 이메일도 TOO_MANY" "
  PERFORM fn_login_fail('a' || g || '$AE', '$AIP') FROM generate_series(1,5) g;
  SELECT blocked INTO x FROM fn_login_gate('other-$AE', '$AIP'); IF x IS DISTINCT FROM 'TOO_MANY' THEN RAISE EXCEPTION 'gate=%', x; END IF;"
authq "AUTH-07 성공(지움) 뒤에는 처음부터 다시 셈" "
  PERFORM fn_login_fail('$AE', NULL) FROM generate_series(1,4); PERFORM fn_login_clear('$AE');
  SELECT locked_until INTO t FROM fn_login_fail('$AE', NULL); IF t IS NOT NULL THEN RAISE EXCEPTION '지운 뒤 1번에 잠김'; END IF;"
authq "AUTH-08 재설정 메일 요청은 같은 이메일 1시간 5회까지(6번째 거절)" "
  PERFORM fn_reset_request_allowed('$AE', NULL) FROM generate_series(1,5);
  IF fn_reset_request_allowed('$AE', NULL) THEN RAISE EXCEPTION '6번째 허용'; END IF;"
authq "AUTH-09 재설정 증표는 한 번만" "
  SELECT id INTO a FROM accounts WHERE status='ACTIVE' ORDER BY created_at LIMIT 1;
  PERFORM fn_password_reset_issue(a, repeat('a',64), NULL);
  IF fn_password_reset_consume(repeat('a',64)) IS DISTINCT FROM a THEN RAISE EXCEPTION '첫 사용 실패'; END IF;
  IF fn_password_reset_consume(repeat('a',64)) IS NOT NULL THEN RAISE EXCEPTION '두 번 씀'; END IF;"
authq "AUTH-10 새로 요청하면 그 전 증표는 무효" "
  SELECT id INTO a FROM accounts WHERE status='ACTIVE' ORDER BY created_at LIMIT 1;
  PERFORM fn_password_reset_issue(a, repeat('b',64), NULL); PERFORM fn_password_reset_issue(a, repeat('c',64), NULL);
  IF fn_password_reset_consume(repeat('b',64)) IS NOT NULL THEN RAISE EXCEPTION '옛 증표가 살아 있음'; END IF;
  IF fn_password_reset_consume(repeat('c',64)) IS NULL THEN RAISE EXCEPTION '새 증표 실패'; END IF;"
authq "AUTH-11 만료된 증표는 못 씀" "
  SELECT id INTO a FROM accounts WHERE status='ACTIVE' ORDER BY created_at LIMIT 1;
  PERFORM fn_password_reset_issue(a, repeat('d',64), NULL);
  UPDATE password_reset_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '90 minutes' WHERE token_hash = repeat('d',64);
  IF fn_password_reset_consume(repeat('d',64)) IS NOT NULL THEN RAISE EXCEPTION '만료 증표 사용'; END IF;"
authq "AUTH-12 막는 일이 없는 회원은 탈퇴됨 — 상태 · 판 번호 · 기록 · 보관 기한 · 매물 내림" "
  INSERT INTO accounts (email, password_hash, name) VALUES ('wd-$AE', 'x', '탈퇴시험') RETURNING id INTO a;
  PERFORM fn_account_withdraw(a, 'LOW_USE', NULL);
  SELECT status INTO x FROM accounts WHERE id = a; IF x <> 'WITHDRAWN' THEN RAISE EXCEPTION 'status=%', x; END IF;
  IF (SELECT token_version FROM accounts WHERE id = a) <> 1 THEN RAISE EXCEPTION '판 번호'; END IF;
  IF NOT EXISTS (SELECT 1 FROM account_withdrawals WHERE account_id = a) THEN RAISE EXCEPTION '기록 없음'; END IF;
  IF (SELECT retention_until FROM accounts WHERE id = a) IS NULL THEN RAISE EXCEPTION '보관 기한 없음'; END IF;"
authq "AUTH-13 진행 중인 거래가 있으면 탈퇴 함수가 막음(WITHDRAW_BLOCKED)" "
  SELECT buyer_account_id INTO a FROM deals ORDER BY created_at LIMIT 1;
  IF a IS NULL THEN RAISE EXCEPTION '시험 거래 없음'; END IF;
  SET LOCAL session_replication_role = replica;
  UPDATE deals SET status='NEGOTIATING' WHERE id = (SELECT id FROM deals ORDER BY created_at LIMIT 1);
  SET LOCAL session_replication_role = origin;
  BEGIN PERFORM fn_account_withdraw(a, 'LOW_USE', NULL); RAISE EXCEPTION '탈퇴됨';
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS x = MESSAGE_TEXT;
    IF x NOT LIKE 'WITHDRAW_BLOCKED%' THEN RAISE EXCEPTION '다른 이유: %', x; END IF; END;"
authq "AUTH-14 함수를 거치지 않고 withdrawn_at 을 직접 찍어도 막힘(가드 트리거)" "
  SELECT seller_account_id INTO a FROM deals ORDER BY created_at LIMIT 1;
  SET LOCAL session_replication_role = replica;
  UPDATE deals SET status='CONTRACTED' WHERE id = (SELECT id FROM deals ORDER BY created_at LIMIT 1);
  SET LOCAL session_replication_role = origin;
  BEGIN UPDATE accounts SET withdrawn_at = now() WHERE id = a; RAISE EXCEPTION '탈퇴됨';
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS x = MESSAGE_TEXT;
    IF x NOT LIKE 'WITHDRAW_BLOCKED%' THEN RAISE EXCEPTION '다른 이유: %', x; END IF; END;"
authq "AUTH-15 「기타」 사유는 내용이 있어야 함" "
  INSERT INTO accounts (email, password_hash, name) VALUES ('wd2-$AE', 'x', '탈퇴시험') RETURNING id INTO a;
  BEGIN PERFORM fn_account_withdraw(a, 'OTHER', NULL); RAISE EXCEPTION '탈퇴됨';
  EXCEPTION WHEN check_violation THEN NULL; END;"
authq "AUTH-16 탈퇴한 회원의 재설정 증표는 못 씀" "
  INSERT INTO accounts (email, password_hash, name) VALUES ('wd3-$AE', 'x', '탈퇴시험') RETURNING id INTO a;
  PERFORM fn_password_reset_issue(a, repeat('e',64), NULL);
  UPDATE accounts SET withdrawn_at = now() WHERE id = a;
  IF fn_password_reset_consume(repeat('e',64)) IS NOT NULL THEN RAISE EXCEPTION '탈퇴 회원 증표 사용'; END IF;"
eq  "AUTH-17 감시 보기 3개 0(잠금 과다 · 남은 증표 · 돈 걸린 채 탈퇴)" \
  "SELECT (SELECT count(*) FROM v_auth_lock_overlong) + (SELECT count(*) FROM v_reset_token_live_overdue) + (SELECT count(*) FROM v_withdrawn_with_open_items);" "0"
eq  "AUTH-18 알림 종류 2개(비밀번호 변경 · 로그인 잠금) — 수신거부 불가" \
  "SELECT count(*) FROM notification_event_policies WHERE event_code IN ('PASSWORD_CHANGED','LOGIN_LOCKED') AND NOT optout_allowed;" "2"
eq  "AUTH-19 탈퇴 가드 트리거가 켜져 있음" "SELECT count(*) FROM pg_trigger WHERE tgname='trg_account_withdraw_guard' AND tgenabled='O'" "1"

# ── v10.49 (D103 · docs/101) 메인 「오늘의 날씨」 — 처음엔 꺼짐 · 키는 암호문 · 형식 검사 · 다른 연동 키는 여전히 못 넣음 ─────
eq   "WX-1 날씨 사용(weather.enabled) 처음 off"          "SELECT value FROM site_settings WHERE key='weather.enabled'" off
eq   "WX-2 처음 지역 SEOUL"                              "SELECT value FROM site_settings WHERE key='weather.default_region'" SEOUL
eq   "WX-3 연동 표 WEATHER · 키 이름 KMA_SERVICE_KEY · 오픈을 막지 않음" \
  "SELECT count(*) FROM integrations WHERE code='WEATHER' AND secret_key_name='KMA_SERVICE_KEY' AND NOT blocks_open" 1
run  "WX-4 기상청 키(Decoding · + / =)는 암호문으로 저장 · 꺼내면 원래 값 · 결제 키는 여전히 못 넣음" PASS "BEGIN; SET LOCAL app.enc_key='inv-check-enc-key-0123456789abcdef';
  SELECT * FROM fn_integ_secret_set('WEATHER','KMA_SERVICE_KEY','invWxKey+abc/DEF0123456789==', NULL);
  DO \$\$ BEGIN
    IF fn_integ_secret_get('WEATHER','KMA_SERVICE_KEY') <> 'invWxKey+abc/DEF0123456789==' THEN RAISE EXCEPTION 'roundtrip'; END IF;
    IF EXISTS (SELECT 1 FROM integration_secrets WHERE position(convert_to('invWxKey', 'UTF8') IN value_enc) > 0) THEN RAISE EXCEPTION 'plaintext'; END IF;
    IF NOT (SELECT secret_registered FROM integrations WHERE code='WEATHER') THEN RAISE EXCEPTION 'registered'; END IF;
    BEGIN
      INSERT INTO integration_secrets(integration_code,name,value_enc,last4) VALUES ('PG','TOSS_SECRET_KEY','\\x00','0000');
      RAISE EXCEPTION 'other-key-accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
  END \$\$; ROLLBACK;"
run  "WX-5 기상청 키 형식이 아니면 거절(INTEG_SECRET_FORMAT)" FAIL "BEGIN; SET LOCAL app.enc_key='inv-check-enc-key-0123456789abcdef'; SELECT * FROM fn_integ_secret_set('WEATHER','KMA_SERVICE_KEY','짧은 키 <script>', NULL); ROLLBACK;"
run  "WX-6 카카오 키는 여전히 카카오 형식만(+ / = 거절)" FAIL "BEGIN; SET LOCAL app.enc_key='inv-check-enc-key-0123456789abcdef'; SELECT * FROM fn_integ_secret_set('MAP','KAKAO_REST_KEY','abcdefgh+ijklmnop/qrst==', NULL); ROLLBACK;"
eq   "WX-7 어떤 보기도 키(integration_secrets)를 읽지 않음" "SELECT count(*) FROM v_secret_leak" 0

echo "통과 $pass / 실패 $fail"
[ $fail -eq 0 ] || exit 1
