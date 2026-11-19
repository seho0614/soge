-- v10.420 ~ 423 (docs/557 ~ 560) — 세무 · 노무 신고 자료(⑲): 원천세 이행상황신고서 · 근로소득 지급명세서 · 원천징수영수증 · 4대보험 취득 · 상실 신고 자료 · 산재 회사 부담 급여 전표
--   대표 11/19 20:35 「모두개발」. 주민등록번호 없음 · 값은 일반 원칙(docs/555). 다시 돌려도 같음.

/* ── v10.422 (D252 · docs/559) 4대보험 취득 · 상실 신고 처리함 — 쌓기만 · 직원 · 종류마다 한 번 ── */
CREATE TABLE IF NOT EXISTS public.acct_insurance_done (
  id           bigserial PRIMARY KEY,
  employee_id  bigint NOT NULL REFERENCES public.acct_employees(id),
  kind         text NOT NULL CHECK (kind IN ('ACQ', 'LOSS')),
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, kind)
);
COMMENT ON TABLE public.acct_insurance_done IS 'v10.422 (D252) 4대보험 취득(ACQ) · 상실(LOSS) 신고 「처리함」 — 직원 · 종류마다 한 번 · 쌓기만(고치기 · 지우기 막음)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_insurance_done_ro' AND tgrelid = 'public.acct_insurance_done'::regclass) THEN
    CREATE TRIGGER trg_acct_insurance_done_ro BEFORE UPDATE OR DELETE ON public.acct_insurance_done FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.insurance_alert', 'on', 'ADMIN', '4대보험 취득 · 상실 신고 기한(다음 달 15일) 3일 전부터 운영 알림 ACCT_INSURANCE_DUE — 직원이 있을 때만 생김(v10.422 · D252)', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_insurance', 1440, 9, 35, NULL, true, '4대보험 취득 · 상실 신고 기한 알림 ACCT_INSURANCE_DUE(같은 건 한 번 · 처리함 누르면 풀림) · D252 · v10.422')
ON CONFLICT (job) DO NOTHING;

/* ── v10.423 (D252 · docs/560) 산재보험 회사 부담 — 급여 줄 칸 company_ia(⑱ ia_company_rate × 과세 급여 · 10원 미만 버림) ──
 *   ADD COLUMN 은 행 트리거(확정 급여 고치기 막음)를 부르지 않음 · 이미 확정한 급여는 0 그대로(그 달 전표도 그대로). */
ALTER TABLE public.acct_payroll_lines ADD COLUMN IF NOT EXISTS company_ia bigint NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_apl_company_ia') THEN
    ALTER TABLE public.acct_payroll_lines ADD CONSTRAINT ck_apl_company_ia CHECK (company_ia >= 0);
  END IF;
END $$;
COMMENT ON COLUMN public.acct_payroll_lines.company_ia IS 'v10.423 (D252) 산재보험 회사 부담(과세 급여 × 산재 요율 · 회사만) — 급여 전표 보험료 · 예수금(4대보험)에 더함';

