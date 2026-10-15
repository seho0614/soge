-- v10.31 (W5 · 10/10 시안 기준) — 내 서비스(SB-PTC-CTR-200 · 201 · 210) · 단가 · 소개비(CTR-900) · 전용 트랙(CTR-950)
--
--   1) 업종이 등록 방식을 정합니다(시안 reg.forms): MATRIX 매트릭스 견적(7단계) · CONTRACT 계약 성사형 · CONSULT 상담형 ·
--      RENTAL 약정 월요금형 · PAYMENT 결제형(레거시) · MEDICAL 의료 심의 트랙(이상 3단계 · 결제형 6단계).
--      방식이 없는 업종은 시안대로 **등록 · 단가 입력이 막힙니다**(「폼 유형이 지정되지 않아…」) — 운영이 정하면 열립니다.
--      기존 price_form_type(FIXED = 규제 업종 고정)은 건드리지 않습니다.
--   2) 매트릭스 축은 업종 마스터(category_matrix_axes)에 둡니다 — 시안의 「프런트 상수」 결함(T-06)을 서버로. 이사짐만 시안 값으로 채웁니다.
--   3) 서비스: 등록 방식 · 주요 타겟 · 접수 방식 · 최고 확인비용(8등급은 비율로 자동) · 소개비(성사 · 재소개) · 수정일 · 노출 중단(파트너) ·
--      상세페이지 블록 6종 · 견적 매트릭스 값 · 처리 이력(승인 · 반려 · 수정 · 중단 · 재개)
--   4) 단가 미정 21업종: 생활 · 금융 상담 업종의 기준 단가가 비어 있어 실제로는 기본 단가(lead.default_fee)로 청구되던 것을
--      그 값 그대로 업종에 적습니다(도입가 표시 유지) — 새 숫자를 만들지 않습니다.
--   5) 전용 트랙(시안 판금 · 도색 / 중고차 매물 / 제품 카탈로그): 업종에 트랙을 붙이고, 견적 발송 · 카탈로그 품목을 저장합니다.

-- ---------------------------------------------------------------------
-- 1. 업종 → 등록 방식 · 신뢰 라벨 · 전용 트랙
-- ---------------------------------------------------------------------
ALTER TABLE public.categories ADD COLUMN service_form text
  CHECK (service_form IS NULL OR service_form IN ('MATRIX','CONTRACT','CONSULT','RENTAL','PAYMENT','MEDICAL'));
ALTER TABLE public.categories ADD COLUMN trust_label text;
ALTER TABLE public.categories ADD COLUMN partner_track text
  CHECK (partner_track IS NULL OR partner_track IN ('REPAIR','USEDCAR','CATALOG'));
COMMENT ON COLUMN public.categories.service_form IS '파트너 서비스 등록 방식(시안 reg.forms). 비면 등록 · 단가 입력이 막힙니다 — 운영(업종 마스터)이 정합니다';
COMMENT ON COLUMN public.categories.trust_label IS '신뢰지표 「누적 ○○」 라벨(업종별). 비면 「성사」';
COMMENT ON COLUMN public.categories.partner_track IS '파트너센터 전용 트랙 — REPAIR 견적요청함 · USEDCAR 매물 · CATALOG 카탈로그';

/* 생활 · 금융 상담 업종(상담 축)은 상담형이 기본입니다(시안: 입주청소 · 보험리모델링 = 상담형) */
UPDATE public.categories SET service_form = 'CONSULT' WHERE axis = 'CONSULT' AND service_form IS NULL;
/* 시안에 업종이 적힌 것 */
UPDATE public.categories SET service_form = 'MATRIX',   trust_label = '이사'      WHERE code = 'CSL_MOVING';
UPDATE public.categories SET service_form = 'RENTAL',   partner_track = 'CATALOG' WHERE code = 'CSL_RENTAL';
UPDATE public.categories SET service_form = 'MEDICAL'                              WHERE code = 'CSL_MEDICAL';
UPDATE public.categories SET service_form = 'CONTRACT', partner_track = 'REPAIR'   WHERE code = 'CSL_AUTO';      -- 정비 · 판금도색 = 수리 계약(시안 가전수리와 같은 계약 성사형)
UPDATE public.categories SET partner_track = 'USEDCAR'                             WHERE code IN ('CSL_USEDCAR','MNY_CAR');
UPDATE public.categories SET trust_label = '시공' WHERE code IN ('CSL_CONSTRUCTION','CSL_INTERIOR','MNY_INTERIOR','MNY_ENERGY');

