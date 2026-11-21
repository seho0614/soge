-- =====================================================================
-- (메인이 D292 ~ 중 한 번호에 붙임) 15차 보안 · 기반 (v10.590 ~ 596 · docs/732 ~ 738) — 앞머리 sec2_
--
--   v10.590 ⑥ 운영자 이상 행동 감지 — sec2_staff_anomalies(쌓기 · 확인 한 번) · sec2_anomaly_runs(날마다 한 번)
--             · 감사 기록(audit.audit_logs) · 개인정보 접속기록(audit.pii_access_logs) · 내려받기 승인(export_requests) · 로그인 기록(login_history) 재사용
--   v10.591 ⑦ 유출 비밀번호 막기 — sec2_pwned_log(건수만 · 비밀번호 · 해시 · 계정 없음)
--   v10.592 ⑧ 회원 2단계 인증(선택) — 운영자 표 account_mfa 그대로 · sec2_mfa_tickets(로그인 2단계 표 · 해시만 · 5분)
--   v10.593 ⑨ 회원 낯선 로그인 알림 넓힘 — sec2_login_alerts(알림 LOGIN_NEW_DEVICE 한 건 = 한 줄 · 로그인 기기 login_sessions 번호)
--   v10.594 ⑩ 운영 화면 「?」 도움말 — sec2_tab_help(탭 → 설명서 절) · help_docs 에 ADMIN_GUIDE 1판(없을 때만)
--   v10.595 ⑪ 접근성 자동 점검 — infra 도구만(SQL 없음)
--   v10.596 ⑫ API 바뀐 점 자동 기록 — scripts 도구만(SQL 없음)
--   공통: 설정(모두 처음 off · 알림 기준 숫자만 값) · 정기 작업 sec2_tick(10분) · 기능 스위치 한눈에 · ㉕ 권한(D258) 시드
--   지우는 문장 없음(쌓인 데이터 그대로) · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음 · ops_alerts 는 clock_timestamp()
-- =====================================================================

