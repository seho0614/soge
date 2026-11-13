-- =====================================================================
-- D205 (v10.260 · docs/392) — 외부 연동 신청 진행표 날짜 칸
--
--   대표 할 일 「업종 정정신고 → 외부 연동 신청」(11/13 「외부 연동 신청 진행표」 승인)을 한 표로 봅니다.
--   연동마다 업종 정정(설정 mall.biz_report_at) → 업체 신청 → IP 신청 · 승인(이미 있는 칸) → 키 받음 → 시험 → LIVE.
--   더하는 칸(모두 비어 있어도 됨 · 사람이 운영 화면에서 적음): applied_at 업체 신청일 · key_at 키 받은 날 · tested_at 시험 성공일 · live_at LIVE 된 날.
--   이미 LIVE 인 연동은 live_at 을 마지막으로 고친 때로 채우고, 키 등록이 끝난 연동은 key_at 을 같은 때로 채웁니다(처음 한 번 · 비어 있을 때만).
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS key_at     timestamptz;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS tested_at  timestamptz;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS live_at    timestamptz;

COMMENT ON COLUMN public.integrations.applied_at IS 'v10.260 (D205) 업체에 신청한 날 — IP 가 필요 없는 연동은 ip_requested_at(신청일)과 같이 씀';
COMMENT ON COLUMN public.integrations.key_at     IS 'v10.260 (D205) 업체에서 키를 받은 날(키 값은 저장하지 않음)';
COMMENT ON COLUMN public.integrations.tested_at  IS 'v10.260 (D205) 운영 화면 시험이 성공한 날';
COMMENT ON COLUMN public.integrations.live_at    IS 'v10.260 (D205) LIVE 로 올린 날 — 상태를 LIVE 로 바꾸면 비어 있을 때 저절로 채움(API)';

UPDATE public.integrations SET live_at = updated_at WHERE status = 'LIVE' AND live_at IS NULL;
UPDATE public.integrations SET key_at = updated_at WHERE secret_registered AND key_at IS NULL;
