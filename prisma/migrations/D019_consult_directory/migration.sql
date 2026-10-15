-- =====================================================================
-- D019 — 법률 · 세무 월 정액 노출형 (2026-10-02 대표 결정 · 법무 회신 「문제 없음」)
--   (v10.4.7 kit 의 D009 「consult_directory」 를 옮겼습니다 — 이 kit 에는 D009 가 이미 있어 번호만 D019 입니다)
--
--   법무 질의 Q2 · Q3 은 "상담 건수 · 성사와 무관한 월 정액 노출료"만 물었고, 그 방식만 엽니다.
--     · 상담 신청(리드)은 만들지 않습니다 — 소비자는 업체 정보를 보고 직접 연락합니다
--       (변호사법 제34조 등 소개 대가 금지 · 리드 열람형은 질의 대상이 아니었음)
--     · 노출료는 기간 정액입니다 — 클릭 · 연락 · 성사 건수와 잇는 칸을 두지 않습니다
--     · 노출 순서는 날마다 섞습니다 — 돈을 더 낸 곳을 위에 두는 순위가 없습니다(API)
--     · 화면에 「광고」 표시를 붙입니다(표시광고법)
--     · 자격(변호사 · 법무사 / 세무사 · 공인회계사 등록) 승인 + 상담 축 입점 승인 업체만 노출됩니다
--   입금 확인 후 관리자가 기간을 켭니다(전자결제 연동 전 — 소개캐시 입금 확인과 같은 방식).
-- =====================================================================

-- 1. 업종의 상담 방식
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS consult_mode text;
UPDATE public.categories SET consult_mode = 'LEAD' WHERE axis = 'CONSULT' AND consult_mode IS NULL;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS ck_categories_consult_mode;
ALTER TABLE public.categories ADD CONSTRAINT ck_categories_consult_mode
  CHECK ((axis IS DISTINCT FROM 'CONSULT' AND consult_mode IS NULL)
      OR (axis = 'CONSULT' AND consult_mode IN ('LEAD','LISTING_FEE')));
COMMENT ON COLUMN public.categories.consult_mode IS
  '상담 축 업종의 방식. LEAD 상담 신청 → 인증업체 1곳 배분 / LISTING_FEE 월 정액 노출(리드 없음, 소비자 직접 연락). 다른 축은 NULL.';

-- 2. 법률 · 세무 — 자격 규칙과 제한업종 행을 실제 자격으로 잇고 공개
INSERT INTO public.qualification_rules (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active) VALUES
  ('LEGAL', '법률(변호사·법무사)', '변호사 등록증명 또는 법무사 등록증', '변호사법 · 법무사법', true, true),
  ('TAX',   '세무·회계(세무사·회계사)', '세무사 등록증 또는 공인회계사 등록증', '세무사법 · 공인회계사법', true, true)
ON CONFLICT (category_code) DO NOTHING;

UPDATE public.restricted_industries
   SET qual_code = 'LEGAL', gate_requirement = '변호사 등록증명 또는 법무사 등록증.',
       legal_basis = '변호사법 제34조 · 법무사법 — 소개 대가 금지. 월 정액 노출형만 운영(2026-10-02 법무 회신)',
       block_message = '법률은 상담 신청을 받지 않습니다 — 업체 정보를 보고 직접 연락하십시오.', updated_at = now()
 WHERE gwan_code = 'MAL' AND code = 'CSL_LEGAL';
UPDATE public.restricted_industries
   SET qual_code = 'TAX', gate_requirement = '세무사 등록증 또는 공인회계사 등록증.',
       legal_basis = '세무사법 · 공인회계사법 — 월 정액 노출형만 운영(2026-10-02 법무 회신)',
       block_message = '세무 · 회계는 상담 신청을 받지 않습니다 — 업체 정보를 보고 직접 연락하십시오.', updated_at = now()
 WHERE gwan_code = 'MAL' AND code = 'CSL_TAX';

UPDATE public.categories
   SET consult_mode = 'LISTING_FEE', status = 'APPROVED', approved_at = coalesce(approved_at, now()), updated_at = now()
 WHERE gwan_code = 'MAL' AND code IN ('CSL_LEGAL','CSL_TAX');

