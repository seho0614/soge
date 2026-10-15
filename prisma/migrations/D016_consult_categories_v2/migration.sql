-- =====================================================================
-- D016 — 안심소개 상담 축 업종 개편 (대표 결정 2026-10-01)
--   (v10.4.7 kit 의 D006 을 그대로 옮겼습니다 — 이 kit 에는 D006~D015 가 이미 있어 번호만 D016 입니다)
--
--   전문 업체 업종 목록에서 안심소개(인증 후 등록)에 넣을 업종을 확정했습니다.
--     · 자격 확인 후 게시(GATED) 10 : 보험 · 의료 · 이사짐 · 인테리어 · 건설·시공 ·
--                                    자동차(정비·렌트) · 여행·항공 · 교육·학원 ·
--                                    물류·운송 · 통신사 대리점
--     · 사업자 인증만(일반) 5        : 청소 · 웨딩 · 이벤트·행사 · 렌탈 · 중고차
--     · 준비 중(법무 확인 전) 2      : 법률(변호사·법무사) · 세무·회계(세무사·회계사)
--                                    — 소개 대가 금지 조항 확인 전까지 상담 신청을 받지 않습니다
--     · 보관 2                       : 카드 · 금융 (목록에서 제외 — 지난 기록 때문에 지우지 않음)
--     · 렌터카는 「자동차(정비·렌트)」로 합칩니다 (같은 업종 행을 이름만 바꿈)
--
--   광고·마케팅 · 디자인 · IT · 제조 · 유통은 소개장터, 부동산은 안심소개 부동산 축,
--   공공·기관은 제외 — 이 마이그레이션에서 다루지 않습니다.
--   ★ 아래 법률 근거는 운영 전 법무 확인이 필요합니다.
-- =====================================================================

-- 1. 자격 규칙 (qualification_reviews 가 이 표를 참조합니다)
INSERT INTO public.qualification_rules (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active) VALUES
  ('MOVING',       '이사짐',          '화물자동차 운송주선사업 허가증',        '화물자동차 운수사업법', true, true),
  ('INTERIOR',     '인테리어',        '실내건축공사업 등록증 (등록 대상 공사)', '건설산업기본법',        true, true),
  ('CONSTRUCTION', '건설·시공',       '건설업 등록증',                        '건설산업기본법',        true, true),
  ('AUTO',         '자동차(정비·렌트)','자동차관리사업(정비업) 등록증 또는 자동차대여사업 등록증', '자동차관리법 · 여객자동차 운수사업법', true, true),
  ('TRAVEL',       '여행·항공',       '여행업 등록증',                        '관광진흥법',            true, true),
  ('EDU',          '교육·학원',       '학원 등록증 또는 교습소 신고증',        '학원의 설립·운영 및 과외교습에 관한 법률', true, true),
  ('LOGISTICS',    '물류·운송',       '화물자동차 운송사업 허가증',            '화물자동차 운수사업법', true, true)
ON CONFLICT (category_code) DO NOTHING;

-- 2. 상담 축 제한업종 행 (GATED · 소개 불가)
INSERT INTO public.restricted_industries
  (code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, block_message, intro_allowed, qual_code) VALUES
  ('CSL_MOVING','이사짐','화물자동차 운수사업법 — 운송주선사업 허가','MAL','GATED','운송주선사업 허가증.',true,'이사짐 상담 신청은 허가를 확인한 업체만 받을 수 있습니다.',false,'MOVING'),
  ('CSL_INTERIOR','인테리어','건설산업기본법 — 실내건축공사업 등록','MAL','GATED','실내건축공사업 등록증.',true,'인테리어 상담 신청은 등록을 확인한 업체만 받을 수 있습니다.',false,'INTERIOR'),
  ('CSL_CONSTRUCTION','건설·시공','건설산업기본법 — 건설업 등록','MAL','GATED','건설업 등록증.',true,'건설·시공 상담 신청은 등록을 확인한 업체만 받을 수 있습니다.',false,'CONSTRUCTION'),
  ('CSL_AUTO','자동차(정비·렌트)','자동차관리법 · 여객자동차 운수사업법','MAL','GATED','정비업 또는 대여사업 등록증.',true,'자동차 상담 신청은 등록을 확인한 업체만 받을 수 있습니다.',false,'AUTO'),
  ('CSL_TRAVEL','여행·항공','관광진흥법 — 여행업 등록','MAL','GATED','여행업 등록증.',true,'여행 상담 신청은 여행업 등록을 확인한 업체만 받을 수 있습니다.',false,'TRAVEL'),
  ('CSL_EDU','교육·학원','학원법 — 학원 등록 · 교습소 신고','MAL','GATED','학원 등록증 또는 교습소 신고증.',true,'교육 상담 신청은 등록·신고를 확인한 곳만 받을 수 있습니다.',false,'EDU'),
  ('CSL_LOGISTICS','물류·운송','화물자동차 운수사업법 — 운송사업 허가','MAL','GATED','운송사업 허가증.',true,'물류·운송 상담 신청은 허가를 확인한 업체만 받을 수 있습니다.',false,'LOGISTICS'),
  /* 준비 중 — qual_code 를 자격 규칙에 없는 값으로 두어 승인 자체가 생기지 않게 합니다 */
  ('CSL_LEGAL','법률(변호사·법무사)','변호사법 제34조 등 — 소개 대가 금지 여부 법무 확인 전','MAL','GATED','법무 확인 전 — 받지 않음.',true,'법률 상담 신청은 법무 확인을 마칠 때까지 받지 않습니다.',false,'HOLD_LEGAL_REVIEW'),
  ('CSL_TAX','세무·회계(세무사·회계사)','세무사법 · 공인회계사법 — 소개 대가 금지 여부 법무 확인 전','MAL','GATED','법무 확인 전 — 받지 않음.',true,'세무·회계 상담 신청은 법무 확인을 마칠 때까지 받지 않습니다.',false,'HOLD_LEGAL_REVIEW')
