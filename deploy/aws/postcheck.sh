#!/usr/bin/env bash
# =====================================================================
# AWS 적용 후 확인.   bash ~/sgb/deploy/aws/postcheck.sh        **읽기만 합니다(주소 열어 보기 · DB 조회).**
#
#   apply.sh 끝에 자동으로 돌고, 그 뒤에도 언제든 다시 돌릴 수 있습니다(재부팅 뒤 · .env 고친 뒤 · Nginx 바꾼 뒤).
#   「실패」는 고쳐야 하는 것, 「확인」은 읽고 판단할 것(오픈 전에는 정상인 것 포함)입니다.
#   결과: 화면 + ~/sgb-data/logs/postcheck_날짜_시각.txt   ← 이 파일을 보내 주시면 됩니다
#
#   SITE_DOMAIN   바깥 주소(선택). 비우면 DB 의 site.domain 을 씁니다       예) sogaebaenk.co.kr
#   ADMIN_DOMAIN  운영 화면 주소(선택)                                    예) admin.sogaebaenk.co.kr
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
APP_LINK="${APP_LINK:-$HOME/sgb}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
mkdir -p "$DATA_DIR/logs"
OUT="$DATA_DIR/logs/postcheck_$(date +%Y%m%d_%H%M%S).txt"; : > "$OUT"
APP="$(readlink -f "$APP_LINK")"
VER="$(cat "$APP/VERSION" 2>/dev/null || echo '?')"
load_env "$APP/.env" || { echo "!! $APP/.env 가 없습니다"; exit 1; }
API="http://127.0.0.1:${PORT:-3000}"; SITE="http://127.0.0.1:${SITE_PORT:-5174}"

say "소개뱅크 AWS 적용 후 확인 ($(date '+%Y-%m-%d %H:%M:%S %Z')) — $VER"
say "앱 폴더: $APP_LINK → $APP"

say ""; say "[1] 프로세스 (pm2)"
for n in sgb sgb-site; do
  st=$(pm2_state "$n"); set -- $st
  [ "${1:-}" = "online" ] && ok "$n" "online · 재시작 ${2:-0}회" || bad "$n" "${st:-없음} — pm2 logs $n --lines 50"
done
st=$(pm2_state sgb-jobs); set -- $st
if [ "${1:-}" = "online" ]; then ok "sgb-jobs (배치 호출기)" "online · 재시작 ${2:-0}회"
elif [ "${SKIP_JOBS:-0}" = "1" ]; then info "sgb-jobs 없음 (SKIP_JOBS=1 — EventBridge 사용)"
else bad "sgb-jobs (배치 호출기)" "${st:-없음} — 알림 · 청구 · 탈퇴 파기가 돌지 않습니다"; fi
case "$(pm2_state sgb)" in *deploy/aws/run-api.sh*) ok "sgb 는 실행 스크립트(run-api.sh)로 등록됨";; *) warn "sgb 가 run-api.sh 로 등록되어 있지 않음" "$(pm2_state sgb | awk '{print $3}')";; esac
if systemctl is-enabled "pm2-$(id -un)" >/dev/null 2>&1; then ok "재부팅 뒤 자동 기동 (pm2 startup)"
else warn "재부팅 뒤 자동 기동이 꺼져 있거나 확인할 수 없음" "pm2 startup 이 알려 주는 sudo 명령을 한 번 실행하고 pm2 save (절차서 5-3)"; fi
[ -f "$HOME/.pm2/dump.pm2" ] || [ -f "${PM2_HOME:-$HOME/.pm2}/dump.pm2" ] && ok "pm2 save 기록 있음" || warn "pm2 save 기록 없음" "pm2 save"

say ""; say "[2] API"
h=$(curl -s --max-time 10 "$API/api/v1/health")
echo "$h" | grep -q '"db":true' && ok "상태 주소" "$h" || bad "상태 주소" "${h:-응답 없음}"
http_is "API 문서(/docs)는 운영에서 닫혀 있음" "$API/docs" 404
[ "${NODE_ENV:-}" = "production" ] && ok ".env NODE_ENV=production" || bad ".env 의 NODE_ENV 가 production 이 아님" "${NODE_ENV:-없음}"
case "$(pm2 logs sgb --lines 200 --nostream 2>/dev/null)" in *"Nest application successfully started"*) ok "기동 로그 정상";; *) info "기동 로그에서 시작 문구를 찾지 못함 (로그가 넘어갔을 수 있음)";; esac