-- 3. 상담 신청 · 리드 게이트 — 정액 노출형 업종은 받지 않습니다
CREATE OR REPLACE FUNCTION public.fn_consult_request_guard() RETURNS trigger AS $$
DECLARE v_gwan text; v_axis text; v_status text; v_mode text;
BEGIN
  SELECT gwan_code, axis, status, consult_mode INTO v_gwan, v_axis, v_status, v_mode FROM categories WHERE id = NEW.category_id;
  IF v_gwan IS DISTINCT FROM 'MAL' OR v_axis IS DISTINCT FROM 'CONSULT' THEN
    RAISE EXCEPTION 'CONSULT_AXIS: 상담 신청은 안심소개 「생활·금융 상담」 업종에서만 받습니다';
  END IF;
  IF v_status IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'CONSULT_CLOSED: 지금은 이 업종의 상담 신청을 받지 않습니다';
  END IF;
  IF v_mode = 'LISTING_FEE' THEN
    RAISE EXCEPTION 'CONSULT_DIRECTORY_ONLY: 이 업종은 상담 신청을 받지 않습니다 — 업체 정보를 보고 직접 연락하십시오';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.fn_lead_restricted_guard() RETURNS trigger AS $$
DECLARE
  v_gwan text; v_axis text; v_status text; v_cmode text;
  v_mode text; v_msg text; v_code text; v_qual text;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;                          -- 업종 없는 리드(옛 기록 형식)는 업종 규칙 밖
  END IF;

  SELECT c.gwan_code, c.axis, c.status, c.consult_mode, r.mode, r.block_message, r.code, coalesce(r.qual_code, r.code)
    INTO v_gwan, v_axis, v_status, v_cmode, v_mode, v_msg, v_code, v_qual
    FROM categories c
    LEFT JOIN restricted_industries r
      ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
   WHERE c.id = NEW.category_id;

  /* INV-AX1 — 리드는 안심소개 상담 축에서만 생깁니다 */
  IF v_gwan IS DISTINCT FROM 'MAL' OR v_axis IS DISTINCT FROM 'CONSULT' THEN
    RAISE EXCEPTION 'LEAD_AXIS: 상담 신청은 안심소개 「생활·금융 상담」 업종에서만 만들 수 있습니다';
  END IF;
  /* D016 — 준비 중(PENDING) · 보관(ARCHIVED) 업종은 받지 않습니다 */
  IF v_status IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'LEAD_CATEGORY_CLOSED: 지금은 이 업종의 상담 신청을 받지 않습니다%',
      CASE WHEN v_msg IS NOT NULL THEN ' — ' || v_msg ELSE '' END;
  END IF;
  /* D019 — 법률 · 세무는 소개 대가 금지 업종이라 리드를 만들지 않습니다 */
  IF v_cmode = 'LISTING_FEE' THEN
    RAISE EXCEPTION 'LEAD_DIRECTORY_ONLY: 이 업종은 리드를 만들지 않습니다(월 정액 노출형)';
  END IF;
  IF v_mode = 'BLOCK' THEN
    RAISE EXCEPTION 'LEAD_BLOCK: % — %', v_code, coalesce(v_msg, '이 업종은 상담 신청을 받을 수 없습니다.');
  END IF;
  IF v_mode = 'GATED' AND NOT EXISTS (
       SELECT 1 FROM qualification_reviews qr
        WHERE qr.category_code = v_qual AND qr.state = 'APPROVED') THEN
    RAISE EXCEPTION 'LEAD_GATED: % — %', v_code,
      coalesce(v_msg, '자격 심사를 통과한 업체가 없어 상담 신청을 받을 수 없습니다.');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW public.v_consult_eligible_partner AS
