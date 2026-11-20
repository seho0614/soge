/* D284 (v10.542 ~ 545 · docs/680 ~ 683) (54) 매물 · 파트너 — 매물 방문 예약(관별) · 지도 매물 묶음 · 파트너 자료 내려받기 · 오픈 API 사용량 과금(모두 off) */

-- =====================================================================
-- D284 — v10.542 ~ 545 (2026-11-20 · (54) 매물 · 파트너 · docs/680 ~ 683)
--
--   ① vsx_slots · vsx_bookings   매물 방문 예약 — 매물 주인이 시간 칸을 열고 회원이 고름 → 주인 확정 · 취소 · 전날 알림 · 노쇼 표시 (v10.542)
--   ② (표 없음)                  지도 매물 묶음 — 공개 API 가 시 · 도 / 시 · 구 / 격자 수만 돌려줌(설정만) (v10.543)
--   ③ ptn_export_logs            파트너 자료 내려받기 기록(쌓기만) · 내려받기 승인 대상 PTN_LEADS (v10.544)
--   ④ papi_usage_daily · papi_bill_drafts  오픈 API 하루 사용량 · 월 청구서 초안(확정은 사람) (v10.545)
--   ⑤ 설정 12(스위치 4 모두 처음 off) · 정기 작업 2 · ㉕ 권한(D258) 시드
--
--   지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글에 퍼센트 기호 없음.
-- =====================================================================

/* ── ① 매물 방문 예약 ───────────────────────────────────────────────────────────
 *   시간 칸(vsx_slots) — 매물 주인만 엶 · 게시 중 매물만 · 앞으로의 시각만 · 10분 단위 · 길이 10 ~ 240분(10분 단위) · 같은 매물 열린 칸끼리 겹치지 않음
 *   칸 고치기는 「닫기」(OPEN → CLOSED) 하나뿐 · 지우기 막음
 *   예약(vsx_bookings) — 칸 하나에 살아 있는 예약 하나(REQUESTED · CONFIRMED) · 자기 매물은 예약 못 함
 *   상태: REQUESTED → CONFIRMED · CANCELLED / CONFIRMED → CANCELLED · NOSHOW · DONE (끝난 상태는 바꾸지 않음 · 지우기 막음)
 *   NOSHOW · DONE 은 방문 시각이 지난 뒤 7일 안에만 */
/* 관(갈래)별 설정(대표 11/21) — site_settings vsx.gwans = 'NONE'(처음 · 모두 꺼짐) 또는 관 코드 쉼표 목록 · 칸 열기 · 예약 넣기 때 트리거가 봄 */
CREATE OR REPLACE FUNCTION public.fn_vsx_gwan_on(p_gwan text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT p_gwan = ANY (string_to_array(value, ',')) FROM public.site_settings WHERE key = 'vsx.gwans'), false)
$$;

CREATE TABLE IF NOT EXISTS public.vsx_slots (
  id               bigserial PRIMARY KEY,
  listing_id       uuid NOT NULL REFERENCES public.listings(id),
  owner_account_id uuid NOT NULL REFERENCES public.accounts(id),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  state            text NOT NULL DEFAULT 'OPEN',
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  CONSTRAINT ck_vsx_slot_state CHECK (state IN ('OPEN', 'CLOSED')),
  CONSTRAINT ck_vsx_slot_closed CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT ck_vsx_slot_len CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '240 minutes'
                                    AND (EXTRACT(epoch FROM (ends_at - starts_at))::int % 600) = 0),
  /* 서버 VSX_TIME_RE(^([01][0-9]|2[0-3]):[0-5]0$ — 10분 단위)와 같은 뜻(규칙 2) */
  CONSTRAINT ck_vsx_slot_step CHECK (EXTRACT(second FROM starts_at) = 0 AND (EXTRACT(minute FROM starts_at)::int % 10) = 0)
);
CREATE INDEX IF NOT EXISTS ix_vsx_slots_listing ON public.vsx_slots (listing_id, starts_at);
CREATE INDEX IF NOT EXISTS ix_vsx_slots_owner ON public.vsx_slots (owner_account_id, starts_at);
COMMENT ON TABLE public.vsx_slots IS 'v10.542 (D284) 매물 방문 예약 시간 칸 — 매물 주인이 엶 · 게시 중 매물만 · 앞 시각만 · 10분 단위 · 10 ~ 240분 · 같은 매물 열린 칸 겹침 없음 · 고치기는 닫기만 · 지우기 막음';

