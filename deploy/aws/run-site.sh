#!/usr/bin/env bash
# =====================================================================
# 사용자 웹(Next.js) 실행 — pm2 가 부릅니다 (프로세스 이름 sgb-site).
#
#   · 앱 폴더의 .env 를 읽습니다. 사이트가 쓰는 값은 넷입니다(없으면 아래 기본값).
#       API_ORIGIN    브라우저가 부르는 /api 를 넘길 곳          기본 http://127.0.0.1:<PORT>
#       API_BASE      서버 렌더 · 미들웨어가 직접 부르는 곳       기본 <API_ORIGIN>/api/v1
#       SITE_PORT     사이트 포트                               기본 5174
#       HOME_CONTENT  메인 내용 — live(실제 자료) · 빈 값(그림의 예시)   **운영 기본 live**
#     ★ 예시 평점 · 후기 수가 실제처럼 보이면 안 되므로, 운영에서는 .env 에 아무것도 안 적어도 live 로 뜹니다.
#       예시 그림 그대로 보려면(시연용) .env 에 HOME_CONTENT=sample 을 적으십시오.
#   · 127.0.0.1 에만 엽니다 — 바깥에서는 Nginx 를 거쳐서만 들어옵니다.
#   · 로그인 쿠키는 운영에서 Secure 입니다 — **https 주소(또는 localhost)에서만** 로그인이 유지됩니다.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. deploy/aws/lib.sh
load_env .env || { echo "!! $(pwd)/.env 가 없습니다 — 사이트를 띄우지 않습니다"; exit 1; }
export API_ORIGIN="${API_ORIGIN:-http://127.0.0.1:${PORT:-3000}}"
export API_BASE="${API_BASE:-${API_ORIGIN%/}/api/v1}"
export HOME_CONTENT="${HOME_CONTENT:-live}"
[ "$HOME_CONTENT" = "sample" ] && export HOME_CONTENT=""
SITE_PORT="${SITE_PORT:-5174}"
unset PORT                                  # .env 의 PORT 는 API 포트입니다 — next 가 집어 가지 않게
cd site || exit 1
[ -f .next/BUILD_ID ] || { echo "!! site/.next 가 없습니다 — (cd site && npm run build) 를 먼저 하십시오"; exit 1; }
exec node_modules/.bin/next start -p "$SITE_PORT" -H 127.0.0.1
