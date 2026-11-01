-- =====================================================================
-- D160 · 운영 하루 요약 · 가입 급증 알림 · 개인정보 문의 주소 (v10.171 · 2026-11-01 · sgb-core docs/264)
--   대표 「다음 개발 후보」 → 「모두」(11/1) · 사용자 웹 전체 공개(domain-dns #11) 뒤 지켜보기 보강
--   ① 설정 ops.digest_to(기본 admin@sogaebank.com) — 매일 09:00 어제 요약(가입 · 로그인 · 글 · 매물 · 주문 · 시험 결제 주문 · 알림)을
--      운영 알림(ops_alerts DAILY_DIGEST)으로 남기고, 메일이 준비됐으면(SMTP · 발신 주소 확인) 이 주소로도 보냄
--   ② 설정 ops.signup_spike_per_hour(기본 30) — 1시간 가입이 이 수 이상이면 운영 알림 SIGNUP_SPIKE(10분 작업 launch_watch 가 봄 · 1시간에 한 번)
--   ③ 정기 작업 launch_digest(매일 09:00)
--   ④ 개인정보 문의 메일 footer.privacy_email — 처음 넣은 값(대표 개인 메일) 그대로면 privacy@sogaebank.com 으로(대표 결정 11/1 · mail-ses #9) · 운영이 이미 바꾼 값은 그대로 둠
--   지우는 문장 없음 · 재실행 안전
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.digest_to', 'admin@sogaebank.com', 'ADMIN',
   '운영 하루 요약을 받을 메일(v10.171 · docs/264) — 매일 09:00 어제 가입 · 주문 · 시험 결제 주문 · 알림. 메일 발송이 준비되기 전에는 운영 알림으로만 남습니다.',
   false, '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$', 'admin@sogaebank.com'),
  ('ops.signup_spike_per_hour', '30', 'ADMIN',
   '1시간 가입이 이 수 이상이면 운영 알림 SIGNUP_SPIKE(v10.171) — 자동 가입 · 광고 유입을 빨리 알아차리려고. 1시간에 한 번만 알립니다.',
   false, '^[0-9]{1,5}$', '30')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('launch_digest', 1440, 9, 0, NULL, true, '운영 하루 요약 — 매일 09:00 어제 가입 · 주문 · 시험 결제 주문 · 알림을 운영 알림(DAILY_DIGEST)으로 · 메일이 준비됐으면 ops.digest_to 로도 · D160')
ON CONFLICT (job) DO NOTHING;

/* ④ 개인정보 문의 메일 — 처음 값(B900 의 개인 메일)일 때만 바꿈. 운영 화면에서 이미 고친 값은 건드리지 않음 */
UPDATE public.site_settings SET value = 'privacy@sogaebank.com', updated_at = now()
 WHERE key = 'footer.privacy_email' AND value = 'koreabio9981@gmail.com';
