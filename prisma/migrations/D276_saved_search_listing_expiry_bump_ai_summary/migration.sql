/* D276 (v10.513 ~ 516 · docs/651 ~ 654) ㊻ 매물 — 저장한 검색 알림 · 매물 만료(관리자 지정 · 기본 6개월) · 끌어올리기(OFF/FREE/PAID 관리자 전환) · 매물 AI 요약(모두 off) */

/* =====================================================================
 * D276 (#314) v10.513 ~ 516 ㊻ 매물 — 저장한 검색 · 새 매물 알림 · 매물 만료 · 연장 · 끌어올리기 · 매물 AI 요약
 *   docs/651 ~ 654 · 대표 11/20 「지금 바로 동시 착수」 · 만료(대표 결정 11/20 ①) · 끌어올리기(대표 결정 11/20 ②)
 *   다시 돌려도 같음(IF NOT EXISTS · ON CONFLICT DO NOTHING · CREATE OR REPLACE · 트리거는 있으면 건너뜀).
 *   매물 표(listings)는 칸을 더하지도 고치지도 않음 — 만료일 · 끌어올림은 따로 표(listings 의 BEFORE UPDATE 트리거 11개를 건드리지 않으려고).
 *   스위치는 모두 처음 꺼짐(lsx.saved_search · lsx.expiry · lsx.bump_mode=OFF · lsx.ai_summary).
 * ===================================================================== */

/* ── ① v10.513 저장한 검색 · 새 매물 하루 묶음 알림 ─────────────────────────── */
CREATE TABLE IF NOT EXISTS public.lsx_saved_searches (
  id              bigserial PRIMARY KEY,
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  gwan_code       text CHECK (gwan_code IS NULL OR gwan_code ~ '^(MNY|MAL|BIZ|HLT)$'),
  category_id     uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  keyword         text CHECK (keyword IS NULL OR char_length(keyword) BETWEEN 2 AND 60),
  region_code     text CHECK (region_code IS NULL OR region_code ~ '^[0-9A-Z]{2,10}$'),
  axis            text CHECK (axis IS NULL OR axis ~ '^(RE|EQUIP|CONSULT)$'),
  notify          boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (gwan_code IS NOT NULL OR category_id IS NOT NULL OR keyword IS NOT NULL OR region_code IS NOT NULL OR axis IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_lsx_saved_acct ON public.lsx_saved_searches (account_id, id);
CREATE INDEX IF NOT EXISTS ix_lsx_saved_notify ON public.lsx_saved_searches (account_id) WHERE notify;
COMMENT ON TABLE public.lsx_saved_searches IS 'v10.513 (D276) 회원이 저장한 매물 검색 조건 — 사람마다 lsx.saved_search_max(10)개 · 새 매물 하루 묶음 알림(LSX_SAVED_SEARCH · 알림 설정 따름)';

/* 사람마다 최대 개수 — 서비스가 먼저 보고(422 LSX_SAVED_MAX) DB 가 마지막으로 막음 */
CREATE OR REPLACE FUNCTION public.fn_lsx_saved_max() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max int; v_n int;
BEGIN
  v_max := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'lsx.saved_search_max'), '')::int, 10);
  PERFORM pg_advisory_xact_lock(hashtextextended('lsx-saved:' || NEW.account_id::text, 0));
  SELECT count(*) INTO v_n FROM lsx_saved_searches WHERE account_id = NEW.account_id;
  IF v_n >= v_max THEN
    RAISE EXCEPTION 'LSX_SAVED_MAX: 저장한 검색이 최대 개수에 닿았습니다. 쓰지 않는 검색을 지운 뒤 저장해 주십시오.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsx_saved_max' AND tgrelid = 'public.lsx_saved_searches'::regclass) THEN
    CREATE TRIGGER trg_lsx_saved_max BEFORE INSERT ON public.lsx_saved_searches FOR EACH ROW EXECUTE FUNCTION public.fn_lsx_saved_max();
  END IF;
END $$;

/* 하루 한 통 — (회원 · 한국 날짜) 하나 · 쌓기만 */
CREATE TABLE IF NOT EXISTS public.lsx_search_digests (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  day         date NOT NULL,
  searches    integer NOT NULL CHECK (searches >= 1),
  total       integer NOT NULL CHECK (total >= 1),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, day)
);
COMMENT ON TABLE public.lsx_search_digests IS 'v10.513 (D276) 저장한 검색 하루 묶음 알림 보낸 기록 — 회원 · 한국 날짜마다 한 줄(두 번 보내지 않음) · 건수만(검색어 없음) · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsx_digests_ro' AND tgrelid = 'public.lsx_search_digests'::regclass) THEN
    CREATE TRIGGER trg_lsx_digests_ro BEFORE UPDATE ON public.lsx_search_digests FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;


