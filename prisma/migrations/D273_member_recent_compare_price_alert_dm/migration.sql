/* D273 (v10.501 ~ 504 · docs/639 ~ 642) ㊸ 회원 2 — 최근 본 매물 · 상품 · 비교하기 · 가격 변동 알림 · 회원 간 1:1 대화(모두 off) */

/* D273 (v10.501 ~ 504 · docs/639 ~ 642) ㊸ 회원 2 — 최근 본 매물 · 상품 · 비교하기 · 가격 변동 알림 · 회원 간 1:1 대화
 *   마이그레이션 #311 · prisma/migrations/D273_member_recent_compare_price_alert_dm/migration.sql
 *   다시 돌려도 같음(IF NOT EXISTS · ON CONFLICT DO NOTHING · 트리거는 있는지 보고 만듦) · 지우는 문장 없음
 *   스위치 4개 모두 처음 off — 켜기 전에는 회원 화면 · 기록 · 알림 모두 지금과 같음
 *   비교하기(v10.502)는 표가 없음(이 브라우저에만 담고 공개 칸만 읽음) */

/* ── ① 최근 본 매물 · 상품 (v10.501 · docs/639) ──────────────────────────────────────
 *   로그인 회원만 서버에(로그인 전은 브라우저 localStorage — 서버에 오지 않음) · 사람마다 mbx.recent_max(20)개까지(아래 트리거)
 *   보관: mbx.recent_keep_days(90)일 · 탈퇴 회원 것은 매일 04:35 mbx_daily 가 지움 */
