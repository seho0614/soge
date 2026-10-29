#!/usr/bin/env bash
# 저장소 3개(sgb-infra + sgb-core + sgb-adx)를 합쳐 kit(zip + tar.gz)을 만듭니다.
#   bash ~/make-kit.sh              각 저장소의 기본 브랜치로
#   bash ~/make-kit.sh feature/이름  그 갈래가 있는 저장소는 그 갈래로 (없으면 기본 브랜치)
set -euo pipefail
REF="${1:-}"
defbr(){ git ls-remote --symref origin HEAD 2>/dev/null | sed -n 's@^ref: refs/heads/\([^[:space:]]*\).*@\1@p'; }
pick(){ cd ~/sogaebank/$1 && git fetch -q origin
  if [ -n "$REF" ] && git rev-parse -q --verify "origin/$REF" >/dev/null; then echo "origin/$REF"; else b=$(defbr); echo "origin/${b:-main}"; fi; }
RI=$(pick sgb-infra); RC=$(pick sgb-core); RA=$(pick sgb-adx)
V=$(cd ~/sogaebank/sgb-core && git show "$RC:VERSION" | tr -d '[:space:]')
N="SGB_DevDocker_Integrated_20261002_${V//./_}"
OUT=~/kits/out; W=$(mktemp -d); mkdir -p "$OUT" "$W/$N/sgb" "$W/$N/sgb-ads"
(cd ~/sogaebank/sgb-infra && git archive "$RI" | tar -x -C "$W/$N")
(cd ~/sogaebank/sgb-core  && git archive "$RC" | tar -x -C "$W/$N/sgb")
(cd ~/sogaebank/sgb-adx   && git archive "$RA" | tar -x -C "$W/$N/sgb-ads")
# 2026-10-19 — realcheck 결과 파일 머리에 어느 커밋으로 만든 kit 인지 찍습니다(realcheck.ps1 이 읽음)
printf "core %s infra %s adx %s made %s\n" "$(cd ~/sogaebank/sgb-core && git rev-parse --short "$RC")" "$(cd ~/sogaebank/sgb-infra && git rev-parse --short "$RI")" "$(cd ~/sogaebank/sgb-adx && git rev-parse --short "$RA")" "$(date +%m%d-%H%M)" > "$W/$N/KIT_COMMITS.txt"
if find "$W/$N" \( -name .env -o -name '*.pem' -o -name '*.key' \) | grep -q .; then echo "[중단] 비밀 파일이 들어 있음"; rm -rf "$W"; exit 1; fi
(cd "$W" && tar -czf "$OUT/$N.tar.gz" "$N")
python3 - "$W" "$N" "$OUT/$N.zip" <<'PY'
import os, sys, zipfile
w, n, out = sys.argv[1:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, ds, fs in os.walk(os.path.join(w, n)):
        for f in sorted(fs):
            p = os.path.join(root, f); z.write(p, os.path.relpath(p, w))
PY
rm -rf "$W"
echo "[만듦] $V  (infra $RI · core $RC · adx $RA)"
ls -l "$OUT/$N".*
