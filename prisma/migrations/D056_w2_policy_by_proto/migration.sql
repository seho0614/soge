-- v10.31 (w2 · 10/10 「시안 기준」 지시 ② — 시안과 다른 정책 · 문구는 시안대로. 결정 기록: work/v3/w2_decisions.md)
--
--   ① INV-2 귀속 시점 — 시안 「1:1 대화가 시작되는 순간 소개코드가 발급되고 귀속이 시작됩니다」.
--      전에는 거래(Deal)를 만들 때 유입 기록을 보고 귀속 후보를 정했습니다. 이제 **대화를 여는 순간** 그 매물의 소개코드 유입을
--      conversations 에 찍어 두고(attributed_code · attributed_at), 거래를 만들 때 그 값을 씁니다(대화 뒤에 들어온 유입은 보지 않음).
--   ② A-07 — 안심소개 부동산(축 RE)은 「소개비가 아니라 노출료」 · 「정산이 생성되지 않습니다」.
--      부동산 매물에는 희망 소개비를 받지 않고(기존 값은 비움), 그 거래에는 소개비 약정 · 정산 줄을 만들지 않습니다.
--   ③ 안심소개 「기계 · 설비 · 시설」 축(실물자산형 · EQUIP) 분류 7개 — 시안 AX.MAL.B 그대로.
--      중개사 게이트(fn_broker_gate)는 부동산 축(RE)에만 겁니다(전에는 안심소개 전체 — 장비 매물까지 중개사 인증을 요구하게 됨).
--   ④ 「공인중개사 매물 연동」 화면 — 시안 「아직 열지 않았습니다(A-07 회신 대기)」 → 스위치 mal.broker_sync.open = off(시안).
--   ⑤ 검수 처리 시간 — 시안 「영업일 기준 24시간 이내」 → 검수 마감(review_items.sla_due_at)을 영업일(토 · 일 제외)로 계산(fn_review_sla_due).
--   ⑥ 화면 문구(ui_messages) — 귀속 · A-12 · A-07 · 검수 안내 · 고객센터 24시간 상담.
--   ⑦ 광고 칸 「관 랜딩 띠」(GBAND) — 시안 소개장터 메인의 띠 광고 자리.

-- ① 귀속 시점 --------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS attributed_code text,
  ADD COLUMN IF NOT EXISTS attributed_at   timestamptz;
COMMENT ON COLUMN public.conversations.attributed_code IS
  'v10.31 (시안 INV-2) — 대화를 연 순간의 귀속 소개코드(그 매물에 묶인 코드의 첫 유입 · fn_attribution_resolve_listing). 거래 생성은 이 값을 씁니다. 없으면 소개자 없음.';

-- ② A-07 부동산 노출료 -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_is_realty_category(p_category uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT c.gwan_code = 'MAL' AND c.axis = 'RE' FROM public.categories c WHERE c.id = p_category), false)
$$;
COMMENT ON FUNCTION public.fn_is_realty_category IS 'v10.31 — 안심소개 부동산 축(RE) 분류인가. A-07(노출료 · 정산 없음) · 중개사 게이트가 이 함수를 씁니다.';

CREATE OR REPLACE FUNCTION public.fn_realty_no_referral_fee()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.desired_fee IS NOT NULL AND fn_is_realty_category(NEW.category_id) THEN
    RAISE EXCEPTION 'RE_EXPOSURE_FEE: 부동산은 소개비가 아니라 노출료입니다 (A-07) — 희망 소개비를 비워 주십시오.';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_realty_no_referral_fee ON public.listings;
CREATE TRIGGER trg_realty_no_referral_fee BEFORE INSERT OR UPDATE OF desired_fee, category_id ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_realty_no_referral_fee();

/* 기존 부동산 매물의 희망 소개비를 비웁니다 — 다른 트리거(재검수 · 배지 회수)를 돌리지 않으려고 이 문장만 사용자 트리거를 끕니다 */
ALTER TABLE public.listings DISABLE TRIGGER USER;
UPDATE public.listings SET desired_fee = NULL WHERE desired_fee IS NOT NULL AND fn_is_realty_category(category_id);
ALTER TABLE public.listings ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION public.fn_realty_no_fee_agreement()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.deals d JOIN public.listings l ON l.id = d.listing_id
              WHERE d.id = NEW.deal_id AND fn_is_realty_category(l.category_id)) THEN
    RAISE EXCEPTION 'RE_EXPOSURE_FEE: 부동산 거래에는 소개비 약정을 만들지 않습니다 — 노출료입니다 (A-07).';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_realty_no_fee_agreement ON public.fee_agreements;
CREATE TRIGGER trg_realty_no_fee_agreement BEFORE INSERT ON public.fee_agreements
  FOR EACH ROW EXECUTE FUNCTION public.fn_realty_no_fee_agreement();

