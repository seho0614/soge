#!/usr/bin/env bash
# =====================================================================
# 운영 화면 허용 IP 를 Nginx include 파일로 옮기기 — 처음 한 번만 (v10.348 · docs/482)
#
#   bash ~/sgb/deploy/aws/nginx-admin-allow-setup.sh admin.sogaebank.com            # 미리 보기(아무것도 바꾸지 않음)
#   bash ~/sgb/deploy/aws/nginx-admin-allow-setup.sh admin.sogaebank.com --apply    # 바꾸기(sudo 를 물음)
#
#   · /etc/nginx/sites-enabled/sgb 의 운영 화면 server 블록 안 allow · deny 줄을
#     `include /etc/nginx/snippets/sgb-admin-allow.conf;` 한 줄로 바꾸고, 지금 IP 를 그 파일로 옮깁니다(허용 IP 는 그대로).
#   · 사용자 웹 블록 · 인증서 줄은 건드리지 않습니다. 사이트 파일은 sgb.bak-allow-<시각> 으로 백업합니다.
#   · nginx -t 가 실패하면 백업으로 되돌리고 멈춥니다(Nginx 는 다시 읽지 않음).
#   · 이 뒤로는 운영 화면 › 권한 계층 › 접속 인증 › 「Nginx 반영」 스크립트로 허용 IP 를 바꿉니다.
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ADMIN="${1:-}"; MODE="${2:-}"
[[ "$ADMIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { sed -n '4,13p' "$0" | sed 's/^# \{0,3\}//' >&2; exit 1; }
SITE="$(readlink -f /etc/nginx/sites-enabled/sgb)"
INC=/etc/nginx/snippets/sgb-admin-allow.conf
[ -f "$SITE" ] || { echo "!! $SITE 가 없습니다" >&2; exit 1; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
OUT="$(python3 "$HERE/nginx_admin_allow_edit.py" "$SITE" "$ADMIN" "$T/sgb" "$T/allow.conf")"; RC=$?
echo "$OUT"
[ $RC -eq 0 ] || { echo "!! 멈춤 — 출력을 Claude 에게 보내 주십시오" >&2; exit 1; }
if [ "$OUT" = "RESULT READY" ]; then echo "== 이미 준비되어 있습니다(include 있음). 운영 화면 「Nginx 반영」 스크립트를 쓰십시오."; exit 0; fi
echo "== 사이트 파일 바뀌는 곳 (- 지금 · + 바꾼 뒤)"; diff -u "$SITE" "$T/sgb" | sed -n '3,200p'
echo "== 새 허용 파일 $INC"; cat "$T/allow.conf"
if [ "$MODE" != "--apply" ]; then echo "== 미리 보기만 했습니다. 위가 맞으면 끝에 --apply 를 붙여 다시 치십시오."; exit 0; fi
BAK="$SITE.bak-allow-$(date +%Y%m%d-%H%M%S)"
sudo cp -p "$SITE" "$BAK" && echo "백업 $BAK"
sudo mkdir -p /etc/nginx/snippets
sudo install -m 644 "$T/allow.conf" "$INC"
sudo install -m 644 "$T/sgb" "$SITE"
if sudo nginx -t; then
  sudo systemctl reload nginx && echo "== 준비 끝 — Nginx 를 다시 읽었습니다. 운영 화면이 열리는지 확인하십시오(Ctrl + F5)."
else
  echo "!! nginx -t 실패 — 되돌립니다"; sudo cp -p "$BAK" "$SITE"; sudo rm -f "$INC"; sudo nginx -t && echo "되돌림 끝(Nginx 는 다시 읽지 않았음). 출력을 Claude 에게 보내 주십시오."; exit 1
fi