CREATE OR REPLACE FUNCTION public.fn_vsx_slot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid; v_status text; v_gwan text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'VSX_SLOT: 방문 시간 칸은 지우지 않습니다(닫기만).'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.listing_id, NEW.owner_account_id, NEW.starts_at, NEW.ends_at, NEW.created_at) IS DISTINCT FROM (OLD.listing_id, OLD.owner_account_id, OLD.starts_at, OLD.ends_at, OLD.created_at) THEN
      RAISE EXCEPTION 'VSX_SLOT: 시간 칸은 바꿀 수 없습니다 — 닫고 새로 여십시오.';
    END IF;
    IF NOT (OLD.state = 'OPEN' AND NEW.state = 'CLOSED') THEN
      RAISE EXCEPTION 'VSX_SLOT: 열린 칸을 닫는 것만 됩니다.';
    END IF;
    RETURN NEW;
  END IF;
  SELECT owner_account_id, status, gwan_code INTO v_owner, v_status, v_gwan FROM public.listings WHERE id = NEW.listing_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'VSX_SLOT: 없는 매물입니다.'; END IF;
  IF NOT public.fn_vsx_gwan_on(v_gwan) THEN RAISE EXCEPTION 'VSX_GWAN_OFF: 이 관은 방문 예약을 쓰지 않습니다.'; END IF;
  IF v_owner <> NEW.owner_account_id THEN RAISE EXCEPTION 'VSX_SLOT: 매물 주인만 방문 시간을 엽니다.'; END IF;
  IF v_status <> 'PUBLISHED' THEN RAISE EXCEPTION 'VSX_SLOT: 게시 중인 매물만 방문 시간을 엽니다.'; END IF;
  IF NEW.state <> 'OPEN' THEN RAISE EXCEPTION 'VSX_SLOT: 새 칸은 열린 상태로만 만듭니다.'; END IF;
  IF NEW.starts_at <= now() THEN RAISE EXCEPTION 'VSX_SLOT: 지난 시각에는 칸을 열 수 없습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.vsx_slots s WHERE s.listing_id = NEW.listing_id AND s.state = 'OPEN'
              AND s.starts_at < NEW.ends_at AND NEW.starts_at < s.ends_at) THEN
    RAISE EXCEPTION 'VSX_SLOT_OVERLAP: 같은 매물에 겹치는 열린 칸이 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vsx_slot_guard ON public.vsx_slots;
CREATE TRIGGER trg_vsx_slot_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vsx_slots
  FOR EACH ROW EXECUTE FUNCTION public.fn_vsx_slot_guard();

