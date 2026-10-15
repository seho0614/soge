-- v10.31 (w2 · 10/10 「시안 기준」) — 사고예방 「피해 사례 게시판」 · 안전거래(B-04) · 공급자(업체) 단위 목록
--
--   ① 피해 사례 게시판(시안 SB-MNY-SAF-010): 유형 탭 5(계약사기 · 대금사기 · 물품/서비스 사기 · 개인정보/보이스피싱 · 기타 사기) ·
--      번호 · 지역 · 등록일 · 조회수 · 「피해 사례 작성하기」. 쓴 사람은 내보내지 않고, 본문의 연락처 · 이메일 · 계좌번호는 저장 전에 가립니다(서버).
--      특정인을 지목하는 글이 될 수 있어 운영이 숨길 수 있습니다(HIDDEN · 사유).
--   ② 안전거래(시안 「안전거래 이용 안내 — 5,000만원 이상 거래에서 양측이 합의하면 이용(B-04)」):
--      **대금은 여전히 당사자끼리 주고받습니다**(시안 같은 칸의 「소개뱅크는 대금을 받지도 보관하지도 않습니다」 · INV-11).
--      안전거래 = 양측 합의로 그 거래에 「당사자 확인 절차 · 분쟁 지원 · 기록 보존」을 거는 것 — 기준 금액은 사이트 설정(safe_trade.min_amount).
--   ③ 공급자(업체) 단위: 소개장터 메인 「서비스 업체 추천」 · 「AI 추천 맞춤 공급자」 카드와 업체 프로필.
--      업체 = 그 관에 게시 중인 매물이 있는 **인증 사업자**. 평점 · 후기 수 · 성사 · 신뢰도는 모두 기록에서 계산합니다.

-- ① 피해 사례 -------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.safety_case_no_seq START 1;
CREATE TABLE IF NOT EXISTS public.safety_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_no           bigint NOT NULL DEFAULT nextval('public.safety_case_no_seq') UNIQUE,
  type_code         text NOT NULL CHECK (type_code IN ('CONTRACT','PAYMENT','GOODS','PRIVACY','ETC')),
  title             text NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 80),
  body              text NOT NULL CHECK (length(btrim(body)) BETWEEN 20 AND 3000),
  region_code       text REFERENCES public.regions(code),
  author_account_id uuid NOT NULL REFERENCES public.accounts(id),
  view_count        int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','HIDDEN')),
  hidden_reason     text,
  hidden_by         uuid REFERENCES public.accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'HIDDEN' OR hidden_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_safety_cases_pub ON public.safety_cases (type_code, created_at DESC) WHERE status = 'PUBLISHED';
COMMENT ON TABLE public.safety_cases IS
  'v10.31 — 사고예방 「피해 사례 게시판」. 작성자는 공개하지 않습니다. 연락처 · 이메일 · 계좌는 저장 전에 가립니다(SafetyService.mask). 하루 3건까지(작성자 기준).';
INSERT INTO public.code_labels (domain, code, label, short_label, sort_order) VALUES
  ('safety.case_type','CONTRACT','계약사기','계약사기',1), ('safety.case_type','PAYMENT','대금사기','대금사기',2),
  ('safety.case_type','GOODS','물품/서비스 사기','물품/서비스',3), ('safety.case_type','PRIVACY','개인정보/보이스피싱','개인정보',4),
  ('safety.case_type','ETC','기타 사기','기타',5)
