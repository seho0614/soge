#!/usr/bin/env bash
# =====================================================================
# DB 복원 시험(반자동) — v10.585 (docs/727 · 14차 운영 ①) · 사람이 운영 서버에서 ubuntu 로 실행합니다.
#
#   bash ~/sgb/deploy/aws/restore-drill.sh                     # 읽기만 — 할 일 · 방식(aws · 콘솔) · 셀 표를 보여 줌(기본)
#   bash ~/sgb/deploy/aws/restore-drill.sh --run [스냅샷이름]   # 복원 시험: 운영 행 수 → 스냅샷을 새 DB 로 복원 → 새 DB 행 수 → 견줌 → JSON
#   bash ~/sgb/deploy/aws/restore-drill.sh --compare 원본주소 복원주소   # 행 수 견주기만(리허설 · 개발 서버 tools/restore-drill-rehearse.sh 가 부름)
#
#   방식
#     aws     — aws 명령이 있고 RDS_INSTANCE_ID(운영 DB 인스턴스 이름)가 있으면: 가장 최근 자동 스냅샷(또는 준 이름)을
#               sgb-drill-날짜 로 복원(같은 서브넷 · 보안 그룹 · 외부 접속 끔 · 가장 작은 크기 DRILL_CLASS) · 끝날 때까지 기다림 · 끝나면 yes 받고 지움
#     console — 그 밖: AWS 콘솔에서 사람이 「스냅샷 복원」을 누르고(Enter) · 다 되면 새 DB 주소를 넣음 · 지우기도 사람이
#   견주는 법: 새 DB 는 운영 .env 의 DATABASE_URL 에서 주소(호스트)만 바꿔 붙음(스냅샷은 같은 계정 · 비밀번호를 가짐)
#     표마다 복원 행 수 ≤ 운영 행 수 · 차이 ≤ max(100, 운영 × DRILL_TOL_PCT(5) 퍼센트) 이면 맞음(스냅샷 뒤 늘어난 줄)
#   결과: 화면 끝 「붙여 넣을 결과」 JSON → 운영 화면 관 관리 › 업무 안내 › 「스크립트 결과 붙여 넣기」(SUPER) · 파일 ~/sgb-data/logs/restore_drill_*.json
#
#   ★ 운영 DB 는 읽기만(행 수 세기) · 복원 DB 주소가 운영 DB 주소와 같으면 멈춤 · 지우는 것은 이름이 sgb-drill- 로 시작하는 인스턴스만
#   ★ 행 수만 셉니다 — 회원 · 내용은 화면 · 파일 어디에도 찍지 않습니다
#   종료 코드: 0 맞음 · 1 다름 · 접속 실패 · 2 쓰는 법 · 멈춤
#
#   RDS_INSTANCE_ID  운영 DB 인스턴스 이름(.env 또는 환경 · 없으면 콘솔 방식)   DRILL_CLASS  복원 DB 크기(기본 db.t4g.micro)
#   DRILL_TOL_PCT    행 수 차이 한도 퍼센트(기본 5 · 서버도 ops2.drill_tol_pct 로 다시 셈)   DRILL_YES=1  물음 건너뜀(리허설 전용)
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
VER="$(cat "$HERE/../../VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
TOOL="restore-drill.sh ${VER:-v?}"
TABLES=(accounts listings deals hlt_orders terms site_settings ops_alerts audit.audit_logs schema_migrations)
TOL="${DRILL_TOL_PCT:-5}"
case "$TOL" in ''|*[!0-9]*) TOL=5 ;; esac
[ "$TOL" -le 50 ] || TOL=50
DRILL_CLASS="${DRILL_CLASS:-db.t4g.micro}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
MODE="${1:-plan}"

usage() { echo "사용: restore-drill.sh [--run [스냅샷이름] | --compare 원본주소 복원주소]"; exit 2; }

# 표마다 행 수 「이름=수」 줄 — 없는 표는 빼고(견줄 때 한쪽에만 있으면 다름) · 동적 SQL 대신 query_to_xml(읽기만)
count_sql() {
  local arr="" t
  for t in "${TABLES[@]}"; do arr+="${arr:+,}'$t'"; done
  printf "select t || '=' || coalesce((xpath('/row/c/text()', query_to_xml('select count(*) as c from ' || t, false, true, '')))[1]::text, '-1') from unnest(array[%s]) t where to_regclass(t) is not null order by t" "$arr"
}
counts() { PGOPTIONS='-c default_transaction_read_only=on' psql "$(psql_url "$1")" -X -t -A -v ON_ERROR_STOP=1 -c "$(count_sql)" 2>/dev/null | tr -d '\r' | grep -E '^[a-z_.]+=[0-9-]+$'; }

