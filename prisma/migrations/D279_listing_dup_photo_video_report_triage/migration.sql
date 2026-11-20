/* D279 (v10.524 ~ 527 · docs/662 ~ 665) ㊾ 매물 2 — 중복 매물 자동 탐지 · 사진 품질 검사 · 매물 동영상 · 신고 자동 분류 · 우선순위(모두 off) */

/* =====================================================================
 * D279 (#317) v10.524 ~ 527 ㊾ 매물 2
 *   docs/662 ~ 665 · 대표 11/20 「지금 바로 동시 착수」(CONTRACT6)
 *   다시 돌려도 같음(IF NOT EXISTS · ON CONFLICT DO NOTHING · CREATE OR REPLACE · 트리거는 있으면 건너뜀 · 제약은 지우고 다시).
 *   매물 표(listings)는 칸을 더하지도 고치지도 않음 — 결과는 모두 따로 표(lsy_*) · listings 의 BEFORE UPDATE 트리거를 건드리지 않으려고.
 *   스위치는 모두 처음 꺼짐(lsy.dup_detect · lsy.photo_check · lsy.photo_ai · lsy.video · lsy.report_triage · lsy.report_ai).
 *   새 파일 용도 LISTING_VIDEO — ck_files_purpose 는 D269 목록 그대로 + LISTING_VIDEO(③). fn_file_can_read 는 고치지 않음(공개 주소는 API 가 조건을 보고 만듦).
 *   AI 통로 두 개(LSY_PHOTO · LSY_REPORT) — fn_agent_allowed 는 D276 정의 그대로 + 두 줄(⑤).
 * ===================================================================== */

/* ── ① v10.524 중복 매물 자동 탐지 ─────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.lsy_dup_scans (
  listing_id  uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  version     integer NOT NULL CHECK (version >= 1),
  scanned_at  timestamptz NOT NULL DEFAULT now(),
  found       integer NOT NULL DEFAULT 0 CHECK (found >= 0)
);
COMMENT ON TABLE public.lsy_dup_scans IS 'v10.524 (D279) 중복 탐지가 본 매물 · 판(version) — 매물을 고치면 판이 달라져 다시 봄';

CREATE TABLE IF NOT EXISTS public.lsy_dup_pairs (
  id                bigserial PRIMARY KEY,
  a_id              uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  b_id              uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  newer_id          uuid NOT NULL,
  score             integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  text_score        integer NOT NULL CHECK (text_score BETWEEN 0 AND 100),
  photo_shared      integer NOT NULL DEFAULT 0 CHECK (photo_shared >= 0),
  contact           text NOT NULL DEFAULT 'NONE' CHECK (contact IN ('NONE', 'SAME_OWNER', 'SAME_PHONE', 'SAME_TEXT_PHONE')),
  state             text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'SAME', 'DIFFERENT')),
  queued_review_id  uuid,
  decided_by        uuid REFERENCES public.accounts(id),
  decided_at        timestamptz,
  decide_reason     text CHECK (decide_reason IS NULL OR char_length(decide_reason) BETWEEN 2 AND 300),
  found_at          timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (a_id < b_id),
  CHECK (newer_id = a_id OR newer_id = b_id),
  CHECK (state = 'PENDING' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decide_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lsy_dup_pair ON public.lsy_dup_pairs (a_id, b_id);
CREATE INDEX IF NOT EXISTS ix_lsy_dup_state ON public.lsy_dup_pairs (state, score DESC);
CREATE INDEX IF NOT EXISTS ix_lsy_dup_b ON public.lsy_dup_pairs (b_id);
COMMENT ON TABLE public.lsy_dup_pairs IS 'v10.524 (D279) 중복 의심 짝 — 사진 SHA-256 같음 · 글 겹침 · 같은 연락처(주인 · 계정 전화 · 글 속 전화) 점수 · 기준(lsy.dup_threshold) 넘은 것만 · 나중 매물은 기존 검수 대기(lsy.dup_queue) · 사람이 같은 매물 · 다른 매물로 정함 · 결정한 짝은 다시 열지 않음';

/* 결정한 짝은 점수 · 신호를 고치지 않음(작업이 실수로 덮지 않게) */
CREATE OR REPLACE FUNCTION public.fn_lsy_dup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'PENDING' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.score IS DISTINCT FROM OLD.score OR NEW.decide_reason IS DISTINCT FROM OLD.decide_reason) THEN
    RAISE EXCEPTION 'LSY_DUP_STATE: 이미 결정한 짝은 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsy_dup_guard' AND tgrelid = 'public.lsy_dup_pairs'::regclass) THEN
    CREATE TRIGGER trg_lsy_dup_guard BEFORE UPDATE ON public.lsy_dup_pairs FOR EACH ROW EXECUTE FUNCTION public.fn_lsy_dup_guard();
  END IF;