say ""; say "[3] DB"
if db -c "SELECT 1" >/dev/null 2>&1; then
  ST=$(mig_status "$APP/prisma/migrations")
  d=$(echo "$ST" | grep -c '^적용됨'); p=$(echo "$ST" | grep -c '^올릴것'); x=$(echo "$ST" | grep -c '^바뀜'); f=$(echo "$ST" | wc -l | tr -d ' ')
  [ "$p" = "0" ] && [ "$x" = "0" ] && ok "마이그레이션" "적용 $d / 파일 $f · 올릴 것 0 · 바뀐 파일 0" || bad "마이그레이션" "적용 $d / 파일 $f · 올릴 것 $p · 바뀐 파일 $x"
  v=$(q "SELECT coalesce(sum(violation_count),0) FROM fn_verify_invariants()")
  [ "$v" = "0" ] && ok "불변식 위반 0건" || bad "불변식 위반 ${v:-?}건" "서비스를 멈추고 알려 주십시오 (docs/25 1-5)"
  n=$(q "select count(*) from accounts where email like '%@x.com'")
  [ "$n" = "0" ] && ok "개발 계정(@x.com) 없음" || bad "개발 계정(@x.com) ${n}명" "비밀번호가 알려진 계정입니다 — 운영 DB 에 있으면 안 됩니다"
  n=$(q "select count(*) from v_enc_key_missing")
  [ "$n" = "0" ] && ok "열쇠 없이 저장된 자료 0건" || bad "열쇠 없이 저장된 자료 ${n}건" "ENC_KEY 가 걸리지 않은 채 저장됐습니다"
  n=$(q "SELECT count(*) FROM ops_alerts WHERE severity='CRITICAL' AND acknowledged_at IS NULL")
  [ "$n" = "0" ] && ok "미확인 CRITICAL 경보 0건" || bad "미확인 CRITICAL 경보 ${n}건" "운영 화면 → 경보에서 확인"
  info "계정 $(q "select count(*) from accounts")명 · 관리자 $(q "select count(distinct account_id) from account_roles where role in ('ADMIN','SUPER')")명"
else
  bad "DB 접속 실패"
fi

say ""; say "[4] 사용자 웹"
http_is "메인"              "$SITE/" 200
http_is "소개광장 투표"      "$SITE/community/polls" 200
http_is "안심소개"           "$SITE/mall" 200
http_is "로그인 화면"        "$SITE/login" 200
http_is "사이트를 거친 API"  "$SITE/api/v1/health" 200
home=$(curl -s --max-time 60 "$SITE/")
if echo "$home" | grep -q '디자인 예시입니다'; then warn "메인이 그림의 예시 내용으로 떠 있음 (HOME_CONTENT 가 live 가 아님)" "손님에게 열기 전에 .env 에서 HOME_CONTENT 줄을 지우거나 live 로 — 예시 평점 · 후기 수가 실제처럼 보입니다"
else ok "메인이 실제 자료로 떠 있음 (HOME_CONTENT=live)"; fi
PROTO=$(ls "$APP/site/public/proto/" 2>/dev/null | grep -E '^SGB_Prototype_.*\.html$' | head -1)
[ -n "$PROTO" ] && http_is "시안" "$SITE/proto/$PROTO" 200

say ""; say "[5] 운영 화면"
[ -f "$APP/web/dist/index.html" ] && ok "빌드 결과 있음" "$APP_LINK/web/dist (Nginx 가 이 폴더를 내보냅니다)" || bad "운영 화면 빌드 결과가 없음" "(cd $APP_LINK/web && npm run build)"
# Nginx(www-data)는 홈 폴더를 지나가야 이 파일을 읽습니다 — Ubuntu 24.04 의 홈 폴더는 750 이라 그대로는 못 지나갑니다(운영 화면이 500/403).
d="$APP_LINK"; blocked=""
while [ "$d" != "/" ] && [ -n "$d" ]; do d="$(dirname "$d")"; [ "$d" = "/" ] && break; p=$(stat -c %A "$d" 2>/dev/null); case "${p:9:1}" in x|t) ;; *) blocked="$d";; esac; done
[ -z "$blocked" ] && ok "Nginx 가 운영 화면 폴더까지 지나갈 수 있음" || bad "Nginx 가 $blocked 를 지나갈 수 없음 (권한 $(stat -c %a "$blocked"))" "chmod o+x $blocked  — 지나가기만 허용(목록은 못 봄 · .env 는 600 이라 못 읽음)"

