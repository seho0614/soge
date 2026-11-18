-- v10.350 · v10.352 (docs/484 · 486) — 임시 허용 IP 기한 · 고객센터 주간 보고
--   대표 11/18 「다음개발」 → ① Nginx 적용 알림 · ② 임시 허용 IP · ③ 지난 판 보기 · 되돌리기 · ④ 고객센터 주간 보고 「모두」 → 「승인 + 통과하면 병합」.
--   ① 칸 staff_ip_allow.expires_at — 비면 기한 없음. 지나면 인증 면제가 끊기고 정기 작업 sla_alert 가 목록에서 뺌(감사 STAFF_IP_ALLOW_EXPIRE · 마지막 하나는 남김).
--   ② 설정 ops.cs_weekly on · 정기 작업 cs_weekly(월요일 09:10 · 한국) — 지난주 고객센터 숫자를 텔레그램 · 슬랙 · 운영자 게시판으로.
--   지우는 문장 없음 · 다시 돌려도 같음.

ALTER TABLE public.staff_ip_allow ADD COLUMN IF NOT EXISTS expires_at timestamptz;
COMMENT ON COLUMN public.staff_ip_allow.expires_at IS 'v10.350 (D234) 임시 허용 기한 — 비면 기한 없음 · 지나면 인증 면제 끊김 · 정기 작업이 목록에서 뺌(마지막 하나는 남김)';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.cs_weekly', 'on', 'ADMIN',
   '고객센터 주간 보고(v10.352 · docs/486) — on 이면 매주 월요일 09:10 지난주 1:1 문의 · 해결률 · 문의 전 해결 · 못 찾은 낱말 · 리드관 숫자를 텔레그램 · 슬랙(켜 둔 길만) · 운영자 게시판으로. off 면 보내지 않음.',
   false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('cs_weekly', 10080, 9, 10, 2, true, '고객센터 주간 보고 — 월요일 09:10 지난주 숫자 텔레그램 · 슬랙 · 운영자 게시판(ops.cs_weekly · 켜 둔 길만) · 운영 알림 CS_WEEKLY · D234')
ON CONFLICT (job) DO NOTHING;