-- 매트릭스 축 — 이사짐: 이사유형 4 × 물량 6 (시안 matrix.types · vols)
INSERT INTO public.category_matrix_axes(category_id, axis_type, axis_key, label, sort_order)
SELECT c.id, v.t, v.k, v.l, v.o
  FROM public.categories c
  CROSS JOIN (VALUES ('ROW','PACK','포장이사',1), ('ROW','HALF','반포장',2), ('ROW','GENERAL','일반이사',3), ('ROW','STORAGE','보관이사',4),
                     ('COL','R1','원룸',1), ('COL','R15','1.5룸',2), ('COL','R2','투룸',3), ('COL','R3','쓰리룸',4),
                     ('COL','R4','4룸',5), ('COL','R5','5룸 이상',6)) AS v(t,k,l,o)
 WHERE c.code = 'CSL_MOVING'
ON CONFLICT (category_id, axis_type, axis_key) DO NOTHING;
ALTER TABLE public.category_matrix_axes ADD CONSTRAINT ck_cma_axis_type CHECK (axis_type IN ('ROW','COL')) NOT VALID;

-- 단가 미정 업종 — 실제로 청구되던 기본 단가를 그대로 적습니다(도입가)
UPDATE public.categories c
   SET lead_fee = s.value::numeric
  FROM public.site_settings s
 WHERE s.key = 'lead.default_fee' AND s.value ~ '^[0-9]+$'
   AND c.axis = 'CONSULT' AND c.lead_fee IS NULL AND c.status = 'APPROVED';

-- ---------------------------------------------------------------------
-- 2. 서비스
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_services ADD COLUMN form_type text
  CHECK (form_type IS NULL OR form_type IN ('MATRIX','CONTRACT','CONSULT','RENTAL','PAYMENT','MEDICAL'));
ALTER TABLE public.partner_services ADD COLUMN target text CHECK (target IS NULL OR length(target) <= 300);
ALTER TABLE public.partner_services ADD COLUMN receive_mode text
  CHECK (receive_mode IS NULL OR receive_mode IN ('QUOTE','CALL','VISIT','CHAT'));
ALTER TABLE public.partner_services ADD COLUMN top_fee bigint CHECK (top_fee IS NULL OR (top_fee > 0 AND top_fee <= 100000));
ALTER TABLE public.partner_services ADD COLUMN referral_rate numeric
  CHECK (referral_rate IS NULL OR (referral_rate >= 0.05 AND referral_rate <= 0.12));
ALTER TABLE public.partner_services ADD COLUMN rebate_bonus bigint CHECK (rebate_bonus IS NULL OR (rebate_bonus >= 0 AND rebate_bonus <= 1000000));
ALTER TABLE public.partner_services ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.partner_services ADD COLUMN suspended_by text CHECK (suspended_by IS NULL OR suspended_by IN ('PARTNER','OPS'));
ALTER TABLE public.partner_services ADD COLUMN suspended_at timestamptz;
UPDATE public.partner_services s SET updated_at = s.created_at,
       form_type = (SELECT c.service_form FROM categories c WHERE c.id = s.category_id);
COMMENT ON COLUMN public.partner_services.top_fee IS '최고 확인비용(S 등급) — 8등급은 비율로 자동(시안 STEP 4/7). 업종 기준 단가보다 낮게 정할 수 없습니다';
COMMENT ON COLUMN public.partner_services.referral_rate IS '성사 소개비율(거래액의 %) — 시안 협의 구간 5~12%. 소개비는 당사자끼리 직접(INV-9) — 표시용 약정';
COMMENT ON COLUMN public.partner_services.rebate_bonus IS '재소개 보너스(건당 · 3개월 내 재계약) — 표시용 약정';

