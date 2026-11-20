/* D283 (v10.538 ~ 541 · docs/676 ~ 679) (53) 회원 · 소개몰 — 웹 푸시 알림 · 소개몰 재구매 알림 · 소개몰 공동구매 · 문자 마케팅
 *   대표 11/20 「지금 바로 동시 착수」(CONTRACT7) · 마이그레이션 #321 · 이 파일 다음에 2_rebuy → 3_groupbuy → 4_sms → 5_settings_jobs_perm_integ 를 차례로 이어 붙여 한 파일
 *   다시 돌려도 같음(IF NOT EXISTS · ON CONFLICT · DROP … IF EXISTS → ADD · 트리거는 pg_trigger 확인 뒤)
 *
 * ── ① 웹 푸시 알림(v10.538) ─────────────────────────────────────────────
 *   D272 서비스 워커(site/public/sw.js · site.pwa) 위에 Web Push(VAPID · RFC 8291 aes128gcm) — 키는 외부 연동 WEBPUSH(운영 화면 › 외부 연동 › 연동 키)
 *   회원이 브라우저마다 구독(mkx_push_subs) · 나의공간 › 웹 푸시에서 켜고 끔 · 회원 알림(notifications)이 생기면 정기 작업 mkx_push_send(1분)가 보냄
 *   push.enabled · push.send 처음 off · push.send_mode 처음 ASSUME(밖으로 부르지 않음) · 404 · 410 이면 구독을 GONE 으로(다시 보내지 않음)
 *   받는 주소는 알려진 푸시 서비스(FCM · Mozilla · Windows · Apple)만(CHECK = 서버 PUSH_ENDPOINT_RE · 다른 서버로 요청을 보내게 하지 않음)
 */

