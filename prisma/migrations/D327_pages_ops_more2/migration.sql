-- =====================================================================
-- D327 (v10.744 ~ 753 · docs/852 ~ 861) 페이지 · 관 운영 더하기 10(2)
--
--   대표 11/24 「다음개발후보 모두개발」.
--   ① gwan_maintenances.notice_lead_min — 점검 미리 알림 공지를 언제 올릴지(0 지금 · 60 한 시간 전 · 1440 하루 전 · v10.748)
--   ② page_feedback.checked_at · checked_by — 손님 한 줄 의견 「확인함」(v10.749 · 한 번만)
--   ③ 정기 작업 page_link_check(매일 05:10) — 게시된 관 안 페이지 · 꾸밀 페이지의 사이트 안 링크를 열어 보고 404 면 운영 알림 PAGE_LINK_BROKEN(v10.750)
--   ④ 권한 주소 표
--   지우는 문장 없음 · 다시 돌려도 같음 · RAISE 없음
-- =====================================================================

ALTER TABLE public.gwan_maintenances ADD COLUMN IF NOT EXISTS notice_lead_min integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gwan_maint_notice_lead') THEN
    ALTER TABLE public.gwan_maintenances ADD CONSTRAINT gwan_maint_notice_lead CHECK (notice_lead_min IN (0, 60, 1440));
  END IF;
END $$;
COMMENT ON COLUMN public.gwan_maintenances.notice_lead_min IS 'v10.748 (D327) 미리 알림 공지를 올리는 때 — 0 예약 즉시 · 60 시작 한 시간 전 · 1440 하루 전(공지 게시 시각)';

ALTER TABLE public.page_feedback ADD COLUMN IF NOT EXISTS checked_at timestamptz;
ALTER TABLE public.page_feedback ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES public.accounts(id);
COMMENT ON COLUMN public.page_feedback.checked_at IS 'v10.749 (D327) 운영자가 「확인함」한 때(한 번만)';

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('page_link_check', 1440, 5, 10, NULL, true, '게시된 페이지 깨진 링크 — 관 안 페이지 · 꾸밀 페이지의 사이트 안 링크(최대 200)를 열어 404 면 운영 알림 PAGE_LINK_BROKEN · D327 · v10.750')
ON CONFLICT (job) DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/my-page-tasks', 'gwan-ux', 'VIEW'), ('GET', '/admin/my-page-tasks', 'gwans', 'VIEW'),
  ('POST', '/admin/page-feedback/{id}/check', 'gwan-ux', 'EDIT'), ('POST', '/admin/page-feedback/{id}/check', 'gwans', 'EDIT'),
  ('POST', '/admin/gwans/{code}/pages/visibility', 'gwan-ux', 'EDIT'), ('POST', '/admin/gwans/{code}/pages/visibility', 'gwans', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
