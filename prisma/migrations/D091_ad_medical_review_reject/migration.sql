-- =====================================================================
-- D091 — v10.32 의료 심의 반려(SB-ADM-PTN-040 · 시안 admptnm 카드의 「반려」)
--
--   전에는 의료 심의에 「심의필 확인」(review_confirmed_at)만 있고 반려가 없었습니다.
--   소재 상태(status · ad_placements_status_check)는 노출 상태(준비 · 노출 · 중지 · 차단 · 끝)라
--   심사 결과를 섞지 않고, 심의 반려를 따로 남깁니다 — 언제 · 누가 · 왜.
--     · 반려된 소재는 심의 대기 목록에서 빠집니다(review_rejected_at IS NOT NULL).
--     · 반려된 소재도 review_confirmed_at 이 비어 있으므로 슬롯 배정 · 노출은 기존 트리거(fn_ad_slot_gate)가 그대로 막습니다.
--     · 사유 없는 반려는 DB 가 거부합니다(ck_ad_review_reject_reason).
--     · 광고주가 심의필을 다시 받아 오면 「심의필 확인」이 반려 기록을 지우고 확인으로 바꿉니다.
--   재실행 안전.
-- =====================================================================
ALTER TABLE public.ad_placements
  ADD COLUMN IF NOT EXISTS review_rejected_at    timestamptz,
  ADD COLUMN IF NOT EXISTS review_reject_reason  text,
  ADD COLUMN IF NOT EXISTS review_rejected_by    uuid REFERENCES public.accounts(id);

ALTER TABLE public.ad_placements DROP CONSTRAINT IF EXISTS ck_ad_review_reject_reason;
ALTER TABLE public.ad_placements ADD CONSTRAINT ck_ad_review_reject_reason
  CHECK (review_rejected_at IS NULL OR length(btrim(coalesce(review_reject_reason, ''))) >= 2);

ALTER TABLE public.ad_placements DROP CONSTRAINT IF EXISTS ck_ad_review_not_both;
ALTER TABLE public.ad_placements ADD CONSTRAINT ck_ad_review_not_both
  CHECK (NOT (review_rejected_at IS NOT NULL AND review_confirmed_at IS NOT NULL));

COMMENT ON COLUMN public.ad_placements.review_rejected_at   IS 'v10.32 — 의료 심의 반려 시각(T-03). 확인(review_confirmed_at)과 동시에 있을 수 없음';
COMMENT ON COLUMN public.ad_placements.review_reject_reason IS 'v10.32 — 의료 심의 반려 사유(2자 이상 · 필수)';
COMMENT ON COLUMN public.ad_placements.review_rejected_by   IS 'v10.32 — 반려한 운영자(ADMIN · SUPER)';
