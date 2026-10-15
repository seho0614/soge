-- v10.31 (W5 · 10/10 시안 기준) — 상담 신청(SB-PTC-CTR-300) · 실적(CTR-500)의 등급 · 알림톡 · 메모 · 반려 한도
--
--   1) 등급 이름 · 비율을 시안대로: S · A+ · A · A- · B+ · B · B- · C (비율 100 · 85 · 72 · 60 · 48 · 33 · 22 · 12%)
--      내부 코드(S~G)는 그대로 두고(운영 · 다른 관 비율이 이 코드를 씀) **표시 이름(label)과 붙는 조건(alim_band)**을 더합니다.
--      공통 비율만 시안 값으로 바꾸고, 관 전용(소개몰 HLT) 비율은 그대로 둡니다(시안에 없음).
--   2) 리드마다 등급 · 알림톡 결과를 둡니다 — 알림톡 연동 전에는 NONE(미발송)이고 등급은 비어 있습니다(지어내지 않음).
--      등급이 있으면 확인비용 = 기준 단가 × 등급 비율, 없으면 기준 단가 그대로(지금까지와 같음).
--   3) 파트너 메모(배정 건마다 · 쌓임 — 시안 「메모는 memo_log 에 쌓입니다」)

ALTER TABLE public.lead_grade_rates ADD COLUMN label text;
ALTER TABLE public.lead_grade_rates ADD COLUMN alim_band text
  CHECK (alim_band IS NULL OR alim_band IN ('CONFIRMED','NO_RESPONSE','FAILED'));

/* 비율 단조 검사(지연 트리거)를 문장마다 돌려, 아래 ALTER 가 「대기 중인 트리거」에 걸리지 않게 합니다 */
SET CONSTRAINTS ALL IMMEDIATE;

UPDATE public.lead_grade_rates g
   SET label = v.label, alim_band = v.band
  FROM (VALUES ('S','S','CONFIRMED'), ('A','A+','CONFIRMED'), ('B','A','CONFIRMED'), ('C','A-','CONFIRMED'),
               ('D','B+','NO_RESPONSE'), ('E','B','NO_RESPONSE'), ('F','B-','NO_RESPONSE'), ('G','C','FAILED'))
         AS v(grade, label, band)
 WHERE g.grade = v.grade;

/* 공통 비율 — 시안 grade.ratio (단조 감소 트리거는 거래 끝에 봅니다) */
UPDATE public.lead_grade_rates g SET rate = v.rate
  FROM (VALUES ('S',1.00), ('A',0.85), ('B',0.72), ('C',0.60), ('D',0.48), ('E',0.33), ('F',0.22), ('G',0.12)) AS v(grade, rate)
 WHERE g.grade = v.grade AND g.gwan_code IS NULL;

ALTER TABLE public.lead_grade_rates ALTER COLUMN label SET NOT NULL;
COMMENT ON COLUMN public.lead_grade_rates.label IS '화면 이름(시안 S · A+ · A · A- · B+ · B · B- · C). 코드(grade S~G)는 그대로';
COMMENT ON COLUMN public.lead_grade_rates.alim_band IS '붙는 조건(알림톡) — CONFIRMED 확정 · NO_RESPONSE 미응답 · FAILED 발송실패';

