#!/usr/bin/env bash
# =====================================================================
# AWS 적용 스크립트 공용 함수 — precheck · apply · postcheck · rollback · run-*.sh 가 함께 씁니다.
# (직접 실행하는 파일이 아닙니다)
# =====================================================================

# .env 읽기 — KEY=VALUE 줄만 읽어 환경 값으로 올립니다. **파일 값이 이깁니다**(pm2 가 기억한 옛 값을 덮습니다).
#   `source .env` 를 쓰지 않는 이유: 접속 주소에 & 가 들어가면(…?sslmode=require&uselibpqcompat=true) 셸이 줄을 잘라 버립니다.
#   scripts/load-env.js 와 같은 규칙입니다 — # 으로 시작하는 줄은 건너뛰고, 값을 감싼 따옴표는 벗깁니다.
load_env() {
  local f="$1" line k v
  [ -f "$f" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|\#*) continue ;; esac
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    k="${BASH_REMATCH[2]}"; v="${BASH_REMATCH[3]}"
    v="${v%"${v##*[![:space:]]}"}"                      # 뒤 공백 제거
    if [[ "$v" =~ ^\"(.*)\"$ ]] || [[ "$v" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
    export "$k=$v"
  done < "$f"
  return 0
}

# .env 에 그 키가 **값과 함께** 있는가 (값은 보여 주지 않습니다)
env_has() { grep -Eq "^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=[[:space:]]*[^[:space:]]" "$1" 2>/dev/null; }

# 결과 기록 — 화면과 파일($OUT)에 함께 남깁니다. PASS · FAIL · WARN 을 셉니다.
PASS=0; FAIL=0; WARN=0
say()  { if [ -n "${OUT:-}" ]; then echo "$*" | tee -a "$OUT"; else echo "$*"; fi; }
ok()   { PASS=$((PASS+1)); say "  통과  $1${2:+ — $2}"; }
bad()  { FAIL=$((FAIL+1)); say "  실패  $1${2:+ — $2}"; }
warn() { WARN=$((WARN+1)); say "  확인  $1${2:+ — $2}"; }
info() { say "        $1"; }
chk()  { if [ "$1" = "0" ]; then ok "$2" "${3:-}"; else bad "$2" "${3:-}"; fi; }

# psql 용 접속 주소 — 앱(Node 드라이버)만 아는 표기를 psql(libpq)이 아는 표기로 바꿉니다.
#   RDS 는 SSL 을 요구하는데, 두 도구가 알아듣는 말이 다릅니다(킷 작업 환경에서 SSL 켠 PostgreSQL 로 확인).
#     sslmode=no-verify            앱 OK  · psql 「invalid sslmode value」      → psql 에는 require 로
#     uselibpqcompat=true&…        앱 OK  · psql 「invalid URI query parameter」 → psql 에는 그 항목을 뺌
#     sslmode=require              psql OK · 앱은 인증서까지 대조(인증서 묶음이 없으면 실패) — 그대로 둠
#     sslmode=verify-full&sslrootcert=파일   둘 다 OK — 그대로 둠
psql_url() { printf '%s' "$1" | sed -E 's/([?&])uselibpqcompat=[^&]*(&|$)/\1/; s/sslmode=no-verify/sslmode=require/; s/[?&]$//'; }
db() { psql "$(psql_url "$DATABASE_URL")" -X "$@"; }

# DB 한 값 (실패하면 빈 값)
q() { db -t -A -c "$1" 2>/dev/null | head -1 | tr -d '\r'; }
qn() { db -t -A -c "$1" 2>/dev/null | tr -d '\r'; }

# 마이그레이션 현황 — psql 만으로 봅니다(새 킷에는 설치 전이라 node_modules 가 없습니다).
#   scripts/migrate.js 와 같은 규칙: 파일 sha256 의 앞 16자를 schema_migrations.checksum 과 비교.
#   줄마다 「적용됨 이름」 · 「올릴것 이름」 · 「바뀜 이름」
mig_status() {
  local dir="$1" name sum f
  declare -A have=()
  while IFS='|' read -r name sum; do [ -n "$name" ] && have["$name"]="$sum"; done \
    < <(db -t -A -c "select name, checksum from schema_migrations" 2>/dev/null | tr -d '\r')
  for name in $(ls "$dir" | LC_ALL=C sort); do
    f="$dir/$name/migration.sql"; [ -f "$f" ] || continue
    sum=$(sha256sum "$f" | cut -c1-16)
    if [ -z "${have[$name]+x}" ]; then echo "올릴것 $name"
    elif [ "${have[$name]}" != "$sum" ]; then echo "바뀜 $name"
    else echo "적용됨 $name"; fi
  done
}

# 주소가 그 코드로 답하는가 — 이름 · 주소 · 기대 코드 (· 추가 curl 인자)
http_is() {
  local name="$1" url="$2" want="$3"; shift 3
  local code="000" t
  for t in 1 2 3; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$@" "$url" 2>/dev/null)
    [ "$code" = "$want" ] && break; sleep 3
  done
  if [ "$code" = "$want" ]; then ok "$name" "$url → $code"; else bad "$name" "$url → $code (기대 $want)"; fi
}

# pm2 프로세스 상태 — online · stopped · errored · 없음
pm2_state() {
  pm2 jlist 2>/dev/null | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const a=JSON.parse(s.slice(s.indexOf("["))); const p=a.find(x=>x.name===process.argv[1]);
            console.log(p ? p.pm2_env.status+" "+(p.pm2_env.restart_time??0)+" "+(p.pm2_env.pm_exec_path||"") : "없음"); }
      catch { console.log("없음"); } })' "$1" 2>/dev/null
}

# 메모리(MB) — 실제 + 스왑
mem_total_mb() { awk '/MemTotal|SwapTotal/ {s+=$2} END {printf "%d", s/1024}' /proc/meminfo; }

# 옛 판 정리(v10.91 · docs/146) — 판 보관 폴더에서 지금 판 · 직전 판만 남기고 나머지 판 폴더를 지웁니다.
#   prune_releases <판 보관 폴더> <지금 판> <직전 판>   — apply.sh 가 새 판이 뜬 것을 확인한 뒤에만 부릅니다.
#   지우는 것: 판 보관 폴더 **바로 아래**의 v*_* · prev_* 폴더(바로가기 · 파일은 건드리지 않음). KEEP_OLD_RELEASES=1 이면 아무것도 지우지 않습니다.
prune_releases() {
  local root cur prev d n=0 kb=0 names=""
  root=$(readlink -f "$1" 2>/dev/null) || return 0
  cur=$(readlink -f "$2" 2>/dev/null); prev=""
  [ -n "${3:-}" ] && [ -d "$3" ] && prev=$(readlink -f "$3")
  [ -n "$root" ] && [ -d "$root" ] && [ -n "$cur" ] && [ -d "$cur" ] || return 0
  case "$cur" in "$root"/*) ;; *) return 0;; esac
  if [ "${KEEP_OLD_RELEASES:-0}" = "1" ]; then info "옛 판 정리 건너뜀 (KEEP_OLD_RELEASES=1)"; return 0; fi
  for d in "$root"/v*_* "$root"/prev_*; do
    [ -d "$d" ] && [ ! -L "$d" ] || continue
    [ "$d" = "$cur" ] || [ "$d" = "$prev" ] && continue
    kb=$((kb + $(du -sk "$d" 2>/dev/null | cut -f1)))
    rm -rf -- "$d" && { n=$((n+1)); names="$names ${d##*/}"; }
  done
  if [ "$n" -gt 0 ]; then info "옛 판 ${n}개 정리 · 약 $((kb / 1024))MB —$names (남김: ${cur##*/}${prev:+ · ${prev##*/}})"
  else info "정리할 옛 판 없음 (남김: ${cur##*/}${prev:+ · ${prev##*/}})"; fi
}

