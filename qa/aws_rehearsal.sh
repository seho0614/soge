#!/usr/bin/env bash
# =====================================================================
# 운영 방식 리허설 (v10.16) — 「2026-09-30 에 세운 서버」를 이 PC 안에 흉내 내고, 새 킷의 deploy/aws 스크립트로 실제처럼 올려 봅니다.
#
#   bash aws_rehearsal.sh            전체 (약 10분)
#
#   1. 옛 서버 재현   가짜 홈(/tmp/awshome · 권한 750) · 9/30 킷 · DB(sgb_aws)에 마이그레이션 43 · pm2 로 API 만(start.sh) · 옛 Nginx(전부 API 로)
#   2. 새 킷 올리기   precheck.sh → apply.sh (스냅샷 물음만 건너뜀)
#   3. Nginx 교체     deploy/aws/nginx-sgb.conf.example (리허설 포트 · 자체 서명 인증서) · 홈 폴더 통과 권한
#   4. 적용 후 확인   postcheck.sh — 「실패 0」
#   5. 화면 · 기능    aws_rehearsal.py (브라우저 → Nginx(HTTPS) → 사용자 웹 → API)
#   6. 운영 동작      .env 고친 뒤 재시작 · 재부팅 흉내(pm2 resurrect) · 되돌리기 · 다시 앞으로 · 한 번 더 적용
#
#   필요: PostgreSQL(슈퍼유저 postgres) · nginx · pm2 · Node 22 · 9/30 킷(K0930) · 포장 전 작업본(KIT)
#   결과: aws_rehearsal_precheck.txt · _apply.txt · _postcheck.txt · aws_rehearsal.json · aws_rehearsal_ops.json
# =====================================================================
set -uo pipefail
QA="$(cd "$(dirname "$0")" && pwd)"
KIT="${KIT:-/home/claude/pkg/SGB_DevDocker_Integrated_20261002}"
K0930="${K0930:-/tmp/k0930/SGB_DevDocker_Integrated_20260930}"
RH="${RH:-/tmp/awshome}"; DBURL="postgresql://sgb:sgb@localhost:5432/sgb_aws"
API_PORT=3200; SITE_PORT=5274; HTTP_PORT=8088
VER="$(cat "$KIT/sgb/VERSION")"; NEWDIR="SGB_DevDocker_Integrated_20261002_${VER//./_}"
# 10/6 (v10.18) — 마이그레이션 수를 글자로 박아 두지 않고 킷에서 셉니다(전: 항목 이름에 「올릴 것 23 · 66」이 박혀 있어 판이 올라가면 이름과 내용이 달랐음). 수도 직접 대조합니다
NMIG=$(ls "$KIT/sgb/prisma/migrations" | wc -l | tr -d ' '); NUP=$((NMIG - 43))
export HOME="$RH" PM2_HOME="$RH/.pm2"
OPS="$QA/aws_rehearsal_ops.json"; : > "$OPS.l"; N=0; NBAD=0
rec() { # 이름 · 0/1(0=통과) · 설명
  N=$((N+1)); [ "$2" = "0" ] || NBAD=$((NBAD+1))
  printf '%s %s %s\n' "$([ "$2" = "0" ] && echo 'ok  ' || echo 'FAIL')" "$1" "${3:-}"
  # 10/6 — 설명 글이 글자 중간에서 잘려 들어오면(바이트 단위로 자른 출력) 결과 파일을 못 읽었습니다 → 깨진 바이트는 바꿔 적습니다
  python3 -c 'import json,sys; c=lambda x: x.encode("utf-8","surrogateescape").decode("utf-8","replace"); print(json.dumps({"step": c(sys.argv[1]), "ok": sys.argv[2] == "0", "detail": c(sys.argv[3])[:300]}, ensure_ascii=False))' "$1" "$2" "${3:-}" >> "$OPS.l"
}
health() { curl -s --max-time 5 "http://127.0.0.1:$API_PORT/api/v1/health" | grep -q '"db":true'; }
wait_for() { local i; for i in $(seq 1 45); do "$@" && return 0; sleep 2; done; return 1; }
site_up() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$SITE_PORT/")" = "200" ]; }
st() { pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));const p=a.find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"none")}catch{console.log("none")}})' "$1"; }

