-- v10.416 ~ 419 (docs/553 ~ 556) — 미해결 정리(⑱): 회계 메뉴 정리 · 품의 금액 지키기 · 회계 숫자 · 기한 · 일반 원칙 값 · 영어 · 공휴일
--   대표 11/19 19:55 「다음개발 미해결 문제」 → 4가지 모두 · 20:00 「세무사 · 노무사 확인 항목은 일반적인 원칙에 의해서 적용」.
--   ① 매입 · 경비 requisition_id · 품의 한도(REQ_OVER) · v_acct_req_spend  ② 기한 설정(급여 · 카드 알림 처음 꺼짐)  ③ 일반 원칙 값(계정 · 4대보험 · 산재 · 법인세 · 내용연수).
--   다시 돌려도 같음.

/* ── v10.417 (D251 · docs/554) 품의 금액 지키기 ─────────────────────────
 *   매입(acct_purchases) · 경비 청구(acct_expense_claims)에 requisition_id(⑯ acct_requisitions).
 *   한 품의에 여러 건을 붙일 수 있고, 붙인 것 합계(매입 합계 · 경비 금액 — 취소 · 반려 뺌)가
 *   품의 금액 × (100 + acct.req_tolerance_pct) / 100 을 넘으면 DB 가 막음(REQ_OVER) — 다시 품의.
 *   붙일 수 있는 품의 = 승인(APPROVED) 또는 이미 쓰는 중(USED) · 한 번 붙인 품의 번호는 바꾸지 않음(REQ_LINK_FIXED).
 *   처음 붙으면 품의는 USED(⑯ used_kind · used_ref · used_amount = 처음 붙은 것) · 품의별 쓴 돈 · 남은 돈은 v_acct_req_spend.
 *   매입 가드(fn_acct_purchase_guard) · 경비 가드의 「못 고치는 칸」에는 requisition_id 가 없어 이 가드가 따로 지킴.
 * ------------------------------------------------------------------- */
ALTER TABLE public.acct_purchases ADD COLUMN IF NOT EXISTS requisition_id bigint REFERENCES public.acct_requisitions(id);
ALTER TABLE public.acct_expense_claims ADD COLUMN IF NOT EXISTS requisition_id bigint REFERENCES public.acct_requisitions(id);
CREATE INDEX IF NOT EXISTS ix_acct_purchases_req ON public.acct_purchases (requisition_id) WHERE requisition_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_acct_expense_claims_req ON public.acct_expense_claims (requisition_id) WHERE requisition_id IS NOT NULL;

/* 품의별 쓴 돈 · 남은 돈 · 한도 */
CREATE OR REPLACE VIEW public.v_acct_req_spend AS
SELECT r.id, r.amount,
       coalesce((SELECT value FROM public.site_settings WHERE key = 'acct.req_tolerance_pct'), '10')::int AS tol_pct,
       floor(r.amount * (100 + coalesce((SELECT value FROM public.site_settings WHERE key = 'acct.req_tolerance_pct'), '10')::int) / 100.0)::bigint AS limit_amount,
       coalesce((SELECT sum(p.total) FROM public.acct_purchases p WHERE p.requisition_id = r.id AND p.state = 'ACTIVE'), 0)::bigint
     + coalesce((SELECT sum(c.amount) FROM public.acct_expense_claims c WHERE c.requisition_id = r.id AND c.state IN ('REQUESTED', 'APPROVED', 'PAID')), 0)::bigint AS spent,
       (SELECT count(*) FROM public.acct_purchases p WHERE p.requisition_id = r.id AND p.state = 'ACTIVE')::int
     + (SELECT count(*) FROM public.acct_expense_claims c WHERE c.requisition_id = r.id AND c.state IN ('REQUESTED', 'APPROVED', 'PAID'))::int AS links
  FROM public.acct_requisitions r;
COMMENT ON VIEW public.v_acct_req_spend IS 'v10.417 (D251) 품의별 붙인 매입 · 경비 합계(spent) · 한도(limit_amount = 금액 × (100 + 허용 %) / 100) · 건수';