END $$;


/* ── ② v10.525 매물 사진 품질 검사(경고만) ──────────────────────────── */
CREATE TABLE IF NOT EXISTS public.lsy_photo_checks (
  id          bigserial PRIMARY KEY,
  listing_id  uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  width       integer CHECK (width IS NULL OR width > 0),
  height      integer CHECK (height IS NULL OR height > 0),
  bytes       bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  ratio       numeric(8,2),
  bpp         numeric(8,3),
  warnings    text[] NOT NULL DEFAULT '{}'::text[]
              CHECK (warnings <@ ARRAY['SMALL','TINY_FILE','BIG_FILE','RATIO','BLUR','UNREADABLE','CONTACT']::text[]),
  ai_state    text NOT NULL DEFAULT 'TODO' CHECK (ai_state IN ('TODO', 'PENDING', 'DONE', 'FAILED', 'SKIP')),
  ai_contact  boolean,
  ai_kinds    text[] NOT NULL DEFAULT '{}'::text[] CHECK (ai_kinds <@ ARRAY['PHONE','URL','EMAIL','MESSENGER']::text[]),
  ai_note     text CHECK (ai_note IS NULL OR char_length(ai_note) <= 200),
  ai_model    text,
  ai_engine   text CHECK (ai_engine IS NULL OR ai_engine IN ('MOCK', 'CLAUDE', 'N8N')),
  ai_at       timestamptz,
  checked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lsy_photo_check ON public.lsy_photo_checks (listing_id, file_id);
CREATE INDEX IF NOT EXISTS ix_lsy_photo_ai ON public.lsy_photo_checks (ai_state, id);
COMMENT ON TABLE public.lsy_photo_checks IS 'v10.525 (D279) 매물 사진 품질 — 해상도 · 크기 · 비율 · 흐림 근사(JPG 픽셀당 비트) · 사진 속 연락처 글자(AI 통로 LSY_PHOTO · 있다 · 없다와 종류만 · 번호는 적지 않음) · 경고만(검수 · 게시를 막지 않음)';


/* ── ③ v10.526 매물 동영상 — 새 파일 용도 LISTING_VIDEO(MP4 · 50MB) ─────────── */
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  /* 합침 — D269 목록 그대로 + LISTING_VIDEO(D279). 빠지면 있는 파일이 있는 DB 에서 실패합니다 */
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA',
                              'LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC','NOTICE_ATTACHMENT','ACCT_EVIDENCE','CORP_DOC','HR_DOC','LGL_DOC',
                              'LISTING_VIDEO']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('LISTING_VIDEO', 'video/mp4', 52428800, 'mp4')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lsy_listing_videos (
  id                bigserial PRIMARY KEY,
  listing_id        uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  file_id           uuid NOT NULL REFERENCES public.files(id),
  owner_account_id  uuid NOT NULL REFERENCES public.accounts(id),
  state             text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'REPLACED', 'REMOVED')),
  duration_ms       integer NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 120000),
  width             integer CHECK (width IS NULL OR width > 0),
  height            integer CHECK (height IS NULL OR height > 0),
  bytes             bigint NOT NULL CHECK (bytes > 0 AND bytes <= 52428800),
  decided_by        uuid REFERENCES public.accounts(id),
  decided_at        timestamptz,
  decide_reason     text CHECK (decide_reason IS NULL OR char_length(decide_reason) <= 300),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (state NOT IN ('APPROVED', 'REJECTED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (state <> 'REJECTED' OR char_length(coalesce(decide_reason, '')) >= 2)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lsy_video_live ON public.lsy_listing_videos (listing_id) WHERE state IN ('PENDING', 'APPROVED');
CREATE INDEX IF NOT EXISTS ix_lsy_video_state ON public.lsy_listing_videos (state, id);
COMMENT ON TABLE public.lsy_listing_videos IS 'v10.526 (D279) 매물 동영상 — 매물마다 살아 있는 영상 1개(PENDING · APPROVED) · 파일은 주인이 올린 LISTING_VIDEO(READY) · 길이는 서버가 MP4 머리로 잼 · 운영 승인 뒤에만 공개(스위치 lsy.video)';

/* 붙이는 파일 — 그 매물 주인이 올린 LISTING_VIDEO · READY 만(서버가 먼저 보고 DB 가 마지막으로 막음) */
CREATE OR REPLACE FUNCTION public.fn_lsy_video_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.file_id IS DISTINCT FROM OLD.file_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.files f JOIN public.listings l ON l.id = NEW.listing_id
                    WHERE f.id = NEW.file_id AND f.purpose = 'LISTING_VIDEO' AND f.status = 'READY'
                      AND f.owner_account_id = l.owner_account_id AND NEW.owner_account_id = l.owner_account_id) THEN
      RAISE EXCEPTION 'LSY_VIDEO_FILE: 매물 주인이 올린 동영상 파일(LISTING_VIDEO · READY)만 붙입니다.';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state IN ('REJECTED', 'REPLACED', 'REMOVED') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'LSY_VIDEO_STATE: 끝난 동영상 줄은 되살리지 않습니다 — 새로 붙여 주십시오.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsy_video_guard' AND tgrelid = 'public.lsy_listing_videos'::regclass) THEN
    CREATE TRIGGER trg_lsy_video_guard BEFORE INSERT OR UPDATE ON public.lsy_listing_videos FOR EACH ROW EXECUTE FUNCTION public.fn_lsy_video_guard();
  END IF;