/* 등급 표시 이름 */
CREATE FUNCTION public.fn_lead_grade_label(p_grade text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT label FROM lead_grade_rates WHERE grade = p_grade AND gwan_code IS NULL
$$;

-- ---------------------------------------------------------------------
-- 리드의 등급 · 알림톡 결과
-- ---------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN grade text
  CHECK (grade IS NULL OR grade IN ('S','A','B','C','D','E','F','G'));
ALTER TABLE public.leads ADD COLUMN alim_state text NOT NULL DEFAULT 'NONE'
  CHECK (alim_state IN ('NONE','SENT','CONFIRMED','NO_RESPONSE','FAILED','CANCELED'));
ALTER TABLE public.leads ADD COLUMN alim_at timestamptz;
ALTER TABLE public.leads ADD COLUMN graded_by uuid REFERENCES public.accounts(id);
COMMENT ON COLUMN public.leads.alim_state IS
  '요청자 확인 알림톡 결과 — NONE 미발송(연동 전) · SENT 발송 · CONFIRMED 확정 · NO_RESPONSE 미응답 · FAILED 발송실패 · CANCELED 취소';

/* 등급은 알림톡 결과의 대역 안에서만 — 확정이면 S~A-, 미응답이면 B+~B-, 발송실패면 C */
CREATE FUNCTION public.fn_lead_grade_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_band text;
BEGIN
  IF NEW.grade IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.grade IS NOT DISTINCT FROM OLD.grade AND NEW.alim_state = OLD.alim_state THEN RETURN NEW; END IF;
  SELECT alim_band INTO v_band FROM lead_grade_rates WHERE grade = NEW.grade AND gwan_code IS NULL;
  IF NEW.alim_state NOT IN ('CONFIRMED','NO_RESPONSE','FAILED') THEN
    RAISE EXCEPTION 'LEADGRADE: 알림톡 결과(확정 · 미응답 · 발송실패)가 있어야 등급을 붙일 수 있습니다';
  END IF;
  IF v_band IS DISTINCT FROM NEW.alim_state THEN
    RAISE EXCEPTION 'LEADGRADE: % 등급은 알림톡 「%」 결과에만 붙습니다', fn_lead_grade_label(NEW.grade),
      CASE v_band WHEN 'CONFIRMED' THEN '확정' WHEN 'NO_RESPONSE' THEN '미응답' ELSE '발송실패' END;
  END IF;
  /* 이미 연(과금된) 배정이 있으면 등급을 바꾸지 않습니다 — 낸 확인비용과 화면 등급이 어긋납니다 */
  IF TG_OP = 'UPDATE' AND OLD.grade IS DISTINCT FROM NEW.grade AND EXISTS (
       SELECT 1 FROM lead_fees f JOIN lead_deliveries d ON d.id = f.delivery_id WHERE d.lead_id = NEW.id) THEN
    RAISE EXCEPTION 'LEADGRADE: 이미 확인비용이 나간 리드는 등급을 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lead_grade_guard BEFORE INSERT OR UPDATE OF grade, alim_state ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_grade_guard();

-- ---------------------------------------------------------------------
-- 파트너 메모 — 배정 건마다 쌓입니다(고치거나 지우지 않음)
-- ---------------------------------------------------------------------
CREATE TABLE public.lead_delivery_memos (
  id           bigserial PRIMARY KEY,
  delivery_id  uuid NOT NULL REFERENCES public.lead_deliveries(id) ON DELETE CASCADE,
  partner_id   uuid NOT NULL REFERENCES public.partners(id),
  author_id    uuid REFERENCES public.accounts(id),
  body         text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ldm_delivery ON public.lead_delivery_memos(delivery_id, created_at DESC);

CREATE FUNCTION public.fn_lead_memo_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'LEADMEMO: 메모는 쌓기만 합니다 — 고치려면 새 메모를 남기십시오'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lead_deliveries d WHERE d.id = NEW.delivery_id AND d.partner_id = NEW.partner_id) THEN
    RAISE EXCEPTION 'LEADMEMO: 받은 리드가 아닙니다';
  END IF;
  /* 메모에 연락처를 적어 두면 보관 기한이 지나도 남습니다 */
  IF NEW.body ~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}' OR NEW.body ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN
    RAISE EXCEPTION 'LEADMEMO: 메모에 전화번호 · 이메일을 적지 마십시오 — 연락처는 보관 기한이 지나면 파기됩니다';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lead_memo_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lead_delivery_memos
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_memo_guard();

-- ---------------------------------------------------------------------
-- 반려 한도(시안 「반려 한도 3 / 15건 · 접수 21건의 15%」) — 트리거(fn_lead_fee_dispute_guard)와 같은 셈법
-- ---------------------------------------------------------------------
CREATE FUNCTION public.fn_lead_reject_cap(p_partner uuid)
RETURNS TABLE(month text, received int, used int, cap int) LANGUAGE sql STABLE AS $$
  WITH r AS (SELECT count(*)::int AS n FROM lead_deliveries
              WHERE partner_id = p_partner AND delivered_at >= date_trunc('month', now())),
       u AS (SELECT count(*)::int AS n FROM lead_fee_disputes
              WHERE partner_id = p_partner AND created_at >= date_trunc('month', now()))
  SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM'), r.n, u.n, greatest(1, ceil(r.n * 0.15)::int)
    FROM r, u
$$;
