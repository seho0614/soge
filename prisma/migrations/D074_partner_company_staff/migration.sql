-- v10.31 (W5 · 10/10 시안 기준) — 회사 · 계정(SB-PTC-CTR-610) 4탭: 사업자 정보 · 계정 · 약관 · 동의 · 회사 관리
--
--   1) 사업자 정보 변경 요청 — 실제로 접수되고, 승인은 본사 몫(시안 biz.chg). 승인되면 사업자 정보에 반영됩니다(운영 화면 — w6).
--      사업자등록번호는 변경 요청 대상이 아닙니다(다른 사업자 = 새 입점).
--   2) 계정 — 대표 · 직원(business_members). 직원은 이미 가입한 회원을 이메일로 초대하고, 그 회원이 받아들이면 합류합니다
--      (시안 「초대 대기」). 초대 메일 발송은 없습니다(시안 T-15와 같음 — 화면에 적음).
--   3) 회사 관리 — 브랜드명 · 로고 · 소재(지점) 목록(시안 biz.brand). 소재는 신뢰 표시 단위입니다(서비스 노출 단위 아님).

CREATE TABLE public.business_change_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  field           text NOT NULL CHECK (field IN ('COMPANY_NAME','CEO_NAME','ADDRESS','BIZ_TYPE','BIZ_ITEM')),
  before_value    text,
  after_value     text NOT NULL CHECK (length(btrim(after_value)) BETWEEN 1 AND 300),
  reason          text NOT NULL CHECK (length(btrim(reason)) BETWEEN 2 AND 500),
  state           text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','APPROVED','REJECTED','WITHDRAWN')),
  decision_reason text,
  decided_by      uuid REFERENCES public.accounts(id),
  decided_at      timestamptz,
  requested_by    uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_bcr_reject_reason CHECK (state <> 'REJECTED' OR coalesce(btrim(decision_reason),'') <> '')
);
CREATE UNIQUE INDEX uq_bcr_open ON public.business_change_requests(business_id, field) WHERE state = 'REQUESTED';

/* 승인되면 사업자 정보에 그대로 반영 — 승인과 반영이 따로 놀지 않게 DB 가 합니다 */
CREATE FUNCTION public.fn_business_change_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'REQUESTED' AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'BIZCHANGE: 이미 처리된 변경 요청입니다';
  END IF;
  IF NEW.state IN ('APPROVED','REJECTED') AND OLD.state = 'REQUESTED' THEN
    IF NEW.decided_by IS NULL THEN RAISE EXCEPTION 'BIZCHANGE: 처리한 사람이 필요합니다'; END IF;
    NEW.decided_at := now();
  END IF;
  IF NEW.state = 'APPROVED' AND OLD.state = 'REQUESTED' THEN
    UPDATE businesses SET
      company_name = CASE WHEN NEW.field = 'COMPANY_NAME' THEN NEW.after_value ELSE company_name END,
      ceo_name     = CASE WHEN NEW.field = 'CEO_NAME'     THEN NEW.after_value ELSE ceo_name END,
      address      = CASE WHEN NEW.field = 'ADDRESS'      THEN NEW.after_value ELSE address END,
      biz_type     = CASE WHEN NEW.field = 'BIZ_TYPE'     THEN NEW.after_value ELSE biz_type END,
      biz_item     = CASE WHEN NEW.field = 'BIZ_ITEM'     THEN NEW.after_value ELSE biz_item END,
      updated_at   = now()
     WHERE id = NEW.business_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_business_change_apply BEFORE UPDATE ON public.business_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_business_change_apply();

-- 직원 권한(시안 「권한 — 대표 · 상담」) — 상담(리드 · 메모 · 이행 보고) / 정산(충전 · 환불 · 정산 조회)
ALTER TABLE public.business_members ADD COLUMN invited_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.business_members ADD COLUMN removed_at timestamptz;

-- 회사 관리 — 브랜드 · 로고 · 소재
CREATE TABLE public.partner_brands (
  partner_id    uuid PRIMARY KEY REFERENCES public.partners(id) ON DELETE CASCADE,
  brand_name    text NOT NULL CHECK (length(btrim(brand_name)) BETWEEN 1 AND 60),
  logo_file_id  uuid REFERENCES public.files(id),
  intro         text CHECK (intro IS NULL OR length(intro) <= 500),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.partner_brand_sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  sido        text NOT NULL,
  sigungu     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, name)
);
COMMENT ON TABLE public.partner_brand_sites IS '회사 관리 「등록 소재」 — 지점 · 사무소. 시 · 군 · 구까지만(상세 주소는 받지 않음)';