CREATE TABLE IF NOT EXISTS public.mbx_recent_views (
  account_id   uuid NOT NULL REFERENCES public.accounts(id),
  target_type  text NOT NULL CHECK (target_type IN ('LISTING', 'PRODUCT')),
  target_id    uuid NOT NULL,
  viewed_at    timestamptz NOT NULL DEFAULT now(),
  view_count   integer NOT NULL DEFAULT 1 CHECK (view_count >= 1),
  PRIMARY KEY (account_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_mbx_recent_views_acc ON public.mbx_recent_views (account_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mbx_recent_views_at ON public.mbx_recent_views (viewed_at);
COMMENT ON TABLE public.mbx_recent_views IS 'v10.501 (D273) 최근 본 매물 · 상품 — 로그인 회원만 · 사람마다 mbx.recent_max 개(트리거가 오래된 것부터 지움) · mbx.recent_keep_days 지나면 mbx_daily 가 지움 · 처리방침 「서비스 이용 기록」(docs/639 4절)';

/* 사람마다 최대 개수 — 넣은 뒤 그 회원의 오래된 줄부터 지움(설정이 비거나 틀리면 20) */
CREATE OR REPLACE FUNCTION public.fn_mbx_recent_trim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max int;
BEGIN
  SELECT CASE WHEN value ~ '^[0-9]{1,2}$' AND value::int BETWEEN 5 AND 50 THEN value::int ELSE 20 END
    INTO v_max FROM public.site_settings WHERE key = 'mbx.recent_max';
  v_max := coalesce(v_max, 20);
  DELETE FROM public.mbx_recent_views v
   WHERE v.account_id = NEW.account_id
     AND (v.target_type, v.target_id) IN (
       SELECT x.target_type, x.target_id FROM public.mbx_recent_views x
        WHERE x.account_id = NEW.account_id ORDER BY x.viewed_at DESC, x.target_id OFFSET v_max);
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mbx_recent_trim' AND tgrelid = 'public.mbx_recent_views'::regclass) THEN
    CREATE TRIGGER trg_mbx_recent_trim AFTER INSERT ON public.mbx_recent_views FOR EACH ROW EXECUTE FUNCTION public.fn_mbx_recent_trim();
  END IF;
END $$;


/* ── ② 가격 변동 알림 (v10.503 · docs/641) ──────────────────────────────────────
 *   매물: 관심 목록(favorites)에 담은 것만 — 관심에서 빼면 아래 트리거가 알림도 지움 / 상품: 소개몰 찜이 없어 바로 한 줄
 *   기준값(base_*)과 지금 값이 다르면 매일 08:30 mbx_price_digest 가 회원마다 한 통(MBX_PRICE_DIGEST) → 기준값을 지금 값으로 */
CREATE TABLE IF NOT EXISTS public.mbx_price_watches (
  id               bigserial PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES public.accounts(id),
  target_type      text NOT NULL CHECK (target_type IN ('LISTING', 'PRODUCT')),
  target_id        uuid NOT NULL,
  drop_only        boolean NOT NULL DEFAULT false,
  base_price       numeric(16,0),
  base_fee         numeric(14,0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_checked_at  timestamptz,
  last_notified_at timestamptz,
  UNIQUE (account_id, target_type, target_id),
  CONSTRAINT ck_mbx_watch_fee CHECK (target_type = 'LISTING' OR base_fee IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_mbx_price_watches_target ON public.mbx_price_watches (target_type, target_id);
COMMENT ON TABLE public.mbx_price_watches IS 'v10.503 (D273) 가격 변동 알림 — 매물(관심 목록에 담은 것만 · 거래 금액 · 희망 소개비) · 상품(판매가) · 하루 1번 묶음 알림 · 회원이 직접 켬';

CREATE OR REPLACE FUNCTION public.fn_mbx_fav_unwatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.target_type = 'LISTING' THEN
    DELETE FROM public.mbx_price_watches WHERE account_id = OLD.account_id AND target_type = 'LISTING' AND target_id = OLD.target_id;
  END IF;
  RETURN OLD;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mbx_fav_unwatch' AND tgrelid = 'public.favorites'::regclass) THEN
    CREATE TRIGGER trg_mbx_fav_unwatch AFTER DELETE ON public.favorites FOR EACH ROW EXECUTE FUNCTION public.fn_mbx_fav_unwatch();
  END IF;
END $$;

/* 하루 한 통 — 보낸 날 기록(쌓기만 · 회원 · 날 고유) */
CREATE TABLE IF NOT EXISTS public.mbx_price_digests (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  sent_on     date NOT NULL,
  items       integer NOT NULL CHECK (items >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, sent_on)
);
COMMENT ON TABLE public.mbx_price_digests IS 'v10.503 (D273) 가격 변동 묶음 알림 보낸 날 — 회원마다 하루 한 번 · 바뀐 건수만(금액 · 매물 이름 없음)';


/* ── ③ 회원 간 1:1 대화 (v10.504 · docs/642) ──────────────────────────────────────
 *   거래(deals) · 문의 대화(conversations)의 당사자 두 사람 — 근거(basis)마다 한 대화(두 사람 순서는 a_id < b_id)
 *   글만(파일 없음 · 1 ~ 1,000자) · 글은 고치지 않음(읽음 표시만) · 지우는 것은 보관 기간 정리(app.mbx_purge)뿐
 *   신고된 대화만 운영자가 사유를 적고 엶(mbx_dm_admin_views · 쌓기만 + audit.pii_access_logs) */
CREATE TABLE IF NOT EXISTS public.mbx_dm_threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  basis_type       text NOT NULL CHECK (basis_type IN ('DEAL', 'INQUIRY')),
  basis_id         uuid NOT NULL,
  a_id             uuid NOT NULL REFERENCES public.accounts(id),
  b_id             uuid NOT NULL REFERENCES public.accounts(id),
  created_by       uuid NOT NULL REFERENCES public.accounts(id),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED')),
  locked_reason    text CHECK (locked_reason IS NULL OR char_length(locked_reason) <= 400),
  blocked_by       uuid REFERENCES public.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  CONSTRAINT ck_mbx_dm_pair CHECK (a_id < b_id),
  CONSTRAINT ck_mbx_dm_creator CHECK (created_by IN (a_id, b_id)),
  CONSTRAINT ck_mbx_dm_blocker CHECK (blocked_by IS NULL OR blocked_by IN (a_id, b_id)),
  CONSTRAINT ck_mbx_dm_lock CHECK (status = 'OPEN' OR locked_reason IS NOT NULL),
  UNIQUE (basis_type, basis_id, a_id, b_id)
);
CREATE INDEX IF NOT EXISTS idx_mbx_dm_threads_a ON public.mbx_dm_threads (a_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_mbx_dm_threads_b ON public.mbx_dm_threads (b_id, last_message_at DESC);
COMMENT ON TABLE public.mbx_dm_threads IS 'v10.504 (D273) 회원 간 1:1 대화 — 거래 · 문의 당사자끼리만(서비스가 근거를 봄) · 운영 조치로 닫힘(LOCKED) · 차단(blocked_by)';

/* 근거의 당사자인지 DB 도 봄(화면 · 서비스를 거치지 않고 넣어도 막음) */
CREATE OR REPLACE FUNCTION public.fn_mbx_dm_thread_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.basis_type <> OLD.basis_type OR NEW.basis_id <> OLD.basis_id OR NEW.a_id <> OLD.a_id OR NEW.b_id <> OLD.b_id OR NEW.created_by <> OLD.created_by THEN
      RAISE EXCEPTION 'MBX_DM: 대화의 근거와 당사자는 바꾸지 않습니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.basis_type = 'DEAL' THEN
    SELECT (NEW.a_id IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)
        AND NEW.b_id IN (d.buyer_account_id, d.seller_account_id, d.introducer_account_id)) INTO ok
      FROM public.deals d WHERE d.id = NEW.basis_id;
  ELSE
    SELECT (NEW.a_id IN (c.initiator_id, c.counterpart_id) AND NEW.b_id IN (c.initiator_id, c.counterpart_id)) INTO ok
      FROM public.conversations c WHERE c.id = NEW.basis_id;
  END IF;
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'MBX_DM: 거래 · 문의의 당사자끼리만 대화를 열 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mbx_dm_thread_guard' AND tgrelid = 'public.mbx_dm_threads'::regclass) THEN
    CREATE TRIGGER trg_mbx_dm_thread_guard BEFORE INSERT OR UPDATE ON public.mbx_dm_threads FOR EACH ROW EXECUTE FUNCTION public.fn_mbx_dm_thread_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mbx_dm_messages (
  id          bigserial PRIMARY KEY,
  thread_id   uuid NOT NULL REFERENCES public.mbx_dm_threads(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES public.accounts(id),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  masked      boolean NOT NULL DEFAULT false,
  hit_codes   text[] NOT NULL DEFAULT '{}' CHECK (hit_codes <@ ARRAY['PHONE', 'EMAIL', 'ACCOUNT', 'OFF_PLATFORM']::text[]),
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mbx_dm_messages_thread ON public.mbx_dm_messages (thread_id, id);
CREATE INDEX IF NOT EXISTS idx_mbx_dm_messages_sender ON public.mbx_dm_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mbx_dm_messages_at ON public.mbx_dm_messages (created_at);
COMMENT ON TABLE public.mbx_dm_messages IS 'v10.504 (D273) 회원 대화 글 — 글만 · 고치지 않음(읽음 표시만) · 감지한 종류(hit_codes · 연락처 · 메일 · 계좌 · 플랫폼 밖 표현) · 보관 mbx.dm_retention_days 뒤 mbx_daily 가 지움';

/* 보낸 사람 = 대화 당사자 · 글은 고치지 않음 · 지우기는 보관 기간 정리(app.mbx_purge = on)만 */
CREATE OR REPLACE FUNCTION public.fn_mbx_dm_msg_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a uuid; b uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('app.mbx_purge', true), '') <> 'on' THEN
      RAISE EXCEPTION 'MBX_DM: 대화 글은 보관 기간 정리로만 지웁니다.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.body <> OLD.body OR NEW.sender_id <> OLD.sender_id OR NEW.thread_id <> OLD.thread_id OR NEW.masked <> OLD.masked
       OR NEW.hit_codes <> OLD.hit_codes OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'MBX_DM: 보낸 글은 고치지 않습니다(읽음 표시만).';
    END IF;
    RETURN NEW;
  END IF;
  SELECT t.a_id, t.b_id INTO a, b FROM public.mbx_dm_threads t WHERE t.id = NEW.thread_id;
  IF NEW.sender_id IS DISTINCT FROM a AND NEW.sender_id IS DISTINCT FROM b THEN
    RAISE EXCEPTION 'MBX_DM: 대화 당사자만 보낼 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mbx_dm_msg_guard' AND tgrelid = 'public.mbx_dm_messages'::regclass) THEN
    CREATE TRIGGER trg_mbx_dm_msg_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mbx_dm_messages FOR EACH ROW EXECUTE FUNCTION public.fn_mbx_dm_msg_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mbx_dm_reports (
  id           bigserial PRIMARY KEY,
  thread_id    uuid NOT NULL REFERENCES public.mbx_dm_threads(id),
  reporter_id  uuid NOT NULL REFERENCES public.accounts(id),
  reason       text NOT NULL CHECK (reason IN ('OFF_PLATFORM', 'FRAUD', 'ABUSE', 'SPAM', 'PRIVACY', 'OTHER')),
  detail       text CHECK (detail IS NULL OR char_length(detail) <= 500),
  state        text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'UPHELD', 'DISMISSED')),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  decide_note  text CHECK (decide_note IS NULL OR char_length(decide_note) <= 400),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mbx_dm_report_done CHECK (state = 'OPEN' OR (decided_at IS NOT NULL AND decide_note IS NOT NULL)),
  CONSTRAINT ck_mbx_dm_report_other CHECK (reason <> 'OTHER' OR char_length(coalesce(detail, '')) >= 2)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mbx_dm_reports_open ON public.mbx_dm_reports (thread_id, reporter_id) WHERE state = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_mbx_dm_reports_state ON public.mbx_dm_reports (state, created_at);
COMMENT ON TABLE public.mbx_dm_reports IS 'v10.504 (D273) 회원 대화 신고 — 당사자만 · 처리 중이면 같은 사람이 또 못 냄 · 처리(조치 · 기각) 내용 필수 · 끝난 신고는 mbx.dm_report_keep_days 뒤 정리';

CREATE OR REPLACE FUNCTION public.fn_mbx_dm_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a uuid; b uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t.a_id, t.b_id INTO a, b FROM public.mbx_dm_threads t WHERE t.id = NEW.thread_id;
    IF NEW.reporter_id IS DISTINCT FROM a AND NEW.reporter_id IS DISTINCT FROM b THEN
      RAISE EXCEPTION 'MBX_DM: 대화 당사자만 신고할 수 있습니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'OPEN' THEN
    RAISE EXCEPTION 'MBX_DM: 처리한 신고는 고치지 않습니다.';
  END IF;
  IF NEW.thread_id <> OLD.thread_id OR NEW.reporter_id <> OLD.reporter_id OR NEW.reason <> OLD.reason OR NEW.detail IS DISTINCT FROM OLD.detail THEN
    RAISE EXCEPTION 'MBX_DM: 신고 내용은 고치지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mbx_dm_report_guard' AND tgrelid = 'public.mbx_dm_reports'::regclass) THEN
    CREATE TRIGGER trg_mbx_dm_report_guard BEFORE INSERT OR UPDATE ON public.mbx_dm_reports FOR EACH ROW EXECUTE FUNCTION public.fn_mbx_dm_report_guard();
  END IF;
END $$;

/* 운영자 열람 기록 — 쌓기만(대화가 정리돼도 남도록 대화 번호에 FK 를 걸지 않음) */
CREATE TABLE IF NOT EXISTS public.mbx_dm_admin_views (
  id         bigserial PRIMARY KEY,
  report_id  bigint NOT NULL,
  thread_id  uuid NOT NULL,
  actor_id   uuid NOT NULL REFERENCES public.accounts(id),
  reason     text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  viewed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mbx_dm_admin_views_report ON public.mbx_dm_admin_views (report_id);
COMMENT ON TABLE public.mbx_dm_admin_views IS 'v10.504 (D273) 신고된 회원 대화를 운영자가 연 기록 — 사유 필수 · 쌓기만(개인정보 접속기록 audit.pii_access_logs 에도 같이)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mbx_dm_admin_views_ro' AND tgrelid = 'public.mbx_dm_admin_views'::regclass) THEN
    CREATE TRIGGER trg_mbx_dm_admin_views_ro BEFORE UPDATE OR DELETE ON public.mbx_dm_admin_views FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 정리 기록 — 매일 04:35 mbx_daily(쌓기만 · 건수만) */
CREATE TABLE IF NOT EXISTS public.mbx_purges (
  id        bigserial PRIMARY KEY,
  ran_at    timestamptz NOT NULL DEFAULT now(),
  recent    integer NOT NULL DEFAULT 0,
  watches   integer NOT NULL DEFAULT 0,
  messages  integer NOT NULL DEFAULT 0,
  reports   integer NOT NULL DEFAULT 0,
  threads   integer NOT NULL DEFAULT 0,
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);
COMMENT ON TABLE public.mbx_purges IS 'v10.501 ~ 504 (D273) 회원 편의 기록 정리 — 최근 본 · 가격 알림(탈퇴) · 대화 글 · 끝난 신고 · 빈 대화 건수 · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mbx_purges_ro' AND tgrelid = 'public.mbx_purges'::regclass) THEN
    CREATE TRIGGER trg_mbx_purges_ro BEFORE UPDATE OR DELETE ON public.mbx_purges FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;


/* ── ④ 알림 종류 · 글 — 둘 다 회원이 끌 수 있음(나의공간 › 알림 · 설정) · 이름에 MARKETING · AD_ 없음 ── */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('MBX_PRICE_DIGEST', '관심 가격 변동', true, false, '회원이 직접 켠 가격 알림 — 하루 한 번 묶음(v10.503 · D273)', 'info'),
  ('MBX_DM_NEW', '회원 대화 새 글', true, false, '거래 · 문의 상대가 보낸 대화(v10.504 · D273)', 'info')
ON CONFLICT (event_code) DO NOTHING;
INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('MBX_PRICE_DIGEST_INAPP', 'INAPP', '관심 매물 · 상품 가격이 바뀌었습니다 ({count}건)',
   E'{lines}\n\n나의공간 › 가격 알림에서 끄거나 「내릴 때만」으로 바꿀 수 있습니다.', '["count","lines"]'::jsonb),
  ('MBX_DM_NEW_INAPP', 'INAPP', '{from}님이 대화를 보냈습니다',
   '거래 · 문의 상대가 회원 대화에 글을 남겼습니다. 연락처 · 계좌를 주고받아 플랫폼 밖에서 대금을 보내면 보호받기 어렵습니다.', '["from"]'::jsonb)
ON CONFLICT (code) DO NOTHING;


/* ── ⑤ 설정 — 스위치 4개 처음 off(켜기 SUPER · 운영 화면 회원 › 회원 편의 기능) ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('mbx.recent', 'off', 'ADMIN', '최근 본 매물 · 상품(v10.501 · D273) — on 이면 로그인 회원이 본 것을 서버에 적음(로그인 전은 브라우저에만) · 처음 off · 켜기 전 처리방침 「서비스 이용 기록」 게시(docs/639)', false, '^(on|off)$', 'off'),
  ('mbx.recent_max', '20', 'ADMIN', '최근 본 개수(사람마다 · 5 ~ 50 · 처음 20 · v10.501) — 넘으면 오래된 것부터 지움', false, '^([5-9]|[1-4][0-9]|50)$', '20'),
  ('mbx.recent_keep_days', '90', 'ADMIN', '최근 본 보관 일수(7 ~ 365 · 처음 90 · v10.501) — 지나면 매일 04:35 정리', false, '^([7-9]|[1-9][0-9]|[12][0-9]{2}|3[0-5][0-9]|36[0-5])$', '90'),
  ('mbx.compare', 'off', 'ADMIN', '비교하기(v10.502 · D273) — on 이면 매물끼리 · 상품끼리 최대 4개를 공개 칸만 나란히(담는 목록은 브라우저에만) · 처음 off', false, '^(on|off)$', 'off'),
  ('mbx.price_alert', 'off', 'ADMIN', '가격 변동 알림(v10.503 · D273) — on 이면 회원이 관심 매물 · 상품에 켠 알림을 매일 08:30 묶음으로(알림 수신 설정 따름) · 처음 off', false, '^(on|off)$', 'off'),
  ('mbx.price_watch_max', '50', 'ADMIN', '가격 알림 개수(사람마다 · 1 ~ 200 · 처음 50 · v10.503)', false, '^([1-9]|[1-9][0-9]|1[0-9]{2}|200)$', '50'),
  ('mbx.dm', 'off', 'ADMIN', '회원 간 1:1 대화(v10.504 · D273) — on 이면 거래 · 문의 당사자끼리 글로 대화 · 처음 off · 켜기 전 법무 확인 · 처리방침 「회원 대화」 게시(docs/642)', false, '^(on|off)$', 'off'),
  ('mbx.dm_pattern_mode', 'MASK', 'ADMIN', '회원 대화 연락처 · 계좌 · 메일 감지(v10.504) — WARN 경고 뒤 그대로 · MASK 경고 뒤 가려서(처음) · BLOCK 보내지 않음', false, '^(WARN|MASK|BLOCK)$', 'MASK'),
  ('mbx.dm_rate_per_min', '10', 'ADMIN', '회원 대화 1분에 보내는 수(1 ~ 60 · 처음 10 · v10.504)', false, '^([1-9]|[1-5][0-9]|60)$', '10'),
  ('mbx.dm_rate_per_day', '300', 'ADMIN', '회원 대화 하루 보내는 수(10 ~ 2000 · 처음 300 · v10.504)', false, '^([1-9][0-9]|[1-9][0-9]{2}|1[0-9]{3}|2000)$', '300'),
  ('mbx.dm_retention_days', '365', 'ADMIN', '회원 대화 글 보관 일수(30 ~ 1825 · 처음 365 · v10.504) — 보낸 날부터 지나면 매일 04:35 지움 · 처리 중 신고가 있는 대화는 남김(법무 확인)', false, '^([3-9][0-9]|[1-9][0-9]{2}|1[0-7][0-9]{2}|18[01][0-9]|182[0-5])$', '365'),
  ('mbx.dm_report_keep_days', '180', 'ADMIN', '처리 끝난 신고 대화 보관 일수(30 ~ 1825 · 처음 180 · v10.504) — 처리한 날부터', false, '^([3-9][0-9]|[1-9][0-9]{2}|1[0-7][0-9]{2}|18[01][0-9]|182[0-5])$', '180')
ON CONFLICT (key) DO NOTHING;


/* ── ⑥ 정기 작업 ── */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('mbx_price_digest', 1440, 8, 30, NULL, true, '가격 변동 묶음 알림 — 매일 08:30 · 회원마다 한 통(MBX_PRICE_DIGEST) · mbx.price_alert on 일 때만 · D273 · v10.503'),
  ('mbx_daily', 1440, 4, 35, NULL, true, '회원 편의 기록 정리 — 매일 04:35 · 최근 본 보관 기간 · 대화 글 보관 기간 · 끝난 신고 · 탈퇴 회원 기록(스위치와 상관없이) · D273 · v10.501 ~ 504')
ON CONFLICT (job) DO NOTHING;


/* ── ⑦ ㉕ 권한(D258) 시드에 새 탭 2개 — gen_seed.py 와 같은 규칙
 *   mbx-ops · mbx-dm(따로 적지 않은 탭 = ADMIN · 회원 묶음 admusr)
 *   주소 규칙: GET = VIEW · /decide 끝 = APPROVE · 그 밖 변경 = EDIT */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('mbx-ops', '회원 편의 기능', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2920),
  ('mbx-dm', '회원 대화 신고', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2930)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'mbx-ops', 'VIEW'), ('R_ADMIN', 'mbx-ops', 'EDIT'), ('R_ADMIN', 'mbx-ops', 'APPROVE'), ('R_ADMIN', 'mbx-ops', 'EXPORT'),
  ('R_ADMIN', 'mbx-dm', 'VIEW'), ('R_ADMIN', 'mbx-dm', 'EDIT'), ('R_ADMIN', 'mbx-dm', 'APPROVE'), ('R_ADMIN', 'mbx-dm', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/mbx/overview', 'mbx-ops', 'VIEW'),
  ('PUT', '/admin/mbx/settings', 'mbx-ops', 'EDIT'),
  ('GET', '/admin/mbx/dm/reports', 'mbx-dm', 'VIEW'),
  ('POST', '/admin/mbx/dm/reports/{id}/open', 'mbx-dm', 'EDIT'),
  ('POST', '/admin/mbx/dm/reports/{id}/decide', 'mbx-dm', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