# ── v10.171 (docs/264) Nginx 실제 설정 읽기 ─────────────────────────────
#   11/1 사고: 고친 파일이 /etc/nginx/sites-available/sgb 였는데 Nginx 는 sites-enabled/sgb(바로가기가 아닌 따로 있는 파일)를 읽어
#   사용자 웹이 계속 허용 IP + 비밀번호 창이었음. 점검이 「실제로 읽는 파일」과 「사용자 웹 · 운영 화면이 열렸는지」를 직접 보여 줍니다.

# 서버 블록 하나씩 보고 상태를 냄 — 입력: 주석을 뺀 설정 글 · 출력: 「user <상태>」 · 「admin <상태>」 줄
#   user  = 사용자 웹(127.0.0.1:5174 로 넘기는 블록) · admin = 운영 화면(web/dist 를 내보내는 블록)
#   상태  = open(누구나) · ip(허용 IP 만) · pw(비밀번호 창만) · ip+pw(허용 IP 또는 비밀번호 — satisfy any)
nginx_block_states() {
  awk '
    function flush() {
      if (blk == "") return
      kind = ""
      if (blk ~ /127\.0\.0\.1:5174|localhost:5174/) kind = "user"
      else if (blk ~ /web\/dist/) kind = "admin"
      if (kind != "") {
        ip = (blk ~ /deny[ \t]+all[ \t]*;/); pw = (blk ~ /auth_basic[ \t]+"[^"]*"/)
        st = ip && pw ? "ip+pw" : ip ? "ip" : pw ? "pw" : "open"
        print kind, st
      }
      blk = ""
    }
    {
      line = $0
      if (depth == 0 && line ~ /^[ \t]*server[ \t]*\{/) blk = ""
      blk = blk "\n" line
      o = gsub(/\{/, "{", line); c = gsub(/\}/, "}", line); depth += o - c
      if (depth == 0) flush()
    }'
}

# sites-enabled 의 파일마다 「바로가기 → 대상」 또는 「따로 있는 파일」 · 같은 이름의 sites-available 와 내용이 다르면 알림
nginx_enabled_files() {
  local d="${1:-/etc/nginx/sites-enabled}" a="${2:-/etc/nginx/sites-available}" f n
  for f in "$d"/*; do
    [ -e "$f" ] || continue
    n=$(basename "$f")
    if [ -L "$f" ]; then echo "$n 바로가기 → $(readlink -f "$f")"
    elif [ -f "$a/$n" ] && ! cmp -s "$f" "$a/$n" 2>/dev/null; then echo "$n 따로 있는 파일 · sites-available/$n 와 내용이 다름(그 파일은 쓰이지 않음 — 고칠 때는 sites-enabled/$n)"
    else echo "$n 따로 있는 파일"; fi
  done
}

# 상태를 사람이 읽는 말로
nginx_state_ko() {
  case "$1" in open) echo "누구나 열림";; ip) echo "허용 IP 만";; pw) echo "비밀번호 창";; ip+pw) echo "허용 IP + 밖은 비밀번호 창";; *) echo "알 수 없음";; esac
}
