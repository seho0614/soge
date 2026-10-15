#!/usr/bin/env bash
# =====================================================================
# API 실행 — pm2 가 부릅니다 (프로세스 이름 sgb).
#
#   · 앱 폴더의 .env 를 **이 스크립트가 직접** 읽습니다. 그래서 .env 를 고친 뒤에는 `pm2 restart sgb` 만 하면 됩니다
#     (전에는 터미널에서 `set -a; source .env` 를 한 뒤 `--update-env` 를 붙여야 했고, 빠뜨리면 옛 값으로 떴습니다).
#   · 전에 만든 start.sh(Secrets Manager 에서 ENC_KEY 를 읽는 스크립트)가 있으면 **그것을 그대로** 부릅니다.
#   · 없으면 ENC_KEY 를 ① .env ② Secrets Manager(ENC_KEY_SECRET_ID · 기본 sgb/prod/enc-key) 순서로 찾고, 없으면 뜨지 않습니다.
#     (열쇠 없이 뜨면 서버는 멀쩡해 보이는데 정산 계좌 저장 · 리드 연락처만 실패합니다 — 절차서 v2.5 7-3-1)
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. deploy/aws/lib.sh
load_env .env || { echo "!! $(pwd)/.env 가 없습니다 — 서버를 띄우지 않습니다"; exit 1; }
export NODE_ENV="${NODE_ENV:-production}"
[ -f dist/main.js ] || { echo "!! dist/main.js 가 없습니다 — npm run build 를 먼저 하십시오"; exit 1; }

if [ -x ./start.sh ]; then
  echo "start.sh 로 띄웁니다 ($(pwd)/start.sh)"
  exec ./start.sh
fi

if [ -z "${ENC_KEY:-}" ] && command -v aws >/dev/null 2>&1; then
  sid="${ENC_KEY_SECRET_ID:-sgb/prod/enc-key}"
  ENC_KEY=$(aws secretsmanager get-secret-value --secret-id "$sid" --region "${AWS_REGION:-ap-northeast-2}" \
              --query SecretString --output text 2>/dev/null \
            | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.ENC_KEY??""))}catch{process.stdout.write(s.trim())}})' 2>/dev/null)
  export ENC_KEY
fi
if [ -z "${ENC_KEY:-}" ]; then
  echo "!! ENC_KEY 를 찾지 못했습니다 (.env 에도 없고 Secrets Manager 에서도 못 읽음) — 서버를 띄우지 않습니다"
  exit 1
fi
exec node dist/main.js
