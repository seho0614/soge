-- =====================================================================
-- D332 (v10.793 · docs/908) 상담 신청 — 메일 인증번호만으로 받기 스위치
--
--   대표 11/25 묶음 7 2번 「상담 신청 메일 인증번호 대안 — 꺼진 채 · 켜기는 법무 판단 뒤」(open-blockers #8).
--   consult.mail_otp(처음 off · SUPER) — on 이면 알림톡 없이 메일 인증번호만으로 신청을 받아 업체 1곳에 전달.
--   off 면 메일은 알림톡이 될 때 함께 보내는 길(v10.43 「둘 중 하나로 확인」)로만 씀 — 알림톡도 없으면 NOTIFY_NOT_READY.
--   다시 돌려도 같음 · RAISE 없음
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('consult.mail_otp', 'off', 'SUPER', '상담 신청 메일 인증번호만으로 받기(v10.793 · docs/908) — on 이면 알림톡(휴대폰) 없이 메일 인증번호로 확인한 신청도 업체 1곳에 전달 · 휴대폰 번호는 확인되지 않음 · 켜기는 법무 판단 뒤(open-blockers #8) · 처음 off', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref, who) VALUES
  ('consult.mail_otp', 'off', '법무 판단(휴대폰 확인 없이 업체에 연락처 전달) 뒤 · 메일 보내기 준비(notify.email_verified · docs/892) 뒤 · 알림톡이 되면 켜지 않아도 됨', 'docs/908', 'SUPER')
ON CONFLICT (key) DO NOTHING;
