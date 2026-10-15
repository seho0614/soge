#!/usr/bin/env bash
# =====================================================================
# 광고 플랫폼 DB (sgb_ads) — 마이그레이션 · 시드
#
# 광고 SQL 은 CREATE TABLE 에 IF NOT EXISTS 가 없어 두 번 돌리면 깨집니다.
# 그래서 본체와 같은 방식으로 이력(ads_schema_migrations)을 남기고
# 적용된 파일은 건너뜁니다. 적용된 파일이 바뀌면 멈춥니다.
#
# 시드는 처음 한 번만 넣습니다 (광고주명에 "(시드)" 표시).
# =====================================================================
set -uo pipefail
export PGOPTIONS="-c client_min_messages=warning"
DB="${ADS_DB:?ADS_DB 필요}"
P="psql $DB -v ON_ERROR_STOP=1 -q"
Q="psql $DB -t -A -c"
DIR=/ads/prisma/migrations

for i in $(seq 1 60); do $Q "SELECT 1" >/dev/null 2>&1 && break; sleep 1; done

$P -c "CREATE TABLE IF NOT EXISTS ads_schema_migrations (
         name text PRIMARY KEY, checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now())" || exit 1

first=0
[ "$($Q "SELECT count(*) FROM ads_schema_migrations")" = "0" ] && first=1

a=0; s=0
for f in $(ls $DIR/*.sql | sort); do
  name=$(basename "$f" .sql)
  sum=$(sha256sum "$f" | cut -c1-16)
  old=$($Q "SELECT checksum FROM ads_schema_migrations WHERE name='$name'")
  if [ -n "$old" ]; then
    [ "$old" = "$sum" ] || { echo "!! $name 이미 적용된 파일이 변경됨 — 새 파일로 추가하십시오"; exit 1; }
    s=$((s+1)); continue
  fi
  # 파일과 이력을 한 트랜잭션으로 — 중간 실패 시 둘 다 남지 않습니다
  { echo "BEGIN;"; cat "$f"; echo;
    echo "INSERT INTO ads_schema_migrations(name,checksum) VALUES ('$name','$sum');";
    echo "COMMIT;"; } | $P >/dev/null || { echo "!! $name 실패 — 중단"; exit 1; }
  echo "ok $name"; a=$((a+1))
done
echo "광고 적용 $a · 기존 $s"

if [ "$first" = "1" ] || [ "${SGB_RESET:-0}" = "1" ]; then
  $P -f /ads/scripts/seed-realistic.sql >/dev/null && echo "광고 시드 완료"
fi

# ── 개발용 시드 광고주의 확인 시각을 새로 찍습니다 (10/6 · v10.17) ─────────────────────────
# 시드 광고주는 가상의 업체라 본체에 다시 물어볼 곳이 없습니다. 확인 유효 시간(ad_settings.verify_ttl_hours · 24시간)이
# 지나면 AD-03 「확인 오래된 광고주 없음」이 실패로 바뀌어, **설치 다음 날부터** `dev check` · `realcheck` 가
# 코드가 멀쩡한데도 「통합 검정 실패」로 끝났습니다(개발 데이터를 둔 채 3일 뒤 다시 돌려서 찾음).
# 운영에서는 광고 플랫폼이 본체 API 로 사업자를 다시 확인해 이 시각을 새로 찍어야 합니다 — 그 재확인 기능은 광고 플랫폼 서버의 일이고
# 이 킷에는 아직 없습니다(광고 플랫폼은 DB · 규칙 · 검정까지 들어 있습니다). 여기서는 개발용 자료만 다룹니다:
# 이름에 「(시드)」가 붙은 것만 고치고, 직접 만든 광고주 · 정지된 광고주는 건드리지 않습니다. 검정 규칙(AD-03)은 그대로입니다.
n=$($Q "WITH u AS (UPDATE advertisers SET verified_at = now()
                    WHERE name LIKE '%(시드)' AND suspended_at IS NULL
                      AND (verified_at IS NULL OR verified_at < now() - interval '1 hour')
                RETURNING 1) SELECT count(*) FROM u" 2>/dev/null)
[ "${n:-0}" != "0" ] && echo "시드 광고주 확인 시각 갱신 ${n}건"
exit 0