/* ── ⑥ 운영자 이상 행동 (v10.590 · docs/732) ───────────────────────── */
CREATE TABLE IF NOT EXISTS public.sec2_staff_anomalies (
  id           bigserial PRIMARY KEY,
  day          date NOT NULL,
  account_id   uuid NOT NULL REFERENCES public.accounts(id),
  kind         text NOT NULL CHECK (kind IN ('VIEW', 'EXPORT', 'NIGHT')),
  n            integer NOT NULL CHECK (n >= 0),
  avg30        numeric(10,2) NOT NULL DEFAULT 0 CHECK (avg30 >= 0),
  threshold    integer NOT NULL CHECK (threshold >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid REFERENCES public.accounts(id),
  review_note  text CHECK (review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 2 AND 200),
  CONSTRAINT sec2_staff_anomalies_uq UNIQUE (day, account_id, kind),
  CONSTRAINT sec2_staff_anomalies_review_ck CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_sec2_staff_anomalies_day ON public.sec2_staff_anomalies (day DESC);
CREATE INDEX IF NOT EXISTS ix_sec2_staff_anomalies_open ON public.sec2_staff_anomalies (day DESC) WHERE reviewed_at IS NULL;
COMMENT ON TABLE public.sec2_staff_anomalies IS 'v10.590 (docs/732) 운영자 이상 행동 — 한국 날짜 하루 · 운영자 · 종류(VIEW 개인정보 열람 · EXPORT 내려받기 · NIGHT 밤 22 ~ 06시 활동)마다 한 줄 · n 그날 수 · avg30 지난 30일 하루 평균 · threshold 그날 기준 · 확인(reviewed_*)은 한 번만(본인 것은 못 함) · 지우기 막음';

CREATE OR REPLACE FUNCTION public.sec2_staff_anomalies_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SEC2_ANOMALY_RO: 이상 행동 기록은 지우지 않습니다.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.reviewed_at IS NOT NULL OR NEW.day <> OLD.day OR NEW.account_id <> OLD.account_id OR NEW.kind <> OLD.kind
     OR NEW.n <> OLD.n OR NEW.avg30 <> OLD.avg30 OR NEW.threshold <> OLD.threshold OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'SEC2_ANOMALY_RO: 이상 행동 기록은 확인(한 번)만 적습니다.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sec2_staff_anomalies_guard' AND tgrelid = 'public.sec2_staff_anomalies'::regclass) THEN
    CREATE TRIGGER trg_sec2_staff_anomalies_guard BEFORE UPDATE OR DELETE ON public.sec2_staff_anomalies
      FOR EACH ROW EXECUTE FUNCTION public.sec2_staff_anomalies_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sec2_anomaly_runs (
  day      date PRIMARY KEY,
  run_at   timestamptz NOT NULL DEFAULT now(),
  actors   integer NOT NULL DEFAULT 0 CHECK (actors >= 0),
  found    integer NOT NULL DEFAULT 0 CHECK (found >= 0),
  alerted  boolean NOT NULL DEFAULT false,
  auto     boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE public.sec2_anomaly_runs IS 'v10.590 (docs/732) 이상 행동 셈 — 한국 날짜마다 한 줄 · auto = 정기 작업 sec2_tick 이 셈(07시 뒤 어제 · 한 번) · 「다시 셈」(auto false)은 같은 날 줄을 고치기만 하고 정기 셈을 막지 않음';

/* 운영자 하루 셈 — 지난 30일 평균과 함께(한국 날짜 · 밤 = 22 ~ 06시) · 서버 sec2/anomaly.ts 가 기준과 견줌 */
CREATE OR REPLACE FUNCTION public.sec2_staff_day_counts(p_day date)
RETURNS TABLE (account_id uuid, views integer, exports integer, night integer, views_avg numeric, exports_avg numeric, night_avg numeric)
    LANGUAGE sql STABLE AS $$
  WITH staff AS (
    SELECT DISTINCT r.account_id FROM public.account_roles r JOIN public.accounts a ON a.id = r.account_id
     WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT') AND a.status = 'ACTIVE'
  ), rng AS (
    SELECT (p_day::timestamp AT TIME ZONE 'Asia/Seoul') AS f, ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AS t,
           ((p_day - 30)::timestamp AT TIME ZONE 'Asia/Seoul') AS f30
  ), v AS (
    SELECT p.actor_account_id AS id,
           count(*) FILTER (WHERE p.occurred_at >= rng.f) AS d, count(*) FILTER (WHERE p.occurred_at < rng.f) AS b
      FROM audit.pii_access_logs p, rng
     WHERE p.occurred_at >= rng.f30 AND p.occurred_at < rng.t AND p.actor_account_id IS NOT NULL
     GROUP BY 1
  ), e AS (
    SELECT x.id, sum(x.d) AS d, sum(x.b) AS b FROM (
      SELECT q.requested_by AS id, count(*) FILTER (WHERE q.used_at >= rng.f) AS d, count(*) FILTER (WHERE q.used_at < rng.f) AS b
        FROM public.export_requests q, rng WHERE q.used_at >= rng.f30 AND q.used_at < rng.t GROUP BY 1
      UNION ALL
      SELECT l.actor_account_id, count(*) FILTER (WHERE l.occurred_at >= rng.f), count(*) FILTER (WHERE l.occurred_at < rng.f)
        FROM audit.audit_logs l, rng
       WHERE l.occurred_at >= rng.f30 AND l.occurred_at < rng.t AND l.actor_account_id IS NOT NULL
         AND (l.action LIKE '%EXPORT%' OR l.action LIKE '%CSV%' OR l.action LIKE '%DOWNLOAD%')
       GROUP BY 1) x GROUP BY 1
  ), n AS (
    SELECT x.id, sum(x.d) AS d, sum(x.b) AS b FROM (
      SELECT l.actor_account_id AS id, count(*) FILTER (WHERE l.occurred_at >= rng.f) AS d, count(*) FILTER (WHERE l.occurred_at < rng.f) AS b
        FROM audit.audit_logs l, rng
       WHERE l.occurred_at >= rng.f30 AND l.occurred_at < rng.t AND l.actor_account_id IS NOT NULL
         AND (extract(hour FROM l.occurred_at AT TIME ZONE 'Asia/Seoul') >= 22 OR extract(hour FROM l.occurred_at AT TIME ZONE 'Asia/Seoul') < 6)
       GROUP BY 1
      UNION ALL
      SELECT p.actor_account_id, count(*) FILTER (WHERE p.occurred_at >= rng.f), count(*) FILTER (WHERE p.occurred_at < rng.f)
        FROM audit.pii_access_logs p, rng
       WHERE p.occurred_at >= rng.f30 AND p.occurred_at < rng.t AND p.actor_account_id IS NOT NULL
         AND (extract(hour FROM p.occurred_at AT TIME ZONE 'Asia/Seoul') >= 22 OR extract(hour FROM p.occurred_at AT TIME ZONE 'Asia/Seoul') < 6)
       GROUP BY 1
      UNION ALL
      SELECT h.account_id, count(*) FILTER (WHERE h.at >= rng.f), count(*) FILTER (WHERE h.at < rng.f)
        FROM public.login_history h, rng
       WHERE h.at >= rng.f30 AND h.at < rng.t AND h.ok
         AND (extract(hour FROM h.at AT TIME ZONE 'Asia/Seoul') >= 22 OR extract(hour FROM h.at AT TIME ZONE 'Asia/Seoul') < 6)
       GROUP BY 1) x GROUP BY 1
  )
  SELECT s.account_id,
         coalesce(v.d, 0)::int, coalesce(e.d, 0)::int, coalesce(n.d, 0)::int,
         round(coalesce(v.b, 0) / 30.0, 2), round(coalesce(e.b, 0) / 30.0, 2), round(coalesce(n.b, 0) / 30.0, 2)
    FROM staff s
    LEFT JOIN v ON v.id = s.account_id
    LEFT JOIN e ON e.id = s.account_id
    LEFT JOIN n ON n.id = s.account_id
$$;
COMMENT ON FUNCTION public.sec2_staff_day_counts(date) IS 'v10.590 (docs/732) 운영 역할(정상 계정) 한 사람마다 그날(한국) 개인정보 열람 · 내려받기(승인 내려받기 + 감사 EXPORT · CSV · DOWNLOAD) · 밤(22 ~ 06시) 활동(감사 · 열람 · 로그인) 수와 지난 30일 하루 평균 — 숫자만';

/* ── ⑦ 유출 비밀번호 (v10.591 · docs/733) ───────────────────────────── */
CREATE TABLE IF NOT EXISTS public.sec2_pwned_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  place   text NOT NULL CHECK (place IN ('SIGNUP', 'RESET', 'CHANGE', 'SOCIAL_PW', 'TEST')),
  mode    text NOT NULL CHECK (mode IN ('ASSUME', 'LIVE')),
  result  text NOT NULL CHECK (result IN ('PASS', 'BLOCK', 'ERROR'))
);
CREATE INDEX IF NOT EXISTS ix_sec2_pwned_log_at ON public.sec2_pwned_log (at DESC);
COMMENT ON TABLE public.sec2_pwned_log IS 'v10.591 (docs/733) 유출 비밀번호 확인 건수 — 어디서(가입 · 재설정 · 변경 · 간편 가입 첫 비밀번호 · 시험) · 방식 · 결과만(비밀번호 · 해시 · 계정 · IP 없음) · 400일 지나면 sec2_tick 이 지움';

/* ── ⑧ 회원 2단계 인증 로그인 표 (v10.592 · docs/734) ─────────────────── */
CREATE TABLE IF NOT EXISTS public.sec2_mfa_tickets (
  id          bigserial PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  fails       integer NOT NULL DEFAULT 0 CHECK (fails BETWEEN 0 AND 10)
);
CREATE INDEX IF NOT EXISTS ix_sec2_mfa_tickets_account ON public.sec2_mfa_tickets (account_id, created_at DESC);
COMMENT ON TABLE public.sec2_mfa_tickets IS 'v10.592 (docs/734) 회원 2단계 인증 — 비밀번호가 맞은 뒤 받는 표(무작위 값의 sha256 만 · 5분 · 한 번 · 5번 틀리면 못 씀) · 하루 지나면 sec2_tick 이 지움 · 인증 앱 비밀값 · 예비 번호는 운영자와 같은 account_mfa';

/* ── ⑨ 회원 낯선 로그인 (v10.593 · docs/735) ────────────────────────── */
CREATE TABLE IF NOT EXISTS public.sec2_login_alerts (
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  session_id   uuid,
  ip_masked    text CHECK (ip_masked IS NULL OR length(ip_masked) <= 60),
  ua_kind      text CHECK (ua_kind IS NULL OR length(ua_kind) <= 60),
  created_at   timestamptz NOT NULL DEFAULT now(),
  answer       text CHECK (answer IN ('ME', 'NOT_ME')),
  answered_at  timestamptz,
  CONSTRAINT sec2_login_alerts_answer_ck CHECK ((answer IS NULL) = (answered_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_sec2_login_alerts_account ON public.sec2_login_alerts (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_sec2_login_alerts_notme ON public.sec2_login_alerts (answered_at) WHERE answer = 'NOT_ME';
COMMENT ON TABLE public.sec2_login_alerts IS 'v10.593 (docs/735) 회원 낯선 기기 로그인 — 알림 LOGIN_NEW_DEVICE 한 건마다 한 줄(로그인 기기 login_sessions 번호 · IP 앞 두 마디 · 브라우저 종류) · 회원이 「나였어요(ME)」 · 「내가 아니에요(NOT_ME — 그 기기 로그아웃)」 한 번 · 로그인 기록 보관 날수(privacy.login_history_days · 처음 180)가 지나면 sec2_tick 이 지움';

/* ── ⑩ 운영 화면 도움말 (v10.594 · docs/736) ───────────────────────── */
CREATE TABLE IF NOT EXISTS public.sec2_tab_help (
  tab_key     text PRIMARY KEY CHECK (tab_key ~ '^[a-z][a-z0-9-]{1,39}$'),
  doc_code    text NOT NULL CHECK (doc_code IN ('ADMIN_GUIDE', 'USER_MANUAL')),
  heading     text NOT NULL CHECK (char_length(heading) BETWEEN 1 AND 120),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.sec2_tab_help IS 'v10.594 (docs/736) 운영 화면 탭 → 설명서 절(### 제목) 잇기 — 없으면 운영 화면 도움말(ADMIN_GUIDE) 절 제목의 [탭 키] → 탭 이름 → 사용자 설명서 절 제목 순으로 찾음 · 고치기 SUPER';

/* 운영 화면 도움말 1판 — help_docs 는 쌓기만(D180) · ADMIN_GUIDE 가 하나도 없을 때만 넣음(다시 돌려도 같음) · 고치기는 운영 화면 › 관 관리 › 화면 도움말(SUPER · 새 판) */
INSERT INTO public.help_docs (code, version, title, body, note)
SELECT 'ADMIN_GUIDE', 1, '운영 화면 도움말', $guide$운영 화면(관리자) 탭마다 제목 옆 「?」를 누르면 이 글의 절이 보입니다. 절 제목 끝의 [탭 키]가 그 탭과 이어집니다. 고치기는 관 관리 › 화면 도움말(SUPER)에서 새 판으로 저장합니다(옛 판은 남음).

## 1. 매일 보는 곳

### 운영 대시보드 [home]
- 오늘 처리할 일(검수 · 신고 · 문의 · 정산)과 처리할 수 있는 양을 같이 봅니다.
- 칸을 누르면 그 화면으로 갑니다. 숫자가 늘기만 하면 그 화면의 기한을 먼저 보십시오.

### 운영 알림 [ops-alerts]
- 정기 작업 · 스크립트가 남긴 알림입니다. 급함(CRITICAL)이 맨 위입니다.
- 「확인」은 한 번만 — 누가 · 언제 · 메모가 남습니다. 원인을 고치면 저절로 풀리는 알림도 있습니다.
- 받을 길(텔레그램 · 메일 · 게시판)은 대표가 정한 규칙을 따릅니다.

### 1:1 문의 [inquiries]
- 기한은 접수 뒤 영업일 1일입니다. 답하면 회원에게 알림이 갑니다.
- 회원 개인정보가 필요한 답은 회원 상세에서 「열람 사유」를 고른 뒤 봅니다.

### 신고 처리 [report-queue]
- 오래된 것이 위에 옵니다. 내린 글 작성자는 사유를 봅니다 — 사유는 짧고 사실대로 씁니다.

## 2. 회원 · 개인정보

### 회원 목록 [members]
- 이름 · 이메일 · 연락처로 찾습니다. 회원 상세를 열면 개인정보 접속기록에 남습니다.
- 열람 사유(문의 답변 · 분쟁 · 정산 · 심사 · 법적 요청 · 기타)를 고르십시오. 사유 없이 보면 「미입력」으로 남아 월간 점검에 잡힙니다.

### 개인정보 접속기록 점검 [pii-review]
- SUPER 가 달마다 운영자의 개인정보 열람 기록을 보고 점검 결과를 남깁니다(개인정보 보호법 안전성 확보 조치).

### 개인정보 권리 요청 [privacy-requests]
- 회원의 열람 · 정정 · 삭제 · 처리정지 요청입니다. 법정 기한(10일) 안에 처리하고 결과를 남깁니다.

## 3. 보안

### 운영자 권한 점검 [role-review]
- 운영자별 역할 · 마지막 로그인 · 2단계 등록을 보고 분기마다 점검 기록을 남깁니다(SUPER).
- 90일 넘게 쓰지 않은 권한은 거둘 후보입니다.

### 이상 행동 감지 [scx-watch]
- 운영자 한 사람의 하루 개인정보 열람 · 내려받기 · 밤(22 ~ 06시) 활동이 기준과 평소(지난 30일 평균)의 몇 배를 함께 넘으면 한 줄이 생깁니다.
- 자동으로 막지 않습니다. SUPER 가 사유를 듣고 「확인」에 메모를 남깁니다(본인 줄은 다른 SUPER 가).
- 회원 보안 칸: 유출 비밀번호 막기 · 회원 2단계 인증 · 낯선 로그인 「내가 아님」 수를 봅니다. 스위치는 모두 처음 꺼져 있습니다.

### 해외 접속 경고 [sec-geo]
- 운영 역할 로그인마다 접속 나라를 보고 허용 나라 밖이면 긴급 알림을 올립니다. 출장 전에는 허용 나라에 더하십시오.

## 4. 설정 · 문서

### 전체 설정 [settings]
- 사이트 설정 모두를 찾고 고칩니다. 바꿀 때마다 전 · 후 · 누가 · 까닭이 남습니다.
- 처리방침 · 법무 확인이 필요한 스위치는 켜기 전에 「기능 스위치 한눈에」의 켤 조건을 보십시오.

### 기능 스위치 한눈에 [opx-switches]
- 켜고 끄는 설정의 지금 값 · 처음 값 · 켤 조건 · 바꾼 사람을 읽기만 합니다.

### 사용자 설명서 [manual]
- 회원용 설명서입니다. AI 상담이 답의 근거로 읽습니다(2만 자까지 · 고치면 새 판).

### 화면 도움말 [scx-help]
- 이 글(운영 화면 도움말)을 고치고, 탭과 절을 잇습니다. 「?」에서 절이 안 보이면 절 제목 끝에 [탭 키]를 넣거나 여기서 이으십시오.

### 내 인사 [my-hr]
- 출근 · 퇴근 누르기 · 이번 달 근태 · 남은 연차 · 휴가 신청 · 내 급여명세서를 봅니다.
$guide$, '처음 판(v10.594 · docs/736)'
 WHERE NOT EXISTS (SELECT 1 FROM public.help_docs WHERE code = 'ADMIN_GUIDE');

/* ── 설정(모두 처음 off — 알림 기준 숫자만 값) · 값 무늬는 서버 sec2/common.ts SEC2_PATTERNS 와 같음 ───── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('sec2.anomaly_watch', 'off', 'ADMIN', '운영자 이상 행동 감지(v10.590 · docs/732) — 처음 off · on 이면 정기 작업 sec2_tick 이 매일 07시 뒤 어제(한국)를 셈해 기준을 넘은 줄을 남기고 운영 알림 STAFF_ANOMALY(WARN) 한 번 · 직원에게 감시 사실을 알린 뒤(취업규칙 · 개인정보 처리방침 내부 관리계획) SUPER 가 켬 · 자동으로 막지 않음', false, '^(on|off)$', 'off'),
  ('sec2.anomaly_view_min', '100', 'ADMIN', '이상 행동 기준 — 하루 개인정보 열람 수(v10.590 · 1 ~ 9999 · 처음 100) · 이 수 이상이면서 지난 30일 하루 평균 × sec2.anomaly_factor 이상일 때', false, '^([1-9][0-9]{0,3})$', '100'),
  ('sec2.anomaly_export_min', '3', 'ADMIN', '이상 행동 기준 — 하루 내려받기 수(승인 내려받기 + 감사 EXPORT · CSV · DOWNLOAD · v10.590 · 1 ~ 999 · 처음 3)', false, '^([1-9][0-9]{0,2})$', '3'),
  ('sec2.anomaly_night_min', '10', 'ADMIN', '이상 행동 기준 — 밤(22 ~ 06시 · 한국) 활동 수(감사 · 열람 · 로그인 · v10.590 · 1 ~ 9999 · 처음 10)', false, '^([1-9][0-9]{0,3})$', '10'),
  ('sec2.anomaly_factor', '3', 'ADMIN', '이상 행동 기준 — 평소(지난 30일 하루 평균)의 몇 배부터(v10.590 · 2 ~ 10 · 처음 3)', false, '^([2-9]|10)$', '3'),
  ('sec2.pwned_check', 'off', 'ADMIN', '유출 비밀번호 막기(v10.591 · docs/733) — off(처음) · ASSUME(간주 — 밖으로 보내지 않고 서버 안 짧은 목록만) · LIVE(k-익명 범위 조회 — SHA-1 앞 5글자만 보냄 · sec2.pwned_legal_ok on 이어야) · 가입 · 재설정 · 변경 · 간편 가입 첫 비밀번호에서 · 조회 실패면 막지 않음', false, '^(off|ASSUME|LIVE)$', 'off'),
  ('sec2.pwned_min', '1', 'ADMIN', '유출 비밀번호 — 유출 목록에 이 번 이상 나온 비밀번호를 막음(v10.591 · 1 ~ 9999 · 처음 1)', false, '^([1-9][0-9]{0,3})$', '1'),
  ('sec2.pwned_legal_ok', 'off', 'ADMIN', '유출 비밀번호 LIVE 법무 확인(v10.591) — 처음 off · 법무가 「SHA-1 앞 5글자를 해외 조회 서비스로 보냄」을 확인하고 처리방침 1.2 문구를 게시한 뒤 SUPER 가 on · off 면 LIVE 로 못 바꿈', false, '^(on|off)$', 'off'),
  ('sec2.member_mfa', 'off', 'ADMIN', '회원 2단계 인증 선택(v10.592 · docs/734) — 처음 off · on 이면 나의공간 › 보안에서 회원이 인증 앱을 등록하고, 등록한 회원은 로그인 때 번호를 넣음(간편 로그인은 막고 이메일 로그인으로 안내) · off 로 돌리면 등록은 남고 번호를 묻지 않음', false, '^(on|off)$', 'off'),
  ('sec2.not_me_surge', '5', 'ADMIN', '회원 「내가 아니에요」 몰림 알림(v10.593 · docs/735) — 1시간 안 이 수 이상이면 운영 알림 MEMBER_NOT_ME_SURGE(WARN · 1시간 한 번 · 0 = 끔 · 처음 5 · 알림만이라 처음 값 있음)', false, '^([0-9]{1,3})$', '5')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('sec2.anomaly_watch', 'off', '운영자에게 「개인정보 열람 · 내려받기 · 밤 활동을 숫자로 살핀다」를 알린 뒤(내부 관리계획 · 취업규칙) SUPER', 'docs/732'),
  ('sec2.pwned_check', 'off', 'ASSUME 은 언제든 · LIVE 는 법무 확인(sec2.pwned_legal_ok on) · 처리방침 1.2 게시 뒤 SUPER', 'docs/733'),
  ('sec2.pwned_legal_ok', 'off', '법무가 k-익명 범위 조회(SHA-1 앞 5글자 · 해외 서비스)를 확인하고 처리방침 1.2 문구를 게시한 뒤 SUPER', 'docs/733'),
  ('sec2.member_mfa', 'off', '고객센터가 「휴대폰을 잃으면 예비 번호 → 본인 확인 뒤 초기화」 절차를 알고, 사용자 설명서에 절을 넣은 뒤 SUPER', 'docs/734')
ON CONFLICT (key) DO NOTHING;

/* ── 정기 작업 — 10분마다 하나(이상 행동은 07시 뒤 하루 한 번 · 몰림 알림 · 지난 기록 지움) ───────────── */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('sec2_tick', 10, NULL, NULL, NULL, true, '15차 보안 · 기반 — 10분마다 · 07시 뒤 어제 운영자 이상 행동 셈(sec2.anomaly_watch on 일 때 · 하루 한 번) · 회원 「내가 아니에요」 1시간 몰림 알림(sec2.not_me_surge) · 지난 2단계 표 · 낯선 로그인 · 유출 확인 건수 정리 · v10.590 ~ 593')
ON CONFLICT (job) DO NOTHING;

/* ── ㉕ 권한(D258) 시드 — scx-watch 위험감지(SUPER 만 · 권한그룹 줄 없음) · scx-help 관 관리(ADMIN · SUPER)
 *   도움말 읽기 GET /admin/help/tab 은 탭과 상관없는 공통이라 여러 업무에 걸어 둠(하나라도 VIEW 면 통과) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('scx-watch', '이상 행동 감지', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3590),
  ('scx-help', '화면 도움말', 'admsit', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3591)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'scx-help', 'VIEW'), ('R_ADMIN', 'scx-help', 'EDIT'), ('R_ADMIN', 'scx-help', 'APPROVE'), ('R_ADMIN', 'scx-help', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/sec2/watch', 'scx-watch', 'VIEW'),
  ('POST', '/admin/sec2/anomalies/scan', 'scx-watch', 'EDIT'),
  ('POST', '/admin/sec2/anomalies/{id}/review', 'scx-watch', 'EDIT'),
  ('POST', '/admin/sec2/pwned/test', 'scx-watch', 'EDIT'),
  ('PUT', '/admin/sec2/settings', 'scx-watch', 'APPROVE'),
  ('GET', '/admin/help/tab', 'scx-help', 'VIEW'),
  ('GET', '/admin/help/tab', 'home', 'VIEW'),
  ('GET', '/admin/help/tab', 'manual', 'VIEW'),
  ('GET', '/admin/help/tab', 'my-hr', 'VIEW'),
  ('GET', '/admin/help/tab', 'ofc-notify', 'VIEW'),
  ('GET', '/admin/help/tab-links', 'scx-help', 'VIEW'),
  ('PUT', '/admin/help/tab-links/{key}', 'scx-help', 'EDIT'),
  ('POST', '/admin/help/tab-links/{key}/remove', 'scx-help', 'EDIT'),
  ('GET', '/admin/help/guide', 'scx-help', 'VIEW'),
  ('POST', '/admin/help/guide', 'scx-help', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
