-- =====================================================================
-- D110 — v10.80 소개광장 댓글 신고 (2026-10-23 · docs/133)
--
--   대표 결정(2026-10-23 「A b c d e 순으로 진행」 · D 「승인」 — 회원 댓글 신고 B안)
--
--   ① 신고 대상에 COMMENT(소개광장 댓글)
--   ② fn_report_guard — 댓글 주인은 post_comments.author_id(자기 댓글 신고 거절) · 없거나 지운 댓글은 신고 거절
--   ③ fn_report_escalate — 댓글도 글과 같은 규칙: 서로 다른 신고자 수를 report_count 에 · 3명이면 가림(HIDDEN · 지우지 않음)
--
--   두 함수는 D031 의 정의를 그대로 옮기고 댓글 갈래만 더했습니다(글 · 매물 · 요청 신고는 그대로 — test_v1080 이 D031 과 대조).
--   자료를 지우지 않습니다. 재실행 안전(DROP CONSTRAINT IF EXISTS · CREATE OR REPLACE).
-- =====================================================================

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type = ANY (ARRAY['LISTING','REQUEST','SERVICE','PROFILE','POST','COMMENT']));

CREATE OR REPLACE FUNCTION public.fn_report_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
  IF NEW.target_type = 'LISTING' THEN
    SELECT owner_account_id INTO v_owner FROM listings WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'REQUEST' THEN
    SELECT owner_account_id INTO v_owner FROM requests WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'POST' THEN                      /* D031 · G-191 */
    SELECT author_id INTO v_owner FROM posts WHERE id = NEW.target_id;
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM posts WHERE id = NEW.target_id AND state IN ('PUBLISHED','HIDDEN')) THEN
      RAISE EXCEPTION 'REPORT: 신고할 수 없는 글입니다(없거나 지운 글)';
    END IF;
  ELSIF NEW.target_type = 'COMMENT' THEN                   /* D110 · v10.80 — 소개광장 댓글 */
    SELECT author_id INTO v_owner FROM post_comments WHERE id = NEW.target_id;
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM post_comments WHERE id = NEW.target_id AND state IN ('PUBLISHED','HIDDEN')) THEN
      RAISE EXCEPTION 'REPORT: 신고할 수 없는 댓글입니다(없거나 지운 댓글)';
    END IF;
  END IF;

  IF v_owner IS NOT NULL AND v_owner = NEW.reporter_id THEN
    RAISE EXCEPTION 'REPORT: 자기 등록은 신고할 수 없습니다';
  END IF;

  IF NEW.state = 'UPHELD' AND coalesce(btrim(NEW.resolution), '') = '' THEN
    RAISE EXCEPTION 'REPORT: 인정할 때는 처리 내용을 적어야 합니다';
  END IF;
  IF NEW.state = 'DISMISSED' AND coalesce(btrim(NEW.resolution), '') = '' THEN
    RAISE EXCEPTION 'REPORT: 기각할 때는 사유를 적어야 합니다 — 신고자가 답을 받아야 합니다';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_report_escalate() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_cnt int; v_at int; v_gwan text; v_owner uuid; v_posters int;
BEGIN
  /* D031 · G-191 — 글은 사유와 관계없이 서로 다른 신고자 수를 세어 둡니다. 3명이면 가립니다(지우지 않음 — 운영이 확인) */
  IF NEW.target_type = 'POST' THEN
    SELECT count(DISTINCT reporter_id) INTO v_posters
      FROM reports WHERE target_type = 'POST' AND target_id = NEW.target_id AND state IN ('OPEN','QUEUED','UPHELD');
    UPDATE posts SET report_count = v_posters,
                     state = CASE WHEN v_posters >= 3 AND state = 'PUBLISHED' THEN 'HIDDEN' ELSE state END,
                     hidden_at = CASE WHEN v_posters >= 3 AND state = 'PUBLISHED' THEN now() ELSE hidden_at END,
                     hidden_reason = CASE WHEN v_posters >= 3 AND state = 'PUBLISHED' THEN '신고 3건 — 운영 확인 대기' ELSE hidden_reason END
     WHERE id = NEW.target_id;
  /* D110 · v10.80 — 댓글도 글과 같은 규칙: 사유와 관계없이 서로 다른 신고자 수 · 3명이면 가림(지우지 않음 — 운영이 확인).
   *   댓글 표에는 사유 칸이 없어, 신고로 가려졌는지는 report_count >= 3 으로 알아봅니다(소개광장 서비스 commentsOf) */
  ELSIF NEW.target_type = 'COMMENT' THEN
    SELECT count(DISTINCT reporter_id) INTO v_posters
      FROM reports WHERE target_type = 'COMMENT' AND target_id = NEW.target_id AND state IN ('OPEN','QUEUED','UPHELD');
    UPDATE post_comments SET report_count = v_posters,
                             state = CASE WHEN v_posters >= 3 AND state = 'PUBLISHED' THEN 'HIDDEN' ELSE state END,
                             hidden_at = CASE WHEN v_posters >= 3 AND state = 'PUBLISHED' THEN now() ELSE hidden_at END
     WHERE id = NEW.target_id;
  END IF;

  SELECT auto_queue_at INTO v_at FROM report_reasons WHERE code = NEW.reason_code;
  SELECT count(DISTINCT reporter_id) INTO v_cnt
    FROM reports
   WHERE target_type = NEW.target_type AND target_id = NEW.target_id
     AND reason_code = NEW.reason_code AND state IN ('OPEN','QUEUED');

  IF v_cnt >= coalesce(v_at, 3) OR (NEW.target_type IN ('POST','COMMENT') AND v_posters >= 3) THEN
    UPDATE reports SET state = 'QUEUED'
     WHERE target_type = NEW.target_type AND target_id = NEW.target_id
       AND state = 'OPEN';

    IF NEW.target_type = 'LISTING'
       AND NOT EXISTS (SELECT 1 FROM review_items ri
                        WHERE ri.target_id = NEW.target_id AND ri.status = 'QUEUED') THEN
      SELECT gwan_code, owner_account_id INTO v_gwan, v_owner
        FROM listings WHERE id = NEW.target_id;
      IF v_owner IS NOT NULL THEN
        INSERT INTO review_items
          (target_type, target_id, gwan_code, submitted_by, status, decision_mode,
           sla_due_at)
        VALUES ('LISTING', NEW.target_id, coalesce(v_gwan,'MNY'), v_owner,
                'QUEUED', 'MANUAL', now() + interval '24 hours');
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
