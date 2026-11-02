-- =====================================================================
-- D166 · 회원이 만드는 「이건 어때?」 투표 (v10.177 · 2026-11-02 · sgb-core docs/275)
--   대표 「투표생성 기능?」 → 「모두」(11/2) — D021 「만들기는 운영만」에 회원 갈래를 더함(운영 갈래는 그대로)
--
--   ① 설정 poll.member_create(기본 off · 공개) · poll.member_daily_limit(3) · poll.member_min_age_hours(24)
--   ② polls.source(ADMIN · MEMBER) · polls.report_n(불변식 SV-P18 — 투표 표에 count 이름 칸 금지) — 옛 투표는 전부 ADMIN
--   ③ fn_poll_member_guard — 회원 투표는 스위치 on · 가입 뒤 시간 · 24시간 건수 · 궁금해요 · 써본 의견만 ·
--      그림 없음 · 메인에 안 나감 · 마감 1시간 ~ 14일 · 링크 없음 · 금칙어(BLOCK) 거절 · 출처(source)는 바꿀 수 없음
--   ④ fn_poll_option_member_guard — 회원 투표의 보기도 링크 · 금칙어 · 그림 없음
--   ⑤ 신고 대상 POLL(회원 투표만) — 서로 다른 신고자 3명이면 감춤(HIDDEN · 지우지 않음 — 운영이 확인)
--      두 신고 함수는 D110 정의를 그대로 옮기고 투표 갈래만 더함(글 · 댓글 · 매물 · 요청 신고는 그대로)
--   지우는 문장 없음 · 재실행 안전
-- =====================================================================

-- 1. 설정 ---------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('poll.member_create', 'off', 'GLOBAL',
   '회원이 소개광장 「이건 어때?」 투표를 직접 만들 수 있게 할지(on/off · v10.177 · docs/275). 궁금해요 · 써본 의견만 · 메인에는 안 나감 · 신고 3건이면 자동으로 감춤.',
   false, '^(on|off)$', 'off'),
  ('poll.member_daily_limit', '3', 'ADMIN',
   '회원 한 사람이 24시간 안에 만들 수 있는 투표 수(v10.177 · docs/275).',
   false, '^[1-9][0-9]?$', '3'),
  ('poll.member_min_age_hours', '24', 'ADMIN',
   '가입한 지 이 시간이 지나야 투표를 만들 수 있음(v10.177 · docs/275 · 0 이면 바로).',
   false, '^[0-9]{1,4}$', '24')
ON CONFLICT (key) DO NOTHING;

-- 2. 칸 -----------------------------------------------------------------
ALTER TABLE public.polls ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ADMIN';
ALTER TABLE public.polls ADD COLUMN IF NOT EXISTS report_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.polls DROP CONSTRAINT IF EXISTS ck_polls_source;
ALTER TABLE public.polls ADD CONSTRAINT ck_polls_source CHECK (source IN ('ADMIN','MEMBER'));
COMMENT ON COLUMN public.polls.source IS '누가 만들었나(D166) — ADMIN 운영 화면 · MEMBER 회원(사용자 웹). 바꿀 수 없습니다.';
COMMENT ON COLUMN public.polls.report_n IS '서로 다른 신고자 수(D166 · 회원 투표만 신고 가능). 3명이면 감춥니다(fn_report_escalate).';
CREATE INDEX IF NOT EXISTS ix_polls_member ON public.polls (created_by, created_at) WHERE source = 'MEMBER';

-- 3. 회원 투표 규칙 -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_poll_member_guard() RETURNS trigger AS $$
DECLARE v_joined timestamptz; v_lim int; v_age int; n int; hit record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION 'POLL_SOURCE: 누가 만든 투표인지는 바꿀 수 없습니다';
    END IF;
    IF NEW.source = 'MEMBER' AND NEW.show_on_home THEN
      RAISE EXCEPTION 'POLL_MEMBER_HOME: 회원 투표는 메인에 낼 수 없습니다';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source <> 'MEMBER' THEN RETURN NEW; END IF;

  IF coalesce((SELECT value FROM site_settings WHERE key = 'poll.member_create'), 'off') <> 'on' THEN
    RAISE EXCEPTION 'POLL_MEMBER_OFF: 지금은 회원 투표 만들기를 받지 않습니다';
  END IF;
  IF NEW.created_by IS NULL THEN
    RAISE EXCEPTION 'POLL_MEMBER_OFF: 로그인한 회원만 투표를 만들 수 있습니다';
  END IF;

  SELECT created_at INTO v_joined FROM accounts WHERE id = NEW.created_by;
  SELECT CASE WHEN value ~ '^[0-9]{1,4}$' THEN value::int ELSE 24 END INTO v_age
    FROM site_settings WHERE key = 'poll.member_min_age_hours';
  v_age := coalesce(v_age, 24);
  IF v_joined IS NULL OR v_joined > now() - make_interval(hours => v_age) THEN
    RAISE EXCEPTION 'POLL_MEMBER_NEW: 가입하고 %시간이 지나야 투표를 만들 수 있습니다', v_age;
  END IF;

  SELECT CASE WHEN value ~ '^[1-9][0-9]?$' THEN value::int ELSE 3 END INTO v_lim
    FROM site_settings WHERE key = 'poll.member_daily_limit';
  v_lim := coalesce(v_lim, 3);
  SELECT count(*) INTO n FROM polls
   WHERE created_by = NEW.created_by AND source = 'MEMBER' AND created_at > now() - interval '1 day';
  IF n >= v_lim THEN
    RAISE EXCEPTION 'POLL_MEMBER_LIMIT: 투표는 24시간에 %건까지 만들 수 있습니다', v_lim;
  END IF;

  IF NEW.kind NOT IN ('ASK','USED') THEN
    RAISE EXCEPTION 'POLL_MEMBER_KIND: 회원 투표는 「궁금해요」 · 「써본 의견」만 만들 수 있습니다';
  END IF;
  IF NEW.ends_at IS NULL OR NEW.ends_at < now() + interval '1 hour' OR NEW.ends_at > now() + interval '14 days 1 hour' THEN
    RAISE EXCEPTION 'POLL_ENDS_AT: 회원 투표의 마감은 1시간 뒤부터 14일 안이어야 합니다';
  END IF;
  IF concat_ws(' ', NEW.title, NEW.description) ~* '(https?://|www\.)' THEN
    RAISE EXCEPTION 'POLL_MEMBER_LINK: 회원 투표에는 링크를 넣을 수 없습니다';
  END IF;
  SELECT * INTO hit FROM fn_check_banned_words(concat_ws(' ', NEW.title, NEW.description), 'CMU')
   WHERE severity = 'BLOCK' LIMIT 1;
  IF hit.word IS NOT NULL THEN
    RAISE EXCEPTION 'BANNED_WORD: "%"는 사용할 수 없는 표현입니다.', hit.word;
  END IF;

  NEW.image := NULL;
  NEW.show_on_home := false;
  NEW.sort := 0;
  NEW.report_n := 0;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_poll_member_guard ON public.polls;
