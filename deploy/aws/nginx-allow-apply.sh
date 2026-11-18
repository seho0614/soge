#!/usr/bin/env bash
# =====================================================================
# 운영 화면 허용 IP 적용 — 루트 감시 서비스가 부르는 스크립트 (v10.348 · docs/482)
#
#   설치하면 /usr/local/sbin/sgb-nginx-allow-apply 로 복사됩니다(root 소유 · ubuntu 는 고칠 수 없음).
#   systemd sgb-nginx-allow.path 가 요청 파일이 바뀌면 sgb-nginx-allow.service 로 이것을 부릅니다.
#   운영 화면 「적용」 → 프로그램(ubuntu)이 요청 파일만 씀 → 여기서 다시 검사 → 허용 파일 교체 → nginx -t → 다시 읽기 · 실패면 되돌림.
#   · 요청 글은 실행하지 않습니다. allow <IP>; 와 deny all; 줄만 받고, 메모(# 뒤)는 버립니다. 링크 · 큰 파일 · 모르는 줄이 있으면 거절.
#   · 결과는 root 폴더 /var/lib/sgb-nginx-allow/result.json(정해진 글만 · 요청 내용은 적지 않음) — 운영 화면이 읽습니다.
# =====================================================================
set -uo pipefail
REQ="${SGB_ALLOW_REQ:-/home/ubuntu/sgb-state/nginx-allow/request.conf}"
DST="${SGB_ALLOW_FILE:-/etc/nginx/snippets/sgb-admin-allow.conf}"
SITE="${SGB_ALLOW_SITE:-/etc/nginx/sites-enabled/sgb}"
OUT="${SGB_ALLOW_OUT:-/var/lib/sgb-nginx-allow}"
NGINX="${SGB_NGINX:-nginx}"; RELOAD="${SGB_RELOAD:-systemctl reload nginx}"
ID="-"; HASH="-"
result() {   # $1 ok(true/false) $2 정해진 글
  local t; t="$(mktemp "$OUT/.r.XXXXXX")" || exit 1
  printf '{"id":"%s","hash":"%s","ok":%s,"at":"%s","message":"%s"}\n' "$ID" "$HASH" "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" > "$t"
  chmod 644 "$t"; mv -f "$t" "$OUT/result.json"
}
ip_ok() {
  local ip="$1" o
  if [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
    for o in "${BASH_REMATCH[@]:1}"; do [ "$o" -le 255 ] || return 1; done; return 0
  fi
  [[ "$ip" =~ ^[0-9a-fA-F:]{2,39}$ ]] && [[ "$ip" == *:*:* ]]
}
mkdir -p "$OUT"
[ -e "$REQ" ] || exit 0
if [ -L "$REQ" ] || [ ! -f "$REQ" ]; then result false "요청 파일이 일반 파일이 아님 — 거절"; exit 1; fi
[ "$(stat -c %s "$REQ")" -le 20000 ] || { result false "요청 파일이 너무 큼 — 거절"; exit 1; }
grep -q "include $DST;" "$SITE" || { result false "준비가 안 됨 — nginx-admin-allow-setup.sh --apply 먼저"; exit 1; }
HEAD="$(head -n 1 "$REQ")"
if [[ "$HEAD" =~ ^#\ sgb-admin-allow\ ([0-9a-f]{12})\ id=([0-9A-Za-z-]{8,40})$ ]]; then HASH="${BASH_REMATCH[1]}"; ID="${BASH_REMATCH[2]}"
else result false "요청 첫 줄 모양이 아님 — 거절"; exit 1; fi
NEW="$(mktemp)"; trap 'rm -f "$NEW"' EXIT
echo "# sgb-admin-allow $HASH id=$ID — 운영 화면 › 권한 계층 › 접속 인증 「적용」(손으로 고치지 마십시오)" > "$NEW"
N=0; DENY=0
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"; line="${line%"${line##*[![:space:]]}"}"; line="${line#"${line%%[![:space:]]*}"}"
  [ -z "$line" ] && continue
  ip=""; [[ "$line" =~ ^allow\ ([0-9A-Fa-f:.]+)\;$ ]] && ip="${BASH_REMATCH[1]}"
  if [ -n "$ip" ] && ip_ok "$ip"; then echo "allow $ip;" >> "$NEW"; N=$((N + 1))
  elif [ "$line" = "deny all;" ]; then DENY=1
  else result false "모르는 줄이 있음 — 거절"; exit 1; fi
done < <(tail -n +2 "$REQ")
[ "$N" -ge 1 ] && [ "$DENY" = 1 ] || { result false "허용 IP 가 없거나 deny all 이 없음 — 거절"; exit 1; }
echo "deny all;" >> "$NEW"
[ -f "$DST" ] && cp -p "$DST" "$DST.bak"
install -m 644 "$NEW" "$DST"
if $NGINX -t >/dev/null 2>&1; then
  $RELOAD && result true "반영함 — 허용 IP $N곳" && exit 0
  result false "다시 읽기 실패 — nginx 상태를 확인"; exit 1
fi
[ -f "$DST.bak" ] && cp -p "$DST.bak" "$DST"
result false "nginx -t 실패 — 옛 파일로 되돌림(Nginx 는 그대로)"; exit 1