CREATE OR REPLACE FUNCTION public.fn_realty_no_settlement()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.deals d JOIN public.listings l ON l.id = d.listing_id
              WHERE d.id = NEW.deal_id AND fn_is_realty_category(l.category_id)) THEN
    RAISE EXCEPTION 'RE_NO_SETTLEMENT: 안심소개 부동산 건은 정산이 생성되지 않습니다 (A-07).';
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_realty_no_settlement ON public.settlements;
CREATE TRIGGER trg_realty_no_settlement BEFORE INSERT ON public.settlements
  FOR EACH ROW EXECUTE FUNCTION public.fn_realty_no_settlement();

-- ③ 기계 · 설비 · 시설 축 ----------------------------------------------------------
/* 직업안정법(A-14) — 실물 장비 매매 · 임대 소개라 사람을 소개하지 않습니다(NOT_APPLICABLE) */
INSERT INTO public.categories (gwan_code, code, name, status, axis, approved_at, labor_law_flag, labor_law_memo, labor_law_checked_at)
SELECT 'MAL', x.code, x.name, 'APPROVED', 'EQUIP', now(), 'NOT_APPLICABLE',
       '실물 장비 · 설비 · 시설의 매매 · 임대 · 이전 소개 — 사람(근로자)을 소개하지 않음(v10.31 시안 안심소개 축 B)', now()
  FROM (VALUES ('MAL_EQ_PLANT','발전 설비 · 플랜트',1), ('MAL_EQ_MACHINE','기계 · 설비',2), ('MAL_EQ_TRUCK','상용차 · 특장차',3),
               ('MAL_EQ_KITCHEN','주방 설비 · 집기',4), ('MAL_EQ_STORE','매장 집기 · 진열',5), ('MAL_EQ_USED','중고 장비 · 부품',6),
               ('MAL_EQ_ETC','기타 부동산 · 장비',7)) x(code, name, o)
ON CONFLICT (gwan_code, code) DO NOTHING;

/* 중개사 게이트 — 부동산 축(RE)에만. 본문은 B 판과 같습니다 */
CREATE OR REPLACE FUNCTION public.fn_broker_gate()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_owner_ok boolean; v_ready text;
BEGIN
  IF NEW.gwan_code <> 'MAL' THEN RETURN NEW; END IF;
  /* v10.31 — 기계 · 설비 · 시설(EQUIP) 축은 부동산이 아닙니다(공인중개사법 대상 아님) */
  IF NOT fn_is_realty_category(NEW.category_id) THEN RETURN NEW; END IF;

  /* ★ 초안은 통과합니다. 아직 아무에게도 안 보이므로 표시·광고가
   *   아닙니다 — 공인중개사법이 막는 것은 **표시·광고**입니다. */
  IF NEW.status <> 'PUBLISHED' THEN RETURN NEW; END IF;

  /* 중개사 인증이 있으면 통과 */
  IF fn_is_verified_broker(NEW.owner_account_id) THEN RETURN NEW; END IF;

  /* 소유자 직거래 — 등기로 확인한 매물만 */
  SELECT value INTO v_ready FROM site_settings WHERE key = 'mal.owner_direct_ready';
  IF coalesce(v_ready, 'off') = 'on' THEN
    SELECT EXISTS (SELECT 1 FROM owner_verifications o
                    WHERE o.listing_id = NEW.id AND o.state = 'VERIFIED')
      INTO v_owner_ok;
    IF v_owner_ok THEN RETURN NEW; END IF;

    RAISE EXCEPTION
      'BROKER: 소유 확인이 먼저입니다 — 등기사항증명서를 올리시면 확인 후 공개됩니다';
  END IF;

  RAISE EXCEPTION
    'BROKER: 부동산 소개는 중개사 인증이 필요합니다 (공인중개사법 18조의2 ③) — '
    '본인 소유 물건은 등기 확인 후 올리실 수 있습니다';
END $function$;

/* 부동산 표시 — 부동산 축(RE)이거나, 축이 없고 이름에 부동산 말이 든 분류(전과 같음). 장비 축은 빼요 */
CREATE OR REPLACE FUNCTION public.fn_realty_mark_kind()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_is_realty boolean;
BEGIN
  IF NEW.gwan_code <> 'MAL' THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM categories c
     WHERE c.id = NEW.category_id
       AND (c.axis = 'RE'
         OR (c.axis IS DISTINCT FROM 'EQUIP'
             AND (c.name LIKE '%부동산%' OR c.name LIKE '%상가%' OR c.name LIKE '%건물%'
               OR c.name LIKE '%토지%'  OR c.name LIKE '%점포%' OR c.name LIKE '%사무실%')))
  ) INTO v_is_realty;
  IF NOT v_is_realty THEN RETURN NEW; END IF;

  NEW.seller_kind := CASE
    WHEN fn_is_verified_broker(NEW.owner_account_id) THEN 'BROKER'
    ELSE 'OWNER' END;
  RETURN NEW;