CREATE OR REPLACE FUNCTION public.fn_acct_req_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record; tol int; lim bigint; used bigint; mine bigint; v_kind text;   -- v_ 앞머리: acct_purchases.kind 칸과 이름이 겹치면 plpgsql 이 모호하다고 막음
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.requisition_id IS NOT NULL AND NEW.requisition_id IS DISTINCT FROM OLD.requisition_id THEN
    RAISE EXCEPTION 'REQ_LINK_FIXED: 붙인 품의는 바꾸지 않습니다(취소하고 다시 넣으십시오).';
  END IF;
  IF NEW.requisition_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.requisition_id IS NOT DISTINCT FROM NEW.requisition_id THEN RETURN NEW; END IF;
  SELECT id, amount, state INTO q FROM public.acct_requisitions WHERE id = NEW.requisition_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'REQ_STATE: 없는 품의입니다.'; END IF;
  IF q.state NOT IN ('APPROVED', 'USED') THEN RAISE EXCEPTION 'REQ_STATE: 승인된 품의에만 붙입니다.'; END IF;
  tol := coalesce((SELECT value FROM public.site_settings WHERE key = 'acct.req_tolerance_pct'), '10')::int;
  lim := floor(q.amount * (100 + tol) / 100.0)::bigint;
  IF TG_TABLE_NAME = 'acct_purchases' THEN v_kind := 'PURCHASE'; mine := NEW.total; ELSE v_kind := 'EXPENSE'; mine := NEW.amount; END IF;
  used := coalesce((SELECT sum(p.total) FROM public.acct_purchases p WHERE p.requisition_id = q.id AND p.state = 'ACTIVE' AND NOT (v_kind = 'PURCHASE' AND p.id = NEW.id)), 0)
        + coalesce((SELECT sum(c.amount) FROM public.acct_expense_claims c WHERE c.requisition_id = q.id AND c.state IN ('REQUESTED', 'APPROVED', 'PAID') AND NOT (v_kind = 'EXPENSE' AND c.id = NEW.id)), 0);
  IF used + mine > lim THEN
    RAISE EXCEPTION 'REQ_OVER: 품의 금액(허용 비율 포함)을 넘습니다 — 다시 품의하십시오.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_purchases_req_link' AND tgrelid = 'public.acct_purchases'::regclass) THEN
    CREATE TRIGGER trg_acct_purchases_req_link BEFORE INSERT OR UPDATE OF requisition_id ON public.acct_purchases FOR EACH ROW EXECUTE FUNCTION public.fn_acct_req_link_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_expense_claims_req_link' AND tgrelid = 'public.acct_expense_claims'::regclass) THEN
    CREATE TRIGGER trg_acct_expense_claims_req_link BEFORE INSERT OR UPDATE OF requisition_id ON public.acct_expense_claims FOR EACH ROW EXECUTE FUNCTION public.fn_acct_req_link_guard();
  END IF;
END $$;

/* 처음 붙으면 품의를 USED 로(⑯ used_* = 처음 붙은 것 · 상태 앞으로만 가드 그대로) */
CREATE OR REPLACE FUNCTION public.fn_acct_req_link_used() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_kind text; amt bigint; who uuid;
BEGIN
  IF NEW.requisition_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.requisition_id IS NOT DISTINCT FROM NEW.requisition_id) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'acct_purchases' THEN v_kind := 'PURCHASE'; amt := NEW.total; who := NEW.created_by; ELSE v_kind := 'EXPENSE'; amt := NEW.amount; who := NEW.claimant; END IF;
  UPDATE public.acct_requisitions SET state = 'USED', used_kind = v_kind, used_ref = NEW.id, used_amount = amt, used_by = who, used_at = now()
   WHERE id = NEW.requisition_id AND state = 'APPROVED'
     AND NOT EXISTS (SELECT 1 FROM public.acct_requisitions x WHERE x.used_kind = v_kind AND x.used_ref = NEW.id);
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_purchases_req_used' AND tgrelid = 'public.acct_purchases'::regclass) THEN
    CREATE TRIGGER trg_acct_purchases_req_used AFTER INSERT OR UPDATE OF requisition_id ON public.acct_purchases FOR EACH ROW EXECUTE FUNCTION public.fn_acct_req_link_used();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_expense_claims_req_used' AND tgrelid = 'public.acct_expense_claims'::regclass) THEN
    CREATE TRIGGER trg_acct_expense_claims_req_used AFTER INSERT OR UPDATE OF requisition_id ON public.acct_expense_claims FOR EACH ROW EXECUTE FUNCTION public.fn_acct_req_link_used();
  END IF;
