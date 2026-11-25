-- =====================================================================
-- D331 (v10.792 · docs/907) 간주 끈 뒤 처리 도구 — 중개사 재대조 일괄 기록
--
--   대표 11/25 묶음 7 1번 「간주 끈 뒤 처리 도구」 · 재대조 결과가 다름 · 없음이면 「알림만 · 사람이 판단」.
--   ① broker_rechecks          간주로 승인된 중개사(v_broker_verified_assumed)를 국토부 조회로 다시 맞춘 기록(쌓기만 · 확인 칸만 채움)
--   ② v_broker_recheck_pending 아직 MATCH 로 다시 맞지 않은 간주 승인 — 0 이 될 때까지
--   broker_verifications 는 고치지 않음(승인 상태 · 시각을 그대로 둠 — fn_broker_sync 가 승인 시각을 바꾸지 않게)
--   다시 돌려도 같음 · RAISE 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.broker_rechecks (
  id               bigserial PRIMARY KEY,
  verification_id  uuid NOT NULL REFERENCES public.broker_verifications(id) ON DELETE CASCADE,
  result           text NOT NULL CHECK (result IN ('MATCH', 'MISMATCH', 'NOT_FOUND', 'FAILED')),
  detail           text CHECK (detail IS NULL OR char_length(detail) <= 500),
  checked_by       uuid REFERENCES public.accounts(id),
  checked_at       timestamptz NOT NULL DEFAULT now(),
  ack_by           uuid REFERENCES public.accounts(id),
  ack_at           timestamptz,
  ack_note         text CHECK (ack_note IS NULL OR char_length(ack_note) BETWEEN 2 AND 200),
  CHECK ((ack_at IS NULL) = (ack_by IS NULL))
);
CREATE INDEX IF NOT EXISTS broker_rechecks_ver ON public.broker_rechecks (verification_id, checked_at DESC);
COMMENT ON TABLE public.broker_rechecks IS
  'v10.792 (D331 · docs/907) 간주로 승인된 중개사 재대조 기록 — 다름 · 없음은 운영 알림만(자동 해제 없음 · 대표 11/25) · 확인(ack)은 운영자가 사유와 함께';

CREATE OR REPLACE FUNCTION public.fn_broker_rechecks_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BROKER_RECHECK_APPEND_ONLY: 재대조 기록은 지울 수 없습니다';
  END IF;
  IF NEW.verification_id IS DISTINCT FROM OLD.verification_id OR NEW.result IS DISTINCT FROM OLD.result
     OR NEW.detail IS DISTINCT FROM OLD.detail OR NEW.checked_at IS DISTINCT FROM OLD.checked_at
     OR NEW.checked_by IS DISTINCT FROM OLD.checked_by OR OLD.ack_at IS NOT NULL THEN
    RAISE EXCEPTION 'BROKER_RECHECK_APPEND_ONLY: 재대조 기록은 확인 칸만 한 번 채울 수 있습니다';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_broker_rechecks_guard ON public.broker_rechecks;
CREATE TRIGGER trg_broker_rechecks_guard BEFORE UPDATE OR DELETE ON public.broker_rechecks
  FOR EACH ROW EXECUTE FUNCTION public.fn_broker_rechecks_guard();

CREATE OR REPLACE VIEW public.v_broker_recheck_pending AS
SELECT a.id, a.business_id, a.license_no, a.decided_at,
       l.result AS last_result, l.checked_at AS last_checked_at, l.ack_at AS last_ack_at
  FROM public.v_broker_verified_assumed a
  LEFT JOIN LATERAL (SELECT r.result, r.checked_at, r.ack_at FROM public.broker_rechecks r
                      WHERE r.verification_id = a.id ORDER BY r.checked_at DESC, r.id DESC LIMIT 1) l ON true
 WHERE NOT EXISTS (SELECT 1 FROM public.broker_rechecks m WHERE m.verification_id = a.id AND m.result = 'MATCH');
COMMENT ON VIEW public.v_broker_recheck_pending IS
  'v10.792 (D331) 간주 승인 중 아직 국토부 조회로 MATCH 가 나오지 않은 것 — 간주 끈 뒤 0 이 될 때까지 재대조';

-- ── 주소 표(오픈 체크리스트 업무) — 재대조 실행 · 확인은 SUPER 만(컨트롤러 @Roles) ──
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/assume-after', 'checklist', 'VIEW'),
  ('POST', '/admin/assume-after/broker-recheck', 'checklist', 'APPROVE'),
  ('POST', '/admin/assume-after/broker-recheck/{id}/ack', 'checklist', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
