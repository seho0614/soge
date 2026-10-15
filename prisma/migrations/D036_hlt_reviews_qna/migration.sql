-- v10.28 — 소개몰 리뷰 · 상품 문의 (10/9 답 「권장대로」)
--   리뷰: 구매확정한 주문의 상품마다 1건 · 별점 1 ~ 5 · 글 10 ~ 1,000자 · 사진은 이번 판에 받지 않음 ·
--         바로 보임 — 금칙어 사전(banned_words · 소개몰 + 공통)에 걸리면 「운영 확인 대기」(PENDING) ·
--         고치기 · 지우기는 쓴 사람만 · 운영자는 지우지 않고 가림(HIDDEN · 사유) · 반품된 주문의 리뷰는 가림.
--   문의: 로그인 · 본인인증 회원(서비스) · 비공개 고르기(쓴 사람과 운영자만 봄) · 운영자가 답함 · 운영자는 가림.

CREATE TABLE IF NOT EXISTS hlt_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL UNIQUE REFERENCES hlt_order_items(id) ON DELETE RESTRICT,
  order_id      uuid NOT NULL REFERENCES hlt_orders(id) ON DELETE RESTRICT,
  product_id    uuid NOT NULL REFERENCES hlt_products(id) ON DELETE RESTRICT,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 1000),
  state         text NOT NULL DEFAULT 'VISIBLE' CHECK (state IN ('VISIBLE','PENDING','HIDDEN')),
  hold_word     text,                      -- PENDING 으로 둔 까닭(걸린 말)
  hidden_reason text,
  decided_by    uuid REFERENCES accounts(id),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_review_hidden_reason CHECK (state <> 'HIDDEN' OR btrim(coalesce(hidden_reason,'')) <> '')
);
CREATE INDEX IF NOT EXISTS idx_hlt_reviews_product ON hlt_reviews (product_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hlt_reviews_state ON hlt_reviews (state, created_at);

/* 넣을 때 — 구매확정한 내 주문의 그 상품 줄 · 상품 일치 · 금칙어면 PENDING. 고칠 때 — 글을 바꾸면 다시 검사 */
CREATE OR REPLACE FUNCTION public.fn_hlt_review_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE o record; it record; hit record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO it FROM hlt_order_items WHERE id = NEW.order_item_id;
    IF it.id IS NULL OR it.order_id <> NEW.order_id OR it.product_id <> NEW.product_id THEN
      RAISE EXCEPTION 'HLTR: 주문 상품이 맞지 않습니다';
    END IF;
    SELECT * INTO o FROM hlt_orders WHERE id = NEW.order_id;
    IF o.account_id <> NEW.account_id THEN
      RAISE EXCEPTION 'HLTR: 내 주문의 상품만 리뷰를 쓸 수 있습니다';
    END IF;
    IF o.status <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'HLTR: 구매확정한 주문만 리뷰를 쓸 수 있습니다 (% · %)', o.order_no, o.status;
    END IF;
  ELSE
    IF NEW.order_item_id <> OLD.order_item_id OR NEW.order_id <> OLD.order_id OR NEW.product_id <> OLD.product_id OR NEW.account_id <> OLD.account_id THEN
      RAISE EXCEPTION 'HLTR: 리뷰의 주문 · 상품 · 쓴 사람은 바꿀 수 없습니다';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF TG_OP = 'INSERT' OR NEW.body IS DISTINCT FROM OLD.body THEN
    SELECT * INTO hit FROM public.fn_check_banned_words(NEW.body, 'HLT') LIMIT 1;
    IF hit.word IS NOT NULL THEN
      IF NEW.state = 'VISIBLE' THEN NEW.state := 'PENDING'; END IF;
      NEW.hold_word := hit.word;
    ELSIF TG_OP = 'UPDATE' AND OLD.state = 'PENDING' AND OLD.decided_at IS NULL AND NEW.state = 'PENDING' THEN
      NEW.state := 'VISIBLE'; NEW.hold_word := NULL;       -- 걸린 말을 고쳐 쓰면 바로 보임
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_review_guard ON hlt_reviews;
CREATE TRIGGER trg_hlt_review_guard BEFORE INSERT OR UPDATE ON hlt_reviews FOR EACH ROW EXECUTE FUNCTION fn_hlt_review_guard();

/* 반품으로 닫힌 주문의 리뷰는 가림(지우지 않음) */
CREATE OR REPLACE FUNCTION public.fn_hlt_review_on_return() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'RETURNED' AND OLD.status IS DISTINCT FROM 'RETURNED' THEN
    UPDATE hlt_reviews SET state = 'HIDDEN', hidden_reason = '반품된 주문의 리뷰', decided_at = now()
     WHERE order_id = NEW.id AND state <> 'HIDDEN';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_review_on_return ON hlt_orders;
CREATE TRIGGER trg_hlt_review_on_return AFTER UPDATE OF status ON hlt_orders FOR EACH ROW EXECUTE FUNCTION fn_hlt_review_on_return();

CREATE TABLE IF NOT EXISTS hlt_qna (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES hlt_products(id) ON DELETE RESTRICT,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  body          text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 5 AND 1000),
  is_private    boolean NOT NULL DEFAULT false,
  state         text NOT NULL DEFAULT 'VISIBLE' CHECK (state IN ('VISIBLE','HIDDEN')),
  hidden_reason text,
  answer        text CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 2 AND 2000),
  answered_by   uuid REFERENCES accounts(id),
  answered_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_qna_answer CHECK ((answer IS NULL) = (answered_at IS NULL)),
  CONSTRAINT ck_hlt_qna_hidden CHECK (state <> 'HIDDEN' OR btrim(coalesce(hidden_reason,'')) <> '')
);
CREATE INDEX IF NOT EXISTS idx_hlt_qna_product ON hlt_qna (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hlt_qna_open ON hlt_qna (created_at) WHERE answer IS NULL AND state = 'VISIBLE';

/* 상품마다 별점 평균 · 리뷰 수(보이는 리뷰만) */
CREATE OR REPLACE VIEW public.v_hlt_review_stats AS
 SELECT product_id, count(*)::int AS review_count, round(avg(rating)::numeric, 1) AS rating_avg,
        count(*) FILTER (WHERE rating = 5)::int AS r5, count(*) FILTER (WHERE rating = 4)::int AS r4,
        count(*) FILTER (WHERE rating = 3)::int AS r3, count(*) FILTER (WHERE rating = 2)::int AS r2,
        count(*) FILTER (WHERE rating = 1)::int AS r1
   FROM hlt_reviews WHERE state = 'VISIBLE' GROUP BY product_id;

/* 운영 확인 대기가 오래 남지 않게 — 하루 넘게 PENDING 이면 운영 경보 대상(위험 규칙에서 씀) */
CREATE OR REPLACE VIEW public.v_hlt_review_pending_overdue AS
 SELECT id, product_id, created_at FROM hlt_reviews WHERE state = 'PENDING' AND decided_at IS NULL AND created_at < now() - interval '1 day';
