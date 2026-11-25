#!/usr/bin/env bash
# =====================================================================
# e2.2 (docs/007) svc 외부 표 — sgb_erp 에서 소개뱅크 표를 postgres_fdw 로 **읽기만**
#
#   점검판:  bash tools/erp-svc.sh board          점검판 DB 컨테이너(sgb-db) 안 sgb → sgb_erp · 암호는 그때 만듦(파일에 남기지 않음)
#   운영(E8 · 사람): SRC_HOST=… SRC_DB=sgb ERP_RO_PASSWORD=… ADMIN_SRC_URL=… ADMIN_ERP_URL=… bash tools/erp-svc.sh apply
#
#   ① 소개뱅크 DB: 읽기 전용 사용자 erp_ro(LOGIN · CONNECT · USAGE · 표마다 SELECT 만)
#   ② sgb_erp: 확장 postgres_fdw · 서버 sgb_src(updatable 'false') · 사용자 연결(erp_ro) · 이름 묶음 svc · IMPORT FOREIGN SCHEMA LIMIT TO(표 목록)
#   ③ 확인: svc.accounts 셈 · svc 표에 INSERT 가 막힘
#   표 목록 = tools/svc-tables.txt + docs/e2-svc-refs.tsv · docs/e2-fk-dropped.tsv 의 소개뱅크 표(겹침 없이)
#   다시 돌려도 됨(있으면 건너뜀 · svc 는 지우고 다시 가져옴) · 암호는 환경 변수로만 받고 출력하지 않음
# =====================================================================
set -uo pipefail
MODE="${1:-}"; HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/.."
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
case "$MODE" in board|apply) ;; *) echo "쓰는 법: bash tools/erp-svc.sh board|apply"; exit 2 ;; esac

LIST=$( { grep -v '^#' "$HERE/svc-tables.txt"; tail -n +2 "$ROOT/docs/e2-svc-refs.tsv" 2>/dev/null | cut -f3; tail -n +2 "$ROOT/docs/e2-fk-dropped.tsv" 2>/dev/null | cut -f4; } \
        | grep -E '^[a-z_][a-z0-9_]*$' | sort -u)
N=$(echo "$LIST" | wc -l); IN=$(echo "$LIST" | paste -sd, -)
GRANTS=$(echo "$LIST" | sed 's/.*/GRANT SELECT ON public.& TO erp_ro;/')

if [ "$MODE" = board ]; then
  docker inspect sgb-db >/dev/null 2>&1 || { echo "[중단] 점검판 DB(sgb-db)가 없음"; exit 2; }
  PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  SRC(){ docker exec -i sgb-db psql -U sgb -d sgb -v ON_ERROR_STOP=1 -q "$@"; }
  ERP(){ docker exec -i sgb-db psql -U sgb -d "${ERP_DBNAME:-sgb_erp}" -v ON_ERROR_STOP=1 -q "$@"; }
  HOST=localhost; PORT=5432; DB=sgb
else
  : "${SRC_HOST:?}" "${SRC_DB:?}" "${ERP_RO_PASSWORD:?}" "${ADMIN_SRC_URL:?}" "${ADMIN_ERP_URL:?}"
  PW="$ERP_RO_PASSWORD"; HOST="$SRC_HOST"; PORT="${SRC_PORT:-5432}"; DB="$SRC_DB"
  SRC(){ psql "$ADMIN_SRC_URL" -v ON_ERROR_STOP=1 -q "$@"; }
  ERP(){ psql "$ADMIN_ERP_URL" -v ON_ERROR_STOP=1 -q "$@"; }
fi

echo "== svc 외부 표 $MODE · 표 $N개 · 소개뱅크 $DB@$HOST:$PORT"
SRC <<SQL || { echo "[중단] ① erp_ro 실패"; exit 1; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_ro') THEN
    EXECUTE format('CREATE ROLE erp_ro LOGIN PASSWORD %L', '$PW');
  ELSE
    EXECUTE format('ALTER ROLE erp_ro LOGIN PASSWORD %L', '$PW');
  END IF;
END \$\$;
GRANT CONNECT ON DATABASE $DB TO erp_ro;
GRANT USAGE ON SCHEMA public TO erp_ro;
$GRANTS
SQL
echo "  ① erp_ro — 표 $N개 SELECT 만"
ERP <<SQL || { echo "[중단] ② svc 실패"; exit 1; }
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'sgb_src') THEN
    EXECUTE format('CREATE SERVER sgb_src FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host %L, port %L, dbname %L, updatable %L)', '$HOST', '$PORT', '$DB', 'false');
  ELSE
    EXECUTE format('ALTER SERVER sgb_src OPTIONS (SET host %L, SET port %L, SET dbname %L)', '$HOST', '$PORT', '$DB');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_user_mappings WHERE srvname = 'sgb_src' AND usename = 'public') THEN
    EXECUTE 'DROP USER MAPPING FOR PUBLIC SERVER sgb_src';
  END IF;
  EXECUTE format('CREATE USER MAPPING FOR PUBLIC SERVER sgb_src OPTIONS (user %L, password %L)', 'erp_ro', '$PW');
END \$\$;
DROP SCHEMA IF EXISTS svc CASCADE;
CREATE SCHEMA svc;
IMPORT FOREIGN SCHEMA public LIMIT TO ($IN) FROM SERVER sgb_src INTO svc;
SQL
# e2.3 svc 를 읽는 조회 — svc 를 지우고 다시 가져오면 함께 지워지므로 여기서 다시 만듦
[ -f "$ROOT/prisma/svc-views.sql" ] && { ERP < "$ROOT/prisma/svc-views.sql" || { echo "[중단] svc 조회 실패"; exit 1; }; echo "  ②-1 svc 조회 $(grep -c '^CREATE OR REPLACE VIEW' "$ROOT/prisma/svc-views.sql")개"; }
G=$(ERP -At -c "SELECT count(*) FROM information_schema.foreign_tables WHERE foreign_table_schema = 'svc'")
A=$(ERP -At -c "SELECT count(*) FROM svc.accounts" 2>&1 | tail -1)
W=$(ERP -At -c "INSERT INTO svc.public_holidays SELECT * FROM svc.public_holidays LIMIT 0" 2>&1 | tail -1)
echo "  ② svc 외부 표 $G / $N · svc.accounts $A줄"
FAIL=0
[ "$G" = "$N" ] || { echo "  실패  가져온 표 수가 다름"; FAIL=1; }
[[ "$A" =~ ^[0-9]+$ ]] || { echo "  실패  svc.accounts 읽기 — $A"; FAIL=1; }
echo "$W" | grep -qiE 'not allow|updatable|permission' && echo "  ③ svc 쓰기 막힘" || { echo "  실패  svc 쓰기가 막히지 않음 — $W"; FAIL=1; }
echo "== svc $( [ $FAIL = 0 ] && echo 통과 || echo 실패 )"; exit $FAIL
