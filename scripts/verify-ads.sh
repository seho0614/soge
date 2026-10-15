#!/usr/bin/env bash
# =====================================================================
# 광고 플랫폼 검정
#
# 분리했다고 규칙이 느슨해지면 안 됩니다. 본체가 지키던 것을
# 여기서도 같은 강도로 확인합니다.
# =====================================================================
set -uo pipefail
PSQL="psql ${ADS_DB:-postgresql://postgres:postgres@localhost:54329/sgb_ads} -v ON_ERROR_STOP=1"
Q="psql ${ADS_DB:-postgresql://postgres:postgres@localhost:54329/sgb_ads} -t -A"
ok=0; ng=0

eq() { # 이름, SQL, 기대
  local a; a=$($Q -c "$2" 2>/dev/null | tr -d '[:space:]')
  if [ "$a" = "$3" ]; then printf "  ok   %s\n" "$1"; ok=$((ok+1))
  else printf "  FAIL %s (기대 %s / 실제 %s)\n" "$1" "$3" "${a:-없음}"; ng=$((ng+1)); fi
}
blocked() { # 이름, 막혀야 하는 SQL
  if $PSQL -c "$2" >/dev/null 2>&1; then printf "  ▲뚫림 %s\n" "$1"; ng=$((ng+1))
  else printf "  ok   %s\n" "$1"; ok=$((ok+1)); fi
}

echo "== 광고 플랫폼 검정 =================================="

# 시험 대상을 만들어 둡니다.
#
# ★ 0행이면 UPDATE 가 아무 행에도 안 걸려 **성공으로 돌아옵니다.**
#   방어가 없어도 "안전" 으로 보고되는 함정입니다.
$PSQL -c "INSERT INTO ad_slots(code,name,placement,spec)
          VALUES ('INFEED','목록 인피드','목록','{\"label\":\"광고\"}'::jsonb)
          ON CONFLICT (code) DO NOTHING;" >/dev/null 2>&1

# 추천과 섞이면 목록 신뢰가 무너집니다.
blocked "AD-01 인피드 표기 없이 불가" \
  "UPDATE ad_slots SET spec='{}'::jsonb WHERE code='INFEED';"
blocked "AD-02 인피드 추천점수 포함 불가" \
  "UPDATE ad_slots SET in_ranking=true WHERE code='INFEED';"

# 휴폐업한 곳의 광고가 계속 나가면 청구도 못 합니다.
eq "AD-03 확인 오래된 광고주 없음" \
  "SELECT count(*) FROM v_stale_verify WHERE live > 0;" "0"
eq "AD-04 본체에 없는 참조 없음" \
  "SELECT count(*) FROM v_orphan_ref;" "0"

# 과금 근거입니다.
#
# ★ 여기도 대상을 먼저 만듭니다 — 0행이면 DELETE 가 트리거를 거치지
#   않고 성공해, 방어가 없어도 "안전" 으로 보고됩니다.
$PSQL -c "
  INSERT INTO advertisers(biz_id,name,verified_at)
    VALUES ('00000000-0000-4000-a000-000000000001','시험',now())
    ON CONFLICT (biz_id) DO NOTHING;
  INSERT INTO ad_creatives(code,slot_code,advertiser,title,status)
    VALUES ('VT-01','INFEED','시험','시험 소재','DRAFT')
    ON CONFLICT (code) DO NOTHING;
  INSERT INTO ad_events(creative_id,slot_code,kind)
    SELECT id,'INFEED','IMPRESSION' FROM ad_creatives WHERE code='VT-01';
" >/dev/null 2>&1

blocked "AD-05 노출 기록 삭제 불가" \
  "DELETE FROM ad_events;"

# 팔았는데 나갈 것이 없으면 환불 문제가 됩니다.
eq "AD-06 판매 공백 없음" \
  "SELECT count(*) FROM v_ad_sellable_gap;" "0"
eq "AD-07 만료 임박 소재 없음" \
  "SELECT count(*) FROM v_ad_expiring;" "0"

# 성향은 본체가 정본입니다 — 여기 복제되면 안 됩니다.
eq "AD-08 성향 표가 없음" \
  "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name ~ 'persona|profile|segment_member';" "0"

echo "======================================================"
echo "안전 $ok · ▲위험 $ng"
[ "$ng" -eq 0 ] || exit 1