# 주소의 호스트 · 호스트 바꾸기(계정 · 비밀번호 · 포트 · 물음표 뒤는 그대로) — 값은 화면에 찍지 않음
host_of() { python3 -I -c 'import sys, urllib.parse as u; print(u.urlsplit(sys.argv[1]).hostname or "")' "$1"; }
swap_host() {
  python3 -I -c '
import sys, urllib.parse as u
p = u.urlsplit(sys.argv[1]); h = sys.argv[2]
auth, _, hp = p.netloc.rpartition("@")
port = ":" + str(p.port) if p.port else ""
print(u.urlunsplit((p.scheme, (auth + "@" if auth else "") + h + port, p.path, p.query, p.fragment)))' "$1" "$2"
}

# 견줌 — $1 운영 줄 · $2 복원 줄 → 화면 표 · ROWS_OK(1/0) · TABLES_JSON
ROWS_OK=0; TABLES_JSON="[]"
compare() {
  local out
  out=$(python3 -I - "$1" "$2" "$TOL" <<'PY'
import json, sys
def parse(s):
    d = {}
    for line in s.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            try: d[k] = int(v)
            except ValueError: pass
    return d
src, drl, tol = parse(sys.argv[1]), parse(sys.argv[2]), int(sys.argv[3])
rows, allok = [], bool(src) and bool(drl)
for name in sorted(set(src) | set(drl)):
    s, d = src.get(name, -1), drl.get(name, -1)
    ok = s >= 0 and d >= 0 and d <= s and s - d <= max(100, s * tol // 100)
    allok = allok and ok
    rows.append({"name": name, "src": max(s, 0), "drill": max(d, 0)})
    print("ROW\t%-20s 운영 %12s · 복원 %12s · 차이 %8s  %s" % (name, s if s >= 0 else "없음", d if d >= 0 else "없음", (s - d) if s >= 0 and d >= 0 else "-", "맞음" if ok else "다름"))
print("OK\t" + ("1" if allok else "0"))
print("JSON\t" + json.dumps(rows, ensure_ascii=False))
PY
)
  while IFS=$'\t' read -r k v; do
    case "$k" in ROW) info "$v" ;; OK) ROWS_OK="$v" ;; JSON) TABLES_JSON="$v" ;; esac
  done <<< "$out"
}

# 결과 JSON(서버 Ops2DrillResultDto 모양) — 화면 끝 · 파일
emit() {   # $1 mode $2 snapshot $3 minutes $4 ok(1/0) $5 note
  local f j
  j=$(python3 -I - "$TOOL" "$1" "$(TZ=Asia/Seoul date +%F)" "$2" "$3" "$ROWS_OK" "$4" "$5" "$TABLES_JSON" <<'PY'
import json, sys
tool, mode, day, snap, mins, rows_ok, ok, note, tables = sys.argv[1:10]
print(json.dumps({"tool": tool, "mode": mode, "drillDate": day, "snapshot": snap, "minutes": max(1, min(1440, int(mins))),
                  "rowsMatch": rows_ok == "1", "ok": ok == "1", "note": note[:500], "tables": json.loads(tables)}, ensure_ascii=False))
PY
)
  mkdir -p "$DATA_DIR/logs" 2>/dev/null
  f="$DATA_DIR/logs/restore_drill_$(date +%Y%m%d_%H%M%S).json"
  printf '%s\n' "$j" > "$f" 2>/dev/null || f="(파일에 쓰지 못함)"
  say ""; say "=== 붙여 넣을 결과 (운영 화면 관 관리 › 업무 안내 › 「스크립트 결과 붙여 넣기」) ==="
  say "$j"
  say "=== 끝 · 파일 $f ==="
}

ask() {   # $1 물음 → yes 면 0
  [ "${DRILL_YES:-0}" = 1 ] && return 0
  local a; read -r -p "$1 (yes 를 입력하면 진행): " a; [ "$a" = yes ]
}

