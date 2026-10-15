-- =====================================================================
-- D008 — 상담 신청(리드) 접수 · 자동 배정 · 외부 대조 어댑터 기록
--
--   전에는 리드를 **만드는 API 도, 파트너에게 보내는 API 도 없었습니다.**
--   시험은 leads · lead_deliveries 를 SQL 로 넣었고, 파트너센터
--   「상담 신청」 화면은 실제 운영에서 늘 비어 있게 됩니다.
--
--   이 파일이 만드는 것
--     1. leads          배정 상태(assign_state) · 목표 업체 수 · 배정 기한 · 신청자
--     2. lead_deliveries 배정 상태(state) · 열람 기한(expires_at) · 배정 방식 · 배정자
--     3. lead_assign_weights  파트너 등급별 배정 가중치 (공정 순환)
--     4. fn_lead_candidates   후보 업체와 탈락 사유 (자동 · 수동 · 화면이 같은 판정을 씀)
--     5. fn_lead_assign       배정 (자동 · 수동 · 재배정)
--     6. fn_lead_assign_tick  배치 — 기한 지난 배정 만료 · 회수 · 빈자리 채움 · 미배정 표시
--     7. trg_lead_delivery_guard  배정 규칙을 DB 가 집행
--          활동 중 파트너만 · 상담 축 업종만 · 그 업종의 승인 서비스 · GATED 자격 ·
--          한 리드 최대 업체 수 · 만료 · 회수된 배정은 열람 불가 · 열람한 배정은 회수 불가
--     8. broker_verifications.lookup_source · lookup_detail  (중개사 대조가 실제였는가)
--
--   바꾸지 않는 것
--     · 열람 = 과금(partner.service viewLead) · 반려 신청(D003) 규칙
--     · 업종 없는 옛 리드(SQL 로 넣던 형식) — assign_state 'LEGACY' 로 두고 자동 배정하지 않습니다.
--       옛 시험(srv_ptn · local-setup · attack-check)이 그대로 돕니다.
--
--   재실행 안전 — IF NOT EXISTS · ON CONFLICT · CREATE OR REPLACE 만 씁니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. leads — 배정 상태
-- ---------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assign_state text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS target_partners int NOT NULL DEFAULT 3;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assign_deadline timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS requester_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS close_reason text;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS ck_leads_assign_state;
ALTER TABLE public.leads ADD CONSTRAINT ck_leads_assign_state
  CHECK (assign_state IN ('LEGACY','OPEN','ASSIGNED','UNMATCHED','CLOSED'));
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS ck_leads_target_partners;
ALTER TABLE public.leads ADD CONSTRAINT ck_leads_target_partners
  CHECK (target_partners BETWEEN 1 AND 10);
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS ck_leads_source;
ALTER TABLE public.leads ADD CONSTRAINT ck_leads_source
  CHECK (source IN ('LEGACY','WEB','ADMIN'));
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS ck_leads_closed_reason;
ALTER TABLE public.leads ADD CONSTRAINT ck_leads_closed_reason
  CHECK (assign_state <> 'CLOSED' OR (closed_at IS NOT NULL AND coalesce(btrim(close_reason), '') <> ''));
/* 열람 전 무료로 보이는 요약에 연락처가 들어가면 과금 · 개인정보 격리가 통째로 무너집니다.
 * 옛 행은 검사하지 않고(NOT VALID) 새 행부터 막습니다. */
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS ck_leads_summary_no_phone;
ALTER TABLE public.leads ADD CONSTRAINT ck_leads_summary_no_phone
  CHECK (summary !~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}') NOT VALID;

COMMENT ON COLUMN public.leads.assign_state IS
  'LEGACY 배정 기능 이전(자동 배정 안 함) · OPEN 배정 대기 · ASSIGNED 배정 완료 · UNMATCHED 기한 안에 보낼 곳 없음(운영 확인) · CLOSED 운영 종료';
COMMENT ON COLUMN public.leads.target_partners IS '몇 곳에 보낼 것인가. 접수 때 lead.assign.target 값을 씁니다.';
COMMENT ON COLUMN public.leads.assign_deadline IS '이 시각까지 빈자리를 자동으로 채웁니다. 지나면 더 보내지 않습니다.';
COMMENT ON COLUMN public.leads.requester_account_id IS '상담을 신청한 회원. 신청자 본인 업체에는 보내지 않습니다.';

