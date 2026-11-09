-- =====================================================================
-- D191 — 보안 정책 보고 30일 · 낯선 기기 로그인 알림 (v10.221 · 2026-11-09)
--
--   대표 「보안 개발 목록」 → 「추천 개발 1 · 2 · 3 모두」 → 계획 「승인」(11/9) · 낯선 기기 알림은 처리방침 이용 목적에 맞음(대표 11/9).
--
--   ① csp_report_days — 사용자 웹 보안 정책 「보고만 하기」(v10.177) 보고를 날짜(한국) · 규칙 · 출처별 건수로 남김.
--      전에는 API 메모리에서 24시간만 들고 있어 운영 적용(pm2 재시작) 때마다 비었음 — 1 ~ 2주 모아 「막는 정책」을 판단할 수 없었음.
--      정기 작업 launch_watch(10분)가 메모리에 쌓인 건수를 더해 넣고 30일 지난 줄을 지움.
--      남기는 것: 날짜 · 규칙(script-src 등) · 막혔을 출처(https://host 까지) · 마지막 화면 경로 · 건수. IP · 쿠키 · 회원 없음.
--   ② 알림 종류 LOGIN_NEW_DEVICE(낯선 기기 로그인) — 90일 안에 없던 (IP 앞 두 마디 + 브라우저 종류)로 로그인하면 회원에게 알림(사이트 안 ·
--      메일은 메일 채널이 준비되면 notify_dispatch 가). 수신 거부 불가 · 조용한 시간 무시(계정 보안 — PASSWORD_CHANGED · LOGIN_LOCKED 와 같음).
--   ③ 설정 account.login_alert(on) — off 면 ② 를 만들지 않음.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.csp_report_days (
  day        date NOT NULL,
  directive  text NOT NULL CHECK (length(directive) BETWEEN 1 AND 40),
  blocked    text NOT NULL CHECK (length(blocked) BETWEEN 1 AND 200),
  page       text CHECK (page IS NULL OR length(page) <= 80),
  n          integer NOT NULL CHECK (n > 0),
  first_at   timestamptz NOT NULL DEFAULT now(),
  last_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, directive, blocked)
);
COMMENT ON TABLE public.csp_report_days IS
  '사용자 웹 보안 정책 「보고만 하기」 날짜별 건수(D191 · v10.221) — 정기 작업 launch_watch 가 API 메모리의 보고를 10분마다 더함 · 30일 지나면 지움 · IP · 회원 없음';
COMMENT ON COLUMN public.csp_report_days.blocked IS '막혔을 출처 — https://host 까지(경로 · 물음표 뒤 없음) 또는 inline · eval · data 같은 낱말';

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('LOGIN_NEW_DEVICE', '낯선 기기 로그인', false, true, '계정 보안 — 본인이 로그인하지 않았으면 바로 알아야 합니다', 'warn')
ON CONFLICT (event_code) DO NOTHING;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('account.login_alert', 'on', 'GLOBAL',
        '낯선 기기 로그인 알림(v10.221 · D191 · docs/356) — on 이면 90일 안에 없던 (IP 앞 두 마디 + 브라우저 종류)로 로그인할 때 회원에게 알림(첫 로그인 빼고 · 하루 3번까지). off 면 만들지 않음.',
        false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
