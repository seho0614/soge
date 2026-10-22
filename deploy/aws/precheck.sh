#!/usr/bin/env bash
# =====================================================================
# AWS 적용 전 — 서버의 지금 상태를 봅니다.  **아무것도 바꾸지 않습니다(읽기만).**
#
#   bash ~/SGB_DevDocker_Integrated_…/sgb/deploy/aws/precheck.sh
#
#   보는 것: 프로그램 버전 · 메모리 · 디스크 · 지금 도는 앱(pm2) · Nginx · .env 에 있는 키(값은 안 보여 줌) ·
#           DB 접속 · 마이그레이션(적용 수 · 올릴 것 · 바뀐 파일) · 계정 수 · 간주 모드 · 발신 IP · 암호화 열쇠
#   결과: 화면 + ~/sgb-data/logs/precheck_날짜_시각.txt   ← 이 파일을 보내 주시면 됩니다
#
#   APP_LINK   지금 앱 폴더 (기본 ~/sgb)
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NEW="$(cd "$HERE/../.." && pwd)"                      # 새 킷의 sgb 폴더
. "$HERE/lib.sh"
APP_LINK="${APP_LINK:-$HOME/sgb}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
mkdir -p "$DATA_DIR/logs"
OUT="$DATA_DIR/logs/precheck_$(date +%Y%m%d_%H%M%S).txt"; : > "$OUT"
NEWVER="$(cat "$NEW/VERSION" 2>/dev/null || echo '?')"

say "소개뱅크 AWS 적용 전 점검 ($(date '+%Y-%m-%d %H:%M:%S %Z')) — 올릴 판 $NEWVER"
say "지금 앱 폴더: $APP_LINK   ·   새 킷: $NEW"

say ""; say "[1] 프로그램"
nv=$(node -v 2>/dev/null || true)
case "$nv" in
  v22.*) ok "Node.js" "$nv (킷을 검정한 판과 같은 22)";;
  "") bad "Node.js 가 없음";;
  v20.*) bad "Node.js" "$nv — 킷은 22 에서 검정했고 apply 는 22 가 아니면 멈춥니다. 22 로 올리십시오 (절차서 4-2 ①)";;
  *) bad "Node.js" "$nv — 킷은 22 에서 검정했고 apply 는 22 가 아니면 멈춥니다 (절차서 4-2 ①)";;
esac
for c in npm pm2 psql nginx curl unzip; do
  if command -v $c >/dev/null 2>&1; then
    case $c in
      nginx) v=$(nginx -v 2>&1 | sed 's/.*: //');;
      psql)  v=$(psql --version | awk '{print $3}');;
      curl)  v=$(curl --version | head -1 | awk '{print $2}');;
      unzip) v="있음";;
      *)     v=$($c -v 2>/dev/null | tail -1);;
    esac
    ok "$c" "$v"
  else
    case $c in nginx) warn "nginx 가 없음" "사용자 웹 · 운영 화면을 바깥에 열려면 필요합니다";; *) bad "$c 가 없음";; esac
  fi
done
command -v aws >/dev/null 2>&1 && info "aws CLI $(aws --version 2>&1 | awk '{print $1}')" || info "aws CLI 없음 (start.sh 가 Secrets Manager 를 읽는다면 필요합니다)"

say ""; say "[2] 메모리 · 디스크"
mt=$(mem_total_mb); sw=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$mt" -ge 3500 ]; then ok "메모리 + 스왑" "${mt}MB (스왑 ${sw}MB)"
else bad "메모리 + 스왑이 모자람" "${mt}MB (스왑 ${sw}MB) — 빌드에 3.5GB 가 필요합니다. 스왑 2GB 를 먼저 만드십시오 (절차서 4-2 ②)"; fi
df_free=$(df -Pm "$HOME" | awk 'NR==2 {print $4}')
if [ "${df_free:-0}" -ge 4000 ]; then ok "디스크 여유" "${df_free}MB"
else bad "디스크 여유가 모자람" "${df_free}MB — 4GB 이상 필요합니다 (새 판 설치 + 전 판 보관)"; fi

