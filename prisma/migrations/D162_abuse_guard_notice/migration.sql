-- =====================================================================
-- D162 · 가입 · 글쓰기 남용 막기 · 사이트 안내 띠 · 시험 결제 주문 정리 (v10.173 · 2026-11-01 · sgb-core docs/266)
--   대표 「다음 개발건」 → 「모두」(11/1) · 사용자 웹 전체 공개(시험 본인인증 · 간주 결제 그대로) 뒤 보강
--   ① signup.open(기본 on · 공개 설정) — off 면 새 가입을 받지 않음(422 SIGNUP_CLOSED) · 가입 화면에 안내 · 운영 화면 「가입 잠시 막기」
--   ② abuse.signup_per_ip_day(기본 20 · 운영 전용) — 같은 접속 IP 의 하루(한국 날짜) 가입 수 상한(429 SIGNUP_IP_LIMIT) · 0 이면 끔
--      IP 원문은 저장하지 않음(auth_throttle SIGNUP_IP · 날짜를 섞은 HMAC — D102 와 같음) · 내부 IP(127.* · 10.* · 172.16 ~ 31.* · 192.168.*)는 세지 않음
--   ③ abuse.new_member_listings_day(기본 20 · 운영 전용) — 가입 24시간 안 회원의 24시간 매물 등록 수 상한(429 NEW_MEMBER_LIMIT) · 운영자 제외 · 0 이면 끔
--      소개광장 글은 이미 DB 가 막음(C810 — 누구나 하루 5개 · 가입 7일 안 링크 금지)이라 더하지 않음
--   ④ site.notice_bar · site.notice_bar_en(기본 빈 값 · 공개 설정) — 사용자 웹 맨 위 안내 한 줄(빈 값이면 그리지 않음)
--   지우는 문장 없음 · 기존 값 바꾸지 않음 · 재실행 안전
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('signup.open', 'on', 'GLOBAL',
   '새 가입 받기(v10.173 · docs/266) — off 면 가입 화면에 안내만 나오고 가입 API 가 422 SIGNUP_CLOSED. 가입 급증 · 자동 가입이 보이면 운영 화면 첫 화면 「가입 잠시 막기」로 끕니다. 기존 회원 로그인은 그대로.',
   false, '^(on|off)$', 'on'),
  ('abuse.signup_per_ip_day', '20', 'ADMIN',
   '같은 접속 IP 의 하루(한국 날짜) 가입 수 상한(v10.173) — 넘으면 429 SIGNUP_IP_LIMIT. 0 이면 끔. IP 원문은 저장하지 않고, 내부 IP 는 세지 않습니다.',
   false, '^[0-9]{1,4}$', '20'),
  ('abuse.new_member_listings_day', '20', 'ADMIN',
   '가입 24시간 안 회원이 24시간 동안 등록할 수 있는 매물 수(v10.173) — 넘으면 429 NEW_MEMBER_LIMIT. 운영자는 제외. 0 이면 끔. 소개광장 글은 따로 하루 5개(누구나).',
   false, '^[0-9]{1,4}$', '20'),
  ('site.notice_bar', '', 'GLOBAL',
   '사용자 웹 맨 위 안내 한 줄(v10.173) — 빈 값이면 그리지 않음. 예: 시범 운영 중입니다 — 소개몰 결제 등 일부 기능은 시험 모드로 동작합니다.',
   false, '^.{0,200}$', '시범 운영 중입니다 — 소개몰 결제 등 일부 기능은 시험 모드로 동작합니다.'),
  ('site.notice_bar_en', '', 'GLOBAL',
   '사용자 웹 맨 위 안내 한 줄의 영어(v10.173) — 빈 값이면 영어 화면에도 한국어 안내를 씀.',
   false, '^.{0,200}$', 'SogaeBank is in trial operation — some features such as mall payments run in test mode.')
ON CONFLICT (key) DO NOTHING;

/* ② 가입 IP 횟수 — D102 의 auth_throttle 에 종류 하나 더함(같은 표 · 같은 정리 규칙) */
ALTER TABLE public.auth_throttle DROP CONSTRAINT IF EXISTS ck_auth_throttle_kind;
ALTER TABLE public.auth_throttle ADD CONSTRAINT ck_auth_throttle_kind
  CHECK (key_kind IN ('LOGIN_EMAIL','LOGIN_IP','RESET_EMAIL','RESET_IP','SIGNUP_IP'));