SELECT p.id AS partner_id, b.id AS business_id, s.category_id, r.sido, r.sigungu,
       (SELECT max(d.delivered_at) FROM lead_deliveries d WHERE d.partner_id = p.id) AS last_delivered_at
  FROM partners p
  JOIN businesses b ON b.id = p.business_id
  JOIN v_partner_eligible e ON e.partner_id = p.id AND e.can_receive
  JOIN mal_partner_axes ax ON ax.business_id = b.id AND ax.axis = 'CONSULT' AND ax.state = 'APPROVED'
  JOIN partner_services s ON s.partner_id = p.id AND s.status = 'APPROVED'
  JOIN partner_regions r ON r.partner_id = p.id
  JOIN categories c ON c.id = s.category_id AND c.axis = 'CONSULT' AND c.status = 'APPROVED'
                   AND c.consult_mode = 'LEAD'
  LEFT JOIN restricted_industries ri ON ri.code = c.restricted_code AND ri.gwan_code = c.gwan_code AND ri.is_active
 WHERE p.status = 'ACTIVE'
   AND (ri.mode IS NULL OR ri.mode <> 'BLOCK')
   AND (ri.mode IS DISTINCT FROM 'GATED' OR EXISTS (
         SELECT 1 FROM qualification_reviews q
          WHERE q.business_id = b.id AND q.state = 'APPROVED'
            AND q.category_code = coalesce(ri.qual_code, ri.code)));

-- 4. 정액 노출 항목
CREATE TABLE IF NOT EXISTS public.consult_directory_entries (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id    uuid NOT NULL REFERENCES public.partners(id),
  category_id   uuid NOT NULL REFERENCES public.categories(id),
  display_name  text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 60),
  intro         text CHECK (intro IS NULL OR length(intro) <= 500),
  contact_phone text NOT NULL CHECK (contact_phone ~ '^[0-9-]{8,14}$'),
  website_url   text CHECK (website_url IS NULL OR website_url ~ '^https://'),
  sido          text NOT NULL,
  state         text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ACTIVE','ENDED','REJECTED')),
  monthly_fee   numeric CHECK (monthly_fee IS NULL OR monthly_fee > 0),
  paid_from     date,
  paid_to       date,
  payment_ref   text,
  reason        text,
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, category_id),
  CONSTRAINT ck_directory_active CHECK (state <> 'ACTIVE' OR (monthly_fee IS NOT NULL AND paid_from IS NOT NULL
        AND paid_to IS NOT NULL AND paid_to >= paid_from AND length(btrim(coalesce(payment_ref, ''))) > 0)),
  CONSTRAINT ck_directory_reason CHECK (state NOT IN ('REJECTED','ENDED') OR length(btrim(coalesce(reason, ''))) >= 5)
);
COMMENT ON TABLE public.consult_directory_entries IS
  '법률 · 세무 월 정액 노출. 기간 정액만 있고 클릭 · 연락 · 성사 건수와 잇는 칸이 없습니다(D019 · 소개 대가 금지). 리드를 만들지 않습니다.';

CREATE OR REPLACE FUNCTION public.fn_directory_guard() RETURNS trigger AS $$
DECLARE v_mode text; v_qual text; v_biz uuid; v_pstatus text;
BEGIN
  SELECT c.consult_mode, coalesce(r.qual_code, r.code)
    INTO v_mode, v_qual
    FROM categories c
    LEFT JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
   WHERE c.id = NEW.category_id AND c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED';
  IF v_mode IS DISTINCT FROM 'LISTING_FEE' THEN
    RAISE EXCEPTION 'DIRECTORY_CATEGORY: 정액 노출은 법률 · 세무 같은 정액 노출형 업종에서만 씁니다';
  END IF;
  IF NEW.state = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'ACTIVE' OR OLD.paid_to IS DISTINCT FROM NEW.paid_to) THEN
    SELECT p.business_id, p.status INTO v_biz, v_pstatus FROM partners p WHERE p.id = NEW.partner_id;
    IF v_pstatus IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'DIRECTORY_PARTNER: 입점 승인된 파트너만 노출할 수 있습니다';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mal_partner_axes ax WHERE ax.business_id = v_biz AND ax.axis = 'CONSULT' AND ax.state = 'APPROVED') THEN
      RAISE EXCEPTION 'DIRECTORY_AXIS: 안심소개 상담 축 입점 승인이 먼저입니다';
    END IF;
    IF v_qual IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM qualification_reviews q WHERE q.business_id = v_biz AND q.category_code = v_qual AND q.state = 'APPROVED') THEN
      RAISE EXCEPTION 'DIRECTORY_QUALIFICATION: 자격 심사(%)를 통과해야 노출할 수 있습니다', v_qual;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_directory_guard ON public.consult_directory_entries;