END $$;

/* ── v10.418 (D251 · docs/555) 급여 지급일 · 법인카드 대금일 기한 알림(처음 꺼짐) ──
 *   기한 목록(회계 › 월 결산 · GET /admin/acct/deadlines)에는 늘 나오고, 운영 알림 ACCT_DEADLINE 은 이 설정이 on 일 때만.
 *   법인세 중간예납 · 확정 기한(⑮ corpDeadlines)은 원천세 · 부가세와 같이 늘 알림. */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.deadline_payday', 'off', 'ADMIN', '급여 지급일(acct.pay_day) · 법인카드 대금일(acct.card_pay_day)도 기한 알림(ACCT_DEADLINE)으로 보낼지 — 처음 off(v10.418 · D251)', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ── v10.418 (docs/555) 일반 원칙 값 적용 — 대표 11/19 「세무사 · 노무사 확인 항목은 너가 구성하고 일반적인 원칙에 의해서 적용」 ──
 *   계정 코드 · 전표 규칙: 일반 계정과목 번호 · 일반기업회계기준 → 초안 표시 끔(draft = false).
 *   4대보험 2026: 국민연금 4.75 · 건강 3.595 · 장기요양 13.14(건강보험료의 %) · 고용 0.9 / 회사 1.15 · 산재(회사만) 0.7 → 초안 표시 끔.
 *   법인세 2026.1.1 이후 개시 사업연도: 2억 10% · 200억 20% · 3,000억 22% · 초과 25%(2025 세법 개정 — 확인 필요 표시) — 처음 값 그대로일 때만 바꿈.
 *   감가상각 기준내용연수(법인세법 시행규칙 별표5 · 정액법 · 잔존가치 0): 비품 · 차량 · 공구 5년 · 기계 8년 · 건물 40년 · 소프트웨어 5년.
 *   값은 해마다 SUPER 가 화면에서 고침(요율 고시 1월 · 7월 · 세법 개정). */
UPDATE public.acct_accounts SET draft = false WHERE draft AND ext_code IS NOT NULL;

ALTER TABLE public.acct_payroll_rates DROP CONSTRAINT IF EXISTS acct_payroll_rates_key_check;
ALTER TABLE public.acct_payroll_rates ADD CONSTRAINT acct_payroll_rates_key_check
  CHECK (key IN ('np_rate', 'np_base_min', 'np_base_max', 'hi_rate', 'ltc_rate', 'ei_rate', 'ei_company_rate', 'ia_company_rate'));
INSERT INTO public.acct_payroll_rates (year, key, value, draft) VALUES (2026, 'ia_company_rate', 0.7, false)
ON CONFLICT (year, key) DO NOTHING;
UPDATE public.acct_payroll_rates SET draft = false WHERE year = 2026 AND draft AND updated_by IS NULL;

UPDATE public.site_settings SET value = '200000000:10,20000000000:20,300000000000:22,*:25',
       description = coalesce(description, '') || ' · v10.418 2026.1.1 이후 개시 사업연도 세율(2025 세법 개정 · 확인 필요)'
 WHERE key = 'acct.corp_tax_brackets' AND value = '200000000:9,20000000000:19,300000000000:21,*:24';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.asset_life_defaults', 'FIXTURE:60,VEHICLE:60,TOOL:60,MACHINE:96,BUILDING:480,SOFTWARE:60', 'ADMIN',
        'v10.418 고정자산 종류별 기본 내용연수(달 · 법인세법 기준내용연수 · 정액법 · 잔존가치 0) — 자산 넣을 때 처음 값', false,
        '^([A-Z_]{2,20}:[0-9]{1,3})(,[A-Z_]{2,20}:[0-9]{1,3})*$', 'FIXTURE:60,BUILDING:480'),
       ('acct.policy_basis', 'GENERAL_2026', 'ADMIN',
        'v10.418 세무 · 노무 값의 근거 — GENERAL_2026(일반 원칙 · 2026 기준 · 대표 11/19) · 세무사 확인 뒤 CONFIRMED', false,
        '^(GENERAL_2026|CONFIRMED)$', 'GENERAL_2026')
ON CONFLICT (key) DO NOTHING;