/* 최고 확인비용은 업종 기준 단가 이상 · 업종의 등록 방식을 따름 · 등록 방식이 없는 업종은 등록 불가 */
CREATE FUNCTION public.fn_partner_service_form_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c categories%ROWTYPE;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT * INTO c FROM categories WHERE id = NEW.category_id;
    IF TG_OP = 'INSERT' AND c.service_form IS NULL AND NEW.form_type IS NOT NULL THEN
      RAISE EXCEPTION 'SERVICE: 「%」 업종은 등록 방식(폼 유형)이 정해지지 않아 등록할 수 없습니다 — 운영이 정하면 열립니다', c.name;
    END IF;
    IF NEW.form_type IS NOT NULL AND NEW.form_type IS DISTINCT FROM c.service_form THEN
      RAISE EXCEPTION 'SERVICE: 「%」 업종의 등록 방식은 %입니다', c.name, c.service_form;
    END IF;
    IF NEW.top_fee IS NOT NULL AND c.lead_fee IS NOT NULL AND NEW.top_fee < c.lead_fee THEN
      RAISE EXCEPTION 'SERVICE: 최고 확인비용은 업종 기준 단가(%원)보다 낮게 정할 수 없습니다', c.lead_fee;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  IF NEW.status <> 'SUSPENDED' THEN NEW.suspended_by := NULL; NEW.suspended_at := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_partner_service_form BEFORE INSERT OR UPDATE ON public.partner_services
  FOR EACH ROW EXECUTE FUNCTION public.fn_partner_service_form_guard();

-- 견적 매트릭스 값(원)
CREATE TABLE public.partner_service_matrix (
  service_id  uuid NOT NULL REFERENCES public.partner_services(id) ON DELETE CASCADE,
  row_key     text NOT NULL,
  col_key     text NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  PRIMARY KEY (service_id, row_key, col_key)
);
CREATE FUNCTION public.fn_partner_matrix_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cat uuid;
BEGIN
  SELECT category_id INTO v_cat FROM partner_services WHERE id = NEW.service_id;
  IF NOT EXISTS (SELECT 1 FROM category_matrix_axes WHERE category_id = v_cat AND axis_type = 'ROW' AND axis_key = NEW.row_key AND is_active)
     OR NOT EXISTS (SELECT 1 FROM category_matrix_axes WHERE category_id = v_cat AND axis_type = 'COL' AND axis_key = NEW.col_key AND is_active) THEN
    RAISE EXCEPTION 'SERVICE: 이 업종의 견적 구간이 아닙니다(% × %)', NEW.row_key, NEW.col_key;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_partner_matrix_guard BEFORE INSERT OR UPDATE ON public.partner_service_matrix
  FOR EACH ROW EXECUTE FUNCTION public.fn_partner_matrix_guard();

-- 상세페이지 블록(시안 svcd.blocks 6종)
CREATE TABLE public.partner_service_blocks (
  service_id  uuid NOT NULL REFERENCES public.partner_services(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('HERO_IMAGE','INTRO','PRICE','CASES','FAQ','LOCATION')),
  body        text CHECK (body IS NULL OR length(body) <= 5000),
  file_id     uuid REFERENCES public.files(id),
  sort_order  int NOT NULL DEFAULT 0,
  is_visible  boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, kind),
  CONSTRAINT ck_psb_filled CHECK (coalesce(btrim(body),'') <> '' OR file_id IS NOT NULL)
);

