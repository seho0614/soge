#!/usr/bin/env bash
# CI(A안 · docs/271) — main 이 바뀌면 운영용 킷(zip + tar.gz)을 만들어 S3 에 둡니다. CodeBuild 「sgb-kit-build」가 부릅니다.
#   ~/make-kit.sh 와 같은 모양(sgb-infra 맨 위 · sgb/ = sgb-core · sgb-ads/ = sgb-adx · KIT_COMMITS.txt · 비밀 파일 있으면 중단)
#   두는 곳: s3://$KIT_BUCKET/kits/<판>/<만든 시각 KST>_<core 7자리>/  ← **덮어쓰지 않음**(절차서에 적은 sha256 이 바뀌지 않게)
#     안에 zip · tar.gz · SHA256SUMS.txt · KIT_COMMITS.txt
#   ★ 운영 서버에 올리지 않습니다 — 운영 반영은 지금처럼 사람이 precheck → 스냅샷 → apply → postcheck.
set -euo pipefail
: "${KIT_BUCKET:?}"
R=ap-northeast-2; W=$PWD/kitwork; rm -rf "$W"; mkdir -p "$W/repos"
git config --global credential.helper '!aws codecommit credential-helper $@'; git config --global credential.UseHttpPath true
for r in sgb-infra sgb-core sgb-adx; do git clone -q --branch main "https://git-codecommit.$R.amazonaws.com/v1/repos/$r" "$W/repos/$r"; done
V=$(tr -d '[:space:]' < "$W/repos/sgb-core/VERSION"); N="SGB_DevDocker_Integrated_20261002_${V//./_}"
mkdir -p "$W/$N/sgb" "$W/$N/sgb-ads"
git -C "$W/repos/sgb-infra" archive HEAD | tar -x -C "$W/$N"
git -C "$W/repos/sgb-core"  archive HEAD | tar -x -C "$W/$N/sgb"
git -C "$W/repos/sgb-adx"   archive HEAD | tar -x -C "$W/$N/sgb-ads"
C=$(git -C "$W/repos/sgb-core" rev-parse --short=7 HEAD)
printf "core %s infra %s adx %s made %s\n" "$C" "$(git -C "$W/repos/sgb-infra" rev-parse --short=7 HEAD)" "$(git -C "$W/repos/sgb-adx" rev-parse --short=7 HEAD)" "$(TZ=Asia/Seoul date +%m%d-%H%M)" > "$W/$N/KIT_COMMITS.txt"
if find "$W/$N" \( -name .env -o -name '*.pem' -o -name '*.key' \) | grep -q .; then echo "[중단] 비밀 파일이 들어 있음"; exit 1; fi
mkdir -p "$W/out"; (cd "$W" && tar -czf "out/$N.tar.gz" "$N")
python3 - "$W" "$N" "$W/out/$N.zip" <<'PY'
import os, sys, zipfile
w, n, out = sys.argv[1:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, ds, fs in os.walk(os.path.join(w, n)):
        ds.sort()
        for f in sorted(fs):
            p = os.path.join(root, f); z.write(p, os.path.relpath(p, w))
PY
cp "$W/$N/KIT_COMMITS.txt" "$W/out/"; (cd "$W/out" && sha256sum "$N.zip" "$N.tar.gz" > SHA256SUMS.txt)
DEST="s3://$KIT_BUCKET/kits/$V/$(TZ=Asia/Seoul date +%Y%m%d-%H%M)_$C/"
if aws s3 ls "$DEST" >/dev/null 2>&1; then echo "[중단] 이미 있음: $DEST (덮어쓰지 않음)"; exit 1; fi
aws s3 cp --recursive --only-show-errors "$W/out/" "$DEST"
echo "[만듦] $V → $DEST"; cat "$W/out/SHA256SUMS.txt"
