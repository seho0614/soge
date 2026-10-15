-- =====================================================================
-- D023 — 매물 상세의 소개자 실적 · 후기 · 누적수익 공개 설정 (2026-10-07 · v10.21)
--
--   10/7 사장님 지시 — 매물 상세를 「그림과 같은 형식」으로(소개자 실적 · 후기 · 맨 아래 줄) · 실제 웹에도 적용.
--   누적수익(그 회원이 정산받은 소개비 합계)은 **본인이 켠 경우에만 공개**(10/7 답).
--
--   넣는 것
--     ① accounts.earnings_public — 누적수익 공개 여부. 기본 false(숨김).
--     ② v_owner_public_stats — 등록자의 공개 실적. 누적수익은 이 뷰가 가립니다(공개를 켜지 않았으면 null).
--        상세 API 는 이 뷰만 읽습니다 — 다른 조회가 생겨도 같은 규칙을 탑니다.
--     ③ 후기(deal_reviews) 규칙 — 성사 확정된 거래 · 거래 당사자(구매자 · 판매자)만 · 대상은 그 거래의 소개자 또는 상대방.
--        API 를 거치지 않는 경로도 같은 규칙을 탑니다. 쓴 후기의 거래 · 작성자 · 대상은 바꿀 수 없습니다.
--        (찾은 것) 후기 작성 API 가 대상(target_id)을 넣지 않아 늘 실패했습니다 → 코드에서 고침. 여기서는 그 뒤의 규칙을 둡니다.
--     ④ 후기 조회 색인.
--
--   기존 마이그레이션은 고치지 않습니다. 재실행 안전.
-- =====================================================================

-- 1. 누적수익 공개 여부 ---------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS earnings_public boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.earnings_public IS
  '누적수익(정산받은 소개비 합계)을 매물 상세의 소개자 실적에 공개할지. 본인이 마이 > 내 정보에서 켭니다. 기본 false — 켜지 않으면 어디에도 나가지 않습니다(v_owner_public_stats)';

-- 2. 등록자의 공개 실적 ---------------------------------------------------
--    총 소개 · 성사 · 성사율은 누구에게나, 누적수익은 공개를 켠 회원만. 후기 수 · 평균 평점을 함께 냅니다.
CREATE OR REPLACE VIEW public.v_owner_public_stats AS
 SELECT a.id                                   AS account_id,
        a.created_at                           AS joined_at,
        a.earnings_public,
        COALESCE(st.total_deals, 0)::integer     AS total_deals,
        COALESCE(st.confirmed_deals, 0)::integer AS confirmed_deals,
        CASE WHEN COALESCE(st.total_deals, 0) > 0
             THEN round(st.confirmed_deals::numeric * 100 / st.total_deals, 1) END AS success_rate,
        CASE WHEN a.earnings_public THEN COALESCE(st.settled_amount, 0) END        AS settled_amount,
        COALESCE(rv.n, 0)::integer             AS review_count,
        rv.avg_rating                          AS rating
   FROM public.accounts a
   LEFT JOIN public.v_introducer_stats st ON st.account_id = a.id
   LEFT JOIN LATERAL (
        SELECT count(*) AS n, round(avg(r.rating)::numeric, 1) AS avg_rating
          FROM public.deal_reviews r
         WHERE r.target_id = a.id) rv ON true;

COMMENT ON VIEW public.v_owner_public_stats IS
  '매물 상세에 내보내는 등록자의 공개 실적. settled_amount 는 accounts.earnings_public 이 true 일 때만 값이 있습니다(아니면 null) — 가리는 일을 이 뷰가 합니다';

-- 3. 후기 규칙 ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_assert_review_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  d record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.deal_id IS DISTINCT FROM OLD.deal_id OR NEW.author_id IS DISTINCT FROM OLD.author_id
       OR NEW.target_id IS DISTINCT FROM OLD.target_id THEN
      RAISE EXCEPTION 'REVIEW_RULE: 후기의 거래 · 작성자 · 대상은 바꿀 수 없습니다';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status, buyer_account_id AS buyer, seller_account_id AS seller, introducer_account_id AS introducer
    INTO d FROM public.deals WHERE id = NEW.deal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVIEW_RULE: 거래를 찾을 수 없습니다';
  END IF;
  IF d.status NOT IN ('CONFIRMED', 'SETTLED') THEN
    RAISE EXCEPTION 'REVIEW_RULE: 성사가 확정된 거래에만 후기를 남길 수 있습니다 (INV-5)';
  END IF;
  IF NEW.author_id IS DISTINCT FROM d.buyer AND NEW.author_id IS DISTINCT FROM d.seller THEN
    RAISE EXCEPTION 'REVIEW_RULE: 거래 당사자(구매자 · 판매자)만 후기를 남길 수 있습니다';
  END IF;
  IF NEW.target_id = NEW.author_id
     OR (NEW.target_id IS DISTINCT FROM d.buyer AND NEW.target_id IS DISTINCT FROM d.seller
         AND NEW.target_id IS DISTINCT FROM d.introducer) THEN
    RAISE EXCEPTION 'REVIEW_RULE: 후기 대상은 그 거래의 소개자 또는 상대방이어야 합니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_review_rules ON public.deal_reviews;
CREATE TRIGGER trg_review_rules BEFORE INSERT OR UPDATE ON public.deal_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_review_rules();

-- 4. 색인 -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_deal_reviews_target ON public.deal_reviews (target_id, created_at DESC);