echo "== 1. 옛 서버 재현 (9/30 킷 · API 만 · 마이그레이션 43)"
pm2 kill >/dev/null 2>&1; rm -rf "$RH"; mkdir -p "$RH"; chmod 750 "$RH"
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS sgb_aws' -c 'CREATE DATABASE sgb_aws OWNER sgb'" >/dev/null 2>&1
cp -a "$K0930/sgb" "$RH/sgb"; rm -rf "$RH/sgb/node_modules"; ln -s "$KIT/sgb/node_modules" "$RH/sgb/node_modules"
( cd "$RH/sgb" && npx tsc -p tsconfig.json >/dev/null 2>&1 )
cat > "$RH/sgb/.env" <<EOF
DATABASE_URL=${DBURL}?sslmode=no-verify
JWT_SECRET=$(openssl rand -base64 48)
ENC_KEY=$(openssl rand -base64 32)
NODE_ENV=production
PORT=$API_PORT
SITE_PORT=$SITE_PORT
DB_POOL_MAX=10
JOB_TOKEN=$(openssl rand -hex 24)
EOF
chmod 600 "$RH/sgb/.env"
cat > "$RH/sgb/start.sh" <<'EOF'
#!/bin/bash
set -e
# (리허설) 실제 서버에서는 여기서 Secrets Manager 의 ENC_KEY 를 읽습니다 — 절차서 v2.5 7-3-1
if [ -z "$ENC_KEY" ]; then echo "ENC_KEY 를 못 읽었습니다 — 멈춥니다"; exit 1; fi
exec npm start
EOF
chmod +x "$RH/sgb/start.sh"
( cd "$RH/sgb" && set -a && . ./.env && set +a && node scripts/migrate.js | tail -1 && psql "$DBURL" -qc "update site_settings set value='3.37.95.217' where key='infra.egress_ip'" \
  && pm2 start "$RH/sgb/start.sh" --name sgb >/dev/null 2>&1 && pm2 save >/dev/null 2>&1 )
