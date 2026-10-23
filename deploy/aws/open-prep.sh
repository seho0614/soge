#!/usr/bin/env bash
# =====================================================================
# 오픈 직전 정리 (v10.82 · 2026-10-23 · docs/136) — **오픈 직전에만** 사람이 실행합니다.
#
#   bash ~/sgb/deploy/aws/open-prep.sh            # check — 읽기만(아무것도 바꾸지 않음)
#   bash ~/sgb/deploy/aws/open-prep.sh apply      # 정리 — 「오픈 직전입니까?」에 소문자 yes
#
#   시험 자료 = 시험 계정(이메일이 @t.local — deploy/aws/seed-test-users.sql)과 그 계정이 만든 것.
#   운영진 · 회원의 실제 계정은 건드리지 않습니다.
#
#   apply 가 하는 일(한 거래 · **지우는 것 없음**):
#     ① 시험 계정 정지(SUSPENDED)                     — 오픈 직전에만(시험 중에 하면 「사용할 수 없는 계정」)
#     ② 그 계정의 매물 · 요청 → 보관(ARCHIVED)
#     ③ 그 계정의 소개광장 글 → 감춤(사유 「오픈 전 시험 글 정리」) · 댓글 → 감춤
#     ④ (v10.83) 지금까지 쌓인 검색어 통계를 추천 검색어에서 숨김(hidden) — 오픈 전 시험 기간에 쌓인 말 · 통계는 남음
#   그대로 두는 것(개수만 보여 줌): 거래 · 주문 · 상담 — 상대가 있는 기록이라 사람이 판단
#
#   check 가 더 보는 것: 메인 내용 모드(HOME_CONTENT — 비어 있으면 운영 기본 live) · 오픈 차단 수(v_open_blockers)
#   결과: 화면 + ~/sgb-data/logs/open-prep_날짜_시각.txt
#
#   APP_LINK   앱 폴더 (기본 ~/sgb — 이 폴더의 .env 로 DB 에 붙습니다)
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib.sh"
MODE="${1:-check}"
APP_LINK="${APP_LINK:-$HOME/sgb}"
DATA_DIR="${DATA_DIR:-$HOME/sgb-data}"
mkdir -p "$DATA_DIR/logs"
OUT="$DATA_DIR/logs/open-prep_$(date +%Y%m%d_%H%M%S).txt"; : > "$OUT"
load_env "$APP_LINK/.env" || { echo "!! $APP_LINK/.env 가 없습니다"; exit 1; }
: "${DATABASE_URL:?DATABASE_URL 이 .env 에 없습니다}"
case "$MODE" in check|apply) ;; *) echo "사용: open-prep.sh [check|apply]"; exit 1 ;; esac

T="(SELECT id FROM accounts WHERE email LIKE '%@t.local')"
count() {
  say "  시험 계정 $(q "SELECT count(*) FROM accounts WHERE email LIKE '%@t.local'")개 (그중 쓰는 중 $(q "SELECT count(*) FROM accounts WHERE email LIKE '%@t.local' AND status = 'ACTIVE'"))"
  say "  · 매물 $(q "SELECT count(*) FROM listings WHERE owner_account_id IN $T AND status <> 'ARCHIVED'")건 (보관 안 된 것)"
  say "  · 요청 $(q "SELECT count(*) FROM requests WHERE owner_account_id IN $T AND status <> 'ARCHIVED'")건 (보관 안 된 것)"
  say "  · 소개광장 글 $(q "SELECT count(*) FROM posts WHERE author_id IN $T AND state IN ('PUBLISHED','PENDING')")건 · 댓글 $(q "SELECT count(*) FROM post_comments WHERE author_id IN $T AND state = 'PUBLISHED'")건 (보이는 것)"
  say "  · 추천 검색어로 보이는 말 $(q "SELECT count(*) FROM search_term_stats WHERE NOT hidden" || echo '?')개 (오픈 전 시험 기간에 쌓인 것)"
  say "  · (그대로 둠 — 사람이 판단) 거래 $(q "SELECT count(*) FROM deals WHERE buyer_account_id IN $T OR seller_account_id IN $T" || echo '?')건"
}