CREATE TABLE IF NOT EXISTS public.mkx_push_subs (
  id             bigserial PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  endpoint       text NOT NULL CHECK (char_length(endpoint) <= 1000
                   AND endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)/[!-~]+$'),   -- 반복 수 255 넘김 금지 → 길이는 char_length 로
  endpoint_hash  text NOT NULL CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),
  p256dh         text NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth           text NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  key_tag        text NOT NULL CHECK (key_tag ~ '^[A-Za-z0-9_-]{8}$'),
  ua_hint        text CHECK (ua_hint IS NULL OR char_length(ua_hint) <= 40),
  state          text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'OFF', 'GONE')),
  fail_count     integer NOT NULL DEFAULT 0 CHECK (fail_count BETWEEN 0 AND 100),
  gone_reason    text CHECK (gone_reason IS NULL OR gone_reason ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_ok_at     timestamptz,
  last_fail_at   timestamptz,
  CONSTRAINT uq_mkx_push_endpoint UNIQUE (endpoint_hash),
  CONSTRAINT ck_mkx_push_gone CHECK ((state = 'GONE') = (gone_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_mkx_push_subs_account ON public.mkx_push_subs (account_id) WHERE state = 'ACTIVE';
COMMENT ON TABLE public.mkx_push_subs IS 'v10.538 (D283) 웹 푸시 구독 — 브라우저(기기) 하나에 한 줄 · 받는 주소(알려진 푸시 서비스만) · 암호화 공개 키 p256dh · auth · 만든 때 VAPID 공개 키 끝 8자(key_tag — 키를 바꾸면 GONE) · 회원이 끄면 OFF · 404 · 410 · 실패 5번이면 GONE · 회원을 지우면 함께 지움';

CREATE TABLE IF NOT EXISTS public.mkx_push_sends (
  id               bigserial PRIMARY KEY,
  sub_id           bigint NOT NULL REFERENCES public.mkx_push_subs(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  notification_id  bigint REFERENCES public.notifications(id) ON DELETE CASCADE,
  test             boolean NOT NULL DEFAULT false,
  state            text NOT NULL CHECK (state IN ('SENT', 'ASSUMED', 'FAILED', 'GONE', 'SKIPPED')),
  reason           text CHECK (reason IS NULL OR reason ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  http_status      integer CHECK (http_status IS NULL OR http_status BETWEEN 0 AND 999),
  error            text CHECK (error IS NULL OR char_length(error) <= 200),
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_mkx_push_send_kind CHECK (test = (notification_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkx_push_send ON public.mkx_push_sends (sub_id, notification_id) WHERE notification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mkx_push_sends_account ON public.mkx_push_sends (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mkx_push_sends_created ON public.mkx_push_sends (created_at);
COMMENT ON TABLE public.mkx_push_sends IS 'v10.538 (D283) 웹 푸시 보낸 기록 — 알림 하나 × 구독 하나에 한 줄(다시 보내지 않음) · 시험 보내기(test · 알림 없음) · 받는 주소 · 글은 남기지 않음 · 30일 지나면 mkx_daily 가 지움';

/* 구독 지킴 — 회원 하나에 켜 둔 구독 10개까지 · 회원 · 받는 주소 지문은 바꾸지 않음(다른 회원이 같은 브라우저에서 켜면 서버가 줄을 지우고 새로 넣음) */
CREATE OR REPLACE FUNCTION public.fn_mkx_push_sub_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.account_id, NEW.endpoint_hash, NEW.created_at) IS DISTINCT FROM (OLD.account_id, OLD.endpoint_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'MKX_PUSH_FIXED: 웹 푸시 구독의 회원 · 받는 주소는 바꾸지 않습니다.';
  END IF;
  IF NEW.state = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD.state <> 'ACTIVE') THEN
    SELECT count(*) INTO v_n FROM public.mkx_push_subs WHERE account_id = NEW.account_id AND state = 'ACTIVE' AND id <> NEW.id;
    IF v_n >= 10 THEN
      RAISE EXCEPTION 'MKX_PUSH_MAX: 웹 푸시는 기기 10개까지 켤 수 있습니다 — 쓰지 않는 기기를 끄십시오.';
    END IF;
  END IF;
  IF NEW.state <> 'GONE' THEN NEW.gone_reason := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkx_push_sub_guard' AND tgrelid = 'public.mkx_push_subs'::regclass) THEN
    CREATE TRIGGER trg_mkx_push_sub_guard BEFORE INSERT OR UPDATE ON public.mkx_push_subs FOR EACH ROW EXECUTE FUNCTION public.fn_mkx_push_sub_guard();
  END IF;
END $$;

/* 보낸 기록은 고치지 않음(지우기는 30일 정리 · 회원 지움만) */
CREATE OR REPLACE FUNCTION public.fn_mkx_push_send_ro() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MKX_PUSH_SEND_RO: 웹 푸시 보낸 기록은 고치지 않습니다.';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkx_push_send_ro' AND tgrelid = 'public.mkx_push_sends'::regclass) THEN
    CREATE TRIGGER trg_mkx_push_send_ro BEFORE UPDATE ON public.mkx_push_sends FOR EACH ROW EXECUTE FUNCTION public.fn_mkx_push_send_ro();
  END IF;
END $$;


/* ── ② 소개몰 재구매 알림(v10.539) ─────────────────────────────────────────
 *   상품마다 사용 일수(mkx_rebuy_rules · 개월 옵션이 있으면 개월 × 30일) × 수량 — 산 날(결제일 · 한국) + 일수 − 며칠 전 = 알릴 날
 *   정기 작업 mkx_daily(매일 10:05)가 알릴 날이 된 줄을 회원 알림 MARKETING_MALL_REBUY 로 한 번(광고 — 마케팅 수신 동의자만 · 21 ~ 8시에는 안 함)
 *   품목 하나에 한 번(mkx_rebuy_sends · order_item_id 고유) · 같은 상품을 그 뒤에 또 산 회원 · 판매 중 아님 · 동의 없음은 SKIPPED(까닭)
 *   회원 하루 한 통 · 하루 전체 상한 mkx.rebuy_daily_max · mkx.rebuy 처음 off
 *   ★ 알림 종류 이름에 MARKETING 을 넣어 광고 감시 보기(v_marketing_no_consent · v_marketing_night_violation)가 늘 지켜봄(0 이어야)
 */

CREATE TABLE IF NOT EXISTS public.mkx_rebuy_rules (
  product_id   uuid PRIMARY KEY REFERENCES public.hlt_products(id) ON DELETE CASCADE,
  use_days     integer NOT NULL CHECK (use_days BETWEEN 7 AND 730),
  before_days  integer NOT NULL DEFAULT 7 CHECK (before_days BETWEEN 0 AND 60),
  is_active    boolean NOT NULL DEFAULT true,
  memo         text CHECK (memo IS NULL OR char_length(memo) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.accounts(id),
  CONSTRAINT ck_mkx_rebuy_before CHECK (before_days < use_days)
);
COMMENT ON TABLE public.mkx_rebuy_rules IS 'v10.539 (D283) 소개몰 재구매 알림 규칙 — 상품마다 사용 일수(개월 옵션이 있으면 개월 × 30일이 먼저) · 며칠 전에 알릴지 · 끄기(is_active) · 운영 화면 소개몰 › 재구매 알림';

/* 알릴 날 보기 — 결제한 주문(취소 · 반품 · 결제 전 빼고)의 품목 × 켠 규칙 · 날짜는 한국 */
CREATE OR REPLACE VIEW public.v_mkx_rebuy_due AS
 SELECT i.id AS order_item_id, o.id AS order_id, o.account_id, i.product_id, o.paid_at,
        x.days, (o.paid_at AT TIME ZONE 'Asia/Seoul')::date + x.days AS due_on,
        (o.paid_at AT TIME ZONE 'Asia/Seoul')::date + x.days - r.before_days AS notify_on
   FROM public.hlt_order_items i
   JOIN public.hlt_orders o ON o.id = i.order_id
   JOIN public.mkx_rebuy_rules r ON r.product_id = i.product_id AND r.is_active
   CROSS JOIN LATERAL (SELECT (CASE WHEN i.months IS NOT NULL AND i.months > 0 THEN i.months * 30 ELSE r.use_days END) * i.qty AS days) x
  WHERE o.paid_at IS NOT NULL AND o.status NOT IN ('PENDING', 'CANCELED', 'RETURNED');
COMMENT ON VIEW public.v_mkx_rebuy_due IS 'v10.539 (D283) 재구매 알릴 날 — 품목마다 사용 일수 × 수량 · 산 날(결제일 · 한국) + 일수 = 다 쓰는 날 · − 며칠 전 = 알릴 날 · 문자 캠페인 대상 MALL_REBUY 도 이 보기를 씀';

CREATE TABLE IF NOT EXISTS public.mkx_rebuy_sends (
  id               bigserial PRIMARY KEY,
  order_item_id    uuid NOT NULL REFERENCES public.hlt_order_items(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES public.hlt_products(id) ON DELETE CASCADE,
  due_on           date NOT NULL,
  notify_on        date NOT NULL,
  state            text NOT NULL CHECK (state IN ('SENT', 'SKIPPED')),
  reason           text CHECK (reason IS NULL OR reason IN ('NO_CONSENT', 'REBOUGHT', 'NOT_ON_SALE', 'INACTIVE', 'TOO_LATE', 'OPTED_OUT')),
  notification_id  bigint REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_mkx_rebuy_item UNIQUE (order_item_id),
  CONSTRAINT ck_mkx_rebuy_reason CHECK ((state = 'SKIPPED') = (reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_mkx_rebuy_sends_account ON public.mkx_rebuy_sends (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mkx_rebuy_sends_created ON public.mkx_rebuy_sends (created_at DESC);
COMMENT ON TABLE public.mkx_rebuy_sends IS 'v10.539 (D283) 재구매 알림 기록 — 품목 하나에 한 줄(다시 보내지 않음) · 보냄(SENT · 회원 알림 번호) · 건너뜀(SKIPPED · 동의 없음 · 다시 삼 · 판매 중 아님 · 쓰지 않는 계정 · 너무 늦음 · 알림 끔) · 쌓기만';

/* 기록은 쌓기만 — 회원 · 품목 · 회원 알림을 지울 때 따라오는 지움(ON DELETE CASCADE · SET NULL)만 통과(pg_trigger_depth 2 이상 = 외래 키 동작) */
CREATE OR REPLACE FUNCTION public.fn_mkx_rebuy_send_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MKX_REBUY_RO: 재구매 알림 기록은 지우지 않습니다.'; END IF;
  RAISE EXCEPTION 'MKX_REBUY_RO: 재구매 알림 기록은 고치지 않습니다.';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkx_rebuy_send_guard' AND tgrelid = 'public.mkx_rebuy_sends'::regclass) THEN
    CREATE TRIGGER trg_mkx_rebuy_send_guard BEFORE UPDATE OR DELETE ON public.mkx_rebuy_sends FOR EACH ROW EXECUTE FUNCTION public.fn_mkx_rebuy_send_guard();
  END IF;
END $$;

/* 회원 알림 — 광고(마케팅 동의자만 · 끌 수 있음 · 야간 아님) */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('MARKETING_MALL_REBUY', '소개몰 재구매 안내(광고)', true, false, '광고성 정보 — 마케팅 수신 동의자에게만 · 산 상품을 다 쓸 때쯤 한 번(정보통신망법 제50조)', 'info')
ON CONFLICT (event_code) DO NOTHING;

INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('MARKETING_MALL_REBUY_INAPP', 'INAPP', '(광고) 다시 주문할 때예요 — {product}',
   '{date}에 사신 「{product}」을(를) {days}일쯤 쓰셨습니다. 다 떨어지기 전에 다시 주문하시려면 눌러 주십시오. 이 안내는 광고성 정보 수신에 동의하신 분께만 드리며, 알림 설정에서 끄거나 약관 동의에서 철회할 수 있습니다.',
   '["product","date","days"]'::jsonb)
ON CONFLICT (code) DO NOTHING;


/* ── ③ 소개몰 공동구매(v10.540) ─────────────────────────────────────────
 *   직판 상품 옵션 하나 · 목표 인원 · 기한 · 할인가(그 옵션 값보다 낮게) — 회원이 참여하면 할인가로 보통 주문이 하나 생기고 보통 결제 흐름으로 결제
 *   결제를 마친 참여자(사람 수)가 목표에 닿으면 바로 확정(SUCCESS · 그때부터 발송) · 기한까지 못 모이면 실패(FAILED) → 참여 주문마다 기존 취소 신청(hlt_returns CANCEL)을 넣고
 *   환불은 기존 환불 흐름(소개몰 › 주문 · 취소 처리에서 승인 → 환불) · 확정 전에는 발송하지 않음(hlt_orders 트리거가 막음)
 *   mkx.groupbuy 처음 off(회원 화면 · 참여 · 열기) · 정기 작업 mkx_groupbuy(10분) · 법무 확인 끝(11/20 대표 · 이상 없음 · docs/678 6절)
 */

CREATE TABLE IF NOT EXISTS public.mkx_groupbuys (
  id              bigserial PRIMARY KEY,
  product_id      uuid NOT NULL REFERENCES public.hlt_products(id),
  option_id       uuid NOT NULL REFERENCES public.hlt_product_options(id),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 80),
  list_price      bigint NOT NULL CHECK (list_price > 0),
  deal_price      bigint NOT NULL CHECK (deal_price > 0),
  target_count    integer NOT NULL CHECK (target_count BETWEEN 2 AND 10000),
  max_count       integer CHECK (max_count IS NULL OR max_count BETWEEN 2 AND 100000),
  per_member_max  integer NOT NULL DEFAULT 1 CHECK (per_member_max BETWEEN 1 AND 10),
  ends_at         timestamptz NOT NULL,
  state           text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'OPEN', 'SUCCESS', 'FAILED', 'CANCELED', 'CLOSED')),
  opened_at       timestamptz,
  success_at      timestamptz,
  closed_at       timestamptz,
  cancel_reason   text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 2 AND 200),
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mkx_gb_price CHECK (deal_price < list_price),
  CONSTRAINT ck_mkx_gb_max CHECK (max_count IS NULL OR max_count >= target_count),
  CONSTRAINT ck_mkx_gb_cancel CHECK ((state = 'CANCELED') = (cancel_reason IS NOT NULL)),
  CONSTRAINT ck_mkx_gb_opened CHECK (state IN ('DRAFT', 'CANCELED') OR opened_at IS NOT NULL),
  CONSTRAINT ck_mkx_gb_success CHECK ((state IN ('SUCCESS', 'CLOSED')) = (success_at IS NOT NULL) OR (state = 'CANCELED')),
  CONSTRAINT ck_mkx_gb_closed CHECK ((state IN ('FAILED', 'CANCELED', 'CLOSED')) = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkx_gb_option_open ON public.mkx_groupbuys (option_id) WHERE state IN ('OPEN', 'SUCCESS');
CREATE INDEX IF NOT EXISTS ix_mkx_gb_state ON public.mkx_groupbuys (state, ends_at);
COMMENT ON TABLE public.mkx_groupbuys IS 'v10.540 (D283) 소개몰 공동구매 — 직판 상품 옵션 하나 · 정가(열 때 옵션 값) · 할인가 · 목표 인원(결제를 마친 사람 수) · 최대 인원 · 한 사람 수량 상한 · 기한 · 초안 → 모집(OPEN) → 확정(SUCCESS) → 마감(CLOSED) / 실패(FAILED) / 취소(CANCELED) · 같은 옵션은 한 번에 하나만 모집';

CREATE TABLE IF NOT EXISTS public.mkx_gb_joins (
  id               bigserial PRIMARY KEY,
  groupbuy_id      bigint NOT NULL REFERENCES public.mkx_groupbuys(id),
  account_id       uuid NOT NULL REFERENCES public.accounts(id),
  order_id         uuid NOT NULL REFERENCES public.hlt_orders(id),
  qty              integer NOT NULL CHECK (qty BETWEEN 1 AND 10),
  cancel_return_id uuid REFERENCES public.hlt_returns(id),
  failed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mkx_gb_join_member UNIQUE (groupbuy_id, account_id),
  CONSTRAINT uq_mkx_gb_join_order UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS ix_mkx_gb_joins_account ON public.mkx_gb_joins (account_id, created_at DESC);
COMMENT ON TABLE public.mkx_gb_joins IS 'v10.540 (D283) 공동구매 참여 — 회원 하나에 한 번(주문을 취소해도 다시 참여하지 않음) · 할인가 주문 하나 · 실패 · 취소 때 넣은 취소 신청 번호(cancel_return_id) · 결제 · 취소 상태는 주문(hlt_orders)이 정본';

/* 결제를 마친 참여자 수(사람) — 주문이 결제됐고 취소 · 반품이 아닌 것 */
CREATE OR REPLACE FUNCTION public.fn_mkx_gb_paid(p_gb bigint) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.mkx_gb_joins j JOIN public.hlt_orders o ON o.id = j.order_id
   WHERE j.groupbuy_id = p_gb AND o.paid_at IS NOT NULL AND o.status NOT IN ('CANCELED', 'RETURNED');
$$;
/* 자리를 차지한 참여자 수 — 결제 전 주문도 셈(최대 인원 판단) */
CREATE OR REPLACE FUNCTION public.fn_mkx_gb_taken(p_gb bigint) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.mkx_gb_joins j JOIN public.hlt_orders o ON o.id = j.order_id
   WHERE j.groupbuy_id = p_gb AND o.status NOT IN ('CANCELED', 'RETURNED');
$$;

/* 공동구매 지킴 — 상태는 앞으로만 · 초안 뒤에는 상품 · 값 · 인원을 못 바꿈(기한은 모집 중 늘리기만) · 열 때 직판 · 판매 중 · 켠 옵션 · 할인가 < 지금 옵션 값 · 기한 1시간 ~ 60일 */
CREATE OR REPLACE FUNCTION public.fn_mkx_gb_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ok boolean; v_price bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN RAISE EXCEPTION 'MKX_GB_STATE: 연 공동구매는 지우지 않습니다(취소로).'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' THEN RAISE EXCEPTION 'MKX_GB_STATE: 공동구매는 초안으로 만듭니다.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.hlt_product_options o WHERE o.id = NEW.option_id AND o.product_id = NEW.product_id) THEN
      RAISE EXCEPTION 'MKX_GB_OPTION: 옵션과 상품이 맞지 않습니다.';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'DRAFT' AND NEW.state IN ('OPEN', 'CANCELED'))
    OR (OLD.state = 'OPEN' AND NEW.state IN ('SUCCESS', 'FAILED', 'CANCELED'))
    OR (OLD.state = 'SUCCESS' AND NEW.state IN ('CLOSED', 'CANCELED'))) THEN
    RAISE EXCEPTION 'MKX_GB_STATE: 공동구매 상태를 그렇게 바꿀 수 없습니다.';
  END IF;
  IF OLD.state <> 'DRAFT' AND (NEW.product_id, NEW.option_id, NEW.list_price, NEW.deal_price, NEW.target_count, NEW.max_count, NEW.per_member_max)
       IS DISTINCT FROM (OLD.product_id, OLD.option_id, OLD.list_price, OLD.deal_price, OLD.target_count, OLD.max_count, OLD.per_member_max) THEN
    RAISE EXCEPTION 'MKX_GB_FIXED: 연 공동구매는 상품 · 값 · 인원을 바꾸지 않습니다(취소하고 새로).';
  END IF;
  IF OLD.state IN ('FAILED', 'CANCELED', 'CLOSED') AND (NEW.title, NEW.ends_at) IS DISTINCT FROM (OLD.title, OLD.ends_at) THEN
    RAISE EXCEPTION 'MKX_GB_STATE: 끝난 공동구매는 고치지 않습니다.';
  END IF;
  IF OLD.state IN ('OPEN', 'SUCCESS') AND NEW.ends_at < OLD.ends_at THEN
    RAISE EXCEPTION 'MKX_GB_ENDS: 모집 중에는 기한을 앞당기지 않습니다(늘리기만).';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state = 'OPEN' THEN
    SELECT (p.status = 'ON_SALE' AND s.type = 'DIRECT' AND o.is_active AND o.product_id = p.id), o.price INTO v_ok, v_price
      FROM public.hlt_product_options o JOIN public.hlt_products p ON p.id = NEW.product_id JOIN public.hlt_sellers s ON s.id = p.seller_id
     WHERE o.id = NEW.option_id;
    IF NOT coalesce(v_ok, false) THEN RAISE EXCEPTION 'MKX_GB_PRODUCT: 공동구매는 판매 중인 직판 상품의 켠 옵션만 엽니다.'; END IF;
    IF NEW.deal_price >= v_price THEN RAISE EXCEPTION 'MKX_GB_PRICE: 할인가는 지금 옵션 값보다 낮아야 합니다.'; END IF;
    IF NEW.ends_at < now() + interval '1 hour' OR NEW.ends_at > now() + interval '60 days' THEN
      RAISE EXCEPTION 'MKX_GB_ENDS: 기한은 지금부터 1시간 ~ 60일 안입니다.';
    END IF;
    NEW.list_price := v_price;
    NEW.opened_at := coalesce(NEW.opened_at, now());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkx_gb_guard' AND tgrelid = 'public.mkx_groupbuys'::regclass) THEN
    CREATE TRIGGER trg_mkx_gb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mkx_groupbuys FOR EACH ROW EXECUTE FUNCTION public.fn_mkx_gb_guard();
  END IF;
END $$;

/* 참여 지킴 — 모집 중(확정 뒤도 기한 · 최대 인원 안이면 받음) · 수량 상한 · 주문은 같은 회원 · 그 옵션 한 줄 · 할인가 그대로 · 회원 · 주문은 바꾸지 않음 */
CREATE OR REPLACE FUNCTION public.fn_mkx_gb_join_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g record; v_n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'MKX_GB_JOIN_RO: 공동구매 참여 기록은 지우지 않습니다.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.groupbuy_id, NEW.account_id, NEW.order_id, NEW.qty, NEW.created_at) IS DISTINCT FROM (OLD.groupbuy_id, OLD.account_id, OLD.order_id, OLD.qty, OLD.created_at) THEN
      RAISE EXCEPTION 'MKX_GB_JOIN_RO: 공동구매 참여의 회원 · 주문 · 수량은 바꾸지 않습니다.';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO g FROM public.mkx_groupbuys WHERE id = NEW.groupbuy_id FOR UPDATE;
  IF g.id IS NULL OR g.state NOT IN ('OPEN', 'SUCCESS') OR g.ends_at <= now() THEN
    RAISE EXCEPTION 'MKX_GB_CLOSED: 모집 중인 공동구매가 아닙니다.';
  END IF;
  IF NEW.qty > g.per_member_max THEN RAISE EXCEPTION 'MKX_GB_QTY: 한 분이 살 수 있는 수량을 넘었습니다.'; END IF;
  IF g.max_count IS NOT NULL THEN
    v_n := public.fn_mkx_gb_taken(g.id);
    IF v_n >= g.max_count THEN RAISE EXCEPTION 'MKX_GB_FULL: 공동구매 자리가 다 찼습니다.'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hlt_orders o WHERE o.id = NEW.order_id AND o.account_id = NEW.account_id AND o.status = 'PENDING') THEN
    RAISE EXCEPTION 'MKX_GB_ORDER: 참여 주문이 맞지 않습니다.';
  END IF;
  IF (SELECT count(*) FROM public.hlt_order_items i WHERE i.order_id = NEW.order_id) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.hlt_order_items i WHERE i.order_id = NEW.order_id AND i.option_id = g.option_id AND i.unit_price = g.deal_price AND i.qty = NEW.qty) THEN
    RAISE EXCEPTION 'MKX_GB_ORDER: 참여 주문은 공동구매 옵션 한 줄 · 할인가여야 합니다.';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkx_gb_join_guard' AND tgrelid = 'public.mkx_gb_joins'::regclass) THEN
    CREATE TRIGGER trg_mkx_gb_join_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mkx_gb_joins FOR EACH ROW EXECUTE FUNCTION public.fn_mkx_gb_join_guard();
  END IF;
END $$;

/* 발송 막기 — 모집 중 · 실패 · 취소한 공동구매의 참여 주문은 상품 준비 · 발송 · 배송 완료로 넘기지 않음(확정 · 마감 뒤에만) */
CREATE OR REPLACE FUNCTION public.fn_mkx_gb_ship_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('PREPARING', 'SHIPPED', 'DELIVERED')
     AND EXISTS (SELECT 1 FROM public.mkx_gb_joins j JOIN public.mkx_groupbuys g ON g.id = j.groupbuy_id
                  WHERE j.order_id = NEW.id AND g.state IN ('OPEN', 'FAILED', 'CANCELED')) THEN
    RAISE EXCEPTION 'MKX_GB_HOLD: 공동구매가 확정되기 전(또는 실패 · 취소)이라 이 주문은 발송하지 않습니다.';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkx_gb_ship_hold' AND tgrelid = 'public.hlt_orders'::regclass) THEN
    CREATE TRIGGER trg_mkx_gb_ship_hold BEFORE UPDATE OF status ON public.hlt_orders FOR EACH ROW EXECUTE FUNCTION public.fn_mkx_gb_ship_hold();
  END IF;
END $$;

/* 회원 알림 — 참여 결과(거래 안내 · 끌 수 없음) */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('MALL_GB_SUCCESS', '소개몰 공동구매 확정', false, false, '거래 안내 — 참여하신 공동구매가 모여 발송을 시작함', 'ok'),
  ('MALL_GB_FAILED', '소개몰 공동구매 취소', false, false, '거래 안내 — 공동구매가 모이지 않았거나 취소되어 주문을 취소 · 환불함', 'warn')
ON CONFLICT (event_code) DO NOTHING;

INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('MALL_GB_SUCCESS_INAPP', 'INAPP', '공동구매가 확정되었습니다 — {title}',
   '참여하신 공동구매 「{title}」이(가) 목표 인원을 채워 확정되었습니다. 주문 {orderNo}을(를) 차례로 보내 드립니다.', '["title","orderNo"]'::jsonb),
  ('MALL_GB_FAILED_INAPP', 'INAPP', '공동구매가 취소되었습니다 — {title}',
   '공동구매 「{title}」이(가) {why} 주문 {orderNo}을(를) 취소합니다. 결제하셨다면 결제 금액 전액을 기존 환불 절차로 돌려 드립니다(따로 신청하지 않으셔도 됩니다).', '["title","orderNo","why"]'::jsonb)
ON CONFLICT (code) DO NOTHING;


/* ── ④ 문자 마케팅(v10.541) — ㊳ 문자 · 메일 캠페인(D268) 위에 ────────────────────
 *   ㊳ 가 이미 지키는 것은 그대로 씀: 「(광고)이름」 앞머리 · 「무료거부 080…」 끝 · 마케팅 수신 동의자만 · 21 ~ 8시 야간 동의자만(DB 트리거) · 문자 대행 어댑터(CampaignSmsHttp) · 간주(campaign.send_mode ASSUME) · campaign.enabled 처음 off
 *   여기서 더하는 것
 *     ㉠ 소개몰 대상 2가지 — MALL_BUYERS(180일 안 결제한 회원) · MALL_REBUY(재구매 알릴 날이 7일 전 ~ 30일 뒤) · 마케팅 동의 JOIN 은 ㊳ 그대로
 *        (★ 6차 ㊿ b280 이 같은 CHECK 를 CHURN_RISK 로 다시 만듦 — 이 판은 그 위에 MALL_ 둘을 더한 목록 · b280 이 없어도 CHURN_RISK 줄은 해 없음)
 *     ㉡ 회원별 광고 문자 상한 — 7일에 mkx.sms_weekly_max 통(처음 2 · 0 = 상한 없음) · 받는 사람을 고정할 때 넘는 회원은 SKIPPED(FREQ_CAP)로 넣음(보내지 않음)
 *     ㉢ 080 수신 거부 반영 — 080 대행사가 준 거부 번호(운영 화면 붙여 넣기 · 대행사 웹훅 mkx.optout080_hook 처음 off)로 그 번호 회원의 마케팅 · 야간 광고 동의 철회
 *        번호는 지문(sha256) · 끝 4자리만 남김 · 철회는 ㊳ 수신 거부와 같은 길(약관 동의 기록에 「거부」 한 줄 · 대기 줄 멈춤 · 처리 결과 알림 CONSENT_OPTOUT)
 */

ALTER TABLE public.mkt_campaigns DROP CONSTRAINT IF EXISTS mkt_campaigns_audience_check;
ALTER TABLE public.mkt_campaigns ADD CONSTRAINT mkt_campaigns_audience_check CHECK (audience IN ('ALL', 'RECENT_90', 'CHURN_RISK', 'MALL_BUYERS', 'MALL_REBUY'));

ALTER TABLE public.mkt_campaign_sends DROP CONSTRAINT IF EXISTS mkt_campaign_sends_skip_reason_check;
ALTER TABLE public.mkt_campaign_sends ADD CONSTRAINT mkt_campaign_sends_skip_reason_check
  CHECK (skip_reason IS NULL OR skip_reason IN ('NO_CONSENT', 'INACTIVE', 'NO_ADDRESS', 'SUPPRESSED', 'CANCELED', 'UNSUBSCRIBED', 'FREQ_CAP'));

/* ㉡ 광고 문자 상한 — 받는 사람 줄을 넣을 때(㊳ trg_mkt_send_guard 다음 차례 · 이름 순) 7일 안 다른 문자 캠페인 줄(대기 · 보냄 · 간주)이 상한 이상이면 SKIPPED */
CREATE OR REPLACE FUNCTION public.fn_mkx_sms_freq_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max integer; v_n integer;
BEGIN
  IF NEW.test OR NEW.state <> 'QUEUED' THEN RETURN NEW; END IF;
  IF (SELECT channel FROM public.mkt_campaigns WHERE id = NEW.campaign_id) IS DISTINCT FROM 'SMS' THEN RETURN NEW; END IF;
  SELECT CASE WHEN value ~ '^[0-9]{1,2}$' THEN value::integer ELSE 2 END INTO v_max FROM public.site_settings WHERE key = 'mkx.sms_weekly_max';
  v_max := coalesce(v_max, 2);
  IF v_max <= 0 THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n
    FROM public.mkt_campaign_sends s JOIN public.mkt_campaigns c ON c.id = s.campaign_id
   WHERE s.account_id = NEW.account_id AND NOT s.test AND c.channel = 'SMS' AND s.campaign_id <> NEW.campaign_id
     AND s.state IN ('QUEUED', 'SENT', 'ASSUMED') AND s.created_at > now() - interval '7 days';
  IF v_n >= v_max THEN
    NEW.state := 'SKIPPED';
    NEW.skip_reason := 'FREQ_CAP';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkx_sms_freq_cap' AND tgrelid = 'public.mkt_campaign_sends'::regclass) THEN
    CREATE TRIGGER trg_mkx_sms_freq_cap BEFORE INSERT ON public.mkt_campaign_sends FOR EACH ROW EXECUTE FUNCTION public.fn_mkx_sms_freq_cap();
  END IF;
END $$;

/* ㉢ 080 수신 거부 반영 기록 — 번호 원문은 남기지 않음 */
CREATE TABLE IF NOT EXISTS public.mkx_optout080 (
  id           bigserial PRIMARY KEY,
  phone_hash   text NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  phone_last4  text NOT NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  source       text NOT NULL CHECK (source IN ('PASTE', 'HOOK')),
  accounts     integer NOT NULL DEFAULT 0 CHECK (accounts >= 0),
  withdrew     integer NOT NULL DEFAULT 0 CHECK (withdrew >= 0),
  stopped      integer NOT NULL DEFAULT 0 CHECK (stopped >= 0),
  created_by   uuid,   -- 운영자(외래 키 없음 — 쌓기만 표라 계정 정리를 막지 않게)
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_mkx_optout080_created ON public.mkx_optout080 (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mkx_optout080_hash ON public.mkx_optout080 (phone_hash);
COMMENT ON TABLE public.mkx_optout080 IS 'v10.541 (D283) 080 수신 거부 반영 기록 — 번호 지문(sha256) · 끝 4자리 · 붙여 넣기 / 대행사 웹훅 · 찾은 회원 수 · 철회한 동의 수 · 멈춘 대기 문자 수 · 쌓기만';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mkx_optout080_ro' AND tgrelid = 'public.mkx_optout080'::regclass) THEN
    CREATE TRIGGER trg_mkx_optout080_ro BEFORE UPDATE OR DELETE ON public.mkx_optout080 FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;


/* ── ⑤ 설정 · 정기 작업 · 외부 연동 18번째(WEBPUSH) · ㉕ 권한(D258) 시드 ──────────────────
 *   스위치 · 외부 호출 · 보내기는 모두 처음 off(규칙 9) · 방식은 ASSUME · 값 무늬(value_pattern) = 서버가 쓰는 범위(mkx/common.ts 의 clamp 끝값과 같음) */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('push.enabled', 'off', 'ADMIN', '웹 푸시 구독 받기(v10.538 · D283) — 처음 off · on 이면 나의공간 › 웹 푸시에서 회원이 브라우저마다 켬(앱처럼 설치 site.pwa 가 켜져 서비스 워커가 있어야 함) · off 면 새 구독을 받지 않음(있는 구독은 그대로)', false, '^(on|off)$', 'off'),
  ('push.send', 'off', 'ADMIN', '웹 푸시 보내기(v10.538) — 처음 off · on 이면 1분마다 정기 작업 mkx_push_send 가 새 회원 알림을 켠 기기로 보냄(12시간 안 · 읽지 않은 것만 · 알림 하나에 기기마다 한 번)', false, '^(on|off)$', 'off'),
  ('push.send_mode', 'ASSUME', 'ADMIN', '웹 푸시 방식(v10.538) — ASSUME 은 밖으로 부르지 않고 「간주」로만 기록(점검판) · LIVE 는 외부 연동 WEBPUSH 키(VAPID 공개 · 비밀) · push.vapid_subject 가 있어야 함', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('push.vapid_subject', '', 'ADMIN', '웹 푸시 보낸 곳 연락처(v10.538 · VAPID sub) — mailto:주소 또는 https 주소 · 푸시 서비스(구글 · 모질라 · 애플)가 문제 때 연락하는 곳 · 비면 LIVE 로 보내지 않음', false, '^$|^(mailto:[^\s@]+@[^\s@]+|https://\S+)$', 'mailto:help@sogaebank.com'),
  ('push.daily_max', '20', 'ADMIN', '웹 푸시 회원 하루 상한(v10.538 · 1 ~ 100 · 처음 20) — 넘는 알림은 보내지 않음(SKIPPED DAILY_MAX · 나의공간 알림에는 그대로 있음)', false, '^([1-9]|[1-9][0-9]|100)$', '20'),
  ('push.quiet', 'on', 'ADMIN', '웹 푸시 밤 쉬기(v10.538) — on(처음)이면 21:00 ~ 08:00(한국)에는 급한 알림(알림 종류 정책 quiet_hours_exempt)만 보냄 · 나머지는 아침에(12시간 안이면)', false, '^(on|off)$', 'on'),
  ('mkx.rebuy', 'off', 'ADMIN', '소개몰 재구매 알림(v10.539 · D283) — 처음 off · on 이면 매일 10:05 정기 작업 mkx_daily 가 알릴 날이 된 품목을 회원 알림(광고 · 마케팅 수신 동의자만)으로 한 번 · 21 ~ 8시에는 돌리지 않음', false, '^(on|off)$', 'off'),
  ('mkx.rebuy_daily_max', '300', 'ADMIN', '재구매 알림 하루 전체 상한(v10.539 · 1 ~ 5000 · 처음 300) — 넘는 줄은 다음 날(회원 하나에 하루 한 통)', false, '^([1-9]|[1-9][0-9]{1,2}|[1-4][0-9]{3}|5000)$', '300'),
  ('mkx.rebuy_late_days', '7', 'ADMIN', '재구매 알림 늦게 보내기 한도(v10.539 · 0 ~ 30일 · 처음 7) — 알릴 날에서 이만큼 지난 줄은 보내지 않음(TOO_LATE · 켜기 전 옛 주문이 한꺼번에 나가지 않게)', false, '^([0-9]|[12][0-9]|30)$', '7'),
  ('mkx.groupbuy', 'off', 'ADMIN', '소개몰 공동구매(v10.540 · D283) — 처음 off · on 이면 운영 화면에서 공동구매를 열고 회원 화면 /health/groupbuys 에서 참여(주문 받기 mall.order_open 도 켜져야 함) · off 여도 이미 연 공동구매의 확정 · 실패 처리는 계속', false, '^(on|off)$', 'off'),
  ('mkx.sms_weekly_max', '2', 'ADMIN', '광고 문자 회원별 7일 상한(v10.541 · D283 · 0 ~ 14 · 처음 2 · 0 = 상한 없음) — 문자 캠페인 받는 사람을 고정할 때 7일 안 다른 문자 캠페인을 이만큼 받은 회원은 빼고(SKIPPED FREQ_CAP) 보내지 않음', false, '^([0-9]|1[0-4])$', '2'),
  ('mkx.sms_price_sms', '0', 'ADMIN', '문자 단가 — 단문 SMS(원 · 0 ~ 1000 · v10.541) — 문자 대행사 계약 단가를 넣으면 운영 화면이 캠페인 예상 비용을 셈(0 = 모름)', false, '^([0-9]|[1-9][0-9]{1,2}|1000)$', '0'),
  ('mkx.sms_price_lms', '0', 'ADMIN', '문자 단가 — 장문 LMS(원 · 0 ~ 1000 · v10.541 · 90바이트 넘는 글) — 0 = 모름', false, '^([0-9]|[1-9][0-9]{1,2}|1000)$', '0'),
  ('mkx.optout080_hook', 'off', 'ADMIN', '080 수신 거부 웹훅 받기(v10.541) — 처음 off · on 이면 080 대행사가 POST /site/optout080 (머리글 X-Optout-Token)으로 보낸 거부 번호를 받아 그 회원의 마케팅 · 야간 광고 동의를 철회 · 붙여 넣기(운영 화면)는 꺼져도 됨', false, '^(on|off)$', 'off'),
  ('mkx.optout080_token_hash', '', 'PRIVATE', '080 수신 거부 웹훅 토큰 지문(v10.541) — 운영 화면 › 회원 › 문자 마케팅 › 「웹훅 토큰 새로 만들기」(SUPER)가 채움 · 토큰 원문은 그때 한 번만 보임 · 비면 웹훅을 받지 않음', false, '^$|^[0-9a-f]{64}$', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('mkx_push_send', 1, NULL, NULL, NULL, true, '웹 푸시 보내기 — 1분마다 · push.send on 일 때만(처음 off) · 12시간 안 읽지 않은 회원 알림 · 기기마다 한 번 · ASSUME 은 밖으로 부르지 않음 · 404 · 410 이면 구독 GONE · D283 · v10.538'),
  ('mkx_groupbuy', 10, NULL, NULL, NULL, true, '소개몰 공동구매 — 10분마다 · 결제 참여자가 목표에 닿으면 확정 · 기한이 지나면 실패(참여 주문마다 기존 취소 신청) 또는 마감 · D283 · v10.540'),
  ('mkx_daily', 1440, 10, 5, NULL, true, '회원 · 소개몰 하루 일 — 매일 10:05 · 재구매 알림(mkx.rebuy on 일 때만) · 30일 지난 웹 푸시 기록 · 90일 지난 GONE · OFF 구독 지움 · D283 · v10.539')
ON CONFLICT (job) DO NOTHING;

/* ── 외부 연동 18번째 — 웹 푸시(VAPID) · 처음 꺼짐 · 간주 ── */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('WEBPUSH', '웹 푸시(VAPID)', '회원 알림을 브라우저 푸시로(v10.538) — 구글(FCM) · 모질라 · 마이크로소프트 · 애플 푸시 서비스로 암호화한 글(제목 · 내용 · 주소)만 · 회원 정보는 보내지 않음',
        'W3C_WEB_PUSH', 'NOT_STARTED', false, 'WEBPUSH_VAPID_PRIVATE', NULL, false,
        '업체 계약 · 신청 없음(VAPID 키를 우리가 만듦) — 운영 화면 › 회원 › 웹 푸시 › 「키 만들기」(SUPER) 또는 연동 키 화면에 공개 · 비밀 키 · push.vapid_subject(mailto:) → 앱처럼 설치 site.pwa on → push.enabled on → push.send_mode LIVE → push.send on(docs/676) · 키를 바꾸면 모든 구독을 다시 받아야 함',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 190))
ON CONFLICT (code) DO NOTHING;

/* 받는 키 — D272 의 CHECK · 함수를 그대로 복사해 WEBPUSH 2개만 더함(규칙 34 · 6차 b279 ~ b282 는 이 둘을 고치지 않음) */
ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ESIGN','ESIGN_WEBHOOK_SECRET'), ('ALIMTALK','ALIMTALK_KEY'), ('ALIMTALK','ALIMTALK_SENDER_KEY'), ('SAFENUM','SAFENUM_KEY'), ('SAFENUM','SAFENUM_WEBHOOK_SECRET'),
    ('MAIL','TELEGRAM_BOT_TOKEN'), ('MAIL','SLACK_WEBHOOK_URL'),
    ('TAXINBOX','TAXINBOX_API_KEY'),   -- v10.432 (D255)
    ('FIRMBANK','FIRMBANK_CLIENT_ID'), ('FIRMBANK','FIRMBANK_CLIENT_SECRET'),   -- v10.454 (D261 · 금융결제원 오픈뱅킹)
    ('FIRMBANK','FIRMBANK_USER_TOKEN'),   -- v10.467 (D264 · 은행 거래내역 자동 조회 — 오픈뱅킹 사용자 토큰)
    ('GEOIP','GEOIP_API_KEY'),   -- v10.485 (D268 · IP 국가 판별)
    ('SOCIAL','KAKAO_LOGIN_CLIENT_ID'), ('SOCIAL','KAKAO_LOGIN_SECRET'), ('SOCIAL','NAVER_CLIENT_ID'), ('SOCIAL','NAVER_CLIENT_SECRET'),   -- v10.498 (D272 · 간편 로그인)
    ('WEBPUSH','WEBPUSH_VAPID_PUBLIC'), ('WEBPUSH','WEBPUSH_VAPID_PRIVATE')));   -- v10.538 (D283 · 웹 푸시 VAPID)

/* fn_integ_secret_set — D272 그대로 + WEBPUSH 2개(v10.538 · VAPID 공개 키 65바이트 · 비밀 키 32바이트 — base64url 모양을 따로 봄) */
CREATE OR REPLACE FUNCTION public.fn_integ_secret_set(p_code text, p_name text, p_value text, p_actor uuid)
 RETURNS TABLE(o_name text, o_last4 text, o_updated_at timestamptz) LANGUAGE plpgsql AS $function$
/* 돌려주는 칸 이름에 o_ 를 붙입니다 — 표의 칸(name · last4 · updated_at)과 이름이 같으면 plpgsql 이 「모호함」으로 멈춥니다 */
DECLARE v text := btrim(coalesce(p_value, ''));
BEGIN
  IF p_name IN ('KMA_SERVICE_KEY', 'NTS_SERVICE_KEY') THEN
    /* 공공데이터포털 일반 인증키 — Decoding(+ / =) 또는 Encoding(%2B …) 어느 쪽이든 받습니다 */
    IF v !~ '^[A-Za-z0-9+/=%]{20,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 공공데이터포털 › 마이페이지 › 활용 신청 상세의 「일반 인증키(Decoding)」를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'ANTHROPIC_API_KEY' THEN
    /* v10.111 — API 키만(sk-ant-api…). 관리 키(sk-ant-admin…) · 사용자 키(sk-ant-usr…)는 쓰지 않습니다 */
    IF v !~ '^sk-ant-api[A-Za-z0-9_-]{20,250}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — Anthropic 콘솔 › API Keys 에서 만든 키(sk-ant-api 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TOSS_SECRET_KEY' THEN
    /* 토스페이먼츠 시크릿 키 — test_sk_ · live_sk_ (결제위젯은 gsk) */
    IF v !~ '^(test|live)_g?sk_[A-Za-z0-9_]{8,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 토스페이먼츠 개발자센터 › API 키의 「시크릿 키」(test_sk_ · live_sk_ 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TOSS_CLIENT_KEY' THEN
    /* 결제창 클라이언트 키 — 브라우저에 나가는 공개 키(test_ck_ · live_ck_ · 결제위젯은 gck) */
    IF v !~ '^(test|live)_g?ck_[A-Za-z0-9_]{8,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 토스페이먼츠 개발자센터 › API 키의 「클라이언트 키」(test_ck_ · live_ck_ 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'SMTP_PASS' THEN
    /* SES SMTP 비밀번호 — base64 모양 */
    IF v !~ '^[A-Za-z0-9+/=]{20,128}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — SES 콘솔 › SMTP 설정 › 「SMTP 자격 증명」의 비밀번호를 붙여 넣으십시오(IAM 액세스 키가 아닙니다).';
    END IF;
  ELSIF p_name = 'SMTP_USER' THEN
    /* v10.140 — SES SMTP 사용자 이름(보통 AKIA 로 시작하는 20자 · 영문 대문자 · 숫자) */
    IF v !~ '^[A-Z0-9]{16,128}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — SES 콘솔 › SMTP 설정 › 「SMTP 자격 증명」의 사용자 이름(영문 대문자 · 숫자)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'WEBPUSH_VAPID_PUBLIC' THEN
    /* v10.538 (D283) — 웹 푸시 VAPID 공개 키(P-256 압축 안 한 점 65바이트 → base64url 87자 · B 로 시작) */
    IF v !~ '^B[A-Za-z0-9_-]{86}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 웹 푸시 VAPID 공개 키(base64url 87자 · B 로 시작)를 붙여 넣거나 운영 화면 › 회원 › 웹 푸시 › 「키 만들기」를 쓰십시오.';
    END IF;
  ELSIF p_name = 'WEBPUSH_VAPID_PRIVATE' THEN
    /* v10.538 (D283) — 웹 푸시 VAPID 비밀 키(32바이트 → base64url 43자) */
    IF v !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 웹 푸시 VAPID 비밀 키(base64url 43자)를 붙여 넣거나 운영 화면 › 회원 › 웹 푸시 › 「키 만들기」를 쓰십시오.';
    END IF;
  ELSIF p_name = 'SLACK_WEBHOOK_URL' THEN
    /* v10.237 (D200) — 슬랙 앱 › Incoming Webhooks 가 준 주소「https://hooks.slack.com/services/T…/B…/…」 */
    IF v !~ '^https://hooks\.slack\.com/services/[A-Za-z0-9]+/[A-Za-z0-9]+/[A-Za-z0-9]+$' OR length(v) > 300 THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 주소 형식이 아닙니다 — 슬랙 앱 › Incoming Webhooks 의 「Webhook URL」(https://hooks.slack.com/services/ 로 시작)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TELEGRAM_BOT_TOKEN' THEN
    /* v10.200 (D178) — BotFather 가 준 토큰「123456789:AA…」(숫자 · 쌍점 · 영문 · 숫자 · _ · -) */
    IF v !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,64}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 텔레그램 BotFather 가 준 토큰(숫자:영문 · 숫자 — 예 123456789:AA…)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name IN ('BANK_VERIFY_KEY', 'BROKER_LOOKUP_KEY', 'ETAX_KEY', 'PASS_API_KEY', 'ESIGN_API_KEY', 'ALIMTALK_KEY', 'SAFENUM_KEY',
                  'NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID', 'ALIMTALK_SENDER_KEY', 'ESIGN_WEBHOOK_SECRET', 'SAFENUM_WEBHOOK_SECRET',
                  'TAXINBOX_API_KEY', 'FIRMBANK_CLIENT_ID', 'FIRMBANK_CLIENT_SECRET', 'FIRMBANK_USER_TOKEN', 'GEOIP_API_KEY',
                  'KAKAO_LOGIN_CLIENT_ID', 'KAKAO_LOGIN_SECRET', 'NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET') THEN   -- v10.498 (D272) 간편 로그인 키도 일반 모양   -- v10.485 (D268) IP 국가 판별 키도 일반 모양   -- v10.467 (D264) 사용자 토큰도 일반 모양   -- v10.432 (D255) 매입 세금계산서 연동 업체 키 · v10.454 (D261) 금융결제원 오픈뱅킹 키
    /* 업체마다 모양이 달라 「빈칸 없는 영문 · 숫자 · 기호 8 ~ 512자」만 봅니다(PostgreSQL 정규식 반복 수는 255 까지라 길이는 따로) */
    IF length(v) NOT BETWEEN 8 AND 512 OR v !~ '^[!-~]+$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 업체에서 받은 키를 빈칸 없이 붙여 넣으십시오(8 ~ 512자).';
    END IF;
  ELSIF v !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 카카오 콘솔 「앱 키」에서 복사한 값(영문 · 숫자 16 ~ 128자)을 붙여 넣으십시오.';
  END IF;
  INSERT INTO public.integration_secrets AS s (integration_code, name, value_enc, last4, is_public, updated_by, updated_at)
  VALUES (p_code, p_name, pgp_sym_encrypt(v, public.fn_enc_key()), right(v, 4), p_name IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY'), p_actor, now())
  ON CONFLICT (integration_code, name) DO UPDATE
     SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF p_name NOT IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY', 'TELEGRAM_BOT_TOKEN', 'SLACK_WEBHOOK_URL') THEN
    UPDATE public.integrations SET secret_registered = true WHERE code = p_code;
  END IF;
  RETURN QUERY SELECT s.name, s.last4, s.updated_at FROM public.integration_secrets s
                WHERE s.integration_code = p_code AND s.name = p_name;
END $function$;


/* ── ㉕ 권한(D258) 시드 — 새 탭 4개 · gen_seed.py 와 같은 규칙(GET = VIEW · 키 · 토큰 · 열기 · 지금 돌리기 = APPROVE · 그 밖 변경 = EDIT)
 *   mkx-push · mkx-sms = 회원 묶음(admusr · TAB_ROLES 따로 없음 = ADMIN · SUPER) · mkx-rebuy · mkx-groupbuy = 소개몰 묶음(admhlt · ADMIN · SUPER)
 *   회원 쪽(/me/push · /me/health/groupbuys) · 공개(/health/groupbuys · /site/optout080)는 탭이 아님 — 시드 없음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('mkx-push', '웹 푸시', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3110),
  ('mkx-sms', '문자 마케팅', 'admusr', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3120),
  ('mkx-rebuy', '재구매 알림', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3130),
  ('mkx-groupbuy', '공동구매', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3140)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'mkx-push', 'VIEW'), ('R_ADMIN', 'mkx-push', 'EDIT'), ('R_ADMIN', 'mkx-push', 'APPROVE'), ('R_ADMIN', 'mkx-push', 'EXPORT'),
  ('R_ADMIN', 'mkx-sms', 'VIEW'), ('R_ADMIN', 'mkx-sms', 'EDIT'), ('R_ADMIN', 'mkx-sms', 'APPROVE'), ('R_ADMIN', 'mkx-sms', 'EXPORT'),
  ('R_ADMIN', 'mkx-rebuy', 'VIEW'), ('R_ADMIN', 'mkx-rebuy', 'EDIT'), ('R_ADMIN', 'mkx-rebuy', 'APPROVE'), ('R_ADMIN', 'mkx-rebuy', 'EXPORT'),
  ('R_ADMIN', 'mkx-groupbuy', 'VIEW'), ('R_ADMIN', 'mkx-groupbuy', 'EDIT'), ('R_ADMIN', 'mkx-groupbuy', 'APPROVE'), ('R_ADMIN', 'mkx-groupbuy', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/mkx/push', 'mkx-push', 'VIEW'),
  ('POST', '/admin/mkx/push/keys', 'mkx-push', 'APPROVE'),
  ('POST', '/admin/mkx/push/run', 'mkx-push', 'APPROVE'),
  ('GET', '/admin/mkx/rebuy', 'mkx-rebuy', 'VIEW'),
  ('PUT', '/admin/mkx/rebuy/rules/{code}', 'mkx-rebuy', 'EDIT'),
  ('DELETE', '/admin/mkx/rebuy/rules/{code}', 'mkx-rebuy', 'EDIT'),
  ('POST', '/admin/mkx/rebuy/run', 'mkx-rebuy', 'APPROVE'),
  ('GET', '/admin/mkx/groupbuys', 'mkx-groupbuy', 'VIEW'),
  ('GET', '/admin/mkx/groupbuys/{id}/joins', 'mkx-groupbuy', 'VIEW'),
  ('POST', '/admin/mkx/groupbuys', 'mkx-groupbuy', 'EDIT'),
  ('PUT', '/admin/mkx/groupbuys/{id}', 'mkx-groupbuy', 'EDIT'),
  ('POST', '/admin/mkx/groupbuys/{id}/open', 'mkx-groupbuy', 'APPROVE'),
  ('POST', '/admin/mkx/groupbuys/{id}/cancel', 'mkx-groupbuy', 'APPROVE'),
  ('POST', '/admin/mkx/groupbuys/run', 'mkx-groupbuy', 'APPROVE'),
  ('GET', '/admin/mkx/sms', 'mkx-sms', 'VIEW'),
  ('POST', '/admin/mkx/sms/optout080', 'mkx-sms', 'EDIT'),
  ('POST', '/admin/mkx/sms/optout080/token', 'mkx-sms', 'APPROVE')
ON CONFLICT DO NOTHING;

