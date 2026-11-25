#!/usr/bin/env bash
# =====================================================================
# e2.4 (docs/009) 소개뱅크 → sgb_erp 자료 복사 · 대조
#
#   점검판:  bash tools/erp-copy.sh board [--force]
#   운영(E8 · 사람 · 스냅샷 뒤): ADMIN_SRC_URL=… ADMIN_ERP_URL=… SRC_HOST=… SRC_DB=sgb ERP_RO_PASSWORD=… bash tools/erp-copy.sh apply
#
#   ① erp_ro 에 ERP 표(E004 의 표 목록) SELECT 를 잠시 줌 → sgb_erp 에 이름 묶음 src_copy 로 외부 표 가져옴
#   ② 한 트랜잭션: 이미 복사했으면 멈춤(erp.copy_done_at · 점검판만 --force) → ERP 표 비움 → 같은 칸 이름끼리 INSERT
#      (트리거는 건너뜀 session_replication_role = replica — 쌓기만 · 해시 사슬을 다시 계산하지 않게 · RDS 마스터 사용자 확인 필요)
#      → 순번(sequence)을 가장 큰 값으로 → 대조(표마다 줄 수 · 금액 칸 합) 하나라도 다르면 되돌림
#   ③ src_copy 지움 · erp_ro 의 ERP 표 SELECT 거둠 · 대조표를 docs 밖 결과 파일로(~/check-results 또는 ~/sgb-data/logs)
#   소개뱅크 표는 읽기만(지우지 않음 · E7 에서 읽기 전용 표시 · 지우기는 적용 뒤 2 ~ 4주 따로 승인)
# =====================================================================
set -uo pipefail
MODE="${1:-}"; FORCE="${2:-}"; HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/.."
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
case "$MODE" in board|apply) ;; *) echo "쓰는 법: bash tools/erp-copy.sh board [--force] | apply"; exit 2 ;; esac
E004="$ROOT/prisma/migrations/E004_core_tables/migration.sql"
[ -f "$E004" ] || { echo "[중단] E004 가 없음 — tools/gen-erp-schema.py 먼저"; exit 2; }
TABLES=$(grep -oE '^CREATE TABLE public\.[a-z_][a-z0-9_]*' "$E004" | sed 's/^CREATE TABLE public\.//' | sort -u)
N=$(echo "$TABLES" | wc -l); IN=$(echo "$TABLES" | paste -sd, -)

if [ "$MODE" = board ]; then
  docker inspect sgb-db >/dev/null 2>&1 || { echo "[중단] 점검판 DB(sgb-db)가 없음"; exit 2; }
  SRC(){ docker exec -i sgb-db psql -U sgb -d sgb -v ON_ERROR_STOP=1 -q "$@"; }
  ERP(){ docker exec -i sgb-db psql -U sgb -d "${ERP_DBNAME:-sgb_erp}" -v ON_ERROR_STOP=1 -q "$@"; }
  OUTD="$HOME/check-results"; ALLOW_FORCE=1
else
  : "${ADMIN_SRC_URL:?}" "${ADMIN_ERP_URL:?}"
  SRC(){ psql "$ADMIN_SRC_URL" -v ON_ERROR_STOP=1 -q "$@"; }
  ERP(){ psql "$ADMIN_ERP_URL" -v ON_ERROR_STOP=1 -q "$@"; }
  OUTD="$HOME/sgb-data/logs"; ALLOW_FORCE=0
fi
[ "$FORCE" = --force ] && [ "$ALLOW_FORCE" = 0 ] && { echo "[중단] 운영에서는 --force 를 쓰지 않습니다"; exit 2; }
ERP -At -c "SELECT 1 FROM pg_foreign_server WHERE srvname = 'sgb_src'" | grep -q 1 || { echo "[중단] svc 서버가 없음 — tools/erp-svc.sh 먼저"; exit 2; }
mkdir -p "$OUTD"; OUT="$OUTD/erp-copy_$(date +%Y%m%d_%H%M%S).tsv"
echo "== ERP 자료 복사 $MODE · 표 $N개"

# ① 잠시 읽기 권한 · src_copy
SRC -c "$(echo "$TABLES" | sed 's/.*/GRANT SELECT ON public.& TO erp_ro;/')" || { echo "[중단] ① 권한"; exit 1; }
cleanup(){ ERP -c "DROP SCHEMA IF EXISTS src_copy CASCADE" >/dev/null 2>&1
           SRC -c "$(echo "$TABLES" | sed 's/.*/REVOKE SELECT ON public.& FROM erp_ro;/')" >/dev/null 2>&1
           echo "  ③ src_copy 지움 · erp_ro ERP 표 권한 거둠"; }
trap cleanup EXIT
ERP <<SQL || { echo "[중단] ① src_copy"; exit 1; }
DROP SCHEMA IF EXISTS src_copy CASCADE;
CREATE SCHEMA src_copy;
IMPORT FOREIGN SCHEMA public LIMIT TO ($IN) FROM SERVER sgb_src INTO src_copy;
SQL