/* ── ② v10.514 매물 만료 · 연장(대표 결정 11/20 — 등록 확정 때 운영자가 만료일 · 기본 6개월 · 연장은 운영자만) ── */
CREATE TABLE IF NOT EXISTS public.lsx_listing_expiry (
  listing_id  uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  set_kind    text NOT NULL CHECK (set_kind IN ('DEFAULT', 'REVIEW', 'ADMIN', 'EXTEND', 'BACKFILL', 'GRACE')),
  set_by      uuid REFERENCES public.accounts(id),
  set_at      timestamptz NOT NULL DEFAULT now(),
  warned_for  timestamptz,
  expired_at  timestamptz,
  expired_fp  text
);
CREATE INDEX IF NOT EXISTS ix_lsx_expiry_at ON public.lsx_listing_expiry (expires_at);
COMMENT ON TABLE public.lsx_listing_expiry IS 'v10.514 (D276) 매물 노출 만료일 — 게시 확정 때 정함(검수 승인 칸 · 안 보내면 lsx.expiry_default_months) · 연장은 운영자만 · expired_at = 만료로 내린 시각(지우지 않음) · expired_fp = 내릴 때 내용 지문(fn_lsx_listing_fp · 다시 게시 때 바뀌었으면 검수) · 스위치 lsx.expiry 가 꺼져 있으면 날짜만 저장 · 표시';

CREATE TABLE IF NOT EXISTS public.lsx_expiry_log (
  id          bigserial PRIMARY KEY,
  listing_id  uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('SET', 'WARN', 'EXPIRED', 'RESTORE', 'QUEUED', 'FAIL')),
  old_at      timestamptz,
  new_at      timestamptz,
  set_kind    text,
  actor_id    uuid REFERENCES public.accounts(id),
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_lsx_expiry_log ON public.lsx_expiry_log (listing_id, id DESC);
COMMENT ON TABLE public.lsx_expiry_log IS 'v10.514 (D276) 만료일 바뀐 기록 · 예고 · 만료로 내림 · 되살림 · 내리기 실패 — 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsx_expiry_log_ro' AND tgrelid = 'public.lsx_expiry_log'::regclass) THEN
    CREATE TRIGGER trg_lsx_expiry_log_ro BEFORE UPDATE ON public.lsx_expiry_log FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 회원은 「연장 요청」만 — 운영자가 승인(새 만료일) · 반려(사유) */