CREATE INDEX IF NOT EXISTS idx_leads_assign_queue
  ON public.leads (assign_state, assign_deadline) WHERE assign_state IN ('OPEN','UNMATCHED','ASSIGNED');
CREATE INDEX IF NOT EXISTS idx_leads_requester
  ON public.leads (requester_account_id, created_at DESC) WHERE requester_account_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. lead_deliveries — 배정 상태 · 열람 기한
-- ---------------------------------------------------------------------
ALTER TABLE public.lead_deliveries ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'DELIVERED';
ALTER TABLE public.lead_deliveries ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.lead_deliveries ADD COLUMN IF NOT EXISTS assign_mode text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE public.lead_deliveries ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.accounts(id);
ALTER TABLE public.lead_deliveries ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.lead_deliveries ADD COLUMN IF NOT EXISTS end_reason text;

ALTER TABLE public.lead_deliveries DROP CONSTRAINT IF EXISTS ck_lead_delivery_state;
ALTER TABLE public.lead_deliveries ADD CONSTRAINT ck_lead_delivery_state
  CHECK (state IN ('DELIVERED','VIEWED','EXPIRED','REVOKED'));
ALTER TABLE public.lead_deliveries DROP CONSTRAINT IF EXISTS ck_lead_delivery_mode;
ALTER TABLE public.lead_deliveries ADD CONSTRAINT ck_lead_delivery_mode
  CHECK (assign_mode IN ('LEGACY','AUTO','MANUAL','REASSIGN'));

-- 이미 열람한 행을 맞춥니다(트리거를 만들기 전에).
UPDATE public.lead_deliveries SET state = 'VIEWED'
 WHERE viewed_at IS NOT NULL AND state <> 'VIEWED';

COMMENT ON COLUMN public.lead_deliveries.state IS
  'DELIVERED 받음(미열람) · VIEWED 열람(과금) · EXPIRED 열람 기한 지남 · REVOKED 운영 회수. 끝난 배정은 열람할 수 없습니다.';
COMMENT ON COLUMN public.lead_deliveries.expires_at IS
  '이 시각까지 열지 않으면 다른 업체로 넘어갑니다(lead.assign.view_ttl_hours). 옛 행(LEGACY)은 비어 있고 만료되지 않습니다.';
COMMENT ON COLUMN public.lead_deliveries.assign_mode IS 'AUTO 배치 · MANUAL 운영 지정 · REASSIGN 회수 후 재배정 · LEGACY 배정 기능 이전';

CREATE INDEX IF NOT EXISTS idx_lead_delivery_due
  ON public.lead_deliveries (expires_at) WHERE state = 'DELIVERED';
CREATE INDEX IF NOT EXISTS idx_lead_delivery_partner_time
  ON public.lead_deliveries (partner_id, delivered_at DESC);

-- ---------------------------------------------------------------------
-- 3. 설정 · 가중치 · 배치 등록
-- ---------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('lead.assign.target', '3', 'GLOBAL',
   '상담 신청 한 건을 몇 곳에 보낼 것인가(접수 시점 값이 신청마다 저장됩니다).', false, '^([1-9]|10)$', '3'),
  ('lead.assign.max_partners', '5', 'GLOBAL',
   '한 상담 신청을 동시에 보낼 수 있는 최대 업체 수(수동 배정 포함). 신청자 개인정보가 그만큼 퍼집니다.', false, '^([1-9]|10)$', '5'),
  ('lead.assign.view_ttl_hours', '24', 'GLOBAL',
   '배정 후 이 시간 안에 열람하지 않으면 다른 업체로 넘어갑니다.', false, '^[1-9][0-9]{0,2}$', '24'),
  ('lead.assign.max_age_hours', '72', 'GLOBAL',
   '접수 후 이 시간까지만 빈자리를 자동으로 채웁니다. 지나도 보낼 곳이 없으면 미배정(UNMATCHED)으로 운영에 넘깁니다.', false, '^[1-9][0-9]{0,3}$', '72'),
  ('lead.intake.daily_limit', '5', 'GLOBAL',
   '한 회원이 하루에 낼 수 있는 상담 신청 수.', false, '^[1-9][0-9]?$', '5')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lead_assign_weights (
  grade      text PRIMARY KEY CHECK (grade IN ('BRONZE','SILVER','GOLD','PLATINUM')),
  weight     numeric NOT NULL CHECK (weight > 0 AND weight <= 10),
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lead_assign_weights IS
  '자동 배정 가중치(파트너 등급별). 최근 30일 받은 수 ÷ 가중치가 작은 업체부터, 같으면 가장 오래전에 받은 업체부터 보냅니다. '
  'lead_grade_rates(S~G)는 리드 품질 등급별 이용료 비율이라 업체 순번에 쓰지 않습니다.';
INSERT INTO public.lead_assign_weights (grade, weight, note) VALUES
  ('BRONZE',   1.0, '기본'),
  ('SILVER',   1.2, '같은 기간 약 1.2배'),
  ('GOLD',     1.5, '같은 기간 약 1.5배'),
  ('PLATINUM', 2.0, '같은 기간 약 2배')
ON CONFLICT (grade) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, is_active, description)
VALUES ('lead_assign', 10, true,
  '상담 신청 배정 — 열람 기한 지난 배정 만료 · 활동 멈춘 파트너 배정 회수 · 빈자리 자동 배정 · 기한 지나도 보낼 곳 없는 신청을 운영에 넘김')
