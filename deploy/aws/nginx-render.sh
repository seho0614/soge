#!/usr/bin/env bash
# =====================================================================
# Nginx 설정 만들기 — 예시 파일의 네 자리를 채워 **화면에 찍습니다**(파일은 건드리지 않습니다).
#
#   bash ~/sgb/deploy/aws/nginx-render.sh  <사용자 웹 주소>  <운영 화면 주소>  <사무실 IP>[,<IP>…]  [open]
#
#   예) bash ~/sgb/deploy/aws/nginx-render.sh sogaebank.com admin.sogaebank.com 203.0.113.10 | sudo tee /etc/nginx/sites-available/sgb
#
#   · 사무실 IP 는 쉼표로 여럿 넣을 수 있습니다 (집 · 사무실). 내 IP 는 PC 에서 https://checkip.amazonaws.com 을 열면 나옵니다.
#   · 끝에 open 을 붙이면 **사용자 웹의 접근 제한을 뺍니다**(여는 날). 운영 화면은 늘 사무실 IP 만입니다.
#     ★ 이미 인증서(certbot)가 붙은 파일을 다시 덮으면 인증서 줄이 사라집니다 — 여는 날에는 파일을 열어 사용자 웹의 allow · deny 줄만 지우십시오.
#   · 포트는 .env 의 PORT(기본 3000) · SITE_PORT(기본 5174)를 따릅니다.
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
APP_LINK="${APP_LINK:-$HOME/sgb}"
DOMAIN="${1:-}"; ADMIN="${2:-}"; IPS="${3:-}"; MODE="${4:-closed}"
usage() { sed -n '4,12p' "$0" | sed 's/^# \{0,3\}//' >&2; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$ADMIN" ] && [ -n "$IPS" ] || usage
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] && [[ "$ADMIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo "!! 주소 형식이 아닙니다 (https:// 없이 sogaebank.com 처럼)" >&2; exit 1; }
[ "$DOMAIN" != "$ADMIN" ] || { echo "!! 사용자 웹과 운영 화면 주소가 같습니다 — 운영 화면은 다른 주소(admin.…)여야 합니다" >&2; exit 1; }
ALLOW=""
IFS=',' read -ra arr <<< "$IPS"
for ip in "${arr[@]}"; do
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]] || { echo "!! IP 형식이 아닙니다: $ip" >&2; exit 1; }
  ALLOW="${ALLOW}    allow ${ip};\n"
done
[ "$MODE" = "open" ] || [ "$MODE" = "closed" ] || usage
load_env "$APP_LINK/.env" 2>/dev/null || true
API_PORT="${PORT:-3000}"; S_PORT="${SITE_PORT:-5174}"
awk -v dom="$DOMAIN" -v adm="$ADMIN" -v app="$APP_LINK" -v allow="$ALLOW" -v mode="$MODE" -v ap="$API_PORT" -v sp="$S_PORT" '
  /^# ── 사용자 웹/ { blk = "site" }
  /^# ── 운영 화면/ { blk = "admin" }
  /^#/ && !started { next }                                  # 머리말 주석은 빼고
  { started = 1 }
  blk == "site" && mode == "open" && /열기 전\(간주 모드/ { print "    # (열었습니다 — 접근 제한 없음)"; next }
  /allow __OFFICE_IP__;/ { if (blk == "site" && mode == "open") { skip = 2; next } printf "%s", allow; next }
  skip == 2 && /deny all;/ { skip = 1; next }
  skip == 1 && /^[[:space:]]*$/ { skip = 0; next }
  { skip = 0; gsub(/__DOMAIN__/, dom); gsub(/__ADMIN_DOMAIN__/, adm); gsub(/__APP__/, app)
    gsub(/127\.0\.0\.1:5174/, "127.0.0.1:" sp); gsub(/127\.0\.0\.1:3000/, "127.0.0.1:" ap); print }
' "$HERE/nginx-sgb.conf.example"