ON CONFLICT (code, gwan_code) DO NOTHING;

-- D005 의 문구 치환이 남긴 조사 오류 정정 ("상담 신청는" → "상담 신청은")
UPDATE public.restricted_industries
   SET block_message = replace(block_message, '상담 신청는', '상담 신청은'), updated_at = now()
 WHERE gwan_code = 'MAL' AND block_message LIKE '%상담 신청는%';

-- 3. 업종 행
UPDATE public.categories SET code = 'CSL_AUTO', name = '자동차(정비·렌트)', restricted_code = 'CSL_AUTO', updated_at = now()
 WHERE gwan_code = 'MAL' AND code = 'CSL_RENTCAR';
UPDATE public.categories SET restricted_code = 'CSL_MOVING', updated_at = now()
 WHERE gwan_code = 'MAL' AND code = 'CSL_MOVING';

INSERT INTO public.categories (gwan_code, code, name, status, restricted_code, labor_law_flag, approved_at, axis) VALUES
  ('MAL','CSL_INTERIOR','인테리어','APPROVED','CSL_INTERIOR','NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_CONSTRUCTION','건설·시공','APPROVED','CSL_CONSTRUCTION','NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_TRAVEL','여행·항공','APPROVED','CSL_TRAVEL','NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_EDU','교육·학원','APPROVED','CSL_EDU','NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_LOGISTICS','물류·운송','APPROVED','CSL_LOGISTICS','NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_CLEANING','청소','APPROVED',NULL,'NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_WEDDING','웨딩','APPROVED',NULL,'NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_EVENT','이벤트·행사','APPROVED',NULL,'NOT_APPLICABLE',now(),'CONSULT'),
  ('MAL','CSL_LEGAL','법률(변호사·법무사)','PENDING','CSL_LEGAL','NOT_APPLICABLE',NULL,'CONSULT'),
  ('MAL','CSL_TAX','세무·회계(세무사·회계사)','PENDING','CSL_TAX','NOT_APPLICABLE',NULL,'CONSULT')
ON CONFLICT (gwan_code, code) DO NOTHING;

-- 카드 · 금융 — 목록에서 제외 (보관)
UPDATE public.categories SET status = 'ARCHIVED', updated_at = now()
 WHERE gwan_code = 'MAL' AND code IN ('CSL_CARD','CSL_FINANCE');
UPDATE public.restricted_industries SET is_active = false, updated_at = now()
 WHERE gwan_code = 'MAL' AND code IN ('CSL_CARD','CSL_FINANCE');

-- 4. 리드 게이트 — 공개(APPROVED) 업종만 받습니다
CREATE OR REPLACE FUNCTION public.fn_lead_restricted_guard() RETURNS trigger AS $$
DECLARE
  v_gwan text; v_axis text; v_status text;
  v_mode text; v_msg text; v_code text; v_qual text;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;                          -- 업종 없는 리드(옛 기록 형식)는 업종 규칙 밖
  END IF;

  SELECT c.gwan_code, c.axis, c.status, r.mode, r.block_message, r.code, coalesce(r.qual_code, r.code)
    INTO v_gwan, v_axis, v_status, v_mode, v_msg, v_code, v_qual
    FROM categories c
    LEFT JOIN restricted_industries r
      ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
   WHERE c.id = NEW.category_id;

  /* INV-AX1 — 리드는 안심소개 상담 축에서만 생깁니다 */
  IF v_gwan IS DISTINCT FROM 'MAL' OR v_axis IS DISTINCT FROM 'CONSULT' THEN
    RAISE EXCEPTION 'LEAD_AXIS: 상담 신청은 안심소개 「생활·금융 상담」 업종에서만 만들 수 있습니다';
  END IF;

  /* D006 — 준비 중(PENDING) · 보관(ARCHIVED) 업종은 받지 않습니다 */
  IF v_status IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'LEAD_CATEGORY_CLOSED: 지금은 이 업종의 상담 신청을 받지 않습니다%',
      CASE WHEN v_msg IS NOT NULL THEN ' — ' || v_msg ELSE '' END;
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

COMMENT ON FUNCTION public.fn_lead_restricted_guard() IS
'상담 신청(리드) 생성 게이트. 안심소개 상담 축 · 공개 업종만 받고, BLOCK 은 거부, GATED 는 자격 승인 업체가 있어야 합니다(D005 · D006).';