say ""; say "[6] 배치"
if [ "$(pm2_state sgb-jobs | awk '{print $1}')" = "online" ]; then
  hb="${SCHEDULER_HEARTBEAT:-/tmp/sgb-jobs.ok}"
  for i in $(seq 1 14); do [ -n "$(find "$hb" -mmin -3 2>/dev/null)" ] && break; sleep 5; done
  [ -n "$(find "$hb" -mmin -3 2>/dev/null)" ] && ok "배치 호출 성공 (최근 3분 안)" "$(cat "$hb" 2>/dev/null)" || bad "배치 호출이 성공한 기록이 없음" "pm2 logs sgb-jobs --lines 30 — JOB_TOKEN 이 API 와 같은 .env 값인지"
fi
n=$(q "select count(*) from v_job_stale where not never_ran")
[ "${n:-0}" = "0" ] && ok "멈춘 배치 0건" || bad "멈춘 배치 ${n}건" "$(qn "select job from v_job_stale where not never_ran" | tr '\n' ' ')"
n=$(q "select count(*) from v_job_stale where never_ran")
[ "${n:-0}" = "0" ] || info "아직 한 번도 안 돈 배치 ${n}건 — 처음 띄운 직후에는 정상입니다(하루 1번 도는 것은 그 시각에 돕니다). 며칠 뒤에도 남으면 확인"