ON CONFLICT (job) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_lead_setting_int(p_key text, p_default int) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT CASE WHEN value ~ '^[0-9]{1,6}$' THEN value::int END FROM site_settings WHERE key = p_key),
    p_default)
$$;

-- ---------------------------------------------------------------------
-- 4. 후보 판정 — 자동 배정 · 수동 배정 · 운영 화면이 모두 이것을 씁니다
--    (세 곳에서 따로 판정하면 화면에는 "가능" 인데 배정이 거부되는 일이 생깁니다)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lead_candidates(p_lead uuid)
RETURNS TABLE(partner_id uuid, company text, grade text, partner_status text,
              service_ok boolean, qual_ok boolean, region_ok boolean, cap_ok boolean,
              already boolean, self_deal boolean, eligible boolean, reasons text[],
              unpaid numeric, unpaid_cap numeric, reserved numeric, fee numeric,
              recent_30d int, last_assigned_at timestamptz, weight numeric, score numeric)
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
                      AND (g.sigungu = l.sigungu OR g.sigungu = '전체')) AS region_ok,
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
           coalesce(w.weight, 1) AS weight
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
         (x.pstatus = 'ACTIVE' AND x.service_ok AND x.qual_ok AND x.region_ok
          AND x.unpaid + x.reserved + x.fee <= x.unpaid_cap
          AND NOT x.already AND NOT x.self_deal) AS eligible,
         array_remove(ARRAY[
           CASE WHEN x.pstatus <> 'ACTIVE' THEN '활동 중 아님(' || x.pstatus || ')' END,
           CASE WHEN NOT x.service_ok THEN '이 업종의 승인된 서비스 없음' END,
           CASE WHEN NOT x.qual_ok    THEN '자격 심사 미통과' END,
           CASE WHEN NOT x.region_ok  THEN '활동 지역 밖' END,
           CASE WHEN x.unpaid + x.reserved + x.fee > x.unpaid_cap THEN '미납 한도 부족' END,
           CASE WHEN x.already        THEN '이미 배정함' END,
           CASE WHEN x.self_deal      THEN '신청자 본인 업체' END], NULL) AS reasons,
         x.unpaid, x.unpaid_cap, x.reserved, x.fee,
         x.recent_30d, x.last_at, x.weight,
         round(x.recent_30d / x.weight, 4) AS score
    FROM x
   ORDER BY 11 DESC, 20 ASC, 18 ASC NULLS FIRST, 1
$$;

COMMENT ON FUNCTION public.fn_lead_candidates(uuid) IS
'상담 신청 한 건의 후보 업체와 탈락 사유. 활동 중 · 그 업종 승인 서비스 · GATED 자격(qual_code) · 활동 지역(시군구, 「전체」는 시도 전체) · '
'미납 한도(미납 + 미열람 배정분 + 이번 이용료 ≤ 한도) · 중복 아님 · 신청자 본인 업체 아님. score 가 작을수록 먼저 받습니다.';

-- ---------------------------------------------------------------------
-- 5. 배정 트리거 — 앱을 거치지 않아도 규칙이 지켜지게
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

      v_cap := fn_lead_setting_int('lead.assign.max_partners', 5);
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