say ""; say "[3] 지금 도는 앱 (pm2)"
if command -v pm2 >/dev/null 2>&1; then
  for n in sgb sgb-site sgb-jobs; do
    st=$(pm2_state "$n")
    case "$st" in online*) info "$n  $st";; *) info "$n  ${st:-없음}";; esac
  done
  others=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));console.log(a.map(x=>x.name).filter(n=>!["sgb","sgb-site","sgb-jobs"].includes(n)).join(" "))}catch{}})' 2>/dev/null)
  [ -n "$others" ] && warn "다른 이름의 pm2 프로세스" "$others — 소개뱅크 API 가 이 이름으로 떠 있다면 알려 주십시오"
  if systemctl is-enabled "pm2-$(id -un)" >/dev/null 2>&1; then ok "재부팅 뒤 자동 기동(pm2 startup)" "켜짐"
  else warn "재부팅 뒤 자동 기동(pm2 startup)" "꺼져 있거나 확인 불가 — 적용 뒤 pm2 startup 을 하십시오 (절차서 5-3)"; fi
fi
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${PORT:-3000}/api/v1/health" 2>/dev/null)
info "지금 API 상태 주소 → $code"

say ""; say "[4] 앱 폴더 · .env"
if [ -L "$APP_LINK" ]; then info "$APP_LINK 는 바로가기 → $(readlink -f "$APP_LINK")"
elif [ -d "$APP_LINK" ]; then info "$APP_LINK 는 폴더 (처음 적용 — apply 가 보관 폴더로 옮기고 바로가기로 바꿉니다)"
else bad "$APP_LINK 가 없음" "처음 세우는 서버라면 절차서 v2.5 7부(.env 작성)까지 먼저 하십시오"; fi
[ -f "$APP_LINK/VERSION" ] && info "지금 판 $(cat "$APP_LINK/VERSION")" || info "지금 판 표시 없음 (v10.15 이전 킷)"
ENVF="$APP_LINK/.env"
if [ -f "$ENVF" ]; then
  for k in DATABASE_URL JWT_SECRET; do env_has "$ENVF" $k && ok ".env $k" "있음" || bad ".env 에 $k 가 없음"; done
  if env_has "$ENVF" ENC_KEY; then ok ".env ENC_KEY" "있음"
  elif [ -f "$APP_LINK/start.sh" ]; then ok "ENC_KEY" ".env 에는 없고 start.sh 가 읽어 옵니다"
  else warn "ENC_KEY 가 .env 에도 없고 start.sh 도 없음" "Secrets Manager(sgb/prod/enc-key)에서 읽기를 시도합니다"; fi
  env_has "$ENVF" JOB_TOKEN && ok ".env JOB_TOKEN" "있음" || warn ".env 에 JOB_TOKEN 이 없음" "배치(알림 · 청구 · 파기)가 돌지 않습니다 — openssl rand -hex 24 로 만들어 넣으십시오"
  if grep -Eq '^[[:space:]]*NODE_ENV[[:space:]]*=[[:space:]]*production' "$ENVF"; then ok ".env NODE_ENV" "production"
  else warn ".env NODE_ENV 가 production 이 아님" "실행 스크립트가 production 으로 띄우지만, .env 에도 적어 두십시오"; fi
  if env_has "$ENVF" S3_BUCKET; then ok "파일 저장" "S3 (S3_BUCKET)"
  elif env_has "$ENVF" UPLOAD_DIR; then ok "파일 저장" "서버 디스크 (UPLOAD_DIR)"
  else warn "파일 저장 위치가 안 정해짐" "apply 가 UPLOAD_DIR=$DATA_DIR/uploads 를 .env 에 넣습니다 (앱 폴더 밖 — 판을 바꿔도 남게)"; fi
  if grep -Eq '^[[:space:]]*S3_(UPLOAD|PUBLIC)_BUCKET' "$ENVF"; then
    warn ".env 의 S3_UPLOAD_BUCKET · S3_PUBLIC_BUCKET 은 지금 코드가 읽지 않습니다" "S3 를 쓰려면 S3_BUCKET=버킷이름 으로 적으십시오 (절차서 9부)"
  fi
  if grep -Eq 'dev-only-|docker-dev-|docker-test-|sgb-dev-1234' "$ENVF"; then bad ".env 에 개발용 값이 남아 있음" "JWT_SECRET · ENC_KEY · JOB_TOKEN 을 서버에서 새로 만든 값으로 바꾸십시오"
  else ok ".env 에 개발용 값 없음"; fi
  load_env "$ENVF"
else
  bad "$ENVF 가 없음"
fi