cat > /etc/nginx/sites-available/sgb <<EOF
server {
  listen $HTTP_PORT;
  server_name sogaebank.com www.sogaebank.com;
  client_max_body_size 20M;
  location / {
    proxy_pass http://localhost:$API_PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }
}
EOF
ln -sf /etc/nginx/sites-available/sgb /etc/nginx/sites-enabled/sgb; rm -f /etc/nginx/sites-enabled/default
pgrep -x nginx >/dev/null && nginx -s reload || nginx
wait_for health; rec "1-1 옛 서버 — API 만 떠 있음 (마이그레이션 43)" $? "$(psql "$DBURL" -tAc 'select count(*) from schema_migrations')"
c=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: sogaebank.com' "http://127.0.0.1:$HTTP_PORT/")
[ "$c" = "404" ]; rec "1-2 옛 Nginx(전부 API 로)에서는 메인이 404 — 사용자 웹이 없음" $? "$c"

echo "== 2. 새 킷 올리기"
if [ -n "${KITZIP:-}" ]; then            # 포장한 zip 그대로 (전달본과 같은 파일로 리허설)
  ( cd "$RH" && unzip -q "$KITZIP" ) && echo "   zip 을 풀었습니다: $KITZIP"
else
  mkdir -p "$RH/$NEWDIR"
  ( cd "$KIT" && tar cf - --exclude=node_modules --exclude=.next --exclude=dist --exclude=__pycache__ --exclude=./sgb/uploads --exclude=tsconfig.tsbuildinfo --exclude='*.bak' --exclude=.env . ) | ( cd "$RH/$NEWDIR" && tar xf - )
fi
( cd "$RH" && bash "$RH/$NEWDIR/sgb/deploy/aws/precheck.sh" ) > "$QA/aws_rehearsal_precheck.txt" 2>&1
pc=$?; grep -q "새 킷의 파일 $NMIG · 올릴 것 $NUP · 바뀐 파일 0" "$QA/aws_rehearsal_precheck.txt"; [ $pc = 0 ] && [ $? = 0 ]
rec "2-1 precheck — 실패 0 · 올릴 것 $NUP · 바뀐 파일 0" $? "$(grep -E '^적용 전 점검|마이그레이션 —' "$QA/aws_rehearsal_precheck.txt" | tr '\n' ' ')"
t0=$SECONDS
( cd "$RH" && SKIP_EGRESS_CHECK=1 ASSUME_YES=1 bash "$RH/$NEWDIR/sgb/deploy/aws/apply.sh" ) > "$QA/aws_rehearsal_apply.txt" 2>&1
grep -q '^적용 끝' "$QA/aws_rehearsal_apply.txt" && [ "$(psql "$DBURL" -tAc 'select count(*) from schema_migrations')" = "$NMIG" ]; rec "2-2 apply — 설치 · 빌드 · 마이그레이션 $NMIG · 교체 · 기동" $? "$((SECONDS - t0))초 · $(grep -E '적용 [0-9]+ · 기존' "$QA/aws_rehearsal_apply.txt" | tr -s ' ') · DB 의 적용 수 $(psql "$DBURL" -tAc 'select count(*) from schema_migrations')"
[ -L "$RH/sgb" ] && [ -d "$RH/sgb-releases" ] && [ "$(cat "$RH/sgb/VERSION")" = "$VER" ]; rec "2-3 ~/sgb 가 새 판을 가리키는 바로가기 · 전 판은 보관 폴더에" $? "$(readlink "$RH/sgb") · $(ls "$RH/sgb-releases" | tr '\n' ' ')"
[ "$(st sgb)" = "online" ] && [ "$(st sgb-site)" = "online" ] && [ "$(st sgb-jobs)" = "online" ]; rec "2-4 pm2 — sgb · sgb-site · sgb-jobs online" $? "$(st sgb) $(st sgb-site) $(st sgb-jobs)"
grep -q "^UPLOAD_DIR=$RH/sgb-data/uploads" "$RH/sgb/.env" && [ "$(stat -c %a "$RH/sgb/.env")" = "600" ]; rec "2-5 .env — UPLOAD_DIR(앱 폴더 밖)을 넣음 · 권한 600 유지" $?

echo "== 3. Nginx 교체 (예시 설정 · https 흉내)"
mkdir -p /etc/nginx/ssl-reh
[ -f /etc/nginx/ssl-reh/reh.crt ] || openssl req -x509 -nodes -newkey rsa:2048 -days 30 -keyout /etc/nginx/ssl-reh/reh.key -out /etc/nginx/ssl-reh/reh.crt \
  -subj "/CN=sogaebank.com" -addext "subjectAltName=DNS:sogaebank.com,DNS:www.sogaebank.com,DNS:admin.sogaebank.com" 2>/dev/null
# 도우미(nginx-render.sh)로 만든 설정에, 리허설용으로 포트(80 → $HTTP_PORT)와 인증서 줄(certbot 이 붙이는 것)을 더합니다
( cd "$RH" && bash "$RH/sgb/deploy/aws/nginx-render.sh" sogaebank.com admin.sogaebank.com 127.0.0.1 ) \
  | sed -e "s/listen 80;/listen $HTTP_PORT;\n  listen 443 ssl;       # (리허설) certbot 이 붙이는 줄을 흉내 — 자체 서명 인증서\n  ssl_certificate \/etc\/nginx\/ssl-reh\/reh.crt;\n  ssl_certificate_key \/etc\/nginx\/ssl-reh\/reh.key;/" > /etc/nginx/sites-available/sgb
grep -q "proxy_pass http://127.0.0.1:$SITE_PORT;" /etc/nginx/sites-available/sgb && grep -q "proxy_pass http://127.0.0.1:$API_PORT;" /etc/nginx/sites-available/sgb; rec "3-0 nginx-render.sh — .env 의 포트(PORT · SITE_PORT)를 따라 설정을 만듦" $?
nginx -t >/dev/null 2>&1; rec "3-1 nginx -t" $?
nginx -s reload; sleep 1
c=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: admin.sogaebank.com' "http://127.0.0.1:$HTTP_PORT/")
[ "$c" != "200" ]; rec "3-2 홈 폴더 권한이 750 이면 운영 화면이 열리지 않음 (Ubuntu 24.04 기본값과 같은 조건)" $? "$c"
chmod o+x "$RH"
c=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: admin.sogaebank.com' "http://127.0.0.1:$HTTP_PORT/")
[ "$c" = "200" ]; rec "3-3 chmod o+x 뒤 운영 화면 200" $? "$c"

# 3-4 ~ 3-6 허용하지 않은 곳에서 오는 접속(사무실 밖) — 같은 설정을 「허용 IP = 10.9.9.9」로 한 벌 더 띄워(포트 8099) 이 PC(127.0.0.1)가 막히는지 봅니다
mkdir -p /var/www/html/.well-known/acme-challenge; echo "acme-ok" > /var/www/html/.well-known/acme-challenge/rehearsal-token
( cd "$RH" && bash "$RH/sgb/deploy/aws/nginx-render.sh" sogaebank.com admin.sogaebank.com 10.9.9.9 ) \
  | sed -e "s/listen 80;/listen 8099;\n  location ^~ \/.well-known\/acme-challenge\/ { root \/var\/www\/html; default_type text\/plain; }   # (리허설) 인증서 확인이 들어오는 길/" > /etc/nginx/sites-available/sgb-outside
ln -sf /etc/nginx/sites-available/sgb-outside /etc/nginx/sites-enabled/sgb-outside; nginx -t >/dev/null 2>&1 && nginx -s reload; sleep 1
o() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "http://127.0.0.1:8099$2"; }
a=$(o sogaebank.com /); b=$(o sogaebank.com /api/v1/health); c=$(o admin.sogaebank.com /); d=$(o admin.sogaebank.com /api/v1/health); e=$(o admin.sogaebank.com /assets/x.js)
[ "$a$b$c$d$e" = "403403403403403" ]; rec "3-4 허용하지 않은 IP 에서는 사용자 웹 · 그 API · 운영 화면 · 운영 API · 화면 파일이 전부 403" $? "$a $b $c $d $e"
f=$(o sogaebank.com /.well-known/acme-challenge/rehearsal-token); g=$(o admin.sogaebank.com /.well-known/acme-challenge/rehearsal-token)
[ "$f$g" = "200200" ]; rec "3-5 접근 제한 중에도 인증서 확인 길(/.well-known/acme-challenge/)은 열려 있음 — 발급 · 갱신이 막히지 않음" $? "$f $g"
( cd "$RH" && bash "$RH/sgb/deploy/aws/nginx-render.sh" sogaebank.com admin.sogaebank.com 10.9.9.9 open ) | sed -e "s/listen 80;/listen 8099;/" > /etc/nginx/sites-available/sgb-outside
nginx -t >/dev/null 2>&1 && nginx -s reload; sleep 1
a=$(o sogaebank.com /); c=$(o admin.sogaebank.com /); d=$(o admin.sogaebank.com /api/v1/health)
[ "$a$c$d" = "200403403" ]; rec "3-6 여는 날(open) — 사용자 웹만 열리고 운영 화면은 그대로 사무실만" $? "$a $c $d"
rm -f /etc/nginx/sites-enabled/sgb-outside /etc/nginx/sites-available/sgb-outside; nginx -s reload; sleep 1