-- 처리 이력(승인 · 반려 · 수정 · 중단 · 재개) — 시안 「승인 · 반려 이력」 · 「재제출 경로」
CREATE TABLE public.partner_service_events (
  id          bigserial PRIMARY KEY,
  service_id  uuid NOT NULL REFERENCES public.partner_services(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN ('SUBMIT','APPROVE','REJECT','EDIT','SUSPEND','RESUME')),
  from_status text, to_status text,
  reason      text,
  actor_id    uuid REFERENCES public.accounts(id),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pse_service ON public.partner_service_events(service_id, at DESC);
CREATE FUNCTION public.fn_partner_service_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_act text; v_actor uuid;
BEGIN
  BEGIN v_actor := nullif(current_setting('app.actor_id', true), '')::uuid; EXCEPTION WHEN others THEN v_actor := NULL; END;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO partner_service_events(service_id, action, to_status, actor_id) VALUES (NEW.id, 'SUBMIT', NEW.status, v_actor);
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  v_act := CASE
    WHEN NEW.status = 'APPROVED' AND OLD.status = 'SUSPENDED' THEN 'RESUME'
    WHEN NEW.status = 'APPROVED' THEN 'APPROVE'
    WHEN NEW.status = 'REJECTED' THEN 'REJECT'
    WHEN NEW.status = 'SUSPENDED' THEN 'SUSPEND'
    WHEN NEW.status = 'IN_REVIEW' THEN 'EDIT'
    ELSE 'EDIT' END;
  INSERT INTO partner_service_events(service_id, action, from_status, to_status, reason, actor_id)
  VALUES (NEW.id, v_act, OLD.status, NEW.status, CASE WHEN NEW.status = 'REJECTED' THEN NEW.reject_reason END, v_actor);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_partner_service_event AFTER INSERT OR UPDATE OF status ON public.partner_services
  FOR EACH ROW EXECUTE FUNCTION public.fn_partner_service_event();
/* 지난 기록 — 지금 상태 한 줄씩(언제 바뀌었는지는 모름 · 등록일로 둠) */
INSERT INTO public.partner_service_events(service_id, action, to_status, reason, at)
SELECT s.id, CASE s.status WHEN 'APPROVED' THEN 'APPROVE' WHEN 'REJECTED' THEN 'REJECT' WHEN 'SUSPENDED' THEN 'SUSPEND' ELSE 'SUBMIT' END,
       s.status, s.reject_reason, s.created_at
  FROM public.partner_services s;

-- ---------------------------------------------------------------------
-- 3. 전용 트랙
-- ---------------------------------------------------------------------
-- 판금 · 도색 견적요청함 — 받은 요청(배정)에 보낸 견적
CREATE TABLE public.partner_track_quotes (
  delivery_id  uuid PRIMARY KEY REFERENCES public.lead_deliveries(id) ON DELETE CASCADE,
  partner_id   uuid NOT NULL REFERENCES public.partners(id),
  amount       bigint NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
  message      text CHECK (message IS NULL OR length(message) <= 1000),
  sent_at      timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.fn_track_quote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lead_deliveries d WHERE d.id = NEW.delivery_id AND d.partner_id = NEW.partner_id AND d.viewed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'TRACK: 연락처를 연(확인비용을 낸) 요청에만 견적을 보낼 수 있습니다';
  END IF;
  IF NEW.message ~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}' THEN
    RAISE EXCEPTION 'TRACK: 견적 문구에 전화번호를 적지 마십시오';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_track_quote_guard BEFORE INSERT OR UPDATE ON public.partner_track_quotes
  FOR EACH ROW EXECUTE FUNCTION public.fn_track_quote_guard();

-- 제품 카탈로그 — 렌탈 · 판매 품목
CREATE TABLE public.partner_catalog_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  sale_kind   text NOT NULL CHECK (sale_kind IN ('RENTAL','SALE')),
  price       bigint NOT NULL CHECK (price > 0 AND price <= 1000000000),
  state       text NOT NULL DEFAULT 'LISTED' CHECK (state IN ('LISTED','HIDDEN')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pci_partner ON public.partner_catalog_items(partner_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 4. 파트너 사진 · 로고(상세페이지 대표 이미지 · 회사 로고) 파일 용도
-- ---------------------------------------------------------------------
ALTER TABLE public.files DROP CONSTRAINT ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  /* 합침(v10.31) — 모든 묶음의 용도 합집합(w1 D049 · w2 D050 · D090 과 같은 목록). 빠지면 매물 · 요청 사진 · 문의 첨부가 있는 DB 에서 실패합니다 */
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA','LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC']));
INSERT INTO public.file_policies(purpose, content_type, max_bytes, ext) VALUES
  ('PARTNER_MEDIA', 'image/jpeg', 5242880, 'jpg'),
  ('PARTNER_MEDIA', 'image/png',  5242880, 'png')
ON CONFLICT DO NOTHING;
