-- =====================================================================
-- D209 (v10.278 · docs/407) — 수수료율 인상 예약의 별도 공지사항(입점 약관 제17조 4항 「공지」)
--
--   대표 결정(11/13): 「별도의 공지사항을 등록하여 공지를 한다」 → 「예약 때 공지 초안 자동」.
--   ① hlt_rate_schedules 에 공지 칸 — notice_id(예약 안내) · cancel_notice_id(취소 안내) · 공지는 notices 표(소개몰 HLT)
--      예약하면 앱이 공지 초안(게시 안 됨)을 만들고, 운영자가 「공지 게시」를 눌러 게시 — 게시한 날 + 31일 ≤ 시행일일 때만(앱)
--   ② 알림 종류 2개 — SELLER_RATE_SCHEDULED · SELLER_RATE_SCHEDULE_CANCELED(v10.275 에서 빠졌던 것)
--   공지를 게시하지 않아도 예약은 시행일에 적용(개별 알림은 예약 때 감) — 빠뜨림은 운영 알림 RATE_NOTICE_MISSING 으로 알림.
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

ALTER TABLE public.hlt_rate_schedules ADD COLUMN IF NOT EXISTS notice_id uuid REFERENCES public.notices(id);
ALTER TABLE public.hlt_rate_schedules ADD COLUMN IF NOT EXISTS cancel_notice_id uuid REFERENCES public.notices(id);
COMMENT ON COLUMN public.hlt_rate_schedules.notice_id IS 'v10.278 (D209) 예약 안내 공지(notices · 소개몰) — 예약 때 초안 · 운영자가 게시(게시한 날 + 31일 ≤ 시행일)';
COMMENT ON COLUMN public.hlt_rate_schedules.cancel_notice_id IS 'v10.278 (D209) 취소 안내 공지 — 예약 안내를 게시한 뒤 취소하면 초안';

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('SELLER_RATE_SCHEDULED',         '판매 수수료율 변경 예정',      false, false, '거래 조건 — 입점 약관 제17조 4항(시행일 30일 전 개별 통지)', 'warn'),
  ('SELLER_RATE_SCHEDULE_CANCELED', '판매 수수료율 변경 예정 취소', false, false, '거래 조건 — 예고한 변경을 취소함', 'info')
ON CONFLICT (event_code) DO NOTHING;