echo "== 4. 적용 후 확인"
( cd "$RH" && SKIP_EGRESS_CHECK=1 bash "$RH/sgb/deploy/aws/postcheck.sh" ) > "$QA/aws_rehearsal_postcheck.txt" 2>&1
rec "4-1 postcheck — 실패 0" $? "$(grep -E '^적용 후 확인 —' "$QA/aws_rehearsal_postcheck.txt")"

echo "== 5. 화면 · 기능 (aws_rehearsal.py)"
( cd "$QA" && DB="$DBURL" APP="$RH/sgb" DATA="$RH/sgb-data" API_DIRECT="http://127.0.0.1:$API_PORT" SITE_DIRECT="http://localhost:$SITE_PORT" HTTP_PORT=$HTTP_PORT python3 aws_rehearsal.py > aws_rehearsal.log 2>&1 )
tail -1 "$QA/aws_rehearsal.log" | grep -Eq '^통과 ([0-9]+) / \1'; rec "5-1 화면 · 기능" $? "$(tail -1 "$QA/aws_rehearsal.log")"

echo "== 6. 운영 동작"
# 6-1 .env 를 고친 뒤 pm2 restart 만으로 반영되는가 (전에는 터미널에서 source 한 뒤 --update-env 가 필요했습니다)
sed -i 's/^DB_POOL_MAX=.*/DB_POOL_MAX=7/' "$RH/sgb/.env"; pm2 restart sgb >/dev/null 2>&1; wait_for health
pid=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s.slice(s.indexOf("[")));console.log(a.find(x=>x.name==="sgb").pid)})')
v=$(for p in $pid $(pgrep -P "$pid" 2>/dev/null) $(for q in $(pgrep -P "$pid" 2>/dev/null); do pgrep -P "$q"; done 2>/dev/null); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep '^DB_POOL_MAX='; done | sort -u | tr '\n' ' ')
[ "$v" = "DB_POOL_MAX=7 " ]; rec "6-1 .env 를 고치고 pm2 restart sgb 만 해도 새 값으로 뜸" $? "$v"
# 6-2 재부팅 흉내 — pm2 를 통째로 죽였다가 저장된 목록으로 되살림
pm2 kill >/dev/null 2>&1; sleep 1; health; [ $? != 0 ]; r1=$?
env -i HOME="$HOME" PM2_HOME="$PM2_HOME" PATH="$PATH" pm2 resurrect >/dev/null 2>&1
wait_for health && wait_for site_up; r2=$?
[ $r1 = 0 ] && [ $r2 = 0 ] && [ "$(st sgb-jobs)" = "online" ]; rec "6-2 재부팅 흉내(환경 값 없는 셸에서 pm2 resurrect) — 셋 다 다시 뜸" $? "$(st sgb) $(st sgb-site) $(st sgb-jobs)"
# 6-3 되돌리기 — 전 판(9/30 · API 만)
bash "$RH/sgb/deploy/aws/rollback.sh" > "$QA/aws_rehearsal_rollback.txt" 2>&1; rb=$?
c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/v1/community/polls?scope=home")
[ $rb = 0 ] && health && [ "$c" = "404" ] && [ "$(st sgb-site)" = "none" ] && [ ! -f "$RH/sgb/VERSION" ] && [ "$(psql "$DBURL" -tAc 'select count(*) from schema_migrations')" = "$NMIG" ]; rec "6-3 rollback — 전 판 API 로 복귀(투표 주소 404 = 전 판) · DB 는 그대로 $NMIG" $? "$(tail -1 "$QA/aws_rehearsal_rollback.txt") · polls $c · 마이그레이션 $(psql "$DBURL" -tAc 'select count(*) from schema_migrations')"
# 6-4 다시 앞으로 — 새 판 폴더의 rollback.sh 를 한 번 더(직전 판 = 새 판)
bash "$(cat "$RH/sgb-data/previous")/deploy/aws/rollback.sh" >> "$QA/aws_rehearsal_rollback.txt" 2>&1; rf=$?
wait_for site_up
c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/v1/community/polls?scope=home")
[ $rf = 0 ] && [ "$c" = "200" ] && [ "$(cat "$RH/sgb/VERSION")" = "$VER" ] && [ "$(st sgb-site)" = "online" ] && [ "$(st sgb-jobs)" = "online" ]; rec "6-4 다시 새 판으로 — 셋 다 online" $? "polls $c · $(cat "$RH/sgb/VERSION" 2>/dev/null)"
# 6-5 한 번 더 적용 (올릴 마이그레이션 0 · 바로가기 상태에서)
votes=$(psql "$DBURL" -tAc 'select count(*) from poll_votes'); files=$(find "$RH/sgb-data/uploads" -type f | wc -l)
( cd "$RH" && SKIP_EGRESS_CHECK=1 ASSUME_YES=1 bash "$RH/$NEWDIR/sgb/deploy/aws/apply.sh" ) > "$QA/aws_rehearsal_apply2.txt" 2>&1; a2=$?
[ $a2 = 0 ] && grep -q '올릴 것이 없습니다' "$QA/aws_rehearsal_apply2.txt" && [ "$(ls -d "$RH"/sgb-releases/${VER}_* | wc -l)" = "2" ] \
  && [ "$(psql "$DBURL" -tAc 'select count(*) from poll_votes')" = "$votes" ] && [ "$(find "$RH/sgb-data/uploads" -type f | wc -l)" = "$files" ] && [ "$files" -ge 1 ]
