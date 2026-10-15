-- =====================================================================
-- D018 — 상담 신청 흐름 · 축별 입점 신청 (2026-10-02 · 설계서 v1.3 §4)
--   (v10.4.7 kit 의 D008 「consult_request_flow」 를 이 kit 의 리드 배정(D008 「lead_assign_adapters」) 위에 얹었습니다)
--
--   소비자 상담 신청 → 휴대폰 확인 → 리드 생성 → 인증업체 1곳 배분
--   · 로그인 없이 신청합니다 — 소비자는 회원이 아니라 정보주체입니다(A-00R2)
--   · 확인 전에는 리드를 만들지 않습니다(INV-12) — 연락처는 신청 표에만 암호문으로 둡니다
--   · 배분은 1리드 = 1업체(INV-L1). 동의 문구가 「인증업체 1곳」입니다.
--   · 받을 업체가 없으면 NO_PARTNER 로 남기고 리드를 만들지 않습니다 —
--     아무도 받지 않을 신청의 연락처를 리드로 옮길 이유가 없습니다
--   · 6개월이 지나면 신청 표의 연락처를 지웁니다(purge_after) — 동의서에 적은 기간과 같습니다
--
--   ── 이 kit 에서 달라진 점 (v10.10 의 리드 배정을 그대로 씁니다) ──
--   · 배분은 fn_lead_assign('AUTO') 한 곳이 합니다. 후보 판정(fn_lead_candidates)에
--     「상담 축 입점 승인」 조건을 더했습니다 — 판정이 두 곳에 있으면 어긋납니다.
--   · 연락처는 배분되는 순간 pii.lead_contacts(C994)로 옮기고 신청 표에서는 지웁니다.
--     업체는 열람(=이용료)할 때만 연락처를 봅니다 — 열람 · 과금 · 반려 규칙은 그대로입니다.
--   · 배정받은 업체가 기한(24시간) 안에 열지 않으면 다른 1곳으로 넘어갑니다(fn_lead_assign_tick).
--     같은 때에 받은 업체는 항상 1곳입니다.
--   · 목표 · 최대 업체 수 기본값을 3 · 5 → 1 · 1 로 바꿉니다(운영자가 바꾼 값은 건드리지 않습니다).
--
--   재실행 안전 — IF NOT EXISTS · ON CONFLICT · CREATE OR REPLACE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 상담 신청 표
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consult_requests (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id     uuid NOT NULL REFERENCES public.categories(id),
  contact_enc     bytea,                                  -- 이름 · 휴대폰 (pgp_sym_encrypt) · 배분 · 파기 시 NULL
  phone_hash      text NOT NULL,                          -- 남용 판정용 sha256 — 원문 아님
  sido            text NOT NULL,
  sigungu         text,
  memo            text CHECK (memo IS NULL OR length(memo) <= 1000),
  consent_version text NOT NULL,
  consented_at    timestamptz NOT NULL,
  otp_hash        text,
  otp_expires_at  timestamptz,
  otp_tries       int NOT NULL DEFAULT 0 CHECK (otp_tries >= 0),
  state           text NOT NULL DEFAULT 'PENDING_VERIFY'
                  CHECK (state IN ('PENDING_VERIFY','DELIVERED','NO_PARTNER','EXPIRED','PURGED')),
  verified_at     timestamptz,
  lead_id         uuid REFERENCES public.leads(id),
  partner_id      uuid REFERENCES public.partners(id),
  requester_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  purge_after     timestamptz NOT NULL DEFAULT now() + interval '6 months',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_consult_delivered CHECK (state <> 'DELIVERED' OR (lead_id IS NOT NULL AND partner_id IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT ck_consult_lead_verified CHECK (lead_id IS NULL OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_consult_requests_phone ON public.consult_requests (phone_hash, created_at);
CREATE INDEX IF NOT EXISTS ix_consult_requests_requester
  ON public.consult_requests (requester_account_id, created_at DESC) WHERE requester_account_id IS NOT NULL;
COMMENT ON TABLE public.consult_requests IS
  '안심소개 상담 신청. 휴대폰 확인 전에는 리드가 없습니다(INV-12). 연락처는 암호문이며 배분되면 pii.lead_contacts 로 옮기고, purge_after 가 지나면 지웁니다.';
COMMENT ON COLUMN public.consult_requests.requester_account_id IS
  '로그인한 채 신청한 회원(없어도 됩니다). 「내 상담 신청」에 보이고, 신청자 본인 업체에는 보내지 않습니다.';

/* 신청 단계에서 업종을 먼저 거릅니다 — 받지 않는 업종의 연락처를 저장하지 않습니다 */
CREATE OR REPLACE FUNCTION public.fn_consult_request_guard() RETURNS trigger AS $$
DECLARE v_gwan text; v_axis text; v_status text;
BEGIN
  SELECT gwan_code, axis, status INTO v_gwan, v_axis, v_status FROM categories WHERE id = NEW.category_id;
  IF v_gwan IS DISTINCT FROM 'MAL' OR v_axis IS DISTINCT FROM 'CONSULT' THEN
    RAISE EXCEPTION 'CONSULT_AXIS: 상담 신청은 안심소개 「생활·금융 상담」 업종에서만 받습니다';
  END IF;
  IF v_status IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'CONSULT_CLOSED: 지금은 이 업종의 상담 신청을 받지 않습니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consult_request_guard ON public.consult_requests;
CREATE TRIGGER trg_consult_request_guard BEFORE INSERT ON public.consult_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_consult_request_guard();

-- ---------------------------------------------------------------------
-- 2. 1리드 = 1업체 — 목표 · 최대 업체 수 기본값
--    운영자가 이미 바꾼 값은 건드리지 않습니다(기본값 3 · 5 일 때만 1 · 1 로).
-- ---------------------------------------------------------------------
UPDATE public.site_settings
   SET value = '1', value_example = '1',
       description = '상담 신청 한 건을 몇 곳에 보낼 것인가(접수 시점 값이 신청마다 저장됩니다). '
                  || '동의 문구가 「인증업체 1곳」이라 1 입니다 — 늘리려면 동의 문구와 법무 확인을 먼저 바꾸십시오.'
 WHERE key = 'lead.assign.target' AND value = '3';
UPDATE public.site_settings
   SET value = '1', value_example = '1',
       description = '한 상담 신청을 같은 때에 받을 수 있는 최대 업체 수(수동 배정 포함). 신청자 개인정보가 그만큼 퍼집니다. '
                  || '동의 문구가 「인증업체 1곳」이라 1 입니다.'
 WHERE key = 'lead.assign.max_partners' AND value = '5';
UPDATE public.site_settings
   SET description = '같은 휴대폰 번호로 하루에 낼 수 있는 상담 신청 수.'
 WHERE key = 'lead.intake.daily_limit';
ALTER TABLE public.leads ALTER COLUMN target_partners SET DEFAULT 1;

-- ---------------------------------------------------------------------
-- 3. 후보 판정 — 「상담 축 입점 승인」 조건을 더합니다
--    (반환 칸이 늘어 DROP 후 다시 만듭니다. 맨 끝에 붙여 기존 순서를 지킵니다)
--    · 시군구 없이 낸 신청은 그 시도의 업체 전부가 후보입니다
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_lead_candidates(uuid);
CREATE FUNCTION public.fn_lead_candidates(p_lead uuid)
RETURNS TABLE(partner_id uuid, company text, grade text, partner_status text,
              service_ok boolean, qual_ok boolean, region_ok boolean, cap_ok boolean,
              already boolean, self_deal boolean, eligible boolean, reasons text[],
              unpaid numeric, unpaid_cap numeric, reserved numeric, fee numeric,
              recent_30d int, last_assigned_at timestamptz, weight numeric, score numeric,
              axis_ok boolean)
LANGUAGE sql STABLE AS $$
  WITH s AS (
    SELECT (SELECT value::numeric FROM site_settings
             WHERE key = 'lead.default_fee' AND value ~ '^[0-9]+$') AS dfee
  ), l AS (
    SELECT l.id, l.category_id, l.sido, l.sigungu, l.requester_account_id,
           coalesce(c.lead_fee, s.dfee, 0) AS fee,
           r.mode AS rmode, coalesce(r.qual_code, r.code) AS qual
      FROM leads l
      JOIN categories c ON c.id = l.category_id
      CROSS JOIN s
      LEFT JOIN restricted_industries r
        ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
     WHERE l.id = p_lead
  ), pool AS (
    SELECT DISTINCT ps.partner_id FROM partner_services ps JOIN l ON ps.category_id = l.category_id
    UNION
    SELECT d.partner_id FROM lead_deliveries d WHERE d.lead_id = p_lead
  ), x AS (
    SELECT p.id AS pid, b.company_name AS company, p.grade, p.status AS pstatus,
           EXISTS (SELECT 1 FROM partner_services ps
                    WHERE ps.partner_id = p.id AND ps.category_id = l.category_id
                      AND ps.status = 'APPROVED') AS service_ok,
           (l.rmode IS DISTINCT FROM 'GATED' OR EXISTS (
              SELECT 1 FROM qualification_reviews q
               WHERE q.business_id = p.business_id AND q.category_code = l.qual
                 AND q.state = 'APPROVED')) AS qual_ok,
           EXISTS (SELECT 1 FROM partner_regions g
                    WHERE g.partner_id = p.id AND g.sido = l.sido
                      AND (l.sigungu IS NULL OR g.sigungu = l.sigungu OR g.sigungu IN ('전체','*'))) AS region_ok,
           EXISTS (SELECT 1 FROM lead_deliveries d
                    WHERE d.lead_id = l.id AND d.partner_id = p.id) AS already,
           (l.requester_account_id IS NOT NULL AND b.account_id = l.requester_account_id) AS self_deal,
           coalesce((SELECT sum(f.amount) FROM lead_fees f
                      WHERE f.partner_id = p.id AND f.state = 'PENDING'), 0) AS unpaid,
           p.unpaid_cap,
           /* 아직 열지 않은 배정도 열면 청구됩니다 — 그만큼 한도를 잡아 둡니다 */
           coalesce((SELECT sum(coalesce(c2.lead_fee, s.dfee, 0))
                       FROM lead_deliveries d
                       JOIN leads l2 ON l2.id = d.lead_id
                       LEFT JOIN categories c2 ON c2.id = l2.category_id
                      WHERE d.partner_id = p.id AND d.state = 'DELIVERED'
                        AND d.expires_at IS NOT NULL AND d.expires_at > now()), 0) AS reserved,
           l.fee,
           (SELECT count(*)::int FROM lead_deliveries d
             WHERE d.partner_id = p.id AND d.state <> 'REVOKED'
               AND d.delivered_at > now() - interval '30 days') AS recent_30d,
           (SELECT max(d.delivered_at) FROM lead_deliveries d WHERE d.partner_id = p.id) AS last_at,
           coalesce(w.weight, 1) AS weight,
           EXISTS (SELECT 1 FROM mal_partner_axes ax
                    WHERE ax.business_id = p.business_id AND ax.axis = 'CONSULT'
                      AND ax.state = 'APPROVED') AS axis_ok
      FROM pool
      JOIN partners p   ON p.id = pool.partner_id
      JOIN businesses b ON b.id = p.business_id
      CROSS JOIN l CROSS JOIN s
      LEFT JOIN lead_assign_weights w ON w.grade = p.grade
  )
  SELECT x.pid, x.company, x.grade, x.pstatus,
         x.service_ok, x.qual_ok, x.region_ok,
         (x.unpaid + x.reserved + x.fee <= x.unpaid_cap) AS cap_ok,
         x.already, x.self_deal,
         (x.pstatus = 'ACTIVE' AND x.axis_ok AND x.service_ok AND x.qual_ok AND x.region_ok
          AND x.unpaid + x.reserved + x.fee <= x.unpaid_cap
          AND NOT x.already AND NOT x.self_deal) AS eligible,
         array_remove(ARRAY[
           CASE WHEN x.pstatus <> 'ACTIVE' THEN '활동 중 아님(' || x.pstatus || ')' END,
           CASE WHEN NOT x.axis_ok    THEN '상담 축 입점 승인 없음' END,
           CASE WHEN NOT x.service_ok THEN '이 업종의 승인된 서비스 없음' END,
           CASE WHEN NOT x.qual_ok    THEN '자격 심사 미통과' END,
           CASE WHEN NOT x.region_ok  THEN '활동 지역 밖' END,
           CASE WHEN x.unpaid + x.reserved + x.fee > x.unpaid_cap THEN '미납 한도 부족' END,
           CASE WHEN x.already        THEN '이미 배정함' END,
           CASE WHEN x.self_deal      THEN '신청자 본인 업체' END], NULL) AS reasons,
         x.unpaid, x.unpaid_cap, x.reserved, x.fee,
         x.recent_30d, x.last_at, x.weight,
         round(x.recent_30d / x.weight, 4) AS score,
         x.axis_ok
    FROM x
   ORDER BY 11 DESC, 20 ASC, 18 ASC NULLS FIRST, 1
$$;

COMMENT ON FUNCTION public.fn_lead_candidates(uuid) IS
'상담 신청 한 건의 후보 업체와 탈락 사유. 활동 중 · 상담 축 입점 승인(mal_partner_axes) · 그 업종 승인 서비스 · GATED 자격(qual_code) · '
'활동 지역(시군구, 「전체」는 시도 전체 · 신청에 시군구가 없으면 시도 전체) · 미납 한도(미납 + 미열람 배정분 + 이번 이용료 ≤ 한도) · '
'중복 아님 · 신청자 본인 업체 아님. score 가 작을수록 먼저 받습니다.';

-- ---------------------------------------------------------------------
-- 4. 배정 트리거 — 상담 축 입점 승인 없는 업체에는 보내지 않습니다(앱을 거치지 않아도)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lead_delivery_guard() RETURNS trigger AS $$
DECLARE
  v_status text; v_biz uuid; v_cat uuid; v_state text;
  v_axis text; v_mode text; v_qual text; v_active int; v_cap int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.status, p.business_id INTO v_status, v_biz FROM partners p WHERE p.id = NEW.partner_id;
    IF v_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'LEAD_ASSIGN: 활동 중인 파트너에게만 보낼 수 있습니다 (현재 %)', coalesce(v_status, '없음');
    END IF;

    SELECT l.category_id, l.assign_state INTO v_cat, v_state FROM leads l WHERE l.id = NEW.lead_id;
    IF v_state = 'CLOSED' THEN
      RAISE EXCEPTION 'LEAD_ASSIGN: 종료된 상담 신청은 보낼 수 없습니다';
    END IF;

    /* 업종 없는 옛 형식(LEGACY)은 업종 규칙 밖입니다 — fn_lead_restricted_guard 와 같습니다 */
    IF v_cat IS NOT NULL THEN
      SELECT c.axis, r.mode, coalesce(r.qual_code, r.code)
        INTO v_axis, v_mode, v_qual
        FROM categories c
        LEFT JOIN restricted_industries r
          ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
       WHERE c.id = v_cat;

      IF v_axis IS DISTINCT FROM 'CONSULT' THEN
        RAISE EXCEPTION 'LEAD_AXIS: 상담 신청은 안심소개 「생활·금융 상담」 업종만 보낼 수 있습니다';
      END IF;
      /* D018 — 안심소개는 축마다 입점 승인을 받은 인증업체만 받습니다 */
      IF NOT EXISTS (SELECT 1 FROM mal_partner_axes ax
                      WHERE ax.business_id = v_biz AND ax.axis = 'CONSULT' AND ax.state = 'APPROVED') THEN
        RAISE EXCEPTION 'LEAD_PARTNER_AXIS: 안심소개 상담 축 입점 승인을 받은 업체에만 보낼 수 있습니다';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM partner_services s
                      WHERE s.partner_id = NEW.partner_id AND s.category_id = v_cat
                        AND s.status = 'APPROVED') THEN
        RAISE EXCEPTION 'LEAD_ASSIGN: 이 업종의 승인된 서비스가 없는 파트너입니다';
      END IF;
      IF v_mode = 'BLOCK' THEN
        RAISE EXCEPTION 'LEAD_BLOCK: 이 업종은 상담 신청을 보낼 수 없습니다';
      END IF;
      IF v_mode = 'GATED' AND NOT EXISTS (
           SELECT 1 FROM qualification_reviews q
            WHERE q.business_id = v_biz AND q.category_code = v_qual AND q.state = 'APPROVED') THEN
        RAISE EXCEPTION 'LEAD_GATED: % 자격 심사를 통과한 파트너에게만 보낼 수 있습니다', v_qual;
      END IF;

      v_cap := fn_lead_setting_int('lead.assign.max_partners', 1);
      SELECT count(*) INTO v_active FROM lead_deliveries d
       WHERE d.lead_id = NEW.lead_id AND d.state IN ('DELIVERED','VIEWED');
      IF v_active >= v_cap THEN
        RAISE EXCEPTION 'LEAD_ASSIGN: 한 상담 신청은 최대 %곳까지만 보냅니다 — 신청자 개인정보가 그만큼 퍼집니다', v_cap;
      END IF;
    END IF;

    IF NEW.viewed_at IS NOT NULL THEN NEW.state := 'VIEWED'; END IF;
    IF NEW.state IN ('EXPIRED','REVOKED') THEN
      RAISE EXCEPTION 'LEAD_DELIVERY: 끝난 상태로 배정을 만들 수 없습니다';
    END IF;
    RETURN NEW;
  END IF;

  /* ── UPDATE ── */
  IF OLD.viewed_at IS NULL AND NEW.viewed_at IS NOT NULL THEN
    /* D018 — 열람할 때 자격을 다시 봅니다. 배정된 뒤에 업종이 자격 확인 업종으로 바뀌었거나(D016 이사짐 등)
     * 업체의 자격 승인이 풀렸으면, 열람(=연락처 전달)을 막습니다 — 자격 없는 곳으로 개인정보가 넘어갑니다. */
    SELECT p.business_id INTO v_biz FROM partners p WHERE p.id = NEW.partner_id;
    SELECT l.category_id INTO v_cat FROM leads l WHERE l.id = NEW.lead_id;
    IF v_cat IS NOT NULL THEN
      SELECT r.mode, coalesce(r.qual_code, r.code) INTO v_mode, v_qual
        FROM categories c
        LEFT JOIN restricted_industries r
          ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
       WHERE c.id = v_cat;
      IF v_mode = 'GATED' AND NOT EXISTS (
           SELECT 1 FROM qualification_reviews q
            WHERE q.business_id = v_biz AND q.category_code = v_qual AND q.state = 'APPROVED') THEN
        RAISE EXCEPTION 'LEAD_GATED: 자격 확인 업종입니다 — % 자격 심사를 통과한 뒤에 열람할 수 있습니다', v_qual;
      END IF;
    END IF;
    IF OLD.state IN ('EXPIRED','REVOKED') THEN
      RAISE EXCEPTION 'LEAD_DELIVERY: % 배정이라 열람할 수 없습니다 — 다른 업체로 넘어갔습니다',
        CASE OLD.state WHEN 'EXPIRED' THEN '열람 기한이 지난' ELSE '회수된' END;
    END IF;
    /* 배치가 아직 안 돌았어도 기한이 지났으면 열 수 없습니다 */
    IF OLD.expires_at IS NOT NULL AND OLD.expires_at <= now() THEN
      RAISE EXCEPTION 'LEAD_DELIVERY: 열람 기한이 지난 배정이라 열람할 수 없습니다 — 다른 업체로 넘어갑니다';
    END IF;
    NEW.state := 'VIEWED';
  END IF;
  IF OLD.viewed_at IS NOT NULL AND NEW.viewed_at IS DISTINCT FROM OLD.viewed_at THEN
    RAISE EXCEPTION 'LEAD_DELIVERY: 열람 기록은 바꿀 수 없습니다 — 이용료의 근거입니다';
  END IF;
  IF OLD.state = 'VIEWED' AND NEW.state <> 'VIEWED' THEN
    RAISE EXCEPTION 'LEAD_DELIVERY: 열람한 배정은 회수 · 만료할 수 없습니다 — 연락처가 이미 전달됐습니다';
  END IF;
  IF OLD.state IN ('EXPIRED','REVOKED') AND NEW.state IN ('DELIVERED','VIEWED') THEN
    RAISE EXCEPTION 'LEAD_DELIVERY: 끝난 배정은 되살릴 수 없습니다 — 새로 배정하십시오';
  END IF;
  IF NEW.state = 'VIEWED' AND NEW.viewed_at IS NULL THEN
    RAISE EXCEPTION 'LEAD_DELIVERY: 열람 시각 없이 열람 상태로 바꿀 수 없습니다';
  END IF;
  IF NEW.state IN ('EXPIRED','REVOKED') AND OLD.state = 'DELIVERED' THEN
    NEW.ended_at := coalesce(NEW.ended_at, now());
    IF coalesce(btrim(NEW.end_reason), '') = '' THEN
      RAISE EXCEPTION 'LEAD_DELIVERY: 만료 · 회수에는 사유가 필요합니다';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.fn_lead_delivery_guard() IS
'배정 규칙(D008 · D018). 활동 중 파트너만 · 상담 축 업종만 · 상담 축 입점 승인(mal_partner_axes) · 그 업종 승인 서비스 · GATED 자격(qual_code — 배정할 때와 열람할 때 모두) · '
'한 리드 최대 업체 수 · 만료 · 회수된 배정 열람 불가 · 열람한 배정 회수 불가 · 끝난 배정 되살리기 불가. 같은 업체 중복은 UNIQUE(lead_id, partner_id).';

/* 상담 축이 생기기 전에 입점 · 서비스 승인을 받은 파트너 — 다시 신청하게 하면 그날부터 상담을 못 받습니다.
 * 이미 본사 심사(입점 · 상담 업종 서비스 검수)를 통과한 곳이라 상담 축 승인으로 옮깁니다. 경위는 source 에 남깁니다. */
INSERT INTO public.mal_partner_axes (business_id, axis, state, source, reason, decided_at)
SELECT DISTINCT p.business_id, 'CONSULT', 'APPROVED', 'BULK_MIGRATION',
       '상담 축 입점 심사 도입(D018) 전에 입점 · 상담 업종 서비스 승인을 받은 파트너', now()
  FROM partners p
 WHERE p.status = 'ACTIVE'
   AND EXISTS (SELECT 1 FROM partner_services s JOIN categories c ON c.id = s.category_id
                WHERE s.partner_id = p.id AND s.status = 'APPROVED' AND c.axis = 'CONSULT')
ON CONFLICT (business_id, axis) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. 받을 수 있는 업체 — 업종 목록의 「인증업체 N곳」
--    (실제 배분 판정은 fn_lead_candidates 입니다. 여기는 신청 전에 보여 주는 수라 리드 없이 셉니다)
-- ---------------------------------------------------------------------
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
  LEFT JOIN restricted_industries ri ON ri.code = c.restricted_code AND ri.gwan_code = c.gwan_code AND ri.is_active
 WHERE p.status = 'ACTIVE'
   AND (ri.mode IS NULL OR ri.mode <> 'BLOCK')
   AND (ri.mode IS DISTINCT FROM 'GATED' OR EXISTS (
         SELECT 1 FROM qualification_reviews q
          WHERE q.business_id = b.id AND q.state = 'APPROVED'
            AND q.category_code = coalesce(ri.qual_code, ri.code)));
COMMENT ON VIEW public.v_consult_eligible_partner IS
  '상담 리드를 받을 수 있는 업체 × 업종 × 지역. 상담 축 입점 승인 · 서비스 승인 · 지역 · 미납 한도 · GATED 자격을 모두 봅니다.';

-- ---------------------------------------------------------------------
-- 6. 배분 — 확인된 신청을 리드로 만들어 1곳에. 같은 신청을 두 번 배분하지 않습니다.
--    리드 생성 · 연락처 이관 · 배정을 한 덩어리(안쪽 블록)로 묶어, 받을 업체가 없으면 전부 되돌립니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_consult_deliver(p_request uuid)
RETURNS TABLE(state text, partner_id uuid, lead_id uuid)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  r         consult_requests%ROWTYPE;
  v_partner uuid; v_lead uuid; v_name text; v_summary text;
  v_contact jsonb; v_target int; v_maxage int;
BEGIN
  SELECT cr.* INTO r FROM consult_requests cr WHERE cr.id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONSULT_NOT_FOUND: 상담 신청이 없습니다'; END IF;
  IF r.verified_at IS NULL THEN
    RAISE EXCEPTION 'CONSULT_UNVERIFIED: 휴대폰 확인 전에는 업체에 전달하지 않습니다';
  END IF;
  IF r.state = 'DELIVERED' THEN
    RETURN QUERY SELECT r.state, r.partner_id, r.lead_id; RETURN;
  END IF;
  IF r.state IN ('EXPIRED','PURGED') OR r.contact_enc IS NULL THEN
    RAISE EXCEPTION 'CONSULT_EXPIRED: 만료된 신청입니다 — 다시 신청해 주십시오';
  END IF;

  SELECT name INTO v_name FROM categories WHERE id = r.category_id;
  v_contact := pgp_sym_decrypt(r.contact_enc, fn_enc_key())::jsonb;
  /* 요약은 열람 전 업체에 무료로 보입니다 — 연락처가 섞인 메모는 요약으로 쓰지 않습니다(ck_leads_summary_no_phone) */
  v_summary := nullif(btrim(left(coalesce(r.memo, ''), 500)), '');
  IF v_summary IS NULL OR v_summary ~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}' THEN
    v_summary := v_name || ' 상담 신청';
  END IF;
  v_target := fn_lead_setting_int('lead.assign.target', 1);
  v_maxage := fn_lead_setting_int('lead.assign.max_age_hours', 72);

  BEGIN
    INSERT INTO leads (category_id, sido, sigungu, summary,
                       assign_state, target_partners, assign_deadline, requester_account_id, source)
    VALUES (r.category_id, r.sido, r.sigungu, v_summary,
            'OPEN', v_target, now() + make_interval(hours => v_maxage), r.requester_account_id, 'WEB')
    RETURNING id INTO v_lead;
    PERFORM pii.fn_save_lead_contact(v_lead, v_contact->>'name', v_contact->>'phone', NULL,
                                     nullif(btrim(coalesce(r.memo, '')), ''));
    SELECT a.partner_id INTO v_partner FROM fn_lead_assign(v_lead, 'AUTO', NULL) a LIMIT 1;
    IF v_partner IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'SGB01', MESSAGE = 'no partner';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'SGB01' THEN
      v_lead := NULL; v_partner := NULL;                   -- 리드 · 연락처 이관을 되돌립니다
    WHEN raise_exception THEN
      /* GATED 업종에 자격 승인 업체가 한 곳도 없으면 리드 생성 자체가 막힙니다 — 받을 업체 없음과 같습니다 */
      IF SQLERRM LIKE 'LEAD_GATED%' THEN v_lead := NULL; v_partner := NULL;
      ELSE RAISE; END IF;
  END;

  IF v_partner IS NULL THEN
    UPDATE consult_requests SET state = 'NO_PARTNER' WHERE id = r.id;
    RETURN QUERY SELECT 'NO_PARTNER'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  /* 배분되면 연락처는 pii.lead_contacts 한 곳에만 둡니다 */
  UPDATE consult_requests
     SET state = 'DELIVERED', lead_id = v_lead, partner_id = v_partner, contact_enc = NULL
   WHERE id = r.id;
  RETURN QUERY SELECT 'DELIVERED'::text, v_partner, v_lead;
END $$;
COMMENT ON FUNCTION public.fn_consult_deliver(uuid) IS
  '휴대폰 확인된 상담 신청을 리드로 만들어 1곳에 배분(INV-12 · INV-L1). 배분은 fn_lead_assign(AUTO)이 합니다. '
  '받을 업체가 없으면 리드를 만들지 않고 NO_PARTNER. 이미 배분된 신청은 그대로 돌려줍니다.';

/* INV-12 감시 — 확인 안 된 신청에서 나온 리드 */
CREATE OR REPLACE VIEW public.v_consult_lead_unverified AS
SELECT cr.id, cr.lead_id FROM consult_requests cr WHERE cr.lead_id IS NOT NULL AND cr.verified_at IS NULL;
COMMENT ON VIEW public.v_consult_lead_unverified IS 'INV-12 — 휴대폰 확인 없이 리드가 된 상담 신청. **0이어야 정상**.';

/* INV-L1 감시 — 같은 때에 두 곳 이상이 받은 상담 리드.
 * 기한이 지나 다른 곳으로 넘어간 배정(EXPIRED · REVOKED)은 세지 않습니다 — 그 업체는 연락처를 받지 못했습니다. */
CREATE OR REPLACE VIEW public.v_lead_multi_delivery AS
SELECT d.lead_id, count(*) AS n FROM lead_deliveries d
  JOIN consult_requests cr ON cr.lead_id = d.lead_id
 WHERE d.state IN ('DELIVERED','VIEWED')
 GROUP BY d.lead_id HAVING count(*) > 1;
COMMENT ON VIEW public.v_lead_multi_delivery IS 'INV-L1 — 상담 리드를 같은 때에 두 곳 이상이 받음. **0이어야 정상** — 동의 문구는 「인증업체 1곳」입니다.';

/* 6개월 지난 연락처 파기 — 배치(pii_purge)가 부릅니다 */
CREATE OR REPLACE FUNCTION public.fn_consult_purge() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE consult_requests
     SET contact_enc = NULL, otp_hash = NULL, memo = NULL, state = CASE WHEN state = 'DELIVERED' THEN state ELSE 'PURGED' END
   WHERE purge_after < now() AND (contact_enc IS NOT NULL OR memo IS NOT NULL OR state NOT IN ('PURGED','DELIVERED'));
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE consult_requests SET state = 'EXPIRED', otp_hash = NULL, contact_enc = NULL
   WHERE state = 'PENDING_VERIFY' AND created_at < now() - interval '1 day';
  RETURN n;
END $$;
COMMENT ON FUNCTION public.fn_consult_purge() IS
  '상담 신청 연락처 파기(6개월) · 확인 안 된 신청 하루 뒤 만료(연락처도 함께 지움). pii_purge 배치가 부릅니다.';

CREATE OR REPLACE VIEW public.v_consult_purge_overdue AS
SELECT cr.id, cr.purge_after FROM consult_requests cr
 WHERE cr.contact_enc IS NOT NULL AND cr.purge_after < now() - interval '2 days';
COMMENT ON VIEW public.v_consult_purge_overdue IS
  '파기 기한이 이틀 넘게 지났는데 연락처가 남은 상담 신청. **0이어야 정상** — 배치(pii_purge)가 돌지 않는다는 뜻입니다.';

-- ---------------------------------------------------------------------
-- 7. 축별 입점 판정 — 반려는 사유 필수, 부동산 승인은 중개사 인증 필수
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_mal_partner_axes_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.state = 'REJECTED' AND length(btrim(coalesce(NEW.reason, ''))) < 5 THEN
    RAISE EXCEPTION 'AXIS_REASON: 반려 사유를 5자 이상 적어 주십시오 — 신청자에게 그대로 보입니다';
  END IF;
  IF NEW.state = 'APPROVED' AND NEW.axis = 'RE' AND NOT EXISTS (
       SELECT 1 FROM businesses b WHERE b.id = NEW.business_id AND fn_is_verified_broker(b.account_id)) THEN
    RAISE EXCEPTION 'AXIS_BROKER: 부동산 축은 개업공인중개사 인증을 통과해야 승인할 수 있습니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mal_partner_axes_guard ON public.mal_partner_axes;
CREATE TRIGGER trg_mal_partner_axes_guard BEFORE INSERT OR UPDATE ON public.mal_partner_axes
  FOR EACH ROW EXECUTE FUNCTION public.fn_mal_partner_axes_guard();

-- ---------------------------------------------------------------------
-- 8. 업종이 「자격 확인 업종」으로 바뀐 때를 남깁니다 (mode_since)
--    D016 이 이사짐 · 렌터카(→ 자동차)를 일반 → 자격 확인(GATED)으로 바꿨습니다.
--    · 바뀌기 전에 이미 간 배정은 그때 규칙으로는 정상입니다 — 감시 뷰가 그것까지 위반으로 세면
--      진짜 누수가 묻힙니다. 규칙이 생긴 뒤의 것만 셉니다.
--    · 바뀌기 전에 배정됐지만 **아직 열지 않은** 것은 거둡니다 — 그대로 두면 자격 없는 업체가
--      지금 열어 연락처를 받아 갑니다(열람 시점 자격 확인은 위 4번이 막습니다).
-- ---------------------------------------------------------------------
ALTER TABLE public.restricted_industries ADD COLUMN IF NOT EXISTS mode_since timestamptz;
UPDATE public.restricted_industries SET mode_since = CASE
         WHEN gwan_code = 'MAL' AND code IN ('CSL_MOVING','CSL_INTERIOR','CSL_CONSTRUCTION','CSL_AUTO','CSL_TRAVEL',
                                             'CSL_EDU','CSL_LOGISTICS','CSL_LEGAL','CSL_TAX')
         THEN coalesce((SELECT applied_at FROM schema_migrations WHERE name = 'D016_consult_categories_v2'), now())
         ELSE '-infinity'::timestamptz END
 WHERE mode_since IS NULL;
ALTER TABLE public.restricted_industries ALTER COLUMN mode_since SET DEFAULT now();
ALTER TABLE public.restricted_industries ALTER COLUMN mode_since SET NOT NULL;
COMMENT ON COLUMN public.restricted_industries.mode_since IS
  '지금의 mode(BLOCK · GATED …)가 적용되기 시작한 때. 감시 뷰는 이 뒤에 생긴 리드 · 배정만 위반으로 셉니다. 옛 규칙은 -infinity.';

CREATE OR REPLACE FUNCTION public.fn_restricted_mode_since() RETURNS trigger AS $$
BEGIN
  IF NEW.mode IS DISTINCT FROM OLD.mode OR (NEW.is_active AND NOT OLD.is_active) THEN
    NEW.mode_since := now();
  ELSE
    NEW.mode_since := OLD.mode_since;      -- 문구만 고친 것으로는 기준 시각이 움직이지 않습니다
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_restricted_mode_since ON public.restricted_industries;
CREATE TRIGGER trg_restricted_mode_since BEFORE UPDATE ON public.restricted_industries
  FOR EACH ROW EXECUTE FUNCTION public.fn_restricted_mode_since();

CREATE OR REPLACE VIEW public.v_lead_delivery_gated_leak AS
SELECT d.id AS delivery_id, d.lead_id, d.partner_id, c.code AS category, coalesce(r.qual_code, r.code) AS qual
  FROM lead_deliveries d
  JOIN leads l      ON l.id = d.lead_id
  JOIN categories c ON c.id = l.category_id
  JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
  JOIN partners p   ON p.id = d.partner_id
 WHERE r.mode = 'GATED' AND d.state IN ('DELIVERED','VIEWED')
   /* 자격 확인 업종이 되기 전에 **열람까지 끝난** 배정은 그때 규칙으로 정상입니다. 아직 안 연 배정은 언제 갔든 셉니다. */
   AND (d.state = 'DELIVERED' OR d.viewed_at >= r.mode_since)
   AND NOT EXISTS (SELECT 1 FROM qualification_reviews q
                    WHERE q.business_id = p.business_id
                      AND q.category_code = coalesce(r.qual_code, r.code) AND q.state = 'APPROVED');
COMMENT ON VIEW public.v_lead_delivery_gated_leak IS
  '자격 없는 업체에 간 제한업종 상담 신청. **0이어야 정상** — 자격 없는 곳으로 소비자 개인정보가 넘어갑니다. '
  '자격 확인 업종이 되기 전에 열람이 끝난 배정은 세지 않습니다(mode_since).';

CREATE OR REPLACE VIEW public.v_lead_restricted_leak AS
SELECT l.id, l.created_at, c.name AS category, r.code AS restricted, r.mode
  FROM leads l
  JOIN categories c ON c.id = l.category_id
  JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
 WHERE l.created_at >= r.mode_since
   AND (r.mode = 'BLOCK' OR (r.mode = 'GATED' AND NOT EXISTS (
          SELECT 1 FROM qualification_reviews qr
           WHERE qr.category_code = coalesce(r.qual_code, r.code) AND qr.state = 'APPROVED')));
COMMENT ON VIEW public.v_lead_restricted_leak IS
  '받을 수 없는 제한업종(BLOCK · 자격 승인 업체가 없는 GATED)에 생긴 리드. **0이어야 정상**. 규칙이 생기기 전의 리드는 세지 않습니다(mode_since).';

/* 한 신청의 최대 업체 수 — 신청마다 접수 때의 목표 수(target_partners)가 저장돼 있습니다.
 * 설정을 3 → 1 로 낮춘 뒤에도 예전 신청(목표 3)은 그 수까지 정상입니다. */
CREATE OR REPLACE VIEW public.v_lead_delivery_overcap AS
SELECT l.id AS lead_id, count(*) AS active
  FROM leads l JOIN lead_deliveries d ON d.lead_id = l.id AND d.state IN ('DELIVERED','VIEWED')
 WHERE l.category_id IS NOT NULL
 GROUP BY l.id, l.target_partners
HAVING count(*) > greatest(fn_lead_setting_int('lead.assign.max_partners', 1), l.target_partners);
COMMENT ON VIEW public.v_lead_delivery_overcap IS
  '최대 업체 수(설정과 그 신청의 접수 때 목표 수 중 큰 값)를 넘겨 보낸 상담 신청. **0이어야 정상**.';

/* 자격 확인 업종이 되기 전에 배정됐고 아직 열지 않은 것 — 자격 없는 업체의 것은 거둡니다.
 * 신청은 배치(lead_assign)가 기한 안이면 자격 있는 업체로 다시 보내고, 없으면 미배정으로 운영에 넘깁니다. */
UPDATE public.lead_deliveries d
   SET state = 'REVOKED',
       end_reason = '업종이 자격 확인 업종으로 바뀜 — 자격 심사를 통과한 업체에만 보냅니다(D016 · D018)'
  FROM leads l, categories c, restricted_industries r, partners p
 WHERE l.id = d.lead_id AND c.id = l.category_id AND p.id = d.partner_id
   AND r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active AND r.mode = 'GATED'
   AND d.state = 'DELIVERED'
   AND NOT EXISTS (SELECT 1 FROM qualification_reviews q
                    WHERE q.business_id = p.business_id
                      AND q.category_code = coalesce(r.qual_code, r.code) AND q.state = 'APPROVED');