say ""; say "[7] 파일 저장"
if [ -n "${S3_BUCKET:-}" ]; then ok "S3" "$S3_BUCKET (올리기 시험은 운영 화면 · 사이트에서 파일 1개로)"
else
  up="${UPLOAD_DIR:-./uploads}"
  case "$up" in
    /*) case "$(readlink -f "$up")" in "$APP"/*) bad "UPLOAD_DIR 가 앱 폴더 안" "$up — 판을 바꾸면 안 보입니다";;
          *) [ -w "$up" ] && ok "서버 디스크" "$up (앱 폴더 밖 · 쓰기 가능) — ★ 이 폴더는 RDS 스냅샷에 들어가지 않습니다. 따로 백업하십시오" || bad "UPLOAD_DIR 에 쓸 수 없음" "$up";; esac;;
    *) bad "UPLOAD_DIR 가 상대 경로이거나 없음" "$up — 앱 폴더 안에 저장되어 판을 바꾸면 안 보입니다";;
  esac
fi

say ""; say "[8] 바깥 주소 (Nginx · HTTPS)"
DOM="${SITE_DOMAIN:-$(q "select value from site_settings where key='site.domain'")}"
if command -v nginx >/dev/null 2>&1; then
  CONF=$(cat /etc/nginx/sites-enabled/* 2>/dev/null | sed 's/#.*//')         # 주석 줄은 빼고 봅니다(주석 처리한 allow/deny 를 켜진 것으로 세지 않게)
  echo "$CONF" | grep -q "127.0.0.1:${SITE_PORT:-5174}\|localhost:${SITE_PORT:-5174}" && ok "Nginx 가 사용자 웹(${SITE_PORT:-5174})으로 넘김" \
    || bad "Nginx 설정에 사용자 웹(${SITE_PORT:-5174})으로 넘기는 줄이 없음" "아직 예전 설정(전부 3000 으로)입니다 — 절차서 6부"
  echo "$CONF" | grep -q "web/dist" && ok "Nginx 가 운영 화면(web/dist)을 내보냄" || warn "Nginx 설정에 운영 화면(web/dist)이 없음" "절차서 6부"
  echo "$CONF" | grep -Eq 'X-Forwarded-For[[:space:]]+\$remote_addr' && ok "접속자 IP 를 Nginx 가 덮어씀 (X-Forwarded-For \$remote_addr)" \
    || warn "X-Forwarded-For 를 \$remote_addr 로 덮어쓰는 줄이 없음" "비로그인 투표의 IP 하루 한도가 헤더 조작으로 뚫리거나, 모두 같은 IP 로 묶입니다 — 절차서 6부 예시대로"
  if echo "$CONF" | grep -q 'ssl_certificate'; then ok "HTTPS 인증서 설정 있음"
  else warn "HTTPS 가 아직 없음" "사용자 웹 로그인은 https(또는 localhost)에서만 유지됩니다 — 절차서 6-3"; fi
  if [ -n "$DOM" ]; then
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOM/api/v1/health" 2>/dev/null)
    [ "$c" = "200" ] && ok "https://$DOM 로 API 까지 닿음" || warn "https://$DOM/api/v1/health → ${c:-000}" "도메인 · 인증서가 아직이면 정상입니다. 접근 제한(사무실 IP만)을 걸었으면 403 이 정상입니다"
  fi
  [ -n "${ADMIN_DOMAIN:-}" ] && { c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$ADMIN_DOMAIN/" 2>/dev/null); info "https://$ADMIN_DOMAIN/ → ${c:-000} (서버 자신은 허용 IP 가 아니면 403 이 정상)"; }
else
  warn "nginx 가 없음" "바깥에서 들어올 길이 없습니다 — 절차서 6부"
fi

say ""; say "[9] 열기 전 상태 (오픈 전에는 「확인」이 정상입니다)"
if db -c "SELECT 1" >/dev/null 2>&1; then
  a=$(qn "select key from v_assumed_on" | tr '\n' ' ')
  if [ -n "$a" ]; then
    warn "간주 모드가 켜져 있음: $a" "실제 결제 · 중개사 대조 · 실계좌 · 국세청 전자세금계산서 전송 없이 통과합니다(assume.etax 켜짐이면 「발행(간주)」은 실제 세금계산서가 아님 — 홈택스에서 발행 후 번호 넣기) — 연동 뒤 끄기 전에는 손님에게 열지 마십시오"
    if command -v nginx >/dev/null 2>&1 && ! cat /etc/nginx/sites-enabled/* 2>/dev/null | sed 's/#.*//' | grep -Eq 'deny[[:space:]]+all|auth_basic[[:space:]]'; then
      bad "간주 모드가 켜진 채 접근 제한이 없음" "Nginx 에 사무실 IP 만 허용(allow … ; deny all;)을 거십시오 — 지금은 주소를 아는 누구나 가입 · 결제 간주가 됩니다 (절차서 6-2)"
    else ok "접근 제한(allow/deny 또는 암호)이 걸려 있음"; fi
  else ok "간주 모드 꺼짐"; fi
  b=$(q "select count(*) from v_open_blockers")
  [ "$b" = "0" ] && ok "오픈 차단 0건" || warn "오픈 차단 ${b}건" "$(q "select string_agg(kind||':'||c, ' ') from (select kind, count(*) c from v_open_blockers group by kind) x") — 여는 날까지 해소 (npm run open:check)"
  t=$(q "select count(*) from terms where status='PUBLISHED'"); dr=$(q "select count(*) from terms where status='DRAFT'")
  [ "${dr:-0}" = "0" ] && ok "약관 — 발행 $t · 초안 0" || warn "약관 — 발행 $t · 초안 $dr" "법무 확인 뒤 EFFECTIVE_FROM=시행일 npm run terms:publish"
  e=$(q "select coalesce(nullif(btrim(value),''),'') from site_settings where key='infra.egress_ip'")
  [ -n "$e" ] && ok "발신 IP(infra.egress_ip)" "$e" || warn "발신 IP(infra.egress_ip)가 비어 있음" "외부 연동 신청서에 적는 고정 IP"
  pub=""; [ "${SKIP_EGRESS_CHECK:-0}" = "1" ] || pub=$(curl -s --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]')
  [ -n "$pub" ] && [ -n "$e" ] && { [ "$pub" = "$e" ] && ok "서버의 실제 나가는 IP 가 발신 IP 와 같음" "$pub" || bad "서버의 실제 나가는 IP($pub)가 등록한 발신 IP($e)와 다름" "탄력적 IP 가 떨어졌거나 설정 값이 옛것입니다"; }
  info "메인에 나가는 투표 $(q "select count(*) from v_poll_home")건 (3건이 아니면 그 자리는 「준비 중」으로 나옵니다 — 운영 화면 「이건 어때? 투표」)"
  info "사회관계망 주소: $(qn "select replace(key,'sns.','')||'='||case when coalesce(btrim(value),'')='' then '비어 있음' else '있음' end from site_settings where key like 'sns.%' order by 1" | tr '\n' ' ')"
fi

say ""
say "적용 후 확인 — 통과 $PASS · 실패 $FAIL · 확인 $WARN"
[ "$FAIL" = "0" ] && say "→ 「실패」 0. 「확인」 줄은 절차서 7부의 표대로 판단하십시오." || say "→ 「실패」 줄을 먼저 고치십시오 (절차서 8부 「막혔을 때」)."
say "결과 파일: $OUT"
[ "$FAIL" = "0" ]