DROP TRIGGER IF EXISTS trg_lead_delivery_guard ON public.lead_deliveries;
CREATE TRIGGER trg_lead_delivery_guard
  BEFORE INSERT OR UPDATE ON public.lead_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_delivery_guard();

COMMENT ON FUNCTION public.fn_lead_delivery_guard() IS
'배정 규칙(D008). 활동 중 파트너만 · 상담 축 업종만 · 그 업종 승인 서비스 · GATED 자격(qual_code) · 한 리드 최대 업체 수 · '
'만료 · 회수된 배정 열람 불가 · 열람한 배정 회수 불가 · 끝난 배정 되살리기 불가. 같은 업체 중복은 UNIQUE(lead_id, partner_id).';

-- ---------------------------------------------------------------------
-- 6. 배정
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lead_assign(
  p_lead uuid, p_mode text, p_actor uuid DEFAULT NULL,
  p_partners uuid[] DEFAULT NULL, p_count int DEFAULT NULL)
RETURNS TABLE(delivery_id uuid, partner_id uuid, company text)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_lead   record;
  v_active int; v_need int; v_ttl int; v_cap int; v_cat text;
  v_pid    uuid; v_did uuid; v_ids uuid[] := '{}';
  c        record;
BEGIN
  IF p_mode NOT IN ('AUTO','MANUAL','REASSIGN') THEN
    RAISE EXCEPTION 'LEAD_ASSIGN: 배정 방식이 올바르지 않습니다 (%)', p_mode;
  END IF;
  SELECT l.* INTO v_lead FROM leads l WHERE l.id = p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_ASSIGN: 없는 상담 신청입니다'; END IF;
  IF v_lead.category_id IS NULL THEN
    RAISE EXCEPTION 'LEAD_ASSIGN: 업종이 없는 옛 형식 리드는 배정하지 않습니다';
  END IF;
  IF v_lead.assign_state = 'CLOSED' THEN
    RAISE EXCEPTION 'LEAD_ASSIGN: 종료된 상담 신청입니다';
  END IF;
  /* 자동 배정은 대기(OPEN) 건만. 운영이 손댄 미배정 · 레거시는 사람이 고릅니다 */
  IF p_mode = 'AUTO' AND v_lead.assign_state <> 'OPEN' THEN RETURN; END IF;

  v_ttl := fn_lead_setting_int('lead.assign.view_ttl_hours', 24);
  v_cap := fn_lead_setting_int('lead.assign.max_partners', 5);
  SELECT name INTO v_cat FROM categories WHERE id = v_lead.category_id;
  SELECT count(*) INTO v_active FROM lead_deliveries d
   WHERE d.lead_id = p_lead AND d.state IN ('DELIVERED','VIEWED');

  IF p_partners IS NULL THEN
    v_need := least(coalesce(p_count, v_lead.target_partners - v_active), v_cap - v_active);
    IF v_need <= 0 THEN
      IF p_mode <> 'AUTO' THEN
        RAISE EXCEPTION 'LEAD_ASSIGN: 이미 %곳에 보냈습니다 — 더 보내려면 업체를 직접 고르십시오(최대 %곳)', v_active, v_cap;
      END IF;
      RETURN;
    END IF;
    FOR c IN SELECT x.partner_id AS pid FROM fn_lead_candidates(p_lead) x
              WHERE x.eligible
              ORDER BY x.score, x.last_assigned_at NULLS FIRST, x.partner_id
              LIMIT v_need LOOP
      INSERT INTO lead_deliveries (lead_id, partner_id, expires_at, assign_mode, assigned_by)
      VALUES (p_lead, c.pid, now() + make_interval(hours => v_ttl), p_mode, p_actor)
      RETURNING id INTO v_did;
      v_ids := v_ids || v_did;
      delivery_id := v_did; partner_id := c.pid;
      SELECT b.company_name INTO company FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = c.pid;
      RETURN NEXT;
    END LOOP;
  ELSE
    IF coalesce(array_length(p_partners, 1), 0) = 0 THEN
      RAISE EXCEPTION 'LEAD_ASSIGN: 보낼 업체를 고르십시오';
    END IF;
    IF v_active + array_length(p_partners, 1) > v_cap THEN
      RAISE EXCEPTION 'LEAD_ASSIGN: 한 상담 신청은 최대 %곳까지만 보냅니다 (지금 %곳)', v_cap, v_active;
    END IF;
    FOREACH v_pid IN ARRAY p_partners LOOP
      SELECT x.* INTO c FROM fn_lead_candidates(p_lead) x WHERE x.partner_id = v_pid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'LEAD_ASSIGN: 이 업종(%)에 서비스를 등록하지 않은 업체입니다', v_cat;
      END IF;
      IF NOT c.eligible THEN
        RAISE EXCEPTION 'LEAD_ASSIGN: % — %', c.company, array_to_string(c.reasons, ' · ');
      END IF;
      INSERT INTO lead_deliveries (lead_id, partner_id, expires_at, assign_mode, assigned_by)
      VALUES (p_lead, v_pid, now() + make_interval(hours => v_ttl), p_mode, p_actor)
      RETURNING id INTO v_did;
      v_ids := v_ids || v_did;
      delivery_id := v_did; partner_id := v_pid; company := c.company;
      RETURN NEXT;
    END LOOP;
  END IF;

  /* 보낸 곳에 알립니다 — 알아야 기한 안에 엽니다 */
  INSERT INTO notifications (account_id, event_code, title, body, link_url)
  SELECT b.account_id, 'LEAD_DELIVERED', '새 상담 신청이 왔습니다',
         v_cat || ' · ' || coalesce(v_lead.sido, '') || ' ' || coalesce(v_lead.sigungu, '') ||
         ' — ' || v_ttl || '시간 안에 열지 않으면 다른 업체로 넘어갑니다. 연락처를 열 때 이용료가 발생합니다.',
         '/partner/leads'
    FROM lead_deliveries d
    JOIN partners p   ON p.id = d.partner_id
    JOIN businesses b ON b.id = p.business_id
   WHERE d.id = ANY (v_ids);

  SELECT count(*) INTO v_active FROM lead_deliveries d
   WHERE d.lead_id = p_lead AND d.state IN ('DELIVERED','VIEWED');
  UPDATE leads l
     SET assign_state = CASE
           WHEN v_active >= l.target_partners THEN 'ASSIGNED'
           WHEN v_active > 0 AND (l.assign_deadline IS NULL OR l.assign_deadline <= now()) THEN 'ASSIGNED'
           WHEN l.assign_deadline IS NOT NULL AND l.assign_deadline > now() THEN 'OPEN'
           ELSE l.assign_state END,
         assigned_at = CASE WHEN v_active >= l.target_partners THEN coalesce(l.assigned_at, now()) ELSE l.assigned_at END
   WHERE l.id = p_lead AND v_active > 0;
