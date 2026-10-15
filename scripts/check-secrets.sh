#!/usr/bin/env bash
# =====================================================================
# 비밀값 유출 점검
#
# 키가 코드·문서·생성물에 섞여 들어가는 것은 사고가 난 뒤에야 발견됩니다.
# 커밋 전에 기계가 봅니다.
#
# 보는 것 셋:
#   1) .env 가 커밋 대상인가
#   2) .env 의 값이 다른 파일에 그대로 있는가
#   3) 키처럼 생긴 문자열이 소스에 박혀 있는가
#
# 실행:  bash scripts/check-secrets.sh
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
ng=0; ok=0

say_ok()  { printf "  안전  %s\n" "$1"; ok=$((ok+1)); }
say_ng()  { printf "  ▲위험 %s\n" "$1"; ng=$((ng+1)); }

EXCL="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.dev-db --exclude-dir=.next --exclude=*.log"

echo "== 1. .env 커밋 여부 =="
if grep -qE '^\.env$' .gitignore 2>/dev/null; then
  say_ok ".env 가 .gitignore 에 있음"
else
  say_ng ".env 가 .gitignore 에 없습니다 — 커밋되면 키가 이력에 영구히 남습니다"
fi

if [ -f .env ] && git rev-parse --git-dir >/dev/null 2>&1; then
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then
    say_ng ".env 가 이미 git 에 추적되고 있습니다 — git rm --cached .env"
  else
    say_ok ".env 가 git 에 추적되지 않음"
  fi
fi

echo
echo "== 2. .env 값이 다른 파일에 있는가 =="
if [ -f .env ]; then
  leaked=0
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue;; esac
    v="${v%\"}"; v="${v#\"}"
    # 짧은 값은 우연히 일치할 수 있으므로 20자 이상만 봅니다
    [ ${#v} -lt 20 ] && continue
    # 예시용 기본값은 건너뜁니다
    case "$v" in *dev-only*|*localhost*|*change-me*|*sgb-dev*) continue;; esac
    hits=$(grep -rl -F "$v" . $EXCL --exclude=.env 2>/dev/null | sed 's|^\./||')
    if [ -n "$hits" ]; then
      say_ng "$k 의 값이 다음 파일에 있습니다: $(echo "$hits" | tr '\n' ' ')"
      leaked=1
    fi
  done < .env
  [ $leaked -eq 0 ] && say_ok ".env 값이 다른 파일에 없음"
else
  say_ok ".env 없음 (검사 생략)"
fi

echo
echo "== 3. 소스에 박힌 키 형태 =="
# 32자 이상 16진수, Base64 형태의 긴 문자열
PAT='[0-9a-f]{40,}|[A-Za-z0-9+/]{40,}={0,2}'
# URL 경로가 길면 키로 오인합니다. Daum 우편번호 스크립트 주소가 그랬습니다.
# 긴 import 경로(파트너센터 정산 계좌 폼)도 그랬습니다(20261002).
# 감시가 헛짚으면 운영이 무시하기 시작하고, 그러면 진짜 노출도 함께 지나갑니다 —
# 위험감지 규칙의 오탐률을 따로 보는 것과 같은 이유입니다.
found=$(grep -rEn "$PAT" src/ web/src/ site/src/ scripts/ $EXCL 2>/dev/null \
  | grep -vE 'REPEAT|placeholder|example|dummy|test|\.test\.|sha256|hash|checksum|token_hash|uuid' \
  | grep -vE 'https?://' \
  | grep -vE "from '(@/|\\.)" \
  | head -5)
if [ -n "$found" ]; then
  say_ng "키처럼 보이는 문자열이 소스에 있습니다"
  echo "$found" | sed 's/^/        /'
else
  say_ok "소스에 박힌 키 없음"
fi

echo
# JOB_TOKEN 이 소스에 박히면 아무나 배치를 부를 수 있습니다.
# 배치는 청구·개인정보 파기를 돌리므로 특히 위험합니다.
# 생성해서 넣는 것($(...))은 하드코딩이 아닙니다 —
# 그것까지 잡으면 "안전하게 만드는 코드"가 위험으로 보고됩니다.
n=$(grep -rn "JOB_TOKEN\s*=\s*['\"][^'\"]\{8,\}" src/ scripts/ web/src/ site/src/ 2>/dev/null \
    | grep -v "process.env" \
    | grep -v '\$(' \
    | grep -v '\${' \
    | wc -l)
if [ "$n" -eq 0 ]; then echo "  안전  JOB_TOKEN 하드코딩 없음"; ok=$((ok+1));
else echo "  ▲위험 JOB_TOKEN 이 소스에 있습니다 (${n}건)"; ng=$((ng+1)); fi

echo "== 4. 외부 연동 키는 환경변수로만 =="
# 연동 키를 DB 에 넣으면 덤프·백업·로그로 새어 나갑니다.
if [ -n "${DATABASE_URL:-}" ]; then
  n=$(psql "$DATABASE_URL" -t -A -c \
      "SELECT count(*) FROM site_settings WHERE value ~ '^[0-9a-fA-F]{32,}$';" 2>/dev/null || echo 0)
  if [ "${n:-0}" = "0" ]; then
    say_ok "site_settings 에 키 형태 값 없음"
  else
    say_ng "site_settings 에 키로 보이는 값 ${n}건 — 환경변수로 옮기십시오"
  fi
else
  echo "  건너뜀 DATABASE_URL 없음"
fi

echo
echo "======================================================="
printf "안전 %d · ▲위험 %d\n" $ok $ng
[ $ng -eq 0 ]
