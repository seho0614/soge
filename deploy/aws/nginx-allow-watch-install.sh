#!/usr/bin/env bash
# =====================================================================
# 운영 화면 「적용」 단추용 감시 서비스 설치 — 처음 한 번만 (v10.348 · docs/482)
#
#   bash ~/sgb/deploy/aws/nginx-allow-watch-install.sh            # 무엇을 설치할지 보여 주기만
#   bash ~/sgb/deploy/aws/nginx-allow-watch-install.sh --apply    # 설치(sudo 를 물음)
#
#   · 먼저 nginx-admin-allow-setup.sh --apply 로 include 를 만든 뒤에 합니다.
#   · /usr/local/sbin/sgb-nginx-allow-apply(root 소유 복사본) · systemd sgb-nginx-allow.path / .service ·
#     요청 폴더 ~/sgb-state/nginx-allow(ubuntu) · 결과 폴더 /var/lib/sgb-nginx-allow(root · 읽기만 공개)
#   · 웹 프로그램에는 sudo 를 주지 않습니다. 끄기: sudo systemctl disable --now sgb-nginx-allow.path
#   · v10.353 — 막힌 접속 요약 타이머 sgb-nginx-deny.timer(10분 · /usr/local/sbin/sgb-nginx-deny-summary). 이미 설치한 서버도 이 판 뒤 한 번 더 칩니다(덮어써도 됨).
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
U="$(id -un)"; H="$(eval echo "~$U")"
REQDIR="$H/sgb-state/nginx-allow"
grep -q 'include /etc/nginx/snippets/sgb-admin-allow.conf;' "$(readlink -f /etc/nginx/sites-enabled/sgb)" || { echo "!! 먼저 bash ~/sgb/deploy/aws/nginx-admin-allow-setup.sh admin.sogaebank.com --apply" >&2; exit 1; }
UNIT_PATH="[Unit]
Description=sgb admin allow IP request watch (v10.348)
[Path]
PathChanged=$REQDIR/request.conf
Unit=sgb-nginx-allow.service
[Install]
WantedBy=multi-user.target"
UNIT_SVC="[Unit]
Description=sgb admin allow IP apply (v10.348)
[Service]
Type=oneshot
Environment=SGB_ALLOW_REQ=$REQDIR/request.conf
ExecStart=/usr/local/sbin/sgb-nginx-allow-apply"
UNIT_DSVC="[Unit]
Description=sgb admin denied access summary (v10.353)
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -I /usr/local/sbin/sgb-nginx-deny-summary"
UNIT_DTMR="[Unit]
Description=sgb admin denied access summary every 10 min (v10.353)
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target"
echo "== 설치할 것"; echo "  /usr/local/sbin/sgb-nginx-allow-apply  ← $HERE/nginx-allow-apply.sh (root 755)"
echo "  /usr/local/sbin/sgb-nginx-deny-summary  ← $HERE/nginx_deny_summary.py (root 755) · systemd sgb-nginx-deny.service / .timer(10분)"
echo "  /etc/systemd/system/sgb-nginx-allow.path · .service"; echo "  요청 폴더 $REQDIR ($U) · 결과 폴더 /var/lib/sgb-nginx-allow (root)"
echo "--- sgb-nginx-allow.path"; echo "$UNIT_PATH"; echo "--- sgb-nginx-allow.service"; echo "$UNIT_SVC"
[ "${1:-}" = "--apply" ] || { echo "== 보여 주기만 했습니다. 맞으면 --apply 를 붙여 다시 치십시오."; exit 0; }
mkdir -p "$REQDIR" && chmod 700 "$REQDIR"
sudo install -o root -g root -m 755 "$HERE/nginx-allow-apply.sh" /usr/local/sbin/sgb-nginx-allow-apply
echo "$UNIT_PATH" | sudo tee /etc/systemd/system/sgb-nginx-allow.path >/dev/null
echo "$UNIT_SVC" | sudo tee /etc/systemd/system/sgb-nginx-allow.service >/dev/null
sudo install -d -o root -g root -m 755 /var/lib/sgb-nginx-allow
date -u +%Y-%m-%dT%H:%M:%SZ | sudo tee /var/lib/sgb-nginx-allow/installed >/dev/null
sudo install -o root -g root -m 755 "$HERE/nginx_deny_summary.py" /usr/local/sbin/sgb-nginx-deny-summary
echo "$UNIT_DSVC" | sudo tee /etc/systemd/system/sgb-nginx-deny.service >/dev/null
echo "$UNIT_DTMR" | sudo tee /etc/systemd/system/sgb-nginx-deny.timer >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now sgb-nginx-allow.path && sudo systemctl enable --now sgb-nginx-deny.timer
systemctl is-active sgb-nginx-allow.path sgb-nginx-deny.timer && echo "== 설치 끝 — 운영 화면 › 권한 계층 › 접속 인증 › 「Nginx 반영」에 「적용」 단추가 열립니다."