say ""; say "[5] DB"
if [ -n "${DATABASE_URL:-}" ] && db -c "SELECT 1" >/dev/null 2>&1; then
  ok "DB 접속" "$(q "select 'PostgreSQL ' || current_setting('server_version') || ' · DB ' || current_database()")"
  info "SSL — psql 접속: $(q "select case when ssl then '암호화됨' else '암호화 안 됨' end from pg_stat_ssl where pid = pg_backend_pid()") · 접속 주소의 표기: $(echo "$DATABASE_URL" | grep -oE '(sslmode|uselibpqcompat|sslrootcert)=[^&]*' | sed 's/sslrootcert=.*/sslrootcert=…/' | paste -sd' ' || true)"
  if curl -s --max-time 10 "http://127.0.0.1:${PORT:-3000}/api/v1/health" | grep -q '"db":true'; then ok "지금 도는 앱도 DB 에 붙어 있음 (앱의 접속 주소가 맞음)"
  else warn "지금 도는 앱의 DB 접속을 확인하지 못함" "앱이 꺼져 있거나 접속 주소가 앱(Node)에 맞지 않습니다 — apply 가 설치 직후 앱 방식으로 한 번 더 붙어 봅니다"; fi
  applied=$(q "select count(*) from schema_migrations"); files=$(find "$NEW/prisma/migrations" -mindepth 2 -maxdepth 2 -name migration.sql | wc -l | tr -d ' ')
  st=$(mig_status "$NEW/prisma/migrations")
  pend=$(echo "$st" | grep -c '^올릴것'); drift=$(echo "$st" | grep -c '^바뀜')
  info "마이그레이션 — 적용됨 ${applied:-?} · 새 킷의 파일 $files · 올릴 것 $pend · 바뀐 파일 $drift"
  [ "$drift" = "0" ] && ok "이미 적용된 파일이 바뀌지 않음" || bad "이미 적용된 마이그레이션 파일이 다름 $drift건" "적용을 멈추고 알려 주십시오 — 서버에 올렸던 킷과 지금 킷의 파일이 다릅니다"
  [ "$pend" != "0" ] && echo "$st" | grep '^올릴것' | awk '{print $2}' | paste -sd' ' | fold -s -w 110 | sed 's/^/        올릴 것: /' | tee -a "$OUT"
  [ "$drift" != "0" ] && echo "$st" | grep '^바뀜' | sed 's/^/        /' | tee -a "$OUT"
  info "계정 $(q "select count(*) from accounts")명 · 개발 계정(@x.com) $(q "select count(*) from accounts where email like '%@x.com'")명"
  info "간주 모드: $(qn "select key||'='||value from site_settings where key like 'assume.%' order by 1" | tr '\n' ' ')"
  info "기능 스위치: $(qn "select key||'='||value from site_settings where key like 'feature.%' order by 1" | tr '\n' ' ')"   # v10.65 D105 — 대문자 ON 이면 적용 뒤 켜짐으로 읽힘
  info "발신 IP(infra.egress_ip): $(q "select coalesce(nullif(value,''),'(비어 있음)') from site_settings where key='infra.egress_ip'")"
  info "암호화 열쇠(이 접속 기준 — 앱이 띄울 때 걸므로 여기서는 f 가 정상): $(q "select is_set from v_enc_key_status")"
  info "오픈 차단 $(q "select count(*) from v_open_blockers")건 [$(q "select string_agg(kind||':'||c, ' ') from (select kind, count(*) c from v_open_blockers group by kind) x")]"
else
  bad "DB 접속 실패" "DATABASE_URL · 보안 그룹(sgb-db ← sgb-web) · sslmode 를 확인하십시오"
fi

say ""; say "[6] Nginx"
if command -v nginx >/dev/null 2>&1; then
  ls /etc/nginx/sites-enabled/ 2>/dev/null | sed 's/^/        켜진 설정: /' | tee -a "$OUT"
  CONF=$(cat /etc/nginx/sites-enabled/* 2>/dev/null | sed 's/#.*//')        # 주석 줄은 빼고 봅니다
  echo "$CONF" | grep -oE 'server_name[^;]*;|proxy_pass[^;]*;|listen[^;]*;|root[^;]*;|ssl_certificate [^;]*;|allow[^;]*;|deny[^;]*;' | sort | uniq -c | sed 's/^/        /' | tee -a "$OUT"
  if echo "$CONF" | grep -q 'ssl_certificate'; then info "HTTPS 인증서 설정 있음"; else info "HTTPS 인증서 설정 없음 (https 가 없으면 사용자 웹 로그인이 유지되지 않습니다 — 절차서 6-3)"; fi
fi

say ""
say "적용 전 점검 — 통과 $PASS · 실패 $FAIL · 확인 $WARN"
[ "$FAIL" = "0" ] && say "→ 「실패」가 없습니다. 「확인」 줄을 읽고 apply.sh 로 넘어가십시오." || say "→ 「실패」 줄을 먼저 해결하십시오. apply.sh 도 같은 것을 보고 멈춥니다."
say "결과 파일: $OUT"
[ "$FAIL" = "0" ]
