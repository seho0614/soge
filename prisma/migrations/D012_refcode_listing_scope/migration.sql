-- =====================================================================
-- D012 — 소개코드를 매물별로 (2026-10-02 사장님 결정 「매물별로」 · 「관리자 지정」)
--
--   전에는 코드가 매물에 묶이지 않았습니다(listingId 는 받기만 하고 저장하지 않음).
--   코드 1개로 모든 매물을 계속 소개할 수 있어, 월 무료분 · 추가 결제가 「새 코드」만 제한했고
--   A 매물을 소개한 사람이 B 매물 거래의 소개자로 붙을 수 있었습니다.
--
--   이 파일이 만드는 것
--     1. site_settings  refcode.scope   listing(기본 — 매물마다 코드가 따로) | all(매물에 묶지 않음 — 전 동작)
--                                        운영 BO 「사이트 설정」에서 바꿉니다(PATCH /admin/site-settings · 형식 검사).
--     2. referral_codes.listing_id      그 코드가 소개하는 매물. NULL = 옛 코드 · scope=all 로 받은 코드(모든 매물)
--        uq_refcode_owner_listing_live  같은 회원 · 같은 매물의 살아 있는(폐기 안 된) 코드는 1개
--     3. trg_refcode_listing_guard      매물에 묶인 코드는 게시 중인 매물 · 소개 가능한 업종 · 남의 매물에만
--        trg_refcode_immutable          코드 · 주인 · 매물은 발급 뒤 바꿀 수 없습니다(판정 재현성)
--     4. fn_attribution_resolve_listing 매물용 귀속 판정 — 그 매물에 묶인 코드의 유입과 매물에 안 묶인 코드의 유입만 봅니다.
--                                        본인 코드 유입 · 소개 금지 업종 매물은 판정에서 뺍니다.
--        fn_assert_attribution_snapshot 성사 확정 시점의 판정도 같은 함수를 씁니다(거래 생성 때와 어긋나지 않게).
--     5. v_deal_refcode_listing_mismatch 감시 뷰 — 다른 매물에 묶인 코드가 귀속된 거래. **0이어야 정상**.
--
--   바꾸지 않는 것
--     · fn_attribution_resolve(계정 단위 판정) — 그대로 둡니다. 매물이 없는 판정 · 기존 검정이 씁니다.
--     · 유입 기록(attribution_events) — 코드만 남깁니다. 어느 매물 화면으로 들어왔든 기록되고 판정에서 걸러집니다.
--     · 월 무료분 계산 · 추가 결제(D010 · D011) · INV-8.
--
--   재실행 안전 — IF NOT EXISTS · ON CONFLICT · CREATE OR REPLACE · DROP … IF EXISTS 만 씁니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 운영 설정
-- ---------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('refcode.scope', 'listing', 'GLOBAL',
   '소개코드 범위. listing = 매물마다 코드가 따로(같은 매물은 다시 눌러도 같은 코드 · 월 무료분은 새 매물 기준) · all = 코드 하나로 모든 매물(매물에 묶지 않음). 운영이 바꿉니다. 이미 발급된 코드는 바뀌지 않습니다.',
   '^(listing|all)$', 'listing')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. 코드 ↔ 매물
-- ---------------------------------------------------------------------
ALTER TABLE public.referral_codes
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES public.listings(id);
COMMENT ON COLUMN public.referral_codes.listing_id IS
  '이 코드가 소개하는 매물(D012). NULL = 옛 코드 · refcode.scope=all 로 받은 코드 — 모든 매물에 통합니다.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_refcode_owner_listing_live
  ON public.referral_codes (owner_account_id, listing_id)
  WHERE listing_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refcodes_listing
  ON public.referral_codes (listing_id) WHERE listing_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. 매물에 묶인 코드의 발급 규칙 · 불변
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_refcode_listing_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record;
BEGIN
  IF NEW.listing_id IS NULL THEN RETURN NEW; END IF;

  SELECT status, owner_account_id, category_id INTO l FROM public.listings WHERE id = NEW.listing_id;
  IF l IS NULL THEN
    RAISE EXCEPTION 'REFCODE: 없는 매물입니다';
  END IF;
  IF l.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'REFCODE: 게시 중인 매물에만 소개코드를 받을 수 있습니다';
  END IF;
  IF l.owner_account_id = NEW.owner_account_id THEN
    RAISE EXCEPTION 'REFCODE: 본인 매물에는 소개코드를 받을 수 없습니다';
  END IF;
  IF l.category_id IS NOT NULL AND public.fn_category_no_intro(l.category_id) THEN
    RAISE EXCEPTION 'REFCODE: 보험·의료 매물에는 소개자를 둘 수 없습니다 (의료법 27조 · 보험업법)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_refcode_listing_guard ON public.referral_codes;
CREATE TRIGGER trg_refcode_listing_guard BEFORE INSERT ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.fn_refcode_listing_guard();

/* 판정(fn_attribution_resolve_listing)은 코드의 매물 · 주인을 봅니다. 발급 뒤에 바뀌면 같은 시점 · 같은 정책으로
 * 다시 판정해도 결과가 달라집니다 — 분쟁에서 증명할 수 없게 됩니다. 폐기(revoked_at) · 만료 · 메모는 바꿀 수 있습니다. */
CREATE OR REPLACE FUNCTION public.fn_refcode_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code
     OR NEW.owner_account_id IS DISTINCT FROM OLD.owner_account_id
     OR NEW.listing_id IS DISTINCT FROM OLD.listing_id THEN
    RAISE EXCEPTION 'REFCODE: 소개코드의 코드 · 주인 · 매물은 발급 뒤 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_refcode_immutable ON public.referral_codes;