rec "6-5 한 번 더 apply — 올릴 것 0 · 표 · 올린 파일 그대로 · postcheck 실패 0" $? "$(grep -E '^적용 후 확인 —' "$QA/aws_rehearsal_apply2.txt") · 표 $votes · 파일 $files"
grep -E '^적용 후 확인 —' "$QA/aws_rehearsal_apply2.txt" | sed 's/^/        /'
# 6-6 개발용 값이 든 .env 로는 올리지 않음
cp "$RH/sgb/.env" /tmp/_env.bak; sed -i 's/^JWT_SECRET=.*/JWT_SECRET=docker-dev-jwt-secret-0123456789abcdef/' "$RH/sgb/.env"
( cd "$RH" && SKIP_EGRESS_CHECK=1 ASSUME_YES=1 bash "$RH/$NEWDIR/sgb/deploy/aws/apply.sh" ) > "$QA/aws_rehearsal_apply3.txt" 2>&1; a3=$?
cp /tmp/_env.bak "$RH/sgb/.env"; rm -f /tmp/_env.bak
[ $a3 != 0 ] && grep -q '개발용 값이 남아' "$QA/aws_rehearsal_apply3.txt" && health; rec "6-6 .env 에 개발용 비밀값이 있으면 apply 가 멈춤 · 돌던 서비스는 그대로" $? "$(grep '멈춥니다' "$QA/aws_rehearsal_apply3.txt")"

