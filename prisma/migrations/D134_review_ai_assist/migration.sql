-- =====================================================================
-- D134 — v10.138 (2026-10-28 · AI 검수 보조 2단계 「가안」 · docs/206 · 설계 docs/196 2-2 · ai-agent #20)
--
--   ① review_items.ai_referenced — 검수자가 「AI 의견과 같게 확인」(또는 AI 가 미리 채운 반려 사유를 확인)으로 결정했는지.
--      결정은 늘 사람(decision_by) · AI 는 승인 · 반려하지 않음(#7 · #15 그대로) — 이 칸은 「참고했다」는 표시뿐.
--   ② v_ai_review_agreement_gwan — 최근 14일 AI 의견과 사람 결정의 일치율을 관(업종 묶음)별로 · AI 의견 참고 결정 수.
--   재실행 안전 · 자료를 지우지 않음 · 기존 결정은 false.
-- =====================================================================

ALTER TABLE public.review_items ADD COLUMN IF NOT EXISTS ai_referenced boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.review_items.ai_referenced IS 'v10.138 — 검수자가 AI 의견을 참고해 같은 결정을 함(결정은 사람 · decision_by)';

CREATE OR REPLACE VIEW public.v_ai_review_agreement_gwan AS
 SELECT coalesce(r.gwan_code, '-') AS gwan_code,
        count(*) FILTER (WHERE r.status IN ('APPROVED','REJECTED')) AS decided,
        count(*) FILTER (WHERE (o.suggestion = 'APPROVE' AND r.status = 'APPROVED') OR (o.suggestion = 'REJECT' AND r.status = 'REJECTED')) AS agreed,
        count(*) FILTER (WHERE o.suggestion = 'UNSURE') AS unsure,
        count(*) FILTER (WHERE r.ai_referenced) AS referenced,
        round(100.0 * count(*) FILTER (WHERE (o.suggestion = 'APPROVE' AND r.status = 'APPROVED') OR (o.suggestion = 'REJECT' AND r.status = 'REJECTED'))
              / nullif(count(*) FILTER (WHERE r.status IN ('APPROVED','REJECTED') AND o.suggestion <> 'UNSURE'), 0), 1) AS agree_pct
   FROM public.review_items r
   JOIN LATERAL (SELECT suggestion FROM public.ai_review_opinions
                  WHERE review_item_id = r.id AND note IS DISTINCT FROM '[처리 중]' ORDER BY created_at DESC LIMIT 1) o ON true
  WHERE r.submitted_at > now() - interval '14 days'
  GROUP BY coalesce(r.gwan_code, '-');
COMMENT ON VIEW public.v_ai_review_agreement_gwan IS 'v10.138 — AI 검수 보조 일치율(관별 · 최근 14일 · 최근 의견 1건 기준)';
