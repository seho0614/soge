/* D286 (v10.549 ~ 552 · docs/687 ~ 690) (56) 매물 3 — 매물 가격 제안 · 사진 워터마크 · 판매자 자리 비움 · 지역별 시세 통계 */

-- =====================================================================
-- D286 — v10.549 ~ 552 (2026-11-21 · (56) 매물 3 · docs/687 ~ 690)
--
--   ① lpx_offers                    매물 가격 제안 — 회원 제안 → 주인 수락 · 거절 · 되제안 · 기한 만료 · 상태 한 방향 (v10.549)
--   ② (표 없음)                     매물 사진 워터마크 — 설정만(원본 사진 그대로 · 화면 겹침 표시) (v10.550)
--   ③ lpx_away · lpx_away_notices   판매자 자리 비움 — 기간 · 안내 · 문의 · 질문 · 가격 제안 · 방문 예약 때 자동 안내 한 번 (v10.551)
--   ④ lpx_price_stats               지역별 시세 통계 — 관 × 업종 × 시 · 도 × 시 · 구 × 달 가운데값(5개 미만 칸은 값 없음) (v10.552)
--   ⑤ 설정 13(스위치 4 모두 처음 off) · 알림 6 · 정기 작업 2 · 기능 스위치 켤 조건 4 · ㉕ 권한(D258) 시드
--
--   지우는 문장 없음(통계 표의 그 달 다시 셈은 함수 안) · 다시 돌려도 같음 · RAISE 글에 퍼센트 기호 없음.
-- =====================================================================

/* 관(갈래)별 설정 — site_settings 값이 'NONE'(처음 · 모두 꺼짐) 또는 관 코드 쉼표 목록 · b284 fn_vsx_gwan_on 과 같은 모양(키를 받음) */
CREATE OR REPLACE FUNCTION public.fn_lpx_gwan_on(p_key text, p_gwan text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT p_gwan = ANY (string_to_array(value, ',')) FROM public.site_settings WHERE key = p_key), false)
$$;

/* ── ① 매물 가격 제안 ───────────────────────────────────────────────────────────
 *   제안(lpx_offers) — 게시 중 · 거래 금액 있는 매물 · 회원당 열린 제안 하나(고유 색인) · 자기 매물 금지 · 관별 설정
 *   상태: OPEN → ACCEPTED · REJECTED · COUNTERED · WITHDRAWN · EXPIRED / COUNTERED → ACCEPTED · REJECTED · OPEN(회원 다시 제안) · WITHDRAWN · EXPIRED
 *   되제안(주인 되제안 · 회원 다시 제안 모두 한 번으로 셈) — lpx.offer_counter_max(처음 3 · 1 ~ 5)까지 · 넘으면 DB 가 막음(LPX_COUNTER_LIMIT · 대표 11/21)
 *   끝난 상태는 바꾸지 않음 · 지우기 막음 · 금액 글자는 서버 LPX_AMOUNT_RE(^[1-9][0-9]{2,12}$)와 같음(규칙 2)
 *   거래(deals)를 만들지 않음 — 수락 뒤 거래는 기존 1:1 문의 → 거래 흐름 */