# 6-7 새 판이 뜨지 못할 때 — API 포트를 **다른 이름의 pm2 프로세스**(전 판)가 쥐고 있는 경우: 주소는 답하지만 새 프로세스는 계속 죽습니다.
#     apply 가 이것을 「떴다」고 보지 않고 실패로 끝내며, 바로가기를 적용 전 판으로 되돌리는지 봅니다.
OLD09=$(ls -d "$RH"/sgb-releases/prev_* | head -1); before=$(readlink -f "$RH/sgb")
pm2 delete sgb >/dev/null 2>&1
( cd "$OLD09" && set -a && . ./.env && set +a && pm2 start ./start.sh --name legacy-api --interpreter bash >/dev/null 2>&1 ); wait_for health
( cd "$RH" && SKIP_EGRESS_CHECK=1 ASSUME_YES=1 bash "$RH/$NEWDIR/sgb/deploy/aws/apply.sh" ) > "$QA/aws_rehearsal_apply4.txt" 2>&1; a4=$?
after=$(readlink -f "$RH/sgb")
[ $a4 != 0 ] && grep -q '전 판으로 되돌렸습니다' "$QA/aws_rehearsal_apply4.txt" && [ "$after" = "$before" ] && health
rec "6-7 포트를 다른 프로세스가 쥐고 있으면 apply 가 「떴다」고 보지 않음 — 실패로 끝나고 바로가기를 적용 전 판으로 되돌림" $? "종료 $a4 · $(grep -E 'pm2: sgb=' "$QA/aws_rehearsal_apply4.txt" | tr -s ' ' | cut -c1-80)"
pm2 delete legacy-api >/dev/null 2>&1; pm2 restart sgb sgb-site >/dev/null 2>&1; wait_for health; wait_for site_up
c=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/v1/community/polls?scope=home")
[ "$c" = "200" ]; rec "6-8 그 프로세스를 내리고 pm2 restart — 새 판이 다시 서비스" $? "polls $c"