CREATE TRIGGER trg_directory_guard BEFORE INSERT OR UPDATE ON public.consult_directory_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_directory_guard();

/* 지금 보여도 되는 항목 — 기간 안 · 파트너 활성 · 자격 유효 */
CREATE OR REPLACE VIEW public.v_consult_directory_public AS
SELECT d.id, d.category_id, d.display_name, d.intro, d.contact_phone, d.website_url, d.sido
  FROM consult_directory_entries d
  JOIN partners p ON p.id = d.partner_id AND p.status = 'ACTIVE'
  JOIN categories c ON c.id = d.category_id AND c.consult_mode = 'LISTING_FEE' AND c.status = 'APPROVED'
  LEFT JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
 WHERE d.state = 'ACTIVE'
   AND (now() AT TIME ZONE 'Asia/Seoul')::date BETWEEN d.paid_from AND d.paid_to
   AND EXISTS (SELECT 1 FROM mal_partner_axes ax WHERE ax.business_id = p.business_id AND ax.axis = 'CONSULT' AND ax.state = 'APPROVED')
   AND (r.code IS NULL OR EXISTS (SELECT 1 FROM qualification_reviews q
          WHERE q.business_id = p.business_id AND q.state = 'APPROVED' AND q.category_code = coalesce(r.qual_code, r.code)));
COMMENT ON VIEW public.v_consult_directory_public IS
  '지금 노출되는 법률 · 세무 정액 노출 항목. 기간이 지나거나 자격 · 입점이 풀리면 자동으로 빠집니다.';

/* 감시 — 정액 노출형 업종에서 나온 리드 · 상담 신청 */
CREATE OR REPLACE VIEW public.v_directory_lead_leak AS
SELECT l.id, c.code FROM leads l JOIN categories c ON c.id = l.category_id WHERE c.consult_mode = 'LISTING_FEE'
UNION ALL
SELECT cr.id, c.code FROM consult_requests cr JOIN categories c ON c.id = cr.category_id WHERE c.consult_mode = 'LISTING_FEE';
COMMENT ON VIEW public.v_directory_lead_leak IS '정액 노출형(법률 · 세무)에서 만들어진 리드 · 상담 신청. **0이어야 정상** — 소개 대가 금지.';

COMMENT ON FUNCTION public.fn_lead_restricted_guard() IS
'상담 신청(리드) 생성 게이트. 안심소개 상담 축 · 공개 업종 · 리드형(consult_mode=LEAD)만 받고, BLOCK 은 거부, GATED 는 자격 승인 업체가 있어야 합니다(D005 · D016 · D019).';

/* 배정 후보에서도 정액 노출형 업종은 빠집니다 — 리드 자체가 생기지 않지만 판정을 한 번 더 겹칩니다 */
COMMENT ON VIEW public.v_consult_eligible_partner IS
  '상담 리드를 받을 수 있는 업체 × 업종 × 지역. 상담 축 입점 승인 · 서비스 승인 · 지역 · 미납 한도 · GATED 자격을 모두 봅니다. 리드형(LEAD) 업종만.';

/* 노출 기간이 끝났는데 ACTIVE 로 남은 항목 — 화면에는 이미 안 보입니다(v_consult_directory_public). 운영 목록 정리용 */
CREATE OR REPLACE VIEW public.v_consult_directory_lapsed AS
SELECT d.id, d.partner_id, d.category_id, d.paid_to
  FROM consult_directory_entries d
 WHERE d.state = 'ACTIVE' AND d.paid_to < (now() AT TIME ZONE 'Asia/Seoul')::date;
COMMENT ON VIEW public.v_consult_directory_lapsed IS
  '노출 기간이 끝났는데 상태가 ACTIVE 인 정액 노출 항목(관찰용). 공개 목록에서는 기간으로 이미 빠집니다 — 운영 화면에 「기간 지남」으로 보입니다.';
