-- =====================================================================
-- E007 (e3.1 · docs/010) ERP 운영 알림 보낼 표(outbox) — 대표 11/25 「보낼 알림 표 + 1분마다」
--
--   옮겨 온 회계 · 인사 코드는 소개뱅크와 똑같이 `INSERT INTO ops_alerts …` · `UPDATE ops_alerts SET resolved_at …` 을 씀(82곳)
--   → ERP 안에 **같은 이름 · 같은 칸**의 ops_alerts 를 두어 코드를 고치지 않음(전표와 같은 트랜잭션에 적힘)
--   → 정기 작업 erp_alert_flush(1분 · 주인과 상관없이 늘)가 소개뱅크 POST /internal/erp/alerts 로 넘김
--        새 줄 → RAISE(detail.erpAlertId) · 풀린 줄 → 같은 종류에 안 풀린 줄이 없으면 RESOLVE
--   소개뱅크 화면(운영 알림 · 텔레그램 · 게시판)은 그대로 — 확인(ack)은 소개뱅크에서
--   고유 (alert_code, raised_at) — 소개뱅크와 같음(같은 시각 같은 종류는 ON CONFLICT DO NOTHING)
--   RAISE 글자에 퍼센트 기호 없음 · 다시 돌려도 같음
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ops_alerts (
  id               bigserial PRIMARY KEY,
  alert_code       text NOT NULL CHECK (alert_code ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  severity         text NOT NULL CHECK (severity IN ('INFO', 'WARN', 'CRITICAL')),
  title            text NOT NULL,
  detail           jsonb,
  raised_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_by  uuid,
  acknowledged_at  timestamptz,
  ack_note         text,
  mailed_at        timestamptz,
  resolved_at      timestamptz,
  resolve_note     text,
  forwarded_at     timestamptz,
  forward_tries    int NOT NULL DEFAULT 0,
  forward_error    text,
  resolve_forwarded_at timestamptz,
  CONSTRAINT ops_alerts_code_time UNIQUE (alert_code, raised_at)
);
CREATE INDEX IF NOT EXISTS ops_alerts_unforwarded ON public.ops_alerts (id) WHERE forwarded_at IS NULL;
CREATE INDEX IF NOT EXISTS ops_alerts_open ON public.ops_alerts (alert_code) WHERE resolved_at IS NULL;
COMMENT ON TABLE public.ops_alerts IS 'e3.1 (E007) ERP 운영 알림 보낼 표 — 소개뱅크 ops_alerts 와 같은 칸 · erp_alert_flush 가 1분마다 소개뱅크로 넘김';

INSERT INTO public.erp_jobs (name, schedule, description) VALUES
  ('erp_alert_flush', 'every 1m', 'ERP 운영 알림을 소개뱅크로 넘김(e3.1 · 보낼 알림 표 · 정기 작업 주인과 상관없이 늘)')
ON CONFLICT (name) DO NOTHING;
