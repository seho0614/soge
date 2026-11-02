-- =====================================================================
-- D168 · 운영 알림 확인 · 개인정보 접속기록 월 점검 (v10.179 · 2026-11-03 · sgb-core docs/279)
--   대표 「다음 개발」 → 「모두」(11/2)
--   ① ops_alerts.ack_note — 「확인」할 때 남기는 메모(200자 · 선택). 확인한 사람 · 때는 옛 칸(acknowledged_by · acknowledged_at)
--      확인은 한 번만 — 확인한 알림을 다시 「확인 안 함」으로 돌리거나 고치지 못함(fn_ops_alert_ack_guard)
--   ② audit.pii_reviews — 개인정보 접속기록 월 점검 기록(한 달에 한 번 · 고치거나 지울 수 없음)
--   ③ 설정 pii.review_flag_daily(50) — 운영자 한 사람이 하루에 이 수 이상 개인정보를 보면 점검 화면에 「살펴볼 것」 표시
--   지우는 문장 없음 · 재실행 안전
-- =====================================================================

-- 1. 운영 알림 확인 메모 ----------------------------------------------------
ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS ack_note text;
ALTER TABLE public.ops_alerts DROP CONSTRAINT IF EXISTS ck_ops_alerts_ack_note;
ALTER TABLE public.ops_alerts ADD CONSTRAINT ck_ops_alerts_ack_note CHECK (ack_note IS NULL OR length(ack_note) <= 200);
COMMENT ON COLUMN public.ops_alerts.ack_note IS '「확인」할 때 남긴 메모(D168 · 선택 · 200자).';
CREATE INDEX IF NOT EXISTS ix_ops_alerts_open ON public.ops_alerts (alert_code, raised_at DESC) WHERE acknowledged_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_ops_alert_ack_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.acknowledged_at IS NOT NULL AND (NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
       OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by OR NEW.ack_note IS DISTINCT FROM OLD.ack_note) THEN
    RAISE EXCEPTION 'ALERT_ACKED: 이미 확인한 알림입니다 — 확인 기록은 바꿀 수 없습니다';
  END IF;
  IF NEW.alert_code IS DISTINCT FROM OLD.alert_code OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.raised_at IS DISTINCT FROM OLD.raised_at THEN
    RAISE EXCEPTION 'ALERT_FIXED: 알림 내용은 바꿀 수 없습니다 — 확인만 됩니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ops_alert_ack_guard ON public.ops_alerts;
CREATE TRIGGER trg_ops_alert_ack_guard BEFORE UPDATE ON public.ops_alerts
  FOR EACH ROW EXECUTE FUNCTION public.fn_ops_alert_ack_guard();

-- 2. 개인정보 접속기록 월 점검 ----------------------------------------------
CREATE TABLE IF NOT EXISTS audit.pii_reviews (
  month        date PRIMARY KEY CHECK (month = date_trunc('month', month)::date),
  reviewed_by  uuid NOT NULL REFERENCES public.accounts(id),
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  note         text NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 1000),
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb
);
COMMENT ON TABLE audit.pii_reviews IS
  '개인정보 접속기록 월 점검(D168 · v10.179). 한 달에 한 줄 — 누가 언제 점검했고 무엇을 봤는지(요약 · 살펴볼 것 · 메모). 고치거나 지울 수 없습니다.';
DROP TRIGGER IF EXISTS trg_pii_reviews_ro ON audit.pii_reviews;
CREATE TRIGGER trg_pii_reviews_ro BEFORE DELETE OR UPDATE ON audit.pii_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

-- 3. 설정 --------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('pii.review_flag_daily', '50', 'ADMIN',
   '개인정보 접속기록 월 점검(v10.179 · docs/279) — 운영자 한 사람이 하루에 이 수 이상 개인정보를 보면 점검 화면에 「살펴볼 것」으로 표시(밤 10시 ~ 아침 6시 조회도 표시).',
   false, '^[1-9][0-9]{0,4}$', '50')
ON CONFLICT (key) DO NOTHING;
