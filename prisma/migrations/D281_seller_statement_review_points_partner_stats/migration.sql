/* D281 (v10.532 ~ 534 · docs/670 ~ 672) (51) 소개몰 · 파트너 — 대표 11/20 「지금 바로 동시 착수」
 *   ① v10.532 판매자 월 정산서(인쇄용 화면 · PDF 저장 · 메일 처음 꺼짐 · 같은 달 두 번 안 보냄)
 *   ② v10.533 리뷰 작성 적립(㊲ 적립금 장부 · 한 주문 한 번 · 사진 가산 · 지움 · 가림이면 회수 · 처음 꺼짐)
 *   ③ v10.534 파트너 성과 대시보드(기간 묶음 함수 · 파트너센터는 자기 것만 · 운영 화면은 모두)
 *   다시 돌려도 같음(IF NOT EXISTS · CREATE OR REPLACE · DROP … IF EXISTS 뒤 다시 · ON CONFLICT DO NOTHING)
 *   지우는 문장은 CHECK 를 넓히는 두 줄뿐(hlt_point_lots 근거 CHECK DROP IF EXISTS → 바로 다시 ADD) */

/* ── ① 판매자 월 정산서 (v10.532 · docs/670) ─────────────────────────────────────────────
 *   주 정산서(hlt_settlements · 월요일 시작 7일)를 「시작일이 그 달」인 것끼리 모아 한 장
 *   금액 칸 이름은 fee_amount · fee_vat(판매수수료 · 그 부가세) — 옛 칸 이름을 새 표에 늘리지 않음
 *   메일은 한 번만: mail_state = 'SENT' 가 되면 그 줄은 아무것도 바꾸지 않음(DB 트리거) */
CREATE TABLE IF NOT EXISTS public.hlt_seller_statements (
  id             bigserial PRIMARY KEY,
  seller_id      uuid NOT NULL REFERENCES public.hlt_sellers(id),
  ym             text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  weeks          integer NOT NULL DEFAULT 0 CHECK (weeks BETWEEN 0 AND 6),
  gross_amount   bigint NOT NULL DEFAULT 0,
  fee_amount     bigint NOT NULL DEFAULT 0,
  fee_vat        bigint NOT NULL DEFAULT 0,
  refund_amount  bigint NOT NULL DEFAULT 0,
  carried_in     bigint NOT NULL DEFAULT 0,
  net_amount     bigint NOT NULL DEFAULT 0,
  carried_out    bigint NOT NULL DEFAULT 0,
  paid_amount    bigint NOT NULL DEFAULT 0,
  lines          jsonb NOT NULL DEFAULT '[]'::jsonb,
  made_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  remade_at      timestamptz,
  mail_state     text NOT NULL DEFAULT 'NONE' CHECK (mail_state IN ('NONE', 'OFF', 'SENT', 'FAILED', 'NO_ADDR')),
  mail_to        text CHECK (mail_to IS NULL OR char_length(mail_to) <= 120),
  mail_error     text CHECK (mail_error IS NULL OR char_length(mail_error) <= 200),
  mail_tries     integer NOT NULL DEFAULT 0 CHECK (mail_tries BETWEEN 0 AND 20),
  mail_claimed_at timestamptz,
  mailed_at      timestamptz,
  mailed_by      uuid REFERENCES public.accounts(id),
  CONSTRAINT ux_hlt_stmt_seller_ym UNIQUE (seller_id, ym),
  CONSTRAINT ck_hlt_stmt_sent CHECK ((mail_state = 'SENT') = (mailed_at IS NOT NULL)),
  CONSTRAINT ck_hlt_stmt_lines CHECK (jsonb_typeof(lines) = 'array')
);
CREATE INDEX IF NOT EXISTS ix_hlt_stmt_ym ON public.hlt_seller_statements (ym, seller_id);
COMMENT ON COLUMN public.hlt_seller_statements.mail_claimed_at IS 'v10.532 보내는 중 표시(정기 작업 · 운영 「지금 보내기」가 함께 보내지 않게 · 10분 지나면 풀린 것으로 봄 · 보낸 뒤 비움)';
COMMENT ON TABLE public.hlt_seller_statements IS 'v10.532 (D281) 입점 판매자 월 정산서 — 그 달에 시작한 주 정산서 합계 · 주별 줄(lines) · 메일(처음 꺼짐 mall.statement_mail · 같은 달 한 번만 · 보낸 줄은 못 고침) · 지우지 않음';