CREATE TABLE IF NOT EXISTS public.lsx_extend_requests (
  id              bigserial PRIMARY KEY,
  listing_id      uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES public.accounts(id),
  months          integer NOT NULL CHECK (months IN (1, 3, 6, 12)),
  note            text CHECK (note IS NULL OR char_length(note) <= 200),
  state           text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  decided_by      uuid REFERENCES public.accounts(id),
  decided_at      timestamptz,
  decide_reason   text CHECK (decide_reason IS NULL OR char_length(decide_reason) <= 300),
  new_expires_at  timestamptz,
  req_fp          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (state = 'REQUESTED' OR decided_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lsx_extend_open ON public.lsx_extend_requests (listing_id) WHERE state = 'REQUESTED';
COMMENT ON TABLE public.lsx_extend_requests IS 'v10.514 (D276) 매물 연장 요청 — 회원은 요청만(매물마다 열린 요청 하나) · 승인 · 반려는 운영자(사유 · 감사)';

/* 매물 내용 지문(대표 결정 11/20 ② — 만료 뒤 · 연장 요청 뒤 내용이 바뀌었을 때만 검수)
 *   매물 줄에서 상태 · 판 · 숫자 · 시각 같은 바뀌어도 내용이 아닌 칸을 뺀 나머지 + 사진(파일 · 차례) + 지역 · 모르는 새 칸은 내용으로 셈(바뀌면 검수 쪽 — 안전한 쪽) */
CREATE OR REPLACE FUNCTION public.fn_lsx_listing_fp(p_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(
           ((to_jsonb(l) - ARRAY['status', 'version', 'view_count', 'like_count', 'updated_at', 'published_at', 'created_at', 'review_checked_at',
                                 'review_no', 'badge_urgent_until', 'badge_verified_at', 'is_priority_exposed', 'priority_label', 'listing_no',
                                 'geo_lat', 'geo_lng', 'geo_checked_at', 'geo_status'])::text)
           || '|' || coalesce((SELECT string_agg(coalesce(m.file_id::text, m.s3_key), ',' ORDER BY m.sort_order, m.created_at) FROM listing_media m WHERE m.listing_id = l.id), '')
           || '|' || coalesce((SELECT string_agg(r.region_code, ',' ORDER BY r.region_code) FROM listing_regions r WHERE r.listing_id = l.id), ''))
    FROM listings l WHERE l.id = p_id
$$;

/* 게시로 바뀌는 순간 만료일 기본값(검수 승인 · 자동 승인 · 운영 되살림 모두) — 다시 게시할 때 남은 만료일이 있으면 그대로 */
CREATE OR REPLACE FUNCTION public.fn_lsx_expiry_default() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_m int; v_new timestamptz; v_old timestamptz;
BEGIN
  IF NEW.status <> 'PUBLISHED' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'PUBLISHED' THEN RETURN NULL; END IF;
  v_m := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'lsx.expiry_default_months'), '')::int, 6);
  v_new := now() + make_interval(months => v_m);
  SELECT expires_at INTO v_old FROM lsx_listing_expiry WHERE listing_id = NEW.id;
  IF v_old IS NOT NULL AND v_old > now() THEN
    UPDATE lsx_listing_expiry SET expired_at = NULL, expired_fp = NULL WHERE listing_id = NEW.id AND expired_at IS NOT NULL;
    RETURN NULL;
  END IF;
  INSERT INTO lsx_listing_expiry (listing_id, expires_at, set_kind, set_at, warned_for, expired_at)
  VALUES (NEW.id, v_new, 'DEFAULT', now(), NULL, NULL)
  ON CONFLICT (listing_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, set_kind = 'DEFAULT', set_by = NULL,
                                         set_at = now(), warned_for = NULL, expired_at = NULL, expired_fp = NULL;
  INSERT INTO lsx_expiry_log (listing_id, kind, old_at, new_at, set_kind, reason)
  VALUES (NEW.id, 'SET', v_old, v_new, 'DEFAULT', '게시 확정 — 기본 기간');
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsx_expiry_default' AND tgrelid = 'public.listings'::regclass) THEN
    CREATE TRIGGER trg_lsx_expiry_default AFTER INSERT OR UPDATE OF status ON public.listings
      FOR EACH ROW EXECUTE FUNCTION public.fn_lsx_expiry_default();
  END IF;
END $$;

/* 처음 적용 — 이미 게시 중인 매물: 게시일 + 6개월 · 이미 지났으면 적용일 + 30일 유예(한꺼번에 내려가지 않게) · 매물 표는 고치지 않음 */
WITH ins AS (
  INSERT INTO public.lsx_listing_expiry (listing_id, expires_at, set_kind, set_at)
  SELECT l.id,
         CASE WHEN coalesce(l.published_at, now()) + interval '6 months' > now() + interval '30 days'
              THEN coalesce(l.published_at, now()) + interval '6 months'
              ELSE now() + interval '30 days' END,
         'BACKFILL', now()
    FROM public.listings l
   WHERE l.status = 'PUBLISHED'
     AND NOT EXISTS (SELECT 1 FROM public.lsx_listing_expiry e WHERE e.listing_id = l.id)
  ON CONFLICT (listing_id) DO NOTHING
  RETURNING listing_id, expires_at)
INSERT INTO public.lsx_expiry_log (listing_id, kind, new_at, set_kind, reason)
SELECT listing_id, 'SET', expires_at, 'BACKFILL', 'D276 처음 적용 — 게시일 + 6개월(지났으면 적용일 + 30일)' FROM ins;


/* ── ③ v10.515 끌어올리기(대표 결정 11/20 — 방식 OFF · FREE · PAID 를 운영자가 바꿈 · 노출 가산은 방식과 상관없이 같은 상한 · 감쇠) ── */
CREATE TABLE IF NOT EXISTS public.lsx_bump_payments (
  id             bigserial PRIMARY KEY,
  payment_key    text NOT NULL UNIQUE CHECK (char_length(payment_key) BETWEEN 1 AND 200),
  order_id       text NOT NULL UNIQUE CHECK (order_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  account_id     uuid NOT NULL REFERENCES public.accounts(id),
  listing_id     uuid NOT NULL REFERENCES public.listings(id),
  supply         bigint NOT NULL CHECK (supply > 0),
  vat            bigint NOT NULL DEFAULT 0 CHECK (vat >= 0),
  amount         bigint NOT NULL CHECK (amount = supply + vat),
  stub           boolean NOT NULL DEFAULT false,
  paid_at        timestamptz NOT NULL DEFAULT now(),
  refunded_at    timestamptz,
  refund_amount  bigint CHECK (refund_amount IS NULL OR (refund_amount > 0 AND refund_amount <= amount)),
  refund_reason  text CHECK (refund_reason IS NULL OR char_length(refund_reason) BETWEEN 2 AND 300),
  refunded_by    uuid REFERENCES public.accounts(id),
  CHECK ((refunded_at IS NULL) = (refund_amount IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_lsx_bpay_acct ON public.lsx_bump_payments (account_id, paid_at DESC);
COMMENT ON TABLE public.lsx_bump_payments IS 'v10.515 (D276) 끌어올리기 결제(PAID 방식) — 1회 금액(공급가) + 부가세(D243 별도 시작일 뒤) · 결제 키 한 번만 · 결제 승인 뒤에만 끌어올림 · 환불은 운영(SUPER · 사유) · 전표 LSX_BUMP_PAID · LSX_BUMP_REFUND';

/* 결제 줄은 환불 칸만 한 번 채움 · 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_lsx_bump_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LSX_PAYMENT_RO: 끌어올리기 결제 기록은 지우지 않습니다.';
  END IF;
  IF OLD.refunded_at IS NOT NULL
     OR NEW.payment_key IS DISTINCT FROM OLD.payment_key OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
     OR NEW.supply IS DISTINCT FROM OLD.supply OR NEW.vat IS DISTINCT FROM OLD.vat OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.stub IS DISTINCT FROM OLD.stub OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'LSX_PAYMENT_RO: 끌어올리기 결제 기록은 환불 칸만 한 번 채웁니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsx_bump_payment_guard' AND tgrelid = 'public.lsx_bump_payments'::regclass) THEN
    CREATE TRIGGER trg_lsx_bump_payment_guard BEFORE UPDATE OR DELETE ON public.lsx_bump_payments FOR EACH ROW EXECUTE FUNCTION public.fn_lsx_bump_payment_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.lsx_bumps (
  id          bigserial PRIMARY KEY,
  listing_id  uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  kind        text NOT NULL CHECK (kind IN ('FREE', 'PAID', 'ADMIN')),
  sort_at     timestamptz NOT NULL,
  until_at    timestamptz NOT NULL,
  payment_id  bigint REFERENCES public.lsx_bump_payments(id),
  actor_id    uuid REFERENCES public.accounts(id),
  reason_kind text CHECK (reason_kind IS NULL OR reason_kind IN ('FIX_ERROR', 'MEMBER_REQUEST')),
  reason      text CHECK (reason IS NULL OR char_length(reason) BETWEEN 2 AND 300),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (until_at > sort_at AND until_at <= sort_at + interval '168 hours'),
  CHECK ((kind = 'PAID') = (payment_id IS NOT NULL)),
  CHECK ((kind = 'ADMIN') = (reason_kind IS NOT NULL)),
  CHECK (kind <> 'ADMIN' OR (actor_id IS NOT NULL AND reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_lsx_bumps_listing ON public.lsx_bumps (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_lsx_bumps_acct ON public.lsx_bumps (account_id, kind, created_at DESC);
COMMENT ON TABLE public.lsx_bumps IS 'v10.515 (D276) 끌어올리기 기록 — 회원 무료(FREE) · 유료(PAID · 결제 줄) · 운영 바로잡기(ADMIN · SUPER 만 · 사유 종류 FIX_ERROR 오류 바로잡기 · MEMBER_REQUEST 회원 요청 대신 + 글 사유 · 대표 결정 11/20) · 효과 시간 상한 168시간(DB) · 쌓기만';

/* 운영 바로잡기는 SUPER 만(대표 결정 11/20 ①) — 서버 @Roles('SUPER') 와 같은 규칙을 DB 도 봄 */
CREATE OR REPLACE FUNCTION public.fn_lsx_admin_bump_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'ADMIN' AND NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = NEW.actor_id AND r.role = 'SUPER') THEN
    RAISE EXCEPTION 'LSX_ADMIN_BUMP_SUPER: 운영 끌어올리기(바로잡기)는 SUPER 만 할 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsx_admin_bump_guard' AND tgrelid = 'public.lsx_bumps'::regclass) THEN
    CREATE TRIGGER trg_lsx_admin_bump_guard BEFORE INSERT ON public.lsx_bumps FOR EACH ROW EXECUTE FUNCTION public.fn_lsx_admin_bump_guard();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsx_bumps_ro' AND tgrelid = 'public.lsx_bumps'::regclass) THEN
    CREATE TRIGGER trg_lsx_bumps_ro BEFORE UPDATE ON public.lsx_bumps FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 지금 효과가 있는 끌어올림(매물마다 한 줄) — 최신순(RECENT) 정렬이 이 시각을 게시 시각과 견줘 큰 쪽을 씀(앞날 시각 없음 · 효과 끝나면 정기 작업이 지움) */
CREATE TABLE IF NOT EXISTS public.lsx_bump_live (
  listing_id  uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  bump_id     bigint NOT NULL REFERENCES public.lsx_bumps(id),
  kind        text NOT NULL CHECK (kind IN ('FREE', 'PAID', 'ADMIN')),
  sort_at     timestamptz NOT NULL,
  until_at    timestamptz NOT NULL,
  CHECK (until_at > sort_at AND until_at <= sort_at + interval '168 hours')
);
CREATE INDEX IF NOT EXISTS ix_lsx_bump_live_until ON public.lsx_bump_live (until_at);
COMMENT ON TABLE public.lsx_bump_live IS 'v10.515 (D276) 효과 중인 끌어올림 — 최신순 정렬 키 = greatest(게시 시각, sort_at) · sort_at 은 끌어올린 시각(미래 없음) · until_at 지나면 lsx_hourly 가 지워 원래 자리 · 방식(무료 · 유료 · 운영)과 상관없이 같은 상한';

/* 앞날 시각 · 상한 넘는 효과를 DB 가 막음(서비스와 같은 규칙) */
CREATE OR REPLACE FUNCTION public.fn_lsx_bump_live_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_h int;
BEGIN
  v_h := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'lsx.bump_effect_hours'), '')::int, 72);
  IF NEW.sort_at > clock_timestamp() + interval '1 minute' THEN
    RAISE EXCEPTION 'LSX_BUMP_FUTURE: 끌어올린 시각은 앞날일 수 없습니다.';
  END IF;
  IF NEW.until_at > NEW.sort_at + make_interval(hours => v_h) + interval '1 minute' THEN
    RAISE EXCEPTION 'LSX_BUMP_CAP: 끌어올리기 효과 시간이 상한을 넘습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lsx_bump_live_guard' AND tgrelid = 'public.lsx_bump_live'::regclass) THEN
    CREATE TRIGGER trg_lsx_bump_live_guard BEFORE INSERT OR UPDATE ON public.lsx_bump_live FOR EACH ROW EXECUTE FUNCTION public.fn_lsx_bump_live_guard();
  END IF;
