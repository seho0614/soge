-- =====================================================================
-- 자동검수 운영 확인 (v10.85 · 2026-10-23 · docs/139) — **읽기만 합니다**(읽기 전용 거래 · 끝에 되돌림)
--
--   운영 서버(ubuntu):  bash ~/sgb/deploy/aws/psql.sh -v days=14 -f ~/sgb/deploy/aws/review-stats.sql > ~/review-stats.txt
--                       (days 를 빼면 14일) → ~/review-stats.txt 를 Claude 에게
--
--   ① 관별 자동화율 — 기간 안에 들어온 검수 건 · 자동 승인 · 사람 검수 · 아직 대기
--   ② 사람 검수로 넘어간 이유 분포(fn_auto_review_reasons 의 이유 코드)
--   ③ 사람 검수 결과 — 승인 · 반려 · 반려 이유 코드
--   ④ 표본 감사(자동 승인 중 표본) 수
--   ⑤ 금칙어 사전 — 켜진 줄 종류별(정확히 · 포함 · 정규식) · 차단/주의
--   ⑥ **이미 노출 중인데 글 칸에 차단 금칙어가 든 매물**(docs/127 4절 — v10.71 은 고칠 때 바뀐 칸만 검사해서 남아 있을 수 있음)
--   매물 제목 · 회원 이름 · 연락처는 내보내지 않습니다(매물 번호 · 관 · 금칙어만).
-- =====================================================================
\set ON_ERROR_STOP on
\if :{?days}
\else
  \set days 14
\endif
\pset footer off
BEGIN READ ONLY;

\echo '== ① 관별 자동화율 (최근' :days '일 · 매물 · 요청)'
SELECT coalesce(gwan_code, '-') AS 관, target_type AS 대상,
       count(*) AS 들어온_건,
       count(*) FILTER (WHERE decision_mode = 'AUTO' AND status = 'APPROVED') AS 자동_승인,
       count(*) FILTER (WHERE decision_mode = 'MANUAL' AND status IN ('APPROVED','REJECTED')) AS 사람_처리,
       count(*) FILTER (WHERE status IN ('QUEUED','IN_PROGRESS')) AS 대기,
       round(100.0 * count(*) FILTER (WHERE decision_mode = 'AUTO' AND status = 'APPROVED') / nullif(count(*), 0), 1) AS 자동화율_퍼센트
  FROM review_items
 WHERE submitted_at > now() - make_interval(days => :days) AND target_type IN ('LISTING','REQUEST')
 GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== ② 사람 검수로 넘어간 이유(한 건에 여러 이유 가능)'
SELECT r AS 이유, count(*) AS 건수
  FROM review_items, unnest(coalesce(manual_reasons, ARRAY['(이유 없음)'])) AS r
 WHERE submitted_at > now() - make_interval(days => :days) AND decision_mode = 'MANUAL'
 GROUP BY 1 ORDER BY 2 DESC, 1;

\echo '== ③ 사람 검수 결과 · 반려 이유'
SELECT status AS 결과, coalesce(reject_reason_code, '-') AS 반려_이유, count(*) AS 건수
  FROM review_items
 WHERE submitted_at > now() - make_interval(days => :days) AND decision_mode = 'MANUAL' AND status IN ('APPROVED','REJECTED')
 GROUP BY 1, 2 ORDER BY 1, 3 DESC;

\echo '== ④ 표본 감사(자동 승인 중 표본)'
SELECT count(*) FILTER (WHERE decision_mode = 'AUTO' AND status = 'APPROVED') AS 자동_승인,
       count(*) FILTER (WHERE decision_mode = 'AUTO' AND status = 'APPROVED' AND audit_sampled) AS 그중_표본
  FROM review_items WHERE submitted_at > now() - make_interval(days => :days);

\echo '== ⑤ 금칙어 사전 — 켜진 줄'
SELECT match_type AS 맞춤, severity AS 단계, count(*) AS 줄
  FROM banned_words WHERE is_active GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== ⑥ 노출 중인데 차단 금칙어가 든 매물(매물 번호 · 관 · 금칙어)'
SELECT l.listing_no AS 매물_번호, l.gwan_code AS 관, string_agg(DISTINCT w.word, ', ') AS 금칙어
  FROM listings l, fn_check_banned_words(fn_listing_text(l), l.gwan_code) w
 WHERE w.severity = 'BLOCK' AND l.status = 'PUBLISHED'
 GROUP BY 1, 2 ORDER BY 1;

ROLLBACK;
