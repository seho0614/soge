#!/usr/bin/env bash
# CI(A안 · docs/271) — 풀 리퀘스트 자동 점검. CodeBuild 「sgb-pr-check」가 부릅니다.
#   받는 값(EventBridge → CodeBuild 환경 변수): REPO · PR_ID — 커밋 · 판 번호(revision)는 실행할 때 풀 리퀘스트에서 읽음
#   sgb-core : 형 검사(API · 사용자 웹 · 운영 화면) · 빈 PostgreSQL 16 에 마이그레이션 2번 · npm run verify(불변식 · 시험 안전 · 오류 코드 · 권한 · SQL)
#   sgb-infra: qa 파이썬 문법 · 셸 문법
#   끝나면 풀 리퀘스트에 결과 댓글 · 통과면 승인(APPROVE) · 실패면 승인 거둠(REVOKE) — 승인 규칙 「sgb-ci-must-pass」가 이 승인을 봄
#   ★ 이 스크립트는 운영 서버 · 운영 DB 에 닿지 않습니다(버리는 컨테이너 DB 만).
set -uo pipefail
: "${REPO:?}" "${PR_ID:?}"
R=ap-northeast-2
read -r STATUS SRC_COMMIT DST_COMMIT REVISION_ID < <(aws codecommit get-pull-request --region $R --pull-request-id "$PR_ID"   --query 'pullRequest.[pullRequestStatus, pullRequestTargets[0].sourceCommit, pullRequestTargets[0].destinationCommit, revisionId]' --output text)
[ "$STATUS" = OPEN ] || { echo "열린 풀 리퀘스트 아님($STATUS) — 건너뜀"; exit 0; }
 W=$PWD/work; LOG=$PWD/check.log; mkdir -p "$W"; : > "$LOG"
git config --global credential.helper '!aws codecommit credential-helper $@'; git config --global credential.UseHttpPath true
FAIL=0; STEPS=()
step(){ local name="$1"; shift; echo "── $name ──" | tee -a "$LOG"; local t0=$SECONDS
  if "$@" >>"$LOG" 2>&1; then STEPS+=("통과  $name ($((SECONDS-t0))초)"); else STEPS+=("실패  $name ($((SECONDS-t0))초)"); FAIL=1; fi; }

# 킷 모양으로 놓습니다(맨 위 sgb-infra · sgb/ = sgb-core) — 검정 일부(check-testsafety ⑰)가 옆 폴더 docker/ 를 봅니다.
CC="https://git-codecommit.$R.amazonaws.com/v1/repos"
if [ "$REPO" = sgb-core ]; then
  git clone -q --depth 1 --branch main "$CC/sgb-infra" "$W/kit" && git clone -q "$CC/sgb-core" "$W/kit/sgb" && git -C "$W/kit/sgb" checkout -q "$SRC_COMMIT" && SRC="$W/kit/sgb"
else
  git clone -q "$CC/$REPO" "$W/kit" && git -C "$W/kit" checkout -q "$SRC_COMMIT" && SRC="$W/kit"
fi || { echo "가져오기 실패"; exit 1; }
cd "$SRC"; V=$(cat VERSION 2>/dev/null | tr -d '[:space:]')

case "$REPO" in
  sgb-core)
    docker run -d --name ci-db -p 5432:5432 -e POSTGRES_USER=sgb -e POSTGRES_PASSWORD=sgb -e POSTGRES_DB=sgb_check public.ecr.aws/docker/library/postgres:16 >/dev/null
    export DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check   # 검정 전용 이름이어야 시험 데이터를 넣음(verify-invariants 안전장치 · 끄지 않음)
    step "설치(API)" npm ci --no-audit --no-fund
    step "설치(사용자 웹)" bash -c 'cd site && npm ci --no-audit --no-fund'
    step "설치(운영 화면)" bash -c 'cd web && npm ci --no-audit --no-fund'
    step "형 검사 API" npx tsc -p tsconfig.json --noEmit
    step "형 검사 사용자 웹" bash -c 'cd site && npx tsc --noEmit'
    step "형 검사 운영 화면" bash -c 'cd web && npx tsc -b'
    for i in $(seq 1 60); do docker exec ci-db pg_isready -U sgb -q && break; sleep 2; done
    step "검증 묶음(마이그레이션 2번 · 불변식 · 시험 안전 · 오류 코드 · 권한 · SQL)" npm run verify
    ;;
  sgb-infra)
    step "qa 파이썬 문법" python3 -c "
import ast, glob, sys
bad = []
for f in glob.glob('qa/**/*.py', recursive=True):
    try: ast.parse(open(f, encoding='utf-8-sig').read())
    except SyntaxError as e: bad.append(f'{f}: {e}')
print('\n'.join(bad)); sys.exit(1 if bad else 0)"
    step "셸 문법" bash -c 'for f in $(git ls-files "*.sh"); do bash -n "$f" || exit 1; done'
    ;;
  *) echo "점검 대상 아님: $REPO"; exit 0 ;;
esac

RES=$([ $FAIL = 0 ] && echo "통과" || echo "실패")
BODY=$(printf '## 자동 점검 %s — %s %s\n\n커밋 `%s` · 빌드 `%s`\n\n```\n%s\n```\n' "$RES" "$REPO" "${V:-}" "${SRC_COMMIT:0:7}" "${CODEBUILD_BUILD_ID:-local}" "$(printf '%s\n' "${STEPS[@]}")")
[ $FAIL = 0 ] || BODY+=$(printf '\n실패 줄(마지막 40줄):\n```\n%s\n```\n' "$(grep -E 'FAIL|error|실패|!!' "$LOG" | tail -40)")
aws codecommit post-comment-for-pull-request --region $R --pull-request-id "$PR_ID" --repository-name "$REPO" \
  --before-commit-id "${DST_COMMIT:-$SRC_COMMIT}" --after-commit-id "$SRC_COMMIT" --content "$BODY" >/dev/null || echo "댓글 실패"
aws codecommit update-pull-request-approval-state --region $R --pull-request-id "$PR_ID" --revision-id "$REVISION_ID" \
  --approval-state "$([ $FAIL = 0 ] && echo APPROVE || echo REVOKE)" >/dev/null || echo "승인 표시 실패"
echo "$BODY"; exit $FAIL