END $$;

COMMENT ON FUNCTION public.fn_lead_assign(uuid, text, uuid, uuid[], int) IS
'상담 신청 배정. p_partners 가 없으면 fn_lead_candidates 순서대로 빈자리만큼(또는 p_count) 고르고, 있으면 그 업체가 모두 후보 조건을 '
'만족해야 합니다(하나라도 아니면 전부 거부). 배정마다 열람 기한(lead.assign.view_ttl_hours)이 붙고 파트너에게 알림이 갑니다.';

-- ---------------------------------------------------------------------
-- 7. 배치 — job_schedules.lead_assign (10분)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lead_assign_tick(p_limit int DEFAULT 200)
RETURNS TABLE(expired int, revoked int, assigned int, touched int, unmatched int, failed int)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  r record; n int;
  v_exp int := 0; v_rev int := 0; v_asg int := 0; v_touch int := 0; v_un int := 0; v_fail int := 0;
BEGIN
  -- 1. 열람 기한이 지난 배정 — 신청자는 그동안 기다렸습니다
  WITH e AS (
    UPDATE lead_deliveries d
       SET state = 'EXPIRED', ended_at = now(), end_reason = '열람 기한 경과 — 다른 업체로 넘김'
     WHERE d.state = 'DELIVERED' AND d.expires_at IS NOT NULL AND d.expires_at <= now()
    RETURNING 1)
  SELECT count(*) INTO v_exp FROM e;

  -- 2. 정지 · 탈퇴한 파트너가 아직 안 연 배정 — 열 수도 없으니 회수합니다
  WITH e AS (
    UPDATE lead_deliveries d
       SET state = 'REVOKED', ended_at = now(), end_reason = '파트너 활동 중지 — 자동 회수'
      FROM partners p
     WHERE p.id = d.partner_id AND p.status <> 'ACTIVE'
       AND d.state = 'DELIVERED' AND d.expires_at IS NOT NULL
    RETURNING 1)
  SELECT count(*) INTO v_rev FROM e;

  -- 3. 빈자리가 생긴 배정 완료 건을 기한 안이면 다시 대기로
  UPDATE leads l SET assign_state = 'OPEN', assigned_at = NULL
   WHERE l.assign_state = 'ASSIGNED' AND l.assign_deadline > now()
     AND (SELECT count(*) FROM lead_deliveries d
           WHERE d.lead_id = l.id AND d.state IN ('DELIVERED','VIEWED')) < l.target_partners;

  -- 4. 빈자리 채우기. 한 건이 실패해도 나머지는 돕니다
  FOR r IN SELECT l.id FROM leads l
            WHERE l.assign_state = 'OPEN' AND l.assign_deadline > now()
            ORDER BY l.is_urgent DESC, l.created_at
            LIMIT p_limit LOOP
    BEGIN
      SELECT count(*) INTO n FROM fn_lead_assign(r.id, 'AUTO', NULL);
      v_asg := v_asg + n; v_touch := v_touch + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
    END;
  END LOOP;

  -- 5. 기한이 지난 대기 건 — 한 곳이라도 있으면 배정 완료, 없으면 미배정(운영 확인)
  WITH u AS (
    UPDATE leads l
       SET assign_state = CASE WHEN EXISTS (SELECT 1 FROM lead_deliveries d
                                             WHERE d.lead_id = l.id AND d.state IN ('DELIVERED','VIEWED'))
                               THEN 'ASSIGNED' ELSE 'UNMATCHED' END,
           assigned_at = coalesce(l.assigned_at, now())
     WHERE (l.assign_state = 'OPEN' AND l.assign_deadline <= now())
        OR (l.assign_state = 'ASSIGNED' AND l.assign_deadline <= now()
            AND NOT EXISTS (SELECT 1 FROM lead_deliveries d
                             WHERE d.lead_id = l.id AND d.state IN ('DELIVERED','VIEWED')))
    RETURNING l.assign_state AS st)
  SELECT count(*) FILTER (WHERE st = 'UNMATCHED') INTO v_un FROM u;

  RETURN QUERY SELECT v_exp, v_rev, v_asg, v_touch, v_un, v_fail;
