-- v10.31 (w2 · 10/10 「시안 기준」) — 성공현황 · 베스트매칭 · 최근 연결 사례
--
--   시안 소개장터 퀵메뉴 「성공현황」(숫자 5칸 · 추이 · 분류별 비중 · Top 소개왕 · 최근 성공 사례 · 회원/상품/지역 탭) ·
--   「베스트매칭」(1위 큰 카드 · 거래금액 · 소개비 · 성사기간 · 이유 · 매도자 한마디 · 매칭 과정 5단계 · 다른 사례) ·
--   소개장터 메인 「최근 실제 연결 사례」를 **성사된 거래(deals)에서 계산**합니다. 숫자를 저장해 두지 않습니다.
--
--   · 성사 = 거래 상태 CONFIRMED · SETTLED(INV-4 — 양측 확인 또는 7일 자동 확정).
--   · 거래금액 = 그 거래의 계약 조건(deal_contracts.terms.amount — 양측이 합의한 금액). 계약서가 없으면 「비공개」(null).
--   · 소개 수익 = 합의 소개비(deals.agreed_fee). 소개비 금지 업종(보험 · 의료 …)과 부동산 노출료(A-07)는 0 입니다.
--   · 공개 범위(가림 규칙): 사람 이름은 첫 글자만(김○○) · 업체명은 인증 사업자만 · 개인 소개자의 누적 수익은
--     본인이 「수익 공개」를 켠 경우에만(v_owner_public_stats 와 같은 규칙) · 계정 id · 연락처는 내보내지 않습니다.
--   · 베스트매칭 사례는 운영이 고르고(success_stories), **매도자 · 매수자 두 사람이 모두 공개에 동의**해야 공개됩니다.

/* 성사된 거래 한 줄 — 관 · 분류 · 지역 · 금액 · 날짜 */
CREATE OR REPLACE VIEW public.v_success_deals AS
SELECT d.id AS deal_id,
       coalesce(l.gwan_code, rq.gwan_code)            AS gwan_code,
       coalesce(l.category_id, rq.category_id)        AS category_id,
       c.name                                          AS category_name,
       c.gwan_code                                     AS category_gwan,
       d.listing_id, d.request_id,
       coalesce(l.title, rq.title)                     AS title,
       d.seller_account_id, d.buyer_account_id, d.introducer_account_id,
       coalesce(d.agreed_fee, 0)::numeric              AS fee,
       ct.amount                                       AS trade_amount,
       d.created_at, d.confirmed_at,
       greatest(1, ceil(extract(epoch FROM (d.confirmed_at - coalesce(l.published_at, d.created_at))) / 86400))::int AS days,
       vr.sido_code, vr.sido, vr.sigungu
  FROM public.deals d
  LEFT JOIN public.listings l  ON l.id = d.listing_id
  LEFT JOIN public.requests rq ON rq.id = d.request_id
  LEFT JOIN public.categories c ON c.id = coalesce(l.category_id, rq.category_id)
  LEFT JOIN public.v_listing_region vr ON vr.listing_id = d.listing_id
  LEFT JOIN LATERAL (
    SELECT nullif(x.terms->>'amount','')::numeric AS amount FROM public.deal_contracts x
     WHERE x.deal_id = d.id AND x.state IN ('AGREED','SIGNED','FULFILLED') AND x.terms ? 'amount'
     ORDER BY x.updated_at DESC LIMIT 1) ct ON true
 WHERE d.status IN ('CONFIRMED','SETTLED') AND d.confirmed_at IS NOT NULL;
COMMENT ON VIEW public.v_success_deals IS
  'v10.31 — 성사된 거래(CONFIRMED · SETTLED). 성공현황 · 베스트매칭 · 연결 사례가 이 뷰만 읽습니다. 성사기간(days) = 매물 게시일(없으면 거래 생성일)부터 확정일까지.';

