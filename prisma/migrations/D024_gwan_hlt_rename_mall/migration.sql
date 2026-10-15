-- =====================================================================
-- D024 — 관 표시 이름 변경: 소개뱅크몰 → 소개몰 (2026-10-07 결정 · v10.25)
--
--   사장님 결정(2026-10-07): 제시 디자인대로 메뉴 이름을 「소개몰」로 바꿉니다(「소개몰 = 소개쇼핑몰」).
--   C990(2026-09-26)이 「건강몰 → 소개뱅크몰」로 바꾼 이름을 다시 바꾸는 것입니다.
--
--   바꾸는 것 : 사람이 보는 이름 · 오류 문구 · 검색 사전 · **약관 3종의 관 이름 4줄** · 직판 고지 문구의 이름
--               · **판매 약관의 배송비 조항**(2026-10-08 결정 「시안 값 — 전 상품 무료」 · 계산은 D025)
--               (약관 · 직판 고지는 사장님 결정 2026-10-07 「약관까지 같이 고침」 — 아래 「약관 본문의 옛 이름」 참고)
--   바꾸지 않는 것 :
--     · 관 코드(HLT) · URL(/health) — C990 과 같은 이유입니다
--     · 입점 표준계약서 — 개정 절차로 따로 바꿉니다(C990 과 같은 규칙)
--
--   ★ 「소개몰」은 2026-09-26 까지 **안심소개(MAL)의 옛 이름**이었습니다. 그래서 검색 사전에 「소개몰 → 안심소개」가 들어 있습니다(C990).
--     이름이 다시 쓰이므로 그 줄을 없앱니다 — 남겨 두면 「소개몰」을 찾은 사람이 안심소개로 갑니다.
-- =====================================================================

UPDATE public.gwans SET name = '소개몰' WHERE code = 'HLT';

-- 검색 사전 — 옛 이름(소개뱅크몰 · 건강몰 · 건강상품관)으로 찾아도 소개몰로
DELETE FROM public.search_synonyms WHERE kind = 'GWAN' AND term = '소개몰';
UPDATE public.search_synonyms SET canonical = '소개몰' WHERE kind = 'GWAN' AND canonical = '소개뱅크몰';
INSERT INTO public.search_synonyms (term, canonical, kind, weight) VALUES
  ('소개뱅크몰', '소개몰', 'GWAN', 9),
  ('소개쇼핑몰', '소개몰', 'GWAN', 9)
ON CONFLICT (term, kind) DO UPDATE SET canonical = EXCLUDED.canonical;