CREATE TABLE IF NOT EXISTS public.vsx_bookings (
  id                bigserial PRIMARY KEY,
  slot_id           bigint NOT NULL REFERENCES public.vsx_slots(id),
  listing_id        uuid NOT NULL REFERENCES public.listings(id),
  member_account_id uuid NOT NULL REFERENCES public.accounts(id),
  state             text NOT NULL DEFAULT 'REQUESTED',
  memo              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_by         text,
  cancel_reason     text,
  marked_at         timestamptz,
  reminded_at       timestamptz,
  CONSTRAINT ck_vsx_booking_state CHECK (state IN ('REQUESTED', 'CONFIRMED', 'CANCELLED', 'NOSHOW', 'DONE')),
  CONSTRAINT ck_vsx_booking_memo CHECK (memo IS NULL OR char_length(memo) <= 200),
  CONSTRAINT ck_vsx_booking_cancel CHECK ((state = 'CANCELLED') = (cancelled_at IS NOT NULL)
                                          AND (cancel_by IS NULL OR cancel_by IN ('MEMBER', 'OWNER', 'SYSTEM'))
                                          AND (cancel_reason IS NULL OR char_length(cancel_reason) <= 200)),
  CONSTRAINT ck_vsx_booking_marked CHECK ((state IN ('NOSHOW', 'DONE')) = (marked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_vsx_booking_live ON public.vsx_bookings (slot_id) WHERE state IN ('REQUESTED', 'CONFIRMED');
CREATE INDEX IF NOT EXISTS ix_vsx_bookings_member ON public.vsx_bookings (member_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_vsx_bookings_listing ON public.vsx_bookings (listing_id, created_at DESC);
COMMENT ON TABLE public.vsx_bookings IS 'v10.542 (D284) 매물 방문 예약 — 칸 하나에 살아 있는 예약 하나 · 자기 매물 예약 못 함 · REQUESTED → CONFIRMED · CANCELLED / CONFIRMED → CANCELLED · NOSHOW · DONE · 노쇼 · 방문 끝 표시는 방문 시각 뒤 7일 안 · 노쇼 횟수는 운영 화면에서만(대표 11/21) · 지우기 막음';
COMMENT ON COLUMN public.vsx_bookings.memo IS '회원이 남긴 한 줄(200자 · 연락처는 적지 않도록 화면 안내 · 주인에게만 보임)';

CREATE OR REPLACE FUNCTION public.fn_vsx_booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; v_owner uuid; v_gwan text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'VSX_BOOKING: 방문 예약 기록은 지우지 않습니다.'; END IF;
  SELECT id, listing_id, owner_account_id, starts_at, state INTO s FROM public.vsx_slots WHERE id = NEW.slot_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'VSX_BOOKING: 없는 시간 칸입니다.'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.listing_id <> s.listing_id THEN RAISE EXCEPTION 'VSX_BOOKING: 시간 칸과 매물이 맞지 않습니다.'; END IF;
    SELECT owner_account_id, gwan_code INTO v_owner, v_gwan FROM public.listings WHERE id = NEW.listing_id;
    IF NOT public.fn_vsx_gwan_on(v_gwan) THEN RAISE EXCEPTION 'VSX_GWAN_OFF: 이 관은 방문 예약을 쓰지 않습니다.'; END IF;
    IF v_owner = NEW.member_account_id THEN RAISE EXCEPTION 'VSX_BOOKING_SELF: 자기 매물은 방문 예약할 수 없습니다.'; END IF;
    IF s.state <> 'OPEN' OR s.starts_at <= now() THEN RAISE EXCEPTION 'VSX_BOOKING_SLOT: 열려 있는 앞으로의 칸만 고를 수 있습니다.'; END IF;
    IF NEW.state <> 'REQUESTED' THEN RAISE EXCEPTION 'VSX_BOOKING: 새 예약은 요청 상태로만 만듭니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.slot_id, NEW.listing_id, NEW.member_account_id, NEW.created_at, NEW.memo) IS DISTINCT FROM (OLD.slot_id, OLD.listing_id, OLD.member_account_id, OLD.created_at, OLD.memo) THEN
    RAISE EXCEPTION 'VSX_BOOKING: 예약 내용은 바꿀 수 없습니다.';
  END IF;
  IF NEW.state = OLD.state THEN
    /* 전날 알림 표시(reminded_at)만 한 번 */
    IF OLD.reminded_at IS NULL AND NEW.reminded_at IS NOT NULL
       AND (NEW.confirmed_at, NEW.cancelled_at, NEW.cancel_by, NEW.cancel_reason, NEW.marked_at) IS NOT DISTINCT FROM (OLD.confirmed_at, OLD.cancelled_at, OLD.cancel_by, OLD.cancel_reason, OLD.marked_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'VSX_BOOKING: 상태가 그대로면 바꿀 것이 없습니다.';
  END IF;
  IF OLD.state = 'REQUESTED' AND NEW.state IN ('CONFIRMED', 'CANCELLED') THEN
    IF NEW.state = 'CONFIRMED' AND s.starts_at <= now() THEN RAISE EXCEPTION 'VSX_BOOKING_PAST: 지난 칸은 확정할 수 없습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'CONFIRMED' AND NEW.state = 'CANCELLED' THEN RETURN NEW; END IF;
  IF OLD.state = 'CONFIRMED' AND NEW.state IN ('NOSHOW', 'DONE') THEN
    IF s.starts_at > now() THEN RAISE EXCEPTION 'VSX_BOOKING_EARLY: 방문 시각이 지난 뒤에 표시합니다.'; END IF;
    IF s.starts_at < now() - interval '7 days' THEN RAISE EXCEPTION 'VSX_BOOKING_LATE: 방문 시각 뒤 7일이 지나 표시할 수 없습니다.'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'VSX_BOOKING_STATE: 이 상태로는 바꿀 수 없습니다.';
END $$;
DROP TRIGGER IF EXISTS trg_vsx_booking_guard ON public.vsx_bookings;
CREATE TRIGGER trg_vsx_booking_guard BEFORE INSERT OR UPDATE OR DELETE ON public.vsx_bookings
  FOR EACH ROW EXECUTE FUNCTION public.fn_vsx_booking_guard();

/* 칸을 닫으면 그 칸의 요청 · 확정 예약은 주인 취소로(같은 트랜잭션) */
CREATE OR REPLACE FUNCTION public.fn_vsx_slot_close_cascade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  /* 지난 칸을 닫을 때는 예약을 건드리지 않음(방문 끝 · 노쇼 표시는 주인이) */
  IF NEW.starts_at > now() THEN
    UPDATE public.vsx_bookings SET state = 'CANCELLED', cancelled_at = clock_timestamp(), cancel_by = 'OWNER', cancel_reason = '시간 칸을 닫음'
     WHERE slot_id = NEW.id AND state IN ('REQUESTED', 'CONFIRMED');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vsx_slot_close_cascade ON public.vsx_slots;
CREATE TRIGGER trg_vsx_slot_close_cascade AFTER UPDATE ON public.vsx_slots
  FOR EACH ROW WHEN (OLD.state = 'OPEN' AND NEW.state = 'CLOSED') EXECUTE FUNCTION public.fn_vsx_slot_close_cascade();


/* ── ③ 파트너 자료 내려받기 (v10.544 · docs/682) ─────────────────────────────────────
 *   파트너센터(대표 · 정산 권한 직원)가 자기 파트너 리드 · 성과를 CSV 로
 *   리드 CSV = 내려받기 승인(export_requests · 대상 PTN_LEADS · 다른 SUPER 가 승인 → 24시간 안 한 번) · 연락처 칸 없음 · 요약의 전화 · 메일 모양 가림
 *   성과 CSV = 숫자만(개인정보 없음) — 승인 없이 기록만
 *   기록은 쌓기만(고치기 · 지우기 막음) */
CREATE TABLE IF NOT EXISTS public.ptn_export_logs (
  id          bigserial PRIMARY KEY,
  partner_id  uuid NOT NULL REFERENCES public.partners(id),
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  kind        text NOT NULL,
  rows_n      integer NOT NULL DEFAULT 0,
  range_from  date,
  range_to    date,
  ticket_id   bigint,
  at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ptn_export_kind CHECK (kind IN ('LEADS', 'PERF')),
  CONSTRAINT ck_ptn_export_rows CHECK (rows_n >= 0),
  CONSTRAINT ck_ptn_export_ticket CHECK (kind <> 'LEADS' OR ticket_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_ptn_export_logs_partner ON public.ptn_export_logs (partner_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_ptn_export_logs_at ON public.ptn_export_logs (at DESC);
COMMENT ON TABLE public.ptn_export_logs IS 'v10.544 (D284) 파트너센터 자료 내려받기 기록 — 리드(승인 번호 함께) · 성과 · 줄 수 · 기간 · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ptn_export_logs_ro' AND tgrelid = 'public.ptn_export_logs'::regclass) THEN
    CREATE TRIGGER trg_ptn_export_logs_ro BEFORE UPDATE OR DELETE ON public.ptn_export_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 내려받기 승인 대상에 PTN_LEADS — 지금 CHECK 목록을 읽어 하나만 더함(D270 · D282 와 같은 모양 · 앞 묶음이 더한 대상을 지우지 않음 · 이미 있으면 그대로) */
DO $$
DECLARE d text; vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO d FROM pg_constraint c
   WHERE c.conname = 'export_requests_target_check' AND c.conrelid = 'public.export_requests'::regclass;
  IF d IS NULL OR position('''PTN_LEADS''' IN d) > 0 THEN RETURN; END IF;
  SELECT array_agg((m.x)[1]) INTO vals FROM regexp_matches(d, '''([A-Z][A-Z0-9_]*)''', 'g') AS m(x);
  vals := coalesce(vals, ARRAY[]::text[]) || 'PTN_LEADS'::text;
  ALTER TABLE public.export_requests DROP CONSTRAINT export_requests_target_check;
  EXECUTE 'ALTER TABLE public.export_requests ADD CONSTRAINT export_requests_target_check CHECK (target IN ('
          || (SELECT string_agg(quote_literal(u.v), ', ') FROM unnest(vals) AS u(v)) || '))';
END $$;


/* ── ④ 오픈 API 사용량 과금 (v10.545 · docs/683) ───────────────────────────────────
 *   ㊼(D278) 요청 기록 ptn_api_requests 는 papi.log_keep_days(30 ~ 365) 뒤 지워짐 → 하루마다 키별로 모아 둠(papi_usage_daily · 지우지 않음)
 *     ok = 응답 400 아래 · 자료 주소만(leads · services · cash — me · docs · usage 는 셈 안 함) · err = 400 이상(막힘 · 한도 넘음 포함)
 *   달마다 파트너별 청구서 초안(papi_bill_drafts) — 무료 한도 · 1,000건 단가(원 · 부가세 별도) · 초안은 다시 셈 · 확정은 사람(SUPER · 「확정」)
 *   확정 · 무효 줄은 바꾸지 않음 · 무효는 사유와 함께 · 무효 뒤 그 달 새 초안 가능 · 실제 청구 · 세금계산서 · 수납은 이 표 밖(사람) */
CREATE TABLE IF NOT EXISTS public.papi_usage_daily (
  day        date NOT NULL,
  key_id     bigint NOT NULL REFERENCES public.ptn_api_keys(id),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  calls_ok   integer NOT NULL DEFAULT 0,
  calls_err  integer NOT NULL DEFAULT 0,
  calls_free integer NOT NULL DEFAULT 0,
  made_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, key_id),
  CONSTRAINT ck_papi_usage_n CHECK (calls_ok >= 0 AND calls_err >= 0 AND calls_free >= 0)
);
CREATE INDEX IF NOT EXISTS ix_papi_usage_partner ON public.papi_usage_daily (partner_id, day);
COMMENT ON TABLE public.papi_usage_daily IS 'v10.545 (D284) 파트너 오픈 API 하루 사용량(한국 날짜 · 키별) — calls_ok = 400 아래 자료 주소(과금 대상) · calls_free = 400 아래 안내 주소(me · docs · usage · 과금 안 함) · calls_err = 400 이상 · 정기 작업 papi_usage 가 지난 3일을 다시 셈 · 지우지 않음';
CREATE INDEX IF NOT EXISTS ix_ptn_api_requests_partner_at ON public.ptn_api_requests (partner_id, at) WHERE partner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.papi_bill_drafts (
  id             bigserial PRIMARY KEY,
  partner_id     uuid NOT NULL REFERENCES public.partners(id),
  ym             text NOT NULL,
  calls_total    bigint NOT NULL,
  free_calls     bigint NOT NULL,
  calls_billable bigint NOT NULL,
  price_per_1k   integer NOT NULL,
  supply_amount  bigint NOT NULL,
  vat_amount     bigint NOT NULL,
  total_amount   bigint NOT NULL,
  state          text NOT NULL DEFAULT 'DRAFT',
  made_at        timestamptz NOT NULL DEFAULT now(),
  remade_at      timestamptz,
  confirmed_by   uuid REFERENCES public.accounts(id),
  confirmed_at   timestamptz,
  void_by        uuid REFERENCES public.accounts(id),
  void_at        timestamptz,
  void_reason    text,
  /* 서버 BILL_YM(^[0-9]{4}-(0[1-9]|1[0-2])$)과 같음(규칙 2) */
  CONSTRAINT ck_papi_bill_ym CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT ck_papi_bill_state CHECK (state IN ('DRAFT', 'CONFIRMED', 'VOID')),
  CONSTRAINT ck_papi_bill_n CHECK (calls_total >= 0 AND free_calls >= 0 AND calls_billable = greatest(calls_total - free_calls, 0) AND price_per_1k >= 0),
  CONSTRAINT ck_papi_bill_amt CHECK (supply_amount = (calls_billable * price_per_1k) / 1000 AND vat_amount = supply_amount / 10 AND total_amount = supply_amount + vat_amount),
  CONSTRAINT ck_papi_bill_confirmed CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL) AND (state <> 'CONFIRMED' OR confirmed_at IS NOT NULL)),
  CONSTRAINT ck_papi_bill_void CHECK ((state = 'VOID') = (void_at IS NOT NULL) AND (void_reason IS NULL OR char_length(void_reason) BETWEEN 2 AND 200))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_papi_bill_live ON public.papi_bill_drafts (partner_id, ym) WHERE state <> 'VOID';
CREATE INDEX IF NOT EXISTS ix_papi_bill_ym ON public.papi_bill_drafts (ym, state);
COMMENT ON TABLE public.papi_bill_drafts IS 'v10.545 (D284) 파트너 오픈 API 월 청구서 초안 — 공급가 = 과금 건수 × 1,000건 단가 ÷ 1,000(원 아래 버림) · 부가세 = 공급가 ÷ 10(버림 · 별도) · 초안만 다시 셈 · 확정은 사람(SUPER) · 확정 · 무효 줄은 바꾸지 않음 · 지우기 막음 · 실제 청구 · 수납은 사람';

CREATE OR REPLACE FUNCTION public.fn_papi_bill_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PAPI_BILL: 청구서 초안은 지우지 않습니다(무효로).'; END IF;
  IF (NEW.partner_id, NEW.ym, NEW.made_at) IS DISTINCT FROM (OLD.partner_id, OLD.ym, OLD.made_at) THEN
    RAISE EXCEPTION 'PAPI_BILL: 파트너 · 달은 바꿀 수 없습니다.';
  END IF;
  IF OLD.state = 'VOID' THEN RAISE EXCEPTION 'PAPI_BILL_STATE: 무효 청구서는 바꾸지 않습니다.'; END IF;
  IF OLD.state = 'CONFIRMED' THEN
    IF NEW.state = 'VOID' AND (NEW.calls_total, NEW.free_calls, NEW.calls_billable, NEW.price_per_1k, NEW.supply_amount, NEW.vat_amount, NEW.total_amount, NEW.confirmed_by, NEW.confirmed_at)
       IS NOT DISTINCT FROM (OLD.calls_total, OLD.free_calls, OLD.calls_billable, OLD.price_per_1k, OLD.supply_amount, OLD.vat_amount, OLD.total_amount, OLD.confirmed_by, OLD.confirmed_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PAPI_BILL_STATE: 확정한 청구서는 무효로만 바꿉니다.';
  END IF;
  /* DRAFT — 다시 셈 · 확정 · 무효 */
  IF NEW.state = 'CONFIRMED' AND (NEW.calls_total, NEW.supply_amount) IS DISTINCT FROM (OLD.calls_total, OLD.supply_amount) THEN
    RAISE EXCEPTION 'PAPI_BILL: 확정과 다시 셈을 함께 하지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_papi_bill_guard ON public.papi_bill_drafts;
CREATE TRIGGER trg_papi_bill_guard BEFORE UPDATE OR DELETE ON public.papi_bill_drafts
  FOR EACH ROW EXECUTE FUNCTION public.fn_papi_bill_guard();

/* 하루 사용량 모으기 — 한국 날짜 p_from ~ p_to 를 키별로 다시 셈(있으면 덮음) · 돌려주는 값 = 쓴 줄 수 */
CREATE OR REPLACE FUNCTION public.fn_papi_usage_rollup(p_from date, p_to date) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
    RAISE EXCEPTION 'PAPI_USAGE_RANGE: 날짜 범위가 맞지 않습니다(62일까지).';
  END IF;
  WITH r AS (
    SELECT (q.at AT TIME ZONE 'Asia/Seoul')::date AS day, q.key_id, q.partner_id,
           count(*) FILTER (WHERE q.status < 400 AND q.path !~ '^/api/partner/v1/(me|docs|usage)$')::int AS ok,
           count(*) FILTER (WHERE q.status < 400 AND q.path ~ '^/api/partner/v1/(me|docs|usage)$')::int AS free,
           count(*) FILTER (WHERE q.status >= 400)::int AS err
      FROM public.ptn_api_requests q
     WHERE q.key_id IS NOT NULL AND q.partner_id IS NOT NULL
       AND q.at >= (p_from::timestamp AT TIME ZONE 'Asia/Seoul') AND q.at < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
     GROUP BY 1, 2, 3
  )
  INSERT INTO public.papi_usage_daily (day, key_id, partner_id, calls_ok, calls_err, calls_free, made_at)
  SELECT day, key_id, partner_id, ok, err, free, clock_timestamp() FROM r
  ON CONFLICT (day, key_id) DO UPDATE SET calls_ok = EXCLUDED.calls_ok, calls_err = EXCLUDED.calls_err, calls_free = EXCLUDED.calls_free, made_at = EXCLUDED.made_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;


/* ── ⑤ 설정 · 정기 작업 · ㉕ 권한(D258) 시드 ──────────────────────────────────────────
 *   스위치 4개 모두 처음 off(규칙 9) · 값 무늬(value_pattern)는 서버 vsx-settings.ts 의 범위와 같은 끝값 */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('vsx.enabled', 'off', 'ADMIN', '매물 방문 예약(v10.542 · D284) — 처음 off · on 이면 매물 주인이 방문 가능 시간 칸을 열고 회원이 골라 요청 → 주인 확정 · 전날 알림(회원 · 주인 알림함) · 노쇼 표시', false, '^(on|off)$', 'off'),
  ('vsx.gwans', 'NONE', 'ADMIN', '방문 예약을 쓰는 관(v10.542 · 대표 11/21 「관별로 설정」) — NONE(처음 · 모두 꺼짐) 또는 관 코드 쉼표 목록(예 MNY,MAL) · 꺼진 관 매물은 칸 열기 · 예약을 서버 · DB 트리거가 막음(422 VSX_GWAN_OFF) · vsx.enabled 도 on 이어야 함', false, '^(NONE|[A-Z][A-Z0-9_]{1,19}(,[A-Z][A-Z0-9_]{1,19}){0,29})$', 'NONE'),
  ('vsx.slot_days', '30', 'ADMIN', '방문 시간 칸을 열 수 있는 앞 날 수(v10.542 · 1 ~ 90 · 처음 30)', false, '^([1-9]|[1-8][0-9]|90)$', '30'),
  ('vsx.max_open', '60', 'ADMIN', '매물 하나에 열어 둘 수 있는 앞으로의 칸 수(v10.542 · 1 ~ 200 · 처음 60)', false, '^([1-9]|[1-9][0-9]|1[0-9]{2}|200)$', '60'),
  ('map.cluster_enabled', 'off', 'ADMIN', '지도 매물 묶음 공개 API(v10.543 · D284) — 처음 off · on 이면 GET /listings/map/clusters 가 줌 수준별 시 · 도 / 시 · 구 묶음 수를 돌려줌(지도 사용 map.enabled · 카카오 키가 없으면 좌표 없이 시 · 구 목록만)', false, '^(on|off)$', 'off'),
  ('map.cluster_grid', 'off', 'ADMIN', '지도 매물 묶음 격자 단계(v10.543) — 처음 off · on 이면 가까운 줌(1 ~ 6단계)에서 정확 좌표를 2km 넘는 격자로 묶어 격자 가운데 · 수만 돌려줌(좌표 · 주소는 안 냄 · 법무 확인 뒤 켬)', false, '^(on|off)$', 'off'),
  ('map.cluster_min', '3', 'ADMIN', '격자 하나에 보일 최소 매물 수(v10.543 · 2 ~ 20 · 처음 3) — 모자라면 그 매물은 시 · 구 묶음으로 합침', false, '^([2-9]|1[0-9]|20)$', '3'),
  ('ptn.export_enabled', 'off', 'ADMIN', '파트너센터 자료 내려받기(v10.544 · D284) — 처음 off · on 이면 대표 · 정산 권한 직원이 리드 CSV(내려받기 승인 뒤 24시간 안 한 번 · 연락처 없음) · 성과 CSV(숫자만)를 받음 · 받을 때마다 기록', false, '^(on|off)$', 'off'),
  ('ptn.export_max_rows', '5000', 'ADMIN', '파트너 리드 CSV 한 번 최대 줄 수(v10.544 · 100 ~ 20000 · 처음 5000)', false, '^([1-9][0-9]{2}|[1-9][0-9]{3}|1[0-9]{4}|20000)$', '5000'),
  ('papi.bill_enabled', 'off', 'ADMIN', '오픈 API 사용량 월 청구서 초안(v10.545 · D284) — 처음 off · on 이면 매달 papi.bill_day 일부터 지난달 파트너별 초안을 만들고 다시 셈(확정은 SUPER 가 사람 손으로 · 실제 청구 · 수납은 이 화면 밖) · 하루 사용량 모으기는 꺼져도 돎', false, '^(on|off)$', 'off'),
  ('papi.bill_free_calls', '10000', 'ADMIN', '파트너마다 달 무료 호출 수(v10.545 · 0 ~ 10000000 · 처음 10000 · 자료 주소 leads · services · cash 만 셈)', false, '^(0|[1-9][0-9]{0,6}|10000000)$', '10000'),
  ('papi.bill_price_1k', '1000', 'ADMIN', '무료 넘는 호출 1,000건 단가(원 · 부가세 별도 · v10.545 · 0 ~ 100000 · 처음 1000 — 대표 확인 전 임시 값)', false, '^(0|[1-9][0-9]{0,4}|100000)$', '1000'),
  ('papi.bill_day', '3', 'ADMIN', '월 청구서 초안 만드는 날(v10.545 · 1 ~ 28일 · 처음 3) — 이날부터 매일 03:40 지난달 초안을 다시 셈(확정 · 무효 전까지)', false, '^([1-9]|1[0-9]|2[0-8])$', '3')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('vsx_visit', 60, NULL, NULL, NULL, true, '매물 방문 예약 — 매시간 · 지난 칸의 확정 안 된 요청 저절로 취소 · 내일 확정 예약 전날 알림(10시부터 · 한 번) · vsx.enabled off 면 아무것도 안 함 · D284 · v10.542'),
  ('papi_usage', 1440, 3, 40, NULL, true, '오픈 API 하루 사용량 — 매일 03:40 · 지난 3일을 키별로 다시 모음(papi_daily 03:50 정리 전) · papi.bill_enabled on 이고 papi.bill_day 일부터 지난달 청구서 초안 다시 셈 · D284 · v10.545')
ON CONFLICT (job) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 새 탭 4개 · gen_seed.py 와 같은 규칙(GET = VIEW · 확정 · 만들기 = APPROVE · 그 밖 변경 = EDIT)
 *   vsx-visits · vsx-map = 검수 묶음(admrev · TAB_ROLES 따로 없음 = ADMIN · SUPER)
 *   vsx-papi-bill · vsx-ptn-export = 파트너사 묶음(admptn · TAB_ROLES ADMIN · SUPER · PARTNER_MAL) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('vsx-visits', '매물 방문 예약', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 91),
  ('vsx-map', '지도 매물 묶음', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 92),
  ('vsx-papi-bill', '오픈 API 사용량 · 청구', 'admptn', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3110),
  ('vsx-ptn-export', '파트너 자료 내려받기', 'admptn', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3120)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'vsx-visits', 'VIEW'), ('R_ADMIN', 'vsx-visits', 'EDIT'), ('R_ADMIN', 'vsx-visits', 'APPROVE'), ('R_ADMIN', 'vsx-visits', 'EXPORT'),
  ('R_ADMIN', 'vsx-map', 'VIEW'), ('R_ADMIN', 'vsx-map', 'EDIT'), ('R_ADMIN', 'vsx-map', 'APPROVE'), ('R_ADMIN', 'vsx-map', 'EXPORT'),
  ('R_ADMIN', 'vsx-papi-bill', 'VIEW'), ('R_ADMIN', 'vsx-papi-bill', 'EDIT'), ('R_ADMIN', 'vsx-papi-bill', 'APPROVE'), ('R_ADMIN', 'vsx-papi-bill', 'EXPORT'),
  ('R_ADMIN', 'vsx-ptn-export', 'VIEW'), ('R_ADMIN', 'vsx-ptn-export', 'EDIT'), ('R_ADMIN', 'vsx-ptn-export', 'APPROVE'), ('R_ADMIN', 'vsx-ptn-export', 'EXPORT'),
  ('R_PARTNER_MAL', 'vsx-papi-bill', 'VIEW'), ('R_PARTNER_MAL', 'vsx-papi-bill', 'EDIT'), ('R_PARTNER_MAL', 'vsx-papi-bill', 'APPROVE'), ('R_PARTNER_MAL', 'vsx-papi-bill', 'EXPORT'),
  ('R_PARTNER_MAL', 'vsx-ptn-export', 'VIEW'), ('R_PARTNER_MAL', 'vsx-ptn-export', 'EDIT'), ('R_PARTNER_MAL', 'vsx-ptn-export', 'APPROVE'), ('R_PARTNER_MAL', 'vsx-ptn-export', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/vsx/visits', 'vsx-visits', 'VIEW'),
  ('POST', '/admin/vsx/visits/run', 'vsx-visits', 'APPROVE'),
  ('GET', '/admin/vsx/map', 'vsx-map', 'VIEW'),
  ('PUT', '/admin/vsx/settings', 'vsx-map', 'EDIT'),
  ('GET', '/admin/vsx/papi-usage', 'vsx-papi-bill', 'VIEW'),
  ('POST', '/admin/vsx/papi-usage/run', 'vsx-papi-bill', 'APPROVE'),
  ('POST', '/admin/vsx/papi-bills/{id}/confirm', 'vsx-papi-bill', 'APPROVE'),
  ('POST', '/admin/vsx/papi-bills/{id}/void', 'vsx-papi-bill', 'EDIT'),
  ('GET', '/admin/vsx/ptn-exports', 'vsx-ptn-export', 'VIEW')
ON CONFLICT DO NOTHING;

