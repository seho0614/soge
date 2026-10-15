#!/usr/bin/env bash
# =====================================================================
# 배포 꾸러미 만들기
#
# ── 왜 이 스크립트가 필요한가 ───────────────────────────────────────
# 손으로 zip 을 만들면 **docs/06_openapi.json 이 낡은 채로 들어갑니다.**
# 일곱 번 반복됐습니다. 받은 사람이 문서 검정을 돌리면 그때 드러납니다.
#
# 문서를 먼저 만들고, 확인하고, 그 다음에 담습니다.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# 문서는 미리 만들어 두십시오 — npm run docs (2~4분).
# 여기서 부르면 타임아웃에 걸려 "조용히 옛 문서로" 담깁니다.
echo "① 문서 확인 (npm run docs 를 먼저 돌리셨습니까)"


n=$(node -e "
const d=require('./docs/06_openapi.json');
let miss=0;
for(const v of Object.values(d.paths))
  for(const [m,o] of Object.entries(v))
    if(['get','post','patch','put','delete'].includes(m) && !o['x-status']) miss++;
console.log(miss);")
if [ "$n" != "0" ]; then
  # ★ 알려주기만 하면 매번 같은 실수를 반복합니다.
  #   `npm run docs` 는 여러 단계라 하나만 끊겨도 x-status 가 비고,
  #   그러면 여기서 막히는데 **원인이 멀어** 찾는 데 시간이 걸립니다.
  #   한 번 스스로 만들어 보고, 그래도 안 되면 그때 멈춥니다.
  echo "   .. x-status 누락 ${n}건 — 문서를 다시 만듭니다"
  npm run docs >/dev/null 2>&1 || true
  n=$(node -e "const d=require('./docs/06_openapi.json');
let miss=0;
for(const v of Object.values(d.paths))
  for(const [m,o] of Object.entries(v))
    if(['get','post','patch','put','delete'].includes(m) && !o['x-status']) miss++;
console.log(miss);")
fi
if [ "$n" != "0" ]; then
  echo "   ✗ x-status 누락 ${n}건 — 담지 않습니다"
  echo "     npm run docs 를 직접 돌려 무엇이 실패하는지 보십시오"
  exit 1
fi
echo "   ok  경로 $(node -e "console.log(Object.keys(require('./docs/06_openapi.json').paths).length)")개 · 누락 0"

echo "② 비밀값 확인"
bash scripts/check-secrets.sh >/dev/null 2>&1 || { echo "   ✗ 비밀값이 새고 있습니다"; exit 1; }
echo "   ok"

echo "③ 꾸러미"
OUT="${1:-/tmp/sgb-pack}"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -r . "$OUT/sgb"
cd "$OUT/sgb"
rm -rf node_modules web/node_modules site/node_modules site/.next web/dist .dev-db .env
cd "$OUT" && zip -qr sgb-integrated-kit.zip sgb
echo "   ok  $(du -h sgb-integrated-kit.zip | cut -f1)  → $OUT/sgb-integrated-kit.zip"