END $$;

/* 전표 계정 초안(세무사 확인 · 계정 코드만 운영 화면에서 고침) */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, draft) VALUES
  ('REV_BUMP', '끌어올리기 매출', 'REVENUE', '404', '용역매출', 115, 'v10.515 (D276) 매물 끌어올리기 유료 결제(PAID 방식) · 부가세 별도(D243) · 환불은 반대 · 계정은 초안 — 세무사 확인', true)
ON CONFLICT (role) DO NOTHING;


/* ── ④ v10.516 매물 AI 요약(기존 AI 어댑터 · 월 상한 · 검수 뒤 공개) ─────────────── */
CREATE TABLE IF NOT EXISTS public.lsx_ai_summaries (
  id               bigserial PRIMARY KEY,
  listing_id       uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  listing_version  integer NOT NULL CHECK (listing_version >= 1),
  state            text NOT NULL CHECK (state IN ('QUEUED', 'PENDING', 'DRAFT', 'APPROVED', 'REJECTED', 'STALE', 'FAILED')),
  body             text CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 400),
  model            text,
  engine           text CHECK (engine IS NULL OR engine IN ('MOCK', 'CLAUDE', 'N8N')),
  note             text CHECK (note IS NULL OR char_length(note) <= 300),
  in_tokens        integer NOT NULL DEFAULT 0,
  out_tokens       integer NOT NULL DEFAULT 0,
  requested_by     uuid REFERENCES public.accounts(id),
  decided_by       uuid REFERENCES public.accounts(id),
  decided_at       timestamptz,
  decide_reason    text CHECK (decide_reason IS NULL OR char_length(decide_reason) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (state NOT IN ('DRAFT', 'APPROVED') OR body IS NOT NULL),
  CHECK (state NOT IN ('APPROVED', 'REJECTED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lsx_ai_live ON public.lsx_ai_summaries (listing_id, listing_version) WHERE state <> 'STALE';
CREATE INDEX IF NOT EXISTS ix_lsx_ai_state ON public.lsx_ai_summaries (state, created_at);
COMMENT ON TABLE public.lsx_ai_summaries IS 'v10.516 (D276) 매물 AI 3줄 요약 — 초안(DRAFT)은 비공개 · 운영자 승인(APPROVED) 뒤 그 매물 판(version)이 같을 때만 상세에 「AI 요약」 표시 · 매물을 고치면 판이 달라져 내려감 · AI 통로 LSX_SUMMARY(스위치 lsx.ai_summary · 월 상한)';

/* AI 통로 LSX_SUMMARY — D257 위에 한 줄(스위치 lsx.ai_summary · 처음 off) */
ALTER TABLE public.agent_usage_daily DROP CONSTRAINT IF EXISTS agent_usage_daily_channel_check;
ALTER TABLE public.agent_usage_daily ADD CONSTRAINT agent_usage_daily_channel_check
  CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE','TRANSLATE','BOARD','TOWN_PICK','RECEIPT','LSX_SUMMARY'));

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
                         WHEN 'LSX_SUMMARY' THEN 'lsx.ai_summary' END;   -- D276 매물 AI 요약
  IF v_sw IS NULL THEN reason := 'CHANNEL_NOT_READY'; RETURN; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = v_sw), 'off') <> 'on' THEN reason := 'CHANNEL_OFF'; RETURN; END IF;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  IF v_cap <= 0 THEN reason := 'CAP_ZERO'; RETURN; END IF;
  IF public.fn_agent_month_cost() >= v_cap THEN reason := 'CAP_REACHED'; RETURN; END IF;
  ok := true; reason := NULL;
END $$;


/* ── ⑤ 알림 종류 · 글(나의공간 › 알림) · 이름에 MARKETING · AD_ 없음 ── */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('LSX_SAVED_SEARCH', '저장한 검색 새 매물', true, false, '회원이 직접 저장한 검색 조건의 새 매물 — 하루 한 번 묶음(v10.513 · D276)', 'info'),
  ('LSX_EXPIRY_SOON', '매물 노출 기간 끝남 예고', false, false, '내 매물의 노출 기간 안내 — 서비스 이용 통지(v10.514 · D276)', 'warn'),
  ('LSX_EXPIRED', '매물 노출 기간 끝남', false, false, '내 매물을 만료로 내림 — 서비스 이용 통지(v10.514 · D276)', 'warn'),
  ('LSX_EXTEND_OK', '매물 연장 승인', false, false, '연장 요청 처리 결과 통지(v10.514 · D276)', 'info'),
  ('LSX_EXTEND_NO', '매물 연장 반려', false, false, '연장 요청 처리 결과 통지(v10.514 · D276)', 'warn')
ON CONFLICT (event_code) DO NOTHING;
INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('LSX_SAVED_SEARCH_INAPP', 'INAPP', '저장한 검색에 새 매물 {count}건',
   E'{names} 조건에 새로 올라온 매물이 있습니다.\n나의공간 › 저장한 검색에서 보거나 알림을 끌 수 있습니다.', '["count","names"]'::jsonb),
  ('LSX_EXPIRY_SOON_INAPP', 'INAPP', '매물 노출이 {date}에 끝납니다',
   '「{title}」 매물은 {date}에 노출 기간이 끝나 목록에서 내려갑니다(지우지 않음). 계속 올리려면 나의공간 › 매물 관리 도구에서 연장을 요청해 주십시오 — 운영자가 확인합니다.', '["title","date"]'::jsonb),
  ('LSX_EXPIRED_INAPP', 'INAPP', '매물 노출 기간이 끝나 내렸습니다',
   '「{title}」 매물의 노출 기간이 끝나 목록에서 내렸습니다. 지우지 않았으니 나의공간 › 매물 관리 도구에서 연장을 요청하면 운영자가 확인 뒤 다시 올립니다.', '["title"]'::jsonb),
  ('LSX_EXTEND_OK_INAPP', 'INAPP', '매물 연장 요청이 승인되었습니다',
   '「{title}」 매물의 노출 기간이 {date}까지로 늘었습니다.', '["title","date"]'::jsonb),
  ('LSX_EXTEND_NO_INAPP', 'INAPP', '매물 연장 요청이 반려되었습니다',
   '「{title}」 매물의 연장 요청이 반려되었습니다. 사유: {reason}', '["title","reason"]'::jsonb)
ON CONFLICT (code) DO NOTHING;


/* ── ⑥ 설정 — 스위치 모두 처음 꺼짐(켜기 · 값 바꾸기 SUPER · 바뀐 기록은 「전체 설정」 기록 그대로) ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('lsx.saved_search', 'off', 'ADMIN', '저장한 검색 · 새 매물 알림(v10.513 · D276) — on 이면 회원이 검색 조건을 저장하고 매일 08:10 새 매물을 한 통으로 알림(알림 수신 설정 따름) · 처음 off', false, '^(on|off)$', 'off'),
  ('lsx.saved_search_max', '10', 'ADMIN', '저장한 검색 개수(사람마다 · 1 ~ 10 · 처음 10 · v10.513)', false, '^([1-9]|10)$', '10'),
  ('lsx.expiry', 'off', 'ADMIN', '매물 만료(v10.514 · D276 · 대표 결정 11/20) — on 이면 만료 예고 알림 · 만료일 지난 매물을 내림(지우지 않음). off 여도 게시 확정 때 만료일은 저장 · 표시 · 처음 off', false, '^(on|off)$', 'off'),
  ('lsx.expiry_default_months', '6', 'ADMIN', '게시 확정 때 만료 기본 기간(개월 · 1 ~ 24 · 처음 6 · 대표 결정 11/20 · v10.514) — 검수 승인 때 고르지 않으면 이 값', false, '^([1-9]|1[0-9]|2[0-4])$', '6'),
  ('lsx.expiry_warn_days', '7', 'ADMIN', '만료 예고 알림(만료 며칠 전 · 1 ~ 30 · 처음 7 · v10.514)', false, '^([1-9]|[12][0-9]|30)$', '7'),
  ('lsx.bump_mode', 'OFF', 'ADMIN', '끌어올리기 방식(v10.515 · D276 · 대표 결정 11/20) — OFF 끔(처음) · FREE 무료(기간당 횟수 · 간격) · PAID 유료(1회 금액 + 부가세 · 결제 뒤에만) · 노출 가산은 방식과 상관없이 같은 상한', false, '^(OFF|FREE|PAID)$', 'OFF'),
  ('lsx.bump_free_count', '3', 'ADMIN', '무료 끌어올리기 횟수(회원마다 · 기간당 · 1 ~ 30 · 처음 3 · v10.515)', false, '^([1-9]|[12][0-9]|30)$', '3'),
  ('lsx.bump_period_days', '30', 'ADMIN', '무료 끌어올리기 횟수를 세는 기간(일 · 1 ~ 90 · 처음 30 · v10.515)', false, '^([1-9]|[1-8][0-9]|90)$', '30'),
  ('lsx.bump_min_hours', '24', 'ADMIN', '같은 매물 끌어올리기 최소 간격(시간 · 1 ~ 720 · 처음 24 · 무료 · 유료 같음 · v10.515)', false, '^([1-9]|[1-9][0-9]|[1-6][0-9]{2}|7[01][0-9]|720)$', '24'),
  ('lsx.bump_price', '0', 'ADMIN', '유료 끌어올리기 1회 금액(공급가 · 원 · 0 ~ 1000000 · 처음 0 = 정하지 않음 · 부가세는 D243 별도 · 대표 결정 거리 · v10.515)', false, '^(0|[1-9][0-9]{0,5}|1000000)$', '0'),
  ('lsx.bump_effect_hours', '72', 'ADMIN', '끌어올리기 효과 시간(시간 · 1 ~ 168 · 처음 72 · 지나면 원래 자리 · 무료 · 유료 · 운영 같음 · v10.515)', false, '^([1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$', '72'),
  ('lsx.ai_summary', 'off', 'ADMIN', '매물 AI 3줄 요약(v10.516 · D276) — on 이면 매시간 새로 게시된 매물을 AI 로 요약해 초안으로 두고 운영자 승인 뒤에만 상세에 표시 · AI 전체 스위치 · 월 상한 안에서만 · 처음 off', false, '^(on|off)$', 'off'),
  ('lsx.ai_summary_model', '', 'ADMIN', '매물 AI 요약 모델(v10.516) — 비우면 agent.review_model · 요금표(agent_model_prices)에 있는 모델만', false, '^(|[a-z0-9][a-z0-9.-]{2,59})$', ''),
  ('lsx.ai_summary_batch', '10', 'ADMIN', '매물 AI 요약 한 번에 만드는 수(매시간 · 1 ~ 30 · 처음 10 · v10.516)', false, '^([1-9]|[12][0-9]|30)$', '10')
ON CONFLICT (key) DO NOTHING;


/* ── ⑦ 정기 작업 ── */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('lsx_daily', 1440, 8, 10, NULL, true, '매물 하루 작업 — 매일 08:10 · 저장한 검색 새 매물 묶음 알림(lsx.saved_search on) · 만료 예고 · 만료로 내림(lsx.expiry on) · D276 · v10.513 · 514'),
  ('lsx_hourly', 60, NULL, NULL, NULL, true, '매물 매시간 작업 — 효과 끝난 끌어올림 정리(원래 자리 · 스위치와 상관없이) · AI 요약 초안 만들기(lsx.ai_summary · AI 월 상한) · D276 · v10.515 · 516')
ON CONFLICT (job) DO NOTHING;


/* ── ⑧ ㉕ 권한 시드(D258 모양) — 검수 묶음(admrev) · 운영 관리자는 네 탭 모두 · 검수 담당은 만료 · 연장과 AI 요약 · 세무사 없음(lsx- 앞머리) ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('lsx-expiry', '매물 만료 · 연장', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 81),
  ('lsx-bump', '끌어올리기', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 82),
  ('lsx-summary', '매물 AI 요약', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 83),
  ('lsx-saved', '저장한 검색', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 84)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'lsx-expiry', 'VIEW'), ('R_ADMIN', 'lsx-expiry', 'EDIT'), ('R_ADMIN', 'lsx-expiry', 'APPROVE'), ('R_ADMIN', 'lsx-expiry', 'EXPORT'),
  ('R_ADMIN', 'lsx-bump', 'VIEW'), ('R_ADMIN', 'lsx-bump', 'EDIT'), ('R_ADMIN', 'lsx-bump', 'APPROVE'), ('R_ADMIN', 'lsx-bump', 'EXPORT'),
  ('R_ADMIN', 'lsx-summary', 'VIEW'), ('R_ADMIN', 'lsx-summary', 'EDIT'), ('R_ADMIN', 'lsx-summary', 'APPROVE'), ('R_ADMIN', 'lsx-summary', 'EXPORT'),
  ('R_ADMIN', 'lsx-saved', 'VIEW'), ('R_ADMIN', 'lsx-saved', 'EDIT'), ('R_ADMIN', 'lsx-saved', 'APPROVE'), ('R_ADMIN', 'lsx-saved', 'EXPORT'),
  ('R_REVIEWER', 'lsx-expiry', 'VIEW'), ('R_REVIEWER', 'lsx-expiry', 'EDIT'), ('R_REVIEWER', 'lsx-expiry', 'APPROVE'), ('R_REVIEWER', 'lsx-expiry', 'EXPORT'),
  ('R_REVIEWER', 'lsx-summary', 'VIEW'), ('R_REVIEWER', 'lsx-summary', 'EDIT'), ('R_REVIEWER', 'lsx-summary', 'APPROVE'), ('R_REVIEWER', 'lsx-summary', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/lsx/bumps', 'lsx-bump', 'VIEW'),
  ('GET', '/admin/lsx/expiry', 'lsx-expiry', 'VIEW'),
  ('GET', '/admin/lsx/overview', 'lsx-saved', 'VIEW'),
  ('GET', '/admin/lsx/saved-searches/stats', 'lsx-saved', 'VIEW'),
  ('GET', '/admin/lsx/summaries', 'lsx-summary', 'VIEW'),
  ('POST', '/admin/lsx/bump-payments/{id}/refund', 'lsx-bump', 'EDIT'),
  ('POST', '/admin/lsx/bumps', 'lsx-bump', 'EDIT'),
  ('POST', '/admin/lsx/expiry/grace', 'lsx-expiry', 'EDIT'),
  ('POST', '/admin/lsx/extend-requests/{id}/decide', 'lsx-expiry', 'APPROVE'),
  ('POST', '/admin/lsx/summaries/request', 'lsx-summary', 'EDIT'),
  ('POST', '/admin/lsx/summaries/{id}/decide', 'lsx-summary', 'APPROVE'),
  ('PUT', '/admin/lsx/expiry/{id}', 'lsx-expiry', 'EDIT'),
  ('PUT', '/admin/lsx/settings', 'lsx-saved', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