CREATE TABLE IF NOT EXISTS public.lpx_offers (
  id                bigserial PRIMARY KEY,
  listing_id        uuid NOT NULL REFERENCES public.listings(id),
  member_account_id uuid NOT NULL REFERENCES public.accounts(id),
  owner_account_id  uuid NOT NULL REFERENCES public.accounts(id),
  asking_amount     numeric(16,0),
  amount            numeric(16,0) NOT NULL,
  memo              text,
  counter_amount    numeric(16,0),
  counter_memo      text,
  final_amount      numeric(16,0),
  state             text NOT NULL DEFAULT 'OPEN',
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  countered_at      timestamptz,
  counter_count     integer NOT NULL DEFAULT 0,
  decided_at        timestamptz,
  decided_by        text,
  CONSTRAINT ck_lpx_offer_state CHECK (state IN ('OPEN', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED')),
  CONSTRAINT ck_lpx_offer_rounds CHECK (counter_count BETWEEN 0 AND 5),
  CONSTRAINT ck_lpx_offer_amount CHECK (amount::text ~ '^[1-9][0-9]{2,12}$'),
  CONSTRAINT ck_lpx_offer_counter CHECK (counter_amount IS NULL OR counter_amount::text ~ '^[1-9][0-9]{2,12}$'),
  CONSTRAINT ck_lpx_offer_memo CHECK ((memo IS NULL OR char_length(memo) <= 200) AND (counter_memo IS NULL OR char_length(counter_memo) <= 200)),
  CONSTRAINT ck_lpx_offer_countered CHECK ((state = 'COUNTERED') <= (counter_amount IS NOT NULL AND countered_at IS NOT NULL)),
  CONSTRAINT ck_lpx_offer_final CHECK ((state = 'ACCEPTED') = (final_amount IS NOT NULL)),
  CONSTRAINT ck_lpx_offer_decided CHECK ((state IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED')) = (decided_at IS NOT NULL)
                                         AND (decided_by IS NULL OR decided_by IN ('MEMBER', 'OWNER', 'SYSTEM')))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lpx_offer_live ON public.lpx_offers (listing_id, member_account_id) WHERE state IN ('OPEN', 'COUNTERED');
CREATE INDEX IF NOT EXISTS ix_lpx_offers_owner ON public.lpx_offers (owner_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_lpx_offers_member ON public.lpx_offers (member_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_lpx_offers_due ON public.lpx_offers (expires_at) WHERE state IN ('OPEN', 'COUNTERED');
COMMENT ON TABLE public.lpx_offers IS 'v10.549 (D286) 매물 가격 제안 — 회원당 열린 제안 하나 · 자기 매물 금지 · OPEN → ACCEPTED · REJECTED · COUNTERED · WITHDRAWN · EXPIRED / COUNTERED → ACCEPTED · REJECTED · OPEN(다시 제안) · WITHDRAWN · EXPIRED · 되제안 lpx.offer_counter_max(3)번까지 · 기한 lpx.offer_days · 거래는 만들지 않음 · 지우기 막음';
COMMENT ON COLUMN public.lpx_offers.asking_amount IS '제안 때 매물 거래(희망) 금액 사본 — 나중에 매물 금액이 바뀌어도 비교 기준';
COMMENT ON COLUMN public.lpx_offers.counter_count IS '되제안 횟수(주인 되제안 · 회원 다시 제안) — lpx.offer_counter_max(처음 3) 넘으면 트리거가 막음 · 울타리 5';
COMMENT ON COLUMN public.lpx_offers.memo IS '회원이 남긴 한 줄(200자 · 연락처는 서버가 가려서 저장 · 매물 주인에게만 보임 · 운영 목록에 싣지 않음)';

/* 되제안 최대 횟수 — 설정 lpx.offer_counter_max(1 ~ 5 · 처음 3 · 값이 틀리면 3) */
CREATE OR REPLACE FUNCTION public.fn_lpx_counter_max() RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT value::int FROM public.site_settings WHERE key = 'lpx.offer_counter_max' AND value ~ '^[1-5]$'), 3)
$$;

CREATE OR REPLACE FUNCTION public.fn_lpx_offer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid; v_status text; v_gwan text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LPX_OFFER: 가격 제안 기록은 지우지 않습니다.'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT owner_account_id, status, gwan_code INTO v_owner, v_status, v_gwan FROM public.listings WHERE id = NEW.listing_id;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'LPX_OFFER: 없는 매물입니다.'; END IF;
    IF NOT public.fn_lpx_gwan_on('lpx.offer_gwans', v_gwan) THEN RAISE EXCEPTION 'LPX_GWAN_OFF: 이 관은 가격 제안을 쓰지 않습니다.'; END IF;
    IF v_owner <> NEW.owner_account_id THEN RAISE EXCEPTION 'LPX_OFFER: 매물 주인이 맞지 않습니다.'; END IF;
    IF v_owner = NEW.member_account_id THEN RAISE EXCEPTION 'LPX_OFFER_SELF: 자기 매물에는 가격을 제안할 수 없습니다.'; END IF;
    IF v_status <> 'PUBLISHED' THEN RAISE EXCEPTION 'LPX_LISTING: 게시 중인 매물에만 제안합니다.'; END IF;
    IF NEW.state <> 'OPEN' OR NEW.counter_amount IS NOT NULL OR NEW.counter_count <> 0 OR NEW.final_amount IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
      RAISE EXCEPTION 'LPX_OFFER: 새 제안은 답 기다림 상태로만 만듭니다.';
    END IF;
    IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'LPX_OFFER: 기한은 앞 시각이어야 합니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.listing_id, NEW.member_account_id, NEW.owner_account_id, NEW.asking_amount, NEW.created_at)
     IS DISTINCT FROM (OLD.listing_id, OLD.member_account_id, OLD.owner_account_id, OLD.asking_amount, OLD.created_at) THEN
    RAISE EXCEPTION 'LPX_OFFER: 제안 내용은 바꿀 수 없습니다.';
  END IF;
  IF OLD.state IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED') THEN RAISE EXCEPTION 'LPX_OFFER_STATE: 끝난 제안은 바꾸지 않습니다.'; END IF;
  IF NEW.state = OLD.state THEN RAISE EXCEPTION 'LPX_OFFER_STATE: 상태가 그대로면 바꿀 것이 없습니다.'; END IF;
  /* 되제안 두 길 — 주인 OPEN → COUNTERED(되제안 금액) · 회원 COUNTERED → OPEN(다시 제안 금액) · 둘 다 횟수 하나 · 설정 넘으면 막음 */
  IF (OLD.state = 'OPEN' AND NEW.state = 'COUNTERED') OR (OLD.state = 'COUNTERED' AND NEW.state = 'OPEN') THEN
    IF OLD.expires_at <= now() THEN RAISE EXCEPTION 'LPX_OFFER_EXPIRED: 기한이 지난 제안입니다.'; END IF;
    IF NEW.counter_count <> OLD.counter_count + 1 THEN RAISE EXCEPTION 'LPX_OFFER_STATE: 되제안 횟수가 맞지 않습니다.'; END IF;
    IF NEW.counter_count > public.fn_lpx_counter_max() THEN RAISE EXCEPTION 'LPX_COUNTER_LIMIT: 되제안 횟수를 다 썼습니다 — 수락 · 거절 중에 고르십시오.'; END IF;
    IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'LPX_OFFER: 기한은 앞 시각이어야 합니다.'; END IF;
    IF NEW.state = 'COUNTERED' THEN
      IF (NEW.amount, NEW.memo) IS DISTINCT FROM (OLD.amount, OLD.memo) THEN RAISE EXCEPTION 'LPX_OFFER: 제안 내용은 바꿀 수 없습니다.'; END IF;
      IF NEW.counter_amount IS NULL OR NEW.counter_amount = OLD.amount OR NEW.countered_at IS NULL THEN RAISE EXCEPTION 'LPX_COUNTER_SAME: 되제안 금액이 없거나 같습니다.'; END IF;
    ELSE
      IF (NEW.counter_amount, NEW.counter_memo, NEW.countered_at) IS DISTINCT FROM (OLD.counter_amount, OLD.counter_memo, OLD.countered_at) THEN RAISE EXCEPTION 'LPX_OFFER: 제안 내용은 바꿀 수 없습니다.'; END IF;
      IF NEW.amount = OLD.counter_amount THEN RAISE EXCEPTION 'LPX_COUNTER_SAME: 되제안 금액이 없거나 같습니다.'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  /* 그 밖(수락 · 거절 · 거둠 · 만료)은 금액 · 메모 · 되제안 칸을 바꾸지 않음 */
  IF (NEW.amount, NEW.memo, NEW.counter_amount, NEW.counter_memo, NEW.countered_at, NEW.counter_count)
     IS DISTINCT FROM (OLD.amount, OLD.memo, OLD.counter_amount, OLD.counter_memo, OLD.countered_at, OLD.counter_count) THEN
    RAISE EXCEPTION 'LPX_OFFER: 제안 내용은 바꿀 수 없습니다.';
  END IF;
  IF NEW.state = 'EXPIRED' THEN
    RETURN NEW;   -- 기한 지남 · 매물 내려감(정기 작업 · SYSTEM)
  END IF;
  IF OLD.expires_at <= now() THEN RAISE EXCEPTION 'LPX_OFFER_EXPIRED: 기한이 지난 제안입니다.'; END IF;
  IF NEW.state = 'ACCEPTED' THEN
    IF OLD.state = 'OPEN' AND NEW.final_amount IS DISTINCT FROM OLD.amount THEN RAISE EXCEPTION 'LPX_OFFER_STATE: 수락 금액은 제안 금액입니다.'; END IF;
    IF OLD.state = 'COUNTERED' AND NEW.final_amount IS DISTINCT FROM OLD.counter_amount THEN RAISE EXCEPTION 'LPX_OFFER_STATE: 수락 금액은 되제안 금액입니다.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.state IN ('REJECTED', 'WITHDRAWN') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'LPX_OFFER_STATE: 이 상태로는 바꿀 수 없습니다.';
END $$;
DROP TRIGGER IF EXISTS trg_lpx_offer_guard ON public.lpx_offers;
CREATE TRIGGER trg_lpx_offer_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lpx_offers
  FOR EACH ROW EXECUTE FUNCTION public.fn_lpx_offer_guard();

/* ── ③ 판매자 자리 비움 ─────────────────────────────────────────────────────────
 *   자리 비움(lpx_away) — 회원(매물 주인)마다 살아 있는 줄 하나(ACTIVE) · 한국 날짜 시작 · 끝(91일 안 · 서버는 lpx.away_max_days)
 *   고치기는 닫기(ACTIVE → ENDED · CANCELLED) 하나뿐 — 날짜 바꾸기는 닫고 새 줄 · 지우기 막음
 *   보이는 때 = lpx.away on 이고 오늘(한국)이 시작 ~ 끝 안(fn_lpx_away_on) — 끝 날짜가 지나면 바로 안 보임 · 정기 작업이 ENDED 로
 *   자동 안내(lpx_away_notices) — 같은 자리 비움 · 같은 회원에게 한 번(문의 · 질문 · 가격 제안 · 방문 예약 중 먼저 온 길) */
CREATE TABLE IF NOT EXISTS public.lpx_away (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  message     text,
  state       text NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  CONSTRAINT ck_lpx_away_state CHECK (state IN ('ACTIVE', 'ENDED', 'CANCELLED')),
  CONSTRAINT ck_lpx_away_ended CHECK ((state = 'ACTIVE') = (ended_at IS NULL)),
  CONSTRAINT ck_lpx_away_range CHECK (ends_on >= starts_on AND ends_on - starts_on <= 90),
  CONSTRAINT ck_lpx_away_message CHECK (message IS NULL OR char_length(message) <= 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lpx_away_live ON public.lpx_away (account_id) WHERE state = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_lpx_away_account ON public.lpx_away (account_id, id DESC);
COMMENT ON TABLE public.lpx_away IS 'v10.551 (D286) 판매자 자리 비움 — 회원마다 살아 있는 줄 하나 · 한국 날짜 · 매물 상세 표시 · 문의 · 질문 · 가격 제안 · 방문 예약 자동 안내 · 끝 날짜 지나면 저절로 풀림(정기 작업 lpx_hourly 가 ENDED) · 고치기는 닫기만 · 지우기 막음';
COMMENT ON COLUMN public.lpx_away.message IS '매물 상세 · 자동 안내에 보이는 한 줄(200자 · 연락처는 서버가 가려서 저장 · 공개)';

CREATE OR REPLACE FUNCTION public.fn_lpx_away_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LPX_AWAY: 자리 비움 기록은 지우지 않습니다(닫기만).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' THEN RAISE EXCEPTION 'LPX_AWAY: 새 자리 비움은 켜진 상태로만 만듭니다.'; END IF;
    IF NEW.ends_on < (now() AT TIME ZONE 'Asia/Seoul')::date THEN RAISE EXCEPTION 'LPX_AWAY_DATE: 끝 날짜가 지났습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.account_id, NEW.starts_on, NEW.ends_on, NEW.message, NEW.created_at) IS DISTINCT FROM (OLD.account_id, OLD.starts_on, OLD.ends_on, OLD.message, OLD.created_at) THEN
    RAISE EXCEPTION 'LPX_AWAY: 날짜 · 안내는 바꿀 수 없습니다 — 끝내고 새로 켜십시오.';
  END IF;
  IF NOT (OLD.state = 'ACTIVE' AND NEW.state IN ('ENDED', 'CANCELLED')) THEN RAISE EXCEPTION 'LPX_AWAY: 켜진 자리 비움을 닫는 것만 됩니다.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lpx_away_guard ON public.lpx_away;
CREATE TRIGGER trg_lpx_away_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lpx_away
  FOR EACH ROW EXECUTE FUNCTION public.fn_lpx_away_guard();

/* 지금 보이는 자리 비움 번호 — lpx.away on 이고 오늘(한국)이 기간 안이면 그 번호 · 아니면 NULL */
CREATE OR REPLACE FUNCTION public.fn_lpx_away_on(p_account uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT a.id FROM public.lpx_away a
   WHERE a.account_id = p_account AND a.state = 'ACTIVE'
     AND a.starts_on <= (now() AT TIME ZONE 'Asia/Seoul')::date AND a.ends_on >= (now() AT TIME ZONE 'Asia/Seoul')::date
     AND EXISTS (SELECT 1 FROM public.site_settings s WHERE s.key = 'lpx.away' AND s.value = 'on')
   LIMIT 1
$$;

CREATE TABLE IF NOT EXISTS public.lpx_away_notices (
  away_id     bigint NOT NULL REFERENCES public.lpx_away(id),
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  listing_id  uuid REFERENCES public.listings(id),
  via         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (away_id, account_id),
  CONSTRAINT ck_lpx_away_notice_via CHECK (via IN ('CONVERSATION', 'QUESTION', 'OFFER', 'VISIT'))
);
CREATE INDEX IF NOT EXISTS ix_lpx_away_notices_at ON public.lpx_away_notices (created_at DESC);
COMMENT ON TABLE public.lpx_away_notices IS 'v10.551 (D286) 자리 비움 자동 안내 기록 — 같은 자리 비움 · 같은 회원 한 번 · 길(1:1 문의 · 공개 질문 · 가격 제안 · 방문 예약) · 쌓기만';

/* 자동 안내 한 번 — 보낸 회원(p_visitor)에게 LPX_AWAY_AUTO(fn_notify · 회원 알림 설정 따름) · 처음이면 true
 * ★ 안내가 실패해도 부른 쪽(문의 · 질문 · 방문 예약 넣기)을 막지 않음 — 오류는 경고만 */
CREATE OR REPLACE FUNCTION public.fn_lpx_away_autonotice(p_owner uuid, p_visitor uuid, p_listing uuid, p_via text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_away bigint; a record; v_title text; v_new int;
BEGIN
  IF p_owner IS NULL OR p_visitor IS NULL OR p_owner = p_visitor THEN RETURN false; END IF;
  v_away := public.fn_lpx_away_on(p_owner);
  IF v_away IS NULL THEN RETURN false; END IF;
  INSERT INTO public.lpx_away_notices (away_id, account_id, listing_id, via) VALUES (v_away, p_visitor, p_listing, p_via) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  IF v_new = 0 THEN RETURN false; END IF;
  SELECT ends_on, message INTO a FROM public.lpx_away WHERE id = v_away;
  SELECT left(title, 40) INTO v_title FROM public.listings WHERE id = p_listing;
  PERFORM public.fn_notify(p_visitor, 'LPX_AWAY_AUTO',
    jsonb_build_object('title', coalesce(v_title, '매물'), 'until', to_char(a.ends_on, 'MM/DD'), 'message', coalesce(a.message, '돌아오면 답을 드립니다.')),
    NULL);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING USING MESSAGE = 'LPX_AWAY_NOTICE: 자동 안내를 보내지 못했습니다 — ' || SQLERRM;
  RETURN false;
END $$;

/* 길 ① 1:1 문의(매물 대화 첫 줄) · ② 공개 질문 — 원래 넣기는 그대로(AFTER · 실패해도 함수가 삼킴) */
CREATE OR REPLACE FUNCTION public.fn_lpx_away_on_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_type = 'LISTING' THEN
    PERFORM public.fn_lpx_away_autonotice(NEW.counterpart_id, NEW.initiator_id, NEW.target_id, 'CONVERSATION');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lpx_away_on_conversation ON public.conversations;
CREATE TRIGGER trg_lpx_away_on_conversation AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.fn_lpx_away_on_conversation();

CREATE OR REPLACE FUNCTION public.fn_lpx_away_on_question() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT owner_account_id INTO v_owner FROM public.listings WHERE id = NEW.listing_id;
  PERFORM public.fn_lpx_away_autonotice(v_owner, NEW.asker_id, NEW.listing_id, 'QUESTION');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lpx_away_on_question ON public.public_questions;
CREATE TRIGGER trg_lpx_away_on_question AFTER INSERT ON public.public_questions
  FOR EACH ROW EXECUTE FUNCTION public.fn_lpx_away_on_question();

/* 길 ④ 방문 예약(b284 · D284 vsx_bookings) — 표가 있을 때만 트리거를 붙임(D284 가 먼저 합쳐지면 붙고 · 없으면 건너뜀 · 다시 돌려도 같음) */
CREATE OR REPLACE FUNCTION public.fn_lpx_away_on_visit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT owner_account_id INTO v_owner FROM public.listings WHERE id = NEW.listing_id;
  PERFORM public.fn_lpx_away_autonotice(v_owner, NEW.member_account_id, NEW.listing_id, 'VISIT');
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF to_regclass('public.vsx_bookings') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_lpx_away_on_visit ON public.vsx_bookings';
    EXECUTE 'CREATE TRIGGER trg_lpx_away_on_visit AFTER INSERT ON public.vsx_bookings FOR EACH ROW EXECUTE FUNCTION public.fn_lpx_away_on_visit()';
  END IF;
END $$;

/* ── ④ 지역별 시세 통계 ─────────────────────────────────────────────────────────
 *   lpx_price_stats — 달 × 관 × 업종(상위 분류 · 'ALL') × 시 · 도('' = 전국) × 시 · 구('' = 시 · 도 전체)
 *   셈 대상 = 그 달(한국)에 게시된(published_at) 매물 · 지금 PUBLISHED · ARCHIVED · 거래(희망) 금액 > 0 · 시 · 도 있음
 *   ★ 매물 5개 미만 칸은 값(가운데 · 4분의 1)을 DB 가 비움(CHECK) — 공개 API 는 lpx.stats_min(5 이상) 칸만
 *   그 달 다시 셈 = fn_lpx_stats_refresh(달) 한 번(그 달 줄 지우고 새로 · 정기 작업 lpx_stats_daily · 운영 「지금 셈」) */
CREATE TABLE IF NOT EXISTS public.lpx_price_stats (
  ym             text NOT NULL,
  gwan_code      text NOT NULL,
  category_key   text NOT NULL,
  sido           text NOT NULL DEFAULT '',
  sigungu        text NOT NULL DEFAULT '',
  n              integer NOT NULL,
  median_amount  numeric(16,0),
  p25_amount     numeric(16,0),
  p75_amount     numeric(16,0),
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ym, gwan_code, category_key, sido, sigungu),
  CONSTRAINT ck_lpx_stats_ym CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT ck_lpx_stats_cat CHECK (category_key = 'ALL' OR category_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT ck_lpx_stats_area CHECK (sido <> '' OR sigungu = ''),
  CONSTRAINT ck_lpx_stats_n CHECK (n >= 0),
  CONSTRAINT ck_lpx_stats_small CHECK (n >= 5 OR (median_amount IS NULL AND p25_amount IS NULL AND p75_amount IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_lpx_price_stats_cell ON public.lpx_price_stats (gwan_code, category_key, sido, sigungu, ym);
COMMENT ON TABLE public.lpx_price_stats IS 'v10.552 (D286) 지역별 시세 통계 — 달 × 관 × 업종(상위 · ALL) × 시 · 도 × 시 · 구 거래(희망) 금액 가운데값 · 4분의 1 · 매물 5개 미만 칸은 값 없음(CHECK) · 매일 04:50 lpx_stats_daily(lpx.stats on) · 공개 API 는 집계만';

/* 업종 상위 분류 — 부모를 따라 맨 위까지(10단 울타리) */
CREATE OR REPLACE FUNCTION public.fn_lpx_category_root(p_id uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up(id, parent_id, depth) AS (
    SELECT c.id, c.parent_id, 0 FROM public.categories c WHERE c.id = p_id
    UNION ALL
    SELECT c.id, c.parent_id, up.depth + 1 FROM public.categories c JOIN up ON c.id = up.parent_id WHERE up.depth < 10
  )
  SELECT id FROM up ORDER BY (parent_id IS NULL) DESC, depth DESC LIMIT 1
$$;

/* 그 달 다시 셈 — 만든 칸 수 */
CREATE OR REPLACE FUNCTION public.fn_lpx_stats_refresh(p_ym text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_n integer;
BEGIN
  IF p_ym IS NULL OR p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'LPX_STATS_YM: 달은 YYYY-MM 입니다.'; END IF;
  v_from := (p_ym || '-01')::date::timestamp AT TIME ZONE 'Asia/Seoul';
  v_to := ((p_ym || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul';
  DELETE FROM public.lpx_price_stats WHERE ym = p_ym;
  INSERT INTO public.lpx_price_stats (ym, gwan_code, category_key, sido, sigungu, n, median_amount, p25_amount, p75_amount, computed_at)
  SELECT p_ym, x.gwan_code,
         CASE WHEN GROUPING(x.cat) = 1 THEN 'ALL' ELSE x.cat END,
         CASE WHEN GROUPING(x.sido) = 1 THEN '' ELSE x.sido END,
         CASE WHEN GROUPING(x.sigungu) = 1 THEN '' ELSE x.sigungu END,
         count(*)::int,
         CASE WHEN count(*) >= 5 THEN round(percentile_cont(0.5) WITHIN GROUP (ORDER BY x.amount))::numeric(16,0) END,
         CASE WHEN count(*) >= 5 THEN round(percentile_cont(0.25) WITHIN GROUP (ORDER BY x.amount))::numeric(16,0) END,
         CASE WHEN count(*) >= 5 THEN round(percentile_cont(0.75) WITHIN GROUP (ORDER BY x.amount))::numeric(16,0) END,
         now()
    FROM (
      SELECT l.gwan_code, public.fn_lpx_category_root(l.category_id)::text AS cat,
             btrim(l.address->>'sido') AS sido, coalesce(nullif(btrim(l.address->>'sigungu'), ''), '-') AS sigungu, l.deal_amount::float8 AS amount
        FROM public.listings l
       WHERE l.published_at >= v_from AND l.published_at < v_to AND l.status IN ('PUBLISHED', 'ARCHIVED')
         AND l.deal_amount > 0 AND coalesce(btrim(l.address->>'sido'), '') <> ''
    ) x
   WHERE x.cat IS NOT NULL
   GROUP BY GROUPING SETS ((x.gwan_code, x.cat, x.sido, x.sigungu), (x.gwan_code, x.cat, x.sido), (x.gwan_code, x.cat),
                           (x.gwan_code, x.sido, x.sigungu), (x.gwan_code, x.sido), (x.gwan_code));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

/* ── ⑤ 설정 · 알림 · 정기 작업 · 기능 스위치 켤 조건 · ㉕ 권한(D258) 시드 ──────────────────────────
 *   스위치 4개 모두 처음 off(규칙 9) · 값 무늬(value_pattern)는 서버 common.ts LPX_PATTERNS 와 같은 글자(규칙 2) */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('lpx.offer', 'off', 'ADMIN', '매물 가격 제안(v10.549 · D286) — 처음 off · on 이고 관이 lpx.offer_gwans 에 있으면 회원이 게시 중 매물에 희망 가격을 제안 → 주인 수락 · 거절 · 되제안 · 기한 만료(거래는 만들지 않고 1:1 문의로 안내)', false, '^(on|off)$', 'off'),
  ('lpx.offer_gwans', 'NONE', 'ADMIN', '가격 제안을 쓰는 관(v10.549 · 관별 설정) — NONE(처음 · 모두 꺼짐) 또는 관 코드 쉼표 목록(예 MNY,BIZ) · 꺼진 관 매물은 서버 · DB 트리거가 막음(422 LPX_GWAN_OFF)', false, '^(NONE|[A-Z]{3,4}(,[A-Z]{3,4}){0,29})$', 'NONE'),
  ('lpx.offer_days', '7', 'ADMIN', '가격 제안 · 되제안 답 기한 일수(v10.549 · 1 ~ 14 · 처음 7 · 대표 11/21) — 되제안 · 다시 제안 때 다시 셈 · 지나면 정기 작업 lpx_hourly 가 만료', false, '^([1-9]|1[0-4])$', '7'),
  ('lpx.offer_min_pct', '30', 'ADMIN', '거래 금액의 몇 퍼센트 아래 제안은 받지 않음(v10.549 · 0 ~ 99 · 처음 30 · 대표 11/21 · 0 = 하한 없음)', false, '^([0-9]|[1-9][0-9])$', '30'),
  ('lpx.offer_counter_max', '3', 'ADMIN', '가격 제안 한 건의 되제안 횟수(v10.549 · 1 ~ 5 · 처음 3 · 대표 11/21) — 주인 되제안 · 회원 다시 제안을 모두 셈 · 넘으면 DB 트리거가 막음(LPX_COUNTER_LIMIT)', false, '^[1-5]$', '3'),
  ('lpx.offer_member_max', '20', 'ADMIN', '회원마다 열린 가격 제안 수(v10.549 · 1 ~ 50 · 처음 20)', false, '^([1-9]|[1-4][0-9]|50)$', '20'),
  ('lpx.watermark', 'off', 'ADMIN', '매물 사진 워터마크(v10.550 · D286) — 처음 off · on 이면 사용자 웹 매물 상세 사진 위에 「SogaeBank/소개뱅크」 글자를 겹쳐 보임(원본 사진은 그대로)', false, '^(on|off)$', 'off'),
  ('lpx.watermark_pos', 'BR', 'ADMIN', '워터마크 자리(v10.550) — BR 오른쪽 아래(처음) · BL · TR · TL · C 가운데 · TILE 여러 번', false, '^(BR|BL|TR|TL|C|TILE)$', 'BR'),
  ('lpx.watermark_opacity', '35', 'ADMIN', '워터마크 진하기(v10.550 · 10 ~ 60 · 처음 35)', false, '^([1-5][0-9]|60)$', '35'),
  ('lpx.away', 'off', 'ADMIN', '판매자 자리 비움(v10.551 · D286) — 처음 off · on 이면 회원이 기간 · 안내를 켜고 매물 상세에 표시 · 문의 · 질문 · 가격 제안 · 방문 예약 때 보낸 회원에게 자동 안내 한 번 · 끝 날짜 지나면 저절로 풀림', false, '^(on|off)$', 'off'),
  ('lpx.away_max_days', '30', 'ADMIN', '자리 비움 한 번 최대 일수(v10.551 · 1 ~ 90 · 처음 30)', false, '^([1-9]|[1-8][0-9]|90)$', '30'),
  ('lpx.stats', 'off', 'ADMIN', '지역별 시세 통계(v10.552 · D286) — 처음 off · on 이면 매일 04:50 관 · 업종 · 시 · 구별 게시 매물 거래(희망) 금액 가운데값을 모으고 공개 API · 화면에 집계만 보임', false, '^(on|off)$', 'off'),
  ('lpx.stats_min', '5', 'ADMIN', '시세 통계 공개 칸 최소 매물 수(v10.552 · 5 ~ 50 · 처음 5 — 5 아래로 못 내림 · 5개 미만 칸은 DB 가 값을 비움)', false, '^([5-9]|[1-4][0-9]|50)$', '5'),
  ('lpx.stats_months', '12', 'ADMIN', '시세 통계 달별 추이 달 수(v10.552 · 3 ~ 24 · 처음 12)', false, '^([3-9]|1[0-9]|2[0-4])$', '12')
ON CONFLICT (key) DO NOTHING;

/* 알림 종류 · 글 — 모두 회원이 끌 수 있음(나의공간 › 알림 · 설정) · 이름에 MARKETING · AD_ 없음 */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('LPX_OFFER_NEW', '가격 제안 받음', true, false, '내 매물에 회원이 희망 가격을 제안(v10.549 · D286)', 'info'),
  ('LPX_OFFER_COUNTER', '가격 되제안 받음', true, false, '내 가격 제안에 매물 주인이 되제안(v10.549 · D286)', 'info'),
  ('LPX_OFFER_ACCEPTED', '가격 제안 수락', true, false, '가격 제안 · 되제안을 상대가 수락(v10.549 · D286)', 'info'),
  ('LPX_OFFER_REJECTED', '가격 제안 거절', true, false, '가격 제안 · 되제안을 상대가 거절(v10.549 · D286)', 'info'),
  ('LPX_OFFER_EXPIRED', '가격 제안 기한 지남', true, false, '답 기한이 지나거나 매물이 내려가 내 가격 제안이 끝남(v10.549 · D286)', 'info'),
  ('LPX_AWAY_AUTO', '판매자 자리 비움 안내', true, false, '문의 · 질문 · 가격 제안 · 방문 예약을 보낸 매물의 판매자가 자리 비움(v10.551 · D286 · 자리 비움마다 한 번)', 'info')
ON CONFLICT (event_code) DO NOTHING;
INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('LPX_OFFER_NEW_INAPP', 'INAPP', '「{title}」에 가격 제안이 왔습니다',
   E'제안 금액 {amount}\n{days}일 안에 나의공간 › 가격 제안에서 수락 · 거절 · 되제안해 주십시오. 답이 없으면 저절로 끝납니다.', '["title","amount","days"]'::jsonb),
  ('LPX_OFFER_COUNTER_INAPP', 'INAPP', '「{title}」 판매자가 {amount}로 되제안했습니다',
   '{days}일 안에 나의공간 › 가격 제안에서 수락하거나 거절해 주십시오.', '["title","amount","days"]'::jsonb),
  ('LPX_OFFER_ACCEPTED_INAPP', 'INAPP', '「{title}」 가격 {amount}에 합의했습니다',
   '가격 제안은 계약이 아닙니다 — 매물 상세의 「1:1 문의」로 대화를 열어 기존 거래 흐름(소개비 · 계약)으로 진행해 주십시오.', '["title","amount"]'::jsonb),
  ('LPX_OFFER_REJECTED_INAPP', 'INAPP', '「{title}」 가격 제안({amount})이 거절되었습니다',
   '다른 금액으로 다시 제안하거나 1:1 문의로 물어볼 수 있습니다.', '["title","amount"]'::jsonb),
  ('LPX_OFFER_EXPIRED_INAPP', 'INAPP', '「{title}」 가격 제안({amount})이 끝났습니다',
   '답 기한이 지났거나 매물이 내려가 제안이 끝났습니다.', '["title","amount"]'::jsonb),
  ('LPX_AWAY_AUTO_INAPP', 'INAPP', '「{title}」 판매자가 {until} 까지 자리를 비웁니다',
   E'판매자 안내: {message}\n보내신 문의 · 제안은 그대로 전달되었고, 돌아오면 답을 받을 수 있습니다.', '["title","until","message"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('lpx_hourly', 60, NULL, NULL, NULL, true, '매물 3 — 매시간 · 기한 지난 · 내려간 매물의 열린 가격 제안 만료(알림) · 끝 날짜 지난 자리 비움 정리(스위치와 상관없이) · D286 · v10.549 · 551'),
  ('lpx_stats_daily', 1440, 4, 50, NULL, true, '지역별 시세 통계 — 매일 04:50 · 이번 달 · 지난달 다시 셈 · 빠진 달 채움 · lpx.stats on 일 때만 · D286 · v10.552')
ON CONFLICT (job) DO NOTHING;

/* ㊺ 기능 스위치 한눈에(opx_switch_docs · D275) — 켤 조건 */
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('lpx.offer', 'off', '약관(소개장터 이용 · 가격 제안은 계약이 아님) 문구 게시 · 쓸 관(lpx.offer_gwans)을 대표가 고른 뒤 — 부동산 관은 중개 경계 확인 뒤', 'docs/687'),
  ('lpx.watermark', 'off', '대표가 글자 자리 · 진하기를 운영 미리보기로 확인한 뒤(원본 사진은 그대로 · 화면 겹침만)', 'docs/688'),
  ('lpx.away', 'off', '처리방침 변경 없음 확인(안내 글은 회원이 공개하려고 쓰는 글) · 회원 안내 공지 뒤', 'docs/689'),
  ('lpx.stats', 'off', '「게시 매물 거래(희망) 금액 · 실제 거래가 아님」 안내 문구 확인 · 운영 「지금 셈」 미리보기 뒤 · 5개 미만 칸 숨김 그대로', 'docs/690')
ON CONFLICT (key) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 새 탭 4개 · 검수 묶음(admrev · TAB_ROLES 따로 없음 = ADMIN · SUPER) · gen_seed.py 와 같은 규칙(GET = VIEW · 지금 한 번 = APPROVE · 그 밖 변경 = EDIT) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('lpx-offers', '매물 가격 제안', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 95),
  ('lpx-photo', '매물 사진 워터마크', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 96),
  ('lpx-away', '판매자 자리 비움', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 97),
  ('lpx-stats', '지역별 시세 통계', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 98)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'lpx-offers', 'VIEW'), ('R_ADMIN', 'lpx-offers', 'EDIT'), ('R_ADMIN', 'lpx-offers', 'APPROVE'), ('R_ADMIN', 'lpx-offers', 'EXPORT'),
  ('R_ADMIN', 'lpx-photo', 'VIEW'), ('R_ADMIN', 'lpx-photo', 'EDIT'), ('R_ADMIN', 'lpx-photo', 'APPROVE'), ('R_ADMIN', 'lpx-photo', 'EXPORT'),
  ('R_ADMIN', 'lpx-away', 'VIEW'), ('R_ADMIN', 'lpx-away', 'EDIT'), ('R_ADMIN', 'lpx-away', 'APPROVE'), ('R_ADMIN', 'lpx-away', 'EXPORT'),
  ('R_ADMIN', 'lpx-stats', 'VIEW'), ('R_ADMIN', 'lpx-stats', 'EDIT'), ('R_ADMIN', 'lpx-stats', 'APPROVE'), ('R_ADMIN', 'lpx-stats', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/lpx/offers', 'lpx-offers', 'VIEW'),
  ('POST', '/admin/lpx/offers/run', 'lpx-offers', 'APPROVE'),
  ('PUT', '/admin/lpx/settings', 'lpx-offers', 'EDIT'),
  ('PUT', '/admin/lpx/settings', 'lpx-photo', 'EDIT'),
  ('PUT', '/admin/lpx/settings', 'lpx-away', 'EDIT'),
  ('PUT', '/admin/lpx/settings', 'lpx-stats', 'EDIT'),
  ('GET', '/admin/lpx/watermark', 'lpx-photo', 'VIEW'),
  ('GET', '/admin/lpx/away', 'lpx-away', 'VIEW'),
  ('GET', '/admin/lpx/stats', 'lpx-stats', 'VIEW'),
  ('POST', '/admin/lpx/stats/run', 'lpx-stats', 'APPROVE')
ON CONFLICT DO NOTHING;

