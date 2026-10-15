-- v10.31 (w2) — 새 기능의 알림 문구(fn_notify 는 템플릿이 없으면 알림을 만들지 않습니다)
--   베스트매칭 공개 동의 요청 · 소개창업 축 요청(업체 소개 · 견적) · 빠른 매칭 회신 · 안전거래 합의
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES
  ('SUCCESS_STORY_CONSENT_INAPP', 'INAPP', '베스트매칭 사례 공개 동의 요청',
   '「{title}」 거래가 베스트매칭 사례 후보입니다. 두 분이 모두 동의하셔야 공개됩니다 — 금액 · 기간은 거래 기록 그대로, 이름은 첫 글자만 나갑니다.',
   '["title"]'::jsonb, true),
  ('BIZAXIS_REQUEST_INAPP', 'INAPP', '소개창업 요청이 왔습니다',
   '「{title}」에 업체 소개 · 견적 요청이 왔습니다. 회신은 받은 요청에서 하실 수 있습니다.', '["title"]'::jsonb, true),
  ('BIZQUICK_OFFER_INAPP', 'INAPP', '빠른 매칭 회신',
   '「{title}」 빠른 매칭에 인력대행업체가 회신했습니다. 도급으로만 잇습니다 — 개인은 연결하지 않습니다.', '["title"]'::jsonb, true),
  ('SAFE_TRADE_AGREE_INAPP', 'INAPP', '안전거래 합의 요청',
   '거래 상대가 안전거래(당사자 확인 · 분쟁 지원 · 기록 보존)에 합의했습니다. 함께 합의하시면 적용됩니다 — 대금은 당사자끼리 주고받습니다.', '[]'::jsonb, true)
ON CONFLICT (code) DO NOTHING;