CREATE TRIGGER trg_poll_member_guard BEFORE INSERT OR UPDATE ON public.polls
  FOR EACH ROW EXECUTE FUNCTION public.fn_poll_member_guard();

CREATE OR REPLACE FUNCTION public.fn_poll_option_member_guard() RETURNS trigger AS $$
DECLARE hit record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM polls p WHERE p.id = NEW.poll_id AND p.source = 'MEMBER') THEN RETURN NEW; END IF;
  IF concat_ws(' ', NEW.label, NEW.sub) ~* '(https?://|www\.)' THEN
    RAISE EXCEPTION 'POLL_MEMBER_LINK: 회원 투표에는 링크를 넣을 수 없습니다';
  END IF;
  SELECT * INTO hit FROM fn_check_banned_words(concat_ws(' ', NEW.label, NEW.sub), 'CMU')
   WHERE severity = 'BLOCK' LIMIT 1;
  IF hit.word IS NOT NULL THEN
    RAISE EXCEPTION 'BANNED_WORD: "%"는 사용할 수 없는 표현입니다.', hit.word;
  END IF;
  NEW.image := NULL;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_poll_option_member_guard ON public.poll_options;
CREATE TRIGGER trg_poll_option_member_guard BEFORE INSERT OR UPDATE ON public.poll_options
  FOR EACH ROW EXECUTE FUNCTION public.fn_poll_option_member_guard();

-- 4. 신고 대상 POLL ------------------------------------------------------
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type = ANY (ARRAY['LISTING','REQUEST','SERVICE','PROFILE','POST','COMMENT','POLL']));

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
  ELSIF NEW.target_type = 'POLL' THEN                      /* D166 · v10.177 — 회원 투표만 */
    SELECT created_by INTO v_owner FROM polls WHERE id = NEW.target_id;
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM polls WHERE id = NEW.target_id AND source = 'MEMBER' AND state IN ('OPEN','CLOSED','HIDDEN')) THEN
      RAISE EXCEPTION 'REPORT: 신고할 수 없는 투표입니다(회원 투표만 · 없거나 지운 투표)';
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
  /* D166 · v10.177 — 회원 투표도 같은 규칙: 서로 다른 신고자 3명이면 감춤(지우지 않음 — 운영이 확인) */
  ELSIF NEW.target_type = 'POLL' THEN
    SELECT count(DISTINCT reporter_id) INTO v_posters
      FROM reports WHERE target_type = 'POLL' AND target_id = NEW.target_id AND state IN ('OPEN','QUEUED','UPHELD');
    UPDATE polls SET report_n = v_posters,
                     state = CASE WHEN v_posters >= 3 AND state IN ('OPEN','CLOSED') THEN 'HIDDEN' ELSE state END,
                     hidden_reason = CASE WHEN v_posters >= 3 AND state IN ('OPEN','CLOSED') THEN '신고 3건 — 운영 확인 대기' ELSE hidden_reason END
     WHERE id = NEW.target_id;
  END IF;

  SELECT auto_queue_at INTO v_at FROM report_reasons WHERE code = NEW.reason_code;
  SELECT count(DISTINCT reporter_id) INTO v_cnt
    FROM reports
   WHERE target_type = NEW.target_type AND target_id = NEW.target_id
     AND reason_code = NEW.reason_code AND state IN ('OPEN','QUEUED');

  IF v_cnt >= coalesce(v_at, 3) OR (NEW.target_type IN ('POST','COMMENT','POLL') AND v_posters >= 3) THEN
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
