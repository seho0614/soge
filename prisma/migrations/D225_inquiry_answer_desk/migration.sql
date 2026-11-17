-- v10.333 (docs/464) — 운영 화면 「1:1 문의」 답변함
--   대표 11/17 「개발 후보 목록」 → 「① 1:1 문의 답변함」. 전에는 회원이 문의해도 운영 화면에서 답할 곳이 없었습니다(answer 칸만 있고 쓰는 길이 없음).
--   inquiries 에 칸 넷 · 접수 때 답변 기한을 채우는 트리거 · 기한 넘김 운영 알림 함수를 더합니다(지우는 문장 없음 · 다시 돌려도 같음).
--     answered_by  답한 운영자          due_at       답변 기한(접수 뒤 영업일 1일 · fn_business_day_after)
--     assignee_id  담당 운영자(선택)    staff_note   운영 메모(회원에게 안 보임 · 1,000자)
ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS answered_by uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS due_at      timestamptz,
  ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS staff_note  text;
DO $$ BEGIN
  ALTER TABLE public.inquiries ADD CONSTRAINT inquiries_staff_note_len CHECK (staff_note IS NULL OR char_length(staff_note) <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.inquiries.answered_by IS 'v10.333 (D225) 답한 운영자';
COMMENT ON COLUMN public.inquiries.due_at IS 'v10.333 (D225) 답변 기한 — 접수 뒤 영업일 1일(fn_business_day_after)';
COMMENT ON COLUMN public.inquiries.assignee_id IS 'v10.333 (D225) 담당 운영자(선택)';
COMMENT ON COLUMN public.inquiries.staff_note IS 'v10.333 (D225) 운영 메모 — 회원에게 보이지 않음';

CREATE OR REPLACE FUNCTION public.fn_inquiry_due() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.due_at IS NULL THEN NEW.due_at := public.fn_business_day_after(coalesce(NEW.created_at, now())); END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inquiry_due' AND tgrelid = 'public.inquiries'::regclass) THEN
    CREATE TRIGGER trg_inquiry_due BEFORE INSERT ON public.inquiries FOR EACH ROW EXECUTE FUNCTION public.fn_inquiry_due();
  END IF;
END $$;

UPDATE public.inquiries SET due_at = public.fn_business_day_after(created_at) WHERE due_at IS NULL;
CREATE INDEX IF NOT EXISTS inquiries_open_due_idx ON public.inquiries (due_at) WHERE status = 'OPEN';

-- 기한 넘김 운영 알림(정기 작업 sla_alert 가 검수와 함께 부름) — 같은 등급 열린 줄이 있으면 건수만 · 0건이면 풂(D177 과 같은 방식)
CREATE OR REPLACE FUNCTION public.fn_inquiry_due_alert() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n int; sev text; open_id bigint;
BEGIN
  SELECT count(*) INTO n FROM inquiries WHERE status = 'OPEN' AND due_at < now();
  IF n > 0 THEN
    sev := CASE WHEN n >= 10 THEN 'CRITICAL' ELSE 'WARN' END;
    SELECT id INTO open_id FROM ops_alerts
     WHERE alert_code = 'INQUIRY_DUE_BREACH' AND severity = sev AND acknowledged_at IS NULL AND resolved_at IS NULL
     ORDER BY raised_at DESC LIMIT 1;
    IF open_id IS NOT NULL THEN
      UPDATE ops_alerts SET detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('count', n, 'lastSeen', now()) WHERE id = open_id;
    ELSE
      INSERT INTO ops_alerts(alert_code, severity, title, detail)
      VALUES ('INQUIRY_DUE_BREACH', sev, format('1:1 문의 답변 기한 넘김 %s건', n), jsonb_build_object('count', n, 'lastSeen', now()))
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    UPDATE ops_alerts SET resolved_at = now(), resolve_note = '기한 넘긴 문의가 0건이 됨'
     WHERE alert_code = 'INQUIRY_DUE_BREACH' AND resolved_at IS NULL;
  END IF;
  RETURN n;
END $$;
COMMENT ON FUNCTION public.fn_inquiry_due_alert() IS 'v10.333 (D225) 답 안 한 1:1 문의가 기한(영업일 1일)을 넘기면 운영 알림 INQUIRY_DUE_BREACH(10건 이상 CRITICAL) · 0건이면 풂';
