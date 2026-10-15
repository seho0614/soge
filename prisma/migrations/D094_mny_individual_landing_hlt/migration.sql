-- =====================================================================
-- D094 — v10.36 (2026-10-12 대표 지시)
--
--   ① 소개장터(MNY)는 판매 등록을 제한하지 않습니다 — 개인 회원도 등록합니다.
--      안심소개(MAL) · 소개창업(BIZ)은 그대로 인증 사업자만입니다.
--      두 게이트(fn_listing_seller_gate · fn_listing_requires_business)에 MNY 예외 한 줄씩만 더합니다.
--      나머지 판정은 B075 그대로이고, 개인에게 보이는 SELLER 문구만 「소개장터는 개인도 등록」에 맞게 고칩니다.
--      API 는 등록 · 수정 · 내리기 · 사진 · 문의 답변을 개인 회원(MEMBER)에게도 열고, 관 규칙은 이 게이트가 판정합니다.
--
--   ② 운영 화면 「로그인 후 첫 화면」에서 소개몰(HLT)을 고르면 저장이 거부되던 결함.
--      화면은 운영 중인 관(MNY · MAL · BIZ · HLT)을 모두 보여 주는데, 설정 형식(value_pattern)에 HLT 가 빠져 있었습니다.
--      (신규 가입자 첫 화면 site.landing_new_member 형식에는 이미 HLT 가 있습니다.)
--
--   재실행 안전.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_listing_seller_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_type text; v_verified timestamptz;
BEGIN
  -- ★ 사람 소개는 개인도 할 수 있습니다.
  IF NEW.item_type = 'PERSON' THEN
    RETURN NEW;
  END IF;

  -- ★ v10.36 (D094) — 소개장터는 개인 회원도 판매 등록을 합니다(제한 없음).
  IF NEW.gwan_code = 'MNY' THEN
    RETURN NEW;
  END IF;

  SELECT account_type INTO v_type FROM accounts WHERE id = NEW.owner_account_id;

  IF v_type IS DISTINCT FROM 'BUSINESS' THEN
    RAISE EXCEPTION
      'SELLER: 안심소개 · 소개창업 판매 등록은 인증 사업자만 할 수 있습니다. '
      '개인회원은 소개장터 등록 · 사람 소개 · 소개받기 요청을 이용해 주십시오';
  END IF;

  SELECT verified_at INTO v_verified
    FROM businesses WHERE account_id = NEW.owner_account_id LIMIT 1;
  IF v_verified IS NULL THEN
    RAISE EXCEPTION 'SELLER: 사업자 인증을 마쳐야 판매 등록을 하실 수 있습니다';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_listing_requires_business() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_need boolean; v_type text; v_verified boolean;
BEGIN
  IF NEW.item_type IS NULL THEN RETURN NEW; END IF;

  -- ★ v10.36 (D094) — 소개장터는 개인 회원도 판매 등록을 합니다(제한 없음).
  IF NEW.gwan_code = 'MNY' THEN RETURN NEW; END IF;

  SELECT requires_business INTO v_need FROM item_types WHERE code = NEW.item_type;
  IF NOT coalesce(v_need, false) THEN RETURN NEW; END IF;

  -- 리스팅은 계정이 소유합니다. 그 계정이 인증 사업자인지를 봅니다.
  SELECT (a.account_type = 'BUSINESS'
          AND EXISTS (SELECT 1 FROM businesses b
                       WHERE b.account_id = a.id AND b.verified_at IS NOT NULL))
    INTO v_verified
    FROM accounts a
   WHERE a.id = NEW.owner_account_id;

  IF coalesce(v_verified, false) IS NOT TRUE THEN
    SELECT name INTO v_type FROM item_types WHERE code = NEW.item_type;
    RAISE EXCEPTION
      'INV-7: %은(는) 인증 사업자만 등록할 수 있습니다', coalesce(v_type, NEW.item_type);
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.fn_listing_seller_gate() IS
  '판매 등록 게이트. **사람 소개(item_type=PERSON)는 개인도 가능**합니다 — 물건 판매와 달리 세금계산서·하자담보 책임이 따라오지 않습니다. '
  'v10.36 (D094) — 소개장터(MNY)는 개인 회원도 판매 등록(제한 없음). 안심소개 · 소개창업은 인증 사업자만.';
COMMENT ON FUNCTION public.fn_listing_requires_business() IS
  '상품·서비스·창업 판매는 인증 사업자만. 사람·기업은 개인도 가능. 요청은 제한 없음. v10.36 (D094) — 소개장터(MNY)는 개인도 가능.';

/* ── ② 로그인 후 첫 화면 — 소개몰(HLT) 허용 ───────────────────────── */
UPDATE public.site_settings
   SET value_pattern = '^$|^(MNY|MAL|BIZ|HLT)$',
       description = '로그인 후 도착할 화면. 비우면 메인입니다. 관 코드(MNY·MAL·BIZ·HLT)를 넣으면 그 관 메인으로 갑니다 — 밀고 싶은 관이 있을 때 배포 없이 바꿉니다.'
 WHERE key = 'site.landing_after_login'
   AND value_pattern IS DISTINCT FROM '^$|^(MNY|MAL|BIZ|HLT)$';