END $function$;

-- ④ ⑥ 설정 · 문구 ---------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description) VALUES
  ('mal.broker_sync.open', 'off', 'GLOBAL',
   'v10.31 — 「공인중개사 매물 연동」(제휴 중개사무소 매물 받기) 열림. 시안: 「아직 열지 않았습니다 — A-07 법무 회신 대기」(off). 회신 뒤 운영이 on.'),
  ('support.hours', '24시간', 'GLOBAL',
   'v10.31 — 고객센터 상담 시간(시안 사고예방 「소개뱅크 고객센터 24시간 상담」). 전화번호는 footer.phone.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ui_messages (code, message, placement, basis) VALUES
  ('CTA_ATTRIBUTION', '대화가 시작되면 소개코드가 발급됩니다', '상세 화면 「1:1 문의 시작」 단추 아래', 'INV-2 귀속 안내 — 10/10 시안 기준'),
  ('CTA_ATTRIBUTION_NOTE', '1:1 대화가 시작되는 순간 소개코드가 발급되고 귀속이 시작됩니다 (INV-2). 전화나 외부 연락으로 진행하면 귀속되지 않습니다.', '상세 화면 맨 아래 안내', 'INV-2 — 10/10 시안 기준'),
  ('FEE_A12_LIST', '소개비는 요율표가 아니라 당사자 협의로 정합니다 (A-12)', '관 전체 목록 제목 아래', 'A-12 — 10/10 시안 기준'),
  ('FEE_A12_DETAIL', '소개비는 요율표로 산정하지 않습니다 (A-12). 1:1 대화에서 당사자끼리 정합니다.', '소개장터 상세 아래 파란 안내', 'A-12 — 10/10 시안 기준'),
  ('RE_EXPOSURE_A07', '부동산은 소개비가 아니라 노출료입니다 (A-07). 금액 체계가 아직 정해지지 않아 이 관의 부동산 건은 정산이 생성되지 않습니다.', '안심소개 상세 아래 주황 안내', 'A-07 — 10/10 시안 기준'),
  ('REVIEW_SLA_NOTE', '등록하면 검수를 거칩니다. 영업일 기준 24시간 이내에 처리되고, 반려되면 사유와 수정 가이드가 함께 옵니다.', '사업 기회 등록 · 매물 등록 안내', 'B-09R 검수 24시간 — 영업일 기준(10/10 시안 기준)')
ON CONFLICT (code) DO UPDATE SET message = EXCLUDED.message, placement = EXCLUDED.placement, basis = EXCLUDED.basis, updated_at = now();

-- ⑤ 검수 마감 — 영업일 기준 ---------------------------------------------------------
/* 한국 시각으로 토 · 일을 건너뛰며 시간을 더합니다. 공휴일 표는 아직 없어 공휴일은 건너뛰지 않습니다(결정 기록에 적음). */
CREATE OR REPLACE FUNCTION public.fn_review_sla_due(p_from timestamptz, p_hours int)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $function$
DECLARE t timestamp := p_from AT TIME ZONE 'Asia/Seoul'; left_h numeric := p_hours; step numeric;
BEGIN
  /* 주말에 들어온 건은 다음 월요일 0시부터 셉니다 */
  WHILE extract(isodow FROM t) IN (6,7) LOOP t := date_trunc('day', t) + interval '1 day'; END LOOP;
  WHILE left_h > 0 LOOP
    step := least(left_h, extract(epoch FROM (date_trunc('day', t) + interval '1 day' - t)) / 3600);
    t := t + make_interval(secs => step * 3600);
    left_h := left_h - step;
    WHILE left_h > 0 AND extract(isodow FROM t) IN (6,7) LOOP t := date_trunc('day', t) + interval '1 day'; END LOOP;
  END LOOP;
  RETURN t AT TIME ZONE 'Asia/Seoul';
END $function$;
COMMENT ON FUNCTION public.fn_review_sla_due IS 'v10.31 — 검수 마감 = 영업일(토 · 일 제외) 기준 N시간 뒤. ReviewRepository.enqueue 가 씁니다. 공휴일은 표가 없어 빼지 않습니다.';

-- ⑦ 광고 칸 ------------------------------------------------------------------------
INSERT INTO public.ad_slots (code, gwan_code, name, width, height, is_active, placement, spec, in_ranking) VALUES
  ('GBAND', NULL, '관 랜딩 띠', 1413, 96, true,
   '소개장터 메인 · 공급자 등록 위의 가로 띠(시안 band_ad). 「광고」 표시와 함께 1장. 추천 · 순위에 넣지 않습니다.',
   '1413×96', false)
ON CONFLICT (code) DO NOTHING;