# 6-9 예전 Nginx 방식(X-Forwarded-For 에 덧붙이기)이었다면 — 지어낸 주소로 하루 한도를 넘길 수 있었음을 같은 서버로 보여 줍니다
#     (서버는 이 헤더의 **첫 값**을 접속자 IP 로 봅니다. 덧붙이기는 접속자가 보낸 값을 맨 앞에 그대로 둡니다)
printf '%s\n' 'server {' '  listen 8098;' '  server_name sogaebank.com;' '  location / {' \
  "    proxy_pass http://127.0.0.1:$SITE_PORT;" '    proxy_set_header Host $http_host;' '    proxy_set_header X-Forwarded-Host $http_host;' \
  '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' '  }' '}' > /etc/nginx/sites-available/sgb-oldxff
ln -sf /etc/nginx/sites-available/sgb-oldxff /etc/nginx/sites-enabled/sgb-oldxff; nginx -t >/dev/null 2>&1 && nginx -s reload; sleep 1
PID=$(psql "$DBURL" -tAc "select id from polls where title like '리허설 %' order by created_at desc limit 1"); PO=$(psql "$DBURL" -tAc "select id from poll_options where poll_id='$PID' order by sort limit 1")
LIM=$(psql "$DBURL" -tAc "select value from site_settings where key='poll.guest_ip_daily_limit'"); UAS='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
v0=$(psql "$DBURL" -tAc "select count(*) from poll_votes where poll_id='$PID'"); okc=0
for i in 1 2 3 4; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -A "$UAS" -H 'Host: sogaebank.com' -H "X-Forwarded-For: 203.0.113.$i" -H 'content-type: application/json' --data "{\"optionId\":\"$PO\"}" "http://127.0.0.1:8098/api/v1/community/polls/$PID/vote")
  if [ "$c" = "201" ] || [ "$c" = "200" ]; then okc=$((okc+1)); fi
done
v1=$(psql "$DBURL" -tAc "select count(*) from poll_votes where poll_id='$PID'")
rm -f /etc/nginx/sites-enabled/sgb-oldxff /etc/nginx/sites-available/sgb-oldxff; nginx -s reload
[ -n "$PID" ] && [ "$v0" -ge "$LIM" ] && [ "$okc" = "4" ] && [ "$v1" = "$((v0+4))" ]; rec "6-9 (대조) 덧붙이기 방식의 Nginx 였다면 한도(${LIM}표)를 넘겨 4표가 더 들어감 — 그래서 예시 설정은 remote_addr 로 덮어씀" $? "한도에 걸린 투표 ${v0}표 → ${v1}표 (지어낸 주소 4개 전부 통과)"

python3 -c 'import json,sys; json.dump({"items": [json.loads(l) for l in open(sys.argv[1] + ".l", encoding="utf-8", errors="replace") if l.strip()]}, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)' "$OPS"; rm -f "$OPS.l"
echo
echo "운영 방식 리허설 — 통과 $((N - NBAD)) / $N"