CREATE TRIGGER trg_refcode_immutable BEFORE UPDATE ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.fn_refcode_immutable();

-- ---------------------------------------------------------------------
-- 4. 매물용 귀속 판정
--
--    fn_attribution_resolve 와 같은 규칙(정책의 채널 · 기간 · first/last touch · 동시각 id 순)에 세 가지를 더합니다.
--      ① 코드가 매물에 묶여 있으면 **그 매물의 거래에만** 통합니다. 매물에 안 묶인 코드(옛 코드 · scope=all)와
--         referral_codes 에 없는 코드(광고 귀속 등)는 전처럼 모든 매물에 통합니다.
--      ② 본인 코드로 본인이 들어온 유입은 뺍니다(자기 거래의 소개자가 자기가 되지 않게).
--      ③ 소개 금지 업종(보험 · 의료) 매물은 소개자가 없습니다.
--    같은 (계정 · 매물 · 시점 · 정책)이면 항상 같은 결과입니다 — 코드의 매물 · 주인은 바뀌지 않습니다(trg_refcode_immutable).
--    p_listing_id 가 NULL(요청 기반 거래 등)이면 매물에 안 묶인 코드만 봅니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_attribution_resolve_listing(
  p_account_id uuid, p_listing_id uuid, p_at timestamptz, p_policy integer DEFAULT 1)
RETURNS TABLE(event_id bigint, code text, occurred_at timestamptz, channel text)
LANGUAGE plpgsql STABLE AS $$
DECLARE pol record;
BEGIN
  SELECT * INTO pol FROM attribution_policies WHERE version = p_policy;
  IF pol IS NULL THEN RAISE EXCEPTION 'unknown attribution policy %', p_policy; END IF;

  IF p_listing_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM listings l WHERE l.id = p_listing_id
          AND l.category_id IS NOT NULL AND fn_category_no_intro(l.category_id)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT e.id, e.code, e.occurred_at, e.channel
    FROM attribution_events e
    LEFT JOIN referral_codes rc ON rc.code = e.code
   WHERE e.channel = ANY (pol.allow_channels)
     AND e.occurred_at <= p_at
     AND p_at < e.occurred_at + (pol.window_days || ' days')::interval
     AND (
          e.account_id = p_account_id
       OR e.visitor_key IN (
            SELECT vi.visitor_key FROM visitor_identities vi
             WHERE vi.account_id = p_account_id
               AND vi.linked_at >= e.occurred_at   -- 유입 이후에 연결된 계정만
          )
     )
     AND (rc.listing_id IS NULL OR rc.listing_id = p_listing_id)          -- ① 매물
     AND rc.owner_account_id IS DISTINCT FROM p_account_id                 -- ② 본인 코드 제외
   ORDER BY
     CASE WHEN pol.model = 'FIRST_TOUCH' THEN e.occurred_at END ASC,
     CASE WHEN pol.model = 'LAST_TOUCH'  THEN e.occurred_at END DESC,
     e.id ASC                                     -- 동시각 tie-break: 재현성 보장
   LIMIT 1;
END $$;
COMMENT ON FUNCTION public.fn_attribution_resolve_listing(uuid, uuid, timestamptz, integer) IS
  '매물용 귀속 판정(D012). 그 매물에 묶인 코드와 매물에 안 묶인 코드의 유입만 봅니다. 본인 코드 · 소개 금지 업종 매물 제외.';

/* 성사 확정 때의 판정 — 거래 생성 때와 같은 함수를 씁니다.
 * 전에는 계정 단위 판정(fn_attribution_resolve)이라, 매물별 코드가 생기면 확정 시점에 **다른 매물 코드의 유입**이
 * 근거로 찍힐 수 있었습니다(소개자는 A 매물 코드 주인인데 귀속 코드는 B 매물 코드). 나머지 동작은 그대로입니다. */
CREATE OR REPLACE FUNCTION public.fn_assert_attribution_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ev record; pol int;
BEGIN
  IF NEW.status = 'CONFIRMED' AND OLD.status IS DISTINCT FROM 'CONFIRMED'
     AND NEW.introducer_account_id IS NOT NULL THEN

    IF NEW.attributed_event_id IS NULL THEN
      SELECT version INTO pol FROM attribution_policies
       WHERE effective_from <= NEW.created_at
       ORDER BY effective_from DESC LIMIT 1;

      SELECT * INTO ev
        FROM fn_attribution_resolve_listing(NEW.buyer_account_id, NEW.listing_id, NEW.created_at, pol);

      IF ev.event_id IS NULL THEN
        RAISE EXCEPTION
          'INV-2 violated: 귀속 근거가 없습니다. 소개자를 지정할 수 없습니다 (deal %)', NEW.id;
      END IF;

      NEW.attributed_event_id          := ev.event_id;
      NEW.attributed_code              := ev.code;
      NEW.attributed_at                := now();
      NEW.attribution_policy_version   := pol;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 5. 감시 뷰 — 다른 매물에 묶인 코드가 귀속된 거래. **0이어야 정상**.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_deal_refcode_listing_mismatch AS
SELECT d.id AS deal_id, d.listing_id AS deal_listing_id, d.attributed_code, rc.listing_id AS code_listing_id,
       d.introducer_account_id, d.created_at
  FROM deals d
  JOIN referral_codes rc ON rc.code = d.attributed_code
 WHERE rc.listing_id IS NOT NULL
   AND rc.listing_id IS DISTINCT FROM d.listing_id;
COMMENT ON VIEW public.v_deal_refcode_listing_mismatch IS
  '귀속 코드가 다른 매물에 묶여 있는 거래(D012). **0이어야 정상** — A 매물 코드로 들어온 사람의 B 매물 거래에는 소개자가 붙지 않습니다.';