END $$;

/* 붙은(검수 대기 · 승인) 영상 파일은 지우지 못함 — 먼저 「영상 빼기」(공용 fn_files_guard 는 다시 쓰지 않고 따로 트리거 · D269 trg_lgl_files_guard 와 같은 방식) */
CREATE OR REPLACE FUNCTION public.fn_lsy_video_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED' AND OLD.purpose = 'LISTING_VIDEO'
     AND EXISTS (SELECT 1 FROM public.lsy_listing_videos v WHERE v.file_id = OLD.id AND v.state IN ('PENDING', 'APPROVED')) THEN
    RAISE EXCEPTION 'LSY_VIDEO_IN_USE: 매물에 붙은 동영상은 지울 수 없습니다 — 먼저 매물에서 빼 주십시오.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsy_video_file_guard' AND tgrelid = 'public.files'::regclass) THEN
    CREATE TRIGGER trg_lsy_video_file_guard BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.fn_lsy_video_file_guard();
  END IF;
END $$;


/* ── ④ v10.527 신고 자동 분류 · 우선순위(사람이 확정) ───────────────────── */
CREATE TABLE IF NOT EXISTS public.lsy_report_triage (
  id            bigserial PRIMARY KEY,
  report_id     uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  rule_kind     text NOT NULL,
  rule_urgency  text NOT NULL CHECK (rule_urgency IN ('U1', 'U2', 'U3', 'U4')),
  rule_why      text CHECK (rule_why IS NULL OR char_length(rule_why) <= 200),
  ai_state      text NOT NULL DEFAULT 'OFF' CHECK (ai_state IN ('OFF', 'TODO', 'PENDING', 'DONE', 'FAILED')),
  ai_kind       text,
  ai_urgency    text CHECK (ai_urgency IS NULL OR ai_urgency IN ('U1', 'U2', 'U3', 'U4')),
  ai_why        text CHECK (ai_why IS NULL OR char_length(ai_why) <= 200),
  ai_model      text,
  ai_engine     text CHECK (ai_engine IS NULL OR ai_engine IN ('MOCK', 'CLAUDE', 'N8N')),
  state         text NOT NULL DEFAULT 'SUGGESTED' CHECK (state IN ('SUGGESTED', 'CONFIRMED')),
  kind          text,
  urgency       text CHECK (urgency IS NULL OR urgency IN ('U1', 'U2', 'U3', 'U4')),
  changed       boolean NOT NULL DEFAULT false,
  note          text CHECK (note IS NULL OR char_length(note) <= 300),
  decided_by    uuid REFERENCES public.accounts(id),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (rule_kind IN ('FRAUD','FALSE_INFO','CONTACT_LEAK','RESTRICTED','DUPLICATE','SPAM','WRONG_CAT','ABUSE','OTHER')),
  CHECK (ai_kind IS NULL OR ai_kind IN ('FRAUD','FALSE_INFO','CONTACT_LEAK','RESTRICTED','DUPLICATE','SPAM','WRONG_CAT','ABUSE','OTHER')),
  CHECK (kind IS NULL OR kind IN ('FRAUD','FALSE_INFO','CONTACT_LEAK','RESTRICTED','DUPLICATE','SPAM','WRONG_CAT','ABUSE','OTHER')),
  CHECK (ai_state <> 'DONE' OR (ai_kind IS NOT NULL AND ai_urgency IS NOT NULL)),
  CHECK (state <> 'CONFIRMED' OR (kind IS NOT NULL AND urgency IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lsy_triage_report ON public.lsy_report_triage (report_id);
CREATE INDEX IF NOT EXISTS ix_lsy_triage_ai ON public.lsy_report_triage (ai_state, id);
COMMENT ON TABLE public.lsy_report_triage IS 'v10.527 (D279) 신고 분류 · 급함(U1 즉시 · U2 오늘 · U3 보통 · U4 낮음) — 규칙 제안 · AI 제안(통로 LSY_REPORT · 신고 글 · 대상 제목만 · 연락처 가림) · 사람이 확정(CONFIRMED) · 신고 처리(인정 · 기각)는 기존 신고 처리';


/* ── ⑤ AI 통로 LSY_PHOTO · LSY_REPORT — D276 위에 두 줄(스위치 lsy.photo_ai · lsy.report_ai · 처음 off) ── */
ALTER TABLE public.agent_usage_daily DROP CONSTRAINT IF EXISTS agent_usage_daily_channel_check;
ALTER TABLE public.agent_usage_daily ADD CONSTRAINT agent_usage_daily_channel_check
  CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE','TRANSLATE','BOARD','TOWN_PICK','RECEIPT','LSX_SUMMARY','LSY_PHOTO','LSY_REPORT'));

CREATE OR REPLACE FUNCTION public.fn_agent_allowed(p_channel text, OUT ok boolean, OUT reason text)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_cap numeric; v_sw text;
BEGIN
  ok := false;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') <> 'on' THEN reason := 'AGENT_OFF'; RETURN; END IF;
  v_sw := CASE p_channel WHEN 'REVIEW_SHADOW' THEN 'agent.review_shadow.enabled' WHEN 'SITE_CHAT' THEN 'agent.chat.enabled'
                         WHEN 'TRANSLATE' THEN 'i18n.auto_translate.enabled'   -- D118 번역
                         WHEN 'BOARD' THEN 'i18n.board_on_view'   -- D119 게시판 볼 때 번역
                         WHEN 'TOWN_PICK' THEN 'agent.town_pick.enabled'   -- D188 동네픽 AI
                         WHEN 'RECEIPT' THEN 'acct.receipt_ai'   -- D257 영수증 읽기
                         WHEN 'LSX_SUMMARY' THEN 'lsx.ai_summary'   -- D276 매물 AI 요약
                         WHEN 'LSY_PHOTO' THEN 'lsy.photo_ai'   -- D279 사진 속 연락처 글자
                         WHEN 'LSY_REPORT' THEN 'lsy.report_ai' END;   -- D279 신고 분류
  IF v_sw IS NULL THEN reason := 'CHANNEL_NOT_READY'; RETURN; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = v_sw), 'off') <> 'on' THEN reason := 'CHANNEL_OFF'; RETURN; END IF;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  IF v_cap <= 0 THEN reason := 'CAP_ZERO'; RETURN; END IF;
  IF public.fn_agent_month_cost() >= v_cap THEN reason := 'CAP_REACHED'; RETURN; END IF;
  ok := true; reason := NULL;
END $$;


/* ── ⑥ 설정 — 스위치 모두 처음 꺼짐(켜기 · 값 바꾸기 SUPER · 바뀐 기록은 「전체 설정」 기록 그대로) ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('lsy.dup_detect', 'off', 'ADMIN', '중복 매물 자동 탐지(v10.524 · D279) — on 이면 매시간 최근 바뀐 매물을 사진 지문(SHA-256) · 글 겹침 · 같은 연락처로 견주어 기준을 넘으면 짝으로 남김 · 처음 off', false, '^(on|off)$', 'off'),
  ('lsy.dup_threshold', '80', 'ADMIN', '중복 의심 기준 점수(50 ~ 100 · 처음 80 · v10.524)', false, '^(5[0-9]|[6-9][0-9]|100)$', '80'),
  ('lsy.dup_window_days', '60', 'ADMIN', '중복 견줄 기간(일 · 1 ~ 180 · 처음 60 · v10.524) — 이 기간 안에 만든 매물끼리', false, '^([1-9]|[1-9][0-9]|1[0-7][0-9]|180)$', '60'),
  ('lsy.dup_queue', 'on', 'ADMIN', '중복 짝의 나중 매물을 검수 대기에 올림(v10.524 · 처음 on — lsy.dup_detect 가 켜졌을 때만 동작 · 매물 상태는 그대로 · 자동으로 내리지 않음)', false, '^(on|off)$', 'on'),
  ('lsy.photo_check', 'off', 'ADMIN', '매물 사진 품질 검사(v10.525 · D279) — on 이면 매시간 해상도 · 크기 · 비율 · 흐림 근사를 보고 경고만(막지 않음) · 처음 off', false, '^(on|off)$', 'off'),
  ('lsy.photo_ai', 'off', 'ADMIN', '사진 속 연락처 글자 AI(v10.525) — on 이면 AI 로 사진에 전화번호 · 링크 · 메신저 아이디 글자가 보이는지만 봄(번호는 적지 않음) · AI 전체 스위치 · 월 상한 안에서만 · 처음 off', false, '^(on|off)$', 'off'),
  ('lsy.photo_min_px', '600', 'ADMIN', '사진 짧은 변 최소 픽셀(200 ~ 2000 · 처음 600 · v10.525) — 밑이면 「해상도가 낮음」 경고', false, '^([2-9][0-9]{2}|1[0-9]{3}|2000)$', '600'),
  ('lsy.photo_batch', '20', 'ADMIN', '사진 검사 한 번에 보는 수(매시간 · 1 ~ 50 · 처음 20 · v10.525)', false, '^([1-9]|[1-4][0-9]|50)$', '20'),
  ('lsy.video', 'off', 'ADMIN', '매물 동영상(v10.526 · D279) — on 이면 회원이 매물에 짧은 MP4 1개를 붙이고 운영 승인 뒤 상세에 보임 · 처음 off', false, '^(on|off)$', 'off'),
  ('lsy.video_max_mb', '30', 'ADMIN', '매물 동영상 최대 용량(MB · 1 ~ 50 · 처음 30 · 파일 용도 상한은 50MB · v10.526)', false, '^([1-9]|[1-4][0-9]|50)$', '30'),
  ('lsy.video_max_sec', '60', 'ADMIN', '매물 동영상 최대 길이(초 · 5 ~ 120 · 처음 60 · 서버가 MP4 머리로 잼 · v10.526)', false, '^([5-9]|[1-9][0-9]|1[01][0-9]|120)$', '60'),
  ('lsy.report_triage', 'off', 'ADMIN', '신고 자동 분류 · 우선순위(v10.527 · D279) — on 이면 10분마다 열린 신고에 종류 · 급함 제안(규칙) · 사람이 확정 · 처음 off', false, '^(on|off)$', 'off'),
  ('lsy.report_ai', 'off', 'ADMIN', '신고 AI 분류(v10.527) — on 이면 규칙 제안에 더해 AI 제안(신고 글 · 대상 제목만 · 연락처 가림) · AI 전체 스위치 · 월 상한 안에서만 · 처음 off', false, '^(on|off)$', 'off'),
  ('lsy.ai_model', '', 'ADMIN', '매물 품질 AI 모델(v10.525 · 527) — 비우면 agent.review_model · 요금표(agent_model_prices)에 있는 모델만', false, '^(|[a-z0-9][a-z0-9.-]{2,59})$', '')
ON CONFLICT (key) DO NOTHING;


/* ── ⑦ 정기 작업 ── */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('lsy_hourly', 60, NULL, NULL, NULL, true, '매물 품질 매시간 작업 — 중복 짝 찾기(lsy.dup_detect) · 사진 품질 검사(lsy.photo_check) · 사진 속 연락처 AI(lsy.photo_ai · AI 월 상한) · D279 · v10.524 · 525'),
  ('lsy_triage', 10, NULL, NULL, NULL, true, '신고 분류 10분 작업 — 규칙 분류(lsy.report_triage) · AI 분류(lsy.report_ai · AI 월 상한) · 사람이 확정 · D279 · v10.527')
ON CONFLICT (job) DO NOTHING;


/* ── ⑧ ㉕ 권한 시드(D258 모양) — 검수 묶음(admrev) 세 탭 · 위험감지 묶음(admrsk) 신고 분류 · 운영 관리자 모두 · 검수 담당은 검수 세 탭 · 세무사 없음(lsy- 앞머리) ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('lsy-dups', '매물 중복 의심', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 85),
  ('lsy-photos', '사진 품질', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 86),
  ('lsy-videos', '매물 동영상', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 87),
  ('lsy-triage', '신고 분류', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 21)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'lsy-dups', 'VIEW'), ('R_ADMIN', 'lsy-dups', 'EDIT'), ('R_ADMIN', 'lsy-dups', 'APPROVE'), ('R_ADMIN', 'lsy-dups', 'EXPORT'),
  ('R_ADMIN', 'lsy-photos', 'VIEW'), ('R_ADMIN', 'lsy-photos', 'EDIT'), ('R_ADMIN', 'lsy-photos', 'APPROVE'), ('R_ADMIN', 'lsy-photos', 'EXPORT'),
  ('R_ADMIN', 'lsy-videos', 'VIEW'), ('R_ADMIN', 'lsy-videos', 'EDIT'), ('R_ADMIN', 'lsy-videos', 'APPROVE'), ('R_ADMIN', 'lsy-videos', 'EXPORT'),
  ('R_ADMIN', 'lsy-triage', 'VIEW'), ('R_ADMIN', 'lsy-triage', 'EDIT'), ('R_ADMIN', 'lsy-triage', 'APPROVE'), ('R_ADMIN', 'lsy-triage', 'EXPORT'),
  ('R_REVIEWER', 'lsy-dups', 'VIEW'), ('R_REVIEWER', 'lsy-dups', 'EDIT'), ('R_REVIEWER', 'lsy-dups', 'APPROVE'), ('R_REVIEWER', 'lsy-dups', 'EXPORT'),
  ('R_REVIEWER', 'lsy-photos', 'VIEW'), ('R_REVIEWER', 'lsy-photos', 'EDIT'), ('R_REVIEWER', 'lsy-photos', 'APPROVE'), ('R_REVIEWER', 'lsy-photos', 'EXPORT'),
  ('R_REVIEWER', 'lsy-videos', 'VIEW'), ('R_REVIEWER', 'lsy-videos', 'EDIT'), ('R_REVIEWER', 'lsy-videos', 'APPROVE'), ('R_REVIEWER', 'lsy-videos', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/lsy/dups', 'lsy-dups', 'VIEW'),
  ('GET', '/admin/lsy/dups/{id}', 'lsy-dups', 'VIEW'),
  ('GET', '/admin/lsy/overview', 'lsy-dups', 'VIEW'),
  ('GET', '/admin/lsy/photos', 'lsy-photos', 'VIEW'),
  ('GET', '/admin/lsy/triage', 'lsy-triage', 'VIEW'),
  ('GET', '/admin/lsy/videos', 'lsy-videos', 'VIEW'),
  ('POST', '/admin/lsy/dups/scan', 'lsy-dups', 'EDIT'),
  ('POST', '/admin/lsy/dups/{id}/decide', 'lsy-dups', 'APPROVE'),
  ('POST', '/admin/lsy/photos/recheck', 'lsy-photos', 'EDIT'),
  ('POST', '/admin/lsy/triage/{id}/confirm', 'lsy-triage', 'APPROVE'),
  ('POST', '/admin/lsy/videos/{id}/decide', 'lsy-videos', 'APPROVE'),
  ('PUT', '/admin/lsy/settings', 'lsy-dups', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