/* 지킴 — 지우지 않음 · 판매자 · 달은 바꾸지 않음 · 메일로 보낸 줄(SENT)은 아무것도 바꾸지 않음(같은 달 두 번 안 보냄) */
CREATE OR REPLACE FUNCTION public.fn_hlt_stmt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_STMT: 월 정산서는 지우지 않습니다.'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.mail_state = 'SENT' THEN RAISE EXCEPTION 'HLT_STMT: 새 월 정산서는 보내기 전 상태로 넣습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.seller_id, NEW.ym, NEW.made_at) IS DISTINCT FROM (OLD.seller_id, OLD.ym, OLD.made_at) THEN
    RAISE EXCEPTION 'HLT_STMT: 월 정산서의 판매자 · 달 · 처음 만든 시각은 바꾸지 않습니다.';
  END IF;
  IF OLD.mail_state = 'SENT' THEN
    RAISE EXCEPTION 'HLT_STMT_SENT: 메일로 보낸 월 정산서는 바꾸지 않습니다(같은 달은 한 번만 보냅니다).';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_stmt_guard ON public.hlt_seller_statements;
CREATE TRIGGER trg_hlt_stmt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_seller_statements
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_stmt_guard();

/* 셈(읽기만) — 그 판매자의 그 달(시작일 기준) 주 정산서 합계 · 주별 줄 · 서버 화면 · 미리보기 · 만들기가 같이 씀 */
CREATE OR REPLACE FUNCTION public.fn_hlt_statement_calc(p_seller uuid, p_ym text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_from date; v_to date; r jsonb;
BEGIN
  IF p_ym IS NULL OR p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'HLT_STMT_YM: 정산 달은 YYYY-MM 으로 주십시오.'; END IF;
  v_from := (p_ym || '-01')::date;
  v_to := (v_from + interval '1 month')::date;
  SELECT jsonb_build_object(
           'weeks', count(*)::int,
           'gross', coalesce(sum(st.gross_amount), 0)::bigint,
           'fee', coalesce(sum(st.commission), 0)::bigint,
           'feeVat', coalesce(sum(st.commission_vat), 0)::bigint,
           'refund', coalesce(sum(st.refund_amount), 0)::bigint,
           'carriedIn', coalesce((array_agg(st.carried_in ORDER BY st.period_from))[1], 0)::bigint,
           'net', coalesce(sum(st.net_amount), 0)::bigint,
           'carriedOut', coalesce((array_agg(st.carried_out ORDER BY st.period_from DESC))[1], 0)::bigint,
           'paid', coalesce(sum(st.net_amount) FILTER (WHERE st.status = 'PAID'), 0)::bigint,
           'lines', coalesce(jsonb_agg(jsonb_build_object(
               'id', st.id, 'from', st.period_from, 'to', st.period_to, 'gross', st.gross_amount, 'fee', st.commission, 'feeVat', st.commission_vat,
               'refund', st.refund_amount, 'carriedIn', st.carried_in, 'net', st.net_amount, 'carriedOut', st.carried_out, 'status', st.status,
               'invoiceState', st.invoice_state, 'invoiceNo', st.invoice_no,
               'items', (SELECT count(*) FROM public.hlt_settlement_items i WHERE i.settlement_id = st.id)) ORDER BY st.period_from), '[]'::jsonb))
    INTO r
    FROM public.hlt_settlements st
   WHERE st.seller_id = p_seller AND st.period_from >= v_from AND st.period_from < v_to;
  RETURN r;
END $$;

/* 만들기 · 다시 만들기 — 보낸 줄(SENT)은 막음(트리거와 같은 말) · 돌려주는 값은 줄 번호 */
CREATE OR REPLACE FUNCTION public.fn_hlt_statement_make(p_seller uuid, p_ym text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c jsonb; v_id bigint; v_state text; v_type text;
BEGIN
  SELECT type INTO v_type FROM public.hlt_sellers WHERE id = p_seller;
  IF v_type IS NULL OR v_type NOT IN ('TENANT', 'BRAND') THEN RAISE EXCEPTION 'HLT_STMT_SELLER: 입점 판매자(일반 입점 · 브랜드 직영관)만 월 정산서를 만듭니다.'; END IF;
  SELECT id, mail_state INTO v_id, v_state FROM public.hlt_seller_statements WHERE seller_id = p_seller AND ym = p_ym FOR UPDATE;
  IF v_state = 'SENT' THEN RAISE EXCEPTION 'HLT_STMT_SENT: 메일로 보낸 월 정산서는 바꾸지 않습니다(같은 달은 한 번만 보냅니다).'; END IF;
  c := public.fn_hlt_statement_calc(p_seller, p_ym);
  IF v_id IS NULL THEN
    INSERT INTO public.hlt_seller_statements (seller_id, ym, weeks, gross_amount, fee_amount, fee_vat, refund_amount, carried_in, net_amount, carried_out, paid_amount, lines)
    VALUES (p_seller, p_ym, (c->>'weeks')::int, (c->>'gross')::bigint, (c->>'fee')::bigint, (c->>'feeVat')::bigint, (c->>'refund')::bigint,
            (c->>'carriedIn')::bigint, (c->>'net')::bigint, (c->>'carriedOut')::bigint, (c->>'paid')::bigint, c->'lines')
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.hlt_seller_statements
       SET weeks = (c->>'weeks')::int, gross_amount = (c->>'gross')::bigint, fee_amount = (c->>'fee')::bigint, fee_vat = (c->>'feeVat')::bigint,
           refund_amount = (c->>'refund')::bigint, carried_in = (c->>'carriedIn')::bigint, net_amount = (c->>'net')::bigint,
           carried_out = (c->>'carriedOut')::bigint, paid_amount = (c->>'paid')::bigint, lines = c->'lines', remade_at = clock_timestamp()
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;

/* ── ② 리뷰 작성 적립 (v10.533 · docs/671) ─────────────────────────────────────────────────
 *   ㊲(D267) 적립금 장부를 그대로 씀 — 묶음 근거 REVIEW 하나만 더함 · 기록은 EARN(적립) · REVOKE(회수) 그대로라
 *   전표 MALL_POINT_EARN(판매촉진비 / 적립금 충당부채) · MALL_POINT_LAPSE(반대)가 따로 고치지 않아도 잡음
 *   주는 때: 리뷰가 보이게(VISIBLE) 된 순간 한 번 — 바로 보임 · 금칙어 확인 뒤 「보이기」 모두
 *   조건: mall.points · mall.review_points 둘 다 on · 직판 주문 · 구매확정 · 확정 뒤 mall.review_points_days 일 안에 쓴 리뷰 · 글 mall.review_points_min_len 자 이상
 *   금액: 글 mall.review_points_text + 사진이 붙어 있으면 mall.review_points_photo(가산)
 *   한 주문 한 번(hlt_review_rewards.order_id 고유) — 회수된 뒤 다시 써도 다시 주지 않음(지웠다 쓰기로 되풀이 막음)
 *   회수: 리뷰를 지우거나(본인) 가리면(운영 · 반품) 그 묶음의 남은 금액 회수 · 이미 쓴 몫은 운영 알림(MALL_REVIEW_POINT_SHORT)
 *   사진: 기존 회원 사진 용도(REQUEST_IMAGE · jpg · png 10MB)로 올린 본인 파일(READY) — 새 파일 용도를 만들지 않음(NOTES 3절) */

ALTER TABLE public.hlt_reviews ADD COLUMN IF NOT EXISTS photo_file_id uuid REFERENCES public.files(id);
COMMENT ON COLUMN public.hlt_reviews.photo_file_id IS 'v10.533 (D281) 리뷰 사진 한 장 — 본인이 올린 회원 사진(REQUEST_IMAGE · READY) · 보이는 리뷰만 공개 주소 /health/reviews/{id}/photo';

CREATE OR REPLACE FUNCTION public.fn_hlt_review_photo_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
  IF NEW.photo_file_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.photo_file_id IS NOT DISTINCT FROM OLD.photo_file_id THEN RETURN NEW; END IF;
  SELECT id, owner_account_id, purpose, status INTO f FROM public.files WHERE id = NEW.photo_file_id;
  IF f.id IS NULL OR f.status <> 'READY' OR f.purpose <> 'REQUEST_IMAGE' OR f.owner_account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'HLT_REVIEW_PHOTO: 리뷰 사진은 본인이 올리기를 마친 사진(REQUEST_IMAGE)만 붙입니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_review_photo_guard ON public.hlt_reviews;
CREATE TRIGGER trg_hlt_review_photo_guard BEFORE INSERT OR UPDATE OF photo_file_id ON public.hlt_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_review_photo_guard();

/* 적립금 묶음 근거에 REVIEW — D267 의 이름 없는 CHECK(hlt_point_lots_source_check)를 이름 있는 것으로 바꿔 넓힘 */
ALTER TABLE public.hlt_point_lots DROP CONSTRAINT IF EXISTS hlt_point_lots_source_check;
ALTER TABLE public.hlt_point_lots DROP CONSTRAINT IF EXISTS ck_hlt_point_lot_source;
ALTER TABLE public.hlt_point_lots ADD CONSTRAINT ck_hlt_point_lot_source CHECK (source IN ('EARN', 'ADMIN', 'RESTORE', 'REVIEW'));
ALTER TABLE public.hlt_point_lots DROP CONSTRAINT IF EXISTS ck_hlt_point_lot_review;
ALTER TABLE public.hlt_point_lots ADD CONSTRAINT ck_hlt_point_lot_review CHECK (source <> 'REVIEW' OR order_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_point_lot_review ON public.hlt_point_lots (order_id) WHERE source = 'REVIEW';

CREATE TABLE IF NOT EXISTS public.hlt_review_rewards (
  id              bigserial PRIMARY KEY,
  order_id        uuid NOT NULL REFERENCES public.hlt_orders(id),
  review_id       uuid NOT NULL,
  account_id      uuid NOT NULL REFERENCES public.accounts(id),
  lot_id          bigint REFERENCES public.hlt_point_lots(id),
  amount          bigint NOT NULL CHECK (amount BETWEEN 1 AND 100000),
  photo           boolean NOT NULL DEFAULT false,
  state           text NOT NULL DEFAULT 'GRANTED' CHECK (state IN ('GRANTED', 'REVOKED')),
  revoked_at      timestamptz,
  revoke_reason   text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 200),
  revoked_amount  bigint CHECK (revoked_amount IS NULL OR revoked_amount >= 0),
  revoked_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ux_hlt_review_reward_order UNIQUE (order_id),
  CONSTRAINT ck_hlt_review_reward_revoked CHECK ((state = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_hlt_review_reward_review ON public.hlt_review_rewards (review_id);
CREATE INDEX IF NOT EXISTS ix_hlt_review_reward_acc ON public.hlt_review_rewards (account_id, id DESC);
COMMENT ON TABLE public.hlt_review_rewards IS 'v10.533 (D281) 리뷰 작성 적립 — 주문 하나에 한 줄(회수된 뒤에도 다시 주지 않음) · 리뷰 번호는 리뷰가 지워져도 남김(참조 없음) · 묶음(REVIEW) · 사진 가산 여부 · 회수(때 · 사유 · 회수한 금액) · 지우지 않음';

/* 지킴 — 지우지 않음 · 주문 · 리뷰 · 회원 · 금액 · 묶음은 바꾸지 않음 · 주기 → 회수 한 방향만 */
CREATE OR REPLACE FUNCTION public.fn_hlt_review_reward_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_REVIEW_POINT: 리뷰 적립 기록은 지우지 않습니다.'; END IF;
  IF (NEW.order_id, NEW.review_id, NEW.account_id, NEW.amount, NEW.photo, NEW.created_at) IS DISTINCT FROM
     (OLD.order_id, OLD.review_id, OLD.account_id, OLD.amount, OLD.photo, OLD.created_at)
     OR (OLD.lot_id IS NOT NULL AND NEW.lot_id IS DISTINCT FROM OLD.lot_id) THEN
    RAISE EXCEPTION 'HLT_REVIEW_POINT: 리뷰 적립의 주문 · 리뷰 · 회원 · 금액 · 묶음은 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'REVOKED' AND (NEW.state <> 'REVOKED' OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'HLT_REVIEW_POINT: 회수한 리뷰 적립은 다시 열지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_review_reward_guard ON public.hlt_review_rewards;
CREATE TRIGGER trg_hlt_review_reward_guard BEFORE UPDATE OR DELETE ON public.hlt_review_rewards
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_review_reward_guard();

/* 주기 — 조건이 안 맞거나 이미 준(회수한) 주문이면 0 · 다시 불러도 같음 */
CREATE OR REPLACE FUNCTION public.fn_hlt_review_reward(p_review uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE r record; v_text bigint; v_photo bigint; v_min integer; v_days integer; v_valid integer; v_amt bigint; v_wid bigint; v_lot bigint; v_has_photo boolean;
BEGIN
  IF NOT (public.fn_hlt_setting_on('mall.points') AND public.fn_hlt_setting_on('mall.review_points')) THEN RETURN 0; END IF;
  SELECT rv.id, rv.order_id, rv.account_id, rv.state, rv.body, rv.photo_file_id, rv.created_at, o.status, o.confirmed_at, o.order_no, s.type AS seller_type
    INTO r
    FROM public.hlt_reviews rv JOIN public.hlt_orders o ON o.id = rv.order_id LEFT JOIN public.hlt_sellers s ON s.id = o.seller_id
   WHERE rv.id = p_review;
  IF r.id IS NULL OR r.state <> 'VISIBLE' OR r.status <> 'CONFIRMED' OR r.seller_type IS DISTINCT FROM 'DIRECT' THEN RETURN 0; END IF;
  v_days := greatest(1, least(365, public.fn_hlt_setting_num('mall.review_points_days', 30)::integer));
  IF r.confirmed_at IS NULL OR r.created_at > r.confirmed_at + make_interval(days => v_days) THEN RETURN 0; END IF;
  v_min := greatest(10, least(500, public.fn_hlt_setting_num('mall.review_points_min_len', 20)::integer));
  IF char_length(btrim(r.body)) < v_min THEN RETURN 0; END IF;
  v_text := greatest(0, least(5000, public.fn_hlt_setting_num('mall.review_points_text', 500)::bigint));
  v_photo := greatest(0, least(5000, public.fn_hlt_setting_num('mall.review_points_photo', 500)::bigint));
  v_has_photo := r.photo_file_id IS NOT NULL;
  v_amt := v_text + CASE WHEN v_has_photo THEN v_photo ELSE 0 END;
  IF v_amt < 1 THEN RETURN 0; END IF;
  INSERT INTO public.hlt_review_rewards (order_id, review_id, account_id, amount, photo)
  VALUES (r.order_id, r.id, r.account_id, v_amt, v_has_photo)
  ON CONFLICT (order_id) DO NOTHING RETURNING id INTO v_wid;
  IF v_wid IS NULL THEN RETURN 0; END IF;
  v_valid := greatest(30, least(1825, public.fn_hlt_setting_num('mall.points_valid_days', 365)::integer));
  INSERT INTO public.hlt_point_lots (account_id, source, order_id, amount, remaining, expires_at)
  VALUES (r.account_id, 'REVIEW', r.order_id, v_amt, v_amt, now() + make_interval(days => v_valid))
  RETURNING id INTO v_lot;
  UPDATE public.hlt_review_rewards SET lot_id = v_lot WHERE id = v_wid;
  INSERT INTO public.hlt_point_txns (account_id, kind, amount, order_id, lot_id, reason, detail)
  VALUES (r.account_id, 'EARN', v_amt, r.order_id, v_lot, '리뷰 작성 적립',
          jsonb_build_object('kind', 'REVIEW', 'review', r.id, 'photo', v_has_photo, 'text', v_text, 'photoBonus', CASE WHEN v_has_photo THEN v_photo ELSE 0 END));
  INSERT INTO public.notifications (account_id, event_code, title, body, link_url)
  VALUES (r.account_id, 'HLT_REVIEW_POINT', '리뷰 적립금이 쌓였습니다',
          to_char(v_amt, 'FM999,999,999') || '원 — ' || r.order_no || ' 리뷰' || CASE WHEN v_has_photo THEN '(사진 가산 포함)' ELSE '' END, '/my/health/benefits');
  RETURN v_amt;
END $$;

/* 회수 — 그 리뷰로 준 묶음의 남은 금액만 · 이미 쓴 몫은 운영 알림 · 주지 않았거나 이미 회수면 0 */
CREATE OR REPLACE FUNCTION public.fn_hlt_review_reward_revoke(p_review uuid, p_why text, p_actor uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE w record; l record; v_back bigint := 0; v_short bigint := 0; v_why text;
BEGIN
  v_why := left(coalesce(nullif(btrim(p_why), ''), '리뷰 적립 회수'), 200);
  SELECT id, order_id, account_id, lot_id, amount INTO w FROM public.hlt_review_rewards WHERE review_id = p_review AND state = 'GRANTED' FOR UPDATE;
  IF w.id IS NULL THEN RETURN 0; END IF;
  SELECT id, amount, remaining, closed_at INTO l FROM public.hlt_point_lots WHERE id = w.lot_id FOR UPDATE;
  IF l.id IS NOT NULL AND l.closed_at IS NULL THEN
    v_back := l.remaining;
    v_short := l.amount - l.remaining;
    UPDATE public.hlt_point_lots SET remaining = 0, closed_reason = 'REVOKED', closed_at = clock_timestamp() WHERE id = l.id;
    IF v_back > 0 THEN
      INSERT INTO public.hlt_point_txns (account_id, kind, amount, order_id, lot_id, reason, actor, detail)
      VALUES (w.account_id, 'REVOKE', v_back, w.order_id, l.id, v_why, p_actor, jsonb_build_object('kind', 'REVIEW', 'review', p_review, 'earned', l.amount, 'short', v_short));
    END IF;
  END IF;
  UPDATE public.hlt_review_rewards SET state = 'REVOKED', revoked_at = clock_timestamp(), revoke_reason = v_why, revoked_amount = v_back, revoked_by = p_actor WHERE id = w.id;
  IF v_short > 0 THEN
    INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
    VALUES ('MALL_REVIEW_POINT_SHORT', 'WARN',
            '리뷰 적립 회수 — 적립금 일부를 이미 써서 다 회수하지 못함(' || v_short || '원) — 소개몰 › 리뷰 적립',
            jsonb_build_object('review', p_review, 'order', w.order_id, 'account', w.account_id, 'earned', w.amount, 'short', v_short), clock_timestamp())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_back;
END $$;

/* 리뷰가 보이게 되면 주고 · 가려지거나 지워지면 회수 — 적립이 실패해도 리뷰 쓰기는 막지 않음(운영 알림만) */
CREATE OR REPLACE FUNCTION public.fn_hlt_review_reward_on_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      PERFORM public.fn_hlt_review_reward_revoke(OLD.id, '리뷰 삭제 — 적립 회수', NULL);
      RETURN OLD;
    END IF;
    IF NEW.state = 'VISIBLE' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'VISIBLE') THEN
      PERFORM public.fn_hlt_review_reward(NEW.id);
    ELSIF TG_OP = 'UPDATE' AND NEW.state = 'HIDDEN' AND OLD.state IS DISTINCT FROM 'HIDDEN' THEN
      PERFORM public.fn_hlt_review_reward_revoke(NEW.id, left('리뷰 가림 — ' || coalesce(NEW.hidden_reason, ''), 200), NEW.decided_by);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
    VALUES ('MALL_REVIEW_POINT_FAIL', 'WARN', '리뷰 적립 · 회수를 하지 못함 — 소개몰 › 리뷰 적립에서 확인',
            jsonb_build_object('review', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END, 'op', TG_OP, 'error', left(SQLERRM, 200)), clock_timestamp())
    ON CONFLICT DO NOTHING;
  END;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_review_reward_ins ON public.hlt_reviews;
CREATE TRIGGER trg_hlt_review_reward_ins AFTER INSERT ON public.hlt_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_review_reward_on_change();
DROP TRIGGER IF EXISTS trg_hlt_review_reward_upd ON public.hlt_reviews;
CREATE TRIGGER trg_hlt_review_reward_upd AFTER UPDATE ON public.hlt_reviews
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION public.fn_hlt_review_reward_on_change();
DROP TRIGGER IF EXISTS trg_hlt_review_reward_del ON public.hlt_reviews;
CREATE TRIGGER trg_hlt_review_reward_del AFTER DELETE ON public.hlt_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_review_reward_on_change();

/* ── ③ 파트너 성과 대시보드 (v10.534 · docs/672) ────────────────────────────────────────────
 *   새 표 없음 — 있는 기록(받은 리드 lead_deliveries · 이행 보고 partner_fulfillment_reports · 리드 이용료 lead_fees · 지급 정산 partner_settlements)을
 *   기간 묶음(일 · 주 · 월 · 한국 시각)으로 세는 함수 하나 · 읽기만
 *   p_partner 가 NULL 이면 모든 파트너 합(운영 화면만 부름 — 파트너센터는 서버가 자기 파트너 번호만 넣음)
 *   응답 속도 = 리드를 받은 뒤 연락처를 연(열람) 때까지 분(평균 · 가운데 값) · 성사 = 소비자가 확인한 이행 보고(소비자 확인 시각 기준)
 *   리드 이용료 = 확정(BILLED)된 확인비용(확정 시각 기준) · 받은 정산 = 지급 끝난(PAID) 정산(지급 시각 기준 · 실지급액) */

CREATE INDEX IF NOT EXISTS ix_ld_partner_delivered ON public.lead_deliveries (partner_id, delivered_at);
CREATE INDEX IF NOT EXISTS ix_pfr_partner_consumer ON public.partner_fulfillment_reports (partner_id, consumer_at) WHERE consumer_state = 'CONFIRMED';
CREATE INDEX IF NOT EXISTS ix_lead_fees_partner_billed ON public.lead_fees (partner_id, billed_at) WHERE state = 'BILLED';

CREATE OR REPLACE FUNCTION public.fn_ptn_perf_series(p_partner uuid, p_from date, p_to date, p_unit text)
RETURNS TABLE (bucket date, received integer, viewed integer, view_min_avg numeric, view_min_p50 numeric, confirmed integer, fee_billed bigint, paid_out bigint)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v_lo timestamptz; v_hi timestamptz;
BEGIN
  IF p_unit IS NULL OR p_unit NOT IN ('day', 'week', 'month') THEN RAISE EXCEPTION 'PTN_PERF_UNIT: 묶음 단위는 day · week · month 중 하나입니다.'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 800 THEN RAISE EXCEPTION 'PTN_PERF_RANGE: 기간은 하루 ~ 800일 안으로 주십시오.'; END IF;
  v_lo := p_from::timestamp AT TIME ZONE 'Asia/Seoul';
  v_hi := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
  RETURN QUERY
  WITH b AS (
    SELECT g::date AS d FROM generate_series(date_trunc(p_unit, p_from::timestamp), p_to::timestamp, ('1 ' || p_unit)::interval) g
  ), dl AS (
    SELECT date_trunc(p_unit, x.delivered_at AT TIME ZONE 'Asia/Seoul')::date AS k, count(*)::int AS n,
           count(*) FILTER (WHERE x.viewed_at IS NOT NULL)::int AS v,
           avg(EXTRACT(epoch FROM (x.viewed_at - x.delivered_at)) / 60) FILTER (WHERE x.viewed_at IS NOT NULL) AS a,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (x.viewed_at - x.delivered_at)) / 60) FILTER (WHERE x.viewed_at IS NOT NULL) AS m
      FROM public.lead_deliveries x
     WHERE (p_partner IS NULL OR x.partner_id = p_partner) AND x.state <> 'REVOKED' AND x.delivered_at >= v_lo AND x.delivered_at < v_hi
     GROUP BY 1
  ), cf AS (
    SELECT date_trunc(p_unit, f.consumer_at AT TIME ZONE 'Asia/Seoul')::date AS k, count(*)::int AS n
      FROM public.partner_fulfillment_reports f
     WHERE (p_partner IS NULL OR f.partner_id = p_partner) AND f.consumer_state = 'CONFIRMED' AND f.consumer_at >= v_lo AND f.consumer_at < v_hi
     GROUP BY 1
  ), fe AS (
    SELECT date_trunc(p_unit, e.billed_at AT TIME ZONE 'Asia/Seoul')::date AS k, coalesce(sum(e.amount), 0)::bigint AS s
      FROM public.lead_fees e
     WHERE (p_partner IS NULL OR e.partner_id = p_partner) AND e.state = 'BILLED' AND e.billed_at >= v_lo AND e.billed_at < v_hi
     GROUP BY 1
  ), po AS (
    SELECT date_trunc(p_unit, t.paid_at AT TIME ZONE 'Asia/Seoul')::date AS k, coalesce(sum(t.net_amount), 0)::bigint AS s
      FROM public.partner_settlements t
     WHERE (p_partner IS NULL OR t.partner_id = p_partner) AND t.state = 'PAID' AND t.paid_at >= v_lo AND t.paid_at < v_hi
     GROUP BY 1
  )
  SELECT b.d, coalesce(dl.n, 0), coalesce(dl.v, 0), round(dl.a::numeric, 1), round(dl.m::numeric, 1),
         coalesce(cf.n, 0), coalesce(fe.s, 0)::bigint, coalesce(po.s, 0)::bigint
    FROM b LEFT JOIN dl ON dl.k = b.d LEFT JOIN cf ON cf.k = b.d LEFT JOIN fe ON fe.k = b.d LEFT JOIN po ON po.k = b.d
   ORDER BY b.d;
END $$;
COMMENT ON FUNCTION public.fn_ptn_perf_series(uuid, date, date, text) IS 'v10.534 (D281) 파트너 성과 기간 묶음 — 받은 리드 · 열람 · 응답 분(평균 · 가운데) · 성사(소비자 확인) · 리드 이용료 확정 · 받은 정산 · 일 · 주(월요일) · 월 · 한국 시각 · 읽기만 · p_partner NULL = 모두(운영 화면만)';

/* ── ④ 설정 · 정기 작업 · ㉕ 권한(D258) 시드 ────────────────────────────────────────────────
 *   메일 · 적립은 처음 off(규칙 9) · 값 무늬(value_pattern)는 서버가 쓰는 범위와 같음(health-slx.ts 의 clamp 와 같은 끝값) */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('mall.statement_mail', 'off', 'ADMIN', '입점 판매자 월 정산서 메일(v10.532 · D281) — 처음 off · on 이고 메일 준비됨이면 매달 mall.statement_day 일 09:10 에 지난달 정산서를 판매자 계정 메일로 한 번만 보냄(같은 달 두 번 안 보냄) · 인쇄용 화면 · PDF 저장은 꺼져도 됨', false, '^(on|off)$', 'off'),
  ('mall.statement_day', '5', 'ADMIN', '월 정산서 만드는 날(v10.532 · 1 ~ 28일 · 처음 5) — 이날부터 매일 09:10 지난달 정산서를 다시 셈(보내기 전까지) · 늦게 마감한 주도 들어감', false, '^([1-9]|1[0-9]|2[0-8])$', '5'),
  ('mall.review_points', 'off', 'ADMIN', '리뷰 작성 적립(v10.533 · D281) — 처음 off · on 이고 적립금(mall.points)도 on 이면 구매확정한 직판 주문의 리뷰가 보이게 될 때 주문 하나에 한 번 적립 · 지우거나 가리면 회수', false, '^(on|off)$', 'off'),
  ('mall.review_points_text', '500', 'ADMIN', '리뷰 적립금(원 · 0 ~ 5000 · 처음 500 · v10.533) — 글 리뷰 기본', false, '^([0-9]|[1-9][0-9]{1,2}|[1-4][0-9]{3}|5000)$', '500'),
  ('mall.review_points_photo', '500', 'ADMIN', '사진 리뷰 가산(원 · 0 ~ 5000 · 처음 500 · v10.533) — 사진이 붙은 리뷰는 기본에 더함', false, '^([0-9]|[1-9][0-9]{1,2}|[1-4][0-9]{3}|5000)$', '500'),
  ('mall.review_points_min_len', '20', 'ADMIN', '리뷰 적립 최소 글자(10 ~ 500 · 처음 20 · v10.533) — 리뷰는 10자부터 쓸 수 있지만 적립은 이만큼부터', false, '^([1-9][0-9]|[1-4][0-9]{2}|500)$', '20'),
  ('mall.review_points_days', '30', 'ADMIN', '리뷰 적립 기한(일 · 1 ~ 365 · 처음 30 · v10.533) — 구매확정 뒤 이 날 수 안에 쓴 리뷰만 적립', false, '^([1-9]|[1-9][0-9]|[12][0-9]{2}|3[0-5][0-9]|36[0-5])$', '30')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('mall_statement', 1440, 9, 10, NULL, true, '입점 판매자 월 정산서 — 매일 09:10 · 이달 mall.statement_day 일부터 지난달 정산서를 만들고 다시 셈(보내기 전까지) · mall.statement_mail on · 메일 준비됨이면 한 번만 메일 · D281 · v10.532')
ON CONFLICT (job) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 새 탭 3개 · gen_seed.py 와 같은 규칙(GET = VIEW · 만들기 · 메일 보내기 = APPROVE · 그 밖 변경 = EDIT)
 *   slx-statements · slx-review-points = 소개몰 묶음(admhlt · TAB_ROLES 따로 없음 = ADMIN · SUPER)
 *   slx-ptn-perf = 파트너사 묶음(admptn · TAB_ROLES ADMIN · SUPER · PARTNER_MAL) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('slx-statements', '판매자 월 정산서', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3010),
  ('slx-review-points', '리뷰 적립', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3020),
  ('slx-ptn-perf', '파트너 성과', 'admptn', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3030)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'slx-statements', 'VIEW'), ('R_ADMIN', 'slx-statements', 'EDIT'), ('R_ADMIN', 'slx-statements', 'APPROVE'), ('R_ADMIN', 'slx-statements', 'EXPORT'),
  ('R_ADMIN', 'slx-review-points', 'VIEW'), ('R_ADMIN', 'slx-review-points', 'EDIT'), ('R_ADMIN', 'slx-review-points', 'APPROVE'), ('R_ADMIN', 'slx-review-points', 'EXPORT'),
  ('R_ADMIN', 'slx-ptn-perf', 'VIEW'), ('R_ADMIN', 'slx-ptn-perf', 'EDIT'), ('R_ADMIN', 'slx-ptn-perf', 'APPROVE'), ('R_ADMIN', 'slx-ptn-perf', 'EXPORT'),
  ('R_PARTNER_MAL', 'slx-ptn-perf', 'VIEW'), ('R_PARTNER_MAL', 'slx-ptn-perf', 'EDIT'), ('R_PARTNER_MAL', 'slx-ptn-perf', 'APPROVE'), ('R_PARTNER_MAL', 'slx-ptn-perf', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/health/statements', 'slx-statements', 'VIEW'),
  ('GET', '/admin/health/statements/{id}', 'slx-statements', 'VIEW'),
  ('POST', '/admin/health/statements/make', 'slx-statements', 'APPROVE'),
  ('POST', '/admin/health/statements/{id}/mail', 'slx-statements', 'APPROVE'),
  ('GET', '/admin/health/review-points', 'slx-review-points', 'VIEW'),
  ('POST', '/admin/health/review-points/{id}/revoke', 'slx-review-points', 'EDIT'),
  ('GET', '/admin/partner-perf', 'slx-ptn-perf', 'VIEW')
ON CONFLICT DO NOTHING;