say "소개뱅크 오픈 직전 정리 — $MODE ($(date '+%Y-%m-%d %H:%M:%S %Z')) · 앱 $(cat "$APP_LINK/VERSION" 2>/dev/null || echo '?')"
say ""; say "[1] 시험 자료"
count

say ""; say "[2] 메인 내용 · 오픈 차단"
hc="${HOME_CONTENT:-}"
case "$hc" in
  ''|live) ok "메인 내용 = 실제 자료" "HOME_CONTENT=${hc:-(비어 있음 — 운영 기본 live)}" ;;
  *) bad "메인 내용이 실제 자료가 아님" "HOME_CONTENT=$hc — .env 에서 지우거나 live 로 · pm2 restart sgb-site" ;;
esac
b=$(q "SELECT count(*) FROM v_open_blockers")
if [ "${b:-x}" = "0" ]; then ok "오픈 차단 0건"
else warn "오픈 차단 ${b:-?}건" "$(q "SELECT string_agg(kind||':'||c, ' ') FROM (SELECT kind, count(*) c FROM v_open_blockers GROUP BY kind) x") — 간주 모드 · 약관 · 연동(docs/111)"; fi

if [ "$MODE" = check ]; then
  say ""; say "읽기만 했습니다. 정리하려면 오픈 직전에: bash $HERE/open-prep.sh apply"; say "결과 파일: $OUT"; exit 0
fi

say ""; say "[3] 정리 — 시험 계정 정지 · 매물 · 요청 보관 · 글 · 댓글 감춤 · 추천 검색어 숨김 (지우는 것 없음 · 한 거래)"
printf "오픈 직전입니까? 시험 계정으로 더는 로그인할 수 없게 됩니다 (yes/no): "
read -r yn
[ "$yn" = "yes" ] || { say "  멈춤 — 아무것도 바꾸지 않았습니다"; exit 1; }
res=$(db -v ON_ERROR_STOP=1 -t -A <<'SQL' 2>&1
BEGIN;
CREATE TEMP TABLE t_acc ON COMMIT DROP AS SELECT id FROM accounts WHERE email LIKE '%@t.local';
WITH a AS (UPDATE accounts SET status = 'SUSPENDED' WHERE id IN (SELECT id FROM t_acc) AND status = 'ACTIVE' RETURNING 1),
     l AS (UPDATE listings SET status = 'ARCHIVED' WHERE owner_account_id IN (SELECT id FROM t_acc) AND status <> 'ARCHIVED' RETURNING 1),
     r AS (UPDATE requests SET status = 'ARCHIVED' WHERE owner_account_id IN (SELECT id FROM t_acc) AND status <> 'ARCHIVED' RETURNING 1),
     p AS (UPDATE posts SET state = 'HIDDEN', hidden_at = now(), hidden_reason = '오픈 전 시험 글 정리'
            WHERE author_id IN (SELECT id FROM t_acc) AND state IN ('PUBLISHED','PENDING') RETURNING 1),
     c AS (UPDATE post_comments SET state = 'HIDDEN', hidden_at = now()
            WHERE author_id IN (SELECT id FROM t_acc) AND state = 'PUBLISHED' RETURNING 1),
     s AS (UPDATE search_term_stats SET hidden = true WHERE NOT hidden RETURNING 1)
SELECT 'done ' || (SELECT count(*) FROM a) || ' ' || (SELECT count(*) FROM l) || ' ' || (SELECT count(*) FROM r) || ' '
       || (SELECT count(*) FROM p) || ' ' || (SELECT count(*) FROM c) || ' ' || (SELECT count(*) FROM s);
COMMIT;
SQL
)
line=$(echo "$res" | grep '^done ' | tail -1)
if [ -n "$line" ]; then
  set -- $line
  ok "정리함" "계정 정지 $2 · 매물 보관 $3 · 요청 보관 $4 · 글 감춤 $5 · 댓글 감춤 $6 · 추천 검색어 숨김 $7"
else
  bad "정리 실패 — 아무것도 바뀌지 않았습니다(한 거래)" "$(echo "$res" | tail -3 | tr '\n' ' ')"
fi
say ""; say "[4] 다시 보기"
count
say ""; say "결과 파일: $OUT"
[ "$FAIL" = 0 ]