# ② 한 트랜잭션 — 복사 · 순번 · 대조
ERP -At -F $'\t' <<SQL > "$OUT.raw" 2>&1
BEGIN;
SET LOCAL session_replication_role = replica;
DO \$\$
DECLARE t text; cols text; amt text; s_n bigint; d_n bigint; s_a numeric; d_a numeric; bad int := 0; seq record;
BEGIN
  IF EXISTS (SELECT 1 FROM erp_settings WHERE key = 'erp.copy_done_at' AND value IS NOT NULL) AND '$FORCE' <> '--force' THEN
    RAISE EXCEPTION USING MESSAGE = 'ERP_COPY_DONE: 이미 복사했습니다(erp.copy_done_at) — 다시 하려면 스냅샷으로 되돌린 뒤';
  END IF;
  CREATE TEMP TABLE _cmp (tbl text, src_rows bigint, erp_rows bigint, amount_col text, src_sum numeric, erp_sum numeric, ok boolean) ON COMMIT DROP;
  EXECUTE 'TRUNCATE ' || (SELECT string_agg(format('public.%I', x), ', ') FROM unnest(string_to_array('$IN', ',')) x);
  FOREACH t IN ARRAY string_to_array('$IN', ',') LOOP
    SELECT string_agg(format('%I', d.column_name), ', ' ORDER BY d.ordinal_position) INTO cols
      FROM information_schema.columns d
      JOIN information_schema.columns s ON s.table_schema = 'src_copy' AND s.table_name = t AND s.column_name = d.column_name
     WHERE d.table_schema = 'public' AND d.table_name = t AND d.is_generated = 'NEVER';
    EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM src_copy.%I', t, cols, cols, t);
    SELECT column_name INTO amt FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND data_type IN ('numeric', 'bigint', 'integer')
       AND column_name ~ '(amount|total|sum|price|krw|pay|tax)' ORDER BY ordinal_position LIMIT 1;
    EXECUTE format('SELECT count(*) FROM src_copy.%I', t) INTO s_n;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO d_n;
    IF amt IS NOT NULL THEN
      EXECUTE format('SELECT coalesce(sum(%I), 0) FROM src_copy.%I', amt, t) INTO s_a;
      EXECUTE format('SELECT coalesce(sum(%I), 0) FROM public.%I', amt, t) INTO d_a;
    ELSE s_a := NULL; d_a := NULL; END IF;
    INSERT INTO _cmp VALUES (t, s_n, d_n, amt, s_a, d_a, s_n = d_n AND s_a IS NOT DISTINCT FROM d_a);
    IF NOT (s_n = d_n AND s_a IS NOT DISTINCT FROM d_a) THEN bad := bad + 1; END IF;
  END LOOP;
  FOR seq IN
    SELECT c.relname AS tbl, a.attname AS col, pg_get_serial_sequence(format('public.%I', c.relname), a.attname) AS s
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relname = ANY (string_to_array('$IN', ','))
       AND pg_get_serial_sequence(format('public.%I', c.relname), a.attname) IS NOT NULL
  LOOP
    EXECUTE format('SELECT setval(%L, greatest(coalesce((SELECT max(%I) FROM public.%I), 0), 1), (SELECT count(*) > 0 FROM public.%I))',
                   seq.s, seq.col, seq.tbl, seq.tbl);
  END LOOP;
  IF bad > 0 THEN
    RAISE EXCEPTION USING MESSAGE = format('ERP_COPY_MISMATCH: 대조가 다른 표 %s개 — 되돌렸습니다', bad);
  END IF;
  /* e3.5 (E009) 회계 설정의 운영 값 — 소개뱅크 site_settings 에 저장된 값으로(꼴 검사는 erp_settings 트리거) · 인사 · 사무는 E4 에서 넓힘 */
  UPDATE erp_settings e SET value = s.value FROM svc.site_settings s WHERE s.key = e.key AND e.key LIKE 'acct.%' AND s.value IS DISTINCT FROM e.value;
  INSERT INTO erp_settings (key, value, scope, description) VALUES ('erp.copy_done_at', now()::text, 'SUPER',
    '소개뱅크 → ERP 자료 복사한 시각(e2.4 · tools/erp-copy.sh) — 있으면 다시 복사하지 않음(스냅샷으로 되돌린 뒤에만)')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  CREATE TEMP TABLE _cmp_keep ON COMMIT PRESERVE ROWS AS SELECT * FROM _cmp;
END \$\$;
COMMIT;
SELECT 'ROW', tbl, src_rows, erp_rows, coalesce(amount_col, '-'), coalesce(src_sum::text, '-'), coalesce(erp_sum::text, '-'), ok FROM _cmp_keep ORDER BY tbl;
SQL
RC=$?
grep '^ROW' "$OUT.raw" | cut -f2- | sed '1i table\tsrc_rows\terp_rows\tamount_col\tsrc_sum\terp_sum\tok' > "$OUT"
ROWS=$(tail -n +2 "$OUT" | wc -l); BAD=$(tail -n +2 "$OUT" | awk -F'\t' '$7 != "t"' | wc -l)
TOT=$(tail -n +2 "$OUT" | awk -F'\t' '{s+=$3} END {print s+0}')
if [ $RC != 0 ] || [ "$ROWS" != "$N" ] || [ "$BAD" != 0 ]; then
  echo "  실패  $(grep -oE 'ERP_COPY_[A-Z]+:[^\"]*' "$OUT.raw" | head -1)"; tail -3 "$OUT.raw" | sed 's/^/    /'
  echo "== 복사 실패(되돌림) · 대조표 $OUT"; exit 1
fi
rm -f "$OUT.raw"
echo "  ② 복사 · 대조 — 표 $ROWS / $N · 줄 $TOT · 다른 표 0"
echo "== 복사 통과 · 대조표 $OUT"
