-- =====================================================================
-- (메인이 D292 ~ 중 한 번호에 붙임) 17차 매물 · 소개몰 (v10.602 ~ 608 · docs/744 ~ 750) — 앞머리 lsq_
--
--   v10.602 ⑱ 매물 CSV 일괄 등록 — lsq_bulk_jobs · lsq_bulk_rows(미리보기 → 확정 · 확정은 기존 매물 등록(검수 큐)을 줄마다 부름)
--   v10.603 ⑲ 성사 뒤 후기 요청 — lsq_review_asks(거래 × 당사자 한 줄 · 두 번까지) · deal_reviews 가 들어오면 reviewed_at(트리거)
--   v10.604 ⑳ 검색 클릭 분석 — lsq_search_clicks(날 × 낱말 × 관 × 순위) · lsq_search_click_items(날 × 낱말 × 매물) · 회원 · 방문자 · IP 칸 없음
--   v10.605 ㉑ 지역별 소개 페이지 — 표 없음(기존 보기 v_listing_region) · 설정만
--   v10.606 ㉒ 정기 배송 결제 실패 다시 시도 — lsq_sub_pay_fails(실패 기록 · 다음 시도일) · lsq_sub_retry_log(회원 · 운영 「지금 다시」)
--   v10.607 ㉓ 배송 추적 연동 — lsq_track_events · lsq_track_polls · 외부 연동 CARRIER(택배사 조회 · 처음 꺼짐 · 간주)
--   v10.608 ㉔ 반품 · 교환 사진 · 판정 기록 — 파일 용도 RETURN_PHOTO · lsq_return_photos · lsq_return_verdicts(고치기 막음 · 상태 바뀜은 트리거가 적음)
--   스위치는 모두 처음 off · 방식은 ASSUME · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음 · 지우는 문장 없음
-- =====================================================================

/* ── v10.602 ⑱ 매물 CSV 일괄 등록 ─────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.lsq_bulk_jobs (
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  state        text NOT NULL DEFAULT 'PREVIEW' CHECK (state IN ('PREVIEW', 'DONE', 'EXPIRED')),
  file_name    text CHECK (file_name IS NULL OR char_length(file_name) <= 120),
  row_count    integer NOT NULL DEFAULT 0 CHECK (row_count BETWEEN 0 AND 200),
  valid_count  integer NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  made_count   integer NOT NULL DEFAULT 0 CHECK (made_count >= 0),
  fail_count   integer NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  confirmed_at timestamptz,
  CONSTRAINT ck_lsq_bulk_done CHECK ((state = 'DONE') = (confirmed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_lsq_bulk_jobs_owner ON public.lsq_bulk_jobs (account_id, created_at DESC);
COMMENT ON TABLE public.lsq_bulk_jobs IS 'v10.602 (docs/744) 매물 CSV 일괄 등록 묶음 — 미리보기(PREVIEW · 24시간) → 확정(DONE · 줄마다 기존 매물 등록 = 검수 큐) · 확정 안 하면 EXPIRED · 90일 지나면 lsq_daily 가 지움';

CREATE TABLE IF NOT EXISTS public.lsq_bulk_rows (
  job_id      bigint NOT NULL REFERENCES public.lsq_bulk_jobs(id) ON DELETE CASCADE,
  line        integer NOT NULL CHECK (line BETWEEN 1 AND 200),
  state       text NOT NULL CHECK (state IN ('VALID', 'INVALID', 'CREATED', 'FAILED')),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  problems    text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(problems) <= 10),
  listing_id  uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  result_note text CHECK (result_note IS NULL OR char_length(result_note) <= 300),
  PRIMARY KEY (job_id, line)
);
COMMENT ON TABLE public.lsq_bulk_rows IS 'v10.602 (docs/744) CSV 줄 — 미리보기 결과(VALID · INVALID · 문제 낱말) · 확정 결과(CREATED 매물 · FAILED 사유) · 연락처는 서버가 가린 뒤 저장';

/* ── v10.603 ⑲ 성사 뒤 후기 요청 ───────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.lsq_review_asks (
  deal_id        uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL,
  party          text NOT NULL CHECK (party IN ('BUYER', 'SELLER')),
  ask_count      smallint NOT NULL DEFAULT 1 CHECK (ask_count BETWEEN 1 AND 2),
  first_asked_at timestamptz NOT NULL DEFAULT now(),
  last_asked_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at    timestamptz,
  PRIMARY KEY (deal_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_lsq_review_asks_at ON public.lsq_review_asks (first_asked_at DESC);
COMMENT ON TABLE public.lsq_review_asks IS 'v10.603 (docs/745) 성사 뒤 후기 요청 — 거래 × 당사자 한 줄 · 처음 요청 + 다시 한 번(lsq.review_ask_again 일 뒤 · 0 이면 없음) · 후기를 쓰면 reviewed_at(트리거) · 알림은 fn_notify(회원이 끌 수 있음)';

CREATE OR REPLACE FUNCTION public.lsq_fn_review_ask_done()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  UPDATE public.lsq_review_asks SET reviewed_at = now()
   WHERE deal_id = NEW.deal_id AND account_id = NEW.author_id AND reviewed_at IS NULL;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_lsq_review_ask_done ON public.deal_reviews;
CREATE TRIGGER trg_lsq_review_ask_done AFTER INSERT ON public.deal_reviews
  FOR EACH ROW EXECUTE FUNCTION public.lsq_fn_review_ask_done();

/* ── v10.604 ⑳ 검색 클릭 분석(익명 · 순위 자료만) ───────────────────── */
CREATE TABLE IF NOT EXISTS public.lsq_search_clicks (
  day    date NOT NULL,
  term   text NOT NULL CHECK (char_length(term) BETWEEN 1 AND 40 AND term !~ '[0-9]{3,}' AND position('@' IN term) = 0),
  gwan   text NOT NULL CHECK (gwan ~ '^(ALL|[A-Z]{3,4})$'),
  pos    smallint NOT NULL CHECK (pos BETWEEN 1 AND 100),
  clicks integer NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (day, term, gwan, pos)
);
CREATE TABLE IF NOT EXISTS public.lsq_search_click_items (
  day        date NOT NULL,
  term       text NOT NULL CHECK (char_length(term) BETWEEN 1 AND 40),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  clicks     integer NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (day, term, listing_id)
);
COMMENT ON TABLE public.lsq_search_clicks IS 'v10.604 (docs/746) 검색 결과 클릭 — 날(한국) × 정규화 낱말 × 관 × 순위의 수만 · 회원 · 방문자 · IP · 브라우저 칸 없음 · 보관 lsq.search_click_keep_days 뒤 lsq_daily 가 지움';
COMMENT ON TABLE public.lsq_search_click_items IS 'v10.604 (docs/746) 검색 낱말 × 눌린 매물 수(날별) — 누가 눌렀는지 없음 · 노출 순위에 쓰지 않음(운영 참고 자료)';