/* 매칭 과정 — 실제 기록의 시각(없는 단계는 null) */
CREATE OR REPLACE FUNCTION public.fn_deal_timeline(p_deal uuid)
RETURNS TABLE(step int, code text, label text, at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH d AS (SELECT * FROM public.deals WHERE id = p_deal),
  l AS (SELECT l.* FROM public.listings l JOIN d ON d.listing_id = l.id),
  rq AS (SELECT r.* FROM public.requests r JOIN d ON d.request_id = r.id),
  cv AS (SELECT c.created_at FROM public.conversations c JOIN d ON d.conversation_id = c.id),
  ct AS (SELECT min(coalesce(x.signed_by_buyer_at, x.agreed_by_buyer_at, x.issued_at)) AS at
           FROM public.deal_contracts x JOIN d ON d.id = x.deal_id WHERE x.state <> 'CANCELLED'),
  pay AS (SELECT min(p.reported_at) AS at FROM public.deal_payment_records p JOIN d ON d.id = p.deal_id)
  SELECT * FROM (VALUES
    (1, 'REGISTERED', '등록',        coalesce((SELECT published_at FROM l), (SELECT created_at FROM rq))),
    (2, 'INQUIRY',    '문의 · 연결', coalesce((SELECT created_at FROM cv), (SELECT created_at FROM d))),
    (3, 'CONTRACT',   '조건 협의 · 계약', (SELECT at FROM ct)),
    (4, 'PAYMENT',    '대금 지급 기록',   (SELECT at FROM pay)),
    (5, 'CONFIRMED',  '성사 확정',   (SELECT confirmed_at FROM d))
  ) v(step, code, label, at)
$$;

/* 베스트매칭 사례 — 운영이 고르고 두 당사자가 동의해야 공개 */
CREATE SEQUENCE IF NOT EXISTS public.success_story_no_seq START 1;
CREATE TABLE IF NOT EXISTS public.success_stories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_no         bigint NOT NULL DEFAULT nextval('public.success_story_no_seq') UNIQUE,
  deal_id          uuid NOT NULL UNIQUE REFERENCES public.deals(id),
  gwan_code        text NOT NULL REFERENCES public.gwans(code),
  headline         text NOT NULL CHECK (length(btrim(headline)) BETWEEN 5 AND 80),
  summary          text CHECK (summary IS NULL OR length(btrim(summary)) BETWEEN 5 AND 200),
  reasons          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(reasons) <= 5),
  seller_comment   text CHECK (seller_comment IS NULL OR length(btrim(seller_comment)) BETWEEN 5 AND 300),
  seller_rating    smallint CHECK (seller_rating IS NULL OR seller_rating BETWEEN 1 AND 5),
  seller_consent_at timestamptz,
  buyer_consent_at  timestamptz,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','HIDDEN')),
  sort_rank        int NOT NULL DEFAULT 100,
  created_by       uuid NOT NULL REFERENCES public.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_success_stories_pub ON public.success_stories (gwan_code, sort_rank, published_at DESC) WHERE status = 'PUBLISHED';
COMMENT ON TABLE public.success_stories IS
  'v10.31 — 베스트매칭 사례(시안 SB-MNY-BST-010). 숫자(거래금액 · 소개비 · 성사기간 · 과정)는 저장하지 않고 v_success_deals · fn_deal_timeline 에서 읽습니다. 운영이 고른 이유 · 매도자 한마디만 저장합니다. 두 당사자 동의 전에는 공개할 수 없습니다(fn_success_story_guard).';

CREATE OR REPLACE FUNCTION public.fn_success_story_guard()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE d record;
BEGIN
  SELECT * INTO d FROM public.deals WHERE id = NEW.deal_id;
  IF d.status NOT IN ('CONFIRMED','SETTLED') THEN
    RAISE EXCEPTION 'STORY_DEAL_NOT_CONFIRMED: 성사 확정된 거래만 사례로 올릴 수 있습니다.';
  END IF;
  IF NEW.status = 'PUBLISHED' AND (NEW.seller_consent_at IS NULL OR NEW.buyer_consent_at IS NULL) THEN
    RAISE EXCEPTION 'STORY_CONSENT_REQUIRED: 매도자 · 매수자 두 분이 모두 공개에 동의해야 공개합니다.';
  END IF;
  IF NEW.status = 'PUBLISHED' AND (TG_OP = 'INSERT' OR OLD.status <> 'PUBLISHED') THEN NEW.published_at := now(); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_success_story_guard ON public.success_stories;
CREATE TRIGGER trg_success_story_guard BEFORE INSERT OR UPDATE ON public.success_stories
  FOR EACH ROW EXECUTE FUNCTION public.fn_success_story_guard();

/* 가림 — 사람 이름은 첫 글자만 */
CREATE OR REPLACE FUNCTION public.fn_mask_name(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN '회원' ELSE left(btrim(p), 1) || '○○' END
$$;