END $$;

COMMENT ON FUNCTION public.fn_lead_assign_tick(int) IS
'상담 신청 배정 배치(lead_assign). 만료 → 회수 → 재대기 → 자동 배정 → 기한 지난 건 정리. 여러 번 불려도 안전합니다(배정은 리드 행 잠금 · UNIQUE).';

-- ---------------------------------------------------------------------
-- 8. 감시 뷰 (0 이어야 정상)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lead_delivery_gated_leak AS
SELECT d.id AS delivery_id, d.lead_id, d.partner_id, c.code AS category, coalesce(r.qual_code, r.code) AS qual
  FROM lead_deliveries d
  JOIN leads l      ON l.id = d.lead_id
  JOIN categories c ON c.id = l.category_id
  JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
  JOIN partners p   ON p.id = d.partner_id
 WHERE r.mode = 'GATED' AND d.state IN ('DELIVERED','VIEWED')
   AND NOT EXISTS (SELECT 1 FROM qualification_reviews q
                    WHERE q.business_id = p.business_id
                      AND q.category_code = coalesce(r.qual_code, r.code) AND q.state = 'APPROVED');
COMMENT ON VIEW public.v_lead_delivery_gated_leak IS
  '자격 없는 업체에 간 제한업종 상담 신청. **0이어야 정상** — 자격 없는 곳으로 소비자 개인정보가 넘어갑니다.';

CREATE OR REPLACE VIEW public.v_lead_delivery_overcap AS
SELECT l.id AS lead_id, count(*) AS active
  FROM leads l JOIN lead_deliveries d ON d.lead_id = l.id AND d.state IN ('DELIVERED','VIEWED')
 WHERE l.category_id IS NOT NULL
 GROUP BY l.id
HAVING count(*) > fn_lead_setting_int('lead.assign.max_partners', 5);
COMMENT ON VIEW public.v_lead_delivery_overcap IS '최대 업체 수를 넘겨 보낸 상담 신청. **0이어야 정상**.';