-- ---------------------------------------------------------------------
-- 약관 본문의 옛 이름 — 10/7 결정 「약관까지 같이 고침」
--
--   C990 은 약관을 건드리지 않았습니다(「약관 개정 절차로 따로」). 그래서 본문에 옛 이름이 남아 있습니다.
--     이용약관(SERVICE)        「회사가 직접 파는 것은 건강상품관(직판) 하나뿐이며」
--     제3자 제공(THIRDPARTY)   「(둘러보기 · 커뮤니티 · 건강몰)」
--     판매 약관(HLT_SALE)      「소개머니 · 소개몰 · 소개창업   회사는 중개만 하고 당사자가 아닙니다」 「건강상품관  ★ 회사가 직접 팝니다」
--   ★ 관 이름이 「소개몰」이 되면, 판매 약관의 둘째 줄은 **「소개몰은 중개만 한다」** 로 읽힙니다(그 「소개몰」은 안심소개의 옛 이름). 뜻이 반대가 됩니다.
--
--   D014(반품 배송비 조항)와 같은 방식입니다.
--     · 아직 발행 전인 판(새 설치)  → 본문만 고칩니다. 그대로 발행됩니다.
--     · 이미 발행된 판(쓰던 DB)     → 고친 **다음 판을 만들어 발행**하고 이전 판은 보관합니다(시행 = 이 마이그레이션이 도는 시각).
--                                     필수 약관의 새 판이므로 **이미 동의한 회원은 다시 동의**하게 됩니다.
--     · 옛 이름 · 옛 배송비 조항이 없으면 건너뜁니다. 재실행 안전.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record; v_body text; v_ver text;
BEGIN
  FOR r IN
    SELECT * FROM public.terms
     WHERE status <> 'ARCHIVED'
       AND body ~ '건강상품관|건강몰|소개뱅크몰|소개머니 · 소개몰 · 소개창업|배송비를 내신 주문'
     ORDER BY code, (status = 'PUBLISHED') DESC, version
  LOOP
    v_body := r.body;
    -- 표 모양(글자 폭)을 맞춘 두 줄 먼저
    v_body := replace(v_body, '소개머니 · 소개몰 · 소개창업   회사는', '소개장터 · 안심소개 · 소개창업 회사는');
    v_body := replace(v_body, '건강상품관                    ★', '소개몰                        ★');
    v_body := replace(v_body, '소개머니 · 소개몰 · 소개창업', '소개장터 · 안심소개 · 소개창업');
    v_body := replace(v_body, '건강상품관', '소개몰');
    v_body := replace(v_body, '건강몰', '소개몰');
    v_body := replace(v_body, '소개뱅크몰', '소개몰');
    -- 배송비 조항(판매 약관) — 2026-10-08 결정: 배송비는 전 상품 무료(시안 값). 전에는 3만원 이상 무료 · 미만 3,000원.
    --   반품 왕복 6,000원(회원 사정)은 그대로입니다 — 환불 금액 표의 두 줄(무료배송 주문 · 배송비를 내신 주문)을 한 줄로 합칩니다.
    v_body := replace(v_body, '| 무료배송 주문(3만원 이상) | 결제 금액 − 6,000원 |', '| 회원 사정 반품(단순 변심 · 잘못 주문) | 결제 금액 − 6,000원 |');
    v_body := replace(v_body, E'| 배송비를 내신 주문 | 결제 금액(배송비 포함) − 6,000원 |\n', '');
    IF v_body !~ '배송비는 받지 않습니다' THEN
      v_body := replace(v_body, E'   드립니다.\n\n## 제6조', E'   드립니다.\n③ **배송비는 받지 않습니다**(전 상품 무료).\n\n## 제6조');
    END IF;
    IF v_body = r.body THEN CONTINUE; END IF;

    IF r.status <> 'PUBLISHED' THEN
      UPDATE public.terms SET body = v_body WHERE code = r.code AND version = r.version;
      RAISE NOTICE '% % (%) 초안의 관 이름을 고침', r.code, r.version, r.status;
    ELSE
      v_ver := split_part(r.version, '.', 1) || '.' || (split_part(r.version, '.', 2)::int + 1);
      WHILE EXISTS (SELECT 1 FROM public.terms WHERE code = r.code AND version = v_ver
                       AND status IN ('PUBLISHED','ARCHIVED')) LOOP
        v_ver := split_part(v_ver, '.', 1) || '.' || (split_part(v_ver, '.', 2)::int + 1);
      END LOOP;
      INSERT INTO public.terms (code, version, title, body, is_required, effective_from, status, display_order, gwan_code)
      VALUES (r.code, v_ver, r.title, v_body, r.is_required, 'infinity', 'LEGAL_REVIEW', r.display_order, r.gwan_code)
      ON CONFLICT (code, version) DO UPDATE SET body = EXCLUDED.body, title = EXCLUDED.title;
      UPDATE public.terms SET status = 'PUBLISHED', effective_from = now(), blocked_by = NULL
       WHERE code = r.code AND version = v_ver;
      UPDATE public.terms SET status = 'ARCHIVED'
       WHERE code = r.code AND version <> v_ver AND status = 'PUBLISHED';
      RAISE NOTICE '% % 발행 — 관 이름 고침 (이전 % 는 보관)', r.code, v_ver, r.version;
    END IF;
  END LOOP;
END $$;

-- 직판 고지 — 이름만 바꿉니다(「건강상품관」→「소개몰」). 운영자가 문구를 고쳐 둔 경우에는 손대지 않습니다.
--   v10.25 부터 소개몰 화면 바닥에 이 문구가 통신판매중개자 고지와 함께 나옵니다(10/7 결정 「두 고지를 같이」).
UPDATE public.site_settings
   SET value = '소개몰에서 판매하는 상품은 소개뱅크가 직접 판매합니다. 상품의 하자·배송·반품·환불에 대한 책임은 소개뱅크에 있습니다.',
       description = '직판 고지. **소개몰(쇼핑몰)에만 붙습니다** — 다른 관은 중개 고지를 씁니다. 소개몰 화면 바닥에 중개 고지와 함께 나옵니다.'
 WHERE key = 'legal.direct_notice'
   AND value = '건강상품관에서 판매하는 상품은 소개뱅크가 직접 판매합니다. 상품의 하자·배송·반품·환불에 대한 책임은 소개뱅크에 있습니다.';

-- 사용자에게 보이는 오류 문구 — 함수 본문은 C990 과 같고 문구만 다릅니다
CREATE OR REPLACE FUNCTION public.fn_hlt_product_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c record; r record;
BEGIN
  IF NEW.status NOT IN ('ON_SALE','SOLD_OUT') THEN RETURN NEW; END IF;
  IF NEW.category_id IS NULL THEN
    RAISE EXCEPTION 'HLTP: 업종을 정해야 판매할 수 있습니다';
  END IF;
  SELECT * INTO c FROM categories WHERE id = NEW.category_id;
  IF c.gwan_code <> 'HLT' THEN
    RAISE EXCEPTION 'HLTP: 소개몰 업종이 아닙니다 — 직판은 소개몰만입니다';
  END IF;
  SELECT * INTO r FROM restricted_industries
   WHERE code = c.restricted_code AND gwan_code = 'HLT' AND is_active;
  IF r.id IS NOT NULL THEN
    IF r.mode IN ('BLOCK','AD_ONLY') THEN RAISE EXCEPTION 'HLTP: %', r.block_message; END IF;
    IF r.mode = 'GATED' AND coalesce(btrim(NEW.review_no),'') = '' THEN
      RAISE EXCEPTION 'HLTP: 심의필 번호가 있어야 판매할 수 있습니다 (의료기기법 24조)';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