# ── 견주기만(리허설) ──────────────────────────────────────────────
if [ "$MODE" = --compare ]; then
  [ $# -eq 3 ] || usage
  [ "$(host_of "$2")|$(echo "$2" | sed 's/.*\///')" != "$(host_of "$3")|$(echo "$3" | sed 's/.*\///')" ] || { echo "원본과 복원 주소가 같습니다 — 멈춤"; exit 2; }
  say "DB 복원 시험 — 견주기만(리허설 · $TOOL · 한도 ${TOL}퍼센트)"
  S1=$(counts "$2"); S2=$(counts "$3")
  [ -n "$S1" ] || { say "  실패  원본에 붙지 못함"; exit 1; }
  [ -n "$S2" ] || { say "  실패  복원 DB 에 붙지 못함"; exit 1; }
  compare "$S1" "$S2"
  emit compare "compare-$(date +%Y%m%d)" 1 "$ROWS_OK" "리허설(compare) — 운영 복원 시험이 아님(서버가 받지 않음)"
  [ "$ROWS_OK" = 1 ] && { say "결과: 맞음"; exit 0; } || { say "결과: 다름"; exit 1; }
fi

case "$MODE" in plan|--plan|--run) ;; *) usage ;; esac
load_env "$HERE/../../.env" || { echo "!! .env 가 없습니다 — 운영 앱 폴더(~/sgb)의 스크립트로 돌리십시오" >&2; exit 2; }
[ -n "${DATABASE_URL:-}" ] || { echo "!! .env 에 DATABASE_URL 이 없습니다" >&2; exit 2; }
SRC_HOST="$(host_of "$DATABASE_URL")"
AWSOK=0; command -v aws >/dev/null 2>&1 && [ -n "${RDS_INSTANCE_ID:-}" ] && AWSOK=1
mkdir -p "$DATA_DIR/logs"; OUT="$DATA_DIR/logs/restore_drill_$(date +%Y%m%d_%H%M%S).txt"; : > "$OUT"

say "DB 복원 시험 — $([ "$MODE" = --run ] && echo '실행' || echo '읽기만') ($(date '+%Y-%m-%d %H:%M:%S %Z') · $TOOL)"
say "  방식: $([ "$AWSOK" = 1 ] && echo "aws(인스턴스 $RDS_INSTANCE_ID · 복원 크기 $DRILL_CLASS)" || echo 'console(aws 명령 또는 RDS_INSTANCE_ID 없음 — 콘솔에서 사람이 복원)')"
say "  셀 표: ${TABLES[*]} · 한도 ${TOL}퍼센트(또는 100줄)"
if [ "$MODE" != --run ]; then
  say ""
  say "  순서: ① 운영 행 수(읽기만) ② 스냅샷 → 새 DB sgb-drill-$(date +%Y%m%d) ③ 새 DB 행 수 · 걸린 분 ④ 견줌 · JSON ⑤ 새 DB 지우기"
  say "  실행: bash $HERE/restore-drill.sh --run [스냅샷이름]"
  say "기록: $OUT"; exit 0
fi

# ① 운영 행 수
say ""; say "[1] 운영 DB 행 수(읽기만)"
S1=$(counts "$DATABASE_URL")
[ -n "$S1" ] || { bad "운영 DB" "붙지 못함 — .env DATABASE_URL 확인"; exit 1; }
ok "운영 DB" "$(echo "$S1" | wc -l)개 표"