ON CONFLICT (domain, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_safety_case_rate()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF (SELECT count(*) FROM public.safety_cases WHERE author_account_id = NEW.author_account_id
        AND created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'SAFETY_CASE_RATE: 피해 사례는 하루 3건까지 올릴 수 있습니다.';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_safety_case_rate ON public.safety_cases;
CREATE TRIGGER trg_safety_case_rate BEFORE INSERT ON public.safety_cases FOR EACH ROW EXECUTE FUNCTION public.fn_safety_case_rate();
DROP TRIGGER IF EXISTS trg_safety_case_banned ON public.safety_cases;

-- ② 안전거래 ---------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description) VALUES
  ('safe_trade.min_amount', '50000000', 'GLOBAL', 'v10.31 — 안전거래(B-04)를 쓸 수 있는 거래 금액 하한(원). 시안 「5,000만원 이상 거래에서 양측이 합의하면 이용」.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.deal_safe_trades (
  deal_id          uuid PRIMARY KEY REFERENCES public.deals(id) ON DELETE CASCADE,
  amount           numeric(16,0) NOT NULL CHECK (amount >= 0),
  buyer_agreed_at  timestamptz,
  seller_agreed_at timestamptz,
  active_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.deal_safe_trades IS
  'v10.31 — 안전거래(B-04) 합의. 양측이 합의하면 active_at 이 찍히고 그 거래는 당사자 확인 · 분쟁 지원 · 기록 보존 대상입니다. 대금은 플랫폼이 받지 않습니다(INV-11). 금액 = 계약 조건의 합의 금액.';

CREATE OR REPLACE FUNCTION public.fn_safe_trade_guard()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_min numeric;
BEGIN
  SELECT nullif(value,'')::numeric INTO v_min FROM public.site_settings WHERE key = 'safe_trade.min_amount';
  IF NEW.amount < coalesce(v_min, 50000000) THEN
    RAISE EXCEPTION 'SAFE_TRADE_AMOUNT: 안전거래는 % 원 이상 거래에서 쓸 수 있습니다.', to_char(coalesce(v_min, 50000000), 'FM999,999,999,990');
  END IF;
  IF NEW.buyer_agreed_at IS NOT NULL AND NEW.seller_agreed_at IS NOT NULL AND NEW.active_at IS NULL THEN
    NEW.active_at := now();
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_safe_trade_guard ON public.deal_safe_trades;
CREATE TRIGGER trg_safe_trade_guard BEFORE INSERT OR UPDATE ON public.deal_safe_trades
  FOR EACH ROW EXECUTE FUNCTION public.fn_safe_trade_guard();

-- ③ 공급자 -----------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_suppliers AS
SELECT b.id AS supplier_id, b.account_id, l.gwan_code,
       b.company_name,
       r.sido, nullif(split_part(btrim(coalesce(b.sigungu,'')), ' ', 1), '') AS sigungu,
       fn_sido_code(b.sido) AS sido_code,
       count(l.id)::int AS listing_count,
       (array_agg(c.name ORDER BY l.like_count DESC, l.published_at DESC))[1] AS main_category,
       array_agg(DISTINCT c.id) AS category_ids,
       (array_agg(l.id ORDER BY l.like_count DESC, l.published_at DESC))[1] AS top_listing_id,
       (array_agg(l.summary ORDER BY l.like_count DESC, l.published_at DESC) FILTER (WHERE l.summary IS NOT NULL))[1] AS summary,
       max(l.published_at) AS last_published_at,
       ops.rating, ops.review_count, ops.confirmed_deals,
       t.score AS trust_score
  FROM public.businesses b
  JOIN public.listings l ON l.owner_account_id = b.account_id AND l.status = 'PUBLISHED' AND NOT l.is_priority_exposed
  JOIN public.categories c ON c.id = l.category_id AND c.restricted_code IS NULL
  LEFT JOIN public.regions r ON r.code = fn_sido_code(b.sido)
  JOIN public.v_owner_public_stats ops ON ops.account_id = b.account_id
  JOIN public.v_account_trust t ON t.account_id = b.account_id
 WHERE b.verified_at IS NOT NULL
 GROUP BY b.id, l.gwan_code, r.sido, ops.rating, ops.review_count, ops.confirmed_deals, t.score;
COMMENT ON VIEW public.v_suppliers IS
  'v10.31 — 공급자(업체) 단위. 그 관에 게시 중인(광고 슬롯이 아닌) 매물이 있는 인증 사업자. 제한 업종 매물은 세지 않습니다. 업체 프로필 · 업체 추천 · AI 추천이 이 뷰를 씁니다. 대표 · 연락처 · 사업자번호는 넣지 않습니다.';