CREATE OR REPLACE FUNCTION public.lsq_fn_search_click_add(p_day date, p_term text, p_gwan text, p_pos integer, p_listing uuid)
 RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  INSERT INTO public.lsq_search_clicks (day, term, gwan, pos, clicks) VALUES (p_day, p_term, p_gwan, p_pos, 1)
  ON CONFLICT (day, term, gwan, pos) DO UPDATE SET clicks = public.lsq_search_clicks.clicks + 1;
  IF p_listing IS NOT NULL AND EXISTS (SELECT 1 FROM public.listings WHERE id = p_listing AND status = 'PUBLISHED') THEN
    INSERT INTO public.lsq_search_click_items (day, term, listing_id, clicks) VALUES (p_day, p_term, p_listing, 1)
    ON CONFLICT (day, term, listing_id) DO UPDATE SET clicks = public.lsq_search_click_items.clicks + 1;
  END IF;
END $function$;

/* ── v10.606 ㉒ 정기 배송 결제 실패 다시 시도 ──────────────────────── */
CREATE TABLE IF NOT EXISTS public.lsq_sub_pay_fails (
  id          bigserial PRIMARY KEY,
  sub_id      bigint NOT NULL REFERENCES public.hlt_subscriptions(id) ON DELETE CASCADE,
  day         date NOT NULL,
  attempt     smallint NOT NULL CHECK (attempt BETWEEN 1 AND 100),
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 300),
  next_try_on date,
  paused      boolean NOT NULL DEFAULT false,
  notified    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sub_id, day)
);
COMMENT ON TABLE public.lsq_sub_pay_fails IS 'v10.606 (docs/748) 정기 배송 결제 실패 기록 — 기존 mall_subscribe 의 실패(failSub) 뒤 한 줄 · lsq.sub_retry on 이면 다음 시도일을 간격표(lsq.sub_retry_days)로 미룸 · 회원 알림 LSQ_SUB_PAY_FAIL';