CREATE OR REPLACE VIEW public.v_lead_delivery_state_mismatch AS
SELECT d.id, d.state, d.viewed_at
  FROM lead_deliveries d
 WHERE (d.viewed_at IS NOT NULL AND d.state <> 'VIEWED')
    OR (d.viewed_at IS NULL AND d.state = 'VIEWED');
COMMENT ON VIEW public.v_lead_delivery_state_mismatch IS
  '열람 시각과 상태가 어긋난 배정. **0이어야 정상** — 만료 · 회수된 배정이 열렸거나 열람이 지워졌다는 뜻입니다.';

CREATE OR REPLACE VIEW public.v_lead_assign_stuck AS
SELECT l.id, l.created_at, l.assign_deadline
  FROM leads l
 WHERE l.assign_state = 'OPEN' AND l.assign_deadline < now() - interval '1 hour';
COMMENT ON VIEW public.v_lead_assign_stuck IS
  '배정 기한이 1시간 넘게 지났는데 대기 중인 상담 신청. **0이어야 정상** — 배치(lead_assign)가 돌지 않는다는 뜻입니다.';

/* C994 의 감시 뷰를 열람 모델에 맞춥니다.
 * 배정만으로는 연락처가 나가지 않습니다(요약만 보임) — 연락처는 **열람**에서만 나가고,
 * 열람은 pii.fn_read_lead_contact 로만 풀리며 기록이 남습니다. 미열람 배정을 잡으면
 * 배정 기능이 생긴 뒤로 이 뷰가 늘 0 이 아니게 됩니다. */
CREATE OR REPLACE VIEW public.v_lead_contact_unlogged AS
SELECT l.id AS lead_id, l.created_at
  FROM leads l
  JOIN pii.lead_contacts c ON c.lead_id = l.id
  JOIN lead_deliveries d   ON d.lead_id = l.id
 WHERE c.purged_at IS NULL
   AND d.viewed_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM audit.pii_access_logs a
                    WHERE a.lead_id = l.id AND a.access_type = 'VIEW');
COMMENT ON VIEW public.v_lead_contact_unlogged IS
  '업체가 열람했는데 연락처 열람 기록이 없는 리드. **0이어야 정상** — 기록 없이 개인정보가 나갔다는 뜻입니다(D008 — 미열람 배정은 제외).';

-- ---------------------------------------------------------------------
-- 9. 중개사 대조 — 실제 대조였는가
--    간주(assume.broker)로 찍힌 MATCH 와 국토부 · 브이월드 실조회 MATCH 를 구분합니다.
-- ---------------------------------------------------------------------
ALTER TABLE public.broker_verifications ADD COLUMN IF NOT EXISTS lookup_source text;
ALTER TABLE public.broker_verifications ADD COLUMN IF NOT EXISTS lookup_detail text;
ALTER TABLE public.broker_verifications DROP CONSTRAINT IF EXISTS ck_broker_lookup_source;
ALTER TABLE public.broker_verifications ADD CONSTRAINT ck_broker_lookup_source
  CHECK (lookup_source IS NULL OR lookup_source IN ('API','ASSUMED','MANUAL'));
UPDATE public.broker_verifications SET lookup_source = 'ASSUMED'
 WHERE lookup_result IS NOT NULL AND lookup_source IS NULL;
COMMENT ON COLUMN public.broker_verifications.lookup_source IS
  'API 실제 조회 · ASSUMED 간주(assume.broker, 대조 안 함) · MANUAL 운영 수기. 비면 미조회.';
COMMENT ON COLUMN public.broker_verifications.lookup_detail IS
  '대조 결과 설명(불일치 항목 · 조회 실패 사유). 신청자 · 운영에게 그대로 보입니다.';

CREATE OR REPLACE VIEW public.v_broker_verified_assumed AS
SELECT v.id, v.business_id, v.license_no, v.decided_at
  FROM broker_verifications v
 WHERE v.state = 'VERIFIED' AND v.lookup_source IS DISTINCT FROM 'API';
COMMENT ON VIEW public.v_broker_verified_assumed IS
  '실제 대조 없이(간주 · 수기) 승인된 중개사. 국토부 연동 후 재대조 대상입니다(관찰용 — 연동 전에는 0 이 아닙니다).';
