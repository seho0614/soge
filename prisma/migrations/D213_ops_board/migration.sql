-- =====================================================================
-- D213 (v10.286 · docs/412) — 운영자 게시판
--
--   대표 결정(11/14): 「운영자 매일 또는 슬랙 · 텔레그램 발송 내용을 운영자 게시판에 게시 · 게시된 내용은 운영자만 볼 수 있다」
--     → 만드는 방식 「모두」(게시판 + 관리자 공지) · 꺼져 있어도 「항상 올림」 · 직접 글쓰기 · 댓글 · 확인 표시 · 보관 기간 설정.
--   ① ops_board_posts — 자동 글(하루 요약 · 급한 알림 · 대표 할 일 주간 · 시험 메시지) · 운영자 글 · 텔레그램 · 슬랙 보낸 결과
--      자동 글은 같은 내용을 「관리자」(STAFF) 공지로도(끝 시각 2일 뒤 · 알림 없음 · 운영 첫 화면 「관리자 공지」)
--   ② ops_board_revisions(운영자 글 고친 기록 · 쌓기만) · ops_board_comments(댓글 · 쌓기만) · ops_board_reads(「확인함」)
--   ③ ops_alerts.board_posted_at — 급한 알림을 게시판에 한 번만
--   ④ 설정 ops.board_retention_days(365) · 정기 작업 ops_board_purge(매일 04:40) — 자동 글 중 고정 안 한 것만 지움 · 끝난 지 7일 지난 관리자 공지 사본도
--   지우는 문장은 정리 함수 안에만(기간 지난 자동 글). 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ops_board_posts (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('DAILY_DIGEST', 'URGENT', 'OWNER_TODO', 'TEST', 'STAFF')),
  title           text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  telegram        text,          -- SENT · OFF · NO_TOKEN · NO_CHAT · SEND_<까닭> · NULL(해당 없음)
  slack           text,          -- SENT · OFF · NO_WEBHOOK · SEND_<까닭> · NULL
  notice_id       uuid REFERENCES public.notices(id) ON DELETE SET NULL,
  author_id       uuid REFERENCES public.accounts(id),
  is_pinned       boolean NOT NULL DEFAULT false,
  taken_down_at   timestamptz,
  taken_down_by   uuid REFERENCES public.accounts(id),
  taken_down_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  CONSTRAINT ck_ops_board_author CHECK (kind <> 'STAFF' OR author_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ops_board_posts_at ON public.ops_board_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_board_posts_kind ON public.ops_board_posts (kind, created_at DESC);
COMMENT ON TABLE public.ops_board_posts IS 'v10.286 (D213) 운영자 게시판 — 자동 글(텔레그램 · 슬랙 보낸 결과와 함께 · 꺼져 있어도 올림) · 운영자 글 · 운영 화면 계정만';

CREATE TABLE IF NOT EXISTS public.ops_board_revisions (
  id        bigserial PRIMARY KEY,
  post_id   bigint NOT NULL REFERENCES public.ops_board_posts(id),
  before    jsonb NOT NULL,
  reason    text,
  by_account uuid REFERENCES public.accounts(id),
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ops_board_comments (
  id         bigserial PRIMARY KEY,
  post_id    bigint NOT NULL REFERENCES public.ops_board_posts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES public.accounts(id),
  body       text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_board_comments_post ON public.ops_board_comments (post_id, created_at);
CREATE TABLE IF NOT EXISTS public.ops_board_reads (
  post_id    bigint NOT NULL REFERENCES public.ops_board_posts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, account_id)
);

-- 고친 기록 · 댓글은 고칠 수 없음(댓글은 기간 지난 자동 글과 함께만 지워짐 — ON DELETE CASCADE 는 트리거를 거치지 않게 정리 함수가 세션 값으로 엶)
CREATE OR REPLACE FUNCTION public.fn_ops_board_keep() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.ops_board_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'OPSB: 운영자 게시판 기록은 고치거나 지울 수 없습니다(%)', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS trg_ops_board_revisions_keep ON public.ops_board_revisions;
CREATE TRIGGER trg_ops_board_revisions_keep BEFORE UPDATE OR DELETE ON public.ops_board_revisions FOR EACH ROW EXECUTE FUNCTION public.fn_ops_board_keep();
DROP TRIGGER IF EXISTS trg_ops_board_comments_keep ON public.ops_board_comments;
CREATE TRIGGER trg_ops_board_comments_keep BEFORE UPDATE OR DELETE ON public.ops_board_comments FOR EACH ROW EXECUTE FUNCTION public.fn_ops_board_keep();

ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS board_posted_at timestamptz;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('ops.board_retention_days', '365', 'ADMIN',
        '운영자 게시판 자동 글 보관 기간(일 · v10.286 · docs/412) — 지나면 정기 작업 ops_board_purge 가 지움(운영자 글 · 고정한 글은 남김). 바꾸기는 최고 관리자.',
        false, '^[1-9][0-9]{0,4}$', '365')
ON CONFLICT (key) DO NOTHING;

-- 자동 글 올리기 — 게시판 + 관리자(STAFF) 공지 사본(끝 시각 2일 뒤 · 알림 없음)
CREATE OR REPLACE FUNCTION public.fn_ops_board_post(p_kind text, p_title text, p_body text, p_telegram text, p_slack text) RETURNS bigint
    LANGUAGE plpgsql AS $$
DECLARE nid uuid; pid bigint; t text := left(btrim(p_title), 200); b text := left(coalesce(nullif(p_body, ''), p_title), 20000);
BEGIN
  INSERT INTO notices (title, body, grades, published_at, ends_at, notify)
  VALUES (left('[운영] ' || t, 200), b, ARRAY['STAFF'], now(), now() + interval '2 days', false)
  RETURNING id INTO nid;
  INSERT INTO ops_board_posts (kind, title, body, telegram, slack, notice_id)
  VALUES (p_kind, t, b, p_telegram, p_slack, nid) RETURNING id INTO pid;
  RETURN pid;
END $$;
COMMENT ON FUNCTION public.fn_ops_board_post(text, text, text, text, text) IS 'v10.286 (D213) 자동 글 — 게시판 한 줄 + 관리자 공지 사본(2일)';

CREATE OR REPLACE FUNCTION public.fn_ops_board_purge() RETURNS TABLE (posts int, notices int)
    LANGUAGE plpgsql AS $$
DECLARE d int; p int; n int;
BEGIN
  d := coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.board_retention_days'), 365);
  PERFORM set_config('app.ops_board_purge', 'on', true);
  DELETE FROM ops_board_posts WHERE kind <> 'STAFF' AND NOT is_pinned AND created_at < now() - make_interval(days => d);
  GET DIAGNOSTICS p = ROW_COUNT;
  DELETE FROM notices x WHERE 'STAFF' = ALL(x.grades) AND x.title LIKE '[운영] %' AND x.ends_at < now() - interval '7 days'
     AND NOT EXISTS (SELECT 1 FROM ops_board_posts o WHERE o.notice_id = x.id AND o.is_pinned)
     AND NOT EXISTS (SELECT 1 FROM notice_revisions r WHERE r.notice_id = x.id)
     AND NOT EXISTS (SELECT 1 FROM notice_reads r WHERE r.notice_id = x.id)
     AND NOT EXISTS (SELECT 1 FROM notice_notified r WHERE r.notice_id = x.id)
     AND NOT EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = x.id OR r.cancel_notice_id = x.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.ops_board_purge', 'off', true);
  posts := p; notices := n; RETURN NEXT;
END $$;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('ops_board_purge', 1440, 4, 40, NULL, true, '운영자 게시판 자동 글 보관 기간(ops.board_retention_days) 지난 것 · 끝난 지 7일 지난 관리자 공지 사본 정리 · D213')
ON CONFLICT (job) DO NOTHING;