CREATE TABLE IF NOT EXISTS public.lsq_sub_retry_log (
  id         bigserial PRIMARY KEY,
  sub_id     bigint NOT NULL REFERENCES public.hlt_subscriptions(id) ON DELETE CASCADE,
  actor      uuid,
  who        text NOT NULL CHECK (who IN ('MEMBER', 'ADMIN')),
  result     text NOT NULL CHECK (result IN ('PAID', 'FAILED', 'SKIPPED', 'UNCERTAIN', 'NOT_DUE')),
  detail     text CHECK (detail IS NULL OR char_length(detail) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lsq_sub_retry_log IS 'v10.606 (docs/748) 정기 배송 「지금 다시 결제」 기록 — 회원(카드를 바꾼 뒤) · 운영 · 결과만(카드 정보 없음)';

/* ── v10.607 ㉓ 배송 추적 연동 ─────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.lsq_track_events (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES public.hlt_orders(id) ON DELETE CASCADE,
  carrier     text NOT NULL CHECK (char_length(carrier) BETWEEN 1 AND 30),
  tracking_no text NOT NULL CHECK (tracking_no ~ '^[0-9]{10,14}$'),
  status      text NOT NULL CHECK (status IN ('PICKED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'UNKNOWN')),
  place       text CHECK (place IS NULL OR char_length(place) <= 60),
  detail      text CHECK (detail IS NULL OR char_length(detail) <= 120),
  happened_at timestamptz NOT NULL,
  source      text NOT NULL CHECK (source IN ('ASSUME', 'LIVE')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, tracking_no, status, happened_at)
);
CREATE INDEX IF NOT EXISTS idx_lsq_track_events_order ON public.lsq_track_events (order_id, happened_at DESC);
COMMENT ON TABLE public.lsq_track_events IS 'v10.607 (docs/749) 택배사 조회 결과 — 단계 · 장소(영업소 이름) · 시각만(받는 사람 이름 · 연락처 · 주소 없음) · ASSUME 은 간주로 만든 단계';

CREATE TABLE IF NOT EXISTS public.lsq_track_polls (
  order_id             uuid PRIMARY KEY REFERENCES public.hlt_orders(id) ON DELETE CASCADE,
  tracking_no          text NOT NULL CHECK (tracking_no ~ '^[0-9]{10,14}$'),
  polls                integer NOT NULL DEFAULT 0 CHECK (polls >= 0),
  last_polled_at       timestamptz,
  last_status          text,
  last_error           text CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  delivered_applied_at timestamptz
);
COMMENT ON TABLE public.lsq_track_polls IS 'v10.607 (docs/749) 주문마다 택배사 조회 상태 — 몇 번 · 마지막 단계 · 오류 · 배송 완료를 주문에 넣은 때(lsq.track_auto_deliver on 일 때만 · 기존 hlt_shipments DELIVERED 한 줄)';

/* ── v10.608 ㉔ 반품 · 교환 사진 · 판정 기록 ─────────────────────────── */
/* 파일 용도 RETURN_PHOTO — 지금 CHECK 목록을 읽어 RETURN_PHOTO 만 더함(다른 묶음이 먼저 용도를 더해도 지우지 않게 · 목록을 글자로 베끼지 않음) */
DO $do$
DECLARE v_def text; v_list text[]; v_sql text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'ck_files_purpose' AND conrelid = 'public.files'::regclass;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'LSQ_MIGRATE: ck_files_purpose 검사가 없습니다 — 마이그레이션 순서를 확인하십시오.';
  END IF;
  IF position('RETURN_PHOTO' IN v_def) = 0 THEN
    SELECT array_agg(DISTINCT m[1]) INTO v_list FROM regexp_matches(v_def, '''([A-Z_]+)''', 'g') AS m;
    IF coalesce(cardinality(v_list), 0) < 10 THEN
      RAISE EXCEPTION 'LSQ_MIGRATE: 파일 용도 목록을 읽지 못했습니다 — 손으로 확인하십시오.';
    END IF;
    v_list := v_list || 'RETURN_PHOTO'::text;
    SELECT 'ALTER TABLE public.files DROP CONSTRAINT ck_files_purpose, ADD CONSTRAINT ck_files_purpose CHECK (purpose = ANY (ARRAY['
           || string_agg(quote_literal(x), ',' ORDER BY x) || ']))' INTO v_sql FROM unnest(v_list) AS x;
    EXECUTE v_sql;
  END IF;
END $do$;
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('RETURN_PHOTO', 'image/jpeg', 10485760, 'jpg'), ('RETURN_PHOTO', 'image/png', 10485760, 'png')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lsq_return_photos (
  id         bigserial PRIMARY KEY,
  return_id  uuid NOT NULL REFERENCES public.hlt_returns(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES public.files(id),
  side       text NOT NULL CHECK (side IN ('BUYER', 'SELLER')),
  added_by   uuid NOT NULL,
  note       text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at  timestamptz,
  hidden_by  uuid,
  UNIQUE (return_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_lsq_return_photos ON public.lsq_return_photos (return_id, created_at);
COMMENT ON TABLE public.lsq_return_photos IS 'v10.608 (docs/750) 반품 · 교환 사진 — 구매 회원(BUYER) · 입점 판매자(SELLER)가 올린 RETURN_PHOTO · 운영은 가리기만(hidden_at · 지우지 않음) · 열람은 그 신청의 회원 · 판매자 · 운영';

CREATE OR REPLACE FUNCTION public.lsq_fn_return_photo_guard()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.files f WHERE f.id = NEW.file_id AND f.purpose = 'RETURN_PHOTO' AND f.status = 'READY' AND f.owner_account_id = NEW.added_by) THEN
    RAISE EXCEPTION 'LSQ_RETURN_PHOTO_FILE: 내가 올린 반품 사진(RETURN_PHOTO · 올리기 끝남)만 붙입니다.';
  END IF;
  SELECT count(*) INTO n FROM public.lsq_return_photos WHERE return_id = NEW.return_id AND side = NEW.side AND hidden_at IS NULL;
  IF n >= 10 THEN
    RAISE EXCEPTION 'LSQ_RETURN_PHOTO_MAX: 한 신청에 한쪽 사진은 10장까지입니다.';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_lsq_return_photo_guard ON public.lsq_return_photos;
CREATE TRIGGER trg_lsq_return_photo_guard BEFORE INSERT ON public.lsq_return_photos
  FOR EACH ROW EXECUTE FUNCTION public.lsq_fn_return_photo_guard();

CREATE TABLE IF NOT EXISTS public.lsq_return_verdicts (
  id               bigserial PRIMARY KEY,
  return_id        uuid NOT NULL REFERENCES public.hlt_returns(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('STATE', 'INSPECT', 'NOTE')),
  actor            uuid,
  actor_side       text NOT NULL CHECK (actor_side IN ('BUYER', 'SELLER', 'ADMIN', 'SYSTEM')),
  from_state       text,
  to_state         text,
  item_condition   text CHECK (item_condition IS NULL OR item_condition IN ('UNOPENED', 'OPENED', 'USED', 'DAMAGED', 'MISSING', 'WRONG_ITEM')),
  fault            text CHECK (fault IS NULL OR fault IN ('BUYER', 'SELLER', 'CARRIER', 'UNKNOWN')),
  note             text CHECK (note IS NULL OR char_length(note) <= 500),
  visible_to_buyer boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lsq_verdict_inspect CHECK (kind <> 'INSPECT' OR (item_condition IS NOT NULL AND fault IS NOT NULL)),
  CONSTRAINT ck_lsq_verdict_note CHECK (kind <> 'NOTE' OR note IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_lsq_return_verdicts ON public.lsq_return_verdicts (return_id, created_at, id);
COMMENT ON TABLE public.lsq_return_verdicts IS 'v10.608 (docs/750) 반품 · 교환 판정 기록 — STATE(신청 · 승인 · 반려 · 환불 — 트리거가 적음) · INSPECT(상품 상태 · 책임) · NOTE(메모) · 쌓기만(고치기 막음 · 신청이 지워질 때만 함께 지워짐)';

CREATE OR REPLACE FUNCTION public.lsq_fn_return_verdict_lock()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'LSQ_VERDICT_LOCKED: 판정 기록은 고칠 수 없습니다 — 새 메모를 더하십시오.';
END $function$;
DROP TRIGGER IF EXISTS trg_lsq_return_verdict_lock ON public.lsq_return_verdicts;
CREATE TRIGGER trg_lsq_return_verdict_lock BEFORE UPDATE ON public.lsq_return_verdicts
  FOR EACH ROW EXECUTE FUNCTION public.lsq_fn_return_verdict_lock();

/* 신청 · 상태 바뀜을 판정 기록에 한 줄(누가 — 판매자 · 운영 · 시스템) */
CREATE OR REPLACE FUNCTION public.lsq_fn_return_state_log()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_seller uuid; v_buyer uuid; v_side text;
BEGIN
  SELECT s.account_id, o.account_id INTO v_seller, v_buyer
    FROM public.hlt_orders o LEFT JOIN public.hlt_sellers s ON s.id = o.seller_id WHERE o.id = NEW.order_id;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lsq_return_verdicts (return_id, kind, actor, actor_side, to_state, visible_to_buyer)
    VALUES (NEW.id, 'STATE', v_buyer, 'BUYER', NEW.state, true);
    RETURN NEW;
  END IF;
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
  v_side := CASE WHEN NEW.decided_by IS NULL THEN 'SYSTEM'
                 WHEN v_seller IS NOT NULL AND NEW.decided_by = v_seller THEN 'SELLER'
                 WHEN EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = NEW.decided_by AND r.role IN ('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT')) THEN 'ADMIN'
                 ELSE 'SYSTEM' END;
  INSERT INTO public.lsq_return_verdicts (return_id, kind, actor, actor_side, from_state, to_state, note, visible_to_buyer)
  VALUES (NEW.id, 'STATE', NEW.decided_by, v_side, OLD.state, NEW.state,
          CASE WHEN NEW.state IN ('APPROVED', 'REJECTED') THEN left(NEW.decide_note, 500) END, true);
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_lsq_return_state_log ON public.hlt_returns;
CREATE TRIGGER trg_lsq_return_state_log AFTER INSERT OR UPDATE OF state ON public.hlt_returns
  FOR EACH ROW EXECUTE FUNCTION public.lsq_fn_return_state_log();

/* ── 외부 연동 CARRIER(택배사 조회) · 처음 꺼짐 · 간주 ────────────────── */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('CARRIER', '택배사 배송 조회', '소개몰 주문 송장의 배송 단계 조회(v10.607) — 택배사 · 송장번호만 보냄(받는 사람 이름 · 연락처 · 주소 보내지 않음)',
        'CARRIER_TRACK_API', 'NOT_STARTED', false, 'CARRIER_TRACK_KEY', 2, false,
        '조회 대행(스마트택배 · 굿스플로 등) 계약 뒤 — 운영 화면 › 외부 연동 › 연동 키 CARRIER_TRACK_KEY · 주소 틀 CARRIER_TRACK_BASE → lsq.track_mode LIVE → lsq.track on · 그 전에는 간주(ASSUME) · 배송 완료 반영은 lsq.track_auto_deliver(처음 off · docs/749)',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 200))
ON CONFLICT (code) DO NOTHING;

/* 받는 키 — 지금 CHECK 의 (연동, 키) 짝을 읽어(PG 는 IN 짝을 「(integration_code = 'X'::text) AND (name = 'Y'::text)」 OR 로 풀어 보여 줌) CARRIER 하나만 더함(다른 묶음이 짝을 더해도 지우지 않게) · 키 모양은 fn_integ_secret_set 의 마지막 갈래(영문 · 숫자 · _ - 16 ~ 128자) 그대로 */
DO $do$
DECLARE v_def text; v_pairs text; v_n integer;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'ck_integ_secret_name' AND conrelid = 'public.integration_secrets'::regclass;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'LSQ_MIGRATE: ck_integ_secret_name 검사가 없습니다 — 마이그레이션 순서를 확인하십시오.';
  END IF;
  IF position('CARRIER_TRACK_KEY' IN v_def) = 0 THEN
    SELECT count(*), string_agg(format('(%L,%L)', m[1], m[2]), ', ') INTO v_n, v_pairs
      FROM (SELECT DISTINCT m FROM regexp_matches(v_def, 'integration_code = ''([A-Z0-9_]+)''::text\) AND \(name = ''([A-Z0-9_]+)''::text', 'g') AS m) x;
    IF coalesce(v_n, 0) < 20 THEN
      RAISE EXCEPTION 'LSQ_MIGRATE: 연동 키 목록을 읽지 못했습니다 — 손으로 확인하십시오.';
    END IF;
    EXECUTE 'ALTER TABLE public.integration_secrets DROP CONSTRAINT ck_integ_secret_name, ADD CONSTRAINT ck_integ_secret_name CHECK ((integration_code, name) IN ('
            || v_pairs || ', (''CARRIER'',''CARRIER_TRACK_KEY'')))';
  END IF;
END $do$;

/* ── 설정(모두 처음 off · 방식 ASSUME) · 값 무늬 = 서버 lsq/common.ts LSQ_PATTERNS ─────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('lsq.bulk', 'off', 'ADMIN', '매물 CSV 일괄 등록(v10.602 · docs/744) — 처음 off · on 이면 나의공간 › 매물 일괄 등록에서 CSV 미리보기 → 확정 · 확정한 줄은 하나씩 기존 매물 등록(검수 큐 · 자동검수 · 금칙어 · 슬롯 한도 그대로)', false, '^(on|off)$', 'off'),
  ('lsq.bulk_max_rows', '50', 'ADMIN', 'CSV 한 번에 받는 줄 수(v10.602 · 10 ~ 200 · 처음 50)', false, '^([1-9][0-9]|1[0-9]{2}|200)$', '50'),
  ('lsq.review_ask', 'off', 'ADMIN', '성사 뒤 후기 요청(v10.603 · docs/745) — 처음 off · on 이면 매일 10:20 lsq_daily 가 성사 확정 뒤 lsq.review_ask_days 일 지난 거래의 당사자(후기를 안 쓴 사람)에게 회원 알림 한 번(회원이 끌 수 있음)', false, '^(on|off)$', 'off'),
  ('lsq.review_ask_days', '3', 'ADMIN', '후기 요청 — 성사 확정 뒤 며칠(v10.603 · 1 ~ 14 · 처음 3)', false, '^([1-9]|1[0-4])$', '3'),
  ('lsq.review_ask_again', '7', 'ADMIN', '후기 요청 — 처음 요청 뒤 며칠 지나 한 번 더(v10.603 · 0 ~ 30 · 처음 7 · 0 이면 다시 묻지 않음)', false, '^([0-9]|[12][0-9]|30)$', '7'),
  ('lsq.search_click', 'off', 'ADMIN', '검색 클릭 분석(v10.604 · docs/746) — 처음 off · on 이면 통합 검색 결과에서 누른 매물의 순위 · 정규화 낱말 · 관만 하루 묶음 수로 셈(회원 · 방문자 · IP · 쿠키 저장 없음 · DNT · GPC 면 받지 않음)', false, '^(on|off)$', 'off'),
  ('lsq.search_click_keep_days', '180', 'ADMIN', '검색 클릭 묶음 보관 일수(v10.604 · 30 ~ 730 · 처음 180)', false, '^([3-9][0-9]|[1-6][0-9]{2}|7[0-2][0-9]|730)$', '180'),
  ('lsq.region_pages', 'off', 'ADMIN', '지역별 소개 페이지(v10.605 · docs/747) — 처음 off · on 이면 사용자 웹 /area · /area/{시도} · /area/{시도}/{시군구} 와 사이트 지도에 지역 주소(게시 매물 lsq.region_min 개 이상 지역만)', false, '^(on|off)$', 'off'),
  ('lsq.region_min', '3', 'ADMIN', '지역 페이지 최소 게시 매물 수(v10.605 · 1 ~ 50 · 처음 3) — 이보다 적은 지역은 페이지 · 사이트 지도에 넣지 않음', false, '^([1-9]|[1-4][0-9]|50)$', '3'),
  ('lsq.sub_retry', 'off', 'ADMIN', '정기 배송 결제 실패 다시 시도(v10.606 · docs/748) — 처음 off · off 면 지금처럼 다음 날 다시 · on 이면 간격표(lsq.sub_retry_days)로 미루고 회원 알림 · 회원 「지금 다시 결제」', false, '^(on|off)$', 'off'),
  ('lsq.sub_retry_days', '1,3,5', 'ADMIN', '정기 배송 다시 시도 간격표(v10.606 · 실패 차례마다 며칠 뒤 · 1 ~ 14 · 다섯 칸까지 · 처음 1,3,5 — 칸보다 실패가 많으면 마지막 값)', false, '^([1-9]|1[0-4])(,([1-9]|1[0-4])){0,4}$', '1,3,5'),
  ('lsq.track', 'off', 'ADMIN', '배송 추적 연동(v10.607 · docs/749) — 처음 off · on 이면 매시간 lsq_track 이 배송중 주문 송장을 택배사 조회(방식 lsq.track_mode)로 묻고 단계를 쌓음', false, '^(on|off)$', 'off'),
  ('lsq.track_mode', 'ASSUME', 'ADMIN', '배송 추적 방식(v10.607) — ASSUME(처음 · 밖으로 부르지 않고 간주 단계) · LIVE(외부 연동 CARRIER 키 · 주소 틀 CARRIER_TRACK_BASE 가 있어야 · 없으면 NOT_READY)', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('lsq.track_auto_deliver', 'off', 'ADMIN', '택배사 「배송 완료」를 주문에 넣기(v10.607) — 처음 off · on 이면 기존 배송 기록(hlt_shipments DELIVERED)을 한 줄 더해 구매확정 · 반품 기한이 시작됨 · 간주(ASSUME) 결과로는 넣지 않음', false, '^(on|off)$', 'off'),
  ('lsq.return_photos', 'off', 'ADMIN', '반품 · 교환 사진 첨부(v10.608 · docs/750) — 처음 off · on 이면 회원 · 입점 판매자가 신청에 사진(RETURN_PHOTO)을 붙이고 판매자가 검수 판정을 적음 · 운영 판정 기록은 꺼져도 됨', false, '^(on|off)$', 'off'),
  ('lsq.return_photo_max', '5', 'ADMIN', '반품 사진 한쪽 최대 장수(v10.608 · 1 ~ 10 · 처음 5 · DB 는 10장까지 막음)', false, '^([1-9]|10)$', '5')
ON CONFLICT (key) DO NOTHING;

/* 정기 작업 두 개 */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('lsq_daily', 1440, 10, 20, NULL, true, '17차 매물 · 소개몰 하루 일 — 매일 10:20 · 후기 요청(lsq.review_ask on 일 때만) · 미리보기 지난 CSV 묶음 EXPIRED · 90일 지난 묶음 지움 · 보관 지난 검색 클릭 묶음 지움 · v10.602 ~ 604'),
  ('lsq_track', 60, NULL, NULL, NULL, true, '배송 추적 — 매시간 · lsq.track on 일 때만 · 배송중 주문 송장 200개까지 택배사 조회(ASSUME 은 간주) · 배송 완료 반영은 lsq.track_auto_deliver on · LIVE 일 때만 · v10.607')
ON CONFLICT (job) DO NOTHING;

/* 회원 알림 종류 · 글 — 모두 회원이 끌 수 있음 · 이름에 MARKETING · AD_ 없음 */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('LSQ_REVIEW_ASK', '거래 후기 요청', true, false, '성사 확정된 내 거래에 후기를 남겨 달라는 안내(v10.603 · 거래마다 두 번까지)', 'info'),
  ('LSQ_SUB_PAY_FAIL', '정기 배송 결제 실패', true, false, '내 정기 배송 결제가 실패해 다시 시도할 날을 알림(v10.606)', 'warn'),
  ('LSQ_RETURN_NOTE', '반품 · 교환 판정 안내', true, false, '내 반품 · 교환 신청에 판매자 · 운영이 검수 결과 · 메모를 남김(v10.608)', 'info')
ON CONFLICT (event_code) DO NOTHING;
INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('LSQ_REVIEW_ASK_INAPP', 'INAPP', '「{title}」 거래는 어떠셨나요?',
   '성사된 거래에 후기를 남겨 주시면 다른 회원이 믿고 거래하는 데 도움이 됩니다. 후기는 고칠 수 있지만 지워지지 않습니다.', '["title"]'::jsonb),
  ('LSQ_SUB_PAY_FAIL_INAPP', 'INAPP', '정기 배송 「{product}」 결제가 되지 않았습니다',
   E'다음 시도일: {next}\n카드를 바꾸셨다면 나의공간에서 「지금 다시 결제」를 누를 수 있습니다. 여러 번 실패하면 정기 배송이 멈춥니다.', '["product","next"]'::jsonb),
  ('LSQ_RETURN_NOTE_INAPP', 'INAPP', '{kind} 신청에 검수 결과가 적혔습니다',
   '주문 {orderNo} — 나의공간 › 취소 · 반품 내역에서 판정 기록과 사진을 확인해 주십시오.', '["kind","orderNo"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

/* ㊺ 기능 스위치 한눈에(opx_switch_docs · D275) — 켤 조건 */
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('lsq.bulk', 'off', '회원 안내(CSV 양식 · 검수 큐로 들어감) 게시 · 운영 미리보기로 양식 확인 뒤 — 처리방침 변경 없음(회원이 공개하려고 쓰는 매물 글)', 'docs/744'),
  ('lsq.review_ask', 'off', '후기 요청 알림 글 확인 · 회원이 끌 수 있음(알림 설정) 확인 뒤', 'docs/745'),
  ('lsq.search_click', 'off', '회원 · 방문자 식별 없음(날 × 낱말 × 순위 수만) 확인 · 처리방침 변경 없음 확인 뒤', 'docs/746'),
  ('lsq.region_pages', 'off', '대표가 지역 페이지 문구 · 최소 매물 수를 확인한 뒤(검색엔진에 지역 주소가 나감)', 'docs/747'),
  ('lsq.sub_retry', 'off', '정기 배송(mall.subscribe) 켤 때 · 회원 안내(실패 시 다시 시도 간격) 게시 뒤', 'docs/748'),
  ('lsq.track', 'off', '택배사 조회 대행 계약 · 연동 키 CARRIER_TRACK_KEY · 주소 틀 확인 뒤(그 전에는 ASSUME 으로만 시험)', 'docs/749'),
  ('lsq.track_auto_deliver', 'off', 'LIVE 조회 결과가 운영 「배송 완료」와 맞는지 2주 비교한 뒤(구매확정 · 반품 기한 시작점이 바뀜)', 'docs/749'),
  ('lsq.return_photos', 'off', '처리방침 1.2 게시 뒤(반품 사진 — 회원이 낸 자료 · 보관 기간) · 판매자 교육 뒤', 'docs/750')
ON CONFLICT (key) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 새 탭 7개(검수 admrev 4 · 소개몰 admhlt 3 · TAB_ROLES 따로 없음 = ADMIN · SUPER) · gen_seed.py 규칙(GET = VIEW · run · verdict = APPROVE · 그 밖 변경 = EDIT) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('lsq-bulk', '매물 일괄 등록', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 101),
  ('lsq-review-ask', '거래 후기 요청', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 102),
  ('lsq-search-click', '검색 클릭 분석', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 103),
  ('lsq-region', '지역별 소개 페이지', 'admrev', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 104),
  ('lsq-sub-retry', '정기 배송 결제 다시 시도', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3240),
  ('lsq-track', '배송 추적', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3250),
  ('lsq-return-ev', '반품 사진 · 판정', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3260)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'lsq-bulk', 'VIEW'), ('R_ADMIN', 'lsq-bulk', 'EDIT'), ('R_ADMIN', 'lsq-bulk', 'APPROVE'), ('R_ADMIN', 'lsq-bulk', 'EXPORT'),
  ('R_ADMIN', 'lsq-review-ask', 'VIEW'), ('R_ADMIN', 'lsq-review-ask', 'EDIT'), ('R_ADMIN', 'lsq-review-ask', 'APPROVE'), ('R_ADMIN', 'lsq-review-ask', 'EXPORT'),
  ('R_ADMIN', 'lsq-search-click', 'VIEW'), ('R_ADMIN', 'lsq-search-click', 'EDIT'), ('R_ADMIN', 'lsq-search-click', 'APPROVE'), ('R_ADMIN', 'lsq-search-click', 'EXPORT'),
  ('R_ADMIN', 'lsq-region', 'VIEW'), ('R_ADMIN', 'lsq-region', 'EDIT'), ('R_ADMIN', 'lsq-region', 'APPROVE'), ('R_ADMIN', 'lsq-region', 'EXPORT'),
  ('R_ADMIN', 'lsq-sub-retry', 'VIEW'), ('R_ADMIN', 'lsq-sub-retry', 'EDIT'), ('R_ADMIN', 'lsq-sub-retry', 'APPROVE'), ('R_ADMIN', 'lsq-sub-retry', 'EXPORT'),
  ('R_ADMIN', 'lsq-track', 'VIEW'), ('R_ADMIN', 'lsq-track', 'EDIT'), ('R_ADMIN', 'lsq-track', 'APPROVE'), ('R_ADMIN', 'lsq-track', 'EXPORT'),
  ('R_ADMIN', 'lsq-return-ev', 'VIEW'), ('R_ADMIN', 'lsq-return-ev', 'EDIT'), ('R_ADMIN', 'lsq-return-ev', 'APPROVE'), ('R_ADMIN', 'lsq-return-ev', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/lsq/bulk', 'lsq-bulk', 'VIEW'),
  ('GET', '/admin/lsq/review-asks', 'lsq-review-ask', 'VIEW'),
  ('POST', '/admin/lsq/daily/run', 'lsq-review-ask', 'APPROVE'),
  ('GET', '/admin/lsq/search-clicks', 'lsq-search-click', 'VIEW'),
  ('GET', '/admin/lsq/regions', 'lsq-region', 'VIEW'),
  ('GET', '/admin/lsq/sub-retry', 'lsq-sub-retry', 'VIEW'),
  ('POST', '/admin/lsq/sub-retry/{id}/run', 'lsq-sub-retry', 'APPROVE'),
  ('GET', '/admin/lsq/tracking', 'lsq-track', 'VIEW'),
  ('GET', '/admin/lsq/tracking/orders/{no}', 'lsq-track', 'VIEW'),
  ('POST', '/admin/lsq/tracking/run', 'lsq-track', 'APPROVE'),
  ('GET', '/admin/lsq/returns', 'lsq-return-ev', 'VIEW'),
  ('GET', '/admin/lsq/returns/{id}', 'lsq-return-ev', 'VIEW'),
  ('POST', '/admin/lsq/returns/{id}/verdicts', 'lsq-return-ev', 'APPROVE'),
  ('POST', '/admin/lsq/returns/{id}/photos/{pid}/hide', 'lsq-return-ev', 'EDIT'),
  ('PUT', '/admin/lsq/settings', 'lsq-bulk', 'EDIT'),
  ('PUT', '/admin/lsq/settings', 'lsq-review-ask', 'EDIT'),
  ('PUT', '/admin/lsq/settings', 'lsq-search-click', 'EDIT'),
  ('PUT', '/admin/lsq/settings', 'lsq-region', 'EDIT'),
  ('PUT', '/admin/lsq/settings', 'lsq-sub-retry', 'EDIT'),
  ('PUT', '/admin/lsq/settings', 'lsq-track', 'EDIT'),
  ('PUT', '/admin/lsq/settings', 'lsq-return-ev', 'EDIT')
ON CONFLICT DO NOTHING;