# ② 복원
DRILL_ID="sgb-drill-$(date +%Y%m%d)"
SNAP="${2:-}"; EP=""; RESTORED=0; DELETED=0
remind() { [ "$RESTORED" = 1 ] && [ "$DELETED" = 0 ] && say "[주의] 새 DB($DRILL_ID)가 남아 있습니다 — 지우지 않으면 요금이 나갑니다(콘솔 › RDS › 삭제 · 마지막 스냅샷 만들지 않음)."; }
trap remind EXIT
say ""; say "[2] 스냅샷 → 새 DB"
if [ "$AWSOK" = 1 ]; then
  read -r SUBNET SGS SRC_EP <<< "$(aws rds describe-db-instances --db-instance-identifier "$RDS_INSTANCE_ID" \
      --query 'DBInstances[0].[DBSubnetGroup.DBSubnetGroupName, join(`,`, VpcSecurityGroups[].VpcSecurityGroupId), Endpoint.Address]' --output text 2>/dev/null)"
  [ -n "${SUBNET:-}" ] || { bad "운영 인스턴스" "describe 실패 — RDS_INSTANCE_ID · 권한 확인"; exit 1; }
  [ -n "$SNAP" ] || SNAP=$(aws rds describe-db-snapshots --db-instance-identifier "$RDS_INSTANCE_ID" --snapshot-type automated \
      --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].DBSnapshotIdentifier' --output text 2>/dev/null)
  [[ "$SNAP" =~ ^[A-Za-z0-9][A-Za-z0-9:._-]{1,99}$ ]] || { bad "스냅샷" "찾지 못함($SNAP)"; exit 1; }
  info "스냅샷 $SNAP → $DRILL_ID (서브넷 $SUBNET · 보안 그룹 $SGS · 외부 접속 끔)"
  ask "새 DB $DRILL_ID 를 만듭니다(요금 발생 · 끝나면 지움)" || { say "멈춤"; exit 2; }
  T0=$(date +%s)
  aws rds restore-db-instance-from-db-snapshot --db-instance-identifier "$DRILL_ID" --db-snapshot-identifier "$SNAP" \
    --db-instance-class "$DRILL_CLASS" --db-subnet-group-name "$SUBNET" --vpc-security-group-ids ${SGS//,/ } \
    --no-publicly-accessible --no-multi-az --tags Key=purpose,Value=restore-drill >/dev/null || { bad "복원 시작" "aws 오류"; exit 1; }
  RESTORED=1
  for _ in 1 2 3; do aws rds wait db-instance-available --db-instance-identifier "$DRILL_ID" 2>/dev/null && break; done
  T1=$(date +%s)
  EP=$(aws rds describe-db-instances --db-instance-identifier "$DRILL_ID" --query 'DBInstances[0].Endpoint.Address' --output text 2>/dev/null)
  MODE_OUT=aws
else
  info "AWS 콘솔 › RDS › 스냅샷 › 가장 최근 자동 스냅샷 › 「스냅샷 복원」 — 이름 $DRILL_ID · 가장 작은 크기 · 퍼블릭 액세스 아니요 · 운영과 같은 VPC · 보안 그룹"
  [ -n "$SNAP" ] || read -r -p "  복원할 스냅샷 이름(예: rds:sgb-db-2026-11-21-03-10): " SNAP
  [[ "$SNAP" =~ ^[A-Za-z0-9][A-Za-z0-9:._-]{1,99}$ ]] || { bad "스냅샷 이름" "영문 · 숫자 · - · : · . · _ 2 ~ 100자"; exit 2; }
  read -r -p "  콘솔에서 「DB 인스턴스 복원」을 누른 바로 뒤 Enter: " _
  T0=$(date +%s); RESTORED=1
  read -r -p "  새 DB 가 「사용 가능」이 되면 엔드포인트 주소를 넣으십시오: " EP
  T1=$(date +%s)
  MODE_OUT=console
fi
[[ "${EP:-}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{3,250}$ ]] || { bad "새 DB 주소" "읽지 못함(${EP:-없음})"; exit 1; }
[ "$EP" != "$SRC_HOST" ] && [ "$EP" != "${SRC_EP:-}" ] || { bad "새 DB 주소" "운영 DB 와 같습니다 — 멈춤(운영 DB 를 시험 대상으로 쓰지 않음)"; exit 2; }
MIN=$(( (T1 - T0 + 59) / 60 )); [ "$MIN" -ge 1 ] || MIN=1
ok "복원" "$SNAP → $EP · ${MIN}분"

# ③ 새 DB 행 수(주소가 퍼지기까지 몇 번 다시)
say ""; say "[3] 새 DB 행 수"
DRILL_URL=$(swap_host "$DATABASE_URL" "$EP")
S2=""; for _ in 1 2 3 4 5 6; do S2=$(counts "$DRILL_URL"); [ -n "$S2" ] && break; sleep 20; done
if [ -z "$S2" ]; then bad "새 DB" "붙지 못함 — 보안 그룹 · 주소 확인"; else ok "새 DB" "$(echo "$S2" | wc -l)개 표"; fi

# ④ 견줌 · JSON
say ""; say "[4] 견줌(한도 ${TOL}퍼센트 또는 100줄)"
compare "$S1" "$S2"
OKV=0; [ -n "$S2" ] && [ "$ROWS_OK" = 1 ] && OKV=1
emit "$MODE_OUT" "$SNAP" "$MIN" "$OKV" "$([ "$MODE_OUT" = aws ] && echo "aws 방식 · $DRILL_CLASS" || echo '콘솔 방식')$([ -n "$S2" ] || echo ' · 새 DB 에 붙지 못함')"

# ⑤ 지우기
say ""; say "[5] 새 DB 지우기"
if [ "$MODE_OUT" = aws ]; then
  case "$DRILL_ID" in sgb-drill-*) ;; *) bad "지우기" "이름이 sgb-drill- 이 아님 — 지우지 않음"; exit 2 ;; esac
  if ask "새 DB $DRILL_ID 를 지웁니다(마지막 스냅샷 없음)"; then
    aws rds delete-db-instance --db-instance-identifier "$DRILL_ID" --skip-final-snapshot --delete-automated-backups >/dev/null && { DELETED=1; ok "지움 요청" "$DRILL_ID"; } || bad "지우기" "aws 오류 — 콘솔에서 지우십시오"
  fi
else
  info "콘솔 › RDS › $DRILL_ID › 작업 › 삭제(최종 스냅샷 만들지 않음 · 자동 백업 지움) — 지운 뒤 Enter"
  read -r -p "  지웠으면 Enter: " _ && DELETED=1
fi
say "기록: $OUT"
[ "$OKV" = 1 ] && exit 0 || exit 1
